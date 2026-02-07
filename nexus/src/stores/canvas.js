/**
 * Canvas store | 画布状态管理
 * Manages nodes, edges and canvas state
 */
import { ref, reactive } from 'vue'
import { updateProjectCanvas, getProjectCanvas } from './projects'
import { DEFAULT_IMAGE_MODEL, DEFAULT_IMAGE_SIZE, DEFAULT_VIDEO_MODEL, DEFAULT_VIDEO_DURATION, DEFAULT_VIDEO_RATIO } from '../config/models'
import { deepClone } from '../utils'

// Node ID counter | 节点ID计数器
let nodeId = 0
const getNodeId = () => `node_${nodeId++}`
let edgeId = 0
const getEdgeId = () => `edge_${Date.now()}_${edgeId++}`

// Current project ID | 当前项目ID
export const currentProjectId = ref(null)

// Nodes and edges | 节点和边
export const nodes = ref([])
export const edges = ref([])

// Fast lookup map | O(1) 节点查找（避免频繁 nodes.find 扫描）
const nodesById = reactive(new Map())

export const getNodeById = (id) => {
  if (!id) return null
  return nodesById.get(id) || null
}

// Fast edge indices | O(1) 连线查询（避免在各节点组件里反复 edges.filter 扫描）
const incomingEdgesByTarget = reactive(new Map())
const outgoingEdgesBySource = reactive(new Map())

export const getIncomingEdges = (targetId) => {
  if (!targetId) return []
  return incomingEdgesByTarget.get(targetId) || []
}

export const getOutgoingEdges = (sourceId) => {
  if (!sourceId) return []
  return outgoingEdgesBySource.get(sourceId) || []
}

const rebuildNodeIndex = (list) => {
  nodesById.clear()
  for (const node of list || []) {
    if (node?.id) nodesById.set(node.id, node)
  }
}

const rebuildEdgeIndex = (list) => {
  incomingEdgesByTarget.clear()
  outgoingEdgesBySource.clear()
  for (const edge of list || []) {
    if (!edge?.source || !edge?.target) continue
    const inList = incomingEdgesByTarget.get(edge.target) || []
    inList.push(edge)
    incomingEdgesByTarget.set(edge.target, inList)
    const outList = outgoingEdgesBySource.get(edge.source) || []
    outList.push(edge)
    outgoingEdgesBySource.set(edge.source, outList)
  }
}

// Viewport state | 视口状态
export const canvasViewport = ref({ x: 100, y: 50, zoom: 0.8 })

// VueFlow culling guard | 可见性裁剪保护（避免新节点"闪现后消失"）
// 使用引用计数替代计时器重置，避免时序竞争导致节点消失
export const cullingDisabled = ref(false)
let cullingRefCount = 0
let cullingReleaseTimer = null

export const acquireCullingGuard = () => {
  cullingRefCount++
  cullingDisabled.value = true
  if (cullingReleaseTimer) {
    clearTimeout(cullingReleaseTimer)
    cullingReleaseTimer = null
  }
}

export const releaseCullingGuard = (delayMs = 100) => {
  cullingRefCount = Math.max(0, cullingRefCount - 1)
  if (cullingRefCount === 0) {
    if (cullingReleaseTimer) clearTimeout(cullingReleaseTimer)
    cullingReleaseTimer = setTimeout(() => {
      cullingReleaseTimer = null
      if (cullingRefCount === 0) {
        cullingDisabled.value = false
      }
    }, delayMs)
  }
}

// 兼容旧 API：立即获取保护，延迟释放
export const bumpCullingGuard = (ms = 300) => {
  acquireCullingGuard()
  setTimeout(() => releaseCullingGuard(50), Math.max(50, Number(ms) || 300))
}

// Batch append buffers | 批量追加缓冲（避免批量创建节点/连线时反复复制大数组导致卡顿）
let pendingNodesAppend = []
let pendingEdgesAppend = []
let pendingNodeIndexById = new Map()
let pendingEdgeIndexById = new Map()

