<template>
  <view class="page" :class="{ 'page-edit-mode': isEditMode }" :style="[getThemeStyle(), pageStyle]" @tap="onPageTap">
    <view class="header" :style="headerStyle">
      <!-- Row 1: app title (right side kept clear for the WeChat capsule) -->
      <view class="header-top">
        <view class="title-group">
          <text class="title-art">Binwak🚶</text>
        </view>
      </view>

      <!-- Row 2: subtitle (left) + edit-mode badge (right) -->
      <view class="header-row header-subtitle-row">
        <text class="title-subtitle">「Citywalk Bingo!」</text>
        <text v-if="isEditMode" class="edit-mode-badge">编辑中…</text>
      </view>

      <!-- Row 3: board switcher (left) + illustration-mode toggle (right) -->
      <view class="header-row header-controls-row">
        <view class="board-name-row" @tap.stop="onOpenBoardSwitcher">
          <text class="board-name">{{ boardTitle }}</text>
          <text class="board-name-arrow" :class="{ 'arrow-up': showBoardSwitcher }">▾</text>
          <view v-if="!loggedIn && offlineReason" class="offline-badge" @tap.stop="showOfflineDetail">
            <text class="offline-icon">⚡</text>
            <text class="offline-text">离线</text>
          </view>
          <!-- Board switcher dropdown -->
          <view v-if="showBoardSwitcher" class="board-dropdown" @tap.stop>
            <view class="dropdown-board-item dropdown-action dropdown-action-manage" @tap.stop="goToBoards">
              <text class="dropdown-action-text dropdown-action-text-strong">管理全部卡片 →</text>
            </view>
            <!-- create card (replaces 新建Bingo卡; reuses the size picker) -->
            <view class="dropdown-create-row">
              <view class="dropdown-board-item dropdown-create dropdown-action-top" @tap.stop="showSizePicker = !showSizePicker">
                <text class="dropdown-create-text">创建卡片</text>
                <text class="size-label">{{ gridSize }}×{{ gridSize }}</text>
              </view>
              <view v-if="showSizePicker" class="size-picker">
                <view
                  v-for="s in gridSizeOptions"
                  :key="s"
                  class="size-option"
                  :class="{ 'size-active': s === gridSize }"
                  @tap.stop="onCreateWithSize(s)"
                >
                  <text>{{ s }}×{{ s }}</text>
                </view>
              </view>
            </view>
            <!-- card actions -->
            <view class="dropdown-board-item dropdown-action dropdown-action-top" @tap.stop="onManualEdit">
              <text class="dropdown-action-text">编辑卡片</text>
            </view>
            <view class="dropdown-board-item dropdown-action" @tap.stop="onPreviewCard">
              <text class="dropdown-action-text">预览卡片</text>
            </view>
            <view class="dropdown-board-item dropdown-action" @tap.stop="onOpenSharePanel">
              <text class="dropdown-action-text">分享/应用Bingo码</text>
            </view>
            <view v-if="ENABLE_TEMPLATE_PUBLISHING" class="dropdown-board-item dropdown-action" :class="{ 'dropdown-action-disabled': !!currentPublishedTemplateId }" @tap.stop="onOpenPublishPanel">
              <text class="dropdown-action-text">{{ currentPublishedTemplateId ? '已发布 📤' : '发布到广场' }}</text>
            </view>
          </view>
        </view>
        <view v-if="!isEditMode" class="mode-switch-row" @tap.stop="toggleIllustMode">
          <text class="mode-switch-label">{{ isIllustMode ? '插画模式' : '文本模式' }}</text>
          <view class="ios-switch" :class="{ 'ios-switch-on': isIllustMode }">
            <view class="ios-switch-thumb"></view>
          </view>
        </view>
      </view>

      <!-- Row 4: cell-completion progress + status -->
      <view v-if="!isEditMode && totalCount > 0" class="progress-row">
        <text class="progress-label"><text class="progress-current">{{ completedCount }}</text>/{{ progressTarget }}</text>
        <view class="progress-track">
          <view class="progress-fill" :style="{ width: progressPercent + '%' }"></view>
        </view>
        <text class="progress-status" :class="{ 'progress-status-done': bingoJustCompleted }">{{ bingoJustCompleted ? `已完成 ×${bingoLineCount} 🏆` : '进行中' }}</text>
      </view>
    </view>

    <view class="grid-area">
    <view class="grid" :style="gridStyle">
      <!-- skeleton shimmer during initial load -->
      <template v-if="isLoading">
        <view v-for="n in gridSize * gridSize" :key="`sk-${n}`" class="cell">
          <view class="cell-frame skeleton-cell">
            <view class="skeleton-shimmer"></view>
          </view>
        </view>
      </template>
      <!-- real cells -->
      <template v-else>
      <view
        v-for="(cell, idx) in cells"
        :key="cell.id"
        class="cell"
        :id="`cell-${idx}`"
        @tap="handleCellTap(idx)"
      >
        <view class="cell-frame" :class="{ 'cell-completed': cell.completed && !isEditMode && cell.imagePath }">
          <view class="cell-media">
            <image
              v-if="cell.imagePath && !isEditMode"
              :src="cellResolvedUrls[idx] || cell.imagePath"
              class="cell-photo"
              mode="aspectFill"
            />
            <view
              v-else-if="cell.illustrationPath && isIllustMode && !isEditMode"
              class="cell-illust-fit"
              :class="{ 'cell-illust-grayscale': !cell.completed }"
            >
              <image :src="cell.illustrationPath" class="cell-illust-img" mode="aspectFit" />
            </view>
            <view v-else class="cell-placeholder">
              <text class="cell-text">{{ cell.title || '待设置' }}</text>
            </view>
          </view>
          <view class="cell-border" :class="{ 'cell-border-edit': isEditMode }"></view>
          <view v-if="cell.imagePath && cell.title && !isEditMode" class="cell-label cell-label-photo">
            <text class="cell-label-text">{{ cell.title }}</text>
          </view>
          <view v-else-if="cell.illustrationPath && isIllustMode && cell.title && !isEditMode" class="cell-label cell-label-illust">
            <text class="cell-label-text cell-label-text-illust">{{ cell.title }}</text>
          </view>
          <view v-if="cell.completed && !isEditMode && !cell.imagePath" class="cell-check">
            <text class="cell-check-icon">✓</text>
          </view>
        </view>
      </view>
      </template>
    </view>
    </view>

    <!-- Sticky bottom action bar in edit mode -->
    <view v-if="isEditMode" class="edit-bottom-bar">
      <view class="edit-bar-btn ghost-style" @tap="cancelEditMode">← 返回</view>
      <view class="edit-bar-btn primary-style" @tap="exitEditMode">✅ 完成编辑</view>
    </view>

    <!-- Word picker in edit mode -->
    <view v-if="showWordPicker" class="word-picker-overlay" @tap.stop @touchmove.stop.prevent>
      <view class="overlay-backdrop" @tap="closeWordPicker"></view>
      <view class="word-picker-panel" @tap.stop>
        <view class="panel-header">
          <text class="panel-title">选择词语</text>
          <view class="close-icon" @tap="closeWordPicker">✕</view>
        </view>
        <input v-model="wordSearch" class="word-search" placeholder="搜索词库" />
        <view class="picker-add">
          <textarea v-model="pickerNewWord" class="bank-input bank-textarea" maxlength="30" placeholder="添加新词并选择" :auto-height="true" />
          <view class="add-icon" @tap="addAndAssignWord">+</view>
        </view>
        <scroll-view scroll-y class="word-picker-list" @touchmove.stop>
          <view
            v-for="(word, idx) in filteredWordBank"
            :key="`picker-${word}-${idx}`"
            class="word-picker-item"
            @click="assignWordToTarget(word)"
          >
            <text>{{ word }}</text>
          </view>
        </scroll-view>
      </view>
    </view>

    <BingoCelebration
      :show="showBingo"
      :is-all-done="isAllDone"
      :bingo-line-count="bingoLineCount"
      :current-published-template-id="currentPublishedTemplateId"
      @dismiss="dismissBingo"
      @preview="onBingoPreview"
      @share="onBingoShare"
      @publish="onBingoPublish"
    />

    <MilestoneToast :toast="milestoneToast" :exiting="milestoneExiting" />

    <!-- Photo privacy notice modal -->
    <view v-if="showPhotoNotice" class="word-editor-overlay" @tap.stop>
      <view class="overlay-backdrop" @tap="onPhotoNoticeCancel"></view>
      <view class="photo-notice-panel" @tap.stop>
        <view class="photo-notice-icon">📷</view>
        <view class="photo-notice-title">照片提示</view>
        <view class="photo-notice-content">
          打卡照片仅你可见，不会公开展示。请勿上传包含敏感信息的照片。
        </view>
        <view class="photo-notice-checkbox" @tap="photoNoticeDontShow = !photoNoticeDontShow">
          <view :class="['checkbox-icon', photoNoticeDontShow && 'checked']">
            <text v-if="photoNoticeDontShow">✓</text>
          </view>
          <text class="checkbox-label">不再提示</text>
        </view>
        <view class="photo-notice-actions">
          <button class="photo-notice-btn cancel" @tap="onPhotoNoticeCancel">取消</button>
          <button class="photo-notice-btn confirm" @tap="onPhotoNoticeConfirm">我知道了</button>
        </view>
      </view>
    </view>

    <!-- Share code panel -->
    <view v-if="showSharePanel" class="word-editor-overlay" @tap.stop>
      <view class="overlay-backdrop" @tap="closeSharePanel"></view>
      <view class="share-panel" @tap.stop>
        <view class="panel-header">
          <text class="panel-title">分享/应用Bingo码</text>
          <view class="close-icon" @tap="closeSharePanel">✕</view>
        </view>
        <view class="share-desc">复制Bingo码分享给朋友，或粘贴别人的码来导入挑战词</view>
        <view class="share-section">
          <text class="share-label">我的Bingo码</text>
          <view class="share-row">
            <input class="bank-input share-input" :value="shareCodeText" disabled />
            <button class="btn-sm primary-btn" size="mini" plain hover-class="none" @tap="onCopyShareCode">复制</button>
          </view>
        </view>
        <view class="share-section">
          <text class="share-label">应用Bingo码</text>
          <view class="share-row">
            <input class="bank-input share-input" v-model="importCodeText" :maxlength="-1" placeholder="粘贴Bingo码" />
            <button class="btn-sm primary-btn" size="mini" plain hover-class="none" @tap="onApplyShareCode">应用</button>
          </view>
        </view>
      </view>
    </view>
  </view>

  <!-- Cell gallery preview -->
  <view v-if="cellPreviewIndex >= 0" class="preview-overlay" @tap="closeCellPreview">
    <!-- Left arrow -->
    <view
      class="preview-arrow preview-arrow-left"
      @tap.stop="prevPreview"
    >‹</view>
    <!-- Right arrow -->
    <view
      class="preview-arrow preview-arrow-right"
      @tap.stop="nextPreview"
    >›</view>

    <swiper
      class="preview-swiper"
      :current="cellPreviewIndex"
      circular
      @change="onPreviewSwiperChange"
      @tap.stop
    >
      <swiper-item v-for="(cell, idx) in cells" :key="idx">
        <view class="preview-swiper-item" @tap.stop>
          <!-- Has photo + has illustration: tap to toggle -->
          <view
            v-if="cell.imagePath && cell.illustrationPath && isIllustMode"
            class="polaroid-card"
            @tap.stop="flipCard(idx)"
          >
            <view class="polaroid-photo" :style="polaroidPhotoStyle">
              <image
                :src="flippedCells[idx] ? cell.illustrationPath : (cellResolvedUrls[idx] || cell.imagePath)"
                class="polaroid-image"
                mode="aspectFill"
              />
            </view>
            <view class="polaroid-footer">
              <text class="polaroid-title">{{ cell.title }}</text>
              <text class="polaroid-watermark">@binwak</text>
            </view>
            <view class="toggle-hint">
              <text class="toggle-hint-text">{{ flippedCells[idx] ? '📷 点击看照片' : '🎨 点击看插画' }}</text>
            </view>
          </view>
          <!-- Photo only: regular card -->
          <view v-else-if="cell.imagePath" class="polaroid-card">
            <view class="polaroid-photo" :style="polaroidPhotoStyle">
              <image :src="cellResolvedUrls[idx] || cell.imagePath" class="polaroid-image" mode="aspectFill" />
            </view>
            <view class="polaroid-footer">
              <text class="polaroid-title">{{ cell.title }}</text>
              <text class="polaroid-watermark">@binwak</text>
            </view>
          </view>
          <!-- Illustration only -->
          <view v-else-if="cell.illustrationPath && isIllustMode" class="polaroid-card">
            <view class="polaroid-photo" :style="polaroidPhotoStyle">
              <image :src="cell.illustrationPath" class="polaroid-image" mode="aspectFit" />
            </view>
            <view class="polaroid-footer">
              <text class="polaroid-title">{{ cell.title }}</text>
              <text class="polaroid-watermark">@binwak</text>
            </view>
          </view>
          <!-- No image: undeveloped polaroid -->
          <view v-else class="polaroid-card">
            <view class="unexposed-film">
              <text class="unexposed-title">{{ cell.title }}</text>
            </view>
            <view class="polaroid-footer">
              <text class="polaroid-watermark">@binwak</text>
            </view>
          </view>
        </view>
      </swiper-item>
    </swiper>
    <text class="preview-indicator">{{ cellPreviewIndex + 1 }} / {{ cells.length }}</text>
    <view class="polaroid-close" @tap="closeCellPreview">✕</view>
  </view>

  <!-- Bingo card preview -->
  <view v-if="previewImagePath" class="preview-overlay" @tap="closePreview">
    <view class="card-preview-container" @tap.stop>
      <view class="card-preview-close" @tap="closePreview">✕</view>
      <image :src="previewImagePath" class="card-preview-image" mode="widthFix" />
    </view>
    <view class="polaroid-actions">
      <view class="polaroid-action-btn polaroid-action-save" @tap="previewToSave">保存到相册</view>
    </view>
  </view>

  <!-- Bingo board switcher -->
  <!-- Board switcher overlay (tap outside to close) -->
  <view v-if="showBoardSwitcher" class="board-switcher-overlay" @tap="closeBoardSwitcher"></view>

