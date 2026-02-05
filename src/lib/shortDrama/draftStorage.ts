import { DEFAULT_CHAT_MODEL, DEFAULT_IMAGE_MODEL, DEFAULT_VIDEO_MODEL } from '@/config/models'
import type {
  ShortDramaDraftV2,
  ShortDramaMediaKind,
  ShortDramaMediaSlot,
  ShortDramaMediaVariant,
  ShortDramaShot,
  ShortDramaShotFrame,
  ShortDramaStyle,
  ShortDramaAsset,
  ShortDramaAssetCategory,
} from '@/lib/shortDrama/types'

const DRAFT_KEY_PREFIX_V2 = 'nexus-short-drama-studio:draft:v2'
const LEGACY_KEY_PREFIX_V1 = 'nexus-short-drama-studio:v1'

// Keep this in sync with style presets list.
export const DEFAULT_STYLE_PRESET_ID = 'cinematic_realism'

const makeId = () => globalThis.crypto?.randomUUID?.() || `sd_${Date.now()}_${Math.random().toString(16).slice(2)}`

const safeJsonParse = (raw: string) => {
  try {
    return JSON.parse(raw)
  } catch {
    return null
  }
}

export const getShortDramaDraftStorageKeyV2 = (projectId: string) => `${DRAFT_KEY_PREFIX_V2}:${projectId || 'default'}`
export const getShortDramaDraftStorageKeyV1 = (projectId: string) => `${LEGACY_KEY_PREFIX_V1}:${projectId || 'default'}`

export const createEmptyMediaSlot = (kind: ShortDramaMediaKind, label?: string): ShortDramaMediaSlot => ({
  id: makeId(),
  kind,
  label,
  variants: [],
  selectedVariantId: undefined,
  selectionLockedByUser: false,
})

export const createEmptyImageSlot = (label?: string) => createEmptyMediaSlot('image', label)
export const createEmptyVideoSlot = (label?: string) => createEmptyMediaSlot('video', label)

export const createEmptyAsset = (
  name: string,
  description: string = '',
  category: ShortDramaAssetCategory = 'item'
): ShortDramaAsset => ({
  id: makeId(),
  name,
  description,
  category,
  ownerCharacterIds: [],
  ref: createEmptyImageSlot('资产参考图'),
  refs: [],
})

export const createDefaultStyle = (): ShortDramaStyle => ({
  presetId: DEFAULT_STYLE_PRESET_ID,
  customText: '',
  negativeText: '',
  locked: false,
})

export const createEmptyShot = (title?: string): ShortDramaShot => {
  const startSlot = createEmptyImageSlot('首帧')
  const endSlot = createEmptyImageSlot('尾帧')

  const mkFrame = (role: 'start' | 'end', slot: ShortDramaMediaSlot): ShortDramaShotFrame => ({
    role,
    prompt: '',
    slot,
  })

  return {
    id: makeId(),
    title: title || '镜头',
    sceneId: undefined,
    characterIds: [],
    beat: '',
    videoPrompt: '',
    frames: {
      start: mkFrame('start', startSlot),
      end: mkFrame('end', endSlot),
    },
    video: createEmptyVideoSlot('视频'),
  }
}

export const createDefaultDraftV2 = (projectId: string): ShortDramaDraftV2 => ({
  version: 2,
  projectId: projectId || 'default',
  createdAt: Date.now(),
  updatedAt: Date.now(),
  title: '',
  logline: '',
  script: { text: '' },
  style: createDefaultStyle(),
  models: {
    analysisModelKey: DEFAULT_CHAT_MODEL,
    imageModelKey: DEFAULT_IMAGE_MODEL,
    videoModelKey: DEFAULT_VIDEO_MODEL,
  },
  characters: [],
  scenes: [],
  assets: [],
  shots: [],
  plan: undefined,
})

const normalizeLegacyShotTitle = (title: unknown, index: number) => {
  const t = String(title || '').trim()
  return t || `镜头 ${index + 1}`
}

const toImageVariantFromLegacy = ({
  displayUrl,
  sourceUrl,
  localPath,
  mediaId,
  modelKey,
}: {
  displayUrl?: unknown
  sourceUrl?: unknown
  localPath?: unknown
  mediaId?: unknown
  modelKey?: unknown
}): ShortDramaMediaVariant | null => {
  const d = String(displayUrl || '').trim()
  const s = String(sourceUrl || '').trim()
  const m = String(mediaId || '').trim()
  const p = String(localPath || '').trim()
  if (!d && !s && !m) return null
  return {
    id: makeId(),
    kind: 'image',
    status: 'success',
    createdAt: Date.now(),
    createdBy: 'manual',
    modelKey: modelKey ? String(modelKey) : undefined,
    sourceUrl: s || undefined,
    displayUrl: d || undefined,
    localPath: p || undefined,
    mediaId: m || undefined,
  }
}

const toVideoVariantFromLegacy = ({
  displayUrl,
  sourceUrl,
  localPath,
  modelKey,
  taskId,
}: {
  displayUrl?: unknown
  sourceUrl?: unknown
  localPath?: unknown
  modelKey?: unknown
  taskId?: unknown
}): ShortDramaMediaVariant | null => {
  const d = String(displayUrl || '').trim()
  const s = String(sourceUrl || '').trim()
  const p = String(localPath || '').trim()
  const t = String(taskId || '').trim()
  if (!d && !s) return null
  return {
    id: makeId(),
    kind: 'video',
    status: 'success',
    createdAt: Date.now(),
    createdBy: 'manual',
    modelKey: modelKey ? String(modelKey) : undefined,
    taskId: t || undefined,
    sourceUrl: s || undefined,
    displayUrl: d || undefined,
    localPath: p || undefined,
  }
}

