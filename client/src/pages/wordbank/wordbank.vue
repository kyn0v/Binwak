<template>
  <view class="page" :style="getThemeStyle()">
    <view class="page-header">
      <view class="page-header-row">
        <view>
          <text class="page-title">词库管理</text>
          <text class="page-subtitle">{{ wordBank.length }} / 100 个词语</text>
        </view>
        <text v-if="wordBank.length > 0" class="batch-toggle" @tap="toggleBatchMode">
          {{ batchMode ? '完成' : '管理' }}
        </text>
      </view>
    </view>

    <!-- Batch action bar -->
    <view v-if="batchMode" class="batch-bar">
      <text class="batch-select-all" @tap="toggleSelectAll">
        {{ isAllSelected ? '取消全选' : '全选' }}
      </text>
      <text class="batch-count">已选 {{ selectedIndices.size }} 项</text>
      <text
        class="batch-delete-btn"
        :class="{ disabled: selectedIndices.size === 0 }"
        @tap="batchDelete"
      >删除</text>
    </view>

    <!-- Add new word -->
    <view class="add-bar">
      <input
        v-model="newWordText"
        class="add-input"
        maxlength="20"
        placeholder="输入新词语"
        @confirm="addWordToBank"
      />
      <view class="add-btn" @tap="addWordToBank">
        <text class="add-btn-text">+</text>
      </view>
    </view>

    <!-- Search -->
    <view v-if="wordBank.length > 10" class="search-bar">
      <input
        v-model="searchKeyword"
        class="search-input"
        placeholder="🔍 搜索词语..."
      />
      <view v-if="searchKeyword" class="search-clear" @tap="searchKeyword = ''">✕</view>
    </view>

    <!-- Word list -->
    <view v-if="wordBank.length === 0" class="empty-area">
      <text class="empty-icon">📚</text>
      <text class="empty-text">词库为空</text>
      <text class="empty-hint">添加一些词语用于 Bingo 卡吧</text>
    </view>

    <scroll-view v-else scroll-y class="word-list" :scroll-top="scrollTopVal" @scroll="onScroll">
      <view
        v-for="(word, idx) in filteredWords"
        :key="`word-${idx}`"
        class="word-row"
        @tap="batchMode ? toggleSelect(getOriginalIndex(word)) : undefined"
      >
        <!-- Batch checkbox -->
        <view v-if="batchMode" class="batch-checkbox" :class="{ checked: selectedIndices.has(getOriginalIndex(word)) }">
          <text v-if="selectedIndices.has(getOriginalIndex(word))" class="batch-check-icon">✓</text>
        </view>
        <!-- Illustration thumbnail -->
        <view v-if="!batchMode" class="word-illust" @tap.stop="pickIllustration(word)">
          <image
            v-if="illustMap[word]"
            :src="illustMap[word]"
            class="word-illust-img"
            mode="aspectFill"
          />
          <text v-else class="word-illust-placeholder">🎨</text>
        </view>
        <text class="word-text">{{ word }}</text>
        <view v-if="!batchMode" class="word-actions">
          <text class="action-edit" @tap.stop="startEditWord(getOriginalIndex(word))">编辑</text>
          <text class="action-delete" @tap.stop="removeWordFromBank(getOriginalIndex(word))">删除</text>
        </view>
      </view>
    </scroll-view>

    <!-- Edit word dialog -->
    <!-- Back to top -->
    <view v-if="showBackToTop" class="back-to-top" @tap="scrollToTop">
      <text class="back-to-top-icon">↑</text>
    </view>

    <view v-if="showEditor" class="dialog-overlay" @tap="showEditor = false">
      <view class="dialog-panel" @tap.stop>
        <text class="dialog-title">编辑词语</text>
        <input
          v-model="editWordText"
          class="dialog-input"
          maxlength="20"
          placeholder="请输入词语"
          @confirm="saveEditWord"
        />
        <view class="dialog-actions">
          <button class="dialog-btn ghost" size="mini" :plain="true" hover-class="none" @tap="showEditor = false">取消</button>
          <button class="dialog-btn primary" size="mini" :plain="true" hover-class="none" @tap="saveEditWord">保存</button>
        </view>
      </view>
    </view>
  </view>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useTheme } from '../index/useTheme'
