import React, { useEffect, useMemo, useRef, useState, useCallback, memo } from 'react'
import { Button } from '@/components/ui/button'
import { useGraphStore } from '@/graph/store'
import { buildCanvasContext, buildChatMessages, type ChatMessage } from '@/lib/contextEngine'
import { loadMemoryState, saveMemoryState, searchMemory, type MemoryItem } from '@/lib/memory'
import { twoStageStream, checkApiKey, classifyError } from '@/lib/nexusApi'
import { saveMedia } from '@/lib/mediaStorage'
import { cn } from '@/lib/utils'
import {
  buildPolishSystemPrompt,
  buildPolishUserText,
  collectUpstreamInputsForFocusAsync,
  inferPolishModeFromGraph,
  inferPolishModeFromText,
  selectBestPromptTemplate
} from '@/lib/polish'
import { useWorkflowOrchestrator, type IntentResult } from '@/hooks/useWorkflowOrchestrator'
import { NEXUS_SYSTEM_PROMPT, parseToolCalls, type ToolCall } from '@/config/nexusPrompt'
import {
  Paperclip,
  Globe,
  Brain,
  Zap,
  X,
  Image as ImageIcon,
  Sparkles,
  Lightbulb,
  ChevronUp
} from 'lucide-react'

type UiRole = 'user' | 'assistant'

type UiMessage = {
  id: string
  role: UiRole
  content: string
  createdAt: number
  streaming?: boolean
}

// 性能优化：memoized 消息组件
const MessageItem = memo(function MessageItem({ 
  message, 
  isLast 
}: { 
  message: UiMessage
  isLast: boolean 
}) {
  // 阻止鼠标事件冒泡，防止 React Flow 或其他父组件干扰文本选择
  const handleMouseDown = (e: React.MouseEvent) => {
    // 允许文本选择，但阻止冒泡到父容器
    e.stopPropagation()
  }
  
  const handleCopy = (e: React.ClipboardEvent) => {
    // 允许默认的复制行为
    // 不调用 preventDefault，让浏览器正常处理复制
  }

  return (
    <div 
      className={cn(
        'message-item',
        message.role === 'user' ? 'flex justify-end' : 'flex justify-start'
      )}
      style={{
        // 使用 content-visibility 让浏览器跳过屏幕外元素的渲染
        contentVisibility: isLast ? 'visible' : 'auto',
        containIntrinsicSize: isLast ? 'auto' : '0 80px',
      }}
      onMouseDown={handleMouseDown}
      onCopy={handleCopy}
    >
      <div
        className={cn(
          'max-w-[85%] whitespace-pre-wrap rounded-2xl px-3 py-2 text-sm leading-6',
          message.role === 'user'
            ? 'bg-[rgb(var(--accent-rgb)/0.12)] text-[var(--text-primary)] ring-1 ring-[rgb(var(--accent-rgb)/0.25)]'
            : 'bg-[var(--bg-primary)] text-[var(--text-primary)] ring-1 ring-[var(--border-color)]'
        )}
        style={{
          // 确保文本选择和复制正常工作
          userSelect: 'text',
          WebkitUserSelect: 'text',
          cursor: 'text',
        }}
      >
        {message.content || (message.streaming ? '...' : '')}
      </div>
    </div>
  )
}, (prevProps, nextProps) => {
  // 自定义比较函数，只在必要时重新渲染
  return (
    prevProps.message.id === nextProps.message.id &&
    prevProps.message.content === nextProps.message.content &&
    prevProps.message.streaming === nextProps.message.streaming &&
    prevProps.isLast === nextProps.isLast
  )
})

// 每次渲染的最大消息数量（性能优化）
const MAX_VISIBLE_MESSAGES = 50

type Attachment = {
  id: string
  fileName: string
  mimeType: string
  previewUrl: string
}

type Props = {
  onClose?: () => void
  onOpenSettings: () => void
  variant?: 'panel' | 'drawer'
  className?: string
  onClarificationNeeded?: (result: IntentResult) => void
}

const makeId = () => globalThis.crypto?.randomUUID?.() || `msg_${Date.now()}_${Math.random().toString(16).slice(2)}`

const CONVERSATION_KEY_PREFIX = 'nexus-conversation-v2'  // 基于项目 ID 的 key
const SCROLL_KEY = 'nexus-canvas-assistant-scrollTop-v1'
const AUTO_EXECUTE_KEY = 'nexus-auto-execute-v1'
const MEMORY_ENABLED_KEY = 'nexus-chat-memory-enabled'
const WEB_SEARCH_KEY = 'nexus-web-search-enabled'
const THINKING_KEY = 'nexus-thinking-enabled'

