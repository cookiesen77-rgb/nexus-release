# Suno API (文生音乐) 完整技术文档

## 基础信息

**API Base URL:** `https://yunwu.ai` (通过云雾API中转)

**认证方式:** Bearer Token
```
Authorization: Bearer <YOUR_API_TOKEN>
```

**支持模型版本:**
- `chirp-v3-0` (v3.0)
- `chirp-v3-5` (v3.5)
- `chirp-v4` (v4.0) - 推荐
- `chirp-auk` (v4.5)
- `chirp-v5` (v5.0) - 最新

---

## 1. 任务状态系统

### Task 数据结构

| 字段 | 类型 | 说明 | 示例 |
|------|------|------|------|
| `task_id` | string | 任务唯一标识 | `f4a94d75-087b-4bb1-bd45-53ba293faf96` |
| `action` | string | 任务类型: `MUSIC`(生成歌) / `LYRICS`(生成歌词) | `MUSIC` |
| `status` | string | 任务状态 | 见下表 |
| `submitTime` | number | 提交时间(毫秒) | `1689231405854` |
| `startTime` | number | 开始执行时间(毫秒) | `1689231442755` |
| `finishTime` | number | 完成时间(毫秒) | `1689231544312` |
| `failReason` | string | 失败原因(失败时有值) | `[Invalid parameter] Invalid value` |
| `data` | object | 具体输出数据 | - |

### 任务状态流转

```
NOT_START → SUBMITTED → QUEUED → IN_PROGRESS → SUCCESS/FAILURE
```

| 状态 | 说明 |
|------|------|
| `NOT_START` | 未启动 |
| `SUBMITTED` | 已提交处理 |
| `QUEUED` | 排队中 |
| `IN_PROGRESS` | 执行中 |
| `SUCCESS` | 成功完成 |
| `FAILURE` | 失败 |

---

## 2. 音乐生成接口

### 2.1 基础音乐生成 (灵感模式)

通过简单描述自动生成歌词和音乐。

**端点:** `POST /suno/generate`

**认证:** 需要 Bearer Token

**请求体:**
```json
{
  "gpt_description_prompt": "乡愁"
}
```

**响应:**
```json
{}
```

---

### 2.2 自定义创作模式 - 普通生成

完整控制标题、风格、歌词和性别。

**端点:** `POST /suno/submit/music`

**认证:** 需要 Bearer Token

**必需参数:**
| 参数 | 类型 | 说明 | 示例 |
|------|------|------|------|
| `prompt` | string | 音乐创作提示词(包括歌词) | `"[Verse]\nMove your paws..."` |
| `title` | string | 歌曲标题 | `"Cat Dance"` |
| `tags` | string | 音乐风格(逗号分隔) | `"romantic, raga"` |
| `mv` | string | 模型版本 | `"chirp-v4"` |

**可选参数:**
| 参数 | 类型 | 说明 | 默认值 |
|------|------|------|--------|
| `negative_tags` | string | 不希望出现的风格 | `""` |
| `generation_type` | string | 生成类型 | `"TEXT"` |
| `make_instrumental` | boolean | 是否生成纯音乐 | `false` |
| `gpt_description_prompt` | string | GPT描述提示词(灵感模式) | - |

**metadata 对象:**
```json
{
  "create_mode": "custom",      // 创建模式
  "vocal_gender": "m"           // 男声("m") 或 女声("f")
}
```

**请求示例:**
```bash
curl -X POST 'https://yunwu.ai/suno/submit/music' \
  -H 'Authorization: Bearer <token>' \
  -H 'Content-Type: application/json' \
  -d '{
    "prompt": "[Verse]\nMove your paws\nLeft and right\n[Chorus]\nCat dance\nOh\nLet'\''s go!",
    "mv": "chirp-v4",
    "title": "Cat Dance",
    "tags": "romantic, raga",
    "negative_tags": "",
    "metadata": {
      "create_mode": "custom",
      "vocal_gender": "m"
    }
  }'
```

