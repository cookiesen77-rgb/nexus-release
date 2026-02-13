/**
 * VideoConfigNodeFlow - TapNow 风格视频生成节点
 *
 * 和 Video 节点外观一致的纯内容卡片，但自带生成能力：
 * 空节点 → 显示"尝试"菜单 → 选中后底部面板配置+生成 → 结果写入自身
 */
import React, { memo, useState, useCallback, useRef, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { Position, NodeProps } from '@xyflow/react'
import { TapNodeHandle } from './shared/TapNodeHandle'
import { Video, X, Loader2, Sparkles, Image, RefreshCw, Download, Eye } from 'lucide-react'
import ImageSourcePickerModal from '@/components/canvas/ImageSourcePickerModal'
import { useGraphStore } from '@/graph/store'
import { getMedia, getMediaByNodeId, saveMedia } from '@/lib/mediaStorage'
import { downloadFile } from '@/lib/download'
import { resolveCachedMediaUrl } from '@/lib/workflow/cache'
import MediaPreviewModal from '@/components/canvas/MediaPreviewModal'

const isHttpUrl = (v: string) => /^https?:\/\//i.test(String(v || '').trim())
const isApiRelativeUrl = (v: string) => { const u = String(v || '').trim(); return u.startsWith('/v1/') || u.startsWith('/v1beta') || u.startsWith('/kling') || u.startsWith('/tencent-vod') || u.startsWith('/video') }
const isRecoverableSourceUrl = (v: string) => isHttpUrl(v) || isApiRelativeUrl(v)

const formatDuration = (seconds: number) => {
  if (!seconds || !Number.isFinite(seconds)) return '0:00'
  const mins = Math.floor(seconds / 60)
  const secs = Math.floor(seconds % 60)
  return `${mins}:${secs.toString().padStart(2, '0')}`
}

interface ConfigData {
  label?: string
  url?: string
  sourceUrl?: string
  mediaId?: string
  loading?: boolean
  error?: string
  _fromWorkflow?: boolean
}

export const VideoConfigNodeComponent = memo(function VideoConfigNode({ id, data, selected }: NodeProps) {
  const nodeData = data as ConfigData
  const [showActions, setShowActions] = useState(false)
  const [videoError, setVideoError] = useState('')
  const [previewModalOpen, setPreviewModalOpen] = useState(false)
  const [downloading, setDownloading] = useState(false)
  const [corsMode, setCorsMode] = useState<'anonymous' | 'none'>('anonymous')
  const videoRef = useRef<HTMLVideoElement>(null)
  const loadAttemptedRef = useRef(false)
  const persistAttemptedRef = useRef<string>('')
  const loadErrorFallbackRef = useRef<string>('')
  const [isPlaying, setIsPlaying] = useState(false)
  const [currentTime, setCurrentTime] = useState(0)
  const [duration, setDuration] = useState(0)

  const isFromWorkflow = !!nodeData?._fromWorkflow
  const isAwaitingGeneration = !!(nodeData as any)?._awaitingGeneration

  // Local mode state — 即时切换 UI
  const [mode, setMode] = useState<'menu' | 'upload' | 'awaiting'>(() => {
    if (isAwaitingGeneration) return 'awaiting'
    if (isFromWorkflow) return 'upload'
    if (nodeData?.url) return 'upload'
    return 'menu'
  })

  const displayUrl = nodeData?.url || ''
  const previewUrl = displayUrl || (nodeData?.sourceUrl && isRecoverableSourceUrl(nodeData.sourceUrl) ? nodeData.sourceUrl : '')

  useEffect(() => { setVideoError(''); setCorsMode('anonymous'); loadErrorFallbackRef.current = '' }, [displayUrl])

  // 从 IndexedDB / sourceUrl 恢复
  useEffect(() => {
    const currentUrl = String(nodeData?.url || '').trim()
    if ((currentUrl && !currentUrl.startsWith('blob:') && currentUrl.length > 10) || nodeData?.loading) return
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
        const sourceUrl = String(nodeData?.sourceUrl || '').trim()
        if (isRecoverableSourceUrl(sourceUrl)) {
          const cached = await resolveCachedMediaUrl(sourceUrl)
          const nextUrl = String(cached?.displayUrl || '').trim() || sourceUrl
          useGraphStore.getState().updateNode(id, { data: { url: nextUrl, loading: false } } as any)
        }
      } catch {}
    })()
  }, [id, nodeData?.url, nodeData?.mediaId, nodeData?.sourceUrl, nodeData?.loading])

  // 持久化 data URL
  useEffect(() => {
    const url = String(nodeData?.url || '').trim()
    if (!url || nodeData?.mediaId || persistAttemptedRef.current === url) return
    if (!url.startsWith('data:') && !(!isHttpUrl(url) && url.length > 50000)) return
    persistAttemptedRef.current = url
    void (async () => {
      try {
        const store = useGraphStore.getState()
        const mediaId = await saveMedia({ nodeId: id, projectId: store.projectId || 'default', type: 'video', data: url })
        if (mediaId) store.patchNodeDataSilent(id, { mediaId })
      } catch {}
    })()
  }, [id, nodeData?.url, nodeData?.mediaId])

  // 播放控制
  const togglePlay = useCallback((e: React.MouseEvent) => {
    e.stopPropagation()
    const v = videoRef.current
    if (!v) return
    if (v.paused) { v.play().catch(() => {}); setIsPlaying(true) } else { v.pause(); setIsPlaying(false) }
  }, [])

  const handleTimeUpdate = useCallback(() => { const v = videoRef.current; if (v) setCurrentTime(v.currentTime) }, [])
  const handleLoadedMetadata = useCallback(() => { const v = videoRef.current; if (v) setDuration(v.duration) }, [])
  const handleSeek = useCallback((e: React.ChangeEvent<HTMLInputElement>) => { const v = videoRef.current; if (!v) return; v.currentTime = Number(e.target.value); setCurrentTime(v.currentTime) }, [])

  const handleVideoError = useCallback(() => {
    if (corsMode === 'anonymous' && isHttpUrl(displayUrl)) { setCorsMode('none'); return }
    if (nodeData?.mediaId && isHttpUrl(displayUrl)) {
      void (async () => {
        try { const record = await getMedia(nodeData.mediaId!); if (record?.data && record.data !== displayUrl) { useGraphStore.getState().updateNode(id, { data: { url: record.data, loading: false } } as any); setVideoError(''); return } } catch {}
        setVideoError('视频加载失败')
      })()
      return
    }
    setVideoError('视频加载失败')
  }, [corsMode, displayUrl, id, nodeData?.mediaId])

  const [pickerOpen, setPickerOpen] = useState<'first' | 'last' | null>(null)
  const [pickerMode, setPickerMode] = useState<'single' | 'dual'>('single')

  const handleStartEndVideo = useCallback((e?: React.MouseEvent) => {
    e?.stopPropagation()
    setPickerMode('dual')
    setPickerOpen('first')
  }, [])

  const handleFirstFrameVideo = useCallback((e?: React.MouseEvent) => {
    e?.stopPropagation()
    setPickerMode('single')
    setPickerOpen('first')
  }, [])

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
    setMode('awaiting')
    store.patchNodeDataSilent(id, { _awaitingGeneration: true })

    if (pickerOpen === 'first' && pickerMode === 'dual') {
      setPickerOpen('last')
      return
    }
    setPickerOpen(null)
  }, [id, pickerOpen, pickerMode])

  // 截帧
  const handleExtractFrame = useCallback((e: React.MouseEvent) => {
    e.stopPropagation()
    if (!displayUrl || !videoRef.current) return
    try {
      const video = videoRef.current
      if (!video.paused) video.pause()
      const canvas = document.createElement('canvas')
      canvas.width = video.videoWidth || 640
      canvas.height = video.videoHeight || 360
      const ctx = canvas.getContext('2d')
      if (!ctx) return
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height)
      const dataUrl = canvas.toDataURL('image/jpeg', 0.92)
      const store = useGraphStore.getState()
      const node = store.nodes.find(n => n.id === id)
      const imageId = store.addNode('image', { x: (node?.x || 0) + 450, y: node?.y || 0 }, { label: '视频帧', url: dataUrl })
      store.addEdge(id, imageId, {})
    } catch {}
  }, [id, displayUrl])

  const handlePreview = useCallback((e?: React.MouseEvent) => {
    e?.stopPropagation()
    if (!previewUrl) {
      window.$message?.warning?.("暂无视频可预览")
      return
    }
    setPreviewModalOpen(true)
  }, [previewUrl])

  const handleDownload = useCallback(async (e?: React.MouseEvent) => {
    e?.stopPropagation()
    if (downloading) return
    const candidates = [displayUrl, nodeData?.sourceUrl]
      .map(v => String(v || "").trim())
      .filter((v, i, arr) => v && arr.indexOf(v) === i)

    if (candidates.length === 0) {
      window.$message?.warning?.("暂无视频可下载")
      return
    }

    setDownloading(true)
    let lastErr: any = null
    try {
      for (const url of candidates) {
        try {
          const success = await downloadFile({
            url,
            filename: `video_${Date.now()}.mp4`,
            mimeType: "video/mp4"
          })
          if (success) {
            window.$message?.success?.("下载成功")
            return
          }
        } catch (err: any) {
          lastErr = err
        }
      }
      if (lastErr) throw lastErr
      throw new Error("下载失败")
    } catch (err: any) {
      const errMsg = err?.message || String(err) || "未知错误"
      if (errMsg.includes("CORS") || errMsg.includes("Failed to fetch")) {
        const fallback = candidates[0]
        const link = document.createElement("a")
        link.href = fallback
        link.target = "_blank"
        link.rel = "noopener noreferrer"
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


  return (
    <div
      className="relative"
      onMouseEnter={() => setShowActions(true)}
      onMouseLeave={() => setShowActions(false)}
    >
      {/* 标签 */}
      <div className="absolute -translate-y-full text-left left-0 -top-0 pb-2 w-full text-[var(--text-secondary)] overflow-hidden text-ellipsis whitespace-nowrap" style={{ fontSize: '17.1429px' }}>
        {nodeData?.label || '视频生成'}
      </div>

      {/* 节点主体 */}
      <div
        className="group relative overflow-visible rounded-2xl bg-[var(--bg-secondary)]"
        style={{ width: 320 }}
      >
        <div className="bg-[var(--bg-secondary)] rounded-2xl overflow-hidden">
          {nodeData?.loading && (
            <div className="aspect-video bg-gradient-to-br from-pink-500/20 via-purple-500/20 to-blue-500/20 flex flex-col items-center justify-center gap-3 relative overflow-hidden">
              <div className="absolute inset-0 bg-gradient-to-br from-pink-500/10 via-purple-500/10 to-blue-500/10 animate-pulse" />
              <Video size={36} className="text-pink-500 relative z-10" />
              <span className="text-xs text-[var(--text-primary)] relative z-10">创作中，预计等待 1 分钟</span>
            </div>
          )}

          {!nodeData?.loading && (nodeData?.error || videoError) && (
            <div className="aspect-video flex flex-col items-center justify-center gap-2 bg-red-50 dark:bg-red-900/10">
              <X size={24} className="text-red-500" />
              <span className="text-xs text-red-500 px-4 text-center line-clamp-2">{nodeData?.error || videoError}</span>
            </div>
          )}

          {!nodeData?.loading && !nodeData?.error && !videoError && displayUrl && (
            <div className="aspect-video bg-black relative" onDoubleClick={togglePlay}>
              <video
                key={`${displayUrl}|${corsMode}`}
                ref={videoRef}
                src={displayUrl}
                crossOrigin={corsMode === 'anonymous' && isHttpUrl(displayUrl) ? 'anonymous' : undefined}
                playsInline preload="auto"
                className="w-full h-full object-contain pointer-events-none select-none"
                draggable={false}
                onDragStart={(e) => e.preventDefault()}
                onError={handleVideoError}
                onTimeUpdate={handleTimeUpdate}
                onLoadedMetadata={handleLoadedMetadata}
                onEnded={() => setIsPlaying(false)}
              />
              <div className="absolute inset-0 z-10" />
              {/* 控制栏 */}
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
                  <input type="range" min={0} max={duration || 0} step={0.1} value={currentTime} onChange={handleSeek} className="w-full h-1 appearance-none bg-white/30 rounded-full cursor-pointer nodrag [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-2.5 [&::-webkit-slider-thumb]:h-2.5 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-white [&::-webkit-slider-thumb]:cursor-pointer" />
                </div>
                <span className="text-[11px] text-white/90 tabular-nums min-w-[34px] shrink-0 leading-none">{formatDuration(duration)}</span>
                <button onClick={handleExtractFrame} title="截帧" className="h-6 w-6 p-0 flex items-center justify-center text-white hover:text-white/80 bg-transparent border-none cursor-pointer shrink-0">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/></svg>
                </button>
              </div>
            </div>
          )}

          {/* 待生成占位 */}
          {!nodeData?.loading && !nodeData?.error && !videoError && !displayUrl && mode === 'awaiting' && (
            <div className="aspect-video flex flex-col items-center justify-center gap-3 bg-[var(--bg-tertiary)]">
              <Video size={28} className="text-[var(--text-secondary)] opacity-20" />
              <span className="text-xs text-[var(--text-secondary)] opacity-30">待生成</span>
            </div>
          )}

          {/* 上传占位 */}
          {!nodeData?.loading && !nodeData?.error && !videoError && !displayUrl && mode === 'upload' && (
            <div className="aspect-video flex flex-col items-center justify-center gap-2 bg-[var(--bg-tertiary)]">
              <Video size={28} className="text-[var(--text-secondary)] opacity-20" />
            </div>
          )}

          {/* "尝试"菜单 */}
          {!nodeData?.loading && !nodeData?.error && !videoError && !displayUrl && mode === 'menu' && (
            <div className="w-full flex flex-col justify-center gap-2 px-6 py-8" style={{ minHeight: 180 }}>
              <p className="text-xs text-[var(--text-secondary)] opacity-50 ml-2">尝试：</p>
              <div className="w-full space-y-1">
                <button onClick={handleStartEndVideo} onPointerDown={e => e.stopPropagation()} className="w-full text-left px-3 py-2.5 rounded-lg text-sm text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)] transition-colors flex items-center gap-2">
                  <Video size={14} className="opacity-50 shrink-0" />首尾帧生成视频
                </button>
                <button onClick={handleFirstFrameVideo} onPointerDown={e => e.stopPropagation()} className="w-full text-left px-3 py-2.5 rounded-lg text-sm text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)] transition-colors flex items-center gap-2">
                  <Sparkles size={14} className="opacity-50 shrink-0" />首帧生成视频
                </button>
              </div>
            </div>
          )}
        </div>

        <TapNodeHandle type="target" position={Position.Left} id="left" />
        <TapNodeHandle type="source" position={Position.Right} id="right" />
      </div>

      {/* 悬浮工具栏 */}
      {showActions && displayUrl && !nodeData?.loading && (
        <div className="absolute left-1/2 z-[1001]" style={{ top: -56, transform: 'translateX(-50%)' }} onPointerDown={e => e.stopPropagation()}>
          <div className="w-fit h-10 p-1 rounded-full flex items-center gap-0.5 whitespace-nowrap" style={{ backgroundColor: 'rgba(20,20,20,0.8)', backdropFilter: 'blur(16px)', border: '1px solid rgba(255,255,255,0.1)' }}>
            <button
              onPointerDown={(e) => e.stopPropagation()}
              onClick={(e) => { e.preventDefault(); e.stopPropagation(); handleExtractFrame(e) }}
              className="flex items-center gap-2 h-8 px-3 py-1 rounded-full text-xs text-white/80 hover:text-white transition-colors cursor-pointer"
            >
              <Image size={14} /><span>截帧</span>
            </button>
            <div className="w-px h-5 bg-white/15 mx-1 shrink-0" />
            <button
              onPointerDown={(e) => e.stopPropagation()}
              onClick={(e) => { e.preventDefault(); e.stopPropagation(); handleDownload(e) }}
              className="h-8 w-8 rounded-full flex items-center justify-center text-white/60 hover:text-white transition-colors"
              title="下载"
            >
              <Download size={14} />
            </button>
            <button
              onPointerDown={(e) => e.stopPropagation()}
              onClick={(e) => { e.preventDefault(); e.stopPropagation(); handlePreview(e) }}
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

      <ImageSourcePickerModal
        open={!!pickerOpen}
        title={pickerOpen === 'last' ? '选择尾帧图片' : '选择首帧图片'}
        onClose={() => setPickerOpen(null)}
        onSelect={handlePickerSelect}
      />
    </div>
  )
})
