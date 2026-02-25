import React, { useCallback, useMemo, useSyncExternalStore } from 'react'
import { cn } from '@/lib/utils'
import { getShortDramaTaskQueue, type ShortDramaQueueStats } from '@/lib/shortDrama/taskQueue'
import type { ShortDramaDraftV2, ShortDramaMediaSlot, ShortDramaShot } from '@/lib/shortDrama/types'
import { Image, Video, Mic, AlertTriangle, RotateCw } from 'lucide-react'

interface Props {
  projectId: string
  draft: ShortDramaDraftV2
  currentEpisodeId?: string | null
  onRetryAllFailed?: () => void
}

function useQueueStats(projectId: string): ShortDramaQueueStats {
  const queue = getShortDramaTaskQueue(projectId)
  const subscribe = useCallback((cb: () => void) => queue.subscribe(cb), [queue])
  const getSnapshot = useCallback(() => queue.getStats(), [queue])
  return useSyncExternalStore(subscribe, getSnapshot)
}

type SlotStatus = 'empty' | 'running' | 'success' | 'error'

function slotStatus(slot?: ShortDramaMediaSlot): SlotStatus {
  if (!slot || slot.variants.length === 0) return 'empty'
  const sel = slot.selectedVariantId
    ? slot.variants.find(v => v.id === slot.selectedVariantId)
    : undefined
  if (sel) return sel.status === 'success' ? 'success' : sel.status === 'running' ? 'running' : 'error'
  const any = slot.variants.find(v => v.status === 'success')
  if (any) return 'success'
  if (slot.variants.some(v => v.status === 'running')) return 'running'
  if (slot.variants.some(v => v.status === 'error')) return 'error'
  return 'empty'
}

function countFailedVariants(shots: ShortDramaShot[]): { image: number; video: number; audio: number } {
  let image = 0, video = 0, audio = 0
  for (const shot of shots) {
    for (const v of shot.frames.start.slot.variants) if (v.status === 'error') image++
    for (const v of shot.frames.end.slot.variants) if (v.status === 'error') image++
    if (shot.gridSlot) for (const v of shot.gridSlot.variants) if (v.status === 'error') image++
    for (const v of shot.video.variants) if (v.status === 'error') video++
    if (shot.dialogueSlot) for (const v of shot.dialogueSlot.variants) if (v.status === 'error') audio++
    if (shot.narrationSlot) for (const v of shot.narrationSlot.variants) if (v.status === 'error') audio++
  }
  return { image, video, audio }
}

const STATUS_DOT: Record<SlotStatus, string> = {
  empty: 'bg-gray-400/40',
  running: 'bg-amber-400 animate-pulse',
  success: 'bg-emerald-500',
  error: 'bg-red-500',
}

