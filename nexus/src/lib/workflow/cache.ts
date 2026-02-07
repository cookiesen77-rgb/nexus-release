/**
 * 统一缓存抽象层
 * 
 * 根据运行环境自动选择最优缓存实现：
 * - Tauri 环境：使用 Rust 后端进行文件系统缓存
 * - Web 环境：使用 IndexedDB 进行本地缓存
 */
import { getTauri, tauriInvoke } from '@/lib/tauri'
import { LocalCacheManager, type CacheEntry } from '@/lib/indexedDB'

// 缓存结果类型
export interface CacheResult {
  displayUrl: string
  localPath: string
  source: 'tauri' | 'indexeddb' | 'memory' | 'direct'
  error?: string
}

// 缓存分类
export type CacheCategory = CacheEntry['category']

// 缓存状态
export type CacheStatus = 'cached' | 'pending' | 'none' | 'error'

// 内存中的 pending 状态跟踪
const pendingCache = new Map<string, Promise<CacheResult>>()

// URL 到缓存 ID 的映射
const urlToCacheId = new Map<string, string>()

const getApiKey = () => {
  try {
    return localStorage.getItem('apiKey') || ''
  } catch {
    return ''
  }
}

const blobToDataUrl = async (blob: Blob) => {
  return await new Promise<string>((resolve) => {
    const reader = new FileReader()
    reader.onerror = () => resolve('')
    reader.onload = () => resolve(String(reader.result || ''))
    reader.readAsDataURL(blob)
  })
}

const isLikelyAuthRequiredUrl = (url: string) => {
  const u = String(url || '').trim()
  if (!u) return false
  // 相对路径：这些后端接口基本都需要 Authorization
  if (u.startsWith('/v1/') || u.startsWith('/v1beta') || u.startsWith('/kling') || u.startsWith('/tencent-vod')) return true

  // 绝对 URL：仅把“接口路径”视为需要鉴权；静态/下载链接先按“可直链”处理（失败再走缓存兜底）
  try {
    const parsed = new URL(u)
    const host = String(parsed.hostname || '').toLowerCase()
    const path = String(parsed.pathname || '')
    if (host.endsWith('nexusapi.cn')) {
      if (path.startsWith('/v1/') || path.startsWith('/v1beta') || path.startsWith('/kling') || path.startsWith('/tencent-vod')) return true
      return false
    }
  } catch {
    // ignore
  }

  return false
}

