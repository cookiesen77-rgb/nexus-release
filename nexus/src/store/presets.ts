import { create } from 'zustand'

export interface PromptPreset {
  id: string
  category: 'character' | 'scene' | 'camera' | 'style' | 'custom'
  title: string
  content: string
  tags: string[]
  createdAt: number
}

const STORAGE_KEY = 'nexus-prompt-presets'

const loadPresets = (): PromptPreset[] => {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    return raw ? JSON.parse(raw) : []
  } catch { return [] }
}

const savePresets = (presets: PromptPreset[]) => {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(presets)) } catch {}
}

interface PresetsState {
  presets: PromptPreset[]
  addPreset: (p: Omit<PromptPreset, 'id' | 'createdAt'>) => string
  removePreset: (id: string) => void
  updatePreset: (id: string, data: Partial<PromptPreset>) => void
}

export const usePresetsStore = create<PresetsState>((set) => ({
  presets: loadPresets(),
  addPreset: (p) => {
    const id = `preset_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`
    const preset: PromptPreset = { ...p, id, createdAt: Date.now() }
    set(state => {
      const next = [preset, ...state.presets]
      savePresets(next)
      return { presets: next }
    })
    return id
  },
  removePreset: (id) => {
    set(state => {
      const next = state.presets.filter(p => p.id !== id)
      savePresets(next)
      return { presets: next }
    })
  },
  updatePreset: (id, data) => {
    set(state => {
      const next = state.presets.map(p => p.id === id ? { ...p, ...data } : p)
      savePresets(next)
      return { presets: next }
    })
  },
}))
