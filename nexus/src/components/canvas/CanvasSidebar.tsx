import React, { useState } from 'react'
import {
  Archive, Brush, Camera, Film, Hand, LayoutGrid, Link2,
  MousePointer, Music, Plus, Video, BookOpen, Undo2, Redo2, ScanSearch,
  Save, Wand2, ShoppingBag, Sparkles, Clapperboard, MessageCircle,
  History, ImageIcon, ChevronDown, ChevronLeft, Moon, Sun, Download, Settings
} from 'lucide-react'

export type CanvasTool = 'select' | 'pan' | 'connect'

type Props = {
  activeTool: CanvasTool
  nodeMenuOpen: boolean
  onChangeTool: (tool: CanvasTool) => void
  onToggleNodeMenu: () => void
  onBack?: () => void
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
  onToggleDark?: () => void
  onOpenDownload?: () => void
  onOpenHistory?: () => void
  onOpenSettings?: () => void
  dark?: boolean
  onUndo?: () => void
  onRedo?: () => void
  canUndo?: boolean
  canRedo?: boolean
}

const DockIcon = ({ title, onClick, active, children }: {
  title: string; onClick: () => void; active?: boolean; children: React.ReactNode
}) => (
  <div
    className={`rounded-md w-full aspect-square flex justify-center items-center cursor-pointer transition-colors ${
      active
        ? 'text-[var(--text-primary)] bg-[var(--bg-tertiary)]'
        : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-tertiary)]'
    }`}
    onClick={onClick}
    title={title}
  >
    {children}
  </div>
)