</template>

<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import { onShow } from '@dcloudio/uni-app'
import BingoCelebration from './BingoCelebration.vue'
import MilestoneToast from './MilestoneToast.vue'

const props = withDefaults(defineProps<{ capsuleTop?: number; capsuleRightRpx?: number }>(), { capsuleTop: 0, capsuleRightRpx: 24 })
import { useBingoBoard, GRID_SIZE_OPTIONS } from './useBingoBoard'
import { useWordBank } from './useWordBank'
import { useTheme, THEMES } from './useTheme'
import { buildShareCode, parseShareCode, copyShareCodeToClipboard } from './shareCode'
import { chooseSquareImage, prepareImageForUpload, saveImage } from './imageTools'
import { useCanvasExport, preWarmLocalPaths } from './useCanvasExport'
import { useCardStyle } from './cardStyles'
import { useAuth } from './useAuth'
import { useSync, defaultBoardTitle } from './useSync'
import { deleteBoard, resolveApiUrl, matchIllustrations, getProfile } from './api'
import { usePrivateImage } from './usePrivateImage'
import { getBoardState as boardStateOf, defaultIllustModeOn } from './boardState'
import { STORAGE_KEYS } from '@/config/storageKeys'
import { ENABLE_TEMPLATE_PUBLISHING } from '@/config/features'
import { safeGet, safeSet, safeRemove } from '@/utils/safeStorage'

// ── state ──
const isLoading = ref(true)
const isEditMode = ref(false)
const showSizePicker = ref(false)
const showWordPicker = ref(false)
const manualAssignTarget = ref<number | null>(null)
const wordSearch = ref('')
const pickerNewWord = ref('')
const showSharePanel = ref(false)
const shareCodeText = ref('')
const importCodeText = ref('')
const isActionSheetOpen = ref(false)
// Resolved presigned URLs keyed by cell position
const cellResolvedUrls = ref<Record<number, string>>({})
const isPickingImage = ref(false)
const cellPreviewIndex = ref(-1)


// Illustration mode — per-board preference
const ILLUST_MODE_PREFIX = STORAGE_KEYS.ILLUST_MODE_PREFIX
const isIllustMode = ref(false)
const illustLoading = ref(false)

function illustModeKey() {
  const bid = remoteBoardId.value
  return bid ? `${ILLUST_MODE_PREFIX}${bid}` : ''
}

function loadIllustMode() {
  const key = illustModeKey()
  if (!key) {
    isIllustMode.value = false
    return
  }
  const stored = safeGet(key)
  if (stored === undefined) {
    // No explicit preference yet: default ON if the board has any illustration-bearing cells
    isIllustMode.value = defaultIllustModeOn(cells.value)
  } else {
    isIllustMode.value = !!stored
  }
}

async function toggleIllustMode() {
  const wantIllust = !isIllustMode.value
  isIllustMode.value = wantIllust
  const key = illustModeKey()
  if (key) safeSet(key, wantIllust)

  if (wantIllust) {
    const ok = await autoPopulateIllustrations()
    if (!ok) {
      // Fetch failed → fall back to text mode
      isIllustMode.value = false
      if (key) safeSet(key, false)
      return
    }
    // No matching illustrations at all → toast and fall back
    const hasAny = cells.value.some(c => c.illustrationPath)
    if (!hasAny) {
      uni.showToast({ title: '当前词语暂无匹配插画', icon: 'none' })
      isIllustMode.value = false
      if (key) safeSet(key, false)
    }
  }
}

// Photo privacy notice
const showPhotoNotice = ref(false)
const photoNoticeDontShow = ref(false)
let photoNoticeResolve: ((confirmed: boolean) => void) | null = null

// Publish template
const currentPublishedTemplateId = ref<number | null>(null)

const { loggedIn, offlineReason, ensureLoggedIn } = useAuth()
const { resolveUrl: resolvePrivateUrl, prefetchUrls } = usePrivateImage()
const {
  syncing,
  lastSyncError,
  initialSync,
  pushCells,
  pushComplete,
  pushWordBank,
  fetchBoards,
  createAndSwitchBoard,
  remoteBoardId,
  getBoardSequenceNumber,
  reloadActiveBoard,
  renameBoard,
  removeBoard,
} = useSync()

const { theme, currentThemeId, loadTheme, setTheme, getThemeStyle, themes } = useTheme()

const {
  currentCardStyleId,
  getCardStyle,
  setCardStyle,
} = useCardStyle()

const polaroidPhotoStyle = computed(() => ({
  background: theme.value.canvasCellBg,
}))

const {
  gridSize,
  cells,
  boardTitle,
  showBingo,
  bingoLineCount,
  bingoLineIndices,
  centerIndex,
  completedCount,
  totalCount,
  progressTarget,
  bingoJustCompleted,
  isAllDone,
  loadState,
  persistState,
  checkBingo,
  dismissBingo,
  applyTitles,
  clearTitles,
  changeGridSize,
  isLoadingFromRemote,
  loadBoardTitle,
} = useBingoBoard()

const {
  previewImagePath,
  previewCard: _previewCard,
  closePreview,
  previewToSave,
} = useCanvasExport(gridSize, cells, theme, boardTitle, getCardStyle, getBoardSequenceNumber, isIllustMode)

const {
  wordBank,
  loadWordBank,
  addWord,
  mergeWords,
} = useWordBank()

// Board switcher state
const showBoardSwitcher = ref(false)

const hasOverlay = computed(() =>
  showWordPicker.value
  || showSharePanel.value
  || showBingo.value
  || showBoardSwitcher.value
  || cellPreviewIndex.value >= 0
)

const gridSizeOptions = GRID_SIZE_OPTIONS

