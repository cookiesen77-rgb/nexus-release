# Nexus 项目集成摘要（NexusAPI）

本项目已将网关统一为 `https://nexusapi.cn`，并在前端按不同模型路由到对应后缀（详见 `api/NEXUSAPI_MODEL_ROUTING.md`）。

## 关键约束

- **Base URL 固定不可改**：`https://nexusapi.cn/v1`（UI 只允许填写 `API Key`）
- **Gemini v1beta**：使用 `?key=`（不使用 `Authorization`）
- **Kling 平台**：走 `https://nexusapi.cn/kling/v1/...`（Bearer）

## 已接入模型（以代码为准）

- **AI 助手（Responses）**：`gpt-5-mini`（`POST /v1/responses`）
- **生图（Images）**
  - OpenAI Images：`gpt-image-1.5-all`、`flux-pro-1.1-ultra`
  - Seedream：`doubao-seedream-4-5-251128`
  - Gemini 生图（UI 展示名：`nano-banana-pro`）：`gemini-3-pro-image-preview`
  - Chat 生图：`qwen-image-max`、`grok-4-image`
  - Kling 生图：`kling-image`（固定 `model_name=kling-v2-1`）
  - Tencent-VOD 生图：`aigc-image-gem`、`aigc-image-qwen`
- **视频（Videos）**
  - OpenAI 视频格式：`veo_3_1-fast`（`POST /v1/videos` + `GET /v1/videos/{id}`）
  - 统一视频格式：`veo3.1-4k`、`veo3.1-pro-4k`、`sora-2-all`（`POST /v1/video/create` + `GET /v1/video/query?id=...`）
  - Kling 视频：`kling-video`（文生/图生两个端点，固定 `kling-v2-6 · pro · 10s · sound=off`）
  - Tencent-VOD 视频：`aigc-video-vidu`、`aigc-video-hailuo`（当前仅支持直接返回 `video_url`）

## 提示词库

- 视频运镜：`CHOS 运镜 Prompt 词库`（可搜索/插入）
- 生图提示词：`awesome-nano-banana-pro-prompts`（GitHub README 解析，支持搜索/插入）

## 持久化

- 项目列表元数据：优先 `localStorage`，失败则落到 `IndexedDB`
- 画布大数据（nodes/edges/viewport）：`IndexedDB`（避免 localStorage 超额）

## 启动

```bash
cd nexus
npm run dev
```
