import { useGraphStore } from '@/graph/store'
import type { GraphNode } from '@/graph/types'
import { DEFAULT_VIDEO_MODEL, VIDEO_MODELS } from '@/config/models'
import * as modelsConfig from '@/config/models'
import { getJson, postFormData, postJson } from '@/lib/workflow/request'
import { resolveCachedMediaUrl } from '@/lib/workflow/cache'
import { getMedia, getMediaByNodeId, saveMedia, isLargeData, isBase64Data } from '@/lib/mediaStorage'
import { requestQueue, type QueueTask } from '@/lib/workflow/requestQueue'
import { useSettingsStore } from '@/store/settings'
import { useAssetsStore } from '@/store/assets'
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
    console.warn('[video.safeFetch] tauriFetch failed, fallback:', String(err?.message || '').slice(0, 120))
    return await webFetch(input, init)
  }
}) as typeof fetch

// 视频生成参数覆盖接口
export interface VideoGenerationOverrides {
  model?: string
  ratio?: string
  duration?: number
  size?: string
}

export type GenerateVideoFromConfigNodeOptions = {
  /**
   * 指定输出视频节点 ID（用于 loopCount 并发批量生成，避免并发抢占同一输出节点）
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

type RunningTaskState = { cancelled: boolean; activeCount: number }

// 正在运行的视频任务 Map：configNodeId -> { cancelled, activeCount }
// 说明：loopCount 并发时，同一个 configNodeId 会有多个并发任务，因此需要引用计数，避免提前 delete 导致取消失效。
const runningTasks = new Map<string, RunningTaskState>()

// 全局取消标记 - 页面卸载时设为 true
let globalCancelled = false

// 取消指定节点的视频生成任务
export const cancelVideoTask = (nodeId: string) => {
  const task = runningTasks.get(nodeId)
  if (task) {
    task.cancelled = true
    console.log('[cancelVideoTask] 已标记取消任务:', nodeId)
  }
}

// 取消所有正在运行的视频任务
export const cancelAllVideoTasks = () => {
  globalCancelled = true
  runningTasks.forEach((task, nodeId) => {
    task.cancelled = true
    console.log('[cancelAllVideoTasks] 已标记取消任务:', nodeId)
  })
}

// 检查任务是否被取消
const isTaskCancelled = (nodeId: string) => {
  return globalCancelled || runningTasks.get(nodeId)?.cancelled === true
}

// 页面卸载时取消所有任务
if (typeof window !== 'undefined') {
  window.addEventListener('beforeunload', () => {
    console.log('[video] 页面卸载，取消所有任务')
    cancelAllVideoTasks()
  })
  window.addEventListener('unload', () => {
    cancelAllVideoTasks()
  })
}

const normalizeText = (text: unknown) => String(text || '').replace(/\r\n/g, '\n').trim()

const isHttpUrl = (v: string) => /^https?:\/\//i.test(v)
const isApiRelativeUrl = (v: string) => {
  const u = String(v || '').trim()
  if (!u) return false
  return u.startsWith('/v1/') || u.startsWith('/v1beta') || u.startsWith('/kling') || u.startsWith('/tencent-vod') || u.startsWith('/video')
}
const isPersistableSourceUrl = (v: string) => isHttpUrl(v) || isApiRelativeUrl(v)

/**
 * Build ordered video images:
 * - keep first/last even if duplicated
 * - dedupe refs (and avoid duplicating first/last)
 * - enforce maxImages
 */
const buildOrderedVideoImages = (args: {
  firstFrame: string
  lastFrame: string
  refImages: string[]
  maxImages: number
}) => {
  const max = Number.isFinite(args.maxImages) && args.maxImages > 0 ? Math.floor(args.maxImages) : 2
  const first = String(args.firstFrame || '').trim()
  const last = String(args.lastFrame || '').trim()
  const refs = Array.isArray(args.refImages) ? args.refImages : []

  const out: string[] = []
  if (first) out.push(first)
  if (out.length < max && last) out.push(last)

  const seen = new Set<string>()
  for (const v of out) {
    if (v) seen.add(v)
  }
  for (const r of refs) {
    if (out.length >= max) break
    const v = String(r || '').trim()
    if (!v) continue
    if (seen.has(v)) continue
    out.push(v)
    seen.add(v)
  }
  return out
}

// 检测 Tauri 环境
const isTauriEnv = typeof window !== 'undefined' && !!(window as any).__TAURI_INTERNALS__

const getApiKey = () => {
  try {
    return localStorage.getItem('apiKey') || ''
  } catch {
    return ''
  }
}

// 将 base64 图片上传到图床，获取公网 URL
// 腾讯 AIGC API 需要公网可访问的图片 URL
const uploadBase64ToImageHost = async (base64Data: string): Promise<string> => {
  // ⚠️ 仅允许使用云雾官方图床：
  // - 文档：https://yunwu.apifox.cn/doc-7376047
  // - API：https://yunwu.apifox.cn/api-356192326
  console.log('[uploadImage] 开始上传图片到云雾图床..., Tauri 环境:', isTauriEnv)

  const apiKey = getApiKey()
  if (!apiKey) {
    throw new Error('缺少 API Key，无法上传到云雾图床。请先在设置中填写 apiKey。')
  }

  // 将 base64 转换为 Blob
  const base64Content = base64Data.split(',')[1] || base64Data
  const mimeMatch = base64Data.match(/^data:([^;]+);/)
  const mimeType = mimeMatch ? mimeMatch[1] : 'image/png'
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

  // 使用统一的 postFormData（Tauri 下会自动转换成 multipart bytes）
  const resp = await postFormData<any>('https://imageproxy.zhongzhuan.chat/api/upload', form, { authMode: 'bearer', timeoutMs: 120000 })
  console.log('[uploadImage] 云雾图床响应:', JSON.stringify(resp, null, 2))
  const urlOut = String(resp?.url || resp?.data?.url || resp?.data?.link || '').trim()
  if (urlOut && /^https?:\/\//i.test(urlOut)) return urlOut
  throw new Error(String(resp?.error || resp?.message || resp?.data?.message || '云雾图床上传失败'))
}

// 图片压缩工具函数 - 将 base64 图片压缩到指定大小以下
const compressImageBase64 = async (base64Data: string, maxSizeBytes: number = 800 * 1024): Promise<string> => {
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
      let quality = 0.9
      let result = base64Data
      
      // 如果图片本身就很小，直接返回
      const currentSize = Math.ceil((base64Data.length - (base64Data.indexOf(',') + 1)) * 0.75)
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
        const size = Math.ceil((result.length - (result.indexOf(',') + 1)) * 0.75)
        if (size <= maxSizeBytes) {
          console.log(`[compressImage] 压缩成功: ${Math.round(currentSize/1024)}KB -> ${Math.round(size/1024)}KB, 质量=${q.toFixed(1)}, 尺寸=${width}x${height}`)
          resolve(result)
          return
        }
        quality = q
      }
      
      // 如果还是太大，进一步缩小尺寸
      width = Math.floor(width * 0.7)
      height = Math.floor(height * 0.7)
      canvas.width = width
      canvas.height = height
      ctx.drawImage(img, 0, 0, width, height)
      result = canvas.toDataURL('image/jpeg', 0.6)
      
      const finalSize = Math.ceil((result.length - (result.indexOf(',') + 1)) * 0.75)
      console.log(`[compressImage] 最终压缩: ${Math.round(currentSize/1024)}KB -> ${Math.round(finalSize/1024)}KB, 尺寸=${width}x${height}`)
      resolve(result)
    }
    img.onerror = () => reject(new Error('图片加载失败'))
    img.src = base64Data
  })
}

const pickFirstHttpUrlFromText = (text: string) => {
  const t = String(text || '').trim()
  if (!t) return ''
  const m = t.match(/https?:\/\/\S+/i)
  if (!m) return ''
  return String(m[0] || '').replace(/[)\]}>"'，。,.]+$/g, '').trim()
}

const normalizeMediaUrl = (raw: any) => {
  const v = typeof raw === 'string' ? raw.trim() : ''
  if (!v) return ''
  // 支持 data:, blob:, http(s):, 以及相对路径 /v1/...
  if (v.startsWith('data:') || v.startsWith('blob:') || isHttpUrl(v) || v.startsWith('/v1/')) return v
  const picked = pickFirstHttpUrlFromText(v)
  return picked || ''
}

const extractVideoUrlDeep = (payload: any) => {
  const seen = new Set<string>()
  const urls: string[] = []

  // 检查是否为图片 URL
  const isImageUrl = (url: string) => /\.(jpg|jpeg|png|gif|webp|bmp|svg)(\?|$)/i.test(url)
  // 检查是否为视频 URL
  const isVideoUrl = (url: string) => /\.(mp4|webm|mov|m4v|m3u8|avi|mkv)(\?|$)/i.test(url)

  const push = (val: any, isFromVideoKey = false) => {
    if (typeof val !== 'string') return
    if (!val.startsWith('http')) return
    if (seen.has(val)) return
    // 排除明显的图片 URL
    if (isImageUrl(val)) return
    seen.add(val)
    // 优先添加明确的视频 URL
    if (isVideoUrl(val)) {
      urls.unshift(val) // 添加到开头
    } else if (isFromVideoKey) {
      urls.push(val) // 来自视频相关字段的 URL
    }
  }

  const walk = (obj: any, depth = 0) => {
    if (!obj || depth > 6) return
    if (typeof obj === 'string') {
      if (isVideoUrl(obj)) push(obj, true)
      return
    }
    if (Array.isArray(obj)) {
      for (const it of obj) walk(it, depth + 1)
      return
    }
    if (typeof obj !== 'object') return

    // 检查 FileInfos 数组中的 FileType
    if (Array.isArray(obj.FileInfos) || Array.isArray(obj.file_infos)) {
      const fileInfos = obj.FileInfos || obj.file_infos || []
      for (const fi of fileInfos) {
        const fileType = String(fi?.FileType || fi?.file_type || '').toLowerCase()
        const fileUrl = fi?.FileUrl || fi?.file_url || fi?.Url || fi?.url
        // 只接受视频类型或无法确定类型但 URL 是视频格式的
        if (fileUrl && (fileType === 'video' || fileType.includes('video') || isVideoUrl(fileUrl))) {
          push(fileUrl, true)
        }
      }
    }

    for (const k of ['video_url', 'videoUrl', 'result_url', 'output_url']) {
      if (typeof obj[k] === 'string') push(obj[k], true)
    }
    // 不再盲目匹配 'url', 'FileUrl' 等通用字段，避免误取图片 URL
    for (const v of Object.values(obj)) walk(v, depth + 1)
  }

  walk(payload)
  return urls[0] || ''
}

const sanitizeErrorForNode = (raw: any) => {
  const msg = String(raw?.message || raw || '').trim()
  if (!msg) return '生成失败'
  if (/Failed to fetch|NetworkError|Network request failed/i.test(msg)) {
    return '网络请求失败（Failed to fetch）。请稍后重试，或检查网络/代理设置'
  }
  // 防止把 nginx/网关的整段 HTML 直接写进节点（会污染画布/存储）
  if (/<(html|!doctype|head|body|title)\b/i.test(msg)) {
    const m = msg.match(/<title[^>]*>([^<]+)<\/title>/i)
    const title = m ? String(m[1] || '').trim() : ''
    return title ? title : '网关错误（Bad Gateway）'
  }
  if (msg.length > 360) return `${msg.slice(0, 360)}…`
  return msg
}

const isDataUrl = (v: string) => typeof v === 'string' && v.startsWith('data:')
const isBase64Like = (v: string) =>
  typeof v === 'string' &&
  v.length > 1024 &&
  !v.startsWith('http') &&
  !v.startsWith('blob:') &&
  !v.startsWith('data:') &&
  !v.startsWith('asset://')

const isAssetUrl = (v: string) => typeof v === 'string' && (v.startsWith('asset://') || v.startsWith('http://asset.localhost/'))

const isPrivateNetUrl = (u: string) => {
  const v = String(u || '').trim()
  if (!v) return false
  return /^https?:\/\/(localhost|127\.|192\.168\.|10\.|172\.(1[6-9]|2[0-9]|3[01])\.)/i.test(v)
}

const blobToDataUrl = async (blob: Blob): Promise<string> => {
  return await new Promise<string>((resolve) => {
    const reader = new FileReader()
    reader.onerror = () => resolve('')
    reader.onload = () => resolve(String(reader.result || ''))
    reader.readAsDataURL(blob)
  })
}

const resolveUrlToDataUrl = async (url: string): Promise<string> => {
  const u = String(url || '').trim()
  if (!u) return ''
  if (u.startsWith('data:')) return u
  try {
    // blob:/asset:// 使用原生 fetch；http(s) 使用 safeFetch（Tauri Windows 必须用插件 fetch）
    const res: any =
      u.startsWith('blob:') || isAssetUrl(u)
        ? await globalThis.fetch(u, { method: 'GET' })
        : /^https?:\/\//i.test(u)
          ? await (safeFetch as any)(u, { method: 'GET' })
          : null
    if (!res?.ok) return ''
    const blob: Blob = await res.blob()
    // 避免把超大图片转成 dataURL（base64 会膨胀）
    if ((blob as any)?.size && Number(blob.size) > 12 * 1024 * 1024) return ''
    const dataUrl = await blobToDataUrl(blob)
    return dataUrl && dataUrl.startsWith('data:') ? dataUrl : ''
  } catch {
    return ''
  }
}