const flushPendingAppends = () => {
  if (pendingNodesAppend.length > 0) {
    nodes.value = [...nodes.value, ...pendingNodesAppend]
    pendingNodesAppend = []
    pendingNodeIndexById.clear()
  }
  if (pendingEdgesAppend.length > 0) {
    edges.value = [...edges.value, ...pendingEdgesAppend]
    pendingEdgesAppend = []
    pendingEdgeIndexById.clear()
  }
}

// Selected node | 选中的节点
export const selectedNode = ref(null)

// Auto-save flag | 自动保存标志
let autoSaveEnabled = false
let saveTimeout = null
let batchDepth = 0
let pendingHistory = false
let pendingSave = false

// History for undo/redo | 撤销/重做历史
const history = ref([])
const historyIndex = ref(-1)
const MAX_HISTORY = 50
let isRestoring = false

const MAX_NODE_Z_INDEX = 900

const clampZIndex = (value) => {
  const n = Number(value)
  if (!Number.isFinite(n)) return undefined
  return Math.max(0, Math.min(MAX_NODE_Z_INDEX, Math.floor(n)))
}

const migrateLegacyNodeProps = (list) => {
  const nodes = Array.isArray(list) ? list : []
  if (nodes.length === 0) return nodes
  let changed = false
  const out = nodes.map((node) => {
    if (!node || typeof node !== 'object') return node
    const dz = node?.data?.zIndex
    const z = node?.zIndex
    if (dz === undefined && z === undefined) return node

    const next = { ...node }
    if (next.data && typeof next.data === 'object') next.data = { ...next.data }

    if (next.zIndex === undefined && dz !== undefined) {
      const migrated = clampZIndex(dz)
      if (migrated !== undefined) next.zIndex = migrated
      delete next.data.zIndex
      changed = true
      return next
    }

    if (next.zIndex !== undefined && dz !== undefined) {
      delete next.data.zIndex
      changed = true
      return next
    }

    if (next.zIndex !== undefined) {
      const clamped = clampZIndex(next.zIndex)
      if (clamped !== undefined && clamped !== next.zIndex) {
        next.zIndex = clamped
        changed = true
      }
    }
    return next
  })
  return changed ? out : nodes
}

// Desktop history compression (Rust) | 桌面端历史压缩（Rust/Tauri）
const RAW_HISTORY_KEEP = 12
let historyCompressTimer = null
let historyCompressInProgress = false

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

const scheduleHistoryCompression = () => {
  if (historyCompressTimer) return
  historyCompressTimer = setTimeout(() => {
    historyCompressTimer = null
    compressOldHistoryEntries()
  }, 400)
}

const compressOldHistoryEntries = async () => {
  if (historyCompressInProgress) return
  const tauriProbe = await tryTauriInvoke('compress_json_lz4_base64', { value: { ok: true } })
  if (!tauriProbe.ok) return

  historyCompressInProgress = true
  try {
    const keepFrom = Math.max(0, history.value.length - RAW_HISTORY_KEEP)
    for (let i = 0; i < keepFrom; i++) {
      const entry = history.value[i]
      if (!entry || entry.compressed) continue
      if (!entry.nodes || !entry.edges) continue
      const payload = { nodes: entry.nodes, edges: entry.edges }
      const res = await tryTauriInvoke('compress_json_lz4_base64', { value: payload })
      if (!res.ok) continue
      entry.compressed = res.res
      entry.nodes = null
      entry.edges = null
    }
  } finally {
    historyCompressInProgress = false
  }
}

