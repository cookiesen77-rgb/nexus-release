/**
 * NodeCardsLayer - 高性能版本
 * 
 * 优化策略：
 * 1. 使用 shallow 比较减少重渲染
 * 2. 节点组件使用 memo + 稳定的 props
 * 3. 所有事件处理使用 stopPropagation
 */
import React, { memo, useCallback, useState } from 'react'
import { shallow } from 'zustand/shallow'
import type { GraphNode, NodeType } from '@/graph/types'
import { useGraphStore } from '@/graph/store'
import { useSettingsStore } from '@/store/settings'
import { getNodeWidth } from '@/graph/nodeSizing'
import { DEFAULT_IMAGE_MODEL, IMAGE_MODELS, VIDEO_MODELS, DEFAULT_VIDEO_MODEL } from '@/config/models'
import { Copy, Image, Video, Loader2 } from 'lucide-react'
import { callAiAssistant } from '@/lib/nexusApi'
import {
  inferPolishModeFromText,
  inferPolishModeFromGraph,
  selectBestPromptTemplate,
  collectUpstreamInputsForFocus,
  buildPolishUserText,
  buildPolishSystemPrompt
} from '@/lib/polish'

const getString = (v: unknown, fallback = '') => (typeof v === 'string' ? v : v == null ? fallback : String(v))

// ============= 悬浮操作按钮组件 =============
const HoverActionButton = memo(function HoverActionButton({
  icon: Icon,
  label,
  onClick
}: {
  icon: React.ComponentType<{ className?: string }>
  label: string
  onClick: () => void
}) {
  return (
    <button
      onClick={onClick}
      onPointerDown={e => e.stopPropagation()}
      className="group p-2 bg-white dark:bg-gray-800 rounded-lg transition-all border border-gray-200 dark:border-gray-700 flex items-center gap-0 hover:gap-1.5 w-max shadow-sm hover:shadow"
    >
      <Icon className="h-4 w-4 text-gray-600 dark:text-gray-300" />
      <span className="text-xs text-gray-600 dark:text-gray-300 max-w-0 overflow-hidden group-hover:max-w-[80px] transition-all duration-200 whitespace-nowrap">
        {label}
      </span>
    </button>
  )
})

// ============= 节点悬浮操作 =============
const NodeHoverActions = memo(function NodeHoverActions({
  node,
  showActions
}: {
  node: GraphNode
  showActions: boolean
}) {
  const handleDuplicate = useCallback(() => {
    const s = useGraphStore.getState()
    const next = s.duplicateNode(node.id)
    if (next) s.setSelected(next)
  }, [node.id])

  const handleSpawnImageConfig = useCallback(() => {
    const store = useGraphStore.getState()
    const userDefault = useSettingsStore.getState().defaultImageModel
    const modelKey = (userDefault && (IMAGE_MODELS as any[]).some((m: any) => m.key === userDefault)) ? userDefault : DEFAULT_IMAGE_MODEL
    const baseModelCfg: any = (IMAGE_MODELS as any[]).find((m: any) => m.key === modelKey) || (IMAGE_MODELS as any[])[0]
    const id = store.addNode('imageConfig', { x: node.x + 340, y: node.y }, {
      label: '文生图',
      model: modelKey,
      size: baseModelCfg?.defaultParams?.size,
      quality: baseModelCfg?.defaultParams?.quality,
    })
    store.addEdge(node.id, id, {})
    store.setSelected(id)
  }, [node.id, node.x, node.y])

  const handleSpawnVideoConfig = useCallback(() => {
    const store = useGraphStore.getState()
    const userDefault = useSettingsStore.getState().defaultVideoModel
    const modelKey = (userDefault && (VIDEO_MODELS as any[]).some((m: any) => m.key === userDefault)) ? userDefault : DEFAULT_VIDEO_MODEL
    const baseModelCfg: any = (VIDEO_MODELS as any[]).find((m: any) => m.key === modelKey) || (VIDEO_MODELS as any[])[0]
    const id = store.addNode('videoConfig', { x: node.x + 340, y: node.y }, {
      label: '视频生成',
      model: modelKey,
      ratio: baseModelCfg?.defaultParams?.ratio,
      dur: baseModelCfg?.defaultParams?.duration,
      size: baseModelCfg?.defaultParams?.size,
    })
    store.addEdge(node.id, id, {})
    store.setSelected(id)
  }, [node.id, node.x, node.y])

  if (!showActions) return null

  // 判断节点类型，决定显示哪些按钮
  const isTextNode = node.type === 'text'
  const isImageNode = node.type === 'image'
  const showImageGen = isTextNode
  const showVideoGen = isTextNode || isImageNode

  return (
    <>
      {/* 右上角 - 复制按钮 */}
      <div className="absolute -top-5 right-0 z-[1000]">
        <HoverActionButton icon={Copy} label="复制" onClick={handleDuplicate} />
      </div>

      {/* 右侧 - 操作按钮 */}
      {(showImageGen || showVideoGen) && (
        <div className="absolute right-0 top-1/2 -translate-y-1/2 translate-x-[calc(100%+12px)] flex flex-col gap-2 z-[1000]">
          {showImageGen && (
            <HoverActionButton icon={Image} label="图片生成" onClick={handleSpawnImageConfig} />
          )}
          {showVideoGen && (
            <HoverActionButton icon={Video} label="视频生成" onClick={handleSpawnVideoConfig} />
          )}
        </div>
      )}
    </>
  )
})

