import React, { useCallback, useEffect, useMemo, useRef } from 'react'
import { useGraphStore } from '@/graph/store'
import { getNodeSize } from '@/graph/nodeSizing'
import { DEFAULT_IMAGE_MODEL, DEFAULT_VIDEO_MODEL, IMAGE_MODELS, VIDEO_MODELS } from '@/config/models'
import { saveMedia } from '@/lib/mediaStorage'
import { Type, Image, Video, Music, FileText, Clapperboard, Scissors } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'

const isTauri = typeof window !== 'undefined' && !!(window as any).__TAURI_INTERNALS__

type MenuOption = {
  type: string
  label: string
  desc?: string
  Icon: LucideIcon
  color: string
}

const OPTION_MAP: Record<string, MenuOption[]> = {
  text: [
    { type: 'imageConfig', label: '文生图', desc: '文本转图片', Icon: Image, color: '#22c55e' },
    { type: 'videoConfig', label: '文生视频', desc: '文本转视频', Icon: Video, color: '#f59e0b' },
    { type: 'audio', label: '文生音乐', Icon: Music, color: '#0ea5e9' },
  ],
  image: [
    { type: 'imageConfig', label: '图生图', desc: '以此图为参考生成', Icon: Image, color: '#22c55e' },
    { type: 'videoConfig', label: '图生视频', desc: '图片转视频', Icon: Video, color: '#f59e0b' },
    { type: 'text', label: '图片描述', desc: '反推图片提示词', Icon: FileText, color: '#3b82f6' },
  ],
  video: [
    { type: 'image', label: '视频截帧', Icon: Scissors, color: '#8b5cf6' },
    { type: 'videoConfig', label: '视频续生', desc: '基于此视频延续', Icon: Clapperboard, color: '#f59e0b' },
    { type: 'text', label: '视频描述', Icon: FileText, color: '#3b82f6' },
  ],
  imageConfig: [
    { type: 'text', label: '文本生成', Icon: Type, color: '#3b82f6' },
    { type: 'imageConfig', label: '图片生成', Icon: Image, color: '#22c55e' },
    { type: 'videoConfig', label: '视频生成', Icon: Video, color: '#f59e0b' },
    { type: 'audio', label: '音频', Icon: Music, color: '#0ea5e9' },
  ],
  videoConfig: [
    { type: 'text', label: '文本生成', Icon: Type, color: '#3b82f6' },
    { type: 'imageConfig', label: '图片生成', Icon: Image, color: '#22c55e' },
    { type: 'videoConfig', label: '视频生成', Icon: Video, color: '#f59e0b' },
  ],
}

const DEFAULT_OPTIONS: MenuOption[] = [
  { type: 'text', label: '文本生成', Icon: Type, color: '#3b82f6' },
  { type: 'imageConfig', label: '图片生成', Icon: Image, color: '#22c55e' },
  { type: 'videoConfig', label: '视频生成', Icon: Video, color: '#f59e0b' },
  { type: 'audio', label: '音频', Icon: Music, color: '#0ea5e9' },
]

export interface HandleDropMenuState {
  x: number
  y: number
  flowX: number
  flowY: number
  sourceNodeId: string
  sourceNodeType: string
}

interface HandleDropMenuProps {
  menu: HandleDropMenuState | null
  onClose: () => void
}