// Dynamic grid spacing based on grid size
const gridLayoutStyle = computed(() => {
  const n = gridSize.value
  const gap = n <= 3 ? 14 : n <= 4 ? 10 : n <= 5 ? 8 : 6
  const sidePad = n <= 3 ? 32 : n <= 4 ? 24 : n <= 5 ? 16 : 12
  const topPad = 0
  // Text sizes: scale down as grid grows
  const cellText = n <= 3 ? 28 : n <= 4 ? 24 : n <= 5 ? 20 : 18
  const labelText = n <= 3 ? 22 : n <= 4 ? 20 : n <= 5 ? 18 : 16
  const illustText = n <= 3 ? 22 : n <= 4 ? 20 : n <= 5 ? 18 : 16
  const illustPad = n <= 3 ? 10 : n <= 4 ? 8 : n <= 5 ? 6 : 4
  return { gap, sidePad, topPad, cellText, labelText, illustText, illustPad }
})

const pageStyle = computed(() => {
  const { sidePad } = gridLayoutStyle.value
  return { padding: `0 ${sidePad}rpx 0` }
})

const headerStyle = computed(() => {
  // Header lives in the normal flex flow (not fixed), so the grid-area below it
  // is positioned by the layout engine — no manual offset constant needed. Only
  // the top inset for the status bar + WeChat capsule must be reserved here,
  // since that value isn't available to CSS.
  return {
    paddingTop: `${props.capsuleTop}px`,
  }
})



const gridStyle = computed(() => {
  const { gap, topPad, cellText, labelText, illustText, illustPad } = gridLayoutStyle.value
  return {
    'grid-template-columns': `repeat(${gridSize.value}, minmax(0, 1fr))`,
    'gap': `${gap}rpx`,
    '--cell-text-size': `${cellText}rpx`,
    '--label-text-size': `${labelText}rpx`,
    '--illust-text-size': `${illustText}rpx`,
    '--illust-pad': `${illustPad}rpx`,
  }
})

const progressPercent = computed(() => {
  const target = progressTarget.value
  if (target === 0) return 100
  return Math.min(100, Math.round((completedCount.value / target) * 100))
})

const bingoMultiplier = computed(() => {
  const count = bingoLineCount.value
  const labels = ['', '', 'Double', 'Triple', 'Quadra', 'Penta', 'Hexa', 'Hepta', 'Octa', 'Mega', 'Ultra', 'Godlike', 'Beyond Godlike']
  return count >= 2 ? (labels[count] || 'Beyond Godlike') : ''
})

const bingoDescriptor = computed(() => {
  const count = bingoLineCount.value
  const labels = ['', 'Bingo Line!', 'Double!', 'Triple!', 'Quadra!', 'Penta!', 'Hexa!', 'Hepta!', 'Octa!', 'Mega!', 'Ultra!', 'Godlike!', 'Beyond Godlike!']
  return labels[count] || 'Beyond Godlike!'
})

const bingoOrdinal = computed(() => {
  const count = bingoLineCount.value
  if (count <= 0) return ''
  const suffixes = ['th', 'st', 'nd', 'rd']
  const v = count % 100
  const suffix = (v >= 11 && v <= 13) ? 'th' : (suffixes[v % 10] || 'th')
  return `${count}${suffix} line`
})

const filteredWordBank = computed(() => {
  const query = wordSearch.value.trim().toLowerCase()
  if (!query) return wordBank.value
  return wordBank.value.filter((word) => word.toLowerCase().includes(query))
})

/** Set of words currently on the board */
const boardWords = computed(() => {
  const s = new Set<string>()
  for (const c of cells.value) {
    if (c.title) s.add(c.title)
  }
  return s
})

// ── menu ──
// The old settings dropdown is gone; its actions now live in the board
// switcher dropdown. closeMenu() is kept as a thin alias so the many action
// handlers that called it simply close the board switcher (and its size
// picker) instead.
function closeMenu() {
  closeBoardSwitcher()
}

function onPageTap() {
  if (showBoardSwitcher.value) closeBoardSwitcher()
}

// ── board switcher ──
// The dropdown no longer lists boards (管理全部卡片 navigates to the boards
// page instead), so opening it is just a toggle — no server fetch needed.
function onOpenBoardSwitcher() {
  if (!loggedIn.value) {
    uni.showToast({ title: '请先登录', icon: 'none' })
    return
  }
  if (showBoardSwitcher.value) {
    closeBoardSwitcher()
    return
  }
  showBoardSwitcher.value = true
}

function closeBoardSwitcher() {
  showBoardSwitcher.value = false
  showSizePicker.value = false
}

function goToBoards() {
  closeBoardSwitcher()
  uni.navigateTo({ url: '/pages/boards/boards' })
}

// Classify current board: 'empty' | 'words-only' | 'has-images'
function getBoardState(): 'empty' | 'words-only' | 'has-images' {
  return boardStateOf(cells.value)
}

// ── edit mode (manual edit) ──
import type { BingoCell } from './useBingoBoard'
let cellsSnapshot: BingoCell[] | null = null

function onManualEdit() {
  closeMenu()
  // Snapshot the current state so the user can restore it on cancel
  cellsSnapshot = cells.value.map((c) => ({ ...c }))
  isEditMode.value = true
}

function exitEditMode() {
  cellsSnapshot = null
  isEditMode.value = false
}

function cancelEditMode() {
  uni.showModal({
    title: '放弃修改',
    content: '确定要放弃当前的编辑吗？',
    confirmText: '放弃',
    confirmColor: '#b14b3c',
    cancelText: '继续编辑',
    success: (res) => {
      if (!res.confirm) return
      // Restore the snapshot
      if (cellsSnapshot) {
        cells.value.forEach((cell, i) => {
          const snap = cellsSnapshot![i]
          if (snap) {
            cell.title = snap.title
            cell.imagePath = snap.imagePath
            cell.illustrationPath = snap.illustrationPath
            cell.completed = snap.completed
          }
        })
      }
      cellsSnapshot = null
      // Pre-warm restored image URLs for fast preview
      const urls = cells.value
        .flatMap(c => [c.illustrationPath, c.imagePath])
        .filter(Boolean) as string[]
      if (urls.length) preWarmLocalPaths(urls)
      isEditMode.value = false
    },
  })
}

function onChangeGridSize(size: number) {
  closeMenu()
  changeGridSize(size)
  lastMilestoneShown = 0
  showMilestone('🔄', `已切换为 ${size}×${size}`)
}

async function onCreateWithSize(size: number) {
  closeMenu()

  // Check if current board has any real content (photos or completed marks)
  const hasContent = cells.value.some(c => c.imagePath || c.completed)

  const existingBoards = await fetchBoards()
  const existingTitles = existingBoards.map((b: any) => b.title)
  const defaultName = defaultBoardTitle(existingTitles)

  const title = await new Promise<string | null>(resolve => {
    uni.showModal({
      title: '命名 Bingo 卡',
      editable: true,
      placeholderText: '请输入卡片名称',
      content: defaultName,
      success: (res) => resolve(res.confirm ? (res.content?.trim() || defaultName) : null),
      fail: () => resolve(null),
    })
  })
  if (!title) return

  uni.showLoading({ title: '创建中…' })

  // If current board is empty (no photos, no marks), delete it first
  if (!hasContent && remoteBoardId.value) {
    await removeBoard(remoteBoardId.value)
  }

  const result = await createAndSwitchBoard(title, size, currentThemeId.value)
  uni.hideLoading()

  if (result) {
    lastMilestoneShown = 0
    currentPublishedTemplateId.value = null
    if (result.theme && result.theme !== currentThemeId.value) {
      setTheme(result.theme)
    }
    showMilestone('📋', '已创建新Bingo卡')
  } else {
    uni.showToast({ title: '创建失败', icon: 'none' })
  }
}

/** Client-side cache: word → illustrationUrl ('none' means checked-no-illustration) */
const illustCache = new Map<string, string>()
let _illustFetching = false

/**
 * Fetch matching illustrations for current cell words and populate illustrationPath.
 * Returns true if successful (or nothing to fetch), false if API failed.
 */
async function autoPopulateIllustrations(): Promise<boolean> {
  if (_illustFetching) return true // already in progress
  const words = cells.value.map(c => c.title).filter(Boolean)
  if (words.length === 0) return true

  const uncached = words.filter(w => !illustCache.has(w))

  if (uncached.length > 0) {
    _illustFetching = true
    illustLoading.value = true
    try {
      const matches = await matchIllustrations(uncached)
      for (const word of uncached) {
        const info = matches[word]
        illustCache.set(word, info ? info.illustrationUrl : 'none')
      }
    } catch {
      uni.showToast({ title: '插画加载失败，请重试', icon: 'none' })
      _illustFetching = false
      illustLoading.value = false
      return false
    } finally {
      _illustFetching = false
      illustLoading.value = false
    }
  }

  let changed = false
  for (const cell of cells.value) {
    const url = cell.title ? illustCache.get(cell.title) : undefined
    if (url && url !== 'none' && cell.illustrationPath !== url) {
      cell.illustrationPath = url
      changed = true
    }
  }
  if (changed) {
    persistState()
  }
  // Pre-warm canvas local path cache so first preview is fast
  const urlsToWarm = cells.value
    .flatMap(c => [c.illustrationPath, c.imagePath])
    .filter(Boolean) as string[]
  if (urlsToWarm.length) preWarmLocalPaths(urlsToWarm)
  return true
}

// ── word picker (edit mode) ──
function openWordPicker(index: number) {
  manualAssignTarget.value = index
  wordSearch.value = ''
  pickerNewWord.value = ''
  showWordPicker.value = true
  // Pre-fetch illustrations for all word bank words (cache miss only)
  const uncached = wordBank.value.filter(w => !illustCache.has(w))
  if (uncached.length > 0) {
    matchIllustrations(uncached).then(matches => {
      for (const word of uncached) {
        const info = matches[word]
        illustCache.set(word, info ? info.illustrationUrl : 'none')
      }
    }).catch(() => {})
  }
}

