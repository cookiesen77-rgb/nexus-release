import { create } from 'zustand'
import type { ShortDramaDraftV2 } from '@/lib/shortDrama/types'
import { buildTimeline } from '@/lib/shortDrama/videoCompose'

export type TimelineTrackType = 'video' | 'dialogue' | 'narration' | 'sfx' | 'bgm' | 'subtitle'

export interface TimelineTrackSegment {
  id: string
  shotId: string
  trackType: TimelineTrackType
  startMs: number
  durationMs: number
  url?: string
  text?: string
  speaker?: string
  volume?: number
}

interface TimelineState {
  tracks: Record<TimelineTrackType, TimelineTrackSegment[]>
  playheadMs: number
  zoomLevel: number
  isPlaying: boolean
  selectionId: string | null
  totalDurationMs: number

  setPlayhead: (ms: number) => void
  setZoom: (level: number) => void
  setPlaying: (playing: boolean) => void
  selectSegment: (id: string | null) => void
  loadFromDraft: (draft: ShortDramaDraftV2, episodeId?: string) => void
  moveSegment: (id: string, newStartMs: number) => void
  resizeSegment: (id: string, newDurationMs: number) => void
  reset: () => void
}

const emptyTracks = (): Record<TimelineTrackType, TimelineTrackSegment[]> => ({
  video: [],
  dialogue: [],
  narration: [],
  sfx: [],
  bgm: [],
  subtitle: [],
})

let segId = 0
const nextSegId = () => `tseg_${++segId}`

export const useTimelineStore = create<TimelineState>((set, get) => ({
  tracks: emptyTracks(),
  playheadMs: 0,
  zoomLevel: 100,
  isPlaying: false,
  selectionId: null,
  totalDurationMs: 0,

  setPlayhead: (ms) => set({ playheadMs: Math.max(0, ms) }),
  setZoom: (level) => set({ zoomLevel: Math.max(20, Math.min(500, level)) }),
  setPlaying: (playing) => set({ isPlaying: playing }),
  selectSegment: (id) => set({ selectionId: id }),

  loadFromDraft: (draft, episodeId) => {
    const timeline = buildTimeline(draft, episodeId)
    const charMap = new Map(draft.characters.map((c) => [c.id, c.name]))
    const defaultDur = (draft.models.videoDuration || 5) * 1000

    const videoTrack: TimelineTrackSegment[] = []
    const dialogueTrack: TimelineTrackSegment[] = []
    const narrationTrack: TimelineTrackSegment[] = []
    const subtitleTrack: TimelineTrackSegment[] = []
    const bgmTrack: TimelineTrackSegment[] = []

    for (const seg of timeline.segments) {
      const shot = draft.shots.find((s) => s.id === seg.shotId)
      if (!shot) continue

      videoTrack.push({
        id: nextSegId(),
        shotId: seg.shotId,
        trackType: 'video',
        startMs: seg.startMs,
        durationMs: seg.durationMs,
        url: seg.videoUrl,
        text: shot.title,
      })

      if (shot.audio?.dialogue?.trim()) {
        const speaker = shot.audio.dialogueCharacterId ? charMap.get(shot.audio.dialogueCharacterId) : undefined
        dialogueTrack.push({
          id: nextSegId(),
          shotId: seg.shotId,
          trackType: 'dialogue',
          startMs: seg.startMs,
          durationMs: seg.durationMs,
          url: seg.dialogueUrl,
          text: shot.audio.dialogue,
          speaker,
        })
        subtitleTrack.push({
          id: nextSegId(),
          shotId: seg.shotId,
          trackType: 'subtitle',
          startMs: seg.startMs,
          durationMs: seg.durationMs,
          text: speaker ? `${speaker}：${shot.audio.dialogue}` : shot.audio.dialogue,
        })
      }

      if (shot.audio?.narration?.trim()) {
        narrationTrack.push({
          id: nextSegId(),
          shotId: seg.shotId,
          trackType: 'narration',
          startMs: seg.startMs,
          durationMs: seg.durationMs,
          url: seg.narrationUrl,
          text: shot.audio.narration,
        })
      }
    }

    const library = draft.bgmLibrary || []
    for (const a of draft.bgmAssignments || []) {
      if (a.episodeId && a.episodeId !== episodeId) continue
      const track = library.find((t) => t.id === a.trackId)
      if (!track || !a.shotRange) continue

      const [startIdx, endIdx] = a.shotRange
      let cursor = 0
      let segStart = 0
      let segEnd = 0
      const shots = episodeId ? draft.shots.filter((s) => s.episodeId === episodeId) : draft.shots
      for (let i = 0; i < shots.length; i++) {
        const shotDur = shots[i].video?.variants?.find((v) => v.status === 'success')?.durationMs || defaultDur
        if (i === startIdx) segStart = cursor
        if (i === endIdx) { segEnd = cursor + shotDur; break }
        cursor += shotDur
      }

      if (segEnd > segStart) {
        bgmTrack.push({
          id: nextSegId(),
          shotId: '',
          trackType: 'bgm',
          startMs: segStart,
          durationMs: segEnd - segStart,
          url: track.url,
          text: track.name,
          volume: a.volume,
        })
      }
    }

    set({
      tracks: {
        video: videoTrack,
        dialogue: dialogueTrack,
        narration: narrationTrack,
        sfx: [],
        bgm: bgmTrack,
        subtitle: subtitleTrack,
      },
      totalDurationMs: timeline.totalDurationMs,
      playheadMs: 0,
      isPlaying: false,
      selectionId: null,
    })
  },

  moveSegment: (id, newStartMs) => {
    const { tracks } = get()
    const updated = { ...tracks }
    for (const key of Object.keys(updated) as TimelineTrackType[]) {
      updated[key] = updated[key].map((s) => (s.id === id ? { ...s, startMs: Math.max(0, newStartMs) } : s))
    }
    set({ tracks: updated })
  },

  resizeSegment: (id, newDurationMs) => {
    const { tracks } = get()
    const updated = { ...tracks }
    for (const key of Object.keys(updated) as TimelineTrackType[]) {
      updated[key] = updated[key].map((s) => (s.id === id ? { ...s, durationMs: Math.max(100, newDurationMs) } : s))
    }
    set({ tracks: updated })
  },

  reset: () => set({ tracks: emptyTracks(), playheadMs: 0, isPlaying: false, selectionId: null, totalDurationMs: 0 }),
}))