**响应:**
```json
{
  "code": "success",
  "data": "950bf3af-78a6-420e-8c01-3bde0bbb3ef9",
  "message": ""
}
```

**返回:**
- `code`: 请求状态
- `data`: 任务ID，用于查询进度

---

### 2.3 续写模式 (音乐扩展)

在现有歌曲的基础上继续创作。

**端点:** `POST /suno/submit/music`

**必需参数:**
| 参数 | 类型 | 说明 | 必需 |
|------|------|------|------|
| `continue_clip_id` | string | 要续写的歌曲ID | ✓ |
| `continue_at` | float | 续写起始时间(秒) | ✓ |
| `title` | string | 新标题 | ✓ |
| `prompt` | string | 续写提示词 | ✓ |
| `task` | string | 固定值 `"extend"` | ✓ |
| `mv` | string | 模型版本 | ✓ |
| `tags` | string | 风格标签 | ✓ |

**请求示例:**
```json
{
  "prompt": "[Verse 2]\nTiptoe steps\nSoft and sweet\n[Chorus]\nCat dance\nLet's steal the glow",
  "mv": "chirp-v4",
  "title": "Cat Dance",
  "tags": "romantic, raga",
  "continue_at": 120.00,
  "continue_clip_id": "4c4c80c4-6318-48c7-a314-71dd03ba3a11",
  "task": "extend"
}
```

---

### 2.4 歌手风格模式 (Artist Consistency)

使用参考歌曲的歌手风格创作新歌。

**端点:** `POST /suno/submit/music`

**特殊参数:**
| 参数 | 类型 | 说明 | 备注 |
|------|------|------|------|
| `task` | string | 固定值 `"artist_consistency"` | 必需 |
| `mv` | string | 模型: `chirp-v3-5-tau` 或 `chirp-v4-tau` | 必需 |
| `persona_id` | string | Persona ID (需要先创建) | 必需 |
| `artist_clip_id` | string | 参考歌曲 clip_id | 必需 |
| `vocal_gender` | string | 声线性别: `"m"` / `"f"` | 可选 |

**创建 Persona 流程:**
1. 通过普通生成创建歌曲，获取 `clip_id`
2. 使用该 `clip_id` 作为参考创建 Persona

**请求示例:**
```json
{
  "prompt": "[Verse]\n你从清晨到黄昏\n一直在我身边温暖\n[Chorus]\n老公老公我爱你\n你是世界的唯一",
  "generation_type": "TEXT",
  "tags": "electronic, pop",
  "negative_tags": "",
  "mv": "chirp-v4-tau",
  "title": "老公",
  "task": "artist_consistency",
  "persona_id": "0f6e8077-a7ba-4fc8-8f60-de02c66e56ce",
  "artist_clip_id": "a5fa604c-18b8-4e7f-8d25-9412d4ba8163",
  "vocal_gender": ""
}
```

---

### 2.5 上传歌曲二次创作

基于上传的音频文件进行二次创作和续写。

**端点:** `POST /suno/submit/music`

**参数:**
| 参数 | 类型 | 说明 | 备注 |
|------|------|------|------|
| `task` | string | 固定值 `"upload_extend"` | 必需 |
| `mv` | string | 必须使用 `"chirp-v3-5-tau"` | 必需 |
| `continue_clip_id` | string | 上传后的 clip_id | 必需 |
| `continue_at` | float | 续写起始时间(秒) | 必需 |
| `title` | string | 标题 | 必需 |
| `prompt` | string | 歌词 | 必需 |
| `tags` | string | 风格标签 | 可选 |
| `negative_tags` | string | 排除风格 | 可选 |

**请求示例:**
```json
{
  "prompt": "歌词内容",
  "tags": "",
  "negative_tags": "",
  "mv": "chirp-v4",
  "title": "标题",
  "continue_clip_id": "ca94a97d-d3f2-4a63-aeee-ba3a43384bcd",
  "continue_at": 10,
  "task": "upload_extend"
}
```

