# Binwak

[简体中文](#简体中文) | [English](#english)

---

## 简体中文

微信小程序版城市漫步 Bingo 打卡。基于 **uni-app (Vue 3)** + **Express / SQLite** 后端。

### 功能

- 可配置 Bingo 网格（3×3 ~ 6×6），每格拍照打卡
- 多 Board 管理 — 创建、切换、克隆、收藏
- 模板广场 — 发布、浏览、使用社区模板
- 分享码 — 快速导入/导出 Board
- 卡片导出为拍立得风格图片
- 词库管理（支持插图）

### 环境要求

- Node.js 20+
- 微信开发者工具（预览 `mp-weixin` 构建产物）

### 本地开发

```bash
# 后端
cd server && npm install && cp .env.example .env  # 编辑 .env
npm run dev

# 前端
cd client && npm install
npm run dev:mp-weixin
# 打开微信开发者工具 → 导入 dist/dev/mp-weixin

# 管理后台
cd admin && npm install
npm run dev
# 生产环境由后端在 /admin 路径静态托管
```

> 💡 **每次都用干净数据库测试**：后端用 `npm run dev:fresh` 启动即可。它把整个 SQLite 库放在内存里（`DB_PATH=:memory:`），**进程一启动就是空库、重启即清空、磁盘不写任何文件**，无需手动删 `server/data/bingo.db` 或写重置脚本。适合验证「新用户首启引导」这类依赖全新状态的流程。管理后台账号走环境变量（`ADMIN_USERNAME` / `ADMIN_PASSWORD`），不在数据库里，空库也能正常登录。需要数据跨重启保留时仍用 `npm run dev`（持久库 `server/data/bingo.db`）。
> 注意：`dev:fresh` 用 `tsx watch`，改动后端源码触发热重载时内存库会一并清空。

### 测试

```bash
npm --prefix server run test   # 后端测试
npm --prefix client run test   # 前端测试
```

### 真实端到端 + 看实际效果（可视化 QA）

单元测试覆盖逻辑，但卡片导出、布局、样式等渲染效果需要在真实小程序里用眼睛验证。

```bash
cp .env.local.example .env.local   # 首次：填入 WX_APPID / WX_SECRET
echo "VITE_API_BASE_URL=http://localhost:3000" > client/.env.development  # 首次：让客户端连本地后端
npm run dev:local                  # 一条命令：起后端 + 客户端 watch 构建 + 打开微信开发者工具
```

`dev:local` 会启动后端（`http://localhost:3000`，真实 SQLite + 本地磁盘存储），构建客户端到 `dist/dev/mp-weixin`，并打开微信开发者工具。首次需在 **详情 → 本地设置 → 勾选「不校验合法域名」** 才能连本地后端。随后在模拟器/真机里登录、打卡、导出卡片，即可验证真实链路（含 `POST /api/upload` 图片上传，文件落到 `server/data/uploads/`）。`Ctrl-C` 退出。

> ⚠️ `client/.env.development`（已 gitignore）会让 dev 构建覆盖 `client/.env` 里的生产域名、改为连本地。**不创建它，小程序会连到生产服务器**（写真实数据）。

#### 重置到「全新第一次启动」

本项目是本地优先架构，状态存在 **两处**：服务端数据库（`server/data/bingo.db`）和客户端缓存（微信小程序 Storage：打卡、token、词库）。两者会互相回灌——**只清一边，另一边下次启动会把数据推回去**。所以必须按顺序两边都清：

```bash
# ① 先清客户端缓存：微信开发者工具 → 工具 → 清除缓存 → 全部清除（先别重新编译）
# ② 再重置服务端数据库：
npm run reset:local
# ③ 回开发者工具重新编译（Cmd/Ctrl + B）
```

清完后即为干净的初始状态（无打卡勾；词库里的 25 个默认词来自客户端内置 `DEFAULT_WORDS`，属正常）。日常调试无需重置——只有想看全新用户体验时才用。

### CI/CD

| Workflow | 触发条件 | 动作 |
|----------|----------|------|
| Server | push main (`server/`, `shared/`, `admin/`, `deploy/`) | 测试 → 构建 → rsync 至远端 → PM2 重启 |
| Client | push main (`client/`, `shared/`) | 测试 → 构建 → 上传至微信 |

### 灵感来自

- [bingo.moonwillknow.dev](https://bingo.moonwillknow.dev)
- [nicetrypod.com/2024/bingo2nd](https://nicetrypod.com/2024/bingo2nd)

### Copilot 审查技能（Thermos 迁移）

- 已将 Thermos 从 Cursor 插件结构迁移为 Copilot 原生结构：`.github/skills/` 与 `.github/agents/`
- 可用技能：`/thermos`、`/thermo-nuclear-review`、`/thermo-nuclear-code-quality-review`
- 来源与 MIT 署名见：`.github/skills/thermos/NOTICE`

### License

MIT

---

## English

A WeChat Mini Program for "city walk" Bingo-style photo check-ins. Built with **uni-app (Vue 3)** frontend and **Express / SQLite** backend.

### Features

- Configurable Bingo grids (3×3 ~ 6×6) with per-cell photo check-in
- Multi-board management — create, switch, clone, favorite
- Template plaza — publish, browse, use community templates
- Share codes — quick import/export of a Board
- Export cards as Polaroid-style images
- Word bank with illustration support

### Requirements

- Node.js 20+
- WeChat Developer Tools (to preview the `mp-weixin` build output)

### Local Development

```bash
# Backend
cd server && npm install && cp .env.example .env  # edit .env
npm run dev

# Frontend
cd client && npm install
npm run dev:mp-weixin
# Open WeChat Developer Tools → import dist/dev/mp-weixin

# Admin console
cd admin && npm install
npm run dev
# In production it's served by the backend at /admin
```

> 💡 **Test against a clean database every time**: start the backend with `npm run dev:fresh`. It keeps the whole SQLite database in memory (`DB_PATH=:memory:`), so it's **empty on every start, wiped on restart, and writes nothing to disk** — no need to delete `server/data/bingo.db` or run a reset script. Ideal for exercising flows that depend on a brand-new state, like the first-launch onboarding. The admin console uses env-var credentials (`ADMIN_USERNAME` / `ADMIN_PASSWORD`), not the database, so it still logs in against an empty DB. Use `npm run dev` when you want data to persist across restarts (durable `server/data/bingo.db`).
> Note: `dev:fresh` runs under `tsx watch`, so editing backend source triggers a reload that also clears the in-memory database.

### Tests

```bash
npm --prefix server run test   # backend tests
npm --prefix client run test   # frontend tests
```

### End-to-End / Visual QA

Unit tests cover logic, but rendering — card export, layout, styles — must be verified by eye in a real Mini Program.

```bash
cp .env.local.example .env.local   # first time: fill in WX_APPID / WX_SECRET
echo "VITE_API_BASE_URL=http://localhost:3000" > client/.env.development  # first time: point the client at the local backend
npm run dev:local                  # one command: backend + client watch build + opens WeChat DevTools
```

`dev:local` starts the backend (`http://localhost:3000`, real SQLite + local disk storage), builds the client to `dist/dev/mp-weixin`, and opens WeChat Developer Tools. On first run, enable **Details → Local settings → "Do not verify domains"** so it can reach the local backend. Then log in, check in, and export a card to exercise the real flow (including `POST /api/upload`, with files written to `server/data/uploads/`). Press `Ctrl-C` to stop.

> ⚠️ `client/.env.development` (gitignored) makes the dev build override the production domain in `client/.env` and target localhost. **Without it, the Mini Program talks to the production server** (writing real data).

#### Reset to a clean "first launch"

This app is local-first, so state lives in **two** places: the server database (`server/data/bingo.db`) and the client cache (WeChat Mini Program Storage: ticks, token, word bank). They re-seed each other — **clearing only one lets the other push its data back** on next launch. So clear both, in order:

```bash
# ① Clear the client cache first: WeChat DevTools → Tools → Clear cache → Clear all (don't recompile yet)
# ② Then reset the server database:
npm run reset:local
# ③ Recompile in DevTools (Cmd/Ctrl + B)
```

You'll then see the clean initial state (no ticks; the 25 default words come from the client's built-in `DEFAULT_WORDS` — that's expected). Day-to-day debugging needs no reset — use it only when you want a fresh-user experience.

### CI/CD

| Workflow | Trigger | Actions |
|----------|---------|---------|
| Server | push main (`server/`, `shared/`, `admin/`, `deploy/`) | test → build → rsync to remote → PM2 restart |
| Client | push main (`client/`, `shared/`) | test → build → upload to WeChat |

### Inspired by:

- [bingo.moonwillknow.dev](https://bingo.moonwillknow.dev)
- [nicetrypod.com/2024/bingo2nd](https://nicetrypod.com/2024/bingo2nd)

### Copilot Review Skills (Thermos migration)

- Thermos has been migrated from Cursor plugin format into Copilot-native `.github/skills/` and `.github/agents/`.
- Available skills: `/thermos`, `/thermo-nuclear-review`, `/thermo-nuclear-code-quality-review`.
- Source attribution and MIT notice: `.github/skills/thermos/NOTICE`.

### License

MIT
