import React, { memo, useState, useCallback, useRef, useEffect } from 'react'
import { Handle, Position, NodeProps } from '@xyflow/react'
import { Trash2, Play, Loader2 } from 'lucide-react'
import { useGraphStore } from '@/graph/store'
import { useSettingsStore } from '@/store/settings'
import { streamAiAssistant } from '@/lib/nexusApi'
import { CHAT_MODELS } from '@/config/models'

const MODEL_OPTIONS = (CHAT_MODELS as any[]).map((m: any) => ({ key: m.key, label: m.label }))

interface LlmNodeData {
  label?: string
  model?: string
  instruction?: string
  output?: string
  status?: 'idle' | 'running' | 'done' | 'error'
  errorMessage?: string
}

export const LlmNodeComponent = memo(function LlmNode({ id, data, selected }: NodeProps) {
  const nodeData = data as LlmNodeData
  const defaultModel = useSettingsStore.getState().aiAssistantModel || MODEL_OPTIONS[0]?.key || ''
  const [model, setModel] = useState(nodeData?.model || defaultModel)
  const [instruction, setInstruction] = useState(nodeData?.instruction || '')
  const [output, setOutput] = useState(nodeData?.output || '')
  const [status, setStatus] = useState<'idle' | 'running' | 'done' | 'error'>(nodeData?.status as any || 'idle')
  const [errorMessage, setErrorMessage] = useState(nodeData?.errorMessage || '')
  const abortRef = useRef<AbortController | null>(null)
  const instructionRef = useRef(instruction)

  useEffect(() => {
    if (nodeData?.output !== undefined) setOutput(nodeData.output)
    if (nodeData?.status) setStatus(nodeData.status as any)
  }, [nodeData?.output, nodeData?.status])

  useEffect(() => () => { abortRef.current?.abort() }, [])

  const syncToStore = useCallback((patch: Record<string, unknown>) => {
    useGraphStore.getState().updateNode(id, { data: patch })
  }, [id])

  const handleModelChange = useCallback((val: string) => {
    setModel(val)
    syncToStore({ model: val })
  }, [syncToStore])

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

  const handleRun = useCallback(async () => {
    const inputText = collectInputText()
    const inst = instructionRef.current.trim()
    if (!inputText && !inst) {
      window.$message?.warning?.('请连接输入或填写指令')
      return
    }

    abortRef.current?.abort()
    const ctrl = new AbortController()
    abortRef.current = ctrl

    setStatus('running')
    setOutput('')
    setErrorMessage('')
    syncToStore({ status: 'running', output: '', errorMessage: '' })

    try {
      const messages: any[] = []
      if (inst) messages.push({ role: 'system', content: inst })
      messages.push({ role: 'user', content: inputText || inst })

      let full = ''
      for await (const chunk of streamAiAssistant(model, messages, { signal: ctrl.signal, filterThinking: true })) {
        full += chunk
        setOutput(full)
      }

      setStatus('done')
      syncToStore({ output: full, status: 'done' })
    } catch (err: any) {
      if (ctrl.signal.aborted) return
      const msg = err?.message || '生成失败'
      setStatus('error')
      setErrorMessage(msg)
      syncToStore({ status: 'error', errorMessage: msg })
    }
  }, [model, collectInputText, syncToStore])

  const handleStop = useCallback(() => {
    abortRef.current?.abort()
    setStatus('idle')
    syncToStore({ status: 'idle' })
  }, [syncToStore])

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
                <Loader2 size={14} className="animate-spin" />
              </button>
            ) : (
              <button
                onClick={handleRun}
                className="p-1 hover:bg-emerald-500/20 rounded text-emerald-500 transition-colors"
                title="运行"
              >
                <Play size={14} />
              </button>
            )}
            <button onClick={handleDelete} className="p-1 hover:bg-[var(--bg-tertiary)] rounded" title="删除">
              <Trash2 size={14} />
            </button>
          </div>
        </div>

        {/* Instruction */}
        <div className="px-3 pt-2">
          <label className="text-[11px] font-bold text-[var(--text-secondary)] uppercase">Creative Instruction</label>
          <textarea
            value={instruction}
            onChange={(e) => { instructionRef.current = e.target.value; setInstruction(e.target.value) }}
            onBlur={handleInstructionBlur}
            onMouseDown={(e) => e.stopPropagation()}
            onWheel={(e) => e.stopPropagation()}
            className="nodrag nowheel w-full mt-1 bg-[var(--bg-primary)] rounded-lg border border-[var(--border-color)] p-2 text-xs text-[var(--text-primary)] placeholder:text-[var(--text-secondary)] resize-none outline-none focus:border-emerald-500 select-text"
            style={{ minHeight: 60, userSelect: 'text', WebkitUserSelect: 'text' }}
            placeholder="描述任务或创意指令..."
          />
        </div>

        {/* Model Selector */}
        <div className="px-3 py-2">
          <select
            value={model}
            onChange={(e) => handleModelChange(e.target.value)}
            onMouseDown={(e) => e.stopPropagation()}
            className="nodrag w-full rounded-lg border border-[var(--border-color)] bg-[var(--bg-primary)] px-2 py-1.5 text-xs text-[var(--text-primary)] focus:border-emerald-500 focus:outline-none"
          >
            {MODEL_OPTIONS.map(m => (
              <option key={m.key} value={m.key}>{m.label}</option>
            ))}
          </select>
        </div>

        {/* Output */}
        {(output || status === 'running') && (
          <div className="px-3 pb-3">
            <label className="text-[11px] font-bold text-[var(--text-secondary)] uppercase">Output</label>
            <div
              onWheel={(e) => e.stopPropagation()}
              className="nowheel mt-1 max-h-[200px] overflow-auto rounded-lg border border-[var(--border-color)] bg-[var(--bg-primary)] p-2"
            >
              <pre className="whitespace-pre-wrap text-xs text-[var(--text-primary)] font-mono leading-relaxed select-text" style={{ userSelect: 'text', WebkitUserSelect: 'text' }}>
                {output || (status === 'running' ? '生成中...' : '')}
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

        {/* Handles - 左侧输入(text) */}
        <Handle type="target" position={Position.Left} id="left" className="handle-text" />
        {/* 右侧输出(text) */}
        <Handle type="source" position={Position.Right} id="right" className="handle-text" />
      </div>
    </div>
  )
})
