# NexusAPI 模型路由表（可维护版）

> 目标：你后续只要在这张表里“增/删模型 + 改后缀/参数”，就能快速同步到代码（`src/config/models.js` + `src/hooks/useApi.js`）。
>
> NexusAPI 文档入口：`https://20474j2h5s.apifox.cn/`

---

## 0) 总原则

- **统一网关（Base URL，固定不可改）**：`https://nexusapi.cn/v1`
- **一模型一后缀**：所有请求都以 Base URL 为前缀，不同模型按各自后缀发起请求。
- **两种鉴权方式（务必区分）**
  - **Bearer（OpenAI 兼容接口）**：`Authorization: Bearer <API_KEY>`
  - **Query Key（Gemini v1beta 原生接口）**：`?key=<API_KEY>`（不要加 Authorization）

项目内实现位置：
- HTTP 封装：`src/utils/request.js`（`authMode: "bearer" | "query"`）
- 模型与端点：`src/config/models.js`
- 具体调用：`src/hooks/useApi.js`

---

## 1) 路由总表（按能力分组）

> 说明：
> - Base URL 固定为 `https://nexusapi.cn/v1`。
> - 下表里的「后缀」默认是 **相对 Base URL 的路径**（例如 `/responses` → `https://nexusapi.cn/v1/responses`）。
> - 少数模型需要走 **绝对路径**（例如 Gemini 的 `/v1beta/...`、Kling 的 `/kling/...`），这类请求不经过 `/v1`。

### 1.1 主 AI 助手（文本）

| 能力 | Model | 后缀 | 鉴权 | 备注 | 代码入口 |
|---|---|---|---|---|---|
| Chat/Text | `gpt-5-mini` | `/responses` | Bearer | Responses 格式（`input[]`），支持流式 | `src/hooks/useApi.js` |

### 1.2 生图（Images）

| 能力 | Model | 后缀 | 鉴权 | 请求要点（关键字段） | 代码入口 |
|---|---|---|---|---|---|
| Gemini 生图（展示名：nano-banana-pro） | `gemini-3-pro-image-preview` | `/v1beta/models/gemini-3-pro-image-preview:generateContent` | Query `?key=` | `generationConfig.responseModalities=["TEXT","IMAGE"]`；`imageConfig.aspectRatio`；`imageConfig.imageSize=1K/2K/4K`（默认 2K）；支持多参考图（需 DataURL/base64，外链可能跨域） | `src/hooks/useApi.js` |
| OpenAI Images | `gpt-image-1.5-all` | `/images/generations` | Bearer | `model,prompt,n,size`；`size` 按文档限制映射为 `1024x1024 / 1536x1024 / 1024x1536`（与 UI 画幅对应） | 同上 |
| OpenAI Images | `jimeng-4.5` | `/images/generations` | Bearer | Apifox 示例里 `size` 使用比例（如 `2:3`），其余字段同上 | 同上 |
| OpenAI Images | `flux-pro-1.1-ultra` | `/images/generations` | Bearer | OpenAI Images 兼容：`model,prompt,n,size`（返回 `data[].url` / `b64_json`） | 同上 |
| 豆包 Seedream | `doubao-seedream-4-5-251128` | `/images/generations` | Bearer | `model,prompt,size(1K/2K/4K)`；建议 `sequential_image_generation=disabled`；`response_format=url`；`watermark=false` | 同上 |
| OpenAI Chat 生图 | `qwen-image-max` | `/chat/completions` | Bearer | 以 Chat 方式请求；项目使用“提取 URL/DataURI”的方式兼容返回形态（建议让模型只输出图片 URL 或 dataURI） | 同上 |
| OpenAI Chat 生图 | `grok-4-image` | `/chat/completions` | Bearer | 以 Chat 方式请求；项目会深度提取返回里的 `url/image_url`；建议提示词里要求“只输出图片 URL 或 dataURI” | 同上 |
| OpenAI Images（编辑） | `qwen-image-edit-2509` | `/images/generations` | Bearer | **必须**提供 `image`（URL 或 DataURL）；项目只发送 `model,prompt,image`（避免字段不兼容） | 同上 |
| Kling 生图 | `kling-image` | `/kling/v1/images/generations` | Bearer | 必填：`model_name=kling-v2-1`、`prompt`、`n`；可选：`image`（参考图）、`resolution(1k/2k)`、`aspect_ratio`；若返回 `task_id` 需 `GET /kling/v1/images/generations/{id}` 查询 | 同上 |
| Tencent-VOD AIGC | `aigc-image-gem` | `/tencent-vod/v1/aigc-image` | Bearer | 版本号：`3.0`；清晰度默认 `2k`（字段按你给的规则发送，后续以实际文档/示例对齐） | 同上 |
| Tencent-VOD AIGC | `aigc-image-qwen` | `/tencent-vod/v1/aigc-image` | Bearer | 版本号：`0925`（字段同上） | 同上 |

