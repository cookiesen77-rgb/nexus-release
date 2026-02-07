import React, { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { getMedia } from '@/lib/mediaStorage'
import type { ShortDramaMediaSlot, ShortDramaMediaVariant } from '@/lib/shortDrama/types'
import { Check, Eye, Image as ImageIcon, Trash2, Video as VideoIcon } from 'lucide-react'

function useMediaPreview(mediaId?: string) {
  const [url, setUrl] = useState<string>('')
  useEffect(() => {
    if (!mediaId) {
      setUrl('')
      return
    }
    let cancelled = false
    ;(async () => {
      try {
        const rec = await getMedia(mediaId)
        if (cancelled) return
        setUrl(String(rec?.data || ''))
      } catch {
        if (cancelled) return
        setUrl('')
      }
    })()
    return () => {
      cancelled = true
    }
  }, [mediaId])
  return url
}

export function ShortDramaVariantThumb({ variant, className }: { variant: ShortDramaMediaVariant; className?: string }) {
  const fromMedia = useMediaPreview(variant.mediaId)
  const url = String(variant.displayUrl || fromMedia || variant.sourceUrl || '').trim()
  if (!url) {
    return <div className={cn('flex h-16 w-16 items-center justify-center rounded-lg bg-black/10 text-xs text-[var(--text-secondary)]', className)}>空</div>
  }
  if (variant.kind === 'video') {
    return <video src={url} className={cn('h-16 w-16 rounded-lg bg-black/10 object-cover', className)} muted playsInline />
  }
  return <img src={url} className={cn('h-16 w-16 rounded-lg bg-black/10 object-cover', className)} alt="variant" />
}

export function ShortDramaSlotVersions({
  slot,
  onAdopt,
  onRemove,
  onPreview,
  disabled,
}: {
  slot: ShortDramaMediaSlot
  onAdopt: (variantId: string) => void
  onRemove: (variantId: string) => void
  onPreview?: (variant: ShortDramaMediaVariant) => void
  disabled?: boolean
}) {
  if (!slot.variants || slot.variants.length === 0) {
    return <div className="text-xs text-[var(--text-secondary)]">暂无版本</div>
  }
  return (
    <div className="space-y-2">
      {slot.variants
        .slice()
        .reverse()
        .map((v) => {
          const adopted = slot.selectedVariantId === v.id
          const Icon = v.kind === 'video' ? VideoIcon : ImageIcon
          const canPreview = !!onPreview && v.status === 'success'
          return (
            <div key={v.id} className="flex items-center gap-2 rounded-lg border border-[var(--border-color)] bg-[var(--bg-secondary)] p-2">
              <button
                type="button"
                className={cn('shrink-0', canPreview ? 'cursor-pointer' : 'cursor-default')}
                onClick={() => (canPreview ? onPreview?.(v) : undefined)}
                disabled={!canPreview || disabled}
                title={canPreview ? '预览' : undefined}
              >
                <ShortDramaVariantThumb variant={v} />
              </button>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <Icon className="h-4 w-4 text-[var(--text-secondary)]" />
                  <div className="truncate text-xs font-medium text-[var(--text-primary)]">
                    {v.status === 'running' ? '生成中…' : v.status === 'error' ? '失败' : '成功'}
                  </div>
                  {v.status === 'error' ? <div className="truncate text-xs text-red-500">{String(v.error || '')}</div> : null}
                </div>
                <div className="mt-1 text-[11px] text-[var(--text-secondary)]">
                  {new Date(v.createdAt || Date.now()).toLocaleString()} · {String(v.modelKey || '').slice(0, 24)}
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={!canPreview || disabled}
                  onClick={() => onPreview?.(v)}
                  className="h-8 w-8 px-0"
                  title="预览"
                >
                  <Eye className="h-4 w-4" />
                </Button>
                <Button size="sm" variant="ghost" disabled={disabled || adopted || v.status !== 'success'} onClick={() => onAdopt(v.id)}>
                  <Check className="mr-1 h-4 w-4" />
                  采用
                </Button>
                <Button size="sm" variant="ghost" disabled={disabled || v.status === 'running'} onClick={() => onRemove(v.id)} className="text-red-500">
                  <Trash2 className="mr-1 h-4 w-4" />
                  删除
                </Button>
              </div>
            </div>
          )
        })}
    </div>
  )
}

