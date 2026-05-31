/**
 * Canvas card export composable.
 * Handles building the bingo card image on canvas and saving to album.
 */
import { type Ref, nextTick, ref } from 'vue'
import type { CardStyleDefinition, CardRenderOptions } from './cardStyles/types'
import { EXPORT_CANVAS_SIZE } from '@/config/limits'
import { STORAGE_KEYS } from '@/config/storageKeys'
import { safeGet } from '@/utils/safeStorage'

type BingoCell = {
  id: number
  title: string
  imagePath?: string
  illustrationPath?: string
  completed: boolean
}

type ThemeValue = {
  canvasBg: string
  canvasCellBg: string
  canvasTextColor: string
  completedCellBg: string
  borderColor: string
  ringColor: string
  cellBorderStyle: string
  cellBorderWidth: string
  cellBorderRadius: string
}

// ── canvas helpers ──

function getCanvas2D(id: string, width: number, height?: number): Promise<{ canvas: any; ctx: any }> {
  const h = height ?? width
  return new Promise((resolve, reject) => {
    const query = uni.createSelectorQuery()
    query
      .select(`#${id}`)
      .fields({ node: true, size: true }, () => {})
      .exec((res: any) => {
        if (!res?.[0]?.node) {
          reject(new Error(`canvas #${id} not found`))
          return
        }
        const canvas = res[0].node
        canvas.width = width
        canvas.height = h
        const ctx = canvas.getContext('2d')
        resolve({ canvas, ctx })
      })
  })
}

// Module-level cache: canvas Image objects keyed by src path
const _imgObjCache = new Map<string, { img: any; canvas: any }>()

function loadCanvasImage(canvas: any, src: string): Promise<any> {
  const cached = _imgObjCache.get(src)
  if (cached && cached.canvas === canvas) {
    return Promise.resolve(cached.img)
  }
  return new Promise((resolve, reject) => {
    const img = canvas.createImage()
    img.onload = () => {
      _imgObjCache.set(src, { img, canvas })
      resolve(img)
    }
    img.onerror = (e: any) => reject(e)
    img.src = src
  })
}

// Module-level cache: remote URL → local temp path (survives across preview calls)
const _localPathCache = new Map<string, string>()

/** Strip query string for stable cache keys (OSS signed URLs change params each time) */
function cacheKey(url: string): string {
  const idx = url.indexOf('?')
  return idx >= 0 ? url.substring(0, idx) : url
}

/** Download a remote URL to local temp file (hits HTTP cache if already downloaded by <image>) */
function resolveLocalPath(src: string): Promise<string> {
  if (!src.startsWith('http')) return Promise.resolve(src)
  const key = cacheKey(src)
  const cached = _localPathCache.get(key)
  if (cached) return Promise.resolve(cached)
  return new Promise((resolve) => {
    uni.downloadFile({
      url: src,
      success: (res) => {
        if (res.statusCode === 200 && res.tempFilePath) {
          _localPathCache.set(key, res.tempFilePath)
          resolve(res.tempFilePath)
        } else {
          resolve(src) // fallback
        }
      },
      fail: () => resolve(src),
    })
  })
}

// Track ongoing pre-warm so buildCardImage can await it
let _preWarmPromise: Promise<void> | null = null

/**
 * Pre-warm the local path cache for a list of remote URLs.
 * Call this after illustrations are loaded so the first preview is fast.
 */
export function preWarmLocalPaths(urls: string[]) {
  const toResolve = urls.filter(u => u && u.startsWith('http') && !_localPathCache.has(cacheKey(u)))
  if (toResolve.length === 0) return
  const batchSize = 6
  let chain = Promise.resolve()
  for (let i = 0; i < toResolve.length; i += batchSize) {
    const batch = toResolve.slice(i, i + batchSize)
    chain = chain.then(() => Promise.all(batch.map(u => resolveLocalPath(u))).then(() => {}))
  }
  _preWarmPromise = chain
    .then(() => { _preWarmPromise = null })
    .catch(() => { _preWarmPromise = null })
}

