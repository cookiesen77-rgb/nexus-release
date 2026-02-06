import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { CHAT_MODELS, DEFAULT_CHAT_MODEL, DEFAULT_IMAGE_MODEL, DEFAULT_VIDEO_MODEL, IMAGE_MODELS, VIDEO_MODELS } from '@/config/models'
import * as modelsConfig from '@/config/models'
import { cn } from '@/lib/utils'
import { importShortDramaScriptFile } from '@/lib/shortDrama/scriptImport'
import { analyzeShortDramaScriptToDraftV2 } from '@/lib/shortDrama/ai'
import { getShortDramaTaskQueue } from '@/lib/shortDrama/taskQueue'
import { buildEffectiveStyle, getShortDramaStylePresetById, SHORT_DRAMA_STYLE_PRESETS } from '@/lib/shortDrama/stylePresets'
import { generateShortDramaImage, generateShortDramaVideo } from '@/lib/shortDrama/generateMedia'
import { appendVariantToSlot, removeVariantFromSlot, setSlotSelectionLocked, setSlotSelectedVariant, updateSlotById, updateVariantInSlot } from '@/lib/shortDrama/draftOps'
import { saveShortDramaDraftV2, createEmptyAsset } from '@/lib/shortDrama/draftStorage'
import { getMedia, saveMedia } from '@/lib/mediaStorage'
import { resolveCachedMediaUrl } from '@/lib/workflow/cache'
import { useGraphStore } from '@/graph/store'
import { useAssetsStore } from '@/store/assets'
import MediaPreviewModal from '@/components/canvas/MediaPreviewModal'
import ShortDramaMediaPickerModal, { type ShortDramaPickKind, type ShortDramaPickedMedia } from '@/components/shortDrama/ShortDramaMediaPickerModal'
import { ShortDramaSlotVersions, ShortDramaVariantThumb } from '@/components/shortDrama/ShortDramaSlotVersions'
import ShortDramaBlendPanel from '@/components/shortDrama/ShortDramaBlendPanel'
import type { ShortDramaDraftV2, ShortDramaMediaSlot, ShortDramaMediaVariant } from '@/lib/shortDrama/types'
import { saveShortDramaPrefs, type ShortDramaStudioPrefsV1 } from '@/lib/shortDrama/uiPrefs'
import { FileText, Loader2, Upload, Video as VideoIcon, Wand2, Sword, Layers } from 'lucide-react'

interface Props {
  projectId: string
  draft: ShortDramaDraftV2
  setDraft: React.Dispatch<React.SetStateAction<ShortDramaDraftV2>>
  prefs: ShortDramaStudioPrefsV1
  setPrefs: React.Dispatch<React.SetStateAction<ShortDramaStudioPrefsV1>>
}

const makeId = () => globalThis.crypto?.randomUUID?.() || `sd_${Date.now()}_${Math.random().toString(16).slice(2)}`

const isHttp = (v: string) => /^https?:\/\//i.test(v)
const isTauri = typeof window !== 'undefined' && !!(window as any).__TAURI_INTERNALS__

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

// 视频 images 组装：首/尾允许重复，refs 去重且不顶替首尾语义
const buildVideoImages = (startInput: string, endInput: string, refs: string[]) => {
  const start = String(startInput || '').trim()
  const end = String(endInput || '').trim()
  const out: string[] = []
  if (start) out.push(start)
  if (end) out.push(end) // keep even if same as start
  const seen = new Set<string>()
  for (const v of out) {
    if (v) seen.add(v)
  }
  for (const r of refs || []) {
    const v = String(r || '').trim()
    if (!v) continue
    if (seen.has(v)) continue
    out.push(v)
    seen.add(v)
  }
  return out
}

