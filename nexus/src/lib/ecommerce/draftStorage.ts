import type { EcomDraftV1, EcomMediaSlot, EcomDetailImage, EcomDetailRole, EcomSceneType, EcomBatchItem } from './types'
import { ECOM_DETAIL_ROLES } from './types'
import { DEFAULT_IMAGE_MODEL, DEFAULT_VIDEO_MODEL, DEFAULT_CHAT_MODEL } from '@/config/models'

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
    characterOrientation: raw.characterOrientation || 'up',
  }
}

const migrateMultiElementsScene = (raw: any): any => {
  if (!raw || typeof raw !== 'object') return null
  return {
    id: raw.id || makeId(),
    sourceVideoSlot: migrateSlot(raw.sourceVideoSlot, '待编辑视频'),
    resultSlot: migrateSlot(raw.resultSlot, '生成结果'),
    prompt: raw.prompt || '',
    editPrompt: raw.editPrompt || '',
    taskId: raw.taskId,
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
