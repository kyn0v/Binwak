<template>
  <view class="page" :style="getThemeStyle()">
    <view class="page-header">
      <text class="page-title">发布到广场</text>
      <text class="page-subtitle">将当前Bingo卡发布为模板，其他用户可以使用</text>
    </view>

    <!-- Publish quota hint -->
    <view v-if="quota" class="quota-banner" :class="{ 'quota-exhausted': quota.dailyRemaining <= 0 }">
      <text v-if="quota.dailyRemaining > 0">📝 今日剩余 {{ quota.dailyRemaining }} 次发布机会</text>
      <text v-else>⏰ 今日发布次数已用完，明天再来吧</text>
    </view>

    <view class="publish-form">
      <view class="form-section">
        <text class="form-label">模板名称 *</text>
        <input
          v-model="publishTitle"
          class="form-input"
          maxlength="30"
          placeholder="给模板起个名字"
        />
      </view>

      <view class="form-section">
        <text class="form-label">简介（可选）</text>
        <textarea
          v-model="publishDesc"
          class="form-textarea"
          maxlength="100"
          placeholder="简单介绍一下这个模板"
        />
      </view>

      <view class="form-section">
        <text class="form-label">分类（可选）</text>
        <view class="category-picker">
          <view
            v-for="cat in templateCategories"
            :key="cat.id"
            class="category-option"
            :class="{ 'category-selected': publishCategory === cat.id }"
            @tap="publishCategory = cat.id as TemplateCategory | ''"
          >
            <text>{{ cat.name }}</text>
          </view>
        </view>
      </view>

      <!-- Grid preview -->
      <view class="preview-section">
        <text class="form-label">预览</text>
        <view class="preview-grid" :style="{ 'grid-template-columns': `repeat(${Math.min(gridSize, 5)}, 1fr)` }">
          <view
            v-for="(cell, idx) in cells.slice(0, gridSize * gridSize)"
            :key="idx"
            class="preview-cell"
          >
            <text>{{ cell.title || '·' }}</text>
          </view>
        </view>
      </view>

      <!-- Action buttons -->
      <view class="form-actions">
        <button class="action-btn cancel-btn" @tap="onCancel">取消</button>
        <button
          class="action-btn publish-btn"
          :disabled="isPublishing || !publishTitle.trim() || (quota && quota.dailyRemaining <= 0)"
          @tap="onPublish"
        >
          {{ isPublishing ? '发布中...' : '发布模板' }}
        </button>
      </view>
    </view>
  </view>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useTheme } from '../index/useTheme'
import { useBingoBoard } from '../index/useBingoBoard'
import { useAuth } from '../index/useAuth'
import { useSync } from '../index/useSync'
import { createTemplate, updateBoardPublish, getPublishQuota } from '../index/api'
import type { PublishQuota } from '../index/api'
import type { TemplateCategory } from '../../../../shared/types'

const { getThemeStyle, loadTheme } = useTheme()
const { gridSize, cells, boardTitle } = useBingoBoard()
const { ensureLoggedIn } = useAuth()
const { remoteBoardId } = useSync()

const publishTitle = ref('')
const publishDesc = ref('')
const publishCategory = ref<TemplateCategory | ''>('')
const isPublishing = ref(false)
const quota = ref<PublishQuota | null>(null)

const templateCategories = [
  { id: '', name: '不选择' },
  { id: 'creative', name: '🧠 脑洞大开' },
  { id: 'nicetry', name: '🎙️ Nice Try' },
]

function onCancel() {
  uni.navigateBack()
}

async function onPublish() {
  const title = publishTitle.value.trim()
  if (!title) {
    uni.showToast({ title: '请输入模板名称', icon: 'none' })
    return
  }

  const ok = await ensureLoggedIn()
  if (!ok) {
    uni.showToast({ title: '请先登录', icon: 'none' })
    return
  }

  isPublishing.value = true
  try {
    const templateCells = cells.value.map((c, idx) => ({
      position: idx,
      title: c.title || '',
    }))

    const created = await createTemplate({
      title,
      description: publishDesc.value.trim() || undefined,
      gridSize: gridSize.value,
      cells: templateCells,
      category: publishCategory.value || undefined,
    })

    // Associate template with board
    if (remoteBoardId.value) {
      try {
        await updateBoardPublish(remoteBoardId.value, created.id)
      } catch (e) {
        console.warn('关联模板ID失败:', e)
      }
    }

    // Notify the previous page via event channel
    const pages = getCurrentPages()
    if (pages.length >= 2) {
      const prevPage = pages[pages.length - 2] as any
      if (prevPage?.$vm?.onPublishSuccess) {
        prevPage.$vm.onPublishSuccess(created.id)
      }
    }

    // Use eventChannel if available
    uni.$emit('templatePublished', created.id)

    uni.showToast({ title: '🎉 发布成功', icon: 'none' })
    setTimeout(() => uni.navigateBack(), 800)
  } catch (err: any) {
    console.error('发布模板失败:', err)
    const msg = err?.message || ''
    if (msg.includes('用户不存在') || msg.includes('401') || msg.includes('FOREIGN KEY')) {
      uni.showToast({ title: '登录已过期，请重新登录', icon: 'none' })
    } else {
      uni.showToast({ title: msg || '发布失败，请重试', icon: 'none' })
    }
  } finally {
    isPublishing.value = false
  }
}

