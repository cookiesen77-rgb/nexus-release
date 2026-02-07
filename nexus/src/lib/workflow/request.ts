import { DEFAULT_API_BASE_URL } from '@/utils/constants'
import { fetch as tauriFetch } from '@tauri-apps/plugin-http'

export type AuthMode = 'bearer' | 'query' | undefined

// 检测是否在 Tauri 环境中
const isTauri = typeof window !== 'undefined' && !!(window as any).__TAURI_INTERNALS__

// 根据环境选择 fetch 实现（带兜底）
// 说明：少量 Windows 用户环境下，Tauri plugin-http 可能因为系统代理/证书链等原因完全无法联网，
// 导致所有请求都失败。此处在 Tauri 下对“抛异常”的情况做一次 fallback 到 WebView 原生 fetch，
// 以提升兼容性（WebView 会走系统网络栈/系统代理）。
const webFetch = globalThis.fetch ? globalThis.fetch.bind(globalThis) : (async () => { throw new Error('fetch is not available') }) as any
const safeFetch: typeof webFetch = (async (input: any, init?: any) => {
  if (!isTauri) return await webFetch(input, init)
  try {
    return await (tauriFetch as any)(input, init)
  } catch (err: any) {
    const msg = String(err?.message || err || '')
    console.warn('[safeFetch] tauriFetch failed, fallback to web fetch:', {
      url: String(input || '').slice(0, 120),
      message: msg.slice(0, 220),
    })
    return await webFetch(input, init)
  }
}) as any

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

const isRetryableStatus = (status: number) => status === 408 || status === 429 || status === 500 || status === 502 || status === 503 || status === 504

const isHtmlLike = (text: string) => {
  const s = String(text || '').trim().toLowerCase()
  if (!s) return false
  return s.startsWith('<!doctype') || s.startsWith('<html') || s.includes('<html') || s.includes('<head') || s.includes('<body') || s.includes('<title')
}

const extractHtmlTitle = (text: string) => {
  const m = String(text || '').match(/<title[^>]*>([^<]+)<\/title>/i)
  return m ? String(m[1] || '').trim() : ''
}

