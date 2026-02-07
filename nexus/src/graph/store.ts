import { create } from 'zustand'
import type { EdgeType, GraphEdge, GraphNode, NodeType, Viewport } from '@/graph/types'
import { useProjectsStore } from '@/store/projects'
import { getNodeSize } from '@/graph/nodeSizing'
import { deleteMediaByNodeId, saveMedia } from '@/lib/mediaStorage'
import {
  createSpatialIndex,
  indexNode,
  removeNodeFromIndex,
  rebuildIndex,
  type SpatialIndex
} from '@/graph/spatialIndex'
import { coerceVideoImageRole, getVideoModelCaps } from '@/lib/modelCaps'

type PersistedCanvasV1 = {
  version: 1
  nodes: GraphNode[]
  edges: GraphEdge[]
  viewport: Viewport
}

type HistoryEntry =
  | { kind: 'raw'; canvas: PersistedCanvasV1 }
  | { kind: 'lz4'; compressed: string }

const STORAGE_KEY = 'nexus-canvas-v1'
const MAX_HISTORY = 50
const RAW_HISTORY_KEEP = 12

let nodeCounter = 0
let edgeCounter = 0
const newNodeId = () => `node_${Date.now()}_${nodeCounter++}`
const newEdgeId = () => `edge_${Date.now()}_${edgeCounter++}`

const defaultViewport: Viewport = { x: 100, y: 50, zoom: 0.8 }

let batchDepth = 0
let pendingHistory = false
let pendingSave = false
let isRestoring = false
let saveTimer: number | null = null
let compressTimer: number | null = null
let compressInProgress = false
let historyTimer: number | null = null
let historyPending = false

let history: HistoryEntry[] = []
let historyIndex = -1

let nodeIndexById = new Map<string, number>()
let edgeIndexById = new Map<string, number>()
let spatialIdx: SpatialIndex = createSpatialIndex(400)

const asPositiveInt = (v: unknown, fallback: number) => {
  const n = typeof v === 'number' ? v : Number(v)
  if (!Number.isFinite(n) || n <= 0) return fallback
  return Math.max(1, Math.floor(n))
}

const inferEdgeType = (edge: GraphEdge, nodesById: Map<string, GraphNode>): EdgeType => {
  const t = String(edge.type || '').trim()
  if (t === 'imageRole' || t === 'promptOrder' || t === 'imageOrder') return t
  const d: any = edge.data || {}
  if (d.imageRole) return 'imageRole'
  if (d.promptOrder != null) return 'promptOrder'
  if (d.imageOrder != null) return 'imageOrder'
  const s = nodesById.get(edge.source)
  const dst = nodesById.get(edge.target)
  if (s?.type === 'image' && dst?.type === 'videoConfig') return 'imageRole'
  if (s?.type === 'text' && dst?.type === 'imageConfig') return 'promptOrder'
  if (s?.type === 'image' && dst?.type === 'imageConfig') return 'imageOrder'
  return 'default'
}

const pickNextOrder = (
  edges: GraphEdge[],
  nodesById: Map<string, GraphNode>,
  targetId: string,
  kind: 'promptOrder' | 'imageOrder'
) => {
  const used = new Set<number>()
  for (const e of edges) {
    if (!e || e.target !== targetId) continue
    if (inferEdgeType(e, nodesById) !== kind) continue
    const v = asPositiveInt((e.data as any)?.[kind], 0)
    if (v > 0) used.add(v)
  }
  let next = 1
  while (used.has(next)) next++
  return next
}

const rebuildNodeIndex = (nodes: GraphNode[]) => {
  nodeIndexById = new Map()
  for (let i = 0; i < nodes.length; i++) nodeIndexById.set(nodes[i].id, i)
}

const rebuildEdgeIndex = (edges: GraphEdge[]) => {
  edgeIndexById = new Map()
  for (let i = 0; i < edges.length; i++) edgeIndexById.set(edges[i].id, i)
}

const cloneCanvas = (c: PersistedCanvasV1): PersistedCanvasV1 => ({
  version: 1,
  viewport: { ...c.viewport },
  nodes: c.nodes.map((n) => {
    const data = { ...(n.data || {}) } as Record<string, unknown>
    
    // 对于图片/视频/音频节点，不保存内联大数据到 localStorage
    // 大型数据会被保存到 IndexedDB，这里只保留 mediaId 引用
    if (n.type === 'image' || n.type === 'video' || n.type === 'audio') {
      // 检查 url 是否是大数据（data/blob 或超过 50KB）
      if (data.url && typeof data.url === 'string') {
        const url = data.url as string
        if (url.startsWith('data:') || url.startsWith('blob:') || url.length > 50000) {
          delete data.url
        }
      }
      // 检查 sourceUrl 是否是大数据
      if (data.sourceUrl && typeof data.sourceUrl === 'string') {
        const sourceUrl = data.sourceUrl as string
        if (sourceUrl.startsWith('data:') || sourceUrl.startsWith('blob:') || sourceUrl.length > 50000) {
          delete data.sourceUrl
        }
      }
      // 保留 mediaId 用于从 IndexedDB 恢复
      // 保留 HTTPS 格式的 sourceUrl 用于直接加载
    }
    
    return { ...n, data }
  }),
  edges: c.edges.map((e) => ({ ...e, data: e.data ? { ...e.data } : undefined }))
})

