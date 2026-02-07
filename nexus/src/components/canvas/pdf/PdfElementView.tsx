import React, { useMemo } from 'react'
import { cn } from '@/lib/utils'
import type { PdfElementDraft, PdfImageFit, PdfTextAlign } from '@/lib/export/historyPdf'

type ResizeHandle = 'nw' | 'ne' | 'sw' | 'se'

const clamp = (n: number, min: number, max: number) => Math.max(min, Math.min(max, n))

const snap = (v: number, step: number) => {
  if (!step) return v
  return Math.round(v / step) * step
}

export default function PdfElementView({
  element,
  selected,
  pageRef,
  pageBase,
  zoom,
  snapEnabled,
  onSelect,
  onUpdate,
}: {
  element: PdfElementDraft
  selected: boolean
  pageRef: React.RefObject<HTMLDivElement>
  pageBase: { w: number; h: number }
  zoom: number
  snapEnabled: boolean
  onSelect: (id: string) => void
  onUpdate: (id: string, patch: Partial<any>) => void
}) {
  const style = useMemo(
    () => ({
      left: `${clamp(element.x, 0, 1) * pageBase.w}px`,
      top: `${clamp(element.y, 0, 1) * pageBase.h}px`,
      width: `${clamp(element.w, 0, 1) * pageBase.w}px`,
      height: `${clamp(element.h, 0, 1) * pageBase.h}px`,
      zIndex: element.z,
      willChange: 'left, top, width, height',
      contain: 'paint',
    }),
    [element.h, element.w, element.x, element.y, element.z, pageBase.h, pageBase.w]
  )

  const startMove = (e: React.PointerEvent) => {
    e.preventDefault()
    e.stopPropagation()
    onSelect(element.id)
    const page = pageRef.current
    if (!page) return
    const rect = page.getBoundingClientRect()
    const start = { cx: e.clientX, cy: e.clientY, x: element.x, y: element.y, w: element.w, h: element.h }
    const step = snapEnabled ? Math.max(0.0025, 8 / Math.max(1, rect.width)) : 0
    const pointerId = e.pointerId
    try {
      ;(e.currentTarget as any)?.setPointerCapture?.(pointerId)
    } catch {
      // ignore
    }

    const onPointerMove = (ev: PointerEvent) => {
      if (ev.pointerId !== pointerId) return
      const dx = (ev.clientX - start.cx) / rect.width
      const dy = (ev.clientY - start.cy) / rect.height
      let x = start.x + dx
      let y = start.y + dy
      x = snap(x, step)
      y = snap(y, step)
      x = clamp(x, 0, 1 - clamp(start.w, 0, 1))
      y = clamp(y, 0, 1 - clamp(start.h, 0, 1))
      onUpdate(element.id, { x, y })
    }
    const onPointerUp = (ev: PointerEvent) => {
      if (ev.pointerId !== pointerId) return
      window.removeEventListener('pointermove', onPointerMove)
      window.removeEventListener('pointerup', onPointerUp)
      try {
        ;(e.currentTarget as any)?.releasePointerCapture?.(pointerId)
      } catch {
        // ignore
      }
    }
    window.addEventListener('pointermove', onPointerMove, { passive: false } as any)
    window.addEventListener('pointerup', onPointerUp, { passive: false } as any)
  }

  const startResize = (handle: ResizeHandle) => (e: React.PointerEvent) => {
    e.preventDefault()
    e.stopPropagation()
    onSelect(element.id)
    const page = pageRef.current
    if (!page) return
    const rect = page.getBoundingClientRect()
    const start = { cx: e.clientX, cy: e.clientY, x: element.x, y: element.y, w: element.w, h: element.h }
    const step = snapEnabled ? Math.max(0.0025, 8 / Math.max(1, rect.width)) : 0
    const minW = 0.05
    const minH = 0.05
    const pointerId = e.pointerId
    try {
      ;(e.currentTarget as any)?.setPointerCapture?.(pointerId)
    } catch {
      // ignore
    }

    const onPointerMove = (ev: PointerEvent) => {
      if (ev.pointerId !== pointerId) return
      const dx = (ev.clientX - start.cx) / rect.width
      const dy = (ev.clientY - start.cy) / rect.height

      let x = start.x
      let y = start.y
      let w = start.w
      let h = start.h

      if (handle === 'se') {
        w = start.w + dx
        h = start.h + dy
      } else if (handle === 'sw') {
        x = start.x + dx
        w = start.w - dx
        h = start.h + dy
      } else if (handle === 'ne') {
        y = start.y + dy
        w = start.w + dx
        h = start.h - dy
      } else if (handle === 'nw') {
        x = start.x + dx
        y = start.y + dy
        w = start.w - dx
        h = start.h - dy
      }

      w = snap(w, step)
      h = snap(h, step)
      x = snap(x, step)
      y = snap(y, step)

      w = clamp(w, minW, 1)
      h = clamp(h, minH, 1)
      x = clamp(x, 0, 1 - w)
      y = clamp(y, 0, 1 - h)

      onUpdate(element.id, { x, y, w, h })
    }
    const onPointerUp = (ev: PointerEvent) => {
      if (ev.pointerId !== pointerId) return
      window.removeEventListener('pointermove', onPointerMove)
      window.removeEventListener('pointerup', onPointerUp)
      try {
        ;(e.currentTarget as any)?.releasePointerCapture?.(pointerId)
      } catch {
        // ignore
      }
    }
    window.addEventListener('pointermove', onPointerMove, { passive: false } as any)
    window.addEventListener('pointerup', onPointerUp, { passive: false } as any)
  }

  const isText = element.kind === 'text'
  const isImage = element.kind === 'image'

  return (
    <div
      className={cn(
        'absolute left-0 top-0 select-none touch-none',
        selected ? 'outline outline-2 outline-[rgb(var(--accent-rgb)/0.70)]' : 'outline-none'
      )}
      style={style as any}
      onPointerDown={startMove}
    >
      {isImage ? (
        <img
          src={(element as any).previewSrc || (element as any).src}
          alt=""
          draggable={false}
          className="h-full w-full"
          style={{
            objectFit: ((element as any).fit as PdfImageFit) === 'contain' ? 'contain' : 'cover',
            userSelect: 'none',
            pointerEvents: 'none',
          } as React.CSSProperties}
        />
      ) : null}

      {isText ? (
        <div
          className="h-full w-full px-2 py-2 text-[var(--text-primary)]"
          style={{
            whiteSpace: 'pre-wrap',
            overflow: 'hidden',
            fontSize: `${Math.max(8, Number((element as any).fontSize) || 24) * Math.max(0.5, zoom)}px`,
            fontWeight: (element as any).bold ? 700 : 400,
            lineHeight: String(Math.max(1.0, Number((element as any).lineHeight) || 1.2)),
            color: String((element as any).color || 'var(--text-primary)'),
            textAlign: (((element as any).align as PdfTextAlign) || 'left') as any,
            pointerEvents: 'none',
          }}
        >
          {String((element as any).text || '')}
        </div>
      ) : null}

      {/* Resize handles */}
      {selected ? (
        <>
          <div
            className="absolute -left-1 -top-1 h-2.5 w-2.5 cursor-nwse-resize rounded bg-white shadow"
            onPointerDown={startResize('nw')}
          />
          <div
            className="absolute -right-1 -top-1 h-2.5 w-2.5 cursor-nesw-resize rounded bg-white shadow"
            onPointerDown={startResize('ne')}
          />
          <div
            className="absolute -left-1 -bottom-1 h-2.5 w-2.5 cursor-nesw-resize rounded bg-white shadow"
            onPointerDown={startResize('sw')}
          />
          <div
            className="absolute -right-1 -bottom-1 h-2.5 w-2.5 cursor-nwse-resize rounded bg-white shadow"
            onPointerDown={startResize('se')}
          />
        </>
      ) : null}
    </div>
  )
}

