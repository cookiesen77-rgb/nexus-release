/**
 * Assets store | 资产存储
 * Tracks all generated images and videos for history panel
 */
import { ref, watch, toRaw } from 'vue'
import { fetch as tauriFetch } from '@tauri-apps/plugin-http'

// 检测 Tauri 环境
const isTauri = typeof window !== 'undefined' && !!window.__TAURI_INTERNALS__

// 根据环境选择 fetch 实现（Windows Tauri 必须用插件 fetch）
const safeFetch = isTauri ? tauriFetch : globalThis.fetch

const LEGACY_STORAGE_KEY = 'nexus-asset-history'
const MAX_ASSETS = 100
const HISTORY_PERF_KEY = 'nexus-history-performance'
const LOCAL_CACHE_ENABLED_KEY = 'nexus-local-cache-enabled'
const LOCAL_CACHE_BASE_URL_KEY = 'nexus-local-cache-base-url'

export const assets = ref([])
export const historyPerformanceMode = ref('normal')
export const localCacheEnabled = ref(false)
export const localCacheBaseUrl = ref('http://127.0.0.1:9527')

const thumbnailCache = new Map()
const thumbnailFailures = new Set()
const thumbnailQueue = []
const thumbnailQueued = new Set()
let thumbnailRunning = false
const localCacheQueue = []
const localCacheQueued = new Set()
const localCacheFailures = new Set()
let localCacheRunning = false

const THUMBNAIL_PRESETS = {
  ultra: { size: 80, quality: 0.3 },
  normal: { size: 150, quality: 0.6 }
}

const isValidPerfMode = (mode) => ['off', 'normal', 'ultra'].includes(mode)

// IndexedDB storage (avoid localStorage quota + huge JSON stringify) | 用 IndexedDB 存储（避免 localStorage 配额与 stringify 卡顿）
const DB_NAME = 'nexus-ai-assets'
const DB_VERSION = 1
const STORE_NAME = 'asset_history'
const HISTORY_KEY = '__asset_history__'
let dbPromise = null

const getDb = () => {
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

const idbGet = async (key) => {
  const db = await getDb()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly')
    const store = tx.objectStore(STORE_NAME)
    const req = store.get(key)
    req.onsuccess = () => resolve(req.result || null)
    req.onerror = () => reject(req.error)
  })
}

const idbSet = async (key, value) => {
  const db = await getDb()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite')
    const store = tx.objectStore(STORE_NAME)
    const req = store.put(value, key)
    req.onsuccess = () => resolve(true)
    req.onerror = () => reject(req.error)
  })
}

const sanitizeForIdb = (list) => {
  const raw = toRaw(list)
  if (!Array.isArray(raw)) return []
  // Assets are flat objects; shallow copy is enough for structured clone | 资产对象扁平，浅拷贝即可
  return raw.map((a) => ({
    id: a.id,
    type: a.type,
    src: a.src,
    title: a.title,
    model: a.model,
    duration: a.duration,
    createdAt: a.createdAt,
    localCacheUrl: a.localCacheUrl,
    localFilePath: a.localFilePath
  }))
}

const loadLocalPrefs = () => {
  try {
    const perf = localStorage.getItem(HISTORY_PERF_KEY)
    if (perf && isValidPerfMode(perf)) {
      historyPerformanceMode.value = perf
    }
  } catch {
    // ignore
  }

  try {
    localCacheEnabled.value = localStorage.getItem(LOCAL_CACHE_ENABLED_KEY) === 'true'
  } catch {
    // ignore
  }

  try {
    const base = localStorage.getItem(LOCAL_CACHE_BASE_URL_KEY)
    if (base) localCacheBaseUrl.value = base
  } catch {
    // ignore
  }
}

loadLocalPrefs()

// Load from IndexedDB (fallback to legacy localStorage) | 从 IndexedDB 加载（回退旧 localStorage）
export const loadAssets = async () => {
  try {
    const stored = await idbGet(HISTORY_KEY)
    if (Array.isArray(stored)) {
      assets.value = stored
      return
    }
  } catch {
    // ignore and fallback
  }

  try {
    const stored = localStorage.getItem(LEGACY_STORAGE_KEY)
    if (stored) {
      assets.value = JSON.parse(stored)
      // Migrate to IndexedDB then clear legacy key | 迁移到 IndexedDB 并清理旧 key
      try {
        await idbSet(HISTORY_KEY, sanitizeForIdb(assets.value))
        localStorage.removeItem(LEGACY_STORAGE_KEY)
      } catch {
        // ignore
      }
    }
  } catch (err) {
    console.error('Failed to load assets:', err)
    assets.value = []
  }
}

