const SHARE_PREFIX = 'CWBG1|'

// Valid grid sizes: 3×3=9, 4×4=16, 5×5=25
const VALID_COUNTS = [9, 16, 25]

function buildShareCode(titles: string[]) {
  const encoded = titles.map((title) => encodeURIComponent(title || ''))
  return `${SHARE_PREFIX}${encoded.join(',')}`
}

interface ParsedShareCode {
  titles: string[]
  gridSize: number
}

// Strip zero-width and other invisible Unicode chars that clipboard may inject
function cleanInput(s: string): string {
  return s.replace(/[\u200b\u200c\u200d\ufeff\u00a0]/g, '').trim()
}

function parseShareCode(code: string, expectedCount?: number): ParsedShareCode | null {
  const cleaned = cleanInput(code)
  if (!cleaned.startsWith(SHARE_PREFIX)) return null
  const payload = cleaned.slice(SHARE_PREFIX.length)
  const parts = payload.split(',')

  // Must be a valid grid count
  if (!VALID_COUNTS.includes(parts.length)) return null

  // If expectedCount provided, enforce it
  if (expectedCount !== undefined && parts.length !== expectedCount) return null

  try {
    const titles = parts.map((item) => decodeURIComponent(item))
    const gridSize = Math.round(Math.sqrt(parts.length))
    return { titles, gridSize }
  } catch {
    return null
  }
}

async function copyShareCodeToClipboard(code: string) {
  await new Promise<void>((resolve, reject) => {
    uni.setClipboardData({
      data: code,
      success: () => resolve(),
      fail: () => reject(),
    })
  })
}

async function readShareCodeFromClipboard(expectedCount: number) {
  try {
    const clipboard = await new Promise<UniNamespace.GetClipboardDataSuccessRes>((resolve, reject) => {
      uni.getClipboardData({
        success: resolve,
        fail: reject,
      })
    })
    const text = (clipboard.data || '').trim()
    return parseShareCode(text, expectedCount)
  } catch {
    return null
  }
}

export { buildShareCode, parseShareCode, copyShareCodeToClipboard, readShareCodeFromClipboard }
