import React, { useState, useCallback, useRef, useEffect } from 'react'
import { X, Download, Loader2, AlertTriangle, Film, CheckCircle2, Clock } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { ShortDramaRenderer, getResolution, saveRenderedVideo, type RenderProgress } from '@/lib/shortDrama/videoRenderer'
import type { ShortDramaDraftV2 } from '@/lib/shortDrama/types'

interface Props {
  open: boolean
  onClose: () => void
  draft: ShortDramaDraftV2
  currentEpisodeId?: string | null
}

const RESOLUTIONS = [
  { label: '720p', value: '720p' },
  { label: '1080p', value: '1080p' },
  { label: '4K', value: '4k' },
]

const RATIOS = [
  { label: '16:9 横屏', value: '16:9' },
  { label: '9:16 竖屏', value: '9:16' },
  { label: '1:1 方形', value: '1:1' },
]

const PHASE_LABELS: Record<string, string> = {
  preparing: '准备中...',
  composing: '合成片段...',
  encoding: '编码输出...',
  done: '完成!',
  cancelled: '已取消',
}

const PHASE_ICONS: Record<string, React.ReactNode> = {
  preparing: <Clock className="h-3.5 w-3.5 animate-pulse" />,
  composing: <Film className="h-3.5 w-3.5 animate-pulse" />,
  encoding: <Loader2 className="h-3.5 w-3.5 animate-spin" />,
  done: <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400" />,
  cancelled: <X className="h-3.5 w-3.5 text-[var(--text-secondary)]" />,
}

const shimmerKeyframes = `
@keyframes render-shimmer {
  0% { transform: translateX(-100%); }
  100% { transform: translateX(200%); }
}
@keyframes modal-enter {
  from { opacity: 0; transform: scale(0.95); }
  to { opacity: 1; transform: scale(1); }
}
`

