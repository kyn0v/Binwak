<template>
  <view v-if="show" class="bingo-overlay" @tap.stop="$emit('dismiss')">
    <view class="confetti-container">
      <view v-for="n in 15" :key="n" :class="['confetti', `confetti-${n}`]"></view>
    </view>
    <view class="bingo-content" @tap.stop>
      <view class="bingo-text">
        <text v-if="isAllDone" class="bingo-trophy">🏆</text>
        <text class="bingo-line1">CityWalk</text>
        <text v-if="!isAllDone" class="bingo-ordinal-big" :style="{ color: ordinalColor }">{{ bingoOrdinalLabel }}</text>
        <text class="bingo-line2">Bingo!</text>
        <text v-if="isAllDone" class="bingo-all-done-hint">✨ Grand Slam ✨</text>
      </view>
      <view class="bingo-actions">
        <button class="bingo-btn primary" @tap="$emit('dismiss')">
          {{ isAllDone ? '太棒了！' : '继续挑战' }}
        </button>
        <view class="bingo-btn-row">
          <button class="bingo-btn secondary" @tap="$emit('preview')">预览卡片</button>
          <button v-if="ENABLE_TEMPLATE_PUBLISHING && isAllDone && !currentPublishedTemplateId" class="bingo-btn secondary" @tap="$emit('publish')">发布广场</button>
          <button v-else class="bingo-btn secondary" @tap="$emit('share')">分享</button>
        </view>
      </view>
    </view>
  </view>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { ENABLE_TEMPLATE_PUBLISHING } from '@/config/features'

const props = defineProps<{
  show: boolean
  isAllDone: boolean
  bingoLineCount: number
  currentPublishedTemplateId: number | null
}>()

defineEmits<{
  dismiss: []
  preview: []
  share: []
  publish: []
}>()

const ordinalColors = ['#ffd166', '#ff9f43', '#06d6a0', '#4cc9f0', '#a29bfe']

const bingoOrdinalLabel = computed(() => {
  const count = props.bingoLineCount
  if (count <= 0) return ''
  const suffixes = ['th', 'st', 'nd', 'rd']
  const v = count % 100
  const suffix = (v >= 11 && v <= 13) ? 'th' : (suffixes[v % 10] || 'th')
  return `${count}${suffix}`
})

const ordinalColor = computed(() => {
  const count = props.bingoLineCount
  if (count <= 0) return ordinalColors[0]
  return ordinalColors[(count - 1) % ordinalColors.length]
})
</script>

<style scoped>
/* ── bingo overlay ── */
.bingo-overlay {
  position: fixed;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(15, 23, 42, 0.45);
  z-index: 100;
}

.bingo-text {
  display: flex;
  flex-direction: column;
  align-items: center;
  z-index: 2;
  animation: bingo-pop 0.6s cubic-bezier(0.34, 1.56, 0.64, 1) forwards;
  pointer-events: none;
}

/* radial glow behind bingo text */
.bingo-text::before {
  content: '';
  position: absolute;
  width: 600rpx;
  height: 600rpx;
  border-radius: 50%;
  background: radial-gradient(circle, rgba(255, 107, 107, 0.3) 0%, rgba(255, 107, 107, 0) 70%);
  z-index: -1;
  animation: glow-pulse 2s ease-in-out infinite alternate;
  pointer-events: none;
}

@keyframes glow-pulse {
  0% { transform: scale(0.9); opacity: 0.6; }
  100% { transform: scale(1.2); opacity: 1; }
}

.bingo-trophy {
  font-size: 120rpx;
  line-height: 1.2;
  animation: slide-in-left 0.5s ease-out 0.05s both;
}

.bingo-line1 {
  font-size: 48rpx;
  font-weight: 700;
  color: rgba(255, 255, 255, 0.85);
  letter-spacing: 8rpx;
  text-shadow: 0 3rpx 12rpx rgba(0, 0, 0, 0.25);
  animation: slide-in-left 0.5s ease-out 0.1s both;
}

.bingo-ordinal-big {
  font-size: 80rpx;
  font-weight: 900;
  letter-spacing: 4rpx;
  line-height: 1.1;
  margin-top: 4rpx;
  text-shadow: 0 6rpx 20rpx currentColor;
  animation: slide-in-right 0.45s ease-out 0.2s both;
}

.bingo-line2 {
  font-size: 108rpx;
  font-weight: 900;
  color: #ff6b6b;
  letter-spacing: 4rpx;
  text-shadow:
    0 6rpx 24rpx rgba(255, 107, 107, 0.45),
    0 2rpx 6rpx rgba(0, 0, 0, 0.25);
  line-height: 1.1;
  margin-top: 2rpx;
  animation: slide-in-right 0.5s ease-out 0.25s both;
}

.bingo-descriptor {
  font-size: 40rpx;
  font-weight: 700;
  color: #ffb347;
  letter-spacing: 8rpx;
  text-transform: uppercase;
  text-shadow: 0 4rpx 16rpx rgba(255, 179, 71, 0.5);
  margin-top: 12rpx;
  animation: slide-in-up 0.4s ease-out 0.5s both;
}

.bingo-multiplier {
  font-size: 56rpx;
  font-weight: 800;
  color: #ffb347;
  letter-spacing: 8rpx;
  text-shadow: 0 4rpx 16rpx rgba(255, 179, 71, 0.5);
  margin-top: 8rpx;
  text-transform: uppercase;
  animation: slide-in-up 0.4s ease-out 0.5s both;
}

.bingo-ordinal {
  font-size: 28rpx;
  font-weight: 600;
  color: rgba(255, 255, 255, 0.55);
  letter-spacing: 6rpx;
  text-transform: uppercase;
  margin-top: 16rpx;
  animation: slide-in-up 0.4s ease-out 0.65s both;
}

