import React, { useState, useRef, useCallback, useEffect } from 'react'
import { Paperclip, Send, Loader2, X, Sparkles } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import type { EcomDraftV1, EcomSceneType, EcomChatMessage } from '@/lib/ecommerce/types'
import { buildEcomSystemPrompt, compactChatHistory, buildMultimodalMessage } from '@/lib/ecommerce/ecomChat'
import { streamChatCompletions } from '@/api'
import { useSettingsStore } from '@/store/settings'

interface Props {
  draft: EcomDraftV1
  setDraftSafe: (fn: React.SetStateAction<EcomDraftV1>) => void
  activeScene: EcomSceneType
  onOpenMediaPicker?: (opts: { kinds: string[]; multiple?: boolean; onConfirm: (items: any[]) => void }) => void
}

const SCENE_PROMPT_PATH: Record<EcomSceneType, (d: EcomDraftV1) => string> = {
  hero: d => d.heroScene.prompt,
  detail_page: d => d.detailPageScene.consistencyPrompt,
  try_on: d => d.tryOnScenes[0]?.prompt ?? '',
  poster: d => d.posterScenes[0]?.prompt ?? '',
  video: d => d.videoScenes[0]?.prompt ?? '',
  batch: d => d.batchScene.promptTemplate,
  motion_control: d => d.motionControlScenes[0]?.prompt ?? '',
  multi_elements: d => d.multiElementsScenes[0]?.prompt ?? '',
}

function applyPromptToScene(prev: EcomDraftV1, scene: EcomSceneType, text: string): EcomDraftV1 {
  switch (scene) {
    case 'hero': return { ...prev, heroScene: { ...prev.heroScene, prompt: text } }
    case 'detail_page': return { ...prev, detailPageScene: { ...prev.detailPageScene, consistencyPrompt: text } }
    case 'try_on': {
      if (!prev.tryOnScenes.length) return prev
      const s = [...prev.tryOnScenes]; s[0] = { ...s[0], prompt: text }; return { ...prev, tryOnScenes: s }
    }
    case 'poster': {
      if (!prev.posterScenes.length) return prev
      const s = [...prev.posterScenes]; s[0] = { ...s[0], prompt: text }; return { ...prev, posterScenes: s }
    }
    case 'video': {
      if (!prev.videoScenes.length) return prev
      const s = [...prev.videoScenes]; s[0] = { ...s[0], prompt: text }; return { ...prev, videoScenes: s }
    }
    case 'batch': return { ...prev, batchScene: { ...prev.batchScene, promptTemplate: text } }
    case 'motion_control': {
      if (!prev.motionControlScenes.length) return prev
      const s = [...prev.motionControlScenes]; s[0] = { ...s[0], prompt: text }; return { ...prev, motionControlScenes: s }
    }
    case 'multi_elements': {
      if (!prev.multiElementsScenes.length) return prev
      const s = [...prev.multiElementsScenes]; s[0] = { ...s[0], prompt: text }; return { ...prev, multiElementsScenes: s }
    }
    default: return prev
  }
}

function textContent(msg: EcomChatMessage): string {
  if (typeof msg.content === 'string') return msg.content
  return msg.content.filter(p => p.type === 'text').map(p => (p as { text: string }).text).join('\n')
}