const normalizeNodeZIndices = () => {
  const list = nodes.value || []
  if (list.length === 0) return
  const max = Math.max(0, ...list.map(n => Number(n?.zIndex || 0)))
  if (max <= MAX_NODE_Z_INDEX) return

  // Keep relative order by existing zIndex (fallback to stable original order)
  const sorted = list
    .map((node, idx) => ({ node, idx, z: Number(node?.zIndex || 0) }))
    .sort((a, b) => (a.z - b.z) || (a.idx - b.idx))

  const updated = list.slice()
  sorted.forEach((item, i) => {
    const next = { ...item.node, zIndex: i + 1 }
    const originalIndex = item.idx
    updated[originalIndex] = next
    nodesById.set(next.id, next)
  })

  nodes.value = updated
}

export const getNextZIndex = () => {
  normalizeNodeZIndices()
  const max = Math.max(0, ...nodes.value.map(n => Number(n?.zIndex || 0)))
  return Math.min(MAX_NODE_Z_INDEX, max + 1)
}

/**
 * Save current state to history | 保存当前状态到历史
 * 使用节流机制避免频繁的全量深拷贝
 */
let historyThrottleTimer = null
let historyPending = false

const doSaveToHistory = () => {
  historyPending = false

  const state = {
    nodes: deepClone(nodes.value),
    edges: deepClone(edges.value),
    compressed: ''
  }

  // Remove future history if we're not at the end | 如果不在末尾，删除未来历史
  if (historyIndex.value < history.value.length - 1) {
    history.value = history.value.slice(0, historyIndex.value + 1)
  }

  // Add new state | 添加新状态
  history.value.push(state)

  // Limit history size | 限制历史大小
  if (history.value.length > MAX_HISTORY) {
    history.value.shift()
  } else {
    historyIndex.value++
  }

  scheduleHistoryCompression()
}

const saveToHistory = () => {
  if (isRestoring) return
  if (batchDepth > 0) {
    pendingHistory = true
    return
  }

  // 节流：300ms 内多次调用只执行一次
  historyPending = true
  if (historyThrottleTimer) return

  historyThrottleTimer = setTimeout(() => {
    historyThrottleTimer = null
    if (historyPending) {
      doSaveToHistory()
    }
  }, 300)
}

// Add a new node | 添加新节点
export const addNode = (type, position = { x: 100, y: 100 }, data = {}) => {
  bumpCullingGuard()
  const id = getNodeId()
  const now = Date.now()
  const desiredZ = clampZIndex(data?.zIndex)
  const { zIndex: _zIndex, ...rest } = data || {}
  const newNode = {
    id,
    type,
    position,
    data: {
      ...getDefaultNodeData(type),
      ...rest,
      createdAt: data.createdAt || now,
      updatedAt: data.updatedAt || now
    },
    ...(desiredZ !== undefined ? { zIndex: desiredZ } : {})
  }
  if (batchDepth > 0) {
    pendingNodeIndexById.set(id, pendingNodesAppend.length)
    pendingNodesAppend.push(newNode)
  } else {
    nodes.value = [...nodes.value, newNode]
  }
  nodesById.set(id, newNode)
  saveToHistory() // Save after adding node | 添加节点后保存
  debouncedSave()
  return id
}

// Get default data for node type | 获取节点类型的默认数据
const getDefaultNodeData = (type) => {
  switch (type) {
    case 'text':
      return {
        content: '',
        label: '文本输入'
      }
    case 'imageConfig':
      return {
        prompt: '',
        model: DEFAULT_IMAGE_MODEL,
        size: DEFAULT_IMAGE_SIZE,
        quality: 'standard',
        label: '文生图'
      }
    case 'videoConfig':
      return {
        prompt: '',
        ratio: DEFAULT_VIDEO_RATIO,
        dur: DEFAULT_VIDEO_DURATION,
        // Sora 等模型需要 size（small/large），其它模型可忽略 | for sora-unified
        size: '',
        model: DEFAULT_VIDEO_MODEL,
        label: '图生视频'
      }
    case 'video':
      return {
        url: '',
        duration: 0,
        label: '视频节点'
      }
    case 'image':
      return {
        url: '',
        label: '图片节点'
      }
    case 'audio':
      return {
        url: '',
        duration: 0,
        label: '音频节点'
      }
    case 'localSave':
      return {
        label: '本地保存',
        autoExecute: false
      }
    default:
      return {}
  }
}