// ============= 节点外壳 =============
const NodeShell = memo(function NodeShell({ 
  node, 
  selected,
  children 
}: { 
  node: GraphNode
  selected: boolean
  children: React.ReactNode 
}) {
  const [showActions, setShowActions] = useState(false)
  const w = getNodeWidth(node.type)
  const label = getString((node.data as any)?.label) || node.type

  return (
    <div
      className="node-wrapper"
      style={{
        position: 'absolute',
        transform: `translate3d(${node.x}px, ${node.y}px, 0)`,
        zIndex: (node.zIndex || 0) + (selected ? 10000 : 0),
        paddingRight: 60,
        paddingTop: 24
      }}
      onMouseEnter={() => setShowActions(true)}
      onMouseLeave={() => setShowActions(false)}
    >
      {/* 悬浮操作按钮 */}
      <NodeHoverActions node={node} showActions={showActions} />
      
      {/* 节点主体 */}
      <div
        data-node-id={node.id}
        className={`border bg-[var(--bg-secondary)] ${
          selected ? 'border-blue-500 ring-2 ring-blue-500/30' : 'border-[var(--border-color)]'
        }`}
        style={{
          width: w,
          borderRadius: 12,
          backfaceVisibility: 'hidden',
          contain: 'layout style'
        }}
      >
        <div className="flex items-center justify-between px-3 py-2 border-b border-[var(--border-color)]">
          <span className="text-sm font-medium text-[var(--text-secondary)] truncate">{label}</span>
          <div className="flex gap-1" onPointerDown={e => e.stopPropagation()}>
            <button 
              className="p-1 hover:bg-[var(--bg-tertiary)] rounded text-xs"
              onClick={() => {
                const s = useGraphStore.getState()
                const next = s.duplicateNode(node.id)
                if (next) s.setSelected(next)
              }}
            >
              复制
            </button>
            <button 
              className="p-1 hover:bg-[var(--bg-tertiary)] rounded text-xs"
              onClick={() => useGraphStore.getState().removeNode(node.id)}
            >
              删除
            </button>
          </div>
        </div>
        <div className="p-3">{children}</div>
        <div className="absolute left-0 top-1/2 w-3 h-3 -translate-x-1/2 -translate-y-1/2 rounded-full bg-[var(--accent-color)] border-2 border-[var(--bg-secondary)]" />
        <div className="absolute right-0 top-1/2 w-3 h-3 translate-x-1/2 -translate-y-1/2 rounded-full bg-[var(--accent-color)] border-2 border-[var(--bg-secondary)]" />
      </div>
    </div>
  )
})

