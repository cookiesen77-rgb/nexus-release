/**
 * Workflow Orchestrator Hook | 工作流编排 Hook (React + TypeScript)
 * 使用回调串行结构编排节点执行
 *
 * 依赖关系：
 * - imageConfig 执行后产生 image 节点
 * - videoConfig 依赖 image 节点作为输入
 * - 串行执行：等待上一步完成后再执行下一步
 */

import { useState, useCallback, useRef } from 'react'
import { streamWithRetry } from '@/lib/nexusApi'
import { INTENT_ANALYSIS_PROMPT, MODELS } from '@/config/nexusPrompt'
import { generateImageFromConfigNode } from '@/lib/workflow/image'
import { useGraphStore } from '@/graph/store'
import type { GraphNode } from '@/graph/types'

// ==================== Types ====================

export type WorkflowType =
  | 'text_to_image'
  | 'text_to_image_to_video'
  | 'batch_images'
  | 'storyboard'
  | 'multi_angle_storyboard'

export type OutputMode = 'workflow' | 'text_only'

export interface ClarificationQuestion {
  key: string
  question: string
  options?: string[]
}

export interface IntentResult {
  needs_clarification: boolean
  clarification_questions: ClarificationQuestion[]
  clarification_context?: string
  workflow_type: WorkflowType
  output_mode: OutputMode
  description?: string
  image_prompt?: string
  video_prompt?: string
  script?: string
  character?: {
    name: string
    description: string
  }
  shots?: Array<{
    title: string
    prompt: string
  }>
  images?: Array<{
    title: string
    prompt: string
  }>
  multi_angle?: {
    character_description: string
  }
  raw_input?: string
  reference_node_ids?: string[]
}

export interface WorkflowParams extends IntentResult {}

export interface Position {
  x: number
  y: number
}

export interface LogEntry {
  type: 'info' | 'success' | 'error'
  message: string
  timestamp: number
}

interface MultiAngleConfig {
  label: string
  english: string
  prompt: (character: string) => string
}

// ==================== Constants ====================

export const WORKFLOW_TYPES = {
  TEXT_TO_IMAGE: 'text_to_image' as const,
  TEXT_TO_IMAGE_TO_VIDEO: 'text_to_image_to_video' as const,
  BATCH_IMAGES: 'batch_images' as const,
  STORYBOARD: 'storyboard' as const,
  MULTI_ANGLE_STORYBOARD: 'multi_angle_storyboard' as const,
}

export const MULTI_ANGLE_PROMPTS: Record<string, MultiAngleConfig> = {
  front: {
    label: '正视',
    english: 'Front View',
    prompt: (character) => `使用提供的图片，生成四宫格分镜，每张四宫格包括人物正面对着镜头的4个景别（远景、中景、近景、和局部特写），保持场景、产品、人物特征的一致性，宫格里的每一张照片保持和提供图片相同的比例。并在图片下方用英文标注这个景别

角色参考: ${character}`,
  },
  side: {
    label: '侧视',
    english: 'Side View',
    prompt: (character) => `使用提供的图片，分别生成四宫格分镜，每张四宫格包括人物侧面角度的4个景别（远景、中景、近景、和局部特写），保持场景、产品、人物特征的一致性，宫格里的每一张照片保持和提供图片相同的比例。并在图片下方用英文标注这个景别

角色参考: ${character}`,
  },
  back: {
    label: '后视',
    english: 'Back View',
    prompt: (character) => `使用提供的图片，分别生成四宫格分镜，每张四宫格包括人物背影角度的4个景别（远景、中景、近景、和局部特写），保持场景、产品、人物特征的一致性，宫格里的每一张照片保持和提供图片相同的比例。并在图片下方用英文标注这个景别

角色参考: ${character}`,
  },
  top: {
    label: '俯视',
    english: "Top/Bird's Eye View",
    prompt: (character) => `使用提供的图片，分别生成四宫格分镜，每张四宫格包括俯视角度的4个景别（远景、中景、近景、和局部特写），保持场景、产品、人物特征的一致性，宫格里的每一张照片保持和提供图片相同的比例。并在图片下方用英文标注这个景别

角色参考: ${character}`,
  },
}

// ==================== Utility Functions ====================

const normalizeText = (text: unknown): string =>
  String(text || '')
    .replace(/\r\n/g, '\n')
    .trim()

const buildIntentContext = (
  nodesList: GraphNode[],
  maxNodes = 6,
  maxChars = 1400
): string => {
  const textNodes = (nodesList || []).filter((n) => n?.type === 'text')
  if (textNodes.length === 0) return ''

  const memoryNodes = textNodes.filter((n) => {
    const label = normalizeText(n.data?.label)
    const content = normalizeText(n.data?.content)
    const hay = `${label}\n${content}`
    return /角色|人物|设定|世界观|画风|风格|禁忌|剧情|大纲|分镜|脚本|镜头/i.test(hay)
  })

  const recentNodes = [...textNodes]
    .map((n) => ({
      node: n,
      t: Number(n.data?.updatedAt || n.data?.createdAt || 0),
    }))
    .sort((a, b) => b.t - a.t)
    .map((x) => x.node)

  const merged: GraphNode[] = []
  const seen = new Set<string>()
  for (const n of [...memoryNodes, ...recentNodes]) {
    if (seen.has(n.id)) continue
    seen.add(n.id)
    merged.push(n)
    if (merged.length >= maxNodes) break
  }

  const lines: string[] = []
  let total = 0
  for (const n of merged) {
    const label = normalizeText(n.data?.label) || '文本节点'
    const content = normalizeText(n.data?.content)
    if (!content) continue
    const snippet = content.length > 360 ? `${content.slice(0, 360)}…` : content
    const next = `- ${label}: ${snippet}`
    if (total + next.length > maxChars) break
    lines.push(next)
    total += next.length
  }

  return lines.join('\n')
}

interface HeuristicResult {
  workflow_type: WorkflowType | null
  output_mode: OutputMode | null
  wantsScript: boolean
}

