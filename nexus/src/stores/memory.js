/**
 * Assistant Memory Store | 助手记忆（本地持久化）
 * - 轻量“语义记忆”：用户偏好/背景/长期约束等
 * - 提供简单检索（无向量依赖），用于上下文拼装
 */

import { ref } from 'vue'

const STORAGE_KEY = 'nexus-assistant-memory-v1'
const MAX_ITEMS = 200

export const memorySummary = ref('')
export const memoryItems = ref([])

let loaded = false
let saveTimer = null

const now = () => Date.now()

const normalizeText = (text) => String(text || '').replace(/\s+/g, ' ').trim()

const safeParse = (raw) => {
  try { return JSON.parse(raw) } catch { return null }
}

export const loadMemory = () => {
  if (loaded) return
  loaded = true
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    const parsed = raw ? safeParse(raw) : null
    if (parsed && typeof parsed === 'object') {
      if (typeof parsed.summary === 'string') memorySummary.value = parsed.summary
      if (Array.isArray(parsed.items)) memoryItems.value = parsed.items.filter(Boolean)
    }
  } catch {
    // ignore
  }
}

const persist = () => {
  try {
    const payload = {
      summary: memorySummary.value || '',
      items: memoryItems.value || []
    }
    localStorage.setItem(STORAGE_KEY, JSON.stringify(payload))
  } catch {
    // ignore
  }
}

const scheduleSave = () => {
  if (saveTimer) clearTimeout(saveTimer)
  saveTimer = setTimeout(() => {
    saveTimer = null
    persist()
  }, 300)
}

const makeId = () => {
  const uuid = globalThis.crypto?.randomUUID?.()
  return uuid || `mem_${now()}_${Math.random().toString(16).slice(2)}`
}

export const setMemorySummary = (text) => {
  loadMemory()
  memorySummary.value = normalizeText(text)
  scheduleSave()
}

export const clearMemory = () => {
  loadMemory()
  memorySummary.value = ''
  memoryItems.value = []
  scheduleSave()
}

export const addMemoryItem = (text, { importance = 0.6, tags = [], source = 'chat' } = {}) => {
  loadMemory()
  const content = normalizeText(text)
  if (!content) return null

  const existing = memoryItems.value.find(i => normalizeText(i?.content) === content)
  if (existing) {
    existing.updatedAt = now()
    existing.importance = Math.max(Number(existing.importance || 0), Number(importance || 0))
    scheduleSave()
    return existing.id
  }

  const item = {
    id: makeId(),
    content,
    tags: Array.isArray(tags) ? tags.filter(Boolean) : [],
    source,
    importance: Math.max(0, Math.min(1, Number(importance || 0.6))),
    createdAt: now(),
    updatedAt: now()
  }

  memoryItems.value = [item, ...memoryItems.value].slice(0, MAX_ITEMS)
  scheduleSave()
  return item.id
}

const isCjk = (ch) => /[\u4E00-\u9FFF]/.test(ch)

const tokenize = (text) => {
  const t = normalizeText(text).toLowerCase()
  if (!t) return []

  const tokens = []
  let buf = ''
  for (const ch of t) {
    if (isCjk(ch)) {
      if (buf) {
        tokens.push(...buf.split(/[^a-z0-9]+/).filter(Boolean))
        buf = ''
      }
      tokens.push(ch)
      continue
    }
    buf += ch
  }
  if (buf) tokens.push(...buf.split(/[^a-z0-9]+/).filter(Boolean))
  return tokens.filter(Boolean)
}

const scoreMatch = (query, doc) => {
  const q = tokenize(query)
  const d = tokenize(doc)
  if (q.length === 0 || d.length === 0) return 0
  const qset = new Set(q)
  const dset = new Set(d)
  let hit = 0
  qset.forEach((tok) => { if (dset.has(tok)) hit += 1 })
  const denom = Math.sqrt(qset.size * dset.size) || 1
  return hit / denom
}

export const searchMemory = (query, { limit = 6, minScore = 0.12 } = {}) => {
  loadMemory()
  const q = normalizeText(query)
  if (!q) return []

  const scored = memoryItems.value
    .map((item) => {
      const base = scoreMatch(q, item?.content || '')
      const importance = Number(item?.importance || 0)
      const recency = item?.updatedAt ? Math.min(1, (now() - item.updatedAt) / (1000 * 60 * 60 * 24 * 30)) : 1
      const recencyBoost = 1 - recency
      const score = base * 0.7 + importance * 0.2 + recencyBoost * 0.1
      return { item, score }
    })
    .filter(x => x.score >= minScore)
    .sort((a, b) => b.score - a.score)
    .slice(0, Math.max(1, limit))
    .map(x => x.item)

  return scored
}

