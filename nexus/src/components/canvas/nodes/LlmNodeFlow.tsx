import React, { memo, useState, useCallback, useRef, useEffect } from 'react'
import { Handle, Position, NodeProps } from '@xyflow/react'
import { Trash2, Play, Copy, Check, Square, ChevronsRight, Eraser, Globe, Workflow } from 'lucide-react'
import { useGraphStore } from '@/graph/store'
import { TOOL_CHAT_MODELS } from '@/config/models'
import { streamAiAssistant } from '@/lib/nexusApi'
import { buildCanvasContext } from '@/lib/contextEngine'
import { runFromNode } from '@/lib/workflow/run'

const MODEL_OPTIONS = (TOOL_CHAT_MODELS as any[]).map((m: any, i: number) => ({
  value: `${m.key}::${i}`,
  key: m.key,
  label: m.label,
}))
const DEFAULT_MODEL_KEY = (TOOL_CHAT_MODELS as any[])[0]?.key || 'gemini-3-pro-preview-thinking'
const EXEC_TYPES = new Set(['llm', 'textSplitter', 'imageConfig', 'videoConfig'])

interface HistoryEntry { role: 'user' | 'assistant'; content: string }

interface LlmNodeData {
  label?: string
  model?: string
  instruction?: string
  output?: string
  status?: 'idle' | 'running' | 'done' | 'error'
  errorMessage?: string
  history?: HistoryEntry[]
  enableContext?: boolean
  autoOrchestrate?: boolean
}