// ============= 文本节点 =============
const TextNodeContent = memo(function TextNodeContent({ node }: { node: GraphNode }) {
  const d = node.data as any || {}
  const [displayContent, setDisplayContent] = useState(getString(d.content))
  const [polishing, setPolishing] = useState(false)

  const handleSpawn = useCallback((type: NodeType) => {
    const store = useGraphStore.getState()
    const settings = useSettingsStore.getState()
    let initData: Record<string, any> = {}
    if (type === 'imageConfig') {
      const userDefault = settings.defaultImageModel
      const modelKey = (userDefault && (IMAGE_MODELS as any[]).some((m: any) => m.key === userDefault)) ? userDefault : DEFAULT_IMAGE_MODEL
      const cfg: any = (IMAGE_MODELS as any[]).find((m: any) => m.key === modelKey) || (IMAGE_MODELS as any[])[0]
      initData = { label: '文生图', model: modelKey, size: cfg?.defaultParams?.size, quality: cfg?.defaultParams?.quality }
    } else if (type === 'videoConfig') {
      const userDefault = settings.defaultVideoModel
      const modelKey = (userDefault && (VIDEO_MODELS as any[]).some((m: any) => m.key === userDefault)) ? userDefault : DEFAULT_VIDEO_MODEL
      const cfg: any = (VIDEO_MODELS as any[]).find((m: any) => m.key === modelKey) || (VIDEO_MODELS as any[])[0]
      initData = { label: '视频生成', model: modelKey, ratio: cfg?.defaultParams?.ratio, dur: cfg?.defaultParams?.duration, size: cfg?.defaultParams?.size }
    }
    const id = store.addNode(type, { x: node.x + 340, y: node.y }, initData)
    store.addEdge(node.id, id, {})
    store.setSelected(id)
  }, [node.id, node.x, node.y])

  const handlePolish = useCallback(async () => {
    const text = displayContent.trim()
    if (!text) {
      window.$message?.warning?.('请先输入文本内容')
      return
    }

    setPolishing(true)
    try {
      const store = useGraphStore.getState()
      const { nodes, edges } = store
      const aiModel = useSettingsStore.getState().aiAssistantModel || 'gpt-5-mini'

      const modeFromGraph = inferPolishModeFromGraph(node.id, nodes, edges)
      const mode = modeFromGraph || inferPolishModeFromText(text)

      const upstreamInputs = collectUpstreamInputsForFocus({ focusNodeId: node.id, nodes, edges })
      const promptTemplate = await selectBestPromptTemplate({ mode, userText: text, contextText: '' })
      const userMessage = buildPolishUserText({ mode, userText: text, promptTemplate, upstreamInputs })
      const systemPrompt = buildPolishSystemPrompt(mode)

      const polished = await callAiAssistant(
        aiModel,
        [{ role: 'system', content: systemPrompt }, { role: 'user', content: userMessage }],
        { filterThinking: true }
      )

      if (polished) {
        setDisplayContent(polished)
        store.updateNode(node.id, { data: { ...(node.data || {}), content: polished } })
        window.$message?.success?.('润色完成')
      } else {
        window.$message?.error?.('润色失败：未获取到结果')
      }
    } catch (err: any) {
      console.error('[TextNode] AI 润色失败:', err)
      window.$message?.error?.(`润色失败: ${err?.message || '未知错误'}`)
    } finally {
      setPolishing(false)
    }
  }, [node.id, node.data, displayContent])

  return (
    <div className="space-y-2">
      <textarea
        className="w-full bg-transparent resize-none outline-none text-sm min-h-[80px]"
        placeholder="请输入文本内容..."
        value={displayContent}
        onChange={e => setDisplayContent(e.target.value)}
        onBlur={e => {
          useGraphStore.getState().updateNode(node.id, { data: { ...(node.data || {}), content: e.target.value } })
        }}
        onPointerDown={e => e.stopPropagation()}
        onWheel={e => e.stopPropagation()}
      />
      <button
        className="px-3 py-1.5 text-xs rounded-lg bg-[var(--bg-tertiary)] border border-[var(--border-color)] disabled:opacity-50 hover:bg-[var(--accent-color)] hover:text-white flex items-center gap-1"
        disabled={!displayContent.trim() || polishing}
        onPointerDown={e => e.stopPropagation()}
        onClick={handlePolish}
      >
        {polishing ? <Loader2 size={12} className="animate-spin" /> : '✨'} AI 润色
      </button>
      <div className="flex gap-2 pt-1 border-t border-[var(--border-color)]">
        <button
          className="flex-1 px-2 py-1.5 text-xs rounded-lg bg-[var(--bg-tertiary)] hover:bg-[var(--accent-color)] hover:text-white"
          onPointerDown={e => e.stopPropagation()}
          onClick={() => handleSpawn('imageConfig')}
        >
          图片生成
        </button>
        <button
          className="flex-1 px-2 py-1.5 text-xs rounded-lg bg-[var(--bg-tertiary)] hover:bg-[var(--accent-color)] hover:text-white"
          onPointerDown={e => e.stopPropagation()}
          onClick={() => handleSpawn('videoConfig')}
        >
          视频生成
        </button>
      </div>
    </div>
  )
})

