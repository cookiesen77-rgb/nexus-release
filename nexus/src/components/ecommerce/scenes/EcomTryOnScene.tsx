import React, { useCallback } from 'react'
import { Plus, Trash2, Loader2, Upload, Play } from 'lucide-react'
import { Button } from '@/components/ui/button'
import type { EcomDraftV1, EcomTryOnMode, EcomMediaVariant } from '@/lib/ecommerce/types'
import { generateAvatarVideo, generateMotionControlVideo, generateMultiElementsVideo } from '@/lib/ecommerce/klingAdvanced'
import { bgCacheToProject } from '@/lib/ecommerce/generateMedia'
import { createEmptySlot } from '@/lib/ecommerce/draftStorage'
import { VariantThumb } from '../shared/VariantThumb'
import { VariantHistoryStrip } from '../shared/VariantHistoryStrip'

interface SceneProps {
  draft: EcomDraftV1
  setDraftSafe: (fn: React.SetStateAction<EcomDraftV1>) => void
  generating: boolean
  setGenerating: (v: boolean) => void
  onOpenMediaPicker?: (opts: { kinds: string[]; multiple?: boolean; onConfirm: (items: any[]) => void }) => void
}

const makeVariantId = () => `var_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`

const MODE_OPTIONS: { value: EcomTryOnMode; label: string }[] = [
  { value: 'avatar_image2video', label: '数字人口播' },
  { value: 'motion_control', label: '动作控制' },
  { value: 'multi_elements', label: '多模态编辑' },
]