/** Break text into lines that fit within maxWidth. Returns array of line strings. */
function wrapText(ctx: any, text: string, maxWidth: number, maxLines: number = 3): string[] {
  const lines: string[] = []
  let current = ''
  for (const char of text) {
    const test = current + char
    if (ctx.measureText(test).width > maxWidth && current) {
      lines.push(current)
      current = char
      if (lines.length >= maxLines) break
    } else {
      current = test
    }
  }
  if (current && lines.length < maxLines) {
    lines.push(current)
  } else if (current && lines.length === maxLines) {
    // Append ellipsis to last line
    let last = lines[maxLines - 1]
    while (last.length > 0 && ctx.measureText(last + '…').width > maxWidth) {
      last = last.slice(0, -1)
    }
    lines[maxLines - 1] = last + '…'
  }
  return lines
}

function roundRect(ctx: any, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath()
  ctx.moveTo(x + r, y)
  ctx.lineTo(x + w - r, y)
  ctx.arcTo(x + w, y, x + w, y + r, r)
  ctx.lineTo(x + w, y + h - r)
  ctx.arcTo(x + w, y + h, x + w - r, y + h, r)
  ctx.lineTo(x + r, y + h)
  ctx.arcTo(x, y + h, x, y + h - r, r)
  ctx.lineTo(x, y + r)
  ctx.arcTo(x, y, x + r, y, r)
  ctx.closePath()
}

// ── main export ──

