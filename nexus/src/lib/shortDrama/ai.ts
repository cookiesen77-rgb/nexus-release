import { CHAT_MODELS, DEFAULT_CHAT_MODEL } from '@/config/models'
import { postJson } from '@/lib/workflow/request'
import { SHORT_DRAMA_STYLE_PRESETS, getShortDramaStylePresetById } from '@/lib/shortDrama/stylePresets'
import { createEmptyImageSlot, createEmptyShot, createEmptyAsset } from '@/lib/shortDrama/draftStorage'
import type { ShortDramaDraftV2, ShortDramaAssetCategory, ShotFrameMode } from '@/lib/shortDrama/types'
import { SHOT_FRAME_MODES } from '@/lib/shortDrama/types'

const DEFAULT_ANALYSIS_MODEL = 'claude-opus-4-6'

type ChatRole = 'system' | 'user' | 'assistant'
type ChatMessage = { role: ChatRole; content: string }

type ModelCfg = {
  key: string
  label?: string
  endpoint: string
  authMode?: any
  format: string
}

const normalizeText = (t: unknown) => String(t || '').replace(/\r\n/g, '\n').trim()

const pickModel = (key: string): ModelCfg => {
  const k = String(key || '').trim() || DEFAULT_CHAT_MODEL
  const cfg = (CHAT_MODELS as any[]).find((m) => String(m?.key || '') === k) || (CHAT_MODELS as any[])[0]
  if (!cfg) throw new Error('未找到对话模型配置')
  return cfg as any
}

const extractTextFromResponsesOutput = (output: any) => {
  if (!Array.isArray(output)) return ''
  let text = ''
  for (const item of output) {
    const content = item?.content
    if (typeof content === 'string') {
      text += content
      continue
    }
    if (!Array.isArray(content)) continue
    for (const part of content) {
      if (typeof part === 'string') {
        text += part
        continue
      }
      if (typeof part?.text === 'string') text += part.text
    }
  }
  return text
}

const extractTextFromResponses = (resp: any) => {
  if (!resp) return ''
  if (typeof resp.output_text === 'string') return resp.output_text
  const outputText = extractTextFromResponsesOutput(resp.output)
  if (outputText) return outputText
  const msg = resp?.choices?.[0]?.message?.content
  if (typeof msg === 'string') return msg
  if (Array.isArray(msg)) return msg.map((m) => m?.text || m).filter(Boolean).join('')
  return ''
}

const callChatModel = async (modelKey: string, messages: ChatMessage[]): Promise<string> => {
  const modelCfg = pickModel(modelKey)
  const format = String(modelCfg.format || '').trim()

  // Gemini native chat
  if (format === 'gemini-chat') {
    const system = messages.find((m) => m.role === 'system')?.content || ''
    const contents = messages
      .filter((m) => m.role !== 'system')
      .map((m) => ({
        role: m.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: m.content }],
      }))
    const payload: any = { contents }
    if (system) payload.systemInstruction = { parts: [{ text: system }] }
    const rsp = await postJson<any>(modelCfg.endpoint, payload, { authMode: modelCfg.authMode, timeoutMs: 600000 })
    const parts = rsp?.candidates?.[0]?.content?.parts || []
    const text = Array.isArray(parts) ? parts.map((p: any) => p?.text).filter(Boolean).join('') : ''
    return normalizeText(text)
  }

  // Anthropic Messages API
  if (format === 'anthropic-chat') {
    const system = messages.find((m) => m.role === 'system')?.content || ''
    const nonSystemMessages = messages
      .filter((m) => m.role !== 'system')
      .map((m) => ({ role: m.role as 'user' | 'assistant', content: m.content }))
    const payload: any = {
      model: modelCfg.key,
      max_tokens: 65536,
      messages: nonSystemMessages,
    }
    if (system) payload.system = system
    const rsp = await postJson<any>(modelCfg.endpoint, payload, {
      authMode: modelCfg.authMode,
      timeoutMs: 600000,
      extraHeaders: { 'anthropic-version': '2023-06-01' },
    })
    const content = rsp?.content
    if (Array.isArray(content)) {
      return normalizeText(content.filter((b: any) => b?.type === 'text').map((b: any) => b?.text || '').filter(Boolean).join(''))
    }
    return normalizeText(String(content || ''))
  }

  // OpenAI Responses API
  if (format === 'openai-responses') {
    const payload: any = { model: modelCfg.key, input: messages }
    const rsp = await postJson<any>(modelCfg.endpoint, payload, { authMode: modelCfg.authMode, timeoutMs: 600000 })
    return normalizeText(extractTextFromResponses(rsp))
  }

  // Default: OpenAI Chat Completions-like
  // Use a higher max_tokens to avoid truncated JSON for long scripts
  const payload: any = { model: modelCfg.key, messages, temperature: 0.3, max_tokens: 8192 }
  const rsp = await postJson<any>(modelCfg.endpoint, payload, { authMode: modelCfg.authMode, timeoutMs: 600000 })
  const content = rsp?.choices?.[0]?.message?.content
  if (typeof content === 'string') return normalizeText(content)
  if (Array.isArray(content)) return normalizeText(content.map((c: any) => c?.text || c).filter(Boolean).join(''))
  if (content && typeof content === 'object' && typeof (content as any).text === 'string') {
    return normalizeText((content as any).text)
  }
  return normalizeText(String(content || ''))
}

