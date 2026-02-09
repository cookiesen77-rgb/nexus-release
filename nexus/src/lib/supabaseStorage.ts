/**
 * Supabase Storage — temporary CDN bridge with dedup cache + auto-cleanup
 *
 * Flow: local data URL → upload to Supabase → public URL → pass to external API
 * Supabase files auto-cleanup after 2 days (local IndexedDB is the permanent store)
 * Same image won't be re-uploaded within the cache window
 */

const SUPABASE_URL = 'https://mjxmdpyfolmhklmgvfwk.supabase.co'
const SUPABASE_SERVICE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im1qeG1kcHlmb2xtaGtsbWd2ZndrIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2Nzk1NjQyNywiZXhwIjoyMDgzNTMyNDI3fQ.07NKMY9ZPyc5OLA0ej31RNazIQE7PSbvr0h4mob_PIU'
const BUCKET = 'images'
const MAX_AGE_MS = 2 * 24 * 60 * 60 * 1000
const CACHE_KEY = 'nexus-supabase-upload-cache'

// Cache entry: hash → { url, uploadedAt }
type CacheEntry = { url: string; at: number }
const cache = new Map<string, CacheEntry>()
let lastCleanup = 0

function loadCache() {
  try {
    const raw = localStorage.getItem(CACHE_KEY)
    if (!raw) return
    const entries = JSON.parse(raw) as [string, CacheEntry][]
    const now = Date.now()
    for (const [k, v] of entries) {
      // Only load entries younger than 2 days
      if (v.at && now - v.at < MAX_AGE_MS) cache.set(k, v)
    }
  } catch { /* ignore */ }
}

function saveCache() {
  try {
    const now = Date.now()
    const entries = Array.from(cache.entries())
      .filter(([, v]) => now - v.at < MAX_AGE_MS)
      .slice(-500)
    localStorage.setItem(CACHE_KEY, JSON.stringify(entries))
  } catch { /* ignore */ }
}

function hashContent(data: string): string {
  const sample = data.slice(0, 200) + data.slice(-200) + data.length
  let h = 0
  for (let i = 0; i < sample.length; i++) {
    h = ((h << 5) - h) + sample.charCodeAt(i)
    h |= 0
  }
  return Math.abs(h).toString(36)
}

loadCache()

export async function uploadToSupabase(dataUrlOrBlob: string | Blob, filename?: string): Promise<string> {
  // Dedup: check cache (only for data URL strings)
  let contentHash = ''
  if (typeof dataUrlOrBlob === 'string') {
    contentHash = hashContent(dataUrlOrBlob)
    const cached = cache.get(contentHash)
    if (cached && Date.now() - cached.at < MAX_AGE_MS) {
      return cached.url
    }
  }

  let blob: Blob
  let ext = 'png'

  if (typeof dataUrlOrBlob === 'string') {
    const m = dataUrlOrBlob.match(/^data:([^;]+);base64,(.*)$/)
    if (!m) throw new Error('Invalid data URL')
    const mimeType = m[1]
    ext = mimeType.split('/')[1]?.replace('jpeg', 'jpg') || 'png'
    const byteString = atob(m[2])
    const bytes = new Uint8Array(byteString.length)
    for (let i = 0; i < byteString.length; i++) bytes[i] = byteString.charCodeAt(i)
    blob = new Blob([bytes], { type: mimeType })
  } else {
    blob = dataUrlOrBlob
    ext = (blob.type || 'image/png').split('/')[1]?.replace('jpeg', 'jpg') || 'png'
  }

  const name = filename || `${Date.now()}_${Math.random().toString(36).slice(2, 8)}.${ext}`
  const path = `uploads/${name}`

  const resp = await fetch(`${SUPABASE_URL}/storage/v1/object/${BUCKET}/${path}`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`,
      'Content-Type': blob.type || 'image/png',
      'x-upsert': 'true',
    },
    body: blob,
  })

  if (!resp.ok) {
    const err = await resp.text().catch(() => '')
    throw new Error(`Supabase upload failed: ${resp.status} ${err.slice(0, 200)}`)
  }

  const publicUrl = `${SUPABASE_URL}/storage/v1/object/public/${BUCKET}/${path}`

  if (contentHash) {
    cache.set(contentHash, { url: publicUrl, at: Date.now() })
    saveCache()
  }

  // Cleanup old files from Supabase (at most once per 6 hours, non-blocking)
  if (Date.now() - lastCleanup > 6 * 60 * 60 * 1000) {
    lastCleanup = Date.now()
    void cleanupOldFiles().catch(() => {})
  }

  return publicUrl
}

async function cleanupOldFiles() {
  const cutoff = new Date(Date.now() - MAX_AGE_MS).toISOString()

  const listResp = await fetch(`${SUPABASE_URL}/storage/v1/object/list/${BUCKET}`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ prefix: 'uploads/', limit: 500, sortBy: { column: 'created_at', order: 'asc' } }),
  })
  if (!listResp.ok) return

  const files = await listResp.json() as any[]
  if (!Array.isArray(files)) return

  const toDelete = files
    .filter(f => f.created_at && f.created_at < cutoff)
    .map(f => `uploads/${f.name}`)

  if (toDelete.length === 0) return

  console.log(`[supabase] Cleaning ${toDelete.length} expired files`)

  await fetch(`${SUPABASE_URL}/storage/v1/object/${BUCKET}`, {
    method: 'DELETE',
    headers: {
      'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ prefixes: toDelete }),
  })

  // Purge expired entries from local cache
  const now = Date.now()
  for (const [k, v] of cache) {
    if (now - v.at >= MAX_AGE_MS) cache.delete(k)
  }
  saveCache()
}
