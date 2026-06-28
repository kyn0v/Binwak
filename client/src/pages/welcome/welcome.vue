<template>
  <view class="welcome" @touchstart="onTouchStart" @touchend="onTouchEnd">
    <!-- Progress indicator -->
    <view class="dots">
      <view v-for="i in 3" :key="i" class="dot" :class="{ active: step === i - 1 }"></view>
    </view>

    <!-- Screen 1: Brand -->
    <view v-if="step === 0" class="screen screen-brand" :class="{ 'slide-in': animating }">
      <text class="brand-name">Binwak</text>
      <image class="brand-logo" src="/static/logo.png" mode="aspectFit" />
      <text class="brand-slogan">「Citywalk Bingo」</text>
    </view>

    <!-- Screen 2: How to play -->
    <view v-if="step === 1" class="screen screen-howto" :class="{ 'slide-in': animating }">
      <text class="howto-title">三步开始</text>
      <view class="steps">
        <view class="step-item">
          <view class="step-num">1</view>
          <view class="step-info">
            <text class="step-label">创建卡片</text>
            <text class="step-desc">选择模板或自定义你的 Bingo 卡</text>
          </view>
        </view>
        <view class="step-item">
          <view class="step-num">2</view>
          <view class="step-info">
            <text class="step-label">发现记录</text>
            <text class="step-desc">标记/拍照记录，完成挑战</text>
          </view>
        </view>
        <view class="step-item">
          <view class="step-num">3</view>
          <view class="step-info">
            <text class="step-label">分享美好</text>
            <text class="step-desc">和朋友一起挑战，分享你的 Bingo 卡</text>
          </view>
        </view>
      </view>
    </view>

    <!-- Screen 3: Start -->
    <view v-if="step === 2" class="screen screen-start" :class="{ 'slide-in': animating }">
      <image class="start-logo" src="/static/logo.png" mode="aspectFit" />
      <text class="start-title">准备好了吗？</text>
      <text class="start-desc">「好奇心和直觉是我们的向导」</text>
      <view class="start-btn" @tap="onStart">
        <text class="start-btn-text">开始探索</text>
      </view>
    </view>

    <!-- Bottom hint -->
    <view v-if="step < 2" class="hint">
      <text class="hint-text">左滑继续</text>
      <text class="skip" @tap="onStart">跳过</text>
    </view>

    <!-- First-registration username picker -->
    <view v-if="showNaming" class="name-mask" @tap.stop>
      <view class="name-card">
        <text class="name-title">给自己取个名字</text>
        <text class="name-sub">这个名字会展示在广场和分享里，之后也能在「我的」里修改</text>

        <input
          v-model="nameInput"
          type="nickname"
          class="name-input"
          :maxlength="20"
          placeholder="输入名字，或点击下方选项"
          confirm-type="done"
        />

        <view class="name-options">
          <view class="name-chip" @tap="useDefaultName">
            <text class="name-chip-text">默认 Binwak 名</text>
          </view>
          <view class="name-chip name-chip-hint">
            <text class="name-chip-text">点输入框可一键带出微信昵称</text>
          </view>
        </view>

        <view class="name-actions">
          <view class="name-btn name-btn-ghost" @tap="skipName">
            <text class="name-btn-text name-btn-text-ghost">使用默认</text>
          </view>
          <view class="name-btn name-btn-primary" :class="{ disabled: savingName }" @tap="confirmName">
            <text class="name-btn-text">{{ savingName ? '保存中…' : '确定' }}</text>
          </view>
        </view>
      </view>
    </view>
  </view>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import { onLoad } from '@dcloudio/uni-app'
import { STORAGE_KEYS } from '@/config/storageKeys'
import { safeSet } from '@/utils/safeStorage'
import { login, updateNickname } from '@/pages/index/api'

const step = ref(0)
const animating = ref(true)
let touchStartX = 0

// First-registration username picker state
const showNaming = ref(false)
const nameInput = ref('')
const defaultName = ref('')
const savingName = ref(false)

// Welcome page is a passive entry point - no auto-login
// Users must explicitly click "开始探索" to proceed

