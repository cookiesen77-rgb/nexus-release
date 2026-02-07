/**
 * LocalSaveNodeFlow - React Flow 版本的本地保存节点
 * 完全对齐 Vue 版本 LocalSaveNode.vue 实现
 */
import React, { memo, useState, useCallback, useMemo } from 'react'
import { Handle, Position, NodeProps } from '@xyflow/react'
import { Trash2, Zap, Power } from 'lucide-react'
import { useGraphStore } from '@/graph/store'

interface LocalSaveNodeData {
  label?: string
  autoExecute?: boolean
}

export const LocalSaveNodeComponent = memo(function LocalSaveNode({ id, data, selected }: NodeProps) {
  const nodeData = data as LocalSaveNodeData
  const [showActions, setShowActions] = useState(false)
  const [saving, setSaving] = useState(false)

  const autoExecute = nodeData?.autoExecute ?? false

  // 获取连接的素材
  const getConnectedAssets = useCallback(() => {
    const state = useGraphStore.getState()
    const incomingEdges = state.edges.filter((e) => e.target === id)
    const result: { type: string; url: string; name: string }[] = []

    for (const edge of incomingEdges) {
      const sourceNode = state.nodes.find((n) => n.id === edge.source)
      if (!sourceNode) continue
      if (!['image', 'video', 'audio'].includes(sourceNode.type)) continue
      const url = (sourceNode.data as any)?.url
      if (!url) continue
      result.push({
        type: sourceNode.type,
        url,
        name: (sourceNode.data as any)?.label || (sourceNode.data as any)?.fileName || sourceNode.type
      })
    }
    return result
  }, [id])

  // 连接的素材数量（用于显示）
  const connectedCount = useMemo(() => {
    return getConnectedAssets().length
  }, [getConnectedAssets])

  const handleDelete = useCallback((e: React.MouseEvent) => {
    e.stopPropagation()
    useGraphStore.getState().removeNode(id)
  }, [id])

  const toggleAuto = useCallback((e: React.MouseEvent) => {
    e.stopPropagation()
    useGraphStore.getState().updateNode(id, {
      data: { autoExecute: !autoExecute }
    })
  }, [id, autoExecute])

  const handleSave = useCallback(async (e: React.MouseEvent) => {
    e.stopPropagation()
    const assets = getConnectedAssets()
    if (assets.length === 0) {
      window.$message?.warning?.('没有连接的素材可保存')
      return
    }

    setSaving(true)
    try {
      let savedCount = 0
      for (const asset of assets) {
        // 创建下载链接
        const link = document.createElement('a')
        link.href = asset.url
        
        // 确定文件扩展名
        let ext = 'bin'
        if (asset.type === 'image') ext = 'png'
        else if (asset.type === 'video') ext = 'mp4'
        else if (asset.type === 'audio') ext = 'mp3'
        
        link.download = `${asset.name}_${Date.now()}.${ext}`
        link.click()
        savedCount++
        
        // 短暂延迟，避免浏览器阻止多个下载
        await new Promise(r => setTimeout(r, 300))
      }
      
      if (savedCount > 0) {
        window.$message?.success?.(`已保存 ${savedCount} 个素材`)
      }
    } catch (err: any) {
      window.$message?.error?.(err?.message || '保存失败')
    } finally {
      setSaving(false)
    }
  }, [getConnectedAssets])

  return (
    <div
      className="relative"
      onMouseEnter={() => setShowActions(true)}
      onMouseLeave={() => setShowActions(false)}
    >
      {/* 节点主体 */}
      <div
        className={`local-save-node bg-[var(--bg-secondary)] rounded-xl border min-w-[240px] relative transition-all duration-200 ${
          selected ? 'border-blue-500 shadow-lg shadow-blue-500/20' : 'border-[var(--border-color)]'
        }`}
      >
        {/* 头部 */}
        <div className="flex items-center justify-between px-3 py-2 border-b border-[var(--border-color)]">
          <span className="text-sm font-medium text-[var(--text-secondary)]">
            {nodeData?.label || '本地保存'}
          </span>
          <div className="flex items-center gap-1">
            <button 
              onClick={toggleAuto} 
              className="p-1 hover:bg-[var(--bg-tertiary)] rounded"
              title={autoExecute ? '自动保存：开' : '自动保存：关'}
            >
              {autoExecute ? <Zap size={14} /> : <Power size={14} />}
            </button>
            <button 
              onClick={handleDelete} 
              className="p-1 hover:bg-[var(--bg-tertiary)] rounded"
            >
              <Trash2 size={14} />
            </button>
          </div>
        </div>

        {/* 内容 */}
        <div className="p-3 space-y-2">
          <div className="text-xs text-[var(--text-secondary)]">
            已连接 {connectedCount} 个素材
          </div>
          <div className="flex items-center gap-2 text-[11px] text-[var(--text-secondary)]">
            <span className="px-2 py-0.5 rounded-full bg-[var(--bg-tertiary)]">
              浏览器下载
            </span>
          </div>
          <button
            onClick={handleSave}
            disabled={saving || connectedCount === 0}
            className="w-full flex items-center justify-center gap-2 py-2 px-4 rounded-lg bg-[var(--accent-color)] hover:opacity-90 text-white text-sm font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {saving ? <span className="animate-spin">⟳</span> : null}
            <span>{saving ? '保存中...' : '保存到本地'}</span>
          </button>
        </div>

        {/* 连接点 - 只有输入 */}
        <Handle type="target" position={Position.Left} id="left" />
        <Handle type="source" position={Position.Right} id="right" />
      </div>
    </div>
  )
})
