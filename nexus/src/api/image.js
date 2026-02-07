/**
 * Image API | 图片生成 API
 */

import { request, DEFAULT_API_BASE_URL } from '@/utils'

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

// 生成图片
export const generateImage = (data, options = {}) => {
  const { requestType = 'json', endpoint = '/images/generations', authMode, timeout } = options
  const url = buildUrl(endpoint)
  
  return request({
    url,
    method: 'post',
    data,
    authMode,
    timeout,
    headers: requestType === 'formdata' ? { 'Content-Type': 'multipart/form-data' } : {}
  })
}
