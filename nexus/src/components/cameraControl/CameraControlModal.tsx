/**
 * Camera Control Modal
 * 多角度相机控制模态框 - 类似导演台的风格
 */

import { useState, useCallback, useRef } from 'react'
import { X, Upload, Image as ImageIcon, Loader2, ArrowUpToLine, Download, Camera, Aperture, ZoomIn } from 'lucide-react'
import { cn } from '@/lib/utils'
import Camera3DController from './Camera3DController'
import ShortDramaMediaPickerModal from '@/components/shortDrama/ShortDramaMediaPickerModal'
import { useGraphStore } from '@/graph/store'
import { useAssetsStore } from '@/store/assets'
import { saveMedia } from '@/lib/mediaStorage'
import { postJson } from '@/lib/workflow/request'
import { IMAGE_MODELS } from '@/config/models'
import type { CameraParams } from '@/lib/cameraControl/promptBuilder'
import { DEFAULT_CAMERA_PARAMS, buildCameraPrompt } from '@/lib/cameraControl/promptBuilder'

const NANO_BANANA_PRO = IMAGE_MODELS.find((m) => m.key === 'gemini-3-pro-image-preview')

const RATIO_OPTIONS = ['1:1', '16:9', '9:16', '4:3', '3:4']
const QUALITY_OPTIONS = [
  { label: '1K', key: '1K' },
  { label: '2K', key: '2K' },
  { label: '4K', key: '4K' },
]

const isTauri = typeof window !== 'undefined' && !!(window as any).__TAURI_INTERNALS__

interface Props {
  open: boolean
  onClose: () => void
  projectId?: string
}