function assignWordToTarget(word: string) {
  const targetIndex = manualAssignTarget.value
  if (targetIndex === null) return
  const cell = cells.value[targetIndex]
  if (!cell) return
  cell.title = word
  cell.imagePath = undefined
  cell.illustrationPath = undefined
  cell.completed = false
  showWordPicker.value = false
  manualAssignTarget.value = null
  // Auto-populate illustration for this word
  const cachedUrl = illustCache.get(word)
  if (cachedUrl && cachedUrl !== 'none') {
    cell.illustrationPath = cachedUrl
  } else if (cachedUrl === undefined) {
    // Not yet looked up: call the API and cache the result
    matchIllustrations([word]).then(matches => {
      if (matches[word]) {
        illustCache.set(word, matches[word].illustrationUrl)
        cell.illustrationPath = matches[word].illustrationUrl
        preWarmLocalPaths([matches[word].illustrationUrl])
      } else {
        illustCache.set(word, 'none')
      }
    }).catch(() => {})
  }
}

async function addAndAssignWord() {
  const text = pickerNewWord.value.trim()
  if (!text) {
    uni.showToast({ title: '请输入词语', icon: 'none' })
    return
  }
  const result = await addWord(text)
  if (result === 'moderation_fail') {
    uni.showToast({ title: '内容含违规信息，请修改', icon: 'none' })
    return
  }
  if (result !== 'ok') {
    uni.showToast({ title: result === 'duplicate' ? '该词已存在' : '添加失败', icon: 'none' })
    return
  }
  pickerNewWord.value = ''
  assignWordToTarget(text)
}

function closeWordPicker() {
  showWordPicker.value = false
  manualAssignTarget.value = null
  wordSearch.value = ''
  pickerNewWord.value = ''
}

// ── cell tap ──
async function handleCellTap(index: number) {
  if (showBoardSwitcher.value) { closeBoardSwitcher(); return }
  if (isEditMode.value) {
    openWordPicker(index)
    return
  }

  const cell = cells.value[index]
  if (!cell) return
  if (isActionSheetOpen.value || isPickingImage.value) return
  if (!cell.title) {
    openWordPicker(index)
    return
  }

  if (cell.imagePath) {
    isActionSheetOpen.value = true
    uni.showActionSheet({
      itemList: ['预览照片', '替换照片', '取消标记'],
      success: async (res) => {
        if (res.tapIndex === 0) previewCellImage(index)
        if (res.tapIndex === 1) await pickImage(index)
        if (res.tapIndex === 2) {
          cell.imagePath = undefined
          cell.completed = false
          cellResolvedUrls.value[index] = ''
        }
      },
      complete: () => { isActionSheetOpen.value = false },
    })
    return
  }

  // No image → different options based on completion state
  isActionSheetOpen.value = true
  if (cell.completed) {
    uni.showActionSheet({
      itemList: ['📷 拍照/选图打卡', '❌ 取消标记'],
      success: async (res) => {
        if (res.tapIndex === 0) await pickImage(index)
        if (res.tapIndex === 1) {
          cell.completed = false
          showProgressToast()
        }
      },
      complete: () => { isActionSheetOpen.value = false },
    })
  } else {
    uni.showActionSheet({
      itemList: ['📷 拍照/选图打卡', '✅ 仅标记完成'],
      success: async (res) => {
        if (res.tapIndex === 0) await pickImage(index)
        if (res.tapIndex === 1) {
          cell.completed = true
          showProgressToast()
        }
      },
      complete: () => { isActionSheetOpen.value = false },
    })
  }
}

const PHOTO_NOTICE_KEY = STORAGE_KEYS.PHOTO_NOTICE_SHOWN

async function pickImage(index: number) {
  if (isPickingImage.value) return
  
  // Show privacy notice only in cloud mode (photos are uploaded)
  const imageMode = safeGet(STORAGE_KEYS.IMAGE_MODE) || 'local'
  if (imageMode === 'cloud') {
    const noticeDismissed = safeGet(PHOTO_NOTICE_KEY)
    if (!noticeDismissed) {
      const confirmed = await showPhotoPrivacyNotice()
      if (!confirmed) return
    }
  }
  
  isPickingImage.value = true
  // Haptic feedback
  try { uni.vibrateShort({ type: 'light' }) } catch {}
  try {
    const tempPath = await chooseSquareImage()
    if (!tempPath) return
    const uploadReadyPath = await prepareImageForUpload(tempPath)
    const savedPath = await saveImage(uploadReadyPath)
    const cell = cells.value[index]
    if (!cell) return

    // Upload to server first (moderation check happens server-side)
    // Skip upload in local image mode
    const imageMode = safeGet(STORAGE_KEYS.IMAGE_MODE) || 'local'
    let remoteUrl = ''
    if (imageMode === 'cloud') {
      try {
        const uploaded = await pushComplete(index, savedPath)
        if (uploaded?.url) remoteUrl = resolveApiUrl(uploaded.url)
      } catch (err: any) {
        const msg = err?.message || ''
        if (msg.includes('不合规')) {
          showMilestone('⚠️', '图片内容不合规，请更换图片')
          return
        }
        // Any other upload failure (network/timeout/5xx): the server has no
        // record of this image, so do NOT mark the cell complete with a
        // local-only path — that would silently lose the photo on reload.
        showMilestone('⚠️', '图片上传失败，请检查网络后重试')
        return
      }
    }

    cell.imagePath = remoteUrl || savedPath
    if (cell.imagePath?.startsWith('http')) preWarmLocalPaths([cell.imagePath])
    cellResolvedUrls.value[index] = cell.imagePath
    cell.completed = true
    showProgressToast()
  } finally {
    isPickingImage.value = false
  }
}

function showPhotoPrivacyNotice(): Promise<boolean> {
  return new Promise((resolve) => {
    photoNoticeDontShow.value = false
    photoNoticeResolve = resolve
    showPhotoNotice.value = true
  })
}

function onPhotoNoticeConfirm() {
  if (photoNoticeDontShow.value) {
    safeSet(PHOTO_NOTICE_KEY, true)
  }
  showPhotoNotice.value = false
  if (photoNoticeResolve) {
    photoNoticeResolve(true)
    photoNoticeResolve = null
  }
}

function onPhotoNoticeCancel() {
  showPhotoNotice.value = false
  if (photoNoticeResolve) {
    photoNoticeResolve(false)
    photoNoticeResolve = null
  }
}

// Track last shown milestone to avoid duplicate toasts
let lastMilestoneShown = 0
const milestoneToast = ref<{ emoji: string; msg: string } | null>(null)
const milestoneExiting = ref(false)
let milestoneTimer: ReturnType<typeof setTimeout> | null = null

function showMilestone(emoji: string, msg: string) {
  if (milestoneTimer) clearTimeout(milestoneTimer)
  milestoneExiting.value = false
  milestoneToast.value = { emoji, msg }
  milestoneTimer = setTimeout(() => {
    milestoneExiting.value = true
    setTimeout(() => { milestoneToast.value = null }, 400)
  }, 2500)
}

