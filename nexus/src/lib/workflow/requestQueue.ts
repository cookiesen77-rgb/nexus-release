/**
 * Request Queue Manager | 请求队列管理器
 * 支持高并发批量生成图片/视频，提供并发控制和任务管理
 */

export interface QueueTask {
  id: string
  type: 'image' | 'video'
  configNodeId: string
  overrides?: Record<string, any>
  priority: number  // 数字越小优先级越高
  status: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled'
  createdAt: number
  startedAt?: number
  completedAt?: number
  error?: string
  result?: any
  onProgress?: (progress: number) => void
  onComplete?: (result: any) => void
  onError?: (error: Error) => void
}

export interface QueueStats {
  pending: number
  running: number
  completed: number
  failed: number
  cancelled: number
  total: number
}

type PerformanceMode = 'off' | 'normal' | 'ultra'

type TaskExecutor = (task: QueueTask) => Promise<any>

interface QueueConfig {
  maxConcurrency: number
  defaultPriority: number
}

const DEFAULT_CONFIG: QueueConfig = {
  maxConcurrency: 3,
  defaultPriority: 10
}

class RequestQueue {
  private config: QueueConfig
  private tasks: Map<string, QueueTask> = new Map()
  private queue: string[] = []  // pending task ids (sorted by priority)
  private running: Set<string> = new Set()
  private paused: boolean = false
  private taskCounter: number = 0
  private imageExecutor: TaskExecutor | null = null
  private videoExecutor: TaskExecutor | null = null
  private listeners: Set<() => void> = new Set()
  // 请求去重：记录正在处理的 configNodeId -> taskId 映射
  private pendingByNodeId: Map<string, string> = new Map()

