import type { EcomDraftV1, EcomMediaSlot, EcomDetailImage, EcomDetailRole, EcomSceneType } from './types'
import { ECOM_DETAIL_ROLES } from './types'
import { DEFAULT_IMAGE_MODEL, DEFAULT_CHAT_MODEL } from '@/config/models'

const makeId = () => `ecom_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`

const DRAFT_PREFIX = 'nexus-ecom-studio:draft:v1'
const PROJECTS_KEY = 'nexus-ecom-studio:projects'

export const createEmptySlot = (label = ''): EcomMediaSlot => ({
  id: makeId(),
  label,
  variants: [],
  selectedVariantId: undefined,
  selectionLockedByUser: false,
})

const createDetailImages = (): EcomDetailImage[] =>
  ECOM_DETAIL_ROLES.map((r, i) => ({
    id: makeId(),
    index: i,
    role: r.role,
    prompt: '',
    slot: createEmptySlot(r.label),
  }))

export const createDefaultDraft = (pid: string): EcomDraftV1 => ({
  version: 1,
  projectId: pid,
  createdAt: Date.now(),
  updatedAt: Date.now(),
  title: '新电商项目',
  product: { name: '', category: '', brand: '', description: '', sellingPoints: [], targetAudience: '' },
  productRefs: [],
  models: {
    imageModelKey: DEFAULT_IMAGE_MODEL,
    imageSize: '3:4',
    imageQuality: '2K',
    chatModelKey: DEFAULT_CHAT_MODEL,
  },
  heroScene: {
    backgroundType: 'white',
    customBackground: '',
    angle: '45度',
    prompt: '',
    slot: createEmptySlot('商品主图'),
  },
  detailPageScene: {
    images: createDetailImages(),
    consistencyPrompt: '',
  },
  tryOnScenes: [],
  posterScenes: [],
  activeScene: 'hero',
})

export const loadDraft = (pid: string): EcomDraftV1 => {
  try {
    const raw = localStorage.getItem(`${DRAFT_PREFIX}:${pid}`)
    if (!raw) return createDefaultDraft(pid)
    const parsed = JSON.parse(raw)
    if (parsed?.version !== 1) return createDefaultDraft(pid)
    return parsed as EcomDraftV1
  } catch {
    return createDefaultDraft(pid)
  }
}

export const saveDraft = (pid: string, draft: EcomDraftV1): boolean => {
  try {
    localStorage.setItem(`${DRAFT_PREFIX}:${pid}`, JSON.stringify({ ...draft, updatedAt: Date.now() }))
    return true
  } catch {
    return false
  }
}

export type EcomProjectMeta = {
  id: string
  title: string
  productName: string
  updatedAt: number
  createdAt: number
}

const readProjects = (): EcomProjectMeta[] => {
  try {
    const raw = localStorage.getItem(PROJECTS_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed.sort((a: any, b: any) => (b.updatedAt || 0) - (a.updatedAt || 0)) : []
  } catch {
    return []
  }
}

const writeProjects = (list: EcomProjectMeta[]) => {
  try {
    localStorage.setItem(PROJECTS_KEY, JSON.stringify(list))
  } catch { /* ignore */ }
}

export const listProjects = (): EcomProjectMeta[] => readProjects()

export const createProject = (title?: string): string => {
  const id = makeId()
  const now = Date.now()
  const meta: EcomProjectMeta = { id, title: title || '新电商项目', productName: '', updatedAt: now, createdAt: now }
  const list = readProjects()
  list.unshift(meta)
  writeProjects(list)
  saveDraft(id, createDefaultDraft(id))
  return id
}

export const deleteProject = (pid: string) => {
  try { localStorage.removeItem(`${DRAFT_PREFIX}:${pid}`) } catch { /* ignore */ }
  writeProjects(readProjects().filter(p => p.id !== pid))
}

export const duplicateProject = (pid: string): string | null => {
  const src = loadDraft(pid)
  if (!src) return null
  const nextId = makeId()
  const now = Date.now()
  const next = { ...src, projectId: nextId, createdAt: now, updatedAt: now, title: `${src.title} 副本` }
  saveDraft(nextId, next)
  const list = readProjects()
  list.unshift({ id: nextId, title: next.title, productName: next.product.name, updatedAt: now, createdAt: now })
  writeProjects(list)
  return nextId
}

export const touchProject = (pid: string, draft: EcomDraftV1) => {
  const list = readProjects()
  const idx = list.findIndex(p => p.id === pid)
  if (idx >= 0) {
    list[idx] = { ...list[idx], title: draft.title, productName: draft.product.name, updatedAt: Date.now() }
  } else {
    list.unshift({ id: pid, title: draft.title, productName: draft.product.name, updatedAt: Date.now(), createdAt: Date.now() })
  }
  writeProjects(list)
}
