export type AnyModel = {
  label: string
  key: string
  endpoint: string
  authMode?: 'bearer' | 'query'
  format?: string
  tips?: string
  sizes?: any[]
  qualities?: any[]
  ratios?: any[]
  durs?: any[]
  defaultParams?: Record<string, any>
  maxImages?: number
  statusEndpoint?: any
  endpointImage?: string
  statusEndpointImage?: any
  supportsSound?: boolean
  timeout?: number
}

export type SizeOption = {
  label: string
  value: string
}

export type QualityOption = {
  label: string
  value: string
}

export type KlingTool = {
  key: string
  label: string
  desc?: string
  endpoint?: string
  params?: Record<string, any>
}

// Image Models
export const IMAGE_MODELS: AnyModel[]
export const SEEDREAM_SIZE_OPTIONS: SizeOption[]
export const SEEDREAM_4K_SIZE_OPTIONS: SizeOption[]
export const SEEDREAM_QUALITY_OPTIONS: QualityOption[]
export const IMAGE_SIZE_OPTIONS: SizeOption[]
export const IMAGE_QUALITY_OPTIONS: QualityOption[]
export const IMAGE_STYLE_OPTIONS: { label: string; value: string }[]

// Video Models
export const VIDEO_MODELS: AnyModel[]
export const VIDEO_RATIO_LIST: { label: string; value: string }[]
export const VIDEO_RATIO_OPTIONS: { label: string; value: string }[]
export const VIDEO_DURATION_OPTIONS: { label: string; value: number }[]

// Chat Models
export const CHAT_MODELS: AnyModel[]

// Kling Tools
export const KLING_VIDEO_TOOLS: KlingTool[]
export const KLING_IMAGE_TOOLS: KlingTool[]
export const KLING_AUDIO_TOOLS: KlingTool[]

// Defaults
export const DEFAULT_IMAGE_MODEL: string
export const DEFAULT_VIDEO_MODEL: string
export const DEFAULT_CHAT_MODEL: string
export const DEFAULT_IMAGE_SIZE: string
export const DEFAULT_VIDEO_RATIO: string
export const DEFAULT_VIDEO_DURATION: number

/**
 * Resolve model config with backward-compatible aliases.
 */
export const getModelByName: (key: string) => AnyModel | undefined
