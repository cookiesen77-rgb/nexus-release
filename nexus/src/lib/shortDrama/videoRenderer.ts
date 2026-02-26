import type { ShortDramaDraftV2 } from '@/lib/shortDrama/types'
import { buildTimeline } from '@/lib/shortDrama/videoCompose'
import { buildBGMTimeline } from '@/lib/shortDrama/bgmManager'
import { safeFetch } from '@/lib/safeFetch'

export interface RenderConfig {
  width: number
  height: number
  fps?: number
  bgColor?: string
}

export type RenderPhase = 'preparing' | 'composing' | 'encoding' | 'done' | 'cancelled'

export interface RenderProgress {
  phase: RenderPhase
  percent: number
  currentSegment?: number
  totalSegments?: number
}

export interface RenderOptions {
  includeDialogue?: boolean
  includeNarration?: boolean
  includeBGM?: boolean
  includeSubtitles?: boolean
}

const RESOLUTION_PRESETS: Record<string, { width: number; height: number }> = {
  '720p_16:9': { width: 1280, height: 720 },
  '720p_9:16': { width: 720, height: 1280 },
  '720p_1:1': { width: 720, height: 720 },
  '1080p_16:9': { width: 1920, height: 1080 },
  '1080p_9:16': { width: 1080, height: 1920 },
  '1080p_1:1': { width: 1080, height: 1080 },
  '4k_16:9': { width: 3840, height: 2160 },
  '4k_9:16': { width: 2160, height: 3840 },
}

export function getResolution(preset: string): { width: number; height: number } {
  return RESOLUTION_PRESETS[preset] || RESOLUTION_PRESETS['1080p_16:9']
}

const isTauri = typeof window !== 'undefined' && !!(window as any).__TAURI_INTERNALS__

export class ShortDramaRenderer {
  private config: RenderConfig
  private cancelled = false
  private onProgressFn?: (p: RenderProgress) => void

  constructor(config: RenderConfig) {
    this.config = {
      fps: 30,
      bgColor: '#000000',
      ...config,
    }
  }

  onProgress(fn: (p: RenderProgress) => void) {
    this.onProgressFn = fn
  }

