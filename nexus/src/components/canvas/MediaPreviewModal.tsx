/**
 * Media Preview Modal | 媒体预览弹窗
 * 在应用内预览图片和视频
 */

import React from 'react'
import { X } from 'lucide-react'

interface Props {
  open: boolean
  url: string
  type: 'image' | 'video'
  onClose: () => void
}

export default function MediaPreviewModal({ open, url, type, onClose }: Props) {
  if (!open || !url) return null

  return (
    <div
      className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/80"
      onClick={onClose}
    >
      {/* 关闭按钮 */}
      <button
        onClick={onClose}
        className="absolute top-4 right-4 z-10 rounded-full bg-black/50 p-2 text-white transition-colors hover:bg-black/70"
      >
        <X className="h-6 w-6" />
      </button>
      
      {/* 媒体内容 */}
      <div
        className="max-h-[90vh] max-w-[90vw]"
        onClick={(e) => e.stopPropagation()}
      >
        {type === 'image' ? (
          <img
            src={url}
            alt="Preview"
            className="max-h-[90vh] max-w-[90vw] object-contain"
          />
        ) : (
          <video
            src={url}
            controls
            autoPlay
            className="max-h-[90vh] max-w-[90vw]"
          />
        )}
      </div>
    </div>
  )
}
