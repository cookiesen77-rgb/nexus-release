import { generateTTS } from '@/lib/ecommerce/tts'
import { klingCreateTask, klingPollTaskForMedia } from '@/lib/workflow/klingPlatform'
import { getAudioDurationMsFromUrl } from '@/lib/shortDrama/audioUtils'
import type {
  ShortDramaCharacter,
  ShortDramaMediaVariant,
  ShortDramaTTSProvider,
  ShortDramaVoiceConfig,
} from '@/lib/shortDrama/types'

const makeId = () => globalThis.crypto?.randomUUID?.() || `sda_${Date.now()}_${Math.random().toString(16).slice(2)}`

// ── Gemini TTS ──

async function geminiTTS(text: string, modelKey: string, voiceName: string): Promise<{ audioUrl: string }> {
  const { audioDataUrl } = await generateTTS({ text, model: modelKey || 'gemini-2.5-flash-preview-tts', voiceName: voiceName || 'Kore' })
  return { audioUrl: audioDataUrl }
}

// ── Kling text-to-audio (SFX) ──

const KLING_SFX_ENDPOINT = '/kling/v1/audio/text-to-audio'
const klingSfxStatusEndpoint = (id: string) => `/kling/v1/audio/text-to-audio/${id}`

async function klingTextToAudio(prompt: string, duration = 5): Promise<{ audioUrl: string }> {
  const payload = { prompt, duration: Math.max(3, Math.min(10, duration)) }
  const { taskId } = await klingCreateTask(KLING_SFX_ENDPOINT, payload)
  if (!taskId) throw new Error('Kling SFX: 未获取到 taskId')
  const result = await klingPollTaskForMedia(taskId, klingSfxStatusEndpoint, { maxAttempts: 120, intervalMs: 3000 })
  const audioUrl = result.urls.audio || result.urls.any || ''
  if (!audioUrl) throw new Error('Kling SFX: 未返回音频 URL')
  return { audioUrl }
}

// ── Vidu TTS (via NexusAPI-compatible endpoint) ──

async function viduTTS(text: string, voiceId: string, speed?: number): Promise<{ audioUrl: string }> {
  // Vidu TTS uses Gemini-compatible path through NexusAPI — same as Gemini but with Vidu voice IDs
  const { audioDataUrl } = await generateTTS({ text, model: 'gemini-2.5-flash-preview-tts', voiceName: voiceId })
  return { audioUrl: audioDataUrl }
}

// ── Public API ──

export interface GenerateShotDialogueParams {
  text: string
  character: ShortDramaCharacter
  voiceConfig?: ShortDramaVoiceConfig
  ttsModelKey?: string
}

export async function generateShotDialogue(params: GenerateShotDialogueParams): Promise<ShortDramaMediaVariant> {
  const { text, character, voiceConfig, ttsModelKey } = params
  if (!text?.trim()) throw new Error('台词为空')

  const vc = voiceConfig || character.voice
  const provider: ShortDramaTTSProvider = vc?.provider || 'gemini'

  const variant: ShortDramaMediaVariant = {
    id: makeId(),
    kind: 'audio',
    status: 'running',
    createdAt: Date.now(),
    createdBy: 'auto',
    modelKey: `${provider}:tts`,
    promptSnapshot: text.slice(0, 200),
  }

  let audioUrl: string
  if (provider === 'kling') {
    // Kling doesn't have TTS, fall back to Gemini for dialogue
    const r = await geminiTTS(text, ttsModelKey || '', vc?.voiceId || 'Kore')
    audioUrl = r.audioUrl
  } else if (provider === 'vidu') {
    const r = await viduTTS(text, vc?.voiceId || 'female-shaonv', vc?.speed)
    audioUrl = r.audioUrl
  } else {
    const r = await geminiTTS(text, ttsModelKey || '', vc?.voiceId || 'Kore')
    audioUrl = r.audioUrl
  }

  variant.status = 'success'
  variant.displayUrl = audioUrl
  variant.sourceUrl = audioUrl
  variant.durationMs = await getAudioDurationMsFromUrl(audioUrl).catch(() => 0) || undefined
  return variant
}

export interface GenerateShotNarrationParams {
  text: string
  narratorVoice?: ShortDramaVoiceConfig
  ttsModelKey?: string
}

export async function generateShotNarration(params: GenerateShotNarrationParams): Promise<ShortDramaMediaVariant> {
  const { text, narratorVoice, ttsModelKey } = params
  if (!text?.trim()) throw new Error('旁白为空')

  const voiceId = narratorVoice?.voiceId || 'Kore'
  const modelKey = ttsModelKey || ''

  const variant: ShortDramaMediaVariant = {
    id: makeId(),
    kind: 'audio',
    status: 'running',
    createdAt: Date.now(),
    createdBy: 'auto',
    modelKey: 'gemini:tts:narration',
    promptSnapshot: text.slice(0, 200),
  }

  const { audioUrl } = await geminiTTS(text, modelKey, voiceId)
  variant.status = 'success'
  variant.displayUrl = audioUrl
  variant.sourceUrl = audioUrl
  variant.durationMs = await getAudioDurationMsFromUrl(audioUrl).catch(() => 0) || undefined
  return variant
}

export interface GenerateShotSFXParams {
  prompt: string
  duration?: number
}

export async function generateShotSFX(params: GenerateShotSFXParams): Promise<ShortDramaMediaVariant> {
  const { prompt, duration } = params
  if (!prompt?.trim()) throw new Error('音效描述为空')

  const variant: ShortDramaMediaVariant = {
    id: makeId(),
    kind: 'audio',
    status: 'running',
    createdAt: Date.now(),
    createdBy: 'auto',
    modelKey: 'kling:text-to-audio',
    promptSnapshot: prompt.slice(0, 200),
  }

  const { audioUrl } = await klingTextToAudio(prompt, duration ?? 5)
  variant.status = 'success'
  variant.displayUrl = audioUrl
  variant.sourceUrl = audioUrl
  variant.durationMs = await getAudioDurationMsFromUrl(audioUrl).catch(() => 0) || undefined
  return variant
}
