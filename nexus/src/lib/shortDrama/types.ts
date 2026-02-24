export type ShortDramaDraftVersion = 2

export type ShortDramaStudioMode = 'auto' | 'manual'

export type ShortDramaAutoStrategy = 'fill_only' | 'full_auto'

export type ShortDramaMediaKind = 'image' | 'video'

export type ShortDramaMediaStatus = 'running' | 'success' | 'error'

export type ShortDramaCreatedBy = 'auto' | 'manual'

export type ShortDramaFrameRole = 'start' | 'end'

export type ShotFrameMode = 'first_only' | 'first_last' | 'grid_4' | 'grid_6' | 'grid_9' | 'grid_25'

export const SHOT_FRAME_MODES: { value: ShotFrameMode; label: string; cols: number; rows: number; count: number }[] = [
  { value: 'first_only', label: '仅首帧', cols: 1, rows: 1, count: 1 },
  { value: 'first_last', label: '首尾帧', cols: 2, rows: 1, count: 2 },
  { value: 'grid_4', label: '四宫格', cols: 2, rows: 2, count: 4 },
  { value: 'grid_6', label: '六宫格', cols: 3, rows: 2, count: 6 },
  { value: 'grid_9', label: '九宫格', cols: 3, rows: 3, count: 9 },
  { value: 'grid_25', label: '二十五宫格', cols: 5, rows: 5, count: 25 },
]

export interface ShortDramaStyleSnapshot {
  presetId: string
  customText: string
  negativeText: string
  locked: boolean
}

export interface ShortDramaMediaVariant {
  id: string
  kind: ShortDramaMediaKind
  status: ShortDramaMediaStatus
  createdAt: number
  createdBy: ShortDramaCreatedBy

  // Model + prompt snapshot (for reproducibility)
  modelKey?: string
  promptSnapshot?: string
  styleSnapshot?: ShortDramaStyleSnapshot

  // Media payload
  sourceUrl?: string
  displayUrl?: string
  localPath?: string
  mediaId?: string

  // Video task id (if any)
  taskId?: string

  error?: string
}

export interface ShortDramaMediaSlot {
  id: string
  kind: ShortDramaMediaKind
  label?: string
  variants: ShortDramaMediaVariant[]
  selectedVariantId?: string
  /**
   * If true, auto mode must not change selectedVariantId implicitly.
   */
  selectionLockedByUser?: boolean
}

export interface ShortDramaStyle {
  presetId: string
  customText: string
  negativeText: string
  locked: boolean
}

export interface ShortDramaModels {
  analysisModelKey: string
  imageModelKey: string
  imageSize?: string
  imageQuality?: string
  videoModelKey: string
  videoRatio?: string
  videoDuration?: number
  videoSize?: string
  videoResolution?: string
  targetShotCount?: number
  defaultFrameMode?: ShotFrameMode
}

export interface ShortDramaScriptSource {
  type: 'paste' | 'file' | 'canvas_text_node'
  fileName?: string
  nodeId?: string
}

export interface ShortDramaScript {
  text: string
  importedAt?: number
  source?: ShortDramaScriptSource
}

export interface ShortDramaEpisode {
  id: string
  title: string
  order: number
  synopsis?: string
  script: ShortDramaScript
  activeCharacterIds: string[]
  activeSceneIds: string[]
  activeAssetIds: string[]
  createdAt: number
  updatedAt: number
}

export interface ShortDramaCharacter {
  id: string
  name: string
  description: string

  /**
   * Character sheet: front/side/back + expressions (single composite image)
   */
  sheet: ShortDramaMediaSlot

  /**
   * Additional reference images
   */
  refs: ShortDramaMediaSlot[]

  /**
   * Preferred reference slot id (optional).
   */
  primaryRefSlotId?: string

  tags?: string[]
  favorite?: boolean
}

export interface ShortDramaScene {
  id: string
  name: string
  description: string

  /**
   * Primary scene reference slot.
   */
  ref: ShortDramaMediaSlot

  /**
   * Additional reference images (optional).
   */
  refs?: ShortDramaMediaSlot[]

  tags?: string[]
  favorite?: boolean
}

/**
 * 资产类型：武器、道具、重要物品
 */
export type ShortDramaAssetCategory = 'weapon' | 'prop' | 'vehicle' | 'accessory' | 'item' | 'other'

/**
 * 短剧资产（角色使用的武器、道具、重要物品等）
 */
export interface ShortDramaAsset {
  id: string
  name: string
  description: string
  category: ShortDramaAssetCategory

  /**
   * 关联的角色ID列表（哪些角色会使用此资产）
   */
  ownerCharacterIds?: string[]

  /**
   * 资产参考图
   */
  ref: ShortDramaMediaSlot

  /**
   * 附加参考图
   */
  refs?: ShortDramaMediaSlot[]

  tags?: string[]
  favorite?: boolean
}

export interface ShortDramaShotFrame {
  role: ShortDramaFrameRole
  prompt: string
  slot: ShortDramaMediaSlot
}

export interface ShortDramaShot {
  id: string
  title: string
  episodeId?: string

  sceneId?: string
  characterIds: string[]
  assetIds?: string[]

  /**
   * Frame generation mode: first frame only, first+last, or grid layouts
   */
  frameMode: ShotFrameMode

  /**
   * Optional beat/intent summary (emotion/action/dialogue)
   */
  beat?: string

  /**
   * Original script excerpt this shot corresponds to
   */
  scriptExcerpt?: string

  /**
   * Optional video prompt (camera/motion). If empty, auto or manual may derive it.
   */
  videoPrompt: string

  frames: {
    start: ShortDramaShotFrame
    end: ShortDramaShotFrame
  }

  /**
   * Grid mode prompts (one per panel, used when frameMode is grid_4/6/9/25)
   */
  gridPrompts?: string[]

  /**
   * Grid mode generated image slot (single composite image)
   */
  gridSlot?: ShortDramaMediaSlot

  /**
   * Video versions slot. selectedVariantId is the "adopted" video.
   */
  video: ShortDramaMediaSlot
}

export interface ShortDramaGenerationPlan {
  /**
   * A free-form JSON payload generated by AI (optional).
   * Keep it as unknown to avoid breaking changes when iterating prompt schema.
   */
  raw?: unknown
}

export interface ShortDramaDraftV2 {
  version: ShortDramaDraftVersion
  projectId: string
  createdAt: number
  updatedAt: number

  title: string
  logline: string

  script: ShortDramaScript
  style: ShortDramaStyle
  models: ShortDramaModels

  characters: ShortDramaCharacter[]
  scenes: ShortDramaScene[]
  assets: ShortDramaAsset[]
  episodes?: ShortDramaEpisode[]
  shots: ShortDramaShot[]

  plan?: ShortDramaGenerationPlan
}

