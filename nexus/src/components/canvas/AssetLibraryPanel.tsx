import React, { useMemo, useState } from 'react'
import { useAssetsStore, type AssetType } from '@/store/assets'
import { Star, Tag, Trash2, X } from 'lucide-react'

type FilterTab = 'all' | 'image' | 'video' | 'favorite'

export default function AssetLibraryPanel({ open, onClose }: { open: boolean; onClose: () => void }) {
  const assets = useAssetsStore(s => s.assets)
  const removeAsset = useAssetsStore(s => s.removeAsset)
  const toggleFavorite = useAssetsStore(s => s.toggleFavorite)
  const setTags = useAssetsStore(s => s.setTags)

  const [tab, setTab] = useState<FilterTab>('all')
  const [search, setSearch] = useState('')
  const [tagging, setTagging] = useState<string | null>(null)
  const [preview, setPreview] = useState<string | null>(null)

  const filtered = useMemo(() => {
    let list = assets
    if (tab === 'image') list = list.filter(a => a.type === 'image')
    else if (tab === 'video') list = list.filter(a => a.type === 'video')
    else if (tab === 'favorite') list = list.filter(a => a.favorite)
    if (search.trim()) {
      const q = search.trim().toLowerCase()
      list = list.filter(a =>
        (a.title || '').toLowerCase().includes(q) ||
        (a.tags || []).some(t => t.toLowerCase().includes(q))
      )
    }
    return list
  }, [assets, tab, search])

  const handleAutoTag = async (id: string, src: string) => {
    setTagging(id)
    try {
      const { autoTagAsset } = await import('@/lib/assets/autoTag')
      const tags = await autoTagAsset(src)
      setTags(id, tags)
    } catch { /* ignore */ }
    setTagging(null)
  }

  if (!open) return null

  const tabs: { key: FilterTab; label: string }[] = [
    { key: 'all', label: '全部' },
    { key: 'image', label: '图片' },
    { key: 'video', label: '视频' },
    { key: 'favorite', label: '收藏' },
  ]

  const previewAsset = preview ? assets.find(a => a.id === preview) : null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={onClose}>
      <div className="relative flex h-[80vh] w-[800px] max-w-[95vw] flex-col rounded-2xl border border-[var(--border-color)] bg-[var(--bg-secondary)] shadow-2xl" onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div className="flex items-center justify-between border-b border-[var(--border-color)] px-5 py-3">
          <h2 className="text-base font-semibold text-[var(--text-primary)]">素材库</h2>
          <button onClick={onClose} className="rounded-lg p-1 hover:bg-[var(--bg-tertiary)]"><X className="h-5 w-5" /></button>
        </div>

        {/* Tabs + Search */}
        <div className="flex items-center gap-3 border-b border-[var(--border-color)] px-5 py-2">
          {tabs.map(t => (
            <button key={t.key} onClick={() => setTab(t.key)}
              className={`rounded-lg px-3 py-1 text-xs font-medium transition-colors ${tab === t.key ? 'bg-[var(--accent-color)] text-white' : 'text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)]'}`}>
              {t.label}
            </button>
          ))}
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="搜索标题/标签..."
            className="ml-auto w-48 rounded-lg border border-[var(--border-color)] bg-[var(--bg-primary)] px-3 py-1 text-xs outline-none" />
        </div>

        {/* Grid */}
        <div className="flex-1 overflow-y-auto p-4">
          {filtered.length === 0 ? (
            <div className="py-12 text-center text-sm text-[var(--text-secondary)]">暂无素材</div>
          ) : (
            <div className="grid grid-cols-4 gap-3">
              {filtered.map(a => (
                <div key={a.id} className="group relative overflow-hidden rounded-xl border border-[var(--border-color)] bg-[var(--bg-primary)]">
                  {/* Thumbnail */}
                  <div className="aspect-square cursor-pointer overflow-hidden" onClick={() => setPreview(a.id)}>
                    {a.type === 'video' ? (
                      <video src={a.src} className="h-full w-full object-cover" muted />
                    ) : (
                      <img src={a.src} className="h-full w-full object-cover" loading="lazy" />
                    )}
                  </div>
                  {/* Info */}
                  <div className="p-2">
                    <div className="truncate text-xs font-medium text-[var(--text-primary)]">{a.title || '未命名'}</div>
                    {(a.tags?.length ?? 0) > 0 && (
                      <div className="mt-1 flex flex-wrap gap-1">
                        {a.tags!.slice(0, 4).map(t => (
                          <span key={t} className="rounded bg-[var(--bg-tertiary)] px-1.5 py-0.5 text-[10px] text-[var(--text-secondary)]">{t}</span>
                        ))}
                      </div>
                    )}
                  </div>
                  {/* Actions */}
                  <div className="absolute right-1 top-1 flex gap-1 opacity-0 transition-opacity group-hover:opacity-100">
                    <button onClick={() => toggleFavorite(a.id)} title="收藏"
                      className="rounded-lg bg-black/50 p-1 text-white hover:bg-black/70">
                      <Star className={`h-3.5 w-3.5 ${a.favorite ? 'fill-yellow-400 text-yellow-400' : ''}`} />
                    </button>
                    <button onClick={() => handleAutoTag(a.id, a.src)} disabled={tagging === a.id} title="AI标签"
                      className="rounded-lg bg-black/50 p-1 text-white hover:bg-black/70 disabled:opacity-50">
                      <Tag className={`h-3.5 w-3.5 ${tagging === a.id ? 'animate-spin' : ''}`} />
                    </button>
                    <button onClick={() => removeAsset(a.id)} title="删除"
                      className="rounded-lg bg-black/50 p-1 text-red-400 hover:bg-black/70">
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Preview overlay */}
        {previewAsset && (
          <div className="absolute inset-0 z-10 flex items-center justify-center bg-black/70" onClick={() => setPreview(null)}>
            <div className="max-h-[90%] max-w-[90%]" onClick={e => e.stopPropagation()}>
              {previewAsset.type === 'video' ? (
                <video src={previewAsset.src} controls autoPlay className="max-h-[70vh] rounded-xl" />
              ) : (
                <img src={previewAsset.src} className="max-h-[70vh] rounded-xl" />
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
