import React, { memo } from 'react'
import { getBezierPath, type EdgeProps } from '@xyflow/react'
import { useGraphStore } from '@/graph/store'

export const DefaultColoredEdge = memo(function DefaultColoredEdge({
  id, sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, selected,
}: EdgeProps) {
  const [edgePath] = getBezierPath({ sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition })

  const hoveredEdgeId = useGraphStore(s => s.hoveredEdgeId)
  const isHighlighted = !hoveredEdgeId || useGraphStore.getState().highlightedEdgeIds.has(id)

  return (
    <g>
      <path
        id={id}
        d={edgePath}
        fill="none"
        className="react-flow__edge-path"
        style={{
          strokeWidth: 2,
          strokeOpacity: isHighlighted ? 0.9 : 0.5,
          transition: 'stroke-opacity 0.3s',
          stroke: selected ? 'var(--text-primary)' : 'var(--text-secondary)',
        }}
      />
      <path d={edgePath} fill="none" strokeOpacity="0" strokeWidth="20" className="react-flow__edge-interaction" />
    </g>
  )
})
