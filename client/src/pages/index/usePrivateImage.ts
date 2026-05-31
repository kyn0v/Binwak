/**
 * usePrivateImage
 *
 * Resolves cell imagePath values to displayable URLs.
 *
 * With the channel-aware backend:
 * - stable channel: imageUrl is a plain public URL → use directly
 * - beta channel: imageUrl is already a presigned HTTPS URL from the server → use directly
 *
 * This composable exists as a thin wrapper to handle edge cases:
 * - Local temp paths (/tmp/...) from offline-first uploads → use directly
 * - Future: client-side URL refresh if presigned URL expires mid-session
 */

export function usePrivateImage() {
  /**
   * Returns a displayable URL for a given imagePath value.
   * Currently a pass-through; kept as an abstraction layer for future use.
   */
  function resolveUrl(imagePath: string): Promise<string> {
    return Promise.resolve(imagePath || '')
  }

  /** Pre-warm: no-op for now, kept for API compatibility */
  async function prefetchUrls(_keys: string[]): Promise<void> {}

  return { resolveUrl, prefetchUrls }
}
