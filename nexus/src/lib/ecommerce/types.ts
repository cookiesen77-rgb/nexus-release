// E-Commerce Studio Types

export type EcomDraftVersion = 1
export type EcomSceneType = 'hero' | 'detail_page' | 'try_on' | 'poster' | 'video' | 'batch' | 'motion_control' | 'multi_elements' | 'digital_human' | 'lip_sync'
export type EcomMediaStatus = 'pending' | 'running' | 'success' | 'error'
export type EcomCreatedBy = 'auto' | 'manual' | 'template'

export interface EcomMediaVariant {
  id: string
  status: EcomMediaStatus
  createdAt: number
  createdBy: EcomCreatedBy
  modelKey?: string
  promptSnapshot?: string
  templateId?: string
  sourceUrl?: string
  displayUrl?: string
  mediaId?: string
  taskId?: string
  error?: string
}

export interface EcomMediaSlot {
  id: string
  label?: string
  variants: EcomMediaVariant[]
  selectedVariantId?: string
  selectionLockedByUser?: boolean
}

export interface EcomProduct {
  name: string
  category: string
  brand: string
  description: string
  sellingPoints: string[]
  targetAudience: string
}

export interface EcomProductRef {
  id: string
  label: string
  slot: EcomMediaSlot
}

export interface EcomHeroScene {
  backgroundType: 'white' | 'scene' | 'gradient' | 'custom'
  customBackground: string
  angle: string
  prompt: string
  slot: EcomMediaSlot
}

export type EcomDetailRole = 'hero' | 'feature' | 'scale' | 'macro' | 'in_use' | 'package' | 'alt_angle' | 'lifestyle' | 'trust'

export const ECOM_DETAIL_ROLES: { role: EcomDetailRole; label: string }[] = [
  { role: 'hero', label: '主图' },
  { role: 'feature', label: '卖点展示' },
  { role: 'scale', label: '尺寸参考' },
  { role: 'macro', label: '材质微距' },
  { role: 'in_use', label: '使用场景' },
  { role: 'package', label: '包装展示' },
  { role: 'alt_angle', label: '侧面角度' },
  { role: 'lifestyle', label: '生活化场景' },
  { role: 'trust', label: '信任背书' },
]

export interface EcomDetailImage {
  id: string
  index: number
  role: EcomDetailRole
  prompt: string
  slot: EcomMediaSlot
}

export interface EcomDetailPageScene {
  images: EcomDetailImage[]
  consistencyPrompt: string
}

export interface EcomTryOnScene {
  id: string
  modelImageSlot: EcomMediaSlot
  productImageSlot: EcomMediaSlot
  resultSlot: EcomMediaSlot
  prompt: string
  aiAnalysis?: string
}

export interface EcomMotionControlScene {
  id: string
  sourceImageSlot: EcomMediaSlot
  referenceVideoSlot: EcomMediaSlot
  resultSlot: EcomMediaSlot
  prompt: string
  mode: 'std' | 'pro'
  keepOriginalSound: boolean
  characterOrientation: 'image' | 'video'
}

export interface EcomMultiElementsScene {
  id: string
  sourceVideoSlot: EcomMediaSlot
  resultSlot: EcomMediaSlot
  prompt: string
  editMode: 'addition' | 'swap' | 'removal'
  segments: { frameIndex: number; points: { x: number; y: number }[] }[]
  negativePrompt?: string
  mode?: 'std' | 'pro'
  duration?: number
  sessionId?: string
}

export type EcomPosterCampaign = 'double_11' | '618' | 'new_year' | 'black_friday' | 'custom'

export interface EcomPosterScene {
  id: string
  campaign: EcomPosterCampaign
  campaignText: string
  headline: string
  subheadline: string
  ctaText: string
  discountText: string
  templatePresetId: string
  prompt: string
  slot: EcomMediaSlot
}

export interface EcomModelPrefs {
  imageModelKey: string
  imageSize: string
  imageQuality: string
  imageRatio: string
  imageResolution: string
  imageAspectRatio: string
  videoModelKey: string
  videoRatio: string
  videoDuration: number
  chatModelKey: string
  ttsModelKey: string
}

// Video scene for product showcase videos
export type EcomVideoType = 'product_rotate' | 'product_showcase' | 'digital_human' | 'tts_avatar' | 'custom'

export interface EcomVideoScene {
  id: string
  videoType: EcomVideoType
  prompt: string
  firstFrameSlot: EcomMediaSlot
  videoSlot: EcomMediaSlot
  digitalHumanAudioUrl?: string
  ttsText?: string
  ttsAudioDataUrl?: string
}

// Batch generation: multiple products × same template
export interface EcomBatchItem {
  id: string
  productName: string
  refSlot: EcomMediaSlot
  secondaryRefSlots: EcomMediaSlot[]
  resultSlot: EcomMediaSlot
  status: EcomMediaStatus
  aiAnalysis?: string
}

export interface EcomBatchScene {
  templateId: string
  promptTemplate: string
  mainRefRole: 'product' | 'model'
  items: EcomBatchItem[]
}

export interface EcomDigitalHumanScene {
  id: string
  imageSlot: EcomMediaSlot
  audioSlot: EcomMediaSlot
  resultSlot: EcomMediaSlot
  prompt: string
  mode: 'std' | 'pro'
}

export interface EcomLipSyncScene {
  id: string
  videoSlot: EcomMediaSlot
  audioSlot: EcomMediaSlot
  resultSlot: EcomMediaSlot
  prompt: string
  faceIndex: number
}

// Chat message with multimodal support
export type EcomChatContentPart = { type: 'text'; text: string } | { type: 'image_url'; image_url: { url: string } }

export interface EcomChatMessage {
  role: 'system' | 'user' | 'assistant'
  content: string | EcomChatContentPart[]
  images?: string[]
  timestamp?: number
}

export interface EcomDraftV1 {
  version: EcomDraftVersion
  projectId: string
  createdAt: number
  updatedAt: number
  title: string

  product: EcomProduct
  productRefs: EcomProductRef[]
  models: EcomModelPrefs

  heroScene: EcomHeroScene
  detailPageScene: EcomDetailPageScene
  tryOnScenes: EcomTryOnScene[]
  posterScenes: EcomPosterScene[]
  videoScenes: EcomVideoScene[]
  batchScene: EcomBatchScene
  motionControlScenes: EcomMotionControlScene[]
  multiElementsScenes: EcomMultiElementsScene[]
  digitalHumanScenes: EcomDigitalHumanScene[]
  lipSyncScenes: EcomLipSyncScene[]

  chatHistory: EcomChatMessage[]
  activeScene: EcomSceneType
}