// Save to IndexedDB | 保存到 IndexedDB
const saveAssets = async () => {
  try {
    await idbSet(HISTORY_KEY, sanitizeForIdb(assets.value))
  } catch (err) {
    console.error('Failed to save assets:', err)
  }
}

// Auto-save on changes | 变化时自动保存
let saveTimeout = null
watch(assets, () => {
  if (saveTimeout) clearTimeout(saveTimeout)
  saveTimeout = setTimeout(() => {
    saveAssets()
  }, 500)
}, { deep: true })

watch(historyPerformanceMode, (mode) => {
  if (!isValidPerfMode(mode)) return
  try {
    localStorage.setItem(HISTORY_PERF_KEY, mode)
  } catch {
    // ignore
  }
})

watch(localCacheEnabled, (val) => {
  try {
    localStorage.setItem(LOCAL_CACHE_ENABLED_KEY, val ? 'true' : 'false')
  } catch {
    // ignore
  }
})

watch(localCacheBaseUrl, (val) => {
  try {
    localStorage.setItem(LOCAL_CACHE_BASE_URL_KEY, val || '')
  } catch {
    // ignore
  }
})

/**
 * Add asset to history | 添加资产到历史
 * @param {object} asset - { type: 'image' | 'video' | 'audio', src: string, title?: string, model?: string, duration?: number }
 */
