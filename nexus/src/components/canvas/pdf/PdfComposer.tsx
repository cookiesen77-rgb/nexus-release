import React, { useEffect, useMemo, useRef, useState } from 'react'
import { cn } from '@/lib/utils'
import PdfElementView from '@/components/canvas/pdf/PdfElementView'
import type {
  PdfDocDraft,
  PdfElementDraft,
  PdfImageElementDraft,
  PdfPageDraft,
  PdfPageOrientation,
  PdfTextAlign,
  PdfTextElementDraft,
} from '@/lib/export/historyPdf'
import { FileDown, Layers, Plus, Trash2, Type as TypeIcon, Grid3x3, RotateCw, ChevronLeft, ChevronRight, Copy } from 'lucide-react'

export type PdfComposerImage = {
  id: string
  src: string
  previewSrc?: string
  title?: string
}

const uid = () => {
  try {
    return crypto.randomUUID()
  } catch {
    return `id_${Date.now()}_${Math.floor(Math.random() * 1e9)}`
  }
}

const clamp = (n: number, min: number, max: number) => Math.max(min, Math.min(max, n))

const defaultDoc = (): PdfDocDraft => ({
  pageSize: 'A4',
  orientation: 'portrait',
  pages: [{ id: uid(), elements: [] }],
})

const getMaxZ = (els: PdfElementDraft[]) => {
  let m = 0
  for (const e of els as any[]) m = Math.max(m, Number(e?.z) || 0)
  return m
}

const nextCascadePos = (count: number, w: number, h: number) => {
  // 避免新元素完全重叠（用户会误以为只创建/导出一个）
  const step = 0.035
  const offset = (count % 8) * step
  const x = clamp(0.12 + offset, 0.02, 1 - w - 0.02)
  const y = clamp(0.10 + offset, 0.02, 1 - h - 0.02)
  return { x, y }
}

