/**
 * IndexedDB 本地缓存存储层
 * 
 * 用于 Web 环境的媒体缓存，参考 Tapnow Studio 的 LocalImageManager 实现
 * Tauri 环境使用 Rust 后端，此模块仅用于纯 Web 环境
 */

const DB_NAME = 'nexus-cache'
const DB_VERSION = 1
const STORE_NAME = 'media'

// Blob URL 缓存（内存中）
const blobUrlCache = new Map<string, string>()

// 数据库实例
let dbInstance: IDBDatabase | null = null

/**
 * 初始化 IndexedDB
 */
const initDB = (): Promise<IDBDatabase | null> => {
  if (dbInstance) return Promise.resolve(dbInstance)

  return new Promise((resolve) => {
    try {
      const request = indexedDB.open(DB_NAME, DB_VERSION)

      request.onupgradeneeded = (event) => {
        const db = (event.target as IDBOpenDBRequest).result
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          const store = db.createObjectStore(STORE_NAME, { keyPath: 'id' })
          store.createIndex('category', 'category', { unique: false })
          store.createIndex('timestamp', 'timestamp', { unique: false })
        }
      }

      request.onsuccess = (event) => {
        dbInstance = (event.target as IDBOpenDBRequest).result
        resolve(dbInstance)
      }

      request.onerror = (event) => {
        console.error('[IndexedDB] 初始化失败:', (event.target as IDBOpenDBRequest).error)
        resolve(null)
      }
    } catch (err) {
      console.error('[IndexedDB] 初始化异常:', err)
      resolve(null)
    }
  })
}

/**
 * 媒体缓存条目
 */
export interface CacheEntry {
  id: string
  blob: Blob
  category: 'history' | 'characters' | 'storyboard' | 'general'
  mimeType: string
  timestamp: number
  sourceUrl?: string
  metadata?: Record<string, unknown>
}

/**
 * 保存媒体到 IndexedDB
 * 
 * @param id 唯一标识符
 * @param blob 媒体 Blob
 * @param options 可选配置
 * @returns 成功时返回 blob URL，失败返回 null
 */
export const saveMedia = async (
  id: string,
  blob: Blob,
  options: {
    category?: CacheEntry['category']
    sourceUrl?: string
    metadata?: Record<string, unknown>
  } = {}
): Promise<string | null> => {
  const db = await initDB()
  if (!db) return null

  return new Promise((resolve) => {
    try {
      const entry: CacheEntry = {
        id,
        blob,
        category: options.category || 'general',
        mimeType: blob.type || 'application/octet-stream',
        timestamp: Date.now(),
        sourceUrl: options.sourceUrl,
        metadata: options.metadata
      }

      const transaction = db.transaction([STORE_NAME], 'readwrite')
      const store = transaction.objectStore(STORE_NAME)
      const request = store.put(entry)

      request.onsuccess = () => {
        // 创建 blob URL 并缓存
        const blobUrl = URL.createObjectURL(blob)
        blobUrlCache.set(id, blobUrl)
        resolve(blobUrl)
      }

      request.onerror = () => {
        console.error('[IndexedDB] 保存失败:', request.error)
        resolve(null)
      }
    } catch (err) {
      console.error('[IndexedDB] 保存异常:', err)
      resolve(null)
    }
  })
}

/**
 * 从 IndexedDB 获取媒体
 * 
 * @param id 唯一标识符
 * @returns 成功时返回 blob URL，失败返回 null
 */
export const getMedia = async (id: string): Promise<string | null> => {
  // 优先从内存缓存获取
  if (blobUrlCache.has(id)) {
    return blobUrlCache.get(id) || null
  }

  const db = await initDB()
  if (!db) return null

  return new Promise((resolve) => {
    try {
      const transaction = db.transaction([STORE_NAME], 'readonly')
      const store = transaction.objectStore(STORE_NAME)
      const request = store.get(id)

      request.onsuccess = () => {
        const entry = request.result as CacheEntry | undefined
        if (entry?.blob) {
          const blobUrl = URL.createObjectURL(entry.blob)
          blobUrlCache.set(id, blobUrl)
          resolve(blobUrl)
        } else {
          resolve(null)
        }
      }

      request.onerror = () => {
        console.error('[IndexedDB] 获取失败:', request.error)
        resolve(null)
      }
    } catch (err) {
      console.error('[IndexedDB] 获取异常:', err)
      resolve(null)
    }
  })
}

/**
 * 检查媒体是否存在
 */
export const hasMedia = async (id: string): Promise<boolean> => {
  if (blobUrlCache.has(id)) return true

  const db = await initDB()
  if (!db) return false

  return new Promise((resolve) => {
    try {
      const transaction = db.transaction([STORE_NAME], 'readonly')
      const store = transaction.objectStore(STORE_NAME)
      const request = store.count(IDBKeyRange.only(id))

      request.onsuccess = () => {
        resolve(request.result > 0)
      }

      request.onerror = () => {
        resolve(false)
      }
    } catch {
      resolve(false)
    }
  })
}

/**
 * 删除媒体
 */
