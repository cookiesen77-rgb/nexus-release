/**
 * runWorkflow - 拓扑排序执行整个画布工作流
 *
 * 遍历所有可执行节点（llm, textSplitter, imageConfig, videoConfig），
 * 按拓扑依赖顺序串行执行。
 */

import { useGraphStore } from '@/graph/store'
import { streamAiAssistant } from '@/lib/nexusApi'
import { generateImageFromConfigNode } from '@/lib/workflow/image'
import { generateVideoFromConfigNode } from '@/lib/workflow/video'
import type { GraphNode, GraphEdge } from '@/graph/types'

type ExecutableType = 'llm' | 'textSplitter' | 'imageConfig' | 'videoConfig'

const EXECUTABLE_TYPES = new Set<string>(['llm', 'textSplitter', 'imageConfig', 'videoConfig'])

function topoSort(nodes: GraphNode[], edges: GraphEdge[]): GraphNode[] {
  const execNodes = nodes.filter(n => EXECUTABLE_TYPES.has(n.type))
  const idSet = new Set(execNodes.map(n => n.id))
  const inDeg = new Map<string, number>()
  const adj = new Map<string, string[]>()

  for (const n of execNodes) {
    inDeg.set(n.id, 0)
    adj.set(n.id, [])
  }

  for (const e of edges) {
    if (idSet.has(e.source) && idSet.has(e.target)) {
      adj.get(e.source)!.push(e.target)
      inDeg.set(e.target, (inDeg.get(e.target) || 0) + 1)
    }
  }

  const queue: string[] = []
  for (const [id, deg] of inDeg) {
    if (deg === 0) queue.push(id)
  }

  const sorted: GraphNode[] = []
  const nodeMap = new Map(execNodes.map(n => [n.id, n]))

  while (queue.length > 0) {
    const id = queue.shift()!
    sorted.push(nodeMap.get(id)!)
    for (const next of adj.get(id) || []) {
      const newDeg = (inDeg.get(next) || 1) - 1
      inDeg.set(next, newDeg)
      if (newDeg === 0) queue.push(next)
    }
  }

  return sorted
}

function collectInputTextForNode(nodeId: string, nodes: GraphNode[], edges: GraphEdge[]): string {
  const inEdges = edges.filter(e => e.target === nodeId)
  const parts: string[] = []
  for (const edge of inEdges) {
    const src = nodes.find(n => n.id === edge.source)
    if (!src) continue
    if (src.type === 'text') {
      const c = (src.data as any)?.content
      if (c) parts.push(String(c))
    } else if (src.type === 'llm') {
      const o = (src.data as any)?.output
      if (o) parts.push(String(o))
    }
  }
  return parts.join('\n\n')
}

async function executeLlmNode(node: GraphNode, nodes: GraphNode[], edges: GraphEdge[]): Promise<void> {
  const store = useGraphStore.getState()
  const d = node.data as any
  const model = d?.model || 'gemini-3-pro-preview-thinking'
  const instruction = String(d?.instruction || '').trim()
  const inputText = collectInputTextForNode(node.id, nodes, edges)

  if (!inputText && !instruction) return

  store.updateNode(node.id, { data: { status: 'running', output: '', errorMessage: '' } })

  const messages: any[] = []
  if (instruction) messages.push({ role: 'system', content: instruction })
  messages.push({ role: 'user', content: inputText || instruction })

  let full = ''
  for await (const chunk of streamAiAssistant(model, messages, { filterThinking: true })) {
    full += chunk
  }

  store.updateNode(node.id, { data: { output: full, status: 'done' } })
}

function executeTextSplitterNode(node: GraphNode, nodes: GraphNode[], edges: GraphEdge[]): void {
  const store = useGraphStore.getState()
  const inputText = collectInputTextForNode(node.id, nodes, edges)
  if (!inputText.trim()) return

  store.updateNode(node.id, { data: { status: 'running' } })

  let segments: string[]
  const shotRegex = /\[SHOT\s+\d+\/\d+\]/gi
  if (shotRegex.test(inputText)) {
    segments = inputText.split(/(?=\[SHOT\s+\d+\/\d+\])/gi).map(s => s.trim()).filter(Boolean)
  } else if (inputText.trim().startsWith('[')) {
    try {
      const arr = JSON.parse(inputText)
      segments = Array.isArray(arr) && arr.every(s => typeof s === 'string') ? arr.filter(Boolean) : inputText.split(/\n{2,}/).map(s => s.trim()).filter(Boolean)
    } catch {
      segments = inputText.split(/\n{2,}/).map(s => s.trim()).filter(Boolean)
    }
  } else {
    segments = inputText.split(/\n{2,}/).map(s => s.trim()).filter(Boolean)
  }

  if (segments.length <= 1) {
    segments = inputText.split('\n').map(s => s.trim()).filter(s => s.length > 10)
  }
  if (segments.length === 0) segments = [inputText.trim()]

  const thisNode = store.nodes.find(n => n.id === node.id)
  if (!thisNode) return

  // 检查是否已有下游 text 节点（避免重复创建）
  const existingDownstream = edges.filter(e => e.source === node.id).map(e => e.target)
  if (existingDownstream.length > 0) {
    store.updateNode(node.id, { data: { status: 'done', splitCount: existingDownstream.length } })
    return
  }

  const startX = thisNode.x + 420
  const startY = thisNode.y
  const yGap = 180

  store.withBatchUpdates(() => {
    for (let i = 0; i < segments.length; i++) {
      const newId = store.addNode('text', { x: startX, y: startY + i * yGap }, {
        label: `分镜 ${i + 1}`,
        content: segments[i]
      })
      store.addEdge(node.id, newId, { sourceHandle: 'right', targetHandle: 'left' })
    }
  })

  store.updateNode(node.id, { data: { status: 'done', splitCount: segments.length } })
}

export type WorkflowProgress = {
  total: number
  completed: number
  current: string
  running: boolean
}

export async function runWorkflow(
  onProgress?: (p: WorkflowProgress) => void
): Promise<void> {
  const { nodes, edges } = useGraphStore.getState()
  const sorted = topoSort(nodes, edges)

  if (sorted.length === 0) {
    window.$message?.warning?.('画布中没有可执行的节点')
    return
  }

  const total = sorted.length
  let completed = 0

  for (const node of sorted) {
    onProgress?.({ total, completed, current: node.type, running: true })

    try {
      if (node.type === 'llm') {
        // 每次重新读取最新的 nodes/edges（前面的节点可能创建了新节点）
        const fresh = useGraphStore.getState()
        await executeLlmNode(node, fresh.nodes, fresh.edges)
      } else if (node.type === 'textSplitter') {
        const fresh = useGraphStore.getState()
        executeTextSplitterNode(node, fresh.nodes, fresh.edges)
      } else if (node.type === 'imageConfig') {
        await generateImageFromConfigNode(node.id)
      } else if (node.type === 'videoConfig') {
        await generateVideoFromConfigNode(node.id)
      }
    } catch (err: any) {
      console.error(`[runWorkflow] 节点 ${node.id} (${node.type}) 执行失败:`, err?.message)
      useGraphStore.getState().updateNode(node.id, {
        data: { status: 'error', errorMessage: err?.message || '执行失败' }
      })
    }

    completed++
    onProgress?.({ total, completed, current: node.type, running: true })
  }

  onProgress?.({ total, completed: total, current: '', running: false })
}
