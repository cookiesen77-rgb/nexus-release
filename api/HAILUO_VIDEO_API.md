# 海螺 (MiniMax/Hailuo) Video Generation API Documentation

## Overview

This document covers the 海螺 (MiniMax/Hailuo) video generation API endpoints, request/response formats, and polling patterns.

**Base URL**: `https://yunwu.ai/minimax/v1`

**Authentication**: Bearer token in Authorization header

---

## 1. Text-to-Video Generation

### Endpoint
```
POST https://yunwu.ai/minimax/v1/video_generation
```

### Request

#### Headers
```
Authorization: Bearer <token>
Content-Type: application/json
```

#### Body Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `model` | string | Yes | `"MiniMax-Hailuo-02"` |
| `prompt` | string | Yes | Video description in Chinese or English |
| `duration` | integer | Yes | Video duration in seconds (e.g., 10) |

#### Example Request
```json
{
    "model": "MiniMax-Hailuo-02",
    "prompt": "一只小猪在高速公路上快乐的奔跑",
    "duration": 10
}
```

### Response

#### Status: 200 Success
```json
{
    "task_id": "306792606023824",
    "base_resp": {
        "status_code": 0,
        "status_msg": "success"
    }
}
```

---

## 2. Image-to-Video Generation

### Endpoint
```
POST https://yunwu.ai/minimax/v1/video_generation
```

### Request

#### Headers
```
Authorization: Bearer <token>
Content-Type: application/json
```

#### Body Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `model` | string | Yes | `"MiniMax-Hailuo-2.3"` (or appropriate version) |
| `prompt` | string | Yes | Video description |
| `duration` | integer | Yes | Video duration in seconds |
| `first_frame_image` | string | Yes | URL of the starting frame image |
| `resolution` | string | No | `"768P"` (or other resolution) |
| `prompt_optimizer` | boolean | No | `true` to enable prompt optimization |

#### Example Request
```json
{
    "model": "MiniMax-Hailuo-2.3",
    "prompt": "一只小猪在高速公路上快乐的奔跑",
    "duration": 10,
    "first_frame_image": "https://wx4.sinaimg.cn/mw690/8545bf24ly1hq626p2k5aj20j60j7t9t.jpg",
    "resolution": "768P",
    "prompt_optimizer": true
}
```

### Response

#### Status: 200 Success
```json
{
    "task_id": "306792606023824",
    "base_resp": {
        "status_code": 0,
        "status_msg": "success"
    }
}
```

---

## 3. First & Last Frame Video Generation

### Endpoint
```
POST https://yunwu.ai/minimax/v1/video_generation
```

### Request

#### Headers
```
Authorization: Bearer <token>
Content-Type: application/json
```

#### Body Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `model` | string | Yes | `"MiniMax-Hailuo-02"` |
| `prompt` | string | Yes | Video description |
| `duration` | integer | Yes | Video duration in seconds |
| `first_frame_image` | string | Yes | URL of the starting frame image |
| `last_frame_image` | string | Yes | URL of the ending frame image |
| `resolution` | string | No | `"768P"` (or other resolution) |
| `prompt_optimizer` | boolean | No | `true` to enable prompt optimization |

#### Example Request
```json
{
    "model": "MiniMax-Hailuo-02",
    "prompt": "一只小猪在高速公路上快乐的奔跑",
    "duration": 10,
    "first_frame_image": "https://wx4.sinaimg.cn/mw690/8545bf24ly1hq626p2k5aj20j60j7t9t.jpg",
    "last_frame_image": "https://inews.gtimg.com/om_bt/OBcldFgmIx8oKc7VlrEnHqso_pEEeyfa9Va0gHrQR7NBcAA/641",
    "resolution": "768P",
    "prompt_optimizer": true
}
```

### Response

#### Status: 200 Success
```json
{
    "task_id": "306792606023824",
    "base_resp": {
        "status_code": 0,
        "status_msg": "success"
    }
}
```

---

## 4. Video Task Status Polling

