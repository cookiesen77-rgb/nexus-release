/**
 * Mask Editor Modal | 蒙版绘制弹窗
 * 用于选区重绘和局部擦除功能
 * - 全屏预览风格界面
 * - 红色画笔绘制蒙版区域
 * - 浮动控制面板
 */

import React, { useRef, useState, useCallback, useEffect, memo } from 'react'
import { X, Paintbrush, Eraser, Undo2, Redo2, Trash2, Check, Loader2, ChevronDown, ChevronUp } from 'lucide-react'
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

const getImageModels = () => {
  return IMAGE_MODELS.filter((m: any) =>
    m.key && !String(m.format || '').includes('video')
  ).map((m: any) => ({
    key: m.key,
    label: m.label || m.key
  }))
}

const RESOLUTION_OPTIONS = [
  { key: '1K', label: '1K' },
  { key: '2K', label: '2K' },
  { key: '4K', label: '4K' },
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
  const [panelCollapsed, setPanelCollapsed] = useState(false)

  const [selectedModel, setSelectedModel] = useState('nano-banana-pro')
  const [selectedResolution, setSelectedResolution] = useState('2K')
  const [isConfirming, setIsConfirming] = useState(false)

  const imageModels = getImageModels()

  // 初始化 Canvas - 全屏模式
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

      // 全屏模式：使用容器的90%空间
      const maxWidth = window.innerWidth * 0.85
      const maxHeight = window.innerHeight * 0.85
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

  const handleUndo = useCallback(() => {
    if (historyIndex <= 0) return
    const canvas = canvasRef.current
    const ctx = canvas?.getContext('2d')
    if (!ctx || !canvas) return

    const newIndex = historyIndex - 1
    ctx.putImageData(history[newIndex].imageData, 0, 0)
    setHistoryIndex(newIndex)
  }, [history, historyIndex])

  const handleRedo = useCallback(() => {
    if (historyIndex >= history.length - 1) return
    const canvas = canvasRef.current
    const ctx = canvas?.getContext('2d')
    if (!ctx || !canvas) return

    const newIndex = historyIndex + 1
    ctx.putImageData(history[newIndex].imageData, 0, 0)
    setHistoryIndex(newIndex)
  }, [history, historyIndex])

  const handleClear = useCallback(() => {
    const canvas = canvasRef.current
    const ctx = canvas?.getContext('2d')
    if (!ctx || !canvas) return

    ctx.clearRect(0, 0, canvas.width, canvas.height)
    saveHistory()
  }, [saveHistory])

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

  const drawBrush = useCallback((x: number, y: number) => {
    const canvas = canvasRef.current
    const ctx = canvas?.getContext('2d')
    if (!ctx) return

    ctx.beginPath()
    ctx.arc(x, y, brushSize / 2, 0, Math.PI * 2)

    if (tool === 'brush') {
      ctx.fillStyle = 'rgba(255, 60, 60, 0.6)'
      ctx.fill()
    } else {
      ctx.globalCompositeOperation = 'destination-out'
      ctx.fillStyle = 'rgba(0, 0, 0, 1)'
      ctx.fill()
      ctx.globalCompositeOperation = 'source-over'
    }
  }, [brushSize, tool])

  const handleMouseDown = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!canvasReady) return
    e.preventDefault()
    setIsDrawing(true)
    const point = getCanvasPoint(e.clientX, e.clientY)
    drawBrush(point.x, point.y)
  }, [canvasReady, getCanvasPoint, drawBrush])

  const handleMouseMove = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!isDrawing || !canvasReady) return
    e.preventDefault()
    const point = getCanvasPoint(e.clientX, e.clientY)
    drawBrush(point.x, point.y)
  }, [isDrawing, canvasReady, getCanvasPoint, drawBrush])

  const handleMouseUp = useCallback(() => {
    if (isDrawing) {
      setIsDrawing(false)
      saveHistory()
    }
  }, [isDrawing, saveHistory])

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

  const convertMaskToWhite = useCallback(() => {
    const canvas = canvasRef.current
    const ctx = canvas?.getContext('2d')
    if (!ctx || !canvas) return ''

    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height)
    const data = imageData.data

    const outputCanvas = document.createElement('canvas')
    outputCanvas.width = canvas.width
    outputCanvas.height = canvas.height
    const outputCtx = outputCanvas.getContext('2d')
    if (!outputCtx) return ''

    const outputData = outputCtx.createImageData(canvas.width, canvas.height)

    for (let i = 0; i < data.length; i += 4) {
      const alpha = data[i + 3]
      if (alpha > 0) {
        outputData.data[i] = 255
        outputData.data[i + 1] = 255
        outputData.data[i + 2] = 255
        outputData.data[i + 3] = 255
      } else {
        outputData.data[i] = 0
        outputData.data[i + 1] = 0
        outputData.data[i + 2] = 0
        outputData.data[i + 3] = 0
      }
    }

    outputCtx.putImageData(outputData, 0, 0)
    return outputCanvas.toDataURL('image/png')
  }, [])

  const handleConfirm = useCallback(() => {
    if (!hasMaskContent()) {
      window.$message?.warning?.('请先绘制要处理的区域')
      return
    }

    setIsConfirming(true)

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
    <div className="fixed inset-0 z-[9999] bg-black/90" onClick={onClose}>
      {/* 关闭按钮 */}
      <button
        onClick={onClose}
        disabled={isConfirming}
        className="absolute top-4 right-4 z-20 rounded-full bg-black/50 p-3 text-white transition-colors hover:bg-black/70 disabled:opacity-50"
      >
        <X className="h-6 w-6" />
      </button>

      {/* 标题 */}
      <div className="absolute top-4 left-4 z-20">
        <h3 className="font-semibold text-white text-lg drop-shadow-lg">
          {mode === 'inpaint' ? '选区重绘' : '局部擦除'}
        </h3>
        <p className="text-xs text-white/70 mt-0.5">
          {mode === 'inpaint' ? '用红色画笔圈出要替换的区域' : '用红色画笔圈出要擦除的物品'}
        </p>
      </div>

      {/* 全屏画布区域 */}
      <div
        ref={containerRef}
        className="absolute inset-0 flex items-center justify-center"
        onClick={(e) => e.stopPropagation()}
      >
        {/* 底图 */}
        {imageLoaded && imageRef.current && (
          <img
            src={imageUrl}
            alt="Source"
            className="absolute pointer-events-none"
            style={{
              width: canvasRef.current?.style.width || 'auto',
              height: canvasRef.current?.style.height || 'auto',
              maxWidth: '85vw',
              maxHeight: '85vh',
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
            'relative rounded-lg',
            tool === 'brush' ? 'cursor-crosshair' : 'cursor-cell',
            !canvasReady && 'opacity-50'
          )}
        />

        {/* 加载提示 */}
        {!canvasReady && (
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="flex items-center gap-2 px-4 py-2 bg-black/60 text-white rounded-lg">
              <Loader2 className="h-4 w-4 animate-spin" />
              <span>加载中...</span>
            </div>
          </div>
        )}
      </div>

      {/* 浮动控制面板 */}
      <div
        className={cn(
          'absolute right-4 top-1/2 -translate-y-1/2 z-20 transition-all duration-300',
          panelCollapsed ? 'w-12' : 'w-64'
        )}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="bg-black/70 backdrop-blur-sm rounded-2xl border border-white/10 overflow-hidden">
          {/* 面板头部 - 可折叠 */}
          <button
            onClick={() => setPanelCollapsed(!panelCollapsed)}
            className="w-full flex items-center justify-between p-3 text-white hover:bg-white/5"
          >
            {!panelCollapsed && <span className="text-sm font-medium">工具面板</span>}
            {panelCollapsed ? <ChevronDown className="h-5 w-5 mx-auto" /> : <ChevronUp className="h-5 w-5" />}
          </button>

          {/* 面板内容 */}
          {!panelCollapsed && (
            <div className="p-3 pt-0 space-y-4">
              {/* 绘图工具 */}
              <div className="flex gap-2">
                <button
                  onClick={() => setTool('brush')}
                  disabled={isConfirming}
                  className={cn(
                    'flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg transition',
                    tool === 'brush'
                      ? 'bg-red-500 text-white'
                      : 'bg-white/10 text-white/70 hover:bg-white/20'
                  )}
                >
                  <Paintbrush className="h-4 w-4" />
                  <span className="text-xs">画笔</span>
                </button>
                <button
                  onClick={() => setTool('eraser')}
                  disabled={isConfirming}
                  className={cn(
                    'flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg transition',
                    tool === 'eraser'
                      ? 'bg-blue-500 text-white'
                      : 'bg-white/10 text-white/70 hover:bg-white/20'
                  )}
                >
                  <Eraser className="h-4 w-4" />
                  <span className="text-xs">橡皮</span>
                </button>
              </div>

              {/* 画笔大小 */}
              <div>
                <label className="block text-xs text-white/70 mb-1.5">
                  画笔: <span className="text-red-400">{brushSize}px</span>
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
              </div>

              {/* 操作按钮 */}
              <div className="flex gap-1.5">
                <button
                  onClick={handleUndo}
                  disabled={historyIndex <= 0 || isConfirming}
                  className="flex-1 flex items-center justify-center py-2 rounded-lg bg-white/10 text-white/70 hover:bg-white/20 disabled:opacity-30"
                  title="撤销"
                >
                  <Undo2 className="h-4 w-4" />
                </button>
                <button
                  onClick={handleRedo}
                  disabled={historyIndex >= history.length - 1 || isConfirming}
                  className="flex-1 flex items-center justify-center py-2 rounded-lg bg-white/10 text-white/70 hover:bg-white/20 disabled:opacity-30"
                  title="重做"
                >
                  <Redo2 className="h-4 w-4" />
                </button>
                <button
                  onClick={handleClear}
                  disabled={isConfirming}
                  className="flex-1 flex items-center justify-center py-2 rounded-lg bg-white/10 text-white/70 hover:bg-white/20 disabled:opacity-50"
                  title="清空"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>

              {/* 重绘提示词 */}
              {mode === 'inpaint' && (
                <div>
                  <label className="block text-xs text-white/70 mb-1.5">替换内容</label>
                  <textarea
                    value={prompt}
                    onChange={(e) => setPrompt(e.target.value)}
                    placeholder="描述要替换成什么..."
                    disabled={isConfirming}
                    className="w-full h-16 px-2.5 py-2 rounded-lg bg-white/10 text-white text-sm border border-white/10 resize-none placeholder:text-white/40 disabled:opacity-50"
                  />
                </div>
              )}

              {/* 模型选择 */}
              <div>
                <label className="block text-xs text-white/70 mb-1.5">模型</label>
                <select
                  value={selectedModel}
                  onChange={(e) => setSelectedModel(e.target.value)}
                  disabled={isConfirming}
                  className="w-full px-2.5 py-2 rounded-lg bg-white/10 text-white text-sm border border-white/10 disabled:opacity-50"
                >
                  {imageModels.map((m) => (
                    <option key={m.key} value={m.key} className="bg-gray-800">{m.label}</option>
                  ))}
                </select>
              </div>

              {/* 分辨率 */}
              <div>
                <label className="block text-xs text-white/70 mb-1.5">分辨率</label>
                <div className="flex gap-1.5">
                  {RESOLUTION_OPTIONS.map((r) => (
                    <button
                      key={r.key}
                      onClick={() => setSelectedResolution(r.key)}
                      disabled={isConfirming}
                      className={cn(
                        'flex-1 py-1.5 rounded-lg text-xs font-medium transition',
                        selectedResolution === r.key
                          ? 'bg-blue-500 text-white'
                          : 'bg-white/10 text-white/70 hover:bg-white/20'
                      )}
                    >
                      {r.key}
                    </button>
                  ))}
                </div>
              </div>

              {/* 确认按钮 */}
              <button
                onClick={handleConfirm}
                disabled={!canConfirm}
                className="w-full flex items-center justify-center gap-2 py-3 rounded-xl bg-red-500 text-white font-semibold hover:bg-red-600 disabled:opacity-50 transition"
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
          )}
        </div>
      </div>

      {/* 底部提示 */}
      {canvasReady && (
        <div className="absolute bottom-6 left-1/2 -translate-x-1/2 z-20 px-4 py-2 bg-red-600/90 text-white text-sm rounded-full shadow-lg">
          {mode === 'inpaint' ? '绘制要重绘的区域（红色区域将被替换）' : '绘制要擦除的区域（红色区域将被移除）'}
        </div>
      )}
    </div>
  )
})
