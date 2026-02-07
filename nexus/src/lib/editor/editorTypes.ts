export interface ShortDramaEditorClipV1 {
  id: string
  shotId: string
  videoVariantId: string
  label: string
  sourceUrl?: string
  displayUrl?: string
  mediaId?: string
  inSec: number
  outSec: number | null
  createdAt: number
}

export interface ShortDramaEditorProjectV1 {
  version: 1
  projectId: string
  createdAt: number
  updatedAt: number
  timeline: {
    clips: ShortDramaEditorClipV1[]
  }
  ui?: {
    selectedClipId?: string
  }
}

