import React, { useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import SettingsDialog from '@/components/SettingsDialog'
import { useGraphStore } from '@/graph/store'
import { buildCanvasContext, buildChatMessages, type ChatMessage } from '@/lib/contextEngine'
import { loadMemoryState, saveMemoryState, searchMemory, type MemoryItem } from '@/lib/memory'
import { streamResponses } from '@/lib/nexusApi'
import { useSettingsStore } from '@/store/settings'
import {
  buildPolishSystemPrompt,
  buildPolishUserText,
  collectUpstreamInputsForFocusAsync,
  inferPolishModeFromGraph,
  inferPolishModeFromText,
  selectBestPromptTemplate
} from '@/lib/polish'

type UiRole = 'user' | 'assistant'

type UiMessage = {
  id: string
  role: UiRole
  content: string
  createdAt: number
  streaming?: boolean
}

const makeId = () => globalThis.crypto?.randomUUID?.() || `msg_${Date.now()}_${Math.random().toString(16).slice(2)}`

const CONVERSATION_KEY = 'nexus-conversation-v1'
const SCROLL_KEY = 'nexus-assistant-scrollTop-v1'

const loadConversation = () => {
  try {
    const raw = localStorage.getItem(CONVERSATION_KEY)
    if (!raw) return [] as UiMessage[]
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return [] as UiMessage[]
    return parsed as UiMessage[]
  } catch {
    return [] as UiMessage[]
  }
}

const saveConversation = (messages: UiMessage[]) => {
  try {
    localStorage.setItem(CONVERSATION_KEY, JSON.stringify(messages.slice(-200)))
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

export default function Assistant() {
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [messages, setMessages] = useState<UiMessage[]>(() => loadConversation())
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [mode, setMode] = useState<'chat' | 'polish'>('chat')

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

  const graphSnapshot = useGraphStore((s) => ({ nodes: s.nodes, edges: s.edges, selectedNodeId: s.selectedNodeId }))

  const canvasContext = useMemo(() => buildCanvasContext(graphSnapshot), [graphSnapshot])

  useEffect(() => {
    // Assistant 页面也需要读到当前画布上下文：默认加载当前 projectId（未进入画布时为 default）
    if (useGraphStore.getState().nodes.length > 0) return
    void useGraphStore.getState().hydrate(useGraphStore.getState().projectId || 'default')
  }, [])

  useEffect(() => {
    const t = window.setTimeout(() => saveConversation(messages), 250)
    return () => window.clearTimeout(t)
  }, [messages])

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
    rafUpdateRef.current = requestAnimationFrame(flushStreamingToState)
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
    saveConversation([])
    saveScrollTop(0)
  }

  const maybeRemember = (text: string) => {
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

  const send = async () => {
    const text = input.trim()
    if (!text || busy) return
    setError(null)
    setBusy(true)

    // 发送前刷新一次本地记忆（避免与画布助手/其它标签页不同步）
    memoryRef.current = loadMemoryState()

    controllerRef.current?.abort()
    controllerRef.current = new AbortController()

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
    setInput('')
    maybeRemember(text)

    try {
      const mem = memoryRef.current
      const hits = await searchMemory(text, mem.items || [], 6, 0.12)
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

      const systemPrompt = isPolish
        ? buildPolishSystemPrompt(polishMode || 'image')
        : [
          '你是 Nexus AI 创作助手，精通 AI 绘图、AI 视频生成、短剧制作、电商视觉设计。',
          '',
          '【核心能力】',
          '- 文生图提示词优化：根据用户意图生成高质量中英双语提示词，包含主体描述、风格标签、光影氛围、画质修饰词、负面提示词',
          '- 图生视频脚本：设计镜头运动（推/拉/摇/移/跟/环绕）、角色动作编排、表情变化、焦点转移',
          '- 短剧分镜：分析剧本结构，设计视觉节奏（景别变化、情绪曲线、转场逻辑）',
          '- 角色一致性：通过冻结文本锚定（frozen text anchor）+ 参考图链接确保跨镜头角色统一',
          '- 电商视觉：产品主图/详情页/场景图/白底图的专业提示词',
          '',
          '【工作原则】',
          '1. 先用 1-2 个问题澄清用户真实意图（什么场景？什么风格？什么模型？）',
          '2. 给出可直接复制使用的提示词（中文描述 + 英文关键词），不要空谈理论',
          '3. 参考【长期记忆】和【当前项目上下文】，保持建议的连贯性',
          '4. 提示词中始终包含角色完整外貌描述（从设定中提取），确保一致性',
          '5. 视频提示词必须指定一种镜头运动 + 动作节奏 + 时长适配',
        ].join('\n')

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

      for await (const chunk of streamResponses({ model: useSettingsStore.getState().aiAssistantModel, input: finalMsgList }, controllerRef.current.signal)) {
        pendingTextRef.current += chunk
        scheduleFlush()
      }

      if (rafUpdateRef.current) cancelAnimationFrame(rafUpdateRef.current)
      flushStreamingToState()

      setMessages((prev) => {
        if (prev.length === 0) return prev
        const last = prev[prev.length - 1]
        if (last.id !== assistantId) return prev
        const next = prev.slice()
        next[next.length - 1] = { ...last, content: fullTextRef.current, streaming: false }
        return next
      })
    } catch (e: any) {
      if (e?.name === 'AbortError') return
      setError(e?.message || '发送失败')
      setMessages((prev) => {
        if (prev.length === 0) return prev
        const last = prev[prev.length - 1]
        if (last.id !== assistantId) return prev
        const next = prev.slice()
        next[next.length - 1] = { ...last, streaming: false }
        return next
      })
    } finally {
      controllerRef.current = null
      setBusy(false)
    }
  }

  return (
    <div className="h-full w-full bg-[var(--bg-primary)] text-[var(--text-primary)]">
      <header className="flex items-center justify-between border-b border-[var(--border-color)] bg-[var(--bg-secondary)] px-4 py-3">
        <div className="flex items-center gap-2">
          <Link to="/">
            <Button variant="ghost">返回</Button>
          </Link>
          <div className="text-sm font-semibold">nexus</div>
          <div className="ml-2 flex items-center gap-1 rounded-full border border-[var(--border-color)] bg-[var(--bg-primary)] p-1">
            <button
              className={[
                'rounded-full px-3 py-1 text-xs',
                mode === 'chat'
                  ? 'bg-[rgb(var(--accent-rgb)/0.12)] text-[var(--accent-color)]'
                  : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
              ].join(' ')}
              onClick={() => setMode('chat')}
            >
              对话
            </button>
            <button
              className={[
                'rounded-full px-3 py-1 text-xs',
                mode === 'polish'
                  ? 'bg-[rgb(var(--accent-rgb)/0.12)] text-[var(--accent-color)]'
                  : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
              ].join(' ')}
              onClick={() => setMode('polish')}
            >
              润色
            </button>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="secondary" onClick={() => clear()}>
            清空对话
          </Button>
          <Button variant="secondary" onClick={() => setSettingsOpen(true)}>
            API 设置
          </Button>
        </div>
      </header>

      <div className="mx-auto flex h-[calc(100%-56px)] max-w-4xl flex-col px-4">
        <div
          ref={listRef}
          onScroll={onScroll}
          className="flex-1 overflow-y-auto py-6 [scrollbar-gutter:stable] selection:bg-[rgb(var(--accent-rgb)/0.18)]"
        >
          {messages.length === 0 ? (
            <div className="mx-auto max-w-2xl rounded-2xl border border-[var(--border-color)] bg-[var(--bg-secondary)] p-6">
              <div className="text-base font-semibold">像 ChatGPT 一样聊天</div>
              <div className="mt-2 text-sm text-[var(--text-secondary)]">
                我会优先检索长期记忆，并把画布焦点节点及其上游信息拼到上下文里，再回答你。
              </div>
              <div className="mt-4 rounded-xl border border-[var(--border-color)] bg-[var(--bg-primary)] p-3 text-xs text-[var(--text-secondary)]">
                <div className="font-semibold text-[var(--text-primary)]">当前项目上下文（截断预览）</div>
                <pre className="mt-2 max-h-40 overflow-auto whitespace-pre-wrap">{canvasContext || '（空）'}</pre>
              </div>
            </div>
          ) : (
            <div className="space-y-6">
              {messages.map((m) => (
                <div key={m.id} className={m.role === 'user' ? 'flex justify-end' : 'flex justify-start'}>
                  <div
                    className={[
                      'max-w-[85%] whitespace-pre-wrap rounded-2xl px-4 py-3 text-sm leading-6',
                      m.role === 'user'
                        ? 'bg-[rgb(var(--accent-rgb)/0.12)] text-[var(--text-primary)] ring-1 ring-[rgb(var(--accent-rgb)/0.25)]'
                        : 'bg-[var(--bg-secondary)] text-[var(--text-primary)] ring-1 ring-[var(--border-color)]'
                    ].join(' ')}
                  >
                    {m.content || (m.streaming ? '...' : '')}
                  </div>
                </div>
              ))}
              <div ref={endRef} />
            </div>
          )}
        </div>

        {error ? <div className="mb-2 text-sm text-[var(--danger-color)]">{error}</div> : null}

        <div className="sticky bottom-0 pb-4">
          <div className="rounded-2xl border border-[var(--border-color)] bg-[var(--bg-secondary)] p-3 shadow-xl">
            <div className="flex items-end gap-2">
              <textarea
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault()
                    void send()
                  }
                }}
                placeholder={mode === 'polish' ? '输入要润色的提示词…（会参考选中节点的链路与提示词库）' : '输入消息…（Enter 发送，Shift+Enter 换行）'}
                className="min-h-[52px] w-full flex-1 resize-none rounded-xl border border-[var(--border-color)] bg-[var(--bg-primary)] px-3 py-3 text-sm text-[var(--text-primary)] outline-none placeholder:text-[var(--text-secondary)] focus:ring-2 focus:ring-[rgb(var(--accent-rgb)/0.35)]"
              />
              {busy ? (
                <Button variant="secondary" onClick={() => stop()}>
                  停止
                </Button>
              ) : (
                <Button onClick={() => void send()} disabled={!input.trim()}>
                  发送
                </Button>
              )}
            </div>
            <div className="mt-2 text-xs text-[var(--text-secondary)]">
              提示：用「记住：...」可以把偏好写入长期记忆（本地存储）。
            </div>
          </div>
        </div>
      </div>

      <SettingsDialog open={settingsOpen} onClose={() => setSettingsOpen(false)} />
    </div>
  )
}
