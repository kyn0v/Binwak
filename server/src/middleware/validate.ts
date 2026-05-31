import { Request, Response, NextFunction } from 'express'

/**
 * Route param :id validation middleware.
 * Returns 400 on parseInt failure to prevent NaN in SQL.
 */
export function validateIdParam(req: Request, res: Response, next: NextFunction): void {
  const raw = req.params.id
  const id = Number(raw)
  if (!Number.isInteger(id) || id <= 0) {
    res.status(400).json({ success: false, error: '无效的 ID 参数' })
    return
  }
  next()
}

// ── Theme whitelist ──
const VALID_THEMES = new Set(['mono'])

export function isValidTheme(theme: unknown): theme is string {
  return typeof theme === 'string' && VALID_THEMES.has(theme)
}

// ── Template category whitelist ──
const VALID_CATEGORIES = new Set(['creative', 'nicetry'])

export function isValidCategory(category: unknown): category is string {
  return typeof category === 'string' && VALID_CATEGORIES.has(category)
}

/**
 * Escape SQL LIKE wildcards to prevent search injection
 */
export function escapeLikePattern(s: string): string {
  return s.replace(/[%_\\]/g, '\\$&')
}

// ── Cell title max length (shared by cell titles & word bank) ──
export const CELL_TITLE_MAX_LEN = 50
/** @deprecated Use CELL_TITLE_MAX_LEN instead */
export const WORD_MAX_LEN = CELL_TITLE_MAX_LEN