---

### 2.6 歌曲拼接 (Song Concatenation)

合并两首歌曲。

**端点:** `POST /suno/submit/music`

**参数:**
| 参数 | 类型 | 说明 |
|------|------|------|
| `clip_id` | string | extend 后的歌曲ID |
| `is_infill` | boolean | 是否填充缝隙 |

**请求示例:**
```json
{
  "clip_id": "extend 后的 歌曲ID",
  "is_infill": false
}
```

---

### 2.7 歌词生成

仅生成歌词，不生成音乐。

**端点:** `POST /suno/submit/lyrics`

**认证:** 需要 Bearer Token

**参数:**
| 参数 | 类型 | 说明 |
|------|------|------|
| `prompt` | string | 歌词描述或关键词 |

**请求示例:**
```bash
curl -X POST 'https://yunwu.ai/suno/submit/lyrics' \
  -H 'Authorization: Bearer <token>' \
  -H 'Content-Type: application/json' \
  -d '{
    "prompt": "dance"
  }'
```

**响应:**
```json
{
  "code": "success",
  "data": "47443cc1-4902-42ae-ae7f-72a9900544e9",
  "message": ""
}
```

---

## 3. 查询接口

### 3.1 批量获取任务状态

**端点:** `POST /suno/fetch`

**认证:** 需要 Bearer Token

**参数:**
| 参数 | 类型 | 说明 |
|------|------|------|
| `ids` | array | 任务ID列表 |

**请求示例:**
```bash
curl -X POST 'https://yunwu.ai/suno/fetch' \
  -H 'Authorization: Bearer <token>' \
  -H 'Content-Type: application/json' \
  -d '{
    "ids": [
      "b4914cbe-f738-4813-8ac9-4194ae362bed",
      "ccb61d4a-701d-4ef2-b23c-c3ff950fc3b5",
      "276677a3-bd50-4388-83c9-39ce18f7041f"
    ]
  }'
```

**响应:**
```json
{
  "code": "success",
  "data": "47443cc1-4902-42ae-ae7f-72a9900544e9",
  "message": ""
}
```

---

### 3.2 查询单个任务

**端点:** `GET /suno/fetch/{task_id}`

**认证:** 需要 Bearer Token

**请求示例:**
```bash
curl -X GET 'https://yunwu.ai/suno/fetch/b967838b-d377-478d-9a57-d7ca6129ae60' \
  -H 'Authorization: Bearer <token>' \
  -H 'Content-Type: application/json'
```

**响应:**
```json
{
  "code": "success",
  "data": "47443cc1-4902-42ae-ae7f-72a9900544e9",
  "message": ""
}
```

---

### 3.3 获取歌词/音频时间线

**端点:** `GET /suno/act/timing/{id}`

**认证:** 需要 Bearer Token

**说明:** 获取歌曲的歌词和音频对应的时间线数据

**请求示例:**
```bash
curl -X GET 'https://yunwu.ai/suno/act/timing/a624123d-22cc-4d4d-bf28-78d312f61597' \
  -H 'Authorization: Bearer <token>'
```

**响应:**
```json
{
  "code": "task_not_exist",
  "message": "task_not_exist",
  "data": null
}
```

---

### 3.4 获取 WAV 格式音频

**端点:** `GET /suno/act/wav/{clip_id}`

**认证:** 需要 Bearer Token

**说明:** 下载生成的音乐为 WAV 格式

**请求示例:**
```bash
curl -X GET 'https://yunwu.ai/suno/act/wav/9c4f48f1-c0d2-44eb-bf9c-e34d559b374c' \
  -H 'Authorization: Bearer <token>'
```

**响应:**
```json
{
  "code": "success",
  "data": "47443cc1-4902-42ae-ae7f-72a9900544e9",
  "message": ""
}
```

---

### 3.5 场景详情获取

**端点:** `GET /suno/feed/{id}`

**认证:** 需要 Bearer Token

**说明:** 获取完整的场景/任务详情

