import React, { useState, useMemo, useRef, useCallback, useEffect } from 'react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import {
  X, Search, Sparkles, Loader2, ImageIcon, ScanSearch, FileJson,
  Undo2, Redo2, ImagePlus, Wand2, ChevronUp, ChevronDown,
  Plus, Minus, Copy, ArrowRight, Palette, BookOpen, Clapperboard,
  Store, ImageUp, Upload, Layers, History, FolderOpen
} from 'lucide-react'
import { useGraphStore } from '@/graph/store'
import { useSettingsStore } from '@/store/settings'
import { useAssetsStore } from '@/store/assets'
import { callAiAssistant, chatCompletions } from '@/lib/nexusApi'
import { generateImageFromConfigNode } from '@/lib/workflow/image'

import cameraMoves from '@/assets/prompt-libraries/chos_camera_moves.json'
import nanoBananaPrompts from '@/assets/prompt-libraries/nano_banana_pro_prompts.json'
import comicPrompts from '@/assets/prompt-libraries/baoyu_comic_prompts.json'
import templateMeta from '@/assets/prompt-libraries/nano_banana_pro_meta.json'

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

interface OfficialTemplate {
  no: string
  title: string
  description?: string
  prompt: string
  tags?: string[]
  ratio?: string
  minRefs?: number
  preview?: string
  channels?: string[]
  materials?: string[]
  industries?: string[]
  source?: { name?: string; url?: string }
}

interface RefImage {
  id: string
  src: string
  name: string
  reversing?: boolean
}

interface Props {
  open: boolean
  onClose: () => void
}

type TabId = 'generate' | 'market' | 'templates' | 'camera' | 'comic'

const MODEL_KEY = 'gemini-3-pro-image-preview'
const ASPECT_RATIOS = ['1:1', '2:3', '3:2', '3:4', '4:3', '4:5', '5:4', '9:16', '16:9', '21:9'] as const
const QUALITIES = ['1K', '2K', '4K'] as const

const moodOptions = [
  { label: 'Gentle（轻柔）', value: 'Gentle' },
  { label: 'Slow（缓慢）', value: 'Slow' },
  { label: 'Fast（快速）', value: 'Fast' },
  { label: 'Aggressive（激进）', value: 'Aggressive' },
  { label: 'Smooth（平滑）', value: 'Smooth' },
  { label: 'Sudden（突然）', value: 'Sudden' },
  { label: 'Dramatic（戏剧化）', value: 'Dramatic' }
]

const OPTIMIZE_SYSTEM_PROMPT = `You are an expert prompt engineer for AI image generation (Gemini). Your task:
- Take the user's description and expand it into a detailed, vivid English prompt
- Include: subject, composition, lighting, mood, art style, camera angle, color palette, details
- Output ONLY the enhanced prompt text, no explanations
- Keep the original intent while adding professional photography/art direction terminology
- If the input is in Chinese, translate and enhance into English`

const REVERSE_SYSTEM_PROMPT = `你是一位图像分析专家。请详细描述这张图片的内容，包括：
- 主体：人物/物体/场景
- 构图：视角、景别、画面布局
- 光影：光源方向、明暗对比
- 色彩：主色调、色彩搭配
- 风格：艺术风格、氛围
- 细节：材质、纹理、背景元素
输出格式：用英文写成适合AI图片生成的提示词，一段连贯文本，不要分条列举。`

let _refIdCounter = 0

