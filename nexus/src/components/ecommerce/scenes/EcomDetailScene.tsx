import React, { useCallback, useState } from 'react'
import { Wand2, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import type { EcomDraftV1, EcomMediaVariant } from '@/lib/ecommerce/types'
import { ECOM_DETAIL_ROLES } from '@/lib/ecommerce/types'
import { buildDetailPrompt, collectProductRefUrls, generateEcomImage, bgCacheToProject } from '@/lib/ecommerce/generateMedia'
import { useAssetsStore } from '@/store/assets'
import { VariantThumb } from '../shared/VariantThumb'

interface SceneProps {
  draft: EcomDraftV1
  setDraftSafe: (fn: React.SetStateAction<EcomDraftV1>) => void
  onOpenMediaPicker?: (opts: { kinds: string[]; multiple?: boolean; onConfirm: (items: any[]) => void }) => void
  onAddToCanvas?: (url: string, label: string) => void
}

const makeVariantId = () => `var_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`

export default function EcomDetailScene({ draft, setDraftSafe }: SceneProps) {
  const [generating, setGenerating] = useState(false)
  const handleGenerate = useCallback(async () => {
    if (generating) return
    if (!draft.product.name && draft.productRefs.length === 0) {
      window.$message?.warning?.('请先填写商品名称或上传参考图')
      return
    }
    setGenerating(true)
    window.$message?.info?.('开始生成详情页 9 张套图...')

    const refUrls = collectProductRefUrls(draft)
    let successCount = 0

    for (let i = 0; i < draft.detailPageScene.images.length; i++) {
      const img = draft.detailPageScene.images[i]
      const variantId = makeVariantId()

      setDraftSafe(prev => {
        const images = [...prev.detailPageScene.images]
        images[i] = {
          ...images[i],
          slot: {
            ...images[i].slot,
            variants: [...images[i].slot.variants, { id: variantId, status: 'running', createdAt: Date.now(), createdBy: 'template', modelKey: draft.models.imageModelKey } as EcomMediaVariant],
            selectedVariantId: variantId,
          }
        }
        return { ...prev, detailPageScene: { ...prev.detailPageScene, images } }
      })

      try {
        const prompt = buildDetailPrompt(draft, img.role)
        const result = await generateEcomImage({
          modelKey: draft.models.imageModelKey,
          prompt,
          size: draft.models.imageAspectRatio || draft.models.imageSize,
          quality: draft.models.imageResolution || draft.models.imageQuality,
          refImages: refUrls,
        })

        const displayUrl = result.displayUrl || result.imageUrl
        setDraftSafe(prev => {
          const images = [...prev.detailPageScene.images]
          images[i] = {
            ...images[i],
            slot: {
              ...images[i].slot,
              variants: images[i].slot.variants.map(v =>
                v.id === variantId ? { ...v, status: 'success' as const, displayUrl, sourceUrl: result.imageUrl, promptSnapshot: prompt } : v
              ),
            }
          }
          return { ...prev, detailPageScene: { ...prev.detailPageScene, images } }
        })
        useAssetsStore.getState().addAsset({ type: 'image', src: result.imageUrl || displayUrl, title: `${draft.product.name || '商品'} · 详情页`, model: draft.models.imageModelKey })
        bgCacheToProject(result.imageUrl, draft.projectId, 'image', draft.models.imageModelKey)
        successCount++
      } catch (err: any) {
        setDraftSafe(prev => {
          const images = [...prev.detailPageScene.images]
          images[i] = {
            ...images[i],
            slot: {
              ...images[i].slot,
              variants: images[i].slot.variants.map(v =>
                v.id === variantId ? { ...v, status: 'error' as const, error: err?.message || '生成失败' } : v
              ),
            }
          }
          return { ...prev, detailPageScene: { ...prev.detailPageScene, images } }
        })
      }
    }

    setGenerating(false)
    window.$message?.success?.(`详情页套图完成：成功 ${successCount}/9`)
  }, [draft, generating, setDraftSafe])

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold">详情页套图（9图）</h3>
        <Button onClick={handleGenerate} disabled={generating} className="gap-1">
          {generating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Wand2 className="h-4 w-4" />}
          {generating ? '批量生成中...' : '一键生成 9 图'}
        </Button>
      </div>

      <input
        value={draft.detailPageScene.consistencyPrompt}
        onChange={e => setDraftSafe(prev => ({ ...prev, detailPageScene: { ...prev.detailPageScene, consistencyPrompt: e.target.value } }))}
        placeholder="一致性提示词（统一风格描述，如：日式极简风格，柔和自然光...）"
        className="w-full rounded-lg border border-[var(--border-color)] bg-[var(--bg-primary)] px-2 py-1.5 text-xs focus:border-[var(--accent-color)] focus:outline-none"
      />

      <div className="grid grid-cols-3 gap-3">
        {draft.detailPageScene.images.map((img, i) => {
          const imgVariants = img.slot?.variants || []
          const v = imgVariants.find(x => x.id === img.slot?.selectedVariantId) || imgVariants[imgVariants.length - 1]
          const roleLabel = ECOM_DETAIL_ROLES.find(r => r.role === img.role)?.label || img.role
          return (
            <div key={img.id} className="rounded-xl border border-[var(--border-color)] bg-[var(--bg-secondary)] p-2">
              <div className="mb-1 text-[10px] font-medium text-[var(--text-secondary)]">{i + 1}. {roleLabel}</div>
              <div className="flex aspect-[3/4] items-center justify-center overflow-hidden rounded-lg bg-[var(--bg-tertiary)]">
                {v ? <VariantThumb variant={v} className="h-full w-full" /> : <span className="text-xs text-[var(--text-secondary)] opacity-40">待生成</span>}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
