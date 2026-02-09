/**
 * ImageConfigNodeFlow - React Flow 版本的文生图配置节点
 * 完全对齐 Vue 版本 ImageConfigNode.vue 实现
 * 
 * 性能优化 - 完全不订阅 store，只使用 getState() 按需获取
 */
import React, { memo, useState, useCallback, useRef, useEffect, useMemo } from 'react'
import { Handle, Position, NodeProps } from '@xyflow/react'
import { Copy, Trash2, Expand, ArrowUp, ArrowDown } from 'lucide-react'
import { useGraphStore } from '@/graph/store'
import { getNodeSize } from '@/graph/nodeSizing'
import { generateImageFromConfigNode } from '@/lib/workflow/image'
import { IMAGE_MODELS, SEEDREAM_SIZE_OPTIONS, SEEDREAM_4K_SIZE_OPTIONS } from '@/config/models'
import { getImageModelCaps } from '@/lib/modelCaps'
import { useSettingsStore } from '@/store/settings'

// 默认图片模型（取用户全局设置，回退到配置第一项）
const getDefaultImageModel = (): string => {
  const userDefault = useSettingsStore.getState().defaultImageModel
  if (userDefault && IMAGE_MODELS.some((m: any) => m.key === userDefault)) return userDefault
  return IMAGE_MODELS[0]?.key || 'gemini-3-pro-image-preview'
}

// 模型选项
const MODEL_OPTIONS = IMAGE_MODELS.map((m: any) => ({ key: m.key, label: m.label }))

// 验证模型是否有效（存在于选项列表中）
const VALID_MODEL_KEYS = new Set(IMAGE_MODELS.map((m: any) => m.key))
const getValidModel = (modelKey: string | undefined): string => {
  if (modelKey && VALID_MODEL_KEYS.has(modelKey)) {
    return modelKey
  }
  return getDefaultImageModel()
}

// 获取模型配置
const getModelConfig = (modelKey: string) => {
  return IMAGE_MODELS.find((m: any) => m.key === modelKey) || IMAGE_MODELS[0]
}

// 获取模型的尺寸选项
const getModelSizeOptions = (modelKey: string) => {
  const config = getModelConfig(modelKey) as any
  const sizes = config?.sizes || ['1:1', '16:9', '9:16', '4:3', '3:4']
  return sizes.map((s: any) => typeof s === 'string' ? { key: s, label: s } : { key: s.key, label: s.label })
}

// 获取模型的画质选项
const getModelQualityOptions = (modelKey: string) => {
  const config = getModelConfig(modelKey) as any
  return config?.qualities || []
}

interface ImageConfigNodeData {
  label?: string
  model?: string
  size?: string
  quality?: string
  autoExecute?: boolean
  loopCount?: number  // 循环生成次数，默认 1
}

