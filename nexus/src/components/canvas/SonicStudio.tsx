/**
 * Sonic Studio | 音频工作室
 * Suno 文生音乐（生成歌曲 / 生成歌词）
 */

import React, { useState, useCallback, useRef } from 'react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { postJson, getJson } from '@/lib/workflow/request'
import {
  X,
  Music,
  Download,
  Copy,
  StopCircle,
  ChevronDown,
  ChevronUp
} from 'lucide-react'

// Suno API 响应类型
interface SunoClip {
  id: string
  clip_id: string
  title: string
  tags: string
  prompt: string
  audio_url: string
  image_url: string
  image_large_url: string
  duration: number
  model_name: string
  status: string
  state: string
  metadata?: {
    tags?: string
    prompt?: string
    duration?: number
    [key: string]: unknown
  }
}

interface SunoTaskResponse {
  code: string
  data: string
  message: string
}

interface SunoFetchResponse {
  code: string
  message: string
  data: {
    task_id: string
    action: string
    status: string
    fail_reason: string
    progress: string
    data: SunoClip[] | { text: string; title: string; tags: string[]; status: string }
  }
}

interface Track {
  id: string
  clipId: string
  title: string
  model: string
  audioUrl: string
  imageUrl: string
  duration: number
  tags: string
}

interface Props {
  open: boolean
  onClose: () => void
  onAddToCanvas: (data: { type: 'audio'; src: string; title?: string; model?: string }) => void
}

type TabId = 'music' | 'lyrics'

const MODEL_OPTIONS = [
  { label: 'Suno v5 (最新)', value: 'chirp-v5' },
  { label: 'Suno v4', value: 'chirp-v4' },
  { label: 'Suno v4.5', value: 'chirp-auk' },
  { label: 'Suno v3.5', value: 'chirp-v3-5' },
]

const VOCAL_OPTIONS = [
  { label: '自动', value: '' },
  { label: '女声', value: 'f' },
  { label: '男声', value: 'm' },
]

const POLL_INTERVAL = 3000
const MAX_POLLS = 300