const stripCodeFences = (raw: string) => {
  let t = String(raw || '').trim()
  // Strip thinking blocks (Anthropic models)
  t = t.replace(/<thinking>[\s\S]*?<\/thinking>/gi, '').trim()
  t = t.replace(/<\/?thinking>/gi, '').trim()
  // Remove code fences anywhere in the output
  t = t.replace(/```json/gi, '```').replace(/```/g, '').trim()
  return t
}

class ShortDramaParseError extends Error {
  rawText: string
  constructor(message: string, rawText: string) {
    super(message)
    this.name = 'ShortDramaParseError'
    this.rawText = rawText
  }
}

const tryParseJson = (text: string) => {
  try {
    return JSON.parse(text)
  } catch {
    return null
  }
}

const extractJsonCandidates = (raw: string) => {
  const t = stripCodeFences(raw)
  const candidates: string[] = []
  let start = -1
  let depth = 0
  let inString = false
  let escaped = false

  for (let i = 0; i < t.length; i++) {
    const ch = t[i]

    if (inString) {
      if (escaped) {
        escaped = false
        continue
      }
      if (ch === '\\') {
        escaped = true
        continue
      }
      if (ch === '"') {
        inString = false
      }
      continue
    }

    if (ch === '"') {
      inString = true
      continue
    }
    if (ch === '{') {
      if (depth === 0) start = i
      depth++
      continue
    }
    if (ch === '}') {
      if (depth > 0) depth--
      if (depth === 0 && start >= 0) {
        candidates.push(t.slice(start, i + 1))
        start = -1
      }
    }
  }
  return candidates
}

const pickBestJsonObject = (raw: string) => {
  const candidates = extractJsonCandidates(raw)
  let best = ''
  let bestScore = -1
  for (const c of candidates) {
    const parsed = tryParseJson(c)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) continue
    let score = 0
    if ('shots' in parsed) score += 6
    if (Array.isArray((parsed as any).shots)) score += 6
    if ('characters' in parsed) score += 2
    if ('scenes' in parsed) score += 2
    if ('assets' in parsed) score += 1
    if ('title' in parsed) score += 1
    score = score * 100000 + c.length
    if (score > bestScore) {
      bestScore = score
      best = c
    }
  }
  return best
}

const autoCloseJson = (raw: string) => {
  let t = stripCodeFences(raw)
  const start = t.indexOf('{')
  if (start === -1) return ''
  t = t.slice(start)

  let depthBrace = 0
  let depthBracket = 0
  let inString = false
  let escaped = false

  for (let i = 0; i < t.length; i++) {
    const ch = t[i]
    if (inString) {
      if (escaped) {
        escaped = false
        continue
      }
      if (ch === '\\') {
        escaped = true
        continue
      }
      if (ch === '"') {
        inString = false
      }
      continue
    }
    if (ch === '"') {
      inString = true
      continue
    }
    if (ch === '{') {
      depthBrace++
      continue
    }
    if (ch === '}') {
      depthBrace = Math.max(0, depthBrace - 1)
      continue
    }
    if (ch === '[') {
      depthBracket++
      continue
    }
    if (ch === ']') {
      depthBracket = Math.max(0, depthBracket - 1)
    }
  }

  let out = t
  if (inString) out += '"'
  if (depthBracket > 0) out += ']'.repeat(depthBracket)
  if (depthBrace > 0) out += '}'.repeat(depthBrace)

  out = out.replace(/,\s*([}\]])/g, '$1')
  return out
}

