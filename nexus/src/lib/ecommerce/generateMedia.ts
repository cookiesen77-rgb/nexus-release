/**
 * E-Commerce image & video generation orchestration
 * Reuses the shortDrama generateMedia pipeline
 */
import { generateShortDramaImage, generateShortDramaVideo } from '@/lib/shortDrama/generateMedia'
import type { ShortDramaImageResult, ShortDramaVideoResult } from '@/lib/shortDrama/generateMedia'
import { cacheRemoteMedia } from '@/lib/mediaStorage'
import type { EcomDraftV1, EcomMediaVariant, EcomDetailRole } from './types'
import { ECOM_DETAIL_ROLES } from './types'

/**
 * 后台缓存生成结果到项目 IndexedDB，确保源链接过期后仍可访问
 */
export function bgCacheToProject(url: string, projectId: string, type: 'image' | 'video' = 'image', model?: string) {
  if (!url || !url.startsWith('http') || !projectId) return
  void cacheRemoteMedia({ url, projectId, type, model }).catch(() => {})
}

const normalizeText = (t: unknown) => String(t || '').replace(/\r\n/g, '\n').trim()

// Detail page role-specific prompt templates
const DETAIL_ROLE_PROMPTS: Record<EcomDetailRole, string> = {
  hero: 'Professional hero product shot, clean composition, dramatic studio lighting, product as the focal point, slight reflection on surface',
  feature: 'Close-up highlighting key selling feature, detail-oriented composition, callout-friendly framing with space for text overlay',
  scale: 'Product in-hand or next to common object for size reference, clean white background, accurate proportions, measurement-friendly angle',
  macro: 'Extreme close-up macro shot of material texture and surface quality, studio lighting revealing micro-details, premium feel',
  in_use: 'Product being used in realistic daily scenario, natural environment, candid feel, warm lighting, lifestyle photography',
  package: 'Product with packaging unboxed, neat arrangement showing all included items, clean surface, flat-lay or 45-degree angle',
  alt_angle: 'Product from alternative angle (side/back/bottom), revealing hidden details or features, consistent white background',
  lifestyle: 'Product in aspirational lifestyle setting, warm ambient lighting, bokeh background, Instagram-worthy composition',
  trust: 'Product quality details showing craftsmanship, certifications, or premium materials, confidence-building visual, clean informational layout',
}

export interface EcomImageRequest {
  modelKey: string
  prompt: string
  size?: string
  quality?: string
  refImages?: string[]
}

export type EcomImageResult = ShortDramaImageResult

export async function generateEcomImage(req: EcomImageRequest): Promise<EcomImageResult> {
  return generateShortDramaImage({
    modelKey: req.modelKey,
    prompt: req.prompt,
    size: req.size,
    quality: req.quality,
    refImages: req.refImages,
  })
}

// Build hero image prompt
export function buildHeroPrompt(draft: EcomDraftV1): string {
  const p = draft.product
  const bg = draft.heroScene.backgroundType
  const angle = draft.heroScene.angle || '45度'

  const parts: string[] = []
  parts.push(`Professional product photography of ${p.name || 'the product'}`)
  if (p.brand) parts.push(`by ${p.brand}`)
  if (p.description) parts.push(p.description)

  if (bg === 'white') parts.push('pure white background, studio softbox lighting, clean shadow')
  else if (bg === 'scene') parts.push('lifestyle context setting, natural warm lighting, bokeh background')
  else if (bg === 'gradient') parts.push('smooth gradient background, modern floating product display, dramatic spotlight')
  else if (bg === 'custom' && draft.heroScene.customBackground) parts.push(draft.heroScene.customBackground)

  parts.push(`${angle} viewing angle`)
  parts.push('high resolution, commercial quality, accurate material texture and color')

  if (draft.heroScene.prompt) parts.push(draft.heroScene.prompt)

  return parts.join(', ')
}

// Build detail page image prompt for a specific role
export function buildDetailPrompt(draft: EcomDraftV1, role: EcomDetailRole): string {
  const p = draft.product
  const consistency = draft.detailPageScene.consistencyPrompt || ''
  const rolePrompt = DETAIL_ROLE_PROMPTS[role] || ''
  const roleLabel = ECOM_DETAIL_ROLES.find(r => r.role === role)?.label || role

  const parts: string[] = []
  if (consistency) parts.push(consistency)
  parts.push(`[${roleLabel}] ${rolePrompt}`)
  parts.push(`Product: ${p.name || 'product'}`)
  if (p.brand) parts.push(`Brand: ${p.brand}`)
  if (p.description) parts.push(p.description)
  if (p.sellingPoints?.length > 0) parts.push(`Key features: ${p.sellingPoints.join(', ')}`)
  parts.push('consistent lighting, color, and style across all images in this set')

  return parts.join('. ')
}

