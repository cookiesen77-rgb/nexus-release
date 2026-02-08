/**
 * Chat API | 对话 API
 */

import { request, getBaseUrl } from '@/utils'
import { fetch as tauriFetch } from '@tauri-apps/plugin-http'

// 检测 Tauri 环境
const isTauri = typeof window !== 'undefined' && !!window.__TAURI_INTERNALS__

// 根据环境选择 fetch 实现（带兜底）
// 说明：部分 Tauri 用户环境（常见于 Windows 代理/证书链）下，plugin-http 会偶发抛错，
// 这里在抛错时自动回退到 WebView fetch，降低 "Failed to fetch" 概率。
const webFetch = globalThis.fetch ? globalThis.fetch.bind(globalThis) : (async () => { throw new Error('fetch is not available') })
const safeFetch = async (input, init) => {
  if (!isTauri) return await webFetch(input, init)
  try {
    return await tauriFetch(input, init)
  } catch (err) {
    const message = String(err?.message || err || '')
    console.warn('[api/chat.safeFetch] tauriFetch failed, fallback to web fetch:', {
      url: String(input || '').slice(0, 120),
      message: message.slice(0, 220)
    })
    return await webFetch(input, init)
  }
}

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms))

const isRetryableStatus = (status) => status === 408 || status === 429 || status === 500 || status === 502 || status === 503 || status === 504

const isRetryableFetchError = (err) => {
  const msg = String(err?.message || err || '')
  return /Failed to fetch|NetworkError|socket|TLS|ECONNRESET|EPIPE|ETIMEDOUT|timed out|502|Bad Gateway|did not match|expected pattern|error sending request|request error/i.test(msg)
}

const backoffMs = (attempt) => {
  const base = 600 * Math.pow(2, Math.max(0, attempt))
  const jitter = Math.floor(Math.random() * 250)
  return Math.min(6000, base + jitter)
}

const fetchWithRetry = async (url, options, { signal, maxRetries } = {}) => {
  const retryTimes = Number.isFinite(Number(maxRetries)) ? Number(maxRetries) : (isTauri ? 2 : 1)

  for (let attempt = 0; attempt <= retryTimes; attempt++) {
    if (signal?.aborted) {
      const abortErr = new Error('Aborted')
      abortErr.name = 'AbortError'
      throw abortErr
    }

    try {
      const res = await safeFetch(url, options)
      if (attempt < retryTimes && isRetryableStatus(res?.status || 0)) {
        const wait = backoffMs(attempt)
        console.warn('[api/chat.fetchWithRetry] retryable response status, retrying:', {
          status: res?.status,
          attempt: attempt + 1,
          waitMs: wait
        })
        await sleep(wait)
        continue
      }
      return res
    } catch (err) {
      const name = String(err?.name || '')
      if (name === 'AbortError' || signal?.aborted) throw err

      if (attempt < retryTimes && isRetryableFetchError(err)) {
        const wait = backoffMs(attempt)
        console.warn('[api/chat.fetchWithRetry] retryable fetch error, retrying:', {
          attempt: attempt + 1,
          waitMs: wait,
          message: String(err?.message || err || '').slice(0, 160)
        })
        await sleep(wait)
        continue
      }

      throw err
    }
  }

  throw new Error('fetchWithRetry failed')
}

// 对话补全
export const chatCompletions = (data) =>
  request({
    url: `/chat/completions`,
    method: 'post',
    data
  })

// Responses API（推荐）
export const createResponse = (data) =>
  request({
    url: `/responses`,
    method: 'post',
    data
  })

const extractTextFromResponsesOutput = (output) => {
  if (!Array.isArray(output)) return ''
  let text = ''

  for (const item of output) {
    const content = item?.content
    if (typeof content === 'string') {
      text += content
      continue
    }
    if (!Array.isArray(content)) continue

    for (const part of content) {
      if (typeof part === 'string') {
        text += part
        continue
      }
      if (typeof part?.text === 'string') text += part.text
    }
  }

  return text
}

export const extractTextFromResponses = (resp) => {
  if (!resp) return ''
  if (typeof resp.output_text === 'string') return resp.output_text
  const outputText = extractTextFromResponsesOutput(resp.output)
  if (outputText) return outputText

  // 兼容部分网关返回 Chat 格式
  const msg = resp?.choices?.[0]?.message?.content
  if (typeof msg === 'string') return msg
  if (Array.isArray(msg)) return msg.map(m => m?.text || m).filter(Boolean).join('')
  return ''
}

