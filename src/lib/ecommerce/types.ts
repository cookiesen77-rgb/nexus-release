// E-Commerce Studio Types

export type EcomDraftVersion = 1
export type EcomSceneType = 'hero' | 'detail_page' | 'try_on' | 'poster'
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
  humanImageSlot: EcomMediaSlot
  clothImageSlot: EcomMediaSlot
  resultSlot: EcomMediaSlot
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
  chatModelKey: string
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

  activeScene: EcomSceneType
}
