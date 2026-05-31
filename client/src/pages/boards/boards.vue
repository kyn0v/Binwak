<template>
  <view class="page" :style="[getThemeStyle(), { paddingTop: statusBarHeight + 'px' }]">
    <view class="page-nav">
      <view class="nav-back" @tap="onBack">←</view>
      <text class="nav-title">我的Bingo卡</text>
    </view>
    <view class="page-header">
      <text class="page-subtitle">管理你的 City Walk 历史记录</text>
    </view>

    <!-- Tab switch -->
    <view class="tab-bar">
      <view class="tab-item" :class="{ 'tab-active': activeTab === 'boards' }" @tap="switchTab('boards')">
        <text>🎯 我的</text>
      </view>
      <view class="tab-item" :class="{ 'tab-active': activeTab === 'favorites' }" @tap="switchTab('favorites')">
        <text>⭐ 收藏模板</text>
      </view>
    </view>

    <!-- Search -->
    <view v-if="activeTab === 'boards'" class="search-bar">
        <input
          class="search-input"
          type="text"
          placeholder="🔍 搜索Bingo卡..."
          :value="searchKeyword"
          @input="onSearchInput"
        />
      <view v-if="searchKeyword" class="search-clear" @tap="searchKeyword = ''">✕</view>
    </view>

    <!-- My boards tab -->
    <template v-if="activeTab === 'boards'">

    <!-- Actions -->
    <view class="action-bar">
      <view class="filter-btns">
        <view class="filter-chip" :class="{ 'filter-active': showFavoriteOnly }" @tap="showFavoriteOnly = !showFavoriteOnly">
          <text>{{ showFavoriteOnly ? '⭐ 仅看收藏' : '☆ 仅看收藏' }}</text>
        </view>
        <view v-if="emptyBoards.length > 0" class="cleanup-btn" @tap="onCleanupEmpty">
          <text class="cleanup-text">🗑️ 清理空白卡 ({{ emptyBoards.length }})</text>
        </view>
      </view>
    </view>

    <!-- Board list -->
    <view v-if="loading" class="loading-area">
      <view v-for="n in 3" :key="n" class="board-card skeleton-card">
        <view class="skeleton-line skeleton-title"></view>
        <view class="skeleton-line skeleton-meta"></view>
        <view class="skeleton-bar"></view>
      </view>
    </view>

    <view v-else-if="loadError" class="empty-area">
      <text class="empty-text">加载失败，请检查网络连接</text>
      <view class="retry-btn" @tap="loadBoards">
        <text class="retry-text">重试</text>
      </view>
    </view>

    <view v-else-if="filteredBoards.length === 0" class="empty-area">
      <text class="empty-text">{{ showFavoriteOnly ? '还没有收藏的Bingo卡' : '还没有Bingo卡，点击上方创建一个吧' }}</text>
    </view>

    <view v-else class="board-list">
      <view
        v-for="board in filteredBoards"
        :key="board.id"
        class="board-card"
        :class="{ 'board-active': board.isActive }"
        @tap="onSwitchBoard(board)"
      >
        <view class="board-card-header">
          <view class="board-info">
            <text class="board-title">{{ board.title }}</text>
            <text v-if="board.publishedTemplateId" class="published-badge">📤</text>
            <text v-if="board.isActive" class="active-badge">当前</text>
          </view>
          <view class="board-actions" @tap.stop="noop">
            <text class="action-btn fav-btn" @tap="onToggleBoardFavorite(board)">{{ board.isFavorite ? '⭐' : '☆' }}</text>
            <text class="action-btn rename-btn" @tap="onRenameBoard(board)">重命名</text>
            <text class="action-btn clone-btn" @tap="onCloneBoard(board)">克隆</text>
            <text class="action-btn delete-btn" @tap="onDeleteBoard(board)">删除</text>
          </view>
        </view>

        <view class="board-meta">
          <text class="meta-item">{{ board.gridSize }}×{{ board.gridSize }}</text>
          <text class="meta-dot">·</text>
          <text class="meta-item">{{ formatDate(board.createdAt) }}</text>
        </view>

        <!-- Progress bar -->
        <view class="progress-bar">
          <view
            class="progress-fill"
            :style="{ width: progressPercent(board) + '%' }"
          ></view>
        </view>
        <text class="progress-text">
          {{ board.completedCount || 0 }} / {{ board.totalCount || board.gridSize * board.gridSize }} 已完成
        </text>
      </view>
    </view>

    </template>

    <!-- Favorite templates tab -->
    <template v-if="activeTab === 'favorites'">
      <view v-if="favLoading" class="loading-area">
        <view v-for="n in 3" :key="n" class="board-card skeleton-card">
          <view class="skeleton-line skeleton-title"></view>
          <view class="skeleton-line skeleton-meta"></view>
        </view>
      </view>
      <view v-else-if="favTemplates.length === 0" class="empty-area">
        <text class="empty-text">还没有收藏的模板，去广场看看吧</text>
        <view class="retry-btn" @tap="goToPlaza">
          <text class="retry-text">逛广场</text>
        </view>
      </view>
      <view v-else class="board-list">
        <view
          v-for="tpl in favTemplates"
          :key="tpl.id"
          class="board-card fav-tpl-card"
          @tap="() => uni.navigateTo({ url: '/pages/plaza/plaza?templateId=' + tpl.id })"
        >
          <view class="board-card-header">
            <view class="board-info">
              <text class="board-title">{{ tpl.title }}</text>
              <text class="active-badge" style="background: #e8923f;">{{ tpl.category || '其他' }}</text>
            </view>
            <text class="fav-star">⭐</text>
          </view>
          <view class="board-meta">
            <text class="meta-item">{{ tpl.gridSize }}×{{ tpl.gridSize }}</text>
            <text class="meta-dot">·</text>
            <text class="meta-item">{{ tpl.authorName }}</text>
            <text class="meta-dot">·</text>
            <text class="meta-item">{{ tpl.favoriteCount }} 收藏</text>
          </view>
        </view>
      </view>
    </template>

    <!-- Rename dialog -->
    <view v-if="showRename" class="dialog-overlay" @tap="onCloseRename">
      <view class="dialog-panel" @tap.stop>
        <text class="dialog-title">{{ renameDialogTitle }}</text>
        <input
          v-model="renameText"
          class="dialog-input"
          placeholder="请输入名称"
          :maxlength="20"
        />
        <view class="dialog-actions">
          <button class="dialog-btn ghost" size="mini" :plain="true" hover-class="none" @tap="onCloseRename">取消</button>
          <button class="dialog-btn primary" size="mini" :plain="true" hover-class="none" @tap="onConfirmRename">确定</button>
        </view>
      </view>
    </view>

    <!-- Create board dialog -->
    <view v-if="showCreate" class="dialog-overlay" @tap="onCloseCreate">
      <view class="dialog-panel" @tap.stop>
        <text class="dialog-title">新建Bingo卡</text>
        <input
          v-model="newBoardTitle"
          class="dialog-input"
          placeholder="Bingo卡名称（如：上海漫步）"
          :maxlength="20"
        />
        <view class="size-selector">
          <text class="size-label">Bingo卡大小</text>
          <view class="size-options">
            <view
              v-for="s in gridSizeOptions"
              :key="s"
              class="size-chip"
              :class="{ 'size-chip-active': s === newBoardSize }"
              @tap="onSelectSize(s)"
            >
              <text>{{ s }}×{{ s }}</text>
            </view>
          </view>
        </view>
        <view class="dialog-actions">
          <button class="dialog-btn ghost" size="mini" :plain="true" hover-class="none" @tap="onCloseCreate">取消</button>
          <button class="dialog-btn primary" size="mini" :plain="true" hover-class="none" @tap="onCreateBoard">创建</button>
        </view>
      </view>
    </view>

    <!-- Card preview bottom panel -->
    <view v-if="previewBoard" class="preview-overlay" @tap="closePreview">
      <view class="preview-sheet" @tap.stop>
        <view class="preview-handle"></view>
        <view class="preview-header">
          <text class="preview-title">{{ previewBoard.title }}</text>
          <view class="preview-badges">
            <text v-if="previewBoard.isActive" class="active-badge">当前</text>
            <text v-if="previewBoard.publishedTemplateId" class="published-badge">📤</text>
          </view>
        </view>
        <view class="preview-meta">
          <text class="meta-item">{{ previewBoard.gridSize }}×{{ previewBoard.gridSize }}</text>
          <text class="meta-dot">·</text>
          <text class="meta-item">{{ previewBoard.completedCount || 0 }} / {{ previewBoard.totalCount || previewBoard.gridSize * previewBoard.gridSize }} 已完成</text>
        </view>

        <!-- Progress bar -->
        <view class="progress-bar" style="margin-bottom: 20rpx;">
          <view class="progress-fill" :style="{ width: progressPercent(previewBoard) + '%' }"></view>
        </view>

        <!-- Grid preview -->
        <view v-if="previewLoading" class="preview-grid-loading">
          <text class="meta-item">加载中...</text>
        </view>
        <view v-else class="preview-grid" :style="{ 'grid-template-columns': `repeat(${previewBoard.gridSize}, 1fr)` }">
          <view
            v-for="(cell, idx) in previewCells"
            :key="idx"
            class="preview-cell"
            :class="{ 'preview-cell-done': cell.completed, 'preview-cell-image': !!cell.imageUrl }"
          >
            <image v-if="cell.imageUrl" :src="cell.imageUrl" class="preview-cell-img" mode="aspectFill" />
            <text v-else class="preview-cell-text">{{ cell.title || '·' }}</text>
          </view>
        </view>

        <!-- Action buttons -->
        <view class="preview-actions">
          <view v-if="!previewBoard.isActive" class="preview-btn primary" @tap="onPreviewSwitch">
            <text>🔄 切换到此卡</text>
          </view>
          <view v-else class="preview-btn primary" @tap="closePreviewAndGoBack">
            <text>✅ 当前使用中</text>
          </view>
          <view class="preview-btn-row">
            <view class="preview-btn secondary" @tap="onPreviewApply">
              <text>📝 应用</text>
            </view>
            <view class="preview-btn secondary" @tap="onPreviewShare">
              <text>🔗 分享Bingo码</text>
            </view>
          </view>
        </view>
      </view>
    </view>

    <!-- Cleanup empty boards dialog -->
    <view v-if="showCleanupDialog" class="dialog-overlay" @tap="showCleanupDialog = false">
      <view class="dialog-panel cleanup-panel" @tap.stop>
        <text class="dialog-title">清理空白Bingo卡</text>
        <text class="cleanup-desc">以下 {{ emptyBoards.length }} 张卡没有添加过照片，勾选要删除的：</text>
        <view class="cleanup-select-all" @tap="cleanupSelected.size === emptyBoards.length ? (cleanupSelected = new Set()) : (cleanupSelected = new Set(emptyBoards.map(b => b.id)))">
          <view :class="['checkbox', cleanupSelected.size === emptyBoards.length ? 'checked' : '']">
            <text v-if="cleanupSelected.size === emptyBoards.length" class="check-icon">✓</text>
          </view>
          <text class="select-all-text">全选 / 取消全选</text>
        </view>
        <scroll-view scroll-y class="cleanup-list">
          <view v-for="b in emptyBoards" :key="b.id" class="cleanup-item" @tap="toggleCleanupItem(b.id)">
            <view :class="['checkbox', cleanupSelected.has(b.id) ? 'checked' : '']">
              <text v-if="cleanupSelected.has(b.id)" class="check-icon">✓</text>
            </view>
            <view class="cleanup-item-info">
              <text class="cleanup-item-title">{{ b.title }}<text v-if="b.isActive" class="active-tag">当前</text></text>
              <text class="cleanup-item-meta">{{ b.gridSize }}×{{ b.gridSize }} · {{ formatDate(b.createdAt) }}</text>
            </view>
          </view>
        </scroll-view>
        <view class="dialog-actions">
          <button class="dialog-btn ghost" size="mini" :plain="true" hover-class="none" @tap="showCleanupDialog = false">取消</button>
          <button class="dialog-btn danger" size="mini" :plain="true" hover-class="none" :disabled="cleanupSelected.size === 0" @tap="onConfirmCleanup">删除 {{ cleanupSelected.size }} 张</button>
        </view>
      </view>
    </view>
  </view>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useTheme } from '../index/useTheme'
