import React, { memo, useState, useCallback, useRef } from 'react'
import { Plus, X, Trash2 } from 'lucide-react'
import { usePresetsStore } from '@/store/presets'
import type { StylePreset } from '@/lib/stylePresets'

interface StylePresetsRowProps {
  activeStyleId: string | undefined
  onStyleChange: (id: string | undefined) => void
  refImages?: Array<{ url: string; label?: string }>
  onRefImageRemove?: (index: number) => void
}

export const StylePresetsRow = memo(function StylePresetsRow({
  activeStyleId, onStyleChange, refImages, onRefImageRemove,
}: StylePresetsRowProps) {
  const { stylePresets, addStylePreset, removeStylePreset } = usePresetsStore()
  const [showAddModal, setShowAddModal] = useState(false)

  const handleToggle = useCallback((id: string) => {
    onStyleChange(activeStyleId === id ? undefined : id)
  }, [activeStyleId, onStyleChange])

  return (
    <div className="flex items-center gap-1.5 overflow-x-auto scrollbar-hide py-1 px-0.5" onClick={e => e.stopPropagation()}>
      {/* Add style button */}
      <button
        onClick={(e) => { e.stopPropagation(); setShowAddModal(true) }}
        className="flex-shrink-0 flex flex-col items-center justify-center w-12 h-12 rounded-lg border border-dashed border-[var(--border-color)] hover:border-[var(--accent-color)] transition-colors"
        title="添加自定义风格"
      >
        <Plus size={14} className="text-[var(--text-secondary)]" />
        <span className="text-[9px] text-[var(--text-secondary)] mt-0.5">风格</span>
      </button>

      {/* Style preset chips */}
      {stylePresets.map(preset => (
        <button
          key={preset.id}
          onClick={(e) => { e.stopPropagation(); handleToggle(preset.id) }}
          className={`flex-shrink-0 relative group px-2.5 py-1.5 rounded-lg text-xs transition-all ${
            activeStyleId === preset.id
              ? 'bg-[var(--accent-color)] text-white border border-[var(--accent-color)]'
              : 'bg-[var(--bg-tertiary)] text-[var(--text-primary)] border border-[var(--border-color)] hover:border-[var(--accent-color)]'
          }`}
          title={preset.promptSuffix}
        >
          {preset.name}
          {!preset.builtIn && activeStyleId !== preset.id && (
            <span
              onClick={(e) => { e.stopPropagation(); removeStylePreset(preset.id) }}
              className="absolute -top-1 -right-1 w-3.5 h-3.5 rounded-full bg-red-500 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
            >
              <X size={8} className="text-white" />
            </span>
          )}
        </button>
      ))}

      {/* Reference image thumbnails */}
      {refImages?.map((img, i) => (
        <div
          key={i}
          className="flex-shrink-0 w-12 h-12 rounded-lg overflow-hidden border border-[var(--border-color)] bg-black/20 relative group"
          title={img.label || `参考图 ${i + 1}`}
        >
          <img src={img.url} alt="" className="w-full h-full object-cover" draggable={false} />
          {onRefImageRemove && (
            <span
              onClick={(e) => { e.stopPropagation(); onRefImageRemove(i) }}
              className="absolute -top-1 -right-1 w-3.5 h-3.5 rounded-full bg-red-500 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer"
            >
              <X size={8} className="text-white" />
            </span>
          )}
        </div>
      ))}

      {/* Add style modal */}
      {showAddModal && (
        <AddStyleModal
          onClose={() => setShowAddModal(false)}
          onAdd={(name, suffix) => {
            addStylePreset({ name, promptSuffix: suffix })
            setShowAddModal(false)
          }}
        />
      )}
    </div>
  )
})

function AddStyleModal({ onClose, onAdd }: { onClose: () => void; onAdd: (name: string, suffix: string) => void }) {
  const nameRef = useRef<HTMLInputElement>(null)
  const suffixRef = useRef<HTMLTextAreaElement>(null)

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    e.stopPropagation()
    const name = nameRef.current?.value.trim()
    const suffix = suffixRef.current?.value.trim()
    if (name && suffix) onAdd(name, suffix)
  }

  return (
    <div
      className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/50"
      onClick={(e) => { e.stopPropagation(); onClose() }}
    >
      <form
        onClick={e => e.stopPropagation()}
        onSubmit={handleSubmit}
        className="bg-[var(--bg-primary)] border border-[var(--border-color)] rounded-xl p-4 w-80 shadow-xl"
      >
        <h3 className="text-sm font-medium text-[var(--text-primary)] mb-3">添加自定义风格</h3>
        <input
          ref={nameRef}
          placeholder="风格名称"
          className="w-full mb-2 px-3 py-1.5 text-sm rounded-lg border border-[var(--border-color)] bg-[var(--bg-secondary)] text-[var(--text-primary)] outline-none focus:ring-1 focus:ring-[var(--accent-color)]"
          autoFocus
        />
        <textarea
          ref={suffixRef}
          placeholder="提示词后缀（英文，如: anime style, vibrant colors）"
          rows={3}
          className="w-full mb-3 px-3 py-1.5 text-sm rounded-lg border border-[var(--border-color)] bg-[var(--bg-secondary)] text-[var(--text-primary)] outline-none resize-none focus:ring-1 focus:ring-[var(--accent-color)]"
        />
        <div className="flex gap-2 justify-end">
          <button type="button" onClick={onClose} className="px-3 py-1 text-xs rounded-lg bg-[var(--bg-secondary)] text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)]">
            取消
          </button>
          <button type="submit" className="px-3 py-1 text-xs rounded-lg bg-[var(--accent-color)] text-white hover:opacity-90">
            添加
          </button>
        </div>
      </form>
    </div>
  )
}