const classifyIntentHeuristic = (text: string): HeuristicResult => {
  const t = normalizeText(text)
  
  // 检测各种意图关键词
  const wantsMultiAngle = /多角度|四宫格|正视|侧视|后视|俯视/i.test(t)
  const wantsStoryboard = /分镜|镜头脚本|场景一|场景1|storyboard|shot\s*list/i.test(t)
  const wantsScript = /剧本|脚本|剧情|设定|对白|旁白|故事|大纲/i.test(t) && !t.includes('生成')
  const wantsVideo = /视频|运镜|动起来|动画|vlog|mv/i.test(t)
  const wantsImage = /生图|图片|图像|插画|画面|海报/i.test(t)
  
  // 批量图片：检测"N张"、"角色卡"、"人设图"等关键词（优先级提升）
  // 注意："生成N张图"应该是 batch_images，不是 storyboard
  const batchImageMatch = t.match(/(\d+)\s*张.*图|生成.*(\d+)\s*张|画.*(\d+)\s*张/i)
  const wantsBatchImages = batchImageMatch || /角色卡|人设图|人设|头像|系列图|一组|一套/i.test(t)
  
  // 只要文字（不生成图片）
  const wantsPolishOnly =
    /润色|改写|优化|扩写|精炼/i.test(t) && !wantsImage && !wantsVideo && !wantsStoryboard
  const textOnly = /只要|只需|不要生成|不生成|不要出图|纯文字|写.*(?:剧本|脚本)/i.test(t) || wantsPolishOnly
  
  // 是否明确要求生成（执行 workflow）
  const wantsGenerate = /生成|画|创建|制作.*图/i.test(t)

  // 优先级调整：batch_images > storyboard（当用户明确说"生成N张图"时）
  let workflow_type: WorkflowType | null = null
  if (wantsMultiAngle) {
    workflow_type = WORKFLOW_TYPES.MULTI_ANGLE_STORYBOARD
  } else if (wantsBatchImages && wantsGenerate) {
    // "生成N张图" → batch_images（优先级最高，优先于 storyboard）
    workflow_type = WORKFLOW_TYPES.BATCH_IMAGES
  } else if (wantsStoryboard && !wantsBatchImages) {
    // 纯分镜需求（没有"N张图"的明确数量）
    workflow_type = WORKFLOW_TYPES.STORYBOARD
  } else if (wantsScript && !wantsGenerate) {
    // 纯脚本/剧本需求（没有"生成"关键词）
    workflow_type = WORKFLOW_TYPES.STORYBOARD
  } else if (wantsBatchImages) {
    // 其他批量图片场景
    workflow_type = WORKFLOW_TYPES.BATCH_IMAGES
  } else if (wantsVideo) {
    workflow_type = WORKFLOW_TYPES.TEXT_TO_IMAGE_TO_VIDEO
  } else if (wantsImage) {
    workflow_type = WORKFLOW_TYPES.TEXT_TO_IMAGE
  }

  return {
    workflow_type,
    output_mode: textOnly ? 'text_only' : null,
    wantsScript: wantsScript && !wantsGenerate,
  }
}

const STYLE_HINT_RE =
  /写实|摄影|真实|电影感|胶片|动漫|二次元|日漫|国漫|美漫|插画|手绘|水彩|油画|国风|古风|赛博朋克|蒸汽朋克|像素|3d|3D|渲染|建模|低多边|极简|霓虹|未来|卡通|童话|厚涂|赛璐璐/i
const SCENE_HINT_RE =
  /室内|室外|城市|街道|森林|海边|夜晚|白天|黄昏|雨|雪|晴|阴|办公室|房间|教室|舞台|太空|山|湖|沙漠|草原|地铁|咖啡馆|商店|校园/i
const CHARACTER_HINT_RE =
  /人物|角色|主角|女孩|男孩|少年|少女|老人|小孩|女性|男性|猫|狗|动物|机器人|怪物|天使|恶魔|产品|商品|logo|建筑|车辆/i
const DURATION_HINT_RE = /(\d+(?:\.\d+)?)\s*(秒|s|sec|secs|分钟|min)/i
const SHOT_COUNT_RE = /(\d+)\s*(镜|分镜|shot|场景|条)/i
const RATIO_HINT_RE = /16:9|9:16|4:3|3:4|1:1|横版|竖版|方形|宽屏|竖屏/i

interface ClarificationFallback {
  context: string
  questions: ClarificationQuestion[]
}

const detectClarificationFallback = ({
  userInput,
  contextText,
  workflowType,
  outputMode,
}: {
  userInput: string
  contextText: string
  workflowType: WorkflowType | null
  outputMode: OutputMode | null
}): ClarificationFallback => {
  const combined = normalizeText([userInput, contextText].filter(Boolean).join('\n'))

  const hasCharacter = CHARACTER_HINT_RE.test(combined)
  const mentionsOutput = /图片|图像|生图|画面|海报|视频|动画|分镜|剧本|脚本|文字|角色卡|人设|头像/.test(combined)
  
  // 检测用户是否给予 AI 自主决策权
  const trustsAI = /随便|你来|你定|你决定|自动|默认|不管|都行|随意/.test(combined)
  
  // 只有在用户输入极其模糊时才追问（<8字符且没有任何关键词）
  const isExtremelyVague = combined.length < 8 && !mentionsOutput && !hasCharacter

  const questions: ClarificationQuestion[] = []
  const pushQuestion = (q: ClarificationQuestion) => {
    if (questions.length >= 1) return // 最多只问1个问题
    questions.push(q)
  }

  // 如果用户信任 AI 决策，不追问
  if (trustsAI) {
    return { context: '', questions: [] }
  }

  // 只有在极其模糊时才问
  if (isExtremelyVague) {
    pushQuestion({
      key: 'output_type',
      question: '你想创建什么？请简单描述一下',
    })
  }

  // 多角度分镜是唯一需要角色描述的场景（因为要保持一致性）
  if (workflowType === WORKFLOW_TYPES.MULTI_ANGLE_STORYBOARD) {
    if (!hasCharacter && combined.length < 15) {
      pushQuestion({
        key: 'character',
        question: '请简单描述角色外观（用于保持多角度一致）',
      })
    }
  }

  // 其他工作流类型不再追问，让 AI 用默认值填充
  // TEXT_TO_IMAGE: 默认精致插画风格
  // BATCH_IMAGES: AI 自动生成差异化提示词  
  // STORYBOARD: AI 根据上下文推断分镜数量
  // TEXT_TO_IMAGE_TO_VIDEO: 默认 5 秒 16:9

  // 不再追问以下内容（由 AI 自动填充默认值）：
  // - 画风 → 默认"精致插画风格"
  // - 场景 → 根据主题推断
  // - 比例 → 默认 3:4 竖版
  // - 时长 → 默认 5 秒
  // - 分镜数量 → 默认 4-6 条
  
  return {
    context: questions.length > 0 ? '需要补充一些信息：' : '',
    questions,
  }
}

