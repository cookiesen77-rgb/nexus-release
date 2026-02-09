import React, { memo, useState, useCallback, useRef } from 'react'
import { Handle, Position, NodeProps } from '@xyflow/react'
import { Trash2, Play, Loader2, Scissors } from 'lucide-react'
import { useGraphStore } from '@/graph/store'

interface TextSplitterNodeData {
  label?: string
  instruction?: string
  status?: 'idle' | 'running' | 'done' | 'error'
  splitCount?: number
}

export const TextSplitterNodeComponent = memo(function TextSplitterNode({ id, data, selected }: NodeProps) {
  const nodeData = data as TextSplitterNodeData
  const [instruction, setInstruction] = useState(nodeData?.instruction || '按分镜拆分，每段一个镜头')
  const [status, setStatus] = useState<'idle' | 'running' | 'done' | 'error'>(nodeData?.status as any || 'idle')
  const [splitCount, setSplitCount] = useState(nodeData?.splitCount || 0)
  const instructionRef = useRef(instruction)

  const syncToStore = useCallback((patch: Record<string, unknown>) => {
    useGraphStore.getState().updateNode(id, { data: patch })
  }, [id])

  const handleInstructionBlur = useCallback(() => {
    syncToStore({ instruction: instructionRef.current })
  }, [syncToStore])

  const collectInputText = useCallback((): string => {
    const { nodes, edges } = useGraphStore.getState()
    const incomingEdges = edges.filter(e => e.target === id)
    const parts: string[] = []
    for (const edge of incomingEdges) {
      const srcNode = nodes.find(n => n.id === edge.source)
      if (!srcNode) continue
      if (srcNode.type === 'text') {
        const content = (srcNode.data as any)?.content
        if (content) parts.push(String(content))
      } else if (srcNode.type === 'llm') {
        const out = (srcNode.data as any)?.output
        if (out) parts.push(String(out))
      }
    }
    return parts.join('\n\n')
  }, [id])

  const handleRun = useCallback(() => {
    const inputText = collectInputText()
    if (!inputText.trim()) {
      window.$message?.warning?.('请连接 LLM 或文本节点作为输入')
      return
    }

    setStatus('running')
    syncToStore({ status: 'running' })

    const rule = instructionRef.current.trim() || '按段落拆分'

    // 拆分策略
    let segments: string[]

    // 优先按 [SHOT x/N] 格式拆分
    const shotRegex = /\[SHOT\s+\d+\/\d+\]/gi
    if (shotRegex.test(inputText)) {
      segments = inputText.split(/(?=\[SHOT\s+\d+\/\d+\])/gi).map(s => s.trim()).filter(Boolean)
    }
    // 按 JSON 数组拆分
    else if (inputText.trim().startsWith('[')) {
      try {
        const arr = JSON.parse(inputText)
        if (Array.isArray(arr) && arr.every(s => typeof s === 'string')) {
          segments = arr.filter(Boolean)
        } else {
          segments = inputText.split(/\n{2,}/).map(s => s.trim()).filter(Boolean)
        }
      } catch {
        segments = inputText.split(/\n{2,}/).map(s => s.trim()).filter(Boolean)
      }
    }
    // 按双换行拆分
    else {
      segments = inputText.split(/\n{2,}/).map(s => s.trim()).filter(Boolean)
    }

    // 单段不拆分
    if (segments.length <= 1) {
      segments = inputText.split('\n').map(s => s.trim()).filter(s => s.length > 10)
    }

    if (segments.length === 0) {
      segments = [inputText.trim()]
    }

    // 创建下游 text 节点
    const store = useGraphStore.getState()
    const thisNode = store.nodes.find(n => n.id === id)
    if (!thisNode) return

    // 防止重复执行创建重复节点
    const existingDownstream = store.edges.filter(e => e.source === id)
    if (existingDownstream.length > 0) {
      setSplitCount(existingDownstream.length)
      setStatus('done')
      syncToStore({ status: 'done', splitCount: existingDownstream.length })
      return
    }

    const startX = thisNode.x + 420
    const startY = thisNode.y
    const yGap = 180

    store.withBatchUpdates(() => {
      for (let i = 0; i < segments.length; i++) {
        const newId = store.addNode('text', { x: startX, y: startY + i * yGap }, {
          label: `分镜 ${i + 1}`,
          content: segments[i]
        })
        store.addEdge(id, newId, { sourceHandle: 'right', targetHandle: 'left' })
      }
    })

    setSplitCount(segments.length)
    setStatus('done')
    syncToStore({ status: 'done', splitCount: segments.length })
  }, [id, collectInputText, syncToStore])

  const handleDelete = useCallback((e: React.MouseEvent) => {
    e.stopPropagation()
    useGraphStore.getState().removeNode(id)
  }, [id])

  return (
    <div className="relative">
      <div
        className={`bg-[var(--bg-secondary)] rounded-xl border transition-all duration-200 ${
          selected ? 'border-orange-500 shadow-lg shadow-orange-500/20' : 'border-[var(--border-color)]'
        }`}
        style={{ width: 320 }}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-3 py-2 border-b border-[var(--border-color)]">
          <div className="flex items-center gap-2">
            <Scissors size={14} className="text-orange-500" />
            <span className="text-sm font-medium text-[var(--text-primary)]">
              {nodeData?.label || 'Text Splitter'}
            </span>
          </div>
          <div className="flex items-center gap-1">
            <button
              onClick={handleRun}
              disabled={status === 'running'}
              className="p-1 hover:bg-orange-500/20 rounded text-orange-500 transition-colors disabled:opacity-50"
              title="拆分"
            >
              {status === 'running' ? <Loader2 size={14} className="animate-spin" /> : <Play size={14} />}
            </button>
            <button onClick={handleDelete} className="p-1 hover:bg-[var(--bg-tertiary)] rounded" title="删除">
              <Trash2 size={14} />
            </button>
          </div>
        </div>

        {/* Instruction */}
        <div className="px-3 py-2">
          <label className="text-[11px] font-bold text-[var(--text-secondary)] uppercase">拆分规则</label>
          <textarea
            value={instruction}
            onChange={(e) => { instructionRef.current = e.target.value; setInstruction(e.target.value) }}
            onBlur={handleInstructionBlur}
            onMouseDown={(e) => e.stopPropagation()}
            onWheel={(e) => e.stopPropagation()}
            className="nodrag nowheel w-full mt-1 bg-[var(--bg-primary)] rounded-lg border border-[var(--border-color)] p-2 text-xs text-[var(--text-primary)] placeholder:text-[var(--text-secondary)] resize-none outline-none focus:border-orange-500 select-text"
            style={{ minHeight: 40, userSelect: 'text', WebkitUserSelect: 'text' }}
            placeholder="按分镜拆分..."
          />
        </div>

        {/* Status */}
        <div className="flex items-center justify-between px-3 py-1.5 border-t border-[var(--border-color)]">
          <div className="flex items-center gap-1.5">
            <div className={`w-1.5 h-1.5 rounded-full ${
              status === 'running' ? 'bg-amber-500 animate-pulse' :
              status === 'done' ? 'bg-emerald-500' : 'bg-gray-400'
            }`} />
            <span className="text-[10px] text-[var(--text-secondary)]">
              {status === 'done' ? `已拆分 ${splitCount} 段` : status === 'running' ? '拆分中' : '就绪'}
            </span>
          </div>
        </div>

        <Handle type="target" position={Position.Left} id="left" className="handle-text" />
        <Handle type="source" position={Position.Right} id="right" className="handle-text" />
      </div>
    </div>
  )
})
