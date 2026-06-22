/**
 * Shared helpers for uni-automator E2E tests.
 *
 * `program` and `uni` are injected as globals by the uni-automator jest
 * environment (@dcloudio/uni-automator/dist/environment.js).
 */

// uni-automator globals (declared for TS; provided at runtime by the env).
declare const program: any
// `wx` is available inside program.evaluate() (runs in the mp runtime).
declare const wx: any

const ONBOARDED_KEY = 'binwak-onboarded'

/**
 * Deterministic local data for visual-regression runs.
 *
 * Visual snapshots must be reproducible, but the live app pulls dynamic data
 * (date-based board title, random nickname, remote board contents). We seed a
 * fixed dataset into local storage so the home/profile pages render the same
 * pixels every run. This is a test-only fixture written via storage — it never
 * touches production code. When the silent login fails in the test runtime the
 * app stays offline and keeps these local values instead of overwriting them
 * from the server.
 */
export async function seedFixtures(): Promise<void> {
  await program.evaluate(() => {
    try {
      const GRID = 4
      const titles = [
        '瀑布', '搭档', '作画', '口罩',
        '古代人', '谐音梗', '厉害折扣', '花束',
        '跑者', '落单耳机', '摆拍', '野猫对视',
        'Nice Try', '球体', '一饮而尽', '好快的车',
      ]
      const cells = titles.map((title, i) => ({
        id: i,
        title,
        completed: i % 3 === 0, // a fixed, reproducible completion pattern
      }))
      wx.setStorageSync('binwak-onboarded', 'true')
      wx.setStorageSync('binwak-bingo-grid-size', GRID)
      // safeStorage stores values as-is (uni serializes objects natively), so
      // write the object directly — JSON.stringify would make loadState skip it.
      wx.setStorageSync('binwak-bingo-state', { cells, hasBingo: false, gridSize: GRID })
      wx.setStorageSync('binwak-board-title', '测试卡片')
      wx.setStorageSync('binwak-nickname', '测试用户')
      wx.setStorageSync('binwak-bingo-theme', 'default')
    } catch (e) {}
  })
}

/**
 * Mark onboarding complete and land on the main (tab shell) page.
 *
 * The main page redirects brand-new users to the welcome flow, so seed the
 * onboarding flag first, then reLaunch and wait for the shell to settle.
 * Returns the current page instance.
 */
export async function gotoMain(): Promise<any> {
  await program.evaluate((key: string) => {
    try { wx.setStorageSync(key, 'true') } catch (e) {}
  }, ONBOARDED_KEY)
  await program.reLaunch('/pages/main/main')
  // mp-weixin needs a generous settle window after reLaunch.
  const page = await program.currentPage()
  await page.waitFor(4000)
  return program.currentPage()
}

/**
 * Switch the bottom tab by tapping the real TabBar item.
 * idx: 0 = 挑战(home), 1 = 广场(plaza), 2 = 我的(profile).
 */
export async function switchTab(page: any, idx: number): Promise<void> {
  const items = await page.$$('.tab-item')
  if (!items[idx]) throw new Error(`tab-item[${idx}] not found (got ${items.length})`)
  await items[idx].tap()
  await page.waitFor(2500)
}

/**
 * Capture a full-screen screenshot as a Buffer for visual-regression matching.
 *
 * uni-automator's `program.screenshot()` returns a base64 PNG when no `path` is
 * given; we wrap it into a Buffer that jest-image-snapshot accepts.
 */
export async function screenshotBuffer(): Promise<Buffer> {
  const base64 = await program.screenshot()
  return Buffer.from(base64, 'base64')
}

/** Default jest-image-snapshot options: small tolerance to absorb antialiasing. */
export const imageSnapshotOptions = {
  // Per-pixel color tolerance, and an overall mismatch budget, to absorb
  // sub-pixel antialiasing differences across runs/machines.
  failureThreshold: 0.02,
  failureThresholdType: 'percent' as const,
  comparisonMethod: 'ssim' as const,
}
