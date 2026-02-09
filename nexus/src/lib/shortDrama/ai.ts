import { CHAT_MODELS, DEFAULT_CHAT_MODEL } from '@/config/models'
import { postJson } from '@/lib/workflow/request'
import { SHORT_DRAMA_STYLE_PRESETS, getShortDramaStylePresetById } from '@/lib/shortDrama/stylePresets'
import { createEmptyImageSlot, createEmptyShot, createEmptyAsset } from '@/lib/shortDrama/draftStorage'
import type { ShortDramaDraftV2, ShortDramaAssetCategory } from '@/lib/shortDrama/types'

const DEFAULT_ANALYSIS_MODEL = 'gemini-3-pro-preview-thinking'

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
  const targetShotCount = opts.draft.models.targetShotCount || 0
  const shotCountHint = targetShotCount > 0
    ? `用户要求生成恰好 ${targetShotCount} 个镜头。这是硬性约束，输出的 shots 数组长度必须严格等于 ${targetShotCount}，不多不少。如果剧本较短，则细化每句话拆成多个镜头角度来凑满数量；如果剧本较长，则合并次要动作保证精确数量。绝对禁止偏差。`
    : `请根据剧本内容自动决定镜头数量。原则：宁多勿少，每${videoDuration}秒为一个镜头，确保剧本的每一句台词、每一个动作、每一次情绪转折都有对应镜头，不要跳过任何细节。一般来说，一段500字的剧本至少需要15-25个镜头。`

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
    '【连续性要求 - 必须严格遵守】',
    '1) 镜头必须按剧情顺序排列，scriptExcerpt 必须覆盖原文并相互衔接，不能跳跃或遗漏。',
    '2) 每个镜头需要承接上一镜头的末状态（人物位置/动作/情绪/道具状态/场景变化），保证逻辑连贯。',
    '3) 若发生场景、服装、道具或人物关系变化，必须在 beat/提示词中明确写出过渡与原因。',
    '4) 道具/资产在前后镜头保持一致，除非剧情明确变化。',
    '',
    '【视频模型参数 - 严格遵守！】',
    `- 视频时长: ${videoDuration}秒（每个镜头的所有动作必须在${videoDuration}秒内自然完成）`,
    `- 首尾帧支持: ${supportsFirstLastFrame ? '支持（AI会根据首帧和尾帧生成过渡动画，所以 startPrompt 和 endPrompt 必须是明确不同的两个画面状态）' : '不支持（只有首帧起效，endPrompt 可简化）'}`,
    `- 视频比例: ${videoRatio}`,
    '',
    `【镜头数量要求 - 极其重要！】`,
    shotCountHint,
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
    '    "scriptExcerpt": "string  // 该镜头对应的原剧本片段（逐字引用原文，让用户清楚故事进展到哪里）",',
    '    "scene": "string",',
    '    "characters": ["string"],',
    '    "assets": ["string"],',
    '    "startPrompt": "string",',
    '    "endPrompt": "string",',
    '    "gridPrompts": ["string"],  // 宫格模式下每格的提示词（与frameMode对应的数量）',
    '    "videoPrompt": "string"',
    '  }]',
    '}',
    '',
    '=== 镜头连续性补充要求 (shots) ===',
    '1. shot 列表必须是严格时间顺序；每个 shot.title 可体现推进节点。',
    '2. scriptExcerpt 必须尽量逐字引用原剧本片段，前后镜头不可断层。',
    '3. startPrompt 要体现该镜头开始状态，endPrompt 要体现该镜头结束状态，且二者必须可形成自然过渡。',
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
    '这是直接送入AI绘图模型的提示词，必须是一段完整的、极致详细的画面描述，至少120字。',
    '提示词使用中文，搭配专业的摄影/电影术语。',
    '必须按以下固定结构输出，每个维度都不能省略：',
    '',
    '## 帧模式与宫格生成',
    '',
    '镜头支持多种帧模式，根据选定模式生成不同数量的提示词：',
    '- first_only: 仅生成 startPrompt（1张首帧）',
    '- first_last: 生成 startPrompt + endPrompt（首帧+尾帧，默认模式）',
    '- grid_4: 生成 4 格提示词（起-承-转-合），格式为 gridPrompts 数组',
    '- grid_6: 生成 6 格提示词（引入-发展-高潮前-高潮-回落-结尾）',
    '- grid_9: 生成 9 格提示词（3×3叙事网格，按从左到右、从上到下的阅读顺序）',
    '- grid_25: 生成 25 格提示词（5×5细粒度分镜）',
    '',
    '宫格模式规则：',
    '1. 每格提示词必须重复角色核心外貌特征（视觉锚点），确保一致性',
    '2. 每格标注景别变化（从全景到特写的递进，或根据叙事需要调整）',
    '3. 同组宫格内光影方向、色温保持统一',
    '4. 格间动势衔接：前格结束状态与后格起始状态逻辑连续',
    '5. 四宫格结构：Panel 1(起) → Panel 2(承) → Panel 3(转) → Panel 4(合)',
    '',
    '### 帧提示词固定结构（每条必须严格按此顺序）：',
    '',
    'A. 【镜头技术参数】（开头第一句）',
    '   格式: "[景别] shot, [焦段]mm lens, f/[光圈] [景深描述], [机位角度], [构图法则]"',
    '   景别: extreme close-up / close-up / medium close-up / medium shot / medium full shot / full shot / wide shot / extreme wide shot',
    '   焦段: 16mm(超广) / 24mm(广角) / 35mm(小广角) / 50mm(标准) / 85mm(人像) / 135mm(长焦) / 200mm+(超长焦)',
    '   光圈景深: f/1.4 shallow bokeh / f/2.8 moderate bokeh / f/5.6 balanced / f/11 deep focus',
    '   机位: eye-level / low angle / high angle / bird\'s eye / dutch angle / over-the-shoulder / POV',
    '   构图: rule of thirds / center frame / golden ratio / diagonal / leading lines / frame within frame / symmetrical',
    '',
    'B. 【主体人物完整描述】（必须从 characters 描述中提取，保证跨镜头一致性）',
    '   格式: "[角色名], [性别] [年龄段], [发型发色完整描述], [面部特征], [肤色], [表情/微表情], [身体姿势+朝向], [双手动作], [视线方向]"',
    '   服装: "[上装材质+颜色+款式], [下装], [鞋], [配饰逐一列出]"',
    '   多人镜头必须标注: "[人物A]在画面[位置], [人物B]在[位置], 距离约[X]m, [互动关系: 对视/背对/并肩/对峙]"',
    '',
    'C. 【资产/道具呈现】（如有）',
    '   格式: "[资产名] [在画面中的位置(前景/主体手中/桌面/背景)], [状态(握持方式/放置角度/光效)]"',
    '',
    'D. 【场景环境完整描述】',
    '   格式: "[场景名], [空间类型], [关键物件及位置], [地面/墙面材质], [天气/时段]"',
    '',
    'E. 【光影系统】',
    '   格式: "Key light: [方向] [类型] [色温K], [强度]. Fill: [描述]. Rim/back light: [描述]. Shadow: [方向], [软硬程度]"',
    '   示例: "Key light: top-left 45° warm natural sunlight 4500K, bright. Fill: ambient bounce from white ceiling. Rim light: subtle backlight creating hair glow. Shadows: falling to lower-right, soft edges"',
    '',
    'F. 【色彩与氛围】',
    '   格式: "Color palette: [主色], [辅色], [点缀色]. Color grade: [暖调/冷调/中性]. Mood: [氛围词1], [氛围词2], [氛围词3]"',
    '',
    'G. 【画质关键词】（结尾）',
    '   固定附加: "masterpiece, best quality, ultra-detailed, 8K resolution, photorealistic/[对应画风], cinematic lighting, professional photography"',
    '   否定词（在提示词末尾用括号标注）: "(no distortion, no artifacts, no watermark, no text overlay, no blurry, no extra limbs)"',
    '',
    '### 示例（好的 startPrompt）：',
    '"中景镜头，50mm标准镜头，f/2.8中等虚化，微俯视角度，三分法构图。',
    '林月，年轻女性20岁出头，齐肩内扣黑色直发留斜刘海，鹅蛋脸型，白皙瓷感肌肤，大杏眼深棕色瞳孔配浓密睫毛，自然粉色双唇，穿着米白色羊绒高领毛衣搭配深藏青色高腰百褶裙，银色耳钉，盘腿坐在复古红木阅读椅中，上身微微前倾，双手捧着一本陈旧的皮面精装书，左手拇指按住泛黄的书页边缘，右手食指沿文字轨迹缓缓滑动，低眉垂眸专注阅读，嘴角带着若有似无的浅笑。',
    '复古黄铜台灯在右侧投出温暖的光池照亮书页。',
    '1920年代风格私人书房内景，落地至天花板的深色橡木书架密密麻麻排列精装书填满背景，脚下铺着勃艮第红与金色的波斯地毯，左侧高拱窗射入的光束中可见细微灰尘颗粒浮动。',
    '主光：左侧45°暖色自然窗光4000K，柔和且经薄纱窗帘漫射。补光：木质表面的暖色环境反射。轮廓光：台灯在发顶形成细微金色光晕。阴影：向右下方延伸，柔和渐变边缘。',
    '色彩基调：深胡桃木棕、古金色、米白色。色调：暖琥珀调。氛围：怀旧、私密、文艺、沉思。',
    '大师级画质，超精细，8K分辨率，照片写实，电影级光影，专业人像摄影。（无畸变、无瑕疵、无水印、无文字叠加）"',
    '',
    '=== 视频脚本规范 (shots.videoPrompt) — 极其重要 ===',
    '这是送入AI视频模型的运动脚本。',
    '必须是一段连贯的、电影级的运动描述，中文，至少80字。',
    '绝对禁止出现任何秒数/时间戳（如"0-2s"、"第3秒"等）。用叙事阶段（起始/发展/高潮）组织节奏。',
    '',
    '### videoPrompt 固定结构（严格按此顺序）：',
    '',
    'A. 【Camera Movement 镜头运动】（开头第一句）',
    '   格式: "Camera [运动类型] at [速度], [幅度], [轨迹描述]"',
    '   运动类型: push in / pull out / pan left / pan right / tilt up / tilt down / tracking / orbit / crane up / crane down / dolly / steadicam / handheld',
    '   速度: very slowly / slowly / steadily / gradually accelerating / rapidly',
    '   幅度: subtle / moderate / wide / sweeping',
    '   可组合: "Camera slowly pushes in while gently tilting down, transitioning from wide to medium close-up"',
    '',
    'B. 【Opening Phase 起始阶段】',
    '   描述镜头开始时的画面状态和最初的动态：',
    '   - 角色初始姿势和动作起点',
    '   - 场景中的环境动态（风吹动窗帘、光影流动、雨滴落下）',
    '   - 初始氛围和节奏基调',
    '',
    'C. 【Development Phase 发展阶段】',
    '   描述核心动作的展开过程：',
    '   - 角色的连续动作链（如 "right hand slowly rises → fingers gently touch the cheek → palm cups the face"）',
    '   - 表情演变弧线（如 "calm → slight surprise → brows furrowing → bittersweet smile forming"）',
    '   - 多人互动变化（如 "A steps forward, B instinctively retreats half a step, their eyes locked"）',
    '   - 道具/资产互动（如 "slowly draws the sword from the waist, blade catching a cold glint of light"）',
    '   - 焦点转移（如 "focus racks from the letter in foreground to the character\'s face in background"）',
    '',
    'D. 【Climax Phase 高潮/定格阶段】',
    '   描述镜头结束前的情绪顶点或定格状态：',
    '   - 最终姿势和表情定格',
    '   - 情绪的最终状态',
    '   - 环境对情绪的呼应（如 "a gust of wind sweeps through, scattering cherry blossom petals across the frame"）',
    '',
    'E. 【Environment Dynamics 环境动态】（贯穿全程）',
    '   - 自然元素: 风/雨/雪/光线变化/云层移动',
    '   - 物件动态: 窗帘飘动/烛光摇曳/水面波纹/树叶飘落',
    '   - 光影变化: 光束移动/阴影延伸/色温渐变',
    '',
    'F. 【Quality Tags 质量标签】（结尾）',
    '   固定附加: "cinematic motion, smooth movement, professional cinematography, natural physics, fluid animation"',
    '   否定词: "(no jitter, no teleporting, no frozen frames, no unnatural movement, no morphing artifacts)"',
    '',
    '### 示例（好的 videoPrompt）：',
    '"镜头以极缓速度从中景向前推进至中近景，轻微手持质感增添真实感。',
    '【起始】年轻女子静坐不动，手指停驻在翻开的书页上，暖黄色台灯光在她脸颊上铺开柔和的金色调，窗边光束中灰尘颗粒缓缓飘浮。',
    '【发展】她的手指在某一行文字处停顿，眉心微微蹙起。她缓缓从书本上抬起目光望向画面右侧——瞳孔微微放大，嘴唇轻轻张开，仿佛感知到了某种意料之外的存在。手中的书几乎不可察觉地微微颤抖。',
    '【高潮】她的表情从惊讶转为复杂的情绪交织——眼眶泛起最细微的水光，却强忍住，嘴角挤出一丝脆弱的半笑。她缓缓合上书本，双手将书抵在胸口。背景中，薄纱窗帘被无形的微风轻轻吹拂向内飘动。',
    '电影级运动，平滑流畅，专业摄影，自然物理效果，流体动画。（无抖动、无瞬移、无冻结帧、无非自然运动）"',
    '',
    '=== 其他约束 ===',
    '- 字段不确定时留空字符串/空数组，不要省略字段。',
    '- assets 只提取剧情中重要的、需保持一致性的物品。',
    '- shots.assets 填该镜头出现的资产名称数组。',
    '- 每个 startPrompt 至少120字中文，每个 videoPrompt 至少80字中文，不得敷衍！',
    '- startPrompt/endPrompt/videoPrompt 使用中文描述，搭配专业摄影/电影术语。',
    '- videoPrompt 绝对禁止出现秒数时间戳（如"0-2s"、"第3秒"），只用 起始/发展/高潮 阶段描述节奏。',
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

  const modelKey = DEFAULT_ANALYSIS_MODEL // 固定使用 gemini-3-pro-preview-thinking，不可更改
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
      '如果剧本很长：最多输出 60 个 shots；宁可减少镜头数，也不要输出不完整 JSON。',
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
      mergedShots[i] = nextShot
    } else {
      const shot = createEmptyShot(title)
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

  next.shots = mergedShots
  next.updatedAt = Date.now()

  return { draft: next, analysis, rawText }
}