const snapshotCanvas = (s: Pick<GraphState, 'nodes' | 'edges' | 'viewport'>): PersistedCanvasV1 => ({
  version: 1,
  nodes: s.nodes,
  edges: s.edges,
  viewport: s.viewport
})

const readLocal = (projectId: string): PersistedCanvasV1 | null => {
  try {
    const raw = localStorage.getItem(`${STORAGE_KEY}:${projectId}`)
    if (!raw) return null
    const parsed = JSON.parse(raw)
    if (!parsed || parsed.version !== 1) return null
    return parsed as PersistedCanvasV1
  } catch {
    return null
  }
}

const writeLocal = (projectId: string, canvas: PersistedCanvasV1) => {
  try {
    localStorage.setItem(`${STORAGE_KEY}:${projectId}`, JSON.stringify(canvas))
  } catch {
    // ignore
  }
}

const tryTauriInvoke = async <T,>(command: string, payload?: Record<string, unknown>) => {
  try {
    const { isTauri, invoke } = await import('@tauri-apps/api/core')
    if (!isTauri()) return { ok: false as const }
    const res = await invoke<T>(command, payload)
    return { ok: true as const, res }
  } catch (err) {
    return { ok: false as const, err }
  }
}

// 增加保存防抖时间，让它在历史记录推送之后执行
const SAVE_DEBOUNCE_MS = 1200

const scheduleSave = () => {
  if (saveTimer) {
    // 重置定时器
    window.clearTimeout(saveTimer)
  }
  saveTimer = window.setTimeout(async () => {
    saveTimer = null
    const s = useGraphStore.getState()
    const canvas = cloneCanvas(snapshotCanvas(s))
    const projectId = s.projectId
    const tauri = await tryTauriInvoke('enqueue_save_project_canvas', { projectId, canvas })
    if (!tauri.ok) writeLocal(projectId, canvas)
    try {
      useProjectsStore.getState().touch(projectId)
    } catch {
      // ignore
    }
  }, SAVE_DEBOUNCE_MS)
}

// ===== Inline media persistence (dataURL/base64) =====
// 将当前内存中的内联媒体（data: / 纯 base64）落到 IndexedDB，并写回 mediaId，确保刷新/重启可恢复。
let inlineMediaMigrationToken = 0

const isHttpUrl = (v: string) => /^https?:\/\//i.test(v)

const isInlineMediaCandidate = (v: string) => {
  if (!v) return false
  if (v.startsWith('data:')) return true
  // 纯 base64（无前缀）兜底：较长且不是 http
  if (!isHttpUrl(v) && v.length > 50000) return true
  return false
}

const patchNodeDataSilently = (id: string, patch: Record<string, unknown>) => {
  const idx = nodeIndexById.get(id)
  if (idx === undefined) return
  useGraphStore.setState((s) => {
    const prev = s.nodes[idx]
    if (!prev) return {}
    const next: GraphNode = { ...prev, data: { ...(prev.data || {}), ...(patch || {}) } }
    const nodes = s.nodes.slice()
    nodes[idx] = next
    return { nodes }
  })
}

const migrateInlineMediaToIndexedDb = async (projectId: string) => {
  const token = ++inlineMediaMigrationToken
  const state = useGraphStore.getState()
  const pid = String(projectId || '').trim() || 'default'
  if (state.projectId !== pid) return

  const nodes = state.nodes.slice()
  if (nodes.length === 0) return

  for (const n of nodes) {
    if (token !== inlineMediaMigrationToken) return
    if (!n || (n.type !== 'image' && n.type !== 'video' && n.type !== 'audio')) continue

    const d: any = n.data || {}
    const existingMediaId = typeof d.mediaId === 'string' ? d.mediaId.trim() : ''
    if (existingMediaId) continue

    const url = typeof d.url === 'string' ? d.url.trim() : ''
    const sourceUrl = typeof d.sourceUrl === 'string' ? d.sourceUrl.trim() : ''
    const candidate = isInlineMediaCandidate(url) ? url : isInlineMediaCandidate(sourceUrl) ? sourceUrl : ''
    if (!candidate) continue

    try {
      const mediaType = n.type === 'audio' ? 'audio' : n.type === 'video' ? 'video' : 'image'
      const mediaId = await saveMedia({
        nodeId: n.id,
        projectId: pid,
        type: mediaType,
        data: candidate,
        sourceUrl: isHttpUrl(sourceUrl) ? sourceUrl : undefined,
        model: typeof d.model === 'string' ? d.model : undefined,
      })
      if (!mediaId) continue
      // IMPORTANT: 静默写回，不进入 undo/redo 历史
      patchNodeDataSilently(n.id, { mediaId })
    } catch {
      // ignore: IndexedDB may be unavailable or quota exceeded
    }
  }

  // 写回 mediaId 后触发一次保存，确保持久化画布包含 mediaId（url 会在 cloneCanvas 中被剥离）
  scheduleSave()
}

const scheduleHistoryCompression = () => {
  if (compressTimer) return
  compressTimer = window.setTimeout(() => {
    compressTimer = null
    void compressOldHistoryEntries()
  }, 400)
}

