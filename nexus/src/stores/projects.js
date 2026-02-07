/**
 * Projects store | 项目状态管理
 * - 项目列表（元数据）存 localStorage（小、稳定）
 * - 画布数据（nodes/edges/viewport）存 IndexedDB（避免 localStorage 超额）
 */
import { ref, computed, toRaw } from 'vue'
import { DEFAULT_IMAGE_MODEL, DEFAULT_IMAGE_SIZE } from '../config/models'
import { deepClone } from '../utils'

const tryTauriInvoke = async (command, payload) => {
  try {
    const { isTauri, invoke } = await import('@tauri-apps/api/core')
    if (!isTauri()) return { ok: false }
    const res = await invoke(command, payload)
    return { ok: true, res }
  } catch (err) {
    return { ok: false, err }
  }
}

// Storage keys | 存储键
const LEGACY_STORAGE_KEY = 'ai-canvas-projects'
const STORAGE_KEY = 'ai-canvas-projects-meta'

// IndexedDB | 用于存大对象（画布数据）
const DB_NAME = 'nexus-ai-canvas'
const DB_VERSION = 1
const CANVAS_STORE = 'project_canvas'
const META_KEY = '__projects_meta__'
let dbPromise = null
let projectsSaveTimer = null
let pendingThumbnailUpdate = null
let thumbnailIdleHandle = null
const PROJECT_META_SAVE_DELAY = 300
const THUMBNAIL_IDLE_TIMEOUT = 1200

const getDb = () => {
  if (typeof indexedDB === 'undefined') {
    return Promise.reject(new Error('IndexedDB 不可用'))
  }
  if (dbPromise) return dbPromise
  dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION)
    request.onupgradeneeded = () => {
      const db = request.result
      if (!db.objectStoreNames.contains(CANVAS_STORE)) {
        db.createObjectStore(CANVAS_STORE)
      }
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
  return dbPromise
}

const idbGetCanvas = async (projectId) => {
  const tauriRes = await tryTauriInvoke('load_project_canvas', { projectId })
  if (tauriRes.ok) return tauriRes.res || null
  const db = await getDb()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(CANVAS_STORE, 'readonly')
    const store = tx.objectStore(CANVAS_STORE)
    const req = store.get(projectId)
    req.onsuccess = () => resolve(req.result || null)
    req.onerror = () => reject(req.error)
  })
}

const isProbablyCloneableObject = (value) => {
  if (!value || typeof value !== 'object') return false
  if (value instanceof Date) return true
  if (value instanceof RegExp) return true
  if (typeof Blob !== 'undefined' && value instanceof Blob) return true
  if (value instanceof ArrayBuffer) return true
  if (typeof ArrayBuffer !== 'undefined' && ArrayBuffer.isView(value)) return true
  if (value instanceof Map) return true
  if (value instanceof Set) return true
  return false
}

/**
 * Make data safe for IndexedDB structured clone | 让数据可被 IndexedDB 安全克隆
 * - Vue reactive Proxy 不能直接写入 IDB，会触发 DataCloneError
 * - 这里会递归 toRaw + 拷贝，移除函数/符号等不可克隆字段
 */
const makeIdbSafe = (value) => {
  const seen = new WeakMap()

  const walk = (input) => {
    const raw = toRaw(input)
    if (raw === null || typeof raw !== 'object') return raw

    // Keep built-in structured-clone types as-is | 保留原生可克隆类型
    if (isProbablyCloneableObject(raw)) return raw

    // Handle circular refs (rare in canvas, but safe) | 处理循环引用
    if (seen.has(raw)) return seen.get(raw)

    if (Array.isArray(raw)) {
      const arr = []
      seen.set(raw, arr)
      for (const item of raw) arr.push(walk(item))
      return arr
    }

    // Plain object copy | 复制普通对象（仅 enumerable）
    const obj = {}
    seen.set(raw, obj)
    for (const [k, v] of Object.entries(raw)) {
      if (typeof v === 'function' || typeof v === 'symbol') continue
      obj[k] = walk(v)
    }
    return obj
  }

  return walk(value)
}

