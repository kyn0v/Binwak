<template>
  <view class="profile-page" :style="{ paddingTop: props.capsuleTop + 'px' }">
    <!-- Header -->
    <view class="profile-header">
      <view class="avatar">
        <text class="avatar-icon">🎯</text>
      </view>
      <view class="user-info">
        <view class="username-row" @tap="onEditNickname">
          <text class="username">{{ displayName }}</text>
          <text class="edit-icon">✏️</text>
        </view>
        <text class="user-stat">已创建 {{ boardCount }} 张卡片</text>
      </view>
    </view>

    <!-- Menu list -->
    <view class="menu-section">
      <view class="section-title">我的内容</view>
      <view class="menu-list">
        <view class="menu-row" @tap="goToBoards">
          <text class="menu-icon">📋</text>
          <text class="menu-label">我的Bingo卡</text>
          <text class="menu-arrow">›</text>
        </view>
        <view v-if="ENABLE_TEMPLATE_PUBLISHING" class="menu-row" @tap="goToMyTemplates">
          <text class="menu-icon">📦</text>
          <text class="menu-label">我发布的模板</text>
          <text class="menu-value">{{ myTemplateCount }}</text>
          <text class="menu-arrow">›</text>
        </view>
        <view class="menu-row" @tap="openWordBank">
          <text class="menu-icon">📖</text>
          <text class="menu-label">词库管理</text>
          <text class="menu-value">{{ wordBankCount }} 词</text>
          <text class="menu-arrow">›</text>
        </view>
      </view>
    </view>

    <view class="menu-section">
      <view class="section-title">设置</view>
      <view class="menu-list">
        <view class="menu-row" @tap="toggleImageMode">
          <text class="menu-icon">📷</text>
          <text class="menu-label">图片存储</text>
          <text class="menu-value">{{ imageMode === 'cloud' ? '云端（持久）' : '本地（临时）' }}</text>
          <text class="menu-arrow">›</text>
        </view>
      </view>
    </view>

    <view class="menu-section">
      <view class="section-title">其他</view>
      <view class="menu-list">
        <view class="menu-row" @tap="goToFeedback">
          <text class="menu-icon">💬</text>
          <text class="menu-label">反馈建议</text>
          <text class="menu-arrow">›</text>
        </view>
        <view class="menu-row" @tap="showAbout">
          <text class="menu-icon">ℹ️</text>
          <text class="menu-label">关于</text>
          <text class="menu-arrow">›</text>
        </view>
      </view>
    </view>

    <!-- Bottom version number -->
    <view class="footer">
      <text class="version">Binwak v1.0.0</text>
    </view>

    <!-- About modal -->
    <view v-if="showAboutModal" class="about-overlay" @tap="showAboutModal = false">
      <view class="about-card" @tap.stop>
        <view class="about-close" @tap="showAboutModal = false">✕</view>
        <view class="about-body">
          <view class="about-icon">🎯</view>
          <text class="about-name">Binwak</text>
          <text class="about-version">v1.0.0</text>
          <text class="about-quote" user-select>「好奇心和直觉是我们的向导」</text>
          <text class="about-source" user-select> --《总有好书店》</text>
          <view class="about-divider"></view>
          <view class="about-credit-row" @tap="onCreditTap">
            <text class="about-credit">Inspired by </text>
            <text class="about-credit-link">NiceTry</text>
            <text class="about-credit"> 💡</text>
          </view>
          <text class="about-credit-hint">点击复制播客链接</text>
        </view>
      </view>
    </view>
  </view>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { onShow } from '@dcloudio/uni-app'
import { getBoards, getMyTemplates, getProfile, updateNickname, updateImageStorage } from '../index/api'
import { useWordBank } from '../index/useWordBank'
import { STORAGE_KEYS } from '@/config/storageKeys'
import { ENABLE_TEMPLATE_PUBLISHING } from '@/config/features'
import { safeGet, safeSet } from '@/utils/safeStorage'

const props = withDefaults(defineProps<{ capsuleTop?: number }>(), { capsuleTop: 0 })

const { wordBank, loadWordBank } = useWordBank()

