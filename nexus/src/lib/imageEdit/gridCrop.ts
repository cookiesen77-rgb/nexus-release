/**
 * Grid Crop | 宫格裁剪算法
 * 支持四宫格（2x2）和九宫格（3x3）无损裁剪
 */

export interface GridCropResult {
  dataUrl: string
  row: number
  col: number
  width: number
  height: number
}

export interface GridCropAreaPx {
  x: number
  y: number
  width: number
  height: number
}

/**
 * 将图片裁剪为宫格
 * @param imageUrl 图片 URL（data URL 或 HTTP URL）
 * @param gridSize 宫格大小（2 = 四宫格，3 = 九宫格）
 * @param crop 可选：先裁剪出一个区域（像素），再切成宫格；用于自由比例九/四宫格裁剪
 * @returns 裁剪后的图片数组
 */
export async function cropToGrid(
  imageUrl: string,
  gridSize: 2 | 3,
  crop?: GridCropAreaPx
): Promise<GridCropResult[]> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.crossOrigin = 'anonymous'
    
    img.onload = () => {
      try {
        const results: GridCropResult[] = []

        // Crop area (pixel)
        const base = {
          x: Math.max(0, Math.min(Math.round(crop?.x ?? 0), img.width - 1)),
          y: Math.max(0, Math.min(Math.round(crop?.y ?? 0), img.height - 1)),
          width: Math.max(1, Math.round(crop?.width ?? img.width)),
          height: Math.max(1, Math.round(crop?.height ?? img.height)),
        }
        base.width = Math.min(base.width, img.width - base.x)
        base.height = Math.min(base.height, img.height - base.y)

        // Compute cell boundaries using rounding to preserve all pixels and avoid cumulative drift.
        const colStart = (col: number) => Math.round((col * base.width) / gridSize)
        const rowStart = (row: number) => Math.round((row * base.height) / gridSize)
        
        // 遍历每个格子
        for (let row = 0; row < gridSize; row++) {
          for (let col = 0; col < gridSize; col++) {
            const sx0 = colStart(col)
            const sx1 = colStart(col + 1)
            const sy0 = rowStart(row)
            const sy1 = rowStart(row + 1)
            const cellWidth = Math.max(1, sx1 - sx0)
            const cellHeight = Math.max(1, sy1 - sy0)

            // 创建 canvas
            const canvas = document.createElement('canvas')
            canvas.width = cellWidth
            canvas.height = cellHeight
            
            const ctx = canvas.getContext('2d')
            if (!ctx) {
              throw new Error('无法创建 canvas context')
            }
            
            // 禁用图像平滑，保持像素精确
            ctx.imageSmoothingEnabled = false
            
            // 计算裁剪坐标
            const sx = base.x + sx0
            const sy = base.y + sy0
            
            // 绘制裁剪区域
            ctx.drawImage(
              img,
              sx, sy, cellWidth, cellHeight,  // 源坐标和尺寸
              0, 0, cellWidth, cellHeight      // 目标坐标和尺寸
            )
            
            // 导出为 PNG（无损）
            const dataUrl = canvas.toDataURL('image/png')
            
            results.push({
              dataUrl,
              row,
              col,
              width: cellWidth,
              height: cellHeight
            })
          }
        }
        
        resolve(results)
      } catch (error) {
        reject(error)
      }
    }
    
    img.onerror = () => {
      reject(new Error('图片加载失败'))
    }
    
    img.src = imageUrl
  })
}

/**
 * 四宫格裁剪
 */
export async function cropToFourGrid(imageUrl: string, crop?: GridCropAreaPx): Promise<GridCropResult[]> {
  return cropToGrid(imageUrl, 2, crop)
}

/**
 * 九宫格裁剪（支持自定义裁剪区域）
 */
export async function cropToNineGrid(imageUrl: string, crop?: GridCropAreaPx): Promise<GridCropResult[]> {
  return cropToGrid(imageUrl, 3, crop)
}

/**
 * 计算新节点在画布上的位置（避免重叠）
 * @param baseX 基准 X 坐标
 * @param baseY 基准 Y 坐标
 * @param index 节点索引
 * @param gridSize 宫格大小
 * @param spacing 节点间距
 */
export function calculateNodePosition(
  baseX: number,
  baseY: number,
  index: number,
  gridSize: 2 | 3,
  spacing: number = 320
): { x: number; y: number } {
  const row = Math.floor(index / gridSize)
  const col = index % gridSize
  
  return {
    x: baseX + col * spacing + 100,  // 向右偏移
    y: baseY + row * spacing
  }
}
