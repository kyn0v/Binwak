import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { useMilestoneToast } from '../src/pages/index/useMilestoneToast'

describe('useMilestoneToast', () => {
  beforeEach(() => { vi.useFakeTimers() })
  afterEach(() => { vi.useRealTimers() })

  it('shows a toast then auto-dismisses (visible → exiting → cleared)', () => {
    const m = useMilestoneToast()
    expect(m.milestoneToast.value).toBeNull()

    m.showMilestone('📋', '已复制到剪贴板')
    expect(m.milestoneToast.value).toEqual({ emoji: '📋', msg: '已复制到剪贴板' })
    expect(m.milestoneExiting.value).toBe(false)

    // After the visible window, it starts exiting but is still rendered.
    vi.advanceTimersByTime(2500)
    expect(m.milestoneExiting.value).toBe(true)
    expect(m.milestoneToast.value).not.toBeNull()

    // After the exit animation, it clears.
    vi.advanceTimersByTime(400)
    expect(m.milestoneToast.value).toBeNull()
  })

  it('replacing a toast resets the exiting flag and shows the new payload', () => {
    const m = useMilestoneToast()
    m.showMilestone('🚶', 'first')
    vi.advanceTimersByTime(2500)
    expect(m.milestoneExiting.value).toBe(true)

    // A new toast before the old one cleared resets the exiting state and
    // swaps in the new payload immediately.
    m.showMilestone('🔥', 'second')
    expect(m.milestoneExiting.value).toBe(false)
    expect(m.milestoneToast.value).toEqual({ emoji: '🔥', msg: 'second' })
  })

  it('fires the first-completion milestone exactly once', () => {
    const m = useMilestoneToast()
    m.showProgressToast(1, 16)
    expect(m.milestoneToast.value?.msg).toBe('CityWalk 已启程')

    // Clear and call again at the same count → no re-fire.
    vi.advanceTimersByTime(2900)
    expect(m.milestoneToast.value).toBeNull()
    m.showProgressToast(1, 16)
    expect(m.milestoneToast.value).toBeNull()
  })

  it('fires the halfway milestone when crossing the midpoint', () => {
    const m = useMilestoneToast()
    // total 16 → halfPoint = 8.
    m.showProgressToast(7, 16)
    expect(m.milestoneToast.value).toBeNull()
    m.showProgressToast(8, 16)
    expect(m.milestoneToast.value?.msg).toBe('已过半，继续加油')
  })

  it('does not fire non-milestone counts', () => {
    const m = useMilestoneToast()
    m.showProgressToast(3, 16)
    expect(m.milestoneToast.value).toBeNull()
  })

  it('resetProgressMilestones() re-arms the thresholds', () => {
    const m = useMilestoneToast()
    m.showProgressToast(1, 16)
    expect(m.milestoneToast.value?.msg).toBe('CityWalk 已启程')
    vi.advanceTimersByTime(2900)

    // Without reset, count 1 won't re-fire.
    m.showProgressToast(1, 16)
    expect(m.milestoneToast.value).toBeNull()

    // After reset, it fires again (e.g. a fresh board).
    m.resetProgressMilestones()
    m.showProgressToast(1, 16)
    expect(m.milestoneToast.value?.msg).toBe('CityWalk 已启程')
  })
})
