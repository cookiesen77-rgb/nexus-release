import type { ShortDramaDraftV2 } from '@/lib/shortDrama/types'
import type { ShortDramaProjectMeta } from '@/lib/shortDrama/draftStorage'
import {
  createDefaultDraftV2,
} from '@/lib/shortDrama/draftStorage'

const DB_NAME = 'nexus-short-drama-storage'
const DB_VERSION = 1
const STORE_NAME = 'drafts'
const LS_DRAFT_PREFIX = 'nexus-short-drama-studio:draft:v2'

let dbPromise: Promise<IDBDatabase> | null = null

const getDb = (): Promise<IDBDatabase> => {
  if (dbPromise) return dbPromise
  if (typeof indexedDB === 'undefined') return Promise.reject(new Error('IndexedDB not available'))
  dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        const store = db.createObjectStore(STORE_NAME, { keyPath: 'projectId' })
        store.createIndex('updatedAt', 'updatedAt', { unique: false })
      }
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
  return dbPromise
}

let migrated = false

async function ensureMigrated(): Promise<void> {
  if (migrated) return
  migrated = true
  await migrateAllFromLocalStorage()
}

export async function loadDraftIdb(projectId: string): Promise<ShortDramaDraftV2> {
  const pid = projectId || 'default'
  await ensureMigrated()
  const db = await getDb()
  return new Promise((resolve) => {
    const tx = db.transaction(STORE_NAME, 'readonly')
    const req = tx.objectStore(STORE_NAME).get(pid)
    req.onsuccess = () => {
      const record = req.result
      if (record && record.version === 2) {
        resolve({ ...record, projectId: pid } as ShortDramaDraftV2)
      } else {
        resolve(createDefaultDraftV2(pid))
      }
    }
    req.onerror = () => resolve(createDefaultDraftV2(pid))
  })
}

export async function saveDraftIdb(projectId: string, draft: ShortDramaDraftV2): Promise<boolean> {
  const pid = projectId || draft?.projectId || 'default'
  const data = { ...draft, projectId: pid, updatedAt: Date.now() }
  const db = await getDb()
  return new Promise((resolve) => {
    const tx = db.transaction(STORE_NAME, 'readwrite')
    tx.objectStore(STORE_NAME).put(data)
    tx.oncomplete = () => resolve(true)
    tx.onerror = () => resolve(false)
  })
}

export async function deleteDraftIdb(projectId: string): Promise<boolean> {
  if (!projectId || projectId === 'default') return false
  const db = await getDb()
  return new Promise((resolve) => {
    const tx = db.transaction(STORE_NAME, 'readwrite')
    tx.objectStore(STORE_NAME).delete(projectId)
    tx.oncomplete = () => resolve(true)
    tx.onerror = () => resolve(false)
  })
}

export async function listProjectsIdb(): Promise<ShortDramaProjectMeta[]> {
  await ensureMigrated()
  const db = await getDb()
  return new Promise((resolve) => {
    const tx = db.transaction(STORE_NAME, 'readonly')
    const req = tx.objectStore(STORE_NAME).getAll()
    req.onsuccess = () => {
      const projects: ShortDramaProjectMeta[] = (req.result || [])
        .filter((r: any) => r && r.version === 2)
        .map((r: any) => ({
          id: r.projectId as string,
          title: String(r.title || '').trim() || '未命名短剧',
          updatedAt: Number(r.updatedAt || r.createdAt || 0),
          createdAt: Number(r.createdAt || 0),
          shotCount: Array.isArray(r.shots) ? r.shots.length : 0,
          characterCount: Array.isArray(r.characters) ? r.characters.length : 0,
        }))
      projects.sort((a, b) => b.updatedAt - a.updatedAt)
      resolve(projects)
    }
    req.onerror = () => resolve([])
  })
}

export async function duplicateProjectIdb(projectId: string): Promise<string | null> {
  const source = await loadDraftIdb(projectId)
  if (!source) return null
  const newId = `sd_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`
  const newDraft: ShortDramaDraftV2 = {
    ...source,
    projectId: newId,
    title: `${source.title || '未命名'} 副本`,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  }
  await saveDraftIdb(newId, newDraft)
  return newId
}

export async function migrateAllFromLocalStorage(): Promise<number> {
  let count = 0
  const prefix = LS_DRAFT_PREFIX + ':'
  const keysToMigrate: string[] = []

  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i)
    if (key && key.startsWith(prefix)) keysToMigrate.push(key)
  }

  if (keysToMigrate.length === 0) return 0

  const db = await getDb()

  for (const key of keysToMigrate) {
    const pid = key.slice(prefix.length)
    const raw = localStorage.getItem(key)
    if (!raw) continue

    let parsed: any
    try { parsed = JSON.parse(raw) } catch { continue }
    if (!parsed || parsed.version !== 2) continue

    parsed.projectId = pid

    await new Promise<void>((resolve) => {
      const tx = db.transaction(STORE_NAME, 'readwrite')
      tx.objectStore(STORE_NAME).put(parsed)
      tx.oncomplete = () => {
        localStorage.removeItem(key)
        count++
        resolve()
      }
      tx.onerror = () => resolve()
    })
  }

  return count
}