**请求示例:**
```bash
curl -X GET 'https://yunwu.ai/suno/feed/91c29474-20cd-44c7-8199-f206410651e3' \
  -H 'Authorization: Bearer <token>' \
  -H 'Content-Type: application/json'
```

---

## 4. 音频上传与处理

完整的上传流程涉及6个步骤:

```
请求授权 → S3上传 → 报告完成 → 查询状态 → 初始化Clip → 创建续写任务
```

### 4.1 第1步：请求上传授权

**端点:** `POST /suno/uploads/audio`

**认证:** 不需要(获取上传凭证)

**参数:**
| 参数 | 类型 | 说明 |
|------|------|------|
| `extension` | string | 文件扩展名: `"mp3"` / `"wav"` 等 |

**请求示例:**
```json
{
  "extension": "mp3"
}
```

**响应:**
```json
{
  "id": "f208ab1f-e93a-4417-b089-e7fc38b50268",
  "url": "https://suno-uploads.s3.amazonaws.com/",
  "fields": {
    "Content-Type": "audio/mpeg",
    "key": "raw_uploads/f208ab1f-e93a-4417-b089-e7fc38b50268.mp3",
    "AWSAccessKeyId": "AKIA2V4GXGDKLZ43MUG7",
    "policy": "eyJleHBpcmF0aW9uIjogIjIwMjYtMDEtMDZUMDM6Mjg6MjlaIiwgImNvbmRpdGlvbnMiOiBbWyJjb250ZW50LWxlbmd0aC1yYW5nZSIsIDAsIDUyNDI4ODAwMF0sIFsic3RhcnRzLXdpdGgiLCAiJENvbnRlbnQtVHlwZSIsICJhdWRpby9tcGVnIl0sIHsiYnVja2V0IjogInN1bm8tdXBsb2FkcyJ9LCB7ImtleSI6ICJyYXdfdXBsb2Fkcy9mMjA4YWIxZi1lOTNhLTQ0MTctYjA4OS1lN2ZjMzhiNTAyNjgubXAzIn1dfQ==",
    "signature": "tevxOl3SW28afyLyzObeCYzIvWI="
  },
  "is_file_uploaded": false
}
```

**返回值解释:**
- `id`: 上传ID，后续步骤使用
- `url`: S3 上传目标地址
- `fields`: S3 POST 表单字段(包括认证凭证)
- `is_file_uploaded`: 文件是否已上传

---

### 4.2 第2步：上传文件到 S3

**端点:** `PUT {url}` (返回的 S3 URL)

**方法:** 直接上传到 AWS S3，不经过 API 服务器

**说明:**
- 使用第1步返回的 `url` 和 `fields`
- 将音频文件上传到 S3
- 这是客户端直连操作

**S3 上传示例 (FormData):**
```javascript
const formData = new FormData();
formData.append('Content-Type', 'audio/mpeg');
formData.append('key', 'raw_uploads/f208ab1f-e93a-4417-b089-e7fc38b50268.mp3');
formData.append('AWSAccessKeyId', 'AKIA2V4GXGDKLZ43MUG7');
formData.append('policy', '<base64-policy>');
formData.append('signature', 'tevxOl3SW28afyLyzObeCYzIvWI=');
formData.append('file', audioFile);

fetch('https://suno-uploads.s3.amazonaws.com/', {
  method: 'POST',
  body: formData
});
```

---

### 4.3 第3步：报告上传完毕

**端点:** `POST /suno/uploads/audio/{id}/upload-finish`

**认证:** 需要 Bearer Token

**说明:** 通知服务器文件已成功上传到 S3

**路径参数:**
| 参数 | 说明 |
|------|------|
| `{id}` | 第1步返回的上传 ID |

**请求示例:**
```bash
curl -X POST 'https://yunwu.ai/suno/uploads/audio/f208ab1f-e93a-4417-b089-e7fc38b50268/upload-finish' \
  -H 'Authorization: Bearer <token>'
```

