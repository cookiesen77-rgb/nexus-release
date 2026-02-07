import type { GraphEdge, GraphNode } from '@/graph/types'
import { tauriInvoke } from '@/lib/tauri'

type PolishMode = 'image' | 'video' | 'script'

type PromptTemplate = {
  source: string
  no?: number
  title: string
  description?: string
  excerpt: string
}

const normalizeText = (text: string) => String(text || '').replace(/\r\n/g, '\n').trim()

const safeSlice = (text: string, maxChars: number) => {
  const t = normalizeText(text)
  if (!t) return ''
  if (t.length <= maxChars) return t
  return `${t.slice(0, maxChars)}…`
}

const tokenize = (text: string) => {
  const t = normalizeText(text).toLowerCase()
  if (!t) return [] as string[]
  const tokens: string[] = []
  const re = /[a-z0-9]+|[\u4e00-\u9fff]{2,}/gi
  let m: RegExpExecArray | null
  while ((m = re.exec(t))) tokens.push(m[0])
  if (tokens.length > 0) return tokens
  const chars = t.match(/[\u4e00-\u9fff]/g)
  return chars ? chars.slice(0, 64) : []
}

const scoreOverlap = (queryTokens: string[], textTokens: string[]) => {
  if (queryTokens.length === 0 || textTokens.length === 0) return 0
  const set = new Set(textTokens)
  let common = 0
  for (const tok of queryTokens) if (set.has(tok)) common++
  return common / Math.sqrt(textTokens.length)
}

let promptLibrariesPromise: Promise<{ baoyu: any[]; nano: any[] }> | null = null
const loadPromptLibraries = async () => {
  if (promptLibrariesPromise) return promptLibrariesPromise
  promptLibrariesPromise = Promise.all([
    import('@/assets/prompt-libraries/baoyu_comic_prompts.json'),
    import('@/assets/prompt-libraries/nano_banana_pro_prompts.json')
  ])
    .then(([baoyu, nano]) => {
      const a = Array.isArray((baoyu as any)?.default) ? (baoyu as any).default : []
      const b = Array.isArray((nano as any)?.default) ? (nano as any).default : []
      return { baoyu: a, nano: b }
    })
    .catch(() => ({ baoyu: [], nano: [] }))
  return promptLibrariesPromise
}

const summarizeTemplatePrompt = (prompt: string) => {
  const t = normalizeText(prompt)
  if (!t) return ''
  const lines = t
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean)
  if (lines.length === 0) return ''
  return safeSlice(lines.slice(0, 18).join('\n'), 900)
}

export const inferPolishModeFromText = (text: string): PolishMode => {
  const t = normalizeText(text)
  if (!t) return 'image'
  if (/视频|运镜|镜头|转场|动起来|动画|vlog|mv/i.test(t)) return 'video'
  if (/剧本|分镜|脚本|对白|旁白|场景|镜头脚本/i.test(t)) return 'script'
  return 'image'
}

export const inferPolishModeFromGraph = (focusNodeId: string | null, nodes: GraphNode[], edges: GraphEdge[]): PolishMode | null => {
  if (!focusNodeId) return null
  const outgoing = (edges || []).filter((e) => e.source === focusNodeId)
  for (const e of outgoing) {
    const t = nodes.find((n) => n.id === e.target)
    if (t?.type === 'videoConfig') return 'video'
    if (t?.type === 'imageConfig') return 'image'
  }
  return null
}

