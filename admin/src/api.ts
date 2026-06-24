const TOKEN_KEY = 'binwak-admin-token'

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY)
}

export function setToken(token: string) {
  localStorage.setItem(TOKEN_KEY, token)
}

export function clearToken() {
  localStorage.removeItem(TOKEN_KEY)
}

async function request<T>(url: string, options: RequestInit = {}): Promise<T> {
  const token = getToken()
  const headers: Record<string, string> = {
    ...(options.headers as Record<string, string> || {}),
  }
  if (token) headers['Authorization'] = `Bearer ${token}`
  if (options.body && typeof options.body === 'string') {
    headers['Content-Type'] = 'application/json'
  }

  const res = await fetch(url, { ...options, headers })
  const json = await res.json()

  if (!res.ok || !json.success) {
    if (res.status === 401) {
      clearToken()
      window.location.hash = '#/login'
    }
    throw new Error(json.error || `请求失败 (${res.status})`)
  }
  return json.data as T
}

export async function login(username: string, password: string): Promise<string> {
  const data = await request<{ token: string }>('/api/admin/login', {
    method: 'POST',
    body: JSON.stringify({ username, password }),
  })
  setToken(data.token)
  return data.token
}

export async function getStats() {
  return request<any>('/api/admin/stats')
}

export async function getUsers(params: { page?: number; limit?: number; search?: string; sort?: string } = {}) {
  const qs = new URLSearchParams()
  if (params.page) qs.set('page', String(params.page))
  if (params.limit) qs.set('limit', String(params.limit))
  if (params.search) qs.set('search', params.search)
  if (params.sort) qs.set('sort', params.sort)
  return request<any>(`/api/admin/users?${qs}`)
}

export async function getUserDetail(id: number) {
  return request<any>(`/api/admin/users/${id}`)
}

export async function deleteUser(id: number) {
  return request<{ deleted: number }>(`/api/admin/users/${id}`, {
    method: 'DELETE',
  })
}

export async function getTemplates(params: { page?: number; limit?: number; status?: string; category?: string; search?: string; sort?: string } = {}) {
  const qs = new URLSearchParams()
  if (params.page) qs.set('page', String(params.page))
  if (params.limit) qs.set('limit', String(params.limit))
  if (params.status) qs.set('status', params.status)
  if (params.category) qs.set('category', params.category)
  if (params.search) qs.set('search', params.search)
  if (params.sort) qs.set('sort', params.sort)
  return request<any>(`/api/admin/templates?${qs}`)
}

export async function toggleTemplatePin(id: number) {
  return request<any>(`/api/admin/templates/${id}/pin`, { method: 'PATCH' })
}

export async function setTemplateStatus(id: number, status: 'active' | 'hidden') {
  return request<any>(`/api/admin/templates/${id}/status`, {
    method: 'PATCH',
    body: JSON.stringify({ status }),
  })
}

export async function getSystemInfo() {
  return request<any>('/api/admin/system')
}

// ── Word Bank ──

export interface AdminWordItem {
  id: number
  word: string
  sortOrder: number
  illustrationUrl: string | null
}

export async function getAdminWordbank(): Promise<{ words: AdminWordItem[]; adminUserId: number }> {
  return request<{ words: AdminWordItem[]; adminUserId: number }>('/api/admin/wordbank')
}

export async function addAdminWord(word: string): Promise<AdminWordItem> {
  return request<AdminWordItem>('/api/admin/wordbank', {
    method: 'POST',
    body: JSON.stringify({ word }),
  })
}

export async function deleteAdminWord(id: number): Promise<void> {
  await request<any>(`/api/admin/wordbank/${id}`, { method: 'DELETE' })
}

export async function batchAddAdminWords(words: string[]): Promise<{ added: number; total: number }> {
  return request<{ added: number; total: number }>('/api/admin/wordbank/batch', {
    method: 'POST',
    body: JSON.stringify({ words }),
  })
}

export async function uploadWordIllustration(wordId: number, file: File): Promise<{ illustrationUrl: string }> {
  const token = getToken()
  const formData = new FormData()
  formData.append('image', file)

  const res = await fetch(`/api/admin/wordbank/${wordId}/illustration`, {
    method: 'POST',
    headers: token ? { Authorization: `Bearer ${token}` } : {},
    body: formData,
  })
  const json = await res.json()
  if (!res.ok || !json.success) {
    throw new Error(json.error || '上传失败')
  }
  return json.data
}

export async function generateTemplateFromWordbank(data: {
  title: string
  description?: string
  words: string[]
  category?: string
}): Promise<{ templateId: number }> {
  return request<{ templateId: number }>('/api/admin/templates/generate', {
    method: 'POST',
    body: JSON.stringify(data),
  })
}

export async function createAdminTemplate(data: {
  title: string
  description?: string
  gridSize: number
  cells: Array<{ position: number; title: string }>
  category?: string
}) {
  return request<{ id: number; title: string }>('/api/admin/templates', {
    method: 'POST',
    body: JSON.stringify(data),
  })
}

export async function updateTemplate(id: number, data: {
  title?: string
  description?: string
  category?: string
  cells?: Array<{ position: number; title: string }>
}) {
  return request<any>(`/api/admin/templates/${id}`, {
    method: 'PUT',
    body: JSON.stringify(data),
  })
}

export async function getTemplate(id: number) {
  return request<any>(`/api/admin/templates/${id}`)
}

export async function deleteTemplate(id: number) {
  return request<any>(`/api/admin/templates/${id}`, {
    method: 'DELETE',
  })
}
