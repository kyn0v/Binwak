/**
 * Interaction E2E for the home (challenge) tab.
 *
 * Drives real user interactions against the mp-weixin runtime via uni-automator:
 * the board switcher (which now also hosts the card actions formerly in the
 * settings menu), illustration-mode toggle, and completing a cell to trigger
 * the Bingo celebration. Cell completion goes through a native ActionSheet, so
 * we mock uni.showActionSheet to return a fixed choice.
 */
import {
  gotoMain,
  seedFixtures,
  seedBingoReadyBoard,
  mockActionSheet,
  restoreActionSheet,
} from './helpers'

declare const program: any

describe('home interactions', () => {
  describe('board switcher', () => {
    let page: any
    beforeAll(async () => {
      await seedFixtures()
      page = await gotoMain()
    }, 120000)

    it('opens the board switcher dropdown', async () => {
      const row = await page.$('.board-name-row')
      expect(row).toBeTruthy()
      await row.tap()
      await page.waitFor(800)
      const dropdown = await page.$('.board-dropdown')
      expect(dropdown).toBeTruthy()
    })

    it('exposes the consolidated card actions in the dropdown', async () => {
      // The settings menu was removed; its actions live in this dropdown.
      // The board list and 重置 were also removed, and 管理全部卡片 is now the
      // first entry. Expect: 创建卡片 entry + 管理/编辑/预览/分享 actions.
      const create = await page.$('.dropdown-create-text')
      expect(create).toBeTruthy()
      const actions = await page.$$('.dropdown-action')
      // 管理全部卡片 / 编辑卡片 / 预览卡片 / 分享 (+ optional 发布到广场)
      expect(actions.length).toBeGreaterThanOrEqual(4)
    })

    it('dropdown items are tappable (not covered by the close overlay)', async () => {
      // Regression guard for the z-index fix: the full-screen tap-to-close
      // overlay must NOT sit above the dropdown, or its actions would be
      // unclickable. Tapping 创建卡片 toggles the size picker open in-place;
      // if the overlay intercepted the tap, the switcher would close instead.
      const createRow = await page.$('.dropdown-create')
      expect(createRow).toBeTruthy()
      await createRow.tap()
      await page.waitFor(400)
      const picker = await page.$('.size-picker')
      expect(picker).toBeTruthy()
    })
  })

  describe('illustration-mode toggle', () => {
    let page: any
    beforeAll(async () => {
      await seedFixtures()
      page = await gotoMain()
    }, 120000)

    it('toggles the mode label between 文本模式 and 插画模式', async () => {
      const label = await page.$('.mode-switch-label')
      const before = await label.text()
      const row = await page.$('.mode-switch-row')
      await row.tap()
      await page.waitFor(1200)
      const after = await (await page.$('.mode-switch-label')).text()
      expect(after).not.toEqual(before)
      expect(['文本模式', '插画模式']).toContain(after)
    })
  })

  describe('Bingo celebration', () => {
    let page: any
    beforeAll(async () => {
      await seedBingoReadyBoard()
      page = await gotoMain()
      // Native ActionSheet → return "✅ 仅标记完成" (tapIndex 1).
      await mockActionSheet(1)
    }, 120000)

    afterAll(async () => {
      await restoreActionSheet()
    })

    it('shows the celebration after completing the last cell of a row', async () => {
      // Cell index 3 is the empty slot in the otherwise-complete first row.
      // Select by class + index (mp-weixin automator is unreliable with #id on
      // dynamically-bound ids).
      const cells = await page.$$('.cell')
      expect(cells.length).toBeGreaterThanOrEqual(4)
      await cells[3].tap()
      await page.waitFor(1500)
      const overlay = await page.$('.bingo-overlay')
      expect(overlay).toBeTruthy()
    })
  })
})
