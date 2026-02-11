import type { NodeType } from '@/graph/types'

// 节点宽度配置（高度改为自适应）
export const NODE_WIDTHS: Record<string, number> = {
  text: 280,
  imageConfig: 420,
  videoConfig: 420,
  blendConfig: 300,
  image: 260,
  video: 320,
  audio: 280,
  localSave: 260,
  klingVideoTool: 320,
  klingImageTool: 320,
  klingAudioTool: 320,
  llm: 380,
  textSplitter: 320,
}

// 节点最小高度（用于空间索引估算）
export const NODE_MIN_HEIGHTS: Record<string, number> = {
  text: 140,
  imageConfig: 480,
  videoConfig: 480,
  blendConfig: 200,
  image: 200,
  video: 240,
  audio: 120,
  localSave: 100,
  klingVideoTool: 220,
  klingImageTool: 220,
  klingAudioTool: 220,
  llm: 380,
  textSplitter: 260,
}

export const getNodeWidth = (type: string) => NODE_WIDTHS[type] || 260

export const getNodeMinHeight = (type: string) => NODE_MIN_HEIGHTS[type] || 120

// 兼容旧接口：返回宽度和最小高度（用于空间索引）
export const getNodeSize = (type: string) => ({
  w: NODE_WIDTHS[type] || 260,
  h: NODE_MIN_HEIGHTS[type] || 120
})

export const NODE_ACCENTS: Record<NodeType, [number, number, number, number]> = {
  text: [0.25, 0.62, 1.0, 1.0],
  imageConfig: [0.98, 0.65, 0.17, 1.0],
  videoConfig: [0.93, 0.46, 0.98, 1.0],
  blendConfig: [0.2, 0.8, 0.6, 1.0],
  image: [0.68, 0.43, 0.98, 1.0],
  video: [0.16, 0.88, 0.67, 1.0],
  audio: [0.2, 0.83, 0.99, 1.0],
  localSave: [0.62, 0.69, 0.78, 1.0],
  klingVideoTool: [0.93, 0.3, 0.4, 1.0],
  klingImageTool: [0.22, 0.78, 0.45, 1.0],
  klingAudioTool: [0.15, 0.7, 0.9, 1.0],
  llm: [0.13, 0.82, 0.52, 1.0],
  textSplitter: [0.95, 0.55, 0.25, 1.0],
}

export const getNodeAccent = (type: NodeType) => NODE_ACCENTS[type] || ([0.49, 0.83, 0.99, 1.0] as const)
