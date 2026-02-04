import React, { useCallback } from 'react'
import { useGraphStore } from '@/graph/store'
import { generateBlendFromConfigNode } from '@/lib/workflow/blend'
import { ChevronDown } from 'lucide-react'
import type { GraphNode } from '@/graph/types'

interface BlendConfigNodeProps {
  nodeId: string
}

/**
 * 图像融合配置节点
 * 
 * 功能:
 * - 选择融合方法 (拉普拉斯/增强/Gemini/Kling)
 * - 配置混合参数
 * - 执行融合和显示进度
 * - 错误处理
 */
export function BlendConfigNode({ nodeId }: BlendConfigNodeProps) {
  const graphStore = useGraphStore()
  const node = graphStore.nodes.find(n => n.id === nodeId) as GraphNode | undefined

  if (!node) return null

  const data = node.data as any || {}
  const status = data.status || 'ready'
  const method = data.method || 'laplacian'
  const alpha = data.alpha || 0.5
  const progress = data.progress || 0
  const message = data.message || ''
  const errorMessage = data.errorMessage || ''

  const handleMethodChange = useCallback(
    (newMethod: string) => {
      graphStore.updateNode(nodeId, {
        data: { ...data, method: newMethod }
      })
    },
    [nodeId, data, graphStore]
  )

  const handleAlphaChange = useCallback(
    (value: number) => {
      graphStore.updateNode(nodeId, {
        data: { ...data, alpha: value }
      })
    },
    [nodeId, data, graphStore]
  )

  const handleExecute = useCallback(async () => {
    try {
      await generateBlendFromConfigNode(nodeId)
    } catch (err: any) {
      console.error('[BlendConfigNode] 执行错误:', err?.message)
    }
  }, [nodeId])

  const isProcessing = status === 'processing'
  const isCompleted = status === 'completed'
  const isError = status === 'error'

  return (
    <div className="w-72 bg-gradient-to-br from-green-900 to-green-800 rounded-lg border-2 border-green-500 p-4 shadow-lg">
      {/* 标题栏 */}
      <div className="flex items-center gap-2 mb-4">
        <div className="text-2xl">🎨</div>
        <h3 className="text-sm font-bold text-green-100">图像融合</h3>
        {isProcessing && (
          <div className="ml-auto text-xs text-green-300 animate-pulse">处理中...</div>
        )}
        {isCompleted && (
          <div className="ml-auto text-xs text-green-300">✓ 完成</div>
        )}
      </div>

      {/* 融合方法选择 */}
      <div className="mb-4">
        <label className="block text-xs font-semibold text-green-200 mb-2">
          融合方法
        </label>
        <select
          value={method}
          onChange={(e) => handleMethodChange(e.target.value)}
          disabled={isProcessing}
          className="w-full px-3 py-2 text-xs bg-green-800 border border-green-600 text-green-100 rounded hover:bg-green-700 disabled:opacity-50 focus:outline-none focus:border-green-400"
        >
          <option value="laplacian">⚡ 快速 (1-3 秒，本地)</option>
          <option value="enhanced">🟡 增强 (3-8 秒，本地)</option>
          <option value="gemini">🧠 Gemini (30-60 秒，API)</option>
          <option value="kling">🚀 Kling (30-60 秒，API)</option>
        </select>

        {/* 方法说明 */}
        <div className="mt-2 p-2 bg-green-950 bg-opacity-50 rounded text-xs text-green-300 border border-green-700">
          {method === 'laplacian' && '拉普拉斯金字塔，无需 API，速度最快'}
          {method === 'enhanced' && '增强版本：添加颜色校正和边界优化'}
          {method === 'gemini' && 'Gemini AI 融合，质量最高，支持背景补全'}
          {method === 'kling' && 'Kling AI 融合，专业级质量'}
        </div>
      </div>

      {/* 混合权重 (仅快速/增强显示) */}
      {(method === 'laplacian' || method === 'enhanced') && (
        <div className="mb-4">
          <label className="block text-xs font-semibold text-green-200 mb-2">
            混合权重: {(alpha * 100).toFixed(0)}%
          </label>
          <div className="flex items-center gap-2">
            <input
              type="range"
              min="0"
              max="1"
              step="0.05"
              value={alpha}
              onChange={(e) => handleAlphaChange(Number(e.target.value))}
              disabled={isProcessing}
              className="flex-1 h-2 bg-green-900 rounded appearance-none cursor-pointer disabled:opacity-50"
            />
            <span className="text-xs text-green-300 w-12 text-right">
              {(alpha * 100).toFixed(0)}%
            </span>
          </div>
          <div className="mt-1 text-xs text-green-300">
            0% = 100% 图 B，50% = 平衡，100% = 100% 图 A
          </div>
        </div>
      )}

      {/* 进度条 */}
      {isProcessing && (
        <div className="mb-4">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs text-green-300">{message}</span>
            <span className="text-xs text-green-400 font-semibold">{progress}%</span>
          </div>
          <div className="w-full bg-green-950 rounded-full h-2 overflow-hidden">
            <div
              className="h-full bg-gradient-to-r from-green-500 to-green-300 transition-all duration-300"
              style={{ width: `${progress}%` }}
            />
          </div>
        </div>
      )}

      {/* 错误提示 */}
      {isError && errorMessage && (
        <div className="mb-4 p-3 bg-red-900 bg-opacity-50 border border-red-600 rounded text-xs text-red-200">
          <div className="font-semibold mb-1">❌ 错误</div>
          <div className="break-words">{errorMessage}</div>
        </div>
      )}

      {/* 状态信息 */}
      {isCompleted && data.executionTime && (
        <div className="mb-4 p-3 bg-green-950 bg-opacity-50 border border-green-600 rounded text-xs text-green-200">
          <div className="font-semibold mb-1">✓ 融合完成</div>
          <div>耗时: {(data.executionTime / 1000).toFixed(1)} 秒</div>
        </div>
      )}

      {/* 执行按钮 */}
      <button
        onClick={handleExecute}
        disabled={isProcessing}
        className="w-full px-4 py-2 bg-green-500 hover:bg-green-400 disabled:bg-green-600 disabled:opacity-50 text-white text-sm font-semibold rounded transition-colors"
      >
        {isProcessing ? (
          <div className="flex items-center justify-center gap-2">
            <div className="w-4 h-4 border-2 border-green-200 border-t-transparent rounded-full animate-spin" />
            融合中...
          </div>
        ) : isCompleted ? (
          '✓ 重新融合'
        ) : (
          '▶ 开始融合'
        )}
      </button>

      {/* 输入提示 */}
      <div className="mt-4 p-2 bg-green-950 bg-opacity-50 rounded text-xs text-green-300 border border-green-700">
        <div className="font-semibold mb-1">📌 使用说明</div>
        <div>1. 连接两个图像节点 (左、右)</div>
        <div>2. 选择融合方法</div>
        <div>3. 点击"开始融合"</div>
        <div>4. 融合结果自动显示在右侧</div>
      </div>
    </div>
  )
}
