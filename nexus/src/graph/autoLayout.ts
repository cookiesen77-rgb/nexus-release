import type { GraphNode, GraphEdge } from '@/graph/types'
import { getNodeSize } from '@/graph/nodeSizing'

const H_GAP = 80
const V_GAP = 60
const COMPONENT_GAP = 120

/**
 * 一键整理：对画布上所有节点做拓扑分层布局。
 * - 按连通分量分组，各自独立布局后垂直堆叠
 * - 考虑节点实际宽高计算间距
 * - 同层节点居中对齐
 */
export function computeAutoLayout(
  nodes: GraphNode[],
  edges: GraphEdge[]
): Map<string, { x: number; y: number }> {
  const result = new Map<string, { x: number; y: number }>()
  if (nodes.length === 0) return result

  const nodeMap = new Map(nodes.map(n => [n.id, n]))

  // 分离连通分量
  const components = findConnectedComponents(nodes, edges)

  let cursorY = 0

  for (const comp of components) {
    const compNodes = comp.map(id => nodeMap.get(id)!).filter(Boolean)
    const compEdges = edges.filter(e => comp.includes(e.source) && comp.includes(e.target))

    const positions = layoutComponent(compNodes, compEdges)

    // 计算该分量包围盒高度
    let maxY = 0
    for (const [id, pos] of positions) {
      const adjusted = { x: pos.x, y: pos.y + cursorY }
      result.set(id, adjusted)
      const { h } = getNodeSize(nodeMap.get(id)!.type)
      maxY = Math.max(maxY, adjusted.y + h)
    }

    cursorY = maxY + COMPONENT_GAP
  }

  return result
}

/** BFS 找所有连通分量，孤立节点单独成组排在最后 */
function findConnectedComponents(nodes: GraphNode[], edges: GraphEdge[]): string[][] {
  const adj = new Map<string, Set<string>>()
  for (const n of nodes) adj.set(n.id, new Set())
  for (const e of edges) {
    adj.get(e.source)?.add(e.target)
    adj.get(e.target)?.add(e.source)
  }

  const visited = new Set<string>()
  const connected: string[][] = []
  const isolated: string[] = []

  for (const n of nodes) {
    if (visited.has(n.id)) continue
    const neighbors = adj.get(n.id)
    if (!neighbors || neighbors.size === 0) {
      isolated.push(n.id)
      visited.add(n.id)
      continue
    }
    const component: string[] = []
    const queue = [n.id]
    visited.add(n.id)
    while (queue.length > 0) {
      const cur = queue.shift()!
      component.push(cur)
      for (const nb of adj.get(cur) || []) {
        if (!visited.has(nb)) {
          visited.add(nb)
          queue.push(nb)
        }
      }
    }
    connected.push(component)
  }

  if (isolated.length > 0) connected.push(isolated)
  return connected
}

/** 对单个连通分量做拓扑分层布局 */
function layoutComponent(
  nodes: GraphNode[],
  edges: GraphEdge[]
): Map<string, { x: number; y: number }> {
  const result = new Map<string, { x: number; y: number }>()

  // 孤立节点组：网格排列
  if (edges.length === 0) {
    const cols = Math.max(1, Math.ceil(Math.sqrt(nodes.length)))
    for (let i = 0; i < nodes.length; i++) {
      const col = i % cols
      const row = Math.floor(i / cols)
      const { w, h } = getNodeSize(nodes[i].type)
      result.set(nodes[i].id, {
        x: col * (w + H_GAP),
        y: row * (h + V_GAP)
      })
    }
    return result
  }

  // 有向图拓扑分层
  const nodeSet = new Set(nodes.map(n => n.id))
  const inDegree = new Map<string, number>()
  const outEdges = new Map<string, string[]>()
  for (const n of nodes) {
    inDegree.set(n.id, 0)
    outEdges.set(n.id, [])
  }
  for (const e of edges) {
    if (!nodeSet.has(e.source) || !nodeSet.has(e.target)) continue
    inDegree.set(e.target, (inDegree.get(e.target) || 0) + 1)
    outEdges.get(e.source)!.push(e.target)
  }

  const levels: string[][] = []
  const assigned = new Set<string>()

  let current = nodes.filter(n => (inDegree.get(n.id) || 0) === 0).map(n => n.id)
  if (current.length === 0) current = [nodes[0].id]

  while (current.length > 0) {
    levels.push(current)
    current.forEach(id => assigned.add(id))
    const next: string[] = []
    for (const id of current) {
      for (const target of outEdges.get(id) || []) {
        if (!assigned.has(target) && !next.includes(target)) {
          next.push(target)
        }
      }
    }
    current = next
  }

  const unassigned = nodes.filter(n => !assigned.has(n.id)).map(n => n.id)
  if (unassigned.length > 0) levels.push(unassigned)

  // 按层计算 x（考虑每层最宽节点）
  const nodeById = new Map(nodes.map(n => [n.id, n]))
  let x = 0
  for (const level of levels) {
    let maxW = 0
    let totalH = 0
    const sizes = level.map(id => {
      const s = getNodeSize(nodeById.get(id)!.type)
      maxW = Math.max(maxW, s.w)
      totalH += s.h
      return s
    })
    totalH += (level.length - 1) * V_GAP

    // 垂直居中
    let y = -totalH / 2
    for (let i = 0; i < level.length; i++) {
      result.set(level[i], { x, y })
      y += sizes[i].h + V_GAP
    }

    x += maxW + H_GAP
  }

  // 归一化：让最小 y 从 0 开始
  let minY = Infinity
  for (const pos of result.values()) minY = Math.min(minY, pos.y)
  if (minY !== 0) {
    for (const pos of result.values()) pos.y -= minY
  }

  return result
}