export default function EcomChatPanel({ draft, setDraftSafe, activeScene, onOpenMediaPicker }: Props) {
  const [input, setInput] = useState('')
  const [pendingImages, setPendingImages] = useState<string[]>([])
  const [streaming, setStreaming] = useState(false)
  const scrollRef = useRef<HTMLDivElement>(null)

  const messages = draft.chatHistory

  useEffect(() => {
    const el = scrollRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [messages])

  const handleAttach = useCallback(() => {
    onOpenMediaPicker?.({
      kinds: ['image'],
      multiple: true,
      onConfirm: (items) => {
        const urls = items.map((it: any) => String(it.displayUrl || it.sourceUrl || '')).filter(Boolean)
        setPendingImages(prev => [...prev, ...urls])
      },
    })
  }, [onOpenMediaPicker])

  const handleSend = useCallback(async () => {
    const text = input.trim()
    if (!text && pendingImages.length === 0) return
    if (streaming) return

    setInput('')
    const images = [...pendingImages]
    setPendingImages([])

    const userMsg: EcomChatMessage = images.length > 0
      ? buildMultimodalMessage(text || '请分析这些图片', images)
      : { role: 'user', content: text, timestamp: Date.now() }

    setDraftSafe(prev => ({ ...prev, chatHistory: [...prev.chatHistory, userMsg] }))
    setStreaming(true)

    const assistantMsg: EcomChatMessage = { role: 'assistant', content: '', timestamp: Date.now() }
    setDraftSafe(prev => ({ ...prev, chatHistory: [...prev.chatHistory, assistantMsg] }))

    const aiModel = useSettingsStore.getState().aiAssistantModel || 'gpt-4o'
    const systemPrompt = buildEcomSystemPrompt(draft, activeScene)
    const history = compactChatHistory([...draft.chatHistory, userMsg])
    const apiMessages = [{ role: 'system' as const, content: systemPrompt }, ...history]

    let fullResp = ''
    try {
      for await (const chunk of streamChatCompletions({ model: aiModel, messages: apiMessages })) {
        fullResp += chunk
        setDraftSafe(prev => {
          const h = [...prev.chatHistory]
          h[h.length - 1] = { ...h[h.length - 1], content: fullResp }
          return { ...prev, chatHistory: h }
        })
      }
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : '对话失败'
      setDraftSafe(prev => {
        const h = [...prev.chatHistory]
        h[h.length - 1] = { ...h[h.length - 1], content: `错误：${errMsg}` }
        return { ...prev, chatHistory: h }
      })
    } finally {
      setStreaming(false)
    }
  }, [input, pendingImages, streaming, draft, activeScene, setDraftSafe])

  const handleApplyPrompt = useCallback((text: string) => {
    setDraftSafe(prev => applyPromptToScene(prev, activeScene, text))
    window.$message?.success?.('已应用到当前场景')
  }, [activeScene, setDraftSafe])

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="flex-shrink-0 border-b border-[var(--border-color)] p-3">
        <div className="text-sm font-semibold text-[var(--text-primary)]">AI 微调助手</div>
        <div className="mt-0.5 text-[11px] text-[var(--text-secondary)]">支持上传参考图，AI分析并优化提示词</div>
      </div>

      {/* Messages */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto p-3 space-y-3">
        {messages.length === 0 && (
          <div className="flex flex-col items-center gap-2 py-10 text-center text-xs text-[var(--text-secondary)] opacity-50">
            <Sparkles className="h-6 w-6" />
            <div>上传商品图片让AI分析</div>
            <div>描述你想要的效果</div>
            <div>"帮我优化这张主图的光影"</div>
          </div>
        )}
        {messages.filter(m => m.role !== 'system').map((msg, i) => {
          const isUser = msg.role === 'user'
          const text = textContent(msg)
          return (
            <div key={i} className={cn('max-w-[88%]', isUser ? 'ml-auto' : 'mr-auto')}>
              {isUser && msg.images && msg.images.length > 0 && (
                <div className={cn('mb-1 flex flex-wrap gap-1', isUser ? 'justify-end' : 'justify-start')}>
                  {msg.images.map((url, j) => (
                    <img key={j} src={url} className="h-14 w-14 rounded-lg object-cover" alt="" />
                  ))}
                </div>
              )}
              {isUser && typeof msg.content !== 'string' && (
                <div className="mb-1 flex flex-wrap gap-1 justify-end">
                  {(msg.content as any[]).filter((p: any) => p.type === 'image_url').map((p: any, j: number) => (
                    <img key={j} src={p.image_url.url} className="h-14 w-14 rounded-lg object-cover" alt="" />
                  ))}
                </div>
              )}
              <div className={cn(
                'rounded-lg px-3 py-2 text-xs',
                isUser
                  ? 'bg-[var(--accent-color)] text-white'
                  : 'bg-[var(--bg-secondary)] text-[var(--text-primary)]'
              )}>
                <pre className="whitespace-pre-wrap font-sans">{text || (streaming && i === messages.length - 1 ? '思考中...' : '')}</pre>
              </div>
              {!isUser && text && !streaming && (
                <button
                  onClick={() => handleApplyPrompt(text)}
                  className="mt-1 rounded bg-[var(--accent-color)]/10 px-2 py-0.5 text-[10px] text-[var(--accent-color)] hover:bg-[var(--accent-color)]/20"
                >
                  应用到当前场景
                </button>
              )}
            </div>
          )
        })}
      </div>

      {/* Input area */}
      <div className="flex-shrink-0 border-t border-[var(--border-color)] p-3 space-y-2">
        {pendingImages.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {pendingImages.map((url, i) => (
              <div key={i} className="group relative">
                <img src={url} className="h-12 w-12 rounded-lg object-cover" alt="" />
                <button
                  onClick={() => setPendingImages(prev => prev.filter((_, idx) => idx !== i))}
                  className="absolute -right-1 -top-1 hidden group-hover:flex h-4 w-4 items-center justify-center rounded-full bg-red-500 text-white"
                >
                  <X className="h-2.5 w-2.5" />
                </button>
              </div>
            ))}
          </div>
        )}
        <div className="flex gap-2">
          <button
            onClick={handleAttach}
            className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg border border-[var(--border-color)] text-[var(--text-secondary)] hover:bg-[var(--bg-secondary)]"
            title="附加图片"
          >
            <Paperclip className="h-4 w-4" />
          </button>
          <input
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend() } }}
            placeholder="描述你想要的修改..."
            disabled={streaming}
            className="flex-1 rounded-lg border border-[var(--border-color)] bg-[var(--bg-primary)] px-2 py-1.5 text-xs focus:border-[var(--accent-color)] focus:outline-none disabled:opacity-50"
          />
          <Button size="sm" onClick={handleSend} disabled={streaming || (!input.trim() && pendingImages.length === 0)}>
            {streaming ? <Loader2 className="h-3 w-3 animate-spin" /> : <Send className="h-3 w-3" />}
          </Button>
        </div>
      </div>
    </div>
  )
}