  constructor(config: Partial<QueueConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config }
  }

  /**
   * 注册任务执行器
   */
  registerExecutor(type: 'image' | 'video', executor: TaskExecutor) {
    if (type === 'image') {
      this.imageExecutor = executor
    } else {
      this.videoExecutor = executor
    }
  }

  /**
   * 添加任务到队列
   * 支持请求去重：如果同一个 configNodeId 已有待处理/运行中的任务，返回已有任务 ID
   */
  enqueue(params: {
    type: 'image' | 'video'
    configNodeId: string
    overrides?: Record<string, any>
    priority?: number
    onProgress?: (progress: number) => void
    onComplete?: (result: any) => void
    onError?: (error: Error) => void
    /** 是否允许重复请求（默认 false，会去重） */
    allowDuplicate?: boolean
  }): string {
    // 请求去重：检查是否已有相同节点的待处理/运行中任务
    if (!params.allowDuplicate) {
      const existingTaskId = this.pendingByNodeId.get(params.configNodeId)
      if (existingTaskId) {
        const existingTask = this.tasks.get(existingTaskId)
        if (existingTask && (existingTask.status === 'pending' || existingTask.status === 'running')) {
          console.log(`[RequestQueue] 请求去重: 节点 ${params.configNodeId} 已有任务 ${existingTaskId} (${existingTask.status})`)
          // 可选：追加回调到现有任务
          if (params.onComplete && existingTask.onComplete) {
            const originalOnComplete = existingTask.onComplete
            existingTask.onComplete = (result) => {
              originalOnComplete(result)
              params.onComplete?.(result)
            }
          }
          if (params.onError && existingTask.onError) {
            const originalOnError = existingTask.onError
            existingTask.onError = (error) => {
              originalOnError(error)
              params.onError?.(error)
            }
          }
          return existingTaskId
        }
      }
    }

    const id = `task_${Date.now()}_${this.taskCounter++}`
    
    const task: QueueTask = {
      id,
      type: params.type,
      configNodeId: params.configNodeId,
      overrides: params.overrides,
      priority: params.priority ?? this.config.defaultPriority,
      status: 'pending',
      createdAt: Date.now(),
      onProgress: params.onProgress,
      onComplete: params.onComplete,
      onError: params.onError
    }

    this.tasks.set(id, task)
    // 记录去重映射
    this.pendingByNodeId.set(params.configNodeId, id)
    
    // 按优先级插入队列（优先级数字越小越靠前）
    const insertIndex = this.queue.findIndex(taskId => {
      const t = this.tasks.get(taskId)
      return t && t.priority > task.priority
    })
    
    if (insertIndex === -1) {
      this.queue.push(id)
    } else {
      this.queue.splice(insertIndex, 0, id)
    }

    console.log(`[RequestQueue] 任务已加入队列: ${id}, type: ${task.type}, priority: ${task.priority}`)
    
    // 尝试处理队列
    this.processQueue()
    this.notifyListeners()
    
    return id
  }

  /**
   * 批量添加任务
   */
  enqueueBatch(tasks: Array<{
    type: 'image' | 'video'
    configNodeId: string
    overrides?: Record<string, any>
    priority?: number
  }>): string[] {
    const ids: string[] = []
    for (const t of tasks) {
      ids.push(this.enqueue(t))
    }
    return ids
  }

  /**
   * 取消任务
   */
  cancel(taskId: string): boolean {
    const task = this.tasks.get(taskId)
    if (!task) return false

    if (task.status === 'pending') {
      task.status = 'cancelled'
      this.queue = this.queue.filter(id => id !== taskId)
      // 清理去重映射
      if (this.pendingByNodeId.get(task.configNodeId) === taskId) {
        this.pendingByNodeId.delete(task.configNodeId)
      }
      console.log(`[RequestQueue] 任务已取消: ${taskId}`)
      this.notifyListeners()
      return true
    }

    if (task.status === 'running') {
      // 运行中的任务标记为取消，但无法中断（API 调用已发出）
      task.status = 'cancelled'
      // 清理去重映射
      if (this.pendingByNodeId.get(task.configNodeId) === taskId) {
        this.pendingByNodeId.delete(task.configNodeId)
      }
      console.log(`[RequestQueue] 运行中任务已标记取消: ${taskId}`)
      this.notifyListeners()
      return true
    }

    return false
  }

  /**
   * 取消所有待处理任务
   */
  cancelAll(): number {
    let count = 0
    for (const taskId of this.queue) {
      const task = this.tasks.get(taskId)
      if (task && task.status === 'pending') {
        task.status = 'cancelled'
        // 清理去重映射
        if (this.pendingByNodeId.get(task.configNodeId) === taskId) {
          this.pendingByNodeId.delete(task.configNodeId)
        }
        count++
      }
    }
    this.queue = []
    console.log(`[RequestQueue] 已取消 ${count} 个待处理任务`)
    this.notifyListeners()
    return count
  }

  /**
   * 获取任务
   */
  getTask(taskId: string): QueueTask | undefined {
    return this.tasks.get(taskId)
  }

  /**
   * 获取队列统计
   */
  getStats(): QueueStats {
    let pending = 0, running = 0, completed = 0, failed = 0, cancelled = 0
    
    for (const task of this.tasks.values()) {
      switch (task.status) {
        case 'pending': pending++; break
        case 'running': running++; break
        case 'completed': completed++; break
        case 'failed': failed++; break
        case 'cancelled': cancelled++; break
      }
    }

    return { pending, running, completed, failed, cancelled, total: this.tasks.size }
  }

  /**
   * 清空已完成/失败/取消的任务
   */
  clearCompleted(): void {
    const toDelete: string[] = []
    for (const [id, task] of this.tasks) {
      if (task.status === 'completed' || task.status === 'failed' || task.status === 'cancelled') {
        toDelete.push(id)
      }
    }
    for (const id of toDelete) {
      this.tasks.delete(id)
    }
    console.log(`[RequestQueue] 已清理 ${toDelete.length} 个已完成任务`)
    this.notifyListeners()
  }

  /**
   * 暂停队列处理
   */
  pause(): void {
    this.paused = true
    console.log('[RequestQueue] 队列已暂停')
    this.notifyListeners()
  }

  /**
   * 恢复队列处理
   */
  resume(): void {
    this.paused = false
    console.log('[RequestQueue] 队列已恢复')
    this.processQueue()
    this.notifyListeners()
  }

  /**
   * 是否暂停
   */
  isPaused(): boolean {
    return this.paused
  }

  /**
   * 设置最大并发数
   */
  setMaxConcurrency(max: number): void {
    this.config.maxConcurrency = Math.max(1, max)
    console.log(`[RequestQueue] 最大并发数已设置为 ${this.config.maxConcurrency}`)
    this.processQueue()
  }

  /**
   * 获取最大并发数
   */
  getMaxConcurrency(): number {
    return this.config.maxConcurrency
  }

  /**
   * 订阅状态变化
   */
  subscribe(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  private notifyListeners(): void {
    for (const listener of this.listeners) {
      try {
        listener()
      } catch (err) {
        console.error('[RequestQueue] 监听器执行错误:', err)
      }
    }
  }

  /**
   * 处理队列
   */
  private processQueue(): void {
    if (this.paused) return

    while (this.running.size < this.config.maxConcurrency && this.queue.length > 0) {
      const taskId = this.queue.shift()
      if (!taskId) break

      const task = this.tasks.get(taskId)
      if (!task || task.status !== 'pending') continue

      this.running.add(taskId)
      task.status = 'running'
      task.startedAt = Date.now()
      
      console.log(`[RequestQueue] 开始执行任务: ${taskId}, 当前并发: ${this.running.size}/${this.config.maxConcurrency}`)
      this.notifyListeners()

      // 异步执行，不阻塞循环
      this.executeTask(task)
        .then(result => {
          if (task.status === 'cancelled') {
            console.log(`[RequestQueue] 任务已取消，忽略结果: ${taskId}`)
            return
          }
          task.status = 'completed'
          task.completedAt = Date.now()
          task.result = result
          console.log(`[RequestQueue] 任务完成: ${taskId}, 耗时: ${task.completedAt - (task.startedAt || 0)}ms`)
          task.onComplete?.(result)
        })
        .catch(error => {
          if (task.status === 'cancelled') {
            console.log(`[RequestQueue] 任务已取消，忽略错误: ${taskId}`)
            return
          }
          task.status = 'failed'
          task.completedAt = Date.now()
          task.error = error?.message || String(error)
          console.error(`[RequestQueue] 任务失败: ${taskId}`, error)
          task.onError?.(error instanceof Error ? error : new Error(String(error)))
        })
        .finally(() => {
          this.running.delete(taskId)
          // 清理去重映射
          if (this.pendingByNodeId.get(task.configNodeId) === taskId) {
            this.pendingByNodeId.delete(task.configNodeId)
          }
          this.notifyListeners()
          // 递归处理下一个任务
          this.processQueue()
        })
    }
  }

  /**
   * 执行单个任务
   */
  private async executeTask(task: QueueTask): Promise<any> {
    const executor = task.type === 'image' ? this.imageExecutor : this.videoExecutor
    
    if (!executor) {
      throw new Error(`未注册 ${task.type} 类型的执行器`)
    }

    return executor(task)
  }
}

