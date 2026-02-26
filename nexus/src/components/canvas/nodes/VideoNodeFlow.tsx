/**
 * VideoNodeFlow - React Flow 版本的视频节点
 * 完全对齐 Vue 版本 VideoNode.vue 实现
 * 
 * 性能优化：使用 IntersectionObserver 实现懒加载
 */
import React, { memo, useState, useCallback, useRef, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { Handle, Position, NodeProps } from '@xyflow/react'
import { Trash2, Copy, Expand, Video, Image, Eye, Download, X, RefreshCw, Loader2 } from 'lucide-react'
import { useGraphStore } from '@/graph/store'
import { saveMedia, getMediaWithFallback, getMediaByNodeIdWithFallback } from '@/lib/mediaStorage'
import { downloadFile } from '@/lib/download'
import { resolveCachedMediaUrl } from '@/lib/workflow/cache'
import { recoverFromLocalPath } from '@/lib/tauriMediaPersist'
import { useInView } from '@/hooks/useInView'
import MediaPreviewModal from '@/components/canvas/MediaPreviewModal'

// URL 工具
const isHttpUrl = (v: string) => /^https?:\/\//i.test(String(v || '').trim())
const isApiRelativeUrl = (v: string) => {
  const u = String(v || '').trim()
  if (!u) return false
  return u.startsWith('/v1/') || u.startsWith('/v1beta') || u.startsWith('/kling') || u.startsWith('/tencent-vod') || u.startsWith('/video')
}
const isRecoverableSourceUrl = (v: string) => isHttpUrl(v) || isApiRelativeUrl(v)

// 检测 Tauri 环境
const isTauri = typeof window !== 'undefined' && !!(window as any).__TAURI_INTERNALS__

interface VideoNodeData {
  label?: string
  url?: string
  sourceUrl?: string  // 原始 URL（用于从 localStorage 恢复）
  mediaId?: string    // IndexedDB 媒体 ID（用于恢复大型数据）
  loading?: boolean
  error?: string
  model?: string
  duration?: number
}

// 格式化时长
const formatDuration = (seconds: number) => {
  if (!seconds || !Number.isFinite(seconds)) return '0:00'
  const mins = Math.floor(seconds / 60)
  const secs = Math.floor(seconds % 60)
  return `${mins}:${secs.toString().padStart(2, '0')}`
}

export const VideoNodeComponent = memo(function VideoNode({ id, data, selected }: NodeProps) {
  const nodeData = data as VideoNodeData
  const [showActions, setShowActions] = useState(false)
  const [videoError, setVideoError] = useState('')
  const [previewModalOpen, setPreviewModalOpen] = useState(false)
  const [corsMode, setCorsMode] = useState<'anonymous' | 'none'>('anonymous')
  const [downloading, setDownloading] = useState(false)
  const videoRef = useRef<HTMLVideoElement>(null)
  const persistAttemptedRef = useRef<string>('')
  const loadErrorFallbackRef = useRef<string>('')
  
  // 懒加载：只有节点进入可视区域时才加载视频
  const { ref: inViewRef, inView } = useInView({
    rootMargin: '200px', // 提前 200px 开始加载
    triggerOnce: true,   // 一旦加载过就不再卸载
  })

  const displayUrl = nodeData?.url || ''

  // URL 变化时：清理错误并重置 CORS 策略（先尝试 anonymous，失败再降级）
  useEffect(() => {
    setVideoError('')
    setCorsMode('anonymous')
    loadErrorFallbackRef.current = ''
  }, [displayUrl])

  // 如果没有 url，尝试从 IndexedDB 或 sourceUrl 恢复
  // 使用 ref 防止重复尝试
  // 性能优化：只有节点在可视区域内时才加载
  const loadAttemptedRef = React.useRef(false)
  
  useEffect(() => {
    if (!inView) {
      return
    }

    const currentUrl = String(nodeData?.url || '').trim()
    const urlIsUsable = currentUrl && !currentUrl.startsWith('blob:') && currentUrl.length > 10

    if (urlIsUsable || nodeData?.loading) {
      return
    }

    const localPath = String((nodeData as any)?.localPath || '').trim()
    // 有 error 标记但有 mediaId/sourceUrl/localPath 可恢复时，仍尝试恢复
    if (!nodeData?.mediaId && !nodeData?.sourceUrl && !localPath) {
      return
    }

    if (loadAttemptedRef.current) {
      return
    }

    loadAttemptedRef.current = true

    const loadMedia = async () => {
      const projectId = useGraphStore.getState().projectId || 'default'

      try {
        // 0. 尝试通过 localPath（Tauri 缓存路径）恢复
        if (localPath) {
          const assetUrl = await recoverFromLocalPath(localPath)
          if (assetUrl) {
            useGraphStore.getState().updateNode(id, {
              data: { url: assetUrl, loading: false }
            } as any)
            return
          }
        }

        // 1. 首先尝试通过 mediaId 从 IndexedDB / Tauri 持久化目录加载
        if (nodeData?.mediaId) {
          console.log('[VideoNode] 从 IndexedDB/Tauri 加载视频, mediaId:', nodeData.mediaId)
          const result = await getMediaWithFallback(nodeData.mediaId, id, projectId)
          if (result?.data) {
            useGraphStore.getState().updateNode(id, {
              data: { url: result.data, loading: false }
            } as any)
            return
          }
        }

        // 2. 尝试通过 nodeId 从 IndexedDB / Tauri 持久化目录查找
        console.log('[VideoNode] 通过 nodeId 查找:', id)
        const resultByNode = await getMediaByNodeIdWithFallback(id, projectId)
        if (resultByNode?.data) {
          useGraphStore.getState().updateNode(id, {
            data: {
              url: resultByNode.data,
              mediaId: resultByNode.id,
              loading: false
            }
          } as any)
          return
        }

        // 3. 尝试通过 sourceUrl 恢复（支持 http(s) 与 /v1/... 相对 API 路径）
        const sourceUrl = String(nodeData?.sourceUrl || '').trim()
        if (isRecoverableSourceUrl(sourceUrl)) {
          console.log('[VideoNode] 尝试恢复 sourceUrl:', sourceUrl.slice(0, 60))
          const cached = await resolveCachedMediaUrl(sourceUrl)
          const nextUrl = String(cached?.displayUrl || '').trim() || sourceUrl
          useGraphStore.getState().updateNode(id, {
            data: { url: nextUrl, sourceUrl, localPath: cached?.localPath || '', loading: false }
          } as any)
          return
        }

        console.log('[VideoNode] 无法恢复视频数据，节点需要重新生成')
      } catch (err) {
        console.error('[VideoNode] 加载媒体失败:', err)
      }
    }

    loadMedia()
  }, [id, nodeData?.url, nodeData?.mediaId, nodeData?.sourceUrl, nodeData?.loading, nodeData?.error, inView])

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
          type: 'video',
          data: url,
          sourceUrl: typeof nodeData?.sourceUrl === 'string' && isRecoverableSourceUrl(nodeData.sourceUrl) ? nodeData.sourceUrl : undefined,
          model: typeof nodeData?.model === 'string' ? nodeData.model : undefined,
        })
        if (mediaId) store.patchNodeDataSilent(id, { mediaId })
      } catch {
        // ignore
      }
    }
    void persist()
  }, [id, nodeData?.url, nodeData?.mediaId, nodeData?.sourceUrl, nodeData?.model])

  const handleDelete = useCallback((e: React.MouseEvent) => {
    e.stopPropagation()
    useGraphStore.getState().removeNode(id)
  }, [id])

  const handleDuplicate = useCallback((e: React.MouseEvent) => {
    e.stopPropagation()
    const store = useGraphStore.getState()
    const node = store.nodes.find((n) => n.id === id)
    if (node) {
      store.addNode('video', { x: node.x + 50, y: node.y + 50 }, { ...node.data })
    }
  }, [id])

  // 替换视频功能
  const replaceInputRef = useRef<HTMLInputElement>(null)

  const handleReplaceClick = useCallback(async (e: React.MouseEvent) => {
    e.stopPropagation()
    
    if (isTauri) {
      // Tauri 环境：使用 dialog API
      try {
        const { open } = await import('@tauri-apps/plugin-dialog')
        const { readFile } = await import('@tauri-apps/plugin-fs')
        
        const result = await open({
          multiple: false,
          filters: [{ name: '视频文件', extensions: ['mp4', 'webm', 'mov', 'avi', 'mkv'] }],
          title: '选择视频'
        })
        
        if (result && typeof result === 'string') {
          const fileData = await readFile(result)
          const fileName = result.split('/').pop() || result.split('\\').pop() || 'video'
          const ext = fileName.split('.').pop()?.toLowerCase() || 'mp4'
          const mimeMap: Record<string, string> = { 
            mp4: 'video/mp4', webm: 'video/webm', mov: 'video/quicktime', 
            avi: 'video/x-msvideo', mkv: 'video/x-matroska' 
          }
          const mimeType = mimeMap[ext] || 'video/mp4'
          
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
              label: fileName || nodeData?.label || '视频',
              loading: false,
              error: undefined,
            }
          })
          
          // 保存到 IndexedDB
          try {
            const mediaId = await saveMedia({
              nodeId: id,
              projectId,
              type: 'video',
              data: dataUrl,
            })
            if (mediaId) {
              store.patchNodeDataSilent(id, { mediaId })
            }
          } catch {
            // ignore
          }
          
          window.$message?.success?.('视频已替换')
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

    const reader = new FileReader()
    reader.onload = async (event) => {
      const dataUrl = event.target?.result as string
      if (!dataUrl) return

      const store = useGraphStore.getState()
      const projectId = store.projectId || 'default'

      store.updateNode(id, {
        data: {
          url: dataUrl,
          sourceUrl: '',
          mediaId: undefined,
          label: file.name || nodeData?.label || '视频',
          loading: false,
          error: undefined,
        }
      })

      // 保存到 IndexedDB
      try {
        const mediaId = await saveMedia({
          nodeId: id,
          projectId,
          type: 'video',
          data: dataUrl,
        })
        if (mediaId) {
          store.patchNodeDataSilent(id, { mediaId })
        }
      } catch {
        // ignore
      }

      window.$message?.success?.('视频已替换')
    }
    reader.readAsDataURL(file)
    e.target.value = ''
  }, [id, nodeData?.label])

  const handleExtractFrame = useCallback(async (e: React.MouseEvent) => {
    e.stopPropagation()
    if (!displayUrl || !videoRef.current) {
      window.$message?.warning?.('视频未就绪，请稍后再试')
      return
    }

    try {
      const video = videoRef.current
      if (!video.paused) video.pause()

      const canvas = document.createElement('canvas')
      canvas.width = video.videoWidth || 640
      canvas.height = video.videoHeight || 360
      const ctx = canvas.getContext('2d')
      if (!ctx) throw new Error('Canvas 初始化失败')

      ctx.drawImage(video, 0, 0, canvas.width, canvas.height)
      const dataUrl = canvas.toDataURL('image/jpeg', 0.92)

      const store = useGraphStore.getState()
      const node = store.nodes.find((n) => n.id === id)
      const imageId = store.addNode('image', 
        { x: (node?.x || 0) + 450, y: node?.y || 0 },
        { label: '视频帧', url: dataUrl }
      )
      store.addEdge(id, imageId, {})
      window.$message?.success?.('已提取当前帧')
    } catch (err: any) {
      window.$message?.error?.(err?.message || '提取帧失败')
    }
  }, [id, displayUrl])

  // 预览功能 - 在应用内模态框中显示
  const handlePreview = useCallback((e: React.MouseEvent) => {
    e.stopPropagation()
    if (!displayUrl) {
      window.$message?.warning?.('暂无视频可预览')
      return
    }
    setPreviewModalOpen(true)
  }, [displayUrl])

  const handleDownload = useCallback(async (e: React.MouseEvent) => {
    e.stopPropagation()
    if (downloading) return
    if (!displayUrl) {
      window.$message?.warning?.('暂无视频可下载')
      return
    }

    const downloadUrl = (nodeData?.sourceUrl && isRecoverableSourceUrl(nodeData.sourceUrl))
      ? nodeData.sourceUrl
      : displayUrl

    console.log('[VideoNode] 下载视频, URL类型:',
      downloadUrl.startsWith('data:') ? 'data:' :
      downloadUrl.startsWith('asset:') ? 'asset:' :
      downloadUrl.startsWith('http') ? 'http' : 'unknown',
      'URL长度:', downloadUrl.length
    )

    setDownloading(true)
    try {
      const success = await downloadFile({
        url: downloadUrl,
        filename: `video_${Date.now()}.mp4`,
        mimeType: 'video/mp4'
      })
      if (success) {
        window.$message?.success?.('下载成功')
      }
    } catch (err: any) {
      console.error('[VideoNode] 下载失败:', err)
      const errMsg = err?.message || String(err) || '未知错误'
      if (errMsg.includes('CORS') || errMsg.includes('Failed to fetch')) {
        window.$message?.warning?.('跨域限制，正在尝试直接打开...')
        try {
          const { openExternal } = await import('@/lib/openExternal')
          await openExternal(downloadUrl)
        } catch {
          window.$message?.error?.('打开链接失败')
        }
      } else {
        window.$message?.error?.(`下载失败: ${errMsg}`)
      }
    } finally {
      setDownloading(false)
    }
  }, [displayUrl, nodeData?.sourceUrl, downloading])

  const handleFileUpload = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file) return

    const reader = new FileReader()
    reader.onload = () => {
      const dataUrl = reader.result as string
      const store = useGraphStore.getState()
      const projectId = store.projectId || 'default'
      void (async () => {
        let mediaId: string | undefined
        try {
          mediaId = await saveMedia({
            nodeId: id,
            projectId,
            type: 'video',
            data: dataUrl,
            sourceUrl: undefined,
            model: typeof (nodeData as any)?.model === 'string' ? (nodeData as any).model : undefined,
          })
        } catch {
          mediaId = undefined
        }
        store.updateNode(id, {
          data: {
            ...(store.nodes.find((n) => n.id === id)?.data as any),
            url: dataUrl,
            sourceUrl: '', // dataURL 不作为长期 source
            mediaId,
            label: file.name,
          },
        } as any)
      })()
    }
    reader.readAsDataURL(file)
  }, [id])

  const handleVideoError = useCallback(() => {
    const url = String(displayUrl || '').trim()
    if (corsMode === 'anonymous' && /^https?:\/\//i.test(url)) {
      setCorsMode('none')
      return
    }
    // 远程 URL 播放失败时，尝试从 IndexedDB / Tauri 持久化目录恢复
    if (nodeData?.mediaId && /^https?:\/\//i.test(url)) {
      void (async () => {
        const projectId = useGraphStore.getState().projectId || 'default'
        try {
          const result = await getMediaWithFallback(nodeData.mediaId!, id, projectId)
          if (result?.data && result.data !== url) {
            useGraphStore.getState().updateNode(id, { data: { url: result.data, loading: false } } as any)
            setVideoError('')
            return
          }
        } catch { /* ignore */ }
        setVideoError('视频加载失败')
      })()
      return
    }
    const sourceUrl = String(nodeData?.sourceUrl || '').trim()
    const fallbackUrl = sourceUrl || (isApiRelativeUrl(url) ? url : '')
    if (fallbackUrl && isRecoverableSourceUrl(fallbackUrl) && loadErrorFallbackRef.current !== fallbackUrl) {
      loadErrorFallbackRef.current = fallbackUrl
      void (async () => {
        try {
          const cached = await resolveCachedMediaUrl(fallbackUrl)
          const nextUrl = String(cached.displayUrl || '').trim()
          if (nextUrl && nextUrl !== url) {
            useGraphStore.getState().updateNode(id, {
              data: { url: nextUrl, localPath: cached.localPath, error: '', loading: false }
            } as any)
            setVideoError('')
            return
          }
        } catch { /* ignore */ }
        setVideoError('视频加载失败')
      })()
      return
    }
    setVideoError('视频加载失败')
  }, [corsMode, displayUrl, id, nodeData?.sourceUrl, nodeData?.mediaId])

  return (
    // ref 用于懒加载检测
    <div
      ref={inViewRef}
      className="relative pr-[50px] pt-[20px]"
      onMouseEnter={() => setShowActions(true)}
      onMouseLeave={() => setShowActions(false)}
    >
      {/* 节点主体 */}
      <div
        className={`video-node bg-[var(--bg-secondary)] rounded-xl border w-[400px] relative transition-all duration-200 ${
          selected ? 'border-blue-500 shadow-lg shadow-blue-500/20' : 'border-[var(--border-color)]'
        }`}
      >
        {/* 头部 */}
        <div className="px-3 py-2 border-b border-[var(--border-color)]">
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium text-[var(--text-secondary)]">
              {nodeData?.label || '视频'}
            </span>
            <div className="flex items-center gap-1">
              <button onClick={handleDelete} className="p-1 hover:bg-[var(--bg-tertiary)] rounded">
                <Trash2 size={14} />
              </button>
            </div>
          </div>
          {nodeData?.model && (
            <div className="mt-1 text-xs text-[var(--text-secondary)] truncate">
              {nodeData.model}
            </div>
          )}
        </div>

        {/* 视频预览区域 - 支持懒加载 */}
        <div className="p-3">
          {/* 懒加载占位符：节点不在可视区域且无已有视频时显示 */}
          {!inView && !displayUrl && !nodeData?.loading && (
            <div className="aspect-video rounded-lg bg-[var(--bg-tertiary)] flex flex-col items-center justify-center gap-2 border border-[var(--border-color)]">
              <Video size={32} className="text-[var(--text-secondary)] opacity-50" />
              <span className="text-sm text-[var(--text-secondary)] opacity-50">滚动到此处加载</span>
            </div>
          )}

          {/* 加载状态 */}
          {inView && nodeData?.loading && (
            <div className="aspect-video rounded-lg bg-gradient-to-br from-cyan-400 via-blue-300 to-amber-200 flex flex-col items-center justify-center gap-3 relative overflow-hidden">
              <div className="absolute inset-0 bg-gradient-to-br from-cyan-500/20 via-blue-400/20 to-amber-300/20 animate-pulse" />
              <div className="relative z-10">
                <Video size={48} className="text-white" />
              </div>
              <span className="text-sm text-white font-medium relative z-10">创作中，预计等待 1 分钟</span>
            </div>
          )}

          {/* 错误状态 */}
          {inView && !nodeData?.loading && nodeData?.error && (
            <div className="aspect-video rounded-lg bg-red-50 dark:bg-red-900/20 flex flex-col items-center justify-center gap-2 border border-red-200 dark:border-red-800">
              <X size={32} className="text-red-500" />
              <span className="text-sm text-red-500">{nodeData.error}</span>
            </div>
          )}

          {/* 视频加载错误 */}
          {inView && !nodeData?.loading && !nodeData?.error && videoError && (
            <div className="aspect-video rounded-lg bg-red-50 dark:bg-red-900/20 flex flex-col items-center justify-center gap-2 border border-red-200 dark:border-red-800">
              <X size={32} className="text-red-500" />
              <span className="text-sm text-red-500">{videoError}</span>
            </div>
          )}

          {/* 视频预览 */}
          {(inView || displayUrl) && !nodeData?.loading && !nodeData?.error && !videoError && displayUrl && (
            <div className="aspect-video rounded-lg overflow-hidden bg-black">
              <video
                key={`${displayUrl}|${corsMode}`}
                ref={videoRef}
                src={displayUrl}
                controls
                crossOrigin={corsMode === 'anonymous' && isHttpUrl(displayUrl) ? 'anonymous' : undefined}
                playsInline
                preload="auto"
                className="w-full h-full object-contain nodrag"
                onError={handleVideoError}
              />
            </div>
          )}

          {/* 空状态 */}
          {inView && !nodeData?.loading && !nodeData?.error && !videoError && !displayUrl && (
            <div className="aspect-video rounded-lg bg-[var(--bg-tertiary)] flex flex-col items-center justify-center gap-2 border-2 border-dashed border-[var(--border-color)] relative">
              <Video size={32} className="text-[var(--text-secondary)]" />
              <span className="text-sm text-[var(--text-secondary)]">拖放视频或点击上传</span>
              <input
                type="file"
                accept="video/*"
                className="absolute inset-0 opacity-0 cursor-pointer nodrag"
                onChange={handleFileUpload}
                onMouseDown={(e) => e.stopPropagation()}
                onClick={(e) => e.stopPropagation()}
              />
            </div>
          )}

          {/* 时长信息 */}
          {nodeData?.duration && (
            <div className="mt-2 text-xs text-[var(--text-secondary)]">
              时长: {formatDuration(nodeData.duration)}
            </div>
          )}
        </div>

        {/* 连接点 */}
        <Handle type="target" position={Position.Left} id="left" className="handle-video" />
        <Handle type="source" position={Position.Right} id="right" className="handle-video" />
      </div>

      {/* 悬浮操作按钮 - 复制（右上角偏左） */}
      {showActions && (
        <div className="absolute -top-5 right-12 z-[1000]">
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

      {/* 右侧操作按钮 */}
      {showActions && displayUrl && (
        <div className="absolute right-10 top-20 -translate-y-1/2 translate-x-full flex flex-col gap-2 z-[1000]">
          {/* 替换 */}
          <button
            onClick={handleReplaceClick}
            className="group p-2 bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 flex items-center gap-0 hover:gap-1.5 transition-all shadow-sm w-max"
          >
            <RefreshCw size={16} className="text-gray-600 dark:text-gray-300" />
            <span className="text-xs text-gray-600 dark:text-gray-300 max-w-0 overflow-hidden group-hover:max-w-[60px] transition-all duration-200 whitespace-nowrap">
              替换
            </span>
          </button>
          {/* 提取当前帧 */}
          <button
            onClick={handleExtractFrame}
            className="group p-2 bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 flex items-center gap-0 hover:gap-1.5 transition-all shadow-sm w-max"
          >
            <Image size={16} className="text-gray-600 dark:text-gray-300" />
            <span className="text-xs text-gray-600 dark:text-gray-300 max-w-0 overflow-hidden group-hover:max-w-[90px] transition-all duration-200 whitespace-nowrap">
              提取当前帧
            </span>
          </button>
          {/* 预览 */}
          <button
            onClick={handlePreview}
            className="group p-2 bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 flex items-center gap-0 hover:gap-1.5 transition-all shadow-sm w-max"
          >
            <Eye size={16} className="text-gray-600 dark:text-gray-300" />
            <span className="text-xs text-gray-600 dark:text-gray-300 max-w-0 overflow-hidden group-hover:max-w-[60px] transition-all duration-200 whitespace-nowrap">
              预览
            </span>
          </button>
          {/* 下载 */}
          <button
            onClick={handleDownload}
            disabled={downloading}
            className={`group p-2 bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 flex items-center gap-0 hover:gap-1.5 transition-all shadow-sm w-max ${downloading ? 'opacity-60 cursor-wait' : ''}`}
          >
            {downloading
              ? <Loader2 size={16} className="text-gray-600 dark:text-gray-300 animate-spin" />
              : <Download size={16} className="text-gray-600 dark:text-gray-300" />}
            <span className="text-xs text-gray-600 dark:text-gray-300 max-w-0 overflow-hidden group-hover:max-w-[80px] transition-all duration-200 whitespace-nowrap">
              {downloading ? '下载中...' : '下载'}
            </span>
          </button>
        </div>
      )}

      {/* 预览弹窗 */}
      {previewModalOpen && displayUrl && createPortal(
        <MediaPreviewModal
          open={previewModalOpen}
          url={displayUrl}
          type="video"
          onClose={() => setPreviewModalOpen(false)}
        />,
        document.body
      )}

      {/* 隐藏的替换视频文件选择器 */}
      <input
        ref={replaceInputRef}
        type="file"
        accept="video/*"
        className="hidden"
        onChange={handleReplaceFile}
      />
    </div>
  )
})
