import type { ShortDramaMediaVariant } from '@/lib/shortDrama/types'

const DB_NAME = 'nexus-video-thumbnails'
const DB_VERSION = 1
const STORE_NAME = 'thumbnails'
const MAX_THUMBNAILS = 200

export interface CachedThumbnail {
  variantId: string
  dataUrl: string
  extractedAt: number
  width: number
  height: number
}

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'variantId' })
      }
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

export function extractVideoThumbnail(
  videoUrl: string,
  timeMs = 0,
  targetWidth = 160
): Promise<string> {
  return new Promise((resolve, reject) => {
    const video = document.createElement('video')
    video.crossOrigin = 'anonymous'
    video.muted = true
    video.preload = 'metadata'

    const cleanup = () => {
      video.removeEventListener('seeked', onSeeked)
      video.removeEventListener('error', onError)
      video.src = ''
      video.load()
    }

    const onSeeked = () => {
      const canvas = document.createElement('canvas')
      const ratio = video.videoHeight / video.videoWidth
      canvas.width = targetWidth
      canvas.height = Math.round(targetWidth * ratio) || targetWidth
      const ctx = canvas.getContext('2d')
      if (ctx) {
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height)
      }
      const dataUrl = canvas.toDataURL('image/jpeg', 0.7)
      cleanup()
      resolve(dataUrl)
    }

    const onError = () => {
      cleanup()
      reject(new Error('Failed to extract video thumbnail'))
    }

    video.addEventListener('seeked', onSeeked, { once: true })
    video.addEventListener('error', onError, { once: true })

    video.addEventListener('loadedmetadata', () => {
      const seekTime = Math.min((timeMs || 0) / 1000, video.duration || 0)
      video.currentTime = seekTime
    }, { once: true })

    video.src = videoUrl

    setTimeout(() => {
      cleanup()
      reject(new Error('Thumbnail extraction timeout'))
    }, 10000)
  })
}

export async function getThumbnail(variantId: string, videoUrl: string): Promise<string> {
  const db = await openDB()

  const cached = await new Promise<CachedThumbnail | undefined>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly')
    const req = tx.objectStore(STORE_NAME).get(variantId)
    req.onsuccess = () => resolve(req.result || undefined)
    req.onerror = () => reject(req.error)
  })

  if (cached) return cached.dataUrl

  const dataUrl = await extractVideoThumbnail(videoUrl)
  const entry: CachedThumbnail = {
    variantId,
    dataUrl,
    extractedAt: Date.now(),
    width: 160,
    height: 90,
  }

  const tx = db.transaction(STORE_NAME, 'readwrite')
  tx.objectStore(STORE_NAME).put(entry)

  return dataUrl
}

export async function prefetchThumbnails(variants: ShortDramaMediaVariant[]): Promise<void> {
  for (const v of variants) {
    if (v.kind !== 'video' || v.status !== 'success') continue
    const url = v.displayUrl || v.sourceUrl
    if (!url) continue
    try {
      await getThumbnail(v.id, url)
    } catch {
      // skip failures silently
    }
  }
}

export async function evictOldThumbnails(): Promise<void> {
  const db = await openDB()
  const all = await new Promise<CachedThumbnail[]>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly')
    const req = tx.objectStore(STORE_NAME).getAll()
    req.onsuccess = () => resolve(req.result || [])
    req.onerror = () => reject(req.error)
  })

  if (all.length <= MAX_THUMBNAILS) return

  all.sort((a, b) => a.extractedAt - b.extractedAt)
  const toRemove = all.slice(0, all.length - MAX_THUMBNAILS)

  const tx = db.transaction(STORE_NAME, 'readwrite')
  const store = tx.objectStore(STORE_NAME)
  for (const entry of toRemove) {
    store.delete(entry.variantId)
  }
}

export async function clearThumbnailsForVariants(variantIds: string[]): Promise<void> {
  if (variantIds.length === 0) return
  const db = await openDB()
  const tx = db.transaction(STORE_NAME, 'readwrite')
  const store = tx.objectStore(STORE_NAME)
  for (const id of variantIds) {
    store.delete(id)
  }
}
