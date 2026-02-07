import React, { useMemo, useState } from 'react'
import { useGraphStore } from '@/graph/store'
import type { Viewport } from '@/graph/types'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

const toScreen = (x: number, y: number, vp: Viewport) => ({
  x: x * vp.zoom + vp.x,
  y: y * vp.zoom + vp.y
})

export default function NodeOverlay({ isInteracting }: { isInteracting: boolean }) {
  const selectedId = useGraphStore((s) => s.selectedNodeId)
  const node = useGraphStore((s) => s.nodes.find((n) => n.id === selectedId) || null)
  const viewport = useGraphStore((s) => s.viewport)
  const updateNode = useGraphStore((s) => s.updateNode)
  const setSelected = useGraphStore((s) => s.setSelected)

  const [labelDraft, setLabelDraft] = useState('')

  const pos = useMemo(() => {
    if (!node) return null
    return toScreen(node.x, node.y, viewport)
  }, [node, viewport])

  if (!node || !pos || isInteracting) return null

  const label = String((node.data as any)?.label || node.type || '')

  return (
    <div
      className="pointer-events-auto absolute z-[100] w-72 rounded-xl border border-[var(--border-color)] bg-[var(--bg-secondary)] shadow-xl"
      style={{ left: pos.x + 12, top: pos.y + 12 }}
    >
      <div className="flex items-center justify-between border-b border-[var(--border-color)] px-4 py-3">
        <div className="text-sm font-semibold text-[var(--text-primary)]">{node.type}</div>
        <Button variant="ghost" size="sm" onClick={() => setSelected(null)}>
          关闭
        </Button>
      </div>
      <div className="space-y-3 px-4 py-3">
        <div className="space-y-1">
          <div className="text-xs text-[var(--text-secondary)]">标题</div>
          <Input value={labelDraft || label} onChange={(e) => setLabelDraft(e.target.value)} />
        </div>
        <Button
          variant="secondary"
          onClick={() => {
            updateNode(node.id, { data: { label: labelDraft || label } })
          }}
        >
          保存
        </Button>
      </div>
    </div>
  )
}

