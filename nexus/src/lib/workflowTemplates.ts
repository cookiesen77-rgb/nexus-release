/**
 * Workflow Templates | 工作流模板管理
 * 支持用户保存和加载自定义工作流模板
 */

import { useGraphStore } from '@/graph/store'
import { getNodeSize } from '@/graph/nodeSizing'

// ==================== 类型定义 ====================

export interface UserWorkflowTemplate {
  id: string
  name: string
  description?: string
  createdAt: number
  updatedAt: number
  nodes: Array<{
    relativeId: string  // 相对 ID（用于边连接）
    type: string
    dx: number          // 相对于模板原点的偏移
    dy: number
    data: Record<string, any>  // 包含 prompt、model、ratio 等所有配置
  }>
  edges: Array<{
    sourceIdx: number   // 对应 nodes 数组索引
    targetIdx: number
    sourceHandle?: string
    targetHandle?: string
  }>
}

// ==================== 存储 Key ====================

const STORAGE_KEY = 'nexus-user-workflow-templates'

// ==================== 工具函数 ====================

/**
 * 生成唯一 ID
 */
const generateId = () => `tpl_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`

/**
 * 从 localStorage 读取用户模板列表
 */
export function loadUserTemplates(): UserWorkflowTemplate[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed
  } catch {
    return []
  }
}

/**
 * 保存用户模板列表到 localStorage
 */
function saveUserTemplates(templates: UserWorkflowTemplate[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(templates))
  } catch (err) {
    console.error('[workflowTemplates] 保存失败:', err)
  }
}

/**
 * 将当前画布保存为模板
 */
export function saveCurrentAsTemplate(name: string, description?: string): UserWorkflowTemplate | null {
  const store = useGraphStore.getState()
  const nodes = store.nodes
  const edges = store.edges

  if (nodes.length === 0) {
    window.$message?.warning?.('画布上没有节点，无法保存模板')
    return null
  }

  // 计算原点（所有节点的最小 x, y）
  let minX = Infinity
  let minY = Infinity
  for (const n of nodes) {
    minX = Math.min(minX, n.x)
    minY = Math.min(minY, n.y)
  }

  // 构建节点映射（id -> index）
  const idToIdx = new Map<string, number>()
  nodes.forEach((n, i) => idToIdx.set(n.id, i))

  // 转换节点数据
  const templateNodes = nodes.map((n, i) => {
    // 清理 data 中不需要保存的字段
    const data = { ...(n.data || {}) } as Record<string, any>
    // 保留所有配置，但清理运行时状态
    delete data.loading
    delete data.error
    delete data.status
    delete data.progress
    delete data.taskId
    // 注意：保留 url、mediaId（如果是参考图则需要）
    // 保留 prompt、model、ratio、size、quality、dur 等配置

    return {
      relativeId: `node_${i}`,
      type: n.type,
      dx: n.x - minX,
      dy: n.y - minY,
      data
    }
  })

  // 转换边数据
  const templateEdges = edges
    .filter(e => idToIdx.has(e.source) && idToIdx.has(e.target))
    .map(e => ({
      sourceIdx: idToIdx.get(e.source)!,
      targetIdx: idToIdx.get(e.target)!,
      sourceHandle: e.sourceHandle,
      targetHandle: e.targetHandle
    }))

  const template: UserWorkflowTemplate = {
    id: generateId(),
    name: name.trim() || '未命名模板',
    description: description?.trim() || undefined,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    nodes: templateNodes,
    edges: templateEdges
  }

  // 保存到列表
  const templates = loadUserTemplates()
  templates.unshift(template)  // 新模板放在最前面
  saveUserTemplates(templates)

  return template
}

/**
 * 删除用户模板
 */
export function deleteUserTemplate(templateId: string): boolean {
  const templates = loadUserTemplates()
  const idx = templates.findIndex(t => t.id === templateId)
  if (idx === -1) return false
  templates.splice(idx, 1)
  saveUserTemplates(templates)
  return true
}

/**
 * 应用用户模板到画布
 * @param template 模板对象
 * @param anchor 放置的锚点位置（画布坐标）
 */
export function applyUserTemplate(
  template: UserWorkflowTemplate,
  anchor?: { x: number; y: number }
): string[] {
  const store = useGraphStore.getState()

  // 如果没有指定锚点，使用视口中心
  let baseX = 0
  let baseY = 0
  if (anchor) {
    baseX = anchor.x
    baseY = anchor.y
  } else {
    const vp = store.viewport
    const z = vp.zoom || 1
    baseX = (-vp.x + 600) / z
    baseY = (-vp.y + 360) / z
  }

  const createdIds: string[] = []

  store.withBatchUpdates(() => {
    // 创建节点
    for (const tplNode of template.nodes) {
      const pos = { x: baseX + tplNode.dx, y: baseY + tplNode.dy }
      // 深拷贝 data，避免引用问题
      const data = JSON.parse(JSON.stringify(tplNode.data || {}))
      const id = store.addNode(tplNode.type, pos, data)
      createdIds.push(id)
    }

    // 创建边
    for (const tplEdge of template.edges) {
      const sourceId = createdIds[tplEdge.sourceIdx]
      const targetId = createdIds[tplEdge.targetIdx]
      if (!sourceId || !targetId) continue
      store.addEdge(sourceId, targetId, {
        sourceHandle: tplEdge.sourceHandle,
        targetHandle: tplEdge.targetHandle
      })
    }
  })

  return createdIds
}

/**
 * 更新用户模板
 */
export function updateUserTemplate(templateId: string, updates: Partial<Pick<UserWorkflowTemplate, 'name' | 'description'>>): boolean {
  const templates = loadUserTemplates()
  const idx = templates.findIndex(t => t.id === templateId)
  if (idx === -1) return false
  
  if (updates.name !== undefined) templates[idx].name = updates.name
  if (updates.description !== undefined) templates[idx].description = updates.description
  templates[idx].updatedAt = Date.now()
  
  saveUserTemplates(templates)
  return true
}
