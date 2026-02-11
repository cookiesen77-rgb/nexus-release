/**
 * runWorkflow / runFromNode — 画布工作流引擎
 *
 * 支持两种执行方式：
 * - runWorkflow()      全画布拓扑排序执行
 * - runFromNode(id)    从指定节点开始级联执行所有下游
 *
 * LLM 节点特性：
 * - 画布上下文感知（自动注入周边节点信息）
 * - 多轮对话历史回放
 * - 上游有 TextSplitter 时自动 fan-out（逐段独立处理，创建文本节点 + 可选 imageConfig）
 * - 指令中含「生图/配图/图片」等关键词时自动为每段创建 imageConfig 节点
 * - 输出分析 + 自动编排下游节点
 *
 * TextSplitter 节点特性：
 * - AI 语义拆分（取代纯正则）
 * - 逐段润色/扩写
 * - AI 失败时自动回退到正则
 */

import { useGraphStore } from '@/graph/store'
import { streamAiAssistant } from '@/lib/nexusApi'
import { buildCanvasContext } from '@/lib/contextEngine'
import { generateImageFromConfigNode } from '@/lib/workflow/image'
import { generateVideoFromConfigNode } from '@/lib/workflow/video'
import type { GraphNode, GraphEdge } from '@/graph/types'
import { CHAT_MODELS, DEFAULT_IMAGE_MODEL, IMAGE_MODELS } from '@/config/models'
import { useSettingsStore } from '@/store/settings'

type ExecutableType = 'llm' | 'textSplitter' | 'imageConfig' | 'videoConfig'

const EXECUTABLE_TYPES = new Set<string>(['llm', 'textSplitter', 'imageConfig', 'videoConfig'])
const DEFAULT_LLM_MODEL = (CHAT_MODELS as any[])[0]?.key || 'gemini-3-pro-preview-thinking'
const IMAGE_KEYWORDS = /生图|配图|图片|画面|绘图|illustration|visual|生成图/i
const VIDEO_KEYWORDS = /视频|动画|video|animation|motion/i

function getEffectiveImageModel(): string {
  const userDefault = useSettingsStore.getState().defaultImageModel
  if (userDefault && (IMAGE_MODELS as any[]).some((m: any) => m.key === userDefault)) return userDefault
  return DEFAULT_IMAGE_MODEL
}

// ─── 工具函数 ────────────────────────────────────────────

function parseJsonArray(text: string): string[] {
  const cleaned = text.replace(/```(?:json)?\s*/g, '').replace(/```/g, '').trim()
  const match = cleaned.match(/\[[\s\S]*\]/)
  if (!match) return []
  try {
    const arr = JSON.parse(match[0])
    if (Array.isArray(arr) && arr.every(s => typeof s === 'string')) return arr.filter(Boolean)
    if (Array.isArray(arr)) return arr.map(s => typeof s === 'object' ? JSON.stringify(s) : String(s)).filter(Boolean)
  } catch { /* ignore */ }
  return []
}

function regexFallbackSplit(inputText: string): string[] {
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
  return segments
}

async function streamToString(
  modelKey: string, messages: any[], opts: { signal?: AbortSignal }
): Promise<string> {
  let full = ''
  for await (const chunk of streamAiAssistant(modelKey, messages, { filterThinking: true, signal: opts.signal })) {
    full += chunk
  }
  return full
}

// ─── 拓扑排序 ────────────────────────────────────────────

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

// ─── 输入收集 ────────────────────────────────────────────

function collectInputTextForNode(nodeId: string, nodes: GraphNode[], edges: GraphEdge[]): string {
  const parts: string[] = []
  for (const edge of edges) {
    if (edge.target !== nodeId) continue
    const src = nodes.find(n => n.id === edge.source)
    if (!src) continue
    const d = src.data as any
    if (src.type === 'text' && d?.content) parts.push(String(d.content))
    else if (src.type === 'llm' && d?.output) parts.push(String(d.output))
    else if (src.type === 'textSplitter' && d?.output) parts.push(String(d.output))
  }
  return parts.join('\n\n')
}

function collectSegmentsFromSplitter(nodeId: string, nodes: GraphNode[], edges: GraphEdge[]): string[] {
  for (const edge of edges) {
    if (edge.target !== nodeId) continue
    const src = nodes.find(n => n.id === edge.source)
    if (src?.type !== 'textSplitter') continue

    const segments: string[] = []
    for (const de of edges) {
      if (de.source !== src.id || de.target === nodeId) continue
      const tn = nodes.find(n => n.id === de.target)
      if (tn?.type === 'text') {
        const c = (tn.data as any)?.content
        if (c) segments.push(String(c))
      }
    }
    if (segments.length > 0) return segments
  }
  return []
}