// Debounced array trigger for Vue reactivity | Vue 响应式触发防抖
let nodeArrayDirty = false
let nodeArrayFlushTimer = null

const scheduleNodeArrayFlush = () => {
  if (nodeArrayFlushTimer) return
  nodeArrayDirty = true
  nodeArrayFlushTimer = requestAnimationFrame(() => {
    nodeArrayFlushTimer = null
    if (nodeArrayDirty && batchDepth === 0) {
      nodeArrayDirty = false
      nodes.value = nodes.value.slice()
    }
  })
}

// Update node data | 更新节点数据
export const updateNode = (id, data) => {
  const idx = nodes.value.findIndex(node => node.id === id)
  const prev = idx === -1 ? nodesById.get(id) : nodes.value[idx]
  if (!prev) return
  const patch = data || {}
  const next = { ...prev }

  if (patch.position && typeof patch.position === 'object') {
    const x = Number(patch.position.x)
    const y = Number(patch.position.y)
    if (Number.isFinite(x) && Number.isFinite(y)) {
      next.position = { x, y }
    }
  }
  if (patch.zIndex !== undefined) {
    const z = clampZIndex(patch.zIndex)
    if (z !== undefined) next.zIndex = z
  }

  const { position: _pos, zIndex: _z, ...rest } = patch
  next.data = { ...prev.data, ...rest }
  if (idx !== -1) {
    nodes.value[idx] = next
    if (batchDepth === 0) {
      scheduleNodeArrayFlush()
    }
  } else {
    const pidx = pendingNodeIndexById.get(id)
    if (pidx != null) pendingNodesAppend[pidx] = next
  }
  nodesById.set(id, next)

  // 只在非批量操作时触发 culling guard，且只对真正影响尺寸的字段
  if (batchDepth === 0) {
    const SIZE_AFFECTING_KEYS = ['url', 'content', 'loading', 'error']
    for (const k of SIZE_AFFECTING_KEYS) {
      if (Object.prototype.hasOwnProperty.call(rest, k)) {
        bumpCullingGuard(200)
        break
      }
    }
  }
  debouncedSave()
}

// Remove node | 删除节点
export const removeNode = (id) => {
  nodes.value = nodes.value.filter(node => node.id !== id)
  edges.value = edges.value.filter(edge => edge.source !== id && edge.target !== id)
  nodesById.delete(id)
  incomingEdgesByTarget.delete(id)
  outgoingEdgesBySource.delete(id)
  // Rebuild because other nodes' incoming/outgoing lists may contain removed edges
  rebuildEdgeIndex(edges.value)
  saveToHistory() // Save after removing node | 删除节点后保存
  debouncedSave()
}

// Duplicate node | 复制节点
export const duplicateNode = (id) => {
  const sourceNode = nodes.value.find(node => node.id === id)
  if (!sourceNode) return null
  
  const newId = getNodeId()
  const nextZIndex = getNextZIndex()
  
  const newNode = {
    id: newId,
    type: sourceNode.type,
    position: {
      x: sourceNode.position.x + 50,
      y: sourceNode.position.y + 50
    },
    data: { ...sourceNode.data },
    zIndex: nextZIndex
  }
  if (batchDepth > 0) {
    pendingNodeIndexById.set(newId, pendingNodesAppend.length)
    pendingNodesAppend.push(newNode)
  } else {
    nodes.value = [...nodes.value, newNode]
  }
  nodesById.set(newId, newNode)
  saveToHistory() // Save after duplicating node | 复制节点后保存
  debouncedSave()
  return newId
}

