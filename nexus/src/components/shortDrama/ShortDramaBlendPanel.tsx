/**
 * Short Drama Blend Panel | 短剧融图面板
 * 支持主图1张 + 副图最多13张（Gemini限制）
 * 可从短剧工作台已生成的图片中选择
 * 支持：本地上传、画布导入、历史素材导入
 */

import React, { useState, useCallback, useMemo, useRef, useEffect } from 'react'
import { X, Wand2, AlertCircle, Loader2, User, Package, MapPin, Sword, Sparkles, Upload, Plus, Check, ChevronDown, ChevronUp, Palette, Clock } from 'lucide-react'
import { cn } from '@/lib/utils'
import { postJson } from '@/lib/workflow/request'
import { chatCompletions } from '@/lib/nexusApi'
import { useAssetsStore } from '@/store/assets'
import { useGraphStore } from '@/graph/store'
import { getMedia } from '@/lib/mediaStorage'
import { safeFetch } from '@/lib/safeFetch'
import type { ShortDramaDraftV2, ShortDramaMediaVariant } from '@/lib/shortDrama/types'

interface Props {
  open: boolean
  onClose: () => void
  draft: ShortDramaDraftV2
  onAddImage?: (imageData: string, title: string) => void
}

const MAX_SECONDARY_IMAGES = 13

const extractBase64 = (input: string): string => {
  if (input.startsWith('data:image')) {
    const match = input.match(/^data:image\/\w+;base64,(.+)$/)
    return match?.[1] || ''
  }
  return input
}

const downloadImageAsBase64 = async (url: string): Promise<string> => {
  const response = await safeFetch(url)
  const blob = await response.blob()
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result || ''))
    reader.onerror = () => reject(new Error('下载图片失败'))
    reader.readAsDataURL(blob)
  })
}

const ensureBase64 = async (url: string): Promise<string> => {
  if (url.startsWith('data:')) return url
  if (url.startsWith('http')) return await downloadImageAsBase64(url)
  return url
}

