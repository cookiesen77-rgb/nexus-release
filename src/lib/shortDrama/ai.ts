import { CHAT_MODELS, DEFAULT_CHAT_MODEL } from '@/config/models'
import { postJson } from '@/lib/workflow/request'
import { SHORT_DRAMA_STYLE_PRESETS, getShortDramaStylePresetById } from '@/lib/shortDrama/stylePresets'
import { createEmptyImageSlot, createEmptyShot, createEmptyAsset } from '@/lib/shortDrama/draftStorage'
import type { ShortDramaDraftV2, ShortDramaAssetCategory } from '@/lib/shortDrama/types'

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
    const rsp = await postJson<any>(modelCfg.endpoint, payload, { authMode: modelCfg.authMode, timeoutMs: 240000 })
    const parts = rsp?.candidates?.[0]?.content?.parts || []
    const text = Array.isArray(parts) ? parts.map((p: any) => p?.text).filter(Boolean).join('') : ''
    return normalizeText(text)
  }

  // OpenAI Responses API
  if (format === 'openai-responses') {
    const payload: any = { model: modelCfg.key, input: messages }
    const rsp = await postJson<any>(modelCfg.endpoint, payload, { authMode: modelCfg.authMode, timeoutMs: 240000 })
    return normalizeText(extractTextFromResponses(rsp))
  }

  // Default: OpenAI Chat Completions-like
  const payload: any = { model: modelCfg.key, messages, temperature: 0.2 }
  const rsp = await postJson<any>(modelCfg.endpoint, payload, { authMode: modelCfg.authMode, timeoutMs: 240000 })
  const content = rsp?.choices?.[0]?.message?.content
  if (typeof content === 'string') return normalizeText(content)
  if (Array.isArray(content)) return normalizeText(content.map((c: any) => c?.text || c).filter(Boolean).join(''))
  return normalizeText(String(content || ''))
}

