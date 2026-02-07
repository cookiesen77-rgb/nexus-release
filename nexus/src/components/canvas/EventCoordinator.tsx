import React, { useCallback, useEffect, useRef } from 'react'
import { useGraphStore } from '@/graph/store'
import { getNodeSize } from '@/graph/nodeSizing'
import {
  screenToWorld,
  hitTestNode,
  hitTestEdge,
  hitTestEdgeEndpoint,
  hitTestPort,
  inferPortSide,
  getPortWorldPos,
  getLocalPoint,
  snapToGrid,
  clampZoom,
  bezierControls,
  readPortSide,
  type Vec2,
  type PortSide
} from '@/graph/hitTesting'
import type { GraphNode, Viewport } from '@/graph/types'

/**
 * 事件协调层
 * 统一处理画布上的所有指针事件，并根据交互类型分发到适当的处理逻辑
 */

export type CanvasTool = 'select' | 'pan' | 'add' | 'connect'

type ContextMenuPayload =
  | { kind: 'node'; id: string; clientX: number; clientY: number }
  | { kind: 'edge'; id: string; clientX: number; clientY: number }
  | { kind: 'canvas'; clientX: number; clientY: number; world: { x: number; y: number } }

type DragState =
  | { kind: 'node'; nodeIds: string[]; startWorld: Vec2; startPos: Map<string, Vec2>; lastLocal: Vec2 }
  | { kind: 'canvas'; startLocal: Vec2; startViewport: Viewport }
  | { kind: 'select-box'; startWorld: Vec2; currentWorld: Vec2; additive: boolean }
  | {
      kind: 'connect'
      fromId: string
      fromSide: PortSide
      from: Vec2
      to: Vec2
      toSide: PortSide
      reconnect?: {
        edgeId: string
        moveEnd: 'source' | 'target'
        fixedId: string
        fixedSide: PortSide
      }
    }
  | {
      kind: 'multi-connect'
      sources: Array<{ nodeId: string; from: Vec2; fromSide: PortSide }>
      to: Vec2
      toSide: PortSide
    }

type ConnectPreview =
  | {
      kind?: 'single'
      from: Vec2
      to: Vec2
      fromSide: PortSide
      toSide: PortSide
    }
  | {
      kind: 'multi'
      sources: Array<{ nodeId: string; from: Vec2; fromSide: PortSide }>
      to: Vec2
      toSide: PortSide
    }

type Props = {
  children: React.ReactNode
  tool?: CanvasTool
  connectMode?: boolean
  onPickNode?: (id: string | null) => void
  onRequestAddNode?: (pos: { x: number; y: number }) => void
  onContextMenu?: (payload: ContextMenuPayload) => void
  onInteractingChange?: (val: boolean) => void
  onTransientViewportChange?: (vp: Viewport | null) => void
  onConnectPreviewChange?: (preview: ConnectPreview | null) => void
  onSelectBoxChange?: (box: { start: Vec2; current: Vec2 } | null) => void
  onAlignGuideChange?: (guide: { x?: number; y?: number } | null) => void
}