// ─── LLM 执行 ───────────────────────────────────────────

async function executeLlmNode(
  node: GraphNode, nodes: GraphNode[], edges: GraphEdge[], signal?: AbortSignal
): Promise<void> {
  const d = node.data as any
  const model = d?.model || DEFAULT_LLM_MODEL
  const instruction = String(d?.instruction || '').trim()

  // fan-out：上游 TextSplitter 有多段
  const segments = collectSegmentsFromSplitter(node.id, nodes, edges)
  if (segments.length >= 1) {
    await executeLlmFanOut(node, segments, instruction, model, signal)
    return
  }

  const inputText = collectInputTextForNode(node.id, nodes, edges)
  if (!inputText && !instruction) return

  useGraphStore.getState().updateNode(node.id, { data: { status: 'running', output: '', errorMessage: '' } })

  const messages: any[] = []
  if (instruction) messages.push({ role: 'system', content: instruction })

  // 画布上下文注入
  if (d?.enableContext !== false) {
    const ctx = buildCanvasContext({ nodes, edges, selectedNodeId: node.id })
    if (ctx) messages.push({ role: 'system', content: `【画布上下文】\n${ctx}` })
  }

  // 多轮对话历史回放
  const history = Array.isArray(d?.history) ? d.history : []
  for (const h of history) {
    if (h?.role && h?.content) messages.push({ role: h.role, content: h.content })
  }

  messages.push({ role: 'user', content: inputText || instruction })

  let full = ''
  let lastFlush = 0
  try {
    for await (const chunk of streamAiAssistant(model, messages, { filterThinking: true, signal })) {
      full += chunk
      const now = Date.now()
      if (now - lastFlush > 300) {
        lastFlush = now
        useGraphStore.getState().patchNodeDataSilent(node.id, { output: full })
      }
    }
    useGraphStore.getState().updateNode(node.id, { data: { output: full, status: 'done' } })
  } catch (err: any) {
    if (signal?.aborted) {
      useGraphStore.getState().updateNode(node.id, {
        data: { output: full || '', status: full ? 'done' : 'idle' }
      })
      return
    }
    throw err
  }

  // 自动编排
  if (d?.autoOrchestrate) {
    orchestrateFromOutput(node, full, instruction)
  }
}

/** fan-out：对每段独立调用 LLM，为每段创建文本节点 + 可选 imageConfig */
async function executeLlmFanOut(
  node: GraphNode, segments: string[], instruction: string, model: string, signal?: AbortSignal
): Promise<void> {
  const store = useGraphStore.getState()
  store.updateNode(node.id, { data: { status: 'running', output: '', errorMessage: '' } })

  const hasCreatedNodes = store.edges
    .filter(e => e.source === node.id)
    .some(e => {
      const t = store.nodes.find(n => n.id === e.target)
      return t?.type === 'text'
    })
  if (hasCreatedNodes) {
    store.updateNode(node.id, { data: { status: 'done' } })
    return
  }

  const thisNode = store.nodes.find(n => n.id === node.id)
  if (!thisNode) return

  const wantsImage = IMAGE_KEYWORDS.test(instruction)
  const baseX = thisNode.x + 420
  const baseY = thisNode.y
  const yGap = wantsImage ? 260 : 180

  let combinedOutput = ''

  for (let i = 0; i < segments.length; i++) {
    if (signal?.aborted) break

    useGraphStore.getState().patchNodeDataSilent(node.id, {
      output: `[${i + 1}/${segments.length}] 处理中...`
    })

    const messages: any[] = []
    if (instruction) messages.push({ role: 'system', content: instruction })
    messages.push({ role: 'user', content: segments[i] })

    let full = ''
    let lastFlush = 0
    try {
      for await (const chunk of streamAiAssistant(model, messages, { filterThinking: true, signal })) {
        full += chunk
        const now = Date.now()
        if (now - lastFlush > 300) {
          lastFlush = now
          useGraphStore.getState().patchNodeDataSilent(node.id, {
            output: `[${i + 1}/${segments.length}]\n${full.slice(-300)}`
          })
        }
      }
    } catch (err: any) {
      if (signal?.aborted) break
      throw err
    }

    combinedOutput += full + '\n\n'

    const s = useGraphStore.getState()
    s.withBatchUpdates(() => {
      const textId = s.addNode('text', { x: baseX, y: baseY + i * yGap }, {
        label: `分镜 ${i + 1}`,
        content: full
      })
      s.addEdge(node.id, textId, { sourceHandle: 'right', targetHandle: 'left' })

      if (wantsImage) {
        const imgModel = getEffectiveImageModel()
        const baseCfg = (IMAGE_MODELS as any[]).find((m: any) => m.key === imgModel) || (IMAGE_MODELS as any[])[0]
        const cfgData: Record<string, unknown> = { label: `生图 ${i + 1}`, model: imgModel }
        if (baseCfg?.defaultParams?.size) cfgData.size = baseCfg.defaultParams.size
        if (baseCfg?.defaultParams?.quality) cfgData.quality = baseCfg.defaultParams.quality

        const cfgId = s.addNode('imageConfig', { x: baseX + 300, y: baseY + i * yGap }, cfgData)
        s.addEdge(textId, cfgId, { sourceHandle: 'right', targetHandle: 'left' })
      }
    })
  }

  useGraphStore.getState().updateNode(node.id, {
    data: { output: combinedOutput.trim() || '已中断', status: combinedOutput ? 'done' : 'idle' }
  })
}

