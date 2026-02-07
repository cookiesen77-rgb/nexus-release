/**
 * Context Builder | 上下文工程（GSSC：Gather-Select-Structure-Compress）
 * 目标：在有限上下文窗口中，优先保留最相关的信息，避免“上下文腐蚀”
 */

const normalizeText = (text) => String(text || '').replace(/\r\n/g, '\n').trim()

const clamp = (n, a, b) => Math.max(a, Math.min(b, n))

const takeLast = (arr, n) => arr.slice(Math.max(0, arr.length - n))

const estimateChars = (messages) => messages.reduce((sum, m) => sum + (m?.content ? String(m.content).length : 0), 0)

const compactLines = (lines, maxChars) => {
  const out = []
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

export const buildChatMessages = ({
  userText,
  systemPrompt,
  conversation = [],
  memory = { summary: '', items: [] },
  canvasContext = '',
  config = {}
}) => {
  const userQuery = normalizeText(userText)
  const sys = normalizeText(systemPrompt)

  const maxChars = clamp(Number(config.maxChars || 12000), 2000, 50000)
  const maxHistory = clamp(Number(config.maxHistory || 16), 4, 64)
  const maxMemoryItems = clamp(Number(config.maxMemoryItems || 6), 0, 30)
  const maxCanvasChars = clamp(Number(config.maxCanvasChars || 1200), 0, 8000)
  const maxMemoryChars = clamp(Number(config.maxMemoryChars || 1200), 0, 8000)
  const maxSummaryChars = clamp(Number(config.maxSummaryChars || 600), 0, 4000)

  // Gather
  const packets = []

  if (sys) {
    packets.push({ kind: 'system', score: 1, text: sys })
  }

  const memSummary = normalizeText(memory?.summary || '')
  if (memSummary && maxSummaryChars > 0) {
    packets.push({
      kind: 'memory_summary',
      score: 0.9,
      text: `【长期记忆摘要】\n${memSummary.slice(0, maxSummaryChars)}`
    })
  }

  const memItems = Array.isArray(memory?.items) ? memory.items : []
  if (memItems.length > 0 && maxMemoryItems > 0 && maxMemoryChars > 0) {
    const lines = memItems.slice(0, maxMemoryItems).map((m) => `- ${normalizeText(m?.content || '').slice(0, 260)}`)
    const packed = compactLines(lines, maxMemoryChars)
    if (packed) {
      packets.push({
        kind: 'memory_items',
        score: 0.85,
        text: `【长期记忆（检索命中）】\n${packed}`
      })
    }
  }

  const canvas = normalizeText(canvasContext)
  if (canvas && maxCanvasChars > 0) {
    packets.push({
      kind: 'canvas',
      score: 0.75,
      text: `【当前项目上下文】\n${canvas.slice(0, maxCanvasChars)}`
    })
  }

  const history = takeLast(conversation.filter(m => m?.role && m.role !== 'system'), maxHistory)
  for (let i = 0; i < history.length; i++) {
    const m = history[i]
    const recencyScore = (i + 1) / history.length
    packets.push({
      kind: 'history',
      score: 0.55 + recencyScore * 0.25,
      role: m.role,
      text: normalizeText(m.content)
    })
  }

  // Select: 按 score 取最重要的“系统块”，历史保持顺序
  const systemBlocks = packets.filter(p => p.kind !== 'history').sort((a, b) => b.score - a.score)
  const historyBlocks = packets.filter(p => p.kind === 'history')

  // Structure
  const out = []
  if (sys) out.push({ role: 'system', content: sys })

  // 先塞系统增强块（记忆/项目），再塞历史，最后用户输入
  for (const p of systemBlocks) {
    if (p.kind === 'system') continue
    if (!p.text) continue
    out.push({ role: 'system', content: p.text })
  }

  for (const p of historyBlocks) {
    if (!p.text) continue
    out.push({ role: p.role, content: p.text })
  }

  out.push({ role: 'user', content: userQuery })

  // Compress：超预算则逐步削减（先砍历史，再砍系统块内容）
  let total = estimateChars(out)
  if (total <= maxChars) return out

  // 1) 历史只留最后 N/2
  const keepHistory = clamp(Math.floor(maxHistory / 2), 2, maxHistory)
  const reducedHistory = takeLast(history, keepHistory).map(m => ({ role: m.role, content: normalizeText(m.content) }))
  const base = []
  if (sys) base.push({ role: 'system', content: sys })
  for (const p of systemBlocks) {
    if (p.kind === 'system') continue
    if (!p.text) continue
    base.push({ role: 'system', content: p.text })
  }
  base.push(...reducedHistory)
  base.push({ role: 'user', content: userQuery })
  total = estimateChars(base)
  if (total <= maxChars) return base

  // 2) 再压缩系统增强块：只保留“摘要/项目”各一段并截断
  const compressed = []
  if (sys) compressed.push({ role: 'system', content: sys })

  const pick = (kind) => systemBlocks.find(p => p.kind === kind)?.text || ''
  const mem = pick('memory_summary') || pick('memory_items')
  const canv = pick('canvas')
  if (mem) compressed.push({ role: 'system', content: mem.slice(0, Math.min(maxSummaryChars, 360)) })
  if (canv) compressed.push({ role: 'system', content: canv.slice(0, 360) })
  compressed.push(...takeLast(reducedHistory, 6))
  compressed.push({ role: 'user', content: userQuery })
  total = estimateChars(compressed)

  if (total <= maxChars) return compressed

  // 3) 最终兜底：只保留 system + 用户问题
  const minimal = []
  if (sys) minimal.push({ role: 'system', content: sys })
  minimal.push({ role: 'user', content: userQuery })
  return minimal
}

