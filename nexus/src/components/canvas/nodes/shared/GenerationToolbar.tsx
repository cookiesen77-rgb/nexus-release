import React, { memo, useState, useCallback, useMemo, useRef } from 'react'
import { ArrowUp, Camera, ChevronDown } from 'lucide-react'
import { CAMERA_PRESETS } from '@/lib/cameraControl/presets'

interface GenerationToolbarProps {
  // Model
  modelOptions: Array<{ label: string; key: string }>
  model: string
  onModelChange: (key: string) => void
  // Size / Ratio
  sizeLabel: string
  sizeOptions: Array<{ label: string; key: string }>
  size: string
  onSizeChange: (key: string) => void
  // Quality (optional)
  qualityOptions?: Array<{ label: string; key: string }>
  quality?: string
  onQualityChange?: (key: string) => void
  qualityLabel?: string
  // Camera
  cameraPreset: string | undefined
  onCameraPresetChange: (name: string | undefined) => void
  // Loop count
  loopCount: number
  onLoopCountChange: (n: number) => void
  // Generate
  onGenerate: () => void
  loading: boolean
  disabled: boolean
}

export const GenerationToolbar = memo(function GenerationToolbar(props: GenerationToolbarProps) {
  const {
    modelOptions, model, onModelChange,
    sizeLabel, sizeOptions, size, onSizeChange,
    qualityOptions, quality, onQualityChange, qualityLabel,
    cameraPreset, onCameraPresetChange,
    loopCount, onLoopCountChange,
    onGenerate, loading, disabled,
  } = props

  const [showCamera, setShowCamera] = useState(false)
  const cameraBtnRef = useRef<HTMLButtonElement>(null)

  const sizeDisplay = useMemo(() => {
    const s = sizeOptions.find(o => o.key === size)?.label || size
    if (quality && qualityOptions?.length) {
      const q = qualityOptions.find(o => o.key === quality)?.label || quality
      return `${s} · ${q}`
    }
    return s
  }, [size, sizeOptions, quality, qualityOptions])

  const modelDisplay = useMemo(() => {
    const m = modelOptions.find(o => o.key === model)
    if (!m) return '选择模型'
    const label = m.label
    return label.length > 12 ? label.slice(0, 12) + '…' : label
  }, [modelOptions, model])

  return (
    <div className="flex flex-wrap items-center gap-1.5 px-0.5" onClick={e => e.stopPropagation()}>
      {/* Model selector */}
      <CompactSelect
        value={model}
        options={modelOptions.map(o => ({ value: o.key, label: o.label }))}
        onChange={onModelChange}
        display={modelDisplay}
        icon="◇"
        maxWidth={140}
      />

      {/* Size + Quality combined */}
      <div className="flex items-center gap-0">
        <CompactSelect
          value={size}
          options={sizeOptions.map(o => ({ value: o.key, label: o.label }))}
          onChange={onSizeChange}
          display={sizeDisplay}
          icon="□"
          maxWidth={110}
        />
        {qualityOptions && qualityOptions.length > 0 && onQualityChange && (
          <CompactSelect
            value={quality || ''}
            options={qualityOptions.map(o => ({ value: o.key, label: o.label }))}
            onChange={onQualityChange}
            display={(qualityOptions.find(o => o.key === quality)?.label || quality) ?? ''}
            maxWidth={60}
          />
        )}
      </div>

      {/* Camera presets */}
      <div className="relative">
        <button
          ref={cameraBtnRef}
          onClick={(e) => { e.stopPropagation(); setShowCamera(!showCamera) }}
          className={`flex items-center gap-1 px-2 py-1 text-xs rounded-md border transition-colors ${
            cameraPreset
              ? 'bg-[var(--accent-color)] text-white border-[var(--accent-color)]'
              : 'bg-[var(--bg-tertiary)] text-[var(--text-secondary)] border-[var(--border-color)] hover:border-[var(--accent-color)]'
          }`}
          title="相机控制"
        >
          <Camera size={12} />
          <span>{cameraPreset || '相机'}</span>
        </button>
        {showCamera && (
          <CameraPresetsPopover
            active={cameraPreset}
            onSelect={(name) => { onCameraPresetChange(name); setShowCamera(false) }}
            onClose={() => setShowCamera(false)}
            anchorRef={cameraBtnRef}
          />
        )}
      </div>

      {/* Loop count */}
      <CompactSelect
        value={String(loopCount)}
        options={[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map(n => ({ value: String(n), label: `${n}x` }))}
        onChange={(v) => onLoopCountChange(Number(v))}
        display={`${loopCount}x`}
        maxWidth={52}
      />

      {/* Spacer */}
      <div className="flex-1" />

      {/* Generate button */}
      <button
        onClick={(e) => { e.stopPropagation(); onGenerate() }}
        disabled={loading || disabled}
        className="w-8 h-8 rounded-full flex items-center justify-center bg-[var(--accent-color)] text-white hover:opacity-90 transition-opacity disabled:opacity-40 disabled:cursor-not-allowed"
        title="生成"
      >
        {loading ? (
          <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
        ) : (
          <ArrowUp size={16} />
        )}
      </button>
    </div>
  )
})

// =============== Helpers ===============

function CompactSelect({ value, options, onChange, display, icon, maxWidth }: {
  value: string
  options: Array<{ value: string; label: string }>
  onChange: (v: string) => void
  display: string
  icon?: string
  maxWidth?: number
}) {
  return (
    <div className="relative" style={{ maxWidth }}>
      <select
        value={value}
        onChange={(e) => { e.stopPropagation(); onChange(e.target.value) }}
        onClick={e => e.stopPropagation()}
        className="absolute inset-0 opacity-0 cursor-pointer"
      >
        {options.map(o => (
          <option key={o.value} value={o.value}>{o.label}</option>
        ))}
      </select>
      <div className="flex items-center gap-1 px-2 py-1 text-xs rounded-md bg-[var(--bg-tertiary)] border border-[var(--border-color)] text-[var(--text-primary)] cursor-pointer hover:border-[var(--accent-color)] transition-colors whitespace-nowrap overflow-hidden">
        {icon && <span className="opacity-60">{icon}</span>}
        <span className="truncate">{display}</span>
        <ChevronDown size={10} className="opacity-50 flex-shrink-0" />
      </div>
    </div>
  )
}

function CameraPresetsPopover({ active, onSelect, onClose, anchorRef }: {
  active: string | undefined
  onSelect: (name: string | undefined) => void
  onClose: () => void
  anchorRef: React.RefObject<HTMLButtonElement | null>
}) {
  const pos = useMemo(() => {
    const el = anchorRef.current
    if (!el) return { top: 0, left: 0 }
    const rect = el.getBoundingClientRect()
    const spaceBelow = window.innerHeight - rect.bottom
    const popoverH = 280
    if (spaceBelow >= popoverH + 8) {
      return { top: rect.bottom + 4, left: rect.left }
    }
    return { top: rect.top - popoverH - 4, left: rect.left }
  }, [anchorRef])

  return (
    <>
      <div className="fixed inset-0 z-[999]" onClick={(e) => { e.stopPropagation(); onClose() }} />
      <div
        className="fixed z-[1000] bg-[var(--bg-primary)] border border-[var(--border-color)] rounded-lg shadow-xl py-1 overflow-y-auto"
        style={{ width: 260, maxHeight: 280, top: pos.top, left: pos.left }}
        onClick={e => e.stopPropagation()}
      >
        {CAMERA_PRESETS.map(preset => (
          <button
            key={preset.name}
            onClick={(e) => { e.stopPropagation(); onSelect(active === preset.name ? undefined : preset.name) }}
            className={`flex items-center gap-2 w-full px-3 py-1.5 text-left transition-colors ${
              active === preset.name
                ? 'bg-[var(--accent-color)] text-white'
                : 'text-[var(--text-primary)] hover:bg-[var(--bg-tertiary)]'
            }`}
          >
            <span className="text-xs font-medium truncate">{preset.name}</span>
            <span className={`text-[10px] truncate ${active === preset.name ? 'text-white/70' : 'text-[var(--text-secondary)]'}`}>{preset.description}</span>
          </button>
        ))}
      </div>
    </>
  )
}