const parseResponsesStreamEvent = (parsed) => {
  if (!parsed || typeof parsed !== 'object') return { kind: 'unknown', text: '' }

  // OpenAI Responses：event.type = response.output_text.delta, delta = '...'
  if (typeof parsed.delta === 'string') return { kind: 'delta', text: parsed.delta }

  // 兼容部分网关：沿用 Chat SSE delta 格式
  const chatDelta = parsed?.choices?.[0]?.delta?.content
  if (typeof chatDelta === 'string') return { kind: 'delta', text: chatDelta }

  // 某些实现可能直接给出全量 output_text
  if (typeof parsed.output_text === 'string') return { kind: 'full', text: parsed.output_text }
  if (typeof parsed?.response?.output_text === 'string') return { kind: 'full', text: parsed.response.output_text }

  const fullFromOutput = extractTextFromResponsesOutput(parsed.output || parsed?.response?.output)
  if (fullFromOutput) return { kind: 'full', text: fullFromOutput }

  return { kind: 'unknown', text: '' }
}

// 流式 Responses
export const streamResponses = async function* (data, signal) {
  const apiKey = localStorage.getItem('apiKey')
  const baseUrl = getBaseUrl()

  // Tauri 环境不使用 signal（Windows 兼容性问题）
  const fetchOptions = {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`
    },
    body: JSON.stringify({ ...data, stream: true })
  }
  if (!isTauri && signal) {
    fetchOptions.signal = signal
  }
  const response = await fetchWithRetry(`${baseUrl}/responses`, fetchOptions, { signal })

  if (!response.ok) {
    const error = await response.json().catch(() => null)
    throw new Error(error?.error?.message || error?.message || 'Responses stream request failed')
  }

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let accumulated = ''
  let iterations = 0
  const MAX_ITERATIONS = 10000

  while (true) {
    if (signal?.aborted) {
      const abortErr = new Error('Aborted')
      abortErr.name = 'AbortError'
      throw abortErr
    }
    if (iterations++ > MAX_ITERATIONS) {
      throw new Error('Stream timeout: exceeded maximum iterations')
    }
    const { done, value } = await reader.read()
    if (done) break

    buffer += decoder.decode(value, { stream: true })
    const lines = buffer.split('\n')
    buffer = lines.pop() || ''

    for (const line of lines) {
      const trimmed = line.trim()
      if (!trimmed || !trimmed.startsWith('data:')) continue

      const payload = trimmed.slice(5).trim()
      if (payload === '[DONE]') return

      try {
        const parsed = JSON.parse(payload)
        const { kind, text } = parseResponsesStreamEvent(parsed)
        if (!text) continue

        if (kind === 'delta') {
          accumulated += text
          yield text
          continue
        }

        if (kind === 'full') {
          if (text.startsWith(accumulated)) {
            const delta = text.slice(accumulated.length)
            accumulated = text
            if (delta) yield delta
          } else {
            accumulated = text
            yield text
          }
        }
      } catch (e) {
        // Skip invalid JSON
      }
    }
  }
}

// 流式对话补全
export const streamChatCompletions = async function* (data, signal) {
  const apiKey = localStorage.getItem('apiKey')
  const baseUrl = getBaseUrl()
  
  // Tauri 环境不使用 signal（Windows 兼容性问题）
  const fetchOptions = {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`
    },
    body: JSON.stringify({ ...data, stream: true })
  }
  if (!isTauri && signal) {
    fetchOptions.signal = signal
  }
  const response = await fetchWithRetry(`${baseUrl}/chat/completions`, fetchOptions, { signal })

  if (!response.ok) {
    let errorText = ''
    try {
      errorText = await response.text()
    } catch {
      errorText = ''
    }
    let errorJson = null
    if (errorText) {
      try {
        errorJson = JSON.parse(errorText)
      } catch {
        errorJson = null
      }
    }
    const message =
      errorJson?.error?.message ||
      errorJson?.message ||
      errorText ||
      `Stream request failed (${response.status})`
    const err = new Error(message)
    err.status = response.status
    throw err
  }

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let iterations = 0
  const MAX_ITERATIONS = 10000

  while (true) {
    if (signal?.aborted) {
      const abortErr = new Error('Aborted')
      abortErr.name = 'AbortError'
      throw abortErr
    }
    if (iterations++ > MAX_ITERATIONS) {
      throw new Error('Stream timeout: exceeded maximum iterations')
    }
    const { done, value } = await reader.read()
    if (done) break

    buffer += decoder.decode(value, { stream: true })
    const lines = buffer.split('\n')
    buffer = lines.pop() || ''

    for (const line of lines) {
      const trimmed = line.trim()
      if (!trimmed || !trimmed.startsWith('data:')) continue

      const data = trimmed.slice(5).trim()
      if (data === '[DONE]') return

      try {
        const parsed = JSON.parse(data)
        const content = parsed.choices?.[0]?.delta?.content
        if (content) yield content
      } catch (e) {
        // Skip invalid JSON
      }
    }
  }
}
