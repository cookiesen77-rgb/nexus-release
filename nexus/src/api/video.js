/**
 * Video API | 视频生成 API
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
  // 例如 '/videos' -> 'videos' -> axios 拼接为 https://nexusapi.cn/v1/videos
  return path.startsWith('/') ? path.slice(1) : path
}

// 创建视频任务
export const createVideoTask = (data, options = {}) => {
  const { endpoint = '/videos', authMode, requestType = 'formdata' } = options
  const isFormData = typeof FormData !== 'undefined' && data instanceof FormData

  const headers = requestType === 'formdata' && !isFormData
    ? { 'Content-Type': 'multipart/form-data' }
    : {}

  const url = buildUrl(endpoint)

  return request({
    url,
    method: 'post',
    data,
    authMode,
    headers
  })
}

// 查询视频任务状态
export const getVideoTaskStatus = (taskId, options = {}) => {
  const { statusEndpoint, authMode, params } = options
  const rawUrl = statusEndpoint
    ? (typeof statusEndpoint === 'function' ? statusEndpoint(taskId) : statusEndpoint)
    : `/videos/${taskId}`
  const url = buildUrl(rawUrl)
  const query = { ...(params || {}) }
  if (statusEndpoint && typeof statusEndpoint === 'string' && query.id === undefined) {
    query.id = taskId
  }
  return request({
    url,
    method: 'get',
    params: Object.keys(query).length > 0 ? query : undefined,
    authMode
  })
}

// 轮询视频任务直到完成
export const pollVideoTask = async (taskId, maxAttempts = 120, interval = 5000) => {
  for (let i = 0; i < maxAttempts; i++) {
    const result = await getVideoTaskStatus(taskId)

    if (result.status === 'completed' || result.data) {
      return result
    }

    if (result.status === 'failed') {
      throw new Error(result.error?.message || '视频生成失败')
    }

    await new Promise(resolve => setTimeout(resolve, interval))
  }

  throw new Error('视频生成超时')
}
