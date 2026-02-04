/**
 * Assets Store | 资产存储 (Zustand + TypeScript)
 * Tracks all generated images, videos, and audio for history panel
 */

import { create } from 'zustand'
import { fetch as tauriFetch } from '@tauri-apps/plugin-http'

// 检测 Tauri 环境
const isTauri = typeof window !== 'undefined' && !!(window as any).__TAURI_INTERNALS__

// 根据环境选择 fetch 实现（带兜底）
// Windows 用户环境下 Tauri plugin-http 可能因代理/证书链问题失败，fallback 到 WebView fetch
const webFetch = globalThis.fetch ? globalThis.fetch.bind(globalThis) : (async () => { throw new Error('fetch is not available') }) as typeof fetch
const safeFetch: typeof fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  if (!isTauri) return await webFetch(input, init)
  try {
    return await (tauriFetch as typeof fetch)(input, init)
  } catch (err: any) {
    console.warn('[assets.safeFetch] tauriFetch failed, fallback:', String(err?.message || '').slice(0, 120))
    return await webFetch(input, init)
  }
}) as typeof fetch

// ==================== Types ====================

export type AssetType = 'image' | 'video' | 'audio'

export interface Asset {
  id: string
  type: AssetType
  src: string
  title?: string
  model?: string
  duration?: number
  createdAt: number
  localCacheUrl?: string
  localFilePath?: string
}

export type HistoryPerformanceMode = 'off' | 'normal' | 'ultra'

interface AssetsState {
  assets: Asset[]
  historyPerformanceMode: HistoryPerformanceMode
  localCacheEnabled: boolean
  localCacheBaseUrl: string
  isLoading: boolean

  // Actions
  loadAssets: () => Promise<void>
  addAsset: (asset: Omit<Asset, 'id' | 'createdAt'>) => string
  removeAsset: (id: string) => void
  clearAssets: () => void
  updateAsset: (id: string, data: Partial<Asset>) => boolean
  getAssetsByType: (type: AssetType) => Asset[]
  setHistoryPerformanceMode: (mode: HistoryPerformanceMode) => void
  setLocalCacheEnabled: (enabled: boolean) => void
  setLocalCacheBaseUrl: (url: string) => void
}

// ==================== Constants ====================

const MAX_ASSETS = 100
const DB_NAME = 'nexus-ai-assets'
const DB_VERSION = 1
const STORE_NAME = 'asset_history'
const HISTORY_KEY = '__asset_history__'
const HISTORY_PERF_KEY = 'nexus-history-performance'
const LOCAL_CACHE_ENABLED_KEY = 'nexus-local-cache-enabled'
const LOCAL_CACHE_BASE_URL_KEY = 'nexus-local-cache-base-url'
const LEGACY_STORAGE_KEY = 'nexus-asset-history'

// ==================== IndexedDB Utilities ====================

let dbPromise: Promise<IDBDatabase> | null = null

const getDb = (): Promise<IDBDatabase> => {
  if (typeof indexedDB === 'undefined') {
    return Promise.reject(new Error('IndexedDB 不可用'))
  }
  if (dbPromise) return dbPromise
  
  dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION)
    request.onupgradeneeded = () => {
      const db = request.result
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME)
      }
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
  
  return dbPromise
}

const idbGet = async <T>(key: string): Promise<T | null> => {
  const db = await getDb()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly')
    const store = tx.objectStore(STORE_NAME)
    const req = store.get(key)
    req.onsuccess = () => resolve(req.result || null)
    req.onerror = () => reject(req.error)
  })
}

const idbSet = async (key: string, value: unknown): Promise<boolean> => {
  const db = await getDb()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite')
    const store = tx.objectStore(STORE_NAME)
    const req = store.put(value, key)
    req.onsuccess = () => resolve(true)
    req.onerror = () => reject(req.error)
  })
}

