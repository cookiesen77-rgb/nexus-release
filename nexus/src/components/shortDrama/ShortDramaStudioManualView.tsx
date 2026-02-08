import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { CHAT_MODELS, DEFAULT_CHAT_MODEL, DEFAULT_IMAGE_MODEL, DEFAULT_VIDEO_MODEL, IMAGE_MODELS, VIDEO_MODELS } from '@/config/models'
import * as modelsConfig from '@/config/models'
import { useAssetsStore } from '@/store/assets'
import { useGraphStore } from '@/graph/store'
import { getMedia, saveMedia } from '@/lib/mediaStorage'
import { resolveCachedMediaUrl } from '@/lib/workflow/cache'
import MediaPreviewModal from '@/components/canvas/MediaPreviewModal'
import { generateShortDramaImage, generateShortDramaVideo } from '@/lib/shortDrama/generateMedia'
import { buildEffectiveStyle, getShortDramaStylePresetById, SHORT_DRAMA_STYLE_PRESETS } from '@/lib/shortDrama/stylePresets'
import {
  appendVariantToSlot,
  clearSlotSelectedVariant,
  removeVariantFromSlot,
  setSlotSelectionLocked,
  setSlotSelectedVariant,
  updateVariantInSlot,
} from '@/lib/shortDrama/draftOps'
import { createEmptyImageSlot, createEmptyShot, saveShortDramaDraftV2 } from '@/lib/shortDrama/draftStorage'
import { getShortDramaTaskQueue } from '@/lib/shortDrama/taskQueue'
import ShortDramaMediaPickerModal, { type ShortDramaPickKind, type ShortDramaPickedMedia, type ShortDramaPickedImage } from '@/components/shortDrama/ShortDramaMediaPickerModal'
import type { ShortDramaDraftV2, ShortDramaMediaSlot, ShortDramaMediaVariant, ShotFrameMode } from '@/lib/shortDrama/types'
import { SHOT_FRAME_MODES } from '@/lib/shortDrama/types'
import { saveShortDramaPrefs, type ShortDramaStudioPrefsV1 } from '@/lib/shortDrama/uiPrefs'
import { cn } from '@/lib/utils'
import { Check, Eye, Image as ImageIcon, Layers, Loader2, Plus, Sword, Trash2, Upload, Video as VideoIcon, X } from 'lucide-react'
import ShortDramaBlendPanel from '@/components/shortDrama/ShortDramaBlendPanel'
import { createEmptyAsset } from '@/lib/shortDrama/draftStorage'

interface Props {
  projectId: string
  draft: ShortDramaDraftV2
  setDraft: React.Dispatch<React.SetStateAction<ShortDramaDraftV2>>
  prefs: ShortDramaStudioPrefsV1
  setPrefs: React.Dispatch<React.SetStateAction<ShortDramaStudioPrefsV1>>
}

const SUPPORTED_VIDEO_FORMATS = new Set<string>([
  'sora-unified',
  'sora-openai',
  'veo-unified',
  'veo-openai',
  'kling-video',
  'kling-multi-image2video',
  'kling-omni-video',
  'unified-video',
  'volc-seedance-video',
  'alibailian-wan-video',
  'minimax-hailuo-video',
  'runway-video',
  'luma-video',
])

const makeId = () => globalThis.crypto?.randomUUID?.() || `sd_${Date.now()}_${Math.random().toString(16).slice(2)}`

// 检测 Tauri 环境（用于更稳定的视频预览/导出等能力）
const isTauri = typeof window !== 'undefined' && !!(window as any).__TAURI_INTERNALS__
const isHttpUrl = (v: string) => /^https?:\/\//i.test(String(v || '').trim())
const isApiRelativeUrl = (v: string) => {
  const u = String(v || '').trim()
  if (!u) return false
  return u.startsWith('/v1/') || u.startsWith('/v1beta') || u.startsWith('/kling') || u.startsWith('/tencent-vod') || u.startsWith('/video')
}
const isRecoverableSourceUrl = (v: string) => isHttpUrl(v) || isApiRelativeUrl(v)

const readFileAsDataUrl = (file: File) =>
  new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(reader.error || new Error('读取失败'))
    reader.onload = () => resolve(String(reader.result || ''))
    reader.readAsDataURL(file)
  })

const getModelLabel = (m: any) => String(m?.label || m?.key || '')

const getImageModels = () =>
  (IMAGE_MODELS as any[]).map((m) => ({ key: String(m?.key || ''), label: getModelLabel(m) })).filter((m) => m.key)

const getChatModels = () =>
  (CHAT_MODELS as any[]).map((m) => ({ key: String(m?.key || ''), label: getModelLabel(m) })).filter((m) => m.key)

const getSupportedVideoModels = () =>
  (VIDEO_MODELS as any[])
    .filter((m) => SUPPORTED_VIDEO_FORMATS.has(String(m?.format || '')))
    .map((m) => ({ key: String(m?.key || ''), label: getModelLabel(m) }))
    .filter((m) => m.key)

const clampInt = (v: unknown, min: number, max: number, fallback: number) => {
  const n = Number(v)
  if (!Number.isFinite(n)) return fallback
  return Math.max(min, Math.min(max, Math.floor(n)))
}

function useMediaPreview(mediaId?: string) {
  const [url, setUrl] = useState<string>('')
  useEffect(() => {
    if (!mediaId) {
      setUrl('')
      return
    }
    let cancelled = false
    ;(async () => {
      try {
        const rec = await getMedia(mediaId)
        if (cancelled) return
        setUrl(String(rec?.data || ''))
      } catch {
        if (cancelled) return
        setUrl('')
      }
    })()
    return () => {
      cancelled = true
    }
  }, [mediaId])
  return url
}

function VariantThumb({ variant, className }: { variant: ShortDramaMediaVariant; className?: string }) {
  const fromMedia = useMediaPreview(variant.mediaId)
  const url = String(variant.displayUrl || fromMedia || variant.sourceUrl || '').trim()
  if (!url) {
    return <div className={cn('flex h-16 w-16 items-center justify-center rounded-lg bg-black/10 text-xs text-[var(--text-secondary)]', className)}>空</div>
  }
  if (variant.kind === 'video') {
    return (
      <video
        src={url}
        className={cn('h-16 w-16 rounded-lg bg-black/10 object-cover', className)}
        muted
        playsInline
      />
    )
  }
  return <img src={url} className={cn('h-16 w-16 rounded-lg bg-black/10 object-cover', className)} alt="variant" />
}

function SlotVersions({
  slot,
  onAdopt,
  onRemove,
  onPreview,
  onSendToCanvas,
  onClearAdopt,
  disabled,
}: {
  slot: ShortDramaMediaSlot
  onAdopt: (variantId: string) => void
  onRemove: (variantId: string) => void
  onPreview?: (variant: ShortDramaMediaVariant) => void
  onSendToCanvas?: (slot: ShortDramaMediaSlot, variant: ShortDramaMediaVariant) => void
  onClearAdopt?: () => void
  disabled?: boolean
}) {
  if (!slot.variants || slot.variants.length === 0) {
    return <div className="text-xs text-[var(--text-secondary)]">暂无版本</div>
  }
  return (
    <div className="space-y-2">
      {slot.variants
        .slice()
        .reverse()
        .map((v) => {
          const adopted = slot.selectedVariantId === v.id
          const canPreview = !!onPreview && v.status === 'success'
          const canSend = !!onSendToCanvas && v.status === 'success'
          return (
            <div key={v.id} className="flex items-center gap-2 rounded-lg border border-[var(--border-color)] bg-[var(--bg-secondary)] p-2">
              <button
                type="button"
                className={cn('shrink-0', canPreview ? 'cursor-pointer' : 'cursor-default')}
                onClick={() => (canPreview ? onPreview?.(v) : undefined)}
                disabled={!canPreview || disabled}
                title={canPreview ? '预览' : undefined}
              >
                <VariantThumb variant={v} />
              </button>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <div className="truncate text-xs font-medium text-[var(--text-primary)]">
                    {v.status === 'running' ? '生成中…' : v.status === 'error' ? '失败' : '成功'}
                  </div>
                  {v.status === 'error' ? <div className="truncate text-xs text-red-500">{String(v.error || '')}</div> : null}
                </div>
                <div className="mt-1 text-[11px] text-[var(--text-secondary)]">
                  {new Date(v.createdAt || Date.now()).toLocaleString()} · {String(v.modelKey || '').slice(0, 24)}
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={!canPreview || disabled}
                  onClick={() => onPreview?.(v)}
                  className="h-8 w-8 px-0"
                  title="预览"
                >
                  <Eye className="h-4 w-4" />
                </Button>
                <Button size="sm" variant="ghost" disabled={!canSend || disabled} onClick={() => onSendToCanvas?.(slot, v)}>
                  上板
                </Button>
                {adopted ? (
                  <Button size="sm" variant="ghost" disabled={disabled || v.status === 'running'} onClick={() => onClearAdopt?.()}>
                    <X className="mr-1 h-4 w-4" />
                    取消采用
                  </Button>
                ) : (
                  <Button size="sm" variant="ghost" disabled={disabled || v.status !== 'success'} onClick={() => onAdopt(v.id)}>
                    <Check className="mr-1 h-4 w-4" />
                    采用
                  </Button>
                )}
                <Button size="sm" variant="ghost" disabled={disabled || v.status === 'running'} onClick={() => onRemove(v.id)} className="text-red-500">
                  <Trash2 className="mr-1 h-4 w-4" />
                  删除
                </Button>
              </div>
            </div>
          )
        })}
    </div>
  )
}

