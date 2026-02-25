export type ShortDramaTaskKind = 'image' | 'video' | 'analysis' | 'audio'

export interface ShortDramaQueueLimits {
  imageConcurrency: number
  videoConcurrency: number
  analysisConcurrency: number
  audioConcurrency: number
}

export interface ShortDramaQueuedTask<T> {
  id: string
  kind: ShortDramaTaskKind
  key: string
  promise: Promise<T>
  cancel: () => void
}

type InternalTask<T> = {
  id: string
  kind: ShortDramaTaskKind
  key: string
  started: boolean
  cancelled: boolean
  run: () => Promise<T>
  resolve: (v: T) => void
  reject: (e: any) => void
}

type AdaptiveKind = 'image' | 'video' | 'audio'

const makeId = () => globalThis.crypto?.randomUUID?.() || `sd_task_${Date.now()}_${Math.random().toString(16).slice(2)}`

const clampInt = (v: unknown, min: number, max: number, fallback: number) => {
  const n = Number(v)
  if (!Number.isFinite(n)) return fallback
  return Math.max(min, Math.min(max, Math.floor(n)))
}

const isRateLimitedError = (err: any) => {
  const msg = String(err?.message || err || '').toLowerCase()
  if (!msg) return false
  return /429|rate\s*limit|too\s*many\s*requests|limit\s*exceeded|throttle|throttl|quota|server\s*busy|overload|service\s*unavailable|负载|限流|限速|拥塞/.test(msg)
}

export type ShortDramaQueueStats = ReturnType<ShortDramaTaskQueue['getStats']>

export class ShortDramaTaskQueue {
  private baseLimits: ShortDramaQueueLimits = { imageConcurrency: 4, videoConcurrency: 2, analysisConcurrency: 1, audioConcurrency: 3 }
  private limits: ShortDramaQueueLimits = { imageConcurrency: 4, videoConcurrency: 2, analysisConcurrency: 1, audioConcurrency: 3 }

  private runningKeys = new Set<string>()

  private runningImage = 0
  private runningVideo = 0
  private runningAnalysis = 0
  private runningAudio = 0

  private queue: InternalTask<any>[] = []
  private pumping = false

  private listeners = new Set<() => void>()
  private cachedStats: ReturnType<ShortDramaTaskQueue['_buildStats']> | null = null

  subscribe(fn: () => void): () => void {
    this.listeners.add(fn)
    return () => { this.listeners.delete(fn) }
  }

  private notify() {
    this.cachedStats = null
    for (const fn of this.listeners) fn()
  }

  private successStreak: Record<AdaptiveKind, number> = { image: 0, video: 0, audio: 0 }
  private failureStreak: Record<AdaptiveKind, number> = { image: 0, video: 0, audio: 0 }
  private lastScaleAt: Record<AdaptiveKind, number> = { image: 0, video: 0, audio: 0 }
  private scaleUpBlockedUntil: Record<AdaptiveKind, number> = { image: 0, video: 0, audio: 0 }

  setLimits(limits: Partial<ShortDramaQueueLimits>) {
    this.baseLimits = {
      imageConcurrency: clampInt(limits.imageConcurrency ?? this.baseLimits.imageConcurrency, 1, 12, this.baseLimits.imageConcurrency),
      videoConcurrency: clampInt(limits.videoConcurrency ?? this.baseLimits.videoConcurrency, 1, 6, this.baseLimits.videoConcurrency),
      analysisConcurrency: clampInt(limits.analysisConcurrency ?? this.baseLimits.analysisConcurrency, 1, 2, this.baseLimits.analysisConcurrency),
      audioConcurrency: clampInt(limits.audioConcurrency ?? this.baseLimits.audioConcurrency, 1, 8, this.baseLimits.audioConcurrency),
    }

    this.limits = {
      imageConcurrency: clampInt(this.limits.imageConcurrency, 1, this.getAdaptiveMax('image'), this.baseLimits.imageConcurrency),
      videoConcurrency: clampInt(this.limits.videoConcurrency, 1, this.getAdaptiveMax('video'), this.baseLimits.videoConcurrency),
      analysisConcurrency: this.baseLimits.analysisConcurrency,
      audioConcurrency: clampInt(this.limits.audioConcurrency, 1, this.getAdaptiveMax('audio'), this.baseLimits.audioConcurrency),
    }

    if (this.limits.imageConcurrency < this.baseLimits.imageConcurrency) {
      this.limits.imageConcurrency = this.baseLimits.imageConcurrency
    }
    if (this.limits.videoConcurrency < this.baseLimits.videoConcurrency) {
      this.limits.videoConcurrency = this.baseLimits.videoConcurrency
    }
    if (this.limits.audioConcurrency < this.baseLimits.audioConcurrency) {
      this.limits.audioConcurrency = this.baseLimits.audioConcurrency
    }

    this.pump()
  }