const compressOldHistoryEntries = async () => {
  if (compressInProgress) return
  if (history.length <= RAW_HISTORY_KEEP) return
  const probe = await tryTauriInvoke<string>('compress_json_lz4_base64', { value: { ok: true } })
  if (!probe.ok) return

  compressInProgress = true
  try {
    const keepFrom = Math.max(0, history.length - RAW_HISTORY_KEEP)
    for (let i = 0; i < keepFrom; i++) {
      const entry = history[i]
      if (!entry || entry.kind !== 'raw') continue
      const res = await tryTauriInvoke<string>('compress_json_lz4_base64', { value: entry.canvas })
      if (!res.ok) continue
      history[i] = { kind: 'lz4', compressed: res.res }
    }
  } finally {
    compressInProgress = false
  }
}

const pushHistory = () => {
  if (isRestoring) return
  const s = useGraphStore.getState()
  const canvas = cloneCanvas(snapshotCanvas(s))

  if (historyIndex < history.length - 1) history = history.slice(0, historyIndex + 1)
  history.push({ kind: 'raw', canvas })
  if (history.length > MAX_HISTORY) {
    const drop = history.length - MAX_HISTORY
    history = history.slice(drop)
    historyIndex = Math.max(-1, historyIndex - drop)
  }
  historyIndex = history.length - 1
  useGraphStore.setState({ historyIndex, historyLength: history.length })
  scheduleHistoryCompression()
}

// 增加防抖时间以避免频繁的深拷贝操作
// 原来是 300ms，现在增加到 800ms，让快速连续操作能够合并
const HISTORY_DEBOUNCE_MS = 800

const scheduleHistoryPush = () => {
  if (isRestoring) return
  historyPending = true
  if (historyTimer) {
    // 重置定时器（每次有新操作时重新计时）
    window.clearTimeout(historyTimer)
  }
  historyTimer = window.setTimeout(() => {
    historyTimer = null
    if (!historyPending) return
    historyPending = false
    pushHistory()
  }, HISTORY_DEBOUNCE_MS)
}

const flushHistoryNow = () => {
  if (historyTimer) {
    window.clearTimeout(historyTimer)
    historyTimer = null
  }
  if (historyPending) {
    historyPending = false
    pushHistory()
  }
}

const markDirty = () => {
  if (isRestoring) return
  if (batchDepth > 0) {
    pendingHistory = true
    pendingSave = true
    return
  }
  scheduleHistoryPush()
  scheduleSave()
}

const flushBatch = () => {
  if (batchDepth !== 0) return
  if (pendingHistory) {
    pendingHistory = false
    pushHistory()
  }
  if (pendingSave) {
    pendingSave = false
    scheduleSave()
  }
}

export type GraphState = {
  projectId: string
  nodes: GraphNode[]
  edges: GraphEdge[]
  viewport: Viewport
  selectedNodeId: string | null
  selectedNodeIds: string[]
  selectedEdgeId: string | null
  historyIndex: number
  historyLength: number

  setProjectId: (projectId: string) => Promise<void>
  hydrate: (projectId?: string) => Promise<void>
  saveNow: () => Promise<void>

  withBatchUpdates: <T>(fn: () => T) => T

  // 更新节点数据并持久化，但不进入 undo/redo 历史（用于 mediaId 等后台写回）
  patchNodeDataSilent: (id: string, patch: Record<string, unknown>) => void

  setSelected: (id: string | null) => void
  setSelection: (ids: string[], primaryId?: string | null) => void
  toggleSelected: (id: string) => void
  clearSelection: () => void
  setSelectedEdge: (id: string | null) => void
  setViewport: (vp: Viewport) => void

  addNode: (type: NodeType | string, pos: { x: number; y: number }, data?: Record<string, unknown>) => string
  duplicateNode: (id: string) => string | null
  updateNode: (id: string, patch: Partial<Omit<GraphNode, 'id'>>) => void
  commitNodePosition: (id: string) => void
  removeNode: (id: string) => void
  removeNodes: (ids: string[]) => void

  addEdge: (source: string, target: string, data?: Record<string, unknown>) => string
  updateEdge: (id: string, patch: Partial<Omit<GraphEdge, 'id'>>) => void
  setEdgeImageRole: (id: string, role: string) => void
  setEdgePromptOrder: (id: string, order: number) => void
  setEdgeImageOrder: (id: string, order: number) => void
  removeEdge: (id: string) => void

  clear: () => void
  createBench5k: () => void

  canUndo: () => boolean
  canRedo: () => boolean
  undo: () => Promise<void>
  redo: () => Promise<void>

  getSpatialIndex: () => SpatialIndex
  rebuildSpatialIndex: () => void
}

