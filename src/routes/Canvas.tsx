import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useLocation, useNavigate, useParams } from 'react-router-dom'
import { shallow } from 'zustand/shallow'
import SettingsDialog from '@/components/SettingsDialog'
import { useGraphStore } from '@/graph/store'
import type { Viewport } from '@/graph/types'
import WebGLGraphCanvas from '@/components/canvas/WebGLGraphCanvas'
import DOMGraphCanvas from '@/components/canvas/DOMGraphCanvas'
import ReactFlowCanvas, { type ConnectEndEvent } from '@/components/canvas/ReactFlowCanvas'
import CanvasSidebar, { type CanvasTool } from '@/components/canvas/CanvasSidebar'
import NodePalettePanel from '@/components/canvas/NodePalettePanel'
import NodeCardsLayer from '@/components/canvas/NodeCardsLayer'
import EdgeOverlayLayer from '@/components/canvas/EdgeOverlayLayer'
import EventCoordinator from '@/components/canvas/EventCoordinator'
import CanvasContextMenu, { type CanvasContextPayload } from '@/components/canvas/CanvasContextMenu'
import CanvasHud from '@/components/canvas/CanvasHud'
import { DEFAULT_IMAGE_MODEL, DEFAULT_VIDEO_MODEL, IMAGE_MODELS, VIDEO_MODELS } from '@/config/models'
import { useProjectsStore } from '@/store/projects'
import { useAssetsStore } from '@/store/assets'
import { syncAssetHistoryFromCanvasNodes } from '@/lib/assets/syncFromCanvas'
import CanvasAssistantDrawer from '@/components/canvas/CanvasAssistantDrawer'
import NodeRemarkModal from '@/components/canvas/NodeRemarkModal'
import DownloadModal from '@/components/canvas/DownloadModal'
import HistoryPanel from '@/components/canvas/HistoryPanel'
import PromptLibraryModal from '@/components/canvas/PromptLibraryModal'
import WorkflowTemplatesModal from '@/components/canvas/WorkflowTemplatesModal'
import DirectorConsole from '@/components/canvas/DirectorConsole'
import SketchEditor from '@/components/canvas/SketchEditor'
import SonicStudio from '@/components/canvas/SonicStudio'
import BlendToolPanel from '@/components/canvas/BlendToolPanel'
import PromptReverseModal from '@/components/canvas/PromptReverseModal'
import CameraControlModal from '@/components/cameraControl/CameraControlModal'
import { getWorkflowById } from '@/config/workflows'
import { getNodeSize } from '@/graph/nodeSizing'
import { useSettingsStore } from '@/store/settings'
import { saveMedia } from '@/lib/mediaStorage'
import { ChevronDown, ChevronLeft, Download, History, Moon, Play, Settings, Sun, Type, SlidersHorizontal, Settings2, Image, Video, Music } from 'lucide-react'
import { generateImageFromConfigNode } from '@/lib/workflow/image'
import { generateVideoFromConfigNode } from '@/lib/workflow/video'
import { saveCurrentAsTemplate } from '@/lib/workflowTemplates'

// 功能开关
// USE_REACT_FLOW: 使用 React Flow（推荐，完全对齐 Huobao 架构）
// USE_DOM_CANVAS: 使用纯 DOM 画布
// USE_NEW_EVENT_SYSTEM: 使用新事件协调层（实验性）
const USE_REACT_FLOW = true   // 使用 React Flow（60fps 性能保证）
const USE_DOM_CANVAS = false  // 改为 false，使用 React Flow 代替
const USE_NEW_EVENT_SYSTEM = false

// 检测 Tauri 环境
const isTauri = typeof window !== 'undefined' && !!(window as any).__TAURI_INTERNALS__
const USE_SPATIAL_INDEX = true