### Endpoint
```
GET https://yunwu.ai/minimax/v1/query/video_generation
```

### Request

#### Query Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `task_id` | string | Yes | The task ID returned from creation endpoint |

#### Example
```
GET https://yunwu.ai/minimax/v1/query/video_generation?task_id=306792606023824
```

### Response

#### Status: 200 Success
```json
{
    "code": "success",
    "message": "",
    "data": {
        "task_id": "306792606023824",
        "action": "video_generation",
        "status": "SUCCESS",
        "fail_reason": "306793063383292",
        "submit_time": 1756453472,
        "start_time": 0,
        "finish_time": 1756453535,
        "progress": "100%",
        "data": {
            "file": {
                "bytes": 0,
                "file_id": 306793063383292,
                "purpose": "video_generation",
                "filename": "output.mp4",
                "created_at": 1756453566,
                "download_url": "https://public-cdn-video-data-algeng.oss-cn-wulanchabu.aliyuncs.com/inference_output%2Fvideo%2F2025-08-29%2F454554d4-6485-469b-8eff-f6786bbaff62%2Foutput.mp4?Expires=1756485985&OSSAccessKeyId=LTAI5tAmwsjSaaZVA6cEFAUu&Signature=5DmRk6grPMEwP7rLq0LwJbi633A%3D",
                "backup_download_url": "https://public-cdn-video-data-algeng-us.oss-us-east-1.aliyuncs.com/inference_output%2Fvideo%2F2025-08-29%2F454554d4-6485-469b-8eff-f6786bbaff62%2Foutput.mp4?Expires=1756485985&OSSAccessKeyId=LTAI5tCpJNKCf5EkQHSuL9xg&Signature=ouuhy8toH%2B58BJOIvnM57Iw5zyc%3D"
            },
            "status": "Success",
            "file_id": "306793063383292",
            "task_id": "306792606023824",
            "base_resp": {
                "status_msg": "success",
                "status_code": 0
            },
            "video_width": 1366,
            "video_height": 768
        }
    }
}
```

---

## Task Status Constants

### Response Status Values

| Status | Description |
|--------|-------------|
| `Waiting` | Task is waiting to be processed |
| `Running` | Task is currently being processed |
| `Success` | Task completed successfully |
| `Failed` | Task failed |
| `Cancelled` | Task was cancelled |

### Base Response Status Codes

| Code | Message | Meaning |
|------|---------|---------|
| `0` | `"success"` | Successful |
| Other | Various | Error occurred |

---

## Authentication

All requests require the `Authorization` header with Bearer token format:

```
Authorization: Bearer <YOUR_API_TOKEN>
```

To obtain an API token:
1. Visit https://yunwu.ai/token
2. Create a new token for your application
3. Include the token in every request

---

## Implementation Notes

### Polling Pattern for Video Generation

1. **Submit task** → GET `task_id`
2. **Poll status** using `task_id` at regular intervals (e.g., every 2-5 seconds)
3. **Check status** in response:
   - If `"Success"` → Download video from `download_url`
   - If `"Running"` or `"Waiting"` → Continue polling
   - If `"Failed"` or `"Cancelled"` → Handle error

### Retry Strategy

- Implement exponential backoff for transient failures
- Initial delay: 2 seconds
- Max delay: 30 seconds
- Max retries: 10-15 attempts (typical video generation takes 30-120 seconds)

### Download URL Validity

- Video download URLs include expiration timestamps
- Use `download_url` as primary source
- Use `backup_download_url` if primary fails
- URLs expire after several hours; store videos immediately after generation

### Model Selection

- **Text-to-video**: Use `"MiniMax-Hailuo-02"`
- **Image-to-video**: Use `"MiniMax-Hailuo-2.3"`
- **First/Last frame**: Use `"MiniMax-Hailuo-02"`

### Resolution Support

- Common: `"768P"` (768p resolution)
- Other resolutions may be supported; check latest documentation

### Prompt Optimization

