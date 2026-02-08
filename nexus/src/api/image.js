/**
 * Image API | 图片生成 API
 */

import { request, DEFAULT_API_BASE_URL } from '@/utils'
import { postFormData, postJson } from '@/lib/workflow/request'

// 检测 Tauri 环境
const isTauri = typeof window !== 'undefined' && !!window.__TAURI_INTERNALS__

// 不需要 /v1 前缀的路径
const noV1Prefixes = ['/tencent-vod', '/kling', '/v1beta', '/v1/', '/video/']

// 构建完整 URL（处理特殊前缀）
// 注意：axios 的 baseURL 是 https://nexusapi.cn/v1
// 当 url 以 / 开头时，axios 会从域名根目录拼接（忽略 baseURL 的 /v1 部分）
// 所以需要返回不带 / 前缀的相对路径，或者返回完整的绝对 URL
const buildUrl = (endpoint) => {
  if (!endpoint) return ''
  if (/^https?:\/\//i.test(endpoint)) return endpoint

  const path = endpoint.startsWith('/') ? endpoint : `/${endpoint}`

  // 如果路径以特殊前缀开头，使用 origin 而不是带 /v1 的 base
  if (noV1Prefixes.some(p => path.startsWith(p))) {
    try {
      const origin = new URL(DEFAULT_API_BASE_URL).origin
      return `${origin}${path}`
    } catch {
      // fallback
    }
  }

  // 其他路径：去掉开头的 /，让 axios 相对于 baseURL 拼接
  // 例如 '/images/generations' -> 'images/generations' -> axios 拼接为 https://nexusapi.cn/v1/images/generations
  return path.startsWith('/') ? path.slice(1) : path
}

const toFormData = (data) => {
  if (typeof FormData !== 'undefined' && data instanceof FormData) return data
  const fd = new FormData()
  if (data && typeof data === 'object') {
    Object.entries(data).forEach(([key, value]) => {
      if (value === undefined || value === null) return
      if (Array.isArray(value)) {
        value.forEach((v) => fd.append(key, v))
      } else {
        fd.append(key, value)
      }
    })
  }
  return fd
}

// 生成图片
export const generateImage = (data, options = {}) => {
  const { requestType = 'json', endpoint = '/images/generations', authMode, timeout } = options
  const url = buildUrl(endpoint)

  // Tauri 环境：使用 safeFetch 封装的 request（避免 WebView CORS）
  if (isTauri) {
    if (requestType === 'formdata' || (typeof FormData !== 'undefined' && data instanceof FormData)) {
      const form = toFormData(data)
      return postFormData(url, form, { authMode, timeoutMs: timeout })
    }
    return postJson(url, data, { authMode, timeoutMs: timeout })
  }

  // Web 环境：保持 axios 行为（含 key 轮换与拦截器）
  return request({
    url,
    method: 'post',
    data,
    authMode,
    timeout,
    headers: requestType === 'formdata' ? { 'Content-Type': 'multipart/form-data' } : {}
  })
}
