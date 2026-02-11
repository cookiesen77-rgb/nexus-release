import type { GraphEdge } from '@/graph/types'

export function getConnectedComponent(
  startNodeId: string,
  edges: GraphEdge[]
): { nodeIds: Set<string>; edgeIds: Set<string> } {
  const adj = new Map<string, Array<{ nodeId: string; edgeId: string }>>()
  for (const e of edges) {
    if (!adj.has(e.source)) adj.set(e.source, [])
    if (!adj.has(e.target)) adj.set(e.target, [])
    adj.get(e.source)!.push({ nodeId: e.target, edgeId: e.id })
    adj.get(e.target)!.push({ nodeId: e.source, edgeId: e.id })
  }

  const nodeIds = new Set<string>()
  const edgeIds = new Set<string>()
  const queue = [startNodeId]
  nodeIds.add(startNodeId)

  while (queue.length > 0) {
    const cur = queue.shift()!
    const neighbors = adj.get(cur) || []
    for (const { nodeId, edgeId } of neighbors) {
      edgeIds.add(edgeId)
      if (!nodeIds.has(nodeId)) {
        nodeIds.add(nodeId)
        queue.push(nodeId)
      }
    }
  }

  return { nodeIds, edgeIds }
}
