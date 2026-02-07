# NexusAPI 中转接口开发手册

> 目标：把 `https://nexusapi.cn` 当作统一网关，按模型路由到不同后缀；并让你后续**增/删模型、扩功能**时有一份“可操作”的参考。

本项目已完成 NexusAPI 接入与多模型路由（见 `api/NEXUSAPI.md`）。本文档更偏“开发维度”：鉴权、接口族、请求/响应形状、模型接入位置、扩展策略、排错清单。

---

## 0) 基本约定

- **Base URL（固定不可改）**：`https://nexusapi.cn/v1`（本项目已锁定，用户界面不允许修改）。
- **API Key**：仅需在设置里填写 Key，存储在浏览器 `localStorage`：
  - `apiKey`
- **路径拼接方式**：
  - OpenAI 兼容接口：走 `baseURL=https://nexusapi.cn/v1` + 相对路径（例如 `/images/generations` → `https://nexusapi.cn/v1/images/generations`）
  - Gemini v1beta：走绝对地址 `https://nexusapi.cn/v1beta/...`（不经过 `/v1`）

参考文档：
- API 列表：`https://20474j2h5s.apifox.cn/`
- 模型广场：`https://nexusapi.cn`

---

## 1) 鉴权（最关键）

NexusAPI 里存在两种常见鉴权方式，本项目封装在：
- 请求封装：`src/utils/request.js`（`authMode: "bearer" | "query"`）
- Key/Base URL：`src/hooks/useApiConfig.js`（Base URL 已锁定）

### 1.1 OpenAI 兼容接口（Chat / Images / Videos）

- Header 鉴权（Bearer）：
  - `Authorization: Bearer <YOUR_API_KEY>`
  - `Content-Type: application/json`
  - `Accept: application/json`（推荐）

示例（Responses / Chat）：`https://20474j2h5s.apifox.cn/`

### 1.2 Gemini 原生接口（v1beta）

- Query 鉴权（与 Gemini 官方一致）：
  - `POST /v1beta/models/<model>:generateContent?key=<YOUR_API_KEY>`
  - 本项目不会给该接口加 `Authorization`，只加 `?key=...`

OpenAPI 示例：
- 文本：`https://20474j2h5s.apifox.cn/api-403562478.md`
- 生图（含 aspectRatio/imageSize）：`https://20474j2h5s.apifox.cn/api-403562463.md`

---

## 2) 接口族与数据形状（按“通用能力”划分）

### 2.1 Responses（OpenAI 兼容，推荐）

- `POST /responses`（完整 URL：`https://nexusapi.cn/v1/responses`）
- 典型请求体（聊天风格）：
  - `model`: string（本项目默认：`gpt-5-mini`）
  - `input`: `{ role: "user"|"assistant"|"system", content: string }[]`
  - `stream`: boolean（可选）

OpenAPI 示例：
- 创建响应：`https://20474j2h5s.apifox.cn/api-403562485.md`
- 流式返回：`https://20474j2h5s.apifox.cn/api-403562487.md`

> 兼容说明：项目仍保留 `POST /chat/completions`（例如某些“Chat 生图”模型会用到），但主 AI 助手默认走 `/responses`。

#### 2.1.1 非流式示例（推荐先用它排错）

```bash
curl --location --request POST 'https://nexusapi.cn/v1/responses' \
  --header 'Accept: application/json' \
  --header 'Authorization: Bearer <YOUR_API_KEY>' \
  --header 'Content-Type: application/json' \
  --data-raw '{
    "model": "gpt-5-mini",
    "input": [
      { "role": "system", "content": "你是一个中文助手。" },
      { "role": "user", "content": "用一句话解释什么是分镜。" }
    ]
  }'
```

常见返回字段（不同网关实现可能略有差异）：
- `output_text`（若存在，直接作为最终文本）
- 或 `output[]`（需要从 `output[].content[].text` 拼接文本）

#### 2.1.2 流式示例（SSE）

```bash
curl --location --request POST 'https://nexusapi.cn/v1/responses' \
  --header 'Accept: application/json' \
  --header 'Authorization: Bearer <YOUR_API_KEY>' \
  --header 'Content-Type: application/json' \
  --data-raw '{
    "model": "gpt-5-mini",
    "stream": true,
    "input": [
      { "role": "user", "content": "写一段更电影感的提示词。" }
    ]
  }'
```

流式返回是 SSE（`data: ...`），以 `data: [DONE]` 结束。事件 JSON 里常见两类文本片段：
- `delta: "..."`（增量文本）
- 或直接给出 `output_text` / `output`（全量文本，需要做去重/增量化处理）

### 2.2 Gemini generateContent（v1beta 原生）

- `POST /v1beta/models/<model>:generateContent?key=...`
- 典型请求体（多轮对话）：
  - `systemInstruction.parts[].text`
  - `contents[]`: `role` + `parts[]`（text / inline_data）
  - `generationConfig`: `temperature/topP/...`
  - `thinkingConfig`（可选）

OpenAPI 示例：`https://20474j2h5s.apifox.cn/api-403562478.md`

#### 2.2.1 Gemini 生图（nano-banana-pro / gemini-3-pro-image-preview）

- 路由：`POST /v1beta/models/gemini-3-pro-image-preview:generateContent?key=<YOUR_API_KEY>`
- 关键字段：
  - `contents[].parts[]`：支持 `text` + 多个 `inline_data`
  - `generationConfig.responseModalities` 必须包含 `"IMAGE"`
  - `generationConfig.imageConfig.aspectRatio`（如 `9:16`）
  - `generationConfig.imageConfig.imageSize`（`1K/2K/4K`）
- 注意（最容易踩坑）：参考图使用 `inline_data`（base64，无 `data:` 前缀）。如果你的图片节点只有外链 URL，浏览器可能因为跨域无法转成 base64，建议用“上传图片”或选择能在节点里拿到 `base64` 的图片。

### 2.3 Images（OpenAI 兼容）

- `POST /images/generations`（完整 URL：`https://nexusapi.cn/v1/images/generations`）
- 典型请求体（不同模型字段略有差异）：
  - `model`: string
  - `prompt`: string（文档里提示 max 1000 字符）
  - `n`: number（生成张数）
  - `size`: string（示例：`1024x1024`、`1024x1536`、`1536x1024`；即梦示例使用比例：`2:3`）
  - `image`: string（可选，编辑类模型需要：URL 或 DataURL）

OpenAPI 示例：
- GPT Image：`https://20474j2h5s.apifox.cn/api-403562513.md`
- 即梦绘画：`https://20474j2h5s.apifox.cn/api-403562516.md`

项目解析返回时会兼容两种常见返回：
- `data[].url`
- `data[].b64_json`（若网关返回 base64，前端会自动转成可展示的 DataURL/BlobURL）

#### 2.3.1 gpt-image-1.5-all（像素尺寸）

```bash
curl --location --request POST 'https://nexusapi.cn/v1/images/generations' \
  --header 'Accept: application/json' \
  --header 'Authorization: Bearer <YOUR_API_KEY>' \
  --header 'Content-Type: application/json' \
  --data-raw '{
    "model": "gpt-image-1.5-all",
    "prompt": "电影感光影，一个女孩在雨夜街头，霓虹反射，浅景深",
    "n": 1,
    "size": "1024x1536"
  }'
```

#### 2.3.2 jimeng-4.5（比例尺寸）

Apifox 示例里即梦使用的是比例 `size`（如 `2:3`），不是像素。

```bash
curl --location --request POST 'https://nexusapi.cn/v1/images/generations' \
  --header 'Accept: application/json' \
  --header 'Authorization: Bearer <YOUR_API_KEY>' \
  --header 'Content-Type: application/json' \
  --data-raw '{
    "model": "jimeng-4.5",
    "prompt": "一只可爱的小猪，柔光，干净背景，插画风",
    "size": "2:3"
  }'
```

#### 2.3.3 flux-pro-1.1-ultra（OpenAI Images 兼容）

与 `gpt-image-1.5-all` 调用方式一致（`POST /images/generations`），只需切换 `model`：

```bash
curl --location --request POST 'https://nexusapi.cn/v1/images/generations' \
  --header 'Accept: application/json' \
  --header 'Authorization: Bearer <YOUR_API_KEY>' \
  --header 'Content-Type: application/json' \
  --data-raw '{
    "model": "flux-pro-1.1-ultra",
    "prompt": "电影分镜风格，雨夜街头，霓虹反射，浅景深",
    "n": 1,
    "size": "1024x1024"
  }'
```

#### 2.3.4 doubao-seedream-4-5-251128（OpenAI Images 兼容，但字段有差异）

Seedream 走同一个 `/images/generations`，但 `size` 支持 `1K/2K/4K`（或 `宽x高` 像素），并且建议显式关闭组图：

OpenAPI：`https://20474j2h5s.apifox.cn/api-403562528.md`

```bash
curl --location --request POST 'https://nexusapi.cn/v1/images/generations' \
  --header 'Accept: application/json' \
  --header 'Authorization: Bearer <YOUR_API_KEY>' \
  --header 'Content-Type: application/json' \
  --data-raw '{
    "model": "doubao-seedream-4-5-251128",
    "prompt": "电影分镜风格，雨夜街头，霓虹反射，浅景深",
    "size": "2K",
    "sequential_image_generation": "disabled",
    "stream": false,
    "response_format": "url",
    "watermark": false
  }'
```

### 2.4 Video（两种风格：OpenAI 视频格式 / 统一视频格式）

#### A) OpenAI 视频格式：创建 `/videos`（multipart）

- `POST /videos`
- `Content-Type: multipart/form-data`
- 常见字段：
  - `model`
  - `prompt`
  - `seconds`
  - `input_reference`（垫图：file）
  - `size`（按 OpenAPI：横屏 `1280x720` / 竖屏 `720x1280`；项目会根据画幅自动映射）
  - `watermark`（字符串 `"false"` 等）

OpenAPI：`https://20474j2h5s.apifox.cn/api-403562542.md`

查询（轮询）：
- `GET /videos/{id}`
- 成功后会出现 `video_url`

OpenAPI：`https://20474j2h5s.apifox.cn/api-403562543.md`

#### B) 统一视频格式：创建 `/video/create`（JSON）

- `POST /video/create`
- 请求体会随模型变化（按 Apifox 示例）：
  - **Veo（视频统一格式）**：`model/prompt/images/enhance_prompt/enable_upsample/aspect_ratio`
  - **Sora（统一视频格式）**：`model/prompt/images/orientation/size/duration/watermark/private`

OpenAPI：`https://20474j2h5s.apifox.cn/api-403562538.md`
（Sora 创建：`https://20474j2h5s.apifox.cn/api-403562579.md`；Sora-Pro：`https://20474j2h5s.apifox.cn/api-403562580.md`）

查询（轮询）：
- `GET /video/query?id=<taskId>`
- 成功后会出现 `video_url`

OpenAPI：`https://20474j2h5s.apifox.cn/api-403562540.md`

#### 2.4.1 Veo3.1（统一视频格式）示例

```bash
curl --location --request POST 'https://nexusapi.cn/v1/video/create' \
  --header 'Accept: application/json' \
  --header 'Authorization: Bearer <YOUR_API_KEY>' \
  --header 'Content-Type: application/json' \
  --data-raw '{
    "model": "veo3.1-4k",
    "prompt": "一只猫在城市屋顶奔跑，强烈电影感，镜头跟随",
    "images": [
      "https://filesystem.site/cdn/20250612/998IGmUiM2koBGZM3UnZeImbPBNIUL.png"
    ],
    "enhance_prompt": true,
    "enable_upsample": true,
    "aspect_ratio": "16:9"
  }'
```

#### 2.4.2 Sora 2 All（统一视频格式）示例（注意 size 必填）

你遇到的 `size is required for sora-2`，本质就是这类请求必须携带 `size`/`duration` 等字段。
本项目已在「视频配置节点」里为 Sora 增加 `size` 选择（`small/large`），并始终随请求一起发送。

```bash
curl --location --request POST 'https://nexusapi.cn/v1/video/create' \
  --header 'Accept: application/json' \
  --header 'Authorization: Bearer <YOUR_API_KEY>' \
  --header 'Content-Type: application/json' \
  --data-raw '{
    "images": [],
    "model": "sora-2-all",
    "orientation": "portrait",
    "prompt": "make animate",
    "size": "large",
    "duration": 15,
    "watermark": false,
    "private": true
  }'
```

#### 2.4.3 查询任务（统一视频查询）

```bash
curl --location --request GET 'https://nexusapi.cn/v1/video/query?id=<taskId>' \
  --header 'Accept: application/json' \
  --header 'Authorization: Bearer <YOUR_API_KEY>'
```

轮询返回通常包含：
- `status`（如 `pending/running/succeeded/failed`）
- `video_url`（成功后出现）

### 2.5 Kling 平台（/kling/v1/...）

> 本项目新增了 `kling-image`、`kling-video` 两类能力，对应 NexusAPI 的 Kling 代理路径。鉴权统一为 Bearer：`Authorization: Bearer <YOUR_API_KEY>`。

#### 2.5.1 Kling 生图

- 创建：`POST /kling/v1/images/generations`
  - 必填：`model_name`、`prompt`、`n`
  - 常用可选：`image`（参考图，URL 或 base64）、`resolution(1k/2k)`、`aspect_ratio`
- 查询：`GET /kling/v1/images/generations/{id}`

OpenAPI：
- 创建：`https://20474j2h5s.apifox.cn/api-403562636.md`
- 查询：`https://20474j2h5s.apifox.cn/api-403562637.md`

#### 2.5.2 Kling 文生视频

- 创建：`POST /kling/v1/videos/text2video`
  - 必填：`model_name`、`prompt`、`mode(std|pro)`、`duration`、`sound(on|off)`
  - 可选：`aspect_ratio`、`camera_control`、`negative_prompt` 等
- 查询：`GET /kling/v1/videos/text2video/{id}`

OpenAPI：`https://20474j2h5s.apifox.cn/api-403562618.md`

#### 2.5.3 Kling 图生视频

- 创建：`POST /kling/v1/videos/image2video`
  - 必填：`model_name`、`image`、`mode(std|pro)`、`duration`、`sound(on|off)`
  - 可选：`image_tail`、`prompt` 等
- 查询：`GET /kling/v1/videos/image2video/{id}`

OpenAPI：`https://20474j2h5s.apifox.cn/api-403562620.md`

### 2.6 Tencent-VOD AIGC（/tencent-vod/v1/...）

> 该组接口目前未在公开 Apifox 页面里检索到对应示例页；项目按你给定的后缀与版本参数接入。若你提供官方字段/查询方式，我可以继续把请求体/轮询对齐到 100% 可用。

- 生图：`POST /tencent-vod/v1/aigc-image`（`aigc-image-gem`/`aigc-image-qwen`）
- 视频：`POST /tencent-vod/v1/aigc-video`（`aigc-video-vidu`/`aigc-video-hailuo`）

---

## 3) 当前模型路由（你指定的规则落地）

你提供的规则：统一前缀 `https://nexusapi.cn`，不同模型在后面拼不同后缀。项目当前按该规则实现如下：

### 3.1 主 AI 助手（文本）

- model：`gpt-5-mini`
- 路由：`POST /responses`
- 代码：
  - 入口：`src/hooks/useApi.js`（`useChat()` -> `streamResponses/createResponse`）
  - HTTP：`src/utils/request.js`（`authMode: "bearer"`）

> Gemini 仍保留为可选模型（`gemini-3-pro-preview`，走 v1beta + `?key=`），但默认主助手已切换到 Responses。

### 3.2 生图（Images）

- Gemini 原生生图
  - model：`gemini-3-pro-image-preview`（UI 展示名：`nano-banana-pro`）
  - 路由：`POST /v1beta/models/gemini-3-pro-image-preview:generateContent?key=...`
  - 关键字段：`generationConfig.responseModalities`、`generationConfig.imageConfig.aspectRatio`、`generationConfig.imageConfig.imageSize`

- OpenAI 兼容生图（统一入口）
  - 路由：`POST /images/generations`（Bearer）
  - 适配 model（目前在 UI 下拉里）：`gpt-image-1.5-all`、`jimeng-4.5`、`flux-pro-1.1-ultra`、`doubao-seedream-4-5-251128`
  - `size` 说明：
    - `gpt-image-1.5-all`：像素尺寸（`1024x1024` / `1536x1024` / `1024x1536`）
    - `jimeng-4.5`：比例尺寸（如 `2:3`）
    - `doubao-seedream-4-5-251128`：`1K/2K/4K`（或 `宽x高` 像素）

- OpenAI 兼容“编辑图”
  - 路由：`POST /images/generations`（Bearer）
  - model：`qwen-image-edit-2509`
  - 需要额外字段：`image`（URL 或 DataURL）

- Chat Completions 生图（OpenAI Chat 兼容）
  - 路由：`POST /chat/completions`（Bearer）
  - model：`qwen-image-max`、`grok-4-image`
  - 说明：项目会深度提取返回里的 `url/image_url`；建议在提示词里要求“只输出图片 URL 或 dataURI”

- Kling 生图
  - 路由：`POST /kling/v1/images/generations`（Bearer）
  - model：`kling-image`（固定 `model_name=kling-v2-1`）
  - 查询：`GET /kling/v1/images/generations/{id}`（当返回 `task_id` 时轮询）

- Tencent-VOD AIGC（按你提供的后缀接入）
  - 路由：`POST /tencent-vod/v1/aigc-image`（Bearer）
  - model：`aigc-image-gem`（版本 `3.0`，默认 2k）、`aigc-image-qwen`（版本 `0925`）
  - 说明：该端点未在当前 help 站的 openapi/sitemap 中检索到；如你能提供示例字段，我可以继续对齐参数与返回格式。

### 3.3 视频（Videos）

- `veo_3_1-fast`
  - 创建：`POST /videos`（multipart）
  - 查询：`GET /videos/{id}`

- 其它视频模型（统一格式）
  - 创建：`POST /video/create`
  - 查询：`GET /video/query?id=...`
  - UI 下拉目前包含：`veo3.1-4k`、`veo3.1-pro-4k`、`sora-2-all`、`jimeng-video-3.0`

- Kling 视频
  - 文生创建：`POST /kling/v1/videos/text2video`
  - 图生创建：`POST /kling/v1/videos/image2video`
  - 查询：分别 `GET /kling/v1/videos/text2video/{id}`、`GET /kling/v1/videos/image2video/{id}`
  - UI model：`kling-video`（固定 `model_name=kling-v2-6`、`mode=pro`、`duration=10`、`sound=off`）

- Tencent-VOD AIGC 视频
  - 创建：`POST /tencent-vod/v1/aigc-video`
  - UI model：`aigc-video-vidu`（`version=q2-pro`）、`aigc-video-hailuo`（`version=2.3-Fast`）
  - 说明：当前仅支持“接口直接返回 `video_url`”；若返回任务 ID 需要补齐查询端点

---

## 4) “增/删模型”最小改动点（推荐顺序）

### 4.1 只新增一个“OpenAI 兼容图片模型”

如果新模型仍然走 `/images/generations`（只要换 `model` 字段），通常你只需要改 2 个地方：

1. `src/config/models.js`：把模型加到 `IMAGE_MODELS`
2. （可选）`src/hooks/useApi.js`：通常无需改动（因为 `/images/generations` 统一适配）

### 4.2 新增一个“Gemini v1beta 原生模型”

1. `src/config/models.js`：加到 `CHAT_MODELS`（或 `IMAGE_MODELS`）
2. `src/hooks/useApi.js`：按需要新增 format/分支
3. 若要修改默认模型：
   - `src/config/models.js` → `DEFAULT_CHAT_MODEL` / `DEFAULT_IMAGE_MODEL`

### 4.3 新增一个“新后缀 / 新协议”的模型（最常见：视频/特殊生图）

1. 先确认：
   - 路由后缀（例如 `/responses`、`/images/generations`、`/v1beta/...`、或其它）
   - 鉴权方式（Bearer / query `key`）
   - 请求体字段（JSON vs multipart）
   - 返回形状（轮询字段：`id`、`status`、`video_url` 等）
