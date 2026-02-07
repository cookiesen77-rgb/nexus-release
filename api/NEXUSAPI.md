# NexusAPI 中转接入说明

本项目使用 `https://nexusapi.cn` 作为统一网关，并按你指定的 **model → endpoint/鉴权/格式** 规则路由请求。

---

## 1) 快速配置

1. 启动应用后，打开右下角/侧边栏的「设置」。
2. 填写 `API Key`（形如 `sk-...`）并保存即可。

配置会保存在浏览器本地存储：
- `apiKey`

参考：`https://20474j2h5s.apifox.cn/`

---

## 2) 鉴权方式（非常重要）

### A. OpenAI 兼容接口（Chat / Images / Videos）

- Base URL（固定不可改）：`https://nexusapi.cn/v1`
- Header：
  - `Content-Type: application/json`
  - `Authorization: Bearer <YOUR_API_KEY>`

示例（Responses / Chat）：`https://20474j2h5s.apifox.cn/`
（创建：`https://20474j2h5s.apifox.cn/api-403562485.md`；流式：`https://20474j2h5s.apifox.cn/api-403562487.md`）

### B. Gemini 原生接口（v1beta）

Gemini 的 `generateContent/streamGenerateContent` 走「Query 参数」传 key（与官方一致）：
- `POST https://nexusapi.cn/v1beta/models/<model>:generateContent?key=<YOUR_API_KEY>`

参考：
- 文本：`https://20474j2h5s.apifox.cn/api-403562478.md`
- 生图：`https://20474j2h5s.apifox.cn/api-403562463.md`

---

## 3) 当前已接入的模型与路由

> 说明：以下 **model 名称以你给的为准，不能随意改名**。后续你要新增/删改模型，也在这里与代码里同步维护。

### 3.1 主要 AI 助手（文本）

- model：`gpt-5-mini`
- 后缀：`/responses`（与 Base URL `https://nexusapi.cn/v1` 拼接后为：`https://nexusapi.cn/v1/responses`）
- 鉴权：`Authorization: Bearer ...`
- 代码入口：`src/hooks/useApi.js`（Responses：`input[]`，支持流式）

请求体关键字段（示例）：
- `model`
- `input[]`（多轮对话：`role: user|assistant|system` + `content`）
- `stream`（可选）

> Gemini（`gemini-3-pro-preview`）仍保留为可选模型，走 v1beta + `?key=`。

### 3.2 生图（Images）

#### 1) Gemini 生图

- model：`gemini-3-pro-image-preview`
- UI 展示名：`nano-banana-pro`（**仅展示名**，实际请求 model 不变）
- 后缀：`/v1beta/models/gemini-3-pro-image-preview:generateContent`
- 鉴权：Query `?key=...`
- 默认清晰度：本项目默认按 `2K` 发送（可在节点里切换 `1K/2K/4K`）
- 参考：`https://20474j2h5s.apifox.cn/api-403562463.md`

请求体关键字段（示例）：
- `contents[0].parts`: `[{ text: <prompt> }, { inline_data: { mime_type, data } } ...]`
- `generationConfig.responseModalities: ["TEXT","IMAGE"]`
- `generationConfig.imageConfig.aspectRatio`
- `generationConfig.imageConfig.imageSize`（本项目：`1K/2K/4K`）

#### 2) OpenAI 兼容生图（统一走 /images/generations）

- model：
  - `gpt-image-1.5-all`
  - `jimeng-4.5`
  - `flux-pro-1.1-ultra`
  - `doubao-seedream-4-5-251128`
  - `qwen-image-edit-2509`（需要 `image` 输入）
- 后缀：`/images/generations`（完整 URL：`https://nexusapi.cn/v1/images/generations`）
- 鉴权：`Authorization: Bearer ...`
- 参考：
  - GPT Image：`https://20474j2h5s.apifox.cn/api-403562513.md`
  - 即梦绘画：`https://20474j2h5s.apifox.cn/api-403562516.md`

本项目默认请求参数（会按需调整）：
- `model`
- `prompt`
- `n`（与节点的「数量」一致；编辑类模型通常只返回 1 张）
- `size`
  - GPT Image 系列示例：`1024x1024` / `1536x1024` / `1024x1536`
  - 即梦示例：比例 `2:3`
  - Seedream 示例：`1K/2K/4K`（或用 `宽x高` 像素，详见 Apifox：`https://20474j2h5s.apifox.cn/api-403562528.md`）
