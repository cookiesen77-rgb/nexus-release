/**
 * Prompt Library Modal | 提示词库弹窗
 * - 视频：运镜词库（来自 CHOS 运镜 Prompt 词库）
 * - Nano：Nano Banana Pro 提示词（来自 GitHub）
 * - 漫画：分析/分镜/角色模板（来自 baoyu-comic）
 * - 生图：三段式结构提示词拼装
 */

import React, { useState, useMemo } from 'react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { X, Search } from 'lucide-react'

// Import prompt library data
import cameraMoves from '@/assets/prompt-libraries/chos_camera_moves.json'
import nanoBananaPrompts from '@/assets/prompt-libraries/nano_banana_pro_prompts.json'
import comicPrompts from '@/assets/prompt-libraries/baoyu_comic_prompts.json'

interface CameraMove {
  id: string | number
  en: string
  zh: string
  category: string
  scene: string
  desc?: string
}

interface NanoPrompt {
  no: number
  title: string
  description?: string
  prompt: string
  language?: string
  featured?: boolean
  tags?: string[]
}

interface ComicPrompt {
  no: number
  title: string
  description?: string
  prompt: string
  language?: string
  tags?: string[]
}

interface Props {
  open: boolean
  onClose: () => void
  onInsert: (text: string) => void
}

type TabId = 'video' | 'nano' | 'comic' | 'image'

const moodOptions = [
  { label: 'Gentle（轻柔）', value: 'Gentle' },
  { label: 'Slow（缓慢）', value: 'Slow' },
  { label: 'Fast（快速）', value: 'Fast' },
  { label: 'Aggressive（激进）', value: 'Aggressive' },
  { label: 'Smooth（平滑）', value: 'Smooth' },
  { label: 'Sudden（突然）', value: 'Sudden' },
  { label: 'Dramatic（戏剧化）', value: 'Dramatic' }
]

