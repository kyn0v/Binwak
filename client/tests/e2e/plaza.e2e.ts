/**
 * Plaza tab layout E2E.
 *
 * Guards the fixed-overlay layout after the magic-number refactor: the sticky
 * header, category tabs, sort bar, and content list must all render once
 * layout measurement completes, and the discover/favorites switch must work.
 *
 * The plaza pulls its list from `/api/templates`, which is unreachable in the
 * offline test runtime, so we mock it (see mockPlazaTemplates) to render real
 * cards — without data the occlusion regression below cannot be exercised.
 */
import {
  gotoMain,
  mockPlazaTemplates,
  restorePlazaTemplates,
  seedFixtures,
  switchTab,
} from './helpers'

describe('plaza layout', () => {
  let page: any

  beforeAll(async () => {
    await seedFixtures()
    page = await gotoMain()
    // Mock AFTER login (gotoMain) but BEFORE the plaza tab mounts, so its
    // onMounted fetchTemplates() resolves against the fixture.
    await mockPlazaTemplates()
    await switchTab(page, 1) // 广场
    await page.waitFor(1500)
  }, 120000)

  afterAll(async () => {
    await restorePlazaTemplates()
  })

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

  it('renders template cards from the mocked list', async () => {
    const cards = await page.$$('.template-card')
    expect(cards.length).toBeGreaterThan(0)
  })

  it('does not let the fixed header/sort bar occlude the first card', async () => {
    // Regression for the layout-measurement race (PR #64): the content
    // scroll-view must start below the sort bar, so the first card's top edge
    // sits at or below the sort bar's bottom (allowing the small intentional
    // overlap nudges in the layout: -12px content + -8px sort).
    const sort = await page.$('.sort-bar-fixed')
    const sortOffset = await sort.offset()
    const sortSize = await sort.size()
    const sortBottom = sortOffset.top + sortSize.height

    const firstCard = (await page.$$('.template-card'))[0]
    expect(firstCard).toBeTruthy()
    const cardOffset = await firstCard.offset()

    // Tolerance covers the combined -20px overlap nudges plus sub-pixel rounding.
    expect(cardOffset.top).toBeGreaterThanOrEqual(sortBottom - 24)
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