import { useWordBank } from '../index/useWordBank'
import { useBingoBoard } from '../index/useBingoBoard'
import { fetchIllustrations, uploadIllustration, replaceWordBank } from '../index/api'
import { IMAGE_SIZE_TYPE } from '@/config/image'
import type { Illustration } from '../../../../shared/types'

const { getThemeStyle, loadTheme } = useTheme()
const { wordBank, loadWordBank, addWord, updateWord, removeWord } = useWordBank()
const { cells } = useBingoBoard()

const newWordText = ref('')
const searchKeyword = ref('')
const showEditor = ref(false)
const editWordText = ref('')
const editWordIndex = ref<number | null>(null)
const showBackToTop = ref(false)
const scrollTopVal = ref(0)
let lastScrollTop = 0

// Batch mode
const batchMode = ref(false)
const selectedIndices = ref<Set<number>>(new Set())
let wordBankSyncing = false
let pendingWordBankSync = false

const isAllSelected = computed(() =>
  filteredWords.value.length > 0 &&
  filteredWords.value.every(w => selectedIndices.value.has(getOriginalIndex(w)))
)

function toggleBatchMode() {
  batchMode.value = !batchMode.value
  selectedIndices.value = new Set()
}

function toggleSelect(idx: number) {
  const s = new Set(selectedIndices.value)
  if (s.has(idx)) s.delete(idx)
  else s.add(idx)
  selectedIndices.value = s
}

function toggleSelectAll() {
  if (isAllSelected.value) {
    selectedIndices.value = new Set()
  } else {
    const s = new Set<number>()
    for (const w of filteredWords.value) s.add(getOriginalIndex(w))
    selectedIndices.value = s
  }
}

async function syncWordBankLatest() {
  if (wordBankSyncing) {
    pendingWordBankSync = true
    return
  }
  wordBankSyncing = true
  do {
    pendingWordBankSync = false
    try {
      await replaceWordBank([...wordBank.value])
    } catch (err: any) {
      uni.showToast({ title: err?.message || '词库同步失败', icon: 'none' })
    }
  } while (pendingWordBankSync)
  wordBankSyncing = false
}

function batchDelete() {
  if (selectedIndices.value.size === 0) return
  const count = selectedIndices.value.size
  uni.showModal({
    title: '批量删除',
    content: `确定删除选中的 ${count} 个词语吗？`,
    success(res) {
      if (!res.confirm) return
      const indices = [...selectedIndices.value].sort((a, b) => b - a)
      for (const idx of indices) removeWord(idx)
      selectedIndices.value = new Set()
      batchMode.value = false
      syncWordBankLatest()
      uni.showToast({ title: `已删除 ${count} 个词语`, icon: 'success' })
    },
  })
}

// Illustration data
const illustrations = ref<Illustration[]>([])
const illustMap = computed(() => {
  const map: Record<string, string> = {}
  for (const ill of illustrations.value) {
    if (ill.imageUrl) map[ill.word] = ill.imageUrl
  }
  return map
})

async function loadIllustrations() {
  try {
    illustrations.value = await fetchIllustrations()
  } catch {
    // Silent fail — illustrations are optional
  }
}

async function pickIllustration(word: string) {
  uni.chooseImage({
    count: 1,
    sizeType: [...IMAGE_SIZE_TYPE],
    sourceType: ['album'],
    success: async (res) => {
      const tempPath = res.tempFilePaths[0]
      uni.showLoading({ title: '上传中...' })
      try {
        const result = await uploadIllustration(tempPath, word)
        // Update local state
        const idx = illustrations.value.findIndex(i => i.word === word)
        if (idx >= 0) {
          illustrations.value[idx] = result
        } else {
          illustrations.value.push(result)
        }
        // Trigger reactivity
        illustrations.value = [...illustrations.value]
        uni.showToast({ title: '插画已更新', icon: 'success' })
      } catch (err: any) {
        uni.showToast({ title: err.message || '上传失败', icon: 'none' })
      } finally {
        uni.hideLoading()
      }
    },
  })
}

