/**
 * Supabase Storage image/video upload utility
 * Public bucket "images" on nexus-ai project
 * Auto-cleanup: files older than 2 days are deleted on each upload
 */

const SUPABASE_URL = 'https://mjxmdpyfolmhklmgvfwk.supabase.co'
const SUPABASE_SERVICE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im1qeG1kcHlmb2xtaGtsbWd2ZndrIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2Nzk1NjQyNywiZXhwIjoyMDgzNTMyNDI3fQ.07NKMY9ZPyc5OLA0ej31RNazIQE7PSbvr0h4mob_PIU'
const BUCKET = 'images'
const MAX_AGE_MS = 2 * 24 * 60 * 60 * 1000 // 2 days

let lastCleanup = 0

export async function uploadToSupabase(dataUrlOrBlob: string | Blob, filename?: string): Promise<string> {
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

  // Auto-cleanup old files (runs at most once per hour)
  if (Date.now() - lastCleanup > 60 * 60 * 1000) {
    lastCleanup = Date.now()
    void cleanupOldFiles().catch(() => {})
  }

  return `${SUPABASE_URL}/storage/v1/object/public/${BUCKET}/${path}`
}

async function cleanupOldFiles() {
  const cutoff = Date.now() - MAX_AGE_MS

  // List files in uploads/ folder
  const listResp = await fetch(`${SUPABASE_URL}/storage/v1/object/list/${BUCKET}`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ prefix: 'uploads/', limit: 500 }),
  })

  if (!listResp.ok) return

  const files = await listResp.json() as any[]
  if (!Array.isArray(files) || files.length === 0) return

  const toDelete: string[] = []
  for (const f of files) {
    const created = new Date(f.created_at || f.updated_at || 0).getTime()
    if (created > 0 && created < cutoff) {
      toDelete.push(`uploads/${f.name}`)
    }
  }

  if (toDelete.length === 0) return

  console.log(`[supabaseStorage] Cleaning up ${toDelete.length} files older than 2 days`)

  await fetch(`${SUPABASE_URL}/storage/v1/object/${BUCKET}`, {
    method: 'DELETE',
    headers: {
      'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ prefixes: toDelete }),
  })
}
