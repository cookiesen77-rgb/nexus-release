import React, { memo, useEffect, useRef } from 'react'
import { Type, Image, Video, Settings2 } from 'lucide-react'

const NODE_OPTIONS = [
  { type: 'text', label: '文本', icon: Type, color: '#22d37e' },
  { type: 'imageConfig', label: '图片生成', icon: Image, color: '#f59e0b' },
  { type: 'videoConfig', label: '视频生成', icon: Video, color: '#a855f7' },
  { type: 'image', label: '图片', icon: Image, color: '#3b82f6' },
]

interface NodeTypePickerPopoverProps {
  position: { x: number; y: number }
  onSelect: (type: string) => void
  onClose: () => void
}

export const NodeTypePickerPopover = memo(function NodeTypePickerPopover({
  position, onSelect, onClose,
}: NodeTypePickerPopoverProps) {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose()
    }
    const timer = setTimeout(() => document.addEventListener('mousedown', handler), 10)
    return () => { clearTimeout(timer); document.removeEventListener('mousedown', handler) }
  }, [onClose])

  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [onClose])

  return (
    <div
      ref={ref}
      className="fixed z-[10000] bg-[var(--bg-primary)] border border-[var(--border-color)] rounded-xl shadow-2xl p-1.5 flex gap-1"
      style={{ top: position.y - 20, left: position.x - 80 }}
      onClick={e => e.stopPropagation()}
      onMouseDown={e => e.stopPropagation()}
    >
      {NODE_OPTIONS.map(opt => {
        const Icon = opt.icon
        return (
          <button
            key={opt.type}
            onClick={(e) => { e.stopPropagation(); onSelect(opt.type) }}
            className="flex flex-col items-center gap-0.5 px-2.5 py-1.5 rounded-lg hover:bg-[var(--bg-tertiary)] transition-colors"
            title={opt.label}
          >
            <Icon size={16} style={{ color: opt.color }} />
            <span className="text-[9px] text-[var(--text-secondary)]">{opt.label}</span>
          </button>
        )
      })}
    </div>
  )
})
