# nexus API 接口文档

> 本文档基于 [help.allapi.store](https://help.allapi.store/) 整理
> 
> 更多常见问题请参考：[飞书 Q&A 文档](https://ai.feishu.cn/wiki/V0qRwGuPCi8coKku0gNchuTHnYb)

---

## 目录

1. [基本信息](#基本信息)
2. [视频模型](#视频模型)
   - [veo 视频生成](#veo-视频生成)
   - [sora 视频生成](#sora-视频生成)
   - [luma 视频生成](#luma-视频生成)
   - [其他视频模型](#其他视频模型)
3. [绘画模型](#绘画模型)
   - [Midjourney](#midjourney)
   - [DALL·E 3](#dalle-3)
   - [FLUX 系列](#flux-系列)
   - [GPT Image 系列](#gpt-image-系列)
4. [常见问题与错误处理](#常见问题与错误处理)

---

## 基本信息

### API 基础地址

```
https://api.allapi.store/v1
```

### 认证方式

所有请求需要在 Header 中添加 Authorization：

```
Authorization: Bearer YOUR_API_KEY
```

### 通用 Header 参数

| 参数名 | 类型 | 必需 | 示例值 |
|--------|------|------|--------|
| Content-Type | string | 是 | `application/json` |
| Accept | string | 是 | `application/json` |
| Authorization | string | 是 | `Bearer {{YOUR_API_KEY}}` |

---

## 视频模型

### veo 视频生成

veo 是 Google 的视频生成模型，支持两种 API 格式：

#### 1. 视频统一格式

**端点**: `POST /v1/video/create`

**请求体**: `application/json`

##### 请求参数

| 参数名 | 类型 | 必需 | 说明 |
|--------|------|------|------|
| model | string | **是** | 模型名称，见下方枚举值 |
| prompt | string | **是** | 提示词（veo 只支持英文，可开启 enhance_prompt 自动翻译） |
| aspect_ratio | string | 否 | 宽高比，`"16:9"` 或 `"9:16"`（仅 veo3 支持） |
| duration | integer | 否 | 视频时长（秒） |
| images | array[string] | 否 | 图片 URL 数组，用于图生视频 |
| enable_upsample | boolean | 否 | 是否启用超分辨率 |
| enhance_prompt | boolean | 否 | 是否启用提示词增强（中文自动转英文） |

##### model 枚举值

| 模型名称 | 说明 |
|----------|------|
| `veo2` | Google veo2 标准模式 |
| `veo2-fast` | veo2 fast 模式，质量好速度快 |
| `veo2-fast-frames` | veo2 fast 模式，支持首尾帧（最多 2 张图片） |
| `veo2-fast-components` | veo2 fast 模式，支持上传图片素材（最多 3 张），图片会合并到视频中 |
| `veo2-pro` | veo2 高质量模式，价格较贵 |
| `veo2-pro-components` | veo2 pro 模式，支持图片素材 |
| `veo3` | Google veo3 标准模式 |
| `veo3-fast` | veo3 fast 模式 |
| `veo3-fast-frames` | veo3 fast 模式，支持首尾帧 |
| `veo3-frames` | veo3 标准模式，支持首尾帧 |
| `veo3-pro` | veo3 高质量模式 |
| `veo3-pro-frames` | veo3 pro 模式，支持首帧（最多 1 张） |
| `veo3.1` | Google veo3.1 最新版本 |
| `veo3.1-fast` | veo3.1 fast 模式 |
| `veo3.1-pro` | veo3.1 高质量模式 |

##### 请求示例

```json
{
  "model": "veo3.1-fast",
  "prompt": "A cat walking on the beach at sunset",
  "aspect_ratio": "16:9",
  "enable_upsample": true,
  "enhance_prompt": true
}
```

##### 带图片请求示例

```json
{
  "model": "veo2-fast-frames",
  "prompt": "make animate",
  "aspect_ratio": "16:9",
  "enable_upsample": true,
  "enhance_prompt": true,
  "images": [
    "https://example.com/first-frame.png",
    "https://example.com/last-frame.png"
  ]
}
```

##### 响应示例

```json
{
  "id": "veo3-fast-frames:1757555257-PORrVn9sa9",
  "status": "pending",
  "status_update_time": 1757555257582,
  "enhanced_prompt": "..."
}
```

##### 查询任务

**端点**: `GET /v1/video/query`

**请求参数**:

| 参数名 | 类型 | 必需 | 说明 |
|--------|------|------|------|
| id | string | **是** | 任务 ID |

**响应状态码**:

| 状态 | 说明 |
|------|------|
| `pending` | 任务等待中 |
| `processing` | 任务处理中 |
| `completed` | 任务完成 |
| `failed` | 任务失败 |
| `error` | 发生错误 |

---

#### 2. OpenAI 视频格式

**端点**: `POST /v1/videos`

**请求体**: `multipart/form-data`

##### 请求参数

| 参数名 | 类型 | 必需 | 说明 |
|--------|------|------|------|
| model | string | **是** | 模型名称，如 `veo_3_1-fast-4K` |
| prompt | string | **是** | 提示词 |
| size | string | 否 | 尺寸，如 `"16x9"` |
| seconds | string | 否 | 时长（秒） |
| image | file | 否 | 图片文件 |

##### 响应示例

```json
{
  "id": "video_55cb73b3-60af-40c8-95fd-eae8fd758ade",
  "object": "video",
  "model": "veo_3_1",
  "status": "queued",
  "progress": 0,
  "created_at": 1762336916,
  "seconds": "8",
  "size": "16x9"
}
```

##### 查询任务

**端点**: `GET /v1/videos/{id}`

##### 下载视频

**端点**: `GET /v1/videos/{id}/download` 或响应中返回的 URL

---

### sora 视频生成

sora 是 OpenAI 的视频生成模型，支持多种格式：

#### 1. 统一视频格式

**端点**: `POST /v1/video/create`

##### 请求参数

| 参数名 | 类型 | 必需 | 说明 |
|--------|------|------|------|
| model | string | **是** | `sora-2-all` 或 `sora-2-pro-all` |
| prompt | string | **是** | 提示词 |
| orientation | string | 否 | `landscape`（横向）或 `portrait`（纵向） |
| size | string | 否 | 尺寸：`small`, `medium`, `large` |
| duration | integer | 否 | 时长（秒） |
| images | array[string] | 否 | 图片 URL 数组 |

##### 请求示例

```json
{
  "model": "sora-2-all",
  "prompt": "A beautiful sunset over the ocean",
  "orientation": "landscape",
  "size": "large",
  "duration": 15
}
```

#### 2. OpenAI 官方视频格式

**端点**: `POST /v1/videos`

使用 FormData 格式，参数与标准 OpenAI 视频 API 一致。

#### 3. chat 格式

**端点**: `POST /v1/chat/completions`

通过 chat 接口生成视频，适合连续对话场景。

---

### luma 视频生成

#### 提交生成视频任务

**端点**: `POST /v1/generations` (官方 API 格式)

##### 请求参数

| 参数名 | 类型 | 必需 | 说明 |
|--------|------|------|------|
| prompt | string | **是** | 提示词 |
| aspect_ratio | string | 否 | 宽高比 |
| loop | boolean | 否 | 是否循环 |
| keyframes | object | 否 | 关键帧配置 |

#### 查询任务

**端点**: `GET /v1/generations/{id}`

---

### 其他视频模型

| 模型 | 说明 |
|------|------|
| Runway | 支持 Gen-2、Gen-3 等模型 |
| 即梦 | 字节跳动视频生成 |
| 海螺 | 支持图生视频、首尾帧视频 |
| 豆包 | 字节跳动 seedance 系列 |
| grok | X.AI 视频生成 |
| 通义万象 | 阿里视频生成 |

---

## 绘画模型

### Midjourney

#### 提交 Imagine 任务

**端点**: `POST /mj/submit/imagine`

##### 请求参数

| 参数名 | 类型 | 必需 | 说明 |
|--------|------|------|------|
| prompt | string | **是** | 提示词 |
| base64Array | array[string] | 否 | 垫图的 base64 数组 |
| notifyHook | string | 否 | 回调地址 |
| state | string | 否 | 自定义状态 |

#### 查询任务状态

**端点**: `GET /mj/task/{id}/fetch`

#### 执行 Action 动作

**端点**: `POST /mj/submit/action`

用于放大、变化、重绘等操作。

---

### DALL·E 3

#### 创建图像

**端点**: `POST /v1/images/generations`

##### 请求参数

| 参数名 | 类型 | 必需 | 说明 |
|--------|------|------|------|
| model | string | **是** | `dall-e-3` |
| prompt | string | **是** | 提示词 |
| n | integer | 否 | 生成数量（默认 1） |
| size | string | 否 | `1024x1024`, `1792x1024`, `1024x1792` |
| quality | string | 否 | `standard` 或 `hd` |
| style | string | 否 | `vivid` 或 `natural` |
| response_format | string | 否 | `url` 或 `b64_json` |

##### 请求示例

```json
{
  "model": "dall-e-3",
  "prompt": "A beautiful landscape painting",
  "n": 1,
  "size": "1024x1024",
  "quality": "hd"
}
```

##### 响应示例

```json
{
  "created": 1234567890,
  "data": [
    {
      "url": "https://...",
      "revised_prompt": "..."
    }
  ]
}
```

---

### FLUX 系列

#### gpt 兼容格式

**端点**: `POST /v1/images/generations`

##### 请求参数

| 参数名 | 类型 | 必需 | 说明 |
|--------|------|------|------|
| model | string | **是** | `flux-pro`, `flux-dev`, `flux-schnell` 等 |
| prompt | string | **是** | 提示词 |
| size | string | 否 | 图像尺寸 |

#### Replicate 官方格式

**端点**: `POST /v1/predictions`

使用 Replicate 格式提交任务，然后通过任务 ID 查询结果。

---

### GPT Image 系列

#### gpt-image-1 创建

**端点**: `POST /v1/images/generations`

```json
{
  "model": "gpt-image-1",
  "prompt": "A futuristic city",
  "size": "1024x1024"
}
```

#### gpt-image-1 编辑

**端点**: `POST /v1/images/edits`

使用 FormData 格式，上传原图和蒙版进行编辑。

#### gpt-image-1.5

最新版本的 GPT 图像生成模型，支持更高质量输出。

---

### 豆包系列

支持以下模型：

| 模型 | 说明 |
|------|------|
| `doubao-seedream-3-0-t2i-250415` | 文生图 |
| `doubao-seededit-3-0-i2i-250628` | 图生图 |
| `doubao-seedream-4-0-250828` | 文生图/图生图 |
| `doubao-seedream-4-5-251128` | 最新版本，支持多图融合、组图输出 |

---

### Ideogram

#### Generate 3.0 文生图

**端点**: `POST /generate`

##### 请求参数

| 参数名 | 类型 | 必需 | 说明 |
|--------|------|------|------|
| image_request | object | **是** | 图像请求配置 |
| image_request.prompt | string | **是** | 提示词 |
| image_request.aspect_ratio | string | 否 | 宽高比 |
| image_request.model | string | 否 | 模型版本 |

#### 其他功能

- **Edit**: 图片编辑
- **Remix**: 图片重制
- **Reframe**: 图片重构
- **Replace Background**: 替换背景
- **Upscale**: 放大高清
- **Describe**: 图片描述

---

## 常见问题与错误处理

### 错误状态码

| 状态码 | 说明 |
|--------|------|
| 200 | 成功 |
| 400 | 请求参数错误 |
| 401 | 认证失败 |
| 403 | 权限不足 |
| 429 | 请求过于频繁 |
| 500 | 服务器内部错误 |

### 常见错误信息

| 错误信息 | 原因 | 解决方案 |
|----------|------|----------|
| `当前分组上游负载已饱和，请稍后再试` | 后端服务过载 | 等待几分钟后重试 |
| `HTTP 500 Internal Server Error` | 服务器错误 | 检查参数是否正确，稍后重试 |
| `model not found` | 模型名称错误 | 检查模型名称是否与文档一致 |
| `content policy violation` | 内容违规 | 修改提示词内容 |
| `timeout` | 生成超时 | 减少视频时长或稍后重试 |

### 重要提示

1. **注意对比模型广场与 API 文档的端点** - 确保使用正确的 API 端点
2. **sora2 推荐用 `sora-2-all`** - 这个渠道更稳定
3. **2pro 官方限量** - 时长较长，有一定失败几率
4. **veo 只支持英文提示词** - 可开启 `enhance_prompt` 自动翻译

### 图片格式要求

- 支持 JPEG、PNG、WebP 格式
- 图片 URL 需要可公开访问
- 支持 base64 编码格式
- 建议图片尺寸不超过 4096x4096

### 视频时长限制

| 模型 | 时长范围 |
|------|----------|
| veo2-fast | 5-10 秒 |
| veo3.1-fast | 5-10 秒 |
| sora-2-all | 5-20 秒 |
| luma | 5-10 秒 |

---

## 项目中的模型配置

当前项目 (`nexus/src/config/models.js`) 中配置的视频模型：

### veo 系列

| 配置 key | 格式 | 端点 |
|----------|------|------|
| `veo3.1-fast-components` | veo-unified | `/video/create` |
| `veo_3_1-fast-4K` | openai-video | `/videos` |
| `veo3.1-4k` | veo-unified | `/video/create` |

### sora 系列

| 配置 key | 格式 | 端点 |
|----------|------|------|
| `sora-2-all` | sora-unified | `/video/create` |

---

## 参考链接

- [nexus API 官方文档](https://help.allapi.store/)
- [飞书 Q&A 常见问题](https://ai.feishu.cn/wiki/V0qRwGuPCi8coKku0gNchuTHnYb)
- [在线调试工具](https://help.allapi.store/doc-8011215)

---

*文档更新时间: 2026-01-27*
