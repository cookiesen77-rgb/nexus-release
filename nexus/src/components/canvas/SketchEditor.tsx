/**
 * Sketch Editor | 草图编辑器
 * 涂鸦生图/生视频工具
 */

import React, { useState, useRef, useCallback, useEffect } from 'react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import {
  X,
  Brush,
  Eraser,
  Palette,
  Undo2,
  Trash2,
  Download,
  Layers,
  Image as ImageIcon,
  Video,
  Sparkles
} from 'lucide-react'

interface Props {
  open: boolean
  onClose: () => void
  onGenerate: (data: { sketch: string; prompt: string; mode: 'image' | 'video' }) => void
}

type Tool = 'brush' | 'eraser'
type Mode = 'image' | 'video'

const PRESET_COLORS = [
  '#000000', '#ffffff', '#ff0000', '#00ff00',
  '#0000ff', '#ffff00', '#ff00ff', '#00ffff',
  '#ff8800', '#8800ff', '#00ff88', '#ff0088',
  '#888888', '#444444', '#cccccc', '#ffcccc'
]

export default function SketchEditor({ open, onClose, onGenerate }: Props) {
  const [activeMode, setActiveMode] = useState<Mode>('image')
  const [tool, setTool] = useState<Tool>('brush')
  const [brushColor, setBrushColor] = useState('#000000')
  const [brushSize, setBrushSize] = useState(5)
  const [showPalette, setShowPalette] = useState(false)
  const [prompt, setPrompt] = useState('')
  const [backgroundImage, setBackgroundImage] = useState<string | null>(null)
  const [isGenerating, setIsGenerating] = useState(false)

  const canvasRef = useRef<HTMLCanvasElement>(null)
  const contextRef = useRef<CanvasRenderingContext2D | null>(null)
  const isDrawingRef = useRef(false)
  const historyRef = useRef<ImageData[]>([])
  const fileInputRef = useRef<HTMLInputElement>(null)

  // Initialize canvas
  useEffect(() => {
    if (!open) return
    const canvas = canvasRef.current
    if (!canvas) return

    const rect = canvas.getBoundingClientRect()
    canvas.width = rect.width * 2
    canvas.height = rect.height * 2

    const ctx = canvas.getContext('2d')
    if (!ctx) return

    ctx.scale(2, 2)
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, rect.width, rect.height)
    contextRef.current = ctx

    // Save initial state
    historyRef.current = [ctx.getImageData(0, 0, canvas.width, canvas.height)]
  }, [open])

  const getPointerPosition = useCallback((e: React.MouseEvent | React.TouchEvent) => {
    const canvas = canvasRef.current
    if (!canvas) return { x: 0, y: 0 }

    const rect = canvas.getBoundingClientRect()
    let clientX: number, clientY: number

    if ('touches' in e) {
      clientX = e.touches[0].clientX
      clientY = e.touches[0].clientY
    } else {
      clientX = e.clientX
      clientY = e.clientY
    }

    return {
      x: clientX - rect.left,
      y: clientY - rect.top
    }
  }, [])

  const startDrawing = useCallback((e: React.MouseEvent | React.TouchEvent) => {
    const ctx = contextRef.current
    if (!ctx) return

    isDrawingRef.current = true
    const { x, y } = getPointerPosition(e)

    ctx.beginPath()
    ctx.moveTo(x, y)
    ctx.strokeStyle = tool === 'eraser' ? '#ffffff' : brushColor
    ctx.lineWidth = tool === 'eraser' ? brushSize * 3 : brushSize
  }, [tool, brushColor, brushSize, getPointerPosition])

  const draw = useCallback((e: React.MouseEvent | React.TouchEvent) => {
    if (!isDrawingRef.current) return
    const ctx = contextRef.current
    if (!ctx) return

    const { x, y } = getPointerPosition(e)
    ctx.lineTo(x, y)
    ctx.stroke()
  }, [getPointerPosition])

  const stopDrawing = useCallback(() => {
    if (!isDrawingRef.current) return
    isDrawingRef.current = false

    const ctx = contextRef.current
    const canvas = canvasRef.current
    if (!ctx || !canvas) return

    ctx.closePath()
    historyRef.current.push(ctx.getImageData(0, 0, canvas.width, canvas.height))
    if (historyRef.current.length > 50) {
      historyRef.current.shift()
    }
  }, [])

  const handleUndo = useCallback(() => {
    if (historyRef.current.length <= 1) return
    const ctx = contextRef.current
    const canvas = canvasRef.current
    if (!ctx || !canvas) return

    historyRef.current.pop()
    const prevState = historyRef.current[historyRef.current.length - 1]
    if (prevState) {
      ctx.putImageData(prevState, 0, 0)
    }
  }, [])

  const handleClear = useCallback(() => {
    const ctx = contextRef.current
    const canvas = canvasRef.current
    if (!ctx || !canvas) return

    const rect = canvas.getBoundingClientRect()
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, rect.width, rect.height)
    historyRef.current = [ctx.getImageData(0, 0, canvas.width, canvas.height)]
  }, [])

  const handleImportBackground = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    const reader = new FileReader()
    reader.onload = (ev) => {
      const result = ev.target?.result
      if (typeof result === 'string') {
        setBackgroundImage(result)
      }
    }
    reader.readAsDataURL(file)
    e.target.value = ''
  }, [])

  const handleDownload = useCallback(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    const link = document.createElement('a')
    link.download = `sketch_${Date.now()}.png`
    link.href = canvas.toDataURL('image/png')
    link.click()
  }, [])

  const handleGenerate = useCallback(async () => {
    if (!prompt.trim() || isGenerating) return
    const canvas = canvasRef.current
    if (!canvas) return

    setIsGenerating(true)
    try {
      const sketch = canvas.toDataURL('image/png')
      onGenerate({ sketch, prompt, mode: activeMode })
      onClose()
    } finally {
      setIsGenerating(false)
    }
  }, [prompt, activeMode, isGenerating, onGenerate, onClose])

  const selectColor = (color: string) => {
    setBrushColor(color)
    setShowPalette(false)
    setTool('brush')
  }

  if (!open) return null

  const modes = [
    { id: 'image' as const, label: '涂鸦生图', icon: ImageIcon },
    { id: 'video' as const, label: '涂鸦生视频', icon: Video }
  ]

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-[#0a0a0c]">
      {/* Top Navigation */}
      <div className="flex h-14 items-center justify-between border-b border-white/10 bg-[#1c1c1e] px-6">
        <button
          onClick={onClose}
          className="absolute left-6 rounded-full bg-white/5 p-2 text-slate-400 transition-colors hover:bg-white/10 hover:text-white"
        >
          <X className="h-4 w-4" />
        </button>

        <div className="flex flex-1 justify-center">
          <div className="flex rounded-lg bg-black/30 p-1">
            {modes.map((mode) => (
              <button
                key={mode.id}
                onClick={() => setActiveMode(mode.id)}
                className={cn(
                  'flex items-center gap-2 rounded-md px-6 py-1.5 text-xs font-bold transition-all',
                  activeMode === mode.id
                    ? 'bg-white/10 text-white shadow-sm'
                    : 'text-slate-500 hover:text-slate-300'
                )}
              >
                <mode.icon className="h-3 w-3" />
                {mode.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Main Canvas Area */}
      <div className="relative flex flex-1 items-center justify-center overflow-hidden bg-[#121214] p-8">
        {/* Floating Toolbar */}
        <div className="absolute left-1/2 top-12 z-20 flex -translate-x-1/2 items-center gap-2 rounded-full border border-white/10 bg-[#2c2c2e]/90 p-1.5 shadow-2xl backdrop-blur-xl">
          <button
            onClick={() => setTool('brush')}
            className={cn(
              'rounded-full p-2.5 transition-colors',
              tool === 'brush' ? 'bg-cyan-500 text-black' : 'text-slate-400 hover:bg-white/5 hover:text-white'
            )}
            title="画笔"
          >
            <Brush className="h-4 w-4" />
          </button>

          <button
            onClick={() => setTool('eraser')}
            className={cn(
              'rounded-full p-2.5 transition-colors',
              tool === 'eraser' ? 'bg-cyan-500 text-black' : 'text-slate-400 hover:bg-white/5 hover:text-white'
            )}
            title="橡皮擦"
          >
            <Eraser className="h-4 w-4" />
          </button>

          <div className="mx-1 h-6 w-px bg-white/10" />

          <div className="relative">
            <button
              onClick={() => setShowPalette(!showPalette)}
              className="relative rounded-full p-2.5 text-slate-400 transition-colors hover:bg-white/5 hover:text-white"
              title="调色板"
            >
              <Palette className="h-4 w-4" />
              <div
                className="absolute bottom-1 right-1 h-2 w-2 rounded-full border border-[#2c2c2e]"
                style={{ backgroundColor: brushColor }}
              />
            </button>

            {showPalette && (
              <div className="absolute left-1/2 top-full z-30 mt-3 grid w-48 -translate-x-1/2 grid-cols-4 gap-2 rounded-xl border border-white/10 bg-[#1c1c1e] p-3 shadow-xl">
                {PRESET_COLORS.map((c) => (
                  <button
                    key={c}
                    onClick={() => selectColor(c)}
                    className={cn(
                      'h-8 w-8 rounded-full border-2',
                      brushColor === c ? 'border-white' : 'border-transparent hover:scale-110'
                    )}
                    style={{ backgroundColor: c }}
                  />
                ))}
              </div>
            )}
          </div>

          <div className="mx-1 h-6 w-px bg-white/10" />

          <button
            onClick={handleUndo}
            className="rounded-full p-2.5 text-slate-400 hover:bg-white/5 hover:text-white"
            title="撤销"
          >
            <Undo2 className="h-4 w-4" />
          </button>

          <button
            onClick={handleClear}
            className="rounded-full p-2.5 text-red-400 hover:bg-red-500/10"
            title="清空"
          >
            <Trash2 className="h-4 w-4" />
          </button>
        </div>

        {/* Canvas Wrapper */}
        <div
          className="relative select-none overflow-hidden rounded-lg border border-white/5 bg-white shadow-2xl"
          style={{ aspectRatio: '16/9', height: '100%', maxHeight: '800px' }}
        >
          {backgroundImage && (
            <img
              src={backgroundImage}
              className="pointer-events-none absolute inset-0 h-full w-full object-contain opacity-50"
              draggable={false}
            />
          )}
          <canvas
            ref={canvasRef}
            className="absolute inset-0 h-full w-full cursor-crosshair touch-none"
            onMouseDown={startDrawing}
            onMouseMove={draw}
            onMouseUp={stopDrawing}
            onMouseLeave={stopDrawing}
            onTouchStart={startDrawing}
            onTouchMove={draw}
            onTouchEnd={stopDrawing}
          />
        </div>
      </div>

      {/* Bottom Control Bar */}
      <div className="flex h-20 items-center gap-4 border-t border-white/10 bg-[#1c1c1e] px-8">
        <div className="mr-4 flex items-center gap-2">
          <input
            ref={fileInputRef}
            type="file"
            className="hidden"
            accept="image/*"
            onChange={handleImportBackground}
          />
          <button
            onClick={() => fileInputRef.current?.click()}
            className="rounded-lg border border-white/5 bg-white/5 p-2 text-slate-400 transition-colors hover:bg-white/10 hover:text-white"
            title="导入底图"
          >
            <Layers className="h-4 w-4" />
          </button>
          <button
            onClick={handleDownload}
            className="rounded-lg border border-white/5 bg-white/5 p-2 text-slate-400 hover:text-white"
            title="下载当前画布"
          >
            <Download className="h-4 w-4" />
          </button>
        </div>

        <input
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          type="text"
          placeholder="描述画面内容 (e.g. A beautiful sunset over mountains)..."
          className="h-11 flex-1 rounded-xl border border-white/10 bg-black/30 px-4 text-sm text-white placeholder-slate-500 transition-colors focus:border-cyan-500/50 focus:outline-none"
          onKeyDown={(e) => e.key === 'Enter' && handleGenerate()}
        />

        <div className="flex items-center gap-3">
          <div className="flex h-11 items-center gap-2 rounded-xl border border-white/10 bg-black/30 px-4 text-xs font-medium text-slate-300">
            <span>{activeMode === 'video' ? 'Veo 3.1 Fast' : 'Gemini 2.5'}</span>
          </div>

          <div className="mx-2 h-6 w-px bg-white/10" />

          <Button
            onClick={handleGenerate}
            disabled={isGenerating || !prompt.trim()}
            className={cn(
              'h-11 rounded-xl px-6 font-bold',
              activeMode === 'video'
                ? 'bg-gradient-to-r from-purple-500 to-pink-500'
                : 'bg-gradient-to-r from-cyan-600 to-blue-600'
            )}
          >
            <Sparkles className="mr-2 h-4 w-4" />
            {isGenerating ? '生成中...' : activeMode === 'video' ? '生成视频' : '生成图片'}
          </Button>
        </div>
      </div>
    </div>
  )
}
