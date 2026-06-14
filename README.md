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

### 测试

```bash
npm --prefix server run test   # 后端测试
npm --prefix client run test   # 前端测试
```

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

### Tests

```bash
npm --prefix server run test   # backend tests
npm --prefix client run test   # frontend tests
```

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
