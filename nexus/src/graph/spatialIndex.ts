import type { GraphNode, Viewport } from '@/graph/types'

/**
 * 简单网格空间索引
 * 用于快速查询视口内的节点，将可见性检测从 O(n) 降至 O(k)，k 为可见单元格数量
 */

export type SpatialIndex = {
  cellSize: number
  cells: Map<string, Set<string>>   // "col_row" -> nodeIds
  nodeCells: Map<string, string[]>  // nodeId -> ["col_row", ...]
}

const cellKey = (col: number, row: number) => `${col}_${row}`

/**
 * 创建空间索引实例
 * @param cellSize 网格单元格大小（世界坐标），默认 400
 */
export function createSpatialIndex(cellSize = 400): SpatialIndex {
  return {
    cellSize,
    cells: new Map(),
    nodeCells: new Map()
  }
}

/**
 * 将节点添加到空间索引
 * 节点可能跨越多个单元格，因此会被添加到所有覆盖的单元格中
 */
export function indexNode(
  index: SpatialIndex,
  node: GraphNode,
  nodeSize: { w: number; h: number }
): void {
  // 先移除旧的索引条目（如果存在）
  removeNodeFromIndex(index, node.id)

  const { cellSize, cells, nodeCells } = index
  const x0 = node.x
  const y0 = node.y
  const x1 = node.x + nodeSize.w
  const y1 = node.y + nodeSize.h

  const colMin = Math.floor(x0 / cellSize)
  const colMax = Math.floor(x1 / cellSize)
  const rowMin = Math.floor(y0 / cellSize)
  const rowMax = Math.floor(y1 / cellSize)

  const nodeCellKeys: string[] = []

  for (let col = colMin; col <= colMax; col++) {
    for (let row = rowMin; row <= rowMax; row++) {
      const key = cellKey(col, row)
      nodeCellKeys.push(key)

      let cellSet = cells.get(key)
      if (!cellSet) {
        cellSet = new Set()
        cells.set(key, cellSet)
      }
      cellSet.add(node.id)
    }
  }

  nodeCells.set(node.id, nodeCellKeys)
}

/**
 * 从空间索引中移除节点
 */
export function removeNodeFromIndex(index: SpatialIndex, nodeId: string): void {
  const { cells, nodeCells } = index
  const cellKeys = nodeCells.get(nodeId)
  if (!cellKeys) return

  for (const key of cellKeys) {
    const cellSet = cells.get(key)
    if (cellSet) {
      cellSet.delete(nodeId)
      if (cellSet.size === 0) {
        cells.delete(key)
      }
    }
  }

  nodeCells.delete(nodeId)
}

/**
 * 查询视口内的节点 ID 列表
 * @param margin 视口边缘的额外边距（屏幕像素），用于预加载即将进入视口的节点
 */
export function queryViewport(
  index: SpatialIndex,
  viewport: Viewport,
  screenSize: { w: number; h: number },
  margin = 100
): string[] {
  const { cellSize, cells } = index
  const zoom = viewport.zoom || 1

  // 将屏幕坐标转换为世界坐标
  const worldX0 = (-margin - viewport.x) / zoom
  const worldY0 = (-margin - viewport.y) / zoom
  const worldX1 = (screenSize.w + margin - viewport.x) / zoom
  const worldY1 = (screenSize.h + margin - viewport.y) / zoom

  const colMin = Math.floor(worldX0 / cellSize)
  const colMax = Math.floor(worldX1 / cellSize)
  const rowMin = Math.floor(worldY0 / cellSize)
  const rowMax = Math.floor(worldY1 / cellSize)

  const resultSet = new Set<string>()

  for (let col = colMin; col <= colMax; col++) {
    for (let row = rowMin; row <= rowMax; row++) {
      const key = cellKey(col, row)
      const cellSet = cells.get(key)
      if (cellSet) {
        for (const id of cellSet) {
          resultSet.add(id)
        }
      }
    }
  }

  return Array.from(resultSet)
}

/**
 * 重建整个空间索引
 * 用于初始化或大批量变更后的重建
 */
export function rebuildIndex(
  index: SpatialIndex,
  nodes: GraphNode[],
  getSizeFn: (type: string) => { w: number; h: number }
): void {
  // 清空现有索引
  index.cells.clear()
  index.nodeCells.clear()

  // 重新索引所有节点
  for (const node of nodes) {
    const size = getSizeFn(node.type)
    indexNode(index, node, size)
  }
}

/**
 * 检查节点是否在视口内（精确检测，用于最终过滤）
 */
export function isNodeInViewport(
  node: GraphNode,
  nodeSize: { w: number; h: number },
  viewport: Viewport,
  screenSize: { w: number; h: number },
  margin = 0
): boolean {
  const zoom = viewport.zoom || 1
  const screenX = node.x * zoom + viewport.x
  const screenY = node.y * zoom + viewport.y
  const screenW = nodeSize.w * zoom
  const screenH = nodeSize.h * zoom

  return (
    screenX + screenW >= -margin &&
    screenY + screenH >= -margin &&
    screenX <= screenSize.w + margin &&
    screenY <= screenSize.h + margin
  )
}
