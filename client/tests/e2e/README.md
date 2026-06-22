# E2E 测试（uni-automator）

基于 uni-app 官方 `@dcloudio/uni-automator`，驱动**真实运行时**做端到端测试：
mp-weixin 走微信开发者工具，h5 走无头浏览器。`program` / `uni` 由测试环境注入为全局对象。

## 目录

- `helpers.ts` — 共享步骤（注入 fixture、进主页、切 tab、mock ActionSheet、截图）
- `home.e2e.ts` — 主壳冒烟（落主页、3 tab、标题、切 tab）
- `interactions.e2e.ts` — 交互（设置菜单、卡片切换下拉、模式切换、完成格子触发 Bingo 弹窗）
- `visual.e2e.ts` — 三个 tab 的视觉回归
- `*.e2e.ts` — 测试用例（jest 语法）

### 驱动原生交互的技巧

- 完成格子走 `uni.showActionSheet`（原生弹窗，automator 不便点击）。用
  `mockActionSheet(tapIndex)` 把它 mock 成直接返回指定选项，结束后 `restoreActionSheet()`。
- Bingo 触发：用 `seedBingoReadyBoard()` 预置“第一行差一格成线”，进主页后点第 4 格即触发
  `.bingo-overlay`。注意 `loadState` 会把当前线数记为“已见”，所以必须预置**未成线**、再补一格。
- mp-weixin automator 对动态绑定的 `#id` 选择器不可靠，优先用 `.class` + 索引（如 `page.$$('.cell')[3]`）。

## 运行

### 微信小程序（mp-weixin）

前置条件（一次性）：
1. 微信开发者工具 → **设置 → 安全设置 → 开启「服务端口」**
2. IDE 已扫码登录

每次运行：

```bash
npm run build:mp-weixin   # 先构建产物（dist/build/mp-weixin）
npm run test:e2e:mp       # 启动 DevTools 自动化并跑用例
```

CLI 路径默认 `/Applications/wechatwebdevtools.app/Contents/MacOS/cli`，
可用环境变量覆盖：`WX_CLI_PATH=/path/to/cli npm run test:e2e:mp`。

### H5

```bash
npm run build              # 构建 H5
# 在 dist/build/h5 起静态服务（默认端口 8847），例如：
#   (cd dist/build/h5 && python3 -m http.server 8847)
npm run test:e2e:h5
```

可用 `H5_URL` 覆盖站点地址。

## 写用例要点

- 选择器用 `page.$('.cls')` / `page.$$('.cls')`，文本用 `el.text()`，点击 `el.tap()`。
- 进主页统一用 `gotoMain()`（内部已 seed `binwak-onboarded` 并 `reLaunch`）。
- 切 tab 用 `switchTab(page, idx)`（0=挑战 1=广场 2=我的），走真实点击。
- mp-weixin 不支持跨组件选择器；`reLaunch` 后需 `waitFor` 留足渲染时间。
- 文件名用 `*.e2e.ts`，与 Vitest 单元测试（`*.test.ts`）天然隔离，互不影响。

## 配置

- `jest.e2e.config.js` — jest + uni-automator 环境/teardown、平台参数、babel 转译
- `babel.config.e2e.js` — 仅 E2E 用的 TS 转译（项目是 TS6，ts-jest@27 不兼容，故用 babel）
- `setup.image.js` — 注册 jest-image-snapshot 的 `toMatchImageSnapshot` 匹配器

## 视觉回归测试（visual regression）

`visual.e2e.ts` 对三个 tab 截图并与基准图做**像素比对**（jest-image-snapshot）。

- 基准图：`tests/e2e/__image_snapshots__/tab-*.png`，**已提交**入库。
- 比对失败时会在 `__diff_output__/` 生成差异图（已 gitignore，仅本地查看）。
- 容差：`helpers.ts` 的 `imageSnapshotOptions`（SSIM + 2% 阈值）吸收抗锯齿差异。

更新基准（首次，或确认是有意的 UI 改动后）：

```bash
npm run build:mp-weixin
npm run test:e2e:mp -- visual.e2e -u   # -u 重写基准图
```

日常回归（与基准比对，不加 -u）：

```bash
npm run test:e2e:mp -- visual.e2e
```

**数据稳定性**：视觉用例在进入主页前调用 `seedFixtures()`，向本地 storage 注入
一组**固定的测试数据**（确定的卡片标题、棋盘内容/完成态、昵称、主题）。因此基准图
**完全自包含、可复现**，不依赖后端数据或当前日期。这是纯测试侧 fixture，不改动任何
生产代码（注意：`safeStorage` 不做 JSON 序列化，对象/数字要直接写入，不能 stringify）。

