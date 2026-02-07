import React, { useEffect, useMemo, useRef, useState } from 'react'
import { useGraphStore } from '@/graph/store'
import type { GraphEdge, GraphNode, Viewport } from '@/graph/types'
import { getNodeSize } from '@/graph/nodeSizing'

type PortSide = 'left' | 'right'
type ImageRole = 'first_frame_image' | 'last_frame_image' | 'input_reference'
type EdgeKind = 'imageRole' | 'promptOrder' | 'imageOrder'
type ShownEdge =
  | { id: string; x: number; y: number; kind: 'imageRole'; role: ImageRole }
  | { id: string; x: number; y: number; kind: 'promptOrder'; order: number; max: number }
  | { id: string; x: number; y: number; kind: 'imageOrder'; order: number; max: number }

const roleOptions: { label: string; value: ImageRole }[] = [
  { label: '首帧', value: 'first_frame_image' },
  { label: '尾帧', value: 'last_frame_image' },
  { label: '参考图', value: 'input_reference' }
]

const readSide = (raw: unknown, fallback: PortSide): PortSide => (raw === 'left' || raw === 'right' ? raw : fallback)

const asPositiveInt = (v: unknown, fallback: number) => {
  const n = typeof v === 'number' ? v : Number(v)
  if (!Number.isFinite(n) || n <= 0) return fallback
  return Math.max(1, Math.floor(n))
}

const portWorldPos = (node: GraphNode, side: PortSide) => {
  const { w, h } = getNodeSize(node.type)
  return { x: node.x + (side === 'right' ? w : 0), y: node.y + h * 0.5 }
}

const cubicPoint = (p0: any, p1: any, p2: any, p3: any, t: number) => {
  const u = 1 - t
  const tt = t * t
  const uu = u * u
  const uuu = uu * u
  const ttt = tt * t
  return {
    x: uuu * p0.x + 3 * uu * t * p1.x + 3 * u * tt * p2.x + ttt * p3.x,
    y: uuu * p0.y + 3 * uu * t * p1.y + 3 * u * tt * p2.y + ttt * p3.y
  }
}

const bezierControls = (from: any, to: any, fromSide: PortSide, toSide: PortSide) => {
  const dx = to.x - from.x
  const handle = Math.max(60, Math.min(320, Math.abs(dx) * 0.45))
  const c1 = { x: from.x + (fromSide === 'right' ? handle : -handle), y: from.y }
  const c2 = { x: to.x + (toSide === 'right' ? handle : -handle), y: to.y }
  return { c1, c2 }
}

const toScreen = (p: { x: number; y: number }, vp: Viewport) => ({ x: p.x * vp.zoom + vp.x, y: p.y * vp.zoom + vp.y })

const inferKind = (source: GraphNode | undefined, target: GraphNode | undefined, e: GraphEdge): EdgeKind | null => {
  if (!source || !target) return null
  const t = String((e as any).type || '').trim()
  if (t === 'imageRole' || t === 'promptOrder' || t === 'imageOrder') return t as EdgeKind
  const role = String((e.data as any)?.imageRole || '').trim()
  if (role) return 'imageRole'
  if ((e.data as any)?.promptOrder != null) return 'promptOrder'
  if ((e.data as any)?.imageOrder != null) return 'imageOrder'
  if (source.type === 'image' && target.type === 'videoConfig') return 'imageRole'
  if (source.type === 'text' && target.type === 'imageConfig') return 'promptOrder'
  if (source.type === 'image' && target.type === 'imageConfig') return 'imageOrder'
  return null
}

