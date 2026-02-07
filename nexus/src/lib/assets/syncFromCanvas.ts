import { useGraphStore } from '@/graph/store'
import { useAssetsStore } from '@/store/assets'

const isBlobUrl = (src: string) => /^blob:/i.test(src || '')
const isDataUrl = (src: string) => /^data:/i.test(src || '')
const isAssetUrl = (src: string) => /^asset:\/\//i.test(src || '')

const pickFirstString = (...candidates: Array<unknown>) => {
  for (const c of candidates) {
    const s = typeof c === 'string' ? c : ''
    if (s && s.trim()) return s.trim()
  }
  return ''
}

/**
 * 单向补齐：把“画布现有的 image/video 节点”补进历史素材（不会删除历史，也不反向同步）。
 *
 * 规则：
 * - 允许 data:/asset:// 以及 http(s) 本地缓存 URL（如 127.0.0.1）
 * - 排除 blob:（不可持久化，重启必失效）
 * - 按 type + src 去重
 */
export const syncAssetHistoryFromCanvasNodes = (opts?: { includeDataUrl?: boolean; includeAssetUrl?: boolean }) => {
  const includeDataUrl = opts?.includeDataUrl !== false
  const includeAssetUrl = opts?.includeAssetUrl !== false

  const graph = useGraphStore.getState()
  const assetsStore = useAssetsStore.getState()
  const existing = assetsStore.assets || []
  const existingKey = new Set(existing.map((a) => `${a.type}:${a.src}`))

  const nodes = graph.nodes || []
  for (const node of nodes) {
    if (!node) continue
    const d: any = node.data || {}

    if (node.type === 'image') {
      // 优先使用 sourceUrl（更可能是公网可访问地址），避免把 asset:// 缓存地址写入历史后无法用于下游生成
      const src = pickFirstString(d.sourceUrl, d.displayUrl, d.src, d.url, d.imageUrl)
      if (!src) continue
      if (isBlobUrl(src)) continue
      if (isDataUrl(src) && !includeDataUrl) continue
      if (isAssetUrl(src) && !includeAssetUrl) continue

      const key = `image:${src}`
      if (existingKey.has(key)) continue
      existingKey.add(key)
      assetsStore.addAsset({
        type: 'image',
        src,
        title: String(d.label || d.prompt?.slice?.(0, 50) || '画布图片'),
        model: String(d.model || ''),
      })
      continue
    }

    if (node.type === 'video') {
      const src = pickFirstString(d.sourceUrl, d.displayUrl, d.src, d.url, d.videoUrl)
      if (!src) continue
      if (isBlobUrl(src)) continue
      if (isDataUrl(src) && !includeDataUrl) continue
      if (isAssetUrl(src) && !includeAssetUrl) continue

      const key = `video:${src}`
      if (existingKey.has(key)) continue
      existingKey.add(key)
      assetsStore.addAsset({
        type: 'video',
        src,
        title: String(d.label || d.prompt?.slice?.(0, 50) || '画布视频'),
        model: String(d.model || ''),
        duration: Number(d.duration || 0),
      })
      continue
    }
  }
}

