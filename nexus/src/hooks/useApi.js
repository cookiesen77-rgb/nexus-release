/**
 * API Hooks | API Hooks
 * Simplified hooks for open source version | 开源版简化 hooks
 */

import { ref, reactive, onUnmounted } from 'vue'
import {
  generateImage,
  createVideoTask,
  getVideoTaskStatus,
  createMusicTask,
  fetchMusicTask,
  streamChatCompletions,
  createResponse,
  extractTextFromResponses,
  streamResponses
} from '@/api'
import { getModelByName, DEFAULT_CHAT_MODEL, DEFAULT_IMAGE_MODEL, DEFAULT_VIDEO_MODEL } from '@/config/models'
import { request, DEFAULT_API_BASE_URL } from '@/utils'
import { enhanceApiError } from '@/utils/errorResolver'
import { useApiConfig } from './useApiConfig'
import { fetch as tauriFetch } from '@tauri-apps/plugin-http'

// 检测 Tauri 环境
const isTauri = typeof window !== 'undefined' && !!window.__TAURI_INTERNALS__

// 根据环境选择 fetch 实现（Windows Tauri 必须用插件 fetch）
const safeFetch = isTauri ? tauriFetch : globalThis.fetch

/**
 * Base API state hook | 基础 API 状态 Hook
 */
export const useApiState = () => {
  const loading = ref(false)
  const error = ref(null)
  const status = ref('idle')

  const reset = () => {
    loading.value = false
    error.value = null
    status.value = 'idle'
  }

  const setLoading = (isLoading) => {
    loading.value = isLoading
    status.value = isLoading ? 'running' : status.value
  }

  const setError = (err) => {
    error.value = err
    status.value = 'error'
    loading.value = false
  }

  const setSuccess = () => {
    status.value = 'success'
    loading.value = false
    error.value = null
  }

  return { loading, error, status, reset, setLoading, setError, setSuccess }
}

/**
 * Chat composable | 问答组合式函数
 */
export const useChat = (options = {}) => {
  const { loading, error, status, reset, setLoading, setError, setSuccess } = useApiState()

  const messages = ref([])
  const currentResponse = ref('')
  let abortController = null
  const makeId = () => {
    const uuid = globalThis.crypto?.randomUUID?.()
    return uuid || `msg_${Date.now()}_${Math.random().toString(16).slice(2)}`
  }

  const append = (role, content, extra = {}) => {
    const item = {
      id: makeId(),
      role,
      content: typeof content === 'string' ? content : String(content || ''),
      createdAt: Date.now(),
      ...extra
    }
    messages.value = [...messages.value, item]
    return item.id
  }

  const resolveExtras = (override = {}) => {
    const base = typeof options.getRequestExtras === 'function'
      ? options.getRequestExtras()
      : (options.requestExtras || {})
    const merged = { ...(base || {}), ...(override || {}) }
    return Object.fromEntries(Object.entries(merged).filter(([, v]) => v !== undefined))
  }

  const buildMessageList = async (content) => {
    const baseList = [...messages.value]
    if (typeof options.buildMessages === 'function') {
      const built = await options.buildMessages({
        content,
        messages: baseList,
        systemPrompt: options.systemPrompt || ''
      })
      if (Array.isArray(built) && built.length > 0) return built
    }

    return [
      ...(options.systemPrompt ? [{ role: 'system', content: options.systemPrompt }] : []),
      ...baseList.map(m => ({ role: m.role, content: m.content })),
      { role: 'user', content }
    ]
  }

  const send = async (content, stream = true, requestOverrides = {}) => {
    setLoading(true)
    currentResponse.value = ''

    try {
      const modelKey = options.model || DEFAULT_CHAT_MODEL
      const modelConfig = getModelByName(modelKey)

      const msgList = await buildMessageList(content)
      append('user', content)

      // Gemini 原生格式：不走流式，使用 generateContent
      if (modelConfig?.format === 'gemini-chat') {
        const result = await sendGeminiChat(msgList, modelConfig, options.systemPrompt)
        append('assistant', result)
        currentResponse.value = result
        setSuccess()
        return result
      }

      // Responses API（gpt-5 系列等）
      if (modelConfig?.format === 'openai-responses') {
        if (stream) {
          status.value = 'streaming'
          abortController = new AbortController()
          let fullResponse = ''
          const assistantId = append('assistant', '', { streaming: true })

          for await (const chunk of streamResponses(
            { model: modelKey, input: msgList },
            abortController.signal
          )) {
            fullResponse += chunk
            currentResponse.value = fullResponse
            const idx = messages.value.findIndex(m => m.id === assistantId)
            if (idx !== -1) {
              messages.value[idx] = { ...messages.value[idx], content: fullResponse }
              messages.value = messages.value.slice()
            }
          }

          const idx = messages.value.findIndex(m => m.id === assistantId)
          if (idx !== -1) {
            messages.value[idx] = { ...messages.value[idx], content: fullResponse, streaming: false }
            messages.value = messages.value.slice()
          } else {
            append('assistant', fullResponse)
          }
          setSuccess()
          return fullResponse
        }

        const resp = await createResponse({ model: modelKey, input: msgList })
        const text = extractTextFromResponses(resp)
        append('assistant', text)
        currentResponse.value = text
        setSuccess()
        return text
      }

      if (stream) {
        status.value = 'streaming'
        abortController = new AbortController()
        let fullResponse = ''
        const assistantId = append('assistant', '', { streaming: true })

        const extras = resolveExtras(requestOverrides)
        const payload = Object.keys(extras).length > 0
          ? { model: modelKey, messages: msgList, ...extras }
          : { model: modelKey, messages: msgList }

        for await (const chunk of streamChatCompletions(payload, abortController.signal)) {
          fullResponse += chunk
          currentResponse.value = fullResponse
          const idx = messages.value.findIndex(m => m.id === assistantId)
          if (idx !== -1) {
            messages.value[idx] = { ...messages.value[idx], content: fullResponse }
            messages.value = messages.value.slice()
          }
        }

        const idx = messages.value.findIndex(m => m.id === assistantId)
        if (idx !== -1) {
          messages.value[idx] = { ...messages.value[idx], content: fullResponse, streaming: false }
          messages.value = messages.value.slice()
        } else {
          append('assistant', fullResponse)
        }
        setSuccess()
        return fullResponse
      }
    } catch (err) {
      if (err.name !== 'AbortError') {
        setError(err)
        throw err
      }
    }
  }

  const stop = () => {
    if (abortController) {
      abortController.abort()
      abortController = null
    }
  }

  const clear = () => {
    messages.value = []
    currentResponse.value = ''
    reset()
  }

  onUnmounted(() => stop())

  return { loading, error, status, messages, currentResponse, send, stop, clear, reset, append }
}

/**
 * Gemini generateContent 聊天 | 非流式
 */
