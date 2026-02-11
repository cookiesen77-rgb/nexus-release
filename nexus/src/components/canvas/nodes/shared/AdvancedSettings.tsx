import React, { memo, useState, useCallback, useRef, useMemo } from 'react'
import { ChevronDown, ChevronUp, Upload, X, Image as ImageIcon } from 'lucide-react'
import { saveMedia } from '@/lib/mediaStorage'
import { useGraphStore } from '@/graph/store'

interface AdvancedSettingsProps {
  mode: 'image' | 'video'
  // Duration (video)
  durOptions?: Array<{ label: string; key: number }>
  dur?: number
  onDurChange?: (v: number) => void
  // Size (video, e.g. Sora pixel sizes)
  sizeOptions?: Array<{ label: string; key: string }>
  size?: string
  onSizeChange?: (v: string) => void
  // Resolution (video)
  resolutionOptions?: Array<{ label: string; key: string }>
  resolution?: string
  onResolutionChange?: (v: string) => void
  // First/Last frame (video)
  firstFrameUrl?: string
  onFirstFrameChange?: (url: string, mediaId?: string) => void
  onFirstFrameClear?: () => void
  lastFrameUrl?: string
  onLastFrameChange?: (url: string, mediaId?: string) => void
  onLastFrameClear?: () => void
  supportsFirstFrame?: boolean
  supportsLastFrame?: boolean
  // Audio (video, Vidu)
  supportsAudio?: boolean
  audioEnabled?: boolean
  onAudioToggle?: (v: boolean) => void
  // Tips
  tips?: string
}

export const AdvancedSettings = memo(function AdvancedSettings(props: AdvancedSettingsProps) {
  const [open, setOpen] = useState(false)

  const hasVideoControls = props.mode === 'video' && (
    props.durOptions?.length ||
    props.sizeOptions?.length ||
    props.resolutionOptions?.length ||
    props.supportsFirstFrame ||
    props.supportsLastFrame ||
    props.supportsAudio
  )

  const hasContent = hasVideoControls || props.tips

  if (!hasContent) return null

  return (
    <div onClick={e => e.stopPropagation()}>
      <button
        onClick={(e) => { e.stopPropagation(); setOpen(!open) }}
        className="flex items-center gap-1 w-full px-1 py-1.5 text-xs text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors"
      >
        {open ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
        <span>高级设置</span>
      </button>

      {open && (
        <div className="space-y-2 pb-2 px-0.5">
          {/* Duration */}
          {props.durOptions && props.durOptions.length > 0 && (
            <Row label="时长">
              <div className="flex gap-1">
                {props.durOptions.map(o => (
                  <button
                    key={o.key}
                    onClick={(e) => { e.stopPropagation(); props.onDurChange?.(o.key) }}
                    className={`px-2 py-0.5 text-xs rounded ${
                      props.dur === o.key
                        ? 'bg-[var(--accent-color)] text-white'
                        : 'bg-[var(--bg-tertiary)] text-[var(--text-primary)] border border-[var(--border-color)]'
                    }`}
                  >
                    {o.label}
                  </button>
                ))}
              </div>
            </Row>
          )}

          {/* Size */}
          {props.sizeOptions && props.sizeOptions.length > 0 && (
            <Row label="尺寸">
              <select
                value={props.size || ''}
                onChange={(e) => { e.stopPropagation(); props.onSizeChange?.(e.target.value) }}
                onClick={e => e.stopPropagation()}
                className="text-xs px-2 py-1 rounded border border-[var(--border-color)] bg-[var(--bg-tertiary)] text-[var(--text-primary)] outline-none"
              >
                {props.sizeOptions.map(o => (
                  <option key={o.key} value={o.key}>{o.label}</option>
                ))}
              </select>
            </Row>
          )}

          {/* Resolution */}
          {props.resolutionOptions && props.resolutionOptions.length > 0 && (
            <Row label="分辨率">
              <select
                value={props.resolution || ''}
                onChange={(e) => { e.stopPropagation(); props.onResolutionChange?.(e.target.value) }}
                onClick={e => e.stopPropagation()}
                className="text-xs px-2 py-1 rounded border border-[var(--border-color)] bg-[var(--bg-tertiary)] text-[var(--text-primary)] outline-none"
              >
                {props.resolutionOptions.map(o => (
                  <option key={o.key} value={o.key}>{o.label}</option>
                ))}
              </select>
            </Row>
          )}

          {/* First frame */}
          {props.supportsFirstFrame && (
            <Row label="首帧">
              <FrameUpload
                url={props.firstFrameUrl}
                onChange={props.onFirstFrameChange}
                onClear={props.onFirstFrameClear}
              />
            </Row>
          )}

          {/* Last frame */}
          {props.supportsLastFrame && (
            <Row label="尾帧">
              <FrameUpload
                url={props.lastFrameUrl}
                onChange={props.onLastFrameChange}
                onClear={props.onLastFrameClear}
              />
            </Row>
          )}

          {/* Audio toggle */}
          {props.supportsAudio && (
            <Row label="音频">
              <label className="flex items-center gap-1.5 cursor-pointer" onClick={e => e.stopPropagation()}>
                <input
                  type="checkbox"
                  checked={props.audioEnabled || false}
                  onChange={(e) => { e.stopPropagation(); props.onAudioToggle?.(e.target.checked) }}
                  className="w-3.5 h-3.5 rounded border-[var(--border-color)] accent-[var(--accent-color)]"
                />
                <span className="text-xs text-[var(--text-primary)]">生成音频</span>
              </label>
            </Row>
          )}

          {/* Tips */}
          {props.tips && (
            <div className="text-[10px] text-[var(--text-secondary)] opacity-70 px-1 leading-relaxed">
              {props.tips}
            </div>
          )}
        </div>
      )}
    </div>
  )
})

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-xs text-[var(--text-secondary)] w-10 flex-shrink-0 text-right">{label}</span>
      <div className="flex-1">{children}</div>
    </div>
  )
}