// Add edge | 添加边
export const addEdge = (params) => {
  const newEdge = {
    id: params.id || getEdgeId(),
    ...params
  }
  if (batchDepth > 0) {
    pendingEdgeIndexById.set(newEdge.id, pendingEdgesAppend.length)
    pendingEdgesAppend.push(newEdge)
  } else {
    edges.value = [...edges.value, newEdge]
  }
  if (newEdge.source && newEdge.target) {
    const inList = incomingEdgesByTarget.get(newEdge.target) || []
    inList.push(newEdge)
    incomingEdgesByTarget.set(newEdge.target, inList)
    const outList = outgoingEdgesBySource.get(newEdge.source) || []
    outList.push(newEdge)
    outgoingEdgesBySource.set(newEdge.source, outList)
  } else {
    const merged = batchDepth > 0 ? [...edges.value, ...pendingEdgesAppend] : edges.value
    rebuildEdgeIndex(merged)
  }
  saveToHistory() // Save after adding edge | 添加连线后保存
  debouncedSave()
}

// Update edge data | 更新边数据
export const updateEdge = (id, data) => {
  const idx = edges.value.findIndex(edge => edge.id === id)
  if (idx === -1) return
  const prev = edges.value[idx]
  const next = { ...prev, data: { ...prev.data, ...data } }
  edges.value[idx] = next
  edges.value = edges.value.slice()
  // Edge endpoints rarely change; keep indices in sync for safety
  if (prev.source !== next.source || prev.target !== next.target) {
    rebuildEdgeIndex(edges.value)
  } else {
    const inList = incomingEdgesByTarget.get(next.target) || []
    incomingEdgesByTarget.set(next.target, inList.map(e => e.id === next.id ? next : e))
    const outList = outgoingEdgesBySource.get(next.source) || []
    outgoingEdgesBySource.set(next.source, outList.map(e => e.id === next.id ? next : e))
  }
  saveToHistory() // Save after updating edge | 更新连线后保存
  debouncedSave()
}

// Remove edge | 删除边
export const removeEdge = (id) => {
  edges.value = edges.value.filter(edge => edge.id !== id)
  // Simpler and safer: rebuild indices (edge count is usually small enough)
  rebuildEdgeIndex(edges.value)
  saveToHistory() // Save after removing edge | 删除连线后保存
  debouncedSave()
}

// Clear canvas | 清空画布
export const clearCanvas = () => {
  nodes.value = []
  edges.value = []
  nodeId = 0
  edgeId = 0
  nodesById.clear()
  incomingEdgesByTarget.clear()
  outgoingEdgesBySource.clear()
  pendingNodesAppend = []
  pendingEdgesAppend = []
  pendingNodeIndexById.clear()
  pendingEdgeIndexById.clear()
  debouncedSave()
}

// Initialize with sample data | 使用示例数据初始化
export const initSampleData = () => {
  clearCanvas()
  
  // Add text node | 添加文本节点
  addNode('text', { x: 150, y: 150 }, {
    content: '一只金毛寻回犬在草地上奔跑，摇着尾巴，脸上带着快乐的表情。它的毛发在阳光下闪耀，眼神充满了对自由的渴望，全身散发着阳光、友善的气息。',
    label: '文本输入'
  })
  
  // Add image config node | 添加文生图配置节点
  addNode('imageConfig', { x: 450, y: 150 }, {
    prompt: '',
    model: DEFAULT_IMAGE_MODEL,
    size: DEFAULT_IMAGE_SIZE,
    quality: 'standard',
    label: '文生图'
  })
  
  // Add edge between nodes | 添加节点之间的边
  addEdge({
    source: 'node_0',
    target: 'node_1',
    sourceHandle: 'right',
    targetHandle: 'left'
  })
}

/**
 * Load project data | 加载项目数据
 * @param {string} projectId - Project ID | 项目ID
 */