const sendGeminiChat = async (messages, modelConfig, systemPrompt) => {
  const contents = messages
    .filter(m => m.role !== 'system')
    .map(m => ({
      role: m.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: m.content }]
    }))

  const payload = {
    contents
  }

  if (systemPrompt) {
    payload.systemInstruction = { parts: [{ text: systemPrompt }] }
  }

  const rsp = await request({
    url: modelConfig?.endpoint || 'https://nexusapi.cn/v1beta/models/gemini-3-pro-preview:generateContent',
    method: 'post',
    data: payload,
    authMode: modelConfig?.authMode || 'query'
  })

  const parts = rsp?.candidates?.[0]?.content?.parts || []
  const text = parts.map(p => p.text).filter(Boolean).join('') || ''
  return text
}

const parseBase64DataUrl = (dataUrl) => {
  if (typeof dataUrl !== 'string') return null
  const match = dataUrl.match(/^data:(.+?);base64,(.+)$/)
  if (!match) return null
  return { mimeType: match[1], data: match[2] }
}

const IMAGE_REQUEST_TIMEOUT = 120000

const buildApiUrl = (endpoint) => {
  if (!endpoint) return ''
  if (/^https?:\/\//i.test(endpoint)) return endpoint
  
  const path = endpoint.startsWith('/') ? endpoint : `/${endpoint}`
  
  // 不需要添加 /v1 的路径前缀
  const noV1Prefixes = ['/tencent-vod', '/kling', '/v1beta', '/v1/', '/video/']
  if (noV1Prefixes.some(p => path.startsWith(p))) {
    try {
      const origin = new URL(DEFAULT_API_BASE_URL).origin
      return `${origin}${path}`
    } catch {
      // fallback
    }
  }
  
  const base = (DEFAULT_API_BASE_URL || '').replace(/\/$/, '')
  if (!base) return endpoint
  return `${base}${path}`
}

const fetchJson = async (url, { authMode } = {}) => {
  if (!url) return { ok: false, status: 0, data: null }
  const apiKey = localStorage.getItem('apiKey') || ''
  let finalUrl = url
  const headers = {}

  if (authMode === 'query' && apiKey) {
    const hasQuery = finalUrl.includes('?')
    finalUrl = `${finalUrl}${hasQuery ? '&' : '?'}key=${encodeURIComponent(apiKey)}`
  } else if (apiKey) {
    headers.Authorization = `Bearer ${apiKey}`
  }

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 20000)

  try {
    // Tauri 环境不使用 signal（Windows 兼容性问题）
    const fetchOptions = { method: 'GET', headers }
    if (!isTauri) {
      fetchOptions.signal = controller.signal
    }
    const res = await safeFetch(finalUrl, fetchOptions)
    const data = await res.json().catch(() => null)
    return { ok: res.ok, status: res.status, data }
  } catch {
    return { ok: false, status: 0, data: null }
  } finally {
    clearTimeout(timeout)
  }
}

const extractTaskIdFromResponse = (resp) => {
  return (
    resp?.data?.task_id ||
    resp?.data?.id ||
    resp?.task_id ||
    resp?.id ||
    resp?.data?.data?.task_id ||
    resp?.data?.taskId ||
    resp?.taskId
  )
}

const extractStatusUrlFromResponse = (resp) => {
  return (
    resp?.data?.status_url ||
    resp?.data?.statusUrl ||
    resp?.status_url ||
    resp?.statusUrl ||
    resp?.data?.result_url ||
    resp?.result_url ||
    resp?.data?.query_url ||
    resp?.query_url
  )
}

const pollImageTask = async (taskId, { endpoint, authMode, statusUrl, maxAttempts = 120, interval = 3000, onDebug } = {}) => {
  const urls = []
  if (statusUrl) urls.push(statusUrl)
  const base = (endpoint || '').replace(/\/$/, '')
  if (base && taskId) {
    urls.push(`${base}/${taskId}`)
    urls.push(`${base}/${taskId}/result`)
    urls.push(`${base}/${taskId}/results`)
    urls.push(`${base}?id=${encodeURIComponent(taskId)}`)
    urls.push(`${base}/query?id=${encodeURIComponent(taskId)}`)
    urls.push(`${base}/query/${encodeURIComponent(taskId)}`)
    urls.push(`${base}/status/${encodeURIComponent(taskId)}`)
    urls.push(`${base}/result/${encodeURIComponent(taskId)}`)
    urls.push(`${base}/results/${encodeURIComponent(taskId)}`)
  }

  const candidateUrls = urls
    .map(buildApiUrl)
    .filter(Boolean)

  if (candidateUrls.length === 0) {
    throw new Error('生图任务查询失败：未找到可用的查询地址')
  }

  for (let i = 0; i < maxAttempts; i++) {
    for (const url of candidateUrls) {
      const { ok, status, data } = await fetchJson(url, { authMode })
      if (onDebug) onDebug('poll_response', { url, ok, status, data })
      if (!ok && status === 404) continue

      const urls = extractUrlsDeep(data)
      if (urls.length > 0) {
        return urls.map(u => ({ url: u, revisedPrompt: '' }))
      }

      const statusText = (
        data?.status ||
        data?.data?.status ||
        data?.task_status ||
        data?.data?.task_status ||
        data?.state ||
        data?.data?.state ||
        ''
      ).toString().toLowerCase()

      if (statusText && /(fail|error|rejected|canceled)/i.test(statusText)) {
        throw new Error(data?.message || data?.error?.message || '生图任务失败')
      }
    }

    await new Promise(r => setTimeout(r, interval))
  }

  throw new Error('生图任务超时')
}

const base64ToBlob = (base64Data, mimeType = 'application/octet-stream') => {
  if (typeof base64Data !== 'string' || base64Data.length === 0) return null
  const binary = atob(base64Data)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return new Blob([bytes], { type: mimeType })
}

const toDataUrl = (base64Data, mimeType = 'application/octet-stream') => {
  if (!base64Data) return ''
  if (typeof base64Data !== 'string') return ''
  const trimmed = base64Data.trim()
  // If already a data URL, keep as-is | 已经是 dataURL 则原样返回
  if (trimmed.startsWith('data:')) return trimmed
  // Remove whitespace/newlines (some gateways insert line breaks) | 去除空白/换行
  const cleaned = trimmed.replace(/\s+/g, '')
  return `data:${mimeType};base64,${cleaned}`
}

const blobToDataUrl = (blob) => {
  if (!blob) return Promise.resolve('')
  return new Promise((resolve, reject) => {
    try {
      const reader = new FileReader()
      reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : '')
      reader.onerror = () => reject(reader.error || new Error('图片读取失败'))
      reader.readAsDataURL(blob)
    } catch (err) {
      reject(err)
    }
  })
}

const resolveImageToInlineData = async (value) => {
  if (!value || typeof value !== 'string') return null

  const parsed = parseBase64DataUrl(value)
  if (parsed) return { mimeType: parsed.mimeType, data: parsed.data }

  // Raw base64 string (best-effort) | 纯 base64（兜底）
  if (!value.startsWith('http') && !value.startsWith('blob:') && value.length > 1024) {
    return { mimeType: 'image/png', data: value }
  }

  // URL/blob -> fetch -> blob -> base64 | URL/blob 读取为 base64
  const blob = await resolveImageToBlob(value)
  const dataUrl = await blobToDataUrl(blob)
  const parsed2 = parseBase64DataUrl(dataUrl)
  if (!parsed2) return null
  return { mimeType: parsed2.mimeType, data: parsed2.data }
}

