/**
 * Image Edit Modal | 图片编辑输入弹窗
 * 用于获取用户输入（姿态、角度、抠图对象等）
 */

import React, { memo, useState, useCallback, useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { X, Check } from 'lucide-react'
import { Button } from '@/components/ui/button'

interface Props {
  open: boolean
  title: string
  placeholder: string
  onConfirm: (input: string) => void
  onClose: () => void
}

export default memo(function ImageEditModal({ open, title, placeholder, onConfirm, onClose }: Props) {
  const [value, setValue] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  // 打开时聚焦输入框
  useEffect(() => {
    if (open) {
      setValue('')
      setTimeout(() => {
        inputRef.current?.focus()
      }, 100)
    }
  }, [open])

  const handleConfirm = useCallback(() => {
    if (!value.trim()) {
      window.$message?.warning?.('请输入内容')
      return
    }
    onConfirm(value.trim())
  }, [value, onConfirm])

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleConfirm()
    }
    if (e.key === 'Escape') {
      onClose()
    }
  }, [handleConfirm, onClose])

  if (!open) return null

  return createPortal(
    <div
      className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/50"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div
        className="w-[400px] rounded-xl border border-[var(--border-color)] bg-[var(--bg-secondary)] shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-[var(--border-color)] px-4 py-3">
          <h3 className="text-base font-semibold text-[var(--text-primary)]">{title}</h3>
          <button
            onClick={onClose}
            className="rounded-full p-1 text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-tertiary)] hover:text-[var(--text-primary)]"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Content */}
        <div className="p-4">
          <input
            ref={inputRef}
            type="text"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={placeholder}
            className="w-full rounded-lg border border-[var(--border-color)] bg-[var(--bg-primary)] px-3 py-2.5 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-secondary)] focus:border-[var(--accent-color)] focus:outline-none focus:ring-1 focus:ring-[var(--accent-color)]"
          />
          <p className="mt-2 text-xs text-[var(--text-secondary)]">
            AI 会自动优化提示词，保持人物和场景的一致性
          </p>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 border-t border-[var(--border-color)] px-4 py-3">
          <Button variant="ghost" onClick={onClose}>
            取消
          </Button>
          <Button onClick={handleConfirm}>
            <Check className="mr-1.5 h-4 w-4" />
            确认
          </Button>
        </div>
      </div>
    </div>,
    document.body
  )
})
