import React, { memo, useRef, useCallback, useEffect } from 'react'
import { Handle, Position } from '@xyflow/react'
import { Plus } from 'lucide-react'

interface TapNodeHandleProps {
  type: 'source' | 'target'
  position: Position
  id: string
}

export const TapNodeHandle = memo(function TapNodeHandle({ type, position, id }: TapNodeHandleProps) {
  const isRight = position === Position.Right
  const iconRef = useRef<HTMLDivElement>(null)
  const centerRef = useRef<{ x: number; y: number } | null>(null)
  const activeRef = useRef(false)

  const handleMouseMove = useCallback((e: MouseEvent) => {
    if (!iconRef.current || !centerRef.current) return
    const dx = Math.max(-20, Math.min(20, e.clientX - centerRef.current.x))
    const dy = Math.max(-20, Math.min(20, e.clientY - centerRef.current.y))
    iconRef.current.style.transform = `translate(${dx}px, ${dy}px)`
  }, [])

  useEffect(() => {
    return () => window.removeEventListener('mousemove', handleMouseMove)
  }, [handleMouseMove])

  const onEnter = useCallback(() => {
    if (!iconRef.current) return
    iconRef.current.style.transition = 'none'
    iconRef.current.style.transform = 'translate(0px, 0px)'
    const rect = iconRef.current.getBoundingClientRect()
    centerRef.current = { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 }
    activeRef.current = true
    window.addEventListener('mousemove', handleMouseMove)
  }, [handleMouseMove])

  const onLeave = useCallback(() => {
    if (iconRef.current) {
      iconRef.current.style.transition = 'transform 0.3s cubic-bezier(0.34, 1.56, 0.64, 1)'
      iconRef.current.style.transform = 'translate(0px, 0px)'
    }
    centerRef.current = null
    activeRef.current = false
    window.removeEventListener('mousemove', handleMouseMove)
  }, [handleMouseMove])

  return (
    <Handle
      type={type}
      position={position}
      id={id}
      className="nodrag nopan size-0 !flex items-center"
      style={{ background: 'transparent', border: 'none', borderRadius: 0 }}
    >
      <div
        className={`will-change-transform h-20 w-20 rounded-full absolute top-1/2 -translate-y-1/2 ${isRight ? 'left-0' : 'right-0'} flex justify-center items-center`}
        onMouseEnter={onEnter}
        onMouseLeave={onLeave}
      >
        <div ref={iconRef} className={`node-handle-plus ${isRight ? 'node-handle-plus-right' : 'node-handle-plus-left'}`}>
          <Plus
            size={24}
            className="border-[2px] rounded-full text-[var(--text-secondary)] transition-colors hover:text-[var(--text-primary)] border-[var(--text-secondary)] hover:border-[var(--text-primary)]"
          />
        </div>
      </div>
    </Handle>
  )
})