// ─── LLM 自动编排 ──────────────────────────────────────

function orchestrateFromOutput(node: GraphNode, output: string, instruction: string): void {
  if (!output || output.length < 20) return

  let segments: string[] = []

  // 尝试解析 JSON 数组
  segments = parseJsonArray(output)

  // 尝试解析编号列表
  if (segments.length < 2) {
    const numbered = output.match(/(?:^|\n)\s*\d+[.、)]\s*.+/g)
    if (numbered && numbered.length >= 3) {
      segments = numbered.map(s => s.replace(/^\s*\d+[.、)]\s*/, '').trim()).filter(Boolean)
    }
  }

  if (segments.length < 2) return

  const combined = instruction + '\n' + output
  if (!IMAGE_KEYWORDS.test(combined) && !VIDEO_KEYWORDS.test(combined)) return

  const store = useGraphStore.getState()
  const thisNode = store.nodes.find(n => n.id === node.id)
  if (!thisNode) return

  const hasDownstream = store.edges.some(e =>
    e.source === node.id && store.nodes.find(n => n.id === e.target)?.type === 'text'
  )
  if (hasDownstream) return

  const wantsImage = IMAGE_KEYWORDS.test(combined)
  const wantsVideo = VIDEO_KEYWORDS.test(combined)
  const baseX = thisNode.x + 420
  const baseY = thisNode.y
  const yGap = wantsImage ? 260 : 180

  store.withBatchUpdates(() => {
    for (let i = 0; i < segments.length; i++) {
      const textId = store.addNode('text', { x: baseX, y: baseY + i * yGap }, {
        label: `段落 ${i + 1}`, content: segments[i]
      })
      store.addEdge(node.id, textId, { sourceHandle: 'right', targetHandle: 'left' })

      if (wantsImage) {
        const imgModel = getEffectiveImageModel()
        const cfgId = store.addNode('imageConfig', { x: baseX + 300, y: baseY + i * yGap }, {
          label: `生图 ${i + 1}`, model: imgModel
        })
        store.addEdge(textId, cfgId, { sourceHandle: 'right', targetHandle: 'left' })

        if (wantsVideo) {
          const vidId = store.addNode('videoConfig', { x: baseX + 600, y: baseY + i * yGap }, {
            label: `视频 ${i + 1}`
          })
          store.addEdge(cfgId, vidId, { sourceHandle: 'right', targetHandle: 'left' })
        }
      }
    }
  })
}

// ─── TextSplitter AI 执行 ───────────────────────────────

const SPLIT_SYSTEM_PROMPT = `你是文本拆分专家。根据用户的拆分指令将输入文本拆分为多个独立片段。
仅返回 JSON 数组，每个元素是一个字符串片段。不要添加任何解释、不要输出 Markdown。
示例输出格式：["片段一的完整内容", "片段二的完整内容", "片段三的完整内容"]`

