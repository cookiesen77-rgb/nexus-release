/**
 * Image Edit Generator | 图片编辑生成器
 * 统一封装图片编辑的生图调用
 * - AI 自动分析图片内容
 * - 智能生成提示词
 * - 支持用户选择模型和分辨率
 * - 带重试机制
 */

import { useGraphStore } from '@/graph/store'
import { IMAGE_MODELS } from '@/config/models'
import { postJson } from '@/lib/workflow/request'
import { saveMedia, isLargeData, isBase64Data } from '@/lib/mediaStorage'
import { polishEditPrompt, describeImage, type EditType } from './prompts'
import { cropToFourGrid, cropToNineGrid, calculateNodePosition, type GridCropAreaPx } from './gridCrop'
import { chatCompletions } from '@/lib/nexusApi'
import { useSettingsStore } from '@/store/settings'
import { fetch as tauriFetch } from '@tauri-apps/plugin-http'

const isTauri = typeof window !== 'undefined' && !!(window as any).__TAURI_INTERNALS__

const webFetch = globalThis.fetch ? globalThis.fetch.bind(globalThis) : (async () => { throw new Error('fetch is not available') }) as typeof fetch
const safeFetch: typeof fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  if (!isTauri) return await webFetch(input, init)
  try {
    return await (tauriFetch as typeof fetch)(input, init)
  } catch (err: any) {
    console.warn('[imageEdit.safeFetch] tauriFetch failed, fallback:', String(err?.message || '').slice(0, 120))
    return await webFetch(input, init)
  }
}) as typeof fetch

// 默认模型
const DEFAULT_IMAGE_MODEL = 'nano-banana-pro'
const MAX_RETRIES = 3

// 获取模型配置
const getModelConfig = (modelKey: string) => {
  const key = modelKey || DEFAULT_IMAGE_MODEL
  return IMAGE_MODELS.find((m: any) => m.key === key) || IMAGE_MODELS.find((m: any) => m.key === DEFAULT_IMAGE_MODEL) || IMAGE_MODELS[0]
}

/**
 * 将图片转换为 Gemini 格式的 inline_data
 */
async function resolveImageToInlineData(input: string): Promise<{ mimeType: string; data: string } | null> {
  const v = String(input || '').trim()
  if (!v) return null

  if (v.startsWith('data:')) {
    const m = v.match(/^data:([^;]+);base64,(.*)$/)
    if (!m) return null
    return { mimeType: m[1] || 'image/png', data: m[2] || '' }
  }

  if (!/^https?:\/\//i.test(v)) return null

  try {
    const res = await safeFetch(v, { method: 'GET' })
    if (!res.ok) return null
    const blob = await res.blob()
    const base64 = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader()
      reader.onerror = () => reject(new Error('read failed'))
      reader.onload = () => resolve(String(reader.result || ''))
      reader.readAsDataURL(blob)
    })
    const m = base64.match(/^data:([^;]+);base64,(.*)$/)
    if (!m) return null
    return { mimeType: m[1] || blob.type || 'image/png', data: m[2] || '' }
  } catch {
    return null
  }
}

const toDataUrl = (b64: string, mime = 'image/png') => `data:${mime};base64,${b64}`

function getImageParams(sourceNodeId: string): { size: string; quality: string } {
  const store = useGraphStore.getState()
  const node = store.nodes.find(n => n.id === sourceNodeId)
  const data = (node?.data || {}) as any
  const size = data.size || data.aspectRatio || '1:1'
  const quality = data.quality || '2K'
  return { size, quality }
}

/**
 * AI 分析图片内容（用于生成更好的提示词）
 */
async function analyzeImageForEdit(imageUrl: string, mode: 'erase' | 'inpaint'): Promise<string> {
  const inline = await resolveImageToInlineData(imageUrl)
  if (!inline) return ''

  const analyzePrompt = mode === 'erase'
    ? `Analyze this image briefly. Describe:
1. Main subject (person/object)
2. Background/environment
3. Lighting and colors
4. Art style (photo/illustration/etc)
Keep it under 50 words, in English.`
    : `Analyze this image for inpainting. Describe:
1. Main subject and their appearance
2. Background elements
3. Overall style and atmosphere
4. Colors and lighting
Keep it under 60 words, in English.`

  try {
    const result = await chatCompletions({
      model: useSettingsStore.getState().aiAssistantModel,
      messages: [{
        role: 'user',
        content: [
          { type: 'text', text: analyzePrompt },
          { type: 'image_url', image_url: { url: `data:${inline.mimeType};base64,${inline.data}` } }
        ]
      }]
    })
    return result.trim()
  } catch (err) {
    console.warn('[analyzeImageForEdit] 分析失败:', err)
    return ''
  }
}