const resolveReadableImageFromNode = async (node: GraphNode | null): Promise<string> => {
  if (!node || node.type !== 'image') return ''
  const d: any = node.data || {}

  const b64 = typeof d.base64 === 'string' ? d.base64.trim() : ''
  if (b64 && (isDataUrl(b64) || isBase64Like(b64))) return b64

  const url = typeof d.url === 'string' ? d.url.trim() : ''
  if (url && (isDataUrl(url) || isBase64Like(url))) return url

  // 优先 mediaId（若存在），其次按 nodeId 查询（兼容旧数据）
  const mediaId = typeof d.mediaId === 'string' ? d.mediaId.trim() : d.mediaId != null ? String(d.mediaId).trim() : ''
  if (mediaId) {
    try {
      const rec = await getMedia(mediaId)
      const data = typeof rec?.data === 'string' ? rec.data.trim() : ''
      if (data) return data
    } catch {
      // ignore
    }
  }
  try {
    const rec2 = await getMediaByNodeId(node.id)
    const data2 = typeof rec2?.data === 'string' ? rec2.data.trim() : ''
    if (data2) return data2
  } catch {
    // ignore
  }

  // 最后兜底：若仅有本地可读 URL（asset:// / blob: / 内网 http），尝试转为 dataURL 供后续上传
  const displayUrl = typeof d.displayUrl === 'string' ? d.displayUrl.trim() : ''
  const candidates = [displayUrl, url].filter(Boolean)
  for (const c of candidates) {
    const v = String(c || '').trim()
    if (!v) continue
    const isLocalReadable = v.startsWith('blob:') || isAssetUrl(v) || (isHttpUrl(v) && isPrivateNetUrl(v))
    if (!isLocalReadable) continue
    const data3 = await resolveUrlToDataUrl(v)
    if (data3) return data3
  }

  return ''
}

const findPreferredOpenAiInputImageNode = (configId: string): GraphNode | null => {
  const s = useGraphStore.getState()
  const byId = new Map(s.nodes.map((n) => [n.id, n]))
  const edges = s.edges.filter((e) => e.target === configId)

  let anyImage: GraphNode | null = null
  let firstFrameNode: GraphNode | null = null
  let refNode: GraphNode | null = null

  for (const e of edges) {
    const n = byId.get(e.source)
    if (!n || n.type !== 'image') continue
    if (!anyImage) anyImage = n
    const roleRaw = String((e.data as any)?.imageRole || '').trim()
    if (!firstFrameNode && (roleRaw === '' || roleRaw === 'first_frame_image')) firstFrameNode = n
    if (!refNode && roleRaw === 'input_reference') refNode = n
  }

  return firstFrameNode || refNode || anyImage
}

/**
 * 将图片输入转换为 Blob（对齐 Vue 版本）
 * 支持：data URL、HTTP URL、blob URL、纯 base64 字符串
 */
const resolveImageToBlob = async (input: string): Promise<Blob | null> => {
  const v = String(input || '').trim()
  if (!v) {
    console.warn('[resolveImageToBlob] 输入为空')
    return null
  }
  
  // 1. data URL 格式
  if (v.startsWith('data:')) {
    const m = v.match(/^data:([^;]+);base64,(.*)$/)
    if (!m) {
      console.warn('[resolveImageToBlob] 无效的 data URL 格式')
      return null
    }
    const mime = m[1] || 'image/png'
    const b64 = m[2] || ''
    try {
      // 移除可能的空白字符
      const cleanB64 = b64.replace(/\s/g, '')
      const bin = Uint8Array.from(atob(cleanB64), (c) => c.charCodeAt(0))
      const blob = new Blob([bin], { type: mime })
      console.log('[resolveImageToBlob] 成功从 data URL 创建 Blob, size:', blob.size, 'type:', blob.type)
      return blob
    } catch (err) {
      console.error('[resolveImageToBlob] base64 解码失败:', err)
      return null
    }
  }
  
  // 2. HTTP/HTTPS URL（使用 safeFetch，Windows Tauri 必须用插件 fetch）
  if (/^https?:\/\//i.test(v)) {
    try {
      console.log('[resolveImageToBlob] 获取 HTTP 图片:', v.slice(0, 80), '...')
      const res = await safeFetch(v, { method: 'GET' })
      if (!res.ok) {
        console.warn('[resolveImageToBlob] HTTP 请求失败:', res.status)
        return null
      }
      const blob = await res.blob()
      console.log('[resolveImageToBlob] 成功从 HTTP URL 获取 Blob, size:', blob.size)
      return blob
    } catch (err) {
      console.error('[resolveImageToBlob] 无法获取 HTTP 图片:', err)
      return null
    }
  }
  
  // 3. blob: URL（blob URL 只能用原生 fetch，因为它是浏览器内部 URL）
  if (v.startsWith('blob:')) {
    try {
      const res = await globalThis.fetch(v)
      if (!res.ok) {
        console.warn('[resolveImageToBlob] blob URL 请求失败')
        return null
      }
      const blob = await res.blob()
      console.log('[resolveImageToBlob] 成功从 blob URL 获取 Blob, size:', blob.size)
      return blob
    } catch (err) {
      console.error('[resolveImageToBlob] 无法获取 blob URL:', err)
      return null
    }
  }

  // 3.5 asset:// URL（Tauri 本地缓存协议）
  if (isAssetUrl(v)) {
    try {
      const res = await globalThis.fetch(v, { method: 'GET' })
      if (!res.ok) {
        console.warn('[resolveImageToBlob] asset URL 请求失败')
        return null
      }
      const blob = await res.blob()
      console.log('[resolveImageToBlob] 成功从 asset URL 获取 Blob, size:', blob.size)
      return blob
    } catch (err) {
      console.error('[resolveImageToBlob] 无法获取 asset URL:', err)
      return null
    }
  }
  
  // 4. 纯 base64 字符串（兜底，与 Vue 版本对齐）
  if (v.length > 1024 && /^[A-Za-z0-9+/=\s]+$/.test(v)) {
    try {
      const cleanB64 = v.replace(/\s/g, '')
      const bin = Uint8Array.from(atob(cleanB64), (c) => c.charCodeAt(0))
      const blob = new Blob([bin], { type: 'image/png' })
      console.log('[resolveImageToBlob] 成功从纯 base64 创建 Blob, size:', blob.size)
      return blob
    } catch (err) {
      console.error('[resolveImageToBlob] 纯 base64 解码失败:', err)
      return null
    }
  }
  
  console.warn('[resolveImageToBlob] 无法识别的图片格式, 前100字符:', v.slice(0, 100))
  return null
}

/**
 * 确保图片是“公网可访问的 http(s) URL”。
 * - http(s) 且非内网：直接返回
 * - data/base64：压缩并上传到云雾图床
 * - blob:/asset:///内网 http：读取为 Blob → dataURL → 压缩上传
 */
const ensurePublicHttpImageUrl = async (raw: string, label: string): Promise<string> => {
  let v = String(raw || '').trim()
  if (!v) return ''

  // 1) 已是公网 URL
  if (isHttpUrl(v) && !isPrivateNetUrl(v)) return v

  // 2) data/base64 → 上传
  if (v.startsWith('data:') || isBase64Like(v)) {
    if (v.startsWith('data:')) v = await compressImageBase64(v, 900 * 1024)
    return await uploadBase64ToImageHost(v)
  }

  // 3) blob:/asset:///内网 http → 读取后上传
  if (v.startsWith('blob:') || isAssetUrl(v) || (isHttpUrl(v) && isPrivateNetUrl(v))) {
    const blob = await resolveImageToBlob(v)
    if (!blob) {
      throw new Error(`${label}图片读取失败（可能是本地缓存已失效/跨域受限）。建议：重新导入该图片或使用带 sourceUrl 的图片节点。`)
    }
    const dataUrl = await blobToDataUrl(blob)
    if (!dataUrl) throw new Error(`${label}图片读取失败（无法转换为 dataURL）`)
    const compressed = await compressImageBase64(dataUrl, 900 * 1024)
    return await uploadBase64ToImageHost(compressed)
  }

  // 4) 其他协议（如 file://）暂不支持自动转换
  if (isHttpUrl(v)) return v
  throw new Error(`${label}图片需要公网可访问的 http(s) URL（或可读取的 data/blob/asset 本地图片）。`)
}

/**
 * 将图片调整为指定尺寸（用于 Sora OpenAI 格式）
 * Sora API 要求图片尺寸必须与请求的 size 参数完全匹配
 * @param blob 原始图片 Blob
 * @param targetSize 目标尺寸，格式为 "WIDTHxHEIGHT"（如 "720x1280"）或 "small"/"large"
 * @returns 调整后的 Blob
 */
const resizeImageBlob = async (blob: Blob, targetSize: string): Promise<Blob> => {
  // 将 small/large 映射到对应的像素尺寸（默认竖版 9:16）
  let normalizedSize = targetSize
  if (targetSize === 'small') {
    normalizedSize = '720x1280'
  } else if (targetSize === 'large') {
    normalizedSize = '1080x1920'
  }

  // 解析目标尺寸
  const match = normalizedSize.match(/^(\d+)x(\d+)$/)
  if (!match) {
    console.warn('[resizeImageBlob] 无效的尺寸格式:', targetSize)
    return blob
  }
  const targetWidth = parseInt(match[1], 10)
  const targetHeight = parseInt(match[2], 10)
  
  return new Promise((resolve) => {
    const img = new Image()
    const url = URL.createObjectURL(blob)
    
    img.onload = () => {
      URL.revokeObjectURL(url)
      
      // 创建 canvas 并绘制调整后的图片
      const canvas = document.createElement('canvas')
      canvas.width = targetWidth
      canvas.height = targetHeight
      const ctx = canvas.getContext('2d')
      
      if (!ctx) {
        console.warn('[resizeImageBlob] 无法获取 canvas context')
        resolve(blob)
        return
      }
      
      // 计算裁剪/填充参数以保持宽高比并居中
      const srcRatio = img.width / img.height
      const dstRatio = targetWidth / targetHeight
      
      let sx = 0, sy = 0, sw = img.width, sh = img.height
      
      if (srcRatio > dstRatio) {
        // 源图更宽，裁剪两侧
        sw = img.height * dstRatio
        sx = (img.width - sw) / 2
      } else if (srcRatio < dstRatio) {
        // 源图更高，裁剪上下
        sh = img.width / dstRatio
        sy = (img.height - sh) / 2
      }
      
      // 使用高质量缩放
      ctx.imageSmoothingEnabled = true
      ctx.imageSmoothingQuality = 'high'
      ctx.drawImage(img, sx, sy, sw, sh, 0, 0, targetWidth, targetHeight)
      
      canvas.toBlob((resizedBlob) => {
        if (resizedBlob) {
          console.log('[resizeImageBlob] 图片已调整尺寸:', img.width, 'x', img.height, '->', targetWidth, 'x', targetHeight)
          resolve(resizedBlob)
        } else {
          console.warn('[resizeImageBlob] canvas.toBlob 失败')
          resolve(blob)
        }
      }, 'image/png', 0.95)
    }
    
    img.onerror = () => {
      URL.revokeObjectURL(url)
      console.warn('[resizeImageBlob] 图片加载失败')
      resolve(blob)
    }
    
    img.src = url
  })
}

/**
 * 获取连接到视频配置节点的输入
 * 与 Vue 版本对齐
 */