export default function ShortDramaProgressDashboard({ projectId, draft, currentEpisodeId, onRetryAllFailed }: Props) {
  const stats = useQueueStats(projectId)

  const visibleShots = useMemo(() => {
    if (!currentEpisodeId) return draft.shots
    return draft.shots.filter(s => s.episodeId === currentEpisodeId)
  }, [draft.shots, currentEpisodeId])

  const slotSummary = useMemo(() => {
    let total = 0, success = 0, running = 0, error = 0
    const check = (s: SlotStatus) => { total++; if (s === 'success') success++; else if (s === 'running') running++; else if (s === 'error') error++ }
    for (const shot of visibleShots) {
      check(slotStatus(shot.frames.start.slot))
      if (shot.frameMode === 'first_last') check(slotStatus(shot.frames.end.slot))
      check(slotStatus(shot.video))
      if (shot.dialogueSlot) check(slotStatus(shot.dialogueSlot))
      if (shot.narrationSlot) check(slotStatus(shot.narrationSlot))
    }
    const pct = total > 0 ? Math.round((success / total) * 100) : 0
    return { total, success, running, error, pct }
  }, [visibleShots])

  const failedCounts = useMemo(() => countFailedVariants(visibleShots), [visibleShots])
  const totalFailed = failedCounts.image + failedCounts.video + failedCounts.audio

  const totalRunning = stats.runningImage + stats.runningVideo + stats.runningAudio + stats.runningAnalysis

  return (
    <div className="flex h-full flex-col gap-4 overflow-y-auto">
      {/* Queue status bars */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatCard icon={Image} label="图片" running={stats.runningImage} limit={stats.limits.imageConcurrency} queued={stats.queued} color="blue" />
        <StatCard icon={Video} label="视频" running={stats.runningVideo} limit={stats.limits.videoConcurrency} queued={0} color="purple" />
        <StatCard icon={Mic} label="音频" running={stats.runningAudio} limit={stats.limits.audioConcurrency} queued={0} color="emerald" />
        <div className="flex flex-col items-center justify-center rounded-xl border border-[var(--border-color)] bg-[var(--bg-primary)] p-3">
          <span className="text-2xl font-bold text-[var(--text-primary)]">{stats.queued}</span>
          <span className="text-xs text-[var(--text-secondary)]">排队中</span>
        </div>
      </div>

      {/* Overall progress */}
      <div className="rounded-xl border border-[var(--border-color)] bg-[var(--bg-primary)] p-4">
        <div className="mb-2 flex items-center justify-between text-sm">
          <span className="text-[var(--text-primary)] font-medium">整体进度</span>
          <span className="text-[var(--text-secondary)]">{slotSummary.success}/{slotSummary.total} 完成 · {slotSummary.pct}%</span>
        </div>
        <div className="h-2.5 w-full rounded-full bg-[var(--bg-secondary)] overflow-hidden">
          <div
            className="h-full rounded-full bg-emerald-500 transition-all duration-300"
            style={{ width: `${slotSummary.pct}%` }}
          />
        </div>
        <div className="mt-2 flex items-center gap-4 text-xs text-[var(--text-secondary)]">
          <span className="flex items-center gap-1"><span className="inline-block h-2 w-2 rounded-full bg-emerald-500" />{slotSummary.success} 成功</span>
          <span className="flex items-center gap-1"><span className="inline-block h-2 w-2 rounded-full bg-amber-400 animate-pulse" />{slotSummary.running} 运行中</span>
          <span className="flex items-center gap-1"><span className="inline-block h-2 w-2 rounded-full bg-red-500" />{slotSummary.error} 失败</span>
        </div>
      </div>

      {/* Retry failed */}
      {totalFailed > 0 && (
        <div className="flex items-center justify-between rounded-xl border border-red-500/20 bg-red-500/5 p-4">
          <div className="flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 text-red-500" />
            <span className="text-sm text-[var(--text-primary)]">
              {failedCounts.image > 0 && `${failedCounts.image} 张图片`}
              {failedCounts.video > 0 && `${failedCounts.image > 0 ? '、' : ''}${failedCounts.video} 个视频`}
              {failedCounts.audio > 0 && `${(failedCounts.image + failedCounts.video) > 0 ? '、' : ''}${failedCounts.audio} 条音频`}
              {' 生成失败'}
            </span>
          </div>
          {onRetryAllFailed && (
            <button
              type="button"
              onClick={onRetryAllFailed}
              disabled={totalRunning > 0 && stats.queued > 10}
              className="flex items-center gap-1.5 rounded-lg bg-red-500 px-3 py-1.5 text-xs font-medium text-white hover:bg-red-600 transition-colors disabled:opacity-50"
            >
              <RotateCw className="h-3.5 w-3.5" />
              重试全部失败 ({totalFailed})
            </button>
          )}
        </div>
      )}

      {/* Per-shot grid */}
      <div className="rounded-xl border border-[var(--border-color)] bg-[var(--bg-primary)] p-4">
        <div className="mb-3 text-sm font-medium text-[var(--text-primary)]">镜头状态一览</div>
        <div className="grid grid-cols-[repeat(auto-fill,minmax(180px,1fr))] gap-2">
          {visibleShots.map((shot, i) => {
            const startSt = slotStatus(shot.frames.start.slot)
            const videoSt = slotStatus(shot.video)
            const dlgSt = shot.dialogueSlot ? slotStatus(shot.dialogueSlot) : null
            const narSt = shot.narrationSlot ? slotStatus(shot.narrationSlot) : null
            return (
              <div key={shot.id} className="flex items-center gap-2 rounded-lg border border-[var(--border-color)] bg-[var(--bg-secondary)] px-3 py-2">
                <span className="text-xs font-mono text-[var(--text-secondary)] w-6 shrink-0">#{i + 1}</span>
                <span className="truncate text-xs text-[var(--text-primary)] flex-1" title={shot.title}>{shot.title}</span>
                <div className="flex items-center gap-1 shrink-0">
                  <span className={cn('h-2 w-2 rounded-full', STATUS_DOT[startSt])} title={`图片: ${startSt}`} />
                  <span className={cn('h-2 w-2 rounded-full', STATUS_DOT[videoSt])} title={`视频: ${videoSt}`} />
                  {dlgSt && <span className={cn('h-1.5 w-1.5 rounded-full', STATUS_DOT[dlgSt])} title={`对白: ${dlgSt}`} />}
                  {narSt && <span className={cn('h-1.5 w-1.5 rounded-full', STATUS_DOT[narSt])} title={`旁白: ${narSt}`} />}
                </div>
              </div>
            )
          })}
          {visibleShots.length === 0 && (
            <div className="col-span-full py-8 text-center text-sm text-[var(--text-secondary)]">暂无镜头，请先导入剧本并进行 AI 分析</div>
          )}
        </div>
      </div>
    </div>
  )
}

function StatCard({
  icon: Icon,
  label,
  running,
  limit,
  queued,
  color,
}: {
  icon: React.ElementType
  label: string
  running: number
  limit: number
  queued: number
  color: string
}) {
  const colorMap: Record<string, string> = {
    blue: 'text-blue-500',
    purple: 'text-purple-500',
    emerald: 'text-emerald-500',
  }
  return (
    <div className="flex flex-col items-center gap-1 rounded-xl border border-[var(--border-color)] bg-[var(--bg-primary)] p-3">
      <Icon className={cn('h-5 w-5', colorMap[color] || 'text-[var(--text-secondary)]')} />
      <span className="text-xs text-[var(--text-secondary)]">{label}</span>
      <span className="text-lg font-bold text-[var(--text-primary)]">{running}<span className="text-sm font-normal text-[var(--text-secondary)]">/{limit}</span></span>
    </div>
  )
}

export function QueueMiniBadge({ projectId }: { projectId: string }) {
  const stats = useQueueStats(projectId)
  const total = stats.runningImage + stats.runningVideo + stats.runningAudio + stats.runningAnalysis
  if (total === 0 && stats.queued === 0) return null
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-[var(--accent-color)]/10 px-2.5 py-0.5 text-xs text-[var(--accent-color)]">
      {total > 0 && <span className="h-1.5 w-1.5 rounded-full bg-[var(--accent-color)] animate-pulse" />}
      {total} 运行 · {stats.queued} 排队
    </span>
  )
}
