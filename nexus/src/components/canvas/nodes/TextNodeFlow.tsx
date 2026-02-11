/**
 * TextNodeFlow - React Flow 版本的文本节点
 * 完全对齐 Huobao 的 TextNode.vue 实现
 * 
 * 性能优化：
 * 1. 使用 useRef 存储内容，避免每次输入都重渲染
 * 2. 只在 blur 时同步到 store
 * 3. 完全避免订阅 store
 */
import React, { memo, useState, useCallback, useRef, useEffect } from 'react'
import { Position, NodeProps } from '@xyflow/react'
import { TapNodeHandle } from './shared/TapNodeHandle'
import { Copy, Trash2, ImageIcon, Video, Expand, Loader2 } from 'lucide-react'
import { useGraphStore } from '@/graph/store'
import { DEFAULT_IMAGE_MODEL, DEFAULT_VIDEO_MODEL, IMAGE_MODELS, VIDEO_MODELS } from '@/config/models'
import { callAiAssistant } from '@/lib/nexusApi'
import { 
  inferPolishModeFromText, 
  inferPolishModeFromGraph,
  selectBestPromptTemplate,
  collectUpstreamInputsForFocus,
  buildPolishUserText,
  buildPolishSystemPrompt
} from '@/lib/polish'

interface TextNodeData {
  content?: string
  label?: string
  width?: number
  height?: number
}

// 默认尺寸
const DEFAULT_WIDTH = 280
const DEFAULT_HEIGHT = 150
const MIN_WIDTH = 200
const MIN_HEIGHT = 100
const MAX_WIDTH = 600
const MAX_HEIGHT = 500

