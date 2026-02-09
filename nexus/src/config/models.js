/**
 * Models Configuration | 模型配置
 * Centralized model configuration | 集中模型配置
 */

import { DEFAULT_API_BASE_URL } from '@/utils/constants'

const NEXUS_ORIGIN = new URL(DEFAULT_API_BASE_URL).origin
const toAbsoluteUrl = (path) => `${NEXUS_ORIGIN}${path.startsWith('/') ? path : `/${path}`}`

// Backward-compatible aliases (old saved projects / old UI keys) | 兼容旧项目里保存的模型 key
// 说明：本项目最终会把 modelConfig.key 作为请求体的 model 值发送；这里仅做"旧 key → 新 key"兼容。
const MODEL_ALIASES = {
    // Images
    'gpt-image-1.5': 'gpt-image-1.5-all',
    // Videos - Veo 旧 key 兼容迁移
    'veo3.1-4k': 'veo3.1',
    'veo_3_1-components': 'veo3.1-components',
    'veo_3_1-fast-components-4K': 'veo3.1-fast-components',
    'sora-2-pro': 'sora-2-all',
    // Tencent AIGC Video（已移除）兼容旧 key：迁移到新模型或默认视频模型，避免旧工程打开后变成图片模型
    'aigc-video-vidu': 'sora-2-all',
    'vidu-q2-turbo': 'sora-2-all',
    'vidu-q2': 'sora-2-all',
    'vidu-q2-pro': 'sora-2-all',
    // Hailuo（旧 AIGC 走腾讯）迁移到云雾海螺（MiniMax）端点
    'aigc-video-hailuo': 'MiniMax-Hailuo-2.3-Fast',
    'hailuo-2.3-fast': 'MiniMax-Hailuo-2.3-Fast',
    'hailuo-2.3': 'MiniMax-Hailuo-2.3',
    'hailuo-02': 'MiniMax-Hailuo-02',
    // Kling（旧 AIGC 走腾讯）迁移到 Kling 官方 /kling/v1 视频端点
    'kling-2.5': 'kling-video',
    'kling-2.1': 'kling-video',
    'kling-2.0': 'kling-video',
    'kling-1.6': 'kling-video',
    'kling-o1': 'kling-video',
}

// Seedream image size options | 豆包图片尺寸选项
export const SEEDREAM_SIZE_OPTIONS = [
    { label: '21:9', key: '3024x1296' },
    { label: '16:9', key: '2560x1440' },
    { label: '4:3', key: '2304x1728' },
    { label: '3:2', key: '2496x1664' },
    { label: '1:1', key: '2048x2048' },
    { label: '2:3', key: '1664x2496' },
    { label: '3:4', key: '1728x2304' },
    { label: '9:16', key: '1440x2560' },
    { label: '9:21', key: '1296x3024' }
]

// Seedream 4K image size options | 豆包4K图片尺寸选项
export const SEEDREAM_4K_SIZE_OPTIONS = [
    { label: '21:9', key: '6198x2656' },
    { label: '16:9', key: '5404x3040' },
    { label: '4:3', key: '4694x3520' },
    { label: '3:2', key: '4992x3328' },
    { label: '1:1', key: '4096x4096' },
    { label: '2:3', key: '3328x4992' },
    { label: '3:4', key: '3520x4694' },
    { label: '9:16', key: '3040x5404' },
    { label: '9:21', key: '2656x6198' }
]

// Seedream quality options | 豆包画质选项
export const SEEDREAM_QUALITY_OPTIONS = [
    { label: '标准画质', key: 'standard' },
    { label: '4K 高清', key: '4k' }
]

// Image generation models | 图片生成模型
export const IMAGE_MODELS = [
    {
        label: 'nano-banana-pro',
        key: 'gemini-3-pro-image-preview',
        endpoint: toAbsoluteUrl('/v1beta/models/gemini-3-pro-image-preview:generateContent'),
        authMode: 'query',
        format: 'gemini-image',
        timeout: 240000,
        tips: '支持多张参考图 + 提示词（最多 14 张参考图）',
        // 能力描述（用于 UI 限制与运行时校验）
        requiresPrompt: false,
        supportsReferenceImages: true,
        maxRefImages: 14,
        sizes: ['1:1', '16:9', '9:16', '4:3', '3:4'],
        qualities: [
            { label: '1K', key: '1K' },
            { label: '2K', key: '2K' },
            { label: '4K', key: '4K' }
        ],
        defaultParams: {
            size: '3:4',
            quality: '2K'
        }
    },
    {
        label: '豆包 Seedream 4.5（doubao-seedream-4-5-251128）',
        key: 'doubao-seedream-4-5-251128',
        endpoint: '/images/generations',
        authMode: 'bearer',
        format: 'doubao-seedream',
        timeout: 240000,
        tips: '参考图目前仅支持 1 张。',
        // 能力描述（用于 UI 限制与运行时校验）
        requiresPrompt: true,
        supportsReferenceImages: true,
        maxRefImages: 1,
        // 分辨率（方式1）：1K/2K/4K；尺寸（方式2）：通过像素宽高来精确指定比例
        qualities: [
            { label: '1K', key: '1K' },
            { label: '2K', key: '2K' },
            { label: '4K', key: '4K' }
        ],
        // 尺寸：仅展示比例；最终会根据“分辨率+比例”映射成具体像素值写入 size 字段
        sizes: SEEDREAM_SIZE_OPTIONS.map((o) => o.label),
        defaultParams: {
            size: '3:4',
            quality: '2K'
        }
    },
    {
        label: '豆包 Seedream 4.0（doubao-seedream-4-0-250828）',
        key: 'doubao-seedream-4-0-250828',
        endpoint: '/images/generations',
        authMode: 'bearer',
        format: 'doubao-seedream',
        timeout: 240000,
        tips: '支持文生图/图生图；参考图需 http(s) URL，当前最多 1 张。',
        // 能力描述（用于 UI 限制与运行时校验）
        requiresPrompt: true,
        supportsReferenceImages: true,
        maxRefImages: 1,
        // 分辨率（方式1）：1K/2K/4K；尺寸（方式2）：通过像素宽高来精确指定比例
        qualities: [
            { label: '1K', key: '1K' },
            { label: '2K', key: '2K' },
            { label: '4K', key: '4K' }
        ],
        // 尺寸：仅展示比例；最终会根据“分辨率+比例”映射成具体像素值写入 size 字段
        sizes: SEEDREAM_SIZE_OPTIONS.map((o) => o.label),
        defaultParams: {
            size: '3:4',
            quality: '2K'
        }
    },
    {
        label: 'Grok 4 Image（Chat Completions）',
        key: 'grok-4-image',
        endpoint: '/chat/completions',
        authMode: 'bearer',
        format: 'openai-chat-image',
        tips: '以 Chat 方式生图，建议在提示词里要求返回图片 URL 或 dataURI',
        requiresPrompt: true,
        supportsReferenceImages: false,
        maxRefImages: 0,
        sizes: [],
        defaultParams: {
            quality: 'standard'
        }
    },
    {
        label: 'Kling Image（kling-v2-1）',
        key: 'kling-image',
        endpoint: toAbsoluteUrl('/kling/v1/images/generations'),
        authMode: 'bearer',
        format: 'kling-image',
        tips: 'Kling 生图（支持参考图）；本项目固定 model_name=kling-v2-1',
        requiresPrompt: true,
        supportsReferenceImages: true,
        maxRefImages: 1,
        sizes: ['1:1', '2:3', '3:2', '4:3', '3:4', '16:9', '9:16', '21:9'],
        qualities: [
            { label: '1K（标清）', key: '1k' },
            { label: '2K（高清）', key: '2k' }
        ],
        defaultParams: {
            model_name: 'kling-v2-1',
            size: '1:1',
            quality: '1k',
            n: 1
        }
    },
    {
        label: 'Kling Omni-Image（kling-image-o1）',
        key: 'kling-omni-image',
        endpoint: toAbsoluteUrl('/kling/v1/images/omni-image'),
        statusEndpoint: (id) => toAbsoluteUrl(`/kling/v1/images/omni-image/${id}`),
        authMode: 'bearer',
        format: 'kling-omni-image',
        tips: 'Kling Omni-Image：提示词必填；可选多张参考图（主体/场景/风格等）。',
        requiresPrompt: true,
        supportsReferenceImages: true,
        // 文档未显式给出上限；这里做保守上限，避免一次提交过多图片导致上游失败
        maxRefImages: 6,
        sizes: ['auto', '16:9', '9:16', '1:1', '4:3', '3:4', '3:2', '2:3', '21:9'],
        qualities: [
            { label: '1K（标清）', key: '1k' },
            { label: '2K（高清）', key: '2k' }
        ],
        defaultParams: {
            model_name: 'kling-image-o1',
            size: 'auto',
            quality: '1k',
            n: 1
        }
    },
    {
        label: 'Flux Pro 1.1 Ultra',
        key: 'flux-pro-1.1-ultra',
        endpoint: '/images/generations',
        authMode: 'bearer',
        format: 'openai-image',
        tips: 'OpenAI Images 兼容生图（返回 url 或 b64_json）',
        requiresPrompt: true,
        supportsReferenceImages: false,
        maxRefImages: 0,
        sizes: ['1024x1024', '1536x1024', '1024x1536'],
        defaultParams: {
            size: '1024x1024',
            quality: 'standard'
        }
    },
    {
        label: 'GPT Image 1.5 (All)',
        key: 'gpt-image-1.5-all',
        endpoint: '/images/generations',
        authMode: 'bearer',
        format: 'openai-image',
        tips: '不支持参考图输入（仅使用提示词生成）',
        requiresPrompt: true,
        supportsReferenceImages: false,
        maxRefImages: 0,
        sizes: ['1024x1024', '1536x1024', '1024x1536'],
        defaultParams: {
            size: '1024x1024',
            quality: 'standard'
        }
    },
    {
        label: '通义千问生图 (Chat)',
        key: 'qwen-image-max',
        endpoint: '/chat/completions',
        authMode: 'bearer',
        format: 'openai-chat-image',
        tips: '以 Chat 方式生图，建议在提示词里要求返回图片 URL 或 dataURI',
        requiresPrompt: true,
        supportsReferenceImages: false,
        maxRefImages: 0,
        sizes: [],
        defaultParams: {
            quality: 'standard'
        }
    },
    {
        label: '通义千问编辑',
        key: 'qwen-image-edit-2509',
        endpoint: '/images/generations',
        authMode: 'bearer',
        format: 'openai-image-edit',
        tips: '需要参考图 + 提示词（使用第一张参考图）',
        requiresPrompt: true,
        supportsReferenceImages: true,
        maxRefImages: 1,
        requiresReferenceImages: true,
        sizes: [],
        defaultParams: {
            quality: 'standard'
        }
    },
    {
        label: 'Qwen 多角度转换（Multiple-angles）',
        key: 'qwen-edit-multiple-angles',
        endpoint: 'https://fal.run/fal-ai/qwen-image-edit-2509-lora-gallery/multiple-angles',
        statusEndpoint: (requestId) => `https://fal.run/fal-ai/qwen-image-edit-2509-lora-gallery/multiple-angles/requests/${requestId}/status`,
        resultEndpoint: (requestId) => `https://fal.run/fal-ai/qwen-image-edit-2509-lora-gallery/multiple-angles/requests/${requestId}`,
        authMode: 'fal-key',
        format: 'fal-multiple-angles',
        timeout: 120000,
        tips: '需要参考图；通过自然语言或参数控制相机角度：旋转、推进、俯仰、广角等。费用: $0.035/百万像素。',
        requiresPrompt: false,
        supportsReferenceImages: true,
        maxRefImages: 1,
        requiresReferenceImages: true,
        sizes: ['square_hd', 'square', 'portrait_4_3', 'portrait_16_9', 'landscape_4_3', 'landscape_16_9'],
        // 相机控制参数
        cameraControls: {
            rotateRightLeft: { min: -180, max: 180, default: 0, label: '左右旋转 (°)', tip: '正值右转，负值左转' },
            moveForward: { min: 0, max: 10, default: 0, label: '推进（特写）', tip: '0=原位，10=特写' },
            verticalAngle: { min: -1, max: 1, default: 0, label: '俯仰角度', tip: '-1=仰视，0=平视，1=俯视' },
            wideAngleLens: { type: 'boolean', default: false, label: '广角镜头' }
        },
        defaultParams: {
            guidance_scale: 1,
            num_inference_steps: 6,
            lora_scale: 1.25,
            output_format: 'png',
            num_images: 1
        }
    },
    {
        label: 'Tencent AIGC Gem',
        key: 'aigc-image-gem',
        endpoint: toAbsoluteUrl('/tencent-vod/v1/aigc-image'),
        authMode: 'bearer',
        format: 'tencent-image',
        tips: '仅提示词生图（不支持参考图输入）',
        requiresPrompt: true,
        supportsReferenceImages: false,
        maxRefImages: 0,
        defaultParams: {
            version: '3.0',
            clarity: '2k'
        }
    },
    {
        label: 'Tencent AIGC Qwen',
        key: 'aigc-image-qwen',
        endpoint: toAbsoluteUrl('/tencent-vod/v1/aigc-image'),
        authMode: 'bearer',
        format: 'tencent-image',
        tips: '仅提示词生图（不支持参考图输入）',
        requiresPrompt: true,
        supportsReferenceImages: false,
        maxRefImages: 0,
        defaultParams: {
            version: '0925',
            clarity: '2k'
        }
    }
]

