import type { GraphNode, GraphEdge } from '@/graph/types'

const H_GAP = 120
const V_GAP = 60
const GRID = 20

const snap = (v: number) => Math.round(v / GRID) * GRID

export function computeAutoLayout(
  nodes: GraphNode[],
  edges: GraphEdge[],
  getSize: (type: string) => { w: number; h: number },
): Map<string, { x: number; y: number }> {
  if (nodes.length === 0) return new Map()

  const nodeSet = new Set(nodes.map(n => n.id))
  const validEdges = edges.filter(e => nodeSet.has(e.source) && nodeSet.has(e.target) && e.source !== e.target)

  // adjacency
  const outEdges = new Map<string, string[]>()
  const inEdges = new Map<string, string[]>()
  const inDeg = new Map<string, number>()
  for (const id of nodeSet) {
    outEdges.set(id, [])
    inEdges.set(id, [])
    inDeg.set(id, 0)
  }
  const connectedIds = new Set<string>()
  for (const e of validEdges) {
    outEdges.get(e.source)!.push(e.target)
    inEdges.get(e.target)!.push(e.source)
    inDeg.set(e.target, inDeg.get(e.target)! + 1)
    connectedIds.add(e.source)
    connectedIds.add(e.target)
  }

  // Kahn's topo sort + longest-path layer assignment
  const layer = new Map<string, number>()
  const queue: string[] = []
  for (const id of connectedIds) {
    if (inDeg.get(id) === 0) {
      queue.push(id)
      layer.set(id, 0)
    }
  }

  const visited = new Set<string>()
  while (queue.length > 0) {
    const u = queue.shift()!
    visited.add(u)
    for (const v of outEdges.get(u)!) {
      const next = layer.get(u)! + 1
      layer.set(v, Math.max(layer.get(v) ?? 0, next))
      const deg = inDeg.get(v)! - 1
      inDeg.set(v, deg)
      if (deg === 0) queue.push(v)
    }
  }

  // cycle fallback: connected but not visited
  let maxLayer = 0
  for (const v of layer.values()) maxLayer = Math.max(maxLayer, v)
  for (const id of connectedIds) {
    if (!visited.has(id)) {
      layer.set(id, ++maxLayer)
      visited.add(id)
    }
  }

  // group connected nodes by layer
  const layerGroups = new Map<number, GraphNode[]>()
  const nodeById = new Map(nodes.map(n => [n.id, n]))
  for (const [id, l] of layer) {
    const node = nodeById.get(id)
    if (!node) continue
    if (!layerGroups.has(l)) layerGroups.set(l, [])
    layerGroups.get(l)!.push(node)
  }

  // barycenter ordering: sort each layer by avg predecessor index in previous layer
  const sortedLayers = [...layerGroups.keys()].sort((a, b) => a - b)
  const nodeOrder = new Map<string, number>()

  for (const l of sortedLayers) {
    const group = layerGroups.get(l)!
    if (l === 0) {
      // keep original y order for roots
      group.sort((a, b) => a.y - b.y)
    } else {
      group.sort((a, b) => {
        const avgA = baryCenter(a.id, inEdges, nodeOrder)
        const avgB = baryCenter(b.id, inEdges, nodeOrder)
        return avgA - avgB
      })
    }
    for (let i = 0; i < group.length; i++) nodeOrder.set(group[i].id, i)
  }

  // compute positions
  const result = new Map<string, { x: number; y: number }>()
  let xOffset = 0

  for (const l of sortedLayers) {
    const group = layerGroups.get(l)!
    let layerMaxW = 0
    let totalH = 0
    for (const n of group) {
      const s = getSize(n.type)
      layerMaxW = Math.max(layerMaxW, s.w)
      totalH += s.h
    }
    totalH += V_GAP * (group.length - 1)

    let yOffset = -totalH / 2
    for (const n of group) {
      const s = getSize(n.type)
      result.set(n.id, { x: snap(xOffset), y: snap(yOffset) })
      yOffset += s.h + V_GAP
    }
    xOffset += layerMaxW + H_GAP
  }

  // disconnected nodes (no edges): place below
  const disconnected = nodes.filter(n => !connectedIds.has(n.id))
  if (disconnected.length > 0) {
    let maxY = -Infinity
    for (const pos of result.values()) {
      const node = nodes.find(n => nodeById.get(n.id) && result.get(n.id) === pos)
      if (node) {
        const h = getSize(node.type).h
        maxY = Math.max(maxY, pos.y + h)
      }
    }
    if (!Number.isFinite(maxY)) maxY = 0

    const startY = snap(maxY + V_GAP + 80)
    let dx = 0
    for (const n of disconnected) {
      const s = getSize(n.type)
      result.set(n.id, { x: snap(dx), y: startY })
      dx += s.w + H_GAP
    }
  }

  // shift so top-left is at (100, 100)
  let minX = Infinity
  let minY = Infinity
  for (const pos of result.values()) {
    minX = Math.min(minX, pos.x)
    minY = Math.min(minY, pos.y)
  }
  const shiftX = snap(100 - minX)
  const shiftY = snap(100 - minY)
  for (const [id, pos] of result) {
    result.set(id, { x: snap(pos.x + shiftX), y: snap(pos.y + shiftY) })
  }

  return result
}