const nickname = ref('')
const NICKNAME_KEY = STORAGE_KEYS.NICKNAME
const displayName = computed(() => nickname.value || 'Bingo 玩家')

const boardCount = ref(0)
const myTemplateCount = ref(0)
const imageMode = ref<'local' | 'cloud'>((safeGet(STORAGE_KEYS.IMAGE_MODE) as 'local' | 'cloud') || 'local')

const wordBankCount = computed(() => wordBank.value.length)

function openWordBank() {
  uni.navigateTo({ url: '/pages/wordbank/wordbank' })
}

function goToBoards() {
  uni.navigateTo({ url: '/pages/boards/boards' })
}

function goToMyTemplates() {
  uni.navigateTo({ url: '/pages/mytemplates/mytemplates' })
}

function goToFeedback() {
  uni.navigateTo({ url: '/pages/feedback/feedback' })
}

function toggleImageMode() {
  const items = ['本地（临时）', '云端（持久）']
  uni.showActionSheet({
    itemList: items,
    success: async ({ tapIndex }) => {
      const newMode = tapIndex === 0 ? 'local' : 'cloud'
      if (newMode === imageMode.value) return
      try {
        const profile = await updateImageStorage(newMode)
        imageMode.value = profile.imageStorage
        safeSet(STORAGE_KEYS.IMAGE_MODE, profile.imageStorage)
      } catch (err) {
        uni.showToast({ title: (err as Error).message || '切换失败，请重试', icon: 'none' })
        return
      }
      const msg = newMode === 'local'
        ? '已切换为本地，图片仅存设备上'
        : '已切换为云端，新照片将上传到服务器'
      uni.showToast({ title: msg, icon: 'none', duration: 2000 })
    },
  })
}

async function fetchTemplateCount() {
  try {
    const res = await getMyTemplates()
    myTemplateCount.value = res.total ?? res.templates.length
  } catch (_) { /* ignore */ }
}

const showAboutModal = ref(false)

function showAbout() {
  showAboutModal.value = true
}

function onCreditTap() {
  uni.setClipboardData({
    data: 'https://www.xiaoyuzhoufm.com/podcast/5e280faa418a84a0461f9e0a',
    success: () => {
      uni.showToast({ title: '播客链接已复制', icon: 'none' })
    },
  })
}

async function fetchStats() {
  try {
    const boards = await getBoards()
    boardCount.value = boards.length
  } catch (err) {
    console.error('获取统计失败:', err)
  }
}

async function fetchProfile() {
  // Read from local cache first to avoid flicker
  const cached = safeGet<string>(NICKNAME_KEY)
  if (cached) nickname.value = cached

  try {
    const profile = await getProfile()
    nickname.value = profile.nickname || ''
    safeSet(NICKNAME_KEY, nickname.value)
    if (profile.imageStorage) {
      imageMode.value = profile.imageStorage
      safeSet(STORAGE_KEYS.IMAGE_MODE, profile.imageStorage)
    }
  } catch (err) {
    console.warn('获取用户信息失败:', err)
  }
}

function onEditNickname() {
  // Use wx native input dialog
  // #ifdef MP-WEIXIN
  uni.showModal({
    title: '修改昵称',
    editable: true,
    placeholderText: '请输入昵称（最多20字）',
    content: nickname.value,
    success: async (res) => {
      if (res.confirm && res.content !== undefined) {
        const trimmed = res.content.trim().slice(0, 20)
        if (!trimmed) {
          uni.showToast({ title: '昵称不能为空', icon: 'none' })
          return
        }
        try {
          const profile = await updateNickname(trimmed)
          nickname.value = profile.nickname
          safeSet(NICKNAME_KEY, nickname.value)
          uni.showToast({ title: '已更新', icon: 'success' })
        } catch (err) {
          console.error('更新昵称失败:', err)
          uni.showToast({ title: (err as Error).message || '更新失败', icon: 'none' })
        }
      }
    },
  })
  // #endif
}

onMounted(() => {
  loadWordBank()
  fetchStats()
  fetchTemplateCount()
  fetchProfile()
})
</script>

