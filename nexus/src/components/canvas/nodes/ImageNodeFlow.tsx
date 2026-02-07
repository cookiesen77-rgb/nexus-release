/**
 * ImageNodeFlow - React Flow 版本的图片节点
 * 显示生成的图片或上传的参考图
 * 参考 Vue 版本 ImageNode.vue 实现侧边功能
 * 
 * 性能优化：使用 IntersectionObserver 实现懒加载
 */
import React, { memo, useState, useCallback, useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { Handle, Position, NodeProps } from '@xyflow/react'
import { Trash2, Download, Expand, Loader2, Copy, ImageIcon, Crop, Eye, Video, RefreshCw } from 'lucide-react'
import { useGraphStore } from '@/graph/store'
import { getMedia, getMediaByNodeId, saveMedia } from '@/lib/mediaStorage'
import { downloadFile } from '@/lib/download'
import { cacheMedia } from '@/lib/workflow/cache'
import { DEFAULT_IMAGE_MODEL, DEFAULT_VIDEO_MODEL, IMAGE_MODELS, VIDEO_MODELS } from '@/config/models'
import { useInView } from '@/hooks/useInView'
import ImageCropModal from '@/components/canvas/ImageCropModal'
import MediaPreviewModal from '@/components/canvas/MediaPreviewModal'
import ImageEditToolbar from '@/components/canvas/ImageEditToolbar'

// 检测 Tauri 环境
const isTauri = typeof window !== 'undefined' && !!(window as any).__TAURI_INTERNALS__

interface ImageNodeData {
  label?: string
  url?: string
  sourceUrl?: string  // 原始 HTTPS URL（用于下载和恢复）
  mediaId?: string    // IndexedDB 媒体 ID（用于恢复大型数据）
  loading?: boolean
  error?: string
}

export const ImageNodeComponent = memo(function ImageNode({ id, data, selected }: NodeProps) {
  const nodeData = data as ImageNodeData
  const [showActions, setShowActions] = useState(false)
  const [editToolbarBusy, setEditToolbarBusy] = useState(false)
  const [editToolbarHover, setEditToolbarHover] = useState(false)
  const [cropModalOpen, setCropModalOpen] = useState(false)
  const [previewModalOpen, setPreviewModalOpen] = useState(false)
  const persistAttemptedRef = React.useRef<string>('')
  const loadErrorFallbackRef = React.useRef<string>('')
  
  // 计算此图片作为参考图时的序号
  const [refIndex, setRefIndex] = useState<number | null>(null)
  
  // 计算序号的函数
  const computeRefIndex = useCallback(() => {
    const state = useGraphStore.getState()
    const byId = new Map(state.nodes.map(n => [n.id, n]))
    // 找到从此节点出发连接到 imageConfig 或 videoConfig 的边
    const outgoingEdges = state.edges.filter(e => e.source === id)
    for (const edge of outgoingEdges) {
      const targetNode = byId.get(edge.target)
      if (!targetNode) continue

      // 仅 imageConfig：参考图顺序来自 edge.data.imageOrder（支持在配置节点中手动调整）
      if (targetNode.type === 'imageConfig') {
        const configId = targetNode.id
        const inputEdges = state.edges.filter(e => e.target === configId)
        const imageInputs = inputEdges
          .map((e, idx) => {
            const n = byId.get(e.source)
            if (!n || n.type !== 'image') return null
            const orderRaw = Number((e.data as any)?.imageOrder)
            const order = Number.isFinite(orderRaw) && orderRaw > 0 ? orderRaw : 999999
            return { nodeId: n.id, idx, order }
          })
          .filter(Boolean) as { nodeId: string; idx: number; order: number }[]

        imageInputs.sort((a, b) => (a.order - b.order) || (a.idx - b.idx))
        const idx = imageInputs.findIndex(n => n.nodeId === id)
        if (imageInputs.length > 1 && idx >= 0) return idx + 1
      }

      // 保持兼容：videoConfig 仍按原逻辑给出参考序号（主要用于标识多图引用场景）
      if (targetNode.type === 'videoConfig') {
        const configId = targetNode.id
        const inputEdges = state.edges.filter(e => e.target === configId)
        const imageInputs = inputEdges
          .map(e => byId.get(e.source))
          .filter(n => n?.type === 'image') as any[]
        const idx = imageInputs.findIndex(n => n?.id === id)
        if (imageInputs.length > 1 && idx >= 0) return idx + 1
      }
    }
    return null
  }, [id])
  
  // 订阅边变化以更新序号
  useEffect(() => {
    // 初始计算
    setRefIndex(computeRefIndex())
    
    // 订阅边的变化
    const unsubscribe = useGraphStore.subscribe(
      (state, prevState) => {
        if (state.edges !== prevState.edges) {
          setRefIndex(computeRefIndex())
        }
      }
    )
    return unsubscribe
  }, [computeRefIndex])
  
  // 懒加载：只有节点进入可视区域时才加载图片
  const { ref: inViewRef, inView } = useInView({
    rootMargin: '200px', // 提前 200px 开始加载
    triggerOnce: true,   // 一旦加载过就不再卸载
  })

  // 如果没有 url，尝试从 IndexedDB 或 sourceUrl 恢复
  // 优先级：1. IndexedDB (mediaId) 2. sourceUrl (HTTPS URL)
  // 使用 ref 防止重复尝试
  const loadAttemptedRef = React.useRef(false)

  useEffect(() => {
    const currentUrl = String(nodeData?.url || '').trim()
    // blob: URLs are not persistent across reloads — treat as empty
    const urlIsUsable = currentUrl && !currentUrl.startsWith('blob:')

    if (urlIsUsable || nodeData?.loading || nodeData?.error) {
      return
    }

    if (!nodeData?.mediaId && !nodeData?.sourceUrl) {
      return
    }

    if (loadAttemptedRef.current) {
      return
    }

    loadAttemptedRef.current = true
    
    const loadMedia = async () => {
      try {
        // 1. 首先尝试通过 mediaId 从 IndexedDB 加载
        if (nodeData?.mediaId) {
          console.log('[ImageNode] 从 IndexedDB 加载图片, mediaId:', nodeData.mediaId)
          const record = await getMedia(nodeData.mediaId)
          if (record?.data) {
            useGraphStore.getState().updateNode(id, {
              data: { url: record.data, loading: false }
            } as any)
            return
          }
        }
        
        // 2. 尝试通过 nodeId 从 IndexedDB 查找
        console.log('[ImageNode] 通过 nodeId 从 IndexedDB 查找:', id)
        const recordByNode = await getMediaByNodeId(id)
        if (recordByNode?.data) {
          useGraphStore.getState().updateNode(id, {
            data: { 
              url: recordByNode.data, 
              mediaId: recordByNode.id,
              loading: false 
            }
          } as any)
          return
        }
        
        // 3. 如果有 sourceUrl（HTTPS URL），直接使用
        if (nodeData?.sourceUrl && nodeData.sourceUrl.startsWith('http')) {
          console.log('[ImageNode] 使用 sourceUrl:', nodeData.sourceUrl.slice(0, 50))
          useGraphStore.getState().updateNode(id, {
            data: { url: nodeData.sourceUrl, loading: false }
          } as any)
          return
        }
        
        console.log('[ImageNode] 无法恢复图片数据，节点需要重新生成')
      } catch (err) {
        console.error('[ImageNode] 加载媒体失败:', err)
      }
    }
    
    loadMedia()
  }, [id, nodeData?.url, nodeData?.mediaId, nodeData?.sourceUrl, nodeData?.loading, nodeData?.error])

  // 当 sourceUrl 变化时，允许重新触发一次“直链失败 -> 缓存兜底”
  useEffect(() => {
    loadErrorFallbackRef.current = ''
  }, [nodeData?.sourceUrl])

  // 若当前 url 为 dataURL/纯 base64 且尚未落库，则写入 IndexedDB 并写回 mediaId（跨重启）
  useEffect(() => {
    const url = String(nodeData?.url || '').trim()
    if (!url) return
    if (nodeData?.mediaId) return
    if (persistAttemptedRef.current === url) return

    const isHttp = /^https?:\/\//i.test(url)
    const isDataUrl = url.startsWith('data:')
    const isBase64Like = !isHttp && url.length > 50000
    if (!isDataUrl && !isBase64Like) return

    persistAttemptedRef.current = url

    const persist = async () => {
      try {
        const store = useGraphStore.getState()
        const projectId = store.projectId || 'default'
        const mediaId = await saveMedia({
          nodeId: id,
          projectId,
          type: 'image',
          data: url,
          sourceUrl: typeof nodeData?.sourceUrl === 'string' && /^https?:\/\//i.test(nodeData.sourceUrl) ? nodeData.sourceUrl : undefined,
          model: typeof (nodeData as any)?.model === 'string' ? (nodeData as any).model : undefined,
        })
        if (mediaId) {
          // Save mediaId and, if sourceUrl exists, swap display to sourceUrl to avoid
          // storing huge data: URLs in localStorage graph state (prevents quota overflow)
          const httpSource = typeof nodeData?.sourceUrl === 'string' && /^https?:\/\//i.test(nodeData.sourceUrl) ? nodeData.sourceUrl : ''
          if (httpSource && url.length > 100000) {
            store.patchNodeDataSilent(id, { mediaId, url: httpSource })
          } else {
            store.patchNodeDataSilent(id, { mediaId })
          }
        }
      } catch {
        // ignore
      }
    }
    void persist()
  }, [id, nodeData?.url, nodeData?.mediaId, nodeData?.sourceUrl])

  const handleDelete = useCallback((e: React.MouseEvent) => {
    e.stopPropagation()
    useGraphStore.getState().removeNode(id)
  }, [id])

  const handleDuplicate = useCallback((e: React.MouseEvent) => {
    e.stopPropagation()
    const store = useGraphStore.getState()
    const node = store.nodes.find((n) => n.id === id)
    if (node) {
      store.addNode('image', { x: node.x + 50, y: node.y + 50 }, { ...node.data })
    }
  }, [id])

  const handleDownload = useCallback(async (e: React.MouseEvent) => {
    e.stopPropagation()
    if (!nodeData?.url) {
      window.$message?.warning?.('暂无图片可下载')
      return
    }
    
    // 优先使用 sourceUrl（原始 HTTPS URL），避免 asset:// URL 在 Windows 上的问题
    const downloadUrl = (nodeData?.sourceUrl && nodeData.sourceUrl.startsWith('http')) 
      ? nodeData.sourceUrl 
      : nodeData.url
    
    console.log('[ImageNode] 下载图片, URL类型:', 
      downloadUrl.startsWith('data:') ? 'data:' : 
      downloadUrl.startsWith('asset:') ? 'asset:' : 
      downloadUrl.startsWith('http') ? 'http' : 'unknown'
    )
    
    try {
      const success = await downloadFile({
        url: downloadUrl,
        filename: `image_${id}_${Date.now()}.png`,
        mimeType: 'image/png'
      })
      if (success) {
        window.$message?.success?.('下载成功')
      }
    } catch (err: any) {
      console.error('[ImageNode] 下载失败:', err)
      window.$message?.error?.(`下载失败: ${err?.message || '未知错误'}`)
    }
  }, [id, nodeData?.url])

  // 图片生图 - 创建文本节点 + imageConfig 节点并连接
  const handleImageGen = useCallback((e: React.MouseEvent) => {
    e.stopPropagation()
    const store = useGraphStore.getState()
    const node = store.nodes.find((n) => n.id === id)
    if (node) {
      const baseModelCfg: any = (IMAGE_MODELS as any[]).find((m: any) => m.key === DEFAULT_IMAGE_MODEL) || (IMAGE_MODELS as any[])[0]
      
      // 创建文本节点（提示词输入）
      const textNodeId = store.addNode(
        'text',
        { x: node.x + 350, y: node.y - 120 },
        { label: '提示词', content: '' }
      )
      
      // 创建 imageConfig 节点
      const configNodeId = store.addNode(
        'imageConfig',
        { x: node.x + 350, y: node.y + 80 },
        { 
          label: '图生图',
          model: DEFAULT_IMAGE_MODEL,
          size: '1:1',
          quality: baseModelCfg?.defaultParams?.quality,
        }
      )
      
      // 连接：文本节点 → imageConfig（提示词）
      store.addEdge(textNodeId, configNodeId, { sourceHandle: 'right', targetHandle: 'left' })
      // 连接：图片节点 → imageConfig（参考图）
      store.addEdge(id, configNodeId, { sourceHandle: 'right', targetHandle: 'left' })
      
      // 选中文本节点，方便用户直接输入
      store.setSelected(textNodeId)
    }
  }, [id])

  // 裁剪功能
  const handleCrop = useCallback((e: React.MouseEvent) => {
    e.stopPropagation()
    if (!nodeData?.url) {
      window.$message?.warning?.('暂无图片可裁剪')
      return
    }
    setCropModalOpen(true)
  }, [nodeData?.url])

  // 裁剪完成回调
  const handleCropComplete = useCallback((croppedDataUrl: string) => {
    // 创建新的图片节点，保留原图
    const store = useGraphStore.getState()
    const node = store.nodes.find((n) => n.id === id)
    if (node) {
      store.addNode('image', { x: node.x + 50, y: node.y + 50 }, {
        label: '裁剪图',
        url: croppedDataUrl
      })
      window.$message?.success?.('裁剪完成，已创建新节点')
    }
  }, [id])

  // 预览功能 - 在应用内模态框中显示
  // 优先使用 sourceUrl（原始 HTTPS URL），避免 Windows 上的渲染问题
  const previewUrl = (nodeData?.sourceUrl && nodeData.sourceUrl.startsWith('http')) 
    ? nodeData.sourceUrl 
    : nodeData?.url
  
  const handlePreview = useCallback((e: React.MouseEvent) => {
    e.stopPropagation()
    if (!nodeData?.url) {
      window.$message?.warning?.('暂无图片可预览')
      return
    }
    setPreviewModalOpen(true)
  }, [nodeData?.url])

  // 视频生成 - 创建文本节点 + videoConfig 节点并连接
  const handleVideoGen = useCallback((e: React.MouseEvent) => {
    e.stopPropagation()
    const store = useGraphStore.getState()
    const node = store.nodes.find((n) => n.id === id)
    if (node) {
      const baseModelCfg: any = (VIDEO_MODELS as any[]).find((m: any) => m.key === DEFAULT_VIDEO_MODEL) || (VIDEO_MODELS as any[])[0]
      
      // 创建文本节点（提示词输入）
      const textNodeId = store.addNode(
        'text',
        { x: node.x + 350, y: node.y - 120 },
        { label: '提示词', content: '' }
      )
      
      // 创建 videoConfig 节点
      const configNodeId = store.addNode(
        'videoConfig',
        { x: node.x + 350, y: node.y + 80 },
        { 
          label: '图生视频',
          model: DEFAULT_VIDEO_MODEL,
          ratio: baseModelCfg?.defaultParams?.ratio,
          dur: baseModelCfg?.defaultParams?.duration,
          size: baseModelCfg?.defaultParams?.size,
        }
      )
      
      // 连接：文本节点 → videoConfig（提示词）
      store.addEdge(textNodeId, configNodeId, { sourceHandle: 'right', targetHandle: 'left' })
      // 连接：图片节点 → videoConfig（首帧图片）
      store.addEdge(id, configNodeId, { sourceHandle: 'right', targetHandle: 'left' })
      
      // 选中文本节点，方便用户直接输入
      store.setSelected(textNodeId)
    }
  }, [id])

  // 替换图片功能
  const replaceInputRef = useRef<HTMLInputElement>(null)

  const handleReplaceClick = useCallback(async (e: React.MouseEvent) => {
    e.stopPropagation()
    
    if (isTauri) {
      // Tauri 环境：使用 dialog API
      try {
        const { open } = await import('@tauri-apps/plugin-dialog')
        const { readFile } = await import('@tauri-apps/plugin-fs')
        
        const result = await open({
          multiple: false,
          filters: [{ name: '图片文件', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'svg'] }],
          title: '选择图片'
        })
        
        if (result && typeof result === 'string') {
          const fileData = await readFile(result)
          const fileName = result.split('/').pop() || result.split('\\').pop() || 'image'
          const ext = fileName.split('.').pop()?.toLowerCase() || 'png'
          const mimeMap: Record<string, string> = { 
            png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', 
            gif: 'image/gif', webp: 'image/webp', bmp: 'image/bmp', svg: 'image/svg+xml' 
          }
          const mimeType = mimeMap[ext] || 'image/png'
          
          const blob = new Blob([fileData], { type: mimeType })
          const dataUrl = await new Promise<string>((resolve) => {
            const reader = new FileReader()
            reader.onload = () => resolve(reader.result as string)
            reader.readAsDataURL(blob)
          })
          
          const store = useGraphStore.getState()
          const projectId = store.projectId || 'default'
          
          store.updateNode(id, {
            data: {
              url: dataUrl,
              sourceUrl: '',
              mediaId: undefined,
              label: fileName || nodeData?.label || '图片',
              loading: false,
            }
          })
          
          // 保存到 IndexedDB
          try {
            const mediaId = await saveMedia({
              nodeId: id,
              projectId,
              type: 'image',
              data: dataUrl,
            })
            if (mediaId) {
              store.patchNodeDataSilent(id, { mediaId })
            }
          } catch {
            // ignore
          }
          
          window.$message?.success?.('图片已替换')
        }
      } catch {
        // ignore
      }
    } else {
      // Web 环境：使用原生 file input
      replaceInputRef.current?.click()
    }
  }, [id, nodeData?.label])

  const handleReplaceFile = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    // 读取文件为 DataURL
    const reader = new FileReader()
    reader.onload = async (event) => {
      const dataUrl = event.target?.result as string
      if (!dataUrl) return

      const store = useGraphStore.getState()
      const projectId = store.projectId || 'default'

      // 更新节点 URL
      store.updateNode(id, {
        data: {
          url: dataUrl,
          sourceUrl: '',
          mediaId: undefined,
          label: file.name || nodeData?.label || '图片',
          loading: false,
          error: undefined
        }
      } as any)

      // 异步保存到 IndexedDB
      try {
        const mediaId = await saveMedia({
          nodeId: id,
          projectId,
          type: 'image',
          data: dataUrl,
        })
        if (mediaId) {
          store.patchNodeDataSilent(id, { mediaId })
        }
      } catch {
        // ignore
      }

      window.$message?.success?.('图片已替换')
    }
    reader.readAsDataURL(file)

    // 清理 input
    e.target.value = ''
  }, [id, nodeData?.label])

  return (
    // 外层 wrapper 提供悬浮按钮空间（参考 Vue 版本）
    // ref 用于懒加载检测
    <div
      ref={inViewRef}
      className="relative pr-[50px] pt-[20px]"
      onMouseEnter={() => setShowActions(true)}
      onMouseLeave={() => !editToolbarBusy && !editToolbarHover && setShowActions(false)}
    >
      {/* 节点主体 */}
      <div
        className={`image-node bg-[var(--bg-secondary)] rounded-xl border min-w-[260px] relative transition-all duration-200 ${
          selected ? 'border-blue-500 shadow-lg shadow-blue-500/20' : 'border-[var(--border-color)]'
        }`}
      >
        {/* 头部 */}
        <div className="flex items-center justify-between px-3 py-2 border-b border-[var(--border-color)]">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium text-[var(--text-secondary)]">
              {nodeData?.label || '图片'}
            </span>
            {refIndex && (
              <span className="px-1.5 py-0.5 text-xs font-bold bg-[var(--accent-color)] text-white rounded">
                参考图{refIndex}
              </span>
            )}
          </div>
          <div className="flex items-center gap-1">
            <button onClick={handleDelete} className="p-1 hover:bg-[var(--bg-tertiary)] rounded">
              <Trash2 size={14} />
            </button>
            <button className="p-1 hover:bg-[var(--bg-tertiary)] rounded">
              <Expand size={14} />
            </button>
          </div>
        </div>

        {/* 图片内容 - 支持懒加载 */}
        <div className="p-3 min-h-[200px] flex items-center justify-center overflow-hidden rounded-lg">
          {/* 懒加载占位符：节点不在可视区域且无已有图片时显示 */}
          {!inView && !nodeData?.url && !nodeData?.loading ? (
            <div className="flex flex-col items-center gap-2 text-[var(--text-secondary)]">
              <ImageIcon size={32} className="opacity-50" />
              <span className="text-sm opacity-50">滚动到此处加载</span>
            </div>
          ) : nodeData?.loading ? (
            <div className="flex flex-col items-center gap-2 text-[var(--text-secondary)]">
              <Loader2 size={32} className="animate-spin" />
              <span className="text-sm">生成中...</span>
            </div>
          ) : nodeData?.error ? (
            <div className="flex flex-col items-center gap-2 text-red-500 p-4">
              <span className="text-2xl">⚠</span>
              <span className="text-sm text-center">{nodeData.error}</span>
            </div>
          ) : nodeData?.url ? (
            <img
              src={nodeData.url}
              alt={nodeData.label || '图片'}
              className="max-w-full max-h-[300px] object-contain rounded-lg"
              draggable={false}
              loading="lazy"
              onError={() => {
                try {
                  const store = useGraphStore.getState()
                  const cur = store.nodes.find((n) => n.id === id)
                  const curUrl = String((cur?.data as any)?.url || '').trim()
                  const sourceUrl = String((cur?.data as any)?.sourceUrl || '').trim()

                  // Tauri：优先直链（最快），若直链失败再走缓存兜底（可携带 Bearer 下载）
                  if (
                    isTauri &&
                    sourceUrl &&
                    /^https?:\/\//i.test(sourceUrl) &&
                    loadErrorFallbackRef.current !== sourceUrl
                  ) {
                    loadErrorFallbackRef.current = sourceUrl
                    void (async () => {
                      try {
                        const cached = await cacheMedia(sourceUrl, 'general', { forceRefresh: true })
                        const nextUrl = String(cached.displayUrl || '').trim()
                        if (nextUrl && nextUrl !== curUrl) {
                          useGraphStore.getState().updateNode(id, {
                            data: { url: nextUrl, localPath: cached.localPath, error: '' }
                          } as any)
                          return
                        }
                      } catch {
                        // ignore
                      }
                      // 当 URL 无效或图片加载失败时，给出明确错误提示，避免用户误以为“没有呈现在画布上”
                      useGraphStore.getState().updateNode(id, {
                        data: { loading: false, error: '图片加载失败（URL 无效或已过期）' }
                      } as any)
                    })()
                    return
                  }

                  // 非 Tauri / 已兜底过：直接报错
                  store.updateNode(id, { data: { loading: false, error: '图片加载失败（URL 无效或已过期）' } } as any)
                } catch {
                  // ignore
                }
              }}
            />
          ) : (
            <div className="text-sm text-[var(--text-secondary)]">暂无图片</div>
          )}
        </div>

        {/* 连接点 */}
        <Handle type="target" position={Position.Left} id="left" />
        <Handle type="source" position={Position.Right} id="right" />
      </div>

      {/* 图片编辑工具栏（在节点上方，仅在有图片时显示） */}
      {nodeData?.url && (
        <ImageEditToolbar
          nodeId={id}
          imageUrl={nodeData.url}
          visible={showActions || editToolbarBusy || editToolbarHover}
          onBusyChange={setEditToolbarBusy}
          onHoverChange={setEditToolbarHover}
        />
      )}

      {/* 隐藏的替换图片文件选择器 */}
      <input
        ref={replaceInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={handleReplaceFile}
      />

      {/* 右侧操作按钮（只在有图片时显示） */}
      {showActions && nodeData?.url && (
        <div className="absolute right-10 top-1/2 -translate-y-1/2 translate-x-full flex flex-col gap-2 z-[1000]">
          {/* 替换 */}
          <button
            onClick={handleReplaceClick}
            className="group p-2 bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 flex items-center gap-0 hover:gap-1.5 transition-all shadow-sm w-max"
          >
            <RefreshCw size={16} className="text-gray-600 dark:text-gray-300" />
            <span className="text-xs text-gray-600 dark:text-gray-300 max-w-0 overflow-hidden group-hover:max-w-[60px] transition-all duration-200 whitespace-nowrap">
              替换
            </span>
          </button>
          {/* 复制 */}
          <button
            onClick={handleDuplicate}
            className="group p-2 bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 flex items-center gap-0 hover:gap-1.5 transition-all shadow-sm w-max"
          >
            <Copy size={16} className="text-gray-600 dark:text-gray-300" />
            <span className="text-xs text-gray-600 dark:text-gray-300 max-w-0 overflow-hidden group-hover:max-w-[60px] transition-all duration-200 whitespace-nowrap">
              复制
            </span>
          </button>
          {/* 图片生图 */}
          <button
            onClick={handleImageGen}
            className="group p-2 bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 flex items-center gap-0 hover:gap-1.5 transition-all shadow-sm w-max"
          >
            <ImageIcon size={16} className="text-gray-600 dark:text-gray-300" />
            <span className="text-xs text-gray-600 dark:text-gray-300 max-w-0 overflow-hidden group-hover:max-w-[80px] transition-all duration-200 whitespace-nowrap">
              图片生图
            </span>
          </button>
          {/* 裁剪 */}
          <button
            onClick={handleCrop}
            className="group p-2 bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 flex items-center gap-0 hover:gap-1.5 transition-all shadow-sm w-max"
          >
            <Crop size={16} className="text-gray-600 dark:text-gray-300" />
            <span className="text-xs text-gray-600 dark:text-gray-300 max-w-0 overflow-hidden group-hover:max-w-[60px] transition-all duration-200 whitespace-nowrap">
              裁剪
            </span>
          </button>
          {/* 预览 */}
          <button
            onClick={handlePreview}
            className="group p-2 bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 flex items-center gap-0 hover:gap-1.5 transition-all shadow-sm w-max"
          >
            <Eye size={16} className="text-gray-600 dark:text-gray-300" />
            <span className="text-xs text-gray-600 dark:text-gray-300 max-w-0 overflow-hidden group-hover:max-w-[80px] transition-all duration-200 whitespace-nowrap">
              预览
            </span>
          </button>
          {/* 下载 */}
          <button
            onClick={handleDownload}
            className="group p-2 bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 flex items-center gap-0 hover:gap-1.5 transition-all shadow-sm w-max"
          >
            <Download size={16} className="text-gray-600 dark:text-gray-300" />
            <span className="text-xs text-gray-600 dark:text-gray-300 max-w-0 overflow-hidden group-hover:max-w-[60px] transition-all duration-200 whitespace-nowrap">
              下载
            </span>
          </button>
          {/* 视频生成 */}
          <button
            onClick={handleVideoGen}
            className="group p-2 bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 flex items-center gap-0 hover:gap-1.5 transition-all shadow-sm w-max"
          >
            <Video size={16} className="text-gray-600 dark:text-gray-300" />
            <span className="text-xs text-gray-600 dark:text-gray-300 max-w-0 overflow-hidden group-hover:max-w-[80px] transition-all duration-200 whitespace-nowrap">
              视频生成
            </span>
          </button>
        </div>
      )}

      {/* 裁剪弹窗 - 使用 Portal 渲染到 body，避免被 React Flow 节点捕获事件 */}
      {cropModalOpen && nodeData?.url && createPortal(
        <ImageCropModal
          open={cropModalOpen}
          imageUrl={nodeData.url}
          onClose={() => setCropModalOpen(false)}
          onCrop={handleCropComplete}
        />,
        document.body
      )}

      {/* 预览弹窗 - 优先使用 sourceUrl 避免 Windows 黑边问题 */}
      {previewModalOpen && previewUrl && createPortal(
        <MediaPreviewModal
          open={previewModalOpen}
          url={previewUrl}
          type="image"
          onClose={() => setPreviewModalOpen(false)}
        />,
        document.body
      )}
    </div>
  )
})