// 获取项目专属的聊天记录 key
const getConversationKey = (projectId: string) => `${CONVERSATION_KEY_PREFIX}:${projectId || 'default'}`

const loadConversation = (projectId: string) => {
  try {
    const raw = localStorage.getItem(getConversationKey(projectId))
    if (!raw) return [] as UiMessage[]
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return [] as UiMessage[]
    return parsed as UiMessage[]
  } catch {
    return [] as UiMessage[]
  }
}

const saveConversation = (projectId: string, messages: UiMessage[]) => {
  try {
    // 只保存最近 100 条消息，减少内存压力
    localStorage.setItem(getConversationKey(projectId), JSON.stringify(messages.slice(-100)))
  } catch {
    // ignore
  }
}

const loadScrollTop = () => {
  try {
    const raw = localStorage.getItem(SCROLL_KEY)
    if (!raw) return null
    const n = Number(raw)
    return Number.isFinite(n) && n >= 0 ? n : null
  } catch {
    return null
  }
}

const saveScrollTop = (scrollTop: number) => {
  try {
    localStorage.setItem(SCROLL_KEY, String(Math.max(0, Math.floor(scrollTop || 0))))
  } catch {
    // ignore
  }
}

const loadBoolPref = (key: string, defaultValue: boolean): boolean => {
  try {
    const raw = localStorage.getItem(key)
    if (raw === 'true') return true
    if (raw === 'false') return false
    return defaultValue
  } catch {
    return defaultValue
  }
}

const saveBoolPref = (key: string, value: boolean) => {
  try {
    localStorage.setItem(key, value ? 'true' : 'false')
  } catch {
    // ignore
  }
}

// Quick suggestions
const suggestions = [
  '像个魔法森林',
  '三只不同的小猫',
  '生成多角度分镜',
  '夏日田野环绕漫步'
]

