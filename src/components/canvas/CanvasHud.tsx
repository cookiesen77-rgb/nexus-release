import React, { useEffect, useMemo, useRef, useState, useCallback } from 'react'
import { useGraphStore } from '@/graph/store'
import type { Viewport } from '@/graph/types'
import { getNodeAccent, getNodeSize } from '@/graph/nodeSizing'
import { Locate, Minus, Plus, LayoutGrid } from 'lucide-react'

const clampZoom = (z: number) => Math.max(0.1, Math.min(2, z))

const useElementSize = (ref: React.RefObject<HTMLElement | null>) => {
  const [size, setSize] = useState({ w: 0, h: 0 })
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const ro = new ResizeObserver(() => {
      const r = el.getBoundingClientRect()
      setSize({ w: Math.max(1, Math.floor(r.width)), h: Math.max(1, Math.floor(r.height)) })
    })
    ro.observe(el)
    const r = el.getBoundingClientRect()
    setSize({ w: Math.max(1, Math.floor(r.width)), h: Math.max(1, Math.floor(r.height)) })
    return () => ro.disconnect()
  }, [ref])
  return size
}

const getViewportWorldRect = (vp: Viewport, screen: { w: number; h: number }) => {
  const z = vp.zoom || 1
  return {
    x: -vp.x / z,
    y: -vp.y / z,
    w: screen.w / z,
    h: screen.h / z
  }
}