export default function ShortDramaStudioManualView({ projectId, draft, setDraft, prefs, setPrefs }: Props) {
  const navigate = useNavigate()
  const [previewOpen, setPreviewOpen] = useState(false)
  const [previewUrl, setPreviewUrl] = useState('')
  const [previewType, setPreviewType] = useState<'image' | 'video'>('image')
  const [previewBusy, setPreviewBusy] = useState(false)

  const [blendPanelOpen, setBlendPanelOpen] = useState(false)

  const [busySlotIds, setBusySlotIds] = useState<Record<string, boolean>>({})
  const busySlotsRef = useRef(busySlotIds)
  busySlotsRef.current = busySlotIds

  const queue = useMemo(() => getShortDramaTaskQueue(projectId), [projectId])

  // Apply concurrency limits from prefs
  useEffect(() => {
    queue.setLimits({
      imageConcurrency: prefs.imageConcurrency,
      videoConcurrency: prefs.videoConcurrency,
      analysisConcurrency: 1,
    })
  }, [queue, prefs.imageConcurrency, prefs.videoConcurrency])

  const resolveVariantPreviewUrl = useCallback(async (variant: ShortDramaMediaVariant | undefined): Promise<string> => {
    if (!variant) return ''
    const display = String(variant.displayUrl || '').trim()
    if (display) return display
    if (variant.mediaId) {
      try {
        const rec = await getMedia(variant.mediaId)
        const dataUrl = String(rec?.data || '').trim()
        if (dataUrl) return dataUrl
      } catch {
        // ignore
      }
    }
    return String(variant.sourceUrl || '').trim()
  }, [])

  const openPreview = useCallback(
    async (variant: ShortDramaMediaVariant | undefined) => {
      if (!variant) return
      if (variant.status !== 'success') return
      if (previewBusy) return
      setPreviewBusy(true)
      try {
        let url = await resolveVariantPreviewUrl(variant)
        if (!url) throw new Error('暂无可预览的地址')

        if (variant.kind === 'video' && isTauri) {
          const isAlreadyLocal = url.startsWith('asset://') || url.startsWith('http://asset.localhost/') || url.startsWith('data:') || url.startsWith('blob:')
          if (!isAlreadyLocal) {
            const cached = await resolveCachedMediaUrl(url)
            if (cached?.displayUrl) url = cached.displayUrl
          }
        }

        setPreviewType(variant.kind === 'video' ? 'video' : 'image')
        setPreviewUrl(url)
        setPreviewOpen(true)
      } catch (err: any) {
        window.$message?.error?.(err?.message || '预览失败')
      } finally {
        setPreviewBusy(false)
      }
    },
    [previewBusy, resolveVariantPreviewUrl]
  )

  const resolveVariantInput = useCallback(async (variant: ShortDramaMediaVariant | undefined): Promise<string> => {
    if (!variant) return ''
    const s = String(variant.sourceUrl || '').trim()
    if (s && isHttpUrl(s)) return s
    if (variant.mediaId) {
      try {
        const rec = await getMedia(variant.mediaId)
        const dataUrl = String(rec?.data || '').trim()
        if (dataUrl) return dataUrl
      } catch {
        // ignore
      }
    }
    return String(variant.displayUrl || '').trim()
  }, [])

  const sendVariantToCanvas = useCallback(
    async (slot: ShortDramaMediaSlot, variant: ShortDramaMediaVariant) => {
      if (!variant || variant.status !== 'success') {
        window.$message?.warning?.('请先选择成功的版本')
        return
      }
      const url = await resolveVariantInput(variant || undefined)
      if (!url) {
        window.$message?.error?.('素材没有可用的地址')
        return
      }

      const label = String(slot.label || (variant.kind === 'video' ? '视频' : '图片')).trim() || (variant.kind === 'video' ? '视频' : '图片')
      const gs = useGraphStore.getState()
      const vp: any = (gs as any).viewport || { x: 0, y: 0, zoom: 1 }
      const z = Number(vp.zoom || 1) || 1
      const x = (-Number(vp.x || 0) + 560) / z
      const y = (-Number(vp.y || 0) + 320) / z

      const nodeType = variant.kind === 'video' ? 'video' : 'image'
      const data: Record<string, unknown> = {
        label: label.slice(0, 80),
        url,
      }
      const src = String(variant.sourceUrl || '').trim()
      if (src && isRecoverableSourceUrl(src)) data.sourceUrl = src
      if (variant.mediaId) data.mediaId = variant.mediaId
      if (variant.modelKey) data.model = variant.modelKey

      const id = gs.addNode(nodeType as any, { x, y }, data)
      try {
        ;(gs as any).setSelected?.(id)
      } catch {
        // ignore
      }
      window.$message?.success?.('已上板到画布')
    },
    [resolveVariantInput]
  )

  type PickerTarget =
    | { kind: 'character_refs'; characterId: string }
    | { kind: 'scene_refs'; sceneId: string }
    | { kind: 'slot_variants'; slotId: string; label?: string }

  const [pickerOpen, setPickerOpen] = useState(false)
  const [pickerInitialTab, setPickerInitialTab] = useState<'history' | 'canvas'>('history')
  const [pickerKinds, setPickerKinds] = useState<ShortDramaPickKind[]>(['image'])
  const [pickerTarget, setPickerTarget] = useState<PickerTarget | null>(null)
  const pickerTargetRef = useRef<PickerTarget | null>(null)
  pickerTargetRef.current = pickerTarget

  const openPickerForSlot = useCallback((slot: ShortDramaMediaSlot, label: string, initialTab: 'history' | 'canvas') => {
    setPickerTarget({ kind: 'slot_variants', slotId: slot.id, label })
    setPickerKinds([slot.kind])
    setPickerInitialTab(initialTab)
    setPickerOpen(true)
  }, [])

  const imageModels = useMemo(() => getImageModels(), [])
  const chatModels = useMemo(() => getChatModels(), [])
  const videoModels = useMemo(() => getSupportedVideoModels(), [])

  const imageModelCfg = useMemo(() => {
    const key = String(draft.models.imageModelKey || DEFAULT_IMAGE_MODEL)
    return (IMAGE_MODELS as any[]).find((m) => String(m?.key || '') === key) || (IMAGE_MODELS as any[])[0] || null
  }, [draft.models.imageModelKey])

  const videoModelCfg = useMemo(() => {
    const key = String(draft.models.videoModelKey || DEFAULT_VIDEO_MODEL)
    const resolved: any = (modelsConfig as any)?.getModelByName?.(key) || null
    if (resolved && String(resolved?.format || '').includes('video')) return resolved
    return (VIDEO_MODELS as any[]).find((m) => String(m?.key || '') === key) || null
  }, [draft.models.videoModelKey])

  const videoModelSupportsFirstFrame = useMemo(() => {
    return videoModelCfg?.supportsFirstFrame !== false
  }, [videoModelCfg])

  const videoModelSupportsLastFrame = useMemo(() => {
    return videoModelCfg?.supportsLastFrame === true
  }, [videoModelCfg])

  const patchDraft = useCallback((patch: Partial<ShortDramaDraftV2>) => {
    setDraft((prev) => ({ ...prev, ...patch, updatedAt: Date.now() }))
  }, [setDraft])

  const patchStyle = useCallback(
    (patch: Partial<ShortDramaDraftV2['style']>) => {
      setDraft((prev) => ({ ...prev, style: { ...prev.style, ...patch }, updatedAt: Date.now() }))
    },
    [setDraft]
  )

  const patchModels = useCallback(
    (patch: Partial<ShortDramaDraftV2['models']>) => {
      setDraft((prev) => ({ ...prev, models: { ...prev.models, ...patch }, updatedAt: Date.now() }))
    },
    [setDraft]
  )

  // 切换模型时，自动清理不兼容的比例/画质/时长选择（避免残留旧值导致报错/不生效）
  useEffect(() => {
    const patch: Partial<ShortDramaDraftV2['models']> = {}

    const imageSizes: any[] = Array.isArray((imageModelCfg as any)?.sizes) ? ((imageModelCfg as any).sizes as any[]) : []
    const imageQualities: any[] = Array.isArray((imageModelCfg as any)?.qualities) ? ((imageModelCfg as any).qualities as any[]) : []
    const videoRatios: any[] = Array.isArray((videoModelCfg as any)?.ratios) ? ((videoModelCfg as any).ratios as any[]) : []
    const videoDurs: any[] = Array.isArray((videoModelCfg as any)?.durs) ? ((videoModelCfg as any).durs as any[]) : []
    const videoSizes: any[] = Array.isArray((videoModelCfg as any)?.sizes) ? ((videoModelCfg as any).sizes as any[]) : []

    const inList = (list: any[], val: any, kind: 'raw' | 'key' = 'raw') => {
      const v = String(val ?? '').trim()
      if (!v) return true
      if (!Array.isArray(list) || list.length === 0) return true
      return list.some((it: any) => {
        if (typeof it === 'string' || typeof it === 'number') return String(it) === v
        if (it && typeof it === 'object') {
          const k = kind === 'key' ? String(it?.key ?? it?.value ?? '') : String(it ?? '')
          return k === v
        }
        return false
      })
    }

    if (draft.models.imageSize && !inList(imageSizes, draft.models.imageSize, 'raw')) patch.imageSize = undefined
    if (draft.models.imageQuality && !inList(imageQualities, draft.models.imageQuality, 'key')) patch.imageQuality = undefined
    if (draft.models.videoRatio && !inList(videoRatios, draft.models.videoRatio, 'raw')) patch.videoRatio = undefined
    if (draft.models.videoDuration != null && draft.models.videoDuration !== undefined) {
      const dv = String(draft.models.videoDuration)
      const ok =
        !Array.isArray(videoDurs) || videoDurs.length === 0
          ? true
          : videoDurs.some((d: any) => String(typeof d === 'object' ? d?.key ?? d?.value ?? d : d) === dv)
      if (!ok) patch.videoDuration = undefined
    }
    if (draft.models.videoSize && !inList(videoSizes, draft.models.videoSize, 'key')) patch.videoSize = undefined

    if (Object.keys(patch).length > 0) patchModels(patch)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    draft.models.imageSize,
    draft.models.imageQuality,
    draft.models.videoRatio,
    draft.models.videoDuration,
    draft.models.videoSize,
    imageModelCfg,
    videoModelCfg,
    patchModels,
  ])

  const addCharacter = useCallback(() => {
    setDraft((prev) => ({
      ...prev,
      characters: [
        ...prev.characters,
        {
          id: makeId(),
          name: `角色 ${prev.characters.length + 1}`,
          description: '',
          sheet: createEmptyImageSlot('角色设定图'),
          refs: [createEmptyImageSlot('参考图 1')],
          primaryRefSlotId: undefined,
        },
      ],
      updatedAt: Date.now(),
    }))
  }, [setDraft])

  const removeCharacter = useCallback(
    (characterId: string) => {
      setDraft((prev) => ({
        ...prev,
        characters: prev.characters.filter((c) => c.id !== characterId),
        // Also remove from shots
        shots: prev.shots.map((s) => ({ ...s, characterIds: s.characterIds.filter((id) => id !== characterId) })),
        updatedAt: Date.now(),
      }))
    },
    [setDraft]
  )

  const updateCharacter = useCallback(
    (characterId: string, patch: Partial<ShortDramaDraftV2['characters'][number]>) => {
      setDraft((prev) => ({
        ...prev,
        characters: prev.characters.map((c) => (c.id === characterId ? ({ ...c, ...patch } as any) : c)),
        updatedAt: Date.now(),
      }))
    },
    [setDraft]
  )

  const addScene = useCallback(() => {
    setDraft((prev) => ({
      ...prev,
      scenes: [
        ...prev.scenes,
        {
          id: makeId(),
          name: `场景 ${prev.scenes.length + 1}`,
          description: '',
          ref: createEmptyImageSlot('场景参考'),
          refs: [],
        },
      ],
      updatedAt: Date.now(),
    }))
  }, [setDraft])

  const removeScene = useCallback(
    (sceneId: string) => {
      setDraft((prev) => ({
        ...prev,
        scenes: prev.scenes.filter((s) => s.id !== sceneId),
        shots: prev.shots.map((sh) => (sh.sceneId === sceneId ? { ...sh, sceneId: undefined } : sh)),
        updatedAt: Date.now(),
      }))
    },
    [setDraft]
  )

  const updateScene = useCallback(
    (sceneId: string, patch: Partial<ShortDramaDraftV2['scenes'][number]>) => {
      setDraft((prev) => ({
        ...prev,
        scenes: prev.scenes.map((s) => (s.id === sceneId ? ({ ...s, ...patch } as any) : s)),
        updatedAt: Date.now(),
      }))
    },
    [setDraft]
  )

  const addAsset = useCallback(() => {
    setDraft((prev) => ({
      ...prev,
      assets: [...(prev.assets || []), createEmptyAsset(`资产 ${(prev.assets || []).length + 1}`)],
      updatedAt: Date.now(),
    }))
  }, [setDraft])

  const removeAsset = useCallback(
    (assetId: string) => {
      setDraft((prev) => ({
        ...prev,
        assets: (prev.assets || []).filter((a) => a.id !== assetId),
        updatedAt: Date.now(),
      }))
    },
    [setDraft]
  )

  const updateAsset = useCallback(
    (assetId: string, patch: Partial<NonNullable<ShortDramaDraftV2['assets']>[number]>) => {
      setDraft((prev) => ({
        ...prev,
        assets: (prev.assets || []).map((a) => (a.id === assetId ? ({ ...a, ...patch } as any) : a)),
        updatedAt: Date.now(),
      }))
    },
    [setDraft]
  )

  const addShot = useCallback(() => {
    setDraft((prev) => ({
      ...prev,
      shots: [...prev.shots, createEmptyShot(`镜头 ${prev.shots.length + 1}`)],
      updatedAt: Date.now(),
    }))
  }, [setDraft])

  const removeShot = useCallback(
    (shotId: string) => {
      setDraft((prev) => ({ ...prev, shots: prev.shots.filter((s) => s.id !== shotId), updatedAt: Date.now() }))
    },
    [setDraft]
  )

  const updateShot = useCallback(
    (shotId: string, patch: Partial<ShortDramaDraftV2['shots'][number]>) => {
      setDraft((prev) => ({
        ...prev,
        shots: prev.shots.map((s) => (s.id === shotId ? ({ ...s, ...patch } as any) : s)),
        updatedAt: Date.now(),
      }))
    },
    [setDraft]
  )

  const setSlotBusy = useCallback((slotId: string, busy: boolean) => {
    setBusySlotIds((prev) => ({ ...prev, [slotId]: busy }))
  }, [])

  const getSelectedVariant = useCallback((slot: ShortDramaMediaSlot) => {
    const id = slot.selectedVariantId
    return (slot.variants || []).find((v) => v.id === id) || null
  }, [])

  const collectRefImagesForCharacter = useCallback(
    async (characterId: string) => {
      const c = draft.characters.find((x) => x.id === characterId)
      if (!c) return []
      const inputs: string[] = []
      if (c.sheet) {
        const v = getSelectedVariant(c.sheet)
        const input = await resolveVariantInput(v || undefined)
        if (input) inputs.push(input)
      }
      for (const slot of c.refs || []) {
        const v = getSelectedVariant(slot)
        const input = await resolveVariantInput(v || undefined)
        if (input) inputs.push(input)
      }
      return Array.from(new Set(inputs)).filter(Boolean)
    },
    [draft.characters, getSelectedVariant, resolveVariantInput]
  )



  const collectRefImagesForAsset = useCallback(
    async (assetId: string) => {
      const a = (draft.assets || []).find((x) => x.id === assetId)
      if (!a) return []
      const inputs: string[] = []
      // 资产自身参考图
      if (a.ref) {
        const v = getSelectedVariant(a.ref)
        const input = await resolveVariantInput(v || undefined)
        if (input) inputs.push(input)
      }
      for (const slot of a.refs || []) {
        const v = getSelectedVariant(slot)
        const input = await resolveVariantInput(v || undefined)
        if (input) inputs.push(input)
      }
      // 资产所属角色参考（风格/一致性）
      for (const cid of a.ownerCharacterIds || []) {
        const refs = await collectRefImagesForCharacter(cid)
        inputs.push(...refs)
      }
      return Array.from(new Set(inputs)).filter(Boolean)
    },
    [collectRefImagesForCharacter, draft.assets, getSelectedVariant, resolveVariantInput]
  )

  const collectRefImagesForShot = useCallback(
    async (shotId: string, role: 'start' | 'end') => {
      const shot = draft.shots.find((s) => s.id === shotId)
      if (!shot) return []

      const refInputs: string[] = []

      // Scene refs (primary + extra)
      if (shot.sceneId) {
        const scene = draft.scenes.find((s) => s.id === shot.sceneId)
        const slots: ShortDramaMediaSlot[] = []
        if (scene?.ref) slots.push(scene.ref)
        if (Array.isArray(scene?.refs) && scene.refs.length > 0) slots.push(...scene.refs)
        for (const slot of slots) {
          const v = getSelectedVariant(slot)
          const input = await resolveVariantInput(v || undefined)
          if (input) refInputs.push(input)
        }
      }

      // Character refs: sheet + (primary first) + other refs
      for (const cid of shot.characterIds || []) {
        const c = draft.characters.find((x) => x.id === cid)
        if (!c) continue

        // 1) Sheet (if any)
        const sheetV = c.sheet ? getSelectedVariant(c.sheet) : null
        const sheetInput = await resolveVariantInput(sheetV || undefined)
        if (sheetInput) refInputs.push(sheetInput)

        // 2) Refs
        const allRefSlots = Array.isArray(c.refs) ? c.refs.slice() : []
        const primary = c.primaryRefSlotId ? allRefSlots.find((r) => r.id === c.primaryRefSlotId) : null
        const ordered = primary ? [primary, ...allRefSlots.filter((r) => r.id !== primary.id)] : allRefSlots
        for (const slot of ordered) {
          const v = getSelectedVariant(slot)
          const input = await resolveVariantInput(v || undefined)
          if (input) refInputs.push(input)
        }
      }

      // Asset refs
      for (const aid of shot.assetIds || []) {
        const refs = await collectRefImagesForAsset(aid)
        if (refs.length > 0) refInputs.push(...refs)
      }

      // End frame can use start frame as extra ref (helps identity continuity)
      if (role === 'end') {
        const startV = getSelectedVariant(shot.frames.start.slot)
        const input = await resolveVariantInput(startV || undefined)
        if (input) refInputs.unshift(input)
      }

      return Array.from(new Set(refInputs)).filter(Boolean)
    },
    [collectRefImagesForAsset, draft, getSelectedVariant, resolveVariantInput]
  )

  const buildFramePrompt = useCallback(
    (shotId: string, role: 'start' | 'end') => {
      const shot = draft.shots.find((s) => s.id === shotId)
      if (!shot) return ''
      const frame = role === 'start' ? shot.frames.start : shot.frames.end

      const parts: string[] = []
      const logline = String(draft.logline || '').trim()
      const style = buildEffectiveStyle(draft.style)
      const preset = getShortDramaStylePresetById(draft.style.presetId)

      if (draft.title) parts.push(`短剧标题：${draft.title}`)
      if (logline) parts.push(`短剧梗概：\n${logline}`)

      parts.push(`风格预设：${preset.name}\n${preset.description}`)
      if (style.styleText) parts.push(`统一画风/镜头语言（必须严格遵守）：\n${style.styleText}`)
      if (style.negativeText) parts.push(`全局负面约束（严格避免）：\n${style.negativeText}`)

      if (shot.sceneId) {
        const scene = draft.scenes.find((s) => s.id === shot.sceneId)
        const sceneText = String(scene?.description || '').trim()
        if (scene?.name || sceneText) parts.push(`场景：${String(scene?.name || '').trim()}\n${sceneText}`)
      }

      const chars = (shot.characterIds || [])
        .map((id) => draft.characters.find((c) => c.id === id))
        .filter(Boolean) as any[]
      if (chars.length > 0) {
        const charBlock = chars
          .map((c) => `- ${String(c.name || '').trim()}\n${String(c.description || '').trim()}`.trim())
          .join('\n\n')
        parts.push(`出镜角色设定（保持同一张脸/发型/服装/体型的一致性）：\n${charBlock}`)
      }

      const assets = (shot.assetIds || [])
        .map((id) => (draft.assets || []).find((a) => a.id === id))
        .filter(Boolean) as any[]
      if (assets.length > 0) {
        const assetBlock = assets
          .map((a) => `- ${String(a.name || '').trim()}\n${String(a.description || '').trim()}`.trim())
          .join('\n\n')
        parts.push(`出镜资产设定（保持同一资产外观/材质/比例/纹理一致）：\n${assetBlock}`)
      }

      const beat = String(shot.beat || '').trim()
      if (beat) parts.push(`本镜头意图/节拍：\n${beat}`)

      parts.push('一致性要求：严格参考已上传的角色设定图、场景参考图、资产参考图，保持人物/场景/资产外观一致，不要随意更换。')

      const prompt = String(frame.prompt || '').trim()
      if (prompt) parts.push(prompt)

      return parts.join('\n\n').trim()
    },
    [draft]
  )



  const buildCharacterSheetPrompt = useCallback(
    (characterId: string) => {
      const c = draft.characters.find((x) => x.id === characterId)
      if (!c) return ''

      const parts: string[] = []
      const logline = String(draft.logline || '').trim()
      const style = buildEffectiveStyle(draft.style)
      const preset = getShortDramaStylePresetById(draft.style.presetId)

      if (draft.title) parts.push(`短剧标题：${draft.title}`)
      if (logline) parts.push(`短剧梗概：\n${logline}`)

      parts.push(`风格预设：${preset.name}\n${preset.description}`)
      if (style.styleText) parts.push(`统一画风/镜头语言（必须严格遵守）：\n${style.styleText}`)
      if (style.negativeText) parts.push(`全局负面约束（严格避免）：\n${style.negativeText}`)

      parts.push(`角色：${String(c.name || '').trim()}`)
      const desc = String(c.description || '').trim()
      if (desc) parts.push(`角色设定（必须保持一致性）：\n${desc}`)

      parts.push(
        [
          '请生成「单张」角色设定图（character sheet），不要输出解释文字。',
          '同一张图中包含：正面全身、侧面全身、背面全身，以及至少 6 种表情（中性/开心/愤怒/悲伤/惊讶/害怕）。',
          '要求：同一个角色（同一张脸/发型/服装/体型），干净背景，构图清晰；不要文字标签、不要水印。',
        ].join('\n')
      )

      return parts.join('\n\n').trim()
    },
    [draft]
  )

  const runGenerateCharacterSheet = useCallback(
    async (characterId: string) => {
      const c = draft.characters.find((x) => x.id === characterId)
      if (!c) return
      const slotId = c.sheet.id
      if (busySlotsRef.current[slotId]) return

      const prompt = buildCharacterSheetPrompt(characterId)
      if (!prompt) {
        window.$message?.error?.('请先填写角色设定')
        return
      }

      const running: ShortDramaMediaVariant = {
        id: makeId(),
        kind: 'image',
        status: 'running',
        createdAt: Date.now(),
        createdBy: 'manual',
        modelKey: draft.models.imageModelKey,
        promptSnapshot: prompt,
        styleSnapshot: { ...draft.style },
      }

      setSlotBusy(slotId, true)
      setDraft((prev) => appendVariantToSlot(prev, slotId, running))
      try {
        const refImages = await collectRefImagesForCharacter(characterId)
        const task = queue.enqueue('image', slotId, async () => {
          return await generateShortDramaImage({
            modelKey: draft.models.imageModelKey,
            prompt,
            size: draft.models.imageSize,
            quality: draft.models.imageQuality,
            refImages,
          })
        })
        const result = await task.promise

        const displayUrl = String(result.displayUrl || '').trim()
        const sourceUrl = String(result.imageUrl || '').trim()
        const safeSourceUrl = /^https?:\/\//i.test(sourceUrl) ? sourceUrl : ''
        let mediaId: string | undefined
        const isDisplayDataUrl = displayUrl.startsWith('data:')
        const isSourceDataUrl = sourceUrl.startsWith('data:')
        if (isDisplayDataUrl) {
          mediaId = await saveMedia({
            nodeId: `short_drama:${projectId}:character:${characterId}:sheet:${running.id}`,
            projectId,
            type: 'image',
            data: displayUrl,
            sourceUrl: safeSourceUrl && safeSourceUrl !== displayUrl ? safeSourceUrl : undefined,
            model: draft.models.imageModelKey,
          })
        } else if (isSourceDataUrl) {
          mediaId = await saveMedia({
            nodeId: `short_drama:${projectId}:character:${characterId}:sheet:${running.id}`,
            projectId,
            type: 'image',
            data: sourceUrl,
            model: draft.models.imageModelKey,
          })
        }

        setDraft((prev) =>
          updateVariantInSlot(prev, slotId, running.id, {
            status: 'success',
            sourceUrl: safeSourceUrl || undefined,
            displayUrl: isDisplayDataUrl && mediaId ? '' : displayUrl || undefined,
            localPath: result.localPath || '',
            mediaId,
          })
        )

        // 同步到历史素材（角色设定图）
        try {
          useAssetsStore.getState().addAsset({
            type: 'image',
            src: safeSourceUrl || displayUrl,
            title: `${String(c.name || '角色').trim()} · 设定图`.slice(0, 80),
            model: draft.models.imageModelKey,
          })
        } catch {
          // ignore
        }
        window.$message?.success?.('角色设定图已生成（新增版本）')
      } catch (err: any) {
        const msg = err instanceof Error ? err.message : String(err || '生成失败')
        setDraft((prev) => updateVariantInSlot(prev, slotId, running.id, { status: 'error', error: msg }))
        window.$message?.error?.(msg)
      } finally {
        setSlotBusy(slotId, false)
      }
    },
    [draft, projectId, buildCharacterSheetPrompt, collectRefImagesForCharacter, queue, setDraft, setSlotBusy]
  )

  const runGenerateFrameImage = useCallback(
    async (shotId: string, role: 'start' | 'end') => {
      const shot = draft.shots.find((s) => s.id === shotId)
      if (!shot) return
      const slot = role === 'start' ? shot.frames.start.slot : shot.frames.end.slot
      const slotId = slot.id
      if (busySlotsRef.current[slotId]) return

      const prompt = buildFramePrompt(shotId, role)
      if (!prompt) {
        window.$message?.error?.('请先填写该帧的画面提示词')
        return
      }

      const running: ShortDramaMediaVariant = {
        id: makeId(),
        kind: 'image',
        status: 'running',
        createdAt: Date.now(),
        createdBy: 'manual',
        modelKey: draft.models.imageModelKey,
        promptSnapshot: prompt,
        styleSnapshot: { ...draft.style },
      }

      setSlotBusy(slotId, true)
      setDraft((prev) => appendVariantToSlot(prev, slotId, running))
      try {
        const refImages = await collectRefImagesForShot(shotId, role)
        const task = queue.enqueue('image', slotId, async () => {
          return await generateShortDramaImage({
            modelKey: draft.models.imageModelKey,
            prompt,
            size: draft.models.imageSize,
            quality: draft.models.imageQuality,
            refImages,
          })
        })
        const result = await task.promise

        // Always persist generated data urls into IndexedDB to avoid bloating localStorage.
        const displayUrl = String(result.displayUrl || '').trim()
        const sourceUrl = String(result.imageUrl || '').trim()
        const safeSourceUrl = /^https?:\/\//i.test(sourceUrl) ? sourceUrl : ''
        let mediaId: string | undefined
        const isDisplayDataUrl = displayUrl.startsWith('data:')
        const isSourceDataUrl = sourceUrl.startsWith('data:')
        if (isDisplayDataUrl) {
          mediaId = await saveMedia({
            nodeId: `short_drama:${projectId}:slot:${slotId}:variant:${running.id}`,
            projectId,
            type: 'image',
            data: displayUrl,
            sourceUrl: safeSourceUrl && safeSourceUrl !== displayUrl ? safeSourceUrl : undefined,
            model: draft.models.imageModelKey,
          })
        } else if (isSourceDataUrl) {
          mediaId = await saveMedia({
            nodeId: `short_drama:${projectId}:slot:${slotId}:variant:${running.id}`,
            projectId,
            type: 'image',
            data: sourceUrl,
            model: draft.models.imageModelKey,
          })
        }

        setDraft((prev) =>
          updateVariantInSlot(prev, slotId, running.id, {
            status: 'success',
            sourceUrl: safeSourceUrl || undefined,
            displayUrl: isDisplayDataUrl && mediaId ? '' : displayUrl || undefined,
            localPath: result.localPath || '',
            mediaId,
          })
        )

        useAssetsStore.getState().addAsset({
          type: 'image',
          src: safeSourceUrl || displayUrl,
          title: `${shot.title || '镜头'} · ${role === 'start' ? '首帧' : '尾帧'}`.slice(0, 80),
          model: draft.models.imageModelKey,
        })

        window.$message?.success?.(`${role === 'start' ? '首帧' : '尾帧'}已生成（新增版本）`)
      } catch (err: any) {
        const msg = err instanceof Error ? err.message : String(err || '生成失败')
        setDraft((prev) => updateVariantInSlot(prev, slotId, running.id, { status: 'error', error: msg }))
        window.$message?.error?.(msg)
      } finally {
        setSlotBusy(slotId, false)
      }
    },
    [
      draft,
      projectId,
      buildFramePrompt,
      collectRefImagesForShot,
      queue,
      setDraft,
      setSlotBusy,
    ]
  )

  const runGenerateShotVideo = useCallback(
    async (shotId: string) => {
      const shot = draft.shots.find((s) => s.id === shotId)
      if (!shot) return
      const slotId = shot.video.id
      if (busySlotsRef.current[slotId]) return

      const videoPrompt = String(shot.videoPrompt || '').trim() || String(shot.frames.start.prompt || '').trim()
      const prompt = videoPrompt ? buildFramePrompt(shotId, 'start').split('\n\n').slice(0, 3).join('\n\n') + `\n\n视频描述：\n${videoPrompt}` : ''
      if (!prompt) {
        window.$message?.error?.('请先填写视频提示词（或首帧提示词）')
        return
      }

      const startV = getSelectedVariant(shot.frames.start.slot)
      const endV = getSelectedVariant(shot.frames.end.slot)
      const startInput = await resolveVariantInput(startV || undefined)
      const endInput = await resolveVariantInput(endV || undefined)

      const modelCfg: any = VIDEO_MODELS.find((m) => m.key === draft.models.videoModelKey)
      const supportsFirstFrame = modelCfg?.supportsFirstFrame !== false
      const supportsLastFrame = modelCfg?.supportsLastFrame === true
      const supportsSound = !!(modelCfg?.supportsSound || modelCfg?.defaultParams?.sound === 'on')

      if (!supportsFirstFrame && startInput) {
        window.$message?.warning?.('⚠️ 当前模型不支持首帧输入，首帧将被忽略，按纯文生视频执行')
      } else if (!startInput && supportsFirstFrame) {
        window.$message?.warning?.('未检测到首帧，将按纯文生视频执行（若模型支持）')
      }

      if (!supportsLastFrame && endInput) {
        window.$message?.warning?.('⚠️ 当前模型不支持尾帧输入，尾帧将被忽略')
      }

      if (supportsSound && endInput && supportsLastFrame) {
        window.$message?.warning?.('⚠️ 检测到尾帧：Kling 音频与尾帧不兼容，本次生成将禁用音频')
      }

      const running: ShortDramaMediaVariant = {
        id: makeId(),
        kind: 'video',
        status: 'running',
        createdAt: Date.now(),
        createdBy: 'manual',
        modelKey: draft.models.videoModelKey,
        promptSnapshot: prompt,
        styleSnapshot: { ...draft.style },
      }

      setSlotBusy(slotId, true)
      setDraft((prev) => appendVariantToSlot(prev, slotId, running))
      try {
        const effectiveStartInput = supportsFirstFrame ? startInput : ''
        const effectiveEndInput = supportsLastFrame ? endInput : ''
        const images = [effectiveStartInput, effectiveEndInput].filter(Boolean)
        const task = queue.enqueue('video', slotId, async () => {
          return await generateShortDramaVideo({
            modelKey: draft.models.videoModelKey,
            prompt,
            ratio: draft.models.videoRatio,
            duration: draft.models.videoDuration,
            size: draft.models.videoSize,
            images,
            lastFrame: effectiveEndInput || '',
          })
        })
        const result = await task.promise

        setDraft((prev) =>
          updateVariantInSlot(prev, slotId, running.id, {
            status: 'success',
            taskId: result.taskId,
            sourceUrl: result.videoUrl,
            displayUrl: result.displayUrl,
            localPath: result.localPath || '',
          })
        )

        useAssetsStore.getState().addAsset({
          type: 'video',
          src: result.displayUrl,
          title: `${shot.title || '镜头'} · 视频`.slice(0, 80),
          model: draft.models.videoModelKey,
        })

        window.$message?.success?.('视频已生成（新增版本）')
      } catch (err: any) {
        const msg = err instanceof Error ? err.message : String(err || '生成失败')
        setDraft((prev) => updateVariantInSlot(prev, slotId, running.id, { status: 'error', error: msg }))
        window.$message?.error?.(msg)
      } finally {
        setSlotBusy(slotId, false)
      }
    },
    [draft, buildFramePrompt, getSelectedVariant, resolveVariantInput, queue, setDraft, setSlotBusy]
  )

  const uploadToImageSlot = useCallback(
    async (slotId: string, file: File) => {
      if (!file || !String(file.type || '').startsWith('image/')) {
        window.$message?.error?.('请选择图片文件')
        return
      }
      const dataUrl = await readFileAsDataUrl(file)
      const mediaId = await saveMedia({
        nodeId: `short_drama:${projectId}:slot:${slotId}:upload:${Date.now()}`,
        projectId,
        type: 'image',
        data: dataUrl,
      })
      const v: ShortDramaMediaVariant = {
        id: makeId(),
        kind: 'image',
        status: 'success',
        createdAt: Date.now(),
        createdBy: 'manual',
        modelKey: 'upload',
        mediaId,
      }
      setDraft((prev) => appendVariantToSlot(prev, slotId, v))
      window.$message?.success?.('已添加为新版本')
    },
    [projectId, setDraft]
  )

  const variantFromPicked = useCallback(
    async (slotId: string, picked: ShortDramaPickedMedia): Promise<ShortDramaMediaVariant> => {
      const variantId = makeId()
      const label = String(picked.label || '').trim()
      const src0 = String(picked.sourceUrl || '').trim()
      const display0 = String(picked.displayUrl || '').trim()
      const kind = picked.kind === 'video' ? 'video' : 'image'
      let sourceUrl = src0 && /^https?:\/\//i.test(src0) ? src0 : ''
      let displayUrl = display0
      let mediaId = String(picked.mediaId || '').trim()

      // If we have a large inline dataURL and no mediaId, persist it.
      const isDataUrl = displayUrl.startsWith('data:')
      const isHugeInline = isDataUrl || (!sourceUrl && displayUrl && displayUrl.length > 50000)
      if (!mediaId && isHugeInline) {
        try {
          mediaId = await saveMedia({
            nodeId: `short_drama:${projectId}:slot:${slotId}:picked:${picked.origin}:${picked.id}:${variantId}`,
            projectId,
            type: kind,
            data: displayUrl,
            sourceUrl: sourceUrl || undefined,
            model: `pick:${picked.origin}`,
          })
          if (mediaId) displayUrl = ''
        } catch {
          // ignore
        }
      }

      // Canvas/history http url could be stored as sourceUrl only.
      if (!sourceUrl && /^https?:\/\//i.test(displayUrl)) {
        sourceUrl = displayUrl
        displayUrl = ''
      }

      return {
        id: variantId,
        kind,
        status: 'success',
        createdAt: Date.now(),
        createdBy: 'manual',
        modelKey: `pick:${picked.origin}`,
        promptSnapshot: label ? `picked:${label}` : undefined,
        sourceUrl: sourceUrl || undefined,
        displayUrl: displayUrl || undefined,
        mediaId: mediaId || undefined,
      }
    },
    [projectId]
  )

  const handlePickedImages = useCallback(
    async (items: ShortDramaPickedMedia[]) => {
      const target = pickerTargetRef.current
      if (!target) return
      if (!Array.isArray(items) || items.length === 0) return

      if (target.kind === 'character_refs') {
        const images = items.filter((it): it is ShortDramaPickedImage => it.kind === 'image')
        if (images.length === 0) {
          window.$message?.warning?.('请选择图片')
          return
        }
        const slots: ShortDramaMediaSlot[] = []
        const baseCount = (draft.characters.find((c) => c.id === target.characterId)?.refs || []).length
        for (const it of images) {
          const label = String(it.label || '').trim() || `参考图 ${baseCount + slots.length + 1}`
          const slot = createEmptyImageSlot(label)
          const v = await variantFromPicked(slot.id, it)
          slot.variants = [v]
          slot.selectedVariantId = v.id
          slot.selectionLockedByUser = false
          slots.push(slot)
        }
        setDraft((prev) => ({
          ...prev,
          characters: prev.characters.map((c) => {
            if (c.id !== target.characterId) return c
            const nextRefs = [...(c.refs || []), ...slots]
            const primaryRefSlotId = c.primaryRefSlotId || nextRefs[0]?.id
            return { ...c, refs: nextRefs, primaryRefSlotId }
          }),
          updatedAt: Date.now(),
        }))
        window.$message?.success?.(`已添加 ${slots.length} 张参考图`)
        return
      }

      if (target.kind === 'scene_refs') {
        const images = items.filter((it): it is ShortDramaPickedImage => it.kind === 'image')
        if (images.length === 0) {
          window.$message?.warning?.('请选择图片')
          return
        }
        const slots: ShortDramaMediaSlot[] = []
        for (const it of images) {
          const label = String(it.label || '').trim() || `参考图 ${slots.length + 1}`
          const slot = createEmptyImageSlot(label)
          const v = await variantFromPicked(slot.id, it)
          slot.variants = [v]
          slot.selectedVariantId = v.id
          slot.selectionLockedByUser = false
          slots.push(slot)
        }
        setDraft((prev) => ({
          ...prev,
          scenes: prev.scenes.map((s) => {
            if (s.id !== target.sceneId) return s
            return { ...s, refs: [...(s.refs || []), ...slots] }
          }),
          updatedAt: Date.now(),
        }))
        window.$message?.success?.(`已添加 ${slots.length} 张场景参考`)
        return
      }

      if (target.kind === 'slot_variants') {
        const slotId = target.slotId
        const expectedKind = (() => {
          for (const c of draft.characters) {
            if (c.sheet.id === slotId) return c.sheet.kind
            for (const r of c.refs || []) if (r.id === slotId) return r.kind
          }
          for (const s of draft.scenes) {
            if (s.ref.id === slotId) return s.ref.kind
            for (const r of (s.refs || []) as any[]) if (r?.id === slotId) return r.kind
          }
          for (const sh of draft.shots) {
            if (sh.frames.start.slot.id === slotId) return sh.frames.start.slot.kind
            if (sh.frames.end.slot.id === slotId) return sh.frames.end.slot.kind
            if (sh.video.id === slotId) return sh.video.kind
          }
          return 'image'
        })()
        const filtered = items.filter((it) => it.kind === expectedKind)
        if (filtered.length === 0) {
          window.$message?.warning?.(expectedKind === 'video' ? '请选择视频' : '请选择图片')
          return
        }
        const variants: ShortDramaMediaVariant[] = []
        for (const it of filtered) {
          variants.push(await variantFromPicked(slotId, it))
        }
        setDraft((prev) => {
          let cur = prev
          for (const v of variants) cur = appendVariantToSlot(cur, slotId, v)
          return { ...cur, updatedAt: Date.now() }
        })
        window.$message?.success?.(`已添加 ${variants.length} 个版本`)
      }
    },
    [appendVariantToSlot, createEmptyImageSlot, draft.characters, draft.scenes, draft.shots, setDraft, variantFromPicked]
  )

  const removeVariant = useCallback(
    (slotId: string, variantId: string) => {
      setDraft((prev) => removeVariantFromSlot(prev, slotId, variantId))
    },
    [setDraft]
  )

  const adoptVariant = useCallback(
    (slotId: string, variantId: string) => {
      setDraft((prev) => setSlotSelectedVariant(prev, slotId, variantId))
    },
    [setDraft]
  )

  const clearAdoptVariant = useCallback(
    (slotId: string) => {
      setDraft((prev) => clearSlotSelectedVariant(prev, slotId))
    },
    [setDraft]
  )

  const imageConcurrency = prefs.imageConcurrency
  const videoConcurrency = prefs.videoConcurrency

  return (
    <>
      <div className="flex h-full min-h-0 flex-col gap-4 lg:flex-row">
        {/* Left column (30%): top settings + bottom character/scene */}
        <div className="flex min-h-0 flex-1 flex-col gap-4 lg:flex-[0_0_30%] lg:min-w-[360px] lg:max-w-[520px]">
          <div className="flex min-h-0 flex-[0_0_42%] flex-col">
            <div className="flex items-center justify-between">
              <div className="text-[11px] font-bold uppercase text-[var(--text-secondary)]">项目 / 风格 / 模型</div>
            </div>
            <div className="mt-2 min-h-0 flex-1 overflow-y-auto pr-1">
              {/* Left: meta + style + models */}
              <div className="space-y-4">
        <div className="rounded-xl border border-[var(--border-color)] bg-[var(--bg-primary)] p-4">
          <div className="text-sm font-semibold text-[var(--text-primary)]">项目信息</div>
          <div className="mt-3 space-y-3">
            <div className="flex flex-col gap-2">
              <label className="text-[11px] font-bold uppercase text-[var(--text-secondary)]">标题</label>
              <input
                value={draft.title}
                onChange={(e) => patchDraft({ title: e.target.value })}
                className="w-full rounded-lg border border-[var(--border-color)] bg-[var(--bg-primary)] px-3 py-2 text-sm text-[var(--text-primary)] focus:border-[var(--accent-color)] focus:outline-none"
                placeholder="例如：失恋后我成了霸总…"
              />
            </div>
            <div className="flex flex-col gap-2">
              <label className="text-[11px] font-bold uppercase text-[var(--text-secondary)]">一句话梗概</label>
              <textarea
                value={draft.logline}
                onChange={(e) => patchDraft({ logline: e.target.value })}
                className="min-h-[80px] w-full resize-y rounded-lg border border-[var(--border-color)] bg-[var(--bg-primary)] px-3 py-2 text-sm text-[var(--text-primary)] focus:border-[var(--accent-color)] focus:outline-none"
                placeholder="主冲突 + 目标 + 反转…"
              />
            </div>
            <div className="flex flex-col gap-2">
              <label className="text-[11px] font-bold uppercase text-[var(--text-secondary)]">剧本（可选）</label>
              <textarea
                value={draft.script.text}
                onChange={(e) => patchDraft({ script: { ...draft.script, text: e.target.value } })}
                className="min-h-[110px] w-full resize-y rounded-lg border border-[var(--border-color)] bg-[var(--bg-primary)] px-3 py-2 text-sm text-[var(--text-primary)] focus:border-[var(--accent-color)] focus:outline-none"
                placeholder="粘贴/导入剧本文本（自动模式会基于此拆分镜头）"
              />
            </div>
          </div>
        </div>

        <div className="rounded-xl border border-[var(--border-color)] bg-[var(--bg-primary)] p-4">
          <div className="flex items-center justify-between">
            <div className="text-sm font-semibold text-[var(--text-primary)]">画风与统一要求</div>
            <label className="flex items-center gap-2 text-xs text-[var(--text-secondary)]">
              <input
                type="checkbox"
                checked={!!draft.style.locked}
                onChange={(e) => patchStyle({ locked: e.target.checked })}
              />
              锁定（AI 不可改）
            </label>
          </div>
          <div className="mt-3 space-y-3">
            <div className="flex flex-col gap-2">
              <label className="text-[11px] font-bold uppercase text-[var(--text-secondary)]">预设</label>
              <select
                value={draft.style.presetId}
                onChange={(e) => patchStyle({ presetId: e.target.value })}
                className="w-full rounded-lg border border-[var(--border-color)] bg-[var(--bg-primary)] px-3 py-2 text-sm text-[var(--text-primary)] focus:border-[var(--accent-color)] focus:outline-none"
              >
                {SHORT_DRAMA_STYLE_PRESETS.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
              <div className="text-xs text-[var(--text-secondary)]">{getShortDramaStylePresetById(draft.style.presetId).description}</div>
            </div>
            <div className="flex flex-col gap-2">
              <label className="text-[11px] font-bold uppercase text-[var(--text-secondary)]">补充/覆盖（可选）</label>
              <textarea
                value={draft.style.customText}
                onChange={(e) => patchStyle({ customText: e.target.value })}
                className="min-h-[90px] w-full resize-y rounded-lg border border-[var(--border-color)] bg-[var(--bg-primary)] px-3 py-2 text-sm text-[var(--text-primary)] focus:border-[var(--accent-color)] focus:outline-none"
                placeholder="例如：固定服装、固定发型、固定色板、固定镜头焦段…"
              />
            </div>
            <div className="flex flex-col gap-2">
              <label className="text-[11px] font-bold uppercase text-[var(--text-secondary)]">全局负面（可选）</label>
              <textarea
                value={draft.style.negativeText}
                onChange={(e) => patchStyle({ negativeText: e.target.value })}
                className="min-h-[70px] w-full resize-y rounded-lg border border-[var(--border-color)] bg-[var(--bg-primary)] px-3 py-2 text-sm text-[var(--text-primary)] focus:border-[var(--accent-color)] focus:outline-none"
                placeholder="例如：禁止字幕/水印、禁止换装、禁止换脸…"
              />
            </div>
          </div>
        </div>

        <div className="rounded-xl border border-[var(--border-color)] bg-[var(--bg-primary)] p-4">
          <div className="text-sm font-semibold text-[var(--text-primary)]">模型设置</div>
          <div className="mt-3 space-y-3">
            <div className="flex flex-col gap-2">
              <label className="text-[11px] font-bold uppercase text-[var(--text-secondary)]">分析/拆分模型（自动模式使用）</label>
              <select
                value={draft.models.analysisModelKey || DEFAULT_CHAT_MODEL}
                onChange={(e) => patchModels({ analysisModelKey: e.target.value })}
                className="w-full rounded-lg border border-[var(--border-color)] bg-[var(--bg-primary)] px-3 py-2 text-sm text-[var(--text-primary)] focus:border-[var(--accent-color)] focus:outline-none"
              >
                {chatModels.map((m) => (
                  <option key={m.key} value={m.key}>
                    {m.label}
                  </option>
                ))}
              </select>
            </div>

            <div className="h-px w-full bg-[var(--border-color)]" />

            <div className="flex flex-col gap-2">
              <label className="text-[11px] font-bold uppercase text-[var(--text-secondary)]">图片模型</label>
              <select
                value={draft.models.imageModelKey || DEFAULT_IMAGE_MODEL}
                onChange={(e) => patchModels({ imageModelKey: e.target.value })}
                className="w-full rounded-lg border border-[var(--border-color)] bg-[var(--bg-primary)] px-3 py-2 text-sm text-[var(--text-primary)] focus:border-[var(--accent-color)] focus:outline-none"
              >
                {imageModels.map((m) => (
                  <option key={m.key} value={m.key}>
                    {m.label}
                  </option>
                ))}
              </select>
            </div>

            {Array.isArray(imageModelCfg?.sizes) && imageModelCfg.sizes.length > 0 && (
              <div className="flex flex-col gap-2">
                <label className="text-[11px] font-bold uppercase text-[var(--text-secondary)]">图片比例/尺寸</label>
                <select
                  value={draft.models.imageSize || ''}
                  onChange={(e) => patchModels({ imageSize: e.target.value || undefined })}
                  className="w-full rounded-lg border border-[var(--border-color)] bg-[var(--bg-primary)] px-3 py-2 text-sm text-[var(--text-primary)] focus:border-[var(--accent-color)] focus:outline-none"
                >
                  <option value="">默认</option>
                  {(imageModelCfg.sizes as any[]).map((s) => (
                    <option key={String(s)} value={String(s)}>
                      {String(s)}
                    </option>
                  ))}
                </select>
              </div>
            )}

            {Array.isArray(imageModelCfg?.qualities) && imageModelCfg.qualities.length > 0 && (
              <div className="flex flex-col gap-2">
                <label className="text-[11px] font-bold uppercase text-[var(--text-secondary)]">图片画质</label>
                <select
                  value={draft.models.imageQuality || ''}
                  onChange={(e) => patchModels({ imageQuality: e.target.value || undefined })}
                  className="w-full rounded-lg border border-[var(--border-color)] bg-[var(--bg-primary)] px-3 py-2 text-sm text-[var(--text-primary)] focus:border-[var(--accent-color)] focus:outline-none"
                >
                  <option value="">默认</option>
                  {(imageModelCfg.qualities as any[]).map((q: any) => (
                    <option key={String(q?.key || q)} value={String(q?.key || q)}>
                      {String(q?.label || q?.key || q)}
                    </option>
                  ))}
                </select>
              </div>
            )}

            <div className="h-px w-full bg-[var(--border-color)]" />

            <div className="flex flex-col gap-2">
              <label className="text-[11px] font-bold uppercase text-[var(--text-secondary)]">视频模型（工作台支持）</label>
              <select
                value={draft.models.videoModelKey || DEFAULT_VIDEO_MODEL}
                onChange={(e) => patchModels({ videoModelKey: e.target.value })}
                className="w-full rounded-lg border border-[var(--border-color)] bg-[var(--bg-primary)] px-3 py-2 text-sm text-[var(--text-primary)] focus:border-[var(--accent-color)] focus:outline-none"
              >
                {videoModels.map((m) => (
                  <option key={m.key} value={m.key}>
                    {m.label}
                  </option>
                ))}
              </select>
              <div className="space-y-1">
                <div className="text-xs text-[var(--text-secondary)]">
                  首帧支持：{videoModelSupportsFirstFrame ? '✓ 支持' : '✗ 不支持（仅文生视频）'}
                  {' · '}
                  尾帧支持：{videoModelSupportsLastFrame ? '✓ 支持' : '✗ 不支持'}
                </div>
                {!videoModelSupportsFirstFrame && (
                  <div className="text-xs text-amber-600">⚠️ 当前模型不支持首帧输入，将按纯文生视频执行</div>
                )}
                {videoModelSupportsFirstFrame && !videoModelSupportsLastFrame && (
                  <div className="text-xs text-amber-600">⚠️ 当前模型不支持尾帧输入，尾帧将被忽略</div>
                )}
              </div>
            </div>

            {Array.isArray(videoModelCfg?.ratios) && videoModelCfg.ratios.length > 0 && (
              <div className="flex flex-col gap-2">
                <label className="text-[11px] font-bold uppercase text-[var(--text-secondary)]">视频比例</label>
                <select
                  value={draft.models.videoRatio || ''}
                  onChange={(e) => patchModels({ videoRatio: e.target.value || undefined })}
                  className="w-full rounded-lg border border-[var(--border-color)] bg-[var(--bg-primary)] px-3 py-2 text-sm text-[var(--text-primary)] focus:border-[var(--accent-color)] focus:outline-none"
                >
                  <option value="">默认</option>
                  {(videoModelCfg.ratios as any[]).map((r) => (
                    <option key={String(r)} value={String(r)}>
                      {String(r)}
                    </option>
                  ))}
                </select>
              </div>
            )}

            {Array.isArray(videoModelCfg?.durs) && videoModelCfg.durs.length > 0 && (
              <div className="flex flex-col gap-2">
                <label className="text-[11px] font-bold uppercase text-[var(--text-secondary)]">视频时长</label>
                <select
                  value={draft.models.videoDuration ? String(draft.models.videoDuration) : ''}
                  onChange={(e) => patchModels({ videoDuration: e.target.value ? Number(e.target.value) : undefined })}
                  className="w-full rounded-lg border border-[var(--border-color)] bg-[var(--bg-primary)] px-3 py-2 text-sm text-[var(--text-primary)] focus:border-[var(--accent-color)] focus:outline-none"
                >
                  <option value="">默认</option>
                  {(videoModelCfg.durs as any[]).map((d: any) => (
                    <option key={String(d?.key || d)} value={String(d?.key || d)}>
                      {String(d?.label || d?.key || d)}
                    </option>
                  ))}
                </select>
              </div>
            )}

            {Array.isArray(videoModelCfg?.sizes) && videoModelCfg.sizes.length > 0 && (
              <div className="flex flex-col gap-2">
                <label className="text-[11px] font-bold uppercase text-[var(--text-secondary)]">视频尺寸</label>
                <select
                  value={draft.models.videoSize || ''}
                  onChange={(e) => patchModels({ videoSize: e.target.value || undefined })}
                  className="w-full rounded-lg border border-[var(--border-color)] bg-[var(--bg-primary)] px-3 py-2 text-sm text-[var(--text-primary)] focus:border-[var(--accent-color)] focus:outline-none"
                >
                  <option value="">默认</option>
                  {(videoModelCfg.sizes as any[]).map((s: any) => (
                    <option key={String(s?.key || s)} value={String(s?.key || s)}>
                      {String(s?.label || s?.key || s)}
                    </option>
                  ))}
                </select>
              </div>
            )}
          </div>
        </div>

        <div className="rounded-xl border border-[var(--border-color)] bg-[var(--bg-primary)] p-4">
          <div className="text-sm font-semibold text-[var(--text-primary)]">并发设置</div>
          <div className="mt-3 space-y-3">
            <div className="flex items-center justify-between">
              <div className="text-xs text-[var(--text-secondary)]">图片并发</div>
              <input
                type="number"
                min={1}
                max={12}
                value={imageConcurrency}
                onChange={(e) => setPrefs((p) => ({ ...p, imageConcurrency: clampInt(e.target.value, 1, 12, 4) }))}
                className="w-20 rounded-lg border border-[var(--border-color)] bg-[var(--bg-primary)] px-2 py-1 text-sm text-[var(--text-primary)]"
              />
            </div>
            <div className="flex items-center justify-between">
              <div className="text-xs text-[var(--text-secondary)]">视频并发</div>
              <input
                type="number"
                min={1}
                max={6}
                value={videoConcurrency}
                onChange={(e) => setPrefs((p) => ({ ...p, videoConcurrency: clampInt(e.target.value, 1, 6, 2) }))}
                className="w-20 rounded-lg border border-[var(--border-color)] bg-[var(--bg-primary)] px-2 py-1 text-sm text-[var(--text-primary)]"
              />
            </div>
            <div className="text-xs text-[var(--text-secondary)]">并发已生效（自动/手动通用，队列会自动升降并发以抵御限流）。</div>
          </div>
        </div>
              </div>
            </div>
          </div>

          <div className="flex min-h-0 flex-1 flex-col">
            <div className="flex items-center justify-between">
              <div className="text-[11px] font-bold uppercase text-[var(--text-secondary)]">角色 / 场景 / 资产</div>
              <Button size="sm" variant="ghost" className="gap-1" onClick={() => setBlendPanelOpen(true)}>
                <Layers className="h-4 w-4" />
                融图
              </Button>
            </div>
            <div className="mt-2 min-h-0 flex-1 overflow-y-auto pr-1">
              <div className="space-y-4">
        <div className="rounded-xl border border-[var(--border-color)] bg-[var(--bg-primary)] p-4">
          <div className="flex items-center justify-between">
            <div className="text-sm font-semibold text-[var(--text-primary)]">角色库</div>
            <Button size="sm" onClick={addCharacter} className="gap-1">
              <Plus className="h-4 w-4" />
              添加角色
            </Button>
          </div>
          <div className="mt-3 space-y-3">
            {draft.characters.length === 0 ? (
              <div className="text-sm text-[var(--text-secondary)]">暂无角色。建议先添加并绑定参考图，以保证人物一致性。</div>
            ) : null}

            {draft.characters.map((c) => {
              return (
                <div key={c.id} className="rounded-xl border border-[var(--border-color)] bg-[var(--bg-secondary)] p-3">
                  <div className="flex items-center gap-2">
                    <input
                      value={c.name}
                      onChange={(e) => updateCharacter(c.id, { name: e.target.value })}
                      className="w-full rounded-lg border border-[var(--border-color)] bg-[var(--bg-primary)] px-3 py-2 text-sm font-medium text-[var(--text-primary)] focus:border-[var(--accent-color)] focus:outline-none"
                      placeholder="角色名"
                    />
                    <Button size="sm" variant="ghost" className="text-red-500" onClick={() => removeCharacter(c.id)} title="删除角色">
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                  <div className="mt-2">
                    <textarea
                      value={c.description}
                      onChange={(e) => updateCharacter(c.id, { description: e.target.value })}
                      className="min-h-[70px] w-full resize-y rounded-lg border border-[var(--border-color)] bg-[var(--bg-primary)] px-3 py-2 text-sm text-[var(--text-primary)] focus:border-[var(--accent-color)] focus:outline-none"
                      placeholder="外观、服装、性格、发型、固定细节（必须不变）…"
                    />
                  </div>

                  <div className="mt-3 space-y-3">
                    <div className="rounded-lg border border-[var(--border-color)] bg-[var(--bg-primary)] p-2">
                      <div className="flex items-center justify-between">
                        <div className="text-xs font-semibold text-[var(--text-primary)]">角色设定图（单张多角度）</div>
                        <div className="flex items-center gap-2">
                          <input
                            type="file"
                            accept="image/*"
                            multiple
                            className="hidden"
                            id={`upload-sheet-${c.id}`}
                            onChange={(e) => {
                              const files = Array.from(e.target.files || [])
                              if (files.length === 0) return
                              void (async () => {
                                for (const f of files) {
                                  await uploadToImageSlot(c.sheet.id, f)
                                }
                              })()
                              e.currentTarget.value = ''
                            }}
                          />
                          <Button size="sm" variant="ghost" type="button" onClick={() => document.getElementById(`upload-sheet-${c.id}`)?.click()}>
                            <Upload className="mr-1 h-4 w-4" />
                            上传
                          </Button>
                          <Button size="sm" variant="ghost" type="button" onClick={() => openPickerForSlot(c.sheet, `${c.name || '角色'} · 设定图`, 'history')}>
                            从历史导入
                          </Button>
                          <Button size="sm" variant="ghost" type="button" onClick={() => openPickerForSlot(c.sheet, `${c.name || '角色'} · 设定图`, 'canvas')}>
                            从画布导入
                          </Button>
                          <Button size="sm" variant="ghost" disabled={!!busySlotsRef.current[c.sheet.id]} onClick={() => void runGenerateCharacterSheet(c.id)}>
                            {!!busySlotsRef.current[c.sheet.id] ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <ImageIcon className="mr-1 h-4 w-4" />}
                            生成
                          </Button>
                        </div>
                      </div>
                      <div className="mt-2">
                        <SlotVersions
                          slot={c.sheet}
                          onAdopt={(vid) => adoptVariant(c.sheet.id, vid)}
                          onClearAdopt={() => clearAdoptVariant(c.sheet.id)}
                          onRemove={(vid) => removeVariant(c.sheet.id, vid)}
                          onPreview={(v) => void openPreview(v)}
                          onSendToCanvas={(slot, v) => void sendVariantToCanvas(slot, v)}
                          disabled={!!busySlotsRef.current[c.sheet.id]}
                        />
                      </div>
                    </div>

                    <div className="rounded-lg border border-[var(--border-color)] bg-[var(--bg-primary)] p-2">
                      <div className="flex items-center justify-between">
                        <div className="text-xs font-semibold text-[var(--text-primary)]">参考图（可多张）</div>
                        <div className="flex items-center gap-2">
                          <Button
                            size="sm"
                            variant="ghost"
                            type="button"
                            onClick={() => {
                              setPickerTarget({ kind: 'character_refs', characterId: c.id })
                              setPickerKinds(['image'])
                              setPickerInitialTab('history')
                              setPickerOpen(true)
                            }}
                          >
                            从历史添加
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            type="button"
                            onClick={() => {
                              setPickerTarget({ kind: 'character_refs', characterId: c.id })
                              setPickerKinds(['image'])
                              setPickerInitialTab('canvas')
                              setPickerOpen(true)
                            }}
                          >
                            从画布添加
                          </Button>
                          <Button
                            size="sm"
                            variant="secondary"
                            className="gap-1"
                            onClick={() => updateCharacter(c.id, { refs: [...c.refs, createEmptyImageSlot(`参考图 ${c.refs.length + 1}`)] })}
                          >
                            <Plus className="h-4 w-4" />
                            新增槽位
                          </Button>
                        </div>
                      </div>

                      <div className="mt-2 space-y-2">
                        {(c.refs || []).map((slot, slotIdx) => {
                          const isPrimary = c.primaryRefSlotId ? c.primaryRefSlotId === slot.id : slotIdx === 0
                          const slotLabel = String(slot.label || `参考图 ${slotIdx + 1}`)
                          return (
                            <div key={slot.id} className="rounded-lg border border-[var(--border-color)] bg-[var(--bg-secondary)] p-2">
                              <div className="flex items-center justify-between gap-2">
                                <div className="text-xs font-medium text-[var(--text-primary)]">
                                  {slotLabel}
                                  {isPrimary ? <span className="ml-2 text-[var(--accent-color)]">主参考</span> : null}
                                </div>
                                <div className="flex flex-wrap items-center gap-2">
                                  <Button
                                    size="sm"
                                    variant="ghost"
                                    disabled={slotIdx === 0}
                                    onClick={() => {
                                      const refs = (c.refs || []).slice()
                                      const tmp = refs[slotIdx - 1]
                                      refs[slotIdx - 1] = refs[slotIdx]
                                      refs[slotIdx] = tmp
                                      updateCharacter(c.id, { refs })
                                    }}
                                  >
                                    上移
                                  </Button>
                                  <Button
                                    size="sm"
                                    variant="ghost"
                                    disabled={slotIdx === (c.refs || []).length - 1}
                                    onClick={() => {
                                      const refs = (c.refs || []).slice()
                                      const tmp = refs[slotIdx + 1]
                                      refs[slotIdx + 1] = refs[slotIdx]
                                      refs[slotIdx] = tmp
                                      updateCharacter(c.id, { refs })
                                    }}
                                  >
                                    下移
                                  </Button>
                                  <input
                                    type="file"
                                    accept="image/*"
                                    multiple
                                    className="hidden"
                                    id={`upload-charref-slot-${slot.id}`}
                                    onChange={(e) => {
                                      const files = Array.from(e.target.files || [])
                                      if (files.length === 0) return
                                      void (async () => {
                                        for (const f of files) {
                                          await uploadToImageSlot(slot.id, f)
                                        }
                                      })()
                                      e.currentTarget.value = ''
                                    }}
                                  />
                                  <Button size="sm" variant="ghost" type="button" onClick={() => document.getElementById(`upload-charref-slot-${slot.id}`)?.click()}>
                                    <Upload className="mr-1 h-4 w-4" />
                                    上传
                                  </Button>
                                  <Button
                                    size="sm"
                                    variant="ghost"
                                    disabled={isPrimary}
                                    onClick={() => updateCharacter(c.id, { primaryRefSlotId: slot.id })}
                                  >
                                    设为主参考
                                  </Button>
                                  <Button
                                    size="sm"
                                    variant="ghost"
                                    className="text-red-500"
                                    disabled={(c.refs || []).length <= 1}
                                    onClick={() => {
                                      const nextRefs = (c.refs || []).filter((r) => r.id !== slot.id)
                                      const nextPrimary = c.primaryRefSlotId === slot.id ? undefined : c.primaryRefSlotId
                                      updateCharacter(c.id, { refs: nextRefs, primaryRefSlotId: nextPrimary })
                                    }}
                                  >
                                    移除槽位
                                  </Button>
                                </div>
                              </div>
                              <div className="mt-2">
                                <SlotVersions
                                  slot={slot}
                                  onAdopt={(vid) => adoptVariant(slot.id, vid)}
                          onClearAdopt={() => clearAdoptVariant(slot.id)}
                                  onRemove={(vid) => removeVariant(slot.id, vid)}
                                  onPreview={(v) => void openPreview(v)}
                                  onSendToCanvas={(slot, v) => void sendVariantToCanvas(slot, v)}
                                  disabled={!!busySlotsRef.current[slot.id]}
                                />
                              </div>
                            </div>
                          )
                        })}
                      </div>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        </div>

        <div className="rounded-xl border border-[var(--border-color)] bg-[var(--bg-primary)] p-4">
          <div className="flex items-center justify-between">
            <div className="text-sm font-semibold text-[var(--text-primary)]">场景库</div>
            <Button size="sm" onClick={addScene} className="gap-1">
              <Plus className="h-4 w-4" />
              添加场景
            </Button>
          </div>
          <div className="mt-3 space-y-3">
            {draft.scenes.length === 0 ? <div className="text-sm text-[var(--text-secondary)]">暂无场景。建议创建并绑定场景参考，避免每镜头“换景”。</div> : null}
            {draft.scenes.map((s) => {
              const slot = s.ref
              const selected = (slot.variants || []).find((v) => v.id === slot.selectedVariantId) || null
              return (
                <div key={s.id} className="rounded-xl border border-[var(--border-color)] bg-[var(--bg-secondary)] p-3">
                  <div className="flex items-center gap-2">
                    <input
                      value={s.name}
                      onChange={(e) => updateScene(s.id, { name: e.target.value })}
                      className="w-full rounded-lg border border-[var(--border-color)] bg-[var(--bg-primary)] px-3 py-2 text-sm font-medium text-[var(--text-primary)] focus:border-[var(--accent-color)] focus:outline-none"
                      placeholder="场景名"
                    />
                    <Button size="sm" variant="ghost" className="text-red-500" onClick={() => removeScene(s.id)} title="删除场景">
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                  <div className="mt-2">
                    <textarea
                      value={s.description}
                      onChange={(e) => updateScene(s.id, { description: e.target.value })}
                      className="min-h-[60px] w-full resize-y rounded-lg border border-[var(--border-color)] bg-[var(--bg-primary)] px-3 py-2 text-sm text-[var(--text-primary)] focus:border-[var(--accent-color)] focus:outline-none"
                      placeholder="场景固定元素（建筑/陈设/时间/天气/色调/镜头一致性）…"
                    />
                  </div>
                  <div className="mt-3 space-y-3">
                    <div className="rounded-lg border border-[var(--border-color)] bg-[var(--bg-primary)] p-2">
                      <div className="flex items-center justify-between">
                        <div className="text-xs font-semibold text-[var(--text-primary)]">主参考图</div>
                        <div className="flex items-center gap-2">
                          <input
                            type="file"
                            accept="image/*"
                            multiple
                            className="hidden"
                            id={`upload-scene-${s.id}`}
                            onChange={(e) => {
                              const files = Array.from(e.target.files || [])
                              if (files.length === 0) return
                              void (async () => {
                                for (const f of files) {
                                  await uploadToImageSlot(slot.id, f)
                                }
                              })()
                              e.currentTarget.value = ''
                            }}
                          />
                          <Button size="sm" variant="secondary" type="button" onClick={() => document.getElementById(`upload-scene-${s.id}`)?.click()}>
                            <Upload className="mr-1 h-4 w-4" />
                            上传
                          </Button>
                          <Button size="sm" variant="ghost" type="button" onClick={() => openPickerForSlot(slot, `${s.name || '场景'} · 主参考`, 'history')}>
                            从历史导入
                          </Button>
                          <Button size="sm" variant="ghost" type="button" onClick={() => openPickerForSlot(slot, `${s.name || '场景'} · 主参考`, 'canvas')}>
                            从画布导入
                          </Button>
                        </div>
                      </div>
                      {selected ? (
                        <div className="mt-2">
                          <button type="button" className="w-full" onClick={() => void openPreview(selected)} disabled={previewBusy} title="预览">
                            <VariantThumb variant={selected} className="h-24 w-full" />
                          </button>
                        </div>
                      ) : null}
                      <div className="mt-2">
                        <SlotVersions
                          slot={slot}
                          onAdopt={(vid) => adoptVariant(slot.id, vid)}
                          onClearAdopt={() => clearAdoptVariant(slot.id)}
                          onRemove={(vid) => removeVariant(slot.id, vid)}
                          onPreview={(v) => void openPreview(v)}
                          onSendToCanvas={(slot, v) => void sendVariantToCanvas(slot, v)}
                          disabled={!!busySlotsRef.current[slot.id]}
                        />
                      </div>
                    </div>

                    <div className="rounded-lg border border-[var(--border-color)] bg-[var(--bg-primary)] p-2">
                      <div className="flex items-center justify-between">
                        <div className="text-xs font-semibold text-[var(--text-primary)]">额外参考（可多张）</div>
                        <div className="flex items-center gap-2">
                          <Button
                            size="sm"
                            variant="ghost"
                            type="button"
                            onClick={() => {
                              setPickerTarget({ kind: 'scene_refs', sceneId: s.id })
                              setPickerKinds(['image'])
                              setPickerInitialTab('history')
                              setPickerOpen(true)
                            }}
                          >
                            从历史添加
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            type="button"
                            onClick={() => {
                              setPickerTarget({ kind: 'scene_refs', sceneId: s.id })
                              setPickerKinds(['image'])
                              setPickerInitialTab('canvas')
                              setPickerOpen(true)
                            }}
                          >
                            从画布添加
                          </Button>
                          <Button
                            size="sm"
                            variant="secondary"
                            className="gap-1"
                            onClick={() => updateScene(s.id, { refs: [...(s.refs || []), createEmptyImageSlot(`参考图 ${(s.refs || []).length + 1}`)] })}
                          >
                            <Plus className="h-4 w-4" />
                            新增槽位
                          </Button>
                        </div>
                      </div>

                      <div className="mt-2 space-y-2">
                        {(s.refs || []).length === 0 ? (
                          <div className="text-xs text-[var(--text-secondary)]">暂无额外参考</div>
                        ) : null}

                        {(s.refs || []).map((refSlot, i) => (
                          <div key={refSlot.id} className="rounded-lg border border-[var(--border-color)] bg-[var(--bg-secondary)] p-2">
                            <div className="flex items-center justify-between gap-2">
                              <div className="text-xs font-medium text-[var(--text-primary)]">{String(refSlot.label || `参考图 ${i + 1}`)}</div>
                              <div className="flex flex-wrap items-center gap-2">
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  disabled={i === 0}
                                  onClick={() => {
                                    const refs = (s.refs || []).slice()
                                    const tmp = refs[i - 1]
                                    refs[i - 1] = refs[i]
                                    refs[i] = tmp
                                    updateScene(s.id, { refs })
                                  }}
                                >
                                  上移
                                </Button>
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  disabled={i === (s.refs || []).length - 1}
                                  onClick={() => {
                                    const refs = (s.refs || []).slice()
                                    const tmp = refs[i + 1]
                                    refs[i + 1] = refs[i]
                                    refs[i] = tmp
                                    updateScene(s.id, { refs })
                                  }}
                                >
                                  下移
                                </Button>
                                <input
                                  type="file"
                                  accept="image/*"
                                  multiple
                                  className="hidden"
                                  id={`upload-scene-ref-slot-${refSlot.id}`}
                                  onChange={(e) => {
                                    const files = Array.from(e.target.files || [])
                                    if (files.length === 0) return
                                    void (async () => {
                                      for (const f of files) {
                                        await uploadToImageSlot(refSlot.id, f)
                                      }
                                    })()
                                    e.currentTarget.value = ''
                                  }}
                                />
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  type="button"
                                  onClick={() => document.getElementById(`upload-scene-ref-slot-${refSlot.id}`)?.click()}
                                >
                                  <Upload className="mr-1 h-4 w-4" />
                                  上传
                                </Button>
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  className="text-red-500"
                                  onClick={() => updateScene(s.id, { refs: (s.refs || []).filter((x) => x.id !== refSlot.id) })}
                                >
                                  移除槽位
                                </Button>
                              </div>
                            </div>
                            <div className="mt-2">
                              <SlotVersions
                                slot={refSlot}
                                onAdopt={(vid) => adoptVariant(refSlot.id, vid)}
                          onClearAdopt={() => clearAdoptVariant(refSlot.id)}
                                onRemove={(vid) => removeVariant(refSlot.id, vid)}
                                onPreview={(v) => void openPreview(v)}
                                onSendToCanvas={(slot, v) => void sendVariantToCanvas(slot, v)}
                                disabled={!!busySlotsRef.current[refSlot.id]}
                              />
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        </div>

        <div className="rounded-xl border border-[var(--border-color)] bg-[var(--bg-primary)] p-4">
          <div className="flex items-center justify-between">
            <div className="text-sm font-semibold text-[var(--text-primary)]">资产库</div>
            <Button size="sm" onClick={addAsset} className="gap-1">
              <Plus className="h-4 w-4" />
              添加资产
            </Button>
          </div>
          <div className="mt-3 space-y-3">
            {(draft.assets || []).length === 0 ? (
              <div className="text-sm text-[var(--text-secondary)]">暂无资产。可添加角色使用的武器/道具/载具等重要物品。</div>
            ) : null}
            {(draft.assets || []).map((asset) => {
              const slot = asset.ref
              const selected = (slot?.variants || []).find((v) => v.id === slot?.selectedVariantId) || null
              return (
                <div key={asset.id} className="rounded-xl border border-[var(--border-color)] bg-[var(--bg-secondary)] p-3">
                  <div className="flex items-center gap-2">
                    <Sword className="h-4 w-4 text-[var(--text-secondary)]" />
                    <input
                      value={asset.name}
                      onChange={(e) => updateAsset(asset.id, { name: e.target.value })}
                      className="w-full rounded-lg border border-[var(--border-color)] bg-[var(--bg-primary)] px-3 py-2 text-sm font-medium text-[var(--text-primary)] focus:border-[var(--accent-color)] focus:outline-none"
                      placeholder="资产名称"
                    />
                    <Button size="sm" variant="ghost" className="text-red-500" onClick={() => removeAsset(asset.id)} title="删除资产">
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                  <div className="mt-2">
                    <textarea
                      value={asset.description}
                      onChange={(e) => updateAsset(asset.id, { description: e.target.value })}
                      className="min-h-[60px] w-full resize-y rounded-lg border border-[var(--border-color)] bg-[var(--bg-primary)] px-3 py-2 text-sm text-[var(--text-primary)] focus:border-[var(--accent-color)] focus:outline-none"
                      placeholder="资产描述：外观、材质、特点…"
                    />
                  </div>
                  {slot && (
                    <div className="mt-3 rounded-lg border border-[var(--border-color)] bg-[var(--bg-primary)] p-2">
                      <div className="flex items-center justify-between">
                        <div className="text-xs font-semibold text-[var(--text-primary)]">参考图</div>
                        <div className="flex items-center gap-2">
                          <input
                            type="file"
                            accept="image/*"
                            multiple
                            className="hidden"
                            id={`upload-asset-${asset.id}`}
                            onChange={(e) => {
                              const files = Array.from(e.target.files || [])
                              if (files.length === 0) return
                              void (async () => {
                                for (const f of files) {
                                  await uploadToImageSlot(slot.id, f)
                                }
                              })()
                              e.currentTarget.value = ''
                            }}
                          />
                          <Button size="sm" variant="secondary" type="button" onClick={() => document.getElementById(`upload-asset-${asset.id}`)?.click()}>
                            <Upload className="mr-1 h-4 w-4" />
                            上传
                          </Button>
                          <Button size="sm" variant="ghost" type="button" onClick={() => openPickerForSlot(slot, `${asset.name || '资产'} · 参考图`, 'history')}>
                            从历史导入
                          </Button>
                          <Button size="sm" variant="ghost" type="button" onClick={() => openPickerForSlot(slot, `${asset.name || '资产'} · 参考图`, 'canvas')}>
                            从画布导入
                          </Button>
                        </div>
                      </div>
                      {selected ? (
                        <div className="mt-2">
                          <button type="button" className="w-full" onClick={() => void openPreview(selected)} disabled={previewBusy} title="预览">
                            <VariantThumb variant={selected} className="h-20 w-full" />
                          </button>
                        </div>
                      ) : null}
                      <div className="mt-2">
                        <SlotVersions
                          slot={slot}
                          onAdopt={(vid) => adoptVariant(slot.id, vid)}
                          onClearAdopt={() => clearAdoptVariant(slot.id)}
                          onRemove={(vid) => removeVariant(slot.id, vid)}
                          onPreview={(v) => void openPreview(v)}
                          onSendToCanvas={(s, v) => void sendVariantToCanvas(s, v)}
                          disabled={!!busySlotsRef.current[slot.id]}
                        />
                      </div>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </div>
              </div>
            </div>
          </div>
        </div>

        {/* Right column (70%): shots */}
        <div className="min-h-0 flex-1 overflow-y-auto pr-1 space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-sm font-semibold text-[var(--text-primary)]">镜头列表</div>
            <div className="text-xs text-[var(--text-secondary)]">推荐流程：先生成首帧/尾帧满意后，再生成视频（新增版本不覆盖）。</div>
          </div>
          <Button onClick={addShot} className="gap-1">
            <Plus className="h-4 w-4" />
            添加镜头
          </Button>
        </div>

        {draft.shots.length === 0 ? (
          <div className="rounded-xl border border-[var(--border-color)] bg-[var(--bg-primary)] p-6 text-sm text-[var(--text-secondary)]">
            还没有镜头。点击右上角“添加镜头”开始。
          </div>
        ) : null}

        <div className="space-y-4">
          {draft.shots.map((shot, idx) => {
            const startSlot = shot.frames.start.slot
            const endSlot = shot.frames.end.slot
            const videoSlot = shot.video

            const startSelected = (startSlot.variants || []).find((v) => v.id === startSlot.selectedVariantId) || null
            const endSelected = (endSlot.variants || []).find((v) => v.id === endSlot.selectedVariantId) || null
            const videoSelected = (videoSlot.variants || []).find((v) => v.id === videoSlot.selectedVariantId) || null

            const startBusy = !!busySlotIds[startSlot.id]
            const endBusy = !!busySlotIds[endSlot.id]
            const videoBusy = !!busySlotIds[videoSlot.id]

            return (
              <div key={shot.id} className="rounded-xl border border-[var(--border-color)] bg-[var(--bg-primary)] p-4">
                <div className="flex items-center gap-2">
                  <input
                    value={shot.title}
                    onChange={(e) => updateShot(shot.id, { title: e.target.value })}
                    className="w-full rounded-lg border border-[var(--border-color)] bg-[var(--bg-primary)] px-3 py-2 text-sm font-medium text-[var(--text-primary)] focus:border-[var(--accent-color)] focus:outline-none"
                    placeholder={`镜头 ${idx + 1}`}
                  />
                  <Button size="sm" variant="ghost" className="text-red-500" onClick={() => removeShot(shot.id)} title="删除镜头">
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>

                <div className="mt-3 grid gap-3 md:grid-cols-2">
                  <div className="flex flex-col gap-2">
                    <label className="text-[11px] font-bold uppercase text-[var(--text-secondary)]">场景</label>
                    <select
                      value={shot.sceneId || ''}
                      onChange={(e) => updateShot(shot.id, { sceneId: e.target.value || undefined })}
                      className="w-full rounded-lg border border-[var(--border-color)] bg-[var(--bg-primary)] px-3 py-2 text-sm text-[var(--text-primary)] focus:border-[var(--accent-color)] focus:outline-none"
                    >
                      <option value="">（不指定）</option>
                      {draft.scenes.map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.name}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="flex flex-col gap-2">
                    <label className="text-[11px] font-bold uppercase text-[var(--text-secondary)]">出镜角色</label>
                    <div className="flex flex-wrap gap-2 rounded-lg border border-[var(--border-color)] bg-[var(--bg-primary)] p-2">
                      {draft.characters.length === 0 ? (
                        <div className="text-xs text-[var(--text-secondary)]">暂无角色</div>
                      ) : (
                        draft.characters.map((c) => {
                          const checked = shot.characterIds.includes(c.id)
                          return (
                            <label key={c.id} className="flex items-center gap-1 text-xs text-[var(--text-secondary)]">
                              <input
                                type="checkbox"
                                checked={checked}
                                onChange={(e) => {
                                  const next = e.target.checked
                                    ? Array.from(new Set([...shot.characterIds, c.id]))
                                    : shot.characterIds.filter((id) => id !== c.id)
                                  updateShot(shot.id, { characterIds: next })
                                }}
                              />
                              {c.name}
                            </label>
                          )
                        })
                      )}
                    </div>
                  </div>
                </div>

                <div className="mt-3 flex flex-col gap-2">
                  <label className="text-[11px] font-bold uppercase text-[var(--text-secondary)]">出镜资产</label>
                  <div className="flex flex-wrap gap-2 rounded-lg border border-[var(--border-color)] bg-[var(--bg-primary)] p-2">
                    {(draft.assets || []).length === 0 ? (
                      <div className="text-xs text-[var(--text-secondary)]">暂无资产</div>
                    ) : (
                      (draft.assets || []).map((a) => {
                        const checked = (shot.assetIds || []).includes(a.id)
                        return (
                          <label key={a.id} className="flex items-center gap-1 text-xs text-[var(--text-secondary)]">
                            <input
                              type="checkbox"
                              checked={checked}
                              onChange={(e) => {
                                const current = shot.assetIds || []
                                const next = e.target.checked
                                  ? Array.from(new Set([...current, a.id]))
                                  : current.filter((id) => id !== a.id)
                                updateShot(shot.id, { assetIds: next })
                              }}
                            />
                            {a.name}
                          </label>
                        )
                      })
                    )}
                  </div>
                </div>

                <div className="mt-3 flex items-center gap-3">
                  <label className="text-[11px] font-bold uppercase text-[var(--text-secondary)]">帧模式</label>
                  <select
                    value={shot.frameMode || 'first_last'}
                    onChange={e => updateShot(shot.id, { frameMode: e.target.value as ShotFrameMode })}
                    className="rounded-lg border border-[var(--border-color)] bg-[var(--bg-primary)] px-2 py-1.5 text-xs"
                  >
                    <option value="first_only">仅首帧</option>
                    <option value="first_last">首尾帧</option>
                    <option value="grid_4">四宫格 (起承转合)</option>
                    <option value="grid_6">六宫格</option>
                    <option value="grid_9">九宫格 (3×3)</option>
                    <option value="grid_25">二十五宫格 (5×5)</option>
                  </select>
                </div>

                {(!shot.frameMode || shot.frameMode === 'first_only' || shot.frameMode === 'first_last') && (
                <div className="mt-3 grid gap-3 md:grid-cols-2">
                  <div className="flex flex-col gap-2">
                    <label className="text-[11px] font-bold uppercase text-[var(--text-secondary)]">首帧提示词</label>
                    <textarea
                      value={shot.frames.start.prompt}
                      onChange={(e) =>
                        setDraft((prev) => ({
                          ...prev,
                          shots: prev.shots.map((s) =>
                            s.id === shot.id ? { ...s, frames: { ...s.frames, start: { ...s.frames.start, prompt: e.target.value } } } : s
                          ),
                          updatedAt: Date.now(),
                        }))
                      }
                      className="min-h-[110px] w-full resize-y rounded-lg border border-[var(--border-color)] bg-[var(--bg-primary)] px-3 py-2 text-sm text-[var(--text-primary)] focus:border-[var(--accent-color)] focus:outline-none"
                      placeholder="描述首帧画面：人物动作、表情、构图、镜头、光线…"
                    />
                  </div>
                  {shot.frameMode !== 'first_only' && (
                  <div className="flex flex-col gap-2">
                    <label className="text-[11px] font-bold uppercase text-[var(--text-secondary)]">尾帧提示词</label>
                    <textarea
                      value={shot.frames.end.prompt}
                      onChange={(e) =>
                        setDraft((prev) => ({
                          ...prev,
                          shots: prev.shots.map((s) =>
                            s.id === shot.id ? { ...s, frames: { ...s.frames, end: { ...s.frames.end, prompt: e.target.value } } } : s
                          ),
                          updatedAt: Date.now(),
                        }))
                      }
                      className="min-h-[110px] w-full resize-y rounded-lg border border-[var(--border-color)] bg-[var(--bg-primary)] px-3 py-2 text-sm text-[var(--text-primary)] focus:border-[var(--accent-color)] focus:outline-none"
                      placeholder="描述尾帧画面：最终姿态/走位/镜头结束构图…"
                    />
                  </div>
                  )}
                </div>
                )}

                {(shot.frameMode === 'grid_4' || shot.frameMode === 'grid_6' || shot.frameMode === 'grid_9' || shot.frameMode === 'grid_25') && (
                  <div className="mt-3 space-y-2">
                    <div className="text-xs font-medium text-[var(--text-secondary)]">宫格提示词</div>
                    <div className={cn('grid gap-2',
                      shot.frameMode === 'grid_4' ? 'grid-cols-2' :
                      shot.frameMode === 'grid_6' ? 'grid-cols-3' :
                      shot.frameMode === 'grid_9' ? 'grid-cols-3' : 'grid-cols-5'
                    )}>
                      {Array.from({ length: SHOT_FRAME_MODES.find(m => m.value === shot.frameMode)?.count || 4 }).map((_, i) => (
                        <textarea
                          key={i}
                          value={(shot.gridPrompts || [])[i] || ''}
                          onChange={e => {
                            const prompts = [...(shot.gridPrompts || [])]
                            prompts[i] = e.target.value
                            updateShot(shot.id, { gridPrompts: prompts })
                          }}
                          placeholder={`Panel ${i + 1}`}
                          rows={2}
                          className="rounded-lg border border-[var(--border-color)] bg-[var(--bg-primary)] px-2 py-1 text-[10px] resize-none focus:border-[var(--accent-color)] focus:outline-none"
                        />
                      ))}
                    </div>
                  </div>
                )}

                {(!shot.frameMode || shot.frameMode === 'first_only' || shot.frameMode === 'first_last') && (
                <div className="mt-3 grid gap-3 md:grid-cols-2">
                  <div className="rounded-xl border border-[var(--border-color)] bg-[var(--bg-secondary)] p-3">
                    <div className="flex items-center justify-between">
                      <div className="flex flex-col">
                        <div className="text-xs font-semibold text-[var(--text-primary)]">首帧版本</div>
                        {!videoModelSupportsFirstFrame && startSelected && (
                          <div className="text-[10px] text-amber-600">⚠️ 当前模型不支持首帧，生成视频时将忽略</div>
                        )}
                      </div>
                      <div className="flex items-center gap-2">
                        <label className="mr-1 flex items-center gap-2 text-xs text-[var(--text-secondary)]">
                          <input
                            type="checkbox"
                            checked={!!startSlot.selectionLockedByUser}
                            onChange={(e) => setDraft((prev) => setSlotSelectionLocked(prev, startSlot.id, e.target.checked))}
                          />
                          锁定采用
                        </label>
                        <input
                          type="file"
                          accept="image/*"
                          multiple
                          className="hidden"
                          id={`upload-start-${shot.id}`}
                          onChange={(e) => {
                            const files = Array.from(e.target.files || [])
                            if (files.length === 0) return
                            void (async () => {
                              for (const f of files) {
                                await uploadToImageSlot(startSlot.id, f)
                              }
                            })()
                            e.currentTarget.value = ''
                          }}
                        />
                        <Button
                          size="sm"
                          variant="ghost"
                          className="gap-1"
                          type="button"
                          onClick={() => document.getElementById(`upload-start-${shot.id}`)?.click()}
                        >
                          <Upload className="h-4 w-4" />
                          上传
                        </Button>
                        <Button size="sm" variant="ghost" type="button" onClick={() => openPickerForSlot(startSlot, `${shot.title || '镜头'} · 首帧`, 'history')}>
                          从历史导入
                        </Button>
                        <Button size="sm" variant="ghost" type="button" onClick={() => openPickerForSlot(startSlot, `${shot.title || '镜头'} · 首帧`, 'canvas')}>
                          从画布导入
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="gap-1"
                          disabled={startBusy}
                          onClick={() => void runGenerateFrameImage(shot.id, 'start')}
                        >
                          {startBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <ImageIcon className="h-4 w-4" />}
                          再生成
                        </Button>
                      </div>
                    </div>
                    {startSelected ? (
                      <div className="mt-2">
                        <button type="button" className="w-full" onClick={() => void openPreview(startSelected)} disabled={previewBusy} title="预览">
                          <VariantThumb variant={startSelected} className="h-28 w-full" />
                        </button>
                      </div>
                    ) : null}
                    <div className="mt-2">
                      <SlotVersions
                        slot={startSlot}
                        onAdopt={(vid) => adoptVariant(startSlot.id, vid)}
                          onClearAdopt={() => clearAdoptVariant(startSlot.id)}
                        onRemove={(vid) => removeVariant(startSlot.id, vid)}
                        onPreview={(v) => void openPreview(v)}
                        onSendToCanvas={(slot, v) => void sendVariantToCanvas(slot, v)}
                        disabled={startBusy}
                      />
                    </div>
                  </div>

                  {shot.frameMode !== 'first_only' && (
                  <div className="rounded-xl border border-[var(--border-color)] bg-[var(--bg-secondary)] p-3">
                    <div className="flex items-center justify-between">
                      <div className="flex flex-col">
                        <div className="text-xs font-semibold text-[var(--text-primary)]">尾帧版本</div>
                        {!videoModelSupportsLastFrame && endSelected && (
                          <div className="text-[10px] text-amber-600">⚠️ 当前模型不支持尾帧，生成视频时将忽略</div>
                        )}
                        {videoModelSupportsLastFrame && endSelected && (VIDEO_MODELS.find((m) => m.key === draft.models.videoModelKey)?.supportsSound || VIDEO_MODELS.find((m) => m.key === draft.models.videoModelKey)?.defaultParams?.sound === 'on') && (
                          <div className="text-[10px] text-amber-600">⚠️ 已选尾帧，生成视频时音频将被禁用</div>
                        )}
                      </div>
                      <div className="flex items-center gap-2">
                        <label className="mr-1 flex items-center gap-2 text-xs text-[var(--text-secondary)]">
                          <input
                            type="checkbox"
                            checked={!!endSlot.selectionLockedByUser}
                            onChange={(e) => setDraft((prev) => setSlotSelectionLocked(prev, endSlot.id, e.target.checked))}
                          />
                          锁定采用
                        </label>
                        <input
                          type="file"
                          accept="image/*"
                          multiple
                          className="hidden"
                          id={`upload-end-${shot.id}`}
                          onChange={(e) => {
                            const files = Array.from(e.target.files || [])
                            if (files.length === 0) return
                            void (async () => {
                              for (const f of files) {
                                await uploadToImageSlot(endSlot.id, f)
                              }
                            })()
                            e.currentTarget.value = ''
                          }}
                        />
                        <Button
                          size="sm"
                          variant="ghost"
                          className="gap-1"
                          type="button"
                          onClick={() => document.getElementById(`upload-end-${shot.id}`)?.click()}
                        >
                          <Upload className="h-4 w-4" />
                          上传
                        </Button>
                        <Button size="sm" variant="ghost" type="button" onClick={() => openPickerForSlot(endSlot, `${shot.title || '镜头'} · 尾帧`, 'history')}>
                          从历史导入
                        </Button>
                        <Button size="sm" variant="ghost" type="button" onClick={() => openPickerForSlot(endSlot, `${shot.title || '镜头'} · 尾帧`, 'canvas')}>
                          从画布导入
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="gap-1"
                          disabled={endBusy}
                          onClick={() => void runGenerateFrameImage(shot.id, 'end')}
                        >
                          {endBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <ImageIcon className="h-4 w-4" />}
                          再生成
                        </Button>
                      </div>
                    </div>
                    {endSelected ? (
                      <div className="mt-2">
                        <button type="button" className="w-full" onClick={() => void openPreview(endSelected)} disabled={previewBusy} title="预览">
                          <VariantThumb variant={endSelected} className="h-28 w-full" />
                        </button>
                      </div>
                    ) : null}
                    <div className="mt-2">
                      <SlotVersions
                        slot={endSlot}
                        onAdopt={(vid) => adoptVariant(endSlot.id, vid)}
                          onClearAdopt={() => clearAdoptVariant(endSlot.id)}
                        onRemove={(vid) => removeVariant(endSlot.id, vid)}
                        onPreview={(v) => void openPreview(v)}
                        onSendToCanvas={(slot, v) => void sendVariantToCanvas(slot, v)}
                        disabled={endBusy}
                      />
                    </div>
                  </div>
                  )}
                </div>
                )}

                <div className="mt-3 rounded-xl border border-[var(--border-color)] bg-[var(--bg-secondary)] p-3">
                  <div className="flex items-center justify-between">
                    <div className="text-xs font-semibold text-[var(--text-primary)]">视频版本</div>
                    <div className="flex items-center gap-2">
                      <label className="mr-1 flex items-center gap-2 text-xs text-[var(--text-secondary)]">
                        <input
                          type="checkbox"
                          checked={!!videoSlot.selectionLockedByUser}
                          onChange={(e) => setDraft((prev) => setSlotSelectionLocked(prev, videoSlot.id, e.target.checked))}
                        />
                        锁定采用
                      </label>
                      <Button size="sm" variant="ghost" disabled={videoBusy} onClick={() => openPickerForSlot(videoSlot, `${shot.title || '镜头'} · 视频`, 'history')}>
                        从历史导入
                      </Button>
                      <Button size="sm" variant="ghost" disabled={videoBusy} onClick={() => openPickerForSlot(videoSlot, `${shot.title || '镜头'} · 视频`, 'canvas')}>
                        从画布导入
                      </Button>
                      <Button size="sm" variant="secondary" className="gap-1" disabled={videoBusy} onClick={() => void runGenerateShotVideo(shot.id)}>
                        {videoBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <VideoIcon className="h-4 w-4" />}
                        生成视频（新增版本）
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={!videoSelected || videoSelected.status !== 'success'}
                        onClick={() => {
                          // 跳转前强制落盘（避免 debounced 保存窗口导致“返回后版本消失”）
                          try {
                            void saveShortDramaDraftV2(projectId, draft)
                          } catch {
                            // ignore
                          }
                          try {
                            void saveShortDramaPrefs(projectId, prefs)
                          } catch {
                            // ignore
                          }
                          navigate(`/edit/${projectId}?shotId=${shot.id}&videoVariantId=${videoSelected?.id || ''}`)
                        }}
                      >
                        进入剪辑台
                      </Button>
                    </div>
                  </div>
                  <div className="mt-2 flex flex-col gap-2">
                    <label className="text-[11px] font-bold uppercase text-[var(--text-secondary)]">视频提示词（可选）</label>
                    <textarea
                      value={shot.videoPrompt}
                      onChange={(e) => updateShot(shot.id, { videoPrompt: e.target.value })}
                      className="min-h-[70px] w-full resize-y rounded-lg border border-[var(--border-color)] bg-[var(--bg-primary)] px-3 py-2 text-sm text-[var(--text-primary)] focus:border-[var(--accent-color)] focus:outline-none"
                      placeholder="描述运镜与动作；为空则复用首帧提示词"
                    />
                  </div>
                  {videoSelected ? (
                    <div className="mt-2">
                      <button type="button" className="w-full" onClick={() => void openPreview(videoSelected)} disabled={previewBusy} title="预览">
                        <VariantThumb variant={videoSelected} className="h-40 w-full" />
                      </button>
                    </div>
                  ) : null}
                  <div className="mt-2">
                    <SlotVersions
                      slot={videoSlot}
                      onAdopt={(vid) => adoptVariant(videoSlot.id, vid)}
                          onClearAdopt={() => clearAdoptVariant(videoSlot.id)}
                      onRemove={(vid) => removeVariant(videoSlot.id, vid)}
                      onPreview={(v) => void openPreview(v)}
                      onSendToCanvas={(slot, v) => void sendVariantToCanvas(slot, v)}
                      disabled={videoBusy}
                    />
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      </div>
      </div>

      <ShortDramaMediaPickerModal
        open={pickerOpen}
        onClose={() => setPickerOpen(false)}
        title={
          pickerTarget?.kind === 'character_refs'
            ? '选择图片添加到角色参考'
            : pickerTarget?.kind === 'scene_refs'
              ? '选择图片添加到场景参考'
              : pickerTarget?.label
                ? `选择素材添加到 ${pickerTarget.label}`
                : undefined
        }
        initialTab={pickerInitialTab}
        kinds={pickerKinds}
        multiple
        onConfirm={(items) => {
          void handlePickedImages(items)
        }}
      />

      <MediaPreviewModal open={previewOpen} url={previewUrl} type={previewType} onClose={() => setPreviewOpen(false)} />

      <ShortDramaBlendPanel
        open={blendPanelOpen}
        onClose={() => setBlendPanelOpen(false)}
        draft={draft}
        onAddImage={(imageData, title) => {
          useAssetsStore.getState().addAsset({
            type: 'image',
            src: imageData,
            title: title || `融合图片-${Date.now()}`,
            model: 'blend'
          })
          window.$message?.success?.('融合图片已添加到素材库，可从历史导入到任意位置')
          setBlendPanelOpen(false)
        }}
      />
    </>
  )
}
