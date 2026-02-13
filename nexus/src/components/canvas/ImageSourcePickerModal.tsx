import React, { memo, useState, useCallback, useRef } from 'react'
import { createPortal } from 'react-dom'
import { X, Upload, Layout, History } from 'lucide-react'
import { useGraphStore } from '@/graph/store'
import { useAssetsStore } from '@/store/assets'
import { saveMedia } from '@/lib/mediaStorage'

interface Props {
  open: boolean
  title?: string
  onClose: () => void
  onSelect: (imageUrl: string, sourceNodeId?: string) => void
}

type Tab = 'canvas' | 'history' | 'upload'

export default memo(function ImageSourcePickerModal({ open, title, onClose, onSelect }: Props) {
  const [tab, setTab] = useState<Tab>('canvas')
  const fileRef = useRef<HTMLInputElement>(null)

  const canvasImages = useGraphStore(s =>
    s.nodes.filter(n => n.type === 'image' && (n.data as any)?.url).map(n => ({
      id: n.id,
      url: (n.data as any).url as string,
      label: (n.data as any)?.label || '图片',
    }))
  )

  const historyImages = useAssetsStore(s =>
    s.assets.filter(a => a.type === 'image' && a.src).slice(0, 50).map(a => ({
      id: a.id,
      url: a.src,
      label: a.title || '历史图片',
    }))
  )

  const handleFileSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = (ev) => {
      const dataUrl = ev.target?.result as string
      if (dataUrl) onSelect(dataUrl)
    }
    reader.readAsDataURL(file)
    e.target.value = ''
  }, [onSelect])

  if (!open) return null

  return createPortal(
    <div
      className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/60 backdrop-blur-sm"
      onClick={onClose}
      onPointerDown={e => e.stopPropagation()}
    >
      <div
        className="w-[520px] max-h-[70vh] rounded-2xl bg-[var(--bg-secondary)] border border-[var(--border-color)] shadow-2xl flex flex-col overflow-hidden"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-[var(--border-color)]">
          <span className="text-sm font-semibold text-[var(--text-primary)]">{title || '选择图片'}</span>
          <button onClick={onClose} className="p-1 rounded-lg text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)]"><X size={16} /></button>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-[var(--border-color)]">
          {([['canvas', '画布节点', Layout], ['history', '历史素材', History], ['upload', '本地上传', Upload]] as const).map(([key, label, Icon]) => (
            <button
              key={key}
              onClick={() => setTab(key as Tab)}
              className={`flex-1 flex items-center justify-center gap-1.5 py-2.5 text-xs transition-colors ${tab === key ? 'text-[var(--text-primary)] border-b-2 border-blue-500' : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'}`}
            >
              <Icon size={14} />
              {label}
            </button>
          ))}
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-4">
          {tab === 'canvas' && (
            canvasImages.length === 0 ? (
              <div className="text-center text-sm text-[var(--text-secondary)] py-8">画布中没有图片节点</div>
            ) : (
              <div className="grid grid-cols-4 gap-2">
                {canvasImages.map(img => (
                  <button
                    key={img.id}
                    onClick={() => onSelect(img.url, img.id)}
                    className="group relative aspect-square rounded-lg overflow-hidden border border-[var(--border-color)] hover:border-blue-500 transition-colors"
                  >
                    <img src={img.url} alt={img.label} className="w-full h-full object-cover" />
                    <div className="absolute bottom-0 left-0 right-0 bg-black/60 px-1.5 py-0.5 text-[10px] text-white truncate">{img.label}</div>
                  </button>
                ))}
              </div>
            )
          )}

          {tab === 'history' && (
            historyImages.length === 0 ? (
              <div className="text-center text-sm text-[var(--text-secondary)] py-8">没有历史图片素材</div>
            ) : (
              <div className="grid grid-cols-4 gap-2">
                {historyImages.map(img => (
                  <button
                    key={img.id}
                    onClick={() => onSelect(img.url)}
                    className="group relative aspect-square rounded-lg overflow-hidden border border-[var(--border-color)] hover:border-blue-500 transition-colors"
                  >
                    <img src={img.url} alt={img.label} className="w-full h-full object-cover" />
                    <div className="absolute bottom-0 left-0 right-0 bg-black/60 px-1.5 py-0.5 text-[10px] text-white truncate">{img.label}</div>
                  </button>
                ))}
              </div>
            )
          )}

          {tab === 'upload' && (
            <div className="flex flex-col items-center justify-center py-12 gap-3">
              <button
                onClick={() => fileRef.current?.click()}
                className="flex items-center gap-2 px-6 py-3 rounded-xl bg-blue-600 text-white hover:bg-blue-500 transition-colors"
              >
                <Upload size={16} />
                选择图片文件
              </button>
              <span className="text-xs text-[var(--text-secondary)]">支持 PNG、JPG、WebP</span>
            </div>
          )}
        </div>
      </div>

      <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={handleFileSelect} />
    </div>,
    document.body
  )
})
