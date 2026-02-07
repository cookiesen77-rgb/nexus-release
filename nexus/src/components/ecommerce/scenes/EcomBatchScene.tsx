import React, { useCallback } from 'react'
import { Plus, Trash2, Loader2, Upload, Download, Layers, Wand2, Sparkles } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import type { EcomDraftV1, EcomMediaVariant, EcomBatchItem } from '@/lib/ecommerce/types'
import { generateEcomImage, buildBatchItemPrompt, collectProductRefUrls, bgCacheToProject } from '@/lib/ecommerce/generateMedia'
import { analyzeMultiRefImages, buildFusionPrompt, generateMultiRefImage } from '@/lib/ecommerce/batchFusion'
import { createEmptySlot } from '@/lib/ecommerce/draftStorage'
import { VariantThumb } from '../shared/VariantThumb'

interface SceneProps {
  draft: EcomDraftV1
  setDraftSafe: (fn: React.SetStateAction<EcomDraftV1>) => void
  generating: boolean
  setGenerating: (v: boolean) => void
  onOpenMediaPicker?: (opts: { kinds: string[]; multiple?: boolean; onConfirm: (items: any[]) => void }) => void
}

const makeVariantId = () => `var_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`

export default function EcomBatchScene({ draft, setDraftSafe, generating, setGenerating }: SceneProps) {

  const patchItems = useCallback((fn: (items: EcomBatchItem[]) => EcomBatchItem[]) => {
    setDraftSafe(prev => ({ ...prev, batchScene: { ...prev.batchScene, items: fn([...prev.batchScene.items]) } }))
  }, [setDraftSafe])

  const handleAddBatchItem = useCallback(() => {
    setDraftSafe(prev => ({
      ...prev,
      batchScene: {
        ...prev.batchScene,
        items: [...prev.batchScene.items, {
          id: `batch_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
          productName: '',
          refSlot: createEmptySlot('参考图'),
          secondaryRefSlots: [],
          resultSlot: createEmptySlot('生成结果'),
          status: 'pending' as const,
        }],
      },
    }))
  }, [setDraftSafe])

  const handleRefUpload = useCallback((itemIdx: number, e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = () => {
      const dataUrl = reader.result as string
      if (!dataUrl) return
      const variantId = makeVariantId()
      patchItems(items => {
        items[itemIdx] = {
          ...items[itemIdx],
          refSlot: {
            ...items[itemIdx].refSlot,
            variants: [{ id: variantId, status: 'success', createdAt: Date.now(), createdBy: 'manual', displayUrl: dataUrl }],
            selectedVariantId: variantId,
          },
        }
        return items
      })
    }
    reader.readAsDataURL(file)
    e.currentTarget.value = ''
  }, [patchItems])

  const handleSecondaryRefUpload = useCallback((itemIdx: number, e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = () => {
      const dataUrl = reader.result as string
      if (!dataUrl) return
      const variantId = makeVariantId()
      const newSlot = createEmptySlot('副参考图')
      newSlot.variants = [{ id: variantId, status: 'success', createdAt: Date.now(), createdBy: 'manual', displayUrl: dataUrl }]
      newSlot.selectedVariantId = variantId
      patchItems(items => {
        items[itemIdx] = {
          ...items[itemIdx],
          secondaryRefSlots: [...items[itemIdx].secondaryRefSlots, newSlot],
        }
        return items
      })
    }
    reader.readAsDataURL(file)
    e.currentTarget.value = ''
  }, [patchItems])

  const handleRemoveSecondaryRef = useCallback((itemIdx: number, slotIdx: number) => {
    patchItems(items => {
      items[itemIdx] = {
        ...items[itemIdx],
        secondaryRefSlots: items[itemIdx].secondaryRefSlots.filter((_, i) => i !== slotIdx),
      }
      return items
    })
  }, [patchItems])

  const getSlotUrl = (slot: { variants: EcomMediaVariant[]; selectedVariantId?: string }): string => {
    const v = slot.variants.find(x => x.id === slot.selectedVariantId) || slot.variants[0]
    return v?.displayUrl || v?.sourceUrl || ''
  }

  const handleAnalyze = useCallback(async (itemIdx: number) => {
    const item = draft.batchScene.items[itemIdx]
    const mainUrl = getSlotUrl(item.refSlot)
    if (!mainUrl) { window.$message?.warning?.('请先上传主参考图'); return }

    const secondaryUrls = item.secondaryRefSlots.map(s => getSlotUrl(s)).filter(Boolean)
    if (secondaryUrls.length === 0) { window.$message?.warning?.('请上传至少一张副参考图'); return }

    patchItems(items => { items[itemIdx] = { ...items[itemIdx], aiAnalysis: '分析中...' }; return items })

    try {
      const result = await analyzeMultiRefImages(mainUrl, secondaryUrls, `${item.productName || draft.product.name || '商品'}: ${draft.product.description || ''}`)
      const analysis = [result.mainAnalysis, ...result.secondaryAnalyses, `策略: ${result.fusionStrategy}`].join('\n\n')
      patchItems(items => { items[itemIdx] = { ...items[itemIdx], aiAnalysis: analysis }; return items })
      window.$message?.success?.('AI 分析完成')
    } catch (err: any) {
      patchItems(items => { items[itemIdx] = { ...items[itemIdx], aiAnalysis: `分析失败: ${err?.message}` }; return items })
      window.$message?.error?.(err?.message || 'AI 分析失败')
    }
  }, [draft, patchItems])

  const handleRunBatch = useCallback(async () => {
    if (generating) return
    const items = draft.batchScene.items
    if (items.length === 0) { window.$message?.warning?.('请先添加商品'); return }

    setGenerating(true)
    window.$message?.info?.(`开始批量生成 ${items.length} 张...`)
    let successCount = 0
    const globalRefUrls = collectProductRefUrls(draft)

    for (let i = 0; i < items.length; i++) {
      const item = items[i]
      const variantId = makeVariantId()

      patchItems(its => {
        its[i] = {
          ...its[i],
          status: 'running',
          resultSlot: {
            ...its[i].resultSlot,
            variants: [...its[i].resultSlot.variants, { id: variantId, status: 'running', createdAt: Date.now(), createdBy: 'template' } as EcomMediaVariant],
            selectedVariantId: variantId,
          },
        }
        return its
      })

      try {
        const mainUrl = getSlotUrl(item.refSlot)
        const secondaryUrls = item.secondaryRefSlots.map(s => getSlotUrl(s)).filter(Boolean)
        let displayUrl: string

        if (secondaryUrls.length > 0 && mainUrl) {
          const analysis = await analyzeMultiRefImages(mainUrl, secondaryUrls, `${item.productName || '商品'}: ${draft.product.description || ''}`)
          const fusionPrompt = await buildFusionPrompt(analysis.mainAnalysis, analysis.secondaryAnalyses, draft.batchScene.promptTemplate.replace(/\{\{PRODUCT\}\}/g, item.productName || '商品'))
          const result = await generateMultiRefImage({
            mainUrl,
            secondaryUrls,
            prompt: fusionPrompt,
            aspectRatio: draft.models.imageRatio,
            resolution: draft.models.imageResolution || draft.models.imageQuality,
          })
          displayUrl = result.displayUrl
        } else {
          const prompt = buildBatchItemPrompt(draft.batchScene.promptTemplate, item.productName, draft.product.description)
          const itemRefUrl = mainUrl
          const allRefs = itemRefUrl ? [itemRefUrl, ...globalRefUrls] : globalRefUrls
          const result = await generateEcomImage({
            modelKey: draft.models.imageModelKey,
            prompt,
            size: draft.models.imageAspectRatio || draft.models.imageSize,
            quality: draft.models.imageResolution || draft.models.imageQuality,
            refImages: allRefs,
          })
          displayUrl = result.displayUrl || result.imageUrl
        }

        patchItems(its => {
          its[i] = {
            ...its[i],
            status: 'success',
            resultSlot: {
              ...its[i].resultSlot,
              variants: its[i].resultSlot.variants.map(v =>
                v.id === variantId ? { ...v, status: 'success' as const, displayUrl, sourceUrl: displayUrl } : v
              ),
            },
          }
          return its
        })
        bgCacheToProject(displayUrl, draft.projectId, 'image', draft.models.imageModelKey)
        successCount++
      } catch (err: any) {
        patchItems(its => {
          its[i] = {
            ...its[i],
            status: 'error',
            resultSlot: {
              ...its[i].resultSlot,
              variants: its[i].resultSlot.variants.map(v =>
                v.id === variantId ? { ...v, status: 'error' as const, error: err?.message || '生成失败' } : v
              ),
            },
          }
          return its
        })
      }
    }

    setGenerating(false)
    window.$message?.success?.(`批量生成完成：成功 ${successCount}/${items.length}`)
  }, [draft, generating, setGenerating, patchItems])

  const handleDownload = useCallback((url: string, filename: string) => {
    const a = document.createElement('a')
    a.href = url
    a.download = filename
    a.target = '_blank'
    a.rel = 'noopener noreferrer'
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
  }, [])

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold">批量出图</h3>
        <div className="flex gap-2">
          <Button onClick={handleAddBatchItem} variant="secondary" className="gap-1"><Plus className="h-4 w-4" /> 添加商品</Button>
          <Button onClick={handleRunBatch} disabled={generating || draft.batchScene.items.length === 0} className="gap-1">
            {generating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Wand2 className="h-4 w-4" />}
            {generating ? '生成中...' : '一键批量生成'}
          </Button>
        </div>
      </div>

      <div className="space-y-2">
        <div className="text-[11px] text-[var(--text-secondary)]">提示词模板 (用 {'{{PRODUCT}}'} 代替商品名)</div>
        <textarea
          value={draft.batchScene.promptTemplate}
          onChange={e => setDraftSafe(prev => ({ ...prev, batchScene: { ...prev.batchScene, promptTemplate: e.target.value } }))}
          placeholder="Professional product photography of {{PRODUCT}}, pure white background, studio lighting, commercial quality"
          rows={2}
          className="w-full rounded-lg border border-[var(--border-color)] bg-[var(--bg-primary)] px-2 py-1.5 text-xs resize-none focus:border-[var(--accent-color)] focus:outline-none"
        />
      </div>

      <div className="flex gap-3">
        <button
          onClick={() => setDraftSafe(prev => ({ ...prev, batchScene: { ...prev.batchScene, mainRefRole: 'product' } }))}
          className={cn('rounded-lg px-3 py-1.5 text-xs transition-colors', draft.batchScene.mainRefRole === 'product' ? 'bg-[var(--accent-color)] text-white' : 'bg-[var(--bg-secondary)] text-[var(--text-secondary)]')}
        >
          主图为商品
        </button>
        <button
          onClick={() => setDraftSafe(prev => ({ ...prev, batchScene: { ...prev.batchScene, mainRefRole: 'model' } }))}
          className={cn('rounded-lg px-3 py-1.5 text-xs transition-colors', draft.batchScene.mainRefRole === 'model' ? 'bg-[var(--accent-color)] text-white' : 'bg-[var(--bg-secondary)] text-[var(--text-secondary)]')}
        >
          主图为模特
        </button>
      </div>

      {draft.batchScene.items.length === 0 && (
        <div className="text-center py-12 text-sm text-[var(--text-secondary)] opacity-50">
          点击"添加商品"，上传参考图+填写名称，一键批量出图
        </div>
      )}

      <div className="grid grid-cols-2 gap-3">
        {draft.batchScene.items.map((item, idx) => {
          const refV = item.refSlot?.variants?.[0]
          const resultVariants = item.resultSlot?.variants || []
          const resultV = resultVariants.find(v => v.id === item.resultSlot?.selectedVariantId) || resultVariants[resultVariants.length - 1]

          return (
            <div key={item.id} className="rounded-xl border border-[var(--border-color)] bg-[var(--bg-secondary)] p-3">
              <div className="flex items-center justify-between mb-2">
                <input
                  value={item.productName}
                  onChange={e => patchItems(its => { its[idx] = { ...its[idx], productName: e.target.value }; return its })}
                  placeholder="商品名称"
                  className="flex-1 rounded border border-[var(--border-color)] bg-[var(--bg-primary)] px-2 py-1 text-[11px] focus:border-[var(--accent-color)] focus:outline-none"
                />
                <button onClick={() => patchItems(its => its.filter((_, i) => i !== idx))} className="ml-1 text-red-500">
                  <Trash2 className="h-3 w-3" />
                </button>
              </div>

              {/* Main ref */}
              <div className="mb-2">
                <div className="text-[9px] text-[var(--text-secondary)] mb-0.5">主参考图</div>
                <label className="block aspect-square rounded-lg border-2 border-dashed border-[var(--border-color)] bg-[var(--bg-tertiary)] cursor-pointer overflow-hidden flex items-center justify-center">
                  {refV ? <VariantThumb variant={refV} className="h-full w-full" /> : <Upload className="h-5 w-5 text-[var(--text-secondary)] opacity-30" />}
                  <input type="file" accept="image/*" className="hidden" onChange={e => handleRefUpload(idx, e)} />
                </label>
              </div>

              {/* Secondary refs */}
              <div className="mb-2">
                <div className="text-[9px] text-[var(--text-secondary)] mb-0.5">副参考图</div>
                <div className="flex gap-1 flex-wrap">
                  {item.secondaryRefSlots.map((slot, si) => {
                    const sv = slot.variants[0]
                    return (
                      <div key={slot.id} className="relative group">
                        {sv && <VariantThumb variant={sv} className="h-10 w-10" />}
                        <button
                          onClick={() => handleRemoveSecondaryRef(idx, si)}
                          className="absolute -right-1 -top-1 hidden group-hover:flex h-3.5 w-3.5 items-center justify-center rounded-full bg-red-500 text-white text-[7px]"
                        >
                          <Trash2 className="h-2 w-2" />
                        </button>
                      </div>
                    )
                  })}
                  <label className="flex h-10 w-10 cursor-pointer items-center justify-center rounded-lg border border-dashed border-[var(--border-color)] bg-[var(--bg-tertiary)] text-[var(--text-secondary)] hover:border-[var(--accent-color)]">
                    <Plus className="h-3 w-3" />
                    <input type="file" accept="image/*" className="hidden" onChange={e => handleSecondaryRefUpload(idx, e)} />
                  </label>
                </div>
              </div>

              {/* AI analyze */}
              {item.secondaryRefSlots.length > 0 && (
                <Button size="sm" variant="secondary" className="mb-2 w-full gap-1 text-[10px]" onClick={() => handleAnalyze(idx)}>
                  <Sparkles className="h-3 w-3" /> AI 分析融合
                </Button>
              )}
              {item.aiAnalysis && (
                <div className="mb-2 rounded-lg bg-[var(--bg-primary)] p-2 text-[10px] text-[var(--text-secondary)] max-h-24 overflow-y-auto whitespace-pre-wrap">
                  {item.aiAnalysis}
                </div>
              )}

              {/* Result */}
              <div>
                <div className="text-[9px] text-[var(--text-secondary)] mb-0.5">结果</div>
                <div className="relative aspect-square rounded-lg bg-[var(--bg-tertiary)] overflow-hidden flex items-center justify-center">
                  {resultV ? (
                    <>
                      <VariantThumb variant={resultV} className="h-full w-full" />
                      {resultV.status === 'success' && (resultV.displayUrl || resultV.sourceUrl) && (
                        <button
                          onClick={() => handleDownload(resultV.displayUrl || resultV.sourceUrl || '', `${item.productName || 'batch'}_${idx}.png`)}
                          className="absolute right-1 top-1 rounded bg-black/50 p-0.5 text-white hover:bg-black/70"
                        >
                          <Download className="h-3 w-3" />
                        </button>
                      )}
                    </>
                  ) : (
                    <Layers className="h-5 w-5 text-[var(--text-secondary)] opacity-20" />
                  )}
                </div>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
