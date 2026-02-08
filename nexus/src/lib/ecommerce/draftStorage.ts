import type { EcomDraftV1, EcomMediaSlot, EcomDetailImage, EcomDetailRole, EcomSceneType, EcomBatchItem } from './types'
import { ECOM_DETAIL_ROLES } from './types'
import { DEFAULT_IMAGE_MODEL, DEFAULT_VIDEO_MODEL, DEFAULT_CHAT_MODEL } from '@/config/models'
import { saveMedia, getMedia } from '@/lib/mediaStorage'

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
    imageRatio: '1:1',
    imageResolution: '2K',
    imageAspectRatio: '1:1',
    videoModelKey: DEFAULT_VIDEO_MODEL,
    videoRatio: '9:16',
    videoDuration: 5,
    chatModelKey: DEFAULT_CHAT_MODEL,
    ttsModelKey: 'gemini-2.5-flash-preview-tts',
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
  videoScenes: [],
  batchScene: {
    templateId: '',
    promptTemplate: '',
    mainRefRole: 'product',
    items: [],
  },
  motionControlScenes: [],
  multiElementsScenes: [],
  digitalHumanScenes: [],
  chatHistory: [],
  activeScene: 'hero',
})

const migrateSlot = (raw: any, fallbackLabel: string): any => {
  if (raw && typeof raw === 'object' && Array.isArray(raw.variants)) return raw
  return createEmptySlot(fallbackLabel)
}

const migrateTryOnScene = (raw: any): any => {
  if (!raw || typeof raw !== 'object') return null
  return {
    id: raw.id || makeId(),
    modelImageSlot: migrateSlot(raw.modelImageSlot || raw.humanImageSlot || raw.sourceImageSlot, '模特照片'),
    productImageSlot: migrateSlot(raw.productImageSlot || raw.clothImageSlot, '商品图片'),
    resultSlot: migrateSlot(raw.resultSlot, '生成结果'),
    prompt: raw.prompt || '',
    aiAnalysis: raw.aiAnalysis || '',
  }
}

const migrateVideoScene = (raw: any): any => {
  if (!raw || typeof raw !== 'object') return null
  return {
    id: raw.id || makeId(),
    videoType: raw.videoType || 'product_rotate',
    prompt: raw.prompt || '',
    firstFrameSlot: migrateSlot(raw.firstFrameSlot, '首帧画面'),
    videoSlot: migrateSlot(raw.videoSlot, '视频'),
    digitalHumanAudioUrl: raw.digitalHumanAudioUrl,
    ttsText: raw.ttsText,
    ttsAudioDataUrl: raw.ttsAudioDataUrl,
  }
}

const migratePosterScene = (raw: any): any => {
  if (!raw || typeof raw !== 'object') return null
  return {
    ...raw,
    slot: migrateSlot(raw.slot, '营销海报'),
  }
}

const migrateMotionControlScene = (raw: any): any => {
  if (!raw || typeof raw !== 'object') return null
  return {
    id: raw.id || makeId(),
    sourceImageSlot: migrateSlot(raw.sourceImageSlot, '人物图片'),
    referenceVideoSlot: migrateSlot(raw.referenceVideoSlot, '参考视频'),
    resultSlot: migrateSlot(raw.resultSlot, '生成结果'),
    prompt: raw.prompt || '',
    mode: raw.mode || 'std',
    keepOriginalSound: !!raw.keepOriginalSound,
    characterOrientation: raw.characterOrientation || 'image',
  }
}

const migrateMultiElementsScene = (raw: any): any => {
  if (!raw || typeof raw !== 'object') return null
  return {
    id: raw.id || makeId(),
    sourceVideoSlot: migrateSlot(raw.sourceVideoSlot, '待编辑视频'),
    resultSlot: migrateSlot(raw.resultSlot, '生成结果'),
    prompt: raw.prompt || raw.editPrompt || '',
    editMode: raw.editMode || 'addition',
    segments: Array.isArray(raw.segments) ? raw.segments : [],
    mode: raw.mode || 'std',
    duration: raw.duration || 5,
    sessionId: raw.sessionId || raw.taskId,
  }
}

