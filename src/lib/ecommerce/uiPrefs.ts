import type { EcomSceneType } from './types'

export interface EcomStudioPrefsV1 {
  version: 1
  activeScene: EcomSceneType
  showRefinementChat: boolean
  imageConcurrency: number
}

const PREFS_PREFIX = 'nexus-ecom-studio:prefs:v1'

const defaultPrefs = (): EcomStudioPrefsV1 => ({
  version: 1,
  activeScene: 'hero',
  showRefinementChat: true,
  imageConcurrency: 2,
})

export const loadPrefs = (pid: string): EcomStudioPrefsV1 => {
  try {
    const raw = localStorage.getItem(`${PREFS_PREFIX}:${pid}`)
    if (!raw) return defaultPrefs()
    const p = JSON.parse(raw)
    return p?.version === 1 ? p : defaultPrefs()
  } catch {
    return defaultPrefs()
  }
}

export const savePrefs = (pid: string, prefs: EcomStudioPrefsV1) => {
  try {
    localStorage.setItem(`${PREFS_PREFIX}:${pid}`, JSON.stringify(prefs))
  } catch { /* ignore */ }
}