import { useSync, defaultBoardTitle } from '../index/useSync'
import { favoriteBoard, getTemplates, getBoard, resolveApiUrl, type TemplateListParams, type TemplateListResponse } from '../index/api'
import { buildShareCode, copyShareCodeToClipboard } from '../index/shareCode'
import type { TemplateListItem, Cell } from '../../../../shared/types'
import { safeSet } from '@/utils/safeStorage'

interface BoardItem {
  id: number
  title: string
  gridSize: number
  theme: string
  isActive: boolean
  isFavorite?: boolean
  completedCount?: number
  totalCount?: number
  imageCount?: number
  publishedTemplateId?: number | null
  createdAt: string
  updatedAt: string
}

const statusBarHeight = (() => {
  const info = uni.getWindowInfo()
  const statusBar = info.statusBarHeight ?? 0
  const menuBtn = uni.getMenuButtonBoundingClientRect()
  const toolbarHeight = menuBtn.height + (menuBtn.top - statusBar) * 2
  return statusBar + toolbarHeight
})()

function onBack() {
  uni.navigateBack()
}

const { currentThemeId, loadTheme, getThemeStyle } = useTheme()
const { fetchBoards, switchBoard, removeBoard, createAndSwitchBoard, renameBoard, duplicateBoard } = useSync()

