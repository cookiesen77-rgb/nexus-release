/**
 * EcomStudioShell - 电商工具台页面壳
 * 复用 ShortDramaStudioShell 的持久化+项目管理模式
 */
import React, { useState, useCallback, useRef, useEffect, useMemo } from 'react'
import { ShoppingBag, Plus, Copy, Trash2, ChevronDown, X, Image, LayoutGrid, Shirt, Megaphone, Loader2, Upload, Wand2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import type { EcomDraftV1, EcomSceneType, EcomMediaVariant, EcomMediaSlot } from '@/lib/ecommerce/types'
import { ECOM_DETAIL_ROLES } from '@/lib/ecommerce/types'
import { loadDraft, saveDraft, createDefaultDraft, createEmptySlot, listProjects, createProject, deleteProject, duplicateProject, touchProject } from '@/lib/ecommerce/draftStorage'
import type { EcomProjectMeta } from '@/lib/ecommerce/draftStorage'
import type { EcomStudioPrefsV1 } from '@/lib/ecommerce/uiPrefs'
import { loadPrefs, savePrefs } from '@/lib/ecommerce/uiPrefs'
import { getTemplatesByScene } from '@/lib/ecommerce/templates'
import type { EcomTemplate } from '@/lib/ecommerce/templates'
import { getMedia, saveMedia } from '@/lib/mediaStorage'
import { IMAGE_MODELS, DEFAULT_IMAGE_MODEL } from '@/config/models'
import { generateEcomImage, buildHeroPrompt, buildDetailPrompt, buildPosterPrompt, collectProductRefUrls, generateTryOn } from '@/lib/ecommerce/generateMedia'
import { streamChatCompletions } from '@/api'
import { useSettingsStore } from '@/store/settings'
import { useAssetsStore } from '@/store/assets'

interface Props {
  projectId: string
  onRequestClose?: () => void
}

const LAST_PID_KEY = 'nexus-ecom-studio-last-project-id'

const SCENE_TABS: { type: EcomSceneType; label: string; icon: React.ComponentType<{ className?: string }> }[] = [
  { type: 'hero', label: '商品主图', icon: Image },
  { type: 'detail_page', label: '详情页套图', icon: LayoutGrid },
  { type: 'try_on', label: '模特换装', icon: Shirt },
  { type: 'poster', label: '营销海报', icon: Megaphone },
]

function useMediaPreview(mediaId?: string) {
  const [url, setUrl] = useState('')
  useEffect(() => {
    if (!mediaId) { setUrl(''); return }
    let cancelled = false
    ;(async () => {
      try {
        const rec = await getMedia(mediaId)
        if (!cancelled) setUrl(String(rec?.data || ''))
      } catch { if (!cancelled) setUrl('') }
    })()
    return () => { cancelled = true }
  }, [mediaId])
  return url
}

function VariantThumb({ variant, className }: { variant: EcomMediaVariant; className?: string }) {
  const fromMedia = useMediaPreview(variant.mediaId)
  const url = String(variant.displayUrl || fromMedia || variant.sourceUrl || '').trim()
  if (variant.status === 'running') {
    return <div className={cn('flex items-center justify-center rounded-lg bg-[var(--accent-color)]/10', className)}><Loader2 className="h-5 w-5 animate-spin text-[var(--accent-color)]" /></div>
  }
  if (variant.status === 'error') {
    return <div className={cn('flex items-center justify-center rounded-lg bg-red-500/10 text-xs text-red-500', className)}>失败</div>
  }
  if (!url) return <div className={cn('flex items-center justify-center rounded-lg bg-black/5 text-xs text-[var(--text-secondary)]', className)}>空</div>
  return <img src={url} className={cn('rounded-lg object-cover', className)} alt="" />
}

export default function EcomStudioShell({ projectId, onRequestClose }: Props) {
  const initialPid = (() => {
    try {
      const saved = localStorage.getItem(LAST_PID_KEY)
      if (saved && listProjects().some(p => p.id === saved)) return saved
    } catch { /* ignore */ }
    return String(projectId || '').trim() || 'default'
  })()

  const [currentProjectId, setCurrentProjectIdRaw] = useState(initialPid)
  const pid = currentProjectId
  const setCurrentProjectId = useCallback((nextId: string) => {
    setCurrentProjectIdRaw(nextId)
    try { localStorage.setItem(LAST_PID_KEY, nextId) } catch { /* ignore */ }
  }, [])

  const [projects, setProjects] = useState<EcomProjectMeta[]>(() => listProjects())
  const [projectDropdownOpen, setProjectDropdownOpen] = useState(false)
  const refreshProjects = useCallback(() => setProjects(listProjects()), [])

  const [draft, setDraft] = useState<EcomDraftV1>(() => loadDraft(pid))
  const [prefs, setPrefs] = useState<EcomStudioPrefsV1>(() => loadPrefs(pid))
  const draftRef = useRef(draft)
  const prefsRef = useRef(prefs)
  draftRef.current = draft
  prefsRef.current = prefs
  const initialLoadDoneRef = useRef(true)

  const setDraftSafe = useCallback((next: React.SetStateAction<EcomDraftV1>) => {
    if (typeof next === 'function') {
      setDraft(prev => { const n = next(prev); draftRef.current = n; return n })
    } else {
      draftRef.current = next; setDraft(next)
    }
  }, [])

  // Debounced persistence
  const flushNow = useCallback(() => {
    if (!initialLoadDoneRef.current) return
    saveDraft(pid, draftRef.current)
    savePrefs(pid, prefsRef.current)
    touchProject(pid, draftRef.current)
  }, [pid])

  useEffect(() => {
    if (!initialLoadDoneRef.current) return
    const t = window.setTimeout(flushNow, 300)
    return () => window.clearTimeout(t)
  }, [draft, prefs, flushNow])

  useEffect(() => { return () => { flushNow() } }, [flushNow])

  // Project switching
  const prevPidRef = useRef(pid)
  useEffect(() => {
    if (prevPidRef.current !== pid) {
      prevPidRef.current = pid
      initialLoadDoneRef.current = false
      setDraft(loadDraft(pid))
      setPrefs(loadPrefs(pid))
      setTimeout(() => { initialLoadDoneRef.current = true }, 50)
    }
  }, [pid])

  const activeScene = draft.activeScene || 'hero'
  const setActiveScene = useCallback((s: EcomSceneType) => {
    setDraftSafe(prev => ({ ...prev, activeScene: s }))
  }, [setDraftSafe])

  const templates = useMemo(() => getTemplatesByScene(activeScene), [activeScene])

  const handleCreateProject = useCallback(() => {
    flushNow()
    const newId = createProject()
    refreshProjects()
    setCurrentProjectId(newId)
  }, [flushNow, refreshProjects, setCurrentProjectId])

  const handleDeleteProject = useCallback((delId: string) => {
    if (!window.confirm('确定删除此项目？')) return
    deleteProject(delId)
    refreshProjects()
    const remaining = listProjects()
    if (pid === delId) setCurrentProjectId(remaining[0]?.id || createProject())
  }, [pid, refreshProjects, setCurrentProjectId])

  const handleDuplicateProject = useCallback((srcId: string) => {
    const newId = duplicateProject(srcId)
    if (newId) { refreshProjects(); setCurrentProjectId(newId) }
  }, [refreshProjects, setCurrentProjectId])

  const patchProduct = useCallback((patch: Partial<EcomDraftV1['product']>) => {
    setDraftSafe(prev => ({ ...prev, product: { ...prev.product, ...patch } }))
  }, [setDraftSafe])

  const patchModels = useCallback((patch: Partial<EcomDraftV1['models']>) => {
    setDraftSafe(prev => ({ ...prev, models: { ...prev.models, ...patch } }))
  }, [setDraftSafe])

  // Product ref upload
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
              id: `slot_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
              label: f.name,
              variants: [{
                id: `var_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
                status: 'success',
                createdAt: Date.now(),
                createdBy: 'manual',
                displayUrl: dataUrl,
              }],
              selectedVariantId: undefined,
            }
          }]
        }))
      }
      reader.readAsDataURL(f)
    }
    e.currentTarget.value = ''
  }, [setDraftSafe])

  const currentProject = projects.find(p => p.id === pid)

  // ===== Generation state =====
  const [generating, setGenerating] = useState(false)
  const [generatingSlotId, setGeneratingSlotId] = useState('')
  const [selectedTemplate, setSelectedTemplate] = useState<EcomTemplate | null>(null)
  const [chatMessages, setChatMessages] = useState<{ role: string; content: string }[]>([])
  const [chatInput, setChatInput] = useState('')
  const [chatStreaming, setChatStreaming] = useState(false)

  const makeVariantId = () => `var_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`

  // Get the active slot for current scene
  const getActiveSlot = useCallback((): EcomMediaSlot | null => {
    if (activeScene === 'hero') return draft.heroScene.slot
    return null
  }, [activeScene, draft])

  const getActiveSelectedVariant = useCallback((): EcomMediaVariant | null => {
    const slot = getActiveSlot()
    if (!slot) return null
    return slot.variants.find(v => v.id === slot.selectedVariantId) || slot.variants[slot.variants.length - 1] || null
  }, [getActiveSlot])

  // ===== Hero generation =====
  const handleGenerateHero = useCallback(async () => {
    if (generating) return
    if (!draft.product.name && draft.productRefs.length === 0) {
      window.$message?.warning?.('请先填写商品名称或上传参考图')
      return
    }
    setGenerating(true)
    setGeneratingSlotId(draft.heroScene.slot.id)

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
      setGeneratingSlotId('')
    }
  }, [draft, generating, setDraftSafe])

  // ===== Detail page batch generation =====
  const handleGenerateDetailPage = useCallback(async () => {
    if (generating) return
    if (!draft.product.name && draft.productRefs.length === 0) {
      window.$message?.warning?.('请先填写商品名称或上传参考图')
      return
    }
    setGenerating(true)
    window.$message?.info?.('开始生成详情页 9 张套图...')

    const refUrls = collectProductRefUrls(draft)
    let successCount = 0

    for (let i = 0; i < draft.detailPageScene.images.length; i++) {
      const img = draft.detailPageScene.images[i]
      const variantId = makeVariantId()
      setGeneratingSlotId(img.slot.id)

      setDraftSafe(prev => {
        const images = [...prev.detailPageScene.images]
        images[i] = {
          ...images[i],
          slot: {
            ...images[i].slot,
            variants: [...images[i].slot.variants, { id: variantId, status: 'running', createdAt: Date.now(), createdBy: 'template', modelKey: draft.models.imageModelKey } as EcomMediaVariant],
            selectedVariantId: variantId,
          }
        }
        return { ...prev, detailPageScene: { ...prev.detailPageScene, images } }
      })

      try {
        const prompt = buildDetailPrompt(draft, img.role)
        const result = await generateEcomImage({
          modelKey: draft.models.imageModelKey,
          prompt,
          size: draft.models.imageSize,
          quality: draft.models.imageQuality,
          refImages: refUrls,
        })

        const displayUrl = result.displayUrl || result.imageUrl
        setDraftSafe(prev => {
          const images = [...prev.detailPageScene.images]
          images[i] = {
            ...images[i],
            slot: {
              ...images[i].slot,
              variants: images[i].slot.variants.map(v =>
                v.id === variantId ? { ...v, status: 'success' as const, displayUrl, sourceUrl: result.imageUrl, promptSnapshot: prompt } : v
              ),
            }
          }
          return { ...prev, detailPageScene: { ...prev.detailPageScene, images } }
        })
        successCount++
      } catch (err: any) {
        setDraftSafe(prev => {
          const images = [...prev.detailPageScene.images]
          images[i] = {
            ...images[i],
            slot: {
              ...images[i].slot,
              variants: images[i].slot.variants.map(v =>
                v.id === variantId ? { ...v, status: 'error' as const, error: err?.message || '生成失败' } : v
              ),
            }
          }
          return { ...prev, detailPageScene: { ...prev.detailPageScene, images } }
        })
      }
    }

    setGenerating(false)
    setGeneratingSlotId('')
    window.$message?.success?.(`详情页套图完成：成功 ${successCount}/9`)
  }, [draft, generating, setDraftSafe])

  // ===== Try-on generation =====
  const handleAddTryOn = useCallback(() => {
    setDraftSafe(prev => ({
      ...prev,
      tryOnScenes: [...prev.tryOnScenes, {
        id: `tryon_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        humanImageSlot: createEmptySlot('模特照片'),
        clothImageSlot: createEmptySlot('服装图片'),
        resultSlot: createEmptySlot('试穿效果'),
      }]
    }))
  }, [setDraftSafe])

  const handleTryOnUpload = useCallback((sceneIdx: number, field: 'humanImageSlot' | 'clothImageSlot', e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = () => {
      const dataUrl = reader.result as string
      if (!dataUrl) return
      const variantId = makeVariantId()
      setDraftSafe(prev => {
        const scenes = [...prev.tryOnScenes]
        scenes[sceneIdx] = {
          ...scenes[sceneIdx],
          [field]: {
            ...scenes[sceneIdx][field],
            variants: [{ id: variantId, status: 'success' as const, createdAt: Date.now(), createdBy: 'manual' as const, displayUrl: dataUrl }],
            selectedVariantId: variantId,
          }
        }
        return { ...prev, tryOnScenes: scenes }
      })
    }
    reader.readAsDataURL(file)
    e.currentTarget.value = ''
  }, [setDraftSafe])

  const handleRunTryOn = useCallback(async (sceneIdx: number) => {
    if (generating) return
    const scene = draft.tryOnScenes[sceneIdx]
    if (!scene) return

    const humanV = scene.humanImageSlot.variants[0]
    const clothV = scene.clothImageSlot.variants[0]
    if (!humanV?.displayUrl && !humanV?.sourceUrl) { window.$message?.warning?.('请上传模特照片'); return }
    if (!clothV?.displayUrl && !clothV?.sourceUrl) { window.$message?.warning?.('请上传服装图片'); return }

    setGenerating(true)
    const variantId = makeVariantId()

    setDraftSafe(prev => {
      const scenes = [...prev.tryOnScenes]
      scenes[sceneIdx] = {
        ...scenes[sceneIdx],
        resultSlot: {
          ...scenes[sceneIdx].resultSlot,
          variants: [...scenes[sceneIdx].resultSlot.variants, { id: variantId, status: 'running', createdAt: Date.now(), createdBy: 'auto' } as EcomMediaVariant],
          selectedVariantId: variantId,
        }
      }
      return { ...prev, tryOnScenes: scenes }
    })

    try {
      const humanUrl = humanV.displayUrl || humanV.sourceUrl || ''
      const clothUrl = clothV.displayUrl || clothV.sourceUrl || ''
      const result = await generateTryOn(humanUrl, clothUrl)

      setDraftSafe(prev => {
        const scenes = [...prev.tryOnScenes]
        scenes[sceneIdx] = {
          ...scenes[sceneIdx],
          resultSlot: {
            ...scenes[sceneIdx].resultSlot,
            variants: scenes[sceneIdx].resultSlot.variants.map(v =>
              v.id === variantId ? { ...v, status: 'success' as const, sourceUrl: result.imageUrl, displayUrl: result.imageUrl } : v
            ),
          }
        }
        return { ...prev, tryOnScenes: scenes }
      })
      window.$message?.success?.('虚拟试穿完成')
    } catch (err: any) {
      setDraftSafe(prev => {
        const scenes = [...prev.tryOnScenes]
        scenes[sceneIdx] = {
          ...scenes[sceneIdx],
          resultSlot: {
            ...scenes[sceneIdx].resultSlot,
            variants: scenes[sceneIdx].resultSlot.variants.map(v =>
              v.id === variantId ? { ...v, status: 'error' as const, error: err?.message || '试穿失败' } : v
            ),
          }
        }
        return { ...prev, tryOnScenes: scenes }
      })
      window.$message?.error?.(err?.message || '虚拟试穿失败')
    } finally {
      setGenerating(false)
    }
  }, [draft, generating, setDraftSafe])

  // ===== Poster generation =====
  const handleAddPoster = useCallback(() => {
    setDraftSafe(prev => ({
      ...prev,
      posterScenes: [...prev.posterScenes, {
        id: `poster_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        campaign: 'custom' as const,
        campaignText: '',
        headline: '',
        subheadline: '',
        ctaText: '立即抢购',
        discountText: '',
        templatePresetId: '',
        prompt: '',
        slot: createEmptySlot('营销海报'),
      }]
    }))
  }, [setDraftSafe])

  const handleGeneratePoster = useCallback(async (idx: number) => {
    if (generating) return
    setGenerating(true)
    const variantId = makeVariantId()

    setDraftSafe(prev => {
      const scenes = [...prev.posterScenes]
      scenes[idx] = {
        ...scenes[idx],
        slot: {
          ...scenes[idx].slot,
          variants: [...scenes[idx].slot.variants, { id: variantId, status: 'running', createdAt: Date.now(), createdBy: 'template' } as EcomMediaVariant],
          selectedVariantId: variantId,
        }
      }
      return { ...prev, posterScenes: scenes }
    })

    try {
      const prompt = buildPosterPrompt(draft, idx)
      const refUrls = collectProductRefUrls(draft)
      const result = await generateEcomImage({
        modelKey: draft.models.imageModelKey,
        prompt,
        size: '9:16',
        quality: draft.models.imageQuality,
        refImages: refUrls,
      })
      const displayUrl = result.displayUrl || result.imageUrl
      setDraftSafe(prev => {
        const scenes = [...prev.posterScenes]
        scenes[idx] = {
          ...scenes[idx],
          slot: {
            ...scenes[idx].slot,
            variants: scenes[idx].slot.variants.map(v =>
              v.id === variantId ? { ...v, status: 'success' as const, displayUrl, sourceUrl: result.imageUrl, promptSnapshot: prompt } : v
            ),
          }
        }
        return { ...prev, posterScenes: scenes }
      })
      window.$message?.success?.('海报生成成功')
    } catch (err: any) {
      setDraftSafe(prev => {
        const scenes = [...prev.posterScenes]
        scenes[idx] = {
          ...scenes[idx],
          slot: {
            ...scenes[idx].slot,
            variants: scenes[idx].slot.variants.map(v =>
              v.id === variantId ? { ...v, status: 'error' as const, error: err?.message || '生成失败' } : v
            ),
          }
        }
        return { ...prev, posterScenes: scenes }
      })
      window.$message?.error?.(err?.message || '海报生成失败')
    } finally {
      setGenerating(false)
    }
  }, [draft, generating, setDraftSafe])

  // ===== AI Chat =====
  const handleSendChat = useCallback(async () => {
    const text = chatInput.trim()
    if (!text || chatStreaming) return
    setChatInput('')
    const userMsg = { role: 'user', content: text }
    setChatMessages(prev => [...prev, userMsg])
    setChatStreaming(true)

    const systemPrompt = [
      '你是专业电商图片顾问。',
      `当前商品：${draft.product.name || '未命名'} (${draft.product.category || '未分类'})`,
      `品牌：${draft.product.brand || '无'}`,
      `卖点：${draft.product.sellingPoints.join('、') || '无'}`,
      `当前场景：${activeScene}`,
      '请根据用户需求，给出具体的提示词修改建议。直接输出优化后的提示词，不要废话。',
    ].join('\n')

    let fullResp = ''
    setChatMessages(prev => [...prev, { role: 'assistant', content: '' }])

    try {
      const aiModel = useSettingsStore.getState().aiAssistantModel || 'gpt-5-mini'
      for await (const chunk of streamChatCompletions({
        model: aiModel,
        messages: [{ role: 'system', content: systemPrompt }, ...chatMessages.slice(-10), userMsg],
      })) {
        fullResp += chunk
        setChatMessages(prev => {
          const msgs = [...prev]
          msgs[msgs.length - 1] = { role: 'assistant', content: fullResp }
          return msgs
        })
      }
    } catch (err: any) {
      setChatMessages(prev => {
        const msgs = [...prev]
        msgs[msgs.length - 1] = { role: 'assistant', content: `错误：${err?.message || '对话失败'}` }
        return msgs
      })
    } finally {
      setChatStreaming(false)
    }
  }, [chatInput, chatStreaming, chatMessages, draft, activeScene])

  return (
    <div className="flex h-screen w-full flex-col bg-[var(--bg-primary)] text-[var(--text-primary)]">
      {/* Header */}
      <div className="flex h-12 flex-shrink-0 items-center justify-between border-b border-[var(--border-color)] px-4">
        <div className="flex items-center gap-3">
          <ShoppingBag className="h-5 w-5 text-orange-500" />
          <span className="text-sm font-bold">电商工具台</span>

          {/* Project switcher */}
          <div className="relative">
            <button onClick={() => setProjectDropdownOpen(!projectDropdownOpen)} className="flex items-center gap-1 rounded-lg border border-[var(--border-color)] px-3 py-1 text-xs hover:bg-[var(--bg-secondary)]">
              {currentProject?.title || draft.title || '新项目'}
              <ChevronDown className="h-3 w-3" />
            </button>
            {projectDropdownOpen && (
              <div className="absolute left-0 top-full z-50 mt-1 w-64 rounded-lg border border-[var(--border-color)] bg-[var(--bg-secondary)] p-2 shadow-xl">
                <Button size="sm" className="mb-2 w-full gap-1" onClick={() => { handleCreateProject(); setProjectDropdownOpen(false) }}>
                  <Plus className="h-3 w-3" /> 新建项目
                </Button>
                {projects.map(p => (
                  <div key={p.id} className={cn('flex items-center justify-between rounded-lg px-2 py-1.5 text-xs hover:bg-[var(--bg-tertiary)]', p.id === pid && 'bg-[var(--accent-color)]/10')}>
                    <button className="flex-1 truncate text-left" onClick={() => { flushNow(); setCurrentProjectId(p.id); setProjectDropdownOpen(false) }}>
                      {p.title} {p.productName ? `· ${p.productName}` : ''}
                    </button>
                    <div className="flex gap-1">
                      <button onClick={() => handleDuplicateProject(p.id)} title="复制"><Copy className="h-3 w-3" /></button>
                      <button onClick={() => handleDeleteProject(p.id)} title="删除" className="text-red-500"><Trash2 className="h-3 w-3" /></button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {draft.product.name && (
            <span className="text-xs text-[var(--text-secondary)]">商品: {draft.product.name}</span>
          )}
        </div>

        <button onClick={onRequestClose} className="flex items-center gap-1 rounded-lg border border-[var(--border-color)] px-3 py-1.5 text-xs hover:bg-[var(--bg-secondary)]">
          返回画布
        </button>
      </div>

      {/* Body: 3 columns */}
      <div className="flex flex-1 overflow-hidden">
        {/* LEFT: Scene tabs + templates */}
        <div className="flex w-72 flex-shrink-0 flex-col border-r border-[var(--border-color)] overflow-y-auto">
          {/* Scene tabs */}
          <div className="flex flex-col gap-1 p-3 border-b border-[var(--border-color)]">
            {SCENE_TABS.map(tab => {
              const Icon = tab.icon
              return (
                <button
                  key={tab.type}
                  onClick={() => setActiveScene(tab.type)}
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

          {/* Product info quick form */}
          <div className="p-3 border-b border-[var(--border-color)] space-y-2">
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
              <option value="服饰">服饰</option>
              <option value="数码">数码</option>
              <option value="美妆">美妆</option>
              <option value="食品">食品</option>
              <option value="珠宝">珠宝</option>
              <option value="家居">家居</option>
              <option value="母婴">母婴</option>
              <option value="其他">其他</option>
            </select>
            <textarea
              value={draft.product.description}
              onChange={e => patchProduct({ description: e.target.value })}
              placeholder="商品描述/卖点"
              rows={2}
              className="w-full rounded-lg border border-[var(--border-color)] bg-[var(--bg-primary)] px-2 py-1.5 text-xs resize-none focus:border-[var(--accent-color)] focus:outline-none"
            />

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
                    <div key={ref.id} className="relative group">
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
                  className="rounded-xl border border-[var(--border-color)] bg-[var(--bg-secondary)] p-2 text-left hover:border-[var(--accent-color)] transition-colors"
                >
                  <div className="mb-1 h-16 rounded-lg bg-[var(--bg-tertiary)] flex items-center justify-center">
                    <Wand2 className="h-5 w-5 text-[var(--text-secondary)] opacity-30" />
                  </div>
                  <div className="text-[11px] font-medium text-[var(--text-primary)] truncate">{t.name}</div>
                  <div className="text-[10px] text-[var(--text-secondary)] line-clamp-2">{t.description}</div>
                </button>
              ))}
            </div>
          </div>

          {/* Model selection */}
          <div className="p-3 border-t border-[var(--border-color)] space-y-2">
            <div className="text-[11px] font-bold uppercase text-[var(--text-secondary)]">生图模型</div>
            <select
              value={draft.models.imageModelKey}
              onChange={e => patchModels({ imageModelKey: e.target.value })}
              className="w-full rounded-lg border border-[var(--border-color)] bg-[var(--bg-primary)] px-2 py-1.5 text-xs focus:border-[var(--accent-color)] focus:outline-none"
            >
              {(IMAGE_MODELS as any[]).map((m: any) => (
                <option key={m.key} value={m.key}>{m.label}</option>
              ))}
            </select>
          </div>
        </div>

        {/* CENTER: Preview + Generation area */}
        <div className="flex flex-1 flex-col overflow-y-auto p-6">
          {/* Hero Scene */}
          {activeScene === 'hero' && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold">商品主图</h3>
                <Button onClick={handleGenerateHero} disabled={generating} className="gap-1">
                  {generating && generatingSlotId === draft.heroScene.slot.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Wand2 className="h-4 w-4" />}
                  {generating ? '生成中...' : '生成主图'}
                </Button>
              </div>
              <div className="flex gap-3">
                <select value={draft.heroScene.backgroundType} onChange={e => setDraftSafe(prev => ({ ...prev, heroScene: { ...prev.heroScene, backgroundType: e.target.value as any } }))} className="rounded-lg border border-[var(--border-color)] bg-[var(--bg-primary)] px-2 py-1.5 text-xs">
                  <option value="white">白底</option>
                  <option value="scene">场景化</option>
                  <option value="gradient">渐变背景</option>
                  <option value="custom">自定义</option>
                </select>
                <input value={draft.heroScene.angle} onChange={e => setDraftSafe(prev => ({ ...prev, heroScene: { ...prev.heroScene, angle: e.target.value } }))} placeholder="角度 (如: 45度)" className="rounded-lg border border-[var(--border-color)] bg-[var(--bg-primary)] px-2 py-1.5 text-xs flex-1" />
              </div>
              {draft.heroScene.backgroundType === 'custom' && (
                <input value={draft.heroScene.customBackground} onChange={e => setDraftSafe(prev => ({ ...prev, heroScene: { ...prev.heroScene, customBackground: e.target.value } }))} placeholder="自定义背景描述..." className="w-full rounded-lg border border-[var(--border-color)] bg-[var(--bg-primary)] px-2 py-1.5 text-xs" />
              )}
              {/* Preview */}
              <div className="flex items-center justify-center rounded-xl border border-[var(--border-color)] bg-[var(--bg-secondary)] p-4 min-h-[400px]">
                {(() => {
                  const v = getActiveSelectedVariant()
                  if (!v) return <div className="text-sm text-[var(--text-secondary)] opacity-50">点击"生成主图"开始</div>
                  return <VariantThumb variant={v} className="max-h-[500px] max-w-full h-auto w-auto" />
                })()}
              </div>
              {/* Variant history */}
              {draft.heroScene.slot.variants.length > 1 && (
                <div className="flex gap-2 overflow-x-auto pb-2">
                  {draft.heroScene.slot.variants.map(v => (
                    <button key={v.id} onClick={() => setDraftSafe(prev => ({ ...prev, heroScene: { ...prev.heroScene, slot: { ...prev.heroScene.slot, selectedVariantId: v.id } } }))}
                      className={cn('flex-shrink-0 rounded-lg border-2 p-0.5', v.id === draft.heroScene.slot.selectedVariantId ? 'border-[var(--accent-color)]' : 'border-transparent')}>
                      <VariantThumb variant={v} className="h-16 w-16" />
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Detail Page Scene */}
          {activeScene === 'detail_page' && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold">详情页套图（9图）</h3>
                <Button onClick={handleGenerateDetailPage} disabled={generating} className="gap-1">
                  {generating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Wand2 className="h-4 w-4" />}
                  {generating ? '批量生成中...' : '一键生成 9 图'}
                </Button>
              </div>
              <div className="grid grid-cols-3 gap-3">
                {draft.detailPageScene.images.map((img, i) => {
                  const v = img.slot.variants.find(x => x.id === img.slot.selectedVariantId) || img.slot.variants[img.slot.variants.length - 1]
                  const roleLabel = ECOM_DETAIL_ROLES.find(r => r.role === img.role)?.label || img.role
                  return (
                    <div key={img.id} className="rounded-xl border border-[var(--border-color)] bg-[var(--bg-secondary)] p-2">
                      <div className="text-[10px] font-medium text-[var(--text-secondary)] mb-1">{i + 1}. {roleLabel}</div>
                      <div className="aspect-[3/4] rounded-lg overflow-hidden bg-[var(--bg-tertiary)] flex items-center justify-center">
                        {v ? <VariantThumb variant={v} className="h-full w-full" /> : <span className="text-xs text-[var(--text-secondary)] opacity-40">待生成</span>}
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          )}

          {/* Try-On Scene */}
          {activeScene === 'try_on' && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold">模特换装 / 虚拟试穿</h3>
                <Button onClick={handleAddTryOn} className="gap-1"><Plus className="h-4 w-4" /> 新增试穿</Button>
              </div>
              {draft.tryOnScenes.length === 0 && (
                <div className="text-center py-12 text-sm text-[var(--text-secondary)] opacity-50">点击"新增试穿"，上传模特照+服装图</div>
              )}
              {draft.tryOnScenes.map((scene, idx) => {
                const humanV = scene.humanImageSlot.variants[0]
                const clothV = scene.clothImageSlot.variants[0]
                const resultV = scene.resultSlot.variants.find(v => v.id === scene.resultSlot.selectedVariantId) || scene.resultSlot.variants[scene.resultSlot.variants.length - 1]
                return (
                  <div key={scene.id} className="rounded-xl border border-[var(--border-color)] bg-[var(--bg-secondary)] p-4">
                    <div className="flex items-center justify-between mb-3">
                      <span className="text-xs font-semibold">试穿 #{idx + 1}</span>
                      <div className="flex gap-2">
                        <Button size="sm" onClick={() => handleRunTryOn(idx)} disabled={generating} className="gap-1">
                          {generating ? <Loader2 className="h-3 w-3 animate-spin" /> : <Wand2 className="h-3 w-3" />} 生成试穿
                        </Button>
                        <Button size="sm" variant="ghost" className="text-red-500" onClick={() => setDraftSafe(prev => ({ ...prev, tryOnScenes: prev.tryOnScenes.filter((_, i) => i !== idx) }))}>
                          <Trash2 className="h-3 w-3" />
                        </Button>
                      </div>
                    </div>
                    <div className="grid grid-cols-3 gap-3">
                      <div>
                        <div className="text-[10px] text-[var(--text-secondary)] mb-1">模特照片</div>
                        <label className="block aspect-[3/4] rounded-lg border-2 border-dashed border-[var(--border-color)] bg-[var(--bg-tertiary)] cursor-pointer overflow-hidden flex items-center justify-center">
                          {humanV ? <VariantThumb variant={humanV} className="h-full w-full" /> : <Upload className="h-6 w-6 text-[var(--text-secondary)] opacity-30" />}
                          <input type="file" accept="image/*" className="hidden" onChange={e => handleTryOnUpload(idx, 'humanImageSlot', e)} />
                        </label>
                      </div>
                      <div>
                        <div className="text-[10px] text-[var(--text-secondary)] mb-1">服装图片</div>
                        <label className="block aspect-[3/4] rounded-lg border-2 border-dashed border-[var(--border-color)] bg-[var(--bg-tertiary)] cursor-pointer overflow-hidden flex items-center justify-center">
                          {clothV ? <VariantThumb variant={clothV} className="h-full w-full" /> : <Upload className="h-6 w-6 text-[var(--text-secondary)] opacity-30" />}
                          <input type="file" accept="image/*" className="hidden" onChange={e => handleTryOnUpload(idx, 'clothImageSlot', e)} />
                        </label>
                      </div>
                      <div>
                        <div className="text-[10px] text-[var(--text-secondary)] mb-1">试穿效果</div>
                        <div className="aspect-[3/4] rounded-lg bg-[var(--bg-tertiary)] overflow-hidden flex items-center justify-center">
                          {resultV ? <VariantThumb variant={resultV} className="h-full w-full" /> : <span className="text-xs text-[var(--text-secondary)] opacity-30">待生成</span>}
                        </div>
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          )}

          {/* Poster Scene */}
          {activeScene === 'poster' && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold">营销海报</h3>
                <Button onClick={handleAddPoster} className="gap-1"><Plus className="h-4 w-4" /> 新增海报</Button>
              </div>
              {draft.posterScenes.length === 0 && (
                <div className="text-center py-12 text-sm text-[var(--text-secondary)] opacity-50">点击"新增海报"开始创建</div>
              )}
              {draft.posterScenes.map((poster, idx) => {
                const v = poster.slot.variants.find(x => x.id === poster.slot.selectedVariantId) || poster.slot.variants[poster.slot.variants.length - 1]
                return (
                  <div key={poster.id} className="rounded-xl border border-[var(--border-color)] bg-[var(--bg-secondary)] p-4">
                    <div className="flex items-center justify-between mb-3">
                      <span className="text-xs font-semibold">海报 #{idx + 1}</span>
                      <div className="flex gap-2">
                        <Button size="sm" onClick={() => handleGeneratePoster(idx)} disabled={generating} className="gap-1">
                          {generating ? <Loader2 className="h-3 w-3 animate-spin" /> : <Wand2 className="h-3 w-3" />} 生成
                        </Button>
                        <Button size="sm" variant="ghost" className="text-red-500" onClick={() => setDraftSafe(prev => ({ ...prev, posterScenes: prev.posterScenes.filter((_, i) => i !== idx) }))}>
                          <Trash2 className="h-3 w-3" />
                        </Button>
                      </div>
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <div className="space-y-2">
                        <select value={poster.campaign} onChange={e => setDraftSafe(prev => { const s = [...prev.posterScenes]; s[idx] = { ...s[idx], campaign: e.target.value as any }; return { ...prev, posterScenes: s } })} className="w-full rounded-lg border border-[var(--border-color)] bg-[var(--bg-primary)] px-2 py-1.5 text-xs">
                          <option value="double_11">双11大促</option>
                          <option value="618">618年中</option>
                          <option value="new_year">新年特惠</option>
                          <option value="black_friday">黑色星期五</option>
                          <option value="custom">自定义活动</option>
                        </select>
                        <input value={poster.headline} onChange={e => setDraftSafe(prev => { const s = [...prev.posterScenes]; s[idx] = { ...s[idx], headline: e.target.value }; return { ...prev, posterScenes: s } })} placeholder="主标题" className="w-full rounded-lg border border-[var(--border-color)] bg-[var(--bg-primary)] px-2 py-1.5 text-xs" />
                        <input value={poster.discountText} onChange={e => setDraftSafe(prev => { const s = [...prev.posterScenes]; s[idx] = { ...s[idx], discountText: e.target.value }; return { ...prev, posterScenes: s } })} placeholder="折扣 (如: 5折)" className="w-full rounded-lg border border-[var(--border-color)] bg-[var(--bg-primary)] px-2 py-1.5 text-xs" />
                        <input value={poster.ctaText} onChange={e => setDraftSafe(prev => { const s = [...prev.posterScenes]; s[idx] = { ...s[idx], ctaText: e.target.value }; return { ...prev, posterScenes: s } })} placeholder="行动按钮 (如: 立即抢购)" className="w-full rounded-lg border border-[var(--border-color)] bg-[var(--bg-primary)] px-2 py-1.5 text-xs" />
                      </div>
                      <div className="aspect-[9/16] rounded-lg bg-[var(--bg-tertiary)] overflow-hidden flex items-center justify-center">
                        {v ? <VariantThumb variant={v} className="h-full w-full" /> : <Megaphone className="h-8 w-8 text-[var(--text-secondary)] opacity-20" />}
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>

        {/* RIGHT: AI Refinement Chat */}
        <div className="flex w-80 flex-shrink-0 flex-col border-l border-[var(--border-color)]">
          <div className="p-3 border-b border-[var(--border-color)]">
            <div className="text-sm font-semibold text-[var(--text-primary)]">AI 微调助手</div>
            <div className="mt-0.5 text-[11px] text-[var(--text-secondary)]">描述修改需求，AI 优化提示词</div>
          </div>
          <div className="flex-1 overflow-y-auto p-3 space-y-3">
            {chatMessages.length === 0 && (
              <div className="text-center py-8 text-xs text-[var(--text-secondary)] opacity-50">
                输入修改需求，如：<br />"背景换成大理石纹理"<br />"增加暖色调滤镜"<br />"换个更高级的角度"
              </div>
            )}
            {chatMessages.map((msg, i) => (
              <div key={i} className={cn('rounded-lg px-3 py-2 text-xs', msg.role === 'user' ? 'bg-[var(--accent-color)]/10 text-[var(--text-primary)] ml-6' : 'bg-[var(--bg-secondary)] text-[var(--text-primary)] mr-6')}>
                <pre className="whitespace-pre-wrap font-sans">{msg.content || (chatStreaming && i === chatMessages.length - 1 ? '思考中...' : '')}</pre>
              </div>
            ))}
          </div>
          <div className="p-3 border-t border-[var(--border-color)]">
            <div className="flex gap-2">
              <input
                value={chatInput}
                onChange={e => setChatInput(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSendChat() } }}
                placeholder="描述你想要的修改..."
                disabled={chatStreaming}
                className="flex-1 rounded-lg border border-[var(--border-color)] bg-[var(--bg-primary)] px-2 py-1.5 text-xs focus:border-[var(--accent-color)] focus:outline-none disabled:opacity-50"
              />
              <Button size="sm" onClick={handleSendChat} disabled={chatStreaming || !chatInput.trim()}>
                {chatStreaming ? <Loader2 className="h-3 w-3 animate-spin" /> : '发送'}
              </Button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
