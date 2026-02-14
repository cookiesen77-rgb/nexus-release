import { useGraphStore } from '@/graph/store'
import type { GraphNode } from '@/graph/types'
import { DEFAULT_IMAGE_MODEL, IMAGE_MODELS, SEEDREAM_SIZE_OPTIONS, SEEDREAM_4K_SIZE_OPTIONS } from '@/config/models'
import { getJson, postJson } from '@/lib/workflow/request'
import { resolveCachedImageUrl } from '@/lib/workflow/cache'
import { getMedia, getMediaByNodeId, saveMedia, isLargeData, isBase64Data } from '@/lib/mediaStorage'
import { requestQueue, type QueueTask } from '@/lib/workflow/requestQueue'
import { useAssetsStore } from '@/store/assets'
import { useSettingsStore } from '@/store/settings'
import { useProjectsStore } from '@/store/projects'
import { fetch as tauriFetch } from '@tauri-apps/plugin-http'

// 检测是否在 Tauri 环境中
const isTauri = typeof window !== 'undefined' && !!(window as any).__TAURI_INTERNALS__

// 根据环境选择 fetch 实现（带兜底）
// Windows 用户环境下 Tauri plugin-http 可能因代理/证书链问题失败，fallback 到 WebView fetch
const webFetch = globalThis.fetch ? globalThis.fetch.bind(globalThis) : (async () => { throw new Error('fetch is not available') }) as typeof fetch
const safeFetch: typeof fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  if (!isTauri) return await webFetch(input, init)
  try {
    return await (tauriFetch as typeof fetch)(input, init)
  } catch (err: any) {
    console.warn('[image.safeFetch] tauriFetch failed, fallback:', String(err?.message || '').slice(0, 120))
    return await webFetch(input, init)
  }
}) as typeof fetch

// 图片生成参数覆盖接口
export interface ImageGenerationOverrides {
  model?: string
  size?: string
  quality?: string
}

const normalizeText = (text: unknown) => String(text || '').replace(/\r\n/g, '\n').trim()

const toDataUrl = (b64: string, mime = 'image/png') => `data:${mime};base64,${b64}`

const isHttpUrl = (v: string) => /^https?:\/\//i.test(v)

const compressToThumbnail = (src: string, maxSize = 200, quality = 0.5): Promise<string> =>
  new Promise((resolve) => {
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => {
      const scale = Math.min(1, maxSize / Math.max(img.width, img.height))
      const w = Math.round(img.width * scale)
      const h = Math.round(img.height * scale)
      const c = document.createElement('canvas')
      c.width = w; c.height = h
      const ctx = c.getContext('2d')
      if (!ctx) { resolve(''); return }
      ctx.drawImage(img, 0, 0, w, h)
      resolve(c.toDataURL('image/jpeg', quality))
    }
    img.onerror = () => resolve('')
    img.src = src
  })

const roundEvenInt = (n: number) => {
  const v = Math.max(1, Math.round(n))
  return v % 2 === 0 ? v : v + 1
}

// Seedream：将“分辨率(1K/2K/4K)+比例(16:9等)”映射为像素宽高（用于写入 size 字段）
const seedreamSizeByRatioAndResolution = (ratio: string, resolution: string) => {
  const r = String(ratio || '').trim()
  if (/^\d{3,5}x\d{3,5}$/i.test(r)) return r

  const res = String(resolution || '').trim().toUpperCase()
  const lookup = (list: any[], label: string) => {
    const hit = (Array.isArray(list) ? list : []).find((o: any) => String(o?.label || '').trim() === label)
    const key = String(hit?.key || '').trim()
    return /^\d{3,5}x\d{3,5}$/i.test(key) ? key : ''
  }

  if (res === '4K') return lookup(SEEDREAM_4K_SIZE_OPTIONS as any, r) || lookup(SEEDREAM_SIZE_OPTIONS as any, r) || '4096x4096'
  if (res === '2K') return lookup(SEEDREAM_SIZE_OPTIONS as any, r) || '2048x2048'
  if (res === '1K') {
    const m = r.match(/^(\d+(?:\.\d+)?)\s*:\s*(\d+(?:\.\d+)?)$/)
    const a = Number(m?.[1] || 1)
    const b = Number(m?.[2] || 1)
    if (!Number.isFinite(a) || !Number.isFinite(b) || a <= 0 || b <= 0) return '1024x1024'
    const base = 1024
    if (a >= b) {
      const h = base
      const w = roundEvenInt((base * a) / b)
      return `${w}x${h}`
    }
    const w = base
    const h = roundEvenInt((base * b) / a)
    return `${w}x${h}`
  }

  // fallback：按 2K 处理
  return lookup(SEEDREAM_SIZE_OPTIONS as any, r) || '2048x2048'
}

// Gemini 生图容易在高并发或提示词不明确时返回纯文本（无 inlineData）。
// 这里统一把提示词包裹成“只输出图片”的指令，提高稳定性。
const buildGeminiImagePrompt = (raw: string) => {
  const t = normalizeText(raw)
  if (!t) return ''
  return `请直接生成图片，不要输出任何解释文字。画面描述：\n${t}`
}

