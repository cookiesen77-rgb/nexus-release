import type { ShortDramaDraftV2, ShortDramaMediaSlot, ShortDramaMediaVariant, ShortDramaCreatedBy } from '@/lib/shortDrama/types'

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

const shouldAutoSelect = (slot: ShortDramaMediaSlot, createdBy: ShortDramaCreatedBy) => {
  if (slot.selectionLockedByUser) return false
  // Manual action should usually adopt the newest result by default.
  if (createdBy === 'manual') return true
  // Auto mode: only select if not locked.
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