const migrateDigitalHumanScene = (raw: any): any => {
  if (!raw || typeof raw !== 'object') return null
  return {
    id: raw.id || makeId(),
    imageSlot: migrateSlot(raw.imageSlot || raw.sourceImageSlot, '人像照片'),
    audioSlot: migrateSlot(raw.audioSlot, '音频'),
    resultSlot: migrateSlot(raw.resultSlot, '生成结果'),
    prompt: raw.prompt || '',
    mode: raw.mode || 'std',
  }
}

const migrateBatchItem = (raw: any): any => {
  if (!raw || typeof raw !== 'object') return null
  return {
    ...raw,
    refSlot: migrateSlot(raw.refSlot, '参考图'),
    resultSlot: migrateSlot(raw.resultSlot, '生成结果'),
    secondaryRefSlots: Array.isArray(raw.secondaryRefSlots) ? raw.secondaryRefSlots : [],
  }
}

export const loadDraft = (pid: string): EcomDraftV1 => {
  try {
    const raw = localStorage.getItem(`${DRAFT_PREFIX}:${pid}`)
    if (!raw) return createDefaultDraft(pid)
    const parsed = JSON.parse(raw)
    if (parsed?.version !== 1) return createDefaultDraft(pid)
    const defaults = createDefaultDraft(pid)
    return {
      ...defaults,
      ...parsed,
      product: { ...defaults.product, ...parsed.product, sellingPoints: Array.isArray(parsed.product?.sellingPoints) ? parsed.product.sellingPoints : [] },
      models: { ...defaults.models, ...parsed.models },
      heroScene: { ...defaults.heroScene, ...parsed.heroScene, slot: parsed.heroScene?.slot || defaults.heroScene.slot },
      detailPageScene: {
        ...defaults.detailPageScene,
        ...parsed.detailPageScene,
        images: Array.isArray(parsed.detailPageScene?.images) && parsed.detailPageScene.images.length > 0 ? parsed.detailPageScene.images : defaults.detailPageScene.images,
      },
      tryOnScenes: Array.isArray(parsed.tryOnScenes) ? parsed.tryOnScenes.map(migrateTryOnScene).filter(Boolean) : [],
      posterScenes: Array.isArray(parsed.posterScenes) ? parsed.posterScenes.map(migratePosterScene).filter(Boolean) : [],
      videoScenes: Array.isArray(parsed.videoScenes) ? parsed.videoScenes.map(migrateVideoScene).filter(Boolean) : [],
      motionControlScenes: Array.isArray(parsed.motionControlScenes) ? parsed.motionControlScenes.map(migrateMotionControlScene).filter(Boolean) : [],
      multiElementsScenes: Array.isArray(parsed.multiElementsScenes) ? parsed.multiElementsScenes.map(migrateMultiElementsScene).filter(Boolean) : [],
      digitalHumanScenes: Array.isArray(parsed.digitalHumanScenes) ? parsed.digitalHumanScenes.map(migrateDigitalHumanScene).filter(Boolean) : [],
      batchScene: {
        ...defaults.batchScene,
        ...parsed.batchScene,
        items: Array.isArray(parsed.batchScene?.items)
          ? parsed.batchScene.items.map(migrateBatchItem).filter(Boolean)
          : [],
      },
      chatHistory: Array.isArray(parsed.chatHistory) ? parsed.chatHistory : [],
      productRefs: Array.isArray(parsed.productRefs) ? parsed.productRefs : [],
    }
  } catch {
    return createDefaultDraft(pid)
  }
}

// Track mediaIds that have been persisted to IndexedDB (survives across saves)
const persistedMediaIds = new Map<string, string>() // displayUrl hash → mediaId

function hashUrl(url: string): string {
  let h = 0
  const s = url.slice(0, 200) + url.length // Sample start + length for fast hash
  for (let i = 0; i < s.length; i++) { h = ((h << 5) - h) + s.charCodeAt(i); h |= 0 }
  return String(Math.abs(h))
}