// Build poster prompt
export function buildPosterPrompt(draft: EcomDraftV1, posterIdx: number): string {
  const poster = draft.posterScenes[posterIdx]
  if (!poster) return ''
  const p = draft.product

  const campaignLabels: Record<string, string> = {
    double_11: 'Double 11 Shopping Festival, red and gold festive theme',
    '618': '618 Mid-year Sale, fresh summer colors',
    new_year: 'Chinese New Year / Spring Festival, traditional lucky red and gold',
    black_friday: 'Black Friday, dark dramatic theme with neon accents',
    custom: poster.campaignText || 'promotional campaign',
  }

  const parts: string[] = []
  parts.push(`E-commerce promotional poster, 9:16 vertical format`)
  parts.push(campaignLabels[poster.campaign] || poster.campaign)
  parts.push(`Product: ${p.name || 'product'}`)
  if (poster.headline) parts.push(`Headline text area: "${poster.headline}"`)
  if (poster.subheadline) parts.push(`Subheadline: "${poster.subheadline}"`)
  if (poster.discountText) parts.push(`Discount badge: "${poster.discountText}"`)
  if (poster.ctaText) parts.push(`CTA button area: "${poster.ctaText}"`)
  parts.push('leave clear space for text overlay, product prominently displayed')
  if (poster.prompt) parts.push(poster.prompt)

  return parts.join('. ')
}

// Collect product reference image URLs from draft
export function collectProductRefUrls(draft: EcomDraftV1): string[] {
  const urls: string[] = []
  for (const ref of draft.productRefs) {
    const v = ref.slot.variants.find(v => v.id === ref.slot.selectedVariantId) || ref.slot.variants[0]
    if (!v) continue
    const url = v.displayUrl || v.sourceUrl || ''
    if (url) urls.push(url)
  }
  return urls.filter(Boolean)
}

// ===== Video generation for e-commerce =====

export interface EcomVideoRequest {
  modelKey: string
  prompt: string
  ratio?: string
  duration?: number
  size?: string
  firstFrameUrl?: string
}

export type EcomVideoResult = ShortDramaVideoResult

export async function generateEcomVideo(req: EcomVideoRequest): Promise<EcomVideoResult> {
  return generateShortDramaVideo({
    modelKey: req.modelKey,
    prompt: req.prompt,
    ratio: req.ratio,
    duration: req.duration,
    size: req.size,
    images: req.firstFrameUrl ? [req.firstFrameUrl] : undefined,
  })
}

// Build product showcase video prompt
export function buildProductVideoPrompt(draft: EcomDraftV1, videoType: string): string {
  const p = draft.product
  const parts: string[] = []

  if (videoType === 'product_rotate') {
    parts.push(`Product showcase video: smooth 360-degree rotation of ${p.name || 'product'}`)
    parts.push('slow orbit camera movement around the product, studio lighting, pure white or gradient background')
    parts.push('product stays centered, rotating slowly to reveal all angles and details')
    parts.push('professional commercial quality, clean shadow, highlight material texture')
  } else if (videoType === 'product_showcase') {
    parts.push(`Cinematic product reveal video of ${p.name || 'product'}`)
    parts.push('dramatic entrance with slow dolly in, spotlight gradually illuminating the product')
    parts.push('camera slowly orbits, revealing key features, macro detail shots intermixed')
    parts.push('premium advertising quality, dynamic lighting transitions, subtle particle effects')
  } else if (videoType === 'digital_human') {
    parts.push(`Digital spokesperson presenting ${p.name || 'product'}`)
    parts.push('natural talking head, professional attire, warm studio lighting')
    parts.push('product displayed beside or held by the presenter')
    parts.push('confident and friendly demeanor, direct eye contact with camera')
  } else {
    parts.push(`E-commerce video for ${p.name || 'product'}`)
  }

  if (p.brand) parts.push(`Brand: ${p.brand}`)
  if (p.description) parts.push(p.description)
  if (p.sellingPoints?.length > 0) parts.push(`Highlights: ${p.sellingPoints.join(', ')}`)

  return parts.join('. ')
}

// Build batch prompt from template + product name
export function buildBatchItemPrompt(template: string, productName: string, refDescription: string): string {
  let prompt = template || 'Professional product photography, studio lighting, commercial quality'
  prompt = prompt.replace(/\{\{PRODUCT\}\}/g, productName || 'product')
  prompt = prompt.replace(/\{\{DESCRIPTION\}\}/g, refDescription || '')
  if (!prompt.includes(productName) && productName) {
    prompt = `${productName}. ${prompt}`
  }
  return prompt
}
