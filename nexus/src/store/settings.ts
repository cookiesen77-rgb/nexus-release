import { create } from 'zustand'

const API_KEY_STORAGE_KEY = 'apiKey'
const API_KEYS_STORAGE_KEY = 'nexus-api-keys'
const BLACKLIST_STORAGE_KEY = 'nexus-api-blacklist'
const PAUSE_LIST_STORAGE_KEY = 'nexus-api-pause-list'
const THEME_STORAGE_KEY = 'nexus-theme-v1'
const DEFAULT_IMAGE_MODEL_KEY = 'nexus-default-image-model'
const DEFAULT_VIDEO_MODEL_KEY = 'nexus-default-video-model'
const AI_ASSISTANT_MODEL_KEY = 'nexus-ai-assistant-model'
const REGENERATE_MODE_KEY = 'nexus-regenerate-mode'

// 熔断配置
const CIRCUIT_BREAKER_THRESHOLD = 10 // 错误次数阈值
const CIRCUIT_BREAKER_WINDOW_MS = 2 * 60 * 1000 // 2 分钟窗口
const CIRCUIT_BREAKER_COOLDOWN_MS = 5 * 60 * 1000 // 熔断冷却 5 分钟
const PAUSE_TTL_MS = 60 * 60 * 1000 // 暂停列表 TTL 60 分钟

// API Key 黑名单条目
export interface BlacklistEntry {
  key: string
  reason: string
  timestamp: number
}

// API Key 暂停条目
export interface PauseEntry {
  key: string
  reason: string
  expireAt: number
}

// 熔断器状态
export interface CircuitBreakerState {
  isOpen: boolean
  errorCount: number
  firstErrorAt: number
  openedAt: number
}

// AI 助手固定使用 gemini-3-pro-preview-thinking
export const AI_ASSISTANT_MODELS = [
  { key: 'gemini-3-pro-preview-thinking', label: 'Gemini 3 Pro Thinking' },
  { key: 'claude-opus-4-6', label: 'Claude Opus 4.6' },
  { key: 'claude-opus-4-5-20251101', label: 'Claude Opus 4.5' },
] as const

export type RegenerateMode = 'replace' | 'create'
export type PerformanceMode = 'off' | 'normal' | 'ultra'

const PERFORMANCE_MODE_KEY = 'nexus-performance-mode'

type SettingsState = {
  apiKey: string
  apiKeys: string[]
  blacklist: BlacklistEntry[]
  pauseList: PauseEntry[]
  circuitBreaker: CircuitBreakerState
  dark: boolean
  defaultImageModel: string
  defaultVideoModel: string
  aiAssistantModel: string
  regenerateMode: RegenerateMode
  performanceMode: PerformanceMode
  // 基本操作
  setApiKey: (value: string) => void
  clearApiKey: () => void
  toggleDark: () => void
  setDefaultImageModel: (model: string) => void
  setDefaultVideoModel: (model: string) => void
  setAiAssistantModel: (model: string) => void
  setRegenerateMode: (mode: RegenerateMode) => void
  setPerformanceMode: (mode: PerformanceMode) => void
  // 多 Key 管理
  setApiKeys: (keys: string[]) => void
  addApiKey: (key: string) => void
  removeApiKey: (key: string) => void
  // 黑名单管理
  addToBlacklist: (key: string, reason: string) => void
  removeFromBlacklist: (key: string) => void
  clearBlacklist: () => void
  isBlacklisted: (key: string) => boolean
  // 暂停列表管理
  addToPauseList: (key: string, reason: string) => void
  removeFromPauseList: (key: string) => void
  clearPauseList: () => void
  isPaused: (key: string) => boolean
  cleanExpiredPauseList: () => void
  // 熔断器管理
  recordError: () => void
  resetCircuitBreaker: () => void
  isCircuitOpen: () => boolean
  // 获取可用 Key
  getNextValidKey: () => string | null
}

const readApiKey = () => {
  try {
    return localStorage.getItem(API_KEY_STORAGE_KEY) || ''
  } catch {
    return ''
  }
}