const resolveImageToBlob = async (value) => {
  if (!value) return null
  if (typeof value !== 'string') return null

  const parsed = parseBase64DataUrl(value)
  if (parsed) {
    return base64ToBlob(parsed.data, parsed.mimeType)
  }

  // Raw base64 string (best-effort) | 纯 base64（兜底）
  if (!value.startsWith('http') && !value.startsWith('blob:') && value.length > 1024) {
    return base64ToBlob(value, 'image/png')
  }

  // blob: / http(s) URL -> fetch to blob | blob: 或 http(s) 拉取为 blob
  try {
    // blob: URL 使用原生 fetch，HTTP URL 使用 safeFetch
    const useFetch = value.startsWith('blob:') ? globalThis.fetch : safeFetch
    const res = await useFetch(value)
    if (!res.ok) throw new Error(`无法读取图片资源：${res.status}`)
    return await res.blob()
  } catch (err) {
    throw new Error('图片输入需要使用可读取的 URL 或 DataURL（建议使用 DataURL/base64）')
  }
}

const objectToFormData = (obj) => {
  const fd = new FormData()
  for (const [k, v] of Object.entries(obj || {})) {
    if (v === undefined || v === null || v === '') continue
    if (Array.isArray(v)) {
      fd.append(k, JSON.stringify(v))
    } else {
      fd.append(k, v)
    }
  }
  return fd
}

/**
 * Image generation composable | 图片生成组合式函数
 * Simplified for open source - fixed input/output format
 */