function onScroll(e: any) {
  const top = e.detail.scrollTop || 0
  showBackToTop.value = top > 600
  lastScrollTop = top
}

function scrollToTop() {
  scrollTopVal.value = lastScrollTop
  setTimeout(() => { scrollTopVal.value = 0 }, 20)
}

const filteredWords = computed(() => {
  const kw = searchKeyword.value.trim().toLowerCase()
  if (!kw) return wordBank.value
  return wordBank.value.filter(w => w.toLowerCase().includes(kw))
})

function getOriginalIndex(word: string): number {
  return wordBank.value.indexOf(word)
}

const adding = ref(false)

async function addWordToBank() {
  const text = newWordText.value.trim()
  if (!text || adding.value) return
  adding.value = true
  try {
    const result = await addWord(text)
    if (result === 'ok') {
      newWordText.value = ''
    } else if (result === 'moderation_fail') {
      uni.showToast({ title: '内容含违规信息，请修改', icon: 'none' })
    } else if (result === 'duplicate') {
      uni.showToast({ title: '该词已存在', icon: 'none' })
    } else if (result === 'full') {
      uni.showToast({ title: '词库已满', icon: 'none' })
    }
  } finally {
    adding.value = false
  }
}

function removeWordFromBank(idx: number) {
  const word = wordBank.value[idx]
  if (word === undefined) return
  const inUse = cells.value.some(c => c.title === word)

  uni.showModal({
    title: inUse ? '该词正在使用中' : '删除词语',
    content: `确定删除"${word}"吗？${inUse ? '（当前Bingo卡中正在使用）' : ''}`,
    success(res) {
      if (res.confirm) {
        removeWord(idx)
        syncWordBankLatest()
      }
    },
  })
}

function startEditWord(idx: number) {
  editWordIndex.value = idx
  editWordText.value = wordBank.value[idx]
  showEditor.value = true
}

async function saveEditWord() {
  if (editWordIndex.value === null) return
  const text = editWordText.value.trim()
  if (!text) {
    uni.showToast({ title: '词语不能为空', icon: 'none' })
    return
  }
  const result = await updateWord(editWordIndex.value, text)
  if (result === 'ok') {
    showEditor.value = false
  } else if (result === 'moderation_fail') {
    uni.showToast({ title: '内容含违规信息，请修改', icon: 'none' })
  } else {
    uni.showToast({ title: '更新失败', icon: 'none' })
  }
}

onMounted(() => {
  loadTheme()
  loadWordBank()
  loadIllustrations()
})
</script>

<style>
.page {
  min-height: 100vh;
  padding: 32rpx;
  box-sizing: border-box;
  background: var(--page-bg);
  color: var(--text-color);
  font-family: 'PingFang SC', 'SF Pro Display', 'Helvetica Neue', sans-serif;
}

.page-header {
  padding: 16rpx 0 24rpx;
}

.page-title {
  display: block;
  font-size: 44rpx;
  font-weight: 900;
  letter-spacing: 2rpx;
}

.page-subtitle {
  display: block;
  font-size: 24rpx;
  color: var(--hint-color);
  margin-top: 8rpx;
}

/* ── add bar ── */
.add-bar {
  display: flex;
  gap: 16rpx;
  margin-bottom: 20rpx;
}

.add-input {
  flex: 1;
  height: 72rpx;
  background: var(--cell-bg);
  border: 3rpx solid var(--border-color);
  border-radius: 36rpx;
  padding: 0 24rpx;
  font-size: 28rpx;
  color: var(--text-color);
  box-sizing: border-box;
}