export function useCanvasExport(
  gridSize: Ref<number>,
  cells: Ref<BingoCell[]>,
  theme: Ref<ThemeValue>,
  boardTitle: Ref<string>,
  getCardStyle: () => CardStyleDefinition,
  getBoardSequenceNumber: () => Promise<number | null>,
  isIllustMode: Ref<boolean>,
) {
  const previewImagePath = ref('')

  async function buildCardImage() {
    const canvasSize = EXPORT_CANVAS_SIZE
    const size = gridSize.value
    const padding = 40
    const gap = 20
    const boardSize = canvasSize - padding * 2
    const cellSize = (boardSize - gap * (size - 1)) / size
    const rpxScale = canvasSize / 750
    const radius = (parseInt(theme.value.cellBorderRadius) || 32) * rpxScale
    const canvasBorderWidth = parseInt(theme.value.cellBorderWidth) || 4

    const { canvas, ctx } = await getCanvas2D('bingoCanvas', canvasSize)

    // Parallel preload: resolve remote URLs to local cache paths, then load into canvas
    // Wait for pre-warm if it's still in progress
    if (_preWarmPromise) {
      await _preWarmPromise
    }
    const imageMap = new Map<string, any>()
    const uniqueSrcs: string[] = []
    for (const cell of cells.value) {
      const src = cell?.imagePath || (isIllustMode.value ? cell?.illustrationPath : '')
      if (src && !imageMap.has(src)) {
        imageMap.set(src, null) // placeholder to dedupe
        uniqueSrcs.push(src)
      }
    }
    // Step 1: resolve all remote URLs to local temp paths in parallel
    const localPaths = await Promise.all(uniqueSrcs.map(s => resolveLocalPath(s)))
    // Step 2: load local images into canvas in parallel
    await Promise.all(uniqueSrcs.map((src, i) =>
      loadCanvasImage(canvas, localPaths[i])
        .then(img => { imageMap.set(src, img) })
        .catch(() => { /* ignore */ })
    ))

    // board background (matches card bg so gaps between cells are visible)
    ctx.fillStyle = theme.value.canvasBg
    ctx.fillRect(0, 0, canvasSize, canvasSize)

    // Track regions that need grayscale (batched after all cells drawn)
    const grayRegions: { gx: number; gy: number; gw: number; gh: number }[] = []

    for (let row = 0; row < size; row += 1) {
      for (let col = 0; col < size; col += 1) {
        const idx = row * size + col
        const cell = cells.value[idx]
        const x = padding + col * (cellSize + gap)
        const y = padding + row * (cellSize + gap)

        // cell background — use completed bg for completed cells (but not for illustration cells)
        roundRect(ctx, x, y, cellSize, cellSize, radius)
        const hasPhoto = !!cell?.imagePath
        ctx.fillStyle = (cell?.completed && hasPhoto) ? theme.value.completedCellBg : theme.value.canvasCellBg
        ctx.fill()
        ctx.strokeStyle = theme.value.borderColor
        ctx.lineWidth = canvasBorderWidth

        // border style
        const bStyle = theme.value.cellBorderStyle
        if (bStyle === 'dashed') {
          ctx.setLineDash([12, 6])
        } else if (bStyle === 'dotted') {
          ctx.setLineDash([4, 6])
        } else {
          ctx.setLineDash([])
        }
        if (bStyle === 'double') {
          ctx.lineWidth = 2
          ctx.stroke()
          roundRect(ctx, x + 5, y + 5, cellSize - 10, cellSize - 10, Math.max(radius - 5, 0))
          ctx.stroke()
          ctx.setLineDash([])
        } else {
          ctx.stroke()
          ctx.setLineDash([])
        }

        // cell image (photo) — aspectFill
        if (cell?.imagePath) {
          const img = imageMap.get(cell.imagePath)
          if (img) {
            ctx.save()
            roundRect(ctx, x, y, cellSize, cellSize, radius)
            ctx.clip()
            // aspectFill: cover the cell, crop overflow
            const imgAspect = img.width / img.height
            let sx = 0, sy = 0, sw = img.width, sh = img.height
            if (imgAspect > 1) {
              sw = img.height
              sx = (img.width - sw) / 2
            } else {
              sh = img.width
              sy = (img.height - sh) / 2
            }
            ctx.drawImage(img, sx, sy, sw, sh, x, y, cellSize, cellSize)
            ctx.restore()
          }
        } else if (isIllustMode.value && cell?.illustrationPath) {
          const img = imageMap.get(cell.illustrationPath)
          if (img) {
            ctx.save()
            roundRect(ctx, x, y, cellSize, cellSize, radius)
            ctx.clip()
            // aspectFit: fit inside with padding
            const pad = cellSize * 0.06
            const area = cellSize - pad * 2 - cellSize * 0.24 // leave room for label
            const imgAspect = img.width / img.height
            let dw: number, dh: number
            if (imgAspect > 1) {
              dw = area
              dh = area / imgAspect
            } else {
              dh = area
              dw = area * imgAspect
            }
            const dx = x + (cellSize - dw) / 2
            const dy = y + pad + (area - dh) / 2
            ctx.drawImage(img, 0, 0, img.width, img.height, dx, dy, dw, dh)
            ctx.restore()
            // Track region for batched grayscale (instead of per-cell getImageData)
            if (!cell.completed) {
              grayRegions.push({
                gx: Math.floor(dx), gy: Math.floor(dy),
                gw: Math.ceil(dw), gh: Math.ceil(dh),
              })
            }
          }
        }

        // ✓ checkmark: green circle with white border + white checkmark
        if (cell?.completed && !cell?.imagePath) {
          ctx.save()
          const badgeR = Math.max(12, Math.round(cellSize * 0.09))
          const badgePad = cellSize * 0.08
          const cx = x + cellSize - badgePad - badgeR
          const cy = y + badgePad + badgeR
          ctx.globalAlpha = 0.85
          ctx.fillStyle = '#34c759'
          ctx.beginPath()
          ctx.arc(cx, cy, badgeR, 0, Math.PI * 2)
          ctx.fill()
          // white border
          ctx.strokeStyle = '#ffffff'
          ctx.lineWidth = 2
          ctx.stroke()
          // white checkmark
          ctx.globalAlpha = 1
          ctx.fillStyle = '#ffffff'
          ctx.font = `bold ${Math.round(badgeR * 1.3)}px sans-serif`
          ctx.textAlign = 'center'
          ctx.textBaseline = 'middle'
          ctx.fillText('✓', cx, cy)
          ctx.restore()
        }

        // label at bottom (drawn AFTER circles so it appears on top, matching CSS z-index)
        const title = cell?.title ?? ''
        const hasImage = !!cell?.imagePath
        const hasIllust_ = isIllustMode.value && !!cell?.illustrationPath
        if ((hasImage || hasIllust_) && title) {
          const labelFontSize = Math.max(28, Math.round(cellSize * 0.11))
          ctx.font = `bold ${labelFontSize}px sans-serif`
          const labelPad = cellSize * 0.06
          const labelMaxW = cellSize - labelPad * 2
          const labelLines = wrapText(ctx, title, labelMaxW, 2)
          const labelLineH = labelFontSize * 1.2
          const labelInnerH = labelLines.length * labelLineH
          const labelHeight = Math.max(36, labelInnerH + labelPad * 2)
          const ly = y + cellSize - labelHeight
          const r = radius
          ctx.save()
          ctx.globalAlpha = hasIllust_ && !hasImage ? 0.65 : 0.85
          ctx.fillStyle = hasIllust_ && !hasImage ? '#fff' : '#34c759'
          ctx.beginPath()
          ctx.moveTo(x, ly)
          ctx.lineTo(x + cellSize, ly)
          ctx.lineTo(x + cellSize, y + cellSize - r)
          ctx.arcTo(x + cellSize, y + cellSize, x + cellSize - r, y + cellSize, r)
          ctx.lineTo(x + r, y + cellSize)
          ctx.arcTo(x, y + cellSize, x, y + cellSize - r, r)
          ctx.lineTo(x, ly)
          ctx.closePath()
          ctx.fill()
          ctx.globalAlpha = 1.0
          ctx.fillStyle = hasIllust_ && !hasImage ? theme.value.canvasTextColor : '#fff'
          ctx.textAlign = 'center'
          ctx.textBaseline = 'middle'
          const labelStartY = ly + (labelHeight - labelInnerH) / 2 + labelLineH / 2
          for (let li = 0; li < labelLines.length; li++) {
            const lineY = labelStartY + li * labelLineH
            ctx.fillText(labelLines[li], x + cellSize / 2, lineY)
            if (hasIllust_ && !hasImage && !cell?.completed) {
              const textW = ctx.measureText(labelLines[li]).width
              const lineW = Math.max(textW + cellSize * 0.1, cellSize * 0.3)
              ctx.strokeStyle = hasIllust_ && !hasImage ? theme.value.canvasTextColor : '#fff'
              ctx.globalAlpha = 0.35
              ctx.lineWidth = Math.max(3, cellSize * 0.015)
              ctx.beginPath()
              ctx.moveTo(x + cellSize / 2 - lineW / 2, lineY)
              ctx.lineTo(x + cellSize / 2 + lineW / 2, lineY)
              ctx.stroke()
              ctx.globalAlpha = 1.0
            }
          }
          ctx.restore()
        } else if (!hasImage && !hasIllust_) {
          // Text-only cell: wrap text, with strikethrough for uncompleted
          ctx.save()
          ctx.fillStyle = theme.value.canvasTextColor
          const fontSize = Math.max(32, Math.round(cellSize * 0.14))
          ctx.font = `bold ${fontSize}px sans-serif`
          ctx.textAlign = 'center'
          ctx.textBaseline = 'middle'
          const textX = x + cellSize / 2
          const textPad = cellSize * 0.08
          const maxW = cellSize - textPad * 2
          const lineH = fontSize * 1.3
          const lines = wrapText(ctx, title, maxW, 3)
          const totalH = lines.length * lineH
          const startY = y + (cellSize - totalH) / 2 + lineH / 2
          for (let li = 0; li < lines.length; li++) {
            const ly = startY + li * lineH
            ctx.fillText(lines[li], textX, ly)
            if (!cell?.completed) {
              const textW = ctx.measureText(lines[li]).width
              const lineW = Math.max(textW + cellSize * 0.1, cellSize * 0.3)
              ctx.strokeStyle = theme.value.canvasTextColor
              ctx.globalAlpha = 0.35
              ctx.lineWidth = Math.max(3, cellSize * 0.015)
              ctx.beginPath()
              ctx.moveTo(textX - lineW / 2, ly)
              ctx.lineTo(textX + lineW / 2, ly)
              ctx.stroke()
              ctx.globalAlpha = 1
            }
          }
          ctx.restore()
        }
      }
    }

    // Batched grayscale: ONE getImageData + putImageData for all uncompleted illustration cells
    if (grayRegions.length > 0) {
      const fullData = ctx.getImageData(0, 0, canvasSize, canvasSize)
      const buf = new Uint32Array(fullData.data.buffer)
      const stride = canvasSize // pixels per row
      for (const { gx, gy, gw, gh } of grayRegions) {
        for (let row = gy; row < gy + gh; row++) {
          const rowStart = row * stride + gx
          for (let i = rowStart; i < rowStart + gw; i++) {
            const pixel = buf[i]
            const r = pixel & 0xFF
            const g = (pixel >> 8) & 0xFF
            const b = (pixel >> 16) & 0xFF
            const a = pixel & 0xFF000000
            const gray = (r * 77 + g * 150 + b * 29) >> 8
            buf[i] = gray | (gray << 8) | (gray << 16) | a
          }
        }
      }
      ctx.putImageData(fullData, 0, 0)
    }

    const result = await new Promise<string>((resolve, reject) => {
      ;(uni.canvasToTempFilePath as any)({
        canvas,
        destWidth: canvasSize,
        destHeight: canvasSize,
        success: (res: any) => resolve(res.tempFilePath),
        fail: reject,
      })
    })
    return result
  }

  /**
   * Build a styled export card using the currently selected card style.
   * Delegates rendering to the card style's render() function.
   */
  async function buildStyledCard(): Promise<string> {
    // Run board rendering and boardSeq fetch in parallel
    const [boardPath, boardSeq] = await Promise.all([
      buildCardImage(),
      getBoardSequenceNumber(),
    ])

    const style = getCardStyle()
    const cardW = style.canvasWidth
    const cardH = style.canvasHeight

    const { canvas, ctx } = await getCanvas2D('polaroidCanvas', cardW, cardH)
    ctx.clearRect(0, 0, cardW, cardH)

    const opts: CardRenderOptions = {
      boardImagePath: boardPath,
      title: boardTitle.value || 'Binwak',
      watermark: `@${safeGet<string>(STORAGE_KEYS.NICKNAME) || 'binwak'}`,
      boardId: boardSeq ?? undefined,
      colors: {
        bg: theme.value.canvasBg,
        cellBg: theme.value.canvasCellBg,
        textColor: theme.value.canvasTextColor,
        borderColor: theme.value.borderColor,
        accentColor: theme.value.ringColor,
      },
    }

    await style.render({ canvas, ctx, width: cardW, height: cardH }, opts)

    const result = await new Promise<string>((resolve, reject) => {
      ;(uni.canvasToTempFilePath as any)({
        canvas,
        destWidth: cardW,
        destHeight: cardH,
        success: (res: any) => resolve(res.tempFilePath),
        fail: reject,
      })
    })
    return result
  }

  async function previewCard() {
    await nextTick()
    try {
      uni.showLoading({ title: '生成卡片...' })
      const filePath = await buildStyledCard()
      uni.hideLoading()
      previewImagePath.value = filePath
    } catch (e) {
      uni.hideLoading()
      console.error('[bingo] previewCard error', e)
      uni.showToast({ title: '生成预览失败', icon: 'none' })
    }
  }

  function closePreview() {
    previewImagePath.value = ''
  }

  async function previewToSave() {
    if (!previewImagePath.value) return
    try {
      await saveImageToAlbum(previewImagePath.value)
      uni.showToast({ title: '已保存到相册', icon: 'success' })
    } catch (e) {
      console.error('[bingo] save error', e)
      uni.showToast({ title: '保存失败', icon: 'none' })
    }
  }

  async function downloadCard() {
    await nextTick()
    try {
      const filePath = await buildStyledCard()
      await saveImageToAlbum(filePath)
      uni.showToast({ title: '已保存到相册', icon: 'success' })
    } catch (e) {
      console.error('[bingo] downloadCard error', e)
      uni.showToast({ title: '保存失败', icon: 'none' })
    }
  }

  return {
    previewImagePath,
    previewCard,
    closePreview,
    previewToSave,
    downloadCard,
  }
}

// ── album helper ──

async function saveImageToAlbum(filePath: string) {
  const setting = await new Promise<UniNamespace.GetSettingSuccessResult>((resolve) => {
    uni.getSetting({ success: resolve })
  })

  if (!setting.authSetting['scope.writePhotosAlbum']) {
    await new Promise<void>((resolve, reject) => {
      uni.authorize({
        scope: 'scope.writePhotosAlbum',
        success: () => resolve(),
        fail: () => reject(),
      })
    })
  }

  await new Promise<void>((resolve, reject) => {
    uni.saveImageToPhotosAlbum({
      filePath,
      success: () => resolve(),
      fail: () => reject(),
    })
  })
}