const GRID_SIZE_OPTIONS = [3, 4, 5, 6, 7]

const boards = ref<BoardItem[]>([])
const loading = ref(true)
const loadError = ref(false)
const searchKeyword = ref('')

const filteredBoards = computed(() => {
  const kw = searchKeyword.value.trim().toLowerCase()
  let list = boards.value
  if (showFavoriteOnly.value) {
    list = list.filter((b) => b.isFavorite)
  }
  if (!kw) return list
  return list.filter((b) => b.title.toLowerCase().includes(kw))
})

// Tab: My boards / Favorite templates
const activeTab = ref<'boards' | 'favorites'>('boards')
const showFavoriteOnly = ref(false)
const favTemplates = ref<TemplateListItem[]>([])
const favLoading = ref(false)

// Empty boards = no images (active board included, handled specially during delete)
const emptyBoards = computed(() =>
  boards.value.filter(b => (b.imageCount ?? 0) === 0)
)

const showCleanupDialog = ref(false)
const cleanupSelected = ref<Set<number>>(new Set())
const showCreate = ref(false)
const newBoardTitle = ref('')
const newBoardSize = ref(3)
const gridSizeOptions = GRID_SIZE_OPTIONS

// Rename / Clone
const showRename = ref(false)
const renameText = ref('')
const renameDialogTitle = ref('重命名')
const renameTargetId = ref<number | null>(null)
const renameMode = ref<'rename' | 'clone'>('rename')

// Board preview
const previewBoard = ref<BoardItem | null>(null)
const previewCells = ref<Cell[]>([])
const previewLoading = ref(false)

function noop() {
  // prevent tap propagation
}

function switchTab(tab: 'boards' | 'favorites') {
  activeTab.value = tab
  if (tab === 'favorites' && favTemplates.value.length === 0) {
    loadFavTemplates()
  }
}

function goToPlaza() {
  uni.$emit('switch-tab', 'plaza')
  uni.navigateBack()
}

async function loadFavTemplates() {
  favLoading.value = true
  try {
    const res = await getTemplates({ favorite: true, limit: 100 })
    favTemplates.value = res.templates
  } catch (err) {
    console.error('加载收藏模板失败:', err)
  } finally {
    favLoading.value = false
  }
}

