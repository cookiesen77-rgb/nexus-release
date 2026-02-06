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
  const payload: any = { model: modelCfg.key, messages, temperature: 0.3, max_tokens: 16384 }
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
    '你是顶级短剧/漫剧分镜制作大师，擅长将文字剧本转化为专业级视觉分镜脚本。',
    '你必须输出严格的 JSON，不要输出任何解释、Markdown 或多余文字。',
    '目标：从剧本中提取角色、场景、重要资产、镜头列表，并为每个镜头生成电影级的首帧/尾帧画面描述词，以及精确到秒的视频动作/运镜脚本。',
    '核心原则：人物一致性、场景一致性、资产一致性、镜头语言专业、画面细节极致丰富、视频脚本精确可执行。',
    '',
    '【视频模型参数 - 严格遵守！】',
    `- 视频时长: ${videoDuration}秒（每个镜头的所有动作必须在${videoDuration}秒内自然完成）`,
    `- 首尾帧支持: ${supportsFirstLastFrame ? '支持（AI会根据首帧和尾帧生成过渡动画，所以 startPrompt 和 endPrompt 必须是明确不同的两个画面状态）' : '不支持（只有首帧起效，endPrompt 可简化）'}`,
    `- 视频比例: ${videoRatio}`,
    '',
    userStyleContext ? `【用户已选择的风格】\n${userStyleContext}\n所有提示词必须严格遵循此风格基调。\n` : '',
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
    '=== 角色描述规范 (characters.description) ===',
    '必须包含以下全部维度，确保跨镜头人物一致性：',
    '1. 面部特征：脸型、眼睛（形状/颜色/大小）、眉型、鼻型、唇形、肤色、特殊标记（痣/疤/雀斑）',
    '2. 发型发色：具体发型（如"齐肩内扣黑色直发留斜刘海"）、发色、染发/挑染细节',
    '3. 身材体型：身高范围、体型（纤细/匀称/健壮/丰满）、体态特征',
    '4. 服装造型：从上到下完整描述每件衣物（材质+颜色+款式），如"白色真丝衬衫+墨绿色高腰阔腿裤+黑色尖头高跟鞋"',
    '5. 固定配饰：眼镜、耳饰、项链、手表、戒指等，精确到材质和样式',
    '6. 气质标签：整体气质（冷艳/温柔/干练/忧郁/邪魅）、标志性微表情',
    '',
    '=== 场景描述规范 (scenes.description) ===',
    '必须包含全部维度，确保跨镜头场景一致性：',
    '1. 空间定义：室内/室外、具体场景名（如"90年代风格的旧书店二楼"）',
    '2. 空间布局：主要物件摆放位置和空间关系',
    '3. 标志物件：场景中最醒目的3-5个物件',
    '4. 光线设定：光源类型+方向+色温+强度（如"落地窗侧的暖黄自然光，形成45度侧逆光"）',
    '5. 时段天气：具体时段（清晨/正午/黄昏/深夜）+ 天气状态',
    '6. 色彩基调：主色调+辅色调+点缀色（如"以深胡桃木色和暗金色为主，点缀暗红色天鹅绒"）',
    '7. 氛围质感：墙面/地面材质、光影氛围词',
    '',
    '=== 资产描述规范 (assets) ===',
    '仅提取剧情中反复出现或具有象征意义的物品，描述必须包含：',
    '- 外观：形状、尺寸、材质、颜色、图案、装饰',
    '- 状态：新旧、损坏、发光/特效',
    '- 独特标记：可识别的刻印/纹饰/设计',
    '- owners：使用此资产的角色名称数组',
    '',
    '=== 镜头帧描述规范 (shots.startPrompt / endPrompt) — 极其重要 ===',
    '这是直接送入AI绘图模型的提示词，必须是一段完整的、极致详细的画面描述，至少80字。',
    '必须包含以下全部要素：',
    '',
    '1. 【景别与镜头】明确指定：',
    '   - 景别：大特写/特写/近景/中近景/中景/中全景/全景/大全景',
    '   - 焦段感：广角(24mm以下)/标准(35-50mm)/中长焦(85mm)/长焦(135mm+)',
    '   - 景深：浅景深f1.4虚化 / 中景深f4 / 全景深f11+',
    '',
    '2. 【机位与构图】：',
    '   - 角度：平视/微俯/俯视/鸟瞰/微仰/仰视/荷兰角',
    '   - 构图法则：三分法/中心对称/黄金螺旋/对角线/引导线/框架构图',
    '   - 画面重心位置：主体在画面的哪个区域',
    '',
    '3. 【人物状态】完整描述：',
    '   - 身体姿势：站/坐/蹲/跪/躺+具体朝向（正面/侧面45°/背影/四分之三侧）',
    '   - 手部动作：双手分别在做什么',
    '   - 面部表情：具体微表情描述',
    '   - 视线方向：看向哪里（镜头/画面外/某人/某物）',
    '',
    '4. 【人物关系与空间位置】（多人镜头必写）：',
    '   - 人物之间的距离和相对位置（如"A站在画面左侧前景，B在右侧中景"）',
    '   - 互动关系：对视/背对/并肩/对峙/拥抱/牵手等',
    '   - 视线交汇：谁在看谁，目光是否有交集',
    '',
    '5. 【资产呈现】（如果该镜头包含资产）：',
    '   - 资产在画面中的位置（前景/主体手中/背景）',
    '   - 资产状态（握持方式/放置角度/发光效果）',
    '',
    '6. 【光影与氛围】：',
    '   - 主光源位置和类型（如"左侧45°暖色调窗光作为主光"）',
    '   - 补光/轮廓光/逆光效果',
    '   - 整体色调和情绪氛围词',
    '',
    '示例（好的 startPrompt）：',
    '"中景(50mm标准镜头，f2.8浅景深)，微俯视角度，三分法构图，年轻女子坐在旧书店深处的红木圆桌旁，身体微微前倾，双手捧着一本泛黄的精装书，',
    '左手指尖轻抵书页边缘，右手食指沿文字缓缓滑动，低眉垂眸专注阅读，睫毛在眼下投出细密阴影，嘴角微微上翘带着若有似无的浅笑，',
    '头顶的复古黄铜吊灯投下温暖的柔光，在她发顶形成金色的光环，背景是模糊的层层旧书架，空气中似乎可见细微的灰尘颗粒在光束中浮动，',
    '整体色调为暗金色与胡桃木色的暖调，氛围宁静而怀旧，带有浓厚的文艺气息"',
    '',
    '=== 视频脚本规范 (shots.videoPrompt) — 极其重要 ===',
    `这是送入AI视频模型的运动脚本，必须精确到每一秒的动作编排。时长严格为${videoDuration}秒。`,
    '必须是一段连贯的、电影级的运动描述，至少60字，包含以下全部要素：',
    '',
    '1. 【镜头运动轨迹】必须明确指定：',
    '   - 运动类型：推(push in)/拉(pull out)/左摇(pan left)/右摇(pan right)/上摇(tilt up)/下摇(tilt down)/跟拍(tracking)/环绕(orbit)/升(crane up)/降(crane down)/手持晃动(handheld)',
    '   - 运动速度：极缓(very slow)/缓慢(slow)/匀速(steady)/渐快(accelerating)/急速(fast)',
    '   - 运动幅度：微幅(subtle)/中幅(moderate)/大幅(wide)',
    '',
    '2. 【角色动作编排】按时间顺序：',
    '   - 肢体动作：具体动作过程（如"右手缓缓抬起→手指轻触对方脸颊→手掌贴合面庞"）',
    '   - 表情演变：情绪的渐变过程（如"平静→微愣→眉心微蹙→嘴角苦涩上扬"）',
    '   - 动作节奏：动作的快慢节奏变化',
    '',
    '3. 【角色互动】（多人镜头必写）：',
    '   - 人物间的动作互动（如"A向前一步，B下意识后退半步"）',
    '   - 目光互动变化（如"对视→一方移开目光→另一方追随目光"）',
    '',
    '4. 【资产互动】（如果有资产）：',
    '   - 角色与资产的互动过程（如"右手缓缓拔出腰间长剑，剑身在光线中反射出一道冷冽银光"）',
    '',
    '5. 【焦点变化】：',
    '   - 焦点如何转移（如"焦点从前景手中的信件拉到后景人物面部"）',
    '',
    '6. 【环境动态】：',
    '   - 风/光影/背景运动（如"窗帘被风缓缓吹起，光影在墙上流动"）',
    '',
    `7. 【时间节拍】按${videoDuration}秒编排：`,
    videoDuration <= 6
      ? '   - 0-2s：起始动作/建立镜头\n   - 2-4s：核心动作/情绪高潮\n   - 4-6s：收束/情绪定格'
      : '   - 0-3s：起始动作/建立镜头\n   - 3-7s：核心动作/情绪发展与高潮\n   - 7-10s：收束/情绪定格或转折',
    '',
    '示例（好的 videoPrompt）：',
    `"镜头以极缓速度从中景向前推进(slow push in)。0-${Math.floor(videoDuration * 0.3)}s：女子保持低头阅读姿势，手指沿书页缓缓移动，窗外的光线透过窗帘在她脸上形成斑驳光影；`,
    `${Math.floor(videoDuration * 0.3)}-${Math.floor(videoDuration * 0.7)}s：她突然停下手指，眉心微微蹙起，缓缓抬眼望向画面右侧——似乎听到了什么声响，瞳孔微微放大，嘴唇轻轻张开；`,
    `${Math.floor(videoDuration * 0.7)}-${videoDuration}s：镜头推至面部近景，她的表情从惊讶转为复杂的情绪——眼眶微微泛红，却强忍住情绪，嘴角挤出一丝勉强的微笑，手中的书微微颤抖。背景中窗帘被风轻轻吹起。"`,
    '',
    '=== 其他约束 ===',
    '- 字段不确定时留空字符串/空数组，不要省略字段。',
    '- assets 只提取剧情中重要的、需保持一致性的物品。',
    '- shots.assets 填该镜头出现的资产名称数组。',
    '- 每个 startPrompt 至少80字，每个 videoPrompt 至少60字，不得敷衍！',
    '- startPrompt/endPrompt 中必须包含该镜头所有出场角色的完整外貌描述（从 characters 中提取），确保一致性。',
    '- styleSuggestion.presetId 必须从下列中选一个，否则留空字符串：',
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