export default function HandleDropMenu({ menu, onClose }: HandleDropMenuProps) {
  const rootRef = useRef<HTMLDivElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const pendingTypeRef = useRef<string | null>(null)
  const pendingInfoRef = useRef<{ flowX: number; flowY: number; sourceNodeId: string } | null>(null)

  const options = useMemo(() => {
    if (!menu) return DEFAULT_OPTIONS
    return OPTION_MAP[menu.sourceNodeType] || DEFAULT_OPTIONS
  }, [menu?.sourceNodeType])

  const style = useMemo<React.CSSProperties>(() => {
    if (!menu) return { display: 'none' }
    const MENU_W = 260
    const MENU_H_EST = 40 + options.length * 52
    const PAD = 12
    return {
      left: Math.max(PAD, Math.min(menu.x, window.innerWidth - MENU_W - PAD)),
      top: Math.max(PAD, Math.min(menu.y, window.innerHeight - MENU_H_EST - PAD)),
    }
  }, [menu, options.length])

  useEffect(() => {
    if (!menu) return
    const onDown = (e: PointerEvent) => {
      if (rootRef.current?.contains(e.target as Node)) return
      onClose()
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('pointerdown', onDown, { capture: true })
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('pointerdown', onDown, { capture: true } as EventListenerOptions)
      window.removeEventListener('keydown', onKey)
    }
  }, [menu, onClose])

  const handleFileSelect = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    const type = pendingTypeRef.current
    const info = pendingInfoRef.current

    if (!file || !type || !info) {
      pendingTypeRef.current = null
      pendingInfoRef.current = null
      e.target.value = ''
      return
    }

    const { flowX, flowY, sourceNodeId } = info
    const { w, h } = getNodeSize(type)
    const pos = { x: flowX - w * 0.5, y: flowY - h * 0.5 }

    const reader = new FileReader()
    reader.onload = async (event) => {
      const dataUrl = event.target?.result as string
      if (!dataUrl) return

      const store = useGraphStore.getState()
      const newNodeId = store.addNode(type, pos, {
        label: file.name || (type === 'image' ? '图片' : type === 'video' ? '视频' : '音频'),
        url: dataUrl,
        sourceUrl: '',
        fileName: file.name,
        fileType: file.type,
        createdAt: Date.now(),
        _fromWorkflow: true,
      })

      store.addEdge(sourceNodeId, newNodeId, { sourceHandle: 'right', targetHandle: 'left' })
      store.setSelected(newNodeId)

      const projectId = store.projectId || 'default'
      try {
        const mediaId = await saveMedia({ nodeId: newNodeId, projectId, type: type as 'image' | 'video' | 'audio', data: dataUrl })
        if (mediaId) store.patchNodeDataSilent(newNodeId, { mediaId })
      } catch {
        // ignore
      }
    }
    reader.readAsDataURL(file)

    pendingTypeRef.current = null
    pendingInfoRef.current = null
    e.target.value = ''
  }, [])

  const triggerFileUpload = useCallback(async (type: string, info: { flowX: number; flowY: number; sourceNodeId: string }) => {
    pendingTypeRef.current = type
    pendingInfoRef.current = info
    onClose()

    let filters: Array<{ name: string; extensions: string[] }> = []
    let accept = ''
    if (type === 'image') {
      accept = 'image/*'
      filters = [{ name: '图片文件', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'svg'] }]
    } else if (type === 'video') {
      accept = 'video/*'
      filters = [{ name: '视频文件', extensions: ['mp4', 'webm', 'mov', 'avi', 'mkv'] }]
    } else if (type === 'audio') {
      accept = 'audio/*'
      filters = [{ name: '音频文件', extensions: ['mp3', 'wav', 'ogg', 'flac', 'aac', 'm4a'] }]
    }

    if (isTauri) {
      try {
        const { open } = await import('@tauri-apps/plugin-dialog')
        const { readFile } = await import('@tauri-apps/plugin-fs')

        const result = await open({ multiple: false, filters, title: type === 'image' ? '选择图片' : type === 'video' ? '选择视频' : '选择音频' })

        if (result && typeof result === 'string') {
          const fileData = await readFile(result)
          const fileName = result.split('/').pop() || result.split('\\').pop() || 'file'
          const ext = fileName.split('.').pop()?.toLowerCase() || ''

          const mimeMap: Record<string, Record<string, string>> = {
            image: { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', bmp: 'image/bmp', svg: 'image/svg+xml' },
            video: { mp4: 'video/mp4', webm: 'video/webm', mov: 'video/quicktime', avi: 'video/x-msvideo', mkv: 'video/x-matroska' },
            audio: { mp3: 'audio/mpeg', wav: 'audio/wav', ogg: 'audio/ogg', flac: 'audio/flac', aac: 'audio/aac', m4a: 'audio/mp4' },
          }
          const defaultMime: Record<string, string> = { image: 'image/png', video: 'video/mp4', audio: 'audio/mpeg' }
          const mimeType = mimeMap[type]?.[ext] || defaultMime[type] || ''

          const blob = new Blob([fileData], { type: mimeType })
          const dataUrl = await new Promise<string>((resolve) => {
            const reader = new FileReader()
            reader.onload = () => resolve(reader.result as string)
            reader.readAsDataURL(blob)
          })

          const { flowX, flowY, sourceNodeId } = info
          const { w, h } = getNodeSize(type)
          const pos = { x: flowX - w * 0.5, y: flowY - h * 0.5 }

          const store = useGraphStore.getState()
          const newNodeId = store.addNode(type, pos, {
            label: fileName,
            url: dataUrl,
            sourceUrl: '',
            fileName,
            fileType: mimeType,
            createdAt: Date.now(),
            _fromWorkflow: true,
          })

          store.addEdge(sourceNodeId, newNodeId, { sourceHandle: 'right', targetHandle: 'left' })
          store.setSelected(newNodeId)

          const projectId = store.projectId || 'default'
          try {
            const mediaId = await saveMedia({ nodeId: newNodeId, projectId, type: type as 'image' | 'video' | 'audio', data: dataUrl })
            if (mediaId) store.patchNodeDataSilent(newNodeId, { mediaId })
          } catch {
            // ignore
          }
        }
      } catch (err) {
        console.error('[HandleDropMenu] Tauri 文件选择失败:', err)
        window.$message?.error?.('文件选择失败，请重试')
      }
      pendingTypeRef.current = null
      pendingInfoRef.current = null
    } else {
      if (fileInputRef.current) {
        fileInputRef.current.accept = accept
        fileInputRef.current.click()
      }
    }
  }, [onClose])

  const spawnNode = useCallback((type: string) => {
    if (!menu) return
    const { flowX, flowY, sourceNodeId } = menu

    if (type === 'image' || type === 'video' || type === 'audio') {
      triggerFileUpload(type, { flowX, flowY, sourceNodeId })
      return
    }

    const { w, h } = getNodeSize(type)
    const pos = { x: flowX - w * 0.5, y: flowY - h * 0.5 }

    const store = useGraphStore.getState()
    const data: Record<string, unknown> = {
      label: type === 'text' ? '文本'
        : type === 'imageConfig' ? '图片生成'
        : type === 'videoConfig' ? '视频生成'
        : type === 'audio' ? '音频'
        : type,
      _fromWorkflow: true,
    }

    if (type === 'imageConfig') {
      const cfg: any = (IMAGE_MODELS as any[]).find((m: any) => m.key === DEFAULT_IMAGE_MODEL) || (IMAGE_MODELS as any[])[0]
      data.model = DEFAULT_IMAGE_MODEL
      if (cfg?.defaultParams?.size) data.size = cfg.defaultParams.size
      if (cfg?.defaultParams?.quality) data.quality = cfg.defaultParams.quality
    }
    if (type === 'videoConfig') {
      const cfg: any = (VIDEO_MODELS as any[]).find((m: any) => m.key === DEFAULT_VIDEO_MODEL) || (VIDEO_MODELS as any[])[0]
      data.model = DEFAULT_VIDEO_MODEL
      if (cfg?.defaultParams?.ratio) data.ratio = cfg.defaultParams.ratio
      if (cfg?.defaultParams?.duration) data.dur = cfg.defaultParams.duration
      if (cfg?.defaultParams?.size) data.size = cfg.defaultParams.size
    }

    const newNodeId = store.addNode(type, pos, data)
    store.addEdge(sourceNodeId, newNodeId, { sourceHandle: 'right', targetHandle: 'left' })
    store.setSelected(newNodeId)
    onClose()
  }, [menu, onClose, triggerFileUpload])

  const fileInput = <input ref={fileInputRef} type="file" className="hidden" onChange={handleFileSelect} />

  if (!menu) return fileInput

  return (
    <>
      <div
        ref={rootRef}
        className="fixed z-[9999] w-[260px] rounded-2xl border border-[var(--border-color)] bg-[var(--bg-secondary)] shadow-2xl py-2 overflow-hidden hdm-enter"
        style={{ ...style, backdropFilter: 'blur(20px)' }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-4 py-2 text-xs text-[var(--text-secondary)] font-medium">引用该节点生成</div>
        {options.map((opt) => (
          <button
            key={opt.type}
            onClick={() => spawnNode(opt.type)}
            className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-[var(--bg-tertiary)] transition-colors"
          >
            <opt.Icon className="h-5 w-5 shrink-0" style={{ color: opt.color }} />
            <div className="flex flex-col">
              <span className="text-sm text-[var(--text-primary)] font-medium">{opt.label}</span>
              {opt.desc && <span className="text-xs text-[var(--text-secondary)]">{opt.desc}</span>}
            </div>
          </button>
        ))}
      </div>
      {fileInput}
    </>
  )
}