const stripCodeFences = (raw: string) => {
  const t = String(raw || '').trim()
  return t.replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/```$/i, '').trim()
}

class ShortDramaParseError extends Error {
  rawText: string
  constructor(message: string, rawText: string) {
    super(message)
    this.name = 'ShortDramaParseError'
    this.rawText = rawText
  }
}

const extractFirstJsonObject = (raw: string) => {
  const t = stripCodeFences(raw)
  const start = t.indexOf('{')
  if (start === -1) return ''

  let depth = 0
  let inString = false
  let escaped = false

  for (let i = start; i < t.length; i++) {
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
        continue
      }
      continue
    }

    if (ch === '"') {
      inString = true
      continue
    }
    if (ch === '{') {
      depth++
      continue
    }
    if (ch === '}') {
      depth--
      if (depth === 0) return t.slice(start, i + 1)
      continue
    }
  }
  return ''
}

const parseJsonLoose = (raw: string) => {
  const json = extractFirstJsonObject(raw)
  if (!json) return null
  try {
    return JSON.parse(json)
  } catch {
    return null
  }
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
    scene?: string
    characters?: string[]
    assets?: string[]
    startPrompt: string
    endPrompt: string
    videoPrompt?: string
  }[]
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

  const presetHints = SHORT_DRAMA_STYLE_PRESETS.map((p) => `- ${p.id}: ${p.name}`).join('\n')

  // 构建视频模型上下文信息
  const videoCtx = opts.videoModelInfo
  const videoDuration = videoCtx?.duration || opts.draft.models.videoDuration || 5
  const supportsFirstLastFrame = videoCtx?.supportsFirstLastFrame ?? true
  const videoRatio = videoCtx?.ratio || opts.draft.models.videoRatio || '9:16'

  // 根据用户已选择的风格构建风格提示
  const stylePreset = opts.draft.style.presetId ? getShortDramaStylePresetById(opts.draft.style.presetId) : null
  const userStyleContext = [
    opts.draft.style.customText ? `用户自定义风格: ${opts.draft.style.customText}` : '',
    stylePreset ? `用户选择的预设风格: ${stylePreset.name} - ${stylePreset.baseStyleText}` : '',
    opts.draft.style.negativeText ? `用户指定的负面提示词: ${opts.draft.style.negativeText}` : '',
  ].filter(Boolean).join('\n')

  const system = [
    '你是专业短剧/漫剧分镜制作助手，擅长将文字剧本转化为高质量的视觉分镜脚本。',
    '你必须输出严格的 JSON，不要输出任何解释、Markdown 或多余文字。',
    '目标：从剧本中提取角色、场景、重要资产（武器/道具/物品）、镜头列表，并为每个镜头生成详细的首帧/尾帧提示词，以及详细的视频动作/运镜提示词。',
    '核心原则：人物一致性、场景一致性、资产一致性、画面细节丰富、运镜专业。',
    '',
    '【视频模型参数 - 重要！】',
    `- 视频时长: ${videoDuration}秒 (每个镜头的动作需要在${videoDuration}秒内完成，不要设计过于复杂的动作)`,
    `- 首尾帧支持: ${supportsFirstLastFrame ? '支持（AI会根据首帧和尾帧生成过渡动画）' : '不支持（只有首帧，尾帧会被忽略）'}`,
    `- 视频比例: ${videoRatio}`,
    '',
    supportsFirstLastFrame
      ? '因为支持首尾帧，你需要为每个镜头设计明确不同的startPrompt和endPrompt，它们应该体现动作的起始和结束状态。'
      : '因为不支持尾帧，endPrompt可以简化或与startPrompt相似，重点关注videoPrompt中的动作描述。',
    '',
    userStyleContext ? `【用户已选择的风格】\n${userStyleContext}\n请确保所有提示词符合用户选择的风格。\n` : '',
    '输出 JSON schema（键名必须使用英文）：',
    '{',
    '  "title": "string",',
    '  "logline": "string",',
    '  "styleSuggestion": { "presetId": "string", "customText": "string", "negativeText": "string" },',
    '  "characters": [{ "name": "string", "description": "string" }],',
    '  "scenes": [{ "name": "string", "description": "string" }],',
    '  "assets": [{',
    '    "name": "string",',
    '    "description": "string",',
    '    "category": "weapon|prop|vehicle|accessory|item|other",',
    '    "owners": ["string"]',
    '  }],',
    '  "shots": [{',
    '    "title": "string",',
    '    "beat": "string",',
    '    "scene": "string",',
    '    "characters": ["string"],',
    '    "assets": ["string"],',
    '    "startPrompt": "string",',
    '    "endPrompt": "string",',
    '    "videoPrompt": "string"',
    '  }]',
    '}',
    '',
    '【角色描述要求 - characters.description】',
    '必须包含以下所有维度，确保AI生成图片时人物一致：',
    '- 面部特征：脸型、眼睛形状与颜色、眉型、鼻型、嘴唇、肤色、是否有痣/疤痕等标记',
    '- 发型发色：具体发型（如"齐肩黑色直发带刘海"）、发色、是否染发/挑染',
    '- 身材体型：身高（高/中/矮）、体型（纤细/匀称/健壮/丰满）、肩宽、腰线',
    '- 服装造型：具体服饰描述（如"白色衬衫+深蓝色西装外套+黑色窄腿裤"）、风格标签',
    '- 配饰道具：眼镜、耳环、项链、手表、包包等固定配饰',
    '- 气质神态：整体气质（冷艳/温柔/干练/忧郁）、标志性表情或姿态',
    '示例："25岁女性，鹅蛋脸，大而明亮的杏眼，自然黑色长直发及腰，身材纤细高挑约170cm，穿着米白色高领毛衣搭配浅驼色大衣，颈间佩戴一条细银链坠有小星星吊坠，气质温婉知性，常带淡淡微笑"',
    '',
    '【场景描述要求 - scenes.description】',
    '必须包含以下维度，确保场景一致性：',
    '- 空间类型：室内/室外、具体地点（如"现代简约风格客厅"）',
    '- 空间布局：主要家具/物品摆放、空间大小感',
    '- 关键道具：场景中标志性物品（如"落地窗前的灰色布艺沙发"）',
    '- 光线条件：自然光/人工光、光源方向、明暗对比、色温（暖/冷/中性）',
    '- 时间天气：白天/夜晚、晴天/阴天/雨天/雪天',
    '- 色彩基调：主色调（如"以白色和原木色为主"）、整体氛围',
    '- 环境细节：墙面材质、地面材质、植物装饰等',
    '示例："现代简约风格客厅，面积约30平米，大落地窗朝南，自然光充足，窗前摆放深灰色L型布艺沙发，对面是白色电视柜和55寸壁挂电视，地面是浅色橡木地板，墙面纯白色，角落有一盆高大的龟背竹，整体色调为白+灰+原木色，氛围温馨明亮"',
    '',
    '【资产描述要求 - assets】',
    '资产是角色使用的重要物品，需要在多个镜头中保持一致。包括：',
    '- 武器(weapon)：剑、枪、弓箭、魔杖、盾牌等',
    '- 道具(prop)：信件、书籍、钥匙、地图、宝石、药瓶等剧情关键物品',
    '- 载具(vehicle)：马匹、汽车、飞船、摩托等',
    '- 配饰(accessory)：特殊戒指、项链、面具、徽章等有剧情意义的配饰',
    '- 物品(item)：手机、相机、乐器、工具等角色常用物品',
    '',
    '资产描述必须包含：',
    '- 外观特征：形状、大小、材质、颜色、图案、装饰细节',
    '- 状态特征：新旧程度、是否有损坏、是否发光/有特效',
    '- 独特标记：刻印、纹路、独特设计等可识别特征',
    '- owners：指定哪些角色会使用此资产（填角色名称数组）',
    '',
    '示例（武器）："一把古老的双手剑，剑身长约120cm，由暗银色金属铸造，剑刃锋利带有淡蓝色寒光，剑柄缠绕深棕色皮革，护手处刻有龙形纹饰，剑身中央有一道浅浅的裂痕，整体风格古朴厚重"',
    '示例（道具）："一封泛黄的旧信，折叠整齐的信纸呈长方形，边缘略有磨损，信封上有红色蜡封，蜡封上印有玫瑰花纹，整体有历史感"',
    '',
    '【镜头帧描述要求 - shots.startPrompt / endPrompt】',
    '必须是完整的、可直接用于AI图片生成的画面描述，包含：',
    '- 景别：特写(close-up)、近景(medium close-up)、中景(medium shot)、全景(full shot)、远景(wide shot)',
    '- 机位角度：平视、俯视、仰视、斜侧面、正面、背影',
    '- 画面构图：三分法、中心构图、对角线构图、框架构图等',
    '- 人物状态：具体动作姿势、表情神态、视线方向、手部动作',
    '- 资产呈现：如果镜头中有资产，必须描述资产的位置、状态、与人物的关系',
    '- 光影效果：主光源位置、阴影方向、是否有逆光/侧光/轮廓光',
    '- 景深效果：前景虚化、背景虚化、全景深',
    '- 氛围渲染：色调滤镜、情绪氛围词（温馨/紧张/忧伤/浪漫）',
    '示例："中景，略微仰视角度，年轻女子站在落地窗前，侧身45度面向镜头，右手轻抚窗帘，眼神望向窗外若有所思，自然光从窗户洒入在她脸上形成柔和的侧光，发丝被光线勾勒出金色轮廓，背景虚化呈现室内温暖色调，整体氛围宁静而略带忧伤"',
    '',
    '【视频动作描述要求 - shots.videoPrompt】',
    `重要：每个视频时长为${videoDuration}秒，动作设计必须在这个时间内可完成！`,
    '必须包含具体的动态变化，用于AI视频生成：',
    '- 角色动作：具体肢体动作过程（如"缓缓转身，目光从窗外收回看向门口"）',
    '- 表情变化：情绪转变（如"眉头微蹙逐渐舒展为释然的微笑"）',
    '- 资产互动：如果镜头涉及资产，描述角色与资产的互动（如"右手缓缓拔出腰间长剑，剑身反射出冷冽光芒"）',
    '- 镜头运动：推(push in)、拉(pull out)、摇(pan)、移(dolly)、跟(tracking)、升降(crane)',
    '- 运动速度：缓慢、匀速、加速、急速',
    '- 焦点变化：焦点转移（如"焦点从前景花瓶转移到背景人物"）',
    '- 环境动态：风吹窗帘、光影变化、背景人物走动等',
    `- 时间把控：${videoDuration}秒内的动作应简洁有力，不要设计过于复杂需要长时间的动作序列`,
    '示例："镜头缓慢推进(slow push in)，女子保持凝望窗外的姿势，微风轻拂窗帘和她的发丝，她缓缓眨眼，嘴角微微上扬露出一丝苦笑，眼眶逐渐泛红，一滴泪珠滑落脸颊，镜头继续推近至面部特写，背景逐渐虚化"',
    '',
    '【其他约束】',
    '- 如果 scene、characters、assets 不确定，可以留空字符串/空数组，但不要省略字段。',
    '- assets 只提取剧情中重要的、需要保持一致性的物品，不要提取普通背景物品。',
    '- shots.assets 填写该镜头中出现的资产名称数组。',
    '- styleSuggestion.presetId 必须从下列列表中选择一个，否则填空字符串：',
    presetHints,
  ].join('\n')

  const user = [
    '请分析下面的短剧剧本，并输出 JSON（只输出 JSON）。',
    '',
    '【剧本】',
    script,
  ].join('\n')

  const modelKey = String(opts.modelKey || opts.draft.models.analysisModelKey || DEFAULT_CHAT_MODEL).trim()
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
      '如果剧本很长：最多输出 30 个 shots；宁可减少镜头数，也不要输出不完整 JSON。',
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
      throw new ShortDramaParseError('剧本解析失败：模型未返回合法 JSON', rawText)
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

    const existing = mergedShots[i]
    if (existing) {
      const nextShot = { ...existing }
      if (!nextShot.title || /^镜头\s+\d+$/.test(nextShot.title)) nextShot.title = title
      if (!nextShot.beat && beat) nextShot.beat = beat
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
      mergedShots[i] = nextShot
    } else {
      const shot = createEmptyShot(title)
      shot.beat = beat
      shot.videoPrompt = videoPrompt
      shot.sceneId = sceneName && sceneIdByName.get(sceneName) ? sceneIdByName.get(sceneName) : undefined
      shot.characterIds = charNames.map((n: string) => charIdByName.get(n)).filter(Boolean) as string[]
      shot.assetIds = assetNames.map((n: string) => assetIdByName.get(n)).filter(Boolean) as string[]
      shot.frames.start.prompt = startPrompt
      shot.frames.end.prompt = endPrompt
      mergedShots.push(shot)
    }
  }

  next.shots = mergedShots
  next.updatedAt = Date.now()

  return { draft: next, analysis, rawText }
}