const idbSetCanvas = async (projectId, canvasData, { tauriMode = 'sync' } = {}) => {
  const safeData = makeIdbSafe(canvasData)
  if (tauriMode === 'enqueue') {
    const tauriRes = await tryTauriInvoke('enqueue_save_project_canvas', { projectId, canvas: safeData })
    if (tauriRes.ok) return true
  }
  const tauriRes = await tryTauriInvoke('save_project_canvas', { projectId, canvas: safeData })
  if (tauriRes.ok) return true
  const db = await getDb()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(CANVAS_STORE, 'readwrite')
    const store = tx.objectStore(CANVAS_STORE)
    const req = store.put(safeData, projectId)
    req.onsuccess = () => resolve(true)
    req.onerror = () => reject(req.error)
  })
}

const idbDeleteCanvas = async (projectId) => {
  const tauriRes = await tryTauriInvoke('delete_project_canvas', { projectId })
  if (tauriRes.ok) return true
  const db = await getDb()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(CANVAS_STORE, 'readwrite')
    const store = tx.objectStore(CANVAS_STORE)
    const req = store.delete(projectId)
    req.onsuccess = () => resolve(true)
    req.onerror = () => reject(req.error)
  })
}

const scheduleProjectsMetaSave = (delay = PROJECT_META_SAVE_DELAY) => {
  if (projectsSaveTimer) {
    clearTimeout(projectsSaveTimer)
  }
  projectsSaveTimer = setTimeout(() => {
    projectsSaveTimer = null
    saveProjects()
  }, delay)
}

const scheduleThumbnailUpdate = (project, nodesList) => {
  if (!project || !Array.isArray(nodesList) || nodesList.length === 0) return
  pendingThumbnailUpdate = { project, nodesList }

  if (thumbnailIdleHandle) return

  const runUpdate = () => {
    thumbnailIdleHandle = null
    if (!pendingThumbnailUpdate) return
    const { project: targetProject, nodesList: nodes } = pendingThumbnailUpdate
    pendingThumbnailUpdate = null

    let latestNode = null
    let latestTime = -1
    for (const node of nodes) {
      if (!node || (node.type !== 'image' && node.type !== 'video')) continue
      if (!node.data?.url) continue
      const t = node.data?.updatedAt || node.data?.createdAt || 0
      if (t > latestTime) {
        latestTime = t
        latestNode = node
      }
    }

    const lastTs = targetProject.__thumbnailTs || 0
    if (!latestNode || latestTime <= lastTs) return

    targetProject.__thumbnailTs = latestTime
    if (latestNode.type === 'video') {
      targetProject.thumbnail = latestNode.data.thumbnail || latestNode.data.url
    } else {
      targetProject.thumbnail = latestNode.data.url
    }

    scheduleProjectsMetaSave(200)
  }

  if (typeof requestIdleCallback === 'function') {
    thumbnailIdleHandle = requestIdleCallback(runUpdate, { timeout: THUMBNAIL_IDLE_TIMEOUT })
  } else {
    thumbnailIdleHandle = setTimeout(runUpdate, 200)
  }
}

const IDB_SAVE_IDLE_TIMEOUT = 2000
let isCanvasSaving = false
let pendingCanvasSave = null

const scheduleCanvasPersist = (projectId, canvasData) => {
  pendingCanvasSave = { projectId, canvasData }
  if (isCanvasSaving) return
  flushCanvasPersist()
}

const flushCanvasPersist = () => {
  if (!pendingCanvasSave) {
    isCanvasSaving = false
    return
  }

  isCanvasSaving = true
  const { projectId, canvasData } = pendingCanvasSave
  pendingCanvasSave = null

  const persist = async () => {
    try {
      await idbSetCanvas(projectId, canvasData, { tauriMode: 'enqueue' })
    } catch (err) {
      console.error('Failed to persist canvas data:', err)
    }
  }

  const done = () => {
    if (pendingCanvasSave) {
      flushCanvasPersist()
    } else {
      isCanvasSaving = false
    }
  }

  if (typeof requestIdleCallback === 'function') {
    requestIdleCallback(() => {
      persist().finally(done)
    }, { timeout: IDB_SAVE_IDLE_TIMEOUT })
  } else {
    setTimeout(() => {
      persist().finally(done)
    }, 0)
  }
}

// Generate unique ID | 生成唯一ID
const generateId = () => `project_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`

// Projects list | 项目列表
export const projects = ref([])

// Current project ID | 当前项目ID
export const currentProjectId = ref(null)

// Current project | 当前项目
export const currentProject = computed(() => {
  return projects.value.find(p => p.id === currentProjectId.value) || null
})

/**
 * Load projects from localStorage | 从 localStorage 加载项目
 */