async function onToggleBoardFavorite(board: BoardItem) {
  const old = board.isFavorite
  board.isFavorite = !board.isFavorite
  try {
    const res = await favoriteBoard(board.id)
    board.isFavorite = res.isFavorite
  } catch (err) {
    board.isFavorite = old
    uni.showToast({ title: '操作失败', icon: 'none' })
  }
}

function onSearchInput(event: any) {
  searchKeyword.value = event?.detail?.value || ''
}

function onSelectSize(s: number) {
  newBoardSize.value = s
}

function onCloseCreate() {
  showCreate.value = false
}

function formatDate(dateStr: string) {
  if (!dateStr) return ''
  // iOS doesn't support "yyyy-MM-dd HH:mm:ss" — use compatible format
  const d = new Date(dateStr.replace(/ /g, 'T'))
  const m = d.getMonth() + 1
  const day = d.getDate()
  return `${m}月${day}日`
}

function progressPercent(board: BoardItem) {
  const total = board.totalCount || board.gridSize * board.gridSize
  const completed = board.completedCount || 0
  if (total === 0) return 0
  return Math.round((completed / total) * 100)
}

function showCreateDialog() {
  const titles = boards.value.map(b => b.title)
  newBoardTitle.value = defaultBoardTitle(titles)
  newBoardSize.value = 3
  showCreate.value = true
}

async function loadBoards() {
  loading.value = true
  loadError.value = false
  try {
    boards.value = await fetchBoards()
  } catch (_) {
    loadError.value = true
    boards.value = []
  }
  loading.value = false
}

async function onCreateBoard() {
  const titles = boards.value.map(b => b.title)
  const title = newBoardTitle.value.trim() || defaultBoardTitle(titles)

  if (boards.value.some((b) => b.title === title)) {
    uni.showToast({ title: 'Bingo卡名已存在', icon: 'none' })
    return
  }

  showCreate.value = false

  uni.showLoading({ title: '创建中…' })
  const result = await createAndSwitchBoard(title, newBoardSize.value, currentThemeId.value)
  uni.hideLoading()

  if (result) {
    uni.showToast({ title: '已创建新Bingo卡', icon: 'success' })
    // Navigate back to main with refresh flag
    uni.navigateBack()
  } else {
    uni.showToast({ title: '创建失败', icon: 'none' })
  }
}

async function onSwitchBoard(board: BoardItem) {
  // Open preview panel instead of direct switch
  previewBoard.value = board
  previewCells.value = []
  previewLoading.value = true
  try {
    const detail = await getBoard(board.id)
    previewCells.value = detail.cells.map(c => ({
      ...c,
      imageUrl: c.imageUrl || (c.imageName ? resolveApiUrl(`/uploads/${c.imageName}`) : undefined),
    }))
  } catch (err) {
    console.error('加载Bingo卡详情失败:', err)
    // Still show preview with empty grid
    const total = board.gridSize * board.gridSize
    previewCells.value = Array.from({ length: total }, (_, i) => ({
      position: i, title: '', imageName: '', completed: false,
    }))
  } finally {
    previewLoading.value = false
  }
}

function closePreview() {
  previewBoard.value = null
  previewCells.value = []
}

function closePreviewAndGoBack() {
  closePreview()
  uni.navigateBack()
}

async function onPreviewSwitch() {
  const board = previewBoard.value
  if (!board) return
  closePreview()
  uni.showLoading({ title: '切换中…' })
  const result = await switchBoard(board.id)
  uni.hideLoading()
  if (result) {
    uni.showToast({ title: `已切换到「${board.title}」`, icon: 'success' })
    uni.navigateBack()
  } else {
    uni.showToast({ title: '切换失败', icon: 'none' })
  }
}

function onPreviewApply() {
  const board = previewBoard.value
  if (!board || previewCells.value.length === 0) return
  const words = previewCells.value.map(c => c.title).filter(Boolean)
  if (words.length === 0) {
    uni.showToast({ title: '此卡没有词语', icon: 'none' })
    return
  }

  const hasImages = previewCells.value.some(c => c.imageUrl || c.imageName)

  if (hasImages) {
    uni.showActionSheet({
      itemList: ['仅应用词语', '应用词语和图片（完整应用）'],
      success: (res) => {
        if (res.tapIndex === 0) {
          applyWordsAndGoBack(words)
        } else {
          applyFullAndGoBack(board)
        }
      },
    })
  } else {
    applyWordsAndGoBack(words)
  }
}

function applyWordsAndGoBack(words: string[]) {
  safeSet('_temp_apply_words', JSON.stringify(words))
  closePreview()
  uni.navigateBack()
}

async function applyFullAndGoBack(board: BoardItem) {
  closePreview()
  uni.showLoading({ title: '切换中…' })
  const result = await switchBoard(board.id)
  uni.hideLoading()
  if (result) {
    uni.showToast({ title: `已切换到「${board.title}」`, icon: 'success' })
    uni.navigateBack()
  } else {
    uni.showToast({ title: '切换失败', icon: 'none' })
  }
}

async function onPreviewShare() {
  const board = previewBoard.value
  if (!board) return
  const words = previewCells.value.map(c => c.title).filter(Boolean)
  if (words.length === 0) {
    uni.showToast({ title: '此卡没有内容可分享', icon: 'none' })
    return
  }
  const code = buildShareCode(words)
  await copyShareCodeToClipboard(code)
  uni.showToast({ title: '分享码已复制到剪贴板', icon: 'none' })
}