export default function ShortDramaRenderModal({ open, onClose, draft, currentEpisodeId }: Props) {
  const [resolution, setResolution] = useState('1080p')
  const [ratio, setRatio] = useState('16:9')
  const [includeDialogue, setIncludeDialogue] = useState(true)
  const [includeNarration, setIncludeNarration] = useState(true)
  const [includeBGM, setIncludeBGM] = useState(true)
  const [includeSubtitles, setIncludeSubtitles] = useState(true)

  const [rendering, setRendering] = useState(false)
  const [progress, setProgress] = useState<RenderProgress | null>(null)
  const [error, setError] = useState<string | null>(null)
  const rendererRef = useRef<ShortDramaRenderer | null>(null)
  const styleRef = useRef<HTMLStyleElement | null>(null)

  useEffect(() => {
    if (!open) return
    const style = document.createElement('style')
    style.textContent = shimmerKeyframes
    document.head.appendChild(style)
    styleRef.current = style
    return () => { style.remove() }
  }, [open])

  const handleStart = useCallback(async () => {
    setRendering(true)
    setError(null)
    setProgress({ phase: 'preparing', percent: 0 })

    const { width, height } = getResolution(`${resolution}_${ratio}`)
    const renderer = new ShortDramaRenderer({ width, height })
    rendererRef.current = renderer
    renderer.onProgress(setProgress)

    try {
      const blob = await renderer.buildAndExport(
        draft,
        currentEpisodeId || undefined,
        { includeDialogue, includeNarration, includeBGM, includeSubtitles },
      )
      const name = `${draft.title || '短剧'}_${resolution}_${ratio.replace(':', 'x')}.mp4`
      await saveRenderedVideo(blob, name)
      setProgress({ phase: 'done', percent: 100 })
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      if (!msg.includes('已取消')) setError(msg)
    } finally {
      setRendering(false)
      rendererRef.current = null
    }
  }, [draft, currentEpisodeId, resolution, ratio, includeDialogue, includeNarration, includeBGM, includeSubtitles])

  const handleCancel = useCallback(() => {
    rendererRef.current?.cancel()
  }, [])

  if (!open) return null

  const tracks = [
    { key: 'dialogue', label: '对话', checked: includeDialogue, set: setIncludeDialogue },
    { key: 'narration', label: '旁白', checked: includeNarration, set: setIncludeNarration },
    { key: 'bgm', label: 'BGM', checked: includeBGM, set: setIncludeBGM },
    { key: 'subtitle', label: '字幕', checked: includeSubtitles, set: setIncludeSubtitles },
  ]

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-[2px]"
      onClick={onClose}
    >
      <div
        className="w-[500px] rounded-xl border border-[var(--border-color)] bg-[var(--bg-primary)] shadow-2xl"
        style={{ animation: 'modal-enter 0.2s ease-out' }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-[var(--border-color)] px-5 py-3.5">
          <div className="flex items-center gap-2">
            <Film className="h-4 w-4 text-[var(--accent-color)]" />
            <h3 className="text-base font-semibold text-[var(--text-primary)] tracking-tight">视频合成导出</h3>
          </div>
          <button
            onClick={onClose}
            className="rounded-md p-1.5 text-[var(--text-secondary)] transition-colors duration-150 hover:bg-[var(--bg-secondary)] hover:text-[var(--text-primary)]"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="space-y-5 p-5">
          {/* Resolution & Ratio */}
          <div className="flex gap-5">
            <div className="flex-1">
              <label className="mb-2 block text-xs font-medium text-[var(--text-secondary)] uppercase tracking-wider">
                分辨率
              </label>
              <div className="flex gap-1.5">
                {RESOLUTIONS.map((r) => (
                  <button
                    key={r.value}
                    className={cn(
                      'flex-1 rounded-lg px-3 py-2 text-xs font-medium transition-all duration-150',
                      resolution === r.value
                        ? 'bg-[var(--accent-color)] text-white shadow-[0_0_10px_rgba(var(--accent-rgb),0.3)]'
                        : 'bg-[var(--bg-secondary)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-secondary)]/80',
                    )}
                    onClick={() => setResolution(r.value)}
                    disabled={rendering}
                  >
                    {r.label}
                  </button>
                ))}
              </div>
            </div>
            <div className="flex-1">
              <label className="mb-2 block text-xs font-medium text-[var(--text-secondary)] uppercase tracking-wider">
                比例
              </label>
              <div className="flex gap-1.5">
                {RATIOS.map((r) => (
                  <button
                    key={r.value}
                    className={cn(
                      'flex-1 rounded-lg px-2 py-2 text-xs font-medium transition-all duration-150',
                      ratio === r.value
                        ? 'bg-[var(--accent-color)] text-white shadow-[0_0_10px_rgba(var(--accent-rgb),0.3)]'
                        : 'bg-[var(--bg-secondary)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-secondary)]/80',
                    )}
                    onClick={() => setRatio(r.value)}
                    disabled={rendering}
                  >
                    {r.label}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Track Toggles */}
          <div>
            <label className="mb-2 block text-xs font-medium text-[var(--text-secondary)] uppercase tracking-wider">
              包含轨道
            </label>
            <div className="flex flex-wrap gap-3">
              {tracks.map((t) => (
                <label
                  key={t.key}
                  className={cn(
                    'group flex cursor-pointer items-center gap-2.5 select-none text-xs font-medium text-[var(--text-primary)]',
                    rendering && 'pointer-events-none opacity-50',
                  )}
                >
                  <span className="relative inline-flex h-5 w-9 flex-shrink-0">
                    <input
                      type="checkbox"
                      checked={t.checked}
                      onChange={(e) => t.set(e.target.checked)}
                      disabled={rendering}
                      className="peer sr-only"
                    />
                    <span
                      className={cn(
                        'absolute inset-0 rounded-full transition-colors duration-200',
                        'peer-checked:bg-[var(--accent-color)] peer-focus-visible:ring-2 peer-focus-visible:ring-[var(--accent-color)]/40',
                        !t.checked && 'bg-[var(--bg-secondary)]',
                      )}
                    />
                    <span
                      className={cn(
                        'absolute top-0.5 left-0.5 h-4 w-4 rounded-full bg-white shadow-sm transition-transform duration-200',
                        t.checked && 'translate-x-4',
                      )}
                    />
                  </span>
                  {t.label}
                </label>
              ))}
            </div>
          </div>

          {/* Progress */}
          {progress && (
            <div className="rounded-lg border border-[var(--border-color)] bg-[var(--bg-secondary)] p-3 space-y-2">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-1.5 text-xs font-medium text-[var(--text-primary)]">
                  {PHASE_ICONS[progress.phase] || <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                  <span>{PHASE_LABELS[progress.phase] || progress.phase}</span>
                </div>
                <span className="text-xs tabular-nums font-semibold text-[var(--text-primary)]">
                  {progress.percent}%
                </span>
              </div>
              <div className="relative h-3 w-full overflow-hidden rounded-full bg-[var(--bg-primary)]">
                <div
                  className="h-full rounded-full transition-all duration-300"
                  style={{
                    width: `${progress.percent}%`,
                    background: 'linear-gradient(90deg, var(--accent-color), color-mix(in srgb, var(--accent-color) 70%, #fff))',
                  }}
                />
                {progress.phase !== 'done' && progress.phase !== 'cancelled' && (
                  <div
                    className="absolute inset-0 rounded-full"
                    style={{
                      background: 'linear-gradient(90deg, transparent, rgba(255,255,255,0.15), transparent)',
                      animation: 'render-shimmer 1.5s ease-in-out infinite',
                    }}
                  />
                )}
              </div>
              {progress.currentSegment != null && progress.totalSegments != null && (
                <div className="text-[11px] text-[var(--text-secondary)] tabular-nums">
                  片段 {progress.currentSegment}/{progress.totalSegments}
                </div>
              )}
            </div>
          )}

          {/* Error */}
          {error && (
            <div className="flex items-start gap-2 rounded-lg border border-red-500/20 bg-red-500/10 px-3.5 py-2.5">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 flex-shrink-0 text-red-400" />
              <span className="text-xs text-red-400 leading-relaxed">{error}</span>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 border-t border-[var(--border-color)] px-5 py-3.5">
          {rendering ? (
            <Button size="sm" variant="secondary" onClick={handleCancel}>
              取消
            </Button>
          ) : (
            <>
              <Button size="sm" variant="ghost" onClick={onClose}>
                关闭
              </Button>
              <button
                onClick={handleStart}
                className="inline-flex items-center gap-2 rounded-lg px-5 py-2.5 text-sm font-semibold text-white transition-all duration-200 shadow-[0_0_12px_rgba(var(--accent-rgb),0.25)] hover:shadow-[0_0_20px_rgba(var(--accent-rgb),0.4)] hover:brightness-110 active:scale-[0.97]"
                style={{
                  background: 'linear-gradient(135deg, var(--accent-color), color-mix(in srgb, var(--accent-color) 75%, #000))',
                }}
              >
                {rendering
                  ? <Loader2 className="h-4 w-4 animate-spin" />
                  : <Download className="h-4 w-4" />
                }
                开始合成
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