function baryCenter(nodeId: string, inEdges: Map<string, string[]>, nodeOrder: Map<string, number>): number {
  const preds = inEdges.get(nodeId) || []
  if (preds.length === 0) return 0
  let sum = 0
  let count = 0
  for (const p of preds) {
    const ord = nodeOrder.get(p)
    if (ord !== undefined) {
      sum += ord
      count++
    }
  }
  return count > 0 ? sum / count : 0
}

// ---------------------------------------------------------------------------
// Smart Tidy: 基于用户当前布局的智能对齐整理
// ---------------------------------------------------------------------------

type NodeRect = { id: string; x: number; y: number; w: number; h: number; cx: number; cy: number }

function median(values: number[]): number {
  const s = values.slice().sort((a, b) => a - b)
  const mid = Math.floor(s.length / 2)
  return s.length % 2 !== 0 ? s[mid] : (s[mid - 1] + s[mid]) / 2
}

function collectSubgraph(startIds: string[], edges: GraphEdge[], allNodeIds: Set<string>): Set<string> {
  const outEdges = new Map<string, string[]>()
  const inEdges = new Map<string, string[]>()
  for (const id of allNodeIds) { outEdges.set(id, []); inEdges.set(id, []) }
  for (const e of edges) {
    if (allNodeIds.has(e.source) && allNodeIds.has(e.target) && e.source !== e.target) {
      outEdges.get(e.source)!.push(e.target)
      inEdges.get(e.target)!.push(e.source)
    }
  }
  const visited = new Set<string>()
  const queue = startIds.filter(id => allNodeIds.has(id))
  for (const id of queue) visited.add(id)
  while (queue.length > 0) {
    const u = queue.shift()!
    for (const v of outEdges.get(u) || []) {
      if (!visited.has(v)) { visited.add(v); queue.push(v) }
    }
    for (const v of inEdges.get(u) || []) {
      if (!visited.has(v)) { visited.add(v); queue.push(v) }
    }
  }
  return visited
}

function clusterByAxis(
  sorted: NodeRect[],
  posKey: 'cx' | 'cy',
  sizeKey: 'w' | 'h',
  factor: number,
): NodeRect[][] {
  if (sorted.length === 0) return []
  const clusters: NodeRect[][] = [[sorted[0]]]
  for (let i = 1; i < sorted.length; i++) {
    const cur = sorted[i]
    const cluster = clusters[clusters.length - 1]
    const clusterMedian = median(cluster.map(r => r[posKey]))
    const threshold = Math.max(cur[sizeKey], cluster[cluster.length - 1][sizeKey]) * factor
    if (Math.abs(cur[posKey] - clusterMedian) < threshold) {
      cluster.push(cur)
    } else {
      clusters.push([cur])
    }
  }
  return clusters
}

