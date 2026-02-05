/**
 * Mask Editor Modal | 蒙版绘制弹窗
 * 用于选区重绘和局部擦除功能
 * - 红色画笔绘制蒙版区域
 * - 支持撤销/重做
 * - 用户选择生图模型和分辨率
 */

import React, { useRef, useState, useCallback, useEffect, memo } from 'react'
import { X, Paintbrush, Eraser, Undo2, Redo2, Trash2, Check, Loader2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import { IMAGE_MODELS } from '@/config/models'

interface Props {
  open: boolean
  imageUrl: string
  mode: 'inpaint' | 'erase'
  onClose: () => void
  onConfirm: (maskBase64: string, prompt?: string, model?: string, resolution?: string) => void
}

interface HistoryEntry {
  imageData: ImageData
}

// 获取支持的生图模型列表
const getImageModels = () => {
  return IMAGE_MODELS.filter((m: any) =>
    m.key && !String(m.format || '').includes('video')
  ).map((m: any) => ({
    key: m.key,
    label: m.label || m.key
  }))
}

const RESOLUTION_OPTIONS = [
  { key: '1K', label: '1K 标清' },
  { key: '2K', label: '2K 高清' },
  { key: '4K', label: '4K 超清' },
]

export default memo(function MaskEditorModal({ open, imageUrl, mode, onClose, onConfirm }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const imageRef = useRef<HTMLImageElement | null>(null)
  const [isDrawing, setIsDrawing] = useState(false)
  const [brushSize, setBrushSize] = useState(30)
  const [tool, setTool] = useState<'brush' | 'eraser'>('brush')
  const [prompt, setPrompt] = useState('')
  const [history, setHistory] = useState<HistoryEntry[]>([])
  const [historyIndex, setHistoryIndex] = useState(-1)
  const [canvasReady, setCanvasReady] = useState(false)
  const [imageLoaded, setImageLoaded] = useState(false)

  // 模型和分辨率选择
  const [selectedModel, setSelectedModel] = useState('nano-banana-pro')
  const [selectedResolution, setSelectedResolution] = useState('2K')
  const [isConfirming, setIsConfirming] = useState(false)

  const imageModels = getImageModels()

  // 初始化 Canvas
  useEffect(() => {
    if (!open || !imageUrl) return

    setImageLoaded(false)
    setCanvasReady(false)

    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => {
      imageRef.current = img
      setImageLoaded(true)

      const canvas = canvasRef.current
      const container = containerRef.current
      if (!canvas || !container) return

      // 计算合适的显示尺寸
      const maxWidth = Math.min(container.clientWidth - 40, 800)
      const maxHeight = Math.min(container.clientHeight - 40, 600)
      const scale = Math.min(1, maxWidth / img.width, maxHeight / img.height)

      const displayWidth = img.width * scale
      const displayHeight = img.height * scale

      canvas.width = img.width
      canvas.height = img.height
      canvas.style.width = `${displayWidth}px`
      canvas.style.height = `${displayHeight}px`

      const ctx = canvas.getContext('2d')
      if (!ctx) return

      ctx.clearRect(0, 0, canvas.width, canvas.height)

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
      setImageLoaded(false)
      setPrompt('')
      setTool('brush')
      setIsConfirming(false)
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

  // 获取鼠标/触摸在 canvas 上的位置
  const getCanvasPoint = useCallback((clientX: number, clientY: number) => {
    const canvas = canvasRef.current
    if (!canvas) return { x: 0, y: 0 }

    const rect = canvas.getBoundingClientRect()
    const scaleX = canvas.width / rect.width
    const scaleY = canvas.height / rect.height

    return {
      x: (clientX - rect.left) * scaleX,
      y: (clientY - rect.top) * scaleY
    }
  }, [])

  // 绘制圆形笔刷 - 红色
  const drawBrush = useCallback((x: number, y: number) => {
    const canvas = canvasRef.current
    const ctx = canvas?.getContext('2d')
    if (!ctx) return

    ctx.beginPath()
    ctx.arc(x, y, brushSize / 2, 0, Math.PI * 2)

    if (tool === 'brush') {
      // 红色半透明蒙版
      ctx.fillStyle = 'rgba(255, 60, 60, 0.6)'
      ctx.fill()
    } else {
      // 橡皮擦
      ctx.globalCompositeOperation = 'destination-out'
      ctx.fillStyle = 'rgba(0, 0, 0, 1)'
      ctx.fill()
      ctx.globalCompositeOperation = 'source-over'
    }
  }, [brushSize, tool])

  // 鼠标按下
  const handleMouseDown = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!canvasReady) return
    e.preventDefault()
    setIsDrawing(true)
    const point = getCanvasPoint(e.clientX, e.clientY)
    drawBrush(point.x, point.y)
  }, [canvasReady, getCanvasPoint, drawBrush])

  // 鼠标移动
  const handleMouseMove = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!isDrawing || !canvasReady) return
    e.preventDefault()
    const point = getCanvasPoint(e.clientX, e.clientY)
    drawBrush(point.x, point.y)
  }, [isDrawing, canvasReady, getCanvasPoint, drawBrush])

  // 鼠标释放
  const handleMouseUp = useCallback(() => {
    if (isDrawing) {
      setIsDrawing(false)
      saveHistory()
    }
  }, [isDrawing, saveHistory])

  // 触摸事件支持
  const handleTouchStart = useCallback((e: React.TouchEvent<HTMLCanvasElement>) => {
    if (!canvasReady || e.touches.length !== 1) return
    e.preventDefault()
    setIsDrawing(true)
    const touch = e.touches[0]
    const point = getCanvasPoint(touch.clientX, touch.clientY)
    drawBrush(point.x, point.y)
  }, [canvasReady, getCanvasPoint, drawBrush])

  const handleTouchMove = useCallback((e: React.TouchEvent<HTMLCanvasElement>) => {
    if (!isDrawing || !canvasReady || e.touches.length !== 1) return
    e.preventDefault()
    const touch = e.touches[0]
    const point = getCanvasPoint(touch.clientX, touch.clientY)
    drawBrush(point.x, point.y)
  }, [isDrawing, canvasReady, getCanvasPoint, drawBrush])

  const handleTouchEnd = useCallback(() => {
    if (isDrawing) {
      setIsDrawing(false)
      saveHistory()
    }
  }, [isDrawing, saveHistory])

  // 检查是否有绘制内容
  const hasMaskContent = useCallback(() => {
    const canvas = canvasRef.current
    const ctx = canvas?.getContext('2d')
    if (!ctx || !canvas) return false

    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height)
    const data = imageData.data
    for (let i = 3; i < data.length; i += 4) {
      if (data[i] > 0) return true
    }
    return false
  }, [])

  // 将红色蒙版转换为白色蒙版（用于 AI 处理）
  const convertMaskToWhite = useCallback(() => {
    const canvas = canvasRef.current
    const ctx = canvas?.getContext('2d')
    if (!ctx || !canvas) return ''

    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height)
    const data = imageData.data

    // 创建新的 canvas 用于输出白色蒙版
    const outputCanvas = document.createElement('canvas')
    outputCanvas.width = canvas.width
    outputCanvas.height = canvas.height
    const outputCtx = outputCanvas.getContext('2d')
    if (!outputCtx) return ''

    const outputData = outputCtx.createImageData(canvas.width, canvas.height)

    for (let i = 0; i < data.length; i += 4) {
      const alpha = data[i + 3]
      if (alpha > 0) {
        // 有内容的区域转为白色
        outputData.data[i] = 255     // R
        outputData.data[i + 1] = 255 // G
        outputData.data[i + 2] = 255 // B
        outputData.data[i + 3] = 255 // A
      } else {
        // 透明区域保持透明（或黑色）
        outputData.data[i] = 0
        outputData.data[i + 1] = 0
        outputData.data[i + 2] = 0
        outputData.data[i + 3] = 0
      }
    }

    outputCtx.putImageData(outputData, 0, 0)
    return outputCanvas.toDataURL('image/png')
  }, [])

  // 确认
  const handleConfirm = useCallback(() => {
    if (!hasMaskContent()) {
      window.$message?.warning?.('请先绘制要处理的区域')
      return
    }

    setIsConfirming(true)

    // 将红色蒙版转为白色蒙版
    const maskBase64 = convertMaskToWhite()
    if (!maskBase64) {
      window.$message?.error?.('蒙版转换失败')
      setIsConfirming(false)
      return
    }

    onConfirm(maskBase64, mode === 'inpaint' ? prompt : undefined, selectedModel, selectedResolution)
  }, [mode, prompt, selectedModel, selectedResolution, onConfirm, hasMaskContent, convertMaskToWhite])

  if (!open) return null

  const canConfirm = canvasReady && !isConfirming

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/70">
      <div
        className="bg-[var(--bg-secondary)] rounded-2xl border border-[var(--border-color)] shadow-2xl w-[90vw] max-w-[1100px] h-[85vh] flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-[var(--border-color)] flex-shrink-0">
          <div>
            <h3 className="font-semibold text-[var(--text-primary)] text-lg">
              {mode === 'inpaint' ? '选区重绘' : '局部擦除'}
            </h3>
            <p className="text-xs text-[var(--text-secondary)] mt-0.5">
              {mode === 'inpaint' ? '用红色画笔圈出要替换的区域' : '用红色画笔圈出要擦除的物品'}
            </p>
          </div>
          <button
            onClick={onClose}
            disabled={isConfirming}
            className="p-2 rounded-full text-[var(--text-secondary)] hover:bg-[var(--bg-primary)] disabled:opacity-50"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Main Content */}
        <div className="flex-1 flex overflow-hidden min-h-0">
          {/* Canvas Area */}
          <div
            ref={containerRef}
            className="flex-1 relative p-4 flex items-center justify-center bg-[var(--bg-primary)] overflow-hidden"
          >
            {/* 底图 */}
            {imageLoaded && imageRef.current && (
              <img
                src={imageUrl}
                alt="Source"
                className="absolute pointer-events-none rounded-lg"
                style={{
                  width: canvasRef.current?.style.width || 'auto',
                  height: canvasRef.current?.style.height || 'auto',
                  maxWidth: '100%',
                  maxHeight: '100%',
                  objectFit: 'contain'
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
              onTouchStart={handleTouchStart}
              onTouchMove={handleTouchMove}
              onTouchEnd={handleTouchEnd}
              className={cn(
                'relative border-2 border-dashed border-red-400/50 rounded-lg',
                tool === 'brush' ? 'cursor-crosshair' : 'cursor-cell',
                !canvasReady && 'opacity-50'
              )}
            />

            {/* 加载提示 */}
            {!canvasReady && (
              <div className="absolute inset-0 flex items-center justify-center bg-black/30">
                <div className="flex items-center gap-2 px-4 py-2 bg-black/60 text-white rounded-lg">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  <span>加载中...</span>
                </div>
              </div>
            )}

            {/* 提示文字 */}
            {canvasReady && (
              <div className="absolute bottom-6 left-1/2 -translate-x-1/2 px-4 py-2 bg-red-600/90 text-white text-sm rounded-full shadow-lg">
                {mode === 'inpaint' ? '绘制要重绘的区域（红色区域将被替换）' : '绘制要擦除的区域（红色区域将被移除）'}
              </div>
            )}
          </div>

          {/* Sidebar */}
          <div className="w-72 p-4 border-l border-[var(--border-color)] flex flex-col gap-4 overflow-y-auto">
            {/* Tool Selection */}
            <div>
              <label className="block text-xs font-semibold text-[var(--text-primary)] mb-2">绘图工具</label>
              <div className="flex gap-2">
                <button
                  onClick={() => setTool('brush')}
                  disabled={isConfirming}
                  className={cn(
                    'flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-lg border transition',
                    tool === 'brush'
                      ? 'border-red-500 bg-red-500/10 text-red-500'
                      : 'border-[var(--border-color)] text-[var(--text-secondary)] hover:bg-[var(--bg-primary)]'
                  )}
                >
                  <Paintbrush className="h-4 w-4" />
                  <span className="text-sm font-medium">画笔</span>
                </button>
                <button
                  onClick={() => setTool('eraser')}
                  disabled={isConfirming}
                  className={cn(
                    'flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-lg border transition',
                    tool === 'eraser'
                      ? 'border-[var(--accent-color)] bg-[var(--accent-color)]/10 text-[var(--accent-color)]'
                      : 'border-[var(--border-color)] text-[var(--text-secondary)] hover:bg-[var(--bg-primary)]'
                  )}
                >
                  <Eraser className="h-4 w-4" />
                  <span className="text-sm font-medium">橡皮</span>
                </button>
              </div>
            </div>

            {/* Brush Size */}
            <div>
              <label className="block text-xs font-semibold text-[var(--text-primary)] mb-2">
                画笔大小: <span className="text-red-500">{brushSize}px</span>
              </label>
              <input
                type="range"
                min="10"
                max="150"
                value={brushSize}
                onChange={(e) => setBrushSize(Number(e.target.value))}
                disabled={isConfirming}
                className="w-full accent-red-500"
              />
              <div className="flex justify-between text-[10px] text-[var(--text-secondary)] mt-1">
                <span>小</span>
                <span>大</span>
              </div>
            </div>

            {/* History Actions */}
            <div>
              <label className="block text-xs font-semibold text-[var(--text-primary)] mb-2">操作</label>
              <div className="flex gap-2">
                <button
                  onClick={handleUndo}
                  disabled={historyIndex <= 0 || isConfirming}
                  className="flex-1 flex items-center justify-center gap-1 py-2 rounded-lg border border-[var(--border-color)] text-[var(--text-secondary)] hover:bg-[var(--bg-primary)] disabled:opacity-40 disabled:cursor-not-allowed"
                  title="撤销"
                >
                  <Undo2 className="h-4 w-4" />
                  <span className="text-xs">撤销</span>
                </button>
                <button
                  onClick={handleRedo}
                  disabled={historyIndex >= history.length - 1 || isConfirming}
                  className="flex-1 flex items-center justify-center gap-1 py-2 rounded-lg border border-[var(--border-color)] text-[var(--text-secondary)] hover:bg-[var(--bg-primary)] disabled:opacity-40 disabled:cursor-not-allowed"
                  title="重做"
                >
                  <Redo2 className="h-4 w-4" />
                  <span className="text-xs">重做</span>
                </button>
                <button
                  onClick={handleClear}
                  disabled={isConfirming}
                  className="flex-1 flex items-center justify-center gap-1 py-2 rounded-lg border border-[var(--border-color)] text-[var(--text-secondary)] hover:bg-[var(--bg-primary)] disabled:opacity-50"
                  title="清空"
                >
                  <Trash2 className="h-4 w-4" />
                  <span className="text-xs">清空</span>
                </button>
              </div>
            </div>

            {/* Inpaint Prompt - 仅重绘模式显示 */}
            {mode === 'inpaint' && (
              <div>
                <label className="block text-xs font-semibold text-[var(--text-primary)] mb-2">
                  替换内容描述 <span className="text-[var(--text-secondary)]">(可选)</span>
                </label>
                <textarea
                  value={prompt}
                  onChange={(e) => setPrompt(e.target.value)}
                  placeholder="描述要替换成什么，如：一只白色小猫、一束鲜花、蓝色天空..."
                  disabled={isConfirming}
                  className="w-full h-20 px-3 py-2 rounded-lg bg-[var(--bg-primary)] text-[var(--text-primary)] text-sm border border-[var(--border-color)] resize-none placeholder:text-[var(--text-secondary)] disabled:opacity-50"
                />
                <p className="text-[10px] text-[var(--text-secondary)] mt-1">
                  留空则 AI 将自动分析并智能填充
                </p>
              </div>
            )}

            {/* 擦除模式说明 */}
            {mode === 'erase' && (
              <div className="p-3 rounded-lg bg-red-500/10 border border-red-500/30">
                <p className="text-xs text-red-600 dark:text-red-400">
                  圈出的区域将被无痕移除，AI 会根据周围环境自然填充。
                </p>
              </div>
            )}

            {/* Model Selection */}
            <div>
              <label className="block text-xs font-semibold text-[var(--text-primary)] mb-2">生图模型</label>
              <select
                value={selectedModel}
                onChange={(e) => setSelectedModel(e.target.value)}
                disabled={isConfirming}
                className="w-full px-3 py-2 rounded-lg bg-[var(--bg-primary)] text-[var(--text-primary)] text-sm border border-[var(--border-color)] disabled:opacity-50"
              >
                {imageModels.map((m) => (
                  <option key={m.key} value={m.key}>{m.label}</option>
                ))}
              </select>
            </div>

            {/* Resolution Selection */}
            <div>
              <label className="block text-xs font-semibold text-[var(--text-primary)] mb-2">分辨率</label>
              <div className="flex gap-2">
                {RESOLUTION_OPTIONS.map((r) => (
                  <button
                    key={r.key}
                    onClick={() => setSelectedResolution(r.key)}
                    disabled={isConfirming}
                    className={cn(
                      'flex-1 py-2 rounded-lg border text-sm font-medium transition',
                      selectedResolution === r.key
                        ? 'border-[var(--accent-color)] bg-[var(--accent-color)]/10 text-[var(--accent-color)]'
                        : 'border-[var(--border-color)] text-[var(--text-secondary)] hover:bg-[var(--bg-primary)]'
                    )}
                  >
                    {r.key}
                  </button>
                ))}
              </div>
            </div>

            {/* Confirm Button */}
            <div className="mt-auto pt-4">
              <button
                onClick={handleConfirm}
                disabled={!canConfirm}
                className="w-full flex items-center justify-center gap-2 px-4 py-3 rounded-lg bg-red-500 text-white font-semibold hover:bg-red-600 disabled:opacity-50 disabled:cursor-not-allowed transition"
              >
                {isConfirming ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    处理中...
                  </>
                ) : (
                  <>
                    <Check className="h-4 w-4" />
                    确认{mode === 'inpaint' ? '重绘' : '擦除'}
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
})
