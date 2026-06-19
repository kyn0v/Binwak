import { describe, it, expect } from 'vitest'
import { getBoardState, defaultIllustModeOn, type BoardStateCell } from '../src/pages/index/boardState'

describe('getBoardState', () => {
  it('returns "empty" when no cell has a title or image', () => {
    const cells: BoardStateCell[] = [{}, { title: '' }, { title: '   ' }]
    expect(getBoardState(cells)).toBe('empty')
  })

  it('returns "words-only" when a cell has a non-blank title but no image', () => {
    const cells: BoardStateCell[] = [{ title: '   ' }, { title: '咖啡店' }]
    expect(getBoardState(cells)).toBe('words-only')
  })

  it('returns "has-images" when any cell has a photo, regardless of titles', () => {
    const cells: BoardStateCell[] = [{ title: '咖啡店' }, { title: '涂鸦墙', imagePath: '/tmp/a.jpg' }]
    expect(getBoardState(cells)).toBe('has-images')
  })

  it('prioritizes images over words', () => {
    expect(getBoardState([{ title: 'x', imagePath: 'p' }])).toBe('has-images')
  })

  it('treats whitespace-only titles as blank', () => {
    expect(getBoardState([{ title: '\t\n ' }])).toBe('empty')
  })
})

describe('defaultIllustModeOn', () => {
  it('is true when any cell has an illustration', () => {
    expect(defaultIllustModeOn([{ title: 'a' }, { illustrationPath: 'illustrations/u1/x.jpg' }])).toBe(true)
  })

  it('is false when no cell has an illustration', () => {
    expect(defaultIllustModeOn([{ title: 'a' }, { imagePath: 'p' }])).toBe(false)
  })

  it('is false for an empty board', () => {
    expect(defaultIllustModeOn([])).toBe(false)
  })
})
