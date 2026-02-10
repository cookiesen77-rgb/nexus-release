import React, { useCallback, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Download, Loader2, X } from 'lucide-react'
import { getMedia } from '@/lib/mediaStorage'
import type { ShortDramaDraftV2, ShortDramaMediaSlot, ShortDramaMediaVariant } from '@/lib/shortDrama/types'

interface Props {
  open: boolean
  onClose: () => void
  draft: ShortDramaDraftV2
}

type ExportCategory =
  | 'characterSheets'
  | 'characterRefs'
  | 'sceneRefs'
  | 'startFrames'
  | 'endFrames'
  | 'videos'

const CATEGORIES: { key: ExportCategory; label: string; description: string }[] = [
  { key: 'characterSheets', label: '角色设定图', description: '每个角色的主设定图' },
  { key: 'characterRefs', label: '角色参考图', description: '每个角色的参考图片' },
  { key: 'sceneRefs', label: '场景参考图', description: '每个场景的参考图片' },
  { key: 'startFrames', label: '镜头首帧', description: '每个镜头的首帧画面' },
  { key: 'endFrames', label: '镜头尾帧', description: '每个镜头的尾帧画面' },
  { key: 'videos', label: '镜头视频', description: '每个镜头的生成视频' },
]

const isHttpUrl = (s: string) => /^https?:\/\//i.test(s)

const getSelectedVariant = (slot: ShortDramaMediaSlot | undefined): ShortDramaMediaVariant | null => {
  if (!slot) return null
  const variants = slot.variants || []
  if (slot.selectedVariantId) {
    const v = variants.find((v) => v.id === slot.selectedVariantId)
    if (v?.status === 'success') return v
  }
  return variants.find((v) => v.status === 'success') || null
}

const resolveVariantUrl = async (variant: ShortDramaMediaVariant | null): Promise<string> => {
  if (!variant) return ''
  const s = String(variant.sourceUrl || '').trim()
  if (s && isHttpUrl(s)) return s
  if (variant.mediaId) {
    try {
      const rec = await getMedia(variant.mediaId)
      const dataUrl = String(rec?.data || '').trim()
      if (dataUrl) return dataUrl
    } catch { /* skip */ }
  }
  const d = String(variant.displayUrl || '').trim()
  if (d) return d
  return ''
}

const guessExt = (url: string, kind: 'image' | 'video') => {
  const m = url.match(/\.(png|jpg|jpeg|gif|webp|mp4|webm|mov)(\?|$)/i)
  if (m) return m[1].toLowerCase()
  if (url.startsWith('data:image/png')) return 'png'
  if (url.startsWith('data:image/jpeg') || url.startsWith('data:image/jpg')) return 'jpg'
  if (url.startsWith('data:image/webp')) return 'webp'
  if (url.startsWith('data:video/mp4')) return 'mp4'
  return kind === 'video' ? 'mp4' : 'png'
}

