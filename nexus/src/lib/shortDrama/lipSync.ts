import type { ShortDramaShot, ShortDramaDraftV2 } from '@/lib/shortDrama/types'

const LIPSYNC_CAPABLE_FORMATS = new Set(['volc-seedance-video'])
const MAX_AUDIO_DURATION_SEC = 15

export function isLipSyncCapable(modelFormat: string): boolean {
  return LIPSYNC_CAPABLE_FORMATS.has(modelFormat)
}

export function getShotDialogueUrl(shot: ShortDramaShot): string | null {
  const slot = shot.dialogueSlot
  if (!slot) return null
  const variant = slot.selectedVariantId
    ? slot.variants.find((v) => v.id === slot.selectedVariantId)
    : slot.variants.find((v) => v.status === 'success')
  if (!variant) return null
  return variant.displayUrl || variant.sourceUrl || null
}

export function getShotDialogueDuration(shot: ShortDramaShot): number | null {
  const slot = shot.dialogueSlot
  if (!slot) return null
  const variant = slot.selectedVariantId
    ? slot.variants.find((v) => v.id === slot.selectedVariantId)
    : slot.variants.find((v) => v.status === 'success')
  return variant?.durationMs ?? null
}

export function validateLipSyncAudio(durationMs: number): string | null {
  if (durationMs > MAX_AUDIO_DURATION_SEC * 1000) {
    return `音频时长 ${(durationMs / 1000).toFixed(1)}s 超过 ${MAX_AUDIO_DURATION_SEC}s 限制`
  }
  return null
}

export function buildLipSyncPrompt(shot: ShortDramaShot, draft: ShortDramaDraftV2): string {
  const basePrompt = shot.calibratedVideoPrompt || shot.videoPrompt
  const dialogueChar = shot.audio?.dialogueCharacterId
    ? draft.characters.find((c) => c.id === shot.audio!.dialogueCharacterId)
    : null

  const lipSyncDirective = dialogueChar
    ? `${dialogueChar.name} is speaking with natural lip movements matching the audio dialogue`
    : 'the character is speaking with natural lip movements matching the audio'

  return `${basePrompt}\n\n[Lip-sync]: ${lipSyncDirective}, mouth movements synchronized with speech rhythm, natural jaw motion`
}

export function shouldEnableLipSync(shot: ShortDramaShot, modelFormat: string): boolean {
  if (!isLipSyncCapable(modelFormat)) return false
  if (shot.enableLipSync === false) return false
  const url = getShotDialogueUrl(shot)
  if (!url) return false
  const dur = getShotDialogueDuration(shot)
  if (dur && dur > MAX_AUDIO_DURATION_SEC * 1000) return false
  return true
}