export const useImageGeneration = () => {
  const { loading, error, status, reset, setLoading, setError, setSuccess } = useApiState()

  const images = ref([])
  const currentImage = ref(null)

  const shouldDebugImage = () => {
    try {
      return localStorage.getItem('nexus-debug-image') === '1'
    } catch {
      return false
    }
  }

  const sanitizeDebugValue = (value, depth = 2) => {
    if (depth <= 0) return Array.isArray(value) ? '[array]' : typeof value === 'object' ? '[object]' : value
    if (typeof value === 'string') {
      if (value.startsWith('data:')) return `[dataurl:${value.length}]`
      if (value.length > 260) return `${value.slice(0, 120)}…[len:${value.length}]`
      return value
    }
    if (Array.isArray(value)) return value.slice(0, 6).map(v => sanitizeDebugValue(v, depth - 1))
    if (value && typeof value === 'object') {
      const next = {}
      for (const [k, v] of Object.entries(value)) {
        next[k] = sanitizeDebugValue(v, depth - 1)
      }
      return next
    }
    return value
  }

  const debugImage = (stage, payload) => {
    if (!shouldDebugImage()) return
    const entry = { ts: Date.now(), stage, payload: sanitizeDebugValue(payload) }
    const target = window
    if (!target.__nexusImageDebug) target.__nexusImageDebug = []
    target.__nexusImageDebug.push(entry)
    if (target.__nexusImageDebug.length > 60) {
      target.__nexusImageDebug.shift()
    }
    console.warn('[image-debug]', entry)
  }

  const isLikelyBase64 = (value) => {
    if (typeof value !== 'string') return false
    const trimmed = value.trim()
    if (!trimmed || trimmed.startsWith('http') || trimmed.startsWith('data:') || trimmed.startsWith('blob:')) return false
    if (trimmed.length < 256) return false
    return /^[A-Za-z0-9+/=]+$/.test(trimmed)
  }

  const normalizeToImageList = (response) => {
    const data = response?.data || response
    const list = Array.isArray(data?.data)
      ? data.data
      : (Array.isArray(data) ? data : (data && typeof data === 'object' ? [data] : []))
    return list
      .map(item => {
        if (typeof item === 'string') return { url: item, revisedPrompt: '' }
        if (!item || typeof item !== 'object') return null
        const url = item.url || item.image_url || item.imageUrl || item.output_url || item.result_url
        const rawB64 = item.b64_json || item.base64 || item.b64 || item.image_base64 || item.imageBase64 || item.image
        const b64 = isLikelyBase64(rawB64) ? rawB64 : ''
        // Prefer persistent URL (http or data:) to avoid leaking blob: object URLs | 优先使用可持久化 url（避免 blob: 泄漏）
        const dataUrl = b64 ? toDataUrl(b64, 'image/png') : ''
        return {
          url: url || dataUrl,
          base64: '',
          revisedPrompt: item.revised_prompt || item.revisedPrompt || ''
        }
      })
      .filter(item => item && typeof item.url === 'string' && item.url)
  }

  const extractUrlsDeep = (payload) => {
    const urls = []
    const seen = new Set()
    const push = (val) => {
      if (typeof val !== 'string') return
      if (val.startsWith('http') || val.startsWith('data:')) {
        if (seen.has(val)) return
        seen.add(val)
        urls.push(val)
        return
      }
      if (isLikelyBase64(val)) {
        const dataUrl = toDataUrl(val, 'image/png')
        if (!dataUrl || seen.has(dataUrl)) return
        seen.add(dataUrl)
        urls.push(dataUrl)
      }
      return
    }

    const walk = (obj, depth = 0) => {
      if (!obj || depth > 5) return
      if (typeof obj === 'string') {
        push(obj)
        return
      }
      if (Array.isArray(obj)) {
        for (const it of obj) walk(it, depth + 1)
        return
      }
      if (typeof obj !== 'object') return

      // Common url-like keys
      for (const k of ['url', 'image_url', 'imageUrl', 'output_url', 'result_url']) {
        if (typeof obj[k] === 'string') push(obj[k])
      }

      for (const v of Object.values(obj)) walk(v, depth + 1)
    }

    walk(payload)
    return urls
  }

  const pollKlingImageTask = async (taskId, { endpoint, authMode, maxAttempts = 120, interval = 3000, onDebug } = {}) => {
    if (!taskId) throw new Error('未获取到 Kling 生图任务 ID')
    const statusUrl = `${endpoint.replace(/\/$/, '')}/${encodeURIComponent(String(taskId))}`

    for (let i = 0; i < maxAttempts; i++) {
      const result = await request({
        url: statusUrl,
        method: 'get',
        authMode
      })
      if (onDebug) onDebug('poll_response', { url: statusUrl, result })

      const urls = extractUrlsDeep(result)
      if (urls.length > 0) {
        return urls.map(u => ({ url: u, revisedPrompt: '' }))
      }

      const statusText = (result?.status || result?.data?.task_status || result?.data?.status || result?.task_status || '').toString().toLowerCase()
      if (statusText && /(fail|error)/i.test(statusText)) {
        throw new Error(result?.message || result?.error?.message || 'Kling 生图任务失败')
      }

      await new Promise(r => setTimeout(r, interval))
    }

    throw new Error('Kling 生图任务超时')
  }

  /**
   * Generate image with fixed params | 固定参数生成图片
   * @param {Object} params - { model, prompt, size, n, image (optional ref image) }
   */
  const generate = async (params) => {
    setLoading(true)
    images.value = []
    currentImage.value = null

    try {
      const modelKey = params.model || DEFAULT_IMAGE_MODEL
      const modelConfig = getModelByName(modelKey)
      
      if (!modelConfig) {
        throw new Error('未找到模型配置')
      }

      const requestTimeout = modelConfig.timeout || IMAGE_REQUEST_TIMEOUT
      let generatedImages = []

      switch (modelConfig.format) {
        case 'gemini-image': {
          const aspectRatio = params.size || modelConfig.defaultParams?.size || '1:1'
          const imageSize = params.quality || modelConfig.defaultParams?.quality || '2K'

          const requestParts = []
          if ((params.prompt || '').trim()) requestParts.push({ text: params.prompt })
          const imageInputs = Array.isArray(params.images)
            ? params.images
            : (params.image ? [params.image] : [])

          const maxImages = modelConfig.key === 'gemini-3-pro-image-preview' ? 14 : imageInputs.length
          const limitedInputs = maxImages < imageInputs.length
            ? imageInputs.slice(0, maxImages)
            : imageInputs

          if (imageInputs.length > maxImages) {
            window.$message?.warning?.(`参考图最多支持 ${maxImages} 张，已自动取前 ${maxImages} 张`)
          }

          let failedCount = 0
          for (const input of limitedInputs) {
            try {
              const inline = await resolveImageToInlineData(input)
              if (!inline) {
                failedCount++
                continue
              }
              requestParts.push({
                inline_data: {
                  mime_type: inline.mimeType,
                  data: inline.data
                }
              })
            } catch (err) {
              failedCount++
            }
          }

          if (imageInputs.length > 0 && requestParts.every(p => !p.inline_data)) {
            throw new Error('参考图无法读取：请优先使用“上传图片”生成 DataURL/base64；外链图片可能因跨域限制无法作为参考图发送')
          }

          if (failedCount > 0) {
            window.$message?.warning?.(`有 ${failedCount} 张参考图无法读取（可能跨域/格式不支持），已忽略`)
          }

          if (requestParts.length === 0) {
            throw new Error('请提供提示词或参考图')
          }

          const payload = {
            contents: [
              {
                role: 'user',
                parts: requestParts
              }
            ],
            generationConfig: {
              responseModalities: ['TEXT', 'IMAGE'],
              imageConfig: {
                aspectRatio,
                imageSize
              }
            }
          }

          debugImage('create_request', { format: modelConfig.format, endpoint: modelConfig.endpoint, payload })
          const rsp = await request({
            url: modelConfig.endpoint,
            method: 'post',
            data: payload,
            authMode: modelConfig.authMode,
            timeout: requestTimeout
          })
          debugImage('create_response', rsp)

          const responseParts = rsp?.candidates?.[0]?.content?.parts || []
          generatedImages = responseParts
            .map(p => p.inlineData || p.inline_data)
            .filter(Boolean)
            .map(img => ({
              url: toDataUrl(img.data, img.mimeType || img.mime_type || 'image/png'),
              base64: '',
              revisedPrompt: ''
            }))

          // 如果没有内联图片，则尝试文本内容
          if (generatedImages.length === 0) {
            const textParts = responseParts.map(p => p.text).filter(Boolean)
            generatedImages = textParts.map(t => ({ url: t, revisedPrompt: '' }))
            debugImage('parse_summary', {
              format: modelConfig.format,
              parts: responseParts.length,
              inlineCount: responseParts.filter(p => p.inlineData || p.inline_data).length,
              textCount: textParts.length
            })
          }
          break
        }
        case 'kling-image': {
          const aspectRatio = params.size || modelConfig.defaultParams?.size || '1:1'
          const resolution = params.quality || modelConfig.defaultParams?.quality || '1k'
          const n = params.n || modelConfig.defaultParams?.n || 1

          const imageInput = (Array.isArray(params.images) ? params.images[0] : (params.image || null))

          const requestData = {
            model_name: modelConfig.defaultParams?.model_name || 'kling-v2-1',
            prompt: params.prompt,
            n,
            aspect_ratio: aspectRatio,
            resolution
          }

          if (imageInput) requestData.image = imageInput

          debugImage('create_request', { format: modelConfig.format, endpoint: modelConfig.endpoint, requestData })
          const resp = await generateImage(requestData, {
            requestType: 'json',
            endpoint: modelConfig.endpoint,
            authMode: modelConfig.authMode,
            timeout: requestTimeout
          })
          debugImage('create_response', resp)

          // 1) 直接返回了 OpenAI 风格 data[].url / b64_json
          const direct = normalizeToImageList(resp)
          if (direct.length > 0) {
            generatedImages = direct
            break
          }

          // 2) 兜底：如果返回 task_id，则轮询 /kling/v1/images/generations/{id}
          const taskId =
            resp?.data?.task_id ||
            resp?.data?.id ||
            resp?.task_id ||
            resp?.id ||
            resp?.data?.data?.task_id

          if (!taskId) {
            // 最后兜底：深度提取 URL（少量实现会把结果埋在字段里）
            const urls = extractUrlsDeep(resp)
            if (urls.length > 0) {
              generatedImages = urls.map(u => ({ url: u, revisedPrompt: '' }))
              break
            }
            throw new Error('Kling 生图返回异常：未获取到图片或任务 ID')
          }

          generatedImages = await pollKlingImageTask(taskId, {
            endpoint: modelConfig.endpoint,
            authMode: modelConfig.authMode,
            onDebug: debugImage
          })
          break
        }
        case 'openai-image': {
          const requestData = {
            model: modelConfig.key,
            prompt: params.prompt,
            size: params.size || modelConfig.defaultParams?.size || '1024x1024'
          }

          requestData.n = params.n || 1

          debugImage('create_request', { format: modelConfig.format, endpoint: modelConfig.endpoint, requestData })
          const response = await generateImage(requestData, {
            requestType: 'json',
            endpoint: modelConfig.endpoint,
            authMode: modelConfig.authMode,
            timeout: requestTimeout
          })
          debugImage('create_response', response)
          generatedImages = normalizeToImageList(response)
          if (generatedImages.length === 0) {
            // Fallback: deep extract urls (covers nested image_url etc.)
            const urls = extractUrlsDeep(response)
            if (urls.length > 0) generatedImages = urls.map(u => ({ url: u, revisedPrompt: '' }))
            if (urls.length === 0) {
              const taskId = extractTaskIdFromResponse(response)
              const statusUrl = extractStatusUrlFromResponse(response)
              if (taskId || statusUrl) {
                generatedImages = await pollImageTask(taskId, {
                  endpoint: modelConfig.endpoint,
                  authMode: modelConfig.authMode,
                  statusUrl,
                  onDebug: debugImage
                })
              }
            }
          }
          break
        }
        case 'doubao-seedream': {
          const requestData = {
            model: modelConfig.key,
            prompt: params.prompt,
            size: params.size || modelConfig.defaultParams?.size || '2K',
            sequential_image_generation: modelConfig.defaultParams?.sequential_image_generation || 'disabled',
            response_format: modelConfig.defaultParams?.response_format || 'url',
            watermark: typeof modelConfig.defaultParams?.watermark === 'boolean' ? modelConfig.defaultParams.watermark : false,
            stream: false
          }

          debugImage('create_request', { format: modelConfig.format, endpoint: modelConfig.endpoint, requestData })
          const response = await generateImage(requestData, {
            requestType: 'json',
            endpoint: modelConfig.endpoint,
            authMode: modelConfig.authMode,
            timeout: requestTimeout
          })
          debugImage('create_response', response)

          const direct = normalizeToImageList(response)
          if (direct.length === 0) {
            const urls = extractUrlsDeep(response)
            if (urls.length > 0) {
              generatedImages = urls.map(u => ({ url: u, revisedPrompt: '' }))
            } else {
              const taskId = extractTaskIdFromResponse(response)
              const statusUrl = extractStatusUrlFromResponse(response)
              if (taskId || statusUrl) {
                generatedImages = await pollImageTask(taskId, {
                  endpoint: modelConfig.endpoint,
                  authMode: modelConfig.authMode,
                  statusUrl,
                  onDebug: debugImage
                })
              } else {
                throw new Error('豆包生图返回为空')
              }
            }
          } else {
            generatedImages = direct
          }
          break
        }
        case 'openai-image-edit': {
          const imageInput = params.image || (Array.isArray(params.images) ? params.images[0] : null)
          if (!imageInput) throw new Error('该模型需要上传图片')
          const requestData = {
            model: modelConfig.key,
            prompt: params.prompt,
            image: imageInput
          }
          debugImage('create_request', { format: modelConfig.format, endpoint: modelConfig.endpoint, requestData })
          const response = await generateImage(requestData, {
            requestType: 'json',
            endpoint: modelConfig.endpoint,
            authMode: modelConfig.authMode,
            timeout: requestTimeout
          })
          debugImage('create_response', response)
          generatedImages = normalizeToImageList(response)
          if (generatedImages.length === 0) {
            const urls = extractUrlsDeep(response)
            if (urls.length > 0) generatedImages = urls.map(u => ({ url: u, revisedPrompt: '' }))
            if (urls.length === 0) {
              const taskId = extractTaskIdFromResponse(response)
              const statusUrl = extractStatusUrlFromResponse(response)
              if (taskId || statusUrl) {
                generatedImages = await pollImageTask(taskId, {
                  endpoint: modelConfig.endpoint,
                  authMode: modelConfig.authMode,
                  statusUrl,
                  onDebug: debugImage
                })
              }
            }
          }
          break
        }
        case 'openai-chat-image': {
          const payload = {
            model: modelConfig.key,
            messages: [{ role: 'user', content: params.prompt }]
          }
          debugImage('create_request', { format: modelConfig.format, endpoint: modelConfig.endpoint, payload })
          const resp = await request({
            url: modelConfig.endpoint,
            method: 'post',
            data: payload,
            authMode: modelConfig.authMode
          })
          debugImage('create_response', resp)

          // Prefer deep URL extraction (covers {image_url:{url}}, nested structures, etc.)
          const urls = extractUrlsDeep(resp)
          if (urls.length > 0) {
            const first = urls[0]
            generatedImages = [{ url: first, base64: first.startsWith('data:') ? first : '', revisedPrompt: '' }]
            break
          }

          // Fallback to message.content parsing
          const msg = resp?.choices?.[0]?.message?.content
          const content = Array.isArray(msg)
            ? msg
                .map(m => {
                  if (!m) return ''
                  if (typeof m === 'string') return m
                  if (typeof m?.text === 'string') return m.text
                  const u = m?.image_url?.url || m?.image_url || m?.url
                  return typeof u === 'string' ? u : ''
                })
                .filter(Boolean)
                .join('\n')
            : (typeof msg === 'string' ? msg : '')

          const trimmed = (content || '').trim()
          const inlineMatch = trimmed.match(/data:image\/[a-zA-Z0-9.+-]+;base64,[A-Za-z0-9+/=]+/)
          if (inlineMatch?.[0]) {
            generatedImages = [{ url: inlineMatch[0], base64: inlineMatch[0], revisedPrompt: '' }]
            break
          }

          const httpMatch = trimmed.match(/https?:\/\/\S+/)
          if (httpMatch?.[0]) {
            generatedImages = [{ url: httpMatch[0], revisedPrompt: '' }]
            break
          }

          // Raw base64 (best-effort)
          if (trimmed && trimmed.length > 1024 && !trimmed.startsWith('http') && !trimmed.startsWith('blob:')) {
          const dataUrl = toDataUrl(trimmed, 'image/png')
          generatedImages = [{ url: dataUrl, base64: '', revisedPrompt: '' }]
          break
        }

          throw new Error('未从 Chat 返回中解析到图片结果（建议在提示词中要求模型仅输出图片 URL 或 dataURI）')
          break
        }
        case 'tencent-image': {
          const payload = {
            model: modelKey,
            prompt: params.prompt,
            version: modelConfig.defaultParams?.version,
            clarity: modelConfig.defaultParams?.clarity
          }
          debugImage('create_request', { format: modelConfig.format, endpoint: modelConfig.endpoint, payload })
          const resp = await request({
            url: modelConfig.endpoint,
            method: 'post',
            data: payload,
            authMode: modelConfig.authMode
          })
          debugImage('create_response', resp)
          const list = resp?.data || resp
          generatedImages = (Array.isArray(list) ? list : [list]).map(item => ({
            url: item.url || item.image_url || item,
            revisedPrompt: ''
          }))
          break
        }
        default:
          throw new Error('不支持的模型类型')
      }

      // Final sanitize: ensure url is a usable string | 最终兜底：保证 url 可用
      generatedImages = Array.isArray(generatedImages)
        ? generatedImages
            .map((it) => {
              if (!it || typeof it.url !== 'string') return null
              const trimmed = it.url.trim()
              if (!trimmed) return null
              // Raw base64 (best-effort) | 纯 base64 兜底
              if (!trimmed.startsWith('http') && !trimmed.startsWith('data:') && !trimmed.startsWith('blob:') && trimmed.length > 1024) {
                return { ...it, url: toDataUrl(trimmed, 'image/png') }
              }
              return { ...it, url: trimmed }
            })
            .filter(Boolean)
        : []

      images.value = generatedImages
      currentImage.value = generatedImages[0] || null
      setSuccess()
      return generatedImages
    } catch (err) {
      debugImage('create_error', {
        message: err?.message,
        status: err?.response?.status,
        data: err?.response?.data,
        code: err?.code,
        url: err?.config?.url
      })
      const enhanced = enhanceApiError(err, { modelKey: params?.model || DEFAULT_IMAGE_MODEL })
      setError(enhanced)
      throw enhanced
    }
  }

  return { loading, error, status, images, currentImage, generate, reset }
}