// Video ratio options | 视频比例选项
export const VIDEO_RATIO_LIST = [
    { label: '16:9 (横版)', key: '16:9' },
    { label: '4:3', key: '4:3' },
    { label: '1:1 (方形)', key: '1:1' },
    { label: '3:4', key: '3:4' },
    { label: '9:16 (竖版)', key: '9:16' }
]

// Video generation models | 视频生成模型
export const VIDEO_MODELS = [
    // ======== Veo 3.1 视频统一格式（固定8秒） ========
    {
        label: 'Veo 3.1 Fast',
        key: 'veo3.1-fast',
        endpoint: '/v1/videos',
        statusEndpoint: (id) => `/v1/videos/${id}`,
        authMode: 'bearer',
        format: 'veo-openai',
        maxImages: 2,
        tips: '支持首尾帧；固定 8 秒时长',
        requiresPrompt: true,
        supportsFirstFrame: true,
        supportsLastFrame: true,
        supportsReferenceImages: false,
        maxRefImages: 0,
        ratios: ['16:9', '9:16'],
        durs: [{ label: '8 秒', key: 8 }],
        defaultParams: { ratio: '16:9', duration: 8 }
    },
    {
        label: 'Veo 3.1 Fast Components',
        key: 'veo3.1-fast-components',
        endpoint: '/v1/videos',
        statusEndpoint: (id) => `/v1/videos/${id}`,
        authMode: 'bearer',
        format: 'veo-openai',
        maxImages: 2,
        tips: '支持首尾帧；固定 8 秒时长',
        requiresPrompt: true,
        supportsFirstFrame: true,
        supportsLastFrame: true,
        supportsReferenceImages: false,
        maxRefImages: 0,
        ratios: ['16:9', '9:16'],
        durs: [{ label: '8 秒', key: 8 }],
        defaultParams: { ratio: '16:9', duration: 8 }
    },
    {
        label: 'Veo 3.1 Components',
        key: 'veo3.1-components',
        endpoint: '/v1/videos',
        statusEndpoint: (id) => `/v1/videos/${id}`,
        authMode: 'bearer',
        format: 'veo-openai',
        maxImages: 2,
        tips: '支持首尾帧；固定 8 秒时长',
        requiresPrompt: true,
        supportsFirstFrame: true,
        supportsLastFrame: true,
        supportsReferenceImages: false,
        maxRefImages: 0,
        ratios: ['16:9', '9:16'],
        durs: [{ label: '8 秒', key: 8 }],
        defaultParams: { ratio: '16:9', duration: 8 }
    },
    {
        label: 'Veo 3.1',
        key: 'veo3.1',
        endpoint: '/v1/videos',
        statusEndpoint: (id) => `/v1/videos/${id}`,
        authMode: 'bearer',
        format: 'veo-openai',
        maxImages: 2,
        tips: '支持首尾帧；固定 8 秒时长',
        requiresPrompt: true,
        supportsFirstFrame: true,
        supportsLastFrame: true,
        supportsReferenceImages: false,
        maxRefImages: 0,
        ratios: ['16:9', '9:16'],
        durs: [{ label: '8 秒', key: 8 }],
        defaultParams: { ratio: '16:9', duration: 8 }
    },
    {
        label: 'Veo 3.1 Pro',
        key: 'veo3.1-pro',
        endpoint: '/v1/videos',
        statusEndpoint: (id) => `/v1/videos/${id}`,
        authMode: 'bearer',
        format: 'veo-openai',
        maxImages: 2,
        tips: '支持首尾帧；固定 8 秒时长',
        requiresPrompt: true,
        supportsFirstFrame: true,
        supportsLastFrame: true,
        supportsReferenceImages: false,
        maxRefImages: 0,
        ratios: ['16:9', '9:16'],
        durs: [{ label: '8 秒', key: 8 }],
        defaultParams: { ratio: '16:9', duration: 8 }
    },
    {
        label: 'Veo 3.1 Pro 4K',
        key: 'veo3.1-pro-4k',
        endpoint: '/v1/videos',
        statusEndpoint: (id) => `/v1/videos/${id}`,
        authMode: 'bearer',
        format: 'veo-openai',
        maxImages: 2,
        tips: '支持首尾帧；固定 8 秒时长',
        requiresPrompt: true,
        supportsFirstFrame: true,
        supportsLastFrame: true,
        supportsReferenceImages: false,
        maxRefImages: 0,
        ratios: ['16:9', '9:16'],
        durs: [{ label: '8 秒', key: 8 }],
        defaultParams: { ratio: '16:9', duration: 8 }
    },
    // ======== Veo 3.1 OpenAI视频格式（可选4/6/8秒） ========
    {
        label: 'Veo 3.1（OpenAI格式）',
        key: 'veo_3_1',
        endpoint: '/v1/videos',
        statusEndpoint: (id) => `/v1/videos/${id}`,
        authMode: 'bearer',
        format: 'veo-openai',
        maxImages: 2,
        tips: '支持首尾帧；可选 4/6/8 秒时长',
        requiresPrompt: true,
        supportsFirstFrame: true,
        supportsLastFrame: true,
        supportsReferenceImages: false,
        maxRefImages: 0,
        ratios: ['16:9', '9:16'],
        durs: [{ label: '4 秒', key: 4 }, { label: '6 秒', key: 6 }, { label: '8 秒', key: 8 }],
        defaultParams: { ratio: '16:9', duration: 8 }
    },
    {
        label: 'Veo 3.1 Fast（OpenAI格式）',
        key: 'veo_3_1-fast',
        endpoint: '/v1/videos',
        statusEndpoint: (id) => `/v1/videos/${id}`,
        authMode: 'bearer',
        format: 'veo-openai',
        maxImages: 2,
        tips: '支持首尾帧；可选 4/6/8 秒时长',
        requiresPrompt: true,
        supportsFirstFrame: true,
        supportsLastFrame: true,
        supportsReferenceImages: false,
        maxRefImages: 0,
        ratios: ['16:9', '9:16'],
        durs: [{ label: '4 秒', key: 4 }, { label: '6 秒', key: 6 }, { label: '8 秒', key: 8 }],
        defaultParams: { ratio: '16:9', duration: 8 }
    },
    {
        label: 'Veo 3.1 Fast 4K（OpenAI格式）',
        key: 'veo_3_1-fast-4K',
        endpoint: '/v1/videos',
        statusEndpoint: (id) => `/v1/videos/${id}`,
        authMode: 'bearer',
        format: 'veo-openai',
        maxImages: 2,
        tips: '支持首尾帧；可选 4/6/8 秒时长；4K分辨率',
        requiresPrompt: true,
        supportsFirstFrame: true,
        supportsLastFrame: true,
        supportsReferenceImages: false,
        maxRefImages: 0,
        ratios: ['16:9', '9:16'],
        durs: [{ label: '4 秒', key: 4 }, { label: '6 秒', key: 6 }, { label: '8 秒', key: 8 }],
        defaultParams: { ratio: '16:9', duration: 8 }
    },
    {
        label: 'Veo 3.1 4K（OpenAI格式）',
        key: 'veo_3_1-4K',
        endpoint: '/v1/videos',
        statusEndpoint: (id) => `/v1/videos/${id}`,
        authMode: 'bearer',
        format: 'veo-openai',
        maxImages: 2,
        tips: '支持首尾帧；可选 4/6/8 秒时长；4K分辨率',
        requiresPrompt: true,
        supportsFirstFrame: true,
        supportsLastFrame: true,
        supportsReferenceImages: false,
        maxRefImages: 0,
        ratios: ['16:9', '9:16'],
        durs: [{ label: '4 秒', key: 4 }, { label: '6 秒', key: 6 }, { label: '8 秒', key: 8 }],
        defaultParams: { ratio: '16:9', duration: 8 }
    },
    {
        label: 'Veo 3.1 Fast Components 4K（OpenAI格式）',
        key: 'veo_3_1-fast-components-4K',
        endpoint: '/v1/videos',
        statusEndpoint: (id) => `/v1/videos/${id}`,
        authMode: 'bearer',
        format: 'veo-openai',
        maxImages: 2,
        tips: '支持首尾帧；可选 4/6/8 秒时长；4K分辨率',
        requiresPrompt: true,
        supportsFirstFrame: true,
        supportsLastFrame: true,
        supportsReferenceImages: false,
        maxRefImages: 0,
        ratios: ['16:9', '9:16'],
        durs: [{ label: '4 秒', key: 4 }, { label: '6 秒', key: 6 }, { label: '8 秒', key: 8 }],
        defaultParams: { ratio: '16:9', duration: 8 }
    },
    {
        label: 'Kling 视频（kling-v2-6 · pro）',
        key: 'kling-video',
        // 注意：Kling 走 /kling/v1/...，不是 /v1/...（需用绝对 URL，避免多拼一个 /v1）
        endpoint: toAbsoluteUrl('/kling/v1/videos/text2video'),
        statusEndpoint: (id) => toAbsoluteUrl(`/kling/v1/videos/text2video/${id}`),
        authMode: 'bearer',
        format: 'kling-video',
        // 图生视频：首帧/尾帧最多 2 张；也允许把“参考图”当作首帧（最多 1 张参考图）
        maxImages: 2,
        tips: 'Kling 视频：文生需提示词；图生需首帧，可选尾帧；参考图最多 1 张（等同首帧）。默认：model_name=kling-v2-6，mode=pro，sound=off。',
        requiresPrompt: false,
        supportsFirstFrame: true,
        supportsLastFrame: true,
        supportsReferenceImages: true,
        maxRefImages: 1,
        ratios: ['16:9', '9:16', '1:1'],
        durs: [{ label: '5 秒', key: 5 }, { label: '10 秒', key: 10 }],
        defaultParams: { ratio: '16:9', duration: 5, model_name: 'kling-v2-6', mode: 'pro', sound: 'off' },
        // 额外端点（图生视频）
        endpointImage: toAbsoluteUrl('/kling/v1/videos/image2video'),
        statusEndpointImage: (id) => toAbsoluteUrl(`/kling/v1/videos/image2video/${id}`)
    },
    // ======== Kling Video 多版本（按云雾可灵 Kling 平台价格表补齐） ========
    {
        label: 'Kling 视频（kling-v1 · std）',
        key: 'kling-v1-std',
        endpoint: toAbsoluteUrl('/kling/v1/videos/text2video'),
        statusEndpoint: (id) => toAbsoluteUrl(`/kling/v1/videos/text2video/${id}`),
        authMode: 'bearer',
        format: 'kling-video',
        maxImages: 2,
        tips: 'model_name=kling-v1，mode=std，sound=off；支持 5/10 秒。文生需提示词；图生需首帧，可选尾帧；参考图最多 1 张（等同首帧）。',
        requiresPrompt: false,
        supportsFirstFrame: true,
        supportsLastFrame: true,
        supportsReferenceImages: true,
        maxRefImages: 1,
        ratios: ['16:9', '9:16', '1:1'],
        durs: [{ label: '5 秒', key: 5 }, { label: '10 秒', key: 10 }],
        defaultParams: { ratio: '16:9', duration: 5, model_name: 'kling-v1', mode: 'std', sound: 'off' },
        endpointImage: toAbsoluteUrl('/kling/v1/videos/image2video'),
        statusEndpointImage: (id) => toAbsoluteUrl(`/kling/v1/videos/image2video/${id}`)
    },
    {
        label: 'Kling 视频（kling-v1 · pro）',
        key: 'kling-v1-pro',
        endpoint: toAbsoluteUrl('/kling/v1/videos/text2video'),
        statusEndpoint: (id) => toAbsoluteUrl(`/kling/v1/videos/text2video/${id}`),
        authMode: 'bearer',
        format: 'kling-video',
        maxImages: 2,
        tips: 'model_name=kling-v1，mode=pro，sound=off；支持 5/10 秒。文生需提示词；图生需首帧，可选尾帧；参考图最多 1 张（等同首帧）。',
        requiresPrompt: false,
        supportsFirstFrame: true,
        supportsLastFrame: true,
        supportsReferenceImages: true,
        maxRefImages: 1,
        ratios: ['16:9', '9:16', '1:1'],
        durs: [{ label: '5 秒', key: 5 }, { label: '10 秒', key: 10 }],
        defaultParams: { ratio: '16:9', duration: 5, model_name: 'kling-v1', mode: 'pro', sound: 'off' },
        endpointImage: toAbsoluteUrl('/kling/v1/videos/image2video'),
        statusEndpointImage: (id) => toAbsoluteUrl(`/kling/v1/videos/image2video/${id}`)
    },
    {
        label: 'Kling 视频（kling-v1-5 · std）',
        key: 'kling-v1-5-std',
        endpoint: toAbsoluteUrl('/kling/v1/videos/text2video'),
        statusEndpoint: (id) => toAbsoluteUrl(`/kling/v1/videos/text2video/${id}`),
        authMode: 'bearer',
        format: 'kling-video',
        maxImages: 2,
        tips: 'model_name=kling-v1-5，mode=std，sound=off；支持 5/10 秒。文生需提示词；图生需首帧，可选尾帧；参考图最多 1 张（等同首帧）。',
        requiresPrompt: false,
        supportsFirstFrame: true,
        supportsLastFrame: true,
        supportsReferenceImages: true,
        maxRefImages: 1,
        ratios: ['16:9', '9:16', '1:1'],
        durs: [{ label: '5 秒', key: 5 }, { label: '10 秒', key: 10 }],
        defaultParams: { ratio: '16:9', duration: 5, model_name: 'kling-v1-5', mode: 'std', sound: 'off' },
        endpointImage: toAbsoluteUrl('/kling/v1/videos/image2video'),
        statusEndpointImage: (id) => toAbsoluteUrl(`/kling/v1/videos/image2video/${id}`)
    },
    {
        label: 'Kling 视频（kling-v1-5 · pro）',
        key: 'kling-v1-5-pro',
        endpoint: toAbsoluteUrl('/kling/v1/videos/text2video'),
        statusEndpoint: (id) => toAbsoluteUrl(`/kling/v1/videos/text2video/${id}`),
        authMode: 'bearer',
        format: 'kling-video',
        maxImages: 2,
        tips: 'model_name=kling-v1-5，mode=pro，sound=off；支持 5/10 秒。文生需提示词；图生需首帧，可选尾帧；参考图最多 1 张（等同首帧）。',
        requiresPrompt: false,
        supportsFirstFrame: true,
        supportsLastFrame: true,
        supportsReferenceImages: true,
        maxRefImages: 1,
        ratios: ['16:9', '9:16', '1:1'],
        durs: [{ label: '5 秒', key: 5 }, { label: '10 秒', key: 10 }],
        defaultParams: { ratio: '16:9', duration: 5, model_name: 'kling-v1-5', mode: 'pro', sound: 'off' },
        endpointImage: toAbsoluteUrl('/kling/v1/videos/image2video'),
        statusEndpointImage: (id) => toAbsoluteUrl(`/kling/v1/videos/image2video/${id}`)
    },
    {
        label: 'Kling 视频（kling-v1-6 · std）',
        key: 'kling-v1-6-std',
        endpoint: toAbsoluteUrl('/kling/v1/videos/text2video'),
        statusEndpoint: (id) => toAbsoluteUrl(`/kling/v1/videos/text2video/${id}`),
        authMode: 'bearer',
        format: 'kling-video',
        maxImages: 2,
        tips: 'model_name=kling-v1-6，mode=std，sound=off；支持 5/10 秒。文生需提示词；图生需首帧，可选尾帧；参考图最多 1 张（等同首帧）。',
        requiresPrompt: false,
        supportsFirstFrame: true,
        supportsLastFrame: true,
        supportsReferenceImages: true,
        maxRefImages: 1,
        ratios: ['16:9', '9:16', '1:1'],
        durs: [{ label: '5 秒', key: 5 }, { label: '10 秒', key: 10 }],
        defaultParams: { ratio: '16:9', duration: 5, model_name: 'kling-v1-6', mode: 'std', sound: 'off' },
        endpointImage: toAbsoluteUrl('/kling/v1/videos/image2video'),
        statusEndpointImage: (id) => toAbsoluteUrl(`/kling/v1/videos/image2video/${id}`)
    },
    {
        label: 'Kling 视频（kling-v1-6 · pro）',
        key: 'kling-v1-6-pro',
        endpoint: toAbsoluteUrl('/kling/v1/videos/text2video'),
        statusEndpoint: (id) => toAbsoluteUrl(`/kling/v1/videos/text2video/${id}`),
        authMode: 'bearer',
        format: 'kling-video',
        maxImages: 2,
        tips: 'model_name=kling-v1-6，mode=pro，sound=off；支持 5/10 秒。文生需提示词；图生需首帧，可选尾帧；参考图最多 1 张（等同首帧）。',
        requiresPrompt: false,
        supportsFirstFrame: true,
        supportsLastFrame: true,
        supportsReferenceImages: true,
        maxRefImages: 1,
        ratios: ['16:9', '9:16', '1:1'],
        durs: [{ label: '5 秒', key: 5 }, { label: '10 秒', key: 10 }],
        defaultParams: { ratio: '16:9', duration: 5, model_name: 'kling-v1-6', mode: 'pro', sound: 'off' },
        endpointImage: toAbsoluteUrl('/kling/v1/videos/image2video'),
        statusEndpointImage: (id) => toAbsoluteUrl(`/kling/v1/videos/image2video/${id}`)
    },
    {
        label: 'Kling 视频（kling-v2-master · std）',
        key: 'kling-v2-master-std',
        endpoint: toAbsoluteUrl('/kling/v1/videos/text2video'),
        statusEndpoint: (id) => toAbsoluteUrl(`/kling/v1/videos/text2video/${id}`),
        authMode: 'bearer',
        format: 'kling-video',
        maxImages: 2,
        tips: 'model_name=kling-v2-master，mode=std，sound=off；支持 5/10 秒。文生需提示词；图生需首帧，可选尾帧；参考图最多 1 张（等同首帧）。',
        requiresPrompt: false,
        supportsFirstFrame: true,
        supportsLastFrame: true,
        supportsReferenceImages: true,
        maxRefImages: 1,
        ratios: ['16:9', '9:16', '1:1'],
        durs: [{ label: '5 秒', key: 5 }, { label: '10 秒', key: 10 }],
        defaultParams: { ratio: '16:9', duration: 5, model_name: 'kling-v2-master', mode: 'std', sound: 'off' },
        endpointImage: toAbsoluteUrl('/kling/v1/videos/image2video'),
        statusEndpointImage: (id) => toAbsoluteUrl(`/kling/v1/videos/image2video/${id}`)
    },
    {
        label: 'Kling 视频（kling-v2-1 · std）',
        key: 'kling-v2-1-std',
        endpoint: toAbsoluteUrl('/kling/v1/videos/text2video'),
        statusEndpoint: (id) => toAbsoluteUrl(`/kling/v1/videos/text2video/${id}`),
        authMode: 'bearer',
        format: 'kling-video',
        maxImages: 2,
        tips: 'model_name=kling-v2-1，mode=std，sound=off；支持 5/10 秒。文生需提示词；图生需首帧，可选尾帧；参考图最多 1 张（等同首帧）。',
        requiresPrompt: false,
        supportsFirstFrame: true,
        supportsLastFrame: true,
        supportsReferenceImages: true,
        maxRefImages: 1,
        ratios: ['16:9', '9:16', '1:1'],
        durs: [{ label: '5 秒', key: 5 }, { label: '10 秒', key: 10 }],
        defaultParams: { ratio: '16:9', duration: 5, model_name: 'kling-v2-1', mode: 'std', sound: 'off' },
        endpointImage: toAbsoluteUrl('/kling/v1/videos/image2video'),
        statusEndpointImage: (id) => toAbsoluteUrl(`/kling/v1/videos/image2video/${id}`)
    },
    {
        label: 'Kling 视频（kling-v2-1 · pro）',
        key: 'kling-v2-1-pro',
        endpoint: toAbsoluteUrl('/kling/v1/videos/text2video'),
        statusEndpoint: (id) => toAbsoluteUrl(`/kling/v1/videos/text2video/${id}`),
        authMode: 'bearer',
        format: 'kling-video',
        maxImages: 2,
        tips: 'model_name=kling-v2-1，mode=pro，sound=off；支持 5/10 秒。文生需提示词；图生需首帧，可选尾帧；参考图最多 1 张（等同首帧）。',
        requiresPrompt: false,
        supportsFirstFrame: true,
        supportsLastFrame: true,
        supportsReferenceImages: true,
        maxRefImages: 1,
        ratios: ['16:9', '9:16', '1:1'],
        durs: [{ label: '5 秒', key: 5 }, { label: '10 秒', key: 10 }],
        defaultParams: { ratio: '16:9', duration: 5, model_name: 'kling-v2-1', mode: 'pro', sound: 'off' },
        endpointImage: toAbsoluteUrl('/kling/v1/videos/image2video'),
        statusEndpointImage: (id) => toAbsoluteUrl(`/kling/v1/videos/image2video/${id}`)
    },
    {
        label: 'Kling 视频（kling-v2-1-master）',
        key: 'kling-v2-1-master',
        endpoint: toAbsoluteUrl('/kling/v1/videos/text2video'),
        statusEndpoint: (id) => toAbsoluteUrl(`/kling/v1/videos/text2video/${id}`),
        authMode: 'bearer',
        format: 'kling-video',
        maxImages: 2,
        tips: 'model_name=kling-v2-1-master（高阶版本）；mode=std，sound=off；支持 5/10 秒。文生需提示词；图生需首帧，可选尾帧；参考图最多 1 张（等同首帧）。',
        requiresPrompt: false,
        supportsFirstFrame: true,
        supportsLastFrame: true,
        supportsReferenceImages: true,
        maxRefImages: 1,
        ratios: ['16:9', '9:16', '1:1'],
        durs: [{ label: '5 秒', key: 5 }, { label: '10 秒', key: 10 }],
        defaultParams: { ratio: '16:9', duration: 5, model_name: 'kling-v2-1-master', mode: 'std', sound: 'off' },
        endpointImage: toAbsoluteUrl('/kling/v1/videos/image2video'),
        statusEndpointImage: (id) => toAbsoluteUrl(`/kling/v1/videos/image2video/${id}`)
    },
    {
        label: 'Kling 视频（kling-v2-5-turbo · std）',
        key: 'kling-v2-5-turbo-std',
        endpoint: toAbsoluteUrl('/kling/v1/videos/text2video'),
        statusEndpoint: (id) => toAbsoluteUrl(`/kling/v1/videos/text2video/${id}`),
        authMode: 'bearer',
        format: 'kling-video',
        maxImages: 2,
        tips: 'model_name=kling-v2-5-turbo，mode=std，sound=off；支持 5/10 秒。文生需提示词；图生需首帧，可选尾帧；参考图最多 1 张（等同首帧）。',
        requiresPrompt: false,
        supportsFirstFrame: true,
        supportsLastFrame: true,
        supportsReferenceImages: true,
        maxRefImages: 1,
        ratios: ['16:9', '9:16', '1:1'],
        durs: [{ label: '5 秒', key: 5 }, { label: '10 秒', key: 10 }],
        defaultParams: { ratio: '16:9', duration: 5, model_name: 'kling-v2-5-turbo', mode: 'std', sound: 'off' },
        endpointImage: toAbsoluteUrl('/kling/v1/videos/image2video'),
        statusEndpointImage: (id) => toAbsoluteUrl(`/kling/v1/videos/image2video/${id}`)
    },
    {
        label: 'Kling 视频（kling-v2-5-turbo · pro）',
        key: 'kling-v2-5-turbo-pro',
        endpoint: toAbsoluteUrl('/kling/v1/videos/text2video'),
        statusEndpoint: (id) => toAbsoluteUrl(`/kling/v1/videos/text2video/${id}`),
        authMode: 'bearer',
        format: 'kling-video',
        maxImages: 2,
        tips: 'model_name=kling-v2-5-turbo，mode=pro，sound=off；支持 5/10 秒。文生需提示词；图生需首帧，可选尾帧；参考图最多 1 张（等同首帧）。',
        requiresPrompt: false,
        supportsFirstFrame: true,
        supportsLastFrame: true,
        supportsReferenceImages: true,
        maxRefImages: 1,
        ratios: ['16:9', '9:16', '1:1'],
        durs: [{ label: '5 秒', key: 5 }, { label: '10 秒', key: 10 }],
        defaultParams: { ratio: '16:9', duration: 5, model_name: 'kling-v2-5-turbo', mode: 'pro', sound: 'off' },
        endpointImage: toAbsoluteUrl('/kling/v1/videos/image2video'),
        statusEndpointImage: (id) => toAbsoluteUrl(`/kling/v1/videos/image2video/${id}`)
    },
    {
        label: 'Kling 视频（kling-v2-6 · pro · 无音频）',
        key: 'kling-v2-6-pro-silent',
        endpoint: toAbsoluteUrl('/kling/v1/videos/text2video'),
        statusEndpoint: (id) => toAbsoluteUrl(`/kling/v1/videos/text2video/${id}`),
        authMode: 'bearer',
        format: 'kling-video',
        maxImages: 2,
        tips: 'model_name=kling-v2-6，mode=pro，sound=off；支持 5/10 秒。文生需提示词；图生需首帧，可选尾帧；参考图最多 1 张（等同首帧）。',
        requiresPrompt: false,
        supportsFirstFrame: true,
        supportsLastFrame: true,
        supportsReferenceImages: true,
        maxRefImages: 1,
        ratios: ['16:9', '9:16', '1:1'],
        durs: [{ label: '5 秒', key: 5 }, { label: '10 秒', key: 10 }],
        defaultParams: { ratio: '16:9', duration: 5, model_name: 'kling-v2-6', mode: 'pro', sound: 'off' },
        endpointImage: toAbsoluteUrl('/kling/v1/videos/image2video'),
        statusEndpointImage: (id) => toAbsoluteUrl(`/kling/v1/videos/image2video/${id}`)
    },
    {
        label: 'Kling 视频（kling-v2-6 · pro · 有音频）',
        key: 'kling-v2-6-pro-sound',
        endpoint: toAbsoluteUrl('/kling/v1/videos/text2video'),
        statusEndpoint: (id) => toAbsoluteUrl(`/kling/v1/videos/text2video/${id}`),
        authMode: 'bearer',
        format: 'kling-video',
        maxImages: 2,
        tips: 'model_name=kling-v2-6，mode=pro，sound=on；支持 5/10 秒。⚠️ 音频与尾帧不兼容：使用尾帧时音频将被禁用。',
        requiresPrompt: false,
        supportsFirstFrame: true,
        supportsLastFrame: true,
        supportsSound: true,
        supportsReferenceImages: true,
        maxRefImages: 1,
        ratios: ['16:9', '9:16', '1:1'],
        durs: [{ label: '5 秒', key: 5 }, { label: '10 秒', key: 10 }],
        defaultParams: { ratio: '16:9', duration: 5, model_name: 'kling-v2-6', mode: 'pro', sound: 'on' },
        endpointImage: toAbsoluteUrl('/kling/v1/videos/image2video'),
        statusEndpointImage: (id) => toAbsoluteUrl(`/kling/v1/videos/image2video/${id}`)
    },
    {
        label: 'Kling 多图参考生视频（kling-v1-6）',
        key: 'kling-multi-image2video',
        endpoint: toAbsoluteUrl('/kling/v1/videos/multi-image2video'),
        statusEndpoint: (id) => toAbsoluteUrl(`/kling/v1/videos/multi-image2video/${id}`),
        authMode: 'bearer',
        format: 'kling-multi-image2video',
        maxImages: 4,
        tips: '提示词必填；支持最多 4 张参考图（全部作为参考图，不支持首/尾帧角色）。',
        requiresPrompt: true,
        supportsFirstFrame: false,
        supportsLastFrame: false,
        supportsReferenceImages: true,
        maxRefImages: 4,
        ratios: ['16:9', '9:16', '1:1'],
        durs: [{ label: '5 秒', key: 5 }, { label: '10 秒', key: 10 }],
        defaultParams: { ratio: '16:9', duration: 5, model_name: 'kling-v1-6', mode: 'std' }
    },
    {
        label: 'seedance-1-5-pro（doubao-seedance-1-5-pro-251215）',
        key: 'doubao-seedance-1-5-pro-251215',
        endpoint: toAbsoluteUrl('/volc/v1/contents/generations/tasks'),
        statusEndpoint: (id) => toAbsoluteUrl(`/volc/v1/contents/generations/tasks/${id}`),
        authMode: 'bearer',
        format: 'volc-seedance-video',
        // 首尾帧：最多 2 张（首/尾）
        maxImages: 2,
        tips: '提示词必填；可选首帧/尾帧（最多 2 张）。不支持多参考图。',
        requiresPrompt: true,
        supportsFirstFrame: true,
        supportsLastFrame: true,
        supportsReferenceImages: false,
        maxRefImages: 0,
        ratios: ['adaptive', '16:9', '9:16'],
        durs: [{ label: '4 秒', key: 4 }, { label: '8 秒', key: 8 }],
        defaultParams: { ratio: 'adaptive', duration: 4, watermark: false }
    },
    {
        label: 'wan2.6-i2v（通义万象）',
        key: 'wan2.6-i2v',
        endpoint: toAbsoluteUrl('/alibailian/api/v1/services/aigc/video-generation/video-synthesis'),
        statusEndpoint: (id) => toAbsoluteUrl(`/alibailian/api/v1/tasks/${id}`),
        authMode: 'bearer',
        format: 'alibailian-wan-video',
        maxImages: 1,
        tips: '需要首帧图片；提示词可选；不支持尾帧/多参考图。',
        requiresPrompt: false,
        supportsFirstFrame: true,
        supportsLastFrame: false,
        supportsReferenceImages: false,
        maxRefImages: 0,
        // 输出比例主要由首帧图决定；这里仍保留常用选项用于 UI 展示
        ratios: ['16:9', '9:16', '1:1', '4:3', '3:4'],
        sizes: [
            { label: '720P', key: '720P' },
            { label: '1080P', key: '1080P' }
        ],
        durs: [{ label: '5 秒', key: 5 }, { label: '10 秒', key: 10 }, { label: '15 秒', key: 15 }],
        defaultParams: { ratio: '16:9', duration: 5, size: '1080P', prompt_extend: true }
    },
    {
        label: 'MiniMax-Hailuo-02（海螺经典）',
        key: 'MiniMax-Hailuo-02',
        endpoint: toAbsoluteUrl('/minimax/v1/video_generation'),
        statusEndpoint: (id) => toAbsoluteUrl(`/minimax/v1/query/video_generation?task_id=${id}`),
        authMode: 'bearer',
        format: 'minimax-hailuo-video',
        maxImages: 2,
        tips: '支持纯文生视频和首尾帧视频。首尾帧视频请使用此模型。',
        requiresPrompt: false,
        supportsFirstFrame: true,
        supportsLastFrame: true,
        supportsReferenceImages: false,
        maxRefImages: 0,
        ratios: ['16:9', '9:16', '1:1'],
        sizes: [
            { label: '768P', key: '768P' },
            { label: '1080P', key: '1080P' }
        ],
        durs: [{ label: '6 秒', key: 6 }, { label: '10 秒', key: 10 }],
        defaultParams: { ratio: '16:9', duration: 6, size: '768P', prompt_optimizer: true }
    },
    {
        label: 'MiniMax-Hailuo-2.3（海螺）',
        key: 'MiniMax-Hailuo-2.3',
        endpoint: toAbsoluteUrl('/minimax/v1/video_generation'),
        statusEndpoint: (id) => toAbsoluteUrl(`/minimax/v1/query/video_generation?task_id=${id}`),
        authMode: 'bearer',
        format: 'minimax-hailuo-video',
        maxImages: 2,
        tips: '提示词可选；可选首帧/尾帧（最多 2 张）。不支持多参考图。',
        requiresPrompt: false,
        supportsFirstFrame: true,
        supportsLastFrame: true,
        supportsReferenceImages: false,
        maxRefImages: 0,
        ratios: ['16:9', '9:16', '1:1'],
        sizes: [
            { label: '768P', key: '768P' },
            { label: '1080P', key: '1080P' }
        ],
        durs: [{ label: '6 秒', key: 6 }, { label: '10 秒', key: 10 }],
        defaultParams: { ratio: '16:9', duration: 10, size: '768P', prompt_optimizer: true }
    },
    {
        label: 'MiniMax-Hailuo-2.3-Fast（海螺）',
        key: 'MiniMax-Hailuo-2.3-Fast',
        endpoint: toAbsoluteUrl('/minimax/v1/video_generation'),
        statusEndpoint: (id) => toAbsoluteUrl(`/minimax/v1/query/video_generation?task_id=${id}`),
        authMode: 'bearer',
        format: 'minimax-hailuo-video',
        maxImages: 2,
        tips: '提示词可选；可选首帧/尾帧（最多 2 张）。不支持多参考图。',
        requiresPrompt: false,
        supportsFirstFrame: true,
        supportsLastFrame: true,
        supportsReferenceImages: false,
        maxRefImages: 0,
        ratios: ['16:9', '9:16', '1:1'],
        sizes: [
            { label: '768P', key: '768P' },
            { label: '1080P', key: '1080P' }
        ],
        durs: [{ label: '6 秒', key: 6 }, { label: '10 秒', key: 10 }],
        defaultParams: { ratio: '16:9', duration: 10, size: '768P', prompt_optimizer: true }
    },
    {
        label: 'kling-omni-video',
        key: 'kling-omni-video',
        endpoint: toAbsoluteUrl('/kling/v1/videos/omni-video'),
        // 按用户确认：GET /kling/v1/videos/omni-video/{id}
        statusEndpoint: (id) => toAbsoluteUrl(`/kling/v1/videos/omni-video/${id}`),
        authMode: 'bearer',
        format: 'kling-omni-video',
        // 文档支持 image_list 多张参考图（包含首帧/尾帧）；这里做保守上限
        maxImages: 6,
        tips: '提示词必填；支持多张参考图（主体/场景/风格等），也可设置首帧/尾帧；注意：仅尾帧不支持（有尾帧必须有首帧）。支持“参考视频输入”（当前按 feature 特征参考提交；如需 refer_type=base 视频编辑请用 Kling 工具节点）。',
        requiresPrompt: true,
        supportsFirstFrame: true,
        supportsLastFrame: true,
        requiresFirstFrameIfLastFrame: true,
        supportsReferenceImages: true,
        maxRefImages: 6,
        supportsReferenceVideo: true,
        maxRefVideos: 1,
        ratios: ['16:9', '9:16', '1:1'],
        durs: [
            { label: '3 秒', key: 3 },
            { label: '4 秒', key: 4 },
            { label: '5 秒', key: 5 },
            { label: '6 秒', key: 6 },
            { label: '7 秒', key: 7 },
            { label: '8 秒', key: 8 },
            { label: '9 秒', key: 9 },
            { label: '10 秒', key: 10 }
        ],
        defaultParams: { ratio: '16:9', duration: 5, mode: 'pro', model_name: 'kling-video-o1' }
    },
    {
        label: 'luma_video_api',
        key: 'luma_video_api',
        endpoint: toAbsoluteUrl('/luma/generations'),
        statusEndpoint: (id) => toAbsoluteUrl(`/luma/generations/${id}`),
        authMode: 'bearer',
        format: 'luma-video',
        tips: '仅提示词（不支持首帧/尾帧/参考图）。',
        requiresPrompt: true,
        supportsFirstFrame: false,
        supportsLastFrame: false,
        supportsReferenceImages: false,
        maxRefImages: 0,
        ratios: ['16:9', '9:16', '1:1'],
        sizes: [
            { label: '720p', key: '720p' },
            { label: '1080p', key: '1080p' }
        ],
        durs: [{ label: '5 秒', key: 5 }, { label: '10 秒', key: 10 }],
        defaultParams: { ratio: '16:9', duration: 5, size: '720p', model_name: 'ray-v2' }
    },
    {
        label: 'runwayml-gen3a_turbo-10',
        key: 'runwayml-gen3a_turbo-10',
        endpoint: toAbsoluteUrl('/runwayml/v1/image_to_video'),
        statusEndpoint: (id) => toAbsoluteUrl(`/runwayml/v1/tasks/${id}`),
        authMode: 'bearer',
        format: 'runway-video',
        tips: '需要首帧图片；提示词可选；不支持尾帧/多参考图。',
        requiresPrompt: false,
        supportsFirstFrame: true,
        supportsLastFrame: false,
        supportsReferenceImages: false,
        maxRefImages: 0,
        // Runway ratio 以像素比传递，这里仍保留常见 UI 比例
        ratios: ['16:9', '9:16', '1:1', '4:3', '3:4'],
        durs: [{ label: '10 秒', key: 10 }],
        defaultParams: { ratio: '16:9', duration: 10, watermark: false }
    },
    {
        label: 'Sora 2 All',
        key: 'sora-2-all',
        // OpenAI 官方视频格式：POST /v1/videos 创建，GET /v1/videos/{id} 查询
        endpoint: '/v1/videos',
        statusEndpoint: (id) => `/v1/videos/${id}`,
        authMode: 'bearer',
        format: 'sora-openai',
        // Sora 参考图数量上游会限制，默认先按 2 张（首/尾）做安全上限
        maxImages: 2,
        tips: '提示词必填；可选首帧/尾帧（最多 2 张）。OpenAI 官方视频格式。',
        requiresPrompt: true,
        supportsFirstFrame: true,
        supportsLastFrame: true,
        supportsReferenceImages: false,
        maxRefImages: 0,
        // OpenAI 视频格式 size 使用像素尺寸
        sizes: [
            { label: '720x1280 (竖版)', key: '720x1280' },
            { label: '1280x720 (横版)', key: '1280x720' }
        ],
        ratios: ['16:9', '9:16'],
        durs: [{ label: '10 秒', key: 10 }, { label: '15 秒', key: 15 }],
        defaultParams: { ratio: '9:16', duration: 10, size: '720x1280', watermark: false }
    },
    {
        label: 'Sora 2（OpenAI官方格式）',
        key: 'sora-2',
        // OpenAI 官方视频格式：POST /v1/videos 创建，GET /v1/videos/{id} 查询
        endpoint: '/v1/videos',
        statusEndpoint: (id) => `/v1/videos/${id}`,
        authMode: 'bearer',
        format: 'sora-openai',
        maxImages: 1,
        tips: '需要首帧图片；提示词必填（OpenAI 官方视频接口）。',
        requiresPrompt: true,
        supportsFirstFrame: true,
        supportsLastFrame: false,
        supportsReferenceImages: false,
        maxRefImages: 0,
        sizes: [
            { label: '720x1280 (竖版)', key: '720x1280' },
            { label: '1280x720 (横版)', key: '1280x720' }
        ],
        ratios: ['16:9', '9:16'],
        durs: [
            { label: '4 秒', key: 4 },
            { label: '8 秒', key: 8 },
            { label: '12 秒', key: 12 }
        ],
        defaultParams: { ratio: '9:16', duration: 4, size: '720x1280' }
    },
    {
        label: 'Sora 2 Pro（OpenAI官方格式）',
        key: 'sora-2-pro',
        endpoint: '/v1/videos',
        statusEndpoint: (id) => `/v1/videos/${id}`,
        authMode: 'bearer',
        format: 'sora-openai',
        maxImages: 1,
        tips: 'Sora 2 Pro 高质量版本；支持首帧图片；提示词必填。',
        requiresPrompt: true,
        supportsFirstFrame: true,
        supportsLastFrame: false,
        supportsReferenceImages: false,
        maxRefImages: 0,
        sizes: [
            { label: '720x1280 (竖版)', key: '720x1280' },
            { label: '1280x720 (横版)', key: '1280x720' },
            { label: '1024x1792 (竖版大)', key: '1024x1792' },
            { label: '1792x1024 (横版大)', key: '1792x1024' }
        ],
        ratios: ['16:9', '9:16'],
        durs: [
            { label: '4 秒', key: 4 },
            { label: '8 秒', key: 8 },
            { label: '12 秒', key: 12 }
        ],
        defaultParams: { ratio: '9:16', duration: 4, size: '720x1280' }
    },
    {
        label: 'Vidu Q3 Pro（腾讯AIGC）',
        key: 'vidu-q3-pro',
        endpoint: '/tencent-vod/v1/aigc-video',
        statusEndpoint: (id) => `/tencent-vod/v1/query/${id}`,
        authMode: 'bearer',
        format: 'tencent-aigc-video',
        maxImages: 7,
        tips: 'Vidu Q3 Pro；支持参考图（最多7张）+尾帧；时长1-10秒；720P/1080P；支持音频生成。',
        requiresPrompt: true,
        supportsFirstFrame: true,
        supportsLastFrame: true,
        supportsReferenceImages: true,
        maxRefImages: 7,
        ratios: ['16:9', '9:16', '1:1'],
        durs: [
            { label: '1 秒', key: 1 }, { label: '2 秒', key: 2 }, { label: '3 秒', key: 3 },
            { label: '4 秒', key: 4 }, { label: '5 秒', key: 5 }, { label: '6 秒', key: 6 },
            { label: '7 秒', key: 7 }, { label: '8 秒', key: 8 }, { label: '9 秒', key: 9 },
            { label: '10 秒', key: 10 },
        ],
        defaultParams: {
            model_name: 'Vidu',
            model_version: 'q3-pro',
            ratio: '16:9',
            duration: 5,
            resolution: '1080P',
            audio_generation: 'Enabled',
            enhance_prompt: 'Enabled',
        }
    },
    {
        label: 'Vidu Q2 Pro（腾讯AIGC）',
        key: 'vidu-q2-pro',
        endpoint: '/tencent-vod/v1/aigc-video',
        statusEndpoint: (id) => `/tencent-vod/v1/query/${id}`,
        authMode: 'bearer',
        format: 'tencent-aigc-video',
        maxImages: 7,
        tips: 'Vidu Q2 Pro；支持参考图（最多7张）+尾帧；时长1-10秒；720P/1080P；支持音频生成。',
        requiresPrompt: true,
        supportsFirstFrame: true,
        supportsLastFrame: true,
        supportsReferenceImages: true,
        maxRefImages: 7,
        ratios: ['16:9', '9:16', '1:1', '4:3', '3:4'],
        durs: [
            { label: '1 秒', key: 1 }, { label: '2 秒', key: 2 }, { label: '3 秒', key: 3 },
            { label: '4 秒', key: 4 }, { label: '5 秒', key: 5 }, { label: '6 秒', key: 6 },
            { label: '7 秒', key: 7 }, { label: '8 秒', key: 8 }, { label: '9 秒', key: 9 },
            { label: '10 秒', key: 10 },
        ],
        defaultParams: {
            model_name: 'Vidu',
            model_version: 'q2-pro',
            ratio: '16:9',
            duration: 5,
            resolution: '1080P',
            audio_generation: 'Enabled',
            enhance_prompt: 'Enabled',
        }
    },
    {
        label: 'Grok Video 3 (6s)',
        // 文档模型名：grok-video-3（当前实测常见为 6 秒输出；接口不提供显式 duration 参数）
        // https://yunwu.apifox.cn/api-385288046
        key: 'grok-video-3',
        // Grok 视频统一格式（JSON）
        // 文档：https://yunwu.apifox.cn/api-385288046
        endpoint: '/v1/video/create',
        // 查询任务：https://yunwu.apifox.cn/api-385288050
        statusEndpoint: '/v1/video/query',
        authMode: 'bearer',
        format: 'unified-video',
        // Grok 当前为“垫图生成”，images 为必填（至少 1 张）
        requiresImages: true,
        // 文档描述为“垫图图片链接”，避免把 dataURL/base64 直接塞进 JSON（容易超时/失败）
        imagesMustBeHttp: true,
        // 允许多张垫图；上游具体限制未知，这里做保守上限
        maxImages: 3,
        tips: '需要提示词 + 图片（至少 1 张，且必须是公网 URL）。不支持首帧/尾帧语义，全部按参考图处理。',
        requiresPrompt: true,
        supportsFirstFrame: false,
        supportsLastFrame: false,
        supportsReferenceImages: true,
        maxRefImages: 3,
        // 文档限定：2:3, 3:2, 1:1
        ratios: ['3:2', '2:3', '1:1'],
        // 文档：size 720P 或 1080P（但当前仅支持 720P）
        sizes: [{ label: '720P', key: '720P' }],
        durs: [{ label: '6 秒', key: 6 }],
        // 时长由模型固定，接口不提供 duration 参数（避免传入后触发上游校验）
        supportsDuration: false,
        defaultParams: { ratio: '3:2', duration: 6, size: '720P' }
    },
    {
        label: 'Grok Video 3 (10s)',
        // 部分环境/线路可能提供 10 秒变体；接口本身不提供 duration 字段，只能通过模型名区分
        // https://yunwu.apifox.cn/api-385288046
        key: 'grok-video-3-10s',
        endpoint: '/v1/video/create',
        statusEndpoint: '/v1/video/query',
        authMode: 'bearer',
        format: 'unified-video',
        requiresImages: true,
        imagesMustBeHttp: true,
        maxImages: 3,
        tips: '需要提示词 + 图片（至少 1 张，且必须是公网 URL）。不支持首帧/尾帧语义，全部按参考图处理。',
        requiresPrompt: true,
        supportsFirstFrame: false,
        supportsLastFrame: false,
        supportsReferenceImages: true,
        maxRefImages: 3,
        ratios: ['3:2', '2:3', '1:1'],
        sizes: [{ label: '720P', key: '720P' }],
        durs: [{ label: '10 秒', key: 10 }],
        supportsDuration: false,
        defaultParams: { ratio: '3:2', duration: 10, size: '720P' }
    },
]