---

### 4.4 第4步：轮询查询上传状态

**端点:** `GET /suno/uploads/audio/{id}`

**认证:** 需要 Bearer Token

**说明:** 轮询检查文件处理状态，直到返回 `completed`

**轮询间隔:** 每 2-3 秒查询一次

**请求示例:**
```bash
curl -X GET 'https://yunwu.ai/suno/uploads/audio/e9451fca-e267-4e7f-b23e-c7419aa79cab' \
  -H 'Authorization: Bearer <token>' \
  -H 'Content-Type: application/json'
```

**响应:**
```json
{
  "id": "c25a8c59-000a-481f-ac28-efde2dc9e677",
  "status": "complete",
  "error_message": null,
  "s3_id": "m_05c9b477-4519-4810-9ffa-00580c082067",
  "title": "S-100096-100096-84069F8B",
  "image_url": "https://cdn1.suno.ai/image_05c9b477-4519-4810-9ffa-00580c082067.png"
}
```

**状态值:**
- `pending` - 处理中
- `complete` - 处理完成
- `error` - 处理失败

---

### 4.5 第5步：初始化音频 Clip

**端点:** `POST /suno/uploads/audio/{id}/initialize-clip`

**认证:** 需要 Bearer Token

**说明:** 将上传的音频初始化为可用的 clip，返回 `clip_id`

**请求示例:**
```bash
curl -X POST 'https://yunwu.ai/suno/uploads/audio/c25a8c59-000a-481f-ac28-efde2dc9e677/initialize-clip' \
  -H 'Authorization: Bearer <token>'
```

**响应:**
```json
{
  "clip_id": "generated-clip-id"
}
```

---

### 4.6 第6步：使用 clip_id 创建续写任务

**端点:** `POST /suno/submit/music`

**说明:** 用第5步返回的 `clip_id` 创建续写任务

**参数:**
```json
{
  "continue_clip_id": "generated-clip-id",
  "continue_at": 10,
  "task": "upload_extend",
  "mv": "chirp-v3-5-tau",
  "title": "标题",
  "prompt": "歌词"
}
```

---

## 5. 参数速查表

### 常用风格标签 (tags)

```
Pop, Rock, Hip-Hop, Electronic, Jazz, Classical, Country,
R&B, Soul, Reggae, Metal, Folk, Latin, Dance, EDM,
Ambient, Indie, Alternative, Gospel, Blues
```

### 音乐风格示例

```json
{
  "romantic, raga": "浪漫 拉格",
  "edm": "电子舞曲",
  "heavy metal": "重金属",
  "electronic, pop": "电子流行"
}
```

### 模型选择指南

| 模型 | 用途 | 特点 |
|------|------|------|
| `chirp-v4` | 默认推荐 | 平衡质量和速度 |
| `chirp-v3-5` | 基础使用 | 稳定可靠 |
| `chirp-v5` | 最新 | 质量最高，处理时间长 |
| `chirp-v3-5-tau` | 上传二次创作 | 专用于上传音频处理 |
| `chirp-v4-tau` | 歌手风格 | 专用于 Artist Consistency |

---

## 6. 错误处理

### 常见错误码

| 错误 | 说明 | 解决方案 |
|------|------|--------|
| `[Invalid parameter]` | 参数错误 | 检查请求参数格式和值 |
| `task_not_exist` | 任务不存在 | 确认任务ID正确 |
| `FAILURE` | 生成失败 | 检查提示词内容，重试任务 |
| `QUEUED` | 排队中 | 继续轮询查询 |

### 轮询策略

```
初始延迟: 2-3秒
最大轮询次数: 300次(约15分钟)
超时处理: 返回失败或重新提交
```

---

## 7. 回调通知

**支持的参数:** `notify_hook`

**用途:** 异步任务完成时接收通知回调

**要求:**
- 请求方式: POST
- 接收数据: 完整的 Task 对象

