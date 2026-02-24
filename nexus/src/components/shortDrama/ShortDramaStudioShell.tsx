/**
 * ShortDramaStudioShell | 短剧制作工作台（全屏/嵌入通用壳）
 *
 * 目标：
 * - 复用工作台核心逻辑（草稿/偏好 load & debounce save & flush）
 * - 同时支持：全屏页面（/short-drama/:projectId）与旧 Modal 形态
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Film, X, Plus, Trash2, ChevronDown, Copy, Layers } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import ShortDramaStudioAutoView from '@/components/shortDrama/ShortDramaStudioAutoView'
import ShortDramaStudioManualView from '@/components/shortDrama/ShortDramaStudioManualView'
import ShortDramaAssetSidebar from '@/components/shortDrama/ShortDramaAssetSidebar'
import {
  loadShortDramaDraftV2,
  saveShortDramaDraftV2,
  listShortDramaProjects,
  createShortDramaProject,
  deleteShortDramaProject,
  duplicateShortDramaProject,
  createDefaultDraftV2,
  createEmptyEpisode,
  loadDraftAsync,
  saveDraftAsync,
  listProjectsAsync,
  createProjectAsync,
  deleteDraftAsync,
  duplicateProjectAsync,
  type ShortDramaProjectMeta,
} from '@/lib/shortDrama/draftStorage'
import { loadShortDramaPrefs, saveShortDramaPrefs } from '@/lib/shortDrama/uiPrefs'
import { addEpisode, removeEpisode, updateEpisode } from '@/lib/shortDrama/draftOps'
import { syncAssetHistoryFromCanvasNodes } from '@/lib/assets/syncFromCanvas'
import { useGraphStore } from '@/graph/store'
import type { ShortDramaDraftV2 } from '@/lib/shortDrama/types'
import type { ShortDramaStudioPrefsV1 } from '@/lib/shortDrama/uiPrefs'

export type ShortDramaStudioShellCloseVariant = 'icon' | 'button'

interface Props {
  projectId: string
  className?: string
  closeVariant?: ShortDramaStudioShellCloseVariant
  closeLabel?: string
  onRequestClose?: () => void
}

export default function ShortDramaStudioShell({
  projectId,
  className,
  closeVariant = 'icon',
  closeLabel = '关闭',
  onRequestClose,
}: Props) {
  const LAST_PID_KEY = 'nexus-short-drama-last-project-id'

  const initialPid = (() => {
    try {
      const saved = localStorage.getItem(LAST_PID_KEY)
      if (saved && listShortDramaProjects().some(p => p.id === saved)) return saved
    } catch { /* ignore */ }
    return String(projectId || '').trim() || 'default'
  })()

  const [currentProjectId, setCurrentProjectIdRaw] = useState(initialPid)
  const pid = currentProjectId

  const setCurrentProjectId = useCallback((nextId: string) => {
    setCurrentProjectIdRaw(nextId)
    try { localStorage.setItem(LAST_PID_KEY, nextId) } catch { /* ignore */ }
  }, [])

  const [projects, setProjects] = useState<ShortDramaProjectMeta[]>(() => listShortDramaProjects())
  const [projectDropdownOpen, setProjectDropdownOpen] = useState(false)
  const [loading, setLoading] = useState(false)

  const refreshProjects = useCallback(async () => {
    const list = await listProjectsAsync()
    setProjects(list)
  }, [])

  const [draft, setDraft] = useState<ShortDramaDraftV2>(() => loadShortDramaDraftV2(pid))
  const [prefs, setPrefs] = useState<ShortDramaStudioPrefsV1>(() => loadShortDramaPrefs(pid))

  const draftRef = useRef(draft)
  const prefsRef = useRef(prefs)
  draftRef.current = draft
  prefsRef.current = prefs
  const hasWarnedPersistFailRef = useRef(false)
  const initialLoadDoneRef = useRef(true)
  const unmountedRef = useRef(false)
  const pidRef = useRef(pid)
  pidRef.current = pid

  const setDraftSafe = useCallback((next: React.SetStateAction<ShortDramaDraftV2>) => {
    if (typeof next === 'function') {
      const updater = next as (prev: ShortDramaDraftV2) => ShortDramaDraftV2
      const computed = updater(draftRef.current)
      draftRef.current = computed
      setDraft(computed)
    } else {
      draftRef.current = next
      setDraft(next)
    }
    if (unmountedRef.current) {
      saveShortDramaDraftV2(pidRef.current, draftRef.current)
    }
  }, [])

  const setPrefsSafe = useCallback((next: React.SetStateAction<ShortDramaStudioPrefsV1>) => {
    if (typeof next === 'function') {
      const updater = next as (prev: ShortDramaStudioPrefsV1) => ShortDramaStudioPrefsV1
      const computed = updater(prefsRef.current)
      prefsRef.current = computed
      setPrefs(computed)
      return
    }
    prefsRef.current = next
    setPrefs(next)
  }, [])

  const flushNow = useCallback(() => {
    // Sync fallback for unmount safety
    saveShortDramaDraftV2(pid, draftRef.current)
    saveShortDramaPrefs(pid, prefsRef.current)
    // Also fire async save to IDB
    saveDraftAsync(pid, draftRef.current).catch(() => {})
  }, [pid])

  // Load draft & prefs on project change
  const prevPidRef = useRef(pid)
  useEffect(() => {
    if (prevPidRef.current !== pid) {
      prevPidRef.current = pid
      initialLoadDoneRef.current = false
      setLoading(true)
      loadDraftAsync(pid).then((loadedDraft) => {
        const loadedPrefs = loadShortDramaPrefs(pid)
        setDraftSafe(loadedDraft)
        setPrefsSafe(loadedPrefs)
        draftRef.current = loadedDraft
        prefsRef.current = loadedPrefs
        initialLoadDoneRef.current = true
        setLoading(false)
      })
    }
    syncAssetHistoryFromCanvasNodes({ includeDataUrl: true, includeAssetUrl: true })
  }, [pid, setDraftSafe, setPrefsSafe])

  // Initial async migration: fire once on mount to migrate localStorage → IDB
  useEffect(() => {
    loadDraftAsync(pid).then((idbDraft) => {
      if (idbDraft.updatedAt > draftRef.current.updatedAt) {
        setDraftSafe(idbDraft)
      }
    }).catch(() => {})
  }, [])

  // Persist draft (debounced)
  useEffect(() => {
    if (!initialLoadDoneRef.current) return
    const t = window.setTimeout(() => {
      flushNow()
    }, 250)
    return () => window.clearTimeout(t)
  }, [draft, prefs, flushNow])

  // Flush on unmount
  useEffect(() => {
    return () => {
      unmountedRef.current = true
      flushNow()
    }
  }, [flushNow])

  const handleClose = useCallback(() => {
    flushNow()
    ;(async () => {
      try {
        await useGraphStore.getState().saveNow()
      } catch { /* ignore */ }
      onRequestClose?.()
    })()
  }, [flushNow, onRequestClose])

  // 项目管理
  const handleCreateProject = useCallback(async () => {
    flushNow()
    const newId = await createProjectAsync()
    await refreshProjects()
    setCurrentProjectId(newId)
    window.$message?.success?.('已创建新短剧项目')
  }, [flushNow, refreshProjects])

  const handleSwitchProject = useCallback((targetId: string) => {
    if (targetId === pid) return
    flushNow()
    setCurrentProjectId(targetId)
    setProjectDropdownOpen(false)
  }, [pid, flushNow])

  const handleDeleteProject = useCallback(async (targetId: string) => {
    if (targetId === 'default') {
      window.$message?.warning?.('默认项目不能删除')
      return
    }
    if (!window.confirm('确定要删除这个短剧项目吗？此操作不可恢复。')) return

    await deleteDraftAsync(targetId)
    deleteShortDramaProject(targetId)
    await refreshProjects()
    if (targetId === pid) {
      const remaining = await listProjectsAsync()
      setCurrentProjectId(remaining[0]?.id || 'default')
    }
    window.$message?.success?.('已删除短剧项目')
  }, [pid, refreshProjects])

  const handleDuplicateProject = useCallback(async (targetId: string) => {
    flushNow()
    const newId = await duplicateProjectAsync(targetId)
    if (newId) {
      await refreshProjects()
      setCurrentProjectId(newId)
      window.$message?.success?.('已复制短剧项目')
    }
  }, [flushNow, refreshProjects])

  // ---- 集数管理 ----
  const episodes = useMemo(() =>
    [...(draft.episodes || [])].sort((a, b) => a.order - b.order),
    [draft.episodes],
  )
  const currentEpisodeId = prefs.currentEpisodeId && episodes.some(e => e.id === prefs.currentEpisodeId)
    ? prefs.currentEpisodeId
    : (episodes.length > 0 ? episodes[0].id : undefined)

  const handleSelectEpisode = useCallback((epId: string) => {
    setPrefsSafe(prev => ({ ...prev, currentEpisodeId: epId }))
  }, [setPrefsSafe])

  const handleAddEpisode = useCallback(() => {
    const nextOrder = episodes.length
    const ep = createEmptyEpisode(`第${nextOrder + 1}集`, nextOrder)
    setDraftSafe(prev => addEpisode(prev, ep))
    setPrefsSafe(prev => ({ ...prev, currentEpisodeId: ep.id }))
  }, [episodes.length, setDraftSafe, setPrefsSafe])

  const handleDeleteEpisode = useCallback((epId: string) => {
    if (!window.confirm('确定要删除这一集吗？该集的镜头将变为未分配状态。')) return
    setDraftSafe(prev => removeEpisode(prev, epId))
    const remaining = episodes.filter(e => e.id !== epId)
    setPrefsSafe(prev => ({ ...prev, currentEpisodeId: remaining[0]?.id }))
  }, [episodes, setDraftSafe, setPrefsSafe])

  const handleRenameEpisode = useCallback((epId: string, title: string) => {
    setDraftSafe(prev => updateEpisode(prev, epId, { title }))
  }, [setDraftSafe])

  const [renamingEpisodeId, setRenamingEpisodeId] = useState<string | null>(null)
  const [renameValue, setRenameValue] = useState('')

  // 资产库侧边栏
  const [assetSidebarOpen, setAssetSidebarOpen] = useState(!!prefs.assetSidebarOpen)
  const toggleAssetSidebar = useCallback(() => {
    setAssetSidebarOpen(prev => {
      const next = !prev
      setPrefsSafe(p => ({ ...p, assetSidebarOpen: next }))
      return next
    })
  }, [setPrefsSafe])

  // 当前项目信息
  const currentProjectTitle = draft.title || '未命名短剧'

  const mode = prefs.mode
  const setMode = (next: 'auto' | 'manual') => setPrefs((p) => ({ ...p, mode: next }))

  const body = useMemo(() => {
    if (loading) {
      return (
        <div className="flex h-full items-center justify-center text-[var(--text-secondary)]">
          <div className="flex flex-col items-center gap-2">
            <div className="h-6 w-6 animate-spin rounded-full border-2 border-[var(--accent-color)] border-t-transparent" />
            <span className="text-sm">加载中...</span>
          </div>
        </div>
      )
    }
    const viewProps = { projectId: pid, draft, setDraft: setDraftSafe, prefs, setPrefs: setPrefsSafe, currentEpisodeId: currentEpisodeId || null }
    return mode === 'manual' ? <ShortDramaStudioManualView {...viewProps} /> : <ShortDramaStudioAutoView {...viewProps} />
  }, [pid, draft, prefs, mode, loading, currentEpisodeId])

  return (
    <div className={cn('flex h-full min-h-0 w-full flex-col overflow-hidden bg-[var(--bg-secondary)]', className)}>
      {/* Header */}
      <div className="flex items-center justify-between border-b border-[var(--border-color)] px-5 py-3">
        <div className="flex items-center gap-3">
          <Film className="h-5 w-5 text-[var(--accent-color)]" />
          <h2 className="text-lg font-semibold text-[var(--text-primary)]">短剧制作</h2>

          {/* 项目选择器 */}
          <div className="relative ml-2">
            <button
              type="button"
              onClick={() => setProjectDropdownOpen(!projectDropdownOpen)}
              className="flex items-center gap-2 rounded-lg border border-[var(--border-color)] bg-[var(--bg-primary)] px-3 py-1.5 text-sm text-[var(--text-primary)] hover:bg-[var(--bg-secondary)] transition-colors"
            >
              <span className="max-w-[160px] truncate">{currentProjectTitle}</span>
              <ChevronDown className={cn('h-4 w-4 transition-transform', projectDropdownOpen && 'rotate-180')} />
            </button>

            {projectDropdownOpen && (
              <>
                <div className="fixed inset-0 z-40" onClick={() => setProjectDropdownOpen(false)} />
                <div className="absolute left-0 top-full z-50 mt-1 w-72 rounded-lg border border-[var(--border-color)] bg-[var(--bg-primary)] shadow-lg">
                  <div className="border-b border-[var(--border-color)] p-2">
                    <button
                      type="button"
                      onClick={handleCreateProject}
                      className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-sm text-[var(--accent-color)] hover:bg-[var(--bg-secondary)] transition-colors"
                    >
                      <Plus className="h-4 w-4" />
                      新建短剧项目
                    </button>
                  </div>

                  <div className="max-h-64 overflow-y-auto p-2">
                    {projects.length === 0 ? (
                      <div className="px-3 py-4 text-center text-sm text-[var(--text-secondary)]">暂无项目</div>
                    ) : (
                      projects.map((p) => (
                        <div
                          key={p.id}
                          className={cn(
                            'group flex items-center justify-between rounded-md px-3 py-2 text-sm transition-colors',
                            p.id === pid ? 'bg-[var(--accent-color)]/10 text-[var(--accent-color)]' : 'text-[var(--text-primary)] hover:bg-[var(--bg-secondary)]'
                          )}
                        >
                          <button
                            type="button"
                            onClick={() => handleSwitchProject(p.id)}
                            className="flex-1 text-left truncate"
                          >
                            <div className="font-medium truncate">{p.title}</div>
                            <div className="text-xs text-[var(--text-secondary)]">
                              {p.characterCount} 角色 · {p.shotCount} 分镜
                            </div>
                          </button>
                          <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                            <button
                              type="button"
                              onClick={(e) => { e.stopPropagation(); handleDuplicateProject(p.id) }}
                              className="p-1 rounded hover:bg-[var(--bg-primary)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
                              title="复制项目"
                            >
                              <Copy className="h-3.5 w-3.5" />
                            </button>
                            {p.id !== 'default' && (
                              <button
                                type="button"
                                onClick={(e) => { e.stopPropagation(); handleDeleteProject(p.id) }}
                                className="p-1 rounded hover:bg-red-500/10 text-[var(--text-secondary)] hover:text-red-500"
                                title="删除项目"
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                              </button>
                            )}
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              </>
            )}
          </div>
        </div>

        <div className="flex items-center gap-2">
          <Button
            size="sm"
            variant="ghost"
            className={cn('h-8 gap-1.5 px-3', assetSidebarOpen ? 'text-[var(--accent-color)]' : 'text-[var(--text-secondary)]')}
            onClick={toggleAssetSidebar}
          >
            <Layers className="h-4 w-4" />
            素材库
          </Button>
          <div className="flex items-center rounded-lg border border-[var(--border-color)] bg-[var(--bg-primary)] p-1">
            <Button
              size="sm"
              variant="ghost"
              className={cn('h-8 px-3', mode === 'auto' ? 'bg-[var(--bg-secondary)] text-[var(--text-primary)]' : 'text-[var(--text-secondary)]')}
              onClick={() => setMode('auto')}
            >
              自动
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className={cn(
                'h-8 px-3',
                mode === 'manual' ? 'bg-[var(--bg-secondary)] text-[var(--text-primary)]' : 'text-[var(--text-secondary)]'
              )}
              onClick={() => setMode('manual')}
            >
              手动
            </Button>
          </div>

          {onRequestClose ? (
            closeVariant === 'icon' ? (
              <button
                onClick={handleClose}
                className="rounded-full p-1 text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-primary)] hover:text-[var(--text-primary)]"
                type="button"
                aria-label="Close"
              >
                <X className="h-5 w-5" />
              </button>
            ) : (
              <Button variant="secondary" onClick={handleClose}>
                {closeLabel}
              </Button>
            )
          ) : null}
        </div>
      </div>

      {/* Episode tabs */}
      <div className="flex items-center gap-1 border-b border-[var(--border-color)] px-5 py-1.5 overflow-x-auto shrink-0">
        {episodes.map((ep) => (
          <div key={ep.id} className="flex items-center shrink-0">
            {renamingEpisodeId === ep.id ? (
              <input
                autoFocus
                className="h-7 w-24 rounded border border-[var(--accent-color)] bg-[var(--bg-primary)] px-2 text-xs text-[var(--text-primary)] outline-none"
                value={renameValue}
                onChange={(e) => setRenameValue(e.target.value)}
                onBlur={() => {
                  if (renameValue.trim()) handleRenameEpisode(ep.id, renameValue.trim())
                  setRenamingEpisodeId(null)
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    if (renameValue.trim()) handleRenameEpisode(ep.id, renameValue.trim())
                    setRenamingEpisodeId(null)
                  } else if (e.key === 'Escape') {
                    setRenamingEpisodeId(null)
                  }
                }}
              />
            ) : (
              <button
                type="button"
                className={cn(
                  'group relative flex items-center gap-1 rounded-md px-3 py-1 text-xs transition-colors',
                  currentEpisodeId === ep.id
                    ? 'bg-[var(--accent-color)]/10 text-[var(--accent-color)] font-medium'
                    : 'text-[var(--text-secondary)] hover:bg-[var(--bg-primary)] hover:text-[var(--text-primary)]',
                )}
                onClick={() => handleSelectEpisode(ep.id)}
                onDoubleClick={() => {
                  setRenamingEpisodeId(ep.id)
                  setRenameValue(ep.title)
                }}
              >
                <span className="max-w-[120px] truncate">{ep.title}</span>
                <span
                  className="ml-0.5 opacity-0 group-hover:opacity-100 transition-opacity hover:text-red-500"
                  onClick={(e) => { e.stopPropagation(); handleDeleteEpisode(ep.id) }}
                >
                  <X className="h-3 w-3" />
                </span>
              </button>
            )}
          </div>
        ))}
        <button
          type="button"
          onClick={handleAddEpisode}
          className="flex shrink-0 items-center gap-1 rounded-md px-2 py-1 text-xs text-[var(--text-secondary)] hover:bg-[var(--bg-primary)] hover:text-[var(--accent-color)] transition-colors"
        >
          <Plus className="h-3 w-3" />
          新增集
        </button>
      </div>

      {/* Body */}
      <div className="flex flex-1 min-h-0 overflow-hidden">
        <div className="flex-1 min-h-0 overflow-hidden p-4">
          <div className="h-full min-h-0">{body}</div>
        </div>
        {assetSidebarOpen && (
          <ShortDramaAssetSidebar
            open={assetSidebarOpen}
            onClose={() => { setAssetSidebarOpen(false); setPrefsSafe(p => ({ ...p, assetSidebarOpen: false })) }}
            draft={draft}
            setDraft={setDraftSafe}
            currentEpisodeId={currentEpisodeId}
          />
        )}
      </div>
    </div>
  )
}
