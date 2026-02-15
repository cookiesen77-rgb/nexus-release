/**
 * Media Storage Service - 媒体存储服务
 * 使用 IndexedDB 存储大型媒体数据（图片、视频）
 * 解决 localStorage 5MB 限制问题
 * 
 * 性能优化：
 * - LRU 缓存策略：自动清理最久未访问的数据
 * - 配额管理：防止存储空间耗尽
 */

import { safeFetch } from '@/lib/safeFetch'


const DB_NAME = 'nexus-media-storage'
const DB_VERSION = 2  // 升级版本以添加 lastAccessedAt 索引
const STORE_NAME = 'media'

// 存储配额（默认 500MB）
const MAX_STORAGE_SIZE = 500 * 1024 * 1024
// 清理时保留的最大数量
const MAX_RECORDS_AFTER_CLEANUP = 100

// ==================== IndexedDB 初始化 ====================

let dbPromise: Promise<IDBDatabase> | null = null

const getDb = (): Promise<IDBDatabase> => {
  if (typeof indexedDB === 'undefined') {
    return Promise.reject(new Error('IndexedDB 不可用'))
  }
  if (dbPromise) return dbPromise

  dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION)
    request.onupgradeneeded = (event) => {
      const db = request.result
      const oldVersion = event.oldVersion
      
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        const store = db.createObjectStore(STORE_NAME, { keyPath: 'id' })
        store.createIndex('nodeId', 'nodeId', { unique: false })
        store.createIndex('projectId', 'projectId', { unique: false })
        store.createIndex('createdAt', 'createdAt', { unique: false })
        store.createIndex('lastAccessedAt', 'lastAccessedAt', { unique: false })
      } else if (oldVersion < 2) {
        // 从版本 1 升级到版本 2：添加 lastAccessedAt 索引
        const tx = (event.target as IDBOpenDBRequest).transaction
        if (tx) {
          const store = tx.objectStore(STORE_NAME)
          if (!store.indexNames.contains('lastAccessedAt')) {
            store.createIndex('lastAccessedAt', 'lastAccessedAt', { unique: false })
          }
        }
      }
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })

  return dbPromise
}

// ==================== 类型定义 ====================

export interface MediaRecord {
  id: string
  nodeId: string
  projectId: string
  type: 'image' | 'video' | 'audio'
  data: string
  thumbnailData?: string
  sourceUrl?: string
  model?: string
  createdAt: number
  lastAccessedAt: number
}

// ==================== 核心 API ====================

/**
 * 保存媒体数据到 IndexedDB
 * 会自动检查配额，超出时触发 LRU 清理
 */
