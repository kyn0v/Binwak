<template>
  <view class="feedback-page">
    <!-- Category tabs -->
    <view class="tab-bar">
      <view
        v-for="t in typeOptions"
        :key="t.value"
        class="tab-item"
        :class="{ 'tab-active': activeTab === t.value }"
        @tap="activeTab = t.value"
      >
        <text>{{ t.icon }} {{ t.label }}</text>
      </view>
    </view>

    <!-- Submit form -->
    <view class="section">
      <view class="section-title">{{ activeTab === 'bug' ? '🐞 报告 Bug' : '💡 提交建议' }}</view>
      <view class="form-card">
        <input
          v-model="form.title"
          class="form-input"
          placeholder="简短描述（必填）"
          maxlength="50"
        />

        <textarea
          v-model="form.content"
          class="form-textarea"
          :placeholder="activeTab === 'bug' ? '详细描述你遇到的问题，如何复现...' : '详细描述你希望添加的功能...'"
          maxlength="1000"
          :auto-height="false"
        />

        <!-- Image upload -->
        <view class="image-row">
          <view v-for="(img, idx) in form.images" :key="idx" class="image-thumb">
            <image :src="img" mode="aspectFill" class="thumb-img" @tap="previewImage(idx)" />
            <view class="thumb-remove" @tap="removeImage(idx)">✕</view>
          </view>
          <view v-if="form.images.length < maxImages" class="image-add" @tap="chooseImage">
            <text class="image-add-icon">+</text>
            <text class="image-add-text">图片</text>
          </view>
        </view>

        <button class="submit-btn" :disabled="submitting || !canSubmit" @tap="onSubmit">
          {{ submitting ? '提交中...' : '提交' }}
        </button>
      </view>
    </view>

    <!-- Success modal -->
    <view v-if="resultUrl" class="modal-overlay" @tap="closeResultModal">
      <view class="modal-box" @tap.stop>
        <text class="modal-title">工单已创建</text>
        <text class="result-url" user-select>{{ resultUrl }}</text>
        <view class="modal-actions">
          <button class="modal-btn modal-btn-cancel" @tap="closeResultModal">关闭</button>
          <button class="modal-btn modal-btn-confirm" @tap="copyUrl">复制链接</button>
        </view>
      </view>
    </view>

    <!-- My issues -->
    <view class="section">
      <view class="section-title" @tap="toggleMyIssues">
        📋 我的工单 <text class="toggle-arrow">{{ showMyIssues ? '▾' : '▸' }}</text>
      </view>
      <view v-if="showMyIssues">
        <view v-if="myIssuesLoading" class="loading-text">加载中...</view>
        <view v-else-if="myIssues.length === 0" class="empty-text">暂无工单</view>
        <view v-else class="issues-list">
          <view v-for="issue in myIssues" :key="issue.number" class="issue-item">
            <view class="issue-header">
              <text class="issue-title">{{ issue.title }}</text>
              <text class="issue-state" :class="issue.state">{{ issue.state === 'open' ? '进行中' : '已关闭' }}</text>
            </view>
            <view class="issue-footer">
              <text class="issue-date">{{ formatDate(issue.createdAt) }}</text>
              <text class="issue-copy" @tap="copyIssueUrl(issue.url)">复制链接</text>
            </view>
          </view>
        </view>
      </view>
    </view>

    <!-- Privacy modal -->
    <view v-if="showPrivacyModal" class="modal-overlay" @tap="showPrivacyModal = false">
      <view class="modal-box" @tap.stop>
        <text class="modal-title">隐私提示</text>
        <text class="modal-text">你的反馈将发布到 GitHub Issues 公开页面，请勿包含个人隐私信息（如手机号、微信号等）。</text>
        <view class="modal-actions">
          <button class="modal-btn modal-btn-cancel" @tap="showPrivacyModal = false">取消</button>
          <button class="modal-btn modal-btn-confirm" @tap="confirmSubmit">确认提交</button>
        </view>
      </view>
    </view>
  </view>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue'
import { createFeedback, getMyFeedbacks, uploadImage, isLoggedIn, login } from '../index/api'
import type { FeedbackType, FeedbackIssueItem } from '../../../../shared/types'
import { IMAGE_SIZE_TYPE } from '@/config/image'
import { MAX_FEEDBACK_IMAGES } from '@/config/limits'

const maxImages = MAX_FEEDBACK_IMAGES

const typeOptions = [
  { value: 'feature' as FeedbackType, label: '功能建议', icon: '💡' },
  { value: 'bug' as FeedbackType, label: 'Bug', icon: '🐞' },
]

const activeTab = ref<FeedbackType>('feature')

const form = ref({
  title: '',
  content: '',
  images: [] as string[],
  imagePaths: [] as string[],
})