const analyzeImages = async (images: string[]): Promise<string[]> => {
  const analyzePrompt = `Analyze this image for precision AI image fusion. Be EXTREMELY detailed and specific. Output in English:

**IDENTITY**: Subject gender, age range. Face: shape, skin tone, eye shape/color, nose/lip features. Hair: color, length, style (straight/wavy/curly).
**BODY & CLOTHING**: Pose, gesture. Clothing type, colors, fabric texture (silk/cotton/leather), patterns, accessories.
**SCENE**: Setting (indoor/outdoor, specific type). Key objects with positions (foreground/midground/background). Surface materials.
**LIGHTING**: Light source direction (top-left/right/front/back), type (natural/studio/neon), color temperature (warm/cool), shadow direction and softness.
**COLOR**: Dominant palette (3-5 colors). Saturation (vivid/muted). Color grading (warm/cool/neutral). Contrast level.
**COMPOSITION**: Camera angle (eye-level/low/high), lens type (wide/normal/telephoto), depth of field (shallow/deep), framing.
**STYLE**: Art style (photorealistic/digital art/anime/oil painting). Post-processing effects.

Max 200 words.`

  const results = await Promise.all(images.map(async (img) => {
    const base64 = extractBase64(await ensureBase64(img))
    const result = await chatCompletions({
      model: 'gpt-5-mini',
      messages: [{
        role: 'user',
        content: [
          { type: 'text', text: analyzePrompt },
          { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${base64}` } }
        ]
      }]
    })
    return result.trim()
  }))
  return results
}

const optimizePromptWithAI = async (
  userRequirement: string,
  mainImageAnalysis: string,
  secondaryAnalyses: string[]
): Promise<string> => {
  const systemPrompt = `You are a master AI image compositing director. You create fusion prompts that achieve photorealistic seamless integration.

## FUSION METHODOLOGY

### Phase 1: Subject Preservation
- Lock ALL main image features: facial geometry, skin texture, hair, clothing folds, body proportions
- Describe them as "exactly as shown in the reference" with extreme specificity

### Phase 2: Element Integration
For each secondary item:
- Specify EXACT placement relative to the main subject (e.g., "held in right hand at waist height")
- Define scale transformation to match scene perspective
- Define interaction shadows (contact shadow, ambient occlusion where item meets surface)

### Phase 3: Harmonization
- LIGHTING: Item lit from SAME direction/color temperature as main image. Specify direction and shadow casting.
- COLOR GRADE: Items adopt main image's color grading tone
- MATERIAL: Describe how item surfaces look under the scene's lighting (specular highlights, reflections)
- EDGES: "Seamless edge integration with natural feathering, matching depth of field blur"

### Phase 4: Quality
- Include: "photorealistic, masterpiece, no visible seams, consistent depth of field, natural color harmony"
- Negative: "no distortion, no unnatural lighting, no floating objects, no mismatched shadows"

## OUTPUT
Single cohesive prompt (200-300 words):
1. Main subject lock (ultra-detailed preservation)
2. Item placement (position, scale, interaction)
3. Light/color/material harmonization
4. Quality keywords + negatives

Output ONLY the prompt.`

  const itemDescs = secondaryAnalyses.map((desc, i) => `Item ${i + 1}: ${desc}`).join('\n')

  const result = await chatCompletions({
    model: 'gpt-4o',
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: `MAIN IMAGE (preserve):\n${mainImageAnalysis}\n\nITEMS TO ADD:\n${itemDescs}\n\nUser request: "${userRequirement}"` }
    ]
  })
  return result.trim()
}

const blendWithGemini = async (
  mainImage: string,
  secondaryImages: string[],
  prompt: string,
  onProgress: (msg: string) => void,
  aspectRatio: string = '3:4',
  resolution: string = '2K'
): Promise<string> => {
  onProgress('调用 Gemini AI...')

  const allImages = [mainImage, ...secondaryImages]
  const imageParts = await Promise.all(allImages.map(async (img) => {
    const base64 = extractBase64(await ensureBase64(img))
    return { inline_data: { mime_type: 'image/jpeg', data: base64 } }
  }))

  const fullPrompt = `## TASK: Precision Image Fusion

You are given multiple reference images. Image 1 is the MASTER image — its subject, scene, and atmosphere define the target output.

### ABSOLUTE RULES:
1. MASTER IMAGE PRESERVATION: The person/character in Image 1 must appear PIXEL-PERFECT identical — same face, expression, hair, clothing, pose, skin tone, accessories. Any deviation is a critical failure.
2. SCENE INTEGRITY: The background, lighting setup, and color grading of Image 1 is the ground truth. Do not alter it.
3. ELEMENT ADDITION ONLY: Elements from Images 2+ are to be COMPOSITED INTO the master scene — placed as if physically present during the original photo.

### COMPOSITING STANDARDS:
- Light Direction: Added elements receive light from the same source as Image 1
- Shadows: Each added element casts shadows matching the scene's shadow angle and softness
- Color Temperature: Added elements color-graded to match Image 1's palette
- Depth of Field: Elements at different depths show appropriate focus/blur
- Scale & Perspective: Elements obey the scene's vanishing point and lens characteristics
- Edge Quality: No hard edges, no halo artifacts, natural feathering at boundaries

### SPECIFIC INSTRUCTION:
${prompt}

### OUTPUT:
Generate exactly ONE high-quality fused image. No text, no watermarks, no artifacts.`

  const response = await postJson<any>(
    '/v1beta/models/gemini-3-pro-image-preview:generateContent',
    {
      contents: [{
        role: 'user',
        parts: [{ text: fullPrompt }, ...imageParts]
      }],
      generationConfig: {
        responseModalities: ['IMAGE'],
        imageConfig: { aspectRatio, imageSize: resolution }
      }
    },
    { authMode: 'query', timeoutMs: 240000 }
  )

  const parts = response?.candidates?.[0]?.content?.parts || []
  const inlineData = parts.find((p: any) => p.inlineData || p.inline_data)
  const data = inlineData?.inlineData?.data || inlineData?.inline_data?.data

  if (!data) throw new Error('Gemini 未返回图像')
  return `data:image/png;base64,${data}`
}

interface ImageSource {
  id: string
  url: string
  title: string
  category: 'character' | 'scene' | 'asset' | 'shot' | 'canvas' | 'history'
  icon: React.ReactNode
}

const isHttp = (v: string) => /^https?:\/\//i.test(v)

export default function ShortDramaBlendPanel({ open, onClose, draft, onAddImage }: Props) {
  const [mainImage, setMainImage] = useState<string | null>(null)
  const [mainImageTitle, setMainImageTitle] = useState('')
  const [secondaryImages, setSecondaryImages] = useState<{ url: string; title: string }[]>([])
  const [selectingFor, setSelectingFor] = useState<'main' | 'secondary'>('main')
  const [blendResult, setBlendResult] = useState<string | null>(null)
  const [isProcessing, setIsProcessing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [userPrompt, setUserPrompt] = useState('将选中的元素自然地融入主图场景中')
  const [progressMsg, setProgressMsg] = useState('')
  const [aspectRatio, setAspectRatio] = useState<'1:1' | '3:4' | '4:3' | '9:16' | '16:9'>('3:4')
  const [resolution, setResolution] = useState<'1K' | '2K' | '4K'>('2K')
  const [expandedCategory, setExpandedCategory] = useState<string | null>('character')

  const fileInputRef = useRef<HTMLInputElement>(null)

  // 获取画布素材
  const canvasNodes = useGraphStore((s) => (s as any).nodes || [])
  // 获取历史素材
  const historyAssets = useAssetsStore((s) => s.assets)

  const getSelectedVariantUrl = useCallback((slot: any): string | null => {
    if (!slot?.variants?.length) return null
    const selected = slot.selectedVariantId
      ? slot.variants.find((v: ShortDramaMediaVariant) => v.id === slot.selectedVariantId)
      : slot.variants[0]
    return selected?.displayUrl || selected?.sourceUrl || null
  }, [])

  // 异步解析 mediaId → URL 的映射表（覆盖 displayUrl/sourceUrl 都为空但有 mediaId 的场景）
  const [mediaIdUrlMap, setMediaIdUrlMap] = useState<Record<string, string>>({})
  useEffect(() => {
    let cancelled = false
    const collectSlots = (slots: any[]): any[] => {
      const out: any[] = []
      for (const s of slots) {
        if (!s?.variants?.length) continue
        const v = s.selectedVariantId ? s.variants.find((x: any) => x.id === s.selectedVariantId) : s.variants[0]
        if (v?.mediaId && !v.displayUrl && !v.sourceUrl) out.push(v)
      }
      return out
    }
    const allSlots: any[] = []
    draft.characters?.forEach(c => { allSlots.push(c.sheet); (c.refs || []).forEach(r => allSlots.push(r)) })
    draft.scenes?.forEach(s => { allSlots.push(s.ref); (s.refs || []).forEach(r => allSlots.push(r)) })
    draft.assets?.forEach(a => allSlots.push(a.ref))
    draft.shots?.forEach(s => { allSlots.push(s.frames?.start?.slot); allSlots.push(s.frames?.end?.slot) })
    const pending = collectSlots(allSlots.filter(Boolean))
    if (pending.length === 0) return
    ;(async () => {
      const map: Record<string, string> = {}
      for (const v of pending) {
        if (cancelled) return
        try {
          const rec = await getMedia(v.mediaId)
          if (rec?.data) map[v.mediaId] = String(rec.data)
        } catch { /* ignore */ }
      }
      if (!cancelled) setMediaIdUrlMap(prev => ({ ...prev, ...map }))
    })()
    return () => { cancelled = true }
  }, [draft])

  // 带 mediaId 回退的 URL 解析
  const resolveVariantUrl = useCallback((slot: any): string | null => {
    const direct = getSelectedVariantUrl(slot)
    if (direct) return direct
    if (!slot?.variants?.length) return null
    const v = slot.selectedVariantId ? slot.variants.find((x: any) => x.id === slot.selectedVariantId) : slot.variants[0]
    if (v?.mediaId && mediaIdUrlMap[v.mediaId]) return mediaIdUrlMap[v.mediaId]
    return null
  }, [getSelectedVariantUrl, mediaIdUrlMap])

  const availableImages = useMemo((): ImageSource[] => {
    const images: ImageSource[] = []

    // 角色图片
    draft.characters?.forEach(char => {
      const sheetUrl = resolveVariantUrl(char.sheet)
      if (sheetUrl) {
        images.push({ id: `char-sheet-${char.id}`, url: sheetUrl, title: `${char.name} - 设定图`, category: 'character', icon: <User className="h-3 w-3" /> })
      }
      char.refs?.forEach((ref, i) => {
        const refUrl = resolveVariantUrl(ref)
        if (refUrl) {
          images.push({ id: `char-ref-${char.id}-${i}`, url: refUrl, title: `${char.name} - 参考${i + 1}`, category: 'character', icon: <User className="h-3 w-3" /> })
        }
      })
    })

    // 场景图片
    draft.scenes?.forEach(scene => {
      const refUrl = resolveVariantUrl(scene.ref)
      if (refUrl) {
        images.push({ id: `scene-${scene.id}`, url: refUrl, title: scene.name, category: 'scene', icon: <MapPin className="h-3 w-3" /> })
      }
      scene.refs?.forEach((ref, i) => {
        const extraUrl = resolveVariantUrl(ref)
        if (extraUrl) {
          images.push({ id: `scene-ref-${scene.id}-${i}`, url: extraUrl, title: `${scene.name} - 参考${i + 1}`, category: 'scene', icon: <MapPin className="h-3 w-3" /> })
        }
      })
    })

    // 资产图片
    draft.assets?.forEach(asset => {
      const refUrl = resolveVariantUrl(asset.ref)
      if (refUrl) {
        images.push({ id: `asset-${asset.id}`, url: refUrl, title: asset.name, category: 'asset', icon: <Sword className="h-3 w-3" /> })
      }
    })

    // 镜头首尾帧
    draft.shots?.forEach((shot, i) => {
      const startUrl = resolveVariantUrl(shot.frames?.start?.slot)
      if (startUrl) {
        images.push({ id: `shot-start-${shot.id}`, url: startUrl, title: `${shot.title || `镜头${i + 1}`} - 首帧`, category: 'shot', icon: <Package className="h-3 w-3" /> })
      }
      const endUrl = resolveVariantUrl(shot.frames?.end?.slot)
      if (endUrl) {
        images.push({ id: `shot-end-${shot.id}`, url: endUrl, title: `${shot.title || `镜头${i + 1}`} - 尾帧`, category: 'shot', icon: <Package className="h-3 w-3" /> })
      }
    })

    // 画布素材
    const canvasImageNodes = Array.isArray(canvasNodes) ? canvasNodes.filter((n: any) => n?.type === 'image') : []
    canvasImageNodes.forEach((n: any) => {
      const d: any = n?.data || {}
      const url = String(d?.url || '').trim()
      if (url) {
        const label = String(d?.label || n?.id || '').trim() || '画布图片'
        images.push({ id: `canvas-${n.id}`, url, title: label, category: 'canvas', icon: <Palette className="h-3 w-3" /> })
      }
    })

    // 历史素材
    const historyImageAssets = (historyAssets || []).filter((a: any) => a?.type === 'image')
    historyImageAssets.forEach((a: any) => {
      const src = String(a?.src || '').trim()
      if (src) {
        const label = String(a?.title || a?.id || '').trim() || '历史图片'
        images.push({ id: `history-${a.id}`, url: src, title: label, category: 'history', icon: <Clock className="h-3 w-3" /> })
      }
    })

    return images
  }, [draft, resolveVariantUrl, canvasNodes, historyAssets])

  const groupedImages = useMemo(() => {
    return {
      character: availableImages.filter(img => img.category === 'character'),
      scene: availableImages.filter(img => img.category === 'scene'),
      asset: availableImages.filter(img => img.category === 'asset'),
      shot: availableImages.filter(img => img.category === 'shot'),
      canvas: availableImages.filter(img => img.category === 'canvas'),
      history: availableImages.filter(img => img.category === 'history'),
    }
  }, [availableImages])

  const resetState = useCallback(() => {
    setMainImage(null)
    setMainImageTitle('')
    setSecondaryImages([])
    setBlendResult(null)
    setError(null)
    setSelectingFor('main')
    setProgressMsg('')
  }, [])

  useEffect(() => {
    if (!open) resetState()
  }, [open, resetState])

  const handleSelectImage = useCallback((url: string, title: string) => {
    if (selectingFor === 'main') {
      setMainImage(url)
      setMainImageTitle(title)
      setSelectingFor('secondary')
    } else {
      if (secondaryImages.length >= MAX_SECONDARY_IMAGES) {
        setError(`最多只能选择 ${MAX_SECONDARY_IMAGES} 张副图`)
        return
      }
      if (url === mainImage || secondaryImages.some(s => s.url === url)) {
        return
      }
      setSecondaryImages(prev => [...prev, { url, title }])
    }
    setError(null)
  }, [selectingFor, mainImage, secondaryImages])

  const handleRemoveSecondary = useCallback((index: number) => {
    setSecondaryImages(prev => prev.filter((_, i) => i !== index))
  }, [])

  const handleFileUpload = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    const reader = new FileReader()
    reader.onload = (event) => {
      const base64 = event.target?.result as string
      if (!base64?.startsWith('data:')) {
        setError('文件格式无效')
        return
      }
      handleSelectImage(base64, file.name)
    }
    reader.readAsDataURL(file)
    e.target.value = ''
  }, [handleSelectImage])

  const handleBlend = useCallback(async () => {
    if (!mainImage) {
      setError('请选择主图')
      return
    }
    if (secondaryImages.length === 0) {
      setError('请至少选择一张副图')
      return
    }
    if (!userPrompt.trim()) {
      setError('请输入融合描述')
      return
    }

    setIsProcessing(true)
    setError(null)
    setProgressMsg('分析图片中...')

    try {
      const mainAnalysis = (await analyzeImages([mainImage]))[0]
      setProgressMsg('分析副图中...')
      const secondaryAnalyses = await analyzeImages(secondaryImages.map(s => s.url))

      setProgressMsg('优化提示词...')
      const optimized = await optimizePromptWithAI(userPrompt, mainAnalysis, secondaryAnalyses)

      const result = await blendWithGemini(
        mainImage,
        secondaryImages.map(s => s.url),
        optimized,
        setProgressMsg,
        aspectRatio,
        resolution
      )

      setBlendResult(result)
      setProgressMsg('')
    } catch (err: any) {
      setError(err?.message || '融合失败')
    } finally {
      setIsProcessing(false)
    }
  }, [mainImage, secondaryImages, userPrompt, aspectRatio, resolution])

  const handleAddToWorkspace = useCallback(() => {
    if (!blendResult) return
    onAddImage?.(blendResult, `融合图片-${Date.now()}`)
    resetState()
  }, [blendResult, onAddImage, resetState])

  if (!open) return null

  const categoryLabels: Record<string, { label: string; icon: React.ReactNode }> = {
    character: { label: '角色', icon: <User className="h-4 w-4" /> },
    scene: { label: '场景', icon: <MapPin className="h-4 w-4" /> },
    asset: { label: '资产', icon: <Sword className="h-4 w-4" /> },
    shot: { label: '镜头', icon: <Package className="h-4 w-4" /> },
    canvas: { label: '画布素材', icon: <Palette className="h-4 w-4" /> },
    history: { label: '历史素材', icon: <Clock className="h-4 w-4" /> },
  }

  const canBlend = mainImage && secondaryImages.length > 0 && userPrompt.trim() && !isProcessing

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={onClose}>
      <div
        className="w-[600px] max-h-[90vh] rounded-2xl border border-[var(--border-color)] bg-[var(--bg-secondary)] shadow-2xl overflow-hidden flex flex-col"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-[var(--border-color)] p-4 flex-shrink-0">
          <div className="flex items-center gap-2">
            <Wand2 className="h-5 w-5 text-[var(--accent-color)]" />
            <h3 className="font-semibold text-[var(--text-primary)]">短剧融图</h3>
            <span className="text-xs text-[var(--text-secondary)]">
              主图1张 + 副图最多{MAX_SECONDARY_IMAGES}张
            </span>
          </div>
          <button onClick={onClose} className="rounded-full p-1 text-[var(--text-secondary)] hover:bg-[var(--bg-primary)]">
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Error */}
        {error && (
          <div className="border-b border-red-500/30 bg-red-900/20 p-3 flex gap-2 items-center flex-shrink-0">
            <AlertCircle className="h-4 w-4 text-red-500" />
            <p className="text-xs text-red-400">{error}</p>
          </div>
        )}

        {/* Progress */}
        {isProcessing && (
          <div className="border-b border-[var(--accent-color)]/30 bg-[var(--accent-color)]/10 p-3 flex gap-2 items-center flex-shrink-0">
            <Loader2 className="h-4 w-4 text-[var(--accent-color)] animate-spin" />
            <p className="text-xs text-[var(--accent-color)]">{progressMsg}</p>
          </div>
        )}

        {/* Content */}
        <div className="p-4 overflow-auto flex-1">
          {!blendResult ? (
            <div className="space-y-4">
              {/* Selected Images Preview */}
              <div className="flex gap-3">
                {/* Main Image */}
                <div
                  onClick={() => setSelectingFor('main')}
                  className={cn(
                    'w-24 h-24 rounded-lg border-2 flex items-center justify-center cursor-pointer overflow-hidden flex-shrink-0',
                    selectingFor === 'main' ? 'border-blue-500' : 'border-[var(--border-color)]',
                    mainImage ? 'border-solid' : 'border-dashed'
                  )}
                >
                  {mainImage ? (
                    <div className="relative w-full h-full group">
                      <img src={mainImage} alt="" className="w-full h-full object-cover" />
                      <button
                        onClick={(e) => { e.stopPropagation(); setMainImage(null); setMainImageTitle(''); setSelectingFor('main') }}
                        className="absolute top-1 right-1 bg-black/60 text-white p-0.5 rounded opacity-0 group-hover:opacity-100 transition"
                      >
                        <X className="h-3 w-3" />
                      </button>
                      <div className="absolute bottom-0 left-0 right-0 bg-blue-600/90 text-white text-[10px] text-center py-0.5">
                        主图
                      </div>
                    </div>
                  ) : (
                    <div className="text-center p-2">
                      <User className="h-6 w-6 mx-auto text-blue-500 mb-1" />
                      <span className="text-[10px] text-[var(--text-secondary)]">主图</span>
                    </div>
                  )}
                </div>

                {/* Secondary Images */}
                <div
                  onClick={() => setSelectingFor('secondary')}
                  className={cn(
                    'flex-1 min-h-[96px] rounded-lg border-2 p-2 cursor-pointer',
                    selectingFor === 'secondary' ? 'border-orange-500' : 'border-[var(--border-color)]',
                    secondaryImages.length > 0 ? 'border-solid' : 'border-dashed'
                  )}
                >
                  {secondaryImages.length === 0 ? (
                    <div className="h-full flex flex-col items-center justify-center">
                      <Package className="h-6 w-6 text-orange-500 mb-1" />
                      <span className="text-[10px] text-[var(--text-secondary)]">点击选择副图 (最多{MAX_SECONDARY_IMAGES}张)</span>
                    </div>
                  ) : (
                    <div className="flex gap-1.5 flex-wrap">
                      {secondaryImages.map((img, idx) => (
                        <div key={idx} className="relative w-12 h-12 rounded overflow-hidden border border-orange-500 group">
                          <img src={img.url} alt="" className="w-full h-full object-cover" />
                          <button
                            onClick={(e) => { e.stopPropagation(); handleRemoveSecondary(idx) }}
                            className="absolute top-0 right-0 bg-black/60 text-white p-0.5 rounded-bl opacity-0 group-hover:opacity-100 transition"
                          >
                            <X className="h-2.5 w-2.5" />
                          </button>
                        </div>
                      ))}
                      {secondaryImages.length < MAX_SECONDARY_IMAGES && (
                        <div className="w-12 h-12 rounded border border-dashed border-orange-400 flex items-center justify-center">
                          <Plus className="h-4 w-4 text-orange-400" />
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>

              <div className="text-center text-xs text-[var(--text-secondary)]">
                正在选择: <span className={selectingFor === 'main' ? 'text-blue-500' : 'text-orange-500'}>{selectingFor === 'main' ? '主图' : '副图'}</span>
              </div>

              {/* Image Selection from Draft */}
              <div className="border border-[var(--border-color)] rounded-lg overflow-hidden">
                {Object.entries(groupedImages).map(([category, images]) => (
                  <div key={category} className="border-b border-[var(--border-color)] last:border-b-0">
                    <button
                      onClick={() => setExpandedCategory(expandedCategory === category ? null : category)}
                      className="w-full flex items-center justify-between p-2 hover:bg-[var(--bg-primary)]"
                    >
                      <div className="flex items-center gap-2">
                        {categoryLabels[category].icon}
                        <span className="text-sm font-medium text-[var(--text-primary)]">{categoryLabels[category].label}</span>
                        <span className="text-xs text-[var(--text-secondary)]">({images.length})</span>
                      </div>
                      {expandedCategory === category ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                    </button>
                    {expandedCategory === category && images.length > 0 && (
                      <div className="p-2 pt-0 grid grid-cols-5 gap-2">
                        {images.map(img => {
                          const isSelected = img.url === mainImage || secondaryImages.some(s => s.url === img.url)
                          return (
                            <button
                              key={img.id}
                              onClick={() => handleSelectImage(img.url, img.title)}
                              className={cn(
                                'relative aspect-square rounded overflow-hidden border-2 transition',
                                isSelected ? 'border-green-500' : 'border-transparent hover:border-[var(--accent-color)]'
                              )}
                              title={img.title}
                            >
                              <img src={img.url} alt="" className="w-full h-full object-cover" />
                              {isSelected && (
                                <div className="absolute inset-0 bg-green-500/30 flex items-center justify-center">
                                  <Check className="h-4 w-4 text-white" />
                                </div>
                              )}
                            </button>
                          )
                        })}
                      </div>
                    )}
                    {expandedCategory === category && images.length === 0 && (
                      <div className="p-2 pt-0 text-xs text-[var(--text-secondary)] text-center">
                        暂无{categoryLabels[category].label}图片
                      </div>
                    )}
                  </div>
                ))}
              </div>

              {/* Upload */}
              <button
                onClick={() => fileInputRef.current?.click()}
                className="w-full px-3 py-2 rounded-lg border border-dashed border-[var(--border-color)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:border-[var(--accent-color)] transition flex items-center justify-center gap-2"
              >
                <Upload className="h-4 w-4" />
                <span className="text-sm">上传本地图片</span>
              </button>
              <input ref={fileInputRef} type="file" accept="image/*" onChange={handleFileUpload} className="hidden" />

              {/* Blend Settings */}
              {mainImage && secondaryImages.length > 0 && (
                <div className="space-y-3 pt-2 border-t border-[var(--border-color)]">
                  <div>
                    <label className="flex items-center gap-2 text-xs font-semibold text-[var(--text-primary)] mb-1">
                      <Sparkles className="h-4 w-4 text-[var(--accent-color)]" />
                      融合描述
                    </label>
                    <textarea
                      value={userPrompt}
                      onChange={(e) => setUserPrompt(e.target.value)}
                      placeholder="描述如何将副图元素融入主图..."
                      className="w-full h-16 px-3 py-2 rounded-lg bg-[var(--bg-primary)] text-[var(--text-primary)] text-sm border border-[var(--border-color)] resize-none"
                    />
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs font-semibold text-[var(--text-primary)] mb-1">比例</label>
                      <select
                        value={aspectRatio}
                        onChange={(e) => setAspectRatio(e.target.value as any)}
                        className="w-full px-3 py-2 rounded-lg bg-[var(--bg-primary)] text-[var(--text-primary)] text-sm border border-[var(--border-color)]"
                      >
                        <option value="1:1">1:1</option>
                        <option value="3:4">3:4</option>
                        <option value="4:3">4:3</option>
                        <option value="9:16">9:16</option>
                        <option value="16:9">16:9</option>
                      </select>
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-[var(--text-primary)] mb-1">分辨率</label>
                      <select
                        value={resolution}
                        onChange={(e) => setResolution(e.target.value as any)}
                        className="w-full px-3 py-2 rounded-lg bg-[var(--bg-primary)] text-[var(--text-primary)] text-sm border border-[var(--border-color)]"
                      >
                        <option value="1K">1K</option>
                        <option value="2K">2K</option>
                        <option value="4K">4K</option>
                      </select>
                    </div>
                  </div>
                </div>
              )}

              {/* Blend Button */}
              {canBlend && (
                <button
                  onClick={handleBlend}
                  className="w-full px-4 py-3 rounded-lg bg-[var(--accent-color)] text-white font-semibold hover:opacity-90 transition flex items-center justify-center gap-2"
                >
                  <Sparkles className="h-4 w-4" />
                  开始融合
                </button>
              )}
            </div>
          ) : (
            <div className="space-y-4">
              <div className="rounded-lg overflow-hidden border border-[var(--border-color)]">
                <img src={blendResult} alt="融合结果" className="w-full" />
              </div>

              <div className="space-y-2">
                <button
                  onClick={handleAddToWorkspace}
                  className="w-full px-4 py-3 rounded-lg bg-[var(--accent-color)] text-white font-semibold hover:opacity-90 transition flex items-center justify-center gap-2"
                >
                  <Plus className="h-4 w-4" />
                  添加到工作台
                </button>
                <button
                  onClick={() => setBlendResult(null)}
                  className="w-full px-4 py-2 rounded-lg bg-[var(--bg-primary)] text-[var(--text-primary)] font-semibold hover:bg-[var(--bg-tertiary)] transition"
                >
                  重新调整
                </button>
                <button
                  onClick={resetState}
                  className="w-full px-4 py-2 rounded-lg bg-[var(--bg-primary)] text-[var(--text-secondary)] font-semibold hover:bg-[var(--bg-tertiary)] transition"
                >
                  重新选择
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