/**
 * 带重试的生图调用
 */
async function generateWithRetry(
  modelKey: string,
  prompt: string,
  imageParts: any[],
  resolution: string,
  onProgress: (msg: string) => void,
  aspectRatio?: string
): Promise<string> {
  const modelCfg = getModelConfig(modelKey) as any

  const payload = {
    contents: [{ role: 'user', parts: [{ text: prompt }, ...imageParts] }],
    generationConfig: {
      responseModalities: ['IMAGE'],
      imageConfig: {
        aspectRatio: aspectRatio || '1:1',
        imageSize: resolution || '2K'
      }
    }
  }

  let lastError: Error | null = null

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      if (attempt > 1) {
        onProgress(`重试中 (${attempt}/${MAX_RETRIES})...`)
        await new Promise(r => setTimeout(r, 2000 * attempt))
      }

      const rsp = await postJson<any>(modelCfg.endpoint, payload, {
        authMode: modelCfg.authMode,
        timeoutMs: modelCfg.timeout || 240000
      })

      const parts = rsp?.candidates?.[0]?.content?.parts || []
      const inlineData = parts.map((p: any) => p.inlineData || p.inline_data).filter(Boolean)[0]

      if (inlineData?.data) {
        return toDataUrl(inlineData.data, inlineData.mimeType || inlineData.mime_type || 'image/png')
      }

      throw new Error('生图返回为空')
    } catch (err: any) {
      lastError = err
      console.warn(`[generateWithRetry] 尝试 ${attempt}/${MAX_RETRIES} 失败:`, err?.message)

      if (attempt === MAX_RETRIES) break
    }
  }

  throw lastError || new Error('生图失败')
}

/**
 * 创建结果图片节点
 */
async function createResultNode(
  imageUrl: string,
  sourceNodeId: string,
  label: string,
  offsetX: number = 100,
  offsetY: number = 0,
  model?: string
): Promise<string> {
  const store = useGraphStore.getState()
  const sourceNode = store.nodes.find(n => n.id === sourceNodeId)

  const x = (sourceNode?.x || 0) + offsetX
  const y = (sourceNode?.y || 0) + offsetY

  const nodeId = store.addNode('image', { x, y }, {
    url: imageUrl,
    label,
    loading: false
  })

  if (isLargeData(imageUrl) || isBase64Data(imageUrl)) {
    try {
      const projectId = store.projectId || 'default'
      const mediaId = await saveMedia({
        nodeId,
        projectId,
        type: 'image',
        data: imageUrl,
        model: model || 'image-edit'
      })
      store.patchNodeDataSilent(nodeId, { mediaId })
    } catch (err) {
      console.error('[createResultNode] 保存到 IndexedDB 失败:', err)
    }
  }

  return nodeId
}

// ==================== 公共 API ====================

export interface EditOptions {
  sourceNodeId: string
  sourceImageUrl: string
  userInput?: string
  onProgress?: (msg: string) => void
}

export async function changePose(options: EditOptions): Promise<string> {
  const { sourceNodeId, sourceImageUrl, userInput, onProgress } = options
  if (!userInput) throw new Error('请输入想要的姿态')

  onProgress?.('正在润色提示词...')
  const prompt = await polishEditPrompt('pose', userInput)

  onProgress?.('正在生成图片...')
  const { size, quality } = getImageParams(sourceNodeId)

  const inline = await resolveImageToInlineData(sourceImageUrl)
  if (!inline) throw new Error('图片加载失败')

  const imageParts = [{ inline_data: { mime_type: inline.mimeType, data: inline.data } }]
  const resultUrl = await generateWithRetry(DEFAULT_IMAGE_MODEL, prompt, imageParts, quality, onProgress || (() => {}), size)

  onProgress?.('正在保存结果...')
  return await createResultNode(resultUrl, sourceNodeId, `姿态: ${userInput}`, 350, 0)
}

