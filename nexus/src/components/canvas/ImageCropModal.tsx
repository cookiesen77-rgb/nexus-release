/**
 * Image Crop Modal | 图片裁剪弹窗
 * 支持自由裁剪和预设比例裁剪
 */

import React, { useState, useRef, useCallback, useEffect } from 'react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { X, RotateCcw, Check } from 'lucide-react'

interface Props {
  open: boolean
  imageUrl: string
  onClose: () => void
  onCrop: (croppedDataUrl: string) => void
}

interface CropArea {
  x: number
  y: number
  width: number
  height: number
}

const ASPECT_RATIOS = [
  { label: '自由', value: null },
  { label: '1:1', value: 1 },
  { label: '4:3', value: 4 / 3 },
  { label: '3:4', value: 3 / 4 },
  { label: '16:9', value: 16 / 9 },
  { label: '9:16', value: 9 / 16 },
]

export default function ImageCropModal({ open, imageUrl, onClose, onCrop }: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [imageLoaded, setImageLoaded] = useState(false)
  const [imageSize, setImageSize] = useState({ width: 0, height: 0 })
  const [displaySize, setDisplaySize] = useState({ width: 0, height: 0 })
  const [cropArea, setCropArea] = useState<CropArea>({ x: 0, y: 0, width: 0, height: 0 })
  const [aspectRatio, setAspectRatio] = useState<number | null>(null)
  
  // 拖动状态
  const [isDragging, setIsDragging] = useState(false)
  const [dragType, setDragType] = useState<'move' | 'resize' | null>(null)
  const [resizeHandle, setResizeHandle] = useState<string | null>(null)
  const dragStartRef = useRef({ x: 0, y: 0, crop: { x: 0, y: 0, width: 0, height: 0 } })

  // 加载图片
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
      console.error('Failed to load image for cropping')
    }
    img.src = imageUrl
  }, [open, imageUrl])

  // 计算显示尺寸和初始裁剪区域
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
    
    const initialW = displayW * 0.8
    const initialH = displayH * 0.8
    setCropArea({
      x: (displayW - initialW) / 2,
      y: (displayH - initialH) / 2,
      width: initialW,
      height: initialH,
    })
  }, [imageLoaded, imageSize])

  // 应用宽高比
  const applyAspectRatio = useCallback((ratio: number | null) => {
    setAspectRatio(ratio)
    if (ratio === null) return
    
    setCropArea((prev) => {
      let newW = prev.width
      let newH = prev.height
      
      const currentRatio = prev.width / prev.height
      if (currentRatio > ratio) {
        newW = prev.height * ratio
      } else {
        newH = prev.width / ratio
      }
      
      newW = Math.min(newW, displaySize.width)
      newH = Math.min(newH, displaySize.height)
      
      const newX = prev.x + (prev.width - newW) / 2
      const newY = prev.y + (prev.height - newH) / 2
      
      return {
        x: Math.max(0, Math.min(newX, displaySize.width - newW)),
        y: Math.max(0, Math.min(newY, displaySize.height - newH)),
        width: newW,
        height: newH,
      }
    })
  }, [displaySize])

  // 开始拖动
  const handleMouseDown = useCallback((e: React.MouseEvent, type: 'move' | 'resize', handle?: string) => {
    e.preventDefault()
    e.stopPropagation()
    
    setIsDragging(true)
    setDragType(type)
    setResizeHandle(handle || null)
    dragStartRef.current = {
      x: e.clientX,
      y: e.clientY,
      crop: { ...cropArea }
    }
  }, [cropArea])

  // 拖动中
  const handleMouseMove = useCallback((e: MouseEvent) => {
    if (!isDragging) return
    
    const { x: startX, y: startY, crop: startCrop } = dragStartRef.current
    const dx = e.clientX - startX
    const dy = e.clientY - startY
    
    let newArea = { ...startCrop }
    
    if (dragType === 'move') {
      newArea.x = Math.max(0, Math.min(startCrop.x + dx, displaySize.width - startCrop.width))
      newArea.y = Math.max(0, Math.min(startCrop.y + dy, displaySize.height - startCrop.height))
    } else if (dragType === 'resize' && resizeHandle) {
      switch (resizeHandle) {
        case 'se':
          newArea.width = Math.max(50, Math.min(startCrop.width + dx, displaySize.width - startCrop.x))
          newArea.height = aspectRatio 
            ? newArea.width / aspectRatio 
            : Math.max(50, Math.min(startCrop.height + dy, displaySize.height - startCrop.y))
          break
        case 'sw':
          const newWidthSW = Math.max(50, startCrop.width - dx)
          newArea.x = startCrop.x + startCrop.width - newWidthSW
          newArea.width = newWidthSW
          newArea.height = aspectRatio 
            ? newArea.width / aspectRatio 
            : Math.max(50, Math.min(startCrop.height + dy, displaySize.height - startCrop.y))
          break
        case 'ne':
          newArea.width = Math.max(50, Math.min(startCrop.width + dx, displaySize.width - startCrop.x))
          const newHeightNE = aspectRatio 
            ? newArea.width / aspectRatio 
            : Math.max(50, startCrop.height - dy)
          newArea.y = startCrop.y + startCrop.height - newHeightNE
          newArea.height = newHeightNE
          break
        case 'nw':
          const newWidthNW = Math.max(50, startCrop.width - dx)
          const newHeightNW = aspectRatio 
            ? newWidthNW / aspectRatio 
            : Math.max(50, startCrop.height - dy)
          newArea.x = startCrop.x + startCrop.width - newWidthNW
          newArea.y = startCrop.y + startCrop.height - newHeightNW
          newArea.width = newWidthNW
          newArea.height = newHeightNW
          break
      }
      
      newArea.x = Math.max(0, newArea.x)
      newArea.y = Math.max(0, newArea.y)
      newArea.width = Math.min(newArea.width, displaySize.width - newArea.x)
      newArea.height = Math.min(newArea.height, displaySize.height - newArea.y)
    }
    
    setCropArea(newArea)
  }, [isDragging, dragType, resizeHandle, displaySize, aspectRatio])

  // 结束拖动
  const handleMouseUp = useCallback(() => {
    setIsDragging(false)
    setDragType(null)
    setResizeHandle(null)
  }, [])

  // 全局鼠标事件监听
  useEffect(() => {
    if (isDragging) {
      window.addEventListener('mousemove', handleMouseMove)
      window.addEventListener('mouseup', handleMouseUp)
      return () => {
        window.removeEventListener('mousemove', handleMouseMove)
        window.removeEventListener('mouseup', handleMouseUp)
      }
    }
  }, [isDragging, handleMouseMove, handleMouseUp])

  // 重置
  const handleReset = useCallback(() => {
    const initialW = displaySize.width * 0.8
    const initialH = displaySize.height * 0.8
    setCropArea({
      x: (displaySize.width - initialW) / 2,
      y: (displaySize.height - initialH) / 2,
      width: initialW,
      height: initialH,
    })
    setAspectRatio(null)
  }, [displaySize])

  // 执行裁剪
  const handleCrop = useCallback(() => {
    if (!imageLoaded || displaySize.width === 0) return
    
    const scaleX = imageSize.width / displaySize.width
    const scaleY = imageSize.height / displaySize.height
    
    // 使用 Math.round 取整，避免浮点数导致的边缘问题（尤其在 Windows 上）
    const realCrop = {
      x: Math.round(cropArea.x * scaleX),
      y: Math.round(cropArea.y * scaleY),
      width: Math.round(cropArea.width * scaleX),
      height: Math.round(cropArea.height * scaleY),
    }
    
    // 确保尺寸至少为 1
    realCrop.width = Math.max(1, realCrop.width)
    realCrop.height = Math.max(1, realCrop.height)
    
    // 确保不超出图片边界
    realCrop.x = Math.min(realCrop.x, imageSize.width - realCrop.width)
    realCrop.y = Math.min(realCrop.y, imageSize.height - realCrop.height)
    realCrop.x = Math.max(0, realCrop.x)
    realCrop.y = Math.max(0, realCrop.y)
    
    const canvas = document.createElement('canvas')
    canvas.width = realCrop.width
    canvas.height = realCrop.height
    
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    
    // 禁用图像平滑，保持像素精确
    ctx.imageSmoothingEnabled = false
    
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => {
      ctx.drawImage(
        img,
        realCrop.x, realCrop.y, realCrop.width, realCrop.height,
        0, 0, realCrop.width, realCrop.height
      )
      
      const croppedDataUrl = canvas.toDataURL('image/png')
      onCrop(croppedDataUrl)
      onClose()
    }
    img.src = imageUrl
  }, [imageLoaded, imageSize, displaySize, cropArea, imageUrl, onCrop, onClose])

  if (!open) return null

  // 计算遮罩区域（裁剪框外的暗色区域）
  const maskStyle = {
    clipPath: cropArea.width > 0 
      ? `polygon(
          0% 0%, 100% 0%, 100% 100%, 0% 100%, 0% 0%,
          ${cropArea.x}px ${cropArea.y}px,
          ${cropArea.x}px ${cropArea.y + cropArea.height}px,
          ${cropArea.x + cropArea.width}px ${cropArea.y + cropArea.height}px,
          ${cropArea.x + cropArea.width}px ${cropArea.y}px,
          ${cropArea.x}px ${cropArea.y}px
        )`
      : 'none'
  }

  return (
    <div
      className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/60"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div
        className="flex h-[min(85vh,800px)] w-[min(1000px,95vw)] flex-col overflow-hidden rounded-2xl border border-[var(--border-color)] bg-[var(--bg-secondary)] shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-[var(--border-color)] px-5 py-4">
          <h2 className="text-lg font-semibold text-[var(--text-primary)]">裁剪图片</h2>
          <button
            onClick={onClose}
            className="rounded-full p-1 text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-primary)] hover:text-[var(--text-primary)]"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Aspect Ratio Selector */}
        <div className="flex items-center gap-2 border-b border-[var(--border-color)] px-5 py-3">
          <span className="text-xs text-[var(--text-secondary)]">比例：</span>
          {ASPECT_RATIOS.map((ratio) => (
            <button
              key={ratio.label}
              onClick={() => applyAspectRatio(ratio.value)}
              className={cn(
                'rounded-full border px-3 py-1 text-xs font-medium transition-colors',
                aspectRatio === ratio.value
                  ? 'border-[var(--accent-color)] bg-[rgb(var(--accent-rgb)/0.1)] text-[var(--accent-color)]'
                  : 'border-[var(--border-color)] text-[var(--text-secondary)] hover:border-[var(--text-secondary)]'
              )}
            >
              {ratio.label}
            </button>
          ))}
        </div>

        {/* Crop Area */}
        <div
          ref={containerRef}
          className="relative flex flex-1 items-center justify-center overflow-hidden bg-neutral-900 p-10"
        >
          {imageLoaded && displaySize.width > 0 && (
            <div
              className="relative select-none"
              style={{ width: displaySize.width, height: displaySize.height }}
            >
              {/* 原图 */}
              <img
                src={imageUrl}
                alt="Original"
                className="absolute inset-0 h-full w-full object-contain"
                draggable={false}
              />
              
              {/* 暗色遮罩（裁剪框外的区域） */}
              <div
                className="absolute inset-0 bg-black/60 pointer-events-none"
                style={maskStyle}
              />
              
              {/* 裁剪框边框 */}
              <div
                className="absolute border-2 border-white"
                style={{
                  left: cropArea.x,
                  top: cropArea.y,
                  width: cropArea.width,
                  height: cropArea.height,
                  cursor: isDragging && dragType === 'move' ? 'grabbing' : 'grab',
                }}
                onMouseDown={(e) => handleMouseDown(e, 'move')}
              >
                {/* 网格线 */}
                <div className="pointer-events-none absolute inset-0">
                  <div className="absolute left-1/3 top-0 h-full w-px bg-white/40" />
                  <div className="absolute left-2/3 top-0 h-full w-px bg-white/40" />
                  <div className="absolute left-0 top-1/3 h-px w-full bg-white/40" />
                  <div className="absolute left-0 top-2/3 h-px w-full bg-white/40" />
                </div>
              </div>
              
              {/* 缩放手柄 */}
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
          )}
          
          {!imageLoaded && (
            <div className="text-sm text-[var(--text-secondary)]">加载图片中...</div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between border-t border-[var(--border-color)] px-5 py-4">
          <div className="text-xs text-[var(--text-secondary)]">
            {displaySize.width > 0 && (
              <>裁剪尺寸: {Math.round(cropArea.width * (imageSize.width / displaySize.width))} x {Math.round(cropArea.height * (imageSize.height / displaySize.height))} px</>
            )}
          </div>
          <div className="flex items-center gap-3">
            <Button variant="ghost" onClick={handleReset}>
              <RotateCcw className="mr-2 h-4 w-4" />
              重置
            </Button>
            <Button variant="ghost" onClick={onClose}>
              取消
            </Button>
            <Button onClick={handleCrop} disabled={!imageLoaded}>
              <Check className="mr-2 h-4 w-4" />
              确认裁剪
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}
