/**
 * Pure board-state helpers.
 *
 * Extracted from index.vue so the "what state is this board in" and
 * "should illustration mode default on" decisions are testable in isolation,
 * without the Vue component or storage. Operates on a minimal structural cell
 * shape so it stays decoupled from the component's BingoCell type.
 */

export type BoardStateCell = {
  title?: string
  imagePath?: string
  illustrationPath?: string
}

export type BoardState = 'empty' | 'words-only' | 'has-images'

/**
 * Classify a board:
 * - 'has-images'  — at least one cell has a photo
 * - 'words-only'  — no photos, but at least one cell has a non-blank title
 * - 'empty'       — neither
 */
export function getBoardState(cells: BoardStateCell[]): BoardState {
  if (cells.some((c) => c.imagePath)) return 'has-images'
  if (cells.some((c) => c.title && c.title.trim())) return 'words-only'
  return 'empty'
}

/**
 * Default illustration-mode preference when the user hasn't set one yet:
 * on when the board already has any illustration-bearing cell.
 */
export function defaultIllustModeOn(cells: BoardStateCell[]): boolean {
  return cells.some((c) => !!c.illustrationPath)
}