export default function Canvas() {
  const { id } = useParams()
  const location = useLocation()
  const nav = useNavigate()
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [isInteracting, setIsInteracting] = useState(false)
  const [transientViewport, setTransientViewport] = useState<Viewport | null>(null)
  const [tool, setTool] = useState<CanvasTool>('select')
  const [nodeMenuOpen, setNodeMenuOpen] = useState(false)
  const [assistantOpen, setAssistantOpen] = useState(false)
  const [spawnAt, setSpawnAt] = useState<{ x: number; y: number } | null>(null)
  const [ctxOpen, setCtxOpen] = useState(false)
  const [ctxPayload, setCtxPayload] = useState<CanvasContextPayload | null>(null)
  const [remarkNodeId, setRemarkNodeId] = useState<string | null>(null)
  const [downloadModalOpen, setDownloadModalOpen] = useState(false)
  const [historyPanelOpen, setHistoryPanelOpen] = useState(false)
  const [promptLibraryOpen, setPromptLibraryOpen] = useState(false)
  const [workflowTemplatesOpen, setWorkflowTemplatesOpen] = useState(false)
  const [directorOpen, setDirectorOpen] = useState(false)
  const [sketchOpen, setSketchOpen] = useState(false)
  const [audioOpen, setAudioOpen] = useState(false)
  const [blendToolOpen, setBlendToolOpen] = useState(false)
  const [promptReverseOpen, setPromptReverseOpen] = useState(false)
  const [cameraControlOpen, setCameraControlOpen] = useState(false)
  const [batchGenerating, setBatchGenerating] = useState(false)
  const [saveTemplateOpen, setSaveTemplateOpen] = useState(false)
  const [saveTemplateName, setSaveTemplateName] = useState('')
  const [saveTemplateDesc, setSaveTemplateDesc] = useState('')
  
  // 兼容：从剪辑台返回时自动打开“短剧制作”（已从 Modal 升级为全屏页面）
  useEffect(() => {
    const search = String(location.search || '')
    if (!search) return
    const sp = new URLSearchParams(search)
    const open = String(sp.get('openShortDrama') || '').trim()
    if (open !== '1' && open.toLowerCase() !== 'true') return
    const pid = String(id || '').trim() || 'default'

    sp.delete('openShortDrama')
    const next = sp.toString()
    const target = `/short-drama/${pid}${next ? `?${next}` : ''}`
    nav(target, { replace: true })
  }, [id, location.search, nav])

  // 右键菜单状态（画布空白处）
  const [canvasContextMenu, setCanvasContextMenu] = useState<{
    x: number      // 屏幕坐标（用于菜单定位）
    y: number
    flowX: number  // 画布坐标（用于节点创建）
    flowY: number
  } | null>(null)
  
  // 连接线拖拽菜单状态
  const [connectMenu, setConnectMenu] = useState<{
    x: number           // 屏幕坐标
    y: number
    flowX: number       // 画布坐标
    flowY: number
    sourceNodeId: string
    sourceNodeType: string
  } | null>(null)

  // 连接菜单文件选择器
  const connectMenuFileInputRef = useRef<HTMLInputElement | null>(null)
  const connectMenuPendingTypeRef = useRef<string | null>(null)
  
  // 右键菜单文件选择器
  const contextMenuFileInputRef = useRef<HTMLInputElement | null>(null)
  const contextMenuPendingTypeRef = useRef<string | null>(null)
  const contextMenuPendingPosRef = useRef<{ flowX: number; flowY: number } | null>(null)
  const connectMenuPendingInfoRef = useRef<{ flowX: number; flowY: number; sourceNodeId: string } | null>(null)

  // 一键全部生成（并发）
  const handleBatchGenerate = useCallback(async () => {
    const store = useGraphStore.getState()
    const nodes = store.nodes
    
    // 找到所有需要生成的配置节点
    const imageConfigs = nodes.filter((n) => {
      if (n.type !== 'imageConfig') return false
      const d: any = n.data || {}
      // 跳过正在生成的节点
      if (d.loading || d.status === 'running') return false
      return true
    })
    
    const videoConfigs = nodes.filter((n) => {
      if (n.type !== 'videoConfig') return false
      const d: any = n.data || {}
      // 跳过正在生成的节点
      if (d.loading || d.status === 'running') return false
      return true
    })
    
    const total = imageConfigs.length + videoConfigs.length
    if (total === 0) {
      window.$message?.info?.('没有找到可生成的配置节点')
      return
    }
    
    setBatchGenerating(true)
    window.$message?.info?.(`开始并发生成 ${total} 个节点...`)
    
    // 创建所有生成任务
    const tasks: Promise<{ success: boolean; nodeId: string; type: string }>[] = []
    
    // 图片生成任务
    for (const node of imageConfigs) {
      tasks.push(
        generateImageFromConfigNode(node.id)
          .then(() => ({ success: true, nodeId: node.id, type: 'image' }))
          .catch((err) => {
            console.error(`[BatchGenerate] 图片生成失败:`, node.id, err?.message)
            return { success: false, nodeId: node.id, type: 'image' }
          })
      )
    }
    
    // 视频生成任务
    for (const node of videoConfigs) {
      tasks.push(
        generateVideoFromConfigNode(node.id)
          .then(() => ({ success: true, nodeId: node.id, type: 'video' }))
          .catch((err) => {
            console.error(`[BatchGenerate] 视频生成失败:`, node.id, err?.message)
            return { success: false, nodeId: node.id, type: 'video' }
          })
      )
    }
    
    // 并发执行所有任务
    const results = await Promise.all(tasks)
    
    const successCount = results.filter((r) => r.success).length
    const errorCount = results.filter((r) => !r.success).length
    
    setBatchGenerating(false)
    
    if (errorCount === 0) {
      window.$message?.success?.(`批量生成完成！成功 ${successCount} 个`)
    } else {
      window.$message?.warning?.(`批量生成完成：成功 ${successCount} 个，失败 ${errorCount} 个`)
    }
  }, [])

  // 保存为模板
  const handleSaveAsTemplate = useCallback(() => {
    setSaveTemplateName('')
    setSaveTemplateDesc('')
    setSaveTemplateOpen(true)
  }, [])

  const confirmSaveTemplate = useCallback(() => {
    const name = saveTemplateName.trim() || '未命名模板'
    const desc = saveTemplateDesc.trim() || undefined
    const result = saveCurrentAsTemplate(name, desc)
    if (result) {
      window.$message?.success?.(`模板「${result.name}」保存成功`)
      setSaveTemplateOpen(false)
    }
  }, [saveTemplateName, saveTemplateDesc])

  // 画布右键菜单 - 创建节点（仅在画布空白处触发）
  const handleCanvasContextMenu = useCallback((e: React.MouseEvent) => {
    const target = e.target as HTMLElement
    // 如果点击在节点、边、或其他 UI 元素上，不处理
    if (
      target.closest('.react-flow__node') ||
      target.closest('.react-flow__edge') ||
      target.closest('.image-node') ||
      target.closest('.video-node') ||
      target.closest('[data-context-menu]')
    ) {
      return
    }
    
    e.preventDefault()
    
    // 关闭原有的右键菜单
    setCtxOpen(false)
    setCtxPayload(null)
    
    // 计算画布坐标
    const vp = useGraphStore.getState().viewport
    const wrap = canvasWrapRef.current
    if (!wrap) return
    const rect = wrap.getBoundingClientRect()
    const z = vp.zoom || 1
    const flowX = (e.clientX - rect.left - vp.x) / z
    const flowY = (e.clientY - rect.top - vp.y) / z
    
    setCanvasContextMenu({
      x: e.clientX,
      y: e.clientY,
      flowX,
      flowY
    })
  }, [])

  // 右键菜单节点选项（不包含本地保存）
  const contextMenuNodeOptions = [
    { type: 'text', name: '文本节点', Icon: Type, color: '#3b82f6' },
    { type: 'imageConfig', name: '文生图配置', Icon: SlidersHorizontal, color: '#22c55e' },
    { type: 'videoConfig', name: '视频生成配置', Icon: Settings2, color: '#f59e0b' },
    { type: 'image', name: '图片节点', Icon: Image, color: '#8b5cf6' },
    { type: 'video', name: '视频节点', Icon: Video, color: '#ef4444' },
    { type: 'audio', name: '音频节点', Icon: Music, color: '#0ea5e9' }
  ]

  // 处理右键菜单文件选择
  const handleContextMenuFileSelect = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    const type = contextMenuPendingTypeRef.current
    const pos = contextMenuPendingPosRef.current
    
    if (!file || !type || !pos) {
      contextMenuPendingTypeRef.current = null
      contextMenuPendingPosRef.current = null
      e.target.value = ''
      return
    }
    
    const { flowX, flowY } = pos
    const { w, h } = getNodeSize(type)
    const nodePos = { x: flowX - w * 0.5, y: flowY - h * 0.5 }
    
    const reader = new FileReader()
    reader.onload = async (event) => {
      const dataUrl = event.target?.result as string
      if (!dataUrl) return
      
      const store = useGraphStore.getState()
      const newNodeId = store.addNode(type, nodePos, {
        label: file.name || (type === 'image' ? '图片' : type === 'video' ? '视频' : '音频'),
        url: dataUrl,
        sourceUrl: '',
        fileName: file.name,
        fileType: file.type,
        createdAt: Date.now()
      })
      
      store.setSelected(newNodeId)
      
      // 保存到 IndexedDB
      const projectId = store.projectId || 'default'
      try {
        const mediaId = await saveMedia({
          nodeId: newNodeId,
          projectId,
          type: type as 'image' | 'video' | 'audio',
          data: dataUrl,
        })
        if (mediaId) {
          store.patchNodeDataSilent(newNodeId, { mediaId })
        }
      } catch {
        // ignore
      }
    }
    reader.readAsDataURL(file)
    
    contextMenuPendingTypeRef.current = null
    contextMenuPendingPosRef.current = null
    e.target.value = ''
  }, [])

  // 触发右键菜单文件选择
  const triggerContextMenuFileUpload = useCallback(async (type: string, pos: { flowX: number; flowY: number }) => {
    contextMenuPendingTypeRef.current = type
    contextMenuPendingPosRef.current = pos
    setCanvasContextMenu(null)
    
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
        
        const result = await open({
          multiple: false,
          filters,
          title: type === 'image' ? '选择图片' : type === 'video' ? '选择视频' : '选择音频'
        })
        
        if (result && typeof result === 'string') {
          const fileData = await readFile(result)
          const fileName = result.split('/').pop() || result.split('\\').pop() || 'file'
          const ext = fileName.split('.').pop()?.toLowerCase() || ''
          
          let mimeType = ''
          if (type === 'image') {
            const mimeMap: Record<string, string> = { 
              png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', 
              gif: 'image/gif', webp: 'image/webp', bmp: 'image/bmp', svg: 'image/svg+xml' 
            }
            mimeType = mimeMap[ext] || 'image/png'
          } else if (type === 'video') {
            const mimeMap: Record<string, string> = { 
              mp4: 'video/mp4', webm: 'video/webm', mov: 'video/quicktime', 
              avi: 'video/x-msvideo', mkv: 'video/x-matroska' 
            }
            mimeType = mimeMap[ext] || 'video/mp4'
          } else if (type === 'audio') {
            const mimeMap: Record<string, string> = { 
              mp3: 'audio/mpeg', wav: 'audio/wav', ogg: 'audio/ogg', 
              flac: 'audio/flac', aac: 'audio/aac', m4a: 'audio/mp4' 
            }
            mimeType = mimeMap[ext] || 'audio/mpeg'
          }
          
          const blob = new Blob([fileData], { type: mimeType })
          const dataUrl = await new Promise<string>((resolve) => {
            const reader = new FileReader()
            reader.onload = () => resolve(reader.result as string)
            reader.readAsDataURL(blob)
          })
          
          const { flowX, flowY } = pos
          const { w, h } = getNodeSize(type)
          const nodePos = { x: flowX - w * 0.5, y: flowY - h * 0.5 }
          
          const store = useGraphStore.getState()
          const newNodeId = store.addNode(type, nodePos, {
            label: fileName,
            url: dataUrl,
            sourceUrl: '',
            fileName,
            fileType: mimeType,
            createdAt: Date.now()
          })
          
          store.setSelected(newNodeId)
          
          // 保存到 IndexedDB
          const projectId = store.projectId || 'default'
          try {
            const mediaId = await saveMedia({
              nodeId: newNodeId,
              projectId,
              type: type as 'image' | 'video' | 'audio',
              data: dataUrl,
            })
            if (mediaId) {
              store.patchNodeDataSilent(newNodeId, { mediaId })
            }
          } catch {
            // ignore
          }
        }
      } catch (err) {
        console.error('[Canvas] Tauri 文件选择失败:', err)
        window.$message?.error?.('文件选择失败，请重试')
      }
      contextMenuPendingTypeRef.current = null
      contextMenuPendingPosRef.current = null
    } else {
      // Web 环境
      if (contextMenuFileInputRef.current) {
        contextMenuFileInputRef.current.accept = accept
        contextMenuFileInputRef.current.click()
      }
    }
  }, [])

  const spawnNodeFromContextMenu = useCallback((type: string) => {
    if (!canvasContextMenu) return
    const { flowX, flowY } = canvasContextMenu
    
    // 图片/视频/音频节点需要先选择文件
    if (type === 'image' || type === 'video' || type === 'audio') {
      triggerContextMenuFileUpload(type, { flowX, flowY })
      return
    }
    
    const { w, h } = getNodeSize(type)
    const pos = { x: flowX - w * 0.5, y: flowY - h * 0.5 }
    
    const store = useGraphStore.getState()
    const data: Record<string, unknown> = { label: type === 'text' ? '文本' : type === 'imageConfig' ? '生图配置' : type === 'videoConfig' ? '视频配置' : type }
    
    if (type === 'imageConfig') {
      const baseModelCfg: any = (IMAGE_MODELS as any[]).find((m: any) => m.key === DEFAULT_IMAGE_MODEL) || (IMAGE_MODELS as any[])[0]
      data.model = DEFAULT_IMAGE_MODEL
      if (baseModelCfg?.defaultParams?.size) data.size = baseModelCfg.defaultParams.size
      if (baseModelCfg?.defaultParams?.quality) data.quality = baseModelCfg.defaultParams.quality
    }
    if (type === 'videoConfig') {
      const baseModelCfg: any = (VIDEO_MODELS as any[]).find((m: any) => m.key === DEFAULT_VIDEO_MODEL) || (VIDEO_MODELS as any[])[0]
      data.model = DEFAULT_VIDEO_MODEL
      if (baseModelCfg?.defaultParams?.ratio) data.ratio = baseModelCfg.defaultParams.ratio
      if (baseModelCfg?.defaultParams?.duration) data.dur = baseModelCfg.defaultParams.duration
      if (baseModelCfg?.defaultParams?.size) data.size = baseModelCfg.defaultParams.size
    }
    
    const id = store.addNode(type, pos, data)
    store.setSelected(id)
    setCanvasContextMenu(null)
  }, [canvasContextMenu, triggerContextMenuFileUpload])

  // 处理连接线拖拽结束（弹出节点选择菜单）
  const handleConnectEnd = useCallback((event: ConnectEndEvent) => {
    setConnectMenu({
      x: event.screenX,
      y: event.screenY,
      flowX: event.flowX,
      flowY: event.flowY,
      sourceNodeId: event.sourceNodeId,
      sourceNodeType: event.sourceNodeType,
    })
  }, [])

  // 根据来源节点类型过滤可选目标节点
  const getConnectMenuOptions = useCallback((sourceType: string) => {
    // 智能过滤：根据来源节点类型推荐合适的目标节点
    const allOptions = [
      { type: 'text', name: '文本节点', Icon: Type, color: '#3b82f6' },
      { type: 'imageConfig', name: '文生图配置', Icon: SlidersHorizontal, color: '#22c55e' },
      { type: 'videoConfig', name: '视频生成配置', Icon: Settings2, color: '#f59e0b' },
      { type: 'image', name: '图片节点', Icon: Image, color: '#8b5cf6' },
      { type: 'video', name: '视频节点', Icon: Video, color: '#ef4444' },
      { type: 'audio', name: '音频节点', Icon: Music, color: '#0ea5e9' }
    ]
    
    // 根据来源节点类型过滤
    switch (sourceType) {
      case 'text':
        // 文本节点 → 生图配置、视频配置
        return allOptions.filter(o => ['imageConfig', 'videoConfig'].includes(o.type))
      case 'imageConfig':
        // 生图配置 → 图片节点
        return allOptions.filter(o => o.type === 'image')
      case 'videoConfig':
        // 视频配置 → 视频节点
        return allOptions.filter(o => o.type === 'video')
      case 'image':
        // 图片节点 → 视频配置、生图配置（参考图）
        return allOptions.filter(o => ['videoConfig', 'imageConfig'].includes(o.type))
      default:
        // 其他情况显示所有选项
        return allOptions
    }
  }, [])

  // 处理连接菜单文件选择
  const handleConnectMenuFileSelect = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    const type = connectMenuPendingTypeRef.current
    const info = connectMenuPendingInfoRef.current
    
    if (!file || !type || !info) {
      connectMenuPendingTypeRef.current = null
      connectMenuPendingInfoRef.current = null
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
        createdAt: Date.now()
      })
      
      // 自动创建连接
      store.addEdge(sourceNodeId, newNodeId, {
        sourceHandle: 'right',
        targetHandle: 'left',
      })
      
      store.setSelected(newNodeId)
      
      // 保存到 IndexedDB
      const projectId = store.projectId || 'default'
      try {
        const mediaId = await saveMedia({
          nodeId: newNodeId,
          projectId,
          type: type as 'image' | 'video' | 'audio',
          data: dataUrl,
        })
        if (mediaId) {
          store.patchNodeDataSilent(newNodeId, { mediaId })
        }
      } catch {
        // ignore
      }
    }
    reader.readAsDataURL(file)
    
    connectMenuPendingTypeRef.current = null
    connectMenuPendingInfoRef.current = null
    e.target.value = ''
  }, [])

  // 触发连接菜单文件选择
  const triggerConnectMenuFileUpload = useCallback(async (type: string, info: { flowX: number; flowY: number; sourceNodeId: string }) => {
    connectMenuPendingTypeRef.current = type
    connectMenuPendingInfoRef.current = info
    setConnectMenu(null)
    
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
        
        const result = await open({
          multiple: false,
          filters,
          title: type === 'image' ? '选择图片' : type === 'video' ? '选择视频' : '选择音频'
        })
        
        if (result && typeof result === 'string') {
          const fileData = await readFile(result)
          const fileName = result.split('/').pop() || result.split('\\').pop() || 'file'
          const ext = fileName.split('.').pop()?.toLowerCase() || ''
          
          let mimeType = ''
          if (type === 'image') {
            const mimeMap: Record<string, string> = { 
              png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', 
              gif: 'image/gif', webp: 'image/webp', bmp: 'image/bmp', svg: 'image/svg+xml' 
            }
            mimeType = mimeMap[ext] || 'image/png'
          } else if (type === 'video') {
            const mimeMap: Record<string, string> = { 
              mp4: 'video/mp4', webm: 'video/webm', mov: 'video/quicktime', 
              avi: 'video/x-msvideo', mkv: 'video/x-matroska' 
            }
            mimeType = mimeMap[ext] || 'video/mp4'
          } else if (type === 'audio') {
            const mimeMap: Record<string, string> = { 
              mp3: 'audio/mpeg', wav: 'audio/wav', ogg: 'audio/ogg', 
              flac: 'audio/flac', aac: 'audio/aac', m4a: 'audio/mp4' 
            }
            mimeType = mimeMap[ext] || 'audio/mpeg'
          }
          
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
            createdAt: Date.now()
          })
          
          store.addEdge(sourceNodeId, newNodeId, {
            sourceHandle: 'right',
            targetHandle: 'left',
          })
          
          store.setSelected(newNodeId)
          
          // 保存到 IndexedDB
          const projectId = store.projectId || 'default'
          try {
            const mediaId = await saveMedia({
              nodeId: newNodeId,
              projectId,
              type: type as 'image' | 'video' | 'audio',
              data: dataUrl,
            })
            if (mediaId) {
              store.patchNodeDataSilent(newNodeId, { mediaId })
            }
          } catch {
            // ignore
          }
        }
      } catch (err) {
        console.error('[Canvas] Tauri 文件选择失败:', err)
        window.$message?.error?.('文件选择失败，请重试')
      }
      connectMenuPendingTypeRef.current = null
      connectMenuPendingInfoRef.current = null
    } else {
      // Web 环境
      if (connectMenuFileInputRef.current) {
        connectMenuFileInputRef.current.accept = accept
        connectMenuFileInputRef.current.click()
      }
    }
  }, [])

  // 从连接线菜单创建节点并自动连接
  const spawnNodeFromConnectMenu = useCallback((type: string) => {
    if (!connectMenu) return
    const { flowX, flowY, sourceNodeId } = connectMenu
    
    // 图片/视频/音频节点需要先选择文件
    if (type === 'image' || type === 'video' || type === 'audio') {
      triggerConnectMenuFileUpload(type, { flowX, flowY, sourceNodeId })
      return
    }
    
    const { w, h } = getNodeSize(type)
    const pos = { x: flowX - w * 0.5, y: flowY - h * 0.5 }
    
    const store = useGraphStore.getState()
    const data: Record<string, unknown> = { label: type === 'text' ? '文本' : type === 'imageConfig' ? '生图配置' : type === 'videoConfig' ? '视频配置' : type }
    
    if (type === 'imageConfig') {
      const baseModelCfg: any = (IMAGE_MODELS as any[]).find((m: any) => m.key === DEFAULT_IMAGE_MODEL) || (IMAGE_MODELS as any[])[0]
      data.model = DEFAULT_IMAGE_MODEL
      if (baseModelCfg?.defaultParams?.size) data.size = baseModelCfg.defaultParams.size
      if (baseModelCfg?.defaultParams?.quality) data.quality = baseModelCfg.defaultParams.quality
    }
    if (type === 'videoConfig') {
      const baseModelCfg: any = (VIDEO_MODELS as any[]).find((m: any) => m.key === DEFAULT_VIDEO_MODEL) || (VIDEO_MODELS as any[])[0]
      data.model = DEFAULT_VIDEO_MODEL
      if (baseModelCfg?.defaultParams?.ratio) data.ratio = baseModelCfg.defaultParams.ratio
      if (baseModelCfg?.defaultParams?.duration) data.dur = baseModelCfg.defaultParams.duration
      if (baseModelCfg?.defaultParams?.size) data.size = baseModelCfg.defaultParams.size
    }
    
    // 创建新节点
    const newNodeId = store.addNode(type, pos, data)
    
    // 自动创建连接
    store.addEdge(sourceNodeId, newNodeId, {
      sourceHandle: 'right',
      targetHandle: 'left',
    })
    
    store.setSelected(newNodeId)
    setConnectMenu(null)
  }, [connectMenu, triggerConnectMenuFileUpload])

  // 新事件系统状态
  type ConnectPreviewState =
    | { kind?: 'single'; from: { x: number; y: number }; to: { x: number; y: number }; fromSide: 'left' | 'right'; toSide: 'left' | 'right' }
    | { kind: 'multi'; sources: Array<{ nodeId: string; from: { x: number; y: number }; fromSide: 'left' | 'right' }>; to: { x: number; y: number }; toSide: 'left' | 'right' }
  const [connectPreview, setConnectPreview] = useState<ConnectPreviewState | null>(null)
  const [selectBox, setSelectBox] = useState<{ start: { x: number; y: number }; current: { x: number; y: number } } | null>(null)
  const [alignGuide, setAlignGuide] = useState<{ x?: number; y?: number } | null>(null)
  const handledInitRef = useRef<string | null>(null)
  const transientViewportRef = useRef<Viewport | null>(null)
  const transientViewportRafRef = useRef<number>(0)
  const canvasWrapRef = useRef<HTMLDivElement | null>(null)
  const clipboardRef = useRef<null | { nodes: { type: any; data: any; dx: number; dy: number }[]; edges: { si: number; ti: number; data: any }[] }>(null)

  const addNode = useGraphStore((s) => s.addNode)
  const setProjectId = useGraphStore((s) => s.setProjectId)
  const addEdge = useGraphStore((s) => s.addEdge)
  const setSelected = useGraphStore((s) => s.setSelected)
  const setSelection = useGraphStore((s) => s.setSelection)
  const removeNodes = useGraphStore((s) => s.removeNodes)
  const removeEdge = useGraphStore((s) => s.removeEdge)
  const projectId = useGraphStore((s) => s.projectId)
  // 不订阅 viewport，避免频繁缩放时触发整个 Canvas 重新渲染
  // 需要时通过 useGraphStore.getState().viewport 获取
  const undo = useGraphStore((s) => s.undo)
  const redo = useGraphStore((s) => s.redo)
  const setViewport = useGraphStore((s) => s.setViewport)

  // 撤销/重做状态订阅
  const { canUndo, canRedo } = useGraphStore(
    (s) => ({ canUndo: s.canUndo(), canRedo: s.canRedo() }),
    shallow
  )

  // 适应视图
  const handleFitView = useCallback(() => {
    const state = useGraphStore.getState()
    const nodes = state.nodes
    if (nodes.length === 0) return
    
    const wrap = canvasWrapRef.current
    if (!wrap) return
    const rect = wrap.getBoundingClientRect()
    
    // 计算所有节点的边界
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
    for (const n of nodes) {
      const { w, h } = getNodeSize(n.type)
      minX = Math.min(minX, n.x)
      minY = Math.min(minY, n.y)
      maxX = Math.max(maxX, n.x + w)
      maxY = Math.max(maxY, n.y + h)
    }
    
    const contentW = maxX - minX + 100
    const contentH = maxY - minY + 100
    const zoom = Math.min(rect.width / contentW, rect.height / contentH, 1)
    const x = (rect.width - contentW * zoom) / 2 - minX * zoom + 50 * zoom
    const y = (rect.height - contentH * zoom) / 2 - minY * zoom + 50 * zoom
    
    setViewport({ x, y, zoom })
  }, [setViewport])

  const projects = useProjectsStore((s) => s.projects)

  const dark = useSettingsStore((s) => s.dark)
  const toggleDark = useSettingsStore((s) => s.toggleDark)
  const defaultImageModel = useSettingsStore((s) => s.defaultImageModel)
  const defaultVideoModel = useSettingsStore((s) => s.defaultVideoModel)
  const setDefaultImageModel = useSettingsStore((s) => s.setDefaultImageModel)
  const setDefaultVideoModel = useSettingsStore((s) => s.setDefaultVideoModel)
  
  // 显示的默认模型（如果未设置则使用配置中的默认值）
  const effectiveImageModel = defaultImageModel || DEFAULT_IMAGE_MODEL
  const effectiveVideoModel = defaultVideoModel || DEFAULT_VIDEO_MODEL

  const projectName = useMemo(() => projects.find((p) => p.id === projectId)?.name || projectId, [projectId, projects])

  useEffect(() => {
    const pid = String(id || '').trim() || 'default'
    let cancelled = false
    void (async () => {
      await setProjectId(pid)
      if (cancelled) return
      const initialPrompt = String((location.state as any)?.initialPrompt || '').trim()
      if (!initialPrompt) return
      if (handledInitRef.current === pid) return

      handledInitRef.current = pid
      // 以“当前视口中心”为基准创建初始节点，避免固定坐标导致跑出可视区域
      const vp = useGraphStore.getState().viewport
      const wrap = canvasWrapRef.current
      const rect = wrap?.getBoundingClientRect()
      const z = vp.zoom || 1
      const center = rect
        ? { x: (rect.width * 0.5 - vp.x) / z, y: (rect.height * 0.5 - vp.y) / z }
        : { x: (-vp.x + 600) / z, y: (-vp.y + 360) / z }
      const { w: textW, h: textH } = getNodeSize('text')
      const { w: cfgW, h: cfgH } = getNodeSize('imageConfig')
      const cfgPos = { x: center.x - cfgW * 0.5, y: center.y - cfgH * 0.5 }
      const textPos = { x: cfgPos.x - 400, y: center.y - textH * 0.5 }
      useGraphStore.getState().withBatchUpdates(() => {
        const textId = addNode('text', textPos, { label: '提示词', content: initialPrompt })
        const userDefaultImg = useSettingsStore.getState().defaultImageModel
        const imgModelKey = (userDefaultImg && (IMAGE_MODELS as any[]).some((m: any) => m.key === userDefaultImg)) ? userDefaultImg : DEFAULT_IMAGE_MODEL
        const cfgId = addNode('imageConfig', cfgPos, { label: '文生图', model: imgModelKey, prompt: initialPrompt })
        addEdge(textId, cfgId, {})
        setSelected(cfgId)
      })
    })()
    return () => {
      cancelled = true
    }
  }, [id, setProjectId])

  useEffect(() => {
    return () => {
      if (transientViewportRafRef.current) cancelAnimationFrame(transientViewportRafRef.current)
    }
  }, [])

  // 同步画布素材到历史记录
  useEffect(() => {
    // 延迟执行，确保画布数据已加载
    const timer = setTimeout(() => {
      syncAssetHistoryFromCanvasNodes({ includeDataUrl: true, includeAssetUrl: true })
    }, 1000)
    return () => clearTimeout(timer)
  }, [id])

  useEffect(() => {
    if (!nodeMenuOpen) setSpawnAt(null)
  }, [nodeMenuOpen])

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement | null)?.tagName || ''
      const selection = typeof window !== 'undefined' ? window.getSelection?.() : null
      const hasTextSelection = !!selection && !selection.isCollapsed && String(selection.toString() || '').trim().length > 0
      // 如果用户正在选择文本（例如 AI 助手消息、检查器等），不要劫持 ⌘C
      const editing = tag === 'INPUT' || tag === 'TEXTAREA' || (e.target as any)?.isContentEditable || hasTextSelection
      const meta = e.metaKey || e.ctrlKey

      // 工具切换快捷键 (优先处理，不需要 meta 键)
      if (!editing && !meta) {
        if (e.key === 'v' || e.key === 'V') {
          e.preventDefault()
          setTool('select')
          return
        }
        if (e.key === 'h' || e.key === 'H') {
          e.preventDefault()
          setTool('pan')
          return
        }
        if (e.key === 'l' || e.key === 'L') {
          e.preventDefault()
          setTool('connect')
          return
        }
      }

      if (meta && !editing && (e.key === 'c' || e.key === 'C')) {
        const s = useGraphStore.getState()
        if (s.selectedNodeIds.length === 0) return
        e.preventDefault()
        const picked = s.nodes.filter((n) => s.selectedNodeIds.includes(n.id))
        if (picked.length === 0) return
        let x0 = Infinity
        let y0 = Infinity
        for (const n of picked) {
          x0 = Math.min(x0, n.x)
          y0 = Math.min(y0, n.y)
        }
        const idToIdx = new Map(picked.map((n, i) => [n.id, i]))
        const edges = s.edges
          .filter((ed) => idToIdx.has(ed.source) && idToIdx.has(ed.target))
          .map((ed) => ({ si: idToIdx.get(ed.source)!, ti: idToIdx.get(ed.target)!, data: ed.data ? { ...(ed.data as any) } : undefined }))
        clipboardRef.current = {
          nodes: picked.map((n) => ({ type: n.type, data: n.data ? { ...(n.data as any) } : {}, dx: n.x - x0, dy: n.y - y0 })),
          edges
        }
        return
      }

      if (meta && !editing && (e.key === 'v' || e.key === 'V')) {
        const clip = clipboardRef.current
        if (!clip || clip.nodes.length === 0) return
        e.preventDefault()
        const wrap = canvasWrapRef.current
        const vp = useGraphStore.getState().viewport
        const z = vp.zoom || 1
        let anchor = { x: 0, y: 0 }
        if (wrap) {
          const rect = wrap.getBoundingClientRect()
          anchor = { x: (rect.width * 0.5 - vp.x) / z, y: (rect.height * 0.5 - vp.y) / z }
        } else {
          anchor = { x: (-vp.x + 600) / z, y: (-vp.y + 360) / z }
        }
        const ids: string[] = []
        useGraphStore.getState().withBatchUpdates(() => {
          const created: string[] = []
          for (let i = 0; i < clip.nodes.length; i++) {
            const n = clip.nodes[i]
            const id = addNode(n.type, { x: anchor.x + n.dx + 36, y: anchor.y + n.dy + 36 }, { ...(n.data || {}) })
            created.push(id)
          }
          for (const e2 of clip.edges) {
            const sId = created[e2.si]
            const tId = created[e2.ti]
            if (!sId || !tId) continue
            addEdge(sId, tId, e2.data ? { ...(e2.data as any) } : undefined)
          }
          ids.push(...created)
        })
        if (ids.length > 0) setSelection(ids, ids[0])
        return
      }

      if (meta && !editing && (e.key === 'd' || e.key === 'D')) {
        const s = useGraphStore.getState()
        if (s.selectedNodeIds.length === 0) return
        e.preventDefault()
        const picked = s.nodes.filter((n) => s.selectedNodeIds.includes(n.id))
        if (picked.length === 0) return
        const ids: string[] = []
        useGraphStore.getState().withBatchUpdates(() => {
          for (const n of picked) {
            const id = addNode(n.type, { x: n.x + 36, y: n.y + 36 }, { ...(n.data as any) })
            ids.push(id)
          }
        })
        if (ids.length > 0) setSelection(ids, ids[0])
        return
      }

      if (meta && !editing && (e.key === 'a' || e.key === 'A')) {
        e.preventDefault()
        const s = useGraphStore.getState()
        const ids = s.nodes.map((n) => n.id)
        setSelection(ids, s.selectedNodeId)
        return
      }

      if (!editing && (e.key === 'Backspace' || e.key === 'Delete')) {
        const s = useGraphStore.getState()
        if (s.selectedNodeIds.length > 0) {
          e.preventDefault()
          removeNodes(s.selectedNodeIds)
        } else if (s.selectedEdgeId) {
          e.preventDefault()
          removeEdge(s.selectedEdgeId)
        }
        return
      }

      if (meta && !editing && (e.key === 'z' || e.key === 'Z')) {
        e.preventDefault()
        if (e.shiftKey) void redo()
        else void undo()
        return
      }

      if (meta && !editing && (e.key === 'y' || e.key === 'Y')) {
        e.preventDefault()
        void redo()
        return
      }

      if (meta && !editing && (e.key === 'k' || e.key === 'K')) {
        e.preventDefault()
        setAssistantOpen((v) => !v)
        return
      }

      if (e.key === 'Escape') {
        setAssistantOpen(false)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [addEdge, addNode, redo, removeEdge, removeNodes, setSelection, undo])

  const onTransientViewportChange = useCallback((vp: Viewport | null) => {
    transientViewportRef.current = vp
    if (transientViewportRafRef.current) return
    transientViewportRafRef.current = requestAnimationFrame(() => {
      transientViewportRafRef.current = 0
      setTransientViewport(transientViewportRef.current)
    })
  }, [])

  // 不订阅 viewport，使用函数动态获取，避免频繁缩放时触发重新渲染
  const paletteSpawnAt = useMemo(() => {
    if (spawnAt) return spawnAt
    const vp = useGraphStore.getState().viewport
    const el = canvasWrapRef.current
    if (!el) {
      const z = vp.zoom || 1
      return { x: (-vp.x + 600) / z, y: (-vp.y + 360) / z }
    }
    const rect = el.getBoundingClientRect()
    const z = vp.zoom || 1
    return { x: (rect.width * 0.5 - vp.x) / z, y: (rect.height * 0.5 - vp.y) / z }
  }, [spawnAt]) // 只依赖 spawnAt，viewport 通过 getState 获取

  const addDroppedFiles = useCallback(
    async (files: File[], client: { x: number; y: number }) => {
      const wrap = canvasWrapRef.current
      if (!wrap) return
      const rect = wrap.getBoundingClientRect()
      const vp = useGraphStore.getState().viewport
      const z = vp.zoom || 1
      const local = { x: client.x - rect.left, y: client.y - rect.top }
      const dropWorld = { x: (local.x - vp.x) / z, y: (local.y - vp.y) / z }

      const state = useGraphStore.getState()
      const hit = state.nodes
        .slice()
        .sort((a, b) => (a.zIndex || 0) - (b.zIndex || 0))
        .reverse()
        .find((n) => {
          if (n.type !== 'imageConfig' && n.type !== 'videoConfig') return false
          const { w, h } = getNodeSize(n.type)
          return dropWorld.x >= n.x && dropWorld.x <= n.x + w && dropWorld.y >= n.y && dropWorld.y <= n.y + h
        })

      const fileToDataUrl = (file: File) =>
        new Promise<string>((resolve, reject) => {
          const reader = new FileReader()
          reader.onerror = () => reject(new Error('read failed'))
          reader.onload = () => resolve(String(reader.result || ''))
          reader.readAsDataURL(file)
        })

      const pairs = await Promise.all(
        files.map(async (f) => ({
          file: f,
          dataUrl: await fileToDataUrl(f)
        }))
      )

      const persistQueue: Array<{ id: string; type: 'image' | 'video' | 'audio'; dataUrl: string }> = []

      useGraphStore.getState().withBatchUpdates(() => {
        const baseX = hit ? hit.x - 380 : dropWorld.x
        const baseY = hit ? hit.y : dropWorld.y
        const ids: string[] = []
        const roleTaken = new Set<string>()
        if (hit?.type === 'videoConfig') {
          const incoming = state.edges.filter((e) => e.target === hit.id)
          for (const e of incoming) {
            const r = String((e.data as any)?.imageRole || '').trim()
            if (r) roleTaken.add(r)
          }
        }

        for (let i = 0; i < pairs.length; i++) {
          const { file, dataUrl } = pairs[i]
          const rawType = String(file.type || '')
          const typeLower = rawType.toLowerCase()
          let kind: 'image' | 'audio' | 'video' | null =
            /^image\//i.test(typeLower) ? 'image' : /^audio\//i.test(typeLower) ? 'audio' : /^video\//i.test(typeLower) ? 'video' : null

          // 桌面拖拽在部分环境下 File.type 可能为空：用扩展名兜底
          const nameLower = String(file.name || '').toLowerCase()
          const ext = String(nameLower.match(/\.([a-z0-9]+)$/i)?.[1] || '').toLowerCase()
          if (!kind && ext) {
            if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'svg', 'tif', 'tiff', 'avif'].includes(ext)) kind = 'image'
            else if (['mp4', 'webm', 'mov', 'm4v', 'avi', 'mkv'].includes(ext)) kind = 'video'
            else if (['mp3', 'wav', 'm4a', 'aac', 'ogg', 'flac'].includes(ext)) kind = 'audio'
          }
          if (!kind) continue

          const inferredMime =
            rawType ||
            (ext === 'png' ? 'image/png'
              : (ext === 'jpg' || ext === 'jpeg') ? 'image/jpeg'
                : ext === 'gif' ? 'image/gif'
                  : ext === 'webp' ? 'image/webp'
                    : ext === 'bmp' ? 'image/bmp'
                      : ext === 'svg' ? 'image/svg+xml'
                        : ext === 'tif' || ext === 'tiff' ? 'image/tiff'
                          : ext === 'avif' ? 'image/avif'
                            : ext === 'webm' ? 'video/webm'
                              : ext === 'mov' ? 'video/quicktime'
                                : ext === 'm4v' ? 'video/x-m4v'
                                  : ext === 'avi' ? 'video/x-msvideo'
                                    : ext === 'mkv' ? 'video/x-matroska'
                                      : ext === 'wav' ? 'audio/wav'
                                        : ext === 'm4a' ? 'audio/mp4'
                                          : ext === 'aac' ? 'audio/aac'
                                            : ext === 'ogg' ? 'audio/ogg'
                                              : ext === 'flac' ? 'audio/flac'
                                                : ext === 'mp3' ? 'audio/mpeg'
                                                  : kind === 'video' ? 'video/mp4'
                                                    : kind === 'audio' ? 'audio/mpeg'
                                                      : '')
          const label = kind === 'image' ? '上传图片' : kind === 'audio' ? '上传音频' : '上传视频'
          const id = addNode(kind, { x: baseX, y: baseY + i * 36 }, {
            label: file.name || label,
            url: dataUrl,
            // dataURL 不作为长期 source（跨重启用 mediaId 恢复）
            sourceUrl: '',
            fileName: file.name,
            fileType: inferredMime,
            createdAt: Date.now()
          })
          ids.push(id)
          persistQueue.push({ id, type: kind, dataUrl })

          if (hit && kind === 'image') {
            const data: Record<string, unknown> = { sourcePort: 'right', targetPort: 'left' }
            if (hit.type === 'videoConfig') {
              const hasFirst = roleTaken.has('first_frame_image')
              const hasLast = roleTaken.has('last_frame_image')
              const role = !hasFirst ? 'first_frame_image' : !hasLast ? 'last_frame_image' : 'input_reference'
              data.imageRole = role
              roleTaken.add(role)
            }
            addEdge(id, hit.id, data)
          }
        }

        if (ids.length > 0) setSelection(ids, ids[0])
      })

      // 写入 IndexedDB，确保刷新/重启后可恢复
      const pid = useGraphStore.getState().projectId || 'default'
      for (const item of persistQueue) {
        try {
          const mediaId = await saveMedia({
            nodeId: item.id,
            projectId: pid,
            type: item.type,
            data: item.dataUrl,
          })
          if (mediaId) {
            useGraphStore.getState().patchNodeDataSilent(item.id, { mediaId })
          }
        } catch {
          // ignore
        }
      }
    },
    [addEdge, addNode, setSelection]
  )

  // Tauri 原生桌面拖拽：通过 tauri://drag-drop 事件拿到真实文件路径（避免 WebView 拦截/拿不到 File.type）
  useEffect(() => {
    if (!isTauri) return
    let mounted = true
    let unlisten: (() => void) | null = null

    const inferMimeFromName = (name: string) => {
      const n = String(name || '').toLowerCase()
      const ext = String(n.match(/\.([a-z0-9]+)$/i)?.[1] || '').toLowerCase()
      if (!ext) return ''
      if (ext === 'png') return 'image/png'
      if (ext === 'jpg' || ext === 'jpeg') return 'image/jpeg'
      if (ext === 'gif') return 'image/gif'
      if (ext === 'webp') return 'image/webp'
      if (ext === 'bmp') return 'image/bmp'
      if (ext === 'svg') return 'image/svg+xml'
      if (ext === 'tif' || ext === 'tiff') return 'image/tiff'
      if (ext === 'avif') return 'image/avif'

      if (ext === 'webm') return 'video/webm'
      if (ext === 'mov') return 'video/quicktime'
      if (ext === 'm4v') return 'video/x-m4v'
      if (ext === 'avi') return 'video/x-msvideo'
      if (ext === 'mkv') return 'video/x-matroska'
      if (ext === 'mp4') return 'video/mp4'

      if (ext === 'wav') return 'audio/wav'
      if (ext === 'm4a') return 'audio/mp4'
      if (ext === 'aac') return 'audio/aac'
      if (ext === 'ogg') return 'audio/ogg'
      if (ext === 'flac') return 'audio/flac'
      if (ext === 'mp3') return 'audio/mpeg'
      return ''
    }

    ;(async () => {
      try {
        const { listen } = await import('@tauri-apps/api/event')
        const { readFile } = await import('@tauri-apps/plugin-fs')

        unlisten = await listen<any>('tauri://drag-drop', async (event) => {
          const payload: any = (event as any)?.payload || {}
          const paths: string[] = Array.isArray(payload?.paths) ? payload.paths : []
          if (!paths || paths.length === 0) return

          const pos: any = payload?.position || payload?.positionPhysical || payload?.position_physical || payload?.positionLogical || payload?.position_logical
          const dpr = window.devicePixelRatio || 1
          const clientX = typeof pos?.x === 'number' ? pos.x / dpr : window.innerWidth / 2
          const clientY = typeof pos?.y === 'number' ? pos.y / dpr : window.innerHeight / 2

          const fileList = await Promise.all(
            paths.map(async (p: string) => {
              try {
                const bytes = await readFile(p)
                const name = String(p || '').split(/[/\\\\]/).pop() || 'file'
                const mime = inferMimeFromName(name)
                return new File([bytes], name, { type: mime })
              } catch (err) {
                console.warn('[Canvas] 读取拖拽文件失败:', p, err)
                return null
              }
            })
          )

          if (!mounted) return
          const files = fileList.filter(Boolean) as File[]
          if (files.length > 0) {
            void addDroppedFiles(files, { x: clientX, y: clientY })
          }
        })
      } catch (err) {
        console.warn('[Canvas] 初始化 Tauri 拖拽监听失败:', err)
      }
    })()

    return () => {
      mounted = false
      try {
        unlisten?.()
      } catch {
        // ignore
      }
    }
  }, [addDroppedFiles])

  // 监听从历史面板拖拽素材到画布的事件
  useEffect(() => {
    const handleAssetDrop = (e: CustomEvent<{ asset: any; clientX: number; clientY: number }>) => {
      const { asset, clientX, clientY } = e.detail
      const src = String(asset?.src || asset?.url || '').trim()
      const type = String(asset?.type || '').trim()
      if (!src || !type) return
      const kind = type === 'video' ? 'video' : type === 'audio' ? 'audio' : type === 'image' ? 'image' : null
      if (!kind) return
      const wrap = canvasWrapRef.current
      const rect = wrap?.getBoundingClientRect()
      const vp = useGraphStore.getState().viewport
      const z = vp.zoom || 1
      const local = rect ? { x: clientX - rect.left, y: clientY - rect.top } : { x: 0, y: 0 }
      const world = { x: (local.x - vp.x) / z, y: (local.y - vp.y) / z }
      const id = addNode(kind, { x: world.x - 120, y: world.y - 80 }, {
        label: String(asset?.title || asset?.label || '').trim() || (kind === 'video' ? '视频' : kind === 'audio' ? '音频' : '图片'),
        url: src,
        sourceUrl: src,
        model: String(asset?.model || '').trim(),
        duration: asset?.duration,
        createdAt: Date.now()
      })
      setSelected(id)
    }
    window.addEventListener('nexus:asset-drop', handleAssetDrop as EventListener)
    return () => window.removeEventListener('nexus:asset-drop', handleAssetDrop as EventListener)
  }, [addNode, setSelected])

  return (
    <div className="h-full w-full bg-[var(--bg-primary)] text-[var(--text-primary)]">
      <header className="flex h-[72px] items-center justify-between border-b border-[var(--border-color)] bg-[var(--bg-secondary)] px-6 py-4">
        <div className="flex items-center gap-3">
          <button
            className="flex h-10 w-10 items-center justify-center rounded-xl border border-[var(--border-color)] bg-[var(--bg-tertiary)] text-[var(--text-primary)] hover:bg-[var(--bg-secondary)]"
            onClick={() => nav('/')}
            title="返回"
          >
            <ChevronLeft className="h-[18px] w-[18px]" />
          </button>

          <button
            className="flex items-center gap-1 rounded-xl border border-[var(--border-color)] bg-[var(--bg-tertiary)] px-3 py-2 text-sm font-semibold text-[var(--text-primary)] hover:bg-[var(--bg-secondary)]"
            onClick={() => {
              // TODO: 项目下拉菜单（重命名/复制/删除）
            }}
            title="项目"
          >
            <span className="max-w-[320px] truncate">{projectName}</span>
            <ChevronDown className="h-4 w-4 text-[var(--text-secondary)]" />
          </button>
        </div>

        <div className="flex items-center gap-2">
          {/* 默认模型选择 */}
          <div className="flex items-center gap-1">
            <select
              value={effectiveImageModel}
              onChange={(e) => setDefaultImageModel(e.target.value)}
              className="h-9 rounded-lg border border-[var(--border-color)] bg-[var(--bg-tertiary)] px-2 text-xs text-[var(--text-primary)] outline-none hover:bg-[var(--bg-secondary)]"
              title="默认绘画模型"
            >
              {(IMAGE_MODELS as any[]).map((m: any) => (
                <option key={m.key} value={m.key}>{m.label}</option>
              ))}
            </select>
            <select
              value={effectiveVideoModel}
              onChange={(e) => setDefaultVideoModel(e.target.value)}
              className="h-9 rounded-lg border border-[var(--border-color)] bg-[var(--bg-tertiary)] px-2 text-xs text-[var(--text-primary)] outline-none hover:bg-[var(--bg-secondary)]"
              title="默认视频模型"
            >
              {(VIDEO_MODELS as any[]).map((m: any) => (
                <option key={m.key} value={m.key}>{m.label}</option>
              ))}
            </select>
          </div>
          <button
            className={`flex items-center gap-1.5 rounded-xl border px-3 py-2 text-sm font-medium transition-colors ${
              batchGenerating
                ? 'border-[var(--accent-color)] bg-[var(--accent-color)]/10 text-[var(--accent-color)]'
                : 'border-[var(--border-color)] bg-[var(--bg-tertiary)] text-[var(--text-secondary)] hover:bg-[var(--bg-secondary)] hover:text-[var(--text-primary)]'
            }`}
            onClick={handleBatchGenerate}
            disabled={batchGenerating}
            title="一键全部生成"
          >
            <Play className={`h-4 w-4 ${batchGenerating ? 'animate-pulse' : ''}`} />
            <span>{batchGenerating ? '生成中...' : '全部生成'}</span>
          </button>
          <button
            className="flex h-9 w-9 items-center justify-center rounded-xl border border-[var(--border-color)] bg-[var(--bg-tertiary)] text-[var(--text-secondary)] hover:bg-[var(--bg-secondary)] hover:text-[var(--text-primary)]"
            onClick={() => toggleDark()}
            title="主题"
          >
            {dark ? <Moon className="h-[18px] w-[18px]" /> : <Sun className="h-[18px] w-[18px]" />}
          </button>
          <button
            className="flex h-9 w-9 items-center justify-center rounded-xl border border-[var(--border-color)] bg-[var(--bg-tertiary)] text-[var(--text-secondary)] hover:bg-[var(--bg-secondary)] hover:text-[var(--text-primary)]"
            onClick={() => setDownloadModalOpen(true)}
            title="批量下载"
          >
            <Download className="h-[18px] w-[18px]" />
          </button>
          <button
            className="flex h-9 w-9 items-center justify-center rounded-xl border border-[var(--border-color)] bg-[var(--bg-tertiary)] text-[var(--text-secondary)] hover:bg-[var(--bg-secondary)] hover:text-[var(--text-primary)]"
            onClick={() => setHistoryPanelOpen((v) => !v)}
            title="历史素材"
          >
            <History className="h-[18px] w-[18px]" />
          </button>
          <button
            className="flex h-9 w-9 items-center justify-center rounded-xl border border-[var(--border-color)] bg-[var(--bg-tertiary)] text-[var(--text-secondary)] hover:bg-[var(--bg-secondary)] hover:text-[var(--text-primary)]"
            onClick={() => setSettingsOpen(true)}
            title="API 设置"
          >
            <Settings className="h-[18px] w-[18px]" />
          </button>
        </div>
      </header>

      <div className="h-[calc(100%-72px)] w-full p-4">
        <div
          ref={canvasWrapRef}
          data-canvas-wrap="1"
          className="relative h-full w-full bg-[var(--bg-primary)]"
          onContextMenu={handleCanvasContextMenu}
          onClick={() => {
            setCanvasContextMenu(null)
            setConnectMenu(null)
          }}
          onDragOver={(e) => {
            e.preventDefault()
          }}
          onDrop={(e) => {
            const isSupportedMediaFile = (f: File) => {
              const t = String((f as any)?.type || '').toLowerCase()
              if (/^(image|audio|video)\//i.test(t)) return true
              // 桌面拖拽在部分环境下 File.type 可能为空：用扩展名兜底
              const name = String((f as any)?.name || '').toLowerCase()
              const m = name.match(/\.([a-z0-9]+)$/i)
              const ext = String(m?.[1] || '').toLowerCase()
              if (!ext) return false
              if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'svg', 'tif', 'tiff', 'avif'].includes(ext)) return true
              if (['mp4', 'webm', 'mov', 'm4v', 'avi', 'mkv'].includes(ext)) return true
              if (['mp3', 'wav', 'm4a', 'aac', 'ogg', 'flac'].includes(ext)) return true
              return false
            }
            const files = Array.from(e.dataTransfer?.files || []).filter(isSupportedMediaFile)
            if (files.length > 0) {
              e.preventDefault()
              void addDroppedFiles(files, { x: e.clientX, y: e.clientY })
              return
            }

            const raw = e.dataTransfer?.getData('application/json') || ''
            if (!raw) return
            try {
              const asset = JSON.parse(raw)
              const src = String(asset?.src || asset?.url || '').trim()
              const type = String(asset?.type || '').trim()
              if (!src || !type) return
              const kind = type === 'video' ? 'video' : type === 'audio' ? 'audio' : type === 'image' ? 'image' : null
              if (!kind) return
              e.preventDefault()
              const wrap = canvasWrapRef.current
              const rect = wrap?.getBoundingClientRect()
              const vp = useGraphStore.getState().viewport
              const z = vp.zoom || 1
              const local = rect ? { x: e.clientX - rect.left, y: e.clientY - rect.top } : { x: 0, y: 0 }
              const world = { x: (local.x - vp.x) / z, y: (local.y - vp.y) / z }
              const id = addNode(kind, { x: world.x - 120, y: world.y - 80 }, {
                label: String(asset?.title || asset?.label || '').trim() || (kind === 'video' ? '视频' : kind === 'audio' ? '音频' : '图片'),
                url: src,
                sourceUrl: src,
                model: String(asset?.model || '').trim(),
                duration: asset?.duration,
                createdAt: Date.now()
              })
              setSelected(id)
            } catch {
              // ignore
            }
          }}
        >
          <div className="canvas-layer absolute inset-0">
            {USE_REACT_FLOW ? (
            // React Flow 模式（完全对齐 Huobao/Vue Flow 架构，60fps 性能保证）
            <ReactFlowCanvas
              onContextMenu={(payload: CanvasContextPayload) => {
                setCtxPayload(payload)
                setCtxOpen(true)
              }}
              onConnectEnd={handleConnectEnd}
              onFileDrop={addDroppedFiles}
            />
          ) : USE_DOM_CANVAS ? (
            // 高性能 DOM 画布模式
            <DOMGraphCanvas
              onInteractingChange={setIsInteracting}
              onTransientViewportChange={onTransientViewportChange}
              onContextMenu={(payload: CanvasContextPayload) => {
                setCtxPayload(payload)
                setCtxOpen(true)
              }}
            >
              <NodeCardsLayer viewportOverride={transientViewport} />
            </DOMGraphCanvas>
          ) : USE_NEW_EVENT_SYSTEM ? (
            // 新事件系统：EventCoordinator 包裹所有层
            <EventCoordinator
              tool={tool}
              connectMode={tool === 'connect'}
              onInteractingChange={setIsInteracting}
              onTransientViewportChange={onTransientViewportChange}
              onConnectPreviewChange={setConnectPreview}
              onSelectBoxChange={setSelectBox}
              onAlignGuideChange={setAlignGuide}
              onRequestAddNode={(pos) => setSpawnAt(pos)}
              onContextMenu={(payload) => {
                setCtxPayload(payload)
                setCtxOpen(true)
              }}
            >
              <WebGLGraphCanvas
                tool={tool}
                connectMode={tool === 'connect'}
                useExternalEvents={true}
                externalConnectPreview={connectPreview}
                externalSelectBox={selectBox}
                externalAlignGuide={alignGuide}
                externalIsInteracting={isInteracting}
                externalViewport={transientViewport}
              />
              <EdgeOverlayLayer isInteracting={isInteracting} viewportOverride={transientViewport} />
              <NodeCardsLayer viewportOverride={transientViewport} />
            </EventCoordinator>
          ) : (
            // 原有 WebGL 事件系统
            <>
              <WebGLGraphCanvas
                tool={tool}
                connectMode={tool === 'connect'}
                onInteractingChange={setIsInteracting}
                onTransientViewportChange={onTransientViewportChange}
                onRequestAddNode={(pos) => setSpawnAt(pos)}
                onContextMenu={(payload) => {
                  setCtxPayload(payload)
                  setCtxOpen(true)
                }}
              />
              <EdgeOverlayLayer isInteracting={isInteracting} viewportOverride={transientViewport} />
              <NodeCardsLayer viewportOverride={transientViewport} />
            </>
          )}
          </div>

          <div className="ui-layer absolute inset-0">
            <CanvasSidebar
              activeTool={tool}
              nodeMenuOpen={nodeMenuOpen}
              onChangeTool={(next) => {
                setTool(next)
                setNodeMenuOpen(false)
              }}
              onToggleNodeMenu={() => {
                // 在打开菜单时计算当前视口中心位置
                const vp = useGraphStore.getState().viewport
                const el = canvasWrapRef.current
                if (el) {
                  const rect = el.getBoundingClientRect()
                  const z = vp.zoom || 1
                  const centerX = (rect.width * 0.5 - vp.x) / z
                  const centerY = (rect.height * 0.5 - vp.y) / z
                  setSpawnAt({ x: centerX, y: centerY })
                }
                setNodeMenuOpen((v) => !v)
              }}
              onUndo={undo}
              onRedo={redo}
              canUndo={canUndo}
              canRedo={canRedo}
              onOpenWorkflow={() => setWorkflowTemplatesOpen(true)}
              onOpenShortDrama={() => nav(`/short-drama/${String(projectId || '').trim() || 'default'}`)}
              onOpenCameraControl={() => setCameraControlOpen(true)}
              onOpenDirector={() => setDirectorOpen(true)}
              onOpenSketch={() => setSketchOpen(true)}
              onOpenAudio={() => setAudioOpen(true)}
              onOpenBlend={() => setBlendToolOpen(true)}
              onOpenPromptLibrary={() => setPromptLibraryOpen(true)}
              onOpenPromptReverse={() => setPromptReverseOpen(true)}
              onSaveAsTemplate={handleSaveAsTemplate}
            />

            {/* CanvasHud 在 React Flow / DOM 画布模式下禁用，因为它订阅 viewport 会导致性能问题 */}
            {/* React Flow 和 DOMGraphCanvas 已经内置了小地图，缩放控制通过 wheel 事件实现 */}
            {!USE_REACT_FLOW && !USE_DOM_CANVAS && <CanvasHud containerRef={canvasWrapRef} />}

            {nodeMenuOpen ? (
              <div className="pointer-events-auto absolute left-20 top-56 z-30">
                <NodePalettePanel
                  spawnAt={paletteSpawnAt}
                  onSpawned={() => setSpawnAt(null)}
                  onClose={() => {
                    setNodeMenuOpen(false)
                    setSpawnAt(null)
                  }}
                />
              </div>
            ) : null}

            <CanvasAssistantDrawer open={assistantOpen} onOpenChange={setAssistantOpen} onOpenSettings={() => setSettingsOpen(true)} />

            <CanvasContextMenu
              open={ctxOpen}
              payload={ctxPayload}
              onRequestEditRemark={(nodeId) => setRemarkNodeId(String(nodeId || '').trim() || null)}
              onOpenChange={(v) => {
                setCtxOpen(v)
                if (!v) setCtxPayload(null)
              }}
            />

            <NodeRemarkModal open={remarkNodeId != null} nodeId={remarkNodeId} onClose={() => setRemarkNodeId(null)} />

          </div>

          <div className="canvas-frame pointer-events-none absolute inset-0 rounded-[24px] border border-[var(--border-color)]" />
        </div>
      </div>

      <SettingsDialog open={settingsOpen} onClose={() => setSettingsOpen(false)} />
      
      <DownloadModal 
        open={downloadModalOpen} 
        onClose={() => setDownloadModalOpen(false)} 
      />
      
      <PromptLibraryModal
        open={promptLibraryOpen}
        onClose={() => setPromptLibraryOpen(false)}
        onInsert={(text) => {
          // 插入提示词到剪贴板，用户可以粘贴到任何地方
          navigator.clipboard.writeText(text).then(() => {
            window.$message?.success?.('已复制到剪贴板')
          }).catch(() => {
            window.$message?.error?.('复制失败')
          })
        }}
      />
      
      <WorkflowTemplatesModal
        open={workflowTemplatesOpen}
        onClose={() => setWorkflowTemplatesOpen(false)}
        onSelectTemplate={(templateId) => {
          const template = getWorkflowById(templateId)
          if (template && template.createNodes) {
            const vp = useGraphStore.getState().viewport
            const el = canvasWrapRef.current
            let startPosition = { x: 100, y: 100 }
            if (el) {
              const rect = el.getBoundingClientRect()
              const z = vp.zoom || 1
              startPosition = {
                x: (rect.width * 0.3 - vp.x) / z,
                y: (rect.height * 0.3 - vp.y) / z
              }
            }
            const { nodes: newNodes, edges: newEdges } = template.createNodes(startPosition)
            const store = useGraphStore.getState()
            newNodes.forEach((n: any) => {
              store.addNode(n.type, n.position, n.data)
            })
            // 延迟添加边，确保节点已创建
            setTimeout(() => {
              newEdges.forEach((e: any) => {
                store.addEdge(e.source, e.target, { sourceHandle: e.sourceHandle, targetHandle: e.targetHandle })
              })
            }, 100)
            window.$message?.success?.(`已添加「${template.name}」工作流模板`)
          }
        }}
      />

      <DirectorConsole
        open={directorOpen}
        onClose={() => setDirectorOpen(false)}
        onCreateNodes={(payload) => {
          const store = useGraphStore.getState()
          const vp = store.viewport
          const el = canvasWrapRef.current
          let startX = 100, startY = 100
          if (el) {
            const rect = el.getBoundingClientRect()
            const z = vp.zoom || 1
            startX = (rect.width * 0.2 - vp.x) / z
            startY = (rect.height * 0.2 - vp.y) / z
          }
          
          // 单图预设模式：直接创建图片节点
          if (payload.singleImageUrl) {
            const imageId = store.addNode('image', { x: startX, y: startY }, {
              label: '导演台生成',
              url: payload.singleImageUrl
            })
            
            // 创建提示词节点
            if (payload.singleImagePrompt) {
              const textId = store.addNode('text', { x: startX - 350, y: startY }, {
                label: '提示词',
                content: payload.singleImagePrompt
              })
            }
            
            // 同步到历史素材
            useAssetsStore.getState().addAsset({
              type: 'image',
              src: payload.singleImageUrl,
              title: payload.singleImagePrompt?.slice(0, 50) || '导演台生成',
              model: payload.imageModel
            })
            
            window.$message?.success?.('已添加图片到画布')
            setDirectorOpen(false)
            return
          }
          
          // 分镜模式：创建分镜节点
          const spacing = 400
          payload.shots.forEach((shot, index) => {
            const textId = store.addNode('text', { x: startX, y: startY + index * 200 }, {
              label: `分镜 ${index + 1}`,
              content: shot
            })
            // 根据模型 sizes/qualities，把“比例/分辨率”映射到 imageConfig 的 size/quality
            const modelKey = String(payload.imageModel || DEFAULT_IMAGE_MODEL)
            const modelCfg: any = (IMAGE_MODELS as any[]).find((m: any) => m?.key === modelKey) || (IMAGE_MODELS as any[])[0]
            const desiredAspect = String(payload.aspectRatio || '').trim()
            const desiredQuality = String((payload as any).imageQuality || '').trim()

            const normalizeSizeKeys = (sizes: any) => {
              const arr = Array.isArray(sizes) ? sizes : []
              const out: string[] = []
              for (const it of arr) {
                if (typeof it === 'string') out.push(it)
                else if (it && typeof it === 'object') {
                  const k = String((it as any).key || (it as any).label || '').trim()
                  if (k) out.push(k)
                }
              }
              return out.filter(Boolean)
            }
            const parseAspectRatioToNumber = (raw: string) => {
              const v = String(raw || '').trim()
              const m = v.match(/^(\d+(?:\.\d+)?)\s*:\s*(\d+(?:\.\d+)?)$/)
              if (!m) return NaN
              const a = Number(m[1])
              const b = Number(m[2])
              if (!Number.isFinite(a) || !Number.isFinite(b) || a <= 0 || b <= 0) return NaN
              return a / b
            }
            const parseSizeKeyToRatio = (key: string) => {
              const v = String(key || '').trim()
              if (!v) return NaN
              if (/^\d{3,5}x\d{3,5}$/i.test(v)) {
                const [w, h] = v.toLowerCase().split('x').map((x) => Number(x))
                if (!Number.isFinite(w) || !Number.isFinite(h) || h <= 0) return NaN
                return w / h
              }
              return parseAspectRatioToNumber(v)
            }
            const pickBestSize = (cfg: any, desired: string) => {
              const keys = normalizeSizeKeys(cfg?.sizes)
              if (!desired) return String(cfg?.defaultParams?.size || keys[0] || '')
              if (keys.includes(desired)) return desired
              const target = parseAspectRatioToNumber(desired)
              if (!Number.isFinite(target) || keys.length === 0) return String(cfg?.defaultParams?.size || keys[0] || desired)
              let best = keys[0]
              let bestDiff = Number.POSITIVE_INFINITY
              for (const k of keys) {
                const r = parseSizeKeyToRatio(k)
                if (!Number.isFinite(r)) continue
                const diff = Math.abs(r - target)
                if (diff < bestDiff) {
                  bestDiff = diff
                  best = k
                }
              }
              return best
            }
            const pickBestQuality = (cfg: any, desired: string) => {
              const list: any[] = Array.isArray(cfg?.qualities) ? cfg.qualities : []
              if (!desired || list.length === 0) return ''
              const dv = desired.toLowerCase()
              for (const it of list) {
                const k = String((it as any)?.key || it || '').trim()
                if (!k) continue
                if (k.toLowerCase() === dv) return k
              }
              return ''
            }

            const cfgData: any = {
              label: `分镜 ${index + 1}`,
              model: modelKey,
              size: pickBestSize(modelCfg, desiredAspect),
            }
            const q = pickBestQuality(modelCfg, desiredQuality)
            if (q) cfgData.quality = q

            const configId = store.addNode('imageConfig', { x: startX + spacing, y: startY + index * 200 }, cfgData)
            store.addEdge(textId, configId, { sourceHandle: 'right', targetHandle: 'left' })
          })
          
          window.$message?.success?.(`已创建 ${payload.shots.length} 个分镜节点`)
          setDirectorOpen(false)
        }}
      />
      
      <SketchEditor
        open={sketchOpen}
        onClose={() => setSketchOpen(false)}
        onGenerate={(data) => {
          const store = useGraphStore.getState()
          const vp = store.viewport
          const el = canvasWrapRef.current
          let x = 100, y = 100
          if (el) {
            const rect = el.getBoundingClientRect()
            const z = vp.zoom || 1
            x = (rect.width * 0.5 - vp.x) / z
            y = (rect.height * 0.5 - vp.y) / z
          }
          
          if (data.mode === 'image') {
            // 创建图片配置节点，使用草图作为参考
            const imageId = store.addNode('image', { x, y }, {
              label: '草图',
              url: data.sketch
            })
            const configId = store.addNode('imageConfig', { x: x + 400, y }, {
              label: '草图生图',
              model: (() => { const ud = useSettingsStore.getState().defaultImageModel; return (ud && (IMAGE_MODELS as any[]).some((m: any) => m.key === ud)) ? ud : DEFAULT_IMAGE_MODEL })()
            })
            store.addEdge(imageId, configId, { sourceHandle: 'right', targetHandle: 'left' })
            
            if (data.prompt) {
              const textId = store.addNode('text', { x: x + 400, y: y - 150 }, {
                label: '提示词',
                content: data.prompt
              })
              store.addEdge(textId, configId, { sourceHandle: 'right', targetHandle: 'left' })
            }
          } else {
            // 视频模式
            const imageId = store.addNode('image', { x, y }, {
              label: '草图',
              url: data.sketch
            })
            const configId = store.addNode('videoConfig', { x: x + 400, y }, {
              label: '草图生视频',
              model: (() => { const ud = useSettingsStore.getState().defaultVideoModel; return (ud && (VIDEO_MODELS as any[]).some((m: any) => m.key === ud)) ? ud : DEFAULT_VIDEO_MODEL })()
            })
            store.addEdge(imageId, configId, { sourceHandle: 'right', targetHandle: 'left' })
          }
          
          window.$message?.success?.('草图已添加到画布')
          setSketchOpen(false)
        }}
      />
      
      <SonicStudio
        open={audioOpen}
        onClose={() => setAudioOpen(false)}
        onAddToCanvas={(data) => {
          const store = useGraphStore.getState()
          const vp = store.viewport
          const el = canvasWrapRef.current
          let x = 100, y = 100
          if (el) {
            const rect = el.getBoundingClientRect()
            const z = vp.zoom || 1
            x = (rect.width * 0.5 - vp.x) / z
            y = (rect.height * 0.5 - vp.y) / z
          }
          
          // 创建音频节点（如果有 audio 类型节点，否则用 text 节点存储链接）
          store.addNode('text', { x, y }, {
            label: data.title || '音频',
            content: `音频链接: ${data.src}\n模型: ${data.model || 'unknown'}`
          })
          
          window.$message?.success?.('音频已添加到画布')
          setAudioOpen(false)
        }}
      />
      
      <BlendToolPanel
        open={blendToolOpen}
        onClose={() => setBlendToolOpen(false)}
        onAddToCanvas={(imageData, fileName) => {
          const store = useGraphStore.getState()
          const vp = store.viewport
          const el = canvasWrapRef.current
          let x = 100, y = 100
          if (el) {
            const rect = el.getBoundingClientRect()
            const z = vp.zoom || 1
            x = (rect.width * 0.5 - vp.x) / z
            y = (rect.height * 0.5 - vp.y) / z
          }

          // 创建融合结果 image 节点
          const newNodeId = store.addNode('image', { x, y }, {
            label: fileName || '融合结果',
            url: imageData,
            base64: imageData,
            createdAt: Date.now()
          })

          // 保存到 IndexedDB
          const projectId = store.projectId || 'default'
          saveMedia({
            nodeId: newNodeId,
            projectId,
            type: 'image',
            data: imageData,
          }).catch(() => null)

          window.$message?.success?.('融合结果已添加到画布')
        }}
      />
      
      <PromptReverseModal
        open={promptReverseOpen}
        onClose={() => setPromptReverseOpen(false)}
      />

      <CameraControlModal
        open={cameraControlOpen}
        onClose={() => setCameraControlOpen(false)}
        projectId={projectId}
      />
      
      {historyPanelOpen && (
        <div className="fixed right-0 top-0 z-40 h-full">
          <HistoryPanel 
            onClose={() => setHistoryPanelOpen(false)}
            onAddToCanvas={(asset) => {
              const vp = useGraphStore.getState().viewport
              const wrap = canvasWrapRef.current
              const rect = wrap?.getBoundingClientRect()
              const z = vp.zoom || 1
              const center = rect
                ? { x: (rect.width * 0.5 - vp.x) / z, y: (rect.height * 0.5 - vp.y) / z }
                : { x: (-vp.x + 600) / z, y: (-vp.y + 360) / z }
              const kind = asset.type === 'video' ? 'video' : asset.type === 'audio' ? 'audio' : 'image'
              const id = addNode(kind, { x: center.x - 120, y: center.y - 80 }, {
                label: asset.title || (kind === 'video' ? '视频' : kind === 'audio' ? '音频' : '图片'),
                url: asset.src,
                sourceUrl: asset.src,
                model: asset.model,
                duration: asset.duration,
                createdAt: Date.now()
              })
              setSelected(id)
            }}
          />
        </div>
      )}

      {/* 画布右键菜单 - 添加节点 */}
      {canvasContextMenu && (
        <div
          className="fixed z-[9999] w-[200px] rounded-xl border border-[var(--border-color)] bg-[var(--bg-secondary)] shadow-xl py-1"
          style={{ left: canvasContextMenu.x, top: canvasContextMenu.y }}
          onClick={(e) => e.stopPropagation()}
        >
          <div className="px-3 py-2 text-xs text-[var(--text-secondary)] font-medium">添加节点</div>
          {contextMenuNodeOptions.map((opt) => (
            <button
              key={opt.type}
              onClick={() => spawnNodeFromContextMenu(opt.type)}
              className="flex w-full items-center gap-3 px-3 py-2 text-left hover:bg-[var(--bg-tertiary)] transition-colors"
            >
              <opt.Icon className="h-4 w-4" style={{ color: opt.color }} />
              <span className="text-sm text-[var(--text-primary)]">{opt.name}</span>
            </button>
          ))}
        </div>
      )}

      {/* 连接线拖拽菜单 - 快速添加并连接节点 */}
      {connectMenu && (
        <div
          className="fixed z-[9999] w-[200px] rounded-xl border border-[var(--border-color)] bg-[var(--bg-secondary)] shadow-xl py-1"
          style={{ left: connectMenu.x, top: connectMenu.y }}
          onClick={(e) => e.stopPropagation()}
        >
          <div className="px-3 py-2 text-xs text-[var(--text-secondary)] font-medium">连接到新节点</div>
          {getConnectMenuOptions(connectMenu.sourceNodeType).map((opt) => (
            <button
              key={opt.type}
              onClick={() => spawnNodeFromConnectMenu(opt.type)}
              className="flex w-full items-center gap-3 px-3 py-2 text-left hover:bg-[var(--bg-tertiary)] transition-colors"
            >
              <opt.Icon className="h-4 w-4" style={{ color: opt.color }} />
              <span className="text-sm text-[var(--text-primary)]">{opt.name}</span>
            </button>
          ))}
          <div className="border-t border-[var(--border-color)] mt-1 pt-1">
            <button
              onClick={() => setConnectMenu(null)}
              className="flex w-full items-center gap-3 px-3 py-2 text-left hover:bg-[var(--bg-tertiary)] transition-colors text-[var(--text-secondary)]"
            >
              <span className="text-sm">取消</span>
            </button>
          </div>
        </div>
      )}

      {/* 连接菜单文件选择器（隐藏） */}
      <input
        ref={connectMenuFileInputRef}
        type="file"
        className="hidden"
        onChange={handleConnectMenuFileSelect}
      />

      {/* 右键菜单文件选择器（隐藏） */}
      <input
        ref={contextMenuFileInputRef}
        type="file"
        className="hidden"
        onChange={handleContextMenuFileSelect}
      />

      {/* 保存模板弹窗 */}
      {saveTemplateOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm"
          onClick={() => setSaveTemplateOpen(false)}
        >
          <div
            className="w-[400px] rounded-2xl border border-[var(--border-color)] bg-[var(--bg-secondary)] p-6 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="text-lg font-semibold text-[var(--text-primary)] mb-4">保存为模板</h2>
            <div className="space-y-4">
              <div>
                <label className="block text-sm text-[var(--text-secondary)] mb-1">模板名称</label>
                <input
                  type="text"
                  value={saveTemplateName}
                  onChange={(e) => setSaveTemplateName(e.target.value)}
                  placeholder="输入模板名称"
                  className="w-full px-3 py-2 rounded-lg border border-[var(--border-color)] bg-[var(--bg-primary)] text-[var(--text-primary)] placeholder-[var(--text-secondary)] focus:outline-none focus:border-[var(--accent-color)]"
                  autoFocus
                />
              </div>
              <div>
                <label className="block text-sm text-[var(--text-secondary)] mb-1">描述（可选）</label>
                <textarea
                  value={saveTemplateDesc}
                  onChange={(e) => setSaveTemplateDesc(e.target.value)}
                  placeholder="简要描述此模板的用途"
                  rows={3}
                  className="w-full px-3 py-2 rounded-lg border border-[var(--border-color)] bg-[var(--bg-primary)] text-[var(--text-primary)] placeholder-[var(--text-secondary)] focus:outline-none focus:border-[var(--accent-color)] resize-none"
                />
              </div>
            </div>
            <div className="flex justify-end gap-3 mt-6">
              <button
                onClick={() => setSaveTemplateOpen(false)}
                className="px-4 py-2 rounded-lg text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)] transition-colors"
              >
                取消
              </button>
              <button
                onClick={confirmSaveTemplate}
                className="px-4 py-2 rounded-lg bg-[var(--accent-color)] text-white hover:bg-[var(--accent-hover)] transition-colors"
              >
                保存
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
