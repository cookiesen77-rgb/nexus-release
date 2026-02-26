import React, { useState, useRef, useMemo, useCallback, useEffect } from 'react'
import { Play, Pause, SkipBack, ZoomIn, ZoomOut, Maximize2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import { buildTimeline } from '@/lib/shortDrama/videoCompose'
import type { ShortDramaDraftV2, ShortDramaTimelineSegment } from '@/lib/shortDrama/types'

interface Props {
  draft: ShortDramaDraftV2
  setDraft: React.Dispatch<React.SetStateAction<ShortDramaDraftV2>>
  currentEpisodeId?: string | null
}

const TRACK_H = 48
const LABEL_W = 44

function formatTime(ms: number): string {
  const totalSec = Math.floor(ms / 1000)
  const m = Math.floor(totalSec / 60)
  const s = totalSec % 60
  const frac = Math.floor((ms % 1000) / 10)
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(frac).padStart(2, '0')}`
}

function getStartFrameUrl(shot: ShortDramaDraftV2['shots'][number]): string | undefined {
  const slot = shot.frames?.start?.slot
  if (!slot?.variants?.length) return undefined
  const v = slot.selectedVariantId
    ? slot.variants.find(x => x.id === slot.selectedVariantId)
    : slot.variants.find(x => x.status === 'success')
  return v?.displayUrl || v?.sourceUrl
}

const TRACKS = [
  { key: 'V', label: '视频', color: '#6366f1', dotClass: 'bg-indigo-500' },
  { key: 'D', label: '对话', color: '#f59e0b', dotClass: 'bg-amber-500' },
  { key: 'N', label: '旁白', color: '#a855f7', dotClass: 'bg-purple-500' },
  { key: 'B', label: 'BGM', color: '#10b981', dotClass: 'bg-emerald-500' },
  { key: 'S', label: '字幕', color: '#ec4899', dotClass: 'bg-pink-500' },
] as const

export default function ShortDramaTimeline({ draft, currentEpisodeId }: Props) {
  const [zoomLevel, setZoomLevel] = useState(100)
  const [playheadMs, setPlayheadMs] = useState(0)
  const [playing, setPlaying] = useState(false)
  const [hoveredSeg, setHoveredSeg] = useState<string | null>(null)
  const rafRef = useRef<number>(0)
  const lastTsRef = useRef<number>(0)
  const scrollRef = useRef<HTMLDivElement>(null)

  const timeline = useMemo(
    () => buildTimeline(draft, currentEpisodeId || undefined),
    [draft, currentEpisodeId],
  )

  const shotMap = useMemo(() => {
    const m = new Map<string, ShortDramaDraftV2['shots'][number]>()
    for (const s of draft.shots) m.set(s.id, s)
    return m
  }, [draft.shots])

  const charMap = useMemo(
    () => new Map(draft.characters.map(c => [c.id, c.name])),
    [draft.characters],
  )

  const bgmSegments = useMemo(() => {
    if (!draft.bgmAssignments?.length || !draft.bgmLibrary?.length) return []
    const trackMap = new Map(draft.bgmLibrary.map(t => [t.id, t]))
    const shots = currentEpisodeId
      ? draft.shots.filter(s => s.episodeId === currentEpisodeId)
      : draft.shots

    return draft.bgmAssignments
      .filter(a => !a.episodeId || a.episodeId === (currentEpisodeId || undefined))
      .map(a => {
        const track = trackMap.get(a.trackId)
        if (!track) return null
        const [startIdx, endIdx] = a.shotRange || [0, shots.length - 1]
        const startSeg = timeline.segments.find(seg => {
          const idx = shots.findIndex(s => s.id === seg.shotId)
          return idx >= 0 && idx >= startIdx
        })
        const endSeg = [...timeline.segments].reverse().find(seg => {
          const idx = shots.findIndex(s => s.id === seg.shotId)
          return idx >= 0 && idx <= endIdx
        })
        if (!startSeg || !endSeg) return null
        const startMs = startSeg.startMs
        const endMs = endSeg.startMs + endSeg.durationMs
        return { id: a.id, name: track.name, startMs, durationMs: endMs - startMs, volume: a.volume }
      })
      .filter(Boolean) as { id: string; name: string; startMs: number; durationMs: number; volume: number }[]
  }, [draft, currentEpisodeId, timeline])

  const msToX = useCallback((ms: number) => (ms * zoomLevel) / 1000, [zoomLevel])
  const xToMs = useCallback((x: number) => (x * 1000) / zoomLevel, [zoomLevel])

  const totalWidth = msToX(timeline.totalDurationMs)

  const tick = useCallback((ts: number) => {
    if (!lastTsRef.current) lastTsRef.current = ts
    const delta = ts - lastTsRef.current
    lastTsRef.current = ts
    setPlayheadMs(prev => {
      const next = prev + delta
      if (next >= timeline.totalDurationMs) {
        setPlaying(false)
        return timeline.totalDurationMs
      }
      return next
    })
    rafRef.current = requestAnimationFrame(tick)
  }, [timeline.totalDurationMs])

  useEffect(() => {
    if (playing) {
      lastTsRef.current = 0
      rafRef.current = requestAnimationFrame(tick)
    } else {
      cancelAnimationFrame(rafRef.current)
    }
    return () => cancelAnimationFrame(rafRef.current)
  }, [playing, tick])

  const handlePlay = () => {
    if (playheadMs >= timeline.totalDurationMs) setPlayheadMs(0)
    setPlaying(true)
  }
  const handlePause = () => setPlaying(false)
  const handleStop = () => { setPlaying(false); setPlayheadMs(0) }

  const handleRulerClick = (e: React.MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect()
    const x = e.clientX - rect.left + (scrollRef.current?.scrollLeft || 0)
    const ms = Math.max(0, Math.min(xToMs(x), timeline.totalDurationMs))
    setPlayheadMs(ms)
    if (playing) { setPlaying(false); setTimeout(() => setPlaying(true), 0) }
  }

  const rulerMarks = useMemo(() => {
    const marks: { x: number; label: string; major: boolean }[] = []
    if (timeline.totalDurationMs === 0) return marks
    let step = 1
    if (zoomLevel < 30) step = 10
    else if (zoomLevel < 60) step = 5
    const totalSec = Math.ceil(timeline.totalDurationMs / 1000)
    for (let s = 0; s <= totalSec; s += step) {
      const isMajor = s % (step >= 10 ? 10 : step >= 5 ? 5 : 5) === 0
      marks.push({ x: msToX(s * 1000), label: isMajor ? `${s}s` : '', major: isMajor })
    }
    return marks
  }, [timeline.totalDurationMs, zoomLevel, msToX])

  const handleZoomIn = () => setZoomLevel(prev => Math.min(500, prev + 25))
  const handleZoomOut = () => setZoomLevel(prev => Math.max(25, prev - 25))
  const handleZoomFit = () => {
    const container = scrollRef.current
    if (!container || timeline.totalDurationMs === 0) return
    const w = container.clientWidth - 20
    setZoomLevel(Math.max(25, Math.min(500, Math.floor((w * 1000) / timeline.totalDurationMs))))
  }

  const renderSegment = (
    seg: { startMs: number; durationMs: number },
    trackColor: string,
    content: React.ReactNode,
    key: string,
    bgImage?: string,
  ) => {
    const left = msToX(seg.startMs)
    const width = Math.max(msToX(seg.durationMs), 4)
    const isHovered = hoveredSeg === key
    return (
      <div
        key={key}
        className="absolute top-1 bottom-1 rounded overflow-hidden flex items-center cursor-default group/seg"
        style={{
          left,
          width,
          backgroundColor: `${trackColor}22`,
          borderLeft: `2px solid ${trackColor}`,
          ...(bgImage ? { backgroundImage: `url(${bgImage})`, backgroundSize: 'cover', backgroundPosition: 'center' } : {}),
        }}
        onMouseEnter={() => setHoveredSeg(key)}
        onMouseLeave={() => setHoveredSeg(null)}
      >
        {bgImage && <div className="absolute inset-0 bg-black/50 group-hover/seg:bg-black/35 transition-colors" />}
        <div className="absolute inset-0 opacity-0 group-hover/seg:opacity-100 transition-opacity" style={{ backgroundColor: `${trackColor}15` }} />
        <span className="relative text-[10px] text-white/90 truncate leading-none px-1.5 drop-shadow-sm font-medium">{content}</span>
        {isHovered && (
          <span className="absolute -top-5 left-1 rounded bg-black/80 px-1.5 py-0.5 text-[9px] text-white whitespace-nowrap z-20 pointer-events-none">
            {formatTime(seg.startMs)} - {formatTime(seg.startMs + seg.durationMs)}
          </span>
        )}
      </div>
    )
  }

  const progressPct = timeline.totalDurationMs > 0 ? (playheadMs / timeline.totalDurationMs) * 100 : 0

  return (
    <div className="flex flex-col flex-1 min-h-0 bg-[var(--bg-primary)]">
      {/* Transport bar */}
      <div className="flex items-center gap-3 px-4 py-2 border-b border-[var(--border-color)] bg-[var(--bg-secondary)]/50">
        <div className="flex items-center gap-1">
          <button
            onClick={handleStop}
            className="p-1.5 rounded-md hover:bg-white/5 active:bg-white/10 transition-colors"
            title="停止"
          >
            <SkipBack className="h-4 w-4 text-[var(--text-secondary)]" />
          </button>
          <button
            onClick={playing ? handlePause : handlePlay}
            className={cn(
              'p-2 rounded-lg transition-all',
              playing
                ? 'bg-[var(--accent-color)] text-white shadow-lg shadow-[var(--accent-color)]/25'
                : 'bg-white/5 hover:bg-white/10 text-[var(--text-primary)]',
            )}
            title={playing ? '暂停' : '播放'}
          >
            {playing
              ? <Pause className="h-4 w-4" />
              : <Play className="h-4 w-4 translate-x-[1px]" />}
          </button>
        </div>

        <div className="flex items-baseline gap-1 min-w-[140px]">
          <span className="text-sm tabular-nums font-mono text-[var(--text-primary)] tracking-tight">
            {formatTime(playheadMs)}
          </span>
          <span className="text-xs text-[var(--text-secondary)]/50">/</span>
          <span className="text-xs tabular-nums font-mono text-[var(--text-secondary)]">
            {formatTime(timeline.totalDurationMs)}
          </span>
        </div>

        {/* Mini progress bar */}
        <div className="flex-1 h-1 rounded-full bg-white/5 overflow-hidden">
          <div
            className="h-full rounded-full bg-[var(--accent-color)]/60 transition-[width] duration-75"
            style={{ width: `${progressPct}%` }}
          />
        </div>

        <div className="flex items-center gap-1.5">
          <button onClick={handleZoomOut} className="p-1 rounded hover:bg-white/5 transition-colors" title="缩小">
            <ZoomOut className="h-3.5 w-3.5 text-[var(--text-secondary)]" />
          </button>
          <input
            type="range"
            min={25}
            max={500}
            value={zoomLevel}
            onChange={e => setZoomLevel(Number(e.target.value))}
            className="w-20 h-1 accent-[var(--accent-color)] cursor-pointer"
          />
          <button onClick={handleZoomIn} className="p-1 rounded hover:bg-white/5 transition-colors" title="放大">
            <ZoomIn className="h-3.5 w-3.5 text-[var(--text-secondary)]" />
          </button>
          <button onClick={handleZoomFit} className="p-1 rounded hover:bg-white/5 transition-colors" title="适配宽度">
            <Maximize2 className="h-3.5 w-3.5 text-[var(--text-secondary)]" />
          </button>
          <span className="text-[10px] tabular-nums text-[var(--text-secondary)]/60 w-12 text-right font-mono">
            {zoomLevel}px/s
          </span>
        </div>
      </div>

      {/* Timeline body */}
      <div className="flex flex-1 min-h-0">
        {/* Track labels */}
        <div className="flex-shrink-0 border-r border-[var(--border-color)]/50" style={{ width: LABEL_W }}>
          <div className="h-6" />
          {TRACKS.map(t => (
            <div
              key={t.key}
              className="flex items-center gap-1.5 px-2 border-b border-[var(--border-color)]/30"
              style={{ height: TRACK_H }}
            >
              <div className={cn('h-2 w-2 rounded-full shrink-0', t.dotClass)} />
              <span className="text-[10px] text-[var(--text-secondary)] truncate">{t.label}</span>
            </div>
          ))}
        </div>

        {/* Scrollable area */}
        <div ref={scrollRef} className="flex-1 overflow-x-auto overflow-y-hidden relative">
          <div style={{ width: Math.max(totalWidth + 60, 200), minHeight: 5 * TRACK_H + 24 }}>
            {/* Ruler */}
            <div
              className="h-6 relative cursor-pointer select-none"
              style={{ background: 'linear-gradient(to bottom, var(--bg-secondary), transparent)' }}
              onClick={handleRulerClick}
            >
              {rulerMarks.map((mk, i) => (
                <div key={i} className="absolute top-0" style={{ left: mk.x }}>
                  <div
                    className="w-px"
                    style={{
                      height: mk.major ? 24 : 10,
                      marginTop: mk.major ? 0 : 14,
                      backgroundColor: mk.major ? 'var(--text-secondary)' : 'var(--border-color)',
                      opacity: mk.major ? 0.4 : 0.3,
                    }}
                  />
                  {mk.label && (
                    <span
                      className="absolute left-1 text-[9px] font-mono whitespace-nowrap leading-[24px]"
                      style={{ color: 'var(--text-secondary)', opacity: 0.6 }}
                    >
                      {mk.label}
                    </span>
                  )}
                </div>
              ))}
            </div>

            {/* Tracks */}
            {TRACKS.map((track, trackIdx) => (
              <div
                key={track.key}
                className="relative border-b border-[var(--border-color)]/20"
                style={{
                  height: TRACK_H,
                  background: trackIdx % 2 === 0 ? 'transparent' : 'rgba(255,255,255,0.01)',
                }}
              >
                {track.key === 'V' && timeline.segments.map(seg => {
                  const shot = shotMap.get(seg.shotId)
                  const frameUrl = shot ? getStartFrameUrl(shot) : undefined
                  return renderSegment(seg, track.color, shot?.title || seg.shotId, `v-${seg.shotId}`, frameUrl)
                })}

                {track.key === 'D' && timeline.segments.map(seg => {
                  const shot = shotMap.get(seg.shotId)
                  if (!shot?.audio?.dialogue) return null
                  const speaker = shot.audio.dialogueCharacterId
                    ? charMap.get(shot.audio.dialogueCharacterId) || ''
                    : ''
                  return renderSegment(seg, track.color, speaker || '台词', `d-${seg.shotId}`)
                })}

                {track.key === 'N' && timeline.segments.map(seg => {
                  const shot = shotMap.get(seg.shotId)
                  if (!shot?.audio?.narration) return null
                  return renderSegment(seg, track.color, '旁白', `n-${seg.shotId}`)
                })}

                {track.key === 'B' && bgmSegments.map(seg =>
                  renderSegment(seg, track.color, seg.name, `b-${seg.id}`),
                )}

                {track.key === 'S' && timeline.segments.map(seg => {
                  const shot = shotMap.get(seg.shotId)
                  if (!shot?.audio?.dialogue) return null
                  return renderSegment(seg, track.color, shot.audio.dialogue, `s-${seg.shotId}`)
                })}
              </div>
            ))}

            {/* Playhead */}
            <div
              className="absolute top-0 pointer-events-none z-20"
              style={{ left: msToX(playheadMs), height: 24 + TRACK_H * 5 }}
            >
              <div className="relative">
                {/* Marker head */}
                <svg width="10" height="8" viewBox="0 0 10 8" className="absolute -left-[5px] -top-px">
                  <polygon points="0,0 10,0 5,8" fill="#ef4444" />
                </svg>
                {/* Line */}
                <div
                  className="w-px bg-red-500"
                  style={{ height: 24 + TRACK_H * 5, opacity: 0.8 }}
                />
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
