/**
 * TextNodeFlow - TapNow 风格文本节点
 *
 * 空节点: 显示功能入口(自己编写/文字生视频/图片反推/文字生音乐)
 * 有内容: 显示"双击开始编辑..."或实际内容
 * 编辑模式: 双击进入, 上方格式工具栏
 */
import React, { memo, useState, useCallback, useRef, useEffect } from 'react'
import { Position, NodeProps } from '@xyflow/react'
import { TapNodeHandle } from './shared/TapNodeHandle'
import { Pencil, Video, Music, Type, Loader2, Bold, Italic, List, ListOrdered, Minus, Copy, Maximize2, Heading1, Heading2, Heading3, Pilcrow } from 'lucide-react'
import { useGraphStore } from '@/graph/store'
import { DEFAULT_VIDEO_MODEL, VIDEO_MODELS } from '@/config/models'
import { useSettingsStore } from '@/store/settings'
import { callAiAssistant } from '@/lib/nexusApi'
import { inferPolishModeFromText, buildPolishUserText, buildPolishSystemPrompt } from '@/lib/polish'

interface TextNodeData {
  content?: string
  label?: string
  width?: number
  height?: number
  mode?: 'empty' | 'edit' | 'display'
}

const DEFAULT_WIDTH = 250
const DEFAULT_HEIGHT = 250

