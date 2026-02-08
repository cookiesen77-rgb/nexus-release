import React, { useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Input } from '@/components/ui/input'
import SettingsDialog from '@/components/SettingsDialog'
import { useProjectsStore } from '@/store/projects'

export default function Home() {
  const nav = useNavigate()
  const [settingsOpen, setSettingsOpen] = useState(false)

  const projects = useProjectsStore((s) => s.projects)
  const hydrateProjects = useProjectsStore((s) => s.hydrate)
  const createProject = useProjectsStore((s) => s.create)
  const renameProject = useProjectsStore((s) => s.rename)
  const updateDescription = useProjectsStore((s) => s.updateDescription)
  const duplicateProject = useProjectsStore((s) => s.duplicate)
  const deleteProject = useProjectsStore((s) => s.remove)

  const [inputText, setInputText] = useState('')
  const suggestions = useMemo(() => ['分镜脚本', '二次元头像', '赛博朋克海报', '角色一致性', '图生视频'], [])

  // 重命名弹窗
  const [renameOpen, setRenameOpen] = useState(false)
  const renameIdRef = useRef<string | null>(null)
  const [renameValue, setRenameValue] = useState('')

  // 备注弹窗
  const [descOpen, setDescOpen] = useState(false)
  const descIdRef = useRef<string | null>(null)
  const [descValue, setDescValue] = useState('')

  // 删除确认弹窗
  const [deleteOpen, setDeleteOpen] = useState(false)
  const deleteIdRef = useRef<string | null>(null)
  const deleteNameRef = useRef<string>('')

  // 新建项目命名弹窗
  const [createOpen, setCreateOpen] = useState(false)
  const [createName, setCreateName] = useState('')

  const openRename = (id: string, currentName: string) => {
    renameIdRef.current = id
    setRenameValue(currentName)
    setRenameOpen(true)
  }

  const confirmRename = () => {
    const id = renameIdRef.current
    if (!id) return
    renameProject(id, renameValue)
    setRenameOpen(false)
    renameIdRef.current = null
  }

  const openDesc = (id: string, currentDesc: string) => {
    descIdRef.current = id
    setDescValue(currentDesc || '')
    setDescOpen(true)
  }

  const confirmDesc = () => {
    const id = descIdRef.current
    if (!id) return
    updateDescription(id, descValue)
    setDescOpen(false)
    descIdRef.current = null
  }

  const openDeleteConfirm = (id: string, name: string) => {
    deleteIdRef.current = id
    deleteNameRef.current = name
    setDeleteOpen(true)
  }

  const confirmDelete = async () => {
    const id = deleteIdRef.current
    if (!id) return
    setDeleteOpen(false)
    try {
      await deleteProject(id)
      window.$message?.success('项目已删除')
    } catch (err) {
      console.error('删除项目失败:', err)
      window.$message?.error('删除失败')
    }
    deleteIdRef.current = null
    deleteNameRef.current = ''
  }

  const createWithInput = () => {
    const text = inputText.trim()
    const id = createProject(text ? text.slice(0, 18) : '新项目')
    hydrateProjects()
    setInputText('')
    nav(`/canvas/${id}`, { state: text ? { initialPrompt: text } : undefined })
  }

  const openCreateDialog = () => {
    setCreateName('')
    setCreateOpen(true)
  }

  const confirmCreate = () => {
    const name = createName.trim() || '新项目'
    const id = createProject(name)
    hydrateProjects()
    setCreateOpen(false)
    nav(`/canvas/${id}`)
  }

  return (
    <div className="h-full w-full overflow-auto bg-[var(--bg-primary)] text-[var(--text-primary)]">
      <div className="mx-auto w-full max-w-[1440px]">
        <div className="relative h-[140px]">
          <img
            src={`${import.meta.env.BASE_URL}logo.png`}
            className="pointer-events-none absolute left-1/2 top-[14px] h-[177px] w-[212px] -translate-x-1/2 select-none"
            alt="Nexus"
          />

          <button
            className="absolute right-8 top-6 rounded-full border border-[var(--border-color)] bg-[var(--bg-tertiary)] px-3.5 py-2.5 text-[13px] font-medium text-[var(--text-primary)] hover:bg-[var(--bg-secondary)]"
            onClick={() => setSettingsOpen(true)}
          >
            API 设置
          </button>
        </div>

        <main className="flex flex-col gap-6 px-8 pb-10 pt-8">
          <div className="text-[34px] font-normal tracking-tight text-[var(--text-primary)]">开始一个新项目</div>

          <section className="w-full rounded-[20px] border border-[var(--border-color)] bg-[var(--bg-secondary)] p-5">
            <div className="text-xs text-[var(--text-secondary)]">你的创意</div>

            <textarea
              value={inputText}
              onChange={(e) => setInputText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                  e.preventDefault()
                  createWithInput()
                }
              }}
              placeholder="输入提示词、分镜想法或电商文案…"
              className="mt-2 h-[120px] w-full resize-none rounded-2xl bg-[var(--bg-tertiary)] p-4 text-sm text-[var(--text-primary)] outline-none placeholder:text-[var(--text-secondary)]"
            />

            <div className="mt-3 flex flex-wrap gap-2">
              {suggestions.map((t) => (
                <button
                  key={t}
                  onClick={() => setInputText(t)}
                  className="rounded-full border border-[var(--border-color)] bg-[var(--bg-secondary)] px-3 py-2 text-xs font-semibold text-[var(--text-primary)] hover:bg-[var(--bg-tertiary)]"
                >
                  {t}
                </button>
              ))}
            </div>

            <div className="mt-3 flex items-center justify-end gap-2">
              <button
                className="rounded-full border border-[var(--border-color)] bg-[var(--bg-tertiary)] px-4 py-2.5 text-sm font-semibold text-[var(--text-primary)] hover:bg-[var(--bg-secondary)]"
                onClick={openCreateDialog}
              >
                新建空项目
              </button>
              <button
                className="rounded-full bg-[var(--accent-color)] px-4 py-2.5 text-sm font-semibold text-white hover:bg-[var(--accent-hover)] disabled:opacity-50"
                onClick={() => createWithInput()}
                disabled={!inputText.trim()}
              >
                创建并进入画布
              </button>
            </div>
          </section>

          <section className="w-full">
            <div className="flex items-center justify-between">
              <div className="text-sm font-semibold text-[var(--text-primary)]">我的项目</div>
              <button
                className="rounded-full border border-[var(--border-color)] bg-[var(--bg-tertiary)] px-3 py-2 text-sm font-semibold text-[var(--text-primary)] hover:bg-[var(--bg-secondary)]"
                onClick={openCreateDialog}
              >
                新建项目
              </button>
            </div>

            {projects.length === 0 ? (
              <div className="mt-4 rounded-[20px] border border-[var(--border-color)] bg-[var(--bg-secondary)] p-6 text-sm text-[var(--text-secondary)]">
                暂无项目，先创建一个吧。
              </div>
            ) : (
              <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {projects.map((p) => (
                  <div
                    key={p.id}
                    className="group relative min-h-[220px] overflow-hidden rounded-[20px] border border-[var(--border-color)] bg-[var(--bg-secondary)] p-4"
                  >
                    <button
                      className="block h-[120px] w-full overflow-hidden rounded-2xl bg-[var(--bg-tertiary)]"
                      onClick={() => nav(`/canvas/${p.id}`)}
                      title="打开项目"
                    >
                      {p.thumbnail ? <img src={p.thumbnail} alt={p.name} className="h-full w-full object-cover" /> : null}
                    </button>
                    <div className="mt-3 truncate text-sm font-semibold text-[var(--text-primary)]">{p.name}</div>
                    {p.description && (
                      <div className="mt-1 line-clamp-2 text-xs text-[var(--text-secondary)]">{p.description}</div>
                    )}
                    <div className="mt-1 text-xs text-[var(--text-tertiary)]">
                      {(p.updatedAt || p.createdAt) > 0 
                        ? new Date(p.updatedAt || p.createdAt).toLocaleString() 
                        : '未知时间'}
                    </div>

                    <div className="absolute right-3 top-3 z-10 flex gap-1 opacity-0 transition-opacity group-hover:opacity-100">
                      <button
                        className="rounded-full border border-[var(--border-color)] bg-[var(--bg-secondary)] px-3 py-1 text-xs font-semibold hover:bg-[var(--bg-tertiary)]"
                        onClick={(e) => { e.stopPropagation(); openRename(p.id, p.name) }}
                      >
                        重命名
                      </button>
                      <button
                        className="rounded-full border border-[var(--border-color)] bg-[var(--bg-secondary)] px-3 py-1 text-xs font-semibold hover:bg-[var(--bg-tertiary)]"
                        onClick={(e) => { e.stopPropagation(); openDesc(p.id, p.description || '') }}
                      >
                        备注
                      </button>
                      <button
                        className="rounded-full border border-[var(--border-color)] bg-[var(--bg-secondary)] px-3 py-1 text-xs font-semibold hover:bg-[var(--bg-tertiary)]"
                        onClick={async (e) => {
                          e.stopPropagation()
                          const id = await duplicateProject(p.id)
                          if (id) nav(`/canvas/${id}`)
                        }}
                      >
                        复制
                      </button>
                      <button
                        className="rounded-full border border-[var(--border-color)] bg-[var(--bg-secondary)] px-3 py-1 text-xs font-semibold text-[var(--danger-color)] hover:bg-[var(--bg-tertiary)]"
                        onClick={(e) => { e.stopPropagation(); openDeleteConfirm(p.id, p.name) }}
                      >
                        删除
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>
        </main>
      </div>

      {renameOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-md overflow-hidden rounded-2xl border border-[var(--border-color)] bg-[var(--bg-secondary)] shadow-xl">
            <div className="flex items-center justify-between border-b border-[var(--border-color)] px-5 py-4">
              <div className="font-semibold text-[var(--text-primary)]">重命名项目</div>
              <button
                className="text-sm text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
                onClick={() => {
                  setRenameOpen(false)
                  renameIdRef.current = null
                }}
              >
                关闭
              </button>
            </div>
            <div className="px-5 py-4">
              <Input value={renameValue} onChange={(e) => setRenameValue(e.target.value)} autoFocus />
            </div>
            <div className="flex items-center justify-end gap-2 border-t border-[var(--border-color)] px-5 py-4">
              <button
                className="rounded-full border border-[var(--border-color)] bg-[var(--bg-tertiary)] px-4 py-2 text-sm font-semibold hover:bg-[var(--bg-secondary)]"
                onClick={() => {
                  setRenameOpen(false)
                  renameIdRef.current = null
                }}
              >
                取消
              </button>
              <button
                className="rounded-full bg-[var(--accent-color)] px-4 py-2 text-sm font-semibold text-white hover:bg-[var(--accent-hover)]"
                onClick={() => confirmRename()}
              >
                确定
              </button>
            </div>
          </div>
        </div>
      )}

      {descOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-md overflow-hidden rounded-2xl border border-[var(--border-color)] bg-[var(--bg-secondary)] shadow-xl">
            <div className="flex items-center justify-between border-b border-[var(--border-color)] px-5 py-4">
              <div className="font-semibold text-[var(--text-primary)]">编辑项目备注</div>
              <button
                className="text-sm text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
                onClick={() => {
                  setDescOpen(false)
                  descIdRef.current = null
                }}
              >
                关闭
              </button>
            </div>
            <div className="px-5 py-4">
              <textarea
                value={descValue}
                onChange={(e) => setDescValue(e.target.value)}
                placeholder="添加项目备注..."
                className="h-24 w-full resize-none rounded-xl border border-[var(--border-color)] bg-[var(--bg-tertiary)] p-3 text-sm text-[var(--text-primary)] outline-none placeholder:text-[var(--text-secondary)] focus:border-[var(--accent-color)]"
                autoFocus
              />
            </div>
            <div className="flex items-center justify-end gap-2 border-t border-[var(--border-color)] px-5 py-4">
              <button
                className="rounded-full border border-[var(--border-color)] bg-[var(--bg-tertiary)] px-4 py-2 text-sm font-semibold hover:bg-[var(--bg-secondary)]"
                onClick={() => {
                  setDescOpen(false)
                  descIdRef.current = null
                }}
              >
                取消
              </button>
              <button
                className="rounded-full bg-[var(--accent-color)] px-4 py-2 text-sm font-semibold text-white hover:bg-[var(--accent-hover)]"
                onClick={() => confirmDesc()}
              >
                保存
              </button>
            </div>
          </div>
        </div>
      )}

      {deleteOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-md overflow-hidden rounded-2xl border border-[var(--border-color)] bg-[var(--bg-secondary)] shadow-xl">
            <div className="flex items-center justify-between border-b border-[var(--border-color)] px-5 py-4">
              <div className="font-semibold text-[var(--danger-color)]">删除项目</div>
              <button
                className="text-sm text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
                onClick={() => {
                  setDeleteOpen(false)
                  deleteIdRef.current = null
                }}
              >
                关闭
              </button>
            </div>
            <div className="px-5 py-4">
              <p className="text-sm text-[var(--text-primary)]">
                确定删除「<span className="font-semibold">{deleteNameRef.current}</span>」？此操作不可恢复。
              </p>
            </div>
            <div className="flex items-center justify-end gap-2 border-t border-[var(--border-color)] px-5 py-4">
              <button
                className="rounded-full border border-[var(--border-color)] bg-[var(--bg-tertiary)] px-4 py-2 text-sm font-semibold hover:bg-[var(--bg-secondary)]"
                onClick={() => {
                  setDeleteOpen(false)
                  deleteIdRef.current = null
                }}
              >
                取消
              </button>
              <button
                className="rounded-full bg-[var(--danger-color)] px-4 py-2 text-sm font-semibold text-white hover:opacity-90"
                onClick={() => confirmDelete()}
              >
                删除
              </button>
            </div>
          </div>
        </div>
      )}

      {createOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-md overflow-hidden rounded-2xl border border-[var(--border-color)] bg-[var(--bg-secondary)] shadow-xl">
            <div className="flex items-center justify-between border-b border-[var(--border-color)] px-5 py-4">
              <div className="font-semibold text-[var(--text-primary)]">新建项目</div>
              <button
                className="text-sm text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
                onClick={() => setCreateOpen(false)}
              >
                关闭
              </button>
            </div>
            <div className="px-5 py-4">
              <label className="mb-2 block text-sm text-[var(--text-secondary)]">项目名称</label>
              <Input
                value={createName}
                onChange={(e) => setCreateName(e.target.value)}
                placeholder="输入项目名称..."
                autoFocus
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault()
                    confirmCreate()
                  }
                }}
              />
            </div>
            <div className="flex items-center justify-end gap-2 border-t border-[var(--border-color)] px-5 py-4">
              <button
                className="rounded-full border border-[var(--border-color)] bg-[var(--bg-tertiary)] px-4 py-2 text-sm font-semibold hover:bg-[var(--bg-secondary)]"
                onClick={() => setCreateOpen(false)}
              >
                取消
              </button>
              <button
                className="rounded-full bg-[var(--accent-color)] px-4 py-2 text-sm font-semibold text-white hover:bg-[var(--accent-hover)]"
                onClick={confirmCreate}
              >
                创建
              </button>
            </div>
          </div>
        </div>
      )}

      <SettingsDialog open={settingsOpen} onClose={() => setSettingsOpen(false)} />
      <div className="fixed bottom-3 right-4 text-[11px] text-[var(--text-secondary)] opacity-40 select-none">v1.58.8</div>
    </div>
  )
}