export const migrateLegacyDraftV1ToV2 = (legacy: any, projectId: string): ShortDramaDraftV2 => {
  const next = createDefaultDraftV2(projectId)

  // Basic fields
  next.title = String(legacy?.title || '').trim()
  next.logline = String(legacy?.logline || '').trim()
  next.updatedAt = Date.now()

  // Legacy stored "styleBible" as a single text block.
  const styleBible = String(legacy?.styleBible || '').trim()
  if (styleBible) next.style.customText = styleBible

  // Models/settings
  const imageModelKey = String(legacy?.settings?.imageModelKey || legacy?.settings?.imageModel || '').trim()
  const videoModelKey = String(legacy?.settings?.videoModelKey || legacy?.settings?.videoModel || '').trim()
  const imageSize = String(legacy?.settings?.imageSize || '').trim()
  const imageQuality = String(legacy?.settings?.imageQuality || '').trim()
  const videoRatio = String(legacy?.settings?.videoRatio || '').trim()
  const videoSize = String(legacy?.settings?.videoSize || '').trim()
  const videoDuration = Number(legacy?.settings?.videoDuration || 0)

  if (imageModelKey) next.models.imageModelKey = imageModelKey
  if (videoModelKey) next.models.videoModelKey = videoModelKey
  if (imageSize) next.models.imageSize = imageSize
  if (imageQuality) next.models.imageQuality = imageQuality
  if (videoRatio) next.models.videoRatio = videoRatio
  if (videoSize) next.models.videoSize = videoSize
  if (Number.isFinite(videoDuration) && videoDuration > 0) next.models.videoDuration = videoDuration

  // Migrate single character
  const legacyCharacterDesc = String(legacy?.characterDescription || '').trim()
  const legacyRef = legacy?.characterRef
  if (legacyCharacterDesc || legacyRef?.mediaId) {
    const sheetSlot = createEmptyImageSlot('角色设定图')
    const refSlots: ShortDramaMediaSlot[] = []
    let primaryRefSlotId: string | undefined

    if (legacyRef?.mediaId) {
      const refSlot = createEmptyImageSlot('参考图')
      const v = toImageVariantFromLegacy({
        displayUrl: '',
        sourceUrl: '',
        mediaId: legacyRef.mediaId,
        modelKey: undefined,
      })
      if (v) {
        refSlot.variants.push(v)
        refSlot.selectedVariantId = v.id
      }
      refSlots.push(refSlot)
      primaryRefSlotId = refSlot.id
    }

    next.characters.push({
      id: makeId(),
      name: '主角',
      description: legacyCharacterDesc,
      sheet: sheetSlot,
      refs: refSlots,
      primaryRefSlotId,
    })
  }

  // Migrate shots: legacy had single image+video result.
  const legacyShots = Array.isArray(legacy?.shots) ? legacy.shots : []
  next.shots = legacyShots.map((s: any, i: number): ShortDramaShot => {
    const shot: ShortDramaShot = createEmptyShot(normalizeLegacyShotTitle(s?.title, i))
    shot.frames.start.prompt = String(s?.imagePrompt || '').trim()
    shot.videoPrompt = String(s?.videoPrompt || '').trim()

    const imgV = toImageVariantFromLegacy({
      displayUrl: s?.image?.displayUrl,
      sourceUrl: s?.image?.sourceUrl,
      localPath: s?.image?.localPath,
      mediaId: s?.image?.mediaId,
      modelKey: s?.image?.modelKey,
    })
    if (imgV) {
      shot.frames.start.slot.variants.push(imgV)
      shot.frames.start.slot.selectedVariantId = imgV.id
    }

    const vidV = toVideoVariantFromLegacy({
      displayUrl: s?.video?.displayUrl,
      sourceUrl: s?.video?.sourceUrl,
      localPath: s?.video?.localPath,
      modelKey: s?.video?.modelKey,
      taskId: s?.video?.taskId,
    })
    if (vidV) {
      shot.video.variants.push(vidV)
      shot.video.selectedVariantId = vidV.id
    }
    return shot
  })

  return next
}

export const loadShortDramaDraftV2 = (projectId: string): ShortDramaDraftV2 => {
  const pid = projectId || 'default'
  const keyV2 = getShortDramaDraftStorageKeyV2(pid)

  const rawV2 = localStorage.getItem(keyV2)
  const parsedV2 = rawV2 ? safeJsonParse(rawV2) : null
  if (parsedV2 && parsedV2.version === 2) {
    // Ensure projectId consistency
    return { ...parsedV2, projectId: pid, updatedAt: Date.now() } as ShortDramaDraftV2
  }

  // Try legacy v1 and migrate
  const rawV1 = localStorage.getItem(getShortDramaDraftStorageKeyV1(pid))
  const parsedV1 = rawV1 ? safeJsonParse(rawV1) : null
  if (parsedV1 && parsedV1.version === 1) {
    const migrated = migrateLegacyDraftV1ToV2(parsedV1, pid)
    // Best-effort persist migrated version
    try {
      localStorage.setItem(keyV2, JSON.stringify(migrated))
    } catch {
      // ignore
    }
    return migrated
  }

  return createDefaultDraftV2(pid)
}

export const saveShortDramaDraftV2 = (projectId: string, draft: ShortDramaDraftV2): boolean => {
  const pid = projectId || draft?.projectId || 'default'
  const keyV2 = getShortDramaDraftStorageKeyV2(pid)
  try {
    localStorage.setItem(keyV2, JSON.stringify({ ...draft, projectId: pid, updatedAt: Date.now() }))
    return true
  } catch {
    return false
  }
}

