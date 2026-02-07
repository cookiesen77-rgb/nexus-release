import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { useAssetsStore } from '@/store/assets'
import { useGraphStore } from '@/graph/store'
import { getMedia } from '@/lib/mediaStorage'
import { Image as ImageIcon, Video as VideoIcon, Music, Upload, X, Check } from 'lucide-react'

type TabKey = 'local' | 'history' | 'canvas'
type MediaKind = 'image' | 'video' | 'audio'

export type EcomPickedMedia = {
  origin: 'local' | 'history' | 'canvas'
  id: string
  label: string
  kind: MediaKind
  sourceUrl?: string
  displayUrl?: string
  mediaId?: string
}

interface Props {
  open: boolean
  onClose: () => void
  title?: string
  multiple?: boolean
  kinds?: MediaKind[]
  onConfirm: (items: EcomPickedMedia[]) => void
}

const isHttp = (v: string) => /^https?:\/\//i.test(v)

const ICON_MAP: Record<MediaKind, React.ComponentType<{ className?: string }>> = {
  image: ImageIcon,
  video: VideoIcon,
  audio: Music,
}

function useIdbUrl(mediaId?: string) {
  const [url, setUrl] = useState('')
  useEffect(() => {
    if (!mediaId) { setUrl(''); return }
    let cancelled = false
    ;(async () => {
      try {
        const rec = await getMedia(mediaId)
        if (!cancelled) setUrl(String(rec?.data || ''))
      } catch { if (!cancelled) setUrl('') }
    })()
    return () => { cancelled = true }
  }, [mediaId])
  return url
}

function PickCard({ selected, label, src, kind, onClick }: {
  selected: boolean; label: string; src: string; kind: MediaKind; onClick: () => void
}) {
  const Icon = ICON_MAP[kind] || ImageIcon
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'group relative flex flex-col overflow-hidden rounded-xl border bg-[var(--bg-primary)] text-left',
        selected ? 'border-[var(--accent-color)] ring-2 ring-[rgb(var(--accent-rgb)/0.25)]' : 'border-[var(--border-color)] hover:border-[var(--accent-color)]'
      )}
    >
      <div className="relative flex h-28 w-full items-center justify-center bg-black/10">
        {src ? (
          kind === 'video' ? (
            <video src={src} className="h-full w-full object-cover" muted playsInline />
          ) : kind === 'audio' ? (
            <div className="flex flex-col items-center gap-1">
              <Music className="h-6 w-6 text-[var(--accent-color)]" />
              <span className="text-[10px] text-[var(--text-secondary)]">音频</span>
            </div>
          ) : (
            <img src={src} alt={label} className="h-full w-full object-cover" />
          )
        ) : (
          <div className="flex items-center gap-2 text-xs text-[var(--text-secondary)]">
            <Icon className="h-4 w-4 opacity-60" />
            无预览
          </div>
        )}
        {selected && (
          <div className="absolute right-2 top-2 flex h-5 w-5 items-center justify-center rounded-full bg-[var(--accent-color)]">
            <Check className="h-3 w-3 text-white" />
          </div>
        )}
      </div>
      <div className="p-2">
        <div className="truncate text-xs font-medium text-[var(--text-primary)]">{label || '未命名'}</div>
      </div>
    </button>
  )
}

function PickableItem({ item, selected, onClick }: { item: EcomPickedMedia; selected: boolean; onClick: () => void }) {
  const fromIdb = useIdbUrl(item.mediaId)
  const src = String(item.sourceUrl || item.displayUrl || fromIdb || '').trim()
  return <PickCard selected={selected} label={item.label} src={src} kind={item.kind} onClick={onClick} />
}