export function computeSmartTidy(
  allNodes: GraphNode[],
  edges: GraphEdge[],
  startIds: string[],
  getSize: (type: string) => { w: number; h: number },
): Map<string, { x: number; y: number }> {
  if (allNodes.length === 0) return new Map()

  const allNodeIds = new Set(allNodes.map(n => n.id))
  const validEdges = edges.filter(e => allNodeIds.has(e.source) && allNodeIds.has(e.target) && e.source !== e.target)

  // Phase 1: 收集子图
  const subgraphIds = startIds.length > 0
    ? collectSubgraph(startIds, validEdges, allNodeIds)
    : allNodeIds
  if (subgraphIds.size === 0) return new Map()

  const nodeById = new Map(allNodes.map(n => [n.id, n]))

  // Phase 2: 构建矩形
  const rects = new Map<string, NodeRect>()
  for (const id of subgraphIds) {
    const n = nodeById.get(id)!
    const s = getSize(n.type)
    rects.set(id, { id, x: n.x, y: n.y, w: s.w, h: s.h, cx: n.x + s.w / 2, cy: n.y + s.h / 2 })
  }

  // Phase 3: 行聚类（Y 轴）
  const sortedByY = [...rects.values()].sort((a, b) => a.cy - b.cy)
  const rows = clusterByAxis(sortedByY, 'cy', 'h', 0.6)

  // Phase 4: 列聚类（X 轴）
  const sortedByX = [...rects.values()].sort((a, b) => a.cx - b.cx)
  const cols = clusterByAxis(sortedByX, 'cx', 'w', 0.5)

  // Phase 5: 计算对齐目标位置
  const rowTarget = new Map<string, number>()
  for (const row of rows) {
    const medCY = median(row.map(r => r.cy))
    for (const r of row) rowTarget.set(r.id, medCY)
  }
  const colTarget = new Map<string, number>()
  for (const col of cols) {
    const medCX = median(col.map(r => r.cx))
    for (const r of col) colTarget.set(r.id, medCX)
  }

  const targets = new Map<string, { x: number; y: number }>()
  for (const [id, rect] of rects) {
    targets.set(id, {
      x: snap((colTarget.get(id) ?? rect.cx) - rect.w / 2),
      y: snap((rowTarget.get(id) ?? rect.cy) - rect.h / 2),
    })
  }

  // Phase 6a: 同行内消除水平重叠
  for (const row of rows) {
    const sorted = row.slice().sort((a, b) => targets.get(a.id)!.x - targets.get(b.id)!.x)
    for (let i = 0; i < sorted.length - 1; i++) {
      const cur = sorted[i]
      const next = sorted[i + 1]
      const rightEdge = targets.get(cur.id)!.x + cur.w + H_GAP
      if (rightEdge > targets.get(next.id)!.x) {
        targets.get(next.id)!.x = snap(rightEdge)
      }
    }
  }

  // Phase 6b: 同列内消除垂直重叠
  for (const col of cols) {
    const sorted = col.slice().sort((a, b) => targets.get(a.id)!.y - targets.get(b.id)!.y)
    for (let j = 0; j < sorted.length - 1; j++) {
      const cur = sorted[j]
      const next = sorted[j + 1]
      const bottomEdge = targets.get(cur.id)!.y + cur.h + V_GAP
      if (bottomEdge > targets.get(next.id)!.y) {
        targets.get(next.id)!.y = snap(bottomEdge)
      }
    }
  }

  // Phase 6c: 全局重叠扫描
  const ids = [...targets.keys()]
  for (let pass = 0; pass < 3; pass++) {
    let moved = false
    for (let i = 0; i < ids.length; i++) {
      for (let j = i + 1; j < ids.length; j++) {
        const a = rects.get(ids[i])!
        const b = rects.get(ids[j])!
        const pa = targets.get(ids[i])!
        const pb = targets.get(ids[j])!
        const overlapX = Math.min(pa.x + a.w, pb.x + b.w) - Math.max(pa.x, pb.x)
        const overlapY = Math.min(pa.y + a.h, pb.y + b.h) - Math.max(pa.y, pb.y)
        if (overlapX > 0 && overlapY > 0) {
          if (overlapX < overlapY) {
            const push = overlapX / 2 + H_GAP / 2
            if (pa.x <= pb.x) { pa.x = snap(pa.x - push); pb.x = snap(pb.x + push) }
            else { pb.x = snap(pb.x - push); pa.x = snap(pa.x + push) }
          } else {
            const push = overlapY / 2 + V_GAP / 2
            if (pa.y <= pb.y) { pa.y = snap(pa.y - push); pb.y = snap(pb.y + push) }
            else { pb.y = snap(pb.y - push); pa.y = snap(pa.y + push) }
          }
          moved = true
        }
      }
    }
    if (!moved) break
  }

  return targets
}
