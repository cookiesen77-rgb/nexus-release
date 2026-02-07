/**
 * KlingImageToolNodeFlow - Kling 平台图片工具节点
 * 用于承载可灵平台的高级图片能力（多图参考生图/扩图/虚拟试穿/图像识别/主体等）
 */
import React, { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Handle, Position, NodeProps } from '@xyflow/react'
import { Copy, Trash2, Wand2 } from 'lucide-react'
import { useGraphStore } from '@/graph/store'
import { KLING_IMAGE_TOOLS } from '@/config/models'
import { runKlingToolNode } from '@/lib/workflow/klingTool'

interface KlingImageToolNodeData {
  label?: string
  toolKey?: string
  payload?: string
}

const TOOL_OPTIONS = (KLING_IMAGE_TOOLS as any[]).map((t: any) => ({ key: t.key, label: t.label }))

const getToolConfig = (toolKey: string) => {
  const k = String(toolKey || '').trim()
  return (KLING_IMAGE_TOOLS as any[]).find((t: any) => t.key === k) || (KLING_IMAGE_TOOLS as any[])[0]
}

export const KlingImageToolNodeComponent = memo(function KlingImageToolNode({ id, data }: NodeProps) {
  const nodeData = data as KlingImageToolNodeData
  const [showActions, setShowActions] = useState(false)
  const [toolKey, setToolKey] = useState(() => String(nodeData?.toolKey || TOOL_OPTIONS[0]?.key || '').trim())
  const [payload, setPayload] = useState(() => String(nodeData?.payload || '').trim())
  const [loading, setLoading] = useState(false)

  const updateTimerRef = useRef<number>(0)

  useEffect(() => {
    return () => {
      if (updateTimerRef.current) {
        clearTimeout(updateTimerRef.current)
        updateTimerRef.current = 0
      }
    }
  }, [])

  useEffect(() => {
    const next = String(nodeData?.toolKey || '').trim()
    if (next && next !== toolKey) setToolKey(next)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nodeData?.toolKey, id])
  useEffect(() => {
    const next = String(nodeData?.payload || '').trim()
    if (next !== payload) setPayload(next)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nodeData?.payload, id])

  const getDefaultPayload = useCallback((k: string) => {
    switch (String(k || '').trim()) {
      case 'kling-multi-image2image':
        return { model_name: 'kling-v2-1', prompt: '', subject_image_list: [{ subject_image: '' }], n: 1, aspect_ratio: '1:1' }
      case 'kling-expand-image':
        return { image: '', up_expansion_ratio: 0.1, down_expansion_ratio: 0.1, left_expansion_ratio: 0.1, right_expansion_ratio: 0.1, prompt: '', n: 1 }
      case 'kling-virtual-try-on':
        return { model_name: 'kolors-virtual-try-on-v1', human_image: '', cloth_image: '', callback_url: '' }
      case 'kling-image-recognize':
        return { image: '' }
      case 'kling-custom-elements':
        return { element_name: '', element_description: '', element_frontal_image: '', element_refer_list: [{ image_url: '' }] }
      default:
        return {}
    }
  }, [])

  useEffect(() => {
    if (payload) return
    const tpl = getDefaultPayload(toolKey)
    const text = JSON.stringify(tpl, null, 2)
    setPayload(text)
    debouncedUpdateStore({ payload: text })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [toolKey])

  const currentTool = useMemo(() => getToolConfig(toolKey), [toolKey])
  const toolTips = String(currentTool?.tips || '').trim()

  const debouncedUpdateStore = useCallback(
    (updates: Record<string, any>) => {
      if (updateTimerRef.current) clearTimeout(updateTimerRef.current)
      updateTimerRef.current = window.setTimeout(() => {
        useGraphStore.getState().updateNode(id, { data: updates })
      }, 200)
    },
    [id]
  )

  const handleDelete = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation()
      useGraphStore.getState().removeNode(id)
    },
    [id]
  )

  const handleDuplicate = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation()
      const store = useGraphStore.getState()
      const node = store.nodes.find((n) => n.id === id)
      if (!node) return
      store.addNode('klingImageTool', { x: node.x + 50, y: node.y + 50 }, { ...node.data })
    },
    [id]
  )

  const inputStatus = useGraphStore((s) => {
    const incoming = s.edges.filter((e) => e.target === id)
    let texts = 0
    let images = 0
    for (const e of incoming) {
      const n = s.nodes.find((x) => x.id === e.source)
      if (!n) continue
      if (n.type === 'text') texts++
      else if (n.type === 'image') images++
    }
    return { texts, images }
  })

  const handleRun = useCallback(
    async (e: React.MouseEvent) => {
      e.stopPropagation()
      setLoading(true)
      try {
        useGraphStore.getState().updateNode(id, { data: { toolKey, payload } } as any)
        await runKlingToolNode(id)
        window.$message?.success?.('Kling 工具执行完成')
      } catch (err: any) {
        window.$message?.error?.(String(err?.message || err || 'Kling 工具执行失败'))
      } finally {
        setLoading(false)
      }
    },
    [id, payload, toolKey]
  )

  return (
    <div className="relative" onMouseEnter={() => setShowActions(true)} onMouseLeave={() => setShowActions(false)}>
      <div
        className={`
          rounded-xl border border-[var(--border-color)] bg-[var(--bg-secondary)] shadow-sm 
          ${showActions ? 'ring-2 ring-[var(--accent-color)] ring-opacity-20' : ''}
        `}
      >
        <div className="flex items-center justify-between px-3 py-2 border-b border-[var(--border-color)]">
          <span className="text-sm font-medium text-[var(--text-secondary)]">{nodeData?.label || 'Kling 图片工具'}</span>
          <div className="flex items-center gap-1">
            <button onClick={handleDuplicate} className="p-1 hover:bg-[var(--bg-tertiary)] rounded" title="复制">
              <Copy size={14} />
            </button>
            <button onClick={handleDelete} className="p-1 hover:bg-[var(--bg-tertiary)] rounded" title="删除">
              <Trash2 size={14} />
            </button>
          </div>
        </div>

        <div className="p-3 space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-xs text-[var(--text-secondary)]">工具</span>
            <select
              value={toolKey}
              onChange={(e) => {
                const v = e.target.value
                setToolKey(v)
                debouncedUpdateStore({ toolKey: v })
              }}
              onMouseDown={(e) => e.stopPropagation()}
              className="nodrag text-sm bg-transparent border border-[var(--border-color)] rounded px-2 py-1 outline-none max-w-[190px]"
            >
              {TOOL_OPTIONS.map((opt) => (
                <option key={opt.key} value={opt.key}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>

          {toolTips && (
            <div className="text-xs text-[var(--text-tertiary)] bg-[var(--bg-tertiary)] rounded px-2 py-1">
              {toolTips}
            </div>
          )}

          <div className="space-y-1">
            <div className="text-xs text-[var(--text-secondary)]">请求 JSON</div>
            <textarea
              value={payload}
              onChange={(e) => {
                const v = e.target.value
                setPayload(v)
                debouncedUpdateStore({ payload: v })
              }}
              onMouseDown={(e) => e.stopPropagation()}
              className="nodrag w-full min-h-[120px] text-xs bg-transparent border border-[var(--border-color)] rounded px-2 py-2 outline-none font-mono"
              placeholder='例如：{ "prompt": "xxx" }'
            />
          </div>

          <div className="flex flex-wrap items-center gap-2 text-xs text-[var(--text-secondary)] py-2 border-t border-[var(--border-color)]">
            <span className={`px-2 py-0.5 rounded-full ${inputStatus.texts > 0 ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400' : 'bg-gray-100 text-gray-500 dark:bg-gray-800'}`}>
              文本 {inputStatus.texts > 0 ? `✓ ${inputStatus.texts}` : '○'}
            </span>
            <span className={`px-2 py-0.5 rounded-full ${inputStatus.images > 0 ? 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400' : 'bg-gray-100 text-gray-500 dark:bg-gray-800'}`}>
              图片 {inputStatus.images > 0 ? `✓ ${inputStatus.images}` : '○'}
            </span>
          </div>

          <button
            onClick={handleRun}
            className="w-full flex items-center justify-center gap-2 py-2 px-4 rounded-lg bg-[var(--accent-color)] hover:opacity-90 text-white text-sm font-medium"
          >
            {loading ? <span className="animate-spin">⟳</span> : <Wand2 size={16} />}
            {loading ? '执行中' : '执行工具'}
          </button>
        </div>

        <Handle type="target" position={Position.Left} id="left" />
        <Handle type="source" position={Position.Right} id="right" />
      </div>
    </div>
  )
})

export default KlingImageToolNodeComponent

