/**
 * Chat Hook | 对话 Hook (React + TypeScript)
 * 封装聊天逻辑，支持流式响应、消息历史管理、上下文构建
 */

import { useState, useCallback, useRef } from 'react'
import { streamChatCompletions, streamResponses, createResponse, extractTextFromResponses } from '@/api'

// ==================== Types ====================

export type MessageRole = 'user' | 'assistant' | 'system'

export interface ChatMessage {
  id: string
  role: MessageRole
  content: string
  createdAt: number
  streaming?: boolean
  metadata?: Record<string, unknown>
}

export interface ChatOptions {
  model?: string
  systemPrompt?: string
  maxHistory?: number
  buildMessages?: (params: {
    content: string
    messages: ChatMessage[]
    systemPrompt: string
  }) => Promise<Array<{ role: string; content: string }>> | Array<{ role: string; content: string }>
  getRequestExtras?: () => Record<string, unknown>
  requestExtras?: Record<string, unknown>
  onStreamChunk?: (chunk: string, fullText: string) => void
  onMessageComplete?: (message: ChatMessage) => void
  onError?: (error: Error) => void
}

export type ChatStatus = 'idle' | 'loading' | 'streaming' | 'success' | 'error'

// ==================== Constants ====================

const DEFAULT_CHAT_MODEL = 'gpt-5-mini'
const MAX_HISTORY = 100

// ==================== Utilities ====================

const makeId = (): string => {
  const uuid = globalThis.crypto?.randomUUID?.()
  return uuid || `msg_${Date.now()}_${Math.random().toString(16).slice(2)}`
}

// ==================== Main Hook ====================

