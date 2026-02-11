import React, { memo, useState, useCallback, useMemo } from 'react'
import { ChevronLeft, ChevronRight, Download, Maximize2, ImageOff, Loader2 } from 'lucide-react'

export interface OutputEntry {
  id: string
  url: string
  sourceUrl?: string
  mediaId?: string
  model: string
  createdAt: number
  duration?: number
}

interface OutputPreviewProps {
  outputs: OutputEntry[]
  activeIndex: number
  onActiveIndexChange: (i: number) => void
  loading: boolean
  error: string
  mode: 'image' | 'video'
  width?: number
}

export const OutputPreview = memo(function OutputPreview({
  outputs, activeIndex, onActiveIndexChange, loading, error, mode, width = 388,
}: OutputPreviewProps) {
  const [imgError, setImgError] = useState(false)

  // Reset image error when switching outputs
  const currentUrl = outputs[activeIndex]?.url
  React.useEffect(() => { setImgError(false) }, [currentUrl])

  const current = outputs[activeIndex]
  const hasMultiple = outputs.length > 1
  const previewHeight = 280

  const goPrev = useCallback((e: React.MouseEvent) => {
    e.stopPropagation()
    if (activeIndex > 0) onActiveIndexChange(activeIndex - 1)
  }, [activeIndex, onActiveIndexChange])

  const goNext = useCallback((e: React.MouseEvent) => {
    e.stopPropagation()
    if (activeIndex < outputs.length - 1) onActiveIndexChange(activeIndex + 1)
  }, [activeIndex, outputs.length, onActiveIndexChange])

  const handleDownload = useCallback((e: React.MouseEvent) => {
    e.stopPropagation()
    if (!current?.url) return
    const a = document.createElement('a')
    a.href = current.url
    a.download = `output_${current.id}.${mode === 'video' ? 'mp4' : 'png'}`
    a.click()
  }, [current, mode])

  const handlePreview = useCallback((e: React.MouseEvent) => {
    e.stopPropagation()
    if (!current?.url) return
    window.open(current.url, '_blank')
  }, [current])

  if (loading) {
    return (
      <div
        className="flex flex-col items-center justify-center rounded-lg bg-[var(--bg-tertiary)] border border-[var(--border-color)]"
        style={{ height: previewHeight }}
        onClick={e => e.stopPropagation()}
      >
        <Loader2 size={28} className="animate-spin text-[var(--accent-color)]" />
        <span className="mt-2 text-xs text-[var(--text-secondary)]">
          {mode === 'image' ? '生成图片中...' : '生成视频中...'}
        </span>
      </div>
    )
  }

  if (error) {
    return (
      <div
        className="flex flex-col items-center justify-center rounded-lg bg-[var(--bg-tertiary)] border border-red-500/30"
        style={{ height: previewHeight }}
        onClick={e => e.stopPropagation()}
      >
        <ImageOff size={24} className="text-red-400" />
        <span className="mt-2 text-xs text-red-400 px-4 text-center line-clamp-2">{error}</span>
      </div>
    )
  }

  if (!current) {
    return (
      <div
        className="flex flex-col items-center justify-center rounded-lg bg-[var(--bg-tertiary)] border border-dashed border-[var(--border-color)]"
        style={{ height: previewHeight }}
        onClick={e => e.stopPropagation()}
      >
        <ImageOff size={24} className="text-[var(--text-secondary)] opacity-40" />
        <span className="mt-2 text-xs text-[var(--text-secondary)] opacity-60">
          {mode === 'image' ? '生成图片后将在此预览' : '生成视频后将在此预览'}
        </span>
      </div>
    )
  }

  return (
    <div
      className="relative rounded-lg overflow-hidden bg-black/20 group"
      style={{ height: previewHeight }}
      onClick={e => e.stopPropagation()}
    >
      {mode === 'image' ? (
        imgError ? (
          <div className="w-full h-full flex items-center justify-center">
            <ImageOff size={24} className="text-[var(--text-secondary)]" />
          </div>
        ) : (
          <img
            src={current.url}
            alt=""
            className="w-full h-full object-contain"
            onError={() => setImgError(true)}
            draggable={false}
          />
        )
      ) : (
        <video
          src={current.url}
          className="w-full h-full object-contain"
          controls
          preload="metadata"
        />
      )}

      {/* Navigation arrows */}
      {hasMultiple && (
        <>
          <button
            onClick={goPrev}
            disabled={activeIndex === 0}
            className="absolute left-1 top-1/2 -translate-y-1/2 w-6 h-6 rounded-full bg-black/60 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity disabled:opacity-0"
          >
            <ChevronLeft size={14} className="text-white" />
          </button>
          <button
            onClick={goNext}
            disabled={activeIndex >= outputs.length - 1}
            className="absolute right-1 top-1/2 -translate-y-1/2 w-6 h-6 rounded-full bg-black/60 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity disabled:opacity-0"
          >
            <ChevronRight size={14} className="text-white" />
          </button>
        </>
      )}

      {/* Top-right actions */}
      <div className="absolute top-1 right-1 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
        <button
          onClick={handlePreview}
          className="w-6 h-6 rounded bg-black/60 flex items-center justify-center"
          title="预览"
        >
          <Maximize2 size={12} className="text-white" />
        </button>
        <button
          onClick={handleDownload}
          className="w-6 h-6 rounded bg-black/60 flex items-center justify-center"
          title="下载"
        >
          <Download size={12} className="text-white" />
        </button>
      </div>

      {/* Counter badge */}
      {hasMultiple && (
        <div className="absolute bottom-1 right-1 px-1.5 py-0.5 rounded text-[10px] bg-black/60 text-white">
          {activeIndex + 1}/{outputs.length}
        </div>
      )}
    </div>
  )
})