/**
 * Video generation composable | 视频生成组合式函数
 * Simplified for open source - fixed input/output format with polling
 */
export const useVideoGeneration = () => {
  const { loading, error, status, reset, setLoading, setError, setSuccess } = useApiState()

  const video = ref(null)
  const taskId = ref(null)
  const progress = reactive({
    attempt: 0,
    maxAttempts: 120,
    percentage: 0
  })

  /**
   * Generate video with fixed params | 固定参数生成视频
   * @param {Object} params - { model, prompt, first_frame_image, last_frame_image, ratio, duration }
   */
  const generate = async (params) => {
    setLoading(true)
    video.value = null
    taskId.value = null
    progress.attempt = 0
    progress.percentage = 0

    let modelConfig = null
    const modelKey = params.model || DEFAULT_VIDEO_MODEL

    try {
      modelConfig = getModelByName(modelKey)
      if (!modelConfig) throw new Error('未找到视频模型')
      
      const prompt = (params.prompt || '').trim()
      const ratio = params.ratio || modelConfig.defaultParams?.ratio || '16:9'
      const duration = params.dur || modelConfig.defaultParams?.duration

      const apiModel = modelConfig.key

      const extractVideoUrlDeep = (payload) => {
        const seen = new Set()
        const videoKeyUrls = []
        const otherUrls = []

        const push = (arr, val) => {
          if (typeof val !== 'string') return
          if (!val.startsWith('http')) return
          if (seen.has(val)) return
          seen.add(val)
          arr.push(val)
        }

        const walk = (obj, depth = 0) => {
          if (!obj || depth > 6) return
          if (typeof obj === 'string') {
            // 不知道语义时，严格：只把“像视频的 URL”当作候选
            if (/\\.(mp4|webm|mov|m4v|m3u8)(\\?|$)/i.test(obj)) push(otherUrls, obj)
            return
          }
          if (Array.isArray(obj)) {
            for (const it of obj) walk(it, depth + 1)
            return
          }
          if (typeof obj !== 'object') return

          // 强语义键：认为就是视频 URL（不强制后缀）
          for (const k of ['video_url', 'videoUrl']) {
            if (typeof obj[k] === 'string') push(videoKeyUrls, obj[k])
          }

          // 弱语义键：要求看起来像视频
          for (const k of ['url', 'result_url', 'output_url']) {
            if (typeof obj[k] === 'string' && /\\.(mp4|webm|mov|m4v|m3u8)(\\?|$)/i.test(obj[k])) {
              push(otherUrls, obj[k])
            }
          }

          for (const v of Object.values(obj)) walk(v, depth + 1)
        }

        walk(payload)
        return videoKeyUrls[0] || otherUrls[0] || ''
      }

      const collectImages = () => {
        const list = []
        if (params.first_frame_image) list.push(params.first_frame_image)
        if (params.last_frame_image) list.push(params.last_frame_image)
        if (Array.isArray(params.images)) list.push(...params.images)
        // Remove empty and de-dup | 去空+去重
        return Array.from(new Set(list.filter(Boolean)))
      }

      let requestType = 'json'
      let payload = null
      let endpointOverride = modelConfig?.endpoint
      let statusEndpointOverride = modelConfig?.statusEndpoint
      let statusParamsOverride = modelConfig?.statusParams

      if (modelConfig.format === 'openai-video') {
        // OpenAI 视频格式：必须提供垫图 input_reference（文件） | requires file
        if (!prompt) throw new Error('请输入提示词（prompt）')

        const inputCandidate = params.first_frame_image || (Array.isArray(params.images) ? params.images[0] : '')
        if (!inputCandidate) throw new Error('该视频模型需要垫图（请连接首帧/参考图）')

        const blob = await resolveImageToBlob(inputCandidate)
        if (!blob) throw new Error('垫图解析失败')

        const fd = new FormData()
        fd.append('model', apiModel)
        fd.append('prompt', prompt)
        if (duration) fd.append('seconds', String(duration))

        // Apifox：OpenAI 视频格式 size 使用像素（横版 1280x720 / 竖版 720x1280）
        const sizeValue = ratio === '9:16' ? '720x1280' : '1280x720'
        fd.append('size', sizeValue)

        const watermark = modelConfig.defaultParams?.watermark
        if (watermark !== undefined) fd.append('watermark', watermark ? 'true' : 'false')

        fd.append('input_reference', blob, 'input.png')
        requestType = 'formdata'
        payload = fd
      } else if (modelConfig.format === 'veo-unified' || modelConfig.format === 'sora-unified' || modelConfig.format === 'unified-video') {
        // 统一视频格式 | /v1/video/create（按 Apifox：不同模型参数不同）
        if (!prompt) throw new Error('请输入提示词（prompt）')

        const maxImages = Number.isFinite(Number(modelConfig?.maxImages)) ? Number(modelConfig.maxImages) : 3
        const images = collectImages().slice(0, maxImages)

        if (modelConfig.format === 'veo-unified') {
          // Veo（视频统一格式）示例字段：prompt/model/images/enhance_prompt/enable_upsample/aspect_ratio
          const body = {
            model: apiModel,
            prompt
          }

          const enhancePrompt = modelConfig.defaultParams?.enhancePrompt
          if (typeof enhancePrompt === 'boolean') body.enhance_prompt = enhancePrompt

          const enableUpsample = modelConfig.defaultParams?.enableUpsample
          if (typeof enableUpsample === 'boolean') body.enable_upsample = enableUpsample

          if (images.length > 0) body.images = images
          if (ratio === '16:9' || ratio === '9:16') body.aspect_ratio = ratio
          payload = body
        } else if (modelConfig.format === 'sora-unified') {
          // Sora（统一视频格式）示例字段：images/model/orientation/prompt/size/duration/watermark/private
          const orientation = ratio === '9:16' ? 'portrait' : 'landscape'

          const size = params.size || modelConfig.defaultParams?.size || 'large'
          const durValue = Number.isFinite(Number(duration)) ? Number(duration) : 15

          const watermark = typeof params.watermark === 'boolean'
            ? params.watermark
            : (typeof modelConfig.defaultParams?.watermark === 'boolean' ? modelConfig.defaultParams.watermark : false)

          const isPrivate = typeof params.private === 'boolean'
            ? params.private
            : (typeof modelConfig.defaultParams?.private === 'boolean' ? modelConfig.defaultParams.private : undefined)

          const body = {
            images,
            model: apiModel,
            orientation,
            prompt,
            size,
            duration: durValue,
            watermark
          }

          if (typeof isPrivate === 'boolean') body.private = isPrivate
          payload = body
        } else {
          // 其它统一视频格式兜底
          const body = {
            model: apiModel,
            prompt
          }
          const durationValue = Number.isFinite(Number(duration)) ? Number(duration) : duration
          if (images.length > 0) body.images = images
          if (ratio) body.aspect_ratio = ratio
          if (durationValue) body.duration = durationValue
          payload = body
        }
      } else if (modelConfig.format === 'kling-video') {
        // Kling 视频：根据是否有参考图，选择 text2video / image2video
        const hasAnyImage = Boolean(params.first_frame_image || params.last_frame_image || (Array.isArray(params.images) && params.images.length > 0))
        if (!hasAnyImage && !prompt) throw new Error('请输入提示词（prompt）')

        const modelName = modelConfig.defaultParams?.model_name || 'kling-v2-6'
        const mode = modelConfig.defaultParams?.mode || 'pro'
        const sound = modelConfig.defaultParams?.sound || 'off'
        const durValue = Number.isFinite(Number(duration)) ? Number(duration) : 10

        if (hasAnyImage) {
          const image = params.first_frame_image || (Array.isArray(params.images) ? params.images[0] : '')
          if (!image) throw new Error('Kling 图生视频需要首帧/参考图（请连接图片节点）')

          endpointOverride = modelConfig.endpointImage || endpointOverride
          statusEndpointOverride = modelConfig.statusEndpointImage || statusEndpointOverride

          payload = {
            model_name: modelName,
            image,
            image_tail: params.last_frame_image || '',
            mode,
            duration: durValue,
            sound
          }
          if (prompt) payload.prompt = prompt
        } else {
          endpointOverride = modelConfig.endpoint || endpointOverride
          statusEndpointOverride = modelConfig.statusEndpoint || statusEndpointOverride
          payload = {
            model_name: modelName,
            prompt,
            mode,
            duration: durValue,
            sound
          }
          if (ratio) payload.aspect_ratio = ratio
        }
      } else if (modelConfig.format === 'tencent-video') {
        // Tencent-VOD AIGC 视频（按你给的规则接入，字段以实际文档为准）
        if (!prompt) throw new Error('请输入提示词（prompt）')
        const version = modelConfig.defaultParams?.version
        payload = {
          model: apiModel,
          prompt
        }
        if (version) payload.version = version
        if (ratio) payload.aspect_ratio = ratio
        if (duration) payload.duration = Number(duration)
      } else {
        // Generic unified video (best-effort) | 其它统一视频格式兜底
        if (!prompt) throw new Error('请输入提示词（prompt）')
        const images = collectImages()
        const body = {
          model: apiModel,
          prompt
        }
        if (images.length > 0) body.images = images
        if (ratio) body.aspect_ratio = ratio
        if (duration) body.duration = duration
        payload = body
      }

      // Call API | 调用 API
      const createTask = () => createVideoTask(payload, {
        requestType,
        endpoint: endpointOverride,
        authMode: modelConfig?.authMode
      })

      const shouldRetry = (err) => {
        const msg = String(err?.message || '').toLowerCase()
        return /(429|rate|timeout|network|502|503|504|server error|gateway)/i.test(msg)
      }

      const createTaskWithRetry = async () => {
        let lastErr = null
        for (let attempt = 0; attempt < 3; attempt++) {
          try {
            return await createTask()
          } catch (err) {
            const message = String(err?.message || '')
            if (modelConfig.format === 'sora-unified' && /size is required/i.test(message)) {
              if (!payload.size) payload.size = modelConfig.defaultParams?.size || 'large'
              // Retry immediately after fixing size
              return await createTask()
            }
            lastErr = err
            if (!shouldRetry(err) || attempt === 2) throw err
            await new Promise(resolve => setTimeout(resolve, 800 * (attempt + 1)))
          }
        }
        throw lastErr
      }

      const task = await createTaskWithRetry()

      // If has video URL directly, return | 如果直接有视频 URL，返回
      const directVideoUrl =
        task?.video_url ||
        task?.data?.video_url ||
        task?.data?.url ||
        task?.url ||
        extractVideoUrlDeep(task)

      if (directVideoUrl) {
        const videoUrl = directVideoUrl
        video.value = { url: videoUrl, ...task }
        setSuccess()
        return video.value
      }

      // Tencent-VOD AIGC 视频：若未返回直链且没有查询端点配置，避免误轮询 /v1/videos/{id}
      if (modelConfig.format === 'tencent-video' && !statusEndpointOverride) {
        throw new Error('视频接口未返回 video_url，且未配置查询端点：请提供官方文档/示例以补齐轮询接口')
      }

      // Get task ID for polling | 获取任务 ID 用于轮询
      const id =
        task.id ||
        task.task_id ||
        task.taskId ||
        task.data?.id ||
        task.data?.task_id ||
        task.data?.taskId
      if (!id) {
        throw new Error('未获取到任务 ID')
      }

      taskId.value = id
      status.value = 'polling'

      // Poll for result | 轮询获取结果
      const maxAttempts = 120
      const interval = 5000

      for (let i = 0; i < maxAttempts; i++) {
        progress.attempt = i + 1
        progress.percentage = Math.min(Math.round((i / maxAttempts) * 100), 99)

        let result = null
        try {
          result = await getVideoTaskStatus(id, {
            statusEndpoint: statusEndpointOverride,
            authMode: modelConfig?.authMode,
            params: statusParamsOverride
          })
        } catch (err) {
          if (shouldRetry(err)) {
            await new Promise(resolve => setTimeout(resolve, interval))
            continue
          }
          throw err
        }

        // Check for completion | 检查是否完成
        const videoUrl =
          result?.video_url ||
          result?.data?.video_url ||
          extractVideoUrlDeep(result)
        const statusText = (result.status || result.data?.task_status || result.data?.status || result.task_status || '').toString().toLowerCase()
        if (videoUrl || statusText === 'completed' || statusText === 'succeeded' || statusText === 'success' || statusText === 'succeed' || statusText === 'done') {
          progress.percentage = 100
          video.value = { url: videoUrl || '', ...result }
          setSuccess()
          return video.value
        }

        // Check for failure | 检查是否失败
        if (statusText && /(fail|error)/i.test(statusText)) {
          throw new Error(result.error?.message || result.message || '视频生成失败')
        }

        // Wait before next poll | 等待下次轮询
        await new Promise(resolve => setTimeout(resolve, interval))
      }

      throw new Error('视频生成超时')
    } catch (err) {
      const enhanced = enhanceApiError(err, { modelKey, format: modelConfig?.format })
      setError(enhanced)
      throw enhanced
    }
  }

  return { loading, error, status, video, taskId, progress, generate, reset }
}