export default function PromptLibraryModal({ open, onClose, onInsert }: Props) {
  const [activeTab, setActiveTab] = useState<TabId>('video')
  
  // Video camera moves
  const [videoQuery, setVideoQuery] = useState('')
  const [moodAdjective, setMoodAdjective] = useState<string | null>(null)
  
  // Nano prompts
  const [nanoQuery, setNanoQuery] = useState('')
  
  // Comic prompts
  const [comicQuery, setComicQuery] = useState('')
  
  // Image prompt builder
  const [subject, setSubject] = useState('')
  const [lighting, setLighting] = useState('')
  const [atmosphere, setAtmosphere] = useState('')
  const [details, setDetails] = useState('')

  // Filtered camera moves
  const filteredCameraMoves = useMemo(() => {
    const q = (videoQuery || '').trim().toLowerCase()
    if (!q) return cameraMoves as CameraMove[]
    return (cameraMoves as CameraMove[]).filter((item) => {
      const hay = `${item.en} ${item.zh} ${item.category} ${item.scene} ${item.desc || ''}`.toLowerCase()
      return hay.includes(q)
    })
  }, [videoQuery])

  // Filtered nano prompts
  const filteredNanoPrompts = useMemo(() => {
    const q = (nanoQuery || '').trim().toLowerCase()
    if (!q) return nanoBananaPrompts as NanoPrompt[]
    return (nanoBananaPrompts as NanoPrompt[]).filter((item) => {
      const hay = `${item.no} ${item.title} ${item.description || ''} ${item.prompt} ${item.language || ''} ${(item.tags || []).join(' ')}`.toLowerCase()
      return hay.includes(q)
    })
  }, [nanoQuery])

  // Filtered comic prompts
  const filteredComicPrompts = useMemo(() => {
    const q = (comicQuery || '').trim().toLowerCase()
    if (!q) return comicPrompts as ComicPrompt[]
    return (comicPrompts as ComicPrompt[]).filter((item) => {
      const hay = `${item.no} ${item.title} ${item.description || ''} ${item.prompt} ${item.language || ''} ${(item.tags || []).join(' ')}`.toLowerCase()
      return hay.includes(q)
    })
  }, [comicQuery])

  // Built image prompt
  const builtImagePrompt = useMemo(() => {
    const parts = [subject, lighting, atmosphere, details]
      .map((s) => (s || '').trim())
      .filter(Boolean)
    return parts.join(', ')
  }, [subject, lighting, atmosphere, details])

  const buildCameraSnippet = (item: CameraMove) => {
    const mood = moodAdjective ? `${moodAdjective} ` : ''
    return `(Camera Movement: ${mood}${item.en}, ${item.zh})`
  }

  const handleInsert = (text: string) => {
    const value = (text || '').trim()
    if (!value) return
    onInsert(value)
    onClose()
  }

  if (!open) return null

  const tabs: Array<{ id: TabId; label: string }> = [
    { id: 'video', label: '视频运镜' },
    { id: 'nano', label: 'Nano Banana Pro' },
    { id: 'comic', label: '漫画' },
    { id: 'image', label: '生图结构' }
  ]

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div
        className="flex h-[min(80vh,700px)] w-[760px] max-w-[95vw] flex-col overflow-hidden rounded-2xl border border-[var(--border-color)] bg-[var(--bg-secondary)] shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-[var(--border-color)] px-5 py-4">
          <h2 className="text-lg font-semibold text-[var(--text-primary)]">提示词库</h2>
          <button
            onClick={onClose}
            className="rounded-full p-1 text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-primary)] hover:text-[var(--text-primary)]"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Tabs */}
        <div className="flex gap-1 border-b border-[var(--border-color)] px-4">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={cn(
                'relative px-4 py-3 text-sm font-medium transition-colors',
                activeTab === tab.id
                  ? 'text-[var(--accent-color)]'
                  : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
              )}
            >
              {tab.label}
              {activeTab === tab.id && (
                <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-[var(--accent-color)]" />
              )}
            </button>
          ))}
        </div>

        {/* Content */}
        <div className="flex-1 overflow-auto p-5">
          {/* Video Camera Moves Tab */}
          {activeTab === 'video' && (
            <div className="space-y-3">
              <div className="flex flex-wrap items-center gap-2">
                <div className="relative min-w-[260px] flex-1">
                  <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--text-secondary)]" />
                  <input
                    type="text"
                    value={videoQuery}
                    onChange={(e) => setVideoQuery(e.target.value)}
                    placeholder="搜索：英文/中文/类型/场景/描述"
                    className="w-full rounded-lg border border-[var(--border-color)] bg-[var(--bg-primary)] py-2 pl-9 pr-3 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-secondary)] focus:border-[var(--accent-color)] focus:outline-none"
                  />
                </div>
                <select
                  value={moodAdjective || ''}
                  onChange={(e) => setMoodAdjective(e.target.value || null)}
                  className="w-[200px] rounded-lg border border-[var(--border-color)] bg-[var(--bg-primary)] px-3 py-2 text-sm text-[var(--text-primary)] focus:border-[var(--accent-color)] focus:outline-none"
                >
                  <option value="">情绪修饰（可选）</option>
                  {moodOptions.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              </div>

              <div className="max-h-[420px] overflow-auto rounded-lg border border-[var(--border-color)]">
                {filteredCameraMoves.map((item) => (
                  <div
                    key={item.id}
                    className="flex items-start justify-between gap-3 border-b border-[var(--border-color)] p-3 last:border-b-0 hover:bg-[var(--bg-tertiary)]/40"
                  >
                    <div className="min-w-0">
                      <div className="truncate text-sm font-medium text-[var(--text-primary)]">
                        {item.zh}
                        <span className="ml-1 text-xs text-[var(--text-secondary)]">（{item.en}）</span>
                      </div>
                      <div className="mt-1 text-xs text-[var(--text-secondary)]">
                        {item.category} · {item.scene}
                      </div>
                      {item.desc && (
                        <div className="mt-1 line-clamp-2 text-xs text-[var(--text-secondary)]">{item.desc}</div>
                      )}
                    </div>
                    <Button size="sm" className="shrink-0" onClick={() => handleInsert(buildCameraSnippet(item))}>
                      插入
                    </Button>
                  </div>
                ))}
              </div>

              <div className="text-xs leading-5 text-[var(--text-secondary)]">
                <div>推荐用法（来自资料）：</div>
                <div>主体/场景 + (Camera Movement: 情绪修饰 + 运镜) + 其它画面要素</div>
              </div>
            </div>
          )}

          {/* Nano Banana Pro Tab */}
          {activeTab === 'nano' && (
            <div className="space-y-3">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--text-secondary)]" />
                <input
                  type="text"
                  value={nanoQuery}
                  onChange={(e) => setNanoQuery(e.target.value)}
                  placeholder="搜索：标题/描述/Prompt/语言"
                  className="w-full rounded-lg border border-[var(--border-color)] bg-[var(--bg-primary)] py-2 pl-9 pr-3 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-secondary)] focus:border-[var(--accent-color)] focus:outline-none"
                />
              </div>

              <div className="max-h-[420px] overflow-auto rounded-lg border border-[var(--border-color)]">
                {filteredNanoPrompts.map((item) => (
                  <div
                    key={item.no}
                    className="flex items-start justify-between gap-3 border-b border-[var(--border-color)] p-3 last:border-b-0 hover:bg-[var(--bg-tertiary)]/40"
                  >
                    <div className="min-w-0">
                      <div className="truncate text-sm font-medium text-[var(--text-primary)]">{item.title}</div>
                      <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-[var(--text-secondary)]">
                        <span className="rounded-full border border-[var(--border-color)] bg-[var(--bg-secondary)] px-2 py-0.5">
                          {item.language || 'EN'}
                        </span>
                        {item.featured && (
                          <span className="rounded-full border border-[var(--border-color)] bg-[var(--bg-secondary)] px-2 py-0.5">
                            Featured
                          </span>
                        )}
                        {item.no && <span className="text-[var(--text-tertiary)]">No. {item.no}</span>}
                      </div>
                      {item.description && (
                        <div className="mt-2 line-clamp-2 text-xs text-[var(--text-secondary)]">{item.description}</div>
                      )}
                      <div className="mt-2 line-clamp-1 text-xs text-[var(--text-tertiary)]">
                        来源：awesome-nano-banana-pro-prompts（GitHub README）
                      </div>
                    </div>
                    <Button size="sm" className="shrink-0" onClick={() => handleInsert(item.prompt)}>
                      插入
                    </Button>
                  </div>
                ))}
              </div>

              <div className="text-xs leading-5 text-[var(--text-secondary)]">
                <div>说明：</div>
                <div>- 词库来源于社区整理，建议再结合你的角色/画风设定节点一起使用。</div>
              </div>
            </div>
          )}

          {/* Comic Tab */}
          {activeTab === 'comic' && (
            <div className="space-y-3">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--text-secondary)]" />
                <input
                  type="text"
                  value={comicQuery}
                  onChange={(e) => setComicQuery(e.target.value)}
                  placeholder="搜索：标题/描述/Prompt"
                  className="w-full rounded-lg border border-[var(--border-color)] bg-[var(--bg-primary)] py-2 pl-9 pr-3 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-secondary)] focus:border-[var(--accent-color)] focus:outline-none"
                />
              </div>

              <div className="max-h-[420px] overflow-auto rounded-lg border border-[var(--border-color)]">
                {filteredComicPrompts.map((item) => (
                  <div
                    key={item.no}
                    className="flex items-start justify-between gap-3 border-b border-[var(--border-color)] p-3 last:border-b-0 hover:bg-[var(--bg-tertiary)]/40"
                  >
                    <div className="min-w-0">
                      <div className="truncate text-sm font-medium text-[var(--text-primary)]">{item.title}</div>
                      <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-[var(--text-secondary)]">
                        <span className="rounded-full border border-[var(--border-color)] bg-[var(--bg-secondary)] px-2 py-0.5">
                          {item.language || 'ZH'}
                        </span>
                        {item.no && <span className="text-[var(--text-tertiary)]">No. {item.no}</span>}
                      </div>
                      {item.description && (
                        <div className="mt-2 line-clamp-2 text-xs text-[var(--text-secondary)]">{item.description}</div>
                      )}
                      <div className="mt-2 line-clamp-1 text-xs text-[var(--text-tertiary)]">
                        来源：baoyu-comic 工作流模板
                      </div>
                    </div>
                    <Button size="sm" className="shrink-0" onClick={() => handleInsert(item.prompt)}>
                      插入
                    </Button>
                  </div>
                ))}
              </div>

              <div className="text-xs leading-5 text-[var(--text-secondary)]">
                <div>说明：</div>
                <div>- 用于「分析/分镜/角色设定」三步提示词模板。</div>
              </div>
            </div>
          )}

          {/* Image Prompt Builder Tab */}
          {activeTab === 'image' && (
            <div className="space-y-4">
              <div className="mb-3 text-xs text-[var(--text-secondary)]">
                三段式结构：<span className="font-medium">主体词</span> →{' '}
                <span className="font-medium">光影词</span> → <span className="font-medium">抽象/氛围词</span>
              </div>

              <div className="space-y-2">
                <input
                  type="text"
                  value={subject}
                  onChange={(e) => setSubject(e.target.value)}
                  placeholder="主体词（人物/物体/场景）"
                  className="w-full rounded-lg border border-[var(--border-color)] bg-[var(--bg-primary)] px-3 py-2 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-secondary)] focus:border-[var(--accent-color)] focus:outline-none"
                />
                <input
                  type="text"
                  value={lighting}
                  onChange={(e) => setLighting(e.target.value)}
                  placeholder="光影词（柔和的光线/逆光/电影灯光等）"
                  className="w-full rounded-lg border border-[var(--border-color)] bg-[var(--bg-primary)] px-3 py-2 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-secondary)] focus:border-[var(--accent-color)] focus:outline-none"
                />
                <input
                  type="text"
                  value={atmosphere}
                  onChange={(e) => setAtmosphere(e.target.value)}
                  placeholder="抽象/氛围词（梦幻感/高级感/电影感等）"
                  className="w-full rounded-lg border border-[var(--border-color)] bg-[var(--bg-primary)] px-3 py-2 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-secondary)] focus:border-[var(--accent-color)] focus:outline-none"
                />
                <input
                  type="text"
                  value={details}
                  onChange={(e) => setDetails(e.target.value)}
                  placeholder="补充细节（可选：风格/材质/构图/镜头等）"
                  className="w-full rounded-lg border border-[var(--border-color)] bg-[var(--bg-primary)] px-3 py-2 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-secondary)] focus:border-[var(--accent-color)] focus:outline-none"
                />
              </div>

              <div className="rounded-lg border border-[var(--border-color)] bg-[var(--bg-secondary)] p-3">
                <div className="mb-1 text-xs text-[var(--text-secondary)]">预览</div>
                <div className="whitespace-pre-wrap break-words text-sm text-[var(--text-primary)]">
                  {builtImagePrompt || '（填写上方内容后生成预览）'}
                </div>
              </div>

              <div className="flex justify-end">
                <Button onClick={() => handleInsert(builtImagePrompt)} disabled={!builtImagePrompt}>
                  插入到输入框
                </Button>
              </div>
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