const submitting = ref(false)
const showPrivacyModal = ref(false)
const resultUrl = ref('')

const canSubmit = computed(() =>
  form.value.title.trim().length > 0 && form.value.content.trim().length > 0
)

function chooseImage() {
  uni.chooseImage({
    count: maxImages - form.value.images.length,
    sizeType: [...IMAGE_SIZE_TYPE],
    sourceType: ['album', 'camera'],
    success: async (res) => {
      for (const path of res.tempFilePaths) {
        if (form.value.images.length >= maxImages) break
        form.value.images.push(path)
        try {
          const uploaded = await uploadImage(path)
          form.value.imagePaths.push(uploaded.fileName)
        } catch (err) {
          console.error('图片上传失败:', err)
          const idx = form.value.images.indexOf(path)
          if (idx >= 0) form.value.images.splice(idx, 1)
          uni.showToast({ title: '图片上传失败', icon: 'none' })
        }
      }
    },
  })
}

function removeImage(idx: number) {
  form.value.images.splice(idx, 1)
  form.value.imagePaths.splice(idx, 1)
}

function previewImage(idx: number) {
  uni.previewImage({
    urls: form.value.images,
    current: form.value.images[idx],
  })
}

async function onSubmit() {
  if (submitting.value || !canSubmit.value) return
  showPrivacyModal.value = true
}

async function confirmSubmit() {
  showPrivacyModal.value = false
  submitting.value = true

  if (!isLoggedIn()) {
    try { await login() } catch { /* ignore */ }
  }

  try {
    const result = await createFeedback({
      type: activeTab.value,
      title: form.value.title.trim(),
      content: form.value.content.trim(),
      images: form.value.imagePaths.length > 0 ? form.value.imagePaths : undefined,
    })

    resultUrl.value = result.issueUrl
    myIssues.value.unshift({
      number: result.issueNumber,
      title: `${activeTab.value === 'bug' ? '[Bug]' : '[Feature]'} ${form.value.title.trim()}`,
      url: result.issueUrl,
      state: 'open',
      createdAt: new Date().toISOString(),
    })
    uni.setStorageSync(CACHE_KEY, myIssues.value)
    showMyIssues.value = true

    form.value.title = ''
    form.value.content = ''
    form.value.images = []
    form.value.imagePaths = []

    uni.showToast({ title: '工单已创建', icon: 'none' })
  } catch (err) {
    uni.showToast({ title: (err as Error).message || '提交失败', icon: 'none' })
  } finally {
    submitting.value = false
  }
}

function copyUrl() {
  uni.setClipboardData({ data: resultUrl.value })
}

function closeResultModal() {
  resultUrl.value = ''
}

const showMyIssues = ref(false)
const myIssues = ref<FeedbackIssueItem[]>([])
const myIssuesLoading = ref(false)
const CACHE_KEY = 'binwak-my-issues'

async function loadMyIssues() {
  const cached = uni.getStorageSync(CACHE_KEY)
  if (cached) myIssues.value = cached

  if (!isLoggedIn()) return

  myIssuesLoading.value = myIssues.value.length === 0
  try {
    const res = await getMyFeedbacks()
    myIssues.value = res.issues
    uni.setStorageSync(CACHE_KEY, res.issues)
  } catch {
    // fallback to cache silently
  } finally {
    myIssuesLoading.value = false
  }
}

function formatDate(iso: string) {
  return iso.slice(0, 10)
}

function copyIssueUrl(url: string) {
  uni.setClipboardData({ data: url })
}

const myIssuesLoaded = ref(false)

function toggleMyIssues() {
  showMyIssues.value = !showMyIssues.value
  if (showMyIssues.value && !myIssuesLoaded.value) {
    myIssuesLoaded.value = true
    loadMyIssues()
  }
}
</script>

