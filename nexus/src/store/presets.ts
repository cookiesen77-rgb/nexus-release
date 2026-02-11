import { create } from 'zustand'
import { BUILT_IN_STYLE_PRESETS, type StylePreset } from '@/lib/stylePresets'

// ==================== Prompt Presets ====================

export interface PromptPreset {
  id: string
  category: 'character' | 'scene' | 'camera' | 'style' | 'custom'
  title: string
  content: string
  tags: string[]
  createdAt: number
}

const PROMPT_STORAGE_KEY = 'nexus-prompt-presets'

const loadPromptPresets = (): PromptPreset[] => {
  try {
    const raw = localStorage.getItem(PROMPT_STORAGE_KEY)
    return raw ? JSON.parse(raw) : []
  } catch { return [] }
}

const savePromptPresets = (presets: PromptPreset[]) => {
  try { localStorage.setItem(PROMPT_STORAGE_KEY, JSON.stringify(presets)) } catch {}
}

// ==================== Style Presets ====================

export type { StylePreset } from '@/lib/stylePresets'

const STYLE_STORAGE_KEY = 'nexus-style-presets'

const loadStylePresets = (): StylePreset[] => {
  try {
    const raw = localStorage.getItem(STYLE_STORAGE_KEY)
    const user: StylePreset[] = raw ? JSON.parse(raw) : []
    return [...BUILT_IN_STYLE_PRESETS, ...user]
  } catch { return [...BUILT_IN_STYLE_PRESETS] }
}

const saveStylePresets = (presets: StylePreset[]) => {
  const userOnly = presets.filter(p => !p.builtIn)
  try { localStorage.setItem(STYLE_STORAGE_KEY, JSON.stringify(userOnly)) } catch {}
}

// ==================== Combined Store ====================

interface PresetsState {
  presets: PromptPreset[]
  addPreset: (p: Omit<PromptPreset, 'id' | 'createdAt'>) => string
  removePreset: (id: string) => void
  updatePreset: (id: string, data: Partial<PromptPreset>) => void

  stylePresets: StylePreset[]
  addStylePreset: (p: Omit<StylePreset, 'id'>) => string
  removeStylePreset: (id: string) => void
  updateStylePreset: (id: string, data: Partial<StylePreset>) => void
  getStylePresetById: (id: string) => StylePreset | undefined
}

export const usePresetsStore = create<PresetsState>((set, get) => ({
  presets: loadPromptPresets(),
  addPreset: (p) => {
    const id = `preset_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`
    const preset: PromptPreset = { ...p, id, createdAt: Date.now() }
    set(state => {
      const next = [preset, ...state.presets]
      savePromptPresets(next)
      return { presets: next }
    })
    return id
  },
  removePreset: (id) => {
    set(state => {
      const next = state.presets.filter(p => p.id !== id)
      savePromptPresets(next)
      return { presets: next }
    })
  },
  updatePreset: (id, data) => {
    set(state => {
      const next = state.presets.map(p => p.id === id ? { ...p, ...data } : p)
      savePromptPresets(next)
      return { presets: next }
    })
  },

  stylePresets: loadStylePresets(),
  addStylePreset: (p) => {
    const id = `style_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`
    const preset: StylePreset = { ...p, id }
    set(state => {
      const next = [...state.stylePresets, preset]
      saveStylePresets(next)
      return { stylePresets: next }
    })
    return id
  },
  removeStylePreset: (id) => {
    set(state => {
      const target = state.stylePresets.find(p => p.id === id)
      if (target?.builtIn) return state
      const next = state.stylePresets.filter(p => p.id !== id)
      saveStylePresets(next)
      return { stylePresets: next }
    })
  },
  updateStylePreset: (id, data) => {
    set(state => {
      const next = state.stylePresets.map(p => {
        if (p.id !== id || p.builtIn) return p
        return { ...p, ...data }
      })
      saveStylePresets(next)
      return { stylePresets: next }
    })
  },
  getStylePresetById: (id) => get().stylePresets.find(p => p.id === id),
}))
