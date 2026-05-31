/**
 * Polaroid / Film Diary card style
 *
 * Layout regions (top to bottom):
 *   Background — full canvas: paper texture + shadows
 *   Header     — reserved, currently empty
 *   Board      — bingo grid image + border + film holes
 *   Footer     — title, subtitle, separator, date/week, watermark
 */
import type { CardStyleDefinition, CardRenderContext, CardRenderOptions } from './types'
import { roundRect, loadCanvasImage, drawNoiseTile, formatWeekString } from './helpers'

function hexToRgba(hex: string, alpha: number): string {
  const h = hex.replace('#', '')
  const r = parseInt(h.substring(0, 2), 16)
  const g = parseInt(h.substring(2, 4), 16)
  const b = parseInt(h.substring(4, 6), 16)
  return `rgba(${r},${g},${b},${alpha})`
}

/** Region descriptor: y position and available height */
interface Region {
  y: number
  h: number
}

// ── Background ──────────────────────────────────────────────

function drawBackground(
  ctx: CanvasRenderingContext2D,
  cardW: number,
  cardH: number,
  cornerR: number,
  bg: string,
) {
  // Paper gradient
  const grad = ctx.createLinearGradient(0, 0, cardW * 0.3, cardH)
  grad.addColorStop(0, bg)
  grad.addColorStop(0.35, bg)
  grad.addColorStop(1, bg)
  roundRect(ctx, 0, 0, cardW, cardH, cornerR)
  ctx.fillStyle = grad
  ctx.fill()

  // Noise texture for paper feel
  ctx.save()
  roundRect(ctx, 0, 0, cardW, cardH, cornerR)
  ctx.clip()
  drawNoiseTile(ctx, cardW, cardH, 15)
  ctx.globalCompositeOperation = 'destination-over'
  const grad2 = ctx.createLinearGradient(0, 0, cardW * 0.3, cardH)
  grad2.addColorStop(0, bg)
  grad2.addColorStop(0.35, bg)
  grad2.addColorStop(1, bg)
  ctx.fillStyle = grad2
  ctx.fillRect(0, 0, cardW, cardH)
  ctx.globalCompositeOperation = 'source-over'
  ctx.restore()

  // Inner shadow
  ctx.save()
  roundRect(ctx, 0, 0, cardW, cardH, cornerR)
  ctx.clip()
  ctx.shadowColor = 'rgba(0, 0, 0, 0.04)'
  ctx.shadowBlur = 30
  ctx.shadowOffsetX = 0
  ctx.shadowOffsetY = 2
  ctx.strokeStyle = 'rgba(0,0,0,0.03)'
  ctx.lineWidth = 2
  roundRect(ctx, 1, 1, cardW - 2, cardH - 2, cornerR)
  ctx.stroke()
  ctx.restore()

  // Outer shadow
  ctx.save()
  ctx.shadowColor = 'rgba(0, 0, 0, 0.25)'
  ctx.shadowBlur = 40
  ctx.shadowOffsetY = 8
  ctx.strokeStyle = 'rgba(0,0,0,0)'
  ctx.lineWidth = 0
  roundRect(ctx, 0, 0, cardW, cardH, cornerR)
  ctx.stroke()
  ctx.restore()
}

// ── Header (reserved) ───────────────────────────────────────

function drawHeader(
  _ctx: CanvasRenderingContext2D,
  _region: Region,
  _cardW: number,
  _padSide: number,
  _textColor: string,
) {
  // Reserved for future use
}

// ── Board ───────────────────────────────────────────────────

async function drawBoard(
  ctx: CanvasRenderingContext2D,
  canvas: any,
  region: Region,
  cardW: number,
  padSide: number,
  bg: string,
  textColor: string,
  boardImagePath: string,
) {
  const boardW = cardW - padSide * 2
  const boardH = boardW
  const imgR = 8
  const boardX = padSide
  const boardY = region.y

  // Board image
  const boardImg = await loadCanvasImage(canvas, boardImagePath)
  ctx.save()
  roundRect(ctx, boardX, boardY, boardW, boardH, imgR)
  ctx.clip()
  ctx.fillStyle = bg
  ctx.fillRect(boardX, boardY, boardW, boardH)
  ctx.shadowColor = 'rgba(0,0,0,0.06)'
  ctx.shadowBlur = 6
  ctx.shadowOffsetX = 0
  ctx.shadowOffsetY = 0
  ctx.drawImage(boardImg, 0, 0, boardImg.width, boardImg.height, boardX, boardY, boardW, boardH)
  ctx.restore()

  // Border
  ctx.save()
  ctx.strokeStyle = hexToRgba(textColor, 0.25)
  ctx.lineWidth = 4
  roundRect(ctx, boardX, boardY, boardW, boardH, imgR)
  ctx.stroke()
  ctx.restore()

  // Film strip holes
  ctx.save()
  ctx.fillStyle = hexToRgba(textColor, 0.15)
  const holeR = 10
  const holeSpacing = 80
  const holesCount = Math.floor(boardH / holeSpacing)
  for (let i = 0; i < holesCount; i++) {
    const hy = boardY + 40 + i * holeSpacing
    ctx.beginPath()
    ctx.arc(padSide / 2, hy, holeR, 0, Math.PI * 2)
    ctx.fill()
    ctx.beginPath()
    ctx.arc(cardW - padSide / 2, hy, holeR, 0, Math.PI * 2)
    ctx.fill()
  }
  ctx.restore()
}

