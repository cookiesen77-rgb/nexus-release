import React, { memo, useState, useCallback, useRef, useEffect } from 'react'
import { Handle, Position, NodeProps } from '@xyflow/react'
import { Trash2, Play, Loader2, Scissors, ChevronsRight } from 'lucide-react'
import { useGraphStore } from '@/graph/store'
import { runFromNode } from '@/lib/workflow/run'

const EXEC_TYPES = new Set(['llm', 'textSplitter', 'imageConfig', 'videoConfig'])

interface TextSplitterNodeData {
  label?: string
  instruction?: string
  status?: 'idle' | 'running' | 'done' | 'error'
  splitCount?: number
}

function collectInputText(nodeId: string): string {
  const { nodes, edges } = useGraphStore.getState()
  const parts: string[] = []
  for (const edge of edges) {
    if (edge.target !== nodeId) continue
    const src = nodes.find(n => n.id === edge.source)
    if (!src) continue
    const d = src.data as any
    if (src.type === 'text' && d?.content) parts.push(String(d.content))
    else if (src.type === 'llm' && d?.output) parts.push(String(d.output))
    else if (src.type === 'textSplitter' && d?.output) parts.push(String(d.output))
  }
  return parts.join('\n\n')
}

function hasDownstreamExecutable(nodeId: string): boolean {
  const { nodes, edges } = useGraphStore.getState()
  const visited = new Set<string>()
  const queue: string[] = []
  for (const e of edges) {
    if (e.source === nodeId) queue.push(e.target)
  }
  while (queue.length > 0) {
    const cur = queue.shift()!
    if (visited.has(cur)) continue
    visited.add(cur)
    const n = nodes.find(x => x.id === cur)
    if (n && EXEC_TYPES.has(n.type)) return true
    for (const e of edges) {
      if (e.source === cur) queue.push(e.target)
    }
  }
  return false
}

function firstDownstreamExecId(nodeId: string): string | null {
  const { nodes, edges } = useGraphStore.getState()
  for (const e of edges) {
    if (e.source !== nodeId) continue
    const n = nodes.find(x => x.id === e.target)
    if (n && EXEC_TYPES.has(n.type)) return n.id
  }
  return null
}