export function useChat(options: ChatOptions = {}) {
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [currentResponse, setCurrentResponse] = useState('')
  const [status, setStatus] = useState<ChatStatus>('idle')
  const [error, setError] = useState<Error | null>(null)

  const abortControllerRef = useRef<AbortController | null>(null)
  const optionsRef = useRef(options)
  optionsRef.current = options

  const isLoading = status === 'loading' || status === 'streaming'

  /**
   * Append a message to the conversation
   */
  const append = useCallback(
    (role: MessageRole, content: string, extra: Partial<ChatMessage> = {}): string => {
      const item: ChatMessage = {
        id: makeId(),
        role,
        content: typeof content === 'string' ? content : String(content || ''),
        createdAt: Date.now(),
        ...extra,
      }

      setMessages((prev) => {
        const maxHistory = optionsRef.current.maxHistory || MAX_HISTORY
        const next = [...prev, item]
        return next.slice(-maxHistory)
      })

      return item.id
    },
    []
  )

  /**
   * Update a specific message by ID
   */
  const updateMessage = useCallback((id: string, patch: Partial<ChatMessage>) => {
    setMessages((prev) => {
      const idx = prev.findIndex((m) => m.id === id)
      if (idx === -1) return prev
      const next = prev.slice()
      next[idx] = { ...next[idx], ...patch }
      return next
    })
  }, [])

  /**
   * Remove a message by ID
   */
  const removeMessage = useCallback((id: string) => {
    setMessages((prev) => prev.filter((m) => m.id !== id))
  }, [])

  /**
   * Clear all messages
   */
  const clear = useCallback(() => {
    abortControllerRef.current?.abort()
    abortControllerRef.current = null
    setMessages([])
    setCurrentResponse('')
    setStatus('idle')
    setError(null)
  }, [])

  /**
   * Stop current streaming
   */
  const stop = useCallback(() => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort()
      abortControllerRef.current = null
    }
    setStatus((s) => (s === 'streaming' ? 'idle' : s))
  }, [])

  /**
   * Resolve request extras from options
   */
  const resolveExtras = useCallback(
    (override: Record<string, unknown> = {}): Record<string, unknown> => {
      const opts = optionsRef.current
      const base =
        typeof opts.getRequestExtras === 'function'
          ? opts.getRequestExtras()
          : opts.requestExtras || {}
      const merged = { ...(base || {}), ...(override || {}) }
      return Object.fromEntries(
        Object.entries(merged).filter(([, v]) => v !== undefined)
      )
    },
    []
  )

  /**
   * Build message list for API request
   */
  const buildMessageList = useCallback(
    async (content: string): Promise<Array<{ role: string; content: string }>> => {
      const opts = optionsRef.current
      const baseList = messages

      if (typeof opts.buildMessages === 'function') {
        const built = await opts.buildMessages({
          content,
          messages: baseList,
          systemPrompt: opts.systemPrompt || '',
        })
        if (Array.isArray(built) && built.length > 0) return built
      }

      const result: Array<{ role: string; content: string }> = []

      if (opts.systemPrompt) {
        result.push({ role: 'system', content: opts.systemPrompt })
      }

      for (const m of baseList) {
        if (m.role === 'system') continue
        result.push({ role: m.role, content: m.content })
      }

      result.push({ role: 'user', content })

      return result
    },
    [messages]
  )

  /**
   * Send a message and get response
   */
  const send = useCallback(
    async (
      content: string,
      stream = true,
      requestOverrides: Record<string, unknown> = {}
    ): Promise<string> => {
      const opts = optionsRef.current
      const trimmedContent = content.trim()
      if (!trimmedContent) return ''

      setStatus('loading')
      setError(null)
      setCurrentResponse('')

      // Abort any existing request
      abortControllerRef.current?.abort()
      abortControllerRef.current = new AbortController()

      try {
        const modelKey = opts.model || DEFAULT_CHAT_MODEL
        const msgList = await buildMessageList(trimmedContent)

        // Append user message
        append('user', trimmedContent)

        if (stream) {
          setStatus('streaming')
          let fullResponse = ''
          const assistantId = append('assistant', '', { streaming: true })

          const extras = resolveExtras(requestOverrides)
          const payload =
            Object.keys(extras).length > 0
              ? { model: modelKey, messages: msgList, ...extras }
              : { model: modelKey, messages: msgList }

          // Try Responses API first, fall back to Chat Completions
          const useResponsesApi = modelKey.includes('gpt-5') || modelKey.includes('o1')

          if (useResponsesApi) {
            for await (const chunk of streamResponses(
              { model: modelKey, input: msgList },
              abortControllerRef.current.signal
            )) {
              fullResponse += chunk
              setCurrentResponse(fullResponse)
              updateMessage(assistantId, { content: fullResponse })
              opts.onStreamChunk?.(chunk, fullResponse)
            }
          } else {
            for await (const chunk of streamChatCompletions(
              payload,
              abortControllerRef.current.signal
            )) {
              fullResponse += chunk
              setCurrentResponse(fullResponse)
              updateMessage(assistantId, { content: fullResponse })
              opts.onStreamChunk?.(chunk, fullResponse)
            }
          }

          // Mark streaming complete
          updateMessage(assistantId, { content: fullResponse, streaming: false })
          setStatus('success')

          const finalMessage: ChatMessage = {
            id: assistantId,
            role: 'assistant',
            content: fullResponse,
            createdAt: Date.now(),
            streaming: false,
          }
          opts.onMessageComplete?.(finalMessage)

          return fullResponse
        }

        // Non-streaming request
        const resp = await createResponse({ model: modelKey, input: msgList })
        const text = extractTextFromResponses(resp)
        append('assistant', text)
        setCurrentResponse(text)
        setStatus('success')

        const finalMessage: ChatMessage = {
          id: makeId(),
          role: 'assistant',
          content: text,
          createdAt: Date.now(),
        }
        opts.onMessageComplete?.(finalMessage)

        return text
      } catch (err: any) {
        if (err?.name === 'AbortError') {
          setStatus('idle')
          return ''
        }

        const error = err instanceof Error ? err : new Error(String(err))
        setError(error)
        setStatus('error')
        opts.onError?.(error)

        throw error
      } finally {
        abortControllerRef.current = null
      }
    },
    [append, buildMessageList, resolveExtras, updateMessage]
  )

  /**
   * Regenerate last assistant response
   */
  const regenerate = useCallback(async (): Promise<string> => {
    // Find last user message
    const lastUserIdx = messages.findLastIndex((m) => m.role === 'user')
    if (lastUserIdx === -1) return ''

    const lastUserMessage = messages[lastUserIdx]

    // Remove all messages after the last user message
    setMessages((prev) => prev.slice(0, lastUserIdx))

    // Re-send the last user message
    return send(lastUserMessage.content)
  }, [messages, send])

  /**
   * Edit a user message and regenerate
   */
  const edit = useCallback(
    async (messageId: string, newContent: string): Promise<string> => {
      const idx = messages.findIndex((m) => m.id === messageId)
      if (idx === -1) return ''

      // Keep messages up to but not including this one
      setMessages((prev) => prev.slice(0, idx))

      // Send with new content
      return send(newContent)
    },
    [messages, send]
  )

  /**
   * Set messages directly (for loading from storage)
   */
  const setMessagesDirectly = useCallback((msgs: ChatMessage[]) => {
    setMessages(msgs)
  }, [])

  /**
   * Get messages for API context (excludes streaming flag)
   */
  const getApiMessages = useCallback((): Array<{ role: string; content: string }> => {
    return messages
      .filter((m) => m.role !== 'system' && m.content.trim())
      .map((m) => ({ role: m.role, content: m.content }))
  }, [messages])

  return {
    // State
    messages,
    currentResponse,
    status,
    error,
    isLoading,

    // Actions
    send,
    stop,
    clear,
    append,
    updateMessage,
    removeMessage,
    regenerate,
    edit,
    setMessages: setMessagesDirectly,
    getApiMessages,
  }
}

export default useChat