export default function NanaBananaProModal({ open, onClose }: Props) {
  const [activeTab, setActiveTab] = useState<TabId>('generate')
  const [mounted, setMounted] = useState(false)

  // Generation state
  const [prompt, setPrompt] = useState('')
  const [refImages, setRefImages] = useState<RefImage[]>([])
  const [refExpanded, setRefExpanded] = useState(true)
  const [aspectRatio, setAspectRatio] = useState<string>('3:4')
  const [quality, setQuality] = useState<string>('2K')
  const [count, setCount] = useState(1)
  const [generating, setGenerating] = useState(false)
  const [optimizing, setOptimizing] = useState(false)
  const [optimizeMode, setOptimizeMode] = useState<'normal' | 'json' | null>(null)
  const [progress, setProgress] = useState({ done: 0, total: 0 })
  const [isDraggingOver, setIsDraggingOver] = useState(false)

  // Prompt undo/redo
  const [promptHistory, setPromptHistory] = useState<string[]>([''])
  const [promptIndex, setPromptIndex] = useState(0)
  const skipRecordRef = useRef(false)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const canUndo = promptIndex > 0
  const canRedo = promptIndex < promptHistory.length - 1

  // Search state
  const [templateQuery, setTemplateQuery] = useState('')
  const [cameraQuery, setCameraQuery] = useState('')
  const [moodAdjective, setMoodAdjective] = useState<string | null>(null)
  const [comicQuery, setComicQuery] = useState('')

  // Market state
  const [marketQuery, setMarketQuery] = useState('')
  const [marketChannel, setMarketChannel] = useState('全部')
  const [marketMaterial, setMarketMaterial] = useState('全部')
  const [marketRatio, setMarketRatio] = useState('全部')
  const [officialTemplates, setOfficialTemplates] = useState<OfficialTemplate[]>([])
  const officialLoaded = useRef(false)

  // Lazy load official templates on first market tab visit
  useEffect(() => {
    if (activeTab === 'market' && !officialLoaded.current) {
      officialLoaded.current = true
      import('@/assets/prompt-libraries/nano_banana_pro_official.json').then((mod) => {
        setOfficialTemplates(mod.default as OfficialTemplate[])
      })
    }
  }, [activeTab])

  const fileInputRef = useRef<HTMLInputElement>(null)
  const pickerFileInputRef = useRef<HTMLInputElement>(null)

  // Image source picker
  type PickerTab = 'local' | 'canvas' | 'history'
  const [showPicker, setShowPicker] = useState(false)
  const [pickerTab, setPickerTab] = useState<PickerTab>('local')

  const canvasImages = useMemo(() => {
    if (!showPicker) return []
    return useGraphStore.getState().nodes
      .filter(n => n.type === 'image' && (n.data as any)?.url)
      .map(n => ({ id: n.id, src: (n.data as any).url as string, title: (n.data as any)?.label || (n.data as any)?.fileName || '画布图片' }))
  }, [showPicker])

  const historyImages = useMemo(() => {
    if (!showPicker) return []
    return useAssetsStore.getState().getAssetsByType('image').slice(0, 60)
  }, [showPicker])

  // Slide-in animation
  useEffect(() => {
    if (open) {
      const timer = setTimeout(() => setMounted(true), 10)
      return () => clearTimeout(timer)
    }
    setMounted(false)
  }, [open])

  // Escape to close
  useEffect(() => {
    if (!open) return
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !generating) onClose()
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [open, generating, onClose])

  // Prompt record/undo/redo
  const recordPrompt = useCallback((value: string) => {
    setPromptHistory((prev) => {
      const next = prev.slice(0, promptIndex + 1)
      next.push(value)
      if (next.length > 50) next.shift()
      return next
    })
    setPromptIndex((prev) => Math.min(prev + 1, 50))
  }, [promptIndex])

  const handlePromptChange = useCallback((value: string) => {
    setPrompt(value)
    if (skipRecordRef.current) {
      skipRecordRef.current = false
      return
    }
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => recordPrompt(value), 600)
  }, [recordPrompt])

  const handleUndo = useCallback(() => {
    if (!canUndo) return
    skipRecordRef.current = true
    setPromptIndex((i) => i - 1)
    setPrompt(promptHistory[promptIndex - 1])
  }, [canUndo, promptHistory, promptIndex])

  const handleRedo = useCallback(() => {
    if (!canRedo) return
    skipRecordRef.current = true
    setPromptIndex((i) => i + 1)
    setPrompt(promptHistory[promptIndex + 1])
  }, [canRedo, promptHistory, promptIndex])

  // Filtered lists
  const filteredTemplates = useMemo(() => {
    const q = (templateQuery || '').trim().toLowerCase()
    if (!q) return nanoBananaPrompts as NanoPrompt[]
    return (nanoBananaPrompts as NanoPrompt[]).filter((item) =>
      `${item.no} ${item.title} ${item.description || ''} ${item.prompt} ${item.language || ''} ${(item.tags || []).join(' ')}`.toLowerCase().includes(q)
    )
  }, [templateQuery])

  const filteredCameraMoves = useMemo(() => {
    const q = (cameraQuery || '').trim().toLowerCase()
    if (!q) return cameraMoves as CameraMove[]
    return (cameraMoves as CameraMove[]).filter((item) =>
      `${item.en} ${item.zh} ${item.category} ${item.scene} ${item.desc || ''}`.toLowerCase().includes(q)
    )
  }, [cameraQuery])

  const groupedCameraMoves = useMemo(() => {
    const groups: Record<string, CameraMove[]> = {}
    for (const m of filteredCameraMoves) {
      const cat = m.category || '其他'
      ;(groups[cat] ??= []).push(m)
    }
    return groups
  }, [filteredCameraMoves])

  const filteredComicPrompts = useMemo(() => {
    const q = (comicQuery || '').trim().toLowerCase()
    if (!q) return comicPrompts as ComicPrompt[]
    return (comicPrompts as ComicPrompt[]).filter((item) =>
      `${item.no} ${item.title} ${item.description || ''} ${item.prompt} ${item.language || ''} ${(item.tags || []).join(' ')}`.toLowerCase().includes(q)
    )
  }, [comicQuery])

  const filteredMarketTemplates = useMemo(() => {
    let list = officialTemplates
    if (marketChannel !== '全部') {
      list = list.filter((t) => t.channels?.includes(marketChannel))
    }
    if (marketMaterial !== '全部') {
      list = list.filter((t) => t.materials?.includes(marketMaterial))
    }
    if (marketRatio !== '全部') {
      list = list.filter((t) => t.ratio === marketRatio)
    }
    const q = (marketQuery || '').trim().toLowerCase()
    if (q) {
      list = list.filter((t) =>
        `${t.no} ${t.title} ${t.description || ''} ${(t.tags || []).join(' ')}`.toLowerCase().includes(q)
      )
    }
    return list
  }, [marketQuery, marketChannel, marketMaterial, marketRatio, officialTemplates])

  // Image compression
  const compressImage = useCallback(async (file: File, maxSizeMB = 1): Promise<File> => {
    if (file.size / 1024 / 1024 <= maxSizeMB) return file
    return new Promise((resolve) => {
      const img = new Image()
      const url = URL.createObjectURL(file)
      img.onload = () => {
        URL.revokeObjectURL(url)
        const maxDim = 2048
        let w = img.width, h = img.height
        if (w > maxDim || h > maxDim) {
          const scale = maxDim / Math.max(w, h)
          w = Math.round(w * scale)
          h = Math.round(h * scale)
        }
        const canvas = document.createElement('canvas')
        canvas.width = w
        canvas.height = h
        canvas.getContext('2d')!.drawImage(img, 0, 0, w, h)
        canvas.toBlob((blob) => resolve(blob ? new File([blob], file.name, { type: 'image/jpeg' }) : file), 'image/jpeg', 0.85)
      }
      img.onerror = () => { URL.revokeObjectURL(url); resolve(file) }
      img.src = url
    })
  }, [])

  const addFiles = useCallback(async (files: FileList | File[]) => {
    const remaining = 14 - refImages.length
    if (remaining <= 0) {
      window.$message?.warning?.('最多 14 张参考图')
      return
    }
    const toAdd = Array.from(files).filter((f) => f.type.startsWith('image/')).slice(0, remaining)
    const newRefs: RefImage[] = []
    for (const f of toAdd) {
      const compressed = await compressImage(f)
      newRefs.push({ id: `ref-${++_refIdCounter}`, src: URL.createObjectURL(compressed), name: f.name })
    }
    if (newRefs.length > 0) {
      setRefImages((prev) => [...prev, ...newRefs])
      window.$message?.success?.(`已添加 ${newRefs.length} 张参考图`)
    }
  }, [refImages.length, compressImage])

  const addImageFromSrc = useCallback(async (src: string, closePicker = false) => {
    if (refImages.length >= 14) return
    const blob = await (await fetch(src)).blob()
    const file = new File([blob], 'ref.jpg', { type: blob.type || 'image/jpeg' })
    await addFiles([file])
    if (closePicker) setShowPicker(false)
  }, [refImages.length, addFiles])

  const removeRef = useCallback((id: string) => {
    setRefImages((prev) => {
      const img = prev.find((r) => r.id === id)
      if (img?.src.startsWith('blob:')) URL.revokeObjectURL(img.src)
      return prev.filter((r) => r.id !== id)
    })
  }, [])

  const toBase64 = async (src: string): Promise<string> => {
    if (src.startsWith('data:')) return src
    const blob = await (await fetch(src)).blob()
    return new Promise((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = () => resolve(reader.result as string)
      reader.onerror = reject
      reader.readAsDataURL(blob)
    })
  }

  // AI optimize
  const handleOptimize = async (mode: 'normal' | 'json' = 'normal') => {
    if (!prompt.trim() || optimizing) return
    setOptimizing(true)
    setOptimizeMode(mode)
    recordPrompt(prompt)
    try {
      const model = useSettingsStore.getState().aiAssistantModel || 'gemini-3.1-pro-preview'
      const systemPrompt = mode === 'json'
        ? OPTIMIZE_SYSTEM_PROMPT + '\nOutput the enhanced prompt as a JSON object with a "prompt" field.'
        : OPTIMIZE_SYSTEM_PROMPT
      let result = await callAiAssistant(model, [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: prompt }
      ], { filterThinking: true })
      if (result) {
        if (mode === 'json') {
          const fence = result.match(/```(?:json)?\s*([\s\S]*?)```/i)
          const candidate = fence ? fence[1].trim() : result.trim()
          try { result = JSON.stringify(JSON.parse(candidate), null, 2) } catch {}
        }
        skipRecordRef.current = true
        recordPrompt(result)
        setPrompt(result)
      }
      window.$message?.success?.('提示词优化完成')
    } catch (err: unknown) {
      window.$message?.error?.((err as Error)?.message || '优化失败')
    } finally {
      setOptimizing(false)
      setOptimizeMode(null)
    }
  }

  // Reverse prompt from image
  const handleReverse = async (refId: string) => {
    const ref = refImages.find((r) => r.id === refId)
    if (!ref || ref.reversing) return

    setRefImages((prev) => prev.map((r) => r.id === refId ? { ...r, reversing: true } : r))
    try {
      const model = useSettingsStore.getState().aiAssistantModel || 'gemini-3.1-pro-preview'
      const base64 = await toBase64(ref.src)
      const result = await chatCompletions({
        model,
        messages: [{
          role: 'user',
          content: [
            { type: 'text', text: REVERSE_SYSTEM_PROMPT },
            { type: 'image_url', image_url: { url: base64 } }
          ] as any
        }]
      })
      if (result) {
        setPrompt((prev) => prev ? `${prev}\n\n${result}` : result)
        window.$message?.success?.('图片反推完成')
      }
    } catch (err: unknown) {
      window.$message?.error?.((err as Error)?.message || '反推失败')
    } finally {
      setRefImages((prev) => prev.map((r) => r.id === refId ? { ...r, reversing: false } : r))
    }
  }

  // Generate
  const handleGenerate = async () => {
    if (generating) return
    if (!prompt.trim() && refImages.length === 0) {
      window.$message?.warning?.('请输入提示词或添加参考图')
      return
    }

    setGenerating(true)
    setProgress({ done: 0, total: count })

    try {
      const store = useGraphStore.getState()
      const vp = store.viewport
      const cx = (-vp.x + window.innerWidth / 2) / vp.zoom
      const cy = (-vp.y + window.innerHeight / 2) / vp.zoom

      const refBase64: string[] = []
      for (const ref of refImages) refBase64.push(await toBase64(ref.src))

      for (let i = 0; i < count; i++) {
        const col = i % 3
        const row = Math.floor(i / 3)
        const x = cx + col * 320 - (Math.min(count, 3) - 1) * 160
        const y = cy + row * 320 - 100

        const configId = store.addNode('imageConfig', { x: -9999, y: -9999 }, {
          model: MODEL_KEY,
          size: aspectRatio,
          quality
        })

        if (prompt.trim()) {
          const textId = store.addNode('text', { x: -9999, y: -9999 - 100 }, { content: prompt })
          store.addEdge(textId, configId, { sourceHandle: 'right', targetHandle: 'left' })
        }

        for (let j = 0; j < refBase64.length; j++) {
          const imgId = store.addNode('image', { x: -9999, y: -9999 + (j + 1) * 100 }, { url: refBase64[j] })
          store.addEdge(imgId, configId, { sourceHandle: 'right', targetHandle: 'left' })
        }

        const outputId = store.addNode('image', { x, y }, {
          url: '',
          loading: true,
          label: 'Banana Pro 生成中...'
        })

        try {
          await generateImageFromConfigNode(configId, { model: MODEL_KEY, size: aspectRatio, quality }, {
            outputNodeId: outputId,
            selectOutput: i === 0,
            markConfigExecuted: false
          })
        } catch (err: unknown) {
          useGraphStore.getState().updateNode(outputId, {
            data: { loading: false, error: (err as Error)?.message || '生成失败' }
          } as any)
        }

        const currentStore = useGraphStore.getState()
        currentStore.nodes
          .filter((n) => n.x === -9999 && n.y <= -9999 + 2000 && n.id !== outputId)
          .forEach((n) => currentStore.removeNode(n.id))

        setProgress((prev) => ({ ...prev, done: prev.done + 1 }))
      }

      window.$message?.success?.(`${count} 张图片生成完成`)
    } catch (err: unknown) {
      window.$message?.error?.((err as Error)?.message || '生成失败')
    } finally {
      setGenerating(false)
    }
  }

  const applyTemplate = (tmpl: NanoPrompt) => {
    setPrompt(tmpl.prompt)
    setActiveTab('generate')
    window.$message?.success?.('模板已应用')
  }

  const applyMarketTemplate = (tmpl: OfficialTemplate) => {
    setPrompt(tmpl.prompt)
    if (tmpl.ratio && ASPECT_RATIOS.includes(tmpl.ratio as typeof ASPECT_RATIOS[number])) {
      setAspectRatio(tmpl.ratio)
    }
    setActiveTab('generate')
    window.$message?.success?.(`「${tmpl.title}」已应用${tmpl.minRefs ? `，需要 ${tmpl.minRefs}+ 张参考图` : ''}`)
  }

  const buildCameraSnippet = (item: CameraMove) => {
    const mood = moodAdjective ? `${moodAdjective} ` : ''
    return `(Camera Movement: ${mood}${item.en}, ${item.zh})`
  }

  const copyText = (text: string) => {
    navigator.clipboard.writeText((text || '').trim())
    window.$message?.success?.('已复制到剪贴板')
  }

  const handlePaste = useCallback((e: React.ClipboardEvent) => {
    const items = e.clipboardData?.items
    if (!items) return
    const files: File[] = []
    for (const item of Array.from(items)) {
      if (item.type.startsWith('image/')) {
        const f = item.getAsFile()
        if (f) files.push(f)
      }
    }
    if (files.length) addFiles(files)
  }, [addFiles])

  if (!open) return null

  const tabs: Array<{ id: TabId; label: string; icon: React.ElementType }> = [
    { id: 'generate', label: '生成', icon: Palette },
    { id: 'market', label: '市场', icon: Store },
    { id: 'templates', label: '社区', icon: Sparkles },
    { id: 'camera', label: '运镜', icon: Clapperboard },
    { id: 'comic', label: '漫画', icon: BookOpen }
  ]

  return (
    <div className="fixed inset-0 z-50 flex justify-end" onPaste={handlePaste}>
      {/* Backdrop */}
      <div
        className={cn(
          'absolute inset-0 transition-opacity duration-300',
          mounted ? 'bg-black/25' : 'bg-transparent'
        )}
        onClick={!generating ? onClose : undefined}
      />

      {/* Panel */}
      <div
        className={cn(
          'relative flex h-full w-[440px] max-w-[95vw] flex-col border-l border-[var(--border-color)] bg-[var(--bg-secondary)] shadow-2xl transition-transform duration-300 ease-out',
          mounted ? 'translate-x-0' : 'translate-x-full'
        )}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3.5">
          <div className="flex items-center gap-2.5">
            <span className="text-lg leading-none">🍌</span>
            <h2 className="text-base font-semibold text-[var(--text-primary)]">Nano Banana Pro</h2>
          </div>
          <button
            onClick={onClose}
            disabled={generating}
            className="rounded-lg p-1.5 text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-tertiary)] hover:text-[var(--text-primary)] disabled:opacity-30"
          >
            <X className="h-4.5 w-4.5" />
          </button>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-[var(--border-color)] px-3">
          {tabs.map((tab) => {
            const Icon = tab.icon
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={cn(
                  'relative flex items-center gap-1.5 px-3 py-2.5 text-xs font-medium transition-colors',
                  activeTab === tab.id
                    ? 'text-[var(--accent-color)]'
                    : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
                )}
              >
                <Icon className="h-3.5 w-3.5" />
                {tab.label}
                {activeTab === tab.id && (
                  <div className="absolute bottom-0 left-1 right-1 h-0.5 rounded-full bg-[var(--accent-color)]" />
                )}
              </button>
            )
          })}
        </div>

        {/* Scrollable content */}
        <div className="flex-1 overflow-y-auto overflow-x-hidden scrollbar-thin">
          {/* ──── Tab: Generate ──── */}
          {activeTab === 'generate' && (
            <div className="flex flex-col gap-4 p-4">
              {/* Prompt */}
              <div>
                <div className="mb-1.5 flex items-center justify-between">
                  <label className="text-[10px] font-medium uppercase tracking-wider text-[var(--text-secondary)]">
                    提示词
                  </label>
                  <div className="flex items-center gap-0.5">
                    <button
                      onClick={() => handleOptimize('normal')}
                      disabled={optimizing || !prompt.trim()}
                      title="AI 优化"
                      className="rounded-lg p-1.5 text-[var(--accent-color)] transition-all hover:bg-[var(--accent-color)]/10 disabled:opacity-30"
                    >
                      {optimizing && optimizeMode === 'normal' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
                    </button>
                    <button
                      onClick={() => handleOptimize('json')}
                      disabled={optimizing || !prompt.trim()}
                      title="JSON 结构化"
                      className="rounded-lg p-1.5 text-[var(--accent-color)] transition-all hover:bg-[var(--accent-color)]/10 disabled:opacity-30"
                    >
                      {optimizing && optimizeMode === 'json' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <FileJson className="h-3.5 w-3.5" />}
                    </button>
                    <div className="mx-0.5 h-4 w-px bg-[var(--border-color)]" />
                    <button onClick={handleUndo} disabled={!canUndo || optimizing} title="撤销" className="rounded-lg p-1.5 text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)] disabled:opacity-30">
                      <Undo2 className="h-3.5 w-3.5" />
                    </button>
                    <button onClick={handleRedo} disabled={!canRedo || optimizing} title="重做" className="rounded-lg p-1.5 text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)] disabled:opacity-30">
                      <Redo2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>
                <textarea
                  value={prompt}
                  onChange={(e) => handlePromptChange(e.target.value)}
                  onKeyDown={(e) => {
                    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
                      e.preventDefault()
                      handleGenerate()
                    }
                  }}
                  placeholder="描述你想要生成的图片...&#10;Ctrl+Enter 快速生成"
                  rows={5}
                  className="w-full resize-none rounded-xl border-none bg-[var(--bg-primary)] px-3.5 py-3 text-sm leading-relaxed text-[var(--text-primary)] placeholder:text-[var(--text-secondary)]/50 focus:outline-none focus:ring-2 focus:ring-[var(--accent-color)]/20"
                />
              </div>

              {/* Reference Images */}
              <div
                  onDragEnter={(e) => { e.preventDefault(); setIsDraggingOver(true) }}
                  onDragOver={(e) => e.preventDefault()}
                  onDragLeave={(e) => { e.preventDefault(); setIsDraggingOver(false) }}
                  onDrop={(e) => { e.preventDefault(); setIsDraggingOver(false); if (e.dataTransfer.files.length) addFiles(e.dataTransfer.files) }}
                >
                  <div className="mb-1.5 flex items-center justify-between">
                    <div className="flex items-center gap-1.5">
                      <button
                        onClick={() => setRefExpanded(!refExpanded)}
                        className="rounded p-0.5 transition-colors hover:bg-[var(--bg-tertiary)]"
                      >
                        {refExpanded ? <ChevronUp className="h-3 w-3 text-[var(--text-secondary)]" /> : <ChevronDown className="h-3 w-3 text-[var(--text-secondary)]" />}
                      </button>
                      <label className="flex items-center gap-1.5 text-[10px] font-medium uppercase tracking-wider text-[var(--text-secondary)]">
                        <ImageIcon className="h-3.5 w-3.5 text-[var(--accent-color)]" />
                        参考图 ({refImages.length}/14)
                      </label>
                      {refImages.length > 0 && (
                        <span className="rounded-full bg-[var(--accent-color)]/10 px-2 py-0.5 text-[10px] font-bold text-[var(--accent-color)]">
                          图生图
                        </span>
                      )}
                    </div>
                    {refImages.length > 0 && (
                      <button
                        onClick={() => {
                          refImages.forEach((r) => { if (r.src.startsWith('blob:')) URL.revokeObjectURL(r.src) })
                          setRefImages([])
                        }}
                        className="text-[10px] text-red-400 hover:text-red-300"
                      >
                        清空
                      </button>
                    )}
                  </div>

                  {refExpanded && (
                    <>
                      {refImages.length > 0 && (
                        <div className="flex gap-2 overflow-x-auto pb-2 scrollbar-none">
                          {refImages.map((ref) => (
                            <div key={ref.id} className="group relative h-[72px] w-[72px] flex-shrink-0 overflow-hidden rounded-xl border border-[var(--border-color)] shadow-sm">
                              <img src={ref.src} alt={ref.name} className="h-full w-full object-cover" draggable={false} />
                              <div className="absolute inset-0 flex items-center justify-center gap-1 bg-black/50 opacity-0 transition-opacity group-hover:opacity-100">
                                <button
                                  onClick={() => handleReverse(ref.id)}
                                  disabled={ref.reversing}
                                  className="rounded-lg bg-white/20 p-1 text-white backdrop-blur-sm hover:bg-white/30 disabled:opacity-50"
                                  title="反推提示词"
                                >
                                  {ref.reversing ? <Loader2 className="h-3 w-3 animate-spin" /> : <ScanSearch className="h-3 w-3" />}
                                </button>
                                <button
                                  onClick={() => removeRef(ref.id)}
                                  className="rounded-lg bg-white/20 p-1 text-white backdrop-blur-sm hover:bg-red-500/80"
                                  title="删除"
                                >
                                  <X className="h-3 w-3" />
                                </button>
                              </div>
                            </div>
                          ))}
                          {refImages.length < 14 && (
                            <button
                              onClick={() => setShowPicker(true)}
                              className={cn(
                                'flex h-[72px] w-[72px] flex-shrink-0 items-center justify-center rounded-xl border-2 border-dashed transition-all',
                                isDraggingOver
                                  ? 'border-[var(--accent-color)] bg-[var(--accent-color)]/10'
                                  : 'border-[var(--border-color)] hover:border-[var(--accent-color)] hover:bg-[var(--accent-color)]/5'
                              )}
                            >
                              <ImagePlus className="h-4 w-4 text-[var(--text-secondary)]" />
                            </button>
                          )}
                        </div>
                      )}

                      {refImages.length === 0 && (
                        <button
                          onClick={() => setShowPicker(true)}
                          className={cn(
                            'flex w-full items-center justify-center gap-2 rounded-xl border-2 border-dashed py-4 transition-all group',
                            isDraggingOver
                              ? 'border-[var(--accent-color)] bg-[var(--accent-color)]/10'
                              : 'border-[var(--border-color)] hover:border-[var(--accent-color)] hover:bg-[var(--accent-color)]/5'
                          )}
                        >
                          <ImagePlus className="h-4 w-4 text-[var(--text-secondary)] group-hover:text-[var(--accent-color)]" />
                          <span className="text-xs text-[var(--text-secondary)] group-hover:text-[var(--accent-color)]">
                            拖拽 / 粘贴 / 点击 · 最多 14 张
                          </span>
                        </button>
                      )}
                    </>
                  )}
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/*"
                    multiple
                    className="hidden"
                    onChange={(e) => e.target.files && addFiles(e.target.files)}
                  />
                </div>

              {/* Aspect Ratio */}
              <div>
                <label className="mb-1.5 block text-[10px] font-medium uppercase tracking-wider text-[var(--text-secondary)]">
                  宽高比
                </label>
                <div className="flex flex-wrap gap-1.5">
                  {ASPECT_RATIOS.map((size) => (
                      <button
                        key={size}
                        onClick={() => setAspectRatio(size)}
                        className={cn(
                          'rounded-lg px-3 py-1.5 text-xs font-medium transition-all',
                          aspectRatio === size
                            ? 'bg-[var(--accent-color)] text-white shadow-sm'
                            : 'bg-[var(--bg-primary)] text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)] hover:text-[var(--text-primary)]'
                        )}
                      >
                        {size}
                      </button>
                    ))}
                </div>
              </div>

              {/* Quality & Count Row */}
              <div className="flex items-end gap-4">
                <div className="flex-1">
                  <label className="mb-1.5 block text-[10px] font-medium uppercase tracking-wider text-[var(--text-secondary)]">
                    分辨率
                  </label>
                  <div className="flex gap-1.5">
                    {QUALITIES.map((q) => (
                      <button
                        key={q}
                        onClick={() => setQuality(q)}
                        className={cn(
                          'flex-1 rounded-lg py-1.5 text-xs font-medium transition-all',
                          quality === q
                            ? 'bg-[var(--accent-color)] text-white shadow-sm'
                            : 'bg-[var(--bg-primary)] text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)]'
                        )}
                      >
                        {q}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="shrink-0">
                  <label className="mb-1.5 block text-[10px] font-medium uppercase tracking-wider text-[var(--text-secondary)]">
                    数量
                  </label>
                  <div className="flex items-center gap-1">
                    <button
                      onClick={() => setCount(Math.max(1, count - 1))}
                      disabled={count <= 1}
                      className="flex h-8 w-8 items-center justify-center rounded-lg bg-[var(--bg-primary)] text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-tertiary)] disabled:opacity-30"
                    >
                      <Minus className="h-3.5 w-3.5" />
                    </button>
                    <span className="w-7 text-center text-sm font-semibold text-[var(--text-primary)]">{count}</span>
                    <button
                      onClick={() => setCount(Math.min(10, count + 1))}
                      disabled={count >= 10}
                      className="flex h-8 w-8 items-center justify-center rounded-lg bg-[var(--bg-primary)] text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-tertiary)] disabled:opacity-30"
                    >
                      <Plus className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* ──── Tab: Market (Official 935 templates) ──── */}
          {activeTab === 'market' && (
            <div className="flex flex-col gap-3 p-4">
              {/* Search */}
              <div className="relative">
                <Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[var(--text-secondary)]" />
                <input
                  type="text"
                  value={marketQuery}
                  onChange={(e) => setMarketQuery(e.target.value)}
                  placeholder="搜索模板市场"
                  className="w-full rounded-xl border border-[var(--border-color)] bg-[var(--bg-primary)] py-2 pl-9 pr-3 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-secondary)] focus:border-[var(--accent-color)] focus:outline-none"
                />
              </div>

              {/* Filters */}
              <div className="flex flex-col gap-2">
                <div className="flex gap-2">
                  <select
                    value={marketChannel}
                    onChange={(e) => setMarketChannel(e.target.value)}
                    className="flex-1 rounded-lg border border-[var(--border-color)] bg-[var(--bg-primary)] px-2 py-1.5 text-xs text-[var(--text-primary)] focus:border-[var(--accent-color)] focus:outline-none"
                  >
                    {(templateMeta.channels as string[]).map((ch) => (
                      <option key={ch} value={ch}>{ch}</option>
                    ))}
                  </select>
                  <select
                    value={marketMaterial}
                    onChange={(e) => setMarketMaterial(e.target.value)}
                    className="flex-1 rounded-lg border border-[var(--border-color)] bg-[var(--bg-primary)] px-2 py-1.5 text-xs text-[var(--text-primary)] focus:border-[var(--accent-color)] focus:outline-none"
                  >
                    {(templateMeta.materials as string[]).map((m) => (
                      <option key={m} value={m}>{m}</option>
                    ))}
                  </select>
                  <select
                    value={marketRatio}
                    onChange={(e) => setMarketRatio(e.target.value)}
                    className="w-[72px] shrink-0 rounded-lg border border-[var(--border-color)] bg-[var(--bg-primary)] px-2 py-1.5 text-xs text-[var(--text-primary)] focus:border-[var(--accent-color)] focus:outline-none"
                  >
                    {(templateMeta.ratios as string[]).map((r) => (
                      <option key={r} value={r}>{r}</option>
                    ))}
                  </select>
                </div>
                <div className="text-[10px] text-[var(--text-tertiary)]">
                  共 {filteredMarketTemplates.length} / {officialTemplates.length} 个模板
                </div>
              </div>

              {/* Template Cards with Preview */}
              <div className="flex flex-col gap-2.5">
                {filteredMarketTemplates.map((item) => (
                  <div
                    key={item.no}
                    className="group overflow-hidden rounded-xl border border-[var(--border-color)] bg-[var(--bg-primary)] transition-colors hover:border-[var(--accent-color)]/30"
                  >
                    {/* Preview Image */}
                    {item.preview && (
                      <div className="relative h-[140px] w-full overflow-hidden bg-[var(--bg-tertiary)]">
                        <img
                          src={item.preview}
                          alt={item.title}
                          className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
                          loading="lazy"
                          draggable={false}
                        />
                        {/* Overlay badges */}
                        <div className="absolute left-2 top-2 flex gap-1">
                          {item.ratio && (
                            <span className="rounded-md bg-black/60 px-1.5 py-0.5 text-[10px] font-medium text-white backdrop-blur-sm">
                              {item.ratio}
                            </span>
                          )}
                          {(item.minRefs ?? 0) > 0 && (
                            <span className="flex items-center gap-0.5 rounded-md bg-black/60 px-1.5 py-0.5 text-[10px] font-medium text-white backdrop-blur-sm">
                              <ImageUp className="h-2.5 w-2.5" />
                              {item.minRefs}+
                            </span>
                          )}
                        </div>
                      </div>
                    )}

                    {/* Content */}
                    <div className="p-3">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-sm font-medium text-[var(--text-primary)]">{item.title}</div>
                          {item.tags && item.tags.length > 0 && (
                            <div className="mt-1 flex flex-wrap gap-1">
                              {item.tags.slice(0, 4).map((tag, i) => (
                                <span key={i} className="rounded-md bg-[var(--bg-tertiary)] px-1.5 py-0.5 text-[10px] text-[var(--text-secondary)]">
                                  {tag}
                                </span>
                              ))}
                              {item.tags.length > 4 && (
                                <span className="text-[10px] text-[var(--text-tertiary)]">+{item.tags.length - 4}</span>
                              )}
                            </div>
                          )}
                        </div>
                        <div className="flex shrink-0 gap-1">
                          <button
                            onClick={() => copyText(item.prompt)}
                            className="rounded-lg p-1.5 text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-tertiary)] hover:text-[var(--text-primary)]"
                            title="复制提示词"
                          >
                            <Copy className="h-3.5 w-3.5" />
                          </button>
                          <button
                            onClick={() => applyMarketTemplate(item)}
                            className="rounded-lg p-1.5 text-[var(--accent-color)] transition-colors hover:bg-[var(--accent-color)]/10"
                            title="使用此模板"
                          >
                            <ArrowRight className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      </div>
                      {item.description && (
                        <div className="mt-1.5 line-clamp-2 text-xs leading-relaxed text-[var(--text-secondary)]">{item.description}</div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* ──── Tab: Templates ──── */}
          {activeTab === 'templates' && (
            <div className="flex flex-col gap-3 p-4">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[var(--text-secondary)]" />
                <input
                  type="text"
                  value={templateQuery}
                  onChange={(e) => setTemplateQuery(e.target.value)}
                  placeholder="搜索模板"
                  className="w-full rounded-xl border border-[var(--border-color)] bg-[var(--bg-primary)] py-2 pl-9 pr-3 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-secondary)] focus:border-[var(--accent-color)] focus:outline-none"
                />
              </div>

              <div className="text-[10px] text-[var(--text-tertiary)]">
                共 {filteredTemplates.length} 个模板
              </div>

              <div className="flex flex-col gap-2">
                {filteredTemplates.map((item) => (
                  <div
                    key={item.no}
                    className="rounded-xl border border-[var(--border-color)] bg-[var(--bg-primary)] p-3 transition-colors hover:border-[var(--accent-color)]/30"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm font-medium text-[var(--text-primary)]">{item.title}</div>
                        <div className="mt-1 flex flex-wrap gap-1">
                          <span className="rounded-md bg-[var(--bg-tertiary)] px-1.5 py-0.5 text-[10px] text-[var(--text-secondary)]">
                            {item.language || 'EN'}
                          </span>
                          {item.featured && (
                            <span className="rounded-md bg-amber-500/10 px-1.5 py-0.5 text-[10px] text-amber-400">Featured</span>
                          )}
                        </div>
                      </div>
                      <div className="flex shrink-0 gap-1">
                        <button
                          onClick={() => copyText(item.prompt)}
                          className="rounded-lg p-1.5 text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-tertiary)] hover:text-[var(--text-primary)]"
                          title="复制"
                        >
                          <Copy className="h-3.5 w-3.5" />
                        </button>
                        <button
                          onClick={() => applyTemplate(item)}
                          className="rounded-lg p-1.5 text-[var(--accent-color)] transition-colors hover:bg-[var(--accent-color)]/10"
                          title="使用"
                        >
                          <ArrowRight className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </div>
                    {item.description && (
                      <div className="mt-1.5 line-clamp-2 text-xs leading-relaxed text-[var(--text-secondary)]">{item.description}</div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* ──── Tab: Camera ──── */}
          {activeTab === 'camera' && (
            <div className="flex flex-col gap-3 p-4">
              <div className="flex gap-2">
                <div className="relative flex-1">
                  <Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[var(--text-secondary)]" />
                  <input
                    type="text"
                    value={cameraQuery}
                    onChange={(e) => setCameraQuery(e.target.value)}
                    placeholder="搜索运镜"
                    className="w-full rounded-xl border border-[var(--border-color)] bg-[var(--bg-primary)] py-2 pl-9 pr-3 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-secondary)] focus:border-[var(--accent-color)] focus:outline-none"
                  />
                </div>
                <select
                  value={moodAdjective || ''}
                  onChange={(e) => setMoodAdjective(e.target.value || null)}
                  className="w-[140px] rounded-xl border border-[var(--border-color)] bg-[var(--bg-primary)] px-2 py-2 text-xs text-[var(--text-primary)] focus:border-[var(--accent-color)] focus:outline-none"
                >
                  <option value="">情绪修饰</option>
                  {moodOptions.map((opt) => (
                    <option key={opt.value} value={opt.value}>{opt.label}</option>
                  ))}
                </select>
              </div>

              {Object.entries(groupedCameraMoves).map(([category, moves]) => (
                <div key={category}>
                  <div className="sticky top-0 z-10 mb-1.5 flex items-center gap-2 bg-[var(--bg-secondary)] py-1">
                    <div className="h-px flex-1 bg-[var(--border-color)]" />
                    <span className="shrink-0 text-[10px] font-medium uppercase tracking-wider text-[var(--text-tertiary)]">{category}</span>
                    <div className="h-px flex-1 bg-[var(--border-color)]" />
                  </div>
                  <div className="flex flex-col gap-1.5">
                    {moves.map((item) => (
                      <div
                        key={item.id}
                        className="group flex items-center justify-between gap-2 rounded-xl border border-[var(--border-color)] bg-[var(--bg-primary)] px-3 py-2.5 transition-colors hover:border-[var(--accent-color)]/30"
                      >
                        <div className="min-w-0">
                          <div className="flex items-baseline gap-1.5">
                            <span className="text-sm font-medium text-[var(--text-primary)]">{item.zh}</span>
                            <span className="text-xs text-[var(--text-tertiary)]">{item.en}</span>
                          </div>
                          {item.desc && (
                            <div className="mt-0.5 line-clamp-1 text-[10px] leading-relaxed text-[var(--text-secondary)]">{item.desc}</div>
                          )}
                        </div>
                        <button
                          onClick={() => copyText(buildCameraSnippet(item))}
                          className="shrink-0 rounded-lg p-1.5 text-[var(--text-secondary)] opacity-0 transition-all group-hover:opacity-100 hover:bg-[var(--bg-tertiary)] hover:text-[var(--text-primary)]"
                          title="复制"
                        >
                          <Copy className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              ))}

              <div className="rounded-xl bg-[var(--bg-primary)] px-3 py-2 text-[10px] leading-relaxed text-[var(--text-secondary)]">
                用法：主体/场景 + (Camera Movement: 情绪修饰 + 运镜) + 画面要素
              </div>
            </div>
          )}

          {/* ──── Tab: Comic ──── */}
          {activeTab === 'comic' && (
            <div className="flex flex-col gap-3 p-4">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[var(--text-secondary)]" />
                <input
                  type="text"
                  value={comicQuery}
                  onChange={(e) => setComicQuery(e.target.value)}
                  placeholder="搜索漫画模板"
                  className="w-full rounded-xl border border-[var(--border-color)] bg-[var(--bg-primary)] py-2 pl-9 pr-3 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-secondary)] focus:border-[var(--accent-color)] focus:outline-none"
                />
              </div>

              <div className="flex flex-col gap-2">
                {filteredComicPrompts.map((item) => (
                  <div
                    key={item.no}
                    className="rounded-xl border border-[var(--border-color)] bg-[var(--bg-primary)] p-3 transition-colors hover:border-[var(--accent-color)]/30"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm font-medium text-[var(--text-primary)]">{item.title}</div>
                        <div className="mt-1">
                          <span className="rounded-md bg-[var(--bg-tertiary)] px-1.5 py-0.5 text-[10px] text-[var(--text-secondary)]">
                            {item.language || 'ZH'}
                          </span>
                        </div>
                      </div>
                      <button
                        onClick={() => copyText(item.prompt)}
                        className="shrink-0 rounded-lg p-1.5 text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-tertiary)] hover:text-[var(--text-primary)]"
                        title="复制"
                      >
                        <Copy className="h-3.5 w-3.5" />
                      </button>
                    </div>
                    {item.description && (
                      <div className="mt-1.5 line-clamp-3 text-xs leading-relaxed text-[var(--text-secondary)]">{item.description}</div>
                    )}
                  </div>
                ))}
              </div>

              <div className="rounded-xl bg-[var(--bg-primary)] px-3 py-2 text-[10px] leading-relaxed text-[var(--text-secondary)]">
                三步模板：内容分析 → 分镜脚本 → 角色设定
              </div>
            </div>
          )}
        </div>

        {/* Sticky Generate Footer */}
        {activeTab === 'generate' && (
          <div className="border-t border-[var(--border-color)] p-4">
            <Button
              onClick={handleGenerate}
              disabled={generating || (!prompt.trim() && refImages.length === 0)}
              className="h-12 w-full text-sm font-medium bg-gradient-to-r from-[var(--accent-color)] to-indigo-600 hover:from-[var(--accent-hover)] hover:to-indigo-700 border-none shadow-lg transition-all duration-300"
            >
              {generating ? (
                <span className="flex items-center gap-2">
                  <Loader2 className="h-4.5 w-4.5 animate-spin" />
                  生成中 ({progress.done}/{progress.total})
                </span>
              ) : refImages.length > 0 ? (
                <span className="flex items-center gap-2">
                  <Sparkles className="h-4.5 w-4.5" />
                  图生图{count > 1 ? ` · ${count} 张` : ''}
                </span>
              ) : (
                <span className="flex items-center gap-2">
                  <Wand2 className="h-4.5 w-4.5" />
                  文生图{count > 1 ? ` · ${count} 张` : ''}
                </span>
              )}
            </Button>
            <div className="mt-2 text-center text-[10px] text-[var(--text-tertiary)]">
              nano-banana-pro · 最多 14 张参考图 · 支持 1K/2K/4K · ⌘↩ 快速生成
            </div>
          </div>
        )}
      </div>

      {/* Image Source Picker Modal */}
      {showPicker && (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 backdrop-blur-sm"
          onClick={e => e.target === e.currentTarget && setShowPicker(false)}
        >
          <div
            className="flex h-[min(65vh,560px)] w-[min(600px,90vw)] flex-col overflow-hidden rounded-2xl border border-[var(--border-color)] bg-[var(--bg-secondary)] shadow-2xl"
            onClick={e => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-[var(--border-color)] px-5 py-3.5">
              <h3 className="text-sm font-semibold text-[var(--text-primary)]">选择参考图</h3>
              <button onClick={() => setShowPicker(false)} className="rounded-lg p-1 text-[var(--text-secondary)] hover:bg-[var(--bg-primary)] hover:text-[var(--text-primary)]">
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="flex border-b border-[var(--border-color)] px-4">
              {([
                { key: 'local' as PickerTab, label: '本地上传', icon: Upload },
                { key: 'canvas' as PickerTab, label: '画布素材', icon: Layers },
                { key: 'history' as PickerTab, label: '历史素材', icon: History },
              ]).map(tab => {
                const Icon = tab.icon
                return (
                  <button
                    key={tab.key}
                    onClick={() => setPickerTab(tab.key)}
                    className={cn(
                      'flex items-center gap-1.5 px-3 py-2.5 text-xs font-medium border-b-2 -mb-px transition-colors',
                      pickerTab === tab.key
                        ? 'border-[var(--accent-color)] text-[var(--accent-color)]'
                        : 'border-transparent text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
                    )}
                  >
                    <Icon className="h-3.5 w-3.5" />
                    {tab.label}
                  </button>
                )
              })}
            </div>

            <div className="flex-1 overflow-auto p-4">
              {pickerTab === 'local' && (
                <div
                  className="flex h-full flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed border-[var(--border-color)] bg-[var(--bg-primary)] p-6 transition-colors hover:border-[var(--accent-color)]"
                  onDragOver={e => e.preventDefault()}
                  onDrop={e => { e.preventDefault(); addFiles(e.dataTransfer.files); setShowPicker(false) }}
                >
                  <FolderOpen className="h-10 w-10 text-[var(--accent-color)]" />
                  <div className="text-center">
                    <div className="text-sm font-medium text-[var(--text-primary)]">拖拽图片到此处</div>
                    <div className="mt-1 text-xs text-[var(--text-secondary)]">或点击按钮选择文件</div>
                  </div>
                  <button
                    onClick={() => pickerFileInputRef.current?.click()}
                    className="flex items-center gap-2 rounded-lg bg-[var(--accent-color)] px-4 py-2 text-sm font-medium text-white hover:bg-[var(--accent-hover)]"
                  >
                    <Upload className="h-4 w-4" />
                    选择图片
                  </button>
                  <input
                    ref={pickerFileInputRef}
                    type="file"
                    accept="image/*"
                    multiple
                    onChange={e => { if (e.target.files) { addFiles(e.target.files); setShowPicker(false) }; e.target.value = '' }}
                    className="hidden"
                  />
                </div>
              )}

              {pickerTab === 'canvas' && (
                canvasImages.length > 0 ? (
                  <div>
                    <div className="mb-3 flex items-center gap-2 text-xs font-medium text-[var(--text-primary)]">
                      <Layers className="h-3.5 w-3.5 text-[var(--accent-color)]" />
                      画布中的图片
                      <span className="text-[10px] text-[var(--text-secondary)]">({canvasImages.length})</span>
                    </div>
                    <div className="grid grid-cols-4 gap-2.5">
                      {canvasImages.map(img => (
                        <button
                          key={img.id}
                          onClick={() => addImageFromSrc(img.src, true)}
                          className="group relative aspect-square overflow-hidden rounded-lg border border-[var(--border-color)] bg-[var(--bg-primary)] hover:border-[var(--accent-color)] transition-colors"
                        >
                          <img src={img.src} alt={img.title} className="h-full w-full object-cover" loading="lazy" />
                          <div className="absolute inset-0 flex items-end bg-gradient-to-t from-black/60 to-transparent opacity-0 group-hover:opacity-100 transition-opacity">
                            <span className="w-full truncate px-2 py-1 text-[10px] text-white">{img.title}</span>
                          </div>
                        </button>
                      ))}
                    </div>
                  </div>
                ) : (
                  <div className="flex h-full items-center justify-center text-xs text-[var(--text-secondary)]">画布中暂无图片</div>
                )
              )}

              {pickerTab === 'history' && (
                historyImages.length > 0 ? (
                  <div>
                    <div className="mb-3 flex items-center gap-2 text-xs font-medium text-[var(--text-primary)]">
                      <History className="h-3.5 w-3.5 text-[var(--accent-color)]" />
                      历史素材
                      <span className="text-[10px] text-[var(--text-secondary)]">({historyImages.length})</span>
                    </div>
                    <div className="grid grid-cols-4 gap-2.5">
                      {historyImages.map(asset => (
                        <button
                          key={asset.id}
                          onClick={() => addImageFromSrc(asset.src, true)}
                          className="group relative aspect-square overflow-hidden rounded-lg border border-[var(--border-color)] bg-[var(--bg-primary)] hover:border-[var(--accent-color)] transition-colors"
                        >
                          <img src={asset.src} alt={asset.title || '历史图片'} className="h-full w-full object-cover" loading="lazy" />
                          <div className="absolute inset-0 flex items-end bg-gradient-to-t from-black/60 to-transparent opacity-0 group-hover:opacity-100 transition-opacity">
                            <span className="w-full truncate px-2 py-1 text-[10px] text-white">{asset.title || asset.model || '历史图片'}</span>
                          </div>
                        </button>
                      ))}
                    </div>
                  </div>
                ) : (
                  <div className="flex h-full items-center justify-center text-xs text-[var(--text-secondary)]">暂无历史素材</div>
                )
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