async function executeTextSplitterNode(
  node: GraphNode, nodes: GraphNode[], edges: GraphEdge[], signal?: AbortSignal
): Promise<void> {
  const store = useGraphStore.getState()
  const inputText = collectInputTextForNode(node.id, nodes, edges)
  if (!inputText.trim()) return

  const d = node.data as any
  const model = d?.model || DEFAULT_LLM_MODEL
  const instruction = String(d?.instruction || '按分镜拆分，每段一个镜头').trim()
  const enablePolish = d?.enablePolish !== false

  store.updateNode(node.id, { data: { status: 'running', phase: 'splitting', phaseProgress: '', errorMessage: '' } })

  // Phase 1: AI 语义拆分
  let segments: string[]
  try {
    const raw = await streamToString(model, [
      { role: 'system', content: SPLIT_SYSTEM_PROMPT },
      { role: 'user', content: `拆分指令：${instruction}\n\n输入文本：\n${inputText}` }
    ], { signal })

    segments = parseJsonArray(raw)
    if (segments.length === 0) segments = regexFallbackSplit(inputText)
  } catch (err: any) {
    if (signal?.aborted) {
      store.updateNode(node.id, { data: { status: 'idle', phase: '' } })
      return
    }
    segments = regexFallbackSplit(inputText)
  }

  if (segments.length === 0) segments = [inputText.trim()]

  // Phase 2: 逐段润色
  if (enablePolish && segments.length > 1) {
    store.patchNodeDataSilent(node.id, { phase: 'polishing', phaseProgress: `0/${segments.length}` })

    for (let i = 0; i < segments.length; i++) {
      if (signal?.aborted) break
      store.patchNodeDataSilent(node.id, { phaseProgress: `${i + 1}/${segments.length}` })

      try {
        const polished = await streamToString(model, [
          { role: 'system', content: `你是专业的提示词润色助手。润色和完善以下文本，保持原意，提升表达质量和细节丰富度。直接输出润色结果，不要解释。` },
          { role: 'user', content: segments[i] }
        ], { signal })
        if (polished.trim()) segments[i] = polished.trim()
      } catch {
        // 润色失败保留原文
      }
    }
  }

  // 创建下游节点
  const thisNode = store.nodes.find(n => n.id === node.id)
  if (!thisNode) return

  const existingTextNodes = edges
    .filter(e => e.source === node.id)
    .map(e => nodes.find(n => n.id === e.target))
    .filter(n => n?.type === 'text')
  if (existingTextNodes.length > 0) {
    store.updateNode(node.id, { data: { status: 'done', splitCount: existingTextNodes.length, phase: '' } })
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

  store.updateNode(node.id, { data: { status: 'done', splitCount: segments.length, phase: '' } })
}

// ─── 执行引擎 ───────────────────────────────────────────

export type WorkflowProgress = {
  total: number
  completed: number
  current: string
  running: boolean
}

async function executeNodes(
  sorted: GraphNode[],
  signal?: AbortSignal,
  onProgress?: (p: WorkflowProgress) => void
): Promise<void> {
  const total = sorted.length
  let completed = 0

  for (const node of sorted) {
    if (signal?.aborted) break
    onProgress?.({ total, completed, current: node.type, running: true })

    try {
      const fresh = useGraphStore.getState()
      if (node.type === 'llm') {
        await executeLlmNode(node, fresh.nodes, fresh.edges, signal)
      } else if (node.type === 'textSplitter') {
        await executeTextSplitterNode(node, fresh.nodes, fresh.edges, signal)
      } else if (node.type === 'imageConfig') {
        await generateImageFromConfigNode(node.id)
      } else if (node.type === 'videoConfig') {
        await generateVideoFromConfigNode(node.id)
      }
    } catch (err: any) {
      if (signal?.aborted) break
      useGraphStore.getState().updateNode(node.id, {
        data: { status: 'error', errorMessage: err?.message || '执行失败' }
      })
    }

    completed++
    onProgress?.({ total, completed, current: node.type, running: true })
  }

  onProgress?.({ total, completed: total, current: '', running: false })
}

/** 执行整个画布 */
export async function runWorkflow(
  onProgress?: (p: WorkflowProgress) => void
): Promise<void> {
  const { nodes, edges } = useGraphStore.getState()
  const sorted = topoSort(nodes, edges)

  if (sorted.length === 0) {
    window.$message?.warning?.('画布中没有可执行的节点')
    return
  }

  await executeNodes(sorted, undefined, onProgress)
}

/** 从指定节点开始级联执行所有下游可执行节点 */
export async function runFromNode(
  startNodeId: string,
  options?: { signal?: AbortSignal; onProgress?: (p: WorkflowProgress) => void }
): Promise<void> {
  const { nodes, edges } = useGraphStore.getState()
  const nodeMap = new Map(nodes.map(n => [n.id, n]))

  const visited = new Set<string>()
  const queue = [startNodeId]
  const reachableIds = new Set<string>()

  while (queue.length > 0) {
    const id = queue.shift()!
    if (visited.has(id)) continue
    visited.add(id)

    const node = nodeMap.get(id)
    if (node && EXECUTABLE_TYPES.has(node.type)) {
      reachableIds.add(id)
    }

    for (const e of edges) {
      if (e.source === id && !visited.has(e.target)) {
        queue.push(e.target)
      }
    }
  }

  const reachable = nodes.filter(n => reachableIds.has(n.id))
  const sorted = topoSort(reachable, edges)
  if (sorted.length === 0) return

  await executeNodes(sorted, options?.signal, options?.onProgress)
}
