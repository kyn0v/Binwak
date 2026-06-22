/**
 * Visual regression E2E for the three main tabs.
 *
 * Captures a full-screen screenshot of each tab and diffs it against a stored
 * baseline (jest-image-snapshot). Baselines live in tests/e2e/__image_snapshots__
 * and are committed; a UI change that shifts pixels fails the test with a diff.
 *
 * First run (or after an intentional UI change) creates/updates baselines:
 *   npm run test:e2e:mp -- -u
 *
 * NOTE: dynamic content (dates, nicknames, board progress) can cause false
 * diffs. The failureThreshold in imageSnapshotOptions absorbs antialiasing, but
 * large dynamic regions should be stabilized or excluded as the suite grows.
 */
import { gotoMain, switchTab, screenshotBuffer, imageSnapshotOptions, seedFixtures, mockPlazaTemplates, restorePlazaTemplates } from './helpers'

// jest-image-snapshot augments expect() at runtime via setup.image.js.
declare global {
  namespace jest {
    interface Matchers<R> {
      toMatchImageSnapshot(options?: Record<string, unknown>): R
    }
  }
}

describe('main tabs (visual regression)', () => {
  let page: any

  beforeAll(async () => {
    // Seed deterministic data first, then enter main so pages render fixed
    // content (reproducible pixels across runs).
    await seedFixtures()
    page = await gotoMain()
  }, 120000)

  it('home tab matches baseline', async () => {
    await switchTab(page, 0)
    const img = await screenshotBuffer()
    expect(img).toMatchImageSnapshot({
      ...imageSnapshotOptions,
      customSnapshotIdentifier: 'tab-home',
    })
  })

  it('plaza tab matches baseline', async () => {
    // The plaza list comes from /api/templates, which is offline in the test
    // runtime. Mock it before the tab mounts so the baseline captures real
    // cards (not an empty list). Restore is done in afterEach so it runs even
    // when the snapshot assertion throws — otherwise the request mock would
    // leak into the profile tab test and corrupt its screenshot.
    await mockPlazaTemplates()
    await switchTab(page, 1)
    // Let the list render and the 3-pass fixed-layout measurement settle.
    await page.waitFor(1500)
    const img = await screenshotBuffer()
    expect(img).toMatchImageSnapshot({
      ...imageSnapshotOptions,
      customSnapshotIdentifier: 'tab-plaza',
    })
  })

  // Always tear the request mock down, regardless of assertion outcome, so a
  // plaza snapshot failure never leaks the stub into the following tests.
  afterEach(async () => {
    await restorePlazaTemplates()
  })

  it('profile tab matches baseline', async () => {
    await switchTab(page, 2)
    const img = await screenshotBuffer()
    expect(img).toMatchImageSnapshot({
      ...imageSnapshotOptions,
      customSnapshotIdentifier: 'tab-profile',
    })
  })
})
