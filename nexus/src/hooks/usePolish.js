/**
 * usePolish | AI 润色（上下文工程 + 轻量检索）
 * - 使用 gpt-5-mini + /v1/responses
 * - 通过画布上下文（节点/连线）增强润色质量，避免“固定套路”
 */

import { ref } from 'vue'
import { chatCompletions, streamChatCompletions } from '@/api'
import { DEFAULT_CHAT_MODEL } from '@/config/models'
import { nodes as canvasNodes, edges as canvasEdges } from '@/stores/canvas'
import cameraMoves from '@/assets/prompt-libraries/chos_camera_moves.json'

const POLISH_MODES = {
  IMAGE: 'image',
  VIDEO: 'video',
  SCRIPT: 'script'
}

const normalizeText = (text) => String(text || '').replace(/\r\n/g, '\n').trim()

const safeSlice = (text, maxChars) => {
  const t = normalizeText(text)
  if (!t) return ''
  if (t.length <= maxChars) return t
  return `${t.slice(0, maxChars)}…`
}

const tokenize = (text) => {
  const t = normalizeText(text).toLowerCase()
  if (!t) return []
  const tokens = []
  const re = /[a-z0-9]+|[\u4e00-\u9fff]{2,}/gi
  let m
  while ((m = re.exec(t))) tokens.push(m[0])
  if (tokens.length > 0) return tokens
  // fallback: single CJK chars
  const chars = t.match(/[\u4e00-\u9fff]/g)
  return chars ? chars.slice(0, 64) : []
}

const scoreOverlap = (queryTokens, textTokens) => {
  if (!Array.isArray(queryTokens) || !Array.isArray(textTokens)) return 0
  if (queryTokens.length === 0 || textTokens.length === 0) return 0
  const set = new Set(textTokens)
  let common = 0
  for (const tok of queryTokens) if (set.has(tok)) common += 1
  return common / Math.sqrt(textTokens.length)
}

let promptLibrariesPromise = null
const loadPromptLibraries = async () => {
  if (promptLibrariesPromise) return promptLibrariesPromise
  promptLibrariesPromise = Promise.all([
    import('@/assets/prompt-libraries/baoyu_comic_prompts.json'),
    import('@/assets/prompt-libraries/nano_banana_pro_prompts.json')
  ]).then(([baoyu, nano]) => {
    const a = Array.isArray(baoyu?.default) ? baoyu.default : []
    const b = Array.isArray(nano?.default) ? nano.default : []
    return { baoyu: a, nano: b }
  }).catch(() => ({ baoyu: [], nano: [] }))
  return promptLibrariesPromise
}

const summarizeTemplatePrompt = (prompt) => {
  const t = normalizeText(prompt)
  if (!t) return ''
  // Avoid pasting huge JSON; keep only a short, high-signal excerpt
  const lines = t.split('\n').map(s => s.trim()).filter(Boolean)
  if (lines.length === 0) return ''
  const head = lines.slice(0, 18).join('\n')
  return safeSlice(head, 900)
}

const selectBestPromptTemplate = async ({ mode, userText, contextBlocks, usageHints }) => {
  const libs = await loadPromptLibraries()
  const query = normalizeText([
    userText,
    (contextBlocks || []).map(b => b?.text).filter(Boolean).join('\n'),
    (usageHints || []).map(h => JSON.stringify(h)).join('\n')
  ].filter(Boolean).join('\n'))
  const qTokens = tokenize(query)

  const candidates = []
  const push = (item, source) => {
    if (!item) return
    const title = normalizeText(item.title || '')
    const desc = normalizeText(item.description || '')
    const tags = Array.isArray(item.tags) ? item.tags : []
    const hay = `${title}\n${desc}\n${tags.join(' ')}\n${String(item.language || '')}`
    const tTokens = tokenize(hay)
    let score = scoreOverlap(qTokens, tTokens)

    // Mode boosts
    const titleLower = title.toLowerCase()
    if (mode === POLISH_MODES.SCRIPT) {
      if (/分镜|剧本|脚本|storyboard|comic/i.test(hay)) score += 2.0
    } else if (mode === POLISH_MODES.VIDEO) {
      if (/视频|mv|运镜|转场|shot/i.test(hay)) score += 1.6
    } else {
      if (/生图|画面|插画|写实|漫画|分镜|comic/i.test(hay)) score += 1.2
    }

    if (source === 'baoyu') score += 0.6
    if (Array.isArray(tags) && tags.includes('Featured')) score += 0.4

    candidates.push({
      source,
      no: item.no,
      title: title || `${source}#${item.no || ''}`,
      description: desc,
      tags,
      prompt: item.prompt || '',
      score
    })
  }

  for (const item of libs.baoyu || []) push(item, 'baoyu')
  for (const item of libs.nano || []) push(item, 'nano')

  candidates.sort((a, b) => b.score - a.score)
  const best = candidates.find(c => c.score > 0.1) || null
  if (!best) return null
  return {
    source: best.source,
    no: best.no,
    title: best.title,
    description: best.description,
    tags: best.tags,
    excerpt: summarizeTemplatePrompt(best.prompt)
  }
}