function showProgressToast() {
  const completed = completedCount.value
  const total = totalCount.value
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

function previewCellImage(index: number) {
  cellPreviewIndex.value = index
  flippedCells.value = {}
}

// Flip state for preview gallery
const flippedCells = ref<Record<number, boolean>>({})

function flipCard(idx: number) {
  flippedCells.value = { ...flippedCells.value, [idx]: !flippedCells.value[idx] }
}

function onPreviewSwiperChange(e: any) {
  cellPreviewIndex.value = e.detail.current
}

function prevPreview() {
  const len = cells.value.length
  cellPreviewIndex.value = (cellPreviewIndex.value - 1 + len) % len
}

function nextPreview() {
  const len = cells.value.length
  cellPreviewIndex.value = (cellPreviewIndex.value + 1) % len
}

function closeCellPreview() {
  cellPreviewIndex.value = -1
  flippedCells.value = {}
}

// ── share / import / reset ──
function onOpenSharePanel() {
  closeMenu()
  const titles = cells.value.map((cell) => cell.title)
  shareCodeText.value = buildShareCode(titles)
  importCodeText.value = ''
  showSharePanel.value = true
}

function closeSharePanel() {
  showSharePanel.value = false
}

// ── publish template ──
function onOpenPublishPanel() {
  closeMenu()

  if (currentPublishedTemplateId.value) {
    uni.showToast({ title: '此卡已发布过模板', icon: 'none' })
    return
  }

  // Check if board has content
  const hasContent = cells.value.some((c) => c.title && c.title.trim())
  if (!hasContent) {
    uni.showToast({ title: '请先填写Bingo卡内容', icon: 'none' })
    return
  }

  // Must have at least one bingo line to publish
  if (bingoLineCount.value <= 0) {
    uni.showModal({
      title: '还差一点点',
      content: '完成至少一条Bingo连线后才能发布哦 🎯',
      showCancel: false,
      confirmText: '我知道了',
    })
    return
  }

  // Default title from board title
  uni.navigateTo({ url: '/pages/publish/publish' })
}

function closePublishPanel() {
  // No longer needed for modal, kept for backward compat
}

async function onTemplatePublished(templateId: number) {
  showMilestone('🎉', '发布成功')
  currentPublishedTemplateId.value = templateId
}

async function onCopyShareCode() {
  await copyShareCodeToClipboard(shareCodeText.value)
  showMilestone('📋', '已复制到剪贴板')
}

async function onApplyShareCode() {
  const code = importCodeText.value.trim()
  if (!code) {
    uni.showToast({ title: '请粘贴分享码', icon: 'none' })
    return
  }
  const parsed = parseShareCode(code)
  if (!parsed) {
    uni.showToast({ title: '分享码无效', icon: 'none' })
    return
  }

  // Prompt for board name first (before any side effects)
  const now = new Date()
  const defaultName = `Bingo ${now.getMonth() + 1}/${now.getDate()}`
  const boardName = await new Promise<string | null>(resolve => {
    uni.showModal({
      title: '命名 Bingo 卡',
      editable: true,
      placeholderText: '请输入卡片名称',
      content: defaultName,
      success: (res) => resolve(res.confirm ? (res.content?.trim() || defaultName) : null),
      fail: () => resolve(null),
    })
  })
  if (!boardName) return

  const mergeResult = await mergeWords(parsed.titles)
  if (mergeResult.blocked) {
    showMilestone('⚠️', '分享码含违规内容，已拒绝')
    return
  }

  closeSharePanel()

  // Empty board → apply directly and rename
  const state = getBoardState()
  if (state === 'empty') {
    if (parsed.gridSize !== gridSize.value) {
      changeGridSize(parsed.gridSize)
    }
    applyTitles(parsed.titles)
    pushWordBank(wordBank.value)
    const boards = await fetchBoards()
    const active = boards.find((b: any) => b.isActive)
    if (active) {
      await renameBoard(active.id, boardName)
    }
    showMilestone('📋', '已应用Bingo码')
    return
  }

  // Non-empty → create new board
  uni.showLoading({ title: '创建中…' })
  const result = await createAndSwitchBoard(
    boardName,
    parsed.gridSize,
    currentThemeId.value,
  )
  uni.hideLoading()

  if (!result) {
    uni.showToast({ title: '创建失败', icon: 'none' })
    return
  }

  lastMilestoneShown = 0
  currentPublishedTemplateId.value = null
  applyTitles(parsed.titles)
  pushWordBank(wordBank.value)
  showMilestone('📋', '已创建新Bingo卡')
}

onShow(() => {
  // Clear the illustration cache so we get fresh data after illustrations are uploaded from the word bank page
  illustCache.clear()
  if (isIllustMode.value) {
    autoPopulateIllustrations()
  }

  // Check if words were applied from board preview
  try {
    const raw = safeGet<string>('_temp_apply_words')
    if (raw) {
      safeRemove('_temp_apply_words')
      const words: string[] = JSON.parse(raw)
      if (words.length > 0) {
        applyTitles(words)
        showMilestone('📝', '已应用词语')
      }
    }
  } catch (_) { /* ignore */ }
})

// --- Template word import helpers ---
async function mergeTemplateWords(words: string[]) {
  const result = await mergeWords(words)
  if (result.blocked) {
    uni.showToast({ title: '模板词含违规内容，未导入词库', icon: 'none' })
    return
  }
  if (result.added > 0 && result.added < words.length) {
    uni.showToast({ title: '词库已满，部分词未导入', icon: 'none' })
  }
  if (result.added > 0) {
    await pushWordBank(wordBank.value)
  }
}

// Listen for template-applied event from plaza
interface TemplateAppliedData {
  oldTitle: string
  oldBoardId?: number | null
  oldHasContent?: boolean
  templateWords?: string[]
}
const onTemplateApplied = async (data: TemplateAppliedData) => {
  const result = await reloadActiveBoard()
  if (result?.theme) {
    setTheme(result.theme)
  }
  lastMilestoneShown = 0

  // After switching templates, refresh illustrations (mirrors the board-switch flow)
  illustCache.clear()
  loadIllustMode()
  if (isIllustMode.value) autoPopulateIllustrations()

  // Auto-delete old empty board (no content)
  const shouldAutoDelete = data.oldBoardId && !data.oldHasContent
  if (shouldAutoDelete) {
    try {
      await deleteBoard(data.oldBoardId!)
    } catch { /* already gone or still active — ignore */ }
  }

  setTimeout(() => {
    if (shouldAutoDelete || !data.oldBoardId) {
      showMilestone('📋', '已应用模板')
    } else {
      showMilestone('📋', `「${data.oldTitle}」已保存至我的Bingo卡`)
    }
  }, 500)

  // Merge template words into word bank
  if (data.templateWords?.length) {
    await mergeTemplateWords(data.templateWords)
  }
}
uni.$on('template-applied', onTemplateApplied)
onUnmounted(() => {
  uni.$off('template-applied', onTemplateApplied)
  uni.$off('templatePublished', onTemplatePublished)
  if (syncTimer) clearTimeout(syncTimer)
})

function showOfflineDetail() {
  uni.showModal({
    title: '离线模式',
    content: `${offlineReason.value}\n\n当前数据仅保存在本地，联网后将自动同步。`,
    showCancel: true,
    cancelText: '知道了',
    confirmText: '重试',
    success: async (res) => {
      if (res.confirm) {
        const ok = await ensureLoggedIn()
        if (ok) {
          showMilestone('🌐', '已恢复在线')
        } else {
          uni.showToast({ title: offlineReason.value, icon: 'none', duration: 3000 })
        }
      }
    },
  })
}

// ── canvas export (delegated to composable) ──
function onPreviewCard() {
  closeMenu()
  _previewCard()
}

// ── Bingo popup actions ──
function onBingoPreview() {
  dismissBingo()
  _previewCard()
}

function onBingoShare() {
  dismissBingo()
  showSharePanel.value = true
}

function onBingoPublish() {
  dismissBingo()
  onOpenPublishPanel()
}

// Debounced sync to the server (skip changes that came from a remote load)
let syncTimer: ReturnType<typeof setTimeout> | null = null
let lastCellsSnapshot = ''
watch(cells, () => {
  persistState()
  // While loading data from the server, don't trigger the celebration and don't push back
  if (isLoadingFromRemote()) return
  checkBingo()
  // Quick comparison: skip the push if content didn't change
  const snapshot = JSON.stringify(cells.value.map(c => ({ t: c.title, d: c.completed })))
  if (snapshot === lastCellsSnapshot) return
  lastCellsSnapshot = snapshot
  // Debounced push to the server
  if (syncTimer) clearTimeout(syncTimer)
  syncTimer = setTimeout(() => {
    pushCells(cells.value, gridSize.value, currentThemeId.value).catch((err: any) => {
      const msg = err?.message || ''
      if (msg.includes('违规')) {
        showMilestone('⚠️', '内容含违规信息，请修改')
      }
    })
  }, 2000)
}, { deep: true })

onMounted(async () => {
  loadTheme()
  loadState()
  loadWordBank()
  loadBoardTitle()
  loadIllustMode()

  // Listen for publish success from publish page
  uni.$on('templatePublished', onTemplatePublished)

  // Silent login + initial sync
  const ok = await ensureLoggedIn()
  if (!ok && offlineReason.value) {
    uni.showToast({
      title: offlineReason.value,
      icon: 'none',
      duration: 3000,
    })
  }
  if (ok) {
    // Hydrate imageStorage preference from server
    try {
      const profile = await getProfile()
      if (profile.imageStorage) safeSet(STORAGE_KEYS.IMAGE_MODE, profile.imageStorage)
    } catch {}
    // initialSync now writes directly into the shared singleton state
    const remote = await initialSync(
      cells.value,
      gridSize.value,
      currentThemeId.value,
      wordBank.value,
    )
    if (remote?.cells) {
      // Populate cellResolvedUrls so the template can display images immediately
      remote.cells.forEach((c) => {
        if (c.imagePath) cellResolvedUrls.value[c.id] = c.imagePath
      })
    }
    if (remote?.theme && remote.theme !== currentThemeId.value) {
      setTheme(remote.theme)
    }
    if (remote?.publishedTemplateId !== undefined) {
      currentPublishedTemplateId.value = remote.publishedTemplateId || null
    }
    // Sync failure (logged in successfully but server unreachable)
    if (!remote && lastSyncError.value) {
      offlineReason.value = lastSyncError.value.includes('request:fail')
        ? '无法连接服务器，请检查网络'
        : lastSyncError.value
      uni.showToast({
        title: offlineReason.value,
        icon: 'none',
        duration: 3000,
      })
    } else {
      offlineReason.value = ''
    }
    // Reload rich mode now that remoteBoardId is set
    loadIllustMode()
    if (isIllustMode.value) autoPopulateIllustrations()
  }

  // Hide the skeleton screen once login + sync are complete
  isLoading.value = false
})
</script>

<style>
.page {
  padding: 20rpx 32rpx 0; /* overridden by inline style for side padding */
  background: var(--page-bg);
  height: 100%;
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
  font-family: 'PingFang SC', 'SF Pro Display', 'Helvetica Neue', 'Inter', 'Chalkboard SE', 'Comic Sans MS', sans-serif;
  color: var(--text-color);
  overflow: hidden;
}

.page.page-edit-mode {
  /* Clear the fixed edit bar plus the TabBar (≈ 172rpx edit bar + tabbar). */
  padding-bottom: calc(172rpx + var(--tabbar-content-height));
}

.header {
  display: flex;
  flex-direction: column;
  flex-shrink: 0;
  gap: 8rpx;
  padding: 0 32rpx 20rpx 32rpx;
  background: rgba(255, 255, 255, 0.35);
  backdrop-filter: blur(16px);
  -webkit-backdrop-filter: blur(16px);
  border-bottom: 1rpx solid rgba(0, 0, 0, 0.06);
  /* Lift the whole header above the grid AND above the board-switcher overlay
     (z-index:99): the switcher dropdown lives inside the header but overflows
     down over the grid, and that full-screen transparent overlay (used for
     tap-outside-to-close) would otherwise paint above it and swallow taps on
     the dropdown actions. Full-screen modals are all z-index >= 1000, so 100
     here keeps the header below them while staying above the overlay. */
  position: relative;
  z-index: 100;
}

.header-top {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16rpx;
}

.title-group {
  display: flex;
  flex-direction: column;
}

.title-art {
  font-size: 46rpx;
  font-weight: 900;
  color: var(--text-color);
  letter-spacing: 3rpx;
  font-family: 'PingFang SC', 'SF Pro Display', 'Inter', 'Helvetica Neue', 'Marker Felt', sans-serif;
  margin-top: var(--header-top-gap, 20rpx);
  padding-left: 8rpx;
  text-shadow:
    0 2rpx 6rpx rgba(0,0,0,0.10),
    1rpx 1rpx 0 rgba(255,255,255,0.5),
    -1rpx -1rpx 0 rgba(255,255,255,0.5);
  -webkit-text-stroke: 0.5rpx currentColor;
  paint-order: stroke fill;
  white-space: nowrap;
}

.title-emoji {
  letter-spacing: 0;
  margin-left: -2rpx;
  -webkit-text-stroke: 0;
  text-shadow: none;
}

.title-subtitle {
  font-size: 26rpx;
  color: var(--hint-color);
  opacity: 0.6;
  letter-spacing: 2rpx;
  padding-left: 0rpx;
  margin-top: 0;
  margin-left: 0;
  font-weight: 500;
}

/* ── header rows (subtitle + settings, board switcher + mode toggle) ── */
.header-row {
  display: flex;
  flex-direction: row;
  align-items: center;
  justify-content: space-between;
  gap: 16rpx;
}

.header-subtitle-row {
  margin-top: -4rpx;
}

.header-controls-row {
  margin-top: 8rpx;
}

/* ── progress bar ── */
.progress-row {
  display: flex;
  align-items: center;
  gap: 16rpx;
  padding: 8rpx 0 0;
}

.progress-track {
  flex: 1;
  height: 10rpx;
  background: rgba(0, 0, 0, 0.08);
  border-radius: 8rpx;
  overflow: hidden;
}

.progress-fill {
  height: 100%;
  background: linear-gradient(90deg, #3b4cc0 0%, #4c6ef5 100%);
  border-radius: 8rpx;
  transition: width 0.4s cubic-bezier(0.34, 1.2, 0.64, 1);
  min-width: 0;
}

.progress-label {
  font-size: 22rpx;
  color: var(--hint-color);
  white-space: nowrap;
  flex-shrink: 0;
}

.progress-current {
  font-size: 26rpx;
  font-weight: 800;
  color: var(--text-color);
}

.progress-status {
  font-size: 22rpx;
  color: var(--hint-color);
  white-space: nowrap;
  flex-shrink: 0;
}

.progress-status-done {
  color: var(--text-color);
  font-weight: 700;
}

.board-name-row {
  display: flex;
  align-items: center;
  gap: 8rpx;
  padding: 6rpx 12rpx;
  border-radius: 12rpx;
  border: 1rpx solid rgba(0, 0, 0, 0.1);
  transition: background 0.15s;
}

.board-name-row:active {
  background: rgba(0, 0, 0, 0.05);
}

.board-name {
  font-size: 26rpx;
  color: var(--hint-color);
  margin-top: 2rpx;
  font-weight: 500;
}

.board-name-arrow {
  font-size: 22rpx;
  color: var(--hint-color);
  opacity: 0.6;
}

/* ── offline badge ── */
.offline-badge {
  display: inline-flex;
  align-items: center;
  gap: 4rpx;
  background: rgba(255, 150, 50, 0.15);
  border: 1rpx solid rgba(255, 150, 50, 0.4);
  border-radius: 20rpx;
  padding: 4rpx 14rpx;
  margin-left: 8rpx;
  flex-shrink: 0;
}

.offline-icon {
  font-size: 22rpx;
}

.offline-text {
  font-size: 20rpx;
  color: #e67e22;
  font-weight: 600;
}

.size-picker {
  display: flex;
  flex-wrap: wrap;
  gap: 8rpx;
  padding: 12rpx 48rpx;
  background: var(--cell-bg);
}

.size-label {
  font-size: 20rpx;
  color: var(--hint-color);
  margin-left: 12rpx;
}

.size-option {
  padding: 8rpx 16rpx;
  font-size: 22rpx;
  color: var(--text-color);
  border: 2rpx solid var(--border-color);
  border-radius: 8rpx;
  background: var(--cell-bg);
}

.size-active {
  background: var(--accent-color);
  color: #ffffff;
  border-color: var(--accent-color);
}

/* ── grid area + mode switch ── */
.grid-area {
  position: relative;
  flex: 1;
  display: flex;
  flex-direction: column;
  padding-top: 24rpx;
}

.grid-header {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 10rpx;
  padding: 4rpx 0 58rpx;
}

.grid-header-top {
  display: flex;
  flex-direction: row;
  align-items: flex-start;
  justify-content: space-between;
  align-self: stretch;
}

.grid-header-left {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 8rpx;
}

.mode-switch-row {
  display: flex;
  flex-direction: row;
  align-items: center;
  gap: 12rpx;
  flex-shrink: 0;
}

.mode-switch-label {
  font-size: 22rpx;
  color: var(--hint-color, #999);
  white-space: nowrap;
  line-height: 1;
}

.ios-switch {
  width: 72rpx;
  height: 40rpx;
  border-radius: 20rpx;
  background: #e0e0e0;
  position: relative;
  transition: background 0.25s ease;
}

.ios-switch-on {
  background: var(--accent-color, #4cd964);
}

.ios-switch-thumb {
  position: absolute;
  top: 4rpx;
  left: 4rpx;
  width: 32rpx;
  height: 32rpx;
  border-radius: 50%;
  background: #fff;
  box-shadow: 0 2rpx 4rpx rgba(0,0,0,0.2);
  transition: transform 0.25s ease;
}

.ios-switch-on .ios-switch-thumb {
  transform: translateX(32rpx);
}

/* ── grid ── */
.grid {
  display: grid;
  flex: 1;
  align-content: start;
}

.cell {
  position: relative;
  padding-top: 100%;
  transition: transform 0.2s cubic-bezier(0.34, 1.56, 0.64, 1);
}

.cell:active {
  transform: scale(0.95);
}

.cell-frame {
  position: absolute;
  top: 0;
  right: 0;
  bottom: 0;
  left: 0;
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--cell-bg);
  border-radius: var(--cell-border-radius);
  overflow: hidden;
  transition: background 0.3s ease, box-shadow 0.3s ease;
}

.cell-completed {
  background: var(--completed-cell-bg);
  box-shadow: 
    0 4rpx 16rpx rgba(0, 0, 0, 0.08),
    inset 0 2rpx 8rpx rgba(0, 0, 0, 0.06);
  border: 1.5rpx solid rgba(0, 0, 0, 0.1);
}

.cell-bingo-glow {
  animation: bingo-cell-glow 1.5s ease-in-out infinite alternate;
}

@keyframes bingo-cell-glow {
  0% { filter: brightness(1); }
  100% { filter: brightness(1.08); }
}

.cell-media {
  position: absolute;
  top: 0;
  right: 0;
  bottom: 0;
  left: 0;
  width: 100%;
  height: 100%;
  overflow: hidden;
  z-index: 1;
}

.cell-photo {
  width: 100%;
  height: 100%;
  display: block;
}

/* fit mode: illustration sits above the label area */
.cell-illust-fit {
  position: absolute;
  top: 6%;
  left: 8%;
  right: 8%;
  bottom: 24%;
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1;
}

.cell-illust-img {
  width: 100%;
  height: 100%;
}

.cell-illust-grayscale {
  filter: grayscale(100%);
  -webkit-filter: grayscale(100%);
}

.cell-border {
  position: absolute;
  top: 0;
  right: 0;
  bottom: 0;
  left: 0;
  border: var(--cell-border-width) var(--cell-border-style) var(--border-color);
  border-radius: var(--cell-border-radius);
  box-sizing: border-box;
  pointer-events: none;
  z-index: 2;
}

.cell-border-edit {
  border-style: dashed;
  border-color: var(--accent-color);
  border-width: 4rpx;
}

.cell-check {
  position: absolute;
  top: 6rpx;
  right: 6rpx;
  width: 26rpx;
  height: 26rpx;
  border-radius: 50%;
  background: var(--check-color);
  border: 2rpx solid #ffffff;
  opacity: 0.85;
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 3;
  pointer-events: none;
}
.cell-check-icon {
  font-size: 16rpx;
  font-weight: bold;
  color: #ffffff;
  line-height: 1;
}

.cell-placeholder {
  padding: 8rpx;
  text-align: center;
  z-index: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  position: absolute;
  top: 0;
  right: 0;
  bottom: 0;
  left: 0;
}

.cell-label {
  position: absolute;
  bottom: 0;
  left: 0;
  right: 0;
  z-index: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: var(--illust-pad, 6rpx) 8rpx;
  border-radius: 0 0 var(--cell-border-radius) var(--cell-border-radius);
  pointer-events: none;
}

.cell-label-photo {
  background: var(--check-color);
  opacity: 0.85;
}

.cell-label-illust {
  background: rgba(255, 255, 255, 0.65);
  backdrop-filter: blur(4px);
}

.cell-label-text {
  font-size: var(--label-text-size, 22rpx);
  font-weight: 900;
  color: #ffffff;
  letter-spacing: 2rpx;
  text-shadow: 0 1rpx 4rpx rgba(0, 0, 0, 0.6);
  text-align: center;
  line-height: 1.2;
  overflow: hidden;
  display: -webkit-box;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
  word-break: break-all;
  max-width: 100%;
}

.cell-label-text-illust {
  color: var(--text-color);
  text-shadow: none;
}

.cell-text {
  overflow: hidden;
  font-size: var(--cell-text-size, 28rpx);
  color: var(--text-color);
  font-weight: 900;
  letter-spacing: 2rpx;
  word-break: break-all;
  text-align: center;
  line-height: 1.3;
  white-space: pre-line;
}

.cell-hint {
  display: block;
  margin-top: 6rpx;
  font-size: 20rpx;
  color: var(--hint-color);
}



/* ── buttons ── */
.btn-reset {
  margin: 0;
  padding: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  box-sizing: border-box;
  line-height: 1;
}

.btn-reset::after {
  border: none;
}

.mini-btn {
  margin: 0;
}

.primary-button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  background: var(--btn-gradient, var(--btn-bg));
  color: var(--btn-color);
  font-size: 26rpx;
  font-weight: 700;
  border-radius: 999rpx;
  height: 64rpx;
  line-height: 64rpx;
  padding: 0 24rpx;
  white-space: nowrap;
  box-shadow: 0 4rpx 16rpx rgba(0, 0, 0, 0.15);
}

/* ── settings button ── */
.settings-button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  background: var(--cell-bg) !important;
  color: var(--text-color) !important;
  border: 2rpx solid var(--border-color) !important;
  font-size: 22rpx;
  font-weight: 700;
  border-radius: 999rpx;
  height: 56rpx;
  line-height: 56rpx;
  padding: 0 20rpx;
  white-space: nowrap;
  box-sizing: border-box;
  letter-spacing: 2rpx;
  transition: transform 0.15s ease, background 0.2s ease;
  box-shadow: 3rpx 3rpx 0 var(--border-color);
}

.settings-button:active {
  transform: scale(0.95) translate(1rpx, 1rpx);
  box-shadow: 1rpx 1rpx 0 var(--border-color);
}

.settings-active {
  background: var(--settings-bg) !important;
  color: var(--settings-color) !important;
  border-color: var(--settings-bg) !important;
}

.ghost-button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: 3rpx solid var(--ghost-border);
  background: var(--ghost-bg);
  color: var(--ghost-color);
  font-size: 24rpx;
  font-weight: 700;
  border-radius: 999rpx;
  height: 64rpx;
  line-height: 64rpx;
  padding: 0 24rpx;
  white-space: nowrap;
  box-sizing: border-box;
}

