# Nexus 产品规范文档

> 版本: v0.0.57 | 更新日期: 2026-01-30

## 1. 产品概述

### 1.1 产品定位

Nexus 是一款基于 React Flow 的可视化 AI 创作画布应用，支持文生图、视频生成等 AI 工作流的节点式编排。产品提供 Web 版和桌面端（Tauri），默认对接 NexusAPI（`https://nexusapi.cn/v1`）。

### 1.2 目标用户

- AI 创作者和设计师
- 内容创作者（视频、漫画、插画）
- 需要批量生成 AI 内容的用户
- 工作流自动化需求者

### 1.3 核心价值

- **可视化编排**: 节点式画布，直观展示 AI 工作流
- **多模态支持**: 文本、图片、视频全流程支持
- **跨平台**: Web + 桌面端（Windows/macOS）
- **自动更新**: Tauri 内置自动更新机制

---

## 2. 技术架构

### 2.1 技术栈

| 层级 | 技术 | 版本 |
|------|------|------|
| 前端框架 | React | 18.x |
| 构建工具 | Vite | 5.x |
| 桌面端 | Tauri | 2.x |
| 画布引擎 | React Flow (@xyflow/react) | 12.x |
| 样式 | Tailwind CSS | 3.x |
| 状态管理 | Zustand | 4.x |
| HTTP 客户端 | Axios + Fetch | - |
| 路由 | React Router | 6.x |

### 2.2 项目结构

```
nexus/
├── src/                      # 前端源码
│   ├── api/                  # API 请求封装
│   │   ├── chat.js           # 聊天 API
│   │   ├── image.js          # 图片生成 API
│   │   └── video.js          # 视频生成 API
│   ├── components/           # 组件
│   │   ├── canvas/           # 画布组件
│   │   ├── nodes/            # 节点组件
│   │   └── edges/            # 边组件
│   ├── config/               # 配置
│   │   └── models.js         # 模型配置
│   ├── graph/                # 画布状态管理
│   ├── hooks/                # 自定义 Hooks
│   ├── lib/                  # 工具库
│   │   └── workflow/         # 工作流核心
│   │       ├── request.ts    # 统一请求封装
│   │       ├── video.ts      # 视频生成逻辑
│   │       ├── image.ts      # 图片生成逻辑
│   │       └── cache.ts      # 缓存管理
│   ├── store/                # Zustand 状态
│   └── views/                # 页面视图
├── src-tauri/                # Tauri 后端
│   ├── src/                  # Rust 源码
│   ├── icons/                # 应用图标
│   └── tauri.conf.json       # Tauri 配置
├── .github/workflows/        # CI/CD
│   └── release.yml           # 发布工作流
└── package.json
```

### 2.3 仓库说明

| 仓库 | 地址 | 用途 |
|------|------|------|
| 源码仓库 | `cookiesen77-rgb/nexus-source` | 源代码、开发 |
| 发布仓库 | `cookiesen77-rgb/nexus-releases` | 安装包、更新 |

---

## 3. 平台适配

### 3.1 支持平台

| 平台 | 架构 | 安装包格式 | 状态 |
|------|------|-----------|------|
| macOS (Apple Silicon) | aarch64 | `.dmg` | ✅ 支持 |
| macOS (Intel) | x86_64 | `.dmg` | ✅ 支持 |
| Windows | x86_64 | `.exe` / `.msi` | ✅ 支持 |
| Web | - | 浏览器访问 | ✅ 支持 |

### 3.2 Tauri 配置

**文件**: `src-tauri/tauri.conf.json`

```json
{
  "productName": "Nexus",
  "version": "0.0.57",
  "identifier": "com.nexus.nexus",
  "build": {
    "frontendDist": "../dist",
    "devUrl": "http://localhost:5173",
    "beforeDevCommand": "npm run dev -- --mode tauri",
    "beforeBuildCommand": "npm run build -- --mode tauri"
  },
  "app": {
    "windows": [{
      "title": "Nexus",
      "width": 1280,
      "height": 800,
      "minWidth": 1024,
      "minHeight": 640
    }]
  },
  "bundle": {
    "active": true,
    "targets": "all",
    "icon": [
      "icons/32x32.png",
      "icons/128x128.png",
      "icons/icon.icns",
      "icons/icon.ico"
    ]
  }
}
```

### 3.3 Tauri 插件

