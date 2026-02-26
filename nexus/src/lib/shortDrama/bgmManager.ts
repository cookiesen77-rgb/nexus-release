import type {
  ShortDramaDraftV2,
  ShortDramaBGMTrack,
  ShortDramaBGMAssignment,
  ShortDramaBGMGenre,
} from '@/lib/shortDrama/types'
import { getAudioDurationMs } from '@/lib/shortDrama/audioUtils'
import { saveMedia } from '@/lib/mediaStorage'

const makeId = () => globalThis.crypto?.randomUUID?.() || `bgm_${Date.now()}_${Math.random().toString(16).slice(2)}`

// ── Import from local file ──

export async function importBGM(file: File, projectId: string): Promise<ShortDramaBGMTrack> {
  const durationMs = await getAudioDurationMs(file)
  const arrayBuf = await file.arrayBuffer()
  const blob = new Blob([arrayBuf], { type: file.type || 'audio/mpeg' })
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as string)
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(blob)
  })

  const mediaId = await saveMedia({
    projectId,
    nodeId: `bgm_${Date.now()}`,
    type: 'audio',
    data: dataUrl,
    sourceUrl: `local:${file.name}`,
  })

  return {
    id: makeId(),
    name: file.name.replace(/\.[^.]+$/, ''),
    url: dataUrl,
    mediaId,
    durationMs,
    source: 'upload',
  }
}

// ── Draft operations ──

export function addBGMToDraft(draft: ShortDramaDraftV2, track: ShortDramaBGMTrack): ShortDramaDraftV2 {
  return {
    ...draft,
    bgmLibrary: [...(draft.bgmLibrary || []), track],
    updatedAt: Date.now(),
  }
}

export function removeBGMFromDraft(draft: ShortDramaDraftV2, trackId: string): ShortDramaDraftV2 {
  return {
    ...draft,
    bgmLibrary: (draft.bgmLibrary || []).filter((t) => t.id !== trackId),
    bgmAssignments: (draft.bgmAssignments || []).filter((a) => a.trackId !== trackId),
    updatedAt: Date.now(),
  }
}

export function assignBGMToRange(draft: ShortDramaDraftV2, assignment: ShortDramaBGMAssignment): ShortDramaDraftV2 {
  return {
    ...draft,
    bgmAssignments: [...(draft.bgmAssignments || []), assignment],
    updatedAt: Date.now(),
  }
}

export function removeBGMAssignment(draft: ShortDramaDraftV2, assignmentId: string): ShortDramaDraftV2 {
  return {
    ...draft,
    bgmAssignments: (draft.bgmAssignments || []).filter((a) => a.id !== assignmentId),
    updatedAt: Date.now(),
  }
}

export function updateBGMAssignment(
  draft: ShortDramaDraftV2,
  assignmentId: string,
  patch: Partial<ShortDramaBGMAssignment>,
): ShortDramaDraftV2 {
  return {
    ...draft,
    bgmAssignments: (draft.bgmAssignments || []).map((a) => (a.id === assignmentId ? { ...a, ...patch } : a)),
    updatedAt: Date.now(),
  }
}

// ── Auto-match BGM to shots based on bgmHint ──

const HINT_GENRE_MAP: Record<string, ShortDramaBGMGenre> = {
  '紧张': 'suspense', '悬疑': 'suspense', '恐怖': 'suspense',
  '动作': 'action', '打斗': 'action', '追逐': 'action', '激烈': 'action',
  '浪漫': 'romance', '温馨': 'romance', '甜蜜': 'romance', '爱情': 'romance',
  '搞笑': 'comedy', '喜剧': 'comedy', '欢快': 'comedy', '幽默': 'comedy',
  '史诗': 'epic', '壮阔': 'epic', '宏大': 'epic', '战争': 'epic',
  '平静': 'calm', '安静': 'calm', '舒缓': 'calm', '宁静': 'calm',
  '神秘': 'mysterious', '诡异': 'mysterious', '奇幻': 'mysterious',
}

function matchGenreFromHint(hint: string): ShortDramaBGMGenre | undefined {
  const h = hint.toLowerCase()
  for (const [keyword, genre] of Object.entries(HINT_GENRE_MAP)) {
    if (h.includes(keyword)) return genre
  }
  return undefined
}

export function matchBGMToShots(draft: ShortDramaDraftV2): ShortDramaBGMAssignment[] {
  const library = draft.bgmLibrary || []
  if (library.length === 0) return []

  const assignments: ShortDramaBGMAssignment[] = []
  const shots = draft.shots

  let rangeStart = -1
  let currentGenre: ShortDramaBGMGenre | undefined

  for (let i = 0; i <= shots.length; i++) {
    const hint = shots[i]?.audio?.bgmHint
    const genre = hint ? matchGenreFromHint(hint) : undefined

    if (genre !== currentGenre || i === shots.length) {
      if (currentGenre && rangeStart >= 0) {
        const track = library.find((t) => t.genre === currentGenre) || library[0]
        assignments.push({
          id: makeId(),
          trackId: track.id,
          shotRange: [rangeStart, i - 1],
          volume: 0.5,
          fadeInMs: 1000,
          fadeOutMs: 1000,
        })
      }
      rangeStart = i
      currentGenre = genre
    }
  }

  return assignments
}

// ── Build BGM timeline for composition ──

export interface BGMTimelineEntry {
  trackId: string
  url: string
  startMs: number
  durationMs: number
  volume: number
  fadeInMs: number
  fadeOutMs: number
}

export function buildBGMTimeline(
  draft: ShortDramaDraftV2,
  episodeId?: string,
): BGMTimelineEntry[] {
  const assignments = draft.bgmAssignments || []
  const library = draft.bgmLibrary || []
  const shots = episodeId ? draft.shots.filter((s) => s.episodeId === episodeId) : draft.shots
  const defaultDuration = (draft.models.videoDuration || 5) * 1000

  const entries: BGMTimelineEntry[] = []

  for (const a of assignments) {
    if (a.episodeId && a.episodeId !== episodeId) continue
    const track = library.find((t) => t.id === a.trackId)
    if (!track) continue

    let startMs = 0
    let endMs = 0

    if (a.shotRange) {
      const [startIdx, endIdx] = a.shotRange
      let cursor = 0
      for (let i = 0; i < shots.length; i++) {
        const shotDur = shots[i].video?.variants?.find((v) => v.status === 'success')?.durationMs || defaultDuration
        if (i === startIdx) startMs = cursor
        if (i === endIdx) { endMs = cursor + shotDur; break }
        cursor += shotDur
      }
    }

    if (endMs > startMs) {
      entries.push({
        trackId: a.trackId,
        url: track.url,
        startMs,
        durationMs: endMs - startMs,
        volume: a.volume,
        fadeInMs: a.fadeInMs || 0,
        fadeOutMs: a.fadeOutMs || 0,
      })
    }
  }

  return entries
}
