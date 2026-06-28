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

import type { TemplateListItem } from '../../../shared/types'

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
        // Mock a photo in the first cell so the board exercises the image-cell
        // render path. /static/logo.png is bundled, so it renders offline and
        // produces reproducible pixels (unlike a remote upload URL).
        ...(i === 0 ? { imagePath: '/static/logo.png' } : {}),
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
 * The main page shows a brand-new user the in-page onboarding overlay, so seed
 * the onboarding flag first, then reLaunch and wait for the shell to settle.
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
 * Seed a board that is one cell short of a Bingo line, so completing the last
 * cell of the first row triggers the celebration.
 *
 * Row 0 has cells 0,1,2 completed and cell 3 NOT completed. loadState() records
 * the current (zero) line count as "already seen", so newly completing cell 3
 * forms a fresh line and fires showBingo. Tapping is driven through a mocked
 * showActionSheet (see mockActionSheet) since real completion goes via a native
 * ActionSheet.
 */
export async function seedBingoReadyBoard(): Promise<void> {
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
        // First row all but the last cell completed → one tap away from a line.
        completed: i === 0 || i === 1 || i === 2,
      }))
      wx.setStorageSync('binwak-onboarded', 'true')
      wx.setStorageSync('binwak-bingo-grid-size', GRID)
      wx.setStorageSync('binwak-bingo-state', { cells, hasBingo: false, gridSize: GRID })
      wx.setStorageSync('binwak-board-title', '测试卡片')
      wx.setStorageSync('binwak-nickname', '测试用户')
      wx.setStorageSync('binwak-bingo-theme', 'default')
    } catch (e) {}
  })
}

/**
 * Force uni.showActionSheet to resolve with a fixed tapIndex, so tests can drive
 * the cell-completion flow without interacting with the native ActionSheet.
 * tapIndex 1 on an incomplete cell = "✅ 仅标记完成". Call restoreActionSheet()
 * after.
 */
export async function mockActionSheet(tapIndex = 1): Promise<void> {
  await program.mockUniMethod('showActionSheet', { tapIndex })
}

export async function restoreActionSheet(): Promise<void> {
  await program.restoreUniMethod('showActionSheet')
}

/**
 * Deterministic plaza template list. Shape matches `TemplateListItem` so the
 * cards render exactly as they would from the live `/api/templates` response.
 */
export const PLAZA_TEMPLATES_FIXTURE: TemplateListItem[] = [
  {
    id: 101, title: 'Citywalk 经典挑战', description: '随手记录城市角落',
    gridSize: 5, category: 'nicetry', isPinned: false, favoriteCount: 1, isFavorite: false,
    authorName: 'Binwak', useCount: 2,
    previewCells: ['瀑布', '搭档', '作画', '口罩+帽子+眼镜', '古代人', '谐音梗', '厉害折扣', '花束', '彩蛋'],
    createdAt: '2026-06-01T00:00:00.000Z',
  },
  {
    id: 102, title: '脑洞大开 Bingo Vol.3', description: 'Binwak 初始挑战',
    gridSize: 5, category: 'creative', isPinned: true, favoriteCount: 1, isFavorite: false,
    authorName: 'Binwak', useCount: 0,
    previewCells: ['不可撤销', '维修中', '摇子', '冰可乐', '票', '洗脑循环', '无酒精', '香の物', '加更'],
    createdAt: '2026-05-20T00:00:00.000Z',
  },
  {
    id: 103, title: 'Nice Try Bingo II', description: 'Citywalk 经典挑战',
    gridSize: 5, category: 'nicetry', isPinned: false, favoriteCount: 0, isFavorite: false,
    authorName: 'Binwak', useCount: 2,
    previewCells: ['不可以', 'PIZZA', '穿衣服的狗', '抄近路', '可爱情侣', '红白黑组合', '二刀流', '招财猫', '惊喜'],
    createdAt: '2026-05-10T00:00:00.000Z',
  },
]

/**
 * Mock `/api/templates` so the plaza renders real cards instead of an empty
 * list in the offline test runtime. The plaza only issues `getTemplates`
 * requests while it is the active tab, so a static success result is safe here.
 * Mock AFTER landing on main (so app-start login behaves normally) and BEFORE
 * switching to the plaza tab (so its onMounted fetch hits the mock). Pair with
 * restorePlazaTemplates() in afterAll.
 */
export async function mockPlazaTemplates(): Promise<void> {
  await program.mockUniMethod('request', {
    statusCode: 200,
    header: {},
    data: {
      success: true,
      data: {
        templates: PLAZA_TEMPLATES_FIXTURE,
        total: PLAZA_TEMPLATES_FIXTURE.length,
        page: 1,
        limit: 10,
      },
    },
  })
}

export async function restorePlazaTemplates(): Promise<void> {
  await program.restoreUniMethod('request')
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
