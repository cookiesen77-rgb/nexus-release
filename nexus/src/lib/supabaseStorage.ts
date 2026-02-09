/**
 * Supabase Storage upload utility with deduplication cache
 * Public bucket "images" on nexus-ai project
 * Same image won't be uploaded twice — cached by content hash
 */

const SUPABASE_URL = 'https://mjxmdpyfolmhklmgvfwk.supabase.co'
const SUPABASE_SERVICE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im1qeG1kcHlmb2xtaGtsbWd2ZndrIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2Nzk1NjQyNywiZXhwIjoyMDgzNTMyNDI3fQ.07NKMY9ZPyc5OLA0ej31RNazIQE7PSbvr0h4mob_PIU'
const BUCKET = 'images'

// In-memory dedup cache: content hash → public URL
const uploadCache = new Map<string, string>()

// Persistent dedup cache in localStorage
const CACHE_KEY = 'nexus-supabase-upload-cache'

function loadCache() {
  try {
    const raw = localStorage.getItem(CACHE_KEY)
    if (!raw) return
    const entries = JSON.parse(raw) as [string, string][]
    for (const [k, v] of entries) uploadCache.set(k, v)
  } catch { /* ignore */ }
}

function saveCache() {
  try {
    const entries = Array.from(uploadCache.entries()).slice(-500) // Keep last 500
    localStorage.setItem(CACHE_KEY, JSON.stringify(entries))
  } catch { /* ignore */ }
}

// Fast hash of data URL content (sample first + last 200 chars + length)
function hashContent(data: string): string {
  const sample = data.slice(0, 200) + data.slice(-200) + data.length
  let h = 0
  for (let i = 0; i < sample.length; i++) {
    h = ((h << 5) - h) + sample.charCodeAt(i)
    h |= 0
  }
  return String(Math.abs(h).toString(36))
}

// Init cache on load
loadCache()

export async function uploadToSupabase(dataUrlOrBlob: string | Blob, filename?: string): Promise<string> {
  // Check dedup cache for string inputs
  if (typeof dataUrlOrBlob === 'string') {
    const hash = hashContent(dataUrlOrBlob)
    const cached = uploadCache.get(hash)
    if (cached) {
      console.log('[supabaseStorage] Cache hit, skipping upload:', cached.slice(0, 80))
      return cached
    }
  }

  let blob: Blob
  let ext = 'png'
  let contentHash = ''

  if (typeof dataUrlOrBlob === 'string') {
    const m = dataUrlOrBlob.match(/^data:([^;]+);base64,(.*)$/)
    if (!m) throw new Error('Invalid data URL')
    const mimeType = m[1]
    ext = mimeType.split('/')[1]?.replace('jpeg', 'jpg') || 'png'
    const byteString = atob(m[2])
    const bytes = new Uint8Array(byteString.length)
    for (let i = 0; i < byteString.length; i++) bytes[i] = byteString.charCodeAt(i)
    blob = new Blob([bytes], { type: mimeType })
    contentHash = hashContent(dataUrlOrBlob)
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

  // Save to dedup cache
  if (contentHash) {
    uploadCache.set(contentHash, publicUrl)
    saveCache()
  }

  return publicUrl
}
