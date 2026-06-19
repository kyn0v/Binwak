<template>
  <view class="main-container">
    <view class="tab-content" :style="{ paddingBottom: tabbarHeight + 'px' }">
      <view v-show="currentTab === 'index'" class="tab-pane tab-pane-noscroll"><IndexTab ref="indexRef" :status-bar-height="statusBarHeight" :capsule-top="capsuleTop" :capsule-right-rpx="capsuleRightRpx" /></view>
      <view v-if="currentTab === 'plaza'" class="tab-pane"><PlazaTab ref="plazaRef" :status-bar-height="statusBarHeight" :capsule-top="capsuleTop" :tabbar-height="tabbarHeight" /></view>
      <view v-if="profileMounted" v-show="currentTab === 'profile'" class="tab-pane"><ProfileTab ref="profileRef" :status-bar-height="statusBarHeight" /></view>
    </view>
    <!-- Canvas elements at page level so createSelectorQuery can find them -->
    <canvas type="2d" id="bingoCanvas" class="offscreen-canvas"></canvas>
    <canvas type="2d" id="cropCanvas" class="offscreen-canvas"></canvas>
    <canvas type="2d" id="polaroidCanvas" class="offscreen-canvas"></canvas>
    <!-- Persistent TabBar — fixed to bottom, never affected by page scroll -->
    <view class="custom-tabbar" :style="{ paddingBottom: safeAreaBottom + 'px' }">
      <view class="tabbar-inner">
        <view
          v-for="item in tabs"
          :key="item.id"
          class="tab-item"
          :class="{ 'tab-active': currentTab === item.id }"
          :style="{ width: (currentTab === item.id ? activeWidth : normalWidth) + 'px' }"
          @tap="switchTab(item.id)"
        >
          <image
            class="tab-icon"
            :src="currentTab === item.id ? item.iconActive : item.icon"
            mode="aspectFit"
          />
          <view v-if="currentTab === item.id" class="tab-label">{{ item.title }}</view>
        </view>
      </view>
    </view>
  </view>
</template>

<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue'
import { onLoad } from '@dcloudio/uni-app'
import { STORAGE_KEYS } from '@/config/storageKeys'
import { safeGet } from '@/utils/safeStorage'
import { navBarHeight, capsuleRightRpx as calcCapsuleRightRpx, tabbarHeight as calcTabbarHeight, tabWidths } from '@/utils/layout'
import IndexTab from '../index/index.vue'
import PlazaTab from '../plaza/plaza.vue'
import ProfileTab from '../profile/profile.vue'

const currentTab = ref('index')
const profileMounted = ref(false)
const safeAreaBottom = ref(0)
const statusBarHeight = ref(0)
const capsuleTop = ref(0)
const capsuleRightRpx = ref(24)
const tabbarHeight = ref(120) // fallback px, updated after mount
const activeWidth = ref(0)
const normalWidth = ref(0)

const indexRef = ref()
const plazaRef = ref()
const profileRef = ref()

const tabs = [
  {
    id: 'index',
    title: '挑战',
    icon: '/static/icons/tab_index.png',
    iconActive: '/static/icons/tab_index_active.png',
  },
  {
    id: 'plaza',
    title: '广场',
    icon: '/static/icons/tab_plaza.png',
    iconActive: '/static/icons/tab_plaza_active.png',
  },
  {
    id: 'profile',
    title: '我的',
    icon: '/static/icons/tab_profile.png',
    iconActive: '/static/icons/tab_profile_active.png',
  },
]

function switchTab(id: string) {
  if (id === currentTab.value) return
  currentTab.value = id
  if (id === 'profile') profileMounted.value = true
}

// Listen for cross-component tab switch requests
const onSwitchTab = (id: string) => { switchTab(id) }
uni.$on('switch-tab', onSwitchTab)
onUnmounted(() => { uni.$off('switch-tab', onSwitchTab) })

onLoad(() => {
  if (!safeGet(STORAGE_KEYS.ONBOARDED)) {
    uni.redirectTo({ url: '/pages/welcome/welcome' })
  }
})

onMounted(() => {
  try {
    const windowInfo = uni.getWindowInfo()
    const { statusBarHeight: statusBar = 0 } = windowInfo as any
    const menuBtn = uni.getMenuButtonBoundingClientRect()
    statusBarHeight.value = navBarHeight(statusBar, menuBtn)
    capsuleTop.value = menuBtn.top
    capsuleRightRpx.value = calcCapsuleRightRpx(windowInfo.windowWidth, menuBtn)
    safeAreaBottom.value = windowInfo.safeAreaInsets?.bottom || 0
    // tabbar: inner height (76rpx) + padding (16rpx top + 16rpx bottom) scaled + safe area
    tabbarHeight.value = calcTabbarHeight(windowInfo.windowWidth, safeAreaBottom.value)
    const widths = tabWidths(windowInfo.windowWidth, tabs.length)
    normalWidth.value = widths.normalWidth
    activeWidth.value = widths.activeWidth
  } catch {
    safeAreaBottom.value = 0
    tabbarHeight.value = 120
    capsuleRightRpx.value = 24
    normalWidth.value = 90
    activeWidth.value = 135
  }
})
</script>

<style scoped>
.main-container {
  display: flex;
  flex-direction: column;
  height: 100vh;
  overflow: hidden;
  background: transparent;
}

.tab-content {
  flex: 1;
  overflow: hidden;
  box-sizing: border-box;
}

.tab-pane {
  height: 100%;
  overflow-y: auto;
}

.tab-pane-noscroll {
  overflow-y: hidden;
}

.offscreen-canvas {
  position: fixed;
  left: -9999px;
  top: -9999px;
  width: 1500px;
  height: 1500px;
  pointer-events: none;
}

/* ── Persistent TabBar ── */
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
