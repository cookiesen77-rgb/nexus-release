import React, { useState, useRef, useCallback } from 'react'
import { Music, Upload, Trash2, Plus, Wand2, Volume2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { safeFetch } from '@/lib/safeFetch'
import {
  importBGM,
  addBGMToDraft,
  removeBGMFromDraft,
  assignBGMToRange,
  removeBGMAssignment,
  updateBGMAssignment,
  matchBGMToShots,
} from '@/lib/shortDrama/bgmManager'
import type { ShortDramaDraftV2, ShortDramaBGMAssignment } from '@/lib/shortDrama/types'

interface Props {
  draft: ShortDramaDraftV2
  setDraft: React.Dispatch<React.SetStateAction<ShortDramaDraftV2>>
  projectId: string
}

const fmtDur = (ms: number) => {
  const s = Math.round(ms / 1000)
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

const GENRE_LABELS: Record<string, string> = {
  action: '动作',
  romance: '浪漫',
  suspense: '悬疑',
  comedy: '喜剧',
  epic: '史诗',
  calm: '舒缓',
  mysterious: '神秘',
}

const GENRE_COLORS: Record<string, string> = {
  action: 'bg-red-500/15 text-red-400',
  romance: 'bg-pink-500/15 text-pink-400',
  suspense: 'bg-amber-500/15 text-amber-400',
  comedy: 'bg-yellow-500/15 text-yellow-400',
  epic: 'bg-purple-500/15 text-purple-400',
  calm: 'bg-cyan-500/15 text-cyan-400',
  mysterious: 'bg-indigo-500/15 text-indigo-400',
}

const eqBarKeyframes = `
@keyframes eqBar1 { 0%,100%{height:3px} 50%{height:12px} }
@keyframes eqBar2 { 0%,100%{height:8px} 50%{height:4px} }
@keyframes eqBar3 { 0%,100%{height:5px} 50%{height:14px} }
`

function EqualizerBars() {
  return (
    <div className="flex items-end gap-[2px] h-[14px]">
      <span className="w-[2px] rounded-full bg-emerald-400" style={{ animation: 'eqBar1 0.8s ease-in-out infinite' }} />
      <span className="w-[2px] rounded-full bg-emerald-400" style={{ animation: 'eqBar2 0.6s ease-in-out infinite 0.15s' }} />
      <span className="w-[2px] rounded-full bg-emerald-400" style={{ animation: 'eqBar3 0.7s ease-in-out infinite 0.3s' }} />
    </div>
  )
}

function MiniWaveform() {
  return (
    <div
      className="h-5 w-16 rounded-sm opacity-40 flex-shrink-0"
      style={{
        background: `repeating-linear-gradient(90deg,
          var(--text-secondary) 0px, var(--text-secondary) 1px,
          transparent 1px, transparent 3px),
          linear-gradient(0deg,
          transparent 0%, transparent 30%,
          var(--text-secondary) 30%, var(--text-secondary) 35%,
          transparent 35%, transparent 45%,
          var(--text-secondary) 45%, var(--text-secondary) 55%,
          transparent 55%, transparent 65%,
          var(--text-secondary) 65%, var(--text-secondary) 70%,
          transparent 70%, transparent 100%)`,
      }}
    />
  )
}

export default function ShortDramaBGMPanel({ draft, setDraft, projectId }: Props) {
  const fileRef = useRef<HTMLInputElement>(null)
  const [playingId, setPlayingId] = useState<string | null>(null)
  const audioRef = useRef<HTMLAudioElement | null>(null)

  const [showAddForm, setShowAddForm] = useState(false)
  const [formTrackId, setFormTrackId] = useState('')
  const [formStart, setFormStart] = useState(0)
  const [formEnd, setFormEnd] = useState(0)
  const [formVolume, setFormVolume] = useState(0.5)

  const library = draft.bgmLibrary || []
  const assignments = draft.bgmAssignments || []

  const togglePlay = useCallback(async (trackId: string, url: string) => {
    if (playingId === trackId) {
      audioRef.current?.pause()
      audioRef.current = null
      setPlayingId(null)
      return
    }
    audioRef.current?.pause()

    let playableUrl = url
    if (/^https?:\/\//i.test(url)) {
      try {
        const resp = await safeFetch(url)
        const blob = await resp.blob()
        playableUrl = URL.createObjectURL(blob)
      } catch { /* use original url as fallback */ }
    }

    const audio = new Audio(playableUrl)
    audio.onended = () => setPlayingId(null)
    audio.play()
    audioRef.current = audio
    setPlayingId(trackId)
  }, [playingId])

  const handleUpload = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    e.target.value = ''
    const track = await importBGM(file, projectId)
    setDraft(prev => addBGMToDraft(prev, track))
  }, [projectId, setDraft])

  const handleAutoMatch = useCallback(() => {
    const results = matchBGMToShots(draft)
    setDraft(prev => ({
      ...prev,
      bgmAssignments: results,
      updatedAt: Date.now(),
    }))
  }, [draft, setDraft])

  const handleAddAssignment = useCallback(() => {
    if (!formTrackId) return
    const assignment: ShortDramaBGMAssignment = {
      id: crypto.randomUUID(),
      trackId: formTrackId,
      shotRange: [formStart, formEnd],
      volume: formVolume,
      fadeInMs: 1000,
      fadeOutMs: 1000,
    }
    setDraft(prev => assignBGMToRange(prev, assignment))
    setShowAddForm(false)
    setFormTrackId('')
    setFormStart(0)
    setFormEnd(0)
    setFormVolume(0.5)
  }, [formTrackId, formStart, formEnd, formVolume, setDraft])

  return (
    <div className="flex flex-col gap-5 p-3">
      <style>{eqBarKeyframes}</style>

      {/* BGM Library */}
      <section>
        <div className="flex items-center justify-between mb-3">
          <h4 className="text-xs font-semibold uppercase tracking-wider text-[var(--text-primary)] flex items-center gap-2 pl-2.5 border-l-2 border-emerald-500">
            <Music className="h-3.5 w-3.5 text-emerald-400" />
            BGM Library
          </h4>
          <div className="flex items-center gap-1">
            <Button
              size="sm"
              variant="default"
              className="h-7 px-2.5 text-xs gap-1.5"
              onClick={() => fileRef.current?.click()}
            >
              <Upload className="h-3 w-3" />
              导入
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className="h-7 px-2 text-xs gap-1"
              onClick={handleAutoMatch}
              disabled={library.length === 0}
              title="根据镜头BGM提示自动匹配"
            >
              <Wand2 className="h-3 w-3" />
              自动匹配
            </Button>
          </div>
        </div>
        <input ref={fileRef} type="file" accept="audio/*" onChange={handleUpload} className="hidden" />

        {library.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-8 border border-dashed border-[var(--border-color)] rounded-lg bg-[var(--bg-primary)]/40">
            <Music className="h-6 w-6 text-[var(--text-secondary)] opacity-30 mb-2" />
            <span className="text-[11px] text-[var(--text-secondary)]">暂无 BGM，点击"导入"添加音频文件</span>
          </div>
        ) : (
          <div className="flex flex-col gap-1.5">
            {library.map(track => {
              const isPlaying = playingId === track.id
              return (
                <div
                  key={track.id}
                  className={cn(
                    'flex items-center gap-2.5 px-3 py-2 rounded-md border transition-all duration-150 group',
                    isPlaying
                      ? 'bg-emerald-500/5 border-emerald-500/30'
                      : 'bg-[var(--bg-primary)] border-[var(--border-color)] hover:border-[var(--text-secondary)]/30',
                  )}
                >
                  <button
                    onClick={() => togglePlay(track.id, track.url)}
                    className={cn(
                      'flex items-center justify-center w-7 h-7 rounded-md flex-shrink-0 transition-all duration-150',
                      isPlaying
                        ? 'bg-emerald-500/20'
                        : 'bg-[var(--bg-secondary)] hover:bg-emerald-500/15',
                    )}
                  >
                    {isPlaying ? (
                      <EqualizerBars />
                    ) : (
                      <Volume2 className="h-3.5 w-3.5 text-[var(--text-secondary)] group-hover:text-emerald-400 transition-colors" />
                    )}
                  </button>

                  <div className="flex flex-col flex-1 min-w-0 gap-0.5">
                    <span className="text-[11px] font-medium text-[var(--text-primary)] truncate">{track.name}</span>
                    <div className="flex items-center gap-2">
                      <MiniWaveform />
                      <span className="text-[10px] text-[var(--text-secondary)] tabular-nums">{fmtDur(track.durationMs)}</span>
                    </div>
                  </div>

                  {track.genre && (
                    <span className={cn(
                      'px-1.5 py-0.5 rounded text-[10px] font-medium flex-shrink-0',
                      GENRE_COLORS[track.genre] || 'bg-[var(--accent-color)]/15 text-[var(--accent-color)]',
                    )}>
                      {GENRE_LABELS[track.genre] || track.genre}
                    </span>
                  )}

                  <button
                    onClick={() => setDraft(prev => removeBGMFromDraft(prev, track.id))}
                    className="p-1 rounded text-[var(--text-secondary)] opacity-0 group-hover:opacity-100 hover:text-red-400 hover:bg-red-500/10 transition-all duration-150 flex-shrink-0"
                  >
                    <Trash2 className="h-3 w-3" />
                  </button>
                </div>
              )
            })}
          </div>
        )}
      </section>

      {/* Assignments */}
      <section>
        <div className="flex items-center justify-between mb-3">
          <h4 className="text-xs font-semibold uppercase tracking-wider text-[var(--text-primary)] pl-2.5 border-l-2 border-emerald-500">
            BGM Assignments
          </h4>
          <Button
            size="sm"
            variant="ghost"
            className="h-7 px-2 text-xs gap-1"
            onClick={() => setShowAddForm(true)}
            disabled={library.length === 0}
          >
            <Plus className="h-3 w-3" />
            添加
          </Button>
        </div>

        {assignments.length === 0 && !showAddForm && (
          <div className="flex flex-col items-center justify-center py-6 border border-dashed border-[var(--border-color)] rounded-lg bg-[var(--bg-primary)]/40">
            <span className="text-[11px] text-[var(--text-secondary)]">暂无 BGM 分配</span>
          </div>
        )}

        <div className="flex flex-col gap-2">
          {assignments.map(a => {
            const track = library.find(t => t.id === a.trackId)
            return (
              <div
                key={a.id}
                className="rounded-md border border-[var(--border-color)] bg-[var(--bg-primary)] overflow-hidden transition-colors hover:border-[var(--text-secondary)]/30"
              >
                <div className="flex items-center justify-between px-3 py-2 border-b border-[var(--border-color)]/50">
                  <div className="flex items-center gap-2 min-w-0">
                    <Music className="h-3 w-3 text-emerald-400 flex-shrink-0" />
                    <span className="text-[11px] font-medium text-[var(--text-primary)] truncate">
                      {track?.name || '未知曲目'}
                    </span>
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0">
                    {a.shotRange && (
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-[var(--bg-secondary)] text-[var(--text-secondary)] tabular-nums">
                        #{a.shotRange[0] + 1} - #{a.shotRange[1] + 1}
                      </span>
                    )}
                    <button
                      onClick={() => setDraft(prev => removeBGMAssignment(prev, a.id))}
                      className="p-0.5 rounded text-[var(--text-secondary)] hover:text-red-400 hover:bg-red-500/10 transition-colors"
                    >
                      <Trash2 className="h-3 w-3" />
                    </button>
                  </div>
                </div>

                <div className="px-3 py-2 space-y-2">
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] text-[var(--text-secondary)] w-6">VOL</span>
                    <div className="flex-1 relative h-1.5 rounded-full bg-[var(--bg-secondary)] overflow-hidden">
                      <div
                        className="absolute inset-y-0 left-0 rounded-full"
                        style={{
                          width: `${a.volume * 100}%`,
                          background: 'linear-gradient(90deg, #059669, #34d399)',
                        }}
                      />
                    </div>
                    <input
                      type="range"
                      min={0}
                      max={1}
                      step={0.05}
                      value={a.volume}
                      onChange={e => setDraft(prev => updateBGMAssignment(prev, a.id, { volume: Number(e.target.value) }))}
                      className="absolute inset-0 w-full opacity-0 cursor-pointer"
                      style={{ position: 'absolute', left: 0, right: 0, top: 0, bottom: 0 }}
                    />
                    <span className="text-[10px] text-[var(--text-secondary)] w-8 text-right tabular-nums">{Math.round(a.volume * 100)}%</span>
                  </div>

                  <div className="flex items-center gap-4">
                    <label className="flex items-center gap-1.5 text-[10px] text-[var(--text-secondary)]">
                      <span className="text-emerald-400/70">IN</span>
                      <input
                        type="number"
                        min={0}
                        step={100}
                        value={a.fadeInMs || 0}
                        onChange={e => setDraft(prev => updateBGMAssignment(prev, a.id, { fadeInMs: Number(e.target.value) }))}
                        className="w-14 px-1.5 py-0.5 rounded bg-[var(--bg-secondary)] border border-[var(--border-color)] text-[var(--text-primary)] text-[10px] tabular-nums focus:border-emerald-500/50 focus:outline-none transition-colors"
                      />
                      <span>ms</span>
                    </label>
                    <label className="flex items-center gap-1.5 text-[10px] text-[var(--text-secondary)]">
                      <span className="text-emerald-400/70">OUT</span>
                      <input
                        type="number"
                        min={0}
                        step={100}
                        value={a.fadeOutMs || 0}
                        onChange={e => setDraft(prev => updateBGMAssignment(prev, a.id, { fadeOutMs: Number(e.target.value) }))}
                        className="w-14 px-1.5 py-0.5 rounded bg-[var(--bg-secondary)] border border-[var(--border-color)] text-[var(--text-primary)] text-[10px] tabular-nums focus:border-emerald-500/50 focus:outline-none transition-colors"
                      />
                      <span>ms</span>
                    </label>
                  </div>
                </div>
              </div>
            )
          })}
        </div>

        {showAddForm && (
          <div className="mt-2 rounded-md border border-emerald-500/30 bg-[var(--bg-primary)] overflow-hidden">
            <div className="px-3 py-1.5 border-b border-emerald-500/20 bg-emerald-500/5">
              <span className="text-[10px] font-semibold uppercase tracking-wider text-emerald-400">New Assignment</span>
            </div>
            <div className="p-3 space-y-2.5">
              <select
                value={formTrackId}
                onChange={e => setFormTrackId(e.target.value)}
                className="w-full px-2.5 py-1.5 rounded bg-[var(--bg-secondary)] border border-[var(--border-color)] text-[var(--text-primary)] text-[11px] focus:border-emerald-500/50 focus:outline-none transition-colors"
              >
                <option value="">选择曲目</option>
                {library.map(t => (
                  <option key={t.id} value={t.id}>{t.name}</option>
                ))}
              </select>
              <div className="flex items-center gap-3">
                <label className="flex items-center gap-1.5 text-[10px] text-[var(--text-secondary)]">
                  起始
                  <input
                    type="number"
                    min={0}
                    max={draft.shots.length - 1}
                    value={formStart}
                    onChange={e => setFormStart(Number(e.target.value))}
                    className="w-12 px-1.5 py-0.5 rounded bg-[var(--bg-secondary)] border border-[var(--border-color)] text-[var(--text-primary)] text-[10px] tabular-nums focus:border-emerald-500/50 focus:outline-none transition-colors"
                  />
                </label>
                <label className="flex items-center gap-1.5 text-[10px] text-[var(--text-secondary)]">
                  结束
                  <input
                    type="number"
                    min={0}
                    max={draft.shots.length - 1}
                    value={formEnd}
                    onChange={e => setFormEnd(Number(e.target.value))}
                    className="w-12 px-1.5 py-0.5 rounded bg-[var(--bg-secondary)] border border-[var(--border-color)] text-[var(--text-primary)] text-[10px] tabular-nums focus:border-emerald-500/50 focus:outline-none transition-colors"
                  />
                </label>
                <label className="flex items-center gap-1.5 text-[10px] text-[var(--text-secondary)]">
                  音量
                  <input
                    type="number"
                    min={0}
                    max={1}
                    step={0.05}
                    value={formVolume}
                    onChange={e => setFormVolume(Number(e.target.value))}
                    className="w-12 px-1.5 py-0.5 rounded bg-[var(--bg-secondary)] border border-[var(--border-color)] text-[var(--text-primary)] text-[10px] tabular-nums focus:border-emerald-500/50 focus:outline-none transition-colors"
                  />
                </label>
              </div>
              <div className="flex items-center gap-2 justify-end pt-1">
                <Button size="sm" variant="ghost" className="h-6 px-2.5 text-[11px]" onClick={() => setShowAddForm(false)}>取消</Button>
                <Button size="sm" className="h-6 px-2.5 text-[11px]" onClick={handleAddAssignment} disabled={!formTrackId}>确定</Button>
              </div>
            </div>
          </div>
        )}
      </section>
    </div>
  )
}
