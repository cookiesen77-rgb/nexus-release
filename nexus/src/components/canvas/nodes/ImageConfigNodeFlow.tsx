/**
 * ImageConfigNodeFlow - TapNow 风格图片生成节点
 *
 * 和 Image 节点外观一致的纯内容卡片，但自带生成能力：
 * 空节点 → 显示"尝试"菜单 → 选中后底部面板配置+生成 → 结果写入自身
 */
import React, { memo, useState, useCallback, useRef, useEffect } from 'react'
import { Position, NodeProps } from '@xyflow/react'
import { Loader2, ImageIcon, Upload, Video } from 'lucide-react'
import { useGraphStore } from '@/graph/store'
import { saveMedia, getMedia, getMediaByNodeId } from '@/lib/mediaStorage'
import { TapNodeHandle } from './shared/TapNodeHandle'
import ImageEditToolbar from '@/components/canvas/ImageEditToolbar'

const isTauri = typeof window !== 'undefined' && !!(window as any).__TAURI_INTERNALS__

interface ConfigData {
  label?: string
  url?: string
  sourceUrl?: string
  mediaId?: string
  loading?: boolean
  error?: string
  _fromWorkflow?: boolean
}

export const ImageConfigNodeComponent = memo(function ImageConfigNode({ id, data, selected }: NodeProps) {
  const nodeData = data as ConfigData
  const [showActions, setShowActions] = useState(false)
  const [editToolbarBusy, setEditToolbarBusy] = useState(false)
  const [editToolbarHover, setEditToolbarHover] = useState(false)
  const replaceInputRef = useRef<HTMLInputElement>(null)
  const loadAttemptedRef = useRef(false)
  const persistAttemptedRef = useRef<string>('')

  // 检查是否有上游图片连接
  const hasUpstreamImage = useGraphStore(s => s.edges.some(e => e.target === id && s.nodes.find(n => n.id === e.source)?.type === 'image'))

  // Local mode state — 即时切换 UI（不依赖 React Flow data prop 同步）
  // 'menu' = 显示"尝试"菜单, 'upload' = 可上传参考图, 'awaiting' = 待生成
  const [mode, setMode] = useState<'menu' | 'upload' | 'awaiting'>(() => {
    if ((nodeData as any)?._awaitingGeneration) return 'awaiting'
    if (nodeData?._fromWorkflow) return 'upload'
    if (nodeData?.url) return 'upload'
    return 'menu'
  })

  // 有上游图片连接时自动切换到待生成模式
  useEffect(() => {
    if (hasUpstreamImage && mode === 'menu') setMode('awaiting')
  }, [hasUpstreamImage, mode])

  const hasUrl = !!nodeData?.url

  // 从 IndexedDB 恢复
  useEffect(() => {
    const currentUrl = String(nodeData?.url || '').trim()
    if (currentUrl && !currentUrl.startsWith('blob:')) return
    if (nodeData?.loading) return
    if (!nodeData?.mediaId && !nodeData?.sourceUrl) return
    if (loadAttemptedRef.current) return
    loadAttemptedRef.current = true
    void (async () => {
      try {
        if (nodeData?.mediaId) {
          const record = await getMedia(nodeData.mediaId)
          if (record?.data) { useGraphStore.getState().updateNode(id, { data: { url: record.data, loading: false } } as any); return }
        }
        const recordByNode = await getMediaByNodeId(id)
        if (recordByNode?.data) { useGraphStore.getState().updateNode(id, { data: { url: recordByNode.data, mediaId: recordByNode.id, loading: false } } as any); return }
        if (nodeData?.sourceUrl && /^https?:\/\//i.test(nodeData.sourceUrl)) {
          useGraphStore.getState().updateNode(id, { data: { url: nodeData.sourceUrl, loading: false } } as any)
        }
      } catch {}
    })()
  }, [id, nodeData?.url, nodeData?.mediaId, nodeData?.sourceUrl, nodeData?.loading])

  // 持久化 data URL 到 IndexedDB
  useEffect(() => {
    const url = String(nodeData?.url || '').trim()
    if (!url || nodeData?.mediaId || persistAttemptedRef.current === url) return
    const isDataUrl = url.startsWith('data:')
    const isBase64Like = !/^https?:\/\//i.test(url) && url.length > 50000
    if (!isDataUrl && !isBase64Like) return
    persistAttemptedRef.current = url
    void (async () => {
      try {
        const store = useGraphStore.getState()
        const mediaId = await saveMedia({ nodeId: id, projectId: store.projectId || 'default', type: 'image', data: url })
        if (mediaId) store.patchNodeDataSilent(id, { mediaId })
      } catch {}
    })()
  }, [id, nodeData?.url, nodeData?.mediaId])

  // "尝试" handlers — 原节点变上传，下游创建待生成节点
  const handleImageGen = useCallback((e: React.MouseEvent) => {
    e.stopPropagation()
    const store = useGraphStore.getState()
    const node = store.nodes.find(n => n.id === id)
    if (!node) return
    setMode('upload')
    store.patchNodeDataSilent(id, { _fromWorkflow: true })
    const newId = store.addNode('imageConfig', { x: node.x + 350, y: node.y }, { label: '图片生成', _awaitingGeneration: true })
    store.addEdge(id, newId, { sourceHandle: 'right', targetHandle: 'left' })
  }, [id])

  const handleVideoGen = useCallback((e: React.MouseEvent) => {
    e.stopPropagation()
    const store = useGraphStore.getState()
    const node = store.nodes.find(n => n.id === id)
    if (!node) return
    setMode('upload')
    store.patchNodeDataSilent(id, { _fromWorkflow: true })
    const videoId = store.addNode('videoConfig', { x: node.x + 350, y: node.y }, { label: '视频生成', _awaitingGeneration: true })
    store.addEdge(id, videoId, { sourceHandle: 'right', targetHandle: 'left' })
  }, [id])

  const handleFirstFrameVideo = useCallback((e: React.MouseEvent) => {
    e.stopPropagation()
    const store = useGraphStore.getState()
    const node = store.nodes.find(n => n.id === id)
    if (!node) return
    setMode('upload')
    store.patchNodeDataSilent(id, { _fromWorkflow: true })
    const videoId = store.addNode('videoConfig', { x: node.x + 350, y: node.y }, { label: '视频生成', _awaitingGeneration: true })
    store.addEdge(id, videoId, { sourceHandle: 'right', targetHandle: 'left', data: { imageRole: 'first_frame_image' } })
  }, [id])

  const handleReplaceClick = useCallback(async (e: React.MouseEvent) => {
    e.stopPropagation()
    if (isTauri) {
      try {
        const { open } = await import('@tauri-apps/plugin-dialog')
        const { readFile } = await import('@tauri-apps/plugin-fs')
        const result = await open({ multiple: false, filters: [{ name: '图片', extensions: ['png','jpg','jpeg','gif','webp','bmp'] }] })
        if (result && typeof result === 'string') {
          const fileData = await readFile(result)
          const ext = (result.split('.').pop() || 'png').toLowerCase()
          const mime: Record<string,string> = { png:'image/png',jpg:'image/jpeg',jpeg:'image/jpeg',gif:'image/gif',webp:'image/webp',bmp:'image/bmp' }
          const blob = new Blob([fileData], { type: mime[ext] || 'image/png' })
          const dataUrl = await new Promise<string>(r => { const rd = new FileReader(); rd.onload = () => r(rd.result as string); rd.readAsDataURL(blob) })
          useGraphStore.getState().updateNode(id, { data: { url: dataUrl, sourceUrl: '', mediaId: undefined, loading: false } })
        }
      } catch {}
    } else {
      replaceInputRef.current?.click()
    }
  }, [id])

  const handleReplaceFile = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = (ev) => {
      const dataUrl = ev.target?.result as string
      if (dataUrl) useGraphStore.getState().updateNode(id, { data: { url: dataUrl, sourceUrl: '', mediaId: undefined, loading: false } })
    }
    reader.readAsDataURL(file)
    e.target.value = ''
  }, [id])

  return (
    <div
      className="relative"
      onMouseEnter={() => setShowActions(true)}
      onMouseLeave={() => !editToolbarBusy && !editToolbarHover && setShowActions(false)}
    >
      <div
        className="group relative overflow-visible rounded-2xl bg-[var(--bg-secondary)]"
        style={{ width: 250 }}
      >
        {/* 标签 */}
        <div className="absolute -translate-y-full text-left left-0 -top-0 pb-2 w-full text-[var(--text-secondary)] overflow-hidden text-ellipsis whitespace-nowrap" style={{ fontSize: '17.1429px' }}>
          {nodeData?.label || '图片生成'}
        </div>

        {/* 内容区 */}
        <div className="w-full overflow-visible" style={{ minHeight: hasUrl ? undefined : 250 }}>
          {nodeData?.loading ? (
            <div className="w-full flex flex-col items-center justify-center gap-3 rounded-2xl bg-[var(--bg-tertiary)]" style={{ minHeight: 250 }}>
              <Loader2 size={28} className="animate-spin text-[var(--text-secondary)]" />
              <span className="text-xs text-[var(--text-secondary)]">生成中...</span>
            </div>
          ) : nodeData?.error ? (
            <div className="w-full flex flex-col items-center justify-center gap-2 text-red-500 rounded-2xl bg-[var(--bg-tertiary)]" style={{ minHeight: 250 }}>
              <span className="text-xl">⚠</span>
              <span className="text-xs text-center px-4 line-clamp-2">{nodeData.error}</span>
            </div>
          ) : mode === 'upload' && !hasUrl ? (
            <div
              className="w-full flex flex-col items-center justify-center gap-3 rounded-2xl bg-[var(--bg-tertiary)] cursor-pointer hover:bg-[var(--bg-tertiary)]/80 transition-colors"
              style={{ minHeight: 250 }}
              onClick={handleReplaceClick}
              onPointerDown={e => e.stopPropagation()}
            >
              <Upload size={28} className="text-[var(--text-secondary)] opacity-30" />
              <span className="text-xs text-[var(--text-secondary)] opacity-40">点击上传图片</span>
            </div>
          ) : mode === 'awaiting' && !hasUrl ? (
            <div className="w-full flex flex-col items-center justify-center gap-3 rounded-2xl bg-[var(--bg-tertiary)]" style={{ minHeight: 250 }}>
              <ImageIcon size={28} className="text-[var(--text-secondary)] opacity-20" />
              <span className="text-xs text-[var(--text-secondary)] opacity-30">待生成</span>
            </div>
          ) : hasUrl ? (
            <div className="relative">
              <img
                src={nodeData.url}
                alt={nodeData.label || '图片'}
                className="w-full rounded-2xl"
                draggable={false}
                loading="lazy"
                onError={() => useGraphStore.getState().updateNode(id, { data: { loading: false, error: '图片加载失败' } } as any)}
              />
              <button
                onClick={handleReplaceClick}
                onPointerDown={e => e.stopPropagation()}
                className="flex items-center gap-1.5 text-white bg-[var(--bg-secondary)]/70 cursor-pointer border border-[var(--border-color)]/50 absolute top-2 right-2 z-5 px-3 py-1.5 rounded-md text-xs font-medium shadow-sm hover:bg-[var(--bg-secondary)]/90 transition-colors"
              >
                <Upload size={14} />上传
              </button>
            </div>
          ) : (
            <div className="w-full flex flex-col justify-center gap-2 px-6 py-8" style={{ minHeight: 250 }}>
              <span className="text-xs text-[var(--text-secondary)] opacity-50 ml-2">尝试：</span>
              <div className="w-full space-y-1">
                <button onClick={handleImageGen} onPointerDown={e => e.stopPropagation()} className="w-full text-left px-3 py-2.5 rounded-2xl text-sm text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)] transition-colors flex items-center gap-2">
                  <Upload size={14} className="shrink-0 opacity-50" />图生图
                </button>
                <button onClick={handleVideoGen} onPointerDown={e => e.stopPropagation()} className="w-full text-left px-3 py-2.5 rounded-2xl text-sm text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)] transition-colors flex items-center gap-2">
                  <Upload size={14} className="shrink-0 opacity-50" />图生视频
                </button>
                <button onClick={handleReplaceClick} onPointerDown={e => e.stopPropagation()} className="w-full text-left px-3 py-2.5 rounded-2xl text-sm text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)] transition-colors flex items-center gap-2">
                  <ImageIcon size={14} className="shrink-0 opacity-50" />图片换背景
                </button>
                <button onClick={handleFirstFrameVideo} onPointerDown={e => e.stopPropagation()} className="w-full text-left px-3 py-2.5 rounded-2xl text-sm text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)] transition-colors flex items-center gap-2">
                  <Video size={14} className="shrink-0 opacity-50" />首帧图生视频
                </button>
              </div>
            </div>
          )}
        </div>

        <TapNodeHandle type="target" position={Position.Left} id="left" />
        <TapNodeHandle type="source" position={Position.Right} id="right" />
      </div>

      {/* 悬浮工具栏 */}
      {hasUrl && (
        <ImageEditToolbar
          nodeId={id}
          imageUrl={nodeData.url!}
          visible={showActions || editToolbarBusy || editToolbarHover}
          onBusyChange={setEditToolbarBusy}
          onHoverChange={setEditToolbarHover}
          onReplace={() => handleReplaceClick({} as any)}
          onCrop={() => {}}
          onDownload={() => {}}
          onPreview={() => {}}
        />
      )}

      <input ref={replaceInputRef} type="file" accept="image/*" className="hidden" onChange={handleReplaceFile} />
    </div>
  )
})
