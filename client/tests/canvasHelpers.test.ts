import { describe, it, expect } from 'vitest'
import { roundRect, wrapText } from '../src/pages/index/cardStyles/helpers'

// ── roundRect ──
//
// roundRect only issues path commands (no fill/stroke). We record the calls on a
// mock ctx and assert the geometry, including the radius clamp that makes the
// consolidated helper safe for every caller (radius never exceeds half the
// smaller side).

type Call = { fn: string; args: number[] }

function makeCtx() {
  const calls: Call[] = []
  const rec = (fn: string) => (...args: number[]) => { calls.push({ fn, args }) }
  return {
    calls,
    beginPath: rec('beginPath'),
    moveTo: rec('moveTo'),
    lineTo: rec('lineTo'),
    arcTo: rec('arcTo'),
    closePath: rec('closePath'),
  }
}

describe('roundRect', () => {
  it('emits a closed rounded-rect path with the expected corner radius', () => {
    const ctx = makeCtx()
    roundRect(ctx as any, 0, 0, 100, 80, 10)

    // Path is opened and closed exactly once.
    expect(ctx.calls.filter((c) => c.fn === 'beginPath')).toHaveLength(1)
    expect(ctx.calls.filter((c) => c.fn === 'closePath')).toHaveLength(1)
    // Four rounded corners → four arcTo calls.
    expect(ctx.calls.filter((c) => c.fn === 'arcTo')).toHaveLength(4)
    // First moveTo starts at (x + r, y) = (10, 0).
    const move = ctx.calls.find((c) => c.fn === 'moveTo')!
    expect(move.args).toEqual([10, 0])
    // Every arcTo uses the un-clamped radius 10 here (10 <= 100/2 and 80/2).
    for (const c of ctx.calls.filter((c) => c.fn === 'arcTo')) {
      expect(c.args[c.args.length - 1]).toBe(10)
    }
  })

  it('clamps the radius to half the smaller side (prevents arc overflow)', () => {
    const ctx = makeCtx()
    // r (50) exceeds h/2 (15) → must clamp to 15.
    roundRect(ctx as any, 0, 0, 100, 30, 50)

    const expected = Math.min(50, 100 / 2, 30 / 2) // 15
    const move = ctx.calls.find((c) => c.fn === 'moveTo')!
    expect(move.args).toEqual([expected, 0]) // (x + cr, y)
    for (const c of ctx.calls.filter((c) => c.fn === 'arcTo')) {
      expect(c.args[c.args.length - 1]).toBe(expected)
    }
  })

  it('does not clamp when the radius already fits', () => {
    const ctx = makeCtx()
    roundRect(ctx as any, 0, 0, 220, 220, 32) // export worst-case: 32 < 110
    const move = ctx.calls.find((c) => c.fn === 'moveTo')!
    expect(move.args).toEqual([32, 0])
  })
})

// ── wrapText ──
//
// Mock measureText so 1 char == 10px wide. This makes line widths deterministic
// without a real canvas.

function makeTextCtx(charWidth = 10) {
  return {
    measureText: (s: string) => ({ width: s.length * charWidth }),
  }
}

describe('wrapText', () => {
  it('keeps short text on a single line', () => {
    const ctx = makeTextCtx()
    expect(wrapText(ctx as any, 'abc', 100)).toEqual(['abc'])
  })

  it('wraps text onto multiple lines at the width boundary', () => {
    const ctx = makeTextCtx() // 10px/char
    // maxWidth 30 → 3 chars per line.
    expect(wrapText(ctx as any, 'abcdef', 30, 3)).toEqual(['abc', 'def'])
  })

  it('truncates the last line with an ellipsis when exceeding maxLines', () => {
    const ctx = makeTextCtx() // 10px/char
    // maxWidth 20 → 2 chars/line; maxLines 2 → only 4 chars fit, rest elided.
    const out = wrapText(ctx as any, 'abcdefgh', 20, 2)
    expect(out).toHaveLength(2)
    expect(out[0]).toBe('ab')
    // Last line is trimmed so that "<text>…" still fits within 20px (2 chars).
    expect(out[1].endsWith('…')).toBe(true)
    expect(ctx.measureText(out[1]).width).toBeLessThanOrEqual(20)
  })

  it('respects a custom maxLines', () => {
    const ctx = makeTextCtx()
    const out = wrapText(ctx as any, 'aaabbbcccddd', 30, 1)
    expect(out).toHaveLength(1)
    expect(out[0].endsWith('…')).toBe(true)
  })
})