/**
 * 从对话历史中提取角色卡内容（上下文工程核心）
 * 当 API 失败时，通过本地规则从历史中提取角色信息
 */
const extractCharacterCardsFromHistory = (
  conversationHistory: Array<{ role: string; content: string }> | undefined
): Array<{ title: string; prompt: string }> => {
  if (!conversationHistory || conversationHistory.length === 0) return []

  const images: Array<{ title: string; prompt: string }> = []
  
  // 角色卡的识别模式
  const cardPatterns = [
    /角色卡\s*(\d+)\s*[—–-]\s*([^\n（(]+)/gi,  // 角色卡 01 — 云澈
    /([一二三四五六七八九十\d]+)\s*[、.．]\s*([^\n（(]+?)\s*(?:（|$)/gi,  // 一、云澈（修仙男主）
  ]
  
  // 提示词提取模式
  const promptPatterns = [
    /示例完整\s*Prompt[：:]\s*[""]?([^""]+)[""]?/gi,
    /完整\s*Prompt[：:]\s*[""]?([^""]+)[""]?/gi,
    /生图\s*Prompt[：:]\s*[""]?([^""]+)[""]?/gi,
  ]
  
  // 遍历对话历史，找到包含角色卡的消息
  // 注意：角色卡可能在 user 消息（用户粘贴）或 assistant 消息（AI 生成）中
  for (const msg of conversationHistory) {
    const content = msg.content || ''
    // 跳过太短的消息
    if (content.length < 100) continue
    
    // 检测是否包含角色卡结构
    const hasCardStructure = /角色卡|基本信息|外貌要点|服饰与配色|生图\s*Prompt/i.test(content)
    if (!hasCardStructure) continue
    
    // 提取每个角色卡
    const cardMatches: Array<{ title: string; startIndex: number }> = []
    for (const pattern of cardPatterns) {
      pattern.lastIndex = 0
      let match
      while ((match = pattern.exec(content)) !== null) {
        const title = (match[2] || match[1]).trim().replace(/[（(].*/g, '').trim()
        if (title && title.length > 1 && title.length < 20) {
          cardMatches.push({ title, startIndex: match.index })
        }
      }
    }
    
    // 对每个角色卡提取 prompt
    for (let i = 0; i < cardMatches.length; i++) {
      const card = cardMatches[i]
      const nextCardStart = i + 1 < cardMatches.length ? cardMatches[i + 1].startIndex : content.length
      const cardSection = content.slice(card.startIndex, nextCardStart)
      
      // 尝试提取完整 Prompt
      let promptText = ''
      for (const pattern of promptPatterns) {
        pattern.lastIndex = 0
        const promptMatch = pattern.exec(cardSection)
        if (promptMatch && promptMatch[1]) {
          promptText = promptMatch[1].trim()
          // 清理引号和省略号
          promptText = promptText.replace(/^[""]|[""]$/g, '').replace(/….*$/g, '').trim()
          break
        }
      }
      
      // 如果没有找到完整 Prompt，尝试提取外貌+服饰描述组合成 prompt
      if (!promptText) {
        const lookMatch = cardSection.match(/外貌要点[：:]\s*([^\n]+)/i)
        const clothMatch = cardSection.match(/服饰与配色[：:]\s*([^\n]+)/i)
        const sceneMatch = cardSection.match(/典型场景[构图：:]*\s*([^\n]+)/i)
        
        const parts = []
        if (lookMatch) parts.push(lookMatch[1].trim())
        if (clothMatch) parts.push(clothMatch[1].trim())
        if (sceneMatch) parts.push(sceneMatch[1].trim())
        
        if (parts.length > 0) {
          promptText = parts.join('；') + '；国风 二次元，柔和淡雅光感，精致服饰细节，cinematic lighting'
        }
      }
      
      if (promptText && promptText.length > 20) {
        images.push({ title: card.title, prompt: promptText })
      }
    }
    
    // 如果找到了角色卡，就不再继续查找更早的消息
    if (images.length > 0) break
  }
  
  return images
}

const normalizeIntentResult = (
  result: Partial<IntentResult> | null,
  heuristic: HeuristicResult,
  userInput: string,
  conversationHistory?: Array<{ role: string; content: string }>
): IntentResult => {
  const fallback: IntentResult = {
    workflow_type: WORKFLOW_TYPES.TEXT_TO_IMAGE,
    output_mode: 'workflow',
    needs_clarification: false,
    clarification_questions: [],
  }
  const next: IntentResult =
    result && typeof result === 'object' ? { ...fallback, ...result } : { ...fallback }

  if (heuristic?.workflow_type) next.workflow_type = heuristic.workflow_type
  if (!next.workflow_type) next.workflow_type = WORKFLOW_TYPES.TEXT_TO_IMAGE

  if (heuristic?.output_mode) next.output_mode = heuristic.output_mode
  if (!next.output_mode) next.output_mode = 'workflow'

  const isStoryboard =
    next.workflow_type === WORKFLOW_TYPES.STORYBOARD ||
    next.workflow_type === WORKFLOW_TYPES.MULTI_ANGLE_STORYBOARD
  if (!next.image_prompt && !isStoryboard) next.image_prompt = userInput
  if (!next.video_prompt && next.workflow_type === WORKFLOW_TYPES.TEXT_TO_IMAGE_TO_VIDEO)
    next.video_prompt = userInput

  if (heuristic?.wantsScript && next.output_mode !== 'text_only') {
    next.output_mode = 'text_only'
  }

  // 上下文工程关键：当 batch_images 但 images 为空时，提取角色卡
  if (
    next.workflow_type === WORKFLOW_TYPES.BATCH_IMAGES &&
    (!next.images || next.images.length === 0)
  ) {
    // 首先尝试从当前用户输入中提取角色卡（用户可能直接粘贴在当前消息中）
    const userInputAsHistory = [{ role: 'user', content: userInput }]
    let extractedImages = extractCharacterCardsFromHistory(userInputAsHistory)
    
    if (extractedImages.length > 0) {
      next.images = extractedImages
      console.log('[Workflow] 从当前输入提取角色卡:', extractedImages.length, '张')
    } else if (conversationHistory && conversationHistory.length > 0) {
      // 如果当前输入中没有角色卡，再从对话历史中提取
      const referencesHistory = /上述|之前|刚才|上面|那|这些|角色卡/i.test(userInput)
      if (referencesHistory) {
        extractedImages = extractCharacterCardsFromHistory(conversationHistory)
        if (extractedImages.length > 0) {
          next.images = extractedImages
          console.log('[Workflow] 从对话历史提取角色卡:', extractedImages.length, '张')
        }
      }
    }
  }

  return next
}

const parseIntentJson = (rawText: string): Partial<IntentResult> | null => {
  const match = String(rawText || '').match(/\{[\s\S]*\}/)
  if (!match) return null
  try {
    return JSON.parse(match[0])
  } catch {
    return null
  }
}

// ==================== Main Hook ====================

export function useWorkflowOrchestrator() {
  const [isAnalyzing, setIsAnalyzing] = useState(false)
  const [isExecuting, setIsExecuting] = useState(false)
  const [currentStep, setCurrentStep] = useState(0)
  const [totalSteps, setTotalSteps] = useState(0)
  const [executionLog, setExecutionLog] = useState<LogEntry[]>([])

  // Store actions
  const addNode = useGraphStore((s) => s.addNode)
  const addEdge = useGraphStore((s) => s.addEdge)
  const updateNode = useGraphStore((s) => s.updateNode)
  const withBatchUpdates = useGraphStore((s) => s.withBatchUpdates)
  const nodes = useGraphStore((s) => s.nodes)

  // Polling refs for node completion
  const pollingRef = useRef<number | null>(null)

  const addLog = useCallback((type: LogEntry['type'], message: string) => {
    setExecutionLog((prev) => [...prev, { type, message, timestamp: Date.now() }])
    console.log(`[Workflow ${type}] ${message}`)
  }, [])

  const clearPolling = useCallback(() => {
    if (pollingRef.current) {
      clearInterval(pollingRef.current)
      pollingRef.current = null
    }
  }, [])

  /**
   * Get node by ID from current store state
   */
  const getNodeById = useCallback(
    (nodeId: string): GraphNode | undefined => {
      return useGraphStore.getState().nodes.find((n) => n.id === nodeId)
    },
    []
  )

  /**
   * Wait for config node to complete and return output node ID
   */
  const waitForConfigComplete = useCallback(
    (configNodeId: string): Promise<string> => {
      return new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
          clearPolling()
          reject(new Error('执行超时'))
        }, 5 * 60 * 1000)

        const checkNode = () => {
          const node = getNodeById(configNodeId)
          if (!node) return false

          if (node.data?.error) {
            clearTimeout(timeout)
            clearPolling()
            reject(new Error(String(node.data.error)))
            return true
          }

          if (node.data?.executed && node.data?.outputNodeId) {
            clearTimeout(timeout)
            clearPolling()
            addLog('success', `节点 ${configNodeId} 完成，输出节点: ${node.data.outputNodeId}`)
            resolve(String(node.data.outputNodeId))
            return true
          }
          return false
        }

        // Check immediately
        if (checkNode()) return

        // Poll every 500ms
        pollingRef.current = window.setInterval(() => {
          checkNode()
        }, 500)
      })
    },
    [getNodeById, addLog, clearPolling]
  )

  /**
   * Wait for output node (image/video) to be ready
   */
  const waitForOutputReady = useCallback(
    (outputNodeId: string): Promise<GraphNode> => {
      return new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
          clearPolling()
          reject(new Error('输出节点超时'))
        }, 5 * 60 * 1000)

        const checkNode = () => {
          const node = getNodeById(outputNodeId)
          if (!node) return false

          if (node.data?.error) {
            clearTimeout(timeout)
            clearPolling()
            reject(new Error(String(node.data.error)))
            return true
          }

          if (node.data?.url && !node.data?.loading) {
            clearTimeout(timeout)
            clearPolling()
            addLog('success', `输出节点 ${outputNodeId} 已就绪`)
            resolve(node)
            return true
          }
          return false
        }

        if (checkNode()) return

        pollingRef.current = window.setInterval(() => {
          checkNode()
        }, 500)
      })
    },
    [getNodeById, addLog, clearPolling]
  )

  /**
   * Analyze user intent
   * @param userInput - 当前用户输入
   * @param conversationHistory - 可选的对话历史（用于理解"上文"、"之前"等引用）
   */
  const analyzeIntent = useCallback(
    async (
      userInput: string,
      conversationHistory?: Array<{ role: string; content: string }>
    ): Promise<IntentResult> => {
      setIsAnalyzing(true)

      try {
        let response = ''
        const contextText = buildIntentContext(nodes)
        
        // 构建包含对话历史的上下文（上下文工程核心）
        let conversationContext = ''
        if (conversationHistory && conversationHistory.length > 0) {
          // 智能截取：保留完整的角色设定/长回复，最多 20 条或 8000 字符
          const maxMessages = 20
          const maxChars = 8000
          let totalChars = 0
          const selectedMessages: typeof conversationHistory = []
          
          // 从最近的消息向前遍历
          for (let i = conversationHistory.length - 1; i >= 0 && selectedMessages.length < maxMessages; i--) {
            const msg = conversationHistory[i]
            const msgLength = msg.content.length
            
            // 如果是包含角色卡/设定的长消息，优先保留完整
            const isImportantMessage = 
              msg.content.includes('角色卡') ||
              msg.content.includes('角色设定') ||
              msg.content.includes('Prompt') ||
              msg.content.includes('prompt') ||
              msgLength > 500 // 长消息通常包含重要信息
            
            if (totalChars + msgLength > maxChars && !isImportantMessage) {
              // 普通消息超出限制，截断
              const truncatedContent = msg.content.slice(0, 200) + '...(已截断)'
              selectedMessages.unshift({ ...msg, content: truncatedContent })
              totalChars += 200
            } else {
              selectedMessages.unshift(msg)
              totalChars += msgLength
            }
          }
          
          conversationContext = selectedMessages
            .map((msg, idx) => {
              const roleLabel = msg.role === 'user' ? '【用户】' : '【AI】'
              // 标记消息序号，便于引用
              return `[消息${idx + 1}] ${roleLabel}\n${msg.content}`
            })
            .join('\n\n---\n\n')
        }
        
        // 拼装完整输入，强调上下文的重要性
        let inputText = ''
        if (conversationContext) {
          inputText = `=== 对话历史（请仔细阅读，用户可能引用其中的内容）===\n\n${conversationContext}\n\n=== 当前请求 ===\n${userInput}`
        } else {
          inputText = userInput
        }
        if (contextText) {
          inputText += `\n\n=== 画布上下文 ===\n${contextText}`
        }

        // Use streamWithRetry for intent analysis with retry support
        for await (const chunk of streamWithRetry('chat/completions', {
          model: MODELS.INTENT,
          messages: [
            { role: 'system', content: INTENT_ANALYSIS_PROMPT },
            { role: 'user', content: inputText },
          ],
        }, { maxRetries: 2 })) {
          response += chunk
        }

        const parsed = parseIntentJson(response)
        const heuristic = classifyIntentHeuristic(userInput)
        const normalized = parsed
          ? normalizeIntentResult(parsed, heuristic, userInput, conversationHistory)
          : normalizeIntentResult(null, heuristic, userInput, conversationHistory)

        const fallback = detectClarificationFallback({
          userInput,
          contextText,
          workflowType: normalized.workflow_type,
          outputMode: normalized.output_mode,
        })

        const hasQuestions =
          Array.isArray(normalized?.clarification_questions) &&
          normalized.clarification_questions.length > 0
        if (normalized?.needs_clarification && hasQuestions) {
          return normalized
        }

        if (fallback.questions.length > 0) {
          return {
            ...normalized,
            needs_clarification: true,
            clarification_questions: fallback.questions,
            clarification_context: normalized?.clarification_context || fallback.context,
          }
        }

        return {
          ...normalized,
          needs_clarification: false,
          clarification_questions: normalized?.clarification_questions || [],
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        addLog('error', `分析失败: ${message}`)
        const heuristic = classifyIntentHeuristic(userInput)
        // 上下文工程：即使 API 失败，也传递对话历史以便从中提取角色卡
        const normalized = normalizeIntentResult(null, heuristic, userInput, conversationHistory)
        const fallback = detectClarificationFallback({
          userInput,
          contextText: buildIntentContext(nodes),
          workflowType: normalized.workflow_type,
          outputMode: normalized.output_mode,
        })

        if (fallback.questions.length > 0) {
          return {
            ...normalized,
            needs_clarification: true,
            clarification_questions: fallback.questions,
            clarification_context: fallback.context,
          }
        }

        return {
          ...normalized,
          needs_clarification: false,
          clarification_questions: [],
        }
      } finally {
        setIsAnalyzing(false)
      }
    },
    [nodes, addLog]
  )

  /**
   * Execute text-only workflow
   */
  const executeTextOnly = useCallback(
    async (params: WorkflowParams, position: Position) => {
      const nodeSpacing = 360
      const rowSpacing = 220
      let x = position.x
      const y = position.y

      const created: {
        characterId: string | null
        scriptId: string | null
        promptIds: string[]
        shotIds: string[]
      } = {
        characterId: null,
        scriptId: null,
        promptIds: [],
        shotIds: [],
      }

      const character = params?.character
      const shots = Array.isArray(params?.shots) ? params.shots : []
      const scriptText = normalizeText(params?.script)
      const multiAngleText = normalizeText(params?.multi_angle?.character_description)

      withBatchUpdates(() => {
        if (character?.name || character?.description) {
          const content = `${character?.name || '角色'}: ${character?.description || ''}`.trim()
          created.characterId = addNode('text', { x, y }, { content, label: '角色设定' })
          x += nodeSpacing
        }

        if (scriptText) {
          created.scriptId = addNode('text', { x, y }, { content: scriptText, label: '剧本/脚本' })
          x += nodeSpacing
        }

        if (multiAngleText && !created.characterId && !created.scriptId) {
          created.characterId = addNode(
            'text',
            { x, y },
            { content: multiAngleText, label: '多角度角色描述' }
          )
          x += nodeSpacing
        }

        const imagePrompt = normalizeText(params?.image_prompt)
        if (imagePrompt) {
          const nodeId = addNode('text', { x, y }, { content: imagePrompt, label: '图片提示词' })
          created.promptIds.push(nodeId)
          x += nodeSpacing
        }

        const videoPrompt = normalizeText(params?.video_prompt)
        if (videoPrompt) {
          const nodeId = addNode('text', { x, y }, { content: videoPrompt, label: '视频提示词' })
          created.promptIds.push(nodeId)
          x += nodeSpacing
        }

        const hasAny =
          created.characterId || created.scriptId || created.promptIds.length > 0 || shots.length > 0
        if (!hasAny) {
          const rawInput = normalizeText(params?.raw_input)
          if (rawInput) {
            created.scriptId = addNode('text', { x, y }, { content: rawInput, label: '原始需求' })
          }
        }

        const anchorId = created.scriptId || created.characterId || created.promptIds[0] || null
        if (shots.length > 0) {
          shots.forEach((shot, index) => {
            const title = normalizeText(shot?.title) || `镜头${index + 1}`
            const prompt = normalizeText(shot?.prompt) || title
            const nodeId = addNode(
              'text',
              { x: position.x, y: y + (index + 1) * rowSpacing },
              { content: prompt, label: `分镜${index + 1}: ${title}` }
            )
            created.shotIds.push(nodeId)
            if (anchorId) {
              addEdge(anchorId, nodeId)
            }
          })
        }
      })

      return created
    },
    [addNode, addEdge, withBatchUpdates]
  )

  /**
   * Execute text-to-image workflow
   */
  const executeTextToImage = useCallback(
    async (imagePrompt: string, position: Position, referenceNodeIds: string[] = []) => {
      const nodeSpacing = 400
      let x = position.x

      addLog('info', '开始执行文生图工作流')
      setCurrentStep(1)
      setTotalSteps(2)

      let textNodeId: string = ''
      let imageConfigId: string = ''

      withBatchUpdates(() => {
        textNodeId = addNode('text', { x, y: position.y }, { content: imagePrompt, label: '图片提示词' })
        addLog('info', `创建图片提示词节点: ${textNodeId}`)
        x += nodeSpacing

        setCurrentStep(2)
        imageConfigId = addNode(
          'imageConfig',
          { x, y: position.y },
          { label: '文生图', size: '3:4', quality: '2K' }
        )
        addLog('info', `创建图片配置节点: ${imageConfigId}`)

        addEdge(textNodeId, imageConfigId)

        if (Array.isArray(referenceNodeIds) && referenceNodeIds.length > 0) {
          referenceNodeIds.forEach((refId) => {
            if (!refId) return
            addEdge(refId, imageConfigId, { imageRole: 'input_reference' })
          })
        }
      })

      // 直接调用生成
      addLog('info', '开始生成图片...')
      try {
        await generateImageFromConfigNode(imageConfigId)
        addLog('success', '文生图工作流已完成')
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err)
        addLog('error', `生成失败: ${errMsg}`)
      }
      
      return { textNodeId, imageConfigId }
    },
    [addNode, addEdge, withBatchUpdates, addLog]
  )

  /**
   * Execute text-to-image-to-video workflow
   */
  const executeTextToImageToVideo = useCallback(
    async (
      imagePrompt: string,
      videoPrompt: string,
      position: Position,
      referenceNodeIds: string[] = []
    ) => {
      const nodeSpacing = 400
      const rowSpacing = 200
      let x = position.x

      addLog('info', '开始执行文生图生视频工作流')
      setCurrentStep(1)
      setTotalSteps(5)

      let imageTextNodeId: string = ''
      let videoTextNodeId: string = ''
      let imageConfigId: string = ''

      withBatchUpdates(() => {
        imageTextNodeId = addNode(
          'text',
          { x, y: position.y },
          { content: imagePrompt, label: '图片提示词' }
        )
        addLog('info', `创建图片提示词节点: ${imageTextNodeId}`)

        setCurrentStep(2)
        videoTextNodeId = addNode(
          'text',
          { x, y: position.y + rowSpacing },
          { content: videoPrompt, label: '视频提示词' }
        )
        addLog('info', `创建视频提示词节点: ${videoTextNodeId}`)
        x += nodeSpacing

        setCurrentStep(3)
        imageConfigId = addNode(
          'imageConfig',
          { x, y: position.y },
          { label: '文生图', size: '3:4', quality: '2K' }
        )
        addLog('info', `创建图片配置节点: ${imageConfigId}`)

        addEdge(imageTextNodeId, imageConfigId)

        if (Array.isArray(referenceNodeIds) && referenceNodeIds.length > 0) {
          referenceNodeIds.forEach((refId) => {
            if (!refId) return
            addEdge(refId, imageConfigId, { imageRole: 'input_reference' })
          })
        }
      })

      setCurrentStep(3)
      addLog('info', '开始生成图片...')

      try {
        // 直接调用生成
        await generateImageFromConfigNode(imageConfigId)
        
        // 获取生成的图片节点
        const configNode = getNodeById(imageConfigId)
        const imageNodeId = configNode?.data?.outputNodeId as string || ''
        
        if (!imageNodeId) {
          throw new Error('图片生成失败：未获取到输出节点')
        }

        const imageNode = getNodeById(imageNodeId)
        x = (imageNode?.x || x) + nodeSpacing

        setCurrentStep(4)
        let videoConfigId: string = ''

        withBatchUpdates(() => {
          videoConfigId = addNode(
            'videoConfig',
            { x, y: position.y + rowSpacing },
            { label: '图生视频' }
          )
          addLog('info', `创建视频配置节点: ${videoConfigId}`)

          addEdge(videoTextNodeId, videoConfigId)
          addEdge(imageNodeId, videoConfigId)
        })

        addLog('success', '文生图生视频工作流已创建，请手动执行视频生成')
        return { imageTextNodeId, videoTextNodeId, imageConfigId, imageNodeId, videoConfigId }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        addLog('error', `工作流执行失败: ${message}`)
        throw err
      }
    },
    [addNode, addEdge, withBatchUpdates, addLog, getNodeById]
  )

  /**
   * Execute storyboard workflow
   */
  const executeStoryboard = useCallback(
    async (
      character: { name: string; description: string } | undefined,
      shots: Array<{ title: string; prompt: string }> | undefined,
      position: Position
    ) => {
      const nodeSpacing = 400
      const rowSpacing = 250
      let x = position.x
      const y = position.y

      const shotCount = shots?.length || 0
      addLog('info', `开始执行分镜工作流: ${character?.name || '未知角色'}, ${shotCount} 个分镜`)
      setCurrentStep(1)
      setTotalSteps(2 + shotCount * 2)

      const createdNodes: {
        characterTextId: string | null
        characterConfigId: string | null
        characterImageId: string | null
        shots: Array<{
          textId: string
          configId: string
          imageId: string
          title: string
        }>
      } = {
        characterTextId: null,
        characterConfigId: null,
        characterImageId: null,
        shots: [],
      }

      try {
        const characterDesc = `${character?.name || '角色'}: ${character?.description || ''}`
        let characterConfigId: string = ''

        withBatchUpdates(() => {
          createdNodes.characterTextId = addNode(
            'text',
            { x, y },
            { content: characterDesc, label: `角色: ${character?.name || '参考'}` }
          )
          addLog('info', `创建角色描述节点: ${createdNodes.characterTextId}`)
          x += nodeSpacing

          setCurrentStep(2)
          characterConfigId = addNode(
            'imageConfig',
            { x, y },
            { label: '角色参考图', size: '3:4', quality: '2K' }
          )
          createdNodes.characterConfigId = characterConfigId
          addLog('info', `创建角色配置节点: ${characterConfigId}`)

          addEdge(createdNodes.characterTextId!, characterConfigId)
        })

        addLog('info', '开始生成角色参考图...')
        await generateImageFromConfigNode(characterConfigId)
        
        const charConfigNode = getNodeById(characterConfigId)
        createdNodes.characterImageId = charConfigNode?.data?.outputNodeId as string || ''
        
        if (!createdNodes.characterImageId) {
          throw new Error('角色参考图生成失败')
        }
        addLog('success', '角色参考图已生成')

        const charImageNode = getNodeById(createdNodes.characterImageId)
        x = (charImageNode?.x || x) + nodeSpacing

        for (let i = 0; i < shotCount; i++) {
          const shot = shots![i]
          const shotY = y + (i + 1) * rowSpacing
          let shotX = position.x

          setCurrentStep(3 + i * 2)

          let shotTextId: string = ''
          let shotConfigId: string = ''

          withBatchUpdates(() => {
            shotTextId = addNode(
              'text',
              { x: shotX, y: shotY },
              { content: shot.prompt, label: `分镜${i + 1}: ${shot.title}` }
            )
            addLog('info', `创建分镜${i + 1}文本节点: ${shotTextId}`)
            shotX += nodeSpacing

            setCurrentStep(4 + i * 2)
            shotConfigId = addNode(
              'imageConfig',
              { x: shotX, y: shotY },
              { label: `分镜${i + 1}`, size: '3:4', quality: '2K' }
            )
            addLog('info', `创建分镜${i + 1}配置节点: ${shotConfigId}`)

            addEdge(shotTextId, shotConfigId)
            addEdge(createdNodes.characterImageId!, shotConfigId)
          })

          addLog('info', `开始生成分镜${i + 1}...`)
          await generateImageFromConfigNode(shotConfigId)
          
          const shotConfigNode = getNodeById(shotConfigId)
          const shotImageId = shotConfigNode?.data?.outputNodeId as string || ''
          
          if (!shotImageId) {
            addLog('error', `分镜${i + 1}生成失败`)
            continue
          }
          addLog('success', `分镜${i + 1}已生成`)

          createdNodes.shots.push({
            textId: shotTextId,
            configId: shotConfigId,
            imageId: shotImageId,
            title: shot.title,
          })
        }

        addLog('success', `分镜工作流完成，共生成 ${createdNodes.shots.length} 个分镜`)
        return createdNodes
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        addLog('error', `分镜工作流执行失败: ${message}`)
        throw err
      }
    },
    [addNode, addEdge, withBatchUpdates, addLog, getNodeById]
  )

  /**
   * Execute batch images workflow (multiple independent images)
   */
  const executeBatchImages = useCallback(
    async (
      images: Array<{ title: string; prompt: string }> | undefined,
      position: Position
    ) => {
      const nodeSpacing = 400
      const rowSpacing = 280
      const x = position.x
      const y = position.y

      const imageCount = images?.length || 0
      addLog('info', `开始执行批量图片工作流: ${imageCount} 张图片`)
      setCurrentStep(1)
      setTotalSteps(imageCount * 2)

      const createdNodes: Array<{
        textId: string
        configId: string
        imageId: string | null
        title: string
      }> = []

      try {
        for (let i = 0; i < imageCount; i++) {
          const img = images![i]
          const imgY = y + i * rowSpacing
          let imgX = x

          setCurrentStep(1 + i * 2)

          // 直接使用 getState() 确保同步操作
          const store = useGraphStore.getState()
          
          // 1. 创建文本节点（提示词）
          const textId = store.addNode(
            'text',
            { x: imgX, y: imgY },
            { content: img.prompt, label: img.title || `图片${i + 1}` }
          )
          addLog('info', `创建图片${i + 1}文本节点: ${textId}`)
          imgX += nodeSpacing

          // 2. 创建图片配置节点（默认 3:4 比例）
          const configId = store.addNode(
            'imageConfig',
            { x: imgX, y: imgY },
            { 
              label: img.title || `生成图片${i + 1}`, 
              size: '3:4',
              quality: '2K'
            }
          )
          addLog('info', `创建图片${i + 1}配置节点: ${configId}`)

          // 3. 连接文本节点到配置节点
          const edgeId = store.addEdge(textId, configId)
          addLog('info', `创建边: ${edgeId} (${textId} -> ${configId})`)
          
          // 4. 验证边已创建
          const currentEdges = useGraphStore.getState().edges
          const edgeExists = currentEdges.some(e => e.source === textId && e.target === configId)
          addLog('info', `边验证: ${edgeExists ? '成功' : '失败'} (总边数: ${currentEdges.length})`)
          
          // 5. 等待确保状态已同步到 React Flow（增加到 300ms）
          console.log(`[Workflow] 等待 React Flow 同步节点 (textId: ${textId}, configId: ${configId})...`)
          await new Promise(resolve => setTimeout(resolve, 300))

          // 5. 调用生成函数
          addLog('info', `开始生成图片${i + 1}...`)
          let imageId: string | null = null
          try {
            await generateImageFromConfigNode(configId)
            // 获取生成的图片节点 ID
            const configNode = getNodeById(configId)
            imageId = (configNode?.data?.outputNodeId as string) || null
            addLog('success', `图片${i + 1}已生成`)
          } catch (err) {
            const errMsg = err instanceof Error ? err.message : String(err)
            addLog('error', `图片${i + 1}生成失败: ${errMsg}`)
            // 单张图片失败不中断整个流程，继续下一张
          }

          createdNodes.push({
            textId,
            configId,
            imageId,
            title: img.title || `图片${i + 1}`,
          })

          setCurrentStep(2 + i * 2)
        }

        const successCount = createdNodes.filter(n => n.imageId).length
        addLog('success', `批量图片工作流完成，成功生成 ${successCount}/${imageCount} 张图片`)
        return createdNodes
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        addLog('error', `批量图片工作流执行失败: ${message}`)
        throw err
      }
    },
    [addLog, getNodeById]
  )

  /**
   * Execute multi-angle storyboard workflow
   */
  const executeMultiAngleStoryboard = useCallback(
    async (multiAngle: { character_description: string } | undefined, position: Position) => {
      const nodeSpacing = 400
      const rowSpacing = 300
      const x = position.x
      const y = position.y

      const characterDesc = multiAngle?.character_description || ''
      const angles = ['front', 'side', 'back', 'top']

      addLog('info', `开始执行多角度分镜工作流: ${characterDesc.slice(0, 30)}...`)
      setCurrentStep(1)
      setTotalSteps(2 + angles.length * 2)

      const createdNodes: {
        characterImageId: string | null
        angles: Array<{
          key: string
          label: string
          english: string
          textId: string
          configId: string
          imageId: string | null
        }>
      } = {
        characterImageId: null,
        angles: [],
      }

      try {
        let characterImageId: string = ''

        withBatchUpdates(() => {
          characterImageId = addNode(
            'image',
            { x, y },
            { url: '', label: '主角色图（请上传）', isCharacterRef: true }
          )
        })
        createdNodes.characterImageId = characterImageId
        addLog('info', `创建主角色图节点: ${characterImageId}`)

        const angleX = x + nodeSpacing + 100

        for (let i = 0; i < angles.length; i++) {
          const angleKey = angles[i]
          const angleConfig = MULTI_ANGLE_PROMPTS[angleKey]
          const angleY = y + i * rowSpacing

          setCurrentStep(2 + i * 2)

          let textNodeId: string = ''
          let configNodeId: string = ''

          withBatchUpdates(() => {
            const promptContent = angleConfig.prompt(characterDesc)
            textNodeId = addNode(
              'text',
              { x: angleX, y: angleY },
              { content: promptContent, label: `${angleConfig.label}提示词` }
            )
            addLog('info', `创建${angleConfig.label}提示词节点: ${textNodeId}`)

            setCurrentStep(3 + i * 2)
            configNodeId = addNode(
              'imageConfig',
              { x: angleX + nodeSpacing, y: angleY },
              { label: `${angleConfig.label} (${angleConfig.english})`, autoExecute: false }
            )
            addLog('info', `创建${angleConfig.label}配置节点: ${configNodeId}`)

            addEdge(textNodeId, configNodeId)
            addEdge(characterImageId, configNodeId)
          })

          createdNodes.angles.push({
            key: angleKey,
            label: angleConfig.label,
            english: angleConfig.english,
            textId: textNodeId,
            configId: configNodeId,
            imageId: null,
          })
        }

        addLog('success', `多角度分镜工作流已创建，请上传主角色图后点击各节点的"立即生成"按钮`)
        return createdNodes
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        addLog('error', `多角度分镜工作流执行失败: ${message}`)
        throw err
      }
    },
    [addNode, addEdge, withBatchUpdates, addLog]
  )

  /**
   * Main execute function based on workflow type
   */
  const executeWorkflow = useCallback(
    async (params: WorkflowParams, position: Position) => {
      setIsExecuting(true)
      clearPolling()
      setExecutionLog([])

      const {
        workflow_type,
        image_prompt,
        video_prompt,
        character,
        shots,
        images,
        multi_angle,
        output_mode,
        reference_node_ids,
      } = params

      try {
        if (output_mode === 'text_only') {
          return await executeTextOnly(params, position)
        }
        switch (workflow_type) {
          case WORKFLOW_TYPES.MULTI_ANGLE_STORYBOARD:
            return await executeMultiAngleStoryboard(multi_angle, position)
          case WORKFLOW_TYPES.BATCH_IMAGES:
            return await executeBatchImages(images, position)
          case WORKFLOW_TYPES.STORYBOARD:
            return await executeStoryboard(character, shots, position)
          case WORKFLOW_TYPES.TEXT_TO_IMAGE_TO_VIDEO:
            return await executeTextToImageToVideo(
              image_prompt || '',
              video_prompt || '',
              position,
              reference_node_ids
            )
          case WORKFLOW_TYPES.TEXT_TO_IMAGE:
          default:
            return await executeTextToImage(image_prompt || '', position, reference_node_ids)
        }
      } finally {
        setIsExecuting(false)
        clearPolling()
      }
    },
    [
      clearPolling,
      executeTextOnly,
      executeMultiAngleStoryboard,
      executeBatchImages,
      executeStoryboard,
      executeTextToImageToVideo,
      executeTextToImage,
    ]
  )

  /**
   * Convenience method for simple text-to-image
   */
  const createTextToImageWorkflow = useCallback(
    (imagePrompt: string, position: Position) => {
      return executeWorkflow(
        {
          workflow_type: WORKFLOW_TYPES.TEXT_TO_IMAGE,
          image_prompt: imagePrompt,
          output_mode: 'workflow',
          needs_clarification: false,
          clarification_questions: [],
        },
        position
      )
    },
    [executeWorkflow]
  )

  /**
   * Convenience method for multi-angle storyboard
   */
  const createMultiAngleStoryboard = useCallback(
    (characterDescription: string, position: Position) => {
      return executeWorkflow(
        {
          workflow_type: WORKFLOW_TYPES.MULTI_ANGLE_STORYBOARD,
          multi_angle: { character_description: characterDescription },
          output_mode: 'workflow',
          needs_clarification: false,
          clarification_questions: [],
        },
        position
      )
    },
    [executeWorkflow]
  )

  /**
   * Reset state
   */
  const reset = useCallback(() => {
    setIsAnalyzing(false)
    setIsExecuting(false)
    setCurrentStep(0)
    setTotalSteps(0)
    setExecutionLog([])
    clearPolling()
  }, [clearPolling])

  return {
    // State
    isAnalyzing,
    isExecuting,
    currentStep,
    totalSteps,
    executionLog,

    // Methods
    analyzeIntent,
    executeWorkflow,
    createTextToImageWorkflow,
    createMultiAngleStoryboard,
    reset,

    // Constants
    WORKFLOW_TYPES,
    MULTI_ANGLE_PROMPTS,
  }
}

export default useWorkflowOrchestrator