/**
 * Audio generation composable | 音频生成组合式函数（Suno）
 */
export const useAudioGeneration = () => {
  const { loading, error, status, reset, setLoading, setError, setSuccess } = useApiState()

  const tracks = ref([])
  const taskId = ref(null)
  const progress = reactive({
    attempt: 0,
    maxAttempts: 120,
    percentage: 0
  })

  const extractAudioTracks = (payload, fallbackTitle, model) => {
    const items = []
    const seen = new Set()

    const pushTrack = (item = {}, idx = 0) => {
      const url = item.audio_url || item.audioUrl || item.url || item.audio || ''
      if (!url || seen.has(url)) return
      seen.add(url)
      items.push({
        id: item.id || item.clip_id || item.clipId || `audio-${Date.now()}-${idx}`,
        title: item.title || fallbackTitle || `音频 ${idx + 1}`,
        audioUrl: url,
        duration: item.duration || item.metadata?.duration || 0,
        imageUrl: item.image_url || item.imageUrl || '',
        model
      })
    }

    const raw = payload?.data || payload
    const list =
      (Array.isArray(raw) && raw) ||
      (Array.isArray(raw?.data) ? raw.data : null) ||
      raw?.clips ||
      raw?.audios ||
      raw?.items ||
      []

    if (Array.isArray(list)) {
      list.forEach((item, idx) => pushTrack(item, idx))
    } else if (raw && typeof raw === 'object') {
      pushTrack(raw, 0)
    }

    // Deep fallback: scan for audio-like URLs
    if (items.length === 0) {
      const stack = [payload]
      while (stack.length) {
        const cur = stack.pop()
        if (!cur) continue
        if (typeof cur === 'string') {
          if (/\\.(mp3|wav|m4a|aac)(\\?|$)/i.test(cur) && !seen.has(cur)) {
            seen.add(cur)
            items.push({
              id: `audio-${Date.now()}-${items.length}`,
              title: fallbackTitle || `音频 ${items.length + 1}`,
              audioUrl: cur,
              duration: 0,
              imageUrl: '',
              model
            })
          }
          continue
        }
        if (Array.isArray(cur)) {
          cur.forEach(x => stack.push(x))
          continue
        }
        if (typeof cur === 'object') {
          Object.values(cur).forEach(x => stack.push(x))
        }
      }
    }

    return items
  }

  const generate = async (params = {}) => {
    setLoading(true)
    tracks.value = []
    taskId.value = null
    progress.attempt = 0
    progress.percentage = 0

    try {
      const apiModel = params.apiModel || 'suno_music'
      const createMode = params.create_mode || 'custom'
      const payload = {
        model: apiModel,
        title: params.title || '',
        tags: params.tags || '',
        generation_type: params.generation_type || 'TEXT',
        prompt: params.prompt || '',
        negative_tags: params.negative_tags || '',
        mv: params.model || 'chirp-v4',
        metadata: {
          create_mode: createMode,
          ...(params.vocal_gender ? { vocal_gender: params.vocal_gender } : {})
        }
      }

      if (createMode === 'extend') {
        payload.task = 'extend'
        if (params.task_id) payload.task_id = params.task_id
        if (params.continue_clip_id) payload.continue_clip_id = params.continue_clip_id
        if (params.continue_at !== undefined && params.continue_at !== '') payload.continue_at = params.continue_at
      }

      const task = await createMusicTask(payload)
      const id = task?.task_id || task?.data?.task_id || task?.id || task?.data?.id
      if (!id) {
        throw new Error('未获取到音频任务 ID')
      }

      taskId.value = id
      status.value = 'polling'

      const maxAttempts = 120
      const interval = 4000

      for (let i = 0; i < maxAttempts; i++) {
        progress.attempt = i + 1
        progress.percentage = Math.min(Math.round((i / maxAttempts) * 100), 99)

        const result = await fetchMusicTask(id)
        const statusText = (result.status || result.data?.status || '').toString().toUpperCase()

        if (statusText === 'FAILURE') {
          throw new Error(result.failReason || result.message || '音频生成失败')
        }

        if (statusText === 'SUCCESS') {
          const modelLabel = apiModel === 'suno_music' ? `${apiModel}/${payload.mv}` : apiModel
          const extracted = extractAudioTracks(result, params.title, modelLabel)
          tracks.value = extracted
          progress.percentage = 100
          setSuccess()
          return extracted
        }

        await new Promise(resolve => setTimeout(resolve, interval))
      }

      throw new Error('音频生成超时')
    } catch (err) {
      const enhanced = enhanceApiError(err, { modelKey: params?.model || 'suno' })
      setError(enhanced)
      throw enhanced
    }
  }

  return { loading, error, status, tracks, taskId, progress, generate, reset }
}