const tryFetchImageAsDataUrlInTauri = async (absoluteUrl: string, token: string) => {
  const url = String(absoluteUrl || '').trim()
  if (!/^https?:\/\//i.test(url)) return ''
  try {
    const { fetch: tauriFetch } = await import('@tauri-apps/plugin-http')
    const headers: Record<string, string> = {}
    if (token && isLikelyAuthRequiredUrl(url)) headers.Authorization = `Bearer ${token}`
    const res: any = await (tauriFetch as any)(url, { method: 'GET', headers })
    if (!res?.ok) return ''
    const blob: Blob = await res.blob()
    // 避免把超大图片转成 dataURL（base64 体积会膨胀）
    if ((blob as any)?.size && Number(blob.size) > 12 * 1024 * 1024) return ''
    return await blobToDataUrl(blob)
  } catch {
    return ''
  }
}

/**
 * 生成缓存 ID
 */
const generateCacheId = (url: string, category: CacheCategory = 'general'): string => {
  let hash = 0
  for (let i = 0; i < url.length; i++) {
    const char = url.charCodeAt(i)
    hash = ((hash << 5) - hash) + char
    hash = hash & hash
  }
  return `${category}_${Math.abs(hash).toString(36)}`
}

/**
 * 获取缓存状态
 */
export const getCacheStatus = (url: string): CacheStatus => {
  if (!url) return 'none'
  if (pendingCache.has(url)) return 'pending'
  if (urlToCacheId.has(url)) return 'cached'
  return 'none'
}

/**
 * 统一的媒体缓存函数
 * 
 * @param url 媒体 URL
 * @param category 缓存分类
 * @param options 可选配置
 */
export const cacheMedia = async (
  url: string,
  category: CacheCategory = 'general',
  options: {
    forceRefresh?: boolean
    metadata?: Record<string, unknown>
  } = {}
): Promise<CacheResult> => {
  const u = String(url || '').trim()
  if (!u) return { displayUrl: '', localPath: '', source: 'direct' }
  
  // data: 和 blob: 直接返回
  if (u.startsWith('data:') || u.startsWith('blob:')) {
    return { displayUrl: u, localPath: '', source: 'memory' }
  }

  // 检查是否有正在进行的缓存操作
  if (!options.forceRefresh && pendingCache.has(u)) {
    return pendingCache.get(u)!
  }

  const cachePromise = (async (): Promise<CacheResult> => {
    const t = await getTauri()
    
    // Tauri 环境：使用 Rust 后端
    if (t.isTauri) {
      return cacheTauri(u, category)
    }
    
    // Web 环境：使用 IndexedDB
    return cacheWeb(u, category, options.metadata)
  })()

  pendingCache.set(u, cachePromise)
  
  try {
    const result = await cachePromise
    if (result.displayUrl && !result.error) {
      urlToCacheId.set(u, generateCacheId(u, category))
    }
    return result
  } finally {
    pendingCache.delete(u)
  }
}

/**
 * Tauri 环境缓存
 */
const absolutizeNexusApiUrl = (url: string) => {
  const u = String(url || '').trim()
  if (!u) return u
  if (/^https?:\/\//i.test(u)) return u
  const prefixes = ['/v1/', '/v1beta', '/kling', '/tencent-vod', '/video']
  for (const p of prefixes) {
    if (u.startsWith(p)) return `https://nexusapi.cn${u}`
  }
  return u
}

const cacheTauri = async (url: string, category: CacheCategory): Promise<CacheResult> => {
  // 如果是相对路径，转换为绝对 URL
  const absoluteUrl = absolutizeNexusApiUrl(url)
  if (absoluteUrl !== url) {
    console.log(`[Cache:Tauri] 相对路径转换为绝对 URL:`, absoluteUrl.slice(0, 80))
  }
  
  if (!/^https?:\/\//i.test(absoluteUrl)) {
    return { displayUrl: absoluteUrl, localPath: '', source: 'direct' }
  }

  // 根据 URL 判断是图片还是视频
  const isVideo = /\.(mp4|webm|mov|m4v|m3u8)(\?|$)/i.test(absoluteUrl) ||
                  absoluteUrl.includes('/videos/') ||
                  absoluteUrl.includes('/video/')
  
  try {
    const token = getApiKey()
    const t = await getTauri()
    
    const command = isVideo ? 'cache_remote_media' : 'cache_remote_image'
    console.log(`[Cache:Tauri] 调用 ${command} 命令`)
    
    const path = await tauriInvoke<string>(command, { 
      url: absoluteUrl, 
      authToken: token || null 
    })
    
    if (!path) {
      console.error(`[Cache:Tauri] ${command} 返回空`)
      // 仅图片：缓存失败时尝试用插件 fetch 下载并转成 dataURL，确保画布可显示（尤其 Windows）
      if (!isVideo) {
        const dataUrl = await tryFetchImageAsDataUrlInTauri(absoluteUrl, token)
        if (dataUrl) {
          console.warn(`[Cache:Tauri] ${command} 返回空，已回退为 dataURL`)
          return { displayUrl: dataUrl, localPath: '', source: 'memory', error: '缓存失败，回退为 dataURL' }
        }
      }
      return { displayUrl: absoluteUrl, localPath: '', source: 'direct', error: '缓存失败，回退为原始URL' }
    }

    const displayUrl = t.convertFileSrc ? t.convertFileSrc(path) : absoluteUrl
    console.log(`[Cache:Tauri] 缓存成功:`, displayUrl.slice(0, 80))
    return { displayUrl, localPath: path, source: 'tauri' }
  } catch (err) {
    console.error(`[Cache:Tauri] 缓存异常:`, err)
    if (!isVideo) {
      const token = getApiKey()
      const dataUrl = await tryFetchImageAsDataUrlInTauri(absoluteUrl, token)
      if (dataUrl) {
        console.warn(`[Cache:Tauri] 缓存异常，已回退为 dataURL`)
        return { displayUrl: dataUrl, localPath: '', source: 'memory', error: `缓存异常，回退为 dataURL：${String(err)}` }
      }
    }
    return { displayUrl: absoluteUrl, localPath: '', source: 'direct', error: String(err) }
  }
}

/**
 * Web 环境缓存（使用 IndexedDB）
 */
const cacheWeb = async (
  url: string,
  category: CacheCategory,
  metadata?: Record<string, unknown>
): Promise<CacheResult> => {
  // 检查是否需要鉴权
  const needsAuth = (
    (/^https?:\/\//i.test(url) && url.includes('nexusapi.cn')) ||
    url.startsWith('/v1/')
  )
  
  const cacheId = generateCacheId(url, category)
  
  // 尝试从 IndexedDB 获取已缓存的数据
  const cached = await LocalCacheManager.getMedia(cacheId)
  if (cached) {
    console.log(`[Cache:Web] 从 IndexedDB 获取缓存:`, cacheId)
    return { displayUrl: cached, localPath: '', source: 'indexeddb' }
  }
  
  if (needsAuth) {
    try {
      const token = getApiKey()
      // 如果是绝对 URL (nexusapi.cn)，转换为相对路径通过代理
      let fetchUrl = url
      if (/^https?:\/\//i.test(url) && url.includes('nexusapi.cn')) {
        try {
          const parsed = new URL(url)
          fetchUrl = parsed.pathname + parsed.search
          console.log(`[Cache:Web] 转换绝对 URL 为相对路径:`, fetchUrl)
        } catch {
          // 保持原 URL
        }
      }
      
      console.log(`[Cache:Web] 下载需要鉴权的媒体:`, fetchUrl.slice(0, 80))
      const response = await fetch(fetchUrl, {
        headers: token ? { 'Authorization': `Bearer ${token}` } : {}
      })
      
      if (!response.ok) {
        console.error(`[Cache:Web] 下载失败:`, response.status)
        return { displayUrl: '', localPath: '', source: 'indexeddb', error: `下载失败: ${response.status}` }
      }
      
      const blob = await response.blob()
      
      // 保存到 IndexedDB
      const blobUrl = await LocalCacheManager.saveMedia(cacheId, blob, {
        category,
        sourceUrl: url,
        metadata
      })
      
      if (blobUrl) {
        console.log(`[Cache:Web] 已缓存到 IndexedDB:`, cacheId)
        urlToCacheId.set(url, cacheId)
        return { displayUrl: blobUrl, localPath: '', source: 'indexeddb' }
      }
      
      // IndexedDB 保存失败，使用临时 blob URL
      const tempBlobUrl = URL.createObjectURL(blob)
      console.log(`[Cache:Web] IndexedDB 保存失败，使用临时 blob URL`)
      return { displayUrl: tempBlobUrl, localPath: '', source: 'memory' }
    } catch (err) {
      console.error(`[Cache:Web] 缓存失败:`, err)
      return { displayUrl: '', localPath: '', source: 'indexeddb', error: String(err) }
    }
  }
  
  // 不需要鉴权的 URL 直接返回
  return { displayUrl: url, localPath: '', source: 'direct' }
}

/**
 * 清理指定分类的缓存
 */
export const clearCacheByCategory = async (category: CacheCategory): Promise<void> => {
  await LocalCacheManager.clearCategoryCache(category)
  
  // 清理内存映射
  for (const [url, id] of urlToCacheId.entries()) {
    if (id.startsWith(category)) {
      urlToCacheId.delete(url)
    }
  }
}

/**
 * 获取缓存统计信息
 */
export const getCacheStats = async () => {
  return LocalCacheManager.getCacheStats()
}

export const resolveCachedImageUrl = async (url: string): Promise<{ displayUrl: string; localPath: string; error?: string }> => {
  const u = String(url || '').trim()
  if (!u) return { displayUrl: '', localPath: '' }
  if (u.startsWith('data:') || u.startsWith('blob:')) return { displayUrl: u, localPath: '' }

  const t = await getTauri()
  
  // Tauri 环境：使用 Rust 端的 cache_remote_image 命令
  if (t.isTauri) {
    // 如果是相对路径，转换为绝对 URL（Tauri 没有 Vite 代理）
    const absoluteUrl = absolutizeNexusApiUrl(u)
    if (absoluteUrl !== u) {
      console.log('[resolveCachedImageUrl] Tauri: 相对路径转换为绝对 URL:', absoluteUrl.slice(0, 80))
    }
    if (!/^https?:\/\//i.test(absoluteUrl)) return { displayUrl: absoluteUrl, localPath: '' }

    // 非鉴权公网图片：直接使用原始 URL，避免 Tauri 额外缓存下载导致“后端完成但画布出图慢”
    // 注：需要鉴权的 URL（如 nexusapi.cn）仍然走 cache_remote_image，以便携带 Bearer 并落到本地文件
    if (!isLikelyAuthRequiredUrl(absoluteUrl)) {
      return { displayUrl: absoluteUrl, localPath: '' }
    }
    
    const token = getApiKey()
    try {
      console.log('[resolveCachedImageUrl] Tauri: 调用 cache_remote_image 命令')
      const path = await tauriInvoke<string>('cache_remote_image', { url: absoluteUrl, authToken: token || null })
      if (!path) {
        // 缓存失败时回退到原始 URL，而不是返回空（修复 Windows 图片不显示问题）
        console.warn('[resolveCachedImageUrl] Tauri: cache_remote_image 返回空，回退到原始 URL')
        // 若原始 URL 需要鉴权，<img> 无法携带 Authorization；这里兜底转成 dataURL 确保可显示
        const dataUrl = await tryFetchImageAsDataUrlInTauri(absoluteUrl, token)
        if (dataUrl) return { displayUrl: dataUrl, localPath: '', error: '缓存图片失败，已回退为 dataURL' }
        return { displayUrl: absoluteUrl, localPath: '', error: '缓存图片失败，使用原始URL' }
      }

      const displayUrl = t.convertFileSrc ? t.convertFileSrc(path) : absoluteUrl
      console.log('[resolveCachedImageUrl] Tauri: 缓存成功, displayUrl:', displayUrl.slice(0, 80))
      return { displayUrl, localPath: path }
    } catch (err) {
      // 缓存异常时回退到原始 URL（修复 Windows 图片不显示问题）
      console.error('[resolveCachedImageUrl] Tauri: cache_remote_image 异常，回退到原始 URL:', err)
      const dataUrl = await tryFetchImageAsDataUrlInTauri(absoluteUrl, token)
      if (dataUrl) return { displayUrl: dataUrl, localPath: '', error: `缓存图片异常，已回退为 dataURL：${String(err)}` }
      return { displayUrl: absoluteUrl, localPath: '', error: String(err) }
    }
  }
  
  // Web 环境：直接返回原始 URL（浏览器会处理 CORS）
  return { displayUrl: u, localPath: '' }
}

export const resolveCachedMediaUrl = async (url: string) => {
  const u = String(url || '').trim()
  if (!u) return { displayUrl: '', localPath: '' }
  if (u.startsWith('data:') || u.startsWith('blob:')) return { displayUrl: u, localPath: '' }

  const t = await getTauri()
  
  // Tauri 环境：使用 Rust 端的 cache_remote_media 命令（通过 reqwest 库发送 HTTP 请求）
  if (t.isTauri) {
    // 如果是相对路径，转换为绝对 URL（Tauri 没有 Vite 代理）
    const absoluteUrl = absolutizeNexusApiUrl(u)
    if (absoluteUrl !== u) {
      console.log('[resolveCachedMediaUrl] Tauri: 相对路径转换为绝对 URL:', absoluteUrl.slice(0, 80))
    }
    if (!/^https?:\/\//i.test(absoluteUrl)) return { displayUrl: absoluteUrl, localPath: '' }
    
    try {
      const token = getApiKey()
      console.log('[resolveCachedMediaUrl] Tauri: 调用 cache_remote_media 命令')
      const path = await tauriInvoke<string>('cache_remote_media', { url: absoluteUrl, authToken: token || null })
      if (!path) {
        // 缓存失败时回退到原始 URL（修复 Windows 媒体不显示问题）
        console.warn('[resolveCachedMediaUrl] Tauri: cache_remote_media 返回空，回退到原始 URL')
        return { displayUrl: absoluteUrl, localPath: '', error: '缓存媒体失败，使用原始URL' }
      }

      const displayUrl = t.convertFileSrc ? t.convertFileSrc(path) : absoluteUrl
      console.log('[resolveCachedMediaUrl] Tauri: 缓存成功, displayUrl:', displayUrl.slice(0, 80))
      return { displayUrl, localPath: path }
    } catch (err) {
      // 缓存异常时回退到原始 URL（修复 Windows 媒体不显示问题）
      console.error('[resolveCachedMediaUrl] Tauri: cache_remote_media 异常，回退到原始 URL:', err)
      return { displayUrl: absoluteUrl, localPath: '', error: String(err) }
    }
  }
  
  // Web 环境：检查是否需要鉴权的 URL
  // 1. nexusapi.cn 的绝对 URL
  // 2. /v1/ 开头的相对路径（通过 Vite 代理）
  const needsAuth = (
    (/^https?:\/\//i.test(u) && u.includes('nexusapi.cn')) ||
    u.startsWith('/v1/')
  )
  
  if (needsAuth) {
    try {
      const token = getApiKey()
      // 如果是绝对 URL (nexusapi.cn)，转换为相对路径通过代理
      let fetchUrl = u
      if (/^https?:\/\//i.test(u) && u.includes('nexusapi.cn')) {
        try {
          const parsed = new URL(u)
          fetchUrl = parsed.pathname + parsed.search
          console.log('[resolveCachedMediaUrl] 转换绝对 URL 为相对路径:', fetchUrl)
        } catch {
          // 保持原 URL
        }
      }
      console.log('[resolveCachedMediaUrl] Web 环境下载需要鉴权的视频:', fetchUrl.slice(0, 80))
      const response = await fetch(fetchUrl, {
        headers: token ? { 'Authorization': `Bearer ${token}` } : {}
      })
      if (!response.ok) {
        console.error('[resolveCachedMediaUrl] 下载失败:', response.status)
        // 返回空 URL，避免浏览器尝试直接加载需要鉴权的 URL
        return { displayUrl: '', localPath: '', error: `下载失败: ${response.status}` }
      }
      const blob = await response.blob()
      const blobUrl = URL.createObjectURL(blob)
      console.log('[resolveCachedMediaUrl] 转换为 blob URL:', blobUrl.slice(0, 50))
      return { displayUrl: blobUrl, localPath: '' }
    } catch (err) {
      console.error('[resolveCachedMediaUrl] 下载视频失败:', err)
      // 返回空 URL，避免浏览器尝试直接加载
      return { displayUrl: '', localPath: '', error: String(err) }
    }
  }
  
  return { displayUrl: u, localPath: '' }
}