const sanitizeForIdb = (list: Asset[]): Asset[] => {
  if (!Array.isArray(list)) return []
  return list.map((a) => ({
    id: a.id,
    type: a.type,
    src: a.src,
    title: a.title,
    model: a.model,
    duration: a.duration,
    createdAt: a.createdAt,
    localCacheUrl: a.localCacheUrl,
    localFilePath: a.localFilePath,
  }))
}

// ==================== LocalStorage Utilities ====================

const loadLocalPrefs = () => {
  let historyPerformanceMode: HistoryPerformanceMode = 'normal'
  let localCacheEnabled = false
  let localCacheBaseUrl = 'http://127.0.0.1:9527'

  try {
    const perf = localStorage.getItem(HISTORY_PERF_KEY)
    if (perf && ['off', 'normal', 'ultra'].includes(perf)) {
      historyPerformanceMode = perf as HistoryPerformanceMode
    }
  } catch {
    // ignore
  }

  try {
    localCacheEnabled = localStorage.getItem(LOCAL_CACHE_ENABLED_KEY) === 'true'
  } catch {
    // ignore
  }

  try {
    const base = localStorage.getItem(LOCAL_CACHE_BASE_URL_KEY)
    if (base) localCacheBaseUrl = base
  } catch {
    // ignore
  }

  return { historyPerformanceMode, localCacheEnabled, localCacheBaseUrl }
}

// ==================== Debounced Save ====================

let saveTimeout: ReturnType<typeof setTimeout> | null = null

const scheduleSave = (assets: Asset[]) => {
  if (saveTimeout) clearTimeout(saveTimeout)
  saveTimeout = setTimeout(async () => {
    try {
      await idbSet(HISTORY_KEY, sanitizeForIdb(assets))
    } catch (err) {
      console.error('Failed to save assets:', err)
    }
  }, 500)
}

// ==================== Store ====================

const initialPrefs = loadLocalPrefs()