/**
 * Lyrics generation composable | 歌词生成组合式函数（Suno）
 */
export const useSunoLyrics = () => {
  const { loading, error, status, reset, setLoading, setError, setSuccess } = useApiState()

  const lyrics = ref('')
  const taskId = ref(null)
  const progress = reactive({
    attempt: 0,
    maxAttempts: 120,
    percentage: 0
  })

  const extractLyrics = (payload) => {
    const raw = payload?.data ?? payload
    if (!raw) return ''
    if (typeof raw === 'string') return raw
    if (typeof raw?.lyrics === 'string') return raw.lyrics
    if (typeof raw?.text === 'string') return raw.text
    if (typeof raw?.content === 'string') return raw.content
    if (Array.isArray(raw?.lyrics)) return raw.lyrics.join('\n')

    const stack = [raw]
    while (stack.length) {
      const cur = stack.pop()
      if (!cur) continue
      if (typeof cur === 'string' && cur.length > 20) return cur
      if (Array.isArray(cur)) {
        cur.forEach(x => stack.push(x))
        continue
      }
      if (typeof cur === 'object') {
        Object.values(cur).forEach(x => stack.push(x))
      }
    }
    return ''
  }

  const generate = async (params = {}) => {
    setLoading(true)
    lyrics.value = ''
    taskId.value = null
    progress.attempt = 0
    progress.percentage = 0

    try {
      const payload = {
        model: 'suno_lyrics',
        title: params.title || '',
        tags: params.tags || '',
        generation_type: params.generation_type || 'TEXT',
        prompt: params.prompt || '',
        negative_tags: params.negative_tags || '',
        mv: params.model || 'chirp-v4',
        metadata: {
          create_mode: params.create_mode || 'custom'
        }
      }

      const task = await createMusicTask(payload)
      const id = task?.task_id || task?.data?.task_id || task?.id || task?.data?.id
      if (!id) {
        throw new Error('未获取到歌词任务 ID')
      }

      taskId.value = id
      status.value = 'polling'

      const maxAttempts = 120
      const interval = 3000

      for (let i = 0; i < maxAttempts; i++) {
        progress.attempt = i + 1
        progress.percentage = Math.min(Math.round((i / maxAttempts) * 100), 99)

        const result = await fetchMusicTask(id)
        const statusText = (result.status || result.data?.status || '').toString().toUpperCase()

        if (statusText === 'FAILURE') {
          throw new Error(result.failReason || result.message || '歌词生成失败')
        }

        if (statusText === 'SUCCESS') {
          const text = extractLyrics(result)
          if (!text) throw new Error('未解析到歌词结果')
          lyrics.value = text
          progress.percentage = 100
          setSuccess()
          return text
        }

        await new Promise(resolve => setTimeout(resolve, interval))
      }

      throw new Error('歌词生成超时')
    } catch (err) {
      const enhanced = enhanceApiError(err, { modelKey: 'suno_lyrics' })
      setError(enhanced)
      throw enhanced
    }
  }

  return { loading, error, status, lyrics, taskId, progress, generate, reset }
}

/**
 * Combined API composable | 综合 API 组合式函数
 */
export const useApi = () => {
  const config = useApiConfig()
  const chat = useChat()
  const image = useImageGeneration()
  const videoGen = useVideoGeneration()
  const audioGen = useAudioGeneration()
  const lyricsGen = useSunoLyrics()

  return { config, chat, image, video: videoGen, audio: audioGen, lyrics: lyricsGen }
}
