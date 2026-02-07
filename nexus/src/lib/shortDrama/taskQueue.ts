export type ShortDramaTaskKind = 'image' | 'video' | 'analysis'

export interface ShortDramaQueueLimits {
  imageConcurrency: number
  videoConcurrency: number
  analysisConcurrency: number
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

const makeId = () => globalThis.crypto?.randomUUID?.() || `sd_task_${Date.now()}_${Math.random().toString(16).slice(2)}`

const clampInt = (v: unknown, min: number, max: number, fallback: number) => {
  const n = Number(v)
  if (!Number.isFinite(n)) return fallback
  return Math.max(min, Math.min(max, Math.floor(n)))
}

export class ShortDramaTaskQueue {
  private limits: ShortDramaQueueLimits = { imageConcurrency: 3, videoConcurrency: 1, analysisConcurrency: 1 }
  private runningKeys = new Set<string>()

  private runningImage = 0
  private runningVideo = 0
  private runningAnalysis = 0

  private queue: InternalTask<any>[] = []
  private pumping = false

  setLimits(limits: Partial<ShortDramaQueueLimits>) {
    this.limits = {
      imageConcurrency: clampInt(limits.imageConcurrency ?? this.limits.imageConcurrency, 1, 6, this.limits.imageConcurrency),
      videoConcurrency: clampInt(limits.videoConcurrency ?? this.limits.videoConcurrency, 1, 3, this.limits.videoConcurrency),
      analysisConcurrency: clampInt(limits.analysisConcurrency ?? this.limits.analysisConcurrency, 1, 2, this.limits.analysisConcurrency),
    }
    this.pump()
  }

  getLimits(): ShortDramaQueueLimits {
    return { ...this.limits }
  }

  getStats() {
    return {
      queued: this.queue.length,
      runningImage: this.runningImage,
      runningVideo: this.runningVideo,
      runningAnalysis: this.runningAnalysis,
      runningKeys: this.runningKeys.size,
      limits: this.getLimits(),
    }
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
          // remove from queue
          this.queue = this.queue.filter((t) => t.id !== task.id)
          task.reject(new Error('已取消'))
        }
      }
      this.queue.push(task)
      this.pump()
    })
    return { id, kind, key: String(key || ''), promise, cancel: () => cancelFn?.() }
  }

  private canStart(task: InternalTask<any>) {
    if (!task.key) return false
    if (this.runningKeys.has(task.key)) return false

    if (task.kind === 'image') return this.runningImage < this.limits.imageConcurrency
    if (task.kind === 'video') return this.runningVideo < this.limits.videoConcurrency
    return this.runningAnalysis < this.limits.analysisConcurrency
  }

  private start(task: InternalTask<any>) {
    task.started = true
    this.runningKeys.add(task.key)
    if (task.kind === 'image') this.runningImage++
    else if (task.kind === 'video') this.runningVideo++
    else this.runningAnalysis++

    const finish = () => {
      this.runningKeys.delete(task.key)
      if (task.kind === 'image') this.runningImage = Math.max(0, this.runningImage - 1)
      else if (task.kind === 'video') this.runningVideo = Math.max(0, this.runningVideo - 1)
      else this.runningAnalysis = Math.max(0, this.runningAnalysis - 1)
      this.pump()
    }

    task
      .run()
      .then((res) => {
        if (task.cancelled) {
          task.reject(new Error('已取消'))
          return
        }
        task.resolve(res)
      })
      .catch((err) => {
        if (task.cancelled) {
          task.reject(new Error('已取消'))
          return
        }
        task.reject(err)
      })
      .finally(finish)
  }

  private pump() {
    if (this.pumping) return
    this.pumping = true
    try {
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