export const TextNodeComponent = memo(function TextNode({ id, data, selected }: NodeProps) {
  const nodeData = data as TextNodeData
  // 使用 ref 存储内容，避免每次输入都触发重渲染
  const contentRef = useRef(nodeData?.content || '')
  const [displayContent, setDisplayContent] = useState(nodeData?.content || '')
  const [showActions, setShowActions] = useState(false)
  const [polishing, setPolishing] = useState(false)
  
  // 节点尺寸状态
  const [nodeWidth, setNodeWidth] = useState(nodeData?.width || DEFAULT_WIDTH)
  const [nodeHeight, setNodeHeight] = useState(nodeData?.height || DEFAULT_HEIGHT)
  const [isResizing, setIsResizing] = useState(false)
  const resizeStartRef = useRef({ x: 0, y: 0, width: 0, height: 0 })

  // 同步外部数据变化（例如从 store 更新）
  useEffect(() => {
    if (nodeData?.width && nodeData.width !== nodeWidth) {
      setNodeWidth(nodeData.width)
    }
    if (nodeData?.height && nodeData.height !== nodeHeight) {
      setNodeHeight(nodeData.height)
    }
  }, [nodeData?.width, nodeData?.height])

  // 更新内容到 store（只在 blur 时）
  const handleBlur = useCallback(() => {
    // 使用 setTimeout 延迟执行，避免阻塞 UI
    setTimeout(() => {
      useGraphStore.getState().updateNode(id, { data: { content: contentRef.current } })
    }, 0)
  }, [id])

  // 调整大小开始
  const handleResizeStart = useCallback((e: React.MouseEvent) => {
    e.stopPropagation()
    e.preventDefault()
    setIsResizing(true)
    resizeStartRef.current = {
      x: e.clientX,
      y: e.clientY,
      width: nodeWidth,
      height: nodeHeight
    }

    let currentWidth = nodeWidth
    let currentHeight = nodeHeight

    const handleMouseMove = (moveEvent: MouseEvent) => {
      const deltaX = moveEvent.clientX - resizeStartRef.current.x
      const deltaY = moveEvent.clientY - resizeStartRef.current.y

      currentWidth = Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, resizeStartRef.current.width + deltaX))
      currentHeight = Math.min(MAX_HEIGHT, Math.max(MIN_HEIGHT, resizeStartRef.current.height + deltaY))

      setNodeWidth(currentWidth)
      setNodeHeight(currentHeight)
    }

    const handleMouseUp = () => {
      setIsResizing(false)
      document.removeEventListener('mousemove', handleMouseMove)
      document.removeEventListener('mouseup', handleMouseUp)

      // 保存尺寸到 store（使用最新值）
      useGraphStore.getState().updateNode(id, {
        data: { width: currentWidth, height: currentHeight }
      })
    }

    document.addEventListener('mousemove', handleMouseMove)
    document.addEventListener('mouseup', handleMouseUp)
  }, [id, nodeWidth, nodeHeight])

  // 删除节点
  const handleDelete = useCallback((e: React.MouseEvent) => {
    e.stopPropagation()
    useGraphStore.getState().removeNode(id)
  }, [id])

  // 复制节点
  const handleDuplicate = useCallback((e: React.MouseEvent) => {
    e.stopPropagation()
    const store = useGraphStore.getState()
    const node = store.nodes.find((n) => n.id === id)
    if (node) {
      store.addNode('text', { x: node.x + 50, y: node.y + 50 }, { ...node.data })
    }
  }, [id])

  // 生成图片
  const handleImageGen = useCallback((e: React.MouseEvent) => {
    e.stopPropagation()
    const store = useGraphStore.getState()
    const node = store.nodes.find((n) => n.id === id)
    if (node) {
      const baseModelCfg: any = (IMAGE_MODELS as any[]).find((m: any) => m.key === DEFAULT_IMAGE_MODEL) || (IMAGE_MODELS as any[])[0]
      const newNodeId = store.addNode(
        'imageConfig',
        { x: node.x + 400, y: node.y },
        { 
          label: '文生图',
          model: DEFAULT_IMAGE_MODEL,
          size: baseModelCfg?.defaultParams?.size,
          quality: baseModelCfg?.defaultParams?.quality,
        }
      )
      store.addEdge(id, newNodeId, { sourceHandle: 'right', targetHandle: 'left' })
    }
  }, [id])

  // 生成视频
  const handleVideoGen = useCallback((e: React.MouseEvent) => {
    e.stopPropagation()
    const store = useGraphStore.getState()
    const node = store.nodes.find((n) => n.id === id)
    if (node) {
      const baseModelCfg: any = (VIDEO_MODELS as any[]).find((m: any) => m.key === DEFAULT_VIDEO_MODEL) || (VIDEO_MODELS as any[])[0]
      const newNodeId = store.addNode(
        'videoConfig',
        { x: node.x + 400, y: node.y },
        { 
          label: '视频生成',
          model: DEFAULT_VIDEO_MODEL,
          ratio: baseModelCfg?.defaultParams?.ratio,
          dur: baseModelCfg?.defaultParams?.duration,
          size: baseModelCfg?.defaultParams?.size,
        }
      )
      store.addEdge(id, newNodeId, { sourceHandle: 'right', targetHandle: 'left' })
    }
  }, [id])

  // AI 润色
  const handlePolish = useCallback(async (e: React.MouseEvent) => {
    e.stopPropagation()
    const text = contentRef.current.trim()
    if (!text) {
      window.$message?.warning?.('请先输入文本内容')
      return
    }
    
    setPolishing(true)
    try {
      const store = useGraphStore.getState()
      const { nodes, edges } = store
      
      // 获取全局 AI 助手模型设置
      const aiModel = 'gemini-3-pro-preview-thinking'
      
      // 1. 推断润色模式
      const modeFromGraph = inferPolishModeFromGraph(id, nodes, edges)
      const mode = modeFromGraph || inferPolishModeFromText(text)
      
      // 2. 收集上游输入
      const upstreamInputs = collectUpstreamInputsForFocus({ focusNodeId: id, nodes, edges })
      
      // 3. 选择最佳提示词模板
      const promptTemplate = await selectBestPromptTemplate({
        mode,
        userText: text,
        contextText: ''
      })
      
      // 4. 构建润色请求
      const userMessage = buildPolishUserText({
        mode,
        userText: text,
        promptTemplate,
        upstreamInputs
      })
      const systemPrompt = buildPolishSystemPrompt(mode)
      
      // 5. 调用 AI API（使用全局设置的模型）
      const polished = await callAiAssistant(
        aiModel,
        [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userMessage }
        ],
        { filterThinking: true }
      )
      
      if (polished) {
        contentRef.current = polished
        setDisplayContent(polished)
        // 同步到 store
        store.updateNode(id, { data: { content: polished } })
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
  }, [id])

  return (
    <div
      className="relative pr-[50px] pt-[20px]"
      onMouseEnter={() => setShowActions(true)}
      onMouseLeave={() => setShowActions(false)}
    >
      {/* 节点主体 */}
      <div
        className={`group text-node bg-[var(--bg-secondary)] rounded-xl relative transition-all duration-200 shadow-sm hover:shadow-md ${isResizing ? 'select-none' : ''}`}
        style={{ width: nodeWidth, minHeight: nodeHeight }}
      >
        {/* 标签 (小字) */}
        <div className="px-3 pt-2 pb-0.5">
          <span className="text-[10px] font-medium text-[var(--text-secondary)] uppercase tracking-wide">
            {nodeData?.label || '文本'}
          </span>
        </div>

        {/* 内容 */}
        <div className="px-3 pb-3 flex flex-col" style={{ height: nodeHeight - 40 }}>
          <textarea
            value={displayContent}
            onChange={(e) => {
              const val = e.target.value
              contentRef.current = val
              setDisplayContent(val)
            }}
            onBlur={handleBlur}
            onMouseDown={(e) => e.stopPropagation()}
            onWheel={(e) => e.stopPropagation()}
            className="nodrag nowheel w-full bg-transparent resize-none outline-none text-sm text-[var(--text-primary)] placeholder:text-[var(--text-secondary)] placeholder:opacity-40 flex-1 select-text"
            placeholder="输入描述..."
            style={{ minHeight: Math.max(60, nodeHeight - 80), userSelect: 'text', WebkitUserSelect: 'text' }}
          />
        </div>

        {/* AI 润色按钮 */}
        <button
          onClick={handlePolish}
          disabled={!displayContent.trim() || polishing}
          className="absolute bottom-2 left-4 px-2 py-0.5 text-xs rounded-md bg-[var(--bg-tertiary)] hover:bg-emerald-500 hover:text-white border border-[var(--border-color)] transition-colors disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-1"
          title="AI 润色"
        >
          {polishing ? (
            <Loader2 size={10} className="animate-spin" />
          ) : (
            <span>✨ AI</span>
          )}
        </button>

        {/* Hover: 删除按钮 */}
        {showActions && (
          <div className="absolute top-1.5 right-1.5 flex items-center gap-0.5">
            <button onClick={handleDelete} className="p-1 rounded hover:bg-red-500/20 transition-colors" title="删除">
              <Trash2 size={12} className="text-[var(--text-secondary)]" />
            </button>
          </div>
        )}

        {/* 调整大小手柄 */}
        <div
          onMouseDown={handleResizeStart}
          className="nodrag absolute bottom-0 right-0 w-4 h-4 cursor-se-resize group"
        >
          <svg
            className="absolute bottom-1 right-1 w-2 h-2 text-[var(--text-secondary)] opacity-30 group-hover:opacity-60 transition-opacity"
            viewBox="0 0 10 10"
            fill="currentColor"
          >
            <path d="M9 1L1 9M9 5L5 9M9 9L9 9" stroke="currentColor" strokeWidth="1.5" fill="none" strokeLinecap="round"/>
          </svg>
        </div>

        {/* 连接点 */}
        <TapNodeHandle type="source" position={Position.Right} id="right" />
        <TapNodeHandle type="target" position={Position.Left} id="left" />
      </div>

      {showActions && (
        <div className="absolute -top-5 right-12 z-[1000]">
          <button onClick={handleDuplicate} className="group p-2 bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 flex items-center gap-0 hover:gap-1.5 transition-all shadow-sm w-max">
            <Copy size={16} className="text-gray-600 dark:text-gray-300" />
            <span className="text-xs text-gray-600 dark:text-gray-300 max-w-0 overflow-hidden group-hover:max-w-[60px] transition-all duration-200 whitespace-nowrap">复制</span>
          </button>
        </div>
      )}

      {showActions && (
        <div className="absolute right-10 top-1/2 -translate-y-1/2 translate-x-full flex flex-col gap-2 z-[1000]">
          <button onClick={handleImageGen} className="group p-2 bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 flex items-center gap-0 hover:gap-1.5 transition-all shadow-sm w-max">
            <ImageIcon size={16} className="text-gray-600 dark:text-gray-300" />
            <span className="text-xs text-gray-600 dark:text-gray-300 max-w-0 overflow-hidden group-hover:max-w-[80px] transition-all duration-200 whitespace-nowrap">图片生成</span>
          </button>
          <button onClick={handleVideoGen} className="group p-2 bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 flex items-center gap-0 hover:gap-1.5 transition-all shadow-sm w-max">
            <Video size={16} className="text-gray-600 dark:text-gray-300" />
            <span className="text-xs text-gray-600 dark:text-gray-300 max-w-0 overflow-hidden group-hover:max-w-[80px] transition-all duration-200 whitespace-nowrap">视频生成</span>
          </button>
        </div>
      )}
    </div>
  )
})
