/**
 * VideoNodeFlow - React Flow 版本的视频节点
 * 完全对齐 Vue 版本 VideoNode.vue 实现
 * 
 * 性能优化：使用 IntersectionObserver 实现懒加载
 */
import React, { memo, useState, useCallback, useRef, useEffect, useMemo } from 'react'
import { createPortal } from 'react-dom'
import { Position, NodeProps } from '@xyflow/react'
import { TapNodeHandle } from './shared/TapNodeHandle'
import { Trash2, Copy, Expand, Video, Image, Eye, Download, X, RefreshCw, Loader2, Sparkles } from 'lucide-react'
import ImageSourcePickerModal from '@/components/canvas/ImageSourcePickerModal'
import { useGraphStore } from '@/graph/store'
import { getMedia, getMediaByNodeId, saveMedia } from '@/lib/mediaStorage'
import { downloadFile } from '@/lib/download'
import { resolveCachedMediaUrl } from '@/lib/workflow/cache'
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
  const [pickerOpen, setPickerOpen] = useState<'first' | 'last' | null>(null)
  const [corsMode, setCorsMode] = useState<'anonymous' | 'none'>('anonymous')
  const [downloading, setDownloading] = useState(false)
  const videoRef = useRef<HTMLVideoElement>(null)
  const hideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const persistAttemptedRef = useRef<string>('')
  const loadErrorFallbackRef = useRef<string>('')
  const [isPlaying, setIsPlaying] = useState(false)
  const [currentTime, setCurrentTime] = useState(0)
  const [duration, setDuration] = useState(0)
  
  // 懒加载：只有节点进入可视区域时才加载视频
  const { ref: inViewRef, inView } = useInView({
    rootMargin: '200px', // 提前 200px 开始加载
    triggerOnce: true,   // 一旦加载过就不再卸载
  })

  const displayUrl = nodeData?.url || ''
  const previewUrl = displayUrl || (nodeData?.sourceUrl && isRecoverableSourceUrl(nodeData.sourceUrl) ? nodeData.sourceUrl : '')

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

    // 有 error 标记但有 mediaId/sourceUrl 可恢复时，仍尝试恢复
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
          console.log('[VideoNode] 从 IndexedDB 加载视频, mediaId:', nodeData.mediaId)
          const record = await getMedia(nodeData.mediaId)
          if (record?.data) {
            useGraphStore.getState().updateNode(id, {
              data: { url: record.data, loading: false }
            } as any)
            return
          }
        }
        
        // 2. 尝试通过 nodeId 从 IndexedDB 查找
        console.log('[VideoNode] 通过 nodeId 从 IndexedDB 查找:', id)
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

  const togglePlay = useCallback((e?: React.MouseEvent) => {
    e?.stopPropagation()
    const v = videoRef.current
    if (!v) return
    if (v.paused) { v.play().catch(() => {}); setIsPlaying(true) }
    else { v.pause(); setIsPlaying(false) }
  }, [])

  const handleTimeUpdate = useCallback(() => {
    const v = videoRef.current
    if (v) setCurrentTime(v.currentTime)
  }, [])

  const handleLoadedMetadata = useCallback(() => {
    const v = videoRef.current
    if (v) setDuration(v.duration)
  }, [])

  const handleSeek = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const v = videoRef.current
    if (!v) return
    v.currentTime = Number(e.target.value)
    setCurrentTime(v.currentTime)
  }, [])

  const handleVideoEnded = useCallback(() => {
    setIsPlaying(false)
  }, [])

  const handleDelete = useCallback((e?: React.MouseEvent) => {
    e?.stopPropagation()
    useGraphStore.getState().removeNode(id)
  }, [id])

  const handleDuplicate = useCallback((e?: React.MouseEvent) => {
    e?.stopPropagation()
    const store = useGraphStore.getState()
    const node = store.nodes.find((n) => n.id === id)
    if (node) {
      store.addNode('video', { x: node.x + 50, y: node.y + 50 }, { ...node.data })
    }
  }, [id])

  // 替换视频功能
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

  const handleExtractFrame = useCallback(async (e?: React.MouseEvent) => {
    e?.stopPropagation()
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
  const handlePreview = useCallback((e?: React.MouseEvent) => {
    e?.stopPropagation()
    if (!previewUrl) {
      window.$message?.warning?.('暂无视频可预览')
      return
    }
    setPreviewModalOpen(true)
  }, [previewUrl])

  const handleDownload = useCallback(async (e?: React.MouseEvent) => {
    e?.stopPropagation()
    if (downloading) return
    const candidates = [displayUrl, nodeData?.sourceUrl]
      .map(v => String(v || '').trim())
      .filter((v, i, arr) => v && arr.indexOf(v) === i)

    if (candidates.length === 0) {
      window.$message?.warning?.('暂无视频可下载')
      return
    }

    setDownloading(true)
    let lastErr: any = null
    try {
      for (const url of candidates) {
        console.log('[VideoNode] 下载视频尝试:',
          url.startsWith('data:') ? 'data:' :
          url.startsWith('asset:') ? 'asset:' :
          url.startsWith('http') ? 'http' : 'unknown',
          'URL长度:', url.length
        )

        try {
          const success = await downloadFile({
            url,
            filename: `video_${Date.now()}.mp4`,
            mimeType: 'video/mp4'
          })
          if (success) {
            window.$message?.success?.('下载成功')
            return
          }
        } catch (err: any) {
          lastErr = err
          continue
        }
      }

      if (lastErr) throw lastErr
      throw new Error('下载失败')
    } catch (err: any) {
      console.error('[VideoNode] 下载失败:', err)
      const errMsg = err?.message || String(err) || '未知错误'
      if (errMsg.includes('CORS') || errMsg.includes('Failed to fetch')) {
        window.$message?.warning?.('跨域限制，正在尝试直接打开...')
        const fallback = candidates[0]
        const link = document.createElement('a')
        link.href = fallback
        link.target = '_blank'
        link.rel = 'noopener noreferrer'
        document.body.appendChild(link)
        link.click()
        setTimeout(() => document.body.removeChild(link), 100)
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

  // 首尾帧生成视频: 先选首帧，再选尾帧
  const handleStartEndVideo = useCallback((e?: React.MouseEvent) => {
    e?.stopPropagation()
    setPickerOpen('first')
  }, [])

  // 首帧生成视频: 选首帧
  const handleFirstFrameVideo = useCallback((e?: React.MouseEvent) => {
    e?.stopPropagation()
    setPickerOpen('first')
  }, [])

  // 图片选择回调
  const handlePickerSelect = useCallback((imageUrl: string, sourceNodeId?: string) => {
    const store = useGraphStore.getState()
    const node = store.nodes.find(n => n.id === id)
    if (!node) return
    const role = pickerOpen === 'last' ? 'last_frame_image' : 'first_frame_image'

    let imgNodeId = sourceNodeId || ''
    if (!imgNodeId) {
      imgNodeId = store.addNode('image', { x: node.x - 350, y: pickerOpen === 'last' ? node.y + 160 : node.y - 160 }, {
        label: role === 'first_frame_image' ? '首帧' : '尾帧',
        url: imageUrl,
        _fromWorkflow: true,
      })
    }
    store.addEdge(imgNodeId, id, { sourceHandle: 'right', targetHandle: 'left', imageRole: role })
    store.patchNodeDataSilent(id, { _awaitingGeneration: true })

    // 如果是首尾帧模式，选完首帧后继续选尾帧
    if (pickerOpen === 'first') {
      // 检查是否从"首尾帧"入口进来的（检查按钮触发源——通过是否已有首帧判断）
      const hasFirst = store.edges.some(e => e.target === id && String((e.data as any)?.imageRole) === 'first_frame_image')
      const hasLast = store.edges.some(e => e.target === id && String((e.data as any)?.imageRole) === 'last_frame_image')
      if (hasFirst && !hasLast) {
        setPickerOpen('last')
        return
      }
    }
    setPickerOpen(null)
  }, [id, pickerOpen])

  const handleVideoError = useCallback(() => {
    const url = String(displayUrl || '').trim()
    if (corsMode === 'anonymous' && /^https?:\/\//i.test(url)) {
      setCorsMode('none')
      return
    }
    // 远程 URL 播放失败时，尝试从 IndexedDB 恢复 data URL
    if (nodeData?.mediaId && /^https?:\/\//i.test(url)) {
      void (async () => {
        try {
          const record = await getMedia(nodeData.mediaId!)
          if (record?.data && record.data !== url) {
            useGraphStore.getState().updateNode(id, { data: { url: record.data, loading: false } } as any)
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

  const showToolbar = (showActions || selected) && displayUrl && !nodeData?.loading

  return (
    <div
      ref={inViewRef}
      className="relative"
      onMouseEnter={() => { if (hideTimerRef.current) { clearTimeout(hideTimerRef.current); hideTimerRef.current = null }; setShowActions(true) }}
      onMouseLeave={() => { hideTimerRef.current = setTimeout(() => setShowActions(false), 200) }}
    >
      {/* 节点主体 - 纯内容卡片 */}
      <div
        className="group relative overflow-visible rounded-xl bg-[var(--bg-secondary)]"
        style={{ width: 444, minHeight: 250 }}
      >
        {/* 标签 - TapNow 风格 */}
        <div className="absolute -translate-y-full text-left left-0 -top-0 pb-2 w-full text-[var(--text-secondary)] overflow-hidden text-ellipsis whitespace-nowrap" style={{ fontSize: '17.1429px' }}>{nodeData?.label || '视频'}</div>
        {/* 视频内容 - edge-to-edge */}
        <div className="bg-[var(--bg-secondary)] rounded-xl overflow-hidden relative">
          {!inView && !displayUrl && !nodeData?.loading && (
            <div className="aspect-video flex flex-col items-center justify-center gap-2 bg-[var(--bg-tertiary)]">
              <Video size={28} className="text-[var(--text-secondary)] opacity-30" />
              <span className="text-xs text-[var(--text-secondary)] opacity-40">滚动到此处加载</span>
            </div>
          )}

          {inView && nodeData?.loading && (
            <div className="aspect-video bg-gradient-to-br from-pink-500/20 via-purple-500/20 to-blue-500/20 flex flex-col items-center justify-center gap-3 relative overflow-hidden">
              <div className="absolute inset-0 bg-gradient-to-br from-pink-500/10 via-purple-500/10 to-blue-500/10 animate-pulse" />
              <Video size={36} className="text-pink-500 relative z-10" />
              <span className="text-xs text-[var(--text-primary)] relative z-10">创作中，预计等待 1 分钟</span>
            </div>
          )}

          {inView && !nodeData?.loading && nodeData?.error && (
            <div className="aspect-video flex flex-col items-center justify-center gap-2 bg-red-50 dark:bg-red-900/10">
              <X size={24} className="text-red-500" />
              <span className="text-xs text-red-500 px-4 text-center line-clamp-2">{nodeData.error}</span>
            </div>
          )}

          {inView && !nodeData?.loading && !nodeData?.error && videoError && (
            <div className="aspect-video flex flex-col items-center justify-center gap-2 bg-red-50 dark:bg-red-900/10">
              <X size={24} className="text-red-500" />
              <span className="text-xs text-red-500">{videoError}</span>
            </div>
          )}

          {(inView || displayUrl) && !nodeData?.loading && !nodeData?.error && !videoError && displayUrl && (
            <div
              className="aspect-video bg-black relative"
              onDoubleClick={(e) => { e.stopPropagation(); togglePlay() }}
            >
              <video
                key={`${displayUrl}|${corsMode}`}
                ref={videoRef}
                src={displayUrl}
                crossOrigin={corsMode === 'anonymous' && isHttpUrl(displayUrl) ? 'anonymous' : undefined}
                playsInline
                preload="auto"
                className="w-full h-full object-contain pointer-events-none select-none"
                draggable={false}
                onDragStart={(e) => e.preventDefault()}
                onError={handleVideoError}
                onTimeUpdate={handleTimeUpdate}
                onLoadedMetadata={handleLoadedMetadata}
                onEnded={handleVideoEnded}
              />
              <div className="absolute inset-0 z-10" />
              {/* TapNow-style hover control bar */}
              <div className="video-controls-bar nodrag absolute bottom-0 left-0 right-0 z-20 bg-gradient-to-t from-black/80 via-black/40 to-transparent px-3 pb-2.5 pt-8 flex items-center gap-2.5 opacity-0 translate-y-1 pointer-events-none">
                <button onClick={togglePlay} className="h-6 w-6 p-0 flex items-center justify-center text-white hover:text-white/80 bg-transparent border-none cursor-pointer shrink-0">
                  {isPlaying ? (
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="4" width="4" height="16" rx="1" /><rect x="14" y="4" width="4" height="16" rx="1" /></svg>
                  ) : (
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5.14v13.72a1 1 0 0 0 1.5.86l11-6.86a1 1 0 0 0 0-1.72l-11-6.86A1 1 0 0 0 8 5.14z" /></svg>
                  )}
                </button>
                <span className="text-[11px] text-white/90 tabular-nums min-w-[34px] text-right shrink-0 leading-none">{formatDuration(currentTime)}</span>
                <div className="flex-1 flex items-center">
                  <input
                    type="range"
                    min={0}
                    max={duration || 0}
                    step={0.1}
                    value={currentTime}
                    onChange={handleSeek}
                    className="w-full h-1 appearance-none bg-white/30 rounded-full cursor-pointer nodrag [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-2.5 [&::-webkit-slider-thumb]:h-2.5 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-white [&::-webkit-slider-thumb]:cursor-pointer"
                  />
                </div>
                <span className="text-[11px] text-white/90 tabular-nums min-w-[34px] shrink-0 leading-none">{formatDuration(duration)}</span>
                <button onClick={handleExtractFrame} title="截帧" className="h-6 w-6 p-0 flex items-center justify-center text-white hover:text-white/80 bg-transparent border-none cursor-pointer shrink-0">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/></svg>
                </button>
              </div>
            </div>
          )}

          {inView && !nodeData?.loading && !nodeData?.error && !videoError && !displayUrl && ((data as any)?._fromWorkflow || (data as any)?._awaitingGeneration) && (
            <div className="aspect-video flex flex-col items-center justify-center gap-2 bg-[var(--bg-tertiary)]">
              <Video size={28} className="text-[var(--text-secondary)] opacity-20" />
              {(data as any)?._awaitingGeneration && <span className="text-xs text-[var(--text-secondary)] opacity-30">待生成</span>}
            </div>
          )}

          {inView && !nodeData?.loading && !nodeData?.error && !videoError && !displayUrl && !(data as any)?._fromWorkflow && !(data as any)?._awaitingGeneration && (
            <div className="w-full h-full flex flex-col justify-center gap-2 px-6 py-8">
              <p className="text-xs text-[var(--text-secondary)] opacity-50 ml-2">尝试：</p>
              <div className="w-full space-y-1">
                <button onClick={handleStartEndVideo} onPointerDown={e => e.stopPropagation()} className="w-full text-left px-3 py-2.5 rounded-lg text-sm text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)] transition-colors flex items-center gap-2">
                  <Video size={14} className="opacity-50 shrink-0" />
                  首尾帧生成视频
                </button>
                <button onClick={handleFirstFrameVideo} onPointerDown={e => e.stopPropagation()} className="w-full text-left px-3 py-2.5 rounded-lg text-sm text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)] transition-colors flex items-center gap-2">
                  <Sparkles size={14} className="opacity-50 shrink-0" />
                  首帧生成视频
                </button>
              </div>
            </div>
          )}
        </div>

        <TapNodeHandle type="target" position={Position.Left} id="left" />
        <TapNodeHandle type="source" position={Position.Right} id="right" />
      </div>

      {/* TapNow: 视频悬浮工具栏 (选中有内容时显示) */}
      {showToolbar && (
        <div
          className="absolute left-1/2 z-[1001] nodrag"
          style={{ top: -56, transform: 'translateX(-50%)' }}
          onMouseDown={e => e.stopPropagation()}
          onPointerDown={e => e.stopPropagation()}
          onMouseEnter={() => { if (hideTimerRef.current) { clearTimeout(hideTimerRef.current); hideTimerRef.current = null }; setShowActions(true) }}
          onMouseLeave={() => { hideTimerRef.current = setTimeout(() => setShowActions(false), 200) }}
        >
          <div
            className="w-fit h-10 p-1 rounded-full flex items-center gap-0.5 whitespace-nowrap"
            style={{ backgroundColor: 'rgba(20,20,20,0.8)', backdropFilter: 'blur(16px)', border: '1px solid rgba(255,255,255,0.1)' }}
          >
            <button
              onPointerDown={(e) => e.stopPropagation()}
              onClick={(e) => { e.preventDefault(); e.stopPropagation(); handleExtractFrame() }}
              className="flex items-center gap-2 h-8 px-3 py-1 rounded-full text-xs text-white/80 hover:text-white transition-colors cursor-pointer"
              title="截帧"
            >
              <Image size={14} />
              <span>截帧</span>
            </button>
            <button
              onPointerDown={(e) => e.stopPropagation()}
              onClick={(e) => { e.preventDefault(); e.stopPropagation(); handleReplaceClick() }}
              className="flex items-center gap-2 h-8 px-3 py-1 rounded-full text-xs text-white/80 hover:text-white transition-colors cursor-pointer"
              title="替换"
            >
              <RefreshCw size={14} />
              <span>替换</span>
            </button>
            <div className="w-px h-5 bg-white/15 mx-1 shrink-0" />
            <button
              onPointerDown={(e) => e.stopPropagation()}
              onClick={(e) => { e.preventDefault(); e.stopPropagation(); handleDownload() }}
              className="h-8 w-8 rounded-full flex items-center justify-center text-white/60 hover:text-white transition-colors"
              title="下载"
            >
              <Download size={14} />
            </button>
            <button
              onPointerDown={(e) => e.stopPropagation()}
              onClick={(e) => { e.preventDefault(); e.stopPropagation(); handlePreview() }}
              className="h-8 w-8 rounded-full flex items-center justify-center text-white/60 hover:text-white transition-colors"
              title="预览"
            >
              <Eye size={14} />
            </button>
          </div>
        </div>
      )}

      {previewModalOpen && previewUrl && createPortal(
        <MediaPreviewModal open={previewModalOpen} url={previewUrl} type="video" onClose={() => setPreviewModalOpen(false)} />,
        document.body
      )}

      <input ref={replaceInputRef} type="file" accept="video/*" className="hidden" onChange={handleReplaceFile} />

      <ImageSourcePickerModal
        open={!!pickerOpen}
        title={pickerOpen === 'last' ? '选择尾帧图片' : '选择首帧图片'}
        onClose={() => setPickerOpen(null)}
        onSelect={handlePickerSelect}
      />
    </div>
  )
})