/* Small buttons inside the panel */
.btn-sm {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-size: 22rpx;
  border-radius: 999rpx;
  height: 48rpx;
  line-height: 48rpx;
  padding: 0 20rpx;
  white-space: nowrap;
  box-sizing: border-box;
}

.btn-sm.primary-btn {
  background: var(--accent-color);
  color: #ffffff;
}

.btn-sm.ghost-btn {
  border: 3rpx solid var(--border-color);
  background: var(--cell-bg);
  color: var(--text-color);
}

.danger {
  color: #b14b3c;
  border-color: #f0b4a5;
}

/* ── settings overlay (word bank panel) ── */
.settings-overlay {
  position: fixed;
  inset: 0;
  display: flex;
  align-items: flex-end;
  justify-content: center;
  z-index: 10;
}

.overlay-backdrop {
  position: absolute;
  inset: 0;
  background: rgba(61, 44, 32, 0.35);
  animation: backdrop-fade-in 0.25s ease-out;
}

@keyframes backdrop-fade-in {
  0% { opacity: 0; }
  100% { opacity: 1; }
}

.settings-panel {
  position: relative;
  z-index: 1;
  width: 100%;
  max-height: 88vh;
  background: var(--panel-gradient, var(--cell-bg));
  border-radius: 28rpx 28rpx 0 0;
  padding: 24rpx;
  display: flex;
  flex-direction: column;
  gap: 16rpx;
  animation: panel-slide-up 0.3s cubic-bezier(0.34, 1.56, 0.64, 1) forwards;
}

