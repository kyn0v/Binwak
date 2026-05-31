<template>
  <view v-if="toast" class="milestone-toast" :class="{ 'milestone-toast-exit': exiting }">
    <text class="milestone-emoji">{{ toast.emoji }}</text>
    <text class="milestone-msg">{{ toast.msg }}</text>
  </view>
</template>

<script setup lang="ts">
defineProps<{
  toast: { emoji: string; msg: string } | null
  exiting: boolean
}>()
</script>

<style scoped>
/* ── milestone toast ── */
.milestone-toast {
  position: fixed;
  top: 180rpx;
  left: 50%;
  transform: translateX(-50%);
  display: flex;
  align-items: center;
  gap: 16rpx;
  padding: 20rpx 40rpx;
  background: rgba(255, 255, 255, 0.92);
  backdrop-filter: blur(20px);
  border-radius: 100rpx;
  box-shadow: 0 8rpx 32rpx rgba(0, 0, 0, 0.1);
  z-index: 101;
  animation: milestone-enter 0.45s cubic-bezier(0.34, 1.56, 0.64, 1) both;
}

.milestone-toast-exit {
  animation: milestone-leave 0.4s ease-in both;
}

.milestone-emoji {
  font-size: 40rpx;
  line-height: 1;
}

.milestone-msg {
  font-size: 28rpx;
  font-weight: 600;
  color: #3d3d3d;
  letter-spacing: 2rpx;
}

@keyframes milestone-enter {
  0% { opacity: 0; transform: translateX(-50%) translateY(-40rpx) scale(0.9); }
  100% { opacity: 1; transform: translateX(-50%) translateY(0) scale(1); }
}

@keyframes milestone-leave {
  0% { opacity: 1; transform: translateX(-50%) translateY(0); }
  100% { opacity: 0; transform: translateX(-50%) translateY(-30rpx); }
}
</style>
