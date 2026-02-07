export const DEFAULT_API_BASE_URL: string

export const API_ENDPOINTS: {
  MODEL_PAGE: string
  MODEL_FULL_NAME: string
  MODEL_TYPES: string
  IMAGE_GENERATIONS: string
  VIDEO_GENERATIONS: string
  VIDEO_CREATE: string
  VIDEO_QUERY: string
  VIDEO_TASK: string
  RESPONSES: string
  CHAT_COMPLETIONS: string
}

export const ERROR_CODES: {
  INVALID_API_KEY: string
  RATE_LIMIT: string
  NETWORK_ERROR: string
  TIMEOUT: string
  UNKNOWN: string
}

export const VIDEO_POLL_CONFIG: {
  MAX_ATTEMPTS: number
  POLL_INTERVAL: number
}

export const DEFAULT_CHAT_CONFIG: {
  supportImage: boolean
  supportFile: boolean
  supportWeb: boolean
  supportDeepThink: boolean
}

export const STORAGE_KEYS: {
  API_KEY: string
  BASE_URL: string
}

