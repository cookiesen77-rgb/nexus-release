export const NODE_ACCENT_HEX: Record<string, string> = {
  text: '#22d37e',
  imageConfig: '#f59e0b',
  videoConfig: '#a855f7',
  blendConfig: '#06b6d4',
  image: '#3b82f6',
  video: '#ec4899',
  audio: '#eab308',
  localSave: '#6b7280',
  klingVideoTool: '#ef4444',
  klingImageTool: '#22c55e',
  klingAudioTool: '#f59e0b',
  llm: '#10b981',
  textSplitter: '#f97316',
}

export const getNodeAccentHex = (type: string) => NODE_ACCENT_HEX[type] || '#3b82f6'