export async function changeAngle(options: EditOptions): Promise<string> {
  const { sourceNodeId, sourceImageUrl, userInput, onProgress } = options
  if (!userInput) throw new Error('请输入想要的角度')

  onProgress?.('正在润色提示词...')
  const prompt = await polishEditPrompt('angle', userInput)

  onProgress?.('正在生成图片...')
  const { size, quality } = getImageParams(sourceNodeId)

  const inline = await resolveImageToInlineData(sourceImageUrl)
  if (!inline) throw new Error('图片加载失败')

  const imageParts = [{ inline_data: { mime_type: inline.mimeType, data: inline.data } }]
  const resultUrl = await generateWithRetry(DEFAULT_IMAGE_MODEL, prompt, imageParts, quality, onProgress || (() => {}), size)

  onProgress?.('正在保存结果...')
  return await createResultNode(resultUrl, sourceNodeId, `角度: ${userInput}`, 350, 0)
}

export async function expandImage(options: EditOptions): Promise<string> {
  const { sourceNodeId, sourceImageUrl, onProgress } = options

  onProgress?.('正在分析图片...')
  const description = await describeImage(sourceImageUrl)

  onProgress?.('正在润色提示词...')
  const prompt = await polishEditPrompt('expand', '', description)

  onProgress?.('正在生成图片...')
  const { size, quality } = getImageParams(sourceNodeId)

  const inline = await resolveImageToInlineData(sourceImageUrl)
  if (!inline) throw new Error('图片加载失败')

  const imageParts = [{ inline_data: { mime_type: inline.mimeType, data: inline.data } }]
  const resultUrl = await generateWithRetry(DEFAULT_IMAGE_MODEL, prompt, imageParts, quality, onProgress || (() => {}), size)

  onProgress?.('正在保存结果...')
  return await createResultNode(resultUrl, sourceNodeId, '扩图结果', 350, 0)
}

export async function cutoutImage(options: EditOptions): Promise<string> {
  const { sourceNodeId, sourceImageUrl, userInput, onProgress } = options
  if (!userInput) throw new Error('请输入要抠出的对象')

  onProgress?.('正在润色提示词...')
  const prompt = await polishEditPrompt('cutout', userInput)

  onProgress?.('正在生成图片...')
  const { size, quality } = getImageParams(sourceNodeId)

  const inline = await resolveImageToInlineData(sourceImageUrl)
  if (!inline) throw new Error('图片加载失败')

  const imageParts = [{ inline_data: { mime_type: inline.mimeType, data: inline.data } }]
  const resultUrl = await generateWithRetry(DEFAULT_IMAGE_MODEL, prompt, imageParts, quality, onProgress || (() => {}), size)

  onProgress?.('正在保存结果...')
  return await createResultNode(resultUrl, sourceNodeId, `抠图: ${userInput}`, 350, 0)
}

export async function cropFourGrid(options: Omit<EditOptions, 'userInput'>): Promise<string[]> {
  const { sourceNodeId, sourceImageUrl, onProgress } = options

  onProgress?.('正在裁剪图片...')
  const cropArea = (options as any)?.cropArea as GridCropAreaPx | undefined
  const results = await cropToFourGrid(sourceImageUrl, cropArea)

  onProgress?.('正在保存结果...')
  const store = useGraphStore.getState()
  const sourceNode = store.nodes.find(n => n.id === sourceNodeId)
  const baseX = sourceNode?.x || 0
  const baseY = sourceNode?.y || 0

  const nodeIds: string[] = []

  for (let i = 0; i < results.length; i++) {
    const result = results[i]
    const pos = calculateNodePosition(baseX, baseY, i, 2, 300)

    const nodeId = store.addNode('image', { x: pos.x + 350, y: pos.y }, {
      url: result.dataUrl,
      label: `四宫格 ${result.row + 1}-${result.col + 1}`,
      loading: false
    })

    try {
      const projectId = store.projectId || 'default'
      const mediaId = await saveMedia({
        nodeId,
        projectId,
        type: 'image',
        data: result.dataUrl
      })
      store.patchNodeDataSilent(nodeId, { mediaId })
    } catch (err) {
      console.error('[cropFourGrid] 保存到 IndexedDB 失败:', err)
    }

    nodeIds.push(nodeId)
  }

  return nodeIds
}