async function tryLogin() {
  try {
    // Log in for BOTH new and existing users, then enter the app via the same
    // clean reLaunch path. Previously only existing users (!isNewUser) were
    // navigated to main, so a brand-new user was left stranded on welcome with
    // ONBOARDED already set. A later incidental relaunch then dropped them onto
    // a half-initialised main reached through a non-clean route, where the
    // position:fixed custom tabbar fails to paint on the first iOS WeChat frame
    // (homepage visible but no tabbar, with the 返回首页 button showing).
    const res = await login()
    // Brand-new users get a one-time naming step before entering the app.
    // 微信号 cannot be obtained by mini-programs and 微信昵称 cannot be fetched
    // silently, so we offer the server default plus the WeChat-nickname input
    // affordance (type="nickname") rather than a pre-filled dropdown.
    if (res.isNewUser) {
      defaultName.value = res.nickname || ''
      nameInput.value = res.nickname || ''
      showNaming.value = true
      return
    }
    enterApp()
  } catch {
    // Login failed (offline, etc.) — stay on welcome so the user can retry.
  }
}

function enterApp() {
  uni.reLaunch({ url: '/pages/main/main' })
}

function useDefaultName() {
  nameInput.value = defaultName.value
}

function skipName() {
  if (defaultName.value) safeSet(STORAGE_KEYS.NICKNAME, defaultName.value)
  enterApp()
}

async function confirmName() {
  if (savingName.value) return
  const trimmed = nameInput.value.trim().slice(0, 20)
  if (!trimmed) {
    uni.showToast({ title: '名字不能为空', icon: 'none' })
    return
  }
  // Unchanged from the server-assigned default — no need to call the API.
  if (trimmed === defaultName.value) {
    safeSet(STORAGE_KEYS.NICKNAME, trimmed)
    enterApp()
    return
  }
  savingName.value = true
  try {
    const profile = await updateNickname(trimmed)
    safeSet(STORAGE_KEYS.NICKNAME, profile.nickname || trimmed)
    enterApp()
  } catch (err) {
    uni.showToast({ title: (err as Error).message || '保存失败，请换一个名字', icon: 'none' })
  } finally {
    savingName.value = false
  }
}

function onTouchStart(e: any) {
  touchStartX = e.touches[0].clientX
}

function onTouchEnd(e: any) {
  const dx = e.changedTouches[0].clientX - touchStartX
  if (dx < -50 && step.value < 2) {
    goTo(step.value + 1)
  } else if (dx > 50 && step.value > 0) {
    goTo(step.value - 1)
  }
}

function goTo(idx: number) {
  animating.value = false
  setTimeout(() => {
    step.value = idx
    animating.value = true
  }, 20)
}

async function onStart() {
  safeSet(STORAGE_KEYS.ONBOARDED, 'true')
  await tryLogin()
  // If tryLogin fails, user stays on welcome page
  // If tryLogin succeeds and user is new, main page will handle onboarding
}
</script>