// Kling Platform tools (advanced workflows) | 可灵平台工具（高级工作流）
// 说明：这些“工具”用于新节点类型（klingVideoTool/klingImageTool/klingAudioTool），不属于基础生图/生视频下拉框。
export const KLING_VIDEO_TOOLS = [
    {
        label: 'Kling 人脸识别（identify-face）',
        key: 'kling-identify-face',
        authMode: 'bearer',
        format: 'kling-video-tool',
        method: 'POST',
        outputType: 'text',
        tips: '输入 video_id 或 video_url（二选一）→ 返回 session_id / face_id 等信息（用于对口型）。',
        endpoint: toAbsoluteUrl('/kling/v1/videos/identify-face'),
    },
    {
        label: 'Kling 多模态视频编辑（选区/增删元素）',
        key: 'kling-multi-elements-video-edit',
        authMode: 'bearer',
        format: 'kling-video-tool',
        method: 'POST',
        outputType: 'video',
        tips: '需要待编辑视频（video_id 或 video_url）；可标记选区（增加/删减）；再提交提示词生成编辑后的视频。',
        endpoints: {
            initSelection: toAbsoluteUrl('/kling/v1/videos/multi-elements/init-selection'),
            addSelection: toAbsoluteUrl('/kling/v1/videos/multi-elements/add-selection'),
            deleteSelection: toAbsoluteUrl('/kling/v1/videos/multi-elements/delete-selection'),
            previewSelection: toAbsoluteUrl('/kling/v1/videos/multi-elements/preview-selection'),
            run: toAbsoluteUrl('/kling/v1/videos/multi-elements'),
            query: (id) => toAbsoluteUrl(`/kling/v1/videos/multi-elements/${id}`),
        },
    },
    {
        label: 'Kling 视频延长（video-extend）',
        key: 'kling-video-extend',
        authMode: 'bearer',
        format: 'kling-video-tool',
        method: 'POST',
        outputType: 'video',
        tips: '需要可灵历史作品 video_id + 提示词；用于在原视频基础上延长。',
        endpoint: toAbsoluteUrl('/kling/v1/videos/video-extend'),
        statusEndpoint: (id) => toAbsoluteUrl(`/kling/v1/videos/video-extend/${id}`),
    },
    {
        label: 'Kling 视频特效（effects）',
        key: 'kling-video-effects',
        authMode: 'bearer',
        format: 'kling-video-tool',
        method: 'POST',
        outputType: 'video',
        tips: '根据 effect_scene 选择特效；输入通常为 1 张或 2 张图片（不同场景输入结构不同）。',
        endpoint: toAbsoluteUrl('/kling/v1/videos/effects'),
        statusEndpoint: (id) => toAbsoluteUrl(`/kling/v1/videos/effects/${id}`),
    },
    {
        label: 'Kling 数字人（image + audio → video）',
        key: 'kling-digital-human',
        authMode: 'bearer',
        format: 'kling-video-tool',
        method: 'POST',
        outputType: 'video',
        tips: '需要数字人参考图 + 音频（audio_id 或 sound_file）+ 可选提示词；输出为口播/数字人视频。',
        requiresAudio: true,
        endpoint: toAbsoluteUrl('/kling/v1/videos/avatar/image2video'),
        statusEndpoint: (id) => toAbsoluteUrl(`/kling/v1/videos/avatar/image2video/${id}`),
    },
    {
        label: 'Kling 动作控制（image + video → video）',
        key: 'kling-motion-control',
        authMode: 'bearer',
        format: 'kling-video-tool',
        method: 'POST',
        outputType: 'video',
        tips: '需要参考图 + 参考动作视频（video_url）；可选提示词；输出为动作驱动视频。',
        endpoint: toAbsoluteUrl('/kling/v1/videos/motion-control'),
        statusEndpoint: (id) => toAbsoluteUrl(`/kling/v1/videos/motion-control/${id}`),
    },
    {
        label: 'Kling 对口型（identify-face + lip-sync）',
        key: 'kling-lip-sync',
        authMode: 'bearer',
        format: 'kling-video-tool',
        method: 'POST',
        outputType: 'video',
        tips: '先做人脸识别（identify-face）拿 session_id/face_id，再提交 advanced-lip-sync（音频 + 选脸）生成对口型视频。',
        endpoints: {
            identifyFace: toAbsoluteUrl('/kling/v1/videos/identify-face'),
            lipSync: toAbsoluteUrl('/kling/v1/videos/advanced-lip-sync'),
            query: (id) => toAbsoluteUrl(`/kling/v1/videos/advanced-lip-sync/${id}`),
        },
        requiresAudio: true,
    },
]