onMounted(async () => {
  loadTheme()
  // Pre-fill title from board title
  if (boardTitle.value && boardTitle.value !== '我的Bingo卡') {
    publishTitle.value = boardTitle.value
  }
  // Load publish quota
  try {
    quota.value = await getPublishQuota()
  } catch {
    // Silent fail — quota display is non-critical
  }
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
  padding: 16rpx 0 32rpx;
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
  line-height: 1.5;
}

/* ── quota banner ── */
.quota-banner {
  background: rgba(74, 144, 217, 0.1);
  border: 1rpx solid rgba(74, 144, 217, 0.3);
  border-radius: 16rpx;
  padding: 20rpx 24rpx;
  margin-bottom: 24rpx;
  font-size: 26rpx;
  color: #4A90D9;
}

.quota-exhausted {
  background: rgba(232, 93, 63, 0.1);
  border-color: rgba(232, 93, 63, 0.3);
  color: #E85D3F;
}

/* ── form ── */
.publish-form {
  display: flex;
  flex-direction: column;
  gap: 28rpx;
}

.form-section {
  display: flex;
  flex-direction: column;
  gap: 12rpx;
}

.form-label {
  font-size: 26rpx;
  color: var(--hint-color);
  font-weight: 600;
}

.form-input {
  width: 100%;
  height: 80rpx;
  background: var(--cell-bg);
  border: 3rpx solid var(--border-color);
  border-radius: 20rpx;
  padding: 0 24rpx;
  font-size: 28rpx;
  color: var(--text-color);
  box-sizing: border-box;
}

.form-textarea {
  width: 100%;
  min-height: 160rpx;
  background: var(--cell-bg);
  border: 3rpx solid var(--border-color);
  border-radius: 20rpx;
  padding: 20rpx 24rpx;
  font-size: 28rpx;
  color: var(--text-color);
  box-sizing: border-box;
}

/* ── category ── */
.category-picker {
  display: flex;
  flex-wrap: wrap;
  gap: 16rpx;
}

.category-option {
  padding: 12rpx 28rpx;
  background: var(--cell-bg);
  border-radius: 999rpx;
  font-size: 26rpx;
  color: var(--hint-color);
  border: 2rpx solid var(--border-color);
  transition: all 0.2s ease;
}

.category-option.category-selected {
  background: rgba(102, 126, 234, 0.1);
  border-color: #667eea;
  color: #667eea;
  font-weight: 600;
}

/* ── preview ── */
.preview-section {
  display: flex;
  flex-direction: column;
  gap: 12rpx;
  padding: 20rpx;
  background: rgba(0, 0, 0, 0.03);
  border-radius: 20rpx;
}

.preview-grid {
  display: grid;
  gap: 8rpx;
}

.preview-cell {
  aspect-ratio: 1;
  background: var(--cell-bg);
  border-radius: 8rpx;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 20rpx;
  color: var(--text-color);
  border: 1rpx solid var(--border-color);
  overflow: hidden;
  text-overflow: ellipsis;
  padding: 4rpx;
  text-align: center;
}

/* ── actions ── */
.form-actions {
  display: flex;
  gap: 20rpx;
  padding-top: 16rpx;
}

.action-btn {
  flex: 1;
  height: 88rpx;
  border-radius: 44rpx;
  font-size: 30rpx;
  font-weight: 700;
  border: none;
  transition: all 0.2s ease;
}

.action-btn:active {
  transform: scale(0.98);
}

.cancel-btn {
  background: var(--cell-bg) !important;
  color: var(--hint-color) !important;
  border: 2rpx solid var(--border-color) !important;
}

.publish-btn {
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%) !important;
  color: #fff !important;
}

.publish-btn[disabled] {
  background: #ccc !important;
  color: #999 !important;
}

button {
  margin: 0;
  padding: 0;
}

button::after {
  border: none;
}
</style>