// ============= 生图配置节点 =============
const ImageConfigContent = memo(function ImageConfigContent({ node }: { node: GraphNode }) {
  const d = node.data as any || {}
  const model = getString(d.model) || DEFAULT_IMAGE_MODEL
  const modelCfg = (IMAGE_MODELS as any[]).find(m => m.key === model) || (IMAGE_MODELS as any[])[0]
  const sizes = Array.isArray(modelCfg?.sizes) ? modelCfg.sizes : []

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <span className="text-xs text-[var(--text-secondary)]">模型</span>
        <select
          className="bg-transparent text-sm outline-none cursor-pointer"
          defaultValue={model}
          onChange={e => useGraphStore.getState().updateNode(node.id, { data: { ...(node.data || {}), model: e.target.value } })}
          onPointerDown={e => e.stopPropagation()}
        >
          {(IMAGE_MODELS as any[]).map((m: any) => <option key={m.key} value={m.key}>{m.label}</option>)}
        </select>
      </div>

      {sizes.length > 0 && (
        <div className="flex items-center justify-between">
          <span className="text-xs text-[var(--text-secondary)]">尺寸</span>
          <select
            className="bg-transparent text-sm outline-none cursor-pointer"
            defaultValue={getString(d.size)}
            onChange={e => useGraphStore.getState().updateNode(node.id, { data: { ...(node.data || {}), size: e.target.value } })}
            onPointerDown={e => e.stopPropagation()}
          >
            {sizes.map((s: any) => <option key={String(s.key ?? s)} value={String(s.key ?? s)}>{String(s.label ?? s)}</option>)}
          </select>
        </div>
      )}

      <div className="flex items-center gap-2 text-xs text-[var(--text-secondary)] py-1 border-t border-[var(--border-color)]">
        <span className="px-2 py-0.5 rounded-full bg-gray-100 dark:bg-gray-800">提示词 ○</span>
        <span className="px-2 py-0.5 rounded-full bg-gray-100 dark:bg-gray-800">参考图 ○</span>
      </div>

      <button
        className="w-full py-2 px-4 rounded-lg bg-[var(--accent-color)] text-white text-sm font-medium"
        onPointerDown={e => e.stopPropagation()}
      >
        ◆ 立即生成
      </button>
    </div>
  )
})

// ============= 视频配置节点 =============
const VideoConfigContent = memo(function VideoConfigContent({ node }: { node: GraphNode }) {
  const d = node.data as any || {}
  const model = getString(d.model) || DEFAULT_VIDEO_MODEL
  const modelCfg = (VIDEO_MODELS as any[]).find(m => m.key === model) || (VIDEO_MODELS as any[])[0]
  const ratios = Array.isArray(modelCfg?.ratios) ? modelCfg.ratios : []

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <span className="text-xs text-[var(--text-secondary)]">模型</span>
        <select
          className="bg-transparent text-sm outline-none cursor-pointer"
          defaultValue={model}
          onChange={e => useGraphStore.getState().updateNode(node.id, { data: { ...(node.data || {}), model: e.target.value } })}
          onPointerDown={e => e.stopPropagation()}
        >
          {(VIDEO_MODELS as any[]).map((m: any) => <option key={m.key} value={m.key}>{m.label}</option>)}
        </select>
      </div>

      {ratios.length > 0 && (
        <div className="flex items-center justify-between">
          <span className="text-xs text-[var(--text-secondary)]">比例</span>
          <select
            className="bg-transparent text-sm outline-none cursor-pointer"
            defaultValue={getString(d.ratio)}
            onChange={e => useGraphStore.getState().updateNode(node.id, { data: { ...(node.data || {}), ratio: e.target.value } })}
            onPointerDown={e => e.stopPropagation()}
          >
            <option value="">默认</option>
            {ratios.map((r: any) => <option key={String(r.key ?? r)} value={String(r.key ?? r)}>{String(r.label ?? r)}</option>)}
          </select>
        </div>
      )}

      <button
        className="w-full py-2 px-4 rounded-lg bg-[var(--accent-color)] text-white text-sm font-medium"
        onPointerDown={e => e.stopPropagation()}
      >
        ◆ 生成视频
      </button>
    </div>
  )
})