export const KLING_IMAGE_TOOLS = [
    {
        label: 'Kling 图像生成（images/generations）',
        key: 'kling-image-generate',
        authMode: 'bearer',
        format: 'kling-image-tool',
        method: 'POST',
        outputType: 'image',
        tips: '可选参考图 image + 提示词 prompt → 输出图片（可能返回 task_id，需要轮询）。',
        endpoint: toAbsoluteUrl('/kling/v1/images/generations'),
        statusEndpoint: (id) => toAbsoluteUrl(`/kling/v1/images/generations/${id}`),
    },
    {
        label: 'Kling Omni-Image（omni-image）',
        key: 'kling-omni-image-tool',
        authMode: 'bearer',
        format: 'kling-image-tool',
        method: 'POST',
        outputType: 'image',
        tips: '提示词必填；可选多张参考图（image_list）；可选 aspect_ratio/resolution/n。',
        endpoint: toAbsoluteUrl('/kling/v1/images/omni-image'),
        statusEndpoint: (id) => toAbsoluteUrl(`/kling/v1/images/omni-image/${id}`),
    },
    {
        label: 'Kling 多图参考生图（multi-image2image）',
        key: 'kling-multi-image2image',
        authMode: 'bearer',
        format: 'kling-image-tool',
        method: 'POST',
        outputType: 'image',
        tips: '支持 1~4 张主体参考图（subject_image_list）；可选场景图 scene_image / 风格图 style_image；可选提示词。',
        endpoint: toAbsoluteUrl('/kling/v1/images/multi-image2image'),
        statusEndpoint: (id) => toAbsoluteUrl(`/kling/v1/images/multi-image2image/${id}`),
    },
    {
        label: 'Kling 扩图（outpaint / expand）',
        key: 'kling-expand-image',
        authMode: 'bearer',
        format: 'kling-image-tool',
        method: 'POST',
        outputType: 'image',
        tips: '需要 1 张图片；通过上下左右扩展比例控制扩图范围；可选提示词。',
        endpoint: toAbsoluteUrl('/kling/v1/images/editing/expand'),
        statusEndpoint: (id) => toAbsoluteUrl(`/kling/v1/images/editing/expand/${id}`),
    },
    {
        label: 'Kling 虚拟试穿（kolors-virtual-try-on）',
        key: 'kling-virtual-try-on',
        authMode: 'bearer',
        format: 'kling-image-tool',
        method: 'POST',
        outputType: 'image',
        tips: '需要人物图 human_image + 服饰图 cloth_image；输出试穿效果图。',
        endpoint: toAbsoluteUrl('/kling/v1/images/kolors-virtual-try-on'),
        statusEndpoint: (id) => toAbsoluteUrl(`/kling/v1/images/kolors-virtual-try-on/${id}`),
    },
    {
        label: 'Kling 图像识别（image-recognize）',
        key: 'kling-image-recognize',
        authMode: 'bearer',
        format: 'kling-image-tool',
        method: 'POST',
        outputType: 'text',
        tips: '输入 1 张图片，返回识别结果（同步接口）。',
        endpoint: toAbsoluteUrl('/kling/v1/videos/image-recognize'),
    },
    {
        label: 'Kling 主体（custom-elements）',
        key: 'kling-custom-elements',
        authMode: 'bearer',
        format: 'kling-image-tool',
        method: 'POST',
        outputType: 'text',
        tips: '创建主体元素：element_name + element_description + element_frontal_image + element_refer_list(1~3)。',
        endpoint: toAbsoluteUrl('/kling/v1/general/custom-elements'),
    },
]

