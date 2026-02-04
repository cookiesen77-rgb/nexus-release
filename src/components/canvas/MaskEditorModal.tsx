/**
 * Mask Editor Modal | 蒙版绘制弹窗
 * 用于选区重绘和局部擦除功能
 */

import React, { useRef, useState, useCallback, useEffect, memo } from 'react'
import { X, Paintbrush, Eraser, Undo2, Redo2, Trash2, Check } from 'lucide-react'
import { cn } from '@/lib/utils'

interface Props {
  open: boolean
  imageUrl: string
  mode: 'inpaint' | 'erase'
  onClose: () => void
  onConfirm: (maskBase64: string, prompt?: string) => void
}

interface DrawPoint {
  x: number
  y: number
}

interface HistoryEntry {
  imageData: ImageData
}

export default memo(function MaskEditorModal({ open, imageUrl, mode, onClose, onConfirm }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const imageRef = useRef<HTMLImageElement | null>(null)
  const [isDrawing, setIsDrawing] = useState(false)
  const [brushSize, setBrushSize] = useState(30)
  const [tool, setTool] = useState<'brush' | 'eraser'>('brush')
  const [prompt, setPrompt] = useState('')
  const [history, setHistory] = useState<HistoryEntry[]>([])
  const [historyIndex, setHistoryIndex] = useState(-1)
  const [canvasReady, setCanvasReady] = useState(false)

  // 初始化 Canvas
  useEffect(() => {
    if (!open || !imageUrl) return

    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => {
      imageRef.current = img
      const canvas = canvasRef.current
      if (!canvas) return

      // 设置 canvas 尺寸（限制最大尺寸以保持性能）
      const maxSize = 800
      const scale = Math.min(1, maxSize / Math.max(img.width, img.height))
      canvas.width = img.width * scale
      canvas.height = img.height * scale

      const ctx = canvas.getContext('2d')
      if (!ctx) return

      // 清空画布，设置为透明（蒙版初始为空）
      ctx.clearRect(0, 0, canvas.width, canvas.height)

      // 保存初始状态
      const initialData = ctx.getImageData(0, 0, canvas.width, canvas.height)
      setHistory([{ imageData: initialData }])
      setHistoryIndex(0)
      setCanvasReady(true)
    }
    img.onerror = () => {
      console.error('[MaskEditorModal] 图片加载失败')
    }
    img.src = imageUrl
  }, [open, imageUrl])

  // 清理状态
  useEffect(() => {
    if (!open) {
      setHistory([])
      setHistoryIndex(-1)
      setCanvasReady(false)
      setPrompt('')
      setTool('brush')
    }
  }, [open])

  // 保存历史记录
  const saveHistory = useCallback(() => {
    const canvas = canvasRef.current
    const ctx = canvas?.getContext('2d')
    if (!ctx || !canvas) return

    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height)
    const newHistory = history.slice(0, historyIndex + 1)
    newHistory.push({ imageData })

    // 限制历史记录数量
    if (newHistory.length > 50) {
      newHistory.shift()
    }

    setHistory(newHistory)
    setHistoryIndex(newHistory.length - 1)
  }, [history, historyIndex])

  // 撤销
  const handleUndo = useCallback(() => {
    if (historyIndex <= 0) return
    const canvas = canvasRef.current
    const ctx = canvas?.getContext('2d')
    if (!ctx || !canvas) return

    const newIndex = historyIndex - 1
    ctx.putImageData(history[newIndex].imageData, 0, 0)
    setHistoryIndex(newIndex)
  }, [history, historyIndex])

  // 重做
  const handleRedo = useCallback(() => {
    if (historyIndex >= history.length - 1) return
    const canvas = canvasRef.current
    const ctx = canvas?.getContext('2d')
    if (!ctx || !canvas) return

    const newIndex = historyIndex + 1
    ctx.putImageData(history[newIndex].imageData, 0, 0)
    setHistoryIndex(newIndex)
  }, [history, historyIndex])

  // 清空画布
  const handleClear = useCallback(() => {
    const canvas = canvasRef.current
    const ctx = canvas?.getContext('2d')
    if (!ctx || !canvas) return

    ctx.clearRect(0, 0, canvas.width, canvas.height)
    saveHistory()
  }, [saveHistory])

  // 获取鼠标在 canvas 上的位置
  const getCanvasPoint = useCallback((e: React.MouseEvent<HTMLCanvasElement>): DrawPoint => {
    const canvas = canvasRef.current
    if (!canvas) return { x: 0, y: 0 }

    const rect = canvas.getBoundingClientRect()
    const scaleX = canvas.width / rect.width
    const scaleY = canvas.height / rect.height

    return {
      x: (e.clientX - rect.left) * scaleX,
      y: (e.clientY - rect.top) * scaleY
    }
  }, [])

  // 绘制圆形笔刷
  const drawBrush = useCallback((point: DrawPoint) => {
    const canvas = canvasRef.current
    const ctx = canvas?.getContext('2d')
    if (!ctx) return

    ctx.beginPath()
    ctx.arc(point.x, point.y, brushSize / 2, 0, Math.PI * 2)

    if (tool === 'brush') {
      // 白色半透明蒙版
      ctx.fillStyle = 'rgba(255, 255, 255, 0.8)'
      ctx.fill()
    } else {
      // 橡皮擦：擦除绘制内容
      ctx.globalCompositeOperation = 'destination-out'
      ctx.fillStyle = 'rgba(0, 0, 0, 1)'
      ctx.fill()
      ctx.globalCompositeOperation = 'source-over'
    }
  }, [brushSize, tool])

  // 鼠标按下
  const handleMouseDown = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!canvasReady) return
    setIsDrawing(true)
    const point = getCanvasPoint(e)
    drawBrush(point)
  }, [canvasReady, getCanvasPoint, drawBrush])

  // 鼠标移动
  const handleMouseMove = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!isDrawing || !canvasReady) return
    const point = getCanvasPoint(e)
    drawBrush(point)
  }, [isDrawing, canvasReady, getCanvasPoint, drawBrush])

  // 鼠标释放
  const handleMouseUp = useCallback(() => {
    if (isDrawing) {
      setIsDrawing(false)
      saveHistory()
    }
  }, [isDrawing, saveHistory])

  // 确认
  const handleConfirm = useCallback(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    // 导出蒙版为 base64
    const maskBase64 = canvas.toDataURL('image/png')
    onConfirm(maskBase64, mode === 'inpaint' ? prompt : undefined)
  }, [mode, prompt, onConfirm])

  if (!open) return null

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/60">
      <div
        className="bg-[var(--bg-secondary)] rounded-2xl border border-[var(--border-color)] shadow-2xl max-w-[90vw] max-h-[90vh] flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-[var(--border-color)]">
          <h3 className="font-semibold text-[var(--text-primary)]">
            {mode === 'inpaint' ? '选区重绘' : '局部擦除'}
          </h3>
          <button
            onClick={onClose}
            className="p-1 rounded-full text-[var(--text-secondary)] hover:bg-[var(--bg-primary)]"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Main Content */}
        <div className="flex-1 flex overflow-hidden">
          {/* Canvas Area */}
          <div className="flex-1 relative p-4 flex items-center justify-center bg-[var(--bg-primary)]">
            {/* 底图 */}
            {imageRef.current && (
              <img
                src={imageUrl}
                alt="Source"
                className="absolute max-w-full max-h-full object-contain pointer-events-none"
                style={{
                  width: canvasRef.current?.style.width,
                  height: canvasRef.current?.style.height
                }}
              />
            )}
            {/* 蒙版画布 */}
            <canvas
              ref={canvasRef}
              onMouseDown={handleMouseDown}
              onMouseMove={handleMouseMove}
              onMouseUp={handleMouseUp}
              onMouseLeave={handleMouseUp}
              className={cn(
                'relative max-w-full max-h-full border border-dashed border-[var(--border-color)] rounded-lg',
                tool === 'brush' ? 'cursor-crosshair' : 'cursor-cell'
              )}
              style={{
                background: 'url("data:image/svg+xml,%3Csvg xmlns=\'http://www.w3.org/2000/svg\' width=\'20\' height=\'20\' viewBox=\'0 0 20 20\'%3E%3Crect width=\'10\' height=\'10\' fill=\'%23f0f0f0\'/%3E%3Crect x=\'10\' y=\'10\' width=\'10\' height=\'10\' fill=\'%23f0f0f0\'/%3E%3Crect x=\'10\' width=\'10\' height=\'10\' fill=\'%23e0e0e0\'/%3E%3Crect y=\'10\' width=\'10\' height=\'10\' fill=\'%23e0e0e0\'/%3E%3C/svg%3E")'
              }}
            />

            {/* 提示文字 */}
            {canvasReady && (
              <div className="absolute bottom-6 left-1/2 -translate-x-1/2 px-3 py-1 bg-black/60 text-white text-xs rounded-full">
                {mode === 'inpaint' ? '绘制要重绘的区域（白色区域）' : '绘制要擦除的区域'}
              </div>
            )}
          </div>

          {/* Sidebar */}
          <div className="w-64 p-4 border-l border-[var(--border-color)] flex flex-col gap-4">
            {/* Tool Selection */}
            <div>
              <label className="block text-xs font-semibold text-[var(--text-primary)] mb-2">工具</label>
              <div className="flex gap-2">
                <button
                  onClick={() => setTool('brush')}
                  className={cn(
                    'flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg border transition',
                    tool === 'brush'
                      ? 'border-[var(--accent-color)] bg-[var(--accent-color)]/10 text-[var(--accent-color)]'
                      : 'border-[var(--border-color)] text-[var(--text-secondary)] hover:bg-[var(--bg-primary)]'
                  )}
                >
                  <Paintbrush className="h-4 w-4" />
                  <span className="text-sm">画笔</span>
                </button>
                <button
                  onClick={() => setTool('eraser')}
                  className={cn(
                    'flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg border transition',
                    tool === 'eraser'
                      ? 'border-[var(--accent-color)] bg-[var(--accent-color)]/10 text-[var(--accent-color)]'
                      : 'border-[var(--border-color)] text-[var(--text-secondary)] hover:bg-[var(--bg-primary)]'
                  )}
                >
                  <Eraser className="h-4 w-4" />
                  <span className="text-sm">橡皮</span>
                </button>
              </div>
            </div>

            {/* Brush Size */}
            <div>
              <label className="block text-xs font-semibold text-[var(--text-primary)] mb-2">
                画笔大小: {brushSize}px
              </label>
              <input
                type="range"
                min="5"
                max="100"
                value={brushSize}
                onChange={(e) => setBrushSize(Number(e.target.value))}
                className="w-full"
              />
            </div>

            {/* History Actions */}
            <div>
              <label className="block text-xs font-semibold text-[var(--text-primary)] mb-2">操作</label>
              <div className="flex gap-2">
                <button
                  onClick={handleUndo}
                  disabled={historyIndex <= 0}
                  className="flex-1 flex items-center justify-center gap-1 py-2 rounded-lg border border-[var(--border-color)] text-[var(--text-secondary)] hover:bg-[var(--bg-primary)] disabled:opacity-40 disabled:cursor-not-allowed"
                  title="撤销"
                >
                  <Undo2 className="h-4 w-4" />
                </button>
                <button
                  onClick={handleRedo}
                  disabled={historyIndex >= history.length - 1}
                  className="flex-1 flex items-center justify-center gap-1 py-2 rounded-lg border border-[var(--border-color)] text-[var(--text-secondary)] hover:bg-[var(--bg-primary)] disabled:opacity-40 disabled:cursor-not-allowed"
                  title="重做"
                >
                  <Redo2 className="h-4 w-4" />
                </button>
                <button
                  onClick={handleClear}
                  className="flex-1 flex items-center justify-center gap-1 py-2 rounded-lg border border-[var(--border-color)] text-[var(--text-secondary)] hover:bg-[var(--bg-primary)]"
                  title="清空"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            </div>

            {/* Inpaint Prompt */}
            {mode === 'inpaint' && (
              <div>
                <label className="block text-xs font-semibold text-[var(--text-primary)] mb-2">
                  重绘内容描述
                </label>
                <textarea
                  value={prompt}
                  onChange={(e) => setPrompt(e.target.value)}
                  placeholder="描述你想要在选区中生成的内容，如：一只白色小猫"
                  className="w-full h-20 px-3 py-2 rounded-lg bg-[var(--bg-primary)] text-[var(--text-primary)] text-sm border border-[var(--border-color)] resize-none placeholder:text-[var(--text-secondary)]"
                />
              </div>
            )}

            {/* Confirm Button */}
            <div className="mt-auto">
              <button
                onClick={handleConfirm}
                disabled={!canvasReady}
                className="w-full flex items-center justify-center gap-2 px-4 py-3 rounded-lg bg-[var(--accent-color)] text-white font-semibold hover:opacity-90 disabled:opacity-50 transition"
              >
                <Check className="h-4 w-4" />
                确认
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
})
