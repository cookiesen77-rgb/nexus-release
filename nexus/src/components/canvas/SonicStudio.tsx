/**
 * Sonic Studio | 音频工作室
 * Suno 文生音乐（生成歌曲 / 生成歌词）
 */

import React, { useState, useCallback } from 'react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import {
  X,
  Music,
  Download,
  Copy,
  Plus,
  Loader2
} from 'lucide-react'

interface Track {
  id: string
  title?: string
  model?: string
  audioUrl: string
  duration?: number
}

interface Props {
  open: boolean
  onClose: () => void
  onAddToCanvas: (data: { type: 'audio'; src: string; title?: string; model?: string }) => void
}

type TabId = 'music' | 'lyrics'

const modelOptions = [
  { label: 'Suno v4 (最新)', value: 'v4' },
  { label: 'Suno v3.5', value: 'v3.5' }
]

const createModeOptions = [
  { label: '全新创作', value: 'create' },
  { label: '续写模式', value: 'extend' }
]

const vocalOptions = [
  { label: '自动', value: 'auto' },
  { label: '女声', value: 'female' },
  { label: '男声', value: 'male' },
  { label: '无人声', value: 'instrumental' }
]

export default function SonicStudio({ open, onClose, onAddToCanvas }: Props) {
  const [activeTab, setActiveTab] = useState<TabId>('music')

  // Music form state
  const [musicTitle, setMusicTitle] = useState('')
  const [musicTags, setMusicTags] = useState('')
  const [musicNegativeTags, setMusicNegativeTags] = useState('')
  const [musicPrompt, setMusicPrompt] = useState('')
  const [modelVersion, setModelVersion] = useState('v4')
  const [createMode, setCreateMode] = useState('create')
  const [vocalGender, setVocalGender] = useState('auto')
  const [continueTaskId, setContinueTaskId] = useState('')
  const [continueClipId, setContinueClipId] = useState('')
  const [continueAt, setContinueAt] = useState('')

  // Lyrics form state
  const [lyricsTitle, setLyricsTitle] = useState('')
  const [lyricsTags, setLyricsTags] = useState('')
  const [lyricsNegativeTags, setLyricsNegativeTags] = useState('')
  const [lyricsPrompt, setLyricsPrompt] = useState('')
  const [lyricsResult, setLyricsResult] = useState('')

  // Track state
  const [tracks, setTracks] = useState<Track[]>([])
  const [currentTrack, setCurrentTrack] = useState<Track | null>(null)

  // Generation state
  const [isGenerating, setIsGenerating] = useState(false)
  const [progress, setProgress] = useState(0)

  const formatDuration = (seconds: number): string => {
    const mins = Math.floor(seconds / 60)
    const secs = Math.floor(seconds % 60)
    return `${mins}:${secs.toString().padStart(2, '0')}`
  }

  const handleGenerateMusic = useCallback(async () => {
    if (!musicPrompt.trim() || isGenerating) return

    setIsGenerating(true)
    setProgress(0)

    try {
      // TODO: Implement actual Suno API call
      // Simulating generation for now
      await new Promise((resolve) => setTimeout(resolve, 3000))

      const newTrack: Track = {
        id: `track_${Date.now()}`,
        title: musicTitle || '新音乐',
        model: `Suno ${modelVersion}`,
        audioUrl: '', // Will be filled by actual API
        duration: 120
      }

      setTracks((prev) => [newTrack, ...prev])
      setCurrentTrack(newTrack)
    } finally {
      setIsGenerating(false)
    }
  }, [musicPrompt, musicTitle, modelVersion, isGenerating])

  const handleGenerateLyrics = useCallback(async () => {
    if (!lyricsPrompt.trim() || isGenerating) return

    setIsGenerating(true)

    try {
      // TODO: Implement actual lyrics generation
      await new Promise((resolve) => setTimeout(resolve, 2000))
      setLyricsResult(`[示例歌词]\n\n${lyricsTitle || '无题'}\n\n${lyricsPrompt}\n\n(这是生成的歌词预览)`)
    } finally {
      setIsGenerating(false)
    }
  }, [lyricsPrompt, lyricsTitle, isGenerating])

  const handleAddTrackToCanvas = useCallback(
    (track: Track) => {
      onAddToCanvas({
        type: 'audio',
        src: track.audioUrl,
        title: track.title,
        model: track.model
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
  }, [lyricsResult])

  const insertLyrics = useCallback(() => {
    if (!lyricsResult) return
    // Could create a text node on canvas
    onClose()
  }, [lyricsResult, onClose])

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
          <button
            onClick={onClose}
            className="rounded-full p-1 text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-primary)] hover:text-[var(--text-primary)]"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-auto p-5">
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <span className="text-xs text-[var(--text-secondary)]">Suno 文生音乐（生成歌曲 / 生成歌词）</span>
              {isGenerating && (
                <span className="text-[11px] text-[var(--text-secondary)]">生成中 {progress}%</span>
              )}
            </div>

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

                    <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                      <div className="flex flex-col gap-2">
                        <label className="text-[11px] font-bold uppercase text-[var(--text-secondary)]">模型版本</label>
                        <select
                          value={modelVersion}
                          onChange={(e) => setModelVersion(e.target.value)}
                          className="rounded-lg border border-[var(--border-color)] bg-[var(--bg-primary)] px-3 py-2 text-sm text-[var(--text-primary)] focus:border-[var(--accent-color)] focus:outline-none"
                        >
                          {modelOptions.map((opt) => (
                            <option key={opt.value} value={opt.value}>
                              {opt.label}
                            </option>
                          ))}
                        </select>
                      </div>
                      <div className="flex flex-col gap-2">
                        <label className="text-[11px] font-bold uppercase text-[var(--text-secondary)]">生成模式</label>
                        <select
                          value={createMode}
                          onChange={(e) => setCreateMode(e.target.value)}
                          className="rounded-lg border border-[var(--border-color)] bg-[var(--bg-primary)] px-3 py-2 text-sm text-[var(--text-primary)] focus:border-[var(--accent-color)] focus:outline-none"
                        >
                          {createModeOptions.map((opt) => (
                            <option key={opt.value} value={opt.value}>
                              {opt.label}
                            </option>
                          ))}
                        </select>
                      </div>
                    </div>

                    <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                      <div className="flex flex-col gap-2">
                        <label className="text-[11px] font-bold uppercase text-[var(--text-secondary)]">人声音色</label>
                        <select
                          value={vocalGender}
                          onChange={(e) => setVocalGender(e.target.value)}
                          className="rounded-lg border border-[var(--border-color)] bg-[var(--bg-primary)] px-3 py-2 text-sm text-[var(--text-primary)] focus:border-[var(--accent-color)] focus:outline-none"
                        >
                          {vocalOptions.map((opt) => (
                            <option key={opt.value} value={opt.value}>
                              {opt.label}
                            </option>
                          ))}
                        </select>
                      </div>
                      <div className="flex flex-col gap-2">
                        <label className="text-[11px] font-bold uppercase text-[var(--text-secondary)]">
                          不希望出现的风格
                        </label>
                        <input
                          value={musicNegativeTags}
                          onChange={(e) => setMusicNegativeTags(e.target.value)}
                          placeholder="如：metal, heavy drums"
                          className="rounded-lg border border-[var(--border-color)] bg-[var(--bg-primary)] px-3 py-2 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-secondary)] focus:border-[var(--accent-color)] focus:outline-none"
                        />
                      </div>
                    </div>

                    {createMode === 'extend' && (
                      <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
                        <div className="flex flex-col gap-2">
                          <label className="text-[11px] font-bold uppercase text-[var(--text-secondary)]">
                            续写 Task ID
                          </label>
                          <input
                            value={continueTaskId}
                            onChange={(e) => setContinueTaskId(e.target.value)}
                            placeholder="可选"
                            className="rounded-lg border border-[var(--border-color)] bg-[var(--bg-primary)] px-3 py-2 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-secondary)] focus:border-[var(--accent-color)] focus:outline-none"
                          />
                        </div>
                        <div className="flex flex-col gap-2">
                          <label className="text-[11px] font-bold uppercase text-[var(--text-secondary)]">
                            续写 Clip ID
                          </label>
                          <input
                            value={continueClipId}
                            onChange={(e) => setContinueClipId(e.target.value)}
                            placeholder="必填其一"
                            className="rounded-lg border border-[var(--border-color)] bg-[var(--bg-primary)] px-3 py-2 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-secondary)] focus:border-[var(--accent-color)] focus:outline-none"
                          />
                        </div>
                        <div className="flex flex-col gap-2">
                          <label className="text-[11px] font-bold uppercase text-[var(--text-secondary)]">
                            续写起始秒
                          </label>
                          <input
                            value={continueAt}
                            onChange={(e) => setContinueAt(e.target.value)}
                            placeholder="如：60.5"
                            className="rounded-lg border border-[var(--border-color)] bg-[var(--bg-primary)] px-3 py-2 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-secondary)] focus:border-[var(--accent-color)] focus:outline-none"
                          />
                        </div>
                      </div>
                    )}

                    <div className="flex flex-col gap-2">
                      <div className="flex items-center justify-between">
                        <label className="text-[11px] font-bold uppercase text-[var(--text-secondary)]">
                          提示词 / 歌词
                        </label>
                        <span className="text-[10px] text-[var(--text-secondary)]">{musicPrompt.length}/1200</span>
                      </div>
                      <textarea
                        value={musicPrompt}
                        onChange={(e) => setMusicPrompt(e.target.value)}
                        placeholder="描述歌曲主题、节奏、情绪，也可以直接写歌词。"
                        maxLength={1200}
                        className="min-h-[180px] w-full resize-none rounded-xl border border-[var(--border-color)] bg-[var(--bg-primary)] p-3 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-secondary)] focus:border-[var(--accent-color)] focus:outline-none"
                      />
                    </div>

                    <div className="rounded-xl border border-[var(--border-color)] bg-[var(--bg-primary)] p-3 text-[11px] leading-relaxed text-[var(--text-secondary)]">
                      建议：使用"风格 + 乐器 + 情绪 + 节奏"的结构，例如：
                      <span className="text-[var(--text-primary)]">
                        电影感、慢节奏、合成器铺底、温柔女声、夜雨城市
                      </span>
                      。
                    </div>
                  </>
                ) : (
                  <>
                    <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                      <div className="flex flex-col gap-2">
                        <label className="text-[11px] font-bold uppercase text-[var(--text-secondary)]">歌词标题</label>
                        <input
                          value={lyricsTitle}
                          onChange={(e) => setLyricsTitle(e.target.value)}
                          placeholder="可选，如：城市雨夜"
                          className="rounded-lg border border-[var(--border-color)] bg-[var(--bg-primary)] px-3 py-2 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-secondary)] focus:border-[var(--accent-color)] focus:outline-none"
                        />
                      </div>
                      <div className="flex flex-col gap-2">
                        <label className="text-[11px] font-bold uppercase text-[var(--text-secondary)]">风格标签</label>
                        <input
                          value={lyricsTags}
                          onChange={(e) => setLyricsTags(e.target.value)}
                          placeholder="如：drama, romance, cyber"
                          className="rounded-lg border border-[var(--border-color)] bg-[var(--bg-primary)] px-3 py-2 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-secondary)] focus:border-[var(--accent-color)] focus:outline-none"
                        />
                      </div>
                    </div>

                    <div className="flex flex-col gap-2">
                      <label className="text-[11px] font-bold uppercase text-[var(--text-secondary)]">
                        不希望出现的风格
                      </label>
                      <input
                        value={lyricsNegativeTags}
                        onChange={(e) => setLyricsNegativeTags(e.target.value)}
                        placeholder="如：metal, heavy drums"
                        className="rounded-lg border border-[var(--border-color)] bg-[var(--bg-primary)] px-3 py-2 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-secondary)] focus:border-[var(--accent-color)] focus:outline-none"
                      />
                    </div>

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
                            <div className="flex items-center justify-between gap-3">
                              <div className="min-w-0">
                                <div className="truncate text-sm font-semibold">{currentTrack.title || '音频'}</div>
                                <div className="truncate text-[11px] text-[var(--text-secondary)]">
                                  {currentTrack.model || 'Suno'}
                                </div>
                              </div>
                              <button
                                className="rounded-md border border-[var(--border-color)] px-2 py-1 text-[11px] transition-colors hover:border-[var(--accent-color)]"
                                onClick={() => handleAddTrackToCanvas(currentTrack)}
                              >
                                上板
                              </button>
                            </div>
                            <audio src={currentTrack.audioUrl} controls className="mt-3 w-full" />
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
                            className="group cursor-pointer rounded-xl border border-[var(--border-color)] bg-[var(--bg-primary)] p-3 transition-colors hover:border-[var(--accent-color)]"
                            onClick={() => setCurrentTrack(track)}
                          >
                            <div className="flex items-center justify-between gap-3">
                              <div className="flex min-w-0 items-center gap-2">
                                <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-[var(--bg-tertiary)]">
                                  <Music className="h-[18px] w-[18px]" />
                                </div>
                                <div className="min-w-0">
                                  <div className="truncate text-sm">{track.title || '音频'}</div>
                                  <div className="truncate text-[11px] text-[var(--text-secondary)]">
                                    {track.model || 'Suno'}
                                  </div>
                                </div>
                              </div>
                              <div className="flex shrink-0 items-center gap-2">
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
                            {track.duration && (
                              <div className="mt-2 text-[11px] text-[var(--text-secondary)]">
                                时长: {formatDuration(track.duration)}
                              </div>
                            )}
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
                          onClick={insertLyrics}
                          disabled={!lyricsResult}
                        >
                          <Plus className="mr-1 inline-block h-3 w-3" />
                          上板
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
        <div className="flex items-center justify-end gap-3 border-t border-[var(--border-color)] p-4">
          <Button variant="ghost" onClick={onClose}>
            关闭
          </Button>
          <Button
            onClick={activeTab === 'music' ? handleGenerateMusic : handleGenerateLyrics}
            disabled={isGenerating || (activeTab === 'music' ? !musicPrompt.trim() : !lyricsPrompt.trim())}
          >
            {isGenerating && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {activeTab === 'music' ? '生成音乐' : '生成歌词'}
          </Button>
        </div>
      </div>
    </div>
  )
}