export const KLING_AUDIO_TOOLS = [
    {
        label: 'Kling 文生音效（text-to-audio）',
        key: 'kling-text-to-audio',
        authMode: 'bearer',
        format: 'kling-audio-tool',
        method: 'POST',
        outputType: 'audio',
        tips: '提示词 + 时长（3.0~10.0 秒，可小数）→ 音效。',
        endpoint: toAbsoluteUrl('/kling/v1/audio/text-to-audio'),
        statusEndpoint: (id) => toAbsoluteUrl(`/kling/v1/audio/text-to-audio/${id}`),
    },
    {
        label: 'Kling 视频生音效（video-to-audio）',
        key: 'kling-video-to-audio',
        authMode: 'bearer',
        format: 'kling-audio-tool',
        method: 'POST',
        outputType: 'audio',
        tips: 'video_id 或 video_url（二选一）+ 音效/配乐提示词 → 音频（可选 ASMR）。',
        endpoint: toAbsoluteUrl('/kling/v1/audio/video-to-audio'),
        statusEndpoint: (id) => toAbsoluteUrl(`/kling/v1/audio/video-to-audio/${id}`),
    },
    {
        label: 'Kling 语音合成（TTS）',
        key: 'kling-tts',
        authMode: 'bearer',
        format: 'kling-audio-tool',
        method: 'POST',
        outputType: 'audio',
        tips: 'text + voice_id + voice_language（可选 voice_speed）→ 语音。',
        endpoint: toAbsoluteUrl('/kling/v1/audio/tts'),
    },
    {
        label: 'Kling 自定义音色（custom-voices）',
        key: 'kling-custom-voices',
        authMode: 'bearer',
        format: 'kling-audio-tool',
        method: 'POST',
        outputType: 'text',
        tips: '创建自定义音色：voice_name + voice_url(音视频URL) 或 video_id（二选一）。返回 voice_id / task 信息。',
        endpoint: toAbsoluteUrl('/kling/v1/general/custom-voices'),
    },
    {
        label: 'Kling 查询自定义音色（单个）',
        key: 'kling-custom-voices-query',
        authMode: 'bearer',
        format: 'kling-audio-tool',
        method: 'GET',
        outputType: 'text',
        tips: 'payload 里提供 id（或 voice_id）→ 查询自定义音色详情/状态。',
        endpoint: (payload) => {
            const id = encodeURIComponent(String(payload?.id || payload?.voice_id || '').trim())
            return toAbsoluteUrl(`/kling/v1/general/custom-voices/${id}`)
        },
    },
    {
        label: 'Kling 查询官方音色（presets-voices）',
        key: 'kling-presets-voices',
        authMode: 'bearer',
        format: 'kling-audio-tool',
        method: 'GET',
        outputType: 'text',
        tips: '可选 pageNum/pageSize → 返回官方音色列表。',
        endpoint: toAbsoluteUrl('/kling/v1/general/presets-voices'),
    },
    {
        label: 'Kling 删除自定义音色（delete-voices）',
        key: 'kling-delete-voices',
        authMode: 'bearer',
        format: 'kling-audio-tool',
        method: 'POST',
        outputType: 'text',
        tips: 'payload: { "voice_id": "xxx" } → 删除自定义音色。',
        endpoint: toAbsoluteUrl('/kling/v1/general/delete-voices'),
    },
]

