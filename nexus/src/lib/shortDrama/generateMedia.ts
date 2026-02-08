import { DEFAULT_IMAGE_MODEL, DEFAULT_VIDEO_MODEL, IMAGE_MODELS, SEEDREAM_SIZE_OPTIONS, SEEDREAM_4K_SIZE_OPTIONS, VIDEO_MODELS } from '@/config/models'
import * as modelsConfig from '@/config/models'
import { resolveCachedImageUrl, resolveCachedMediaUrl } from '@/lib/workflow/cache'
import { getJson, postFormData, postJson } from '@/lib/workflow/request'
import { safeFetch } from '@/lib/safeFetch'

const normalizeText = (text: unknown) => String(text || '').replace(/\r\n/g, '\n').trim()
const toDataUrl = (b64: string, mime = 'image/png') => `data:${mime};base64,${b64}`
const isHttpUrl = (v: string) => /^https?:\/\//i.test(v)
const isAssetUrl = (v: string) => /^asset:\/\//i.test(String(v || '').trim())
const isDataUrl = (v: string) => /^data:image\/[a-z0-9.+-]+;base64,/i.test(String(v || '').trim())
const isBase64Like = (v: string) => /^[A-Za-z0-9+/=]+$/.test(String(v || '').trim())

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

  if (res == '4K') return lookup(SEEDREAM_4K_SIZE_OPTIONS as any, r) || lookup(SEEDREAM_SIZE_OPTIONS as any, r) || '4096x4096'
  if (res == '2K') return lookup(SEEDREAM_SIZE_OPTIONS as any, r) || '2048x2048'
  if (res == '1K') {
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

const resolveAssetToDataUrl = async (assetUrl: string): Promise<string> => {
  const u = String(assetUrl || '').trim()
  if (!u || !isAssetUrl(u)) return u
  try {
    // asset:// 在 Tauri 下属于本地协议，优先用浏览器 fetch（plugin-http 不一定支持该协议）
    const res = await (globalThis.fetch as any)(u, { method: 'GET' })
    if (!res?.ok) throw new Error(`HTTP ${res?.status || 0}`)
    const blob = await res.blob()
    const dataUrl = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader()
      reader.onerror = () => reject(new Error('read failed'))
      reader.onload = () => resolve(String(reader.result || ''))
      reader.readAsDataURL(blob)
    })
    if (dataUrl && dataUrl.startsWith('data:')) return dataUrl
  } catch {
    // ignore
  }
  throw new Error('本地缓存素材（asset://）无法用于生成请求：请使用源链接（http/https）或重新导入该图片')
}

const getApiKey = () => {
  try {
    return localStorage.getItem('apiKey') || ''
  } catch {
    return ''
  }
}

const compressImageBase64 = async (base64Data: string, maxSizeBytes: number = 900 * 1024): Promise<string> => {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => {
      const canvas = document.createElement('canvas')
      const ctx = canvas.getContext('2d')
      if (!ctx) {
        reject(new Error('无法创建 canvas context'))
        return
      }

      let { width, height } = img
      let result = base64Data

      // 如果图片本身就很小，直接返回
      const comma = base64Data.indexOf(',')
      const currentSize = comma >= 0 ? Math.ceil((base64Data.length - (comma + 1)) * 0.75) : Math.ceil(base64Data.length * 0.75)
      if (currentSize <= maxSizeBytes) {
        resolve(base64Data)
        return
      }

      // 计算需要缩小的比例
      const sizeRatio = Math.sqrt(maxSizeBytes / currentSize)
      if (sizeRatio < 1) {
        width = Math.floor(width * Math.max(sizeRatio, 0.5))
        height = Math.floor(height * Math.max(sizeRatio, 0.5))
      }

      // 限制最大尺寸
      const maxDim = 1920
      if (width > maxDim || height > maxDim) {
        const scale = maxDim / Math.max(width, height)
        width = Math.floor(width * scale)
        height = Math.floor(height * scale)
      }

      canvas.width = width
      canvas.height = height
      ctx.drawImage(img, 0, 0, width, height)

      // 逐步降低质量直到满足大小要求
      for (let q = 0.85; q >= 0.3; q -= 0.1) {
        result = canvas.toDataURL('image/jpeg', q)
        const c = result.indexOf(',')
        const size = c >= 0 ? Math.ceil((result.length - (c + 1)) * 0.75) : Math.ceil(result.length * 0.75)
        if (size <= maxSizeBytes) {
          resolve(result)
          return
        }
      }

      // 如果还是太大，进一步缩小尺寸
      width = Math.floor(width * 0.7)
      height = Math.floor(height * 0.7)
      canvas.width = width
      canvas.height = height
      ctx.drawImage(img, 0, 0, width, height)
      result = canvas.toDataURL('image/jpeg', 0.6)
      resolve(result)
    }
    img.onerror = () => reject(new Error('图片加载失败'))
    img.src = base64Data
  })
}

const uploadImageToYunwu = async (dataUrlOrBase64: string): Promise<string> => {
  // ⚠️ 仅允许使用云雾官方图床：
  // - 文档：https://yunwu.apifox.cn/doc-7376047
  // - API：https://yunwu.apifox.cn/api-356192326
  const apiKey = getApiKey()
  if (!apiKey) throw new Error('缺少 API Key，无法上传到云雾图床。请先在设置中填写 apiKey。')

  let dataUrl = String(dataUrlOrBase64 || '').trim()
  if (!dataUrl) throw new Error('空图片数据')
  if (isBase64Like(dataUrl) && !dataUrl.startsWith('data:')) {
    dataUrl = `data:image/png;base64,${dataUrl}`
  }
  if (!dataUrl.startsWith('data:')) {
    throw new Error('云雾图床上传仅支持 dataURL/base64 输入')
  }

  const m = dataUrl.match(/^data:([^;]+);base64,(.*)$/)
  if (!m) throw new Error('图片 dataURL 解析失败')
  const mimeType = String(m[1] || 'image/png')
  const base64Content = String(m[2] || '')
  const byteCharacters = atob(base64Content)
  const byteNumbers = new Array(byteCharacters.length)
  for (let i = 0; i < byteCharacters.length; i++) {
    byteNumbers[i] = byteCharacters.charCodeAt(i)
  }
  const byteArray = new Uint8Array(byteNumbers)
  const blob = new Blob([byteArray], { type: mimeType })

  const ext = mimeType.split('/')[1] || 'png'
  const fileName = `image.${ext}`
  const form = new FormData()
  form.append('file', blob, fileName)

  const resp = await postFormData<any>('https://imageproxy.zhongzhuan.chat/api/upload', form, { authMode: 'bearer', timeoutMs: 120000 })
  const urlOut = String(resp?.url || resp?.data?.url || resp?.data?.link || '').trim()
  if (urlOut && /^https?:\/\//i.test(urlOut)) return urlOut
  throw new Error(String(resp?.error || resp?.message || resp?.data?.message || '云雾图床上传失败'))
}

const ensureSeedreamHttpImage = async (raw: string, label: string) => {
  let v = String(raw || '').trim()
  if (!v) return ''

  if (v.startsWith('blob:')) {
    try {
      const res = await (globalThis.fetch as any)(v, { method: 'GET' })
      if (!res?.ok) throw new Error(`HTTP ${res?.status || 0}`)
      const blob = await res.blob()
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader()
        reader.onerror = () => reject(new Error('read failed'))
        reader.onload = () => resolve(String(reader.result || ''))
        reader.readAsDataURL(blob)
      })
      if (dataUrl && dataUrl.startsWith('data:')) {
        v = dataUrl
      } else {
        throw new Error('blob URL 转换失败')
      }
    } catch {
      throw new Error(`${label}图片转换失败：请尝试重新导入该图片`)
    }
  }

  if (isAssetUrl(v)) v = await resolveAssetToDataUrl(v)
  if (isHttpUrl(v)) return v
  if (isDataUrl(v)) {
    const compressed = await compressImageBase64(v, 900 * 1024)
    return await uploadImageToYunwu(compressed)
  }
  if (isBase64Like(v)) {
    const dataUrl = `data:image/png;base64,${v}`
    const compressed = await compressImageBase64(dataUrl, 900 * 1024)
    return await uploadImageToYunwu(compressed)
  }
  throw new Error(`${label}需要公网可访问的图片 URL（http/https）或 dataURL/base64`)
}