const sanitize = (s: string) => String(s || '').replace(/[<>:"/\\|?*\x00-\x1f]+/g, '_').trim() || '_'

export default function ShortDramaExportModal({ open, onClose, draft }: Props) {
  const [selected, setSelected] = useState<Set<ExportCategory>>(
    new Set(['characterSheets', 'startFrames', 'endFrames', 'videos'])
  )
  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState('')

  const toggle = (key: ExportCategory) => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  const selectAll = () => setSelected(new Set(CATEGORIES.map((c) => c.key)))
  const selectNone = () => setSelected(new Set())

  const countAvailable = useCallback(
    (key: ExportCategory): number => {
      switch (key) {
        case 'characterSheets':
          return draft.characters.filter((c) => getSelectedVariant(c.sheet)).length
        case 'characterRefs':
          return draft.characters.reduce((n, c) => n + (c.refs || []).filter((r) => getSelectedVariant(r)).length, 0)
        case 'sceneRefs': {
          let n = draft.scenes.filter((s) => getSelectedVariant(s.ref)).length
          n += draft.scenes.reduce((acc, s) => acc + (s.refs || []).filter((r) => getSelectedVariant(r)).length, 0)
          return n
        }
        case 'startFrames':
          return draft.shots.filter((s) => getSelectedVariant(s.frames.start.slot)).length
        case 'endFrames':
          return draft.shots.filter((s) => getSelectedVariant(s.frames.end.slot)).length
        case 'videos':
          return draft.shots.filter((s) => getSelectedVariant(s.video)).length
        default:
          return 0
      }
    },
    [draft]
  )

  const runExport = useCallback(async () => {
    setBusy(true)
    setProgress('正在收集素材…')

    type FileEntry = { url: string; filename: string }
    const files: FileEntry[] = []

    const pushVariant = async (
      slot: ShortDramaMediaSlot | undefined,
      folder: string,
      name: string,
      kind: 'image' | 'video'
    ) => {
      const v = getSelectedVariant(slot)
      const url = await resolveVariantUrl(v)
      if (!url) return
      const ext = guessExt(url, kind)
      files.push({ url, filename: `${folder}/${sanitize(name)}.${ext}` })
    }

    try {
      if (selected.has('characterSheets')) {
        setProgress('收集角色设定图…')
        for (const c of draft.characters) {
          await pushVariant(c.sheet, '角色设定图', c.name, 'image')
        }
      }

      if (selected.has('characterRefs')) {
        setProgress('收集角色参考图…')
        for (const c of draft.characters) {
          for (let i = 0; i < (c.refs || []).length; i++) {
            await pushVariant(c.refs[i], '角色参考图', `${c.name}_参考${i + 1}`, 'image')
          }
        }
      }

      if (selected.has('sceneRefs')) {
        setProgress('收集场景参考图…')
        for (const s of draft.scenes) {
          await pushVariant(s.ref, '场景参考图', s.name, 'image')
          for (let i = 0; i < (s.refs || []).length; i++) {
            await pushVariant((s.refs || [])[i], '场景参考图', `${s.name}_参考${i + 1}`, 'image')
          }
        }
      }

      if (selected.has('startFrames')) {
        setProgress('收集镜头首帧…')
        for (let i = 0; i < draft.shots.length; i++) {
          const sh = draft.shots[i]
          await pushVariant(sh.frames.start.slot, '首帧', `${String(i + 1).padStart(3, '0')}_${sh.title}`, 'image')
        }
      }

      if (selected.has('endFrames')) {
        setProgress('收集镜头尾帧…')
        for (let i = 0; i < draft.shots.length; i++) {
          const sh = draft.shots[i]
          await pushVariant(sh.frames.end.slot, '尾帧', `${String(i + 1).padStart(3, '0')}_${sh.title}`, 'image')
        }
      }

      if (selected.has('videos')) {
        setProgress('收集镜头视频…')
        for (let i = 0; i < draft.shots.length; i++) {
          const sh = draft.shots[i]
          await pushVariant(sh.video, '视频', `${String(i + 1).padStart(3, '0')}_${sh.title}`, 'video')
        }
      }

      if (files.length === 0) {
        window.$message?.warning?.('没有可导出的素材')
        return
      }

      setProgress(`正在打包 ${files.length} 个文件…`)
      const { downloadBatchAsZip } = await import('@/lib/download')
      const zipName = `${sanitize(draft.title || '短剧素材')}.zip`
      await downloadBatchAsZip(files, zipName)
      window.$message?.success?.(`已导出 ${files.length} 个文件`)
      onClose()
    } catch (err: any) {
      window.$message?.error?.(err?.message || '导出失败')
    } finally {
      setBusy(false)
      setProgress('')
    }
  }, [draft, selected, onClose])

  if (!open) return null

  const totalSelected = Array.from(selected).reduce((n, k) => n + countAvailable(k), 0)

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/50" onClick={onClose}>
      <div
        className="w-full max-w-md rounded-2xl border border-[var(--border-color)] bg-[var(--bg-primary)] p-6 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-base font-semibold text-[var(--text-primary)]">批量导出素材</h3>
          <button onClick={onClose} className="rounded-lg p-1 hover:bg-[var(--bg-tertiary)]">
            <X className="h-4 w-4 text-[var(--text-secondary)]" />
          </button>
        </div>

        <div className="mb-3 flex items-center gap-2">
          <button onClick={selectAll} className="text-xs text-[var(--accent-color)] hover:underline">全选</button>
          <span className="text-xs text-[var(--text-secondary)]">|</span>
          <button onClick={selectNone} className="text-xs text-[var(--accent-color)] hover:underline">全不选</button>
        </div>

        <div className="space-y-2">
          {CATEGORIES.map((cat) => {
            const count = countAvailable(cat.key)
            return (
              <label
                key={cat.key}
                className="flex cursor-pointer items-center gap-3 rounded-lg border border-[var(--border-color)] px-3 py-2.5 transition-colors hover:bg-[var(--bg-secondary)]"
              >
                <input
                  type="checkbox"
                  checked={selected.has(cat.key)}
                  onChange={() => toggle(cat.key)}
                  className="h-4 w-4 rounded accent-[var(--accent-color)]"
                />
                <div className="flex-1">
                  <div className="text-sm font-medium text-[var(--text-primary)]">{cat.label}</div>
                  <div className="text-[10px] text-[var(--text-secondary)]">{cat.description}</div>
                </div>
                <span className="text-xs tabular-nums text-[var(--text-secondary)]">
                  {count > 0 ? `${count} 个` : '无'}
                </span>
              </label>
            )
          })}
        </div>

        {progress && (
          <div className="mt-3 flex items-center gap-2 text-xs text-[var(--text-secondary)]">
            <Loader2 className="h-3 w-3 animate-spin" />
            {progress}
          </div>
        )}

        <div className="mt-4 flex items-center justify-between">
          <span className="text-xs text-[var(--text-secondary)]">
            共 {totalSelected} 个文件将打包为 ZIP
          </span>
          <div className="flex gap-2">
            <Button size="sm" variant="secondary" onClick={onClose} disabled={busy}>
              取消
            </Button>
            <Button
              size="sm"
              onClick={runExport}
              disabled={busy || totalSelected === 0}
              className="gap-1"
            >
              {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />}
              导出 ZIP
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}
