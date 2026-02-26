export type ShortDramaDraftVersion = 2

export type ShortDramaStudioMode = 'auto' | 'manual'

export type ShortDramaAutoStrategy = 'fill_only' | 'full_auto'

export type ShortDramaMediaKind = 'image' | 'video' | 'audio'

export type ShortDramaMediaStatus = 'running' | 'success' | 'error'

export type ShortDramaCreatedBy = 'auto' | 'manual'

export type CalibrationStatus = 'idle' | 'calibrating' | 'done' | 'failed'

export type ShortDramaBGMGenre = 'action' | 'romance' | 'suspense' | 'comedy' | 'epic' | 'calm' | 'mysterious'

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

  durationMs?: number

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
  ttsModelKey?: string
  narratorVoice?: ShortDramaVoiceConfig
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

// ── Voice & Audio ──

export type ShortDramaTTSProvider = 'gemini' | 'kling' | 'vidu'

export interface ShortDramaVoiceConfig {
  provider: ShortDramaTTSProvider
  voiceId: string
  voiceName?: string
  language?: string
  speed?: number
}

export interface ShortDramaShotAudio {
  dialogue: string
  dialogueCharacterId?: string
  narration?: string
  sfxDescription?: string
  bgmHint?: string
}

// ── Character Anchors ──

export interface ShortDramaCharacterAnchors {
  facialStructure?: string
  facialFeatures?: string
  uniqueMarks?: string
  colorAnchors?: string
  skinTexture?: string
  hairStyle?: string
}

export interface ShortDramaCostumeVariation {
  id: string
  name: string
  description: string
  episodeIds?: string[]
  ref?: ShortDramaMediaSlot
  stageType?: 'age' | 'era' | 'costume'
  episodeRange?: [number, number]
  ageDescription?: string
  visualPromptEn?: string
  visualPromptZh?: string
}

// ── Scene Viewpoints ──

export interface ShortDramaSceneViewpoint {
  id: string
  name: string
  description: string
  ref: ShortDramaMediaSlot
}

// ── Cinematography ──

export type ShortDramaLighting = 'high_key' | 'low_key' | 'chiaroscuro' | 'natural' | 'neon' | 'golden_hour' | 'candlelight'
export type ShortDramaCameraRig = 'tripod' | 'steadicam' | 'handheld' | 'crane' | 'drone' | 'dolly' | 'slider'
export type ShortDramaDoF = 'ultra_shallow' | 'shallow' | 'moderate' | 'deep'
export type ShortDramaSpeedRamp = 'normal' | 'slow_mo' | 'speed_up'
export type ShortDramaNarrativeFunction = 'setup' | 'escalation' | 'climax' | 'turn' | 'transition' | 'resolution'
export type ShortDramaShotSize = 'extreme_wide' | 'wide' | 'full' | 'medium' | 'close_up' | 'extreme_close_up' | 'insert'
export type ShortDramaCameraMovement = 'static' | 'pan_left' | 'pan_right' | 'tilt_up' | 'tilt_down' | 'dolly_in' | 'dolly_out' | 'tracking' | 'orbit' | 'push_in' | 'pull_out'

export type ShortDramaCameraAngle = 'eye_level' | 'high_angle' | 'low_angle' | 'dutch_angle' | 'over_the_shoulder' | 'birds_eye' | 'worms_eye'
export type ShortDramaSpecialTechnique = 'hitchcock_zoom' | 'bullet_time' | 'whip_pan' | 'rack_focus' | 'fpv_shuttle' | 'long_take' | 'timelapse' | 'hyperlapse'

export interface ShortDramaCinematography {
  lighting?: ShortDramaLighting
  cameraRig?: ShortDramaCameraRig
  depthOfField?: ShortDramaDoF
  atmosphere?: string[]
  speedRamp?: ShortDramaSpeedRamp
  narrativeFunction?: ShortDramaNarrativeFunction
  presetId?: string
  shotSize?: ShortDramaShotSize
  cameraMovement?: ShortDramaCameraMovement
  focalLength?: number
  cameraAngle?: ShortDramaCameraAngle
  specialTechnique?: ShortDramaSpecialTechnique
}

