/**
 * Cloudflare R2 Storage — temporary CDN bridge with dedup cache
 *
 * Flow: local data URL → upload to R2 (S3 API + AWS Sig V4) → public URL → pass to external API
 * R2 lifecycle rule auto-deletes files in uploads/ after 2 days
 * Same image won't be re-uploaded within the cache window
 */

const R2_ENDPOINT = 'https://aeb71d0aea1f77ff49955e4535ab344b.r2.cloudflarestorage.com'
const R2_ACCESS_KEY = 'd0fe9816ab24b15a3828aa1845b2f75c'
const R2_SECRET_KEY = '874340a85f6cf5b7dda6918d2700ac9c759787fd30e052139ebffcc14b6442bd'
const R2_BUCKET = 'nexus'
const R2_PUBLIC_URL = 'https://pub-4c98a72d90e048c295e7bfe2c6b4da0b.r2.dev'
const R2_REGION = 'auto'

const MAX_AGE_MS = 2 * 24 * 60 * 60 * 1000
const CACHE_KEY = 'nexus-r2-upload-cache'

// ── AWS Signature V4 (Web Crypto) ──────────────────────────────────

async function hmacSha256(key: ArrayBuffer, data: string): Promise<ArrayBuffer> {
  const ck = await crypto.subtle.importKey('raw', key, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  return crypto.subtle.sign('HMAC', ck, new TextEncoder().encode(data))
}

async function sha256Hex(data: ArrayBuffer | Uint8Array): Promise<string> {
  const buf = data instanceof ArrayBuffer ? data : (data as Uint8Array).buffer as ArrayBuffer
  const hash = await crypto.subtle.digest('SHA-256', buf)
  return Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2, '0')).join('')
}

async function getSignatureKey(date: string): Promise<ArrayBuffer> {
  let key: ArrayBuffer = new TextEncoder().encode('AWS4' + R2_SECRET_KEY).buffer
  for (const part of [date, R2_REGION, 's3', 'aws4_request']) {
    key = await hmacSha256(key, part)
  }
  return key
}

async function signRequest(method: string, path: string, headers: Record<string, string>, body: Uint8Array): Promise<Record<string, string>> {
  const now = new Date()
  const datestamp = now.toISOString().slice(0, 10).replace(/-/g, '')
  const amzDate = datestamp + 'T' + now.toISOString().slice(11, 19).replace(/:/g, '') + 'Z'

  const payloadHash = await sha256Hex(body)
  const allHeaders: Record<string, string> = {
    ...headers,
    host: new URL(R2_ENDPOINT).host,
    'x-amz-content-sha256': payloadHash,
    'x-amz-date': amzDate,
  }

  const signedHeaderKeys = Object.keys(allHeaders).sort()
  const signedHeadersStr = signedHeaderKeys.join(';')
  const canonicalHeaders = signedHeaderKeys.map(k => `${k}:${allHeaders[k]}\n`).join('')

  const canonicalRequest = [method, path, '', canonicalHeaders, signedHeadersStr, payloadHash].join('\n')
  const credentialScope = `${datestamp}/${R2_REGION}/s3/aws4_request`
  const stringToSign = `AWS4-HMAC-SHA256\n${amzDate}\n${credentialScope}\n${await sha256Hex(new TextEncoder().encode(canonicalRequest))}`

  const signingKey = await getSignatureKey(datestamp)
  const signatureBuf = await hmacSha256(signingKey, stringToSign)
  const signature = Array.from(new Uint8Array(signatureBuf)).map(b => b.toString(16).padStart(2, '0')).join('')

  return {
    ...allHeaders,
    Authorization: `AWS4-HMAC-SHA256 Credential=${R2_ACCESS_KEY}/${credentialScope}, SignedHeaders=${signedHeadersStr}, Signature=${signature}`,
  }
}

// ── Retry helper ───────────────────────────────────────────────────

async function fetchWithRetry(url: string, init: RequestInit, retries = 2): Promise<Response> {
  for (let i = 0; i <= retries; i++) {
    try {
      return await fetch(url, init)
    } catch (err) {
      if (i === retries) throw err
      await new Promise(r => setTimeout(r, 1000 * (i + 1)))
    }
  }
  throw new Error('fetch failed')
}

// ── Dedup cache ────────────────────────────────────────────────────

type CacheEntry = { url: string; at: number }
const cache = new Map<string, CacheEntry>()

function loadCache() {
  try {
    const raw = localStorage.getItem(CACHE_KEY)
    if (!raw) return
    const entries = JSON.parse(raw) as [string, CacheEntry][]
    const now = Date.now()
    for (const [k, v] of entries) {
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

// ── Public API ─────────────────────────────────────────────────────

export async function uploadToR2(dataUrlOrBlob: string | Blob, filename?: string): Promise<string> {
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
  const objectKey = `uploads/${name}`
  const contentType = blob.type || 'image/png'
  const bodyBytes = new Uint8Array(await blob.arrayBuffer())

  const signed = await signRequest('PUT', `/${R2_BUCKET}/${objectKey}`, { 'content-type': contentType }, bodyBytes)

  const resp = await fetchWithRetry(`${R2_ENDPOINT}/${R2_BUCKET}/${objectKey}`, {
    method: 'PUT',
    headers: signed,
    body: bodyBytes,
  })

  if (!resp.ok) {
    const err = await resp.text().catch(() => '')
    throw new Error(`R2 upload failed: ${resp.status} ${err.slice(0, 200)}`)
  }

  const publicUrl = `${R2_PUBLIC_URL}/${objectKey}`

  if (contentHash) {
    cache.set(contentHash, { url: publicUrl, at: Date.now() })
    saveCache()
  }

  return publicUrl
}