<style scoped>
.welcome {
  height: 100vh;
  background: linear-gradient(180deg, #fdfcfb 0%, #f5f0eb 100%);
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 60rpx 48rpx;
  position: relative;
  overflow: hidden;
  box-sizing: border-box;
  touch-action: pan-x;
}

/* Progress dots */
.dots {
  position: absolute;
  top: 160rpx;
  display: flex;
  gap: 16rpx;
}

.dot {
  width: 16rpx;
  height: 16rpx;
  border-radius: 50%;
  background: #d4cfc9;
  transition: all 0.3s ease;
}

.dot.active {
  width: 40rpx;
  border-radius: 8rpx;
  background: #e8a87c;
}

/* Generic screen */
.screen {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  flex: 1;
  width: 100%;
  opacity: 0;
  transform: translateX(30rpx);
}

.slide-in {
  animation: slideIn 0.35s ease forwards;
}

@keyframes slideIn {
  from {
    opacity: 0;
    transform: translateX(30rpx);
  }
  to {
    opacity: 1;
    transform: translateX(0);
  }
}

/* Brand screen */
.brand-logo {
  width: 320rpx;
  height: 320rpx;
  margin-bottom: 32rpx;
}

.brand-name {
  font-size: 48rpx;
  font-weight: 800;
  letter-spacing: -1rpx;
  color: #1a1a1a;
  margin-bottom: 20rpx;
}

.brand-slogan {
  font-size: 36rpx;
  font-weight: 600;
  color: #e8a87c;
}

/* How-to screen */
.howto-title {
  font-size: 40rpx;
  font-weight: 700;
  color: #1a1a1a;
  margin-bottom: 56rpx;
}

.steps {
  width: 100%;
  display: flex;
  flex-direction: column;
  gap: 36rpx;
}

.step-item {
  display: flex;
  align-items: flex-start;
  gap: 28rpx;
  padding: 32rpx;
  background: rgba(255, 255, 255, 0.8);
  border-radius: 20rpx;
  box-shadow: 0 2rpx 12rpx rgba(0, 0, 0, 0.04);
}

.step-num {
  width: 56rpx;
  height: 56rpx;
  border-radius: 50%;
  background: linear-gradient(135deg, #e8a87c, #d4845f);
  color: #fff;
  font-size: 28rpx;
  font-weight: 700;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

.step-info {
  display: flex;
  flex-direction: column;
  gap: 6rpx;
}

.step-label {
  font-size: 30rpx;
  font-weight: 600;
  color: #1a1a1a;
}

.step-desc {
  font-size: 26rpx;
  color: #888;
  line-height: 1.5;
}

/* Start screen */
.start-logo {
  width: 240rpx;
  height: 240rpx;
  margin-bottom: 32rpx;
}

.start-title {
  font-size: 40rpx;
  font-weight: 700;
  color: #1a1a1a;
  margin-bottom: 16rpx;
}

.start-desc {
  font-size: 28rpx;
  color: #888;
  margin-bottom: 40rpx;
}

.start-btn {
  padding: 24rpx 80rpx;
  background: linear-gradient(135deg, #e8a87c, #d4845f);
  border-radius: 48rpx;
  box-shadow: 0 8rpx 24rpx rgba(232, 168, 124, 0.35);
}

.start-btn:active {
  transform: scale(0.96);
}

.start-btn-text {
  color: #fff;
  font-size: 32rpx;
  font-weight: 600;
}

/* Bottom */
.hint {
  position: absolute;
  bottom: 80rpx;
  width: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 0 48rpx;
  box-sizing: border-box;
}

.hint-text {
  font-size: 24rpx;
  color: #bbb;
}

.skip {
  position: absolute;
  right: 48rpx;
  font-size: 28rpx;
  color: #999;
  padding: 12rpx 24rpx;
}

/* First-registration naming overlay */
.name-mask {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(0, 0, 0, 0.45);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 0 48rpx;
  z-index: 100;
}

.name-card {
  width: 100%;
  max-width: 620rpx;
  background: #fff;
  border-radius: 28rpx;
  padding: 48rpx 40rpx 40rpx;
  box-shadow: 0 16rpx 48rpx rgba(0, 0, 0, 0.18);
  display: flex;
  flex-direction: column;
}

.name-title {
  font-size: 36rpx;
  font-weight: 700;
  color: #1a1a1a;
  text-align: center;
}

.name-sub {
  margin-top: 16rpx;
  font-size: 24rpx;
  color: #999;
  line-height: 1.5;
  text-align: center;
}

.name-input {
  margin-top: 36rpx;
  height: 88rpx;
  padding: 0 28rpx;
  background: #f5f0eb;
  border-radius: 16rpx;
  font-size: 30rpx;
  color: #1a1a1a;
}

.name-options {
  margin-top: 24rpx;
  display: flex;
  flex-wrap: wrap;
  gap: 16rpx;
}

.name-chip {
  padding: 14rpx 24rpx;
  background: #fdf6f0;
  border: 2rpx solid #f0d9c8;
  border-radius: 32rpx;
}

.name-chip:active {
  transform: scale(0.96);
}

.name-chip-hint {
  background: transparent;
  border-color: transparent;
}

.name-chip-text {
  font-size: 24rpx;
  color: #d4845f;
}

.name-chip-hint .name-chip-text {
  color: #bbb;
}

.name-actions {
  margin-top: 40rpx;
  display: flex;
  gap: 20rpx;
}

.name-btn {
  flex: 1;
  height: 88rpx;
  border-radius: 44rpx;
  display: flex;
  align-items: center;
  justify-content: center;
}

.name-btn:active {
  transform: scale(0.97);
}

.name-btn-ghost {
  background: #f3f0ec;
}

.name-btn-primary {
  background: linear-gradient(135deg, #e8a87c, #d4845f);
  box-shadow: 0 8rpx 24rpx rgba(232, 168, 124, 0.35);
}

.name-btn-primary.disabled {
  opacity: 0.6;
}

.name-btn-text {
  font-size: 30rpx;
  font-weight: 600;
  color: #fff;
}

.name-btn-text-ghost {
  color: #888;
}
</style>
