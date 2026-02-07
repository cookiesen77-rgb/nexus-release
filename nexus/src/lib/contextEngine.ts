import { tauriInvoke } from '@/lib/tauri'
import type { MemoryItem } from '@/lib/memory'
import type { GraphEdge, GraphNode } from '@/graph/types'

export type ChatMessage = { role: string; content: string }

export type ContextConfig = {
  maxChars?: number
  maxHistory?: number
  maxMemoryItems?: number
  maxCanvasChars?: number
  maxMemoryChars?: number
  maxSummaryChars?: number
}

const normalizeText = (text: string) => String(text || '').replace(/\r\n/g, '\n').trim()

const clamp = (n: number, a: number, b: number) => Math.max(a, Math.min(b, n))

const takeLast = <T,>(arr: T[], n: number) => arr.slice(Math.max(0, arr.length - n))

const estimateChars = (messages: ChatMessage[]) => messages.reduce((sum, m) => sum + (m?.content ? String(m.content).length : 0), 0)

const compactLines = (lines: string[], maxChars: number) => {
  const out: string[] = []
  let used = 0
  for (const line of lines) {
    const t = normalizeText(line)
    if (!t) continue
    if (used + t.length > maxChars) break
    out.push(t)
    used += t.length
  }
  return out.join('\n')
}

export const buildChatMessages = async (params: {
  userText: string
  systemPrompt: string
  conversation: ChatMessage[]
  memorySummary: string
  memoryItems: MemoryItem[]
  canvasContext: string
  config?: ContextConfig
}) => {
  const userText = normalizeText(params.userText)
  const systemPrompt = normalizeText(params.systemPrompt)

  const tauri = await tauriInvoke<ChatMessage[]>('build_chat_messages', {
    userText,
    systemPrompt,
    conversation: params.conversation || [],
    memorySummary: params.memorySummary || '',
    memoryItems: params.memoryItems || [],
    canvasContext: params.canvasContext || '',
    config: params.config || null
  })
  if (tauri && Array.isArray(tauri) && tauri.length > 0) return tauri

  const maxChars = clamp(Number(params.config?.maxChars || 12000), 2000, 50000)
  const maxHistory = clamp(Number(params.config?.maxHistory || 16), 4, 64)
  const maxMemoryItems = clamp(Number(params.config?.maxMemoryItems || 6), 0, 30)
  const maxCanvasChars = clamp(Number(params.config?.maxCanvasChars || 1200), 0, 8000)
  const maxMemoryChars = clamp(Number(params.config?.maxMemoryChars || 1200), 0, 8000)
  const maxSummaryChars = clamp(Number(params.config?.maxSummaryChars || 600), 0, 4000)

  const out: ChatMessage[] = []
  if (systemPrompt) out.push({ role: 'system', content: systemPrompt })

  const memSummary = normalizeText(params.memorySummary || '')
  if (memSummary && maxSummaryChars > 0) {
    out.push({ role: 'system', content: `【长期记忆摘要】\n${memSummary.slice(0, maxSummaryChars)}` })
  }

  const memItems = Array.isArray(params.memoryItems) ? params.memoryItems : []
  if (memItems.length > 0 && maxMemoryItems > 0 && maxMemoryChars > 0) {
    const lines = memItems.slice(0, maxMemoryItems).map((m) => `- ${normalizeText(m?.content || '').slice(0, 260)}`)
    const packed = compactLines(lines, maxMemoryChars)
    if (packed) out.push({ role: 'system', content: `【长期记忆（检索命中）】\n${packed}` })
  }

  const canvas = normalizeText(params.canvasContext || '')
  if (canvas && maxCanvasChars > 0) out.push({ role: 'system', content: `【当前项目上下文】\n${canvas.slice(0, maxCanvasChars)}` })

  const history = takeLast(
    (params.conversation || []).filter((m) => m?.role && m.role !== 'system' && normalizeText(m.content)),
    maxHistory
  )
  for (const m of history) out.push({ role: m.role, content: normalizeText(m.content) })
  out.push({ role: 'user', content: userText })

  if (estimateChars(out) <= maxChars) return out

  const keepHistory = clamp(Math.floor(maxHistory / 2), 2, maxHistory)
  const reducedHistory = takeLast(history, keepHistory).map((m) => ({ role: m.role, content: normalizeText(m.content) }))
  const base: ChatMessage[] = []
  if (systemPrompt) base.push({ role: 'system', content: systemPrompt })
  if (memSummary) base.push({ role: 'system', content: `【长期记忆摘要】\n${memSummary.slice(0, Math.min(maxSummaryChars, 360))}` })
  if (canvas) base.push({ role: 'system', content: `【当前项目上下文】\n${canvas.slice(0, 360)}` })
  base.push(...reducedHistory)
  base.push({ role: 'user', content: userText })

  if (estimateChars(base) <= maxChars) return base

  const minimal: ChatMessage[] = []
  if (systemPrompt) minimal.push({ role: 'system', content: systemPrompt })
  minimal.push({ role: 'user', content: userText })
  return minimal
}