function FrameUpload({ url, onChange, onClear }: {
  url?: string
  onChange?: (url: string, mediaId?: string) => void
  onClear?: () => void
}) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [showPicker, setShowPicker] = useState(false)
  const btnRef = useRef<HTMLButtonElement>(null)

  const canvasImages = useMemo(() => {
    return useGraphStore.getState().nodes
      .filter(n => n.type === 'image' && n.data?.url)
      .map(n => ({ id: n.id, src: String(n.data?.url || ''), title: String(n.data?.label || '画布图片') }))
  }, [showPicker])

  const handleFile = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    e.stopPropagation()
    const file = e.target.files?.[0]
    if (!file || !onChange) return
    const reader = new FileReader()
    reader.onload = async () => {
      const dataUrl = reader.result as string
      let mediaId: string | undefined
      try {
        mediaId = await saveMedia({ nodeId: '', projectId: '', type: 'image', data: dataUrl, sourceUrl: '' })
      } catch {}
      onChange(dataUrl, mediaId)
    }
    reader.readAsDataURL(file)
    if (inputRef.current) inputRef.current.value = ''
  }, [onChange])

  const handlePickCanvas = useCallback((src: string) => {
    onChange?.(src)
    setShowPicker(false)
  }, [onChange])

  if (url) {
    return (
      <div className="relative w-16 h-10 rounded overflow-hidden border border-[var(--border-color)] group">
        <img src={url} alt="" className="w-full h-full object-cover" draggable={false} />
        <button
          onClick={(e) => { e.stopPropagation(); onClear?.() }}
          className="absolute top-0 right-0 w-4 h-4 bg-black/60 flex items-center justify-center rounded-bl opacity-0 group-hover:opacity-100 transition-opacity"
        >
          <X size={8} className="text-white" />
        </button>
      </div>
    )
  }

  return (
    <div className="relative flex items-center gap-1">
      <label className="flex items-center gap-1 px-2 py-1 text-xs rounded border border-dashed border-[var(--border-color)] hover:border-[var(--accent-color)] cursor-pointer transition-colors" onClick={e => e.stopPropagation()}>
        <Upload size={10} />
        <span className="text-[var(--text-secondary)]">上传</span>
        <input ref={inputRef} type="file" accept="image/*" onChange={handleFile} className="hidden" />
      </label>
      <button
        ref={btnRef}
        onClick={(e) => { e.stopPropagation(); setShowPicker(!showPicker) }}
        className="flex items-center gap-1 px-2 py-1 text-xs rounded border border-dashed border-[var(--border-color)] hover:border-[var(--accent-color)] transition-colors"
        title="从画布选择"
      >
        <ImageIcon size={10} />
        <span className="text-[var(--text-secondary)]">画布</span>
      </button>
      {showPicker && (
        <>
          <div className="fixed inset-0 z-[998]" onClick={(e) => { e.stopPropagation(); setShowPicker(false) }} />
          <div
            className="absolute left-0 top-full mt-1 z-[999] bg-[var(--bg-primary)] border border-[var(--border-color)] rounded-lg shadow-xl p-1.5 grid grid-cols-4 gap-1"
            style={{ width: 220, maxHeight: 180, overflowY: 'auto' }}
            onClick={e => e.stopPropagation()}
          >
            {canvasImages.length === 0 && (
              <div className="col-span-4 py-3 text-center text-[10px] text-[var(--text-secondary)]">画布无图片</div>
            )}
            {canvasImages.map(img => (
              <button
                key={img.id}
                onClick={(e) => { e.stopPropagation(); handlePickCanvas(img.src) }}
                className="w-full aspect-square rounded overflow-hidden border border-[var(--border-color)] hover:border-[var(--accent-color)] transition-colors bg-black/10"
                title={img.title}
              >
                <img src={img.src} alt="" className="w-full h-full object-cover" draggable={false} />
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  )
}
