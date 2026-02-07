import { PDFDocument } from 'pdf-lib'
import { fetchUrlAsBytes } from '@/lib/download'

export type HistoryPdfGridPreset = '3x3' | '2x2' | '4x4'

export type HistoryPdfExportItem = {
  id: string
  src: string
  title: string
  caption?: string
}

export type HistoryPdfProgress = {
  done: number
  total: number
  stage: string
}

export type PdfPageOrientation = 'portrait' | 'landscape'

export type PdfTextAlign = 'left' | 'center' | 'right'

export type PdfImageFit = 'cover' | 'contain'

export type PdfDocDraft = {
  pageSize?: 'A4'
  orientation?: PdfPageOrientation
  pages: PdfPageDraft[]
}

export type PdfPageDraft = {
  id: string
  elements: PdfElementDraft[]
}

export type PdfElementDraft = PdfImageElementDraft | PdfTextElementDraft

export type PdfBaseElementDraft = {
  id: string
  x: number // 0..1
  y: number // 0..1
  w: number // 0..1
  h: number // 0..1
  z: number
}

export type PdfImageElementDraft = PdfBaseElementDraft & {
  kind: 'image'
  src: string
  previewSrc?: string
  fallbackSrc?: string
  fit?: PdfImageFit
}

export type PdfTextElementDraft = PdfBaseElementDraft & {
  kind: 'text'
  text: string
  fontSize?: number // in px at base A4 point size (595x842)
  color?: string // '#RRGGBB'
  align?: PdfTextAlign
  bold?: boolean
  lineHeight?: number // multiplier, e.g. 1.2
}

const presetToGrid = (preset: HistoryPdfGridPreset) => {
  if (preset === '2x2') return { cols: 2, rows: 2 }
  if (preset === '4x4') return { cols: 4, rows: 4 }
  return { cols: 3, rows: 3 }
}

const chunk = <T,>(arr: T[], size: number): T[][] => {
  const out: T[][] = []
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size))
  return out
}

const safeText = (v: unknown) => (typeof v === 'string' ? v.trim() : v == null ? '' : String(v).trim())

const clamp = (n: number, min: number, max: number) => Math.max(min, Math.min(max, n))

async function loadImageToCanvas(
  ctx: CanvasRenderingContext2D,
  opts: {
    x: number
    y: number
    w: number
    h: number
    src: string
    fit?: PdfImageFit
  }
): Promise<boolean> {
  const url = String(opts.src || '').trim()
  if (!url) return false

  try {
    const bytes = await fetchUrlAsBytes(url)
    const inferMime = (u: string) => {
      const s = String(u || '').trim()
      if (s.startsWith('data:')) {
        const m = s.slice(5, 64)
        const mime = m.split(';')[0]
        return mime || ''
      }
      try {
        const uu = new URL(s, 'http://localhost')
        const p = uu.pathname || ''
        const ext = p.split('.').pop()?.toLowerCase() || ''
        if (ext === 'jpg' || ext === 'jpeg') return 'image/jpeg'
        if (ext === 'png') return 'image/png'
        if (ext === 'webp') return 'image/webp'
        if (ext === 'gif') return 'image/gif'
        if (ext === 'avif') return 'image/avif'
        if (ext === 'svg') return 'image/svg+xml'
      } catch {
        // ignore
      }
      return ''
    }
    const mime = inferMime(url)
    const blob = mime ? new Blob([bytes.slice().buffer], { type: mime }) : new Blob([bytes.slice().buffer])
    const objectUrl = URL.createObjectURL(blob)
    try {
      const img = new Image()
      img.decoding = 'async'
      img.loading = 'eager'
      await new Promise<void>((resolve, reject) => {
        img.onload = () => resolve()
        img.onerror = () => reject(new Error('image load failed'))
        img.src = objectUrl
      })

      const fit: PdfImageFit = (opts.fit as any) || 'cover'
      const iw = img.naturalWidth || img.width || 1
      const ih = img.naturalHeight || img.height || 1
      const r = fit === 'contain' ? Math.min(opts.w / iw, opts.h / ih) : Math.max(opts.w / iw, opts.h / ih)
      const dw = iw * r
      const dh = ih * r
      const dx = opts.x + (opts.w - dw) / 2
      const dy = opts.y + (opts.h - dh) / 2

      ctx.save()
      ctx.beginPath()
      ctx.rect(opts.x, opts.y, opts.w, opts.h)
      ctx.clip()
      ctx.drawImage(img, dx, dy, dw, dh)
      ctx.restore()
      return true
    } finally {
      URL.revokeObjectURL(objectUrl)
    }
  } catch {
    return false
  }
}