<style scoped>
.profile-page {
  height: 100%;
  background: linear-gradient(160deg, #f5f5f5 0%, #fafafa 60%, #f0f0f0 100%);
  padding-bottom: 120rpx;
  box-sizing: border-box;
  overflow-y: auto;
  -webkit-overflow-scrolling: touch;
}

/* Header */
.profile-header {
  display: flex;
  align-items: center;
  padding: var(--header-top-gap, 20rpx) 32rpx 48rpx;
  background: linear-gradient(160deg, #f5f5f5 0%, #fafafa 60%, #f0f0f0 100%);
  backdrop-filter: none;
  -webkit-backdrop-filter: none;
  border-bottom: 1rpx solid rgba(0, 0, 0, 0.06);
}

.avatar {
  width: 120rpx;
  height: 120rpx;
  border-radius: 50%;
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  display: flex;
  align-items: center;
  justify-content: center;
}

.avatar-icon {
  font-size: 56rpx;
}

.user-info {
  margin-left: 24rpx;
  flex: 1;
}

.username {
  font-size: 36rpx;
  font-weight: 700;
  color: #333;
}

.username-row {
  display: flex;
  align-items: center;
  gap: 12rpx;
}

.edit-icon {
  font-size: 26rpx;
  opacity: 0.5;
}

.user-stat {
  font-size: 26rpx;
  color: #888;
  margin-top: 8rpx;
  display: block;
}

/* Menu section */
.menu-section {
  margin-top: 24rpx;
}

.section-title {
  font-size: 26rpx;
  color: #888;
  padding: 16rpx 32rpx;
  font-weight: 500;
}

.menu-list {
  background: rgba(255, 255, 255, 0.8);
  border-radius: 16rpx;
  margin: 0 24rpx;
  overflow: hidden;
}

.menu-row {
  display: flex;
  align-items: center;
  padding: 28rpx 32rpx;
  border-bottom: 1rpx solid #f0f0f0;
}

.menu-row:last-child {
  border-bottom: none;
}

.menu-row:active {
  background: rgba(245, 245, 245, 0.8);
}

.menu-icon {
  font-size: 36rpx;
  margin-right: 20rpx;
}

.menu-label {
  flex: 1;
  font-size: 30rpx;
  color: #333;
}

.menu-value {
  font-size: 28rpx;
  color: #888;
  margin-right: 12rpx;
}

.menu-arrow {
  font-size: 28rpx;
  color: #ccc;
}

/* Footer */
.footer {
  padding: 48rpx;
  text-align: center;
}

.version {
  font-size: 24rpx;
  color: #999;
}

.credit {
  font-size: 22rpx;
  color: #aaa;
  margin-top: 16rpx;
}

.credit-link {
  color: #888;
  text-decoration: underline;
}

/* About modal */
.about-overlay {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(0, 0, 0, 0.5);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
}

.about-card {
  width: 80%;
  max-width: 560rpx;
  background: #ffffff;
  border-radius: 24rpx;
  overflow: hidden;
  animation: slideUp 0.3s ease;
  position: relative;
}

.about-close {
  position: absolute;
  top: 20rpx;
  right: 20rpx;
  z-index: 1;
  width: 48rpx;
  height: 48rpx;
  border-radius: 50%;
  background: #f5f5f5;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 26rpx;
  color: #666;
}

.about-body {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 56rpx 40rpx 44rpx;
}

.about-icon {
  font-size: 72rpx;
  margin-bottom: 16rpx;
}

.about-name {
  font-size: 36rpx;
  font-weight: 700;
  color: #1a1a1a;
  letter-spacing: 1rpx;
}

.about-version {
  font-size: 22rpx;
  color: #bbb;
  margin-top: 6rpx;
}

.about-quote {
  font-size: 28rpx;
  color: #555;
  margin-top: 36rpx;
  font-style: italic;
  letter-spacing: 1rpx;
}

.about-source {
  font-size: 24rpx;
  color: #999;
  margin-top: 10rpx;
}

.about-divider {
  width: 64rpx;
  height: 2rpx;
  background: #e5e5e5;
  margin: 32rpx 0;
}

.about-credit-row {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6rpx;
}

.about-credit {
  font-size: 26rpx;
  color: #666;
}

.about-credit-link {
  font-size: 26rpx;
  color: #576b95;
  text-decoration: underline;
}

.about-credit-hint {
  font-size: 20rpx;
  color: #ccc;
  margin-top: 8rpx;
}

/* Modal overlay */
.modal-overlay {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(0, 0, 0, 0.5);
  display: flex;
  align-items: flex-end;
  z-index: 1000;
}

.modal-overlay.modal-centered {
  align-items: center;
  justify-content: center;
}

.modal-card {
  width: 100%;
  max-height: 70vh;
  background: rgba(255, 255, 255, 0.8);
  border-radius: 32rpx 32rpx 0 0;
  display: flex;
  flex-direction: column;
  animation: slideUp 0.3s ease;
}

@keyframes slideUp {
  from {
    transform: translateY(100%);
  }
  to {
    transform: translateY(0);
  }
}

.modal-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 32rpx;
  border-bottom: 1rpx solid #eee;
}

.modal-title {
  font-size: 32rpx;
  font-weight: 600;
  color: #333;
}

.modal-close {
  width: 56rpx;
  height: 56rpx;
  border-radius: 50%;
  background: #f5f5f5;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 28rpx;
  color: #666;
}

.modal-body {
  flex: 1;
  padding: 24rpx;
  min-height: 300rpx;
}

.loading-state,
.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 60rpx;
  color: #888;
}