const pickFirstHttpUrlFromText = (text: string) => {
  const t = String(text || '').trim()
  if (!t) return ''
  const m = t.match(/https?:\/\/\S+/i)
  if (!m) return ''
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
    if (!obj || depth > 6) return
    if (typeof obj === 'string') return push(obj)
    if (Array.isArray(obj)) {
      for (const it of obj) walk(it, depth + 1)
      return
    }
    if (typeof obj !== 'object') return
    for (const k of ['url', 'image_url', 'imageUrl', 'output_url', 'result_url', 'video_url', 'videoUrl']) {
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

// ======== gemini-image helpers ========

// 检测是否在 Tauri 环境中（用于 fetch 参考图；主请求走 postJson 已经 Tauri-safe）
const isTauri = typeof window !== 'undefined' && !!(window as any).__TAURI_INTERNALS__

const resolveImageToInlineData = async (input: string) => {
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

// Gemini 生图容易返回纯文本，这里统一包裹成“只输出图片”
const buildGeminiImagePrompt = (raw: string) => {
  const t = normalizeText(raw)
  if (!t) return ''
  return `请直接生成图片，不要输出任何解释文字。画面描述：\n${t}`
}

// ======== Public APIs ========

export type ShortDramaImageRequest = {
  modelKey?: string
  prompt: string
  size?: string
  quality?: string
  refImages?: string[]
}

export type ShortDramaImageResult = {
  imageUrl: string
  displayUrl: string
  localPath: string
}

export async function generateShortDramaImage(req: ShortDramaImageRequest): Promise<ShortDramaImageResult> {
  const prompt = normalizeText(req?.prompt)
  const desiredKey = String(req?.modelKey || DEFAULT_IMAGE_MODEL)
  const modelCfg: any = (IMAGE_MODELS as any[]).find((m) => m?.key === desiredKey) || (IMAGE_MODELS as any[])[0]
  if (!modelCfg) throw new Error('未找到图片模型配置')

  const size = String(req?.size || modelCfg?.defaultParams?.size || '').trim()
  const quality = String(req?.quality || modelCfg?.defaultParams?.quality || '').trim()
  const refImages = Array.isArray(req?.refImages) ? req!.refImages!.map((x) => String(x || '').trim()).filter(Boolean) : []

  // 根据模型配置限制参考图数量
  const maxRefImages = modelCfg?.maxRefImages ?? (modelCfg?.supportsReferenceImages === false ? 0 : 4)
  const limitedRefImages = refImages.slice(0, maxRefImages)

  if (!prompt && limitedRefImages.length === 0) {
    throw new Error('请提供提示词或参考图')
  }

  let imageUrl = ''
  let textFallback = ''

  if (modelCfg.format === 'gemini-image') {
    const requestParts: any[] = []
    if (prompt) requestParts.push({ text: buildGeminiImagePrompt(prompt) })

    for (let i = 0; i < limitedRefImages.length; i++) {
      const inline = await resolveImageToInlineData(limitedRefImages[i])
      if (!inline) continue
      if (limitedRefImages.length > 1) requestParts.push({ text: `[参考图${i + 1}]` })
      requestParts.push({
        inline_data: {
          mime_type: inline.mimeType,
          data: inline.data,
        },
      })
    }

    if (requestParts.length === 0) throw new Error('参考图解析失败，请尝试重新上传')

    const payload = {
      contents: [{ role: 'user', parts: requestParts }],
      generationConfig: {
        responseModalities: ['IMAGE'],
        imageConfig: {
          aspectRatio: size || '1:1',
          imageSize: quality || '2K',
        },
      },
    }

    // 轻量重试：偶发 200 但无图片
    for (let attempt = 0; attempt < 2; attempt++) {
      const rsp = await postJson<any>(modelCfg.endpoint, payload, {
        authMode: modelCfg.authMode,
        timeoutMs: modelCfg.timeout || 240000,
      })
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
      if (attempt < 1) await new Promise((r) => setTimeout(r, 500))
    }
  } else if (modelCfg.format === 'openai-image') {
    const payload: any = {
      model: modelCfg.key,
      prompt,
      size: size || modelCfg.defaultParams?.size || '1024x1024',
      n: 1,
    }
    if (quality) payload.quality = quality
    const rsp = await postJson<any>(modelCfg.endpoint, payload, { authMode: modelCfg.authMode, timeoutMs: modelCfg.timeout || 240000 })
    imageUrl = normalizeToImageUrl(rsp)
  } else if (modelCfg.format === 'doubao-seedream') {
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

    const seedreamRefs: string[] = []
    for (let i = 0; i < limitedRefImages.length; i++) {
      const mapped = await ensureSeedreamHttpImage(limitedRefImages[i], `参考图${i + 1}`)
      if (mapped) seedreamRefs.push(mapped)
    }

    if (seedreamRefs.length > 0) {
      payload.image = seedreamRefs
    }

    const rsp = await postJson<any>(modelCfg.endpoint, payload, {
      authMode: modelCfg.authMode,
      timeoutMs: modelCfg.timeout || 240000,
    })
    imageUrl = normalizeToImageUrl(rsp) || extractUrlsDeep(rsp)[0] || ''
  } else if (modelCfg.format === 'openai-chat-image') {
    const payload = { model: modelCfg.key, messages: [{ role: 'user', content: prompt }] }
    const rsp = await postJson<any>(modelCfg.endpoint, payload, { authMode: modelCfg.authMode, timeoutMs: modelCfg.timeout || 240000 })
    const maybe = rsp?.choices?.[0]?.message?.content
    if (typeof maybe === 'string') imageUrl = pickFirstHttpUrlFromText(maybe)
    if (!imageUrl) imageUrl = normalizeToImageUrl(rsp)
  } else if (modelCfg.format === 'openai-image-edit') {
    const imageInput = limitedRefImages[0] || ''
    if (!imageInput) throw new Error('该图片模型需要参考图')
    const payload: any = { model: modelCfg.key, prompt, image: imageInput }
    const rsp = await postJson<any>(modelCfg.endpoint, payload, { authMode: modelCfg.authMode, timeoutMs: modelCfg.timeout || 240000 })
    imageUrl = normalizeToImageUrl(rsp) || extractUrlsDeep(rsp)[0] || ''
  } else if (modelCfg.format === 'kling-image') {
    const requestData: any = {
      model_name: modelCfg.defaultParams?.model_name || 'kling-v2-1',
      prompt,
      n: 1,
      aspect_ratio: size || modelCfg.defaultParams?.size || '1:1',
      resolution: quality || modelCfg.defaultParams?.quality || '1k',
    }
    const imageInput = limitedRefImages[0]
    if (imageInput) requestData.image = imageInput
    const resp = await postJson<any>(modelCfg.endpoint, requestData, { authMode: modelCfg.authMode, timeoutMs: modelCfg.timeout || 240000 })
    imageUrl = normalizeToImageUrl(resp) || extractUrlsDeep(resp)[0] || ''

    if (!imageUrl) {
      const taskId = resp?.data?.task_id || resp?.data?.id || resp?.task_id || resp?.id || ''
      if (!taskId) throw new Error('Kling 生图返回异常：未获取到图片或任务 ID')
      const statusUrl = `${String(modelCfg.endpoint).replace(/\/$/, '')}/${encodeURIComponent(String(taskId))}`
      for (let i = 0; i < 120; i++) {
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
  } else if (modelCfg.format === 'tencent-image') {
    const payload: any = {
      model: modelCfg.key,
      prompt,
      version: modelCfg.defaultParams?.version,
      clarity: modelCfg.defaultParams?.clarity,
    }
    const resp = await postJson<any>(modelCfg.endpoint, payload, { authMode: modelCfg.authMode, timeoutMs: modelCfg.timeout || 240000 })
    const list = resp?.data ?? resp
    const first = Array.isArray(list) ? list[0] : list
    imageUrl = String(first?.url || first?.image_url || first || '').trim()
  } else {
    throw new Error(`工作台暂不支持该图片模型格式：${String(modelCfg.format || '')}`)
  }

  if (!imageUrl) {
    const hint = textFallback ? `模型返回文本：${String(textFallback).slice(0, 160)}` : ''
    throw new Error(`生图返回为空。${hint}`)
  }
  if (!imageUrl.startsWith('data:') && !isHttpUrl(imageUrl)) {
    const hint = textFallback ? `模型返回文本：${String(textFallback).slice(0, 160)}` : ''
    throw new Error(`生图返回不是图片数据/URL。${hint}`)
  }

  const cached = await resolveCachedImageUrl(imageUrl)
  if (!cached.displayUrl) {
    throw new Error(cached.error || '图片缓存失败')
  }
  return { imageUrl, displayUrl: cached.displayUrl, localPath: cached.localPath || '' }
}

export type ShortDramaVideoRequest = {
  modelKey?: string
  prompt: string
  ratio?: string
  duration?: number
  size?: string
  images?: string[] // 参考图/首帧（允许 data: 或 http）
  lastFrame?: string
}

export type ShortDramaVideoResult = {
  taskId: string
  videoUrl: string
  displayUrl: string
  localPath: string
}

const extractVideoUrlDeep = (payload: any) => {
  const urls = extractUrlsDeep(payload)
  const v = urls.find((u) => /\.(mp4|webm|mov|m4v|m3u8|avi|mkv)(\?|$)/i.test(u)) || urls[0] || ''
  return v
}

const pollVideoTask = async (id: string, modelCfg: any, statusEndpointOverride: any) => {
  const maxAttempts = 300
  const interval = 3000
  let completedWithoutUrl = 0

  for (let i = 0; i < maxAttempts; i++) {
    const statusEndpoint = statusEndpointOverride
    if (!statusEndpoint) throw new Error('未配置视频查询端点')

    let resp: any
    if (typeof statusEndpoint === 'function') {
      resp = await getJson<any>(statusEndpoint(id), undefined, { authMode: modelCfg.authMode })
    } else {
      resp = await getJson<any>(statusEndpoint, { id }, { authMode: modelCfg.authMode })
    }

    const response = resp?.Response || resp?.response || resp
    const aigcTask = response?.AigcVideoTask || response?.AigcImageTask || response?.aigc_video_task || response?.aigc_image_task
    const aigcOutput = aigcTask?.Output || aigcTask?.output
    const output = aigcOutput || response?.Output || response?.output || resp?.output || resp?.data?.output || resp?.data || resp

    const status = String(
      response?.Status ||
        response?.status ||
        response?.state ||
        aigcTask?.Status ||
        aigcTask?.status ||
        output?.TaskStatus ||
        output?.task_status ||
        output?.status ||
        output?.state ||
        resp?.status ||
        resp?.state ||
        resp?.data?.status ||
        resp?.data?.state ||
        ''
    ).toLowerCase()

    const fileInfos = aigcOutput?.FileInfos || aigcOutput?.file_infos || output?.FileInfos || output?.file_infos || []
    const videoUrlFromFileInfos = Array.isArray(fileInfos)
      ? String(
          fileInfos.find((fi: any) => {
            const fileType = String(fi?.FileType || fi?.file_type || '').toLowerCase()
            const fileUrl = fi?.FileUrl || fi?.file_url || fi?.Url || fi?.url || ''
            if (!fileUrl) return false
            if (fileType === 'video' || fileType.includes('video')) return true
            return /\.(mp4|webm|mov|m4v|m3u8|avi|mkv)(\?|$)/i.test(String(fileUrl))
          })?.FileUrl ||
            fileInfos.find((fi: any) => {
              const fileUrl = fi?.FileUrl || fi?.file_url || fi?.Url || fi?.url || ''
              if (!fileUrl) return false
              // 兜底：选第一个非图片
              return !/\.(jpg|jpeg|png|gif|webp|bmp|svg)(\?|$)/i.test(String(fileUrl))
            })?.FileUrl ||
            ''
        )
      : ''

    const outputVideo = output?.video || resp?.output?.video || resp?.data?.output?.video
    const downloads = resp?.downloads || resp?.data?.downloads || output?.downloads
    const downloadUrl = Array.isArray(downloads) && downloads.length > 0 ? (downloads[0]?.url || downloads[0]?.video_url || downloads[0]) : null
    const videoUrl =
      videoUrlFromFileInfos ||
      outputVideo ||
      downloadUrl ||
      aigcOutput?.VideoUrl ||
      aigcOutput?.video_url ||
      output?.VideoUrl ||
      output?.video_url ||
      output?.ResultUrl ||
      output?.result_url ||
      response?.VideoUrl ||
      response?.video_url ||
      resp?.VideoUrl ||
      resp?.video_url ||
      resp?.result_url ||
      resp?.data?.video_url

    if (typeof videoUrl === 'string' && videoUrl.startsWith('http')) return videoUrl
    const deep = extractVideoUrlDeep(resp)
    if (deep && deep.startsWith('http')) return deep

    const isCompleted = /^(finish|finished|completed|complete|success|done|ready|succeeded)$/i.test(status)
    if (isCompleted && !videoUrl) {
      completedWithoutUrl += 1
      // 对于 sora-openai 格式，视频 URL 是 /v1/videos/{id}/content
      if (modelCfg.format === 'sora-openai') {
        const contentUrl = `/v1/videos/${id}/content`
        console.log('[pollVideoTask] Sora OpenAI 格式：构造视频下载 URL:', contentUrl)
        return contentUrl
      }
      const errCode = aigcTask?.ErrCode || aigcTask?.err_code || aigcTask?.error_code
      const errMsg = aigcTask?.Message || aigcTask?.message || aigcTask?.error_message || aigcTask?.error
      if (errCode || errMsg) {
        throw new Error(String(errMsg || errCode || '视频生成失败'))
      }
      // 成功状态但没有返回 URL，继续轮询一段时间
      if (completedWithoutUrl >= 10) {
        throw new Error('视频任务已完成但未返回下载地址，请稍后重试或联系后端')
      }
    }
    if (/^(failed|fail|error)$/i.test(status)) {
      const rawErr = resp?.error?.message || resp?.message || resp?.data?.error?.message || '视频生成失败'
      throw new Error(String(rawErr))
    }

    await new Promise((r) => setTimeout(r, interval))
  }
  throw new Error('视频生成超时')
}

export async function generateShortDramaVideo(req: ShortDramaVideoRequest): Promise<ShortDramaVideoResult> {
  const prompt = normalizeText(req?.prompt)
  const desiredKey = String(req?.modelKey || DEFAULT_VIDEO_MODEL)
  const resolved: any = (modelsConfig as any)?.getModelByName?.(desiredKey) || null
  const modelCfg: any =
    (resolved && String(resolved?.format || '').includes('video') ? resolved : null) ||
    (VIDEO_MODELS as any[]).find((m) => m?.key === desiredKey) ||
    (VIDEO_MODELS as any[])[0]
  if (!modelCfg) throw new Error('未找到视频模型配置')

  const ratio = String(req?.ratio || modelCfg?.defaultParams?.ratio || '').trim()
  const duration = Number.isFinite(req?.duration) && Number(req?.duration) > 0 ? Number(req?.duration) : Number(modelCfg?.defaultParams?.duration || 0)
  const size = String(req?.size || modelCfg?.defaultParams?.size || '').trim()
  const images = Array.isArray(req?.images) ? req!.images!.map((x) => String(x || '').trim()).filter(Boolean) : []
  const lastFrame = String(req?.lastFrame || '').trim()

  if (!prompt && images.length === 0) {
    throw new Error('请提供视频提示词或参考图')
  }

  let payload: any = null
  let endpointOverride: string = modelCfg.endpoint
  let statusEndpointOverride: any = modelCfg.statusEndpoint

  let useFormData = false

  if (modelCfg.format === 'veo-unified') {
    payload = { model: modelCfg.key, prompt }
    if (images.length > 0) payload.images = images.slice(0, Number(modelCfg.maxImages || 3))
    if (ratio === '16:9' || ratio === '9:16') payload.aspect_ratio = ratio
    payload.duration = Number.isFinite(duration) && duration > 0 ? duration : Number(modelCfg.defaultParams?.duration || 8)
    const ep = modelCfg.defaultParams?.enhancePrompt
    if (typeof ep === 'boolean') payload.enhance_prompt = ep
    const up = modelCfg.defaultParams?.enableUpsample
    if (typeof up === 'boolean') payload.enable_upsample = up
  } else if (modelCfg.format === 'veo-openai') {
    // Veo 3.x OpenAI 格式：multipart/form-data
    // 端点：POST /v1/videos, 查询：GET /v1/videos/{id}
    // 参数：model, prompt, duration_seconds (4/6/8), size (16x9/9x16), input_reference
    useFormData = true
    const fd = new FormData()
    fd.append('model', modelCfg.key)
    fd.append('prompt', prompt || '')
    const secondsValue = Number.isFinite(duration) && duration > 0 ? String(duration) : String(modelCfg.defaultParams?.duration || 8)
    fd.append('duration_seconds', secondsValue)
    const sizeValue = ratio === '9:16' ? '9x16' : '16x9'
    fd.append('size', sizeValue)

    // 首帧图片
    const firstRaw = String(images[0] || '').trim()
    if (firstRaw) {
      let imgDataUrl = firstRaw
      if (isAssetUrl(firstRaw)) imgDataUrl = await resolveAssetToDataUrl(firstRaw)
      else if (isHttpUrl(firstRaw)) {
        const res = await safeFetch(firstRaw)
        if (!res.ok) throw new Error('下载首帧图片失败')
        const blob = await res.blob()
        imgDataUrl = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader()
          reader.onerror = () => reject(new Error('读取失败'))
          reader.onload = () => resolve(String(reader.result || ''))
          reader.readAsDataURL(blob)
        })
      }
      if (imgDataUrl.startsWith('data:')) {
        const compressed = await compressImageBase64(imgDataUrl, 900 * 1024)
        const match = compressed.match(/^data:([^;]+);base64,(.+)$/)
        if (match) {
          const mimeType = match[1]
          const byteString = atob(match[2])
          const byteNumbers = new Array(byteString.length)
          for (let i = 0; i < byteString.length; i++) byteNumbers[i] = byteString.charCodeAt(i)
          const blob = new Blob([new Uint8Array(byteNumbers)], { type: mimeType })
          fd.append('input_reference', blob, 'input.png')
        }
      }
    }
    payload = fd
    console.log('[generateShortDramaVideo] veo-openai FormData payload prepared')
  } else if (modelCfg.format === 'sora-unified') {
    const orientation = ratio === '9:16' ? 'portrait' : 'landscape'
    const dur = Number.isFinite(duration) && duration > 0 ? duration : Number(modelCfg.defaultParams?.duration || 15)
    payload = {
      model: modelCfg.key,
      prompt,
      orientation,
      size: size || modelCfg.defaultParams?.size || 'large',
      duration: dur,
    }
    if (images.length > 0) payload.images = images.slice(0, Number(modelCfg.maxImages || 2))
    const watermark = modelCfg.defaultParams?.watermark
    if (typeof watermark === 'boolean') payload.watermark = watermark
    const priv = modelCfg.defaultParams?.private
    if (typeof priv === 'boolean') payload.private = priv
  } else if (modelCfg.format === 'sora-openai') {
    // Sora OpenAI 视频格式：POST /v1/videos
    // 查询：GET /v1/videos/{id}, 下载：GET /v1/videos/{id}/content
    // 有首帧图片时用 FormData (binary upload)，无图片时用 JSON
    const sizeValue = size || modelCfg.defaultParams?.size || (ratio === '9:16' ? '720x1280' : '1280x720')
    const secondsValue = Number.isFinite(duration) && duration > 0 ? String(duration) : String(modelCfg.defaultParams?.duration || 10)

    const firstFrameUrl = String(images[0] || '').trim()

    if (firstFrameUrl) {
      // 有首帧 → FormData (input_reference 需要 binary)
      useFormData = true
      const fd = new FormData()
      fd.append('model', modelCfg.key)
      fd.append('prompt', prompt || '')
      fd.append('size', sizeValue)
      fd.append('seconds', secondsValue)
      const watermark2 = modelCfg.defaultParams?.watermark
      if (typeof watermark2 === 'boolean') fd.append('watermark', String(watermark2))

      let imgDataUrl = firstFrameUrl
      if (imgDataUrl.startsWith('blob:')) {
        const res = await safeFetch(imgDataUrl)
        if (!res.ok) throw new Error('下载首帧图片失败')
        const blob = await res.blob()
        imgDataUrl = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader()
          reader.onerror = () => reject(new Error('读取失败'))
          reader.onload = () => resolve(String(reader.result || ''))
          reader.readAsDataURL(blob)
        })
      }
      if (isAssetUrl(imgDataUrl)) imgDataUrl = await resolveAssetToDataUrl(imgDataUrl)
      if (isHttpUrl(imgDataUrl)) {
        try {
          const res = await safeFetch(imgDataUrl)
          if (res.ok) fd.append('input_reference', await res.blob(), 'input.png')
        } catch { /* skip image */ }
      } else if (imgDataUrl.startsWith('data:')) {
        const compressed = await compressImageBase64(imgDataUrl, 900 * 1024)
        const match = compressed.match(/^data:([^;]+);base64,(.+)$/)
        if (match) {
          const byteString = atob(match[2])
          const bytes = new Uint8Array(byteString.length)
          for (let i = 0; i < byteString.length; i++) bytes[i] = byteString.charCodeAt(i)
          fd.append('input_reference', new Blob([bytes], { type: match[1] }), 'input.png')
        }
      }
      payload = fd
    } else {
      // 无首帧 → JSON
      payload = {
        model: modelCfg.key,
        prompt: prompt || '',
        size: sizeValue,
        seconds: secondsValue,
      }
      const watermark2 = modelCfg.defaultParams?.watermark
      if (typeof watermark2 === 'boolean') (payload as any).watermark = watermark2
    }
    console.log('[generateShortDramaVideo] sora-openai prepared, model:', modelCfg.key, 'seconds:', secondsValue, 'hasImage:', !!firstFrameUrl, 'useFormData:', useFormData)
  } else if (modelCfg.format === 'unified-video') {
    const requiresImages = typeof modelCfg.requiresImages === 'boolean' ? modelCfg.requiresImages : false
    const imagesMustBeHttp = typeof modelCfg.imagesMustBeHttp === 'boolean' ? modelCfg.imagesMustBeHttp : false
    const maxImages = Number(modelCfg.maxImages || 3)

    let imagesForPayload: string[] = images
    if (imagesMustBeHttp) {
      const cache = new Map<string, string>()
      const out: string[] = []
      for (const raw of images) {
        if (out.length >= maxImages) break
        const v0 = String(raw || '').trim()
        if (!v0) continue

        // 处理 blob: URL - 转换为 dataURL
        if (v0.startsWith('blob:')) {
          try {
            const res = await (globalThis.fetch as any)(v0, { method: 'GET' })
            if (!res?.ok) throw new Error(`HTTP ${res?.status || 0}`)
            const blob = await res.blob()
            const dataUrl = await new Promise<string>((resolve, reject) => {
              const reader = new FileReader()
              reader.onerror = () => reject(new Error('read failed'))
              reader.onload = () => resolve(String(reader.result || ''))
              reader.readAsDataURL(blob)
            })
            if (dataUrl && dataUrl.startsWith('data:')) {
              const compressed = await compressImageBase64(dataUrl, 900 * 1024)
              const uploaded = await uploadImageToYunwu(compressed)
              cache.set(v0, uploaded)
              out.push(uploaded)
              continue
            }
          } catch (err) {
            console.error('[generateShortDramaVideo] blob URL 转换失败:', err)
            throw new Error('blob 图片转换失败，请尝试重新导入该图片')
          }
        }

        if (isHttpUrl(v0)) {
          out.push(v0)
          continue
        }
        const cached = cache.get(v0)
        if (cached) {
          // 保留顺序与重复（首/尾同图时仍传两张）
          out.push(cached)
          continue
        }
        if (isAssetUrl(v0)) {
          const dataUrl = await resolveAssetToDataUrl(v0)
          const compressed = await compressImageBase64(dataUrl, 900 * 1024)
          const uploaded = await uploadImageToYunwu(compressed)
          cache.set(v0, uploaded)
          out.push(uploaded)
          continue
        }
        if (isDataUrl(v0)) {
          const compressed = await compressImageBase64(v0, 900 * 1024)
          const uploaded = await uploadImageToYunwu(compressed)
          cache.set(v0, uploaded)
          out.push(uploaded)
          continue
        }
        if (isBase64Like(v0)) {
          const dataUrl = `data:image/png;base64,${v0}`
          const compressed = await compressImageBase64(dataUrl, 900 * 1024)
          const uploaded = await uploadImageToYunwu(compressed)
          cache.set(v0, uploaded)
          out.push(uploaded)
          continue
        }
        throw new Error('该视频模型需要公网可访问的图片 URL（http/https）或 dataURL 图片作为垫图。')
      }
      imagesForPayload = out
    }

    if (imagesMustBeHttp && images.length > 0 && imagesForPayload.length === 0) {
      throw new Error('该视频模型需要垫图，但未找到可用的图片（请提供首帧/尾帧/参考图）。')
    }
    if (requiresImages && imagesForPayload.length === 0) {
      throw new Error('该视频模型需要垫图（请提供至少 1 张参考图/首帧）')
    }
    payload = {
      model: modelCfg.key,
      prompt,
      aspect_ratio: ratio || modelCfg.defaultParams?.ratio || '1:1',
      size: size || modelCfg.defaultParams?.size || '720P',
    }
    if (imagesForPayload.length > 0) payload.images = imagesForPayload.slice(0, maxImages)
    const supportsDuration = typeof modelCfg.supportsDuration === 'boolean' ? modelCfg.supportsDuration : true
    if (supportsDuration && Number.isFinite(duration) && duration > 0) {
      payload.duration = duration
    }
  } else if (modelCfg.format === 'kling-video') {
    const modelName = modelCfg.defaultParams?.model_name || 'kling-v2-6'
    const mode = modelCfg.defaultParams?.mode || 'pro'
    const sound = modelCfg.defaultParams?.sound || 'off'
    let durValue = Number.isFinite(duration) && duration > 0 ? String(duration) : String(modelCfg.defaultParams?.duration || 10)
    const supportsSound = /^kling-v2-6/i.test(String(modelName || '').trim())

    // API 约束：kling-video 的 duration 只支持 5 和 10 秒
    const durNum = Number(durValue)
    if (durNum !== 5 && durNum !== 10) {
      durValue = durNum > 7 ? '10' : '5'
      console.warn('[generateShortDramaVideo] kling-video duration 只支持 5/10 秒，已自动调整为:', durValue)
    }

    const ensureHttpImage = async (raw: string, label: string) => {
      let v = String(raw || '').trim()
      if (!v) return ''

      // 处理 blob: URL - 转换为 dataURL
      if (v.startsWith('blob:')) {
        try {
          const res = await (globalThis.fetch as any)(v, { method: 'GET' })
          if (!res?.ok) throw new Error(`HTTP ${res?.status || 0}`)
          const blob = await res.blob()
          const dataUrl = await new Promise<string>((resolve, reject) => {
            const reader = new FileReader()
            reader.onerror = () => reject(new Error('read failed'))
            reader.onload = () => resolve(String(reader.result || ''))
            reader.readAsDataURL(blob)
          })
          if (dataUrl && dataUrl.startsWith('data:')) {
            v = dataUrl
          } else {
            throw new Error('blob URL 转换失败')
          }
        } catch (err) {
          console.error(`[generateShortDramaVideo] ${label} blob URL 转换失败:`, err)
          throw new Error(`${label}图片转换失败：请尝试重新导入该图片`)
        }
      }

      if (isAssetUrl(v)) v = await resolveAssetToDataUrl(v)
      if (isHttpUrl(v)) return v
      if (isDataUrl(v)) {
        const compressed = await compressImageBase64(v, 900 * 1024)
        return await uploadImageToYunwu(compressed)
      }
      if (isBase64Like(v)) {
        const dataUrl = `data:image/png;base64,${v}`
        const compressed = await compressImageBase64(dataUrl, 900 * 1024)
        return await uploadImageToYunwu(compressed)
      }
      throw new Error(`${label}需要公网可访问的图片 URL（http/https）或 dataURL/base64`)
    }

    const firstRaw = String(images[0] || '').trim()
    const tailRaw = String(lastFrame || '').trim()

    // 仅有尾帧时，按纯文生执行（匹配 UI 提示语义），不强行把尾帧当首帧
    const hasFirstFrame = !!firstRaw

    if (hasFirstFrame) {
      const first = await ensureHttpImage(firstRaw, '首帧')
      const tail = tailRaw ? await ensureHttpImage(tailRaw, '尾帧') : ''
      endpointOverride = modelCfg.endpointImage || endpointOverride
      statusEndpointOverride = modelCfg.statusEndpointImage || statusEndpointOverride
      payload = {
        model_name: modelName,
        image: first,
        mode,
        duration: durValue,
      }
      // API 约束：image_tail 不能为空字符串，仅在有尾帧时才传入
      if (tail) payload.image_tail = tail
      // API 约束：sound 与 image_tail 不兼容，仅在无尾帧时才启用 sound
      if (supportsSound && !tail) payload.sound = sound
      if (prompt) payload.prompt = prompt
      console.log('[generateShortDramaVideo] kling-video (图生视频) payload:', JSON.stringify(payload, null, 2))
    } else {
      if (!String(prompt || '').trim()) throw new Error('Kling 文生视频需要提示词')
      payload = { model_name: modelName, prompt, mode, duration: durValue, sound }
      if (ratio) payload.aspect_ratio = ratio
      console.log('[generateShortDramaVideo] kling-video (文生视频) payload:', JSON.stringify(payload, null, 2))
    }
  } else if (modelCfg.format === 'kling-multi-image2video') {
    // Kling 多图参考生视频：POST /kling/v1/videos/multi-image2video
    // 查询：GET /kling/v1/videos/multi-image2video/{id}
    const modelName = modelCfg.defaultParams?.model_name || 'kling-v1-6'
    const mode = modelCfg.defaultParams?.mode || 'std'
    let durValue = Number.isFinite(duration) && duration > 0 ? String(duration) : String(modelCfg.defaultParams?.duration || 5)
    const promptText = String(prompt || '').trim()
    if (!promptText) throw new Error('Kling 多图参考生视频需要提示词')
    if (!Array.isArray(images) || images.length === 0) {
      throw new Error('Kling 多图参考生视频需要至少 1 张参考图/首帧')
    }

    // API 约束：multi-image2video 的 duration 只支持 5 和 10 秒
    const durNum = Number(durValue)
    if (durNum !== 5 && durNum !== 10) {
      durValue = durNum > 7 ? '10' : '5'
      console.warn('[generateShortDramaVideo] multi-image2video duration 只支持 5/10 秒，已自动调整为:', durValue)
    }

    const ensureHttpImage = async (raw: string, label: string) => {
      let v = String(raw || '').trim()
      if (!v) return ''

      // 处理 blob: URL - 转换为 dataURL
      if (v.startsWith('blob:')) {
        try {
          const res = await (globalThis.fetch as any)(v, { method: 'GET' })
          if (!res?.ok) throw new Error(`HTTP ${res?.status || 0}`)
          const blob = await res.blob()
          const dataUrl = await new Promise<string>((resolve, reject) => {
            const reader = new FileReader()
            reader.onerror = () => reject(new Error('read failed'))
            reader.onload = () => resolve(String(reader.result || ''))
            reader.readAsDataURL(blob)
          })
          if (dataUrl && dataUrl.startsWith('data:')) {
            v = dataUrl
          } else {
            throw new Error('blob URL 转换失败')
          }
        } catch (err) {
          console.error(`[generateShortDramaVideo] ${label} blob URL 转换失败:`, err)
          throw new Error(`${label}图片转换失败：请尝试重新导入该图片`)
        }
      }

      if (isAssetUrl(v)) v = await resolveAssetToDataUrl(v)
      if (isHttpUrl(v)) return v
      if (isDataUrl(v)) {
        const compressed = await compressImageBase64(v, 900 * 1024)
        return await uploadImageToYunwu(compressed)
      }
      if (isBase64Like(v)) {
        const dataUrl = `data:image/png;base64,${v}`
        const compressed = await compressImageBase64(dataUrl, 900 * 1024)
        return await uploadImageToYunwu(compressed)
      }
      throw new Error(`${label}需要公网可访问的图片 URL（http/https）或 dataURL/base64`)
    }

    const max = Number.isFinite(Number(modelCfg.maxImages)) ? Number(modelCfg.maxImages) : 4
    const image_list: any[] = []
    for (let i = 0; i < Math.min(max, images.length); i++) {
      const u = await ensureHttpImage(images[i], `参考图${i + 1}`)
      if (u) image_list.push({ image: u })
    }
    if (image_list.length === 0) throw new Error('Kling 多图参考生视频参考图为空')

    payload = { model_name: modelName, image_list, prompt: promptText, mode, duration: durValue }
    if (ratio) payload.aspect_ratio = ratio
    console.log('[generateShortDramaVideo] kling-multi-image2video payload:', JSON.stringify(payload, null, 2))
  } else if (modelCfg.format === 'kling-omni-video') {
    // Kling Omni-Video：POST /kling/v1/videos/omni-video
    // 查询：GET /kling/v1/videos/omni-video/{id}
    const modelName = modelCfg.defaultParams?.model_name || 'kling-video-o1'
    const mode = modelCfg.defaultParams?.mode || 'pro'
    let durValue = Number.isFinite(duration) && duration > 0 ? String(duration) : String(modelCfg.defaultParams?.duration || 5)
    const promptText = String(prompt || '').trim()
    if (!promptText) throw new Error('Kling Omni-Video 需要提示词')

    const ensureHttpImage = async (raw: string, label: string) => {
      let v = String(raw || '').trim()
      if (!v) return ''

      // 处理 blob: URL - 转换为 dataURL
      if (v.startsWith('blob:')) {
        try {
          const res = await (globalThis.fetch as any)(v, { method: 'GET' })
          if (!res?.ok) throw new Error(`HTTP ${res?.status || 0}`)
          const blob = await res.blob()
          const dataUrl = await new Promise<string>((resolve, reject) => {
            const reader = new FileReader()
            reader.onerror = () => reject(new Error('read failed'))
            reader.onload = () => resolve(String(reader.result || ''))
            reader.readAsDataURL(blob)
          })
          if (dataUrl && dataUrl.startsWith('data:')) {
            v = dataUrl
          } else {
            throw new Error('blob URL 转换失败')
          }
        } catch (err) {
          console.error(`[generateShortDramaVideo] ${label} blob URL 转换失败:`, err)
          throw new Error(`${label}图片转换失败：请尝试重新导入该图片`)
        }
      }

      if (isAssetUrl(v)) v = await resolveAssetToDataUrl(v)
      if (isHttpUrl(v)) return v
      if (isDataUrl(v)) {
        const compressed = await compressImageBase64(v, 900 * 1024)
        return await uploadImageToYunwu(compressed)
      }
      if (isBase64Like(v)) {
        const dataUrl = `data:image/png;base64,${v}`
        const compressed = await compressImageBase64(dataUrl, 900 * 1024)
        return await uploadImageToYunwu(compressed)
      }
      throw new Error(`${label}需要公网可访问的图片 URL（http/https）或 dataURL/base64`)
    }

    const firstFrame = images[0] || ''
    const image_list: any[] = []
    if (firstFrame) {
      const u = await ensureHttpImage(firstFrame, '首帧')
      if (u) image_list.push({ image_url: u, type: 'first_frame' })
    }
    if (lastFrame) {
      if (!firstFrame) throw new Error('Kling Omni-Video 不支持仅尾帧：有尾帧时必须同时提供首帧')
      const u = await ensureHttpImage(lastFrame, '尾帧')
      if (u) image_list.push({ image_url: u, type: 'end_frame' })
    }

    // API 约束：使用首帧/尾帧模式时，不应同时发送无 type 的参考图
    // 参考图（无 type）仅用于纯参考模式（无首帧/尾帧）
    const hasFrameImages = image_list.some((img: any) => img.type === 'first_frame' || img.type === 'end_frame')
    if (!hasFrameImages) {
      // 仅在无首帧/尾帧时才添加参考图
      const extra = images
        .slice(1)
        .map((x) => String(x || '').trim())
        .filter((x) => x && x !== lastFrame)
      const maxExtra = Math.max(0, Number(modelCfg.maxImages || 6))
      for (let i = 0; i < Math.min(maxExtra, extra.length); i++) {
        const u = await ensureHttpImage(extra[i], `参考图${i + 1}`)
        if (u) image_list.push({ image_url: u })
      }
    }

    // API 约束：使用首帧图生视频时，duration 只支持 5 和 10 秒
    const hasFirstFrame = image_list.some((img: any) => img.type === 'first_frame')
    const hasEndFrame = image_list.some((img: any) => img.type === 'end_frame')
    if (hasFirstFrame) {
      const durNum = Number(durValue)
      if (durNum !== 5 && durNum !== 10) {
        durValue = durNum > 7 ? '10' : '5'
        console.warn('[generateShortDramaVideo] 首帧模式 duration 只支持 5/10 秒，已自动调整为:', durValue)
      }
    }

    payload = { model_name: modelName, prompt: promptText, image_list, mode, duration: durValue }
    // API 约束：使用首帧时，aspect_ratio 由图片推断，不应传入；仅纯文生视频时需要 aspect_ratio
    if (!hasFirstFrame && ratio) payload.aspect_ratio = ratio
    console.log('[generateShortDramaVideo] kling-omni-video payload:', JSON.stringify(payload, null, 2))
    console.log('[generateShortDramaVideo] image_list 详情:', { hasFirstFrame, hasEndFrame, imageCount: image_list.length })
  } else if (modelCfg.format === 'volc-seedance-video') {
    // doubao-seedance-1-5-pro-251215
    // 端点：POST /volc/v1/contents/generations/tasks
    // 查询：GET /volc/v1/contents/generations/tasks/{id}
    const promptText = String(prompt || '').trim()
    if (!promptText) throw new Error('seedance-1-5-pro 需要提示词')
    const durValue = Number.isFinite(duration) && duration > 0 ? duration : Number(modelCfg.defaultParams?.duration || 4)
    const ratioValue = String(ratio || modelCfg.defaultParams?.ratio || 'adaptive') || 'adaptive'
    const watermark = typeof modelCfg.defaultParams?.watermark === 'boolean' ? modelCfg.defaultParams.watermark : false

    const ensureHttpImage = async (raw: string, label: string) => {
      let v = String(raw || '').trim()
      if (!v) return ''
      if (isAssetUrl(v)) v = await resolveAssetToDataUrl(v)
      if (isHttpUrl(v)) return v
      if (isDataUrl(v)) {
        const compressed = await compressImageBase64(v, 900 * 1024)
        return await uploadImageToYunwu(compressed)
      }
      if (isBase64Like(v)) {
        const dataUrl = `data:image/png;base64,${v}`
        const compressed = await compressImageBase64(dataUrl, 900 * 1024)
        return await uploadImageToYunwu(compressed)
      }
      throw new Error(`${label}需要公网可访问的图片 URL（http/https）或 dataURL/base64`)
    }

    const content: any[] = []
    content.push({ type: 'text', text: promptText })

    const firstRaw = String(images[0] || '').trim()
    const tailRaw = String(lastFrame || '').trim()
    let firstUrl = firstRaw ? await ensureHttpImage(firstRaw, '首帧') : ''
    let lastUrl = tailRaw ? await ensureHttpImage(tailRaw, '尾帧') : ''

    if (firstUrl) {
      content.push({
        type: 'image_url',
        image_url: { url: firstUrl },
        ...(lastUrl ? { role: 'first_frame' } : {})
      })
    }
    if (lastUrl) {
      content.push({
        type: 'image_url',
        image_url: { url: lastUrl },
        role: 'last_frame'
      })
    }

    payload = {
      model: modelCfg.key,
      content,
      ratio: ratioValue,
      duration: durValue,
      watermark
    }
    console.log('[generateShortDramaVideo] volc-seedance-video payload:', JSON.stringify(payload, null, 2))
  } else if (modelCfg.format === 'alibailian-wan-video') {
    // 通义万象 wan2.6-i2v
    // 端点：POST /alibailian/api/v1/services/aigc/video-generation/video-synthesis
    // 查询：GET /alibailian/api/v1/tasks/{task_id}
    const ensureHttpImage = async (raw: string, label: string) => {
      let v = String(raw || '').trim()
      if (!v) return ''
      if (isAssetUrl(v)) v = await resolveAssetToDataUrl(v)
      if (isHttpUrl(v)) return v
      if (isDataUrl(v)) {
        const compressed = await compressImageBase64(v, 900 * 1024)
        return await uploadImageToYunwu(compressed)
      }
      if (isBase64Like(v)) {
        const dataUrl = `data:image/png;base64,${v}`
        const compressed = await compressImageBase64(dataUrl, 900 * 1024)
        return await uploadImageToYunwu(compressed)
      }
      throw new Error(`${label}需要公网可访问的图片 URL（http/https）或 dataURL/base64`)
    }

    const firstRaw = String(images[0] || '').trim()
    if (!firstRaw) throw new Error('wan2.6-i2v 需要首帧图片')
    const imageUrl = await ensureHttpImage(firstRaw, '首帧')

    const sizeValue = String(modelCfg.defaultParams?.size || '1080P')
    const durValue = Number.isFinite(duration) && duration > 0 ? duration : Number(modelCfg.defaultParams?.duration || 5)
    const promptExtend = typeof modelCfg.defaultParams?.prompt_extend === 'boolean' ? modelCfg.defaultParams.prompt_extend : true

    payload = {
      model: modelCfg.key,
      input: {
        prompt: prompt || '',
        image_url: imageUrl,
        img_url: imageUrl,
      },
      parameters: {
        resolution: sizeValue,
        duration: durValue,
        prompt_extend: promptExtend,
      }
    }
    console.log('[generateShortDramaVideo] alibailian-wan-video payload:', JSON.stringify(payload, null, 2))
  } else if (modelCfg.format === 'minimax-hailuo-video') {
    // 云雾海螺（MiniMax）端点：POST /minimax/v1/video_generation
    // 查询：GET /minimax/v1/query/video_generation?task_id=...
    // API 约束：
    // - 纯文生视频：model=MiniMax-Hailuo-02, 只需 model/prompt/duration
    // - 图生视频（仅首帧）：model=MiniMax-Hailuo-2.3, 需要 first_frame_image/resolution/prompt_optimizer
    // - 首尾帧视频：model=MiniMax-Hailuo-02, 需要 first_frame_image/last_frame_image/resolution/prompt_optimizer
    const ensureHttpImage = async (raw: string, label: string) => {
      let v = String(raw || '').trim()
      if (!v) return ''
      if (isAssetUrl(v)) v = await resolveAssetToDataUrl(v)
      if (isHttpUrl(v)) return v
      if (isDataUrl(v)) {
        const compressed = await compressImageBase64(v, 900 * 1024)
        return await uploadImageToYunwu(compressed)
      }
      if (isBase64Like(v)) {
        const dataUrl = `data:image/png;base64,${v}`
        const compressed = await compressImageBase64(dataUrl, 900 * 1024)
        return await uploadImageToYunwu(compressed)
      }
      throw new Error(`${label}需要公网可访问的图片 URL（http/https）或 dataURL/base64`)
    }

    const sizeValue = String(modelCfg.defaultParams?.size || '768P')
    const durValue = Number.isFinite(duration) && duration > 0 ? duration : Number(modelCfg.defaultParams?.duration || 10)

    const firstRaw = String(images[0] || '').trim()
    const tailRaw = String(lastFrame || '').trim()
    let firstUrl = firstRaw ? await ensureHttpImage(firstRaw, '首帧') : ''
    let lastUrl = tailRaw ? await ensureHttpImage(tailRaw, '尾帧') : ''

    // 根据是否有尾帧选择模型
    // - 用户选择 MiniMax-Hailuo-02：保持原选择（支持所有场景）
    // - 首尾帧视频必须用 MiniMax-Hailuo-02
    // - 仅首帧用户可选 MiniMax-Hailuo-2.3 或 MiniMax-Hailuo-2.3-Fast
    const userModel = String(modelCfg.key || '')
    const isUserHailuo02 = userModel === 'MiniMax-Hailuo-02'
    const isUserFastModel = userModel === 'MiniMax-Hailuo-2.3-Fast'
    const effectiveModel = isUserHailuo02
      ? 'MiniMax-Hailuo-02'
      : (lastUrl
        ? 'MiniMax-Hailuo-02'
        : (firstUrl ? (isUserFastModel ? 'MiniMax-Hailuo-2.3-Fast' : 'MiniMax-Hailuo-2.3') : 'MiniMax-Hailuo-02'))

    // 基础参数（纯文生视频）
    payload = {
      model: effectiveModel,
      prompt: prompt || '',
      duration: durValue,
    }
    // 图生视频 / 首尾帧视频：添加图片和额外参数
    if (firstUrl) {
      payload.first_frame_image = firstUrl
      payload.resolution = sizeValue
      const po = modelCfg.defaultParams?.prompt_optimizer
      if (typeof po === 'boolean') payload.prompt_optimizer = po
    }
    if (lastUrl) payload.last_frame_image = lastUrl
    console.log('[generateShortDramaVideo] minimax-hailuo-video payload:', JSON.stringify(payload, null, 2))
  } else if (modelCfg.format === 'runway-video') {
    // Runway：POST /runwayml/v1/image_to_video, GET /runwayml/v1/tasks/{id}
    const ensureHttpImage = async (raw: string, label: string) => {
      let v = String(raw || '').trim()
      if (!v) return ''
      if (isAssetUrl(v)) v = await resolveAssetToDataUrl(v)
      if (isHttpUrl(v)) return v
      if (isDataUrl(v)) {
        const compressed = await compressImageBase64(v, 900 * 1024)
        return await uploadImageToYunwu(compressed)
      }
      if (isBase64Like(v)) {
        const dataUrl = `data:image/png;base64,${v}`
        const compressed = await compressImageBase64(dataUrl, 900 * 1024)
        return await uploadImageToYunwu(compressed)
      }
      throw new Error(`${label}需要公网可访问的图片 URL（http/https）或 dataURL/base64`)
    }

    const firstRaw = String(images[0] || '').trim()
    if (!firstRaw) throw new Error('Runway image_to_video 需要首帧图片')
    const imageUrl = await ensureHttpImage(firstRaw, '首帧')

    const durValue = Number.isFinite(duration) && duration > 0 ? duration : Number(modelCfg.defaultParams?.duration || 10)
    const watermark = typeof modelCfg.defaultParams?.watermark === 'boolean' ? modelCfg.defaultParams.watermark : false

    const toPixelRatio = (r: string) => {
      const rr = String(r || '').trim()
      if (!rr) return '1280:720'
      if (/^\d+:\d+$/.test(rr) && rr.includes(':') && rr.split(':')[0].length > 2) return rr
      switch (rr) {
        case '16:9': return '1280:720'
        case '9:16': return '720:1280'
        case '1:1': return '1024:1024'
        case '4:3': return '1024:768'
        case '3:4': return '768:1024'
        default: return '1280:720'
      }
    }

    payload = {
      promptImage: imageUrl,
      model: modelCfg.key,
      promptText: prompt || '',
      watermark,
      duration: durValue,
      ratio: toPixelRatio(ratio),
    }
    console.log('[generateShortDramaVideo] runway-video payload:', JSON.stringify(payload, null, 2))
  } else if (modelCfg.format === 'luma-video') {
    // Luma 官方格式：POST /luma/generations, GET /luma/generations/{id}
    // 注意：Luma 不支持首帧/尾帧/参考图，仅支持文生视频
    const promptText = String(prompt || '').trim()
    if (!promptText) throw new Error('Luma 视频需要提示词')
    const modelName = String(modelCfg.defaultParams?.model_name || 'ray-v2')
    const durValue = Number.isFinite(duration) && duration > 0 ? duration : Number(modelCfg.defaultParams?.duration || 5)
    const durationStr = `${durValue}s`
    const resolution = String(modelCfg.defaultParams?.size || '720p')

    payload = {
      user_prompt: promptText,
      model_name: modelName,
      duration: durationStr,
      resolution,
    }
    console.log('[generateShortDramaVideo] luma-video payload:', JSON.stringify(payload, null, 2))
  } else if (modelCfg.format === 'tencent-aigc-video') {
    // 腾讯 AIGC 视频：POST /tencent-vod/v1/aigc-video
    // 查询：GET /tencent-vod/v1/query/{task_id}
    // 响应：Response.AigcImageTask.Output.FileInfos[].FileUrl
    const modelName = modelCfg.defaultParams?.model_name || 'Vidu'
    const modelVersion = modelCfg.defaultParams?.model_version || 'q3-pro'
    const durValue = Number.isFinite(duration) && duration > 0 ? duration : Number(modelCfg.defaultParams?.duration || 5)
    const aspectRatio = ratio || modelCfg.defaultParams?.ratio || '16:9'
    const resolution = modelCfg.defaultParams?.resolution || '1080P'
    const audioGen = modelCfg.defaultParams?.audio_generation || 'Enabled'
    const enhancePrompt = modelCfg.defaultParams?.enhance_prompt || 'Enabled'

    payload = {
      model_name: modelName,
      model_version: modelVersion,
      prompt: prompt || '',
      enhance_prompt: enhancePrompt,
      output_config: {
        storage_mode: 'Temporary',
        duration: durValue,
        resolution,
        aspect_ratio: aspectRatio,
        audio_generation: audioGen,
      },
    }

    // 参考图（file_infos，格式：{ Type: "Url", Url: "http://..." }）
    if (images.length > 0) {
      const fileInfos: any[] = []
      for (const raw of images.slice(0, Number(modelCfg.maxImages || 3))) {
        let imgUrl = String(raw || '').trim()
        if (!imgUrl) continue
        if (imgUrl.startsWith('blob:')) {
          try {
            const res = await fetch(imgUrl)
            const blob = await res.blob()
            imgUrl = await new Promise<string>((resolve, reject) => {
              const reader = new FileReader()
              reader.onerror = () => reject(new Error('read failed'))
              reader.onload = () => resolve(String(reader.result || ''))
              reader.readAsDataURL(blob)
            })
          } catch { continue }
        }
        if (isAssetUrl(imgUrl)) imgUrl = await resolveAssetToDataUrl(imgUrl)
        if (isDataUrl(imgUrl) || isBase64Like(imgUrl)) {
          const compressed = await compressImageBase64(imgUrl.startsWith('data:') ? imgUrl : `data:image/png;base64,${imgUrl}`, 900 * 1024)
          imgUrl = await uploadImageToYunwu(compressed)
        }
        if (isHttpUrl(imgUrl)) {
          fileInfos.push({ Type: 'Url', Url: imgUrl })
        }
      }
      if (fileInfos.length > 0) (payload as any).file_infos = fileInfos
    }

    // 尾帧（last_frame_url，Vidu q2-pro/q2-turbo/q3-pro 支持）
    if (lastFrame) {
      let tailUrl = String(lastFrame).trim()
      if (isAssetUrl(tailUrl)) tailUrl = await resolveAssetToDataUrl(tailUrl)
      if (isDataUrl(tailUrl) || isBase64Like(tailUrl)) {
        const compressed = await compressImageBase64(tailUrl.startsWith('data:') ? tailUrl : `data:image/png;base64,${tailUrl}`, 900 * 1024)
        tailUrl = await uploadImageToYunwu(compressed)
      }
      if (isHttpUrl(tailUrl)) (payload as any).last_frame_url = tailUrl
    }

    console.log('[generateShortDramaVideo] tencent-aigc-video payload:', JSON.stringify(payload, null, 2))
  } else {
    throw new Error(`工作台暂不支持该视频模型格式：${String(modelCfg.format || '')}`)
  }

  // Grok/Kling 在上游可能遇到"负载过大/饱和"，这里做温和的重试退避
  const isGrokModel = /^grok-video-/i.test(String(modelCfg.key || ''))
  const isKlingModel = /^kling/i.test(String(modelCfg.key || ''))
  const shouldRetryOnOverload = isTauri && (isGrokModel || isKlingModel)
  const maxCreateAttempts = shouldRetryOnOverload ? 4 : 1
  let task: any = null
  let lastCreateErr: any = null
  for (let attempt = 0; attempt < maxCreateAttempts; attempt++) {
    try {
      if (attempt > 0) {
        const waitMs = Math.min(15000, 2000 * Math.pow(2, Math.max(0, attempt - 1)))
        console.warn(`[shortDramaVideo] 上游过载/抖动，准备第 ${attempt + 1} 次重试...`, { waitMs, model: modelCfg.key })
        await new Promise((r) => setTimeout(r, waitMs))
      }
      if (useFormData) {
        task = await postFormData<any>(endpointOverride, payload as FormData, { authMode: modelCfg.authMode, timeoutMs: 240000 })
      } else {
        task = await postJson<any>(endpointOverride, payload, { authMode: modelCfg.authMode, timeoutMs: 240000 })
      }
      break
    } catch (e: any) {
      lastCreateErr = e
      const msg = String(e?.message || e || '')
      const isOverload =
        /负载.*饱和|负载过大|server busy|overload|Service Unavailable|HTTP 503|HTTP 500|Too Many Requests|rate limit|temporarily unavailable|try again later/i.test(msg)
      if (!shouldRetryOnOverload || !isOverload || attempt === maxCreateAttempts - 1) {
        throw e
      }
    }
  }
  if (!task) throw lastCreateErr || new Error('视频创建失败')

  // alibailian-wan-video（DashScope 风格）：task_id 位于 output.task_id
  if (modelCfg.format === 'alibailian-wan-video') {
    const taskId =
      task?.output?.task_id ||
      task?.output?.taskId ||
      task?.data?.output?.task_id ||
      task?.data?.output?.taskId ||
      task?.task_id ||
      task?.taskId
    if (taskId) {
      task.id = taskId
      task.task_id = taskId
    }
  }

  const id =
    task?.id ||
    task?.task_id ||
    task?.taskId ||
    task?.data?.id ||
    task?.data?.task_id ||
    task?.data?.taskId ||
    task?.Response?.TaskId ||
    task?.response?.task_id ||
    task?.output?.task_id ||
    task?.output?.taskId
  if (!id) throw new Error('视频返回异常：未获取到任务 ID')

  const polled = await pollVideoTask(String(id), modelCfg, statusEndpointOverride)
  const cached = await resolveCachedMediaUrl(String(polled || '').trim())
  if (!cached.displayUrl) throw new Error(cached.error || '视频缓存失败')

  return {
    taskId: String(id),
    videoUrl: String(polled || '').trim(),
    displayUrl: cached.displayUrl,
    localPath: cached.localPath || '',
  }
}