  getLimits(): ShortDramaQueueLimits {
    return { ...this.limits }
  }

  private _buildStats() {
    return {
      queued: this.queue.length,
      runningImage: this.runningImage,
      runningVideo: this.runningVideo,
      runningAnalysis: this.runningAnalysis,
      runningAudio: this.runningAudio,
      runningKeys: this.runningKeys.size,
      limits: this.getLimits(),
      baseLimits: { ...this.baseLimits },
    }
  }

  getStats() {
    if (!this.cachedStats) this.cachedStats = this._buildStats()
    return this.cachedStats
  }

  enqueue<T>(kind: ShortDramaTaskKind, key: string, run: () => Promise<T>): ShortDramaQueuedTask<T> {
    const id = makeId()
    let cancelFn: (() => void) | null = null
    const promise = new Promise<T>((resolve, reject) => {
      const task: InternalTask<T> = {
        id,
        kind,
        key: String(key || ''),
        started: false,
        cancelled: false,
        run,
        resolve,
        reject,
      }
      cancelFn = () => {
        if (task.cancelled) return
        task.cancelled = true
        if (!task.started) {
          this.queue = this.queue.filter((t) => t.id !== task.id)
          task.reject(new Error('已取消'))
        }
      }
      this.queue.push(task)
      this.pump()
    })
    return { id, kind, key: String(key || ''), promise, cancel: () => cancelFn?.() }
  }

  private getAdaptiveMax(kind: AdaptiveKind) {
    if (kind === 'image') return Math.max(1, Math.min(16, this.baseLimits.imageConcurrency + 4))
    if (kind === 'audio') return Math.max(1, Math.min(12, this.baseLimits.audioConcurrency + 3))
    return Math.max(1, Math.min(8, this.baseLimits.videoConcurrency + 2))
  }

  private pendingCount(kind: AdaptiveKind) {
    return this.queue.filter((t) => t.kind === kind && !t.cancelled).length
  }

  private maybeScaleUpForPressure(kind: AdaptiveKind) {
    const now = Date.now()
    if (now < this.scaleUpBlockedUntil[kind]) return

    const current = kind === 'image' ? this.limits.imageConcurrency : kind === 'audio' ? this.limits.audioConcurrency : this.limits.videoConcurrency
    const maxLimit = this.getAdaptiveMax(kind)
    if (current >= maxLimit) return

    const running = kind === 'image' ? this.runningImage : kind === 'audio' ? this.runningAudio : this.runningVideo
    const pending = this.pendingCount(kind)
    if (pending <= 0) return
    if (running < current) return
    if (pending < Math.max(2, current)) return
    if (now - this.lastScaleAt[kind] < 2000) return

    const step = kind === 'image' && pending >= 10 ? 2 : 1
    const next = Math.min(maxLimit, current + step)
    this.setKindLimit(kind, next, 'pressure')
  }

  private onTaskSuccess(kind: AdaptiveKind, durationMs: number) {
    this.successStreak[kind] += 1
    this.failureStreak[kind] = 0

    const now = Date.now()
    if (now < this.scaleUpBlockedUntil[kind]) return

    const current = kind === 'image' ? this.limits.imageConcurrency : kind === 'audio' ? this.limits.audioConcurrency : this.limits.videoConcurrency
    const maxLimit = this.getAdaptiveMax(kind)
    if (current >= maxLimit) return
    if (now - this.lastScaleAt[kind] < 1200) return

    const pending = this.pendingCount(kind)
    const fastEnough = kind === 'image' ? durationMs < 20000 : kind === 'audio' ? durationMs < 15000 : durationMs < 90000
    if (this.successStreak[kind] >= 2 && pending > 0 && fastEnough) {
      const step = kind === 'image' && pending >= 8 ? 2 : 1
      const next = Math.min(maxLimit, current + step)
      this.setKindLimit(kind, next, 'success')
      this.successStreak[kind] = 0
    }
  }

  private onTaskFailure(kind: AdaptiveKind, err: any) {
    this.successStreak[kind] = 0
    this.failureStreak[kind] += 1

    const current = kind === 'image' ? this.limits.imageConcurrency : kind === 'audio' ? this.limits.audioConcurrency : this.limits.videoConcurrency
    if (current <= 1) return

    if (isRateLimitedError(err)) {
      const next = Math.max(1, Math.ceil(current * 0.5))
      this.scaleUpBlockedUntil[kind] = Date.now() + (kind === 'image' ? 10000 : kind === 'audio' ? 8000 : 14000)
      this.failureStreak[kind] = 0
      this.setKindLimit(kind, next, 'rate_limit')
      return
    }

    // 持续失败时温和降并发，避免短时抖动反复打满后端。
    if (this.failureStreak[kind] >= 3) {
      const next = Math.max(1, current - 1)
      this.failureStreak[kind] = 0
      this.scaleUpBlockedUntil[kind] = Date.now() + 5000
      this.setKindLimit(kind, next, 'failure')
    }
  }

