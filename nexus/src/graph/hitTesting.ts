import type { GraphEdge, GraphNode, Viewport } from '@/graph/types'

/**
 * 命中检测工具函数
 * 从 WebGLGraphCanvas 提取并重构为纯函数，可在多个组件间共享
 */

export type Vec2 = { x: number; y: number }
export type PortSide = 'left' | 'right'

/**
 * 屏幕坐标转世界坐标
 */
export const screenToWorld = (screen: Vec2, viewport: Viewport): Vec2 => ({
  x: (screen.x - viewport.x) / (viewport.zoom || 1),
  y: (screen.y - viewport.y) / (viewport.zoom || 1)
})

/**
 * 世界坐标转屏幕坐标
 */
export const worldToScreen = (world: Vec2, viewport: Viewport): Vec2 => ({
  x: world.x * (viewport.zoom || 1) + viewport.x,
  y: world.y * (viewport.zoom || 1) + viewport.y
})

/**
 * 读取端口侧（带回退值）
 */
export const readPortSide = (raw: unknown, fallback: PortSide): PortSide => {
  if (raw === 'left' || raw === 'right') return raw
  return fallback
}

/**
 * 获取节点端口的世界坐标
 */
export const getPortWorldPos = (
  node: GraphNode,
  side: PortSide,
  nodeSize: { w: number; h: number }
): Vec2 => ({
  x: node.x + (side === 'right' ? nodeSize.w : 0),
  y: node.y + nodeSize.h * 0.5
})

/**
 * 计算贝塞尔曲线控制点
 */
export const bezierControls = (
  from: Vec2,
  to: Vec2,
  fromSide: PortSide,
  toSide: PortSide
) => {
  const dx = to.x - from.x
  const handle = Math.max(60, Math.min(320, Math.abs(dx) * 0.45))
  const c1 = { x: from.x + (fromSide === 'right' ? handle : -handle), y: from.y }
  const c2 = { x: to.x + (toSide === 'right' ? handle : -handle), y: to.y }
  return { c1, c2 }
}

/**
 * 计算贝塞尔曲线上的点
 */
export const cubicPoint = (p0: Vec2, p1: Vec2, p2: Vec2, p3: Vec2, t: number): Vec2 => {
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

/**
 * 命中检测：节点
 * @param world 世界坐标点
 * @param nodes 节点列表
 * @param getSizeFn 获取节点尺寸的函数
 * @param zoom 当前缩放级别（用于远景模式下的简化检测）
 * @returns 命中的节点，或 null
 */
export function hitTestNode(
  world: Vec2,
  nodes: GraphNode[],
  getSizeFn: (type: string) => { w: number; h: number },
  zoom = 1
): GraphNode | null {
  const isFarView = zoom < 0.55

  if (isFarView) {
    // 远景模式：使用圆形碰撞检测
    const r = 8 / zoom
    const r2 = r * r
    for (let i = nodes.length - 1; i >= 0; i--) {
      const n = nodes[i]
      const dx = world.x - n.x
      const dy = world.y - n.y
      if (dx * dx + dy * dy <= r2) return n
    }
    return null
  }

  // 正常模式：使用矩形碰撞检测
  for (let i = nodes.length - 1; i >= 0; i--) {
    const n = nodes[i]
    const { w, h } = getSizeFn(n.type)
    if (world.x >= n.x && world.x <= n.x + w && world.y >= n.y && world.y <= n.y + h) {
      return n
    }
  }
  return null
}

/**
 * 命中检测：边缘（连接线）
 * @param world 世界坐标点
 * @param edges 边缘列表
 * @param nodesById 节点 ID 到节点的映射
 * @param getSizeFn 获取节点尺寸的函数
 * @param threshold 命中阈值（世界坐标距离）
 * @returns 命中的边缘 ID，或 null
 */
export function hitTestEdge(
  world: Vec2,
  edges: GraphEdge[],
  nodesById: Map<string, GraphNode>,
  getSizeFn: (type: string) => { w: number; h: number },
  threshold: number
): string | null {
  const threshold2 = threshold * threshold
  let best: { id: string; dist2: number } | null = null

  for (const e of edges) {
    const s = nodesById.get(e.source)
    const t = nodesById.get(e.target)
    if (!s || !t) continue

    const d: any = e.data || {}
    const sourceSide = readPortSide(d.sourcePort || d.sourceHandle, 'right')
    const targetSide = readPortSide(d.targetPort || d.targetHandle, 'left')

    const p0 = getPortWorldPos(s, sourceSide, getSizeFn(s.type))
    const p3 = getPortWorldPos(t, targetSide, getSizeFn(t.type))
    const { c1, c2 } = bezierControls(p0, p3, sourceSide, targetSide)

    // 沿曲线采样检测距离
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
      if (dist2 <= threshold2 && (!best || dist2 < best.dist2)) {
        best = { id: e.id, dist2 }
      }
      prev = p
    }
  }

  return best?.id || null
}

