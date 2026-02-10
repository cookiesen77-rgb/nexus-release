/**
 * VideoConfigNodeFlow - React Flow 版本的视频配置节点
 * 完全对齐 Vue 版本 VideoConfigNode.vue 实现
 */
import React, { memo, useState, useCallback, useRef, useEffect, useMemo } from 'react'
import { Handle, Position, NodeProps } from '@xyflow/react'
import { Trash2, Copy, Expand, Video, Search } from 'lucide-react'
import { useGraphStore } from '@/graph/store'
import { getNodeSize } from '@/graph/nodeSizing'
import { generateVideoFromConfigNode } from '@/lib/workflow/video'
import { DEFAULT_VIDEO_MODEL, VIDEO_MODELS } from '@/config/models'
import * as modelsConfig from '@/config/models'
import { getVideoModelCaps, coerceVideoImageRole } from '@/lib/modelCaps'
import { useSettingsStore } from '@/store/settings'
import { VIDU_VOICES, VIDU_VOICE_LANGS } from '@/config/viduVoices'

// 获取用户全局默认视频模型（回退到配置默认）
const getDefaultVideoModel = (): string => {
  const userDefault = useSettingsStore.getState().defaultVideoModel
  if (userDefault && VIDEO_MODELS.some((m: any) => m.key === userDefault)) return userDefault
  return DEFAULT_VIDEO_MODEL
}

// 模型选项
const MODEL_OPTIONS = VIDEO_MODELS.map((m: any) => ({ key: m.key, label: m.label }))

// 获取模型配置
const getModelConfig = (modelKey: string) => {
  // 兼容旧 key（MODEL_ALIASES），避免旧工程打开后 UI 显示/参数不匹配
  const resolved: any = (modelsConfig as any)?.getModelByName?.(modelKey) || null
  if (resolved && String(resolved?.format || '').includes('video')) return resolved
  return VIDEO_MODELS.find((m: any) => m.key === modelKey) || VIDEO_MODELS[0]
}

// 获取模型的比例选项
const getModelRatioOptions = (modelKey: string) => {
  const config = getModelConfig(modelKey) as any
  const ratios = config?.ratios || ['16:9', '9:16']
  return ratios.map((r: string) => ({ key: r, label: r }))
}

// 获取模型的时长选项
const getModelDurationOptions = (modelKey: string) => {
  const config = getModelConfig(modelKey) as any
  const durs = config?.durs || [{ label: '5 秒', key: 5 }]
  return durs
}

// 获取模型的尺寸选项（如 Sora）
const getModelSizeOptions = (modelKey: string) => {
  const config = getModelConfig(modelKey) as any
  return config?.sizes || []
}

interface VideoConfigNodeData {
  label?: string
  model?: string
  ratio?: string
  dur?: number
  size?: string
  loopCount?: number
  resolution?: string
  viduAudio?: boolean
  viduVoiceId?: string
  klingVoiceIds?: string
}