- `image`（仅 `qwen-image-edit-2509` 会携带；必须提供输入图，支持 URL 或 DataURL）

#### 3) Chat Completions 生图（/chat/completions）

> 你给的规则：相关生图模型走 `/chat/completions`。help 站点未提供这些模型的专用页时，本项目按你给的后缀实现，并用“深度提取 URL/dataURI”的方式兼容不同返回形态（建议让模型只输出图片 URL 或 dataURI）。

- model：
  - `qwen-image-max`
  - `grok-4-image`
- 后缀：`/chat/completions`（完整 URL：`https://nexusapi.cn/v1/chat/completions`）
- 鉴权：`Authorization: Bearer ...`
- 代码入口：`src/hooks/useApi.js`（OpenAI Chat 兼容）

#### 4) Kling 生图（kling-image）

- model：`kling-image`
- 后缀：`/kling/v1/images/generations`
- 鉴权：`Authorization: Bearer ...`
- 固定版本：`model_name = kling-v2-1`
- 参考：
  - 创建：`https://20474j2h5s.apifox.cn/api-403562636.md`
  - 查询：`https://20474j2h5s.apifox.cn/api-403562637.md`

#### 5) Tencent-VOD AIGC 生图（按你提供的规则接入）

> 该端点未在当前 Apifox 文档中检索到对应示例页，本项目按你给定的后缀与参数约定做了接入；如字段名与实际不一致，可继续按你提供的示例对齐。

- model：
  - `aigc-image-gem`（版本号 `3.0`，清晰度默认 `2k`）
  - `aigc-image-qwen`（版本号 `0925`）
- 后缀：`/tencent-vod/v1/aigc-image`
- 鉴权：`Authorization: Bearer ...`
- 代码入口：`src/hooks/useApi.js`

### 3.3 视频（Videos）

#### 1) OpenAI 视频格式（/v1/videos）

- model：`veo_3_1-fast`
- 后缀：`/videos`（multipart/form-data；完整 URL：`https://nexusapi.cn/v1/videos`）
- 查询：`GET /videos/{id}`（完整 URL：`https://nexusapi.cn/v1/videos/{id}`）
- 鉴权：`Authorization: Bearer ...`
- 参考：
  - 创建：`https://20474j2h5s.apifox.cn/api-403562542.md`
  - 查询：`https://20474j2h5s.apifox.cn/api-403562543.md`

#### 2) 统一视频格式（/v1/video/create）

- model：
  - `veo3.1-4k`
  - `veo3.1-pro-4k`
  - `sora-2-all`
  - `jimeng-video-3.0`
- 后缀：`/video/create`（完整 URL：`https://nexusapi.cn/v1/video/create`）
- 查询：`GET /video/query?id=...`（完整 URL：`https://nexusapi.cn/v1/video/query?id=...`）
- 鉴权：`Authorization: Bearer ...`
- 参考：
  - 创建：`https://20474j2h5s.apifox.cn/api-403562538.md`
  - 查询：`https://20474j2h5s.apifox.cn/api-403562540.md`
  - Sora 创建（统一视频格式）：`https://20474j2h5s.apifox.cn/api-403562579.md`

#### 3) Kling 视频（kling-video）

- model：`kling-video`
- 文生视频：`POST /kling/v1/videos/text2video`，查询：`GET /kling/v1/videos/text2video/{id}`
- 图生视频：`POST /kling/v1/videos/image2video`，查询：`GET /kling/v1/videos/image2video/{id}`
- 固定：`model_name=kling-v2-6`、`mode=pro`、`duration=10`、`sound=off`
- 参考：
  - 文生创建：`https://20474j2h5s.apifox.cn/api-403562618.md`
  - 图生创建：`https://20474j2h5s.apifox.cn/api-403562620.md`

#### 4) Tencent-VOD AIGC 视频（按你提供的规则接入）

- model：
  - `aigc-video-vidu`（版本：`q2-pro`）
  - `aigc-video-hailuo`（版本：`2.3-Fast`）