/* ── confetti ── */
.confetti-container {
  position: absolute;
  inset: 0;
  overflow: hidden;
  pointer-events: none;
}

.confetti {
  position: absolute;
  top: -20rpx;
  width: 16rpx;
  height: 24rpx;
  border-radius: 4rpx;
  will-change: transform, opacity;
  animation: confetti-fall linear infinite;
}

@keyframes bingo-pop {
  0% { transform: scale(0.3); opacity: 0; }
  100% { transform: scale(1); opacity: 1; }
}

@keyframes slide-in-left {
  0% { transform: translateX(-200rpx); opacity: 0; }
  100% { transform: translateX(0); opacity: 1; }
}

@keyframes slide-in-right {
  0% { transform: translateX(200rpx); opacity: 0; }
  100% { transform: translateX(0); opacity: 1; }
}

@keyframes slide-in-up {
  0% { transform: translateY(60rpx); opacity: 0; }
  100% { transform: translateY(0); opacity: 1; }
}

@keyframes confetti-fall {
  0% {
    transform: translateY(0) rotateZ(0deg);
    opacity: 1;
  }
  80% {
    opacity: 1;
  }
  100% {
    transform: translateY(110vh) rotateZ(540deg);
    opacity: 0;
  }
}

/* 15 confetti pieces */
.confetti-1  { left: 5%;  background: #ff6b6b; animation-duration: 2.8s; animation-delay: 0.0s; width: 14rpx; height: 20rpx; }
.confetti-2  { left: 12%; background: #ffd166; animation-duration: 3.2s; animation-delay: 0.2s; width: 12rpx; height: 28rpx; }
.confetti-3  { left: 19%; background: #06d6a0; animation-duration: 2.6s; animation-delay: 0.1s; width: 16rpx; height: 16rpx; border-radius: 50%; }
.confetti-4  { left: 26%; background: #4cc9f0; animation-duration: 3.0s; animation-delay: 0.3s; width: 10rpx; height: 26rpx; }
.confetti-5  { left: 33%; background: #ff9f43; animation-duration: 2.9s; animation-delay: 0.15s; width: 14rpx; height: 22rpx; }
.confetti-6  { left: 40%; background: #a29bfe; animation-duration: 3.3s; animation-delay: 0.4s; width: 12rpx; height: 18rpx; border-radius: 50%; }
.confetti-7  { left: 47%; background: #ff6b6b; animation-duration: 2.7s; animation-delay: 0.05s; width: 16rpx; height: 24rpx; }
.confetti-8  { left: 54%; background: #ffd166; animation-duration: 3.1s; animation-delay: 0.25s; width: 10rpx; height: 20rpx; }
.confetti-9  { left: 61%; background: #06d6a0; animation-duration: 2.5s; animation-delay: 0.35s; width: 18rpx; height: 14rpx; }
.confetti-10 { left: 68%; background: #4cc9f0; animation-duration: 3.4s; animation-delay: 0.1s; width: 12rpx; height: 28rpx; border-radius: 50%; }
.confetti-11 { left: 75%; background: #ff9f43; animation-duration: 2.8s; animation-delay: 0.45s; width: 14rpx; height: 22rpx; }
.confetti-12 { left: 82%; background: #a29bfe; animation-duration: 3.0s; animation-delay: 0.2s; width: 16rpx; height: 16rpx; }
.confetti-13 { left: 89%; background: #ff6b6b; animation-duration: 2.6s; animation-delay: 0.5s; width: 10rpx; height: 26rpx; }
.confetti-14 { left: 94%; background: #ffd166; animation-duration: 3.2s; animation-delay: 0.3s; width: 14rpx; height: 20rpx; border-radius: 50%; }
.confetti-15 { left: 2%;  background: #06d6a0; animation-duration: 2.9s; animation-delay: 0.15s; width: 12rpx; height: 24rpx; }

/* ── bingo popup content & actions ── */
.bingo-content {
  display: flex;
  flex-direction: column;
  align-items: center;
  z-index: 2;
}

.bingo-all-done-hint {
  font-size: 32rpx;
  font-weight: 600;
  color: #ffd166;
  letter-spacing: 10rpx;
  text-shadow: 0 3rpx 12rpx rgba(255, 209, 102, 0.4);
  margin-top: 16rpx;
  animation: slide-in-up 0.4s ease-out 0.5s both;
}

.bingo-actions {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 20rpx;
  margin-top: 48rpx;
  animation: slide-in-up 0.5s ease-out 0.7s both;
  position: relative;
  z-index: 3;
}

.bingo-btn {
  border: none;
  border-radius: 48rpx;
  font-size: 30rpx;
  font-weight: 600;
  padding: 20rpx 48rpx;
  min-width: 240rpx;
  text-align: center;
  transition: transform 0.15s ease, box-shadow 0.15s ease;
}

.bingo-btn:active {
  transform: scale(0.96);
}

.bingo-btn.primary {
  background: linear-gradient(135deg, #ff6b6b 0%, #ff8e8e 100%);
  color: #fff;
  box-shadow: 0 8rpx 24rpx rgba(255, 107, 107, 0.4);
}

.bingo-btn.secondary {
  background: rgba(255, 255, 255, 0.15);
  color: rgba(255, 255, 255, 0.9);
  backdrop-filter: blur(8px);
  border: 1px solid rgba(255, 255, 255, 0.2);
}

.bingo-btn-row {
  display: flex;
  gap: 20rpx;
}

.bingo-btn-row .bingo-btn {
  min-width: 180rpx;
  padding: 16rpx 32rpx;
  font-size: 26rpx;
}
</style>
