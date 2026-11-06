import type { CreateTemplateRequest, UpdateCellsRequest } from '../../../shared/types'
import { CELL_TITLE_MAX_LEN } from '../middleware/validate'

export type ParseResult<T> = { ok: true; value: T } | { ok: false; error: string }
type CellWrite = UpdateCellsRequest['cells'][number]
type TemplateFields = Partial<Pick<CreateTemplateRequest, 'title' | 'description'>> & { category?: string }
type TemplateWrite = TemplateFields & Pick<CreateTemplateRequest, 'gridSize' | 'cells'> & { title: string }

export function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

export function parseCells(
  input: unknown,
  options: { gridSize: number; complete: boolean },
): ParseResult<CellWrite[]> {
  const total = options.gridSize * options.gridSize
  if (!Array.isArray(input) || (options.complete && input.length !== total) || input.length > total) {
    return { ok: false, error: options.complete ? `cells 数量必须等于 gridSize² (${total})` : 'cells 必须为有效格子数组' }
  }
  const positions = new Set<number>()
  const titles = new Set<string>()
  const cells: CellWrite[] = []
  for (const cell of input) {
    if (!isObject(cell)) return { ok: false, error: '格子必须为对象' }
    const { position, title, illustrationPath, completed } = cell
    if (typeof position !== 'number' || !Number.isInteger(position) || position < 0 || position >= total) {
      return { ok: false, error: `格子位置必须在 0~${total - 1} 之间` }
    }
    if (positions.has(position)) return { ok: false, error: '格子位置不能重复' }
    positions.add(position)
    if (typeof title !== 'string') return { ok: false, error: '格子标题必须为字符串' }
    if (title.length > CELL_TITLE_MAX_LEN) return { ok: false, error: `格子标题不能超过 ${CELL_TITLE_MAX_LEN} 字符` }
    if (illustrationPath !== undefined && typeof illustrationPath !== 'string') return { ok: false, error: '插画路径必须为字符串' }
    if (completed !== undefined && typeof completed !== 'boolean') return { ok: false, error: 'completed 必须为布尔值' }
    const normalizedTitle = options.complete ? title.trim() : title
    if (options.complete) {
      if (!normalizedTitle) return { ok: false, error: '所有格子都必须填写词语' }
      if (titles.has(normalizedTitle)) return { ok: false, error: `存在重复词语：${normalizedTitle}` }
      titles.add(normalizedTitle)
    }
    cells.push({ position, title: normalizedTitle, illustrationPath, completed })
  }
  return { ok: true, value: cells }
}

function parseTemplateFields(input: Record<string, unknown>): ParseResult<TemplateFields> {
  const fields: TemplateFields = {}
  if (input.title !== undefined) {
    if (typeof input.title !== 'string' || !input.title.trim()) return { ok: false, error: '标题不能为空且必须为字符串' }
    if (input.title.trim().length > 30) return { ok: false, error: '标题长度不能超过 30 字符' }
    fields.title = input.title.trim()
  }
  if (input.description !== undefined) {
    if (typeof input.description !== 'string') return { ok: false, error: '描述必须为字符串' }
    if (input.description.length > 100) return { ok: false, error: '描述长度不能超过 100 字符' }
    fields.description = input.description.trim()
  }
  if (input.category !== undefined) {
    if (typeof input.category !== 'string') return { ok: false, error: 'category 必须为字符串' }
    fields.category = input.category
  }
  return { ok: true, value: fields }
}

export function parseTemplateCreate(input: unknown): ParseResult<TemplateWrite> {
  if (!isObject(input)) return { ok: false, error: '请求必须为对象' }
  const fields = parseTemplateFields(input)
  if (!fields.ok) return fields
  if (fields.value.title === undefined) return { ok: false, error: '标题不能为空' }
  const { gridSize } = input
  if (typeof gridSize !== 'number' || !Number.isInteger(gridSize) || gridSize < 3 || gridSize > 6) {
    return { ok: false, error: 'gridSize 必须为 3~6 之间的整数' }
  }
  const cells = parseCells(input.cells, { gridSize, complete: true })
  if (!cells.ok) return cells
  return { ok: true, value: { ...fields.value, title: fields.value.title, gridSize, cells: cells.value } }
}

export function parseTemplateUpdate(input: unknown, gridSize: number): ParseResult<TemplateFields & { cells?: TemplateWrite['cells'] }> {
  if (!isObject(input)) return { ok: false, error: '请求必须为对象' }
  const fields = parseTemplateFields(input)
  if (!fields.ok) return fields
  if (input.cells === undefined) return fields
  const cells = parseCells(input.cells, { gridSize, complete: true })
  if (!cells.ok) return cells
  return { ok: true, value: { ...fields.value, cells: cells.value } }
}

export function parseGeneratedTemplate(input: unknown): ParseResult<TemplateWrite> {
  if (!isObject(input)) return { ok: false, error: '请求必须为对象' }
  if (!Array.isArray(input.words) || input.words.length !== 25) return { ok: false, error: '必须选择 25 个词语' }
  return parseTemplateCreate({
    ...input,
    gridSize: 5,
    cells: input.words.map((title, position) => ({ position, title })),
  })
}
