/**
 * GridCropModal | 四/九宫格裁剪弹窗
 * - 允许用户自由拉伸裁剪框（任意比例）
 * - 叠加 2x2 或 3x3 网格线，确认后按裁剪区域切割输出
 */

import React, { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { Check, RotateCcw, X } from 'lucide-react'

export interface CropAreaPx {
  x: number
  y: number
  width: number
  height: number
}

interface CropAreaDisplay {
  x: number
  y: number
  width: number
  height: number
}

interface Props {
  open: boolean
  imageUrl: string
  gridSize: 2 | 3
  onClose: () => void
  onConfirm: (cropAreaPx: CropAreaPx) => void
}

export default function GridCropModal({ open, imageUrl, gridSize, onClose, onConfirm }: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [imageLoaded, setImageLoaded] = useState(false)
  const [imageSize, setImageSize] = useState({ width: 0, height: 0 })
  const [displaySize, setDisplaySize] = useState({ width: 0, height: 0 })
  const [cropArea, setCropArea] = useState<CropAreaDisplay>({ x: 0, y: 0, width: 0, height: 0 })

  const [isDragging, setIsDragging] = useState(false)
  const [dragType, setDragType] = useState<'move' | 'resize' | null>(null)
  const [resizeHandle, setResizeHandle] = useState<string | null>(null)
  const dragStartRef = useRef({ x: 0, y: 0, crop: { x: 0, y: 0, width: 0, height: 0 } })

  // Load image
  useEffect(() => {
    if (!open || !imageUrl) return
    setImageLoaded(false)
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => {
      setImageSize({ width: img.width, height: img.height })
      setImageLoaded(true)
    }
    img.onerror = () => {
      console.error('[GridCropModal] Failed to load image')
    }
    img.src = imageUrl
  }, [open, imageUrl])

  // Fit to container and init crop area
  useEffect(() => {
    if (!imageLoaded || !containerRef.current) return
    const container = containerRef.current
    const maxWidth = container.clientWidth - 80
    const maxHeight = container.clientHeight - 80

    let displayW = imageSize.width
    let displayH = imageSize.height
    if (displayW > maxWidth) {
      displayH = (displayH * maxWidth) / displayW
      displayW = maxWidth
    }
    if (displayH > maxHeight) {
      displayW = (displayW * maxHeight) / displayH
      displayH = maxHeight
    }
    setDisplaySize({ width: displayW, height: displayH })

    const initialW = displayW * 0.86
    const initialH = displayH * 0.86
    setCropArea({
      x: (displayW - initialW) / 2,
      y: (displayH - initialH) / 2,
      width: initialW,
      height: initialH,
    })
  }, [imageLoaded, imageSize])

  const handleMouseDown = useCallback(
    (e: React.MouseEvent, type: 'move' | 'resize', handle?: string) => {
      e.preventDefault()
      e.stopPropagation()
      setIsDragging(true)
      setDragType(type)
      setResizeHandle(handle || null)
      dragStartRef.current = { x: e.clientX, y: e.clientY, crop: { ...cropArea } }
    },
    [cropArea]
  )

  const handleMouseMove = useCallback(
    (e: MouseEvent) => {
      if (!isDragging) return
      const { x: startX, y: startY, crop: startCrop } = dragStartRef.current
      const dx = e.clientX - startX
      const dy = e.clientY - startY

      let next = { ...startCrop }
      if (dragType === 'move') {
        next.x = Math.max(0, Math.min(startCrop.x + dx, displaySize.width - startCrop.width))
        next.y = Math.max(0, Math.min(startCrop.y + dy, displaySize.height - startCrop.height))
      } else if (dragType === 'resize' && resizeHandle) {
        const minSize = 60
        switch (resizeHandle) {
          case 'se':
            next.width = Math.max(minSize, Math.min(startCrop.width + dx, displaySize.width - startCrop.x))
            next.height = Math.max(minSize, Math.min(startCrop.height + dy, displaySize.height - startCrop.y))
            break
          case 'sw': {
            const newW = Math.max(minSize, startCrop.width - dx)
            next.x = startCrop.x + startCrop.width - newW
            next.width = newW
            next.height = Math.max(minSize, Math.min(startCrop.height + dy, displaySize.height - startCrop.y))
            break
          }
          case 'ne': {
            const newH = Math.max(minSize, startCrop.height - dy)
            next.y = startCrop.y + startCrop.height - newH
            next.height = newH
            next.width = Math.max(minSize, Math.min(startCrop.width + dx, displaySize.width - startCrop.x))
            break
          }
          case 'nw': {
            const newW = Math.max(minSize, startCrop.width - dx)
            const newH = Math.max(minSize, startCrop.height - dy)
            next.x = startCrop.x + startCrop.width - newW
            next.y = startCrop.y + startCrop.height - newH
            next.width = newW
            next.height = newH
            break
          }
        }
        next.x = Math.max(0, Math.min(next.x, displaySize.width - next.width))
        next.y = Math.max(0, Math.min(next.y, displaySize.height - next.height))
      }
      setCropArea(next)
    },
    [isDragging, dragType, resizeHandle, displaySize]
  )

  const handleMouseUp = useCallback(() => {
    setIsDragging(false)
    setDragType(null)
    setResizeHandle(null)
  }, [])

  useEffect(() => {
    if (!isDragging) return
    window.addEventListener('mousemove', handleMouseMove)
    window.addEventListener('mouseup', handleMouseUp)
    return () => {
      window.removeEventListener('mousemove', handleMouseMove)
      window.removeEventListener('mouseup', handleMouseUp)
    }
  }, [isDragging, handleMouseMove, handleMouseUp])

  const handleReset = useCallback(() => {
    const w = displaySize.width * 0.86
    const h = displaySize.height * 0.86
    setCropArea({
      x: (displaySize.width - w) / 2,
      y: (displaySize.height - h) / 2,
      width: w,
      height: h,
    })
  }, [displaySize])

  const handleConfirm = useCallback(() => {
    if (!imageLoaded || displaySize.width === 0) return
    const scaleX = imageSize.width / displaySize.width
    const scaleY = imageSize.height / displaySize.height

    const real: CropAreaPx = {
      x: Math.round(cropArea.x * scaleX),
      y: Math.round(cropArea.y * scaleY),
      width: Math.round(cropArea.width * scaleX),
      height: Math.round(cropArea.height * scaleY),
    }
    real.width = Math.max(1, Math.min(real.width, imageSize.width - real.x))
    real.height = Math.max(1, Math.min(real.height, imageSize.height - real.y))
    real.x = Math.max(0, Math.min(real.x, imageSize.width - real.width))
    real.y = Math.max(0, Math.min(real.y, imageSize.height - real.height))
    onConfirm(real)
    onClose()
  }, [imageLoaded, displaySize, imageSize, cropArea, onConfirm, onClose])

  if (!open) return null

  const gridLines =
    gridSize === 2
      ? [
          { x: 0.5, y: null as any },
          { x: null as any, y: 0.5 },
        ]
      : [
          { x: 1 / 3, y: null as any },
          { x: 2 / 3, y: null as any },
          { x: null as any, y: 1 / 3 },
          { x: null as any, y: 2 / 3 },
        ]

  return createPortal(
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/60" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="flex h-[min(85vh,820px)] w-[min(1040px,96vw)] flex-col overflow-hidden rounded-2xl border border-[var(--border-color)] bg-[var(--bg-secondary)] shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-[var(--border-color)] px-5 py-4">
          <div>
            <div className="text-lg font-semibold text-[var(--text-primary)]">{gridSize === 2 ? '四宫格裁剪' : '九宫格裁剪'}</div>
            <div className="mt-1 text-xs text-[var(--text-secondary)]">拖动裁剪框可任意拉伸比例；确认后按 {gridSize}x{gridSize} 切割输出。</div>
          </div>
          <button onClick={onClose} className="rounded-full p-1 text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-primary)] hover:text-[var(--text-primary)]" type="button">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div ref={containerRef} className="relative flex flex-1 items-center justify-center overflow-hidden bg-neutral-900 p-10">
          {imageLoaded && displaySize.width > 0 ? (
            <div className="relative select-none" style={{ width: displaySize.width, height: displaySize.height }}>
              <img src={imageUrl} alt="Original" className="absolute inset-0 h-full w-full object-contain" draggable={false} />

              <div className="absolute inset-0 bg-black/60 pointer-events-none" style={{
                clipPath: cropArea.width > 0
                  ? `polygon(0% 0%, 100% 0%, 100% 100%, 0% 100%, 0% 0%, ${cropArea.x}px ${cropArea.y}px, ${cropArea.x}px ${cropArea.y + cropArea.height}px, ${cropArea.x + cropArea.width}px ${cropArea.y + cropArea.height}px, ${cropArea.x + cropArea.width}px ${cropArea.y}px, ${cropArea.x}px ${cropArea.y}px)`
                  : 'none'
              }} />

              <div
                className="absolute border-2 border-white"
                style={{ left: cropArea.x, top: cropArea.y, width: cropArea.width, height: cropArea.height, cursor: isDragging && dragType === 'move' ? 'grabbing' : 'grab' }}
                onMouseDown={(e) => handleMouseDown(e, 'move')}
              >
                {/* grid overlay */}
                <div className="pointer-events-none absolute inset-0">
                  {gridLines.map((l, i) => {
                    if (l.x != null) return <div key={i} className="absolute top-0 h-full w-px bg-white/45" style={{ left: `${l.x * 100}%` }} />
                    return <div key={i} className="absolute left-0 w-full h-px bg-white/45" style={{ top: `${(l.y as number) * 100}%` }} />
                  })}
                </div>
              </div>

              {/* resize handles */}
              {['nw', 'ne', 'sw', 'se'].map((handle) => {
                const isTop = handle.includes('n')
                const isLeft = handle.includes('w')
                return (
                  <div
                    key={handle}
                    className={cn(
                      'absolute h-4 w-4 rounded-full border-2 border-white bg-blue-500 z-10',
                      handle === 'nw' && 'cursor-nw-resize',
                      handle === 'ne' && 'cursor-ne-resize',
                      handle === 'sw' && 'cursor-sw-resize',
                      handle === 'se' && 'cursor-se-resize'
                    )}
                    style={{
                      left: (isLeft ? cropArea.x : cropArea.x + cropArea.width) - 8,
                      top: (isTop ? cropArea.y : cropArea.y + cropArea.height) - 8,
                    }}
                    onMouseDown={(e) => handleMouseDown(e, 'resize', handle)}
                  />
                )
              })}
            </div>
          ) : (
            <div className="text-sm text-[var(--text-secondary)]">加载图片中...</div>
          )}
        </div>

        <div className="flex items-center justify-between border-t border-[var(--border-color)] px-5 py-4">
          <div className="text-xs text-[var(--text-secondary)]">
            {displaySize.width > 0
              ? `输出区域：${Math.round(cropArea.width * (imageSize.width / displaySize.width))} x ${Math.round(cropArea.height * (imageSize.height / displaySize.height))} px`
              : ''}
          </div>
          <div className="flex items-center gap-3">
            <Button variant="ghost" onClick={handleReset}>
              <RotateCcw className="mr-2 h-4 w-4" />
              重置
            </Button>
            <Button variant="ghost" onClick={onClose}>
              取消
            </Button>
            <Button onClick={handleConfirm} disabled={!imageLoaded}>
              <Check className="mr-2 h-4 w-4" />
              确认裁剪
            </Button>
          </div>
        </div>
      </div>
    </div>
  , document.body)
}

