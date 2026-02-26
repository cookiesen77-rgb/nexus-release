import { CHAT_MODELS, DEFAULT_CHAT_MODEL } from '@/config/models'
import { postJson } from '@/lib/workflow/request'
import type {
  ShortDramaDraftV2,
  ShortDramaCharacter,
  ShortDramaScene,
  ShortDramaShot,
  CalibrationStatus,
  ShortDramaCharacterAnchors,
} from '@/lib/shortDrama/types'

type ChatRole = 'system' | 'user' | 'assistant'
type ChatMessage = { role: ChatRole; content: string }

type ModelCfg = { key: string; endpoint: string; authMode?: any; format: string }

const normalizeText = (t: unknown) => String(t || '').replace(/\r\n/g, '\n').trim()

const pickModel = (key: string): ModelCfg => {
  const k = String(key || '').trim() || DEFAULT_CHAT_MODEL
  const cfg = (CHAT_MODELS as any[]).find((m) => String(m?.key || '') === k) || (CHAT_MODELS as any[])[0]
  if (!cfg) throw new Error('未找到对话模型配置')
  return cfg as ModelCfg
}

const callChatModel = async (modelKey: string, messages: ChatMessage[]): Promise<string> => {
  const modelCfg = pickModel(modelKey)
  const format = String(modelCfg.format || '').trim()

  if (format === 'gemini-chat') {
    const system = messages.find((m) => m.role === 'system')?.content || ''
    const contents = messages
      .filter((m) => m.role !== 'system')
      .map((m) => ({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.content }] }))
    const payload: Record<string, unknown> = { contents, generationConfig: { maxOutputTokens: 32768 } }
    if (system) payload.systemInstruction = { parts: [{ text: system }] }
    const rsp = await postJson<any>(modelCfg.endpoint, payload, { authMode: modelCfg.authMode, timeoutMs: 300000 })
    const parts = rsp?.candidates?.[0]?.content?.parts || []
    return normalizeText(Array.isArray(parts) ? parts.map((p: any) => p?.text).filter(Boolean).join('') : '')
  }

  if (format === 'anthropic-chat') {
    const system = messages.find((m) => m.role === 'system')?.content || ''
    const nonSys = messages.filter((m) => m.role !== 'system').map((m) => ({ role: m.role as 'user' | 'assistant', content: m.content }))
    const payload: Record<string, unknown> = { model: modelCfg.key, max_tokens: 32768, messages: nonSys }
    if (system) payload.system = system
    const rsp = await postJson<any>(modelCfg.endpoint, payload, { authMode: modelCfg.authMode, timeoutMs: 300000, extraHeaders: { 'anthropic-version': '2023-06-01' } })
    const content = rsp?.content
    if (Array.isArray(content)) return normalizeText(content.map((b: any) => b?.text || '').filter(Boolean).join(''))
    return normalizeText(String(content || ''))
  }

  if (format === 'openai-responses') {
    const payload: Record<string, unknown> = { model: modelCfg.key, input: messages, max_output_tokens: 32768 }
    const rsp = await postJson<any>(modelCfg.endpoint, payload, { authMode: modelCfg.authMode, timeoutMs: 300000 })
    if (typeof rsp?.output_text === 'string') return normalizeText(rsp.output_text)
    return ''
  }

  const payload: Record<string, unknown> = { model: modelCfg.key, messages, temperature: 0.3, max_tokens: 32768 }
  const rsp = await postJson<any>(modelCfg.endpoint, payload, { authMode: modelCfg.authMode, timeoutMs: 300000 })
  const content = rsp?.choices?.[0]?.message?.content
  if (typeof content === 'string') return normalizeText(content)
  if (Array.isArray(content)) return normalizeText(content.map((c: any) => c?.text || c).filter(Boolean).join(''))
  return normalizeText(String(content || ''))
}

const stripCodeFences = (raw: string) =>
  String(raw || '').trim().replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/```$/i, '').trim()

const extractFirstJsonObject = (raw: string) => {
  const t = stripCodeFences(raw)
  const start = t.indexOf('{')
  if (start === -1) return ''
  let depth = 0, inString = false, escaped = false
  for (let i = start; i < t.length; i++) {
    const ch = t[i]
    if (inString) { if (escaped) { escaped = false; continue } if (ch === '\\') { escaped = true; continue } if (ch === '"') inString = false; continue }
    if (ch === '"') { inString = true; continue }
    if (ch === '{') { depth++; continue }
    if (ch === '}') { depth--; if (depth === 0) return t.slice(start, i + 1) }
  }
  return ''
}

const parseJsonLoose = (raw: string) => {
  const json = extractFirstJsonObject(raw)
  if (!json) return null
  try { return JSON.parse(json) } catch { return null }
}

// ── Character Calibration ──

export interface CharacterCalibrationResult {
  calibratedDescription: string
  anchors?: ShortDramaCharacterAnchors
  negativePrompt?: string
  costumeNotes?: string
}

export async function calibrateCharacter(
  char: ShortDramaCharacter,
  draft: ShortDramaDraftV2,
  modelKey: string,
): Promise<CharacterCalibrationResult> {
  const system = `你是专业的角色设计专家。根据角色基础描述和剧本上下文，优化角色的视觉描述和一致性锚点。

