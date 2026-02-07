import React from 'react'
import { MessageSquare } from 'lucide-react'
import CanvasAssistantPanel from '@/components/canvas/CanvasAssistantPanel'

type Props = {
  open: boolean
  onOpenChange: (open: boolean) => void
  onOpenSettings: () => void
}

export default function CanvasAssistantDrawer({ open, onOpenChange, onOpenSettings }: Props) {
  if (!open) {
    return (
      <div className="pointer-events-none absolute inset-x-0 bottom-4 z-30 flex justify-center">
        <button
          className="pointer-events-auto flex items-center gap-2 rounded-full border border-[var(--border-color)] bg-[var(--bg-secondary)] px-3 py-2 transition-colors hover:bg-[var(--bg-tertiary)]"
          onClick={() => onOpenChange(true)}
          title="唤出 nexus（⌘K）"
        >
          <MessageSquare className="h-4 w-4 text-[var(--text-primary)]" />
          <span className="text-sm font-semibold text-[var(--text-primary)]">nexus</span>
          <span className="text-xs text-[var(--text-secondary)]">⌘K</span>
        </button>
      </div>
    )
  }

  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-4 z-30 flex justify-center">
      <div
        className="pointer-events-auto flex flex-col overflow-hidden rounded-2xl border border-[var(--border-color)] bg-[var(--bg-secondary)]"
        style={{ 
          width: 'min(958px, calc(100% - 24px))', 
          height: 'min(1080px, calc(100vh - 120px))',
          // 确保文本选择和复制正常工作
          userSelect: 'text',
          WebkitUserSelect: 'text',
        }}
      >
        <div className="flex h-full flex-col">
          <button
            className="mx-auto mt-2 h-1.5 w-11 rounded-full bg-black/10"
            onClick={() => onOpenChange(false)}
            title="收起（Esc 或 ⌘K）"
          />
          <div className="mt-2 min-h-0 flex-1">
            <CanvasAssistantPanel variant="drawer" onOpenSettings={onOpenSettings} onClose={() => onOpenChange(false)} />
          </div>
        </div>
      </div>
    </div>
  )
}