@keyframes panel-slide-up {
  0% { transform: translateY(100%); }
  100% { transform: translateY(0); }
}

.panel-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12rpx;
  width: 100%;
  box-sizing: border-box;
}

.panel-title {
  font-size: 30rpx;
  font-weight: 700;
  color: var(--text-color);
  flex: 1;
}

.close-icon {
  width: 48rpx;
  height: 48rpx;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 32rpx;
  color: var(--hint-color);
}

.add-icon {
  width: 56rpx;
  height: 56rpx;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 40rpx;
  font-weight: 300;
  font-family: system-ui, -apple-system, sans-serif;
  color: var(--accent-color);
  border: 3rpx solid var(--border-color);
  border-radius: 50%;
  background: var(--cell-bg);
  box-sizing: border-box;
  flex-shrink: 0;
}

/* ── word bank ── */
.bank-edit {
  display: flex;
  flex-direction: column;
  gap: 12rpx;
}

.bank-add {
  display: grid;
  grid-template-columns: 1fr auto;
  gap: 12rpx;
  align-items: center;
}

.bank-input {
  width: 100%;
  border: 3rpx solid var(--border-color);
  background: var(--cell-bg);
  border-radius: 999rpx;
  padding: 0 24rpx;
  height: 56rpx;
  line-height: 56rpx;
  font-size: 24rpx;
  color: var(--text-color);
  box-sizing: border-box;
}

.bank-textarea {
  border-radius: 16rpx;
  height: auto;
  min-height: 56rpx;
  line-height: 1.4;
  padding: 12rpx 24rpx;
}

.bank-list {
  max-height: 50vh;
}

.bank-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8rpx;
  border-bottom: 2rpx dashed var(--border-color);
  gap: 12rpx;
  min-height: 64rpx;
}

.bank-word {
  font-size: 28rpx;
  font-weight: 900;
  color: var(--text-color);
  flex: 1;
  line-height: 64rpx;
}

.bank-on-board {
  font-size: 20rpx;
  color: #34a853;
  background: rgba(52, 168, 83, 0.1);
  padding: 2rpx 12rpx;
  border-radius: 16rpx;
  line-height: 36rpx;
  flex-shrink: 0;
}

.bank-item-actions {
  display: flex;
  gap: 8rpx;
}

/* ── word picker ── */
.word-picker-overlay {
  position: fixed;
  inset: 0;
  display: flex;
  align-items: flex-end;
  justify-content: center;
  z-index: 20;
}

.word-picker-panel {
  position: relative;
  z-index: 1;
  width: 100%;
  background: var(--panel-gradient, var(--cell-bg));
  border-radius: 24rpx 24rpx 0 0;
  padding: 24rpx;
  padding-bottom: calc(24rpx + var(--tabbar-content-height) + env(safe-area-inset-bottom));
  max-height: 70vh;
  display: flex;
  flex-direction: column;
  gap: 16rpx;
  box-sizing: border-box;
  animation: panel-slide-up 0.3s cubic-bezier(0.34, 1.56, 0.64, 1) forwards;
}

.word-search {
  width: 100%;
  border: 3rpx solid var(--border-color);
  background: var(--cell-bg);
  border-radius: 999rpx;
  padding: 0 24rpx;
  height: 64rpx;
  line-height: 64rpx;
  font-size: 26rpx;
  color: var(--text-color);
  box-sizing: border-box;
}

.picker-add {
  display: grid;
  grid-template-columns: 1fr auto;
  gap: 12rpx;
  align-items: center;
}

.word-picker-list {
  flex: 1;
  max-height: 50vh;
}

