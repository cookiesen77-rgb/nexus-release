/**
 * Clarification Dialog | 澄清对话框组件
 * 当 AI 分析返回 needs_clarification: true 时弹出，收集用户补充信息
 */

import React, { useState, useCallback } from 'react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { X, HelpCircle, ChevronRight } from 'lucide-react'
import type { ClarificationQuestion, IntentResult } from '@/hooks/useWorkflowOrchestrator'

interface Props {
  open: boolean
  onClose: () => void
  onSubmit: (answers: Record<string, string>, enhancedInput: string) => void
  onSkip: () => void
  result: IntentResult | null
  originalInput: string
}

export default function ClarificationDialog({
  open,
  onClose,
  onSubmit,
  onSkip,
  result,
  originalInput
}: Props) {
  const [answers, setAnswers] = useState<Record<string, string>>({})
  const [customInputs, setCustomInputs] = useState<Record<string, string>>({})

  const questions = result?.clarification_questions || []
  const context = result?.clarification_context || '请补充以下信息以获得更好的结果'

  const handleOptionSelect = useCallback((key: string, option: string) => {
    setAnswers((prev) => ({ ...prev, [key]: option }))
  }, [])

  const handleCustomInput = useCallback((key: string, value: string) => {
    setCustomInputs((prev) => ({ ...prev, [key]: value }))
  }, [])

  const handleSubmit = useCallback(() => {
    // Build enhanced input with clarification answers
    const answersText = questions
      .map((q) => {
        const answer = answers[q.key]
        if (!answer) return null
        const custom = customInputs[`${q.key}_custom`]
        const finalAnswer = String(answer).includes('其他') && custom ? custom : answer
        return `${q.question}: ${finalAnswer}`
      })
      .filter(Boolean)
      .join('\n')

    const enhancedInput = answersText
      ? `${originalInput}\n\n【补充信息】\n${answersText}`
      : originalInput

    onSubmit(answers, enhancedInput)
    
    // Reset state
    setAnswers({})
    setCustomInputs({})
  }, [answers, customInputs, questions, originalInput, onSubmit])

  const handleSkip = useCallback(() => {
    onSkip()
    setAnswers({})
    setCustomInputs({})
  }, [onSkip])

  const handleClose = useCallback(() => {
    onClose()
    setAnswers({})
    setCustomInputs({})
  }, [onClose])

  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
      <div className="mx-4 w-full max-w-lg rounded-2xl border border-[var(--border-color)] bg-[var(--bg-secondary)] shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-[var(--border-color)] px-5 py-4">
          <div className="flex items-center gap-2">
            <HelpCircle className="h-5 w-5 text-[var(--accent-color)]" />
            <span className="font-semibold text-[var(--text-primary)]">需要补充信息</span>
          </div>
          <button
            onClick={handleClose}
            className="rounded-full p-1 text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-primary)] hover:text-[var(--text-primary)]"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Content */}
        <div className="max-h-[60vh] overflow-y-auto p-5">
          {/* Context message */}
          <p className="mb-4 text-sm text-[var(--text-secondary)]">{context}</p>

          {/* Questions */}
          <div className="space-y-5">
            {questions.map((q, idx) => (
              <div key={q.key || idx} className="space-y-2">
                <label className="block text-sm font-medium text-[var(--text-primary)]">
                  {idx + 1}. {q.question}
                </label>

                {/* Options (if available) */}
                {q.options && q.options.length > 0 ? (
                  <div className="flex flex-wrap gap-2">
                    {q.options.map((option) => {
                      const isSelected = answers[q.key] === option
                      const isOther = option.includes('其他')
                      
                      return (
                        <button
                          key={option}
                          onClick={() => handleOptionSelect(q.key, option)}
                          className={cn(
                            'rounded-full border px-3 py-1.5 text-sm transition-all',
                            isSelected
                              ? 'border-[var(--accent-color)] bg-[rgb(var(--accent-rgb)/0.12)] text-[var(--accent-color)]'
                              : 'border-[var(--border-color)] bg-[var(--bg-primary)] text-[var(--text-secondary)] hover:border-[var(--accent-color)] hover:text-[var(--text-primary)]'
                          )}
                        >
                          {option}
                        </button>
                      )
                    })}
                  </div>
                ) : null}

                {/* Custom input for "其他" option or text-only questions */}
                {(!q.options || q.options.length === 0 || answers[q.key]?.includes('其他')) && (
                  <input
                    type="text"
                    value={
                      q.options && q.options.length > 0
                        ? customInputs[`${q.key}_custom`] || ''
                        : answers[q.key] || ''
                    }
                    onChange={(e) => {
                      if (q.options && q.options.length > 0) {
                        handleCustomInput(`${q.key}_custom`, e.target.value)
                      } else {
                        handleOptionSelect(q.key, e.target.value)
                      }
                    }}
                    placeholder={
                      q.options && q.options.length > 0
                        ? '请输入自定义内容...'
                        : '请输入...'
                    }
                    className="w-full rounded-xl border border-[var(--border-color)] bg-[var(--bg-primary)] px-3 py-2 text-sm text-[var(--text-primary)] outline-none placeholder:text-[var(--text-secondary)] focus:border-[var(--accent-color)] focus:ring-2 focus:ring-[rgb(var(--accent-rgb)/0.2)]"
                  />
                )}
              </div>
            ))}
          </div>

          {/* Original input preview */}
          <div className="mt-5 rounded-xl border border-[var(--border-color)] bg-[var(--bg-primary)] p-3">
            <div className="mb-1 text-xs font-medium text-[var(--text-secondary)]">原始需求</div>
            <div className="text-sm text-[var(--text-primary)]">{originalInput}</div>
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between border-t border-[var(--border-color)] px-5 py-4">
          <Button variant="ghost" onClick={handleSkip}>
            跳过，直接执行
          </Button>
          <div className="flex items-center gap-2">
            <Button variant="secondary" onClick={handleClose}>
              取消
            </Button>
            <Button onClick={handleSubmit}>
              <span>确认</span>
              <ChevronRight className="ml-1 h-4 w-4" />
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}
