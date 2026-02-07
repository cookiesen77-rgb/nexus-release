import React, { useCallback } from 'react'
import { Plus, Trash2, Loader2, Upload, Play } from 'lucide-react'
import { Button } from '@/components/ui/button'
import type { EcomDraftV1, EcomMultiElementsScene as MultiScene, EcomMediaVariant } from '@/lib/ecommerce/types'
import { generateMultiElementsVideo } from '@/lib/ecommerce/klingAdvanced'
import { bgCacheToProject } from '@/lib/ecommerce/generateMedia'
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

export default function EcomMultiElementsScene({ draft, setDraftSafe, generating, setGenerating }: SceneProps) {

  const patchScene = useCallback((idx: number, patch: Partial<MultiScene>) => {
    setDraftSafe(prev => {
      const scenes = [...prev.multiElementsScenes]
      scenes[idx] = { ...scenes[idx], ...patch }
      return { ...prev, multiElementsScenes: scenes }
    })
  }, [setDraftSafe])

  const handleAdd = useCallback(() => {
    setDraftSafe(prev => ({
      ...prev,
      multiElementsScenes: [...prev.multiElementsScenes, {
        id: `me_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        sourceVideoSlot: createEmptySlot('待编辑视频'),
        resultSlot: createEmptySlot('生成结果'),
        prompt: '',
        editPrompt: '',
      }],
    }))
  }, [setDraftSafe])

  const handleUploadVideo = useCallback((sceneIdx: number, e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = () => {
      const dataUrl = reader.result as string
      if (!dataUrl) return
      const variantId = makeVariantId()
      patchScene(sceneIdx, {
        sourceVideoSlot: {
          ...draft.multiElementsScenes[sceneIdx].sourceVideoSlot,
          variants: [{ id: variantId, status: 'success', createdAt: Date.now(), createdBy: 'manual', displayUrl: dataUrl, sourceUrl: dataUrl }],
          selectedVariantId: variantId,
        },
      })
    }
    reader.readAsDataURL(file)
    e.currentTarget.value = ''
  }, [draft.multiElementsScenes, patchScene])

  const handleGenerate = useCallback(async (idx: number) => {
    if (generating) return
    const scene = draft.multiElementsScenes[idx]
    const videoUrl = getSlotUrl(scene.sourceVideoSlot)
    if (!videoUrl) { window.$message?.warning?.('请上传待编辑视频'); return }
    if (!scene.editPrompt) { window.$message?.warning?.('请输入编辑描述'); return }

    setGenerating(true)
    const variantId = makeVariantId()

    setDraftSafe(prev => {
      const scenes = [...prev.multiElementsScenes]
      scenes[idx] = {
        ...scenes[idx],
        resultSlot: {
          ...scenes[idx].resultSlot,
          variants: [...scenes[idx].resultSlot.variants, { id: variantId, status: 'running', createdAt: Date.now(), createdBy: 'auto' } as EcomMediaVariant],
          selectedVariantId: variantId,
        },
      }
      return { ...prev, multiElementsScenes: scenes }
    })

    try {
      const result = await generateMultiElementsVideo({
        initVideoUrl: videoUrl,
        segments: [{ prompt: scene.editPrompt }],
        prompt: scene.prompt || undefined,
      })

      setDraftSafe(prev => {
        const scenes = [...prev.multiElementsScenes]
        scenes[idx] = {
          ...scenes[idx],
          taskId: result.taskId,
          resultSlot: {
            ...scenes[idx].resultSlot,
            variants: scenes[idx].resultSlot.variants.map(v =>
              v.id === variantId ? { ...v, status: 'success' as const, sourceUrl: result.videoUrl, displayUrl: result.videoUrl, taskId: result.taskId } : v
            ),
          },
        }
        return { ...prev, multiElementsScenes: scenes }
      })
      useAssetsStore.getState().addAsset({ type: 'video', src: result.videoUrl, title: `${draft.product.name || '商品'} · 多模态编辑` })
      bgCacheToProject(result.videoUrl, draft.projectId, 'video')
      window.$message?.success?.('多模态编辑完成')
    } catch (err: any) {
      setDraftSafe(prev => {
        const scenes = [...prev.multiElementsScenes]
        scenes[idx] = {
          ...scenes[idx],
          resultSlot: {
            ...scenes[idx].resultSlot,
            variants: scenes[idx].resultSlot.variants.map(v =>
              v.id === variantId ? { ...v, status: 'error' as const, error: err?.message || '生成失败' } : v
            ),
          },
        }
        return { ...prev, multiElementsScenes: scenes }
      })
      window.$message?.error?.(err?.message || '多模态编辑失败')
    } finally {
      setGenerating(false)
    }
  }, [draft, generating, setDraftSafe, setGenerating])

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold">多模态视频编辑</h3>
        <Button onClick={handleAdd} className="gap-1"><Plus className="h-4 w-4" /> 新增</Button>
      </div>

      {draft.multiElementsScenes.length === 0 && (
        <div className="text-center py-12 text-sm text-[var(--text-secondary)] opacity-50">
          点击"新增"，上传视频并描述要编辑的元素
        </div>
      )}

      {draft.multiElementsScenes.map((scene, idx) => {
        const sourceV = scene.sourceVideoSlot.variants[0]
        const resultV = scene.resultSlot.variants.find(v => v.id === scene.resultSlot.selectedVariantId) || scene.resultSlot.variants[scene.resultSlot.variants.length - 1]

        return (
          <div key={scene.id} className="rounded-xl border border-[var(--border-color)] bg-[var(--bg-secondary)] p-4">
            <div className="flex items-center justify-between mb-3">
              <span className="text-xs font-semibold">#{idx + 1}</span>
              <div className="flex gap-2">
                <Button size="sm" onClick={() => handleGenerate(idx)} disabled={generating} className="gap-1">
                  {generating ? <Loader2 className="h-3 w-3 animate-spin" /> : <Play className="h-3 w-3" />} 生成
                </Button>
                <Button size="sm" variant="ghost" className="text-red-500" onClick={() => setDraftSafe(prev => ({ ...prev, multiElementsScenes: prev.multiElementsScenes.filter((_, i) => i !== idx) }))}>
                  <Trash2 className="h-3 w-3" />
                </Button>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <div className="text-[10px] text-[var(--text-secondary)] mb-1">待编辑视频</div>
                <label className="block aspect-video rounded-lg border-2 border-dashed border-[var(--border-color)] bg-[var(--bg-tertiary)] cursor-pointer overflow-hidden flex items-center justify-center">
                  {sourceV ? (
                    sourceV.displayUrl ? <video src={sourceV.displayUrl} className="h-full w-full object-cover" muted /> : <div className="text-[10px] text-green-500">视频已上传</div>
                  ) : <Upload className="h-6 w-6 text-[var(--text-secondary)] opacity-30" />}
                  <input type="file" accept="video/*" className="hidden" onChange={e => handleUploadVideo(idx, e)} />
                </label>
              </div>
              <div>
                <div className="text-[10px] text-[var(--text-secondary)] mb-1">生成结果</div>
                <div className="aspect-video rounded-lg bg-[var(--bg-tertiary)] overflow-hidden flex items-center justify-center">
                  {resultV ? (
                    resultV.status === 'success' && resultV.sourceUrl ? (
                      <video src={resultV.sourceUrl} className="h-full w-full object-cover" controls />
                    ) : <VariantThumb variant={resultV} className="h-full w-full" />
                  ) : <span className="text-xs text-[var(--text-secondary)] opacity-30">待生成</span>}
                </div>
              </div>
            </div>

            <textarea
              value={scene.editPrompt}
              onChange={e => patchScene(idx, { editPrompt: e.target.value })}
              placeholder="编辑描述：描述要增加/替换/删除的元素..."
              rows={2}
              className="mt-3 w-full rounded-lg border border-[var(--border-color)] bg-[var(--bg-primary)] px-2 py-1.5 text-xs resize-none focus:border-[var(--accent-color)] focus:outline-none"
            />

            <textarea
              value={scene.prompt}
              onChange={e => patchScene(idx, { prompt: e.target.value })}
              placeholder="整体描述（可选）..."
              rows={2}
              className="mt-2 w-full rounded-lg border border-[var(--border-color)] bg-[var(--bg-primary)] px-2 py-1.5 text-xs resize-none focus:border-[var(--accent-color)] focus:outline-none"
            />

            <VariantHistoryStrip
              variants={scene.resultSlot.variants}
              selectedVariantId={scene.resultSlot.selectedVariantId}
              mediaType="video"
              onSelect={vid => patchScene(idx, { resultSlot: { ...scene.resultSlot, selectedVariantId: vid } })}
            />
          </div>
        )
      })}
    </div>
  )
}