// 单例实例
export const requestQueue = new RequestQueue({
  maxConcurrency: 3,
  defaultPriority: 10
})

// 将“生成性能模式”映射到并发数（更快 vs 更稳）
const concurrencyByPerformanceMode = (mode: PerformanceMode) => {
  if (mode === 'ultra') return 5
  if (mode === 'normal') return 3
  return 2
}

// 自动跟随 Settings 的 performanceMode 调整并发（不影响历史素材缩略图的独立 performanceMode）
try {
  // 动态 import 避免在纯 Node 环境/测试环境下报错
  // eslint-disable-next-line @typescript-eslint/no-floating-promises
  ;(async () => {
    const mod = await import('@/store/settings')
    const useSettingsStore = (mod as any)?.useSettingsStore
    if (!useSettingsStore?.getState || !useSettingsStore?.subscribe) return
    const cur = String(useSettingsStore.getState().performanceMode || 'off') as PerformanceMode
    requestQueue.setMaxConcurrency(concurrencyByPerformanceMode(cur))
    useSettingsStore.subscribe((state: any, prev: any) => {
      const next = String(state?.performanceMode || 'off') as PerformanceMode
      const prevMode = String(prev?.performanceMode || 'off') as PerformanceMode
      if (next !== prevMode) requestQueue.setMaxConcurrency(concurrencyByPerformanceMode(next))
    })
  })()
} catch {
  // ignore
}

// 便捷函数
export const enqueueTask = requestQueue.enqueue.bind(requestQueue)
export const enqueueBatchTasks = requestQueue.enqueueBatch.bind(requestQueue)
export const cancelTask = requestQueue.cancel.bind(requestQueue)
export const getTaskStatus = requestQueue.getTask.bind(requestQueue)
export const getQueueStats = requestQueue.getStats.bind(requestQueue)
export const pauseQueue = requestQueue.pause.bind(requestQueue)
export const resumeQueue = requestQueue.resume.bind(requestQueue)
export const subscribeQueue = requestQueue.subscribe.bind(requestQueue)

export default requestQueue
