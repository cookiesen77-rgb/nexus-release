/**
 * API Key 轮换管理器
 * 
 * 提供统一的 Key 获取和错误标记接口，供请求层使用
 * 内部使用 useSettingsStore 管理状态
 */

import { useSettingsStore } from '@/store/settings'

// 错误类型定义
export type KeyFailureReason = 
  | 'unauthorized'      // 401 认证失败
  | 'payment_required'  // 402 积分耗尽
  | 'forbidden'         // 403 访问被拒
  | 'quota_exceeded'    // 1006 额度耗尽
  | 'login_expired'     // 34010105 登录失效
  | 'rate_limited'      // 429 频率限制
  | 'unknown'           // 其他错误

// 错误码到原因的映射
const ERROR_CODE_MAP: Record<number, KeyFailureReason> = {
  401: 'unauthorized',
  402: 'payment_required',
  403: 'forbidden',
  429: 'rate_limited',
  1006: 'quota_exceeded',
  34010105: 'login_expired'
}

// 原因到中文描述的映射
const REASON_LABELS: Record<KeyFailureReason, string> = {
  unauthorized: '认证失败 (401)',
  payment_required: '积分耗尽 (402)',
  forbidden: '访问被拒 (403)',
  quota_exceeded: '额度耗尽 (1006)',
  login_expired: '登录失效 (34010105)',
  rate_limited: '频率限制 (429)',
  unknown: '未知错误'
}

/**
 * 获取下一个可用的 API Key
 * 
 * @returns 可用的 Key，如果没有则返回 null
 */
export const getNextValidKey = (): string | null => {
  const store = useSettingsStore.getState()
  
  // 检查熔断器状态
  if (store.isCircuitOpen()) {
    console.error('[Key Manager] 熔断器已触发，拒绝请求')
    return null
  }
  
  return store.getNextValidKey()
}

/**
 * 标记 Key 失败
 * 
 * @param key 失败的 Key
 * @param errorCode HTTP 状态码或业务错误码
 * @param errorMessage 错误消息（用于提取额外信息）
 */
export const markKeyFailed = (
  key: string,
  errorCode: number,
  errorMessage?: string
): void => {
  if (!key) return
  
  const store = useSettingsStore.getState()
  
  // 从错误消息中提取真实错误码（格式: "错误码: 1006"）
  let realErrorCode = errorCode
  if (errorMessage) {
    const match = errorMessage.match(/错误码[：:]\s*(\d+)/)
    if (match) {
      realErrorCode = parseInt(match[1], 10)
    }
  }
  
  const reason = ERROR_CODE_MAP[realErrorCode] || 'unknown'
  const reasonLabel = REASON_LABELS[reason]
  
  // 永久性错误 -> 黑名单
  // 临时性错误 -> 暂停列表
  const permanentErrors: KeyFailureReason[] = [
    'unauthorized',
    'payment_required',
    'forbidden',
    'quota_exceeded'
  ]
  
  if (permanentErrors.includes(reason)) {
    store.addToBlacklist(key, reasonLabel)
  } else if (reason === 'login_expired' || reason === 'rate_limited') {
    store.addToPauseList(key, reasonLabel)
  }
  
  // 记录错误到熔断器（仅针对特定错误类型）
  if (reason === 'quota_exceeded' || reason === 'payment_required') {
    store.recordError()
  }
}

/**
 * 根据响应判断是否应该重试（使用新 Key）
 * 
 * @param status HTTP 状态码
 * @param data 响应数据
 * @returns 是否应该重试
 */
export const shouldRetryWithNewKey = (
  status: number,
  data?: Record<string, unknown>
): boolean => {
  // HTTP 级别的认证错误
  if (status === 401 || status === 402 || status === 403) {
    return true
  }
  
  // 业务级别的错误码检查
  if (data) {
    const errorCode = data.code || data.error_code
    if (errorCode === 1006 || errorCode === 34010105) {
      return true
    }
    
    // 检查消息中的错误码
    const message = String(data.message || data.error || '')
    if (message.includes('1006') || message.includes('34010105')) {
      return true
    }
  }
  
  return false
}

/**
 * 重置指定 Key 的状态（从黑名单和暂停列表中移除）
 */
export const resetKeyStatus = (key: string): void => {
  if (!key) return
  const store = useSettingsStore.getState()
  store.removeFromBlacklist(key)
  store.removeFromPauseList(key)
}

/**
 * 检查熔断器是否打开
 */
export const checkCircuitBreaker = (): boolean => {
  return useSettingsStore.getState().isCircuitOpen()
}

/**
 * 重置熔断器
 */
export const resetCircuitBreaker = (): void => {
  useSettingsStore.getState().resetCircuitBreaker()
}

/**
 * 获取当前 Key 状态统计
 */
export const getKeyStats = (): {
  total: number
  available: number
  blacklisted: number
  paused: number
  circuitOpen: boolean
} => {
  const store = useSettingsStore.getState()
  
  const allKeys: string[] = []
  if (store.apiKey) allKeys.push(store.apiKey)
  store.apiKeys.forEach(k => {
    if (k && !allKeys.includes(k)) allKeys.push(k)
  })
  
  const blacklisted = allKeys.filter(k => store.isBlacklisted(k)).length
  const paused = allKeys.filter(k => store.isPaused(k)).length
  
  return {
    total: allKeys.length,
    available: allKeys.length - blacklisted - paused,
    blacklisted,
    paused,
    circuitOpen: store.isCircuitOpen()
  }
}
