/**
 * Chat API | 对话 API
 */

import { request, getBaseUrl } from '@/utils'
import { fetch as tauriFetch } from '@tauri-apps/plugin-http'

// 检测 Tauri 环境
const isTauri = typeof window !== 'undefined' && !!window.__TAURI_INTERNALS__

// 根据环境选择 fetch 实现（Windows Tauri 必须用插件 fetch）
const safeFetch = isTauri ? tauriFetch : globalThis.fetch

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
  const response = await safeFetch(`${baseUrl}/responses`, fetchOptions)

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
  const response = await safeFetch(`${baseUrl}/chat/completions`, fetchOptions)

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
