import React, { memo } from 'react'
import { getBezierPath, type EdgeProps } from '@xyflow/react'
import { useGraphStore } from '@/graph/store'

export const DefaultColoredEdge = memo(function DefaultColoredEdge({
  id, sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, selected,
}: EdgeProps) {
  const [edgePath] = getBezierPath({ sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition })

  const hoveredEdgeId = useGraphStore(s => s.hoveredEdgeId)
  const isHighlighted = !hoveredEdgeId || useGraphStore.getState().highlightedEdgeIds.has(id)
  const gradientId = `gradient-${id}`

  return (
    <g>
      <defs>
        <linearGradient id={gradientId} gradientUnits="userSpaceOnUse" x1={sourceX} y1={sourceY} x2={targetX} y2={targetY}>
          <stop offset="0%" stopColor="#52525b" stopOpacity="0">
            <animate attributeName="offset" values="-0.5;1" dur="2s" repeatCount="indefinite" />
          </stop>
          <stop offset="0%" stopColor="#ffffff" stopOpacity="1">
            <animate attributeName="offset" values="-0.3;1.2" dur="2s" repeatCount="indefinite" />
          </stop>
          <stop offset="0%" stopColor="#52525b" stopOpacity="0">
            <animate attributeName="offset" values="-0.1;1.4" dur="2s" repeatCount="indefinite" />
          </stop>
        </linearGradient>
      </defs>
      <path
        id={id}
        d={edgePath}
        fill="none"
        className="react-flow__edge-path"
        style={{
          strokeWidth: 2.5,
          strokeOpacity: isHighlighted ? 0.6 : 0.1,
          transition: 'stroke 0.3s, stroke-opacity 0.3s',
          stroke: selected ? 'rgba(255,255,255,0.8)' : `url(#${gradientId})`,
        }}
      />
      <path d={edgePath} fill="none" strokeOpacity="0" strokeWidth="20" className="react-flow__edge-interaction" />
    </g>
  )
})
