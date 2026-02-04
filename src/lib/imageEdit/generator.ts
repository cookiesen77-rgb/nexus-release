/**
 * Image Edit Generator | 图片编辑生成器
 * 统一封装图片编辑的生图调用
 */

import { useGraphStore } from '@/graph/store'
import { IMAGE_MODELS } from '@/config/models'
import { postJson } from '@/lib/workflow/request'
import { saveMedia, isLargeData, isBase64Data } from '@/lib/mediaStorage'
import { polishEditPrompt, describeImage, type EditType } from './prompts'
import { cropToFourGrid, cropToNineGrid, calculateNodePosition, type GridCropAreaPx, type GridCropResult } from './gridCrop'
import { fetch as tauriFetch } from '@tauri-apps/plugin-http'

// 检测 Tauri 环境
const isTauri = typeof window !== 'undefined' && !!(window as any).__TAURI_INTERNALS__

// 根据环境选择 fetch 实现（带兜底）
// Windows 用户环境下 Tauri plugin-http 可能因代理/证书链问题失败，fallback 到 WebView fetch
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

// nano-banana-pro 模型配置
const NANO_BANANA_MODEL = IMAGE_MODELS.find(m => m.key === 'gemini-3-pro-image-preview') || IMAGE_MODELS[0]

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

/**
 * 将 base64 转为 data URL
 */
const toDataUrl = (b64: string, mime = 'image/png') => `data:${mime};base64,${b64}`

/**
 * 从原图节点获取尺寸和质量参数
 */
function getImageParams(sourceNodeId: string): { size: string; quality: string } {
  const store = useGraphStore.getState()
  const node = store.nodes.find(n => n.id === sourceNodeId)
  const data = (node?.data || {}) as any
  
  // 尝试从节点数据获取
  const size = data.size || data.aspectRatio || '1:1'
  const quality = data.quality || '2K'
  
  return { size, quality }
}

/**
 * 调用 nano-banana-pro 生成图片
 */
async function generateWithNanoBanana(
  prompt: string,
  referenceImageUrl: string,
  size: string,
  quality: string
): Promise<string> {
  const requestParts: any[] = []
  
  // 添加提示词
  requestParts.push({ text: prompt })
  
  // 添加参考图
  const inline = await resolveImageToInlineData(referenceImageUrl)
  if (inline) {
    requestParts.push({
      inline_data: {
        mime_type: inline.mimeType,
        data: inline.data
      }
    })
  }
  
  if (requestParts.length === 0) {
    throw new Error('请提供提示词或参考图')
  }

  const payload = {
    contents: [{ role: 'user', parts: requestParts }],
    generationConfig: {
      responseModalities: ['IMAGE'],
      imageConfig: {
        aspectRatio: size || '1:1',
        imageSize: quality || '2K'
      }
    }
  }

  const modelCfg = NANO_BANANA_MODEL as any
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
}

/**
 * 创建结果图片节点
 */
