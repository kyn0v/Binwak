import { ref, computed } from 'vue'

export interface Theme {
  id: string
  name: string
  pageBg: string
  cellBg: string
  textColor: string
  hintColor: string
  borderColor: string
  menuBg: string
  menuBorder: string
  btnBg: string
  btnColor: string
  btnBorder: string
  ghostBg: string
  ghostColor: string
  ghostBorder: string
  ringColor: string
  accentColor: string
  subtitleColor: string
  /** completed cell tint */
  completedCellBg: string
  /** check icon color */
  checkColor: string
  /** cell border style */
  cellBorderStyle: string
  cellBorderWidth: string
  cellBorderRadius: string
  /** gradient button background */
  btnGradient: string
  /** gradient panel background */
  panelGradient: string
  /** skeleton shimmer base color */
  skeletonBg: string
  /** settings button */
  settingsBg: string
  settingsColor: string
  /** for canvas export */
  canvasBg: string
  canvasCellBg: string
  canvasTextColor: string
  canvasLabelBg: string
  canvasLabelColor: string
}

export const THEMES: Theme[] = [
  {
    id: 'mono',
    name: '极简',
    pageBg: 'linear-gradient(160deg, #f5f5f5 0%, #fafafa 60%, #f0f0f0 100%)',
    cellBg: '#ffffff',
    textColor: '#222222',
    hintColor: '#999999',
    borderColor: '#d0d0d0',
    menuBg: '#ffffff',
    menuBorder: '#d0d0d0',
    btnBg: '#333333',
    btnColor: '#ffffff',
    btnBorder: '#333333',
    ghostBg: '#ffffff',
    ghostColor: '#222222',
    ghostBorder: '#d0d0d0',
    ringColor: 'rgba(220, 60, 60, 0.7)',
    accentColor: '#666666',
    subtitleColor: '#999999',
    completedCellBg: '#e8e8e8',
    checkColor: '#34c759',
    cellBorderStyle: 'solid',
    cellBorderWidth: '4rpx',
    cellBorderRadius: '16rpx',
    btnGradient: 'linear-gradient(135deg, #333333 0%, #555555 100%)',
    panelGradient: 'linear-gradient(102deg, #f5f5f5 7%, #fafafa 95%)',
    skeletonBg: '#e0e0e0',
    settingsBg: '#e0e0e0',
    settingsColor: '#666666',
    canvasBg: '#f5f5f5',
    canvasCellBg: '#ffffff',
    canvasTextColor: '#222222',
    canvasLabelBg: 'rgba(255,255,255,0.85)',
    canvasLabelColor: '#222222',
  },
]

import { STORAGE_KEYS } from '@/config/storageKeys'
import { safeGet, safeSet } from '@/utils/safeStorage'

const THEME_KEY = STORAGE_KEYS.THEME

const currentThemeId = ref('mono')

export function useTheme() {
  const theme = computed(() => THEMES.find(t => t.id === currentThemeId.value) || THEMES[0])

  function loadTheme() {
    const saved = safeGet<string>(THEME_KEY)
    if (saved && THEMES.some(t => t.id === saved)) {
      currentThemeId.value = saved
    }
  }

  function setTheme(id: string) {
    if (!THEMES.some(t => t.id === id)) return
    currentThemeId.value = id
    safeSet(THEME_KEY, id)
  }

  function getThemeStyle() {
    const t = theme.value
    return {
      '--page-bg': t.pageBg,
      '--cell-bg': t.cellBg,
      '--text-color': t.textColor,
      '--hint-color': t.hintColor,
      '--border-color': t.borderColor,
      '--menu-bg': t.menuBg,
      '--menu-border': t.menuBorder,
      '--btn-bg': t.btnBg,
      '--btn-color': t.btnColor,
      '--ghost-bg': t.ghostBg,
      '--ghost-color': t.ghostColor,
      '--ghost-border': t.ghostBorder,
      '--ring-color': t.ringColor,
      '--accent-color': t.accentColor,
      '--subtitle-color': t.subtitleColor,
      '--completed-cell-bg': t.completedCellBg,
      '--check-color': t.checkColor,
      '--cell-border-style': t.cellBorderStyle,
      '--cell-border-width': t.cellBorderWidth,
      '--cell-border-radius': t.cellBorderRadius,
      '--btn-gradient': t.btnGradient,
      '--panel-gradient': t.panelGradient,
      '--skeleton-bg': t.skeletonBg,
      '--settings-bg': t.settingsBg,
      '--settings-color': t.settingsColor,
      '--canvas-bg': t.canvasBg,
      '--canvas-cell-bg': t.canvasCellBg,
      '--canvas-text-color': t.canvasTextColor,
    } as Record<string, string>
  }

  return {
    theme,
    currentThemeId,
    loadTheme,
    setTheme,
    getThemeStyle,
    themes: THEMES,
  }
}
