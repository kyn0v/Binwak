import { beforeEach, describe, expect, it, vi } from 'vitest'

type Request = { url: string; header: Record<string, string>; data: unknown; success: (response: unknown) => void; fail: (error: unknown) => void }
const requests: Request[] = []
const uploads: Request[] = []
const logins: { success: (result: { code: string }) => void }[] = []
const disk = new Map<string, string>()
let api: typeof import('../src/pages/index/api')
function respond(request: Request, data: unknown, statusCode = 200) { request.success({ statusCode, data: { success: statusCode < 400, data, error: statusCode >= 400 ? 'unauthorized' : undefined } }) }
async function tick() { for (let i = 0; i < 8; i++) await Promise.resolve() }
async function account(id: number, token: string) {
  api.setToken(token); api.setRefreshToken(`refresh-${id}`)
  const profile = api.getProfile()
  respond(requests.at(-1)!, { userId: id, imageStorage: 'local', nickname: '' })
  await profile
}
beforeEach(async () => {
  vi.resetModules(); requests.length = 0; uploads.length = 0; logins.length = 0; disk.clear()
  vi.stubGlobal('uni', {
    getStorageSync: (key: string) => disk.has(key) ? JSON.parse(disk.get(key)!) : '',
    setStorageSync: (key: string, value: unknown) => disk.set(key, JSON.stringify(value)), removeStorageSync: (key: string) => disk.delete(key),
    request: (request: Request) => requests.push(request), uploadFile: (request: Request) => uploads.push(request),
    login: (request: { success: (result: { code: string }) => void }) => logins.push(request), showModal: vi.fn(),
  })
  api = await import('../src/pages/index/api')
})

describe('credential-bound transport', () => {
  it('never retries A words with B credentials and leaves B installed after stale refresh', async () => {
    await account(1, 'token-A')
    const changing = api.replaceWordBank(['A private words'])
    const rejected = expect(changing).rejects.toThrow()
    respond(requests.at(-1)!, null, 401)
    await tick()
    const refresh = requests.at(-1)!
    expect(refresh.url).toContain('/auth/refresh')
    await account(2, 'token-B')
    respond(refresh, { token: 'refreshed-A', refreshToken: 'refresh-A-2' })
    await rejected
    expect(api.getToken()).toBe('token-B')
    expect(api.getStoredPrincipal()).toContain('/account/2')
    expect(requests.filter(r => r.url.endsWith('/wordbank/batch')).map(r => r.header.Authorization)).toEqual(['Bearer token-A'])
  })

  it('verifies the same owner before replaying words with a refreshed token', async () => {
    await account(1, 'token-A')
    const changing = api.replaceWordBank(['A words'])
    respond(requests.at(-1)!, null, 401)
    await tick()
    respond(requests.at(-1)!, { token: 'token-A2', refreshToken: 'refresh-A2' })
    await tick()
    const verification = requests.at(-1)!
    expect(verification.url).toContain('/auth/profile')
    expect(verification.header.Authorization).toBe('Bearer token-A2')
    respond(verification, { userId: 1 })
    await tick()
    const replay = requests.at(-1)!
    expect(replay.url).toContain('/wordbank/batch')
    expect(replay.header.Authorization).toBe('Bearer token-A2')
    expect(replay.data).toEqual({ words: ['A words'] })
    respond(replay, { words: [] })
    await changing
  })

  it('rejects a different owner returned by refresh without sending the old body', async () => {
    await account(1, 'token-A')
    const changing = api.replaceWordBank(['A words'])
    const rejected = expect(changing).rejects.toThrow()
    respond(requests.at(-1)!, null, 401); await tick()
    respond(requests.at(-1)!, { token: 'token-B', refreshToken: 'refresh-B' }); await tick()
    respond(requests.at(-1)!, { userId: 2 })
    await rejected
    expect(requests.filter(r => r.url.endsWith('/wordbank/batch'))).toHaveLength(1)
    expect(api.getToken()).toBe('token-A')
  })

  it('does not replay an upload after account change or a 401', async () => {
    await account(1, 'token-A')
    const sending = api.uploadImage('wxfile://saved/photo', 7, 2)
    const rejected = expect(sending).rejects.toThrow()
    await account(2, 'token-B')
    uploads[0].success({ statusCode: 401, data: JSON.stringify({ success: false }) })
    await rejected
    expect(uploads).toHaveLength(1)
    expect(uploads[0].header.Authorization).toBe('Bearer token-A')
    expect(api.getToken()).toBe('token-B')
  })

  it('does not let an older explicit login install over a newer credential', async () => {
    const signingIn = api.login()
    const rejected = expect(signingIn).rejects.toThrow()
    logins[0].success({ code: 'old-code' }); await tick()
    const response = requests.at(-1)!
    await account(2, 'token-B')
    respond(response, { token: 'token-A', refreshToken: 'refresh-A', isNewUser: false, nickname: '' })
    await rejected
    expect(api.getToken()).toBe('token-B')
    expect(api.getStoredPrincipal()).toContain('/account/2')
  })
})
