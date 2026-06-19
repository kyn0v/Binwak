/**
 * layout — pure layout calculation helpers
 *
 * These functions contain the device-dependent pixel math that drives the
 * miniprogram's fixed/sticky layout (status bar, WeChat capsule button, custom
 * tabbar, sliding tab widths). Keeping them pure (no `uni` / DOM access) makes
 * the "pixel offset" logic unit-testable across many device profiles without a
 * real device or screenshot baseline.
 *
 * Conventions:
 * - All inputs/outputs are in px unless the name ends with `Rpx`.
 * - rpx is uni-app's responsive unit: 750rpx == screen width.
 */

/** Minimal shape of uni.getMenuButtonBoundingClientRect(). */
export interface CapsuleRect {
  top: number
  right: number
  height: number
}

/**
 * Height (px) reserved for a custom nav bar that visually aligns with the
 * WeChat capsule button. Mirrors the formula used in main.vue / boards.vue:
 * the capsule is vertically centered in the toolbar, so the toolbar height is
 * the capsule height plus twice the gap between the status bar and the capsule.
 */
export function navToolbarHeight(statusBarHeight: number, capsule: CapsuleRect): number {
  const gap = capsule.top - statusBarHeight
  return capsule.height + gap * 2
}

/** Total top offset (px) = status bar + aligned toolbar height. */
export function navBarHeight(statusBarHeight: number, capsule: CapsuleRect): number {
  return statusBarHeight + navToolbarHeight(statusBarHeight, capsule)
}

/** Convert a px length to rpx for the given screen width. */
export function pxToRpx(px: number, windowWidth: number): number {
  if (windowWidth <= 0) return 0
  return px * (750 / windowWidth)
}

/**
 * Right inset (rpx) between the capsule's right edge and the screen edge,
 * used to horizontally align floating header content with the capsule.
 */
export function capsuleRightRpx(windowWidth: number, capsule: CapsuleRect): number {
  const rightPx = Math.max(windowWidth - capsule.right, 0)
  return pxToRpx(rightPx, windowWidth)
}

/**
 * Custom tabbar total height (px): inner content height + vertical padding
 * (both defined in rpx) scaled to the device, plus the bottom safe-area inset.
 * Defaults match the design tokens used in main.vue (76rpx inner, 32rpx pad).
 */
export function tabbarHeight(
  windowWidth: number,
  safeAreaBottom: number,
  innerRpx = 76,
  paddingRpx = 32,
): number {
  const rpxRatio = windowWidth > 0 ? windowWidth / 750 : 0
  const innerPx = Math.ceil(innerRpx * rpxRatio) + Math.ceil(paddingRpx * rpxRatio)
  return innerPx + Math.max(safeAreaBottom, 0)
}

/**
 * Sliding tab widths (px) for a row of `tabCount` tabs where the active tab is
 * `activeRatio`x as wide as the others. Edge padding is applied on both sides.
 */
export function tabWidths(
  screenWidth: number,
  tabCount: number,
  edgePadding = 24,
  activeRatio = 1.5,
): { normalWidth: number; activeWidth: number } {
  const availableWidth = Math.max(screenWidth - edgePadding * 2, 0)
  // Active tab takes activeRatio units; the extra (activeRatio - 1) is shared.
  const unit = availableWidth / (tabCount + (activeRatio - 1))
  return {
    normalWidth: Math.floor(unit),
    activeWidth: Math.floor(unit * activeRatio),
  }
}
