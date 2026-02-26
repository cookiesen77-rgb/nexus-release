import React, { useCallback, useMemo, useRef, useState } from 'react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import {
  Columns3,
  GripVertical,
  Camera,
  Lightbulb,
  Move3D,
  MonitorPlay,
  Maximize,
  ChevronDown,
} from 'lucide-react'
import type {
  ShortDramaDraftV2,
  ShortDramaShot,
  ShortDramaShotSize,
  ShortDramaCameraRig,
  ShortDramaCameraMovement,
  ShortDramaLighting,
  ShortDramaNarrativeFunction,
  ShortDramaMediaVariant,
} from '@/lib/shortDrama/types'

interface Props {
  draft: ShortDramaDraftV2
  setDraft: React.Dispatch<React.SetStateAction<ShortDramaDraftV2>>
  currentEpisodeId?: string | null
  onShotClick?: (shotId: string) => void
}

const NARRATIVE_COLORS: Record<ShortDramaNarrativeFunction, { bg: string; dot: string; text: string }> = {
  setup: { bg: 'bg-blue-500/80', dot: 'bg-blue-400', text: 'text-blue-300' },
  escalation: { bg: 'bg-amber-500/80', dot: 'bg-amber-400', text: 'text-amber-300' },
  climax: { bg: 'bg-red-500/80', dot: 'bg-red-400', text: 'text-red-300' },
  turn: { bg: 'bg-purple-500/80', dot: 'bg-purple-400', text: 'text-purple-300' },
  transition: { bg: 'bg-gray-400/80', dot: 'bg-gray-400', text: 'text-gray-300' },
  resolution: { bg: 'bg-green-500/80', dot: 'bg-green-400', text: 'text-green-300' },
}

const NARRATIVE_LABELS: Record<ShortDramaNarrativeFunction, string> = {
  setup: '铺垫',
  escalation: '升级',
  climax: '高潮',
  turn: '转折',
  transition: '过渡',
  resolution: '收束',
}

const SHOT_SIZE_OPTIONS: { value: ShortDramaShotSize; label: string; abbr: string }[] = [
  { value: 'extreme_wide', label: '远景', abbr: 'EWS' },
  { value: 'wide', label: '全景', abbr: 'WS' },
  { value: 'full', label: '全身', abbr: 'FS' },
  { value: 'medium', label: '中景', abbr: 'MS' },
  { value: 'close_up', label: '特写', abbr: 'CU' },
  { value: 'extreme_close_up', label: '大特写', abbr: 'ECU' },
  { value: 'insert', label: '插入', abbr: 'INS' },
]

const CAMERA_RIG_OPTIONS: { value: ShortDramaCameraRig; label: string }[] = [
  { value: 'tripod', label: '三脚架' },
  { value: 'steadicam', label: '稳定器' },
  { value: 'handheld', label: '手持' },
  { value: 'crane', label: '摇臂' },
  { value: 'drone', label: '航拍' },
  { value: 'dolly', label: '轨道' },
  { value: 'slider', label: '滑轨' },
]

const CAMERA_MOVEMENT_OPTIONS: { value: ShortDramaCameraMovement; label: string }[] = [
  { value: 'static', label: '静止' },
  { value: 'pan_left', label: '左摇' },
  { value: 'pan_right', label: '右摇' },
  { value: 'tilt_up', label: '上摇' },
  { value: 'dolly_in', label: '推近' },
  { value: 'dolly_out', label: '拉远' },
  { value: 'tracking', label: '跟踪' },
  { value: 'orbit', label: '环绕' },
]

const LIGHTING_OPTIONS: { value: ShortDramaLighting; label: string }[] = [
  { value: 'high_key', label: '高调' },
  { value: 'low_key', label: '低调' },
  { value: 'chiaroscuro', label: '明暗' },
  { value: 'natural', label: '自然' },
  { value: 'neon', label: '霓虹' },
  { value: 'golden_hour', label: '黄金时刻' },
  { value: 'candlelight', label: '烛光' },
]

const COL_OPTIONS = [3, 4, 6] as const
type ColumnCount = (typeof COL_OPTIONS)[number]

const GRID_CLASS: Record<ColumnCount, string> = {
  3: 'grid-cols-3',
  4: 'grid-cols-4',
  6: 'grid-cols-6',
}

