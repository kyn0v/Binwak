/**
 * Interaction E2E for the home (challenge) tab.
 *
 * Drives real user interactions against the mp-weixin runtime via uni-automator:
 * the settings menu, board switcher, illustration-mode toggle, and completing a
 * cell to trigger the Bingo celebration. Cell completion goes through a native
 * ActionSheet, so we mock uni.showActionSheet to return a fixed choice.
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
  describe('settings menu', () => {
    let page: any
    beforeAll(async () => {
      await seedFixtures()
      page = await gotoMain()
    }, 120000)

    it('opens the settings dropdown', async () => {
      const btn = await page.$('.settings-button')
      expect(btn).toBeTruthy()
      await btn.tap()
      await page.waitFor(800)
      const menu = await page.$('.dropdown-menu')
      expect(menu).toBeTruthy()
      // menu contains actionable items
      const items = await page.$$('.menu-item')
      expect(items.length).toBeGreaterThan(0)
    })
  })

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
