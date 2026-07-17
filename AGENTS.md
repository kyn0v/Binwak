# AGENTS.md

面向 AI agent 与开发者的仓库地图。**README 只讲项目是什么与创作背景；具体怎么开发、怎么跑、代码在哪，看这里。**

## 这是什么

微信小程序版"城市漫步 Bingo 打卡"。本地优先（local-first）架构：
**uni-app (Vue 3)** 前端 + **Express / SQLite** 后端。管理能力由后端 `/api/admin` 提供，
管理后台前端**不在本仓库**——仅本地运行、经 SSH 隧道访问 `127.0.0.1:3000` 的 admin API。

## 技术栈

| 层 | 技术 |
|----|------|
| 客户端 | uni-app, Vue 3, TypeScript, Vite, Vitest, uni-automator (E2E) |
| 服务端 | Express, SQLite, TypeScript, tsx, Vitest |
| 部署 | PM2, Nginx, rsync, GitHub Actions |

环境要求：Node.js 20+；微信开发者工具（预览 `mp-weixin` 构建产物）。

## 目录结构

```
.
├── client/          # uni-app 小程序前端
│   ├── src/         # components / pages / config / utils / static
│   └── tests/       # Vitest 单元测试 + e2e/（uni-automator）
├── server/          # Express + SQLite 后端（含 /api/admin 管理 API）
│   └── src/         # app.ts / routes / services / db / middleware / utils
├── shared/          # 前后端共享类型（types.ts）
├── deploy/          # PM2 / Nginx 配置、release.sh、setup.sh
├── scripts/         # dev-local.sh、reset-local.sh、deploy-server.sh
└── .github/         # CI workflows、copilot-instructions、skills、agents
```

## 架构要点：本地优先双状态

状态存在 **两处**，且会互相回灌：

- 服务端数据库 `server/data/bingo.db`
- 客户端缓存（微信小程序 Storage：打卡、token、词库）

**只清一边，另一边下次启动会把数据推回去。** 想回到"全新第一次启动"必须按顺序两边都清——见
[dev skill](.github/skills/dev/SKILL.md)。

## 常用命令

根 `package.json` 提供聚合脚本：

| 命令 | 作用 |
|------|------|
| `npm run install:all` | 安装 client / server 全部依赖 |
| `npm run server:dev` | 起后端（持久库 `server/data/bingo.db`） |
| `npm run client:dev` | 构建小程序到 `client/dist/dev/mp-weixin` |
| `npm run dev:local` | 一条命令：起后端 + 客户端 watch 构建 + 打开微信开发者工具 |
| `npm run reset:local` | 重置本地服务端数据库 |

测试：

```bash
npm --prefix server run test   # 后端单元测试
npm --prefix client run test   # 前端单元测试
npm --prefix client run test:e2e:mp   # 小程序 E2E（仅本地手动，需开发者工具）
```

> 本地开发、`dev:fresh` 干净库、可视化 QA、重置到全新首启的完整步骤见
> **[dev skill](.github/skills/dev/SKILL.md)**。

## 贡献流程

克隆、建 issue、开分支、起 PR、申请合并的完整步骤见 **[CONTRIBUTING.md](CONTRIBUTING.md)**。

## CI/CD

| Workflow | 触发条件 | 动作 |
|----------|----------|------|
| Server | push main (`server/`, `shared/`, `deploy/`) | 测试 → 构建 → rsync 至远端 → PM2 重启 |
| Client | push main (`client/`, `shared/`) | 测试 → 构建 → 上传至微信 |

## Agent 须知

- **行为铁律 / 命令护栏**：见 [.github/copilot-instructions.md](.github/copilot-instructions.md)（自动加载）。
- **专职 Agent**（`/agent` 选用，见 `.github/agents/`）：
  - [designer](.github/agents/designer/AGENTS.md) — 前端设计：为 `client`（小程序）撰写实现级 UI 规格，或对 PR 前端改动做证据驱动的可视化审查
  - [engineer](.github/agents/engineer/AGENTS.md) — 跨 `client`/`server` 实现功能、修 bug、开 PR
  - [reviewer](.github/agents/reviewer/AGENTS.md) — 用 thermo-nuclear 双维度 rubric 审查 PR、提交 inline 评论；`MODE: ci` 下盯 CI 检查
  - [coordinator](.github/agents/coordinator/AGENTS.md) — 编排 issue → PR 全流程：依次调度 designer/engineer/reviewer，自己不写代码、不评审、不合并
- **可调用技能**：
  - [dev](.github/skills/dev/SKILL.md) — 本地开发、干净库、可视化 QA、重置首启
  - [e2e](.github/skills/e2e/SKILL.md) — 用 uni-automator 驱动微信开发者工具做真机截图/E2E 验证的踩坑手册
  - `/thermos`、`/thermo-nuclear-review`、`/thermo-nuclear-code-quality-review` — 代码审查（见 `.github/skills/`）