export const addAsset = (asset) => {
  const newAsset = {
    id: `asset-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    type: asset.type || 'image',
    src: asset.src,
    title: asset.title || '',
    model: asset.model || '',
    duration: asset.duration || 0,
    createdAt: Date.now(),
    localCacheUrl: asset.localCacheUrl || '',
    localFilePath: asset.localFilePath || ''
  }

  assets.value.unshift(newAsset)

  // Limit history size | 限制历史大小
  if (assets.value.length > MAX_ASSETS) {
    assets.value = assets.value.slice(0, MAX_ASSETS)
  }

  return newAsset.id
}

/**
 * Remove asset from history | 从历史删除资产
 */
export const removeAsset = (id) => {
  const index = assets.value.findIndex(a => a.id === id)
  if (index !== -1) {
    assets.value.splice(index, 1)
  }
}

/**
 * Clear all assets | 清空所有资产
 */
export const clearAssets = () => {
  assets.value = []
}

/**
 * Get assets by type | 按类型获取资产
 */
export const getAssetsByType = (type) => {
  return assets.value.filter(a => a.type === type)
}

export const updateAsset = (id, data) => {
  const index = assets.value.findIndex(a => a.id === id)
  if (index === -1) return false
  assets.value[index] = { ...assets.value[index], ...data }
  assets.value = assets.value.slice()
  return true
}

const normalizeBaseUrl = (baseUrl) => {
  if (!baseUrl) return ''
  return baseUrl.replace(/\/$/, '')
}

export const getLocalCacheUrl = (asset) => {
  if (!localCacheEnabled.value) return ''
  if (!asset) return ''
  return asset.localCacheUrl || ''
}

export const setHistoryPerformanceMode = (mode) => {
  if (!isValidPerfMode(mode)) return
  historyPerformanceMode.value = mode
}

export const setLocalCacheEnabled = (enabled) => {
  localCacheEnabled.value = Boolean(enabled)
}

export const setLocalCacheBaseUrl = (url) => {
  localCacheBaseUrl.value = url || ''
}

const getThumbnailKey = (assetId, mode) => `${assetId}:${mode}`

export const getAssetThumbnail = (asset, mode) => {
  if (!asset || !mode || mode === 'off') return ''
  return thumbnailCache.get(getThumbnailKey(asset.id, mode)) || ''
}

const createImageThumbnail = (src, { size, quality }) => {
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

      const preset = THUMBNAIL_PRESETS[mode]
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

export const enqueueThumbnails = (list, mode) => {
  if (!Array.isArray(list)) return
  if (mode === 'off') return
  if (!THUMBNAIL_PRESETS[mode]) return

  list.forEach((asset) => {
    if (!asset || asset.type !== 'image') return
    const key = getThumbnailKey(asset.id, mode)
    if (thumbnailCache.has(key) || thumbnailFailures.has(key) || thumbnailQueued.has(key)) return
    thumbnailQueued.add(key)
    thumbnailQueue.push({ asset, mode })
  })

  if (thumbnailQueue.length > 0) {
    if (typeof requestIdleCallback === 'function') {
      requestIdleCallback(() => {
        processThumbnailQueue().catch(() => {})
      }, { timeout: 1200 })
    } else {
      setTimeout(() => {
        processThumbnailQueue().catch(() => {})
      }, 0)
    }
  }
}

const isDataUrl = (value) => typeof value === 'string' && value.startsWith('data:')

const fetchAsDataUrl = async (url) => {
  if (!url) return ''
  if (isDataUrl(url)) return url
  const res = await safeFetch(url)
  if (!res.ok) return ''
  const blob = await res.blob()
  return await new Promise((resolve) => {
    const reader = new FileReader()
    reader.onloadend = () => resolve(typeof reader.result === 'string' ? reader.result : '')
    reader.onerror = () => resolve('')
    reader.readAsDataURL(blob)
  })
}

const getExtFromDataUrl = (dataUrl) => {
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

const saveToLocalCache = async (asset, category = 'history') => {
  if (!asset || !asset.src) return null
  if (!localCacheEnabled.value || !localCacheBaseUrl.value) return null
  const base = normalizeBaseUrl(localCacheBaseUrl.value)
  if (!base) return null

  const content = await fetchAsDataUrl(asset.src)
  if (!content) return null

  const ext = getExtFromDataUrl(content) || (asset.type === 'video' ? '.mp4' : asset.type === 'audio' ? '.mp3' : '.jpg')
  const payload = {
    id: asset.id,
    content,
    category,
    ext,
    type: asset.type === 'video' ? 'video' : asset.type === 'audio' ? 'audio' : 'image'
  }

  try {
    const res = await safeFetch(`${base}/save-cache`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    })
    if (!res.ok) return null
    const data = await res.json().catch(() => null)
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
      updateAsset(asset.id, {
        localCacheUrl: result.url,
        localFilePath: result.path || ''
      })
    }

    await new Promise((resolve) => setTimeout(resolve, 0))
  }

  localCacheRunning = false
}

export const enqueueLocalCache = (list) => {
  if (!Array.isArray(list)) return
  if (!localCacheEnabled.value) return
  const base = normalizeBaseUrl(localCacheBaseUrl.value)
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
      requestIdleCallback(() => {
        processLocalCacheQueue().catch(() => {})
      }, { timeout: 1200 })
    } else {
      setTimeout(() => {
        processLocalCacheQueue().catch(() => {})
      }, 0)
    }
  }
}

const triggerBrowserDownload = (url, filename) => {
  if (!url || typeof document === 'undefined') return false
  const link = document.createElement('a')
  link.href = url
  if (filename) link.download = filename
  link.rel = 'noopener'
  link.click()
  return true
}

export const saveAssetToLocal = async ({ url, name, type, allowFallbackDownload = true }) => {
  if (!url) return { ok: false, reason: 'missing_url' }

  const canUseCache = /^https?:/i.test(url) || isDataUrl(url)
  if (canUseCache && localCacheEnabled.value && localCacheBaseUrl.value) {
    const base = normalizeBaseUrl(localCacheBaseUrl.value)
    if (base) {
      try {
        const content = await fetchAsDataUrl(url)
        if (!content) throw new Error('读取素材失败')
        const ext = getExtFromDataUrl(content) || (type === 'video' ? '.mp4' : type === 'audio' ? '.mp3' : '.jpg')
        const filename = name ? `${name}${ext}` : `asset_${Date.now()}${ext}`
        const resp = await safeFetch(`${base}/save-batch`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            files: [{ filename, content }],
            subfolder: ''
          })
        })
        if (resp.ok) {
          const data = await resp.json().catch(() => ({}))
          return { ok: Boolean(data?.success), localUrl: data?.results?.[0]?.url || '' }
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

// Initialize on load | 加载时初始化
loadAssets()