export const TextNodeComponent = memo(function TextNode({ id, data, selected }: NodeProps) {
  const nodeData = data as TextNodeData
  const contentRef = useRef(nodeData?.content || '')
  const [displayContent, setDisplayContent] = useState(nodeData?.content || '')
  const [editing, setEditing] = useState(false)
  const [showActions, setShowActions] = useState(false)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  const hasContent = !!displayContent.trim()
  const isEmpty = !hasContent && !editing

  useEffect(() => {
    if (nodeData?.content !== undefined && nodeData.content !== contentRef.current) {
      contentRef.current = nodeData.content || ''
      setDisplayContent(nodeData.content || '')
    }
  }, [nodeData?.content])

  const syncToStore = useCallback(() => {
    setTimeout(() => {
      useGraphStore.getState().updateNode(id, { data: { content: contentRef.current } })
    }, 0)
  }, [id])

  const handleStartEdit = useCallback((e: React.MouseEvent) => {
    e.stopPropagation()
    setEditing(true)
    setTimeout(() => textareaRef.current?.focus(), 50)
  }, [])

  const handleDoubleClick = useCallback((e: React.MouseEvent) => {
    e.stopPropagation()
    setEditing(true)
    setTimeout(() => textareaRef.current?.focus(), 50)
  }, [])

  // 文字生视频: text → video
  const handleTextToVideo = useCallback((e: React.MouseEvent) => {
    e.stopPropagation()
    const store = useGraphStore.getState()
    const node = store.nodes.find(n => n.id === id)
    if (!node) return
    const videoId = store.addNode('video', { x: node.x + 350, y: node.y }, { label: 'Video' })
    store.addEdge(id, videoId, { sourceHandle: 'right', targetHandle: 'left' })
    store.setSelected(videoId)
  }, [id])

  // 图片反推提示词: image → text (当前节点)
  const handleImageReverse = useCallback((e: React.MouseEvent) => {
    e.stopPropagation()
    const store = useGraphStore.getState()
    const node = store.nodes.find(n => n.id === id)
    if (!node) return
    const imageId = store.addNode('image', { x: node.x - 350, y: node.y }, { label: '上传图片' })
    store.addEdge(imageId, id, { sourceHandle: 'right', targetHandle: 'left' })
    store.setSelected(imageId)
    window.$message?.info?.('请在图片节点上传图片，然后使用底部面板生成提示词')
  }, [id])

  // 文字生音乐: text → audio
  const handleTextToAudio = useCallback((e: React.MouseEvent) => {
    e.stopPropagation()
    const store = useGraphStore.getState()
    const node = store.nodes.find(n => n.id === id)
    if (!node) return
    const audioId = store.addNode('audio', { x: node.x + 350, y: node.y }, { label: '音频' })
    store.addEdge(id, audioId, { sourceHandle: 'right', targetHandle: 'left' })
    store.setSelected(audioId)
  }, [id])

  return (
    <div
      className="relative"
      onMouseEnter={() => setShowActions(true)}
      onMouseLeave={() => setShowActions(false)}
    >
      {/* TapNow: 标签在节点上方 */}
      <div className="group relative overflow-visible rounded-[12px] bg-[var(--bg-secondary)]"
           style={{ width: DEFAULT_WIDTH, minHeight: DEFAULT_HEIGHT }}
           onDoubleClick={handleDoubleClick}
      >
        {/* 标签 */}
        <div className="absolute -translate-y-full text-left left-0 -top-0 pb-2 w-full text-[var(--text-secondary)] overflow-hidden text-ellipsis whitespace-nowrap text-sm">
          {nodeData?.label || 'Text'}
        </div>

        {/* 空节点: 功能入口 */}
        {isEmpty && !editing && (
          <div className="w-full h-full flex flex-col justify-center gap-2 px-6 py-8" style={{ minHeight: DEFAULT_HEIGHT }}>
            <p className="text-xs text-[var(--text-secondary)] opacity-50 ml-2">尝试：</p>
            <div className="w-full space-y-1">
              <button
                onClick={handleStartEdit}
                onPointerDown={e => e.stopPropagation()}
                className="w-full text-left px-3 py-2.5 rounded-lg text-sm text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)] transition-colors flex items-center gap-2"
              >
                <Pencil size={14} className="opacity-50 shrink-0" />
                自己编写内容
              </button>
              <button
                onClick={handleTextToVideo}
                onPointerDown={e => e.stopPropagation()}
                className="w-full text-left px-3 py-2.5 rounded-lg text-sm text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)] transition-colors flex items-center gap-2"
              >
                <Video size={14} className="opacity-50 shrink-0" />
                文字生视频
              </button>
              <button
                onClick={handleImageReverse}
                onPointerDown={e => e.stopPropagation()}
                className="w-full text-left px-3 py-2.5 rounded-lg text-sm text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)] transition-colors flex items-center gap-2"
              >
                <Type size={14} className="opacity-50 shrink-0" />
                图片反推提示词
              </button>
              <button
                onClick={handleTextToAudio}
                onPointerDown={e => e.stopPropagation()}
                className="w-full text-left px-3 py-2.5 rounded-lg text-sm text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)] transition-colors flex items-center gap-2"
              >
                <Music size={14} className="opacity-50 shrink-0" />
                文字生音乐
              </button>
            </div>
          </div>
        )}

        {/* 有内容但不在编辑: 显示内容预览 */}
        {hasContent && !editing && (
          <div className="w-full h-full flex items-center justify-center px-6 py-8 cursor-text" style={{ minHeight: DEFAULT_HEIGHT }}>
            <p className="text-sm text-[var(--text-secondary)] opacity-50 text-center">
              {displayContent.length > 100 ? displayContent.slice(0, 100) + '...' : displayContent || '双击开始编辑...'}
            </p>
          </div>
        )}

        {/* 编辑模式 */}
        {editing && (
          <>
            {/* 格式工具栏 (TapNow 图4: 上方胶囊) */}
            <div
              className="absolute left-1/2 z-[1001] w-fit h-10 p-1 rounded-full flex items-center gap-0.5 whitespace-nowrap"
              style={{ top: -56, transform: 'translateX(-50%)', backgroundColor: 'rgba(20,20,20,0.88)', backdropFilter: 'blur(16px)', border: '1px solid rgba(255,255,255,0.08)' }}
              onPointerDown={e => e.stopPropagation()}
            >
              <ToolbarBtn title="段落"><Pilcrow size={14} /></ToolbarBtn>
              <ToolbarBtn title="H1"><Heading1 size={14} /></ToolbarBtn>
              <ToolbarBtn title="H2"><Heading2 size={14} /></ToolbarBtn>
              <ToolbarBtn title="H3"><Heading3 size={14} /></ToolbarBtn>
              <div className="w-px h-5 bg-white/10 mx-0.5" />
              <ToolbarBtn title="加粗"><Bold size={14} /></ToolbarBtn>
              <ToolbarBtn title="斜体"><Italic size={14} /></ToolbarBtn>
              <ToolbarBtn title="无序列表"><List size={14} /></ToolbarBtn>
              <ToolbarBtn title="有序列表"><ListOrdered size={14} /></ToolbarBtn>
              <ToolbarBtn title="分隔线"><Minus size={14} /></ToolbarBtn>
              <div className="w-px h-5 bg-white/10 mx-0.5" />
              <ToolbarBtn title="复制"><Copy size={14} /></ToolbarBtn>
              <ToolbarBtn title="全屏"><Maximize2 size={14} /></ToolbarBtn>
            </div>

            <div className="w-full p-4" style={{ minHeight: DEFAULT_HEIGHT }}>
              <textarea
                ref={textareaRef}
                value={displayContent}
                onChange={(e) => {
                  const val = e.target.value
                  contentRef.current = val
                  setDisplayContent(val)
                }}
                onBlur={() => { syncToStore(); setEditing(false) }}
                onMouseDown={e => e.stopPropagation()}
                onWheel={e => e.stopPropagation()}
                onKeyDown={e => { if (e.key === 'Escape') { syncToStore(); setEditing(false) } }}
                className="nodrag nowheel w-full h-full bg-transparent resize-none outline-none text-sm text-[var(--text-primary)] placeholder:text-[var(--text-secondary)] placeholder:opacity-40 select-text"
                placeholder="双击开始编辑..."
                style={{ minHeight: DEFAULT_HEIGHT - 32, userSelect: 'text', WebkitUserSelect: 'text' }}
              />
            </div>
          </>
        )}

        {/* ⊕ Handle */}
        <TapNodeHandle type="target" position={Position.Left} id="left" />
        <TapNodeHandle type="source" position={Position.Right} id="right" />
      </div>
    </div>
  )
})

function ToolbarBtn({ title, children, active, onClick }: { title: string; children: React.ReactNode; active?: boolean; onClick?: () => void }) {
  return (
    <button
      className={`h-8 w-8 rounded-full flex items-center justify-center transition-colors ${active ? 'bg-white/20 text-white' : 'text-white/60 hover:text-white hover:bg-white/10'}`}
      title={title}
      onClick={onClick}
      onPointerDown={e => e.stopPropagation()}
    >
      {children}
    </button>
  )
}