const stripHtml = (text: string) => {
  const raw = String(text || '')
  return raw
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<\/?[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

const summarizeErrorBody = (res: Response, text: string) => {
  const status = Number(res.status) || 0
  const statusText = String((res as any)?.statusText || '').trim()
  const base = `HTTP ${status}${statusText ? ` ${statusText}` : ''}`.trim()

  const raw = String(text || '')
  if (!raw) return base

  // HTML（如 nginx 502）避免把整页塞到 UI / store
  if (isHtmlLike(raw)) {
    const title = extractHtmlTitle(raw)
    const titleClean = title.replace(/\s+/g, ' ').trim()
    if (titleClean) {
      const withoutLeadingStatus = titleClean.replace(/^(\d{3})\s+/, '').trim()
      return `HTTP ${status} ${withoutLeadingStatus || titleClean}`.trim()
    }
    return base
  }

  // 非 HTML：限制长度，避免巨大错误文本污染画布
  const plain = stripHtml(raw)
  if (!plain) return base
  if (plain.length > 360) return `${plain.slice(0, 360)}…`
  return plain
}

const isRetryableError = (err: any) => {
  const msg = String(err?.message || err || '')
  // 代理/TLS/网络抖动（尤其是 Vite proxy 与上游 TLS 握手偶发失败）
  // 以及：偶发的响应体截断会导致 JSON 解析失败（应视为可重试）
  // 502 Bad Gateway 也是常见的临时错误，特别是在 Tauri 环境下
  // Tauri HTTP 插件特有错误: 
  //   - "The string did not match the expected pattern"
  //   - "error sending request for url"
  //   - "request error"
  return /Failed to fetch|NetworkError|socket|TLS|ECONNRESET|EPIPE|ETIMEDOUT|Unexpected end of JSON|Unexpected token|JSON|502|Bad Gateway|Gateway|upstream|did not match|expected pattern|connect error|connection|error sending request|request error|sending request/i.test(msg)
}

const backoffMs = (attempt: number) => {
  const base = 600 * Math.pow(2, Math.max(0, attempt))
  const jitter = Math.floor(Math.random() * 300)
  return Math.min(8000, base + jitter)
}

// 解析 Retry-After（秒或 HTTP-date），返回毫秒；无则返回 0
const getRetryAfterMs = (res: Response) => {
  try {
    const raw = String(res?.headers?.get?.('retry-after') || '').trim()
    if (!raw) return 0
    const secs = Number(raw)
    if (Number.isFinite(secs) && secs > 0) return Math.min(60000, Math.round(secs * 1000))
    const ts = Date.parse(raw)
    if (!Number.isNaN(ts)) {
      const ms = ts - Date.now()
      if (ms > 0) return Math.min(60000, ms)
    }
    return 0
  } catch {
    return 0
  }
}

// 502 Bad Gateway 专用退避：更长的等待时间（服务器过载常见）
const get502BackoffMs = (attempt: number) => {
  const base = 2000 * Math.pow(2, Math.max(0, attempt)) // 2s, 4s, 8s...
  const jitter = Math.floor(Math.random() * 1000)
  return Math.min(15000, base + jitter) // 最多 15 秒
}

// ===== multipart/form-data (Tauri) =====
// Tauri plugin-http 在部分平台（尤其 Windows）对 FormData 支持不稳定。
// 这里在 Tauri 环境下手动把 FormData 编码成 multipart bytes，避免直接传 FormData 导致请求失败。
const concatUint8 = (chunks: Uint8Array[]) => {
  const total = chunks.reduce((sum, c) => sum + (c?.byteLength || 0), 0)
  const out = new Uint8Array(total)
  let offset = 0
  for (const c of chunks) {
    out.set(c, offset)
    offset += c.byteLength
  }
  return out
}

const encodeText = (s: string) => new TextEncoder().encode(String(s || ''))

const escapeQuotes = (s: string) => String(s || '').replace(/"/g, '%22')

const formDataToMultipartBody = async (form: FormData) => {
  const boundary = '----WebKitFormBoundary' + Math.random().toString(36).slice(2)
  const chunks: Uint8Array[] = []

  for (const [name, value] of form.entries()) {
    const fieldName = escapeQuotes(String(name || ''))
    if (typeof value === 'string') {
      chunks.push(
        encodeText(`--${boundary}\r\nContent-Disposition: form-data; name="${fieldName}"\r\n\r\n${value}\r\n`)
      )
      continue
    }

    // File / Blob
    const anyVal: any = value as any
    const filename = escapeQuotes(String(anyVal?.name || 'file'))
    const contentType = String(anyVal?.type || 'application/octet-stream')
    chunks.push(
      encodeText(
        `--${boundary}\r\nContent-Disposition: form-data; name="${fieldName}"; filename="${filename}"\r\nContent-Type: ${contentType}\r\n\r\n`
      )
    )
    try {
      const buf = await (value as Blob).arrayBuffer()
      chunks.push(new Uint8Array(buf))
    } catch {
      // If blob can't be read, keep empty; server will fail with a clearer message.
    }
    chunks.push(encodeText(`\r\n`))
  }

  chunks.push(encodeText(`--${boundary}--\r\n`))
  const body = concatUint8(chunks)
  return { body, contentType: `multipart/form-data; boundary=${boundary}` }
}

const getApiKey = () => {
  try {
    return localStorage.getItem('apiKey') || ''
  } catch {
    return ''
  }
}

const isAbsolute = (url: string) => /^https?:\/\//i.test(url)

// 检测是否在开发环境（Vite dev server）
const isDev = typeof import.meta !== 'undefined' && import.meta.env?.DEV === true

// 在开发环境的浏览器中使用 Vite 代理（非 Tauri），其他情况使用直接请求
const useViteProxy = isDev && !isTauri

export const resolveEndpointUrl = (endpoint: string) => {
  const ep = String(endpoint || '').trim()
  if (!ep) return DEFAULT_API_BASE_URL
  
  // 如果已经是绝对 URL
  if (isAbsolute(ep)) {
    // 在开发环境（非 Tauri）下，将 nexusapi.cn 的请求转换为相对路径，走 Vite 代理绕过 CORS
    if (useViteProxy && ep.includes('nexusapi.cn')) {
      try {
        const u = new URL(ep)
        // 返回相对路径，让 Vite 代理处理
        return u.pathname + u.search
      } catch {
        return ep
      }
    }
    return ep
  }
  
  // 相对路径处理
  if (useViteProxy) {
    // 开发环境（非 Tauri）：返回相对路径，走 Vite 代理
    // 如果路径已经以特定前缀开头（如 /tencent-vod, /kling, /v1beta, /v1/），不再添加 /v1
    // 注意：/video/ 需要 /v1 前缀（如 /v1/video/create），不要加入此列表
    const noV1Prefixes = ['/tencent-vod', '/kling', '/v1beta', '/v1/']
    const path = ep.startsWith('/') ? ep : `/${ep}`
    if (noV1Prefixes.some(p => path.startsWith(p))) {
      return path
    }
    return `/v1${path}`
  }
  
  // 生产环境或 Tauri 环境：拼接完整 URL
  const path = ep.startsWith('/') ? ep : `/${ep}`
  
  // 不需要添加 /v1 的路径前缀（与 Web 环境保持一致）
  // 这些路径直接使用 origin，不使用包含 /v1 的 base URL
  // 注意：/video/ 需要 /v1 前缀（如 /v1/video/create），不要加入此列表
  const noV1Prefixes = ['/tencent-vod', '/kling', '/v1beta', '/v1/']
  
  if (noV1Prefixes.some(p => path.startsWith(p))) {
    try {
      const origin = new URL(DEFAULT_API_BASE_URL).origin
      return `${origin}${path}`
    } catch {
      // fallback
    }
  }
  
  const base = DEFAULT_API_BASE_URL.replace(/\/$/, '')
  return `${base}${path}`
}

export const postJson = async <T,>(endpoint: string, body: any, opts?: { authMode?: AuthMode; timeoutMs?: number }) => {
  const url0 = resolveEndpointUrl(endpoint)
  const authMode = opts?.authMode
  const apiKey = getApiKey()
  // query 模式（Gemini v1beta）支持 x-goog-api-key header；避免把 key 放在 URL 里（更安全，也减少代理日志泄露风险）
  const url = url0

  // 详细日志：确认实际请求 URL
  console.log('[postJson] 请求详情:', {
    inputEndpoint: endpoint,
    resolvedUrl: url0,
    finalUrl: url,
    authMode,
    hasApiKey: !!apiKey,
    bodyKeys: Object.keys(body || {}),
    isTauri
  })

  // Tauri 环境下增加重试次数（502 错误在 Tauri 中更常见）
  const maxRetries = isTauri ? 3 : 2
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    // Tauri HTTP 插件在某些平台（特别是 Windows）上对 AbortController 支持不完善
    // 因此只在非 Tauri 环境或明确设置超时时使用 signal
    const timeoutMs = Number(opts?.timeoutMs || 0)
    const useSignal = !isTauri && timeoutMs > 0
    const controller = useSignal ? new AbortController() : null
    const t = useSignal ? window.setTimeout(() => {
      try { controller?.abort() } catch { /* ignore */ }
    }, timeoutMs) : null

    try {
      const fetchOptions: RequestInit = {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
          ...(authMode === 'query' && apiKey ? { 'x-goog-api-key': apiKey } : {}),
          ...(authMode !== 'query' && apiKey ? { Authorization: `Bearer ${apiKey}` } : {})
        },
        body: JSON.stringify(body || {})
      }
      // 只在非 Tauri 环境下使用 signal（避免 Windows Tauri 兼容性问题）
      if (useSignal) {
        fetchOptions.signal = controller!.signal
      }
      const res = await safeFetch(url, fetchOptions)

      if (res.ok) {
        try {
          return (await res.json()) as T
        } catch (e: any) {
          // JSON 解析失败：在 Tauri 环境下可能是响应被截断或格式问题，应该重试
          const errMsg = String(e?.message || e || '')
          const isRetryableJsonError = /did not match|expected pattern|Unexpected/i.test(errMsg)
          if (isTauri && attempt < maxRetries && isRetryableJsonError) {
            const wait = get502BackoffMs(attempt)
            console.warn('[postJson] Tauri JSON 解析失败，准备重试:', { 
              attempt: attempt + 1, 
              waitMs: wait, 
              error: errMsg.slice(0, 100) 
            })
            await sleep(wait)
            continue
          }
          throw new Error(`响应解析失败（JSON）：${errMsg}`)
        }
      }

      const text = await res.text().catch(() => '')
      // 尝试解析 JSON 错误响应
      let errorMsg = `HTTP ${res.status}`
      try {
        const errJson = JSON.parse(text)
        // 优先提取嵌套的 error 字段（如 {error: "消息"} 或 {error: {message: "消息"}}）
        const extractedError = typeof errJson?.error === 'string' 
          ? errJson.error 
          : errJson?.error?.message || errJson?.message || errJson?.detail
        errorMsg = extractedError || text || errorMsg
      } catch {
        errorMsg = summarizeErrorBody(res, text) || errorMsg
      }

      const shouldRetry = attempt < maxRetries && isRetryableStatus(res.status)
      if (shouldRetry) {
        // 502 Bad Gateway 使用更长的退避时间
        let wait = res.status === 502 ? get502BackoffMs(attempt) : backoffMs(attempt)
        const retryAfter = getRetryAfterMs(res)
        if (retryAfter > 0) wait = Math.max(wait, retryAfter)
        console.warn('[postJson] 可重试失败，准备重试:', { 
          status: res.status, 
          attempt: attempt + 1, 
          waitMs: wait,
          isTauri,
          endpoint: endpoint.slice(0, 50)
        })
        await sleep(wait)
        continue
      }

      console.error('[postJson] 请求失败:', { status: res.status, errorMsg, isTauri })
      throw new Error(errorMsg)
    } catch (err: any) {
      // AbortError 通常表示超时；默认不自动重试，避免重复扣费/生成
      const name = String(err?.name || '')
      if (name === 'AbortError' && timeoutMs > 0) {
        throw new Error(`请求超时（${Math.round(timeoutMs / 1000)} 秒）。请稍后重试或检查网络/后端服务是否可用。`)
      }
      const shouldRetry = attempt < maxRetries && name !== 'AbortError' && isRetryableError(err)
      if (shouldRetry) {
        const wait = backoffMs(attempt)
        console.warn('[postJson] 网络/代理错误，准备重试:', { attempt: attempt + 1, waitMs: wait, message: String(err?.message || err) })
        await sleep(wait)
        continue
      }
      throw err
    } finally {
      if (t) window.clearTimeout(t)
    }
  }

  // 理论上不会到达这里
  throw new Error('postJson failed')
}

export const postFormData = async <T,>(endpoint: string, body: FormData, opts?: { authMode?: AuthMode; timeoutMs?: number }) => {
  const url0 = resolveEndpointUrl(endpoint)
  const authMode = opts?.authMode
  const apiKey = getApiKey()
  const url = url0

  // FormData 日志
  console.log('[postFormData] 请求详情:', {
    inputEndpoint: endpoint,
    resolvedUrl: url0,
    finalUrl: url,
    authMode,
    hasApiKey: !!apiKey,
    formDataKeys: [...body.keys()],
    isTauri
  })

  // Tauri 环境下增加重试次数
  const maxRetries = isTauri ? 3 : 2
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const timeoutMs = Number(opts?.timeoutMs || 0)
    const useSignal = !isTauri && timeoutMs > 0
    const controller = useSignal ? new AbortController() : null
    const t = useSignal ? window.setTimeout(() => {
      try { controller?.abort() } catch { /* ignore */ }
    }, timeoutMs) : null

    try {
      // In Tauri: convert FormData to multipart bytes for maximum compatibility (especially Windows).
      const multipart = isTauri ? await formDataToMultipartBody(body) : null
      const fetchOptions: RequestInit = {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          ...(multipart ? { 'Content-Type': multipart.contentType } : {}),
          ...(authMode === 'query' && apiKey ? { 'x-goog-api-key': apiKey } : {}),
          ...(authMode !== 'query' && apiKey ? { Authorization: `Bearer ${apiKey}` } : {})
        },
        body: (multipart ? (multipart.body as any) : body) as any
      }
      if (useSignal) {
        fetchOptions.signal = controller!.signal
      }
      const res = await safeFetch(url, fetchOptions)

      if (res.ok) {
        try {
          return (await res.json()) as T
        } catch (e: any) {
          // JSON 解析失败：在 Tauri 环境下可能是响应被截断或格式问题，应该重试
          const errMsg = String(e?.message || e || '')
          const isRetryableJsonError = /did not match|expected pattern|Unexpected/i.test(errMsg)
          if (isTauri && attempt < maxRetries && isRetryableJsonError) {
            const wait = get502BackoffMs(attempt)
            console.warn('[postFormData] Tauri JSON 解析失败，准备重试:', { 
              attempt: attempt + 1, 
              waitMs: wait, 
              error: errMsg.slice(0, 100) 
            })
            await sleep(wait)
            continue
          }
          throw new Error(`响应解析失败（JSON）：${errMsg}`)
        }
      }

      const text = await res.text().catch(() => '')
      let errorMsg = `HTTP ${res.status}`
      try {
        const errJson = JSON.parse(text)
        // 与 postJson 保持一致的错误处理
        const extractedError = typeof errJson?.error === 'string' 
          ? errJson.error 
          : errJson?.error?.message || errJson?.message || errJson?.detail
        errorMsg = extractedError || text || errorMsg
      } catch {
        errorMsg = summarizeErrorBody(res, text) || errorMsg
      }

      const shouldRetry = attempt < maxRetries && isRetryableStatus(res.status)
      if (shouldRetry) {
        // 502 Bad Gateway 使用更长的退避时间
        let wait = res.status === 502 ? get502BackoffMs(attempt) : backoffMs(attempt)
        const retryAfter = getRetryAfterMs(res)
        if (retryAfter > 0) wait = Math.max(wait, retryAfter)
        console.warn('[postFormData] 可重试失败，准备重试:', { 
          status: res.status, 
          attempt: attempt + 1, 
          waitMs: wait,
          isTauri,
          endpoint: endpoint.slice(0, 50)
        })
        await sleep(wait)
        continue
      }

      console.error('[postFormData] 请求失败:', { status: res.status, errorMsg, isTauri })
      throw new Error(errorMsg)
    } catch (err: any) {
      const name = String(err?.name || '')
      if (name === 'AbortError' && timeoutMs > 0) {
        throw new Error(`请求超时（${Math.round(timeoutMs / 1000)} 秒）。请稍后重试或检查网络/后端服务是否可用。`)
      }
      const shouldRetry = attempt < maxRetries && name !== 'AbortError' && isRetryableError(err)
      if (shouldRetry) {
        const wait = backoffMs(attempt)
        console.warn('[postFormData] 网络/代理错误，准备重试:', { attempt: attempt + 1, waitMs: wait, message: String(err?.message || err) })
        await sleep(wait)
        continue
      }
      throw err
    } finally {
      if (t) window.clearTimeout(t)
    }
  }

  throw new Error('postFormData failed')
}

