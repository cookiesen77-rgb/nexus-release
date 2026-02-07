/**
 * CanvasBottomControls - 底部控制栏组件
 * 
 * 参考 Vue 版本实现：
 * - 适应视图按钮
 * - 缩放控制（-/+）
 * - 当前缩放百分比显示
 */
import React, { memo } from 'react'
import { Locate, Minus, Plus } from 'lucide-react'

interface Props {
  zoom: number
  onZoomIn: () => void
  onZoomOut: () => void
  onFitView: () => void
}

const ControlButton = memo(function ControlButton({
  title,
  onClick,
  children
}: {
  title: string
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      className="p-1.5 rounded-lg hover:bg-[var(--bg-tertiary)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors"
      onClick={onClick}
      title={title}
      type="button"
    >
      {children}
    </button>
  )
})

export default memo(function CanvasBottomControls({ 
  zoom, 
  onZoomIn, 
  onZoomOut, 
  onFitView 
}: Props) {
  const zoomPercent = Math.round(zoom * 100)

  return (
    <div className="pointer-events-auto fixed bottom-4 left-4 flex items-center gap-1 bg-[var(--bg-secondary)] rounded-xl border border-[var(--border-color)] p-1.5 shadow-sm z-30">
      {/* 适应视图按钮 */}
      <ControlButton title="适应视图" onClick={onFitView}>
        <Locate className="h-4 w-4" />
      </ControlButton>

      <div className="w-px h-5 bg-[var(--border-color)] mx-1" />

      {/* 缩放控制 */}
      <div className="flex items-center gap-1">
        <ControlButton title="缩小" onClick={onZoomOut}>
          <Minus className="h-4 w-4" />
        </ControlButton>
        
        <span className="text-xs text-[var(--text-secondary)] min-w-[42px] text-center tabular-nums">
          {zoomPercent}%
        </span>
        
        <ControlButton title="放大" onClick={onZoomIn}>
          <Plus className="h-4 w-4" />
        </ControlButton>
      </div>
    </div>
  )
})