function collectUpstreamText(nodeId: string): string {
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

export const LlmNodeComponent = memo(function LlmNode({ id, data, selected }: NodeProps) {
  const nodeData = data as LlmNodeData
  const [instruction, setInstruction] = useState(nodeData?.instruction || '')
  const [output, setOutput] = useState(nodeData?.output || '')
  const [model, setModel] = useState(nodeData?.model || DEFAULT_MODEL_KEY)
  const [status, setStatus] = useState<string>(nodeData?.status || 'idle')
  const [errorMessage, setErrorMessage] = useState(nodeData?.errorMessage || '')
  const [copied, setCopied] = useState(false)
  const [inputCount, setInputCount] = useState(0)
  const [hasDownstream, setHasDownstream] = useState(false)
  const [history, setHistory] = useState<HistoryEntry[]>(nodeData?.history || [])
  const [followUp, setFollowUp] = useState('')
  const [enableContext, setEnableContext] = useState(nodeData?.enableContext !== false)
  const [autoOrchestrate, setAutoOrchestrate] = useState(nodeData?.autoOrchestrate === true)

  const abortRef = useRef<AbortController | null>(null)
  const instructionRef = useRef(instruction)
  const outputRef = useRef(output)
  const followUpRef = useRef('')

  useEffect(() => {
    if (nodeData?.output !== undefined) { setOutput(nodeData.output); outputRef.current = nodeData.output }
    if (nodeData?.status) setStatus(nodeData.status)
    if (nodeData?.model) setModel(nodeData.model)
    if (nodeData?.instruction !== undefined && nodeData.instruction !== instructionRef.current) {
      setInstruction(nodeData.instruction); instructionRef.current = nodeData.instruction
    }
    if (nodeData?.errorMessage !== undefined) setErrorMessage(nodeData.errorMessage)
    if (nodeData?.history !== undefined) setHistory(nodeData.history || [])
  }, [nodeData?.output, nodeData?.status, nodeData?.model, nodeData?.instruction, nodeData?.errorMessage, nodeData?.history])

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

  const handleRun = useCallback(async () => {
    const inputText = collectUpstreamText(id)
    const inst = instructionRef.current.trim()
    const followUpText = followUpRef.current.trim()

    if (!inputText && !inst && !followUpText && history.length === 0) {
      window.$message?.warning?.('请连接输入或填写指令')
      return
    }

    abortRef.current?.abort()
    const ctrl = new AbortController()
    abortRef.current = ctrl

    setStatus('running')
    setOutput('')
    setErrorMessage('')
    outputRef.current = ''
    sync({ instruction: inst, model, status: 'running', output: '', errorMessage: '', enableContext, autoOrchestrate })

    try {
      const messages: any[] = []
      if (inst) messages.push({ role: 'system', content: inst })

      if (enableContext) {
        const { nodes, edges } = useGraphStore.getState()
        const ctx = buildCanvasContext({ nodes, edges, selectedNodeId: id })
        if (ctx) messages.push({ role: 'system', content: `【画布上下文】\n${ctx}` })
      }

      for (const h of history) {
        messages.push({ role: h.role, content: h.content })
      }

      const userContent = followUpText || inputText || inst
      messages.push({ role: 'user', content: userContent })

      let full = ''
      for await (const chunk of streamAiAssistant(model, messages, { signal: ctrl.signal, filterThinking: true })) {
        full += chunk
        outputRef.current = full
        setOutput(full)
      }

      const newHistory = [...history, { role: 'user' as const, content: userContent }, { role: 'assistant' as const, content: full }]
      setHistory(newHistory)
      setStatus('done')
      sync({ output: full, status: 'done', history: newHistory })

      setFollowUp('')
      followUpRef.current = ''

      const downId = firstDownstreamExecId(id)
      if (downId) {
        await runFromNode(downId, { signal: ctrl.signal })
      }
    } catch (err: any) {
      if (ctrl.signal.aborted) {
        const partial = outputRef.current
        if (partial) { setStatus('done'); sync({ output: partial, status: 'done' }) }
        else { setStatus('idle'); sync({ status: 'idle' }) }
        return
      }
      const msg = err?.message || '生成失败'
      setStatus('error')
      setErrorMessage(msg)
      sync({ status: 'error', errorMessage: msg })
    }
  }, [id, model, history, enableContext, autoOrchestrate, sync])

  const handleStop = useCallback(() => { abortRef.current?.abort() }, [])

  const handleCopy = useCallback(async () => {
    const text = history.length > 0
      ? history.map(h => `[${h.role}]\n${h.content}`).join('\n\n')
      : output
    if (!text) return
    await navigator.clipboard.writeText(text).catch(() => {})
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }, [output, history])

  const handleClearHistory = useCallback(() => {
    setHistory([])
    setOutput('')
    outputRef.current = ''
    sync({ history: [], output: '' })
  }, [sync])

  const handleDelete = useCallback((e: React.MouseEvent) => {
    e.stopPropagation()
    abortRef.current?.abort()
    useGraphStore.getState().removeNode(id)
  }, [id])

  const rounds = Math.floor(history.length / 2)

  return (
    <div className="relative">
      <div
        className={`bg-[var(--bg-secondary)] rounded-xl border transition-all duration-200 ${
          selected ? 'border-emerald-500 shadow-lg shadow-emerald-500/20' : 'border-[var(--border-color)]'
        }`}
        style={{ width: 380 }}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-3 py-2 border-b border-[var(--border-color)]">
          <div className="flex items-center gap-2">
            <span className="text-xs font-bold px-1.5 py-0.5 rounded bg-emerald-500/15 text-emerald-500">LLM</span>
            <span className="text-sm font-medium text-[var(--text-primary)]">
              {nodeData?.label || 'Text Generator'}
            </span>
            {rounds > 0 && (
              <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-blue-500/10 text-blue-400">{rounds} 轮</span>
            )}
          </div>
          <div className="flex items-center gap-1">
            {status === 'running' ? (
              <button onClick={handleStop} className="p-1 hover:bg-red-500/20 rounded text-red-500" title="停止">
                <Square size={12} fill="currentColor" />
              </button>
            ) : (
              <button onClick={handleRun} className="flex items-center gap-0.5 p-1 hover:bg-emerald-500/20 rounded text-emerald-500 transition-colors" title={hasDownstream ? '级联执行（含下游节点）' : '运行'}>
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
            style={{ minHeight: 52, userSelect: 'text', WebkitUserSelect: 'text' }}
            placeholder="描述任务指令（如：翻译成英文、改写为小说风格、总结要点、扩写为分镜脚本…）"
          />
        </div>

        {/* Model + Options */}
        <div className="px-3 py-1.5 flex gap-2">
          <select
            value={model}
            onChange={(e) => { setModel(e.target.value); sync({ model: e.target.value }) }}
            onMouseDown={(e) => e.stopPropagation()}
            className="nodrag flex-1 text-xs bg-[var(--bg-primary)] border border-[var(--border-color)] rounded-lg px-2 py-1.5 outline-none focus:border-emerald-500 text-[var(--text-primary)]"
          >
            {MODEL_OPTIONS.map(opt => (
              <option key={opt.value} value={opt.key}>{opt.label}</option>
            ))}
          </select>
        </div>

        {/* Toggles */}
        <div className="px-3 pb-1.5 flex items-center gap-3" onMouseDown={(e) => e.stopPropagation()}>
          <label className="flex items-center gap-1 text-[10px] text-[var(--text-secondary)] cursor-pointer select-none">
            <input
              type="checkbox"
              checked={enableContext}
              onChange={(e) => { setEnableContext(e.target.checked); sync({ enableContext: e.target.checked }) }}
              className="nodrag rounded accent-emerald-500"
            />
            <Globe size={10} />
            上下文
          </label>
          <label className="flex items-center gap-1 text-[10px] text-[var(--text-secondary)] cursor-pointer select-none">
            <input
              type="checkbox"
              checked={autoOrchestrate}
              onChange={(e) => { setAutoOrchestrate(e.target.checked); sync({ autoOrchestrate: e.target.checked }) }}
              className="nodrag rounded accent-emerald-500"
            />
            <Workflow size={10} />
            自动编排
          </label>
        </div>

        {/* Status badges */}
        <div className="px-3 pb-1.5 flex items-center gap-2">
          <span className={`text-[11px] px-1.5 py-0.5 rounded-full ${
            inputCount > 0
              ? 'bg-emerald-500/10 text-emerald-500'
              : 'bg-[var(--bg-tertiary)] text-[var(--text-secondary)]'
          }`}>
            {inputCount > 0 ? `${inputCount} 条输入` : '输入 ○'}
          </span>
          {hasDownstream && (
            <span className="text-[11px] px-1.5 py-0.5 rounded-full bg-blue-500/10 text-blue-500">
              有下游 →
            </span>
          )}
        </div>

        {/* Conversation / Output */}
        {(history.length > 0 || output || status === 'running') && (
          <div className="px-3 pb-2">
            <div className="flex items-center justify-between mb-1">
              <label className="text-[11px] font-bold text-[var(--text-secondary)] uppercase">
                {history.length > 0 ? '对话' : '输出'}
              </label>
              <div className="flex items-center gap-1">
                {history.length > 0 && status !== 'running' && (
                  <button onClick={handleClearHistory} className="p-0.5 hover:bg-[var(--bg-tertiary)] rounded text-[var(--text-secondary)]" title="清空对话">
                    <Eraser size={11} />
                  </button>
                )}
                {(output || history.length > 0) && status !== 'running' && (
                  <button onClick={handleCopy} className="p-0.5 hover:bg-[var(--bg-tertiary)] rounded text-[var(--text-secondary)]" title="复制">
                    {copied ? <Check size={12} className="text-emerald-500" /> : <Copy size={12} />}
                  </button>
                )}
              </div>
            </div>
            <div
              onWheel={(e) => e.stopPropagation()}
              className="nowheel max-h-[280px] overflow-auto rounded-lg border border-[var(--border-color)] bg-[var(--bg-primary)] p-2 space-y-2"
            >
              {history.map((h, i) => (
                <div key={i}>
                  <span className={`font-bold text-[9px] uppercase ${h.role === 'user' ? 'text-blue-400' : 'text-emerald-400'}`}>
                    {h.role === 'user' ? 'You' : 'AI'}
                  </span>
                  <pre className="whitespace-pre-wrap text-xs text-[var(--text-primary)] font-mono leading-relaxed mt-0.5 select-text" style={{ userSelect: 'text', WebkitUserSelect: 'text' }}>
                    {h.content}
                  </pre>
                </div>
              ))}
              {status === 'running' && (
                <div>
                  <span className="font-bold text-[9px] uppercase text-emerald-400">AI</span>
                  <pre className="whitespace-pre-wrap text-xs text-[var(--text-primary)] font-mono leading-relaxed mt-0.5 select-text" style={{ userSelect: 'text', WebkitUserSelect: 'text' }}>
                    {output || '生成中...'}
                  </pre>
                </div>
              )}
              {history.length === 0 && status !== 'running' && output && (
                <pre className="whitespace-pre-wrap text-xs text-[var(--text-primary)] font-mono leading-relaxed select-text" style={{ userSelect: 'text', WebkitUserSelect: 'text' }}>
                  {output}
                </pre>
              )}
            </div>
          </div>
        )}

        {/* Follow-up input */}
        {status === 'done' && (
          <div className="px-3 pb-2">
            <div className="flex gap-1">
              <input
                type="text"
                value={followUp}
                onChange={(e) => { setFollowUp(e.target.value); followUpRef.current = e.target.value }}
                onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleRun() } }}
                onMouseDown={(e) => e.stopPropagation()}
                className="nodrag flex-1 text-xs bg-[var(--bg-primary)] border border-[var(--border-color)] rounded-lg px-2 py-1.5 outline-none focus:border-emerald-500 text-[var(--text-primary)] placeholder:text-[var(--text-secondary)]"
                placeholder="追问或修改指令..."
              />
              <button
                onClick={handleRun}
                className="p-1.5 rounded-lg bg-emerald-500/20 text-emerald-500 hover:bg-emerald-500/30 transition-colors"
                title="发送"
              >
                <Play size={12} />
              </button>
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

        {/* Footer */}
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
