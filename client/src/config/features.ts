/**
 * Feature flags — toggle in-progress features without removing their code.
 *
 * Keep flags here so a feature can be hidden from users while its
 * implementation stays in the tree, ready to be re-enabled later.
 */

/**
 * Template publishing (发布到广场 / 我发布的模板).
 *
 * Temporarily disabled: the authoring side is incomplete (e.g. users cannot
 * upload their own illustrations yet), so publishing produces low-quality
 * templates. The plaza tab itself stays available for browsing/applying
 * existing templates. Re-enable once authoring is complete. Tracked in the
 * template-publishing feature issue.
 */
export const ENABLE_TEMPLATE_PUBLISHING = false