function persistSlotToIndexedDb(slot: any, projectId: string) {
  if (!slot?.variants) return
  for (const v of slot.variants) {
    const url = v.displayUrl || v.sourceUrl || ''
    if (typeof url === 'string' && url.startsWith('data:') && url.length > 50000 && !v.mediaId) {
      const hash = hashUrl(url)
      // Already persisted in a previous save cycle?
      const cached = persistedMediaIds.get(hash)
      if (cached) { v.mediaId = cached; continue }

      saveMedia({
        nodeId: `ecom_${v.id || Date.now()}`,
        projectId,
        type: url.startsWith('data:video') ? 'video' : url.startsWith('data:audio') ? 'audio' : 'image',
        data: url,
      }).then(mediaId => {
        if (mediaId) persistedMediaIds.set(hash, mediaId)
      }).catch(() => {})
    }
  }
}

function applyPersistedMediaIds(slot: any) {
  if (!slot?.variants) return
  for (const v of slot.variants) {
    if (v.mediaId) continue
    const url = v.displayUrl || v.sourceUrl || ''
    if (typeof url === 'string' && url.startsWith('data:') && url.length > 50000) {
      const cached = persistedMediaIds.get(hashUrl(url))
      if (cached) v.mediaId = cached
    }
  }
}

function stripLargeDataUrls(draft: EcomDraftV1): EcomDraftV1 {
  // First pass on LIVE draft: apply any previously persisted mediaIds
  const applyAll = (d: EcomDraftV1) => {
    applyPersistedMediaIds(d.heroScene?.slot)
    for (const img of d.detailPageScene?.images || []) applyPersistedMediaIds(img.slot)
    for (const s of d.tryOnScenes || []) { applyPersistedMediaIds(s.modelImageSlot); applyPersistedMediaIds(s.productImageSlot); applyPersistedMediaIds(s.resultSlot) }
    for (const s of d.posterScenes || []) applyPersistedMediaIds(s.slot)
    for (const s of d.videoScenes || []) { applyPersistedMediaIds(s.firstFrameSlot); applyPersistedMediaIds(s.videoSlot) }
    for (const s of d.motionControlScenes || []) { applyPersistedMediaIds(s.sourceImageSlot); applyPersistedMediaIds(s.referenceVideoSlot); applyPersistedMediaIds(s.resultSlot) }
    for (const s of d.multiElementsScenes || []) { applyPersistedMediaIds(s.sourceVideoSlot); applyPersistedMediaIds(s.resultSlot) }
    for (const s of d.digitalHumanScenes || []) { applyPersistedMediaIds(s.imageSlot); applyPersistedMediaIds(s.audioSlot); applyPersistedMediaIds(s.resultSlot) }
    for (const item of d.batchScene?.items || []) { applyPersistedMediaIds(item.refSlot); applyPersistedMediaIds(item.resultSlot) }
    for (const ref of d.productRefs || []) applyPersistedMediaIds(ref.slot)
  }
  applyAll(draft) // Apply to LIVE draft so mediaIds propagate

  const clone = JSON.parse(JSON.stringify(draft))
  const pid = clone.projectId || 'default'

  const stripSlot = (slot: any) => {
    if (!slot?.variants) return
    persistSlotToIndexedDb(slot, pid)
    for (const v of slot.variants) {
      if (typeof v.displayUrl === 'string' && v.displayUrl.startsWith('data:') && v.displayUrl.length > 50000) {
        if (!v.sourceUrl || v.sourceUrl.startsWith('data:')) v.sourceUrl = ''
        v.displayUrl = ''
      }
    }
  }
  stripSlot(clone.heroScene?.slot)
  for (const img of clone.detailPageScene?.images || []) stripSlot(img.slot)
  for (const s of clone.tryOnScenes || []) { stripSlot(s.modelImageSlot); stripSlot(s.productImageSlot); stripSlot(s.resultSlot) }
  for (const s of clone.posterScenes || []) stripSlot(s.slot)
  for (const s of clone.videoScenes || []) { stripSlot(s.firstFrameSlot); stripSlot(s.videoSlot) }
  for (const s of clone.motionControlScenes || []) { stripSlot(s.sourceImageSlot); stripSlot(s.referenceVideoSlot); stripSlot(s.resultSlot) }
  for (const s of clone.multiElementsScenes || []) { stripSlot(s.sourceVideoSlot); stripSlot(s.resultSlot) }
  for (const s of clone.digitalHumanScenes || []) { stripSlot(s.imageSlot); stripSlot(s.audioSlot); stripSlot(s.resultSlot) }
  for (const item of clone.batchScene?.items || []) { stripSlot(item.refSlot); stripSlot(item.resultSlot); for (const ss of item.secondaryRefSlots || []) stripSlot(ss) }
  for (const ref of clone.productRefs || []) stripSlot(ref.slot)
  for (const msg of clone.chatHistory || []) {
    if (Array.isArray(msg.content)) {
      msg.content = msg.content.map((p: any) => {
        if (p.type === 'image_url' && p.image_url?.url?.length > 50000) return { type: 'text', text: '[图片]' }
        return p
      })
    }
    if (Array.isArray(msg.images)) msg.images = msg.images.filter((u: string) => !u.startsWith('data:') || u.length < 50000)
  }
  return clone
}