export default function EcomMediaPickerModal({ open, onClose, title, multiple = true, kinds = ['image'], onConfirm }: Props) {
  const [tab, setTab] = useState<TabKey>('local')
  const [kind, setKind] = useState<MediaKind>(kinds[0] || 'image')
  const [selectedIds, setSelectedIds] = useState<Record<string, boolean>>({})
  const [localItems, setLocalItems] = useState<EcomPickedMedia[]>([])
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [dragOver, setDragOver] = useState(false)

  const assets = useAssetsStore((s) => s.assets)
  const canvasNodes = useGraphStore((s) => (s as any).nodes || [])

  useEffect(() => {
    if (!open) return
    setTab('local')
    setKind(kinds[0] || 'image')
    setSelectedIds({})
    setLocalItems([])
  }, [open, kinds])

  const addLocalFiles = useCallback((files: File[]) => {
    for (const f of files) {
      const reader = new FileReader()
      reader.onload = () => {
        const dataUrl = reader.result as string
        if (!dataUrl) return
        const fileKind: MediaKind = f.type.startsWith('video/') ? 'video' : f.type.startsWith('audio/') ? 'audio' : 'image'
        const item: EcomPickedMedia = {
          origin: 'local',
          id: `local_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
          label: f.name.replace(/\.[^.]+$/, '').slice(0, 30) || '本地文件',
          kind: fileKind,
          displayUrl: dataUrl,
        }
        setLocalItems(prev => [...prev, item])
        setSelectedIds(prev => ({ ...prev, [item.id]: true }))
      }
      reader.readAsDataURL(f)
    }
  }, [])

  const handleFileChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    addLocalFiles(Array.from(e.target.files || []))
    e.currentTarget.value = ''
  }, [addLocalFiles])

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setDragOver(false)
    addLocalFiles(Array.from(e.dataTransfer.files || []))
  }, [addLocalFiles])

  const itemsHistory = useMemo(() => {
    return (assets || []).filter((a: any) => a?.type === kind).map((a: any): EcomPickedMedia => {
      const src = String(a?.src || '').trim()
      return {
        kind,
        origin: 'history',
        id: String(a.id),
        label: String(a?.title || a?.id || '').trim() || (kind === 'video' ? '历史视频' : kind === 'audio' ? '历史音频' : '历史图片'),
        sourceUrl: isHttp(src) ? src : undefined,
        displayUrl: !isHttp(src) ? src : undefined,
      }
    })
  }, [assets, kind])

  const itemsCanvas = useMemo(() => {
    const list = Array.isArray(canvasNodes) ? canvasNodes.filter((n: any) => n?.type === kind) : []
    return list.map((n: any): EcomPickedMedia => {
      const d: any = n?.data || {}
      const url = String(d?.url || '').trim()
      const sourceUrl = String(d?.sourceUrl || '').trim()
      const mediaId = String(d?.mediaId || '').trim()
      return {
        kind,
        origin: 'canvas',
        id: String(n?.id || ''),
        label: String(d?.label || n?.id || '').trim() || (kind === 'video' ? '画布视频' : kind === 'audio' ? '画布音频' : '画布图片'),
        sourceUrl: isHttp(sourceUrl) ? sourceUrl : isHttp(url) ? url : undefined,
        displayUrl: !isHttp(url) ? url : undefined,
        mediaId: mediaId || undefined,
      }
    })
  }, [canvasNodes, kind])

  const currentItems = tab === 'local' ? localItems : tab === 'canvas' ? itemsCanvas : itemsHistory

  const toggle = (id: string) => {
    setSelectedIds(prev => {
      if (!multiple) return prev[id] ? {} : { [id]: true }
      return { ...prev, [id]: !prev[id] }
    })
  }

  const selectedCount = Object.values(selectedIds).filter(Boolean).length

  const allItems = useMemo(() => [...localItems, ...itemsHistory, ...itemsCanvas], [localItems, itemsHistory, itemsCanvas])

  const confirm = () => {
    const selected = allItems.filter(it => selectedIds[it.id])
    onConfirm(selected)
    onClose()
  }

  if (!open) return null

  const acceptMime = kinds.map(k => k === 'video' ? 'video/*' : k === 'audio' ? 'audio/*' : 'image/*').join(',')

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="flex h-[min(80vh,760px)] w-[min(980px,96vw)] flex-col overflow-hidden rounded-2xl border border-[var(--border-color)] bg-[var(--bg-secondary)] shadow-2xl" onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div className="flex items-center justify-between border-b border-[var(--border-color)] px-5 py-4">
          <div className="text-sm font-semibold text-[var(--text-primary)]">{title || '选择素材'}</div>
          <button onClick={onClose} className="rounded-full p-1 text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-primary)] hover:text-[var(--text-primary)]" type="button">
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Tabs + kind filter */}
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--border-color)] px-5 py-3">
          <div className="flex items-center rounded-lg border border-[var(--border-color)] bg-[var(--bg-primary)] p-1">
            {(['local', 'history', 'canvas'] as TabKey[]).map(t => (
              <Button key={t} size="sm" variant="ghost" className={cn('h-8 px-3', tab === t && 'bg-[var(--bg-secondary)]')} onClick={() => setTab(t)}>
                {t === 'local' ? '本地上传' : t === 'history' ? '历史素材' : '画布素材'}
              </Button>
            ))}
          </div>

          {kinds.length > 1 && (
            <div className="flex items-center rounded-lg border border-[var(--border-color)] bg-[var(--bg-primary)] p-1">
              {kinds.map(k => (
                <Button key={k} size="sm" variant="ghost" className={cn('h-8 px-3', kind === k && 'bg-[var(--bg-secondary)]')} onClick={() => setKind(k)}>
                  {k === 'image' ? '图片' : k === 'video' ? '视频' : '音频'}
                </Button>
              ))}
            </div>
          )}

          <div className="text-xs text-[var(--text-secondary)]">
            已选 {selectedCount} {multiple ? '项' : '项（单选）'}
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-auto p-5">
          {tab === 'local' ? (
            <div className="space-y-4">
              <div
                onDragOver={e => { e.preventDefault(); setDragOver(true) }}
                onDragLeave={() => setDragOver(false)}
                onDrop={handleDrop}
                onClick={() => fileInputRef.current?.click()}
                className={cn(
                  'flex cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed p-8 transition-colors',
                  dragOver ? 'border-[var(--accent-color)] bg-[var(--accent-color)]/5' : 'border-[var(--border-color)] hover:border-[var(--accent-color)]'
                )}
              >
                <Upload className="mb-2 h-8 w-8 text-[var(--text-secondary)] opacity-40" />
                <div className="text-sm text-[var(--text-secondary)]">拖拽文件到此处或点击选择</div>
                <div className="mt-1 text-[10px] text-[var(--text-secondary)] opacity-60">支持图片、视频、音频文件</div>
                <input ref={fileInputRef} type="file" accept={acceptMime} multiple className="hidden" onChange={handleFileChange} />
              </div>

              {localItems.length > 0 && (
                <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-4">
                  {localItems.map(it => (
                    <PickableItem key={it.id} item={it} selected={!!selectedIds[it.id]} onClick={() => toggle(it.id)} />
                  ))}
                </div>
              )}
            </div>
          ) : currentItems.length === 0 ? (
            <div className="rounded-xl border border-[var(--border-color)] bg-[var(--bg-primary)] p-6 text-sm text-[var(--text-secondary)]">
              {tab === 'history' ? '暂无历史素材。先生成内容后会自动保存到历史。' : '画布中暂无匹配节点。'}
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-4">
              {currentItems.map(it => (
                <PickableItem key={it.id} item={it} selected={!!selectedIds[it.id]} onClick={() => toggle(it.id)} />
              ))}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between border-t border-[var(--border-color)] px-5 py-3">
          <Button variant="secondary" onClick={onClose}>取消</Button>
          <Button onClick={confirm} disabled={selectedCount === 0}>确认</Button>
        </div>
      </div>
    </div>
  )
}
