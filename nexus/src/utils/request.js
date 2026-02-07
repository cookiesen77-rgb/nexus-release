/**
 * HTTP Request Utility | HTTP 请求工具
 * Axios-based request with interceptors
 * 
 * 集成多 Key 轮换和黑名单机制
 */

import axios from 'axios'
import { DEFAULT_API_BASE_URL } from './constants'
import { formatErrorMessage } from './errorResolver'
import { 
  getNextValidKey, 
  markKeyFailed, 
  shouldRetryWithNewKey,
  checkCircuitBreaker 
} from '@/lib/workflow/keyManager'

// Base URL is fixed to NexusAPI
const BASE_URL = DEFAULT_API_BASE_URL

const safeJsonParse = (data, headers = {}) => {
  if (data === null || data === undefined) return data
  if (typeof data !== 'string') return data

  const trimmed = data.trim()
  if (!trimmed) return data

  const contentType = (headers?.['content-type'] || headers?.['Content-Type'] || '').toLowerCase()
  const looksJson = contentType.includes('application/json') || /^[{\[]/.test(trimmed)
  if (!looksJson) return data

  try {
    return JSON.parse(trimmed)
  } catch {
    return data
  }
}

// Create axios instance | 创建 axios 实例
const instance = axios.create({
  baseURL: BASE_URL,
  timeout: 30000,
  transformResponse: [(data, headers) => safeJsonParse(data, headers)]
})

// Request interceptor | 请求拦截器
instance.interceptors.request.use(
  (config) => {
    // 检查熔断器状态
    if (checkCircuitBreaker()) {
      const err = new Error('熔断器已触发，请求被拒绝。请稍后重试或检查 API Key 状态。')
      err.isCircuitBreakerError = true
      return Promise.reject(err)
    }
    
    // 使用 Key 轮换获取可用 Key
    const apiKey = getNextValidKey() || localStorage.getItem('apiKey') || ''
    
    // 保存当前使用的 Key 到 config 中，用于错误处理时标记
    config._usedApiKey = apiKey
    
    // Skip auth for certain endpoints | 跳过某些端点的认证
    const noAuthEndpoints = ['/model/page', '/model/fullName', '/model/types']
    const isNoAuth = noAuthEndpoints.some(ep => config.url?.includes(ep))

    // Query 模式：附加 key 参数，不加 Authorization
    if (config.authMode === 'query') {
      config.params = { ...(config.params || {}), key: apiKey }
      delete config.headers?.Authorization
      return config
    }
    
    if (apiKey && !isNoAuth) {
      config.headers = { ...(config.headers || {}), Authorization: `Bearer ${apiKey}` }
    }
    
    return config
  },
  (error) => {
    console.error('Request error:', error)
    return Promise.reject(error)
  }
)

// Response interceptor | 响应拦截器
instance.interceptors.response.use(
  (res) => {
    const { data, code, message } = res.data || {}
    
    // Handle stream response | 处理流响应
    if (res.config.responseType === 'stream') {
      return res.data
    }
    
    // Handle blob response | 处理 blob 响应
    if (res.data instanceof Blob) {
      return res.data
    }
    
    // 检查业务层错误码（如 1006 积分耗尽）
    const responseData = res.data || {}
    const errorCode = responseData.code || responseData.error_code
    const errorMessage = responseData.message || responseData.error?.message || ''
    
    if (shouldRetryWithNewKey(res.status, responseData)) {
      const usedKey = res.config?._usedApiKey
      if (usedKey) {
        markKeyFailed(usedKey, errorCode || res.status, errorMessage)
      }
      // 不自动重试，让上层处理
    }
    
    // Success response | 成功响应
    if (code === 200 || res.status === 200) {
      return res.data
    }
    
    // Error response | 错误响应
    window.$message?.error(message || 'Request failed')
    return Promise.reject(res.data)
  },
  (error) => {
    // 熔断器错误直接返回
    if (error.isCircuitBreakerError) {
      window.$message?.error(error.message)
      return Promise.reject(error)
    }
    
    const { response, config } = error
    
    if (response) {
      const { status, data } = response
      const rawMessage =
        data?.message_zh ||
        data?.error?.message_zh ||
        data?.message ||
        data?.error?.message ||
        (typeof data?.error === 'string' ? data.error : null) ||
        error.message
      const message = formatErrorMessage(rawMessage, { status })

      // 让上层拿到更准确的报错文本（用于节点错误提示）| normalize error.message for UI
      if (message && typeof message === 'string') {
        error.message = message
      }
      
      // 标记失败的 Key
      const usedKey = config?._usedApiKey
      if (usedKey && shouldRetryWithNewKey(status, data)) {
        markKeyFailed(usedKey, status, rawMessage)
      }
      
      if (status === 401) {
        window.$message?.error('API Key 无效或已过期')
      } else if (status === 429) {
        window.$message?.error('请求过于频繁，请稍后再试')
      } else {
        window.$message?.error(message || '请求失败')
      }
    } else {
      const fallback = formatErrorMessage(error.message, {})
      window.$message?.error(fallback || '网络错误')
    }
    
    return Promise.reject(error)
  }
)

/**
 * Set API base URL | 设置 API 基础 URL
 * @param {string} url - Base URL
 */
export const setBaseUrl = (url) => {
  // Base URL is locked; ignore custom values and enforce the default
  instance.defaults.baseURL = DEFAULT_API_BASE_URL
}

/**
 * Get current base URL | 获取当前基础 URL
 * @returns {string}
 */
export const getBaseUrl = () => {
  return instance.defaults.baseURL
}

export default instance
