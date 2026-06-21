<template>
  <view class="plaza-page">
    <!-- Sticky header: title + tab + search + category tags -->
    <view
      class="plaza-sticky-header"
      :style="{ position: 'fixed', top: '0', left: '0', right: '0', zIndex: 100, paddingTop: props.capsuleTop + 'px' }"
    >
      <view class="plaza-header">
        <text class="plaza-title">模板广场</text>
        <text class="plaza-subtitle">发现有趣的 Bingo 挑战</text>
      </view>
      <!-- Top tabs: Discover / My favorites -->
      <view class="top-tabs">
        <view class="top-tab" :class="{ 'top-tab-active': topTab === 'discover' }" @tap="switchTopTab('discover')">
          <text>🧭 发现</text>
        </view>
        <view class="top-tab" :class="{ 'top-tab-active': topTab === 'favorites' }" @tap="switchTopTab('favorites')">
          <text>⭐ 我的收藏</text>
        </view>
      </view>
      <!-- Shared search box -->
      <view class="search-bar">
        <input
          class="search-input"
          type="text"
          placeholder="🔍 搜索模板..."
          :value="searchKeyword"
          @input="onSearchInput"
          @confirm="onSearchConfirm"
          confirm-type="search"
        />
        <view v-if="searchKeyword" class="search-clear" @tap="clearSearch">✕</view>
      </view>
    </view>

    <!-- Category tags: separate fixed element (scroll-view can't be inside fixed container) -->
    <scroll-view
      class="category-tabs category-tabs-fixed"
      scroll-x
      enable-flex
      :style="{ top: (headerBottom - 12) + 'px' }"
    >
      <view
        v-for="cat in categories"
        :key="cat.id ?? 'all'"
        class="category-tab"
        :class="{ 'category-active': currentCategory === cat.id }"
        @tap="selectCategory(cat.id)"
      >
        <text class="category-name">{{ cat.name }}</text>
      </view>
    </scroll-view>

    <!-- Sort bar: fixed below category tabs, discover tab only -->
    <view
      v-if="topTab === 'discover' && layoutReady"
      class="sort-bar sort-bar-fixed"
      id="sort-bar"
      :style="{ top: (categoryBottom - 8) + 'px' }"    >
      <view class="sort-option" :class="{ 'sort-active': currentSort === 'recommend' }" @tap="currentSort = 'recommend'">综合</view>
      <view class="sort-option" :class="{ 'sort-active': currentSort === 'newest' }" @tap="currentSort = 'newest'">最新</view>
    </view>

    <!-- Content area: fixed scroll-view with precise height -->
    <scroll-view
      v-if="topTab === 'discover' && layoutReady"
      class="template-list template-list-fixed"
      scroll-y
      :style="{ top: contentTop + 'px', height: contentHeight + 'px' }"
      :scroll-top="scrollTopVal"
      @scrolltolower="loadMore"
      @scroll="onScroll"
    >
      <!-- Loading skeleton -->
      <view v-if="loading && templates.length === 0" class="skeleton-list">
        <view v-for="i in 3" :key="i" class="skeleton-card">
          <view class="skeleton-color-bar"></view>
          <view class="skeleton-title"></view>
          <view class="skeleton-tags">
            <view class="skeleton-tag" v-for="j in 5" :key="j"></view>
          </view>
          <view class="skeleton-footer"></view>
        </view>
      </view>
      <view v-else class="template-cards">
        <view v-for="tpl in templates" :key="tpl.id" class="template-card" @tap="openTemplate(tpl.id)">
          <view class="card-color-bar" :style="{ background: getCategoryColor(tpl.category) }"></view>
          <view class="card-body">
            <view class="card-title-row">
              <text class="card-title">{{ tpl.title }}</text>
              <text v-if="tpl.isPinned" class="pin-badge">📌</text>
            </view>
            <text v-if="tpl.description" class="card-desc">{{ tpl.description }}</text>
            <view class="tag-cloud">
              <view v-for="(word, idx) in tpl.previewCells.slice(0, 8)" :key="idx" class="tag-pill" :style="{ background: tagColors[idx % tagColors.length] }">
                <text class="tag-text">{{ word }}</text>
              </view>
              <view v-if="tpl.previewCells.length > 8" class="tag-more">
                <text class="tag-text">+{{ tpl.previewCells.length - 8 }}</text>
              </view>
            </view>
            <view class="card-footer">
              <view class="card-meta">
                <text class="meta-author">{{ tpl.authorName }}</text>
                <text class="meta-dot">·</text>
                <text class="meta-size">{{ tpl.gridSize }}×{{ tpl.gridSize }}</text>
              </view>
              <view class="card-stats">
                <view class="stat-item">
                  <text class="stat-icon">⭐</text>
                  <text class="stat-count">{{ tpl.favoriteCount || 0 }}</text>
                  <text class="stat-label">收藏</text>
                </view>
                <view class="stat-item">
                  <text class="stat-icon">👤</text>
                  <text class="stat-count">{{ tpl.useCount }}</text>
                  <text class="stat-label">使用</text>
                </view>
              </view>
            </view>
          </view>
        </view>
      </view>
      <view v-if="!loading && templates.length === 0" class="empty-state">
        <text class="empty-icon">📭</text>
        <text class="empty-text">{{ searchKeyword ? '没有找到匹配的模板' : '暂无模板' }}</text>
        <text class="empty-hint">{{ searchKeyword ? '试试其他关键词吧' : '快来发布第一个吧！' }}</text>
      </view>
      <view v-if="hasMore && templates.length > 0" class="load-more">
        <text v-if="loadingMore">加载中...</text>
        <text v-else>上拉加载更多</text>
      </view>
      <view v-if="!hasMore && templates.length > 0" class="no-more">
        <text class="no-more-emoji">👟</text>
        <text class="no-more-text">到底啦！关掉手机出去走走吧 🌤️</text>
      </view>
      <view class="scroll-bottom-spacer"></view>
    </scroll-view>

    <!-- My favorites: fixed scroll-view -->
    <scroll-view
      v-if="topTab === 'favorites' && layoutReady"
      class="template-list template-list-fixed"
      scroll-y
      :style="{ top: categoryBottom + 'px', height: favContentHeight + 'px' }"
    >
      <view v-if="favLoading" class="skeleton-list" style="padding: 24rpx 32rpx;">
        <view v-for="i in 3" :key="i" class="skeleton-card">
          <view class="skeleton-color-bar"></view>
          <view class="skeleton-title"></view>
          <view class="skeleton-tags">
            <view class="skeleton-tag" v-for="j in 5" :key="j"></view>
          </view>
          <view class="skeleton-footer"></view>
        </view>
      </view>
      <view v-else-if="filteredFavTemplates.length === 0" class="empty-favorites">
        <text class="empty-fav-icon">⭐</text>
        <text class="empty-fav-text">{{ searchKeyword ? '没有找到匹配的收藏' : '还没有收藏的模板' }}</text>
        <text class="empty-fav-hint">{{ searchKeyword ? '试试其他关键词吧' : '浏览「发现」页面，点击模板后收藏' }}</text>
      </view>
      <view v-else class="template-cards" style="padding: 24rpx 32rpx;">
        <view v-for="tpl in filteredFavTemplates" :key="tpl.id" class="template-card" @tap="openTemplate(tpl.id)">
          <view class="card-color-bar" :style="{ background: getCategoryColor(tpl.category) }"></view>
          <view class="card-body">
            <view class="card-title-row">
              <text class="card-title">{{ tpl.title }}</text>
              <text v-if="tpl.isPinned" class="pin-badge">📌</text>
            </view>
            <text v-if="tpl.description" class="card-desc">{{ tpl.description }}</text>
            <view class="tag-cloud">
              <view v-for="(word, idx) in tpl.previewCells.slice(0, 8)" :key="idx" class="tag-pill" :style="{ background: tagColors[idx % tagColors.length] }">
                <text class="tag-text">{{ word }}</text>
              </view>
            </view>
            <view class="card-footer">
              <view class="card-meta">
                <text class="meta-author">{{ tpl.authorName }}</text>
                <text class="meta-dot">·</text>
                <text class="meta-size">{{ tpl.gridSize }}×{{ tpl.gridSize }}</text>
              </view>
              <view class="card-stats">
                <view class="stat-item">
                  <text class="stat-icon">⭐</text>
                  <text class="stat-count">{{ tpl.favoriteCount || 0 }}</text>
                  <text class="stat-label">收藏</text>
                </view>
                <view class="stat-item">
                  <text class="stat-icon">👤</text>
                  <text class="stat-count">{{ tpl.useCount }}</text>
                  <text class="stat-label">使用</text>
                </view>
              </view>
            </view>
          </view>
        </view>
      </view>
      <view v-if="!favLoading && filteredFavTemplates.length > 0" class="no-more">
        <text class="no-more-emoji">⭐</text>
        <text class="no-more-text">这就是你收藏的全部模板啦~</text>
      </view>
      <view class="scroll-bottom-spacer"></view>
    </scroll-view>

    <!-- Template detail modal -->
    <view v-if="selectedTemplate" class="template-detail-overlay" @tap="closeDetail">
      <view class="template-detail-card" @tap.stop>
        <view class="detail-header">
          <text class="detail-title">{{ selectedTemplate.title }}</text>
          <view class="detail-close" @tap="closeDetail">✕</view>
        </view>

        <view v-if="selectedTemplate.description" class="detail-desc">
          {{ selectedTemplate.description }}
        </view>

        <!-- Full preview -->
        <view class="detail-preview" :class="`grid-${selectedTemplate.gridSize}`">
          <view
            v-for="(cell, idx) in selectedTemplate.cells"
            :key="idx"
            class="detail-cell"
          >
            <text>{{ cell.title || '·' }}</text>
          </view>
        </view>

        <view class="detail-meta">
          <text>{{ selectedTemplate.authorName }} · {{ selectedTemplate.gridSize }}×{{ selectedTemplate.gridSize }} 宫格</text>
          <text>{{ selectedTemplate.useCount }} 人已使用 · {{ selectedTemplate.favoriteCount }} 人收藏</text>
        </view>

        <view class="detail-actions">
          <button class="use-btn" @tap="onUseTemplate">使用</button>
          <text class="detail-fav-text" :class="{ 'detail-fav-active': selectedTemplate.isFavorite }" @tap="onToggleFavoriteDetail">
            {{ selectedTemplate.isFavorite ? '⭐ 已收藏' : '☆ 收藏' }}
          </text>
        </view>
      </view>
    </view>

    <!-- Back to top button -->
    <view v-if="showBackToTop" class="back-to-top" @tap="scrollToTop">
      <text class="back-to-top-icon">↑</text>
    </view>
  </view>
</template>

<script setup lang="ts">
import { ref, watch, computed, onMounted, nextTick } from 'vue'
import { onShow, onPullDownRefresh } from '@dcloudio/uni-app'
import { getTemplates, getTemplate, useTemplate, favoriteTemplate, getBoards, getBoard, type TemplateListParams } from '../index/api'
import type { TemplateListItem, Template, TemplateCategory } from '../../../../shared/types'

const props = withDefaults(defineProps<{ statusBarHeight?: number; capsuleTop?: number; tabbarHeight?: number }>(), { statusBarHeight: 0, capsuleTop: 0, tabbarHeight: 60 })

// ── Top tabs ──
const topTab = ref<'discover' | 'favorites'>('discover')
const favTemplates = ref<TemplateListItem[]>([])
const favLoading = ref(false)

function switchTopTab(tab: 'discover' | 'favorites') {
  topTab.value = tab
  searchKeyword.value = ''  // Clear search when switching tabs
  if (tab === 'favorites') {
    loadFavorites()
  }
}

async function loadFavorites() {
  favLoading.value = true
  try {
    const res = await getTemplates({ favorite: true, limit: 100 })
    favTemplates.value = res.templates
  } catch (err) {
    console.error('加载收藏失败:', err)
  } finally {
    favLoading.value = false
  }
}

// ── Categories & colors ──
const categories = [
  { id: null, name: '全部' },
  { id: 'creative', name: '🧠 脑洞大开' },
  { id: 'nicetry', name: '🎙️ Nice Try' },
]

const categoryColorMap: Record<string, string> = {
  creative: 'linear-gradient(90deg, #F5A623, #FCCE54)',
  nicetry: 'linear-gradient(90deg, #E85D75, #F08E9E)',
}

function getCategoryColor(cat?: string): string {
  return categoryColorMap[cat || 'other'] || categoryColorMap.other
}

// Random pastel color palette for tag cloud
const tagColors = [
  '#FEE2E2', '#DBEAFE', '#D1FAE5', '#FEF3C7',
  '#EDE9FE', '#FCE7F3', '#E0F2FE', '#F3E8FF',
]

// ── State ──
const currentCategory = ref<string | null>(null)
const currentSort = ref<'recommend' | 'newest'>('recommend')
const searchKeyword = ref('')
let searchTimer: ReturnType<typeof setTimeout> | null = null

const templates = ref<TemplateListItem[]>([])
const loading = ref(false)
const loadingMore = ref(false)
const hasMore = ref(true)
const page = ref(1)
const limit = 10

// Back to top
const showBackToTop = ref(false)
const scrollTopVal = ref(0)
let lastScrollTop = 0

// Dynamic layout: constants below are initial estimates only; the real
// positions are measured at runtime via boundingClientRect() in onMounted.
const CATEGORY_BAR_PX = 40
const SORT_BAR_PX = 44
const headerBottom = ref(props.capsuleTop + 185)
// Initial estimate; corrected by measuring .category-tabs-fixed after mount.
const categoryBottom = ref((props.capsuleTop + 185 - 12) + CATEGORY_BAR_PX)
const sortBarBottom_ = ref(categoryBottom.value + SORT_BAR_PX)
const windowHeight = ref(750)
const tabbarTop = ref(windowHeight.value - props.tabbarHeight)
const layoutReady = ref(false)
const contentTop = computed(() => sortBarBottom_.value - 12)
const contentHeight = computed(() => tabbarTop.value - contentTop.value)
const favContentHeight = computed(() => tabbarTop.value - categoryBottom.value)

// My favorites: local keyword filter
const filteredFavTemplates = computed(() => {
  let result = favTemplates.value
  // Category filter
  if (currentCategory.value) {
    result = result.filter((t: any) => t.category === currentCategory.value)
  }
  // Keyword filter
  const kw = searchKeyword.value.trim().toLowerCase()
  if (kw) {
    result = result.filter((t: any) =>
      t.title.toLowerCase().includes(kw) ||
      (t.description || '').toLowerCase().includes(kw) ||
      t.previewCells.some((w: string) => w.toLowerCase().includes(kw))
    )
  }
  return result
})

function onScroll(e: any) {
  const top = e.detail.scrollTop || 0
  showBackToTop.value = top > 600
  lastScrollTop = top
}

function scrollToTop() {
  // scroll-view needs value change to trigger scroll
  scrollTopVal.value = lastScrollTop
  setTimeout(() => { scrollTopVal.value = 0 }, 20)
}

const selectedTemplate = ref<Template | null>(null)

// ── Search ──
function onSearchInput(e: any) {
  const val = e.detail.value || ''
  searchKeyword.value = val
  // debounce 500ms
  if (searchTimer) clearTimeout(searchTimer)
  searchTimer = setTimeout(() => {
    fetchTemplates(true)
  }, 500)
}

function onSearchConfirm() {
  if (searchTimer) clearTimeout(searchTimer)
  fetchTemplates(true)
}

function clearSearch() {
  searchKeyword.value = ''
  fetchTemplates(true)
}

// ── Fetch template list ──
async function fetchTemplates(reset = false) {
  if (reset) {
    page.value = 1
    hasMore.value = true
  }

  if (page.value === 1) {
    loading.value = true
  } else {
    loadingMore.value = true
  }

  try {
    const params: TemplateListParams = {
      sort: currentSort.value,
      page: page.value,
      limit,
    }

    if (currentCategory.value) {
      params.category = currentCategory.value as TemplateCategory
    }

    if (searchKeyword.value.trim()) {
      params.keyword = searchKeyword.value.trim()
    }

    const res = await getTemplates(params)

    if (reset) {
      templates.value = res.templates
    } else {
      templates.value.push(...res.templates)
    }

    hasMore.value = res.templates.length >= limit
  } catch (err) {
    console.error('获取模板列表失败:', err)
    uni.showToast({ title: (err as Error).message || '加载失败', icon: 'none' })
  } finally {
    loading.value = false
    loadingMore.value = false
  }
}

function selectCategory(catId: string | null) {
  currentCategory.value = catId
  // In discover tab: re-fetch from server with category filter
  // In favorites tab: filter is applied locally via filteredFavTemplates computed
  if (topTab.value === 'discover') {
    fetchTemplates(true)
  }
}

function loadMore() {
  if (loadingMore.value || !hasMore.value) return
  page.value++
  fetchTemplates()
}

// ── Template detail ──
async function openTemplate(id: number) {
  try {
    uni.showLoading({ title: '加载中...' })
    const tpl = await getTemplate(id)
    selectedTemplate.value = tpl
  } catch (err) {
    console.error('获取模板详情失败:', err)
    uni.showToast({ title: (err as Error).message || '加载失败', icon: 'none' })
  } finally {
    uni.hideLoading()
  }
}

function closeDetail() {
  selectedTemplate.value = null
}

async function onToggleFavoriteDetail() {
  if (!selectedTemplate.value) return
  const tpl = selectedTemplate.value
  const oldFavorite = tpl.isFavorite
  const oldCount = tpl.favoriteCount
  tpl.isFavorite = !tpl.isFavorite
  tpl.favoriteCount += tpl.isFavorite ? 1 : -1

  try {
    const res = await favoriteTemplate(tpl.id)
    tpl.isFavorite = res.favorite
    tpl.favoriteCount = res.favoriteCount
    // Sync back to list
    const listItem = templates.value.find(t => t.id === tpl.id)
    if (listItem) {
      listItem.isFavorite = res.favorite
      listItem.favoriteCount = res.favoriteCount
    }
    if (!res.favorite) {
      favTemplates.value = favTemplates.value.filter(t => t.id !== tpl.id)
    }
  } catch (err) {
    tpl.isFavorite = oldFavorite
    tpl.favoriteCount = oldCount
    uni.showToast({ title: (err as Error).message || '操作失败', icon: 'none' })
  }
}

async function onUseTemplate() {
  if (!selectedTemplate.value) return
  const templateWords = selectedTemplate.value.cells.map((c: any) => c.title).filter(Boolean) as string[]

  // Prompt for board name
  const now = new Date()
  const defaultName = `${selectedTemplate.value.title} ${now.getMonth() + 1}/${now.getDate()}`
  const boardName = await new Promise<string | null>(resolve => {
    uni.showModal({
      title: '命名 Bingo 卡',
      editable: true,
      placeholderText: '请输入卡片名称',
      content: defaultName,
      success: (res) => resolve(res.confirm ? (res.content?.trim() || defaultName) : null),
      fail: () => resolve(null),
    })
  })
  if (!boardName) return

  try {
    // Fetch current active board info
    let oldTitle = ''
    let oldBoardId: number | null = null
    let oldHasContent = true

    try {
      const boards = await getBoards()
      const active = boards.find(b => b.isActive)
      if (active) {
        oldTitle = active.title
        oldBoardId = active.id
        const imgCount = (active as any).imageCount ?? 0
        oldHasContent = imgCount > 0
        if (imgCount === 0) {
          const detail = await getBoard(active.id)
          oldHasContent = detail.cells.some(c => c.title && c.title.trim())
        }
      }
    } catch { /* keep existing board when uncertain */ }

    uni.showLoading({ title: '创建中...' })
    await useTemplate(selectedTemplate.value.id, boardName)
    uni.hideLoading()

    closeDetail()
    uni.$emit('template-applied', {
      oldTitle,
      oldBoardId,
      oldHasContent,
      templateWords,
    })

    setTimeout(() => { uni.$emit('switch-tab', 'index') }, 300)
  } catch (err) {
    uni.hideLoading()
    console.error('使用模板失败:', err)
    uni.showToast({ title: (err as Error).message || '创建失败', icon: 'none' })
  }
}

watch([currentCategory, currentSort], () => {
  fetchTemplates(true)
})

onMounted(() => {
  fetchTemplates(true)
  // Step 1: measure sticky header bottom
  setTimeout(() => {
    const query = uni.createSelectorQuery()
    query.select('.plaza-sticky-header').boundingClientRect()
    query.selectViewport().fields({ size: true }, () => {})
    query.exec((res) => {
      if (res && res[0] && res[1]) {
        const measuredHeaderBottom = res[0].bottom as number
        if (measuredHeaderBottom > 0) {
          headerBottom.value = measuredHeaderBottom
          categoryBottom.value = (headerBottom.value - 12) + CATEGORY_BAR_PX
        }
        windowHeight.value = res[1].height || 750
        tabbarTop.value = windowHeight.value - props.tabbarHeight
      }
      // sortBarBottom_ initial estimate from categoryBottom
      sortBarBottom_.value = categoryBottom.value + SORT_BAR_PX
      layoutReady.value = true
      // Step 2: after all fixed layers render, measure sort-bar and tabbar
      setTimeout(() => {
        const q2 = uni.createSelectorQuery()
        q2.select('.sort-bar-fixed').boundingClientRect()
        q2.select('.custom-tabbar').boundingClientRect()
        q2.select('.category-tabs-fixed').boundingClientRect()
        q2.exec((res2) => {
          if (res2?.[2]?.bottom > 0) {
            categoryBottom.value = res2[2].bottom as number
          }
          if (res2?.[0]?.bottom > 0) {
            sortBarBottom_.value = res2[0].bottom as number
          }
          if (res2?.[1]?.top > 0) {
            tabbarTop.value = res2[1].top as number
          }
        })
      }, 100)
    })
  }, 300)
})

onPullDownRefresh(async () => {
  await fetchTemplates(true)
  uni.stopPullDownRefresh()
})

</script>

<style scoped>
.plaza-page {
  height: 100%;
  background: #f5f5f5;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  box-sizing: border-box;
  width: 100%;
}

.plaza-sticky-header {
  background: rgba(255, 255, 255, 0.35);
  backdrop-filter: blur(16px);
  -webkit-backdrop-filter: blur(16px);
  border-bottom: 1rpx solid rgba(0, 0, 0, 0.06);
  z-index: 100;
}

.plaza-header {
  padding: var(--header-top-gap, 20rpx) 32rpx 16rpx;
  background: transparent;
}

.plaza-title {
  font-size: 44rpx;
  font-weight: 800;
  color: #333;
  display: block;
}

.plaza-subtitle {
  font-size: 26rpx;
  color: #888;
  margin-top: 8rpx;
  display: block;
}

/* Top tabs: Discover / My favorites */
.top-tabs {
  display: flex;
  gap: 0;
  padding: 12rpx 32rpx 0;
  background: transparent;
}

.top-tab {
  flex: 1;
  text-align: center;
  padding: 18rpx 0;
  font-size: 28rpx;
  color: #888;
  border-bottom: 4rpx solid transparent;
  transition: all 0.2s;
}

.top-tab-active {
  color: #333;
  font-weight: 700;
  border-bottom-color: #333;
}

/* Empty favorites */
.empty-favorites {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 120rpx 48rpx;
  text-align: center;
}

.empty-fav-icon {
  font-size: 80rpx;
  margin-bottom: 24rpx;
}

.empty-fav-text {
  font-size: 32rpx;
  color: #333;
  font-weight: 600;
  margin-bottom: 12rpx;
}

.empty-fav-hint {
  font-size: 26rpx;
  color: #999;
}

/* Search bar */
.search-bar {
  position: relative;
  padding: 12rpx 32rpx 12rpx;
  background: transparent;
}

.search-input {
  width: 100%;
  height: 72rpx;
  background: rgba(255, 255, 255, 0.8);
  border-radius: 36rpx;
  padding: 0 80rpx 0 32rpx;
  font-size: 28rpx;
  color: #333;
  box-sizing: border-box;
  box-shadow: 0 2rpx 8rpx rgba(0, 0, 0, 0.04);
}

.search-clear {
  position: absolute;
  right: 48rpx;
  top: 50%;
  transform: translateY(-50%);
  width: 48rpx;
  height: 48rpx;
  border-radius: 50%;
  background: #e5e5e5;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 24rpx;
  color: #666;
}

/* Category tabs */
.category-tabs {
  white-space: nowrap;
  padding: 2rpx 24rpx;
  background: #f5f5f5;
}

.category-tabs-fixed {
  position: fixed;
  left: 0;
  right: 0;
  width: 100vw;
  z-index: 99;
}


.category-tab {
  display: inline-flex;
  align-items: center;
  padding: 8rpx 20rpx;
  margin-right: 16rpx;
  border-radius: 32rpx;
  background: rgba(255, 255, 255, 0.8);
  border: 2rpx solid transparent;
  transition: all 0.2s;
}

.category-tab.category-active {
  background: #333;
  color: #fff;
}

.category-name {
  font-size: 26rpx;
  font-weight: 500;
}

/* Sort bar */
.sort-bar {
  display: flex;
  padding: 12rpx 32rpx;
  gap: 24rpx;
}

.sort-bar-fixed {
  position: fixed;
  left: 0;
  right: 0;
  background: #f5f5f5;
  z-index: 98;
  border-bottom: 1rpx solid rgba(0, 0, 0, 0.06);
}

.sort-option {
  font-size: 26rpx;
  color: #888;
  padding: 8rpx 0;
  border-bottom: 3rpx solid transparent;
}

.sort-option.sort-active {
  color: #333;
  font-weight: 600;
  border-bottom-color: #333;
}

/* Template list */
.template-list {
  padding: 8rpx 24rpx 0;
  box-sizing: border-box;
  width: 100%;
}

.template-list-fixed {
  position: fixed;
  left: 0;
  right: 0;
  width: 100vw;
  box-sizing: border-box;
}

.template-cards {
  display: flex;
  flex-direction: column;
  gap: 24rpx;
  box-sizing: border-box;
  width: 100%;
}

/* Template card — single column big card */
.template-card {
  background: #ffffff;
  border-radius: 24rpx;
  overflow: hidden;
  box-shadow: 0 4rpx 24rpx rgba(0, 0, 0, 0.06);
  box-sizing: border-box;
  width: 100%;
}

.card-color-bar {
  height: 8rpx;
  width: 100%;
}

.card-body {
  padding: 24rpx 28rpx;
}

.card-title-row {
  display: flex;
  align-items: center;
  gap: 12rpx;
}

.card-title {
  font-size: 34rpx;
  font-weight: 700;
  color: #222;
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.pin-badge {
  font-size: 28rpx;
  flex-shrink: 0;
}

.card-desc {
  font-size: 26rpx;
  color: #777;
  margin-top: 10rpx;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
  line-height: 1.5;
}

/* Tag cloud */
.tag-cloud {
  display: flex;
  flex-wrap: wrap;
  gap: 12rpx;
  margin-top: 20rpx;
}

.tag-pill {
  padding: 8rpx 20rpx;
  border-radius: 20rpx;
  max-width: 180rpx;
}

.tag-text {
  font-size: 24rpx;
  color: #555;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  display: block;
}

.tag-more {
  padding: 8rpx 20rpx;
  border-radius: 20rpx;
  background: #f0f0f0;
}

/* Footer */
.card-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-top: 20rpx;
  padding-top: 16rpx;
  border-top: 1rpx solid #f5f5f5;
}

.card-meta {
  display: flex;
  align-items: center;
  gap: 8rpx;
  font-size: 24rpx;
  color: #999;
}

.meta-author {
  max-width: 180rpx;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.meta-dot {
  color: #ccc;
}

.card-stats {
  display: flex;
  align-items: center;
  gap: 24rpx;
}

.stat-use {
  display: flex;
  align-items: center;
  gap: 6rpx;
}

.stat-item {
  display: flex;
  align-items: center;
  gap: 4rpx;
}

.stat-icon {
  font-size: 22rpx;
}

.stat-count {
  font-size: 22rpx;
  color: #999;
}

.stat-label {
  font-size: 18rpx;
  color: #bbb;
}

.use-count {
  font-size: 24rpx;
  color: #999;
}

.use-icon {
  font-size: 24rpx;
}

/* Skeleton */
.skeleton-list {
  display: flex;
  flex-direction: column;
  gap: 24rpx;
}

.skeleton-card {
  background: rgba(255, 255, 255, 0.8);
  border-radius: 24rpx;
  overflow: hidden;
}

.skeleton-color-bar {
  height: 8rpx;
  background: linear-gradient(90deg, #f0f0f0 25%, #e8e8e8 50%, #f0f0f0 75%);
  background-size: 200% 100%;
  animation: shimmer 1.5s infinite;
}

.skeleton-title {
  height: 36rpx;
  margin: 24rpx 28rpx 0;
  width: 60%;
  border-radius: 8rpx;
  background: linear-gradient(90deg, #f0f0f0 25%, #e8e8e8 50%, #f0f0f0 75%);
  background-size: 200% 100%;
  animation: shimmer 1.5s infinite;
}

.skeleton-tags {
  display: flex;
  flex-wrap: wrap;
  gap: 12rpx;
  padding: 20rpx 28rpx 0;
}

.skeleton-tag {
  width: 120rpx;
  height: 40rpx;
  border-radius: 20rpx;
  background: linear-gradient(90deg, #f0f0f0 25%, #e8e8e8 50%, #f0f0f0 75%);
  background-size: 200% 100%;
  animation: shimmer 1.5s infinite;
}

.skeleton-footer {
  height: 28rpx;
  margin: 20rpx 28rpx 24rpx;
  width: 40%;
  border-radius: 8rpx;
  background: linear-gradient(90deg, #f0f0f0 25%, #e8e8e8 50%, #f0f0f0 75%);
  background-size: 200% 100%;
  animation: shimmer 1.5s infinite;
}

@keyframes shimmer {
  0% { background-position: 200% 0; }
  100% { background-position: -200% 0; }
}

/* Empty state */
.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 80rpx 40rpx;
}

.empty-icon {
  font-size: 80rpx;
  margin-bottom: 20rpx;
}

.empty-text {
  font-size: 32rpx;
  color: #666;
  font-weight: 500;
}

.empty-hint {
  font-size: 26rpx;
  color: #999;
  margin-top: 8rpx;
}

/* Load more */
.load-more {
  text-align: center;
  padding: 32rpx;
  color: #999;
  font-size: 26rpx;
}

.no-more {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 40rpx 32rpx 16rpx;
}

.no-more-emoji {
  font-size: 48rpx;
  margin-bottom: 12rpx;
}

.no-more-text {
  font-size: 24rpx;
  color: #bbb;
}

.scroll-bottom-spacer {
  height: 32rpx;
}

/* Template detail overlay */
.template-detail-overlay {
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
  padding: 40rpx;
}

.template-detail-card {
  background: #ffffff;
  border-radius: 24rpx;
  width: 100%;
  max-width: 640rpx;
  max-height: 90vh;
  overflow-y: auto;
  animation: slideUp 0.3s ease;
}

@keyframes slideUp {
  from {
    opacity: 0;
    transform: translateY(40rpx);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

.detail-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 32rpx;
  border-bottom: 1rpx solid #eee;
}

.detail-title {
  font-size: 36rpx;
  font-weight: 700;
  color: #333;
}

.detail-close {
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

.detail-desc {
  padding: 24rpx 32rpx 0;
  font-size: 28rpx;
  color: #666;
  line-height: 1.6;
}

.detail-preview {
  display: grid;
  gap: 8rpx;
  padding: 24rpx 32rpx;
}

.detail-preview.grid-3 {
  grid-template-columns: repeat(3, 1fr);
}

.detail-preview.grid-4 {
  grid-template-columns: repeat(4, 1fr);
}

.detail-preview.grid-5 {
  grid-template-columns: repeat(5, 1fr);
}

.detail-preview.grid-6 {
  grid-template-columns: repeat(6, 1fr);
}

.detail-preview.grid-7 {
  grid-template-columns: repeat(7, 1fr);
}

.detail-cell {
  aspect-ratio: 1;
  background: #f8f6f3;
  border-radius: 8rpx;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 22rpx;
  color: #333;
  text-align: center;
  padding: 8rpx;
  word-break: break-all;
}

.detail-meta {
  display: flex;
  flex-direction: column;
  gap: 8rpx;
  padding: 0 32rpx 24rpx;
  font-size: 26rpx;
  color: #888;
}

.detail-actions {
  padding: 24rpx 32rpx 32rpx;
  display: flex;
  align-items: center;
  gap: 24rpx;
}

.detail-fav-text {
  font-size: 28rpx;
  color: #999;
  flex-shrink: 0;
  line-height: 1;
}

.detail-fav-text.detail-fav-active {
  color: #b45309;
}

.use-btn {
  flex: 1;
  height: 72rpx;
  line-height: 72rpx;
  background: #333;
  color: #fff;
  font-size: 30rpx;
  font-weight: 600;
  border-radius: 36rpx;
  border: none;
  display: flex;
  align-items: center;
  justify-content: center;
}

.use-btn:active {
  opacity: 0.8;
}

/* Back to top */
.back-to-top {
  position: fixed;
  right: 32rpx;
  bottom: 180rpx;
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