const pickObjectFromArray = (arr: any[]) => {
  const byShots = arr.find((x) => x && typeof x === 'object' && !Array.isArray(x) && 'shots' in x)
  if (byShots) return byShots
  const firstObj = arr.find((x) => x && typeof x === 'object' && !Array.isArray(x))
  return firstObj || null
}

const parseJsonLoose = (raw: string) => {
  const cleaned = stripCodeFences(raw)
  let parsed = tryParseJson(cleaned)
  if (parsed) {
    if (Array.isArray(parsed)) return pickObjectFromArray(parsed)
    return parsed
  }

  const best = pickBestJsonObject(raw)
  if (best) {
    parsed = tryParseJson(best)
    if (parsed) return parsed
  }

  const repaired = autoCloseJson(raw)
  if (repaired) {
    parsed = tryParseJson(repaired)
    if (parsed) return parsed
  }

  return null
}

const clampText = (text: string, max = 20000) => (text.length > max ? text.slice(0, max) : text)

const prepareRepairInput = (raw: string) => {
  const best = pickBestJsonObject(raw)
  if (best) return best
  const t = stripCodeFences(raw)
  const objIdx = t.indexOf('{')
  const arrIdx = t.indexOf('[')
  let start = -1
  if (objIdx >= 0 && arrIdx >= 0) start = Math.min(objIdx, arrIdx)
  else start = objIdx >= 0 ? objIdx : arrIdx
  if (start >= 0) return t.slice(start)
  return t
}

const normalizePresetId = (id: unknown) => {
  const v = String(id || '').trim()
  const allowed = new Set(SHORT_DRAMA_STYLE_PRESETS.map((p) => p.id))
  return allowed.has(v) ? v : ''
}

export type ShortDramaScriptAnalysis = {
  title?: string
  logline?: string
  styleSuggestion?: { presetId?: string; customText?: string; negativeText?: string }
  characters?: { name: string; description: string }[]
  scenes?: { name: string; description: string }[]
  assets?: {
    name: string
    description: string
    category: ShortDramaAssetCategory
    owners?: string[]
  }[]
  shots?: {
    title: string
    beat?: string
    scriptExcerpt?: string
    scene?: string
    characters?: string[]
    assets?: string[]
    startPrompt: string
    endPrompt: string
    gridPrompts?: string[]
    videoPrompt?: string
  }[]
}

type ShortDramaAnalysisShot = NonNullable<ShortDramaScriptAnalysis['shots']>[number]

const isGridFrameMode = (mode: ShotFrameMode) => mode === 'grid_4' || mode === 'grid_6' || mode === 'grid_9' || mode === 'grid_25'

const normalizeNameArray = (arr: unknown) =>
  Array.isArray(arr) ? arr.map((x) => normalizeText(x)).filter(Boolean) : []

const normalizeGridPrompts = (arr: unknown) =>
  Array.isArray(arr) ? arr.map((x) => normalizeText(x)).filter(Boolean) : []

const normalizeAnalysisShot = (
  raw: any,
  index: number,
  defaultFrameMode: ShotFrameMode,
  fallback?: ShortDramaAnalysisShot
): ShortDramaAnalysisShot => {
  const fallbackStart = normalizeText(fallback?.endPrompt || fallback?.startPrompt)
  const seedStart = fallbackStart || `中景，延续上一镜头的人物与场景，镜头 ${index + 1} 起始画面，角色外观保持一致`
  const seedEnd = normalizeText(fallback?.endPrompt) || seedStart

  const startPrompt = normalizeText(raw?.startPrompt) || seedStart
  const endPromptRaw = normalizeText(raw?.endPrompt)
  const endPrompt = defaultFrameMode === 'first_only' ? '' : (endPromptRaw || seedEnd)

  const shot: ShortDramaAnalysisShot = {
    title: normalizeText(raw?.title) || `镜头 ${index + 1}`,
    beat: normalizeText(raw?.beat),
    scriptExcerpt: normalizeText(raw?.scriptExcerpt),
    scene: normalizeText(raw?.scene),
    characters: normalizeNameArray(raw?.characters),
    assets: normalizeNameArray(raw?.assets),
    startPrompt,
    endPrompt,
    videoPrompt: normalizeText(raw?.videoPrompt) || normalizeText(fallback?.videoPrompt),
  }

  if (isGridFrameMode(defaultFrameMode)) {
    const gridCount = SHOT_FRAME_MODES.find((m) => m.value === defaultFrameMode)?.count || 4
    const fromRaw = normalizeGridPrompts(raw?.gridPrompts)
    const fromFallback = normalizeGridPrompts(fallback?.gridPrompts)
    const seed = fromRaw.length > 0 ? fromRaw : fromFallback
    const gridPrompts = seed.slice(0, gridCount)
    while (gridPrompts.length < gridCount) {
      const idx = gridPrompts.length + 1
      gridPrompts.push(`${startPrompt}（分镜 ${idx}/${gridCount}）`)
    }
    shot.gridPrompts = gridPrompts
  } else {
    shot.gridPrompts = []
  }

  return shot
}