export const useGraphStore = create<GraphState>((set, get) => ({
  projectId: 'default',
  nodes: [],
  edges: [],
  viewport: defaultViewport,
  selectedNodeId: null,
  selectedNodeIds: [],
  selectedEdgeId: null,
  historyIndex: -1,
  historyLength: 0,

  setProjectId: async (projectId) => {
    const id = String(projectId || '').trim() || 'default'
    await get().hydrate(id)
  },

  hydrate: async (projectId) => {
    const id = String(projectId || '').trim() || 'default'
    const tauri = await tryTauriInvoke<PersistedCanvasV1 | null>('load_project_canvas', { projectId: id })
    const loaded = (tauri.ok ? (tauri.res as any) : null) || readLocal(id)
    const canvas = loaded && loaded.version === 1 ? loaded : null

    isRestoring = true
    try {
      const nextNodes = canvas?.nodes || []
      const nextEdges = canvas?.edges || []
      const nextViewport = canvas?.viewport || defaultViewport
      rebuildNodeIndex(nextNodes)
      rebuildEdgeIndex(nextEdges)
      // 重建空间索引
      spatialIdx = createSpatialIndex(400)
      rebuildIndex(spatialIdx, nextNodes, getNodeSize)
      set({
        projectId: id,
        nodes: nextNodes,
        edges: nextEdges,
        viewport: nextViewport,
        selectedNodeId: null,
        selectedNodeIds: [],
        selectedEdgeId: null
      })

      history = []
      historyIndex = -1
      pendingHistory = false
      pendingSave = false
      useGraphStore.setState({ historyIndex: -1, historyLength: 0 })
    } finally {
      isRestoring = false
    }
    pushHistory()

    // 后台迁移：把当前内存中的内联媒体写入 IndexedDB，并写回 mediaId（不进入历史）
    // 注：历史上已经丢失的内联数据无法从持久化画布恢复；这里只覆盖“当前会话仍持有 dataURL”的情况。
    setTimeout(() => {
      void migrateInlineMediaToIndexedDb(id)
    }, 0)
  },

  saveNow: async () => {
    const s = get()
    const canvas = cloneCanvas(snapshotCanvas(s))
    const tauri = await tryTauriInvoke('save_project_canvas', { projectId: s.projectId, canvas })
    if (!tauri.ok) writeLocal(s.projectId, canvas)
  },

  withBatchUpdates: (fn) => {
    batchDepth++
    try {
      return fn()
    } finally {
      batchDepth = Math.max(0, batchDepth - 1)
      flushBatch()
    }
  },

  patchNodeDataSilent: (id, patch) => {
    const tid = String(id || '').trim()
    if (!tid) return
    patchNodeDataSilently(tid, patch || {})
    // 只做持久化，不进入历史
    scheduleSave()
  },

  setSelected: (id) => {
    const next = id ? [id] : []
    set({ selectedNodeId: id, selectedNodeIds: next, selectedEdgeId: null })
  },

  setSelection: (ids, primaryId) => {
    const clean = Array.from(new Set((Array.isArray(ids) ? ids : []).map((x) => String(x || '').trim()).filter(Boolean)))
    const primary = primaryId != null ? String(primaryId || '').trim() : clean[0] || null
    set({
      selectedNodeId: primary || null,
      selectedNodeIds: primary ? (clean.includes(primary) ? clean : [primary, ...clean]) : clean,
      selectedEdgeId: null
    })
  },

  toggleSelected: (id) => {
    const tid = String(id || '').trim()
    if (!tid) return
    set((s) => {
      const exists = s.selectedNodeIds.includes(tid)
      const nextIds = exists ? s.selectedNodeIds.filter((x) => x !== tid) : [...s.selectedNodeIds, tid]
      const primary = exists ? (s.selectedNodeId === tid ? nextIds[0] || null : s.selectedNodeId) : s.selectedNodeId || tid
      return { selectedNodeIds: nextIds, selectedNodeId: primary, selectedEdgeId: null }
    })
  },

  clearSelection: () => set({ selectedNodeId: null, selectedNodeIds: [], selectedEdgeId: null }),

  setSelectedEdge: (id) => {
    const next = id ? String(id || '').trim() : null
    set({ selectedEdgeId: next || null, selectedNodeId: null, selectedNodeIds: [] })
  },

  setViewport: (vp) => {
    // 不调用 markDirty()，因为 viewport 变化不需要保存到历史记录
    // viewport 是临时视图状态，不需要持久化或 undo/redo
    set({ viewport: { x: Number(vp.x) || 0, y: Number(vp.y) || 0, zoom: Number(vp.zoom) || 1 } })
  },

  addNode: (type, pos, data) => {
    const id = newNodeId()
    const t = type as NodeType
    const x = Number(pos?.x) || 0
    const y = Number(pos?.y) || 0

    set((s) => {
      const node: GraphNode = { id, type: t, x, y, zIndex: s.nodes.length + 1, data: { ...(data || {}) } }
      nodeIndexById.set(id, s.nodes.length)
      // 延迟更新空间索引（使用 requestIdleCallback 或 setTimeout）
      // 这避免了在主线程忙碌时阻塞
      const updateIndex = () => indexNode(spatialIdx, node, getNodeSize(t))
      if (typeof requestIdleCallback !== 'undefined') {
        requestIdleCallback(updateIndex, { timeout: 100 })
      } else {
        setTimeout(updateIndex, 0)
      }
      return { nodes: [...s.nodes, node] }
    })
    markDirty()
    return id
  },

  duplicateNode: (id) => {
    const idx = nodeIndexById.get(id)
    if (idx === undefined) return null
    const s = get()
    const src = s.nodes[idx]
    if (!src) return null

    const nextId = newNodeId()
    set((state) => {
      const node: GraphNode = {
        id: nextId,
        type: src.type,
        x: src.x + 36,
        y: src.y + 36,
        zIndex: state.nodes.length + 1,
        data: { ...(src.data || {}) }
      }
      nodeIndexById.set(nextId, state.nodes.length)
      // 延迟更新空间索引
      const updateIndex = () => indexNode(spatialIdx, node, getNodeSize(src.type))
      if (typeof requestIdleCallback !== 'undefined') {
        requestIdleCallback(updateIndex, { timeout: 100 })
      } else {
        setTimeout(updateIndex, 0)
      }
      return { nodes: [...state.nodes, node] }
    })
    markDirty()
    return nextId
  },

  updateNode: (id, patch) => {
    const idx = nodeIndexById.get(id)
    if (idx === undefined) return
    
    // 检查是否只是位置更新（拖拽时）
    const isPositionOnlyUpdate = 
      patch.x !== undefined || patch.y !== undefined
      ? Object.keys(patch).every(k => k === 'x' || k === 'y')
      : false
    
    set((s) => {
      const prev = s.nodes[idx]
      if (!prev) return {}
      const next: GraphNode = {
        ...prev,
        ...patch,
        data: patch.data ? { ...(prev.data || {}), ...(patch.data as any) } : prev.data
      }
      const nodes = s.nodes.slice()
      nodes[idx] = next
      // 如果位置或类型变化，更新空间索引（延迟执行）
      if (patch.x !== undefined || patch.y !== undefined || patch.type !== undefined) {
        const updateIndex = () => indexNode(spatialIdx, next, getNodeSize(next.type))
        if (typeof requestIdleCallback !== 'undefined') {
          requestIdleCallback(updateIndex, { timeout: 50 })
        } else {
          setTimeout(updateIndex, 0)
        }
      }
      return { nodes }
    })
    
    // 只有非位置更新才触发历史保存（位置更新由 onNodeDragStop 单独触发）
    // 这与 Huobao 的行为一致
    if (!isPositionOnlyUpdate) {
    markDirty()
    }
  },

  removeNode: (id) => {
    const idx = nodeIndexById.get(id)
    if (idx === undefined) return
    // 异步清理该节点关联的媒体（不阻塞 UI）
    void deleteMediaByNodeId(id).catch(() => {})
    // 从空间索引移除
    removeNodeFromIndex(spatialIdx, id)
    set((s) => {
      const nodes = s.nodes.filter((n) => n.id !== id)
      const edges = s.edges.filter((e) => e.source !== id && e.target !== id)
      rebuildNodeIndex(nodes)
      rebuildEdgeIndex(edges)
      const selectedNodeIds = s.selectedNodeIds.filter((x) => x !== id)
      const selectedNodeId = s.selectedNodeId === id ? selectedNodeIds[0] || null : s.selectedNodeId
      const selectedEdgeId = s.selectedEdgeId && edges.some((e) => e.id === s.selectedEdgeId) ? s.selectedEdgeId : null
      return { nodes, edges, selectedNodeId, selectedNodeIds, selectedEdgeId }
    })
    markDirty()
  },

  removeNodes: (ids) => {
    const list = Array.isArray(ids) ? ids.map((x) => String(x || '').trim()).filter(Boolean) : []
    if (list.length === 0) return
    const removeSet = new Set(list)
    for (const id of list) {
      void deleteMediaByNodeId(id).catch(() => {})
    }
    // 从空间索引批量移除
    for (const id of list) {
      removeNodeFromIndex(spatialIdx, id)
    }
    set((s) => {
      const nodes = s.nodes.filter((n) => !removeSet.has(n.id))
      const edges = s.edges.filter((e) => !removeSet.has(e.source) && !removeSet.has(e.target))
      rebuildNodeIndex(nodes)
      rebuildEdgeIndex(edges)
      const selectedNodeIds = s.selectedNodeIds.filter((x) => !removeSet.has(x))
      const selectedNodeId = s.selectedNodeId && removeSet.has(s.selectedNodeId) ? selectedNodeIds[0] || null : s.selectedNodeId
      const selectedEdgeId = s.selectedEdgeId && edges.some((e) => e.id === s.selectedEdgeId) ? s.selectedEdgeId : null
      return { nodes, edges, selectedNodeId, selectedNodeIds, selectedEdgeId }
    })
    markDirty()
  },

  // 提交节点位置变更（拖拽结束后调用）
  // 这个方法只触发历史保存，不更新位置（位置已经在 updateNode 中更新了）
  commitNodePosition: (id: string) => {
    const idx = nodeIndexById.get(id)
    if (idx === undefined) return
    // 只调度历史和保存，不做其他操作
    markDirty()
  },

  addEdge: (source, target, data) => {
    const id = newEdgeId()
    set((s) => {
      const nodesById = new Map(s.nodes.map((n) => [n.id, n]))
      const src = nodesById.get(source)
      const dst = nodesById.get(target)

      const nextData: Record<string, unknown> = data ? { ...data } : {}
      let type: EdgeType | undefined

      if (src?.type === 'image' && dst?.type === 'videoConfig') {
        type = 'imageRole'
        const caps = getVideoModelCaps(String((dst?.data as any)?.model || '').trim())

        let takenFirst = false
        let takenLast = false
        for (const e of s.edges) {
          if (!e || e.target !== target || e.source === source) continue
          if (inferEdgeType(e, nodesById) !== 'imageRole') continue
          const r = String((e.data as any)?.imageRole || '').trim()
          if (r === 'first_frame_image') takenFirst = true
          else if (r === 'last_frame_image') takenLast = true
        }

        const desiredRaw = String((nextData as any)?.imageRole || '').trim()
        let role = coerceVideoImageRole(desiredRaw || 'first_frame_image', caps)

        // 避免同一目标节点首/尾帧重复：优先分配空闲角色，否则降级为参考图
        if (role === 'first_frame_image' && takenFirst) {
          if (caps.supportsLastFrame && !takenLast) role = 'last_frame_image'
          else role = 'input_reference'
        } else if (role === 'last_frame_image' && takenLast) {
          if (caps.supportsFirstFrame && !takenFirst) role = 'first_frame_image'
          else role = 'input_reference'
        }

        // 若模型不支持参考图，则尽量回退到首/尾帧（若仍无可用角色，保留 input_reference 以便 UI/运行时提示）
        if (!caps.supportsReferenceImages && role === 'input_reference') {
          if (caps.supportsFirstFrame && !takenFirst) role = 'first_frame_image'
          else if (caps.supportsLastFrame && !takenLast) role = 'last_frame_image'
        }

        nextData.imageRole = role
      } else if (src?.type === 'text' && dst?.type === 'imageConfig') {
        type = 'promptOrder'
        const order = asPositiveInt((nextData as any)?.promptOrder, 0)
        const next = pickNextOrder(s.edges, nodesById, target, 'promptOrder')
        const used = new Set<number>()
        for (const e of s.edges) {
          if (!e || e.target !== target) continue
          if (inferEdgeType(e, nodesById) !== 'promptOrder') continue
          used.add(asPositiveInt((e.data as any)?.promptOrder, 0))
        }
        nextData.promptOrder = order > 0 && !used.has(order) ? order : next
      } else if (src?.type === 'image' && dst?.type === 'imageConfig') {
        type = 'imageOrder'
        const order = asPositiveInt((nextData as any)?.imageOrder, 0)
        const next = pickNextOrder(s.edges, nodesById, target, 'imageOrder')
        const used = new Set<number>()
        for (const e of s.edges) {
          if (!e || e.target !== target) continue
          if (inferEdgeType(e, nodesById) !== 'imageOrder') continue
          used.add(asPositiveInt((e.data as any)?.imageOrder, 0))
        }
        nextData.imageOrder = order > 0 && !used.has(order) ? order : next
      }

      const hasData = Object.keys(nextData).length > 0
      const edge: GraphEdge = { id, source, target, type, data: hasData ? nextData : undefined }
      edgeIndexById.set(id, s.edges.length)
      return { edges: [...s.edges, edge] }
    })
    markDirty()
    return id
  },

  updateEdge: (id, patch) => {
    const idx = edgeIndexById.get(id)
    if (idx === undefined) return
    set((s) => {
      const prev = s.edges[idx]
      if (!prev) return {}
      const next: GraphEdge = {
        ...prev,
        ...patch,
        data: patch.data ? { ...(prev.data || {}), ...(patch.data as any) } : prev.data
      }
      const edges = s.edges.slice()
      edges[idx] = next
      return { edges }
    })
    markDirty()
  },

  setEdgeImageRole: (id, role) => {
    const idx = edgeIndexById.get(id)
    if (idx === undefined) return
    const roleRaw = String(role || '').trim()

    set((s) => {
      const prev = s.edges[idx]
      if (!prev) return {}

      const nodesById = new Map(s.nodes.map((n) => [n.id, n]))
      const edges = s.edges.slice()
      const targetId = prev.target
      const targetNode = nodesById.get(targetId)
      const caps = targetNode?.type === 'videoConfig' ? getVideoModelCaps(String((targetNode.data as any)?.model || '').trim()) : null

      // 收集同一 target 的 imageRole 边
      const relatedIdx: number[] = []
      for (let i = 0; i < edges.length; i++) {
        const e = edges[i]
        if (!e || e.target !== targetId) continue
        if (inferEdgeType(e, nodesById) !== 'imageRole') continue
        relatedIdx.push(i)
      }

      const desired = caps ? coerceVideoImageRole(roleRaw || 'first_frame_image', caps) : (roleRaw || 'first_frame_image')

      // 先写入期望角色
      const nextRoles = new Map<string, string>()
      for (const i of relatedIdx) {
        const e = edges[i]
        const cur = i === idx ? desired : String((e.data as any)?.imageRole || '').trim() || 'first_frame_image'
        nextRoles.set(e.id, caps ? coerceVideoImageRole(cur, caps) : cur)
      }

      // 约束：首帧/尾帧唯一
      let hasFirst = false
      let hasLast = false
      for (const i of relatedIdx) {
        const e = edges[i]
        let r = String(nextRoles.get(e.id) || '').trim()
        if (caps) {
          if (r === 'first_frame_image') {
            if (!caps.supportsFirstFrame || hasFirst) r = 'input_reference'
            else hasFirst = true
          } else if (r === 'last_frame_image') {
            if (!caps.supportsLastFrame || hasLast) r = 'input_reference'
            else hasLast = true
          } else if (r === 'input_reference') {
            if (!caps.supportsReferenceImages) r = 'input_reference'
          }
        }
        nextRoles.set(e.id, r)
      }

      // 若模型不支持参考图：尽量把 input_reference 重新分配到首/尾帧空位
      if (caps && !caps.supportsReferenceImages) {
        // 重新统计
        hasFirst = false
        hasLast = false
        for (const i of relatedIdx) {
          const e = edges[i]
          const r = String(nextRoles.get(e.id) || '').trim()
          if (r === 'first_frame_image') hasFirst = true
          else if (r === 'last_frame_image') hasLast = true
        }
        for (const i of relatedIdx) {
          const e = edges[i]
          let r = String(nextRoles.get(e.id) || '').trim()
          if (r !== 'input_reference') continue
          if (caps.supportsFirstFrame && !hasFirst) {
            r = 'first_frame_image'
            hasFirst = true
          } else if (caps.supportsLastFrame && !hasLast) {
            r = 'last_frame_image'
            hasLast = true
          }
          nextRoles.set(e.id, r)
        }
      }

      // 特例：有尾帧必须有首帧（Omni-Video 等）
      if (caps?.requiresFirstFrameIfLastFrame) {
        hasFirst = false
        hasLast = false
        for (const i of relatedIdx) {
          const e = edges[i]
          const r = String(nextRoles.get(e.id) || '').trim()
          if (r === 'first_frame_image') hasFirst = true
          if (r === 'last_frame_image') hasLast = true
        }
        if (hasLast && !hasFirst && caps.supportsFirstFrame) {
          // 从 input_reference 中借一个升级为首帧（尽量不改动当前边）
          for (const i of relatedIdx) {
            const e = edges[i]
            if (e.id === prev.id) continue
            const r = String(nextRoles.get(e.id) || '').trim()
            if (r !== 'input_reference') continue
            nextRoles.set(e.id, 'first_frame_image')
            hasFirst = true
            break
          }
        }
      }

      // 写回
      for (const i of relatedIdx) {
        const e = edges[i]
        const r = String(nextRoles.get(e.id) || '').trim() || 'first_frame_image'
        edges[i] = { ...e, type: 'imageRole', data: { ...(e.data || {}), imageRole: r } }
      }
      rebuildEdgeIndex(edges)
      return { edges }
    })
    markDirty()
  },

  setEdgePromptOrder: (id, order) => {
    const idx = edgeIndexById.get(id)
    if (idx === undefined) return
    const nextOrder = asPositiveInt(order, 1)

    set((s) => {
      const prev = s.edges[idx]
      if (!prev) return {}

      const nodesById = new Map(s.nodes.map((n) => [n.id, n]))
      const edges = s.edges.slice()
      const target = prev.target
      const currentOrder = asPositiveInt((prev.data as any)?.promptOrder, 1)

      for (let i = 0; i < edges.length; i++) {
        if (i === idx) continue
        const e = edges[i]
        if (!e || e.target !== target) continue
        if (inferEdgeType(e, nodesById) !== 'promptOrder') continue
        const o = asPositiveInt((e.data as any)?.promptOrder, 0)
        if (o !== nextOrder) continue
        edges[i] = { ...e, type: 'promptOrder', data: { ...(e.data || {}), promptOrder: currentOrder } }
        break
      }

      edges[idx] = { ...prev, type: 'promptOrder', data: { ...(prev.data || {}), promptOrder: nextOrder } }
      rebuildEdgeIndex(edges)
      return { edges }
    })
    markDirty()
  },

  setEdgeImageOrder: (id, order) => {
    const idx = edgeIndexById.get(id)
    if (idx === undefined) return
    const nextOrder = asPositiveInt(order, 1)

    set((s) => {
      const prev = s.edges[idx]
      if (!prev) return {}

      const nodesById = new Map(s.nodes.map((n) => [n.id, n]))
      const edges = s.edges.slice()
      const target = prev.target
      const currentOrder = asPositiveInt((prev.data as any)?.imageOrder, 1)

      for (let i = 0; i < edges.length; i++) {
        if (i === idx) continue
        const e = edges[i]
        if (!e || e.target !== target) continue
        if (inferEdgeType(e, nodesById) !== 'imageOrder') continue
        const o = asPositiveInt((e.data as any)?.imageOrder, 0)
        if (o !== nextOrder) continue
        edges[i] = { ...e, type: 'imageOrder', data: { ...(e.data || {}), imageOrder: currentOrder } }
        break
      }

      edges[idx] = { ...prev, type: 'imageOrder', data: { ...(prev.data || {}), imageOrder: nextOrder } }
      rebuildEdgeIndex(edges)
      return { edges }
    })
    markDirty()
  },

  removeEdge: (id) => {
    const idx = edgeIndexById.get(id)
    if (idx === undefined) return
    set((s) => {
      const edges = s.edges.filter((e) => e.id !== id)
      rebuildEdgeIndex(edges)
      const selectedEdgeId = s.selectedEdgeId === id ? null : s.selectedEdgeId
      return { edges, selectedEdgeId }
    })
    markDirty()
  },

  clear: () => {
    // 清理当前画布所有节点的媒体（不阻塞 UI）
    try {
      const ids = useGraphStore.getState().nodes.map((n) => n.id)
      for (const id of ids) void deleteMediaByNodeId(id).catch(() => {})
    } catch {
      // ignore
    }
    set({ nodes: [], edges: [], selectedNodeId: null, selectedNodeIds: [], selectedEdgeId: null, viewport: defaultViewport })
    rebuildNodeIndex([])
    rebuildEdgeIndex([])
    // 清空空间索引
    spatialIdx = createSpatialIndex(400)
    markDirty()
  },

  createBench5k: () => {
    const count = 5000
    const cols = 100
    const gapX = 280
    const gapY = 220

    const nodes: GraphNode[] = new Array(count)
    for (let i = 0; i < count; i++) {
      const x = (i % cols) * gapX
      const y = Math.floor(i / cols) * gapY
      nodes[i] = {
        id: newNodeId(),
        type: (i % 10 === 0 ? 'image' : i % 13 === 0 ? 'video' : 'text') as NodeType,
        x,
        y,
        zIndex: i + 1,
        data: { label: `节点 ${i + 1}` }
      }
    }

    const edges: GraphEdge[] = []
    for (let i = 0; i < count - 1; i += 2) {
      const a = nodes[i]
      const b = nodes[i + 1]
      edges.push({ id: newEdgeId(), source: a.id, target: b.id })
    }

    set({ nodes, edges, selectedNodeId: null, selectedNodeIds: [], selectedEdgeId: null, viewport: defaultViewport })
    rebuildNodeIndex(nodes)
    rebuildEdgeIndex(edges)
    // 重建空间索引
    spatialIdx = createSpatialIndex(400)
    rebuildIndex(spatialIdx, nodes, getNodeSize)
    markDirty()
  },

  canUndo: () => historyIndex > 0,
  canRedo: () => historyIndex >= 0 && historyIndex < history.length - 1,

  undo: async () => {
    flushHistoryNow()
    if (historyIndex <= 0) return
    const nextIndex = historyIndex - 1
    const entry = history[nextIndex]
    if (!entry) return

    const restore = async () => {
      if (entry.kind === 'raw') return entry.canvas
      const res = await tryTauriInvoke<any>('decompress_json_lz4_base64', { b64: entry.compressed })
      if (!res.ok) return null
      const canvas = res.res as PersistedCanvasV1
      if (!canvas || canvas.version !== 1) return null
      return canvas
    }

    const canvas = await restore()
    if (!canvas) return

    isRestoring = true
    try {
      rebuildNodeIndex(canvas.nodes)
      rebuildEdgeIndex(canvas.edges)
      // 重建空间索引
      spatialIdx = createSpatialIndex(400)
      rebuildIndex(spatialIdx, canvas.nodes, getNodeSize)
      set({ nodes: canvas.nodes, edges: canvas.edges, viewport: canvas.viewport, selectedNodeId: null, selectedNodeIds: [], selectedEdgeId: null })
      historyIndex = nextIndex
      useGraphStore.setState({ historyIndex, historyLength: history.length })
      scheduleSave()
    } finally {
      isRestoring = false
    }
  },

  redo: async () => {
    flushHistoryNow()
    if (historyIndex < 0 || historyIndex >= history.length - 1) return
    const nextIndex = historyIndex + 1
    const entry = history[nextIndex]
    if (!entry) return

    const restore = async () => {
      if (entry.kind === 'raw') return entry.canvas
      const res = await tryTauriInvoke<any>('decompress_json_lz4_base64', { b64: entry.compressed })
      if (!res.ok) return null
      const canvas = res.res as PersistedCanvasV1
      if (!canvas || canvas.version !== 1) return null
      return canvas
    }

    const canvas = await restore()
    if (!canvas) return

    isRestoring = true
    try {
      rebuildNodeIndex(canvas.nodes)
      rebuildEdgeIndex(canvas.edges)
      // 重建空间索引
      spatialIdx = createSpatialIndex(400)
      rebuildIndex(spatialIdx, canvas.nodes, getNodeSize)
      set({ nodes: canvas.nodes, edges: canvas.edges, viewport: canvas.viewport, selectedNodeId: null, selectedNodeIds: [], selectedEdgeId: null })
      historyIndex = nextIndex
      useGraphStore.setState({ historyIndex, historyLength: history.length })
      scheduleSave()
    } finally {
      isRestoring = false
    }
  },

  getSpatialIndex: () => spatialIdx,

  rebuildSpatialIndex: () => {
    const s = get()
    spatialIdx = createSpatialIndex(400)
    rebuildIndex(spatialIdx, s.nodes, getNodeSize)
  }
}))

// NOTE: 不在模块加载时自动 hydrate，避免 Home/Assistant 等页面被动加载大画布数据。
// 由路由页面（Canvas/Assistant）按需触发 hydrate。
