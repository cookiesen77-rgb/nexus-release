/**
 * ImageRoleEdge - 自定义边组件
 * 用于 image → videoConfig 的连接，显示角色选择下拉菜单（首帧/尾帧/参考图）
 * 参考 Vue 版本 ImageRoleEdge.vue 实现
 */
import React, { memo, useState, useCallback, useMemo, useEffect, useRef } from 'react'
import {
  BaseEdge,
  EdgeLabelRenderer,
  getBezierPath,
  useReactFlow,
  type EdgeProps,
} from '@xyflow/react'
import { ChevronDown } from 'lucide-react'
import { useGraphStore } from '@/graph/store'
import { coerceVideoImageRole, getAllowedVideoImageRoles, getVideoModelCaps } from '@/lib/modelCaps'

type ImageRole = 'first_frame_image' | 'last_frame_image' | 'input_reference'

interface ImageRoleEdgeData {
  imageRole?: ImageRole
  [key: string]: unknown
}

const IMAGE_ROLE_OPTIONS: { label: string; key: ImageRole }[] = [
  { label: '首帧', key: 'first_frame_image' },
  { label: '尾帧', key: 'last_frame_image' },
  { label: '参考图', key: 'input_reference' },
]

export const ImageRoleEdge = memo(function ImageRoleEdge({
  id,
  target,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  data,
  selected,
}: EdgeProps) {
  const [showDropdown, setShowDropdown] = useState(false)
  const dropdownRef = useRef<HTMLDivElement>(null)
  const edgeData = data as ImageRoleEdgeData | undefined
  const { setEdges } = useReactFlow()

  // 订阅目标 videoConfig 节点的模型（用于动态过滤角色选项）
  const targetModelKey = useGraphStore((s) => {
    const n = s.nodes.find((x) => x.id === target)
    return String((n?.data as any)?.model || '').trim()
  })
  const caps = useMemo(() => getVideoModelCaps(targetModelKey), [targetModelKey])
  const allowedRoles = useMemo(() => new Set(getAllowedVideoImageRoles(caps)), [caps])
  const roleOptions = useMemo(
    () => IMAGE_ROLE_OPTIONS.filter((o) => allowedRoles.has(o.key)),
    [allowedRoles]
  )

  // 计算贝塞尔路径
  const [edgePath, labelX, labelY] = getBezierPath({
    sourceX,
    sourceY,
    targetX,
    targetY,
    sourcePosition,
    targetPosition,
  })

  // 从 Zustand store 获取最新的角色数据
  const currentRole = useMemo(() => {
    // 首先从 props.data 获取
    if (edgeData?.imageRole) return edgeData.imageRole
    // 然后从 store 获取
    const storeEdge = useGraphStore.getState().edges.find(e => e.id === id)
    return (storeEdge?.data as any)?.imageRole || 'first_frame_image'
  }, [id, edgeData?.imageRole])

  // 当前角色标签
  const currentRoleLabel = useMemo(() => {
    const option = IMAGE_ROLE_OPTIONS.find((o) => o.key === currentRole)
    return option?.label || '首帧'
  }, [currentRole])

  // 若当前边的角色对当前模型不支持，则自动回退到可用角色
  useEffect(() => {
    const coerced = coerceVideoImageRole(currentRole, caps)
    if (coerced === currentRole) return

    // 1) 更新 store
    useGraphStore.getState().setEdgeImageRole(id, coerced)

    // 2) 同步更新 React Flow 边数据
    setEdges((edges) =>
      edges.map((edge) => {
        if (edge.id === id) return { ...edge, data: { ...edge.data, imageRole: coerced } }
        return edge
      })
    )
  }, [caps, currentRole, id, setEdges])

  // 点击外部关闭下拉菜单
  useEffect(() => {
    if (!showDropdown) return

    const handleClickOutside = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setShowDropdown(false)
      }
    }

    // 延迟添加监听，避免立即触发
    const timer = setTimeout(() => {
      document.addEventListener('mousedown', handleClickOutside)
    }, 10)

    return () => {
      clearTimeout(timer)
      document.removeEventListener('mousedown', handleClickOutside)
    }
  }, [showDropdown])

  // 处理角色选择
  const handleRoleSelect = useCallback(
    (role: ImageRole) => {
      const next = coerceVideoImageRole(role, caps)
      // 1. 更新 Zustand store
      useGraphStore.getState().setEdgeImageRole(id, next)

      // 2. 同时更新 React Flow 的边数据（确保 UI 同步）
      setEdges((edges) =>
        edges.map((edge) => {
          if (edge.id === id) {
            return {
              ...edge,
              data: { ...edge.data, imageRole: next },
            }
          }
          return edge
        })
      )

      setShowDropdown(false)
    },
    [caps, id, setEdges]
  )

  // 切换下拉菜单
  const toggleDropdown = useCallback((e: React.MouseEvent) => {
    e.stopPropagation()
    e.preventDefault()
    setShowDropdown((prev) => !prev)
  }, [])

  return (
    <>
      {/* 边线 */}
      <BaseEdge
        path={edgePath}
        style={{
          stroke: selected ? '#3b82f6' : '#6366f1',
          strokeWidth: selected ? 3 : 2,
        }}
      />

      {/* 边标签（角色选择器） */}
      <EdgeLabelRenderer>
        <div
          ref={dropdownRef}
          style={{
            position: 'absolute',
            transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`,
            pointerEvents: 'all',
            zIndex: 1000,
          }}
          className="nodrag nopan"
        >
          {/* 角色按钮 */}
          <button
            onClick={toggleDropdown}
            onMouseDown={(e) => e.stopPropagation()}
            className={`
              flex items-center gap-1 text-xs px-2.5 py-1.5 rounded-full 
              bg-white dark:bg-gray-800 
              border border-gray-200 dark:border-gray-600 
              shadow-md hover:shadow-lg transition-shadow cursor-pointer
              ${selected ? 'ring-2 ring-blue-500' : ''}
            `}
          >
            <span className="text-gray-700 dark:text-gray-200 font-medium">{currentRoleLabel}</span>
            <ChevronDown size={12} className={`text-gray-500 transition-transform ${showDropdown ? 'rotate-180' : ''}`} />
          </button>

          {/* 下拉菜单 */}
          {showDropdown && (
            <div
              className="
                absolute top-full left-1/2 -translate-x-1/2 mt-2
                bg-white dark:bg-gray-800 
                border border-gray-200 dark:border-gray-600 
                rounded-lg shadow-xl overflow-hidden
                min-w-[90px]
              "
              style={{ zIndex: 9999 }}
              onMouseDown={(e) => e.stopPropagation()}
            >
              {roleOptions.map((option) => (
                <button
                  key={option.key}
                  onClick={(e) => {
                    e.stopPropagation()
                    e.preventDefault()
                    handleRoleSelect(option.key)
                  }}
                  onMouseDown={(e) => e.stopPropagation()}
                  className={`
                    w-full px-3 py-2 text-xs text-left
                    hover:bg-gray-100 dark:hover:bg-gray-700
                    transition-colors cursor-pointer
                    ${currentRole === option.key 
                      ? 'bg-blue-50 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400 font-medium' 
                      : 'text-gray-700 dark:text-gray-200'
                    }
                  `}
                >
                  {option.label}
                </button>
              ))}
            </div>
          )}
        </div>
      </EdgeLabelRenderer>
    </>
  )
})

export default ImageRoleEdge
