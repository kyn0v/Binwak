<template>
  <view v-show="visible" class="custom-tabbar" :style="{ paddingBottom: safeAreaBottom + 'px' }">
    <view class="tabbar-inner">
      <view
        v-for="item in tabs"
        :key="item.id"
        class="tab-item"
        :class="{ 'tab-active': current === item.id && ready }"
        :style="{ width: (current === item.id ? (ready ? activeWidth : normalWidth) : normalWidth) + 'px' }"
        @tap="switchTab(item.id, item.path)"
      >
        <image
          class="tab-icon"
          :src="current === item.id && ready ? item.iconActive : item.icon"
          mode="aspectFit"
        />
        <view v-if="current === item.id && ready" class="tab-label">{{ item.title }}</view>
      </view>
    </view>
  </view>
</template>

<script setup lang="ts">
import { ref, onMounted, nextTick } from 'vue'

const props = withDefaults(defineProps<{
  current: string
  visible?: boolean
}>(), {
  visible: true,
})

const safeAreaBottom = ref(0)
const activeWidth = ref(0)
const normalWidth = ref(0)
const ready = ref(false)

const tabs = [
  {
    id: 'index',
    title: '打卡',
    path: '/pages/index/index',
    icon: '/static/icons/tab_index.png',
    iconActive: '/static/icons/tab_index_active.png',
  },
  {
    id: 'plaza',
    title: '广场',
    path: '/pages/plaza/plaza',
    icon: '/static/icons/tab_plaza.png',
    iconActive: '/static/icons/tab_plaza_active.png',
  },
  {
    id: 'profile',
    title: '我的',
    path: '/pages/profile/profile',
    icon: '/static/icons/tab_profile.png',
    iconActive: '/static/icons/tab_profile_active.png',
  },
]

function switchTab(id: string, path: string) {
  if (id === props.current) return
  uni.switchTab({ url: path })
}

onMounted(() => {
  uni.hideTabBar({ animation: false })
  try {
    const windowInfo = uni.getWindowInfo()
    safeAreaBottom.value = windowInfo.safeAreaInsets?.bottom || 0
    const screenWidth = windowInfo.windowWidth
    const padding = 24
    const availableWidth = screenWidth - padding * 2
    const n = tabs.length
    const unit = availableWidth / (n + 0.5)
    normalWidth.value = Math.floor(unit)
    activeWidth.value = Math.floor(unit * 1.5)
  } catch {
    safeAreaBottom.value = 0
    normalWidth.value = 90
    activeWidth.value = 135
  }
  // Delay to trigger entrance spring animation
  setTimeout(() => { ready.value = true }, 50)
})
</script>

<style scoped>
.custom-tabbar {
  position: fixed;
  bottom: 0;
  left: 0;
  right: 0;
  background: rgba(255, 255, 255, 0.95);
  backdrop-filter: blur(20px);
  -webkit-backdrop-filter: blur(20px);
  border-top: 1rpx solid #f0ede8;
  z-index: 999;
}

.tabbar-inner {
  display: flex;
  align-items: center;
  padding: 16rpx 48rpx;
}

.tab-item {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 76rpx;
  border-radius: 200rpx;
  background: transparent;
  /* Width + background expand together = pill grows outward */
  transition: width 0.5s cubic-bezier(0.34, 1.56, 0.64, 1),
              background-color 0.35s ease;
}

.tab-item.tab-active {
  background-color: #f5f2ee;
}

.tab-icon {
  width: 36rpx;
  height: 36rpx;
  flex-shrink: 0;
  transition: transform 0.45s cubic-bezier(0.34, 1.56, 0.64, 1);
}

.tab-active .tab-icon {
  transform: scale(1.15);
}

.tab-label {
  margin-left: 12rpx;
  font-size: 20rpx;
  font-weight: 700;
  color: #5a4a3a;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  animation: labelIn 0.4s cubic-bezier(0.34, 1.56, 0.64, 1);
}

@keyframes labelIn {
  0% { opacity: 0; transform: translateX(-6rpx) scale(0.9); }
  100% { opacity: 1; transform: translateX(0) scale(1); }
}
</style>