export async function cropNineGrid(options: Omit<EditOptions, 'userInput'>): Promise<string[]> {
  const { sourceNodeId, sourceImageUrl, onProgress } = options

  onProgress?.('正在裁剪图片...')
  const cropArea = (options as any)?.cropArea as GridCropAreaPx | undefined
  const results = await cropToNineGrid(sourceImageUrl, cropArea)

  onProgress?.('正在保存结果...')
  const store = useGraphStore.getState()
  const sourceNode = store.nodes.find(n => n.id === sourceNodeId)
  const baseX = sourceNode?.x || 0
  const baseY = sourceNode?.y || 0

  const nodeIds: string[] = []

  for (let i = 0; i < results.length; i++) {
    const result = results[i]
    const pos = calculateNodePosition(baseX, baseY, i, 3, 280)

    const nodeId = store.addNode('image', { x: pos.x + 350, y: pos.y }, {
      url: result.dataUrl,
      label: `九宫格 ${result.row + 1}-${result.col + 1}`,
      loading: false
    })

    try {
      const projectId = store.projectId || 'default'
      const mediaId = await saveMedia({
        nodeId,
        projectId,
        type: 'image',
        data: result.dataUrl
      })
      store.patchNodeDataSilent(nodeId, { mediaId })
    } catch (err) {
      console.error('[cropNineGrid] 保存到 IndexedDB 失败:', err)
    }

    nodeIds.push(nodeId)
  }

  return nodeIds
}

/**
 * 选区重绘 (Inpaint)
 * - AI 分析图片内容
 * - 智能生成重绘提示词
 * - 支持用户选择模型和分辨率
 * - 带重试机制
 */
export interface InpaintOptions extends EditOptions {
  maskBase64: string
  model?: string
  resolution?: string
}

export async function inpaintImage(options: InpaintOptions): Promise<string> {
  const { sourceNodeId, sourceImageUrl, maskBase64, userInput, model, resolution, onProgress } = options
  if (!maskBase64) throw new Error('请绘制蒙版区域')

  const selectedModel = model || DEFAULT_IMAGE_MODEL
  const selectedResolution = resolution || '2K'

  // AI 分析图片
  onProgress?.('AI 正在分析图片...')
  const imageAnalysis = await analyzeImageForEdit(sourceImageUrl, 'inpaint')

  // 生成智能提示词
  onProgress?.('正在生成智能提示词...')

  const userRequirement = userInput?.trim() || ''

  let prompt: string
  if (userRequirement) {
    prompt = `You are given two images: the FIRST is the original photo, the SECOND is a binary mask where WHITE pixels mark the EXACT region to modify. BLACK pixels must remain COMPLETELY UNTOUCHED.

TASK: Replace ONLY the white-masked pixels with: ${userRequirement}

Image context: ${imageAnalysis}

ABSOLUTE RULES — violating ANY rule is a failure:
1. Pixel-precise boundary: modify ONLY pixels that are white in the mask. Every black-mask pixel must be IDENTICAL to the original — zero changes.
2. Seamless edge blending: new content must match the exact color, lighting, texture, and perspective at the mask boundary with sub-pixel precision.
3. Style consistency: the replacement must perfectly match the original image's art style, lighting direction, color grading, lens characteristics, and noise/grain pattern.
4. Spatial coherence: respect perspective lines, vanishing points, depth of field, and shadow directions from the original scene.
5. No hallucination outside mask: absolutely no modifications, color shifts, or artifacts outside the masked region.`
  } else {
    prompt = `You are given two images: the FIRST is the original photo, the SECOND is a binary mask where WHITE pixels mark the EXACT region to fill. BLACK pixels must remain COMPLETELY UNTOUCHED.

TASK: Intelligently fill ONLY the white-masked pixels with contextually appropriate content.

Image context: ${imageAnalysis}

ABSOLUTE RULES — violating ANY rule is a failure:
1. Pixel-precise boundary: modify ONLY pixels that are white in the mask. Every black-mask pixel must be IDENTICAL to the original — zero changes.
2. Context-aware fill: infer what should naturally exist in the masked area based on surrounding visual context (texture continuation, object completion, background extension).
3. Seamless edge blending: new content must match the exact color, lighting, texture at the mask boundary with sub-pixel precision.
4. Style consistency: match the original image's art style, lighting, color grading, and noise pattern exactly.
5. No hallucination outside mask: absolutely no modifications outside the masked region.`
  }

  onProgress?.('正在生成图片...')

  const sourceInline = await resolveImageToInlineData(sourceImageUrl)
  const maskInline = await resolveImageToInlineData(maskBase64)

  if (!sourceInline) throw new Error('源图片加载失败')
  if (!maskInline) throw new Error('蒙版加载失败')

  const imageParts = [
    { inline_data: { mime_type: sourceInline.mimeType, data: sourceInline.data } },
    { inline_data: { mime_type: maskInline.mimeType, data: maskInline.data } }
  ]

  const { size } = getImageParams(sourceNodeId)
  const resultUrl = await generateWithRetry(selectedModel, prompt, imageParts, selectedResolution, onProgress || (() => {}), size)

  onProgress?.('正在保存结果...')
  const label = userRequirement ? `重绘: ${userRequirement.slice(0, 20)}${userRequirement.length > 20 ? '...' : ''}` : '智能重绘'
  return await createResultNode(resultUrl, sourceNodeId, label, 350, 0, selectedModel)
}