async function createResultNode(
  imageUrl: string,
  sourceNodeId: string,
  label: string,
  offsetX: number = 100,
  offsetY: number = 0
): Promise<string> {
  const store = useGraphStore.getState()
  const sourceNode = store.nodes.find(n => n.id === sourceNodeId)
  
  const x = (sourceNode?.x || 0) + offsetX
  const y = (sourceNode?.y || 0) + offsetY
  
  // 创建图片节点
  const nodeId = store.addNode('image', { x, y }, {
    url: imageUrl,
    label,
    loading: false
  })
  
  // 保存到 IndexedDB
  if (isLargeData(imageUrl) || isBase64Data(imageUrl)) {
    try {
      const projectId = store.projectId || 'default'
      const mediaId = await saveMedia({
        nodeId,
        projectId,
        type: 'image',
        data: imageUrl,
        model: 'nano-banana-pro'
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

/**
 * 姿态变换
 */
export async function changePose(options: EditOptions): Promise<string> {
  const { sourceNodeId, sourceImageUrl, userInput, onProgress } = options
  if (!userInput) throw new Error('请输入想要的姿态')
  
  onProgress?.('正在润色提示词...')
  const prompt = await polishEditPrompt('pose', userInput)
  
  onProgress?.('正在生成图片...')
  const { size, quality } = getImageParams(sourceNodeId)
  const resultUrl = await generateWithNanoBanana(prompt, sourceImageUrl, size, quality)
  
  onProgress?.('正在保存结果...')
  const nodeId = await createResultNode(resultUrl, sourceNodeId, `姿态: ${userInput}`, 350, 0)
  
  return nodeId
}

/**
 * 角度变换
 */
export async function changeAngle(options: EditOptions): Promise<string> {
  const { sourceNodeId, sourceImageUrl, userInput, onProgress } = options
  if (!userInput) throw new Error('请输入想要的角度')
  
  onProgress?.('正在润色提示词...')
  const prompt = await polishEditPrompt('angle', userInput)
  
  onProgress?.('正在生成图片...')
  const { size, quality } = getImageParams(sourceNodeId)
  const resultUrl = await generateWithNanoBanana(prompt, sourceImageUrl, size, quality)
  
  onProgress?.('正在保存结果...')
  const nodeId = await createResultNode(resultUrl, sourceNodeId, `角度: ${userInput}`, 350, 0)
  
  return nodeId
}

/**
 * 扩图
 */
export async function expandImage(options: EditOptions): Promise<string> {
  const { sourceNodeId, sourceImageUrl, onProgress } = options
  
  onProgress?.('正在分析图片...')
  const description = await describeImage(sourceImageUrl)
  
  onProgress?.('正在润色提示词...')
  const prompt = await polishEditPrompt('expand', '', description)
  
  onProgress?.('正在生成图片...')
  const { size, quality } = getImageParams(sourceNodeId)
  const resultUrl = await generateWithNanoBanana(prompt, sourceImageUrl, size, quality)
  
  onProgress?.('正在保存结果...')
  const nodeId = await createResultNode(resultUrl, sourceNodeId, '扩图结果', 350, 0)
  
  return nodeId
}

/**
 * 抠图
 */
export async function cutoutImage(options: EditOptions): Promise<string> {
  const { sourceNodeId, sourceImageUrl, userInput, onProgress } = options
  if (!userInput) throw new Error('请输入要抠出的对象')
  
  onProgress?.('正在润色提示词...')
  const prompt = await polishEditPrompt('cutout', userInput)
  
  onProgress?.('正在生成图片...')
  const { size, quality } = getImageParams(sourceNodeId)
  const resultUrl = await generateWithNanoBanana(prompt, sourceImageUrl, size, quality)
  
  onProgress?.('正在保存结果...')
  const nodeId = await createResultNode(resultUrl, sourceNodeId, `抠图: ${userInput}`, 350, 0)
  
  return nodeId
}

/**
 * 擦除
 */
export async function eraseFromImage(options: EditOptions): Promise<string> {
  const { sourceNodeId, sourceImageUrl, userInput, onProgress } = options
  if (!userInput) throw new Error('请输入要擦除的对象')
  
  onProgress?.('正在润色提示词...')
  const prompt = await polishEditPrompt('erase', userInput)
  
  onProgress?.('正在生成图片...')
  const { size, quality } = getImageParams(sourceNodeId)
  const resultUrl = await generateWithNanoBanana(prompt, sourceImageUrl, size, quality)
  
  onProgress?.('正在保存结果...')
  const nodeId = await createResultNode(resultUrl, sourceNodeId, `擦除: ${userInput}`, 350, 0)
  
  return nodeId
}

/**
 * 四宫格裁剪
 */
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
    
    // 保存到 IndexedDB
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

/**
 * 九宫格裁剪
 */
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
    
    // 保存到 IndexedDB
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