// ── Footer ──────────────────────────────────────────────────

function drawFooter(
  ctx: CanvasRenderingContext2D,
  region: Region,
  cardW: number,
  padSide: number,
  textColor: string,
  title: string,
  watermark: string,
) {
  const left = padSide + 10
  const right = cardW - padSide - 10
  let curY = region.y

  // Separator line position
  const sepY = curY + 110

  // Title (left, bottom-aligned to separator)
  ctx.fillStyle = textColor
  ctx.font = 'bold 64px sans-serif'
  ctx.textAlign = 'left'
  ctx.textBaseline = 'bottom'
  ctx.fillText(title || 'Binwak', left, sepY - 30)

  // Brand tag (right, bottom-aligned to separator)
  // ctx.fillStyle = hexToRgba(textColor, 0.6)
  // ctx.font = '48px sans-serif'
  // ctx.textAlign = 'right'
  // ctx.textBaseline = 'bottom'
  // ctx.fillText('「Binwak」', right, sepY - 20)

  // Separator line
  ctx.strokeStyle = hexToRgba(textColor, 0.18)
  ctx.lineWidth = 1.5
  ctx.beginPath()
  ctx.moveTo(left, sepY)
  ctx.lineTo(right, sepY)
  ctx.stroke()

  // Info row below separator
  curY = sepY + 20
  const now = new Date()
  const dateStr = `${now.getFullYear()}.${String(now.getMonth() + 1).padStart(2, '0')}.${String(now.getDate()).padStart(2, '0')}`
  const weekStr = formatWeekString(now)

  // Date (left, top)
  ctx.fillStyle = hexToRgba(textColor, 0.5)
  ctx.font = '44px monospace'
  ctx.textAlign = 'left'
  ctx.textBaseline = 'top'
  ctx.fillText(dateStr, left, curY + 6)

  // Week (left, below date)
  ctx.font = '40px monospace'
  ctx.fillText(weekStr, left, curY + 56)

  // Watermark (right)
  ctx.fillStyle = hexToRgba(textColor, 0.55)
  ctx.font = 'italic 48px sans-serif'
  ctx.textAlign = 'right'
  ctx.textBaseline = 'top'
  ctx.fillText(watermark, right, curY + 26)
}

// ── Card style definition ───────────────────────────────────

export const polaroidStyle: CardStyleDefinition = {
  id: 'polaroid',
  name: '胶片·日记',
  icon: '📷',
  description: '经典拍立得效果，纸质纹理背景',
  canvasWidth: 1700,
  canvasHeight: 1950,

  async render(rctx: CardRenderContext, opts: CardRenderOptions) {
    const { canvas, ctx, width: cardW, height: cardH } = rctx
    const { boardImagePath, title, watermark, colors } = opts

    const bg = colors.bg || '#EFE2C8'
    const textColor = colors.textColor || '#3D2E1E'
    const padSide = 80
    const cornerR = 16
    const boardSize = cardW - padSide * 2

    // Layout: divide card into regions
    const headerH = 80
    const boardH = boardSize
    const footerGap = 36
    const footerY = headerH + boardH + footerGap
    const footerH = cardH - footerY

    const header: Region = { y: 0, h: headerH }
    const board: Region = { y: headerH, h: boardH }
    const footer: Region = { y: footerY, h: footerH }

    // Draw each region
    drawBackground(ctx, cardW, cardH, cornerR, bg)
    drawHeader(ctx, header, cardW, padSide, textColor)
    await drawBoard(ctx, canvas, board, cardW, padSide, bg, textColor, boardImagePath)
    drawFooter(ctx, footer, cardW, padSide, textColor, title, watermark)
  },
}
