import type {
  ShortDramaDraftV2,
  ShortDramaShot,
  ShortDramaTimeline,
  ShortDramaTimelineSegment,
} from '@/lib/shortDrama/types'

// ── SRT 时间格式化（参考 FastMovieAI ClipExporter.ts） ──

function formatSrtTime(ms: number): string {
  const totalMs = Math.max(0, Math.floor(ms))
  const hours = Math.floor(totalMs / 3600000)
  const minutes = Math.floor((totalMs % 3600000) / 60000)
  const seconds = Math.floor((totalMs % 60000) / 1000)
  const milliseconds = totalMs % 1000
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')},${String(milliseconds).padStart(3, '0')}`
}

// ── 获取 media slot 中选中 variant 的 URL ──

function getSelectedVariant(shot: ShortDramaShot, slotKey: 'video' | 'dialogueSlot' | 'narrationSlot') {
  const slot = shot[slotKey]
  if (!slot) return undefined
  const vid = slot.selectedVariantId
  return vid ? slot.variants.find((v) => v.id === vid) : slot.variants.find((v) => v.status === 'success')
}

function getSlotUrl(shot: ShortDramaShot, slotKey: 'video' | 'dialogueSlot' | 'narrationSlot'): string | undefined {
  const variant = getSelectedVariant(shot, slotKey)
  return variant?.displayUrl || variant?.sourceUrl
}

// ── 构建 Timeline ──

export function buildTimeline(draft: ShortDramaDraftV2, episodeId?: string): ShortDramaTimeline {
  const shots = episodeId ? draft.shots.filter((s) => s.episodeId === episodeId) : draft.shots
  const defaultDurationMs = (draft.models.videoDuration || 5) * 1000

  let cursor = 0
  const segments: ShortDramaTimelineSegment[] = []

  for (const shot of shots) {
    const videoVariant = getSelectedVariant(shot, 'video')
    const durationMs = videoVariant?.durationMs || defaultDurationMs
    const seg: ShortDramaTimelineSegment = {
      shotId: shot.id,
      startMs: cursor,
      durationMs,
      videoUrl: getSlotUrl(shot, 'video'),
      dialogueUrl: getSlotUrl(shot, 'dialogueSlot'),
      narrationUrl: getSlotUrl(shot, 'narrationSlot'),
    }
    segments.push(seg)
    cursor += durationMs
  }

  return { episodeId, segments, totalDurationMs: cursor }
}

// ── 导出 SRT 字幕 ──

export function exportSubtitleSRT(draft: ShortDramaDraftV2, episodeId?: string): string {
  const shots = episodeId ? draft.shots.filter((s) => s.episodeId === episodeId) : draft.shots
  const defaultDurationMs = (draft.models.videoDuration || 5) * 1000
  const charMap = new Map(draft.characters.map((c) => [c.id, c.name]))

  const lines: string[] = []
  let index = 1
  let cursor = 0

  for (const shot of shots) {
    const videoVariant = getSelectedVariant(shot, 'video')
    const shotDuration = videoVariant?.durationMs || defaultDurationMs
    const dialogue = shot.audio?.dialogue?.trim()
    if (dialogue) {
      const speaker = shot.audio?.dialogueCharacterId ? charMap.get(shot.audio.dialogueCharacterId) : undefined
      const text = speaker ? `${speaker}：${dialogue}` : dialogue
      const start = cursor
      const end = cursor + shotDuration
      lines.push(`${index}\n${formatSrtTime(start)} --> ${formatSrtTime(end)}\n${text}\n`)
      index++
    }
    cursor += shotDuration
  }

  return lines.join('\n')
}

// ── 导出 Timeline JSON（剪映/CapCut 兼容结构）──

export interface TimelineJSONExport {
  version: '1.0'
  title: string
  totalDurationMs: number
  tracks: {
    video: { shotId: string; title: string; startMs: number; durationMs: number; url?: string }[]
    dialogue: { shotId: string; startMs: number; durationMs: number; text: string; speaker?: string; audioUrl?: string }[]
    narration: { shotId: string; startMs: number; durationMs: number; text: string; audioUrl?: string }[]
  }
}

export function exportTimelineJSON(draft: ShortDramaDraftV2, episodeId?: string): TimelineJSONExport {
  const shots = episodeId ? draft.shots.filter((s) => s.episodeId === episodeId) : draft.shots
  const defaultDurationMs = (draft.models.videoDuration || 5) * 1000
  const charMap = new Map(draft.characters.map((c) => [c.id, c.name]))

  const videoTrack: TimelineJSONExport['tracks']['video'] = []
  const dialogueTrack: TimelineJSONExport['tracks']['dialogue'] = []
  const narrationTrack: TimelineJSONExport['tracks']['narration'] = []

  let cursor = 0
  for (const shot of shots) {
    const videoVariant = getSelectedVariant(shot, 'video')
    const shotDuration = videoVariant?.durationMs || defaultDurationMs
    videoTrack.push({
      shotId: shot.id,
      title: shot.title,
      startMs: cursor,
      durationMs: shotDuration,
      url: getSlotUrl(shot, 'video'),
    })

    if (shot.audio?.dialogue?.trim()) {
      dialogueTrack.push({
        shotId: shot.id,
        startMs: cursor,
        durationMs: shotDuration,
        text: shot.audio.dialogue,
        speaker: shot.audio.dialogueCharacterId ? charMap.get(shot.audio.dialogueCharacterId) : undefined,
        audioUrl: getSlotUrl(shot, 'dialogueSlot'),
      })
    }

    if (shot.audio?.narration?.trim()) {
      narrationTrack.push({
        shotId: shot.id,
        startMs: cursor,
        durationMs: shotDuration,
        text: shot.audio.narration,
        audioUrl: getSlotUrl(shot, 'narrationSlot'),
      })
    }

    cursor += shotDuration
  }

  return {
    version: '1.0',
    title: draft.title || '未命名',
    totalDurationMs: cursor,
    tracks: { video: videoTrack, dialogue: dialogueTrack, narration: narrationTrack },
  }
}

// ── 触发浏览器下载 ──

export function downloadAsFile(content: string, filename: string, mimeType = 'text/plain') {
  const blob = new Blob([content], { type: `${mimeType};charset=utf-8` })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}