要求：
1. 六维锚点全部具体化（facialStructure/facialFeatures/uniqueMarks/colorAnchors/skinTexture/hairStyle）
2. 补充 negativePrompt（应避免的特征，防止生成偏移）
3. 所有描述应足够精确，可直接用于 AI 绘画模型
4. 根据剧本情境补充服装/造型变化说明

返回严格 JSON:
{
  "calibratedDescription": "优化后的完整角色描述（英文为主，中文辅助）",
  "anchors": { "facialStructure": "...", "facialFeatures": "...", "uniqueMarks": "...", "colorAnchors": "...", "skinTexture": "...", "hairStyle": "..." },
  "negativePrompt": "应避免的特征（逗号分隔）",
  "costumeNotes": "服装/造型变化说明"
}`

  const user = `角色: ${char.name}
描述: ${char.description}
当前锚点: ${JSON.stringify(char.anchors || {})}
剧本大纲: ${draft.logline || draft.title || '无'}
风格: ${draft.style.presetId}`

  const raw = await callChatModel(modelKey, [
    { role: 'system', content: system },
    { role: 'user', content: user },
  ])

  const parsed = parseJsonLoose(raw)
  if (!parsed?.calibratedDescription) {
    throw new Error('角色校准返回格式异常')
  }

  return {
    calibratedDescription: String(parsed.calibratedDescription),
    anchors: parsed.anchors || undefined,
    negativePrompt: parsed.negativePrompt || undefined,
    costumeNotes: parsed.costumeNotes || undefined,
  }
}

// ── Scene Calibration ──

export interface SceneCalibrationResult {
  calibratedDescription: string
  lightingNotes?: string
  atmosphereNotes?: string
  colorPalette?: string
}

export async function calibrateScene(
  scene: ShortDramaScene,
  draft: ShortDramaDraftV2,
  modelKey: string,
): Promise<SceneCalibrationResult> {
  const system = `你是专业的场景设计专家。根据场景基础描述和剧本上下文，优化场景的视觉环境描述。

要求：
1. 精确化空间布局、建筑风格、装饰细节
2. 深化光影设计（光源方向、色温、阴影质量）
3. 补充环境氛围（天气、粒子效果、色彩基调）
4. 所有描述可直接用于 AI 绘画模型

返回严格 JSON:
{
  "calibratedDescription": "优化后的完整场景描述",
  "lightingNotes": "光影设计细节",
  "atmosphereNotes": "环境氛围描述",
  "colorPalette": "主色调描述"
}`

  const user = `场景: ${scene.name}
描述: ${scene.description}
剧本大纲: ${draft.logline || draft.title || '无'}
风格: ${draft.style.presetId}`

  const raw = await callChatModel(modelKey, [
    { role: 'system', content: system },
    { role: 'user', content: user },
  ])

  const parsed = parseJsonLoose(raw)
  if (!parsed?.calibratedDescription) {
    throw new Error('场景校准返回格式异常')
  }

  return {
    calibratedDescription: String(parsed.calibratedDescription),
    lightingNotes: parsed.lightingNotes || undefined,
    atmosphereNotes: parsed.atmosphereNotes || undefined,
    colorPalette: parsed.colorPalette || undefined,
  }
}

// ── Shot Calibration ──

export interface ShotCalibrationResult {
  calibratedVideoPrompt: string
  calibratedStartPrompt?: string
  calibratedEndPrompt?: string
  narrativeArc?: string
  transitions?: string
}

export async function calibrateShot(
  shot: ShortDramaShot,
  draft: ShortDramaDraftV2,
  neighborShots: ShortDramaShot[],
  modelKey: string,
): Promise<ShotCalibrationResult> {
  const charNames = shot.characterIds
    .map((cid) => draft.characters.find((c) => c.id === cid))
    .filter(Boolean)
    .map((c) => {
      const anchors = c!.calibratedDescription || c!.description
      return `${c!.name}: ${anchors}`
    })
    .join('\n')

  const sceneDesc = shot.sceneId
    ? (() => { const s = draft.scenes.find((sc) => sc.id === shot.sceneId); return s ? `场景 [${s.name}]: ${s.calibratedDescription || s.description}` : '' })()
    : ''

  const neighborContext = neighborShots
    .map((ns, i) => `邻镜头${i + 1}: ${ns.title} - ${ns.videoPrompt.slice(0, 100)}`)
    .join('\n')

  const system = `你是电影分镜导演。优化以下镜头的视频生成提示词。

要求：
1. 确保角色一致性锚点完整嵌入 startPrompt/endPrompt
2. videoPrompt 严格遵循"起始-发展-高潮"三段式叙事结构
3. 检查与相邻镜头的过渡连贯性
4. 补充缺失的光影描述、环境动态、情绪弧线
5. 摄影语言精确（景别、机位、运镜用英文专业术语）