export const TextSplitterNodeComponent = memo(function TextSplitterNode({ id, data, selected }: NodeProps) {
  const nodeData = data as TextSplitterNodeData
  const [instruction, setInstruction] = useState(nodeData?.instruction || '按分镜拆分，每段一个镜头')
  const [status, setStatus] = useState<'idle' | 'running' | 'done' | 'error'>(nodeData?.status as any || 'idle')
  const [splitCount, setSplitCount] = useState(nodeData?.splitCount || 0)
  const [hasDownstream, setHasDownstream] = useState(false)
  const instructionRef = useRef(instruction)
  const abortRef = useRef<AbortController | null>(null)

  useEffect(() => {
    if (nodeData?.status) setStatus(nodeData.status as any)
    if (nodeData?.splitCount !== undefined) setSplitCount(nodeData.splitCount)
  }, [nodeData?.status, nodeData?.splitCount])

  useEffect(() => {
    const refresh = () => setHasDownstream(hasDownstreamExecutable(id))
    refresh()
    return useGraphStore.subscribe((s, p) => {
      if (s.edges !== p.edges || s.nodes !== p.nodes) refresh()
    })
  }, [id])

  useEffect(() => () => { abortRef.current?.abort() }, [])

  const syncToStore = useCallback((patch: Record<string, unknown>) => {
    useGraphStore.getState().updateNode(id, { data: patch })
  }, [id])

  const handleRun = useCallback(async () => {
    const inputText = collectInputText(id)
    if (!inputText.trim()) {
      window.$message?.warning?.('请连接 LLM 或文本节点作为输入')
      return
    }

    abortRef.current?.abort()
    const ctrl = new AbortController()
    abortRef.current = ctrl

    setStatus('running')
    syncToStore({ instruction: instructionRef.current, status: 'running' })

    // 拆分
    let segments: string[]
    const shotRegex = /\[SHOT\s+\d+\/\d+\]/gi
    if (shotRegex.test(inputText)) {
      segments = inputText.split(/(?=\[SHOT\s+\d+\/\d+\])/gi).map(s => s.trim()).filter(Boolean)
    } else if (inputText.trim().startsWith('[')) {
      try {
        const arr = JSON.parse(inputText)
        segments = Array.isArray(arr) && arr.every(s => typeof s === 'string') ? arr.filter(Boolean) : inputText.split(/\n{2,}/).map(s => s.trim()).filter(Boolean)
      } catch {
        segments = inputText.split(/\n{2,}/).map(s => s.trim()).filter(Boolean)
      }
    } else {
      segments = inputText.split(/\n{2,}/).map(s => s.trim()).filter(Boolean)
    }
    if (segments.length <= 1) {
      segments = inputText.split('\n').map(s => s.trim()).filter(s => s.length > 10)
    }
    if (segments.length === 0) segments = [inputText.trim()]

    // 防重复：检查下游是否已有 text 节点
    const store = useGraphStore.getState()
    const thisNode = store.nodes.find(n => n.id === id)
    if (!thisNode) return

    const existingTextDown = store.edges
      .filter(e => e.source === id)
      .map(e => store.nodes.find(n => n.id === e.target))
      .filter(n => n?.type === 'text')
    if (existingTextDown.length > 0) {
      setSplitCount(existingTextDown.length)
      setStatus('done')
      syncToStore({ status: 'done', splitCount: existingTextDown.length })
      // 已有下游 → 仍然级联
      const downId = firstDownstreamExecId(id)
      if (downId) await runFromNode(downId, { signal: ctrl.signal })
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

    // 本节点完成 → 级联下游
    const downId = firstDownstreamExecId(id)
    if (downId) {
      await runFromNode(downId, { signal: ctrl.signal })
    }
  }, [id, syncToStore])

  const handleDelete = useCallback((e: React.MouseEvent) => {
    e.stopPropagation()
    abortRef.current?.abort()
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
              className="flex items-center gap-0.5 p-1 hover:bg-orange-500/20 rounded text-orange-500 transition-colors disabled:opacity-50"
              title={hasDownstream ? '级联执行（含下游节点）' : '拆分'}
            >
              {status === 'running' ? <Loader2 size={14} className="animate-spin" /> : <Play size={14} />}
              {hasDownstream && status !== 'running' && <ChevronsRight size={12} />}
            </button>
            <button onClick={handleDelete} className="p-1 hover:bg-[var(--bg-tertiary)] rounded" title="删除">
              <Trash2 size={14} />
            </button>
          </div>
        </div>

        <div className="px-3 py-2">
          <label className="text-[11px] font-bold text-[var(--text-secondary)] uppercase">拆分规则</label>
          <textarea
            value={instruction}
            onChange={(e) => { instructionRef.current = e.target.value; setInstruction(e.target.value) }}
            onBlur={() => syncToStore({ instruction: instructionRef.current })}
            onMouseDown={(e) => e.stopPropagation()}
            onWheel={(e) => e.stopPropagation()}
            className="nodrag nowheel w-full mt-1 bg-[var(--bg-primary)] rounded-lg border border-[var(--border-color)] p-2 text-xs text-[var(--text-primary)] placeholder:text-[var(--text-secondary)] resize-none outline-none focus:border-orange-500 select-text"
            style={{ minHeight: 40, userSelect: 'text', WebkitUserSelect: 'text' }}
            placeholder="按分镜拆分..."
          />
        </div>

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
          {hasDownstream && (
            <span className="text-[10px] text-blue-500">有下游 →</span>
          )}
        </div>

        <Handle type="target" position={Position.Left} id="left" className="handle-text" />
        <Handle type="source" position={Position.Right} id="right" className="handle-text" />
      </div>
    </div>
  )
})
