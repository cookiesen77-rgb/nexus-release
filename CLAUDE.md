# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**漫剧 (Manga Drama)** - An AI-powered visual storytelling workspace for creating cinematic content through automated workflows. Users create text-to-image, image-to-video, and storyboard workflows through a visual node-based canvas.

This is a monorepo containing:
- **nexus/** - Main React + TypeScript application (see nexus/CLAUDE.md for detailed development guide)
- **api/** - NexusAPI integration documentation and specifications
- **prompt以及知识学习/** - Prompt engineering resources and learning materials
- **矢量图标/** - Vector graphic assets
- **参考项目/** - Reference implementations
- **nexus-releases/** - Desktop app releases

## Quick Start

```bash
cd nexus
npm install
npm run dev             # Web dev server at localhost:5173/nexus
npm run dev:tauri       # Desktop dev (requires Rust toolchain)
npm run build           # Production web build
npm run build:tauri     # Package Tauri desktop app
npx tsc --noEmit        # Type check without emitting
```

## Project Structure

### nexus/ - Main Application
React 18 + TypeScript + Vite + Tailwind CSS with custom WebGL-based graph canvas. Users create and execute AI workflows (text-to-image, image-to-video, storyboarding) through a node-based interface.

**Deployment modes**:
- Web: `base: '/nexus'` with BrowserRouter
- Desktop (Tauri): `base: './'` with HashRouter (configured in vite.config.js)

**Migration status**: This project was migrated from Vue 3 to React. Legacy `.vue` files and `/stores/*.js` remain in the codebase but are inactive. Active codebase uses:
- `/routes/*.tsx` - React route components
- `/graph/store.ts` - Zustand graph state
- `/store/*.ts` - Zustand stores (projects, settings)
- `/components/canvas/*.tsx` - React canvas components
- `/lib/` - TypeScript utilities and workflow logic

**See nexus/CLAUDE.md for complete architecture details, state management patterns, and component structure.**

### api/ - API Documentation
Contains NexusAPI integration specs:
- **NEXUSAPI.md** - Quick start and authentication guide
- **NEXUSAPI_REFERENCE.md** - Detailed API reference with troubleshooting
- **NEXUSAPI_MODEL_ROUTING.md** - Model routing table and endpoint mappings

Key points:
- Base URL: `https://nexusapi.cn/v1` (proxied in vite.config.js)
- Auth: `Authorization: Bearer <API_KEY>` (OpenAI-compatible) or `?key=` (Gemini native)
- Models span multiple providers: GPT, Gemini, Kling, Doubao, Jimeng, Veo, Sora, MiniMax, Luma, Runway

## AI Workflow Pipeline

The core use case is automated visual storytelling:

1. **Script Generation** (GPT/Gemini) - User prompt → structured storyboard JSON with character definitions and scene breakdowns
2. **Image Generation** - Multi-model support with reference image linking for character consistency across scenes
3. **Video Generation** - Image-to-video pipeline with cinematic camera work, supporting first/last frame control
4. **Export** - Combined output for editing

**Workflow types**:
- `text_to_image` - Basic text-to-image generation (default)
- `text_to_image_to_video` - Text → image → video pipeline (triggered by "视频", "动画" keywords)
- `storyboard` - Multi-scene generation with character consistency (triggered by "分镜", "场景", "镜头" keywords)

Workflows are orchestrated by `nexus/src/lib/workflow/*.ts` modules:
- **Serial execution**: Nodes execute sequentially, waiting for dependencies via polling
- **Retry logic**: Exponential backoff for transient failures
- **Context-aware**: Graph topology analyzed via BFS for prompt enrichment (see `nexus/src/lib/contextEngine.ts`)
- **Reference linking**: Image nodes can be linked as "imageRole" edges for character consistency

## Development Guidelines

When working across this codebase:

1. **Nexus app changes**: Always read `nexus/CLAUDE.md` first for architecture patterns, especially:
   - State management with Zustand (`/graph/store.ts`, `/store/*.ts`)
   - Custom WebGL rendering engine (`WebGLGraphCanvas.tsx`)
   - Node/edge type system and workflow orchestration
   - Dual storage strategy (localStorage + IndexedDB + Tauri)

2. **API integration**: Check `api/NEXUSAPI_REFERENCE.md` for model-specific requirements
   - Different models use different endpoints (`/images/generations`, `/video/create`, `/kling/v1/*`)
   - Auth varies: Bearer token (OpenAI-compatible) vs query param (Gemini native)
   - Polling patterns for async operations (video/audio generation)

3. **New models**: Update BOTH locations:
   - `nexus/src/config/models.d.ts` - Frontend model configuration
   - `api/NEXUSAPI_MODEL_ROUTING.md` - API routing documentation

4. **Workflow changes**:
   - Modify `nexus/src/lib/workflow/*.ts` for orchestration logic
   - Test end-to-end execution with actual API calls
   - Verify context engine correctly analyzes graph topology

5. **Legacy Vue files**: **Do not modify** `.vue` files or `/stores/*.js` - they are inactive remnants from the Vue 3 architecture. Use React components and Zustand stores instead.

6. **Desktop features**: Use `isTauri()` checks before importing Tauri APIs to avoid web build errors. Tauri commands are defined in `nexus/src-tauri/src/main.rs`.

## Common Tasks

### Adding a New AI Model

1. Add model config to `nexus/src/config/models.d.ts`:
   ```typescript
   {
     value: 'new-model-id',           // Model identifier used in API calls
     label: 'Display Name',           // User-visible name
     type: 'chat' | 'image' | 'video' | 'audio',
     provider: 'openai' | 'gemini' | 'kling' | 'doubao' | etc
   }
   ```

2. Update API adapter in `nexus/src/lib/nexusApi.ts` if new provider requires custom request format:
   - Check endpoint path (e.g., `/images/generations`, `/video/create`, `/kling/v1/*`)
   - Handle authentication (Bearer vs query param)
   - Implement polling if async task-based

3. Document routing in `api/NEXUSAPI_MODEL_ROUTING.md`:
   - Endpoint URL
   - Request body format
   - Response structure
   - Polling endpoint (if applicable)

### Modifying Workflow Logic

Key files: `nexus/src/lib/workflow/*.ts`

**Architecture**:
- `image.ts` - Image generation orchestration
- `video.ts` - Video generation orchestration
- `request.ts` - HTTP client with retry logic
- `polish.ts` - AI-powered prompt enhancement
- `contextEngine.ts` - Graph context analysis using BFS

**Patterns**:
- Use polling with exponential backoff for async task completion
- Serial execution ensures dependencies complete before next steps
- Extract context from connected nodes for prompt enrichment
- Update node state (`status`, `output`, `errorMessage`) via Zustand actions

### Working with the Custom Canvas

The canvas uses a **custom WebGL renderer** (not React Flow or third-party libraries):
- `WebGLGraphCanvas.tsx` - WebGL rendering for edges and grid
- `NodeCardsLayer.tsx` - DOM overlay for node cards (better interactivity)
- `EdgeOverlayLayer.tsx` - Interactive edge hit detection
- Graph state managed via `graph/store.ts` (Zustand)

**Performance notes**:
- WebGL handles thousands of edges efficiently
- Nodes render as DOM for accessibility and interaction
- Viewport transforms applied to both layers
- Auto-save with 500ms debounce

### Desktop Packaging (Tauri)

**Prerequisites**:
- Rust toolchain (rustup)
- Platform-specific build tools (Xcode Command Line Tools for macOS, Visual Studio for Windows)

**Build commands**:
```bash
cd nexus
npm run dev:tauri              # Development with hot reload
npm run build:tauri            # Production package (dmg/exe/AppImage)
```

**Tauri-specific code**:
- Main process: `src-tauri/src/main.rs`
- Custom commands: `save_project_canvas`, `load_project_canvas`, `delete_project_canvas`, `cache_image`, `log_frontend`
- Tauri uses HashRouter and relative paths (`base: './'`)
- Check `isTauri()` before importing `@tauri-apps/api` to avoid web build errors

## Tech Stack Summary

- **Frontend**: React 18 + TypeScript, Vite 5.2, React Router v6
- **UI**: Tailwind CSS, Lucide React icons, custom UI components
- **Canvas**: Custom WebGL-based rendering engine (not third-party graph libraries)
- **State**: Zustand with localStorage persistence + Tauri native file I/O
- **Desktop**: Tauri 2.0 (Rust-based, cross-platform)
- **API**: OpenAI-compatible + Gemini native endpoints via NexusAPI proxy
- **Build tools**: SWC for fast compilation, PostCSS + Autoprefixer

**Key dependencies**:
- `@xyflow/react` - Used for some utilities but canvas is custom WebGL
- `axios` - HTTP client (wrapped with retry logic)
- `zustand` - Lightweight state management
- `pdf-lib`, `mammoth` - Document processing
- `@tauri-apps/*` - Desktop integration plugins

## Persistence Strategy

All state persists client-side - no backend required.

**Data storage layers**:

1. **Project metadata** → localStorage (`"ai-canvas-projects-meta"`)
   - Project list with id, name, description, thumbnail, timestamps
   - CRUD operations via `nexus/src/store/projects.ts` (Zustand)

2. **Canvas data** → localStorage or Tauri file system
   - Key format: `nexus-canvas-v1:${projectId}`
   - Contains: nodes, edges, viewport state, undo/redo history
   - Auto-save with 500ms debounce
   - History compressed with LZ4 for older entries (max 50 snapshots)
   - Desktop uses Tauri commands: `save_project_canvas`, `load_project_canvas`

3. **Media storage** → IndexedDB (`nexus/src/lib/mediaStorage.ts`)
   - Binary blobs (images, videos, audio) stored separately
   - Prevents localStorage quota issues with large files
   - Automatic cleanup when projects are deleted

4. **Settings** → localStorage (`nexus/src/store/settings.ts`)
   - API key, base URL, theme, AI assistant model preference
   - Persists across sessions

## Additional Resources

- **Apifox API docs**: https://20474j2h5s.apifox.cn/
- **Prompt engineering guides**: See `prompt以及知识学习/` directory
- **Vector assets**: See `矢量图标/` for app icons in multiple sizes
- **Reference projects**: See `参考项目/` for implementation examples

## Debugging

**Development logs**:
- Vite dev server logs: `.vite-dev.log` in nexus directory
- Frontend errors logged to Tauri backend via `log_frontend` command (desktop mode)
- Check browser console for state updates and API responses

**Common issues**:
- **CORS errors**: API proxy configured in `vite.config.js`, but some endpoints may require Tauri fallback
- **Type errors**: Run `npx tsc --noEmit` to check without building
- **State not persisting**: Check localStorage quota, verify Zustand subscriptions
- **Tauri commands failing**: Ensure Rust backend is compiled and running in dev mode
- **Canvas not rendering**: Check WebGL support, inspect viewport transform state