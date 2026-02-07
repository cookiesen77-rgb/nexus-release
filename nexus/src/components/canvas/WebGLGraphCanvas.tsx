import React, { useEffect, useMemo, useRef, useState } from 'react'
import { useGraphStore } from '@/graph/store'
import type { GraphEdge, GraphNode, NodeType, Viewport } from '@/graph/types'
import { getNodeAccent, getNodeSize } from '@/graph/nodeSizing'

type CanvasTool = 'select' | 'pan' | 'add' | 'connect'

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

type SelectBox = {
  start: Vec2
  current: Vec2
}

type AlignGuide = {
  x?: number
  y?: number
}

type Props = {
  className?: string
  tool?: CanvasTool
  connectMode?: boolean
  onPickNode?: (id: string | null) => void
  onInteractingChange?: (val: boolean) => void
  onTransientViewportChange?: (vp: Viewport | null) => void
  onRequestAddNode?: (pos: { x: number; y: number }) => void
  onContextMenu?: (payload: { kind: 'node'; id: string; clientX: number; clientY: number } | { kind: 'edge'; id: string; clientX: number; clientY: number } | { kind: 'canvas'; clientX: number; clientY: number; world: { x: number; y: number } }) => void
  // 新增：外部事件协调器提供的状态（启用新事件系统时使用）
  useExternalEvents?: boolean
  externalConnectPreview?: ConnectPreview | null
  externalSelectBox?: SelectBox | null
  externalAlignGuide?: AlignGuide | null
  externalIsInteracting?: boolean
  externalViewport?: Viewport | null
}

type Vec2 = { x: number; y: number }
type PortSide = 'left' | 'right'

const clampZoom = (z: number) => Math.max(0.1, Math.min(2, z))
const GRID = 20
const snapToGrid = (v: number) => Math.round(v / GRID) * GRID

const toWorld = (p: Vec2, vp: Viewport): Vec2 => ({
  x: (p.x - vp.x) / vp.zoom,
  y: (p.y - vp.y) / vp.zoom
})

const readPortSide = (raw: unknown, fallback: PortSide): PortSide => {
  if (raw === 'left' || raw === 'right') return raw
  return fallback
}

const portWorldPos = (node: GraphNode, side: PortSide): Vec2 => {
  const { w, h } = getNodeSize(node.type)
  return { x: node.x + (side === 'right' ? w : 0), y: node.y + h * 0.5 }
}

const cubicPoint = (p0: Vec2, p1: Vec2, p2: Vec2, p3: Vec2, t: number): Vec2 => {
  const u = 1 - t
  const tt = t * t
  const uu = u * u
  const uuu = uu * u
  const ttt = tt * t
  return {
    x: uuu * p0.x + 3 * uu * t * p1.x + 3 * u * tt * p2.x + ttt * p3.x,
    y: uuu * p0.y + 3 * uu * t * p1.y + 3 * u * tt * p2.y + ttt * p3.y
  }
}

const bezierControls = (from: Vec2, to: Vec2, fromSide: PortSide, toSide: PortSide) => {
  const dx = to.x - from.x
  const handle = Math.max(60, Math.min(320, Math.abs(dx) * 0.45))
  const c1 = { x: from.x + (fromSide === 'right' ? handle : -handle), y: from.y }
  const c2 = { x: to.x + (toSide === 'right' ? handle : -handle), y: to.y }
  return { c1, c2 }
}

const writeBezierSegments = (
  out: Float32Array,
  segmentStart: number,
  segmentCount: number,
  p0: Vec2,
  p1: Vec2,
  p2: Vec2,
  p3: Vec2
) => {
  for (let i = 0; i < segmentCount; i++) {
    const t0 = i / segmentCount
    const t1 = (i + 1) / segmentCount
    const a = cubicPoint(p0, p1, p2, p3, t0)
    const b = cubicPoint(p0, p1, p2, p3, t1)
    const o = (segmentStart + i) * 4
    out[o + 0] = a.x
    out[o + 1] = a.y
    out[o + 2] = b.x
    out[o + 3] = b.y
  }
}

const getLocalPoint = (ev: PointerEvent | WheelEvent): Vec2 => {
  const x = Number((ev as any).offsetX)
  const y = Number((ev as any).offsetY)
  if (Number.isFinite(x) && Number.isFinite(y)) return { x, y }
  const cx = Number((ev as any).clientX) || 0
  const cy = Number((ev as any).clientY) || 0
  return { x: cx, y: cy }
}

const compileShader = (gl: WebGL2RenderingContext, type: number, src: string) => {
  const sh = gl.createShader(type)
  if (!sh) throw new Error('createShader failed')
  gl.shaderSource(sh, src)
  gl.compileShader(sh)
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
    const msg = gl.getShaderInfoLog(sh) || 'shader compile failed'
    gl.deleteShader(sh)
    throw new Error(msg)
  }
  return sh
}

const createProgram = (gl: WebGL2RenderingContext, vsSrc: string, fsSrc: string) => {
  const vs = compileShader(gl, gl.VERTEX_SHADER, vsSrc)
  const fs = compileShader(gl, gl.FRAGMENT_SHADER, fsSrc)
  const prog = gl.createProgram()
  if (!prog) throw new Error('createProgram failed')
  gl.attachShader(prog, vs)
  gl.attachShader(prog, fs)
  gl.linkProgram(prog)
  gl.deleteShader(vs)
  gl.deleteShader(fs)
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
    const msg = gl.getProgramInfoLog(prog) || 'program link failed'
    gl.deleteProgram(prog)
    throw new Error(msg)
  }
  return prog
}