  private setKindLimit(kind: AdaptiveKind, next: number, reason: 'pressure' | 'success' | 'rate_limit' | 'failure') {
    const now = Date.now()
    if (kind === 'image') {
      const clamped = clampInt(next, 1, this.getAdaptiveMax('image'), this.limits.imageConcurrency)
      if (clamped === this.limits.imageConcurrency) return
      this.limits.imageConcurrency = clamped
      this.lastScaleAt.image = now
      console.info('[ShortDramaTaskQueue] adaptive image concurrency', { reason, next: clamped, base: this.baseLimits.imageConcurrency })
    } else if (kind === 'audio') {
      const clamped = clampInt(next, 1, this.getAdaptiveMax('audio'), this.limits.audioConcurrency)
      if (clamped === this.limits.audioConcurrency) return
      this.limits.audioConcurrency = clamped
      this.lastScaleAt.audio = now
      console.info('[ShortDramaTaskQueue] adaptive audio concurrency', { reason, next: clamped, base: this.baseLimits.audioConcurrency })
    } else {
      const clamped = clampInt(next, 1, this.getAdaptiveMax('video'), this.limits.videoConcurrency)
      if (clamped === this.limits.videoConcurrency) return
      this.limits.videoConcurrency = clamped
      this.lastScaleAt.video = now
      console.info('[ShortDramaTaskQueue] adaptive video concurrency', { reason, next: clamped, base: this.baseLimits.videoConcurrency })
    }
    this.pump()
  }

  private canStart(task: InternalTask<any>) {
    if (!task.key) return false
    if (this.runningKeys.has(task.key)) return false

    if (task.kind === 'image') return this.runningImage < this.limits.imageConcurrency
    if (task.kind === 'video') return this.runningVideo < this.limits.videoConcurrency
    if (task.kind === 'audio') return this.runningAudio < this.limits.audioConcurrency
    return this.runningAnalysis < this.limits.analysisConcurrency
  }

  private start(task: InternalTask<any>) {
    task.started = true
    this.runningKeys.add(task.key)
    if (task.kind === 'image') this.runningImage++
    else if (task.kind === 'video') this.runningVideo++
    else if (task.kind === 'audio') this.runningAudio++
    else this.runningAnalysis++

    const startedAt = Date.now()

    const finish = () => {
      this.runningKeys.delete(task.key)
      if (task.kind === 'image') this.runningImage = Math.max(0, this.runningImage - 1)
      else if (task.kind === 'video') this.runningVideo = Math.max(0, this.runningVideo - 1)
      else if (task.kind === 'audio') this.runningAudio = Math.max(0, this.runningAudio - 1)
      else this.runningAnalysis = Math.max(0, this.runningAnalysis - 1)
      this.notify()
      this.pump()
    }

    task
      .run()
      .then((res) => {
        if (task.cancelled) {
          task.reject(new Error('已取消'))
          return
        }
        if (task.kind === 'image' || task.kind === 'video' || task.kind === 'audio') {
          this.onTaskSuccess(task.kind, Math.max(0, Date.now() - startedAt))
        }
        task.resolve(res)
      })
      .catch((err) => {
        if (task.cancelled) {
          task.reject(new Error('已取消'))
          return
        }
        if (task.kind === 'image' || task.kind === 'video' || task.kind === 'audio') {
          this.onTaskFailure(task.kind, err)
        }
        task.reject(err)
      })
      .finally(finish)
  }

  private pump() {
    if (this.pumping) return
    this.pumping = true
    try {
      this.maybeScaleUpForPressure('image')
      this.maybeScaleUpForPressure('video')
      this.maybeScaleUpForPressure('audio')

      let started = true
      while (started) {
        started = false
        for (let i = 0; i < this.queue.length; i++) {
          const task = this.queue[i]
          if (task.cancelled) continue
          if (!this.canStart(task)) continue
          this.queue.splice(i, 1)
          this.start(task)
          started = true
          break
        }
      }
    } finally {
      this.pumping = false
      this.notify()
    }
  }
}

const queuesByProject = new Map<string, ShortDramaTaskQueue>()

export const getShortDramaTaskQueue = (projectId: string) => {
  const pid = String(projectId || 'default')
  const existing = queuesByProject.get(pid)
  if (existing) return existing
  const q = new ShortDramaTaskQueue()
  queuesByProject.set(pid, q)
  return q
}
