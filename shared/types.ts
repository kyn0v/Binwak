// ============================================
// Binwak — shared types (client + server)
// ============================================

// ---------- Defaults ----------
export const DEFAULT_WORDS = [
  '好运来',
  '路边野餐',
  '追风筝的人',
  '热气腾腾',
  '涂鸦',
  '倒影',
  '湿漉漉',
  '对称美',
  '以旧换新',
  '悄悄话',
  '单车骑行',
  '野花',
  'Hello World',
  '豆腐料理',
  '手工艺品',
  '日落',
  '看展',
  '水落石出',
  '老电影',
  '鸭听雷',
  '转角遇到',
  '老字号',
  '吃苦',
  '半价优惠',
  '大丈夫',
]

// ---------- User ----------
export interface User {
  id: number
  openid: string
  nickname: string
  createdAt: string
  updatedAt: string
}

// ---------- Board ----------
export interface Board {
  id: number
  userId: number
  title: string
  gridSize: number // 3 | 4 | 5 | 6
  theme: string // mono
  isActive: boolean
  isFavorite?: boolean
  publishedTemplateId?: number | null
  completedCount?: number
  totalCount?: number
  createdAt: string
  updatedAt: string
}

export interface Cell {
  position: number // 0 ~ gridSize²-1
  title: string
  imageName: string // file path on server
  imageUrl?: string // accessible URL from current storage driver
  illustrationPath?: string // illustration path on OSS
  illustrationUrl?: string // illustration accessible URL
  completed: boolean
  completedAt?: string
}

export interface BoardDetail extends Board {
  cells: Cell[]
}

// ---------- Word bank ----------
export interface WordBankItem {
  id: number
  word: string
  sortOrder: number
}

// ---------- Illustration ----------
export interface Illustration {
  id: number
  word: string
  imagePath: string   // OSS key
  imageUrl?: string   // resolved URL
  createdAt: string
}

// ---------- API request/response ----------

// POST /api/auth/login
export interface LoginRequest {
  code: string
}

export interface LoginResponse {
  refreshToken: string
  token: string
  isNewUser: boolean
  nickname: string
}

// GET /api/auth/profile
export interface ProfileResponse {
  userId: number
  nickname: string
  imageStorage: 'local' | 'cloud'
}

// PUT /api/auth/profile
export interface UpdateProfileRequest {
  nickname?: string
  imageStorage?: 'local' | 'cloud'
}

// POST /api/boards
export interface CreateBoardRequest {
  title?: string
  gridSize?: number
  theme?: string
}

// PUT /api/boards/:id
export interface UpdateBoardRequest {
  title?: string
  gridSize?: number
  theme?: string
}

// PUT /api/boards/:id/cells
export interface UpdateCellsRequest {
  cells: { position: number; title: string; illustrationPath?: string; completed?: boolean }[]
}

// POST /api/wordbank/batch
export interface UpdateWordBankRequest {
  words: string[]
}

// POST /api/upload
export interface UploadResponse {
  fileName: string
  url: string
}

// Generic API response wrapper
export interface ApiResponse<T = unknown> {
  success: boolean
  data?: T
  error?: string
}

// ---------- Template plaza ----------
export type TemplateCategory = 'creative' | 'nicetry'

export interface Template {
  id: number
  userId: number
  title: string
  description?: string
  /** Grid edge length (3-6), total cells = gridSize² */
  gridSize: number
  cells: Array<{ position: number; title: string; imageUrl?: string }>
  category?: TemplateCategory
  isPinned: boolean
  favoriteCount: number
  isFavorite: boolean
  authorName: string
  useCount: number
  status: 'active' | 'hidden' | 'deleted'
  createdAt: string
  updatedAt: string
}

export interface TemplateListItem {
  id: number
  title: string
  description?: string
  gridSize: number
  category?: TemplateCategory
  isPinned: boolean
  favoriteCount: number
  isFavorite: boolean
  authorName: string
  useCount: number
  previewCells: string[] // first few cell titles for preview
  createdAt: string
}

// POST /api/templates
export interface CreateTemplateRequest {
  title: string
  description?: string
  /** Grid edge length (3-7), cells array must have gridSize² elements */
  gridSize: number
  cells: Array<{ position: number; title: string; imageUrl?: string }>
  category?: TemplateCategory
}

// PUT /api/templates/:id
export interface UpdateTemplateRequest {
  title?: string
  description?: string
  cells?: Array<{ position: number; title: string }>
  category?: TemplateCategory
}

// GET /api/templates
export interface TemplateListQuery {
  category?: TemplateCategory
  featured?: boolean
  keyword?: string
  sort?: 'popular' | 'newest'
  page?: number
  limit?: number
}

// ---------- User feedback (via GitHub Issues) ----------
export type FeedbackType = 'bug' | 'feature'

export interface CreateFeedbackRequest {
  type: FeedbackType
  title: string
  content: string
  images?: string[]
}

export interface CreateFeedbackResponse {
  issueUrl: string
  issueNumber: number
}

export interface FeedbackIssueItem {
  number: number
  title: string
  url: string
  state: string
  createdAt: string
}