const readApiKeys = (): string[] => {
  try {
    const raw = localStorage.getItem(API_KEYS_STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed.filter(k => typeof k === 'string' && k.trim()) : []
  } catch {
    return []
  }
}

const readBlacklist = (): BlacklistEntry[] => {
  try {
    const raw = localStorage.getItem(BLACKLIST_STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

const readPauseList = (): PauseEntry[] => {
  try {
    const raw = localStorage.getItem(PAUSE_LIST_STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    // 清理过期条目
    const now = Date.now()
    return Array.isArray(parsed) ? parsed.filter(e => e.expireAt > now) : []
  } catch {
    return []
  }
}

const saveApiKeys = (keys: string[]) => {
  try {
    localStorage.setItem(API_KEYS_STORAGE_KEY, JSON.stringify(keys))
  } catch {
    // ignore
  }
}

const saveBlacklist = (list: BlacklistEntry[]) => {
  try {
    localStorage.setItem(BLACKLIST_STORAGE_KEY, JSON.stringify(list))
  } catch {
    // ignore
  }
}

const savePauseList = (list: PauseEntry[]) => {
  try {
    localStorage.setItem(PAUSE_LIST_STORAGE_KEY, JSON.stringify(list))
  } catch {
    // ignore
  }
}

const readDark = () => {
  try {
    const raw = localStorage.getItem(THEME_STORAGE_KEY)
    if (raw === 'dark') return true
    if (raw === 'light') return false
    // 默认浅色模式
    return false
  } catch {
    return false
  }
}

const readDefaultImageModel = () => {
  try {
    return localStorage.getItem(DEFAULT_IMAGE_MODEL_KEY) || ''
  } catch {
    return ''
  }
}

const readDefaultVideoModel = () => {
  try {
    return localStorage.getItem(DEFAULT_VIDEO_MODEL_KEY) || ''
  } catch {
    return ''
  }
}

const readAiAssistantModel = () => {
  try {
    return localStorage.getItem(AI_ASSISTANT_MODEL_KEY) || 'gemini-3-pro-preview-thinking'
  } catch {
    return 'gemini-3-pro-preview-thinking'
  }
}

const readRegenerateMode = (): RegenerateMode => {
  try {
    const raw = localStorage.getItem(REGENERATE_MODE_KEY)
    if (raw === 'replace' || raw === 'create') return raw
    return 'create' // 默认新建模式
  } catch {
    return 'create'
  }
}

const readPerformanceMode = (): PerformanceMode => {
  try {
    const raw = localStorage.getItem(PERFORMANCE_MODE_KEY)
    if (raw === 'off' || raw === 'normal' || raw === 'ultra') return raw
    return 'off' // 默认关闭性能模式
  } catch {
    return 'off'
  }
}

const applyTheme = (dark: boolean) => {
  try {
    document.documentElement.classList.toggle('dark', dark)
  } catch {
    // ignore
  }
}

// 默认熔断器状态
const DEFAULT_CIRCUIT_BREAKER: CircuitBreakerState = {
  isOpen: false,
  errorCount: 0,
  firstErrorAt: 0,
  openedAt: 0
}

export const useSettingsStore = create<SettingsState>((set, get) => ({
  // ===== 状态初始化 =====
  apiKey: readApiKey(),
  apiKeys: readApiKeys(),
  blacklist: readBlacklist(),
  pauseList: readPauseList(),
  circuitBreaker: DEFAULT_CIRCUIT_BREAKER,
  dark: readDark(),
  defaultImageModel: readDefaultImageModel(),
  defaultVideoModel: readDefaultVideoModel(),
  aiAssistantModel: readAiAssistantModel(),
  regenerateMode: readRegenerateMode(),
  performanceMode: readPerformanceMode(),

  // ===== 基本操作 =====
  setApiKey: (value) => {
    const next = String(value || '')
    try {
      localStorage.setItem(API_KEY_STORAGE_KEY, next)
    } catch {
      // ignore
    }
    set({ apiKey: next })
  },
  clearApiKey: () => {
    try {
      localStorage.removeItem(API_KEY_STORAGE_KEY)
    } catch {
      // ignore
    }
    set({ apiKey: '' })
  },
  toggleDark: () => {
    const next = !get().dark
    try {
      localStorage.setItem(THEME_STORAGE_KEY, next ? 'dark' : 'light')
    } catch {
      // ignore
    }
    applyTheme(next)
    set({ dark: next })
  },
  setDefaultImageModel: (model) => {
    const next = String(model || '')
    try {
      localStorage.setItem(DEFAULT_IMAGE_MODEL_KEY, next)
    } catch {
      // ignore
    }
    set({ defaultImageModel: next })
  },
  setDefaultVideoModel: (model) => {
    const next = String(model || '')
    try {
      localStorage.setItem(DEFAULT_VIDEO_MODEL_KEY, next)
    } catch {
      // ignore
    }
    set({ defaultVideoModel: next })
  },
  setAiAssistantModel: (model) => {
    const next = String(model || 'gemini-3-pro-preview-thinking')
    try {
      localStorage.setItem(AI_ASSISTANT_MODEL_KEY, next)
    } catch {
      // ignore
    }
    set({ aiAssistantModel: next })
  },
  setRegenerateMode: (mode) => {
    const next = mode === 'replace' ? 'replace' : 'create'
    try {
      localStorage.setItem(REGENERATE_MODE_KEY, next)
    } catch {
      // ignore
    }
    set({ regenerateMode: next })
  },
  setPerformanceMode: (mode) => {
    const valid: PerformanceMode[] = ['off', 'normal', 'ultra']
    const next = valid.includes(mode) ? mode : 'off'
    try {
      localStorage.setItem(PERFORMANCE_MODE_KEY, next)
    } catch {
      // ignore
    }
    set({ performanceMode: next })
  },

  // ===== 多 Key 管理 =====
  setApiKeys: (keys) => {
    const validKeys = keys.filter(k => typeof k === 'string' && k.trim())
    saveApiKeys(validKeys)
    set({ apiKeys: validKeys })
  },
  addApiKey: (key) => {
    const trimmed = String(key || '').trim()
    if (!trimmed) return
    const current = get().apiKeys
    if (current.includes(trimmed)) return // 避免重复
    const next = [...current, trimmed]
    saveApiKeys(next)
    set({ apiKeys: next })
  },
  removeApiKey: (key) => {
    const current = get().apiKeys
    const next = current.filter(k => k !== key)
    saveApiKeys(next)
    set({ apiKeys: next })
  },

  // ===== 黑名单管理 =====
  addToBlacklist: (key, reason) => {
    const trimmed = String(key || '').trim()
    if (!trimmed) return
    const current = get().blacklist
    // 如果已在黑名单中，更新原因和时间
    const existing = current.find(e => e.key === trimmed)
    let next: BlacklistEntry[]
    if (existing) {
      next = current.map(e => 
        e.key === trimmed 
          ? { ...e, reason, timestamp: Date.now() } 
          : e
      )
    } else {
      next = [...current, { key: trimmed, reason, timestamp: Date.now() }]
    }
    saveBlacklist(next)
    set({ blacklist: next })
    console.warn(`[API Blacklist] Key ...${trimmed.slice(-4)} 已加入黑名单: ${reason}`)
  },
  removeFromBlacklist: (key) => {
    const current = get().blacklist
    const next = current.filter(e => e.key !== key)
    saveBlacklist(next)
    set({ blacklist: next })
  },
  clearBlacklist: () => {
    saveBlacklist([])
    set({ blacklist: [] })
  },
  isBlacklisted: (key) => {
    return get().blacklist.some(e => e.key === key)
  },

  // ===== 暂停列表管理 =====
  addToPauseList: (key, reason) => {
    const trimmed = String(key || '').trim()
    if (!trimmed) return
    const current = get().pauseList
    const expireAt = Date.now() + PAUSE_TTL_MS
    // 如果已在暂停列表中，更新
    const existing = current.find(e => e.key === trimmed)
    let next: PauseEntry[]
    if (existing) {
      next = current.map(e => 
        e.key === trimmed 
          ? { ...e, reason, expireAt } 
          : e
      )
    } else {
      next = [...current, { key: trimmed, reason, expireAt }]
    }
    savePauseList(next)
    set({ pauseList: next })
    console.warn(`[API Pause] Key ...${trimmed.slice(-4)} 已暂停 60 分钟: ${reason}`)
  },
  removeFromPauseList: (key) => {
    const current = get().pauseList
    const next = current.filter(e => e.key !== key)
    savePauseList(next)
    set({ pauseList: next })
  },
  clearPauseList: () => {
    savePauseList([])
    set({ pauseList: [] })
  },
  isPaused: (key) => {
    const now = Date.now()
    return get().pauseList.some(e => e.key === key && e.expireAt > now)
  },
  cleanExpiredPauseList: () => {
    const now = Date.now()
    const current = get().pauseList
    const next = current.filter(e => e.expireAt > now)
    if (next.length !== current.length) {
      savePauseList(next)
      set({ pauseList: next })
    }
  },

  // ===== 熔断器管理 =====
  recordError: () => {
    const now = Date.now()
    const current = get().circuitBreaker
    
    // 如果已经熔断，不记录新错误
    if (current.isOpen) return
    
    // 检查是否在时间窗口内
    if (current.firstErrorAt && (now - current.firstErrorAt) > CIRCUIT_BREAKER_WINDOW_MS) {
      // 窗口过期，重置计数
      set({
        circuitBreaker: {
          isOpen: false,
          errorCount: 1,
          firstErrorAt: now,
          openedAt: 0
        }
      })
      return
    }
    
    const newCount = current.errorCount + 1
    const shouldOpen = newCount >= CIRCUIT_BREAKER_THRESHOLD
    
    set({
      circuitBreaker: {
        isOpen: shouldOpen,
        errorCount: newCount,
        firstErrorAt: current.firstErrorAt || now,
        openedAt: shouldOpen ? now : 0
      }
    })
    
    if (shouldOpen) {
      console.error(`[Circuit Breaker] 熔断器已触发！短时间内 ${newCount} 次错误，暂停请求 5 分钟`)
    }
  },
  resetCircuitBreaker: () => {
    set({ circuitBreaker: DEFAULT_CIRCUIT_BREAKER })
    console.log('[Circuit Breaker] 熔断器已重置')
  },
  isCircuitOpen: () => {
    const { circuitBreaker } = get()
    if (!circuitBreaker.isOpen) return false
    
    // 检查冷却时间是否已过
    const now = Date.now()
    if ((now - circuitBreaker.openedAt) > CIRCUIT_BREAKER_COOLDOWN_MS) {
      // 自动重置熔断器
      set({ circuitBreaker: DEFAULT_CIRCUIT_BREAKER })
      console.log('[Circuit Breaker] 冷却时间已过，熔断器自动重置')
      return false
    }
    return true
  },

  // ===== 获取可用 Key =====
  getNextValidKey: () => {
    const state = get()
    
    // 先清理过期的暂停列表
    state.cleanExpiredPauseList()
    
    // 收集所有可用的 Key
    const allKeys: string[] = []
    
    // 主 Key
    if (state.apiKey && state.apiKey.trim()) {
      allKeys.push(state.apiKey.trim())
    }
    
    // 额外的 Key 池
    state.apiKeys.forEach(k => {
      if (k && k.trim() && !allKeys.includes(k.trim())) {
        allKeys.push(k.trim())
      }
    })
    
    if (allKeys.length === 0) {
      return null
    }
    
    // 过滤掉黑名单和暂停列表中的 Key
    const availableKeys = allKeys.filter(k => 
      !state.isBlacklisted(k) && !state.isPaused(k)
    )
    
    if (availableKeys.length > 0) {
      // 随机选择一个可用 Key（负载均衡）
      const selected = availableKeys[Math.floor(Math.random() * availableKeys.length)]
      console.log(`[Key Select] 使用 Key ...${selected.slice(-4)} (可用: ${availableKeys.length}/${allKeys.length})`)
      return selected
    }
    
    // 所有 Key 都不可用，降级到随机选择（避免完全失败）
    console.warn(`[Key Select] 所有 ${allKeys.length} 个 Key 都不可用，降级随机选择`)
    return allKeys[Math.floor(Math.random() * allKeys.length)]
  }
}))

// Initialize theme once on import | 初始化主题（只做一次）
applyTheme(readDark())
