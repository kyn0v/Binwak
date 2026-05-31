<template>
  <view class="publish-panel" @tap.stop>
    <view class="panel-header">
      <text class="panel-title">发布到广场</text>
      <view class="close-icon" @tap="$emit('close')">✕</view>
    </view>
    <view class="publish-desc">将当前Bingo卡发布为模板，其他用户可以使用</view>
    
    <view class="publish-section">
      <text class="publish-label">模板名称 *</text>
      <input 
        v-model="publishTitle" 
        class="bank-input publish-input" 
        maxlength="30" 
        placeholder="给模板起个名字" 
      />
    </view>

    <view class="publish-section">
      <text class="publish-label">简介（可选）</text>
      <textarea 
        v-model="publishDesc" 
        class="publish-textarea" 
        maxlength="100" 
        placeholder="简单介绍一下这个模板" 
      />
    </view>

    <view class="publish-section">
      <text class="publish-label">分类（可选）</text>
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

    <view class="publish-preview">
      <text class="publish-preview-title">预览</text>
      <view class="publish-preview-grid" :style="{ 'grid-template-columns': `repeat(${Math.min(gridSize, 4)}, 1fr)` }">
        <view 
          v-for="(cell, idx) in cells.slice(0, Math.min(gridSize * gridSize, 16))" 
          :key="idx" 
          class="publish-preview-cell"
        >
          <text>{{ cell.title || '·' }}</text>
        </view>
      </view>
    </view>

    <view class="publish-actions">
      <button 
        class="publish-btn cancel" 
        @tap="$emit('close')"
      >
        取消
      </button>
      <button 
        class="publish-btn" 
        :disabled="isPublishing || !publishTitle.trim()" 
        @tap="onPublishTemplate"
      >
        {{ isPublishing ? '发布中...' : '发布模板' }}
      </button>
    </view>
  </view>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import { createTemplate } from './api'
import { useAuth } from './useAuth'
import type { TemplateCategory } from '../../../../shared/types'

const props = defineProps<{
  gridSize: number
  cells: Array<{ title: string }>
  boardTitle: string
  currentPublishedTemplateId: number | null
}>()

const emit = defineEmits<{
  close: []
  published: [templateId: number]
}>()

const { ensureLoggedIn } = useAuth()

const publishTitle = ref(props.boardTitle !== '我的Bingo卡' ? props.boardTitle : '')
const publishDesc = ref('')
const publishCategory = ref<TemplateCategory | ''>('')
const isPublishing = ref(false)

const templateCategories = [
  { id: '', name: '不选择' },
  { id: 'creative', name: '🧠 脑洞大开' },
  { id: 'nicetry', name: '🎙️ Nice Try' },
]

async function onPublishTemplate() {
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
    const templateCells = props.cells.map((c, idx) => ({
      position: idx,
      title: c.title || '',
    }))

    const created = await createTemplate({
      title,
      description: publishDesc.value.trim() || undefined,
      gridSize: props.gridSize,
      cells: templateCells,
      category: publishCategory.value || undefined,
    })

    emit('published', created.id)
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
</script>

<style scoped>
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

/* ── publish panel ── */
.publish-panel {
  position: relative;
  z-index: 1;
  width: 88%;
  max-height: 85vh;
  background: var(--panel-gradient, var(--cell-bg));
  border-radius: 24rpx;
  padding: 28rpx;
  display: flex;
  flex-direction: column;
  gap: 20rpx;
  border: 3rpx solid var(--border-color);
  overflow-y: auto;
}

.publish-desc {
  font-size: 22rpx;
  color: var(--hint-color);
  line-height: 1.5;
  padding: 0 4rpx;
}

.publish-section {
  display: flex;
  flex-direction: column;
  gap: 8rpx;
}

.publish-label {
  font-size: 24rpx;
  color: var(--hint-color);
  font-weight: 500;
}

.publish-input {
  font-size: 26rpx !important;
}

.publish-textarea {
  width: 100%;
  min-height: 120rpx;
  background: var(--cell-bg);
  border-radius: 16rpx;
  padding: 16rpx;
  font-size: 24rpx;
  color: var(--text-color);
  box-sizing: border-box;
  border: none;
}

.category-picker {
  display: flex;
  flex-wrap: wrap;
  gap: 12rpx;
}

.category-option {
  padding: 8rpx 20rpx;
  background: var(--cell-bg);
  border-radius: 999rpx;
  font-size: 24rpx;
  color: var(--hint-color);
  border: 2rpx solid transparent;
  transition: all 0.2s ease;
}

.category-option.category-selected {
  background: rgba(102, 126, 234, 0.1);
  border-color: #667eea;
  color: #667eea;
}

.publish-preview {
  display: flex;
  flex-direction: column;
  gap: 8rpx;
  padding: 16rpx;
  background: rgba(0, 0, 0, 0.03);
  border-radius: 16rpx;
}

.publish-preview-title {
  font-size: 22rpx;
  color: var(--hint-color);
}

.publish-preview-grid {
  display: grid;
  gap: 8rpx;
}

.publish-preview-cell {
  aspect-ratio: 1;
  background: var(--cell-bg);
  border-radius: 8rpx;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 18rpx;
  color: var(--text-color);
  border: 1rpx solid var(--border-color);
  overflow: hidden;
  text-overflow: ellipsis;
}

.publish-actions {
  padding-top: 8rpx;
  display: flex;
  gap: 16rpx;
}

.publish-btn {
  flex: 1;
  height: 80rpx;
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  border-radius: 40rpx;
  color: #fff;
  font-size: 28rpx;
  font-weight: 600;
  border: none;
  transition: all 0.2s ease;
}

.publish-btn.cancel {
  background: #f0f0f0;
  color: #666;
}

.publish-btn:active {
  transform: scale(0.98);
  opacity: 0.9;
}

.publish-btn[disabled] {
  background: #ccc;
  color: #999;
}
</style>
