# Repository Guidelines

## Project Structure & Module Organization
- `src/` now uses React + TypeScript as the primary entrypoint (`src/main.tsx`, `src/App.tsx`, `src/routes/*`).
- `src/components/canvas/` holds the WebGL canvas renderer and HTML overlay editor.
- Legacy Vue 3 code is still present under `src/views/`, `src/components/nodes/`, `src/hooks/`, `src/stores/` for incremental migration.
- `src/assets/` contains static assets and prompt libraries; `public/` contains public build assets.
- `electron/` and `src-tauri/` contain desktop shell code for Electron and Tauri builds.
- `doc/` contains screenshots used in documentation.

## Build, Test, and Development Commands
- `npm install` / `pnpm install`: install dependencies.
- `npm run dev` / `pnpm dev`: start the Vite dev server (Web 模式 `base: /nexus`).
- `npm run build`: build the web app.
- `npm run preview`: serve the production build locally.
- `npm run dev:electron` / `npm run build:electron`: run or package the Electron app (Electron 模式 `base: ./` + hash routing).
- `npm run dev:tauri` / `npm run build:tauri`: run or package the Tauri app (Tauri 模式 `base: ./` + hash routing).

## Coding Style & Naming Conventions
- Use TypeScript for new code (`.ts`/`.tsx`); prefer React function components + hooks.
- Use 2-space indentation and omit semicolons to match existing style where practical.
- Prefer clear, descriptive names for nodes, stores, and hooks (e.g., `useWorkflowOrchestrator`).
- There is no configured linter/formatter; keep diffs minimal and consistent.

## Architecture Notes (Do Not Break)
- Routing: Web uses history routing; Desktop (Electron/Tauri) uses hash routing (see `src/router/index.js`).
- API: Vite dev server proxies `/v1/*` to `https://nexusapi.cn` (see `vite.config.js`).
- Persistence: project metadata in localStorage; large canvas/assets in IndexedDB. Avoid breaking stored schemas and key names.
- Workflow logic and patterns are documented in `CLAUDE.md`; follow it when changing architecture/workflow behavior.
- Performance方向：优先将性能瓶颈的“核心能力”逐步 Rust 化（优先落在 Tauri Rust 侧：重计算/索引检索/媒体缓存/大对象处理等），并保持前端接口与持久化数据结构尽量稳定以便渐进迁移。
  - 逐步 Rust 化顺序（可验证、可回退）：
    1) 节点/边批量操作与索引（图算法：邻接索引、可视裁剪、命中检测辅助）
    2) undo/redo 历史压缩（大对象快照：压缩/差分/分段）
    3) 记忆检索 + 上下文拼装（长对话与大工程上下文：召回/去重/截断策略）
  - 画布性能目标：5000 节点尽量保持 60fps；允许远景 LOD（简化外观、不渲染完整卡片内容）。

## Testing Guidelines
- No automated test framework is configured yet.
- If you add tests, document the command and follow the file naming pattern of the chosen framework.

## Commit & Pull Request Guidelines
- Commit history is mixed (`feat: ...`, `update`, short Chinese/English). Use short, imperative messages; Conventional prefixes are welcome but not required.
- PRs should include: a concise description, linked issue (if applicable), steps to test, and screenshots for UI changes.

## Configuration & Setup Notes
- API setup is described in `NEXUSAPI_SETUP.md`; desktop builds in `ELECTRON_SETUP.md` and `TAURI_SETUP.md`.
- The app uses localStorage/IndexedDB for project data; avoid breaking persisted schemas.

## Agent-Specific Instructions
- 始终用中文回答我
- When changing architecture/workflow logic, follow repo-specific guidance in `CLAUDE.md`.