const safeStringify = (v: unknown) => {
  try {
    // 避免把大段 dataURL/base64/超长文本完整 stringify（会非常慢，也会污染上下文）
    return JSON.stringify(v, (_k, value) => {
      if (typeof value === 'string') {
        const s = value
        const len = s.length
        if (len > 120000) return `<<omitted string: ${len} chars>>`
        if (s.startsWith('data:') && len > 200) return `data:<<omitted ${len} chars>>`
        if (s.startsWith('blob:') && len > 200) return `blob:<<omitted ${len} chars>>`
        if (len > 800) return `${s.slice(0, 260)}…<<omitted ${len - 260} chars>>`
      }
      return value
    })
  } catch {
    return ''
  }
}

export const buildCanvasContext = (params: {
  nodes: GraphNode[]
  edges: GraphEdge[]
  selectedNodeId?: string | null
}) => {
  const nodes = params.nodes || []
  const edges = params.edges || []
  const selectedNodeId = params.selectedNodeId || null

  if (nodes.length === 0) return ''

  const byId = new Map<string, GraphNode>()
  for (const n of nodes) byId.set(n.id, n)

  const incomingByTarget = new Map<string, string[]>()
  for (const e of edges) {
    if (!e.source || !e.target) continue
    const list = incomingByTarget.get(e.target) || []
    list.push(e.source)
    incomingByTarget.set(e.target, list)
  }

  const focusId = selectedNodeId && byId.has(selectedNodeId) ? selectedNodeId : nodes[0].id
  const focus = byId.get(focusId) || nodes[0]

  const picked: string[] = []
  const queue: { id: string; depth: number }[] = [{ id: focus.id, depth: 0 }]
  const seen = new Set<string>()
  const maxDepth = 2
  const maxNodes = 12

  while (queue.length > 0 && picked.length < maxNodes) {
    const cur = queue.shift()!
    if (seen.has(cur.id)) continue
    seen.add(cur.id)
    picked.push(cur.id)
    if (cur.depth >= maxDepth) continue
    const parents = incomingByTarget.get(cur.id) || []
    for (const pid of parents) queue.push({ id: pid, depth: cur.depth + 1 })
  }

  const lines: string[] = []
  lines.push(`画布概览：${nodes.length} 个节点，${edges.length} 条连线`)
  lines.push(`当前焦点节点：${focus.id} (${focus.type})`)

  for (const id of picked) {
    const n = byId.get(id)
    if (!n) continue
    const label = typeof (n.data as any)?.label === 'string' ? (n.data as any).label : ''
    const hint = label ? ` label="${label}"` : ''
    const data = safeStringify(n.data || {})
    lines.push(`- ${n.id} type=${n.type}${hint} x=${Math.round(n.x)} y=${Math.round(n.y)} data=${data.slice(0, 260)}`)
  }

  return lines.join('\n')
}