export default function WebGLGraphCanvas({
  className,
  tool = 'select',
  connectMode,
  onPickNode,
  onInteractingChange,
  onTransientViewportChange,
  onRequestAddNode,
  onContextMenu,
  // 新增：外部事件系统支持
  useExternalEvents = false,
  externalConnectPreview,
  externalSelectBox,
  externalAlignGuide,
  externalIsInteracting,
  externalViewport
}: Props) {
  const rootRef = useRef<HTMLDivElement | null>(null)
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const labelCanvasRef = useRef<HTMLCanvasElement | null>(null)
  const labelCtxRef = useRef<CanvasRenderingContext2D | null>(null)
  const isInteractingRef = useRef(false)

  const connectModeRef = useRef(false)
  const connectFromRef = useRef<string | null>(null)
  const connectFromSideRef = useRef<PortSide>('right')
  const connectPreviewRef = useRef<null | { fromId: string; fromSide: PortSide; toSide: PortSide; from: Vec2; to: Vec2 }>(null)
  const reconnectRef = useRef<
    | null
    | {
        edgeId: string
        moveEnd: 'source' | 'target'
        fixedId: string
        fixedSide: PortSide
        movingId: string
        movingSide: PortSide
      }
  >(null)
  const toolRef = useRef<CanvasTool>(tool)

  const nodesRef = useRef<GraphNode[]>(useGraphStore.getState().nodes)
  const edgesRef = useRef<GraphEdge[]>(useGraphStore.getState().edges)
  const viewportRef = useRef<Viewport>(useGraphStore.getState().viewport)
  const selectedNodeIdRef = useRef<string | null>(useGraphStore.getState().selectedNodeId)
  const selectedNodeIdsRef = useRef<string[]>(useGraphStore.getState().selectedNodeIds)
  const selectedEdgeIdRef = useRef<string | null>(useGraphStore.getState().selectedEdgeId)

  const [fps, setFps] = useState(0)
  const fpsRef = useRef({ frames: 0, last: performance.now() })

  const baseDpr = useMemo(() => Math.max(1, Math.min(2, window.devicePixelRatio || 1)), [])
  const dprRef = useRef(baseDpr)
  const applyDprRef = useRef<(next: number) => void>(() => {})
  const sizeRef = useRef({ w: 1, h: 1 })

  const glRef = useRef<WebGL2RenderingContext | null>(null)
  const programsRef = useRef<any>(null)
  const rafRef = useRef<number>(0)

  const nodeStrideFloatsRef = useRef(10)
  const nodeCapacityRef = useRef(0)
  const nodeCountRef = useRef(0)
  const nodeDataRef = useRef<Float32Array>(new Float32Array(0))
  const nodeIdToIndexRef = useRef<Map<string, number>>(new Map())
  const scratch2Ref = useRef<Float32Array>(new Float32Array(2))

  const EDGE_SEGMENTS = 18
  const edgeSegCapacityRef = useRef(0)
  const edgeSegCountRef = useRef(0)
  const edgeVertsRef = useRef<Float32Array>(new Float32Array(0)) // [x1,y1,x2,y2] per segment
  const edgesByNodeRef = useRef<
    Map<string, { segmentStart: number; segmentCount: number; isSource: boolean; side: PortSide; otherId: string; otherSide: PortSide }[]>
  >(new Map())

  const transientViewportRef = useRef<Viewport | null>(null)
  const draggingRef = useRef<null | { ids: string[]; start: Vec2; startPos: Map<string, Vec2>; lastLocal: Vec2 }>(null)
  const selectingRef = useRef<null | { start: Vec2; current: Vec2; additive: boolean }>(null)
  const alignGuideRef = useRef<null | { x?: number; y?: number }>(null)
  const interactingTimerRef = useRef<number>(0)
  const wheelCommitTimerRef = useRef<number>(0)

  useEffect(() => {
    connectModeRef.current = !!connectMode
    if (!connectMode) {
      connectFromRef.current = null
      connectPreviewRef.current = null
    }
  }, [connectMode])

  useEffect(() => {
    toolRef.current = tool
  }, [tool])

  // 外部状态变化时触发重渲染（当使用外部事件系统时）
  const requestFrameRef = useRef<() => void>(() => {})
  useEffect(() => {
    if (useExternalEvents) {
      requestFrameRef.current()
    }
  }, [useExternalEvents, externalConnectPreview, externalSelectBox, externalAlignGuide, externalIsInteracting, externalViewport])

  const ensureNodeCapacity = (need: number) => {
    const gl = glRef.current
    const p = programsRef.current
    if (!gl || !p) return
    if (need <= nodeCapacityRef.current) return

    nodeCapacityRef.current = Math.max(need, Math.floor(nodeCapacityRef.current * 1.5) + 256)
    const stride = nodeStrideFloatsRef.current
    nodeDataRef.current = new Float32Array(nodeCapacityRef.current * stride)
    gl.bindBuffer(gl.ARRAY_BUFFER, p.nodeInstanceBuffer)
    gl.bufferData(gl.ARRAY_BUFFER, nodeDataRef.current.byteLength, gl.DYNAMIC_DRAW)
  }

  const ensureEdgeSegmentCapacity = (needSegments: number) => {
    const gl = glRef.current
    const p = programsRef.current
    if (!gl || !p) return
    if (needSegments <= edgeSegCapacityRef.current) return

    edgeSegCapacityRef.current = Math.max(needSegments, Math.floor(edgeSegCapacityRef.current * 1.5) + 1024)
    edgeVertsRef.current = new Float32Array(edgeSegCapacityRef.current * 4)
    gl.bindBuffer(gl.ARRAY_BUFFER, p.edgeBuffer)
    gl.bufferData(gl.ARRAY_BUFFER, edgeVertsRef.current.byteLength, gl.DYNAMIC_DRAW)
  }

  const syncNodesToGpu = () => {
    const gl = glRef.current
    const p = programsRef.current
    if (!gl || !p) return

    const list = nodesRef.current
    const count = list.length
    nodeCountRef.current = count
    ensureNodeCapacity(count)

    const stride = nodeStrideFloatsRef.current
    const data = nodeDataRef.current
    const idToIndex = new Map<string, number>()
    const selectedSet = new Set(selectedNodeIdsRef.current)

    for (let i = 0; i < count; i++) {
      const n = list[i]
      const { w, h } = getNodeSize(n.type)
      const a = getNodeAccent(n.type as NodeType)
      const selected = selectedSet.has(n.id) ? 1 : 0
      const base = i * stride

      data[base + 0] = n.x
      data[base + 1] = n.y
      data[base + 2] = w
      data[base + 3] = h
      data[base + 4] = a[0]
      data[base + 5] = a[1]
      data[base + 6] = a[2]
      data[base + 7] = a[3]
      data[base + 8] = selected
      data[base + 9] = 0

      idToIndex.set(n.id, i)
    }

    nodeIdToIndexRef.current = idToIndex
    gl.bindBuffer(gl.ARRAY_BUFFER, p.nodeInstanceBuffer)
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, data.subarray(0, count * stride))
  }

  const syncEdgesToGpu = () => {
    const gl = glRef.current
    const p = programsRef.current
    if (!gl || !p) return

    const elist = edgesRef.current
    const nmap = nodeIdToIndexRef.current
    const ndata = nodeDataRef.current
    const stride = nodeStrideFloatsRef.current

    ensureEdgeSegmentCapacity(elist.length * EDGE_SEGMENTS)
    const verts = edgeVertsRef.current
    const byNode = new Map<
      string,
      { segmentStart: number; segmentCount: number; isSource: boolean; side: PortSide; otherId: string; otherSide: PortSide }[]
    >()

    let segCursor = 0
    for (let i = 0; i < elist.length; i++) {
      const e = elist[i]
      const si = nmap.get(e.source)
      const ti = nmap.get(e.target)
      if (si === undefined || ti === undefined) continue

      const d: any = (e as any).data || {}
      const sourceSide = readPortSide(d.sourcePort || d.sourceHandle, 'right')
      const targetSide = readPortSide(d.targetPort || d.targetHandle, 'left')

      const sb = si * stride
      const tb = ti * stride
      const sx = ndata[sb + 0] + (sourceSide === 'right' ? ndata[sb + 2] : 0)
      const sy = ndata[sb + 1] + ndata[sb + 3] * 0.5
      const tx = ndata[tb + 0] + (targetSide === 'right' ? ndata[tb + 2] : 0)
      const ty = ndata[tb + 1] + ndata[tb + 3] * 0.5

      const segStart = segCursor
      const segCount = EDGE_SEGMENTS
      const p0 = { x: sx, y: sy }
      const p3 = { x: tx, y: ty }
      const { c1, c2 } = bezierControls(p0, p3, sourceSide, targetSide)
      writeBezierSegments(verts, segStart, segCount, p0, c1, c2, p3)
      segCursor += segCount

      const sList = byNode.get(e.source) || []
      sList.push({
        segmentStart: segStart,
        segmentCount: segCount,
        isSource: true,
        side: sourceSide,
        otherId: e.target,
        otherSide: targetSide
      })
      byNode.set(e.source, sList)
      const tList = byNode.get(e.target) || []
      tList.push({
        segmentStart: segStart,
        segmentCount: segCount,
        isSource: false,
        side: targetSide,
        otherId: e.source,
        otherSide: sourceSide
      })
      byNode.set(e.target, tList)
    }

    edgesByNodeRef.current = byNode
    edgeSegCountRef.current = segCursor
    gl.bindBuffer(gl.ARRAY_BUFFER, p.edgeBuffer)
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, verts.subarray(0, segCursor * 4))
  }

  const updateDraggedNodeGpu = (id: string, pos: Vec2) => {
    const gl = glRef.current
    const p = programsRef.current
    if (!gl || !p) return

    const idx = nodeIdToIndexRef.current.get(id)
    if (idx === undefined) return
    const stride = nodeStrideFloatsRef.current
    const base = idx * stride

    nodeDataRef.current[base + 0] = pos.x
    nodeDataRef.current[base + 1] = pos.y
    gl.bindBuffer(gl.ARRAY_BUFFER, p.nodeInstanceBuffer)
    scratch2Ref.current[0] = pos.x
    scratch2Ref.current[1] = pos.y
    gl.bufferSubData(gl.ARRAY_BUFFER, base * 4, scratch2Ref.current)

    const refs = edgesByNodeRef.current.get(id)
    if (!refs || refs.length === 0) return

    const verts = edgeVertsRef.current
    const w = nodeDataRef.current[base + 2]
    const h = nodeDataRef.current[base + 3]
    gl.bindBuffer(gl.ARRAY_BUFFER, p.edgeBuffer)
    for (const r of refs) {
      const otherIdx = nodeIdToIndexRef.current.get(r.otherId)
      if (otherIdx === undefined) continue
      const otherBase = otherIdx * nodeStrideFloatsRef.current
      const otherW = nodeDataRef.current[otherBase + 2]
      const otherH = nodeDataRef.current[otherBase + 3]

      const a: Vec2 = {
        x: pos.x + (r.side === 'right' ? w : 0),
        y: pos.y + h * 0.5
      }
      const b: Vec2 = {
        x: nodeDataRef.current[otherBase + 0] + (r.otherSide === 'right' ? otherW : 0),
        y: nodeDataRef.current[otherBase + 1] + otherH * 0.5
      }

      const from = r.isSource ? a : b
      const to = r.isSource ? b : a
      const fromSide = r.isSource ? r.side : r.otherSide
      const toSide = r.isSource ? r.otherSide : r.side
      const { c1, c2 } = bezierControls(from, to, fromSide, toSide)

      writeBezierSegments(verts, r.segmentStart, r.segmentCount, from, c1, c2, to)
      gl.bufferSubData(gl.ARRAY_BUFFER, r.segmentStart * 16, verts.subarray(r.segmentStart * 4, (r.segmentStart + r.segmentCount) * 4))
    }
  }

  const pickNodeAt = (world: Vec2, vp: Viewport) => {
    const list = nodesRef.current
    const zoom = vp.zoom || 1
    const isFar = zoom < 0.55
    const ndata = nodeDataRef.current
    const stride = nodeStrideFloatsRef.current

    if (isFar) {
      const r = 8 / zoom
      for (let i = list.length - 1; i >= 0; i--) {
        const base = i * stride
        const dx = world.x - ndata[base + 0]
        const dy = world.y - ndata[base + 1]
        if (dx * dx + dy * dy <= r * r) return list[i]
      }
      return null
    }

    for (let i = list.length - 1; i >= 0; i--) {
      const base = i * stride
      const x = ndata[base + 0]
      const y = ndata[base + 1]
      const w = ndata[base + 2]
      const h = ndata[base + 3]
      if (world.x >= x && world.x <= x + w && world.y >= y && world.y <= y + h) return list[i]
    }
    return null
  }

  const pickEdgeAt = (world: Vec2, vp: Viewport) => {
    const threshold = 10 / Math.max(0.001, vp.zoom || 1)
    const threshold2 = threshold * threshold

    const nodesById = new Map(nodesRef.current.map((n) => [n.id, n]))
    let best: { id: string; dist2: number } | null = null
    const edges = edgesRef.current
    for (let i = 0; i < edges.length; i++) {
      const e = edges[i]
      const s = nodesById.get(e.source)
      const t = nodesById.get(e.target)
      if (!s || !t) continue
      const d: any = (e as any).data || {}
      const sourceSide = readPortSide(d.sourcePort || d.sourceHandle, 'right')
      const targetSide = readPortSide(d.targetPort || d.targetHandle, 'left')
      const p0 = portWorldPos(s, sourceSide)
      const p3 = portWorldPos(t, targetSide)
      const { c1, c2 } = bezierControls(p0, p3, sourceSide, targetSide)

      const steps = 14
      let prev = p0
      for (let k = 1; k <= steps; k++) {
        const p = cubicPoint(p0, c1, c2, p3, k / steps)
        const vx = p.x - prev.x
        const vy = p.y - prev.y
        const wx = world.x - prev.x
        const wy = world.y - prev.y
        const vv = vx * vx + vy * vy
        const tproj = vv > 0 ? Math.max(0, Math.min(1, (wx * vx + wy * vy) / vv)) : 0
        const cx = prev.x + vx * tproj
        const cy = prev.y + vy * tproj
        const dx = world.x - cx
        const dy = world.y - cy
        const dist2 = dx * dx + dy * dy
        if (dist2 <= threshold2 && (!best || dist2 < best.dist2)) best = { id: e.id, dist2 }
        prev = p
      }
    }
    return best?.id || null
  }

  const pickEdgeEndpointAt = (world: Vec2, vp: Viewport) => {
    const zoom = vp.zoom || 1
    const threshold = 12 / Math.max(0.001, zoom)
    const threshold2 = threshold * threshold

    const nodesById = new Map(nodesRef.current.map((n) => [n.id, n]))
    let best: { id: string; end: 'source' | 'target'; dist2: number; side: PortSide } | null = null
    for (const e of edgesRef.current) {
      const s = nodesById.get(e.source)
      const t = nodesById.get(e.target)
      if (!s || !t) continue
      const d: any = (e as any).data || {}
      const sourceSide = readPortSide(d.sourcePort || d.sourceHandle, 'right')
      const targetSide = readPortSide(d.targetPort || d.targetHandle, 'left')
      const sp = portWorldPos(s, sourceSide)
      const tp = portWorldPos(t, targetSide)
      const dsx = world.x - sp.x
      const dsy = world.y - sp.y
      const dtX = world.x - tp.x
      const dtY = world.y - tp.y
      const sd2 = dsx * dsx + dsy * dsy
      const td2 = dtX * dtX + dtY * dtY
      if (sd2 <= threshold2 && (!best || sd2 < best.dist2)) best = { id: e.id, end: 'source', dist2: sd2, side: sourceSide }
      if (td2 <= threshold2 && (!best || td2 < best.dist2)) best = { id: e.id, end: 'target', dist2: td2, side: targetSide }
    }
    return best
  }

  const pickPortSideAt = (node: GraphNode, idx: number, world: Vec2, zoom: number): PortSide | null => {
    const stride = nodeStrideFloatsRef.current
    const base = idx * stride
    const x = nodeDataRef.current[base + 0]
    const y = nodeDataRef.current[base + 1]
    const w = nodeDataRef.current[base + 2]
    const h = nodeDataRef.current[base + 3]

    const rPx = 14
    const r = rPx / Math.max(0.001, zoom)
    const r2 = r * r

    const ly = y + h * 0.5
    const lx = x
    const ry = ly
    const rx = x + w

    const dlx = world.x - lx
    const dly = world.y - ly
    if (dlx * dlx + dly * dly <= r2) return 'left'
    const drx = world.x - rx
    const dry = world.y - ry
    if (drx * drx + dry * dry <= r2) return 'right'
    return null
  }

  const fallbackPortSideAt = (idx: number, world: Vec2): PortSide => {
    const stride = nodeStrideFloatsRef.current
    const base = idx * stride
    const x = nodeDataRef.current[base + 0]
    const w = nodeDataRef.current[base + 2]
    return world.x < x + w * 0.5 ? 'left' : 'right'
  }

  const render = () => {
    const canvas = canvasRef.current
    const gl = glRef.current
    const p = programsRef.current
    const root = rootRef.current
    if (!canvas || !gl || !p || !root) return

    // fps
    fpsRef.current.frames += 1
    const now = performance.now()
    if (now - fpsRef.current.last >= 500) {
      setFps(Math.round((fpsRef.current.frames * 1000) / (now - fpsRef.current.last)))
      fpsRef.current.frames = 0
      fpsRef.current.last = now
    }

    const baseVp = viewportRef.current
    // 支持外部视口覆盖
    const vp = useExternalEvents && externalViewport ? externalViewport : (transientViewportRef.current || baseVp)
    const zoom = vp.zoom || 1
    // 支持外部交互状态
    const interacting = useExternalEvents ? (externalIsInteracting ?? false) : isInteractingRef.current
    const lod = Math.min(zoom < 0.35 ? 0 : zoom < 0.75 ? 1 : 2, interacting ? 1 : 2)
    const dotWorld = 6 / Math.max(0.001, zoom)

    const size = sizeRef.current
    gl.viewport(0, 0, canvas.width, canvas.height)
    gl.clear(gl.COLOR_BUFFER_BIT)

    // Background grid（交互时略过：减少每帧全屏像素着色开销）
    if (!interacting) {
      gl.useProgram(p.bgProgram)
      gl.bindVertexArray(p.bgVAO)
      gl.uniform2f(p.bgLocs.u_resolution, size.w, size.h)
      gl.uniform2f(p.bgLocs.u_translate, vp.x, vp.y)
      gl.uniform1f(p.bgLocs.u_zoom, zoom)
      gl.drawArrays(gl.TRIANGLES, 0, 6)
      gl.bindVertexArray(null)
    }

    // Edges (skip only in far LOD)
    if (lod >= 1 && edgeSegCountRef.current > 0) {
      gl.useProgram(p.edgeProgram)
      gl.bindVertexArray(p.edgeVAO)
      gl.uniform2f(p.edgeLocs.u_resolution, size.w, size.h)
      gl.uniform2f(p.edgeLocs.u_translate, vp.x, vp.y)
      gl.uniform1f(p.edgeLocs.u_zoom, zoom)
      gl.uniform4f(p.edgeLocs.u_color, 0.898, 0.898, 0.918, interacting ? 0.4 : 0.75)
      gl.drawArrays(gl.LINES, 0, edgeSegCountRef.current * 2)
      gl.bindVertexArray(null)
    }

    // Nodes
    if (nodeCountRef.current > 0) {
      gl.useProgram(p.nodeProgram)
      gl.bindVertexArray(p.nodeVAO)
      gl.uniform2f(p.nodeLocs.u_resolution, size.w, size.h)
      gl.uniform2f(p.nodeLocs.u_translate, vp.x, vp.y)
      gl.uniform1f(p.nodeLocs.u_zoom, zoom)
      gl.uniform1f(p.nodeLocs.u_lod, lod)
      gl.uniform1f(p.nodeLocs.u_dotWorld, dotWorld)
      gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, nodeCountRef.current)
      gl.bindVertexArray(null)
    }

    // 2D 文本层：补齐 GPU 画布的“信息密度”，并保持远景 LOD
    const labelCanvas = labelCanvasRef.current
    if (labelCanvas) {
      let ctx = labelCtxRef.current
      if (!ctx) {
        ctx = labelCanvas.getContext('2d', { alpha: true })
        labelCtxRef.current = ctx
      }

      if (ctx) {
        ctx.setTransform(1, 0, 0, 1, 0, 0)
        ctx.clearRect(0, 0, labelCanvas.width, labelCanvas.height)
        const showConnectPreview = connectModeRef.current && !!connectPreviewRef.current
        if (interacting && !showConnectPreview) return

        const dpr = dprRef.current
        const showMany = zoom >= 0.65
        const selectedId = selectedNodeIdRef.current

        const drawLabel = (node: GraphNode, idx: number) => {
          const stride = nodeStrideFloatsRef.current
          const base = idx * stride
          const ndata = nodeDataRef.current
          const x = ndata[base + 0] * zoom + vp.x
          const y = ndata[base + 1] * zoom + vp.y
          const w = ndata[base + 2] * zoom
          const h = ndata[base + 3] * zoom

          if (x + w < -60 || y + h < -60 || x > size.w + 60 || y > size.h + 60) return false

          const d: any = node.data || {}
          const label = String(d.label || d.title || node.type || '').trim()
          if (!label) return false

          const pad = Math.max(8, Math.min(14, 10 * zoom))
          const fontPx = Math.max(11, Math.min(16, 12 * zoom))
          ctx.font = `${fontPx}px system-ui, -apple-system, Segoe UI, Roboto, sans-serif`
          ctx.fillStyle = 'rgba(29,29,31,0.92)'
          ctx.shadowColor = 'rgba(255,255,255,0.0)'
          ctx.shadowBlur = 0
          ctx.shadowOffsetX = 0
          ctx.shadowOffsetY = 0
          ctx.textBaseline = 'top'
          const maxTitleChars = Math.max(6, Math.floor((w - pad * 2) / (fontPx * 0.62)))
          const title = label.length > maxTitleChars ? `${label.slice(0, Math.max(1, maxTitleChars - 1))}…` : label
          ctx.fillText(title, x + pad, y + pad)

          let sub = ''
          if (node.type === 'text') sub = String(d.content || '').trim()
          else if (node.type === 'imageConfig') sub = `模型: ${String(d.model || '').trim()}`
          else if (node.type === 'videoConfig') {
            const dur = String(d.duration || d.dur || '').trim()
            const ratio = String(d.ratio || '').trim()
            sub = `模型: ${String(d.model || '').trim()}${dur ? ` · ${dur}s` : ''}${ratio ? ` · ${ratio}` : ''}`
          } else if (node.type === 'image') sub = String(d.url || '').trim() ? '已生成图片' : '未生成图片'
          else if (node.type === 'video') sub = String(d.url || '').trim() ? '已生成视频' : '未生成视频'

          sub = sub.replace(/\s+/g, ' ').trim()
          if (sub) {
            const subFont = Math.max(9, Math.min(13, 10 * zoom))
            const maxSubChars = Math.max(8, Math.floor((w - pad * 2) / (subFont * 0.6)))
            const subLine = sub.length > maxSubChars ? `${sub.slice(0, Math.max(1, maxSubChars - 1))}…` : sub
            ctx.font = `${subFont}px system-ui, -apple-system, Segoe UI, Roboto, sans-serif`
            ctx.fillStyle = 'rgba(110,110,115,0.82)'
            ctx.fillText(subLine, x + pad, y + pad + fontPx + Math.max(6, 6 * zoom))
          }
          return true
        }

        ctx.setTransform(dpr, 0, 0, dpr, 0, 0)

        const selectedEdgeId = selectedEdgeIdRef.current
        if (!interacting && selectedEdgeId) {
          const e = edgesRef.current.find((x) => x.id === selectedEdgeId)
          if (e) {
            const byId = new Map(nodesRef.current.map((n) => [n.id, n]))
            const s = byId.get(e.source)
            const t = byId.get(e.target)
            if (s && t) {
              const d: any = (e as any).data || {}
              const sourceSide = readPortSide(d.sourcePort || d.sourceHandle, 'right')
              const targetSide = readPortSide(d.targetPort || d.targetHandle, 'left')
              const p0 = portWorldPos(s, sourceSide)
              const p3 = portWorldPos(t, targetSide)
              const { c1, c2 } = bezierControls(p0, p3, sourceSide, targetSide)

              ctx.save()
              ctx.strokeStyle = 'rgba(59,130,246,0.75)'
              ctx.lineWidth = Math.max(2, 2.5 * zoom)
              ctx.beginPath()
              ctx.moveTo(p0.x * zoom + vp.x, p0.y * zoom + vp.y)
              ctx.bezierCurveTo(c1.x * zoom + vp.x, c1.y * zoom + vp.y, c2.x * zoom + vp.x, c2.y * zoom + vp.y, p3.x * zoom + vp.x, p3.y * zoom + vp.y)
              ctx.stroke()
              ctx.restore()
            }
          }
        }

        if (!interacting) {
          if (!showMany) {
            if (selectedId) {
              const idx = nodeIdToIndexRef.current.get(selectedId)
              if (idx !== undefined) {
                const node = nodesRef.current[idx]
                if (node) drawLabel(node, idx)
              }
            }
          } else {
            const list = nodesRef.current
            const maxLabels = zoom >= 0.85 ? 220 : 120
            let drawn = 0
            for (let i = list.length - 1; i >= 0; i--) {
              if (drawLabel(list[i], i)) drawn++
              if (drawn >= maxLabels) break
            }
          }
        }

        // Selected edge highlight (label canvas)
        if (!interacting && selectedEdgeIdRef.current) {
          const edge = edgesRef.current.find((e) => e.id === selectedEdgeIdRef.current)
          if (edge) {
            const byId = new Map(nodesRef.current.map((n) => [n.id, n]))
            const s = byId.get(edge.source)
            const t = byId.get(edge.target)
            if (s && t) {
              const d: any = (edge as any).data || {}
              const sourceSide = readPortSide(d.sourcePort || d.sourceHandle, 'right')
              const targetSide = readPortSide(d.targetPort || d.targetHandle, 'left')
              const p0 = portWorldPos(s, sourceSide)
              const p3 = portWorldPos(t, targetSide)
              const { c1, c2 } = bezierControls(p0, p3, sourceSide, targetSide)

              ctx.save()
              ctx.lineWidth = Math.max(2, 2.5 * zoom)
              ctx.strokeStyle = 'rgba(59,130,246,0.75)'
              ctx.beginPath()
              ctx.moveTo(p0.x * zoom + vp.x, p0.y * zoom + vp.y)
              ctx.bezierCurveTo(c1.x * zoom + vp.x, c1.y * zoom + vp.y, c2.x * zoom + vp.x, c2.y * zoom + vp.y, p3.x * zoom + vp.x, p3.y * zoom + vp.y)
              ctx.stroke()
              ctx.restore()
            }
          }
        }

        // Connect preview (drawn on label canvas for simplicity/perf)
        // 支持外部连接预览状态
        const connectPreview = useExternalEvents ? externalConnectPreview : (showConnectPreview ? connectPreviewRef.current : null)
        if (connectPreview) {
          ctx.save()
          ctx.lineWidth = 2
          ctx.strokeStyle = 'rgba(0,122,255,0.55)'

          if ('kind' in connectPreview && connectPreview.kind === 'multi') {
            // 多源预览：绘制多条贝塞尔曲线
            const to = connectPreview.to
            for (const src of connectPreview.sources) {
              const { c1, c2 } = bezierControls(src.from, to, src.fromSide, connectPreview.toSide)
              const p0 = { x: src.from.x * zoom + vp.x, y: src.from.y * zoom + vp.y }
              const p1 = { x: c1.x * zoom + vp.x, y: c1.y * zoom + vp.y }
              const p2 = { x: c2.x * zoom + vp.x, y: c2.y * zoom + vp.y }
              const p3 = { x: to.x * zoom + vp.x, y: to.y * zoom + vp.y }

              ctx.beginPath()
              ctx.moveTo(p0.x, p0.y)
              ctx.bezierCurveTo(p1.x, p1.y, p2.x, p2.y, p3.x, p3.y)
              ctx.stroke()
            }
          } else {
            // 单源预览
            const prev = connectPreview
            const from = prev.from
            const to = prev.to
            const { c1, c2 } = bezierControls(from, to, prev.fromSide, prev.toSide)

            const p0 = { x: from.x * zoom + vp.x, y: from.y * zoom + vp.y }
            const p1 = { x: c1.x * zoom + vp.x, y: c1.y * zoom + vp.y }
            const p2 = { x: c2.x * zoom + vp.x, y: c2.y * zoom + vp.y }
            const p3 = { x: to.x * zoom + vp.x, y: to.y * zoom + vp.y }

            ctx.beginPath()
            ctx.moveTo(p0.x, p0.y)
            ctx.bezierCurveTo(p1.x, p1.y, p2.x, p2.y, p3.x, p3.y)
            ctx.stroke()
          }

          ctx.restore()
        }

        // Selection box
        // 支持外部框选状态
        const selectBox = useExternalEvents ? externalSelectBox : selectingRef.current
        if (selectBox) {
          const s0 = selectBox.start
          const s1 = selectBox.current
          const x0 = Math.min(s0.x, s1.x) * zoom + vp.x
          const y0 = Math.min(s0.y, s1.y) * zoom + vp.y
          const x1 = Math.max(s0.x, s1.x) * zoom + vp.x
          const y1 = Math.max(s0.y, s1.y) * zoom + vp.y
          ctx.save()
          ctx.strokeStyle = 'rgba(0,122,255,0.55)'
          ctx.fillStyle = 'rgba(0,122,255,0.10)'
          ctx.lineWidth = 1
          ctx.beginPath()
          ctx.rect(x0, y0, Math.max(1, x1 - x0), Math.max(1, y1 - y0))
          ctx.fill()
          ctx.stroke()
          ctx.restore()
        }

        // Alignment guides (during drag)
        // 支持外部对齐线状态
        const alignGuide = useExternalEvents ? externalAlignGuide : alignGuideRef.current
        const isDragging = useExternalEvents ? !!externalAlignGuide : !!draggingRef.current
        if (alignGuide && isDragging) {
          ctx.save()
          ctx.strokeStyle = 'rgba(59,130,246,0.55)'
          ctx.lineWidth = 1
          if (alignGuide.x != null) {
            ctx.beginPath()
            ctx.moveTo(alignGuide.x, -2000)
            ctx.lineTo(alignGuide.x, size.h + 2000)
            ctx.stroke()
          }
          if (alignGuide.y != null) {
            ctx.beginPath()
            ctx.moveTo(-2000, alignGuide.y)
            ctx.lineTo(size.w + 2000, alignGuide.y)
            ctx.stroke()
          }
          ctx.restore()
        }
      }
    }
  }

  const setInteracting = (val: boolean) => {
    onInteractingChange?.(val)
    isInteractingRef.current = val
    if (!val) {
      applyDprRef.current(baseDpr)
      if (interactingTimerRef.current) {
        window.clearTimeout(interactingTimerRef.current)
        interactingTimerRef.current = 0
      }
      return
    }

    // 降低交互时渲染分辨率，提升拖拽/缩放流畅度（松手后恢复）
    applyDprRef.current(1)
    if (interactingTimerRef.current) window.clearTimeout(interactingTimerRef.current)
    interactingTimerRef.current = window.setTimeout(() => {
      onInteractingChange?.(false)
      isInteractingRef.current = false
      applyDprRef.current(baseDpr)
    }, 140)
  }

  useEffect(() => {
    const root = rootRef.current
    const canvas = canvasRef.current
    const labelCanvas = labelCanvasRef.current
    if (!root || !canvas) return

    const gl = canvas.getContext('webgl2', { antialias: false, alpha: false, depth: false, stencil: false }) as WebGL2RenderingContext | null
    if (!gl) return
    glRef.current = gl

    const bgVS = `#version 300 es
precision highp float;
layout(location=0) in vec2 a_pos;
out vec2 v_uv;
void main(){
  v_uv = a_pos * 0.5 + 0.5;
  gl_Position = vec4(a_pos, 0.0, 1.0);
}`

    const bgFS = `#version 300 es
precision highp float;
in vec2 v_uv;
uniform vec2 u_resolution;
uniform vec2 u_translate;
uniform float u_zoom;
out vec4 outColor;

float gridLine(vec2 world, float gridSize, float thickness){
  vec2 cell = fract(world / gridSize);
  float dx = min(cell.x, 1.0 - cell.x);
  float dy = min(cell.y, 1.0 - cell.y);
  float d = min(dx, dy);
  float w = fwidth(d) * 1.25;
  return 1.0 - smoothstep(thickness - w, thickness + w, d);
}

void main(){
  vec2 screen = vec2(v_uv.x * u_resolution.x, v_uv.y * u_resolution.y);
  vec2 world = (screen - u_translate) / max(0.0001, u_zoom);

  vec3 base = vec3(0.961, 0.961, 0.969);
  float minor = gridLine(world, 80.0, 0.018);
  float major = gridLine(world, 400.0, 0.026);

  vec3 col = base;
  col = mix(col, vec3(0.90, 0.90, 0.92), minor * 0.22);
  col = mix(col, vec3(0.86, 0.86, 0.89), major * 0.28);
  outColor = vec4(col, 1.0);
}`

    const nodeVS = `#version 300 es
precision highp float;
layout(location=0) in vec2 a_corner;
layout(location=1) in vec2 i_pos;
layout(location=2) in vec2 i_size;
layout(location=3) in vec4 i_accent;
layout(location=4) in float i_flags;
uniform vec2 u_resolution;
uniform vec2 u_translate;
uniform float u_zoom;
uniform float u_lod;
uniform float u_dotWorld;
out vec2 v_uv;
out vec4 v_accent;
out float v_flags;
out vec2 v_sizePx;
out float v_lod;
void main() {
  vec2 sizeWorld = mix(vec2(u_dotWorld), i_size, step(0.5, u_lod));
  vec2 world = i_pos + a_corner * sizeWorld;
  vec2 screen = world * u_zoom + u_translate;
  vec2 clip = (screen / u_resolution) * 2.0 - 1.0;
  gl_Position = vec4(clip.x, -clip.y, 0.0, 1.0);
  v_uv = a_corner;
  v_accent = i_accent;
  v_flags = i_flags;
  v_sizePx = sizeWorld * u_zoom;
  v_lod = u_lod;
}`

    const nodeFS = `#version 300 es
precision highp float;
in vec2 v_uv;
in vec2 v_sizePx;
in vec4 v_accent;
in float v_flags;
in float v_lod;
out vec4 outColor;

float sdRoundRect(vec2 p, vec2 b, float r) {
  vec2 q = abs(p) - b + vec2(r);
  return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r;
}

void main() {
  float notFar = step(0.5, v_lod);

  if (notFar < 0.5) {
    vec2 p = (v_uv - 0.5) * v_sizePx;
    float r = min(v_sizePx.x, v_sizePx.y) * 0.5;
    float d = length(p) - r;
    float aa = fwidth(d) * 1.1;
    float a = smoothstep(aa, -aa, d);
    vec3 col = v_accent.rgb * 0.92;
    outColor = vec4(col, a);
    return;
  }

  float isNear = step(1.5, v_lod);
  float selected = step(0.5, v_flags);

  vec2 p = (v_uv - 0.5) * v_sizePx;
  vec2 halfSize = v_sizePx * 0.5;
  float radius = mix(10.0, 14.0, isNear);
  float dist = sdRoundRect(p, halfSize, radius);
  float aa = fwidth(dist) * 0.9;

  float inside = smoothstep(aa, -aa, dist);

  float shadowBlur = mix(14.0, 20.0, isNear);
  float shadow = (1.0 - smoothstep(0.0, shadowBlur, dist + 2.0)) * (1.0 - inside);
  vec3 shadowCol = vec3(0.0, 0.0, 0.0);

  vec3 base = vec3(1.0);
  float grad = (0.5 - v_uv.y) * 0.015;
  base += grad;

  float header = 1.0 - smoothstep(0.18, 0.22, v_uv.y);
  vec3 fill = mix(base, mix(base, v_accent.rgb, 0.12), header);

  if (isNear > 0.5) {
    float line1 = 1.0 - smoothstep(0.345, 0.355, abs(v_uv.y - 0.38));
    float line2 = 1.0 - smoothstep(0.345, 0.355, abs(v_uv.y - 0.50));
    float line3 = 1.0 - smoothstep(0.345, 0.355, abs(v_uv.y - 0.62));
    float width1 = smoothstep(0.10, 0.02, abs(v_uv.x - 0.52));
    float width2 = smoothstep(0.18, 0.02, abs(v_uv.x - 0.56));
    float width3 = smoothstep(0.14, 0.02, abs(v_uv.x - 0.50));
    float lines = (line1 * width1 + line2 * width2 + line3 * width3) * 0.14;
    fill -= vec3(0.06, 0.06, 0.08) * lines;
  }

  float borderPx = mix(1.0, 2.0, selected);
  float border = smoothstep(aa, -aa, dist) - smoothstep(aa, -aa, dist + borderPx);
  vec3 borderCol = mix(vec3(0.898, 0.898, 0.918), v_accent.rgb, selected);

  float glow = (1.0 - smoothstep(0.0, 10.0, dist)) * (1.0 - inside) * selected;
  vec3 glowCol = v_accent.rgb * 0.28;

  vec3 col = fill;
  col = mix(col, borderCol, border);
  col += glowCol * glow;
  col = mix(col, shadowCol, shadow * 0.18);
  outColor = vec4(col, inside + shadow * 0.18 + glow * 0.45);
}`

    const edgeVS = `#version 300 es
precision highp float;
layout(location=0) in vec2 a_pos;
uniform vec2 u_resolution;
uniform vec2 u_translate;
uniform float u_zoom;
void main(){
  vec2 screen = a_pos * u_zoom + u_translate;
  vec2 clip = (screen / u_resolution) * 2.0 - 1.0;
  gl_Position = vec4(clip.x, -clip.y, 0.0, 1.0);
}`

    const edgeFS = `#version 300 es
precision highp float;
uniform vec4 u_color;
out vec4 outColor;
void main(){ outColor = u_color; }`

    const bgProgram = createProgram(gl, bgVS, bgFS)
    const nodeProgram = createProgram(gl, nodeVS, nodeFS)
    const edgeProgram = createProgram(gl, edgeVS, edgeFS)

    const bgVAO = gl.createVertexArray()
    const nodeVAO = gl.createVertexArray()
    const edgeVAO = gl.createVertexArray()
    const bgBuffer = gl.createBuffer()
    const nodeInstanceBuffer = gl.createBuffer()
    const edgeBuffer = gl.createBuffer()
    const cornerBuffer = gl.createBuffer()
    if (!bgVAO || !nodeVAO || !edgeVAO || !bgBuffer || !nodeInstanceBuffer || !edgeBuffer || !cornerBuffer) return

    gl.bindVertexArray(bgVAO)
    gl.bindBuffer(gl.ARRAY_BUFFER, bgBuffer)
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]), gl.STATIC_DRAW)
    gl.enableVertexAttribArray(0)
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0)
    gl.bindVertexArray(null)

    gl.bindVertexArray(nodeVAO)
    gl.bindBuffer(gl.ARRAY_BUFFER, cornerBuffer)
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0, 0, 1, 0, 0, 1, 1, 1]), gl.STATIC_DRAW)
    gl.enableVertexAttribArray(0)
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0)

    gl.bindBuffer(gl.ARRAY_BUFFER, nodeInstanceBuffer)
    gl.bufferData(gl.ARRAY_BUFFER, 0, gl.DYNAMIC_DRAW)
    const strideBytes = nodeStrideFloatsRef.current * 4
    let off = 0
    gl.enableVertexAttribArray(1)
    gl.vertexAttribPointer(1, 2, gl.FLOAT, false, strideBytes, off)
    gl.vertexAttribDivisor(1, 1)
    off += 2 * 4
    gl.enableVertexAttribArray(2)
    gl.vertexAttribPointer(2, 2, gl.FLOAT, false, strideBytes, off)
    gl.vertexAttribDivisor(2, 1)
    off += 2 * 4
    gl.enableVertexAttribArray(3)
    gl.vertexAttribPointer(3, 4, gl.FLOAT, false, strideBytes, off)
    gl.vertexAttribDivisor(3, 1)
    off += 4 * 4
    gl.enableVertexAttribArray(4)
    gl.vertexAttribPointer(4, 1, gl.FLOAT, false, strideBytes, off)
    gl.vertexAttribDivisor(4, 1)
    gl.bindVertexArray(null)

    gl.bindVertexArray(edgeVAO)
    gl.bindBuffer(gl.ARRAY_BUFFER, edgeBuffer)
    gl.bufferData(gl.ARRAY_BUFFER, 0, gl.DYNAMIC_DRAW)
    gl.enableVertexAttribArray(0)
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0)
    gl.bindVertexArray(null)

    programsRef.current = {
      bgProgram,
      bgVAO,
      bgLocs: {
        u_resolution: gl.getUniformLocation(bgProgram, 'u_resolution'),
        u_translate: gl.getUniformLocation(bgProgram, 'u_translate'),
        u_zoom: gl.getUniformLocation(bgProgram, 'u_zoom')
      },
      nodeProgram,
      nodeVAO,
      nodeInstanceBuffer,
      nodeLocs: {
        u_resolution: gl.getUniformLocation(nodeProgram, 'u_resolution'),
        u_translate: gl.getUniformLocation(nodeProgram, 'u_translate'),
        u_zoom: gl.getUniformLocation(nodeProgram, 'u_zoom'),
        u_lod: gl.getUniformLocation(nodeProgram, 'u_lod'),
        u_dotWorld: gl.getUniformLocation(nodeProgram, 'u_dotWorld')
      },
      edgeProgram,
      edgeVAO,
      edgeBuffer,
      edgeLocs: {
        u_resolution: gl.getUniformLocation(edgeProgram, 'u_resolution'),
        u_translate: gl.getUniformLocation(edgeProgram, 'u_translate'),
        u_zoom: gl.getUniformLocation(edgeProgram, 'u_zoom'),
        u_color: gl.getUniformLocation(edgeProgram, 'u_color')
      }
    }

    gl.disable(gl.DEPTH_TEST)
    gl.disable(gl.CULL_FACE)
    gl.enable(gl.BLEND)
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA)
    gl.clearColor(0.961, 0.961, 0.969, 1.0)

    let needSyncNodes = true
    let needSyncEdges = true
    let framePending = false

    const requestFrame = () => {
      if (framePending) return
      framePending = true
      rafRef.current = requestAnimationFrame(() => {
        framePending = false
        if (needSyncNodes) {
          needSyncNodes = false
          syncNodesToGpu()
          needSyncEdges = true
        }
        if (needSyncEdges) {
          needSyncEdges = false
          syncEdgesToGpu()
        }
        render()
      })
    }
    // 将 requestFrame 暴露给外部 effect
    requestFrameRef.current = requestFrame

    const resize = () => {
      const dpr = dprRef.current
      const rect = root.getBoundingClientRect()
      sizeRef.current.w = Math.max(1, Math.floor(rect.width))
      sizeRef.current.h = Math.max(1, Math.floor(rect.height))
      canvas.width = Math.floor(sizeRef.current.w * dpr)
      canvas.height = Math.floor(sizeRef.current.h * dpr)
      canvas.style.width = `${sizeRef.current.w}px`
      canvas.style.height = `${sizeRef.current.h}px`
      if (labelCanvas) {
        labelCanvas.width = canvas.width
        labelCanvas.height = canvas.height
        labelCanvas.style.width = canvas.style.width
        labelCanvas.style.height = canvas.style.height
      }
      gl.viewport(0, 0, canvas.width, canvas.height)
      requestFrame()
    }

    applyDprRef.current = (next) => {
      const clamped = Math.max(1, Math.min(baseDpr, Number(next) || 1))
      if (Math.abs(dprRef.current - clamped) < 0.01) return
      dprRef.current = clamped
      resize()
      requestFrame()
    }

    resize()
    window.addEventListener('resize', resize)

    const unsub = useGraphStore.subscribe((s) => {
      if (s.nodes !== nodesRef.current) {
        nodesRef.current = s.nodes
        needSyncNodes = true
        requestFrame()
      }
      if (s.edges !== edgesRef.current) {
        edgesRef.current = s.edges
        needSyncEdges = true
        requestFrame()
      }
      if (
        s.viewport.x !== viewportRef.current.x ||
        s.viewport.y !== viewportRef.current.y ||
        s.viewport.zoom !== viewportRef.current.zoom
      ) {
        viewportRef.current = s.viewport
        requestFrame()
      } else {
        viewportRef.current = s.viewport
      }
      selectedNodeIdRef.current = s.selectedNodeId
      if (s.selectedNodeIds !== selectedNodeIdsRef.current) {
        selectedNodeIdsRef.current = s.selectedNodeIds
        needSyncNodes = true
        requestFrame()
      }
      if (s.selectedEdgeId !== selectedEdgeIdRef.current) {
        selectedEdgeIdRef.current = s.selectedEdgeId
        requestFrame()
      }
    })

    const onPointerDown = (ev: PointerEvent) => {
      ev.preventDefault()
      canvas.setPointerCapture(ev.pointerId)
      setInteracting(true)
      const currentTool = toolRef.current
      const local = getLocalPoint(ev)
      const vp = viewportRef.current
      const world = toWorld(local, vp)
      const hit = pickNodeAt(world, vp)
      const shift = ev.shiftKey

      if (currentTool === 'pan') {
        draggingRef.current = null
        selectingRef.current = null
        transientViewportRef.current = { ...viewportRef.current }
        onTransientViewportChange?.(transientViewportRef.current)
        ;(onPointerDown as any)._pan = { last: local }
        return
      }

      if (hit?.id) {
        if (connectModeRef.current) {
          const idx = nodeIdToIndexRef.current.get(hit.id)
          const zoom = vp.zoom || 1
          const side = idx === undefined ? null : pickPortSideAt(hit, idx, world, zoom)
          if (!side) {
            const state = useGraphStore.getState()
            if (state.selectedNodeIds.length >= 2) {
              const targetId = hit.id
              const sources = state.selectedNodeIds.filter((x) => x !== targetId)
              const existing = new Set(
                edgesRef.current.map((e) => {
                  const d: any = (e as any).data || {}
                  const sp = readPortSide(d.sourcePort || d.sourceHandle, 'right')
                  const tp = readPortSide(d.targetPort || d.targetHandle, 'left')
                  return `${e.source}|${e.target}|${sp}|${tp}`
                })
              )
              const nodesById = new Map(nodesRef.current.map((n) => [n.id, n]))
              const targetNode = nodesById.get(targetId)
              const roleTaken = new Set<string>()
              if (targetNode?.type === 'videoConfig') {
                for (const e of edgesRef.current) {
                  if (e.target !== targetId) continue
                  const r = String((e.data as any)?.imageRole || '').trim()
                  if (r) roleTaken.add(r)
                }
              }

              useGraphStore.getState().withBatchUpdates(() => {
                for (const sourceId of sources) {
                  const key = `${sourceId}|${targetId}|right|left`
                  if (existing.has(key)) continue
                  const src = nodesById.get(sourceId)
                  const data: Record<string, unknown> = { sourcePort: 'right', targetPort: 'left' }
                  if (src?.type === 'image' && targetNode?.type === 'videoConfig') {
                    const hasFirst = roleTaken.has('first_frame_image')
                    const hasLast = roleTaken.has('last_frame_image')
                    const role = !hasFirst ? 'first_frame_image' : !hasLast ? 'last_frame_image' : 'input_reference'
                    data.imageRole = role
                    roleTaken.add(role)
                  }
                  useGraphStore.getState().addEdge(sourceId, targetId, data)
                  existing.add(key)
                }
              })

              useGraphStore.getState().setSelected(targetId)
              onPickNode?.(targetId)
              draggingRef.current = null
              transientViewportRef.current = null
              onTransientViewportChange?.(null)
              ;(onPointerDown as any)._pan = null
              requestFrame()
              return
            }
          }

          const fromSide: PortSide = side || (idx === undefined ? 'right' : fallbackPortSideAt(idx, world))
          connectFromRef.current = hit.id
          connectFromSideRef.current = fromSide
          const from = portWorldPos(hit, fromSide)
          connectPreviewRef.current = { fromId: hit.id, fromSide, toSide: 'left', from, to: world }

          useGraphStore.getState().setSelected(hit.id)
          onPickNode?.(hit.id)
          draggingRef.current = null
          transientViewportRef.current = null
          onTransientViewportChange?.(null)
          ;(onPointerDown as any)._pan = null
          requestFrame()
          return
        }
        if (currentTool === 'select') {
          if (shift) useGraphStore.getState().toggleSelected(hit.id)
          else useGraphStore.getState().setSelected(hit.id)
        } else {
          useGraphStore.getState().setSelected(hit.id)
        }
        onPickNode?.(hit.id)
        if (currentTool === 'add') {
          draggingRef.current = null
          transientViewportRef.current = null
          onTransientViewportChange?.(null)
          ;(onPointerDown as any)._pan = null
          return
        }
        if (currentTool === 'select') {
          const state = useGraphStore.getState()
          const selected = state.selectedNodeIds.includes(hit.id) ? state.selectedNodeIds : [hit.id]
          const startPos = new Map<string, Vec2>()
          for (const id of selected) {
            const n = nodesRef.current.find((x) => x.id === id)
            if (n) startPos.set(id, { x: n.x, y: n.y })
          }
          draggingRef.current = { ids: selected, start: world, startPos, lastLocal: local }
        } else {
          draggingRef.current = { ids: [hit.id], start: world, startPos: new Map([[hit.id, { x: hit.x, y: hit.y }]]), lastLocal: local }
        }
        transientViewportRef.current = null
        onTransientViewportChange?.(null)
        ;(onPointerDown as any)._pan = null
      } else {
        if (connectModeRef.current) {
          connectFromRef.current = null
          connectPreviewRef.current = null
        }
        if (currentTool === 'select') {
          const endpoint = pickEdgeEndpointAt(world, vp)
          if (endpoint) {
            const e = edgesRef.current.find((x) => x.id === endpoint.id)
            if (e) {
              const nodesById = new Map(nodesRef.current.map((n) => [n.id, n]))
              const s = nodesById.get(e.source)
              const t = nodesById.get(e.target)
              const d: any = (e as any).data || {}
              const sourceSide = readPortSide(d.sourcePort || d.sourceHandle, 'right')
              const targetSide = readPortSide(d.targetPort || d.targetHandle, 'left')
              const fixedId = endpoint.end === 'source' ? e.target : e.source
              const fixedSide = endpoint.end === 'source' ? targetSide : sourceSide
              const movingId = endpoint.end === 'source' ? e.source : e.target
              const movingSide = endpoint.end === 'source' ? sourceSide : targetSide
              const fixedNode = nodesById.get(fixedId)
              if (fixedNode) {
                reconnectRef.current = {
                  edgeId: e.id,
                  moveEnd: endpoint.end,
                  fixedId,
                  fixedSide,
                  movingId,
                  movingSide
                }
                connectPreviewRef.current = { fromId: fixedId, fromSide: fixedSide, toSide: 'left', from: portWorldPos(fixedNode, fixedSide), to: world }
                useGraphStore.getState().setSelectedEdge(e.id)
                onPickNode?.(null)
                draggingRef.current = null
                transientViewportRef.current = null
                onTransientViewportChange?.(null)
                ;(onPointerDown as any)._pan = null
                requestFrame()
                return
              }
            }
          }

          const edgeId = pickEdgeAt(world, vp)
          if (edgeId) {
            useGraphStore.getState().setSelectedEdge(edgeId)
            onPickNode?.(null)
            draggingRef.current = null
            transientViewportRef.current = null
            onTransientViewportChange?.(null)
            ;(onPointerDown as any)._pan = null
            requestFrame()
            return
          }
          if (!shift) useGraphStore.getState().clearSelection()
          selectingRef.current = { start: world, current: world, additive: shift }
          transientViewportRef.current = null
          onTransientViewportChange?.(null)
          ;(onPointerDown as any)._pan = null
        } else {
          useGraphStore.getState().setSelected(null)
        }
        onPickNode?.(null)
        draggingRef.current = null
        if (currentTool === 'add') {
          onRequestAddNode?.(world)
          transientViewportRef.current = null
          onTransientViewportChange?.(null)
          ;(onPointerDown as any)._pan = null
          return
        }
        if (currentTool !== 'select') {
          transientViewportRef.current = { ...viewportRef.current }
          onTransientViewportChange?.(transientViewportRef.current)
          ;(onPointerDown as any)._pan = { last: local }
        }
      }
    }

    const onPointerMove = (ev: PointerEvent) => {
      const drag = draggingRef.current
      const pan = (onPointerDown as any)._pan
      const connecting = (connectModeRef.current || !!reconnectRef.current) && !!connectPreviewRef.current
      if (!drag && !pan && !connecting && !selectingRef.current) return

      const local = getLocalPoint(ev)
      let dx = 0
      let dy = 0
      if (drag) {
        dx = local.x - drag.lastLocal.x
        dy = local.y - drag.lastLocal.y
        drag.lastLocal = local
      } else if (pan) {
        dx = local.x - pan.last.x
        dy = local.y - pan.last.y
        pan.last = local
      }

      const vp = transientViewportRef.current || viewportRef.current
      if (drag?.ids && drag.ids.length > 0) {
        const world = toWorld(local, vp)
        const dxw = world.x - drag.start.x
        const dyw = world.y - drag.start.y
        const allowSnap = !ev.altKey && toolRef.current === 'select'
        let alignDx = 0
        let alignDy = 0
        let alignXLine: number | undefined
        let alignYLine: number | undefined

        if (allowSnap) {
          const zoom = vp.zoom || 1
          const threshold = 7 / Math.max(0.001, zoom)
          const dragged = new Set(drag.ids)
          const primaryId = selectedNodeIdRef.current && dragged.has(selectedNodeIdRef.current) ? selectedNodeIdRef.current : drag.ids[0]
          const primaryStart = drag.startPos.get(primaryId)
          const primaryNode = nodesRef.current.find((n) => n.id === primaryId)

          if (primaryStart && primaryNode) {
            const rawPrimary = { x: primaryStart.x + dxw, y: primaryStart.y + dyw }
            const { w: pw, h: ph } = getNodeSize(primaryNode.type)
            const pxs = [rawPrimary.x, rawPrimary.x + pw * 0.5, rawPrimary.x + pw]
            const pys = [rawPrimary.y, rawPrimary.y + ph * 0.5, rawPrimary.y + ph]

            let bestX: { delta: number; target: number } | null = null
            let bestY: { delta: number; target: number } | null = null

            for (const other of nodesRef.current) {
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

        alignGuideRef.current = allowSnap && (alignXLine != null || alignYLine != null) ? { x: alignXLine, y: alignYLine } : null

        for (const id of drag.ids) {
          const start = drag.startPos.get(id)
          if (!start) continue
          const raw = { x: start.x + dxw + alignDx, y: start.y + dyw + alignDy }
          const pos = allowSnap
            ? { x: alignDx ? raw.x : snapToGrid(raw.x), y: alignDy ? raw.y : snapToGrid(raw.y) }
            : raw
          updateDraggedNodeGpu(id, pos)
        }
        requestFrame()
      } else if (pan) {
        transientViewportRef.current = { x: vp.x + dx, y: vp.y + dy, zoom: vp.zoom }
        onTransientViewportChange?.(transientViewportRef.current)
        requestFrame()
      } else if (connecting) {
        const world = toWorld(local, vp)
        const prev = connectPreviewRef.current
        if (prev) {
          const hover = pickNodeAt(world, vp)
          if (hover?.id && hover.id !== prev.fromId) {
            const idx = nodeIdToIndexRef.current.get(hover.id)
            const zoom = vp.zoom || 1
            const strict = idx === undefined ? null : pickPortSideAt(hover, idx, world, zoom)
            const toSide = idx === undefined ? 'left' : strict || fallbackPortSideAt(idx, world)
            connectPreviewRef.current = { ...prev, toSide, to: portWorldPos(hover, toSide) }
          } else {
            const toSide: PortSide = world.x >= prev.from.x ? 'left' : 'right'
            connectPreviewRef.current = { ...prev, toSide, to: world }
          }
          requestFrame()
        }
      } else if (selectingRef.current) {
        const world = toWorld(local, vp)
        selectingRef.current = { ...selectingRef.current, current: world }
        requestFrame()
      }
      setInteracting(true)
    }

    const onPointerUp = (ev: PointerEvent) => {
      const drag = draggingRef.current
      draggingRef.current = null
      alignGuideRef.current = null
      ;(onPointerDown as any)._pan = null
      try {
        canvas.releasePointerCapture(ev.pointerId)
      } catch {
        // ignore
      }

      if (connectPreviewRef.current && (connectModeRef.current || !!reconnectRef.current)) {
        const local = getLocalPoint(ev)
        const vp = transientViewportRef.current || viewportRef.current
        const world = toWorld(local, vp)
        const hit = pickNodeAt(world, vp)
        const fromId = connectPreviewRef.current.fromId
        const fromSide = connectPreviewRef.current.fromSide
        const reconnect = reconnectRef.current
        connectPreviewRef.current = null
        connectFromRef.current = null
        reconnectRef.current = null

        if (hit?.id && hit.id !== fromId) {
          const idx = nodeIdToIndexRef.current.get(hit.id)
          const zoom = vp.zoom || 1
          const strict = idx === undefined ? null : pickPortSideAt(hit, idx, world, zoom)
          const toSide: PortSide = idx === undefined ? 'left' : strict || fallbackPortSideAt(idx, world)
          const byId = new Map(nodesRef.current.map((n) => [n.id, n]))
          const src = byId.get(fromId)
          const dst = byId.get(hit.id)

          if (!reconnect) {
            const data: Record<string, unknown> = { sourcePort: fromSide, targetPort: toSide }
            if (src?.type === 'image' && dst?.type === 'videoConfig') {
              const incoming = edgesRef.current.filter((e) => e.target === dst.id && e.source !== fromId)
              const roles = incoming.map((e) => String((e.data as any)?.imageRole || '').trim())
              const hasFirst = roles.includes('first_frame_image')
              const hasLast = roles.includes('last_frame_image')
              data.imageRole = !hasFirst ? 'first_frame_image' : !hasLast ? 'last_frame_image' : 'input_reference'
            }
            useGraphStore.getState().addEdge(fromId, hit.id, data)
          } else {
            const e = edgesRef.current.find((x) => x.id === reconnect.edgeId)
            if (e) {
              const next = reconnect.moveEnd === 'source'
                ? { source: hit.id, target: reconnect.fixedId }
                : { source: reconnect.fixedId, target: hit.id }
              const nextData: Record<string, unknown> = { ...(e.data || {}) }
              if (reconnect.moveEnd === 'source') {
                nextData.sourcePort = toSide
                nextData.targetPort = reconnect.fixedSide
              } else {
                nextData.sourcePort = reconnect.fixedSide
                nextData.targetPort = toSide
              }

              const dupKey = `${next.source}|${next.target}|${String(nextData.sourcePort || '')}|${String(nextData.targetPort || '')}`
              const dup = edgesRef.current.some((x) => {
                if (x.id === e.id) return false
                const d: any = (x as any).data || {}
                const k = `${x.source}|${x.target}|${String(d.sourcePort || d.sourceHandle || '')}|${String(d.targetPort || d.targetHandle || '')}`
                return k === dupKey
              })
              if (!dup) {
                useGraphStore.getState().withBatchUpdates(() => {
                  useGraphStore.getState().updateEdge(e.id, { ...next, data: nextData })
                  const role = String((nextData as any)?.imageRole || '').trim()
                  const ns = byId.get(next.source)
                  const nt = byId.get(next.target)
                  if (role && (role === 'first_frame_image' || role === 'last_frame_image') && ns?.type === 'image' && nt?.type === 'videoConfig') {
                    useGraphStore.getState().setEdgeImageRole(e.id, role)
                  }
                })
              }
            }
          }
        }
        requestFrame()
      }

      if (drag?.ids && drag.ids.length > 0) {
        useGraphStore.getState().withBatchUpdates(() => {
          for (const id of drag.ids) {
            const idx = nodeIdToIndexRef.current.get(id)
            if (idx === undefined) continue
            const stride = nodeStrideFloatsRef.current
            const base = idx * stride
            const x = nodeDataRef.current[base + 0]
            const y = nodeDataRef.current[base + 1]
            useGraphStore.getState().updateNode(id, { x, y })
          }
        })
      }

      if (selectingRef.current) {
        const box = selectingRef.current
        selectingRef.current = null
        const x0 = Math.min(box.start.x, box.current.x)
        const y0 = Math.min(box.start.y, box.current.y)
        const x1 = Math.max(box.start.x, box.current.x)
        const y1 = Math.max(box.start.y, box.current.y)
        const picked: string[] = []
        for (const n of nodesRef.current) {
          const { w, h } = getNodeSize(n.type)
          const nx0 = n.x
          const ny0 = n.y
          const nx1 = n.x + w
          const ny1 = n.y + h
          const inter = nx1 >= x0 && nx0 <= x1 && ny1 >= y0 && ny0 <= y1
          if (inter) picked.push(n.id)
        }
        if (box.additive) {
          const current = useGraphStore.getState().selectedNodeIds
          useGraphStore.getState().setSelection([...current, ...picked], useGraphStore.getState().selectedNodeId)
        } else {
          useGraphStore.getState().setSelection(picked, picked[0] || null)
        }
      }

      if (transientViewportRef.current) {
        useGraphStore.getState().setViewport(transientViewportRef.current)
        transientViewportRef.current = null
        onTransientViewportChange?.(null)
      }
      setInteracting(false)
    }

    const onWheel = (ev: WheelEvent) => {
      ev.preventDefault()
      setInteracting(true)
      const baseVp = transientViewportRef.current || viewportRef.current

      if (ev.ctrlKey || ev.metaKey) {
        const dir = ev.deltaY > 0 ? -1 : 1
        const factor = dir > 0 ? 1.08 : 1 / 1.08
        const nextZoom = clampZoom((baseVp.zoom || 1) * factor)
        const local = getLocalPoint(ev)
        const before = toWorld(local, baseVp)
        const nextVp = { ...baseVp, zoom: nextZoom }
        const after = toWorld(local, nextVp)
        const nx = baseVp.x + (after.x - before.x) * nextZoom
        const ny = baseVp.y + (after.y - before.y) * nextZoom
        transientViewportRef.current = { x: nx, y: ny, zoom: nextZoom }
        onTransientViewportChange?.(transientViewportRef.current)
        requestFrame()
      } else {
        const nx = baseVp.x - (Number(ev.deltaX) || 0)
        const ny = baseVp.y - (Number(ev.deltaY) || 0)
        transientViewportRef.current = { x: nx, y: ny, zoom: baseVp.zoom }
        onTransientViewportChange?.(transientViewportRef.current)
        requestFrame()
      }

      if (wheelCommitTimerRef.current) window.clearTimeout(wheelCommitTimerRef.current)
      wheelCommitTimerRef.current = window.setTimeout(() => {
        wheelCommitTimerRef.current = 0
        if (transientViewportRef.current) {
          useGraphStore.getState().setViewport(transientViewportRef.current)
          transientViewportRef.current = null
          onTransientViewportChange?.(null)
        }
        setInteracting(false)
      }, 120)
    }

    // 当使用外部事件系统时，不注册内部事件监听器
    // 这样 EventCoordinator 可以完全接管事件处理
    if (!useExternalEvents) {
    canvas.addEventListener('pointerdown', onPointerDown, { passive: false })
    canvas.addEventListener('pointermove', onPointerMove, { passive: true })
    canvas.addEventListener('pointerup', onPointerUp, { passive: true })
    canvas.addEventListener('pointercancel', onPointerUp, { passive: true })
    canvas.addEventListener('wheel', onWheel, { passive: false })
    }

    const onContextMenuEv = (ev: MouseEvent) => {
      // 当使用外部事件系统时，跳过内部右键菜单处理
      if (useExternalEvents) return
      if (!onContextMenu) return
      ev.preventDefault()
      const vp = transientViewportRef.current || viewportRef.current
      const rect = canvas.getBoundingClientRect()
      const local = { x: ev.clientX - rect.left, y: ev.clientY - rect.top }
      const world = toWorld(local, vp)
      const hitNode = pickNodeAt(world, vp)
      if (hitNode?.id) {
        onContextMenu({ kind: 'node', id: hitNode.id, clientX: ev.clientX, clientY: ev.clientY })
        return
      }
      const edgeId = pickEdgeAt(world, vp)
      if (edgeId) {
        onContextMenu({ kind: 'edge', id: edgeId, clientX: ev.clientX, clientY: ev.clientY })
        return
      }
      onContextMenu({ kind: 'canvas', clientX: ev.clientX, clientY: ev.clientY, world })
    }
    if (!useExternalEvents) {
    canvas.addEventListener('contextmenu', onContextMenuEv, { passive: false })
    }

    return () => {
      window.removeEventListener('resize', resize)
      if (!useExternalEvents) {
      canvas.removeEventListener('pointerdown', onPointerDown as any)
      canvas.removeEventListener('pointermove', onPointerMove as any)
      canvas.removeEventListener('pointerup', onPointerUp as any)
      canvas.removeEventListener('pointercancel', onPointerUp as any)
      canvas.removeEventListener('wheel', onWheel as any)
      canvas.removeEventListener('contextmenu', onContextMenuEv as any)
      }
      if (wheelCommitTimerRef.current) window.clearTimeout(wheelCommitTimerRef.current)
      if (interactingTimerRef.current) window.clearTimeout(interactingTimerRef.current)
      if (rafRef.current) cancelAnimationFrame(rafRef.current)
      applyDprRef.current = () => {}
      unsub()
    }
  }, [baseDpr, onInteractingChange, onPickNode, onRequestAddNode, onTransientViewportChange, useExternalEvents])

  return (
    <div ref={rootRef} className={className || 'absolute inset-0 overflow-hidden z-0'}>
      <canvas
        ref={canvasRef}
        className={[
          'absolute inset-0 block h-full w-full',
          // 当使用外部事件系统时，禁用 canvas 上的 touch-action 和 cursor，由 EventCoordinator 控制
          useExternalEvents ? 'pointer-events-none' : 'touch-none',
          !useExternalEvents && (tool === 'pan' ? 'cursor-grab active:cursor-grabbing' : tool === 'add' ? 'cursor-crosshair' : tool === 'connect' ? 'cursor-cell' : 'cursor-default')
        ].filter(Boolean).join(' ')}
      />
      <canvas ref={labelCanvasRef} className="pointer-events-none absolute inset-0 block h-full w-full" />
      {import.meta.env.DEV ? (
        <div className="pointer-events-none absolute left-3 bottom-3 flex gap-2 rounded-full border border-[var(--border-color)] bg-[var(--bg-secondary)]/70 px-3 py-2 text-xs text-[var(--text-secondary)] backdrop-blur">
          <span>节点 {nodesRef.current.length}</span>
          <span>边 {edgesRef.current.length}</span>
          <span>FPS {fps}</span>
        </div>
      ) : null}
    </div>
  )
}