export const loadProjects = () => {
  try {
    const stored = localStorage.getItem(STORAGE_KEY)
    if (stored) {
      const parsed = JSON.parse(stored)
      // Convert date strings back to Date objects | 将日期字符串转换回 Date 对象
      projects.value = parsed.map(p => ({
        ...p,
        createdAt: new Date(p.createdAt),
        updatedAt: new Date(p.updatedAt),
        // canvasData 不再从 localStorage 读取 | canvasData lives in IndexedDB
        canvasData: undefined
      }))
    }
  } catch (err) {
    console.error('Failed to load projects:', err)
    projects.value = []
  }
}

/**
 * Save projects to localStorage | 保存项目到 localStorage
 */
export const saveProjects = () => {
  const sanitized = sanitizeProjectsForStorage(projects.value)
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(sanitized))
    // Also persist meta to IndexedDB (more reliable, avoids localStorage quota) | 同步写入 IndexedDB
    idbSetCanvas(META_KEY, sanitized).catch(() => {})
  } catch (err) {
    // 元数据很小，但仍可能因浏览器/同域其它数据导致失败
    if (isQuotaExceededError(err)) {
      try {
        // 尝试释放旧版本大对象（如果存在） | free legacy large payload if present
        localStorage.removeItem(LEGACY_STORAGE_KEY)
        localStorage.removeItem(STORAGE_KEY)

        // 若仍超额，降级为不保存缩略图 | fallback: drop thumbnails
        const minimal = sanitizeProjectsForStorage(projects.value, { dropThumbnails: true })
        try {
          localStorage.setItem(STORAGE_KEY, JSON.stringify(minimal))
        } catch {
          // localStorage still not writable -> persist meta to IndexedDB only
        }

        idbSetCanvas(META_KEY, minimal).catch((err2) => {
          console.error('Failed to persist projects meta to IndexedDB:', err2)
        })
        return
      } catch (err2) {
        console.error('Failed to save projects after cleanup:', err2)
        // Last resort: persist meta to IndexedDB only
        idbSetCanvas(META_KEY, sanitized).catch(() => {})
        return
      }
    }
    console.error('Failed to save projects:', err)
    // Fallback: persist meta to IndexedDB only
    idbSetCanvas(META_KEY, sanitized).catch(() => {})
  }
}

const isQuotaExceededError = (err) => {
  if (!err) return false
  return (
    err.name === 'QuotaExceededError' ||
    err.code === 22 ||
    err.code === 1014
  )
}

const isLikelyLargeInlineData = (value) => {
  return typeof value === 'string' && (value.startsWith('data:') || value.length > 200_000)
}

const isLikelyNonPersistentUrl = (value) => {
  return typeof value === 'string' && value.startsWith('blob:')
}

const sanitizeProjectsForStorage = (list, { dropThumbnails = false } = {}) => {
  if (!Array.isArray(list)) return []
  return list.map(project => ({
    id: project.id,
    name: project.name,
    thumbnail: dropThumbnails
      ? ''
      : (isLikelyLargeInlineData(project.thumbnail) || isLikelyNonPersistentUrl(project.thumbnail)
          ? ''
          : (project.thumbnail || '')),
    createdAt: project.createdAt instanceof Date ? project.createdAt.toISOString() : project.createdAt,
    updatedAt: project.updatedAt instanceof Date ? project.updatedAt.toISOString() : project.updatedAt
  }))
}

/**
 * Create a new project | 创建新项目
 * @param {string} name - Project name | 项目名称
 * @returns {string} - New project ID | 新项目ID
 */
export const createProject = (name = '未命名项目') => {
  const id = generateId()
  const now = new Date()
  
  const newProject = {
    id,
    name,
    thumbnail: '',
    createdAt: now,
    updatedAt: now,
    // Canvas data | 画布数据
    canvasData: {
      nodes: [],
      edges: [],
      viewport: { x: 100, y: 50, zoom: 0.8 }
    }
  }
  
  projects.value = [newProject, ...projects.value]
  saveProjects()

  // Persist empty canvas to IndexedDB | 初始化画布写入 IndexedDB
  idbSetCanvas(id, newProject.canvasData).catch((err) => {
    console.error('Failed to persist project canvas:', err)
  })
  
  return id
}

/**
 * Update project | 更新项目
 * @param {string} id - Project ID | 项目ID
 * @param {object} data - Update data | 更新数据
 */
export const updateProject = (id, data) => {
  const index = projects.value.findIndex(p => p.id === id)
  if (index === -1) return false
  
  projects.value[index] = {
    ...projects.value[index],
    ...data,
    updatedAt: new Date()
  }
  
  // Move to top of list | 移动到列表顶部
  const [updated] = projects.value.splice(index, 1)
  projects.value = [updated, ...projects.value]
  
  saveProjects()
  return true
}