export const loadProject = (projectId) => {
  autoSaveEnabled = false
  isRestoring = true
  currentProjectId.value = projectId
  pendingNodesAppend = []
  pendingEdgesAppend = []
  pendingNodeIndexById.clear()
  pendingEdgeIndexById.clear()
  
  const canvasData = getProjectCanvas(projectId)
  
  // canvasData 现在来自 IndexedDB（异步） | canvasData now loads from IndexedDB (async)
  return Promise.resolve(canvasData).then((data) => {
    if (data) {
      // Restore nodes | 恢复节点
      nodes.value = migrateLegacyNodeProps(data.nodes || [])
      edges.value = data.edges || []
      canvasViewport.value = data.viewport || { x: 100, y: 50, zoom: 0.8 }
      rebuildNodeIndex(nodes.value)
      rebuildEdgeIndex(edges.value)
      normalizeNodeZIndices()

      // Ensure edge IDs are unique (fix legacy duplicates) | 确保连线 ID 唯一（修复历史重复）
      const seenEdgeIds = new Set()
      edges.value = edges.value.map((edge) => {
        const next = { ...edge }
        if (!next.id || seenEdgeIds.has(next.id)) {
          next.id = getEdgeId()
        }
        seenEdgeIds.add(next.id)
        return next
      })
      rebuildEdgeIndex(edges.value)

      // 修复 blob URL：优先用 base64/dataURL 展示（跨刷新可用） | Fix blob URL after reload
      nodes.value = nodes.value.map((node) => {
        if (node?.type !== 'image' || !node?.data) return node
        const next = { ...node, data: { ...node.data } }
        // Prefer persistent DataURL over blob URL | 优先使用可持久化 DataURL
        if (typeof next.data.base64 === 'string' && next.data.base64.startsWith('data:')) {
          if (!next.data.url || (typeof next.data.url === 'string' && next.data.url.startsWith('blob:'))) {
            next.data.url = next.data.base64
          }
        }

        // Avoid duplicating large DataURL in both url/base64 | 避免 url/base64 重复存两份大字符串
        if (typeof next.data.url === 'string' && next.data.url.startsWith('data:') && next.data.base64) {
          delete next.data.base64
        }
        return next
      })
      nodes.value = migrateLegacyNodeProps(nodes.value)
      rebuildNodeIndex(nodes.value)
      rebuildEdgeIndex(edges.value)
      normalizeNodeZIndices()

      // Update node ID counter | 更新节点ID计数器
      const maxId = nodes.value.reduce((max, node) => {
        const match = node.id.match(/node_(\d+)/)
        if (match) {
          return Math.max(max, parseInt(match[1], 10))
        }
        return max
      }, -1)
      nodeId = maxId + 1
    } else {
      // Empty project | 空项目
      clearCanvas()
    }

    // Initialize history with current state | 用当前状态初始化历史
    history.value = [{
      nodes: deepClone(nodes.value),
      edges: deepClone(edges.value)
    }]
    historyIndex.value = 0

    // Enable auto-save after loading | 加载后启用自动保存
    setTimeout(() => {
      autoSaveEnabled = true
      isRestoring = false
    }, 100)
  }).catch((err) => {
    console.error('Failed to load project canvas:', err)
    clearCanvas()
    setTimeout(() => {
      autoSaveEnabled = true
      isRestoring = false
    }, 100)
  })
}

/**
 * Save current project | 保存当前项目
 */
export const saveProject = () => {
  if (!currentProjectId.value) return
  updateProjectCanvas(currentProjectId.value, {
    nodes: nodes.value,
    edges: edges.value,
    viewport: canvasViewport.value
  })
}

/**
 * Debounced auto-save | 防抖动自动保存
 */
const debouncedSave = () => {
  if (!autoSaveEnabled || !currentProjectId.value) return
  if (batchDepth > 0) {
    pendingSave = true
    return
  }
  
  if (saveTimeout) {
    clearTimeout(saveTimeout)
  }
  
  saveTimeout = setTimeout(() => {
    saveProject()
  }, 500)
}

const beginBatch = () => {
  if (batchDepth === 0) {
    acquireCullingGuard()
  }
  batchDepth += 1
}

