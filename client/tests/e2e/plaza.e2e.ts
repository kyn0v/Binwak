/**
 * Plaza tab layout E2E.
 *
 * Guards the fixed-overlay layout after the magic-number refactor: the sticky
 * header, category tabs, sort bar, and content list must all render once
 * layout measurement completes, and the discover/favorites switch must work.
 */
import { gotoMain, seedFixtures, switchTab } from './helpers'

describe('plaza layout', () => {
  let page: any

  beforeAll(async () => {
    await seedFixtures()
    page = await gotoMain()
    await switchTab(page, 1) // 广场
    await page.waitFor(1500)
  }, 120000)

  it('renders the sticky header (title + tabs + search)', async () => {
    expect(await page.$('.plaza-sticky-header')).toBeTruthy()
    expect(await page.$('.plaza-title')).toBeTruthy()
    expect(await page.$('.search-bar')).toBeTruthy()
  })

  it('renders the gated fixed layers after measurement', async () => {
    // category tabs + sort bar are gated behind layoutReady; they must appear.
    expect(await page.$('.category-tabs-fixed')).toBeTruthy()
    expect(await page.$('.sort-bar-fixed')).toBeTruthy()
  })

  it('switches to favorites and back to discover', async () => {
    const tabs = await page.$$('.top-tab')
    expect(tabs.length).toBe(2)
    await tabs[1].tap() // 我的收藏
    await page.waitFor(1000)
    // sort bar is discover-only; gone on favorites
    expect(await page.$('.sort-bar-fixed')).toBeFalsy()
    await tabs[0].tap() // back to 发现
    await page.waitFor(1000)
    expect(await page.$('.sort-bar-fixed')).toBeTruthy()
  })
})
