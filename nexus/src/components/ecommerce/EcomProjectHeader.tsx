import React, { useState, useCallback, useRef, useEffect } from 'react'
import { ShoppingBag, Plus, Copy, Trash2, ChevronDown, X, Pencil, Check } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import type { EcomDraftV1 } from '@/lib/ecommerce/types'
import type { EcomProjectMeta } from '@/lib/ecommerce/draftStorage'

interface Props {
  draft: EcomDraftV1
  setDraftSafe: (fn: React.SetStateAction<EcomDraftV1>) => void
  currentProjectId: string
  projects: EcomProjectMeta[]
  onCreateProject: () => void
  onDeleteProject: (id: string) => void
  onDuplicateProject: (id: string) => void
  onSwitchProject: (id: string) => void
  onRequestClose?: () => void
}

export default function EcomProjectHeader({
  draft, setDraftSafe, currentProjectId, projects,
  onCreateProject, onDeleteProject, onDuplicateProject, onSwitchProject, onRequestClose,
}: Props) {
  const [editingTitle, setEditingTitle] = useState(false)
  const [titleInput, setTitleInput] = useState(draft.title)
  const [dropdownOpen, setDropdownOpen] = useState(false)
  const dropdownRef = useRef<HTMLDivElement>(null)

  useEffect(() => { setTitleInput(draft.title) }, [draft.title])

  useEffect(() => {
    if (!dropdownOpen) return
    const handler = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) setDropdownOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [dropdownOpen])

  const commitTitle = useCallback(() => {
    setDraftSafe(prev => ({ ...prev, title: titleInput.trim() || '新电商项目' }))
    setEditingTitle(false)
  }, [titleInput, setDraftSafe])

  return (
    <div className="flex h-12 flex-shrink-0 items-center justify-between border-b border-[var(--border-color)] px-4">
      <div className="flex items-center gap-3">
        <ShoppingBag className="h-5 w-5 text-orange-500" />

        {editingTitle ? (
          <div className="flex items-center gap-1">
            <input
              value={titleInput}
              onChange={e => setTitleInput(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') commitTitle() }}
              className="rounded border border-[var(--accent-color)] bg-[var(--bg-primary)] px-2 py-0.5 text-sm font-bold focus:outline-none"
              autoFocus
            />
            <button onClick={commitTitle}><Check className="h-3.5 w-3.5 text-green-500" /></button>
            <button onClick={() => { setTitleInput(draft.title); setEditingTitle(false) }}><X className="h-3.5 w-3.5 text-[var(--text-secondary)]" /></button>
          </div>
        ) : (
          <button
            onClick={() => { setTitleInput(draft.title); setEditingTitle(true) }}
            className="flex items-center gap-1 text-sm font-bold hover:text-[var(--accent-color)]"
          >
            电商工具台
            <Pencil className="h-3 w-3 opacity-40" />
          </button>
        )}

        {/* Project switcher */}
        <div className="relative" ref={dropdownRef}>
          <button
            onClick={() => setDropdownOpen(!dropdownOpen)}
            className="flex items-center gap-1 rounded-lg border border-[var(--border-color)] px-3 py-1 text-xs hover:bg-[var(--bg-secondary)]"
          >
            {projects.find(p => p.id === currentProjectId)?.title || draft.title || '新项目'}
            <ChevronDown className="h-3 w-3" />
          </button>
          {dropdownOpen && (
            <div className="absolute left-0 top-full z-50 mt-1 w-64 rounded-lg border border-[var(--border-color)] bg-[var(--bg-secondary)] p-2 shadow-xl">
              <Button size="sm" className="mb-2 w-full gap-1" onClick={() => { onCreateProject(); setDropdownOpen(false) }}>
                <Plus className="h-3 w-3" /> 新建项目
              </Button>
              {projects.map(p => (
                <div
                  key={p.id}
                  className={cn(
                    'flex items-center justify-between rounded-lg px-2 py-1.5 text-xs hover:bg-[var(--bg-tertiary)]',
                    p.id === currentProjectId && 'bg-[var(--accent-color)]/10'
                  )}
                >
                  <button className="flex-1 truncate text-left" onClick={() => { onSwitchProject(p.id); setDropdownOpen(false) }}>
                    {p.title} {p.productName ? `· ${p.productName}` : ''}
                  </button>
                  <div className="flex gap-1">
                    <button onClick={() => onDuplicateProject(p.id)} title="复制"><Copy className="h-3 w-3" /></button>
                    <button onClick={() => onDeleteProject(p.id)} title="删除" className="text-red-500"><Trash2 className="h-3 w-3" /></button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {draft.product.name && (
          <span className="text-xs text-[var(--text-secondary)]">商品: {draft.product.name}</span>
        )}
      </div>

      <button
        onClick={onRequestClose}
        className="flex items-center gap-1 rounded-lg border border-[var(--border-color)] px-3 py-1.5 text-xs hover:bg-[var(--bg-secondary)]"
      >
        返回画布
      </button>
    </div>
  )
}
