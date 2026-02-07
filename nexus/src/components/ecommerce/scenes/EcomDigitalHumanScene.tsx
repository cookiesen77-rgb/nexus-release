import React, { useCallback, useState } from 'react'
import { Plus, Trash2, Loader2, Upload, Play } from 'lucide-react'
import { Button } from '@/components/ui/button'
import type { EcomDraftV1, EcomDigitalHumanScene as DHScene, EcomMediaVariant } from '@/lib/ecommerce/types'
import { generateAvatarVideo } from '@/lib/ecommerce/klingAdvanced'
import { bgCacheToProject } from '@/lib/ecommerce/generateMedia'
import { createEmptySlot } from '@/lib/ecommerce/draftStorage'
import { useAssetsStore } from '@/store/assets'
import { VariantThumb } from '../shared/VariantThumb'
import { VariantHistoryStrip } from '../shared/VariantHistoryStrip'

interface SceneProps {
  draft: EcomDraftV1
  setDraftSafe: (fn: React.SetStateAction<EcomDraftV1>) => void
  onOpenMediaPicker?: (opts: { kinds: string[]; multiple?: boolean; onConfirm: (items: any[]) => void }) => void
  onAddToCanvas?: (url: string, label: string) => void
}

const makeVariantId = () => `var_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`

const getSlotUrl = (slot: { variants: EcomMediaVariant[]; selectedVariantId?: string }): string => {
  const v = slot.variants.find(x => x.id === slot.selectedVariantId) || slot.variants[0]
  return v?.displayUrl || v?.sourceUrl || ''
}