### 1.3 视频（Videos）

| 能力 | Model | 后缀 | 鉴权 | 轮询/查询 | 代码入口 |
|---|---|---|---|---|---|
| OpenAI 视频格式 | `veo_3_1-fast` | `/videos` | Bearer | `GET /videos/{id}` | `src/hooks/useApi.js` |
| 统一视频格式 | `veo3.1-4k` | `/video/create` | Bearer | `GET /video/query?id=...` | 同上 |
| 统一视频格式 | `veo3.1-pro-4k` | `/video/create` | Bearer | 同上 | 同上 |
| 统一视频格式 | `sora-2-all` | `/video/create` | Bearer | 同上 | 同上 |
| 统一视频格式 | `jimeng-video-3.0` | `/video/create` | Bearer | 同上 | 同上 |
| Kling 视频 | `kling-video` | 文生：`/kling/v1/videos/text2video`；图生：`/kling/v1/videos/image2video` | Bearer | 文生查询：`GET /kling/v1/videos/text2video/{id}`；图生查询：`GET /kling/v1/videos/image2video/{id}` | 同上 |
| Tencent-VOD AIGC | `aigc-video-vidu` | `/tencent-vod/v1/aigc-video` | Bearer | 当前仅支持“接口直接返回 video_url”；若返回任务 ID 需补齐查询端点 | 同上 |
| Tencent-VOD AIGC | `aigc-video-hailuo` | `/tencent-vod/v1/aigc-video` | Bearer | 同上 | 同上 |

---

## 2) 增/删模型时怎么改（最稳的最小路径）

### 2.1 仅新增一个“同协议模型”（最简单）

1. `src/config/models.js`：把 model 加到对应数组（`IMAGE_MODELS` / `VIDEO_MODELS` / `CHAT_MODELS`）。
2. 不需要改 `src/hooks/useApi.js`（前提：它走的后缀/协议与现有模型一致）。

### 2.2 新增一个“新后缀/新协议模型”（最常见）

1. 先确认 4 件事：
   - 后缀（例如 `/responses` / `/images/generations` / `/v1beta/...` / 其它）
   - 鉴权（Bearer / `?key=`）
   - 请求体（JSON vs multipart）
   - 返回形态（同步返回 / 轮询：`id` + `video_url`）
2. `src/hooks/useApi.js`：在对应能力函数里加 model 分支/format（图片：`useImageGeneration()`；视频：`useVideoGeneration()`；文本：`sendGeminiChat()`）。
3. `api/NEXUSAPI_MODEL_ROUTING.md`：把新模型补进这张表（用于你后续维护）。

---

## 3) 项目约定（避免踩坑）

- **Gemini v1beta** 必须走 `?key=`，不要走 `Authorization`。
- **OpenAI Images** 的 `size` 在 GPT Image 系列上是枚举值（不要随意拼 2k/4k 尺寸）；项目已按画幅做映射。
- **即梦（jimeng）** 在 Apifox 示例里 `size` 是比例（如 `2:3`），不要用 `1024x1024` 这种像素尺寸。
- **编辑类生图**（如 `qwen-image-edit-2509`）必须有输入图，否则直接报错（项目已做前置校验）。
- **Sora 2（统一视频格式）** 请求体必须包含 `images/model/orientation/prompt/size/duration/watermark/private`，否则会报 `size is required for sora-2`（参考：`https://20474j2h5s.apifox.cn/api-403562579.md`）。
- **Gemini 生图参考图**：接口要求 `inline_data`（base64），外链图片可能因跨域无法读取；推荐用“上传图片”或使用已带 `base64` 的图片节点。
- **Kling（视频）**：文生/图生的查询路径不同，且 `sound` 在 v2.6+ 版本要求显式传 `on/off`（参考：`https://20474j2h5s.apifox.cn/api-403562618.md`、`https://20474j2h5s.apifox.cn/api-403562620.md`）。
