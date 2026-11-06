# gitx — project context

## Goal

Build the world's most usable Git graphical management tool.

## Status

Base stack/style from dbx; product targets IDEA built-in Git UI. Development plan accepted 2026-11-06 Asia/Shanghai. **M0–M7** merged. **M8** Settings / Polish / Release: declarative Settings + Keymap, zh-CN default locale (en available), light/dark/system theme persistence, Welcome brand copy, concurrency/toast Busy hardening.

## Decisions

- **Base stack + style = dbx.** Project gitx adopts the dbx desktop app shell as its baseline tech stack and visual/interaction language (Vue 3, TypeScript, Tauri 2, Pinia, Tailwind v4, shadcn-vue/reka-ui, Lucide, token-driven light/dark UI, toolbar + sidebar + tabs + context menus / toasts / dialogs). See [base-stack-and-style.md](./base-stack-and-style.md).
- Domain-specific dbx pieces (database drivers, SQL editor product logic) are **not** adopted as gitx product scope—only the stack and UI patterns.
- **Product scope target = IntelliJ IDEA built-in Git UI.** gitx aims to replicate the IDEA Git tool experience (`git4idea` + shared VCS UI). Feature inventory: [idea-git-features.md](./idea-git-features.md).
- **Default locale = zh-CN** (English via Settings → Appearance). Git core terms stay English in zh-CN per glossary.
- **Theme:** light / dark / system, persisted; toolbar toggle + Settings.
- **Deferred (以后再说), 2026-11-06 Asia/Shanghai** — from the Chinese checklist in chat / Appendix A numbering:
  - **#11** Submodule 克隆/注册
  - **#125–136** GitHub 插件扩展体验（账号、Clone/Share、Gist、PR 工具窗、Review、Sync Fork 等）
  - **#137–141** 明确非核心/姊妹能力（GitLab MR、Features Trainer、Modal Commit、Deployment after commit、语言相关提交检查）
- **In scope for now:** checklist **#1–10** and **#12–124**.
- **Dev plan accepted, 2026-11-06 Asia/Shanghai.** See [dev-plan.md](./dev-plan.md). Confirmed:
  - Overlaps with deferred (#17 / #46 / #65 / #69 / #81): implement host-agnostic / generic parts only.
  - IDE-only concepts (#3 / #10 / #53 / #55 / #106): adapt as Welcome screen, `.gitx/settings.json`, lightweight FileViewer, etc.
  - Local-changes default: M1 ships **staging** mode first; switch default to IDEA **Changelist** mode after M6.

## Constraints

(none yet)
