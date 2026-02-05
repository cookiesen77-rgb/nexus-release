import { create } from 'zustand'
import { deleteMediaByProjectId } from '@/lib/mediaStorage'

export type ProjectMeta = {
  id: string
  name: string
  description?: string
  thumbnail?: string
  createdAt: number
  updatedAt: number
}

const STORAGE_KEY = 'ai-canvas-projects-meta'
const CANVAS_STORAGE_PREFIX = 'nexus-canvas-v1:'

const makeId = () => `project_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`

const readProjects = (): ProjectMeta[] => {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed
      .map((p: any) => ({
        id: String(p?.id || ''),
        name: String(p?.name || '未命名项目'),
        description: typeof p?.description === 'string' ? p.description : undefined,
        thumbnail: typeof p?.thumbnail === 'string' ? p.thumbnail : undefined,
        createdAt: Number(p?.createdAt || 0),
        updatedAt: Number(p?.updatedAt || p?.createdAt || 0)
      }))
      .filter((p) => p.id)
      .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))
  } catch {
    return []
  }
}

const writeProjects = (projects: ProjectMeta[]) => {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(projects))
  } catch {
    // ignore
  }
}

const tryTauriInvoke = async <T,>(command: string, payload?: Record<string, unknown>) => {
  try {
    const { isTauri, invoke } = await import('@tauri-apps/api/core')
    if (!isTauri()) return { ok: false as const }
    const res = await invoke<T>(command, payload)
    return { ok: true as const, res }
  } catch (err) {
    return { ok: false as const, err }
  }
}

const readCanvasLocal = (projectId: string) => {
  try {
    const raw = localStorage.getItem(`${CANVAS_STORAGE_PREFIX}${projectId}`)
    if (!raw) return null
    return JSON.parse(raw)
  } catch {
    return null
  }
}

const writeCanvasLocal = (projectId: string, canvas: any) => {
  try {
    localStorage.setItem(`${CANVAS_STORAGE_PREFIX}${projectId}`, JSON.stringify(canvas))
  } catch {
    // ignore
  }
}

const deleteCanvasLocal = (projectId: string) => {
  try {
    localStorage.removeItem(`${CANVAS_STORAGE_PREFIX}${projectId}`)
  } catch {
    // ignore
  }
}

export type ProjectsState = {
  projects: ProjectMeta[]
  hydrate: () => void
  create: (name?: string) => string
  rename: (id: string, name: string) => void
  updateDescription: (id: string, description: string) => void
  setThumbnail: (id: string, thumbnail: string) => void
  duplicate: (id: string) => Promise<string | null>
  remove: (id: string) => Promise<void>
  touch: (id: string) => void
}

export const useProjectsStore = create<ProjectsState>((set, get) => ({
  projects: readProjects(),

  hydrate: () => set({ projects: readProjects() }),

  create: (name) => {
    const id = makeId()
    const now = Date.now()
    const next: ProjectMeta = { id, name: String(name || '').trim() || '新项目', createdAt: now, updatedAt: now }
    const projects = [next, ...get().projects]
    writeProjects(projects)
    set({ projects })
    return id
  },

  rename: (id, name) => {
    const nextName = String(name || '').trim()
    if (!nextName) return
    const projects = get().projects.map((p) => (p.id === id ? { ...p, name: nextName, updatedAt: Date.now() } : p))
    writeProjects(projects)
    set({ projects })
  },

  updateDescription: (id, description) => {
    const projects = get().projects.map((p) => (p.id === id ? { ...p, description: description.trim() || undefined, updatedAt: Date.now() } : p))
    writeProjects(projects)
    set({ projects })
  },

  setThumbnail: (id, thumbnail) => {
    const projects = get().projects.map((p) => (p.id === id ? { ...p, thumbnail: thumbnail || undefined, updatedAt: Date.now() } : p))
    writeProjects(projects)
    set({ projects })
  },

  duplicate: async (id) => {
    const src = get().projects.find((p) => p.id === id)
    if (!src) return null
    const nextId = makeId()
    const now = Date.now()
    const nextMeta: ProjectMeta = {
      id: nextId,
      name: `${src.name} 副本`,
      thumbnail: src.thumbnail,
      createdAt: now,
      updatedAt: now
    }

    const tauri = await tryTauriInvoke<any>('load_project_canvas', { projectId: id })
    const canvas = tauri.ok ? tauri.res : readCanvasLocal(id)
    if (canvas) {
      const saved = await tryTauriInvoke('save_project_canvas', { projectId: nextId, canvas })
      if (!saved.ok) writeCanvasLocal(nextId, canvas)
    }

    const projects = [nextMeta, ...get().projects]
    writeProjects(projects)
    set({ projects })
    return nextId
  },

  remove: async (id) => {
    const projects = get().projects.filter((p) => p.id !== id)
    writeProjects(projects)
    set({ projects })

    const tauri = await tryTauriInvoke('delete_project_canvas', { projectId: id })
    if (!tauri.ok) deleteCanvasLocal(id)

    // 清理该项目关联的 IndexedDB 媒体，避免长期堆积
    try {
      await deleteMediaByProjectId(id)
    } catch {
      // ignore
    }
  },

  touch: (id) => {
    const projects = get().projects.map((p) => (p.id === id ? { ...p, updatedAt: Date.now() } : p))
    writeProjects(projects)
    set({ projects })
  }
}))

