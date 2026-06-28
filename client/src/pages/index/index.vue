<template>
  <view class="main-container">
    <view v-if="pageReady" class="tab-content" :style="{ paddingBottom: tabbarHeight + 'px' }">
      <view v-show="currentTab === 'index'" class="tab-pane tab-pane-noscroll"><IndexTab ref="indexRef" :capsule-top="capsuleTop" :capsule-right-rpx="capsuleRightRpx" /></view>
      <view v-if="currentTab === 'plaza'" class="tab-pane"><PlazaTab ref="plazaRef" :capsule-top="capsuleTop" /></view>
      <view v-if="profileMounted" v-show="currentTab === 'profile'" class="tab-pane"><ProfileTab ref="profileRef" :capsule-top="capsuleTop" /></view>
    </view>
    <!-- Canvas elements at page level so createSelectorQuery can find them -->
    <canvas type="2d" id="bingoCanvas" class="offscreen-canvas"></canvas>
    <canvas type="2d" id="cropCanvas" class="offscreen-canvas"></canvas>
    <canvas type="2d" id="polaroidCanvas" class="offscreen-canvas"></canvas>
    <!-- Persistent TabBar — fixed to bottom, never affected by page scroll -->
    <view v-if="onboarded" class="custom-tabbar" :style="{ paddingBottom: safeAreaBottom + 'px' }">
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
    <!-- First-launch onboarding overlay. Rendered in-page (not a separate route)
         so this index page stays the single home page in the nav stack and
         WeChat never shows the 返回首页 capsule. -->
    <WelcomeOverlay v-if="showOnboarding" @done="onOnboarded" />
  </view>
</template>

<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue'
import { onLoad } from '@dcloudio/uni-app'
import { STORAGE_KEYS } from '@/config/storageKeys'
import { safeGet, safeSet } from '@/utils/safeStorage'
import { capsuleRightRpx as calcCapsuleRightRpx, tabbarHeight as calcTabbarHeight, tabWidths } from '@/utils/layout'

import IndexTab from './board.vue'
import PlazaTab from '../plaza/plaza.vue'
import ProfileTab from '../profile/profile.vue'
import WelcomeOverlay from '@/components/WelcomeOverlay.vue'

const currentTab = ref('index')
const profileMounted = ref(false)
// Gate tab-content mounting until onboarding is confirmed. On a brand-new user
// the WelcomeOverlay covers the page; without this gate IndexTab would mount
// behind the overlay and kick off a login + initial-sync cycle that races the
// onboarding login, leaving remoteBoardId unset (uploads silently no-op) and
// the homepage half-rendered once the overlay closes.
const pageReady = ref(false)
// Tracks whether onboarding is confirmed. Set in onLoad (which fires before
// onMounted) and read in onMounted to decide whether to reveal the tab content.
const onboarded = ref(false)
// Drives the in-page onboarding overlay. Kept separate from `onboarded` so the
// overlay only mounts once layout has been measured (avoids a flash before the
// first paint settles), and is cleared the instant onboarding completes.
const showOnboarding = ref(false)
const safeAreaBottom = ref(0)
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
  // No redirect: brand-new users are onboarded via the in-page WelcomeOverlay
  // so this index page remains the single home page in the nav stack (no 返回首页 capsule).
  onboarded.value = !!safeGet(STORAGE_KEYS.ONBOARDED)
})

function onOnboarded() {
  safeSet(STORAGE_KEYS.ONBOARDED, 'true')
  showOnboarding.value = false
  onboarded.value = true
  pageReady.value = true
}

onMounted(() => {
  try {
    const windowInfo = uni.getWindowInfo()
    const menuBtn = uni.getMenuButtonBoundingClientRect()
    capsuleTop.value = menuBtn.top
    capsuleRightRpx.value = calcCapsuleRightRpx(windowInfo.windowWidth, menuBtn)
    safeAreaBottom.value = windowInfo.safeAreaInsets?.bottom || 0
    // tabbar: inner height (76rpx) + padding (16rpx top + 16rpx bottom) scaled + safe area
    tabbarHeight.value = calcTabbarHeight(windowInfo.windowWidth, safeAreaBottom.value)
    const widths = tabWidths(windowInfo.windowWidth, tabs.length)
    normalWidth.value = widths.normalWidth
    activeWidth.value = widths.activeWidth
  } catch {
    // Fallback when window/menu-button measurement throws (e.g. unsupported
    // platform). Conservative defaults sized for a ~375pt iPhone: tabbarHeight
    // ≈ 108rpx content + safe area, capsule right inset ≈ 24rpx, and tab widths
    // for a 3-tab bar. The UI stays usable; exact values self-correct on a
    // later successful measurement if one occurs.
    safeAreaBottom.value = 0
    tabbarHeight.value = 120
    capsuleRightRpx.value = 24
    normalWidth.value = 90
    activeWidth.value = 135
  }
  // Reveal tab content only after layout values are measured, so the header
  // offset and tabbar item widths are correct on the very first render. For a
  // brand-new user, keep the tabs gated and show the onboarding overlay instead;
  // onOnboarded() reveals the tabs once the overlay completes.
  if (onboarded.value) {
    pageReady.value = true
  } else {
    showOnboarding.value = true
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
  background: #ffffff;
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