const endBatch = () => {
  if (batchDepth === 0) return
  batchDepth -= 1
  if (batchDepth > 0) return

  // Flush buffered appends first so history/save capture full state | 先提交缓冲追加，保证历史/保存拿到完整状态
  flushPendingAppends()

  if (pendingHistory) {
    pendingHistory = false
    saveToHistory()
  }
  if (pendingSave) {
    pendingSave = false
    debouncedSave()
  }

  // 批量操作结束后延迟释放 culling 保护，等待 Vue Flow 渲染稳定
  releaseCullingGuard(200)
}

export const withBatchUpdates = (fn) => {
  beginBatch()
  try {
    return fn()
  } finally {
    endBatch()
  }
}

/**
 * Schedule project save (for external event hooks like Vue Flow node drag) | 计划保存（用于 Vue Flow 拖拽等外部事件）
 */
export const scheduleProjectSave = () => {
  debouncedSave()
}

/**
 * Prune dangling edges (source/target node missing) | 清理悬空连线
 * Note: some UI integrations may mutate nodes first, then call this to keep indices consistent.
 */
export const pruneDanglingEdges = (existingNodeIds) => {
  const set = existingNodeIds instanceof Set
    ? existingNodeIds
    : new Set((nodes.value || []).map(n => n?.id).filter(Boolean))
  edges.value = (edges.value || []).filter(e => set.has(e.source) && set.has(e.target))
  rebuildEdgeIndex(edges.value)
}

/**
 * Update viewport and save | 更新视口并保存
 */
export const updateViewport = (viewport) => {
  if (!viewport || typeof viewport !== 'object') return
  canvasViewport.value = viewport
  debouncedSave()
}

/**
 * Undo last action | 撤销上一步操作
 */
export const undo = () => {
  if (isRestoring) {
    window.$message?.info('正在恢复历史，请稍候…')
    return false
  }
  if (historyIndex.value <= 0) {
    window.$message?.info('没有可撤销的操作')
    return false
  }
  
  historyIndex.value--
  restoreState(history.value[historyIndex.value])
  return true
}

/**
 * Redo last undone action | 重做上一步撤销的操作
 */
export const redo = () => {
  if (isRestoring) {
    window.$message?.info('正在恢复历史，请稍候…')
    return false
  }
  if (historyIndex.value >= history.value.length - 1) {
    window.$message?.info('没有可重做的操作')
    return false
  }
  
  historyIndex.value++
  restoreState(history.value[historyIndex.value])
  return true
}

/**
 * Restore state from history | 从历史恢复状态
 */
const restoreState = (state) => {
  isRestoring = true
  const doRestore = async () => {
    let payload = state
    if ((!payload?.nodes || !payload?.edges) && payload?.compressed) {
      const res = await tryTauriInvoke('decompress_json_lz4_base64', { b64: payload.compressed })
      if (res.ok && res.res && typeof res.res === 'object') {
        payload = res.res
      }
    }

    nodes.value = migrateLegacyNodeProps(deepClone(payload?.nodes || []))
    edges.value = deepClone(payload?.edges || [])
    rebuildNodeIndex(nodes.value)
    rebuildEdgeIndex(edges.value)
    normalizeNodeZIndices()
    setTimeout(() => {
      isRestoring = false
    }, 100)
  }

  doRestore().catch((err) => {
    console.error('Failed to restore history state:', err)
    isRestoring = false
  })
}

/**
 * Check if can undo | 检查是否可以撤销
 */
export const canUndo = () => historyIndex.value > 0

/**
 * Check if can redo | 检查是否可以重做
 */
export const canRedo = () => historyIndex.value < history.value.length - 1

/**
 * Manually save current state to history | 手动保存当前状态到历史
 * Used for edge deletions and other operations not covered by automatic saves
 */
export const manualSaveHistory = () => {
  saveToHistory()
}
