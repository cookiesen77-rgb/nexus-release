import React, { useState, useMemo, useCallback } from 'react'
import { Plus, Trash2, AlertTriangle, Film, Image, Volume2, Check, Search } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import {
  createShotGroup,
  addShotGroup,
  updateShotGroup,
  removeShotGroup,
  mergeShotPrompts,
  validateSeedanceAssets,
  addAssetRef,
  removeAssetRef,
  autoTagAssetRefs,
} from '@/lib/shortDrama/shotGroupOps'
import type {
  ShortDramaDraftV2,
  ShortDramaShotGroup,
  ShortDramaAssetRef,
  ShortDramaMediaKind,
} from '@/lib/shortDrama/types'

interface Props {
  draft: ShortDramaDraftV2
  setDraft: React.Dispatch<React.SetStateAction<ShortDramaDraftV2>>
  currentEpisodeId?: string | null
}

const KIND_ICON: Record<ShortDramaMediaKind, React.ReactNode> = {
  image: <Image className="h-3.5 w-3.5" />,
  video: <Film className="h-3.5 w-3.5" />,
  audio: <Volume2 className="h-3.5 w-3.5" />,
}

const KIND_LABEL: Record<string, { kind: ShortDramaMediaKind; field: 'imageRefs' | 'videoRefs' | 'audioRefs'; prefix: string }> = {
  image: { kind: 'image', field: 'imageRefs', prefix: '@Image' },
  video: { kind: 'video', field: 'videoRefs', prefix: '@Video' },
  audio: { kind: 'audio', field: 'audioRefs', prefix: '@Audio' },
}

const KIND_COLOR: Record<ShortDramaMediaKind, string> = {
  image: 'text-blue-400 bg-blue-500/10',
  video: 'text-purple-400 bg-purple-500/10',
  audio: 'text-emerald-400 bg-emerald-500/10',
}

function truncateUrl(url: string, max = 36) {
  if (url.length <= max) return url
  return url.slice(0, max - 3) + '...'
}

