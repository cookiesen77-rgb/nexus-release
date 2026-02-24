import type { ShortDramaAutoStrategy, ShortDramaStudioMode } from '@/lib/shortDrama/types'

export interface ShortDramaStudioPrefsV1 {
  version: 1
  mode: ShortDramaStudioMode
  autoStrategy: ShortDramaAutoStrategy
  imageConcurrency: number
  videoConcurrency: number
  currentEpisodeId?: string
  assetSidebarOpen?: boolean
}

const PREFS_KEY_PREFIX_V1 = 'nexus-short-drama-studio:prefs:v1'

const safeJsonParse = (raw: string) => {
  try {
    return JSON.parse(raw)
  } catch {
    return null
  }
}

export const getShortDramaPrefsStorageKey = (projectId: string) => `${PREFS_KEY_PREFIX_V1}:${projectId || 'default'}`

export const createDefaultShortDramaPrefs = (): ShortDramaStudioPrefsV1 => ({
  version: 1,
  mode: 'auto',
  autoStrategy: 'fill_only',
  imageConcurrency: 4,
  videoConcurrency: 2,
})

export const loadShortDramaPrefs = (projectId: string): ShortDramaStudioPrefsV1 => {
  const raw = localStorage.getItem(getShortDramaPrefsStorageKey(projectId))
  const parsed = raw ? safeJsonParse(raw) : null
  if (parsed && parsed.version === 1) {
    const mode: ShortDramaStudioMode = parsed.mode === 'manual' ? 'manual' : 'auto'
    const autoStrategy: ShortDramaAutoStrategy = parsed.autoStrategy === 'full_auto' ? 'full_auto' : 'fill_only'
    const imageConcurrency = Math.max(1, Math.min(12, Number(parsed.imageConcurrency || 4)))
    const videoConcurrency = Math.max(1, Math.min(6, Number(parsed.videoConcurrency || 2)))
    return {
      version: 1,
      mode,
      autoStrategy,
      imageConcurrency,
      videoConcurrency,
      currentEpisodeId: typeof parsed.currentEpisodeId === 'string' ? parsed.currentEpisodeId : undefined,
      assetSidebarOpen: typeof parsed.assetSidebarOpen === 'boolean' ? parsed.assetSidebarOpen : undefined,
    }
  }
  return createDefaultShortDramaPrefs()
}

export const saveShortDramaPrefs = (projectId: string, prefs: ShortDramaStudioPrefsV1): boolean => {
  try {
    localStorage.setItem(getShortDramaPrefsStorageKey(projectId), JSON.stringify(prefs))
    return true
  } catch {
    return false
  }
}