const pickFirstHttpUrlFromText = (text: string) => {
  const t = String(text || '').trim()
  if (!t) return ''
  const m = t.match(/https?:\/\/\S+/i)
  if (!m) return ''
  // 去掉常见的尾随标点/引号/括号，避免 src 带上无效字符
  return String(m[0] || '').replace(/[)\]}>"'，。,.]+$/g, '').trim()
}

const extractUrlsDeep = (payload: any) => {
  const urls: string[] = []
  const seen = new Set<string>()
  const push = (val: any) => {
    if (typeof val !== 'string') return
    const v = val.trim()
    if (!v) return
    if (!v.startsWith('http') && !v.startsWith('data:')) return
    if (seen.has(v)) return
    seen.add(v)
    urls.push(v)
  }
  const walk = (obj: any, depth = 0) => {
    if (!obj || depth > 5) return
    if (typeof obj === 'string') return push(obj)
    if (Array.isArray(obj)) {
      for (const it of obj) walk(it, depth + 1)
      return
    }
    if (typeof obj !== 'object') return
    for (const k of ['url', 'image_url', 'imageUrl', 'output_url', 'result_url']) {
      if (typeof (obj as any)[k] === 'string') push((obj as any)[k])
    }
    for (const v of Object.values(obj)) walk(v, depth + 1)
  }
  walk(payload)
  return urls
}

const normalizeToImageUrl = (resp: any) => {
  const data = resp?.data
  if (Array.isArray(data) && data.length > 0) {
    const first = data[0]
    if (typeof first?.url === 'string' && first.url) return first.url
    if (typeof first?.b64_json === 'string' && first.b64_json) return toDataUrl(first.b64_json, 'image/png')
  }
  if (typeof resp?.url === 'string') return resp.url
  if (typeof resp?.image_url === 'string') return resp.image_url
  return ''
}

const resolveImageToInlineData = async (input: string) => {
  const v = String(input || '').trim()
  if (!v) return null
  if (v.startsWith('data:')) {
    const m = v.match(/^data:([^;]+);base64,(.*)$/)
    if (!m) return null
    return { mimeType: m[1] || 'image/png', data: m[2] || '' }
  }
  if (!/^https?:\/\//i.test(v)) return null

  // 使用 safeFetch（在 Tauri Windows 上必须使用插件 fetch）
  try {
    console.log('[resolveImageToInlineData] 获取图片:', v.slice(0, 80), '...')
    const res = await safeFetch(v, { method: 'GET' })
    if (!res.ok) {
      console.warn('[resolveImageToInlineData] 请求失败:', res.status)
      return null
    }
    const blob = await res.blob()
    const base64 = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader()
      reader.onerror = () => reject(new Error('read failed'))
      reader.onload = () => resolve(String(reader.result || ''))
      reader.readAsDataURL(blob)
    })
    const m = base64.match(/^data:([^;]+);base64,(.*)$/)
    if (!m) return null
    console.log('[resolveImageToInlineData] 成功获取图片, 大小:', base64.length)
    return { mimeType: m[1] || blob.type || 'image/png', data: m[2] || '' }
  } catch (err: any) {
    console.error('[resolveImageToInlineData] 错误:', err?.message || err)
    return null
  }
}

/**
 * 获取连接到配置节点的输入（提示词和参考图）
 * 与 Vue 版本 getConnectedInputs() 对齐
 */