export default function EdgeOverlayLayer({ isInteracting, viewportOverride }: { isInteracting: boolean; viewportOverride?: Viewport | null }) {
  const rootRef = useRef<HTMLDivElement | null>(null)
  const [size, setSize] = useState({ w: 0, h: 0 })
  const edges = useGraphStore((s) => s.edges)
  const nodes = useGraphStore((s) => s.nodes)
  const viewport = useGraphStore((s) => s.viewport)
  const setEdgeImageRole = useGraphStore((s) => s.setEdgeImageRole)
  const setEdgePromptOrder = useGraphStore((s) => s.setEdgePromptOrder)
  const setEdgeImageOrder = useGraphStore((s) => s.setEdgeImageOrder)

  const vp = viewportOverride || viewport
  const show = !isInteracting && (vp.zoom || 1) >= 0.6

  useEffect(() => {
    const el = rootRef.current
    if (!el) return
    const ro = new ResizeObserver(() => {
      const rect = el.getBoundingClientRect()
      setSize({ w: Math.floor(rect.width), h: Math.floor(rect.height) })
    })
    ro.observe(el)
    const rect = el.getBoundingClientRect()
    setSize({ w: Math.floor(rect.width), h: Math.floor(rect.height) })
    return () => ro.disconnect()
  }, [])

  const byId = useMemo(() => new Map(nodes.map((n) => [n.id, n])), [nodes])
  const orderMeta = useMemo(() => {
    const prompt = new Map<string, { max: number; count: number }>()
    const image = new Map<string, { max: number; count: number }>()

    for (const e of edges) {
      const s = byId.get(e.source)
      const t = byId.get(e.target)
      const kind = inferKind(s, t, e)
      if (!kind) continue
      if (kind === 'promptOrder') {
        const m = prompt.get(e.target) || { max: 1, count: 0 }
        m.count += 1
        m.max = Math.max(m.max, asPositiveInt((e.data as any)?.promptOrder, 1))
        prompt.set(e.target, m)
      } else if (kind === 'imageOrder') {
        const m = image.get(e.target) || { max: 1, count: 0 }
        m.count += 1
        m.max = Math.max(m.max, asPositiveInt((e.data as any)?.imageOrder, 1))
        image.set(e.target, m)
      }
    }
    return { prompt, image }
  }, [byId, edges])

  const shown = useMemo(() => {
    if (!show) return [] as ShownEdge[]
    if (size.w <= 0 || size.h <= 0) return [] as ShownEdge[]
    const out: ShownEdge[] = []
    const margin = 140

    for (const e of edges) {
      const s = byId.get(e.source)
      const t = byId.get(e.target)
      const kind = inferKind(s, t, e)
      if (!kind) continue
      const fromSide = readSide((e.data as any)?.sourcePort || (e.data as any)?.sourceHandle, 'right')
      const toSide = readSide((e.data as any)?.targetPort || (e.data as any)?.targetHandle, 'left')
      if (!s || !t) continue

      const p0 = portWorldPos(s, fromSide)
      const p3 = portWorldPos(t, toSide)
      const { c1, c2 } = bezierControls(p0, p3, fromSide, toSide)
      const mid = cubicPoint(p0, c1, c2, p3, 0.5)
      const screen = toScreen(mid, vp)
      if (screen.x < -margin || screen.y < -margin || screen.x > size.w + margin || screen.y > size.h + margin) continue

      if (kind === 'imageRole') {
        const roleRaw = String((e.data as any)?.imageRole || '').trim() as ImageRole
        const role = roleRaw === 'last_frame_image' || roleRaw === 'input_reference' ? roleRaw : 'first_frame_image'
        out.push({ id: e.id, x: screen.x, y: screen.y, kind: 'imageRole', role })
      } else if (kind === 'promptOrder') {
        const order = asPositiveInt((e.data as any)?.promptOrder, 1)
        const meta = orderMeta.prompt.get(e.target) || { max: 1, count: 1 }
        const max = Math.max(meta.count, meta.max, order)
        out.push({ id: e.id, x: screen.x, y: screen.y, kind: 'promptOrder', order, max })
      } else if (kind === 'imageOrder') {
        const order = asPositiveInt((e.data as any)?.imageOrder, 1)
        const meta = orderMeta.image.get(e.target) || { max: 1, count: 1 }
        const max = Math.max(meta.count, meta.max, order)
        out.push({ id: e.id, x: screen.x, y: screen.y, kind: 'imageOrder', order, max })
      }
    }
    return out
  }, [byId, edges, orderMeta.image, orderMeta.prompt, show, size.h, size.w, vp])

  const [openId, setOpenId] = useState<string | null>(null)

  if (!show || shown.length === 0) return null

  return (
    <div ref={rootRef} className="pointer-events-none absolute inset-0 z-20">
      {shown.map((it) => {
        const isOpen = openId === it.id
        if (it.kind === 'imageRole') {
          const current = roleOptions.find((o) => o.value === it.role)?.label || '首帧'
          return (
            <div
              key={it.id}
              className="pointer-events-auto absolute"
              style={{ transform: `translate3d(${it.x}px, ${it.y}px, 0) translate(-50%, -50%)` }}
            >
              <button
                className="flex items-center gap-1 rounded-full border border-[var(--border-color)] bg-[var(--bg-secondary)] px-2 py-1 text-xs text-[var(--text-primary)] shadow-sm"
                onClick={(e) => {
                  e.stopPropagation()
                  setOpenId((v) => (v === it.id ? null : it.id))
                }}
              >
                {current}
                <span className="text-[10px] text-[var(--text-secondary)]">▾</span>
              </button>

              {isOpen ? (
                <div className="pointer-events-auto absolute left-1/2 top-full z-30 mt-1 w-[120px] -translate-x-1/2 overflow-hidden rounded-xl border border-[var(--border-color)] bg-[var(--bg-secondary)] shadow-xl">
                  {roleOptions.map((opt) => (
                    <button
                      key={opt.value}
                      className={[
                        'flex w-full items-center justify-between px-3 py-2 text-left text-xs',
                        opt.value === it.role ? 'bg-[var(--bg-tertiary)] text-[var(--accent-color)]' : 'hover:bg-[var(--bg-tertiary)]'
                      ].join(' ')}
                      onClick={(e) => {
                        e.stopPropagation()
                        setEdgeImageRole(it.id, opt.value)
                        setOpenId(null)
                      }}
                    >
                      <span>{opt.label}</span>
                      {opt.value === it.role ? <span className="text-[10px]">✓</span> : null}
                    </button>
                  ))}
                </div>
              ) : null}
            </div>
          )
        }

        if (it.kind === 'promptOrder') {
          const options = Array.from({ length: it.max }, (_, i) => i + 1)
          return (
            <div
              key={it.id}
              className="pointer-events-auto absolute"
              style={{ transform: `translate3d(${it.x}px, ${it.y}px, 0) translate(-50%, -50%)` }}
            >
              <button
                className="flex h-6 w-6 items-center justify-center rounded-full border-2 border-white bg-emerald-500 text-xs font-bold text-white shadow-md transition-transform hover:scale-110"
                onClick={(e) => {
                  e.stopPropagation()
                  setOpenId((v) => (v === it.id ? null : it.id))
                }}
                title="提示词顺序"
              >
                {it.order}
              </button>

              {isOpen ? (
                <div className="pointer-events-auto absolute left-1/2 top-full z-30 mt-1 w-[120px] -translate-x-1/2 overflow-hidden rounded-xl border border-[var(--border-color)] bg-[var(--bg-secondary)] shadow-xl">
                  {options.map((n) => (
                    <button
                      key={n}
                      className={[
                        'flex w-full items-center justify-between px-3 py-2 text-left text-xs',
                        n === it.order ? 'bg-[var(--bg-tertiary)] text-emerald-600' : 'hover:bg-[var(--bg-tertiary)]'
                      ].join(' ')}
                      onClick={(e) => {
                        e.stopPropagation()
                        setEdgePromptOrder(it.id, n)
                        setOpenId(null)
                      }}
                    >
                      <span>第 {n} 个</span>
                      {n === it.order ? <span className="text-[10px]">✓</span> : null}
                    </button>
                  ))}
                </div>
              ) : null}
            </div>
          )
        }

        if (it.kind === 'imageOrder') {
          const options = Array.from({ length: it.max }, (_, i) => i + 1)
          return (
            <div
              key={it.id}
              className="pointer-events-auto absolute"
              style={{ transform: `translate3d(${it.x}px, ${it.y}px, 0) translate(-50%, -50%)` }}
            >
              <button
                className="flex h-6 w-6 items-center justify-center rounded-full border-2 border-white bg-blue-500 text-xs font-bold text-white shadow-md transition-transform hover:scale-110"
                onClick={(e) => {
                  e.stopPropagation()
                  setOpenId((v) => (v === it.id ? null : it.id))
                }}
                title="参考图顺序"
              >
                {it.order}
              </button>

              {isOpen ? (
                <div className="pointer-events-auto absolute left-1/2 top-full z-30 mt-1 w-[120px] -translate-x-1/2 overflow-hidden rounded-xl border border-[var(--border-color)] bg-[var(--bg-secondary)] shadow-xl">
                  {options.map((n) => (
                    <button
                      key={n}
                      className={[
                        'flex w-full items-center justify-between px-3 py-2 text-left text-xs',
                        n === it.order ? 'bg-[var(--bg-tertiary)] text-blue-600' : 'hover:bg-[var(--bg-tertiary)]'
                      ].join(' ')}
                      onClick={(e) => {
                        e.stopPropagation()
                        setEdgeImageOrder(it.id, n)
                        setOpenId(null)
                      }}
                    >
                      <span>第 {n} 张</span>
                      {n === it.order ? <span className="text-[10px]">✓</span> : null}
                    </button>
                  ))}
                </div>
              ) : null}
            </div>
          )
        }

        // TypeScript exhaustiveness check - should never reach here
        return null
      })}
    </div>
  )
}
