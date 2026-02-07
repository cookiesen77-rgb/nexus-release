import type { ShortDramaEditorProjectV1 } from '@/lib/editor/editorTypes'

const STORAGE_PREFIX = 'shortDramaEditorProjectV1:'

export const getShortDramaEditorStorageKey = (projectId: string) => `${STORAGE_PREFIX}${String(projectId || 'default')}`

export const createDefaultShortDramaEditorProjectV1 = (projectId: string): ShortDramaEditorProjectV1 => {
  const now = Date.now()
  return {
    version: 1,
    projectId: String(projectId || 'default'),
    createdAt: now,
    updatedAt: now,
    timeline: { clips: [] },
    ui: {},
  }
}

export const loadShortDramaEditorProjectV1 = (projectId: string): ShortDramaEditorProjectV1 => {
  const key = getShortDramaEditorStorageKey(projectId)
  try {
    const raw = localStorage.getItem(key)
    if (!raw) return createDefaultShortDramaEditorProjectV1(projectId)
    const parsed: any = JSON.parse(raw)
    if (!parsed || Number(parsed.version) !== 1) return createDefaultShortDramaEditorProjectV1(projectId)
    if (!parsed.timeline || !Array.isArray(parsed.timeline.clips)) return createDefaultShortDramaEditorProjectV1(projectId)
    return parsed as ShortDramaEditorProjectV1
  } catch {
    return createDefaultShortDramaEditorProjectV1(projectId)
  }
}

export const saveShortDramaEditorProjectV1 = (projectId: string, project: ShortDramaEditorProjectV1) => {
  const key = getShortDramaEditorStorageKey(projectId)
  try {
    const now = Date.now()
    const toSave: ShortDramaEditorProjectV1 = {
      ...project,
      projectId: String(projectId || project.projectId || 'default'),
      updatedAt: now,
    }
    localStorage.setItem(key, JSON.stringify(toSave))
  } catch {
    // ignore
  }
}