.empty-icon {
  font-size: 64rpx;
  margin-bottom: 16rpx;
}

.empty-text {
  font-size: 30rpx;
  color: #666;
}

.empty-hint {
  font-size: 26rpx;
  color: #999;
  margin-top: 8rpx;
}

.template-list {
  display: flex;
  flex-direction: column;
  gap: 16rpx;
}

.template-row {
  display: flex;
  align-items: center;
  padding: 20rpx;
  background: rgba(245, 245, 245, 0.8);
  border-radius: 12rpx;
}

.template-info {
  flex: 1;
}

.template-title {
  font-size: 28rpx;
  font-weight: 500;
  color: #333;
  display: block;
}

.template-meta {
  font-size: 24rpx;
  color: #888;
  margin-top: 4rpx;
  display: block;
}

.template-actions {
  margin-left: 16rpx;
}

.action-delete {
  font-size: 26rpx;
  color: #e53935;
  padding: 8rpx 16rpx;
}

.action-edit {
  font-size: 26rpx;
  color: #667eea;
  padding: 8rpx 16rpx;
}

/* Word bank styles */
.word-bank-add {
  display: flex;
  align-items: center;
  gap: 12rpx;
  padding: 16rpx 24rpx;
  border-bottom: 1rpx solid #f0f0f0;
}

.word-input {
  flex: 1;
  height: 72rpx;
  background: #f5f5f5;
  border-radius: 36rpx;
  padding: 0 24rpx;
  font-size: 28rpx;
}

.add-btn {
  width: 72rpx;
  height: 72rpx;
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #fff;
  font-size: 40rpx;
  font-weight: 300;
}

.word-list {
  display: flex;
  flex-direction: column;
}

.word-row {
  display: flex;
  align-items: center;
  padding: 20rpx 0;
  border-bottom: 1rpx solid #f0f0f0;
  box-sizing: border-box;
  overflow: hidden;
}

.word-row:last-child {
  border-bottom: none;
}

.word-text {
  flex: 1;
  min-width: 0;
  font-size: 28rpx;
  color: #333;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.word-actions {
  display: flex;
  flex-shrink: 0;
  gap: 8rpx;
}

/* Edit word modal */
.edit-word-card {
  width: 80%;
  background: rgba(255, 255, 255, 0.8);
  border-radius: 24rpx;
  padding: 32rpx;
  display: flex;
  flex-direction: column;
  gap: 24rpx;
}

.edit-title {
  font-size: 32rpx;
  font-weight: 600;
  color: #333;
  text-align: center;
}

.edit-actions {
  display: flex;
  justify-content: flex-end;
  gap: 24rpx;
}

.edit-cancel {
  font-size: 28rpx;
  color: #888;
  padding: 12rpx 24rpx;
}

.edit-save {
  font-size: 28rpx;
  color: #667eea;
  font-weight: 600;
  padding: 12rpx 24rpx;
}
</style>