返回严格 JSON:
{
  "calibratedVideoPrompt": "优化后的视频提示词",
  "calibratedStartPrompt": "优化后的首帧提示词",
  "calibratedEndPrompt": "优化后的尾帧提示词",
  "narrativeArc": "此镜头的叙事作用描述",
  "transitions": "与前后镜头的过渡指令"
}`

  const user = `镜头: ${shot.title}
当前 videoPrompt: ${shot.videoPrompt}
当前 startPrompt: ${shot.frames.start.prompt}
当前 endPrompt: ${shot.frames.end.prompt}
角色:
${charNames || '无'}
${sceneDesc}
相邻镜头:
${neighborContext || '无'}
风格: ${draft.style.presetId}
景别: ${shot.cinematography?.shotSize || '未指定'}
机位: ${shot.cinematography?.cameraRig || '未指定'}`

  const raw = await callChatModel(modelKey, [
    { role: 'system', content: system },
    { role: 'user', content: user },
  ])

  const parsed = parseJsonLoose(raw)
  if (!parsed?.calibratedVideoPrompt) {
    throw new Error('镜头校准返回格式异常')
  }

  return {
    calibratedVideoPrompt: String(parsed.calibratedVideoPrompt),
    calibratedStartPrompt: parsed.calibratedStartPrompt || undefined,
    calibratedEndPrompt: parsed.calibratedEndPrompt || undefined,
    narrativeArc: parsed.narrativeArc || undefined,
    transitions: parsed.transitions || undefined,
  }
}

// ── Batch Calibration ──

export type CalibrationItemType = 'character' | 'scene' | 'shot'

export interface CalibrationBatchItem {
  type: CalibrationItemType
  id: string
}

export async function calibrateBatch(
  items: CalibrationBatchItem[],
  draft: ShortDramaDraftV2,
  modelKey: string,
  onProgress?: (done: number, total: number) => void,
): Promise<ShortDramaDraftV2> {
  let current = { ...draft }
  let done = 0

  for (const item of items) {
    try {
      if (item.type === 'character') {
        const char = current.characters.find((c) => c.id === item.id)
        if (!char) { done++; continue }
        current = { ...current, characters: current.characters.map((c) => c.id === item.id ? { ...c, calibrationStatus: 'calibrating' as const } : c) }
        const result = await calibrateCharacter(char, current, modelKey)
        current = {
          ...current,
          characters: current.characters.map((c) =>
            c.id === item.id
              ? { ...c, calibrationStatus: 'done' as const, calibratedDescription: result.calibratedDescription, anchors: result.anchors || c.anchors }
              : c,
          ),
          updatedAt: Date.now(),
        }
      } else if (item.type === 'scene') {
        const scene = current.scenes.find((s) => s.id === item.id)
        if (!scene) { done++; continue }
        current = { ...current, scenes: current.scenes.map((s) => s.id === item.id ? { ...s, calibrationStatus: 'calibrating' as const } : s) }
        const result = await calibrateScene(scene, current, modelKey)
        current = {
          ...current,
          scenes: current.scenes.map((s) =>
            s.id === item.id
              ? { ...s, calibrationStatus: 'done' as const, calibratedDescription: result.calibratedDescription }
              : s,
          ),
          updatedAt: Date.now(),
        }
      } else if (item.type === 'shot') {
        const shotIdx = current.shots.findIndex((s) => s.id === item.id)
        if (shotIdx === -1) { done++; continue }
        const shot = current.shots[shotIdx]
        const neighbors = [current.shots[shotIdx - 1], current.shots[shotIdx + 1]].filter(Boolean)
        current = { ...current, shots: current.shots.map((s) => s.id === item.id ? { ...s, calibrationStatus: 'calibrating' as const } : s) }
        const result = await calibrateShot(shot, current, neighbors, modelKey)
        current = {
          ...current,
          shots: current.shots.map((s) =>
            s.id === item.id
              ? {
                  ...s,
                  calibrationStatus: 'done' as const,
                  calibratedVideoPrompt: result.calibratedVideoPrompt,
                  calibratedStartPrompt: result.calibratedStartPrompt,
                  calibratedEndPrompt: result.calibratedEndPrompt,
                  narrativeArc: result.narrativeArc,
                  transitions: result.transitions,
                }
              : s,
          ),
          updatedAt: Date.now(),
        }
      }
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err)
      console.warn(`[calibrateBatch] ${item.type} ${item.id} 校准失败:`, errMsg)
      if (item.type === 'character') {
        current = { ...current, characters: current.characters.map((c) => c.id === item.id ? { ...c, calibrationStatus: 'failed' as const } : c) }
      } else if (item.type === 'scene') {
        current = { ...current, scenes: current.scenes.map((s) => s.id === item.id ? { ...s, calibrationStatus: 'failed' as const } : s) }
      } else {
        current = { ...current, shots: current.shots.map((s) => s.id === item.id ? { ...s, calibrationStatus: 'failed' as const } : s) }
      }
    }
    done++
    onProgress?.(done, items.length)
  }

  return current
}
