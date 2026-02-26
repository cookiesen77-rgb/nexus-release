import React from 'react'
import { Palette, Lock, Unlock, Check } from 'lucide-react'
import { cn } from '@/lib/utils'
import { SHORT_DRAMA_STYLE_PRESETS, getPresetVisualMeta } from '@/lib/shortDrama/stylePresets'
import { switchProjectStyle } from '@/lib/shortDrama/draftOps'
import type { ShortDramaDraftV2 } from '@/lib/shortDrama/types'

const MOOD_TINTS: Record<string, string> = {
  dramatic: 'bg-red-500/15 text-red-400',
  cinematic: 'bg-amber-500/15 text-amber-400',
  realistic: 'bg-sky-500/15 text-sky-400',
  clean: 'bg-emerald-500/15 text-emerald-400',
  professional: 'bg-blue-500/15 text-blue-400',
  commercial: 'bg-orange-500/15 text-orange-400',
  romance: 'bg-pink-500/15 text-pink-400',
  modern: 'bg-indigo-500/15 text-indigo-400',
  stylized: 'bg-purple-500/15 text-purple-400',
  vibrant: 'bg-cyan-500/15 text-cyan-400',
  dynamic: 'bg-yellow-500/15 text-yellow-400',
  anime: 'bg-blue-400/15 text-blue-300',
  historical: 'bg-amber-600/15 text-amber-500',
  elegant: 'bg-rose-500/15 text-rose-400',
  traditional: 'bg-orange-600/15 text-orange-400',
  serene: 'bg-teal-500/15 text-teal-400',
  artistic: 'bg-violet-500/15 text-violet-400',
  soft: 'bg-green-400/15 text-green-300',
  organic: 'bg-lime-500/15 text-lime-400',
  gentle: 'bg-emerald-400/15 text-emerald-300',
  futuristic: 'bg-cyan-400/15 text-cyan-300',
  neon: 'bg-fuchsia-500/15 text-fuchsia-400',
  dark: 'bg-slate-400/15 text-slate-300',
  mysterious: 'bg-purple-400/15 text-purple-300',
  classic: 'bg-stone-400/15 text-stone-300',
  warm: 'bg-orange-400/15 text-orange-300',
  minimal: 'bg-zinc-400/15 text-zinc-300',
  cozy: 'bg-amber-400/15 text-amber-300',
  dreamy: 'bg-indigo-400/15 text-indigo-300',
  whimsical: 'bg-pink-400/15 text-pink-300',
  pastoral: 'bg-green-500/15 text-green-400',
  product: 'bg-gray-400/15 text-gray-300',
  lifestyle: 'bg-rose-400/15 text-rose-300',
  fantasy: 'bg-purple-500/15 text-purple-400',
  painterly: 'bg-amber-500/15 text-amber-400',
  rich: 'bg-yellow-600/15 text-yellow-500',
}

interface Props {
  draft: ShortDramaDraftV2
  setDraft: React.Dispatch<React.SetStateAction<ShortDramaDraftV2>>
}