const buildAdjacency = (edges) => {
  const adj = new Map()
  const add = (a, b) => {
    if (!a || !b) return
    if (!adj.has(a)) adj.set(a, new Set())
    adj.get(a).add(b)
  }
  for (const e of edges || []) {
    add(e.source, e.target)
    add(e.target, e.source)
  }
  return adj
}

const bfsDistances = (startId, edges, maxDepth = 2) => {
  if (!startId) return new Map()
  const adj = buildAdjacency(edges)
  const dist = new Map()
  const q = [{ id: startId, d: 0 }]
  dist.set(startId, 0)

  while (q.length) {
    const { id, d } = q.shift()
    if (d >= maxDepth) continue
    const next = adj.get(id)
    if (!next) continue
    for (const nid of next) {
      if (dist.has(nid)) continue
      dist.set(nid, d + 1)
      q.push({ id: nid, d: d + 1 })
    }
  }

  return dist
}

const isMemoryCandidate = (node) => {
  if (!node || node.type !== 'text') return false
  const label = normalizeText(node.data?.label)
  const content = normalizeText(node.data?.content)
  const hay = `${label}\n${content}`
  return /角色|人物|设定|世界观|画风|风格|bible|统一|禁忌|注意事项|样式|style/i.test(hay)
}

const inferModeFromGraph = (focusNodeId, nodes, edges) => {
  if (!focusNodeId) return null
  const focus = nodes.find(n => n.id === focusNodeId)
  if (!focus) return null

  // 文本节点连接到 imageConfig / videoConfig，优先按用途推断
  const outgoing = (edges || []).filter(e => e.source === focusNodeId)
  for (const e of outgoing) {
    const t = nodes.find(n => n.id === e.target)
    if (t?.type === 'videoConfig') return POLISH_MODES.VIDEO
    if (t?.type === 'imageConfig') return POLISH_MODES.IMAGE
  }
  return null
}

const inferModeFromText = (text) => {
  const t = normalizeText(text)
  if (!t) return POLISH_MODES.IMAGE
  if (/视频|运镜|镜头|转场|动起来|动画|vlog|mv/i.test(t)) return POLISH_MODES.VIDEO
  if (/剧本|分镜|脚本|对白|旁白|场景|镜头脚本/i.test(t)) return POLISH_MODES.SCRIPT
  return POLISH_MODES.IMAGE
}

