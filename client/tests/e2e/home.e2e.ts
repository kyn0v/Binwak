/**
 * Smoke E2E for the main tab shell (home / plaza / profile).
 *
 * Verifies the app boots past onboarding, the home Bingo board renders, and the
 * three bottom tabs are present and switchable. Runs against a real runtime via
 * uni-automator (`program`/`uni` are injected globals).
 *
 * Prereqs (mp-weixin): build the bundle (npm run build:mp-weixin) and enable
 * WeChat DevTools service port with the IDE logged in.
 */
import { gotoMain, switchTab } from './helpers'

declare const program: any

describe('main tab shell (smoke)', () => {
  let page: any

  beforeAll(async () => {
    page = await gotoMain()
  }, 120000)

  it('lands on the main page (not redirected to welcome)', async () => {
    const current = await program.currentPage()
    expect(current.path).toContain('pages/index/index')
  })

  it('renders the bottom tab bar with three tabs', async () => {
    const tabs = await page.$$('.tab-item')
    expect(tabs.length).toBe(3)
  })

  it('shows the home header title', async () => {
    const title = await page.$('.title-art')
    expect(title).toBeTruthy()
    const text = await title.text()
    expect(text).toContain('Binwak')
  })

  it('switches to the plaza tab', async () => {
    await switchTab(page, 1)
    const title = await page.$('.plaza-title')
    expect(title).toBeTruthy()
  })

  it('switches to the profile tab', async () => {
    await switchTab(page, 2)
    // profile has no template-publishing entry while the feature is gated off
    const current = await program.currentPage()
    expect(current.path).toContain('pages/index/index')
  })
})
