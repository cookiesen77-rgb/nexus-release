/**
 * AudioNodeFlow - React Flow 版本的音频节点
 * 完全对齐 Vue 版本 AudioNode.vue 实现
 */
import React, { memo, useState, useCallback, useEffect, useRef } from 'react'
import { Handle, Position, NodeProps } from '@xyflow/react'
import { Trash2, Download, Music, X } from 'lucide-react'
import { useGraphStore } from '@/graph/store'
import { getMedia, getMediaByNodeId, saveMedia } from '@/lib/mediaStorage'

interface AudioNodeData {
  label?: string
  url?: string
  sourceUrl?: string  // 原始 URL（用于从 localStorage 恢复）
  mediaId?: string    // IndexedDB 媒体 ID（用于恢复大型数据）
  loading?: boolean
  error?: string
  model?: string
  duration?: number
  fileName?: string
}

// 格式化时长
const formatDuration = (seconds: number) => {
  if (!seconds || !Number.isFinite(seconds)) return '0:00'
  const mins = Math.floor(seconds / 60)
  const secs = Math.floor(seconds % 60)
  return `${mins}:${secs.toString().padStart(2, '0')}`
}

export const AudioNodeComponent = memo(function AudioNode({ id, data, selected }: NodeProps) {
  const nodeData = data as AudioNodeData
  const [showActions, setShowActions] = useState(false)

  const displayUrl = nodeData?.url || ''
  const loadAttemptedRef = useRef(false)

  // 如果没有 url，尝试从 IndexedDB 或 sourceUrl 恢复（跨重启）
  useEffect(() => {
    if (nodeData?.url || nodeData?.loading || nodeData?.error) return
    if (!nodeData?.mediaId && !nodeData?.sourceUrl) return
    if (loadAttemptedRef.current) return
    loadAttemptedRef.current = true

    const load = async () => {
      try {
        // 1) mediaId 直接取
        if (nodeData?.mediaId) {
          const record = await getMedia(nodeData.mediaId)
          if (record?.data) {
            useGraphStore.getState().updateNode(id, { data: { url: record.data, loading: false } } as any)
            return
          }
        }
        // 2) 按 nodeId 查找
        const recordByNode = await getMediaByNodeId(id)
        if (recordByNode?.data) {
          useGraphStore.getState().updateNode(id, {
            data: { url: recordByNode.data, mediaId: recordByNode.id, loading: false }
          } as any)
          return
        }
        // 3) HTTPS 源地址兜底
        if (nodeData?.sourceUrl && /^https?:\/\//i.test(nodeData.sourceUrl)) {
          useGraphStore.getState().updateNode(id, { data: { url: nodeData.sourceUrl, loading: false } } as any)
        }
      } catch {
        // ignore
      }
    }

    void load()
  }, [id, nodeData?.url, nodeData?.mediaId, nodeData?.sourceUrl, nodeData?.loading, nodeData?.error])

  // 若当前 url 为 dataURL 且尚未落库，则写入 IndexedDB 并写回 mediaId（避免重启丢失）
  const lastPersistedUrlRef = useRef<string>('')
  useEffect(() => {
    const url = String(nodeData?.url || '').trim()
    if (!url.startsWith('data:')) return
    if (nodeData?.mediaId) return
    if (lastPersistedUrlRef.current === url) return
    lastPersistedUrlRef.current = url

    const persist = async () => {
      try {
        const store = useGraphStore.getState()
        const projectId = store.projectId || 'default'
        const mediaId = await saveMedia({
          nodeId: id,
          projectId,
          type: 'audio',
          data: url,
          model: typeof nodeData?.model === 'string' ? nodeData.model : undefined,
        })
        if (mediaId) {
          store.patchNodeDataSilent(id, { mediaId })
        }
      } catch {
        // ignore
      }
    }

    void persist()
  }, [id, nodeData?.url, nodeData?.mediaId, nodeData?.model])

  const handleDelete = useCallback((e: React.MouseEvent) => {
    e.stopPropagation()
    useGraphStore.getState().removeNode(id)
  }, [id])

  const handleDownload = useCallback((e: React.MouseEvent) => {
    e.stopPropagation()
    if (!displayUrl) return
    const link = document.createElement('a')
    link.href = displayUrl
    link.download = nodeData?.fileName || `audio_${Date.now()}.mp3`
    link.click()
  }, [displayUrl, nodeData?.fileName])

  const handleFileUpload = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file) return

    const reader = new FileReader()
    reader.onload = () => {
      const dataUrl = reader.result as string
      const store = useGraphStore.getState()
      const projectId = store.projectId || 'default'
      void (async () => {
        let mediaId: string | undefined
        try {
          mediaId = await saveMedia({
            nodeId: id,
            projectId,
            type: 'audio',
            data: dataUrl,
            sourceUrl: undefined,
            model: typeof (nodeData as any)?.model === 'string' ? (nodeData as any).model : undefined,
          })
        } catch {
          mediaId = undefined
        }
        store.updateNode(id, {
          data: {
            ...(store.nodes.find((n) => n.id === id)?.data as any),
            url: dataUrl,
            sourceUrl: '', // dataURL 不作为长期 source
            mediaId,
            fileName: file.name,
          },
        } as any)
      })()
    }
    reader.readAsDataURL(file)
  }, [id])

  return (
    <div
      className="relative"
      onMouseEnter={() => setShowActions(true)}
      onMouseLeave={() => setShowActions(false)}
    >
      {/* 节点主体 */}
      <div
        className={`audio-node bg-[var(--bg-secondary)] rounded-xl border w-[360px] transition-all duration-200 ${
          selected ? 'border-blue-500 shadow-lg shadow-blue-500/20' : 'border-[var(--border-color)]'
        }`}
      >
        {/* 头部 */}
        <div className="px-3 py-2 border-b border-[var(--border-color)]">
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium text-[var(--text-secondary)]">
              {nodeData?.label || '音频'}
            </span>
            <div className="flex items-center gap-1">
              {displayUrl && (
                <button 
                  onClick={handleDownload} 
                  className="p-1 hover:bg-[var(--bg-tertiary)] rounded"
                  title="下载"
                >
                  <Download size={14} />
                </button>
              )}
              <button 
                onClick={handleDelete} 
                className="p-1 hover:bg-[var(--bg-tertiary)] rounded"
                title="删除"
              >
                <Trash2 size={14} />
              </button>
            </div>
          </div>
          {nodeData?.model && (
            <div className="mt-1 text-xs text-[var(--text-secondary)] truncate">
              {nodeData.model}
            </div>
          )}
        </div>

        {/* 内容 */}
        <div className="p-3 space-y-3">
          {/* 加载状态 */}
          {nodeData?.loading && (
            <div className="h-24 rounded-lg bg-[var(--bg-tertiary)] flex flex-col items-center justify-center gap-2 border border-[var(--border-color)]">
              <span className="animate-spin text-xl">⟳</span>
              <span className="text-xs text-[var(--text-secondary)]">生成中...</span>
            </div>
          )}

          {/* 错误状态 */}
          {!nodeData?.loading && nodeData?.error && (
            <div className="h-24 rounded-lg bg-red-50 dark:bg-red-900/20 flex flex-col items-center justify-center gap-2 border border-red-200 dark:border-red-800">
              <X size={28} className="text-red-500" />
              <span className="text-xs text-red-500">{nodeData.error}</span>
            </div>
          )}

          {/* 音频播放器 */}
          {!nodeData?.loading && !nodeData?.error && displayUrl && (
            <div className="rounded-lg bg-[var(--bg-tertiary)] p-2">
              <audio
                src={displayUrl}
                controls
                className="w-full nodrag"
              />
            </div>
          )}

          {/* 空状态 */}
          {!nodeData?.loading && !nodeData?.error && !displayUrl && (
            <div className="h-24 rounded-lg bg-[var(--bg-tertiary)] flex flex-col items-center justify-center gap-2 border-2 border-dashed border-[var(--border-color)] relative">
              <Music size={28} className="text-[var(--text-secondary)]" />
              <span className="text-xs text-[var(--text-secondary)]">拖放音频或点击上传</span>
              <input
                type="file"
                accept="audio/*"
                className="absolute inset-0 opacity-0 cursor-pointer nodrag"
                onChange={handleFileUpload}
                onMouseDown={(e) => e.stopPropagation()}
                onClick={(e) => e.stopPropagation()}
              />
            </div>
          )}

          {/* 时长信息 */}
          {nodeData?.duration && (
            <div className="text-xs text-[var(--text-secondary)]">
              时长: {formatDuration(nodeData.duration)}
            </div>
          )}
        </div>

        {/* 连接点 */}
        <Handle type="target" position={Position.Left} id="left" />
        <Handle type="source" position={Position.Right} id="right" />
      </div>
    </div>
  )
})