2. 落地位置：
   - 模型配置：`src/config/models.js`
   - 业务调用：`src/hooks/useApi.js`
3. UI 模型下拉：
   - `src/stores/models.js`（读取 `src/config/models.js`）

---

## 5) 项目内与 NexusAPI 强相关的代码位置

- `src/utils/request.js`
  - Axios 封装、错误处理、Bearer / Query `key` 两种鉴权
- `src/config/models.js`
  - 模型列表、端点后缀、鉴权方式、format、默认模型
- `src/hooks/useApi.js`
  - 聊天/生图/视频的请求体组装、解析、轮询逻辑
- `src/components/ApiSettings.vue`
  - 仅填写 Key；Base URL 已锁定不可修改

---

## 6) 排错清单（最容易踩的坑）

1. **401 / Invalid authorization header**
   - OpenAI 兼容接口：检查 `Authorization: Bearer ...`
   - Gemini v1beta：检查 URL 是否带 `?key=...`

2. **图片返回 URL 但浏览器无法加载**
   - 可能是临时链接跨域/过期。
   - 本项目会优先解析 `b64_json`（若网关返回），否则使用 `url`。
   - 若你希望“稳定可展示”，建议优先使用能返回 base64 的模型/网关实现，或在生成后立即下载保存到本地项目素材。

3. **视频一直 pending**
   - 轮询接口字段不一致：检查你走的是 `/videos/{id}` 还是 `/video/query?id=...`
   - 任务 ID 的前缀/格式不同也会影响查询路径

4. **Base URL**
   - 本项目已强制固定为：`https://nexusapi.cn/v1`（用户不可修改）

5. **参考图不生效（常见于 Gemini）**
   - Gemini 生图要求把参考图以 `inline_data`（base64）发送；若图片节点只有外链 URL，浏览器可能因跨域无法读取并转成 base64。
   - 建议：用“上传图片”节点，或确保图片节点里有 `base64` 字段后再连接到生图配置节点。

6. **本地存储超额 / 刷新后项目丢失**
   - 项目列表元数据会尝试写入 `localStorage`，画布大数据存 `IndexedDB`；若 `localStorage` 因配额不可写，会自动把元数据也落到 `IndexedDB`。

---

## 7) 建议的下一步（可选增强）

- 做一个“模型注册表”UI（写入 localStorage），让你不改代码也能增/删下拉模型。
- 给 `generateVideo()` 做并发/重试/取消控制（目前以轮询为主）。
- 把主聊天也支持 `/chat/completions`，实现 Gemini/OpenAI/Qwen 一键切换。

---

## 视频模型（help.allapi.store）

> 来源：`https://help.allapi.store/`（自动整理，仅保留与调用相关的参数）

### veo 视频生成

#### 创建视频

- 端点：`POST /v1/video/create`
- Header 参数：
- `Content-Type` (string, 必填)
- `Accept` (string, 必填)
- `Authorization` (string, 可选)
- Body 参数：
- `model` (string, 必填)，可选：veo2, veo2-fast, veo2-fast-frames, veo2-fast-components, veo2-pro, veo2-pro-components, veo3, veo3-fast, veo3-fast-frames, veo3-frames, veo3-pro, veo3-pro-frames, veo3.1, veo3.1-fast, veo3.1-pro
- `prompt` (string, 必填)：提示词
- `enhance_prompt` (boolean, 可选)：由于 veo 只支持英文提示词，所以如果需要中文自动转成英文提示词，可以开启此开关
- `enable_upsample` (boolean, 可选)
- `images[]` (array<string>, 可选)
- `aspect_ratio` (string, 可选)：⚠️仅veo3支持，“16:9”或“9:16”
- 示例（已脱敏/截断）：
```json
{
  "enable_upsample": true,
  "enhance_prompt": true,
  "images": [
    "https://filesystem.site/cdn/20250702/w8AauvxxPhYoqqkFWdMippJpb9zBxN.png"
  ],
  "model": "veo3.1-fast",
  "prompt": "make animate",
  "aspect_ratio": "16:9"
}
```

#### 创建视频，带图片

- 端点：`POST /v1/video/create`
- Header 参数：
- `Content-Type` (string, 必填)
- `Accept` (string, 必填)
- `Authorization` (string, 可选)
- Body 参数：
- `model` (string, 必填)：枚举值:
veo2
veo2-fast
veo2-fast-frames
veo2-fast-components
veo2-pro
veo3
veo3-fast
veo3-pro
veo3-pro-frames
veo3-fast-frames
veo3-frames
- `prompt` (string, 必填)：提示词
- `images[]` (array<string>, 可选)
- `enhance_prompt` (boolean, 必填)：由于 veo 只支持英文提示词，所以如果需要中文自动转成英文提示词，可以开启此开关

- `enable_upsample` (string, 必填)：超分
- `aspect_ratio` (string, 必填)：⚠️仅veo3支持，“16:9”或“9:16”

- 示例（已脱敏/截断）：
```json
{
  "prompt": "牛飞上天了",
  "model": "veo3-fast-frames",
  "images": [
    "https://filesystem.site/cdn/20250612/VfgB5ubjInVt8sG6rzMppxnu7gEfde.png",
    "https://filesystem.site/cdn/20250612/998IGmUiM2koBGZM3UnZeImbPBNIUL.png"
  ],
  "enhance_prompt": true,
  "enable_upsample": true,
  "aspect_ratio": "16:9"
}
```

#### 查询任务

- 端点：`GET /v1/video/query`
- 说明：给定一个提示，该模型将返回一个或多个预测的完成，并且还可以返回每个位置的替代标记的概率。

为提供的提示和参数创建完成
- Query 参数：
- `id` (string, 必填)：任务ID

- Header 参数：
- `Content-Type` (string, 必填)
- `Accept` (string, 必填)
- `Authorization` (string, 可选)
- `X-Forwarded-Host` (string, 可选)
- Body 参数：
- `model` (string, 必填)：枚举值:
veo2
veo2-fast
veo2-fast-frames
veo2-fast-components
veo2-pro
veo3
veo3-fast
veo3-pro
veo3-pro-frames
- `messages[].role` (string, 可选)
- `messages[].content` (string, 可选)
- `stream` (boolean, 可选)：默认为 false 如果设置,则像在 ChatGPT 中一样会发送部分消息增量。标记将以仅数据的服务器发送事件的形式发送,这些事件在可用时,并在 data: [DONE] 消息终止流。Python 代码示例。

#### 创建视频（参考图）

- 端点：`POST /v1/video/create`
- Header 参数：
- `Content-Type` (string, 必填)
- `Accept` (string, 必填)
- `Authorization` (string, 可选)
- Body 参数：
- `model` (string, 必填)：枚举值:
veo2
veo2-fast
veo2-fast-frames
veo2-fast-components
veo2-pro
veo3
veo3-fast
veo3-pro
veo3-pro-frames
veo3-fast-frames
veo3-frames
- `prompt` (string, 必填)：提示词
- `images[]` (array<string>, 可选)
- `enhance_prompt` (boolean, 必填)：由于 veo 只支持英文提示词，所以如果需要中文自动转成英文提示词，可以开启此开关

- `enable_upsample` (string, 必填)：超分
- `aspect_ratio` (string, 必填)：⚠️仅veo3支持，“16:9”或“9:16”

- 示例（已脱敏/截断）：
```json
{
  "prompt": "牛飞上天了",
  "model": "veo3.1-components",
  "images": [
    "https://filesystem.site/cdn/20250612/VfgB5ubjInVt8sG6rzMppxnu7gEfde.png",
    "https://filesystem.site/cdn/20250612/998IGmUiM2koBGZM3UnZeImbPBNIUL.png",
    "https://iknow-pic.cdn.bcebos.com/5882b2b7d0a20cf4ced1ab5f64094b36adaf99e9"
  ],
  "enhance_prompt": true,
  "enable_upsample": true,
  "aspect_ratio": "16:9"
}
```

#### openai 创建视频，带图片

- 端点：`POST /v1/videos`

#### openai 查询任务

- 端点：`GET /v1/videos/{id}`
- 说明：给定一个提示，该模型将返回一个或多个预测的完成，并且还可以返回每个位置的替代标记的概率。

为提供的提示和参数创建完成
- Header 参数：
- `Content-Type` (string, 必填)
- `Accept` (string, 必填)
- `Authorization` (string, 可选)
- `X-Forwarded-Host` (string, 可选)
- Path 参数：
- `id` (string, 必填)
- Body 参数：
- `model` (string, 必填)：枚举值:
veo2
veo2-fast
veo2-fast-frames
veo2-fast-components
veo2-pro
veo3
veo3-fast
veo3-pro
veo3-pro-frames
- `messages[].role` (string, 可选)
- `messages[].content` (string, 可选)
- `stream` (boolean, 可选)：默认为 false 如果设置,则像在 ChatGPT 中一样会发送部分消息增量。标记将以仅数据的服务器发送事件的形式发送,这些事件在可用时,并在 data: [DONE] 消息终止流。Python 代码示例。

#### openai 下载视频

- 端点：`GET /v1/videos/{id}/content`
- 说明：给定一个提示，该模型将返回一个或多个预测的完成，并且还可以返回每个位置的替代标记的概率。

为提供的提示和参数创建完成
- Header 参数：
- `Content-Type` (string, 必填)
- `Accept` (string, 必填)
- `Authorization` (string, 可选)
- `X-Forwarded-Host` (string, 可选)
- Path 参数：
- `id` (string, 必填)
- Body 参数：
- `model` (string, 必填)：枚举值:
veo2
veo2-fast
veo2-fast-frames
veo2-fast-components
veo2-pro
veo3
veo3-fast
veo3-pro
veo3-pro-frames
- `messages[].role` (string, 可选)
- `messages[].content` (string, 可选)
- `stream` (boolean, 可选)：默认为 false 如果设置,则像在 ChatGPT 中一样会发送部分消息增量。标记将以仅数据的服务器发送事件的形式发送,这些事件在可用时,并在 data: [DONE] 消息终止流。Python 代码示例。

### luma 视频生成

#### 提交生成视频任务

- 端点：`POST /luma/generations`
- 说明：官方文档：https://docs.lumalabs.ai/docs/video-generation
- Header 参数：
- `Content-Type` (string, 必填)
- `Accept` (string, 必填)
- `Authorization` (string, 必填)
- Body 参数：
- `user_prompt` (string, 必填)：必传，用户输入的提示词/问题描述
- `expand_prompt` (boolean, 必填)：可选，提示词优化开关
- `loop` (boolean, 必填)：可选，是否循环使用参考图
- `image_url` (string, 必填)：可选，参考图片来源
- `image_end_url` (string, 必填)：可选，目标关键帧图片
- `notify_hook` (string, 必填)：可选，处理完成后的回调通知地址
- `resolution` (string, 必填)：720p或者1080p默认720p

- `duration` (string, 必填)：时长只支持5s

- `model_name` (string, 必填)：ray-v1、 ray-v2 官方显示是 ray1.6 ray2

- 示例（已脱敏/截断）：
```json
{
  "user_prompt": "一阵风吹过树林，使女人的面纱微微飘动。",
  "model_name": "ray-v2",
  "duration": "5s",
  "resolution": "720p"
}
```

#### 扩展视频

- 端点：`POST /luma/generations/{task_id}/extend`
- 说明：官方文档：https://docs.lumalabs.ai/docs/video-generation
- Header 参数：
- `Content-Type` (string, 必填)
- `Accept` (string, 必填)
- `Authorization` (string, 必填)
- Path 参数：
- `task_id` (string, 必填)：task id 为需要延长的视频任务id
- Body 参数：
- `user_prompt` (string, 必填)：必传，用户输入的提示词/问题描述，用于生成内容的主要输入
- `expand_prompt` (boolean, 必填)：可选，是否启用提示词优化功能
- `image_url` (string, 必填)：可选，参考图片URL或Base64编码
- `image_end_url` (string, 必填)：可选，关键帧图片URL或Base64编码
- `notify_hook` (string, 必填)：可选，回调通知地址
- 示例（已脱敏/截断）：
```json
{
  "user_prompt": "add cat",
  "expand_prompt": true
}
```

#### 查询单个任务

- 端点：`GET /luma/generations/{task_id}`
- 说明："state": "completed" 枚举值： "pending", "processing", "completed", "failed"
- Header 参数：
- `Content-Type` (string, 必填)
- `Accept` (string, 必填)
- `Authorization` (string, 必填)
- Path 参数：
- `task_id` (string, 必填)：任务id
- Body 参数：
- `model` (string, 必填)：使用的模型，可选，默认为 kling-image
- `prompt` (string, 必填)：正向提示词，必需，描述你想要生成的图像内容，不能超过500个字符
- `negative_prompt` (string, 必填)：负向提示词，可选，描述你不想在图像中出现的元素，不能超过200个字符
- `image` (string, 必填)：参考图片，可选，支持 Base64 编码或图片 URL，支持 .jpg/.jpeg/.png 格式，大小不能超过 10MB
- `image_fidelity` (number, 必填)：参考图片的影响强度，可选，取值范围：0-1，值越大，生成的图像越接近参考图片
- `n` (integer, 必填)：生成图片的数量，可选，取值范围：1-9
- `aspect_ratio` (string, 必填)：生成图片的纵横比，可选，可选值：16:9, 9:16, 1:1, 4:3, 3:4, 3:2, 2:3
- `callback_url` (string, 必填)：回调通知地址，可选，当任务状态发生变化时，系统会向这个地址发送通知

#### 批量获取任务

- 端点：`POST /luma/tasks`
- 说明："state": "completed" 枚举值： "pending", "processing", "completed", "failed"
- Header 参数：
- `Content-Type` (string, 必填)
- `Accept` (string, 必填)
- `Authorization` (string, 必填)
- Body 参数：
- `model` (string, 必填)：使用的模型，可选，默认为 kling-image
- `prompt` (string, 必填)：正向提示词，必需，描述你想要生成的图像内容，不能超过500个字符
- `negative_prompt` (string, 必填)：负向提示词，可选，描述你不想在图像中出现的元素，不能超过200个字符
- `image` (string, 必填)：参考图片，可选，支持 Base64 编码或图片 URL，支持 .jpg/.jpeg/.png 格式，大小不能超过 10MB
- `image_fidelity` (number, 必填)：参考图片的影响强度，可选，取值范围：0-1，值越大，生成的图像越接近参考图片
- `n` (integer, 必填)：生成图片的数量，可选，取值范围：1-9
- `aspect_ratio` (string, 必填)：生成图片的纵横比，可选，可选值：16:9, 9:16, 1:1, 4:3, 3:4, 3:2, 2:3
- `callback_url` (string, 必填)：回调通知地址，可选，当任务状态发生变化时，系统会向这个地址发送通知
- 示例（已脱敏/截断）：
```json
{
  "ids": [
    "4665a07c-7641-4809-a133-10786201bb56"
  ]
}
```

### Runway 视频生成

#### 提交视频生成任务

- 端点：`POST /runwayml/v1/image_to_video`
- 说明：官方文档：https://docs.dev.runwayml.com/api/#tag/Start-generating/paths/~1v1~1image_to_video/post
- Header 参数：
- `Content-Type` (string, 必填)
- `Accept` (string, 必填)
- `Authorization` (string, 必填)
- Body 参数：
- `promptImage` (string, 必填)：必填，HTTPS URL或数据URI，包含编码图像作为生成视频的第一帧
- `model` (string, 必填)：必填，指定使用的模型变体，可选值："gen4_turbo"或"gen3a_turbo"
- `ratio` (string, 必填)： 必填，输出视频分辨率，格式为"宽度:高度"，不同模型支持不同分辨率
- `seed` (integer, 必填)：可选，随机种子值(0-4294967295)，相同种子对相同请求产生相似结果
- `promptText` (string, 必填)：可选，字符串(≤1000字符)，详细描述期望在视频中出现的内容
- `duration` (integer, 必填)：可选，视频时长(秒)，可选值：5或10，默认为10
- 示例（已脱敏/截断）：
```json
{
  "promptImage": "https://www.bt.cn/bbs/template/qiao/style/image/btlogo.png",
  "model": "gen4_turbo",
  "promptText": "cat dance",
  "watermark": false,
  "duration": 5,
  "ratio": "1280:768"
}
```

#### 查询视频任务(免费)

- 端点：`GET /runwayml/v1/tasks/{task_id}`
- Header 参数：
- `Content-Type` (string, 必填)
- `Accept` (string, 必填)
- `Authorization` (string, 必填)
- Path 参数：
- `task_id` (string, 必填)：任务id
- Body 参数：
- `user_prompt` (string, 必填)：必传，用户输入的提示词/问题描述
- `expand_prompt` (boolean, 必填)：可选，提示词优化开关
- `loop` (boolean, 必填)：可选，是否循环使用参考图
- `image_url` (string, 必填)：可选，参考图片来源
- `image_end_url` (string, 必填)：可选，目标关键帧图片
- `notify_hook` (string, 必填)：可选，处理完成后的回调通知地址

### 即梦 视频生成

#### 创建视频

- 端点：`POST /v1/video/create`
- Header 参数：
- `Content-Type` (string, 必填)
- `Accept` (string, 必填)
- `Authorization` (string, 可选)
- Body 参数：
- `model` (string, 必填)：模型名字 jimeng-video-3.0
- `prompt` (string, 必填)： 提示词
- `aspect_ratio` (string, 必填)：可选为尺寸，默认为 720x1280。可选：720x1280，1280x720

- `size` (string, 必填)：可选取值：["16:9", "4:3", "1:1", "3:4", "9:16", "21:9"]
默认值："16:9"
- `images[]` (array<string>, 必填)
- 示例（已脱敏/截断）：
```json
{
  "model": "jimeng-video-3.0",
  "prompt": "cat fish",
  "aspect_ratio": "16:9",
  "size": "1080P",
  "images": []
}
```

#### 查询任务

- 端点：`GET /v1/video/query`
- 说明：给定一个提示，该模型将返回一个或多个预测的完成，并且还可以返回每个位置的替代标记的概率。

为提供的提示和参数创建完成
- Query 参数：
- `id` (string, 必填)：任务ID

- Header 参数：
- `Content-Type` (string, 必填)
- `Accept` (string, 必填)
- `Authorization` (string, 可选)
- `X-Forwarded-Host` (string, 可选)
- Body 参数：
- `model` (string, 必填)：枚举值:
veo2
veo2-fast
veo2-fast-frames
veo2-fast-components
veo2-pro
veo3
veo3-fast
veo3-pro
veo3-pro-frames
- `messages[].role` (string, 可选)
- `messages[].content` (string, 可选)
- `stream` (boolean, 可选)：默认为 false 如果设置,则像在 ChatGPT 中一样会发送部分消息增量。标记将以仅数据的服务器发送事件的形式发送,这些事件在可用时,并在 data: [DONE] 消息终止流。Python 代码示例。

#### 提交视频生成任务

- 端点：`POST /jimeng/submit/videos`
- Header 参数：
- `Content-Type` (string, 必填)
- `Accept` (string, 必填)
- `Authorization` (string, 必填)
- Body 参数：
- `prompt` (string, 必填)：提示词
- `image_url` (string, 必填)：图生视频需要传此参数
- `duration` (integer, 必填)：视频时长 枚举值 5, 10

- `aspect_ratio` (string, 必填)：视频尺寸 枚举值 "1:1", "21:9", "16:9", "9:16", "4:3", "3:4"

- `cfg_scale` (integer, 必填)
- 示例（已脱敏/截断）：
```json
{
  "prompt": "一只小猪在高速公路上快乐的奔跑",
  "duration": 5,
  "aspect_ratio": "21:9",
  "cfg_scale": 0.5
}
```

#### 查询视频任务(免费)

