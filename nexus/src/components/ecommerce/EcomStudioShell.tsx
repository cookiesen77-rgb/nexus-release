/**
 * EcomStudioShell - 电商工具台页面壳
 * 精简壳组件：状态管理 + 布局路由 + 子组件编排
 */
import React, { useState, useCallback, useRef, useEffect, useMemo } from 'react'
import type { EcomDraftV1, EcomSceneType, EcomMediaVariant } from '@/lib/ecommerce/types'
import { loadDraft, saveDraft, createDefaultDraft, listProjects, createProject, deleteProject, duplicateProject, touchProject, recoverMediaUrls } from '@/lib/ecommerce/draftStorage'
import type { EcomProjectMeta } from '@/lib/ecommerce/draftStorage'
import type { EcomStudioPrefsV1 } from '@/lib/ecommerce/uiPrefs'
import { loadPrefs, savePrefs } from '@/lib/ecommerce/uiPrefs'
import { getTemplatesByScene } from '@/lib/ecommerce/templates'
import type { EcomTemplate } from '@/lib/ecommerce/templates'
import { useGraphStore } from '@/graph/store'

import EcomProjectHeader from './EcomProjectHeader'
import EcomProductSidebar from './EcomProductSidebar'
import EcomChatPanel from './EcomChatPanel'
import EcomMediaPickerModal from './EcomMediaPickerModal'
import type { EcomPickedMedia } from './EcomMediaPickerModal'
import EcomHeroScene from './scenes/EcomHeroScene'
import EcomDetailScene from './scenes/EcomDetailScene'
import EcomTryOnScene from './scenes/EcomTryOnScene'
import EcomPosterScene from './scenes/EcomPosterScene'
import EcomVideoScene from './scenes/EcomVideoScene'
import EcomBatchScene from './scenes/EcomBatchScene'
import EcomMotionControlScene from './scenes/EcomMotionControlScene'
import EcomMultiElementsScene from './scenes/EcomMultiElementsScene'
import EcomDigitalHumanScene from './scenes/EcomDigitalHumanScene'

interface Props {
  projectId: string
  onRequestClose?: () => void
}

const LAST_PID_KEY = 'nexus-ecom-studio-last-project-id'

