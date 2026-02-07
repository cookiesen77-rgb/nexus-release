# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Nexus 是一款基于 React + TypeScript 的可视化节点画布，用于搭建 AI 工作流。用户可以在无限画布上通过节点编排构建文生图、图生视频等自动化流程，采用自研 WebGL 渲染引擎实现高性能交互。

**Tech Stack**: React 18 + TypeScript + Vite + Zustand + Tailwind CSS + Tauri

## Development Commands

```bash
npm install              # Install dependencies
npm run dev             # Start dev server at localhost:5173/nexus
npm run build           # Production build
npm run preview         # Preview production build

# Desktop builds (Tauri-based)
npm run dev:tauri       # Start Tauri app (requires Rust toolchain)
npm run build:tauri     # Package Tauri app
```

**Deployment modes** (configured in vite.config.js):
- Web: `base: '/nexus'` with BrowserRouter
- Desktop (Tauri): `base: './'` with HashRouter

## Architecture

### Migration Status

**This project has been migrated from Vue 3 to React + TypeScript.** Legacy Vue files remain in the codebase but are no longer used:
- `.vue` components in `/components/` - Legacy, inactive
- `/stores/*.js` - Old Vue reactive stores, replaced by Zustand
- `/router/` - Old Vue Router config, replaced by React Router
- `/hooks/*.js` - Some Vue composition hooks, partially migrated

**Active codebase** uses:
- `/routes/*.tsx` - React route components
- `/graph/store.ts` - Zustand graph state
- `/store/*.ts` - Zustand stores (projects, settings)
- `/components/canvas/*.tsx` - React canvas components
- `/lib/` - TypeScript utilities and workflow logic

### State Management Pattern

This project uses **Zustand** for state management:

**Key stores**:
- `src/graph/store.ts` - Nodes, edges, viewport, undo/redo with auto-save
- `src/store/projects.ts` - Project CRUD (name, description, thumbnail) with localStorage + Tauri persistence
- `src/store/settings.ts` - App settings (theme, API config)

**State patterns**:
- Graph state auto-saves to localStorage with debouncing
- Undo/redo via immutable state snapshots (max 50 history entries)
- LZ4 compression for old history entries to reduce memory
- Tauri commands used for desktop file I/O when available

### Custom WebGL Graph Engine

The canvas uses a **custom WebGL-based rendering system** (not third-party libraries):

**Core components**:
- `WebGLGraphCanvas.tsx` - WebGL renderer for edges and grid
- `NodeCardsLayer.tsx` - DOM-based node rendering overlay
- `EdgeOverlayLayer.tsx` - Interactive edge hit detection
- `graph/store.ts` - Graph state with node/edge management
- `graph/types.ts` - Core types (GraphNode, GraphEdge, Viewport)
- `graph/nodeSizing.ts` - Dynamic node dimension calculation

**Node types**:
- `text` - Text/prompt input
- `imageConfig` - Image generation configuration
- `image` - Image display/upload
- `videoConfig` - Video generation configuration
- `video` - Video playback
- `audio` - Audio playback (Suno)

**Edge types**:
- `default` - Standard connection
- `imageRole` - Reference image for character consistency
- `promptOrder` - Ordered prompt composition
- `imageOrder` - Sequential image composition

### Workflow System

AI-driven workflow automation via `lib/workflow/`:

**Execution flow**:
1. User provides text prompt in Canvas
2. Assistant analyzes intent and suggests workflow
3. Nodes/edges created automatically in graph
4. Nodes execute sequentially via polling pattern
5. Results displayed in output nodes

**Key workflow files**:
- `lib/workflow/image.ts` - Image generation orchestration
- `lib/workflow/video.ts` - Video generation orchestration
- `lib/workflow/request.ts` - HTTP client with retry logic
- `lib/polish.ts` - AI-powered prompt enhancement
- `lib/contextEngine.ts` - Graph context analysis for AI

**Workflow strategies**:
- Serial execution: Nodes wait for dependencies via polling
- Retry with exponential backoff for transient failures
- Context-aware prompt optimization using BFS graph traversal
- Reference image linking for character consistency

### API Layer Architecture

Three-tier API integration:

1. **HTTP client** (`lib/workflow/request.ts`)
   - Fetch API wrapper with auth injection
   - Automatic retry with exponential backoff
   - Tauri invoke fallback for CORS workarounds

2. **Service adapters** (`lib/nexusApi.ts`)
   - Model-agnostic interface for chat, image, video
   - Multi-provider support (OpenAI, Gemini, Kling, etc.)
   - Status polling for async tasks

3. **Workflow orchestration** (`lib/workflow/*.ts`)
   - Higher-level workflow logic
   - Node state management integration
   - Error handling and user notifications

**API configuration**:
- Base URL proxied in `vite.config.js`: `/v1/*` → `https://nexusapi.cn`
- Supports OpenAI-compatible endpoints
- API key stored in localStorage
- Models defined in `src/config/models.d.ts`

