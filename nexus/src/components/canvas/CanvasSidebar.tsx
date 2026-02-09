import React from 'react'
import { Archive, Brush, Camera, Film, Hand, LayoutGrid, Link2, MousePointer, Music, Plus, Video, BookOpen, Undo2, Redo2, ScanSearch, Save, Wand2, ShoppingBag, Sparkles } from 'lucide-react'

export type CanvasTool = 'select' | 'pan' | 'connect'

type Props = {
  activeTool: CanvasTool
  nodeMenuOpen: boolean
  onChangeTool: (tool: CanvasTool) => void
  onToggleNodeMenu: () => void
  onOpenWorkflow?: () => void
  onOpenShortDrama?: () => void
  onOpenDirector?: () => void
  onOpenSketch?: () => void
  onOpenAudio?: () => void
  onOpenBlend?: () => void
  onOpenPromptLibrary?: () => void
  onOpenPromptReverse?: () => void
  onOpenCameraControl?: () => void
  onOpenEcomStudio?: () => void
  onOpenAssetLibrary?: () => void
  onOpenPromptAgent?: () => void
  onSaveAsTemplate?: () => void
  onUndo?: () => void
  onRedo?: () => void
  canUndo?: boolean
  canRedo?: boolean
}

const IconButton = ({
  active,
  disabled,
  title,
  onClick,
  children
}: {
  active?: boolean
  disabled?: boolean
  title: string
  onClick: () => void
  children: React.ReactNode
}) => {
  return (
    <button
      className={[
        'flex h-10 w-10 items-center justify-center rounded-xl transition-colors',
        disabled
          ? 'opacity-30 cursor-not-allowed'
          : active
            ? 'bg-[var(--bg-tertiary)] text-[var(--text-primary)]'
            : 'bg-transparent text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)] hover:text-[var(--text-primary)]'
      ].join(' ')}
      onClick={disabled ? undefined : onClick}
      title={title}
      type="button"
      disabled={disabled}
    >
      {children}
    </button>
  )
}

export default function CanvasSidebar({
  activeTool,
  nodeMenuOpen,
  onChangeTool,
  onToggleNodeMenu,
  onOpenWorkflow,
  onOpenShortDrama,
  onOpenDirector,
  onOpenSketch,
  onOpenAudio,
  onOpenBlend,
  onOpenPromptLibrary,
  onOpenPromptReverse,
  onOpenCameraControl,
  onOpenEcomStudio,
  onOpenAssetLibrary,
  onOpenPromptAgent,
  onSaveAsTemplate,
  onUndo,
  onRedo,
  canUndo,
  canRedo
}: Props) {
  return (
    <div className="pointer-events-auto absolute left-4 top-56 z-30 w-14 max-h-[calc(100vh-240px)] overflow-y-auto scrollbar-thin rounded-[14px] border border-[var(--border-color)] bg-[var(--bg-secondary)] p-2">
      <button
        className={[
          'flex h-10 w-10 items-center justify-center rounded-xl transition-colors',
          nodeMenuOpen ? 'bg-[var(--accent-hover)] text-white' : 'bg-[var(--accent-color)] text-white hover:bg-[var(--accent-hover)]'
        ].join(' ')}
        onClick={() => onToggleNodeMenu()}
        title="添加节点"
        type="button"
      >
        <Plus className="h-5 w-5" />
      </button>

      <IconButton
        title="工作流模板"
        onClick={() => onOpenWorkflow?.()}
      >
        <LayoutGrid className="h-5 w-5" />
      </IconButton>

      <IconButton
        title="短剧制作"
        onClick={() => onOpenShortDrama?.()}
      >
        <Film className="h-5 w-5" />
      </IconButton>

      <IconButton
        title="电商工具台"
        onClick={() => onOpenEcomStudio?.()}
      >
        <ShoppingBag className="h-5 w-5" />
      </IconButton>

      <IconButton
        title="导演台"
        onClick={() => onOpenDirector?.()}
      >
        <Video className="h-5 w-5" />
      </IconButton>

      <IconButton
        title="草图编辑器"
        onClick={() => onOpenSketch?.()}
      >
        <Brush className="h-5 w-5" />
      </IconButton>

      <IconButton
        title="音频工作室"
        onClick={() => onOpenAudio?.()}
      >
        <Music className="h-5 w-5" />
      </IconButton>

      <IconButton
        title="图像融合"
        onClick={() => onOpenBlend?.()}
      >
        <Wand2 className="h-5 w-5" />
      </IconButton>

      <IconButton
        title="提示词库"
        onClick={() => onOpenPromptLibrary?.()}
      >
        <BookOpen className="h-5 w-5" />
      </IconButton>

      <IconButton
        title="提示词逆推"
        onClick={() => onOpenPromptReverse?.()}
      >
        <ScanSearch className="h-5 w-5" />
      </IconButton>

      <IconButton
        title="提示词Agent"
        onClick={() => onOpenPromptAgent?.()}
      >
        <Sparkles className="h-5 w-5" />
      </IconButton>

      <IconButton
        title="保存为模板"
        onClick={() => onSaveAsTemplate?.()}
      >
        <Save className="h-5 w-5" />
      </IconButton>

      <IconButton
        title="素材库"
        onClick={() => onOpenAssetLibrary?.()}
      >
        <Archive className="h-5 w-5" />
      </IconButton>

      <div className="my-1 h-px w-8 bg-[var(--border-color)]" />

      <IconButton
        title="多角度相机控制"
        onClick={() => onOpenCameraControl?.()}
      >
        <Camera className="h-5 w-5" />
      </IconButton>

      <div className="my-1 h-px w-8 bg-[var(--border-color)]" />

      <IconButton title="选择" active={activeTool === 'select'} onClick={() => onChangeTool('select')}>
        <MousePointer className="h-5 w-5" />
      </IconButton>
      <IconButton title="平移" active={activeTool === 'pan'} onClick={() => onChangeTool('pan')}>
        <Hand className="h-5 w-5" />
      </IconButton>
      <IconButton title="连线" active={activeTool === 'connect'} onClick={() => onChangeTool('connect')}>
        <Link2 className="h-5 w-5" />
      </IconButton>

      <div className="my-1 h-px w-8 bg-[var(--border-color)]" />

      <IconButton 
        title="撤销 (Ctrl+Z)" 
        onClick={() => onUndo?.()} 
        disabled={!canUndo}
      >
        <Undo2 className="h-5 w-5" />
      </IconButton>
      <IconButton 
        title="重做 (Ctrl+Shift+Z)" 
        onClick={() => onRedo?.()} 
        disabled={!canRedo}
      >
        <Redo2 className="h-5 w-5" />
      </IconButton>
    </div>
  )
}
