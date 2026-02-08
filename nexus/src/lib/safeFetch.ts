import { fetch as tauriFetch } from '@tauri-apps/plugin-http'

// 检测 Tauri 环境
const isTauri = typeof window !== 'undefined' && !!(window as any).__TAURI_INTERNALS__

const webFetch = globalThis.fetch ? globalThis.fetch.bind(globalThis) : (async () => { throw new Error('fetch is not available') }) as typeof fetch

const toUrlString = (input: RequestInfo | URL): string => {
  if (typeof input === 'string') return input
  if (input instanceof URL) return input.toString()
  if (typeof Request !== 'undefined' && input instanceof Request) return input.url
  return String((input as any)?.url || input || '')
}

const isHttpUrl = (input: RequestInfo | URL): boolean => /^https?:\/\//i.test(toUrlString(input).trim())

export const safeFetch = async (input: RequestInfo | URL, init?: RequestInit) => {
  if (!isTauri) return await webFetch(input, init)

  // 非 http(s) 资源（如 blob:/asset://）走 WebView fetch
  if (!isHttpUrl(input)) {
    return await webFetch(input, init)
  }

  try {
    return await (tauriFetch as typeof fetch)(input, init)
  } catch (err: any) {
    console.warn('[safeFetch] tauriFetch failed, fallback to web fetch:', {
      url: toUrlString(input).slice(0, 120),
      message: String(err?.message || err || '').slice(0, 220)
    })
    return await webFetch(input, init)
  }
}
