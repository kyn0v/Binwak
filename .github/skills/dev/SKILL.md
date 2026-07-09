---
name: dev
scope: binwak
version: 0.1.0
description: "Binwak 本地开发工作流：起本地后端+小程序、干净库测试(dev:fresh)、连真机可视化 QA(dev:local)、重置到全新第一次启动。当需要在本地跑通链路、验证渲染效果、或复现新用户首启时使用。"
---

# 本地开发 (dev)

Binwak 是本地优先架构，状态存在 **两处**（服务端 `server/data/bingo.db` 与客户端微信 Storage），
二者互相回灌。本技能覆盖：常规本地开发、干净库测试、可视化 QA、重置到全新首启。

## 1. 常规本地开发

```bash
# 后端
cd server && npm install && cp .env.example .env  # 编辑 .env
npm run dev

# 前端
cd client && npm install
npm run dev:mp-weixin
# 打开微信开发者工具 → 导入 client/dist/dev/mp-weixin

# 管理后台（生产由后端在 /admin 静态托管）
cd admin && npm install
npm run dev
```

## 2. 干净库测试（dev:fresh）

每次都想要空库时，后端用 `npm run dev:fresh` 启动：

- 整个 SQLite 库放内存（`DB_PATH=:memory:`），**进程一启动就是空库、重启即清空、磁盘不写任何文件**。
- 无需手动删 `server/data/bingo.db` 或写重置脚本。
- 适合验证「新用户首启引导」这类依赖全新状态的流程。
- 管理后台账号走环境变量（`ADMIN_USERNAME` / `ADMIN_PASSWORD`），不在数据库里，空库也能登录。
- 需要数据跨重启保留时仍用 `npm run dev`（持久库）。

> 注意：`dev:fresh` 用 `tsx watch`，改动后端源码触发热重载时内存库会一并清空。

## 3. 真实端到端 + 看实际效果（可视化 QA）

单元测试覆盖逻辑，但卡片导出、布局、样式等渲染效果需要在真实小程序里用眼睛验证。

```bash
cp .env.local.example .env.local   # 首次：填入 WX_APPID / WX_SECRET
echo "VITE_API_BASE_URL=http://localhost:3000" > client/.env.development  # 首次：让客户端连本地后端
npm run dev:local                  # 一条命令：起后端 + 客户端 watch 构建 + 打开微信开发者工具
```

`dev:local` 会启动后端（`http://localhost:3000`，真实 SQLite + 本地磁盘存储），构建客户端到
`client/dist/dev/mp-weixin`，并打开微信开发者工具。首次需在 **详情 → 本地设置 → 勾选「不校验合法域名」**
才能连本地后端。随后在模拟器/真机里登录、打卡、导出卡片，即可验证真实链路（含 `POST /api/upload`
图片上传，文件落到 `server/data/uploads/`）。`Ctrl-C` 退出。

> ⚠️ `client/.env.development`（已 gitignore）会让 dev 构建覆盖 `client/.env` 里的生产域名、改为连本地。
> **不创建它，小程序会连到生产服务器**（写真实数据）。

## 4. 重置到「全新第一次启动」

状态在两处且互相回灌——**只清一边，另一边下次启动会把数据推回去**。所以必须按顺序两边都清：

```bash
# ① 先清客户端缓存：微信开发者工具 → 工具 → 清除缓存 → 全部清除（先别重新编译）
# ② 再重置服务端数据库：
npm run reset:local
# ③ 回开发者工具重新编译（Cmd/Ctrl + B）
```

清完后即为干净的初始状态（无打卡勾；词库里的 25 个默认词来自客户端内置 `DEFAULT_WORDS`，属正常）。
日常调试无需重置——只有想看全新用户体验时才用。

## 5. E2E 测试

详见 `client/tests/e2e/README.md`。要点：

- mp-weixin：`npm --prefix client run test:e2e:mp`（无需先 build），需开发者工具开启服务端口且已登录，仅本地手动跑。
- 配置须保持 `compile: true`，否则报 `wx.$$initRuntimeAutomator not exists`。
- h5：构建后起静态服务，再 `npm --prefix client run test:e2e:h5`。

跑 mp-weixin e2e / 用真机截图验证 UI 改动时的踩坑操作手册（端口 9420 死锁、代理劫持、
登录态数据漂移、trust-project 弹窗等），见
[e2e skill](../e2e/SKILL.md)。
