/**
 * KlingVideoToolNodeFlow - Kling 平台视频工具节点
 * 用于承载可灵平台的高级视频能力（延长/特效/数字人/对口型/多模态编辑等）
 */
import React, { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Handle, Position, NodeProps } from '@xyflow/react'
import { Copy, Trash2, Wand2 } from 'lucide-react'
import { useGraphStore } from '@/graph/store'
import { KLING_VIDEO_TOOLS } from '@/config/models'
import { runKlingToolNode } from '@/lib/workflow/klingTool'

interface KlingVideoToolNodeData {
  label?: string
  toolKey?: string
  payload?: string
}

const TOOL_OPTIONS = (KLING_VIDEO_TOOLS as any[]).map((t: any) => ({ key: t.key, label: t.label }))

const getToolConfig = (toolKey: string) => {
  const k = String(toolKey || '').trim()
  return (KLING_VIDEO_TOOLS as any[]).find((t: any) => t.key === k) || (KLING_VIDEO_TOOLS as any[])[0]
}

export const KlingVideoToolNodeComponent = memo(function KlingVideoToolNode({ id, data }: NodeProps) {
  const nodeData = data as KlingVideoToolNodeData
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

  // 外部数据变化时，同步回本地 UI state
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
      case 'kling-video-extend':
        return { video_id: '', prompt: '', negative_prompt: '', cfg_scale: 0.5 }
      case 'kling-video-effects':
        return { effect_scene: '', input: { duration: '5', image: '' }, callback_url: '' }
      case 'kling-digital-human':
        return { image: '', audio_id: '', sound_file: '', prompt: '', mode: 'std', callback_url: '' }
      case 'kling-motion-control':
        return { prompt: '', image_url: '', video_url: '', character_orientation: 'image', mode: 'std', keep_original_sound: 'yes' }
      case 'kling-multi-elements-video-edit':
        return { model_name: 'kling-v1-6', session_id: '', edit_mode: 'addition', image_list: [], prompt: '', mode: 'std', duration: '5' }
      case 'kling-lip-sync':
        return {
          // advanced-lip-sync（可先通过 identify-face 获取 session_id / face_id）
          session_id: '',
          face_choose: [
            {
              face_id: '',
              audio_id: '',
              sound_file: '',
              sound_start_time: 0,
              sound_end_time: 5000,
              sound_insert_time: 0,
              sound_volume: 1,
              original_audio_volume: 1,
            },
          ],
        }
      default:
        return {}
    }
  }, [])

  // 当切换工具且 payload 为空时，自动填入模板
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
      store.addNode('klingVideoTool', { x: node.x + 50, y: node.y + 50 }, { ...node.data })
    },
    [id]
  )

  const inputStatus = useGraphStore((s) => {
    const incoming = s.edges.filter((e) => e.target === id)
    let texts = 0
    let images = 0
    let videos = 0
    let audios = 0
    for (const e of incoming) {
      const n = s.nodes.find((x) => x.id === e.source)
      if (!n) continue
      if (n.type === 'text') texts++
      else if (n.type === 'image') images++
      else if (n.type === 'video') videos++
      else if (n.type === 'audio') audios++
    }
    return { texts, images, videos, audios }
  })

  const handleRun = useCallback(
    async (e: React.MouseEvent) => {
      e.stopPropagation()
      setLoading(true)
      try {
        // 先把当前 payload 写回 store（避免用户输入未落库）
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
    <div
      className="relative"
      onMouseEnter={() => setShowActions(true)}
      onMouseLeave={() => setShowActions(false)}
    >
      <div
        className={`
          rounded-xl border border-[var(--border-color)] bg-[var(--bg-secondary)] shadow-sm 
          ${showActions ? 'ring-2 ring-[var(--accent-color)] ring-opacity-20' : ''}
        `}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-3 py-2 border-b border-[var(--border-color)]">
          <span className="text-sm font-medium text-[var(--text-secondary)]">{nodeData?.label || 'Kling 视频工具'}</span>
          <div className="flex items-center gap-1">
            <button onClick={handleDuplicate} className="p-1 hover:bg-[var(--bg-tertiary)] rounded" title="复制">
              <Copy size={14} />
            </button>
            <button onClick={handleDelete} className="p-1 hover:bg-[var(--bg-tertiary)] rounded" title="删除">
              <Trash2 size={14} />
            </button>
          </div>
        </div>

        {/* Body */}
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
            <span className={`px-2 py-0.5 rounded-full ${inputStatus.videos > 0 ? 'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400' : 'bg-gray-100 text-gray-500 dark:bg-gray-800'}`}>
              视频 {inputStatus.videos > 0 ? `✓ ${inputStatus.videos}` : '○'}
            </span>
            <span className={`px-2 py-0.5 rounded-full ${inputStatus.audios > 0 ? 'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400' : 'bg-gray-100 text-gray-500 dark:bg-gray-800'}`}>
              音频 {inputStatus.audios > 0 ? `✓ ${inputStatus.audios}` : '○'}
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

        {/* Handles */}
        <Handle type="target" position={Position.Left} id="left" />
        <Handle type="source" position={Position.Right} id="right" />
      </div>
    </div>
  )
})

export default KlingVideoToolNodeComponent

