import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './style.css'
import { initGlobalMessage } from '@/lib/message'

// 初始化全局消息系统（兼容 Vue 版本的 window.$message）
initGlobalMessage()

const MAX_LOG_CHARS = 4000
const MAX_ARG_CHARS = 1200
const MAX_CONTEXT_CHARS = 1600
const MAX_STRING_CHARS = 500
const DATA_URL_RE = /data:image\/[^;]+;base64,[a-z0-9+/=]+/gi

const sanitizeText = (text: unknown, maxLen = MAX_LOG_CHARS) => {
  let output = typeof text === 'string' ? text : String(text || '')
  if (output.includes('data:image') || output.includes('base64,')) {
    output = output.replace(DATA_URL_RE, '[data-url omitted]')
  }
  if (output.length > maxLen) {
    const extra = output.length - maxLen
    output = `${output.slice(0, maxLen)}...[truncated ${extra} chars]`
  }
  return output
}

const safeStringify = (value: unknown, maxLen = MAX_ARG_CHARS) => {
  if (typeof value !== 'object' || value === null) {
    return sanitizeText(String(value), maxLen)
  }

  const seen = new WeakSet<object>()
  const depthMap = new WeakMap<object, number>()
  const maxDepth = 2

  const replacer = function (this: unknown, _key: string, val: unknown) {
    if (typeof val === 'string') {
      return val.length > MAX_STRING_CHARS ? `${val.slice(0, MAX_STRING_CHARS)}...` : val
    }
    if (val && typeof val === 'object') {
      const obj = val as object
      if (seen.has(obj)) return '[Circular]'
      seen.add(obj)
      const parentDepth = depthMap.get(this as any) || 0
      const nextDepth = parentDepth + 1
      depthMap.set(obj, nextDepth)
      if (nextDepth > maxDepth) return '[Object]'
    }
    return val
  }

  try {
    return sanitizeText(JSON.stringify(value, replacer), maxLen)
  } catch {
    return sanitizeText(String(value), maxLen)
  }
}

const reportFrontendLog = async (level: string, message: string, context?: unknown) => {
  try {
    const { isTauri, invoke } = await import('@tauri-apps/api/core')
    if (!isTauri()) return
    const safeMessage = sanitizeText(message, MAX_LOG_CHARS)
    const safeContext = context ? safeStringify(context, MAX_CONTEXT_CHARS) : null
    await invoke('log_frontend', {
      level,
      message: safeMessage,
      context: safeContext
    })
  } catch {
    // ignore logging failures
  }
}

const formatLogArgs = (args: unknown[]) => {
  const parts = args
    .map((arg) => {
      if (typeof arg === 'string') return sanitizeText(arg, MAX_ARG_CHARS)
      if (arg instanceof Error) return sanitizeText(arg.message || 'Error', MAX_ARG_CHARS)
      if (arg && typeof arg === 'object') return safeStringify(arg, MAX_ARG_CHARS)
      return sanitizeText(String(arg), MAX_ARG_CHARS)
    })
    .filter(Boolean)

  return sanitizeText(parts.join(' '), MAX_LOG_CHARS)
}

const originalConsoleError = console.error
console.error = (...args: unknown[]) => {
  originalConsoleError(...args)
  const message = formatLogArgs(args)
  if (message) reportFrontendLog('error', message)
}

const originalConsoleWarn = console.warn
console.warn = (...args: unknown[]) => {
  originalConsoleWarn(...args)
  const message = formatLogArgs(args)
  if (message) reportFrontendLog('warn', message)
}

let hasNotifiedGlobalError = false
const notifyGlobalError = (message: string) => {
  if (hasNotifiedGlobalError) return
  hasNotifiedGlobalError = true
  try {
    // 最保底的提示：避免依赖 UI 库
    window.alert(message)
  } catch {
    // ignore
  }
}

window.addEventListener('unhandledrejection', (event) => {
  const reason = (event as any)?.reason
  const message = reason?.message || String(reason || '')
  
  // 过滤掉不需要打扰用户的错误
  const ignoredPatterns = [
    'updater', 'update', 'plugin-updater', 'pubkey',  // 更新检查
    'aborted', 'abort', 'cancelled', 'cancel',        // 用户取消
    'network', 'fetch', 'timeout',                    // 网络错误（已有其他提示）
    'ResizeObserver',                                 // 浏览器内部错误
    'extensions',                                     // 浏览器扩展
  ]
  
  const lowerMessage = message.toLowerCase()
  const shouldIgnore = ignoredPatterns.some(p => lowerMessage.includes(p))
  
  if (shouldIgnore) {
    console.warn('[Ignored Error]', message)
    return
  }
  
  console.error('Unhandled promise rejection:', reason)
  reportFrontendLog('error', message || 'Unhandled rejection', { stack: reason?.stack })
  // 不再显示全局 alert，改为使用 toast 消息（如果可用）
  try {
    if (window.$message?.error) {
      window.$message.error(message || '请求异常')
    }
  } catch {
    // ignore
  }
})

window.addEventListener('error', (event) => {
  console.error('Global error:', (event as any)?.error || (event as any)?.message)
  reportFrontendLog('error', (event as any)?.message || 'Global error', {
    filename: (event as any)?.filename,
    lineno: (event as any)?.lineno,
    colno: (event as any)?.colno,
    stack: (event as any)?.error?.stack
  })
})

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)
