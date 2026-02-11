import type { EdgeType } from '@/graph/types'

export const EDGE_COLORS: Record<string, { stroke: string; strokeDark: string }> = {
  imageRole:   { stroke: '#f59e0b', strokeDark: '#fbbf24' },
  promptOrder: { stroke: '#22d37e', strokeDark: '#34d399' },
  imageOrder:  { stroke: '#3b82f6', strokeDark: '#60a5fa' },
  default:     { stroke: '#94a3b8', strokeDark: '#64748b' },
}

export const getEdgeColor = (type: string | undefined, isDark = false) => {
  const key = type || 'default'
  const entry = EDGE_COLORS[key] || EDGE_COLORS.default
  return isDark ? entry.strokeDark : entry.stroke
}

export const EDGE_TYPE_LABELS: Record<string, string> = {
  imageRole: '图片角色',
  promptOrder: '提示词',
  imageOrder: '参考图',
  default: '连接',
}