export default function SonicStudio({ open, onClose, onAddToCanvas }: Props) {
  const [activeTab, setActiveTab] = useState<TabId>('music')

  // Music form
  const [musicTitle, setMusicTitle] = useState('')
  const [musicTags, setMusicTags] = useState('')
  const [musicNegativeTags, setMusicNegativeTags] = useState('')
  const [musicPrompt, setMusicPrompt] = useState('')
  const [modelVersion, setModelVersion] = useState('chirp-v4')
  const [vocalGender, setVocalGender] = useState('')
  const [instrumental, setInstrumental] = useState(false)

  // 续写模式
  const [extendMode, setExtendMode] = useState(false)
  const [continueClipId, setContinueClipId] = useState('')
  const [continueAt, setContinueAt] = useState('')

  // Lyrics form
  const [lyricsPrompt, setLyricsPrompt] = useState('')
  const [lyricsResult, setLyricsResult] = useState('')

  // Tracks
  const [tracks, setTracks] = useState<Track[]>([])
  const [currentTrack, setCurrentTrack] = useState<Track | null>(null)

  // Generation state
  const [isGenerating, setIsGenerating] = useState(false)
  const [statusText, setStatusText] = useState('')
  const abortRef = useRef(false)

  // 展开/折叠高级选项
  const [showAdvanced, setShowAdvanced] = useState(false)

  const formatDuration = (seconds: number): string => {
    const mins = Math.floor(seconds / 60)
    const secs = Math.floor(seconds % 60)
    return `${mins}:${secs.toString().padStart(2, '0')}`
  }

  const pollTask = async (taskId: string): Promise<SunoFetchResponse['data'] | null> => {
    for (let i = 0; i < MAX_POLLS; i++) {
      if (abortRef.current) return null
      await new Promise(r => setTimeout(r, POLL_INTERVAL))
      if (abortRef.current) return null

      const res = await getJson<SunoFetchResponse>(`/suno/fetch/${taskId}`)
      const task = res.data
      const status = task.status

      setStatusText(
        status === 'QUEUED' ? '排队中...' :
        status === 'IN_PROGRESS' ? `生成中 ${task.progress || ''}` :
        status === 'SUBMITTED' ? '已提交...' :
        status
      )

      if (status === 'SUCCESS') return task
      if (status === 'FAILURE') throw new Error(task.fail_reason || '生成失败')
    }
    throw new Error('轮询超时')
  }

  const handleGenerateMusic = useCallback(async () => {
    if (!musicPrompt.trim() || isGenerating) return

    setIsGenerating(true)
    setStatusText('提交中...')
    abortRef.current = false

    try {
      const body: Record<string, unknown> = {
        prompt: musicPrompt,
        mv: modelVersion,
        title: musicTitle || undefined,
        tags: musicTags || undefined,
        negative_tags: musicNegativeTags || undefined,
        make_instrumental: instrumental,
      }

      if (!instrumental && vocalGender) {
        body.metadata = { create_mode: 'custom', vocal_gender: vocalGender }
      }

      if (extendMode && continueClipId) {
        body.task = 'extend'
        body.continue_clip_id = continueClipId
        body.continue_at = parseFloat(continueAt) || 0
      }

      const submitRes = await postJson<SunoTaskResponse>('/suno/submit/music', body)

      if (submitRes.code !== 'success') {
        throw new Error(submitRes.message || '提交失败')
      }

      const taskId = submitRes.data
      setStatusText('已提交，等待生成...')

      const result = await pollTask(taskId)
      if (!result || abortRef.current) return

      const clips = result.data as SunoClip[]
      if (!Array.isArray(clips) || clips.length === 0) {
        throw new Error('未返回音频数据')
      }

      const newTracks: Track[] = clips.map(clip => ({
        id: clip.id,
        clipId: clip.clip_id,
        title: clip.title || musicTitle || '新歌曲',
        model: clip.model_name || modelVersion,
        audioUrl: clip.audio_url,
        imageUrl: clip.image_url || clip.image_large_url || '',
        duration: clip.duration || 0,
        tags: clip.tags || musicTags || '',
      }))

      setTracks(prev => [...newTracks, ...prev])
      setCurrentTrack(newTracks[0])
      setStatusText('')
      window.$message?.success?.(`生成完成，共 ${newTracks.length} 首`)
    } catch (err: unknown) {
      if (abortRef.current) return
      const msg = err instanceof Error ? err.message : String(err)
      setStatusText(`失败: ${msg}`)
      window.$message?.error?.(msg)
    } finally {
      setIsGenerating(false)
    }
  }, [musicPrompt, musicTitle, musicTags, musicNegativeTags, modelVersion, vocalGender, instrumental, extendMode, continueClipId, continueAt, isGenerating])

  const handleGenerateLyrics = useCallback(async () => {
    if (!lyricsPrompt.trim() || isGenerating) return

    setIsGenerating(true)
    setStatusText('提交中...')
    abortRef.current = false

    try {
      const submitRes = await postJson<SunoTaskResponse>('/suno/submit/lyrics', {
        prompt: lyricsPrompt,
      })

      if (submitRes.code !== 'success') {
        throw new Error(submitRes.message || '提交失败')
      }

      const taskId = submitRes.data
      setStatusText('已提交，等待生成...')

      const result = await pollTask(taskId)
      if (!result || abortRef.current) return

      const lyricsData = result.data as { text: string; title: string; tags: string[] }
      setLyricsResult(lyricsData.text || '')
      setStatusText('')
      window.$message?.success?.('歌词生成完成')
    } catch (err: unknown) {
      if (abortRef.current) return
      const msg = err instanceof Error ? err.message : String(err)
      setStatusText(`失败: ${msg}`)
      window.$message?.error?.(msg)
    } finally {
      setIsGenerating(false)
    }
  }, [lyricsPrompt, isGenerating])

  const handleStop = useCallback(() => {
    abortRef.current = true
    setIsGenerating(false)
    setStatusText('已取消')
  }, [])

  const handleAddTrackToCanvas = useCallback(
    (track: Track) => {
      onAddToCanvas({
        type: 'audio',
        src: track.audioUrl,
        title: track.title,
        model: track.model,
      })
    },
    [onAddToCanvas]
  )

  const downloadTrack = useCallback((track: Track) => {
    if (!track.audioUrl) return
    const link = document.createElement('a')
    link.href = track.audioUrl
    link.download = `${track.title || 'audio'}.mp3`
    link.click()
  }, [])

  const copyLyrics = useCallback(() => {
    if (!lyricsResult) return
    navigator.clipboard.writeText(lyricsResult)
    window.$message?.success?.('已复制')
  }, [lyricsResult])

  const useLyricsForMusic = useCallback(() => {
    if (!lyricsResult) return
    setMusicPrompt(lyricsResult)
    setActiveTab('music')
    window.$message?.success?.('歌词已填入提示词')
  }, [lyricsResult])

  // 从已有 track 续写
  const handleExtendTrack = useCallback((track: Track) => {
    setExtendMode(true)
    setContinueClipId(track.clipId)
    setContinueAt(String(Math.floor(track.duration || 0)))
    setMusicTitle(track.title)
    setMusicTags(track.tags)
    setShowAdvanced(true)
    setActiveTab('music')
  }, [])

  if (!open) return null

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div
        className="flex max-h-[90vh] w-[980px] max-w-[96vw] flex-col overflow-hidden rounded-2xl border border-[var(--border-color)] bg-[var(--bg-secondary)] shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-[var(--border-color)] px-5 py-4">
          <h2 className="text-lg font-semibold text-[var(--text-primary)]">音频工作室</h2>
          <div className="flex items-center gap-3">
            {isGenerating && (
              <span className="text-[11px] text-[var(--text-secondary)]">{statusText}</span>
            )}
            <button
              onClick={onClose}
              className="rounded-full p-1 text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-primary)] hover:text-[var(--text-primary)]"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-auto p-5">
          <div className="space-y-4">
            {/* Tabs */}
            <div className="flex rounded-lg border border-[var(--border-color)] bg-[var(--bg-primary)] p-1">
              <button
                onClick={() => setActiveTab('music')}
                className={cn(
                  'flex-1 rounded-md py-2 text-xs font-medium transition-colors',
                  activeTab === 'music'
                    ? 'bg-[var(--bg-tertiary)] text-[var(--text-primary)]'
                    : 'text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)] hover:text-[var(--text-primary)]'
                )}
              >
                生成歌曲
              </button>
              <button
                onClick={() => setActiveTab('lyrics')}
                className={cn(
                  'flex-1 rounded-md py-2 text-xs font-medium transition-colors',
                  activeTab === 'lyrics'
                    ? 'bg-[var(--bg-tertiary)] text-[var(--text-primary)]'
                    : 'text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)] hover:text-[var(--text-primary)]'
                )}
              >
                生成歌词
              </button>
            </div>

            <div className="grid max-h-[70vh] grid-cols-1 gap-4 overflow-hidden lg:grid-cols-[1.05fr_0.95fr]">
              {/* Left: Form */}
              <div className="flex flex-col gap-4 overflow-auto pr-1">
                {activeTab === 'music' ? (
                  <>
                    <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                      <div className="flex flex-col gap-2">
                        <label className="text-[11px] font-bold uppercase text-[var(--text-secondary)]">音乐标题</label>
                        <input
                          value={musicTitle}
                          onChange={(e) => setMusicTitle(e.target.value)}
                          placeholder="可选，如：霓虹夜行"
                          className="rounded-lg border border-[var(--border-color)] bg-[var(--bg-primary)] px-3 py-2 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-secondary)] focus:border-[var(--accent-color)] focus:outline-none"
                        />
                      </div>
                      <div className="flex flex-col gap-2">
                        <label className="text-[11px] font-bold uppercase text-[var(--text-secondary)]">风格标签</label>
                        <input
                          value={musicTags}
                          onChange={(e) => setMusicTags(e.target.value)}
                          placeholder="如：cinematic, ambient, synthwave"
                          className="rounded-lg border border-[var(--border-color)] bg-[var(--bg-primary)] px-3 py-2 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-secondary)] focus:border-[var(--accent-color)] focus:outline-none"
                        />
                      </div>
                    </div>

                    <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
                      <div className="flex flex-col gap-2">
                        <label className="text-[11px] font-bold uppercase text-[var(--text-secondary)]">模型版本</label>
                        <select
                          value={modelVersion}
                          onChange={(e) => setModelVersion(e.target.value)}
                          className="rounded-lg border border-[var(--border-color)] bg-[var(--bg-primary)] px-3 py-2 text-sm text-[var(--text-primary)] focus:border-[var(--accent-color)] focus:outline-none"
                        >
                          {MODEL_OPTIONS.map((opt) => (
                            <option key={opt.value} value={opt.value}>{opt.label}</option>
                          ))}
                        </select>
                      </div>
                      <div className="flex flex-col gap-2">
                        <label className="text-[11px] font-bold uppercase text-[var(--text-secondary)]">人声音色</label>
                        <select
                          value={vocalGender}
                          onChange={(e) => setVocalGender(e.target.value)}
                          disabled={instrumental}
                          className="rounded-lg border border-[var(--border-color)] bg-[var(--bg-primary)] px-3 py-2 text-sm text-[var(--text-primary)] focus:border-[var(--accent-color)] focus:outline-none disabled:opacity-40"
                        >
                          {VOCAL_OPTIONS.map((opt) => (
                            <option key={opt.value} value={opt.value}>{opt.label}</option>
                          ))}
                        </select>
                      </div>
                      <div className="flex flex-col gap-2">
                        <label className="text-[11px] font-bold uppercase text-[var(--text-secondary)]">纯音乐</label>
                        <button
                          onClick={() => setInstrumental(v => !v)}
                          className={cn(
                            'rounded-lg border px-3 py-2 text-sm transition-colors',
                            instrumental
                              ? 'border-[var(--accent-color)] bg-[rgb(var(--accent-rgb)/0.1)] text-[var(--accent-color)]'
                              : 'border-[var(--border-color)] bg-[var(--bg-primary)] text-[var(--text-secondary)]'
                          )}
                        >
                          {instrumental ? '开启' : '关闭'}
                        </button>
                      </div>
                    </div>

                    {/* 高级选项折叠 */}
                    <button
                      onClick={() => setShowAdvanced(v => !v)}
                      className="flex items-center gap-1 text-[11px] text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
                    >
                      {showAdvanced ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
                      {extendMode ? '续写模式 (已开启)' : '高级选项'}
                    </button>

                    {showAdvanced && (
                      <div className="space-y-3 rounded-xl border border-[var(--border-color)] bg-[var(--bg-primary)] p-3">
                        <div className="flex items-center gap-3">
                          <label className="text-[11px] font-bold uppercase text-[var(--text-secondary)]">
                            不希望出现的风格
                          </label>
                          <input
                            value={musicNegativeTags}
                            onChange={(e) => setMusicNegativeTags(e.target.value)}
                            placeholder="如：metal, heavy drums"
                            className="flex-1 rounded-lg border border-[var(--border-color)] bg-[var(--bg-secondary)] px-3 py-1.5 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-secondary)] focus:border-[var(--accent-color)] focus:outline-none"
                          />
                        </div>
                        <div className="flex items-center gap-3">
                          <label className="flex items-center gap-2">
                            <input
                              type="checkbox"
                              checked={extendMode}
                              onChange={(e) => setExtendMode(e.target.checked)}
                              className="accent-[var(--accent-color)]"
                            />
                            <span className="text-[11px] font-bold uppercase text-[var(--text-secondary)]">续写模式</span>
                          </label>
                        </div>
                        {extendMode && (
                          <div className="grid grid-cols-2 gap-3">
                            <div className="flex flex-col gap-1">
                              <label className="text-[10px] text-[var(--text-secondary)]">续写 Clip ID</label>
                              <input
                                value={continueClipId}
                                onChange={(e) => setContinueClipId(e.target.value)}
                                placeholder="粘贴 clip_id"
                                className="rounded-lg border border-[var(--border-color)] bg-[var(--bg-secondary)] px-3 py-1.5 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-secondary)] focus:border-[var(--accent-color)] focus:outline-none"
                              />
                            </div>
                            <div className="flex flex-col gap-1">
                              <label className="text-[10px] text-[var(--text-secondary)]">续写起始 (秒)</label>
                              <input
                                value={continueAt}
                                onChange={(e) => setContinueAt(e.target.value)}
                                placeholder="如：60"
                                className="rounded-lg border border-[var(--border-color)] bg-[var(--bg-secondary)] px-3 py-1.5 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-secondary)] focus:border-[var(--accent-color)] focus:outline-none"
                              />
                            </div>
                          </div>
                        )}
                      </div>
                    )}

                    <div className="flex flex-col gap-2">
                      <div className="flex items-center justify-between">
                        <label className="text-[11px] font-bold uppercase text-[var(--text-secondary)]">
                          提示词 / 歌词
                        </label>
                        <span className="text-[10px] text-[var(--text-secondary)]">{musicPrompt.length}/3000</span>
                      </div>
                      <textarea
                        value={musicPrompt}
                        onChange={(e) => setMusicPrompt(e.target.value)}
                        placeholder={'描述歌曲主题、节奏、情绪，也可以直接写歌词。\n\n示例格式：\n[Verse]\n你的歌词内容\n[Chorus]\n副歌内容'}
                        maxLength={3000}
                        className="min-h-[180px] w-full resize-none rounded-xl border border-[var(--border-color)] bg-[var(--bg-primary)] p-3 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-secondary)] focus:border-[var(--accent-color)] focus:outline-none"
                      />
                    </div>

                    <div className="rounded-xl border border-[var(--border-color)] bg-[var(--bg-primary)] p-3 text-[11px] leading-relaxed text-[var(--text-secondary)]">
                      建议：使用"风格 + 乐器 + 情绪 + 节奏"的结构，例如：
                      <span className="text-[var(--text-primary)]">
                        电影感、慢节奏、合成器铺底、温柔女声、夜雨城市
                      </span>
                      。歌词支持 [Verse] [Chorus] [Bridge] [Outro] 等段落标记。
                    </div>
                  </>
                ) : (
                  <>
                    <div className="flex flex-col gap-2">
                      <div className="flex items-center justify-between">
                        <label className="text-[11px] font-bold uppercase text-[var(--text-secondary)]">歌词需求</label>
                        <span className="text-[10px] text-[var(--text-secondary)]">{lyricsPrompt.length}/1200</span>
                      </div>
                      <textarea
                        value={lyricsPrompt}
                        onChange={(e) => setLyricsPrompt(e.target.value)}
                        placeholder="描述主题、情绪、段落结构（主歌/副歌）、押韵方式等。"
                        maxLength={1200}
                        className="min-h-[220px] w-full resize-none rounded-xl border border-[var(--border-color)] bg-[var(--bg-primary)] p-3 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-secondary)] focus:border-[var(--accent-color)] focus:outline-none"
                      />
                    </div>

                    <div className="rounded-xl border border-[var(--border-color)] bg-[var(--bg-primary)] p-3 text-[11px] leading-relaxed text-[var(--text-secondary)]">
                      建议：给出主题 + 视角 + 节奏 + 押韵要求，例如：
                      <span className="text-[var(--text-primary)]">第一人称，都市夜雨，慢节奏，ABAB 押韵</span>。
                    </div>
                  </>
                )}
              </div>

              {/* Right: Player + List */}
              <div className="flex flex-col gap-4 overflow-hidden">
                {activeTab === 'music' ? (
                  <>
                    <div className="flex flex-col gap-3">
                      <span className="text-sm font-semibold">播放器</span>
                      <div className="rounded-2xl border border-[var(--border-color)] bg-[var(--bg-primary)] p-4">
                        {currentTrack ? (
                          <>
                            <div className="flex items-start gap-3">
                              {currentTrack.imageUrl ? (
                                <img
                                  src={currentTrack.imageUrl}
                                  alt={currentTrack.title}
                                  className="h-14 w-14 rounded-lg object-cover"
                                />
                              ) : (
                                <div className="flex h-14 w-14 items-center justify-center rounded-lg bg-[var(--bg-tertiary)]">
                                  <Music className="h-6 w-6 text-[var(--text-secondary)]" />
                                </div>
                              )}
                              <div className="min-w-0 flex-1">
                                <div className="truncate text-sm font-semibold">{currentTrack.title}</div>
                                <div className="truncate text-[11px] text-[var(--text-secondary)]">
                                  {currentTrack.model} · {formatDuration(currentTrack.duration)}
                                </div>
                                {currentTrack.tags && (
                                  <div className="mt-1 truncate text-[10px] text-[var(--text-secondary)]">
                                    {currentTrack.tags}
                                  </div>
                                )}
                              </div>
                              <button
                                className="shrink-0 rounded-md border border-[var(--border-color)] px-2 py-1 text-[11px] transition-colors hover:border-[var(--accent-color)]"
                                onClick={() => handleAddTrackToCanvas(currentTrack)}
                              >
                                上板
                              </button>
                            </div>
                            <audio
                              src={currentTrack.audioUrl}
                              controls
                              className="mt-3 w-full"
                            />
                          </>
                        ) : (
                          <div className="text-[11px] text-[var(--text-secondary)]">生成后将自动加载最新音频</div>
                        )}
                      </div>
                    </div>

                    <div className="flex flex-1 flex-col gap-3 overflow-hidden">
                      <div className="flex items-center justify-between">
                        <span className="text-sm font-semibold">音频列表</span>
                        <span className="text-[11px] text-[var(--text-secondary)]">{tracks.length} 条</span>
                      </div>
                      <div className="flex-1 space-y-2 overflow-auto">
                        {tracks.map((track) => (
                          <div
                            key={track.id}
                            className={cn(
                              'group cursor-pointer rounded-xl border bg-[var(--bg-primary)] p-3 transition-colors hover:border-[var(--accent-color)]',
                              currentTrack?.id === track.id
                                ? 'border-[var(--accent-color)]'
                                : 'border-[var(--border-color)]'
                            )}
                            onClick={() => setCurrentTrack(track)}
                          >
                            <div className="flex items-center justify-between gap-3">
                              <div className="flex min-w-0 items-center gap-2">
                                {track.imageUrl ? (
                                  <img src={track.imageUrl} alt="" className="h-9 w-9 rounded-lg object-cover" />
                                ) : (
                                  <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-[var(--bg-tertiary)]">
                                    <Music className="h-[18px] w-[18px]" />
                                  </div>
                                )}
                                <div className="min-w-0">
                                  <div className="truncate text-sm">{track.title}</div>
                                  <div className="truncate text-[11px] text-[var(--text-secondary)]">
                                    {track.model} · {formatDuration(track.duration)}
                                  </div>
                                </div>
                              </div>
                              <div className="flex shrink-0 items-center gap-1">
                                <button
                                  className="rounded-md border border-[var(--border-color)] px-2 py-1 text-[11px] transition-colors hover:border-[var(--accent-color)]"
                                  title="续写"
                                  onClick={(e) => {
                                    e.stopPropagation()
                                    handleExtendTrack(track)
                                  }}
                                >
                                  续写
                                </button>
                                <button
                                  className="rounded-md border border-[var(--border-color)] px-2 py-1 text-[11px] transition-colors hover:border-[var(--accent-color)]"
                                  onClick={(e) => {
                                    e.stopPropagation()
                                    handleAddTrackToCanvas(track)
                                  }}
                                >
                                  上板
                                </button>
                                <button
                                  className="rounded-md bg-[var(--bg-tertiary)] p-1.5 text-[var(--text-secondary)] transition-colors hover:bg-[rgb(var(--accent-rgb)/0.15)] hover:text-[var(--accent-color)]"
                                  title="下载"
                                  onClick={(e) => {
                                    e.stopPropagation()
                                    downloadTrack(track)
                                  }}
                                >
                                  <Download className="h-3.5 w-3.5" />
                                </button>
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  </>
                ) : (
                  <>
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-semibold">歌词结果</span>
                      <div className="flex items-center gap-2">
                        <button
                          className="rounded-md border border-[var(--border-color)] px-2 py-1 text-[11px] transition-colors hover:border-[var(--accent-color)] disabled:opacity-50"
                          onClick={copyLyrics}
                          disabled={!lyricsResult}
                        >
                          <Copy className="mr-1 inline-block h-3 w-3" />
                          复制
                        </button>
                        <button
                          className="rounded-md border border-[var(--border-color)] px-2 py-1 text-[11px] transition-colors hover:border-[var(--accent-color)] disabled:opacity-50"
                          onClick={useLyricsForMusic}
                          disabled={!lyricsResult}
                        >
                          <Music className="mr-1 inline-block h-3 w-3" />
                          用于生成歌曲
                        </button>
                      </div>
                    </div>

                    <div className="flex-1 overflow-auto rounded-2xl border border-[var(--border-color)] bg-[var(--bg-primary)] p-4">
                      {!lyricsResult ? (
                        <div className="text-[11px] text-[var(--text-secondary)]">生成后将显示歌词内容</div>
                      ) : (
                        <textarea
                          value={lyricsResult}
                          readOnly
                          className="min-h-[320px] w-full resize-none bg-transparent text-sm text-[var(--text-primary)] outline-none"
                        />
                      )}
                    </div>
                  </>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between border-t border-[var(--border-color)] p-4">
          <div className="text-[11px] text-[var(--text-secondary)]">
            {statusText && !isGenerating && statusText}
          </div>
          <div className="flex items-center gap-3">
            <Button variant="ghost" onClick={onClose}>
              关闭
            </Button>
            {isGenerating ? (
              <Button variant="danger" onClick={handleStop}>
                <StopCircle className="mr-2 h-4 w-4" />
                停止
              </Button>
            ) : (
              <Button
                onClick={activeTab === 'music' ? handleGenerateMusic : handleGenerateLyrics}
                disabled={activeTab === 'music' ? !musicPrompt.trim() : !lyricsPrompt.trim()}
              >
                {activeTab === 'music' ? '生成音乐' : '生成歌词'}
              </Button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
