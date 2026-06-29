# Binwak

[简体中文](#简体中文) | [English](#english)

---

## 简体中文

**微信小程序版「城市漫步 Bingo 打卡」**——把一张 Bingo 卡变成可拍照打卡、可分享、可导出成拍立得风格图片的小程序。基于 uni-app (Vue 3) + Express / SQLite。

### 创作背景

某天想尝试 NiceTry Bingo，却发现很难找到能用的原图。去[豆瓣](https://www.douban.com/group/topic/292968041/)一看，发现不少小伙伴也在到处求原图。后来虽然找到了[原始网站](https://bingo.moonwillknow.dev)，但要打印出来玩还是不太方便。于是干脆 vibe code 做了这个小程序：直接在手机上配置网格、拍照打卡、生成卡片，省去找图和打印的麻烦。

### 功能一览

- 可配置 Bingo 网格（3×3 ~ 6×6），每格拍照打卡
- 多 Board 管理 — 创建、切换、克隆、收藏
- 模板广场 — 发布、浏览、使用社区模板
- 分享码 — 快速导入/导出 Board
- 卡片导出为拍立得风格图片
- 词库管理（支持插图）

### 灵感来自

- [bingo.moonwillknow.dev](https://bingo.moonwillknow.dev)
- [nicetrypod.com/2024/bingo2nd](https://nicetrypod.com/2024/bingo2nd)

### 开发文档

想跑起来或参与开发？仓库地图、技术栈、目录结构、命令与本地开发流程都在 **[AGENTS.md](AGENTS.md)** 里。

### License

MIT

---

## English

**A WeChat Mini Program for "city walk" Bingo-style photo check-ins** — turn a Bingo card into something you can fill in with photos, share, and export as Polaroid-style images. Built with uni-app (Vue 3) and an Express / SQLite backend.

### Why this exists

I wanted to try NiceTry Bingo one day, but couldn't find a usable original image. Over on [Douban](https://www.douban.com/group/topic/292968041/), plenty of others were hunting for the same thing. I eventually found the [original site](https://bingo.moonwillknow.dev), but printing it out to play was still a hassle. So I vibe-coded this Mini Program: configure the grid, check in with photos, and generate a card — right on your phone, no image-hunting or printing required.

### Features

- Configurable Bingo grids (3×3 ~ 6×6) with per-cell photo check-in
- Multi-board management — create, switch, clone, favorite
- Template plaza — publish, browse, use community templates
- Share codes — quick import/export of a Board
- Export cards as Polaroid-style images
- Word bank with illustration support

### Inspired by

- [bingo.moonwillknow.dev](https://bingo.moonwillknow.dev)
- [nicetrypod.com/2024/bingo2nd](https://nicetrypod.com/2024/bingo2nd)

### Developer docs

Want to run it or contribute? The repo map, tech stack, directory layout, commands, and local dev workflow all live in **[AGENTS.md](AGENTS.md)**.

### License

MIT