// ── Timeline (Export) ──

export interface ShortDramaTimelineSegment {
  shotId: string
  startMs: number
  durationMs: number
  videoUrl?: string
  dialogueUrl?: string
  narrationUrl?: string
  sfxUrl?: string
}

export interface ShortDramaTimeline {
  episodeId?: string
  segments: ShortDramaTimelineSegment[]
  totalDurationMs: number
}

export interface ShortDramaCharacter {
  id: string
  name: string
  description: string

  sheet: ShortDramaMediaSlot
  refs: ShortDramaMediaSlot[]
  primaryRefSlotId?: string

  voice?: ShortDramaVoiceConfig

  anchors?: ShortDramaCharacterAnchors

  costumes?: ShortDramaCostumeVariation[]

  tags?: string[]
  favorite?: boolean

  calibrationStatus?: CalibrationStatus
  calibratedDescription?: string
}

export interface ShortDramaScene {
  id: string
  name: string
  description: string

  ref: ShortDramaMediaSlot
  refs?: ShortDramaMediaSlot[]

  viewpoints?: ShortDramaSceneViewpoint[]

  tags?: string[]
  favorite?: boolean

  calibrationStatus?: CalibrationStatus
  calibratedDescription?: string
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
  viewpointId?: string
  characterIds: string[]
  assetIds?: string[]

  frameMode: ShotFrameMode

  beat?: string
  scriptExcerpt?: string
  videoPrompt: string

  frames: {
    start: ShortDramaShotFrame
    end: ShortDramaShotFrame
  }

  gridPrompts?: string[]
  gridSlot?: ShortDramaMediaSlot

  video: ShortDramaMediaSlot

  audio?: ShortDramaShotAudio
  dialogueSlot?: ShortDramaMediaSlot
  narrationSlot?: ShortDramaMediaSlot

  cinematography?: ShortDramaCinematography

  calibrationStatus?: CalibrationStatus
  calibratedVideoPrompt?: string
  calibratedStartPrompt?: string
  calibratedEndPrompt?: string
  narrativeArc?: string
  transitions?: string

  styleLocked?: boolean
  styleOverride?: ShortDramaStyleSnapshot

  enableLipSync?: boolean
}

export interface ShortDramaGenerationPlan {
  raw?: unknown
}

// ── Asset Reference (for S-Class multi-modal) ──

export interface ShortDramaAssetRef {
  id: string
  tag: string
  url: string
  localUrl?: string
  kind: ShortDramaMediaKind
  purpose?: string
  fileSize?: number
  duration?: number
}

// ── Shot Group (multi-shot merged narrative video) ──

export interface ShortDramaShotGroup {
  id: string
  name: string
  shotIds: string[]
  mergedPrompt: string
  calibratedPrompt?: string
  imageRefs: ShortDramaAssetRef[]
  videoRefs: ShortDramaAssetRef[]
  audioRefs: ShortDramaAssetRef[]
  video: ShortDramaMediaSlot
  narrativeArc?: string
  transitions?: string[]
  totalDurationSec?: number
  generationType?: 'new' | 'extend' | 'edit'
  calibrationStatus?: CalibrationStatus
}

// ── BGM ──

export interface ShortDramaBGMTrack {
  id: string
  name: string
  url: string
  localPath?: string
  mediaId?: string
  durationMs: number
  genre?: ShortDramaBGMGenre
  mood?: string
  bpm?: number
  loopable?: boolean
  source: 'upload' | 'generated' | 'library'
  tags?: string[]
}

export interface ShortDramaBGMAssignment {
  id: string
  trackId: string
  episodeId?: string
  shotRange?: [number, number]
  volume: number
  fadeInMs?: number
  fadeOutMs?: number
}

// ── Draft V2 ──

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

  shotGroups?: ShortDramaShotGroup[]
  bgmLibrary?: ShortDramaBGMTrack[]
  bgmAssignments?: ShortDramaBGMAssignment[]

  plan?: ShortDramaGenerationPlan
}