export default function EcomStudioShell({ projectId, onRequestClose }: Props) {
  // ===== Project ID =====
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

  // ===== Projects =====
  const [projects, setProjects] = useState<EcomProjectMeta[]>(() => listProjects())
  const refreshProjects = useCallback(() => setProjects(listProjects()), [])

  // ===== Draft + Prefs =====
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

  // ===== Persistence =====
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

  // ===== Recover media from IndexedDB (images stripped during save) =====
  useEffect(() => {
    let cancelled = false
    recoverMediaUrls(draftRef.current).then(({ changed, draft: recovered }) => {
      if (!cancelled && changed) {
        draftRef.current = recovered
        setDraft({ ...recovered })
      }
    }).catch(() => {})
    return () => { cancelled = true }
  }, [pid])

  // ===== Project switching =====
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

  // ===== Scene / Template =====
  const activeScene = draft.activeScene || 'hero'
  const setActiveScene = useCallback((s: EcomSceneType) => {
    setDraftSafe(prev => ({ ...prev, activeScene: s }))
  }, [setDraftSafe])

  const templates = useMemo(() => getTemplatesByScene(activeScene), [activeScene])
  const [selectedTemplate, setSelectedTemplate] = useState<EcomTemplate | null>(null)

  const handleApplyTemplate = useCallback((t: EcomTemplate) => {
    setSelectedTemplate(t)
    if (t.sceneType === 'hero') {
      const bgType = t.id.includes('scene') ? 'scene' : t.id.includes('gradient') ? 'gradient' : 'white'
      const angle = t.id.includes('45') ? '45度' : t.id.includes('front') ? '正面' : ''
      setDraftSafe(prev => ({ ...prev, heroScene: { ...prev.heroScene, backgroundType: bgType as any, angle: angle || prev.heroScene.angle, prompt: t.promptHint } }))
    } else if (t.sceneType === 'batch') {
      setDraftSafe(prev => ({ ...prev, batchScene: { ...prev.batchScene, templateId: t.id, promptTemplate: t.promptHint || prev.batchScene.promptTemplate } }))
    }
    window.$message?.success?.(`已应用模板: ${t.name}`)
  }, [setDraftSafe])

  // ===== Project CRUD =====
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

  const handleSwitchProject = useCallback((nextId: string) => {
    flushNow()
    setCurrentProjectId(nextId)
  }, [flushNow, setCurrentProjectId])

  // ===== Media picker =====
  const [pickerOpen, setPickerOpen] = useState(false)
  const [pickerOpts, setPickerOpts] = useState<{ kinds: string[]; multiple?: boolean; onConfirm: (items: EcomPickedMedia[]) => void }>({ kinds: ['image'], onConfirm: () => {} })

  const openMediaPicker = useCallback((opts: { kinds: string[]; multiple?: boolean; onConfirm: (items: EcomPickedMedia[]) => void }) => {
    setPickerOpts(opts)
    setPickerOpen(true)
  }, [])

  // ===== Add to canvas =====
  const handleAddToCanvas = useCallback((url: string, label: string) => {
    try {
      const vp = (useGraphStore.getState() as any).viewport || { x: 0, y: 0, zoom: 1 }
      const cx = (-vp.x + 400) / vp.zoom
      const cy = (-vp.y + 300) / vp.zoom
      useGraphStore.getState().addNode('image', { x: cx, y: cy }, { url, sourceUrl: url, label })
      window.$message?.success?.('已添加到画布')
    } catch (err: any) {
      window.$message?.error?.('添加到画布失败')
    }
  }, [])

  // ===== Scene routing =====
  const sceneProps = { draft, setDraftSafe, onOpenMediaPicker: openMediaPicker, onAddToCanvas: handleAddToCanvas }

  return (
    <div className="flex h-screen w-full flex-col bg-[var(--bg-primary)] text-[var(--text-primary)]">
      <EcomProjectHeader
        draft={draft}
        setDraftSafe={setDraftSafe}
        currentProjectId={pid}
        projects={projects}
        onCreateProject={handleCreateProject}
        onDeleteProject={handleDeleteProject}
        onDuplicateProject={handleDuplicateProject}
        onSwitchProject={handleSwitchProject}
        onRequestClose={onRequestClose}
      />

      <div className="flex flex-1 overflow-hidden">
        <EcomProductSidebar
          draft={draft}
          setDraftSafe={setDraftSafe}
          activeScene={activeScene}
          onSetActiveScene={setActiveScene}
          templates={templates}
          selectedTemplate={selectedTemplate}
          onApplyTemplate={handleApplyTemplate}
        />

        <div className="flex flex-1 flex-col overflow-y-auto p-6">
          {activeScene === 'hero' && <EcomHeroScene {...sceneProps} />}
          {activeScene === 'detail_page' && <EcomDetailScene {...sceneProps} />}
          {activeScene === 'try_on' && <EcomTryOnScene {...sceneProps} />}
          {activeScene === 'poster' && <EcomPosterScene {...sceneProps} />}
          {activeScene === 'video' && <EcomVideoScene {...sceneProps} />}
          {activeScene === 'batch' && <EcomBatchScene {...sceneProps} />}
          {activeScene === 'motion_control' && <EcomMotionControlScene {...sceneProps} />}
          {activeScene === 'multi_elements' && <EcomMultiElementsScene {...sceneProps} />}
          {activeScene === 'digital_human' && <EcomDigitalHumanScene {...sceneProps} />}
        </div>

        <EcomChatPanel
          draft={draft}
          setDraftSafe={setDraftSafe}
          activeScene={activeScene}
          onOpenMediaPicker={openMediaPicker}
        />
      </div>

      <EcomMediaPickerModal
        open={pickerOpen}
        onClose={() => setPickerOpen(false)}
        kinds={pickerOpts.kinds as any}
        multiple={pickerOpts.multiple}
        onConfirm={(items: EcomPickedMedia[]) => { pickerOpts.onConfirm(items); setPickerOpen(false) }}
      />
    </div>
  )
}