/**
 * Update project canvas data | 更新项目画布数据
 * @param {string} id - Project ID | 项目ID
 * @param {object} canvasData - Canvas data (nodes, edges, viewport) | 画布数据
 */
export const updateProjectCanvas = (id, canvasData) => {
  const project = projects.value.find(p => p.id === id)
  if (!project) return false
  
  project.canvasData = {
    ...project.canvasData,
    ...canvasData
  }
  project.updatedAt = new Date()
  
  if (canvasData.nodes) {
    scheduleThumbnailUpdate(project, canvasData.nodes)
  }
  
  scheduleProjectsMetaSave()

  // Persist to IndexedDB (avoid localStorage quota) | 写入 IndexedDB
  scheduleCanvasPersist(id, project.canvasData)
  return true
}

/**
 * Get project canvas data | 获取项目画布数据
 * @param {string} id - Project ID | 项目ID
 * @returns {object|null} - Canvas data or null | 画布数据或空
 */
export const getProjectCanvas = async (id) => {
  const project = projects.value.find(p => p.id === id)
  if (project?.canvasData) return project.canvasData
  try {
    const canvasData = await idbGetCanvas(id)
    if (project) project.canvasData = canvasData
    return canvasData
  } catch (err) {
    console.error('Failed to load canvas data:', err)
    return project?.canvasData || null
  }
}

/**
 * Delete project | 删除项目
 * @param {string} id - Project ID | 项目ID
 */
export const deleteProject = (id) => {
  projects.value = projects.value.filter(p => p.id !== id)
  saveProjects()
  idbDeleteCanvas(id).catch((err) => console.error('Failed to delete canvas data:', err))
}

/**
 * Duplicate project | 复制项目
 * @param {string} id - Source project ID | 源项目ID
 * @returns {string|null} - New project ID or null | 新项目ID或空
 */
export const duplicateProject = async (id) => {
  const source = projects.value.find(p => p.id === id)
  if (!source) return null
  
  const newId = generateId()
  const now = new Date()

  const newProject = {
    id: newId,
    name: `${source.name} (副本)`,
    thumbnail: source.thumbnail || '',
    createdAt: now,
    updatedAt: now,
    canvasData: undefined
  }

  projects.value = [newProject, ...projects.value]
  saveProjects()

  try {
    const canvas = await getProjectCanvas(source.id)
    if (canvas) {
      const cloned = deepClone(canvas)
      await idbSetCanvas(newId, cloned)
      newProject.canvasData = cloned
    } else {
      await idbSetCanvas(newId, { nodes: [], edges: [], viewport: { x: 100, y: 50, zoom: 0.8 } })
    }
  } catch (err) {
    console.error('Failed to duplicate canvas data:', err)
  }
  
  return newId
}

/**
 * Rename project | 重命名项目
 * @param {string} id - Project ID | 项目ID
 * @param {string} name - New name | 新名称
 */
export const renameProject = (id, name) => {
  return updateProject(id, { name })
}

/**
 * Update project thumbnail | 更新项目缩略图
 * @param {string} id - Project ID | 项目ID
 * @param {string} thumbnail - Thumbnail URL (base64 or URL) | 缩略图URL
 */
export const updateProjectThumbnail = (id, thumbnail) => {
  return updateProject(id, { thumbnail })
}

/**
 * Get sorted projects | 获取排序后的项目列表
 * @param {string} sortBy - Sort field (updatedAt, createdAt, name) | 排序字段
 * @param {string} order - Sort order (asc, desc) | 排序顺序
 */
export const getSortedProjects = (sortBy = 'updatedAt', order = 'desc') => {
  return computed(() => {
    const sorted = [...projects.value]
    sorted.sort((a, b) => {
      let valueA = a[sortBy]
      let valueB = b[sortBy]
      
      if (valueA instanceof Date) {
        valueA = valueA.getTime()
        valueB = valueB.getTime()
      }
      
      if (typeof valueA === 'string') {
        valueA = valueA.toLowerCase()
        valueB = valueB.toLowerCase()
      }
      
      if (order === 'asc') {
        return valueA > valueB ? 1 : -1
      } else {
        return valueA < valueB ? 1 : -1
      }
    })
    return sorted
  })
}

/**
 * Initialize projects store | 初始化项目存储
 */