function onRenameBoard(board: BoardItem) {
  renameMode.value = 'rename'
  renameTargetId.value = board.id
  renameText.value = board.title
  renameDialogTitle.value = '重命名'
  showRename.value = true
}

function onCloneBoard(board: BoardItem) {
  renameMode.value = 'clone'
  renameTargetId.value = board.id
  // Extract base name (strip trailing _number)
  const baseMatch = board.title.match(/^(.+?)(?:_(\d+))?$/)
  const baseName = baseMatch ? baseMatch[1] : board.title
  const existing = boards.value.map((b) => b.title)
  let suffix = 1
  while (existing.includes(`${baseName}_${suffix}`)) suffix++
  renameText.value = `${baseName}_${suffix}`
  renameDialogTitle.value = '克隆Bingo卡'
  showRename.value = true
}

function onCloseRename() {
  showRename.value = false
}

async function onConfirmRename() {
  const title = renameText.value.trim()
  if (!title || !renameTargetId.value) return

  // Check for duplicate name (exclude self when renaming)
  const isDuplicate = boards.value.some(
    (b) => b.title === title && (renameMode.value === 'clone' || b.id !== renameTargetId.value)
  )
  if (isDuplicate) {
    uni.showToast({ title: 'Bingo卡名已存在', icon: 'none' })
    return
  }

  showRename.value = false

  if (renameMode.value === 'rename') {
    uni.showLoading({ title: '保存中…' })
    const ok = await renameBoard(renameTargetId.value, title)
    uni.hideLoading()
    if (ok) {
      const b = boards.value.find((b) => b.id === renameTargetId.value)
      if (b) b.title = title
      uni.showToast({ title: '已重命名', icon: 'success' })
    } else {
      uni.showToast({ title: '重命名失败', icon: 'none' })
    }
  } else {
    uni.showLoading({ title: '克隆中…' })
    const ok = await duplicateBoard(renameTargetId.value, title)
    uni.hideLoading()
    if (ok) {
      uni.showToast({ title: '已克隆', icon: 'success' })
      await loadBoards()
    } else {
      uni.showToast({ title: '克隆失败', icon: 'none' })
    }
  }
}

// Switch away from `board` before deleting it: pick another board, or create one.
// Returns true if it's now safe to delete `board`.
async function switchAwayFromActiveBoard(board: BoardItem): Promise<boolean> {
  const switchTarget = boards.value.find((b) => b.id !== board.id)
  if (switchTarget) {
    const ok = await switchBoard(switchTarget.id)
    return !!ok
  }
  const result = await createAndSwitchBoard(
    defaultBoardTitle(),
    board.gridSize,
    currentThemeId.value,
  )
  return !!result
}

async function onDeleteBoard(board: BoardItem) {
  const isActive = board.isActive
  const content = isActive
    ? `「${board.title}」是当前使用中的Bingo卡，删除后将自动切换到其他卡片。确定删除吗？此操作不可撤销。`
    : `确定要删除「${board.title}」吗？此操作不可撤销。`

  uni.showModal({
    title: '删除Bingo卡',
    content,
    confirmText: '删除',
    confirmColor: '#b14b3c',
    success: async (res) => {
      if (!res.confirm) return
      uni.showLoading({ title: '删除中...' })
      try {
        if (isActive) {
          const switched = await switchAwayFromActiveBoard(board)
          if (!switched) {
            uni.showToast({ title: '切换卡片失败，删除已取消', icon: 'none' })
            return
          }
        }
        const ok = await removeBoard(board.id)
        if (ok) {
          boards.value = boards.value.filter((b) => b.id !== board.id)
          uni.showToast({ title: '已删除', icon: 'success' })
        } else {
          uni.showToast({ title: '删除失败', icon: 'none' })
        }
      } finally {
        uni.hideLoading()
      }
    },
  })
}

function onCleanupEmpty() {
  if (emptyBoards.value.length === 0) return
  cleanupSelected.value = new Set(emptyBoards.value.map(b => b.id))
  showCleanupDialog.value = true
}

function toggleCleanupItem(id: number) {
  const s = cleanupSelected.value
  if (s.has(id)) s.delete(id)
  else s.add(id)
  // trigger reactivity
  cleanupSelected.value = new Set(s)
}

async function onConfirmCleanup() {
  showCleanupDialog.value = false
  const toDelete = [...cleanupSelected.value]
  if (toDelete.length === 0) return

  // If deleting active board, switch to a non-empty board first
  const activeBoard = boards.value.find(b => b.isActive)
  const deletingActive = activeBoard && toDelete.includes(activeBoard.id)

  uni.showLoading({ title: '清理中...' })

  // Delete non-active boards first to free up quota
  const nonActiveToDelete = toDelete.filter(id => !activeBoard || id !== activeBoard.id)
  let deleted = 0
  for (const id of nonActiveToDelete) {
    const ok = await removeBoard(id)
    if (ok) {
      deleted++
      boards.value = boards.value.filter(b => b.id !== id)
    }
  }

  // Handle active board deletion last
  if (deletingActive && activeBoard) {
    const switchTarget = boards.value.find(
      b => !b.isActive && b.id !== activeBoard.id
    )
    if (switchTarget) {
      await switchBoard(switchTarget.id)
    } else {
      const result = await createAndSwitchBoard(defaultBoardTitle(), 4, 'mono')
      if (!result) {
        uni.hideLoading()
        uni.showToast({ title: deleted > 0 ? `已清理 ${deleted} 张空白卡` : '清理失败', icon: deleted > 0 ? 'success' : 'none' })
        return
      }
    }
    const ok = await removeBoard(activeBoard.id)
    if (ok) {
      deleted++
      boards.value = boards.value.filter(b => b.id !== activeBoard.id)
    }
  }

  uni.hideLoading()
  if (deleted > 0) {
    uni.showToast({ title: `已清理 ${deleted} 张空白卡`, icon: 'success' })
  } else {
    uni.showToast({ title: '清理失败', icon: 'none' })
  }
}