export default function ShortDramaStyleSwitcher({ draft, setDraft }: Props) {
  const activePresetId = draft.style.presetId

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Palette className="h-4 w-4 text-[var(--accent-color)]" />
          <span className="text-sm font-semibold text-[var(--text-primary)] tracking-tight">
            风格预设
          </span>
        </div>

        <button
          onClick={() =>
            setDraft(prev => ({
              ...prev,
              style: { ...prev.style, locked: !prev.style.locked },
              updatedAt: Date.now(),
            }))
          }
          className={cn(
            'group relative flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium transition-all duration-200',
            draft.style.locked
              ? 'bg-amber-500/15 text-amber-400 shadow-[0_0_8px_rgba(245,158,11,0.15)]'
              : 'text-[var(--text-secondary)] hover:bg-[var(--bg-primary)] hover:text-[var(--text-primary)]',
          )}
        >
          {draft.style.locked ? <Lock className="h-3.5 w-3.5" /> : <Unlock className="h-3.5 w-3.5" />}
          {draft.style.locked ? '已锁定' : '未锁定'}
          <span className="pointer-events-none absolute -bottom-7 left-1/2 -translate-x-1/2 whitespace-nowrap rounded bg-[var(--bg-primary)] px-2 py-0.5 text-[10px] text-[var(--text-secondary)] opacity-0 shadow-lg border border-[var(--border-color)] transition-opacity group-hover:opacity-100">
            {draft.style.locked ? 'AI分析不会覆盖风格' : 'AI分析可能覆盖风格'}
          </span>
        </button>
      </div>

      {/* Preset Grid */}
      <div className="grid grid-cols-3 gap-2">
        {SHORT_DRAMA_STYLE_PRESETS.map(preset => {
          const meta = getPresetVisualMeta(preset.id)
          const active = activePresetId === preset.id
          return (
            <button
              key={preset.id}
              onClick={() => setDraft(prev => switchProjectStyle(prev, preset.id))}
              className={cn(
                'group relative rounded-lg border text-left overflow-hidden transition-all duration-200',
                active
                  ? 'border-[var(--accent-color)] shadow-[0_0_12px_rgba(var(--accent-rgb),0.25)]'
                  : 'border-[var(--border-color)] hover:border-[var(--text-secondary)] hover:shadow-md',
              )}
            >
              {/* Gradient Preview */}
              <div
                className="h-16 w-full transition-all duration-200 group-hover:brightness-110"
                style={{ background: meta.gradient }}
              />

              {/* Active Badge */}
              {active && (
                <div className="absolute top-1.5 right-1.5 flex items-center gap-1 rounded-full bg-[var(--accent-color)] px-1.5 py-0.5 shadow-sm">
                  <Check className="h-2.5 w-2.5 text-white" />
                  <span className="text-[9px] font-semibold text-white leading-none">当前风格</span>
                </div>
              )}

              {/* Info */}
              <div className="px-2 py-2">
                <div className="text-xs font-medium text-[var(--text-primary)] leading-tight">
                  {preset.name}
                </div>
                <div className="text-[11px] text-[var(--text-secondary)] leading-tight truncate mt-0.5">
                  {preset.description}
                </div>
                {meta.mood.length > 0 && (
                  <div className="flex flex-wrap gap-1 mt-1.5">
                    {meta.mood.map(tag => (
                      <span
                        key={tag}
                        className={cn(
                          'rounded-full px-1.5 py-px text-[10px] font-medium leading-tight',
                          MOOD_TINTS[tag] || 'bg-[var(--bg-primary)] text-[var(--text-secondary)]',
                        )}
                      >
                        {tag}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            </button>
          )
        })}
      </div>

      {/* Custom Style Section */}
      <div className="space-y-3">
        <div className="flex items-center gap-2">
          <div className="h-px flex-1 bg-[var(--border-color)]" />
          <span className="text-[10px] font-medium uppercase tracking-widest text-[var(--text-secondary)]">
            自定义
          </span>
          <div className="h-px flex-1 bg-[var(--border-color)]" />
        </div>

        <div>
          <label className="mb-1.5 flex items-baseline gap-1.5">
            <span className="text-xs font-medium text-[var(--text-primary)]">风格补充</span>
            <span className="text-[10px] text-[var(--text-secondary)]">在预设基础上追加</span>
          </label>
          <textarea
            value={draft.style.customText}
            onChange={e =>
              setDraft(prev => ({
                ...prev,
                style: { ...prev.style, customText: e.target.value },
                updatedAt: Date.now(),
              }))
            }
            placeholder="追加自定义风格描述..."
            rows={2}
            className="w-full rounded-lg border border-[var(--border-color)] bg-[var(--bg-primary)] px-3 py-2 text-xs text-[var(--text-primary)] placeholder:text-[var(--text-secondary)]/50 resize-none transition-colors duration-150 focus:border-[var(--accent-color)] focus:outline-none focus:shadow-[0_0_0_1px_var(--accent-color)]"
          />
        </div>

        <div>
          <label className="mb-1.5 flex items-baseline gap-1.5">
            <span className="text-xs font-medium text-[var(--text-primary)]">反向提示词</span>
            <span className="text-[10px] text-[var(--text-secondary)]">排除不需要的元素</span>
          </label>
          <textarea
            value={draft.style.negativeText}
            onChange={e =>
              setDraft(prev => ({
                ...prev,
                style: { ...prev.style, negativeText: e.target.value },
                updatedAt: Date.now(),
              }))
            }
            placeholder="不希望出现的元素..."
            rows={2}
            className="w-full rounded-lg border border-[var(--border-color)] bg-[var(--bg-primary)] px-3 py-2 text-xs text-[var(--text-primary)] placeholder:text-[var(--text-secondary)]/50 resize-none transition-colors duration-150 focus:border-[var(--accent-color)] focus:outline-none focus:shadow-[0_0_0_1px_var(--accent-color)]"
          />
        </div>
      </div>
    </div>
  )
}