export default function EcomTryOnScene({ draft, setDraftSafe, generating, setGenerating }: SceneProps) {

  const patchScene = useCallback((idx: number, patch: Partial<EcomDraftV1['tryOnScenes'][0]>) => {
    setDraftSafe(prev => {
      const scenes = [...prev.tryOnScenes]
      scenes[idx] = { ...scenes[idx], ...patch }
      return { ...prev, tryOnScenes: scenes }
    })
  }, [setDraftSafe])

  const handleAddTryOn = useCallback(() => {
    setDraftSafe(prev => ({
      ...prev,
      tryOnScenes: [...prev.tryOnScenes, {
        id: `tryon_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        mode: 'avatar_image2video' as EcomTryOnMode,
        prompt: '',
        sourceImageSlot: createEmptySlot('人像/商品图'),
        referenceVideoSlot: createEmptySlot('参考视频'),
        audioSlot: createEmptySlot('音频'),
        resultSlot: createEmptySlot('生成结果'),
        modeParams: { avatarMode: 'std' },
      }],
    }))
  }, [setDraftSafe])

  const handleUpload = useCallback((
    sceneIdx: number,
    field: 'sourceImageSlot' | 'referenceVideoSlot' | 'audioSlot',
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

  const getSlotUrl = (slot: { variants: EcomMediaVariant[]; selectedVariantId?: string }): string => {
    const v = slot.variants.find(x => x.id === slot.selectedVariantId) || slot.variants[0]
    return v?.displayUrl || v?.sourceUrl || ''
  }

  const handleGenerate = useCallback(async (idx: number) => {
    if (generating) return
    const scene = draft.tryOnScenes[idx]
    if (!scene) return

    setGenerating(true)
    const variantId = makeVariantId()

    setDraftSafe(prev => {
      const scenes = [...prev.tryOnScenes]
      scenes[idx] = {
        ...scenes[idx],
        resultSlot: {
          ...scenes[idx].resultSlot,
          variants: [...scenes[idx].resultSlot.variants, { id: variantId, status: 'running', createdAt: Date.now(), createdBy: 'auto' } as EcomMediaVariant],
          selectedVariantId: variantId,
        },
      }
      return { ...prev, tryOnScenes: scenes }
    })

    try {
      let videoUrl: string

      if (scene.mode === 'avatar_image2video') {
        const imageUrl = getSlotUrl(scene.sourceImageSlot)
        if (!imageUrl) throw new Error('请上传人像图片')
        const audioUrl = getSlotUrl(scene.audioSlot)
        if (!audioUrl) throw new Error('请上传音频文件')
        const result = await generateAvatarVideo({
          image: imageUrl,
          soundFile: audioUrl,
          prompt: scene.prompt || undefined,
          mode: scene.modeParams.avatarMode || 'std',
        })
        videoUrl = result.videoUrl
      } else if (scene.mode === 'motion_control') {
        const imageUrl = getSlotUrl(scene.sourceImageSlot)
        if (!imageUrl) throw new Error('请上传源图片')
        const refVideoUrl = getSlotUrl(scene.referenceVideoSlot)
        if (!refVideoUrl) throw new Error('请上传参考视频')
        const result = await generateMotionControlVideo({
          imageUrl,
          videoUrl: refVideoUrl,
          prompt: scene.prompt || undefined,
          keepOriginalSound: scene.modeParams.keepOriginalSound,
          characterOrientation: scene.modeParams.characterOrientation,
        })
        videoUrl = result.videoUrl
      } else {
        const refVideoUrl = getSlotUrl(scene.referenceVideoSlot)
        if (!refVideoUrl) throw new Error('请上传参考视频')
        const result = await generateMultiElementsVideo({
          initVideoUrl: refVideoUrl,
          segments: [{ prompt: scene.prompt || '编辑视频元素' }],
          prompt: scene.prompt || undefined,
        })
        videoUrl = result.videoUrl
      }

      setDraftSafe(prev => {
        const scenes = [...prev.tryOnScenes]
        scenes[idx] = {
          ...scenes[idx],
          resultSlot: {
            ...scenes[idx].resultSlot,
            variants: scenes[idx].resultSlot.variants.map(v =>
              v.id === variantId ? { ...v, status: 'success' as const, sourceUrl: videoUrl, displayUrl: videoUrl } : v
            ),
          },
        }
        return { ...prev, tryOnScenes: scenes }
      })
      bgCacheToProject(videoUrl, draft.projectId, 'video')
      window.$message?.success?.('生成完成')
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
      window.$message?.error?.(err?.message || '生成失败')
    } finally {
      setGenerating(false)
    }
  }, [draft, generating, setDraftSafe, setGenerating])

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold">数字人 / 动作控制</h3>
        <Button onClick={handleAddTryOn} className="gap-1"><Plus className="h-4 w-4" /> 新增</Button>
      </div>

      {draft.tryOnScenes.length === 0 && (
        <div className="text-center py-12 text-sm text-[var(--text-secondary)] opacity-50">
          点击"新增"，选择模式并上传素材
        </div>
      )}

      {draft.tryOnScenes.map((scene, idx) => {
        const sourceV = scene.sourceImageSlot.variants[0]
        const refVideoV = scene.referenceVideoSlot.variants[0]
        const audioV = scene.audioSlot.variants[0]
        const resultV = scene.resultSlot.variants.find(v => v.id === scene.resultSlot.selectedVariantId) || scene.resultSlot.variants[scene.resultSlot.variants.length - 1]

        return (
          <div key={scene.id} className="rounded-xl border border-[var(--border-color)] bg-[var(--bg-secondary)] p-4">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <span className="text-xs font-semibold">#{idx + 1}</span>
                <select
                  value={scene.mode}
                  onChange={e => patchScene(idx, { mode: e.target.value as EcomTryOnMode })}
                  className="rounded-lg border border-[var(--border-color)] bg-[var(--bg-primary)] px-2 py-1 text-[11px]"
                >
                  {MODE_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              </div>
              <div className="flex gap-2">
                <Button size="sm" onClick={() => handleGenerate(idx)} disabled={generating} className="gap-1">
                  {generating ? <Loader2 className="h-3 w-3 animate-spin" /> : <Play className="h-3 w-3" />} 生成
                </Button>
                <Button size="sm" variant="ghost" className="text-red-500" onClick={() => setDraftSafe(prev => ({ ...prev, tryOnScenes: prev.tryOnScenes.filter((_, i) => i !== idx) }))}>
                  <Trash2 className="h-3 w-3" />
                </Button>
              </div>
            </div>

            {/* Mode-specific inputs */}
            {scene.mode === 'avatar_image2video' && (
              <div className="space-y-3">
                <div className="grid grid-cols-3 gap-3">
                  {/* Source image */}
                  <div>
                    <div className="text-[10px] text-[var(--text-secondary)] mb-1">人像图片</div>
                    <label className="block aspect-[3/4] rounded-lg border-2 border-dashed border-[var(--border-color)] bg-[var(--bg-tertiary)] cursor-pointer overflow-hidden flex items-center justify-center">
                      {sourceV ? <VariantThumb variant={sourceV} className="h-full w-full" /> : <Upload className="h-6 w-6 text-[var(--text-secondary)] opacity-30" />}
                      <input type="file" accept="image/*" className="hidden" onChange={e => handleUpload(idx, 'sourceImageSlot', e)} />
                    </label>
                  </div>
                  {/* Audio */}
                  <div>
                    <div className="text-[10px] text-[var(--text-secondary)] mb-1">音频文件</div>
                    <label className="block aspect-[3/4] rounded-lg border-2 border-dashed border-[var(--border-color)] bg-[var(--bg-tertiary)] cursor-pointer overflow-hidden flex items-center justify-center">
                      {audioV ? <div className="text-[10px] text-green-500">音频已上传</div> : <Upload className="h-6 w-6 text-[var(--text-secondary)] opacity-30" />}
                      <input type="file" accept="audio/*" className="hidden" onChange={e => handleUpload(idx, 'audioSlot', e)} />
                    </label>
                  </div>
                  {/* Result */}
                  <div>
                    <div className="text-[10px] text-[var(--text-secondary)] mb-1">生成结果</div>
                    <div className="aspect-[3/4] rounded-lg bg-[var(--bg-tertiary)] overflow-hidden flex items-center justify-center">
                      {resultV ? (
                        resultV.status === 'success' && resultV.sourceUrl ? (
                          <video src={resultV.sourceUrl} className="h-full w-full object-cover" controls />
                        ) : <VariantThumb variant={resultV} className="h-full w-full" />
                      ) : <span className="text-xs text-[var(--text-secondary)] opacity-30">待生成</span>}
                    </div>
                  </div>
                </div>
                <div className="flex gap-2">
                  <select
                    value={scene.modeParams.avatarMode || 'std'}
                    onChange={e => patchScene(idx, { modeParams: { ...scene.modeParams, avatarMode: e.target.value as 'std' | 'pro' } })}
                    className="rounded-lg border border-[var(--border-color)] bg-[var(--bg-primary)] px-2 py-1 text-[11px]"
                  >
                    <option value="std">标准模式</option>
                    <option value="pro">专业模式</option>
                  </select>
                </div>
              </div>
            )}

            {scene.mode === 'motion_control' && (
              <div className="space-y-3">
                <div className="grid grid-cols-3 gap-3">
                  <div>
                    <div className="text-[10px] text-[var(--text-secondary)] mb-1">源图片</div>
                    <label className="block aspect-[3/4] rounded-lg border-2 border-dashed border-[var(--border-color)] bg-[var(--bg-tertiary)] cursor-pointer overflow-hidden flex items-center justify-center">
                      {sourceV ? <VariantThumb variant={sourceV} className="h-full w-full" /> : <Upload className="h-6 w-6 text-[var(--text-secondary)] opacity-30" />}
                      <input type="file" accept="image/*" className="hidden" onChange={e => handleUpload(idx, 'sourceImageSlot', e)} />
                    </label>
                  </div>
                  <div>
                    <div className="text-[10px] text-[var(--text-secondary)] mb-1">参考视频</div>
                    <label className="block aspect-[3/4] rounded-lg border-2 border-dashed border-[var(--border-color)] bg-[var(--bg-tertiary)] cursor-pointer overflow-hidden flex items-center justify-center">
                      {refVideoV ? (
                        refVideoV.displayUrl ? <video src={refVideoV.displayUrl} className="h-full w-full object-cover" muted /> : <div className="text-[10px] text-green-500">视频已上传</div>
                      ) : <Upload className="h-6 w-6 text-[var(--text-secondary)] opacity-30" />}
                      <input type="file" accept="video/*" className="hidden" onChange={e => handleUpload(idx, 'referenceVideoSlot', e)} />
                    </label>
                  </div>
                  <div>
                    <div className="text-[10px] text-[var(--text-secondary)] mb-1">生成结果</div>
                    <div className="aspect-[3/4] rounded-lg bg-[var(--bg-tertiary)] overflow-hidden flex items-center justify-center">
                      {resultV ? (
                        resultV.status === 'success' && resultV.sourceUrl ? (
                          <video src={resultV.sourceUrl} className="h-full w-full object-cover" controls />
                        ) : <VariantThumb variant={resultV} className="h-full w-full" />
                      ) : <span className="text-xs text-[var(--text-secondary)] opacity-30">待生成</span>}
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <label className="flex items-center gap-1 text-[11px] text-[var(--text-secondary)]">
                    <input
                      type="checkbox"
                      checked={scene.modeParams.keepOriginalSound ?? false}
                      onChange={e => patchScene(idx, { modeParams: { ...scene.modeParams, keepOriginalSound: e.target.checked } })}
                      className="rounded"
                    />
                    保留原始音频
                  </label>
                  <select
                    value={scene.modeParams.characterOrientation || 'up'}
                    onChange={e => patchScene(idx, { modeParams: { ...scene.modeParams, characterOrientation: e.target.value as 'up' | 'down' | 'left' | 'right' } })}
                    className="rounded-lg border border-[var(--border-color)] bg-[var(--bg-primary)] px-2 py-1 text-[11px]"
                  >
                    <option value="up">朝上</option>
                    <option value="down">朝下</option>
                    <option value="left">朝左</option>
                    <option value="right">朝右</option>
                  </select>
                </div>
              </div>
            )}

            {scene.mode === 'multi_elements' && (
              <div className="space-y-3">
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <div className="text-[10px] text-[var(--text-secondary)] mb-1">参考视频</div>
                    <label className="block aspect-video rounded-lg border-2 border-dashed border-[var(--border-color)] bg-[var(--bg-tertiary)] cursor-pointer overflow-hidden flex items-center justify-center">
                      {refVideoV ? (
                        refVideoV.displayUrl ? <video src={refVideoV.displayUrl} className="h-full w-full object-cover" muted /> : <div className="text-[10px] text-green-500">视频已上传</div>
                      ) : <Upload className="h-6 w-6 text-[var(--text-secondary)] opacity-30" />}
                      <input type="file" accept="video/*" className="hidden" onChange={e => handleUpload(idx, 'referenceVideoSlot', e)} />
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
              </div>
            )}

            <textarea
              value={scene.prompt}
              onChange={e => patchScene(idx, { prompt: e.target.value })}
              placeholder="提示词（可选）..."
              rows={2}
              className="mt-3 w-full rounded-lg border border-[var(--border-color)] bg-[var(--bg-primary)] px-2 py-1.5 text-xs resize-none focus:border-[var(--accent-color)] focus:outline-none"
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
