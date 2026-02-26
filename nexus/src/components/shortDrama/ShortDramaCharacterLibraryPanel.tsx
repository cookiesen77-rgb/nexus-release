import React, { useState, useEffect, useCallback } from 'react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { X, Search, Download, Upload, RefreshCw, Trash2, UserPlus } from 'lucide-react'
import type { ShortDramaDraftV2, ShortDramaCharacterAnchors } from '@/lib/shortDrama/types'
import {
  listLibraryCharacters,
  searchCharacterLibrary,
  getCharacterUsageStats,
  importCharacterIntoDraft,
  exportCharacterBundle,
  parseCharacterBundle,
  saveCharacterToLibrary,
  removeLibraryCharacter,
  updateLibraryFromProject,
  type LibraryCharacter,
} from '@/lib/shortDrama/characterLibrary'

const isTauri = typeof window !== 'undefined' && !!(window as any).__TAURI_INTERNALS__

interface Props {
  open: boolean
  onClose: () => void
  draft: ShortDramaDraftV2
  setDraft: React.Dispatch<React.SetStateAction<ShortDramaDraftV2>>
}

const ANCHOR_LABELS: { key: keyof ShortDramaCharacterAnchors; label: string }[] = [
  { key: 'facialStructure', label: '脸型' },
  { key: 'facialFeatures', label: '五官' },
  { key: 'uniqueMarks', label: '辨识标记' },
  { key: 'colorAnchors', label: '色彩锚点' },
  { key: 'skinTexture', label: '肤质' },
  { key: 'hairStyle', label: '发型' },
]

const ANCHOR_KEY_COLORS: Record<string, string> = {
  facialStructure: 'text-blue-400',
  facialFeatures: 'text-purple-400',
  uniqueMarks: 'text-amber-400',
  colorAnchors: 'text-rose-400',
  skinTexture: 'text-teal-400',
  hairStyle: 'text-orange-400',
}

function nameToGradient(name: string): string {
  let hash = 0
  for (let i = 0; i < name.length; i++) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash)
  }
  const h1 = Math.abs(hash) % 360
  const h2 = (h1 + 40) % 360
  return `linear-gradient(135deg, hsl(${h1}, 55%, 35%), hsl(${h2}, 60%, 25%))`
}

const selectedBorderKeyframes = `
@keyframes selectedPulse {
  0%, 100% { border-color: var(--accent-color); box-shadow: 0 0 0 1px rgba(var(--accent-rgb), 0.15); }
  50% { border-color: var(--accent-color); box-shadow: 0 0 0 3px rgba(var(--accent-rgb), 0.08); }
}
`

