/**
 * EcomStudioShell - 电商工具台页面壳
 * 复用 ShortDramaStudioShell 的持久化+项目管理模式
 */
import React, { useState, useCallback, useRef, useEffect, useMemo } from 'react'
import { ShoppingBag, Plus, Copy, Trash2, ChevronDown, X, Image, LayoutGrid, Shirt, Megaphone, Loader2, Upload, Wand2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import type { EcomDraftV1, EcomSceneType, EcomMediaVariant } from '@/lib/ecommerce/types'
import { loadDraft, saveDraft, createDefaultDraft, listProjects, createProject, deleteProject, duplicateProject, touchProject } from '@/lib/ecommerce/draftStorage'
import type { EcomProjectMeta } from '@/lib/ecommerce/draftStorage'
import type { EcomStudioPrefsV1 } from '@/lib/ecommerce/uiPrefs'
import { loadPrefs, savePrefs } from '@/lib/ecommerce/uiPrefs'
import { getTemplatesByScene } from '@/lib/ecommerce/templates'
import type { EcomTemplate } from '@/lib/ecommerce/templates'
import { getMedia } from '@/lib/mediaStorage'
import { IMAGE_MODELS, DEFAULT_IMAGE_MODEL } from '@/config/models'

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

        {/* CENTER: Preview area */}
        <div className="flex flex-1 flex-col items-center justify-center overflow-y-auto p-8">
          <div className="text-center text-[var(--text-secondary)]">
            <ShoppingBag className="mx-auto mb-4 h-16 w-16 opacity-20" />
            <div className="text-lg font-medium">选择模板开始生成</div>
            <div className="mt-2 text-sm">从左侧选择模板，填写商品信息后点击生成</div>
          </div>
        </div>

        {/* RIGHT: AI refinement (placeholder) */}
        <div className="flex w-80 flex-shrink-0 flex-col border-l border-[var(--border-color)] overflow-y-auto">
          <div className="p-4 border-b border-[var(--border-color)]">
            <div className="text-sm font-semibold text-[var(--text-primary)]">AI 微调</div>
            <div className="mt-1 text-xs text-[var(--text-secondary)]">描述你想要的修改，AI 帮你优化提示词</div>
          </div>
          <div className="flex-1 flex items-center justify-center p-4">
            <div className="text-center text-xs text-[var(--text-secondary)] opacity-50">
              生成图片后可在此对话微调
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
