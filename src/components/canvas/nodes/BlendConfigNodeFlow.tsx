/**
 * BlendConfigNodeFlow - React Flow 版本的图像融合配置节点
 * 简化版本，使用 Nexus 现有的样式模式
 */

import React, { memo, useState, useCallback, useRef, useEffect } from 'react'
import { Handle, Position, NodeProps } from '@xyflow/react'
import { Trash2 } from 'lucide-react'
import { useGraphStore } from '@/graph/store'
import { cn } from '@/lib/utils'

interface BlendConfigNodeData {
  label?: string
  method?: 'laplacian' | 'enhanced' | 'gemini' | 'kling'
  alpha?: number
  status?: 'ready' | 'processing' | 'completed' | 'error'
  progress?: number
  message?: string
}

const BLEND_METHODS = [
  { id: 'laplacian', label: '⚡ 快速' },
  { id: 'enhanced', label: '🟡 增强' },
  { id: 'gemini', label: '🧠 AI' },
  { id: 'kling', label: '🚀 专业' }
] as const

export const BlendConfigNodeComponent = memo(function BlendConfigNode({ 
  id, 
  data, 
  selected 
}: NodeProps) {
  const nodeData = data as BlendConfigNodeData
  const [method, setMethod] = useState(nodeData?.method || 'laplacian')
  const [alpha, setAlpha] = useState(nodeData?.alpha || 0.5)
  
  const status = nodeData?.status || 'ready'
  const isProcessing = status === 'processing'

  const updateTimerRef = useRef<number>(0)
  
  useEffect(() => {
    return () => {
      if (updateTimerRef.current) clearTimeout(updateTimerRef.current)
    }
  }, [])

  const updateNodeData = useCallback((updates: any) => {
    if (updateTimerRef.current) clearTimeout(updateTimerRef.current)
    updateTimerRef.current = window.setTimeout(() => {
      const store = useGraphStore.getState()
      store.patchNodeData(id, updates)
    }, 100)
  }, [id])

  const handleDelete = useCallback(() => {
    const store = useGraphStore.getState()
    store.deleteNode(id)
  }, [id])

  return (
    <div className={cn(
      'w-72 rounded-lg p-4 border-2 shadow-lg',
      'bg-gradient-to-br from-emerald-900 to-emerald-800',
      'border-emerald-500',
      selected && 'ring-2 ring-blue-400'
    )}>
      {/* Header */}
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <span className="text-xl">🎨</span>
          <h3 className="text-sm font-bold text-emerald-100">融合</h3>
        </div>
        <button
          onClick={handleDelete}
          className="p-1 hover:bg-emerald-700 rounded transition opacity-60 hover:opacity-100"
        >
          <Trash2 size={14} className="text-emerald-200" />
        </button>
      </div>

      {/* Method Buttons */}
      <div className="grid grid-cols-2 gap-2 mb-3">
        {BLEND_METHODS.map(m => (
          <button
            key={m.id}
            onClick={() => {
              setMethod(m.id as any)
              updateNodeData({ method: m.id })
            }}
            disabled={isProcessing}
            className={cn(
              'px-2 py-1 rounded text-xs font-semibold transition',
              method === m.id
                ? 'bg-emerald-500 text-white'
                : 'bg-emerald-800 text-emerald-200 hover:bg-emerald-700',
              isProcessing && 'opacity-50'
            )}
          >
            {m.label}
          </button>
        ))}
      </div>

      {/* Alpha Slider */}
      {(method === 'laplacian' || method === 'enhanced') && (
        <div className="mb-3">
          <div className="flex items-center justify-between mb-1">
            <label className="text-xs text-emerald-200 font-semibold">混合</label>
            <span className="text-xs text-emerald-300">{(alpha * 100).toFixed(0)}%</span>
          </div>
          <input
            type="range"
            min="0"
            max="1"
            step="0.05"
            value={alpha}
            onChange={(e) => {
              const val = Number(e.target.value)
              setAlpha(val)
              updateNodeData({ alpha: val })
            }}
            disabled={isProcessing}
            className="w-full h-2 bg-emerald-900 rounded cursor-pointer disabled:opacity-50"
          />
        </div>
      )}

      {/* Progress */}
      {isProcessing && (
        <div className="mb-3">
          <div className="flex items-center gap-2 mb-1">
            <div className="w-3 h-3 border-2 border-emerald-300 border-t-transparent rounded-full animate-spin" />
            <span className="text-xs text-emerald-300">{nodeData?.message || '融合中...'}</span>
          </div>
          <div className="w-full bg-emerald-950 rounded h-1 overflow-hidden">
            <div
              className="h-full bg-emerald-400 transition-all"
              style={{ width: `${nodeData?.progress || 0}%` }}
            />
          </div>
        </div>
      )}

      {/* Status */}
      {status === 'completed' && (
        <div className="mb-3 text-xs text-emerald-300 p-2 bg-emerald-950 rounded">
          ✓ 融合完成
        </div>
      )}

      {/* Execute Button */}
      <button className={cn(
        'w-full px-3 py-2 rounded text-xs font-semibold transition',
        'bg-emerald-500 hover:bg-emerald-400 text-white',
        isProcessing && 'opacity-50 cursor-not-allowed'
      )}
      disabled={isProcessing}>
        {isProcessing ? '融合中...' : '开始融合'}
      </button>

      {/* Handles */}
      <Handle position={Position.Top} type="target" />
      <Handle position={Position.Bottom} type="source" />
    </div>
  )
})

BlendConfigNodeComponent.displayName = 'BlendConfigNode'