const migrateLegacyProjectsIfNeeded = async () => {
  let legacyRaw = null
  try {
    legacyRaw = localStorage.getItem(LEGACY_STORAGE_KEY)
  } catch {
    legacyRaw = null
  }
  if (!legacyRaw) return

  // If new meta already exists, just remove legacy to free space | 如果已是新格式，清理旧 key
  try {
    const existingMeta = localStorage.getItem(STORAGE_KEY)
    if (existingMeta) {
      localStorage.removeItem(LEGACY_STORAGE_KEY)
      return
    }
  } catch {
    // ignore
  }

  let migrated = false
  try {
    const parsed = JSON.parse(legacyRaw)
    if (!Array.isArray(parsed)) throw new Error('legacy projects is not array')

    // Persist each canvas to IndexedDB | 迁移画布到 IndexedDB
    await Promise.all(parsed.map((p) => idbSetCanvas(p.id, p.canvasData || { nodes: [], edges: [], viewport: { x: 100, y: 50, zoom: 0.8 } })))
    migrated = true

    // Free localStorage space before writing new meta | 先释放 localStorage 空间再写入新元数据
    try {
      localStorage.removeItem(LEGACY_STORAGE_KEY)
    } catch {
      // ignore
    }

    // Store only meta back to localStorage | 只保留元数据
    projects.value = parsed.map((p) => ({
      id: p.id,
      name: p.name,
      thumbnail: p.thumbnail || '',
      createdAt: new Date(p.createdAt),
      updatedAt: new Date(p.updatedAt),
      canvasData: undefined
    }))
    saveProjects()
  } catch (err) {
    console.error('Failed to migrate legacy projects:', err)
  } finally {
    // best-effort cleanup only after successful migration | 仅在成功迁移后清理旧 key
    if (migrated) {
      try { localStorage.removeItem(LEGACY_STORAGE_KEY) } catch { /* ignore */ }
    }
  }
}

export const initProjectsStore = async () => {
  await migrateLegacyProjectsIfNeeded()
  loadProjects()

  // Fallback: if localStorage is unavailable/cleared, load meta from IndexedDB | 兜底：从 IndexedDB 读取元数据
  if (projects.value.length === 0) {
    try {
      const meta = await idbGetCanvas(META_KEY)
      if (Array.isArray(meta) && meta.length > 0) {
        projects.value = meta.map(p => ({
          ...p,
          createdAt: new Date(p.createdAt),
          updatedAt: new Date(p.updatedAt),
          canvasData: undefined
        }))

        // Best-effort rehydrate to localStorage for faster future loads | 尝试回写 localStorage
        try {
          localStorage.setItem(STORAGE_KEY, JSON.stringify(sanitizeProjectsForStorage(projects.value)))
        } catch {
          // ignore
        }
      }
    } catch (err) {
      console.error('Failed to load projects meta from IndexedDB:', err)
    }
  }
  
  // Create sample project if empty | 如果为空则创建示例项目
  if (projects.value.length === 0) {
    const id = createProject('示例项目')
    const project = projects.value.find(p => p.id === id)
    if (project) {
      const sampleCanvas = {
        nodes: [
          {
            id: 'node_0',
            type: 'text',
            position: { x: 150, y: 150 },
            data: {
              content: '一只金毛寻回犬在草地上奔跑，摇着尾巴，脸上带着快乐的表情。它的毛发在阳光下闪耀，眼神充满了对自由的渴望，全身散发着阳光、友善的气息。',
              label: '文本输入'
            }
          },
          {
            id: 'node_1',
            type: 'imageConfig',
            position: { x: 500, y: 150 },
            data: {
              prompt: '',
              model: DEFAULT_IMAGE_MODEL,
              size: DEFAULT_IMAGE_SIZE,
              label: '文生图'
            }
          }
        ],
        edges: [
          {
            id: 'edge_node_0_node_1',
            source: 'node_0',
            target: 'node_1',
            sourceHandle: 'right',
            targetHandle: 'left'
          }
        ],
        viewport: { x: 100, y: 50, zoom: 0.8 }
      }
      project.canvasData = sampleCanvas
      saveProjects()
      await idbSetCanvas(id, sampleCanvas)
    }
  }
}

// Export for debugging | 导出用于调试
if (typeof window !== 'undefined') {
  window.__aiCanvasProjects = {
    projects,
    loadProjects,
    saveProjects,
    createProject,
    deleteProject,
    duplicateProject
  }
}
