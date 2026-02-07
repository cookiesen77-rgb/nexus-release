import React, { useCallback } from 'react'
import { Wand2, Loader2, Download } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import type { EcomDraftV1, EcomMediaVariant } from '@/lib/ecommerce/types'
import { buildHeroPrompt, collectProductRefUrls, generateEcomImage, bgCacheToProject } from '@/lib/ecommerce/generateMedia'
import { useAssetsStore } from '@/store/assets'
import { VariantThumb } from '../shared/VariantThumb'
import { VariantHistoryStrip } from '../shared/VariantHistoryStrip'

interface Props {
  draft: EcomDraftV1
  setDraftSafe: (fn: React.SetStateAction<EcomDraftV1>) => void
  generating: boolean
  setGenerating: (v: boolean) => void
  onOpenMediaPicker?: (opts: { kinds: string[]; multiple?: boolean; onConfirm: (items: any[]) => void }) => void
}

const makeVariantId = () => `var_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`

export default function EcomHeroScene({ draft, setDraftSafe, generating, setGenerating, onOpenMediaPicker }: Props) {
  const slot = draft.heroScene.slot
  const selectedVariant = slot.variants.find(v => v.id === slot.selectedVariantId) || slot.variants[slot.variants.length - 1] || null

  const handleGenerate = useCallback(async () => {
    if (generating) return
    if (!draft.product.name && draft.productRefs.length === 0) {
      window.$message?.warning?.('请先填写商品名称或上传参考图')
      return
    }
    setGenerating(true)

    const variantId = makeVariantId()
    setDraftSafe(prev => ({
      ...prev,
      heroScene: {
        ...prev.heroScene,
        slot: {
          ...prev.heroScene.slot,
          variants: [...prev.heroScene.slot.variants, { id: variantId, status: 'running', createdAt: Date.now(), createdBy: 'template', modelKey: draft.models.imageModelKey } as EcomMediaVariant],
          selectedVariantId: variantId,
        }
      }
    }))

    try {
      const prompt = buildHeroPrompt(draft)
      const refUrls = collectProductRefUrls(draft)
      const result = await generateEcomImage({
        modelKey: draft.models.imageModelKey,
        prompt,
        size: draft.models.imageSize,
        quality: draft.models.imageQuality,
        refImages: refUrls,
      })

      const displayUrl = result.displayUrl || result.imageUrl
      setDraftSafe(prev => ({
        ...prev,
        heroScene: {
          ...prev.heroScene,
          slot: {
            ...prev.heroScene.slot,
            variants: prev.heroScene.slot.variants.map(v =>
              v.id === variantId ? { ...v, status: 'success' as const, displayUrl, sourceUrl: result.imageUrl, promptSnapshot: prompt } : v
            ),
          }
        }
      }))
      useAssetsStore.getState().addAsset({ type: 'image', src: result.imageUrl || displayUrl, title: `${draft.product.name || '商品'} · 主图`, model: draft.models.imageModelKey })
      bgCacheToProject(result.imageUrl, draft.projectId, 'image', draft.models.imageModelKey)
      window.$message?.success?.('主图生成成功')
    } catch (err: any) {
      setDraftSafe(prev => ({
        ...prev,
        heroScene: {
          ...prev.heroScene,
          slot: {
            ...prev.heroScene.slot,
            variants: prev.heroScene.slot.variants.map(v =>
              v.id === variantId ? { ...v, status: 'error' as const, error: err?.message || '生成失败' } : v
            ),
          }
        }
      }))
      window.$message?.error?.(err?.message || '主图生成失败')
    } finally {
      setGenerating(false)
    }
  }, [draft, generating, setDraftSafe, setGenerating])

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
        <h3 className="text-sm font-semibold">商品主图</h3>
        <Button onClick={handleGenerate} disabled={generating} className="gap-1">
          {generating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Wand2 className="h-4 w-4" />}
          {generating ? '生成中...' : '生成主图'}
        </Button>
      </div>

      {/* Controls */}
      <div className="flex gap-3">
        <select
          value={draft.heroScene.backgroundType}
          onChange={e => setDraftSafe(prev => ({ ...prev, heroScene: { ...prev.heroScene, backgroundType: e.target.value as any } }))}
          className="rounded-lg border border-[var(--border-color)] bg-[var(--bg-primary)] px-2 py-1.5 text-xs"
        >
          <option value="white">白底</option>
          <option value="scene">场景化</option>
          <option value="gradient">渐变背景</option>
          <option value="custom">自定义</option>
        </select>
        <input
          value={draft.heroScene.angle}
          onChange={e => setDraftSafe(prev => ({ ...prev, heroScene: { ...prev.heroScene, angle: e.target.value } }))}
          placeholder="角度 (如: 45度)"
          className="flex-1 rounded-lg border border-[var(--border-color)] bg-[var(--bg-primary)] px-2 py-1.5 text-xs"
        />
      </div>

      {draft.heroScene.backgroundType === 'custom' && (
        <input
          value={draft.heroScene.customBackground}
          onChange={e => setDraftSafe(prev => ({ ...prev, heroScene: { ...prev.heroScene, customBackground: e.target.value } }))}
          placeholder="自定义背景描述..."
          className="w-full rounded-lg border border-[var(--border-color)] bg-[var(--bg-primary)] px-2 py-1.5 text-xs"
        />
      )}

      <textarea
        value={draft.heroScene.prompt}
        onChange={e => setDraftSafe(prev => ({ ...prev, heroScene: { ...prev.heroScene, prompt: e.target.value } }))}
        placeholder="追加提示词（可选），如：增加反光效果、柔和暖光..."
        rows={2}
        className="w-full rounded-lg border border-[var(--border-color)] bg-[var(--bg-primary)] px-2 py-1.5 text-xs resize-none focus:border-[var(--accent-color)] focus:outline-none"
      />

      {/* Preview */}
      <div className="relative flex items-center justify-center rounded-xl border border-[var(--border-color)] bg-[var(--bg-secondary)] p-4 min-h-[400px]">
        {selectedVariant ? (
          <>
            <VariantThumb variant={selectedVariant} className="max-h-[500px] max-w-full h-auto w-auto" />
            {selectedVariant.status === 'success' && (selectedVariant.displayUrl || selectedVariant.sourceUrl) && (
              <button
                onClick={() => handleDownload(selectedVariant.displayUrl || selectedVariant.sourceUrl || '', `${draft.product.name || '主图'}_hero.png`)}
                className="absolute right-3 top-3 rounded-lg bg-black/50 p-1.5 text-white hover:bg-black/70"
                title="下载"
              >
                <Download className="h-4 w-4" />
              </button>
            )}
          </>
        ) : (
          <div className="text-sm text-[var(--text-secondary)] opacity-50">点击"生成主图"开始</div>
        )}
      </div>

      {/* Variant history */}
      <VariantHistoryStrip
        variants={slot.variants}
        selectedVariantId={slot.selectedVariantId}
        onSelect={variantId => setDraftSafe(prev => ({
          ...prev,
          heroScene: { ...prev.heroScene, slot: { ...prev.heroScene.slot, selectedVariantId: variantId } }
        }))}
      />
    </div>
  )
}
