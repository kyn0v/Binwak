import { describe, it, expect } from 'vitest'
import {
  navToolbarHeight,
  navBarHeight,
  pxToRpx,
  capsuleRightRpx,
  tabbarHeight,
  tabWidths,
  type CapsuleRect,
} from '../src/utils/layout'

// Representative device profiles (px values from real WeChat clients).
// statusBar/capsule numbers vary per device — these guard the "pixel offset"
// math against regressions without needing a real device or screenshots.
const devices: { name: string; windowWidth: number; statusBar: number; safeAreaBottom: number; capsule: CapsuleRect }[] = [
  { name: 'iPhone SE (no notch)', windowWidth: 320, statusBar: 20, safeAreaBottom: 0, capsule: { top: 26, right: 305, height: 32 } },
  { name: 'iPhone 13 (notch)', windowWidth: 390, statusBar: 47, safeAreaBottom: 34, capsule: { top: 55, right: 375, height: 32 } },
  { name: 'Android medium', windowWidth: 360, statusBar: 24, safeAreaBottom: 0, capsule: { top: 28, right: 345, height: 32 } },
  { name: 'Large Android', windowWidth: 414, statusBar: 32, safeAreaBottom: 16, capsule: { top: 36, right: 399, height: 36 } },
]

describe('navToolbarHeight', () => {
  it('centers the capsule: height + 2×gap', () => {
    // gap = capsule.top - statusBar = 55 - 47 = 8 → 32 + 16 = 48
    expect(navToolbarHeight(47, { top: 55, right: 375, height: 32 })).toBe(48)
  })

  it('is positive across all device profiles', () => {
    for (const d of devices) {
      expect(navToolbarHeight(d.statusBar, d.capsule)).toBeGreaterThan(0)
    }
  })
})

describe('navBarHeight', () => {
  it('= status bar + toolbar height', () => {
    expect(navBarHeight(47, { top: 55, right: 375, height: 32 })).toBe(47 + 48)
  })

  it('always covers the capsule bottom edge (no clipping)', () => {
    for (const d of devices) {
      const capsuleBottom = d.capsule.top + d.capsule.height
      expect(navBarHeight(d.statusBar, d.capsule)).toBeGreaterThanOrEqual(capsuleBottom)
    }
  })
})

describe('pxToRpx', () => {
  it('750rpx == full screen width', () => {
    expect(pxToRpx(390, 390)).toBe(750)
  })

  it('returns 0 for non-positive width (avoids divide-by-zero)', () => {
    expect(pxToRpx(10, 0)).toBe(0)
  })
})

describe('capsuleRightRpx', () => {
  it('converts the right inset to rpx', () => {
    // rightPx = 390 - 375 = 15 → 15 * 750/390 = 28.846...
    expect(capsuleRightRpx(390, { top: 55, right: 375, height: 32 })).toBeCloseTo(28.846, 2)
  })

  it('never goes negative when capsule sits at the edge', () => {
    expect(capsuleRightRpx(390, { top: 55, right: 400, height: 32 })).toBe(0)
  })
})

describe('tabbarHeight', () => {
  it('matches the default 76rpx inner + 32rpx padding design token', () => {
    // ratio 1 at width 750: ceil(76)+ceil(32) = 108, + safe area 0
    expect(tabbarHeight(750, 0)).toBe(108)
  })

  it('adds the bottom safe-area inset', () => {
    expect(tabbarHeight(750, 34)).toBe(108 + 34)
  })

  it('scales with screen width and stays positive everywhere', () => {
    for (const d of devices) {
      const h = tabbarHeight(d.windowWidth, d.safeAreaBottom)
      expect(h).toBeGreaterThan(0)
      expect(h).toBeGreaterThanOrEqual(d.safeAreaBottom)
    }
  })
})

describe('tabWidths', () => {
  it('active tab is 1.5× a normal tab by default', () => {
    const { normalWidth, activeWidth } = tabWidths(360, 3)
    expect(activeWidth).toBe(Math.floor(normalWidth * 1.5))
  })

  it('all tabs fit within the screen (with edge padding)', () => {
    for (const d of devices) {
      const n = 3
      const { normalWidth, activeWidth } = tabWidths(d.windowWidth, n)
      // 2 normal + 1 active + 2×24 padding must not exceed the screen
      const used = normalWidth * (n - 1) + activeWidth + 24 * 2
      expect(used).toBeLessThanOrEqual(d.windowWidth)
      expect(normalWidth).toBeGreaterThan(0)
    }
  })

  it('reproduces the legacy n+0.5 formula', () => {
    // Legacy: unit = (w - 48) / (n + 0.5); normal=floor(unit); active=floor(unit*1.5)
    const w = 360, n = 3
    const unit = (w - 48) / (n + 0.5)
    const { normalWidth, activeWidth } = tabWidths(w, n)
    expect(normalWidth).toBe(Math.floor(unit))
    expect(activeWidth).toBe(Math.floor(unit * 1.5))
  })
})
