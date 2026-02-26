import type {
  ShortDramaDraftV2,
  ShortDramaShotGroup,
  ShortDramaAssetRef,
  ShortDramaMediaSlot,
} from '@/lib/shortDrama/types'

const makeId = () => globalThis.crypto?.randomUUID?.() || `sg_${Date.now()}_${Math.random().toString(16).slice(2)}`

function emptyVideoSlot(label?: string): ShortDramaMediaSlot {
  return { id: makeId(), kind: 'video', label: label || '合并视频', variants: [] }
}

export const createShotGroup = (name: string, shotIds: string[]): ShortDramaShotGroup => ({
  id: makeId(),
  name,
  shotIds,
  mergedPrompt: '',
  imageRefs: [],
  videoRefs: [],
  audioRefs: [],
  video: emptyVideoSlot(),
})

export const addShotGroup = (draft: ShortDramaDraftV2, group: ShortDramaShotGroup): ShortDramaDraftV2 => ({
  ...draft,
  shotGroups: [...(draft.shotGroups || []), group],
  updatedAt: Date.now(),
})

export const updateShotGroup = (
  draft: ShortDramaDraftV2,
  groupId: string,
  patch: Partial<ShortDramaShotGroup>,
): ShortDramaDraftV2 => ({
  ...draft,
  shotGroups: (draft.shotGroups || []).map((g) => (g.id === groupId ? { ...g, ...patch } : g)),
  updatedAt: Date.now(),
})

export const removeShotGroup = (draft: ShortDramaDraftV2, groupId: string): ShortDramaDraftV2 => ({
  ...draft,
  shotGroups: (draft.shotGroups || []).filter((g) => g.id !== groupId),
  updatedAt: Date.now(),
})

export const mergeShotPrompts = (draft: ShortDramaDraftV2, shotIds: string[]): string => {
  const shots = shotIds.map((id) => draft.shots.find((s) => s.id === id)).filter(Boolean)
  return shots
    .map((s, i) => {
      const charNames = s!.characterIds
        .map((cid) => draft.characters.find((c) => c.id === cid)?.name)
        .filter(Boolean)
      const prompt = s!.calibratedVideoPrompt || s!.videoPrompt
      return `【镜头${i + 1}】${s!.title}\n${prompt}${charNames.length ? `\n角色: ${charNames.join(', ')}` : ''}`
    })
    .join('\n\n')
}

export const validateSeedanceAssets = (group: ShortDramaShotGroup): string[] => {
  const errors: string[] = []
  if (group.imageRefs.length > 9) errors.push(`图片引用超限: ${group.imageRefs.length}/9`)
  if (group.videoRefs.length > 3) errors.push(`视频引用超限: ${group.videoRefs.length}/3`)
  if (group.audioRefs.length > 3) errors.push(`音频引用超限: ${group.audioRefs.length}/3`)
  const totalFiles = group.imageRefs.length + group.videoRefs.length + group.audioRefs.length
  if (totalFiles > 12) errors.push(`总引用文件超限: ${totalFiles}/12`)
  const promptLen = (group.calibratedPrompt || group.mergedPrompt).length
  if (promptLen > 5000) errors.push(`提示词超长: ${promptLen}/5000`)
  for (const vr of group.videoRefs) {
    if (vr.duration && vr.duration > 15) errors.push(`视频 ${vr.tag} 超时长: ${vr.duration}s/15s`)
  }
  for (const ar of group.audioRefs) {
    if (ar.duration && ar.duration > 15) errors.push(`音频 ${ar.tag} 超时长: ${ar.duration}s/15s`)
  }
  return errors
}

export const addAssetRef = (
  draft: ShortDramaDraftV2,
  groupId: string,
  ref: ShortDramaAssetRef,
  refKind: 'imageRefs' | 'videoRefs' | 'audioRefs',
): ShortDramaDraftV2 => {
  const group = (draft.shotGroups || []).find((g) => g.id === groupId)
  if (!group) return draft
  return updateShotGroup(draft, groupId, {
    [refKind]: [...group[refKind], ref],
  })
}

export const removeAssetRef = (
  draft: ShortDramaDraftV2,
  groupId: string,
  refId: string,
  refKind: 'imageRefs' | 'videoRefs' | 'audioRefs',
): ShortDramaDraftV2 => {
  const group = (draft.shotGroups || []).find((g) => g.id === groupId)
  if (!group) return draft
  return updateShotGroup(draft, groupId, {
    [refKind]: group[refKind].filter((r) => r.id !== refId),
  })
}

export const autoTagAssetRefs = (group: ShortDramaShotGroup): ShortDramaShotGroup => {
  const retagged = { ...group }
  retagged.imageRefs = group.imageRefs.map((r, i) => ({ ...r, tag: `@Image${i + 1}` }))
  retagged.videoRefs = group.videoRefs.map((r, i) => ({ ...r, tag: `@Video${i + 1}` }))
  retagged.audioRefs = group.audioRefs.map((r, i) => ({ ...r, tag: `@Audio${i + 1}` }))
  return retagged
}