function getThumbnailUrl(shot: ShortDramaShot): string | undefined {
  const slot = shot.frames.start.slot
  const selected = slot.selectedVariantId
    ? slot.variants.find((v) => v.id === slot.selectedVariantId)
    : undefined
  const target: ShortDramaMediaVariant | undefined =
    selected?.status === 'success' ? selected : slot.variants.find((v) => v.status === 'success')
  if (!target) return undefined
  return target.displayUrl || target.sourceUrl || undefined
}

function InlineSelect({
  value,
  options,
  placeholder,
  icon,
  onChange,
}: {
  value: string
  options: { value: string; label: string }[]
  placeholder: string
  icon?: React.ReactNode
  onChange: (v: string) => void
}) {
  return (
    <div className="relative group/sel">
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="appearance-none w-full rounded-md border border-[var(--border-color)]/60 bg-[var(--bg-secondary)]/80 pl-5 pr-4 py-[3px] text-[10px] font-medium text-[var(--text-primary)] focus:border-[var(--accent-color)] focus:outline-none hover:border-[var(--text-secondary)]/40 transition-colors cursor-pointer"
      >
        <option value="">{placeholder}</option>
        {options.map((o) => (
          <option key={o.value} value={o.value}>{o.label}</option>
        ))}
      </select>
      <div className="absolute left-1.5 top-1/2 -translate-y-1/2 pointer-events-none text-[var(--text-secondary)]/60">
        {icon}
      </div>
      <ChevronDown className="absolute right-1 top-1/2 -translate-y-1/2 h-2.5 w-2.5 text-[var(--text-secondary)]/40 pointer-events-none" />
    </div>
  )
}