// Chat/LLM models | 对话模型
export const CHAT_MODELS = [
    {
        label: 'GPT-5.1 Thinking All',
        key: 'gpt-5.1-thinking-all',
        endpoint: '/chat/completions',
        authMode: 'bearer',
        format: 'openai-chat'
    },
    {
        label: 'GPT-5 mini（Responses）',
        key: 'gpt-5-mini',
        endpoint: '/responses',
        authMode: 'bearer',
        format: 'openai-responses'
    },
    {
        label: 'Gemini 3 Pro',
        key: 'gemini-3-pro-preview',
        endpoint: toAbsoluteUrl('/v1beta/models/gemini-3-pro-preview:generateContent'),
        authMode: 'query',
        format: 'gemini-chat'
    },
    {
        label: 'Gemini 3 Pro（AI 助手）',
        key: 'gemini-3-pro-assistant',
        endpoint: toAbsoluteUrl('/v1beta/models/gemini-3-pro-preview:generateContent'),
        authMode: 'query',
        format: 'gemini-chat',
        tips: '使用 Gemini 3 Pro 作为 AI 助手'
    }
]

// Image size options | 图片尺寸选项
export const IMAGE_SIZE_OPTIONS = [
    { label: '1024x1024', key: '1024x1024' },
    { label: '1536x1024 (横版)', key: '1536x1024' },
    { label: '1024x1536 (竖版)', key: '1024x1536' }
]