export default function CanvasSidebar({
  activeTool, nodeMenuOpen, onChangeTool, onToggleNodeMenu, onBack,
  onOpenWorkflow, onOpenShortDrama, onOpenDirector, onOpenSketch, onOpenAudio, onOpenBlend,
  onOpenPromptLibrary, onOpenPromptReverse, onOpenCameraControl,
  onOpenEcomStudio, onOpenAssetLibrary, onOpenPromptAgent, onSaveAsTemplate,
  onToggleDark, onOpenDownload, onOpenHistory, onOpenSettings, dark,
  onUndo, onRedo, canUndo, canRedo,
}: Props) {
  const [moreOpen, setMoreOpen] = useState(false)

  return (
    <div className="pointer-events-auto fixed left-4 top-4 bottom-4 z-40 flex flex-col items-center gap-2">
      {/* TapNow Dockbar: 54px宽, 32px圆角, 深色毛玻璃 */}
      <div
        className="flex flex-col gap-1 items-center rounded-[32px] relative p-1.5 box-border"
        style={{ width: 54, backgroundColor: 'var(--bg-secondary)', backdropFilter: 'blur(24px)', border: '1px solid rgba(128,128,128,0.15)' }}
        data-testid="canvas-dockbar-container"
      >
        {/* 返回主页 */}
        <button
          className="flex items-center justify-center cursor-pointer transition-colors text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
          style={{ width: 40, height: 32, borderRadius: 8 }}
          onClick={() => onBack?.()}
          title="返回主页"
        >
          <ChevronLeft size={18} />
        </button>

        {/* ⊕ 添加节点 - TapNow: 40x40 白色圆形 */}
        <button
          className="flex items-center justify-center shadow cursor-pointer transition-all duration-300"
          style={{ width: 40, height: 40, borderRadius: '50%', backgroundColor: 'var(--text-primary)', color: 'var(--bg-primary)' }}
          onClick={() => onToggleNodeMenu()}
          title="添加节点"
        >
          <Plus className={`!w-5 !h-5 transition-transform duration-300 ${nodeMenuOpen ? 'rotate-45' : 'rotate-0'}`} />
        </button>

        {/* 主功能区 */}
        <div className="w-full flex flex-col gap-1.5 pt-1 px-px">
          {/* 素材库 */}
          <DockIcon title="素材库" onClick={() => onOpenAssetLibrary?.()}>
            <Archive size={20} />
          </DockIcon>

          {/* 工作流模板 */}
          <DockIcon title="工作流模板" onClick={() => onOpenWorkflow?.()}>
            <LayoutGrid size={20} />
          </DockIcon>

          {/* 提示词 Agent */}
          <DockIcon title="提示词 Agent" onClick={() => onOpenPromptAgent?.()}>
            <Sparkles size={20} />
          </DockIcon>

          {/* 历史 / 提示词库 */}
          <DockIcon title="提示词库" onClick={() => onOpenPromptLibrary?.()}>
            <BookOpen size={20} />
          </DockIcon>

          {/* 图片编辑器 / 草图 */}
          <DockIcon title="草图编辑器" onClick={() => onOpenSketch?.()}>
            <Brush size={20} />
          </DockIcon>
        </div>

        {/* 更多工具 (折叠) */}
        <div className="w-full border-t border-[var(--border-color)]/30 pt-1 mt-0.5">
          <DockIcon title={moreOpen ? '收起' : '更多工具'} onClick={() => setMoreOpen(p => !p)}>
            <ChevronDown size={16} className={`transition-transform duration-200 ${moreOpen ? 'rotate-180' : ''}`} />
          </DockIcon>
          {moreOpen && (
            <div className="flex flex-col gap-1 mt-1">
              <DockIcon title="短剧制作" onClick={() => onOpenShortDrama?.()}><Film size={18} /></DockIcon>
              <DockIcon title="电商工具" onClick={() => onOpenEcomStudio?.()}><ShoppingBag size={18} /></DockIcon>
              <DockIcon title="导演台" onClick={() => onOpenDirector?.()}><Video size={18} /></DockIcon>
              <DockIcon title="音频工作室" onClick={() => onOpenAudio?.()}><Music size={18} /></DockIcon>
              <DockIcon title="图像融合" onClick={() => onOpenBlend?.()}><Wand2 size={18} /></DockIcon>
              <DockIcon title="逆推提示词" onClick={() => onOpenPromptReverse?.()}><ScanSearch size={18} /></DockIcon>
              <DockIcon title="相机控制" onClick={() => onOpenCameraControl?.()}><Camera size={18} /></DockIcon>
              <DockIcon title="保存为模板" onClick={() => onSaveAsTemplate?.()}><Save size={18} /></DockIcon>
            </div>
          )}
        </div>
      </div>

      {/* 底部: 画布工具 + 功能按钮 */}
      <div
        className="flex flex-col gap-0.5 items-center p-1 box-border"
        style={{ borderRadius: 20, backgroundColor: 'var(--bg-secondary)', backdropFilter: 'blur(24px)', border: '1px solid rgba(128,128,128,0.15)' }}
      >
        <DockIcon title="选择 (V)" onClick={() => onChangeTool('select')} active={activeTool === 'select'}>
          <MousePointer size={16} />
        </DockIcon>
        <DockIcon title="平移 (H)" onClick={() => onChangeTool('pan')} active={activeTool === 'pan'}>
          <Hand size={16} />
        </DockIcon>
        <DockIcon title="连线 (L)" onClick={() => onChangeTool('connect')} active={activeTool === 'connect'}>
          <Link2 size={16} />
        </DockIcon>
        <div className="w-5 h-px bg-[var(--border-color)]/30 my-0.5" />
        <DockIcon title="主题" onClick={() => onToggleDark?.()}>
          {dark ? <Moon size={14} /> : <Sun size={14} />}
        </DockIcon>
        <DockIcon title="批量下载" onClick={() => onOpenDownload?.()}>
          <Download size={14} />
        </DockIcon>
        <DockIcon title="历史素材" onClick={() => onOpenHistory?.()}>
          <History size={14} />
        </DockIcon>
        <DockIcon title="API 设置" onClick={() => onOpenSettings?.()}>
          <Settings size={14} />
        </DockIcon>
      </div>
    </div>
  )
}