- 后缀：`/tencent-vod/v1/aigc-video`
- 说明：当前仅支持“接口直接返回 `video_url`”；若返回任务 ID，需要你提供查询接口文档/示例以补齐轮询。

---

## 4) 详细 API 调用示例（与项目一致）

> 说明：Base URL 固定为 `https://nexusapi.cn/v1`，下列示例已写成完整 URL，方便你直接对照排错。

### 4.1 AI 助手（Responses）

`POST https://nexusapi.cn/v1/responses`

```bash
curl --location --request POST 'https://nexusapi.cn/v1/responses' \
  --header 'Accept: application/json' \
  --header 'Authorization: Bearer <YOUR_API_KEY>' \
  --header 'Content-Type: application/json' \
  --data-raw '{
    "model": "gpt-5-mini",
    "input": [
      { "role": "system", "content": "你是一个中文助手。" },
      { "role": "user", "content": "把这句话润色得更电影感：一只猫在屋顶奔跑。" }
    ]
  }'
```

### 4.2 生图（gpt-image-1.5-all）

`POST https://nexusapi.cn/v1/images/generations`

```bash
curl --location --request POST 'https://nexusapi.cn/v1/images/generations' \
  --header 'Accept: application/json' \
  --header 'Authorization: Bearer <YOUR_API_KEY>' \
  --header 'Content-Type: application/json' \
  --data-raw '{
    "model": "gpt-image-1.5-all",
    "prompt": "电影感，一个女孩在雨夜街头，霓虹反射，浅景深",
    "n": 1,
    "size": "1024x1536"
  }'
```

### 4.3 生图（jimeng-4.5）

即梦在 Apifox 示例里 `size` 使用比例（如 `2:3`）。

```bash
curl --location --request POST 'https://nexusapi.cn/v1/images/generations' \
  --header 'Accept: application/json' \
  --header 'Authorization: Bearer <YOUR_API_KEY>' \
  --header 'Content-Type: application/json' \
  --data-raw '{
    "model": "jimeng-4.5",
    "prompt": "一只可爱的小猪，柔光，插画风",
    "size": "2:3"
  }'
```

### 4.4 生图（nano-banana-pro / Gemini）

> UI 展示名为 `nano-banana-pro`，实际请求走 Gemini 原生 `generateContent`。

`POST https://nexusapi.cn/v1beta/models/gemini-3-pro-image-preview:generateContent?key=<YOUR_API_KEY>`

```bash
curl --location --request POST 'https://nexusapi.cn/v1beta/models/gemini-3-pro-image-preview:generateContent?key=<YOUR_API_KEY>' \
  --header 'Accept: application/json' \
  --header 'Content-Type: application/json' \
  --data-raw '{
    "contents": [
      {
        "role": "user",
        "parts": [
          { "text": "保持参考图人物一致性，生成电影感雨夜街头镜头，霓虹反射，浅景深" },
          { "inline_data": { "mime_type": "image/png", "data": "<BASE64_NO_PREFIX_1>" } },
          { "inline_data": { "mime_type": "image/png", "data": "<BASE64_NO_PREFIX_2>" } }
        ]
      }
    ],
    "generationConfig": {
      "responseModalities": ["TEXT", "IMAGE"],
      "imageConfig": { "aspectRatio": "9:16", "imageSize": "2K" }
    }
  }'
```

### 4.5 生图（kling-image）

`POST https://nexusapi.cn/kling/v1/images/generations`

```bash
curl --location --request POST 'https://nexusapi.cn/kling/v1/images/generations' \
  --header 'Accept: application/json' \
  --header 'Authorization: Bearer <YOUR_API_KEY>' \
  --header 'Content-Type: application/json' \
  --data-raw '{
    "model_name": "kling-v2-1",
    "prompt": "一个角色转身看向镜头，电影感光影，浅景深",
    "n": 1,
    "aspect_ratio": "9:16",
    "resolution": "2k",
    "image": "<REFERENCE_IMAGE_URL_OR_BASE64_OR_DATAURL>"
  }'
```

若返回 `task_id`，查询（轮询）：

`GET https://nexusapi.cn/kling/v1/images/generations/<taskId>`

### 4.6 生图（doubao-seedream-4-5-251128）

`POST https://nexusapi.cn/v1/images/generations`

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

