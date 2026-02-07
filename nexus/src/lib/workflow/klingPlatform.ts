import { getJson, postFormData, postJson } from '@/lib/workflow/request'

const isHttpUrl = (v: string) => /^https?:\/\//i.test(v)
const isDataUrl = (v: string) => typeof v === 'string' && v.startsWith('data:')
const isBase64Like = (v: string) =>
  typeof v === 'string' &&
  v.length > 1024 &&
  !v.startsWith('http') &&
  !v.startsWith('blob:') &&
  !v.startsWith('data:') &&
  /^[A-Za-z0-9+/=\s]+$/.test(v)

export type KlingTaskCreateResult = {
  taskId: string
  raw: any
}

export type KlingPollResult = {
  raw: any
  urls: {
    video?: string
    image?: string
    audio?: string
    any?: string
  }
}

export const extractHttpUrlsDeep = (obj: any): string[] => {
  const out: string[] = []
  const seen = new Set<any>()
  const walk = (v: any) => {
    if (!v || seen.has(v)) return
    seen.add(v)
    if (typeof v === 'string') {
      const s = v.trim()
      if (s && isHttpUrl(s)) out.push(s)
      return
    }
    if (Array.isArray(v)) {
      for (const x of v) walk(x)
      return
    }
    if (typeof v === 'object') {
      for (const k of Object.keys(v)) walk((v as any)[k])
    }
  }
  walk(obj)
  return out
}

const isImageUrl = (u: string) => /\.(png|jpg|jpeg|gif|webp|bmp|svg)(\?|$)/i.test(u)
const isVideoUrl = (u: string) => /\.(mp4|webm|mov|m4v|m3u8|avi|mkv)(\?|$)/i.test(u)
const isAudioUrl = (u: string) => /\.(mp3|wav|m4a|aac|ogg|flac)(\?|$)/i.test(u)

export const pickMediaUrls = (resp: any) => {
  const urls = extractHttpUrlsDeep(resp)
  const video = urls.find((u) => isVideoUrl(u)) || ''
  const image = urls.find((u) => isImageUrl(u)) || ''
  const audio = urls.find((u) => isAudioUrl(u)) || ''
  const any = urls[0] || ''
  return { video, image, audio, any }
}

export const pickTaskId = (resp: any) => {
  const taskId =
    resp?.data?.task_id ||
    resp?.data?.taskId ||
    resp?.data?.id ||
    resp?.task_id ||
    resp?.taskId ||
    resp?.id ||
    resp?.data?.data?.task_id ||
    resp?.data?.data?.id ||
    resp?.output?.task_id ||
    resp?.output?.taskId ||
    resp?.result?.task_id ||
    resp?.result?.id ||
    resp?.task?.task_id ||
    resp?.task?.id
  return String(taskId || '').trim()
}

export const uploadDataUrlToYunwuHost = async (dataUrl: string): Promise<string> => {
  const raw = String(dataUrl || '').trim()
  if (!raw) return ''
  if (!isDataUrl(raw) && !isBase64Like(raw)) return raw

  if (raw.startsWith('blob:')) {
    throw new Error('不支持 blob: URL 上传，请使用 dataURL 或 http(s) URL')
  }

  const base64Content = raw.startsWith('data:') ? raw.split(',')[1] || '' : raw
  const mimeMatch = raw.startsWith('data:') ? raw.match(/^data:([^;]+);/) : null
  const mimeType = mimeMatch ? mimeMatch[1] : 'application/octet-stream'

  const byteCharacters = atob(base64Content.replace(/\s/g, ''))
  const byteNumbers = new Array(byteCharacters.length)
  for (let i = 0; i < byteCharacters.length; i++) byteNumbers[i] = byteCharacters.charCodeAt(i)
  const blob = new Blob([new Uint8Array(byteNumbers)], { type: mimeType })

  const ext = mimeType.split('/')[1] || 'bin'
  const fileName = `file.${ext}`
  const form = new FormData()
  form.append('file', blob, fileName)

  const resp = await postFormData<any>('https://imageproxy.zhongzhuan.chat/api/upload', form, { authMode: 'bearer', timeoutMs: 180000 })
  const urlOut = String(resp?.url || resp?.data?.url || resp?.data?.link || '').trim()
  if (urlOut && isHttpUrl(urlOut)) return urlOut
  throw new Error(String(resp?.error || resp?.message || resp?.data?.message || '云雾上传失败'))
}

export const normalizePayloadInlineMedia = async (payload: any) => {
  const cache = new Map<string, string>()
  const walk = async (v: any): Promise<any> => {
    if (typeof v === 'string') {
      const s = v.trim()
      if (!s) return s
      if (isHttpUrl(s)) return s
      if (isDataUrl(s) || isBase64Like(s)) {
        const hit = cache.get(s)
        if (hit) return hit
        const uploaded = await uploadDataUrlToYunwuHost(s)
        cache.set(s, uploaded)
        return uploaded
      }
      return s
    }
    if (Array.isArray(v)) {
      const out = []
      for (const x of v) out.push(await walk(x))
      return out
    }
    if (v && typeof v === 'object') {
      const out: any = {}
      for (const k of Object.keys(v)) out[k] = await walk(v[k])
      return out
    }
    return v
  }
  return await walk(payload)
}

export const klingCreateTask = async (endpoint: string, payload: any, timeoutMs = 240000): Promise<KlingTaskCreateResult> => {
  const resp = await postJson<any>(endpoint, payload, { authMode: 'bearer', timeoutMs })
  const taskId = pickTaskId(resp)
  return { taskId, raw: resp }
}

export const klingPollTaskForMedia = async (
  taskId: string,
  statusEndpoint: string | ((id: string) => string),
  options?: { maxAttempts?: number; intervalMs?: number }
): Promise<KlingPollResult> => {
  const maxAttempts = options?.maxAttempts ?? 200
  const intervalMs = options?.intervalMs ?? 3000

  let last: any = null
  for (let i = 0; i < maxAttempts; i++) {
    const url = typeof statusEndpoint === 'function' ? statusEndpoint(taskId) : statusEndpoint
    const resp = await getJson<any>(url, undefined, { authMode: 'bearer' })
    last = resp

    const urls = pickMediaUrls(resp)
    if (urls.video || urls.image || urls.audio) return { raw: resp, urls }

    const statusText = String(
      resp?.status ||
        resp?.data?.status ||
        resp?.task_status ||
        resp?.data?.task_status ||
        resp?.data?.state ||
        resp?.state ||
        ''
    ).toLowerCase()
    if (statusText && /(fail|failed|error)/i.test(statusText)) {
      throw new Error(String(resp?.message || resp?.error?.message || resp?.data?.message || 'Kling 任务失败'))
    }

    await new Promise((r) => setTimeout(r, intervalMs))
  }
  const urls = pickMediaUrls(last)
  if (urls.video || urls.image || urls.audio) return { raw: last, urls }
  throw new Error('Kling 任务轮询超时：未获取到可用的媒体 URL')
}

