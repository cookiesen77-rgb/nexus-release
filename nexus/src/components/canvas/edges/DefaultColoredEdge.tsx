import React, { memo } from 'react'
import { getBezierPath, type EdgeProps } from '@xyflow/react'

export const DefaultColoredEdge = memo(function DefaultColoredEdge({
  id, sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, selected,
}: EdgeProps) {
  const [edgePath] = getBezierPath({ sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition })

  return (
    <g>
      <path
        id={id}
        d={edgePath}
        fill="none"
        className="react-flow__edge-path"
        stroke={selected ? 'var(--text-primary)' : 'var(--text-secondary)'}
        strokeWidth={2}
      />
      <path d={edgePath} fill="none" strokeOpacity="0" strokeWidth="20" className="react-flow__edge-interaction" />
    </g>
  )
})