export default function CanvasAssistantPanel({ onClose, onOpenSettings, variant = 'panel', className, onClarificationNeeded }: Props) {
  // 获取当前项目 ID，用于区分不同项目的聊天记录
  const projectId = useGraphStore((s) => s.projectId)
  
  const [messages, setMessages] = useState<UiMessage[]>(() => loadConversation(projectId))
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [mode, setMode] = useState<'chat' | 'polish'>('chat')

  // Feature toggles
  const [autoExecute, setAutoExecute] = useState(() => loadBoolPref(AUTO_EXECUTE_KEY, false))
  const [memoryEnabled, setMemoryEnabled] = useState(() => loadBoolPref(MEMORY_ENABLED_KEY, true))
  const [webSearchEnabled, setWebSearchEnabled] = useState(() => loadBoolPref(WEB_SEARCH_KEY, false))
  const [thinkingEnabled, setThinkingEnabled] = useState(() => loadBoolPref(THINKING_KEY, false))

  // Attachments
  const [attachments, setAttachments] = useState<Attachment[]>([])
  const fileInputRef = useRef<HTMLInputElement>(null)

  const initialScrollTop = useMemo(() => loadScrollTop(), [])
  const memoryRef = useRef(loadMemoryState())
  const controllerRef = useRef<AbortController | null>(null)
  const assistantIdRef = useRef<string | null>(null)
  const autoScrollRef = useRef(initialScrollTop == null)
  const listRef = useRef<HTMLDivElement | null>(null)
  const endRef = useRef<HTMLDivElement | null>(null)
  const rafUpdateRef = useRef<number>(0)
  const rafScrollSaveRef = useRef<number>(0)
  const scrollTopRef = useRef<number>(0)
  const pendingTextRef = useRef('')
  const fullTextRef = useRef('')
  const lastFlushTimeRef = useRef<number>(0)
  const prevProjectIdRef = useRef(projectId)

  // 当项目切换时，加载对应项目的聊天记录
  useEffect(() => {
    if (prevProjectIdRef.current !== projectId) {
      prevProjectIdRef.current = projectId
      setMessages(loadConversation(projectId))
      setError(null)
      setAttachments([])
    }
  }, [projectId])

  const graphSnapshot = useGraphStore((s) => ({ nodes: s.nodes, edges: s.edges, selectedNodeId: s.selectedNodeId }))
  const addNode = useGraphStore((s) => s.addNode)
  const addEdge = useGraphStore((s) => s.addEdge)
  const withBatchUpdates = useGraphStore((s) => s.withBatchUpdates)

  const canvasContext = useMemo(() => buildCanvasContext(graphSnapshot), [graphSnapshot])

  // Workflow orchestrator
  const {
    isAnalyzing,
    isExecuting,
    analyzeIntent,
    executeWorkflow,
    createTextToImageWorkflow,
    WORKFLOW_TYPES
  } = useWorkflowOrchestrator()

  // Save preferences
  useEffect(() => {
    saveBoolPref(AUTO_EXECUTE_KEY, autoExecute)
  }, [autoExecute])

  useEffect(() => {
    saveBoolPref(MEMORY_ENABLED_KEY, memoryEnabled)
  }, [memoryEnabled])

  useEffect(() => {
    saveBoolPref(WEB_SEARCH_KEY, webSearchEnabled)
  }, [webSearchEnabled])

  useEffect(() => {
    saveBoolPref(THINKING_KEY, thinkingEnabled)
  }, [thinkingEnabled])

  useEffect(() => {
    const t = window.setTimeout(() => saveConversation(projectId, messages), 250)
    return () => window.clearTimeout(t)
  }, [projectId, messages])

  useEffect(() => {
    if (initialScrollTop == null) return
    const el = listRef.current
    if (!el) return
    const top = initialScrollTop
    requestAnimationFrame(() => {
      el.scrollTop = top
    })
  }, [initialScrollTop])

  useEffect(() => {
    if (!autoScrollRef.current) return
    endRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages.length])

  const onScroll = () => {
    const el = listRef.current
    if (!el) return
    const dist = el.scrollHeight - el.scrollTop - el.clientHeight
    autoScrollRef.current = dist < 120

    scrollTopRef.current = el.scrollTop
    if (rafScrollSaveRef.current) return
    rafScrollSaveRef.current = requestAnimationFrame(() => {
      rafScrollSaveRef.current = 0
      saveScrollTop(scrollTopRef.current)
    })
  }

  const flushStreamingToState = () => {
    rafUpdateRef.current = 0
    if (!assistantIdRef.current) return
    const delta = pendingTextRef.current
    if (!delta) return
    pendingTextRef.current = ''
    fullTextRef.current += delta
    const finalText = fullTextRef.current
    lastFlushTimeRef.current = Date.now()

    setMessages((prev) => {
      if (prev.length === 0) return prev
      const last = prev[prev.length - 1]
      if (last.id !== assistantIdRef.current) return prev
      const next = prev.slice()
      next[next.length - 1] = { ...last, content: finalText }
      return next
    })

    if (autoScrollRef.current) endRef.current?.scrollIntoView({ behavior: 'auto' })
  }

  const scheduleFlush = () => {
    if (rafUpdateRef.current) return
    // 节流：至少间隔 32ms（约 30fps）更新一次 UI，减少渲染压力
    const now = Date.now()
    const timeSinceLastFlush = now - lastFlushTimeRef.current
    if (timeSinceLastFlush < 32) {
      rafUpdateRef.current = window.setTimeout(() => {
        rafUpdateRef.current = 0
        flushStreamingToState()
      }, 32 - timeSinceLastFlush) as unknown as number
    } else {
      rafUpdateRef.current = requestAnimationFrame(flushStreamingToState)
    }
  }

  const stop = () => {
    if (controllerRef.current) {
      controllerRef.current.abort()
      controllerRef.current = null
    }
    setBusy(false)
  }

  const clear = () => {
    stop()
    setMessages([])
    setError(null)
    setAttachments([])
    saveConversation(projectId, [])
    saveScrollTop(0)
  }

  const maybeRemember = (text: string) => {
    if (!memoryEnabled) return
    const t = String(text || '').trim()
    if (!t) return
    const should =
      /^记住[:：]/.test(t) ||
      /请记住/.test(t) ||
      /我的偏好/.test(t) ||
      /我习惯/.test(t) ||
      /我更喜欢/.test(t)
    if (!should) return

    const next: MemoryItem = {
      id: makeId(),
      content: t.replace(/^记住[:：]\s*/, ''),
      importance: 0.6,
      updatedAt: Date.now()
    }
    const mem = memoryRef.current
    const merged = { ...mem, items: [next, ...(mem.items || [])].slice(0, 200) }
    memoryRef.current = merged
    saveMemoryState(merged)
  }

  const appendMessage = useCallback((role: UiRole, content: string) => {
    const id = makeId()
    setMessages((prev) => [
      ...prev,
      { id, role, content, createdAt: Date.now() }
    ])
    return id
  }, [])

  const getSpawnPosition = useCallback(() => {
    const viewport = useGraphStore.getState().viewport
    const z = viewport.zoom || 1
    const wrap =
      (typeof document !== 'undefined'
        ? (document.querySelector('[data-canvas-wrap="1"]') as HTMLElement | null)
        : null) || null
    if (wrap) {
      const rect = wrap.getBoundingClientRect()
      const centerX = (rect.width * 0.5 - viewport.x) / z
      const centerY = (rect.height * 0.5 - viewport.y) / z
      return { x: centerX - 100, y: centerY - 100 }
    }
    const centerX = -viewport.x / z + window.innerWidth / 2 / z
    const centerY = -viewport.y / z + window.innerHeight / 2 / z
    return { x: centerX - 100, y: centerY - 100 }
  }, [])

  const handleAttachmentUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event?.target?.files || [])
    if (event?.target) event.target.value = ''
    if (!files.length) return

    for (const file of files.slice(0, 6)) {
      if (!file || !file.type || !file.type.startsWith('image/')) continue
      try {
        const previewUrl = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader()
          reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : '')
          reader.onerror = () => reject(reader.error || new Error('读取失败'))
          reader.readAsDataURL(file)
        })
        setAttachments((prev) => [
          ...prev,
          {
            id: makeId(),
            fileName: file.name || 'image',
            mimeType: file.type,
            previewUrl
          }
        ].slice(0, 6))
      } catch {
        // ignore
      }
    }
  }

  const removeAttachment = (id: string) => {
    setAttachments((prev) => prev.filter((a) => a.id !== id))
  }

  const formatClarificationForChat = (result: IntentResult): string => {
    const ctx = String(result?.clarification_context || '').trim()
    const qs = Array.isArray(result?.clarification_questions) ? result.clarification_questions : []
    const lines: string[] = []
    if (ctx) lines.push(ctx)
    if (qs.length) {
      lines.push('需要你补充：')
      qs.slice(0, 6).forEach((q, idx) => {
        const question = String(q?.question || '').trim()
        if (!question) return
        lines.push(`${idx + 1}. ${question}`)
      })
    }
    return lines.join('\n')
  }

  const formatWorkflowForChat = (result: IntentResult): string => {
    const desc = String(result?.description || '').trim()
    const type = String(result?.workflow_type || '').trim()
    const output = String(result?.output_mode || '').trim()
    const lines: string[] = []
    if (desc) lines.push(`已识别任务：${desc}`)
    if (type) lines.push(`工作流类型：${type}`)
    if (output) lines.push(`输出模式：${output}`)
    return lines.join('\n')
  }

  // 执行工具调用
  const executeToolCall = useCallback(async (call: ToolCall, position: { x: number; y: number }) => {
    const { name, arguments: args } = call
    const nodeSpacing = 400

    switch (name) {
      case 'create_image_workflow': {
        const prompt = String(args?.prompt || '')
        if (!prompt) return
        await createTextToImageWorkflow(prompt, position)
        break
      }
      case 'create_video_workflow': {
        const imagePrompt = String(args?.image_prompt || '')
        const videoPrompt = String(args?.video_prompt || imagePrompt)
        if (!imagePrompt) return
        await executeWorkflow({
          workflow_type: 'text_to_image_to_video',
          image_prompt: imagePrompt,
          video_prompt: videoPrompt,
          output_mode: 'workflow',
          needs_clarification: false,
          clarification_questions: []
        }, position)
        break
      }
      case 'create_storyboard': {
        const shots = Array.isArray(args?.shots) ? args.shots : []
        const character = args?.character as { name?: string; description?: string } | undefined
        if (shots.length === 0) return
        await executeWorkflow({
          workflow_type: 'storyboard',
          character: character ? { name: character.name || '', description: character.description || '' } : undefined,
          shots: shots.map((s: any) => ({ title: s?.title || '', prompt: s?.prompt || '' })),
          output_mode: 'workflow',
          needs_clarification: false,
          clarification_questions: []
        }, position)
        break
      }
      case 'create_text_node': {
        const content = String(args?.content || '')
        const label = String(args?.label || '文本')
        if (!content) return
        withBatchUpdates(() => {
          addNode('text', position, { content, label })
        })
        break
      }
      case 'create_script': {
        const content = String(args?.content || '')
        const title = String(args?.title || '剧本')
        if (!content) return
        withBatchUpdates(() => {
          addNode('text', position, { content, label: title })
        })
        break
      }
      case 'polish_prompt': {
        // 润色功能已内置在对话流程中，这里不额外处理
        break
      }
      default:
        console.warn(`[Nexus] 未知工具调用: ${name}`)
    }
  }, [addNode, withBatchUpdates, createTextToImageWorkflow, executeWorkflow])

  const send = async () => {
    console.log('[CanvasAssistant] send() called, autoExecute:', autoExecute)
    let text = input.trim()
    if (!text && attachments.length === 0) {
      console.log('[CanvasAssistant] send() 退出：无输入')
      return
    }
    if (busy) {
      console.log('[CanvasAssistant] send() 退出：busy=true')
      return
    }

    // 发送前刷新一次本地记忆（避免与独立助手页/其它标签页不同步）
    memoryRef.current = loadMemoryState()

    // API Key 前置检查
    const keyCheck = checkApiKey()
    console.log('[CanvasAssistant] API Key 检查:', keyCheck)
    if (!keyCheck.ok) {
      setError(keyCheck.message || '请先配置 API Key')
      return
    }

    setError(null)
    setBusy(true)

    controllerRef.current?.abort()
    controllerRef.current = new AbortController()

    const currentAttachments = attachments.slice()
    setAttachments([])
    setInput('')

    try {
      const position = getSpawnPosition()

      // Create reference image nodes from attachments
      let referenceNodeIds: string[] = []
      if (currentAttachments.length > 0) {
        const persistRefs: Array<{ id: string; dataUrl: string }> = []
        withBatchUpdates(() => {
          currentAttachments.forEach((att, index) => {
            const nodeId = addNode('image', { x: position.x - 460, y: position.y + index * 280 }, {
              url: att.previewUrl,
              sourceUrl: '',
              mediaId: '',
              label: `参考图${index + 1}`,
              isReference: true,
              updatedAt: Date.now()
            })
            referenceNodeIds.push(nodeId)
            persistRefs.push({ id: nodeId, dataUrl: att.previewUrl })
          })
        })

        // 写入 IndexedDB，确保参考图跨重启可恢复
        const pid = useGraphStore.getState().projectId || 'default'
        for (const ref of persistRefs) {
          try {
            const mediaId = await saveMedia({
              nodeId: ref.id,
              projectId: pid,
              type: 'image',
              data: ref.dataUrl,
            })
            if (mediaId) useGraphStore.getState().patchNodeDataSilent(ref.id, { mediaId })
          } catch {
            // ignore
          }
        }
      }

      if (autoExecute) {
        console.log('[CanvasAssistant] 自动执行模式')
        // Auto-execute mode: analyze intent and execute workflow
        if (!text && referenceNodeIds.length > 0) {
          text = '我上传了参考图。请先用一句话概括参考图内容，然后问我希望生成什么画面/风格/用途，再执行生图。'
        }

        appendMessage('user', text)
        maybeRemember(text)

        const hint = referenceNodeIds.length > 0 
          ? `\n\n【参考图】已上传 ${referenceNodeIds.length} 张参考图（可用于风格/角色一致性/图生图）。` 
          : ''

        // 传递对话历史，让 AI 理解"上文"、"之前"等引用
        const conversationHistory = messages.map((m) => ({ role: m.role, content: m.content }))
        console.log('[CanvasAssistant] 调用 analyzeIntent...')
        const result = await analyzeIntent(`${text}${hint}`, conversationHistory)
        console.log('[CanvasAssistant] analyzeIntent 结果:', result)

        // Check if clarification is needed
        if (result?.needs_clarification && Array.isArray(result.clarification_questions) && result.clarification_questions.length > 0) {
          appendMessage('assistant', formatClarificationForChat(result))
          // Trigger clarification dialog
          onClarificationNeeded?.(result)
          setBusy(false)
          return
        }

        appendMessage('assistant', formatWorkflowForChat(result))

        const workflowParams = {
          ...result,
          raw_input: text,
          reference_node_ids: referenceNodeIds,
          image_prompt: result?.image_prompt || text,
          video_prompt: result?.video_prompt || text,
        }

        console.log('[CanvasAssistant] 调用 executeWorkflow...')
        await executeWorkflow(workflowParams, position)
        console.log('[CanvasAssistant] executeWorkflow 完成')
      } else {
        // Chat mode
        const conversation: ChatMessage[] = messages.map((m) => ({ role: m.role, content: m.content }))
        const userMsg: UiMessage = { id: makeId(), role: 'user', content: text, createdAt: Date.now() }
        const assistantId = makeId()
        assistantIdRef.current = assistantId
        pendingTextRef.current = ''
        fullTextRef.current = ''

        setMessages((prev) => [
          ...prev,
          userMsg,
          { id: assistantId, role: 'assistant', content: '', createdAt: Date.now(), streaming: true }
        ])
        maybeRemember(text)

        const mem = memoryRef.current
        const hits = memoryEnabled ? await searchMemory(text, mem.items || [], 6, 0.12) : []
        const isPolish = mode === 'polish'
        const inferredMode = inferPolishModeFromGraph(graphSnapshot.selectedNodeId || null, graphSnapshot.nodes, graphSnapshot.edges)
        const polishMode = isPolish ? inferredMode || inferPolishModeFromText(text) : null

        const upstream = isPolish
          ? await collectUpstreamInputsForFocusAsync({
              focusNodeId: graphSnapshot.selectedNodeId || null,
              nodes: graphSnapshot.nodes,
              edges: graphSnapshot.edges
            })
          : { text: [], images: [] }

        const promptTemplate = isPolish
          ? await selectBestPromptTemplate({
              mode: polishMode || 'image',
              userText: text,
              contextText: canvasContext
            })
          : null

        // 使用 NEXUS_SYSTEM_PROMPT 或润色模式的专用提示词
        const systemPrompt = isPolish
          ? buildPolishSystemPrompt(polishMode || 'image')
          : NEXUS_SYSTEM_PROMPT

        const userText = isPolish
          ? buildPolishUserText({
              mode: polishMode || 'image',
              userText: text,
              promptTemplate,
              upstreamInputs: upstream
            })
          : text

        const finalMsgList = await buildChatMessages({
          userText,
          systemPrompt,
          conversation,
          memorySummary: mem.summary || '',
          memoryItems: hits,
          canvasContext,
          config: { maxChars: 12000, maxHistory: 16, maxMemoryItems: 6, maxCanvasChars: 1200 }
        })

        // 使用双阶段调用（如果启用了思考/联网）
        const inputMessages = finalMsgList.map((m: any) => ({
          role: m.role as 'system' | 'user' | 'assistant',
          content: m.content
        }))

        for await (const chunk of twoStageStream({
          input: inputMessages,
          useThinking: thinkingEnabled,
          useWebSearch: webSearchEnabled,
          signal: controllerRef.current.signal
        })) {
          pendingTextRef.current += chunk
          scheduleFlush()
        }

        // 取消待处理的更新（可能是 RAF 或 setTimeout）
        if (rafUpdateRef.current) {
          cancelAnimationFrame(rafUpdateRef.current)
          clearTimeout(rafUpdateRef.current)
        }
        flushStreamingToState()

        // 检查是否有工具调用
        const toolResponse = parseToolCalls(fullTextRef.current)
        if (toolResponse?.tool_calls && toolResponse.tool_calls.length > 0) {
          // 执行工具调用
          const position = getSpawnPosition()
          for (const call of toolResponse.tool_calls) {
            await executeToolCall(call, position)
          }
          // 如果有消息部分，更新显示
          if (toolResponse.message) {
            fullTextRef.current = toolResponse.message
          }
        }

        setMessages((prev) => {
          if (prev.length === 0) return prev
          const last = prev[prev.length - 1]
          if (last.id !== assistantId) return prev
          const next = prev.slice()
          next[next.length - 1] = { ...last, content: fullTextRef.current, streaming: false }
          return next
        })
      }
    } catch (e: any) {
      if (e?.name === 'AbortError') return
      // 使用 classifyError 获取友好错误提示
      const classified = classifyError(e)
      setError(classified.message)
      setMessages((prev) => {
        if (prev.length === 0) return prev
        const last = prev[prev.length - 1]
        if (last.streaming) {
          const next = prev.slice()
          next[next.length - 1] = { ...last, streaming: false }
          return next
        }
        return prev
      })
    } finally {
      controllerRef.current = null
      setBusy(false)
    }
  }

  const handleSuggestionClick = (suggestion: string) => {
    setInput(suggestion)
  }

  const rootClass = cn(
    'flex flex-col overflow-hidden',
    variant === 'panel'
      ? 'h-full w-[360px] border-r border-[var(--border-color)] bg-[var(--bg-secondary)]'
      : 'h-full w-full bg-transparent',
    className
  )

  const isBusy = busy || isAnalyzing || isExecuting

  return (
    <div className={rootClass}>
      {/* Header */}
      <div className="flex items-center justify-between border-b border-[var(--border-color)] px-4 py-3">
        <div className="flex items-center gap-2">
          <div className="text-sm font-semibold text-[var(--text-primary)]">nexus</div>
          <div className="flex items-center gap-1 rounded-full border border-[var(--border-color)] bg-[var(--bg-primary)] p-1">
            <button
              className={cn(
                'rounded-full px-3 py-1 text-xs transition-colors',
                mode === 'chat'
                  ? 'bg-[rgb(var(--accent-rgb)/0.12)] text-[var(--accent-color)]'
                  : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
              )}
              onClick={() => setMode('chat')}
            >
              对话
            </button>
            <button
              className={cn(
                'rounded-full px-3 py-1 text-xs transition-colors',
                mode === 'polish'
                  ? 'bg-[rgb(var(--accent-rgb)/0.12)] text-[var(--accent-color)]'
                  : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
              )}
              onClick={() => setMode('polish')}
            >
              润色
            </button>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" onClick={clear}>
            清空
          </Button>
          <Button variant="ghost" size="sm" onClick={onOpenSettings}>
            设置
          </Button>
          <Button variant="ghost" size="sm" onClick={onClose}>
            关闭
          </Button>
        </div>
      </div>

      {/* Feature toggles */}
      <div className="flex items-center gap-2 border-b border-[var(--border-color)] px-4 py-2">
        <button
          onClick={() => setAutoExecute(!autoExecute)}
          className={cn(
            'flex items-center gap-1 rounded-full px-2 py-1 text-xs transition-colors',
            autoExecute
              ? 'bg-[rgb(var(--accent-rgb)/0.15)] text-[var(--accent-color)]'
              : 'bg-[var(--bg-primary)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
          )}
          title="自动执行模式：AI 分析后自动创建工作流"
        >
          <Zap className="h-3 w-3" />
          <span>自动</span>
        </button>
        <button
          onClick={() => setMemoryEnabled(!memoryEnabled)}
          className={cn(
            'flex items-center gap-1 rounded-full px-2 py-1 text-xs transition-colors',
            memoryEnabled
              ? 'bg-[rgb(var(--accent-rgb)/0.15)] text-[var(--accent-color)]'
              : 'bg-[var(--bg-primary)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
          )}
          title="记忆系统：记住你的偏好和历史"
        >
          <Brain className="h-3 w-3" />
          <span>记忆</span>
        </button>
        <button
          onClick={() => setWebSearchEnabled(!webSearchEnabled)}
          className={cn(
            'flex items-center gap-1 rounded-full px-2 py-1 text-xs transition-colors',
            webSearchEnabled
              ? 'bg-[rgb(var(--accent-rgb)/0.15)] text-[var(--accent-color)]'
              : 'bg-[var(--bg-primary)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
          )}
          title="联网搜索：回答问题时搜索网络"
        >
          <Globe className="h-3 w-3" />
          <span>联网</span>
        </button>
        <button
          onClick={() => setThinkingEnabled(!thinkingEnabled)}
          className={cn(
            'flex items-center gap-1 rounded-full px-2 py-1 text-xs transition-colors',
            thinkingEnabled
              ? 'bg-[rgb(var(--accent-rgb)/0.15)] text-[var(--accent-color)]'
              : 'bg-[var(--bg-primary)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
          )}
          title="深度思考：启用更强大的推理模型进行深度分析"
        >
          <Lightbulb className="h-3 w-3" />
          <span>思考</span>
        </button>
      </div>

      {/* Messages */}
      <div
        ref={listRef}
        onScroll={onScroll}
        className="flex-1 overflow-y-auto p-4 [scrollbar-gutter:stable]"
        style={{
          // 移除 contain: layout paint，它会干扰文本选择和复制
          // 只保留 will-change 优化滚动
          willChange: 'scroll-position',
          // 确保文本选择正常工作
          userSelect: 'text',
          WebkitUserSelect: 'text',
        }}
      >
        {messages.length === 0 ? (
          <div className="space-y-4">
            <div className="rounded-xl border border-[var(--border-color)] bg-[var(--bg-primary)] p-4">
              <div className="text-sm font-semibold">
                {autoExecute ? '自动执行模式' : '像 ChatGPT 一样聊天'}
              </div>
              <div className="mt-2 text-xs text-[var(--text-secondary)]">
                {autoExecute 
                  ? '输入描述，AI 会自动分析并创建工作流节点。'
                  : '我会检索长期记忆，并把画布焦点节点及其上游信息拼到上下文里再回答。'}
              </div>
              <div className="mt-3 rounded-xl border border-[var(--border-color)] bg-[var(--bg-secondary)] p-3 text-xs text-[var(--text-secondary)]">
                <div className="font-semibold text-[var(--text-primary)]">当前项目上下文（截断预览）</div>
                <pre className="mt-2 max-h-40 overflow-auto whitespace-pre-wrap">{canvasContext || '（空）'}</pre>
              </div>
            </div>

            {/* Quick suggestions */}
            <div className="flex flex-wrap gap-2">
              {suggestions.map((suggestion) => (
                <button
                  key={suggestion}
                  onClick={() => handleSuggestionClick(suggestion)}
                  className="rounded-full border border-[var(--border-color)] bg-[var(--bg-primary)] px-3 py-1.5 text-xs text-[var(--text-secondary)] transition-colors hover:border-[var(--accent-color)] hover:text-[var(--text-primary)]"
                >
                  <Sparkles className="mr-1 inline-block h-3 w-3" />
                  {suggestion}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            {/* 性能优化：只渲染最近的消息，更早的消息可以通过按钮加载 */}
            {messages.length > MAX_VISIBLE_MESSAGES && (
              <div className="flex justify-center">
                <button
                  onClick={() => {
                    // 滚动到顶部显示更多消息
                    const el = listRef.current
                    if (el) el.scrollTop = 0
                  }}
                  className="flex items-center gap-1 rounded-full border border-[var(--border-color)] bg-[var(--bg-primary)] px-3 py-1.5 text-xs text-[var(--text-secondary)] transition-colors hover:border-[var(--accent-color)] hover:text-[var(--text-primary)]"
                >
                  <ChevronUp className="h-3 w-3" />
                  还有 {messages.length - MAX_VISIBLE_MESSAGES} 条更早的消息
                </button>
              </div>
            )}
            {/* 渲染可见消息 */}
            {messages.slice(-MAX_VISIBLE_MESSAGES).map((m, index, arr) => (
              <MessageItem 
                key={m.id} 
                message={m} 
                isLast={index === arr.length - 1}
              />
            ))}
            <div ref={endRef} />
          </div>
        )}
      </div>

      {/* Error message */}
      {error ? <div className="px-4 pb-2 text-sm text-[var(--danger-color)]">{error}</div> : null}

      {/* Attachments preview */}
      {attachments.length > 0 && (
        <div className="flex gap-2 overflow-x-auto border-t border-[var(--border-color)] p-3">
          {attachments.map((att) => (
            <div key={att.id} className="relative flex-shrink-0">
              <img
                src={att.previewUrl}
                alt={att.fileName}
                className="h-16 w-16 rounded-lg object-cover ring-1 ring-[var(--border-color)]"
              />
              <button
                onClick={() => removeAttachment(att.id)}
                className="absolute -right-1 -top-1 rounded-full bg-[var(--bg-secondary)] p-0.5 text-[var(--text-secondary)] hover:text-[var(--danger-color)]"
              >
                <X className="h-3 w-3" />
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Input area */}
      <div className="border-t border-[var(--border-color)] p-3">
        <div className="rounded-2xl border border-[var(--border-color)] bg-[var(--bg-primary)] p-3 shadow-sm">
          <div className="flex items-end gap-2">
            <div className="flex flex-1 flex-col gap-2">
              {/* Attachment button */}
              <div className="flex items-center gap-2">
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  multiple
                  onChange={handleAttachmentUpload}
                  className="hidden"
                />
                <button
                  onClick={() => fileInputRef.current?.click()}
                  className="flex items-center gap-1 rounded-lg px-2 py-1 text-xs text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-secondary)] hover:text-[var(--text-primary)]"
                >
                  <Paperclip className="h-3.5 w-3.5" />
                  <span>参考图</span>
                </button>
                {autoExecute && (
                  <span className="text-xs text-[var(--accent-color)]">
                    {isBusy ? (
                      <>
                        <span className="mr-1 inline-block h-3 w-3 animate-spin rounded-full border-2 border-current border-t-transparent" />
                        {isAnalyzing ? '分析中...' : isExecuting ? '执行中...' : '处理中...'}
                      </>
                    ) : (
                      <>
                        <Zap className="mr-0.5 inline h-3 w-3" />
                        自动执行模式
                      </>
                    )}
                  </span>
                )}
              </div>

              <textarea
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  // 忽略输入法组合状态（如中文选字时的回车）
                  if (e.nativeEvent.isComposing || e.keyCode === 229) return
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault()
                    void send()
                  }
                }}
                placeholder={
                  autoExecute
                    ? '描述你想创建的内容…（AI 会自动分析并执行）'
                    : mode === 'polish'
                    ? '输入要润色的提示词…（会参考选中节点链路与提示词库）'
                    : '输入消息…（Enter 发送）'
                }
                className="min-h-[52px] w-full flex-1 resize-none rounded-xl border border-[var(--border-color)] bg-[var(--bg-secondary)] px-3 py-3 text-sm text-[var(--text-primary)] outline-none placeholder:text-[var(--text-secondary)] focus:ring-2 focus:ring-[rgb(var(--accent-rgb)/0.35)]"
              />
            </div>
            {isBusy ? (
              <Button variant="secondary" onClick={stop}>
                停止
              </Button>
            ) : (
              <Button onClick={() => void send()} disabled={!input.trim() && attachments.length === 0}>
                {autoExecute ? '执行' : '发送'}
              </Button>
            )}
          </div>
          <div className="mt-2 text-xs text-[var(--text-secondary)]">
            {autoExecute
              ? '提示：自动模式会分析你的意图并创建工作流节点'
              : '提示：用「记住：...」可写入长期记忆（本地）'}
          </div>
        </div>
      </div>
    </div>
  )
}
