/**
 * Image Edit Toolbar | 图片编辑悬浮工具栏
 * 显示在图片节点上方，提供快速编辑功能
 * - 移除超分功能
 * - 擦除和重绘支持用户选择模型和分辨率
 */

import React, { memo, useState, useCallback } from 'react'
import {
  Move,
  RotateCcw,
  Grid2x2,
  Grid3x3,
  Expand,
  Scissors,
  Eraser,
  Loader2,
  PaintBucket
} from 'lucide-react'
import ImageEditModal from './ImageEditModal'
import GridCropModal, { type CropAreaPx } from './GridCropModal'
import MaskEditorModal from './MaskEditorModal'
import {
  changePose,
  changeAngle,
  expandImage,
  cutoutImage,
  cropFourGrid,
  cropNineGrid,
  inpaintImage,
  eraseWithMask,
  type EditOptions
} from '@/lib/imageEdit/generator'

interface Props {
  nodeId: string
  imageUrl: string
  visible: boolean
  onBusyChange?: (busy: boolean) => void
  onHoverChange?: (hovering: boolean) => void
}

type EditAction = 'pose' | 'angle' | 'expand' | 'cutout' | 'erase' | 'grid4' | 'grid9' | 'inpaint'

interface ToolButton {
  key: EditAction
  icon: React.ComponentType<{ className?: string }>
  label: string
  needsInput: boolean
  needsMask?: boolean
  placeholder?: string
}

const TOOLS: ToolButton[] = [
  { key: 'pose', icon: Move, label: '姿态', needsInput: true, placeholder: '输入想要的姿态（如：站立、跑步、坐下）' },
  { key: 'angle', icon: RotateCcw, label: '角度', needsInput: true, placeholder: '输入想要的角度（如：俯视、侧面、仰视）' },
  { key: 'grid4', icon: Grid2x2, label: '四宫格', needsInput: false },
  { key: 'grid9', icon: Grid3x3, label: '九宫格', needsInput: false },
  { key: 'expand', icon: Expand, label: '扩图', needsInput: false },
  { key: 'cutout', icon: Scissors, label: '抠图', needsInput: true, placeholder: '输入要抠出的对象（如：人物、猫、杯子）' },
  { key: 'inpaint', icon: PaintBucket, label: '重绘', needsInput: false, needsMask: true },
  { key: 'erase', icon: Eraser, label: '擦除', needsInput: false, needsMask: true },
]