export const selectBestPromptTemplate = async (params: {
  mode: PolishMode
  userText: string
  contextText: string
}) => {
  const libs = await loadPromptLibraries()
  const query = normalizeText([params.userText, params.contextText].filter(Boolean).join('\n'))
  const qTokens = tokenize(query)

  const candidates: {
    source: string
    no?: number
    title: string
    description?: string
    tags: string[]
    prompt: string
    score: number
  }[] = []

  const push = (item: any, source: string) => {
    if (!item) return
    const title = normalizeText(item.title || '')
    const desc = normalizeText(item.description || '')
    const tags = Array.isArray(item.tags) ? item.tags : []
    const hay = `${title}\n${desc}\n${tags.join(' ')}\n${String(item.language || '')}`
    const tTokens = tokenize(hay)
    let score = scoreOverlap(qTokens, tTokens)

    if (params.mode === 'script') {
      if (/分镜|剧本|脚本|storyboard|comic/i.test(hay)) score += 2.0
    } else if (params.mode === 'video') {
      if (/视频|mv|运镜|转场|shot/i.test(hay)) score += 1.6
    } else {
      if (/生图|画面|插画|写实|漫画|分镜|comic/i.test(hay)) score += 1.2
    }

    if (source === 'baoyu') score += 0.6
    if (tags.includes('Featured')) score += 0.4

    candidates.push({
      source,
      no: item.no,
      title: title || `${source}#${item.no || ''}`,
      description: desc,
      tags,
      prompt: String(item.prompt || ''),
      score
    })
  }

  for (const item of libs.baoyu || []) push(item, 'baoyu')
  for (const item of libs.nano || []) push(item, 'nano')

  candidates.sort((a, b) => b.score - a.score)
  const best = candidates.find((c) => c.score > 0.1) || null
  if (!best) return null
  const template: PromptTemplate = {
    source: best.source,
    no: best.no,
    title: best.title,
    description: best.description,
    excerpt: summarizeTemplatePrompt(best.prompt)
  }
  return template
}

const buildIndices = (nodes: GraphNode[], edges: GraphEdge[]) => {
  const nodeById = new Map<string, GraphNode>()
  for (const n of nodes || []) if (n?.id) nodeById.set(n.id, n)

  const incoming = new Map<string, GraphEdge[]>()
  const outgoing = new Map<string, GraphEdge[]>()
  for (const e of edges || []) {
    if (!e?.source || !e?.target) continue
    const inList = incoming.get(e.target) || []
    inList.push(e)
    incoming.set(e.target, inList)
    const outList = outgoing.get(e.source) || []
    outList.push(e)
    outgoing.set(e.source, outList)
  }
  return { nodeById, incoming, outgoing }
}

export const collectUpstreamInputsForFocus = (params: { focusNodeId: string | null; nodes: GraphNode[]; edges: GraphEdge[] }) => {
  const { focusNodeId, nodes, edges } = params
  if (!focusNodeId) return { text: [] as any[], images: [] as any[] }
  const { nodeById, incoming, outgoing } = buildIndices(nodes, edges)
  const focus = nodeById.get(focusNodeId)
  if (!focus) return { text: [] as any[], images: [] as any[] }

  const configTargets = (outgoing.get(focusNodeId) || [])
    .map((e) => nodeById.get(e.target))
    .filter((n) => n && (n.type === 'imageConfig' || n.type === 'videoConfig')) as GraphNode[]

  const textBlocks: any[] = []
  const imageBlocks: any[] = []
  const seenText = new Set<string>()
  const seenImage = new Set<string>()

  for (const cfg of configTargets) {
    const inEdges = incoming.get(cfg.id) || []
    for (const e of inEdges) {
      const src = nodeById.get(e.source)
      if (!src) continue
      if (src.type === 'text') {
        if (src.id === focusNodeId) continue
        const content = normalizeText((src.data as any)?.content || '')
        if (!content) continue
        if (seenText.has(src.id)) continue
        seenText.add(src.id)
        textBlocks.push({
          id: src.id,
          label: normalizeText((src.data as any)?.label) || '文本节点',
          text: safeSlice(content, 520),
          target: cfg.id
        })
      } else if (src.type === 'image') {
        if (seenImage.has(src.id)) continue
        seenImage.add(src.id)
        const role = String((e.data as any)?.imageRole || '').trim()
        const url = String((src.data as any)?.url || '').trim()
        imageBlocks.push({
          id: src.id,
          label: normalizeText((src.data as any)?.label) || '参考图',
          role: role || 'input_reference',
          url: url && !url.startsWith('data:') ? safeSlice(url, 240) : '',
          target: cfg.id
        })
      }
    }
  }

  return { text: textBlocks, images: imageBlocks }
}

export const collectUpstreamInputsForFocusAsync = async (params: {
  focusNodeId: string | null
  nodes: GraphNode[]
  edges: GraphEdge[]
}) => {
  const { focusNodeId, nodes, edges } = params
  if (!focusNodeId) return { text: [] as any[], images: [] as any[] }
  const rust = await tauriInvoke<any>('graph_collect_upstream_inputs', {
    focusNodeId,
    nodes,
    edges
  })
  if (rust && typeof rust === 'object') return rust
  return collectUpstreamInputsForFocus(params)
}

