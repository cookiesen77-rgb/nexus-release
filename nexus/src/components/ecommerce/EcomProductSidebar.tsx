import React, { useState, useCallback } from 'react'
import { Image, LayoutGrid, Shirt, Megaphone, Video, Layers, Upload, X, Wand2, Move3D, Clapperboard, UserRound } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { EcomDraftV1, EcomSceneType } from '@/lib/ecommerce/types'
import type { EcomTemplate } from '@/lib/ecommerce/templates'
import { IMAGE_MODELS, VIDEO_MODELS } from '@/config/models'
import { TTS_MODELS } from '@/lib/ecommerce/tts'
import { createEmptySlot } from '@/lib/ecommerce/draftStorage'
import { VariantThumb } from './shared/VariantThumb'

interface Props {
  draft: EcomDraftV1
  setDraftSafe: (fn: React.SetStateAction<EcomDraftV1>) => void
  activeScene: EcomSceneType
  onSetActiveScene: (s: EcomSceneType) => void
  templates: EcomTemplate[]
  selectedTemplate: EcomTemplate | null
  onApplyTemplate: (t: EcomTemplate) => void
}

const SCENE_TABS: { type: EcomSceneType; label: string; icon: React.ComponentType<{ className?: string }> }[] = [
  { type: 'hero', label: '商品主图', icon: Image },
  { type: 'detail_page', label: '详情页套图', icon: LayoutGrid },
  { type: 'try_on', label: '模特换装', icon: Shirt },
  { type: 'poster', label: '营销海报', icon: Megaphone },
  { type: 'video', label: '带货视频', icon: Video },
  { type: 'batch', label: '批量出图', icon: Layers },
  { type: 'motion_control', label: '动作控制', icon: Move3D },
  { type: 'multi_elements', label: '多模态编辑', icon: Clapperboard },
  { type: 'digital_human', label: '数字人', icon: UserRound },
]

const CATEGORIES = ['服饰', '数码', '美妆', '食品', '珠宝', '家居', '母婴', '其他']