/**
 * 带蒙版的擦除
 * - AI 分析图片内容
 * - 智能生成擦除提示词（无痕去除，自然填充）
 * - 支持用户选择模型和分辨率
 * - 带重试机制
 */
export interface MaskEraseOptions extends EditOptions {
  maskBase64: string
  model?: string
  resolution?: string
}

export async function eraseWithMask(options: MaskEraseOptions): Promise<string> {
  const { sourceNodeId, sourceImageUrl, maskBase64, model, resolution, onProgress } = options
  if (!maskBase64) throw new Error('请绘制蒙版区域')

  const selectedModel = model || DEFAULT_IMAGE_MODEL
  const selectedResolution = resolution || '2K'

  // AI 分析图片
  onProgress?.('AI 正在分析图片...')
  const imageAnalysis = await analyzeImageForEdit(sourceImageUrl, 'erase')

  // 生成智能擦除提示词
  onProgress?.('正在生成智能提示词...')

  const prompt = `You are given two images: the FIRST is the original photo, the SECOND is a binary mask where WHITE pixels mark the EXACT region to erase. BLACK pixels must remain COMPLETELY UNTOUCHED.

TASK: REMOVE the content at white-masked pixels and fill with natural background continuation.

Image context: ${imageAnalysis}

ABSOLUTE RULES — violating ANY rule is a failure:
1. Pixel-precise boundary: erase and fill ONLY pixels that are white in the mask. Every black-mask pixel must be IDENTICAL to the original — zero changes.
2. Complete removal: every trace of the original object in the masked region must be gone — no residual outlines, shadows, or color remnants of the removed object.
3. Natural background fill: reconstruct the background/surface that would exist behind the removed object, matching surrounding textures, patterns, colors, and perspective with sub-pixel precision.
4. Shadow & reflection cleanup: if the removed object cast shadows or reflections, those must also be naturally replaced (only within the mask).
5. Seamless edge blending: the filled area must be indistinguishable from the surrounding image at the mask boundary.
6. Style preservation: match the exact noise/grain, color grading, depth of field, and lighting of the original.
7. No hallucination outside mask: absolutely no modifications, color shifts, or artifacts outside the masked region.

The goal: the result must look as if the erased object NEVER existed in the photograph.`

  onProgress?.('正在生成图片...')

  const sourceInline = await resolveImageToInlineData(sourceImageUrl)
  const maskInline = await resolveImageToInlineData(maskBase64)

  if (!sourceInline) throw new Error('源图片加载失败')
  if (!maskInline) throw new Error('蒙版加载失败')

  const imageParts = [
    { inline_data: { mime_type: sourceInline.mimeType, data: sourceInline.data } },
    { inline_data: { mime_type: maskInline.mimeType, data: maskInline.data } }
  ]

  const { size } = getImageParams(sourceNodeId)
  const resultUrl = await generateWithRetry(selectedModel, prompt, imageParts, selectedResolution, onProgress || (() => {}), size)

  onProgress?.('正在保存结果...')
  return await createResultNode(resultUrl, sourceNodeId, '擦除结果', 350, 0, selectedModel)
}

// 保留旧的文本输入擦除函数（兼容）
export async function eraseFromImage(options: EditOptions): Promise<string> {
  const { sourceNodeId, sourceImageUrl, userInput, onProgress } = options
  if (!userInput) throw new Error('请输入要擦除的对象')

  onProgress?.('正在润色提示词...')
  const prompt = await polishEditPrompt('erase', userInput)

  onProgress?.('正在生成图片...')
  const { size, quality } = getImageParams(sourceNodeId)

  const inline = await resolveImageToInlineData(sourceImageUrl)
  if (!inline) throw new Error('图片加载失败')

  const imageParts = [{ inline_data: { mime_type: inline.mimeType, data: inline.data } }]
  const resultUrl = await generateWithRetry(DEFAULT_IMAGE_MODEL, prompt, imageParts, quality, onProgress || (() => {}), size)

  onProgress?.('正在保存结果...')
  return await createResultNode(resultUrl, sourceNodeId, `擦除: ${userInput}`, 350, 0)
}
