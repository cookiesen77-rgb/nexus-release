/**
 * History Export PDF Modal | 历史素材导出 PDF
 * 自由排版导出 PDF：用户自行布局 + 可编辑文字
 */

import React, { useMemo, useState } from 'react'
import { X } from 'lucide-react'
import { saveBytesAsFile } from '@/lib/download'
import { exportPdfFromLayout, type PdfDocDraft } from '@/lib/export/historyPdf'
import PdfComposer, { type PdfComposerImage } from '@/components/canvas/pdf/PdfComposer'

export type ExportPdfImageItem = {
  id: string
  /** 用于真正导出（fetch bytes） */
  src: string
  /** 用于界面预览（可用缩略图/本地缓存） */
  previewSrc?: string
  title?: string
}

interface Props {
  open: boolean
  items: ExportPdfImageItem[]
  onClose: () => void
}

export default function HistoryExportPdfModal({ open, items, onClose }: Props) {
  const normalizedItems = useMemo(() => {
    const arr = Array.isArray(items) ? items : []
    return arr.filter((it) => !!it && typeof it.id === 'string' && it.id && typeof it.src === 'string' && it.src)
  }, [items])

  const [exporting, setExporting] = useState(false)
  const [progress, setProgress] = useState<{ done: number; total: number; stage: string }>({ done: 0, total: 0, stage: '' })
  const [exportError, setExportError] = useState<string>('')
  const [failedCount, setFailedCount] = useState(0)

  React.useEffect(() => {
    if (!open) return
    setExportError('')
    setFailedCount(0)
    setProgress({ done: 0, total: 0, stage: '' })
  }, [open, normalizedItems])

  if (!open) return null

  const total = normalizedItems.length
  const images: PdfComposerImage[] = normalizedItems.map((it) => ({
    id: it.id,
    src: it.src,
    previewSrc: it.previewSrc || it.src,
    title: it.title,
  }))

  const handleExport = async (doc: PdfDocDraft) => {
    if (exporting) return
    setExporting(true)
    setExportError('')
    setFailedCount(0)
    setProgress({ done: 0, total: 0, stage: 'start' })
    try {
      const { pdfBytes, failed } = await exportPdfFromLayout({
        doc,
        onProgress: (p) => setProgress(p),
      })
      setFailedCount(failed.length)
      await saveBytesAsFile({ data: pdfBytes, filename: 'export.pdf', mimeType: 'application/pdf' })
      onClose()
    } catch (e: any) {
      setExportError(e?.message || String(e) || '导出失败')
    } finally {
      setExporting(false)
    }
  }

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/50 backdrop-blur-sm" onClick={onClose}>
      <div
        className="flex h-[min(92vh,980px)] w-[min(1480px,98vw)] flex-col overflow-hidden rounded-2xl border border-[var(--border-color)] bg-[var(--bg-secondary)] shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-[var(--border-color)] px-5 py-4">
          <div className="flex items-center gap-3">
            <div className="text-lg font-semibold text-[var(--text-primary)]">素材导出</div>
            <div className="text-xs text-[var(--text-secondary)]">已选 {total} 张</div>
          </div>
          <button
            onClick={onClose}
            className="rounded-full p-1 text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-primary)] hover:text-[var(--text-primary)]"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <PdfComposer
          images={images}
          exporting={exporting}
          progress={progress}
          failedCount={failedCount}
          error={exportError}
          onExport={handleExport}
        />
      </div>
    </div>
  )
}