async function canvasToPngBytes(canvas: HTMLCanvasElement): Promise<Uint8Array> {
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob((b) => resolve(b), 'image/png'))
  if (!blob) throw new Error('canvas toBlob failed')
  const ab = await blob.arrayBuffer()
  return new Uint8Array(ab)
}

export async function exportHistoryImagesToPdf(opts: {
  items: HistoryPdfExportItem[]
  title?: string
  note?: string
  preset?: HistoryPdfGridPreset
  onProgress?: (p: HistoryPdfProgress) => void
}): Promise<{ pdfBytes: Uint8Array; failed: Array<{ id: string; title: string; reason: string }> }> {
  const items = Array.isArray(opts.items) ? opts.items : []
  const preset: HistoryPdfGridPreset = (opts.preset as any) || '3x3'
  const { cols, rows } = presetToGrid(preset)
  const perPage = cols * rows

  const title = safeText(opts.title) || '素材导出'
  const note = safeText(opts.note)
  const pages = chunk(items, perPage)

  const pdf = await PDFDocument.create()
  const failed: Array<{ id: string; title: string; reason: string }> = []

  // A4 @ ~150dpi canvas, then embed to A4 page in points
  const CANVAS_W = 1240
  const CANVAS_H = 1754
  const PAGE_W = 595.28
  const PAGE_H = 841.89

  const margin = 56
  const headerH = 150
  const gap = 18
  const captionH = 28

  const total = items.length
  let done = 0

  for (let pageIndex = 0; pageIndex < pages.length; pageIndex++) {
    const pageItems = pages[pageIndex]
    opts.onProgress?.({ done, total, stage: `render page ${pageIndex + 1}/${pages.length}` })

    const canvas = document.createElement('canvas')
    canvas.width = CANVAS_W
    canvas.height = CANVAS_H
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('canvas context missing')

    // background
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, CANVAS_W, CANVAS_H)

    // header
    ctx.fillStyle = '#111827'
    ctx.font = 'bold 40px system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial'
    ctx.fillText(title, margin, 70)

    ctx.fillStyle = '#6b7280'
    ctx.font = '24px system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial'
    ctx.fillText(
      `${new Date().toLocaleString()} · ${preset} · ${items.length} items`,
      margin,
      110
    )
    if (note) {
      ctx.fillStyle = '#374151'
      ctx.font = '22px system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial'
      const clipped = note.length > 80 ? `${note.slice(0, 80)}…` : note
      ctx.fillText(clipped, margin, 145)
    }

    // grid
    const gridX = margin
    const gridY = headerH
    const gridW = CANVAS_W - margin * 2
    const gridH = CANVAS_H - gridY - margin

    const cellW = (gridW - gap * (cols - 1)) / cols
    const cellH = (gridH - gap * (rows - 1)) / rows

    for (let i = 0; i < pageItems.length; i++) {
      const it = pageItems[i]
      const r = Math.floor(i / cols)
      const c = i % cols

      const x = gridX + c * (cellW + gap)
      const y = gridY + r * (cellH + gap)
      const imgW = cellW
      const imgH = cellH - captionH

      // card bg
      ctx.fillStyle = '#f3f4f6'
      ctx.fillRect(x, y, cellW, cellH)

      // image
      const ok = await loadImageToCanvas(ctx, { x, y, w: imgW, h: imgH, src: it.src })
      if (!ok) {
        failed.push({ id: it.id, title: it.title, reason: 'fetch/load failed' })
        ctx.fillStyle = '#9ca3af'
        ctx.font = '18px system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial'
        ctx.fillText('image load failed', x + 12, y + 28)
      }

      // caption bar
      const caption = safeText(it.caption) || safeText(it.title)
      ctx.fillStyle = '#111827'
      ctx.font = '20px system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial'
      const maxChars = clamp(Math.floor(imgW / 12), 8, 60)
      const cap = caption.length > maxChars ? `${caption.slice(0, maxChars)}…` : caption
      ctx.fillText(cap, x + 10, y + imgH + 22)

      done += 1
      opts.onProgress?.({ done, total, stage: 'render item' })
    }

    const pngBytes = await canvasToPngBytes(canvas)
    const img = await pdf.embedPng(pngBytes)
    const p = pdf.addPage([PAGE_W, PAGE_H])
    p.drawImage(img, { x: 0, y: 0, width: PAGE_W, height: PAGE_H })
  }

  const pdfBytes = await pdf.save()
  return { pdfBytes: new Uint8Array(pdfBytes), failed }
}