// Image quality options | 图片质量选项
export const IMAGE_QUALITY_OPTIONS = [
    { label: '标准', key: 'standard' },
    { label: '高清', key: 'hd' }
]

// Image style options | 图片风格选项
export const IMAGE_STYLE_OPTIONS = [
    { label: '生动', key: 'vivid' },
    { label: '自然', key: 'natural' }
]

// Video ratio options | 视频比例选项
export const VIDEO_RATIO_OPTIONS = VIDEO_RATIO_LIST

// Video duration options | 视频时长选项
export const VIDEO_DURATION_OPTIONS = [
    { label: '5 秒', key: 5 },
    { label: '10 秒', key: 10 }
]

// Default values | 默认值
export const DEFAULT_IMAGE_MODEL = 'gemini-3-pro-image-preview'
export const DEFAULT_VIDEO_MODEL = 'sora-2-all'
export const DEFAULT_CHAT_MODEL = 'gpt-5.1-thinking-all'
export const DEFAULT_IMAGE_SIZE = '1024x1024'
export const DEFAULT_VIDEO_RATIO = '16:9'
export const DEFAULT_VIDEO_DURATION = 5

// Get model by key | 根据 key 获取模型
export const getModelByName = (key) => {
    const resolvedKey = MODEL_ALIASES[key] || key
    const allModels = [...IMAGE_MODELS, ...VIDEO_MODELS, ...CHAT_MODELS]
    const found = allModels.find(m => m.key === resolvedKey)
    if (found) return found

    // Fallback for legacy/unknown keys saved in old projects | 旧项目兼容：未知 key 回落默认模型
    // 说明：删除模型后，旧项目可能仍保存旧 key；这里做“按大类回落”避免请求发送未知 model。
    const isVideoLike = typeof key === 'string' && /video|sora|veo|kling-video/i.test(key)
    const isChatLike = typeof key === 'string' && /chat|gpt|claude|qwen|deepseek/i.test(key)
    if (isVideoLike) return allModels.find(m => m.key === DEFAULT_VIDEO_MODEL)
    if (isChatLike) return allModels.find(m => m.key === DEFAULT_CHAT_MODEL)
    return allModels.find(m => m.key === DEFAULT_IMAGE_MODEL)
}
