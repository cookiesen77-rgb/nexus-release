/**
 * ImageNodeFlow - React Flow 版本的图片节点
 * 显示生成的图片或上传的参考图
 * 参考 Vue 版本 ImageNode.vue 实现侧边功能
 * 
 * 性能优化：使用 IntersectionObserver 实现懒加载
 */
import React, { memo, useState, useCallback, useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { Handle, Position, NodeProps } from '@xyflow/react'
import { Trash2, Download, Expand, Loader2, Copy, ImageIcon, Crop, Eye, Video, RefreshCw, Upload } from 'lucide-react'
import { useGraphStore } from '@/graph/store'
import { getMedia, getMediaByNodeId, saveMedia } from '@/lib/mediaStorage'
import { downloadFile } from '@/lib/download'
import { cacheMedia } from '@/lib/workflow/cache'
import { DEFAULT_IMAGE_MODEL, DEFAULT_VIDEO_MODEL, IMAGE_MODELS, VIDEO_MODELS } from '@/config/models'
import { useInView } from '@/hooks/useInView'
import ImageCropModal from '@/components/canvas/ImageCropModal'
import MediaPreviewModal from '@/components/canvas/MediaPreviewModal'
import ImageEditToolbar from '@/components/canvas/ImageEditToolbar'
import { TapNodeHandle } from './shared/TapNodeHandle'

// 检测 Tauri 环境
const isTauri = typeof window !== 'undefined' && !!(window as any).__TAURI_INTERNALS__

interface ImageNodeData {
  label?: string
  url?: string
  sourceUrl?: string  // 原始 HTTPS URL（用于下载和恢复）
  mediaId?: string    // IndexedDB 媒体 ID（用于恢复大型数据）
  loading?: boolean
  error?: string
}

export const ImageNodeComponent = memo(function ImageNode({ id, data, selected }: NodeProps) {
  const nodeData = data as ImageNodeData
  const [showActions, setShowActions] = useState(false)
  const [editToolbarBusy, setEditToolbarBusy] = useState(false)
  const [editToolbarHover, setEditToolbarHover] = useState(false)
  const hideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const toolbarHoverRef = useRef(false)
  const [cropModalOpen, setCropModalOpen] = useState(false)
  const [previewModalOpen, setPreviewModalOpen] = useState(false)
  const [imgHeight, setImgHeight] = useState(250)
  const persistAttemptedRef = React.useRef<string>('')
  const loadErrorFallbackRef = React.useRef<string>('')
  
  // 计算此图片作为参考图/首帧/尾帧的角色标签
  const [roleTag, setRoleTag] = useState<string | null>(null)
  const [roleEdgeId, setRoleEdgeId] = useState<string | null>(null)
  const [roleType, setRoleType] = useState<'video' | 'image' | null>(null)

  const computeRole = useCallback(() => {
    const state = useGraphStore.getState()
    const outgoingEdges = state.edges.filter(e => e.source === id)
    for (const edge of outgoingEdges) {
      const targetNode = state.nodes.find(n => n.id === edge.target)
      if (!targetNode) continue
      if (targetNode.type === 'videoConfig') {
        const role = String((edge.data as any)?.imageRole || '').trim()
        const tag = role === 'first_frame_image' ? '首帧' : role === 'last_frame_image' ? '尾帧' : role === 'input_reference' ? '参考图' : null
        if (tag) return { tag, edgeId: edge.id, type: 'video' as const }
      }
      if (targetNode.type === 'imageConfig') {
        const configEdges = state.edges.filter(e => e.target === targetNode.id && state.nodes.find(n => n.id === e.source)?.type === 'image')
        if (configEdges.length > 1) {
          const myEdge = configEdges.find(e => e.source === id)
          const order = Number((myEdge?.data as any)?.imageOrder) || (configEdges.findIndex(e => e.source === id) + 1)
          return { tag: `参考图${order}`, edgeId: myEdge?.id || null, type: 'image' as const }
        }
      }
    }
    return { tag: null, edgeId: null, type: null }
  }, [id])

  useEffect(() => {
    const r = computeRole()
    setRoleTag(r.tag); setRoleEdgeId(r.edgeId); setRoleType(r.type)
    const unsubscribe = useGraphStore.subscribe((state, prevState) => {
      if (state.edges !== prevState.edges) {
        const r = computeRole()
        setRoleTag(r.tag); setRoleEdgeId(r.edgeId); setRoleType(r.type)
      }
    })
    return unsubscribe
  }, [computeRole])
  
  // 懒加载：只有节点进入可视区域时才加载图片
  const { ref: inViewRef, inView } = useInView({
    rootMargin: '200px', // 提前 200px 开始加载
    triggerOnce: true,   // 一旦加载过就不再卸载
  })

  // 如果没有 url，尝试从 IndexedDB 或 sourceUrl 恢复
  // 优先级：1. IndexedDB (mediaId) 2. sourceUrl (HTTPS URL)
  // 使用 ref 防止重复尝试
  const loadAttemptedRef = React.useRef(false)

  useEffect(() => {
    const currentUrl = String(nodeData?.url || '').trim()
    // blob: URLs are not persistent across reloads — treat as empty
    const urlIsUsable = currentUrl && !currentUrl.startsWith('blob:')

    if (urlIsUsable || nodeData?.loading || nodeData?.error) {
      return
    }

    if (!nodeData?.mediaId && !nodeData?.sourceUrl) {
      return
    }

    if (loadAttemptedRef.current) {
      return
    }

    loadAttemptedRef.current = true
    
    const loadMedia = async () => {
      try {
        // 1. 首先尝试通过 mediaId 从 IndexedDB 加载
        if (nodeData?.mediaId) {
          console.log('[ImageNode] 从 IndexedDB 加载图片, mediaId:', nodeData.mediaId)
          const record = await getMedia(nodeData.mediaId)
          if (record?.data) {
            useGraphStore.getState().updateNode(id, {
              data: { url: record.data, loading: false }
            } as any)
            return
          }
        }
        
        // 2. 尝试通过 nodeId 从 IndexedDB 查找
        console.log('[ImageNode] 通过 nodeId 从 IndexedDB 查找:', id)
        const recordByNode = await getMediaByNodeId(id)
        if (recordByNode?.data) {
          useGraphStore.getState().updateNode(id, {
            data: { 
              url: recordByNode.data, 
              mediaId: recordByNode.id,
              loading: false 
            }
          } as any)
          return
        }
        
        // 3. 如果有 sourceUrl（HTTPS URL），直接使用
        if (nodeData?.sourceUrl && nodeData.sourceUrl.startsWith('http')) {
          console.log('[ImageNode] 使用 sourceUrl:', nodeData.sourceUrl.slice(0, 50))
          useGraphStore.getState().updateNode(id, {
            data: { url: nodeData.sourceUrl, loading: false }
          } as any)
          return
        }
        
        console.log('[ImageNode] 无法恢复图片数据，节点需要重新生成')
      } catch (err) {
        console.error('[ImageNode] 加载媒体失败:', err)
      }
    }
    
    loadMedia()
  }, [id, nodeData?.url, nodeData?.mediaId, nodeData?.sourceUrl, nodeData?.loading, nodeData?.error])

  // 当 sourceUrl 变化时，允许重新触发一次“直链失败 -> 缓存兜底”
  useEffect(() => {
    loadErrorFallbackRef.current = ''
  }, [nodeData?.sourceUrl])

  // 若当前 url 为 dataURL/纯 base64 且尚未落库，则写入 IndexedDB 并写回 mediaId（跨重启）
  useEffect(() => {
    const url = String(nodeData?.url || '').trim()
    if (!url) return
    if (nodeData?.mediaId) return
    if (persistAttemptedRef.current === url) return

    const isHttp = /^https?:\/\//i.test(url)
    const isDataUrl = url.startsWith('data:')
    const isBase64Like = !isHttp && url.length > 50000
    if (!isDataUrl && !isBase64Like) return

    persistAttemptedRef.current = url

    const persist = async () => {
      try {
        const store = useGraphStore.getState()
        const projectId = store.projectId || 'default'
        const mediaId = await saveMedia({
          nodeId: id,
          projectId,
          type: 'image',
          data: url,
          sourceUrl: typeof nodeData?.sourceUrl === 'string' && /^https?:\/\//i.test(nodeData.sourceUrl) ? nodeData.sourceUrl : undefined,
          model: typeof (nodeData as any)?.model === 'string' ? (nodeData as any).model : undefined,
        })
        if (mediaId) {
          store.patchNodeDataSilent(id, { mediaId })
        }
      } catch {
        // ignore
      }
    }
    void persist()
  }, [id, nodeData?.url, nodeData?.mediaId, nodeData?.sourceUrl])

  const handleDelete = useCallback((e: React.MouseEvent) => {
    e.stopPropagation()
    useGraphStore.getState().removeNode(id)
  }, [id])

  const handleDuplicate = useCallback((e: React.MouseEvent) => {
    e.stopPropagation()
    const store = useGraphStore.getState()
    const node = store.nodes.find((n) => n.id === id)
    if (node) {
      store.addNode('image', { x: node.x + 50, y: node.y + 50 }, { ...node.data })
    }
  }, [id])

  const handleDownload = useCallback(async (e?: React.MouseEvent) => {
    e?.stopPropagation()
    if (!nodeData?.url) {
      window.$message?.warning?.('暂无图片可下载')
      return
    }
    
    // 优先使用 sourceUrl（原始 HTTPS URL），避免 asset:// URL 在 Windows 上的问题
    const downloadUrl = (nodeData?.sourceUrl && nodeData.sourceUrl.startsWith('http')) 
      ? nodeData.sourceUrl 
      : nodeData.url
    
    console.log('[ImageNode] 下载图片, URL类型:', 
      downloadUrl.startsWith('data:') ? 'data:' : 
      downloadUrl.startsWith('asset:') ? 'asset:' : 
      downloadUrl.startsWith('http') ? 'http' : 'unknown'
    )
    
    try {
      const success = await downloadFile({
        url: downloadUrl,
        filename: `${(nodeData?.label || '图片').replace(/[/\\:*?"<>|]/g, '_')}_${Date.now()}.png`,
        mimeType: 'image/png'
      })
      if (success) {
        window.$message?.success?.('下载成功')
      }
    } catch (err: any) {
      console.error('[ImageNode] 下载失败:', err)
      window.$message?.error?.(`下载失败: ${err?.message || '未知错误'}`)
    }
  }, [id, nodeData?.url])

  // TapNow: 图生图 — 创建 Image→ImageConfig 连接
  const handleImageGen = useCallback((e: React.MouseEvent) => {
    e.stopPropagation()
    const store = useGraphStore.getState()
    const node = store.nodes.find((n) => n.id === id)
    if (node) {
      store.patchNodeDataSilent(id, { _fromWorkflow: true })
      const newId = store.addNode('imageConfig', { x: node.x + 350, y: node.y }, { label: '图片生成', _awaitingGeneration: true })
      store.addEdge(id, newId, { sourceHandle: 'right', targetHandle: 'left' })
      store.setSelected(newId)
    }
  }, [id])

  // 裁剪功能
  const handleCrop = useCallback((e?: React.MouseEvent) => {
    e?.stopPropagation()
    if (!nodeData?.url) {
      window.$message?.warning?.('暂无图片可裁剪')
      return
    }
    setCropModalOpen(true)
  }, [nodeData?.url])

  // 裁剪完成回调
  const handleCropComplete = useCallback((croppedDataUrl: string) => {
    // 创建新的图片节点，保留原图
    const store = useGraphStore.getState()
    const node = store.nodes.find((n) => n.id === id)
    if (node) {
      store.addNode('image', { x: node.x + 50, y: node.y + 50 }, {
        label: '裁剪图',
        url: croppedDataUrl
      })
      window.$message?.success?.('裁剪完成，已创建新节点')
    }
  }, [id])

  // 预览功能 - 在应用内模态框中显示
  // 优先使用 sourceUrl（原始 HTTPS URL），避免 Windows 上的渲染问题
  const previewUrl = (nodeData?.sourceUrl && nodeData.sourceUrl.startsWith('http')) 
    ? nodeData.sourceUrl 
    : nodeData?.url
  
  const handlePreview = useCallback((e?: React.MouseEvent) => {
    e?.stopPropagation()
    if (!nodeData?.url) {
      window.$message?.warning?.('暂无图片可预览')
      return
    }
    setPreviewModalOpen(true)
  }, [nodeData?.url])

  // TapNow: 图生视频 — 创建 Image→VideoConfig 连接
  const handleVideoGen = useCallback((e: React.MouseEvent) => {
    e.stopPropagation()
    const store = useGraphStore.getState()
    const node = store.nodes.find((n) => n.id === id)
    if (node) {
      store.patchNodeDataSilent(id, { _fromWorkflow: true })
      const videoId = store.addNode('videoConfig', { x: node.x + 350, y: node.y }, { label: '视频生成', _awaitingGeneration: true })
      store.addEdge(id, videoId, { sourceHandle: 'right', targetHandle: 'left' })
      store.setSelected(videoId)
    }
  }, [id])

  // 首帧图生视频: 搭建 Image→VideoConfig 工作流, edge标记first_frame角色
  const handleFirstFrameVideo = useCallback((e: React.MouseEvent) => {
    e.stopPropagation()
    const store = useGraphStore.getState()
    const node = store.nodes.find((n) => n.id === id)
    if (node) {
      store.patchNodeDataSilent(id, { _fromWorkflow: true })
      const videoId = store.addNode('videoConfig', { x: node.x + 350, y: node.y }, { label: '视频生成', _awaitingGeneration: true })
      store.addEdge(id, videoId, { sourceHandle: 'right', targetHandle: 'left', imageRole: 'first_frame_image' })
      store.setSelected(videoId)
    }
  }, [id])

  // 替换图片功能
  const replaceInputRef = useRef<HTMLInputElement>(null)

  const handleReplaceClick = useCallback(async (e?: React.MouseEvent) => {
    e?.stopPropagation()
    
    if (isTauri) {
      // Tauri 环境：使用 dialog API
      try {
        const { open } = await import('@tauri-apps/plugin-dialog')
        const { readFile } = await import('@tauri-apps/plugin-fs')
        
        const result = await open({
          multiple: false,
          filters: [{ name: '图片文件', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'svg'] }],
          title: '选择图片'
        })
        
        if (result && typeof result === 'string') {
          const fileData = await readFile(result)
          const fileName = result.split('/').pop() || result.split('\\').pop() || 'image'
          const ext = fileName.split('.').pop()?.toLowerCase() || 'png'
          const mimeMap: Record<string, string> = { 
            png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', 
            gif: 'image/gif', webp: 'image/webp', bmp: 'image/bmp', svg: 'image/svg+xml' 
          }
          const mimeType = mimeMap[ext] || 'image/png'
          
          const blob = new Blob([fileData], { type: mimeType })
          const dataUrl = await new Promise<string>((resolve) => {
            const reader = new FileReader()
            reader.onload = () => resolve(reader.result as string)
            reader.readAsDataURL(blob)
          })
          
          const store = useGraphStore.getState()
          const projectId = store.projectId || 'default'
          
          store.updateNode(id, {
            data: {
              url: dataUrl,
              sourceUrl: '',
              mediaId: undefined,
              label: fileName || nodeData?.label || '图片',
              loading: false,
            }
          })
          
          // 保存到 IndexedDB
          try {
            const mediaId = await saveMedia({
              nodeId: id,
              projectId,
              type: 'image',
              data: dataUrl,
            })
            if (mediaId) {
              store.patchNodeDataSilent(id, { mediaId })
            }
          } catch {
            // ignore
          }
          
          window.$message?.success?.('图片已替换')
        }
      } catch {
        // ignore
      }
    } else {
      // Web 环境：使用原生 file input
      replaceInputRef.current?.click()
    }
  }, [id, nodeData?.label])

  const handleReplaceFile = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    // 读取文件为 DataURL
    const reader = new FileReader()
    reader.onload = async (event) => {
      const dataUrl = event.target?.result as string
      if (!dataUrl) return

      const store = useGraphStore.getState()
      const projectId = store.projectId || 'default'

      // 更新节点 URL
      store.updateNode(id, {
        data: {
          url: dataUrl,
          sourceUrl: '',
          mediaId: undefined,
          label: file.name || nodeData?.label || '图片',
          loading: false,
          error: undefined
        }
      } as any)

      // 异步保存到 IndexedDB
      try {
        const mediaId = await saveMedia({
          nodeId: id,
          projectId,
          type: 'image',
          data: dataUrl,
        })
        if (mediaId) {
          store.patchNodeDataSilent(id, { mediaId })
        }
      } catch {
        // ignore
      }

      window.$message?.success?.('图片已替换')
    }
    reader.readAsDataURL(file)

    // 清理 input
    e.target.value = ''
  }, [id, nodeData?.label])

  const cancelHide = useCallback(() => {
    if (hideTimerRef.current) { clearTimeout(hideTimerRef.current); hideTimerRef.current = null }
  }, [])

  const scheduleHide = useCallback(() => {
    cancelHide()
    hideTimerRef.current = setTimeout(() => {
      if (!toolbarHoverRef.current && !editToolbarBusy) setShowActions(false)
    }, 200)
  }, [cancelHide, editToolbarBusy])

  const handleToolbarHoverChange = useCallback((hovering: boolean) => {
    toolbarHoverRef.current = hovering
    setEditToolbarHover(hovering)
    if (hovering) { cancelHide(); setShowActions(true) }
    else scheduleHide()
  }, [cancelHide, scheduleHide])

  useEffect(() => () => { if (hideTimerRef.current) clearTimeout(hideTimerRef.current) }, [])

  return (
    <div
      ref={inViewRef}
      className="relative"
      onMouseEnter={() => { cancelHide(); setShowActions(true) }}
      onMouseLeave={scheduleHide}
    >
      {/* TapNow: 节点主体 */}
      <div
        className="group relative overflow-visible rounded-2xl bg-[var(--bg-secondary)]"
        style={{ width: '100%', minWidth: 250, height: imgHeight, minHeight: 120 }}
      >
        {/* TapNow: 标签浮在节点上方，可双击编辑 */}
        <div
          className="absolute -translate-y-full text-left left-0 -top-0 pb-2 w-full text-[var(--text-secondary)] overflow-hidden text-ellipsis whitespace-nowrap"
          style={{ fontSize: '17.1429px' }}
          onDoubleClick={(e) => {
            e.stopPropagation()
            const current = nodeData?.label || '图片'
            const next = window.prompt('修改备注', current)
            if (next !== null && next.trim() && next.trim() !== current) {
              useGraphStore.getState().updateNode(id, { data: { label: next.trim() } } as any)
            }
          }}
          title="双击编辑备注"
        >
          {nodeData?.label || '图片'}
          {roleTag && (
            <span
              className={`ml-1.5 px-1.5 py-0.5 text-[10px] font-bold text-white rounded cursor-pointer hover:opacity-80 ${roleTag === '首帧' ? 'bg-emerald-500' : roleTag === '尾帧' ? 'bg-orange-500' : 'bg-blue-500'}`}
              onClick={(e) => {
                e.stopPropagation()
                if (!roleEdgeId) return
                const store = useGraphStore.getState()
                if (roleType === 'image') {
                  const input = window.prompt('修改参考图编号', String(roleTag.replace(/\D/g, '') || '1'))
                  const num = Number(input)
                  if (input !== null && Number.isFinite(num) && num > 0) {
                    store.updateEdge(roleEdgeId, { data: { imageOrder: num } })
                  }
                } else if (roleType === 'video') {
                  const roles = ['first_frame_image', 'last_frame_image', 'input_reference']
                  const labels = ['首帧', '尾帧', '参考图']
                  const currentIdx = labels.indexOf(roleTag)
                  const nextIdx = (currentIdx + 1) % roles.length
                  store.updateEdge(roleEdgeId, { data: { imageRole: roles[nextIdx] } })
                }
              }}
              title={roleType === 'image' ? '点击修改编号' : '点击切换角色'}
            >
              {roleTag}
            </span>
          )}
        </div>

        {/* TapNow: 内容区 edge-to-edge */}
        <div className="absolute inset-0 w-full h-full overflow-visible">
          {!inView && !nodeData?.url && !nodeData?.loading ? (
            <div className="w-full h-full flex flex-col items-center justify-center gap-2 text-[var(--text-secondary)] rounded-2xl bg-[var(--bg-tertiary)]">
              <ImageIcon size={32} className="opacity-20" />
            </div>
          ) : nodeData?.loading ? (
            <div className="w-full h-full flex flex-col items-center justify-center gap-3 rounded-2xl bg-[var(--bg-tertiary)]">
              <Loader2 size={28} className="animate-spin text-[var(--text-secondary)]" />
              <span className="text-xs text-[var(--text-secondary)]">生成中...</span>
            </div>
          ) : nodeData?.error ? (
            <div className="w-full h-full flex flex-col items-center justify-center gap-2 text-red-500 rounded-2xl bg-[var(--bg-tertiary)]">
              <span className="text-xl">⚠</span>
              <span className="text-xs text-center px-4 line-clamp-2">{nodeData.error}</span>
            </div>
          ) : (data as any)?._fromWorkflow && !nodeData?.url ? (
            <div
              className="w-full h-full flex flex-col items-center justify-center gap-3 rounded-2xl bg-[var(--bg-tertiary)] cursor-pointer hover:bg-[var(--bg-tertiary)]/80 transition-colors"
              onClick={handleReplaceClick}
              onPointerDown={e => e.stopPropagation()}
            >
              <Upload size={28} className="text-[var(--text-secondary)] opacity-30" />
              <span className="text-xs text-[var(--text-secondary)] opacity-40">点击上传图片</span>
            </div>
          ) : nodeData?.url ? (
            <>
              <img
                src={nodeData.url}
                alt={nodeData.label || '图片'}
                className="w-full h-full object-cover rounded-2xl"
                draggable={false}
                loading="lazy"
                onLoad={(e) => {
                  const img = e.currentTarget
                  if (img.naturalWidth > 0 && img.naturalHeight > 0) {
                    setImgHeight(Math.round(250 * (img.naturalHeight / img.naturalWidth)))
                  }
                }}
                onError={() => {
                  try {
                    const store = useGraphStore.getState()
                    const cur = store.nodes.find((n) => n.id === id)
                    const curUrl = String((cur?.data as any)?.url || '').trim()
                    const sourceUrl = String((cur?.data as any)?.sourceUrl || '').trim()
                    if (isTauri && sourceUrl && /^https?:\/\//i.test(sourceUrl) && loadErrorFallbackRef.current !== sourceUrl) {
                      loadErrorFallbackRef.current = sourceUrl
                      void (async () => {
                        try {
                          const cached = await cacheMedia(sourceUrl, 'general', { forceRefresh: true })
                          const nextUrl = String(cached.displayUrl || '').trim()
                          if (nextUrl && nextUrl !== curUrl) {
                            useGraphStore.getState().updateNode(id, { data: { url: nextUrl, localPath: cached.localPath, error: '' } } as any)
                            return
                          }
                        } catch {}
                        useGraphStore.getState().updateNode(id, { data: { loading: false, error: '图片加载失败' } } as any)
                      })()
                      return
                    }
                    store.updateNode(id, { data: { loading: false, error: '图片加载失败' } } as any)
                  } catch {}
                }}
              />
              {/* TapNow: 上传按钮 (右上角) */}
              <button
                onClick={handleReplaceClick}
                onPointerDown={e => e.stopPropagation()}
                className="flex items-center gap-1.5 text-white bg-[var(--bg-secondary)]/70 cursor-pointer border border-[var(--border-color)]/50 absolute top-2 right-2 z-5 px-3 py-1.5 rounded-md text-xs font-medium shadow-sm hover:bg-[var(--bg-secondary)]/90 transition-colors"
              >
                <Upload size={14} />上传
              </button>
            </>
          ) : (
            <div className="w-full h-full flex flex-col justify-center gap-2 px-6 py-8">
              <span className="text-xs text-[var(--text-secondary)] opacity-50 ml-2">尝试：</span>
              <div className="w-full space-y-1">
                <button onClick={handleImageGen} onPointerDown={e => e.stopPropagation()} className="w-full text-left px-3 py-2.5 rounded-2xl text-sm text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)] transition-colors flex items-center gap-2">
                  <Upload size={14} className="shrink-0 opacity-50" />
                  图生图
                </button>
                <button onClick={handleVideoGen} onPointerDown={e => e.stopPropagation()} className="w-full text-left px-3 py-2.5 rounded-2xl text-sm text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)] transition-colors flex items-center gap-2">
                  <Upload size={14} className="shrink-0 opacity-50" />
                  图生视频
                </button>
                <button onClick={handleReplaceClick} onPointerDown={e => e.stopPropagation()} className="w-full text-left px-3 py-2.5 rounded-2xl text-sm text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)] transition-colors flex items-center gap-2">
                  <ImageIcon size={14} className="shrink-0 opacity-50" />
                  图片换背景
                </button>
                <button onClick={handleFirstFrameVideo} onPointerDown={e => e.stopPropagation()} className="w-full text-left px-3 py-2.5 rounded-2xl text-sm text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)] transition-colors flex items-center gap-2">
                  <Video size={14} className="shrink-0 opacity-50" />
                  首帧图生视频
                </button>
              </div>
            </div>
          )}
        </div>

        {/* TapNow: ⊕ Handle */}
        <TapNodeHandle type="target" position={Position.Left} id="left" />
        <TapNodeHandle type="source" position={Position.Right} id="right" />
      </div>

      {/* 悬浮编辑工具栏 (TapNow 风格, 浮在节点上方) */}
      {nodeData?.url && (
        <ImageEditToolbar
          nodeId={id}
          imageUrl={nodeData.url}
          visible={showActions || editToolbarBusy || editToolbarHover}
          onBusyChange={setEditToolbarBusy}
          onHoverChange={handleToolbarHoverChange}
          onReplace={() => handleReplaceClick()}
          onCrop={() => handleCrop()}
          onDownload={() => handleDownload()}
          onPreview={() => handlePreview()}
        />
      )}

      <input ref={replaceInputRef} type="file" accept="image/*" className="hidden" onChange={handleReplaceFile} />

      {cropModalOpen && nodeData?.url && createPortal(
        <ImageCropModal
          open={cropModalOpen}
          imageUrl={nodeData.url}
          onClose={() => setCropModalOpen(false)}
          onCrop={handleCropComplete}
        />,
        document.body
      )}

      {previewModalOpen && previewUrl && createPortal(
        <MediaPreviewModal
          open={previewModalOpen}
          url={previewUrl}
          type="image"
          onClose={() => setPreviewModalOpen(false)}
        />,
        document.body
      )}
    </div>
  )
})