export default function ShortDramaDirectorBoard({ draft, setDraft, currentEpisodeId, onShotClick }: Props) {
  const [cols, setCols] = useState<ColumnCount>(4)
  const [dragOverId, setDragOverId] = useState<string | null>(null)
  const dragShotId = useRef<string | null>(null)

  const visibleShots = useMemo(() => {
    if (!currentEpisodeId) return draft.shots
    return draft.shots.filter((s) => s.episodeId === currentEpisodeId)
  }, [draft.shots, currentEpisodeId])

  const narrativeStats = useMemo(() => {
    const counts: Partial<Record<ShortDramaNarrativeFunction, number>> = {}
    for (const s of visibleShots) {
      const nf = s.cinematography?.narrativeFunction
      if (nf) counts[nf] = (counts[nf] || 0) + 1
    }
    return counts
  }, [visibleShots])

  const patchCinematography = useCallback(
    (shotId: string, key: string, value: string) => {
      setDraft((prev) => ({
        ...prev,
        shots: prev.shots.map((s) =>
          s.id === shotId
            ? { ...s, cinematography: { ...s.cinematography, [key]: value || undefined } }
            : s,
        ),
      }))
    },
    [setDraft],
  )

  const handleDragStart = useCallback((e: React.DragEvent, shotId: string) => {
    dragShotId.current = shotId
    e.dataTransfer.effectAllowed = 'move'
    e.dataTransfer.setData('text/plain', shotId)
    const el = e.currentTarget as HTMLElement
    el.style.opacity = '0.5'
  }, [])

  const handleDragEnd = useCallback((e: React.DragEvent) => {
    const el = e.currentTarget as HTMLElement
    el.style.opacity = '1'
    setDragOverId(null)
  }, [])

  const handleDragOver = useCallback((e: React.DragEvent, shotId: string) => {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    setDragOverId(shotId)
  }, [])

  const handleDragLeave = useCallback(() => {
    setDragOverId(null)
  }, [])

  const handleDrop = useCallback(
    (e: React.DragEvent, targetShotId: string) => {
      e.preventDefault()
      setDragOverId(null)
      const fromId = dragShotId.current
      if (!fromId || fromId === targetShotId) return
      setDraft((prev) => {
        const shots = [...prev.shots]
        const fromIdx = shots.findIndex((s) => s.id === fromId)
        const toIdx = shots.findIndex((s) => s.id === targetShotId)
        if (fromIdx < 0 || toIdx < 0) return prev
        const [moved] = shots.splice(fromIdx, 1)
        shots.splice(toIdx, 0, moved)
        return { ...prev, shots }
      })
      dragShotId.current = null
    },
    [setDraft],
  )

  return (
    <div className="flex h-full flex-col min-h-0 bg-[var(--bg-primary)]">
      {/* Toolbar */}
      <div className="flex items-center gap-3 px-4 py-2 border-b border-[var(--border-color)] bg-[var(--bg-secondary)]/50 flex-shrink-0">
        <div className="flex items-center gap-1.5">
          <Camera className="h-3.5 w-3.5 text-violet-400" />
          <span className="text-xs font-semibold text-[var(--text-primary)]">导演板</span>
        </div>
        <div className="h-3 w-px bg-[var(--border-color)]" />
        <span className="text-[11px] tabular-nums text-[var(--text-secondary)]">
          {visibleShots.length} 镜头
        </span>

        <div className="flex-1" />

        {/* Narrative legend */}
        <div className="hidden md:flex items-center gap-2">
          {(Object.keys(NARRATIVE_COLORS) as ShortDramaNarrativeFunction[]).map((nf) => {
            const count = narrativeStats[nf]
            return (
              <span key={nf} className="flex items-center gap-1 text-[10px] text-[var(--text-secondary)]">
                <span className={cn('h-2 w-2 rounded-full', NARRATIVE_COLORS[nf].dot)} />
                <span>{NARRATIVE_LABELS[nf]}</span>
                {count && <span className="tabular-nums opacity-60">({count})</span>}
              </span>
            )
          })}
        </div>

        <div className="h-3 w-px bg-[var(--border-color)]" />

        {/* Column selector */}
        <div className="flex items-center gap-0.5">
          <Columns3 className="h-3 w-3 text-[var(--text-secondary)]/50 mr-1" />
          {COL_OPTIONS.map((n) => (
            <button
              key={n}
              onClick={() => setCols(n)}
              className={cn(
                'h-6 min-w-[24px] rounded-md text-[10px] font-semibold tabular-nums transition-all',
                cols === n
                  ? 'bg-violet-500/20 text-violet-300 shadow-sm shadow-violet-500/10'
                  : 'text-[var(--text-secondary)]/60 hover:text-[var(--text-secondary)] hover:bg-white/5',
              )}
            >
              {n}
            </button>
          ))}
        </div>
      </div>

      {/* Narrative arc strip */}
      <div className="flex items-center px-4 py-1.5 border-b border-[var(--border-color)]/50 bg-black/20 flex-shrink-0">
        <span className="text-[10px] text-[var(--text-secondary)]/60 font-mono uppercase tracking-wider mr-3 flex-shrink-0">ARC</span>
        <div className="flex flex-1 items-center gap-px h-5 rounded overflow-hidden">
          {visibleShots.map((shot) => {
            const nf = shot.cinematography?.narrativeFunction
            const colors = nf ? NARRATIVE_COLORS[nf] : { bg: 'bg-[var(--border-color)]/50', dot: '', text: '' }
            return (
              <div
                key={shot.id}
                className={cn(
                  'flex-1 h-full transition-all duration-200 relative group/arc cursor-default',
                  colors.bg,
                )}
                title={`${shot.title} — ${nf ? NARRATIVE_LABELS[nf] : '未设定'}`}
              >
                <div className="absolute inset-0 opacity-0 group-hover/arc:opacity-100 bg-white/15 transition-opacity" />
              </div>
            )
          })}
        </div>
      </div>

      {/* Shot grid */}
      <div className="flex-1 overflow-y-auto p-3">
        <div className={cn('grid gap-2', GRID_CLASS[cols])}>
          {visibleShots.map((shot, idx) => {
            const thumb = getThumbnailUrl(shot)
            const cine = shot.cinematography
            const nf = cine?.narrativeFunction
            const isDragOver = dragOverId === shot.id
            const shotSizeAbbr = cine?.shotSize
              ? SHOT_SIZE_OPTIONS.find((o) => o.value === cine.shotSize)?.abbr
              : undefined

            return (
              <div
                key={shot.id}
                draggable
                onDragStart={(e) => handleDragStart(e, shot.id)}
                onDragEnd={handleDragEnd}
                onDragOver={(e) => handleDragOver(e, shot.id)}
                onDragLeave={handleDragLeave}
                onDrop={(e) => handleDrop(e, shot.id)}
                className={cn(
                  'group flex flex-col overflow-hidden rounded-lg border transition-all duration-150',
                  isDragOver
                    ? 'border-violet-500/60 bg-violet-500/5 scale-[1.02] shadow-lg shadow-violet-500/10'
                    : 'border-[var(--border-color)]/60 bg-[var(--bg-primary)] hover:border-[var(--text-secondary)]/30 hover:shadow-md hover:shadow-black/20',
                )}
              >
                {/* Thumbnail */}
                <div
                  className={cn(
                    'relative aspect-video w-full overflow-hidden bg-[var(--bg-secondary)]',
                    onShotClick && 'cursor-pointer',
                  )}
                  onClick={() => onShotClick?.(shot.id)}
                >
                  {thumb ? (
                    <img
                      src={thumb}
                      alt={shot.title}
                      className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
                      draggable={false}
                    />
                  ) : (
                    <div className="flex h-full w-full items-center justify-center">
                      <span className="text-3xl font-black text-[var(--text-secondary)]/15 tabular-nums">{idx + 1}</span>
                    </div>
                  )}

                  {/* Overlay badges */}
                  <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />

                  {/* Index badge */}
                  <span className="absolute top-1 left-1 rounded bg-black/70 px-1.5 py-0.5 text-[9px] font-mono font-bold text-white/90 tabular-nums">
                    #{idx + 1}
                  </span>

                  {/* Shot size badge */}
                  {shotSizeAbbr && (
                    <span className="absolute top-1 right-1 rounded bg-violet-500/80 px-1.5 py-0.5 text-[9px] font-mono font-bold text-white">
                      {shotSizeAbbr}
                    </span>
                  )}

                  {/* Narrative function indicator */}
                  {nf && (
                    <span className={cn(
                      'absolute bottom-1 left-1 rounded px-1.5 py-0.5 text-[9px] font-semibold',
                      NARRATIVE_COLORS[nf].bg,
                      'text-white',
                    )}>
                      {NARRATIVE_LABELS[nf]}
                    </span>
                  )}

                  {/* Drag handle */}
                  <GripVertical className="absolute right-1 bottom-1 h-4 w-4 text-white/60 opacity-0 drop-shadow-md group-hover:opacity-100 transition-opacity cursor-grab active:cursor-grabbing" />
                </div>

                {/* Info section */}
                <div className="flex flex-col gap-1.5 p-2">
                  {/* Title row */}
                  <div className="flex items-center gap-1.5 min-w-0">
                    <span className="truncate text-[11px] font-semibold text-[var(--text-primary)] leading-tight">
                      {shot.title || `镜头 ${idx + 1}`}
                    </span>
                    {shot.beat && (
                      <span className="shrink-0 rounded-full bg-[var(--accent-color)]/15 px-1.5 py-px text-[9px] font-medium text-[var(--accent-color)]">
                        {shot.beat}
                      </span>
                    )}
                  </div>

                  {/* Dialogue preview */}
                  {shot.audio?.dialogue && (
                    <p className="truncate text-[10px] leading-tight text-[var(--text-secondary)]/70 italic">
                      &ldquo;{shot.audio.dialogue}&rdquo;
                    </p>
                  )}

                  {/* Cinematography controls */}
                  <div className="grid grid-cols-2 gap-1 mt-0.5">
                    <InlineSelect
                      value={cine?.shotSize || ''}
                      options={SHOT_SIZE_OPTIONS}
                      placeholder="景别"
                      icon={<Maximize className="h-2.5 w-2.5" />}
                      onChange={(v) => patchCinematography(shot.id, 'shotSize', v)}
                    />
                    <InlineSelect
                      value={cine?.cameraRig || ''}
                      options={CAMERA_RIG_OPTIONS}
                      placeholder="机位"
                      icon={<MonitorPlay className="h-2.5 w-2.5" />}
                      onChange={(v) => patchCinematography(shot.id, 'cameraRig', v)}
                    />
                    <InlineSelect
                      value={cine?.cameraMovement || ''}
                      options={CAMERA_MOVEMENT_OPTIONS}
                      placeholder="运镜"
                      icon={<Move3D className="h-2.5 w-2.5" />}
                      onChange={(v) => patchCinematography(shot.id, 'cameraMovement', v)}
                    />
                    <InlineSelect
                      value={cine?.lighting || ''}
                      options={LIGHTING_OPTIONS}
                      placeholder="光线"
                      icon={<Lightbulb className="h-2.5 w-2.5" />}
                      onChange={(v) => patchCinematography(shot.id, 'lighting', v)}
                    />
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
