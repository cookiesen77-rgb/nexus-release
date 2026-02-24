import type { ShortDramaDraftV2, ShortDramaMediaSlot, ShortDramaMediaVariant, ShortDramaCreatedBy, ShortDramaEpisode } from '@/lib/shortDrama/types'

const patchSlot = (slot: ShortDramaMediaSlot, slotId: string, updater: (s: ShortDramaMediaSlot) => ShortDramaMediaSlot): ShortDramaMediaSlot => {
  if (!slot || slot.id !== slotId) return slot
  return updater(slot)
}

export const updateSlotById = (
  draft: ShortDramaDraftV2,
  slotId: string,
  updater: (slot: ShortDramaMediaSlot) => ShortDramaMediaSlot
): ShortDramaDraftV2 => {
  let changed = false
  const upd = (slot: ShortDramaMediaSlot) => {
    if (slot?.id !== slotId) return slot
    changed = true
    return updater(slot)
  }

  const next: ShortDramaDraftV2 = {
    ...draft,
    characters: draft.characters.map((c) => ({
      ...c,
      sheet: upd(c.sheet),
      refs: c.refs.map(upd),
    })),
    scenes: draft.scenes.map((s) => ({
      ...s,
      ref: upd(s.ref),
      refs: Array.isArray(s.refs) ? s.refs.map(upd) : s.refs,
    })),
    assets: (draft.assets || []).map((a) => ({
      ...a,
      ref: upd(a.ref),
      refs: Array.isArray(a.refs) ? a.refs.map(upd) : a.refs,
    })),
    shots: draft.shots.map((sh) => ({
      ...sh,
      frames: {
        start: { ...sh.frames.start, slot: upd(sh.frames.start.slot) },
        end: { ...sh.frames.end, slot: upd(sh.frames.end.slot) },
      },
      video: upd(sh.video),
    })),
    updatedAt: Date.now(),
  }
  return changed ? next : draft
}

export const setSlotSelectionLocked = (draft: ShortDramaDraftV2, slotId: string, locked: boolean) =>
  updateSlotById(draft, slotId, (s) => ({ ...s, selectionLockedByUser: locked }))

export const setSlotSelectedVariant = (draft: ShortDramaDraftV2, slotId: string, variantId: string | undefined) =>
  updateSlotById(draft, slotId, (s) => ({ ...s, selectedVariantId: variantId, selectionLockedByUser: true }))

export const clearSlotSelectedVariant = (draft: ShortDramaDraftV2, slotId: string) =>
  updateSlotById(draft, slotId, (s) => ({ ...s, selectedVariantId: undefined, selectionLockedByUser: true }))

const shouldAutoSelect = (slot: ShortDramaMediaSlot, createdBy: ShortDramaCreatedBy) => {
  if (slot.selectionLockedByUser) return false
  // Manual action should usually adopt the newest result by default.
  if (createdBy === 'manual') return true

  // Auto mode: do not auto-adopt keyframes or videos. User should decide.
  if (slot.kind === 'video') return false
  const label = String(slot.label || '')
  if (/首帧|尾帧/.test(label)) return false
  return true
}

export const appendVariantToSlot = (
  draft: ShortDramaDraftV2,
  slotId: string,
  variant: ShortDramaMediaVariant
): ShortDramaDraftV2 => {
  return updateSlotById(draft, slotId, (slot) => {
    const variants = [...(slot.variants || []), variant]
    const selectedVariantId = shouldAutoSelect(slot, variant.createdBy) ? variant.id : slot.selectedVariantId
    return { ...slot, variants, selectedVariantId }
  })
}

export const updateVariantInSlot = (
  draft: ShortDramaDraftV2,
  slotId: string,
  variantId: string,
  patch: Partial<ShortDramaMediaVariant>
): ShortDramaDraftV2 => {
  return updateSlotById(draft, slotId, (slot) => {
    const variants = (slot.variants || []).map((v) => (v.id === variantId ? ({ ...v, ...patch } as ShortDramaMediaVariant) : v))
    return { ...slot, variants }
  })
}

export const removeVariantFromSlot = (draft: ShortDramaDraftV2, slotId: string, variantId: string): ShortDramaDraftV2 => {
  return updateSlotById(draft, slotId, (slot) => {
    const variants = (slot.variants || []).filter((v) => v.id !== variantId)
    const selectedVariantId = slot.selectedVariantId === variantId ? variants[variants.length - 1]?.id : slot.selectedVariantId
    return { ...slot, variants, selectedVariantId }
  })
}

// ---- Episode CRUD ----

export const addEpisode = (draft: ShortDramaDraftV2, episode: ShortDramaEpisode): ShortDramaDraftV2 => ({
  ...draft,
  episodes: [...(draft.episodes || []), episode],
  updatedAt: Date.now(),
})

export const updateEpisode = (
  draft: ShortDramaDraftV2,
  episodeId: string,
  patch: Partial<ShortDramaEpisode>,
): ShortDramaDraftV2 => ({
  ...draft,
  episodes: (draft.episodes || []).map((ep) =>
    ep.id === episodeId ? { ...ep, ...patch, updatedAt: Date.now() } : ep,
  ),
  updatedAt: Date.now(),
})

export const removeEpisode = (draft: ShortDramaDraftV2, episodeId: string): ShortDramaDraftV2 => ({
  ...draft,
  episodes: (draft.episodes || []).filter((ep) => ep.id !== episodeId),
  shots: draft.shots.map((s) => (s.episodeId === episodeId ? { ...s, episodeId: undefined } : s)),
  updatedAt: Date.now(),
})

export const reorderEpisodes = (draft: ShortDramaDraftV2, orderedIds: string[]): ShortDramaDraftV2 => ({
  ...draft,
  episodes: orderedIds
    .map((id, i) => {
      const ep = (draft.episodes || []).find((e) => e.id === id)
      return ep ? { ...ep, order: i } : null
    })
    .filter(Boolean) as ShortDramaEpisode[],
  updatedAt: Date.now(),
})