export const saveMedia = async (record: Omit<MediaRecord, 'id' | 'createdAt' | 'lastAccessedAt'>): Promise<string> => {
  const db = await getDb()
  const id = `media_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
  const now = Date.now()
  const fullRecord: MediaRecord = {
    ...record,
    id,
    createdAt: now,
    lastAccessedAt: now,
  }

  // 检查配额，超出时触发 LRU 清理（异步执行，不阻塞保存）
  void checkAndCleanupIfNeeded(record.data?.length || 0)

  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite')
    const store = tx.objectStore(STORE_NAME)
    const req = store.put(fullRecord)
    req.onsuccess = () => {
      console.log('[MediaStorage] 保存成功:', id, '大小:', Math.round((record.data?.length || 0) / 1024), 'KB')
      resolve(id)
    }
    req.onerror = () => reject(req.error)
  })
}

/**
 * 通过 ID 获取媒体数据
 * 会更新 lastAccessedAt 以支持 LRU 缓存
 */
export const getMedia = async (id: string): Promise<MediaRecord | null> => {
  const db = await getDb()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite')
    const store = tx.objectStore(STORE_NAME)
    const req = store.get(id)
    req.onsuccess = () => {
      const record = req.result as MediaRecord | undefined
      if (record) {
        // 更新最后访问时间（LRU）
        record.lastAccessedAt = Date.now()
        store.put(record)
      }
      resolve(record || null)
    }
    req.onerror = () => reject(req.error)
  })
}

/**
 * 通过节点 ID 获取媒体数据
 * 会更新 lastAccessedAt 以支持 LRU 缓存
 */
export const getMediaByNodeId = async (nodeId: string): Promise<MediaRecord | null> => {
  const db = await getDb()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite')
    const store = tx.objectStore(STORE_NAME)
    const index = store.index('nodeId')
    const req = index.get(nodeId)
    req.onsuccess = () => {
      const record = req.result as MediaRecord | undefined
      if (record) {
        // 更新最后访问时间（LRU）
        record.lastAccessedAt = Date.now()
        store.put(record)
      }
      resolve(record || null)
    }
    req.onerror = () => reject(req.error)
  })
}

/**
 * 删除媒体数据
 */
export const deleteMedia = async (id: string): Promise<boolean> => {
  const db = await getDb()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite')
    const store = tx.objectStore(STORE_NAME)
    const req = store.delete(id)
    req.onsuccess = () => resolve(true)
    req.onerror = () => reject(req.error)
  })
}

/**
 * 删除节点关联的所有媒体数据
 */
export const deleteMediaByNodeId = async (nodeId: string): Promise<number> => {
  const db = await getDb()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite')
    const store = tx.objectStore(STORE_NAME)
    const index = store.index('nodeId')
    const req = index.openCursor(IDBKeyRange.only(nodeId))
    let count = 0

    req.onsuccess = () => {
      const cursor = req.result
      if (cursor) {
        cursor.delete()
        count++
        cursor.continue()
      } else {
        resolve(count)
      }
    }
    req.onerror = () => reject(req.error)
  })
}

/**
 * 删除项目关联的所有媒体数据
 */
export const deleteMediaByProjectId = async (projectId: string): Promise<number> => {
  const db = await getDb()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite')
    const store = tx.objectStore(STORE_NAME)
    const index = store.index('projectId')
    const req = index.openCursor(IDBKeyRange.only(projectId))
    let count = 0

    req.onsuccess = () => {
      const cursor = req.result
      if (cursor) {
        cursor.delete()
        count++
        cursor.continue()
      } else {
        console.log('[MediaStorage] 清理项目媒体:', projectId, '数量:', count)
        resolve(count)
      }
    }
    req.onerror = () => reject(req.error)
  })
}

/**
 * 清理过期的媒体数据（超过 7 天）
 */
export const cleanupOldMedia = async (maxAgeDays = 7): Promise<number> => {
  const db = await getDb()
  const cutoff = Date.now() - maxAgeDays * 24 * 60 * 60 * 1000

  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite')
    const store = tx.objectStore(STORE_NAME)
    const index = store.index('createdAt')
    const req = index.openCursor(IDBKeyRange.upperBound(cutoff))
    let count = 0

    req.onsuccess = () => {
      const cursor = req.result
      if (cursor) {
        cursor.delete()
        count++
        cursor.continue()
      } else {
        console.log('[MediaStorage] 清理过期媒体, 数量:', count)
        resolve(count)
      }
    }
    req.onerror = () => reject(req.error)
  })
}

/**
 * 获取存储统计信息
 */
export const getStorageStats = async (): Promise<{ count: number; totalSize: number }> => {
  const db = await getDb()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly')
    const store = tx.objectStore(STORE_NAME)
    const req = store.openCursor()
    let count = 0
    let totalSize = 0

    req.onsuccess = () => {
      const cursor = req.result
      if (cursor) {
        count++
        totalSize += cursor.value.data?.length || 0
        cursor.continue()
      } else {
        resolve({ count, totalSize })
      }
    }
    req.onerror = () => reject(req.error)
  })
}

// ==================== 工具函数 ====================

/**
 * 通过 sourceUrl 查找已缓存的媒体（项目级缓存查找）
 * 用于避免重复下载相同资源
 */
export const getMediaBySourceUrl = async (sourceUrl: string, projectId?: string): Promise<MediaRecord | null> => {
  if (!sourceUrl) return null
  const db = await getDb()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly')
    const store = tx.objectStore(STORE_NAME)
    const req = projectId
      ? store.index('projectId').openCursor(IDBKeyRange.only(projectId))
      : store.openCursor()
    req.onsuccess = () => {
      const cursor = req.result
      if (cursor) {
        const record = cursor.value as MediaRecord
        if (record.sourceUrl === sourceUrl && record.data) {
          resolve(record)
          return
        }
        cursor.continue()
      } else {
        resolve(null)
      }
    }
    req.onerror = () => reject(req.error)
  })
}

/**
 * 缓存远程媒体到项目 IndexedDB
 * 下载 HTTP URL 的内容并以 data: URL 存储，确保即使源链接过期也能访问
 */
export const cacheRemoteMedia = async (opts: {
  url: string
  projectId: string
  nodeId?: string
  type?: 'image' | 'video' | 'audio'
  model?: string
}): Promise<MediaRecord | null> => {
  const url = String(opts.url || '').trim()
  if (!url || !url.startsWith('http')) return null

  // 先查缓存
  const existing = await getMediaBySourceUrl(url, opts.projectId)
  if (existing?.data) return existing

  // 下载并转为 data URL
  try {
    const token = (() => { try { return localStorage.getItem('apiKey') || '' } catch { return '' } })()
    const needsAuth = /nexusapi\.cn|yunwu\.ai/i.test(url) || url.startsWith('/v1/') || url.startsWith('/kling')
    const headers: Record<string, string> = {}
    if (needsAuth && token) headers.Authorization = `Bearer ${token}`

    const resp = await safeFetch(url, Object.keys(headers).length > 0 ? { headers } : undefined)
    if (!resp.ok) return null

    const blob = await resp.blob()
    if (blob.size > 50 * 1024 * 1024) return null // 跳过超大文件 >50MB

    const dataUrl = await new Promise<string>((resolve) => {
      const reader = new FileReader()
      reader.onloadend = () => resolve(String(reader.result || ''))
      reader.onerror = () => resolve('')
      reader.readAsDataURL(blob)
    })
    if (!dataUrl) return null

    const mediaId = await saveMedia({
      nodeId: opts.nodeId || `cache_${Date.now()}`,
      projectId: opts.projectId,
      type: opts.type || (blob.type.startsWith('video') ? 'video' : blob.type.startsWith('audio') ? 'audio' : 'image'),
      data: dataUrl,
      sourceUrl: url,
      model: opts.model,
    })

    return await getMedia(mediaId)
  } catch (err) {
    console.warn('[MediaStorage] cacheRemoteMedia failed:', url.slice(0, 80), err)
    return null
  }
}

/**
 * 获取项目的所有缓存媒体列表
 */
export const listMediaByProjectId = async (projectId: string): Promise<MediaRecord[]> => {
  const db = await getDb()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly')
    const store = tx.objectStore(STORE_NAME)
    const index = store.index('projectId')
    const req = index.getAll(IDBKeyRange.only(projectId))
    req.onsuccess = () => resolve((req.result as MediaRecord[]) || [])
    req.onerror = () => reject(req.error)
  })
}

/**
 * 检查数据是否是大型数据（需要存储到 IndexedDB）
 */
export const isLargeData = (data: string | undefined | null): boolean => {
  if (!data || typeof data !== 'string') return false
  // 超过 50KB 的数据被认为是大型数据
  return data.length > 50000
}

/**
 * 检查数据是否是 base64 数据
 */
export const isBase64Data = (data: string | undefined | null): boolean => {
  if (!data || typeof data !== 'string') return false
  return data.startsWith('data:')
}

// ==================== LRU 缓存管理 ====================

/**
 * 检查存储空间，超出配额时触发 LRU 清理
 */
const checkAndCleanupIfNeeded = async (newDataSize: number): Promise<void> => {
  try {
    const stats = await getStorageStats()
    const projectedSize = stats.totalSize + newDataSize
    
    if (projectedSize > MAX_STORAGE_SIZE) {
      console.log('[MediaStorage] 存储空间即将超出配额，触发 LRU 清理')
      await cleanupByLRU(projectedSize - MAX_STORAGE_SIZE + 50 * 1024 * 1024) // 多清理 50MB 缓冲
    }
  } catch (err) {
    console.warn('[MediaStorage] 配额检查失败:', err)
  }
}

/**
 * LRU 清理：删除最久未访问的记录，释放指定大小的空间
 * @param targetBytes 目标释放空间（字节）
 * @returns 删除的记录数
 */
export const cleanupByLRU = async (targetBytes: number): Promise<number> => {
  const db = await getDb()
  
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite')
    const store = tx.objectStore(STORE_NAME)
    
    // 尝试使用 lastAccessedAt 索引，如果不存在则使用 createdAt
    let index: IDBIndex
    try {
      index = store.index('lastAccessedAt')
    } catch {
      index = store.index('createdAt')
    }
    
    const req = index.openCursor()
    let freedBytes = 0
    let deletedCount = 0
    
    req.onsuccess = () => {
      const cursor = req.result
      if (cursor && freedBytes < targetBytes) {
        const record = cursor.value as MediaRecord
        const recordSize = record.data?.length || 0
        
        cursor.delete()
        freedBytes += recordSize
        deletedCount++
        
        cursor.continue()
      } else {
        console.log(`[MediaStorage] LRU 清理完成, 删除: ${deletedCount} 条, 释放: ${Math.round(freedBytes / 1024 / 1024)}MB`)
        resolve(deletedCount)
      }
    }
    req.onerror = () => reject(req.error)
  })
}

/**
 * 获取存储空间使用详情
 */
export const getStorageDetails = async (): Promise<{
  count: number
  totalSize: number
  maxSize: number
  usagePercent: number
  oldestRecord?: { id: string; createdAt: number }
  newestRecord?: { id: string; createdAt: number }
}> => {
  const stats = await getStorageStats()
  const db = await getDb()
  
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly')
    const store = tx.objectStore(STORE_NAME)
    const index = store.index('createdAt')
    
    let oldest: { id: string; createdAt: number } | undefined
    let newest: { id: string; createdAt: number } | undefined
    
    // 获取最旧记录
    const oldestReq = index.openCursor()
    oldestReq.onsuccess = () => {
      const cursor = oldestReq.result
      if (cursor) {
        oldest = { id: cursor.value.id, createdAt: cursor.value.createdAt }
      }
      
      // 获取最新记录
      const newestReq = index.openCursor(null, 'prev')
      newestReq.onsuccess = () => {
        const cursor = newestReq.result
        if (cursor) {
          newest = { id: cursor.value.id, createdAt: cursor.value.createdAt }
        }
        
        resolve({
          ...stats,
          maxSize: MAX_STORAGE_SIZE,
          usagePercent: Math.round((stats.totalSize / MAX_STORAGE_SIZE) * 100),
          oldestRecord: oldest,
          newestRecord: newest,
        })
      }
      newestReq.onerror = () => reject(newestReq.error)
    }
    oldestReq.onerror = () => reject(oldestReq.error)
  })
}

// NOTE:
// 旧逻辑会在启动后自动清理 7 天前的数据，这会与"素材跨重启可恢复"的目标冲突。
// 改为由显式调用 cleanupOldMedia() 或项目/节点删除时清理（见 store 层）。
// 新增 LRU 清理策略，当存储空间超出配额时自动清理最久未访问的数据。

// ==================== 缩略图生成 ====================

const MAX_THUMB_WIDTH = 512

export const generateThumbnail = async (dataUrl: string): Promise<string> => {
  if (!dataUrl) return ''
  return new Promise<string>((resolve) => {
    const img = new Image()
    img.onload = () => {
      if (img.naturalWidth <= MAX_THUMB_WIDTH) { resolve(dataUrl); return }
      const scale = MAX_THUMB_WIDTH / img.naturalWidth
      const w = Math.round(img.naturalWidth * scale)
      const h = Math.round(img.naturalHeight * scale)
      const canvas = document.createElement('canvas')
      canvas.width = w
      canvas.height = h
      const ctx = canvas.getContext('2d')
      if (!ctx) { resolve(''); return }
      ctx.drawImage(img, 0, 0, w, h)
      resolve(canvas.toDataURL('image/jpeg', 0.75))
    }
    img.onerror = () => resolve('')
    img.src = dataUrl
  })
}

export const saveThumbnailForMedia = async (mediaId: string, thumbData: string): Promise<void> => {
  if (!mediaId || !thumbData) return
  const db = await getDb()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite')
    const store = tx.objectStore(STORE_NAME)
    const req = store.get(mediaId)
    req.onsuccess = () => {
      const record = req.result as MediaRecord | undefined
      if (!record) { resolve(); return }
      record.thumbnailData = thumbData
      const putReq = store.put(record)
      putReq.onsuccess = () => resolve()
      putReq.onerror = () => reject(putReq.error)
    }
    req.onerror = () => reject(req.error)
  })
}