export default function EventCoordinator({
  children,
  tool = 'select',
  connectMode = false,
  onPickNode,
  onRequestAddNode,
  onContextMenu,
  onInteractingChange,
  onTransientViewportChange,
  onConnectPreviewChange,
  onSelectBoxChange,
  onAlignGuideChange
}: Props) {
  const rootRef = useRef<HTMLDivElement>(null)

  // 使用 ref 追踪状态以避免闭包问题
  const toolRef = useRef(tool)
  const connectModeRef = useRef(connectMode)
  const dragRef = useRef<DragState | null>(null)
  const transientViewportRef = useRef<Viewport | null>(null)
  const isInteractingRef = useRef(false)
  const wheelTimerRef = useRef<number>(0)
  const interactingTimerRef = useRef<number>(0)

  useEffect(() => {
    toolRef.current = tool
  }, [tool])

  useEffect(() => {
    connectModeRef.current = connectMode
    if (!connectMode) {
      dragRef.current = null
      onConnectPreviewChange?.(null)
    }
  }, [connectMode, onConnectPreviewChange])

  const setInteracting = useCallback(
    (val: boolean) => {
      isInteractingRef.current = val
      onInteractingChange?.(val)

      if (!val) {
        if (interactingTimerRef.current) {
          window.clearTimeout(interactingTimerRef.current)
          interactingTimerRef.current = 0
        }
        return
      }

      // 自动重置交互状态（用于滚轮等短暂交互）
      if (interactingTimerRef.current) window.clearTimeout(interactingTimerRef.current)
      interactingTimerRef.current = window.setTimeout(() => {
        interactingTimerRef.current = 0
        isInteractingRef.current = false
        onInteractingChange?.(false)
      }, 140)
    },
    [onInteractingChange]
  )

  const handlePointerDown = useCallback(
    (ev: React.PointerEvent) => {
      ev.preventDefault()
      const target = ev.currentTarget as HTMLElement
      target.setPointerCapture(ev.pointerId)
      setInteracting(true)

      const currentTool = toolRef.current
      const inConnectMode = connectModeRef.current
      const local = getLocalPoint(ev.nativeEvent)

      const store = useGraphStore.getState()
      const vp = transientViewportRef.current || store.viewport
      const world = screenToWorld(local, vp)
      const nodesById = new Map(store.nodes.map((n) => [n.id, n]))
      const shift = ev.shiftKey

      // 命中检测
      const hitNode = hitTestNode(world, store.nodes, getNodeSize, vp.zoom)

      // 工具：平移模式
      if (currentTool === 'pan') {
        dragRef.current = { kind: 'canvas', startLocal: local, startViewport: { ...vp } }
        transientViewportRef.current = { ...vp }
        onTransientViewportChange?.(transientViewportRef.current)
        return
      }

      // 命中节点
      if (hitNode) {
        // 连接模式：创建连接或执行多选快速连接
        if (inConnectMode) {
          const idx = store.nodes.findIndex((n) => n.id === hitNode.id)
          const portSide = hitTestPort(world, hitNode, getNodeSize(hitNode.type), 14 / vp.zoom)
          const fromSide: PortSide = portSide || inferPortSide(world, hitNode, getNodeSize(hitNode.type))

          // 检查是否点击的是选中节点之一（用于判断是开始拖拽还是快速连接）
          const selectedIds = store.selectedNodeIds
          const clickedOnSelectedNode = selectedIds.includes(hitNode.id)

          // 多选快速连接逻辑：点击未选中的目标节点时，将所有选中节点连接到该目标
          if (!portSide && selectedIds.length >= 2 && !clickedOnSelectedNode) {
            const targetId = hitNode.id
            const sources = selectedIds.filter((x) => x !== targetId)
            const existingKeys = new Set(
              store.edges.map((e) => {
                const d: any = e.data || {}
                return `${e.source}|${e.target}|${readPortSide(d.sourcePort, 'right')}|${readPortSide(d.targetPort, 'left')}`
              })
            )

            store.withBatchUpdates(() => {
              for (const sourceId of sources) {
                const key = `${sourceId}|${targetId}|right|left`
                if (existingKeys.has(key)) continue
                store.addEdge(sourceId, targetId, { sourcePort: 'right', targetPort: 'left' })
                existingKeys.add(key)
              }
            })

            store.setSelected(targetId)
            onPickNode?.(targetId)
            return
          }

          // 开始绘制连接线
          const isMultiConnect = selectedIds.length >= 2 && clickedOnSelectedNode

          if (isMultiConnect) {
            // 多选连接：收集所有选中节点的端口位置
            const sources = selectedIds.map(id => {
              const node = store.nodes.find(n => n.id === id)!
              return {
                nodeId: id,
                from: getPortWorldPos(node, 'right', getNodeSize(node.type)),
                fromSide: 'right' as PortSide
              }
            })

            dragRef.current = {
              kind: 'multi-connect',
              sources,
              to: world,
              toSide: 'left'
            }

            onConnectPreviewChange?.({
              kind: 'multi',
              sources,
              to: world,
              toSide: 'left'
            })
          } else {
            // 单节点连接
            const from = getPortWorldPos(hitNode, fromSide, getNodeSize(hitNode.type))
            dragRef.current = {
              kind: 'connect',
              fromId: hitNode.id,
              fromSide,
              from,
              to: world,
              toSide: 'left'
            }
            onConnectPreviewChange?.({ from, to: world, fromSide, toSide: 'left' })
          }

          store.setSelected(hitNode.id)
          onPickNode?.(hitNode.id)
          return
        }

        // 选择模式
        if (currentTool === 'select') {
          if (shift) {
            store.toggleSelected(hitNode.id)
          } else if (!store.selectedNodeIds.includes(hitNode.id)) {
            store.setSelected(hitNode.id)
          }
        } else {
          store.setSelected(hitNode.id)
        }
        onPickNode?.(hitNode.id)

        // 添加模式下不拖拽
        if (currentTool === 'add') return

        // 初始化节点拖拽
        if (currentTool === 'select') {
          const selected = store.selectedNodeIds.includes(hitNode.id)
            ? store.selectedNodeIds
            : [hitNode.id]
          const startPos = new Map<string, Vec2>()
          for (const id of selected) {
            const n = store.nodes.find((x) => x.id === id)
            if (n) startPos.set(id, { x: n.x, y: n.y })
          }
          dragRef.current = {
            kind: 'node',
            nodeIds: selected,
            startWorld: world,
            startPos,
            lastLocal: local
          }
        }
        return
      }

      // 未命中节点
      if (inConnectMode) {
        // 检测是否点击了边缘端点（用于重连接）
        const endpoint = hitTestEdgeEndpoint(
          world,
          store.edges,
          nodesById,
          getNodeSize,
          12 / vp.zoom
        )
        if (endpoint) {
          const edge = store.edges.find((e) => e.id === endpoint.id)
          if (edge) {
            const d: any = edge.data || {}
            const sourceSide = readPortSide(d.sourcePort || d.sourceHandle, 'right')
            const targetSide = readPortSide(d.targetPort || d.targetHandle, 'left')
            const fixedId = endpoint.end === 'source' ? edge.target : edge.source
            const fixedSide = endpoint.end === 'source' ? targetSide : sourceSide
            const fixedNode = nodesById.get(fixedId)

            if (fixedNode) {
              const from = getPortWorldPos(fixedNode, fixedSide, getNodeSize(fixedNode.type))
              dragRef.current = {
                kind: 'connect',
                fromId: fixedId,
                fromSide: fixedSide,
                from,
                to: world,
                toSide: 'left',
                reconnect: {
                  edgeId: edge.id,
                  moveEnd: endpoint.end,
                  fixedId,
                  fixedSide
                }
              }
              onConnectPreviewChange?.({ from, to: world, fromSide: fixedSide, toSide: 'left' })
              store.setSelectedEdge(edge.id)
              onPickNode?.(null)
              return
            }
          }
        }

        dragRef.current = null
        onConnectPreviewChange?.(null)
        return
      }

      // 选择模式：检测边缘或开始框选
      if (currentTool === 'select') {
        // 检测边缘端点（用于重连接）
        const endpoint = hitTestEdgeEndpoint(
          world,
          store.edges,
          nodesById,
          getNodeSize,
          12 / vp.zoom
        )
        if (endpoint) {
          const edge = store.edges.find((e) => e.id === endpoint.id)
          if (edge) {
            const d: any = edge.data || {}
            const sourceSide = readPortSide(d.sourcePort || d.sourceHandle, 'right')
            const targetSide = readPortSide(d.targetPort || d.targetHandle, 'left')
            const fixedId = endpoint.end === 'source' ? edge.target : edge.source
            const fixedSide = endpoint.end === 'source' ? targetSide : sourceSide
            const fixedNode = nodesById.get(fixedId)

            if (fixedNode) {
              const from = getPortWorldPos(fixedNode, fixedSide, getNodeSize(fixedNode.type))
              dragRef.current = {
                kind: 'connect',
                fromId: fixedId,
                fromSide: fixedSide,
                from,
                to: world,
                toSide: 'left',
                reconnect: {
                  edgeId: edge.id,
                  moveEnd: endpoint.end,
                  fixedId,
                  fixedSide
                }
              }
              onConnectPreviewChange?.({ from, to: world, fromSide: fixedSide, toSide: 'left' })
              store.setSelectedEdge(edge.id)
              onPickNode?.(null)
              return
            }
          }
        }

        // 检测边缘命中
        const edgeId = hitTestEdge(world, store.edges, nodesById, getNodeSize, 10 / vp.zoom)
        if (edgeId) {
          store.setSelectedEdge(edgeId)
          onPickNode?.(null)
          return
        }

        // 开始框选
        if (!shift) store.clearSelection()
        dragRef.current = {
          kind: 'select-box',
          startWorld: world,
          currentWorld: world,
          additive: shift
        }
        onSelectBoxChange?.({ start: world, current: world })
        return
      }

      // 其他情况：清除选中，可能开始画布拖拽
      store.setSelected(null)
      onPickNode?.(null)

      // 添加模式：请求添加节点
      if (currentTool === 'add') {
        onRequestAddNode?.(world)
        return
      }

      // 默认开始画布平移
      dragRef.current = { kind: 'canvas', startLocal: local, startViewport: { ...vp } }
      transientViewportRef.current = { ...vp }
      onTransientViewportChange?.(transientViewportRef.current)
    },
    [
      setInteracting,
      onTransientViewportChange,
      onPickNode,
      onConnectPreviewChange,
      onRequestAddNode,
      onSelectBoxChange
    ]
  )

  const handlePointerMove = useCallback(
    (ev: React.PointerEvent) => {
      const drag = dragRef.current
      if (!drag) return

      const local = getLocalPoint(ev.nativeEvent)
      const store = useGraphStore.getState()
      const vp = transientViewportRef.current || store.viewport
      const world = screenToWorld(local, vp)

      setInteracting(true)

      if (drag.kind === 'canvas') {
        const dx = local.x - drag.startLocal.x
        const dy = local.y - drag.startLocal.y
        transientViewportRef.current = {
          x: drag.startViewport.x + dx,
          y: drag.startViewport.y + dy,
          zoom: drag.startViewport.zoom
        }
        onTransientViewportChange?.(transientViewportRef.current)
        return
      }

      if (drag.kind === 'node') {
        const dxw = world.x - drag.startWorld.x
        const dyw = world.y - drag.startWorld.y
        const allowSnap = !ev.altKey && toolRef.current === 'select'

        let alignDx = 0
        let alignDy = 0
        let alignXLine: number | undefined
        let alignYLine: number | undefined

        // 对齐吸附计算
        if (allowSnap && drag.nodeIds.length > 0) {
          const zoom = vp.zoom || 1
          const threshold = 7 / Math.max(0.001, zoom)
          const dragged = new Set(drag.nodeIds)
          const primaryId = store.selectedNodeId && dragged.has(store.selectedNodeId)
            ? store.selectedNodeId
            : drag.nodeIds[0]
          const primaryStart = drag.startPos.get(primaryId)
          const primaryNode = store.nodes.find((n) => n.id === primaryId)

          if (primaryStart && primaryNode) {
            const rawPrimary = { x: primaryStart.x + dxw, y: primaryStart.y + dyw }
            const { w: pw, h: ph } = getNodeSize(primaryNode.type)
            const pxs = [rawPrimary.x, rawPrimary.x + pw * 0.5, rawPrimary.x + pw]
            const pys = [rawPrimary.y, rawPrimary.y + ph * 0.5, rawPrimary.y + ph]

            let bestX: { delta: number; target: number } | null = null
            let bestY: { delta: number; target: number } | null = null

            for (const other of store.nodes) {
              if (dragged.has(other.id)) continue
              const { w, h } = getNodeSize(other.type)
              const oxs = [other.x, other.x + w * 0.5, other.x + w]
              const oys = [other.y, other.y + h * 0.5, other.y + h]

              for (const p of pxs) {
                for (const o of oxs) {
                  const d = o - p
                  const ad = Math.abs(d)
                  if (ad > threshold) continue
                  if (!bestX || ad < Math.abs(bestX.delta)) bestX = { delta: d, target: o }
                }
              }
              for (const p of pys) {
                for (const o of oys) {
                  const d = o - p
                  const ad = Math.abs(d)
                  if (ad > threshold) continue
                  if (!bestY || ad < Math.abs(bestY.delta)) bestY = { delta: d, target: o }
                }
              }
            }

            if (bestX) {
              alignDx = bestX.delta
              alignXLine = bestX.target * zoom + vp.x
            }
            if (bestY) {
              alignDy = bestY.delta
              alignYLine = bestY.target * zoom + vp.y
            }
          }
        }

        onAlignGuideChange?.(
          allowSnap && (alignXLine != null || alignYLine != null)
            ? { x: alignXLine, y: alignYLine }
            : null
        )

        // 更新拖拽中的节点位置（仅在 GPU 端，不更新 store）
        // 这部分需要与 WebGLGraphCanvas 配合，通过回调传递位置
        drag.lastLocal = local
        return
      }

      if (drag.kind === 'connect') {
        const hitNode = hitTestNode(world, store.nodes, getNodeSize, vp.zoom)
        let to = world
        let toSide: PortSide = 'left'

        if (hitNode && hitNode.id !== drag.fromId) {
          const portSide = hitTestPort(world, hitNode, getNodeSize(hitNode.type), 14 / vp.zoom)
          toSide = portSide || inferPortSide(world, hitNode, getNodeSize(hitNode.type))
          to = getPortWorldPos(hitNode, toSide, getNodeSize(hitNode.type))
        } else {
          toSide = world.x >= drag.from.x ? 'left' : 'right'
        }

        dragRef.current = { ...drag, to, toSide }
        onConnectPreviewChange?.({ from: drag.from, to, fromSide: drag.fromSide, toSide })
        return
      }

      if (drag.kind === 'multi-connect') {
        const hitNode = hitTestNode(world, store.nodes, getNodeSize, vp.zoom)
        let to = world
        let toSide: PortSide = 'left'

        // 如果命中节点且不在源节点列表中
        const sourceIds = drag.sources.map(s => s.nodeId)
        if (hitNode && !sourceIds.includes(hitNode.id)) {
          const portSide = hitTestPort(world, hitNode, getNodeSize(hitNode.type), 14 / vp.zoom)
          toSide = portSide || inferPortSide(world, hitNode, getNodeSize(hitNode.type))
          to = getPortWorldPos(hitNode, toSide, getNodeSize(hitNode.type))
        }

        dragRef.current = { ...drag, to, toSide }
        onConnectPreviewChange?.({
          kind: 'multi',
          sources: drag.sources,
          to,
          toSide
        })
        return
      }

      if (drag.kind === 'select-box') {
        dragRef.current = { ...drag, currentWorld: world }
        onSelectBoxChange?.({ start: drag.startWorld, current: world })
        return
      }
    },
    [setInteracting, onTransientViewportChange, onAlignGuideChange, onConnectPreviewChange, onSelectBoxChange]
  )

  const handlePointerUp = useCallback(
    (ev: React.PointerEvent) => {
      const target = ev.currentTarget as HTMLElement
      try {
        target.releasePointerCapture(ev.pointerId)
      } catch {
        // ignore
      }

      const drag = dragRef.current
      dragRef.current = null
      onAlignGuideChange?.(null)

      const store = useGraphStore.getState()
      const vp = transientViewportRef.current || store.viewport
      const local = getLocalPoint(ev.nativeEvent)
      const world = screenToWorld(local, vp)
      const nodesById = new Map(store.nodes.map((n) => [n.id, n]))

      // 提交画布平移
      if (transientViewportRef.current) {
        store.setViewport(transientViewportRef.current)
        transientViewportRef.current = null
        onTransientViewportChange?.(null)
      }

      // 处理连接完成
      if (drag?.kind === 'connect') {
        onConnectPreviewChange?.(null)
        const hitNode = hitTestNode(world, store.nodes, getNodeSize, vp.zoom)

        if (hitNode && hitNode.id !== drag.fromId) {
          const portSide = hitTestPort(world, hitNode, getNodeSize(hitNode.type), 14 / vp.zoom)
          const toSide: PortSide = portSide || inferPortSide(world, hitNode, getNodeSize(hitNode.type))

          if (drag.reconnect) {
            // 重连接边缘
            const edge = store.edges.find((e) => e.id === drag.reconnect!.edgeId)
            if (edge) {
              const next = drag.reconnect.moveEnd === 'source'
                ? { source: hitNode.id, target: drag.reconnect.fixedId }
                : { source: drag.reconnect.fixedId, target: hitNode.id }
              const nextData: Record<string, unknown> = { ...(edge.data || {}) }
              if (drag.reconnect.moveEnd === 'source') {
                nextData.sourcePort = toSide
                nextData.targetPort = drag.reconnect.fixedSide
              } else {
                nextData.sourcePort = drag.reconnect.fixedSide
                nextData.targetPort = toSide
              }

              // 检查是否重复
              const dupKey = `${next.source}|${next.target}|${nextData.sourcePort}|${nextData.targetPort}`
              const dup = store.edges.some((x) => {
                if (x.id === edge.id) return false
                const d: any = x.data || {}
                const k = `${x.source}|${x.target}|${d.sourcePort || 'right'}|${d.targetPort || 'left'}`
                return k === dupKey
              })
              if (!dup) {
                store.updateEdge(edge.id, { ...next, data: nextData })
              }
            }
          } else {
            // 新建边缘
            const data: Record<string, unknown> = {
              sourcePort: drag.fromSide,
              targetPort: toSide
            }

            // 处理 image → videoConfig 的 imageRole
            const srcNode = nodesById.get(drag.fromId)
            if (srcNode?.type === 'image' && hitNode.type === 'videoConfig') {
              const existingRoles = store.edges
                .filter((e) => e.target === hitNode.id && e.source !== drag.fromId)
                .map((e) => String((e.data as any)?.imageRole || '').trim())
              const hasFirst = existingRoles.includes('first_frame_image')
              const hasLast = existingRoles.includes('last_frame_image')
              data.imageRole = !hasFirst
                ? 'first_frame_image'
                : !hasLast
                  ? 'last_frame_image'
                  : 'input_reference'
            }

            store.addEdge(drag.fromId, hitNode.id, data)
          }
        }
      }

      // 处理多选连接完成
      if (drag?.kind === 'multi-connect') {
        onConnectPreviewChange?.(null)
        const hitNode = hitTestNode(world, store.nodes, getNodeSize, vp.zoom)
        const sourceIds = drag.sources.map(s => s.nodeId)

        // 如果命中节点且不在源节点列表中
        if (hitNode && !sourceIds.includes(hitNode.id)) {
          const targetId = hitNode.id
          const portSide = hitTestPort(world, hitNode, getNodeSize(hitNode.type), 14 / vp.zoom)
          const toSide: PortSide = portSide || inferPortSide(world, hitNode, getNodeSize(hitNode.type))

          // 收集已存在的连接 key
          const existingKeys = new Set(
            store.edges.map(e => {
              const d: any = e.data || {}
              return `${e.source}|${e.target}|${readPortSide(d.sourcePort, 'right')}|${readPortSide(d.targetPort, 'left')}`
            })
          )

          store.withBatchUpdates(() => {
            for (const src of drag.sources) {
              const key = `${src.nodeId}|${targetId}|${src.fromSide}|${toSide}`
              if (existingKeys.has(key)) continue

              const data: Record<string, unknown> = {
                sourcePort: src.fromSide,
                targetPort: toSide
              }

              // 处理 image → videoConfig 的 imageRole
              const srcNode = nodesById.get(src.nodeId)
              if (srcNode?.type === 'image' && hitNode.type === 'videoConfig') {
                const existingRoles = store.edges
                  .filter((e) => e.target === hitNode.id)
                  .map((e) => String((e.data as any)?.imageRole || '').trim())
                const hasFirst = existingRoles.includes('first_frame_image')
                const hasLast = existingRoles.includes('last_frame_image')
                data.imageRole = !hasFirst
                  ? 'first_frame_image'
                  : !hasLast
                    ? 'last_frame_image'
                    : 'input_reference'
              }

              store.addEdge(src.nodeId, targetId, data)
              existingKeys.add(key)
            }
          })

          store.setSelected(targetId)
          onPickNode?.(targetId)
        }
      }

      // 处理节点拖拽完成
      if (drag?.kind === 'node') {
        const dxw = world.x - drag.startWorld.x
        const dyw = world.y - drag.startWorld.y
        const allowSnap = !ev.altKey && toolRef.current === 'select'

        store.withBatchUpdates(() => {
          for (const id of drag.nodeIds) {
            const start = drag.startPos.get(id)
            if (!start) continue
            const raw = { x: start.x + dxw, y: start.y + dyw }
            const pos = allowSnap ? { x: snapToGrid(raw.x), y: snapToGrid(raw.y) } : raw
            store.updateNode(id, { x: pos.x, y: pos.y })
          }
        })
      }

      // 处理框选完成
      if (drag?.kind === 'select-box') {
        onSelectBoxChange?.(null)
        const x0 = Math.min(drag.startWorld.x, drag.currentWorld.x)
        const y0 = Math.min(drag.startWorld.y, drag.currentWorld.y)
        const x1 = Math.max(drag.startWorld.x, drag.currentWorld.x)
        const y1 = Math.max(drag.startWorld.y, drag.currentWorld.y)

        const picked: string[] = []
        for (const n of store.nodes) {
          const { w, h } = getNodeSize(n.type)
          const nx0 = n.x
          const ny0 = n.y
          const nx1 = n.x + w
          const ny1 = n.y + h
          const intersects = nx1 >= x0 && nx0 <= x1 && ny1 >= y0 && ny0 <= y1
          if (intersects) picked.push(n.id)
        }

        if (drag.additive) {
          const current = store.selectedNodeIds
          store.setSelection([...current, ...picked], store.selectedNodeId)
        } else {
          store.setSelection(picked, picked[0] || null)
        }
      }

      setInteracting(false)
    },
    [
      setInteracting,
      onTransientViewportChange,
      onConnectPreviewChange,
      onAlignGuideChange,
      onSelectBoxChange
    ]
  )

  const handleWheel = useCallback(
    (ev: React.WheelEvent) => {
      ev.preventDefault()
      setInteracting(true)

      const store = useGraphStore.getState()
      const baseVp = transientViewportRef.current || store.viewport
      const local = getLocalPoint(ev.nativeEvent)

      if (ev.ctrlKey || ev.metaKey) {
        // 缩放
        const dir = ev.deltaY > 0 ? -1 : 1
        const factor = dir > 0 ? 1.08 : 1 / 1.08
        const nextZoom = clampZoom((baseVp.zoom || 1) * factor)
        const before = screenToWorld(local, baseVp)
        const nextVp = { ...baseVp, zoom: nextZoom }
        const after = screenToWorld(local, nextVp)
        const nx = baseVp.x + (after.x - before.x) * nextZoom
        const ny = baseVp.y + (after.y - before.y) * nextZoom
        transientViewportRef.current = { x: nx, y: ny, zoom: nextZoom }
      } else {
        // 平移
        const nx = baseVp.x - (Number(ev.deltaX) || 0)
        const ny = baseVp.y - (Number(ev.deltaY) || 0)
        transientViewportRef.current = { x: nx, y: ny, zoom: baseVp.zoom }
      }

      onTransientViewportChange?.(transientViewportRef.current)

      // 延迟提交视口更改
      if (wheelTimerRef.current) window.clearTimeout(wheelTimerRef.current)
      wheelTimerRef.current = window.setTimeout(() => {
        wheelTimerRef.current = 0
        if (transientViewportRef.current) {
          store.setViewport(transientViewportRef.current)
          transientViewportRef.current = null
          onTransientViewportChange?.(null)
        }
        setInteracting(false)
      }, 120)
    },
    [setInteracting, onTransientViewportChange]
  )

  const handleContextMenu = useCallback(
    (ev: React.MouseEvent) => {
      if (!onContextMenu) return
      ev.preventDefault()

      const store = useGraphStore.getState()
      const vp = transientViewportRef.current || store.viewport
      const rect = (ev.currentTarget as HTMLElement).getBoundingClientRect()
      const local = { x: ev.clientX - rect.left, y: ev.clientY - rect.top }
      const world = screenToWorld(local, vp)
      const nodesById = new Map(store.nodes.map((n) => [n.id, n]))

      const hitNode = hitTestNode(world, store.nodes, getNodeSize, vp.zoom)
      if (hitNode) {
        onContextMenu({ kind: 'node', id: hitNode.id, clientX: ev.clientX, clientY: ev.clientY })
        return
      }

      const edgeId = hitTestEdge(world, store.edges, nodesById, getNodeSize, 10 / vp.zoom)
      if (edgeId) {
        onContextMenu({ kind: 'edge', id: edgeId, clientX: ev.clientX, clientY: ev.clientY })
        return
      }

      onContextMenu({ kind: 'canvas', clientX: ev.clientX, clientY: ev.clientY, world })
    },
    [onContextMenu]
  )

  // 清理定时器
  useEffect(() => {
    return () => {
      if (wheelTimerRef.current) window.clearTimeout(wheelTimerRef.current)
      if (interactingTimerRef.current) window.clearTimeout(interactingTimerRef.current)
    }
  }, [])

  return (
    <div
      ref={rootRef}
      className="absolute inset-0 touch-none"
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
      onWheel={handleWheel}
      onContextMenu={handleContextMenu}
      style={{
        cursor:
          tool === 'pan'
            ? 'grab'
            : tool === 'add'
              ? 'crosshair'
              : tool === 'connect' || connectMode
                ? 'cell'
                : 'default'
      }}
    >
      {children}
    </div>
  )
}
