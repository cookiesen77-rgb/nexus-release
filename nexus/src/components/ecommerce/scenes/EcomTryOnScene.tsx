import React, { useCallback } from 'react'
import { Plus, Trash2, Loader2, Upload, Wand2, Download } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import type { EcomDraftV1, EcomTryOnScene as TryOnScene, EcomMediaVariant } from '@/lib/ecommerce/types'
import { generateEcomImage, bgCacheToProject } from '@/lib/ecommerce/generateMedia'
import { analyzeMultiRefImages, buildTryOnPrompt } from '@/lib/ecommerce/batchFusion'
import { createEmptySlot } from '@/lib/ecommerce/draftStorage'
import { useAssetsStore } from '@/store/assets'
import { VariantThumb } from '../shared/VariantThumb'
import { VariantHistoryStrip } from '../shared/VariantHistoryStrip'

interface SceneProps {
  draft: EcomDraftV1
  setDraftSafe: (fn: React.SetStateAction<EcomDraftV1>) => void
  generating: boolean
  setGenerating: (v: boolean) => void
  onOpenMediaPicker?: (opts: { kinds: string[]; multiple?: boolean; onConfirm: (items: any[]) => void }) => void
  onAddToCanvas?: (url: string, label: string) => void
}

const makeVariantId = () => `var_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`

const getSlotUrl = (slot: { variants: EcomMediaVariant[]; selectedVariantId?: string }): string => {
  const v = slot.variants.find(x => x.id === slot.selectedVariantId) || slot.variants[0]
  return v?.displayUrl || v?.sourceUrl || ''
}

