import React from 'react'
import { cn } from '@/lib/utils'
import type { EcomMediaVariant } from '@/lib/ecommerce/types'
import { VariantThumb } from './VariantThumb'

interface Props {
  variants: EcomMediaVariant[]
  selectedVariantId?: string
  onSelect: (variantId: string) => void
  mediaType?: 'image' | 'video'
}

export function VariantHistoryStrip({ variants, selectedVariantId, onSelect, mediaType = 'image' }: Props) {
  if (variants.length <= 1) return null
  return (
    <div className="flex gap-2 overflow-x-auto pb-2">
      {variants.map(v => (
        <button key={v.id} onClick={() => onSelect(v.id)}
          className={cn('flex-shrink-0 rounded-lg border-2 p-0.5', v.id === selectedVariantId ? 'border-[var(--accent-color)]' : 'border-transparent')}>
          {mediaType === 'video' && v.status === 'success' && v.sourceUrl ? (
            <video src={v.sourceUrl} className="h-16 w-16 rounded-lg object-cover" muted />
          ) : (
            <VariantThumb variant={v} className="h-16 w-16" />
          )}
        </button>
      ))}
    </div>
  )
}