**回调示例:**
```json
{
  "task_id": "950bf3af-78a6-420e-8c01-3bde0bbb3ef9",
  "action": "MUSIC",
  "status": "SUCCESS",
  "data": {...}
}
```

---

## 8. 完整工作流示例

### 场景1：简单音乐生成

```typescript
// 1. 提交任务
const response = await fetch('https://yunwu.ai/suno/submit/music', {
  method: 'POST',
  headers: {
    'Authorization': 'Bearer <token>',
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({
    prompt: "[Verse]\nYour lyrics here\n[Chorus]\nChorus lyrics",
    title: "My Song",
    tags: "pop, electronic",
    mv: "chirp-v4"
  })
});

const { data: taskId } = await response.json();

// 2. 轮询查询状态
let completed = false;
while (!completed) {
  await new Promise(r => setTimeout(r, 3000)); // 等待3秒

  const statusRes = await fetch(`https://yunwu.ai/suno/fetch/${taskId}`, {
    headers: { 'Authorization': 'Bearer <token>' }
  });

  const { data: task } = await statusRes.json();

  if (task.status === 'SUCCESS') {
    console.log('Music generated:', task.data);
    completed = true;
  } else if (task.status === 'FAILURE') {
    console.error('Failed:', task.failReason);
    completed = true;
  }
}
```

### 场景2：上传音频二次创作

```typescript
// Step 1: 请求上传授权
const authRes = await fetch('https://yunwu.ai/suno/uploads/audio', {
  method: 'POST',
  body: JSON.stringify({ extension: 'mp3' })
});
const { id: uploadId, url, fields } = await authRes.json();

// Step 2: 上传文件到S3
const formData = new FormData();
Object.entries(fields).forEach(([k, v]) => formData.append(k, v));
formData.append('file', audioFile);
await fetch(url, { method: 'POST', body: formData });

// Step 3: 报告上传完毕
await fetch(`https://yunwu.ai/suno/uploads/audio/${uploadId}/upload-finish`, {
  method: 'POST',
  headers: { 'Authorization': 'Bearer <token>' }
});

// Step 4: 轮询等待处理完成
let processing = true;
while (processing) {
  const statusRes = await fetch(`https://yunwu.ai/suno/uploads/audio/${uploadId}`, {
    headers: { 'Authorization': 'Bearer <token>' }
  });
  const { status } = await statusRes.json();
  if (status === 'complete') processing = false;
  else await new Promise(r => setTimeout(r, 2000));
}

// Step 5: 初始化Clip
const clipRes = await fetch(`https://yunwu.ai/suno/uploads/audio/${uploadId}/initialize-clip`, {
  method: 'POST',
  headers: { 'Authorization': 'Bearer <token>' }
});
const { clip_id: clipId } = await clipRes.json();

// Step 6: 创建续写任务
const musicRes = await fetch('https://yunwu.ai/suno/submit/music', {
  method: 'POST',
  headers: {
    'Authorization': 'Bearer <token>',
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({
    continue_clip_id: clipId,
    continue_at: 30,
    task: 'upload_extend',
    mv: 'chirp-v3-5-tau',
    title: 'Extended Version',
    prompt: '[Verse 2]\nNew lyrics...'
  })
});
const { data: taskId } = await musicRes.json();
// ... 轮询查询taskId状态
```

---

## 9. 调试建议

1. **token 验证**: 确保使用有效的 Bearer token
2. **参数验证**: prompt 长度、标签格式必须正确
3. **轮询日志**: 记录每次查询的状态变化
4. **错误日志**: 保存失败原因用于问题排查
5. **速率限制**: 避免过于频繁的查询(建议2-3秒)

---

## 10. 资源链接

- **API 文档**: https://yunwu.apifox.cn/
- **云雾 API**: https://yunwu.ai/
- **Token 管理**: https://yunwu.ai/token
- **余额管理**: https://yunwu.ai/topup

---

**文档版本**: v1.0
**更新日期**: 2026-02-23
**模型版本**: Suno Chirp v3.0 - v5.0
