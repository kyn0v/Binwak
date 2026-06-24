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
  </view>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import { onLoad } from '@dcloudio/uni-app'
import { STORAGE_KEYS } from '@/config/storageKeys'
import { safeSet } from '@/utils/safeStorage'
import { login } from '@/pages/index/api'

const step = ref(0)
const animating = ref(true)
let touchStartX = 0

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
    await login()
    uni.reLaunch({ url: '/pages/main/main' })
  } catch {
    // Login failed (offline, etc.) — stay on welcome so the user can retry.
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
</style>
