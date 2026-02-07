/**
 * Download Modal | 批量下载弹窗
 * 批量下载画布上的图片/视频资源
 */

import React, { useState, useMemo, useCallback } from 'react'
import { downloadFile } from '@/lib/download'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import HistoryExportPdfModal, { type ExportPdfImageItem } from '@/components/canvas/HistoryExportPdfModal'
import {
  X,
  Download,
  Check,
  Image as ImageIcon,
  Video,
  Music,
  Loader2,
  FolderDown
} from 'lucide-react'
import type { GraphNode } from '@/graph/types'
import { useGraphStore } from '@/graph/store'

interface Props {
  open: boolean
  onClose: () => void
  nodes?: GraphNode[]  // 可选，如果不传则从 store 获取
}

type AssetType = 'image' | 'video' | 'audio'

interface DownloadItem {
  id: string
  type: AssetType
  src: string
  title?: string
  remark?: string
  selected: boolean
}

const trimStr = (v: unknown) => (typeof v === 'string' ? v.trim() : v == null ? '' : String(v).trim())

const sanitizeFilenameBase = (name: string) => {
  // Windows illegal: \ / : * ? " < > |  + control chars
  let s = String(name || '').replace(/[\u0000-\u001F]/g, '').replace(/[\\/:*?"<>|]/g, '_')
  s = s.replace(/\s+/g, ' ').trim()
  // Windows: no trailing dot or space
  s = s.replace(/[. ]+$/g, '').trim()
  if (!s) return ''
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

const pickBaseName = (item: DownloadItem) => {
  const remark = trimStr(item.remark)
  if (remark) return remark
  const title = trimStr(item.title)
  if (title) return title
  return item.type === 'image' ? `Image_${item.id}` : item.type === 'video' ? `Video_${item.id}` : `Audio_${item.id}`
}

const buildUniqueFilenames = (items: DownloadItem[]) => {
  const used = new Map<string, number>()
  const out = new Map<string, string>()
  for (const item of items) {
    const ext = inferExtFromUrl(item.src, item.type)
    const base0 = sanitizeFilenameBase(pickBaseName(item)) || (item.type === 'image' ? 'image' : item.type === 'video' ? 'video' : 'audio')
    const key = `${base0.toLowerCase()}.${ext.toLowerCase()}`
    const n = (used.get(key) || 0) + 1
    used.set(key, n)
    const base = n === 1 ? base0 : `${base0}-${n}`
    out.set(item.id, `${base}.${ext}`)
  }
  return out
}

export default function DownloadModal({ open, onClose, nodes: propNodes }: Props) {
  // 从 store 获取响应式 nodes，如果传入了 propNodes 则使用传入的
  const storeNodes = useGraphStore((state) => state.nodes)
  const nodes = propNodes ?? storeNodes
  
  const [selectedTypes, setSelectedTypes] = useState<Set<AssetType>>(new Set(['image', 'video', 'audio']))
  const [isDownloading, setIsDownloading] = useState(false)
  const [downloadProgress, setDownloadProgress] = useState(0)
  const [selectedItems, setSelectedItems] = useState<Set<string>>(new Set())
  const [selectAll, setSelectAll] = useState(true)
  const [pdfOpen, setPdfOpen] = useState(false)
  const [pdfItems, setPdfItems] = useState<ExportPdfImageItem[]>([])

  // Extract downloadable items from nodes
  // 支持 url 和 src 两种字段名（不同来源的节点可能使用不同字段）
  const downloadableItems = useMemo(() => {
    const items: DownloadItem[] = []

    nodes.forEach((node) => {
      const d: any = node.data || {}
      const url = d?.url || d?.src
      const remark = trimStr(d?.remark)
      if (node.type === 'image' && url) {
        items.push({
          id: node.id,
          type: 'image',
          src: url,
          title: d?.title || d?.label || `Image_${node.id}`,
          remark: remark || undefined,
          selected: true
        })
      } else if (node.type === 'video' && url) {
        items.push({
          id: node.id,
          type: 'video',
          src: url,
          title: d?.title || d?.label || `Video_${node.id}`,
          remark: remark || undefined,
          selected: true
        })
      } else if (node.type === 'audio' && url) {
        items.push({
          id: node.id,
          type: 'audio',
          src: url,
          title: d?.title || d?.label || `Audio_${node.id}`,
          remark: remark || undefined,
          selected: true
        })
      }
    })

    return items
  }, [nodes])

  // Filtered items based on selected types
  const filteredItems = useMemo(() => {
    return downloadableItems.filter((item) => selectedTypes.has(item.type))
  }, [downloadableItems, selectedTypes])

  // Update selected items when filter changes
  React.useEffect(() => {
    if (selectAll) {
      setSelectedItems(new Set(filteredItems.map((item) => item.id)))
    }
  }, [filteredItems, selectAll])

  const toggleType = (type: AssetType) => {
    setSelectedTypes((prev) => {
      const next = new Set(prev)
      if (next.has(type)) {
        next.delete(type)
      } else {
        next.add(type)
      }
      return next
    })
  }

  const toggleItem = (id: string) => {
    setSelectedItems((prev) => {
      const next = new Set(prev)
      if (next.has(id)) {
        next.delete(id)
      } else {
        next.add(id)
      }
      return next
    })
    setSelectAll(false)
  }

  const toggleSelectAll = () => {
    if (selectAll) {
      setSelectedItems(new Set())
    } else {
      setSelectedItems(new Set(filteredItems.map((item) => item.id)))
    }
    setSelectAll(!selectAll)
  }

  const doDownload = async (url: string, filename: string) => {
    try {
      return await downloadFile({ url, filename })
    } catch (error) {
      console.error('Download failed:', url, error)
      return false
    }
  }

  const handleDownload = useCallback(async () => {
    const itemsToDownload = filteredItems.filter((item) => selectedItems.has(item.id))
    if (itemsToDownload.length === 0) return

    setIsDownloading(true)
    setDownloadProgress(0)

    const filenameMap = buildUniqueFilenames(itemsToDownload)
    let completed = 0
    for (const item of itemsToDownload) {
      const filename = filenameMap.get(item.id) || `${sanitizeFilenameBase(pickBaseName(item)) || 'asset'}.${inferExtFromUrl(item.src, item.type)}`

      await doDownload(item.src, filename)
      completed++
      setDownloadProgress(Math.round((completed / itemsToDownload.length) * 100))
    }

    setIsDownloading(false)
    setDownloadProgress(0)
  }, [filteredItems, selectedItems])

  const getTypeIcon = (type: AssetType) => {
    switch (type) {
      case 'image':
        return <ImageIcon className="h-4 w-4" />
      case 'video':
        return <Video className="h-4 w-4" />
      case 'audio':
        return <Music className="h-4 w-4" />
    }
  }

  const selectedCount = filteredItems.filter((item) => selectedItems.has(item.id)).length
  const selectedImageItems = useMemo(
    () => filteredItems.filter((item) => item.type === 'image' && selectedItems.has(item.id)),
    [filteredItems, selectedItems]
  )
  const selectedImageCount = selectedImageItems.length

  if (!open) return null

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div
        className="flex max-h-[80vh] w-[600px] max-w-[95vw] flex-col overflow-hidden rounded-2xl border border-[var(--border-color)] bg-[var(--bg-secondary)] shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-[var(--border-color)] px-5 py-4">
          <div className="flex items-center gap-3">
            <FolderDown className="h-5 w-5 text-[var(--accent-color)]" />
            <h2 className="text-lg font-semibold text-[var(--text-primary)]">批量下载</h2>
          </div>
          <button
            onClick={onClose}
            className="rounded-full p-1 text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-primary)] hover:text-[var(--text-primary)]"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Type filters */}
        <div className="flex items-center gap-3 border-b border-[var(--border-color)] px-5 py-3">
          <span className="text-xs text-[var(--text-secondary)]">筛选：</span>
          {(['image', 'video', 'audio'] as AssetType[]).map((type) => (
            <button
              key={type}
              onClick={() => toggleType(type)}
              className={cn(
                'flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition-colors',
                selectedTypes.has(type)
                  ? 'border-[var(--accent-color)] bg-[rgb(var(--accent-rgb)/0.1)] text-[var(--accent-color)]'
                  : 'border-[var(--border-color)] text-[var(--text-secondary)] hover:border-[var(--text-secondary)]'
              )}
            >
              {getTypeIcon(type)}
              {type === 'image' ? '图片' : type === 'video' ? '视频' : '音频'}
            </button>
          ))}
        </div>

        {/* Select all */}
        <div className="flex items-center justify-between border-b border-[var(--border-color)] px-5 py-2">
          <button
            onClick={toggleSelectAll}
            className="flex items-center gap-2 text-xs text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
          >
            <div
              className={cn(
                'flex h-4 w-4 items-center justify-center rounded border transition-colors',
                selectAll
                  ? 'border-[var(--accent-color)] bg-[var(--accent-color)]'
                  : 'border-[var(--border-color)]'
              )}
            >
              {selectAll && <Check className="h-3 w-3 text-white" />}
            </div>
            全选
          </button>
          <span className="text-xs text-[var(--text-secondary)]">
            已选 {selectedCount} / {filteredItems.length} 项
          </span>
        </div>

        {/* Item list */}
        <div className="flex-1 overflow-auto p-4">
          {filteredItems.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-[var(--text-secondary)]">
              <FolderDown className="mb-3 h-12 w-12 opacity-40" />
              <div className="text-sm">没有可下载的资源</div>
              <div className="mt-1 text-xs opacity-70">画布上的图片、视频、音频会显示在这里</div>
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              {filteredItems.map((item) => (
                <div
                  key={item.id}
                  onClick={() => toggleItem(item.id)}
                  className={cn(
                    'group relative cursor-pointer overflow-hidden rounded-xl border transition-all',
                    selectedItems.has(item.id)
                      ? 'border-[var(--accent-color)] ring-2 ring-[rgb(var(--accent-rgb)/0.2)]'
                      : 'border-[var(--border-color)] hover:border-[var(--accent-color)]/50'
                  )}
                >
                  {/* Thumbnail */}
                  <div className="aspect-square bg-[var(--bg-primary)]">
                    {item.type === 'image' ? (
                      <img src={item.src} alt={item.remark || item.title} className="h-full w-full object-cover" />
                    ) : item.type === 'video' ? (
                      <video src={item.src} className="h-full w-full object-cover" muted />
                    ) : (
                      <div className="flex h-full w-full items-center justify-center">
                        <Music className="h-12 w-12 text-[var(--text-secondary)]/50" />
                      </div>
                    )}
                  </div>

                  {/* Checkbox */}
                  <div
                    className={cn(
                      'absolute left-2 top-2 flex h-5 w-5 items-center justify-center rounded-full border-2 transition-colors',
                      selectedItems.has(item.id)
                        ? 'border-[var(--accent-color)] bg-[var(--accent-color)]'
                        : 'border-white/70 bg-black/30'
                    )}
                  >
                    {selectedItems.has(item.id) && <Check className="h-3 w-3 text-white" />}
                  </div>

                  {/* Type badge */}
                  <div className="absolute right-2 top-2 rounded bg-black/60 p-1 text-white">
                    {getTypeIcon(item.type)}
                  </div>

                  {/* Title */}
                  <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/70 to-transparent p-2">
                    <div className="truncate text-xs text-white/90">{pickBaseName(item)}</div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between border-t border-[var(--border-color)] px-5 py-4">
          {isDownloading ? (
            <div className="flex items-center gap-2 text-sm text-[var(--text-secondary)]">
              <Loader2 className="h-4 w-4 animate-spin" />
              下载中 {downloadProgress}%
            </div>
          ) : (
            <div className="text-xs text-[var(--text-secondary)]">
              {selectedCount > 0 ? `${selectedCount} 个文件将被下载` : '请选择要下载的文件'}
            </div>
          )}
          <div className="flex items-center gap-3">
            <Button variant="ghost" onClick={onClose}>
              取消
            </Button>
            <Button
              variant="secondary"
              disabled={selectedImageCount === 0}
              onClick={() => {
                const list: ExportPdfImageItem[] = selectedImageItems.map((it) => ({
                  id: it.id,
                  src: it.src,
                  previewSrc: it.src,
                  title: pickBaseName(it),
                }))
                setPdfItems(list)
                setPdfOpen(true)
              }}
              title="仅支持图片导出"
            >
              导出 PDF ({selectedImageCount})
            </Button>
            <Button onClick={handleDownload} disabled={isDownloading || selectedCount === 0}>
              <Download className="mr-2 h-4 w-4" />
              {isDownloading ? '下载中...' : `下载 (${selectedCount})`}
            </Button>
          </div>
        </div>
      </div>

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