export const getJson = async <T,>(endpoint: string, query?: Record<string, any>, opts?: { authMode?: AuthMode; timeoutMs?: number }) => {
  const url0 = resolveEndpointUrl(endpoint)
  const authMode = opts?.authMode
  const apiKey = getApiKey()
  const qs = new URLSearchParams()
  for (const [k, v] of Object.entries(query || {})) {
    if (v === undefined || v === null || v === '') continue
    qs.set(k, String(v))
  }

  const url = qs.toString() ? `${url0}${url0.includes('?') ? '&' : '?'}${qs.toString()}` : url0

  // Tauri 环境下增加重试次数（轮询视频状态时 502 更常见）
  const maxRetries = isTauri ? 3 : 2
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const timeoutMs = Number(opts?.timeoutMs || 0)
    const useSignal = !isTauri && timeoutMs > 0
    const controller = useSignal ? new AbortController() : null
    const t = useSignal ? window.setTimeout(() => {
      try { controller?.abort() } catch { /* ignore */ }
    }, timeoutMs) : null

    try {
      const fetchOptions: RequestInit = {
        method: 'GET',
        headers: {
          Accept: 'application/json',
          ...(authMode === 'query' && apiKey ? { 'x-goog-api-key': apiKey } : {}),
          ...(authMode !== 'query' && apiKey ? { Authorization: `Bearer ${apiKey}` } : {})
        }
      }
      if (useSignal) {
        fetchOptions.signal = controller!.signal
      }
      const res = await safeFetch(url, fetchOptions)

      if (res.ok) {
        try {
          return (await res.json()) as T
        } catch (e: any) {
          // JSON 解析失败：在 Tauri 环境下可能是响应被截断或格式问题，应该重试
          const errMsg = String(e?.message || e || '')
          const isRetryableJsonError = /did not match|expected pattern|Unexpected/i.test(errMsg)
          if (isTauri && attempt < maxRetries && isRetryableJsonError) {
            const wait = get502BackoffMs(attempt)
            console.warn('[getJson] Tauri JSON 解析失败，准备重试:', { 
              attempt: attempt + 1, 
              waitMs: wait, 
              error: errMsg.slice(0, 100) 
            })
            await sleep(wait)
            continue
          }
          throw new Error(`响应解析失败（JSON）：${errMsg}`)
        }
      }

      const text = await res.text().catch(() => '')
      // 与 postJson 保持一致的错误处理
      let errorMsg = `HTTP ${res.status}`
      try {
        const errJson = JSON.parse(text)
        // 优先提取嵌套的 error 字段
        const extractedError = typeof errJson?.error === 'string' 
          ? errJson.error 
          : errJson?.error?.message || errJson?.message || errJson?.detail
        errorMsg = extractedError || text || errorMsg
      } catch {
        errorMsg = summarizeErrorBody(res, text) || errorMsg
      }

      const shouldRetry = attempt < maxRetries && isRetryableStatus(res.status)
      if (shouldRetry) {
        // 502 Bad Gateway 使用更长的退避时间
        let wait = res.status === 502 ? get502BackoffMs(attempt) : backoffMs(attempt)
        const retryAfter = getRetryAfterMs(res)
        if (retryAfter > 0) wait = Math.max(wait, retryAfter)
        console.warn('[getJson] 可重试失败，准备重试:', { 
          url: url.slice(0, 100), 
          status: res.status, 
          attempt: attempt + 1, 
          waitMs: wait,
          isTauri,
          errorPreview: errorMsg.slice(0, 100)
        })
        await sleep(wait)
        continue
      }
      console.error('[getJson] 请求失败:', { url: url.slice(0, 100), status: res.status, errorMsg: errorMsg.slice(0, 200), isTauri })
      throw new Error(errorMsg)
    } catch (err: any) {
      const name = String(err?.name || '')
      if (name === 'AbortError' && timeoutMs > 0) {
        throw new Error(`请求超时（${Math.round(timeoutMs / 1000)} 秒）。请稍后重试或检查网络/后端服务是否可用。`)
      }
      const shouldRetry = attempt < maxRetries && name !== 'AbortError' && isRetryableError(err)
      if (shouldRetry) {
        const wait = backoffMs(attempt)
        console.warn('[getJson] 网络/代理错误，准备重试:', { attempt: attempt + 1, waitMs: wait, message: String(err?.message || err) })
        await sleep(wait)
        continue
      }
      throw err
    } finally {
      if (t) window.clearTimeout(t)
    }
  }

  throw new Error('getJson failed')
}
