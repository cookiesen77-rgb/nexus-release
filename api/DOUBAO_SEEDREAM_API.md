# Doubao Painting/Drawing Models API Documentation

## Overview
The Doubao (豆包) series includes the Seedream image generation models, which are integrated into the NexusAPI as OpenAI-compatible endpoints.

---

## API Endpoint

**Base URL**: `https://nexusapi.cn/v1`

**Endpoint Path**: `POST /images/generations`

**Full URL**: `https://nexusapi.cn/v1/images/generations`

---

## Authentication

**Method**: Bearer Token in HTTP Header

**Header Format**:
```
Authorization: Bearer <YOUR_API_KEY>
```

**Additional Headers** (Recommended):
```
Content-Type: application/json
Accept: application/json
```

---

## Available Doubao Models

### 1. doubao-seedream-4-5-251128 (Latest)
- **Status**: Current latest version
- **Type**: Text-to-Image (pure text input, single image output)
- **Display Name**: "豆包 Seedream 4.5"
- **Release Date**: January 28, 2025 (251128 = date suffix)

### 2. doubao-seedream-4-0-250828
- **Status**: Previous version
- **Type**: Text-to-Image and Image-to-Image (with reference images)
- **Display Name**: "豆包 Seedream 4.0"
- **Release Date**: August 28, 2025
- **Notes**: Supports reference images (image-to-image functionality)

### 3. doubao-seedance-1-5-pro-251215 (Video)
- **Status**: Video generation model
- **Type**: Video generation with optional first/last frame control
- **Display Name**: "seedance-1-5-pro"
- **Endpoint**: `POST /volc/v1/contents/generations/tasks`
- **Note**: Separate endpoint for video generation

---

## Request Format

### Request Headers
```
Authorization: Bearer <YOUR_API_KEY>
Content-Type: application/json
Accept: application/json
```

### Request Body (JSON)

**Required Parameters**:
- `model` (string): Model identifier (e.g., "doubao-seedream-4-5-251128")
- `prompt` (string): Image generation prompt in Chinese or English

**Optional Parameters**:

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `size` | string | `2K` | **Two methods (not mixed):**<br/>**Method 1** - Resolution preset: `1K`, `2K`, `4K`<br/>**Method 2** - Pixel dimensions: `WIDTHxHEIGHT` (e.g., `2048x2048`)<br/>Area range: `[1024x1024, 4096x4096]`<br/>Aspect ratio range: `[1/16, 16]` |
| `sequential_image_generation` | string | `disabled` | Controls multiple image generation:<br/>`auto` - Model auto-decides based on prompt<br/>`disabled` - Only generate 1 image (recommended for single output) |
| `stream` | boolean | `false` | Enable streaming output mode |
| `response_format` | string | `url` | Response format:<br/>`url` - Return download link (valid 24 hours)<br/>`b64_json` - Return Base64 encoded JSON |
| `watermark` | boolean | `true` | Add watermark to generated image:<br/>`true` - Add "AI Generated" watermark<br/>`false` - No watermark |
| `image` | array | N/A | Reference images (for image-to-image, v4.0 only):<br/>- Must be HTTPS URLs<br/>- Maximum 1 image for Seedream 4.5<br/>- Used for image-to-image tasks |

---

## Request Examples

### Basic Text-to-Image (Seedream 4.5)
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

### With Specific Dimensions
```bash
curl --location --request POST 'https://nexusapi.cn/v1/images/generations' \
  --header 'Accept: application/json' \
  --header 'Authorization: Bearer <YOUR_API_KEY>' \
  --header 'Content-Type: application/json' \
  --data-raw '{
    "model": "doubao-seedream-4-5-251128",
    "prompt": "cinematic frame style, rainy night street, neon reflection, shallow depth of field",
    "size": "2048x2048",
    "sequential_image_generation": "disabled",
    "response_format": "url",
    "watermark": false
  }'
```

### Image-to-Image (Seedream 4.0)
```bash
curl --location --request POST 'https://nexusapi.cn/v1/images/generations' \
  --header 'Accept: application/json' \
  --header 'Authorization: Bearer <YOUR_API_KEY>' \
  --header 'Content-Type: application/json' \
  --data-raw '{
    "model": "doubao-seedream-4-0-250828",
    "prompt": "移除图片中的帽子",
    "image": [
      "https://example.com/reference-image.png"
    ],
    "sequential_image_generation": "disabled",
    "size": "2K",
    "watermark": false
  }'
```

---

## Response Format

### Success Response (HTTP 200)

**Response Body** (JSON):
```json
{
  "data": [
    {
      "url": "https://ark-content-generation-v2-cn-beijing.tos-cn-beijing.volces.com/doubao-seedream-4-0/..."
    }
  ],
  "created": 1757469067,
  "usage": {
    "prompt_tokens": 0,
    "completion_tokens": 0,
    "total_tokens": 15908,
    "prompt_tokens_details": {
      "cached_tokens_details": {}
    },
    "completion_tokens_details": {},
    "output_tokens": 15908
  }
}
```

**Response Fields**:

| Field | Type | Description |
|-------|------|-------------|
| `data` | array | Generated images array |
| `data[].url` | string | Image download URL (valid 24 hours) |
| `created` | integer | Unix timestamp of generation completion |
| `usage` | object | Token usage statistics |
| `usage.prompt_tokens` | integer | Tokens used for prompt |
| `usage.completion_tokens` | integer | Tokens used for generation |
| `usage.total_tokens` | integer | Total tokens consumed |
| `usage.output_tokens` | integer | Output tokens (image cost) |

### Response Format Variations

**If `response_format: "b64_json"`**:
```json
{
  "data": [
    {
      "b64_json": "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=="
    }
  ],
  "created": 1757469067,
  "usage": { ... }
}
```