.add-btn {
  width: 72rpx;
  height: 72rpx;
  border-radius: 50%;
  background: var(--btn-gradient, var(--accent-color));
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

.add-btn:active {
  transform: scale(0.95);
}

.add-btn-text {
  font-size: 40rpx;
  color: #fff;
  font-weight: 300;
}

/* ── search ── */
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

/* ── empty ── */
.empty-area {
  padding: 120rpx 0;
  text-align: center;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 12rpx;
}

.empty-icon {
  font-size: 64rpx;
}

.empty-text {
  font-size: 28rpx;
  color: var(--hint-color);
}

.empty-hint {
  font-size: 24rpx;
  color: var(--hint-color);
  opacity: 0.6;
}

/* ── word list ── */
.word-list {
  max-height: calc(100vh - 400rpx);
}

.word-row {
  display: flex;
  align-items: center;
  gap: 16rpx;
  padding: 20rpx 16rpx;
  background: var(--cell-bg);
  border-radius: 16rpx;
  margin-bottom: 12rpx;
  border: 2rpx solid var(--border-color);
}

.word-illust {
  width: 72rpx;
  height: 72rpx;
  border-radius: 12rpx;
  background: rgba(0, 0, 0, 0.03);
  border: 2rpx dashed var(--border-color);
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  overflow: hidden;
}

.word-illust:active {
  opacity: 0.7;
}

.word-illust-img {
  width: 100%;
  height: 100%;
}

.word-illust-placeholder {
  font-size: 28rpx;
  opacity: 0.4;
}

.word-text {
  flex: 1;
  font-size: 28rpx;
  font-weight: 600;
  color: var(--text-color);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.word-actions {
  display: flex;
  gap: 16rpx;
  flex-shrink: 0;
}

.action-edit {
  font-size: 24rpx;
  color: var(--accent-color);
  padding: 6rpx 16rpx;
  border-radius: 12rpx;
  background: rgba(0, 0, 0, 0.04);
}

.action-delete {
  font-size: 24rpx;
  color: #b14b3c;
  padding: 6rpx 16rpx;
  border-radius: 12rpx;
  background: rgba(177, 75, 60, 0.08);
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

.back-to-top {
  position: fixed;
  right: 32rpx;
  bottom: 120rpx;
  width: 72rpx;
  height: 72rpx;
  border-radius: 50%;
  background: rgba(255, 255, 255, 0.92);
  box-shadow: 0 4rpx 16rpx rgba(0, 0, 0, 0.12);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 50;
  animation: fade-in 0.2s ease;
}

.back-to-top:active {
  transform: scale(0.9);
}

.back-to-top-icon {
  font-size: 28rpx;
  font-weight: 700;
  color: #555;
}

@keyframes fade-in {
  from { opacity: 0; transform: scale(0.8); }
  to { opacity: 1; transform: scale(1); }
}

/* ── batch mode ── */
.page-header-row {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
}

.batch-toggle {
  font-size: 28rpx;
  color: var(--accent-color);
  padding: 8rpx 20rpx;
  border-radius: 12rpx;
  background: rgba(0, 0, 0, 0.04);
  margin-top: 16rpx;
}

.batch-bar {
  display: flex;
  align-items: center;
  gap: 20rpx;
  margin-bottom: 20rpx;
  padding: 16rpx 20rpx;
  background: var(--cell-bg);
  border-radius: 16rpx;
  border: 2rpx solid var(--border-color);
}

.batch-select-all {
  font-size: 26rpx;
  color: var(--accent-color);
  font-weight: 600;
  padding: 8rpx 20rpx;
  border-radius: 999rpx;
  border: 2rpx solid var(--accent-color);
}

.batch-count {
  flex: 1;
  font-size: 24rpx;
  color: var(--hint-color);
}

.batch-delete-btn {
  font-size: 26rpx;
  color: #fff;
  background: #b14b3c;
  padding: 8rpx 24rpx;
  border-radius: 999rpx;
  font-weight: 600;
}

.batch-delete-btn.disabled {
  opacity: 0.4;
}

.batch-checkbox {
  width: 44rpx;
  height: 44rpx;
  border-radius: 50%;
  border: 3rpx solid var(--border-color);
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  transition: all 0.15s ease;
}

.batch-checkbox.checked {
  background: var(--accent-color);
  border-color: var(--accent-color);
}

.batch-check-icon {
  font-size: 24rpx;
  color: #fff;
  font-weight: 700;
}
</style>