export default function EcomProductSidebar({
  draft, setDraftSafe, activeScene, onSetActiveScene,
  templates, selectedTemplate, onApplyTemplate,
}: Props) {
  const [newSellingPoint, setNewSellingPoint] = useState('')

  const patchProduct = useCallback((patch: Partial<EcomDraftV1['product']>) => {
    setDraftSafe(prev => ({ ...prev, product: { ...prev.product, ...patch } }))
  }, [setDraftSafe])

  const patchModels = useCallback((patch: Partial<EcomDraftV1['models']>) => {
    setDraftSafe(prev => ({ ...prev, models: { ...prev.models, ...patch } }))
  }, [setDraftSafe])

  const handleAddSellingPoint = useCallback(() => {
    const sp = newSellingPoint.trim()
    if (!sp) return
    patchProduct({ sellingPoints: [...(draft.product.sellingPoints || []), sp] })
    setNewSellingPoint('')
  }, [newSellingPoint, draft.product.sellingPoints, patchProduct])

  const handleRemoveSellingPoint = useCallback((idx: number) => {
    patchProduct({ sellingPoints: (draft.product.sellingPoints || []).filter((_, i) => i !== idx) })
  }, [draft.product.sellingPoints, patchProduct])

  const handleUploadProductRef = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || [])
    if (files.length === 0) return
    for (const f of files) {
      const reader = new FileReader()
      reader.onload = () => {
        const dataUrl = reader.result as string
        if (!dataUrl) return
        setDraftSafe(prev => ({
          ...prev,
          productRefs: [...prev.productRefs, {
            id: `ref_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
            label: f.name.replace(/\.[^.]+$/, '').slice(0, 20) || '参考图',
            slot: {
              ...createEmptySlot(f.name),
              variants: [{
                id: `var_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
                status: 'success' as const,
                createdAt: Date.now(),
                createdBy: 'manual' as const,
                displayUrl: dataUrl,
              }],
            },
          }],
        }))
      }
      reader.readAsDataURL(f)
    }
    e.currentTarget.value = ''
  }, [setDraftSafe])

  return (
    <div className="flex h-full w-72 flex-shrink-0 flex-col border-r border-[var(--border-color)] overflow-y-auto">
      {/* Scene tabs */}
      <div className="flex flex-col gap-1 border-b border-[var(--border-color)] p-3">
        {SCENE_TABS.map(tab => {
          const Icon = tab.icon
          return (
            <button
              key={tab.type}
              onClick={() => onSetActiveScene(tab.type)}
              className={cn(
                'flex items-center gap-2 rounded-lg px-3 py-2 text-sm transition-colors',
                activeScene === tab.type
                  ? 'bg-[var(--accent-color)] text-white'
                  : 'hover:bg-[var(--bg-secondary)] text-[var(--text-secondary)]'
              )}
            >
              <Icon className="h-4 w-4" />
              {tab.label}
            </button>
          )
        })}
      </div>

      {/* Product info form */}
      <div className="border-b border-[var(--border-color)] p-3 space-y-2">
        <div className="text-[11px] font-bold uppercase text-[var(--text-secondary)]">商品信息</div>
        <input
          value={draft.product.name}
          onChange={e => patchProduct({ name: e.target.value })}
          placeholder="商品名称"
          className="w-full rounded-lg border border-[var(--border-color)] bg-[var(--bg-primary)] px-2 py-1.5 text-xs focus:border-[var(--accent-color)] focus:outline-none"
        />
        <input
          value={draft.product.brand}
          onChange={e => patchProduct({ brand: e.target.value })}
          placeholder="品牌"
          className="w-full rounded-lg border border-[var(--border-color)] bg-[var(--bg-primary)] px-2 py-1.5 text-xs focus:border-[var(--accent-color)] focus:outline-none"
        />
        <select
          value={draft.product.category}
          onChange={e => patchProduct({ category: e.target.value })}
          className="w-full rounded-lg border border-[var(--border-color)] bg-[var(--bg-primary)] px-2 py-1.5 text-xs focus:border-[var(--accent-color)] focus:outline-none"
        >
          <option value="">选择品类</option>
          {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
        </select>
        <textarea
          value={draft.product.description}
          onChange={e => patchProduct({ description: e.target.value })}
          placeholder="商品描述/卖点"
          rows={2}
          className="w-full rounded-lg border border-[var(--border-color)] bg-[var(--bg-primary)] px-2 py-1.5 text-xs resize-none focus:border-[var(--accent-color)] focus:outline-none"
        />

        {/* Selling points */}
        <div className="text-[11px] text-[var(--text-secondary)]">卖点标签</div>
        <div className="flex flex-wrap gap-1">
          {(draft.product.sellingPoints || []).map((sp, i) => (
            <span key={i} className="inline-flex items-center gap-0.5 rounded-full bg-[var(--accent-color)]/10 px-2 py-0.5 text-[10px] text-[var(--accent-color)]">
              {sp}
              <button onClick={() => handleRemoveSellingPoint(i)}><X className="h-2.5 w-2.5" /></button>
            </span>
          ))}
        </div>
        <div className="flex gap-1">
          <input
            value={newSellingPoint}
            onChange={e => setNewSellingPoint(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); handleAddSellingPoint() } }}
            placeholder="添加卖点..."
            className="flex-1 rounded-lg border border-[var(--border-color)] bg-[var(--bg-primary)] px-2 py-1 text-[10px] focus:border-[var(--accent-color)] focus:outline-none"
          />
          <button onClick={handleAddSellingPoint} className="rounded-lg bg-[var(--accent-color)]/10 px-2 text-[10px] text-[var(--accent-color)] hover:bg-[var(--accent-color)]/20">+</button>
        </div>

        {/* Product reference images */}
        <div className="flex items-center justify-between">
          <span className="text-[11px] text-[var(--text-secondary)]">参考图 ({draft.productRefs.length})</span>
          <label className="cursor-pointer text-[11px] text-[var(--accent-color)] hover:underline">
            <Upload className="mr-0.5 inline h-3 w-3" />上传
            <input type="file" accept="image/*" multiple className="hidden" onChange={handleUploadProductRef} />
          </label>
        </div>
        {draft.productRefs.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {draft.productRefs.map(ref => {
              const v = ref.slot.variants[0]
              return v ? (
                <div key={ref.id} className="group relative">
                  <VariantThumb variant={v} className="h-12 w-12" />
                  <button
                    onClick={() => setDraftSafe(prev => ({ ...prev, productRefs: prev.productRefs.filter(r => r.id !== ref.id) }))}
                    className="absolute -right-1 -top-1 hidden group-hover:flex h-4 w-4 items-center justify-center rounded-full bg-red-500 text-white text-[8px]"
                  >
                    <X className="h-2.5 w-2.5" />
                  </button>
                </div>
              ) : null
            })}
          </div>
        )}
      </div>

      {/* Template gallery */}
      <div className="flex-1 p-3 space-y-2">
        <div className="text-[11px] font-bold uppercase text-[var(--text-secondary)]">
          {SCENE_TABS.find(t => t.type === activeScene)?.label} 模板
        </div>
        <div className="grid grid-cols-2 gap-2">
          {templates.map(t => (
            <button
              key={t.id}
              onClick={() => onApplyTemplate(t)}
              className={cn(
                'rounded-xl border bg-[var(--bg-secondary)] p-2 text-left transition-colors',
                selectedTemplate?.id === t.id ? 'border-[var(--accent-color)] ring-1 ring-[var(--accent-color)]' : 'border-[var(--border-color)] hover:border-[var(--accent-color)]'
              )}
            >
              <div className="mb-1 flex h-16 items-center justify-center rounded-lg bg-[var(--bg-tertiary)]">
                <Wand2 className="h-5 w-5 text-[var(--text-secondary)] opacity-30" />
              </div>
              <div className="truncate text-[11px] font-medium text-[var(--text-primary)]">{t.name}</div>
              <div className="line-clamp-2 text-[10px] text-[var(--text-secondary)]">{t.description}</div>
            </button>
          ))}
        </div>
      </div>

      {/* Model selection */}
      <div className="border-t border-[var(--border-color)] p-3 space-y-2">
        <div className="text-[11px] font-bold uppercase text-[var(--text-secondary)]">生图模型</div>
        <select
          value={draft.models.imageModelKey}
          onChange={e => patchModels({ imageModelKey: e.target.value })}
          className="w-full rounded-lg border border-[var(--border-color)] bg-[var(--bg-primary)] px-2 py-1.5 text-xs focus:border-[var(--accent-color)] focus:outline-none"
        >
          {(IMAGE_MODELS as { key: string; label: string }[]).map(m => (
            <option key={m.key} value={m.key}>{m.label}</option>
          ))}
        </select>

        <div className="text-[11px] font-bold uppercase text-[var(--text-secondary)]">画面比例</div>
        <select
          value={draft.models.imageAspectRatio}
          onChange={e => patchModels({ imageAspectRatio: e.target.value })}
          className="w-full rounded-lg border border-[var(--border-color)] bg-[var(--bg-primary)] px-2 py-1.5 text-xs focus:border-[var(--accent-color)] focus:outline-none"
        >
          {['1:1','16:9','9:16','3:4','4:3','3:2','2:3','21:9'].map(r => <option key={r} value={r}>{r}</option>)}
        </select>

        <div className="text-[11px] font-bold uppercase text-[var(--text-secondary)]">清晰度</div>
        <select
          value={draft.models.imageResolution}
          onChange={e => patchModels({ imageResolution: e.target.value })}
          className="w-full rounded-lg border border-[var(--border-color)] bg-[var(--bg-primary)] px-2 py-1.5 text-xs focus:border-[var(--accent-color)] focus:outline-none"
        >
          <option value="1k">标准 1K</option>
          <option value="2K">高清 2K</option>
          <option value="4k">超清 4K</option>
        </select>

        <div className="text-[11px] font-bold uppercase text-[var(--text-secondary)]">视频模型</div>
        <select
          value={draft.models.videoModelKey}
          onChange={e => patchModels({ videoModelKey: e.target.value })}
          className="w-full rounded-lg border border-[var(--border-color)] bg-[var(--bg-primary)] px-2 py-1.5 text-xs focus:border-[var(--accent-color)] focus:outline-none"
        >
          {(VIDEO_MODELS as { key: string; label: string }[]).map(m => (
            <option key={m.key} value={m.key}>{m.label}</option>
          ))}
        </select>

        <div className="text-[11px] font-bold uppercase text-[var(--text-secondary)]">TTS 模型</div>
        <select
          value={draft.models.ttsModelKey}
          onChange={e => patchModels({ ttsModelKey: e.target.value })}
          className="w-full rounded-lg border border-[var(--border-color)] bg-[var(--bg-primary)] px-2 py-1.5 text-xs focus:border-[var(--accent-color)] focus:outline-none"
        >
          {TTS_MODELS.map(m => (
            <option key={m.key} value={m.key}>{m.label}</option>
          ))}
        </select>
      </div>
    </div>
  )
}