export const VideoConfigNodeComponent = memo(function VideoConfigNode({ id, data, selected }: NodeProps) {
  const nodeData = data as VideoConfigNodeData
  const [showActions, setShowActions] = useState(false)
  const [model, setModel] = useState(nodeData?.model || getDefaultVideoModel())
  const [ratio, setRatio] = useState(nodeData?.ratio || '16:9')
  const [duration, setDuration] = useState(nodeData?.dur || 5)
  const [size, setSize] = useState(nodeData?.size || '')
  const [loopCount, setLoopCount] = useState(nodeData?.loopCount || 1)
  const [resolution, setResolution] = useState(nodeData?.resolution || '')
  const [viduAudio, setViduAudio] = useState(nodeData?.viduAudio !== false)
  const [viduVoiceId, setViduVoiceId] = useState(nodeData?.viduVoiceId || '')
  const [voiceSearch, setVoiceSearch] = useState('')
  const [voiceDropdownOpen, setVoiceDropdownOpen] = useState(false)
  const [klingVoiceIds, setKlingVoiceIds] = useState(() => String(nodeData?.klingVoiceIds || '').trim())
  const [loading, setLoading] = useState(false)

  const updateTimerRef = useRef<number>(0)
  const initializedRef = useRef(false)

  // 外部 data 变化时同步到本地 state（防止 React Flow 重建节点后配置丢失）
  useEffect(() => {
    const extModel = nodeData?.model || getDefaultVideoModel()
    const extRatio = nodeData?.ratio || '16:9'
    const extDur = nodeData?.dur || 5
    const extSize = nodeData?.size || ''
    const extLoopCount = nodeData?.loopCount || 1
    if (extModel !== model) setModel(extModel)
    if (extRatio !== ratio) setRatio(extRatio)
    if (extDur !== duration) setDuration(extDur)
    if (extSize !== size) setSize(extSize)
    if (extLoopCount !== loopCount) setLoopCount(extLoopCount)
  }, [nodeData?.model, nodeData?.ratio, nodeData?.dur, nodeData?.size, nodeData?.loopCount])

  // 兼容旧 key（MODEL_ALIASES）：如果节点里保存的是旧 key，自动迁移到新 key，避免下拉框空白
  useEffect(() => {
    const cur = String(model || '').trim()
    if (!cur) return
    if (MODEL_OPTIONS.some((o) => o.key === cur)) return
    const resolved: any = (modelsConfig as any)?.getModelByName?.(cur) || null
    const nextKey = String(resolved?.key || '').trim()
    if (!nextKey) return
    if (nextKey === cur) return
    if (!MODEL_OPTIONS.some((o) => o.key === nextKey)) return
    setModel(nextKey)
    debouncedUpdateStore({ model: nextKey })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [model, id])
  
  // 清理定时器（防止内存泄漏）
  useEffect(() => {
    return () => {
      if (updateTimerRef.current) {
        clearTimeout(updateTimerRef.current)
        updateTimerRef.current = 0
      }
    }
  }, [])
  
  // 获取当前模型配置
  const currentModelConfig = getModelConfig(model) as any
  const ratioOptions = getModelRatioOptions(model)
  const durationOptions = getModelDurationOptions(model)
  const sizeOptions = getModelSizeOptions(model)
  const hasSizeOptions = sizeOptions.length > 0
  const resolutionOptions: string[] = currentModelConfig?.resolutions || []
  const hasResolution = resolutionOptions.length > 0
  const hasAudioSupport = !!currentModelConfig?.supportsAudio

  // 初始化：保证 store 上的 model/ratio/dur/size 与 UI 一致（避免“UI 选 Veo，实际走 Sora”）
  useEffect(() => {
    if (initializedRef.current) return
    initializedRef.current = true

    const store = useGraphStore.getState()
    const current = store.nodes.find((n) => n.id === id)?.data as any
    const storedModel = String(current?.model || '').trim()
    if (storedModel) return

    const defaultModel = getDefaultVideoModel()
    const baseModelCfg: any = (VIDEO_MODELS as any[]).find((m: any) => m.key === defaultModel) || (VIDEO_MODELS as any[])[0]
    store.updateNode(id, { data: {
      model: defaultModel,
      ratio: baseModelCfg?.defaultParams?.ratio,
      dur: baseModelCfg?.defaultParams?.duration,
      size: baseModelCfg?.defaultParams?.size,
    } } as any)
  }, [id])

  // 外部数据变化（store→ReactFlow→props）时，同步回本地 UI state
  useEffect(() => {
    const nextModel = String(nodeData?.model || getDefaultVideoModel())
    if (nextModel && nextModel !== model) setModel(nextModel)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nodeData?.model, id])

  useEffect(() => {
    const nextRatio = String(nodeData?.ratio || '')
    if (nextRatio && nextRatio !== ratio) setRatio(nextRatio)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nodeData?.ratio, id])

  useEffect(() => {
    const nextDur = Number((nodeData as any)?.dur ?? (nodeData as any)?.duration ?? 0)
    if (Number.isFinite(nextDur) && nextDur > 0 && nextDur !== duration) setDuration(nextDur)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [(nodeData as any)?.dur, (nodeData as any)?.duration, id])

  useEffect(() => {
    const nextSize = String(nodeData?.size || '')
    if (nextSize && nextSize !== size) setSize(nextSize)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nodeData?.size, id])

  useEffect(() => {
    const next = String(nodeData?.klingVoiceIds || '').trim()
    if (next !== klingVoiceIds) setKlingVoiceIds(next)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nodeData?.klingVoiceIds, id])

  useEffect(() => {
    const r = String(nodeData?.resolution || '').trim()
    if (r && r !== resolution) setResolution(r)
  }, [nodeData?.resolution, id])

  useEffect(() => {
    if (nodeData?.viduAudio !== undefined && nodeData.viduAudio !== viduAudio) setViduAudio(nodeData.viduAudio)
  }, [nodeData?.viduAudio, id])

  useEffect(() => {
    const v = String(nodeData?.viduVoiceId || '').trim()
    if (v !== viduVoiceId) setViduVoiceId(v)
  }, [nodeData?.viduVoiceId, id])

  // 按需计算连接状态
  const getConnectionStatus = useCallback(() => {
    const state = useGraphStore.getState()
    const incomingEdges = state.edges.filter((e) => e.target === id)
    let prompts = 0
    let firstFrame = false
    let lastFrame = false
    let refs = 0
    let refVideos = 0

    for (const edge of incomingEdges) {
      const sourceNode = state.nodes.find((n) => n.id === edge.source)
      if (sourceNode?.type === 'text' && sourceNode.data?.content) {
        prompts++
      }
      if (sourceNode?.type === 'image' && sourceNode.data?.url) {
        const role = (edge.data as any)?.imageRole || 'first_frame_image'
        if (role === 'first_frame_image' && !firstFrame) firstFrame = true
        else if (role === 'last_frame_image' && !lastFrame) lastFrame = true
        else refs++
      }
      if (sourceNode?.type === 'video' && (((sourceNode.data as any)?.sourceUrl) || ((sourceNode.data as any)?.url))) {
        refVideos++
      }
    }
    return { prompts, firstFrame, lastFrame, refs, refVideos }
  }, [id])

  const handleDelete = useCallback((e: React.MouseEvent) => {
    e.stopPropagation()
    useGraphStore.getState().removeNode(id)
  }, [id])

  const handleDuplicate = useCallback((e: React.MouseEvent) => {
    e.stopPropagation()
    const store = useGraphStore.getState()
    const node = store.nodes.find((n) => n.id === id)
    if (node) {
      store.addNode('videoConfig', { x: node.x + 50, y: node.y + 50 }, { ...node.data })
    }
  }, [id])

  const handleGenerate = useCallback(async (e: React.MouseEvent) => {
    e.stopPropagation()
    
    console.log('[VideoConfigNode] handleGenerate 被调用, nodeId:', id, 'model:', model, 'ratio:', ratio, 'duration:', duration, 'size:', size, 'loopCount:', loopCount)
    
    const status = getConnectionStatus()
    console.log('[VideoConfigNode] 连接状态:', status)
    
    const caps = getVideoModelCaps(model)
    const totalImages = (status.firstFrame ? 1 : 0) + (status.lastFrame ? 1 : 0) + status.refs

    if (status.prompts === 0 && totalImages === 0 && (status as any).refVideos === 0) {
      console.warn('[VideoConfigNode] 无输入连接，退出生成')
      window.$message?.warning?.('请连接文本节点（提示词）或图片节点（首帧/尾帧/参考图）')
      return
    }

    // 模型能力校验（UI 级）
    if (caps.requiresPrompt && status.prompts === 0) {
      window.$message?.warning?.('当前模型需要提示词（请连接文本节点）')
      return
    }
    if (!caps.supportsFirstFrame && status.firstFrame) {
      window.$message?.warning?.('当前模型不支持首帧输入')
      return
    }
    if (!caps.supportsLastFrame && status.lastFrame) {
      window.$message?.warning?.('当前模型不支持尾帧输入')
      return
    }
    if (!caps.supportsReferenceImages && status.refs > 0) {
      window.$message?.warning?.('当前模型不支持参考图输入')
      return
    }
    if (caps.supportsReferenceImages && caps.maxRefImages > 0 && status.refs > caps.maxRefImages) {
      window.$message?.warning?.(`当前模型参考图最多支持 ${caps.maxRefImages} 张`)
      return
    }
    if (caps.maxImages > 0 && totalImages > caps.maxImages) {
      window.$message?.warning?.(`当前模型最多支持 ${caps.maxImages} 张图片输入（含首/尾帧与参考图）`)
      return
    }
    if (caps.requiresFirstFrameIfLastFrame && status.lastFrame && !status.firstFrame) {
      window.$message?.warning?.('当前模型不支持仅尾帧：有尾帧时必须同时提供首帧')
      return
    }
    if (!caps.supportsReferenceVideo && (status as any).refVideos > 0) {
      window.$message?.warning?.('当前模型不支持参考视频输入')
      return
    }
    if (caps.supportsReferenceVideo && caps.maxRefVideos > 0 && (status as any).refVideos > caps.maxRefVideos) {
      window.$message?.warning?.(`当前模型参考视频最多支持 ${caps.maxRefVideos} 个`)
      return
    }

    setLoading(true)
    console.log('[VideoConfigNode] 开始生成视频...')
    
    try {
      // 生成前强制同步当前 UI 选择到 store（用于持久化）
      if (updateTimerRef.current) clearTimeout(updateTimerRef.current)
      useGraphStore.getState().updateNode(id, { data: { model, ratio, dur: duration, size, loopCount, resolution, viduAudio, viduVoiceId, klingVoiceIds } } as any)
      
      // 循环生成（并发）：选择 N 次就立即创建 N 个后续输出节点，并发完成调用
      const actualLoopCount = Math.max(1, Math.min(10, loopCount)) // 限制 1-10 次
      const outIds: string[] = []

      const s0 = useGraphStore.getState()
      const cfgNode = s0.nodes.find((n) => n.id === id)
      if (!cfgNode) throw new Error('配置节点不存在')

      const baseX = (cfgNode.x || 0) + 460
      const baseY = (cfgNode.y || 0)
      const outSize = getNodeSize('video')
      const spacingY = Math.max(36, (outSize?.h || 240) + 60)

      // 先把 N 个输出节点创建出来（确保“选多少次就出现多少个后续节点”）
      useGraphStore.getState().withBatchUpdates(() => {
        for (let i = 0; i < actualLoopCount; i++) {
          const outId = useGraphStore.getState().addNode('video', { x: baseX, y: baseY + i * spacingY }, {
            url: '',
            loading: true,
            error: '',
            label: '视频生成结果'
          })
          outIds.push(outId)
          useGraphStore.getState().addEdge(id, outId, { sourceHandle: 'right', targetHandle: 'left' })
        }
      })

      if (actualLoopCount > 1) {
        window.$message?.info?.(`开始并发生成 ${actualLoopCount} 个视频...`)
      }

      const tasks = outIds.map((outId) =>
        generateVideoFromConfigNode(
          id,
          { model, ratio, duration, size },
          { outputNodeId: outId, selectOutput: false, markConfigExecuted: false }
        )
          .then(() => ({ ok: true as const, outId }))
          .catch((err) => ({ ok: false as const, outId, err }))
      )

      const results = await Promise.all(tasks)
      const okCount = results.filter((r) => r.ok).length
      const failCount = results.length - okCount

      // 批量结束后统一标记配置节点完成（保持 outputNodeId 兼容：指向最后一个输出）
      const lastOut = outIds[outIds.length - 1] || ''
      useGraphStore.getState().updateNode(id, { data: { executed: true, outputNodeId: lastOut, outputNodeIds: outIds } } as any)

      console.log('[VideoConfigNode] 视频生成完成', { okCount, failCount })
      if (failCount === 0) {
        if (actualLoopCount > 1) window.$message?.success?.(`成功生成 ${okCount} 个视频`)
        else window.$message?.success?.('视频生成成功')
      } else {
        window.$message?.warning?.(`生成完成：成功 ${okCount}，失败 ${failCount}`)
      }
    } catch (err: any) {
      console.error('[VideoConfigNode] 生成失败:', err)
      console.error('[VideoConfigNode] 错误详情:', {
        message: err?.message,
        name: err?.name,
        stack: err?.stack
      })
      // 提取并显示友好的错误消息
      let friendlyMsg = err?.message || '视频生成失败'
      // 处理常见的后端错误
      if (friendlyMsg.includes('负载已饱和') || friendlyMsg.includes('稍后再试')) {
        friendlyMsg = '服务器繁忙，请稍后重试'
      } else if (friendlyMsg.includes('HTTP 500')) {
        friendlyMsg = '服务器内部错误，请稍后重试'
      } else if (friendlyMsg.includes('Failed to fetch') || friendlyMsg.includes('NetworkError')) {
        friendlyMsg = '网络连接失败，请检查网络'
      }
      window.$message?.error?.(friendlyMsg)
    } finally {
      setLoading(false)
    }
  }, [id, model, ratio, duration, size, loopCount, klingVoiceIds, getConnectionStatus])

  // 更新 store 的辅助函数
  const debouncedUpdateStore = useCallback((updates: Record<string, any>) => {
    if (updateTimerRef.current) clearTimeout(updateTimerRef.current)
    updateTimerRef.current = window.setTimeout(() => {
      useGraphStore.getState().updateNode(id, { data: updates })
    }, 300)
  }, [id])

  // 模型切换时重新校验所有 imageRole 边，确保角色与新模型能力匹配
  const revalidateEdgeRoles = useCallback((newModel: string) => {
    const caps = getVideoModelCaps(newModel)
    const store = useGraphStore.getState()
    const edges = store.edges.filter(e => e.target === id && e.type === 'imageRole')
    if (edges.length === 0) return

    let hasFirst = false
    let hasLast = false

    store.withBatchUpdates(() => {
      for (const edge of edges) {
        const curRole = String((edge.data as any)?.imageRole || 'first_frame_image').trim()
        let nextRole = coerceVideoImageRole(curRole, caps)

        if (nextRole === 'first_frame_image') {
          if (hasFirst) nextRole = caps.supportsLastFrame && !hasLast ? 'last_frame_image' : (caps.supportsReferenceImages ? 'input_reference' : 'first_frame_image')
          else hasFirst = true
        }
        if (nextRole === 'last_frame_image') {
          if (hasLast) nextRole = caps.supportsReferenceImages ? 'input_reference' : 'first_frame_image'
          else hasLast = true
        }

        if (nextRole !== curRole) {
          store.setEdgeImageRole(edge.id, nextRole)
        }
      }
    })
  }, [id])

  return (
    <div
      className="relative pt-[20px]"
      onMouseEnter={() => setShowActions(true)}
      onMouseLeave={() => setShowActions(false)}
    >
      {/* 节点主体 */}
      <div
        className={`video-config-node bg-[var(--bg-secondary)] rounded-xl border min-w-[320px] relative transition-all duration-200 ${
          selected ? 'border-blue-500 shadow-lg shadow-blue-500/20' : 'border-[var(--border-color)]'
        }`}
      >
        {/* 头部 */}
        <div className="flex items-center justify-between px-3 py-2 border-b border-[var(--border-color)]">
          <span className="text-sm font-medium text-[var(--text-secondary)]">
            {nodeData?.label || '视频生成'}
          </span>
          <div className="flex items-center gap-1">
            <button onClick={handleDelete} className="p-1 hover:bg-[var(--bg-tertiary)] rounded">
              <Trash2 size={14} />
            </button>
            <button className="p-1 hover:bg-[var(--bg-tertiary)] rounded">
              <Expand size={14} />
            </button>
          </div>
        </div>

        {/* 配置选项 */}
        <div className="p-3 space-y-3">
          {/* 模型选择 */}
          <div className="flex items-center justify-between">
            <span className="text-xs text-[var(--text-secondary)]">模型</span>
            <select
              value={model}
              onChange={(e) => {
                const newModel = e.target.value
                setModel(newModel)
                const config = getModelConfig(newModel) as any
                if (config?.defaultParams?.ratio) setRatio(config.defaultParams.ratio)
                if (config?.defaultParams?.duration) setDuration(config.defaultParams.duration)
                if (config?.sizes?.length > 0) {
                  const defaultSize = config.defaultParams?.size || config.sizes[0]?.key
                  setSize(defaultSize)
                } else {
                  setSize('')
                }
                debouncedUpdateStore({
                  model: newModel,
                  ratio: config?.defaultParams?.ratio,
                  dur: config?.defaultParams?.duration,
                  size: config?.sizes?.length > 0 ? (config.defaultParams?.size || config.sizes[0]?.key) : ''
                })
                revalidateEdgeRoles(newModel)
              }}
              onMouseDown={(e) => e.stopPropagation()}
              className="nodrag text-sm bg-transparent border border-[var(--border-color)] rounded px-2 py-1 outline-none max-w-[180px]"
            >
              {MODEL_OPTIONS.map((opt) => (
                <option key={opt.key} value={opt.key}>{opt.label}</option>
              ))}
            </select>
          </div>

          {/* 比例选择 */}
          <div className="flex items-center justify-between">
            <span className="text-xs text-[var(--text-secondary)]">比例</span>
            <select
              value={ratio}
              onChange={(e) => {
                const newRatio = e.target.value
                setRatio(newRatio)
                debouncedUpdateStore({ ratio: newRatio })
              }}
              onMouseDown={(e) => e.stopPropagation()}
              className="nodrag text-sm bg-transparent border border-[var(--border-color)] rounded px-2 py-1 outline-none"
            >
              {ratioOptions.map((opt: any) => (
                <option key={opt.key} value={opt.key}>{opt.label}</option>
              ))}
            </select>
          </div>

          {/* 尺寸选择（Sora 等模型需要） */}
          {hasSizeOptions && (
            <div className="flex items-center justify-between">
              <span className="text-xs text-[var(--text-secondary)]">尺寸</span>
              <select
                value={size}
                onChange={(e) => {
                  const newSize = e.target.value
                  setSize(newSize)
                  debouncedUpdateStore({ size: newSize })
                }}
                onMouseDown={(e) => e.stopPropagation()}
                className="nodrag text-sm bg-transparent border border-[var(--border-color)] rounded px-2 py-1 outline-none"
              >
                {sizeOptions.map((opt: any) => (
                  <option key={opt.key} value={opt.key}>{opt.label}</option>
                ))}
              </select>
            </div>
          )}

          {/* 时长选择 */}
          <div className="flex items-center justify-between">
            <span className="text-xs text-[var(--text-secondary)]">时长</span>
            <select
              value={duration}
              onChange={(e) => {
                const newDur = Number(e.target.value)
                setDuration(newDur)
                debouncedUpdateStore({ dur: newDur })
              }}
              onMouseDown={(e) => e.stopPropagation()}
              className="nodrag text-sm bg-transparent border border-[var(--border-color)] rounded px-2 py-1 outline-none"
            >
              {durationOptions.map((opt: any) => (
                <option key={opt.key} value={opt.key}>{opt.label}</option>
              ))}
            </select>
          </div>

          {/* 分辨率选择 */}
          {hasResolution && (
            <div className="flex items-center justify-between">
              <span className="text-xs text-[var(--text-secondary)]">分辨率</span>
              <select
                value={resolution || resolutionOptions[0] || ''}
                onChange={(e) => {
                  setResolution(e.target.value)
                  debouncedUpdateStore({ resolution: e.target.value })
                }}
                onMouseDown={(e) => e.stopPropagation()}
                className="nodrag text-sm bg-transparent border border-[var(--border-color)] rounded px-2 py-1 outline-none"
              >
                {resolutionOptions.map((r: string) => (
                  <option key={r} value={r}>{r}</option>
                ))}
              </select>
            </div>
          )}

          {/* 音频生成（Vidu 等支持音画同出的模型） */}
          {hasAudioSupport && (
            <div className="flex flex-col gap-2">
              <div className="flex items-center justify-between">
                <span className="text-xs text-[var(--text-secondary)]">音频生成</span>
                <button
                  onClick={() => {
                    const next = !viduAudio
                    setViduAudio(next)
                    debouncedUpdateStore({ viduAudio: next })
                  }}
                  onMouseDown={(e) => e.stopPropagation()}
                  className={`nodrag relative w-9 h-5 rounded-full transition-colors ${viduAudio ? 'bg-emerald-500' : 'bg-[var(--border-color)]'}`}
                >
                  <div className={`absolute top-0.5 w-4 h-4 rounded-full bg-white transition-transform ${viduAudio ? 'translate-x-4' : 'translate-x-0.5'}`} />
                </button>
              </div>
              {viduAudio && (
                <div className="relative" onMouseDown={(e) => e.stopPropagation()}>
                  <div className="text-[11px] text-[var(--text-secondary)] mb-1">音色（留空自动推荐）</div>
                  <div
                    className="nodrag nowheel flex items-center gap-1 border border-[var(--border-color)] rounded px-2 py-1 bg-[var(--bg-primary)] cursor-text"
                    onClick={() => setVoiceDropdownOpen(true)}
                  >
                    <Search size={12} className="text-[var(--text-secondary)] shrink-0" />
                    <input
                      value={voiceDropdownOpen ? voiceSearch : (viduVoiceId ? VIDU_VOICES.find(v => v.id === viduVoiceId)?.name || viduVoiceId : '')}
                      onChange={(e) => { setVoiceSearch(e.target.value); setVoiceDropdownOpen(true) }}
                      onFocus={() => setVoiceDropdownOpen(true)}
                      onMouseDown={(e) => e.stopPropagation()}
                      className="nodrag w-full bg-transparent outline-none text-xs text-[var(--text-primary)] placeholder:text-[var(--text-secondary)]"
                      placeholder="搜索音色名称或 ID..."
                    />
                    {viduVoiceId && (
                      <button
                        onClick={(e) => { e.stopPropagation(); setViduVoiceId(''); setVoiceSearch(''); debouncedUpdateStore({ viduVoiceId: '' }) }}
                        className="text-[var(--text-secondary)] hover:text-[var(--text-primary)] shrink-0"
                      >×</button>
                    )}
                  </div>
                  {voiceDropdownOpen && (
                    <div
                      className="nowheel absolute z-50 left-0 right-0 mt-1 max-h-[200px] overflow-auto rounded-lg border border-[var(--border-color)] bg-[var(--bg-secondary)] shadow-lg"
                      onWheel={(e) => e.stopPropagation()}
                    >
                      {VIDU_VOICE_LANGS.map(lang => {
                        const q = voiceSearch.toLowerCase()
                        const voices = VIDU_VOICES.filter(v => v.lang === lang && (!q || v.name.toLowerCase().includes(q) || v.id.toLowerCase().includes(q) || v.lang.includes(q)))
                        if (voices.length === 0) return null
                        return (
                          <div key={lang}>
                            <div className="px-2 py-1 text-[10px] font-bold text-[var(--text-secondary)] bg-[var(--bg-tertiary)] sticky top-0">{lang}</div>
                            {voices.map(v => (
                              <button
                                key={v.id}
                                onClick={() => {
                                  setViduVoiceId(v.id)
                                  setVoiceSearch('')
                                  setVoiceDropdownOpen(false)
                                  debouncedUpdateStore({ viduVoiceId: v.id })
                                }}
                                className={`w-full text-left px-2 py-1.5 text-xs hover:bg-[var(--bg-tertiary)] ${viduVoiceId === v.id ? 'bg-emerald-500/10 text-emerald-600' : 'text-[var(--text-primary)]'}`}
                              >
                                <span>{v.name}</span>
                                <span className="ml-1 text-[10px] text-[var(--text-secondary)]">{v.id}</span>
                              </button>
                            ))}
                          </div>
                        )
                      })}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {/* 循环次数 */}
          <div className="flex items-center justify-between">
            <span className="text-xs text-[var(--text-secondary)]">循环次数</span>
            <select
              value={loopCount}
              onChange={(e) => {
                const newCount = parseInt(e.target.value, 10)
                setLoopCount(newCount)
                debouncedUpdateStore({ loopCount: newCount })
              }}
              onMouseDown={(e) => e.stopPropagation()}
              className="nodrag text-sm bg-transparent border border-[var(--border-color)] rounded px-2 py-1 outline-none"
            >
              {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((n) => (
                <option key={n} value={n}>{n} 次</option>
              ))}
            </select>
          </div>

          {/* 模型提示 */}
          {currentModelConfig?.tips && (
            <div className="text-xs text-[var(--text-tertiary)] bg-[var(--bg-tertiary)] rounded px-2 py-1">
              {currentModelConfig.tips}
            </div>
          )}

          {/* Kling v2.6 音色（可选）：仅在模型开启 sound=on 时生效 */}
          {String(currentModelConfig?.format || '') === 'kling-video' && /^kling-v2-6/i.test(String(currentModelConfig?.defaultParams?.model_name || '')) && (
            <div className="flex flex-col gap-1">
              <div className="text-xs text-[var(--text-secondary)]">音色 voice_id（可选，最多 2 个，用逗号分隔）</div>
              <input
                value={klingVoiceIds}
                onChange={(e) => {
                  const v = e.target.value
                  setKlingVoiceIds(v)
                  debouncedUpdateStore({ klingVoiceIds: v })
                }}
                onMouseDown={(e) => e.stopPropagation()}
                className="nodrag w-full bg-transparent border border-[var(--border-color)] rounded px-2 py-1 outline-none text-sm"
                placeholder="例如：voice_001, voice_002（仅 v2.6 且 sound=on 生效）"
              />
              <div className="text-[11px] text-[var(--text-tertiary)]">
                说明：使用音色时请在提示词中用 “&lt;&lt; &gt;&gt;” 标注，且需选择带音频的 v2.6 模型（sound=on）。
              </div>
            </div>
          )}

          {/* 连接输入指示 */}
          <ConnectionStatusIndicator nodeId={id} modelKey={model} />

          {/* 生成按钮 - 允许多次点击 */}
          <button
            onClick={handleGenerate}
            className="w-full flex items-center justify-center gap-2 py-2 px-4 rounded-lg bg-[var(--accent-color)] hover:opacity-90 text-white text-sm font-medium"
          >
            {loading ? <span className="animate-spin">⟳</span> : <Video size={16} />}
            {loading ? '重新生成' : '生成视频'}
          </button>
        </div>

        {/* 连接点 */}
        <Handle type="target" position={Position.Left} id="left" className="handle-image" />
        <Handle type="source" position={Position.Right} id="right" className="handle-video" />
      </div>

      {/* 悬浮复制按钮 */}
      {showActions && (
        <div className="absolute -top-5 right-0 z-[1000]">
          <button
            onClick={handleDuplicate}
            className="group p-2 bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 flex items-center gap-0 hover:gap-1.5 transition-all shadow-sm w-max"
          >
            <Copy size={16} className="text-gray-600 dark:text-gray-300" />
            <span className="text-xs text-gray-600 dark:text-gray-300 max-w-0 overflow-hidden group-hover:max-w-[60px] transition-all duration-200 whitespace-nowrap">
              复制
            </span>
          </button>
        </div>
      )}
    </div>
  )
})

// 连接状态指示器组件 - 订阅 store 实时更新
const ConnectionStatusIndicator = memo(function ConnectionStatusIndicator({ 
  nodeId,
  modelKey,
}: { 
  nodeId: string
  modelKey: string
}) {
  const caps = useMemo(() => getVideoModelCaps(modelKey), [modelKey])
  // 订阅 store 的 edges 变化
  const status = useGraphStore((state) => {
    const incomingEdges = state.edges.filter((e) => e.target === nodeId)
    let prompts = 0
    let firstFrame = false
    let lastFrame = false
    let refs = 0
    let refVideos = 0

    for (const edge of incomingEdges) {
      const sourceNode = state.nodes.find((n) => n.id === edge.source)
      if (sourceNode?.type === 'text' && (sourceNode.data as any)?.content) {
        prompts++
      }
      if (sourceNode?.type === 'image' && (sourceNode.data as any)?.url) {
        const role = (edge.data as any)?.imageRole || 'first_frame_image'
        if (role === 'first_frame_image') {
          if (!firstFrame) firstFrame = true
          else refs++ // 多余的首帧算作参考图
        } else if (role === 'last_frame_image') {
          if (!lastFrame) lastFrame = true
          else refs++ // 多余的尾帧算作参考图
        } else {
          refs++
        }
      }
      if (sourceNode?.type === 'video' && (((sourceNode.data as any)?.sourceUrl) || ((sourceNode.data as any)?.url))) {
        refVideos++
      }
    }
    return { prompts, firstFrame, lastFrame, refs, refVideos }
  })

  return (
    <div className="flex flex-wrap items-center gap-2 text-xs text-[var(--text-secondary)] py-2 border-t border-[var(--border-color)]">
      <span className={`px-2 py-0.5 rounded-full ${
        status.prompts > 0 
          ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400' 
          : 'bg-gray-100 text-gray-500 dark:bg-gray-800'
      }`}>
        提示词 {status.prompts > 0 ? '✓' : '○'}
      </span>
      {caps.supportsFirstFrame && (
        <span className={`px-2 py-0.5 rounded-full ${
          status.firstFrame 
            ? 'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400' 
            : 'bg-gray-100 text-gray-500 dark:bg-gray-800'
        }`}>
          首帧 {status.firstFrame ? '✓' : '○'}
        </span>
      )}
      {caps.supportsLastFrame && (
        <span className={`px-2 py-0.5 rounded-full ${
          status.lastFrame 
            ? 'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400' 
            : 'bg-gray-100 text-gray-500 dark:bg-gray-800'
        }`}>
          尾帧 {status.lastFrame ? '✓' : '○'}
        </span>
      )}
      {caps.supportsReferenceImages && (
        <span className={`px-2 py-0.5 rounded-full ${
          status.refs > 0
            ? 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400' 
            : 'bg-gray-100 text-gray-500 dark:bg-gray-800'
        }`}>
          参考图 {status.refs > 0 ? `✓ ${status.refs}` : '○'}
        </span>
      )}
      {caps.supportsReferenceVideo && (
        <span className={`px-2 py-0.5 rounded-full ${
          (status as any).refVideos > 0
            ? 'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400'
            : 'bg-gray-100 text-gray-500 dark:bg-gray-800'
        }`}>
          参考视频 {(status as any).refVideos > 0 ? `✓ ${(status as any).refVideos}` : '○'}
        </span>
      )}
    </div>
  )
})