const A4_PORTRAIT = { w: 595.28, h: 841.89 }
const A4_LANDSCAPE = { w: 841.89, h: 595.28 }
const CANVAS_PORTRAIT = { w: 1240, h: 1754 } // ~150dpi
const CANVAS_LANDSCAPE = { w: 1754, h: 1240 }

const clamp01 = (n: number) => (Number.isFinite(n) ? Math.max(0, Math.min(1, n)) : 0)

const normalizeColor = (c: string) => {
  const s = String(c || '').trim()
  if (!s) return '#111827'
  if (/^#([0-9a-f]{3})$/i.test(s) || /^#([0-9a-f]{6})$/i.test(s)) return s
  return '#111827'
}

const drawPlaceholder = (ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, label: string) => {
  ctx.save()
  ctx.fillStyle = '#f3f4f6'
  ctx.fillRect(x, y, w, h)
  ctx.strokeStyle = '#d1d5db'
  ctx.lineWidth = 2
  ctx.strokeRect(x + 1, y + 1, Math.max(0, w - 2), Math.max(0, h - 2))
  ctx.fillStyle = '#9ca3af'
  ctx.font = '18px system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial'
  ctx.textBaseline = 'top'
  ctx.fillText(label, x + 10, y + 10)
  ctx.restore()
}

const wrapTextLines = (ctx: CanvasRenderingContext2D, text: string, maxWidth: number) => {
  const t = String(text || '')
  const lines: string[] = []
  const paras = t.split('\n')
  for (let p = 0; p < paras.length; p++) {
    const para = paras[p]
    let line = ''
    for (const ch of para) {
      const test = line + ch
      if (line && ctx.measureText(test).width > maxWidth) {
        lines.push(line)
        line = ch
      } else {
        line = test
      }
    }
    if (line) lines.push(line)
    if (p !== paras.length - 1) lines.push('') // newline gap
  }
  return lines
}

export async function exportPdfFromLayout(opts: {
  doc: PdfDocDraft
  onProgress?: (p: HistoryPdfProgress) => void
}): Promise<{ pdfBytes: Uint8Array; failed: Array<{ id: string; title: string; reason: string }> }> {
  const doc = opts.doc
  const pages = Array.isArray(doc?.pages) ? doc.pages : []
  const orientation: PdfPageOrientation = (doc?.orientation as any) || 'portrait'
  const pageSize = orientation === 'landscape' ? A4_LANDSCAPE : A4_PORTRAIT
  const canvasSize = orientation === 'landscape' ? CANVAS_LANDSCAPE : CANVAS_PORTRAIT
  const scale = canvasSize.w / pageSize.w

  const pdf = await PDFDocument.create()
  const failed: Array<{ id: string; title: string; reason: string }> = []

  const total = pages.reduce((acc, p) => acc + (Array.isArray(p.elements) ? p.elements.length : 0), 0)
  let done = 0

  for (let pageIndex = 0; pageIndex < pages.length; pageIndex++) {
    const pageDraft = pages[pageIndex]
    const elements = Array.isArray(pageDraft.elements) ? pageDraft.elements.slice() : []
    elements.sort((a: any, b: any) => (Number(a?.z) || 0) - (Number(b?.z) || 0))

    opts.onProgress?.({ done, total, stage: `render page ${pageIndex + 1}/${pages.length}` })

    const canvas = document.createElement('canvas')
    canvas.width = canvasSize.w
    canvas.height = canvasSize.h
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('canvas context missing')

    // background
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, canvasSize.w, canvasSize.h)

    for (const el of elements as any[]) {
      const x = clamp01(Number(el?.x)) * canvasSize.w
      const y = clamp01(Number(el?.y)) * canvasSize.h
      const w = clamp01(Number(el?.w)) * canvasSize.w
      const h = clamp01(Number(el?.h)) * canvasSize.h

      if (!w || !h) {
        done += 1
        opts.onProgress?.({ done, total, stage: 'skip empty element' })
        continue
      }

      if (el?.kind === 'image') {
        const srcs = [
          String(el?.src || '').trim(),
          String((el as any)?.fallbackSrc || '').trim(),
          String((el as any)?.previewSrc || '').trim(),
        ].filter(Boolean)
        let ok = false
        for (const src of srcs) {
          ok = await loadImageToCanvas(ctx, { x, y, w, h, src, fit: (el?.fit as any) || 'cover' })
          if (ok) break
        }
        if (!ok) {
          failed.push({ id: String(el?.id || ''), title: 'image', reason: 'fetch/load failed' })
          drawPlaceholder(ctx, x, y, w, h, 'image load failed')
        }
      } else if (el?.kind === 'text') {
        const text = String(el?.text || '')
        const fontSize = Math.max(8, Number(el?.fontSize) || 24) * scale
        const lineHeight = Math.max(1.0, Number(el?.lineHeight) || 1.2)
        const bold = !!el?.bold
        const align: PdfTextAlign = (el?.align as any) || 'left'
        const color = normalizeColor(String(el?.color || ''))
        const pad = Math.max(8, Math.round(fontSize * 0.35))

        ctx.save()
        ctx.beginPath()
        ctx.rect(x, y, w, h)
        ctx.clip()
        ctx.fillStyle = color
        ctx.font = `${bold ? 'bold ' : ''}${Math.round(fontSize)}px system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial`
        ctx.textBaseline = 'top'
        ctx.textAlign = align

        const maxWidth = Math.max(1, w - pad * 2)
        const lines = wrapTextLines(ctx, text, maxWidth)
        const lh = Math.round(fontSize * lineHeight)

        const xText = align === 'left' ? x + pad : align === 'right' ? x + w - pad : x + w * 0.5
        let yText = y + pad
        for (const ln of lines) {
          if (yText + lh > y + h - pad) break
          ctx.fillText(ln, xText, yText)
          yText += lh
        }
        ctx.restore()
      }

      done += 1
      opts.onProgress?.({ done, total, stage: 'render element' })
    }

    const pngBytes = await canvasToPngBytes(canvas)
    const img = await pdf.embedPng(pngBytes)
    const p = pdf.addPage([pageSize.w, pageSize.h])
    p.drawImage(img, { x: 0, y: 0, width: pageSize.w, height: pageSize.h })
  }

  const pdfBytes = await pdf.save()
  return { pdfBytes: new Uint8Array(pdfBytes), failed }
}