export default function CanvasHud({ containerRef }: { containerRef: React.RefObject<HTMLDivElement | null> }) {
  const nodes = useGraphStore((s) => s.nodes)
  const viewport = useGraphStore((s) => s.viewport)
  const setViewport = useGraphStore((s) => s.setViewport)

  const screen = useElementSize(containerRef)

  const bounds = useMemo(() => {
    if (nodes.length === 0) return null
    let x0 = Infinity
    let y0 = Infinity
    let x1 = -Infinity
    let y1 = -Infinity
    for (const n of nodes) {
      const { w, h } = getNodeSize(n.type)
      x0 = Math.min(x0, n.x)
      y0 = Math.min(y0, n.y)
      x1 = Math.max(x1, n.x + w)
      y1 = Math.max(y1, n.y + h)
    }
    const pad = 120
    return { x0: x0 - pad, y0: y0 - pad, x1: x1 + pad, y1: y1 + pad }
  }, [nodes])

  const zoomPct = Math.round((viewport.zoom || 1) * 100)

  const zoomAtScreen = (factor: number, screenPoint: { x: number; y: number }) => {
    const base = viewport
    const z0 = base.zoom || 1
    const z1 = clampZoom(z0 * factor)
    const world = { x: (screenPoint.x - base.x) / z0, y: (screenPoint.y - base.y) / z0 }
    const nx = screenPoint.x - world.x * z1
    const ny = screenPoint.y - world.y * z1
    setViewport({ x: nx, y: ny, zoom: z1 })
  }

  const zoomCenter = (factor: number) => {
    zoomAtScreen(factor, { x: screen.w * 0.5, y: screen.h * 0.5 })
  }

  const fitView = () => {
    if (!bounds) return
    const w = Math.max(1, bounds.x1 - bounds.x0)
    const h = Math.max(1, bounds.y1 - bounds.y0)
    const margin = 48
    const z = clampZoom(Math.min((screen.w - margin * 2) / w, (screen.h - margin * 2) / h))
    const nx = margin - bounds.x0 * z
    const ny = margin - bounds.y0 * z
    setViewport({ x: nx, y: ny, zoom: z })
  }

  // 一键整理节点布局
  const arrangeNodes = useCallback(() => {
    if (nodes.length === 0) return

    const store = useGraphStore.getState()
    const edges = store.edges

    // 建立节点的入度和出度映射
    const inDegree = new Map<string, number>()
    const outEdges = new Map<string, string[]>()

    for (const node of nodes) {
      inDegree.set(node.id, 0)
      outEdges.set(node.id, [])
    }

    for (const edge of edges) {
      const targetDegree = inDegree.get(edge.target) || 0
      inDegree.set(edge.target, targetDegree + 1)

      const sources = outEdges.get(edge.source) || []
      sources.push(edge.target)
      outEdges.set(edge.source, sources)
    }

    // 拓扑排序 + 分层
    const levels: string[][] = []
    const assigned = new Set<string>()

    // 第一层：入度为0的节点
    let currentLevel = nodes.filter(n => (inDegree.get(n.id) || 0) === 0).map(n => n.id)
    if (currentLevel.length === 0) {
      // 如果没有入度为0的节点，从第一个节点开始
      currentLevel = [nodes[0].id]
    }

    while (currentLevel.length > 0) {
      levels.push(currentLevel)
      currentLevel.forEach(id => assigned.add(id))

      const nextLevel: string[] = []
      for (const nodeId of currentLevel) {
        const targets = outEdges.get(nodeId) || []
        for (const targetId of targets) {
          if (!assigned.has(targetId) && !nextLevel.includes(targetId)) {
            nextLevel.push(targetId)
          }
        }
      }
      currentLevel = nextLevel
    }

    // 添加未分配的节点到最后一层
    const unassigned = nodes.filter(n => !assigned.has(n.id)).map(n => n.id)
    if (unassigned.length > 0) {
      levels.push(unassigned)
    }

    // 布局参数
    const startX = 100
    const startY = 100
    const horizontalGap = 350
    const verticalGap = 200

    // 计算每层的位置
    const updates: Array<{ id: string; x: number; y: number }> = []

    for (let levelIndex = 0; levelIndex < levels.length; levelIndex++) {
      const level = levels[levelIndex]
      const levelX = startX + levelIndex * horizontalGap

      for (let nodeIndex = 0; nodeIndex < level.length; nodeIndex++) {
        const nodeId = level[nodeIndex]
        const levelY = startY + nodeIndex * verticalGap

        updates.push({ id: nodeId, x: levelX, y: levelY })
      }
    }

    // 批量更新节点位置
    for (const { id, x, y } of updates) {
      store.updateNode(id, { x, y })
    }

    window.$message?.success?.('节点已整理完成')

    // 自动适应视图
    setTimeout(() => fitView(), 100)
  }, [nodes, fitView])

  // MiniMap
  const miniOuter = { w: 180, h: 120, outerPad: 8 }
  const mini = { w: miniOuter.w - miniOuter.outerPad * 2, h: miniOuter.h - miniOuter.outerPad * 2, pad: 6 }
  const miniRef = useRef<HTMLCanvasElement | null>(null)
  const dragRef = useRef<null | { active: boolean }>(null)

  const miniTransform = useMemo(() => {
    const x0 = bounds?.x0 ?? -500
    const y0 = bounds?.y0 ?? -350
    const x1 = bounds?.x1 ?? 500
    const y1 = bounds?.y1 ?? 350
    const ww = Math.max(1, x1 - x0)
    const hh = Math.max(1, y1 - y0)
    const scale = Math.min((mini.w - mini.pad * 2) / ww, (mini.h - mini.pad * 2) / hh)
    return { x0, y0, x1, y1, ww, hh, scale }
  }, [bounds])

  useEffect(() => {
    const canvas = miniRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    ctx.clearRect(0, 0, mini.w, mini.h)
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, mini.w, mini.h)

    const { x0, y0, scale } = miniTransform
    const toMini = (p: { x: number; y: number }) => ({
      x: (p.x - x0) * scale + mini.pad,
      y: (p.y - y0) * scale + mini.pad
    })

    for (const n of nodes) {
      const { w, h } = getNodeSize(n.type)
      const p = toMini({ x: n.x, y: n.y })
      const sz = { w: Math.max(2, w * scale), h: Math.max(2, h * scale) }
      const a = getNodeAccent(n.type)
      ctx.fillStyle = `rgba(${Math.round(a[0] * 255)},${Math.round(a[1] * 255)},${Math.round(a[2] * 255)},0.18)`
      ctx.strokeStyle = 'rgba(148,163,184,0.35)'
      ctx.lineWidth = 1
      ctx.fillRect(p.x, p.y, sz.w, sz.h)
      ctx.strokeRect(p.x + 0.5, p.y + 0.5, Math.max(1, sz.w - 1), Math.max(1, sz.h - 1))
    }

    const vr = getViewportWorldRect(viewport, screen)
    const vp0 = toMini({ x: vr.x, y: vr.y })
    const vpw = vr.w * scale
    const vph = vr.h * scale
    ctx.strokeStyle = 'rgba(37,99,235,0.55)'
    ctx.lineWidth = 2
    ctx.strokeRect(vp0.x, vp0.y, vpw, vph)
  }, [miniTransform, nodes, screen, viewport])

  const panToMini = (clientX: number, clientY: number) => {
    const canvas = miniRef.current
    if (!canvas) return
    const rect = canvas.getBoundingClientRect()
    const sx = mini.w / Math.max(1, rect.width)
    const sy = mini.h / Math.max(1, rect.height)
    const x = (clientX - rect.left) * sx
    const y = (clientY - rect.top) * sy
    const { x0, y0, scale } = miniTransform
    const worldX = x0 + (x - mini.pad) / Math.max(0.0001, scale)
    const worldY = y0 + (y - mini.pad) / Math.max(0.0001, scale)
    const z = viewport.zoom || 1
    const nx = screen.w * 0.5 - worldX * z
    const ny = screen.h * 0.5 - worldY * z
    setViewport({ x: nx, y: ny, zoom: z })
  }

  return (
    <div className="pointer-events-none absolute inset-0 z-30">
      <div className="pointer-events-auto absolute bottom-4 left-4 flex items-center gap-2 rounded-[12px] border border-[var(--border-color)] bg-[var(--bg-secondary)] p-1.5">
        <button
          className="flex h-8 w-8 items-center justify-center rounded-[10px] hover:bg-[var(--bg-tertiary)] disabled:opacity-40"
          onClick={() => fitView()}
          disabled={!bounds}
          title="适应视图"
          type="button"
        >
          <Locate className="h-4 w-4 text-[var(--text-secondary)]" />
        </button>

        <button
          className="flex h-8 w-8 items-center justify-center rounded-[10px] hover:bg-[var(--bg-tertiary)] disabled:opacity-40"
          onClick={arrangeNodes}
          disabled={nodes.length === 0}
          title="一键整理节点"
          type="button"
        >
          <LayoutGrid className="h-4 w-4 text-[var(--text-secondary)]" />
        </button>

        <div className="flex items-center gap-1.5 rounded-[10px] border border-[var(--border-color)] bg-[var(--bg-tertiary)] px-2 py-1.5">
          <button
            className="flex h-6 w-6 items-center justify-center rounded-lg hover:bg-[var(--bg-secondary)]"
            onClick={() => zoomCenter(1 / 1.1)}
            title="缩小"
            type="button"
          >
            <Minus className="h-3.5 w-3.5 text-[var(--text-secondary)]" />
          </button>
          <div className="min-w-[40px] text-center text-xs font-semibold text-[var(--text-primary)]">{zoomPct}%</div>
          <button
            className="flex h-6 w-6 items-center justify-center rounded-lg hover:bg-[var(--bg-secondary)]"
            onClick={() => zoomCenter(1.1)}
            title="放大"
            type="button"
          >
            <Plus className="h-3.5 w-3.5 text-[var(--text-secondary)]" />
          </button>
        </div>
      </div>

      <div
        className="pointer-events-auto absolute bottom-4 right-4 h-[120px] w-[180px] rounded-[14px] border border-[var(--border-color)] bg-[var(--bg-secondary)] p-2"
        style={{ touchAction: 'none' }}
      >
        <canvas
          ref={miniRef}
          width={mini.w}
          height={mini.h}
          className="block h-full w-full rounded-[12px] border border-[var(--border-color)] bg-[var(--bg-secondary)]"
          onPointerDown={(e) => {
            e.preventDefault()
            dragRef.current = { active: true }
            ;(e.currentTarget as any).setPointerCapture?.(e.pointerId)
            panToMini(e.clientX, e.clientY)
          }}
          onPointerMove={(e) => {
            if (!dragRef.current?.active) return
            panToMini(e.clientX, e.clientY)
          }}
          onPointerUp={(e) => {
            dragRef.current = null
            try {
              ;(e.currentTarget as any).releasePointerCapture?.(e.pointerId)
            } catch {
              // ignore
            }
          }}
        />
      </div>
    </div>
  )
}
