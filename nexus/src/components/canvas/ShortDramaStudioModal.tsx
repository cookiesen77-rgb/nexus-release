/**
 * Short Drama Studio Modal | 短剧制作工作台（C1）
 *
 * 目标：
 * - 全流程在工作台内完成（不依赖画布节点）
 * - 模型来源：Nexus 内置模型（见 config/models.js）
 * - 草稿：localStorage（大媒体写入 IndexedDB，草稿保存 mediaId/sourceUrl）
 */

import React from 'react'
import { useGraphStore } from '@/graph/store'
import ShortDramaStudioShell from '@/components/shortDrama/ShortDramaStudioShell'

interface Props {
  open: boolean
  onClose: () => void
}

export default function ShortDramaStudioModal({ open, onClose }: Props) {
  const projectId = useGraphStore((s) => s.projectId) || 'default'

  if (!open) return null

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <ShortDramaStudioShell
        projectId={projectId}
        closeVariant="icon"
        onRequestClose={onClose}
        className="h-[min(92vh,980px)] w-[min(1480px,98vw)] rounded-2xl border border-[var(--border-color)] shadow-2xl"
      />
    </div>
  )
}

