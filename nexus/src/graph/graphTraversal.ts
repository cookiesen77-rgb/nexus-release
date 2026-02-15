import type { GraphEdge } from '@/graph/types'

let cachedEdgesRef: GraphEdge[] | null = null
let cachedAdj: Map<string, Array<{ nodeId: string; edgeId: string }>> | null = null
let cachedComponents = new Map<string, { nodeIds: Set<string>; edgeIds: Set<string> }>()

function getAdj(edges: GraphEdge[]) {
  if (edges === cachedEdgesRef && cachedAdj) return cachedAdj
  cachedEdgesRef = edges
  cachedComponents = new Map()
  const adj = new Map<string, Array<{ nodeId: string; edgeId: string }>>()
  for (const e of edges) {
    if (!adj.has(e.source)) adj.set(e.source, [])
    if (!adj.has(e.target)) adj.set(e.target, [])
    adj.get(e.source)!.push({ nodeId: e.target, edgeId: e.id })
    adj.get(e.target)!.push({ nodeId: e.source, edgeId: e.id })
  }
  cachedAdj = adj
  return adj
}

export function getConnectedComponent(
  startNodeId: string,
  edges: GraphEdge[]
): { nodeIds: Set<string>; edgeIds: Set<string> } {
  const adj = getAdj(edges)

  const cached = cachedComponents.get(startNodeId)
  if (cached) return cached

  const nodeIds = new Set<string>()
  const edgeIds = new Set<string>()
  const queue = [startNodeId]
  nodeIds.add(startNodeId)

  while (queue.length > 0) {
    const cur = queue.shift()!
    for (const { nodeId, edgeId } of (adj.get(cur) || [])) {
      edgeIds.add(edgeId)
      if (!nodeIds.has(nodeId)) {
        nodeIds.add(nodeId)
        queue.push(nodeId)
      }
    }
  }

  const result = { nodeIds, edgeIds }
  for (const nid of nodeIds) cachedComponents.set(nid, result)
  return result
}