- When `"prompt_optimizer": true`, the system automatically enhances the prompt for better results
- Recommended: Enable for better quality output

---

## Error Handling

### Common Error Scenarios

1. **Invalid token**: Check Authorization header and token validity
2. **Rate limiting**: Implement backoff and retry
3. **Invalid model**: Verify model name matches your version
4. **Invalid image URL**: Ensure URLs are publicly accessible and properly formatted
5. **Task timeout**: Set reasonable maximum polling time (e.g., 300 seconds)

### Response Structure on Error

```json
{
    "base_resp": {
        "status_code": <error_code>,
        "status_msg": "<error_message>"
    }
}
```

---

## Integration Example (TypeScript)

```typescript
import axios from 'axios';

const API_BASE = 'https://yunwu.ai/minimax/v1';
const API_KEY = 'your-api-key';

interface VideoGenerationRequest {
  model: string;
  prompt: string;
  duration: number;
  first_frame_image?: string;
  last_frame_image?: string;
  resolution?: string;
  prompt_optimizer?: boolean;
}

interface VideoTaskResponse {
  task_id: string;
  base_resp: {
    status_code: number;
    status_msg: string;
  };
}

interface VideoStatusResponse {
  code: string;
  message: string;
  data: {
    status: 'Waiting' | 'Running' | 'Success' | 'Failed' | 'Cancelled';
    progress: string;
    data?: {
      file: {
        download_url: string;
        backup_download_url: string;
      };
      video_width: number;
      video_height: number;
    };
  };
}

async function createVideoTask(request: VideoGenerationRequest): Promise<string> {
  const response = await axios.post<VideoTaskResponse>(
    `${API_BASE}/video_generation`,
    request,
    {
      headers: {
        Authorization: `Bearer ${API_KEY}`,
        'Content-Type': 'application/json',
      },
    }
  );

  if (response.data.base_resp.status_code !== 0) {
    throw new Error(`Task creation failed: ${response.data.base_resp.status_msg}`);
  }

  return response.data.task_id;
}

async function pollVideoStatus(taskId: string): Promise<VideoStatusResponse['data']> {
  const maxAttempts = 15;
  let attempt = 0;
  let delay = 2000; // 2 seconds

  while (attempt < maxAttempts) {
    try {
      const response = await axios.get<VideoStatusResponse>(
        `${API_BASE}/query/video_generation`,
        {
          params: { task_id: taskId },
          headers: {
            Authorization: `Bearer ${API_KEY}`,
          },
        }
      );

      const { status, data } = response.data.data;

      if (status === 'Success') {
        return response.data.data;
      } else if (status === 'Failed' || status === 'Cancelled') {
        throw new Error(`Task ${status.toLowerCase()}`);
      }

      // Still processing, wait and retry
      await new Promise(resolve => setTimeout(resolve, delay));
      delay = Math.min(delay * 1.5, 30000); // Exponential backoff, max 30s
      attempt++;
    } catch (error) {
      if (attempt >= maxAttempts) throw error;
      await new Promise(resolve => setTimeout(resolve, delay));
      delay = Math.min(delay * 1.5, 30000);
      attempt++;
    }
  }

  throw new Error('Task polling timeout');
}

// Usage example
async function generateVideo() {
  try {
    // Create task
    const taskId = await createVideoTask({
      model: 'MiniMax-Hailuo-02',
      prompt: 'A cat running through a sunny garden',
      duration: 10,
    });

    console.log(`Task created: ${taskId}`);

    // Poll for completion
    const result = await pollVideoStatus(taskId);

    console.log(`Video ready at: ${result.data?.file.download_url}`);
    return result.data?.file.download_url;
  } catch (error) {
    console.error('Video generation failed:', error);
    throw error;
  }
}
```

---

## Related Resources

- **Yunwu API Documentation**: https://yunwu.apifox.cn/
- **Token Management**: https://yunwu.ai/token
- **Account Balance**: https://yunwu.ai/topup