export const buildPolishUserText = (params: {
  mode: PolishMode
  userText: string
  promptTemplate: PromptTemplate | null
  upstreamInputs: { text: any[]; images: any[] }
}) => {
  const lines: string[] = []
  const modeLabel = params.mode === 'video' ? '视频提示词润色' : params.mode === 'script' ? '剧本/分镜润色' : '生图提示词润色'
  lines.push(`【任务】${modeLabel}`)

  if (params.promptTemplate?.title) {
    lines.push('【提示词库（自动挑选的最佳模板，用其结构与要点来润色，不要原样照抄/不要输出 JSON）】')
    lines.push(`- ${params.promptTemplate.title}${params.promptTemplate.source ? `（来源：${params.promptTemplate.source}${params.promptTemplate.no ? `#${params.promptTemplate.no}` : ''}）` : ''}`)
    if (params.promptTemplate.description) lines.push(`- 说明：${safeSlice(params.promptTemplate.description, 180)}`)
    if (params.promptTemplate.excerpt) {
      lines.push('【模板摘录】')
      lines.push(params.promptTemplate.excerpt)
    }
  }

  lines.push('【用户原文】')
  lines.push(params.userText)

  const tList = Array.isArray(params.upstreamInputs?.text) ? params.upstreamInputs.text : []
  const iList = Array.isArray(params.upstreamInputs?.images) ? params.upstreamInputs.images : []
  if (tList.length > 0 || iList.length > 0) {
    lines.push('【同链路上游输入（来自画布连线：其它提示词/参考图）】')
    for (const t of tList.slice(0, 6)) {
      lines.push(`- 文本(${t.id})：${t.label} → 连接到(${t.target})\n${t.text}`)
    }
    for (const im of iList.slice(0, 6)) {
      lines.push(`- 参考图(${im.id})：${im.label}｜role=${im.role} → 连接到(${im.target})${im.url ? `\n${im.url}` : ''}`)
    }
  }

  lines.push('【输出要求】')
  lines.push('- 只输出润色后的最终正文，不要解释、不要 Markdown、不要 JSON')
  lines.push('- 不要引入上下文里不存在的关键信息')
  lines.push('- 不要提问或询问用户')
  return lines.join('\n')
}

/**
 * 构建 AI 润色系统提示词
 * 
 * 【AI 润色功能定位】
 * - 直接对文本进行润色优化，不进行互动询问
 * - 输出中文结果
 * - 保持原意的基础上提升表达质量
 * - 不提问、不解释、不添加额外说明
 * 
 * 【与 AI 助手的区别】
 * - AI 润色：直接输出结果，不互动，不提问
 * - AI 助手：可以提问、澄清、互动对话
 */
export const buildPolishSystemPrompt = (mode: PolishMode) => {
  const base = [
    '你是一个专业的"AI 提示词润色助手"。',
    '',
    '## 核心原则',
    '1. **直接输出**：只输出润色后的最终结果，禁止询问、禁止解释、禁止添加任何额外说明',
    '2. **中文输出**：输出结果必须是中文',
    '3. **保持原意**：在保持用户原意的基础上提升表达质量和专业度',
    '4. **结合上下文**：参考提供的【同链路上游输入】与【提示词库模板】来提高质量与一致性',
    '',
    '## 绝对禁止的行为',
    '- 禁止提问或询问用户任何问题',
    '- 禁止添加"以下是润色结果"、"好的"等开场白',
    '- 禁止添加解释或说明文字',
    '- 禁止输出 JSON 或 Markdown 格式标记',
    ''
  ]
  
  if (mode === 'video') {
    base.push('## 视频提示词润色要点')
    base.push('包含：镜头语言、运镜方式、节奏转场、光影氛围、主体一致性描述')
  } else if (mode === 'image') {
    base.push('## 生图提示词润色要点')
    base.push('包含：主体特征、环境场景、光影效果、构图布局、艺术风格')
  } else if (mode === 'script') {
    base.push('## 分镜/脚本润色要点')
    base.push('包含：镜头划分、场景描述、动作指示、对白旁白、画风一致性')
  }
  
  return base.join('\n')
}
