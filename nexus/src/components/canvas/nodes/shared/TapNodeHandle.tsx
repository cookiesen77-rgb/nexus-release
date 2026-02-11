import React, { memo } from 'react'
import { Handle, Position } from '@xyflow/react'
import { Plus } from 'lucide-react'

interface TapNodeHandleProps {
  type: 'source' | 'target'
  position: Position
  id: string
}

export const TapNodeHandle = memo(function TapNodeHandle({ type, position, id }: TapNodeHandleProps) {
  const isRight = position === Position.Right
  return (
    <Handle
      type={type}
      position={position}
      id={id}
      className="nodrag nopan !relative !flex items-center"
      style={{ background: 'transparent', border: 'none', borderRadius: 0, width: 0, height: 0 }}
    >
      <div className={`will-change-transform h-20 w-20 rounded-full absolute top-1/2 -translate-y-1/2 ${isRight ? 'left-0' : 'right-0'} flex justify-center items-center`}>
        <div className={`node-handle-plus ${isRight ? 'node-handle-plus-right' : 'node-handle-plus-left'}`}>
          <Plus
            size={24}
            className="border-[2px] rounded-full text-[var(--text-secondary)] transition-colors hover:text-[var(--text-primary)] border-[var(--text-secondary)] hover:border-[var(--text-primary)]"
          />
        </div>
      </div>
    </Handle>
  )
})
