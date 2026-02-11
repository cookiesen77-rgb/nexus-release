import React, { memo, useRef, useState, useCallback, useEffect } from 'react'
import { Loader2 } from 'lucide-react'
import { callAiAssistant } from '@/lib/nexusApi'
import {
  inferPolishModeFromText,
  buildPolishUserText,
  buildPolishSystemPrompt,
} from '@/lib/polish'
import { AssetMentionPopover } from './AssetMentionPopover'

interface PromptInputProps {
  value: string
  onChange: (v: string) => void
  onSubmit: () => void
  placeholder?: string
  disabled?: boolean
  onRefImageAdd?: (url: string) => void
  maxRefImages?: number
  currentRefCount?: number
}

export const PromptInput = memo(function PromptInput({
  value, onChange, onSubmit, placeholder, disabled,
  onRefImageAdd, maxRefImages = 0, currentRefCount = 0,
}: PromptInputProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const [polishing, setPolishing] = useState(false)
  const [mentionOpen, setMentionOpen] = useState(false)
  const [mentionQuery, setMentionQuery] = useState('')
  const [mentionPos, setMentionPos] = useState({ top: 0, left: 0 })
  const mentionStartRef = useRef(-1)

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Escape' && mentionOpen) {
      e.stopPropagation()
      setMentionOpen(false)
      return
    }
    if (e.key === 'Enter' && !e.shiftKey && !mentionOpen) {
      e.preventDefault()
      e.stopPropagation()
      if (!disabled && value.trim()) onSubmit()
    }
  }, [disabled, value, onSubmit, mentionOpen])

  const handleChange = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const newVal = e.target.value
    const cursor = e.target.selectionStart
    onChange(newVal)

    // Detect @ trigger
    if (cursor > 0 && newVal[cursor - 1] === '@' && (cursor === 1 || /\s/.test(newVal[cursor - 2]))) {
      mentionStartRef.current = cursor - 1
      setMentionQuery('')
      const el = textareaRef.current
      if (el) {
        const rect = el.getBoundingClientRect()
        setMentionPos({ top: rect.bottom + 4, left: rect.left })
      }
      setMentionOpen(true)
    } else if (mentionOpen && mentionStartRef.current >= 0) {
      const q = newVal.slice(mentionStartRef.current + 1, cursor)
      if (q.includes(' ') || q.includes('\n') || cursor <= mentionStartRef.current) {
        setMentionOpen(false)
        mentionStartRef.current = -1
      } else {
        setMentionQuery(q)
      }
    }
  }, [onChange, mentionOpen])

  const handleMentionSelect = useCallback((url: string) => {
    if (maxRefImages > 0 && currentRefCount >= maxRefImages) {
      window.$message?.warning?.(`当前模型最多支持 ${maxRefImages} 张参考图`)
      setMentionOpen(false)
      return
    }

    // Remove @query from text
    if (mentionStartRef.current >= 0) {
      const el = textareaRef.current
      const cursor = el?.selectionStart ?? value.length
      const before = value.slice(0, mentionStartRef.current)
      const after = value.slice(cursor)
      onChange(before + after)
    }

    onRefImageAdd?.(url)
    setMentionOpen(false)
    mentionStartRef.current = -1
    textareaRef.current?.focus()
  }, [value, onChange, onRefImageAdd, maxRefImages, currentRefCount])

  const handlePolish = useCallback(async (e: React.MouseEvent) => {
    e.stopPropagation()
    if (!value.trim() || polishing) return
    setPolishing(true)
    try {
      const aiModel = 'gemini-3-pro-preview-thinking'
      const mode = inferPolishModeFromText(value)
      const userText = buildPolishUserText({ mode, userText: value, promptTemplate: null, upstreamInputs: { text: [], images: [] } })
      const systemPrompt = buildPolishSystemPrompt(mode)
      const polished = await callAiAssistant(
        aiModel,
        [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userText },
        ],
        { filterThinking: true }
      )
      if (polished) {
        onChange(polished)
        window.$message?.success?.('润色完成')
      }
    } catch (err: any) {
      window.$message?.error?.(`润色失败: ${err?.message || '未知错误'}`)
    } finally {
      setPolishing(false)
    }
  }, [value, polishing, onChange])

  useEffect(() => {
    const el = textareaRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = Math.min(el.scrollHeight, 120) + 'px'
  }, [value])

  return (
    <div className="relative" onClick={e => e.stopPropagation()}>
      <textarea
        ref={textareaRef}
        value={value}
        onChange={handleChange}
        onKeyDown={handleKeyDown}
        placeholder={placeholder || '输入描述，@ 添加参考图，Enter 发送'}
        disabled={disabled}
        rows={2}
        className="w-full resize-none rounded-lg border border-[var(--border-color)] bg-[var(--bg-tertiary)] px-3 py-2 pr-20 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-secondary)] placeholder:opacity-50 focus:outline-none focus:ring-1 focus:ring-[var(--accent-color)] disabled:opacity-50"
        style={{ minHeight: 48, maxHeight: 120 }}
      />
      <button
        onClick={handlePolish}
        disabled={!value.trim() || polishing || disabled}
        className="absolute bottom-2 right-2 px-2 py-0.5 text-xs rounded bg-[var(--bg-secondary)] hover:bg-[var(--accent-color)] hover:text-white border border-[var(--border-color)] transition-colors disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-1"
        title="AI 润色"
      >
        {polishing ? (
          <Loader2 size={10} className="animate-spin" />
        ) : (
          <span>✨ AI润色</span>
        )}
      </button>

      {mentionOpen && (
        <AssetMentionPopover
          query={mentionQuery}
          onSelect={handleMentionSelect}
          onClose={() => { setMentionOpen(false); mentionStartRef.current = -1 }}
          position={mentionPos}
        />
      )}
    </div>
  )
})
