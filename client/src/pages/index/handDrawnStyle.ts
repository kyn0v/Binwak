/**
 * Hand-drawn circle style generator.
 * Shared between CSS (board view) and Canvas (card export).
 *
 * Given a cell index, produces deterministic pseudo-random style params
 * for a single organic ring: border-radius, rotation, scale, offset,
 * and per-side border-width variation for a hand-drawn stroke feel.
 */

export type RingParams = {
  /** border-radius values: [r1,r2,r3,r4,r5,r6,r7,r8] in percent */
  br: number[]
  /** rotation in degrees */
  rot: number
  /** scale percentage */
  scale: number
  /** x offset in rpx */
  ox: number
  /** y offset in rpx */
  oy: number
  /** border-width per side [top,right,bottom,left] in rpx */
  bw: number[]
}

/** Deterministic pseudo-random helper */
function prng(seed: number, i: number): number {
  const v = seed * 9301 + i * 49297 + 233
  return ((v * 233280 + 1) >>> 0) % 65536
}

export function getHandDrawnParams(index: number): RingParams {
  const s = index * 7 + 3
  const rv = (i: number) => prng(s, i) % 25

  // Moderate border-radius variation → organic but smooth single shape
  const base = 42
  const range = 16
  const r1 = base + (rv(1) % range)
  const r2 = base + (rv(2) % range)
  const r3 = base + (rv(3) % range)
  const r4 = base + (rv(4) % range)
  const r5 = base + (rv(5) % range)
  const r6 = base + (rv(6) % range)
  const r7 = base + (rv(7) % range)
  const r8 = base + (rv(8) % range)

  const rot = ((s * 19) % 60) - 30       // -30 to +30 deg
  const scale = 70 + ((s * 11) % 10)     // 70-80%
  const ox = ((s * 7) % 18) - 9          // -9 to +9 rpx
  const oy = ((s * 13) % 18) - 9

  // Per-side border-width variation for stroke-width feel
  const bwBase = 10
  const bwTop = bwBase + (rv(9) % 4)     // 10-13 rpx
  const bwRight = bwBase + (rv(10) % 4)
  const bwBottom = bwBase + (rv(11) % 4)
  const bwLeft = bwBase + (rv(12) % 4)

  return {
    br: [r1, r2, r3, r4, r5, r6, r7, r8],
    rot, scale, ox, oy,
    bw: [bwTop, bwRight, bwBottom, bwLeft],
  }
}

/** Convert RingParams to CSS style object for a single cell-ring element. */
export function ringParamsToCSS(params: RingParams): Record<string, string> {
  const { br, rot, scale, ox, oy, bw } = params
  return {
    width: `${scale}%`,
    height: `${scale}%`,
    borderRadius: `${br[0]}% ${br[1]}% ${br[2]}% ${br[3]}% / ${br[4]}% ${br[5]}% ${br[6]}% ${br[7]}%`,
    transform: `rotate(${rot}deg) translate(${ox}rpx, ${oy}rpx)`,
    borderTopWidth: `${bw[0]}rpx`,
    borderRightWidth: `${bw[1]}rpx`,
    borderBottomWidth: `${bw[2]}rpx`,
    borderLeftWidth: `${bw[3]}rpx`,
  }
}
