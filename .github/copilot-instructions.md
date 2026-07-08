# Copilot 项目指令

本文件会被 VS Code Copilot 自动加载，约束 agent 在本仓库的命令行为，
避免触发运行时安全护栏导致的"工具调用被拒 / 回合中断"。

> 仓库地图、技术栈、目录结构、命令表见 [`AGENTS.md`](../AGENTS.md)；
> 本地开发 / 干净库 / 可视化 QA / 重置首启的完整流程见
> [`dev` skill](skills/dev/SKILL.md)。

## 项目铁律（始终生效）

- **本地优先双状态**：状态存在两处——服务端 `server/data/bingo.db` 与客户端微信 Storage，
  二者互相回灌。**只清一边，另一边下次启动会把数据推回去**。要回到全新首启必须按顺序两边都清
  （见 dev skill），别只删一边就以为重置了。
- **不要随意创建 `client/.env.development`**：它会让 dev 构建覆盖生产域名改连本地；反过来，
  调试本地链路时**缺它则小程序会连到生产服务器写真实数据**。改动前先确认当前指向哪。
- **想要空库测试用 `npm run dev:fresh`**（内存库），不要手删 `bingo.db` 或临时写重置脚本。

## 进程管理（最常见的中断来源）

- **终止进程必须用字面数字 PID**：先 `lsof -ti:<port>` 或 `ps ... | awk '{print $2}'`
  查出 PID，再用 `kill 12345`（字面数字）。
- **禁止** `kill $VAR`、`kill $(...)`、`pkill`、`killall` 等按名字/变量终止进程的写法，
  以及把 `kill` 包进 `if [ -n "$PID" ]; then kill $PID; fi`——都会被护栏拒绝并中断回合。
  正确做法是两步：先查出 PID，再用字面数字 kill。

## 命令复杂度

- 避免**过度复杂的单行命令**：多个 `&&`/`||`、嵌套引号、`node -e "..."`、
  带 `|` 交替的复杂正则混在一起，容易被命令审查器判为可疑而中断。
- 优先**拆成多条单一职责的简单命令**；读文件用 view 工具，搜索用 grep 工具，
  而不是 `cat | grep '...|...'` 这种管道。

## 后台服务 / 长时进程

- 启动常驻服务（http server、`uni` dev、无头浏览器等）用 bash 工具的 **async + detach**，
  不要用同步命令等它"结束"。
- 对会持续轮询、不自动退出的命令（连后端的 H5 页、`--virtual-time-budget` 截图），
  不要用阻塞到超时的同步等待。

## 依赖安装

- 避免安装会**后台静默下载大体积二进制**的包（如 `puppeteer` 拉 Chromium），易长时间挂起。
  需要无头浏览器时优先复用系统 Chrome/Edge 或微信开发者工具 automator。

## E2E 测试（已落地，uni-automator）

- 已搭好基于 `@dcloudio/uni-automator` 的 E2E 骨架，详见 `client/tests/e2e/README.md`。
- 运行 mp-weixin：直接 `npm run test:e2e:mp`（**无需先 build**）；需开发者工具**开启服务端口**且
  已登录。本套件**仅本地手动跑**，CI 不含。
- 配置必须保持 `compile: true`：automator 自己跑 `dev:mp-weixin` 编译并注入运行时 hook
  `wx.$$initRuntimeAutomator`。普通 `uni build` 不注入该 hook，用 `compile: false` + 预构建会
  报 `wx.$$initRuntimeAutomator not exists`。若再遇此错：确认 `compile: true`，并清掉 DevTools
  编译缓存 `WeappCache/WeappCompileCache/*`；首次自动化弹「信任项目」3 秒框可用 `--trust-project` 跳过。
- 运行 h5：构建后起静态服务，再 `npm run test:e2e:h5`。
- 用例放 `client/tests/e2e/*.e2e.ts`（与 Vitest 单元测试 `*.test.ts` 天然隔离）。
- 进主页用 `gotoMain()`，切 tab 用 `switchTab(page, idx)`（真实点击 `.tab-item`）。
- 注意：TS6 与 ts-jest@27 不兼容，E2E 用 **babel-jest**（`babel.config.e2e.js`）转译，
  不要引入 ts-jest。

## 截图（一次性需求）

- 偶尔手动截图可裸用 `miniprogram-automator` + 微信开发者工具 CLI；
  切 tab 用 `page.$$('.tab-item')[idx].tap()`，不要用 `uni.$emit('switch-tab', ...)`。

## 临时文件

- 截图脚本、seed 页等临时产物放 `/tmp` 或会话目录，完成后清理；
  不要在仓库内留下 `_*.js`、`dist/build/h5/_seed*.html` 等临时文件。
