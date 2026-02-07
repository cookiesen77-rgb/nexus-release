/**
 * E-Commerce image generation orchestration
 * Reuses the shortDrama generateMedia pipeline
 */
import { generateShortDramaImage } from '@/lib/shortDrama/generateMedia'
import type { ShortDramaImageResult } from '@/lib/shortDrama/generateMedia'
import { postJson, getJson } from '@/lib/workflow/request'
import { IMAGE_MODELS, KLING_IMAGE_TOOLS } from '@/config/models'
import type { EcomDraftV1, EcomMediaVariant, EcomDetailRole } from './types'
import { ECOM_DETAIL_ROLES } from './types'

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
  if (p.sellingPoints.length > 0) parts.push(`Key features: ${p.sellingPoints.join(', ')}`)
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

// Virtual try-on via Kling API
export async function generateTryOn(humanImageUrl: string, clothImageUrl: string): Promise<{ taskId: string; imageUrl: string }> {
  const toolCfg = (KLING_IMAGE_TOOLS as any[])?.find((t: any) => t.key === 'kling-virtual-try-on')
  if (!toolCfg) throw new Error('未找到虚拟试穿模型配置')

  const endpoint = String(toolCfg.endpoint || '').trim()
  if (!endpoint) throw new Error('虚拟试穿 endpoint 为空')

  const payload = {
    model_name: 'kolors-virtual-try-on-v1',
    human_image: humanImageUrl,
    cloth_image: clothImageUrl,
  }

  const resp = await postJson<any>(endpoint, payload, { authMode: 'bearer', timeoutMs: 30000 })
  const taskId = String(resp?.data?.task_id || resp?.task_id || '').trim()
  if (!taskId) throw new Error('虚拟试穿任务创建失败')

  // Poll for result
  const statusEndpoint = typeof toolCfg.statusEndpoint === 'function' ? toolCfg.statusEndpoint(taskId) : ''
  if (!statusEndpoint) throw new Error('虚拟试穿查询 endpoint 为空')

  const maxAttempts = 60
  for (let i = 0; i < maxAttempts; i++) {
    await new Promise(r => setTimeout(r, 3000))
    const status = await getJson<any>(statusEndpoint, { authMode: 'bearer', timeoutMs: 15000 })
    const taskStatus = String(status?.data?.task_status || '').toLowerCase()
    if (taskStatus === 'succeed' || taskStatus === 'completed') {
      const images = status?.data?.task_result?.images || []
      const imageUrl = String(images[0]?.url || '').trim()
      if (imageUrl) return { taskId, imageUrl }
      throw new Error('虚拟试穿完成但未返回图片')
    }
    if (taskStatus === 'failed') {
      throw new Error(String(status?.data?.task_status_msg || '虚拟试穿失败'))
    }
  }
  throw new Error('虚拟试穿超时（3分钟）')
}
