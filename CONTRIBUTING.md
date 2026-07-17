# 贡献指南 / Contributing

[简体中文](#简体中文) | [English](#english)

---

## 简体中文

欢迎贡献！本项目是个人 vibe code 的小程序，流程力求轻量。技术栈、目录结构与本地运行细节见 [AGENTS.md](AGENTS.md)。

### 上手步骤

1. **Fork & 克隆**

   ```bash
   git clone https://github.com/<你的用户名>/Binwak.git
   cd Binwak
   ```

2. **安装依赖**

   ```bash
   npm run install:all   # 安装 client / server 全部依赖
   ```

3. **本地跑起来** — 见 [dev skill](.github/skills/dev/SKILL.md)（常规开发、`dev:fresh` 干净库、`dev:local` 可视化 QA）。

### 提交改动

4. **先开 Issue**（除非是极小修复）— 描述问题或提案，便于先对齐方向再动手。

5. **开分支**

   ```bash
   git checkout -b <type>/<简短描述>   # 如 feat/share-qr、fix/upload-timeout、docs/readme
   ```

6. **改完跑测试**

   ```bash
   npm --prefix server run test
   npm --prefix client run test
   ```

7. **提交**（信息简洁，建议用 `feat:` / `fix:` / `docs:` / `refactor:` 等前缀）

   ```bash
   git commit -m "feat: 支持分享二维码"
   ```

8. **推送并起 PR**

   ```bash
   git push -u origin <你的分支>
   ```

   在 GitHub 上对 `main` 发起 Pull Request，正文里用 `Closes #<issue 号>` 关联 Issue。

9. **申请合并** — 等 CI 通过、Review 通过后合并（推荐 squash）。合并后删除分支。

> CI 会在 push 到 `main` 时自动测试 / 构建 / 部署，详见 [AGENTS.md](AGENTS.md#cicd)。

---

## English

Contributions welcome! This is a personal vibe-coded Mini Program, so the flow is kept lightweight. For tech stack, layout, and local run details see [AGENTS.md](AGENTS.md).

### Getting started

1. **Fork & clone**

   ```bash
   git clone https://github.com/<your-username>/Binwak.git
   cd Binwak
   ```

2. **Install deps**

   ```bash
   npm run install:all   # installs client / server
   ```

3. **Run it locally** — see the [dev skill](.github/skills/dev/SKILL.md) (normal dev, `dev:fresh` clean DB, `dev:local` visual QA).

### Submitting changes

4. **Open an issue first** (unless it's a tiny fix) to align on direction before coding.

5. **Create a branch**

   ```bash
   git checkout -b <type>/<short-desc>   # e.g. feat/share-qr, fix/upload-timeout, docs/readme
   ```

6. **Run tests after your changes**

   ```bash
   npm --prefix server run test
   npm --prefix client run test
   ```

7. **Commit** (keep messages concise; prefer `feat:` / `fix:` / `docs:` / `refactor:` prefixes)

   ```bash
   git commit -m "feat: add share QR code"
   ```

8. **Push and open a PR**

   ```bash
   git push -u origin <your-branch>
   ```

   Open a Pull Request against `main`, and link the issue in the body with `Closes #<issue-number>`.

9. **Request merge** — once CI and review pass, merge (squash recommended) and delete the branch.

> CI auto-runs test / build / deploy on push to `main`; see [AGENTS.md](AGENTS.md#cicd).