export default function ShortDramaStudioAutoView({ projectId, draft, setDraft, prefs, setPrefs }: Props) {
  const navigate = useNavigate()
  const queue = useMemo(() => getShortDramaTaskQueue(projectId), [projectId])
  useEffect(() => {
    queue.setLimits({ imageConcurrency: prefs.imageConcurrency, videoConcurrency: prefs.videoConcurrency, analysisConcurrency: 1 })
  }, [queue, prefs.imageConcurrency, prefs.videoConcurrency])

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

  const patchModels = useCallback(
    (patch: Partial<ShortDramaDraftV2['models']>) => {
      setDraft((prev) => ({ ...prev, models: { ...prev.models, ...patch }, updatedAt: Date.now() }))
    },
    [setDraft]
  )

  // 当切换模型/选项变化时，自动清理不兼容的比例/画质/时长选择（避免“看似选了但请求不生效/直接报错”）
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

  const patchStyle = useCallback(
    (patch: Partial<ShortDramaDraftV2['style']>) => {
      setDraft((prev) => ({ ...prev, style: { ...prev.style, ...patch }, updatedAt: Date.now() }))
    },
    [setDraft]
  )

  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const [analysisBusy, setAnalysisBusy] = useState(false)
  const [analysisError, setAnalysisError] = useState<string>('')
  const [analysisRaw, setAnalysisRaw] = useState<string>('')
  const [prepBusy, setPrepBusy] = useState(false)
  const [keyframesBusy, setKeyframesBusy] = useState(false)
  const [videosBusy, setVideosBusy] = useState(false)
  const autoPipelineRef = useRef(false)
  const [autoPipelineToken, setAutoPipelineToken] = useState(0)

  const [previewOpen, setPreviewOpen] = useState(false)
  const [previewUrl, setPreviewUrl] = useState('')
  const [previewType, setPreviewType] = useState<'image' | 'video'>('image')
  const [previewBusy, setPreviewBusy] = useState(false)

  const [blendPanelOpen, setBlendPanelOpen] = useState(false)

  type PickerTarget = { slotId: string; label?: string }
  const [pickerOpen, setPickerOpen] = useState(false)
  const [pickerInitialTab, setPickerInitialTab] = useState<'history' | 'canvas'>('history')
  const [pickerKinds, setPickerKinds] = useState<ShortDramaPickKind[]>(['image'])
  const [pickerTarget, setPickerTarget] = useState<PickerTarget | null>(null)
  const pickerTargetRef = useRef<PickerTarget | null>(null)
  pickerTargetRef.current = pickerTarget

  const [busySlotIds, setBusySlotIds] = useState<Record<string, boolean>>({})
  const [staleTick, setStaleTick] = useState(0)
  const busySlotsRef = useRef(busySlotIds)
  busySlotsRef.current = busySlotIds

  const setSlotBusy = useCallback((slotId: string, busy: boolean) => {
    setBusySlotIds((prev) => ({ ...prev, [slotId]: busy }))
  }, [])

  // 修复“任务已完成但 UI 仍显示生成中”的异常状态：
  // 若某个 slot 没有正在运行的任务（busy=false），但 variants 里仍存在 running，则将其标记为 error，
  // 避免批量逻辑误判为“已采用”而跳过，同时引导用户重新生成或从历史/画布导入补齐。
  const markSlotStaleRunning = useCallback(
    (slotId: string, minAgeMs = 3000) => {
      if (!slotId) return
      if (busySlotsRef.current[slotId]) return
      const now = Date.now()
      setDraft((prev) =>
        updateSlotById(prev, slotId, (slot) => {
          const variants = slot?.variants || []
          if (variants.length === 0) return slot
          let changed = false
          const nextVariants = variants.map((v) => {
            if (v.status !== 'running') return v
            const age = now - Number(v.createdAt || 0)
            if (minAgeMs > 0 && age < minAgeMs) return v
            changed = true
            return {
              ...v,
              status: 'error',
              error:
                v.error ||
                '生成状态异常：未检测到运行任务（可能已中断，或已完成但未写回）。请重新生成，或用“从历史/画布导入”补齐。',
            } as ShortDramaMediaVariant
          })
          if (!changed) return slot
          return { ...slot, variants: nextVariants }
        })
      )
    },
    [setDraft]
  )

  // 自动清理“无任务在跑但仍显示 running”的陈旧版本（例如：刷新/重启后遗留的状态）。
  useEffect(() => {
    const minAgeMs = 20_000
    const now = Date.now()
    const dueTimes: number[] = []

    const inspectSlot = (slot: ShortDramaMediaSlot, busy: boolean) => {
      if (busy) return
      const running = (slot.variants || []).filter((v) => v.status === 'running')
      if (running.length === 0) return
      const oldest = Math.min(...running.map((v) => Number(v.createdAt || 0) || now))
      const age = now - oldest
      if (age >= minAgeMs) {
        markSlotStaleRunning(slot.id, minAgeMs)
      } else {
        dueTimes.push(oldest + minAgeMs)
      }
    }

    try {
      for (const c of draft.characters) inspectSlot(c.sheet, !!busySlotIds[c.sheet.id])
      for (const s of draft.scenes) inspectSlot(s.ref, !!busySlotIds[s.ref.id])
      for (const sh of draft.shots) {
        inspectSlot(sh.frames.start.slot, !!busySlotIds[sh.frames.start.slot.id])
        inspectSlot(sh.frames.end.slot, !!busySlotIds[sh.frames.end.slot.id])
        inspectSlot(sh.video, !!busySlotIds[sh.video.id])
      }
    } catch {
      // ignore
    }

    if (dueTimes.length === 0) return
    const nextDue = Math.min(...dueTimes.filter((t) => Number.isFinite(t)))
    const waitMs = Math.max(200, Math.min(10_000, nextDue - Date.now() + 50))
    const t = window.setTimeout(() => setStaleTick((x) => x + 1), waitMs)
    return () => window.clearTimeout(t)
  }, [busySlotIds, draft.characters, draft.scenes, draft.shots, markSlotStaleRunning, staleTick])

  const getSelectedVariant = useCallback((slot: ShortDramaMediaSlot) => {
    const id = slot.selectedVariantId
    return (slot.variants || []).find((v) => v.id === id) || null
  }, [])

  const resolveVariantInput = useCallback(async (variant: ShortDramaMediaVariant | undefined): Promise<string> => {
    if (!variant) return ''
    const s = String(variant.sourceUrl || '').trim()
    if (s && isHttp(s)) return s
    if (variant.mediaId) {
      try {
        const rec = await getMedia(variant.mediaId)
        const dataUrl = String(rec?.data || '').trim()
        if (dataUrl) return dataUrl
      } catch {
        // ignore
      }
    }
    const d = String(variant.displayUrl || '').trim()
    return d
  }, [])

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

        // 视频在 Tauri 下尽量走缓存后的 asset://（更稳定）
        if (variant.kind === 'video' && isTauri) {
          const isAlreadyLocal = url.startsWith('asset://') || url.startsWith('data:') || url.startsWith('blob:')
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

  const openPickerForSlot = useCallback((slot: ShortDramaMediaSlot, label: string, initialTab: 'history' | 'canvas') => {
    setPickerTarget({ slotId: slot.id, label })
    setPickerKinds([slot.kind])
    setPickerInitialTab(initialTab)
    setPickerOpen(true)
  }, [])

  const variantFromPicked = useCallback(
    async (slotId: string, picked: ShortDramaPickedMedia): Promise<ShortDramaMediaVariant> => {
      const variantId = makeId()
      const label = String(picked.label || '').trim()
      const src0 = String(picked.sourceUrl || '').trim()
      const display0 = String(picked.displayUrl || '').trim()
      const kind = picked.kind === 'video' ? 'video' : 'image'

      let sourceUrl = src0 && isHttp(src0) ? src0 : ''
      let displayUrl = display0
      let mediaId = String(picked.mediaId || '').trim()

      // If we have a large inline dataURL and no mediaId, persist it (avoid bloating localStorage).
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
      if (!sourceUrl && isHttp(displayUrl)) {
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

  const handlePickedMedia = useCallback(
    async (items: ShortDramaPickedMedia[]) => {
      const target = pickerTargetRef.current
      if (!target) return
      if (!Array.isArray(items) || items.length === 0) return

      const slotId = target.slotId
      const expectedKind = (pickerKinds && pickerKinds[0]) || 'image'
      const filtered = items.filter((it) => it.kind === expectedKind)
      if (filtered.length === 0) {
        window.$message?.warning?.(expectedKind === 'video' ? '请选择视频' : '请选择图片')
        return
      }

      const variants: ShortDramaMediaVariant[] = []
      for (const it of filtered) variants.push(await variantFromPicked(slotId, it))

      setDraft((prev) => {
        let cur = prev
        for (const v of variants) cur = appendVariantToSlot(cur, slotId, v)
        return { ...cur, updatedAt: Date.now() }
      })
      window.$message?.success?.(`已添加 ${variants.length} 个版本`)
    },
    [appendVariantToSlot, pickerKinds, setDraft, variantFromPicked]
  )

  const sendVariantToCanvas = useCallback(
    async (variant: ShortDramaMediaVariant | null, label: string) => {
      if (!variant || variant.status !== 'success') {
        window.$message?.warning?.('请先选择成功的版本')
        return
      }
      const url = await resolveVariantInput(variant || undefined)
      if (!url) {
        window.$message?.error?.('素材没有可用的地址')
        return
      }

      const gs = useGraphStore.getState()
      const vp: any = (gs as any).viewport || { x: 0, y: 0, zoom: 1 }
      const z = Number(vp.zoom || 1) || 1
      const x = (-Number(vp.x || 0) + 560) / z
      const y = (-Number(vp.y || 0) + 320) / z

      const nodeType = variant.kind === 'video' ? 'video' : 'image'
      const data: Record<string, unknown> = {
        label: String(label || (variant.kind === 'video' ? '视频' : '图片')).slice(0, 80),
        url,
      }
      const src = String(variant.sourceUrl || '').trim()
      if (src && isHttp(src)) data.sourceUrl = src
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

  const buildCharacterSheetPrompt = useCallback(
    (characterId: string) => {
      const c = draft.characters.find((x) => x.id === characterId)
      if (!c) return ''
      const style = buildEffectiveStyle(draft.style)
      const preset = getShortDramaStylePresetById(draft.style.presetId)

      return [
        draft.title ? `短剧标题：${draft.title}` : '',
        draft.logline ? `短剧梗概：\n${draft.logline}` : '',
        `风格预设：${preset.name}\n${preset.description}`,
        style.styleText ? `统一画风/镜头语言（必须严格遵守）：\n${style.styleText}` : '',
        style.negativeText ? `全局负面约束（严格避免）：\n${style.negativeText}` : '',
        `角色：${String(c.name || '').trim()}`,
        c.description ? `角色设定（必须保持一致性）：\n${String(c.description || '').trim()}` : '',
        [
          '请生成「单张」角色设定图（character sheet），不要输出解释文字。',
          '同一张图中包含：正面全身、侧面全身、背面全身，以及至少 6 种表情（中性/开心/愤怒/悲伤/惊讶/害怕）。',
          '要求：同一个角色（同一张脸/发型/服装/体型），干净背景，构图清晰；不要文字标签、不要水印。',
        ].join('\n'),
      ]
        .map((s) => String(s || '').trim())
        .filter(Boolean)
        .join('\n\n')
        .trim()
    },
    [draft]
  )

  const collectRefImagesForCharacter = useCallback(
    async (characterId: string) => {
      const c = draft.characters.find((x) => x.id === characterId)
      if (!c) return []
      const inputs: string[] = []
      for (const slot of c.refs || []) {
        const v = getSelectedVariant(slot)
        const input = await resolveVariantInput(v || undefined)
        if (input) inputs.push(input)
      }
      return Array.from(new Set(inputs)).filter(Boolean)
    },
    [draft.characters, getSelectedVariant, resolveVariantInput]
  )

  const buildScenePrompt = useCallback(
    (sceneId: string) => {
      const s = draft.scenes.find((x) => x.id === sceneId)
      if (!s) return ''
      const style = buildEffectiveStyle(draft.style)
      const preset = getShortDramaStylePresetById(draft.style.presetId)
      return [
        draft.title ? `短剧标题：${draft.title}` : '',
        draft.logline ? `短剧梗概：\n${draft.logline}` : '',
        `风格预设：${preset.name}\n${preset.description}`,
        style.styleText ? `统一画风/镜头语言（必须严格遵守）：\n${style.styleText}` : '',
        style.negativeText ? `全局负面约束（严格避免）：\n${style.negativeText}` : '',
        `场景：${String(s.name || '').trim()}`,
        s.description ? `场景固定元素（必须保持一致性）：\n${String(s.description || '').trim()}` : '',
        '请生成该场景的参考图（仅场景环境，不要出现人物），不要输出任何解释文字。',
      ]
        .map((x) => String(x || '').trim())
        .filter(Boolean)
        .join('\n\n')
        .trim()
    },
    [draft]
  )

  const buildAssetPrompt = useCallback(
    (assetId: string) => {
      const a = (draft.assets || []).find((x) => x.id === assetId)
      if (!a) return ''
      const style = buildEffectiveStyle(draft.style)
      const preset = getShortDramaStylePresetById(draft.style.presetId)
      const categoryLabels: Record<string, string> = {
        weapon: '武器',
        prop: '道具',
        vehicle: '载具',
        accessory: '配饰',
        item: '物品',
        other: '其他'
      }
      const ownerNames = (a.ownerCharacterIds || [])
        .map((id) => draft.characters.find((c) => c.id === id)?.name)
        .filter(Boolean)
        .join('、')
      return [
        draft.title ? `短剧标题：${draft.title}` : '',
        draft.logline ? `短剧梗概：\n${draft.logline}` : '',
        `风格预设：${preset.name}\n${preset.description}`,
        style.styleText ? `统一画风/镜头语言（必须严格遵守）：\n${style.styleText}` : '',
        style.negativeText ? `全局负面约束（严格避免）：\n${style.negativeText}` : '',
        `资产类型：${categoryLabels[a.category] || a.category}`,
        `资产名称：${String(a.name || '').trim()}`,
        a.description ? `资产描述（必须保持一致性）：\n${String(a.description || '').trim()}` : '',
        ownerNames ? `所属角色：${ownerNames}` : '',
        '请生成该资产的参考图（单独展示该物品，不要出现人物），干净背景，构图清晰，不要文字标签、不要水印。',
      ]
        .map((x) => String(x || '').trim())
        .filter(Boolean)
        .join('\n\n')
        .trim()
    },
    [draft]
  )

  const collectRefImagesForAsset = useCallback(
    async (assetId: string) => {
      const a = (draft.assets || []).find((x) => x.id === assetId)
      if (!a) return []
      const inputs: string[] = []
      // 收集资产自身的参考图
      for (const slot of a.refs || []) {
        const v = getSelectedVariant(slot)
        const input = await resolveVariantInput(v || undefined)
        if (input) inputs.push(input)
      }
      // 如果资产有所属角色，也收集角色的参考图作为风格参考
      for (const charId of a.ownerCharacterIds || []) {
        const charRefs = await collectRefImagesForCharacter(charId)
        inputs.push(...charRefs)
      }
      return Array.from(new Set(inputs)).filter(Boolean)
    },
    [draft.assets, getSelectedVariant, resolveVariantInput, collectRefImagesForCharacter]
  )

  const buildFramePrompt = useCallback(
    (shotId: string, role: 'start' | 'end') => {
      const shot = draft.shots.find((s) => s.id === shotId)
      if (!shot) return ''
      const frame = role === 'start' ? shot.frames.start : shot.frames.end
      const style = buildEffectiveStyle(draft.style)
      const preset = getShortDramaStylePresetById(draft.style.presetId)

      const parts: string[] = []
      if (draft.title) parts.push(`短剧标题：${draft.title}`)
      if (draft.logline) parts.push(`短剧梗概：\n${draft.logline}`)
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

      const beat = String(shot.beat || '').trim()
      if (beat) parts.push(`本镜头意图/节拍：\n${beat}`)

      const prompt = String(frame.prompt || '').trim()
      if (prompt) parts.push(prompt)
      return parts.join('\n\n').trim()
    },
    [draft]
  )

  const buildVideoPrompt = useCallback(
    (shotId: string) => {
      const shot = draft.shots.find((s) => s.id === shotId)
      if (!shot) return ''
      const style = buildEffectiveStyle(draft.style)
      const preset = getShortDramaStylePresetById(draft.style.presetId)

      const parts: string[] = []
      if (draft.title) parts.push(`短剧标题：${draft.title}`)
      if (draft.logline) parts.push(`短剧梗概：\n${draft.logline}`)
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
        const names = chars.map((c) => String(c.name || '').trim()).filter(Boolean).join('、')
        parts.push(`出镜角色：${names}`)
      }

      const v = String(shot.videoPrompt || '').trim() || String(shot.frames.start.prompt || '').trim()
      if (v) parts.push(`视频描述（动作/运镜/节奏）：\n${v}`)
      return parts.join('\n\n').trim()
    },
    [draft]
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

      // Character refs: sheet + refs
      for (const cid of shot.characterIds || []) {
        const c = draft.characters.find((x) => x.id === cid)
        if (!c) continue
        const sheetV = c.sheet ? getSelectedVariant(c.sheet) : null
        const sheetInput = await resolveVariantInput(sheetV || undefined)
        if (sheetInput) refInputs.push(sheetInput)
        for (const slot of c.refs || []) {
          const v = getSelectedVariant(slot)
          const input = await resolveVariantInput(v || undefined)
          if (input) refInputs.push(input)
        }
      }

      // End frame can use start frame as extra ref
      if (role === 'end') {
        const startV = getSelectedVariant(shot.frames.start.slot)
        const input = await resolveVariantInput(startV || undefined)
        if (input) refInputs.unshift(input)
      }

      return Array.from(new Set(refInputs)).filter(Boolean)
    },
    [draft, getSelectedVariant, resolveVariantInput]
  )

  const runGenerateSlotImage = useCallback(
    async (slotId: string, prompt: string, refImages: string[], createdBy: 'auto' | 'manual') => {
      if (busySlotsRef.current[slotId]) return
      const p = String(prompt || '').trim()
      if (!p) throw new Error('提示词为空')

      const running: ShortDramaMediaVariant = {
        id: makeId(),
        kind: 'image',
        status: 'running',
        createdAt: Date.now(),
        createdBy,
        modelKey: draft.models.imageModelKey,
        promptSnapshot: p,
        styleSnapshot: { ...draft.style },
      }
      setSlotBusy(slotId, true)
      setDraft((prev) => appendVariantToSlot(prev, slotId, running))
      try {
        const task = queue.enqueue('image', slotId, async () => {
          return await generateShortDramaImage({
            modelKey: draft.models.imageModelKey,
            prompt: p,
            size: draft.models.imageSize,
            quality: draft.models.imageQuality,
            refImages,
          })
        })
        const result = await task.promise

        const displayUrl = String(result.displayUrl || '').trim()
        const sourceUrl = String(result.imageUrl || '').trim()
        const safeSourceUrl = isHttp(sourceUrl) ? sourceUrl : ''
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
          // displayUrl 往往是 asset://（缓存后），但 API 输入需要真实图片内容；把原始 dataURL 落到 IndexedDB
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
            // 仅当 displayUrl 本身是 dataURL 时才清空，避免把大串写进 localStorage；asset:// 可保留用于预览
            displayUrl: isDisplayDataUrl && mediaId ? '' : displayUrl || undefined,
            localPath: result.localPath || '',
            mediaId,
          })
        )

        // 同步到历史素材（短剧自动模式）
        try {
          useAssetsStore.getState().addAsset({
            type: 'image',
            src: safeSourceUrl || displayUrl,
            title: String((p || '短剧图片').slice(0, 80)).trim(),
            model: draft.models.imageModelKey,
          })
        } catch {
          // ignore
        }
      } catch (err: any) {
        const msg = err instanceof Error ? err.message : String(err || '生成失败')
        setDraft((prev) => updateVariantInSlot(prev, slotId, running.id, { status: 'error', error: msg }))
        throw err
      } finally {
        setSlotBusy(slotId, false)
      }
    },
    [draft, projectId, queue, setDraft, setSlotBusy]
  )

  const runGenerateSlotVideo = useCallback(
    async (slotId: string, prompt: string, images: string[], lastFrame: string, createdBy: 'auto' | 'manual') => {
      if (busySlotsRef.current[slotId]) return
      const p = String(prompt || '').trim()
      if (!p && images.length === 0) throw new Error('提示词/首尾帧为空')

      const running: ShortDramaMediaVariant = {
        id: makeId(),
        kind: 'video',
        status: 'running',
        createdAt: Date.now(),
        createdBy,
        modelKey: draft.models.videoModelKey,
        promptSnapshot: p,
        styleSnapshot: { ...draft.style },
      }
      setSlotBusy(slotId, true)
      setDraft((prev) => appendVariantToSlot(prev, slotId, running))
      try {
        const task = queue.enqueue('video', slotId, async () => {
          return await generateShortDramaVideo({
            modelKey: draft.models.videoModelKey,
            prompt: p,
            ratio: draft.models.videoRatio,
            duration: draft.models.videoDuration,
            size: draft.models.videoSize,
            images,
            lastFrame,
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

        // 同步到历史素材（短剧自动模式）
        try {
          useAssetsStore.getState().addAsset({
            type: 'video',
            src: String(result.displayUrl || result.videoUrl || '').trim(),
            title: String((p || '短剧视频').slice(0, 80)).trim(),
            model: draft.models.videoModelKey,
            duration: Number(draft.models.videoDuration || 0),
          })
        } catch {
          // ignore
        }
      } catch (err: any) {
        const msg = err instanceof Error ? err.message : String(err || '生成失败')
        setDraft((prev) => updateVariantInSlot(prev, slotId, running.id, { status: 'error', error: msg }))
        throw err
      } finally {
        setSlotBusy(slotId, false)
      }
    },
    [draft, projectId, queue, setDraft, setSlotBusy]
  )

  const runAnalysis = useCallback(async () => {
    const script = String(draft.script.text || '').trim()
    if (!script) {
      window.$message?.error?.('请先导入/粘贴剧本')
      return
    }
    setAnalysisBusy(true)
    setAnalysisError('')
    setAnalysisRaw('')
    try {
      const res = await analyzeShortDramaScriptToDraftV2({ draft, modelKey: draft.models.analysisModelKey, scriptText: script })
      setAnalysisRaw(res.rawText)
      setDraft(res.draft)
      window.$message?.success?.('剧本分析完成')
      // 解析后：先自动生成“角色设定图 + 场景参考图”（一致性素材）。
      // 关键帧（首/尾）与视频必须由用户手动点击按钮触发（避免未确认一致性就开跑）。
      autoPipelineRef.current = true
      setAutoPipelineToken((x) => x + 1)
    } catch (err: any) {
      const raw = typeof err?.rawText === 'string' ? String(err.rawText) : ''
      if (raw) setAnalysisRaw(raw)
      const msg = err instanceof Error ? err.message : String(err || '分析失败')
      setAnalysisError(msg)
      window.$message?.error?.(msg)
    } finally {
      setAnalysisBusy(false)
    }
  }, [draft, setDraft])

  const runBatchGenerateCoreRefs = useCallback(async () => {
    // 1) Character sheets
    const charTasks = draft.characters.map(async (c) => {
      const slotId = c.sheet.id
      markSlotStaleRunning(slotId)
      const selected = getSelectedVariant(c.sheet)
      if (selected?.status === 'success') return
      const prompt = buildCharacterSheetPrompt(c.id)
      const refImages = await collectRefImagesForCharacter(c.id)
      await runGenerateSlotImage(slotId, prompt, refImages, 'auto')
    })

    // 2) Scene refs (primary)
    const sceneTasks = draft.scenes.map(async (s) => {
      const slotId = s.ref.id
      markSlotStaleRunning(slotId)
      const selected = getSelectedVariant(s.ref)
      if (selected?.status === 'success') return
      const prompt = buildScenePrompt(s.id)
      await runGenerateSlotImage(slotId, prompt, [], 'auto')
    })

    // 3) Asset refs
    const assetTasks = (draft.assets || []).map(async (a) => {
      const slotId = a.ref.id
      markSlotStaleRunning(slotId)
      const selected = getSelectedVariant(a.ref)
      if (selected?.status === 'success') return
      const prompt = buildAssetPrompt(a.id)
      const refImages = await collectRefImagesForAsset(a.id)
      await runGenerateSlotImage(slotId, prompt, refImages, 'auto')
    })

    await Promise.all([...charTasks, ...sceneTasks, ...assetTasks])
  }, [
    buildAssetPrompt,
    buildCharacterSheetPrompt,
    buildScenePrompt,
    collectRefImagesForAsset,
    collectRefImagesForCharacter,
    draft.assets,
    draft.characters,
    draft.scenes,
    getSelectedVariant,
    markSlotStaleRunning,
    runGenerateSlotImage,
  ])

  // 自动流水线：解析 -> 先生成角色/场景一致性素材（到此为止；关键帧/视频由用户手动触发）
  useEffect(() => {
    const shouldRun = autoPipelineRef.current
    if (!shouldRun) return
    autoPipelineRef.current = false
    void (async () => {
      setPrepBusy(true)
      try {
        await runBatchGenerateCoreRefs()
        window.$message?.success?.('角色/场景/资产参考图已生成（用于一致性）')
      } catch {
        // errors are already surfaced in variants
      } finally {
        setPrepBusy(false)
      }
    })()
  }, [autoPipelineToken, runBatchGenerateCoreRefs])

  const runBatchGenerateKeyframes = useCallback(async () => {
    setKeyframesBusy(true)
    try {
      // Shot frames (start & end) — 依赖角色/场景参考图（已在“分析并搭建”后优先生成）
      const shotStartTasks = draft.shots.map(async (sh) => {
        const slotId = sh.frames.start.slot.id
        markSlotStaleRunning(slotId)
        const selected = getSelectedVariant(sh.frames.start.slot)
        if (selected?.status === 'success') return
        const prompt = buildFramePrompt(sh.id, 'start')
        const refs = await collectRefImagesForShot(sh.id, 'start')
        await runGenerateSlotImage(slotId, prompt, refs, 'auto')
      })

      const shotEndTasks = draft.shots.map(async (sh) => {
        const slotId = sh.frames.end.slot.id
        markSlotStaleRunning(slotId)
        const selected = getSelectedVariant(sh.frames.end.slot)
        if (selected?.status === 'success') return
        const prompt = buildFramePrompt(sh.id, 'end')
        const refs = await collectRefImagesForShot(sh.id, 'end')
        await runGenerateSlotImage(slotId, prompt, refs, 'auto')
      })

      await Promise.all([...shotStartTasks, ...shotEndTasks])
      window.$message?.success?.('关键帧批量生成完成')
    } finally {
      setKeyframesBusy(false)
    }
  }, [
    buildCharacterSheetPrompt,
    buildFramePrompt,
    buildScenePrompt,
    collectRefImagesForCharacter,
    collectRefImagesForShot,
    draft.characters,
    draft.scenes,
    draft.shots,
    getSelectedVariant,
    markSlotStaleRunning,
    runGenerateSlotImage,
  ])

  const runBatchGenerateVideos = useCallback(async () => {
    setVideosBusy(true)
    try {
      const tasks = draft.shots.map(async (sh) => {
        const slotId = sh.video.id
        if (busySlotsRef.current[slotId]) return

        const startV = getSelectedVariant(sh.frames.start.slot)
        const endV = getSelectedVariant(sh.frames.end.slot)
        const startInput = await resolveVariantInput(startV || undefined)
        const endInput = await resolveVariantInput(endV || undefined)
        if (!startInput || !endInput) return

        const refs = await collectRefImagesForShot(sh.id, 'start')
        const images = buildVideoImages(startInput, endInput, refs)
        const prompt = buildVideoPrompt(sh.id)
        await runGenerateSlotVideo(slotId, prompt, images, endInput, 'auto')
      })
      await Promise.all(tasks)
      window.$message?.success?.('视频批量生成完成')
    } finally {
      setVideosBusy(false)
    }
  }, [buildVideoPrompt, collectRefImagesForShot, draft.shots, getSelectedVariant, resolveVariantInput, runGenerateSlotVideo])

  const onImportFile = useCallback(async (file: File) => {
    try {
      const imported = await importShortDramaScriptFile(file)
      setDraft((prev) => ({
        ...prev,
        script: {
          text: imported.text,
          importedAt: Date.now(),
          source: { type: 'file', fileName: imported.fileName } as any,
        },
        updatedAt: Date.now(),
      }))
      window.$message?.success?.('剧本已导入')
    } catch (err: any) {
      const msg = err instanceof Error ? err.message : String(err || '导入失败')
      window.$message?.error?.(msg)
    } finally {
      if (fileInputRef.current) fileInputRef.current.value = ''
    }
  }, [setDraft])

  const selectedPreset = useMemo(() => getShortDramaStylePresetById(draft.style.presetId), [draft.style.presetId])
  const shotsTotal = draft.shots.length
  const adoptedKeyframes = useMemo(() => {
    let ok = 0
    for (const sh of draft.shots) {
      const start = getSelectedVariant(sh.frames.start.slot)
      const end = getSelectedVariant(sh.frames.end.slot)
      if (start?.status === 'success' && end?.status === 'success') ok += 1
    }
    return ok
  }, [draft.shots, getSelectedVariant])

  return (
    <div className="flex h-full min-h-0 flex-col gap-4 lg:flex-row">
      {/* Left column (30%): top script/AI + bottom character/scene */}
      <div className="flex min-h-0 flex-1 flex-col gap-4 lg:flex-[0_0_30%] lg:min-w-[360px] lg:max-w-[520px]">
        <div className="flex min-h-0 flex-[0_0_42%] flex-col">
          <div className="flex items-center justify-between">
            <div className="text-[11px] font-bold uppercase text-[var(--text-secondary)]">剧本 / AI</div>
          </div>
          <div className="mt-2 min-h-0 flex-1 overflow-y-auto pr-1 space-y-4">
            <div className="rounded-xl border border-[var(--border-color)] bg-[var(--bg-primary)] p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="text-sm font-semibold text-[var(--text-primary)]">自动模式</div>
            <div className="mt-1 text-xs text-[var(--text-secondary)]">
              先用 AI 拆解剧本为「角色/场景/镜头（首帧/尾帧）」；分析后会优先生成角色/场景一致性参考图。首/尾关键帧与视频需你确认一致性后再手动点击生成。
            </div>
          </div>
          <div className="flex items-center gap-2">
            <div className="flex items-center rounded-lg border border-[var(--border-color)] bg-[var(--bg-secondary)] p-1">
              <Button
                size="sm"
                variant="ghost"
                className={cn('h-8 px-3', prefs.autoStrategy === 'fill_only' ? 'bg-[var(--bg-primary)]' : '')}
                onClick={() => setPrefs((p) => ({ ...p, autoStrategy: 'fill_only' }))}
              >
                仅填充
              </Button>
              <Button
                size="sm"
                variant="ghost"
                className={cn('h-8 px-3', prefs.autoStrategy === 'full_auto' ? 'bg-[var(--bg-primary)]' : '')}
                onClick={() => setPrefs((p) => ({ ...p, autoStrategy: 'full_auto' }))}
              >
                全自动
              </Button>
            </div>
          </div>
        </div>
      </div>

            <div className="rounded-xl border border-[var(--border-color)] bg-[var(--bg-primary)] p-4">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <div className="text-sm font-semibold text-[var(--text-primary)]">默认模型（自动模式使用）</div>
                  <div className="mt-1 text-xs text-[var(--text-secondary)]">自动拆解/批量生成将使用下方模型作为默认值。</div>
                </div>
              </div>
              <div className="mt-3 grid gap-3">
                <div className="flex flex-col gap-2">
                  <label className="text-[11px] font-bold uppercase text-[var(--text-secondary)]">拆解模型</label>
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
                <div className="grid grid-cols-1 gap-3">
                  <div className="flex flex-col gap-2">
                    <label className="text-[11px] font-bold uppercase text-[var(--text-secondary)]">生图模型</label>
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

                  {Array.isArray((imageModelCfg as any)?.sizes) && (imageModelCfg as any).sizes.length > 0 ? (
                    <div className="flex flex-col gap-2">
                      <label className="text-[11px] font-bold uppercase text-[var(--text-secondary)]">图片比例/尺寸</label>
                      <select
                        value={draft.models.imageSize || ''}
                        onChange={(e) => patchModels({ imageSize: e.target.value || undefined })}
                        className="w-full rounded-lg border border-[var(--border-color)] bg-[var(--bg-primary)] px-3 py-2 text-sm text-[var(--text-primary)] focus:border-[var(--accent-color)] focus:outline-none"
                      >
                        <option value="">默认</option>
                        {((imageModelCfg as any).sizes as any[]).map((s: any) => {
                          const key = typeof s === 'object' ? String(s?.key || s?.value || '') : String(s)
                          const label = typeof s === 'object' ? String(s?.label || s?.key || s?.value || '') : String(s)
                          const v = key || label
                          if (!v) return null
                          return (
                            <option key={v} value={v}>
                              {label || v}
                            </option>
                          )
                        })}
                      </select>
                    </div>
                  ) : null}

                  {Array.isArray((imageModelCfg as any)?.qualities) && (imageModelCfg as any).qualities.length > 0 ? (
                    <div className="flex flex-col gap-2">
                      <label className="text-[11px] font-bold uppercase text-[var(--text-secondary)]">图片画质</label>
                      <select
                        value={draft.models.imageQuality || ''}
                        onChange={(e) => patchModels({ imageQuality: e.target.value || undefined })}
                        className="w-full rounded-lg border border-[var(--border-color)] bg-[var(--bg-primary)] px-3 py-2 text-sm text-[var(--text-primary)] focus:border-[var(--accent-color)] focus:outline-none"
                      >
                        <option value="">默认</option>
                        {((imageModelCfg as any).qualities as any[]).map((q: any) => {
                          const key = typeof q === 'object' ? String(q?.key || q?.value || '') : String(q)
                          const label = typeof q === 'object' ? String(q?.label || q?.key || q?.value || '') : String(q)
                          const v = key || label
                          if (!v) return null
                          return (
                            <option key={v} value={v}>
                              {label || v}
                            </option>
                          )
                        })}
                      </select>
                    </div>
                  ) : null}

                  <div className="flex flex-col gap-2">
                    <label className="text-[11px] font-bold uppercase text-[var(--text-secondary)]">视频模型</label>
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
                    {/* 首尾帧支持提示 */}
                    <div className="flex items-center gap-2 text-xs">
                      {(videoModelCfg as any)?.supportsFirstFrame ? (
                        <span className="inline-flex items-center gap-1 rounded bg-green-500/10 px-2 py-0.5 text-green-600">
                          ✓ 支持首帧
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 rounded bg-gray-500/10 px-2 py-0.5 text-[var(--text-secondary)]">
                          ✗ 不支持首帧
                        </span>
                      )}
                      {(videoModelCfg as any)?.supportsLastFrame ? (
                        <span className="inline-flex items-center gap-1 rounded bg-green-500/10 px-2 py-0.5 text-green-600">
                          ✓ 支持尾帧
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 rounded bg-amber-500/10 px-2 py-0.5 text-amber-600">
                          ✗ 不支持尾帧
                        </span>
                      )}
                    </div>
                    {!(videoModelCfg as any)?.supportsLastFrame && (
                      <div className="text-xs text-amber-600">
                        ⚠️ 当前模型不支持尾帧，尾帧设置将被忽略，仅使用首帧生成视频。
                      </div>
                    )}
                  </div>

                  {Array.isArray((videoModelCfg as any)?.ratios) && (videoModelCfg as any).ratios.length > 0 ? (
                    <div className="flex flex-col gap-2">
                      <label className="text-[11px] font-bold uppercase text-[var(--text-secondary)]">视频比例</label>
                      <select
                        value={draft.models.videoRatio || ''}
                        onChange={(e) => patchModels({ videoRatio: e.target.value || undefined })}
                        className="w-full rounded-lg border border-[var(--border-color)] bg-[var(--bg-primary)] px-3 py-2 text-sm text-[var(--text-primary)] focus:border-[var(--accent-color)] focus:outline-none"
                      >
                        <option value="">默认</option>
                        {((videoModelCfg as any).ratios as any[]).map((r: any) => {
                          const v = String(r ?? '').trim()
                          if (!v) return null
                          return (
                            <option key={v} value={v}>
                              {v}
                            </option>
                          )
                        })}
                      </select>
                    </div>
                  ) : null}

                  {Array.isArray((videoModelCfg as any)?.durs) && (videoModelCfg as any).durs.length > 0 ? (
                    <div className="flex flex-col gap-2">
                      <label className="text-[11px] font-bold uppercase text-[var(--text-secondary)]">视频时长</label>
                      <select
                        value={draft.models.videoDuration ? String(draft.models.videoDuration) : ''}
                        onChange={(e) => patchModels({ videoDuration: e.target.value ? Number(e.target.value) : undefined })}
                        className="w-full rounded-lg border border-[var(--border-color)] bg-[var(--bg-primary)] px-3 py-2 text-sm text-[var(--text-primary)] focus:border-[var(--accent-color)] focus:outline-none"
                      >
                        <option value="">默认</option>
                        {((videoModelCfg as any).durs as any[]).map((d: any) => {
                          const key = typeof d === 'object' ? String(d?.key ?? d?.value ?? '') : String(d)
                          const label = typeof d === 'object' ? String(d?.label ?? d?.key ?? d?.value ?? '') : String(d)
                          const v = key || label
                          if (!v) return null
                          return (
                            <option key={v} value={v}>
                              {label || v}
                            </option>
                          )
                        })}
                      </select>
                    </div>
                  ) : null}

                  {Array.isArray((videoModelCfg as any)?.sizes) && (videoModelCfg as any).sizes.length > 0 ? (
                    <div className="flex flex-col gap-2">
                      <label className="text-[11px] font-bold uppercase text-[var(--text-secondary)]">视频清晰度/分辨率</label>
                      <select
                        value={draft.models.videoSize || ''}
                        onChange={(e) => patchModels({ videoSize: e.target.value || undefined })}
                        className="w-full rounded-lg border border-[var(--border-color)] bg-[var(--bg-primary)] px-3 py-2 text-sm text-[var(--text-primary)] focus:border-[var(--accent-color)] focus:outline-none"
                      >
                        <option value="">默认</option>
                        {((videoModelCfg as any).sizes as any[]).map((s: any) => {
                          const key = typeof s === 'object' ? String(s?.key ?? s?.value ?? '') : String(s)
                          const label = typeof s === 'object' ? String(s?.label ?? s?.key ?? s?.value ?? '') : String(s)
                          const v = key || label
                          if (!v) return null
                          return (
                            <option key={v} value={v}>
                              {label || v}
                            </option>
                          )
                        })}
                      </select>
                    </div>
                  ) : null}
                </div>
              </div>
            </div>

            <div className="rounded-xl border border-[var(--border-color)] bg-[var(--bg-primary)] p-4">
        <div className="flex items-center justify-between">
          <div className="text-sm font-semibold text-[var(--text-primary)]">剧本导入</div>
          <div className="flex items-center gap-2">
            <input
              ref={fileInputRef}
              type="file"
              accept=".txt,.md,.docx,text/plain,text/markdown,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0]
                if (!f) return
                void onImportFile(f)
              }}
            />
            <Button variant="secondary" size="sm" className="gap-1" onClick={() => fileInputRef.current?.click()}>
              <Upload className="h-4 w-4" />
              导入 txt/md/docx
            </Button>
          </div>
        </div>

        <div className="mt-3 grid gap-3">
          <div className="flex flex-col gap-2">
            <label className="text-[11px] font-bold uppercase text-[var(--text-secondary)]">剧本文本</label>
            <textarea
              value={draft.script.text}
              onChange={(e) => setDraft((prev) => ({ ...prev, script: { ...prev.script, text: e.target.value }, updatedAt: Date.now() }))}
              className="min-h-[220px] w-full resize-y rounded-lg border border-[var(--border-color)] bg-[var(--bg-primary)] px-3 py-2 text-sm text-[var(--text-primary)] focus:border-[var(--accent-color)] focus:outline-none"
              placeholder="粘贴剧本文本；或使用右上角导入。"
            />
          </div>
          <div className="space-y-3">
            <div className="rounded-lg border border-[var(--border-color)] bg-[var(--bg-secondary)] p-3">
              <div className="flex items-center justify-between gap-3">
                <div className="text-sm font-semibold text-[var(--text-primary)]">画风与统一要求</div>
                <label className="flex items-center gap-2 text-xs text-[var(--text-secondary)]">
                  <input type="checkbox" checked={!!draft.style.locked} onChange={(e) => patchStyle({ locked: e.target.checked })} />
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
                  <div className="text-xs text-[var(--text-secondary)]">{selectedPreset.description}</div>
                </div>

                <div className="flex flex-col gap-2">
                  <label className="text-[11px] font-bold uppercase text-[var(--text-secondary)]">补充/覆盖（可选）</label>
                  <textarea
                    value={draft.style.customText}
                    onChange={(e) => patchStyle({ customText: e.target.value })}
                    className="min-h-[80px] w-full resize-y rounded-lg border border-[var(--border-color)] bg-[var(--bg-primary)] px-3 py-2 text-sm text-[var(--text-primary)] focus:border-[var(--accent-color)] focus:outline-none"
                    placeholder="例如：固定服装、固定发型、固定色板、固定镜头焦段…"
                  />
                </div>

                <div className="flex flex-col gap-2">
                  <label className="text-[11px] font-bold uppercase text-[var(--text-secondary)]">全局负面（可选）</label>
                  <textarea
                    value={draft.style.negativeText}
                    onChange={(e) => patchStyle({ negativeText: e.target.value })}
                    className="min-h-[60px] w-full resize-y rounded-lg border border-[var(--border-color)] bg-[var(--bg-primary)] px-3 py-2 text-sm text-[var(--text-primary)] focus:border-[var(--accent-color)] focus:outline-none"
                    placeholder="例如：禁止字幕/水印、禁止换装、禁止换脸…"
                  />
                </div>

                <div className="text-[11px] text-[var(--text-secondary)]">
                  提示：未锁定时，AI 拆解只会在你未设置自定义风格/负面时给出建议，不会强行覆盖你的选择。
                </div>
              </div>
            </div>

            <div className="rounded-xl border border-[var(--border-color)] bg-[var(--bg-secondary)] p-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="text-sm font-semibold text-[var(--text-primary)]">AI 拆解与批量生成</div>
                  <div className="mt-1 text-xs text-[var(--text-secondary)]">按步骤运行：拆解 → 关键帧 → 视频</div>
                </div>
                <div className="text-xs text-[var(--text-secondary)]">
                  已采用首/尾：<span className="text-[var(--text-primary)]">{adoptedKeyframes}</span>/{shotsTotal}
                </div>
              </div>

              <div className="mt-3 space-y-3">
                {/* Step 1 */}
                <div className="rounded-lg border border-[var(--border-color)] bg-[var(--bg-primary)] p-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex min-w-0 flex-1 items-start gap-3">
                      <div className="mt-0.5 flex h-6 w-6 items-center justify-center rounded-full bg-[var(--accent-color)] text-[11px] font-bold text-white">
                        1
                      </div>
                      <div className="min-w-0">
                        <div className="text-sm font-semibold text-[var(--text-primary)]">拆解剧本</div>
                        <div className="mt-0.5 text-xs text-[var(--text-secondary)]">生成角色/场景/镜头与首尾帧提示词，并自动搭建草稿结构。</div>
                      </div>
                    </div>
                    <Button size="sm" className="shrink-0 gap-1 whitespace-nowrap" disabled={analysisBusy || prepBusy} onClick={() => void runAnalysis()}>
                      {analysisBusy || prepBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Wand2 className="h-4 w-4" />}
                      分析并搭建
                    </Button>
                  </div>

                  {prepBusy ? <div className="mt-2 text-xs text-[var(--text-secondary)]">一致性素材生成中：角色设定图 / 场景参考图 / 资产参考图…</div> : null}
                  {analysisError ? (
                    <div className="mt-2 max-h-[120px] overflow-auto whitespace-pre-wrap break-words text-xs text-red-500">{analysisError}</div>
                  ) : null}
                  {analysisRaw ? (
                    <details className="mt-2">
                      <summary className="cursor-pointer text-xs text-[var(--text-secondary)]">查看模型原始返回</summary>
                      <pre className="mt-2 max-h-[200px] overflow-auto rounded-lg bg-black/10 p-2 text-[11px] text-[var(--text-secondary)]">{analysisRaw}</pre>
                    </details>
                  ) : null}
                </div>

                {/* Step 2 */}
                <div className="rounded-lg border border-[var(--border-color)] bg-[var(--bg-primary)] p-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex min-w-0 flex-1 items-start gap-3">
                      <div className="mt-0.5 flex h-6 w-6 items-center justify-center rounded-full bg-black/10 text-[11px] font-bold text-[var(--text-secondary)]">
                        2
                      </div>
                      <div className="min-w-0">
                        <div className="text-sm font-semibold text-[var(--text-primary)]">生成关键帧</div>
                        <div className="mt-0.5 text-xs text-[var(--text-secondary)]">批量生成每个镜头的首帧/尾帧（会新增版本）。</div>
                      </div>
                    </div>
                    <Button
                      variant="secondary"
                      size="sm"
                      className="shrink-0 whitespace-nowrap"
                      disabled={analysisBusy || prepBusy || keyframesBusy}
                      onClick={() => void runBatchGenerateKeyframes()}
                    >
                      批量生成首/尾
                    </Button>
                  </div>
                </div>

                {/* Step 3 */}
                <div className="rounded-lg border border-[var(--border-color)] bg-[var(--bg-primary)] p-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex min-w-0 flex-1 items-start gap-3">
                      <div className="mt-0.5 flex h-6 w-6 items-center justify-center rounded-full bg-black/10 text-[11px] font-bold text-[var(--text-secondary)]">
                        3
                      </div>
                      <div className="min-w-0">
                        <div className="text-sm font-semibold text-[var(--text-primary)]">生成视频</div>
                        <div className="mt-0.5 text-xs text-[var(--text-secondary)]">基于“已采用”的首/尾帧批量生成视频（会新增版本）。</div>
                      </div>
                    </div>
                    <Button
                      variant="secondary"
                      size="sm"
                      className="shrink-0 whitespace-nowrap"
                      disabled={analysisBusy || prepBusy || keyframesBusy || videosBusy}
                      onClick={() => void runBatchGenerateVideos()}
                    >
                      批量生成视频
                    </Button>
                  </div>
                </div>

                <div className="text-xs text-[var(--text-secondary)]">
                  提示：建议先在首/尾帧中“采用”满意版本后再生成视频；需要更精细的参考图绑定可切换到“手动”模式。
                </div>
              </div>
            </div>
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
          <div className="mt-2 min-h-0 flex-1 overflow-y-auto pr-1 space-y-4">
            <div className="rounded-xl border border-[var(--border-color)] bg-[var(--bg-primary)] p-4">
          <div className="text-sm font-semibold text-[var(--text-primary)]">角色（{draft.characters.length}）</div>
          <div className="mt-3 space-y-3">
            {draft.characters.length === 0 ? <div className="text-sm text-[var(--text-secondary)]">尚未分析出角色。</div> : null}
            {draft.characters.map((c) => {
              const slot = c.sheet
              const selected = getSelectedVariant(slot)
              const busy = !!busySlotIds[slot.id]
              return (
                <div key={c.id} className="rounded-lg border border-[var(--border-color)] bg-[var(--bg-secondary)] p-3">
                  <div className="flex items-center justify-between">
                    <div className="text-xs font-semibold text-[var(--text-primary)]">{c.name}</div>
                    <div className="flex items-center gap-3">
                      <label className="flex items-center gap-2 text-xs text-[var(--text-secondary)]">
                        <input
                          type="checkbox"
                          checked={!!slot.selectionLockedByUser}
                          onChange={(e) => setDraft((prev) => setSlotSelectionLocked(prev, slot.id, e.target.checked))}
                        />
                        锁定采用
                      </label>
                      <Button size="sm" variant="ghost" disabled={busy} onClick={() => openPickerForSlot(slot, `${c.name} · 设定图`, 'history')}>
                        从历史导入
                      </Button>
                      <Button size="sm" variant="ghost" disabled={busy} onClick={() => openPickerForSlot(slot, `${c.name} · 设定图`, 'canvas')}>
                        从画布导入
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={busy}
                        onClick={() =>
                          void (async () => {
                            const refs = await collectRefImagesForCharacter(c.id)
                            await runGenerateSlotImage(slot.id, buildCharacterSheetPrompt(c.id), refs, 'auto')
                          })()
                        }
                      >
                        {busy ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <FileText className="mr-1 h-4 w-4" />}
                        生成设定图
                      </Button>
                    </div>
                  </div>
                  {selected ? (
                    <div className="mt-2">
                      <button type="button" className="w-full" onClick={() => void openPreview(selected)} disabled={previewBusy} title="预览">
                        <ShortDramaVariantThumb variant={selected} className="h-24 w-full" />
                      </button>
                      <div className="mt-2 flex items-center justify-end">
                        <Button size="sm" variant="ghost" disabled={selected.status !== 'success'} onClick={() => void sendVariantToCanvas(selected, `${c.name} · 设定图`)}>
                          上板
                        </Button>
                      </div>
                    </div>
                  ) : null}
                  <div className="mt-2">
                    <ShortDramaSlotVersions
                      slot={slot}
                      onAdopt={(vid) => setDraft((prev) => setSlotSelectedVariant(prev, slot.id, vid))}
                      onRemove={(vid) => setDraft((prev) => removeVariantFromSlot(prev, slot.id, vid))}
                      onPreview={(v) => void openPreview(v)}
                      disabled={busy}
                    />
                  </div>
                </div>
              )
            })}
          </div>
        </div>

            <div className="rounded-xl border border-[var(--border-color)] bg-[var(--bg-primary)] p-4">
          <div className="text-sm font-semibold text-[var(--text-primary)]">场景（{draft.scenes.length}）</div>
          <div className="mt-3 space-y-3">
            {draft.scenes.length === 0 ? <div className="text-sm text-[var(--text-secondary)]">尚未分析出场景。</div> : null}
            {draft.scenes.map((s) => {
              const slot = s.ref
              const selected = getSelectedVariant(slot)
              const busy = !!busySlotIds[slot.id]
              return (
                <div key={s.id} className="rounded-lg border border-[var(--border-color)] bg-[var(--bg-secondary)] p-3">
                  <div className="flex items-center justify-between">
                    <div className="text-xs font-semibold text-[var(--text-primary)]">{s.name}</div>
                    <div className="flex items-center gap-3">
                      <label className="flex items-center gap-2 text-xs text-[var(--text-secondary)]">
                        <input
                          type="checkbox"
                          checked={!!slot.selectionLockedByUser}
                          onChange={(e) => setDraft((prev) => setSlotSelectionLocked(prev, slot.id, e.target.checked))}
                        />
                        锁定采用
                      </label>
                      <Button size="sm" variant="ghost" disabled={busy} onClick={() => openPickerForSlot(slot, `${s.name} · 场景参考`, 'history')}>
                        从历史导入
                      </Button>
                      <Button size="sm" variant="ghost" disabled={busy} onClick={() => openPickerForSlot(slot, `${s.name} · 场景参考`, 'canvas')}>
                        从画布导入
                      </Button>
                      <Button size="sm" variant="ghost" disabled={busy} onClick={() => void runGenerateSlotImage(slot.id, buildScenePrompt(s.id), [], 'auto')}>
                        {busy ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <FileText className="mr-1 h-4 w-4" />}
                        生成参考图
                      </Button>
                    </div>
                  </div>
                  {selected ? (
                    <div className="mt-2">
                      <button type="button" className="w-full" onClick={() => void openPreview(selected)} disabled={previewBusy} title="预览">
                        <ShortDramaVariantThumb variant={selected} className="h-24 w-full" />
                      </button>
                      <div className="mt-2 flex items-center justify-end">
                        <Button size="sm" variant="ghost" disabled={selected.status !== 'success'} onClick={() => void sendVariantToCanvas(selected, `${s.name} · 场景参考`)}>
                          上板
                        </Button>
                      </div>
                    </div>
                  ) : null}
                  <div className="mt-2">
                    <ShortDramaSlotVersions
                      slot={slot}
                      onAdopt={(vid) => setDraft((prev) => setSlotSelectedVariant(prev, slot.id, vid))}
                      onRemove={(vid) => setDraft((prev) => removeVariantFromSlot(prev, slot.id, vid))}
                      onPreview={(v) => void openPreview(v)}
                      disabled={busy}
                    />
                  </div>
                </div>
              )
            })}
          </div>
        </div>

            {/* 资产 section */}
            <div className="rounded-xl border border-[var(--border-color)] bg-[var(--bg-primary)] p-4">
          <div className="text-sm font-semibold text-[var(--text-primary)]">资产（{draft.assets?.length || 0}）</div>
          <div className="mt-3 space-y-3">
            {(!draft.assets || draft.assets.length === 0) ? <div className="text-sm text-[var(--text-secondary)]">尚未分析出资产（武器/道具/重要物品）。</div> : null}
            {(draft.assets || []).map((a) => {
              const slot = a.ref
              const selected = getSelectedVariant(slot)
              const busy = !!busySlotIds[slot.id]
              const categoryLabels: Record<string, string> = {
                weapon: '武器',
                prop: '道具',
                vehicle: '载具',
                accessory: '配饰',
                item: '物品',
                other: '其他'
              }
              return (
                <div key={a.id} className="rounded-lg border border-[var(--border-color)] bg-[var(--bg-secondary)] p-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Sword className="h-4 w-4 text-orange-500" />
                      <div className="text-xs font-semibold text-[var(--text-primary)]">{a.name}</div>
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-orange-500/20 text-orange-400">{categoryLabels[a.category] || a.category}</span>
                    </div>
                    <div className="flex items-center gap-3">
                      <label className="flex items-center gap-2 text-xs text-[var(--text-secondary)]">
                        <input
                          type="checkbox"
                          checked={!!slot.selectionLockedByUser}
                          onChange={(e) => setDraft((prev) => setSlotSelectionLocked(prev, slot.id, e.target.checked))}
                        />
                        锁定采用
                      </label>
                      <Button size="sm" variant="ghost" disabled={busy} onClick={() => openPickerForSlot(slot, `${a.name} · 资产参考`, 'history')}>
                        从历史导入
                      </Button>
                      <Button size="sm" variant="ghost" disabled={busy} onClick={() => openPickerForSlot(slot, `${a.name} · 资产参考`, 'canvas')}>
                        从画布导入
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={busy}
                        onClick={() =>
                          void (async () => {
                            const refs = await collectRefImagesForAsset(a.id)
                            await runGenerateSlotImage(slot.id, buildAssetPrompt(a.id), refs, 'auto')
                          })()
                        }
                      >
                        {busy ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <FileText className="mr-1 h-4 w-4" />}
                        生成参考图
                      </Button>
                    </div>
                  </div>
                  {a.description ? <div className="mt-1 text-xs text-[var(--text-secondary)] line-clamp-2">{a.description}</div> : null}
                  {selected ? (
                    <div className="mt-2">
                      <button type="button" onClick={() => void openPreview(selected)} className="block w-full">
                        <ShortDramaVariantThumb variant={selected} className="h-20 w-full" />
                      </button>
                      <div className="mt-2 flex items-center justify-end">
                        <Button size="sm" variant="ghost" disabled={selected.status !== 'success'} onClick={() => void sendVariantToCanvas(selected, `${a.name} · 资产参考`)}>
                          上板
                        </Button>
                      </div>
                    </div>
                  ) : null}
                  <div className="mt-2">
                    <ShortDramaSlotVersions
                      slot={slot}
                      onAdopt={(vid) => setDraft((prev) => setSlotSelectedVariant(prev, slot.id, vid))}
                      onRemove={(vid) => setDraft((prev) => removeVariantFromSlot(prev, slot.id, vid))}
                      onPreview={(v) => void openPreview(v)}
                      disabled={busy}
                    />
                  </div>
                </div>
              )
            })}
          </div>
        </div>
          </div>
        </div>
      </div>

      {/* Right column (70%): shots */}
      <div className="min-h-0 flex-1 overflow-y-auto pr-1">
        <div className="rounded-xl border border-[var(--border-color)] bg-[var(--bg-primary)] p-4">
          <div className="text-sm font-semibold text-[var(--text-primary)]">镜头（{draft.shots.length}）</div>
          <div className="mt-3 space-y-3">
            {draft.shots.length === 0 ? <div className="text-sm text-[var(--text-secondary)]">尚未分析出镜头。</div> : null}
            {draft.shots.map((sh, idx) => {
              const startSlot = sh.frames.start.slot
              const endSlot = sh.frames.end.slot
              const videoSlot = sh.video
              const startSelected = getSelectedVariant(startSlot)
              const endSelected = getSelectedVariant(endSlot)
              const videoSelected = getSelectedVariant(videoSlot)
              const startBusy = !!busySlotIds[startSlot.id]
              const endBusy = !!busySlotIds[endSlot.id]
              const videoBusy = !!busySlotIds[videoSlot.id]
              return (
                <div key={sh.id} className="rounded-lg border border-[var(--border-color)] bg-[var(--bg-secondary)] p-3">
                  <div className="text-xs font-semibold text-[var(--text-primary)]">
                    {idx + 1}. {sh.title || '镜头'}
                  </div>

                  <div className="mt-2 grid gap-2 md:grid-cols-2">
                    <div className="rounded-lg border border-[var(--border-color)] bg-[var(--bg-primary)] p-2">
                      <div className="flex items-center justify-between">
                        <div className="text-xs font-medium text-[var(--text-primary)]">首帧</div>
                        <div className="flex items-center gap-3">
                          <label className="flex items-center gap-2 text-xs text-[var(--text-secondary)]">
                            <input
                              type="checkbox"
                              checked={!!startSlot.selectionLockedByUser}
                              onChange={(e) => setDraft((prev) => setSlotSelectionLocked(prev, startSlot.id, e.target.checked))}
                            />
                            锁定采用
                          </label>
                          <Button size="sm" variant="ghost" disabled={startBusy} onClick={() => openPickerForSlot(startSlot, `${sh.title || '镜头'} · 首帧`, 'history')}>
                            从历史导入
                          </Button>
                          <Button size="sm" variant="ghost" disabled={startBusy} onClick={() => openPickerForSlot(startSlot, `${sh.title || '镜头'} · 首帧`, 'canvas')}>
                            从画布导入
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            disabled={startBusy}
                            onClick={() =>
                              void (async () => {
                                const refs = await collectRefImagesForShot(sh.id, 'start')
                                await runGenerateSlotImage(startSlot.id, buildFramePrompt(sh.id, 'start'), refs, 'auto')
                              })()
                            }
                          >
                            {startBusy ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <FileText className="mr-1 h-4 w-4" />}
                            再生成
                          </Button>
                        </div>
                      </div>
                      {startSelected ? (
                        <div className="mt-2">
                          <button type="button" className="w-full" onClick={() => void openPreview(startSelected)} disabled={previewBusy} title="预览">
                            <ShortDramaVariantThumb variant={startSelected} className="h-24 w-full" />
                          </button>
                          <div className="mt-2 flex items-center justify-end">
                            <Button
                              size="sm"
                              variant="ghost"
                              disabled={startSelected.status !== 'success'}
                              onClick={() => void sendVariantToCanvas(startSelected, `${sh.title || '镜头'} · 首帧`)}
                            >
                              上板
                            </Button>
                          </div>
                        </div>
                      ) : null}
                      <div className="mt-2">
                        <ShortDramaSlotVersions
                          slot={startSlot}
                          onAdopt={(vid) => setDraft((prev) => setSlotSelectedVariant(prev, startSlot.id, vid))}
                          onRemove={(vid) => setDraft((prev) => removeVariantFromSlot(prev, startSlot.id, vid))}
                          onPreview={(v) => void openPreview(v)}
                          disabled={startBusy}
                        />
                      </div>
                    </div>

                    <div className="rounded-lg border border-[var(--border-color)] bg-[var(--bg-primary)] p-2">
                      <div className="flex items-center justify-between">
                        <div className="text-xs font-medium text-[var(--text-primary)]">尾帧</div>
                        <div className="flex items-center gap-3">
                          <label className="flex items-center gap-2 text-xs text-[var(--text-secondary)]">
                            <input
                              type="checkbox"
                              checked={!!endSlot.selectionLockedByUser}
                              onChange={(e) => setDraft((prev) => setSlotSelectionLocked(prev, endSlot.id, e.target.checked))}
                            />
                            锁定采用
                          </label>
                          <Button size="sm" variant="ghost" disabled={endBusy} onClick={() => openPickerForSlot(endSlot, `${sh.title || '镜头'} · 尾帧`, 'history')}>
                            从历史导入
                          </Button>
                          <Button size="sm" variant="ghost" disabled={endBusy} onClick={() => openPickerForSlot(endSlot, `${sh.title || '镜头'} · 尾帧`, 'canvas')}>
                            从画布导入
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            disabled={endBusy}
                            onClick={() =>
                              void (async () => {
                                const refs = await collectRefImagesForShot(sh.id, 'end')
                                await runGenerateSlotImage(endSlot.id, buildFramePrompt(sh.id, 'end'), refs, 'auto')
                              })()
                            }
                          >
                            {endBusy ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <FileText className="mr-1 h-4 w-4" />}
                            再生成
                          </Button>
                        </div>
                      </div>
                      {endSelected ? (
                        <div className="mt-2">
                          <button type="button" className="w-full" onClick={() => void openPreview(endSelected)} disabled={previewBusy} title="预览">
                            <ShortDramaVariantThumb variant={endSelected} className="h-24 w-full" />
                          </button>
                          <div className="mt-2 flex items-center justify-end">
                            <Button size="sm" variant="ghost" disabled={endSelected.status !== 'success'} onClick={() => void sendVariantToCanvas(endSelected, `${sh.title || '镜头'} · 尾帧`)}>
                              上板
                            </Button>
                          </div>
                        </div>
                      ) : null}
                      <div className="mt-2">
                        <ShortDramaSlotVersions
                          slot={endSlot}
                          onAdopt={(vid) => setDraft((prev) => setSlotSelectedVariant(prev, endSlot.id, vid))}
                          onRemove={(vid) => setDraft((prev) => removeVariantFromSlot(prev, endSlot.id, vid))}
                          onPreview={(v) => void openPreview(v)}
                          disabled={endBusy}
                        />
                      </div>
                    </div>
                  </div>

                  <div className="mt-2 rounded-lg border border-[var(--border-color)] bg-[var(--bg-primary)] p-2">
                    <div className="flex items-center justify-between">
                      <div className="text-xs font-medium text-[var(--text-primary)]">视频</div>
                      <div className="flex items-center gap-2">
                        <label className="mr-1 flex items-center gap-2 text-xs text-[var(--text-secondary)]">
                          <input
                            type="checkbox"
                            checked={!!videoSlot.selectionLockedByUser}
                            onChange={(e) => setDraft((prev) => setSlotSelectionLocked(prev, videoSlot.id, e.target.checked))}
                          />
                          锁定采用
                        </label>
                        <Button size="sm" variant="ghost" disabled={videoBusy} onClick={() => openPickerForSlot(videoSlot, `${sh.title || '镜头'} · 视频`, 'history')}>
                          从历史导入
                        </Button>
                        <Button size="sm" variant="ghost" disabled={videoBusy} onClick={() => openPickerForSlot(videoSlot, `${sh.title || '镜头'} · 视频`, 'canvas')}>
                          从画布导入
                        </Button>
                        <Button
                          size="sm"
                          variant="secondary"
                          className="gap-1"
                          disabled={videoBusy}
                          onClick={() =>
                            void (async () => {
                              const startV = getSelectedVariant(startSlot)
                              const endV = getSelectedVariant(endSlot)
                              const startInput = await resolveVariantInput(startV || undefined)
                              const endInput = await resolveVariantInput(endV || undefined)
                              const refs = await collectRefImagesForShot(sh.id, 'start')
                              const images = buildVideoImages(startInput, endInput, refs)
                              const prompt = buildVideoPrompt(sh.id)
                              await runGenerateSlotVideo(videoSlot.id, prompt, images, endInput, 'auto')
                            })()
                          }
                        >
                          {videoBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <VideoIcon className="h-4 w-4" />}
                          生成视频
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
                            navigate(`/edit/${projectId}?shotId=${sh.id}&videoVariantId=${videoSelected?.id || ''}`)
                          }}
                        >
                          进入剪辑台
                        </Button>
                      </div>
                    </div>

                    {videoSelected ? (
                      <div className="mt-2">
                        <button type="button" className="w-full" onClick={() => void openPreview(videoSelected)} disabled={previewBusy} title="预览">
                          <ShortDramaVariantThumb variant={videoSelected} className="h-40 w-full" />
                        </button>
                        <div className="mt-2 flex items-center justify-end">
                          <Button size="sm" variant="ghost" disabled={videoSelected.status !== 'success'} onClick={() => void sendVariantToCanvas(videoSelected, `${sh.title || '镜头'} · 视频`)}>
                            上板
                          </Button>
                        </div>
                      </div>
                    ) : null}

                    <div className="mt-2">
                      <ShortDramaSlotVersions
                        slot={videoSlot}
                        onAdopt={(vid) => setDraft((prev) => setSlotSelectedVariant(prev, videoSlot.id, vid))}
                        onRemove={(vid) => setDraft((prev) => removeVariantFromSlot(prev, videoSlot.id, vid))}
                        onPreview={(v) => void openPreview(v)}
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
        title={pickerTarget?.label ? `选择素材添加到 ${pickerTarget.label}` : undefined}
        initialTab={pickerInitialTab}
        kinds={pickerKinds}
        multiple
        onConfirm={(items) => {
          void handlePickedMedia(items)
        }}
      />

      <MediaPreviewModal open={previewOpen} url={previewUrl} type={previewType} onClose={() => setPreviewOpen(false)} />

      <ShortDramaBlendPanel
        open={blendPanelOpen}
        onClose={() => setBlendPanelOpen(false)}
        draft={draft}
        onAddImage={(imageData, title) => {
          // 添加到素材库
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
    </div>
  )
}

