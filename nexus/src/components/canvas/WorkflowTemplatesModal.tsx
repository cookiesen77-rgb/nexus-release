/**
 * Workflow Templates Modal | 工作流模板弹窗
 * 显示预设工作流模板和用户自定义模板，支持一键添加到画布
 */

import React, { useState, useEffect } from 'react'
import { Button } from '@/components/ui/button'
import { X, LayoutGrid, Layers, Trash2, User, Building2 } from 'lucide-react'
import { WORKFLOW_TEMPLATES } from '@/config/workflows'
import { loadUserTemplates, deleteUserTemplate, applyUserTemplate, type UserWorkflowTemplate } from '@/lib/workflowTemplates'

interface Props {
  open: boolean
  onClose: () => void
  onSelectTemplate: (templateId: string) => void
}

type TabType = 'system' | 'user'

export default function WorkflowTemplatesModal({ open, onClose, onSelectTemplate }: Props) {
  const [activeTab, setActiveTab] = useState<TabType>('system')
  const [userTemplates, setUserTemplates] = useState<UserWorkflowTemplate[]>([])

  // 加载用户模板
  useEffect(() => {
    if (open) {
      setUserTemplates(loadUserTemplates())
    }
  }, [open])

  if (!open) return null

  const handleSelectSystem = (templateId: string) => {
    onSelectTemplate(templateId)
    onClose()
  }

  const handleSelectUser = (template: UserWorkflowTemplate) => {
    applyUserTemplate(template)
    window.$message?.success?.(`已应用模板: ${template.name}`)
    onClose()
  }

  const handleDeleteUser = (e: React.MouseEvent, templateId: string) => {
    e.stopPropagation()
    if (deleteUserTemplate(templateId)) {
      setUserTemplates(loadUserTemplates())
      window.$message?.success?.('模板已删除')
    }
  }

  const formatDate = (timestamp: number) => {
    const date = new Date(timestamp)
    return date.toLocaleDateString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit' })
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div
        className="flex max-h-[80vh] w-[700px] max-w-[95vw] flex-col overflow-hidden rounded-2xl border border-[var(--border-color)] bg-[var(--bg-secondary)] shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-[var(--border-color)] px-5 py-4">
          <div className="flex items-center gap-3">
            <LayoutGrid className="h-5 w-5 text-[var(--accent-color)]" />
            <h2 className="text-lg font-semibold text-[var(--text-primary)]">工作流模板</h2>
          </div>
          <button
            onClick={onClose}
            className="rounded-full p-1 text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-primary)] hover:text-[var(--text-primary)]"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-[var(--border-color)] px-5">
          <button
            className={`flex items-center gap-2 px-4 py-3 text-sm font-medium transition-colors border-b-2 -mb-[1px] ${
              activeTab === 'system'
                ? 'text-[var(--accent-color)] border-[var(--accent-color)]'
                : 'text-[var(--text-secondary)] border-transparent hover:text-[var(--text-primary)]'
            }`}
            onClick={() => setActiveTab('system')}
          >
            <Building2 className="h-4 w-4" />
            系统模板
          </button>
          <button
            className={`flex items-center gap-2 px-4 py-3 text-sm font-medium transition-colors border-b-2 -mb-[1px] ${
              activeTab === 'user'
                ? 'text-[var(--accent-color)] border-[var(--accent-color)]'
                : 'text-[var(--text-secondary)] border-transparent hover:text-[var(--text-primary)]'
            }`}
            onClick={() => setActiveTab('user')}
          >
            <User className="h-4 w-4" />
            我的模板
            {userTemplates.length > 0 && (
              <span className="ml-1 px-1.5 py-0.5 text-xs bg-[var(--accent-color)] text-white rounded-full">
                {userTemplates.length}
              </span>
            )}
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-auto p-5">
          {activeTab === 'system' && (
            <div className="grid gap-4 sm:grid-cols-2">
              {WORKFLOW_TEMPLATES.map((template: any) => (
                <div
                  key={template.id}
                  className="group cursor-pointer overflow-hidden rounded-xl border border-[var(--border-color)] bg-[var(--bg-primary)] transition-all hover:border-[var(--accent-color)] hover:shadow-lg"
                  onClick={() => handleSelectSystem(template.id)}
                >
                  {/* Cover image */}
                  <div className="aspect-video bg-gradient-to-br from-[var(--accent-color)]/20 to-[var(--accent-color)]/5 relative overflow-hidden">
                    {template.cover ? (
                      <img
                        src={template.cover}
                        alt={template.name}
                        className="h-full w-full object-cover opacity-80 transition-opacity group-hover:opacity-100"
                      />
                    ) : (
                      <div className="flex h-full w-full items-center justify-center">
                        <Layers className="h-12 w-12 text-[var(--accent-color)]/50" />
                      </div>
                    )}
                    <div className="absolute inset-0 bg-gradient-to-t from-black/60 to-transparent" />
                    <div className="absolute bottom-3 left-3 right-3">
                      <h3 className="text-base font-semibold text-white">{template.name}</h3>
                    </div>
                  </div>

                  {/* Info */}
                  <div className="p-3">
                    <p className="text-sm text-[var(--text-secondary)] line-clamp-2">
                      {template.description}
                    </p>
                    <div className="mt-3 flex items-center justify-between">
                      <span className="rounded-full bg-[var(--bg-tertiary)] px-2 py-0.5 text-xs text-[var(--text-secondary)]">
                        {template.category === 'storyboard' ? '分镜' : template.category}
                      </span>
                      <Button size="sm" variant="ghost" className="text-[var(--accent-color)]">
                        使用模板
                      </Button>
                    </div>
                  </div>
                </div>
              ))}

              {WORKFLOW_TEMPLATES.length === 0 && (
                <div className="col-span-2 flex flex-col items-center justify-center py-12 text-[var(--text-secondary)]">
                  <LayoutGrid className="mb-3 h-12 w-12 opacity-40" />
                  <div className="text-sm">暂无系统模板</div>
                </div>
              )}
            </div>
          )}

          {activeTab === 'user' && (
            <div className="grid gap-4 sm:grid-cols-2">
              {userTemplates.map((template) => (
                <div
                  key={template.id}
                  className="group cursor-pointer overflow-hidden rounded-xl border border-[var(--border-color)] bg-[var(--bg-primary)] transition-all hover:border-[var(--accent-color)] hover:shadow-lg"
                  onClick={() => handleSelectUser(template)}
                >
                  {/* Cover placeholder */}
                  <div className="aspect-video bg-gradient-to-br from-purple-500/20 to-blue-500/20 relative overflow-hidden flex items-center justify-center">
                    <div className="text-center">
                      <Layers className="h-10 w-10 mx-auto text-[var(--text-secondary)] opacity-50" />
                      <div className="mt-2 text-xs text-[var(--text-secondary)] opacity-50">
                        {template.nodes.length} 个节点
                      </div>
                    </div>
                    <div className="absolute inset-0 bg-gradient-to-t from-black/60 to-transparent" />
                    <div className="absolute bottom-3 left-3 right-3">
                      <h3 className="text-base font-semibold text-white">{template.name}</h3>
                    </div>
                    {/* Delete button */}
                    <button
                      onClick={(e) => handleDeleteUser(e, template.id)}
                      className="absolute top-2 right-2 p-1.5 bg-red-500/80 hover:bg-red-500 rounded-lg text-white opacity-0 group-hover:opacity-100 transition-opacity"
                      title="删除模板"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>

                  {/* Info */}
                  <div className="p-3">
                    <p className="text-sm text-[var(--text-secondary)] line-clamp-2">
                      {template.description || '自定义工作流模板'}
                    </p>
                    <div className="mt-3 flex items-center justify-between">
                      <span className="text-xs text-[var(--text-secondary)]">
                        {formatDate(template.createdAt)}
                      </span>
                      <Button size="sm" variant="ghost" className="text-[var(--accent-color)]">
                        使用模板
                      </Button>
                    </div>
                  </div>
                </div>
              ))}

              {userTemplates.length === 0 && (
                <div className="col-span-2 flex flex-col items-center justify-center py-12 text-[var(--text-secondary)]">
                  <User className="mb-3 h-12 w-12 opacity-40" />
                  <div className="text-sm">暂无自定义模板</div>
                  <div className="mt-2 text-xs opacity-60">点击左侧工具栏的「保存」按钮创建模板</div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex justify-end border-t border-[var(--border-color)] p-4">
          <Button variant="ghost" onClick={onClose}>
            关闭
          </Button>
        </div>
      </div>
    </div>
  )
}