function GroupCard({
  group,
  draft,
  setDraft,
  currentEpisodeId,
}: {
  group: ShortDramaShotGroup
  draft: ShortDramaDraftV2
  setDraft: React.Dispatch<React.SetStateAction<ShortDramaDraftV2>>
  currentEpisodeId?: string | null
}) {
  const [editingName, setEditingName] = useState(false)
  const [nameValue, setNameValue] = useState(group.name)
  const [dropdownOpen, setDropdownOpen] = useState(false)
  const [shotSearch, setShotSearch] = useState('')

  const allGroupedShotIds = useMemo(() => {
    const ids = new Set<string>()
    for (const g of draft.shotGroups || []) {
      for (const sid of g.shotIds) ids.add(sid)
    }
    return ids
  }, [draft.shotGroups])

  const availableShots = useMemo(() => {
    return draft.shots.filter((s) => {
      if (allGroupedShotIds.has(s.id)) return false
      if (currentEpisodeId && s.episodeId !== currentEpisodeId) return false
      return true
    })
  }, [draft.shots, allGroupedShotIds, currentEpisodeId])

  const filteredShots = useMemo(() => {
    if (!shotSearch.trim()) return availableShots
    const q = shotSearch.toLowerCase()
    return availableShots.filter(s => s.title.toLowerCase().includes(q))
  }, [availableShots, shotSearch])

  const shotMap = useMemo(() => {
    const m = new Map<string, string>()
    for (const s of draft.shots) m.set(s.id, s.title)
    return m
  }, [draft.shots])

  const shotIndexMap = useMemo(() => {
    const m = new Map<string, number>()
    draft.shots.forEach((s, i) => m.set(s.id, i))
    return m
  }, [draft.shots])

  const errors = useMemo(() => validateSeedanceAssets(group), [group])

  const videoSlot = group.video
  const hasSuccess = videoSlot.variants.some((v) => v.status === 'success')
  const isRunning = videoSlot.variants.some((v) => v.status === 'running')

  const commitName = useCallback(() => {
    setEditingName(false)
    const trimmed = nameValue.trim()
    if (trimmed && trimmed !== group.name) {
      setDraft((prev) => updateShotGroup(prev, group.id, { name: trimmed }))
    } else {
      setNameValue(group.name)
    }
  }, [nameValue, group.id, group.name, setDraft])

  const handleRemoveShotFromGroup = useCallback(
    (shotId: string) => {
      setDraft((prev) =>
        updateShotGroup(prev, group.id, {
          shotIds: group.shotIds.filter((id) => id !== shotId),
        }),
      )
    },
    [group.id, group.shotIds, setDraft],
  )

  const handleAddShot = useCallback(
    (shotId: string) => {
      setDraft((prev) =>
        updateShotGroup(prev, group.id, {
          shotIds: [...group.shotIds, shotId],
        }),
      )
      setDropdownOpen(false)
      setShotSearch('')
    },
    [group.id, group.shotIds, setDraft],
  )

  const handleAutoMerge = useCallback(() => {
    const merged = mergeShotPrompts(draft, group.shotIds)
    setDraft((prev) => updateShotGroup(prev, group.id, { mergedPrompt: merged }))
  }, [draft, group.id, group.shotIds, setDraft])

  const handleRemoveRef = useCallback(
    (refId: string, field: 'imageRefs' | 'videoRefs' | 'audioRefs') => {
      setDraft((prev) => removeAssetRef(prev, group.id, refId, field))
    },
    [group.id, setDraft],
  )

  return (
    <div className="rounded-md border border-[var(--border-color)] bg-[var(--bg-secondary)] overflow-hidden transition-colors hover:border-[var(--text-secondary)]/25">
      {/* Gradient header strip */}
      <div
        className="h-[3px]"
        style={{
          background: hasSuccess
            ? 'linear-gradient(90deg, #059669, #34d399)'
            : isRunning
              ? 'linear-gradient(90deg, var(--accent-color), #818cf8)'
              : 'linear-gradient(90deg, var(--border-color), var(--text-secondary))',
        }}
      />

      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-[var(--border-color)]/50">
        {editingName ? (
          <input
            autoFocus
            value={nameValue}
            onChange={(e) => setNameValue(e.target.value)}
            onBlur={commitName}
            onKeyDown={(e) => {
              if (e.key === 'Enter') commitName()
              if (e.key === 'Escape') {
                setNameValue(group.name)
                setEditingName(false)
              }
            }}
            className="flex-1 rounded bg-[var(--bg-primary)] px-2 py-0.5 text-[11px] font-medium text-[var(--text-primary)] border border-[var(--accent-color)] outline-none"
          />
        ) : (
          <button
            className="flex-1 text-left text-[11px] font-semibold text-[var(--text-primary)] hover:text-[var(--accent-color)] transition-colors duration-150"
            onClick={() => {
              setNameValue(group.name)
              setEditingName(true)
            }}
          >
            {group.name}
          </button>
        )}
        <div className="flex items-center gap-1.5 ml-2">
          {hasSuccess && (
            <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-emerald-500/15 text-[10px] font-medium text-emerald-400">
              <Check className="h-2.5 w-2.5" />
              OK
            </span>
          )}
          {isRunning && !hasSuccess && (
            <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-[var(--accent-color)]/15 text-[10px] font-medium text-[var(--accent-color)]">
              <span className="h-2 w-2 rounded-full border-[1.5px] border-[var(--accent-color)] border-t-transparent animate-spin" />
              RUN
            </span>
          )}
          <button
            className="p-1 rounded text-[var(--text-secondary)] hover:text-red-400 hover:bg-red-500/10 transition-colors duration-150"
            onClick={() => setDraft((prev) => removeShotGroup(prev, group.id))}
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      <div className="p-3 space-y-3">
        {/* Shots list */}
        <div>
          <div className="text-[10px] font-medium uppercase tracking-wider text-[var(--text-secondary)] mb-1.5">Shots</div>
          {group.shotIds.length === 0 ? (
            <div className="text-[10px] text-[var(--text-secondary)] italic">暂无镜头</div>
          ) : (
            <div className="flex flex-wrap gap-1">
              {group.shotIds.map((sid) => {
                const idx = shotIndexMap.get(sid)
                return (
                  <span
                    key={sid}
                    className="inline-flex items-center gap-1 rounded-full bg-[var(--bg-primary)] border border-[var(--border-color)] pl-1 pr-1.5 py-0.5 text-[10px] text-[var(--text-primary)] transition-colors hover:border-[var(--accent-color)]/40 group/pill"
                  >
                    <span className="inline-flex items-center justify-center w-4 h-4 rounded-full bg-[var(--accent-color)]/15 text-[var(--accent-color)] text-[9px] font-bold tabular-nums">
                      {idx !== undefined ? idx + 1 : '?'}
                    </span>
                    <span className="truncate max-w-[80px]">{shotMap.get(sid) || sid.slice(0, 8)}</span>
                    <button
                      className="ml-0.5 text-[var(--text-secondary)] opacity-0 group-hover/pill:opacity-100 hover:text-red-400 transition-all duration-150"
                      onClick={() => handleRemoveShotFromGroup(sid)}
                    >
                      &times;
                    </button>
                  </span>
                )
              })}
            </div>
          )}
        </div>

        {/* Add shots dropdown */}
        <div className="relative">
          <Button size="sm" variant="secondary" className="h-6 px-2 text-[10px] gap-1" onClick={() => setDropdownOpen(!dropdownOpen)}>
            <Plus className="h-2.5 w-2.5" />
            添加镜头
          </Button>
          {dropdownOpen && (
            <div className="absolute z-10 mt-1 w-64 rounded-md border border-[var(--border-color)] bg-[var(--bg-secondary)] shadow-xl overflow-hidden">
              <div className="flex items-center gap-1.5 px-2.5 py-1.5 border-b border-[var(--border-color)]/50 bg-[var(--bg-primary)]">
                <Search className="h-3 w-3 text-[var(--text-secondary)] flex-shrink-0" />
                <input
                  autoFocus
                  value={shotSearch}
                  onChange={e => setShotSearch(e.target.value)}
                  placeholder="搜索镜头..."
                  className="w-full bg-transparent text-[10px] text-[var(--text-primary)] outline-none placeholder:text-[var(--text-secondary)]"
                />
              </div>
              <div className="max-h-40 overflow-auto">
                {filteredShots.length === 0 ? (
                  <div className="p-3 text-[10px] text-[var(--text-secondary)] text-center">无可用镜头</div>
                ) : (
                  filteredShots.map((shot) => {
                    const idx = shotIndexMap.get(shot.id)
                    return (
                      <button
                        key={shot.id}
                        className="w-full text-left flex items-center gap-2 px-2.5 py-1.5 text-[10px] text-[var(--text-primary)] hover:bg-[var(--accent-color)]/10 transition-colors"
                        onClick={() => handleAddShot(shot.id)}
                      >
                        <span className="inline-flex items-center justify-center w-4 h-4 rounded bg-[var(--bg-primary)] text-[9px] text-[var(--text-secondary)] tabular-nums flex-shrink-0">
                          {idx !== undefined ? idx + 1 : '-'}
                        </span>
                        <span className="truncate">{shot.title}</span>
                      </button>
                    )
                  })
                )}
              </div>
            </div>
          )}
        </div>

        {/* Merged prompt */}
        <div>
          <div className="flex items-center justify-between mb-1">
            <span className="text-[10px] font-medium uppercase tracking-wider text-[var(--text-secondary)]">Merged Prompt</span>
            <Button size="sm" variant="ghost" className="h-5 px-1.5 text-[10px]" onClick={handleAutoMerge}>
              自动合并
            </Button>
          </div>
          <div className="relative rounded-md border border-[var(--border-color)] bg-[var(--bg-primary)] overflow-hidden focus-within:border-[var(--accent-color)]/50 transition-colors">
            <div className="absolute left-0 top-0 bottom-0 w-6 bg-[var(--bg-secondary)]/60 border-r border-[var(--border-color)]/30 flex flex-col items-center pt-2 gap-[2.5px]">
              {Array.from({ length: Math.max(4, (group.mergedPrompt.match(/\n/g) || []).length + 1) }).map((_, i) => (
                <span key={i} className="text-[8px] text-[var(--text-secondary)] opacity-40 leading-[14px] tabular-nums">{i + 1}</span>
              ))}
            </div>
            <textarea
              value={group.mergedPrompt}
              onChange={(e) => setDraft((prev) => updateShotGroup(prev, group.id, { mergedPrompt: e.target.value }))}
              rows={4}
              className="w-full bg-transparent text-[var(--text-primary)] text-[11px] leading-[14px] pl-8 pr-3 py-2 resize-none outline-none"
              style={{ fontFamily: 'ui-monospace, SFMono-Regular, "SF Mono", Menlo, monospace' }}
            />
          </div>
        </div>

        {/* Asset references */}
        {(['image', 'video', 'audio'] as const).map((kind) => {
          const cfg = KIND_LABEL[kind]
          const refs: ShortDramaAssetRef[] = group[cfg.field]
          if (refs.length === 0) return null
          return (
            <div key={kind}>
              <div className="flex items-center gap-1.5 mb-1">
                <span className={cn('inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium', KIND_COLOR[kind])}>
                  {KIND_ICON[kind]}
                  {cfg.prefix}
                </span>
              </div>
              <div className="space-y-1">
                {refs.map((ref) => (
                  <div
                    key={ref.id}
                    className="flex items-center gap-2 rounded bg-[var(--bg-primary)] border border-[var(--border-color)]/50 px-2 py-1 group/ref transition-colors hover:border-[var(--border-color)]"
                  >
                    <span className={cn('text-[10px] font-semibold tabular-nums', KIND_COLOR[kind].split(' ')[0])}>{ref.tag}</span>
                    {ref.purpose && (
                      <span className="rounded bg-[var(--bg-secondary)] px-1 py-0.5 text-[9px] text-[var(--text-secondary)]">
                        {ref.purpose}
                      </span>
                    )}
                    <span className="flex-1 truncate text-[9px] text-[var(--text-secondary)] opacity-60">
                      {truncateUrl(ref.url)}
                    </span>
                    <button
                      className="text-[var(--text-secondary)] opacity-0 group-hover/ref:opacity-100 hover:text-red-400 transition-all duration-150"
                      onClick={() => handleRemoveRef(ref.id, cfg.field)}
                    >
                      &times;
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )
        })}

        {/* Validation errors */}
        {errors.length > 0 && (
          <div className="flex items-start gap-2 px-2.5 py-2 rounded-md bg-amber-500/8 border border-amber-500/20">
            <AlertTriangle className="h-3.5 w-3.5 text-amber-400 shrink-0 mt-0.5" />
            <div className="space-y-0.5">
              {errors.map((err, i) => (
                <div key={i} className="text-[10px] text-amber-300/90 leading-relaxed">{err}</div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

export default function ShortDramaShotGroupPanel({ draft, setDraft, currentEpisodeId }: Props) {
  const groups = draft.shotGroups || []

  const handleCreate = useCallback(() => {
    const group = createShotGroup(`镜头组 ${groups.length + 1}`, [])
    setDraft((prev) => addShotGroup(prev, group))
  }, [groups.length, setDraft])

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-[var(--text-primary)] pl-2.5 border-l-2 border-[var(--accent-color)]">
          Shot Groups
        </h3>
        <Button size="sm" className="h-7 px-2.5 text-[11px] gap-1" onClick={handleCreate}>
          <Plus className="h-3 w-3" />
          新建组
        </Button>
      </div>

      {groups.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-10 border border-dashed border-[var(--border-color)] rounded-lg bg-[var(--bg-primary)]/40">
          <Film className="h-6 w-6 text-[var(--text-secondary)] opacity-25 mb-2" />
          <span className="text-[11px] text-[var(--text-secondary)]">暂无镜头组，点击上方按钮创建</span>
        </div>
      ) : (
        <div className="space-y-2.5">
          {groups.map((g) => (
            <GroupCard
              key={g.id}
              group={g}
              draft={draft}
              setDraft={setDraft}
              currentEpisodeId={currentEpisodeId}
            />
          ))}
        </div>
      )}
    </div>
  )
}
