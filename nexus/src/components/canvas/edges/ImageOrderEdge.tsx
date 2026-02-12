import React, { memo, useState, useCallback, useEffect, useRef } from 'react'
import { BaseEdge, EdgeLabelRenderer, getBezierPath, useReactFlow, type EdgeProps } from '@xyflow/react'
import { getEdgeColor } from '@/graph/edgeColors'
import { useGraphStore } from '@/graph/store'

export const ImageOrderEdge = memo(function ImageOrderEdge({
  id, sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, data, selected,
}: EdgeProps) {
  const [showDropdown, setShowDropdown] = useState(false)
  const dropdownRef = useRef<HTMLDivElement>(null)
  const { setEdges } = useReactFlow()

  const [edgePath, labelX, labelY] = getBezierPath({ sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition })

  const hoveredEdgeId = useGraphStore(s => s.hoveredEdgeId)
  const isHighlighted = !hoveredEdgeId || useGraphStore.getState().highlightedEdgeIds.has(id)
  const color = getEdgeColor('imageOrder')
  const order = (data as any)?.imageOrder || 1

  const dx = targetX - sourceX
  const dy = targetY - sourceY
  const angle = Math.atan2(dy, dx) * (180 / Math.PI)

  useEffect(() => {
    if (!showDropdown) return
    const handler = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) setShowDropdown(false)
    }
    const timer = setTimeout(() => document.addEventListener('mousedown', handler), 10)
    return () => { clearTimeout(timer); document.removeEventListener('mousedown', handler) }
  }, [showDropdown])

  const handleOrderSelect = useCallback((n: number) => {
    useGraphStore.getState().setEdgeImageOrder(id, n)
    setEdges(edges => edges.map(e => e.id === id ? { ...e, data: { ...e.data, imageOrder: n } } : e))
    setShowDropdown(false)
  }, [id, setEdges])

  const gradientId = `gradient-${id}`

  return (
    <>
      <path d={edgePath} fill="none" className="react-flow__edge-path" style={{ strokeWidth: 2, strokeOpacity: isHighlighted ? 0.9 : 0.5, transition: 'stroke-opacity 0.3s', stroke: color }} />
      <path d={edgePath} fill="none" strokeOpacity="0" strokeWidth="20" className="react-flow__edge-interaction" />
      <EdgeLabelRenderer>
        <div style={{ position: 'absolute', transform: `translate(-50%, -50%) translate(${labelX + 20}px, ${labelY}px) rotate(${angle}deg)`, pointerEvents: 'none' }}>
          <svg width="10" height="10" viewBox="0 0 10 10">
            <path d="M2 5L8 5M6 3L8 5L6 7" stroke={color} strokeWidth="1.5" fill="none" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </div>
        <div
          ref={dropdownRef}
          style={{ position: 'absolute', transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`, pointerEvents: 'all', zIndex: 1000 }}
          className="nodrag nopan"
        >
          <button
            onClick={(e) => { e.stopPropagation(); e.preventDefault(); setShowDropdown(p => !p) }}
            onMouseDown={e => e.stopPropagation()}
            className={`flex items-center justify-center w-6 h-6 rounded-full text-[10px] font-bold shadow-md border transition-shadow cursor-pointer ${selected ? 'ring-2 ring-blue-500' : ''}`}
            style={{ backgroundColor: color, color: '#fff', borderColor: 'rgba(255,255,255,0.3)' }}
          >
            {order}
          </button>
          {showDropdown && (
            <div className="absolute top-full left-1/2 -translate-x-1/2 mt-1 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-600 rounded-lg shadow-xl overflow-hidden min-w-[40px]" style={{ zIndex: 9999 }} onMouseDown={e => e.stopPropagation()}>
              {[1, 2, 3, 4, 5].map(n => (
                <button key={n} onClick={(e) => { e.stopPropagation(); handleOrderSelect(n) }} onMouseDown={e => e.stopPropagation()} className={`w-full px-3 py-1.5 text-xs text-center hover:bg-gray-100 dark:hover:bg-gray-700 ${order === n ? 'font-bold text-blue-600' : 'text-gray-700 dark:text-gray-200'}`}>
                  {n}
                </button>
              ))}
            </div>
          )}
        </div>
      </EdgeLabelRenderer>
    </>
  )
})