const buildIndices = (nodes, edges) => {
  const nodeById = new Map()
  for (const n of nodes || []) {
    if (n?.id) nodeById.set(n.id, n)
  }
  const incoming = new Map()
  const outgoing = new Map()
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

const collectUpstreamInputsForFocus = ({ focusNodeId, nodes, edges }) => {
  if (!focusNodeId) return { text: [], images: [] }
  const { nodeById, incoming, outgoing } = buildIndices(nodes, edges)
  const focus = nodeById.get(focusNodeId)
  if (!focus) return { text: [], images: [] }

  // 目标：当润色“提示词文本节点”时，把同一条链路上其它上游输入也带上（包括参考图）
  const configTargets = (outgoing.get(focusNodeId) || [])
    .map(e => nodeById.get(e.target))
    .filter(n => n && (n.type === 'imageConfig' || n.type === 'videoConfig'))

  const textBlocks = []
  const imageBlocks = []
  const seenText = new Set()
  const seenImage = new Set()

  for (const cfg of configTargets) {
    const inEdges = incoming.get(cfg.id) || []
    for (const e of inEdges) {
      const src = nodeById.get(e.source)
      if (!src) continue
      if (src.type === 'text') {
        if (src.id === focusNodeId) continue
        const content = normalizeText(src.data?.content || '')
        if (!content) continue
        if (seenText.has(src.id)) continue
        seenText.add(src.id)
        textBlocks.push({
          id: src.id,
          label: normalizeText(src.data?.label) || '文本节点',
          text: safeSlice(content, 520),
          target: cfg.id
        })
      } else if (src.type === 'image') {
        if (seenImage.has(src.id)) continue
        seenImage.add(src.id)
        const role = e?.data?.imageRole || ''
        const url = String(src.data?.url || '').trim()
        imageBlocks.push({
          id: src.id,
          label: normalizeText(src.data?.label) || '参考图',
          role: role || 'input_reference',
          url: url && !url.startsWith('data:') ? safeSlice(url, 240) : '',
          target: cfg.id
        })
      }
    }
  }

  return { text: textBlocks, images: imageBlocks }
}

const MOOD_HINTS = [
  { key: 'Aggressive', zh: '激烈/紧张', re: /紧张|激烈|追逐|战斗|爆炸|冲突|高能/i },
  { key: 'Gentle', zh: '温柔/抒情', re: /温柔|浪漫|柔和|抒情|梦幻|回忆/i },
  { key: 'Fast', zh: '快速/冲击', re: /快速|节奏快|冲击|炸裂|急促/i },
  { key: 'Slow', zh: '缓慢/治愈', re: /缓慢|慢镜头|治愈|舒缓|宁静/i },
  { key: 'Sudden', zh: '突然/转场', re: /突然|甩镜|急转|转场/i },
  { key: 'Smooth', zh: '平稳/纪实', re: /平稳|稳定|纪实|纪录片/i },
  { key: 'Dramatic', zh: '戏剧化/史诗', re: /戏剧|史诗|宏大|震撼/i }
]

const SCENE_HINTS = [
  { key: '音乐MV', re: /mv|音乐|舞台|演出/i },
  { key: '纪录片', re: /纪录片|纪实|采访|观察/i },
  { key: '商业广告', re: /广告|产品|商业|品牌|电商/i },
  { key: '短视频/直播', re: /短视频|直播|网感|竖屏/i },
  { key: '特效/超现实', re: /特效|超现实|子弹时间|时间流逝|延时/i }
]

const inferMoodFromText = (text) => {
  const t = normalizeText(text)
  if (!t) return null
  const hit = MOOD_HINTS.find(m => m.re.test(t))
  return hit || null
}

const inferSceneFromText = (text) => {
  const t = normalizeText(text)
  if (!t) return null
  const hit = SCENE_HINTS.find(m => m.re.test(t))
  return hit || null
}

const collectUsageHints = ({ focusNodeId, nodes, edges }) => {
  if (!focusNodeId) return []
  const outgoing = (edges || []).filter(e => e.source === focusNodeId)
  const hints = []

  for (const e of outgoing) {
    const target = nodes.find(n => n.id === e.target)
    if (!target) continue
    if (target.type === 'imageConfig') {
      const inbound = (edges || []).filter(x => x.target === target.id)
      const refCount = inbound
        .map(x => nodes.find(n => n.id === x.source))
        .filter(n => n?.type === 'image')
        .length
      hints.push({
        kind: 'image',
        id: target.id,
        model: target.data?.model,
        size: target.data?.size,
        quality: target.data?.quality,
        refImages: refCount
      })
    }
    if (target.type === 'videoConfig') {
      const inbound = (edges || []).filter(x => x.target === target.id)
      const roles = { first: 0, last: 0, ref: 0 }
      for (const x of inbound) {
        const src = nodes.find(n => n.id === x.source)
        if (src?.type !== 'image') continue
        const role = x.data?.imageRole || 'first_frame_image'
        if (role === 'first_frame_image') roles.first += 1
        else if (role === 'last_frame_image') roles.last += 1
        else roles.ref += 1
      }
      hints.push({
        kind: 'video',
        id: target.id,
        model: target.data?.model,
        ratio: target.data?.ratio,
        duration: target.data?.dur,
        roles
      })
    }
  }

  return hints
}

const suggestCameraMoves = (queryText, { limit = 4, sceneHint, moodHint } = {}) => {
  const q = normalizeText(queryText)
  if (!q) return []
  const qTokens = tokenize(q)
  const qLower = q.toLowerCase()

  const scored = (cameraMoves || []).map((m) => {
    const hay = `${m.en || ''} ${m.zh || ''} ${m.category || ''} ${m.scene || ''} ${m.desc || ''}`
    const tTokens = tokenize(hay)
    let score = scoreOverlap(qTokens, tTokens)
    if (sceneHint?.key && m.scene && m.scene.includes(sceneHint.key)) score += 1.4
    if (m.zh && q.includes(m.zh)) score += 2
    if (m.en && qLower.includes(String(m.en).toLowerCase())) score += 2
    if (m.scene && q.includes(m.scene)) score += 0.6
    if (m.category && q.includes(m.category)) score += 0.4
    return { score, m }
  })

  return scored
    .filter(s => s.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map(s => s.m)
}

const buildSystemPrompt = (mode, { modelHint } = {}) => {
  const base = [
    '你是一个专业的“AI 漫剧提示词润色与编排助手”。',
    '你必须结合我提供的【画布上下文】来保持人物、世界观、画风与关键细节的一致性。',
    '不要套固定模板；只补足缺失信息、修正不清晰表达，让结果更可执行、更稳定、更高质量。',
    '输出只返回最终结果正文，不要解释、不输出 JSON、不输出 Markdown。'
  ]

  if (modelHint) base.push(`本次输出将用于模型：${modelHint}（请不要改动 model 名称本身）。`)

  if (mode === POLISH_MODES.IMAGE) {
    base.push(
      '目标：把输入润色为高质量生图提示词。',
      '结构建议：主体/场景/动作 → 镜头语言（机位/景别/焦段/光圈/构图） → 光影/色彩/质感 → 氛围/风格/渲染与质量。',
      '遵循“主体 → 光影 → 抽象氛围”的黄金顺序，必要时在主体后补充镜头与构图。',
      '如果上下文里有“角色设定/风格 bible/禁忌”，优先遵循。',
      '如果存在参考图连接信息，只需强调“保持与参考图一致性”，不要臆造参考图中不存在的具体细节。'
    )
  } else if (mode === POLISH_MODES.VIDEO) {
    base.push(
      '目标：把输入润色为高质量视频生成提示词。',
      '必须明确：主体动作/节奏、镜头运动（运镜）、镜头语言（景别/机位/转场）、环境变化与氛围。',
      '使用“情绪化运镜公式”：Adjective + Camera Move；并结合场景类型挑 1-2 个运镜词。',
      '尝试体现节奏曲线：起势慢 → 中段加速 → 高潮冲击（如适用）。',
      '避免只写抽象形容词；多用“可执行的镜头指令”。'
    )
  } else {
    base.push(
      '目标：把输入润色为更具画面感的剧本/分镜文本，便于后续拆分为生图/视频提示词。',
      '输出建议：先给 2-4 句剧情概要，再给 3-8 条分镜/镜头列表。',
      '每条分镜尽量包含：场景/人物动作/机位景别/运镜/光影氛围。',
      '优先提升：信息密度、可视化细节、情绪节奏、镜头语言。'
    )
  }

  return base.join('\n')
}

const buildUserMessage = ({ mode, userText, usageHints, contextBlocks, cameraMoveHints, moodHint, sceneHint, upstreamInputs, promptTemplate }) => {
  const lines = []

  const modeLabel = mode === POLISH_MODES.VIDEO ? '视频提示词润色'
    : mode === POLISH_MODES.SCRIPT ? '剧本/分镜润色'
      : '生图提示词润色'

  lines.push(`【任务】${modeLabel}`)

  if (Array.isArray(usageHints) && usageHints.length > 0) {
    lines.push('【下游用途（来自画布连线）】')
    for (const h of usageHints) {
      if (h.kind === 'image') {
        lines.push(`- 生图配置(${h.id})：model=${h.model || '未设置'}；size=${h.size || '默认'}；quality=${h.quality || '默认'}；参考图=${h.refImages || 0}张`)
      } else if (h.kind === 'video') {
        lines.push(`- 视频配置(${h.id})：model=${h.model || '未设置'}；ratio=${h.ratio || '默认'}；duration=${h.duration || '默认'}；首帧=${h.roles?.first || 0}；尾帧=${h.roles?.last || 0}；参考图=${h.roles?.ref || 0}`)
      }
    }
  }

  if (moodHint) {
    lines.push(`【情绪倾向】${moodHint.key}（${moodHint.zh}）`)
  }
  if (sceneHint) {
    lines.push(`【场景类型】${sceneHint.key}`)
  }

  if (Array.isArray(cameraMoveHints) && cameraMoveHints.length > 0) {
    lines.push('【可选运镜词条（来自本地词库，可择优选 1-2 个融入）】')
    for (const m of cameraMoveHints) {
      lines.push(`- ${m.en}${m.zh ? `（${m.zh}）` : ''}${m.scene ? `｜场景：${m.scene}` : ''}${m.desc ? `｜${m.desc}` : ''}`)
    }
  }

  if (promptTemplate?.title) {
    lines.push('【提示词库（自动挑选的最佳模板，用其结构与要点来润色，不要原样照抄/不要输出 JSON）】')
    lines.push(`- ${promptTemplate.title}${promptTemplate.source ? `（来源：${promptTemplate.source}${promptTemplate.no ? `#${promptTemplate.no}` : ''}）` : ''}`)
    if (promptTemplate.description) lines.push(`- 说明：${safeSlice(promptTemplate.description, 180)}`)
    if (promptTemplate.excerpt) {
      lines.push('【模板摘录】')
      lines.push(promptTemplate.excerpt)
    }
  }

  lines.push('【用户原文】')
  lines.push(userText)

  if (upstreamInputs && (Array.isArray(upstreamInputs.text) || Array.isArray(upstreamInputs.images))) {
    const tList = Array.isArray(upstreamInputs.text) ? upstreamInputs.text : []
    const iList = Array.isArray(upstreamInputs.images) ? upstreamInputs.images : []
    if (tList.length > 0 || iList.length > 0) {
      lines.push('【同链路上游输入（来自画布连线：其它提示词/参考图）】')
      for (const t of tList.slice(0, 6)) {
        lines.push(`- 文本(${t.id})：${t.label} → 连接到(${t.target})\n${t.text}`)
      }
      for (const im of iList.slice(0, 6)) {
        lines.push(`- 参考图(${im.id})：${im.label}｜role=${im.role} → 连接到(${im.target})${im.url ? `\n${im.url}` : ''}`)
      }
    }
  }

  if (Array.isArray(contextBlocks) && contextBlocks.length > 0) {
    lines.push('【画布上下文（已检索/筛选）】')
    for (const b of contextBlocks) {
      lines.push(`- ${b.title}\n${b.text}`)
    }
  }

  lines.push('【输出要求】')
  lines.push('- 只输出最终正文（不要解释/不要 Markdown/不要 JSON）。')
  lines.push('- 不要改变我提供的模型名称字符串（如需提及）。')
  lines.push('- 不要引入上下文里不存在的关键信息（可以合理补足细节，但不得捏造剧情关键点）。')

  return lines.join('\n')
}

const buildContextBlocks = ({ focusNodeId, queryText, mode, nodes, edges }) => {
  const dist = bfsDistances(focusNodeId, edges, 2)
  const qTokens = tokenize(queryText)

  const textNodes = (nodes || []).filter(n => n?.type === 'text')
  const focusNode = focusNodeId ? textNodes.find(n => n.id === focusNodeId) : null
  const focusText = normalizeText(focusNode?.data?.content || '')

  // 最近更新 Top N | recent boosts
  const updatedSorted = textNodes
    .map(n => ({ id: n.id, t: Number(n.data?.updatedAt || n.data?.createdAt || 0) }))
    .sort((a, b) => b.t - a.t)
    .slice(0, 6)
  const recentSet = new Set(updatedSorted.map(x => x.id))

  const candidates = []
  for (const n of textNodes) {
    const content = normalizeText(n.data?.content)
    if (!content) continue
    if (focusNodeId && n.id === focusNodeId) continue
    if (focusText && content === focusText) continue

    const label = normalizeText(n.data?.label) || '文本节点'
    const d = dist.has(n.id) ? dist.get(n.id) : 99
    const tTokens = tokenize(`${label}\n${content}`)

    let score = scoreOverlap(qTokens, tTokens)
    if (d === 1) score += 2.2
    else if (d === 2) score += 1.2
    if (isMemoryCandidate(n)) score += 1.5
    if (recentSet.has(n.id)) score += 0.8

    candidates.push({
      id: n.id,
      title: `${label}（${n.id}${d !== 99 ? `，距焦点${d}跳` : ''}）`,
      text: content,
      score
    })
  }

  // 兜底：当 query 很短时，尽量保留一些“记忆节点”
  const memoryBlocks = candidates
    .filter(c => /设定|世界观|画风|风格|角色|人物|bible|禁忌/i.test(c.title))
    .sort((a, b) => b.score - a.score)
    .slice(0, 3)

  const mainBlocks = candidates
    .sort((a, b) => b.score - a.score)
    .slice(0, 14)

  const merged = []
  const seen = new Set()
  for (const b of [...memoryBlocks, ...mainBlocks]) {
    if (seen.has(b.id)) continue
    seen.add(b.id)
    merged.push(b)
  }

  // 按长度预算裁剪
  const maxTotal = mode === POLISH_MODES.SCRIPT ? 6000 : 4500
  const maxEach = mode === POLISH_MODES.SCRIPT ? 1200 : 800
  const selected = []
  let total = 0
  for (const b of merged) {
    const clipped = safeSlice(b.text, maxEach)
    if (!clipped) continue
    const nextLen = total + clipped.length
    if (selected.length >= 10 || nextLen > maxTotal) continue
    selected.push({ title: b.title, text: clipped })
    total = nextLen
  }

  return selected
}

export const usePolish = () => {
  const loading = ref(false)
  const preview = ref('')

  const shouldRetry = (err) => {
    const msg = String(err?.message || '').toLowerCase()
    return /(429|rate|timeout|network|502|503|504|server error|gateway)/i.test(msg)
  }

  const requestWithRetry = async (fn, { attempts = 2, baseDelay = 600 } = {}) => {
    let lastErr = null
    for (let i = 0; i < attempts; i++) {
      try {
        return await fn()
      } catch (err) {
        lastErr = err
        if (!shouldRetry(err) || i === attempts - 1) throw err
        await new Promise(resolve => setTimeout(resolve, baseDelay * (i + 1)))
      }
    }
    throw lastErr
  }

  const polish = async ({
    text,
    focusNodeId,
    mode: modeOverride,
    stream = true
  } = {}) => {
    const userText = normalizeText(text)
    if (!userText) return ''

    loading.value = true
    preview.value = ''

    try {
      const nodes = canvasNodes.value || []
      const edges = canvasEdges.value || []

      const usageHints = collectUsageHints({ focusNodeId, nodes, edges })
      const modelHint = usageHints.find(h => h?.model)?.model || null

      const inferredByGraph = inferModeFromGraph(focusNodeId, nodes, edges)
      const inferredByText = inferModeFromText(userText)
      const mode = modeOverride || inferredByGraph || inferredByText

      const moodHint = mode === POLISH_MODES.VIDEO ? inferMoodFromText(userText) : null
      const sceneHint = mode === POLISH_MODES.VIDEO ? inferSceneFromText(userText) : null
      const cameraMoveHints = mode === POLISH_MODES.VIDEO
        ? suggestCameraMoves(userText, { limit: 4, sceneHint, moodHint })
        : []

      const contextBlocks = buildContextBlocks({
        focusNodeId,
        queryText: userText,
        mode,
        nodes,
        edges
      })

      const upstreamInputs = collectUpstreamInputsForFocus({ focusNodeId, nodes, edges })
      const promptTemplate = await selectBestPromptTemplate({ mode, userText, contextBlocks, usageHints })

      const systemPrompt = buildSystemPrompt(mode, { modelHint })
      const inputText = buildUserMessage({
        mode,
        userText,
        usageHints,
        contextBlocks,
        cameraMoveHints,
        moodHint,
        sceneHint,
        upstreamInputs,
        promptTemplate
      })

      const payload = {
        model: DEFAULT_CHAT_MODEL,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: inputText }
        ]
      }

      if (!stream) {
        const resp = await requestWithRetry(() => chatCompletions(payload))
        const out = normalizeText(resp?.choices?.[0]?.message?.content || '')
        if (!out) throw new Error('润色失败，请重试')
        preview.value = out
        return out
      }

      let full = ''
      for await (const chunk of streamChatCompletions(payload)) {
        full += chunk
        preview.value = full
      }
      return normalizeText(full)
    } finally {
      loading.value = false
    }
  }

  return {
    loading,
    preview,
    polish,
    POLISH_MODES
  }
}