### Project Persistence

**Dual storage strategy**:

1. **Project metadata** → localStorage under `"ai-canvas-projects-meta"`
   ```typescript
   {
     id: string,
     name: string,
     description?: string,  // Optional project description
     thumbnail?: string,
     createdAt: number,
     updatedAt: number
   }
   ```

2. **Canvas data** → localStorage (`nexus-canvas-v1:${projectId}`) or Tauri commands
   - Nodes, edges, viewport state
   - Auto-save on every change (debounced 500ms)
   - History compressed with LZ4 for older entries

3. **Media storage** → IndexedDB via `lib/mediaStorage.ts`
   - Binary blobs (images, videos, audio) stored separately from graph state
   - Project removal automatically cleans up associated media
   - Prevents localStorage quota issues with large files

4. **Tauri desktop** → Native file system via `save_project_canvas`/`load_project_canvas` commands

No backend required - all data persists client-side.

### Routing System

**React Router v6** with conditional router type:

```typescript
const Router = isDesktop ? HashRouter : BrowserRouter
```

**Routes** (see `App.tsx`):
- `/` - Home (project gallery)
- `/canvas/:id?` - Graph canvas editor
- `/assistant` - AI assistant interface

**Navigation patterns**:
- Project creation passes `initialPrompt` via location state
- Canvas auto-creates nodes on mount from state

## Key Patterns

- **Custom WebGL rendering**: Edges/grid rendered in WebGL, nodes as DOM overlay for interactivity
- **Zustand subscriptions**: Graph store triggers localStorage saves on mutations
- **Undo/redo snapshots**: Immutable state cloning with LZ4 compression for old entries
- **Polling pattern**: Video/audio APIs use exponential backoff polling for async completion
- **Context-aware AI**: Graph topology analyzed via BFS for prompt enrichment
- **Tauri integration**: Conditional imports check `isTauri()` for desktop features
- **No TypeScript in legacy**: Vue files use plain JS, React migration uses full TS
- **Error boundaries**: Global error handlers log to Tauri backend via `log_frontend` command

## Configuration

First-time setup requires API configuration:
1. Click Settings icon in canvas
2. Enter API Key (base URL uses vite.config.js proxy)
3. Models auto-populate from `config/models.d.ts`

API credentials persist in localStorage across sessions.

## Desktop Packaging

**Tauri** (Rust-based, see `src-tauri/`):
- Main process: `src-tauri/src/main.rs`
- Custom commands: `save_project_canvas`, `load_project_canvas`, `delete_project_canvas`, `cache_image`, `log_frontend`
- Output: `src-tauri/target/release/`
- Requires Rust toolchain + platform SDKs
- Hash routing and relative paths (`base: './'`) in desktop mode

Legacy Electron references in `package.json` may not be actively maintained.

## Component Structure

```
src/
├── routes/              # Main pages (Home.tsx, Canvas.tsx, Assistant.tsx)
├── graph/               # Graph engine
│   ├── store.ts         # Zustand graph state (nodes, edges, undo/redo)
│   ├── types.ts         # Core type definitions
│   └── nodeSizing.ts    # Dynamic node sizing
├── store/               # Zustand stores
│   ├── projects.ts      # Project management
│   └── settings.ts      # App settings
├── components/
│   ├── canvas/          # Canvas UI (WebGL, overlays, sidebar, inspector)
│   ├── ui/              # Reusable UI components (button, input, select)
│   ├── *.vue            # Legacy Vue components (inactive)
│   ├── nodes/           # Legacy Vue node components (inactive)
│   └── edges/           # Legacy Vue edge components (inactive)
├── lib/                 # Business logic
│   ├── workflow/        # AI workflow orchestration
│   ├── polish.ts        # Prompt enhancement
│   ├── contextEngine.ts # Graph context analysis
│   ├── nexusApi.ts      # API adapters
│   ├── mediaStorage.ts  # IndexedDB media management
│   └── tauri.ts         # Tauri helpers
├── config/              # Model configurations
├── utils/               # Utility functions
└── stores/              # Legacy Vue stores (inactive, use /store/ instead)
```

## Development Tips

- **Prefer TypeScript**: New code should use `.ts`/`.tsx` with full type safety
- **Avoid legacy Vue**: Do not modify `.vue` files or `/stores/*.js` - use React components and Zustand stores
- **Graph mutations**: Always use Zustand actions from `graph/store.ts`, never mutate state directly
- **Canvas performance**: WebGL layer handles thousands of edges, DOM nodes lazy-render on viewport
- **Tauri conditionals**: Check `isTauri()` before importing Tauri APIs to avoid web build errors
- **Model additions**: Update `config/models.d.ts` AND `api/NEXUSAPI_MODEL_ROUTING.md` for new models
