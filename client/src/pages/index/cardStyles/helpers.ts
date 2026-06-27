/**
 * Shared canvas drawing helpers used across card style renderers.
 */

/** Draw a rounded rectangle path (does NOT fill or stroke) */
export function roundRect(ctx: any, x: number, y: number, w: number, h: number, r: number) {
  const cr = Math.min(r, w / 2, h / 2)
  ctx.beginPath()
  ctx.moveTo(x + cr, y)
  ctx.lineTo(x + w - cr, y)
  ctx.arcTo(x + w, y, x + w, y + cr, cr)
  ctx.lineTo(x + w, y + h - cr)
  ctx.arcTo(x + w, y + h, x + w - cr, y + h, cr)
  ctx.lineTo(x + cr, y + h)
  ctx.arcTo(x, y + h, x, y + h - cr, cr)
  ctx.lineTo(x, y + cr)
  ctx.arcTo(x, y, x + cr, y, cr)
  ctx.closePath()
}

// Module-level cache: canvas Image objects keyed by src path. Memoization is
// transparent (same image for a given src/canvas), so callers that don't need
// caching are unaffected. Keyed by src and validated against the canvas node so
// different canvases (e.g. bingoCanvas vs polaroidCanvas) never collide.
const _imgObjCache = new Map<string, { img: any; canvas: any }>()

/** Load an image from a path via Canvas 2D API (cached by src + canvas) */
export function loadCanvasImage(canvas: any, src: string): Promise<any> {
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

/**
 * Break text into lines that fit within maxWidth. Returns an array of line
 * strings; if the text exceeds maxLines, the last line is truncated with an
 * ellipsis.
 */
export function wrapText(ctx: any, text: string, maxWidth: number, maxLines: number = 3): string[] {
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

/** Generate tiled noise texture for paper feel */
export function drawNoiseTile(ctx: any, w: number, h: number, alpha: number = 15, seed: number = 12345) {
  const noiseW = 200
  const noiseH = 200
  const noiseImageData = ctx.createImageData(noiseW, noiseH)
  const data = noiseImageData.data
  let s = seed
  for (let i = 0; i < data.length; i += 4) {
    s = (s * 1103515245 + 12345) & 0x7fffffff
    const v = (s >> 16) & 0xff
    data[i] = v
    data[i + 1] = v
    data[i + 2] = v
    data[i + 3] = alpha
  }
  for (let ny = 0; ny < h; ny += noiseH) {
    for (let nx = 0; nx < w; nx += noiseW) {
      ctx.putImageData(noiseImageData, nx, ny)
    }
  }
}

/**
 * Get ISO week number of the year (1-52/53)
 */
export function getWeekNumber(date: Date = new Date()): number {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()))
  const dayNum = d.getUTCDay() || 7
  d.setUTCDate(d.getUTCDate() + 4 - dayNum)
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1))
  return Math.ceil((((d.getTime() - yearStart.getTime()) / 86400000) + 1) / 7)
}

/**
 * Format week string like "Week 08"
 */
export function formatWeekString(date: Date = new Date()): string {
  const week = getWeekNumber(date)
  return `Week ${String(week).padStart(2, '0')}`
}
