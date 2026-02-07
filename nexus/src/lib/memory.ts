import { tauriInvoke } from '@/lib/tauri'

export type MemoryItem = {
  id: string
  content: string
  importance: number
  updatedAt: number
}

export type MemoryState = {
  version: 1
  summary: string
  items: MemoryItem[]
}

const STORAGE_KEY = 'nexus-memory-v1'

const normalizeText = (text: string) => String(text || '').replace(/\r\n/g, '\n').trim()

export const loadMemoryState = (): MemoryState => {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return { version: 1, summary: '', items: [] }
    const parsed = JSON.parse(raw)
    if (!parsed || parsed.version !== 1) return { version: 1, summary: '', items: [] }
    return {
      version: 1,
      summary: typeof parsed.summary === 'string' ? parsed.summary : '',
      items: Array.isArray(parsed.items) ? parsed.items : []
    }
  } catch {
    return { version: 1, summary: '', items: [] }
  }
}

export const saveMemoryState = (state: MemoryState) => {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
  } catch {
    // ignore
  }
}

const isCjk = (ch: string) => {
  if (!ch) return false
  const code = ch.charCodeAt(0)
  return code >= 0x4e00 && code <= 0x9fff
}

const tokenize = (text: string) => {
  const t = normalizeText(text).toLowerCase()
  if (!t) return [] as string[]

  const tokens: string[] = []
  let buf = ''
  for (const ch of t) {
    if (isCjk(ch)) {
      if (buf) {
        buf
          .split(/[^a-z0-9]+/i)
          .filter(Boolean)
          .forEach((p) => tokens.push(p))
        buf = ''
      }
      tokens.push(ch)
      continue
    }
    buf += ch
  }
  if (buf) {
    buf
      .split(/[^a-z0-9]+/i)
      .filter(Boolean)
      .forEach((p) => tokens.push(p))
  }
  return tokens
}

const scoreMatch = (query: string, doc: string) => {
  const q = tokenize(query)
  const d = tokenize(doc)
  if (q.length === 0 || d.length === 0) return 0
  const qset = new Set(q)
  const dset = new Set(d)
  let hit = 0
  for (const tok of qset) if (dset.has(tok)) hit++
  const denom = Math.max(1, Math.sqrt(qset.size * dset.size))
  return hit / denom
}

export const searchMemory = async (query: string, items: MemoryItem[], limit = 6, minScore = 0.12) => {
  const q = normalizeText(query)
  if (!q) return [] as MemoryItem[]

  const tauri = await tauriInvoke<MemoryItem[]>('search_memory', {
    query: q,
    items,
    limit,
    minScore
  })
  if (tauri && Array.isArray(tauri)) return tauri

  const now = Date.now()
  const scored = items
    .map((item) => {
      const content = normalizeText(item.content)
      const base = scoreMatch(q, content)
      const importance = Math.max(0, Math.min(1, Number(item.importance) || 0))
      const recencyDays = item.updatedAt > 0 ? (now - item.updatedAt) / (1000 * 60 * 60 * 24) : 30
      const recency = Math.max(0, Math.min(1, recencyDays / 30))
      const recencyBoost = 1 - recency
      const score = base * 0.7 + importance * 0.2 + recencyBoost * 0.1
      return { score, item: { ...item, content } }
    })
    .filter((x) => x.score >= minScore)
    .sort((a, b) => b.score - a.score)
    .slice(0, Math.max(1, limit))
    .map((x) => x.item)

  return scored
}