.word-picker-item {
  padding: 0 16rpx;
  border-bottom: 2rpx dashed var(--border-color);
  font-size: 26rpx;
  color: var(--text-color);
  height: 64rpx;
  line-height: 64rpx;
  box-sizing: border-box;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.word-picker-item:active {
  background: #f0e4d4;
}



/* ── word editor ── */
.word-editor-overlay {
  position: fixed;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 12;
}

/* Photo privacy notice modal */
.photo-notice-panel {
  position: relative;
  z-index: 1;
  width: 80%;
  max-width: 560rpx;
  background: var(--panel-gradient, var(--cell-bg));
  border-radius: 24rpx;
  padding: 40rpx 32rpx;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 20rpx;
  border: 3rpx solid var(--border-color);
}

.photo-notice-icon {
  font-size: 64rpx;
}

.photo-notice-title {
  font-size: 34rpx;
  font-weight: 700;
  color: var(--text-primary);
}

.photo-notice-content {
  font-size: 26rpx;
  color: var(--text-secondary);
  text-align: center;
  line-height: 1.6;
  padding: 0 16rpx;
}

.photo-notice-checkbox {
  display: flex;
  align-items: center;
  gap: 12rpx;
  padding: 16rpx 0;
}

.checkbox-icon {
  width: 36rpx;
  height: 36rpx;
  border: 2rpx solid var(--border-color);
  border-radius: 6rpx;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 24rpx;
  color: #fff;
  transition: all 0.15s ease;
}

.checkbox-icon.checked {
  background: var(--theme-primary, #ff6b6b);
  border-color: var(--theme-primary, #ff6b6b);
}

.checkbox-label {
  font-size: 26rpx;
  color: var(--text-secondary);
}

.photo-notice-actions {
  display: flex;
  gap: 24rpx;
  margin-top: 12rpx;
  width: 100%;
}

.photo-notice-btn {
  flex: 1;
  height: 72rpx;
  border-radius: 36rpx;
  font-size: 28rpx;
  font-weight: 600;
  border: none;
  display: flex;
  align-items: center;
  justify-content: center;
}

.photo-notice-btn.cancel {
  background: rgba(0, 0, 0, 0.05);
  color: var(--text-secondary);
}

.photo-notice-btn.confirm {
  background: var(--theme-primary, #ff6b6b);
  color: #fff;
}

.share-panel {
  position: relative;
  z-index: 1;
  width: 85%;
  background: var(--panel-gradient, var(--cell-bg));
  border-radius: 24rpx;
  padding: 28rpx;
  display: flex;
  flex-direction: column;
  gap: 20rpx;
  border: 3rpx solid var(--border-color);
}

.share-desc {
  font-size: 28rpx;
  color: var(--text-color);
  line-height: 1.5;
  padding: 0 4rpx;
}

.share-section {
  display: flex;
  flex-direction: column;
  gap: 8rpx;
}

.share-label {
  font-size: 24rpx;
  color: var(--hint-color);
  font-weight: 500;
}

.share-row {
  display: flex;
  align-items: center;
  gap: 12rpx;
}

.share-input {
  flex: 1;
  font-size: 22rpx !important;
}

.word-editor-panel {
  position: relative;
  z-index: 1;
  width: 80%;
  background: var(--panel-gradient, var(--cell-bg));
  border-radius: 24rpx;
  padding: 24rpx;
  display: flex;
  flex-direction: column;
  gap: 16rpx;
  border: 3rpx solid var(--border-color);
}

.word-editor-actions {
  display: flex;
  justify-content: flex-end;
  gap: 12rpx;
}

.bingo-canvas {
  position: fixed;
  width: 1500px;
  height: 1500px;
  left: -9999px;
  top: -9999px;
}

.polaroid-canvas {
  position: fixed;
  width: 1700px;
  height: 2500px;
  left: -9999px;
  top: -9999px;
}

/* ── preview overlay ── */
.preview-overlay {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(0, 0, 0, 0.75);
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 32rpx;
  z-index: 1000;
  animation: preview-fade-in 0.25s ease-out;
}

@keyframes preview-fade-in {
  from { opacity: 0; }
  to { opacity: 1; }
}

/* ── Polaroid preview (unified) ── */
.polaroid-card {
  width: 620rpx;
  position: relative;
  border-radius: 28rpx;
  background-color: var(--canvas-bg, #f6f2ec);
  box-shadow:
    0 8rpx 40rpx rgba(0, 0, 0, 0.35),
    0 2rpx 8rpx rgba(0, 0, 0, 0.15),
    inset 0 1rpx 0 rgba(255, 255, 255, 0.8);
  overflow: hidden;
  animation: polaroid-drop 0.35s cubic-bezier(0.34, 1.56, 0.64, 1) forwards;
  transform-origin: center center;
}

.polaroid-card-board {
  width: 710rpx;
  overflow: hidden;
  animation: polaroid-drop-straight 0.35s cubic-bezier(0.34, 1.56, 0.64, 1) forwards;
}

@keyframes polaroid-drop {
  0% { opacity: 0; transform: scale(0.7) translateY(-60rpx); }
  100% { opacity: 1; transform: scale(1) translateY(0); }
}

@keyframes polaroid-drop-straight {
  0% { opacity: 0; transform: scale(0.7) translateY(-60rpx); }
  100% { opacity: 1; transform: scale(1) translateY(0); }
}

/* ── card style preview (canvas-rendered) ── */
.card-preview-container {
  position: relative;
  width: 680rpx;
  background: transparent;
  animation: polaroid-drop-straight 0.35s cubic-bezier(0.34, 1.56, 0.64, 1) forwards;
}

.card-preview-image {
  width: 680rpx;
  height: auto;
  display: block;
  border-radius: 12rpx;
  box-shadow: 0 8rpx 40rpx rgba(0, 0, 0, 0.35);
}

.card-preview-close {
  position: absolute;
  top: 8rpx;
  right: 8rpx;
  width: 52rpx;
  height: 52rpx;
  border-radius: 50%;
  background: rgba(0, 0, 0, 0.45);
  color: #fff;
  font-size: 26rpx;
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 10;
}

.polaroid-photo {
  margin: 32rpx 32rpx 0;
  aspect-ratio: 1;
  overflow: hidden;
  border-radius: 16rpx;
  background: var(--canvas-cell-bg, #f0ede8);
  box-shadow: inset 0 0 4rpx rgba(0, 0, 0, 0.06);
  border: 3rpx solid rgba(0, 0, 0, 0.08);
}

.polaroid-photo-board {
  aspect-ratio: auto;
  margin: 32rpx 32rpx 0;
  border-radius: 8rpx;
  background: transparent;
  box-shadow: none;
}

.polaroid-image {
  width: 100%;
  height: 100%;
  display: block;
  border-radius: 14rpx;
}

.polaroid-image-board {
  height: auto;
}

.polaroid-footer {
  padding: 28rpx 36rpx 36rpx;
  display: flex;
  align-items: baseline;
  justify-content: space-between;
}

.polaroid-title {
  font-size: 28rpx;
  font-weight: 900;
  color: var(--text-color);
  letter-spacing: 2rpx;
}

.polaroid-watermark {
  font-size: 22rpx;
  color: var(--canvas-text-color, #c0b8ae);
  opacity: 0.5;
  letter-spacing: 1rpx;
  white-space: nowrap;
  font-style: italic;
}

.polaroid-footer-board {
  flex-direction: column;
  gap: 20rpx;
}

.polaroid-footer-left {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  width: 100%;
}

.polaroid-card-close {
  position: absolute;
  top: 8rpx;
  right: 8rpx;
  width: 52rpx;
  height: 52rpx;
  border-radius: 50%;
  background: rgba(0, 0, 0, 0.45);
  color: #fff;
  font-size: 26rpx;
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 10;
}

.polaroid-actions {
  display: flex;
  align-items: center;
  justify-content: center;
  margin-top: 0;
}

.polaroid-action-btn {
  padding: 16rpx 40rpx;
  border-radius: 999rpx;
  font-size: 28rpx;
  font-weight: 600;
  letter-spacing: 2rpx;
}

.polaroid-action-save {
  background: rgba(255, 255, 255, 0.92);
  color: #3a3a3a;
  box-shadow: 0 4rpx 16rpx rgba(0, 0, 0, 0.2);
}

.polaroid-close {
  margin-top: 12rpx;
  width: 72rpx;
  height: 72rpx;
  border-radius: 50%;
  background: rgba(255, 255, 255, 0.2);
  color: #fff;
  font-size: 36rpx;
  display: flex;
  align-items: center;
  justify-content: center;
  border: 2rpx solid rgba(255, 255, 255, 0.4);
}

/* ── preview gallery swiper ── */
.preview-swiper {
  width: 100%;
  height: 72vh;
}

.preview-swiper-item {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 100%;
}


.unexposed-film {
  margin: 32rpx 32rpx 0;
  aspect-ratio: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 16rpx;
  background: linear-gradient(
    160deg,
    #1a2d2d 0%,
    #1c2828 40%,
    #212e2a 70%,
    #1e2926 100%
  );
  box-shadow: inset 0 0 30rpx rgba(0, 0, 0, 0.3);
}

.unexposed-title {
  font-size: 34rpx;
  font-weight: 500;
  color: rgba(255, 255, 255, 0.35);
  text-align: center;
  padding: 40rpx;
  line-height: 1.6;
  letter-spacing: 2rpx;
}

.preview-indicator {
  font-size: 26rpx;
  color: rgba(255, 255, 255, 0.7);
  text-align: center;
  margin-top: 8rpx;
  letter-spacing: 2rpx;
}

/* ── preview toggle hint ── */
.toggle-hint {
  position: absolute;
  bottom: 80rpx;
  left: 0;
  right: 0;
  display: flex;
  justify-content: center;
  pointer-events: none;
}

.toggle-hint-text {
  font-size: 24rpx;
  color: rgba(255, 255, 255, 0.9);
  background: rgba(0, 0, 0, 0.4);
  padding: 8rpx 24rpx;
  border-radius: 24rpx;
}

/* ── preview navigation arrows ── */
.preview-arrow {
  position: fixed;
  top: 45%;
  transform: translateY(-50%);
  width: 80rpx;
  height: 140rpx;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 68rpx;
  color: rgba(255, 255, 255, 0.25);
  z-index: 1010;
}

.preview-arrow-left {
  left: -8rpx;
}

.preview-arrow-right {
  right: -8rpx;
}

/* ── skeleton loading ── */
.skeleton-cell {
  background: var(--skeleton-bg, #e0e0e0);
  overflow: hidden;
}

.skeleton-shimmer {
  position: absolute;
  top: 0;
  left: -100%;
  width: 100%;
  height: 100%;
  background: linear-gradient(
    90deg,
    transparent 0%,
    rgba(255, 255, 255, 0.35) 50%,
    transparent 100%
  );
  animation: shimmer 1.5s ease infinite;
}

@keyframes shimmer {
  0% { left: -100%; }
  100% { left: 200%; }
}

/* ── edit mode bottom bar ── */
.edit-bottom-bar {
  position: fixed;
  bottom: 0;
  left: 0;
  right: 0;
  display: flex;
  gap: 20rpx;
  padding: 20rpx 32rpx;
  padding-bottom: calc(20rpx + var(--tabbar-content-height) + env(safe-area-inset-bottom));
  background: var(--panel-gradient, var(--cell-bg));
  border-top: 2rpx solid var(--border-color);
  border-radius: 24rpx 24rpx 0 0;
  z-index: 10;
  animation: panel-slide-up 0.25s ease-out forwards;
}

.edit-bar-btn {
  flex: 1;
  height: 80rpx;
  line-height: 80rpx;
  text-align: center;
  border-radius: 999rpx;
  font-size: 28rpx;
  font-weight: 700;
  letter-spacing: 2rpx;
}

.edit-bar-btn.primary-style {
  background: var(--btn-gradient, var(--btn-bg));
  color: var(--btn-color);
  box-shadow: 0 4rpx 16rpx rgba(0, 0, 0, 0.15);
}

.edit-bar-btn.ghost-style {
  background: var(--ghost-bg);
  color: var(--ghost-color);
  border: 3rpx solid var(--ghost-border);
}

.edit-mode-badge {
  font-size: 22rpx;
  font-weight: 600;
  color: var(--accent-color);
  letter-spacing: 2rpx;
  animation: badge-blink 1.5s ease-in-out infinite;
}

@keyframes badge-blink {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.5; }
}

/* ── Board Switcher Popup ── */
.board-switcher-overlay {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  z-index: 99;
}

/* Dropdown board switcher */
.board-name-row {
  position: relative;
}

.board-name-arrow {
  transition: transform 0.2s ease;
}
.arrow-up {
  transform: rotate(180deg);
}

.board-dropdown {
  position: absolute;
  top: calc(100% + 8rpx);
  left: 0;
  min-width: 280rpx;
  background: var(--cell-bg, #fff);
  border-radius: 16rpx;
  box-shadow: 0 8rpx 32rpx rgba(0, 0, 0, 0.12);
  z-index: 100;
  overflow: hidden;
  animation: dropdown-fade 0.15s ease;
}

@keyframes dropdown-fade {
  from { opacity: 0; transform: translateY(-8rpx); }
  to { opacity: 1; transform: translateY(0); }
}

.dropdown-board-item {
  padding: 18rpx 28rpx;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16rpx;
  border-bottom: 1rpx solid var(--border-color, #f0f0f0);
}
.dropdown-board-item:last-child {
  border-bottom: none;
}
.dropdown-board-item:active {
  background: rgba(0, 0, 0, 0.04);
}

.dropdown-create {
  /* left-aligned: 创建卡片 on the left, size on the right */
}
.dropdown-create-text {
  font-size: 24rpx;
  font-weight: 400;
  color: var(--text-color, #333);
}
.dropdown-create-row {
  display: flex;
  flex-direction: column;
}

/* card action rows (管理/创建/编辑/预览/分享/发布) folded in from the old
   settings menu — left-aligned, sharing the board-item row styling */
.dropdown-action {
  justify-content: flex-start;
}
.dropdown-action-top {
  border-top: 1rpx solid var(--border-color, #eee);
}
.dropdown-action-text {
  font-size: 24rpx;
  font-weight: 400;
  color: var(--text-color, #333);
}
/* only 管理全部卡片 is emphasized */
.dropdown-action-text-strong {
  font-weight: 700;
}
.dropdown-action-disabled .dropdown-action-text {
  color: var(--hint-color, #999);
  opacity: 0.6;
}
</style>
<!-- trigger -->
