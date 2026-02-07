import { DEFAULT_IMAGE_MODEL, DEFAULT_VIDEO_MODEL, IMAGE_MODELS, VIDEO_MODELS } from '@/config/models'
import * as modelsConfig from '@/config/models'

export type VideoImageRole = 'first_frame_image' | 'last_frame_image' | 'input_reference'

export type VideoModelCaps = {
  modelKey: string
  label: string
  tips: string
  requiresPrompt: boolean
  supportsFirstFrame: boolean
  supportsLastFrame: boolean
  supportsReferenceImages: boolean
  supportsReferenceVideo: boolean
  maxRefImages: number
  maxRefVideos: number
  maxImages: number
  requiresFirstFrameIfLastFrame: boolean
}

export type ImageModelCaps = {
  modelKey: string
  label: string
  tips: string
  requiresPrompt: boolean
  supportsReferenceImages: boolean
  maxRefImages: number
  requiresReferenceImages: boolean
}

export const getVideoModelConfig = (modelKey: string): any => {
  const key = String(modelKey || '').trim() || DEFAULT_VIDEO_MODEL
  const resolved: any = (modelsConfig as any)?.getModelByName?.(key) || null
  if (resolved && String(resolved?.format || '').includes('video')) return resolved
  return (VIDEO_MODELS as any[]).find((m: any) => m.key === key) || (VIDEO_MODELS as any[]).find((m: any) => m.key === DEFAULT_VIDEO_MODEL) || (VIDEO_MODELS as any[])[0]
}

export const getImageModelConfig = (modelKey: string): any => {
  const key = String(modelKey || '').trim() || DEFAULT_IMAGE_MODEL
  const resolved: any = (modelsConfig as any)?.getModelByName?.(key) || null
  // getModelByName 可能回退到默认视频模型，这里确保取到的是图片模型
  if (resolved && !String(resolved?.format || '').includes('video')) return resolved
  return (IMAGE_MODELS as any[]).find((m: any) => m.key === key) || (IMAGE_MODELS as any[]).find((m: any) => m.key === DEFAULT_IMAGE_MODEL) || (IMAGE_MODELS as any[])[0]
}

export const getVideoModelCaps = (modelKey: string): VideoModelCaps => {
  const cfg: any = getVideoModelConfig(modelKey)
  const label = String(cfg?.label || cfg?.key || modelKey || '').trim()
  const tips = String(cfg?.tips || '').trim()

  const supportsFirstFrame = !!cfg?.supportsFirstFrame
  const supportsLastFrame = !!cfg?.supportsLastFrame
  const supportsReferenceImages = !!cfg?.supportsReferenceImages
  const supportsReferenceVideo = !!cfg?.supportsReferenceVideo

  const maxImagesRaw = Number(cfg?.maxImages)
  const maxImages = Number.isFinite(maxImagesRaw) && maxImagesRaw > 0 ? Math.floor(maxImagesRaw) : 0

  const maxRefRaw = Number(cfg?.maxRefImages)
  let maxRefImages = Number.isFinite(maxRefRaw) && maxRefRaw >= 0 ? Math.floor(maxRefRaw) : 0
  if (!supportsReferenceImages) maxRefImages = 0
  if (supportsReferenceImages && maxRefImages === 0 && maxImages > 0) {
    // 若未显式标注 maxRefImages，则保守回退到 maxImages
    maxRefImages = maxImages
  }

  const maxRefVideosRaw = Number(cfg?.maxRefVideos)
  let maxRefVideos = Number.isFinite(maxRefVideosRaw) && maxRefVideosRaw >= 0 ? Math.floor(maxRefVideosRaw) : 0
  if (!supportsReferenceVideo) maxRefVideos = 0

  return {
    modelKey: String(cfg?.key || modelKey || '').trim(),
    label,
    tips,
    requiresPrompt: !!cfg?.requiresPrompt,
    supportsFirstFrame,
    supportsLastFrame,
    supportsReferenceImages,
    supportsReferenceVideo,
    maxRefImages,
    maxRefVideos,
    maxImages,
    requiresFirstFrameIfLastFrame: !!cfg?.requiresFirstFrameIfLastFrame,
  }
}

export const getImageModelCaps = (modelKey: string): ImageModelCaps => {
  const cfg: any = getImageModelConfig(modelKey)
  const label = String(cfg?.label || cfg?.key || modelKey || '').trim()
  const tips = String(cfg?.tips || '').trim()

  const supportsReferenceImages = !!cfg?.supportsReferenceImages
  const maxRefRaw = Number(cfg?.maxRefImages)
  let maxRefImages = Number.isFinite(maxRefRaw) && maxRefRaw >= 0 ? Math.floor(maxRefRaw) : 0
  if (!supportsReferenceImages) maxRefImages = 0

  return {
    modelKey: String(cfg?.key || modelKey || '').trim(),
    label,
    tips,
    requiresPrompt: !!cfg?.requiresPrompt,
    supportsReferenceImages,
    maxRefImages,
    requiresReferenceImages: !!cfg?.requiresReferenceImages,
  }
}

export const getAllowedVideoImageRoles = (caps: VideoModelCaps): VideoImageRole[] => {
  const out: VideoImageRole[] = []
  if (caps.supportsFirstFrame) out.push('first_frame_image')
  if (caps.supportsLastFrame) out.push('last_frame_image')
  if (caps.supportsReferenceImages) out.push('input_reference')
  // 兜底：避免 UI 无选项导致崩溃
  if (out.length === 0) out.push('input_reference')
  return out
}

export const coerceVideoImageRole = (role: string, caps: VideoModelCaps): VideoImageRole => {
  const desired = String(role || '').trim() as VideoImageRole
  const allowed = new Set(getAllowedVideoImageRoles(caps))
  if (allowed.has(desired)) return desired
  // 尽量把“参考图/尾帧”向更通用的角色回退
  if (allowed.has('first_frame_image')) return 'first_frame_image'
  if (allowed.has('input_reference')) return 'input_reference'
  return getAllowedVideoImageRoles(caps)[0]
}