| 插件 | 版本 | 用途 |
|------|------|------|
| `@tauri-apps/plugin-http` | 2.5.6 | HTTP 请求（绕过 CORS） |
| `@tauri-apps/plugin-fs` | 2.4.5 | 文件系统操作 |
| `@tauri-apps/plugin-dialog` | 2.6.0 | 系统对话框 |
| `@tauri-apps/plugin-updater` | 2.9.0 | 自动更新 |
| `@tauri-apps/plugin-opener` | 2.5.3 | 打开外部链接 |
| `@tauri-apps/plugin-process` | 2.3.1 | 进程管理 |

### 3.4 平台差异处理

#### 3.4.1 环境检测

```typescript
// src/lib/tauri.ts
export const isTauri = () => {
  return typeof window !== 'undefined' && '__TAURI__' in window
}
```

#### 3.4.2 HTTP 请求差异

| 环境 | 请求方式 | CORS 处理 |
|------|---------|----------|
| Web | `fetch` / `axios` | 需要代理 |
| Tauri | `@tauri-apps/plugin-http` | 原生绕过 |

```typescript
// src/lib/workflow/request.ts
const safeFetch = async (url, options) => {
  if (isTauri) {
    const { fetch } = await import('@tauri-apps/plugin-http')
    return fetch(url, options)
  }
  return window.fetch(url, options)
}
```

#### 3.4.3 文件下载差异

| 环境 | 下载方式 | 保存位置 |
|------|---------|---------|
| Web | Blob URL + `<a>` 标签 | 用户选择 |
| Tauri | `plugin-dialog` + `plugin-fs` | 系统对话框 |

#### 3.4.4 缓存策略

| 环境 | 缓存方式 | 位置 |
|------|---------|------|
| Web | IndexedDB | 浏览器 |
| Tauri | Rust 文件系统 | `$APPCACHE` |

---

## 4. 功能规范

### 4.1 节点类型

| 节点 | 类型标识 | 描述 |
|------|---------|------|
| 文本节点 | `text` | 输入/编辑提示词 |
| 文生图配置 | `imageConfig` | 图片生成参数配置 |
| 图片节点 | `image` | 展示生成/上传的图片 |
| 视频配置 | `videoConfig` | 视频生成参数配置 |
| 视频节点 | `video` | 展示生成的视频 |

### 4.2 支持模型

#### 4.2.1 图片模型

| 模型 | API 格式 | 支持功能 |
|------|---------|---------|
| FLUX 系列 | `openai` | 文生图 |
| SD 系列 | `openai` | 文生图 |
| GPT-4o-image | `gpt-4o` | 文生图、图生图 |
| Midjourney | `midjourney` | 文生图、图生图 |
| AIGC | `aigc` | 需图床上传 |

#### 4.2.2 视频模型

| 模型 | API 格式 | 支持功能 |
|------|---------|---------|
| Sora 2 | `sora-openai` | 文生视频、图生视频 |
| Kling | `kling` | 图生视频 |
| Runway | `runway` | 图生视频 |
| Luma | `luma` | 图生视频 |
| Veo 2 | `veo-unified` | 文生视频 |

### 4.3 模型开发规范（重要）

#### 4.3.1 Tauri 优先原则

**所有功能开发和修复都必须以 Tauri 桌面端为核心目标：**

1. **Tauri 是主要平台**
   - 所有新功能必须在 Tauri 环境下完整实现和测试
   - Web 版是次要支持平台，功能可以降级但不能崩溃
   - 任何代码修改都必须考虑 Tauri 环境的兼容性

2. **双平台适配（Windows + macOS）**
   - 所有功能必须同时支持 Windows 和 macOS
   - 构建必须包含：Windows x64、macOS Intel、macOS Apple Silicon
   - 文件路径、系统调用等必须使用跨平台兼容的写法

3. **Tauri 特有功能处理**
   - 网络请求：使用 `@tauri-apps/plugin-http` 绕过 CORS
   - 文件操作：使用 `@tauri-apps/plugin-fs` + `plugin-dialog`
   - 缓存存储：使用 `$APPCACHE` 目录
   - 自动更新：使用 `@tauri-apps/plugin-updater`

4. **环境检测规范**
   ```typescript
   import { isTauri } from '@/lib/tauri'
   
   if (isTauri()) {
     // Tauri 专用逻辑
   } else {
     // Web 降级逻辑
   }
   ```

5. **测试要求**
   - 本地修改必须在 Tauri 环境下测试通过（`npm run tauri build`）
   - 重大功能需在 Windows 和 macOS 上分别测试
   - GitHub Actions 构建必须三平台全部通过

#### 4.3.2 最小改动原则

**增加新模型时，必须遵循最小改动原则：**