/**
 * 命中检测：边缘端点
 * @returns 命中的端点信息，或 null
 */
export function hitTestEdgeEndpoint(
  world: Vec2,
  edges: GraphEdge[],
  nodesById: Map<string, GraphNode>,
  getSizeFn: (type: string) => { w: number; h: number },
  threshold: number
): { id: string; end: 'source' | 'target'; side: PortSide } | null {
  const threshold2 = threshold * threshold
  let best: { id: string; end: 'source' | 'target'; dist2: number; side: PortSide } | null = null

  for (const e of edges) {
    const s = nodesById.get(e.source)
    const t = nodesById.get(e.target)
    if (!s || !t) continue

    const d: any = e.data || {}
    const sourceSide = readPortSide(d.sourcePort || d.sourceHandle, 'right')
    const targetSide = readPortSide(d.targetPort || d.targetHandle, 'left')

    const sp = getPortWorldPos(s, sourceSide, getSizeFn(s.type))
    const tp = getPortWorldPos(t, targetSide, getSizeFn(t.type))

    const dsx = world.x - sp.x
    const dsy = world.y - sp.y
    const dtx = world.x - tp.x
    const dty = world.y - tp.y
    const sd2 = dsx * dsx + dsy * dsy
    const td2 = dtx * dtx + dty * dty

    if (sd2 <= threshold2 && (!best || sd2 < best.dist2)) {
      best = { id: e.id, end: 'source', dist2: sd2, side: sourceSide }
    }
    if (td2 <= threshold2 && (!best || td2 < best.dist2)) {
      best = { id: e.id, end: 'target', dist2: td2, side: targetSide }
    }
  }

  return best ? { id: best.id, end: best.end, side: best.side } : null
}

/**
 * 命中检测：节点端口
 * @param world 世界坐标点
 * @param node 目标节点
 * @param nodeSize 节点尺寸
 * @param portRadius 端口命中半径（世界坐标）
 * @returns 命中的端口侧，或 null
 */
export function hitTestPort(
  world: Vec2,
  node: GraphNode,
  nodeSize: { w: number; h: number },
  portRadius: number
): PortSide | null {
  const r2 = portRadius * portRadius
  const cy = node.y + nodeSize.h * 0.5

  // 检测左端口
  const lx = node.x
  const dlx = world.x - lx
  const dly = world.y - cy
  if (dlx * dlx + dly * dly <= r2) return 'left'

  // 检测右端口
  const rx = node.x + nodeSize.w
  const drx = world.x - rx
  const dry = world.y - cy
  if (drx * drx + dry * dry <= r2) return 'right'

  return null
}

/**
 * 根据点击位置推断端口侧（当未精确命中端口时的回退策略）
 */
export function inferPortSide(
  world: Vec2,
  node: GraphNode,
  nodeSize: { w: number; h: number }
): PortSide {
  return world.x < node.x + nodeSize.w * 0.5 ? 'left' : 'right'
}

/**
 * 检查点是否在节点边界框内
 */
export function isPointInNode(
  world: Vec2,
  node: GraphNode,
  nodeSize: { w: number; h: number }
): boolean {
  return (
    world.x >= node.x &&
    world.x <= node.x + nodeSize.w &&
    world.y >= node.y &&
    world.y <= node.y + nodeSize.h
  )
}

/**
 * 获取鼠标事件的本地坐标（相对于元素）
 */
export function getLocalPoint(ev: PointerEvent | WheelEvent | MouseEvent): Vec2 {
  const x = Number((ev as any).offsetX)
  const y = Number((ev as any).offsetY)
  if (Number.isFinite(x) && Number.isFinite(y)) return { x, y }
  const cx = Number((ev as any).clientX) || 0
  const cy = Number((ev as any).clientY) || 0
  return { x: cx, y: cy }
}

/**
 * 网格对齐
 */
export const GRID_SIZE = 20
export const snapToGrid = (v: number) => Math.round(v / GRID_SIZE) * GRID_SIZE

/**
 * 限制缩放范围
 */
export const clampZoom = (z: number) => Math.max(0.1, Math.min(2, z))