export default function ShortDramaCharacterLibraryPanel({ open, onClose, draft, setDraft }: Props) {
  const [characters, setCharacters] = useState<LibraryCharacter[]>([])
  const [query, setQuery] = useState('')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [usageCache, setUsageCache] = useState<Record<string, number>>({})
  const [searchFocused, setSearchFocused] = useState(false)

  const reload = useCallback(async () => {
    const list = query.trim()
      ? await searchCharacterLibrary(query)
      : await listLibraryCharacters()
    setCharacters(list)
  }, [query])

  useEffect(() => {
    if (!open) return
    reload()
    setSelectedId(null)
  }, [open, reload])

  useEffect(() => {
    if (!open) return
    const timer = setTimeout(() => reload(), 300)
    return () => clearTimeout(timer)
  }, [query, open, reload])

  useEffect(() => {
    if (!open || characters.length === 0) return
    let cancelled = false
    const loadStats = async () => {
      const updates: Record<string, number> = {}
      for (const c of characters) {
        if (usageCache[c.id] !== undefined) continue
        const stats = await getCharacterUsageStats(c.id)
        if (cancelled) return
        updates[c.id] = stats.projectCount
      }
      if (!cancelled && Object.keys(updates).length > 0) {
        setUsageCache(prev => ({ ...prev, ...updates }))
      }
    }
    loadStats()
    return () => { cancelled = true }
  }, [open, characters])

  const selected = characters.find(c => c.id === selectedId) || null

  const handleImport = () => {
    if (!selected) return
    setDraft(prev => importCharacterIntoDraft(selected, prev))
    window.$message?.success?.(`已导入角色「${selected.name}」`)
  }

  const handleExport = async () => {
    if (!selected) return
    const json = exportCharacterBundle(selected)
    const data = new TextEncoder().encode(json)

    if (isTauri) {
      try {
        const { save } = await import('@tauri-apps/plugin-dialog')
        const { writeFile } = await import('@tauri-apps/plugin-fs')
        const path = await save({
          defaultPath: `${selected.name}.json`,
          filters: [{ name: 'JSON', extensions: ['json'] }],
        })
        if (path) {
          await writeFile(path, data)
          return
        }
      } catch { /* fall through */ }
    }

    const blob = new Blob([json], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${selected.name}.json`
    a.click()
    URL.revokeObjectURL(url)
  }

  const handleUpdateFromProject = async () => {
    if (!selected) return
    const match = draft.characters.find(c => c.name === selected.name)
    if (!match) {
      window.$message?.warning?.('当前项目中无同名角色')
      return
    }
    await updateLibraryFromProject(match.id, draft)
    window.$message?.success?.('已从项目更新')
    reload()
  }

  const handleDelete = async () => {
    if (!selected) return
    await removeLibraryCharacter(selected.id)
    setSelectedId(null)
    reload()
  }

  const handleFileImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    const text = await file.text()
    const parsed = parseCharacterBundle(text)
    if (!parsed) {
      window.$message?.error?.('无效的角色包文件')
      return
    }
    await saveCharacterToLibrary(
      { id: parsed.id, name: parsed.name, description: parsed.description, sheet: { id: parsed.id, kind: 'image', variants: [] }, refs: [], anchors: parsed.anchors, costumes: parsed.costumes, voice: parsed.voice, tags: parsed.tags },
      draft.projectId,
    )
    window.$message?.success?.(`已导入角色「${parsed.name}」`)
    reload()
    e.target.value = ''
  }

  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/60 backdrop-blur-sm" onClick={onClose}>
      <style>{selectedBorderKeyframes}</style>
      <div
        className="flex w-full max-w-4xl flex-col overflow-hidden rounded-t-xl sm:rounded-xl border border-[var(--border-color)] bg-[var(--bg-primary)] shadow-2xl"
        style={{ maxHeight: '85vh' }}
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-[var(--border-color)] px-5 py-3">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-[var(--text-primary)] pl-2.5 border-l-2 border-[var(--accent-color)]">
            Character Library
          </h3>
          <div className="flex items-center gap-2">
            <label className="cursor-pointer">
              <input type="file" accept=".json" className="hidden" onChange={handleFileImport} />
              <div className="flex items-center gap-1.5 rounded-md border border-[var(--border-color)] px-2.5 py-1 text-[10px] font-medium text-[var(--text-secondary)] transition-all duration-150 hover:bg-[var(--bg-tertiary)] hover:text-[var(--text-primary)] hover:border-[var(--text-secondary)]/30">
                <Upload className="h-3 w-3" />
                导入 JSON
              </div>
            </label>
            <button onClick={onClose} className="rounded p-1 text-[var(--text-secondary)] transition-colors duration-150 hover:bg-[var(--bg-tertiary)] hover:text-[var(--text-primary)]">
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        {/* Search */}
        <div className="border-b border-[var(--border-color)] px-5 py-2.5">
          <div
            className={cn(
              'flex items-center gap-2 rounded-md border bg-[var(--bg-secondary)] px-3 py-1.5 transition-all duration-200',
              searchFocused
                ? 'border-[var(--accent-color)]/50 w-full'
                : 'border-[var(--border-color)] w-[280px]',
            )}
          >
            <Search className="h-3.5 w-3.5 shrink-0 text-[var(--text-secondary)]" />
            <input
              className="w-full bg-transparent text-[11px] text-[var(--text-primary)] outline-none placeholder:text-[var(--text-secondary)]"
              placeholder="搜索角色名、描述、标签..."
              value={query}
              onChange={e => setQuery(e.target.value)}
              onFocus={() => setSearchFocused(true)}
              onBlur={() => setSearchFocused(false)}
            />
          </div>
        </div>

        {/* Grid */}
        <div className="flex-1 overflow-auto p-4">
          {characters.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16">
              <div className="w-16 h-16 rounded-full bg-[var(--bg-secondary)] border border-dashed border-[var(--border-color)] flex items-center justify-center mb-3">
                <UserPlus className="h-6 w-6 text-[var(--text-secondary)] opacity-30" />
              </div>
              <span className="text-[11px] text-[var(--text-secondary)]">
                {query.trim() ? '无匹配角色' : '角色库为空，从项目中收藏角色或导入 JSON'}
              </span>
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-4">
              {characters.map(c => {
                const isSelected = c.id === selectedId
                return (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => setSelectedId(c.id === selectedId ? null : c.id)}
                    className={cn(
                      'group flex flex-col overflow-hidden rounded-md border text-left transition-all duration-150',
                      isSelected
                        ? 'border-[var(--accent-color)]'
                        : 'border-[var(--border-color)] hover:border-[var(--text-secondary)]/30',
                    )}
                    style={isSelected ? { animation: 'selectedPulse 2s ease-in-out infinite' } : undefined}
                  >
                    <div className="relative flex h-28 w-full items-center justify-center overflow-hidden">
                      {c.thumbnailDataUrl ? (
                        <>
                          <img src={c.thumbnailDataUrl} alt={c.name} className="h-full w-full object-cover" />
                          <div className="absolute inset-0 bg-gradient-to-t from-black/50 via-transparent to-transparent" />
                        </>
                      ) : (
                        <div
                          className="h-full w-full flex items-center justify-center"
                          style={{ background: nameToGradient(c.name) }}
                        >
                          <span className="text-2xl font-bold text-white/60">{c.name.charAt(0)}</span>
                        </div>
                      )}
                      {usageCache[c.id] !== undefined && (
                        <span className="absolute right-1.5 top-1.5 rounded-full px-1.5 py-0.5 text-[9px] font-semibold tabular-nums"
                          style={{
                            background: 'linear-gradient(135deg, var(--accent-color), rgba(var(--accent-rgb), 0.7))',
                            color: '#fff',
                          }}
                        >
                          {usageCache[c.id]}
                        </span>
                      )}
                      <div className="absolute bottom-1.5 left-1.5 right-1.5">
                        <div className="truncate text-[11px] font-semibold text-white drop-shadow-sm">{c.name}</div>
                      </div>
                    </div>
                    <div className="p-2 bg-[var(--bg-secondary)]">
                      <div className="truncate text-[9px] text-[var(--text-secondary)] leading-relaxed">{c.description}</div>
                      {c.tags && c.tags.length > 0 && (
                        <div className="mt-1 flex flex-wrap gap-0.5">
                          {c.tags.slice(0, 3).map(t => (
                            <span key={t} className="rounded bg-[var(--bg-primary)] px-1 py-0.5 text-[8px] text-[var(--text-secondary)]">
                              {t}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                  </button>
                )
              })}
            </div>
          )}
        </div>

        {/* Detail panel (slide-up drawer) */}
        <div
          className={cn(
            'border-t border-[var(--border-color)] bg-[var(--bg-secondary)] transition-all duration-200 overflow-hidden',
            selected ? 'max-h-[300px] opacity-100' : 'max-h-0 opacity-0 border-t-0',
          )}
        >
          {selected && (
            <div className="px-5 py-3">
              <div className="flex items-start gap-4 mb-3">
                <div className="min-w-0 flex-1">
                  <div className="text-[12px] font-semibold text-[var(--text-primary)]">{selected.name}</div>
                  <div className="mt-0.5 text-[10px] leading-relaxed text-[var(--text-secondary)] line-clamp-2">{selected.description}</div>
                </div>

                <div className="flex items-center gap-1 flex-shrink-0">
                  <button
                    onClick={handleImport}
                    className="p-1.5 rounded-md bg-[var(--accent-color)]/15 text-[var(--accent-color)] hover:bg-[var(--accent-color)]/25 transition-colors duration-150"
                    title="导入到项目"
                  >
                    <UserPlus className="h-3.5 w-3.5" />
                  </button>
                  <button
                    onClick={handleExport}
                    className="p-1.5 rounded-md bg-[var(--bg-primary)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-primary)]/80 transition-colors duration-150 border border-[var(--border-color)]"
                    title="导出 JSON"
                  >
                    <Download className="h-3.5 w-3.5" />
                  </button>
                  <button
                    onClick={handleUpdateFromProject}
                    className="p-1.5 rounded-md bg-[var(--bg-primary)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-primary)]/80 transition-colors duration-150 border border-[var(--border-color)]"
                    title="从项目更新"
                  >
                    <RefreshCw className="h-3.5 w-3.5" />
                  </button>
                  <button
                    onClick={handleDelete}
                    className="p-1.5 rounded-md bg-[var(--bg-primary)] text-[var(--text-secondary)] hover:text-red-400 hover:bg-red-500/10 transition-colors duration-150 border border-[var(--border-color)]"
                    title="删除"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>

              {selected.anchors && Object.values(selected.anchors).some(Boolean) && (
                <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 sm:grid-cols-3">
                  {ANCHOR_LABELS.map(({ key, label }) => {
                    const val = selected.anchors?.[key]
                    if (!val) return null
                    return (
                      <div key={key} className="flex gap-1.5 text-[10px]">
                        <span className={cn('shrink-0 font-medium', ANCHOR_KEY_COLORS[key] || 'text-[var(--text-secondary)]')}>
                          {label}
                        </span>
                        <span className="truncate text-[var(--text-primary)]">{val}</span>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