1. **只修改 `src/config/models.js`**
   - 在对应的 `IMAGE_MODELS` 或 `VIDEO_MODELS` 数组中添加新模型配置
   - 不要修改其他模型的配置
   - 不要修改公共函数或工具类

2. **复用现有的 API 格式（format）**
   - 优先使用已有的 format：`openai`, `veo-unified`, `sora-openai`, `kling-video`, `tencent-video` 等
   - 只有当现有 format 完全无法满足时，才考虑新增 format

3. **新增 format 的规范**
   - 只在 `src/lib/workflow/video.ts` 或 `src/lib/workflow/image.ts` 中添加对应的 `if (modelCfg.format === 'new-format')` 分支
   - 不要修改其他 format 的处理逻辑
   - 不要修改公共的 URL 构建函数（如 `resolveEndpointUrl`）

4. **禁止的操作**
   - 不要修改 `src/lib/workflow/request.ts` 中的 URL 处理逻辑
   - 不要修改 `noV1Prefixes` 列表（除非有明确的技术需求和审批）
   - 不要修改其他模型的参数构建逻辑
   - 不要在公共工具类中添加模型特定的逻辑

#### 4.3.3 模型配置结构

```javascript
{
  label: '显示名称 ¥价格',        // UI 显示
  key: 'model-key',              // 模型标识（发送到 API）
  endpoint: '/video/create',     // API 端点（相对路径或绝对 URL）
  statusEndpoint: '/v1/video/query', // 轮询端点
  authMode: 'bearer',            // 认证方式：bearer | query
  format: 'veo-unified',         // API 格式（决定参数构建逻辑）
  maxImages: 2,                  // 最大图片数量
  ratios: ['16:9', '9:16'],      // 支持的宽高比
  durs: [{ label: '8 秒', key: 8 }], // 支持的时长
  defaultParams: { ... }         // 默认参数
}
```

#### 4.3.4 端点配置规则

| 端点类型 | 配置方式 | 示例 |
|---------|---------|------|
| 标准 /v1 路径 | 相对路径（不带 /v1） | `endpoint: '/video/create'` → `/v1/video/create` |
| 已包含 /v1 | 相对路径（带 /v1） | `endpoint: '/v1/videos'` → `/v1/videos` |
| 特殊前缀 | 使用 `toAbsoluteUrl()` | `endpoint: toAbsoluteUrl('/kling/v1/videos')` |
| 外部 API | 完整 URL | `endpoint: 'https://api.example.com/v1/...'` |

### 4.4 API 请求规范

#### 4.4.1 基础 URL

- **生产环境**: `https://nexusapi.cn/v1`
- **认证方式**: Bearer Token（API Key）

#### 4.4.2 请求重试策略

```typescript
// 可重试错误类型
const isRetryableError = (err) => {
  const msg = String(err?.message || err || '')
  return /Failed to fetch|NetworkError|socket|TLS|ECONNRESET|502|Bad Gateway|did not match|expected pattern/i.test(msg)
}

// 重试延迟（指数退避）
const getBackoffMs = (attempt) => {
  const base = 2000 * Math.pow(2, attempt) // 2s, 4s, 8s...
  const jitter = Math.floor(Math.random() * 1000)
  return Math.min(15000, base + jitter) // 最大 15s
}
```

#### 4.4.3 视频轮询规范

| 参数 | 值 | 说明 |
|------|-----|------|
| 轮询间隔 | 3s | 每 3 秒查询一次 |
| 最大次数 | 300 | 最多轮询 300 次（15 分钟） |
| 状态值 | `queued`, `in_progress`, `completed`, `failed` | 任务状态 |

---

## 5. 构建与发布

### 5.1 本地开发

```bash
# Web 开发
npm run dev

# Tauri 开发
npm run dev:tauri

# 本地构建 Tauri
npm run tauri build
```

### 5.2 版本管理

**版本号位置**:
- `package.json` → `version`
- `src-tauri/tauri.conf.json` → `version`

**版本号格式**: `MAJOR.MINOR.PATCH` (如 `0.0.57`)

### 5.3 发布流程

0. **门禁规则（必须）**
   - 每次新增功能/修复后：AI 助手需要先做一次严格自审（逐文件 diff + `npm run build` +（涉及 Tauri 时）`cargo check`）。
   - 自审完成后：先交付给你测试（提供最短测试清单与预期结果）。
   - 只有你明确回复“测试通过”后，才允许继续下面的发布步骤（版本号 / Tag / 构建 / Release / README）。