export default function PdfComposer({
  images,
  exporting,
  progress,
  failedCount,
  error,
  onExport,
}: {
  images: PdfComposerImage[]
  exporting: boolean
  progress: { done: number; total: number; stage: string }
  failedCount: number
  error: string
  onExport: (doc: PdfDocDraft) => void
}) {
  const [doc, setDoc] = useState<PdfDocDraft>(() => defaultDoc())
  const [pageIndex, setPageIndex] = useState(0)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [snapEnabled, setSnapEnabled] = useState(true)
  const [zoom, setZoom] = useState(1)

  const pageRef = useRef<HTMLDivElement | null>(null)
  const selectedIdRef = useRef<string | null>(null)
  const pageIndexRef = useRef(0)

  const pages = doc.pages || []
  const page = pages[clamp(pageIndex, 0, Math.max(0, pages.length - 1))] || pages[0]
  const elements = (page?.elements || []).slice().sort((a: any, b: any) => (Number(a?.z) || 0) - (Number(b?.z) || 0))

  const selected = useMemo(() => elements.find((e) => e.id === selectedId) || null, [elements, selectedId])

  useEffect(() => {
    selectedIdRef.current = selectedId
  }, [selectedId])

  useEffect(() => {
    pageIndexRef.current = pageIndex
  }, [pageIndex])

  // Delete key (避免输入框内 Backspace 误删元素；避免多次绑定导致连删)
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const id = selectedIdRef.current
      if (!id) return
      if (e.key !== 'Delete' && e.key !== 'Backspace') return

      const t = e.target as any
      const tag = String(t?.tagName || '').toLowerCase()
      const isEditing = tag === 'input' || tag === 'textarea' || !!t?.isContentEditable
      if (isEditing) return

      e.preventDefault()
      const pi = pageIndexRef.current
      setDoc((prev) => {
        const nextPages = (prev.pages || []).map((p, idx) => {
          if (idx !== pi) return p
          const els = Array.isArray(p.elements) ? p.elements : []
          return { ...p, elements: els.filter((el) => el.id !== id) }
        })
        return { ...prev, pages: nextPages }
      })
      setSelectedId(null)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  const updateElement = (id: string, patch: Partial<any>) => {
    setDoc((prev) => {
      const nextPages = (prev.pages || []).map((p, idx) => {
        if (idx !== pageIndex) return p
        const els = Array.isArray(p.elements) ? p.elements : []
        const i = els.findIndex((e) => e.id === id)
        if (i === -1) return p
        const nextEls = els.slice()
        nextEls[i] = { ...(nextEls[i] as any), ...patch } as any
        return { ...p, elements: nextEls }
      })
      return { ...prev, pages: nextPages }
    })
  }

  const duplicateSelected = () => {
    if (!selected) return
    const newId = uid()
    setDoc((prev) => {
      const nextPages = (prev.pages || []).map((p, idx) => {
        if (idx !== pageIndex) return p
        const els = Array.isArray(p.elements) ? p.elements : []
        const maxZ = getMaxZ(els)
        const base: any = selected
        const w = clamp(Number(base.w) || 0.3, 0.05, 1)
        const h = clamp(Number(base.h) || 0.2, 0.05, 1)
        const x = clamp((Number(base.x) || 0) + 0.02, 0, 1 - w)
        const y = clamp((Number(base.y) || 0) + 0.02, 0, 1 - h)
        const copyEl: any = { ...base, id: newId, x, y, z: maxZ + 1 }
        return { ...p, elements: els.concat(copyEl) }
      })
      return { ...prev, pages: nextPages }
    })
    setSelectedId(newId)
  }

  const addImageToPage = (img: PdfComposerImage) => {
    const newId = uid()
    setDoc((prev) => {
      const nextPages = (prev.pages || []).map((p, idx) => {
        if (idx !== pageIndex) return p
        const els = Array.isArray(p.elements) ? p.elements : []
        const maxZ = getMaxZ(els)
        const w = 0.38
        const h = 0.38
        const imgCount = els.filter((e: any) => e?.kind === 'image').length
        const pos = nextCascadePos(imgCount, w, h)
        const el: PdfImageElementDraft = {
          id: newId,
          kind: 'image',
          x: pos.x,
          y: pos.y,
          w,
          h,
          z: maxZ + 1,
          src: img.src,
          previewSrc: img.previewSrc || img.src,
          fallbackSrc: img.previewSrc || img.src,
          fit: 'cover',
        }
        return { ...p, elements: els.concat(el as any) }
      })
      return { ...prev, pages: nextPages }
    })
    setSelectedId(newId)
  }

  const addTextToPage = () => {
    const newId = uid()
    setDoc((prev) => {
      const nextPages = (prev.pages || []).map((p, idx) => {
        if (idx !== pageIndex) return p
        const els = Array.isArray(p.elements) ? p.elements : []
        const maxZ = getMaxZ(els)
        const w = 0.6
        const h = 0.22
        const textCount = els.filter((e: any) => e?.kind === 'text').length
        const pos = nextCascadePos(textCount, w, h)
        const el: PdfTextElementDraft = {
          id: newId,
          kind: 'text',
          x: pos.x,
          y: pos.y,
          w,
          h,
          z: maxZ + 1,
          text: '在右侧面板编辑文字…',
          fontSize: 24,
          color: '#111827',
          align: 'left',
          bold: false,
          lineHeight: 1.2,
        }
        return { ...p, elements: els.concat(el) }
      })
      return { ...prev, pages: nextPages }
    })
    setSelectedId(newId)
  }

  const addPage = () => {
    const newIndex = pages.length
    setDoc((prev) => {
      const page: PdfPageDraft = { id: uid(), elements: [] }
      return { ...prev, pages: [...(prev.pages || []), page] }
    })
    setSelectedId(null)
    setPageIndex(newIndex)
  }

  const deletePage = () => {
    if (pages.length <= 1) return
    setDoc((prev) => {
      const nextPages = (prev.pages || []).slice()
      nextPages.splice(pageIndex, 1)
      return { ...prev, pages: nextPages }
    })
    setSelectedId(null)
    setPageIndex((i) => clamp(i - 1, 0, pages.length - 2))
  }

  const applyZ = (mode: 'front' | 'back' | 'forward' | 'backward') => {
    if (!selectedId) return
    setDoc((prev) => {
      const nextPages = (prev.pages || []).map((p, idx) => {
        if (idx !== pageIndex) return p
        const els = Array.isArray(p.elements) ? p.elements.slice() : []
        const sorted = els.slice().sort((a: any, b: any) => (Number(a?.z) || 0) - (Number(b?.z) || 0))
        const si = sorted.findIndex((e) => e.id === selectedId)
        if (si === -1) return p

        const patchZ = (id: string, z: number) => els.map((e: any) => (e.id === id ? { ...e, z } : e))

        if (mode === 'front') {
          const maxZ = getMaxZ(sorted as any)
          return { ...p, elements: patchZ(selectedId, maxZ + 1) as any }
        }
        if (mode === 'back') {
          const minZ = Math.min(...sorted.map((e: any) => Number(e?.z) || 0))
          return { ...p, elements: patchZ(selectedId, minZ - 1) as any }
        }
        if (mode === 'forward' && si < sorted.length - 1) {
          const a: any = sorted[si]
          const b: any = sorted[si + 1]
          const az = Number(a?.z) || 0
          const bz = Number(b?.z) || 0
          const nextEls = els.map((e: any) => {
            if (e.id === a.id) return { ...e, z: bz }
            if (e.id === b.id) return { ...e, z: az }
            return e
          })
          return { ...p, elements: nextEls as any }
        }
        if (mode === 'backward' && si > 0) {
          const a: any = sorted[si]
          const b: any = sorted[si - 1]
          const az = Number(a?.z) || 0
          const bz = Number(b?.z) || 0
          const nextEls = els.map((e: any) => {
            if (e.id === a.id) return { ...e, z: bz }
            if (e.id === b.id) return { ...e, z: az }
            return e
          })
          return { ...p, elements: nextEls as any }
        }
        return p
      })
      return { ...prev, pages: nextPages }
    })
  }

  const prevPage = () => {
    setSelectedId(null)
    setPageIndex((i) => clamp(i - 1, 0, Math.max(0, pages.length - 1)))
  }

  const nextPage = () => {
    setSelectedId(null)
    setPageIndex((i) => clamp(i + 1, 0, Math.max(0, pages.length - 1)))
  }

  const setOrientation = (o: PdfPageOrientation) => setDoc((prev) => ({ ...prev, orientation: o }))

  const base = useMemo(() => {
    const portrait = { w: 595, h: 842 }
    const landscape = { w: 842, h: 595 }
    return (doc.orientation || 'portrait') === 'landscape' ? landscape : portrait
  }, [doc.orientation])

  return (
    <div className="flex min-h-0 flex-1 gap-4 p-4">
      {/* Left: assets */}
      <div className="w-[300px] shrink-0 space-y-3 overflow-auto pr-1">
        <div className="rounded-xl border border-[var(--border-color)] bg-[var(--bg-primary)] p-3">
          <div className="flex items-center justify-between">
            <div className="text-sm font-semibold text-[var(--text-primary)]">素材</div>
            <div className="text-xs text-[var(--text-secondary)]">{images.length} 张</div>
          </div>
          <div className="mt-2 text-[11px] text-[var(--text-secondary)]">点击图片添加到页面；拖拽/缩放位置自定义排版。</div>
        </div>

        <div className="grid grid-cols-2 gap-2">
          {images.map((img) => (
            <button
              key={img.id}
              className="group overflow-hidden rounded-lg border border-[var(--border-color)] bg-[var(--bg-primary)] text-left hover:border-[var(--accent-color)]"
              onClick={() => addImageToPage(img)}
              title="添加到页面"
            >
              <div className="aspect-square bg-[var(--bg-secondary)]">
                <img src={img.previewSrc || img.src} alt={img.title || 'image'} className="h-full w-full object-cover" />
              </div>
              <div className="px-2 py-1.5 text-[11px] text-[var(--text-secondary)]">
                <div className="truncate">{img.title || '图片'}</div>
              </div>
            </button>
          ))}
        </div>
      </div>

      {/* Center: page */}
      <div className="min-w-0 flex-1 overflow-auto pr-1">
        {/* Toolbar */}
        <div className="sticky top-0 z-10 mb-3 flex flex-wrap items-center gap-2 rounded-xl border border-[var(--border-color)] bg-[var(--bg-primary)] p-2">
          <div className="inline-flex items-center gap-1 rounded-lg border border-[var(--border-color)] bg-[var(--bg-secondary)] px-1 py-1">
            <button
              className={cn(
                'rounded-md p-2 text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-tertiary)] hover:text-[var(--text-primary)]',
                pageIndex <= 0 ? 'opacity-50 hover:bg-transparent hover:text-[var(--text-secondary)]' : ''
              )}
              onClick={prevPage}
              disabled={pageIndex <= 0}
              title="上一页"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
            <div className="px-2 text-xs text-[var(--text-secondary)]">
              第 {pageIndex + 1} / {pages.length} 页
            </div>
            <button
              className={cn(
                'rounded-md p-2 text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-tertiary)] hover:text-[var(--text-primary)]',
                pageIndex >= pages.length - 1 ? 'opacity-50 hover:bg-transparent hover:text-[var(--text-secondary)]' : ''
              )}
              onClick={nextPage}
              disabled={pageIndex >= pages.length - 1}
              title="下一页"
            >
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>
          <button
            className="inline-flex items-center gap-2 rounded-lg border border-[var(--border-color)] px-3 py-2 text-xs font-medium hover:border-[var(--accent-color)]"
            onClick={addTextToPage}
            title="添加文本"
          >
            <TypeIcon className="h-4 w-4" />
            添加文本
          </button>
          <button
            className="inline-flex items-center gap-2 rounded-lg border border-[var(--border-color)] px-3 py-2 text-xs font-medium hover:border-[var(--accent-color)]"
            onClick={addPage}
            title="新增页面"
          >
            <Plus className="h-4 w-4" />
            新增页
          </button>
          <button
            className={cn(
              'inline-flex items-center gap-2 rounded-lg border px-3 py-2 text-xs font-medium',
              pages.length <= 1 ? 'border-[var(--border-color)] opacity-50' : 'border-[var(--border-color)] hover:border-red-500/60'
            )}
            onClick={deletePage}
            disabled={pages.length <= 1}
            title="删除当前页"
          >
            <Trash2 className="h-4 w-4" />
            删除页
          </button>
          <div className="h-5 w-px bg-[var(--border-color)]" />
          <button
            className="inline-flex items-center gap-2 rounded-lg border border-[var(--border-color)] px-3 py-2 text-xs font-medium hover:border-[var(--accent-color)]"
            onClick={() => setOrientation((doc.orientation || 'portrait') === 'portrait' ? 'landscape' : 'portrait')}
            title="切换方向"
          >
            <RotateCw className="h-4 w-4" />
            {doc.orientation === 'landscape' ? '横版' : '竖版'}
          </button>
          <button
            className={cn(
              'inline-flex items-center gap-2 rounded-lg border px-3 py-2 text-xs font-medium',
              snapEnabled ? 'border-[var(--accent-color)] text-[var(--accent-color)]' : 'border-[var(--border-color)]'
            )}
            onClick={() => setSnapEnabled((v) => !v)}
            title="吸附网格"
          >
            <Grid3x3 className="h-4 w-4" />
            吸附
          </button>
          <div className="h-5 w-px bg-[var(--border-color)]" />
          <div className="flex items-center gap-1 rounded-lg border border-[var(--border-color)] bg-[var(--bg-secondary)] px-2 py-1.5 text-xs">
            <span className="text-[var(--text-secondary)]">缩放</span>
            {[0.5, 0.75, 1, 1.25, 1.5].map((z) => (
              <button
                key={z}
                className={cn(
                  'rounded-md px-2 py-1',
                  zoom === z ? 'bg-[var(--bg-tertiary)] text-[var(--text-primary)]' : 'text-[var(--text-secondary)]'
                )}
                onClick={() => setZoom(z)}
              >
                {Math.round(z * 100)}%
              </button>
            ))}
          </div>
          <div className="h-5 w-px bg-[var(--border-color)]" />
          <button
            className={cn(
              'inline-flex items-center gap-2 rounded-lg px-3 py-2 text-xs font-medium text-white',
              exporting ? 'bg-[var(--bg-tertiary)] opacity-70' : 'bg-[var(--accent-color)]'
            )}
            onClick={() => onExport(doc)}
            disabled={exporting}
            title="导出 PDF"
          >
            <FileDown className="h-4 w-4" />
            导出 PDF
          </button>
          <div className="ml-auto text-xs text-[var(--text-secondary)]">提示：Delete/Backspace 删除选中元素</div>
        </div>

        {/* progress + errors */}
        {exporting ? (
          <div className="mb-3 rounded-xl border border-[var(--border-color)] bg-[var(--bg-primary)] p-3 text-sm text-[var(--text-secondary)]">
            正在生成：{progress.total > 0 ? `${progress.done}/${progress.total}` : '...'}{' '}
            <span className="text-[11px] opacity-70">{progress.stage}</span>
          </div>
        ) : null}
        {error ? (
          <div className="mb-3 rounded-xl border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-400">{error}</div>
        ) : null}
        {failedCount > 0 ? (
          <div className="mb-3 rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 text-sm text-amber-300">
            有 {failedCount} 张图片加载失败（已用占位符填充，PDF 仍可导出）。
          </div>
        ) : null}

        <div className="flex justify-center pb-6">
          <div className="rounded-xl border border-[var(--border-color)] bg-[var(--bg-secondary)] p-3">
            <div
              ref={pageRef}
              className="relative overflow-hidden bg-white shadow"
              style={{ width: base.w * zoom, height: base.h * zoom }}
              onMouseDown={() => setSelectedId(null)}
            >
              {/* simple grid */}
              {snapEnabled ? (
                <div
                  className="pointer-events-none absolute inset-0 opacity-[0.06]"
                  style={{
                    backgroundImage:
                      'linear-gradient(to right, #111827 1px, transparent 1px), linear-gradient(to bottom, #111827 1px, transparent 1px)',
                    backgroundSize: `${Math.max(8, Math.round(24 * zoom))}px ${Math.max(8, Math.round(24 * zoom))}px`,
                  }}
                />
              ) : null}

              {elements.map((el) => (
                <PdfElementView
                  key={el.id}
                  element={el as any}
                  selected={el.id === selectedId}
                  pageRef={pageRef}
                  pageBase={{ w: base.w * zoom, h: base.h * zoom }}
                  zoom={zoom}
                  snapEnabled={snapEnabled}
                  onSelect={(id) => setSelectedId(id)}
                  onUpdate={updateElement}
                />
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Right: properties */}
      <div className="w-[320px] shrink-0 space-y-3 overflow-auto pr-1">
        <div className="rounded-xl border border-[var(--border-color)] bg-[var(--bg-primary)] p-3">
          <div className="flex items-center justify-between">
            <div className="text-sm font-semibold text-[var(--text-primary)]">属性</div>
            {selected ? (
              <div className="flex items-center gap-2">
                <button
                  className="rounded-lg border border-[var(--border-color)] px-2 py-1 text-xs text-[var(--text-secondary)] hover:border-[var(--accent-color)]/60 hover:text-[var(--text-primary)]"
                  onClick={duplicateSelected}
                  title="复制选中元素"
                >
                  <Copy className="inline h-4 w-4" /> 复制
                </button>
                <button
                  className="rounded-lg border border-[var(--border-color)] px-2 py-1 text-xs text-[var(--text-secondary)] hover:border-red-500/60 hover:text-red-400"
                  onClick={() => {
                    const id = selected.id
                    setDoc((prev) => {
                      const nextPages = (prev.pages || []).map((p, idx) => {
                        if (idx !== pageIndex) return p
                        const els = Array.isArray(p.elements) ? p.elements : []
                        return { ...p, elements: els.filter((e) => e.id !== id) }
                      })
                      return { ...prev, pages: nextPages }
                    })
                    setSelectedId(null)
                  }}
                >
                  <Trash2 className="inline h-4 w-4" /> 删除
                </button>
              </div>
            ) : null}
          </div>
          {!selected ? (
            <div className="mt-2 text-[11px] text-[var(--text-secondary)]">选择页面中的元素后，可在这里编辑文字/样式。</div>
          ) : null}
        </div>

        {selected && selected.kind === 'image' ? (
          <div className="rounded-xl border border-[var(--border-color)] bg-[var(--bg-primary)] p-3">
            <div className="text-sm font-semibold text-[var(--text-primary)]">图片</div>
            <div className="mt-3 space-y-2">
              <div className="text-xs text-[var(--text-secondary)]">适配</div>
              <div className="grid grid-cols-2 gap-2">
                {(['cover', 'contain'] as const).map((f) => (
                  <button
                    key={f}
                    className={cn(
                      'rounded-lg border px-3 py-2 text-xs font-medium transition-colors',
                      ((selected as any).fit || 'cover') === f
                        ? 'border-[var(--accent-color)] bg-[rgb(var(--accent-rgb)/0.10)] text-[var(--accent-color)]'
                        : 'border-[var(--border-color)] text-[var(--text-secondary)] hover:border-[var(--accent-color)]'
                    )}
                    onClick={() => updateElement(selected.id, { fit: f })}
                  >
                    {f === 'cover' ? '铺满' : '包含'}
                  </button>
                ))}
              </div>
            </div>
          </div>
        ) : null}

        {selected && selected.kind === 'text' ? (
          <div className="rounded-xl border border-[var(--border-color)] bg-[var(--bg-primary)] p-3">
            <div className="text-sm font-semibold text-[var(--text-primary)]">文字</div>
            <div className="mt-3 space-y-3">
              <div>
                <div className="text-xs text-[var(--text-secondary)]">内容</div>
                <textarea
                  value={String((selected as any).text || '')}
                  onChange={(e) => updateElement(selected.id, { text: e.target.value })}
                  className="mt-1 h-28 w-full resize-none rounded-lg border border-[var(--border-color)] bg-[var(--bg-secondary)] px-3 py-2 text-sm text-[var(--text-primary)] focus:border-[var(--accent-color)] focus:outline-none"
                  placeholder="输入文字…"
                />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <div className="text-xs text-[var(--text-secondary)]">字号</div>
                  <input
                    type="number"
                    min={10}
                    max={96}
                    value={Number((selected as any).fontSize) || 24}
                    onChange={(e) => updateElement(selected.id, { fontSize: Number(e.target.value) || 24 })}
                    className="mt-1 w-full rounded-lg border border-[var(--border-color)] bg-[var(--bg-secondary)] px-3 py-2 text-sm"
                  />
                </div>
                <div>
                  <div className="text-xs text-[var(--text-secondary)]">颜色</div>
                  <input
                    value={String((selected as any).color || '#111827')}
                    onChange={(e) => updateElement(selected.id, { color: e.target.value })}
                    className="mt-1 w-full rounded-lg border border-[var(--border-color)] bg-[var(--bg-secondary)] px-3 py-2 text-sm"
                    placeholder="#111827"
                  />
                </div>
              </div>
              <div className="grid grid-cols-3 gap-2">
                {(['left', 'center', 'right'] as PdfTextAlign[]).map((a) => (
                  <button
                    key={a}
                    className={cn(
                      'rounded-lg border px-3 py-2 text-xs font-medium transition-colors',
                      (((selected as any).align as PdfTextAlign) || 'left') === a
                        ? 'border-[var(--accent-color)] bg-[rgb(var(--accent-rgb)/0.10)] text-[var(--accent-color)]'
                        : 'border-[var(--border-color)] text-[var(--text-secondary)] hover:border-[var(--accent-color)]'
                    )}
                    onClick={() => updateElement(selected.id, { align: a })}
                  >
                    {a === 'left' ? '左' : a === 'center' ? '中' : '右'}
                  </button>
                ))}
              </div>
              <div className="grid grid-cols-2 gap-2">
                <button
                  className={cn(
                    'rounded-lg border px-3 py-2 text-xs font-medium transition-colors',
                    (selected as any).bold
                      ? 'border-[var(--accent-color)] bg-[rgb(var(--accent-rgb)/0.10)] text-[var(--accent-color)]'
                      : 'border-[var(--border-color)] text-[var(--text-secondary)] hover:border-[var(--accent-color)]'
                  )}
                  onClick={() => updateElement(selected.id, { bold: !(selected as any).bold })}
                >
                  加粗
                </button>
                <div>
                  <div className="text-xs text-[var(--text-secondary)]">行高</div>
                  <input
                    type="number"
                    step={0.1}
                    min={1.0}
                    max={2.0}
                    value={Number((selected as any).lineHeight) || 1.2}
                    onChange={(e) => updateElement(selected.id, { lineHeight: Number(e.target.value) || 1.2 })}
                    className="mt-1 w-full rounded-lg border border-[var(--border-color)] bg-[var(--bg-secondary)] px-3 py-2 text-sm"
                  />
                </div>
              </div>
            </div>
          </div>
        ) : null}

        {selected ? (
          <div className="rounded-xl border border-[var(--border-color)] bg-[var(--bg-primary)] p-3">
            <div className="flex items-center gap-2 text-sm font-semibold text-[var(--text-primary)]">
              <Layers className="h-4 w-4" />
              图层
            </div>
            <div className="mt-3 grid grid-cols-2 gap-2">
              <button
                className="rounded-lg border border-[var(--border-color)] px-3 py-2 text-xs font-medium hover:border-[var(--accent-color)]"
                onClick={() => applyZ('front')}
                title="置顶"
              >
                置顶
              </button>
              <button
                className="rounded-lg border border-[var(--border-color)] px-3 py-2 text-xs font-medium hover:border-[var(--accent-color)]"
                onClick={() => applyZ('back')}
                title="置底"
              >
                置底
              </button>
              <button
                className="rounded-lg border border-[var(--border-color)] px-3 py-2 text-xs font-medium hover:border-[var(--accent-color)]"
                onClick={() => applyZ('forward')}
                title="上移一层"
              >
                上移
              </button>
              <button
                className="rounded-lg border border-[var(--border-color)] px-3 py-2 text-xs font-medium hover:border-[var(--accent-color)]"
                onClick={() => applyZ('backward')}
                title="下移一层"
              >
                下移
              </button>
            </div>
            <div className="mt-2 text-[11px] text-[var(--text-secondary)]">Delete 可删除选中元素。</div>
          </div>
        ) : null}
      </div>
    </div>
  )
}

