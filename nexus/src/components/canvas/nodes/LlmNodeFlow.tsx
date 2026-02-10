import React, { memo, useState, useCallback, useRef, useEffect } from 'react'
import { Handle, Position, NodeProps } from '@xyflow/react'
import { Trash2, Play, Copy, Check, Square, ChevronsRight } from 'lucide-react'
import { useGraphStore } from '@/graph/store'
import { CHAT_MODELS } from '@/config/models'
import { runFromNode } from '@/lib/workflow/run'

const MODEL_OPTIONS = (CHAT_MODELS as any[]).map((m: any, i: number) => ({
  value: `${m.key}::${i}`,
  key: m.key,
  label: m.label,
}))
const DEFAULT_MODEL_KEY = (CHAT_MODELS as any[])[0]?.key || 'gemini-3-pro-preview-thinking'

interface LlmNodeData {
  label?: string
  model?: string
  instruction?: string
  output?: string
  status?: 'idle' | 'running' | 'done' | 'error'
  errorMessage?: string
}

/** 统计上游有效输入连接数 */
function countUpstreamInputs(nodeId: string): number {
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

/** 检查下游是否还有可执行节点 */
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
    if (n && ['llm', 'textSplitter', 'imageConfig', 'videoConfig'].includes(n.type)) return true
    for (const e of edges) {
      if (e.source === cur) queue.push(e.target)
    }
  }
  return false
}