const getConnectedInputs = async (configId: string) => {
  const s = useGraphStore.getState()
  const byId = new Map(s.nodes.map((n) => [n.id, n]))
  const connectedEdges = s.edges.filter((e) => e.target === configId)
  
  // 调试日志
  console.log('[getConnectedInputs] configId:', configId)
  console.log('[getConnectedInputs] 总边数:', s.edges.length)
  console.log('[getConnectedInputs] 连接到此节点的边:', connectedEdges.length, connectedEdges.map(e => ({ source: e.source, target: e.target })))
  
  const promptParts: string[] = []
  const refImages: string[] = []

  // Stable ordering:
  // - text -> imageConfig: sort by promptOrder if present
  // - image -> imageConfig: sort by imageOrder if present
  // Fallback to original insertion order for unknown edges.
  const promptEdges: any[] = []
  const imageEdges: any[] = []
  const otherEdges: any[] = []

  for (let idx = 0; idx < connectedEdges.length; idx++) {
    const edge = connectedEdges[idx]
    const sourceNode = byId.get(edge.source)
    if (sourceNode?.type === 'text') {
      const order = Number((edge.data as any)?.promptOrder)
      promptEdges.push({ edge, idx, order: Number.isFinite(order) && order > 0 ? order : 999999 })
      continue
    }
    if (sourceNode?.type === 'image' || sourceNode?.type === 'imageConfig') {
      const order = Number((edge.data as any)?.imageOrder)
      imageEdges.push({ edge, idx, order: Number.isFinite(order) && order > 0 ? order : 999999 })
      continue
    }
    otherEdges.push({ edge, idx, order: 999999 })
  }

  promptEdges.sort((a, b) => (a.order - b.order) || (a.idx - b.idx))
  imageEdges.sort((a, b) => (a.order - b.order) || (a.idx - b.idx))
  otherEdges.sort((a, b) => (a.idx - b.idx))

  const ordered = [...promptEdges, ...imageEdges, ...otherEdges].map((x) => x.edge)

  for (const edge of ordered) {
    const sourceNode = byId.get(edge.source)
    console.log('[getConnectedInputs] 边 source:', edge.source, '-> 节点:', sourceNode?.type, sourceNode?.data)
    if (!sourceNode) continue

    if (sourceNode.type === 'text') {
      const text = normalizeText((sourceNode.data as any)?.content || '')
      console.log('[getConnectedInputs] 提取到文本:', text?.slice(0, 50))
      if (text) promptParts.push(text)
    } else if (sourceNode.type === 'image' || sourceNode.type === 'imageConfig') {
      let imageData = (sourceNode.data as any)?.base64 || (sourceNode.data as any)?.url || (sourceNode.data as any)?.sourceUrl || ''
      if (!imageData && (sourceNode.data as any)?.mediaId) {
        try {
          const media = await getMedia((sourceNode.data as any).mediaId)
          if (media?.data) imageData = media.data
        } catch { /* ignore */ }
      }
      if (!imageData && sourceNode.id) {
        try {
          const media = await getMediaByNodeId(sourceNode.id)
          if (media?.data) imageData = media.data
        } catch { /* ignore */ }
      }
      if (imageData) refImages.push(imageData)
    }
  }

  console.log('[getConnectedInputs] 结果 - 提示词数:', promptParts.length, '参考图数:', refImages.length)

  // 支持 all-in-one 节点的内联提示词（_inlinePrompt）— 追加到上游文本之后
  const cfgNode = byId.get(configId)
  const inlinePrompt = normalizeText((cfgNode?.data as any)?._inlinePrompt || '')
  if (inlinePrompt) {
    promptParts.push(inlinePrompt)
  }

  // 支持 all-in-one 节点的内联参考图（_inlineRefImages）
  const inlineRefs: string[] = (cfgNode?.data as any)?._inlineRefImages || []
  if (Array.isArray(inlineRefs)) {
    for (const url of inlineRefs) {
      if (url && typeof url === 'string') refImages.push(url)
    }
  }

  return { prompt: promptParts.join('\n\n'), refImages }
}

/**
 * 查找已连接的空白输出图片节点（可复用）
 * 与 Vue 版本 findConnectedOutputImageNode() 对齐
 */
const findConnectedOutputImageNode = (configId: string) => {
  const s = useGraphStore.getState()
  const byId = new Map(s.nodes.map((n) => [n.id, n]))
  const outputEdges = s.edges.filter((e) => e.source === configId)

  for (const edge of outputEdges) {
    const targetNode = byId.get(edge.target)
    // 检查目标是否为空白图片节点（没有 url 且没有在 loading）
    if (
      targetNode?.type === 'image' &&
      !(targetNode.data as any)?.loading &&
      (!(targetNode.data as any)?.url || (targetNode.data as any)?.url === '')
    ) {
      return targetNode.id
    }
  }
  return null
}

export type GenerateImageFromConfigNodeOptions = {
  /**
   * 指定输出图片节点 ID（用于 loopCount 并发批量生成，避免并发抢占同一输出节点）
   */
  outputNodeId?: string
  /**
   * 是否自动选中输出节点（默认 true）
   * - 批量并发时建议关闭，避免并发任务互相抢焦点
   */
  selectOutput?: boolean
  /**
   * 是否写回配置节点 executed/outputNodeId（默认 true）
   * - 批量并发时建议关闭，由批量调度方统一在结束后写回
   */
  markConfigExecuted?: boolean
}