- 端点：`GET /jimeng/fetch/{task_id}`
- 说明：TaskStatus:
"NOT_START"
"SUBMITTED"
"QUEUED"
"IN_PROGRESS"
"FAILURE"
"SUCCESS"
- Path 参数：
- `task_id` (string, 必填)：任务id
- Body 参数：
- `user_prompt` (string, 必填)：必传，用户输入的提示词/问题描述
- `expand_prompt` (boolean, 必填)：可选，提示词优化开关
- `loop` (boolean, 必填)：可选，是否循环使用参考图
- `image_url` (string, 必填)：可选，参考图片来源
- `image_end_url` (string, 必填)：可选，目标关键帧图片
- `notify_hook` (string, 必填)：可选，处理完成后的回调通知地址

### 海螺 视频生成

#### 提交视频生成任务 

- 端点：`POST /minimax/v1/video_generation`
- 说明：官方文档：https://www.minimax.io/platform/document/Model%3Fkey=684261f14c5738213294faa7?key=66d1439376e52fcee2853049&document=video_generation
- Header 参数：
- `Content-Type` (string, 必填)
- `Accept` (string, 必填)
- `Authorization` (string, 必填)
- Body 参数：
- `model` (string, 必填)：模型名 传 MiniMax-Hailuo-02
- `prompt` (string, 必填)：提示词
- `duration` (integer, 必填)：视频时长 支持6 ,10
- 示例（已脱敏/截断）：
```json
{
  "model": "MiniMax-Hailuo-02",
  "prompt": "一只小猪在高速公路上快乐的奔跑",
  "duration": 10
}
```

#### 视频任务状态查询

- 端点：`GET /minimax/v1/query/video_generation`
- Query 参数：
- `task_id` (string, 可选)：视频生成任务的唯一标识ID

- Body 参数：
- `user_prompt` (string, 必填)：必传，用户输入的提示词/问题描述
- `expand_prompt` (boolean, 必填)：可选，提示词优化开关
- `loop` (boolean, 必填)：可选，是否循环使用参考图
- `image_url` (string, 必填)：可选，参考图片来源
- `image_end_url` (string, 必填)：可选，目标关键帧图片
- `notify_hook` (string, 必填)：可选，处理完成后的回调通知地址

#### 图生视频

- 端点：`POST /minimax/v1/video_generation`
- 说明：官方文档：https://www.minimax.io/platform/document/Model%3Fkey=684261f14c5738213294faa7?key=66d1439376e52fcee2853049&document=video_generation
- Header 参数：
- `Content-Type` (string, 必填)
- `Accept` (string, 必填)
- `Authorization` (string, 必填)
- Body 参数：
- `model` (string, 必填)：模型名 传 MiniMax-Hailuo-02
- `prompt` (string, 必填)：提示词
- `duration` (integer, 必填)：视频时长 支持6 ,10
- 示例（已脱敏/截断）：
```json
{
  "model": "MiniMax-Hailuo-2.3",
  "prompt": "一只小猪在高速公路上快乐的奔跑",
  "duration": 10,
  "first_frame_image": "https://wx4.sinaimg.cn/mw690/8545bf24ly1hq626p2k5aj20j60j7t9t.jpg",
  "resolution": "768P",
  "prompt_optimizer ": true
}
```

#### 首尾帧视频

- 端点：`POST /minimax/v1/video_generation`
- 说明：官方文档：https://www.minimax.io/platform/document/Model%3Fkey=684261f14c5738213294faa7?key=66d1439376e52fcee2853049&document=video_generation
- Header 参数：
- `Content-Type` (string, 必填)
- `Accept` (string, 必填)
- `Authorization` (string, 必填)
- Body 参数：
- `model` (string, 必填)：模型名 传 MiniMax-Hailuo-02
- `prompt` (string, 必填)：提示词
- `duration` (integer, 必填)：视频时长 支持6 ,10
- 示例（已脱敏/截断）：
```json
{
  "model": "MiniMax-Hailuo-2.3-Fast",
  "prompt": "一只小猪在高速公路上快乐的奔跑",
  "duration": 10,
  "first_frame_image": "https://wx4.sinaimg.cn/mw690/8545bf24ly1hq626p2k5aj20j60j7t9t.jpg",
  "last_frame_image": "https://inews.gtimg.com/om_bt/OBcldFgmIx8oKc7VlrEnHqso_pEEeyfa9Va0gHrQR7NBcAA/641",
  "resolution": "768P",
  "prompt_optimizer ": true
}
```

### 豆包 视频生成

#### 文生视频示例

- 端点：`POST /volc/v1/contents/generations/tasks`
- 说明：官方文档：https://www.volcengine.com/docs/82379/1520757
- Header 参数：
- `Content-Type` (string, 可选)
- `Accept` (string, 可选)
- `Authorization` (string, 可选)
- Body 参数：
- `model` (string, 必填)：您需要调用的模型的 ID
- `content[].type` (string, 必填)：输入内容的类型，此处应为 text
- `content[].text` (string, 必填)：输入给模型的文本内容，描述期望生成的视频，包括：
文本提示词（必填）：支持中英文。建议不超过500字。字数过多信息容易分散，模型可能因此忽略细节，只关注重点，造成视频缺失部分元素。
- 示例（已脱敏/截断）：
```json
"{\r\n    \"model\": \"doubao-seedance-1-0-pro-fast-251015\",\r\n    \"content\": [\r\n        {\r\n            \"type\": \"text\",\r\n            \"text\": \"多个镜头。一名侦探进入一间光线昏暗的房间。他检查桌上的线索，手里拿起桌上的某个物品。镜头转向他正在思索。 --ratio 16:9\"\r\n            // text\": \"多个镜头。一名侦探进入一间光线昏暗的房间。他检查桌上的线索，手里拿起桌上的某个物品。镜头转向他正在思索。 --rs 720p --rt 16:9 --dur 5 --fps 24 --wm true --seed 11 --cf false\"\r\n        }\r\n    ]\r\n}"
```

#### 图生视频-首帧

- 端点：`POST /volc/v1/contents/generations/tasks`
- 说明：官方文档：https://www.volcengine.com/docs/82379/1520757
- Header 参数：
- `Content-Type` (string, 可选)
- `Accept` (string, 可选)
- `Authorization` (string, 可选)
- Body 参数：
- `model` (string, 必填)：您需要调用的模型的 ID 
- `content[].type` (string, 必填)：输入内容的类型，此处应为 text
- `content[].text` (string, 可选)：输入给模型的文本内容，描述期望生成的视频
- `content[].image_url.url` (string, 必填)：输入给模型的图片对象，图片URL
- 示例（已脱敏/截断）：
```json
{
  "model": "doubao-seedance-1-0-lite-i2v-250428",
  "content": [
    {
      "type": "text",
      "text": "生成小猫视频  --rs 1080p --rt 16:9 --ratio 16:9 --dur 5 --fps 24 --wm false --seed 0 --cf false"
    },
    {
      "type": "image_url",
      "image_url": {
        "url": "https://brainrot-yt-shorts.oss-cn-beijing.aliyuncs.com/images/cached/55a955b7e41723417281051d7bebdb45.png"
      }
    }
  ]
}
```

#### seedance-lite-首尾帧

- 端点：`POST /volc/v1/contents/generations/tasks`
- Body 参数：
- `model` (string, 必填)：您需要调用的模型的 ID
- `content[].type` (string, 必填)：输入内容的类型
- `content[].text` (string, 可选)：输入给模型的文本内容，描述期望生成的视频
- `content[].image_url.url` (string, 必填)：输入给模型的图片对象，图片URL
- `content[].role` (string, 必填)：图片的位置或用途。
- 示例（已脱敏/截断）：
```json
{
  "model": "doubao-seedance-1-0-lite-i2v-250428",
  "content": [
    {
      "type": "text",
      "text": "一只蓝绿精卫鸟变成人形 --rs 720p  --dur 5 --cf false"
    },
    {
      "type": "image_url",
      "image_url": {
        "url": "https://ark-project.tos-cn-beijing.volces.com/doc_image/seelite_first_frame.png"
      },
      "role": "first_frame"
    },
    {
      "type": "image_url",
      "image_url": {
        "url": "https://ark-project.tos-cn-beijing.volces.com/doc_image/seelite_last_frame.png"
      },
      "role": "last_frame"
    }
  ]
}
```

#### 图生视频-base64编码

- 端点：`POST /volc/v1/contents/generations/tasks`
- 说明：官方文档：https://www.volcengine.com/docs/82379/1520757
- Header 参数：
- `Authorization` (string, 可选)
- Body 参数：
- `model` (string, 必填)：您需要调用的模型的 ID
- `content[].type` (string, 必填)：输入内容的类型。
- `content[].text` (string, 可选)：输入给模型的文本内容，描述期望生成的视频。
- `content[].image_url.url` (string, 必填)：图片信息，这里为图片 Base64 编码。
- 示例（已脱敏/截断）：
```json
{
  "model": "doubao-seedance-1-0-lite-i2v-250428",
  "content": [
    {
      "type": "text",
      "text": "女孩抱着狐狸，女孩睁开眼，温柔地看向镜头，狐狸友善地抱着，镜头缓缓拉出，女孩的头发被风吹动  --ratio adaptive  --dur 5"
    },
    {
      "type": "image_url",
      "image_url": {
        "url": "data:image/png;base64,aHR0cHM6Ly9hcmstcHJvamVjdC50b3MtY24tYmVpamluZy52b2xjZXMuY29tL2RvY19pbWFnZS9pMnZfZm94cmdpcmwucG5n"
      }
    }
  ]
}
```

#### seedance-lite-参考图

- 端点：`POST /volc/v1/contents/generations/tasks`
- 说明：官方文档：https://www.volcengine.com/docs/82379/1520757
- Header 参数：
- `Authorization` (string, 可选)
- Body 参数：
- `model` (string, 必填)：您需要调用的模型的 ID
- `content[].type` (string, 必填)：输入内容的类型。
- `content[].text` (string, 可选)：输入给模型的文本内容，描述期望生成的视频。
- `content[].image_url.url` (string, 必填)：输入给模型的图片对象，图片URL
- `content[].role` (string, 必填)：图片的位置或用途。
- 示例（已脱敏/截断）：
```json
{
  "model": "doubao-seedance-1-0-lite-i2v-250428",
  "content": [
    {
      "type": "text",
      "text": "[图1]戴着眼镜穿着蓝色T恤的男生和[图2]的柯基小狗，坐在[图3]的草坪上，3D卡通风格"
    },
    {
      "type": "image_url",
      "image_url": {
        "url": "https://ark-project.tos-cn-beijing.volces.com/doc_image/seelite_ref_1.png"
      },
      "role": "reference_image"
    },
    {
      "type": "image_url",
      "image_url": {
        "url": "https://ark-project.tos-cn-beijing.volces.com/doc_image/seelite_ref_2.png"
      },
      "role": "reference_image"
    },
    {
      "type": "image_url",
      "image_url": {
        "url": "https://ark-project.tos-cn-beijing.volces.com/doc_image/seelite_ref_3.png"
      },
      "role": "reference_image"
    }
  ]
}
```

#### 查询单个任务

- 端点：`GET /volc/v1/contents/generations/tasks/{task_id}`
- Header 参数：
- `Content-Type` (string, 可选)
- `Accept` (string, 可选)
- `Authorization` (string, 可选)
- Path 参数：
- `task_id` (string, 必填)

#### 查询视频生成任务列表-默认

- 端点：`GET /volc/v1/contents/generations/tasks`
- Query 参数：
- `page_size` (string, 可选)
- `filter.status` (string, 可选)

#### 查询视频生成任务列表-搜索多个任务 ID

- 端点：`GET /volc/v1/contents/generations/tasks`
- Query 参数：
- `filter.task_ids` (array, 可选)

### sora 视频生成

#### 查询任务 

- 端点：`GET /v1/video/query`
- 说明：给定一个提示，该模型将返回一个或多个预测的完成，并且还可以返回每个位置的替代标记的概率。

为提供的提示和参数创建完成
- Query 参数：
- `id` (string, 必填)：任务ID

- Header 参数：
- `Content-Type` (string, 必填)
- `Accept` (string, 必填)
- `Authorization` (string, 可选)
- `X-Forwarded-Host` (string, 可选)
- Body 参数：
- `model` (string, 必填)：枚举值:
veo2
veo2-fast
veo2-fast-frames
veo2-fast-components
veo2-pro
veo3
veo3-fast
veo3-pro
veo3-pro-frames
- `messages[].role` (string, 可选)
- `messages[].content` (string, 可选)
- `stream` (boolean, 可选)：默认为 false 如果设置,则像在 ChatGPT 中一样会发送部分消息增量。标记将以仅数据的服务器发送事件的形式发送,这些事件在可用时,并在 data: [DONE] 消息终止流。Python 代码示例。

#### 创建视频，带图片  sora-2

- 端点：`POST /v1/video/create`
- Header 参数：
- `Content-Type` (string, 必填)
- `Accept` (string, 必填)
- `Authorization` (string, 可选)
- Body 参数：
- `images[]` (array<string>, 必填)
- `model` (string, 必填)：模型名字
- `orientation` (string, 必填)：portrait 竖屏
landscape 横屏

- `prompt` (string, 必填)：提示词
- `size` (string, 必填)： small 一般720p
- `duration` (integer, 必填)：枚举值: 10
- `watermark` (string, 必填)：默认为： true  会优先无水印，如果出错，会兜底到有水印
传递 false 的话 会强制让视频无水印，遇到去水印错误的会一直自动重试

- 示例（已脱敏/截断）：
```json
{
  "images": [
    "https://filesystem.site/cdn/20250612/998IGmUiM2koBGZM3UnZeImbPBNIUL.png"
  ],
  "model": "sora-2",
  "orientation": "portrait",
  "prompt": "make animate",
  "size": "large",
  "duration": 15,
  "watermark": false
}
```

#### 创建视频 sora-2

- 端点：`POST /v1/video/create`
- Header 参数：
- `Content-Type` (string, 必填)
- `Accept` (string, 必填)
- `Authorization` (string, 可选)
- Body 参数：
- `images[]` (array<string>, 必填)
- `model` (string, 必填)：模型名字
- `orientation` (string, 必填)：portrait 竖屏
landscape 横屏

- `prompt` (string, 必填)：提示词
- `size` (string, 必填)：small 一般720p
- `duration` (integer, 必填)：支持 10 
- `watermark` (boolean, 必填)：默认为： true  会优先无水印，如果出错，会兜底到有水印
传递 false 的话 会强制让视频无水印，遇到去水印错误的会一直自动重试

- `private` (boolean, 必填)：是否隐藏视频，true-视频不会发布，同时视频无法进行 remix(二次编辑)， 默认为 false

- 示例（已脱敏/截断）：
```json
{
  "images": [],
  "model": "sora-2",
  "orientation": "portrait",
  "prompt": "make animate",
  "size": "large",
  "duration": 15,
  "watermark": false,
  "private": true
}
```

#### 创建视频 sora-2-pro

- 端点：`POST /v1/video/create`
- Header 参数：
- `Content-Type` (string, 必填)
- `Accept` (string, 必填)
- `Authorization` (string, 可选)
- Body 参数：
- `images[]` (array<string>, 必填)
- `model` (string, 必填)：模型名字
- `orientation` (string, 必填)：portrait 竖屏
landscape 横屏

- `prompt` (string, 必填)：提示词
- `size` (string, 必填)：large 高清1080p
- `duration` (integer, 必填)：支持 15，25
- `watermark` (boolean, 必填)：默认为： true  会优先无水印，如果出错，会兜底到有水印
传递 false 的话 会强制让视频无水印，遇到去水印错误的会一直自动重试

- `private` (boolean, 必填)：是否隐藏视频，true-视频不会发布，同时视频无法进行 remix(二次编辑)， 默认为 false

- 示例（已脱敏/截断）：
```json
{
  "images": [],
  "model": "sora-2-pro",
  "orientation": "portrait",
  "prompt": "make animate",
  "size": "large",
  "duration": 15,
  "watermark": false,
  "private": true
}
```

#### 创建视频 （带 Character）

- 端点：`POST /v1/video/create`
- Header 参数：
- `Content-Type` (string, 必填)
- Body 参数：
- `images[]` (array<string>, 可选)
- `model` (string, 必填)
- `orientation` (string, 可选)，可选：portrait, landscape
- `prompt` (string, 必填)
- `duration` (integer, 可选)，可选：10, 15, 25：时长
- `character_url` (string, 可选)：创建角色需要的视频链接，注意视频中一定不能出现真人，否则会失败
- `character_timestamps` (string, 可选)：视频角色出现的秒数范围，格式 `{start},{end}`, 注意 end-start 的范围 1-3秒
- `size` (string, 必填)，可选：large, small
- 示例（已脱敏/截断）：
```json
{
  "images": [],
  "model": "sora-2",
  "orientation": "portrait",
  "prompt": "make animate",
  "duration": 15,
  "character_url": "https://filesystem.site/cdn/20251030/javYrU4etHVFDqg8by7mViTWHlMOZy.mp4",
  "character_timestamps": "1,3",
  "size": "large"
}
```

#### 创建视频

- 端点：`POST /v1/chat/completions`
- 说明：给定一个提示，该模型将返回一个或多个预测的完成，并且还可以返回每个位置的替代标记的概率。

为提供的提示和参数创建完成

官方文档：https://platform.openai.com/docs/api-reference/chat/create
- Header 参数：
- `Content-Type` (string, 必填)
- `Accept` (string, 必填)
- `Authorization` (string, 可选)
- `X-Forwarded-Host` (string, 可选)
- Body 参数：
- `model` (string, 必填)：要使用的模型的 ID。有关哪些模型可与聊天 API 一起使用的详细信息,请参阅模型端点兼容性表。


- `messages[].role` (string, 可选)
- `messages[].content` (string, 可选)
- `temperature` (integer, 可选)：使用什么采样温度，介于 0 和 2 之间。较高的值（如 0.8）将使输出更加随机，而较低的值（如 0.2）将使输出更加集中和确定。  我们通常建议改变这个或`top_p`但不是两者。
- `top_p` (integer, 可选)：一种替代温度采样的方法，称为核采样，其中模型考虑具有 top_p 概率质量的标记的结果。所以 0.1 意味着只考虑构成前 10% 概率质量的标记。  我们通常建议改变这个或`temperature`但不是两者。
- `n` (integer, 可选)：默认为 1
为每个输入消息生成多少个聊天补全选择。
- `stream` (boolean, 可选)：默认为 false 如果设置,则像在 ChatGPT 中一样会发送部分消息增量。标记将以仅数据的服务器发送事件的形式发送,这些事件在可用时,并在 data: [DONE] 消息终止流。Python 代码示例。
- `stop` (string, 可选)：默认为 null 最多 4 个序列,API 将停止进一步生成标记。
- `max_tokens` (integer, 可选)：默认为 inf
在聊天补全中生成的最大标记数。