### 4.7 视频（kling-video）

文生视频：`POST https://nexusapi.cn/kling/v1/videos/text2video`

```bash
curl --location --request POST 'https://nexusapi.cn/kling/v1/videos/text2video' \
  --header 'Accept: application/json' \
  --header 'Authorization: Bearer <YOUR_API_KEY>' \
  --header 'Content-Type: application/json' \
  --data-raw '{
    "model_name": "kling-v2-6",
    "prompt": "城市夜景，镜头推近，霓虹灯反射，电影感",
    "mode": "pro",
    "sound": "off",
    "aspect_ratio": "16:9",
    "duration": "10"
  }'
```

查询（轮询）：
- `GET https://nexusapi.cn/kling/v1/videos/text2video/<taskId>`
- `GET https://nexusapi.cn/kling/v1/videos/image2video/<taskId>`

### 4.8 视频（Veo：veo3.1-4k / veo3.1-pro-4k）

`POST https://nexusapi.cn/v1/video/create`

```bash
curl --location --request POST 'https://nexusapi.cn/v1/video/create' \
  --header 'Accept: application/json' \
  --header 'Authorization: Bearer <YOUR_API_KEY>' \
  --header 'Content-Type: application/json' \
  --data-raw '{
    "model": "veo3.1-4k",
    "prompt": "一只猫在城市屋顶奔跑，镜头跟随，强烈电影感",
    "images": ["https://filesystem.site/cdn/20250612/998IGmUiM2koBGZM3UnZeImbPBNIUL.png"],
    "enhance_prompt": true,
    "enable_upsample": true,
    "aspect_ratio": "16:9"
  }'
```

### 4.9 视频（Sora：sora-2-all）

Sora 的统一视频格式需要额外字段（尤其是 `size`/`duration`），否则会出现你看到的 `size is required for sora-2`。
可选 `size` 常见为：
- `small`（约 720p）
- `large`（约 1080p）

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

### 4.10 视频查询（统一视频查询）

`GET https://nexusapi.cn/v1/video/query?id=<taskId>`

```bash
curl --location --request GET 'https://nexusapi.cn/v1/video/query?id=<taskId>' \
  --header 'Accept: application/json' \
  --header 'Authorization: Bearer <YOUR_API_KEY>'
```

更多字段细节与排错清单见：`api/NEXUSAPI_REFERENCE.md`。

---

## 5) 代码位置（便于你后续增/删模型）

- 模型配置（唯一入口）：`src/config/models.js`
- 业务调用（按 format 分支组装请求体）：`src/hooks/useApi.js`
- HTTP 与鉴权（Bearer / Query key）：`src/utils/request.js`
- 设置（仅 Key；Base URL 锁定）：`src/components/ApiSettings.vue`

配套文档：
- 路由表：`api/NEXUSAPI_MODEL_ROUTING.md`
- 开发参考：`api/NEXUSAPI_REFERENCE.md`

---

## 6) AI 漫剧工作流程（联网检索整理）

基于公开教程/复盘文章（例如 1ai.net 的「文-图-视-音-剪」思路）整理的可落地流程：

1. **文（剧本/分镜脚本）**
   - 先对齐世界观、角色设定、情绪钩子与反转。
   - 把文字“翻译”为镜头语言：景别、机位、构图、运镜、光影。
2. **图（稳定的角色与画风）**
   - 先做角色/风格 Bible，固定关键外观点与色板。
   - 分镜拆分后批量出图，优先追求一致性与可剪辑性。
3. **视（图生视频/分镜转场）**
   - 用首尾帧/多帧参考生成动作与转场，避免“换脸/换衣/换背景”。
4. **音（旁白/对白/音乐）**
   - 旁白与对白节奏匹配分镜，字幕信息密度适配短视频。
5. **剪（合成与节奏）**
   - 重点在“情绪点”与“剪辑节奏”：推进、停顿、爆点、反转。

对应到 Nexus 画布的最快用法：
- 侧边栏「工作流」里加载 `AI 漫剧工作流（模板）`
- 在第 3 步「分镜规划（JSON）」节点点生成，会自动扩展出多张分镜图节点
- 把关键分镜图连接到「分镜转视频」节点（至少 2 张更稳），再生成视频