// ============= 图片节点 =============
const ImageContent = memo(function ImageContent({ node }: { node: GraphNode }) {
  const d = node.data as any || {}
  const url = getString(d.url)

  return (
    <div className="space-y-2">
      {url ? (
        <img src={url} className="w-full rounded-lg border border-[var(--border-color)]" alt="" />
      ) : (
        <div className="rounded-lg border border-[var(--border-color)] p-3 text-xs text-[var(--text-secondary)]">暂无图片</div>
      )}
      <button 
        className="w-full px-2 py-1.5 text-xs rounded-lg bg-[var(--bg-tertiary)] hover:bg-[var(--accent-color)] hover:text-white"
        onPointerDown={e => e.stopPropagation()}
        onClick={() => {
          const store = useGraphStore.getState()
          const userDefault = useSettingsStore.getState().defaultVideoModel
          const modelKey = (userDefault && (VIDEO_MODELS as any[]).some((m: any) => m.key === userDefault)) ? userDefault : DEFAULT_VIDEO_MODEL
          const baseModelCfg: any = (VIDEO_MODELS as any[]).find((m: any) => m.key === modelKey) || (VIDEO_MODELS as any[])[0]
          const id = store.addNode('videoConfig', { x: node.x + 340, y: node.y }, {
            label: '视频生成',
            model: modelKey,
            ratio: baseModelCfg?.defaultParams?.ratio,
            dur: baseModelCfg?.defaultParams?.duration,
            size: baseModelCfg?.defaultParams?.size,
          })
          store.addEdge(node.id, id, {})
          store.setSelected(id)
        }}
      >
        生成视频
      </button>
    </div>
  )
})

// ============= 视频节点 =============
const VideoContent = memo(function VideoContent({ node }: { node: GraphNode }) {
  const d = node.data as any || {}
  const url = getString(d.url)

  return url ? (
    <video 
      src={url} 
      className="w-full rounded-lg border border-[var(--border-color)]" 
      controls 
      preload="metadata"
      onPointerDown={e => e.stopPropagation()}
    />
  ) : (
    <div className="rounded-lg border border-[var(--border-color)] p-3 text-xs text-[var(--text-secondary)]">暂无视频</div>
  )
})

// ============= 音频节点 =============
const AudioContent = memo(function AudioContent({ node }: { node: GraphNode }) {
  const d = node.data as any || {}
  const url = getString(d.url)

  return url ? (
    <audio src={url} controls className="w-full" onPointerDown={e => e.stopPropagation()} />
  ) : (
    <div className="rounded-lg border border-[var(--border-color)] p-3 text-xs text-[var(--text-secondary)]">暂无音频</div>
  )
})

// ============= 本地保存节点 =============
const LocalSaveContent = memo(function LocalSaveContent() {
  return (
    <>
      <div className="text-xs text-[var(--text-secondary)]">连接素材节点后点击保存</div>
      <button 
        className="mt-2 w-full px-2 py-1.5 text-xs rounded-lg bg-[var(--bg-tertiary)] hover:bg-[var(--accent-color)] hover:text-white"
        onPointerDown={e => e.stopPropagation()}
      >
        缓存到本地
      </button>
    </>
  )
})

// ============= 单个节点组件 =============
const NodeCard = memo(function NodeCard({ 
  node, 
  selected 
}: { 
  node: GraphNode
  selected: boolean 
}) {
  let content: React.ReactNode
  
  switch (node.type) {
    case 'text':
      content = <TextNodeContent node={node} />
      break
    case 'imageConfig':
      content = <ImageConfigContent node={node} />
      break
    case 'videoConfig':
      content = <VideoConfigContent node={node} />
      break
    case 'image':
      content = <ImageContent node={node} />
      break
    case 'video':
      content = <VideoContent node={node} />
      break
    case 'audio':
      content = <AudioContent node={node} />
      break
    case 'localSave':
      content = <LocalSaveContent />
      break
    default:
      content = <div className="text-xs text-[var(--text-secondary)]">未知类型: {node.type}</div>
  }

  return (
    <NodeShell node={node} selected={selected}>
      {content}
    </NodeShell>
  )
})

// ============= 主组件 =============
export default memo(function NodeCardsLayer({ viewportOverride }: { viewportOverride?: { x: number; y: number; zoom: number } | null }) {
  // 使用 shallow 比较，只有当这些值真正变化时才重新渲染
  // 注意：不订阅 viewport.zoom，因为 DOMGraphCanvas 通过 CSS transform 处理缩放
  const { nodes, selectedId, selectedIds } = useGraphStore(
    s => ({
      nodes: s.nodes,
      selectedId: s.selectedNodeId,
      selectedIds: s.selectedNodeIds
    }),
    shallow
  )
  
  // 通过 getState 获取 zoom，不触发订阅（或使用 viewportOverride 如果提供）
  const zoom = viewportOverride?.zoom ?? useGraphStore.getState().viewport.zoom
  if (zoom < 0.2) return null

  // 按 zIndex 排序
  const sorted = [...nodes].sort((a, b) => (a.zIndex || 0) - (b.zIndex || 0))

  return (
    <>
      {sorted.map(node => (
        <NodeCard
          key={node.id}
          node={node}
          selected={selectedIds.includes(node.id) || selectedId === node.id}
        />
      ))}
    </>
  )
})