onMounted(() => {
  loadTheme()
  loadBoards()
})
</script>

<style>
.page {
  min-height: 100vh;
  padding: 0 32rpx 32rpx;
  box-sizing: border-box;
  background: var(--page-bg);
  color: var(--text-color);
  font-family: 'PingFang SC', 'SF Pro Display', 'Helvetica Neue', sans-serif;
}
.page-nav {
  display: flex;
  align-items: center;
  height: 88rpx;
  padding: 0 8rpx;
}
.nav-back {
  width: 64rpx;
  height: 64rpx;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 40rpx;
  color: var(--text-color);
}
.nav-title {
  font-size: 34rpx;
  font-weight: 600;
  color: var(--text-color);
}

.page-header {
  padding: 0 0 24rpx;
}

.page-subtitle {
  display: block;
  font-size: 24rpx;
  color: var(--hint-color);
}

/* ── tab bar ── */
.tab-bar {
  display: flex;
  gap: 16rpx;
  margin-bottom: 20rpx;
}

.tab-item {
  flex: 1;
  text-align: center;
  padding: 16rpx 0;
  border-radius: 16rpx;
  background: var(--card-bg, #f5f5f5);
  font-size: 28rpx;
  color: var(--hint-color, #999);
  transition: all 0.2s;
}

.tab-active {
  background: var(--primary-color, #4A90D9);
  color: #fff;
  font-weight: 600;
}

/* ── search bar ── */
.search-bar {
  position: relative;
  margin-bottom: 20rpx;
}

.search-input {
  width: 100%;
  height: 72rpx;
  background: var(--cell-bg);
  border: 3rpx solid var(--border-color);
  border-radius: 36rpx;
  padding: 0 80rpx 0 32rpx;
  font-size: 28rpx;
  color: var(--text-color);
  box-sizing: border-box;
}

.search-clear {
  position: absolute;
  right: 12rpx;
  top: 50%;
  transform: translateY(-50%);
  width: 48rpx;
  height: 48rpx;
  border-radius: 50%;
  background: var(--border-color);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 24rpx;
  color: var(--hint-color);
}

/* ── published badge ── */
.published-badge {
  font-size: 22rpx;
  flex-shrink: 0;
}

/* ── action bar ── */
.action-bar {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 16rpx;
  margin-bottom: 24rpx;
}

.filter-btns {
  display: flex;
  align-items: center;
  gap: 12rpx;
  width: 100%;
}

.filter-chip {
  padding: 8rpx 20rpx;
  border-radius: 24rpx;
  font-size: 24rpx;
  background: var(--cell-bg, #f5f5f5);
  color: var(--hint-color, #999);
  border: 2rpx solid var(--border-color, #e0e0e0);
}

.filter-active {
  background: #fff8e1;
  color: #e8923f;
  border-color: #e8923f;
}

.fav-btn {
  font-size: 32rpx !important;
  padding: 0 4rpx !important;
}

.fav-star {
  font-size: 32rpx;
}

.fav-tpl-card {
  cursor: pointer;
}

.create-card {
  display: flex;
  align-items: center;
  gap: 16rpx;
  padding: 28rpx 24rpx;
  border: 4rpx dashed var(--border-color);
  border-radius: 20rpx;
  flex: 1;
  background: var(--cell-bg);
  transition: transform 0.15s ease;
}

.create-card:active {
  transform: scale(0.98);
}

.create-icon {
  width: 56rpx;
  height: 56rpx;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 40rpx;
  font-weight: 300;
  color: var(--accent-color);
  border: 3rpx solid var(--accent-color);
  border-radius: 50%;
}

.create-text {
  font-size: 28rpx;
  font-weight: 700;
  color: var(--accent-color);
}

/* ── board list ── */
.board-list {
  display: flex;
  flex-direction: column;
  gap: 20rpx;
}

.board-card {
  background: var(--cell-bg);
  border-radius: 20rpx;
  padding: 24rpx;
  border: 3rpx solid var(--border-color);
  transition: transform 0.15s ease, box-shadow 0.2s ease;
}

.board-card:active {
  transform: scale(0.98);
}

.board-active {
  border-color: var(--accent-color);
  box-shadow: 0 4rpx 20rpx rgba(0, 0, 0, 0.08);
}

.board-card-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 12rpx;
}

.board-info {
  display: flex;
  align-items: center;
  gap: 12rpx;
  flex: 1;
  min-width: 0;
}

.board-title {
  font-size: 30rpx;
  font-weight: 800;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.active-badge {
  font-size: 20rpx;
  color: #fff;
  background: var(--accent-color);
  padding: 2rpx 14rpx;
  border-radius: 20rpx;
  flex-shrink: 0;
  font-weight: 600;
}

.board-actions {
  display: flex;
  gap: 12rpx;
  flex-shrink: 0;
}

.action-btn {
  font-size: 22rpx;
  padding: 6rpx 16rpx;
  border-radius: 12rpx;
}

.delete-btn {
  color: #b14b3c;
  background: rgba(177, 75, 60, 0.08);
}

.rename-btn {
  color: var(--accent-color);
  background: rgba(0, 0, 0, 0.04);
}

.clone-btn {
  color: var(--accent-color);
  background: rgba(0, 0, 0, 0.04);
}

.board-meta {
  display: flex;
  align-items: center;
  gap: 8rpx;
  margin-bottom: 16rpx;
}

.meta-item {
  font-size: 22rpx;
  color: var(--hint-color);
}

.meta-dot {
  font-size: 18rpx;
  color: var(--hint-color);
}

/* ── progress ── */
.progress-bar {
  height: 10rpx;
  background: var(--border-color);
  border-radius: 10rpx;
  overflow: hidden;
  margin-bottom: 8rpx;
}

.progress-fill {
  height: 100%;
  background: var(--btn-gradient, var(--accent-color));
  border-radius: 10rpx;
  transition: width 0.5s ease;
}

.progress-text {
  font-size: 20rpx;
  color: var(--hint-color);
}

/* ── loading skeleton ── */
.loading-area {
  display: flex;
  flex-direction: column;
  gap: 20rpx;
}

.skeleton-card {
  padding: 24rpx;
}

.skeleton-line {
  height: 24rpx;
  background: var(--skeleton-bg, #e0e0e0);
  border-radius: 8rpx;
  margin-bottom: 16rpx;
}

.skeleton-title {
  width: 50%;
  height: 30rpx;
}

.skeleton-meta {
  width: 70%;
}

.skeleton-bar {
  height: 10rpx;
  background: var(--skeleton-bg, #e0e0e0);
  border-radius: 10rpx;
}

/* ── empty ── */
.empty-area {
  padding: 120rpx 0;
  text-align: center;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 24rpx;
}

.empty-text {
  font-size: 26rpx;
  color: var(--hint-color);
}

.retry-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  margin-top: 24rpx;
  padding: 12rpx 40rpx;
  background: var(--btn-gradient, var(--btn-bg));
  color: var(--btn-color);
  border-radius: 999rpx;
  font-size: 26rpx;
  font-weight: 700;
}

.retry-text {
  color: var(--btn-color);
}

/* ── dialog ── */
.dialog-overlay {
  position: fixed;
  inset: 0;
  background: rgba(15, 23, 42, 0.4);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 100;
}

.dialog-panel {
  width: 80%;
  background: var(--panel-gradient, var(--cell-bg));
  border-radius: 24rpx;
  padding: 32rpx;
  display: flex;
  flex-direction: column;
  gap: 24rpx;
  border: 3rpx solid var(--border-color);
  animation: dialog-pop 0.3s cubic-bezier(0.34, 1.56, 0.64, 1) forwards;
}

@keyframes dialog-pop {
  0% { transform: scale(0.85); opacity: 0; }
  100% { transform: scale(1); opacity: 1; }
}

.dialog-title {
  font-size: 32rpx;
  font-weight: 800;
  text-align: center;
}

.dialog-input {
  border: 3rpx solid var(--border-color);
  background: var(--cell-bg);
  border-radius: 16rpx;
  padding: 16rpx 20rpx;
  font-size: 28rpx;
  color: var(--text-color);
}

.size-selector {
  display: flex;
  flex-direction: column;
  gap: 12rpx;
}

.size-label {
  font-size: 24rpx;
  font-weight: 600;
  color: var(--text-color);
}

.size-options {
  display: flex;
  flex-wrap: wrap;
  gap: 12rpx;
}

.size-chip {
  padding: 10rpx 20rpx;
  font-size: 24rpx;
  border: 2rpx solid var(--border-color);
  border-radius: 12rpx;
  color: var(--text-color);
  background: var(--cell-bg);
}

.size-chip-active {
  background: var(--accent-color);
  color: #fff;
  border-color: var(--accent-color);
}

.dialog-actions {
  display: flex;
  justify-content: flex-end;
  gap: 16rpx;
}

.dialog-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  height: 64rpx;
  padding: 0 32rpx;
  border-radius: 999rpx;
  font-size: 26rpx;
  font-weight: 700;
}

.dialog-btn.primary {
  background: var(--btn-gradient, var(--btn-bg));
  color: var(--btn-color);
  box-shadow: 0 4rpx 12rpx rgba(0, 0, 0, 0.12);
}

.dialog-btn.ghost {
  border: 3rpx solid var(--border-color);
  background: var(--cell-bg);
  color: var(--text-color);
}

button {
  margin: 0;
  padding: 0;
}

button::after {
  border: none;
}

button[size="mini"] {
  margin: 0;
}

/* ── cleanup button ── */
.cleanup-btn {
  padding: 20rpx 24rpx;
  border-radius: 20rpx;
  background: var(--cell-bg);
  border: 2rpx solid var(--border-color);
  flex-shrink: 0;
  transition: transform 0.15s ease;
}
.cleanup-btn:active {
  transform: scale(0.96);
}
.cleanup-text {
  font-size: 24rpx;
  color: #b14b3c;
  font-weight: 600;
  white-space: nowrap;
}

/* ── cleanup dialog ── */
.cleanup-panel {
  max-height: 70vh;
  display: flex;
  flex-direction: column;
}
.cleanup-desc {
  font-size: 26rpx;
  color: var(--hint-color, #888);
  margin-bottom: 16rpx;
}
.cleanup-list {
  max-height: 320rpx;
  margin-bottom: 16rpx;
  border: 1rpx solid var(--border-color, #eee);
  border-radius: 12rpx;
  padding: 8rpx 0;
}
.cleanup-item {
  padding: 14rpx 20rpx;
  display: flex;
  align-items: center;
  gap: 16rpx;
  border-bottom: 1rpx solid var(--border-color, #f0f0f0);
}
.cleanup-item:last-child {
  border-bottom: none;
}
.cleanup-item-info {
  flex: 1;
  display: flex;
  justify-content: space-between;
  align-items: center;
}
.cleanup-item-title {
  font-size: 26rpx;
  font-weight: 600;
  color: var(--text-color, #333);
}
.cleanup-item-meta {
  font-size: 22rpx;
  color: var(--hint-color, #999);
  flex-shrink: 0;
}
.dialog-btn.danger {
  color: #b14b3c !important;
  font-weight: 700;
}
.dialog-btn.danger[disabled] {
  opacity: 0.4;
}

/* ── checkbox ── */
.checkbox {
  width: 36rpx;
  height: 36rpx;
  border: 3rpx solid var(--border-color, #ccc);
  border-radius: 8rpx;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  transition: all 0.15s ease;
}
.checkbox.checked {
  background: var(--accent-color, #4a90d9);
  border-color: var(--accent-color, #4a90d9);
}
.check-icon {
  font-size: 22rpx;
  color: #fff;
  font-weight: 700;
}
.cleanup-select-all {
  display: flex;
  align-items: center;
  gap: 12rpx;
  padding: 12rpx 0;
  margin-bottom: 8rpx;
}
.select-all-text {
  font-size: 24rpx;
  color: var(--hint-color, #888);
}
.active-tag {
  font-size: 20rpx;
  color: var(--accent-color, #4a90d9);
  background: rgba(74, 144, 217, 0.1);
  padding: 2rpx 10rpx;
  border-radius: 6rpx;
  margin-left: 8rpx;
  font-weight: 600;
}

/* ── preview bottom sheet ── */
.preview-overlay {
  position: fixed;
  inset: 0;
  background: rgba(15, 23, 42, 0.5);
  z-index: 200;
  display: flex;
  align-items: flex-end;
  justify-content: center;
}

.preview-sheet {
  width: 100%;
  max-height: 85vh;
  background: var(--panel-gradient, var(--cell-bg, #fff));
  border-radius: 32rpx 32rpx 0 0;
  padding: 16rpx 32rpx 48rpx;
  display: flex;
  flex-direction: column;
  gap: 16rpx;
  animation: sheet-up 0.3s cubic-bezier(0.22, 1, 0.36, 1) forwards;
  overflow-y: auto;
}

@keyframes sheet-up {
  0% { transform: translateY(100%); }
  100% { transform: translateY(0); }
}

.preview-handle {
  width: 60rpx;
  height: 8rpx;
  background: var(--border-color, #ddd);
  border-radius: 4rpx;
  margin: 0 auto 8rpx;
}

.preview-header {
  display: flex;
  align-items: center;
  gap: 12rpx;
}

.preview-title {
  font-size: 36rpx;
  font-weight: 800;
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.preview-badges {
  display: flex;
  gap: 8rpx;
  flex-shrink: 0;
}

.preview-meta {
  display: flex;
  align-items: center;
  gap: 8rpx;
  margin-bottom: 8rpx;
}

.preview-grid-loading {
  padding: 40rpx 0;
  text-align: center;
}

.preview-grid {
  display: grid;
  gap: 6rpx;
  margin-bottom: 8rpx;
}

.preview-cell {
  aspect-ratio: 1;
  background: var(--cell-bg, #f8f8f8);
  border-radius: 8rpx;
  display: flex;
  align-items: center;
  justify-content: center;
  border: 1rpx solid var(--border-color, #eee);
  overflow: hidden;
  position: relative;
}

.preview-cell-done {
  background: rgba(74, 144, 217, 0.08);
  border-color: var(--accent-color, #4a90d9);
}

.preview-cell-text {
  font-size: 18rpx;
  color: var(--text-color, #333);
  text-align: center;
  padding: 4rpx;
  overflow: hidden;
  text-overflow: ellipsis;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
}

.preview-cell-img {
  width: 100%;
  height: 100%;
  position: absolute;
  inset: 0;
}

.preview-actions {
  display: flex;
  flex-direction: column;
  gap: 16rpx;
  padding-top: 8rpx;
}

.preview-btn-row {
  display: flex;
  gap: 16rpx;
}

.preview-btn {
  flex: 1;
  height: 80rpx;
  border-radius: 40rpx;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 28rpx;
  font-weight: 600;
  transition: transform 0.15s ease;
}

.preview-btn:active {
  transform: scale(0.97);
}

.preview-btn.primary {
  background: var(--btn-gradient, linear-gradient(135deg, #667eea 0%, #764ba2 100%));
  color: #fff;
}

.preview-btn.secondary {
  background: var(--cell-bg, #f5f5f5);
  border: 2rpx solid var(--border-color, #e0e0e0);
  color: var(--text-color, #333);
}
</style>
