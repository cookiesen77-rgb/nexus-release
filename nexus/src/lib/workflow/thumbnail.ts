/**
 * 缩略图生成工具
 * 
 * 用于性能模式下的图片缩略图生成
 * 参考 Tapnow Studio 的 generateThumbnail 实现
 */

import type { PerformanceMode } from '@/store/settings'

// 性能模式配置
export interface ThumbnailConfig {
  maxSize: number      // 最大边长（像素）
  quality: number      // JPEG 质量 (0-1)
}

// 性能模式预设
export const PERFORMANCE_CONFIGS: Record<Exclude<PerformanceMode, 'off'>, ThumbnailConfig> = {
  normal: { maxSize: 150, quality: 0.6 },
  ultra: { maxSize: 80, quality: 0.3 }
}

// 缩略图缓存
const thumbnailCache = new Map<string, string>()

/**
 * 生成缩略图
 * 
 * @param imageUrl 原图 URL（支持 http(s), data:, blob:）
 * @param mode 性能模式
 * @param options 可选配置
 * @returns 缩略图 data URL，失败返回 null
 */
export const generateThumbnail = async (
  imageUrl: string,
  mode: Exclude<PerformanceMode, 'off'> = 'normal',
  options: {
    forceRegenerate?: boolean
  } = {}
): Promise<string | null> => {
  if (!imageUrl) return null
  
  // 检查缓存
  const cacheKey = `${mode}:${imageUrl}`
  if (!options.forceRegenerate && thumbnailCache.has(cacheKey)) {
    return thumbnailCache.get(cacheKey) || null
  }
  
  const config = PERFORMANCE_CONFIGS[mode]
  
  try {
    // 加载图片
    const img = await loadImage(imageUrl)
    if (!img) return null
    
    // 计算缩放后的尺寸
    const { width, height } = calculateSize(img.width, img.height, config.maxSize)
    
    // 创建 canvas 并绘制
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    
    const ctx = canvas.getContext('2d')
    if (!ctx) return null
    
    // 使用高质量缩放
    ctx.imageSmoothingEnabled = true
    ctx.imageSmoothingQuality = 'high'
    ctx.drawImage(img, 0, 0, width, height)
    
    // 转换为 data URL
    const dataUrl = canvas.toDataURL('image/jpeg', config.quality)
    
    // 缓存结果
    thumbnailCache.set(cacheKey, dataUrl)
    
    // 限制缓存大小
    if (thumbnailCache.size > 200) {
      const firstKey = thumbnailCache.keys().next().value
      if (firstKey) thumbnailCache.delete(firstKey)
    }
    
    return dataUrl
  } catch (err) {
    console.warn('[Thumbnail] 生成失败:', imageUrl.slice(0, 50), err)
    return null
  }
}

/**
 * 加载图片
 */
const loadImage = (src: string): Promise<HTMLImageElement | null> => {
  return new Promise((resolve) => {
    const img = new Image()
    img.crossOrigin = 'anonymous'
    
    img.onload = () => resolve(img)
    img.onerror = () => {
      console.warn('[Thumbnail] 图片加载失败:', src.slice(0, 50))
      resolve(null)
    }
    
    // 设置超时
    const timeout = setTimeout(() => {
      console.warn('[Thumbnail] 图片加载超时:', src.slice(0, 50))
      resolve(null)
    }, 10000)
    
    img.onload = () => {
      clearTimeout(timeout)
      resolve(img)
    }
    
    img.src = src
  })
}

/**
 * 计算缩放尺寸（保持纵横比）
 */
const calculateSize = (
  origWidth: number,
  origHeight: number,
  maxSize: number
): { width: number; height: number } => {
  if (origWidth <= maxSize && origHeight <= maxSize) {
    return { width: origWidth, height: origHeight }
  }
  
  const ratio = origWidth / origHeight
  
  if (origWidth > origHeight) {
    return {
      width: maxSize,
      height: Math.round(maxSize / ratio)
    }
  } else {
    return {
      width: Math.round(maxSize * ratio),
      height: maxSize
    }
  }
}

/**
 * 批量生成缩略图
 */
export const generateThumbnails = async (
  imageUrls: string[],
  mode: Exclude<PerformanceMode, 'off'> = 'normal'
): Promise<(string | null)[]> => {
  return Promise.all(imageUrls.map(url => generateThumbnail(url, mode)))
}

/**
 * 清除缩略图缓存
 */
export const clearThumbnailCache = (pattern?: string) => {
  if (!pattern) {
    thumbnailCache.clear()
    return
  }
  
  for (const key of thumbnailCache.keys()) {
    if (key.includes(pattern)) {
      thumbnailCache.delete(key)
    }
  }
}

/**
 * 获取缓存统计
 */
export const getThumbnailCacheStats = () => {
  return {
    count: thumbnailCache.size,
    keys: Array.from(thumbnailCache.keys()).slice(0, 10)
  }
}

/**
 * 获取或生成缩略图
 * 
 * 便捷函数：根据性能模式决定是否生成缩略图
 */
export const getDisplayUrl = async (
  originalUrl: string,
  performanceMode: PerformanceMode,
  existingThumbnail?: string
): Promise<string> => {
  // 性能模式关闭，直接返回原图
  if (performanceMode === 'off') {
    return originalUrl
  }
  
  // 已有缩略图，直接使用
  if (existingThumbnail) {
    return existingThumbnail
  }
  
  // 生成缩略图
  const thumbnail = await generateThumbnail(originalUrl, performanceMode)
  return thumbnail || originalUrl
}
