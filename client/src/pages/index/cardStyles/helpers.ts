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

/** Load an image from a path via Canvas 2D API */
export function loadCanvasImage(canvas: any, src: string): Promise<any> {
  return new Promise((resolve, reject) => {
    const img = canvas.createImage()
    img.onload = () => resolve(img)
    img.onerror = (e: any) => reject(e)
    img.src = src
  })
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

/** Draw dashed line */
export function drawDashedLine(
  ctx: any,
  x1: number, y1: number,
  x2: number, y2: number,
  dashLen: number = 10,
  gapLen: number = 6,
  lineWidth: number = 2,
  color: string = '#999',
) {
  ctx.save()
  ctx.strokeStyle = color
  ctx.lineWidth = lineWidth
  ctx.setLineDash([dashLen, gapLen])
  ctx.beginPath()
  ctx.moveTo(x1, y1)
  ctx.lineTo(x2, y2)
  ctx.stroke()
  ctx.setLineDash([])
  ctx.restore()
}

/** Draw perforation (tear-off) dots along a line */
export function drawPerforation(
  ctx: any,
  x1: number, y1: number,
  x2: number, y2: number,
  dotRadius: number = 4,
  spacing: number = 16,
  color: string = 'rgba(0,0,0,0.15)',
) {
  const dx = x2 - x1
  const dy = y2 - y1
  const dist = Math.sqrt(dx * dx + dy * dy)
  const count = Math.floor(dist / spacing)
  ctx.save()
  ctx.fillStyle = color
  for (let i = 0; i <= count; i++) {
    const t = i / count
    const cx = x1 + dx * t
    const cy = y1 + dy * t
    ctx.beginPath()
    ctx.arc(cx, cy, dotRadius, 0, Math.PI * 2)
    ctx.fill()
  }
  ctx.restore()
}

/**
 * Measure and wrap text into multiple lines that fit within maxWidth.
 * Returns array of lines.
 */
export function wrapText(ctx: any, text: string, maxWidth: number): string[] {
  const lines: string[] = []
  let line = ''
  for (const char of text) {
    const testLine = line + char
    if (ctx.measureText(testLine).width > maxWidth && line) {
      lines.push(line)
      line = char
    } else {
      line = testLine
    }
  }
  if (line) lines.push(line)
  return lines
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
