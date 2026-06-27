/**
 * useMilestoneToast
 *
 * Owns the transient "milestone" toast shown on the home tab (the small banner
 * that slides in for events like "CityWalk 已启程", "已过半", board switches,
 * share/import results, etc.). Encapsulates:
 *  - the toast's reactive state (`milestoneToast`, `milestoneExiting`),
 *  - the auto-dismiss timer (2.5s visible + 0.4s exit animation),
 *  - the progress-milestone thresholds (first completion, halfway) and the
 *    "already shown" bookkeeping that prevents duplicate toasts.
 *
 * Usage:
 *   const { milestoneToast, milestoneExiting,
 *           showMilestone, showProgressToast, resetProgressMilestones } = useMilestoneToast()
 *   // template: <MilestoneToast :toast="milestoneToast" :exiting="milestoneExiting" />
 *   showMilestone('📋', '已复制到剪贴板')
 *   showProgressToast(completedCount.value, totalCount.value)  // after a cell completes
 *   resetProgressMilestones()  // on board switch / create / template apply
 */
import { ref } from 'vue'

export type MilestonePayload = { emoji: string; msg: string }

const VISIBLE_MS = 2500
const EXIT_MS = 400

export function useMilestoneToast() {
  const milestoneToast = ref<MilestonePayload | null>(null)
  const milestoneExiting = ref(false)
  let timer: ReturnType<typeof setTimeout> | null = null
  // Highest progress milestone already shown, to avoid re-showing it.
  let lastMilestoneShown = 0

  /** Show a one-off milestone banner; auto-dismisses after a short delay. */
  function showMilestone(emoji: string, msg: string) {
    if (timer) clearTimeout(timer)
    milestoneExiting.value = false
    milestoneToast.value = { emoji, msg }
    timer = setTimeout(() => {
      milestoneExiting.value = true
      setTimeout(() => { milestoneToast.value = null }, EXIT_MS)
    }, VISIBLE_MS)
  }

  /**
   * Show a progress milestone (first completion, halfway) based on the current
   * completed/total counts. Idempotent: each threshold fires at most once until
   * resetProgressMilestones() is called.
   */
  function showProgressToast(completed: number, total: number) {
    // First completion
    if (completed === 1 && lastMilestoneShown < 1) {
      lastMilestoneShown = 1
      showMilestone('🚶', 'CityWalk 已启程')
      return
    }
    // 50% milestone — trigger when crossing the halfway mark
    const halfPoint = Math.ceil(total / 2)
    if (completed === halfPoint && lastMilestoneShown < halfPoint) {
      lastMilestoneShown = halfPoint
      showMilestone('🔥', '已过半，继续加油')
      return
    }
  }

  /** Reset progress-milestone bookkeeping (e.g. on board switch / new card). */
  function resetProgressMilestones() {
    lastMilestoneShown = 0
  }

  return {
    milestoneToast,
    milestoneExiting,
    showMilestone,
    showProgressToast,
    resetProgressMilestones,
  }
}