---

## Model-Specific Parameters

### Doubao Seedream 4.5 (Latest Recommended)
**Key Characteristics**:
- Text-to-image only (no built-in image-to-image)
- Single image output (uses `sequential_image_generation: "disabled"`)
- Resolution presets: `1K`, `2K` (recommended), `4K`
- Size formats support:
  - **Method 1 (Presets)**: `1K`, `2K`, `4K`
  - **Method 2 (Pixels)**: `WIDTHxHEIGHT` (e.g., `2048x2048`, `3024x1296`)

**Recommended Size Options**:
| Aspect Ratio | Dimensions | Label |
|--------------|------------|-------|
| 21:9 | 3024x1296 | Ultra-wide |
| 16:9 | 2560x1440 | Cinema |
| 4:3 | 2304x1728 | Traditional |
| 3:2 | 2496x1664 | Landscape |
| 1:1 | 2048x2048 | Square |
| 2:3 | 1664x2496 | Portrait |
| 3:4 | 1728x2304 | Tall |
| 9:16 | 1440x2560 | Mobile |
| 9:21 | 1296x3024 | Ultra-tall |

**4K Quality Option Sizes** (4K Resolution):
| Aspect Ratio | Dimensions | Label |
|--------------|------------|-------|
| 21:9 | 6198x2656 | Ultra-wide 4K |
| 16:9 | 5404x3040 | Cinema 4K |
| 4:3 | 4694x3520 | Traditional 4K |
| 3:2 | 4992x3328 | Landscape 4K |
| 1:1 | 4096x4096 | Square 4K |
| 2:3 | 3328x4992 | Portrait 4K |
| 3:4 | 3520x4694 | Tall 4K |
| 9:16 | 3040x5404 | Mobile 4K |
| 9:21 | 2656x6198 | Ultra-tall 4K |

**Default Parameters**:
- Quality (Resolution): `2K`
- Aspect Ratio: `3:4` (portrait)

### Doubao Seedream 4.0
**Key Characteristics**:
- Supports both text-to-image and image-to-image (with reference images)
- Reference images: HTTPS URLs only, maximum 1 image
- Same size options as 4.5
- Can edit/modify reference images based on prompt

**Typical Use Case**:
```json
{
  "model": "doubao-seedream-4-0-250828",
  "prompt": "change the background to sunset",
  "image": ["https://example.com/original-image.jpg"],
  "size": "2K",
  "sequential_image_generation": "disabled",
  "watermark": false
}
```

---

## Error Handling

### Common HTTP Status Codes

| Status | Meaning | Example |
|--------|---------|---------|
| 200 | Success | Image generated successfully |
| 400 | Bad Request | Invalid parameters, missing required fields |
| 401 | Unauthorized | Invalid API key or missing Authorization header |
| 403 | Forbidden | API key valid but lacks image generation permission |
| 429 | Rate Limited | Too many requests, implement exponential backoff |
| 500 | Server Error | NexusAPI backend error |
| 503 | Service Unavailable | Doubao service temporarily unavailable |

### Retry Strategy
- **Transient errors** (429, 5xx): Implement exponential backoff (delay: 2^attempt seconds)
- **Permanent errors** (400, 401, 403): Don't retry, fix the issue

---

## Practical Implementation Notes

### 1. For Character Consistency (Anime/Comic Style)
- Generate first character image with detailed description
- Use Seedream 4.0 with reference image for subsequent scenes
- Prompt should be: "Same character style as reference image, [scene description]"

### 2. For Cinematic Outputs
- Use aspect ratios matching your target format (16:9 for cinema, 9:16 for mobile)
- Include cinematography keywords: "电影分镜" (cinematic frame), "浅景深" (shallow DOF)
- Recommended resolution: `2K` (good balance between speed and quality)

### 3. For Maximum Quality
- Use `4K` resolution
- Disable watermark (`watermark: false`) if you plan to post-process
- Use `b64_json` response format for immediate processing without re-downloading

### 4. Rate Limiting Best Practices
- Implement 2-second delay between requests
- Use exponential backoff for 429 responses
- Monitor `usage.total_tokens` to estimate remaining quota

### 5. URL Validity
- Image URLs are valid for **24 hours** only
- Immediately download generated images if persistence is needed
- Consider converting to base64 or IndexedDB for long-term storage

---

## Integration Status in Nexus Project

**Configuration File**: `/nexus/src/config/models.js`

**Zustand Store Integration**: `src/graph/store.ts`

**API Adapter**: `src/lib/nexusApi.ts`

**Workflow Orchestration**: `src/lib/workflow/image.ts`

**Timeout**: 240 seconds (240000ms) per generation

---

## Official Documentation

- **Apifox API Reference**: https://20474j2h5s.apifox.cn/api-403562528.md
- **NexusAPI Reference**: `/Users/mac/Desktop/nexus创时代/api/NEXUSAPI_REFERENCE.md`
- **Model Routing**: `/Users/mac/Desktop/nexus创时代/api/NEXUSAPI_MODEL_ROUTING.md`
- **Volcengine Docs**: https://www.volcengine.com/docs/82379/1666946

---

## Summary Table

| Property | Value |
|----------|-------|
| **API Endpoint** | POST `https://nexusapi.cn/v1/images/generations` |
| **Auth Method** | Bearer Token |
| **Latest Model** | `doubao-seedream-4-5-251128` |
| **Previous Model** | `doubao-seedream-4-0-250828` |
| **Supported Sizes** | `1K`, `2K`, `4K`, or `WIDTHxHEIGHT` pixels |
| **Max Reference Images** | 1 (for 4.0) |
| **Output Format** | URL (24h validity) or Base64 JSON |
| **Timeout** | 240 seconds |
| **Response Type** | Single image per request |