<style scoped>
.feedback-page {
  min-height: 100vh;
  background: linear-gradient(160deg, #f5f5f5 0%, #fafafa 60%, #f0f0f0 100%);
  padding-bottom: 60rpx;
}

.tab-bar {
  display: flex;
  background: #fff;
  padding: 16rpx 24rpx;
  gap: 16rpx;
  position: sticky;
  top: 0;
  z-index: 10;
}

.tab-item {
  flex: 1;
  text-align: center;
  padding: 16rpx 0;
  border-radius: 24rpx;
  font-size: 28rpx;
  color: #666;
  background: #f5f5f5;
  transition: all 0.2s;
}

.tab-item.tab-active {
  background: #333;
  color: #fff;
  font-weight: 600;
}

.section {
  margin-top: 24rpx;
}

.section-title {
  font-size: 28rpx;
  color: #666;
  padding: 16rpx 32rpx;
  font-weight: 600;
}

.form-card {
  background: rgba(255, 255, 255, 0.8);
  border-radius: 16rpx;
  margin: 0 24rpx;
  padding: 24rpx;
}

.form-input {
  width: 100%;
  height: 80rpx;
  background: #f8f8f8;
  border-radius: 12rpx;
  padding: 0 24rpx;
  font-size: 28rpx;
  margin-bottom: 16rpx;
  box-sizing: border-box;
}

.form-textarea {
  width: 100%;
  height: 200rpx;
  background: #f8f8f8;
  border-radius: 12rpx;
  padding: 20rpx 24rpx;
  font-size: 28rpx;
  margin-bottom: 16rpx;
  box-sizing: border-box;
}

.image-row {
  display: flex;
  gap: 16rpx;
  margin-bottom: 24rpx;
  flex-wrap: wrap;
}

.image-thumb {
  position: relative;
  width: 140rpx;
  height: 140rpx;
}

.thumb-img {
  width: 100%;
  height: 100%;
  border-radius: 12rpx;
}

.thumb-remove {
  position: absolute;
  top: -10rpx;
  right: -10rpx;
  width: 36rpx;
  height: 36rpx;
  border-radius: 50%;
  background: rgba(0, 0, 0, 0.6);
  color: #fff;
  font-size: 20rpx;
  display: flex;
  align-items: center;
  justify-content: center;
}

.image-add {
  width: 140rpx;
  height: 140rpx;
  border: 2rpx dashed #ccc;
  border-radius: 12rpx;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
}

.image-add-icon {
  font-size: 40rpx;
  color: #ccc;
}

.image-add-text {
  font-size: 22rpx;
  color: #ccc;
  margin-top: 4rpx;
}

.submit-btn {
  width: 100%;
  height: 80rpx;
  background: #333 !important;
  color: #fff !important;
  font-size: 30rpx !important;
  font-weight: 600;
  border-radius: 40rpx !important;
  border: none !important;
  line-height: 80rpx !important;
}

.submit-btn[disabled] {
  opacity: 0.4;
}

/* Result card */
.result-card {
  background: rgba(255, 255, 255, 0.9);
  border-radius: 16rpx;
  margin: 0 24rpx;
  padding: 32rpx;
  display: flex;
  flex-direction: column;
  gap: 16rpx;
}

.result-title {
  font-size: 32rpx;
  font-weight: 600;
  color: #333;
}

.result-url {
  font-size: 24rpx;
  color: #1565c0;
  word-break: break-all;
}

.copy-btn {
  margin-top: 20rpx;
  background: #333;
  color: #fff;
  font-size: 28rpx;
  border-radius: 24rpx;
  padding: 12rpx 0;
}

/* Privacy modal */
.modal-overlay {
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

.modal-box {
  background: #fff;
  border-radius: 24rpx;
  padding: 48rpx 40rpx 32rpx;
  width: 560rpx;
  display: flex;
  flex-direction: column;
  gap: 24rpx;
}

.modal-title {
  font-size: 32rpx;
  font-weight: 600;
  color: #333;
  text-align: center;
}

.modal-text {
  font-size: 28rpx;
  color: #666;
  line-height: 1.6;
}

.modal-actions {
  display: flex;
  gap: 16rpx;
  margin-top: 8rpx;
}

.modal-btn {
  flex: 1;
  height: 72rpx;
  border-radius: 36rpx;
  font-size: 28rpx;
  font-weight: 600;
  line-height: 72rpx;
  border: none !important;
}

.modal-btn-cancel {
  background: #f5f5f5 !important;
  color: #666 !important;
}

.modal-btn-confirm {
  background: #333 !important;
  color: #fff !important;
}

/* My issues */
.toggle-arrow {
  font-size: 24rpx;
  color: #999;
}

.loading-text, .empty-text {
  font-size: 26rpx;
  color: #999;
  padding: 24rpx;
  text-align: center;
}

.issues-list {
  display: flex;
  flex-direction: column;
  gap: 16rpx;
}

.issue-item {
  background: rgba(255, 255, 255, 0.9);
  border-radius: 12rpx;
  padding: 24rpx;
}

.issue-header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 16rpx;
}

.issue-title {
  font-size: 26rpx;
  color: #333;
  flex: 1;
}

.issue-state {
  font-size: 22rpx;
  padding: 4rpx 12rpx;
  border-radius: 8rpx;
  white-space: nowrap;
}

.issue-state.open {
  background: #e8f5e9;
  color: #2e7d32;
}

.issue-state.closed {
  background: #f3e5f5;
  color: #7b1fa2;
}

.issue-footer {
  display: flex;
  justify-content: space-between;
  margin-top: 12rpx;
}

.issue-date {
  font-size: 22rpx;
  color: #999;
}

.issue-copy {
  font-size: 22rpx;
  color: #1565c0;
}
</style>
