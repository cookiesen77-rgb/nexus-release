import React, { memo, useState, useMemo, useCallback, useEffect, useRef } from 'react'
import { Search, Image as ImageIcon, Layout } from 'lucide-react'
import { useAssetsStore, type Asset } from '@/store/assets'
import { useGraphStore } from '@/graph/store'

type Tab = 'history' | 'canvas'

interface AssetMentionPopoverProps {
  query: string
  onSelect: (url: string) => void
  onClose: () => void
  position: { top: number; left: number }
}

export const AssetMentionPopover = memo(function AssetMentionPopover({
  query, onSelect, onClose, position,
}: AssetMentionPopoverProps) {
  const [tab, setTab] = useState<Tab>('history')
  const panelRef = useRef<HTMLDivElement>(null)

  const historyImages = useAssetsStore(s => s.getAssetsByType('image'))

  const nodes = useGraphStore(s => s.nodes)
  const canvasImages = useMemo(() => {
    return nodes
      .filter(n => n.type === 'image' && n.data?.url)
      .map(n => ({ id: n.id, src: String(n.data?.url || ''), title: String(n.data?.label || '画布图片') }))
  }, [nodes])

  const q = query.toLowerCase()

  const filteredHistory = useMemo(() => {
    if (!q) return historyImages.slice(0, 30)
    return historyImages.filter(a =>
      (a.title || '').toLowerCase().includes(q) ||
      (a.tags || []).some(t => t.toLowerCase().includes(q)) ||
      (a.model || '').toLowerCase().includes(q)
    ).slice(0, 30)
  }, [historyImages, q])

  const filteredCanvas = useMemo(() => {
    if (!q) return canvasImages.slice(0, 30)
    return canvasImages.filter(a => a.title.toLowerCase().includes(q)).slice(0, 30)
  }, [canvasImages, q])

  const items = tab === 'history' ? filteredHistory : filteredCanvas

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) onClose()
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [onClose])

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [onClose])

  return (
    <div
      ref={panelRef}
      className="fixed z-[9999] bg-[var(--bg-primary)] border border-[var(--border-color)] rounded-lg shadow-2xl overflow-hidden"
      style={{ top: position.top, left: position.left, width: 320, maxHeight: 300 }}
      onClick={e => e.stopPropagation()}
    >
      {/* Tabs */}
      <div className="flex border-b border-[var(--border-color)]">
        <button
          onClick={() => setTab('history')}
          className={`flex-1 flex items-center justify-center gap-1.5 px-3 py-2 text-xs transition-colors ${
            tab === 'history' ? 'text-[var(--accent-color)] border-b-2 border-[var(--accent-color)]' : 'text-[var(--text-secondary)]'
          }`}
        >
          <ImageIcon size={12} /> 历史素材
        </button>
        <button
          onClick={() => setTab('canvas')}
          className={`flex-1 flex items-center justify-center gap-1.5 px-3 py-2 text-xs transition-colors ${
            tab === 'canvas' ? 'text-[var(--accent-color)] border-b-2 border-[var(--accent-color)]' : 'text-[var(--text-secondary)]'
          }`}
        >
          <Layout size={12} /> 画布图片
        </button>
      </div>

      {/* Search hint */}
      {q && (
        <div className="px-3 py-1.5 text-[10px] text-[var(--text-secondary)] bg-[var(--bg-secondary)]">
          搜索: {q}
        </div>
      )}

      {/* Grid */}
      <div className="overflow-y-auto p-2 grid grid-cols-4 gap-1.5" style={{ maxHeight: 220 }}>
        {items.length === 0 && (
          <div className="col-span-4 py-6 text-center text-xs text-[var(--text-secondary)]">
            {q ? '无匹配结果' : '暂无素材'}
          </div>
        )}
        {items.map(item => {
          const src = 'src' in item ? item.src : ''
          const title = ('title' in item ? item.title : '') || ''
          return (
            <button
              key={item.id}
              onClick={(e) => { e.stopPropagation(); onSelect(src) }}
              className="w-full aspect-square rounded overflow-hidden border border-[var(--border-color)] hover:border-[var(--accent-color)] transition-colors bg-black/10"
              title={title}
            >
              <img src={src} alt="" className="w-full h-full object-cover" draggable={false} />
            </button>
          )
        })}
      </div>
    </div>
  )
})
