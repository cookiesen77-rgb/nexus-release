import React, { memo, useState, useCallback, useRef, useEffect } from 'react'
import { Handle, Position, NodeProps } from '@xyflow/react'
import { Trash2, Play, Loader2, Scissors, ChevronsRight, Sparkles } from 'lucide-react'
import { useGraphStore } from '@/graph/store'
import { runFromNode } from '@/lib/workflow/run'
import { TOOL_CHAT_MODELS } from '@/config/models'

const MODEL_OPTIONS = (TOOL_CHAT_MODELS as any[]).map((m: any, i: number) => ({
  value: `${m.key}::${i}`,
  key: m.key,
  label: m.label,
}))
const DEFAULT_MODEL_KEY = (TOOL_CHAT_MODELS as any[])[0]?.key || 'gemini-3-pro-preview-thinking'
const EXEC_TYPES = new Set(['llm', 'textSplitter', 'imageConfig', 'videoConfig'])

interface TextSplitterNodeData {
  label?: string
  instruction?: string
  model?: string
  enablePolish?: boolean
  status?: 'idle' | 'running' | 'done' | 'error'
  phase?: 'splitting' | 'polishing'
  phaseProgress?: string
  splitCount?: number
  errorMessage?: string
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

function countInputs(nodeId: string): number {
  const { nodes, edges } = useGraphStore.getState()
  let count = 0
  for (const edge of edges) {
    if (edge.target !== nodeId) continue
    const src = nodes.find(n => n.id === edge.source)
    if (!src) continue
    const d = src.data as any
    if ((src.type === 'text' && d?.content) ||
        (src.type === 'llm' && d?.output) ||
        (src.type === 'textSplitter' && d?.output)) count++
  }
  return count
}

export const TextSplitterNodeComponent = memo(function TextSplitterNode({ id, data, selected }: NodeProps) {
  const nodeData = data as TextSplitterNodeData
  const [instruction, setInstruction] = useState(nodeData?.instruction || '按分镜拆分，每段一个镜头')
  const [model, setModel] = useState(nodeData?.model || DEFAULT_MODEL_KEY)
  const [enablePolish, setEnablePolish] = useState(nodeData?.enablePolish !== false)
  const [status, setStatus] = useState<string>(nodeData?.status || 'idle')
  const [phase, setPhase] = useState(nodeData?.phase || '')
  const [phaseProgress, setPhaseProgress] = useState(nodeData?.phaseProgress || '')
  const [splitCount, setSplitCount] = useState(nodeData?.splitCount || 0)
  const [errorMessage, setErrorMessage] = useState(nodeData?.errorMessage || '')
  const [hasDownstream, setHasDownstream] = useState(false)
  const [inputCount, setInputCount] = useState(0)
  const instructionRef = useRef(instruction)
  const abortRef = useRef<AbortController | null>(null)

  useEffect(() => {
    if (nodeData?.status) setStatus(nodeData.status)
    if (nodeData?.splitCount !== undefined) setSplitCount(nodeData.splitCount)
    if (nodeData?.phase !== undefined) setPhase(nodeData.phase || '')
    if (nodeData?.phaseProgress !== undefined) setPhaseProgress(nodeData.phaseProgress || '')
    if (nodeData?.errorMessage !== undefined) setErrorMessage(nodeData.errorMessage || '')
  }, [nodeData?.status, nodeData?.splitCount, nodeData?.phase, nodeData?.phaseProgress, nodeData?.errorMessage])

  useEffect(() => {
    const refresh = () => {
      setHasDownstream(hasDownstreamExecutable(id))
      setInputCount(countInputs(id))
    }
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
    if (inputCount === 0) {
      window.$message?.warning?.('请连接 LLM 或文本节点作为输入')
      return
    }
    abortRef.current?.abort()
    const ctrl = new AbortController()
    abortRef.current = ctrl
    syncToStore({ instruction: instructionRef.current, model, enablePolish })
    await runFromNode(id, { signal: ctrl.signal })
  }, [id, model, enablePolish, syncToStore, inputCount])

  const handleStop = useCallback(() => { abortRef.current?.abort() }, [])

  const handleDelete = useCallback((e: React.MouseEvent) => {
    e.stopPropagation()
    abortRef.current?.abort()
    useGraphStore.getState().removeNode(id)
  }, [id])

  const statusText = status === 'running' && phase === 'splitting' ? '拆分中...'
    : status === 'running' && phase === 'polishing' ? `润色 ${phaseProgress}`
    : status === 'done' ? `已拆分 ${splitCount} 段`
    : status === 'error' ? '错误' : '就绪'

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
              {nodeData?.label || 'AI 智能拆分'}
            </span>
          </div>
          <div className="flex items-center gap-1">
            {status === 'running' ? (
              <button onClick={handleStop} className="p-1 hover:bg-red-500/20 rounded text-red-500" title="停止">
                <Loader2 size={14} className="animate-spin" />
              </button>
            ) : (
              <button
                onClick={handleRun}
                className="flex items-center gap-0.5 p-1 hover:bg-orange-500/20 rounded text-orange-500 transition-colors"
                title={hasDownstream ? '级联执行（含下游节点）' : '拆分'}
              >
                <Play size={14} />
                {hasDownstream && <ChevronsRight size={12} />}
              </button>
            )}
            <button onClick={handleDelete} className="p-1 hover:bg-[var(--bg-tertiary)] rounded" title="删除">
              <Trash2 size={14} />
            </button>
          </div>
        </div>

        <div className="px-3 pt-2">
          <label className="text-[11px] font-bold text-[var(--text-secondary)] uppercase">拆分指令</label>
          <textarea
            value={instruction}
            onChange={(e) => { instructionRef.current = e.target.value; setInstruction(e.target.value) }}
            onBlur={() => syncToStore({ instruction: instructionRef.current })}
            onMouseDown={(e) => e.stopPropagation()}
            onWheel={(e) => e.stopPropagation()}
            className="nodrag nowheel w-full mt-1 bg-[var(--bg-primary)] rounded-lg border border-[var(--border-color)] p-2 text-xs text-[var(--text-primary)] placeholder:text-[var(--text-secondary)] resize-none outline-none focus:border-orange-500 select-text"
            style={{ minHeight: 40, userSelect: 'text', WebkitUserSelect: 'text' }}
            placeholder="按场景拆分、按角色拆分、每个镜头独立..."
          />
        </div>

        <div className="px-3 py-1.5">
          <select
            value={model}
            onChange={(e) => { setModel(e.target.value); syncToStore({ model: e.target.value }) }}
            onMouseDown={(e) => e.stopPropagation()}
            className="nodrag w-full text-xs bg-[var(--bg-primary)] border border-[var(--border-color)] rounded-lg px-2 py-1.5 outline-none focus:border-orange-500 text-[var(--text-primary)]"
          >
            {MODEL_OPTIONS.map(opt => (
              <option key={opt.value} value={opt.key}>{opt.label}</option>
            ))}
          </select>
        </div>

        <div className="px-3 pb-1.5">
          <label
            className="flex items-center gap-1.5 text-[11px] text-[var(--text-secondary)] cursor-pointer select-none"
            onMouseDown={(e) => e.stopPropagation()}
          >
            <input
              type="checkbox"
              checked={enablePolish}
              onChange={(e) => { setEnablePolish(e.target.checked); syncToStore({ enablePolish: e.target.checked }) }}
              className="nodrag rounded border-[var(--border-color)] accent-orange-500"
            />
            <Sparkles size={11} className="text-orange-400" />
            拆分后逐段 AI 润色
          </label>
        </div>

        {errorMessage && status === 'error' && (
          <div className="px-3 pb-1.5">
            <div className="rounded-lg bg-red-500/10 px-3 py-1.5 text-[11px] text-red-500 truncate">
              {errorMessage}
            </div>
          </div>
        )}

        <div className="flex items-center justify-between px-3 py-1.5 border-t border-[var(--border-color)]">
          <div className="flex items-center gap-1.5">
            <div className={`w-1.5 h-1.5 rounded-full ${
              status === 'running' ? 'bg-amber-500 animate-pulse' :
              status === 'done' ? 'bg-emerald-500' :
              status === 'error' ? 'bg-red-500' : 'bg-gray-400'
            }`} />
            <span className="text-[10px] text-[var(--text-secondary)]">{statusText}</span>
          </div>
          <div className="flex items-center gap-1.5">
            {inputCount > 0 && (
              <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-orange-500/10 text-orange-500">
                {inputCount} 输入
              </span>
            )}
            {hasDownstream && (
              <span className="text-[10px] text-blue-500">下游 →</span>
            )}
          </div>
        </div>

        <Handle type="target" position={Position.Left} id="left" className="handle-text" />
        <Handle type="source" position={Position.Right} id="right" className="handle-text" />
      </div>
    </div>
  )
})
