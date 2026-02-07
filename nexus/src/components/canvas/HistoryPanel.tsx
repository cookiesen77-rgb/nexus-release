/**
 * History Panel | 历史素材面板
 * 显示已生成的图片/视频/音频历史记录
 */

import React, { useState, useMemo, useEffect, useCallback } from 'react'
import { cn } from '@/lib/utils'
import {
  useAssetsStore,
  getAssetThumbnail,
  getLocalCacheUrl,
  enqueueThumbnails,
  enqueueLocalCache,
  type Asset,
  type AssetType,
  type HistoryPerformanceMode
} from '@/store/assets'
import { syncAssetHistoryFromCanvasNodes } from '@/lib/assets/syncFromCanvas'
import { downloadFile } from '@/lib/download'
import HistoryExportPdfModal, { type ExportPdfImageItem } from '@/components/canvas/HistoryExportPdfModal'
import {
  X,
  Image as ImageIcon,
  Video,
  Music,
  Trash2,
  Check,
  Pencil
} from 'lucide-react'

interface Props {
  onClose: () => void
  onAddToCanvas: (asset: Asset) => void
}

type TabId = 'image' | 'video' | 'audio'

export default function HistoryPanel({ onClose, onAddToCanvas }: Props) {
  const [activeTab, setActiveTab] = useState<TabId>('image')
  const [visibleCount, setVisibleCount] = useState(40)
  const [localCacheFailures, setLocalCacheFailures] = useState<Set<string>>(new Set())
  const [selectionMode, setSelectionMode] = useState(false)
  const [selectedIds, setSelectedIds] = useState<Record<string, boolean>>({})
  const [batchBusy, setBatchBusy] = useState(false)
  const [batchProgress, setBatchProgress] = useState<{ done: number; total: number }>({ done: 0, total: 0 })
  const [renameOpen, setRenameOpen] = useState(false)
  const [renameId, setRenameId] = useState<string>('')
  const [renameValue, setRenameValue] = useState<string>('')
  const [pdfOpen, setPdfOpen] = useState(false)
  const [pdfItems, setPdfItems] = useState<ExportPdfImageItem[]>([])

  const assets = useAssetsStore((s) => s.assets)
  const historyPerformanceMode = useAssetsStore((s) => s.historyPerformanceMode)
  const localCacheEnabled = useAssetsStore((s) => s.localCacheEnabled)
  const setHistoryPerformanceMode = useAssetsStore((s) => s.setHistoryPerformanceMode)
  const removeAsset = useAssetsStore((s) => s.removeAsset)
  const updateAsset = useAssetsStore((s) => s.updateAsset)

  // One-way: sync current canvas nodes into history
  useEffect(() => {
    syncAssetHistoryFromCanvasNodes({ includeDataUrl: true, includeAssetUrl: true })
  }, [])

  // Filtered assets by type
  const filteredAssets = useMemo(() => {
    return assets.filter((a) => a.type === activeTab)
  }, [assets, activeTab])

  // Visible assets (virtualization)
  const visibleAssets = useMemo(() => {
    return filteredAssets.slice(0, visibleCount)
  }, [filteredAssets, visibleCount])

  // Can load more
  const canLoadMore = filteredAssets.length > visibleCount

  // Reset visible count when tab changes
  useEffect(() => {
    setVisibleCount(40)
    // 切换 tab 时退出选择模式，避免误操作
    setSelectionMode(false)
    setSelectedIds({})
    setPdfOpen(false)
    setPdfItems([])
  }, [activeTab])

  const toggleSelected = useCallback((id: string) => {
    if (!id) return
    setSelectedIds((prev) => ({ ...prev, [id]: !prev[id] }))
  }, [])

  const selectedCount = useMemo(() => Object.values(selectedIds).filter(Boolean).length, [selectedIds])
  const selectedAssets = useMemo(() => filteredAssets.filter((a) => !!selectedIds[a.id]), [filteredAssets, selectedIds])

  const sanitizeFilenameBase = (name: string) => {
    let s = String(name || '').replace(/[\u0000-\u001F]/g, '').replace(/[\\/:*?"<>|]/g, '_')
    s = s.replace(/\s+/g, ' ').trim()
    s = s.replace(/[. ]+$/g, '').trim()
    return s.slice(0, 80)
  }

  const inferExtFromUrl = (src: string, type: AssetType) => {
    const s = String(src || '').trim()
    if (s.startsWith('data:')) {
      const m = s.slice(5, 64)
      const mime = m.split(';')[0]
      if (mime === 'image/jpeg') return 'jpg'
      if (mime === 'image/png') return 'png'
      if (mime === 'image/webp') return 'webp'
      if (mime === 'image/gif') return 'gif'
      if (mime === 'video/mp4') return 'mp4'
      if (mime === 'video/webm') return 'webm'
      if (mime === 'audio/mpeg') return 'mp3'
      if (mime === 'audio/mp3') return 'mp3'
      if (mime === 'audio/wav') return 'wav'
    }
    try {
      const u = new URL(s, 'http://localhost')
      const p = u.pathname || ''
      const ext = p.split('.').pop() || ''
      const ok = /^[a-z0-9]{2,5}$/i.test(ext) ? ext.toLowerCase() : ''
      if (ok) return ok
    } catch {
      // ignore
    }
    return type === 'image' ? 'png' : type === 'video' ? 'mp4' : 'mp3'
  }

  const buildUniqueFilenames = (items: Asset[]) => {
    const used = new Map<string, number>()
    const out = new Map<string, string>()
    for (const a of items) {
      const ext = inferExtFromUrl(a.src, a.type)
      const base0 = sanitizeFilenameBase(String(a.title || '').trim() || (a.type === 'video' ? '视频' : a.type === 'audio' ? '音频' : '图片')) || 'asset'
      const key = `${base0.toLowerCase()}.${ext.toLowerCase()}`
      const n = (used.get(key) || 0) + 1
      used.set(key, n)
      const base = n === 1 ? base0 : `${base0}-${n}`
      out.set(a.id, `${base}.${ext}`)
    }
    return out
  }

  const doBatchDownload = useCallback(async () => {
    if (batchBusy) return
    if (selectedAssets.length === 0) return
    setBatchBusy(true)
    setBatchProgress({ done: 0, total: selectedAssets.length })
    try {
      const filenameMap = buildUniqueFilenames(selectedAssets)
      let done = 0
      for (const a of selectedAssets) {
        const url = String((a.localCacheUrl || a.src) || '').trim()
        if (url) {
          const filename = filenameMap.get(a.id) || `${sanitizeFilenameBase(String(a.title || '').trim() || 'asset') || 'asset'}.${inferExtFromUrl(url, a.type)}`
          await downloadFile({ url, filename })
        }
        done += 1
        setBatchProgress({ done, total: selectedAssets.length })
      }
    } finally {
      setBatchBusy(false)
      setBatchProgress({ done: 0, total: 0 })
    }
  }, [batchBusy, selectedAssets])

  // Enqueue thumbnails and local cache
  useEffect(() => {
    enqueueThumbnails(filteredAssets, historyPerformanceMode)
    enqueueLocalCache(filteredAssets)
  }, [filteredAssets, historyPerformanceMode, localCacheEnabled])

  // Reset failures when local cache is enabled
  useEffect(() => {
    if (localCacheEnabled) {
      setLocalCacheFailures(new Set())
    }
  }, [localCacheEnabled])

  const loadMore = useCallback(() => {
    setVisibleCount((prev) => Math.min(filteredAssets.length, prev + 40))
  }, [filteredAssets.length])

  const getDisplaySrc = useCallback(
    (asset: Asset): string => {
      if (!asset) return ''

      // Try local cache first
      if (!localCacheFailures.has(asset.id)) {
        const localUrl = getLocalCacheUrl(asset)
        if (localUrl) return localUrl
      }

      // Try thumbnail
      if (historyPerformanceMode !== 'off' && asset.type === 'image') {
        const thumb = getAssetThumbnail(asset, historyPerformanceMode)
        if (thumb) return thumb
      }

      return asset.src
    },
    [historyPerformanceMode, localCacheFailures]
  )

  const handleMediaError = useCallback((asset: Asset) => {
    if (!asset) return
    setLocalCacheFailures((prev) => {
      const next = new Set(prev)
      next.add(asset.id)
      return next
    })
  }, [])

  const handleDragStart = useCallback((e: React.DragEvent, asset: Asset) => {
    e.dataTransfer.setData(
      'application/json',
      JSON.stringify({
        type: asset.type,
        src: asset.src,
        title: asset.title,
        model: asset.model,
        duration: asset.duration
      })
    )
    e.dataTransfer.effectAllowed = 'copy'
  }, [])

  const handleDelete = useCallback(
    (id: string) => {
      removeAsset(id)
    },
    [removeAsset]
  )

  const tabs: Array<{ id: TabId; label: string; icon: React.ReactNode }> = [
    { id: 'image', label: '图片', icon: <ImageIcon className="h-3.5 w-3.5" /> },
    { id: 'video', label: '视频', icon: <Video className="h-3.5 w-3.5" /> },
    { id: 'audio', label: '音频', icon: <Music className="h-3.5 w-3.5" /> }
  ]

  const performanceModes: Array<{ value: HistoryPerformanceMode; label: string }> = [
    { value: 'ultra', label: '极速' },
    { value: 'normal', label: '普通' },
    { value: 'off', label: '关闭' }
  ]

  return (
    <div className="flex h-full w-[300px] flex-col border-l border-[var(--border-color)] bg-[var(--bg-secondary)]">
      {/* Header */}
      <div className="border-b border-[var(--border-color)] p-3">
        <div className="mb-3 flex items-center justify-between">
          <span className="text-sm font-medium text-[var(--text-primary)]">历史素材</span>
          <div className="flex items-center gap-2">
            {/* Performance mode toggle */}
            <div className="flex items-center gap-1 rounded-lg border border-[var(--border-color)] bg-[var(--bg-primary)] p-1 text-[11px]">
              {performanceModes.map((mode) => (
                <button
                  key={mode.value}
                  onClick={() => setHistoryPerformanceMode(mode.value)}
                  className={cn(
                    'rounded-md px-2 py-1 transition-colors',
                    historyPerformanceMode === mode.value
                      ? 'bg-[var(--bg-tertiary)] text-[var(--text-primary)]'
                      : 'text-[var(--text-secondary)]'
                  )}
                >
                  {mode.label}
                </button>
              ))}
            </div>
            <button
              onClick={() => {
                setSelectionMode((v) => {
                  const next = !v
                  if (!next) {
                    setSelectedIds({})
                    setPdfOpen(false)
                    setPdfItems([])
                  }
                  return next
                })
              }}
              className={cn(
                'rounded px-2 py-1 text-[11px] transition-colors',
                selectionMode
                  ? 'bg-[var(--bg-tertiary)] text-[var(--text-primary)]'
                  : 'text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)] hover:text-[var(--text-primary)]'
              )}
              title={selectionMode ? '退出选择模式' : '进入选择模式'}
            >
              {selectionMode ? `完成${selectedCount ? `(${selectedCount})` : ''}` : '选择'}
            </button>
            <button
              onClick={onClose}
              className="rounded p-1 transition-colors hover:bg-[var(--bg-tertiary)]"
            >
              <X className="h-4 w-4 text-[var(--text-secondary)]" />
            </button>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex rounded-lg border border-[var(--border-color)] bg-[var(--bg-primary)] p-1">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={cn(
                'flex flex-1 items-center justify-center gap-2 rounded-md py-2 text-xs font-medium transition-colors',
                activeTab === tab.id
                  ? 'bg-[var(--bg-tertiary)] text-[var(--text-primary)]'
                  : 'text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)] hover:text-[var(--text-primary)]'
              )}
            >
              {tab.icon}
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-3">
        {filteredAssets.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-14 text-[var(--text-secondary)]">
            {activeTab === 'image' && <ImageIcon className="h-11 w-11 opacity-60" />}
            {activeTab === 'video' && <Video className="h-11 w-11 opacity-60" />}
            {activeTab === 'audio' && <Music className="h-11 w-11 opacity-60" />}
            <div className="mt-3 text-xs font-medium">
              暂无{activeTab === 'image' ? '图片' : activeTab === 'video' ? '视频' : '音频'}
            </div>
            <div className="mt-1 text-[11px] opacity-70">生成后会自动出现在这里</div>
          </div>
        ) : activeTab === 'audio' ? (
          // Audio list
          <div className="space-y-3">
            {visibleAssets.map((asset) => (
              <div
                key={asset.id}
                className="group cursor-grab rounded-xl border border-[var(--border-color)] bg-[var(--bg-primary)] p-3 transition-colors hover:border-[var(--accent-color)] active:cursor-grabbing"
                draggable={!selectionMode}
                onDragStart={(e) => (!selectionMode ? handleDragStart(e, asset) : undefined)}
                onClick={() => (selectionMode ? toggleSelected(asset.id) : undefined)}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex min-w-0 items-center gap-2">
                    <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-[var(--bg-tertiary)]">
                      <Music className="h-5 w-5" />
                    </div>
                    <div className="min-w-0">
                      <div className="truncate text-sm font-medium">{asset.title || '音频'}</div>
                      <div className="truncate text-[11px] text-[var(--text-secondary)]">
                        {asset.model || 'Suno'}
                      </div>
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <button
                      className="rounded-md border border-[var(--border-color)] px-2 py-1 text-[11px] transition-colors hover:border-[var(--accent-color)]"
                      onClick={(e) => {
                        e.stopPropagation()
                        onAddToCanvas(asset)
                      }}
                    >
                      上板
                    </button>
                    <button
                      className="rounded-md border border-[var(--border-color)] px-2 py-1 text-[11px] text-[var(--text-secondary)] transition-colors hover:border-[var(--accent-color)] hover:text-[var(--text-primary)]"
                      title="改名"
                      onClick={(e) => {
                        e.stopPropagation()
                        setRenameId(asset.id)
                        setRenameValue(String(asset.title || '').trim())
                        setRenameOpen(true)
                      }}
                    >
                      <Pencil className="h-3.5 w-3.5" />
                    </button>
                    <button
                      className="rounded-md bg-[var(--bg-tertiary)] p-1.5 text-[var(--text-secondary)] transition-colors hover:bg-red-500/20 hover:text-red-500"
                      title="删除"
                      onClick={(e) => {
                        e.stopPropagation()
                        handleDelete(asset.id)
                      }}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>
                <audio src={asset.src} controls className="mt-2 w-full" onClick={(e) => e.stopPropagation()} />
              </div>
            ))}
          </div>
        ) : (
          // Image/Video grid
          <div className="grid grid-cols-2 gap-3">
            {visibleAssets.map((asset) => (
              <div
                key={asset.id}
                className="group relative aspect-square cursor-grab overflow-hidden rounded-xl border border-[var(--border-color)] bg-[var(--bg-primary)] transition-colors hover:border-[var(--accent-color)] active:cursor-grabbing"
                draggable={!selectionMode}
                onDragStart={(e) => (!selectionMode ? handleDragStart(e, asset) : undefined)}
                onClick={() => (selectionMode ? toggleSelected(asset.id) : onAddToCanvas(asset))}
              >
                {asset.type === 'image' ? (
                  <img
                    src={getDisplaySrc(asset)}
                    alt={asset.title || '历史图片'}
                    className="h-full w-full object-cover"
                    loading="lazy"
                    decoding="async"
                    draggable={false}
                    onError={() => handleMediaError(asset)}
                  />
                ) : (
                  <video
                    src={getDisplaySrc(asset)}
                    className="h-full w-full object-cover"
                    muted
                    loop
                    playsInline
                    preload="metadata"
                    onMouseEnter={(e) => (e.target as HTMLVideoElement).play()}
                    onMouseLeave={(e) => (e.target as HTMLVideoElement).pause()}
                    onError={() => handleMediaError(asset)}
                  />
                )}

                {/* Top controls */}
                {selectionMode ? (
                  <div
                    className={cn(
                      'absolute left-2 top-2 flex h-5 w-5 items-center justify-center rounded-full border-2 transition-colors',
                      selectedIds[asset.id] ? 'border-[var(--accent-color)] bg-[var(--accent-color)]' : 'border-white/70 bg-black/30'
                    )}
                  >
                    {selectedIds[asset.id] ? <Check className="h-3 w-3 text-white" /> : null}
                  </div>
                ) : null}
                <div className="absolute right-2 top-2 flex items-center gap-1.5 opacity-0 transition-opacity group-hover:opacity-100">
                  <button
                    className="rounded-lg bg-black/40 p-1.5 text-white hover:bg-black/60"
                    title="改名"
                    onClick={(e) => {
                      e.stopPropagation()
                      setRenameId(asset.id)
                      setRenameValue(String(asset.title || '').trim())
                      setRenameOpen(true)
                    }}
                  >
                    <Pencil className="h-3.5 w-3.5" />
                  </button>
                  <button
                    className="rounded-lg bg-black/40 p-1.5 text-white hover:bg-black/60"
                    title="删除"
                    onClick={(e) => {
                      e.stopPropagation()
                      handleDelete(asset.id)
                    }}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>

                {/* Title overlay */}
                <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/60 to-transparent p-2">
                  <div className="overflow-hidden text-ellipsis whitespace-nowrap text-[11px] text-white/90">
                    {asset.title || (asset.type === 'video' ? '视频' : '图片')}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Load more button */}
        {canLoadMore && (
          <div className="mt-4 flex justify-center">
            <button
              className="rounded-lg border border-[var(--border-color)] px-3 py-1.5 text-xs transition-colors hover:border-[var(--accent-color)]"
              onClick={loadMore}
            >
              加载更多
            </button>
          </div>
        )}
      </div>

      {/* Selection footer */}
      {selectionMode ? (
        <div className="border-t border-[var(--border-color)] p-3">
          <div className="text-xs text-[var(--text-secondary)]">
            已选 {selectedCount} 项{batchBusy && batchProgress.total > 0 ? ` · 下载中 ${batchProgress.done}/${batchProgress.total}` : ''}
          </div>
          <div className="mt-2 grid grid-cols-2 gap-2">
            <button
              className={cn(
                'rounded-lg border px-3 py-2 text-xs font-medium transition-colors',
                selectedCount === 0 || batchBusy
                  ? 'border-[var(--border-color)] text-[var(--text-secondary)] opacity-60'
                  : 'border-[var(--accent-color)] text-[var(--accent-color)] hover:bg-[rgb(var(--accent-rgb)/0.10)]'
              )}
              disabled={selectedCount === 0 || batchBusy}
              onClick={() => void doBatchDownload()}
            >
              批量下载
            </button>
            <button
              className={cn(
                'rounded-lg border px-3 py-2 text-xs font-medium transition-colors',
                activeTab !== 'image' || selectedCount === 0
                  ? 'border-[var(--border-color)] text-[var(--text-secondary)] opacity-60'
                  : 'border-[var(--border-color)] text-[var(--text-primary)] hover:border-[var(--accent-color)]'
              )}
              disabled={activeTab !== 'image' || selectedCount === 0}
              onClick={() => {
                const imgs = selectedAssets.filter((a) => a.type === 'image')
                const list: ExportPdfImageItem[] = imgs.map((a) => ({
                  id: a.id,
                  src: String((a.localCacheUrl || a.src) || ''),
                  previewSrc: getDisplaySrc(a),
                  title: a.title || '图片',
                }))
                setPdfItems(list)
                setPdfOpen(true)
              }}
              title="仅支持图片导出"
            >
              导出 PDF
            </button>
          </div>
          <div className="mt-2 text-[11px] text-[var(--text-secondary)]">提示：在“改名”后，批量下载会使用该名称作为真实文件名。</div>
        </div>
      ) : null}

      {/* Rename modal */}
      {renameOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm" onClick={(e) => e.target === e.currentTarget && setRenameOpen(false)}>
          <div
            className="w-[520px] max-w-[95vw] overflow-hidden rounded-2xl border border-[var(--border-color)] bg-[var(--bg-secondary)] shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-[var(--border-color)] px-5 py-4">
              <div className="text-sm font-semibold text-[var(--text-primary)]">编辑文件名（备注）</div>
              <button
                onClick={() => setRenameOpen(false)}
                className="rounded-full p-1 text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-primary)] hover:text-[var(--text-primary)]"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="p-5">
              <div className="text-xs text-[var(--text-secondary)]">该名称会用于批量下载/导出时的真实文件名（会自动清理非法字符与去重）。</div>
              <input
                value={renameValue}
                onChange={(e) => setRenameValue(e.target.value)}
                className="mt-3 w-full rounded-lg border border-[var(--border-color)] bg-[var(--bg-primary)] px-3 py-2 text-sm text-[var(--text-primary)] focus:border-[var(--accent-color)] focus:outline-none"
                placeholder="例如：镜头1-首帧-女主"
              />
              <div className="mt-4 flex items-center justify-end gap-2">
                <button className="rounded-lg border border-[var(--border-color)] px-3 py-2 text-sm" onClick={() => setRenameOpen(false)}>
                  取消
                </button>
                <button
                  className="rounded-lg bg-[var(--accent-color)] px-3 py-2 text-sm font-medium text-white"
                  onClick={() => {
                    const next = String(renameValue || '').trim()
                    if (renameId) updateAsset(renameId, { title: next })
                    setRenameOpen(false)
                    setRenameId('')
                  }}
                >
                  保存
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}

      <HistoryExportPdfModal
        open={pdfOpen}
        items={pdfItems}
        onClose={() => {
          setPdfOpen(false)
          setPdfItems([])
        }}
      />
    </div>
  )
}