export const saveDraft = (pid: string, draft: EcomDraftV1): boolean => {
  try {
    const cleaned = stripLargeDataUrls(draft)
    localStorage.setItem(`${DRAFT_PREFIX}:${pid}`, JSON.stringify({ ...cleaned, updatedAt: Date.now() }))
    return true
  } catch (err) {
    console.error('[EcomDraft] saveDraft failed (likely quota exceeded):', err)
    window.$message?.error?.('项目数据过大，部分图片数据未能保存。建议减少上传图片数量。')
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

/**
 * Recover media URLs from IndexedDB for variants that have mediaId but no displayUrl.
 * Call this after loadDraft to restore images that were stripped during save.
 */
export const recoverMediaUrls = async (draft: EcomDraftV1): Promise<{ changed: boolean; draft: EcomDraftV1 }> => {
  let changed = false
  const recoverSlot = async (slot: any) => {
    if (!slot?.variants) return
    for (const v of slot.variants) {
      if (v.mediaId && !v.displayUrl) {
        try {
          const rec = await getMedia(v.mediaId)
          if (rec?.data) {
            v.displayUrl = rec.data
            changed = true
          }
        } catch { /* ignore */ }
      }
    }
  }

  await recoverSlot(draft.heroScene?.slot)
  for (const img of draft.detailPageScene?.images || []) await recoverSlot(img.slot)
  for (const s of draft.tryOnScenes || []) { await recoverSlot(s.modelImageSlot); await recoverSlot(s.productImageSlot); await recoverSlot(s.resultSlot) }
  for (const s of draft.posterScenes || []) await recoverSlot(s.slot)
  for (const s of draft.videoScenes || []) { await recoverSlot(s.firstFrameSlot); await recoverSlot(s.videoSlot) }
  for (const s of draft.motionControlScenes || []) { await recoverSlot(s.sourceImageSlot); await recoverSlot(s.referenceVideoSlot); await recoverSlot(s.resultSlot) }
  for (const s of draft.multiElementsScenes || []) { await recoverSlot(s.sourceVideoSlot); await recoverSlot(s.resultSlot) }
  for (const s of draft.digitalHumanScenes || []) { await recoverSlot(s.imageSlot); await recoverSlot(s.audioSlot); await recoverSlot(s.resultSlot) }
  for (const item of draft.batchScene?.items || []) { await recoverSlot(item.refSlot); await recoverSlot(item.resultSlot) }
  for (const ref of draft.productRefs || []) await recoverSlot(ref.slot)

  return { changed, draft }
}