export const ImageConfigNodeComponent = memo(function ImageConfigNode({ id, data, selected }: NodeProps) {
  const nodeData = data as ImageConfigNodeData
  const [showActions, setShowActions] = useState(false)
  // 使用 getValidModel 确保模型值有效，防止 UI 与内部状态不一致
  const [model, setModel] = useState(() => getValidModel(nodeData?.model))
  
  const [size, setSize] = useState(nodeData?.size || '3:4') // 默认 3:4 竖版
  const [quality, setQuality] = useState(nodeData?.quality || '')
  const [loopCount, setLoopCount] = useState(nodeData?.loopCount || 1) // 循环次数，默认 1
  const [loading, setLoading] = useState(false)
  const autoExecuteTriggered = useRef(false)

  const updateTimerRef = useRef<number>(0)

  // 外部 data 变化时同步到本地 state（防止 React Flow 重建节点后配置丢失）
  useEffect(() => {
    const extModel = getValidModel(nodeData?.model)
    const extSize = nodeData?.size || '3:4'
    const extQuality = nodeData?.quality || ''
    const extLoopCount = nodeData?.loopCount || 1
    if (extModel !== model) setModel(extModel)
    if (extSize !== size) setSize(extSize)
    if (extQuality !== quality) setQuality(extQuality)
    if (extLoopCount !== loopCount) setLoopCount(extLoopCount)
  }, [nodeData?.model, nodeData?.size, nodeData?.quality, nodeData?.loopCount])
  
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
  const sizeOptions = getModelSizeOptions(model)
  const qualityOptions = getModelQualityOptions(model)
  const hasQualityOptions = qualityOptions.length > 0
  const isResolutionQuality = hasQualityOptions && qualityOptions.every((opt: any) => /^\d+k$/i.test(String(opt?.key || '').trim()))
  const qualityLabel = isResolutionQuality ? '分辨率' : '画质'
  
  // 按需计算连接状态
  const getConnectionStatus = useCallback(() => {
    const state = useGraphStore.getState()
    const incomingEdges = state.edges.filter((e) => e.target === id)
    let prompts = 0
    let images = 0

    for (const edge of incomingEdges) {
      const sourceNode = state.nodes.find((n) => n.id === edge.source)
      if (sourceNode?.type === 'text' && sourceNode.data?.content) {
        prompts++
      }
      if (sourceNode?.type === 'image' && sourceNode.data?.url) {
        images++
      }
    }
    return { prompts, images }
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
      store.addNode('imageConfig', { x: node.x + 50, y: node.y + 50 }, { ...node.data })
    }
  }, [id])

  const handleGenerate = useCallback(async (e: React.MouseEvent) => {
    e.stopPropagation()
    
    console.log('[ImageConfigNode] handleGenerate 被调用, nodeId:', id, 'model:', model, 'size:', size, 'quality:', quality, 'loopCount:', loopCount)
    
    const status = getConnectionStatus()
    const caps = getImageModelCaps(model)
    if (status.prompts === 0 && status.images === 0) {
      window.$message?.warning?.('请连接文本节点（提示词）或图片节点（参考图）')
      return
    }
    if (caps.requiresPrompt && status.prompts === 0) {
      window.$message?.warning?.('当前模型需要提示词（请连接文本节点）')
      return
    }
    if (caps.requiresReferenceImages && status.images === 0) {
      window.$message?.warning?.('当前模型需要参考图（请连接图片节点）')
      return
    }
    if (!caps.supportsReferenceImages && status.images > 0) {
      window.$message?.warning?.('当前模型不支持参考图输入（请移除图片连接）')
      return
    }
    if (caps.supportsReferenceImages && caps.maxRefImages > 0 && status.images > caps.maxRefImages) {
      window.$message?.warning?.(`当前模型参考图最多支持 ${caps.maxRefImages} 张`)
      return
    }

    setLoading(true)
    
    try {
      // 生成前强制同步当前 UI 选择到 store（用于持久化）
      if (updateTimerRef.current) clearTimeout(updateTimerRef.current)
      useGraphStore.getState().updateNode(id, { data: { model, size, quality, loopCount } })
      
      // 循环生成（并发）：选择 N 次就立即创建 N 个后续输出节点，并发完成调用
      const actualLoopCount = Math.max(1, Math.min(10, loopCount)) // 限制 1-10 次
      const outIds: string[] = []

      const s0 = useGraphStore.getState()
      const cfgNode = s0.nodes.find((n) => n.id === id)
      if (!cfgNode) throw new Error('配置节点不存在')

      const baseX = (cfgNode.x || 0) + 400
      const baseY = (cfgNode.y || 0)
      const outSize = getNodeSize('image')
      const spacingY = Math.max(36, (outSize?.h || 200) + 40)

      // 先把 N 个输出节点创建出来（确保“选多少次就出现多少个后续节点”）
      useGraphStore.getState().withBatchUpdates(() => {
        for (let i = 0; i < actualLoopCount; i++) {
          const outId = useGraphStore.getState().addNode('image', { x: baseX, y: baseY + i * spacingY }, {
            url: '',
            loading: true,
            error: '',
            label: '图像生成结果'
          })
          outIds.push(outId)
          useGraphStore.getState().addEdge(id, outId, { sourceHandle: 'right', targetHandle: 'left' })
        }
      })

      if (actualLoopCount > 1) {
        window.$message?.info?.(`开始并发生成 ${actualLoopCount} 张图片...`)
      }

      const tasks = outIds.map((outId) =>
        generateImageFromConfigNode(
          id,
          { model, size, quality },
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

      if (failCount === 0) {
        if (actualLoopCount > 1) window.$message?.success?.(`成功生成 ${okCount} 张图片`)
        else window.$message?.success?.('图片生成成功')
      } else {
        window.$message?.warning?.(`生成完成：成功 ${okCount}，失败 ${failCount}`)
      }
    } catch (err: any) {
      window.$message?.error?.(err?.message || '图片生成失败')
      console.error('[ImageConfigNode] 生成失败:', err)
    } finally {
      setLoading(false)
    }
  }, [id, model, size, quality, loopCount, getConnectionStatus])

  // 更新 store 的辅助函数
  const debouncedUpdateStore = useCallback((updates: Record<string, any>) => {
    if (updateTimerRef.current) clearTimeout(updateTimerRef.current)
    updateTimerRef.current = window.setTimeout(() => {
      useGraphStore.getState().updateNode(id, { data: updates })
    }, 300)
  }, [id])

  // Seedream：把“尺寸/分辨率”拆开后，兼容旧数据（曾把 1K/2K/4K 或像素值写在 size 里）
  useEffect(() => {
    const cfg = getModelConfig(model) as any
    if (cfg?.format !== 'doubao-seedream') return

    const ratioKeys = new Set(getModelSizeOptions(model).map((o: any) => String(o?.key || '').trim()))
    const resKeys = new Set(getModelQualityOptions(model).map((o: any) => String(o?.key || '').trim()))

    const curSize = String(size || '').trim()
    const curQuality = String(quality || '').trim()

    const defaultRatio = String(cfg?.defaultParams?.size || '3:4')
    const defaultRes = String(cfg?.defaultParams?.quality || '2K')

    let nextSize = curSize
    let nextQuality = curQuality

    // 先修复分辨率
    if (!nextQuality || !resKeys.has(nextQuality)) nextQuality = defaultRes

    // 再修复尺寸（比例）
    if (!ratioKeys.has(nextSize)) {
      // 旧：把 1K/2K/4K 直接塞在 size
      if (/^(1k|2k|4k)$/i.test(nextSize)) {
        nextQuality = nextSize.toUpperCase()
        nextSize = defaultRatio
      } else if (/^\d{3,5}x\d{3,5}$/i.test(nextSize)) {
        // 旧：把像素宽高塞在 size（从 2K/4K 预设反推比例）
        const found2k: any = (SEEDREAM_SIZE_OPTIONS as any[]).find((o: any) => String(o?.key || '').trim() === nextSize)
        const found4k: any = (SEEDREAM_4K_SIZE_OPTIONS as any[]).find((o: any) => String(o?.key || '').trim() === nextSize)
        if (found2k?.label) {
          nextSize = String(found2k.label)
          nextQuality = '2K'
        } else if (found4k?.label) {
          nextSize = String(found4k.label)
          nextQuality = '4K'
        } else {
          nextSize = defaultRatio
        }
      } else {
        nextSize = defaultRatio
      }
    }

    if (nextSize === curSize && nextQuality === curQuality) return
    setSize(nextSize)
    setQuality(nextQuality)
    useGraphStore.getState().updateNode(id, { data: { size: nextSize, quality: nextQuality } } as any)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [model])

  // 自动执行逻辑：当 autoExecute 为 true 时自动生成图片
  useEffect(() => {
    if (nodeData?.autoExecute && !autoExecuteTriggered.current && !loading) {
      autoExecuteTriggered.current = true
      // 清除 autoExecute 标志，防止重复触发
      useGraphStore.getState().updateNode(id, { data: { autoExecute: false } })
      
      // 延迟执行，确保节点连接已建立
      const timer = setTimeout(async () => {
        const status = getConnectionStatus()
        if (status.prompts > 0 || status.images > 0) {
          setLoading(true)
          try {
            // 直接传递参数到生成函数
            await generateImageFromConfigNode(id, { model, size, quality })
            console.log('[ImageConfigNode] 自动执行成功')
          } catch (err: any) {
            console.error('[ImageConfigNode] 自动执行失败:', err)
            window.$message?.error?.(err?.message || '自动生成失败')
          } finally {
            setLoading(false)
          }
        } else {
          console.warn('[ImageConfigNode] 自动执行跳过：没有连接的提示词或参考图')
        }
      }, 500) // 延迟 500ms 确保连接建立
      
      return () => clearTimeout(timer)
    }
  }, [nodeData?.autoExecute, id, model, size, quality, loading, getConnectionStatus])

  return (
    <div 
      className="relative pt-[20px]"
      onMouseEnter={() => setShowActions(true)}
      onMouseLeave={() => setShowActions(false)}
    >
      {/* 节点主体 */}
      <div
        className={`image-config-node bg-[var(--bg-secondary)] rounded-xl border min-w-[320px] relative transition-all duration-200 ${
          selected ? 'border-blue-500 shadow-lg shadow-blue-500/20' : 'border-[var(--border-color)]'
        }`}
      >
        {/* 头部 */}
        <div className="flex items-center justify-between px-3 py-2 border-b border-[var(--border-color)]">
          <span className="text-sm font-medium text-[var(--text-secondary)]">
            {nodeData?.label || '文生图'}
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
                // 更新默认值
                if (config?.defaultParams?.size) setSize(config.defaultParams.size)
                if (config?.defaultParams?.quality) setQuality(config.defaultParams.quality)
                debouncedUpdateStore({ 
                  model: newModel,
                  size: config?.defaultParams?.size,
                  quality: config?.defaultParams?.quality
                })
              }}
              onMouseDown={(e) => e.stopPropagation()}
              className="nodrag text-sm bg-transparent border border-[var(--border-color)] rounded px-2 py-1 outline-none max-w-[180px]"
            >
              {MODEL_OPTIONS.map((opt) => (
                <option key={opt.key} value={opt.key}>{opt.label}</option>
              ))}
            </select>
          </div>

          {/* 画质选择 */}
          {hasQualityOptions && (
            <div className="flex items-center justify-between">
              <span className="text-xs text-[var(--text-secondary)]">{qualityLabel}</span>
              <select
                value={quality}
                onChange={(e) => {
                  const newQuality = e.target.value
                  setQuality(newQuality)
                  debouncedUpdateStore({ quality: newQuality })
                }}
                onMouseDown={(e) => e.stopPropagation()}
                className="nodrag text-sm bg-transparent border border-[var(--border-color)] rounded px-2 py-1 outline-none"
              >
                {qualityOptions.map((opt: any) => (
                  <option key={opt.key} value={opt.key}>{opt.label}</option>
                ))}
              </select>
            </div>
          )}

          {/* 尺寸选择 */}
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

          {/* 连接输入指示 */}
          <ConnectionStatusIndicator getConnectionStatus={getConnectionStatus} modelKey={model} />

          {/* 参考图顺序（可调整） */}
          <ReferenceOrderEditor configNodeId={id} />

          {/* 生成按钮 - 允许多次点击 */}
          <button
            onClick={handleGenerate}
            className="w-full flex items-center justify-center gap-2 py-2 px-4 rounded-lg bg-[var(--accent-color)] hover:opacity-90 text-white text-sm font-medium"
          >
            {loading ? <span className="animate-spin">⟳</span> : <span>◆</span>}
            {loading ? '重新生成' : '立即生成'}
          </button>
        </div>

        {/* 连接点 */}
        <Handle type="target" position={Position.Left} id="left" className="handle-text" />
        <Handle type="source" position={Position.Right} id="right" className="handle-image" />
      </div>

      {/* 悬浮复制按钮 */}
      {showActions && (
        <div className="absolute -top-5 right-0 z-[1000]">
          <button
            onClick={handleDuplicate}
            className="group p-2 bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 flex items-center gap-0 hover:gap-1.5 shadow-sm w-max"
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

// 参考图顺序编辑器（基于 imageOrder edge）
const ReferenceOrderEditor = memo(function ReferenceOrderEditor({ configNodeId }: { configNodeId: string }) {
  const [items, setItems] = useState<
    { edgeId: string; order: number; nodeId: string; label: string }[]
  >([])

  const recompute = useCallback(() => {
    const s = useGraphStore.getState()
    const byId = new Map(s.nodes.map((n) => [n.id, n]))
    const edges = s.edges.filter((e) => e.target === configNodeId)
    const list: { edgeId: string; order: number; nodeId: string; label: string }[] = []
    const usedOrders = new Set<number>()
    const missing: { edgeId: string; idx: number }[] = []

    edges.forEach((e, idx) => {
      const src = byId.get(e.source)
      if (!src || src.type !== 'image') return
      const orderRaw = Number((e.data as any)?.imageOrder)
      const orderOk = Number.isFinite(orderRaw) && orderRaw > 0
      const order = orderOk ? Math.floor(orderRaw) : 999999
      if (orderOk) usedOrders.add(Math.floor(orderRaw))
      else missing.push({ edgeId: e.id, idx })

      const label = String((src.data as any)?.label || '').trim() || `参考图 ${src.id}`
      list.push({ edgeId: e.id, order, nodeId: src.id, label })
    })

    // 兼容旧画布：早期 edge 可能没有 imageOrder，导致“上/下移”无效
    // 这里为缺失的边补齐连续的 imageOrder（尽量保持原连接顺序）
    if (missing.length > 0) {
      useGraphStore.getState().withBatchUpdates(() => {
        let next = 1
        const sortedMissing = missing.slice().sort((a, b) => a.idx - b.idx)
        for (const m of sortedMissing) {
          while (usedOrders.has(next)) next++
          useGraphStore.getState().updateEdge(m.edgeId, { type: 'imageOrder', data: { imageOrder: next } } as any)
          usedOrders.add(next)
          next++
        }
      })
      return
    }
    list.sort((a, b) => (a.order - b.order) || a.label.localeCompare(b.label))
    setItems(list)
  }, [configNodeId])

  useEffect(() => {
    recompute()
    const unsub = useGraphStore.subscribe(
      (state, prev) => {
        if (state.edges !== prev.edges || state.nodes !== prev.nodes) {
          recompute()
        }
      }
    )
    return unsub
  }, [recompute])

  const moveUp = useCallback(
    (idx: number) => {
      if (idx <= 0) return
      const a = items[idx]
      const b = items[idx - 1]
      if (!a || !b) return
      // swap orders via store helper
      useGraphStore.getState().setEdgeImageOrder(a.edgeId, b.order)
      recompute()
    },
    [items, recompute]
  )

  const moveDown = useCallback(
    (idx: number) => {
      if (idx >= items.length - 1) return
      const a = items[idx]
      const b = items[idx + 1]
      if (!a || !b) return
      useGraphStore.getState().setEdgeImageOrder(a.edgeId, b.order)
      recompute()
    },
    [items, recompute]
  )

  if (!items || items.length <= 1) return null

  return (
    <div className="rounded-lg border border-[var(--border-color)] bg-[var(--bg-tertiary)] p-2">
      <div className="text-[11px] font-bold uppercase text-[var(--text-secondary)]">参考图顺序</div>
      <div className="mt-2 space-y-1">
        {items.map((it, idx) => (
          <div key={it.edgeId} className="flex items-center justify-between gap-2 rounded-md bg-[var(--bg-secondary)] px-2 py-1">
            <div className="min-w-0 flex-1 truncate text-xs text-[var(--text-primary)]">
              {idx + 1}. {it.label}
            </div>
            <div className="flex items-center gap-1">
              <button
                type="button"
                className="rounded p-1 text-[var(--text-secondary)] hover:bg-[var(--bg-primary)] disabled:opacity-40"
                disabled={idx === 0}
                onMouseDown={(e) => e.stopPropagation()}
                onClick={(e) => {
                  e.stopPropagation()
                  moveUp(idx)
                }}
                title="上移"
              >
                <ArrowUp size={14} />
              </button>
              <button
                type="button"
                className="rounded p-1 text-[var(--text-secondary)] hover:bg-[var(--bg-primary)] disabled:opacity-40"
                disabled={idx === items.length - 1}
                onMouseDown={(e) => e.stopPropagation()}
                onClick={(e) => {
                  e.stopPropagation()
                  moveDown(idx)
                }}
                title="下移"
              >
                <ArrowDown size={14} />
              </button>
            </div>
          </div>
        ))}
      </div>
      <div className="mt-2 text-[11px] text-[var(--text-secondary)] opacity-80">
        说明：顺序会影响部分模型对多张参考图的优先级。
      </div>
    </div>
  )
})

// 连接状态指示器组件
const ConnectionStatusIndicator = memo(function ConnectionStatusIndicator({ 
  getConnectionStatus,
  modelKey,
}: { 
  getConnectionStatus: () => { prompts: number; images: number } 
  modelKey: string
}) {
  const [status, setStatus] = useState(() => getConnectionStatus())
  const caps = useMemo(() => getImageModelCaps(modelKey), [modelKey])
  
  // 订阅边和节点数据的变化以更新状态
  useEffect(() => {
    // 初始化时更新一次
    setStatus(getConnectionStatus())
    
    // 订阅 store 变化（边或节点数据变化时更新）
    const unsubscribe = useGraphStore.subscribe(
      (state, prevState) => {
        // 边变化时更新
        if (state.edges !== prevState.edges) {
          setStatus(getConnectionStatus())
          return
        }
        // 节点数据变化时也需要更新（检查 content 变化）
        if (state.nodes !== prevState.nodes) {
          // 检查是否有文本节点的 content 变化
          const hasContentChange = state.nodes.some((node, idx) => {
            const prevNode = prevState.nodes[idx]
            if (!prevNode || node.type !== 'text') return false
            return (node.data as any)?.content !== (prevNode.data as any)?.content
          })
          if (hasContentChange) {
            setStatus(getConnectionStatus())
          }
        }
      }
    )
    return unsubscribe
  }, [getConnectionStatus])

  return (
    <div 
      className="text-xs text-[var(--text-secondary)] py-2 border-t border-[var(--border-color)]"
    >
      <div className="flex items-center gap-2">
        {(() => {
          const missingRequired = caps.requiresPrompt && status.prompts === 0
          return (
            <span className={`px-2 py-0.5 rounded-full ${
              status.prompts > 0
                ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400'
                : missingRequired
                  ? 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400'
                  : 'bg-gray-100 text-gray-500 dark:bg-gray-800'
            }`}>
              提示词 {status.prompts > 0 ? '✓' : '○'}
            </span>
          )
        })()}
        {(() => {
          const hasImages = status.images > 0
          const missingRequired = caps.requiresReferenceImages && !hasImages
          const unsupportedButProvided = !caps.supportsReferenceImages && hasImages
          const badge =
            hasImages ? `${status.images}张` : '○'
          return (
            <span className={`px-2 py-0.5 rounded-full ${
              unsupportedButProvided || missingRequired
                ? 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400'
                : hasImages
                  ? 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400'
                  : 'bg-gray-100 text-gray-500 dark:bg-gray-800'
            }`}>
              {caps.supportsReferenceImages ? '参考图' : '参考图(不支持)'} {badge}
            </span>
          )
        })()}
      </div>
    </div>
  )
})