1. **（通过测试后）更新版本号**
   ```bash
   # 同步更新两个文件
   sed -i '' 's/"version": "0.0.X"/"version": "0.0.Y"/g' package.json src-tauri/tauri.conf.json
   ```

2. **（通过测试后）提交代码**
   ```bash
   git add .
   git commit -m "chore: bump version to 0.0.Y"
   git push origin main
   ```

3. **（通过测试后）创建 Tag 触发构建**
   ```bash
   git tag -a v0.0.Y -m "Release v0.0.Y"
   git push origin v0.0.Y
   ```

4. **GitHub Actions 自动执行（CI）**
   - 构建 macOS Intel (`x86_64-apple-darwin`)
   - 构建 macOS ARM (`aarch64-apple-darwin`)
   - 构建 Windows (`windows-latest`)
   - 上传 artifacts 到 `nexus-releases`
   - 生成 `latest.json` 用于自动更新

### 5.4 自动更新

**更新检查端点**:
```
https://github.com/cookiesen77-rgb/nexus-releases/releases/latest/download/latest.json
```

**latest.json 格式**:
```json
{
  "version": "0.0.57",
  "notes": "Nexus v0.0.57",
  "pub_date": "2026-01-30T07:00:00Z",
  "platforms": {
    "darwin-x86_64": {
      "url": "https://github.com/cookiesen77-rgb/nexus-releases/releases/download/v0.0.57/Nexus_0.0.57_x64.dmg"
    },
    "darwin-aarch64": {
      "url": "https://github.com/cookiesen77-rgb/nexus-releases/releases/download/v0.0.57/Nexus_0.0.57_aarch64.dmg"
    },
    "windows-x86_64": {
      "url": "https://github.com/cookiesen77-rgb/nexus-releases/releases/download/v0.0.57/Nexus_0.0.57_x64-setup.exe"
    }
  }
}
```

---

## 6. 质量保证

### 6.1 错误处理

| 场景 | 处理方式 |
|------|---------|
| 网络超时 | 自动重试（最多 3 次） |
| 502/503 错误 | 指数退避重试 |
| JSON 解析失败 | Tauri 环境自动重试 |
| API 认证失败 | 提示用户检查 API Key |
| 任务超时 | 15 分钟后提示失败 |

### 6.2 日志规范

```typescript
// 成功日志
console.log('[模块名] 操作成功:', { 关键信息 })

// 警告日志
console.warn('[模块名] 警告信息:', { 详情 })

// 错误日志
console.error('[模块名] 错误信息:', error)
```

### 6.3 Tauri 命令日志

```typescript
// src/lib/tauri.ts
export const tauriInvoke = async (command, payload) => {
  try {
    return await invoke(command, payload)
  } catch (err) {
    console.error(`[tauriInvoke] 命令 '${command}' 执行失败:`, err)
    throw err
  }
}
```

---

## 7. 安全规范

### 7.1 API Key 存储

| 环境 | 存储位置 | 安全性 |
|------|---------|--------|
| Web | localStorage | 中等 |
| Tauri | 应用数据目录 | 较高 |

### 7.2 CSP 配置

Tauri 默认禁用 CSP 以支持动态内容加载：
```json
{
  "app": {
    "security": {
      "csp": null
    }
  }
}
```

### 7.3 资产协议

仅允许访问应用缓存目录：
```json
{
  "assetProtocol": {
    "enable": true,
    "scope": ["$APPCACHE/**"]
  }
}
```

---

## 8. 变更日志

### v0.0.57 (2026-01-30)

- 修复 502 Bad Gateway 和 JSON 解析错误重试逻辑
- 修复 Axios baseURL 拼接问题
- 修复 Tauri updater 端点配置
- 增强 tauriInvoke 错误日志
- 优化网络错误重试策略

### v0.0.56 (2026-01-29)

- 修复全局 /v1 路径重复问题
- 优化 Tauri 环境请求处理

### v0.0.55 (2026-01-28)

- 修复 Sora 2 视频生成和下载
- 优化 Web 环境视频下载
- 修复 Windows 图片下载问题

---

## 附录

### A. 相关文档

- [TAURI_SETUP.md](./TAURI_SETUP.md) - Tauri 环境搭建
- [NEXUSAPI_SETUP.md](./NEXUSAPI_SETUP.md) - API 配置说明
- [CLAUDE.md](./CLAUDE.md) - AI 助手规范

### B. 相关链接

- API 文档: https://help.allapi.store/
- Tauri 官方: https://tauri.app/
- React Flow: https://reactflow.dev/

---

*文档维护: Nexus Team*