const getConnectedInputs = async (configId: string) => {
  const s = useGraphStore.getState()
  const byId = new Map(s.nodes.map((n) => [n.id, n]))
  const connectedEdges = s.edges.filter((e) => e.target === configId)

  const promptParts: string[] = []
  const firstFrame: string[] = []
  const lastFrame: string[] = []
  const refImages: string[] = []
  const refVideos: string[] = []

  for (const edge of connectedEdges) {
    const sourceNode = byId.get(edge.source)
    if (!sourceNode) continue

    if (sourceNode.type === 'text') {
      const text = normalizeText((sourceNode.data as any)?.content || '')
      if (text) promptParts.push(text)
    } else if (sourceNode.type === 'image') {
      // 与 Vue 版本对齐：优先使用 base64/DataURL。
      // 但要避免把本地缓存链接（asset:// / 127.0.0.1）直接传给上游 —— 上游无法访问。
      const nodeData = sourceNode.data as any
      const asStr = (x: any) => (typeof x === 'string' ? x.trim() : '')
      const url = asStr(nodeData?.url)
      const sourceUrl = asStr(nodeData?.sourceUrl)
      const base64 = asStr(nodeData?.base64)
      const isPublicHttp = (u: string) => isHttpUrl(u) && !isPrivateNetUrl(u)
      
      let imageData = ''
      let dataSource = ''
      
      // 1. 优先使用 base64 字段（与 Vue 版本对齐）
      if (base64 && (isDataUrl(base64) || isBase64Like(base64))) {
        imageData = base64
        dataSource = 'base64 字段'
      // 2. url 如果是 DataURL
      } else if (url && isDataUrl(url)) {
        imageData = url
        dataSource = 'url(DataURL)'
      // 3. url 如果是公网 HTTP URL（排除内网/本地）
      } else if (url && isPublicHttp(url)) {
        imageData = url
        dataSource = 'url(HTTP-public)'
      // 4. sourceUrl（原始公网 HTTPS URL，优先于本地缓存 URL）
      } else if (sourceUrl && isPublicHttp(sourceUrl)) {
        imageData = sourceUrl
        dataSource = 'sourceUrl(HTTP-public)'
      // 5. 纯 base64 字段（无前缀）
      } else if (base64 && base64.length > 100) {
        imageData = base64
        dataSource = 'base64(raw)'
      }

      // 6. 尝试从 IndexedDB（mediaId / nodeId）或本地可读 URL 取回 dataURL（适配“导入图片/缓存后只剩 asset://”的情况）
      if (!imageData) {
        try {
          const localReadable = await resolveReadableImageFromNode(sourceNode)
          if (localReadable) {
            imageData = localReadable
            dataSource = 'mediaId/IndexedDB/本地缓存'
          }
        } catch {
          // ignore
        }
      }

      // 7. 最后兜底：保留任意 URL（可能是 asset:// / 内网 http），后续按模型需求再转公网
      if (!imageData) {
        const fallback = sourceUrl || url
        if (fallback) {
          imageData = fallback
          dataSource = 'url(fallback)'
        }
      }
      
      if (!imageData) {
        console.warn('[getConnectedInputs] 图片节点没有可用的图片数据，跳过:', sourceNode.id, 
          '可用字段:', { hasUrl: !!nodeData?.url, hasBase64: !!nodeData?.base64, hasSourceUrl: !!nodeData?.sourceUrl })
        continue
      }
      
      console.log('[getConnectedInputs] 图片数据来源:', dataSource, '长度:', imageData.length,
        '前缀:', imageData.slice(0, 30))

      const roleRaw = String((edge.data as any)?.imageRole || '').trim()
      if (roleRaw === 'last_frame_image') {
        lastFrame.push(imageData)
      } else if (roleRaw === 'input_reference') {
        refImages.push(imageData)
      } else {
        // 默认是首帧
        firstFrame.push(imageData)
      }
    } else if (sourceNode.type === 'video') {
      const nodeData = sourceNode.data as any
      const pick = (...cands: any[]) => {
        for (const c of cands) {
          const v = String(c || '').trim()
          if (!v) continue
          return v
        }
        return ''
      }
      // 优先使用 sourceUrl（通常是公网 URL），其次 url（可能是 asset:// 或 data:）
      const v = pick(nodeData?.sourceUrl, nodeData?.url)
      if (v) refVideos.push(v)
    }
  }

  const result = {
    prompt: promptParts.join('\n\n'),
    firstFrame: firstFrame[0] || '',
    lastFrame: lastFrame[0] || '',
    refImages: Array.from(new Set(refImages)),
    refVideos: Array.from(new Set(refVideos))
  }
  console.log('[getConnectedInputs] 汇总结果:', {
    promptLen: result.prompt?.length || 0,
    firstFrameLen: result.firstFrame?.length || 0,
    lastFrameLen: result.lastFrame?.length || 0,
    refImagesCount: result.refImages?.length || 0,
    refVideosCount: result.refVideos?.length || 0
  })
  return result
}

/**
 * 查找已连接的空白输出视频节点（可复用）
 */
const findConnectedOutputVideoNode = (configId: string) => {
  const s = useGraphStore.getState()
  const byId = new Map(s.nodes.map((n) => [n.id, n]))
  const outputEdges = s.edges.filter((e) => e.source === configId)

  for (const edge of outputEdges) {
    const targetNode = byId.get(edge.target)
    if (
      targetNode?.type === 'video' &&
      !(targetNode.data as any)?.loading &&
      (!(targetNode.data as any)?.url || (targetNode.data as any)?.url === '')
    ) {
      return targetNode.id
    }
  }
  return null
}

const pollVideoTask = async (id: string, modelCfg: any, nodeId?: string, videoNodeId?: string) => {
  const maxAttempts = 300  // 增加到 300 次（15 分钟）
  // 轮询间隔：极速模式更快拿到完成态；稳定模式更保守减少 429/过载
  const perfMode = useSettingsStore.getState().performanceMode || 'off'
  const interval = perfMode === 'ultra' ? 2000 : perfMode === 'normal' ? 3000 : 3500
  const maxConsecutiveErrors = 10 // 连续错误次数限制
  
  console.log('[pollVideoTask] 开始轮询, 任务 ID:', id, 'nodeId:', nodeId, '最大尝试:', maxAttempts)
  let lastErr: any = null
  let consecutiveErrors = 0
  let lastSuccessStatus = ''
  let completedWithoutUrlCount = 0

  const isTransientPollError = (err: any) => {
    const msg = String(err?.message || err || '')
    if (!msg) return true
    // 网络错误
    if (/Failed to fetch|NetworkError|Network request failed/i.test(msg)) return true
    // JSON 解析错误
    if (/响应解析失败（JSON）|Unexpected end of JSON|Unexpected token|did not match|expected pattern/i.test(msg)) return true
    // Tauri HTTP 插件特有错误
    if (/error sending request|request error|sending request|connect error|connection/i.test(msg)) return true
    // HTTP 状态码
    const m = msg.match(/HTTP\s+(\d{3})/i)
    if (m) {
      const code = Number(m[1])
      return code === 404 || code === 408 || code === 429 || code === 500 || code === 502 || code === 503 || code === 504
    }
    if (/Bad Gateway|Gateway Timeout|Service Unavailable/i.test(msg)) return true
    return false
  }

  for (let i = 0; i < maxAttempts; i++) {
    // 检查任务是否被取消
    if (nodeId && isTaskCancelled(nodeId)) {
      console.log('[pollVideoTask] 任务已被取消:', nodeId)
      throw new Error('任务已取消')
    }
    
    // 检查节点是否还存在（用户可能已删除配置节点或视频节点）
    if (nodeId || videoNodeId) {
      const store = useGraphStore.getState()
      const configExists = !nodeId || store.nodes.some(n => n.id === nodeId)
      const videoExists = !videoNodeId || store.nodes.some(n => n.id === videoNodeId)
      if (!configExists || !videoExists) {
        console.log('[pollVideoTask] 节点已被删除，停止轮询:', { nodeId, videoNodeId, configExists, videoExists })
        throw new Error('节点已删除，任务已取消')
      }
    }
    const statusEndpoint = modelCfg.statusEndpoint
    if (!statusEndpoint) throw new Error('未配置视频查询端点')

    let resp: any
    try {
      if (typeof statusEndpoint === 'function') {
        resp = await getJson<any>(statusEndpoint(id), undefined, { authMode: modelCfg.authMode })
      } else {
        resp = await getJson<any>(statusEndpoint, { id }, { authMode: modelCfg.authMode })
      }
      // 请求成功，重置连续错误计数
      consecutiveErrors = 0
    } catch (err: any) {
      lastErr = err
      consecutiveErrors++
      const elapsed = Math.round((i + 1) * interval / 1000)
      const msg = String(err?.message || err || '')
      const transient = isTransientPollError(err)
      console.warn(`[pollVideoTask] 轮询 ${i + 1}/${maxAttempts} (${elapsed}s): 查询失败 [连续错误: ${consecutiveErrors}]`, { transient, message: msg.slice(0, 160) })
      
      // 如果是非临时错误，立即抛出
      if (!transient) throw err
      
      // 如果连续错误太多，可能是后端严重问题
      if (consecutiveErrors >= maxConsecutiveErrors) {
        console.error(`[pollVideoTask] 连续 ${consecutiveErrors} 次请求失败，停止轮询`)
        throw new Error(`视频状态查询持续失败（${consecutiveErrors} 次）。后端服务可能不可用，请稍后重试。`)
      }
      
      // 使用指数退避，但不超过 10 秒
      const backoff = Math.min(interval * Math.pow(1.5, Math.min(consecutiveErrors - 1, 3)), 10000)
      await new Promise((r) => setTimeout(r, backoff))
      continue
    }
    
    // 支持多种响应格式的状态解析 (PascalCase 和 snake_case)
    const response = resp?.Response || resp?.response || resp
    // 腾讯 AIGC 格式: Response.AigcVideoTask 或 Response.AigcImageTask
    const aigcTask = response?.AigcVideoTask || response?.AigcImageTask || response?.aigc_video_task || response?.aigc_image_task
    // 注意：output 必须优先从 aigcTask.Output 获取，不能跳过 aigcTask
    const aigcOutput = aigcTask?.Output || aigcTask?.output
    const output = aigcOutput || response?.Output || response?.output || resp?.output || resp?.data?.output || resp?.data || resp
    
    // 状态优先从 Response.Status 或 AigcTask.Status 获取
    // OpenAI Sora 格式可能使用 state 字段
    const status = String(
      response?.Status || response?.status || response?.state ||
      aigcTask?.Status || aigcTask?.status ||
      output?.TaskStatus || output?.task_status || output?.status || output?.state ||
      resp?.status || resp?.state || resp?.data?.status || resp?.data?.state || ''
    ).toLowerCase()
    const elapsed = Math.round((i + 1) * interval / 1000)
    lastSuccessStatus = status
    
    // 尝试从多个位置获取视频 URL (腾讯 AIGC 格式: AigcTask.Output.FileInfos[0].FileUrl)
    const fileInfos = aigcOutput?.FileInfos || aigcOutput?.file_infos || output?.FileInfos || output?.file_infos || []
    
    // 从 FileInfos 中筛选视频文件（排除图片）
    const isImageUrl = (url: string) => /\.(jpg|jpeg|png|gif|webp|bmp|svg)(\?|$)/i.test(url)
    const isVideoUrl = (url: string) => /\.(mp4|webm|mov|m4v|m3u8|avi|mkv)(\?|$)/i.test(url)
    
    let videoUrlFromFileInfos = ''
    for (const fi of fileInfos) {
      const fileType = String(fi?.FileType || fi?.file_type || '').toLowerCase()
      const fileUrl = fi?.FileUrl || fi?.file_url || fi?.Url || fi?.url || ''
      // 优先选择类型为 video 的文件，或者 URL 是视频格式的文件
      if (fileUrl && (fileType === 'video' || fileType.includes('video') || isVideoUrl(fileUrl))) {
        videoUrlFromFileInfos = fileUrl
        break
      }
      // 如果没有明确的视频类型，选择第一个非图片的文件
      if (fileUrl && !isImageUrl(fileUrl) && !videoUrlFromFileInfos) {
        videoUrlFromFileInfos = fileUrl
      }
    }
    
    // OpenAI Sora 格式支持：output.video, downloads[0].url 等
    const outputVideoRaw = output?.video || resp?.output?.video || resp?.data?.output?.video
    const downloads = resp?.downloads || resp?.data?.downloads || output?.downloads

    const pickUrl = (v: any) => {
      if (!v) return ''
      if (typeof v === 'string') return v
      if (typeof v === 'object') {
        const cand =
          (v as any)?.url ||
          (v as any)?.video_url ||
          (v as any)?.videoUrl ||
          (v as any)?.download_url ||
          (v as any)?.downloadUrl ||
          (v as any)?.result_url ||
          (v as any)?.resultUrl
        return typeof cand === 'string' ? cand : ''
      }
      return ''
    }

    const outputVideo = pickUrl(outputVideoRaw)
    const downloadUrlRaw = Array.isArray(downloads) && downloads.length > 0 ? (downloads[0]?.url || downloads[0]?.video_url || downloads[0]) : null
    const downloadUrl = pickUrl(downloadUrlRaw)
    
    const videoUrl = videoUrlFromFileInfos || outputVideo || downloadUrl ||
                     aigcOutput?.VideoUrl || aigcOutput?.video_url ||
                     output?.VideoUrl || output?.video_url || output?.ResultUrl || output?.result_url || 
                     response?.VideoUrl || response?.video_url ||
                     resp?.VideoUrl || resp?.video_url || resp?.result_url || resp?.data?.video_url
    
    console.log(`[pollVideoTask] 轮询 ${i + 1}/${maxAttempts} (${elapsed}s):`, {
      status,
      hasVideoUrl: !!videoUrl,
      videoUrlPreview: videoUrl?.slice?.(0, 80),
      outputVideo: outputVideo?.slice?.(0, 80),
      downloadUrl: typeof downloadUrl === 'string' ? downloadUrl?.slice?.(0, 80) : null
    })

    // 如果直接有视频 URL，返回
    if (typeof videoUrl === 'string' && /^https?:\/\//i.test(videoUrl)) {
      console.log('[pollVideoTask] 获取到视频 URL:', videoUrl.slice(0, 80))
      return videoUrl
    }

    const direct = extractVideoUrlDeep(resp)
    if (direct) {
      console.log('[pollVideoTask] 深度解析获取到视频 URL:', direct?.slice(0, 80))
      return direct
    }

    // 如果状态是 finish/completed/success 但没有视频 URL
    // 也支持 ready 状态（某些 API 使用 ready 表示完成）
    const isCompleted = /^(finish|finished|completed|complete|success|done|ready|succeeded)$/i.test(status)
    
    if (isCompleted && !videoUrl) {
      completedWithoutUrlCount++
      // 对于 sora-openai 格式，视频 URL 就是 /videos/{id}/content 端点
      // 使用相对路径，让请求通过 Vite 代理（避免 CORS 问题）
      if (modelCfg.format === 'sora-openai') {
        const contentUrl = `/v1/videos/${id}/content`
        console.log('[pollVideoTask] Sora OpenAI 格式：构造视频下载 URL:', contentUrl)
        return contentUrl
      }
      
      // 检查 AigcTask 中的错误码和消息
      const errCode = aigcTask?.ErrCode || aigcTask?.err_code || aigcTask?.error_code
      const errMsg = aigcTask?.Message || aigcTask?.message || aigcTask?.error_message || aigcTask?.error
      
      console.warn('[pollVideoTask] 状态已完成但未找到视频 URL，详细结构:', {
        'ErrCode': errCode,
        'Message': errMsg,
        'Progress': aigcTask?.Progress,
        'FileInfos': fileInfos,
        'AigcOutput keys': Object.keys(aigcOutput || {}),
        'fullResp': JSON.stringify(resp)?.slice(0, 2000)
      })
      
      // 只在明确有错误信息时判定失败；避免误把“暂未补齐 URL”当失败
      if (errCode || errMsg) {
        const errorDetail = String(errMsg || errCode || '视频生成失败')
        console.error('[pollVideoTask] 视频生成失败:', errorDetail)
        throw new Error(errorDetail)
      }

      // 其他格式：允许短暂延迟（上游可能异步补齐下载 URL），但不要无限等到超时
      if (completedWithoutUrlCount >= 3) {
        throw new Error('视频生成已完成，但未返回可用的视频 URL')
      }
    } else {
      completedWithoutUrlCount = 0
    }

    // 检查失败状态 (支持多种格式: failed, FAILED, fail, error, FAIL)
    if (/^(failed|fail|error)$/i.test(status)) {
      const response0 = resp?.Response || resp?.response || resp
      const errorCandidates: Array<unknown> = [
        resp?.error?.message,
        resp?.error?.msg,
        resp?.error_message,
        resp?.errorMessage,
        resp?.message,
        resp?.msg,
        // grok unified format often uses `error` as string
        typeof resp?.error === 'string' ? resp.error : '',
        typeof resp?.data?.error === 'string' ? resp.data.error : '',
        resp?.data?.error?.message,
        resp?.data?.message,
        response0?.message,
        response0?.msg,
        typeof response0?.error === 'string' ? response0.error : '',
        response0?.error?.message,
        aigcTask?.Message,
        aigcTask?.message,
        aigcTask?.error_message,
        aigcTask?.error,
      ]
      const rawErr =
        errorCandidates
          .map((x) => (typeof x === 'string' ? x.trim() : ''))
          .find((s) => s) || '视频生成失败'

      const traceId =
        (resp?.trace_id || resp?.traceId || resp?.TraceId || response0?.trace_id || response0?.traceId || response0?.TraceId) ?? ''
      const debug = {
        model: String(modelCfg?.key || ''),
        format: String(modelCfg?.format || ''),
        id,
        status,
        traceId: traceId ? String(traceId) : '',
        respKeys: Object.keys(resp || {}),
      }
      console.error('[pollVideoTask] 视频生成失败:', rawErr, debug)
      try {
        const snippet = JSON.stringify(resp)?.slice(0, 2000)
        if (snippet) console.warn('[pollVideoTask] failed 响应片段:', snippet)
      } catch {
        // ignore
      }
      
      // 友好化常见错误消息
      let friendlyMsg = rawErr
      if (/AUDIO_FILTERED|audio.*filter/i.test(rawErr)) {
        friendlyMsg = '视频生成失败：音频内容被审核过滤，请修改提示词后重试'
      } else if (/CONTENT_FILTERED|content.*filter/i.test(rawErr)) {
        friendlyMsg = '视频生成失败：内容被审核过滤，请修改提示词后重试'
      } else if (/NSFW|sensitive|违规/i.test(rawErr)) {
        friendlyMsg = '视频生成失败：内容不符合平台规定，请修改提示词'
      } else if (/timeout|超时/i.test(rawErr)) {
        friendlyMsg = '视频生成超时，请稍后重试'
      } else if (/quota|limit|配额/i.test(rawErr)) {
        friendlyMsg = '视频生成失败：API 配额不足，请检查账户余额'
      }
      
      const extra = traceId ? `（trace_id: ${String(traceId)}）` : ''
      throw new Error(`${friendlyMsg}${extra}`)
    }

    await new Promise((r) => setTimeout(r, interval))
  }

  // 超时处理 - 提供更详细的信息
  const timeoutInfo = lastSuccessStatus 
    ? `最后状态: ${lastSuccessStatus}` 
    : (lastErr ? `最后错误: ${sanitizeErrorForNode(lastErr)}` : '')
  throw new Error(`视频生成超时（${Math.round(maxAttempts * interval / 60000)} 分钟）。${timeoutInfo}。请检查后端服务状态或稍后重试。`)
}