export const LlmNodeComponent = memo(function LlmNode({ id, data, selected }: NodeProps) {
  const nodeData = data as LlmNodeData
  const [instruction, setInstruction] = useState(nodeData?.instruction || '')
  const [output, setOutput] = useState(nodeData?.output || '')
  const [model, setModel] = useState(nodeData?.model || DEFAULT_MODEL_KEY)
  const [status, setStatus] = useState<'idle' | 'running' | 'done' | 'error'>(nodeData?.status as any || 'idle')
  const [errorMessage, setErrorMessage] = useState(nodeData?.errorMessage || '')
  const [copied, setCopied] = useState(false)
  const [inputCount, setInputCount] = useState(0)
  const [hasDownstream, setHasDownstream] = useState(false)

  const abortRef = useRef<AbortController | null>(null)
  const instructionRef = useRef(instruction)

  // 外部 store 变化 → 同步到本地 state
  useEffect(() => {
    if (nodeData?.output !== undefined) setOutput(nodeData.output)
    if (nodeData?.status) setStatus(nodeData.status as any)
    if (nodeData?.model) setModel(nodeData.model)
    if (nodeData?.instruction !== undefined && nodeData.instruction !== instructionRef.current) {
      setInstruction(nodeData.instruction)
      instructionRef.current = nodeData.instruction
    }
    if (nodeData?.errorMessage !== undefined) setErrorMessage(nodeData.errorMessage)
  }, [nodeData?.output, nodeData?.status, nodeData?.model, nodeData?.instruction, nodeData?.errorMessage])

  // 上游连接数 & 下游可执行节点跟踪
  useEffect(() => {
    const refresh = () => {
      setInputCount(countUpstreamInputs(id))
      setHasDownstream(hasDownstreamExecutable(id))
    }
    refresh()
    return useGraphStore.subscribe((s, p) => {
      if (s.edges !== p.edges || s.nodes !== p.nodes) refresh()
    })
  }, [id])

  useEffect(() => () => { abortRef.current?.abort() }, [])

  const sync = useCallback((patch: Record<string, unknown>) => {
    useGraphStore.getState().updateNode(id, { data: patch })
  }, [id])

  /** 级联执行：从当前节点开始执行整条链路 */
  const handleRunCascade = useCallback(async () => {
    const inst = instructionRef.current.trim()
    // flush instruction & model to store
    sync({ instruction: inst, model })

    // 校验：无上游输入也无指令时给提示
    if (inputCount === 0 && !inst) {
      window.$message?.warning?.('请连接输入或填写指令')
      return
    }

    abortRef.current?.abort()
    const ctrl = new AbortController()
    abortRef.current = ctrl

    try {
      await runFromNode(id, { signal: ctrl.signal })
    } catch (err: any) {
      if (!ctrl.signal.aborted) {
        window.$message?.error?.(err?.message || '执行失败')
      }
    }
  }, [id, model, inputCount, sync])

  const handleStop = useCallback(() => {
    abortRef.current?.abort()
  }, [])

  const handleCopy = useCallback(async () => {
    if (!output) return
    await navigator.clipboard.writeText(output).catch(() => {})
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }, [output])

  const handleDelete = useCallback((e: React.MouseEvent) => {
    e.stopPropagation()
    abortRef.current?.abort()
    useGraphStore.getState().removeNode(id)
  }, [id])

  return (
    <div className="relative">
      <div
        className={`bg-[var(--bg-secondary)] rounded-xl border transition-all duration-200 ${
          selected ? 'border-emerald-500 shadow-lg shadow-emerald-500/20' : 'border-[var(--border-color)]'
        }`}
        style={{ width: 360 }}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-3 py-2 border-b border-[var(--border-color)]">
          <div className="flex items-center gap-2">
            <span className="text-xs font-bold px-1.5 py-0.5 rounded bg-emerald-500/15 text-emerald-500">LLM</span>
            <span className="text-sm font-medium text-[var(--text-primary)]">
              {nodeData?.label || 'Text Generator'}
            </span>
          </div>
          <div className="flex items-center gap-1">
            {status === 'running' ? (
              <button onClick={handleStop} className="p-1 hover:bg-red-500/20 rounded text-red-500" title="停止">
                <Square size={12} fill="currentColor" />
              </button>
            ) : (
              <button onClick={handleRunCascade} className="flex items-center gap-0.5 p-1 hover:bg-emerald-500/20 rounded text-emerald-500 transition-colors" title={hasDownstream ? '级联执行（含下游节点）' : '运行'}>
                <Play size={14} />
                {hasDownstream && <ChevronsRight size={12} />}
              </button>
            )}
            <button onClick={handleDelete} className="p-1 hover:bg-[var(--bg-tertiary)] rounded" title="删除">
              <Trash2 size={14} />
            </button>
          </div>
        </div>

        {/* Instruction */}
        <div className="px-3 pt-2">
          <label className="text-[11px] font-bold text-[var(--text-secondary)] uppercase">指令</label>
          <textarea
            value={instruction}
            onChange={(e) => { instructionRef.current = e.target.value; setInstruction(e.target.value) }}
            onBlur={() => sync({ instruction: instructionRef.current })}
            onMouseDown={(e) => e.stopPropagation()}
            onWheel={(e) => e.stopPropagation()}
            className="nodrag nowheel w-full mt-1 bg-[var(--bg-primary)] rounded-lg border border-[var(--border-color)] p-2 text-xs text-[var(--text-primary)] placeholder:text-[var(--text-secondary)] resize-none outline-none focus:border-emerald-500 select-text"
            style={{ minHeight: 60, userSelect: 'text', WebkitUserSelect: 'text' }}
            placeholder="描述任务指令（如：翻译成英文、改写为小说风格、总结要点、扩写为分镜脚本…）"
          />
        </div>

        {/* Model Selector */}
        <div className="px-3 py-2">
          <select
            value={model}
            onChange={(e) => { setModel(e.target.value); sync({ model: e.target.value }) }}
            onMouseDown={(e) => e.stopPropagation()}
            className="nodrag w-full text-xs bg-[var(--bg-primary)] border border-[var(--border-color)] rounded-lg px-2 py-1.5 outline-none focus:border-emerald-500 text-[var(--text-primary)]"
          >
            {MODEL_OPTIONS.map(opt => (
              <option key={opt.value} value={opt.key}>{opt.label}</option>
            ))}
          </select>
        </div>

        {/* Connection Status */}
        <div className="px-3 pb-2 flex items-center gap-2">
          <span className={`text-[11px] px-1.5 py-0.5 rounded-full ${
            inputCount > 0
              ? 'bg-emerald-500/10 text-emerald-500'
              : 'bg-[var(--bg-tertiary)] text-[var(--text-secondary)]'
          }`}>
            {inputCount > 0 ? `${inputCount} 条输入 ✓` : '输入 ○'}
          </span>
          {hasDownstream && (
            <span className="text-[11px] px-1.5 py-0.5 rounded-full bg-blue-500/10 text-blue-500">
              有下游节点 →
            </span>
          )}
        </div>

        {/* Output */}
        {(output || status === 'running') && (
          <div className="px-3 pb-3">
            <div className="flex items-center justify-between mb-1">
              <label className="text-[11px] font-bold text-[var(--text-secondary)] uppercase">输出</label>
              {output && status !== 'running' && (
                <button onClick={handleCopy} className="p-0.5 hover:bg-[var(--bg-tertiary)] rounded text-[var(--text-secondary)]" title="复制">
                  {copied ? <Check size={12} className="text-emerald-500" /> : <Copy size={12} />}
                </button>
              )}
            </div>
            <div
              onWheel={(e) => e.stopPropagation()}
              className="nowheel max-h-[200px] overflow-auto rounded-lg border border-[var(--border-color)] bg-[var(--bg-primary)] p-2"
            >
              <pre className="whitespace-pre-wrap text-xs text-[var(--text-primary)] font-mono leading-relaxed select-text" style={{ userSelect: 'text', WebkitUserSelect: 'text' }}>
                {output || '生成中...'}
              </pre>
            </div>
          </div>
        )}

        {/* Error */}
        {status === 'error' && errorMessage && (
          <div className="px-3 pb-2">
            <div className="rounded-lg bg-red-500/10 px-3 py-1.5 text-[11px] text-red-500 truncate">
              {errorMessage}
            </div>
          </div>
        )}

        {/* Status bar */}
        <div className="flex items-center justify-between px-3 py-1.5 border-t border-[var(--border-color)]">
          <div className="flex items-center gap-1.5">
            <div className={`w-1.5 h-1.5 rounded-full ${
              status === 'running' ? 'bg-amber-500 animate-pulse' :
              status === 'done' ? 'bg-emerald-500' :
              status === 'error' ? 'bg-red-500' : 'bg-gray-400'
            }`} />
            <span className="text-[10px] text-[var(--text-secondary)]">
              {status === 'running' ? '生成中' : status === 'done' ? '完成' : status === 'error' ? '错误' : '就绪'}
            </span>
          </div>
        </div>

        <Handle type="target" position={Position.Left} id="left" className="handle-text" />
        <Handle type="source" position={Position.Right} id="right" className="handle-text" />
      </div>
    </div>
  )
})