export default function EcomTryOnScene({ draft, setDraftSafe, generating, setGenerating, onAddToCanvas }: SceneProps) {
  const [analyzingIdx, setAnalyzingIdx] = React.useState<number | null>(null)

  const patchScene = useCallback((idx: number, patch: Partial<TryOnScene>) => {
    setDraftSafe(prev => {
      const scenes = [...prev.tryOnScenes]
      scenes[idx] = { ...scenes[idx], ...patch }
      return { ...prev, tryOnScenes: scenes }
    })
  }, [setDraftSafe])

  const handleAdd = useCallback(() => {
    setDraftSafe(prev => ({
      ...prev,
      tryOnScenes: [...prev.tryOnScenes, {
        id: `tryon_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        modelImageSlot: createEmptySlot('模特照片'),
        productImageSlot: createEmptySlot('商品图片'),
        resultSlot: createEmptySlot('生成结果'),
        prompt: '',
        aiAnalysis: undefined,
      }],
    }))
  }, [setDraftSafe])

  const handleUpload = useCallback((
    sceneIdx: number,
    field: 'modelImageSlot' | 'productImageSlot',
    e: React.ChangeEvent<HTMLInputElement>,
  ) => {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = () => {
      const dataUrl = reader.result as string
      if (!dataUrl) return
      const variantId = makeVariantId()
      patchScene(sceneIdx, {
        [field]: {
          ...draft.tryOnScenes[sceneIdx][field],
          variants: [{ id: variantId, status: 'success', createdAt: Date.now(), createdBy: 'manual', displayUrl: dataUrl }],
          selectedVariantId: variantId,
        },
      })
    }
    reader.readAsDataURL(file)
    e.currentTarget.value = ''
  }, [draft.tryOnScenes, patchScene])

  const handleAnalyze = useCallback(async (idx: number) => {
    if (analyzingIdx !== null) return
    const scene = draft.tryOnScenes[idx]
    const modelUrl = getSlotUrl(scene.modelImageSlot)
    const productUrl = getSlotUrl(scene.productImageSlot)
    if (!modelUrl) { window.$message?.warning?.('请先上传模特照片'); return }
    if (!productUrl) { window.$message?.warning?.('请先上传商品图片'); return }

    setAnalyzingIdx(idx)
    try {
      const productContext = [draft.product.name, draft.product.description, (draft.product.sellingPoints || []).join(', ')].filter(Boolean).join(' | ')
      const result = await analyzeMultiRefImages(modelUrl, [productUrl], productContext)
      const userHint = scene.prompt || ''
      const tryOnPrompt = await buildTryOnPrompt(result.mainAnalysis, result.secondaryAnalyses[0] || '', userHint)
      patchScene(idx, {
        aiAnalysis: result.fusionStrategy,
        prompt: tryOnPrompt,
      })
      window.$message?.success?.('AI 分析完成')
    } catch (err: any) {
      window.$message?.error?.(err?.message || 'AI 分析失败')
    } finally {
      setAnalyzingIdx(null)
    }
  }, [draft, analyzingIdx, patchScene])

  const handleGenerate = useCallback(async (idx: number) => {
    if (generating) return
    const scene = draft.tryOnScenes[idx]
    const modelUrl = getSlotUrl(scene.modelImageSlot)
    const productUrl = getSlotUrl(scene.productImageSlot)
    if (!modelUrl) { window.$message?.warning?.('请先上传模特照片'); return }
    if (!productUrl) { window.$message?.warning?.('请先上传商品图片'); return }
    if (!scene.prompt) { window.$message?.warning?.('请先进行 AI 分析或手动输入提示词'); return }

    setGenerating(true)
    const variantId = makeVariantId()

    setDraftSafe(prev => {
      const scenes = [...prev.tryOnScenes]
      scenes[idx] = {
        ...scenes[idx],
        resultSlot: {
          ...scenes[idx].resultSlot,
          variants: [...scenes[idx].resultSlot.variants, { id: variantId, status: 'running', createdAt: Date.now(), createdBy: 'auto', modelKey: draft.models.imageModelKey } as EcomMediaVariant],
          selectedVariantId: variantId,
        },
      }
      return { ...prev, tryOnScenes: scenes }
    })

    try {
      const result = await generateEcomImage({
        modelKey: draft.models.imageModelKey,
        prompt: scene.prompt,
        size: draft.models.imageAspectRatio || draft.models.imageSize,
        quality: draft.models.imageResolution || draft.models.imageQuality,
        refImages: [modelUrl, productUrl],
      })

      const displayUrl = result.displayUrl || result.imageUrl
      setDraftSafe(prev => {
        const scenes = [...prev.tryOnScenes]
        scenes[idx] = {
          ...scenes[idx],
          resultSlot: {
            ...scenes[idx].resultSlot,
            variants: scenes[idx].resultSlot.variants.map(v =>
              v.id === variantId ? { ...v, status: 'success' as const, displayUrl, sourceUrl: result.imageUrl, promptSnapshot: scene.prompt } : v
            ),
          },
        }
        return { ...prev, tryOnScenes: scenes }
      })
      useAssetsStore.getState().addAsset({ type: 'image', src: result.imageUrl || displayUrl, title: `${draft.product.name || '商品'} · 换装`, model: draft.models.imageModelKey })
      bgCacheToProject(result.imageUrl, draft.projectId, 'image', draft.models.imageModelKey)
      window.$message?.success?.('换装图生成成功')
    } catch (err: any) {
      setDraftSafe(prev => {
        const scenes = [...prev.tryOnScenes]
        scenes[idx] = {
          ...scenes[idx],
          resultSlot: {
            ...scenes[idx].resultSlot,
            variants: scenes[idx].resultSlot.variants.map(v =>
              v.id === variantId ? { ...v, status: 'error' as const, error: err?.message || '生成失败' } : v
            ),
          },
        }
        return { ...prev, tryOnScenes: scenes }
      })
      window.$message?.error?.(err?.message || '换装图生成失败')
    } finally {
      setGenerating(false)
    }
  }, [draft, generating, setDraftSafe, setGenerating])

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold">AI 换装</h3>
        <Button onClick={handleAdd} className="gap-1"><Plus className="h-4 w-4" /> 新增换装</Button>
      </div>

      {draft.tryOnScenes.length === 0 && (
        <div className="text-center py-12 text-sm text-[var(--text-secondary)] opacity-50">
          点击"新增换装"，上传模特照片与商品图片
        </div>
      )}

      {draft.tryOnScenes.map((scene, idx) => {
        const modelV = scene.modelImageSlot?.variants?.[0]
        const productV = scene.productImageSlot?.variants?.[0]
        const resultVariants = scene.resultSlot?.variants || []
        const resultV = resultVariants.find(v => v.id === scene.resultSlot?.selectedVariantId) || resultVariants[resultVariants.length - 1]
        const resultUrl = resultV?.status === 'success' ? (resultV.displayUrl || resultV.sourceUrl || '') : ''

        return (
          <div key={scene.id} className="rounded-xl border border-[var(--border-color)] bg-[var(--bg-secondary)] p-4">
            <div className="flex items-center justify-between mb-3">
              <span className="text-xs font-semibold">#{idx + 1}</span>
              <Button size="sm" variant="ghost" className="text-red-500" onClick={() => setDraftSafe(prev => ({ ...prev, tryOnScenes: prev.tryOnScenes.filter((_, i) => i !== idx) }))}>
                <Trash2 className="h-3 w-3" />
              </Button>
            </div>

            <div className="grid grid-cols-3 gap-3">
              {/* Model image */}
              <div>
                <div className="text-[10px] text-[var(--text-secondary)] mb-1">模特照片</div>
                <label className="block aspect-[3/4] rounded-lg border-2 border-dashed border-[var(--border-color)] bg-[var(--bg-tertiary)] cursor-pointer overflow-hidden flex items-center justify-center">
                  {modelV ? <VariantThumb variant={modelV} className="h-full w-full" /> : <Upload className="h-6 w-6 text-[var(--text-secondary)] opacity-30" />}
                  <input type="file" accept="image/*" className="hidden" onChange={e => handleUpload(idx, 'modelImageSlot', e)} />
                </label>
              </div>
              {/* Product image */}
              <div>
                <div className="text-[10px] text-[var(--text-secondary)] mb-1">商品图片</div>
                <label className="block aspect-[3/4] rounded-lg border-2 border-dashed border-[var(--border-color)] bg-[var(--bg-tertiary)] cursor-pointer overflow-hidden flex items-center justify-center">
                  {productV ? <VariantThumb variant={productV} className="h-full w-full" /> : <Upload className="h-6 w-6 text-[var(--text-secondary)] opacity-30" />}
                  <input type="file" accept="image/*" className="hidden" onChange={e => handleUpload(idx, 'productImageSlot', e)} />
                </label>
              </div>
              {/* Result */}
              <div>
                <div className="text-[10px] text-[var(--text-secondary)] mb-1">生成结果</div>
                <div className="aspect-[3/4] rounded-lg bg-[var(--bg-tertiary)] overflow-hidden flex items-center justify-center">
                  {resultV ? <VariantThumb variant={resultV} className="h-full w-full" /> : <span className="text-xs text-[var(--text-secondary)] opacity-30">待生成</span>}
                </div>
              </div>
            </div>

            <textarea
              value={scene.prompt}
              onChange={e => patchScene(idx, { prompt: e.target.value })}
              placeholder="描述你想要的效果（如：让模特穿上这件白色羽绒服）。点击 AI 分析后会自动优化提示词..."
              rows={3}
              className="mt-3 w-full rounded-lg border border-[var(--border-color)] bg-[var(--bg-primary)] px-2 py-1.5 text-xs resize-none focus:border-[var(--accent-color)] focus:outline-none"
            />

            {scene.aiAnalysis && (
              <div className="mt-2 rounded-lg bg-[var(--bg-tertiary)] px-3 py-2 text-[11px] text-[var(--text-secondary)] leading-relaxed">
                <span className="font-medium text-[var(--accent-color)]">AI 分析：</span>{scene.aiAnalysis}
              </div>
            )}

            <div className="mt-3 flex gap-2">
              <Button size="sm" variant="secondary" onClick={() => handleAnalyze(idx)} disabled={analyzingIdx !== null} className="gap-1">
                {analyzingIdx === idx ? <Loader2 className="h-3 w-3 animate-spin" /> : <Wand2 className="h-3 w-3" />} AI 分析润色
              </Button>
              <Button size="sm" onClick={() => handleGenerate(idx)} disabled={generating} className="gap-1">
                {generating ? <Loader2 className="h-3 w-3 animate-spin" /> : <Wand2 className="h-3 w-3" />} 生成换装
              </Button>
              {resultUrl && onAddToCanvas && (
                <Button size="sm" variant="secondary" onClick={() => onAddToCanvas(resultUrl, `${draft.product.name || '商品'} · 换装`)} className="gap-1">
                  <Download className="h-3 w-3" /> 添加到画布
                </Button>
              )}
            </div>

            <VariantHistoryStrip
              variants={scene.resultSlot?.variants || []}
              selectedVariantId={scene.resultSlot?.selectedVariantId}
              onSelect={vid => patchScene(idx, { resultSlot: { ...scene.resultSlot, selectedVariantId: vid } })}
            />
          </div>
        )
      })}
    </div>
  )
}