输入标记和生成标记的总长度受模型的上下文长度限制。计算标记的 Python 代码示例。
- `presence_penalty` (number, 可选)：-2.0 和 2.0 之间的数字。正值会根据到目前为止是否出现在文本中来惩罚新标记，从而增加模型谈论新主题的可能性。  [查看有关频率和存在惩罚的更多信息。](https://platform.openai.com/docs/api-reference/parameter-details)
- `frequency_penalty` (number, 可选)：默认为 0 -2.0 到 2.0 之间的数字。正值根据文本目前的存在频率惩罚新标记,降低模型重复相同行的可能性。  有关频率和存在惩罚的更多信息。
- `logit_bias` (null, 可选)：修改指定标记出现在补全中的可能性。

接受一个 JSON 对象,该对象将标记(由标记器指定的标记 ID)映射到相关的偏差值(-100 到 100)。从数学上讲,偏差在对模型进行采样之前添加到模型生成的 logit 中。确切效果因模型而异,但-1 和 1 之间的值应减少或增加相关标记的选择可能性;如-100 或 100 这样的值应导致相关标记的禁用或独占选择。
- `user` (string, 可选)：代表您的最终用户的唯一标识符，可以帮助 OpenAI 监控和检测滥用行为。[了解更多](https://platform.openai.com/docs/guides/safety-best-practices/end-user-ids)。
- `seen` (integer, 可选)：此功能处于测试阶段。如果指定,我们的系统将尽最大努力确定性地进行采样,以便使用相同的种子和参数进行重复请求应返回相同的结果。不能保证确定性,您应该参考 system_fingerprint 响应参数来监控后端的更改。
- `tools[]` (array<string>, 必填)
- 示例（已脱敏/截断）：
```json
{
  "model": "sora-2",
  "max_tokens": 1000,
  "messages": [
    {
      "role": "user",
      "content": "an astronaut golden retriever named Sora levitates around an intergalactic pup-themed space station with a tiny jet back that propels him. gorgeous specular lighting and comets fly through the sky, retro-future astro-themed music plays in the background. light glimmers off the dog's eyes. the dog initially propels towards the space station with the doors opening to let him in. the shot then changes. now inside the space station, many tennis balls are flying around in zero gravity. the dog's astronaut helmet opens up so he can grab one. 35mm film, the intricate details and texturing of the dog's hair are clearly visible and the light of the comets shimmers off the fur."
    }
  ],
  "stream": true
}
```

#### 创建视频, 带图片

- 端点：`POST /v1/chat/completions`
- 说明：给定一个提示，该模型将返回一个或多个预测的完成，并且还可以返回每个位置的替代标记的概率。

为提供的提示和参数创建完成

官方文档：https://platform.openai.com/docs/api-reference/chat/create
- Header 参数：
- `Content-Type` (string, 必填)
- `Accept` (string, 必填)
- `Authorization` (string, 可选)
- `X-Forwarded-Host` (string, 可选)
- Body 参数：
- `model` (string, 必填)：要使用的模型的 ID。有关哪些模型可与聊天 API 一起使用的详细信息,请参阅模型端点兼容性表。


- `messages[].role` (string, 可选)
- `messages[].content` (string, 可选)
- `temperature` (integer, 可选)：使用什么采样温度，介于 0 和 2 之间。较高的值（如 0.8）将使输出更加随机，而较低的值（如 0.2）将使输出更加集中和确定。  我们通常建议改变这个或`top_p`但不是两者。
- `top_p` (integer, 可选)：一种替代温度采样的方法，称为核采样，其中模型考虑具有 top_p 概率质量的标记的结果。所以 0.1 意味着只考虑构成前 10% 概率质量的标记。  我们通常建议改变这个或`temperature`但不是两者。
- `n` (integer, 可选)：默认为 1
为每个输入消息生成多少个聊天补全选择。
- `stream` (boolean, 可选)：默认为 false 如果设置,则像在 ChatGPT 中一样会发送部分消息增量。标记将以仅数据的服务器发送事件的形式发送,这些事件在可用时,并在 data: [DONE] 消息终止流。Python 代码示例。
- `stop` (string, 可选)：默认为 null 最多 4 个序列,API 将停止进一步生成标记。
- `max_tokens` (integer, 可选)：默认为 inf
在聊天补全中生成的最大标记数。

输入标记和生成标记的总长度受模型的上下文长度限制。计算标记的 Python 代码示例。
- `presence_penalty` (number, 可选)：-2.0 和 2.0 之间的数字。正值会根据到目前为止是否出现在文本中来惩罚新标记，从而增加模型谈论新主题的可能性。  [查看有关频率和存在惩罚的更多信息。](https://platform.openai.com/docs/api-reference/parameter-details)
- `frequency_penalty` (number, 可选)：默认为 0 -2.0 到 2.0 之间的数字。正值根据文本目前的存在频率惩罚新标记,降低模型重复相同行的可能性。  有关频率和存在惩罚的更多信息。
- `logit_bias` (null, 可选)：修改指定标记出现在补全中的可能性。

接受一个 JSON 对象,该对象将标记(由标记器指定的标记 ID)映射到相关的偏差值(-100 到 100)。从数学上讲,偏差在对模型进行采样之前添加到模型生成的 logit 中。确切效果因模型而异,但-1 和 1 之间的值应减少或增加相关标记的选择可能性;如-100 或 100 这样的值应导致相关标记的禁用或独占选择。
- `user` (string, 可选)：代表您的最终用户的唯一标识符，可以帮助 OpenAI 监控和检测滥用行为。[了解更多](https://platform.openai.com/docs/guides/safety-best-practices/end-user-ids)。
- `seen` (integer, 可选)：此功能处于测试阶段。如果指定,我们的系统将尽最大努力确定性地进行采样,以便使用相同的种子和参数进行重复请求应返回相同的结果。不能保证确定性,您应该参考 system_fingerprint 响应参数来监控后端的更改。
- `tools[]` (array<string>, 必填)
- 示例（已脱敏/截断）：
```json
{
  "model": "sora-2",
  "max_tokens": 1000,
  "messages": [
    {
      "role": "user",
      "content": [
        {
          "type": "text",
          "text": "里面有一只小鸟在飞行"
        },
        {
          "type": "image_url",
          "image_url": {
            "url": "https://lsky.zhongzhuan.chat/i/2024/10/17/6711068a14527.png"
          }
        }
      ]
    }
  ],
  "stream": true
}
```

#### 连续修改生成视频

- 端点：`POST /v1/chat/completions`
- 说明：给定一个提示，该模型将返回一个或多个预测的完成，并且还可以返回每个位置的替代标记的概率。

为提供的提示和参数创建完成

官方文档：https://platform.openai.com/docs/api-reference/chat/create
- Header 参数：
- `Content-Type` (string, 必填)
- `Accept` (string, 必填)
- `Authorization` (string, 可选)
- `X-Forwarded-Host` (string, 可选)
- Body 参数：
- `model` (string, 必填)，可选：sora-2, sora-2-pro
- `messages[].role` (string, 必填)
- `messages[].content` (string, 必填)
- `stream` (boolean, 必填)
- 示例（已脱敏/截断）：
```json
{
  "model": "sora-2",
  "messages": [
    {
      "role": "user",
      "content": "生成一段高清的，牛马跳舞的视频"
    },
    {
      "role": "assistant",
      "content": "```json\n{\n  \"prompt\": \"生成一段高清的，牛马跳舞的视频\",\n  \"orientation\": \"portrait\"\n}\n```\n\n> ID: `task_01k7dzptgwf2z87wj2c3t36qk0`\n>[数据预览](https://asyncdata.net/web/task_01k7dzptgwf2z87wj2c3t36qk0) | [原始数据](https://asyncdata.net/source/task_01k7dzptgwf2z87wj2c3t36qk0)\n> 排队中......\n> 生成中.\n\n>🏃‍ 进度 76..\n\n> 生成完成 ✅\n> sid: s_68ec8accd80c8191ae1fc957af78caaa\n\n![https://filesystem.site/cdn/20251013/929d094fcd1844c3ee38be9476fd03.webp](https://filesystem.site/cdn/20251013/929d094fcd1844c3ee38be9476fd03.webp)\n[在线播放▶️](https://filesystem.site/cdn/20251013/5781a601c5ce5e216e914fef119c99.mp4)"
    },
    {
      "role": "user",
      "content": "让牛的头上顶着光圈，马的脚下踩着祥云"
    }
  ],
  "stream": true
}
```

#### openai 创建视频，带图片

- 端点：`POST /v1/videos`

#### 使用故事板创建视频

- 端点：`POST /v1/videos`

#### openai 创建视频，带图片 私有模式

- 端点：`POST /v1/videos`

#### openai 创建视频（带Character）

- 端点：`POST /v1/videos`

#### openai 编辑视频

- 端点：`POST /v1/videos/{id}/remix`
- Header 参数：
- `Content-Type` (string, 必填)
- Path 参数：
- `id` (string, 必填)
- Body 参数：
- `prompt` (string, 必填)
- 示例（已脱敏/截断）：
```json
{
  "prompt": "画面更精细一些",
  "size": "1280x720"
}
```

#### openai 下载视频

- 端点：`GET /v1/videos/{id}/content`
- 说明：给定一个提示，该模型将返回一个或多个预测的完成，并且还可以返回每个位置的替代标记的概率。

为提供的提示和参数创建完成
- Header 参数：
- `Content-Type` (string, 必填)
- `Accept` (string, 必填)
- `Authorization` (string, 可选)
- `X-Forwarded-Host` (string, 可选)
- Path 参数：
- `id` (string, 必填)
- Body 参数：
- `model` (string, 必填)：枚举值:
veo2
veo2-fast
veo2-fast-frames
veo2-fast-components
veo2-pro
veo3
veo3-fast
veo3-pro
veo3-pro-frames
- `messages[].role` (string, 可选)
- `messages[].content` (string, 可选)
- `stream` (boolean, 可选)：默认为 false 如果设置,则像在 ChatGPT 中一样会发送部分消息增量。标记将以仅数据的服务器发送事件的形式发送,这些事件在可用时,并在 data: [DONE] 消息终止流。Python 代码示例。

#### openai 查询任务

- 端点：`GET /v1/videos/{id}`
- 说明：给定一个提示，该模型将返回一个或多个预测的完成，并且还可以返回每个位置的替代标记的概率。

为提供的提示和参数创建完成
- Header 参数：
- `Content-Type` (string, 必填)
- `Accept` (string, 必填)
- `Authorization` (string, 可选)
- `X-Forwarded-Host` (string, 可选)
- Path 参数：
- `id` (string, 必填)
- Body 参数：
- `model` (string, 必填)：枚举值:
veo2
veo2-fast
veo2-fast-frames
veo2-fast-components
veo2-pro
veo3
veo3-fast
veo3-pro
veo3-pro-frames
- `messages[].role` (string, 可选)
- `messages[].content` (string, 可选)
- `stream` (boolean, 可选)：默认为 false 如果设置,则像在 ChatGPT 中一样会发送部分消息增量。标记将以仅数据的服务器发送事件的形式发送,这些事件在可用时,并在 data: [DONE] 消息终止流。Python 代码示例。

#### 创建角色

- 端点：`POST /sora/v1/characters`
- Body 参数：
- `url` (string, 可选)：视频中包含需要创建的角色 ,url 和from_task 二选一 

- `timestamps` (string, 必填)：单位秒，例如 ‘1,2’ 是指视频的1～2秒中出现的角色，注意范围差值最大 3 秒最小 1 秒

- `from_task` (string, 可选)：可以根据已经生成的任务 id，来创建角色

- 示例（已脱敏/截断）：
```json
"{\r\n  // \"url\": \"https://filesystem.site/cdn/20251030/javYrU4etHVFDqg8by7mViTWHlMOZy.mp4\",\r\n    \"timestamps\": \"1,3\",\r\n    \"from_task\":\"video_e50c76ca-21d4-40e9-8485-e4ead2d37133\"\r\n}"
```

### grok 视频生成

#### 创建视频 

- 端点：`POST /v1/video/create`
- Header 参数：
- `Content-Type` (string, 必填)
- `Accept` (string, 必填)
- `Authorization` (string, 可选)
- Body 参数：
- `model` (string, 必填)：模型名字 grok-video-3
- `prompt` (string, 必填)： 提示词
- `aspect_ratio` (string, 必填)：可选为 2:3, 3:2, 1:1
- `size` (string, 必填)：720P或者1080P 暂只支持720P
- `images[]` (array<string>, 必填)
- 示例（已脱敏/截断）：
```json
{
  "model": "grok-video-3",
  "prompt": "小猫在吃鱼  --mode=custom",
  "aspect_ratio": "3:2",
  "size": "720P",
  "images": [
    "https://ark-project.tos-cn-beijing.volces.com/doc_image/seedream4_5_imageToimage.png"
  ]
}
```

#### 查询任务 

- 端点：`GET /v1/video/query`
- 说明：给定一个提示，该模型将返回一个或多个预测的完成，并且还可以返回每个位置的替代标记的概率。

为提供的提示和参数创建完成
- Query 参数：
- `id` (string, 必填)：任务ID

- Header 参数：
- `Content-Type` (string, 必填)
- `Accept` (string, 必填)
- `Authorization` (string, 可选)
- `X-Forwarded-Host` (string, 可选)
- Body 参数：
- `model` (string, 必填)：枚举值:
veo2
veo2-fast
veo2-fast-frames
veo2-fast-components
veo2-pro
veo3
veo3-fast
veo3-pro
veo3-pro-frames
- `messages[].role` (string, 可选)
- `messages[].content` (string, 可选)
- `stream` (boolean, 可选)：默认为 false 如果设置,则像在 ChatGPT 中一样会发送部分消息增量。标记将以仅数据的服务器发送事件的形式发送,这些事件在可用时,并在 data: [DONE] 消息终止流。Python 代码示例。

### 通义万象 视频生成

#### 生成视频

- 端点：`POST /alibailian/api/v1/services/aigc/video-generation/video-synthesis`
- Body 参数：
- `model` (string, 必填)：模型名称, (必选) 用于指定本次视频生成所用到的模型。示例值：wan2.5-i2v-preview。
- `input.prompt` (string, 必填)：提示词, (可选) 用来描述生成图像中期望包含的元素和视觉特点。
- `input.negative_prompt` (string, 必填)：反向提示词, (可选) 用来描述不希望在视频画面中看到的内容。
- `input.img_url` (string, 必填)：首帧图像, (必选) 首帧图像的URL或 Base64 编码数据。
- `input.audio_url` (string, 必填)：音频文件URL, (可选，仅wan2.5-i2v-preview支持) 模型将使用该音频生成视频。
- `input.template` (string, 必填)：视频特效模板, (可选) 视频特效模板的名称。若未填写，表示不使用任何视频特效。
- `parameters.resolution` (string, 必填)：视频分辨率, (可选) 指定生成的视频分辨率档位，不改变视频的宽高比。
- `parameters.duration` (integer, 必填)：视频时长, (可选) 生成视频的时长，单位为秒。该参数的取值依赖于model参数。
- `parameters.prompt_extend` (boolean, 必填)：Prompt智能改写, (可选) 是否开启prompt智能改写。默认值为true。
- `parameters.watermark` (boolean, 必填)：水印标识, (可选) 是否添加“AI生成”水印标识。默认值为false。
- `parameters.audio` (boolean, 必填)：自动添加音频, (可选，仅wan2.5-i2v-preview支持) 控制是否自动为视频添加音频，仅在audio_url为空时生效。
- `parameters.seed` (integer, 必填)：随机数种子, (可选) 固定seed值有助于提升生成结果的可复现性。
- 示例（已脱敏/截断）：
```json
"{\r\n    \"model\": \"wan2.5-i2v-preview\",\r\n    \"input\": {\r\n        \"prompt\": \"改变一下光线\",\r\n        \"img_url\": \"https://brainrot-yt-shorts.oss-cn-beijing.aliyuncs.com/images/cached/55a955b7e41723417281051d7bebdb45.png\"\r\n    },\r\n    \"parameters\": {\r\n        \"resolution\": \"480P\",\r\n        \"prompt_extend\": true,\r\n        // \"duration\": 5,\r\n        \"audio\": true\r\n    }\r\n}"
```

#### 视频查询

- 端点：`GET /alibailian/api/v1/tasks/{task_id}`
- Path 参数：
- `task_id` (string, 必填)


## 绘画模型（help.allapi.store）

> 来源：`https://help.allapi.store/`（自动整理，仅保留与调用相关的参数）

### README

### 图像对象

### Midjourney

#### 上传图片

- 端点：`POST /mj/submit/upload-discord-images`
- 说明：官方文档：https://docs.midjourney.com/hc/en-us/articles/33329380893325-Managing-Image-Uploads
- Header 参数：
- `content-type` (string, 必填)
- `Authorization` (string, 可选)
- Body 参数：
- `base64Array[]` (array<string>, 必填)
- 示例（已脱敏/截断）：
```json
{
  "base64Array": [
    "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAEroAAAbTCAYAAACjv0FTAAAACXBIWXMAAA7EAAAOxAGVKw4bAAAgAElEQVR4nOzca7Bl6XnQ9+dZ+5zuuesyI82MZHl0sW7IWLItS1iWZEu4wBdsMLZSwUBBiipIoJJKFXwgyTdSVJGkiqIqVXxyEnDIhSQYLIcYG2NsGRlsy7YsW9eRrJmRNPfpe/e57b2efNh7n7P2Pmvfzunpnun+/VpLvfda73rfd60zX86H/mcAAABwS7nwmZ/Opjlz55WnPvNQ7V9572B07ftq/8K7o915ZwxHZ6Lqjsp2UE0TbTURFRGZkVGTGTIyM6rG3+c/T1XVzPcjzcy3tiraqNjKiEG0kTmsiNqt5sx+5Zmnqrn7DwaveMNnmrP3/E6Nhp9rRrtPPfDRv7f7IrwaAAAAAAAAAAAAAAAAAADgBuv7F8kAAAC8TF34zD++uw6uvnl47fz7985/5Xvbneff0YzqjVF1X5vt9jhVlTHKJprMyNqPiIiMNqIiKprxiLmA1aahq/HZisgmRu0o2mqjaSKajIhoo6kmos5GRDuKZrBXg60r1eRjeea+T2/l9i/F9p2frbb9yoM/8A/2XoTXBAAAAAAAAAAAAAAAAAAA3CBCVwAAALeAZ//d/3BPO9x5VzM69+HRzqUP7F89964aXX79VsZ2tGcGbTRN5Cgyxr8IVkQ0mVERUVGR1UREGxU5E7paHLNaZrJKVmQ0UdVGZBsVFVWDqGgiMiOzHc8fTTTRtNG2o8i41DSDx2Lr7t+J7bs/cecbP/zrzZ0PfPW+b/mTdT3fFwAAAAAAAAAAAAAAAAAAcGMIXQEAALyMPfWL//U9Z171yLt2nv30D9fO89+3dXD5W9u27h1VbkVWjBtV01/92sjIcdgqMqKaqHFzKqoyIiOaiKiKtUJXi691Q1fjrFZFjc9VRE0uV1XEJHSV2XQmHrVZdTWa7Utbd73ms4NXvvF/H7btr2y94i1P3f+eP79/nV4dAAAAAAAAAAAAAAAAAABwAwhdAQAAvAw9+a/+5p1xcOX1bcWH2uHOj7S7L7xvkAcPZGydqbayDiNXEVERETn+q2PawJqmqDJzEqZa/KtiN261KnSVURGZ46DV5PN4M+PoVVZzuL3DOafXa3Ilm50c3PHZOvPK/zC4/53/qnLwqTvvfuVzr3z3X2o3fWcAAAAAAAAAAAAAAAAAAMCNJ3QFAADwMvP8p376ob2nPvmB3L/wA+3+hW+v9uBtlc092Ww1o1ETERVNVucXvmlEamLyIXMamKrDcZlH4/ssjlt1NUcrZxyGrvIwetU/dnb8ZD9RlTHar6a5Mhrc9bnmnjf86h33vvYX9q48+3uv+xN///KKjQAAAAAAAAAAAAAAAAAAADeZ0BUAAMDLxNO//LfPVG29td279pN1+dEfbIbXHolo72srBm1sZ+RWVLaRMY1cZSz6tW8ak8rMmXDVoohVd/xqzdz3iultx0NXs3ucD11FtJHRRjOIiqjRsI2Lzfa9v1ln7/+Zu77pe37p4NwXvv7aj/zd4RqbAgAAAAAAAAAAAAAAAAAAbgKhKwAAgJe4Z/713xzE2Qe/qd35xkfbK898uN194Ycy4oE2Bk1kRdQgorajiTai2Y+INiIGh7mred3Y1I0OXc2v3xe6iqgYDxmHrsb3NxGxHdVUVbVXIree2br34V+IwZmf2b7vzb+9/cq3Xrrv7T8wX9ECAAAAAAAAAAAAAAAAAABuMqErAACAl7BLX/r5sztf/VdvH+0f/MTw6lN/ajC88qbKeEVVZuUgIiMyBpHRREYbkQdREVE1H5s6sih0tSxiNR+6Wh6+6g9dHZ8j4vDX0sO/5uefTpHRxiByMLnWtpHZPhvbd3xy+/4/+nNnXvPunx9d/sYz97//b4hdAQAAAAAAAAAAAAAAAADAS4jQFQAAwEvUhc/807tGw53v3Pv6r/yVuPbC+0fD4V..."
  ]
}
```

#### 提交Imagine任务

- 端点：`POST /mj/submit/imagine`
- 说明：官方文档：https://docs.midjourney.com/hc/en-us/articles/32023408776205-Prompt-Basics
- Header 参数：
- `Authorization` (string, 可选)
- Body 参数：
- `botType` (string, 必填)，可选：MID_JOURNEY, NIJI_JOURNEY：bot类型，mj(默认)或niji
- `prompt` (string, 必填)：提示词
- `notifyHook` (string, 可选)：回调地址, 为空时使用全局notifyHook


- `state` (string, 可选)：自定义参数
- `base64Array[]` (array<string>, 可选)
- 示例（已脱敏/截断）：
```json
{
  "base64Array": [],
  "notifyHook": "",
  "prompt": "cat",
  "state": "",
  "botType": "MID_JOURNEY"
}
```

#### 根据任务ID 查询任务状态

- 端点：`GET /mj/task/1743326750223591/fetch`
- Header 参数：
- `Authorization` (string, 可选)
- Body 参数：
- `model` (string, 可选)：用于图像生成的模型。
- `prompt` (string, 必填)：所需图像的文本描述。最大长度为 1000 个字符。
- `n` (integer, 可选)：要生成的图像数。必须介于 1 和 10 之间。
- `size` (string, 可选)：生成图像的大小。必须是256x256、512x512或 1024x1024之一。
- `quality` (string, 可选)：将生成的图像的质量。`hd`创建具有更精细细节和更高一致性的图像。此参数仅支持`dall-e-3`.
- `response_format` (string, 可选)：返回生成的图像的格式。必须是 或url之一b64_json。
- `style` (string, 可选)：生成图像的大小。必须是`256x256`、`512x512`或`1024x1024`for之一`dall-e-2`。对于模型来说，必须是`1024x1024`、`1792x1024`、 或之一。`1024x1792``dall-e-3`
- `user` (string, 可选)：生成图像的风格。必须是 或`vivid`之一`natural`。生动使模型倾向于生成超真实和戏剧性的图像。自然使模型生成更自然、不太真实的图像。此参数仅支持`dall-e-3`.

#### 根据ID列表查询任务

- 端点：`POST /mj/task/list-by-condition`
- Header 参数：
- `Authorization` (string, 可选)
- Body 参数：
- `ids[]` (array<string>, 必填)
- 示例（已脱敏/截断）：
```json
{
  "ids": [
    "1743326750223591"
  ]
}
```

#### 获取任务图片的seed

- 端点：`GET /mj/task/{id}/image-seed`
- Header 参数：
- `Authorization` (string, 可选)
- Path 参数：
- `id` (string, 必填)
- Body 参数：
- `model` (string, 可选)：用于图像生成的模型。
- `prompt` (string, 必填)：所需图像的文本描述。最大长度为 1000 个字符。
- `n` (integer, 可选)：要生成的图像数。必须介于 1 和 10 之间。
- `size` (string, 可选)：生成图像的大小。必须是256x256、512x512或 1024x1024之一。
- `quality` (string, 可选)：将生成的图像的质量。`hd`创建具有更精细细节和更高一致性的图像。此参数仅支持`dall-e-3`.
- `response_format` (string, 可选)：返回生成的图像的格式。必须是 或url之一b64_json。
- `style` (string, 可选)：生成图像的大小。必须是`256x256`、`512x512`或`1024x1024`for之一`dall-e-2`。对于模型来说，必须是`1024x1024`、`1792x1024`、 或之一。`1024x1792``dall-e-3`
- `user` (string, 可选)：生成图像的风格。必须是 或`vivid`之一`natural`。生动使模型倾向于生成超真实和戏剧性的图像。自然使模型生成更自然、不太真实的图像。此参数仅支持`dall-e-3`.

#### 执行Action动作

- 端点：`POST /mj/submit/action`
- 说明：官方文档：https://docs.midjourney.com/hc/en-us/articles/32804058614669-Upscalers
- Header 参数：
- `Authorization` (string, 可选)
- Body 参数：
- `chooseSameChannel` (boolean, 必填)：是否选择同一频道下的账号，默认只使用任务关联的账号


- `customId` (string, 可选)：动作标识
- `taskId` (string, 可选)：任务ID
- `notifyHook` (string, 可选)：回调地址, 为空时使用全局notifyHook


- `state` (string, 可选)：自定义参数

- 示例（已脱敏/截断）：
```json
{
  "chooseSameChannel": true,
  "customId": "MJ::JOB::upsample::2::3dbbd469-36af-4a0f-8f02-df6c579e7011",
  "taskId": "14001934816969359",
  "notifyHook": "",
  "state": ""
}
```

#### 提交Blend任务

- 端点：`POST /mj/submit/blend`
- 说明：官方文档：https://docs.midjourney.com/hc/en-us/articles/32635189884557-Blend-Images-on-Discord
- Header 参数：
- `Authorization` (string, 可选)
- Body 参数：
- `quality` (string, 可选)：将生成的图像的质量。`hd`创建具有更精细细节和更高一致性的图像。此参数仅支持`dall-e-3`.
- `botType` (string, 必填)，可选：NIJI_JOURNEY, MID_JOURNEY：bot类型，mj(默认)或niji


- `base64Array` (string, 可选)：图片base64数组


- `dimensions` (string, 可选)，可选：PORTRAIT, SQUARE, LANDSCAPE：比例: PORTRAIT(2:3); SQUARE(1:1); LANDSCAPE(3:2)


- `notifyHook` (string, 可选)：回调地址, 为空时使用全局notifyHook


- `state` (string, 可选)：自定义参数

- 示例（已脱敏/截断）：
```json
{
  "botType": "MID_JOURNEY",
  "base64Array": [
    "data:image/png;base64,xxx1",
    "data:image/png;base64,xxx2"
  ],
  "dimensions": "SQUARE",
  "notifyHook": "",
  "state": ""
}
```

#### 提交Describe任务

- 端点：`POST /mj/submit/describe`
- 说明：官方文档：https://docs.midjourney.com/hc/en-us/articles/32497889043981-Describe
- Header 参数：
- `Authorization` (string, 可选)
- Body 参数：
- `botType` (string, 必填)，可选：MID_JOURNEY, NIJI_JOURNEY：bot类型，mj(默认)或niji


- `base64` (string, 可选)：用于图像生成的模型。
- `notifyHook` (integer, 可选)：要生成的图像数。必须介于 1 和 10 之间。
- `state` (string, 可选)：将生成的图像的质量。`hd`创建具有更精细细节和更高一致性的图像。此参数仅支持`dall-e-3`.
- 示例（已脱敏/截断）：
```json
{
  "botType": "MID_JOURNEY",
  "base64": "<OMITTED>",
  "notifyHook": "",
  "state": ""
}
```

#### 提交Modal

- 端点：`POST /mj/submit/modal`
- Header 参数：
- `Authorization` (string, 可选)
- Body 参数：
- `maskBase64` (string, 必填)：局部重绘的蒙版base64


- `prompt` (string, 可选)：提示词

- `taskId` (integer, 可选)：任务ID

- 示例（已脱敏/截断）：
```json
{
  "maskBase64": "",
  "prompt": "",
  "taskId": "14001934816969359"
}
```

### Ideogram

#### Generate 3.0（文生图）Generate 

- 端点：`POST /ideogram/v1/ideogram-v3/generate`
- 说明：使用 Ideogram 3.0 模型，根据给定的提示和可选参数同步生成图像
具体参数请看官方文档：https://developer.ideogram.ai/api-reference/api-reference/generate-v3
返回的图像 URL 在 24 小时内有效，超过该时间将无法访问图像。
已反代图片
- Header 参数：
- `Content-Type` (string, 必填)
- `Accept` (string, 必填)
- `Authorization` (string, 必填)
- Body 参数：
- `prompt` (string, 必填)：生成图像所需的提示文本
- `seed` (integer, 可选)：随机种子。设置此值可获得可重复的生成结果
- `resolution` (string, 可选)，可选：512x1536, 576x1408, 576x1472, 576x1536, 640x1344, 640x1408, 640x1472, 640x1536, 704x1152, 704x1216, 704x1280, 704x1344, 704x1408, 704x1472, 736x1312, 768x1088, 768x1216, 768x1280, 768x1344, 800x1280, 832x960, 832x1024, 832x1088, 832x1152, 832x1216, 832x1248, 864x1152, 896x960, 896x1024, 896x1088, 896x1120, 896x1152, 960x832, 960x896, 960x1024, 960x1088, 1024x832, 1024x896, 1024x960, 1024x1024, 1088x768, 1088x832, 1088x896, 1088x960, 1120x896, 1152x704, 1152x832, 1152x864, 1152x896, 1216x704, 1216x768, 1216x832, 1248x832, 1280x704, 1280x768, 1280x800, 1312x736, 1344x640, 1344x704, 1344x768, 1408x576, 1408x640, 1408x704, 1472x576, 1472x640, 1472x704, 1536x512, 1536x576, 1536x640：支持的分辨率选项
- `aspect_ratio` (string, 可选)，可选：1x3, 3x1, 1x2, 2x1, 9x16, 16x9, 10x16, 16x10, 2x3, 3x2, 3x4, 4x3, 4x5, 5x4, 1x1：用于图像生成的纵横比，决定图像的分辨率。不能与resolution参数同时使用。默认为1x1
- `rendering_speed` (string, 可选)，可选：TURBO, DEFAULT, QUALITY：渲染速度选项
- `magic_prompt` (string, 可选)，可选：AUTO, ON, OFF：决定是否在生成请求时使用Magic Prompt
- `negative_prompt` (string, 可选)：描述要在图像中排除的内容。提示中的描述优先于负面提示中的描述
- `num_images` (integer, 可选)：要生成的图像数量
- `style_codes[]` (array<string>, 可选)
- `style_type` (string, 可选)，可选：AUTO, GENERAL, REALISTIC, DESIGN：要生成的风格类型
- 示例（已脱敏/截断）：
```json
{
  "prompt": "voluptate reprehenderit",
  "seed": 511526458,
  "rendering_speed": "DEFAULT"
}
```

#### Generate 3.0（图片编辑）Edit

- 端点：`POST /ideogram/v1/ideogram-v3/edit`
- 说明：使用 Ideogram 3.0 模型，根据给定的提示和可选参数同步生成图像
具体参数请看官方文档：https://developer.ideogram.ai/api-reference/api-reference/edit-v3
返回的图像 URL 在 24 小时内有效，超过该时间将无法访问图像。
已反代图片
- Header 参数：
- `Accept` (string, 必填)
- `Authorization` (string, 必填)
- Body 参数：
- `prompt` (string, 必填)：生成图像所需的提示文本
- `seed` (integer, 可选)：随机种子。设置此值可获得可重复的生成结果
- `resolution` (string, 可选)，可选：512x1536, 576x1408, 576x1472, 576x1536, 640x1344, 640x1408, 640x1472, 640x1536, 704x1152, 704x1216, 704x1280, 704x1344, 704x1408, 704x1472, 736x1312, 768x1088, 768x1216, 768x1280, 768x1344, 800x1280, 832x960, 832x1024, 832x1088, 832x1152, 832x1216, 832x1248, 864x1152, 896x960, 896x1024, 896x1088, 896x1120, 896x1152, 960x832, 960x896, 960x1024, 960x1088, 1024x832, 1024x896, 1024x960, 1024x1024, 1088x768, 1088x832, 1088x896, 1088x960, 1120x896, 1152x704, 1152x832, 1152x864, 1152x896, 1216x704, 1216x768, 1216x832, 1248x832, 1280x704, 1280x768, 1280x800, 1312x736, 1344x640, 1344x704, 1344x768, 1408x576, 1408x640, 1408x704, 1472x576, 1472x640, 1472x704, 1536x512, 1536x576, 1536x640：支持的分辨率选项
- `aspect_ratio` (string, 可选)，可选：1x3, 3x1, 1x2, 2x1, 9x16, 16x9, 10x16, 16x10, 2x3, 3x2, 3x4, 4x3, 4x5, 5x4, 1x1：用于图像生成的纵横比，决定图像的分辨率。不能与resolution参数同时使用。默认为1x1
- `rendering_speed` (string, 可选)，可选：TURBO, DEFAULT, QUALITY：渲染速度选项
- `magic_prompt` (string, 可选)，可选：AUTO, ON, OFF：决定是否在生成请求时使用Magic Prompt
- `negative_prompt` (string, 可选)：描述要在图像中排除的内容。提示中的描述优先于负面提示中的描述
- `num_images` (integer, 可选)：要生成的图像数量
- `style_codes[]` (array<string>, 可选)
- `style_type` (string, 可选)，可选：AUTO, GENERAL, REALISTIC, DESIGN：要生成的风格类型

#### Generate 3.0（图片重制）Remix 

- 端点：`POST /ideogram/v1/ideogram-v3/remix`
- 说明：使用 Ideogram 3.0 模型，根据给定的提示和可选参数同步生成图像
具体参数请看官方文档：https://developer.ideogram.ai/api-reference/api-reference/remix-v3
返回的图像 URL 在 24 小时内有效，超过该时间将无法访问图像。
已反代图片
- Header 参数：
- `Accept` (string, 必填)
- `Authorization` (string, 必填)
- Body 参数：
- `prompt` (string, 必填)：生成图像所需的提示文本
- `seed` (integer, 可选)：随机种子。设置此值可获得可重复的生成结果
- `resolution` (string, 可选)，可选：512x1536, 576x1408, 576x1472, 576x1536, 640x1344, 640x1408, 640x1472, 640x1536, 704x1152, 704x1216, 704x1280, 704x1344, 704x1408, 704x1472, 736x1312, 768x1088, 768x1216, 768x1280, 768x1344, 800x1280, 832x960, 832x1024, 832x1088, 832x1152, 832x1216, 832x1248, 864x1152, 896x960, 896x1024, 896x1088, 896x1120, 896x1152, 960x832, 960x896, 960x1024, 960x1088, 1024x832, 1024x896, 1024x960, 1024x1024, 1088x768, 1088x832, 1088x896, 1088x960, 1120x896, 1152x704, 1152x832, 1152x864, 1152x896, 1216x704, 1216x768, 1216x832, 1248x832, 1280x704, 1280x768, 1280x800, 1312x736, 1344x640, 1344x704, 1344x768, 1408x576, 1408x640, 1408x704, 1472x576, 1472x640, 1472x704, 1536x512, 1536x576, 1536x640：支持的分辨率选项
- `aspect_ratio` (string, 可选)，可选：1x3, 3x1, 1x2, 2x1, 9x16, 16x9, 10x16, 16x10, 2x3, 3x2, 3x4, 4x3, 4x5, 5x4, 1x1：用于图像生成的纵横比，决定图像的分辨率。不能与resolution参数同时使用。默认为1x1
- `rendering_speed` (string, 可选)，可选：TURBO, DEFAULT, QUALITY：渲染速度选项
- `magic_prompt` (string, 可选)，可选：AUTO, ON, OFF：决定是否在生成请求时使用Magic Prompt
- `negative_prompt` (string, 可选)：描述要在图像中排除的内容。提示中的描述优先于负面提示中的描述
- `num_images` (integer, 可选)：要生成的图像数量
- `style_codes[]` (array<string>, 可选)
- `style_type` (string, 可选)，可选：AUTO, GENERAL, REALISTIC, DESIGN：要生成的风格类型

#### Generate 3.0（图片重构）Reframe 

- 端点：`POST /ideogram/v1/ideogram-v3/reframe`
- 说明：使用 Ideogram 3.0 模型，根据给定的提示和可选参数同步生成图像
具体参数请看官方文档：https://developer.ideogram.ai/api-reference/api-reference/reframe-v3
返回的图像 URL 在 24 小时内有效，超过该时间将无法访问图像。
已反代图片
- Header 参数：
- `Accept` (string, 必填)
- `Authorization` (string, 必填)
- Body 参数：
- `prompt` (string, 必填)：生成图像所需的提示文本
- `seed` (integer, 可选)：随机种子。设置此值可获得可重复的生成结果
- `resolution` (string, 可选)，可选：512x1536, 576x1408, 576x1472, 576x1536, 640x1344, 640x1408, 640x1472, 640x1536, 704x1152, 704x1216, 704x1280, 704x1344, 704x1408, 704x1472, 736x1312, 768x1088, 768x1216, 768x1280, 768x1344, 800x1280, 832x960, 832x1024, 832x1088, 832x1152, 832x1216, 832x1248, 864x1152, 896x960, 896x1024, 896x1088, 896x1120, 896x1152, 960x832, 960x896, 960x1024, 960x1088, 1024x832, 1024x896, 1024x960, 1024x1024, 1088x768, 1088x832, 1088x896, 1088x960, 1120x896, 1152x704, 1152x832, 1152x864, 1152x896, 1216x704, 1216x768, 1216x832, 1248x832, 1280x704, 1280x768, 1280x800, 1312x736, 1344x640, 1344x704, 1344x768, 1408x576, 1408x640, 1408x704, 1472x576, 1472x640, 1472x704, 1536x512, 1536x576, 1536x640：支持的分辨率选项
- `aspect_ratio` (string, 可选)，可选：1x3, 3x1, 1x2, 2x1, 9x16, 16x9, 10x16, 16x10, 2x3, 3x2, 3x4, 4x3, 4x5, 5x4, 1x1：用于图像生成的纵横比，决定图像的分辨率。不能与resolution参数同时使用。默认为1x1
- `rendering_speed` (string, 可选)，可选：TURBO, DEFAULT, QUALITY：渲染速度选项
- `magic_prompt` (string, 可选)，可选：AUTO, ON, OFF：决定是否在生成请求时使用Magic Prompt
- `negative_prompt` (string, 可选)：描述要在图像中排除的内容。提示中的描述优先于负面提示中的描述
- `num_images` (integer, 可选)：要生成的图像数量
- `style_codes[]` (array<string>, 可选)
- `style_type` (string, 可选)，可选：AUTO, GENERAL, REALISTIC, DESIGN：要生成的风格类型

#### Generate 3.0（替换背景） Replace Background

- 端点：`POST /ideogram/v1/ideogram-v3/replace-background`
- 说明：使用 Ideogram 3.0 模型，根据给定的提示和可选参数同步生成图像
具体参数请看官方文档：https://developer.ideogram.ai/api-reference/api-reference/replace-background-v3
返回的图像 URL 在 24 小时内有效，超过该时间将无法访问图像。
已反代图片
- Header 参数：
- `Accept` (string, 必填)
- `Authorization` (string, 必填)
- Body 参数：
- `prompt` (string, 必填)：生成图像所需的提示文本
- `seed` (integer, 可选)：随机种子。设置此值可获得可重复的生成结果
- `resolution` (string, 可选)，可选：512x1536, 576x1408, 576x1472, 576x1536, 640x1344, 640x1408, 640x1472, 640x1536, 704x1152, 704x1216, 704x1280, 704x1344, 704x1408, 704x1472, 736x1312, 768x1088, 768x1216, 768x1280, 768x1344, 800x1280, 832x960, 832x1024, 832x1088, 832x1152, 832x1216, 832x1248, 864x1152, 896x960, 896x1024, 896x1088, 896x1120, 896x1152, 960x832, 960x896, 960x1024, 960x1088, 1024x832, 1024x896, 1024x960, 1024x1024, 1088x768, 1088x832, 1088x896, 1088x960, 1120x896, 1152x704, 1152x832, 1152x864, 1152x896, 1216x704, 1216x768, 1216x832, 1248x832, 1280x704, 1280x768, 1280x800, 1312x736, 1344x640, 1344x704, 1344x768, 1408x576, 1408x640, 1408x704, 1472x576, 1472x640, 1472x704, 1536x512, 1536x576, 1536x640：支持的分辨率选项
- `aspect_ratio` (string, 可选)，可选：1x3, 3x1, 1x2, 2x1, 9x16, 16x9, 10x16, 16x10, 2x3, 3x2, 3x4, 4x3, 4x5, 5x4, 1x1：用于图像生成的纵横比，决定图像的分辨率。不能与resolution参数同时使用。默认为1x1
- `rendering_speed` (string, 可选)，可选：TURBO, DEFAULT, QUALITY：渲染速度选项
- `magic_prompt` (string, 可选)，可选：AUTO, ON, OFF：决定是否在生成请求时使用Magic Prompt
- `negative_prompt` (string, 可选)：描述要在图像中排除的内容。提示中的描述优先于负面提示中的描述
- `num_images` (integer, 可选)：要生成的图像数量
- `style_codes[]` (array<string>, 可选)
- `style_type` (string, 可选)，可选：AUTO, GENERAL, REALISTIC, DESIGN：要生成的风格类型

#### ideogram（文生图）

- 端点：`POST /ideogram/generate`
- 说明：Generates images synchronously based on a given prompt and optional parameters.
具体参数请看官方文档：https://developer.ideogram.ai/api-reference/api-reference/describe

根据给定的提示和可选参数同步生成图像。
返回的图像 URL 在 24 小时内有效，超过该时间将无法访问图像。
已反代图片
- Header 参数：
- `Content-Type` (string, 必填)
- `Accept` (string, 必填)
- `Authorization` (string, 必填)
- Body 参数：
- `image_request.prompt` (string, 必填)：用于生成图像的提示词 (必填)
- `image_request.aspect_ratio` (string, 必填)：图像宽高比 (可选) 可选值:ASPECT_10_16/ASPECT_16_10/ASPECT_9_16/ASPECT_16_9/ASPECT_3_2/ASPECT_2_3/ASPECT_4_3/ASPECT_3_4/ASPECT_1_1/ASPECT_1_3/ASPECT_3_1
- `image_request.model` (string, 必填)：使用的模型 (可选) 默认V_2,可选值:V_1/V_1_TURBO/V_2/V_2_TURBO
- `image_request.magic_prompt_option` (string, 必填)：是否使用MagicPrompt (可选) 可选值:AUTO/ON/OFF
- `image_request.seed` (integer, 必填)：随机种子 (可选) 范围:0-2147483647
- `image_request.style_type` (string, 必填)：风格类型 (可选) 可选值:AUTO/GENERAL/REALISTIC/DESIGN/RENDER_3D/ANIME
- `image_request.negative_prompt` (string, 必填)：反向提示词 (可选) 描述不想在图像中出现的内容
- `image_request.num_images` (integer, 必填)：生成图片数量 (可选) 范围:1-8,默认1
- `image_request.resolution` (string, 必填)：分辨率 (可选) 可选值包含从512x1536到1536x640等多种分辨率组合
- `image_request.color_palette.name` (string, 必填)：预设调色板名称 (与members二选一) 可选值:EMBER/FRESH/JUNGLE/MAGIC/MELON/MOSAIC/PASTEL/ULTRAMARINE
- 示例（已脱敏/截断）：
```json
{
  "image_request": {
    "aspect_ratio": "ASPECT_10_16",
    "magic_prompt_option": "AUTO",
    "model": "V_1",
    "prompt": "A serene tropical beach scene. Dominating the foreground are tall palm trees with lush green leaves, standing tall against a backdrop of a sandy beach. The beach leads to the azure waters of the sea, which gently kisses the shoreline. In the distance, there is an island or landmass with a silhouette of what appears to be a lighthouse or tower. The sky above is painted with fluffy white clouds, some of which are tinged with hues of pink and orange, suggesting either a sunrise or sunset."
  }
}
```

#### Remix（混合图）

- 端点：`POST /ideogram/remix`
- 说明：官方文档：https://developer.ideogram.ai/api-reference/api-reference/remix
- Header 参数：
- `Content-Type` (string, 必填)
- `Accept` (string, 必填)
- `Authorization` (string, 必填)
- Body 参数：
- `model` (string, 必填)：使用的模型，可选，默认为 kling-image
- `prompt` (string, 必填)：正向提示词，必需，描述你想要生成的图像内容，不能超过500个字符
- `negative_prompt` (string, 必填)：负向提示词，可选，描述你不想在图像中出现的元素，不能超过200个字符
- `image` (string, 必填)：参考图片，可选，支持 Base64 编码或图片 URL，支持 .jpg/.jpeg/.png 格式，大小不能超过 10MB
- `image_fidelity` (number, 必填)：参考图片的影响强度，可选，取值范围：0-1，值越大，生成的图像越接近参考图片
- `n` (integer, 必填)：生成图片的数量，可选，取值范围：1-9
- `aspect_ratio` (string, 必填)：生成图片的纵横比，可选，可选值：16:9, 9:16, 1:1, 4:3, 3:4, 3:2, 2:3
- `callback_url` (string, 必填)：回调通知地址，可选，当任务状态发生变化时，系统会向这个地址发送通知

#### Upscale（放大高清）

- 端点：`POST /ideogram/upscale`
- 说明：官方文档：https://developer.ideogram.ai/api-reference/api-reference/upscale
- Header 参数：
- `Accept` (string, 必填)
- `Authorization` (string, 必填)
- `Content-Type` (string, 可选)
- Body 参数：
- `model` (string, 必填)：使用的模型，可选，默认为 kling-image
- `prompt` (string, 必填)：正向提示词，必需，描述你想要生成的图像内容，不能超过500个字符
- `negative_prompt` (string, 必填)：负向提示词，可选，描述你不想在图像中出现的元素，不能超过200个字符
- `image` (string, 必填)：参考图片，可选，支持 Base64 编码或图片 URL，支持 .jpg/.jpeg/.png 格式，大小不能超过 10MB
- `image_fidelity` (number, 必填)：参考图片的影响强度，可选，取值范围：0-1，值越大，生成的图像越接近参考图片
- `n` (integer, 必填)：生成图片的数量，可选，取值范围：1-9
- `aspect_ratio` (string, 必填)：生成图片的纵横比，可选，可选值：16:9, 9:16, 1:1, 4:3, 3:4, 3:2, 2:3
- `callback_url` (string, 必填)：回调通知地址，可选，当任务状态发生变化时，系统会向这个地址发送通知

#### Describe（描述）

- 端点：`POST /ideogram/describe`
- 说明：官方文档：https://developer.ideogram.ai/api-reference/api-reference/describe
- Header 参数：
- `Content-Type` (string, 必填)
- `Accept` (string, 必填)
- `Authorization` (string, 必填)
- Body 参数：
- `model` (string, 必填)：使用的模型，可选，默认为 kling-image
- `prompt` (string, 必填)：正向提示词，必需，描述你想要生成的图像内容，不能超过500个字符
- `negative_prompt` (string, 必填)：负向提示词，可选，描述你不想在图像中出现的元素，不能超过200个字符
- `image` (string, 必填)：参考图片，可选，支持 Base64 编码或图片 URL，支持 .jpg/.jpeg/.png 格式，大小不能超过 10MB
- `image_fidelity` (number, 必填)：参考图片的影响强度，可选，取值范围：0-1，值越大，生成的图像越接近参考图片
- `n` (integer, 必填)：生成图片的数量，可选，取值范围：1-9
- `aspect_ratio` (string, 必填)：生成图片的纵横比，可选，可选值：16:9, 9:16, 1:1, 4:3, 3:4, 3:2, 2:3
- `callback_url` (string, 必填)：回调通知地址，可选，当任务状态发生变化时，系统会向这个地址发送通知

### GPT Image 系列

#### 创建  gpt-image-1

- 端点：`POST /v1/images/generations`
- 说明：给定一个提示，该模型将返回一个或多个预测的完成，并且还可以返回每个位置的替代标记的概率。

为提供的提示和参数创建完成

官方文档：https://platform.openai.com/docs/api-reference/images/create
- Header 参数：
- `Content-Type` (string, 必填)
- `Accept` (string, 必填)
- `Authorization` (string, 可选)
- Body 参数：
- `prompt` (string, 必填)：所需图像的文本描述。最大长度为 1000 个字符。
- `n` (integer, 必填)：要生成的图像数。必须介于 1 和 10 之间。
- `size` (string, 必填)：生成图像的尺寸。对于 GPT 图像模型，必须是 1024x1024 、 1536x1024 （横版）、 1024x1536 （竖版）或 auto （默认值）之一，对于 dall-e-2 必须是 256x256 、 512x512 或 1024x1024 之一，对于 dall-e-3 必须是 1024x1024 、 1792x1024 或 1024x1792 之一。


- 示例（已脱敏/截断）：
```json
{
  "size": "1024x1536",
  "prompt": "一只可爱的小猪",
  "model": "gpt-image-1",
  "n": 1
}
```

#### 编辑  gpt-image-1

- 端点：`POST /v1/images/edits`
- 说明：给定一个提示，该模型将返回一个或多个预测的完成，并且还可以返回每个位置的替代标记的概率。

为提供的提示和参数创建完成

官方文档：https://platform.openai.com/docs/api-reference/images/createEdit
- Header 参数：
- `Accept` (string, 必填)
- `Authorization` (string, 可选)
- Body 参数：
- `image` (string, 必填)：要编辑的图片。必须是受支持的图片文件或图片数组。对于 gpt-image-1，每张图片应为小于 25MB 的 png、webp 或 jpg 文件。对于 dall-e-2，您只能提供一张图片，并且该图片应为小于 4MB 的方形 png 文件。
- `prompt` (string, 必填)：所需图像的文本描述。dall-e-2 的最大长度为 1000 个字符，gpt-image-1 的最大长度为 32000 个字符。
- `mask` (string, 必填)：一张附加图片，其完全透明区域（例如，alpha 值为零）指示应编辑 image 位置。如果提供了多张图片，则遮罩将应用于第一张图片。必须是有效的 PNG 文件，小于 4MB，且尺寸与 image 相同。
- `model` (string, 必填)：用于生成图像的模型。仅支持 dall-e-2 和 gpt-image-1。除非使用特定于 gpt-image-1 参数，否则默认为 dall-e-2。
- `n` (integer, 必填)：要生成的图像数量。必须介于 1 到 10 之间。
- `quality` (string, 必填)：生成图像的质量。只有 gpt-image-1 支持 high、medium 和 low 质量。dall-e-2 仅支持 standard 质量。默认为 auto。
- `response_format` (string, 必填)：返回生成图像的格式。必须是 url 或 b64_json 之一。URL 在图像生成后 60 分钟内有效。此参数仅适用于 dall-e-2，因为 gpt-image-1 始终返回 base64 编码的图像。
- `size` (string, 必填)：生成图像的尺寸。对于 gpt-image-1，必须为 1024x1024、1536x1024（横向）、1024x1536（纵向）或 auto（默认值）之一；对于 dall-e-2，必须为 256x256、512x512 或 1024x1024 之一。
- 示例（已脱敏/截断）：
```json
{
  "size": "1024x1024",
  "prompt": "一直可爱的小猪",
  "model": "gpt-image-1",
  "n": 1
}
```

#### 蒙版  gpt-image-1

- 端点：`POST /v1/images/edits`
- 说明：给定一个提示，该模型将返回一个或多个预测的完成，并且还可以返回每个位置的替代标记的概率。

为提供的提示和参数创建完成

官方文档：https://platform.openai.com/docs/api-reference/images/createEdit
- Header 参数：
- `Accept` (string, 必填)
- `Authorization` (string, 可选)
- Body 参数：
- `image` (string, 必填)：要编辑的图片。必须是受支持的图片文件或图片数组。对于 gpt-image-1，每张图片应为小于 25MB 的 png、webp 或 jpg 文件。对于 dall-e-2，您只能提供一张图片，并且该图片应为小于 4MB 的方形 png 文件。
- `prompt` (string, 必填)：所需图像的文本描述。dall-e-2 的最大长度为 1000 个字符，gpt-image-1 的最大长度为 32000 个字符。
- `mask` (string, 必填)：一张附加图片，其完全透明区域（例如，alpha 值为零）指示应编辑 image 位置。如果提供了多张图片，则遮罩将应用于第一张图片。必须是有效的 PNG 文件，小于 4MB，且尺寸与 image 相同。
- `model` (string, 必填)：用于生成图像的模型。仅支持 dall-e-2 和 gpt-image-1。除非使用特定于 gpt-image-1 参数，否则默认为 dall-e-2。
- `n` (integer, 必填)：要生成的图像数量。必须介于 1 到 10 之间。
- `quality` (string, 必填)：生成图像的质量。只有 gpt-image-1 支持 high、medium 和 low 质量。dall-e-2 仅支持 standard 质量。默认为 auto。
- `response_format` (string, 必填)：返回生成图像的格式。必须是 url 或 b64_json 之一。URL 在图像生成后 60 分钟内有效。此参数仅适用于 dall-e-2，因为 gpt-image-1 始终返回 base64 编码的图像。
- `size` (string, 必填)：生成图像的尺寸。对于 gpt-image-1，必须为 1024x1024、1536x1024（横向）、1024x1536（纵向）或 auto（默认值）之一；对于 dall-e-2，必须为 256x256、512x512 或 1024x1024 之一。
- 示例（已脱敏/截断）：
```json
{
  "size": "1024x1024",
  "prompt": "一直可爱的小猪",
  "model": "gpt-image-1",
  "n": 1
}
```

#### 创建  gpt-image-1.5

- 端点：`POST /v1/images/generations`
- 说明：给定一个提示，该模型将返回一个或多个预测的完成，并且还可以返回每个位置的替代标记的概率。

为提供的提示和参数创建完成

官方文档：https://platform.openai.com/docs/api-reference/images/create
- Header 参数：
- `Content-Type` (string, 必填)
- `Accept` (string, 必填)
- `Authorization` (string, 可选)
- Body 参数：
- `prompt` (string, 必填)：所需图像的文本描述。最大长度为 1000 个字符。
- `n` (integer, 必填)：要生成的图像数。必须介于 1 和 10 之间。
- `size` (string, 必填)：生成图像的尺寸。对于 GPT 图像模型，必须是 1024x1024 、 1536x1024 （横版）、 1024x1536 （竖版）或 auto （默认值）之一，对于 dall-e-2 必须是 256x256 、 512x512 或 1024x1024 之一，对于 dall-e-3 必须是 1024x1024 、 1792x1024 或 1024x1792 之一。


- 示例（已脱敏/截断）：
```json
{
  "size": "1024x1536",
  "prompt": "a man walks",
  "model": "gpt-image-1.5",
  "n": 1
}
```

#### 编辑  gpt-image-1.5

- 端点：`POST /v1/images/edits`
- 说明：给定一个提示，该模型将返回一个或多个预测的完成，并且还可以返回每个位置的替代标记的概率。

为提供的提示和参数创建完成

官方文档：https://platform.openai.com/docs/api-reference/images/createEdit
- Header 参数：
- `Accept` (string, 必填)
- `Authorization` (string, 可选)
- Body 参数：
- `image` (string, 必填)：要编辑的图片。必须是受支持的图片文件或图片数组。对于 gpt-image-1，每张图片应为小于 25MB 的 png、webp 或 jpg 文件。对于 dall-e-2，您只能提供一张图片，并且该图片应为小于 4MB 的方形 png 文件。
- `prompt` (string, 必填)：所需图像的文本描述。dall-e-2 的最大长度为 1000 个字符，gpt-image-1 的最大长度为 32000 个字符。
- `mask` (string, 必填)：一张附加图片，其完全透明区域（例如，alpha 值为零）指示应编辑 image 位置。如果提供了多张图片，则遮罩将应用于第一张图片。必须是有效的 PNG 文件，小于 4MB，且尺寸与 image 相同。
- `model` (string, 必填)：用于生成图像的模型。仅支持 dall-e-2 和 gpt-image-1。除非使用特定于 gpt-image-1 参数，否则默认为 dall-e-2。
- `n` (integer, 必填)：要生成的图像数量。必须介于 1 到 10 之间。
- `quality` (string, 必填)：生成图像的质量。只有 gpt-image-1 支持 high、medium 和 low 质量。dall-e-2 仅支持 standard 质量。默认为 auto。
- `response_format` (string, 必填)：返回生成图像的格式。必须是 url 或 b64_json 之一。URL 在图像生成后 60 分钟内有效。此参数仅适用于 dall-e-2，因为 gpt-image-1 始终返回 base64 编码的图像。
- `size` (string, 必填)：生成图像的尺寸。对于 gpt-image-1，必须为 1024x1024、1536x1024（横向）、1024x1536（纵向）或 auto（默认值）之一；对于 dall-e-2，必须为 256x256、512x512 或 1024x1024 之一。
- 示例（已脱敏/截断）：
```json
{
  "size": "1024x1024",
  "prompt": "一直可爱的小猪",
  "model": "gpt-image-1",
  "n": 1
}
```

#### 蒙版  gpt-image-1.5

- 端点：`POST /v1/images/edits`
- 说明：给定一个提示，该模型将返回一个或多个预测的完成，并且还可以返回每个位置的替代标记的概率。

为提供的提示和参数创建完成

官方文档：https://platform.openai.com/docs/api-reference/images/createEdit
- Header 参数：
- `Accept` (string, 必填)
- `Authorization` (string, 可选)
- Body 参数：
- `image` (string, 必填)：要编辑的图片。必须是受支持的图片文件或图片数组。对于 gpt-image-1，每张图片应为小于 25MB 的 png、webp 或 jpg 文件。对于 dall-e-2，您只能提供一张图片，并且该图片应为小于 4MB 的方形 png 文件。
- `prompt` (string, 必填)：所需图像的文本描述。dall-e-2 的最大长度为 1000 个字符，gpt-image-1 的最大长度为 32000 个字符。
- `mask` (string, 必填)：一张附加图片，其完全透明区域（例如，alpha 值为零）指示应编辑 image 位置。如果提供了多张图片，则遮罩将应用于第一张图片。必须是有效的 PNG 文件，小于 4MB，且尺寸与 image 相同。
- `model` (string, 必填)：用于生成图像的模型。仅支持 dall-e-2 和 gpt-image-1。除非使用特定于 gpt-image-1 参数，否则默认为 dall-e-2。
- `n` (integer, 必填)：要生成的图像数量。必须介于 1 到 10 之间。
- `quality` (string, 必填)：生成图像的质量。只有 gpt-image-1 支持 high、medium 和 low 质量。dall-e-2 仅支持 standard 质量。默认为 auto。
- `response_format` (string, 必填)：返回生成图像的格式。必须是 url 或 b64_json 之一。URL 在图像生成后 60 分钟内有效。此参数仅适用于 dall-e-2，因为 gpt-image-1 始终返回 base64 编码的图像。
- `size` (string, 必填)：生成图像的尺寸。对于 gpt-image-1，必须为 1024x1024、1536x1024（横向）、1024x1536（纵向）或 auto（默认值）之一；对于 dall-e-2，必须为 256x256、512x512 或 1024x1024 之一。
- 示例（已脱敏/截断）：
```json
{
  "size": "1024x1024",
  "prompt": "一直可爱的小猪",
  "model": "gpt-image-1",
  "n": 1
}
```

### 即梦绘画

#### 创建绘画

- 端点：`POST /v1/images/generations`
- 说明：给定一个提示，该模型将返回一个或多个预测的完成，并且还可以返回每个位置的替代标记的概率。

为提供的提示和参数创建完成

官方文档：https://platform.openai.com/docs/api-reference/images/create
- Header 参数：
- `Content-Type` (string, 必填)
- `Accept` (string, 必填)
- `Authorization` (string, 可选)
- Body 参数：
- `prompt` (string, 必填)：所需图像的文本描述。最大长度为 1000 个字符。
- `size` (string, 必填)：生成图像的大小。必须是256x256、512x512或 1024x1024之一。
- 示例（已脱敏/截断）：
```json
{
  "size": "2:3",
  "prompt": "一只可爱的小猪",
  "model": "jimeng-4.0"
}
```

#### 编辑图片

- 端点：`POST /v1/images/edits`
- 说明：给定一个提示，该模型将返回一个或多个预测的完成，并且还可以返回每个位置的替代标记的概率。

为提供的提示和参数创建完成

官方文档：https://platform.openai.com/docs/api-reference/images/createEdit
- Header 参数：
- `Accept` (string, 必填)
- `Authorization` (string, 可选)
- Body 参数：
- `image` (string, 必填)：要编辑的图片。必须是受支持的图片文件或图片数组。对于 gpt-image-1，每张图片应为小于 25MB 的 png、webp 或 jpg 文件。对于 dall-e-2，您只能提供一张图片，并且该图片应为小于 4MB 的方形 png 文件。
- `prompt` (string, 必填)：所需图像的文本描述。dall-e-2 的最大长度为 1000 个字符，gpt-image-1 的最大长度为 32000 个字符。
- `mask` (string, 必填)：一张附加图片，其完全透明区域（例如，alpha 值为零）指示应编辑 image 位置。如果提供了多张图片，则遮罩将应用于第一张图片。必须是有效的 PNG 文件，小于 4MB，且尺寸与 image 相同。
- `model` (string, 必填)：用于生成图像的模型。仅支持 dall-e-2 和 gpt-image-1。除非使用特定于 gpt-image-1 参数，否则默认为 dall-e-2。
- `n` (integer, 必填)：要生成的图像数量。必须介于 1 到 10 之间。
- `quality` (string, 必填)：生成图像的质量。只有 gpt-image-1 支持 high、medium 和 low 质量。dall-e-2 仅支持 standard 质量。默认为 auto。
- `response_format` (string, 必填)：返回生成图像的格式。必须是 url 或 b64_json 之一。URL 在图像生成后 60 分钟内有效。此参数仅适用于 dall-e-2，因为 gpt-image-1 始终返回 base64 编码的图像。
- `size` (string, 必填)：生成图像的尺寸。对于 gpt-image-1，必须为 1024x1024、1536x1024（横向）、1024x1536（纵向）或 auto（默认值）之一；对于 dall-e-2，必须为 256x256、512x512 或 1024x1024 之一。
- 示例（已脱敏/截断）：
```json
{
  "size": "1024x1024",
  "prompt": "一直可爱的小猪",
  "model": "gpt-image-1",
  "n": 1
}
```

### DALL·E 3

#### 创建 DALL·E 3

- 端点：`POST /v1/images/generations`
- 说明：[图片](https://platform.openai.com/docs/api-reference/images)

给定提示和/或输入图像，模型将生成新图像。

相关指南：[图像生成](https://platform.openai.com/docs/guides/images)

根据提示创建图像。
- Header 参数：
- `Authorization` (string, 可选)
- Body 参数：
- `model` (string, 可选)：用于图像生成的模型。
- `prompt` (string, 必填)：所需图像的文本描述。最大长度为 1000 个字符。
- `n` (integer, 可选)：要生成的图像数。必须介于 1 和 10 之间。
- `size` (string, 可选)：生成图像的大小。必须是 1024x1024 、 1536x1024 （横向）、 1024x1536 （纵向）或 auto （默认值）中的一个，适用于 gpt-image-1 ；是 256x256 、 512x512 或 1024x1024 中的一个，适用于 dall-e-2 ；以及是 1024x1024 、 1792x1024 或 1024x1792 中的一个，适用于 dall-e-3 。


- `quality` (string, 可选)：将生成的图像的质量。`hd`创建具有更精细细节和更高一致性的图像。此参数仅支持`dall-e-3`.
- `response_format` (string, 可选)：返回生成的图像的格式。必须是 或url之一b64_json。
- `style` (string, 可选)：生成图像的风格。此参数仅支持 dall-e-3 。必须是 vivid 或 natural 之一。生动会使模型倾向于生成超现实和戏剧性的图像。自然则使模型生成更自然、看起来不那么超现实的图像。


- `user` (string, 可选)：一个唯一的标识符，代表您的最终用户，这可以帮助 OpenAI 监控和检测滥用行为。
- 示例（已脱敏/截断）：
```json
{
  "model": "dall-e-3",
  "prompt": "A cute baby sea otter",
  "n": 1,
  "size": "1024x1024"
}
```

### FLUX 系列

#### Flux 创建（OpenAI dall-e-3格式）

- 端点：`POST /v1/images/generations`
- 说明：[图片](https://platform.openai.com/docs/api-reference/images)

给定提示和/或输入图像，模型将生成新图像。

相关指南：[图像生成](https://platform.openai.com/docs/guides/images)

根据提示创建图像。
- Header 参数：
- `Authorization` (string, 可选)
- Body 参数：
- `model` (string, 可选)：用于图像生成的模型。
- `prompt` (string, 必填)：所需图像的文本描述。最大长度为 1000 个字符。
- `n` (integer, 可选)：要生成的图像数。必须介于 1 和 10 之间。
- `size` (string, 可选)：生成图像的大小。必须是256x256、512x512或 1024x1024之一。
- `quality` (string, 可选)：将生成的图像的质量。`hd`创建具有更精细细节和更高一致性的图像。此参数仅支持`dall-e-3`.
- `response_format` (string, 可选)：返回生成的图像的格式。必须是 或url之一b64_json。
- `style` (string, 可选)：风格
- `user` (string, 可选)：生成图像的风格。必须是 或`vivid`之一`natural`。生动使模型倾向于生成超真实和戏剧性的图像。自然使模型生成更自然、不太真实的图像。此参数仅支持`dall-e-3`.
- `aspect_ratio` (string, 必填)：图片比例:  枚举值Possible enum values: 21:9, 16:9, 4:3, 3:2, 1:1, 2:3, 3:4, 9:16, 9:21
- 示例（已脱敏/截断）：
```json
"{\n  \"model\": \"flux-kontext-pro\",\n  \"prompt\": \"a beautiful landscape with a river and mountains\",\n // \"size\": \"1024x1524\",\n  \"n\": 1,\n  \"aspect_ratio\": \"21:9\"\n}"
```

#### Flux编辑（OpenAI dall-e-3格式）

- 端点：`POST /v1/images/edits`
- 说明：给定一个提示，该模型将返回一个或多个预测的完成，并且还可以返回每个位置的替代标记的概率。

为提供的提示和参数创建完成

官方文档：https://platform.openai.com/docs/api-reference/images/createEdit
- Header 参数：
- `Accept` (string, 必填)
- `Authorization` (string, 可选)
- Body 参数：
- `image` (string, 必填)：要编辑的图片。必须是受支持的图片文件或图片数组。对于 gpt-image-1，每张图片应为小于 25MB 的 png、webp 或 jpg 文件。对于 dall-e-2，您只能提供一张图片，并且该图片应为小于 4MB 的方形 png 文件。
- `prompt` (string, 必填)：所需图像的文本描述。dall-e-2 的最大长度为 1000 个字符，gpt-image-1 的最大长度为 32000 个字符。
- `mask` (string, 必填)：一张附加图片，其完全透明区域（例如，alpha 值为零）指示应编辑 image 位置。如果提供了多张图片，则遮罩将应用于第一张图片。必须是有效的 PNG 文件，小于 4MB，且尺寸与 image 相同。
- `model` (string, 必填)：用于生成图像的模型。仅支持 dall-e-2 和 gpt-image-1。除非使用特定于 gpt-image-1 参数，否则默认为 dall-e-2。
- `n` (integer, 必填)：要生成的图像数量。必须介于 1 到 10 之间。
- `quality` (string, 必填)：生成图像的质量。只有 gpt-image-1 支持 high、medium 和 low 质量。dall-e-2 仅支持 standard 质量。默认为 auto。
- `response_format` (string, 必填)：返回生成图像的格式。必须是 url 或 b64_json 之一。URL 在图像生成后 60 分钟内有效。此参数仅适用于 dall-e-2，因为 gpt-image-1 始终返回 base64 编码的图像。
- `size` (string, 必填)：生成图像的尺寸。对于 gpt-image-1，必须为 1024x1024、1536x1024（横向）、1024x1536（纵向）或 auto（默认值）之一；对于 dall-e-2，必须为 256x256、512x512 或 1024x1024 之一。
- 示例（已脱敏/截断）：
```json
{
  "size": "1024x1024",
  "prompt": "一直可爱的小猪",
  "model": "gpt-image-1",
  "n": 1
}
```

#### 创建任务 black-forest-labs/flux-kontext-dev

- 端点：`POST /replicate/v1/models/black-forest-labs/flux-kontext-dev/predictions`
- 说明：官方文档: https://replicate.com/black-forest-labs/flux-kontext-dev
- Header 参数：
- `Authorization` (string, 可选)
- Body 参数：
- `input.prompt` (string, 必填)：您想要生成的内容的文本描述，或有关如何编辑给定图像的说明。
- `input.go_fast` (boolean, 可选)：使模型运行速度更快，对于更困难的提示，输出质量可能会略有下降。默认值：true。
- `input.guidance` (number, 可选)：提示词引导强度。默认值: 2.5。最小值：0，最大值：10
- `input.input_image` (string, 必填)：用作参考的图片。必须是 jpeg、png、gif 或 webp 格式。
- `input.aspect_ratio` (string, 可选)：生成图像的长宽比。使用“match_input_image”来匹配输入图像的长宽比。默认值：“match_input_image”。
- `input.output_format` (string, 可选)：输出图像格式。默认值：“webp”。
- `input.output_quality` (integer, 可选)：保存输出图像时的质量，范围为 0 至 100。100 为最佳质量，0 为最低质量。与 .png 输出无关。默认值：80。最小值：0，最大值：100。
- `input.num_inference_steps` (integer, 可选)：推理步骤数，默认值：28。最小值：4，最大值：50。
- 示例（已脱敏/截断）：
```json
{
  "input": {
    "prompt": "Change the car color to red, turn the headlights on",
    "go_fast": true,
    "guidance": 2.5,
    "input_image": "https://replicate.delivery/pbxt/N5YURZv4ifaW2bMwU7hmrwzgtxf99DTQXpBeobLt1O7dEc3h/pexels-jmark-253096.jpg",
    "aspect_ratio": "match_input_image",
    "output_format": "jpg",
    "output_quality": 80,
    "num_inference_steps": 30
  }
}
```

#### 查询任务

- 端点：`GET /replicate/v1/predictions/{任务id}`
- 说明：官方文档: https://replicate.com/black-forest-labs/flux-kontext-max
- Header 参数：
- `Authorization` (string, 可选)
- Path 参数：
- `任务id` (string, 必填)
- Body 参数：
- `model` (string, 可选)：用于图像生成的模型。
- `prompt` (string, 必填)：所需图像的文本描述。最大长度为 1000 个字符。
- `n` (integer, 可选)：要生成的图像数。必须介于 1 和 10 之间。
- `size` (string, 可选)：生成图像的大小。必须是256x256、512x512或 1024x1024之一。
- `quality` (string, 可选)：将生成的图像的质量。`hd`创建具有更精细细节和更高一致性的图像。此参数仅支持`dall-e-3`.
- `response_format` (string, 可选)：返回生成的图像的格式。必须是 或url之一b64_json。
- `style` (string, 可选)：风格
- `user` (string, 可选)：生成图像的风格。必须是 或`vivid`之一`natural`。生动使模型倾向于生成超真实和戏剧性的图像。自然使模型生成更自然、不太真实的图像。此参数仅支持`dall-e-3`.
- `aspect_ratio` (string, 必填)：图片比例:  枚举值Possible enum values: 21:9, 16:9, 4:3, 3:2, 1:1, 2:3, 3:4, 9:16, 9:21

### 豆包系列

#### doubao-seedream-3-0-t2i-250415

- 端点：`POST /v1/images/generations`
- 说明：给定提示和/或输入图像，模型将生成新图像。

相关指南：[图像生成](https://www.volcengine.com/docs/82379/1541523)

根据提示创建图像。
- Header 参数：
- `Authorization` (string, 可选)
- Body 参数：
- `model` (string, 必填)：本次请求使用模型的 Model ID。
- `prompt` (string, 必填)：用于生成图像的提示词。
- `response_format` (string, 可选)：指定生成图像的返回格式。支持以下两种取值：
"url"：以可下载的 JPEG 图片链接形式返回；
"b64_json"：以 Base64 编码字符串的 JSON 格式返回图像数据。
默认值 url
- `size` (string, 可选)：生成图像的宽高像素，要求介于 [512 x 512, 2048 x 2048] 之间。
推荐可选的宽高：
1024x1024 （1:1）
864x1152 （3:4）
1152x864 （4:3）
1280x720 （16:9）
720x1280 （9:16）
832x1248 （2:3）
1248x832 （3:2）
1512x648 （21:9）
默认值 1024x1024
- `seed` (integer, 可选)：随机数种子，用于控制模型生成内容的随机性。取值范围为 [-1, 2147483647]。如果不提供，则算法自动生成一个随机数作为种子。如果希望生成内容保持一致，可以使用相同的 seed 参数值。
默认值 -1
- `guidance_scale` (number, 可选)：模型输出结果与prompt的一致程度，即生成图像的自由度；值越大，模型自由度越小，与用户输入的提示词相关性越强。取值范围：[1, 10] 之间的浮点数。
默认值 2.5
- `watermark` (boolean, 可选)：是否在生成的图片中添加水印。
false：不添加水印。
true：在图片右下角添加“AI生成”字样的水印标识。
默认值 true
- 示例（已脱敏/截断）：
```json
{
  "model": "doubao-seedream-3-0-t2i-250415",
  "prompt": "鱼眼镜头，一只猫咪的头部，画面呈现出猫咪的五官因为拍摄方式扭曲的效果。",
  "response_format": "url",
  "size": "1024x1024",
  "seed": 12,
  "guidance_scale": 2.5,
  "watermark": true
}
```

#### doubao-seededit-3-0-i2i-250628

- 端点：`POST /v1/images/generations`
- 说明：给定提示和/或输入图像，模型将生成新图像。

相关指南：[图像生成](https://www.volcengine.com/docs/82379/1666946)

根据提示创建图像。
- Header 参数：
- `Authorization` (string, 可选)
- Body 参数：
- `model` (string, 必填)：您需要调用的模型的 ID。
- `prompt` (string, 必填)：文本描述，用于编辑图像的提示词。
- `image` (string, 必填)：需要编辑的图像，输入图片的 Base64 编码或可访问的 URL。
图片URL：请确保图片URL可被访问。
Base64编码：请遵循此格式data:image/<图片格式>;base64,<Base64编码>。注意 <图片格式> 需小写，如 data:image/png;base64,<base64_image>。
说明
传入图片需要满足以下条件：
图片格式：jpeg、png。
宽高比（宽/高）：在范围 (1/3, 3) 。
宽高长度（px） > 14。
大小：不超过 10MB。
- `response_format` (string, 可选)：指定生成图像的返回格式。支持以下两种取值：
url：以可下载的 jpeg 图片链接形式返回。
b64_json：以 Base64 编码字符串的 JSON 格式返回图像数据。
默认值 url
- `size` (string, 可选)：生成图像的宽高像素。当前仅支持 adaptive。
adaptive。将您的输入图片尺寸与下表中的尺寸进行对比，选择最接近的，作为输出图片的尺寸。具体而言，会按顺序从可选比例中，选取与原图宽高比差值最小的第一个，作为生成图片的比例。
- `seed` (integer, 可选)：随机数种子，用于控制模型生成内容的随机性。取值范围为 [-1, 2^31-1]，即 [-1, 2147483647] 之间的整数。如果不提供，则算法自动生成一个随机数作为种子。如果希望生成内容保持一致，可以使用相同的 seed 参数值。
默认值 -1
- `guidance_scale` (number, 可选)：文本描述和输入图片对生成图像的影响程度。取值范围：[1, 10] 之间的浮点数。该值越大代表文本描述影响程度越大，且输入图片影响程度越小。
默认值 5.5
- `watermark` (boolean, 可选)：是否在生成的图片中添加水印。
false：不添加水印。
true：在图片右下角添加“AI生成”字样的水印标识。
默认值 true
- 示例（已脱敏/截断）：
```json
{
  "model": "doubao-seededit-3-0-i2i-250628",
  "prompt": "改成爱心形状的泡泡",
  "image": "https://ark-project.tos-cn-beijing.volces.com/doc_image/seedream_i2i.jpeg",
  "response_format": "url",
  "size": "adaptive",
  "seed": 21,
  "guidance_scale": 5.5,
  "watermark": true
}
```

#### doubao-seedream-4-0-250828-文生图

- 端点：`POST /v1/images/generations`
- 说明：给定提示和/或输入图像，模型将生成新图像。

相关指南：[图像生成](https://www.volcengine.com/docs/82379/1666946)

根据提示创建图像。
- Header 参数：
- `Authorization` (string, 可选)
- Body 参数：
- `model` (string, 必填)：本次请求使用模型的 Model ID。
- `prompt` (string, 必填)：用于生成图像的提示词，支持中英文。
- `size` (string, 可选)：指定生成图像的尺寸信息，支持以下两种方式，不可混用。
方式1 |指定生成图像的分辨率，可选值：1K、2K、4K
方式2 |指定生成图像的宽高像素值：默认值：2048x2048
面积取值范围：[1024x1024, 4096x4096] 
宽高比取值范围：[1/16, 16]
- `sequential_image_generation` (string, 可选)：控制是否关闭组图功能。默认值 disabled
取值范围：
auto：自动判断模式，模型会根据用户提供的提示词自主判断是否返回组图以及组图包含的图片数量。
disabled：关闭组图功能，模型只会生成一张图。
- `stream` (boolean, 可选)：控制是否开启流式输出模式。默认值 false
- `response_format` (string, 可选)：指定生成图像的返回格式。默认值 url
生成的图片为 jpeg 格式，支持以下两种返回方式：
url：返回图片下载链接；链接在图片生成后24小时内有效，请及时下载图片。
b64_json：以 Base64 编码字符串的 JSON 格式返回图像数据。
- `watermark` (boolean, 可选)：是否在生成的图片中添加水印。默认值 true
false：不添加水印。
true：在图片右下角添加“AI生成”字样的水印标识。
- 示例（已脱敏/截断）：
```json
{
  "model": "doubao-seedream-4-0-250828",
  "prompt": "星际穿越，黑洞，黑洞里冲出一辆快支离破碎的复古列车，抢视觉冲击力，电影大片，末日既视感，动感，对比色，oc渲染，光线追踪，动态模糊，景深，超现实主义，深蓝，画面通过细腻的丰富的色彩层次塑造主体与场景，质感真实，暗黑风背景的光影效果营造出氛围，整体兼具艺术幻想感，夸张的广角透视效果，耀光，反射，极致的光影，强引力，吞噬",
  "size": "1728x2304",
  "sequential_image_generation": "disabled",
  "stream": false,
  "response_format": "url",
  "watermark": true
}
```

#### doubao-seedream-4-0-250828-图生图

- 端点：`POST /v1/images/generations`
- 说明：给定提示和/或输入图像，模型将生成新图像。

相关指南：[图像生成](https://www.volcengine.com/docs/82379/1666946)

根据提示创建图像。
- Header 参数：
- `Authorization` (string, 可选)
- Body 参数：
- `model` (string, 必填)：本次请求使用模型的 Model ID。
- `prompt` (string, 必填)：用于生成图像的提示词，支持中英文。
建议不超过300个汉字或600个英文单词。字数过多信息容易分散，模型可能因此忽略细节，只关注重点，造成视图片缺失部分元素。
- `image` (string, 可选)：输入的图片信息，支持 URL 或 Base64 编码。doubao-seedream-4.0 支持单图或多图输入。
图片URL：请确保图片URL可被访问。
Base64编码：请遵循此格式data:image/<图片格式>;base64,<Base64编码>。注意 <图片格式> 需小写，如 data:image/png;base64,<base64_image>。
- `size` (string, 可选)：指定生成图像的尺寸信息，支持以下两种方式，不可混用。
方式1 |指定生成图像的分辨率，可选值：1K、2K、4K
方式2 |指定生成图像的宽高像素值：默认值：2048x2048
面积取值范围：[1024x1024, 4096x4096] 
宽高比取值范围：[1/16, 16]
- `sequential_image_generation` (string, 可选)：控制是否关闭组图功能。默认值 disabled
取值范围：
auto：自动判断模式，模型会根据用户提供的提示词自主判断是否返回组图以及组图包含的图片数量。
disabled：关闭组图功能，模型只会生成一张图。
- `stream` (boolean, 可选)：控制是否开启流式输出模式。默认值 false
- `response_format` (string, 可选)：指定生成图像的返回格式。默认值 url
生成的图片为 jpeg 格式，支持以下两种返回方式：
url：返回图片下载链接；链接在图片生成后24小时内有效，请及时下载图片。
b64_json：以 Base64 编码字符串的 JSON 格式返回图像数据。
- `watermark` (boolean, 可选)：是否在生成的图片中添加水印。默认值 true
false：不添加水印。
true：在图片右下角添加“AI生成”字样的水印标识。
- 示例（已脱敏/截断）：
```json
{
  "model": "doubao-seedream-4-0-250828",
  "prompt": "生成狗狗趴在草地上的近景画面",
  "image": "https://ark-project.tos-cn-beijing.volces.com/doc_image/seedream4_imageToimage.png",
  "size": "1728x2304",
  "sequential_image_generation": "disabled",
  "stream": false,
  "response_format": "url",
  "watermark": false
}
```

#### doubao-seedream-4-0-250828-多图生图 

- 端点：`POST /v1/images/generations`
- 说明：给定提示和/或输入图像，模型将生成新图像。

相关指南：[图像生成](https://www.volcengine.com/docs/82379/1666946)

根据提示创建图像。
- Header 参数：
- `Authorization` (string, 可选)
- Body 参数：
- `model` (string, 必填)：本次请求使用模型的 Model ID。
- `prompt` (string, 必填)：用于生成图像的提示词，支持中英文。
建议不超过300个汉字或600个英文单词。字数过多信息容易分散，模型可能因此忽略细节，只关注重点，造成视图片缺失部分元素。
- `image[]` (array<string>, 可选)
- `sequential_image_generation` (string, 可选)：控制是否关闭组图功能。默认值 disabled
取值范围：
auto：自动判断模式，模型会根据用户提供的提示词自主判断是否返回组图以及组图包含的图片数量。
disabled：关闭组图功能，模型只会生成一张图。
- `sequential_image_generation_options.max_images` (integer, 可选)：指定本次请求，最多可生成的图片数量。默认值 15
取值范围： [1, 15]
- `response_format` (string, 可选)：指定生成图像的返回格式。默认值 url
生成的图片为 jpeg 格式，支持以下两种返回方式：
url：返回图片下载链接；链接在图片生成后24小时内有效，请及时下载图片。
b64_json：以 Base64 编码字符串的 JSON 格式返回图像数据。
- `size` (string, 可选)：指定生成图像的尺寸信息，支持以下两种方式，不可混用。
方式1 |指定生成图像的分辨率，可选值：1K、2K、4K
方式2 |指定生成图像的宽高像素值：默认值：2048x2048
面积取值范围：[1024x1024, 4096x4096] 
宽高比取值范围：[1/16, 16]
- `stream` (boolean, 可选)：控制是否开启流式输出模式。默认值 false
- `watermark` (boolean, 可选)：是否在生成的图片中添加水印。默认值 true
false：不添加水印。
true：在图片右下角添加“AI生成”字样的水印标识。
- 示例（已脱敏/截断）：
```json
{
  "model": "doubao-seedream-4-0-250828",
  "prompt": "生成3张女孩和奶牛玩偶在游乐园开心地坐过山车的图片，涵盖早晨、中午、晚上",
  "image": [
    "https://ark-project.tos-cn-beijing.volces.com/doc_image/seedream4_imagesToimages_1.png",
    "https://ark-project.tos-cn-beijing.volces.com/doc_image/seedream4_imagesToimages_2.png"
  ],
  "sequential_image_generation": "auto",
  "sequential_image_generation_options": {
    "max_images": 3
  },
  "size": "2K",
  "watermark": false
}
```

#### doubao-seedream-4-5-251128 文生图（纯文本输入单图输出）

- 端点：`POST /v1/images/generations`
- 说明：给定提示和/或输入图像，模型将生成新图像。

相关指南：[图像生成](https://www.volcengine.com/docs/82379/1666946)

根据提示创建图像。
- Header 参数：
- `Authorization` (string, 可选)
- Body 参数：
- `model` (string, 必填)：本次请求使用模型的 Model ID。
- `prompt` (string, 必填)：用于生成图像的提示词，支持中英文。
- `size` (string, 可选)：指定生成图像的尺寸信息，支持以下两种方式，不可混用。
方式1 |指定生成图像的分辨率，可选值：1K、2K、4K
方式2 |指定生成图像的宽高像素值：默认值：2048x2048
面积取值范围：[1024x1024, 4096x4096] 
宽高比取值范围：[1/16, 16]
- `sequential_image_generation` (string, 可选)：控制是否关闭组图功能。默认值 disabled
取值范围：
auto：自动判断模式，模型会根据用户提供的提示词自主判断是否返回组图以及组图包含的图片数量。
disabled：关闭组图功能，模型只会生成一张图。
- `stream` (boolean, 可选)：控制是否开启流式输出模式。默认值 false
- `response_format` (string, 可选)：指定生成图像的返回格式。默认值 url
生成的图片为 jpeg 格式，支持以下两种返回方式：
url：返回图片下载链接；链接在图片生成后24小时内有效，请及时下载图片。
b64_json：以 Base64 编码字符串的 JSON 格式返回图像数据。
- `watermark` (boolean, 可选)：是否在生成的图片中添加水印。默认值 true
false：不添加水印。
true：在图片右下角添加“AI生成”字样的水印标识。
- 示例（已脱敏/截断）：
```json
{
  "model": "doubao-seedream-4-5-251128",
  "prompt": "移除图片中的帽子",
  "image": [
    "https://ark-project.tos-cn-beijing.volces.com/doc_image/seedream4_5_imagesToimage_2.png"
  ],
  "sequential_image_generation": "disabled",
  "size": "2K",
  "watermark": false
}
```

#### doubao-seedream-4-5-251128  图文生图（单图输入单图输出）

- 端点：`POST /v1/images/generations`
- 说明：给定提示和/或输入图像，模型将生成新图像。

相关指南：[图像生成](https://www.volcengine.com/docs/82379/1666946)

根据提示创建图像。
- Header 参数：
- `Authorization` (string, 可选)
- Body 参数：
- `model` (string, 必填)：本次请求使用模型的 Model ID。
- `prompt` (string, 必填)：用于生成图像的提示词，支持中英文。
- `size` (string, 可选)：指定生成图像的尺寸信息，支持以下两种方式，不可混用。
方式1 |指定生成图像的分辨率，可选值：1K、2K、4K
方式2 |指定生成图像的宽高像素值：默认值：2048x2048
面积取值范围：[1024x1024, 4096x4096] 
宽高比取值范围：[1/16, 16]
- `sequential_image_generation` (string, 可选)：控制是否关闭组图功能。默认值 disabled
取值范围：
auto：自动判断模式，模型会根据用户提供的提示词自主判断是否返回组图以及组图包含的图片数量。
disabled：关闭组图功能，模型只会生成一张图。
- `stream` (boolean, 可选)：控制是否开启流式输出模式。默认值 false
- `response_format` (string, 可选)：指定生成图像的返回格式。默认值 url
生成的图片为 jpeg 格式，支持以下两种返回方式：
url：返回图片下载链接；链接在图片生成后24小时内有效，请及时下载图片。
b64_json：以 Base64 编码字符串的 JSON 格式返回图像数据。
- `watermark` (boolean, 可选)：是否在生成的图片中添加水印。默认值 true
false：不添加水印。
true：在图片右下角添加“AI生成”字样的水印标识。
- 示例（已脱敏/截断）：
```json
{
  "model": "doubao-seedream-4-5-251128",
  "prompt": "保持模特姿势和液态服装的流动形状不变。将服装材质从银色金属改为完全透明的清水（或玻璃）。透过液态水流，可以看到模特的皮肤细节。光影从反射变为折射。",
  "image": "https://ark-project.tos-cn-beijing.volces.com/doc_image/seedream4_5_imageToimage.png",
  "size": "2K",
  "watermark": false
}
```

#### doubao-seedream-4-5-251128  多图融合（多图输入单图输出）

- 端点：`POST /v1/images/generations`
- 说明：给定提示和/或输入图像，模型将生成新图像。

相关指南：[图像生成](https://www.volcengine.com/docs/82379/1666946)

根据提示创建图像。
- Header 参数：
- `Authorization` (string, 可选)
- Body 参数：
- `model` (string, 必填)：本次请求使用模型的 Model ID。
- `prompt` (string, 必填)：用于生成图像的提示词，支持中英文。
- `size` (string, 可选)：指定生成图像的尺寸信息，支持以下两种方式，不可混用。
方式1 |指定生成图像的分辨率，可选值：1K、2K、4K
方式2 |指定生成图像的宽高像素值：默认值：2048x2048
面积取值范围：[1024x1024, 4096x4096] 
宽高比取值范围：[1/16, 16]
- `sequential_image_generation` (string, 可选)：控制是否关闭组图功能。默认值 disabled
取值范围：
auto：自动判断模式，模型会根据用户提供的提示词自主判断是否返回组图以及组图包含的图片数量。
disabled：关闭组图功能，模型只会生成一张图。
- `stream` (boolean, 可选)：控制是否开启流式输出模式。默认值 false
- `response_format` (string, 可选)：指定生成图像的返回格式。默认值 url
生成的图片为 jpeg 格式，支持以下两种返回方式：
url：返回图片下载链接；链接在图片生成后24小时内有效，请及时下载图片。
b64_json：以 Base64 编码字符串的 JSON 格式返回图像数据。
- `watermark` (boolean, 可选)：是否在生成的图片中添加水印。默认值 true
false：不添加水印。
true：在图片右下角添加“AI生成”字样的水印标识。
- 示例（已脱敏/截断）：
```json
{
  "model": "doubao-seedream-4-5-251128",
  "prompt": "将图1的服装换为图2的服装",
  "image": [
    "https://ark-project.tos-cn-beijing.volces.com/doc_image/seedream4_imagesToimage_1.png",
    "https://ark-project.tos-cn-beijing.volces.com/doc_image/seedream4_5_imagesToimage_2.png"
  ],
  "sequential_image_generation": "disabled",
  "size": "2K",
  "watermark": false
}
```

#### doubao-seedream-4-5-251128  组图输出（多图输出）

- 端点：`POST /v1/images/generations`
- 说明：给定提示和/或输入图像，模型将生成新图像。

相关指南：[图像生成](https://www.volcengine.com/docs/82379/1666946)

根据提示创建图像。
- Header 参数：
- `Authorization` (string, 可选)
- Body 参数：
- `model` (string, 必填)：本次请求使用模型的 Model ID。
- `prompt` (string, 必填)：用于生成图像的提示词，支持中英文。
- `size` (string, 可选)：指定生成图像的尺寸信息，支持以下两种方式，不可混用。
方式1 |指定生成图像的分辨率，可选值：1K、2K、4K
方式2 |指定生成图像的宽高像素值：默认值：2048x2048
面积取值范围：[1024x1024, 4096x4096] 
宽高比取值范围：[1/16, 16]
- `sequential_image_generation` (string, 可选)：控制是否关闭组图功能。默认值 disabled
取值范围：
auto：自动判断模式，模型会根据用户提供的提示词自主判断是否返回组图以及组图包含的图片数量。
disabled：关闭组图功能，模型只会生成一张图。
- `stream` (boolean, 可选)：控制是否开启流式输出模式。默认值 false
- `response_format` (string, 可选)：指定生成图像的返回格式。默认值 url
生成的图片为 jpeg 格式，支持以下两种返回方式：
url：返回图片下载链接；链接在图片生成后24小时内有效，请及时下载图片。
b64_json：以 Base64 编码字符串的 JSON 格式返回图像数据。
- `watermark` (boolean, 可选)：是否在生成的图片中添加水印。默认值 true
false：不添加水印。
true：在图片右下角添加“AI生成”字样的水印标识。
- 示例（已脱敏/截断）：
```json
{
  "model": "doubao-seedream-4-5-251128",
  "prompt": "生成一组共4张连贯插画，核心为同一庭院一角的四季变迁，以统一风格展现四季独特色彩、元素与氛围",
  "size": "2K",
  "sequential_image_generation": "auto",
  "sequential_image_generation_options": {
    "max_images": 4
  },
  "stream": false,
  "response_format": "url",
  "watermark": false
}
```

#### doubao-seedream-4-5-251128  单张图生组图

- 端点：`POST /v1/images/generations`
- 说明：给定提示和/或输入图像，模型将生成新图像。

相关指南：[图像生成](https://www.volcengine.com/docs/82379/1666946)

根据提示创建图像。
- Header 参数：
- `Authorization` (string, 可选)
- Body 参数：
- `model` (string, 必填)：本次请求使用模型的 Model ID。
- `prompt` (string, 必填)：用于生成图像的提示词，支持中英文。
- `size` (string, 可选)：指定生成图像的尺寸信息，支持以下两种方式，不可混用。
方式1 |指定生成图像的分辨率，可选值：1K、2K、4K
方式2 |指定生成图像的宽高像素值：默认值：2048x2048
面积取值范围：[1024x1024, 4096x4096] 
宽高比取值范围：[1/16, 16]
- `sequential_image_generation` (string, 可选)：控制是否关闭组图功能。默认值 disabled
取值范围：
auto：自动判断模式，模型会根据用户提供的提示词自主判断是否返回组图以及组图包含的图片数量。
disabled：关闭组图功能，模型只会生成一张图。
- `stream` (boolean, 可选)：控制是否开启流式输出模式。默认值 false
- `response_format` (string, 可选)：指定生成图像的返回格式。默认值 url
生成的图片为 jpeg 格式，支持以下两种返回方式：
url：返回图片下载链接；链接在图片生成后24小时内有效，请及时下载图片。
b64_json：以 Base64 编码字符串的 JSON 格式返回图像数据。
- `watermark` (boolean, 可选)：是否在生成的图片中添加水印。默认值 true
false：不添加水印。
true：在图片右下角添加“AI生成”字样的水印标识。
- 示例（已脱敏/截断）：
```json
"{\n    \"model\": \"doubao-seedream-4-5-251128\",\n    \"prompt\": \"参考这个LOGO，做一套户外运动品牌视觉设计，品牌名称为“GREEN\"，包括包装袋、帽子、卡片、挂绳等。绿色视觉主色调，趣味、简约现代风格\",\n    \"image\": \"https://ark-project.tos-cn-beijing.volces.com/doc_image/seedream4_imageToimages.png\",\n    \"size\": \"2K\",\n    \"sequential_image_generation\": \"auto\",\n    \"sequential_image_generation_options\": {\n        \"max_images\": 4\n    },\n    \"stream\": false,\n    \"response_format\": \"url\",\n    \"watermark\": false\n}"
```

#### doubao-seedream-4-5-251128  多参考图生组图

- 端点：`POST /v1/images/generations`
- 说明：给定提示和/或输入图像，模型将生成新图像。

相关指南：[图像生成](https://www.volcengine.com/docs/82379/1666946)

根据提示创建图像。
- Header 参数：
- `Authorization` (string, 可选)
- Body 参数：
- `model` (string, 必填)：本次请求使用模型的 Model ID。
- `prompt` (string, 必填)：用于生成图像的提示词，支持中英文。
- `size` (string, 可选)：指定生成图像的尺寸信息，支持以下两种方式，不可混用。
方式1 |指定生成图像的分辨率，可选值：1K、2K、4K
方式2 |指定生成图像的宽高像素值：默认值：2048x2048
面积取值范围：[1024x1024, 4096x4096] 
宽高比取值范围：[1/16, 16]
- `sequential_image_generation` (string, 可选)：控制是否关闭组图功能。默认值 disabled
取值范围：
auto：自动判断模式，模型会根据用户提供的提示词自主判断是否返回组图以及组图包含的图片数量。
disabled：关闭组图功能，模型只会生成一张图。
- `stream` (boolean, 可选)：控制是否开启流式输出模式。默认值 false
- `response_format` (string, 可选)：指定生成图像的返回格式。默认值 url
生成的图片为 jpeg 格式，支持以下两种返回方式：
url：返回图片下载链接；链接在图片生成后24小时内有效，请及时下载图片。
b64_json：以 Base64 编码字符串的 JSON 格式返回图像数据。
- `watermark` (boolean, 可选)：是否在生成的图片中添加水印。默认值 true
false：不添加水印。
true：在图片右下角添加“AI生成”字样的水印标识。
- 示例（已脱敏/截断）：
```json
{
  "model": "doubao-seedream-4-5-251128",
  "prompt": "生成3张女孩和奶牛玩偶在游乐园开心地坐过山车的图片，涵盖早晨、中午、晚上",
  "image": [
    "https://ark-project.tos-cn-beijing.volces.com/doc_image/seedream4_imagesToimages_1.png",
    "https://ark-project.tos-cn-beijing.volces.com/doc_image/seedream4_imagesToimages_2.png"
  ],
  "sequential_image_generation": "auto",
  "sequential_image_generation_options": {
    "max_images": 3
  },
  "size": "2K",
  "watermark": false
}
```

### Fal.ai平台

#### 获取请求结果 

- 端点：`GET /fal-ai/{model_name}/requests/{request_id}`
- Path 参数：
- `model_name` (string, 必填)：模型名称
- `request_id` (string, 必填)：任务id

#### /fal-ai/nano-banana 文生图

- 端点：`POST /fal-ai/nano-banana`
- 说明：官方文档: https://fal.ai/models/fal-ai/nano-banana
- Body 参数：
- `prompt` (string, 必填)：生成图片的提示词。
- `num_images` (integer, 可选)：生成图片数量。范围值1-4。默认值：1
- 示例（已脱敏/截断）：
```json
{
  "prompt": "An action shot of a black lab swimming in an inground suburban swimming pool. The camera is placed meticulously on the water line, dividing the image in half, revealing both the dogs head above water holding a tennis ball in it's mouth, and it's paws paddling underwater.",
  "num_images": 1
}
```

#### /fal-ai/nano-banana/edit 图片编辑

- 端点：`POST /fal-ai/nano-banana/edit`
- 说明：官方文档: https://fal.ai/models/fal-ai/nano-banana/edit
- Body 参数：
- `prompt` (string, 必填)：图像编辑的提示词。
- `image_urls[]` (array<string>, 必填)
- `num_images` (integer, 可选)：生成图片数量。范围值1-4。默认值：1
- 示例（已脱敏/截断）：
```json
{
  "prompt": "make a photo of the man driving the car down the california coastline",
  "image_urls": [
    "https://storage.googleapis.com/falserverless/example_inputs/nano-banana-edit-input.png",
    "https://storage.googleapis.com/falserverless/example_inputs/nano-banana-edit-input-2.png"
  ],
  "num_images": 1
}
```

### 千问 Qwen-Image 系列

#### qwen-image-edit-2509

- 端点：`POST /v1/images/generations`
- 说明：给定提示和/或输入图像，模型将生成新图像。
- Header 参数：
- `Authorization` (string, 可选)
- Body 参数：
- `model` (string, 必填)
- `prompt` (string, 必填)：提示词
- `image` (string, 必填)：图片url
- 示例（已脱敏/截断）：
```json
{
  "model": "qwen-image-edit-2509",
  "prompt": "把小鸭子放在女人的T恤上面",
  "image": "https://v3.fal.media/files/penguin/XoW0qavfF-ahg-jX4BMyL_image.webp"
}
```