  async buildAndExport(
    draft: ShortDramaDraftV2,
    episodeId?: string,
    options: RenderOptions = {},
  ): Promise<Blob> {
    const { includeDialogue = true, includeNarration = true, includeBGM = true, includeSubtitles = true } = options

    this.onProgressFn?.({ phase: 'preparing', percent: 0 })

    const timeline = buildTimeline(draft, episodeId)
    const bgmEntries = includeBGM ? buildBGMTimeline(draft, episodeId) : []
    const charMap = new Map(draft.characters.map((c) => [c.id, c.name]))

    // Dynamically import @webav/av-cliper (only loaded when rendering)
    let avCliper: any
    try {
      const modId = '@webav/av-cliper'
      avCliper = await import(/* @vite-ignore */ modId)
    } catch {
      throw new Error('视频合成库 @webav/av-cliper 未安装。请运行: npm install @webav/av-cliper')
    }

    const { Combinator, MP4Clip, ImgClip, AudioClip, EmbedSubtitlesClip, OffscreenSprite } = avCliper
    const combinator = new Combinator({ width: this.config.width, height: this.config.height })

    const totalSegs = timeline.segments.length
    let processed = 0

    // ── Video Track ──
    for (const seg of timeline.segments) {
      if (this.cancelled) throw new Error('渲染已取消')

      const shot = draft.shots.find((s) => s.id === seg.shotId)
      if (!shot) continue

      const videoUrl = seg.videoUrl
      const imageUrl = (() => {
        const slot = shot.frames.start.slot
        const v = slot.selectedVariantId
          ? slot.variants.find((vv) => vv.id === slot.selectedVariantId)
          : slot.variants.find((vv) => vv.status === 'success')
        return v?.displayUrl || v?.sourceUrl
      })()

      const offsetUs = seg.startMs * 1000
      const durationUs = seg.durationMs * 1000

      if (videoUrl) {
        try {
          const resp = await safeFetch(videoUrl)
          const clip = new MP4Clip(resp.body!)
          await clip.ready
          const sprite = new OffscreenSprite(clip)
          await combinator.addSprite(sprite, { offset: offsetUs, duration: durationUs })
        } catch (e) {
          console.warn(`[Renderer] 视频片段加载失败 (shot: ${shot.title}):`, e)
        }
      } else if (imageUrl) {
        try {
          const resp = await safeFetch(imageUrl)
          const imgBlob = await resp.blob()
          const clip = new ImgClip(imgBlob)
          await clip.ready
          const sprite = new OffscreenSprite(clip)
          await combinator.addSprite(sprite, { offset: offsetUs, duration: durationUs })
        } catch (e) {
          console.warn(`[Renderer] 图片片段加载失败 (shot: ${shot.title}):`, e)
        }
      }

      // ── Dialogue Audio ──
      if (includeDialogue && seg.dialogueUrl) {
        try {
          const resp = await safeFetch(seg.dialogueUrl)
          const clip = new AudioClip(resp.body!)
          await clip.ready
          const sprite = new OffscreenSprite(clip)
          await combinator.addSprite(sprite, { offset: offsetUs, duration: durationUs })
        } catch (e) {
          console.warn(`[Renderer] 对话音频加载失败:`, e)
        }
      }

      // ── Narration Audio ──
      if (includeNarration && seg.narrationUrl) {
        try {
          const resp = await safeFetch(seg.narrationUrl)
          const clip = new AudioClip(resp.body!)
          await clip.ready
          const sprite = new OffscreenSprite(clip)
          await combinator.addSprite(sprite, { offset: offsetUs, duration: durationUs })
        } catch (e) {
          console.warn(`[Renderer] 旁白音频加载失败:`, e)
        }
      }

      processed++
      this.onProgressFn?.({
        phase: 'composing',
        percent: Math.round((processed / totalSegs) * 60),
        currentSegment: processed,
        totalSegments: totalSegs,
      })
    }

    // ── BGM Track ──
    if (includeBGM) {
      for (const entry of bgmEntries) {
        if (this.cancelled) throw new Error('渲染已取消')
        try {
          const resp = await safeFetch(entry.url)
          const clip = new AudioClip(resp.body!)
          await clip.ready
          const sprite = new OffscreenSprite(clip)
          await combinator.addSprite(sprite, {
            offset: entry.startMs * 1000,
            duration: entry.durationMs * 1000,
          })
        } catch (e) {
          console.warn(`[Renderer] BGM 加载失败:`, e)
        }
      }
    }

    // ── Subtitles ──
    if (includeSubtitles) {
      const subtitles: Array<{ start: number; end: number; text: string }> = []
      for (const seg of timeline.segments) {
        const shot = draft.shots.find((s) => s.id === seg.shotId)
        if (!shot?.audio?.dialogue?.trim()) continue
        const speaker = shot.audio.dialogueCharacterId ? charMap.get(shot.audio.dialogueCharacterId) : undefined
        const text = speaker ? `${speaker}：${shot.audio.dialogue}` : shot.audio.dialogue
        subtitles.push({
          start: seg.startMs * 1000,
          end: (seg.startMs + seg.durationMs) * 1000,
          text,
        })
      }

      if (subtitles.length > 0) {
        try {
          const subClip = new EmbedSubtitlesClip(subtitles, {
            fontSize: 24,
            fontFamily: 'Noto Sans SC, sans-serif',
            color: '#ffffff',
            strokeStyle: '#000000',
            lineWidth: 2,
            bottomOffset: 60,
          })
          const sprite = new OffscreenSprite(subClip)
          await combinator.addSprite(sprite, {
            offset: 0,
            duration: timeline.totalDurationMs * 1000,
          })
        } catch (e) {
          console.warn(`[Renderer] 字幕渲染失败:`, e)
        }
      }
    }

    // ── Output ──
    this.onProgressFn?.({ phase: 'encoding', percent: 65 })

    const chunks: Uint8Array[] = []
    const outputStream = combinator.output()
    const reader = outputStream.getReader()

    let readPercent = 65
    while (true) {
      if (this.cancelled) { reader.cancel(); throw new Error('渲染已取消') }
      const { done, value } = await reader.read()
      if (done) break
      if (value) chunks.push(value)
      readPercent = Math.min(95, readPercent + 0.5)
      this.onProgressFn?.({ phase: 'encoding', percent: Math.round(readPercent) })
    }

    this.onProgressFn?.({ phase: 'done', percent: 100 })
    return new Blob(chunks as any[], { type: 'video/mp4' })
  }

  cancel() {
    this.cancelled = true
    this.onProgressFn?.({ phase: 'cancelled', percent: 0 })
  }
}

// ── Export helper ──

export async function saveRenderedVideo(blob: Blob, suggestedName: string) {
  if (isTauri) {
    try {
      const { save } = await import('@tauri-apps/plugin-dialog')
      const { writeFile } = await import('@tauri-apps/plugin-fs')
      const path = await save({
        defaultPath: suggestedName,
        filters: [{ name: 'Video', extensions: ['mp4'] }],
      })
      if (path) {
        const buffer = await blob.arrayBuffer()
        await writeFile(path, new Uint8Array(buffer))
        return
      }
    } catch {
      // Fall through to web download
    }
  }

  // Web: blob download
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = suggestedName
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}