export const deleteMedia = async (id: string): Promise<boolean> => {
  // 释放 blob URL
  if (blobUrlCache.has(id)) {
    const url = blobUrlCache.get(id)
    if (url?.startsWith('blob:')) {
      URL.revokeObjectURL(url)
    }
    blobUrlCache.delete(id)
  }

  const db = await initDB()
  if (!db) return false

  return new Promise((resolve) => {
    try {
      const transaction = db.transaction([STORE_NAME], 'readwrite')
      const store = transaction.objectStore(STORE_NAME)
      const request = store.delete(id)

      request.onsuccess = () => resolve(true)
      request.onerror = () => resolve(false)
    } catch {
      resolve(false)
    }
  })
}

/**
 * 按分类获取所有媒体 ID
 */
export const getMediaIdsByCategory = async (
  category: CacheEntry['category']
): Promise<string[]> => {
  const db = await initDB()
  if (!db) return []

  return new Promise((resolve) => {
    try {
      const transaction = db.transaction([STORE_NAME], 'readonly')
      const store = transaction.objectStore(STORE_NAME)
      const index = store.index('category')
      const request = index.getAllKeys(IDBKeyRange.only(category))

      request.onsuccess = () => {
        resolve(request.result as string[])
      }

      request.onerror = () => {
        resolve([])
      }
    } catch {
      resolve([])
    }
  })
}

/**
 * 清理指定分类的所有缓存
 */
export const clearCategoryCache = async (
  category: CacheEntry['category']
): Promise<void> => {
  const ids = await getMediaIdsByCategory(category)
  for (const id of ids) {
    await deleteMedia(id)
  }
}

/**
 * 清理所有缓存
 */
export const clearAllCache = async (): Promise<void> => {
  // 释放所有 blob URL
  for (const url of blobUrlCache.values()) {
    if (url.startsWith('blob:')) {
      URL.revokeObjectURL(url)
    }
  }
  blobUrlCache.clear()

  const db = await initDB()
  if (!db) return

  return new Promise((resolve) => {
    try {
      const transaction = db.transaction([STORE_NAME], 'readwrite')
      const store = transaction.objectStore(STORE_NAME)
      store.clear()
      transaction.oncomplete = () => resolve()
      transaction.onerror = () => resolve()
    } catch {
      resolve()
    }
  })
}

/**
 * 获取缓存统计
 */
export const getCacheStats = async (): Promise<{
  totalCount: number
  categories: Record<string, number>
}> => {
  const db = await initDB()
  if (!db) return { totalCount: 0, categories: {} }

  return new Promise((resolve) => {
    try {
      const transaction = db.transaction([STORE_NAME], 'readonly')
      const store = transaction.objectStore(STORE_NAME)
      
      const countRequest = store.count()
      const categories: Record<string, number> = {}

      countRequest.onsuccess = () => {
        const totalCount = countRequest.result

        // 按分类统计
        const index = store.index('category')
        const cursorRequest = index.openCursor()
        
        cursorRequest.onsuccess = (event) => {
          const cursor = (event.target as IDBRequest).result as IDBCursorWithValue | null
          if (cursor) {
            const cat = cursor.value.category || 'unknown'
            categories[cat] = (categories[cat] || 0) + 1
            cursor.continue()
          } else {
            resolve({ totalCount, categories })
          }
        }

        cursorRequest.onerror = () => {
          resolve({ totalCount, categories })
        }
      }

      countRequest.onerror = () => {
        resolve({ totalCount: 0, categories: {} })
      }
    } catch {
      resolve({ totalCount: 0, categories: {} })
    }
  })
}

/**
 * 从 URL 下载并缓存媒体
 */
export const cacheFromUrl = async (
  url: string,
  id?: string,
  options: {
    category?: CacheEntry['category']
    metadata?: Record<string, unknown>
  } = {}
): Promise<string | null> => {
  try {
    const response = await fetch(url)
    if (!response.ok) {
      console.warn('[IndexedDB] 下载失败:', url, response.status)
      return null
    }

    const blob = await response.blob()
    const cacheId = id || generateCacheId(url)
    
    return await saveMedia(cacheId, blob, {
      ...options,
      sourceUrl: url
    })
  } catch (err) {
    console.warn('[IndexedDB] 缓存失败:', url, err)
    return null
  }
}

/**
 * 生成缓存 ID
 */
const generateCacheId = (url: string): string => {
  // 简单哈希函数
  let hash = 0
  for (let i = 0; i < url.length; i++) {
    const char = url.charCodeAt(i)
    hash = ((hash << 5) - hash) + char
    hash = hash & hash
  }
  return `cache_${Math.abs(hash).toString(36)}_${Date.now().toString(36)}`
}

/**
 * 导出统一接口
 */
export const LocalCacheManager = {
  initDB,
  saveMedia,
  getMedia,
  hasMedia,
  deleteMedia,
  getMediaIdsByCategory,
  clearCategoryCache,
  clearAllCache,
  getCacheStats,
  cacheFromUrl
}

export default LocalCacheManager
