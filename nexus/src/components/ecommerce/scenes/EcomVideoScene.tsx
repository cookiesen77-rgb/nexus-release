import React, { useCallback, useState } from 'react'
import { Plus, Trash2, Loader2, Upload, Play, Video, Mic, Download } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import type { EcomDraftV1, EcomVideoType, EcomMediaVariant } from '@/lib/ecommerce/types'
import { VIDEO_MODELS } from '@/config/models'
import { generateEcomVideo, buildProductVideoPrompt, bgCacheToProject } from '@/lib/ecommerce/generateMedia'
import { generateAvatarVideo } from '@/lib/ecommerce/klingAdvanced'
import { generateTTS, TTS_MODELS } from '@/lib/ecommerce/tts'
import { useAssetsStore } from '@/store/assets'
import { createEmptySlot } from '@/lib/ecommerce/draftStorage'
import { VariantThumb } from '../shared/VariantThumb'
import { VariantHistoryStrip } from '../shared/VariantHistoryStrip'

interface SceneProps {
  draft: EcomDraftV1
  setDraftSafe: (fn: React.SetStateAction<EcomDraftV1>) => void
  onOpenMediaPicker?: (opts: { kinds: string[]; multiple?: boolean; onConfirm: (items: any[]) => void }) => void
  onAddToCanvas?: (url: string, label: string) => void
}

const makeVariantId = () => `var_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`

const VIDEO_TYPE_OPTIONS: { value: EcomVideoType; label: string }[] = [
  { value: 'product_rotate', label: '360° 旋转展示' },
  { value: 'product_showcase', label: '电影级展示' },
  { value: 'digital_human', label: '数字人口播' },
  { value: 'tts_avatar', label: 'TTS 数字人' },
  { value: 'custom', label: '自定义' },
]

const VIDEO_STYLE_PRESETS = [
  { label: '真实产品展示', hint: '真实产品在纯色背景下缓慢旋转，自然光照，保持产品原始外观和材质细节' },
  { label: '电影级质感', hint: '电影级画面，浅景深，慢速推镜头，戏剧性光影，产品居中' },
  { label: '生活场景', hint: '产品在温馨的日常生活场景中被自然使用，暖色调，自然光' },
  { label: '开箱展示', hint: '俯拍角度，双手拆开精美包装，逐一展示产品和配件' },
  { label: '微距特写', hint: '极近距离拍摄产品材质纹理，缓慢平移，展现工艺细节' },
  { label: '模特展示', hint: '模特自然展示产品，自信微笑，柔和的棚拍灯光，干净背景' },
  { label: '对比展示', hint: '产品使用前后对比，分屏或过渡效果，突出产品效果' },
  { label: '节日促销', hint: '喜庆氛围，产品搭配节日装饰，动感文字叠加区域' },
]

const getVideoModelConfig = (key: string) => (VIDEO_MODELS as any[]).find(m => m.key === key)

