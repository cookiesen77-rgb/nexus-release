import type { ShortDramaMediaVariant } from '@/lib/shortDrama/types'
import { saveMedia } from '@/lib/mediaStorage'

const makeId = () => globalThis.crypto?.randomUUID?.() || `aud_${Date.now()}_${Math.random().toString(16).slice(2)}`

export function getAudioDurationMs(file: File | Blob): Promise<number> {
  return new Promise((resolve) => {
    const audio = new Audio()
    const objectUrl = URL.createObjectURL(file)
    audio.src = objectUrl

    const cleanup = () => {
      URL.revokeObjectURL(objectUrl)
      audio.removeEventListener('loadedmetadata', onLoaded)
      audio.removeEventListener('error', onError)
    }

    const onLoaded = () => {
      const ms = Math.round((audio.duration || 0) * 1000)
      cleanup()
      resolve(ms)
    }

    const onError = () => {
      cleanup()
      resolve(0)
    }

    audio.addEventListener('loadedmetadata', onLoaded, { once: true })
    audio.addEventListener('error', onError, { once: true })

    setTimeout(() => {
      if (audio.readyState === 0) {
        cleanup()
        resolve(0)
      }
    }, 5000)
  })
}

export function getAudioDurationMsFromUrl(url: string): Promise<number> {
  return new Promise((resolve) => {
    const audio = new Audio()
    audio.src = url

    const cleanup = () => {
      audio.removeEventListener('loadedmetadata', onLoaded)
      audio.removeEventListener('error', onError)
    }

    const onLoaded = () => {
      const ms = Math.round((audio.duration || 0) * 1000)
      cleanup()
      resolve(ms)
    }

    const onError = () => {
      cleanup()
      resolve(0)
    }

    audio.addEventListener('loadedmetadata', onLoaded, { once: true })
    audio.addEventListener('error', onError, { once: true })

    setTimeout(() => {
      if (audio.readyState === 0) {
        cleanup()
        resolve(0)
      }
    }, 5000)
  })
}

export async function createAudioVariantFromFile(
  file: File,
  slotKind: 'dialogue' | 'narration',
  projectId: string
): Promise<{ variant: ShortDramaMediaVariant; durationMs: number }> {
  const durationMs = await getAudioDurationMs(file)

  const reader = new FileReader()
  const dataUrl = await new Promise<string>((resolve, reject) => {
    reader.onload = () => resolve(reader.result as string)
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(file)
  })

  const mediaId = await saveMedia({
    projectId,
    nodeId: `audio_upload_${Date.now()}`,
    type: 'audio',
    data: dataUrl,
    sourceUrl: `local:${file.name}`,
  })

  const variant: ShortDramaMediaVariant = {
    id: makeId(),
    kind: 'audio',
    status: 'success',
    createdAt: Date.now(),
    createdBy: 'manual',
    modelKey: `upload:${slotKind}`,
    promptSnapshot: file.name,
    mediaId,
    displayUrl: dataUrl,
    durationMs,
  }

  return { variant, durationMs }
}

export function formatDuration(ms: number): string {
  if (ms <= 0) return '0:00'
  const totalSec = ms / 1000
  const min = Math.floor(totalSec / 60)
  const sec = totalSec % 60
  return `${min}:${sec.toFixed(1).padStart(4, '0')}`
}