export const generateVideoFromConfigNode = async (
  configNodeId: string,
  overrides?: VideoGenerationOverrides,
  options?: GenerateVideoFromConfigNodeOptions
) => {
  console.log('[generateVideo] 开始生成视频, configNodeId:', configNodeId, 'overrides:', overrides)
  
  const selectOutput = options?.selectOutput !== false
  const markConfigExecuted = options?.markConfigExecuted !== false
  const forcedOutputId = String(options?.outputNodeId || '').trim()
  
  // 注册任务，以便可以被取消（支持同一 configNodeId 并发）
  const existingTask = runningTasks.get(configNodeId)
  if (existingTask) {
    existingTask.activeCount = (existingTask.activeCount || 0) + 1
  } else {
    runningTasks.set(configNodeId, { cancelled: false, activeCount: 1 })
  }
  
  const store = useGraphStore.getState()
  const cfg = store.nodes.find((n) => n.id === configNodeId)
  if (!cfg || cfg.type !== 'videoConfig') throw new Error('请选择一个"视频配置"节点')

  const d: any = cfg.data || {}
  console.log('[generateVideo] 节点数据:', d)

  // 1. 获取连接的输入
  let { prompt, firstFrame, lastFrame, refImages, refVideos } = await getConnectedInputs(configNodeId)
  console.log('[generateVideo] 连接输入:', {
    promptLength: prompt?.length || 0,
    hasFirstFrame: !!firstFrame,
    hasLastFrame: !!lastFrame,
    refImagesCount: refImages.length,
    refVideosCount: (refVideos || []).length,
    // 显示图片 URL 前缀以确认是 HTTP 还是 base64
    firstFrameType: firstFrame ? (firstFrame.startsWith('http') ? 'HTTP URL' : 'base64/other') : 'none',
    refImagesTypes: refImages.map(img => img.startsWith('http') ? 'HTTP URL' : 'base64/other'),
    refVideosTypes: (refVideos || []).map(v => v.startsWith('http') ? 'HTTP URL' : (v.startsWith('asset://') ? 'asset://' : 'other'))
  })

  if (!prompt && !firstFrame && !lastFrame && refImages.length === 0 && (refVideos || []).length === 0) {
    throw new Error('请连接文本节点（提示词）或图片节点（首帧/尾帧/参考图）')
  }

  // 优先使用 overrides 参数，解决 UI 选择与实际调用不一致的问题
  const modelKey = String(overrides?.model || d.model || DEFAULT_VIDEO_MODEL)
  // 兼容旧 key（MODEL_ALIASES），避免保存过的项目在升级后找不到模型
  const resolved: any = (modelsConfig as any)?.getModelByName?.(modelKey) || null
  const modelCfg: any =
    (resolved && String(resolved?.format || '').includes('video') ? resolved : null) ||
    (VIDEO_MODELS as any[]).find((m) => m.key === modelKey) ||
    (VIDEO_MODELS as any[])[0]
  console.log('[generateVideo] 模型配置:', { modelKey, resolvedKey: String(modelCfg?.key || ''), modelCfg, fromOverrides: !!overrides?.model })
  if (!modelCfg) throw new Error('未找到模型配置')

  // === 运行时输入能力校验（基于 models.js 的能力字段）===
  // 说明：部分模型不区分“首帧/参考图”语义（只接收 images[]），这里做兼容性折叠：
  // - 若模型不支持首/尾帧但支持参考图：把首/尾帧输入视为参考图
  // - 若模型支持首帧但不支持参考图：允许将第一张参考图折叠为首帧（兼容旧工程/错误角色选择）
  const supportsFirstFrame = !!(modelCfg as any)?.supportsFirstFrame
  const supportsLastFrame = !!(modelCfg as any)?.supportsLastFrame
  const supportsRef = !!(modelCfg as any)?.supportsReferenceImages
  const supportsRefVideo = !!(modelCfg as any)?.supportsReferenceVideo
  const requiresPrompt = !!(modelCfg as any)?.requiresPrompt
  const requiresFirstFrameIfLastFrame = !!(modelCfg as any)?.requiresFirstFrameIfLastFrame
  const maxImages = Number.isFinite(Number((modelCfg as any)?.maxImages)) ? Number((modelCfg as any).maxImages) : 2
  const maxRefImages = supportsRef
    ? (Number.isFinite(Number((modelCfg as any)?.maxRefImages)) ? Number((modelCfg as any).maxRefImages) : maxImages)
    : 0
  const maxRefVideos = supportsRefVideo ? (Number.isFinite(Number((modelCfg as any)?.maxRefVideos)) ? Number((modelCfg as any).maxRefVideos) : 1) : 0

  // Fold roles to match model capability
  if (supportsRef && !supportsFirstFrame && firstFrame) {
    refImages = [firstFrame, ...(refImages || [])]
    firstFrame = ''
  }
  if (supportsRef && !supportsLastFrame && lastFrame) {
    refImages = [...(refImages || []), lastFrame]
    lastFrame = ''
  }
  if (!supportsRef && supportsFirstFrame && !firstFrame && Array.isArray(refImages) && refImages.length > 0) {
    firstFrame = refImages[0]
    refImages = refImages.slice(1)
  }

  const totalImages = (firstFrame ? 1 : 0) + (lastFrame ? 1 : 0) + (refImages?.length || 0)
  if (requiresPrompt && !normalizeText(prompt)) {
    throw new Error('当前模型需要提示词：请连接文本节点（提示词）后重试')
  }
  if (!supportsFirstFrame && firstFrame) {
    throw new Error('当前模型不支持首帧输入（请移除首帧连接或更换模型）')
  }
  if (!supportsLastFrame && lastFrame) {
    throw new Error('当前模型不支持尾帧输入（请移除尾帧连接或更换模型）')
  }
  if (!supportsRef && (refImages?.length || 0) > 0) {
    throw new Error('当前模型不支持参考图输入（请移除参考图连接或更换模型）')
  }
  if (!supportsRefVideo && (refVideos?.length || 0) > 0) {
    throw new Error('当前模型不支持参考视频输入（请移除视频连接或更换模型）')
  }
  if (supportsRef && maxRefImages > 0 && (refImages?.length || 0) > maxRefImages) {
    throw new Error(`当前模型参考图最多支持 ${maxRefImages} 张`)
  }
  if (supportsRefVideo && maxRefVideos > 0 && (refVideos?.length || 0) > maxRefVideos) {
    throw new Error(`当前模型参考视频最多支持 ${maxRefVideos} 个`)
  }
  if (Number.isFinite(maxImages) && maxImages > 0 && totalImages > maxImages) {
    throw new Error(`当前模型最多支持 ${maxImages} 张图片输入（含首/尾帧与参考图）`)
  }
  if (requiresFirstFrameIfLastFrame && lastFrame && !firstFrame) {
    throw new Error('当前模型不支持仅尾帧：有尾帧时必须同时提供首帧')
  }

  // 优先使用 overrides 参数
  const ratio = String(overrides?.ratio || d.ratio || modelCfg.defaultParams?.ratio || modelCfg.defaultParams?.aspect_ratio || '')
  
  // 详细的 duration 来源追踪
  const durationSources = {
    'overrides.duration': overrides?.duration,
    'd.duration': d.duration,
    'd.dur': d.dur,
    'defaultParams.duration': modelCfg.defaultParams?.duration
  }
  const duration = Number(overrides?.duration ?? d.duration ?? d.dur ?? modelCfg.defaultParams?.duration ?? 0)
  console.log('[generateVideo] Duration 来源追踪:', durationSources, '最终 duration:', duration)
  const images = buildOrderedVideoImages({
    firstFrame,
    lastFrame,
    refImages,
    maxImages: Number(modelCfg.maxImages || 2),
  })

  // 2. 先创建/复用视频节点（显示 loading 状态）
  let videoNodeId = forcedOutputId || findConnectedOutputVideoNode(configNodeId)
  const nodeX = cfg.x
  const nodeY = cfg.y
  
  let forceOutput = false
  if (forcedOutputId) {
    const forcedNode = store.nodes.find((n) => n.id === forcedOutputId)
    if (forcedNode?.type === 'video') {
      forceOutput = true
      // 强制使用指定输出节点
      store.updateNode(forcedOutputId, { data: { loading: true, error: '' } } as any)
    } else {
      console.warn('[generateVideo] 指定 outputNodeId 无效，回退到默认创建/复用:', forcedOutputId, forcedNode?.type)
      videoNodeId = findConnectedOutputVideoNode(configNodeId)
    }
  }

  if (!forceOutput) {
    // 获取重新生成模式设置
    const regenerateMode = useSettingsStore.getState().regenerateMode || 'create'
    
    // 记录旧的视频数据（用于保存到历史记录）
    let oldVideoData: any = null

    if (videoNodeId) {
      const existingNode = store.nodes.find(n => n.id === videoNodeId)
      if (existingNode?.data?.url) {
        oldVideoData = { ...existingNode.data }
      }
      
      if (regenerateMode === 'replace') {
        // 替代模式：直接更新现有节点
        store.updateNode(videoNodeId, { data: { loading: true, error: '' } } as any)
      } else {
        // 新建模式：如果已有节点有内容，创建新节点
        if (oldVideoData?.url) {
          // 将旧数据保存到历史记录
          if (oldVideoData.url) {
            useAssetsStore.getState().addAsset({
              type: 'video',
              src: oldVideoData.url,
              title: oldVideoData.label || '视频历史',
              model: modelKey,
              duration: oldVideoData.duration
            })
          }
          // 创建新节点
          videoNodeId = store.addNode('video', { x: nodeX + 460, y: nodeY + 50 }, {
            url: '',
            loading: true,
            label: '视频生成结果'
          })
          store.addEdge(configNodeId, videoNodeId, {
            sourceHandle: 'right',
            targetHandle: 'left'
          })
        } else {
          // 复用已有的空白视频节点
          store.updateNode(videoNodeId, { data: { loading: true, error: '' } } as any)
        }
      }
    } else {
      videoNodeId = store.addNode('video', { x: nodeX + 460, y: nodeY }, {
        url: '',
        loading: true,
        label: '视频生成结果'
      })
      store.addEdge(configNodeId, videoNodeId, {
        sourceHandle: 'right',
        targetHandle: 'left'
      })
    }
  }

  if (!videoNodeId) {
    throw new Error('视频输出节点创建失败')
  }

  // 3. 调用 API 生成视频
  let errorStage: 'precheck' | 'create' | 'poll' | 'finalize' = 'precheck'
  try {
    let payload: any = null
    let requestType: 'json' | 'formdata' = 'json'
    let endpointOverride: string = modelCfg.endpoint
    let statusEndpointOverride: any = modelCfg.statusEndpoint

    if (modelCfg.format === 'veo-unified') {
      payload = { model: modelCfg.key, prompt }
      if (images.length > 0) payload.images = images
      if (ratio === '16:9' || ratio === '9:16') payload.aspect_ratio = ratio
      // Veo API 不支持 duration 参数，时长由模型固定（通常 8 秒）
      const perfMode = useSettingsStore.getState().performanceMode || 'off'
      const forceFast = perfMode === 'ultra'
      const ep = modelCfg.defaultParams?.enhancePrompt
      if (typeof ep === 'boolean') payload.enhance_prompt = forceFast ? false : ep
      const up = modelCfg.defaultParams?.enableUpsample
      if (typeof up === 'boolean') payload.enable_upsample = forceFast ? false : up
    } else if (modelCfg.format === 'veo-openai') {
      // Veo 3.1 系列（云雾API OpenAI视频格式）：multipart/form-data
      // 文档：https://yunwu.apifox.cn/api-370109881
      // 参数：model, prompt, duration_seconds (4/6/8), size (16x9/9x16), input_reference
      const fd = new FormData()
      fd.append('model', modelCfg.key)
      fd.append('prompt', prompt)

      // duration_seconds参数：4/6/8秒，字符串格式
      const secondsValue = Number.isFinite(duration) && duration > 0 ? String(duration) : '8'
      fd.append('duration_seconds', secondsValue)

      // size参数：使用x分隔符（16x9或9x16），不是冒号
      const sizeValue = ratio === '9:16' ? '9x16' : '16x9'
      fd.append('size', sizeValue)

      // 添加图片（优先使用首帧，否则使用参考图，再尝试images数组）
      const imgUrl = firstFrame || refImages[0] || images[0] || ''
      console.log('[veo-openai] 图片来源检查:', {
        hasFirstFrame: !!firstFrame,
        firstFrameLen: firstFrame?.length || 0,
        firstFramePrefix: firstFrame?.slice(0, 50) || '',
        refImagesCount: refImages?.length || 0,
        imagesCount: images?.length || 0,
        finalImgUrlLen: imgUrl?.length || 0,
        finalImgUrlPrefix: imgUrl?.slice(0, 50) || ''
      })
      if (imgUrl) {
        const blob = await resolveImageToBlob(imgUrl)
        console.log('[veo-openai] resolveImageToBlob 结果:', blob ? `Blob size=${blob.size}` : 'null')
        if (blob) {
          fd.append('input_reference', blob, 'input.png')
          console.log('[veo-openai] 已添加 input_reference 图片')
        }
      } else {
        console.log('[veo-openai] 未提供图片，仅文生视频')
      }

      requestType = 'formdata'
      payload = fd
    } else if (modelCfg.format === 'sora-unified') {
      const orientation = ratio === '9:16' ? 'portrait' : 'landscape'
      const size = overrides?.size || d.size || modelCfg.defaultParams?.size || 'large'
      const dur = Number.isFinite(duration) && duration > 0 ? duration : Number(modelCfg.defaultParams?.duration || 15)
      payload = {
        model: modelCfg.key,
        prompt,
        orientation,
        size,
        duration: dur
      }
      if (images.length > 0) payload.images = images
      const watermark = typeof d.watermark === 'boolean' ? d.watermark : modelCfg.defaultParams?.watermark
      if (typeof watermark === 'boolean') payload.watermark = watermark
      const priv = typeof d.private === 'boolean' ? d.private : modelCfg.defaultParams?.private
      if (typeof priv === 'boolean') payload.private = priv
    } else if (modelCfg.format === 'unified-video') {
      // 即梦视频统一格式：需要 size 参数（官方文档要求）
      // 也兼容 Grok 视频统一格式（/v1/video/create）
      payload = { model: modelCfg.key, prompt }
      const requiresImages = typeof modelCfg.requiresImages === 'boolean' ? modelCfg.requiresImages : false
      const imagesMustBeHttp = typeof modelCfg.imagesMustBeHttp === 'boolean' ? modelCfg.imagesMustBeHttp : false
      let imagesForPayload: string[] = images
      if (imagesMustBeHttp) {
        const storeNow = useGraphStore.getState()
        const byId2 = new Map(storeNow.nodes.map((n) => [n.id, n]))
        const connectedEdges2 = storeNow.edges.filter((e) => e.target === configNodeId)

        const firstNodes: GraphNode[] = []
        const lastNodes: GraphNode[] = []
        const refNodes: GraphNode[] = []
        for (const edge of connectedEdges2) {
          const n = byId2.get(edge.source)
          if (!n || n.type !== 'image') continue
          const roleRaw = String((edge.data as any)?.imageRole || '').trim()
          if (roleRaw === 'last_frame_image') lastNodes.push(n)
          else if (roleRaw === 'input_reference') refNodes.push(n)
          else firstNodes.push(n)
        }

        const maxImages = Number(modelCfg.maxImages || 2)
        const out: string[] = []
        const resolvedByNodeId = new Map<string, string>()

        const isPrivateNetUrl = (u: string) =>
          /^https?:\/\/(localhost|127\.|192\.168\.|10\.|172\.(1[6-9]|2[0-9]|3[01])\.)/i.test(u)

        const resolvePublicUrlForNode = async (n: GraphNode) => {
          const nd: any = n?.data || {}

          // 1) Prefer real remote URL if exists (avoid local cache / intranet URLs)
          const candidates = [
            nd.sourceUrl,
            nd.sourceURL,
            nd.originalUrl,
            nd.remoteUrl,
            nd.displayUrl,
            nd.url,
          ]
            .map((x) => (typeof x === 'string' ? x.trim() : ''))
            .filter(Boolean)

          const remote = candidates.find((u) => isHttpUrl(u) && !isPrivateNetUrl(u))
          if (remote) return remote

          // 2) If only intranet HTTP URL exists, fail fast with a clear message.
          const intranet = candidates.find((u) => isHttpUrl(u) && isPrivateNetUrl(u))
          if (intranet) {
            throw new Error('该视频模型不支持内网/本地图片链接（localhost/127/192.168/10/172.16-31）。请使用公网可访问的图片 URL，或改用云端生成图片（会带 sourceUrl）。')
          }

          // 3) Convert local data to a public URL via image host upload.
          const localReadable = await resolveReadableImageFromNode(n)
          if (localReadable.startsWith('blob:')) {
            throw new Error('该视频模型不支持 blob 图片，请使用上传/生成后的图片（可转成公网 URL）')
          }
          if (isDataUrl(localReadable)) {
            const compressed = await compressImageBase64(localReadable, 900 * 1024)
            return await uploadBase64ToImageHost(compressed)
          }
          if (isBase64Like(localReadable)) {
            return await uploadBase64ToImageHost(localReadable)
          }

          throw new Error('该视频模型需要公网可访问的图片 URL（http/https）作为垫图。当前连接的图片无法转换，请更换为可访问链接的图片。')
        }

        const resolveForNode = async (n: GraphNode) => {
          const key = String(n?.id || '').trim()
          if (key && resolvedByNodeId.has(key)) return resolvedByNodeId.get(key) || ''
          const u = await resolvePublicUrlForNode(n)
          if (key) resolvedByNodeId.set(key, u)
          return u
        }

        const firstNode = firstNodes[0] || null
        const lastNode = lastNodes[0] || null
        const refCandidates = [...refNodes, ...firstNodes.slice(1), ...lastNodes.slice(1)]

        // first / last can be duplicated (keep both positions if maxImages allows)
        if (firstNode && out.length < maxImages) {
          out.push(await resolveForNode(firstNode))
        }
        if (lastNode && out.length < maxImages) {
          out.push(await resolveForNode(lastNode))
        }

        // refs: dedupe against first/last and among themselves
        const seenRefs = new Set<string>()
        for (const u of out) {
          const v = String(u || '').trim()
          if (v) seenRefs.add(v)
        }
        for (const n of refCandidates) {
          if (out.length >= maxImages) break
          const u = String(await resolveForNode(n) || '').trim()
          if (!u) continue
          if (seenRefs.has(u)) continue
          out.push(u)
          seenRefs.add(u)
        }

        imagesForPayload = out.filter(Boolean).slice(0, maxImages)
      }

      if (requiresImages && imagesForPayload.length === 0) {
        throw new Error('该视频模型需要垫图（请连接首帧/尾帧/参考图至少 1 张）')
      }
      if (imagesForPayload.length > 0) payload.images = imagesForPayload
      if (ratio) payload.aspect_ratio = ratio
      // 添加必需的 size 参数（默认 1080P）
      const sizeParam = overrides?.size || d.size || modelCfg.defaultParams?.size || '1080P'
      payload.size = sizeParam
      const supportsDuration = typeof modelCfg.supportsDuration === 'boolean' ? modelCfg.supportsDuration : true
      if (supportsDuration && duration) payload.duration = duration
    } else if (modelCfg.format === 'openai-video') {
      const inputNode = findPreferredOpenAiInputImageNode(configNodeId)
      let inputCandidate = firstFrame || refImages[0] || ''

      // 若当前候选是 URL（或为空），优先尝试从 IndexedDB 取回可读取的 dataURL/base64（避免跨域/CORS 导致 Failed to fetch）
      const localData = await resolveReadableImageFromNode(inputNode)
      if (localData) {
        const cur = String(inputCandidate || '')
        const preferLocal = !cur || cur.startsWith('http') || cur.startsWith('blob:') || cur.startsWith('asset://')
        if (preferLocal) inputCandidate = localData
      }

      if (!inputCandidate) throw new Error('该视频模型需要垫图（请连接首帧/参考图）')
      const blob = await resolveImageToBlob(inputCandidate)
      if (!blob) {
        throw new Error('垫图解析失败（可能跨域/CORS 或链接已过期）。建议：使用上传/拖入的本地图片，或先让图片节点完成缓存（mediaId）')
      }

      const fd = new FormData()
      fd.append('model', modelCfg.key)
      fd.append('prompt', prompt)
      if (Number.isFinite(duration) && duration > 0) fd.append('seconds', String(duration))
      // Apifox：OpenAI 视频格式 size 使用像素（横版 1280x720 / 竖版 720x1280）
      // 兼容旧节点可能残留的 size=720p（会触发上游“不合法的size”）
      const sizeCandidate = String(overrides?.size || d.size || modelCfg.defaultParams?.size || '')
        .trim()
        .replace(/\s+/g, '')
        .replace(/X/g, 'x')
      const sizeValue =
        sizeCandidate === '720x1280' || sizeCandidate === '1280x720'
          ? sizeCandidate
          : (ratio === '9:16' ? '720x1280' : '1280x720')
      fd.append('size', sizeValue)
      const watermark = modelCfg.defaultParams?.watermark
      if (typeof watermark === 'boolean') fd.append('watermark', watermark ? 'true' : 'false')
      fd.append('input_reference', blob, 'input.png')

      requestType = 'formdata'
      payload = fd
    } else if (modelCfg.format === 'sora-openai') {
      // Sora OpenAI 官方格式（multipart/form-data 格式）
      // 参考文档: https://help.allapi.store/api-412862113
      // 端点: POST /v1/videos
      // 查询: GET /v1/videos/{id}
      // 注意：当有图片输入时，图片尺寸必须与 size 参数完全匹配
      const sizeValue = overrides?.size || d.size || modelCfg.defaultParams?.size || (ratio === '9:16' ? '720x1280' : '1280x720')
      const secondsValue = Number.isFinite(duration) && duration > 0 ? String(duration) : '4'
      
      const fd = new FormData()
      fd.append('model', modelCfg.key)
      fd.append('prompt', prompt || '')
      fd.append('size', sizeValue)
      fd.append('seconds', secondsValue)
      
      // 如果有图片，需要转换为 Blob 并调整尺寸以匹配 size 参数
      // Sora API 要求: "Inpaint image must match the requested width and height"
      const imageInput = firstFrame || refImages[0] || ''
      if (imageInput) {
        let blob = await resolveImageToBlob(imageInput)
        if (blob) {
          // 调整图片尺寸以匹配请求的 size 参数
          console.log('[generateVideo] Sora OpenAI: 调整图片尺寸以匹配 size:', sizeValue)
          blob = await resizeImageBlob(blob, sizeValue)
          fd.append('input_reference', blob, 'input.png')
        }
      }
      
      requestType = 'formdata'
      payload = fd
    } else if (modelCfg.format === 'kling-video') {
      const hasAnyImage = Boolean(firstFrame || lastFrame || refImages.length > 0)
      const modelName = modelCfg.defaultParams?.model_name || 'kling-v2-6'
      const mode = modelCfg.defaultParams?.mode || 'pro'
      const sound = modelCfg.defaultParams?.sound || 'off'
      let durValue = Number.isFinite(duration) && duration > 0 ? String(duration) : String(modelCfg.defaultParams?.duration || 10)
      const supportsSoundAndVoice = /^kling-v2-6/i.test(String(modelName || '').trim())
      const voiceIdsRaw = String((d as any)?.klingVoiceIds || '').trim()
      const voiceIds = voiceIdsRaw
        ? voiceIdsRaw
            .split(/[,，\s]+/g)
            .map((x) => String(x || '').trim())
            .filter(Boolean)
            .slice(0, 2)
        : []

      // API 约束：kling-video 的 duration 只支持 5 和 10 秒
      const durNum = Number(durValue)
      if (durNum !== 5 && durNum !== 10) {
        durValue = durNum > 7 ? '10' : '5'
        console.warn('[generateVideo] kling-video duration 只支持 5/10 秒，已自动调整为:', durValue)
      }

      if (hasAnyImage) {
        let image = firstFrame || refImages[0] || ''
        if (!image) throw new Error('Kling 图生视频需要首帧/参考图（请连接图片节点）')
        try {
          image = await ensurePublicHttpImageUrl(image, '首帧')
        } catch (e: any) {
          throw new Error(`首帧图片处理失败：${e?.message || String(e || '')}`)
        }

        let tail = lastFrame || ''
        if (tail) {
          try {
            tail = await ensurePublicHttpImageUrl(tail, '尾帧')
          } catch (e: any) {
            throw new Error(`尾帧图片处理失败：${e?.message || String(e || '')}`)
          }
        }

        endpointOverride = modelCfg.endpointImage || endpointOverride
        statusEndpointOverride = modelCfg.statusEndpointImage || statusEndpointOverride
        payload = {
          model_name: modelName,
          image,
          mode,
          duration: durValue,
        }
        // API 约束：image_tail 不能为空字符串，仅在有尾帧时才传入
        if (tail) payload.image_tail = tail
        // sound / voice_list：仅 kling-v2-6 及后续模型支持（按云雾文档）
        // API 约束：sound 与 image_tail 不兼容，仅在无尾帧时才启用 sound
        if (supportsSoundAndVoice && !tail) {
          payload.sound = sound
          if (voiceIds.length > 0) {
            if (String(sound || '').toLowerCase() !== 'on') {
              throw new Error('使用音色（voice_list）时需要 sound=on：请切换到 "kling-v2-6 · 有音频" 模型')
            }
            // API 文档要求 voiceId（驼峰），不是 voice_id
            payload.voice_list = voiceIds.map((id) => ({ voiceId: id }))
          }
        } else if (voiceIds.length > 0) {
          throw new Error('当前 Kling 模型不支持音色（voice_list），仅 kling-v2-6 支持')
        }
        if (prompt) payload.prompt = prompt
      } else {
        const promptText = normalizeText(prompt)
        if (!promptText) {
          throw new Error('Kling 文生视频需要提示词：请连接文本节点（提示词）后重试')
        }
        payload = { model_name: modelName, prompt: promptText, mode, duration: durValue, sound }
        if (ratio) payload.aspect_ratio = ratio
      }
    } else if (modelCfg.format === 'kling-multi-image2video') {
      // Kling 多图参考生视频：POST /kling/v1/videos/multi-image2video
      // 查询：GET /kling/v1/videos/multi-image2video/{id}
      const modelName = modelCfg.defaultParams?.model_name || 'kling-v1-6'
      const mode = modelCfg.defaultParams?.mode || 'std'
      let durValue = Number.isFinite(duration) && duration > 0 ? String(duration) : String(modelCfg.defaultParams?.duration || '5')
      const promptText = normalizeText(prompt)
      if (!promptText) throw new Error('Kling 多图参考生视频需要提示词：请连接文本节点（提示词）后重试')
      if (!Array.isArray(refImages) || refImages.length === 0) {
        throw new Error('Kling 多图参考生视频需要至少 1 张参考图（请连接图片节点并设置为"参考图"）')
      }

      // API 约束：multi-image2video 的 duration 只支持 5 和 10 秒
      const durNum = Number(durValue)
      if (durNum !== 5 && durNum !== 10) {
        durValue = durNum > 7 ? '10' : '5'
        console.warn('[generateVideo] multi-image2video duration 只支持 5/10 秒，已自动调整为:', durValue)
      }

      const ensureHttpImage = async (raw: string, label: string) => {
        return await ensurePublicHttpImageUrl(raw, label)
      }

      const max = Number.isFinite(Number(modelCfg.maxImages)) ? Number(modelCfg.maxImages) : 4
      const image_list: any[] = []
      for (let i = 0; i < Math.min(max, refImages.length); i++) {
        const url = await ensureHttpImage(refImages[i], `参考图${i + 1}`)
        if (url) image_list.push({ image: url })
      }
      if (image_list.length === 0) throw new Error('Kling 多图参考生视频参考图为空')

      payload = { model_name: modelName, image_list, prompt: promptText, mode, duration: durValue }
      if (ratio) payload.aspect_ratio = ratio
    } else if (modelCfg.format === 'volc-seedance-video') {
      // doubao-seedance-1-5-pro-251215
      // 文档：POST /volc/v1/contents/generations/tasks
      // 返回：{ id, status: "submitted" }，查询：GET /volc/v1/contents/generations/tasks/{id}
      const promptText = normalizeText(prompt)
      if (!promptText) {
        throw new Error('seedance-1-5-pro 需要提示词：请连接文本节点（提示词）后重试')
      }
      const durValue = Number.isFinite(duration) && duration > 0 ? duration : Number(modelCfg.defaultParams?.duration || 4)
      const ratioValue = String(ratio || modelCfg.defaultParams?.ratio || 'adaptive') || 'adaptive'
      const watermark = typeof modelCfg.defaultParams?.watermark === 'boolean' ? modelCfg.defaultParams.watermark : false

      const ensureHttpImage = async (raw: string, label: string) => {
        return await ensurePublicHttpImageUrl(raw, label)
      }

      const content: any[] = []
      content.push({ type: 'text', text: promptText })

      let firstUrl = firstFrame || refImages[0] || ''
      let lastUrl = lastFrame || ''
      if (firstUrl) firstUrl = await ensureHttpImage(firstUrl, '首帧')
      if (lastUrl) lastUrl = await ensureHttpImage(lastUrl, '尾帧')

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
    } else if (modelCfg.format === 'alibailian-wan-video') {
      // 通义万象 wan2.6-i2v
      // 端点：POST /alibailian/api/v1/services/aigc/video-generation/video-synthesis
      // 查询：GET /alibailian/api/v1/tasks/{task_id}
      const ensureHttpImage = async (raw: string, label: string) => {
        return await ensurePublicHttpImageUrl(raw, label)
      }

      let imageUrl = firstFrame || refImages[0] || ''
      if (!imageUrl) throw new Error('wan2.6-i2v 需要首帧图片（请连接图片节点）')
      imageUrl = await ensureHttpImage(imageUrl, '首帧')

      const sizeValue = String(overrides?.size || d.size || modelCfg.defaultParams?.size || '1080P')
      const durValue = Number.isFinite(duration) && duration > 0 ? duration : Number(modelCfg.defaultParams?.duration || 5)
      const promptExtend =
        typeof (d as any)?.prompt_extend === 'boolean'
          ? (d as any).prompt_extend
          : typeof modelCfg.defaultParams?.prompt_extend === 'boolean'
            ? modelCfg.defaultParams.prompt_extend
            : true

      payload = {
        model: modelCfg.key,
        input: {
          prompt: prompt || '',
          // 用户要求使用 image_url；同时附带 img_url 以兼容 DashScope / 云雾示例
          image_url: imageUrl,
          img_url: imageUrl,
        },
        parameters: {
          resolution: sizeValue,
          duration: durValue,
          prompt_extend: promptExtend,
        }
      }
    } else if (modelCfg.format === 'minimax-hailuo-video') {
      // 云雾海螺（MiniMax）端点：POST /minimax/v1/video_generation
      // 查询：GET /minimax/v1/query/video_generation?task_id=...
      // API 约束：
      // - 纯文生视频：model=MiniMax-Hailuo-02, 只需 model/prompt/duration
      // - 图生视频（仅首帧）：model=MiniMax-Hailuo-2.3, 需要 first_frame_image/resolution/prompt_optimizer
      // - 首尾帧视频：model=MiniMax-Hailuo-02, 需要 first_frame_image/last_frame_image/resolution/prompt_optimizer
      const ensureHttpImage = async (raw: string, label: string) => {
        return await ensurePublicHttpImageUrl(raw, label)
      }

      const sizeValue = String(overrides?.size || d.size || modelCfg.defaultParams?.size || '768P')
      const durValue = Number.isFinite(duration) && duration > 0 ? duration : Number(modelCfg.defaultParams?.duration || 10)

      let firstUrl = firstFrame || refImages[0] || ''
      let lastUrl = lastFrame || ''
      if (firstUrl) firstUrl = await ensureHttpImage(firstUrl, '首帧')
      if (lastUrl) lastUrl = await ensureHttpImage(lastUrl, '尾帧')

      const userModel = String(modelCfg.key || '')
      const isUserHailuo02 = userModel === 'MiniMax-Hailuo-02'
      const isUserFastModel = userModel === 'MiniMax-Hailuo-2.3-Fast'
      const effectiveModel = isUserHailuo02
        ? 'MiniMax-Hailuo-02'
        : (lastUrl
          ? 'MiniMax-Hailuo-02'
          : (firstUrl ? (isUserFastModel ? 'MiniMax-Hailuo-2.3-Fast' : 'MiniMax-Hailuo-2.3') : 'MiniMax-Hailuo-02'))

      // 海螺全系列仅支持 6/10 秒；安全兜底到 durs 范围
      const allowedDurs = (modelCfg.durs || []).map((d: any) => Number(d?.key ?? d))
      const safeDurValue = allowedDurs.length > 0 && !allowedDurs.includes(durValue)
        ? (allowedDurs.includes(6) ? 6 : allowedDurs[0] || durValue)
        : durValue

      // 基础参数（纯文生视频）
      payload = {
        model: effectiveModel,
        prompt: prompt || '',
        duration: safeDurValue,
      }
      // 图生视频 / 首尾帧视频：添加图片和额外参数
      if (firstUrl) {
        payload.first_frame_image = firstUrl
        payload.resolution = sizeValue
        const po = modelCfg.defaultParams?.prompt_optimizer
        if (typeof po === 'boolean') payload.prompt_optimizer = po
      }
      if (lastUrl) payload.last_frame_image = lastUrl
    } else if (modelCfg.format === 'kling-omni-video') {
      // Kling Omni-Video：POST /kling/v1/videos/omni-video
      // 查询按用户确认：GET /kling/v1/videos/omni-video/{id}
      const ensureHttpImage = async (raw: string, label: string) => {
        return await ensurePublicHttpImageUrl(raw, label)
      }

      const modelName = modelCfg.defaultParams?.model_name || 'kling-video-o1'
      const mode = modelCfg.defaultParams?.mode || 'pro'
      const promptText = normalizeText(prompt)
      if (!promptText) throw new Error('kling-omni-video 需要提示词：请连接文本节点（提示词）后重试')
      let durValue = Number.isFinite(duration) && duration > 0 ? String(duration) : String(modelCfg.defaultParams?.duration || '5')

      const image_list: any[] = []
      if (firstFrame) {
        const u = await ensureHttpImage(firstFrame, '首帧')
        if (u) image_list.push({ image_url: u, type: 'first_frame' })
      }
      if (lastFrame) {
        if (!firstFrame) throw new Error('kling-omni-video 不支持仅尾帧：有尾帧时必须同时提供首帧')
        const u = await ensureHttpImage(lastFrame, '尾帧')
        if (u) image_list.push({ image_url: u, type: 'end_frame' })
      }
      // API 约束：使用首帧/尾帧模式时，不应同时发送无 type 的参考图
      // 参考图（无 type）仅用于纯参考模式（无首帧/尾帧）
      const hasFrameImages = !!(firstFrame || lastFrame)
      if (!hasFrameImages && Array.isArray(refImages) && refImages.length > 0) {
        const max = Number.isFinite(Number(modelCfg.maxImages)) ? Number(modelCfg.maxImages) : 6
        for (let i = 0; i < Math.min(max, refImages.length); i++) {
          const u = await ensureHttpImage(refImages[i], `参考图${i + 1}`)
          if (u) image_list.push({ image_url: u })
        }
      }

      const ensureHttpVideo = (raw: string, label: string) => {
        const v = String(raw || '').trim()
        if (!v) return ''
        if (isHttpUrl(v) && !isPrivateNetUrl(v)) return v
        if (isHttpUrl(v) && isPrivateNetUrl(v)) {
          throw new Error(`${label}是本地/内网链接（localhost/127/192.168/10/172.16-31），上游无法访问。请使用公网可访问的源视频 URL。`)
        }
        if (isAssetUrl(v)) {
          throw new Error(`${label}是本地缓存（asset://），请使用源视频公网 URL（建议用视频节点的 sourceUrl）`)
        }
        throw new Error(`${label}需要公网可访问的 http(s) URL`)
      }

      const video_list: any[] = []
      if (Array.isArray(refVideos) && refVideos.length > 0) {
        const maxV = Number.isFinite(Number(modelCfg.maxRefVideos)) ? Number(modelCfg.maxRefVideos) : 1
        for (let i = 0; i < Math.min(maxV, refVideos.length); i++) {
          const u = ensureHttpVideo(refVideos[i], `参考视频${i + 1}`)
          if (u) {
            video_list.push({
              video_url: u,
              refer_type: 'feature',
              keep_original_sound: 'no',
            })
          }
        }
      }

      payload = { model_name: modelName, prompt: promptText, image_list, mode, duration: durValue }
      if (video_list.length > 0) payload.video_list = video_list
      // API 约束：使用首帧时，aspect_ratio 由图片推断，不应传入；仅纯文生视频时需要 aspect_ratio
      const hasFirstFrame = image_list.some((img: any) => img.type === 'first_frame')
      // API 约束：使用首帧时，duration 只支持 5 和 10 秒
      if (hasFirstFrame) {
        const durNum = Number(durValue)
        if (durNum !== 5 && durNum !== 10) {
          durValue = durNum > 7 ? '10' : '5'
          payload.duration = durValue
        }
      }
      if (!hasFirstFrame && ratio) payload.aspect_ratio = ratio
    } else if (modelCfg.format === 'luma-video') {
      // Luma 官方格式：POST /luma/generations, GET /luma/generations/{id}
      const modelName = String(modelCfg.defaultParams?.model_name || 'ray-v2')
      const durValue = Number.isFinite(duration) && duration > 0 ? duration : Number(modelCfg.defaultParams?.duration || 5)
      const durationStr = `${durValue}s`
      const resolution = String(overrides?.size || d.size || modelCfg.defaultParams?.size || '720p')

      payload = {
        user_prompt: prompt || '',
        model_name: modelName,
        duration: durationStr,
        resolution,
      }
    } else if (modelCfg.format === 'runway-video') {
      // Runway：POST /runwayml/v1/image_to_video, GET /runwayml/v1/tasks/{id}
      // 注意：Runway ratio 使用像素比（如 1280:720）
      const ensureHttpImage = async (raw: string, label: string) => {
        return await ensurePublicHttpImageUrl(raw, label)
      }

      let imageUrl = firstFrame || refImages[0] || ''
      if (!imageUrl) throw new Error('Runway image_to_video 需要首帧图片（请连接图片节点）')
      imageUrl = await ensureHttpImage(imageUrl, '首帧')

      const durValue = Number.isFinite(duration) && duration > 0 ? duration : Number(modelCfg.defaultParams?.duration || 10)
      const watermark = typeof modelCfg.defaultParams?.watermark === 'boolean' ? modelCfg.defaultParams.watermark : false

      const toPixelRatio = (r: string) => {
        const rr = String(r || '').trim()
        if (!rr) return '1280:720'
        if (/^\d+:\d+$/.test(rr) && rr.includes(':') && rr.split(':')[0].length > 2) {
          // 已经是像素比（如 1280:768）
          return rr
        }
        // 传入的是宽高比（如 16:9）
        switch (rr) {
          case '16:9':
            return '1280:720'
          case '9:16':
            return '720:1280'
          case '1:1':
            return '1024:1024'
          case '4:3':
            return '1024:768'
          case '3:4':
            return '768:1024'
          default:
            return '1280:720'
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
    } else if (modelCfg.format === 'sora-video') {
      // Sora 2 / OpenAI Videos API 格式 (/videos/generations)
      const dur = Number.isFinite(duration) && duration > 0 ? duration : Number(modelCfg.defaultParams?.duration || 10)
      const size = d.size || modelCfg.defaultParams?.size || '720p'
      const aspectRatio = ratio || modelCfg.defaultParams?.ratio || '16:9'
      
      payload = {
        model: modelCfg.key,
        prompt: prompt || '',
        duration: dur,
        size: size,
        aspect_ratio: aspectRatio
      }
      
      // 如果有参考图，添加为 image 参数
      if (firstFrame || refImages.length > 0) {
        const imageUrl = firstFrame || refImages[0]
        payload.image = imageUrl
      }
    } else if (modelCfg.format === 'openai-chat-video') {
      // 旧的 Chat Completions 视频格式（兼容性保留）
      const dur = Number.isFinite(duration) && duration > 0 ? duration : Number(modelCfg.defaultParams?.duration || 8)
      const size = overrides?.size || d.size || modelCfg.defaultParams?.size || '720p'
      const aspectRatio = ratio || modelCfg.defaultParams?.ratio || '16:9'
      
      let videoPrompt = prompt || ''
      if (firstFrame || refImages.length > 0) {
        const imageUrl = firstFrame || refImages[0]
        payload = {
          model: modelCfg.key,
          messages: [
            {
              role: 'user',
              content: [
                { type: 'text', text: `Generate a ${dur} second video at ${size} resolution with aspect ratio ${aspectRatio}. ${videoPrompt}` },
                { type: 'image_url', image_url: { url: imageUrl } }
              ]
            }
          ],
          video: { duration: dur, size: size, aspect_ratio: aspectRatio }
        }
      } else {
        payload = {
          model: modelCfg.key,
          messages: [{ role: 'user', content: `Generate a ${dur} second video at ${size} resolution with aspect ratio ${aspectRatio}. ${videoPrompt}` }],
          video: { duration: dur, size: size, aspect_ratio: aspectRatio }
        }
      }
    } else if (modelCfg.format === 'tencent-aigc-video') {
      // 腾讯 AIGC 视频（Vidu 等）：POST /tencent-vod/v1/aigc-video
      const modelName = modelCfg.defaultParams?.model_name || 'Vidu'
      const modelVersion = modelCfg.defaultParams?.model_version || 'q3-pro'
      const dur = Number.isFinite(duration) && duration > 0 ? duration : Number(modelCfg.defaultParams?.duration || 5)
      const aspectRatio = ratio || modelCfg.defaultParams?.ratio || '16:9'
      const resolution = modelCfg.defaultParams?.resolution || '1080P'

      payload = {
        model_name: modelName,
        model_version: modelVersion,
        prompt: prompt || '',
        enhance_prompt: modelCfg.defaultParams?.enhance_prompt || 'Enabled',
        output_config: {
          storage_mode: 'Temporary',
          duration: dur,
          resolution,
          aspect_ratio: aspectRatio,
          audio_generation: modelCfg.defaultParams?.audio_generation || 'Enabled',
        },
      }

      // 参考图（需要公网可达的 HTTP URL，imageproxy CDN 可能被腾讯拒绝）
      // 优先从图片节点的 sourceUrl 取原始 HTTP URL
      if (firstFrame || refImages.length > 0) {
        const fileInfos: any[] = []

        // 尝试从连接的图片节点获取原始 sourceUrl
        const store = useGraphStore.getState()
        const configNode = store.nodes.find(n => n.id === configNodeId)
        const connectedImageNodes = store.edges
          .filter(e => e.target === configNodeId)
          .map(e => store.nodes.find(n => n.id === e.source))
          .filter((n): n is any => n?.type === 'image' && !!(n.data as any)?.sourceUrl)

        for (const imgNode of connectedImageNodes.slice(0, 3)) {
          const srcUrl = String((imgNode.data as any).sourceUrl || '').trim()
          if (srcUrl && /^https?:\/\//i.test(srcUrl)) {
            fileInfos.push({ Type: 'Url', Url: srcUrl })
          }
        }

        // 如果没有 sourceUrl，尝试上传 data URL 到 CDN（可能被拒绝）
        if (fileInfos.length === 0) {
          const allImages = firstFrame ? [firstFrame, ...refImages] : refImages
          for (const img of allImages.slice(0, 3)) {
            const url = String(img || '').trim()
            if (!url) continue
            if (/^https?:\/\//i.test(url)) {
              fileInfos.push({ Type: 'Url', Url: url })
            } else if (url.startsWith('data:') && url.length > 100) {
              try {
                const m = url.match(/^data:([^;]+);base64,(.*)$/)
                if (m) {
                  const byteString = atob(m[2])
                  const bytes = new Uint8Array(byteString.length)
                  for (let i = 0; i < byteString.length; i++) bytes[i] = byteString.charCodeAt(i)
                  const blob = new Blob([bytes], { type: m[1] })
                  const fd = new FormData()
                  fd.append('file', blob, `image.${m[1].split('/')[1] || 'png'}`)
                  const uploadResp = await postFormData<any>('https://imageproxy.zhongzhuan.chat/api/upload', fd, { authMode: 'bearer', timeoutMs: 60000 })
                  const httpUrl = String(uploadResp?.url || uploadResp?.data?.url || '').trim()
                  if (httpUrl && /^https?:\/\//i.test(httpUrl)) fileInfos.push({ Type: 'Url', Url: httpUrl })
                }
              } catch (e) {
                console.warn('[video] tencent-aigc 参考图上传失败:', e)
              }
            }
          }
        }

        if (fileInfos.length > 0) (payload as any).file_infos = fileInfos
      }

      // 尾帧
      if (lastFrame && /^https?:\/\//i.test(lastFrame)) {
        (payload as any).last_frame_url = lastFrame
      }
    } else {
      throw new Error(`暂未支持该视频模型格式：${String(modelCfg.format || '')}`)
    }

    // 打印详细的请求信息，包括 FormData 内容
    let payloadDebug: any = payload
    if (requestType === 'formdata' && payload instanceof FormData) {
      payloadDebug = {}
      payload.forEach((value, key) => {
        payloadDebug[key] = value instanceof Blob ? `[Blob: ${value.size} bytes]` : value
      })
    }
    console.log('[generateVideo] 发送 API 请求:', {
      endpoint: endpointOverride,
      requestType,
      authMode: modelCfg.authMode,
      format: modelCfg.format,
      modelKey: modelCfg.key,
      userSelectedDuration: duration,
      payload: payloadDebug
    })
    console.log('[generateVideo] 完整 payload:', JSON.stringify(payloadDebug, null, 2))
    
    // 带重试的 API 调用（处理网络抖动 / 上游过载）
    // Grok 在 Tauri 中更容易遇到“官方负载过大”，这里做更温和、更长的重试退避。
    const isGrokModel = /^grok-video-/i.test(String(modelCfg.key || ''))
    const maxRetries = (isTauriEnv && isGrokModel) ? 6 : 3
    let lastError: Error | null = null
    let task: any = null
    
    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        errorStage = 'create'
        if (attempt > 0) {
          console.log(`[generateVideo] 第 ${attempt + 1} 次重试...`)
          // 递增延迟：Grok + Tauri 采用更长的指数退避
          const waitMs = (isTauriEnv && isGrokModel)
            ? Math.min(20000, 2500 * Math.pow(2, Math.max(0, attempt - 1))) // 2.5s, 5s, 10s, 20s...
            : (1000 * attempt)
          await new Promise(r => setTimeout(r, waitMs))
        }
        
        task = requestType === 'formdata'
          ? await postFormData<any>(endpointOverride, payload, { authMode: modelCfg.authMode, timeoutMs: 240000 })
          : await postJson<any>(endpointOverride, payload, { authMode: modelCfg.authMode, timeoutMs: 240000 })
        
        break // 成功则跳出重试循环
      } catch (err: any) {
        lastError = err
        const errMsg = String(err?.message || err || '')
        const isNetworkError = /Failed to fetch|NetworkError|ERR_/i.test(errMsg)
        const isOverloadError =
          isTauriEnv &&
          isGrokModel &&
          /负载过大|server busy|overload|Service Unavailable|HTTP 503|Too Many Requests|rate limit|temporarily unavailable|try again later/i.test(errMsg)
        
        // 非网络错误或已达最大重试次数，直接抛出
        if ((!isNetworkError && !isOverloadError) || attempt === maxRetries - 1) {
          throw err
        }
        
        console.warn(`[generateVideo] ${isOverloadError ? '上游过载' : '网络'}错误，准备重试:`, errMsg)
      }
    }
    
    if (!task) {
      throw lastError || new Error('视频 API 调用失败')
    }
    
    console.log('[generateVideo] API 响应:', JSON.stringify(task, null, 2))

    // 检测 MiniMax/Hailuo 等 API 的业务层错误（HTTP 200 但 status: "error"）
    if (task?.status === 'error' || (task?.base_resp && task.base_resp.status_code !== 0)) {
      const errMsg = task?.base_resp?.status_msg || task?.message || task?.error || '未知错误'
      throw new Error(`${modelCfg.label || modelKey} 生成失败: ${errMsg}`)
    }

    // 尝试从不同格式提取视频 URL
    let extractedVideoUrl = ''

    // 云雾 alibailian（DashScope 风格）：task_id 位于 output.task_id
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
    
    // Sora 2 Videos API 格式
    if (modelCfg.format === 'sora-video') {
      // 标准响应格式: { id, status, video_url } 或 { data: [{ url }] }
      extractedVideoUrl = task?.video_url || task?.url || task?.data?.[0]?.url || task?.data?.video_url || ''
      console.log('[generateVideo] Sora Video 解析:', { extractedVideoUrl, taskKeys: Object.keys(task || {}) })
    }
    
    // Chat Completions 视频格式
    if (modelCfg.format === 'openai-chat-video') {
      const choice = task?.choices?.[0]
      const content = choice?.message?.content || ''
      extractedVideoUrl = pickFirstHttpUrlFromText(content) || ''
      if (!extractedVideoUrl) {
        extractedVideoUrl = task?.video_url || task?.data?.video_url || choice?.message?.video_url || ''
      }
      console.log('[generateVideo] Chat Video 解析:', { content: content?.slice(0, 200), extractedVideoUrl })
    }

    const directRaw =
      extractedVideoUrl ||
      task?.video_url ||
      task?.data?.video_url ||
      task?.data?.url ||
      task?.url ||
      extractVideoUrlDeep(task)
    let videoUrl = normalizeMediaUrl(directRaw)

    if (!videoUrl) {
      const id = task?.id || task?.task_id || task?.taskId || task?.data?.id || task?.data?.task_id || task?.data?.taskId || task?.Response?.TaskId || task?.response?.TaskId || task?.response?.task_id
      if (!id) throw new Error('视频返回异常：未获取到任务 ID')
      errorStage = 'poll'
      try {
        const polled = await pollVideoTask(String(id), { ...modelCfg, statusEndpoint: statusEndpointOverride }, configNodeId, videoNodeId)
        videoUrl = normalizeMediaUrl(polled)
      } catch (pollErr: any) {
        throw pollErr
      }
    }

    if (!videoUrl) {
      const hint = typeof directRaw === 'string' && String(directRaw).trim()
        ? `模型返回文本：${String(directRaw).trim().slice(0, 160)}`
        : ''
      throw new Error(`视频返回为空。${hint}`)
    }
    
    console.log('[generateVideo] 获取到视频 URL:', videoUrl?.slice(0, 100))

    // 4. 成功：更新视频节点
    const perfMode = useSettingsStore.getState().performanceMode || 'off'
    const preferFastWriteback = isTauriEnv && perfMode === 'ultra'

    // Tauri 极速模式：先回写远程 URL（结束 loading），缓存/下载在后台进行
    if (preferFastWriteback && isHttpUrl(videoUrl)) {
      const latestStore = useGraphStore.getState()
      try {
        latestStore.updateNode(videoNodeId, {
          data: {
            url: videoUrl,
            sourceUrl: videoUrl,
            loading: false,
            error: '',
            label: '视频',
            model: modelKey,
            updatedAt: Date.now()
          }
        } as any)
      } catch {
        // ignore
      }
      
      // 同步到历史素材（先记录远程 URL；极速模式下本地缓存会在后台完成）
      try {
        useAssetsStore.getState().addAsset({
          type: 'video',
          src: videoUrl,
          title: String((d.label || d.prompt || '画布视频') as any).slice(0, 80),
          model: modelKey,
          duration: Number(duration || 0),
        })
      } catch {
        // ignore
      }

      void (async () => {
        try {
          const cached = await resolveCachedMediaUrl(videoUrl) as { displayUrl: string; localPath: string; error?: string }
          const storeNow = useGraphStore.getState()
          const stillExists = storeNow.nodes.some((n) => n.id === videoNodeId)
          if (!stillExists) return
          const nextUrl = String(cached.displayUrl || '').trim()
          if (nextUrl && nextUrl !== videoUrl) {
            storeNow.updateNode(videoNodeId, {
              data: { url: nextUrl, localPath: cached.localPath, sourceUrl: videoUrl, loading: false, error: '', updatedAt: Date.now() }
            } as any)
          }
        } catch {
          // ignore
        }
      })()

      if (selectOutput) latestStore.setSelected(videoNodeId)
      if (markConfigExecuted) latestStore.updateNode(configNodeId, { data: { executed: true, outputNodeId: videoNodeId } } as any)
      errorStage = 'finalize'
      return
    }

    const cached = await resolveCachedMediaUrl(videoUrl) as { displayUrl: string; localPath: string; error?: string }
    const latestStore = useGraphStore.getState()
    const displayUrl = cached.displayUrl
    
    console.log('[generateVideo] 缓存解析结果:', {
      videoUrl: videoUrl?.slice(0, 80),
      displayUrl: displayUrl?.slice(0, 80),
      localPath: cached.localPath?.slice(0, 50),
      error: cached.error,
      videoNodeId
    })
    
    // 如果下载失败，抛出错误
    if (!displayUrl && cached.error) {
      throw new Error(`视频下载失败: ${cached.error}`)
    }
    if (!displayUrl) {
      throw new Error('视频下载失败：无法获取视频内容')
    }
    
    // 如果数据是大型数据（base64 或 blob URL），保存到 IndexedDB
    let mediaId: string | undefined
    if (isLargeData(displayUrl) || isBase64Data(displayUrl)) {
      try {
        const projectId = latestStore.projectId || 'default'
        mediaId = await saveMedia({
          nodeId: videoNodeId,
          projectId,
          type: 'video',
          data: displayUrl,
          sourceUrl: isPersistableSourceUrl(videoUrl) && videoUrl !== displayUrl ? videoUrl : undefined,
          model: modelKey,
        })
        console.log('[generateVideo] 视频已保存到 IndexedDB, mediaId:', mediaId)
      } catch (err) {
        console.error('[generateVideo] 保存到 IndexedDB 失败:', err)
      }
    }
    
    latestStore.updateNode(videoNodeId, {
      data: {
        url: displayUrl,
        localPath: cached.localPath,
        // 记录可恢复的原始地址（http(s) 或 /v1/... 相对 API 路径）
        sourceUrl: isPersistableSourceUrl(videoUrl) ? videoUrl : undefined,
        mediaId, // IndexedDB 媒体 ID
        loading: false,
        error: '',
        label: '视频',
        model: modelKey,
        updatedAt: Date.now()
      }
    } as any)
    
    // 同步到历史素材（画布视频）
    try {
      useAssetsStore.getState().addAsset({
        type: 'video',
        src: displayUrl,
        title: String((d.label || d.prompt || '画布视频') as any).slice(0, 80),
        model: modelKey,
        duration: Number(duration || 0),
      })
    } catch {
      // ignore
    }
    
    // 等待 React 渲染周期，确保 store 更新已同步
    await new Promise(r => setTimeout(r, 50))
    
    // 验证更新是否成功
    const afterUpdate = useGraphStore.getState().nodes.find(n => n.id === videoNodeId)
    console.log('[generateVideo] 更新后验证:', {
      nodeId: afterUpdate?.id,
      hasUrl: !!(afterUpdate?.data as any)?.url,
      urlLength: (afterUpdate?.data as any)?.url?.length || 0,
      urlPreview: (afterUpdate?.data as any)?.url?.slice(0, 80),
      loading: (afterUpdate?.data as any)?.loading,
      error: (afterUpdate?.data as any)?.error,
      mediaId: (afterUpdate?.data as any)?.mediaId
    })
    
    // 如果验证失败，尝试重新更新
    if (!afterUpdate || !(afterUpdate.data as any)?.url) {
      console.warn('[generateVideo] 节点更新验证失败，尝试重新更新')
      useGraphStore.getState().updateNode(videoNodeId, {
        data: { url: displayUrl, loading: false, error: '', model: modelKey, mediaId }
      } as any)
      await new Promise(r => setTimeout(r, 50))
    }
    
    // 触发 React Flow 节点刷新事件
    try {
      const event = new CustomEvent('nexus:node-updated', { detail: { nodeId: videoNodeId, type: 'video' } })
      window.dispatchEvent(event)
    } catch (e) {
      console.warn('[generateVideo] 触发刷新事件失败:', e)
    }

    if (selectOutput) {
      latestStore.setSelected(videoNodeId)
    }
    if (markConfigExecuted) {
      latestStore.updateNode(configNodeId, { data: { executed: true, outputNodeId: videoNodeId } } as any)
    }
    errorStage = 'finalize'

  } catch (err: any) {
    // 5. 失败：更新视频节点显示错误
    console.error('[generateVideo] 生成失败:', err?.message, err)
    const latestStore = useGraphStore.getState()
    const baseMsg = sanitizeErrorForNode(err)
    const msg =
      errorStage === 'create'
        ? (baseMsg.startsWith('创建任务失败：') ? baseMsg : `创建任务失败：${baseMsg}`)
        : errorStage === 'poll'
          ? (baseMsg.startsWith('轮询任务失败：') ? baseMsg : `轮询任务失败：${baseMsg}`)
          : baseMsg
    latestStore.updateNode(videoNodeId, {
      data: {
        loading: false,
        error: msg,
        updatedAt: Date.now()
      }
    } as any)
    throw err
  } finally {
    // 清理任务注册
    const task = runningTasks.get(configNodeId)
    if (task) {
      task.activeCount = (task.activeCount || 1) - 1
      if (task.activeCount <= 0) {
        runningTasks.delete(configNodeId)
        console.log('[generateVideo] 任务已清理:', configNodeId)
      } else {
        console.log('[generateVideo] 并发任务仍在运行，暂不清理:', { configNodeId, activeCount: task.activeCount })
      }
    }
  }
}

/**
 * 将视频生成任务加入队列（用于批量生成）
 * @param configNodeId 视频配置节点 ID
 * @param overrides 参数覆盖
 * @param callbacks 回调函数
 * @returns 任务 ID
 */
export const enqueueVideoGeneration = (
  configNodeId: string,
  overrides?: VideoGenerationOverrides,
  callbacks?: {
    onProgress?: (progress: number) => void
    onComplete?: (result: any) => void
    onError?: (error: Error) => void
  }
): string => {
  return requestQueue.enqueue({
    type: 'video',
    configNodeId,
    overrides,
    priority: 10,
    onProgress: callbacks?.onProgress,
    onComplete: callbacks?.onComplete,
    onError: callbacks?.onError
  })
}

// 注册视频生成执行器
requestQueue.registerExecutor('video', async (task) => {
  const overrides = task.overrides as VideoGenerationOverrides | undefined
  await generateVideoFromConfigNode(task.configNodeId, overrides)
  return { success: true, configNodeId: task.configNodeId }
})