export default function EcomVideoScene({ draft, setDraftSafe }: SceneProps) {
  const [generating, setGenerating] = useState(false)
  const [ttsGenerating, setTtsGenerating] = useState<string | null>(null)

  const handleDownload = useCallback((url: string, filename: string) => {
    if (!url) return
    import('@/lib/download').then(({ downloadFile }) => {
      downloadFile({ url, filename }).catch((err: any) => window.$message?.error?.(err?.message || '下载失败'))
    })
  }, [])

  const patchScene = useCallback((idx: number, patch: Partial<EcomDraftV1['videoScenes'][0]>) => {
    setDraftSafe(prev => {
      const scenes = [...prev.videoScenes]
      scenes[idx] = { ...scenes[idx], ...patch }
      return { ...prev, videoScenes: scenes }
    })
  }, [setDraftSafe])

  const handleAddVideoScene = useCallback(() => {
    setDraftSafe(prev => ({
      ...prev,
      videoScenes: [...prev.videoScenes, {
        id: `video_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        videoType: 'product_rotate' as EcomVideoType,
        prompt: '',
        firstFrameSlot: createEmptySlot('首帧画面'),
        videoSlot: createEmptySlot('视频'),
      }],
    }))
  }, [setDraftSafe])

  const handleFirstFrameUpload = useCallback((idx: number, e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = () => {
      const dataUrl = reader.result as string
      if (!dataUrl) return
      const variantId = makeVariantId()
      patchScene(idx, {
        firstFrameSlot: {
          ...draft.videoScenes[idx].firstFrameSlot,
          variants: [{ id: variantId, status: 'success', createdAt: Date.now(), createdBy: 'manual', displayUrl: dataUrl }],
          selectedVariantId: variantId,
        },
      })
    }
    reader.readAsDataURL(file)
    e.currentTarget.value = ''
  }, [draft.videoScenes, patchScene])

  const handleAudioUpload = useCallback((idx: number, e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = () => {
      const dataUrl = reader.result as string
      if (!dataUrl) return
      patchScene(idx, { digitalHumanAudioUrl: dataUrl })
    }
    reader.readAsDataURL(file)
    e.currentTarget.value = ''
  }, [patchScene])

  const handleGenerateTTS = useCallback(async (idx: number) => {
    const scene = draft.videoScenes[idx]
    if (!scene?.ttsText?.trim()) { window.$message?.warning?.('请输入 TTS 文本'); return }

    setTtsGenerating(scene.id)
    try {
      const result = await generateTTS({ text: scene.ttsText, model: draft.models.ttsModelKey })
      patchScene(idx, { ttsAudioDataUrl: result.audioDataUrl })
      window.$message?.success?.('语音生成成功')
    } catch (err: any) {
      window.$message?.error?.(err?.message || 'TTS 生成失败')
    } finally {
      setTtsGenerating(null)
    }
  }, [draft.videoScenes, draft.models.ttsModelKey, patchScene])

  const handleGenerateVideo = useCallback(async (idx: number) => {
    if (generating) return
    const scene = draft.videoScenes[idx]
    if (!scene) return

    setGenerating(true)
    const variantId = makeVariantId()

    setDraftSafe(prev => {
      const scenes = [...prev.videoScenes]
      scenes[idx] = {
        ...scenes[idx],
        videoSlot: {
          ...scenes[idx].videoSlot,
          variants: [...scenes[idx].videoSlot.variants, { id: variantId, status: 'running', createdAt: Date.now(), createdBy: 'auto' } as EcomMediaVariant],
          selectedVariantId: variantId,
        },
      }
      return { ...prev, videoScenes: scenes }
    })

    try {
      const prompt = scene.prompt || buildProductVideoPrompt(draft, scene.videoType)
      const firstV = scene.firstFrameSlot.variants[0]
      const firstFrameUrl = firstV?.displayUrl || firstV?.sourceUrl || undefined

      let videoUrl: string

      if (scene.videoType === 'tts_avatar') {
        if (!firstFrameUrl) throw new Error('TTS 数字人需要上传人像照片')
        let audioSource = scene.ttsAudioDataUrl
        if (!audioSource) {
          if (!scene.ttsText?.trim()) throw new Error('请输入 TTS 文本或先生成语音')
          const ttsResult = await generateTTS({ text: scene.ttsText, model: draft.models.ttsModelKey })
          audioSource = ttsResult.rawBase64
          patchScene(idx, { ttsAudioDataUrl: ttsResult.audioDataUrl })
        }
        const result = await generateAvatarVideo({ image: firstFrameUrl, soundFile: audioSource, prompt })
        videoUrl = result.videoUrl
      } else if (scene.videoType === 'digital_human') {
        if (!firstFrameUrl) throw new Error('数字人需要上传人像照片')
        if (!scene.digitalHumanAudioUrl) throw new Error('数字人需要上传音频文件')
        const result = await generateAvatarVideo({ image: firstFrameUrl, soundFile: scene.digitalHumanAudioUrl, prompt })
        videoUrl = result.videoUrl
      } else {
        const result = await generateEcomVideo({
          modelKey: draft.models.videoModelKey,
          prompt,
          ratio: draft.models.videoRatio,
          duration: draft.models.videoDuration,
          firstFrameUrl,
        })
        videoUrl = result.videoUrl
      }

      setDraftSafe(prev => {
        const scenes = [...prev.videoScenes]
        scenes[idx] = {
          ...scenes[idx],
          videoSlot: {
            ...scenes[idx].videoSlot,
            variants: scenes[idx].videoSlot.variants.map(v =>
              v.id === variantId ? { ...v, status: 'success' as const, sourceUrl: videoUrl, displayUrl: videoUrl, promptSnapshot: prompt } : v
            ),
          },
        }
        return { ...prev, videoScenes: scenes }
      })
      useAssetsStore.getState().addAsset({ type: 'video', src: videoUrl, title: `${draft.product.name || '商品'} · 视频`, model: draft.models.videoModelKey })
      bgCacheToProject(videoUrl, draft.projectId, 'video', draft.models.videoModelKey)
      window.$message?.success?.('视频生成成功')
    } catch (err: any) {
      setDraftSafe(prev => {
        const scenes = [...prev.videoScenes]
        scenes[idx] = {
          ...scenes[idx],
          videoSlot: {
            ...scenes[idx].videoSlot,
            variants: scenes[idx].videoSlot.variants.map(v =>
              v.id === variantId ? { ...v, status: 'error' as const, error: err?.message || '视频生成失败' } : v
            ),
          },
        }
        return { ...prev, videoScenes: scenes }
      })
      window.$message?.error?.(err?.message || '视频生成失败')
    } finally {
      setGenerating(false)
    }
  }, [draft, generating, setDraftSafe, patchScene])

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold">带货视频</h3>
        <Button onClick={handleAddVideoScene} className="gap-1"><Plus className="h-4 w-4" /> 新增视频</Button>
      </div>

      {draft.videoScenes.length === 0 && (
        <div className="text-center py-12 text-sm text-[var(--text-secondary)] opacity-50">
          点击"新增视频"，选择视频类型并生成
        </div>
      )}

      {draft.videoScenes.map((scene, idx) => {
        const firstV = scene.firstFrameSlot?.variants?.[0]
        const videoVariants = scene.videoSlot?.variants || []
        const videoV = videoVariants.find(v => v.id === scene.videoSlot?.selectedVariantId) || videoVariants[videoVariants.length - 1]
        const modelCfg = getVideoModelConfig(draft.models.videoModelKey)

        return (
          <div key={scene.id} className="rounded-xl border border-[var(--border-color)] bg-[var(--bg-secondary)] p-4">
            <div className="flex items-center justify-between mb-3">
              <span className="text-xs font-semibold">视频 #{idx + 1}</span>
              <div className="flex gap-2">
                <Button size="sm" onClick={() => handleGenerateVideo(idx)} disabled={generating} className="gap-1">
                  {generating ? <Loader2 className="h-3 w-3 animate-spin" /> : <Play className="h-3 w-3" />} 生成视频
                </Button>
                <Button size="sm" variant="ghost" className="text-red-500" onClick={() => setDraftSafe(prev => ({ ...prev, videoScenes: prev.videoScenes.filter((_, i) => i !== idx) }))}>
                  <Trash2 className="h-3 w-3" />
                </Button>
              </div>
            </div>

            <div className="space-y-3">
              <div className="flex gap-3">
                <select
                  value={scene.videoType}
                  onChange={e => patchScene(idx, { videoType: e.target.value as EcomVideoType })}
                  className="rounded-lg border border-[var(--border-color)] bg-[var(--bg-primary)] px-2 py-1.5 text-xs"
                >
                  {VIDEO_TYPE_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
                <select
                  value={draft.models.videoRatio}
                  onChange={e => setDraftSafe(prev => ({ ...prev, models: { ...prev.models, videoRatio: e.target.value } }))}
                  className="rounded-lg border border-[var(--border-color)] bg-[var(--bg-primary)] px-2 py-1.5 text-xs"
                >
                  {(modelCfg?.ratios || ['16:9', '9:16']).map((r: string) => (
                    <option key={r} value={r}>{r === '16:9' ? '16:9 横屏' : r === '9:16' ? '9:16 竖屏' : r}</option>
                  ))}
                </select>
                <select
                  value={String(draft.models.videoDuration)}
                  onChange={e => setDraftSafe(prev => ({ ...prev, models: { ...prev.models, videoDuration: Number(e.target.value) } }))}
                  className="rounded-lg border border-[var(--border-color)] bg-[var(--bg-primary)] px-2 py-1.5 text-xs"
                >
                  {(modelCfg?.durs || [{ label: '5 秒', key: 5 }, { label: '10 秒', key: 10 }]).map((d: any) => (
                    <option key={d.key} value={String(d.key)}>{d.label}</option>
                  ))}
                </select>
              </div>
              {modelCfg?.tips && <div className="text-[10px] text-[var(--text-secondary)] opacity-60 mt-1">{modelCfg.tips}</div>}

              <div className="flex flex-wrap gap-1">
                {VIDEO_STYLE_PRESETS.map(p => (
                  <button
                    key={p.label}
                    onClick={() => patchScene(idx, { prompt: p.hint })}
                    className="rounded-full border border-[var(--border-color)] px-2 py-0.5 text-[10px] text-[var(--text-secondary)] hover:border-[var(--accent-color)] hover:text-[var(--accent-color)]"
                  >
                    {p.label}
                  </button>
                ))}
              </div>

              <textarea
                value={scene.prompt}
                onChange={e => patchScene(idx, { prompt: e.target.value })}
                placeholder="视频描述提示词（留空使用默认模板）..."
                rows={2}
                className="w-full rounded-lg border border-[var(--border-color)] bg-[var(--bg-primary)] px-2 py-1.5 text-xs resize-none focus:border-[var(--accent-color)] focus:outline-none"
              />

              {scene.videoType === 'tts_avatar' && (
                <div className="space-y-2 rounded-lg border border-[var(--border-color)] bg-[var(--bg-primary)] p-3">
                  <div className="text-[10px] font-medium text-[var(--text-secondary)]">TTS 语音合成</div>
                  <textarea
                    value={scene.ttsText || ''}
                    onChange={e => patchScene(idx, { ttsText: e.target.value })}
                    placeholder="输入口播文本..."
                    rows={3}
                    className="w-full rounded-lg border border-[var(--border-color)] bg-[var(--bg-secondary)] px-2 py-1.5 text-xs resize-none focus:border-[var(--accent-color)] focus:outline-none"
                  />
                  <div className="flex items-center gap-2">
                    <select
                      value={draft.models.ttsModelKey}
                      onChange={e => setDraftSafe(prev => ({ ...prev, models: { ...prev.models, ttsModelKey: e.target.value } }))}
                      className="rounded-lg border border-[var(--border-color)] bg-[var(--bg-secondary)] px-2 py-1 text-[11px]"
                    >
                      {TTS_MODELS.map(m => <option key={m.key} value={m.key}>{m.label}</option>)}
                    </select>
                    <Button
                      size="sm"
                      variant="secondary"
                      disabled={ttsGenerating === scene.id || !scene.ttsText?.trim()}
                      onClick={() => handleGenerateTTS(idx)}
                      className="gap-1"
                    >
                      {ttsGenerating === scene.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <Mic className="h-3 w-3" />}
                      生成语音
                    </Button>
                  </div>
                  {scene.ttsAudioDataUrl && (
                    <audio src={scene.ttsAudioDataUrl} controls className="w-full h-8" />
                  )}
                </div>
              )}

              {scene.videoType === 'digital_human' && (
                <div className="flex items-center gap-2">
                  <span className="text-[10px] text-[var(--text-secondary)]">口播音频：</span>
                  {scene.digitalHumanAudioUrl ? (
                    <>
                      <span className="text-[10px] text-green-500">已上传</span>
                      <button onClick={() => patchScene(idx, { digitalHumanAudioUrl: undefined })} className="text-[10px] text-red-500">移除</button>
                    </>
                  ) : (
                    <label className="cursor-pointer text-[10px] text-[var(--accent-color)] hover:underline">
                      <Upload className="mr-0.5 inline h-3 w-3" />上传音频
                      <input type="file" accept="audio/*" className="hidden" onChange={e => handleAudioUpload(idx, e)} />
                    </label>
                  )}
                </div>
              )}

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <div className="text-[10px] text-[var(--text-secondary)] mb-1">
                    {scene.videoType === 'digital_human' || scene.videoType === 'tts_avatar' ? '人像照片' : '首帧画面（可选）'}
                  </div>
                  <label className="block aspect-video rounded-lg border-2 border-dashed border-[var(--border-color)] bg-[var(--bg-tertiary)] cursor-pointer overflow-hidden flex items-center justify-center">
                    {firstV ? <VariantThumb variant={firstV} className="h-full w-full" /> : <Upload className="h-6 w-6 text-[var(--text-secondary)] opacity-30" />}
                    <input type="file" accept="image/*" className="hidden" onChange={e => handleFirstFrameUpload(idx, e)} />
                  </label>
                </div>
                <div>
                  <div className="text-[10px] text-[var(--text-secondary)] mb-1">生成结果</div>
                  <div className="relative aspect-video rounded-lg bg-[var(--bg-tertiary)] overflow-hidden flex items-center justify-center">
                    {videoV ? (
                      videoV.status === 'success' && videoV.sourceUrl ? (
                        <>
                          <video src={videoV.sourceUrl} className="h-full w-full object-cover" controls />
                          <button onClick={() => handleDownload(videoV.sourceUrl!, `video_${idx}_${Date.now()}.mp4`)}
                            className="absolute right-2 top-2 rounded-lg bg-black/50 p-1.5 text-white hover:bg-black/70" title="下载">
                            <Download className="h-4 w-4" />
                          </button>
                        </>
                      ) : (
                        <VariantThumb variant={videoV} className="h-full w-full" />
                      )
                    ) : (
                      <Video className="h-8 w-8 text-[var(--text-secondary)] opacity-20" />
                    )}
                  </div>
                </div>
              </div>

              <VariantHistoryStrip
                variants={scene.videoSlot?.variants || []}
                selectedVariantId={scene.videoSlot?.selectedVariantId}
                mediaType="video"
                onSelect={vid => setDraftSafe(prev => {
                  const scenes = [...prev.videoScenes]
                  scenes[idx] = { ...scenes[idx], videoSlot: { ...scenes[idx].videoSlot, selectedVariantId: vid } }
                  return { ...prev, videoScenes: scenes }
                })}
              />
            </div>
          </div>
        )
      })}
    </div>
  )
}
