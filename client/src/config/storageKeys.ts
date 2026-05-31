/** Centralized localStorage key management */

export const STORAGE_KEYS = {
  // Auth
  AUTH_TOKEN: 'binwak-auth-token',
  REFRESH_TOKEN: 'binwak-auth-refresh-token',

  // Bingo board
  BINGO_STATE: 'binwak-bingo-state',
  BOARD_TITLE: 'binwak-board-title',
  REMOTE_BOARD_ID: 'binwak-remote-board-id',
  GRID_SIZE: 'binwak-bingo-grid-size',

  // Preferences
  THEME: 'binwak-bingo-theme',
  WORD_BANK: 'binwak-bingo-word-bank',
  ILLUST_MODE_PREFIX: 'binwak-illust-mode-',
  IMAGE_MODE: 'binwak-image-mode',

  // UI state
  PHOTO_NOTICE_SHOWN: 'binwak-photo-notice-shown',
  ONBOARDED: 'binwak-onboarded',
  NICKNAME: 'binwak-nickname',
} as const
