<template>
  <view class="page" :style="getThemeStyle()">
    <view class="page-header">
      <text class="page-title">我发布的模板</text>
      <text class="page-subtitle">{{ myTemplates.length }} 个模板</text>
    </view>

    <view v-if="loading" class="loading-area">
      <view v-for="n in 3" :key="n" class="skeleton-card">
        <view class="skeleton-line skeleton-title"></view>
        <view class="skeleton-line skeleton-meta"></view>
      </view>
    </view>

    <view v-else-if="myTemplates.length === 0" class="empty-area">
      <text class="empty-icon">📭</text>
      <text class="empty-text">还没有发布过模板</text>
      <text class="empty-hint">在Bingo卡设置中可以发布模板</text>
    </view>

    <scroll-view v-else scroll-y class="template-list" :scroll-top="scrollTopVal" @scroll="onScroll">
      <view
        v-for="tpl in myTemplates"
        :key="tpl.id"
        class="template-row"
      >
        <view class="template-info">
          <text class="template-title">{{ tpl.title }}</text>
          <text class="template-meta">{{ tpl.gridSize }}×{{ tpl.gridSize }} · {{ tpl.useCount }} 人使用 · ⭐ {{ tpl.favoriteCount || 0 }}</text>
        </view>
        <view class="template-actions">
          <text class="action-delete" @tap="onDeleteTemplate(tpl.id)">删除</text>
        </view>
      </view>
    </scroll-view>

    <!-- Back to top -->
    <view v-if="showBackToTop" class="back-to-top" @tap="scrollToTop">
      <text class="back-to-top-icon">↑</text>
    </view>
  </view>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useTheme } from '../index/useTheme'
import { getMyTemplates, deleteTemplate } from '../index/api'
import type { TemplateListItem } from '../../../../shared/types'

const { getThemeStyle, loadTheme } = useTheme()

const myTemplates = ref<TemplateListItem[]>([])
const loading = ref(true)
const showBackToTop = ref(false)
const scrollTopVal = ref(0)
let lastScrollTop = 0

function onScroll(e: any) {
  const top = e.detail.scrollTop || 0
  showBackToTop.value = top > 600
  lastScrollTop = top
}

function scrollToTop() {
  scrollTopVal.value = lastScrollTop
  setTimeout(() => { scrollTopVal.value = 0 }, 20)
}

async function fetchMyTemplates() {
  loading.value = true
  try {
    const res = await getMyTemplates()
    myTemplates.value = res.templates
  } catch (err) {
    console.error('获取模板失败:', err)
  } finally {
    loading.value = false
  }
}

async function onDeleteTemplate(id: number) {
  uni.showModal({
    title: '删除模板',
    content: '确定要删除这个模板吗？',
    confirmColor: '#b14b3c',
    success: async (res) => {
      if (res.confirm) {
        try {
          await deleteTemplate(id)
          myTemplates.value = myTemplates.value.filter(t => t.id !== id)
          uni.showToast({ title: '已删除', icon: 'success' })
        } catch (err) {
          console.error('删除失败:', err)
          uni.showToast({ title: (err as Error).message || '删除失败', icon: 'none' })
        }
      }
    },
  })
}

onMounted(() => {
  loadTheme()
  fetchMyTemplates()
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

/* ── loading ── */
.loading-area {
  display: flex;
  flex-direction: column;
  gap: 20rpx;
}

.skeleton-card {
  background: var(--cell-bg);
  border-radius: 20rpx;
  padding: 24rpx;
  border: 3rpx solid var(--border-color);
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

/* ── template list ── */
.template-list {
  max-height: calc(100vh - 250rpx);
}

.template-row {
  display: flex;
  align-items: center;
  gap: 16rpx;
  padding: 24rpx 16rpx;
  background: var(--cell-bg);
  border-radius: 16rpx;
  margin-bottom: 12rpx;
  border: 2rpx solid var(--border-color);
}

.template-info {
  flex: 1;
  min-width: 0;
}

.template-title {
  display: block;
  font-size: 28rpx;
  font-weight: 700;
  color: var(--text-color);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.template-meta {
  display: block;
  font-size: 22rpx;
  color: var(--hint-color);
  margin-top: 8rpx;
}

.template-actions {
  flex-shrink: 0;
}

.action-delete {
  font-size: 24rpx;
  color: #b14b3c;
  padding: 8rpx 20rpx;
  border-radius: 12rpx;
  background: rgba(177, 75, 60, 0.08);
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
</style>