export default memo(function ImageEditToolbar({ nodeId, imageUrl, visible, onBusyChange, onHoverChange }: Props) {
  const [modalOpen, setModalOpen] = useState(false)
  const [currentAction, setCurrentAction] = useState<EditAction | null>(null)
  const [gridCropOpen, setGridCropOpen] = useState(false)
  const [gridCropSize, setGridCropSize] = useState<2 | 3>(3)
  const [maskEditorOpen, setMaskEditorOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [progress, setProgress] = useState('')

  const handleToolClick = useCallback((tool: ToolButton) => {
    if (tool.needsInput) {
      setCurrentAction(tool.key)
      setModalOpen(true)
    } else if (tool.needsMask) {
      setCurrentAction(tool.key)
      setMaskEditorOpen(true)
    } else {
      if (tool.key === 'grid4' || tool.key === 'grid9') {
        setCurrentAction(tool.key)
        setGridCropSize(tool.key === 'grid4' ? 2 : 3)
        setGridCropOpen(true)
        return
      }
      executeAction(tool.key, '')
    }
  }, [])

  const executeAction = useCallback(async (
    action: EditAction,
    userInput: string,
    cropArea?: CropAreaPx,
    maskBase64?: string,
    model?: string,
    resolution?: string
  ) => {
    setLoading(true)
    setProgress('准备中...')
    setModalOpen(false)
    setGridCropOpen(false)
    setMaskEditorOpen(false)
    onBusyChange?.(true)

    try {
      const options: EditOptions = {
        sourceNodeId: nodeId,
        sourceImageUrl: imageUrl,
        userInput,
        onProgress: setProgress
      }

      switch (action) {
        case 'pose':
          await changePose(options)
          window.$message?.success?.('姿态变换完成')
          break
        case 'angle':
          await changeAngle(options)
          window.$message?.success?.('角度变换完成')
          break
        case 'expand':
          await expandImage(options)
          window.$message?.success?.('扩图完成')
          break
        case 'cutout':
          await cutoutImage(options)
          window.$message?.success?.('抠图完成')
          break
        case 'erase':
          if (maskBase64) {
            await eraseWithMask({ ...options, maskBase64, model, resolution })
          } else {
            throw new Error('请绘制要擦除的区域')
          }
          window.$message?.success?.('擦除完成')
          break
        case 'inpaint':
          if (!maskBase64) throw new Error('请绘制蒙版区域')
          await inpaintImage({ ...options, maskBase64, userInput, model, resolution })
          window.$message?.success?.('重绘完成')
          break
        case 'grid4':
          await cropFourGrid({ ...(options as any), cropArea })
          window.$message?.success?.('四宫格裁剪完成')
          break
        case 'grid9':
          await cropNineGrid({ ...(options as any), cropArea })
          window.$message?.success?.('九宫格裁剪完成')
          break
      }
    } catch (err: any) {
      console.error('[ImageEditToolbar] 操作失败:', err)
      window.$message?.error?.(err?.message || '操作失败')
    } finally {
      setLoading(false)
      setProgress('')
      setCurrentAction(null)
      onBusyChange?.(false)
    }
  }, [nodeId, imageUrl, onBusyChange])

  const handleModalConfirm = useCallback((input: string) => {
    if (currentAction) {
      executeAction(currentAction, input)
    }
  }, [currentAction, executeAction])

  const handleGridCropConfirm = useCallback((crop: CropAreaPx) => {
    if (!currentAction) return
    if (currentAction !== 'grid4' && currentAction !== 'grid9') return
    executeAction(currentAction, '', crop)
  }, [currentAction, executeAction])

  const handleModalClose = useCallback(() => {
    setModalOpen(false)
    setCurrentAction(null)
  }, [])

  const handleGridCropClose = useCallback(() => {
    setGridCropOpen(false)
    setCurrentAction(null)
  }, [])

  const handleMaskEditorConfirm = useCallback((maskBase64: string, prompt?: string, model?: string, resolution?: string) => {
    if (!currentAction) return
    executeAction(currentAction, prompt || '', undefined, maskBase64, model, resolution)
  }, [currentAction, executeAction])

  const handleMaskEditorClose = useCallback(() => {
    setMaskEditorOpen(false)
    setCurrentAction(null)
  }, [])

  // Keep rendering when any modal is open (modalOpen, gridCropOpen, maskEditorOpen)
  const hasOpenModal = modalOpen || gridCropOpen || maskEditorOpen
  if (!visible && !loading && !hasOpenModal) return null

  const currentTool = TOOLS.find(t => t.key === currentAction)

  // Hide toolbar when full-screen modal (mask editor, grid crop) is open
  const showToolbar = (visible || loading) && !maskEditorOpen && !gridCropOpen

  return (
    <>
      {/* 悬浮工具栏 - 全屏弹窗打开时隐藏 */}
      {showToolbar && (
        <div
          className="absolute -top-[52px] left-0 right-[50px] flex justify-center z-[1001]"
          onMouseDown={(e) => e.stopPropagation()}
          onPointerDown={(e) => e.stopPropagation()}
          onMouseEnter={() => onHoverChange?.(true)}
          onMouseLeave={() => onHoverChange?.(false)}
        >
          <div className="flex items-center gap-1.5 px-3 py-2 bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-lg">
            {loading ? (
              <div className="flex items-center gap-2 px-3 text-sm text-gray-600 dark:text-gray-300">
                <Loader2 className="h-5 w-5 animate-spin" />
                <span>{progress || '处理中...'}</span>
              </div>
            ) : (
              TOOLS.map((tool) => {
                const Icon = tool.icon
                return (
                  <button
                    key={tool.key}
                    onClick={() => handleToolClick(tool)}
                    className="group flex items-center gap-0 hover:gap-1.5 p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 transition-all"
                    title={tool.label}
                  >
                    <Icon className="h-5 w-5 text-gray-600 dark:text-gray-300" />
                    <span className="text-sm text-gray-600 dark:text-gray-300 max-w-0 overflow-hidden group-hover:max-w-[70px] transition-all duration-200 whitespace-nowrap">
                      {tool.label}
                    </span>
                  </button>
                )
              })
            )}
          </div>
        </div>
      )}

      {/* 输入弹窗 */}
      {modalOpen && currentTool && (
        <ImageEditModal
          open={modalOpen}
          title={currentTool.label}
          placeholder={currentTool.placeholder || ''}
          onConfirm={handleModalConfirm}
          onClose={handleModalClose}
        />
      )}

      {/* 四/九宫格裁剪弹窗 */}
      {gridCropOpen && currentAction && (currentAction === 'grid4' || currentAction === 'grid9') && (
        <GridCropModal
          open={gridCropOpen}
          imageUrl={imageUrl}
          gridSize={gridCropSize}
          onClose={handleGridCropClose}
          onConfirm={handleGridCropConfirm}
        />
      )}

      {/* 蒙版编辑弹窗 */}
      {maskEditorOpen && currentAction && (currentAction === 'inpaint' || currentAction === 'erase') && (
        <MaskEditorModal
          open={maskEditorOpen}
          imageUrl={imageUrl}
          mode={currentAction as 'inpaint' | 'erase'}
          onClose={handleMaskEditorClose}
          onConfirm={handleMaskEditorConfirm}
        />
      )}
    </>
  )
})