export const useAssetsStore = create<AssetsState>((set, get) => ({
  assets: [],
  historyPerformanceMode: initialPrefs.historyPerformanceMode,
  localCacheEnabled: initialPrefs.localCacheEnabled,
  localCacheBaseUrl: initialPrefs.localCacheBaseUrl,
  isLoading: false,

  loadAssets: async () => {
    set({ isLoading: true })
    
    try {
      // Try IndexedDB first
      const stored = await idbGet<Asset[]>(HISTORY_KEY)
      if (Array.isArray(stored)) {
        set({ assets: stored, isLoading: false })
        return
      }
    } catch {
      // ignore and fallback
    }

    // Fallback to legacy localStorage
    try {
      const stored = localStorage.getItem(LEGACY_STORAGE_KEY)
      if (stored) {
        const parsed = JSON.parse(stored) as Asset[]
        set({ assets: parsed, isLoading: false })
        
        // Migrate to IndexedDB
        try {
          await idbSet(HISTORY_KEY, sanitizeForIdb(parsed))
          localStorage.removeItem(LEGACY_STORAGE_KEY)
        } catch {
          // ignore
        }
        return
      }
    } catch (err) {
      console.error('Failed to load assets:', err)
    }

    set({ assets: [], isLoading: false })
  },

  addAsset: (asset) => {
    const id = `asset-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    const newAsset: Asset = {
      id,
      type: asset.type || 'image',
      src: asset.src,
      title: asset.title || '',
      model: asset.model || '',
      duration: asset.duration || 0,
      createdAt: Date.now(),
      localCacheUrl: asset.localCacheUrl || '',
      localFilePath: asset.localFilePath || '',
    }

    set((state) => {
      const next = [newAsset, ...state.assets].slice(0, MAX_ASSETS)
      scheduleSave(next)
      return { assets: next }
    })

    return id
  },

  removeAsset: (id) => {
    set((state) => {
      const next = state.assets.filter((a) => a.id !== id)
      scheduleSave(next)
      return { assets: next }
    })
  },

  clearAssets: () => {
    set({ assets: [] })
    scheduleSave([])
  },

  updateAsset: (id, data) => {
    const state = get()
    const index = state.assets.findIndex((a) => a.id === id)
    if (index === -1) return false

    set((state) => {
      const next = state.assets.slice()
      next[index] = { ...next[index], ...data }
      scheduleSave(next)
      return { assets: next }
    })

    return true
  },

  getAssetsByType: (type) => {
    return get().assets.filter((a) => a.type === type)
  },

  setHistoryPerformanceMode: (mode) => {
    if (!['off', 'normal', 'ultra'].includes(mode)) return
    set({ historyPerformanceMode: mode })
    try {
      localStorage.setItem(HISTORY_PERF_KEY, mode)
    } catch {
      // ignore
    }
  },

  setLocalCacheEnabled: (enabled) => {
    set({ localCacheEnabled: enabled })
    try {
      localStorage.setItem(LOCAL_CACHE_ENABLED_KEY, enabled ? 'true' : 'false')
    } catch {
      // ignore
    }
  },

  setLocalCacheBaseUrl: (url) => {
    set({ localCacheBaseUrl: url || '' })
    try {
      localStorage.setItem(LOCAL_CACHE_BASE_URL_KEY, url || '')
    } catch {
      // ignore
    }
  },
}))

// ==================== Thumbnail Utilities ====================

const thumbnailCache = new Map<string, string>()
const thumbnailFailures = new Set<string>()
const thumbnailQueue: Array<{ asset: Asset; mode: HistoryPerformanceMode }> = []
const thumbnailQueued = new Set<string>()
let thumbnailRunning = false

const THUMBNAIL_PRESETS = {
  ultra: { size: 80, quality: 0.3 },
  normal: { size: 150, quality: 0.6 },
}

const getThumbnailKey = (assetId: string, mode: HistoryPerformanceMode): string =>
  `${assetId}:${mode}`

const createImageThumbnail = (
  src: string,
  { size, quality }: { size: number; quality: number }
): Promise<string> => {
  if (!src) return Promise.resolve('')
  
  return new Promise((resolve) => {
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => {
      const scale = Math.min(size / img.width, size / img.height, 1)
      const targetW = Math.max(1, Math.round(img.width * scale))
      const targetH = Math.max(1, Math.round(img.height * scale))
      const canvas = document.createElement('canvas')
      canvas.width = targetW
      canvas.height = targetH
      const ctx = canvas.getContext('2d')
      if (!ctx) {
        resolve('')
        return
      }
      ctx.drawImage(img, 0, 0, targetW, targetH)
      try {
        const dataUrl = canvas.toDataURL('image/jpeg', quality)
        resolve(dataUrl || '')
      } catch {
        resolve('')
      }
    }
    img.onerror = () => resolve('')
    img.src = src
  })
}

const processThumbnailQueue = async () => {
  if (thumbnailRunning) return
  if (thumbnailQueue.length === 0) return
  thumbnailRunning = true

  while (thumbnailQueue.length > 0) {
    const batch = thumbnailQueue.splice(0, 5)
    for (const item of batch) {
      const { asset, mode } = item
      const key = getThumbnailKey(asset.id, mode)
      thumbnailQueued.delete(key)
      if (thumbnailFailures.has(key)) continue
      if (thumbnailCache.has(key)) continue
      if (asset.type !== 'image') continue

      const preset = THUMBNAIL_PRESETS[mode as 'normal' | 'ultra']
      if (!preset) continue
      const thumb = await createImageThumbnail(asset.src, preset)
      if (!thumb) {
        thumbnailFailures.add(key)
        continue
      }
      thumbnailCache.set(key, thumb)
    }

    await new Promise((resolve) => setTimeout(resolve, 0))
  }

  thumbnailRunning = false
}

export const getAssetThumbnail = (asset: Asset, mode: HistoryPerformanceMode): string => {
  if (!asset || !mode || mode === 'off') return ''
  return thumbnailCache.get(getThumbnailKey(asset.id, mode)) || ''
}

export const enqueueThumbnails = (list: Asset[], mode: HistoryPerformanceMode): void => {
  if (!Array.isArray(list)) return
  if (mode === 'off') return
  if (!THUMBNAIL_PRESETS[mode as 'normal' | 'ultra']) return

  list.forEach((asset) => {
    if (!asset || asset.type !== 'image') return
    const key = getThumbnailKey(asset.id, mode)
    if (thumbnailCache.has(key) || thumbnailFailures.has(key) || thumbnailQueued.has(key)) return
    thumbnailQueued.add(key)
    thumbnailQueue.push({ asset, mode })
  })

  if (thumbnailQueue.length > 0) {
    if (typeof requestIdleCallback === 'function') {
      requestIdleCallback(
        () => {
          processThumbnailQueue().catch(() => {})
        },
        { timeout: 1200 }
      )
    } else {
      setTimeout(() => {
        processThumbnailQueue().catch(() => {})
      }, 0)
    }
  }
}

// ==================== Download Utilities ====================

const isDataUrl = (value: string): boolean =>
  typeof value === 'string' && value.startsWith('data:')

const fetchAsDataUrl = async (url: string): Promise<string> => {
  if (!url) return ''
  if (isDataUrl(url)) return url
  const res = await safeFetch(url)
  if (!res.ok) return ''
  const blob = await res.blob()
  return await new Promise((resolve) => {
    const reader = new FileReader()
    reader.onloadend = () =>
      resolve(typeof reader.result === 'string' ? reader.result : '')
    reader.onerror = () => resolve('')
    reader.readAsDataURL(blob)
  })
}

const getExtFromDataUrl = (dataUrl: string): string => {
  if (!dataUrl || !dataUrl.startsWith('data:')) return ''
  const match = dataUrl.match(/^data:([^;]+);/)
  const mime = match?.[1] || ''
  if (mime.includes('png')) return '.png'
  if (mime.includes('jpeg') || mime.includes('jpg')) return '.jpg'
  if (mime.includes('webp')) return '.webp'
  if (mime.includes('gif')) return '.gif'
  if (mime.includes('mp4')) return '.mp4'
  if (mime.includes('mpeg')) return '.mp3'
  return ''
}

const normalizeBaseUrl = (baseUrl: string): string => {
  if (!baseUrl) return ''
  return baseUrl.replace(/\/$/, '')
}

const triggerBrowserDownload = (url: string, filename: string): boolean => {
  if (!url || typeof document === 'undefined') return false
  const link = document.createElement('a')
  link.href = url
  if (filename) link.download = filename
  link.rel = 'noopener'
  link.click()
  return true
}

export interface SaveAssetResult {
  ok: boolean
  reason?: string
  localUrl?: string
}

export const saveAssetToLocal = async ({
  url,
  name,
  type,
  allowFallbackDownload = true,
}: {
  url: string
  name?: string
  type?: AssetType
  allowFallbackDownload?: boolean
}): Promise<SaveAssetResult> => {
  if (!url) return { ok: false, reason: 'missing_url' }

  const state = useAssetsStore.getState()
  const canUseCache = /^https?:/i.test(url) || isDataUrl(url)

  if (canUseCache && state.localCacheEnabled && state.localCacheBaseUrl) {
    const base = normalizeBaseUrl(state.localCacheBaseUrl)
    if (base) {
      try {
        const content = await fetchAsDataUrl(url)
        if (!content) throw new Error('读取素材失败')
        const ext =
          getExtFromDataUrl(content) ||
          (type === 'video' ? '.mp4' : type === 'audio' ? '.mp3' : '.jpg')
        const filename = name ? `${name}${ext}` : `asset_${Date.now()}${ext}`
        const resp = await safeFetch(`${base}/save-batch`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            files: [{ filename, content }],
            subfolder: '',
          }),
        })
        if (resp.ok) {
          const data = (await resp.json().catch(() => ({}))) as {
            success?: boolean
            results?: Array<{ url?: string }>
          }
          return {
            ok: Boolean(data?.success),
            localUrl: data?.results?.[0]?.url || '',
          }
        }
      } catch {
        // ignore and fallback
      }
    }
  }

  if (!allowFallbackDownload) {
    return { ok: false, reason: 'cache_failed' }
  }

  const ext = type === 'video' ? 'mp4' : type === 'audio' ? 'mp3' : 'png'
  const filename = name ? `${name}.${ext}` : `asset.${ext}`
  return { ok: triggerBrowserDownload(url, filename) }
}

// ==================== Local Cache Utilities ====================

const localCacheQueue: Asset[] = []
const localCacheQueued = new Set<string>()
const localCacheFailures = new Set<string>()
let localCacheRunning = false

const saveToLocalCache = async (
  asset: Asset,
  category = 'history'
): Promise<{ url: string; path: string } | null> => {
  if (!asset || !asset.src) return null
  const state = useAssetsStore.getState()
  if (!state.localCacheEnabled || !state.localCacheBaseUrl) return null
  
  const base = normalizeBaseUrl(state.localCacheBaseUrl)
  if (!base) return null

  const content = await fetchAsDataUrl(asset.src)
  if (!content) return null

  const ext =
    getExtFromDataUrl(content) ||
    (asset.type === 'video' ? '.mp4' : asset.type === 'audio' ? '.mp3' : '.jpg')
  const payload = {
    id: asset.id,
    content,
    category,
    ext,
    type: asset.type === 'video' ? 'video' : asset.type === 'audio' ? 'audio' : 'image',
  }

  try {
    const res = await safeFetch(`${base}/save-cache`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
    if (!res.ok) return null
    const data = (await res.json().catch(() => null)) as {
      success?: boolean
      url?: string
      path?: string
    } | null
    if (!data?.success) return null
    return { url: data.url || '', path: data.path || '' }
  } catch {
    return null
  }
}

const processLocalCacheQueue = async () => {
  if (localCacheRunning) return
  if (localCacheQueue.length === 0) return
  localCacheRunning = true

  while (localCacheQueue.length > 0) {
    const batch = localCacheQueue.splice(0, 2)
    for (const asset of batch) {
      if (!asset || !asset.id) continue
      localCacheQueued.delete(asset.id)
      if (asset.localCacheUrl) continue
      if (localCacheFailures.has(asset.id)) continue

      const result = await saveToLocalCache(asset, 'history')
      if (!result?.url) {
        localCacheFailures.add(asset.id)
        continue
      }
      useAssetsStore.getState().updateAsset(asset.id, {
        localCacheUrl: result.url,
        localFilePath: result.path || '',
      })
    }

    await new Promise((resolve) => setTimeout(resolve, 0))
  }

  localCacheRunning = false
}

export const enqueueLocalCache = (list: Asset[]): void => {
  if (!Array.isArray(list)) return
  const state = useAssetsStore.getState()
  if (!state.localCacheEnabled) return
  const base = normalizeBaseUrl(state.localCacheBaseUrl)
  if (!base) return

  list.forEach((asset) => {
    if (!asset || !asset.src) return
    if (asset.localCacheUrl) return
    if (!['image', 'video'].includes(asset.type)) return
    if (localCacheFailures.has(asset.id)) return
    if (localCacheQueued.has(asset.id)) return
    localCacheQueued.add(asset.id)
    localCacheQueue.push(asset)
  })

  if (localCacheQueue.length > 0) {
    if (typeof requestIdleCallback === 'function') {
      requestIdleCallback(
        () => {
          processLocalCacheQueue().catch(() => {})
        },
        { timeout: 1200 }
      )
    } else {
      setTimeout(() => {
        processLocalCacheQueue().catch(() => {})
      }, 0)
    }
  }
}

export const getLocalCacheUrl = (asset: Asset | null | undefined): string => {
  if (!asset) return ''
  const state = useAssetsStore.getState()
  if (!state.localCacheEnabled) return ''
  return asset.localCacheUrl || ''
}

export default useAssetsStore