export default function EcomDigitalHumanScene({ draft, setDraftSafe }: SceneProps) {
  const [generating, setGenerating] = useState(false)

  const patchScene = useCallback((idx: number, patch: Partial<DHScene>) => {
    setDraftSafe(prev => {
      const scenes = [...prev.digitalHumanScenes]
      scenes[idx] = { ...scenes[idx], ...patch }
      return { ...prev, digitalHumanScenes: scenes }
    })
  }, [setDraftSafe])

  const handleAdd = useCallback(() => {
    setDraftSafe(prev => ({
      ...prev,
      digitalHumanScenes: [...prev.digitalHumanScenes, {
        id: `dh_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        imageSlot: createEmptySlot('人像照片'),
        audioSlot: createEmptySlot('音频文件'),
        resultSlot: createEmptySlot('结果视频'),
        prompt: '',
        mode: 'std' as const,
      }],
    }))
  }, [setDraftSafe])

  const handleUploadImage = useCallback((sceneIdx: number, e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = () => {
      const dataUrl = reader.result as string
      if (!dataUrl) return
      const variantId = makeVariantId()
      patchScene(sceneIdx, {
        imageSlot: {
          ...draft.digitalHumanScenes[sceneIdx].imageSlot,
          variants: [{ id: variantId, status: 'success', createdAt: Date.now(), createdBy: 'manual', displayUrl: dataUrl }],
          selectedVariantId: variantId,
        },
      })
    }
    reader.readAsDataURL(file)
    e.currentTarget.value = ''
  }, [draft.digitalHumanScenes, patchScene])

  const handleUploadAudio = useCallback((sceneIdx: number, e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = () => {
      const dataUrl = reader.result as string
      if (!dataUrl) return
      const variantId = makeVariantId()
      patchScene(sceneIdx, {
        audioSlot: {
          ...draft.digitalHumanScenes[sceneIdx].audioSlot,
          variants: [{ id: variantId, status: 'success', createdAt: Date.now(), createdBy: 'manual', displayUrl: dataUrl, sourceUrl: dataUrl }],
          selectedVariantId: variantId,
        },
      })
    }
    reader.readAsDataURL(file)
    e.currentTarget.value = ''
  }, [draft.digitalHumanScenes, patchScene])

  const handleGenerate = useCallback(async (idx: number) => {
    if (generating) return
    const scene = draft.digitalHumanScenes[idx]
    const imageUrl = getSlotUrl(scene.imageSlot)
    const audioUrl = getSlotUrl(scene.audioSlot)
    if (!imageUrl) { window.$message?.warning?.('请上传人像照片'); return }
    if (!audioUrl) { window.$message?.warning?.('请上传音频文件'); return }

    setGenerating(true)
    const variantId = makeVariantId()

    setDraftSafe(prev => {
      const scenes = [...prev.digitalHumanScenes]
      scenes[idx] = {
        ...scenes[idx],
        resultSlot: {
          ...scenes[idx].resultSlot,
          variants: [...scenes[idx].resultSlot.variants, { id: variantId, status: 'running', createdAt: Date.now(), createdBy: 'auto' } as EcomMediaVariant],
          selectedVariantId: variantId,
        },
      }
      return { ...prev, digitalHumanScenes: scenes }
    })

    try {
      const result = await generateAvatarVideo({
        image: imageUrl,
        soundFile: audioUrl,
        prompt: scene.prompt || undefined,
        mode: scene.mode,
      })

      setDraftSafe(prev => {
        const scenes = [...prev.digitalHumanScenes]
        scenes[idx] = {
          ...scenes[idx],
          resultSlot: {
            ...scenes[idx].resultSlot,
            variants: scenes[idx].resultSlot.variants.map(v =>
              v.id === variantId ? { ...v, status: 'success' as const, sourceUrl: result.videoUrl, displayUrl: result.videoUrl, taskId: result.taskId } : v
            ),
          },
        }
        return { ...prev, digitalHumanScenes: scenes }
      })
      useAssetsStore.getState().addAsset({ type: 'video', src: result.videoUrl, title: `${draft.product.name || '商品'} · 数字人口播` })
      bgCacheToProject(result.videoUrl, draft.projectId, 'video')
      window.$message?.success?.('数字人视频生成完成')
    } catch (err: any) {
      setDraftSafe(prev => {
        const scenes = [...prev.digitalHumanScenes]
        scenes[idx] = {
          ...scenes[idx],
          resultSlot: {
            ...scenes[idx].resultSlot,
            variants: scenes[idx].resultSlot.variants.map(v =>
              v.id === variantId ? { ...v, status: 'error' as const, error: err?.message || '生成失败' } : v
            ),
          },
        }
        return { ...prev, digitalHumanScenes: scenes }
      })
      window.$message?.error?.(err?.message || '数字人视频生成失败')
    } finally {
      setGenerating(false)
    }
  }, [draft, generating, setDraftSafe])

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold">数字人口播</h3>
        <Button onClick={handleAdd} className="gap-1"><Plus className="h-4 w-4" /> 新增</Button>
      </div>

      {draft.digitalHumanScenes.length === 0 && (
        <div className="text-center py-12 text-sm text-[var(--text-secondary)] opacity-50">
          点击"新增"，上传人像照片与音频文件生成数字人口播视频
        </div>
      )}

      {draft.digitalHumanScenes.map((scene, idx) => {
        const imageV = scene.imageSlot?.variants?.[0]
        const audioV = scene.audioSlot?.variants?.[0]
        const resultVariants = scene.resultSlot?.variants || []
        const resultV = resultVariants.find(v => v.id === scene.resultSlot?.selectedVariantId) || resultVariants[resultVariants.length - 1]

        return (
          <div key={scene.id} className="rounded-xl border border-[var(--border-color)] bg-[var(--bg-secondary)] p-4">
            <div className="flex items-center justify-between mb-3">
              <span className="text-xs font-semibold">#{idx + 1}</span>
              <div className="flex gap-2">
                <Button size="sm" onClick={() => handleGenerate(idx)} disabled={generating} className="gap-1">
                  {generating ? <Loader2 className="h-3 w-3 animate-spin" /> : <Play className="h-3 w-3" />} 生成
                </Button>
                <Button size="sm" variant="ghost" className="text-red-500" onClick={() => setDraftSafe(prev => ({ ...prev, digitalHumanScenes: prev.digitalHumanScenes.filter((_, i) => i !== idx) }))}>
                  <Trash2 className="h-3 w-3" />
                </Button>
              </div>
            </div>

            <div className="grid grid-cols-3 gap-3">
              <div>
                <div className="text-[10px] text-[var(--text-secondary)] mb-1">人像照片</div>
                <label className="block aspect-[3/4] rounded-lg border-2 border-dashed border-[var(--border-color)] bg-[var(--bg-tertiary)] cursor-pointer overflow-hidden flex items-center justify-center">
                  {imageV ? <VariantThumb variant={imageV} className="h-full w-full" /> : <Upload className="h-6 w-6 text-[var(--text-secondary)] opacity-30" />}
                  <input type="file" accept="image/*" className="hidden" onChange={e => handleUploadImage(idx, e)} />
                </label>
              </div>
              <div>
                <div className="text-[10px] text-[var(--text-secondary)] mb-1">音频文件</div>
                <label className="block aspect-[3/4] rounded-lg border-2 border-dashed border-[var(--border-color)] bg-[var(--bg-tertiary)] cursor-pointer overflow-hidden flex items-center justify-center">
                  {audioV ? (
                    <div className="text-[10px] text-green-500">音频已上传</div>
                  ) : <Upload className="h-6 w-6 text-[var(--text-secondary)] opacity-30" />}
                  <input type="file" accept="audio/*" className="hidden" onChange={e => handleUploadAudio(idx, e)} />
                </label>
              </div>
              <div>
                <div className="text-[10px] text-[var(--text-secondary)] mb-1">结果视频</div>
                <div className="aspect-[3/4] rounded-lg bg-[var(--bg-tertiary)] overflow-hidden flex items-center justify-center">
                  {resultV ? (
                    resultV.status === 'success' && resultV.sourceUrl ? (
                      <video src={resultV.sourceUrl} className="h-full w-full object-cover" controls />
                    ) : <VariantThumb variant={resultV} className="h-full w-full" />
                  ) : <span className="text-xs text-[var(--text-secondary)] opacity-30">待生成</span>}
                </div>
              </div>
            </div>

            {audioV?.displayUrl && (
              <div className="mt-3">
                <div className="text-[10px] text-[var(--text-secondary)] mb-1">音频预览</div>
                <audio src={audioV.displayUrl} controls className="w-full h-8" />
              </div>
            )}

            <div className="mt-3 flex items-center gap-3">
              <select
                value={scene.mode}
                onChange={e => patchScene(idx, { mode: e.target.value as 'std' | 'pro' })}
                className="rounded-lg border border-[var(--border-color)] bg-[var(--bg-primary)] px-2 py-1 text-[11px]"
              >
                <option value="std">标准模式</option>
                <option value="pro">专业模式</option>
              </select>
            </div>

            <textarea
              value={scene.prompt}
              onChange={e => patchScene(idx, { prompt: e.target.value })}
              placeholder="提示词（可选）..."
              rows={2}
              className="mt-3 w-full rounded-lg border border-[var(--border-color)] bg-[var(--bg-primary)] px-2 py-1.5 text-xs resize-none focus:border-[var(--accent-color)] focus:outline-none"
            />

            <VariantHistoryStrip
              variants={scene.resultSlot?.variants || []}
              selectedVariantId={scene.resultSlot?.selectedVariantId}
              mediaType="video"
              onSelect={vid => patchScene(idx, { resultSlot: { ...scene.resultSlot, selectedVariantId: vid } })}
            />
          </div>
        )
      })}
    </div>
  )
}
