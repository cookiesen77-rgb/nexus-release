import React from 'react'
import { Loader2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { EcomMediaVariant } from '@/lib/ecommerce/types'
import { useMediaPreview } from './useMediaPreview'

export function VariantThumb({ variant, className }: { variant: EcomMediaVariant; className?: string }) {
  const fromMedia = useMediaPreview(variant.mediaId)
  const url = String(variant.displayUrl || fromMedia || variant.sourceUrl || '').trim()
  if (variant.status === 'running') return <div className={cn('flex items-center justify-center rounded-lg bg-[var(--accent-color)]/10', className)}><Loader2 className="h-5 w-5 animate-spin text-[var(--accent-color)]" /></div>
  if (variant.status === 'error') return <div className={cn('flex items-center justify-center rounded-lg bg-red-500/10 text-xs text-red-500', className)}>失败</div>
  if (!url) return <div className={cn('flex items-center justify-center rounded-lg bg-black/5 text-xs text-[var(--text-secondary)]', className)}>空</div>
  return <img src={url} className={cn('rounded-lg object-cover', className)} alt="" />
}