const enforceAnalysisShotCount = (
  shots: unknown,
  targetShotCount: number,
  defaultFrameMode: ShotFrameMode
): ShortDramaAnalysisShot[] => {
  const list = Array.isArray(shots) ? shots : []
  const normalized: ShortDramaAnalysisShot[] = []
  for (let i = 0; i < list.length; i++) {
    const prev = i > 0 ? normalized[i - 1] : undefined
    normalized.push(normalizeAnalysisShot(list[i], i, defaultFrameMode, prev))
  }

  if (targetShotCount <= 0) return normalized
  if (normalized.length > targetShotCount) return normalized.slice(0, targetShotCount)

  while (normalized.length < targetShotCount) {
    const i = normalized.length
    const prev = i > 0 ? normalized[i - 1] : undefined
    normalized.push(normalizeAnalysisShot({}, i, defaultFrameMode, prev))
  }
  return normalized
}

export async function analyzeShortDramaScriptToDraftV2(opts: {
  draft: ShortDramaDraftV2
  modelKey?: string
  scriptText: string
  videoModelInfo?: {
    modelName?: string
    duration?: number
    supportsFirstLastFrame?: boolean
    ratio?: string
  }
}): Promise<{ draft: ShortDramaDraftV2; analysis: ShortDramaScriptAnalysis; rawText: string }> {
  const script = normalizeText(opts.scriptText)
  if (!script) throw new Error('剧本为空')

  const scriptLength = script.length
  const isLongScript = scriptLength > 4000
  const autoMaxShots = isLongScript ? 40 : 60
  const promptMinLen = isLongScript ? 60 : 120
  const videoPromptMinLen = isLongScript ? 50 : 80

  const presetHints = SHORT_DRAMA_STYLE_PRESETS.map((p) => `- ${p.id}: ${p.name}`).join('\n')

  // 构建视频模型上下文信息
  const videoCtx = opts.videoModelInfo
  const videoDuration = videoCtx?.duration || opts.draft.models.videoDuration || 5
  const supportsFirstLastFrame = videoCtx?.supportsFirstLastFrame ?? true
  const videoRatio = videoCtx?.ratio || opts.draft.models.videoRatio || '9:16'
  const targetShotCount = opts.draft.models.targetShotCount || 0
  const defaultFrameMode: ShotFrameMode = opts.draft.models.defaultFrameMode || 'first_last'
  const frameModeInfo = SHOT_FRAME_MODES.find((m) => m.value === defaultFrameMode)
  const shotCountHint = targetShotCount > 0
    ? `用户要求生成恰好 ${targetShotCount} 个镜头。这是硬性约束，输出的 shots 数组长度必须严格等于 ${targetShotCount}，不多不少。如果剧本较短，则细化每句话拆成多个镜头角度来凑满数量；如果剧本较长，则合并次要动作保证精确数量。绝对禁止偏差。`
    : `请根据剧本内容自动决定镜头数量。原则：宁多勿少，每${videoDuration}秒为一个镜头，确保剧本的每一句台词、每一个动作、每一次情绪转折都有对应镜头，不要跳过任何细节。一般来说，一段500字的剧本至少需要15-25个镜头。为保证 JSON 完整性，镜头数最多 ${autoMaxShots} 个。`
  const lengthHint = isLongScript
    ? `【控制长度】剧本较长，请在保证信息完整的前提下尽量简洁，镜头数不超过 ${autoMaxShots}。`
    : ''

  // 根据用户已选择的风格构建风格提示
  const stylePreset = opts.draft.style.presetId ? getShortDramaStylePresetById(opts.draft.style.presetId) : null
  const userStyleContext = [
    opts.draft.style.customText ? `用户自定义风格: ${opts.draft.style.customText}` : '',
    stylePreset ? `用户选择的预设风格: ${stylePreset.name} - ${stylePreset.baseStyleText}` : '',
    opts.draft.style.negativeText ? `用户指定的负面提示词: ${opts.draft.style.negativeText}` : '',
  ].filter(Boolean).join('\n')

  const system = [
    '你是专业的短剧分镜大师。将剧本转化为视觉分镜JSON。只输出JSON，不要解释或Markdown。',
    '',
    `【参数】视频时长${videoDuration}秒 | 比例${videoRatio} | 首尾帧${supportsFirstLastFrame ? '支持' : '不支持'}`,
    `【镜头数量】${shotCountHint}`,
    `【帧模式】${defaultFrameMode}（${frameModeInfo?.label || ''}，每镜头${frameModeInfo?.count || 2}张）`,
    lengthHint,
    defaultFrameMode === 'first_only' ? '只生成startPrompt，endPrompt留空，gridPrompts留空数组。'
      : defaultFrameMode === 'first_last' ? '必须同时生成startPrompt和endPrompt，gridPrompts留空数组。'
      : `必须生成gridPrompts数组，长度=${frameModeInfo?.count || 4}。startPrompt/endPrompt可留空。`,
    '',
    userStyleContext ? `【风格】${userStyleContext}` : '',
    '',
    '【JSON Schema】',
    '{"title":"","logline":"","styleSuggestion":{"presetId":"","customText":"","negativeText":""},',
    '"characters":[{"name":"","description":"面部+发型+身材+服装+配饰+气质，详细到可跨镜头保持一致"}],',
    '"scenes":[{"name":"","description":"空间+布局+光线+时段+色彩+氛围"}],',
    '"assets":[{"name":"","description":"外观+状态+标记","category":"weapon|prop|vehicle|accessory|item|other","owners":[]}],',
    '"shots":[{"title":"","beat":"","scriptExcerpt":"引用原文","scene":"","characters":[],"assets":[],',
    '"startPrompt":"中文，${promptMinLen}字+，含：景别/焦段/光圈/机位/构图 + 人物完整外貌+表情+动作 + 场景环境 + 光影 + 色彩氛围 + 画质标签",',
    '"endPrompt":"同上格式，体现该镜头结束时的不同画面状态",',
    '"gridPrompts":["每格同上格式的完整画面描述"],',
    '"videoPrompt":"中文${videoPromptMinLen}字+，含：镜头运动类型+速度 → 起始阶段 → 发展阶段 → 高潮定格 + 环境动态。禁止出现秒数时间戳"}]}',
    '',
    '【核心规则】',
    '1. 镜头按剧情顺序，scriptExcerpt覆盖全文不跳跃',
    '2. 每镜头承接上一镜头末状态，人物/道具/场景保持一致',
    '3. startPrompt和endPrompt必须是两个明确不同的画面状态',
    '4. 每个帧提示词必须重复角色核心外貌特征（从characters提取）',
    '5. 字段不确定时留空字符串/空数组，不要省略字段',
    '- styleSuggestion.presetId从下列选：',
    presetHints,
  ].join('\n')

  const user = [
    '请分析下面的短剧剧本，并输出 JSON（只输出 JSON）。',
    '',
    '【剧本】',
    script,
  ].join('\n')

  const modelKey = opts.modelKey || opts.draft.models.analysisModelKey || DEFAULT_ANALYSIS_MODEL
  let rawText = await callChatModel(modelKey, [
    { role: 'system', content: system },
    { role: 'user', content: user },
  ])

  let parsed = parseJsonLoose(rawText) as ShortDramaScriptAnalysis | null
  if (!parsed) {
    // Retry once with stronger constraints to avoid truncated/invalid JSON.
    const retrySystem = [
      system,
      '',
      '你上一次输出未能被 JSON.parse 解析。',
      '请只输出完整、严格的 JSON（不要输出解释/Markdown/多余文字），确保所有括号与引号闭合。',
      `如果剧本很长：最多输出 ${autoMaxShots} 个 shots；宁可减少镜头数，也不要输出不完整 JSON。`,
      'shots/characters/scenes 必须存在；没有就输出空数组 []（不要省略字段）。',
    ].join('\n')
    const retryUser = [
      '请重新输出 JSON（只输出 JSON）。',
      '',
      '【剧本】',
      script,
    ].join('\n')
    rawText = await callChatModel(modelKey, [
      { role: 'system', content: retrySystem },
      { role: 'user', content: retryUser },
    ])
    parsed = parseJsonLoose(rawText) as ShortDramaScriptAnalysis | null
    if (!parsed) {
      // Final fallback: ask a model to repair the JSON strictly.
      const repairModelKey = modelKey === DEFAULT_CHAT_MODEL ? modelKey : DEFAULT_CHAT_MODEL
      const repairSystem = [
        "你是 JSON 修复器。给定一段模型原始输出，请修复为严格 JSON 对象。",
        "要求：",
        "1) 只输出 JSON（不要解释/Markdown/多余文字）",
        "2) 使用双引号，禁止单引号，禁止尾逗号",
        "3) 若原文截断/缺失字段，按 Schema 补齐为空字符串或空数组",
        "4) 保留原有语义，不随意增删镜头内容",
        "",
        "【JSON Schema】",
        "{\"title\":\"\",\"logline\":\"\",\"styleSuggestion\":{\"presetId\":\"\",\"customText\":\"\",\"negativeText\":\"\"},",
        "\"characters\":[{\"name\":\"\",\"description\":\"\"}],",
        "\"scenes\":[{\"name\":\"\",\"description\":\"\"}],",
        "\"assets\":[{\"name\":\"\",\"description\":\"\",\"category\":\"weapon|prop|vehicle|accessory|item|other\",\"owners\":[]}],",
        "\"shots\":[{\"title\":\"\",\"beat\":\"\",\"scriptExcerpt\":\"\",\"scene\":\"\",\"characters\":[],\"assets\":[],",
        "\"startPrompt\":\"\",\"endPrompt\":\"\",\"gridPrompts\":[],\"videoPrompt\":\"\"}]}",
      ].join("\n")
      const repairSource = clampText(prepareRepairInput(rawText))
      const repairUser = [
        "请修复下面文本为严格 JSON：",
        "",
        repairSource,
      ].join("\n")
      rawText = await callChatModel(repairModelKey, [
        { role: "system", content: repairSystem },
        { role: "user", content: repairUser },
      ])
      parsed = parseJsonLoose(rawText) as ShortDramaScriptAnalysis | null
      if (!parsed) {
        throw new ShortDramaParseError("剧本解析失败：模型未返回合法 JSON", rawText)
      }
    }
  }

  const analysis: ShortDramaScriptAnalysis = {
    title: normalizeText((parsed as any).title),
    logline: normalizeText((parsed as any).logline),
    styleSuggestion: (parsed as any).styleSuggestion || undefined,
    characters: Array.isArray((parsed as any).characters) ? (parsed as any).characters : [],
    scenes: Array.isArray((parsed as any).scenes) ? (parsed as any).scenes : [],
    assets: Array.isArray((parsed as any).assets) ? (parsed as any).assets : [],
    shots: Array.isArray((parsed as any).shots) ? (parsed as any).shots : [],
  }

  analysis.shots = enforceAnalysisShotCount(analysis.shots, targetShotCount, defaultFrameMode)

  const next: ShortDramaDraftV2 = { ...opts.draft }
  next.script = { ...next.script, text: script, importedAt: Date.now(), source: { type: 'paste' } as any }
  next.title = analysis.title || next.title
  next.logline = analysis.logline || next.logline

  // Apply style suggestion (only if not locked and user hasn't set custom fields)
  if (!next.style.locked) {
    const presetId = normalizePresetId(analysis.styleSuggestion?.presetId)
    const canApplyPreset = presetId && (!next.style.presetId || next.style.presetId === SHORT_DRAMA_STYLE_PRESETS[0].id)
    if (canApplyPreset) next.style.presetId = presetId
    if (!next.style.customText && analysis.styleSuggestion?.customText) next.style.customText = normalizeText(analysis.styleSuggestion.customText)
    if (!next.style.negativeText && analysis.styleSuggestion?.negativeText) next.style.negativeText = normalizeText(analysis.styleSuggestion.negativeText)
  }

  // Merge characters by name
  const existingCharsByName = new Map<string, (typeof next.characters)[number]>()
  for (const c of next.characters || []) existingCharsByName.set(String(c.name || '').trim(), c)
  const mergedChars: typeof next.characters = []
  for (const c of analysis.characters || []) {
    const name = normalizeText((c as any)?.name)
    if (!name) continue
    const desc = normalizeText((c as any)?.description)
    const existing = existingCharsByName.get(name)
    if (existing) {
      mergedChars.push({ ...existing, description: existing.description ? existing.description : desc })
    } else {
      mergedChars.push({
        id: globalThis.crypto?.randomUUID?.() || `sd_${Date.now()}_${Math.random().toString(16).slice(2)}`,
        name,
        description: desc,
        sheet: createEmptyImageSlot('角色设定图'),
        refs: [createEmptyImageSlot('参考图 1')],
        primaryRefSlotId: undefined,
      })
    }
  }
  // Keep any pre-existing characters not mentioned (non-destructive)
  for (const c of next.characters || []) {
    const name = String(c.name || '').trim()
    if (!name) continue
    if (!mergedChars.some((x) => x.name === name)) mergedChars.push(c)
  }
  next.characters = mergedChars

  // Merge scenes by name
  const existingScenesByName = new Map<string, (typeof next.scenes)[number]>()
  for (const s of next.scenes || []) existingScenesByName.set(String(s.name || '').trim(), s)
  const mergedScenes: typeof next.scenes = []
  for (const s of analysis.scenes || []) {
    const name = normalizeText((s as any)?.name)
    if (!name) continue
    const desc = normalizeText((s as any)?.description)
    const existing = existingScenesByName.get(name)
    if (existing) {
      mergedScenes.push({ ...existing, description: existing.description ? existing.description : desc })
    } else {
      mergedScenes.push({
        id: globalThis.crypto?.randomUUID?.() || `sd_${Date.now()}_${Math.random().toString(16).slice(2)}`,
        name,
        description: desc,
        ref: createEmptyImageSlot('场景主参考'),
        refs: [],
      })
    }
  }
  for (const s of next.scenes || []) {
    const name = String(s.name || '').trim()
    if (!name) continue
    if (!mergedScenes.some((x) => x.name === name)) mergedScenes.push(s)
  }
  next.scenes = mergedScenes

  // Build lookup maps BEFORE using them
  const charIdByName = new Map(next.characters.map((c) => [String(c.name || '').trim(), c.id]))
  const sceneIdByName = new Map(next.scenes.map((s) => [String(s.name || '').trim(), s.id]))

  // Merge assets by name
  const validCategories = new Set<ShortDramaAssetCategory>(['weapon', 'prop', 'vehicle', 'accessory', 'item', 'other'])
  const existingAssetsByName = new Map<string, (typeof next.assets)[number]>()
  for (const a of next.assets || []) existingAssetsByName.set(String(a.name || '').trim(), a)
  const mergedAssets: typeof next.assets = []
  for (const a of analysis.assets || []) {
    const name = normalizeText((a as any)?.name)
    if (!name) continue
    const desc = normalizeText((a as any)?.description)
    const rawCategory = String((a as any)?.category || 'item').trim().toLowerCase()
    const category: ShortDramaAssetCategory = validCategories.has(rawCategory as ShortDramaAssetCategory)
      ? (rawCategory as ShortDramaAssetCategory)
      : 'item'
    const owners = Array.isArray((a as any)?.owners) ? (a as any).owners.map((x: any) => normalizeText(x)).filter(Boolean) : []
    const existing = existingAssetsByName.get(name)
    if (existing) {
      mergedAssets.push({
        ...existing,
        description: existing.description ? existing.description : desc,
        category: existing.category || category,
        ownerCharacterIds: existing.ownerCharacterIds?.length ? existing.ownerCharacterIds : owners.map((n: string) => charIdByName.get(n)).filter(Boolean) as string[]
      })
    } else {
      const asset = createEmptyAsset(name, desc, category)
      asset.ownerCharacterIds = owners.map((n: string) => charIdByName.get(n)).filter(Boolean) as string[]
      mergedAssets.push(asset)
    }
  }
  for (const a of next.assets || []) {
    const name = String(a.name || '').trim()
    if (!name) continue
    if (!mergedAssets.some((x) => x.name === name)) mergedAssets.push(a)
  }
  next.assets = mergedAssets

  const assetIdByName = new Map(next.assets.map((a) => [String(a.name || '').trim(), a.id]))

  // Merge shots by index (non-destructive for existing media slots)
  const existingShots = Array.isArray(next.shots) ? next.shots.slice() : []
  const aiShots = Array.isArray(analysis.shots) ? analysis.shots : []
  const mergedShots = existingShots.slice()

  for (let i = 0; i < aiShots.length; i++) {
    const ai = aiShots[i] as any
    const title = normalizeText(ai?.title) || `镜头 ${i + 1}`
    const beat = normalizeText(ai?.beat)
    const sceneName = normalizeText(ai?.scene)
    const charNames = Array.isArray(ai?.characters) ? ai.characters.map((x: any) => normalizeText(x)).filter(Boolean) : []
    const assetNames = Array.isArray(ai?.assets) ? ai.assets.map((x: any) => normalizeText(x)).filter(Boolean) : []
    const startPrompt = normalizeText(ai?.startPrompt)
    const endPrompt = normalizeText(ai?.endPrompt)
    const videoPrompt = normalizeText(ai?.videoPrompt)
    const scriptExcerpt = normalizeText(ai?.scriptExcerpt)
    const gridPrompts = Array.isArray(ai?.gridPrompts) ? ai.gridPrompts.map((x: any) => normalizeText(x)).filter(Boolean) : []

    const existing = mergedShots[i]
    if (existing) {
      const nextShot = { ...existing }
      if (!nextShot.title || /^镜头\s+\d+$/.test(nextShot.title)) nextShot.title = title
      if (!nextShot.beat && beat) nextShot.beat = beat
      if (!nextShot.scriptExcerpt && scriptExcerpt) nextShot.scriptExcerpt = scriptExcerpt
      if (!nextShot.videoPrompt && videoPrompt) nextShot.videoPrompt = videoPrompt
      if (!nextShot.sceneId && sceneName && sceneIdByName.get(sceneName)) nextShot.sceneId = sceneIdByName.get(sceneName)
      if ((!nextShot.characterIds || nextShot.characterIds.length === 0) && charNames.length > 0) {
        nextShot.characterIds = charNames.map((n: string) => charIdByName.get(n)).filter(Boolean) as string[]
      }
      if ((!nextShot.assetIds || nextShot.assetIds.length === 0) && assetNames.length > 0) {
        nextShot.assetIds = assetNames.map((n: string) => assetIdByName.get(n)).filter(Boolean) as string[]
      }
      if (!nextShot.frames.start.prompt && startPrompt) nextShot.frames.start.prompt = startPrompt
      if (!nextShot.frames.end.prompt && endPrompt) nextShot.frames.end.prompt = endPrompt
      if ((!nextShot.gridPrompts || nextShot.gridPrompts.length === 0) && gridPrompts.length > 0) nextShot.gridPrompts = gridPrompts
      nextShot.frameMode = defaultFrameMode
      mergedShots[i] = nextShot
    } else {
      const shot = createEmptyShot(title)
      shot.frameMode = defaultFrameMode
      shot.beat = beat
      shot.scriptExcerpt = scriptExcerpt
      shot.videoPrompt = videoPrompt
      shot.sceneId = sceneName && sceneIdByName.get(sceneName) ? sceneIdByName.get(sceneName) : undefined
      shot.characterIds = charNames.map((n: string) => charIdByName.get(n)).filter(Boolean) as string[]
      shot.assetIds = assetNames.map((n: string) => assetIdByName.get(n)).filter(Boolean) as string[]
      shot.frames.start.prompt = startPrompt
      shot.frames.end.prompt = endPrompt
      if (gridPrompts.length > 0) shot.gridPrompts = gridPrompts
      mergedShots.push(shot)
    }
  }

  if (targetShotCount > 0) {
    if (mergedShots.length > targetShotCount) {
      mergedShots.length = targetShotCount
    } else if (mergedShots.length < targetShotCount) {
      while (mergedShots.length < targetShotCount) {
        const idx = mergedShots.length
        const prev = idx > 0 ? mergedShots[idx - 1] : null
        const shot = createEmptyShot(`镜头 ${idx + 1}`)
        shot.frameMode = defaultFrameMode
        if (prev) {
          shot.sceneId = prev.sceneId
          shot.characterIds = Array.isArray(prev.characterIds) ? [...prev.characterIds] : []
          shot.assetIds = Array.isArray(prev.assetIds) ? [...prev.assetIds] : []
          shot.frames.start.prompt = String(prev.frames?.end?.prompt || prev.frames?.start?.prompt || '').trim()
          shot.frames.end.prompt = defaultFrameMode === 'first_only'
            ? ''
            : String(prev.frames?.end?.prompt || prev.frames?.start?.prompt || '').trim()
          if (isGridFrameMode(defaultFrameMode)) {
            const gridCount = SHOT_FRAME_MODES.find((m) => m.value === defaultFrameMode)?.count || 4
            const seed = String((prev.gridPrompts || [])[0] || shot.frames.start.prompt || '').trim()
            shot.gridPrompts = Array.from({ length: gridCount }, (_, i) => `${seed}（分镜 ${i + 1}/${gridCount}）`)
          }
        }
        mergedShots.push(shot)
      }
    }
  }

  next.shots = mergedShots
  next.updatedAt = Date.now()

  return { draft: next, analysis, rawText }
}
