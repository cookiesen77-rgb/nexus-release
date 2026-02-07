/**
 * Deep clone helper | 深拷贝工具
 * - Prefer structuredClone for performance (available in modern browsers / Tauri WebView)
 * - Fallback to JSON clone for plain data
 */

export const deepClone = (value) => {
  if (typeof globalThis.structuredClone === 'function') {
    try {
      return globalThis.structuredClone(value)
    } catch {
      // fall through to JSON clone
    }
  }

  return JSON.parse(JSON.stringify(value))
}

