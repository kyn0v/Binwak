import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

type Req = { url: string; method: string; header: Record<string,string>; data?: any; success: (r:any)=>void; fail: (r:any)=>void }
const disk = new Map<string,string>()
const remote = new Map<number,any>()
const calls: Req[] = []
const remoteWords = new Map<number,string[]>()
let refreshOnSettings = false
let holdBProfile = false
let heldBProfile: Req | undefined
let holdModeration = false
let heldModeration: Req | undefined
let failReplacement = false
let loseStarterResponse = false
let failWorkspaceSaves = false
let failLogin = false
let loseDeleteResponse = false
let keepRemoteOnDelete = false
let failDetailReads = false
const copy = <T>(v:T):T => JSON.parse(JSON.stringify(v))
const ok = (r:Req, data:unknown) => r.success({statusCode:200, data:{success:true, data:data === undefined ? undefined : copy(data)}})
function detail(id:number, userId=1) { return { id,userId,title:`Board ${id}`,gridSize:3,theme:'mono',isActive:id===1 || id===3,createdAt:'',updatedAt:'',cells:Array.from({length:9},(_,position)=>({position,title:`word ${id}-${position}`,completed:false,imageName:''})) } }
function request(r:Req) {
  calls.push({...r,data:r.data === undefined ? undefined : copy(r.data)})
  const path = new URL(r.url).pathname
  const owner = r.header.Authorization?.includes('token-B') ? 2 : 1
  if(path==='/api/auth/login') {if(failLogin){r.fail({errMsg:'request:fail offline login'});return};ok(r,{token:'token-B',refreshToken:'refresh-B',nickname:'',isNewUser:false});return}
  if(path==='/api/auth/refresh') {ok(r,{token:'token-A2',refreshToken:'refresh-A2'});return}
  if(path==='/api/auth/profile') {
    if(owner===2 && holdBProfile) {heldBProfile=r;return}
    ok(r,{userId:owner,nickname:'',imageStorage:'local'});return
  }
  if(path==='/api/moderation/check') {if(holdModeration) {heldModeration=r;return};ok(r,{pass:true});return}
  if(path==='/api/wordbank') {ok(r,{words:(remoteWords.get(owner)||[]).map(word=>({word}))});return}
  if(path==='/api/wordbank/batch') {remoteWords.set(owner,copy(r.data.words));ok(r,{words:[]});return}
  if(path==='/api/boards') {
    if(r.method==='POST') {
      if(failReplacement) {r.fail({errMsg:'request:fail offline before create'});return}
      const created=detail(4,owner); remote.set(4,created)
      for(const b of remote.values()) if(b.userId===owner) b.isActive=b.id===4
      if(loseStarterResponse) {loseStarterResponse=false;r.fail({errMsg:'request:fail response lost'});return}
      ok(r,created);return
    }
    ok(r,[...remote.values()].filter(b=>b.userId===owner));return
  }
  const m=path.match(/^\/api\/boards\/(\d+)(\/cells|\/activate)?$/)
  if(!m) throw Error(`Unstubbed transport (no network is allowed): ${path}`)
  if (r.method === 'GET' && failDetailReads) { r.fail({ errMsg: 'request:fail detail offline' }); return }
  const b=remote.get(Number(m[1]))
  if(!b) {r.success({statusCode:404,data:{success:false,error:'not found'}});return}
  if(b.userId!==owner) throw Error('Cross-account request')
  if(r.method==='PUT' && !m[2] && refreshOnSettings) {refreshOnSettings=false;r.success({statusCode:401,data:{success:false,error:'expired'}});return}
  if(m[2]==='/activate') {for(const item of remote.values()) if(item.userId===owner)item.isActive=item.id===b.id;ok(r,b);return}
  if(r.method==='DELETE') {
    if (!keepRemoteOnDelete) remote.delete(b.id)
    if (loseDeleteResponse) { r.fail({ errMsg: 'request:fail delete response lost' }); return }
    ok(r,undefined);return
  }
  if(m[2]==='/cells') {b.cells=b.cells.map((c:any,i:number)=>({...c,...r.data.cells[i]}));ok(r,b.cells);return}
  if(r.method==='PUT')Object.assign(b,copy(r.data))
  ok(r,b)
}
async function open() {
  const api=await import('../src/pages/index/api')
  const sync=(await import('../src/pages/index/useSync')).useSync()
  const board=(await import('../src/pages/index/useBingoBoard')).useBingoBoard()
  const words=(await import('../src/pages/index/useWordBank')).useWordBank()
  return {api,sync,board,words}
}
async function online() {const app=await open();app.api.setToken('token-A');app.api.setRefreshToken('refresh-A');await app.sync.initialSync();return app}
async function tick() {for(let i=0;i<30;i++)await Promise.resolve()}
beforeEach(()=>{
  vi.resetModules();vi.useFakeTimers();disk.clear();remote.clear();calls.length=0;remoteWords.clear()
  refreshOnSettings=false;holdBProfile=false;heldBProfile=undefined;holdModeration=false;heldModeration=undefined;failReplacement=false;loseStarterResponse=false;failWorkspaceSaves=false;failLogin=false
  loseDeleteResponse = false; keepRemoteOnDelete = false; failDetailReads = false
  remote.set(1,detail(1));remote.set(2,detail(2));remote.set(3,detail(3,2))
  vi.stubGlobal('uni',{
    getStorageSync:(k:string)=>disk.has(k)?JSON.parse(disk.get(k)!):'',
    setStorageSync:(k:string,v:unknown)=>{if(failWorkspaceSaves&&k.startsWith('binwak-workspace-v1/'))throw Error('quota');disk.set(k,JSON.stringify(v))},
    removeStorageSync:(k:string)=>disk.delete(k),request,
    uploadFile:()=>{throw Error('Unexpected upload (no actual WeChat calls allowed)')},
    login:(r:any)=>r.success({code:'stub-wechat-code'}),
    showToast:vi.fn(),showModal:vi.fn(),onNetworkStatusChange:vi.fn(),
  })
})
afterEach(()=>{vi.clearAllTimers();vi.useRealTimers()})
describe('workspace identity and recovery with real transport',()=>{
  it('continues the automatic durable drain after a same-owner 401 refresh',async()=>{
    const app=await online()
    await app.sync.switchBoard(2);await tick();await app.sync.switchBoard(1);await tick()
    app.board.cells.value[0].title='pending A board 1'
    await app.sync.switchBoard(2)
    app.board.cells.value[0].title='pending A board 2'
    await app.words.addWord('pending A words')
    refreshOnSettings=true
    // Let the real debounce fire: do not leave a second timer that could accidentally repair the stall.
    await vi.advanceTimersByTimeAsync(800);await tick()
    await vi.advanceTimersByTimeAsync(10000);await tick()
    const state=JSON.parse(app.sync.exportLocalRecovery())
    console.log('REPRO refresh drain',JSON.stringify({token:app.api.getToken(),syncing:app.sync.syncing.value,error:app.sync.lastSyncError.value,local:state.boards['1'].snapshot.cells[0].title,ack:state.boards['1'].acknowledged,revision:state.boards['1'].revision,server1:remote.get(1).cells[0].title,server2:remote.get(2).cells[0].title,serverWords:remoteWords.get(1)||[],requests:calls.map(c=>`${c.method} ${new URL(c.url).pathname}`)}))
    expect(remote.get(1).cells[0].title).toBe('pending A board 1')
    expect(remote.get(2).cells[0].title).toBe('pending A board 2')
    expect(remoteWords.get(1)).toContain('pending A words')
    expect(app.sync.syncing.value).toBe(false)
  })
  it('keeps an A-workspace async word edit out of B during real login/profile transition',async()=>{
    const app=await online()
    await app.api.login() // new token B installed, but visible/last verified workspace is still A
    holdBProfile=true
    const switching=app.sync.initialSync()
    expect(app.board.cells.value[0].title).toBe('word 1-0')
    holdModeration=true
    const adding=app.words.addWord('private input captured in A workspace')
    holdBProfile=false;ok(heldBProfile!,{userId:2,nickname:'',imageStorage:'local'})
    await switching
    expect(app.sync.remoteBoardId.value).toBe(3)
    if (heldModeration) ok(heldModeration,{pass:true})
    const result=await adding
    await vi.advanceTimersByTimeAsync(800);await tick()
    console.log('REPRO principal transition',JSON.stringify({result,principal:app.api.getStoredPrincipal(),board:app.sync.remoteBoardId.value,localWords:app.words.wordBank.value,serverBWords:remoteWords.get(2)||[]}))
    expect(remoteWords.get(2)||[]).not.toContain('private input captured in A workspace')
    expect(app.words.wordBank.value).not.toContain('private input captured in A workspace')
  })
  it('unfreezes a card after a definitely-unsent delete fails, including restart/reconnect',async()=>{
    remote.delete(2)
    const app=await online()
    failReplacement=true
    expect(await app.sync.removeBoard(1)).toBe(false)
    expect(calls.some(r=>r.method==='DELETE')).toBe(false)
    failReplacement=false
    await app.sync.retryPending()
    const afterRetry=JSON.parse(app.sync.exportLocalRecovery())
    const edit=app.board.saveBoardTitle('ordinary edit after failed delete')
    vi.clearAllTimers();vi.resetModules()
    const restarted=await open();await restarted.sync.initialSync();await restarted.sync.retryPending()
    const restartEdit=restarted.board.saveBoardTitle('ordinary edit after relaunch')
    const state=JSON.parse(restarted.sync.exportLocalRecovery())
    console.log('REPRO deletion lock',JSON.stringify({afterRetryDeleting:afterRetry.boards['1'].deleting,edit,restartEdit,deleting:state.boards['1'].deleting,deleted:state.boards['1'].deleted,board:restarted.sync.remoteBoardId.value,error:restarted.sync.lastSyncError.value,remoteExists:remote.has(1)}))
    expect(edit).toBe(true)
    expect(restartEdit).toBe(true)
  })
  it('rediscovers a received-but-unrecorded starter on explicit retry without repeating its POST',async()=>{
    remote.delete(1);remote.delete(2)
    const app=await open();app.api.setToken('token-A');app.api.setRefreshToken('refresh-A')
    loseStarterResponse=true
    expect(await app.sync.initialSync()).toBeNull()
    expect(remote.has(4)).toBe(true)
    const beforeRetry=calls.length
    await app.sync.retryPending()
    console.log('REPRO starter recovery',JSON.stringify({board:app.sync.remoteBoardId.value,error:app.sync.lastSyncError.value,remoteExists:remote.has(4),retryRequests:calls.slice(beforeRetry).map(c=>`${c.method} ${new URL(c.url).pathname}`),createPosts:calls.filter(c=>c.method==='POST'&&new URL(c.url).pathname==='/api/boards').length}))
    expect(calls.filter(c=>c.method==='POST'&&new URL(c.url).pathname==='/api/boards')).toHaveLength(1)
    expect(app.sync.remoteBoardId.value).toBe(4)
  })
  it('boots after initial wx/server login failure when the existing manual retry succeeds',async()=>{
    const app=await open()
    const auth=(await import('../src/pages/index/useAuth')).useAuth()
    failLogin=true
    // board.vue onMounted does not call initialSync when this returns false.
    expect(await auth.ensureLoggedIn()).toBe(false)
    failLogin=false
    expect(await auth.ensureLoggedIn(true)).toBe(true)
    const beforeRetry=calls.length
    // Manual retry explicitly resumes startup; passive wakeups remain gated.
    await app.sync.initialSync()
    console.log('REPRO manual login recovery',JSON.stringify({loggedIn:auth.loggedIn.value,board:app.sync.remoteBoardId.value,error:app.sync.lastSyncError.value,retryRequests:calls.slice(beforeRetry).map(c=>`${c.method} ${new URL(c.url).pathname}`)}))
    expect(app.sync.remoteBoardId.value).toBe(3)
  })
  it('can retry a transient initial workspace save failure after space is freed',async()=>{
    failWorkspaceSaves=true
    const app=await open()
    expect(app.sync.lastSyncError.value).toBe('quota')
    failWorkspaceSaves=false
    app.api.setToken('token-A')
    await app.sync.initialSync()
    await app.sync.retryPending()
    const edited=app.board.saveBoardTitle('after freeing storage')
    console.log('REPRO initial storage recovery',JSON.stringify({board:app.sync.remoteBoardId.value,error:app.sync.lastSyncError.value,edited,requests:calls.map(c=>`${c.method} ${new URL(c.url).pathname}`)}))
    expect(app.sync.remoteBoardId.value).toBe(1)
    expect(edited).toBe(true)
  })
  it('CONTROL: persists offline metadata, rolls back a failed save, and drains without a refresh',async()=>{
    const app=await online()
    app.board.cells.value[0].title='valid pending edit'
    failWorkspaceSaves=true
    expect(app.board.changeGridSize(4)).toBe(false)
    expect(app.board.gridSize.value).toBe(3)
    expect(app.board.cells.value).toHaveLength(9)
    expect(app.board.cells.value[0].title).toBe('valid pending edit')
    failWorkspaceSaves=false
    await vi.advanceTimersByTimeAsync(800);await tick()
    expect(remote.get(1).cells[0].title).toBe('valid pending edit')
    expect(app.sync.syncing.value).toBe(false)
  })
  it('keeps explicit reconnect safe after the automatic same-owner refresh drain',async()=>{
    const app=await online()
    app.board.cells.value[0].title='valid after reconnect'
    refreshOnSettings=true
    await vi.advanceTimersByTimeAsync(800);await tick()
    expect(remote.get(1).cells[0].title).toBe('valid after reconnect')
    expect(app.sync.syncing.value).toBe(false)
    await app.sync.retryPending()
    expect(remote.get(1).cells[0].title).toBe('valid after reconnect')
    expect(app.sync.syncing.value).toBe(false)
  })

  it('does not turn a pending unowned guest merge into B account data during verification',async()=>{
    const app=await open()
    app.sync.editLocal(()=>{app.words.wordBank.value=['known guest source']})
    await app.api.login()
    holdBProfile=true;holdModeration=true
    const starting=app.sync.initialSync()
    const merging=app.words.mergeWords(['unowned guest pending input'])
    holdBProfile=false;ok(heldBProfile!,{userId:2,nickname:'',imageStorage:'local'})
    await starting
    if (heldModeration) ok(heldModeration,{pass:true})
    await merging
    await vi.advanceTimersByTimeAsync(800);await tick()
    console.log('REPRO guest continuation',JSON.stringify({principal:app.api.getStoredPrincipal(),accountWords:app.words.wordBank.value,serverBWords:remoteWords.get(2)||[],guestWords:JSON.parse(app.sync.exportLocalRecovery()).unowned.words.words}))
    expect(remoteWords.get(2)||[]).not.toContain('unowned guest pending input')
  })
  it('CONTROL: ordinary login does not implicitly copy persisted guest board or words',async()=>{
    const app=await open()
    app.board.cells.value[0].title='guest-authored board text'
    app.sync.editLocal(()=>{app.words.wordBank.value=['guest-authored bank text']})
    await app.api.login();await app.sync.initialSync();await vi.advanceTimersByTimeAsync(800)
    expect(app.board.cells.value[0].title).toBe('word 3-0')
    expect(app.words.wordBank.value).not.toContain('guest-authored bank text')
    expect(remoteWords.get(2)||[]).not.toContain('guest-authored bank text')
    expect(JSON.parse(app.sync.exportLocalRecovery()).unowned.words.words).toContain('guest-authored bank text')
  })
  it('CONTROL: a confirmed delete stays deleted on restart but retains its snapshot for recovery',async()=>{
    const app=await online()
    expect(await app.sync.removeBoard(1)).toBe(true)
    expect(remote.has(1)).toBe(false)
    expect(app.sync.remoteBoardId.value).toBe(2)
    vi.clearAllTimers();vi.resetModules()
    const restarted=await open();await restarted.sync.initialSync()
    const state=JSON.parse(restarted.sync.exportLocalRecovery())
    expect(state.boards['1'].deleted).toBe(true)
    expect(state.boards['1'].deleting).toBe(false)
    expect(state.boards['1'].snapshot.cells[0].title).toBe('word 1-0')
    expect(restarted.sync.remoteBoardId.value).toBe(2)
    expect(await restarted.sync.switchBoard(1)).toBeNull()
    expect(restarted.sync.remoteBoardId.value).toBe(2)
  })
  it.each([true, false])('reconciles an interrupted delete on restart without replaying DELETE, remote remains %s', async remains => {
    const app = await online()
    await app.sync.switchBoard(2); await tick(); await app.sync.switchBoard(1); await tick()
    loseDeleteResponse = true; keepRemoteOnDelete = remains; failDetailReads = true
    expect(await app.sync.removeBoard(1)).toBe(false)
    expect(JSON.parse(app.sync.exportLocalRecovery()).boards['1'].deleting).toBe(true)
    vi.clearAllTimers(); vi.resetModules(); failDetailReads = false
    const restarted = await open(); await restarted.sync.initialSync(); await restarted.sync.retryPending()
    const saved = JSON.parse(restarted.sync.exportLocalRecovery()).boards['1']
    expect(saved.deleting).toBe(false); expect(saved.deleted).toBe(!remains)
    expect(saved.snapshot.cells[0].title).toBe('word 1-0')
    expect(calls.filter(call => call.method === 'DELETE')).toHaveLength(1)
    if (remains) {
      expect(await restarted.sync.switchBoard(1)).not.toBeNull()
      expect(restarted.board.saveBoardTitle('editable after canceled deletion')).toBe(true)
    }
  })
  it('preserves corrupt workspace data and its error through repeated retry instead of reporting online', async () => {
    const { workspaceKey } = await import('../src/pages/index/boardRepository')
    const api = await import('../src/pages/index/api')
    const key = workspaceKey(`${api.SERVICE_ID}/guest`)
    const original = JSON.stringify({ version: 99, precious: 'do not replace' })
    disk.set(key, original)
    const app = await open(); app.api.setToken('token-A')
    expect(await app.sync.initialSync()).toBeNull(); await app.sync.retryPending()
    expect(app.sync.lastSyncError.value).toContain('本地数据无法读取')
    expect(calls).toHaveLength(0); expect(disk.get(key)).toBe(original)
    expect(app.board.saveBoardTitle('cannot overwrite corrupt storage')).toBe(false)
  })

})