export const generateImageFromConfigNode = async (
  configNodeId: string,
  overrides?: ImageGenerationOverrides,
  options?: GenerateImageFromConfigNodeOptions
) => {
  const t0 = Date.now()
  // 等待确保 store 状态已同步（增加到 200ms）
  console.log('[generateImage] 开始，等待 store 同步... configNodeId:', configNodeId, 'overrides:', overrides)
  await new Promise(resolve => setTimeout(resolve, 200))
  
  const store = useGraphStore.getState()
  const selectOutput = options?.selectOutput !== false
  const markConfigExecuted = options?.markConfigExecuted !== false
  console.log('[generateImage] store 节点数:', store.nodes.length, '边数:', store.edges.length)
  
  const cfg = store.nodes.find((n) => n.id === configNodeId)
  if (!cfg || cfg.type !== 'imageConfig') {
    console.error('[generateImage] 节点未找到或类型错误:', configNodeId, cfg?.type)
    throw new Error('请选择一个"生图配置"节点')
  }

  const d: any = cfg.data || {}
  
  // 1. 获取连接的输入（与 Vue 版本一致）
  const { prompt, refImages } = await getConnectedInputs(configNodeId)
  
  console.log('[generateImage] configNodeId:', configNodeId, 'prompt长度:', prompt?.length, 'refImages:', refImages.length)
  
  if (!prompt && refImages.length === 0) {
    throw new Error('请连接文本节点（提示词）或图片节点（参考图）')
  }

  // 优先使用 overrides 参数，解决 UI 选择与实际调用不一致的问题
  const modelKey = String(overrides?.model || d.model || DEFAULT_IMAGE_MODEL)
  const modelCfg: any = (IMAGE_MODELS as any[]).find((m) => m.key === modelKey) || (IMAGE_MODELS as any[])[0]
  console.log('[generateImage] 模型配置:', { modelKey, fromOverrides: !!overrides?.model })
  if (!modelCfg) throw new Error('未找到模型配置')

  // 优先使用 overrides 参数
  const size = String(overrides?.size || d.size || modelCfg.defaultParams?.size || '')
  const quality = String(overrides?.quality || d.quality || modelCfg.defaultParams?.quality || '')

  // 2. 检查模型是否支持参考图
  const format = modelCfg.format
  const requiresPrompt = !!(modelCfg as any)?.requiresPrompt
  const supportsRefImages = !!(modelCfg as any)?.supportsReferenceImages
  const requiresRefImages = !!(modelCfg as any)?.requiresReferenceImages
  const maxRefImages = supportsRefImages
    ? (Number.isFinite(Number((modelCfg as any)?.maxRefImages)) ? Number((modelCfg as any).maxRefImages) : refImages.length)
    : 0
  const limitedRefImages = supportsRefImages ? refImages.slice(0, maxRefImages) : []

  if (requiresPrompt && !String(prompt || '').trim()) {
    throw new Error('当前模型需要提示词：请连接文本节点（提示词）后重试')
  }
  if (requiresRefImages && limitedRefImages.length === 0) {
    throw new Error('当前模型需要参考图：请连接图片节点（参考图）后重试')
  }
  if (supportsRefImages && maxRefImages > 0 && refImages.length > maxRefImages) {
    throw new Error(`当前模型参考图最多支持 ${maxRefImages} 张`)
  }

  if (!supportsRefImages && refImages.length > 0) {
    if (!prompt) {
      throw new Error('当前模型不支持参考图输入，请添加提示词或切换到支持参考图的模型')
    }
    window.$message?.warning?.('当前模型不支持参考图输入，已忽略参考图（仅使用提示词）')
  }

  // 3. 先创建/复用图片节点（显示 loading 状态）- 与 Vue 版本一致
  const forcedOutputId = String(options?.outputNodeId || '').trim()
  let imageNodeId = forcedOutputId || findConnectedOutputImageNode(configNodeId)
  const nodeX = cfg.x
  const nodeY = cfg.y
  
  let forceOutput = false
  if (forcedOutputId) {
    const forcedNode = store.nodes.find((n) => n.id === forcedOutputId)
    if (forcedNode?.type === 'image' || forcedNode?.type === 'imageConfig') {
      forceOutput = true
      // 强制使用指定输出节点
      store.updateNode(forcedOutputId, { data: { loading: true, error: '' } } as any)
    } else {
      console.warn('[generateImage] 指定 outputNodeId 无效，回退到默认创建/复用:', forcedOutputId, forcedNode?.type)
      imageNodeId = findConnectedOutputImageNode(configNodeId)
    }
  }

  if (!forceOutput) {
    // 获取重新生成模式设置
    const regenerateMode = useSettingsStore.getState().regenerateMode || 'create'
    
    // 记录旧的图片数据（用于保存到历史记录）
    let oldImageData: any = null
    
    if (imageNodeId) {
      const existingNode = store.nodes.find(n => n.id === imageNodeId)
      if (existingNode?.data?.url) {
        oldImageData = { ...existingNode.data }
      }
      
      if (regenerateMode === 'replace') {
        // 替代模式：直接更新现有节点
        store.updateNode(imageNodeId, { data: { loading: true, error: '' } } as any)
      } else {
        // 新建模式：如果已有节点有内容，创建新节点
        if (oldImageData?.url) {
          // 将旧数据保存到历史记录
          if (oldImageData.url) {
            useAssetsStore.getState().addAsset({
              type: 'image',
              src: oldImageData.url,
              title: oldImageData.label || '图片历史',
              model: modelKey
            })
          }
          // 创建新节点
          imageNodeId = store.addNode('image', { x: nodeX + 400, y: nodeY + 50 }, {
            url: '',
            loading: true,
            label: '图像生成结果'
          })
          store.addEdge(configNodeId, imageNodeId, {
            sourceHandle: 'right',
            targetHandle: 'left'
          })
        } else {
          // 复用已有的空白图片节点
          store.updateNode(imageNodeId, { data: { loading: true, error: '' } } as any)
        }
      }
    } else {
      // 创建新的图片节点（带 loading 状态）
      imageNodeId = store.addNode('image', { x: nodeX + 400, y: nodeY }, {
        url: '',
        loading: true,
        label: '图像生成结果'
      })
      // 自动连接 imageConfig → image
      store.addEdge(configNodeId, imageNodeId, {
        sourceHandle: 'right',
        targetHandle: 'left'
      })
    }
  }

  // After this point, imageNodeId is guaranteed to be non-null
  const outputNodeId = imageNodeId as string

  // 4. 调用 API 生成图片
  try {
    let imageUrl = ''
    let textFallback = ''

    if (modelCfg.format === 'gemini-image') {
      const requestParts: any[] = []
      if (prompt) requestParts.push({ text: buildGeminiImagePrompt(prompt) })
      
      // 为多张参考图添加序列号标注（多张时自动压缩防止请求体过大）
      for (let i = 0; i < limitedRefImages.length; i++) {
        const input = limitedRefImages[i]
        const inline = await resolveImageToInlineData(input)
        if (!inline) continue
        
        // 如果有多张参考图，添加序列号说明
        if (limitedRefImages.length > 1) {
          requestParts.push({ text: `[参考图${i + 1}]` })
        }
        
        requestParts.push({
          inline_data: {
            mime_type: inline.mimeType,
            data: inline.data
          }
        })
      }
      
      if (requestParts.length === 0) throw new Error('请提供提示词或参考图')

      const payload = {
        contents: [{ role: 'user', parts: requestParts }],
        generationConfig: {
          // 只要图片：避免返回纯文本导致“生图返回为空”
          responseModalities: ['IMAGE'],
          imageConfig: {
            aspectRatio: size || '1:1',
            imageSize: quality || '2K'
          }
        }
      }

      // 针对偶发“200 但无图片”的情况，额外做一次轻量重试（不影响并发）
      for (let attempt = 0; attempt < 2; attempt++) {
        const rsp = await postJson<any>(modelCfg.endpoint, payload, { authMode: modelCfg.authMode, timeoutMs: modelCfg.timeout || 240000 })
        const parts = rsp?.candidates?.[0]?.content?.parts || []
        const inline = parts.map((p: any) => p.inlineData || p.inline_data).filter(Boolean)[0]
        if (inline?.data) {
          imageUrl = toDataUrl(inline.data, inline.mimeType || inline.mime_type || 'image/png')
          break
        }
        const textPart = parts.map((p: any) => p.text).filter(Boolean)[0]
        if (typeof textPart === 'string' && textPart) {
          textFallback = textPart
          const picked = pickFirstHttpUrlFromText(textPart)
          if (picked) {
            imageUrl = picked
            break
          }
        }
        if (attempt < 1) {
          await new Promise((r) => setTimeout(r, 500))
        }
      }
    } else if (modelCfg.format === 'openai-image') {
      const payload: any = {
        model: modelCfg.key,
        prompt,
        size: size || modelCfg.defaultParams?.size || '1024x1024',
        n: 1
      }
      if (quality) payload.quality = quality
      const rsp = await postJson<any>(modelCfg.endpoint, payload, { authMode: modelCfg.authMode, timeoutMs: modelCfg.timeout || 240000 })
      imageUrl = normalizeToImageUrl(rsp)
    } else if (modelCfg.format === 'doubao-seedream') {
      // 云雾：豆包 Seedream 4.5（dall-e-3 格式外观，但字段与 OpenAI Images 不一致）
      // 文档示例：POST /v1/images/generations
      // - size: '1K' | '2K' | '4K' | '2048x2048'（像素字符串）
      // - response_format: 'url' | 'b64_json'
      // - watermark: boolean
      // - sequential_image_generation: 'disabled' | 'auto'（disabled=单图）
      // 说明：UI 上分为“尺寸(比例)”与“分辨率(1K/2K/4K)”，最终合成写入 size 字段
      const ratioRaw = String(size || '').trim()
      const resRaw = String(quality || '').trim()

      // 兼容旧数据：早期把 1K/2K/4K 塞在 size 里
      let ratio = ratioRaw
      let resolution = resRaw
      if (!resolution && /^(1k|2k|4k)$/i.test(ratio)) {
        resolution = ratio.toUpperCase()
        ratio = ''
      }

      if (!ratio) ratio = String(modelCfg.defaultParams?.size || '3:4')
      if (!resolution) resolution = String(modelCfg.defaultParams?.quality || '2K')

      const finalSize = seedreamSizeByRatioAndResolution(ratio, resolution)
      const payload: any = {
        model: modelCfg.key,
        prompt,
        size: finalSize,
        response_format: 'url',
        watermark: false,
        sequential_image_generation: 'disabled',
      }

      const imageInputs = limitedRefImages.map((v) => String(v || '').trim()).filter(Boolean)
      if (imageInputs.length > 0) {
        // 该接口需要“外网可访问的图片 URL”（data:/asset:// 等无法直接使用）
        const invalid = imageInputs.find((v) => !isHttpUrl(v))
        if (invalid) {
          throw new Error('该模型的参考图必须是 http(s) URL（建议先用画布生成的图片，或将本地图片上传到图床后再用）')
        }
        payload.image = imageInputs
      }

      const rsp = await postJson<any>(modelCfg.endpoint, payload, { authMode: modelCfg.authMode, timeoutMs: modelCfg.timeout || 240000 })
      imageUrl = normalizeToImageUrl(rsp)
    } else if (modelCfg.format === 'openai-chat-image') {
      const payload = { model: modelCfg.key, messages: [{ role: 'user', content: prompt }] }
      const rsp = await postJson<any>(modelCfg.endpoint, payload, { authMode: modelCfg.authMode, timeoutMs: modelCfg.timeout || 240000 })
      const maybe = rsp?.choices?.[0]?.message?.content
      if (typeof maybe === 'string') {
        const m = maybe.match(/https?:\/\/\S+/)
        if (m) imageUrl = m[0]
      }
      if (!imageUrl) imageUrl = normalizeToImageUrl(rsp)
    } else if (modelCfg.format === 'openai-image-edit') {
      const imageInput = limitedRefImages[0] || ''
      if (!imageInput) throw new Error('该模型需要参考图（请先连接"图片"节点）')
      const payload: any = { model: modelCfg.key, prompt, image: imageInput }
      const rsp = await postJson<any>(modelCfg.endpoint, payload, { authMode: modelCfg.authMode, timeoutMs: modelCfg.timeout || 240000 })
      imageUrl = normalizeToImageUrl(rsp) || extractUrlsDeep(rsp)[0] || ''
    } else if (modelCfg.format === 'kling-image') {
      const requestData: any = {
        model_name: modelCfg.defaultParams?.model_name || 'kling-v2-1',
        prompt,
        n: 1,
        aspect_ratio: size || modelCfg.defaultParams?.size || '1:1',
        resolution: quality || modelCfg.defaultParams?.quality || '1k'
      }
      const imageInput = limitedRefImages[0]
      if (imageInput) requestData.image = imageInput
      const resp = await postJson<any>(modelCfg.endpoint, requestData, { authMode: modelCfg.authMode, timeoutMs: modelCfg.timeout || 240000 })
      imageUrl = normalizeToImageUrl(resp) || extractUrlsDeep(resp)[0] || ''

      if (!imageUrl) {
        const taskId = resp?.data?.task_id || resp?.data?.id || resp?.task_id || resp?.id || ''
        if (!taskId) throw new Error('Kling 生图返回异常：未获取到图片或任务 ID')
        const statusUrl = `${String(modelCfg.endpoint).replace(/\/$/, '')}/${encodeURIComponent(String(taskId))}`

        const maxAttempts = 120
        for (let i = 0; i < maxAttempts; i++) {
          const polled = await getJson<any>(statusUrl, undefined, { authMode: modelCfg.authMode })
          imageUrl = normalizeToImageUrl(polled) || extractUrlsDeep(polled)[0] || ''
          if (imageUrl) break
          const statusText = String(polled?.status || polled?.data?.task_status || polled?.data?.status || polled?.task_status || '').toLowerCase()
          if (statusText && /(fail|error)/i.test(statusText)) {
            throw new Error(polled?.message || polled?.error?.message || 'Kling 生图任务失败')
          }
          await new Promise((r) => setTimeout(r, 3000))
        }
      }
    } else if (modelCfg.format === 'kling-omni-image') {
      // Kling Omni-Image：POST /kling/v1/images/omni-image
      // 查询：GET /kling/v1/images/omni-image/{id}
      const requestData: any = {
        model_name: modelCfg.defaultParams?.model_name || 'kling-image-o1',
        prompt,
        n: 1,
        aspect_ratio: size || modelCfg.defaultParams?.size || 'auto',
        resolution: quality || modelCfg.defaultParams?.quality || '2k',
      }
      if (Array.isArray(limitedRefImages) && limitedRefImages.length > 0) {
        requestData.image_list = limitedRefImages.map((u: string) => ({ image: String(u || '').trim() }))
      }
      const resp = await postJson<any>(modelCfg.endpoint, requestData, { authMode: modelCfg.authMode, timeoutMs: modelCfg.timeout || 240000 })
      imageUrl = normalizeToImageUrl(resp) || extractUrlsDeep(resp)[0] || ''

      if (!imageUrl) {
        const taskId = resp?.data?.task_id || resp?.data?.id || resp?.task_id || resp?.id || ''
        if (!taskId) throw new Error('Kling Omni-Image 返回异常：未获取到图片或任务 ID')
        const statusUrl =
          typeof modelCfg.statusEndpoint === 'function'
            ? modelCfg.statusEndpoint(String(taskId))
            : `${String(modelCfg.endpoint).replace(/\/$/, '')}/${encodeURIComponent(String(taskId))}`

        const maxAttempts = 120
        for (let i = 0; i < maxAttempts; i++) {
          const polled = await getJson<any>(statusUrl, undefined, { authMode: modelCfg.authMode })
          imageUrl = normalizeToImageUrl(polled) || extractUrlsDeep(polled)[0] || ''
          if (imageUrl) break
          const statusText = String(polled?.status || polled?.data?.task_status || polled?.data?.status || polled?.task_status || '').toLowerCase()
          if (statusText && /(fail|error)/i.test(statusText)) {
            throw new Error(polled?.message || polled?.error?.message || 'Kling Omni-Image 任务失败')
          }
          await new Promise((r) => setTimeout(r, 3000))
        }
      }
    } else if (modelCfg.format === 'tencent-image') {
      const payload: any = {
        model: modelCfg.key,
        prompt,
        version: modelCfg.defaultParams?.version,
        clarity: modelCfg.defaultParams?.clarity
      }
      const resp = await postJson<any>(modelCfg.endpoint, payload, { authMode: modelCfg.authMode, timeoutMs: modelCfg.timeout || 240000 })
      const list = resp?.data ?? resp
      const first = Array.isArray(list) ? list[0] : list
      imageUrl = String(first?.url || first?.image_url || first || '').trim()
    } else {
      throw new Error(`暂未支持该生图模型格式：${String(modelCfg.format || '')}`)
    }

    if (!imageUrl) {
      const hint = textFallback ? `模型返回文本：${String(textFallback).slice(0, 160)}` : ''
      throw new Error(`生图返回为空。${hint}`)
    }
    if (!imageUrl.startsWith('data:') && !isHttpUrl(imageUrl)) {
      // 避免把纯文本当作 <img src>，否则会请求到 /canvas/<文本> 导致“图片不显示”
      const hint = textFallback ? `模型返回文本：${String(textFallback).slice(0, 160)}` : ''
      throw new Error(`生图返回不是图片数据/URL。${hint}`)
    }

    // 5. 成功：更新图片节点
    const latestStore = useGraphStore.getState()
    const perfMode = useSettingsStore.getState().performanceMode || 'off'
    const preferFastWriteback = isTauri && perfMode === 'ultra'

    // Tauri 极速模式：先回写 URL（让画布立刻结束 loading），缓存/落库改为后台进行
    if (preferFastWriteback && isHttpUrl(imageUrl)) {
      try {
        latestStore.updateNode(outputNodeId, {
          data: {
            url: imageUrl,
            sourceUrl: imageUrl,
            loading: false,
            error: '',
            label: '文生图',
            model: modelKey,
            updatedAt: Date.now()
          }
        } as any)
      } catch {
        // ignore
      }

      // 后台：解析为可渲染的本地路径/dataURL（需要鉴权时）并写回
      void (async () => {
        try {
          const cacheT1 = Date.now()
          const cached = await resolveCachedImageUrl(imageUrl)
          console.log('[generateImage] resolveCachedImageUrl 耗时(ms):', Date.now() - cacheT1, '总耗时(ms):', Date.now() - t0)

          const storeNow = useGraphStore.getState()
          const stillExists = storeNow.nodes.some((n) => n.id === outputNodeId)
          if (!stillExists) return

          const displayUrl = cached.displayUrl
          if (displayUrl && displayUrl !== imageUrl) {
            storeNow.updateNode(outputNodeId, {
              data: {
                url: displayUrl,
                localPath: cached.localPath,
                sourceUrl: imageUrl,
                loading: false,
                error: '',
                updatedAt: Date.now()
              }
            } as any)
          }

          // 极速模式：避免后台再“二次下载 -> base64 转存”，防止与前台 <img> 争抢带宽
          // 如需跨重启持久化，可切到“平衡/稳定”模式
        } catch {
          // ignore
        }
      })()

      // 选中新创建的图片节点
      if (selectOutput) {
        latestStore.setSelected(outputNodeId)
      }
      // 同步到历史素材（先用原始 URL；若后续缓存成功会更新节点 url，但历史不强制回写）
      try {
        useAssetsStore.getState().addAsset({
          type: 'image',
          src: imageUrl,
          title: prompt?.slice(0, 50) || '画布生成',
          model: modelKey
        })
        const projectId = latestStore.projectId
        const project = useProjectsStore.getState().projects.find(p => p.id === projectId)
        if (project && !project.thumbnail && imageUrl) {
          compressToThumbnail(imageUrl).then(thumb => {
            if (thumb) useProjectsStore.getState().setThumbnail(projectId, thumb)
          }).catch(() => {})
        }
      } catch {
        // ignore
      }
      // 标记配置节点已执行
      if (markConfigExecuted) {
        latestStore.updateNode(configNodeId, { data: { executed: true, outputNodeId: outputNodeId } } as any)
      }
      return
    }

    const cacheT1 = Date.now()
    const cached = await resolveCachedImageUrl(imageUrl)
    console.log('[generateImage] resolveCachedImageUrl 耗时(ms):', Date.now() - cacheT1, '总耗时(ms):', Date.now() - t0)
    
    // 确认节点存在
    const existingNode = latestStore.nodes.find(n => n.id === outputNodeId)
    console.log('[generateImage] 节点存在检查:', existingNode ? '存在' : '不存在', existingNode?.type)
    
    const displayUrl = cached.displayUrl
    console.log('[generateImage] 准备更新节点:', outputNodeId, 'url长度:', displayUrl?.length || 0)

    // 先更新节点显示（不要被 IndexedDB 落库阻塞）
    latestStore.updateNode(outputNodeId, {
      data: {
        url: displayUrl,
        localPath: cached.localPath,
        sourceUrl: isHttpUrl(imageUrl) ? imageUrl : undefined,
        loading: false,
        error: '',
        label: '文生图',
        model: modelKey,
        updatedAt: Date.now()
      }
    } as any)

    // 后台最佳努力：落库（跨重启/垫图）。注意：不应阻塞画布出图与 Promise 完成。
    void (async () => {
      try {
        let mediaId: string | undefined
        const projectId = useGraphStore.getState().projectId || 'default'

        // 如果数据是大型数据（base64/dataURL），保存到 IndexedDB
        if (isLargeData(displayUrl) || isBase64Data(displayUrl)) {
          mediaId = await saveMedia({
            nodeId: outputNodeId,
            projectId,
            type: 'image',
            data: displayUrl,
            sourceUrl: imageUrl !== displayUrl ? imageUrl : undefined,
            model: modelKey,
          })
          if (mediaId) useGraphStore.getState().patchNodeDataSilent(outputNodeId, { mediaId })
          return
        }

        // 若返回的是 HTTP 图片 URL：最佳努力转存为 dataURL 写入 IndexedDB
        // Web 环境经常会被第三方图床 CORS 限制；该转存主要用于 Tauri（绕过 CORS，且可跨重启持久化）
        // 该步骤可能涉及再次下载图片，不应阻塞画布渲染
        if (isTauri && isHttpUrl(displayUrl)) {
          const inline = await resolveImageToInlineData(displayUrl)
          if (inline?.data) {
            const dataUrl = toDataUrl(inline.data, inline.mimeType || 'image/png')
            mediaId = await saveMedia({
              nodeId: outputNodeId,
              projectId,
              type: 'image',
              data: dataUrl,
              sourceUrl: displayUrl,
              model: modelKey,
            })
            if (mediaId) useGraphStore.getState().patchNodeDataSilent(outputNodeId, { mediaId })
          }
        }
      } catch (err) {
        console.warn('[generateImage] 后台落库失败（不影响画布显示）:', (err as any)?.message || err)
      }
    })()
    
    // 等待 React 渲染周期，确保 store 更新已同步
    await new Promise(r => setTimeout(r, 50))
    
    // 验证更新是否成功
    const afterUpdate = useGraphStore.getState().nodes.find(n => n.id === outputNodeId)
    console.log('[generateImage] 更新后验证:', afterUpdate?.id, 'url长度:', (afterUpdate?.data as any)?.url?.length || 0, 'loading:', (afterUpdate?.data as any)?.loading, 'mediaId:', (afterUpdate?.data as any)?.mediaId)
    
    // 如果验证失败，尝试重新更新
    if (!afterUpdate || !(afterUpdate.data as any)?.url) {
      console.warn('[generateImage] 节点更新验证失败，尝试重新更新')
      useGraphStore.getState().updateNode(outputNodeId, {
        data: { url: displayUrl, loading: false, error: '', model: modelKey }
      } as any)
      await new Promise(r => setTimeout(r, 50))
    }
    
    // 触发 React Flow 节点刷新事件
    try {
      const event = new CustomEvent('nexus:node-updated', { detail: { nodeId: outputNodeId, type: 'image' } })
      window.dispatchEvent(event)
    } catch (e) {
      console.warn('[generateImage] 触发刷新事件失败:', e)
    }
    
    // 选中新创建的图片节点
    if (selectOutput) {
      latestStore.setSelected(outputNodeId)
    }

    // 同步到历史素材
    try {
      useAssetsStore.getState().addAsset({
        type: 'image',
        src: displayUrl,
        title: prompt?.slice(0, 50) || '画布生成',
        model: modelKey
      })
      // 自动设置项目缩略图（如果尚未设置）
      const projectId = latestStore.projectId
      const project = useProjectsStore.getState().projects.find(p => p.id === projectId)
      if (project && !project.thumbnail && displayUrl) {
        compressToThumbnail(displayUrl).then(thumb => {
          if (thumb) useProjectsStore.getState().setThumbnail(projectId, thumb)
        }).catch(() => {})
      }
    } catch (e) {
      console.warn('[generateImage] 添加到历史素材失败:', e)
    }

    // 标记配置节点已执行
    if (markConfigExecuted) {
      latestStore.updateNode(configNodeId, { data: { executed: true, outputNodeId: outputNodeId } } as any)
    }

  } catch (err: any) {
    // 6. 失败：更新图片节点显示错误
    const latestStore = useGraphStore.getState()
    latestStore.updateNode(outputNodeId, {
      data: {
        loading: false,
        error: err?.message || '生成失败',
        updatedAt: Date.now()
      }
    } as any)
    throw err
  }
}

/**
 * 将图片生成任务加入队列（用于批量生成）
 * @param configNodeId 图片配置节点 ID
 * @param overrides 参数覆盖
 * @param callbacks 回调函数
 * @returns 任务 ID
 */
export const enqueueImageGeneration = (
  configNodeId: string,
  overrides?: ImageGenerationOverrides,
  callbacks?: {
    onProgress?: (progress: number) => void
    onComplete?: (result: any) => void
    onError?: (error: Error) => void
  }
): string => {
  return requestQueue.enqueue({
    type: 'image',
    configNodeId,
    overrides,
    priority: 10,
    onProgress: callbacks?.onProgress,
    onComplete: callbacks?.onComplete,
    onError: callbacks?.onError
  })
}

// 注册图片生成执行器
requestQueue.registerExecutor('image', async (task) => {
  const overrides = task.overrides as ImageGenerationOverrides | undefined
  await generateImageFromConfigNode(task.configNodeId, overrides)
  return { success: true, configNodeId: task.configNodeId }
})
