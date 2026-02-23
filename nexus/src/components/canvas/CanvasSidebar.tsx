import React, { useState } from 'react'
import {
  Archive, Brush, Camera, ChevronDown, ChevronLeft, Download, Film, Hand, History, LayoutGrid, Link2,
  Moon, MousePointer, Music, Plus, Settings, Sun, Video, Banana, Undo2, Redo2, ScanSearch,
  Save, Wand2, ShoppingBag, Sparkles
} from 'lucide-react'

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
  onGoHome?: () => void
  onToggleTheme?: () => void
  onOpenDownload?: () => void
  onToggleHistory?: () => void
  onOpenSettings?: () => void
  dark?: boolean
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
}) => (
  <button
    className={[
      'flex h-9 w-9 items-center justify-center rounded-lg transition-colors',
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
  onGoHome,
  onToggleTheme,
  onOpenDownload,
  onToggleHistory,
  onOpenSettings,
  dark,
  onUndo,
  onRedo,
  canUndo,
  canRedo
}: Props) {
  const [moreOpen, setMoreOpen] = useState(false)

  return (
    <div className="pointer-events-auto absolute left-4 top-4 bottom-4 z-30 flex w-[52px] flex-col gap-2">
      {/* 上段：功能工具（可滚动） */}
      <div className="flex flex-col rounded-[14px] border border-[var(--border-color)] bg-[var(--bg-secondary)] p-1.5 overflow-y-auto overflow-x-hidden scrollbar-thin flex-1 min-h-0">
        <IconButton title="返回首页" onClick={() => onGoHome?.()}>
          <ChevronLeft className="h-5 w-5" />
        </IconButton>

        <div className="my-0.5 h-px w-7 bg-[var(--border-color)] shrink-0" />

        <button
          className={[
            'flex h-9 w-9 items-center justify-center rounded-lg transition-colors shrink-0',
            nodeMenuOpen ? 'bg-[var(--accent-hover)] text-white' : 'bg-[var(--accent-color)] text-white hover:bg-[var(--accent-hover)]'
          ].join(' ')}
          onClick={() => onToggleNodeMenu()}
          title="添加节点"
          type="button"
        >
          <Plus className="h-5 w-5" />
        </button>

        <IconButton title="工作流模板" onClick={() => onOpenWorkflow?.()}>
          <LayoutGrid className="h-4.5 w-4.5" />
        </IconButton>
        <IconButton title="短剧制作" onClick={() => onOpenShortDrama?.()}>
          <Film className="h-4.5 w-4.5" />
        </IconButton>
        <IconButton title="电商工具台" onClick={() => onOpenEcomStudio?.()}>
          <ShoppingBag className="h-4.5 w-4.5" />
        </IconButton>
        <IconButton title="导演台" onClick={() => onOpenDirector?.()}>
          <Video className="h-4.5 w-4.5" />
        </IconButton>
        <IconButton title="草图编辑器" onClick={() => onOpenSketch?.()}>
          <Brush className="h-4.5 w-4.5" />
        </IconButton>
        <IconButton title="音频工作室" onClick={() => onOpenAudio?.()}>
          <Music className="h-4.5 w-4.5" />
        </IconButton>
        <IconButton title="图像融合" onClick={() => onOpenBlend?.()}>
          <Wand2 className="h-4.5 w-4.5" />
        </IconButton>

        {/* 折叠区：提示词/素材/模板 */}
        <div className="my-0.5 h-px w-7 bg-[var(--border-color)] shrink-0" />
        <IconButton title="提示词Agent" onClick={() => onOpenPromptAgent?.()}>
          <Sparkles className="h-4.5 w-4.5" />
        </IconButton>
        <IconButton title="Banana Pro 生图" onClick={() => onOpenPromptLibrary?.()}>
          <Banana className="h-4.5 w-4.5" />
        </IconButton>
        <IconButton title="提示词逆推" onClick={() => onOpenPromptReverse?.()}>
          <ScanSearch className="h-4.5 w-4.5" />
        </IconButton>

        {/* 更多工具（折叠） */}
        <button
          className={[
            'flex h-9 w-9 items-center justify-center rounded-lg transition-colors shrink-0',
            moreOpen
              ? 'bg-[var(--bg-tertiary)] text-[var(--text-primary)]'
              : 'bg-transparent text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)] hover:text-[var(--text-primary)]'
          ].join(' ')}
          onClick={() => setMoreOpen(!moreOpen)}
          title={moreOpen ? '收起更多' : '展开更多'}
          type="button"
        >
          <ChevronDown className={`h-4 w-4 transition-transform ${moreOpen ? 'rotate-180' : ''}`} />
        </button>

        {moreOpen && (
          <>
            <IconButton title="多角度相机控制" onClick={() => onOpenCameraControl?.()}>
              <Camera className="h-4.5 w-4.5" />
            </IconButton>
            <IconButton title="保存为模板" onClick={() => onSaveAsTemplate?.()}>
              <Save className="h-4.5 w-4.5" />
            </IconButton>
            <IconButton title="素材库" onClick={() => onOpenAssetLibrary?.()}>
              <Archive className="h-4.5 w-4.5" />
            </IconButton>
          </>
        )}
      </div>

      {/* 下段：画布工具 + 撤销重做（固定底部） */}
      <div className="flex flex-col rounded-[14px] border border-[var(--border-color)] bg-[var(--bg-secondary)] p-1.5 overflow-y-auto overflow-x-hidden scrollbar-thin min-h-0">
        <IconButton title="选择" active={activeTool === 'select'} onClick={() => onChangeTool('select')}>
          <MousePointer className="h-4.5 w-4.5" />
        </IconButton>
        <IconButton title="平移" active={activeTool === 'pan'} onClick={() => onChangeTool('pan')}>
          <Hand className="h-4.5 w-4.5" />
        </IconButton>
        <IconButton title="连线" active={activeTool === 'connect'} onClick={() => onChangeTool('connect')}>
          <Link2 className="h-4.5 w-4.5" />
        </IconButton>
        <div className="my-0.5 h-px w-7 bg-[var(--border-color)]" />
        <IconButton title="撤销 (Ctrl+Z)" onClick={() => onUndo?.()} disabled={!canUndo}>
          <Undo2 className="h-4.5 w-4.5" />
        </IconButton>
        <IconButton title="重做 (Ctrl+Shift+Z)" onClick={() => onRedo?.()} disabled={!canRedo}>
          <Redo2 className="h-4.5 w-4.5" />
        </IconButton>
        <div className="my-0.5 h-px w-7 bg-[var(--border-color)]" />
        <IconButton title="切换主题" onClick={() => onToggleTheme?.()}>
          {dark ? <Sun className="h-4.5 w-4.5" /> : <Moon className="h-4.5 w-4.5" />}
        </IconButton>
        <IconButton title="批量下载" onClick={() => onOpenDownload?.()}>
          <Download className="h-4.5 w-4.5" />
        </IconButton>
        <IconButton title="历史素材" onClick={() => onToggleHistory?.()}>
          <History className="h-4.5 w-4.5" />
        </IconButton>
        <IconButton title="设置" onClick={() => onOpenSettings?.()}>
          <Settings className="h-4.5 w-4.5" />
        </IconButton>
      </div>
    </div>
  )
}
