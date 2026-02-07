/**
 * ReactFlowCanvas - 使用 @xyflow/react 的画布组件
 * 完全对齐 Huobao 的 Vue Flow 实现，确保 60fps 性能
 * 
 * 性能优化策略（V3 - 彻底优化）：
 * 1. 完全分离 React Flow 内部状态和 Zustand
 * 2. React Flow 100% 管理自己的状态（拖拽、缩放、平移）
 * 3. 只在必要时（拖拽结束、添加/删除节点）同步到 Zustand
 * 4. 移除所有订阅，使用事件驱动同步
 * 5. 禁用所有可能导致重渲染的功能
 */
import React, { useCallback, useMemo, useRef, useEffect } from 'react'
import {
  ReactFlow,
  useNodesState,
  useEdgesState,
  Connection,
  Node,
  NodeTypes,
  EdgeTypes,
  useReactFlow,
  ReactFlowProvider,
  OnNodeDrag,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import { useGraphStore } from '@/graph/store'
import type { GraphNode } from '@/graph/types'
import type { CanvasContextPayload } from './CanvasContextMenu'

// 导入自定义节点组件
import { TextNodeComponent } from './nodes/TextNodeFlow'
import { ImageConfigNodeComponent } from './nodes/ImageConfigNodeFlow'
import { ImageNodeComponent } from './nodes/ImageNodeFlow'
import { VideoConfigNodeComponent } from './nodes/VideoConfigNodeFlow'
import { VideoNodeComponent } from './nodes/VideoNodeFlow'
import { AudioNodeComponent } from './nodes/AudioNodeFlow'
import { LocalSaveNodeComponent } from './nodes/LocalSaveNodeFlow'
import { KlingVideoToolNodeComponent } from './nodes/KlingVideoToolNodeFlow'
import { KlingImageToolNodeComponent } from './nodes/KlingImageToolNodeFlow'
import { KlingAudioToolNodeComponent } from './nodes/KlingAudioToolNodeFlow'

// 导入自定义边组件
import { ImageRoleEdge } from './edges/ImageRoleEdge'

// 定义节点类型映射 - 必须在模块级别定义，避免每次渲染重新创建
const nodeTypes: NodeTypes = {
  text: TextNodeComponent,
  imageConfig: ImageConfigNodeComponent,
  image: ImageNodeComponent,
  videoConfig: VideoConfigNodeComponent,
  video: VideoNodeComponent,
  audio: AudioNodeComponent,
  localSave: LocalSaveNodeComponent,
  klingVideoTool: KlingVideoToolNodeComponent,
  klingImageTool: KlingImageToolNodeComponent,
  klingAudioTool: KlingAudioToolNodeComponent,
}

// 定义边类型映射
const edgeTypes: EdgeTypes = {
  imageRole: ImageRoleEdge,
}

// React Flow 只认识 edgeTypes 里注册过的 type；未注册的类型会触发 warning 并回退。
// 这里做降级：保留 store 中的语义 type/data，但在 React Flow 层用 default 渲染，避免运行期噪音与不一致。
const normalizeFlowEdgeType = (t: unknown) => {
  const key = String(t || '').trim()
  if (key && (edgeTypes as any)[key]) return key
  return 'default'
}

const isDev = import.meta.env.DEV
const toBool = (v: string | null) => v === '1' || v === 'true'
const readDebugFlag = (
  params: URLSearchParams,
  paramKey: string,
  storageKey: string | null,
  fallback = false
) => {
  if (!isDev) return false
  const pv = params.get(paramKey)
  if (pv != null) return toBool(pv)
  if (!storageKey) return fallback
  try {
    const v = localStorage.getItem(storageKey)
    if (v == null) return fallback
    return toBool(v)
  } catch {
    return fallback
  }
}


// 将 GraphNode 转换为 React Flow 节点
function graphNodeToFlowNode(node: GraphNode): Node {
  return {
    id: node.id,
    type: node.type,
    position: { x: node.x, y: node.y },
    data: { ...node.data, label: node.data?.label || node.type },
    selected: false,
    zIndex: node.zIndex || 0,
  }
}

export interface ConnectEndEvent {
  sourceNodeId: string
  sourceNodeType: string
  screenX: number
  screenY: number
  flowX: number
  flowY: number
}

interface ReactFlowCanvasInnerProps {
  onContextMenu?: (payload: CanvasContextPayload) => void
  onConnectEnd?: (event: ConnectEndEvent) => void
  onFileDrop?: (files: File[], clientPos: { x: number; y: number }) => void
}

function ReactFlowCanvasInner({ onContextMenu, onConnectEnd, onFileDrop }: ReactFlowCanvasInnerProps) {
  const reactFlowWrapper = useRef<HTMLDivElement>(null)
  const { screenToFlowPosition, setViewport: setRfViewport, getViewport } = useReactFlow()
  
  const debugFlags = useMemo(() => {
    const params = new URLSearchParams(window.location.search)
    const debugMode = toBool(params.get('debug'))
    const gate = (value: boolean) => (debugMode ? value : false)
    return {
      perfProbe: gate(readDebugFlag(params, 'perf', 'nexus.debug.perfProbe', true)),
      minimalCanvas: gate(readDebugFlag(params, 'minimal', 'nexus.debug.minimalCanvas', false)),
      disableBackground: gate(readDebugFlag(params, 'bg', 'nexus.debug.disableBackground', false)),
      disableControls: gate(readDebugFlag(params, 'controls', 'nexus.debug.disableControls', false)),
      disableSnap: gate(readDebugFlag(params, 'snap', 'nexus.debug.disableSnap', false)),
      disableComposite: gate(readDebugFlag(params, 'comp', 'nexus.debug.disableComposite', false)),
    }
  }, [])

  // 使用 ref 存储定时器和状态，避免任何重渲染
  const saveTimerRef = useRef<number>(0)
  const syncPendingRef = useRef(false)
  const viewportRef = useRef<{ x: number; y: number; zoom: number } | null>(null)
  const minimalRef = useRef<HTMLDivElement>(null)
  const zoomTimerRef = useRef<number>(0)
  const applyingViewportRef = useRef(false)

  // 视口同步：Zustand store -> ReactFlow（尤其是 hydrate / 切换项目后，确保“视口中心”计算一致）
  useEffect(() => {
    const close = (a: number, b: number) => Math.abs(a - b) < 0.5

    const apply = (vp: any) => {
      const next = vp || { x: 0, y: 0, zoom: 1 }
      try {
        const curr = (typeof getViewport === 'function' ? getViewport() : null) as any
        const same =
          curr &&
          close(Number(curr.x) || 0, Number(next.x) || 0) &&
          close(Number(curr.y) || 0, Number(next.y) || 0) &&
          close(Number(curr.zoom) || 1, Number(next.zoom) || 1)
        if (same) return
        if (applyingViewportRef.current) return
        applyingViewportRef.current = true
        ;(setRfViewport as any)({
          x: Number(next.x) || 0,
          y: Number(next.y) || 0,
          zoom: Number(next.zoom) || 1
        })
      } finally {
        applyingViewportRef.current = false
      }
    }

    // 首次对齐一次（避免初始 mount 时 viewport 不一致）
    apply(useGraphStore.getState().viewport)

    const unsubscribe = useGraphStore.subscribe((state, prev) => {
      if (state.viewport === prev.viewport) return
      apply(state.viewport)
    })
    return unsubscribe
  }, [getViewport, setRfViewport])

  // 初始化时从 store 获取数据（只读一次）
  const initialNodesRef = useRef<Node[]>([])
  const initialEdgesRef = useRef<any[]>([])
  const initializedRef = useRef(false)
  
  if (!initializedRef.current) {
    const state = useGraphStore.getState()
    initialNodesRef.current = state.nodes.map(graphNodeToFlowNode)
    initialEdgesRef.current = state.edges.map((e) => ({
      id: e.id,
      source: e.source,
      target: e.target,
      sourceHandle: (e.data as any)?.sourceHandle || 'right',
      targetHandle: (e.data as any)?.targetHandle || 'left',
      type: normalizeFlowEdgeType(e.type),
      data: e.data,
    }))
    initializedRef.current = true
  }

  const [nodes, setNodes, onNodesChange] = useNodesState(initialNodesRef.current)
  const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdgesRef.current)

  // 存储当前节点和边的数量（用于快速检测外部变化）
  const nodeCountRef = useRef(initialNodesRef.current.length)
  const edgeCountRef = useRef(initialEdgesRef.current.length)
  const nodeIdsRef = useRef<Set<string>>(new Set(initialNodesRef.current.map(n => n.id)))
  const edgeIdsRef = useRef<Set<string>>(new Set(initialEdgesRef.current.map(e => e.id)))

  // 使用订阅监听外部添加/删除节点
  useEffect(() => {
    const unsubscribe = useGraphStore.subscribe(
      (state) => {
        // 处理节点变化
        const currentNodeIds = new Set(state.nodes.map(n => n.id))
        const addedNodes: Node[] = []
        const removedIds: string[] = []
        
        for (const node of state.nodes) {
          if (!nodeIdsRef.current.has(node.id)) {
            addedNodes.push(graphNodeToFlowNode(node))
          }
        }
        for (const id of nodeIdsRef.current) {
          if (!currentNodeIds.has(id)) {
            removedIds.push(id)
          }
        }
        
        if (addedNodes.length > 0 || removedIds.length > 0) {
          console.log('[ReactFlowCanvas] 节点增删:', { added: addedNodes.map(n => n.id), removed: removedIds })
          setNodes((prev) => {
            let result = prev
            if (removedIds.length > 0) {
              const removeSet = new Set(removedIds)
              result = result.filter(n => !removeSet.has(n.id))
            }
            if (addedNodes.length > 0) {
              result = [...result, ...addedNodes]
            }
            return result
          })
          nodeIdsRef.current = currentNodeIds
          nodeCountRef.current = state.nodes.length
        }
        
        // 处理边变化
        const currentEdgeIds = new Set(state.edges.map(e => e.id))
        const addedEdges: any[] = []
        const removedEdgeIds: string[] = []
        
        for (const edge of state.edges) {
          if (!edgeIdsRef.current.has(edge.id)) {
            addedEdges.push({
              id: edge.id,
              source: edge.source,
              target: edge.target,
              sourceHandle: (edge.data as any)?.sourceHandle || 'right',
              targetHandle: (edge.data as any)?.targetHandle || 'left',
              type: normalizeFlowEdgeType(edge.type),
              data: edge.data,
            })
          }
        }
        for (const id of edgeIdsRef.current) {
          if (!currentEdgeIds.has(id)) {
            removedEdgeIds.push(id)
          }
        }
        
        if (addedEdges.length > 0 || removedEdgeIds.length > 0) {
          setEdges((prev) => {
            let result = prev
            if (removedEdgeIds.length > 0) {
              const removeSet = new Set(removedEdgeIds)
              result = result.filter(e => !removeSet.has(e.id))
            }
            if (addedEdges.length > 0) {
              result = [...result, ...addedEdges]
            }
            return result
          })
          edgeIdsRef.current = currentEdgeIds
          edgeCountRef.current = state.edges.length
        }
      }
    )
    
    return unsubscribe
  }, [setNodes, setEdges])

  // 额外订阅：监听节点数据变化（loading/url 等属性更新）
  useEffect(() => {
    // 存储节点数据的快照用于比较
    const nodeDataSnapshotRef: Record<string, any> = {}
    
    // 初始化快照
    for (const node of useGraphStore.getState().nodes) {
      nodeDataSnapshotRef[node.id] = { ...node.data }
    }
    
    const unsubscribe = useGraphStore.subscribe(
      (state) => {
        // 检查节点数据是否变化
        const updatedNodes: { id: string; data: any }[] = []
        
        for (const node of state.nodes) {
          const prev = nodeDataSnapshotRef[node.id]
          const curr = node.data as any
          
          if (!prev) {
            // 新节点，记录快照并标记为需要更新
            console.log('[ReactFlowCanvas] 发现新节点:', node.id, node.type)
            nodeDataSnapshotRef[node.id] = { ...node.data }
            // 新节点也需要同步数据到 React Flow
            updatedNodes.push({ id: node.id, data: node.data })
            continue
          }
          
          // 检查关键属性是否变化
          const loadingChanged = prev.loading !== curr?.loading
          const urlChanged = prev.url !== curr?.url
          const errorChanged = prev.error !== curr?.error
          const contentChanged = prev.content !== curr?.content
          const executedChanged = prev.executed !== curr?.executed
          const mediaIdChanged = prev.mediaId !== curr?.mediaId
          const sourceUrlChanged = prev.sourceUrl !== curr?.sourceUrl
          const fileNameChanged = prev.fileName !== curr?.fileName
          
          if (
            loadingChanged ||
            urlChanged ||
            errorChanged ||
            contentChanged ||
            executedChanged ||
            mediaIdChanged ||
            sourceUrlChanged ||
            fileNameChanged
          ) {
            console.log('[ReactFlowCanvas] 节点数据变化:', node.id, {
              loadingChanged,
              urlChanged,
              errorChanged,
              contentChanged,
              executedChanged,
              mediaIdChanged,
              sourceUrlChanged,
              fileNameChanged,
              prevLoading: prev.loading, currLoading: curr?.loading,
              prevUrl: !!prev.url, currUrl: !!curr?.url
            })
            updatedNodes.push({ id: node.id, data: node.data })
            nodeDataSnapshotRef[node.id] = { ...node.data }
          }
        }
        
        if (updatedNodes.length > 0) {
          console.log('[ReactFlowCanvas] 同步节点数据到 React Flow:', updatedNodes.map(n => ({ id: n.id, loading: n.data?.loading, hasUrl: !!n.data?.url })))
          setNodes((prev) => {
            const newNodes = prev.map(n => {
              const updated = updatedNodes.find(u => u.id === n.id)
              if (updated) {
                console.log('[ReactFlowCanvas] 更新节点:', n.id, '新 data:', { loading: updated.data?.loading, hasUrl: !!updated.data?.url })
                return { ...n, data: updated.data }
              }
              return n
            })
            console.log('[ReactFlowCanvas] setNodes 完成, 节点数:', newNodes.length)
            return newNodes
          })
        }
      }
    )
    
    return unsubscribe
  }, [setNodes])

  useEffect(() => {
    if (!debugFlags.minimalCanvas) return
    const el = minimalRef.current
    if (!el) return

    let panActive = false
    let lastX = 0
    let lastY = 0
    let tx = 0
    let ty = 0
    let zoom = 1
    let rafId = 0
    let pending = false

    const applyTransform = () => {
      pending = false
      el.style.transform = `translate(${tx}px, ${ty}px) scale(${zoom})`
    }

    const schedule = () => {
      if (pending) return
      pending = true
      rafId = requestAnimationFrame(applyTransform)
    }

    const onPointerDown = (e: PointerEvent) => {
      panActive = true
      lastX = e.clientX
      lastY = e.clientY
      el.setPointerCapture?.(e.pointerId)
    }
    const onPointerMove = (e: PointerEvent) => {
      if (!panActive) return
      const dx = e.clientX - lastX
      const dy = e.clientY - lastY
      lastX = e.clientX
      lastY = e.clientY
      tx += dx
      ty += dy
      schedule()
    }
    const onPointerUp = (e: PointerEvent) => {
      panActive = false
      el.releasePointerCapture?.(e.pointerId)
    }
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey) return
      e.preventDefault()
      const factor = Math.exp(-e.deltaY * 0.001)
      zoom = Math.max(0.1, Math.min(2, zoom * factor))
      schedule()
    }

    el.addEventListener('pointerdown', onPointerDown)
    window.addEventListener('pointermove', onPointerMove)
    window.addEventListener('pointerup', onPointerUp)
    el.addEventListener('wheel', onWheel, { passive: false })

    return () => {
      cancelAnimationFrame(rafId)
      el.removeEventListener('pointerdown', onPointerDown)
      window.removeEventListener('pointermove', onPointerMove)
      window.removeEventListener('pointerup', onPointerUp)
      el.removeEventListener('wheel', onWheel as EventListener)
    }
  }, [debugFlags.minimalCanvas])

  useEffect(() => {
    if (!debugFlags.perfProbe) return
    const root = reactFlowWrapper.current
    if (!root) return

    let rafId = 0
    let last = 0
    const frameTimes: number[] = []
    const longTasks: number[] = []
    let over34 = 0
    let over50 = 0
    let lastInputAt = 0
    const inputCounts = { wheel: 0, pointermove: 0 }
    const maxFrames = 180
    const maxLongTasks = 50

    const onFrame = (ts: number) => {
      if (last) {
        const dt = ts - last
        frameTimes.push(dt)
        if (frameTimes.length > maxFrames) frameTimes.shift()
        if (dt > 34) over34++
        if (dt > 50) over50++
      }
      last = ts
      rafId = requestAnimationFrame(onFrame)
    }
    rafId = requestAnimationFrame(onFrame)

    let longTaskObserver: PerformanceObserver | null = null
    if ('PerformanceObserver' in window) {
      longTaskObserver = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          longTasks.push(entry.duration)
          if (longTasks.length > maxLongTasks) longTasks.shift()
        }
      })
      try {
        longTaskObserver.observe({ entryTypes: ['longtask'] })
      } catch {
        // ignore
      }
    }

    const onWheel = () => {
      lastInputAt = performance.now()
      inputCounts.wheel++
    }
    const onPointerMove = () => {
      lastInputAt = performance.now()
      inputCounts.pointermove++
    }
    root.addEventListener('wheel', onWheel, { passive: true })
    root.addEventListener('pointermove', onPointerMove, { passive: true })

    const report = () => {
      if (!frameTimes.length) return
      const sorted = frameTimes.slice().sort((a, b) => a - b)
      const sum = frameTimes.reduce((a, b) => a + b, 0)
      const avg = sum / frameTimes.length
      const p95 = sorted[Math.floor(sorted.length * 0.95)] || 0
      const max = sorted[sorted.length - 1] || 0
      const longMax = longTasks.length ? Math.max(...longTasks) : 0
      const payload = {
        avgFps: Math.round(1000 / avg),
        p95Ms: Number(p95.toFixed(1)),
        maxMs: Number(max.toFixed(1)),
        over34,
        over50,
        longTasks: longTasks.length,
        longMaxMs: Number(longMax.toFixed(1)),
        inputCounts: { ...inputCounts },
        lastInputAgoMs: lastInputAt ? Math.round(performance.now() - lastInputAt) : null,
      }
      console.info('[perf]', payload)

      const hud = document.getElementById('rf-perf-hud')
      if (hud) {
        hud.textContent = `avg:${payload.avgFps} p95:${payload.p95Ms} max:${payload.maxMs} long:${payload.longTasks}/${payload.longMaxMs}`
      }
    }
    const reportTimer = window.setInterval(report, 2000)

    return () => {
      cancelAnimationFrame(rafId)
      if (longTaskObserver) longTaskObserver.disconnect()
      root.removeEventListener('wheel', onWheel)
      root.removeEventListener('pointermove', onPointerMove)
      window.clearInterval(reportTimer)
    }
  }, [debugFlags.perfProbe])

  // 处理节点拖拽结束 - 只在这里同步位置到 Zustand
  const handleNodeDragStop: OnNodeDrag<Node> = useCallback(
    (_event: any, node: any) => {
      reactFlowWrapper.current?.classList.remove('rf-moving')
      // 使用 requestIdleCallback 延迟同步，不阻塞 UI
      const sync = () => {
        const store = useGraphStore.getState()
        store.updateNode(node.id, {
          x: node.position.x,
          y: node.position.y,
        })
        store.commitNodePosition(node.id)
      }
      
      if (typeof requestIdleCallback !== 'undefined') {
        requestIdleCallback(sync, { timeout: 100 })
      } else {
        setTimeout(sync, 0)
      }
    },
    []
  )

  const handleNodeDragStart: OnNodeDrag<Node> = useCallback(() => {
    reactFlowWrapper.current?.classList.add('rf-moving')
  }, [])

  // 处理连接
  const handleConnect = useCallback(
    (params: Connection) => {
      if (!params.source || !params.target) return

      // 获取源节点和目标节点类型
      const store = useGraphStore.getState()
      const sourceNode = store.nodes.find((n) => n.id === params.source)
      const targetNode = store.nodes.find((n) => n.id === params.target)

      // 根据节点类型决定边类型和数据
      const edgeData: Record<string, unknown> = {
        sourceHandle: params.sourceHandle || 'right',
        targetHandle: params.targetHandle || 'left',
      }

      // 图片 → 视频配置：使用 imageRole 边类型
      if (sourceNode?.type === 'image' && targetNode?.type === 'videoConfig') {
        edgeData.imageRole = 'first_frame_image' // 默认首帧，store.addEdge 会自动处理唯一性
      }

      // IMPORTANT: 以 Zustand store 作为唯一真源，避免 ReactFlow 本地边与 store 边双写造成重复边
      // store.addEdge 会生成唯一 id，并由 store→ReactFlow 订阅同步到本地 edges state
      store.addEdge(params.source, params.target, edgeData)
    },
    []
  )

  // 记录连接开始时的源节点信息
  const connectSourceRef = useRef<{ nodeId: string; nodeType: string } | null>(null)

  // 处理连接开始
  const handleConnectStart = useCallback(
    (_event: any, params: { nodeId: string | null; handleType: 'source' | 'target' | null }) => {
      if (!params.nodeId) return
      const store = useGraphStore.getState()
      const sourceNode = store.nodes.find((n) => n.id === params.nodeId)
      if (sourceNode) {
        connectSourceRef.current = { nodeId: sourceNode.id, nodeType: sourceNode.type }
      }
    },
    []
  )

  // 处理连接结束（拖拽到空白区域）
  const handleConnectEndCallback = useCallback(
    (event: MouseEvent | TouchEvent) => {
      // 如果没有源节点信息，忽略
      if (!connectSourceRef.current) return

      // 检查是否拖拽到了空白区域（而不是连接到了节点）
      // 通过检查事件目标来判断
      const target = event.target as HTMLElement
      const isOnNode = target?.closest('.react-flow__node')
      const isOnHandle = target?.closest('.react-flow__handle')
      
      // 如果是在节点或连接点上释放，表示正常连接，不处理
      if (isOnNode || isOnHandle) {
        connectSourceRef.current = null
        return
      }

      // 获取鼠标/触摸位置
      let clientX = 0, clientY = 0
      if ('touches' in event && event.touches.length > 0) {
        clientX = event.touches[0].clientX
        clientY = event.touches[0].clientY
      } else if ('changedTouches' in event && event.changedTouches.length > 0) {
        clientX = event.changedTouches[0].clientX
        clientY = event.changedTouches[0].clientY
      } else if ('clientX' in event) {
        clientX = event.clientX
        clientY = event.clientY
      }

      // 转换为画布坐标
      const flowPosition = screenToFlowPosition({ x: clientX, y: clientY })

      // 调用回调
      onConnectEnd?.({
        sourceNodeId: connectSourceRef.current.nodeId,
        sourceNodeType: connectSourceRef.current.nodeType,
        screenX: clientX,
        screenY: clientY,
        flowX: flowPosition.x,
        flowY: flowPosition.y,
      })

      connectSourceRef.current = null
    },
    [onConnectEnd, screenToFlowPosition]
  )

  // 处理视口变化 - 仅记录，交互结束时提交
  const handleViewportChange = useCallback(
    (vp: { x: number; y: number; zoom: number }) => {
      viewportRef.current = vp
      // 缩放时短暂隐藏边线与背景，降低合成开销
      if (zoomTimerRef.current) window.clearTimeout(zoomTimerRef.current)
      reactFlowWrapper.current?.classList.add('rf-zooming')
      zoomTimerRef.current = window.setTimeout(() => {
        reactFlowWrapper.current?.classList.remove('rf-zooming')
      }, 120)
    },
    []
  )

  const handleMoveEnd = useCallback(
    (_event: unknown, vp: { x: number; y: number; zoom: number }) => {
      reactFlowWrapper.current?.classList.remove('rf-moving')
      viewportRef.current = vp
      const commit = () => {
        if (!viewportRef.current) return
        useGraphStore.getState().setViewport(viewportRef.current)
      }
      if (typeof requestIdleCallback !== 'undefined') {
        requestIdleCallback(commit, { timeout: 200 })
      } else {
        if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
        saveTimerRef.current = window.setTimeout(commit, 0)
      }
    },
    []
  )

  const handleMoveStart = useCallback(() => {
    reactFlowWrapper.current?.classList.add('rf-moving')
  }, [])

  // 处理画布右键菜单
  const handlePaneContextMenu = useCallback(
    (event: React.MouseEvent | MouseEvent) => {
      event.preventDefault()
      const position = screenToFlowPosition({ x: (event as MouseEvent).clientX, y: (event as MouseEvent).clientY })
      onContextMenu?.({
        kind: 'canvas',
        clientX: event.clientX,
        clientY: event.clientY,
        world: { x: position.x, y: position.y },
      })
    },
    [onContextMenu, screenToFlowPosition]
  )

  // 处理节点右键菜单
  const handleNodeContextMenu = useCallback(
    (event: React.MouseEvent, node: Node) => {
      event.preventDefault()
      onContextMenu?.({
        kind: 'node',
        id: node.id,
        clientX: event.clientX,
        clientY: event.clientY,
      })
    },
    [onContextMenu]
  )

  // 处理边右键菜单
  const handleEdgeContextMenu = useCallback(
    (event: React.MouseEvent, edge: any) => {
      event.preventDefault()
      const id = String(edge?.id || '').trim()
      if (!id) return
      onContextMenu?.({
        kind: 'edge',
        id,
        clientX: event.clientX,
        clientY: event.clientY,
      })
    },
    [onContextMenu]
  )

  // Selection 同步：ReactFlow -> Zustand（让 Delete/Undo/Redo 走同一份 store 状态）
  const handleSelectionChange = useCallback((sel: any) => {
    const selectedNodes: Array<{ id: string }> = Array.isArray(sel?.nodes) ? sel.nodes : []
    const selectedEdges: Array<{ id: string }> = Array.isArray(sel?.edges) ? sel.edges : []

    const nodeIds = selectedNodes.map((n) => String(n?.id || '').trim()).filter(Boolean)
    const edgeId = String(selectedEdges[0]?.id || '').trim()

    const store = useGraphStore.getState()
    if (nodeIds.length > 0) {
      store.setSelection(nodeIds, nodeIds[0] || null)
      return
    }
    if (edgeId) {
      store.setSelectedEdge(edgeId)
      return
    }
    store.clearSelection()
  }, [])

  // 处理画布点击 - 延迟处理
  const handlePaneClick = useCallback(() => {
    setTimeout(() => {
      useGraphStore.getState().setSelected(null)
    }, 0)
  }, [])

  // 反向同步：Zustand -> ReactFlow（当快捷键/菜单修改 selection 时，保持 UI 高亮一致）
  useEffect(() => {
    const unsubscribe = useGraphStore.subscribe((state, prev) => {
      if (state.selectedNodeIds === prev.selectedNodeIds && state.selectedEdgeId === prev.selectedEdgeId) return

      const nodeSet = new Set(state.selectedNodeIds || [])
      const edgeId = state.selectedEdgeId || null

      setNodes((prevNodes) =>
        prevNodes.map((n) => {
          const nextSelected = nodeSet.has(n.id)
          return n.selected === nextSelected ? n : { ...n, selected: nextSelected }
        })
      )

      setEdges((prevEdges) =>
        prevEdges.map((e) => {
          const nextSelected = edgeId ? e.id === edgeId : false
          return (e as any).selected === nextSelected ? e : { ...e, selected: nextSelected }
        })
      )
    })
    return unsubscribe
  }, [setEdges, setNodes])

  // 监听自定义节点更新事件（由 image.ts / video.ts 生成完成后触发）
  // 强制刷新 React Flow 节点，确保新生成的图片/视频能正确显示
  useEffect(() => {
    const handleNodeUpdated = (event: CustomEvent) => {
      const { nodeId, type } = event.detail || {}
      if (!nodeId) return
      
      console.log('[ReactFlowCanvas] 收到节点更新事件:', nodeId, type)
      
      // 从 store 获取最新数据
      const storeNode = useGraphStore.getState().nodes.find(n => n.id === nodeId)
      if (!storeNode) {
        console.warn('[ReactFlowCanvas] 节点不存在:', nodeId)
        return
      }
      
      // 强制更新 React Flow 节点
      setNodes((prev) => {
        const idx = prev.findIndex(n => n.id === nodeId)
        if (idx === -1) {
          // 节点不在 React Flow 中，可能需要添加
          console.log('[ReactFlowCanvas] 节点不在 React Flow 中，添加:', nodeId)
          return [...prev, graphNodeToFlowNode(storeNode)]
        }
        
        // 更新现有节点
        const updated = [...prev]
        updated[idx] = {
          ...updated[idx],
          data: storeNode.data
        }
        console.log('[ReactFlowCanvas] 强制刷新节点:', nodeId, 'hasUrl:', !!(storeNode.data as any)?.url)
        return updated
      })
    }
    
    window.addEventListener('nexus:node-updated', handleNodeUpdated as EventListener)
    return () => window.removeEventListener('nexus:node-updated', handleNodeUpdated as EventListener)
  }, [setNodes])

  // 监听边数据变化（imageRole / order / handles 等），同步到 ReactFlow edge state，确保自定义边 UI 更新
  useEffect(() => {
    const pick = (data: any) => ({
      imageRole: data?.imageRole,
      promptOrder: data?.promptOrder,
      imageOrder: data?.imageOrder,
      sourceHandle: data?.sourceHandle,
      targetHandle: data?.targetHandle,
    })

    const same = (a: any, b: any) => {
      const x = pick(a)
      const y = pick(b)
      return (
        x.imageRole === y.imageRole &&
        x.promptOrder === y.promptOrder &&
        x.imageOrder === y.imageOrder &&
        x.sourceHandle === y.sourceHandle &&
        x.targetHandle === y.targetHandle
      )
    }

    const unsubscribe = useGraphStore.subscribe((state, prev) => {
      if (state.edges === prev.edges) return

      const prevById = new Map(prev.edges.map((e) => [e.id, e]))
      const updates = new Map<string, { type: string; data: any }>()
      for (const e of state.edges) {
        const p = prevById.get(e.id)
        if (!p) continue
        const nextType = normalizeFlowEdgeType(e.type)
        const prevType = normalizeFlowEdgeType(p.type)
        if (nextType !== prevType || !same(e.data, p.data)) {
          updates.set(e.id, { type: nextType, data: e.data })
        }
      }
      if (updates.size === 0) return

      setEdges((prevEdges) =>
        prevEdges.map((edge) => {
          const u = updates.get(edge.id)
          if (!u) return edge
          return {
            ...edge,
            type: u.type,
            data: u.data,
          }
        })
      )
    })
    return unsubscribe
  }, [setEdges])

  // 获取初始视口
  const defaultViewport = useMemo(() => useGraphStore.getState().viewport, [])

  if (debugFlags.minimalCanvas) {
    return (
      <div ref={reactFlowWrapper} className="w-full h-full rf-minimal">
        <div ref={minimalRef} className="rf-minimal-content">
          <div className="rf-minimal-card">Minimal Canvas</div>
        </div>
        {debugFlags.perfProbe && <div id="rf-perf-hud" className="rf-perf-hud" />}
      </div>
    )
  }

  // 处理文件拖放
  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    e.dataTransfer.dropEffect = 'copy'
    console.log('[ReactFlowCanvas] dragOver 事件触发')
  }, [])

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    console.log('[ReactFlowCanvas] drop 事件触发', {
      files: e.dataTransfer?.files?.length,
      types: e.dataTransfer?.types
    })
    
    const isSupportedMediaFile = (f: File) => {
      const t = String((f as any)?.type || '').toLowerCase()
      if (/^(image|audio|video)\//i.test(t)) return true
      // 桌面拖拽在部分环境下 File.type 可能为空：用扩展名兜底
      const name = String((f as any)?.name || '').toLowerCase()
      const m = name.match(/\.([a-z0-9]+)$/i)
      const ext = String(m?.[1] || '').toLowerCase()
      if (!ext) return false
      if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'svg', 'tif', 'tiff', 'avif'].includes(ext)) return true
      if (['mp4', 'webm', 'mov', 'm4v', 'avi', 'mkv'].includes(ext)) return true
      if (['mp3', 'wav', 'm4a', 'aac', 'ogg', 'flac'].includes(ext)) return true
      return false
    }

    const files = Array.from(e.dataTransfer?.files || []).filter(isSupportedMediaFile)
    console.log('[ReactFlowCanvas] 过滤后的媒体文件数:', files.length)
    
    if (files.length > 0 && onFileDrop) {
      console.log('[ReactFlowCanvas] 调用 onFileDrop')
      onFileDrop(files, { x: e.clientX, y: e.clientY })
      return
    }
    // 处理从历史面板拖拽的素材
    const raw = e.dataTransfer?.getData('application/json') || ''
    if (raw && onFileDrop) {
      try {
        const asset = JSON.parse(raw)
        const src = String(asset?.src || asset?.url || '').trim()
        const type = String(asset?.type || '').trim()
        if (src && type) {
          e.preventDefault()
          // 创建一个伪 File 对象来触发相同的处理逻辑
          // 但这里我们需要直接处理，因为 asset 不是真正的文件
          // 触发自定义事件让 Canvas.tsx 处理
          const customEvent = new CustomEvent('nexus:asset-drop', {
            detail: { asset, clientX: e.clientX, clientY: e.clientY }
          })
          window.dispatchEvent(customEvent)
        }
      } catch {
        // ignore
      }
    }
  }, [onFileDrop])

  return (
    <div 
      ref={reactFlowWrapper} 
      className="w-full h-full"
      onDragOver={handleDragOver}
      onDrop={handleDrop}
      onDragEnter={(e) => {
        e.preventDefault()
        e.stopPropagation()
        console.log('[ReactFlowCanvas] dragEnter')
      }}
    >
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onNodeDragStart={handleNodeDragStart}
        onNodeDragStop={handleNodeDragStop}
        onConnect={handleConnect}
        onConnectStart={handleConnectStart}
        onConnectEnd={handleConnectEndCallback}
        onSelectionChange={handleSelectionChange}
        onViewportChange={handleViewportChange}
        onMoveStart={handleMoveStart}
        onMoveEnd={handleMoveEnd}
        onPaneContextMenu={handlePaneContextMenu}
        onNodeContextMenu={handleNodeContextMenu}
        onEdgeContextMenu={handleEdgeContextMenu}
        onPaneClick={handlePaneClick}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        defaultViewport={defaultViewport}
        deleteKeyCode={null}
        minZoom={0.1}
        maxZoom={2}
        onlyRenderVisibleElements={true}
        snapToGrid={!debugFlags.disableSnap}
        snapGrid={[20, 20]}
        fitView={false}
        proOptions={{ hideAttribution: true }}
        className={`bg-[var(--bg-primary)]${debugFlags.disableComposite ? ' rf-no-composite' : ''}`}
      >
        {/* MiniMap 和 Controls 已移除（用户要求删除左下角缩放控件） */}
      </ReactFlow>
      {debugFlags.perfProbe && <div id="rf-perf-hud" className="rf-perf-hud" />}
    </div>
  )
}

// 导出包装后的组件
export default function ReactFlowCanvas(props: ReactFlowCanvasInnerProps) {
  return (
    <ReactFlowProvider>
      <ReactFlowCanvasInner {...props} />
    </ReactFlowProvider>
  )
}
