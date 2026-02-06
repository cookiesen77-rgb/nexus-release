/**
 * ShortDramaStudioShell | 短剧制作工作台（全屏/嵌入通用壳）
 *
 * 目标：
 * - 复用工作台核心逻辑（草稿/偏好 load & debounce save & flush）
 * - 同时支持：全屏页面（/short-drama/:projectId）与旧 Modal 形态
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Film, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import ShortDramaStudioAutoView from '@/components/shortDrama/ShortDramaStudioAutoView'
import ShortDramaStudioManualView from '@/components/shortDrama/ShortDramaStudioManualView'
import { loadShortDramaDraftV2, saveShortDramaDraftV2 } from '@/lib/shortDrama/draftStorage'
import { loadShortDramaPrefs, saveShortDramaPrefs } from '@/lib/shortDrama/uiPrefs'
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
  const pid = String(projectId || '').trim() || 'default'

  // 直接从 localStorage 加载作为初始值，避免先渲染空草稿再覆盖
  const [draft, setDraft] = useState<ShortDramaDraftV2>(() => loadShortDramaDraftV2(pid))
  const [prefs, setPrefs] = useState<ShortDramaStudioPrefsV1>(() => loadShortDramaPrefs(pid))

  const draftRef = useRef(draft)
  const prefsRef = useRef(prefs)
  draftRef.current = draft
  prefsRef.current = prefs
  const hasWarnedPersistFailRef = useRef(false)
  // 标记是否完成初始加载，防止在加载完成前保存空数据
  const initialLoadDoneRef = useRef(true)

  /**
   * setState 的更新可能在路由切换/卸载前还未 commit，
   * 此时 unmount flush 会读到旧 draftRef，导致“返回画布后再进工作台内容回滚”。
   * 这里提供一个“同步更新 ref + state”的 setter，保证 flushNow 总能拿到最新草稿。
   */
  const setDraftSafe = useCallback((next: React.SetStateAction<ShortDramaDraftV2>) => {
    if (typeof next === 'function') {
      const updater = next as (prev: ShortDramaDraftV2) => ShortDramaDraftV2
      const computed = updater(draftRef.current)
      draftRef.current = computed
      setDraft(computed)
      return
    }
    draftRef.current = next
    setDraft(next)
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
    try {
      const ok = saveShortDramaDraftV2(pid, draftRef.current)
      if (!ok && !hasWarnedPersistFailRef.current) {
        hasWarnedPersistFailRef.current = true
        console.error('[ShortDramaStudioShell] 草稿保存失败（可能是 localStorage 空间不足）')
        try {
          window.$message?.error?.('短剧草稿保存失败：可能是本地存储空间不足（请减少大图/清理缓存/更换浏览器环境后重试）')
        } catch {
          // ignore
        }
      }
    } catch {
      // ignore
    }
    try {
      const ok = saveShortDramaPrefs(pid, prefsRef.current)
      if (!ok && !hasWarnedPersistFailRef.current) {
        hasWarnedPersistFailRef.current = true
        console.error('[ShortDramaStudioShell] 偏好保存失败（可能是 localStorage 空间不足）')
      }
    } catch {
      // ignore
    }
  }, [pid])

  // Load draft & prefs on project change (initial load is handled by useState initializer)
  const prevPidRef = useRef(pid)
  useEffect(() => {
    // 仅在 projectId 变化时重新加载（首次挂载已通过 useState 初始化）
    if (prevPidRef.current !== pid) {
      prevPidRef.current = pid
      initialLoadDoneRef.current = false
      const loadedDraft = loadShortDramaDraftV2(pid)
      const loadedPrefs = loadShortDramaPrefs(pid)
      setDraftSafe(loadedDraft)
      setPrefsSafe(loadedPrefs)
      // 确保 ref 也同步更新
      draftRef.current = loadedDraft
      prefsRef.current = loadedPrefs
      initialLoadDoneRef.current = true
    }
    // 把画布中已有素材补进历史（单向补齐，不会破坏历史）
    syncAssetHistoryFromCanvasNodes({ includeDataUrl: true, includeAssetUrl: true })
  }, [pid, setDraftSafe, setPrefsSafe])

  // Persist draft (debounced) - 只在初始加载完成后才保存
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
      flushNow()
    }
  }, [flushNow])

  const handleClose = useCallback(() => {
    flushNow()
    // 同步保存画布，避免“从短剧回到画布时新增节点丢失”（画布可能在路由切换时触发 hydrate 覆盖未落盘的变更）
    ;(async () => {
      try {
        await useGraphStore.getState().saveNow()
      } catch {
        // ignore
      }
      onRequestClose?.()
    })()
  }, [flushNow, onRequestClose])

  const mode = prefs.mode
  const setMode = (next: 'auto' | 'manual') => setPrefs((p) => ({ ...p, mode: next }))

  const body = useMemo(() => {
    const viewProps = { projectId: pid, draft, setDraft: setDraftSafe, prefs, setPrefs: setPrefsSafe }
    return mode === 'manual' ? <ShortDramaStudioManualView {...viewProps} /> : <ShortDramaStudioAutoView {...viewProps} />
  }, [pid, draft, prefs, mode])

  return (
    <div className={cn('flex h-full min-h-0 w-full flex-col overflow-hidden bg-[var(--bg-secondary)]', className)}>
      {/* Header */}
      <div className="flex items-center justify-between border-b border-[var(--border-color)] px-5 py-4">
        <div className="flex items-center gap-3">
          <Film className="h-5 w-5 text-[var(--accent-color)]" />
          <h2 className="text-lg font-semibold text-[var(--text-primary)]">短剧制作</h2>
        </div>

        <div className="flex items-center gap-2">
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

      {/* Body */}
      <div className="flex-1 min-h-0 overflow-hidden p-4">
        <div className="h-full min-h-0">{body}</div>
      </div>
    </div>
  )
}

