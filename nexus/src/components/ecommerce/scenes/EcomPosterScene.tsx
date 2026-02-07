import React, { useCallback } from 'react'
import { Plus, Wand2, Loader2, Trash2, Megaphone } from 'lucide-react'
import { Button } from '@/components/ui/button'
import type { EcomDraftV1, EcomMediaVariant, EcomPosterCampaign } from '@/lib/ecommerce/types'
import { buildPosterPrompt, collectProductRefUrls, generateEcomImage, bgCacheToProject } from '@/lib/ecommerce/generateMedia'
import { createEmptySlot } from '@/lib/ecommerce/draftStorage'
import { VariantThumb } from '../shared/VariantThumb'

interface Props {
  draft: EcomDraftV1
  setDraftSafe: (fn: React.SetStateAction<EcomDraftV1>) => void
  generating: boolean
  setGenerating: (v: boolean) => void
  onOpenMediaPicker?: (opts: { kinds: string[]; multiple?: boolean; onConfirm: (items: any[]) => void }) => void
}

const makeVariantId = () => `var_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`

export default function EcomPosterScene({ draft, setDraftSafe, generating, setGenerating }: Props) {
  const handleAdd = useCallback(() => {
    setDraftSafe(prev => ({
      ...prev,
      posterScenes: [...prev.posterScenes, {
        id: `poster_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        campaign: 'custom' as EcomPosterCampaign,
        campaignText: '',
        headline: '',
        subheadline: '',
        ctaText: '立即抢购',
        discountText: '',
        templatePresetId: '',
        prompt: '',
        slot: createEmptySlot('营销海报'),
      }]
    }))
  }, [setDraftSafe])

  const handleGenerate = useCallback(async (idx: number) => {
    if (generating) return
    setGenerating(true)
    const variantId = makeVariantId()

    setDraftSafe(prev => {
      const scenes = [...prev.posterScenes]
      scenes[idx] = {
        ...scenes[idx],
        slot: {
          ...scenes[idx].slot,
          variants: [...scenes[idx].slot.variants, { id: variantId, status: 'running', createdAt: Date.now(), createdBy: 'template' } as EcomMediaVariant],
          selectedVariantId: variantId,
        }
      }
      return { ...prev, posterScenes: scenes }
    })

    try {
      const prompt = buildPosterPrompt(draft, idx)
      const refUrls = collectProductRefUrls(draft)
      const result = await generateEcomImage({
        modelKey: draft.models.imageModelKey,
        prompt,
        size: '9:16',
        quality: draft.models.imageResolution || draft.models.imageQuality,
        refImages: refUrls,
      })
      const displayUrl = result.displayUrl || result.imageUrl
      setDraftSafe(prev => {
        const scenes = [...prev.posterScenes]
        scenes[idx] = {
          ...scenes[idx],
          slot: {
            ...scenes[idx].slot,
            variants: scenes[idx].slot.variants.map(v =>
              v.id === variantId ? { ...v, status: 'success' as const, displayUrl, sourceUrl: result.imageUrl, promptSnapshot: prompt } : v
            ),
          }
        }
        return { ...prev, posterScenes: scenes }
      })
      bgCacheToProject(result.imageUrl, draft.projectId, 'image', draft.models.imageModelKey)
      window.$message?.success?.('海报生成成功')
    } catch (err: any) {
      setDraftSafe(prev => {
        const scenes = [...prev.posterScenes]
        scenes[idx] = {
          ...scenes[idx],
          slot: {
            ...scenes[idx].slot,
            variants: scenes[idx].slot.variants.map(v =>
              v.id === variantId ? { ...v, status: 'error' as const, error: err?.message || '生成失败' } : v
            ),
          }
        }
        return { ...prev, posterScenes: scenes }
      })
      window.$message?.error?.(err?.message || '海报生成失败')
    } finally {
      setGenerating(false)
    }
  }, [draft, generating, setDraftSafe, setGenerating])

  const handleDelete = useCallback((idx: number) => {
    setDraftSafe(prev => ({ ...prev, posterScenes: prev.posterScenes.filter((_, i) => i !== idx) }))
  }, [setDraftSafe])

  const patchPoster = useCallback((idx: number, patch: Record<string, any>) => {
    setDraftSafe(prev => {
      const scenes = [...prev.posterScenes]
      scenes[idx] = { ...scenes[idx], ...patch }
      return { ...prev, posterScenes: scenes }
    })
  }, [setDraftSafe])

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold">营销海报</h3>
        <Button onClick={handleAdd} className="gap-1"><Plus className="h-4 w-4" /> 新增海报</Button>
      </div>

      {draft.posterScenes.length === 0 && (
        <div className="py-12 text-center text-sm text-[var(--text-secondary)] opacity-50">点击"新增海报"开始创建</div>
      )}

      {draft.posterScenes.map((poster, idx) => {
        const posterVariants = poster.slot?.variants || []
        const v = posterVariants.find(x => x.id === poster.slot?.selectedVariantId) || posterVariants[posterVariants.length - 1]
        return (
          <div key={poster.id} className="rounded-xl border border-[var(--border-color)] bg-[var(--bg-secondary)] p-4">
            <div className="mb-3 flex items-center justify-between">
              <span className="text-xs font-semibold">海报 #{idx + 1}</span>
              <div className="flex gap-2">
                <Button size="sm" onClick={() => handleGenerate(idx)} disabled={generating} className="gap-1">
                  {generating ? <Loader2 className="h-3 w-3 animate-spin" /> : <Wand2 className="h-3 w-3" />} 生成
                </Button>
                <Button size="sm" variant="ghost" className="text-red-500" onClick={() => handleDelete(idx)}>
                  <Trash2 className="h-3 w-3" />
                </Button>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <select
                  value={poster.campaign}
                  onChange={e => patchPoster(idx, { campaign: e.target.value })}
                  className="w-full rounded-lg border border-[var(--border-color)] bg-[var(--bg-primary)] px-2 py-1.5 text-xs"
                >
                  <option value="double_11">双11大促</option>
                  <option value="618">618年中</option>
                  <option value="new_year">新年特惠</option>
                  <option value="black_friday">黑色星期五</option>
                  <option value="custom">自定义活动</option>
                </select>
                <input
                  value={poster.headline}
                  onChange={e => patchPoster(idx, { headline: e.target.value })}
                  placeholder="主标题"
                  className="w-full rounded-lg border border-[var(--border-color)] bg-[var(--bg-primary)] px-2 py-1.5 text-xs"
                />
                <input
                  value={poster.discountText}
                  onChange={e => patchPoster(idx, { discountText: e.target.value })}
                  placeholder="折扣 (如: 5折)"
                  className="w-full rounded-lg border border-[var(--border-color)] bg-[var(--bg-primary)] px-2 py-1.5 text-xs"
                />
                <input
                  value={poster.ctaText}
                  onChange={e => patchPoster(idx, { ctaText: e.target.value })}
                  placeholder="行动按钮 (如: 立即抢购)"
                  className="w-full rounded-lg border border-[var(--border-color)] bg-[var(--bg-primary)] px-2 py-1.5 text-xs"
                />
              </div>
              <div className="flex aspect-[9/16] items-center justify-center overflow-hidden rounded-lg bg-[var(--bg-tertiary)]">
                {v ? <VariantThumb variant={v} className="h-full w-full" /> : <Megaphone className="h-8 w-8 text-[var(--text-secondary)] opacity-20" />}
              </div>
            </div>
          </div>
        )
      })}
    </div>
  )
}