export default function CameraControlModal({ open, onClose, projectId }: Props) {
  const addNode = useGraphStore((s) => s.addNode)

  const [sourceImage, setSourceImage] = useState<{ url: string; label: string } | null>(null)
  const [cameraParams, setCameraParams] = useState<CameraParams>(DEFAULT_CAMERA_PARAMS)
  const [ratio, setRatio] = useState('1:1')
  const [quality, setQuality] = useState('2K')
  const [generating, setGenerating] = useState(false)
  const [generatedImage, setGeneratedImage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [pickerOpen, setPickerOpen] = useState(false)

  const fileInputRef = useRef<HTMLInputElement>(null)

  const handleConfirmPicker = useCallback((items: any[]) => {
    if (items.length > 0) {
      const item = items[0]
      const url = item.sourceUrl || item.displayUrl || item.src || ''
      setSourceImage({ url, label: item.label || '参考图' })
      setGeneratedImage(null)
      setError(null)
    }
    setPickerOpen(false)
  }, [])

  const handleFileChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = (ev) => {
      const dataUrl = ev.target?.result as string
      setSourceImage({ url: dataUrl, label: file.name })
      setGeneratedImage(null)
      setError(null)
    }
    reader.readAsDataURL(file)
    e.target.value = ''
  }, [])

  const resolveImageToInlineData = async (input: string): Promise<{ mimeType: string; data: string } | null> => {
    if (!input) return null
    if (input.startsWith('data:')) {
      const match = input.match(/^data:([^;]+);base64,(.+)$/)
      if (match) return { mimeType: match[1], data: match[2] }
      return null
    }
    if (input.startsWith('http://') || input.startsWith('https://')) {
      try {
        const fetchFn = isTauri ? (await import('@tauri-apps/plugin-http')).fetch : globalThis.fetch
        const resp = await fetchFn(input)
        const blob = await resp.blob()
        const arrayBuffer = await blob.arrayBuffer()
        const base64 = btoa(new Uint8Array(arrayBuffer).reduce((data, byte) => data + String.fromCharCode(byte), ''))
        return { mimeType: blob.type || 'image/png', data: base64 }
      } catch {
        return null
      }
    }
    return null
  }

  const handleGenerate = useCallback(async () => {
    if (!sourceImage?.url) {
      setError('请先选择参考图片')
      return
    }
    if (!NANO_BANANA_PRO) {
      setError('未找到模型配置')
      return
    }

    setGenerating(true)
    setError(null)
    setGeneratedImage(null)

    try {
      const cameraPrompt = buildCameraPrompt(cameraParams)
      const inlineData = await resolveImageToInlineData(sourceImage.url)
      if (!inlineData) throw new Error('无法处理参考图片')

      const payload = {
        contents: [{
          role: 'user',
          parts: [
            { text: cameraPrompt },
            { inline_data: { mime_type: inlineData.mimeType, data: inlineData.data } }
          ]
        }],
        generationConfig: {
          responseModalities: ['IMAGE'],
          imageConfig: { aspectRatio: ratio, imageSize: quality }
        }
      }

      const rsp = await postJson<any>(NANO_BANANA_PRO.endpoint, payload, {
        authMode: NANO_BANANA_PRO.authMode,
        timeoutMs: (NANO_BANANA_PRO as any).timeout || 240000
      })

      const parts = rsp?.candidates?.[0]?.content?.parts || []
      const inlineResult = parts.map((p: any) => p.inlineData || p.inline_data).filter(Boolean)[0]

      if (inlineResult?.data) {
        const mimeType = inlineResult.mimeType || inlineResult.mime_type || 'image/png'
        setGeneratedImage(`data:${mimeType};base64,${inlineResult.data}`)
      } else {
        throw new Error('生成失败：未返回图片数据')
      }
    } catch (err: any) {
      setError(err.message || '生成失败')
    } finally {
      setGenerating(false)
    }
  }, [sourceImage, cameraParams, ratio, quality])

  const handleAddToCanvas = useCallback(async () => {
    if (!generatedImage) return
    try {
      const nodeId = `camera_${Date.now()}`
      const mediaId = await saveMedia({
        nodeId,
        projectId: projectId || 'default',
        type: 'image',
        data: generatedImage,
        model: 'nano-banana-pro'
      })

      addNode('image', { x: 100, y: 100 }, {
        label: '多角度生成图',
        url: generatedImage,
        sourceUrl: generatedImage,
        mediaId,
        createdAt: Date.now()
      })

      useAssetsStore.getState().addAsset({
        type: 'image',
        src: generatedImage,
        title: '多角度生成图',
        model: 'nano-banana-pro'
      })

      onClose()
    } catch {
      setError('添加到画布失败')
    }
  }, [generatedImage, addNode, projectId, onClose])

  const handleDownload = useCallback(() => {
    if (!generatedImage) return
    const link = document.createElement('a')
    link.href = generatedImage
    link.download = `camera-control-${Date.now()}.png`
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
  }, [generatedImage])

  const prompt = buildCameraPrompt(cameraParams)

  if (!open) return null

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div
        className="flex h-[min(85vh,750px)] w-[min(1000px,95vw)] flex-col overflow-hidden rounded-2xl border border-[var(--border-color)] bg-[var(--bg-secondary)] shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-[var(--border-color)] px-5 py-3">
          <div className="flex items-center gap-3">
            <Camera className="h-5 w-5 text-[var(--accent-color)]" />
            <h2 className="text-base font-semibold text-[var(--text-primary)]">多角度相机控制</h2>
            <span className="text-xs text-[var(--text-secondary)]">360° 全方位调整</span>
          </div>
          <button
            onClick={onClose}
            className="rounded-full p-1.5 text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-primary)] hover:text-[var(--text-primary)]"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Body */}
        <div className="flex flex-1 overflow-hidden">
          {/* 左侧：3D控制器（主要区域） */}
          <div className="w-[420px] flex-shrink-0 border-r border-[var(--border-color)] p-4 flex flex-col">
            {/* 3D相机控制 - 主角 */}
            <div className="flex-1 rounded-xl overflow-hidden bg-[#111111]">
              <Camera3DController
                imageUrl={sourceImage?.url}
                value={cameraParams}
                onChange={setCameraParams}
                disabled={generating}
              />
            </div>

            {/* 参数显示 */}
            <div className="grid grid-cols-4 gap-2 mt-3">
              <div className="rounded-lg bg-[var(--bg-primary)] p-2 text-center">
                <div className="text-[10px] text-[var(--text-secondary)]">水平旋转</div>
                <div className="text-sm font-medium text-green-400">{cameraParams.rotateAngle}°</div>
              </div>
              <div className="rounded-lg bg-[var(--bg-primary)] p-2 text-center">
                <div className="text-[10px] text-[var(--text-secondary)]">垂直俯仰</div>
                <div className="text-sm font-medium text-pink-400">{(cameraParams.verticalAngle * 100).toFixed(0)}%</div>
              </div>
              <div className="rounded-lg bg-[var(--bg-primary)] p-2 text-center">
                <div className="text-[10px] text-[var(--text-secondary)]">推进距离</div>
                <div className="text-sm font-medium text-yellow-400">{cameraParams.moveForward.toFixed(1)}</div>
              </div>
              <button
                onClick={() => setCameraParams(p => ({ ...p, wideAngle: !p.wideAngle }))}
                disabled={generating}
                className={cn(
                  'rounded-lg p-2 text-center transition-colors',
                  cameraParams.wideAngle
                    ? 'bg-blue-500/20 text-blue-400'
                    : 'bg-[var(--bg-primary)] text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)]'
                )}
              >
                <Aperture className="h-4 w-4 mx-auto" />
                <div className="text-[10px] mt-0.5">广角</div>
              </button>
            </div>

            {/* 提示词预览 */}
            <div className="mt-3 rounded-lg bg-[var(--bg-primary)] p-2.5">
              <div className="text-[10px] text-[var(--text-secondary)] mb-1">生成提示词</div>
              <div className="text-xs text-[var(--text-primary)] leading-relaxed line-clamp-2">{prompt}</div>
            </div>
          </div>

          {/* 右侧：图片选择 + 设置 + 结果 */}
          <div className="flex-1 p-4 flex flex-col gap-3 min-w-0 overflow-auto">
            {/* 参考图片 */}
            <div className="rounded-xl border border-[var(--border-color)] bg-[var(--bg-primary)] p-3">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-medium text-[var(--text-secondary)]">参考图片</span>
                <div className="flex gap-1.5">
                  <button
                    onClick={() => setPickerOpen(true)}
                    className="px-2 py-1 text-[10px] rounded bg-[var(--bg-secondary)] text-[var(--text-primary)] hover:bg-[var(--bg-tertiary)] transition-colors"
                  >
                    选择素材
                  </button>
                  <button
                    onClick={() => fileInputRef.current?.click()}
                    className="flex items-center gap-1 px-2 py-1 text-[10px] rounded bg-[var(--bg-secondary)] text-[var(--text-primary)] hover:bg-[var(--bg-tertiary)] transition-colors"
                  >
                    <Upload className="h-3 w-3" />
                    上传
                  </button>
                </div>
              </div>
              {sourceImage ? (
                <div className="relative h-28 rounded-lg overflow-hidden bg-black">
                  <img src={sourceImage.url} alt="" className="h-full w-full object-contain" />
                  <button
                    onClick={() => setSourceImage(null)}
                    className="absolute top-1 right-1 h-5 w-5 rounded-full bg-black/60 flex items-center justify-center text-white text-xs hover:bg-black/80"
                  >
                    ×
                  </button>
                </div>
              ) : (
                <div
                  className="h-28 rounded-lg border-2 border-dashed border-[var(--border-color)] flex flex-col items-center justify-center text-[var(--text-secondary)] cursor-pointer hover:border-[var(--accent-color)] hover:text-[var(--accent-color)] transition-colors"
                  onClick={() => setPickerOpen(true)}
                >
                  <ImageIcon className="h-8 w-8 mb-1 opacity-40" />
                  <span className="text-xs">点击选择图片</span>
                </div>
              )}
            </div>

            {/* 设置行 */}
            <div className="flex gap-3">
              <div className="flex-1 rounded-xl border border-[var(--border-color)] bg-[var(--bg-primary)] p-3">
                <div className="mb-2 text-xs font-medium text-[var(--text-secondary)]">输出比例</div>
                <div className="flex flex-wrap gap-1.5">
                  {RATIO_OPTIONS.map((r) => (
                    <button
                      key={r}
                      onClick={() => setRatio(r)}
                      disabled={generating}
                      className={cn(
                        'px-2.5 py-1 rounded text-xs transition-colors',
                        ratio === r
                          ? 'bg-[var(--accent-color)] text-white'
                          : 'bg-[var(--bg-secondary)] text-[var(--text-primary)] hover:bg-[var(--bg-tertiary)]'
                      )}
                    >
                      {r}
                    </button>
                  ))}
                </div>
              </div>
              <div className="w-[130px] rounded-xl border border-[var(--border-color)] bg-[var(--bg-primary)] p-3">
                <div className="mb-2 text-xs font-medium text-[var(--text-secondary)]">分辨率</div>
                <div className="flex gap-1.5">
                  {QUALITY_OPTIONS.map((q) => (
                    <button
                      key={q.key}
                      onClick={() => setQuality(q.key)}
                      disabled={generating}
                      className={cn(
                        'flex-1 py-1 rounded text-xs transition-colors',
                        quality === q.key
                          ? 'bg-[var(--accent-color)] text-white'
                          : 'bg-[var(--bg-secondary)] text-[var(--text-primary)] hover:bg-[var(--bg-tertiary)]'
                      )}
                    >
                      {q.label}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {/* 生成结果 */}
            <div className="flex-1 rounded-xl border border-[var(--border-color)] bg-[var(--bg-primary)] p-3 flex flex-col min-h-0">
              <div className="mb-2 text-xs font-medium text-[var(--text-secondary)]">生成结果</div>

              {error && (
                <div className="mb-2 p-2 rounded-lg bg-red-500/10 border border-red-500/30 text-red-400 text-xs">
                  {error}
                </div>
              )}

              <div className="flex-1 rounded-lg bg-black overflow-hidden flex items-center justify-center min-h-[180px]">
                {generating ? (
                  <div className="text-center text-zinc-500">
                    <Loader2 className="h-8 w-8 animate-spin mx-auto mb-2" />
                    <p className="text-xs">正在生成...</p>
                  </div>
                ) : generatedImage ? (
                  <img src={generatedImage} alt="" className="max-w-full max-h-full object-contain" />
                ) : (
                  <div className="text-center text-zinc-600">
                    <ZoomIn className="h-10 w-10 mx-auto mb-2 opacity-30" />
                    <p className="text-xs">调整相机角度后点击生成</p>
                  </div>
                )}
              </div>

              {/* 操作按钮 */}
              <div className="flex gap-2 mt-3">
                <button
                  onClick={handleGenerate}
                  disabled={!sourceImage || generating}
                  className="flex-1 py-2.5 rounded-lg bg-[var(--accent-color)] text-white font-medium text-sm hover:bg-[var(--accent-hover)] disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center justify-center gap-2"
                >
                  {generating ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" />
                      生成中...
                    </>
                  ) : (
                    '生成图片'
                  )}
                </button>
                {generatedImage && (
                  <>
                    <button
                      onClick={handleAddToCanvas}
                      className="py-2.5 px-4 rounded-lg bg-green-500/20 text-green-400 text-sm hover:bg-green-500/30 transition-colors flex items-center gap-1.5"
                    >
                      <ArrowUpToLine className="h-4 w-4" />
                      上画布
                    </button>
                    <button
                      onClick={handleDownload}
                      className="py-2.5 px-3 rounded-lg bg-[var(--bg-secondary)] text-[var(--text-primary)] hover:bg-[var(--bg-tertiary)] transition-colors"
                      title="保存到本地"
                    >
                      <Download className="h-4 w-4" />
                    </button>
                  </>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* 隐藏的文件输入 */}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        onChange={handleFileChange}
        className="hidden"
      />

      {/* 媒体选择器 */}
      <ShortDramaMediaPickerModal
        open={pickerOpen}
        onClose={() => setPickerOpen(false)}
        title="选择参考图片"
        multiple={false}
        kinds={['image']}
        onConfirm={handleConfirmPicker}
      />
    </div>
  )
}
