/**
 * Director Console | 导演台组件
 * 分镜规划 + 预设模板 + AI 润色 + 自动生成
 */

import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { streamChatCompletions, chatCompletions } from '@/api'
import { streamAiAssistant } from '@/lib/nexusApi'
import { generateImage } from '@/api/image'
import { postJson } from '@/lib/workflow/request'
import { useSettingsStore } from '@/store/settings'
import { useGraphStore } from '@/graph/store'
import {
  X,
  Sparkles,
  Clock,
  Plus,
  Trash2,
  Upload,
  Image as ImageIcon,
  Wand2,
  Loader2,
  ChevronDown,
  Eye,
  Copy,
  Check,
  Layers,
  History
} from 'lucide-react'
import {
  DIRECTOR_PRESETS,
  DirectorPreset,
  getPresetById,
  buildFinalPrompt,
  POLISH_SYSTEM_PROMPT,
  getAspectRatioOptions
} from '@/lib/directorPresets'
import { IMAGE_MODELS, DEFAULT_IMAGE_MODEL, DEFAULT_CHAT_MODEL, SEEDREAM_SIZE_OPTIONS, SEEDREAM_4K_SIZE_OPTIONS } from '@/config/models'
import { useAssetsStore } from '@/store/assets'

interface HistoryEntry {
  storyIdea: string
  styleBible: string
  directorNotes: string
  shotCount: number
  aspectRatio: string
  shots: string[]
  timestamp: number
  presetId?: string
}

interface CreateNodesPayload {
  storyIdea: string
  styleBible: string
  directorNotes: string
  shots: string[]
  imageModel: string
  aspectRatio: string
  imageQuality?: string
  autoGenerateImages: boolean
  // 新增：单图模式
  singleImageUrl?: string
  singleImagePrompt?: string
}

interface Props {
  open: boolean
  onClose: () => void
  onCreateNodes: (payload: CreateNodesPayload) => void
}

const HISTORY_KEY = 'nexus-director-history'

// 使用配置的图片模型列表
const imageModelOptions = (IMAGE_MODELS as any[]).map((m: any) => ({
  label: m.label,
  value: m.key
}))

// ===== 尺寸/分辨率辅助（导演台用）=====
const roundEvenInt = (n: number) => {
  const v = Math.max(1, Math.round(n))
  return v % 2 === 0 ? v : v + 1
}

// Seedream：将“分辨率(1K/2K/4K)+比例(16:9等)”映射为像素宽高（用于写入 size 字段）
const seedreamSizeByRatioAndResolution = (ratio: string, resolution: string) => {
  const r = String(ratio || '').trim()
  if (/^\d{3,5}x\d{3,5}$/i.test(r)) return r

  const res = String(resolution || '').trim().toUpperCase()
  const lookup = (list: any[], label: string) => {
    const hit = (Array.isArray(list) ? list : []).find((o: any) => String(o?.label || '').trim() === label)
    const key = String(hit?.key || '').trim()
    return /^\d{3,5}x\d{3,5}$/i.test(key) ? key : ''
  }

  if (res === '4K') return lookup(SEEDREAM_4K_SIZE_OPTIONS as any, r) || lookup(SEEDREAM_SIZE_OPTIONS as any, r) || '4096x4096'
  if (res === '2K') return lookup(SEEDREAM_SIZE_OPTIONS as any, r) || '2048x2048'
  if (res === '1K') {
    const m = r.match(/^(\d+(?:\.\d+)?)\s*:\s*(\d+(?:\.\d+)?)$/)
    const a = Number(m?.[1] || 1)
    const b = Number(m?.[2] || 1)
    if (!Number.isFinite(a) || !Number.isFinite(b) || a <= 0 || b <= 0) return '1024x1024'
    const base = 1024
    if (a >= b) {
      const h = base
      const w = roundEvenInt((base * a) / b)
      return `${w}x${h}`
    }
    const w = base
    const h = roundEvenInt((base * b) / a)
    return `${w}x${h}`
  }

  // fallback：按 2K 处理
  return lookup(SEEDREAM_SIZE_OPTIONS as any, r) || '2048x2048'
}

const parseAspectRatioToNumber = (raw: string) => {
  const v = String(raw || '').trim()
  const m = v.match(/^(\d+(?:\.\d+)?)\s*:\s*(\d+(?:\.\d+)?)$/)
  if (!m) return NaN
  const a = Number(m[1])
  const b = Number(m[2])
  if (!Number.isFinite(a) || !Number.isFinite(b) || a <= 0 || b <= 0) return NaN
  return a / b
}

const parseSizeKeyToRatio = (key: string) => {
  const v = String(key || '').trim()
  if (!v) return NaN
  if (/^\d{3,5}x\d{3,5}$/i.test(v)) {
    const [w, h] = v.toLowerCase().split('x').map((x) => Number(x))
    if (!Number.isFinite(w) || !Number.isFinite(h) || h <= 0) return NaN
    return w / h
  }
  return parseAspectRatioToNumber(v)
}

const normalizeSizeKeys = (sizes: any) => {
  const arr = Array.isArray(sizes) ? sizes : []
  const out: string[] = []
  for (const it of arr) {
    if (typeof it === 'string') out.push(it)
    else if (it && typeof it === 'object') {
      const k = String((it as any).key || (it as any).label || '').trim()
      if (k) out.push(k)
    }
  }
  return out.filter(Boolean)
}

const pickBestSizeKeyForAspect = (modelCfg: any, desiredAspect: string) => {
  const keys = normalizeSizeKeys(modelCfg?.sizes)
  if (keys.length === 0) return String(modelCfg?.defaultParams?.size || desiredAspect || '').trim()

  // exact match (ratio-mode models)
  const exact = keys.find((k) => String(k).trim() === String(desiredAspect || '').trim())
  if (exact) return exact

  const target = parseAspectRatioToNumber(desiredAspect)
  if (!Number.isFinite(target)) return keys[0]

  let best = keys[0]
  let bestDiff = Number.POSITIVE_INFINITY
  for (const k of keys) {
    const r = parseSizeKeyToRatio(k)
    if (!Number.isFinite(r)) continue
    const diff = Math.abs(r - target)
    if (diff < bestDiff) {
      bestDiff = diff
      best = k
    }
  }
  return best
}

export default function DirectorConsole({ open, onClose, onCreateNodes }: Props) {
  // 预设模式
  const [selectedPreset, setSelectedPreset] = useState<string>('none')
  const [showPresetDropdown, setShowPresetDropdown] = useState(false)

  // 多参考图支持
  const [referenceImages, setReferenceImages] = useState<string[]>([])
  const [showImagePicker, setShowImagePicker] = useState(false)
  const [activeImageSlot, setActiveImageSlot] = useState<number>(0) // 当前选择的槽位
  const fileInputRef = useRef<HTMLInputElement>(null)

  // 重试状态
  const [retryCount, setRetryCount] = useState(0)
  const [retryMessage, setRetryMessage] = useState<string | null>(null)
  const MAX_RETRIES = 3

  // Form state
  const [userPrompt, setUserPrompt] = useState('')
  const [styleBible, setStyleBible] = useState('')
  const [directorNotes, setDirectorNotes] = useState('')
  const [shotCount, setShotCount] = useState(10)
  const [aspectRatio, setAspectRatio] = useState('16:9')
  const [imageModel, setImageModel] = useState(DEFAULT_IMAGE_MODEL || 'gemini-3-pro-image-preview')
  const [autoGenerateImages, setAutoGenerateImages] = useState(true)
  const [resolution, setResolution] = useState<'1K' | '2K' | '4K'>('2K')

  // 根据当前模型获取最大参考图数量
  const maxRefImages = useMemo(() => {
    const modelCfg = (IMAGE_MODELS as any[]).find(m => m.key === imageModel)
    // 默认值：如果模型不支持参考图则为0，否则为4
    if (!modelCfg) return 4
    if (modelCfg.supportsReferenceImages === false) return 0
    return modelCfg.maxRefImages ?? 4
  }, [imageModel])

  // 当模型切换时，如果参考图数量超过新模型限制，自动截断
  useEffect(() => {
    if (referenceImages.length > maxRefImages) {
      setReferenceImages(prev => prev.slice(0, maxRefImages))
    }
  }, [maxRefImages, referenceImages.length])

  // AI 润色相关
  type PolishLang = 'zh' | 'en'
  const [polishLang, setPolishLang] = useState<PolishLang>('zh')
  const [polishedPromptZh, setPolishedPromptZh] = useState('')
  const [polishedPromptEn, setPolishedPromptEn] = useState('')
  const [isPolishing, setIsPolishing] = useState(false)
  const [polishError, setPolishError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  // 生成图片相关
  const [isGeneratingImage, setIsGeneratingImage] = useState(false)
  const [generatedImageUrl, setGeneratedImageUrl] = useState<string | null>(null)
  const [generateError, setGenerateError] = useState<string | null>(null)

  // 分镜模式（旧功能）
  const [shots, setShots] = useState<string[]>([])
  const [isGenerating, setIsGenerating] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // History state
  const [history, setHistory] = useState<HistoryEntry[]>([])
  const [showHistory, setShowHistory] = useState(false)

  // 当前预设配置
  const currentPreset = getPresetById(selectedPreset) || DIRECTOR_PRESETS[0]

  // 获取画布中的图片节点（打开选择器时刷新）
  const canvasImages = useMemo(() => {
    if (!showImagePicker) return []
    const nodes = useGraphStore.getState().nodes
    return nodes
      .filter(n => n.type === 'image' && (n.data as any)?.url)
      .map(n => ({
        id: n.id,
        src: (n.data as any).url as string,
        title: (n.data as any)?.label || (n.data as any)?.fileName || '画布图片'
      }))
  }, [showImagePicker])

  // 获取历史素材中的图片（打开选择器时刷新）
  const historyImages = useMemo(() => {
    if (!showImagePicker) return []
    return useAssetsStore.getState().getAssetsByType('image').slice(0, 50)
  }, [showImagePicker])

  // 切换预设时更新默认值
  useEffect(() => {
    if (currentPreset) {
      setAspectRatio(currentPreset.aspectRatio)
      setResolution(currentPreset.resolution)
      // 清空之前的结果
      setPolishedPromptZh('')
      setPolishedPromptEn('')
      setGeneratedImageUrl(null)
      setShots([])
    }
  }, [selectedPreset])

  // Load history on mount
  useEffect(() => {
    try {
      const saved = localStorage.getItem(HISTORY_KEY)
      if (saved) setHistory(JSON.parse(saved))
    } catch {
      // ignore
    }
  }, [])

  // Save history
  const saveHistory = useCallback((entries: HistoryEntry[]) => {
    try {
      localStorage.setItem(HISTORY_KEY, JSON.stringify(entries.slice(-20)))
    } catch {
      // ignore
    }
  }, [])

  const addToHistory = useCallback((entry: Omit<HistoryEntry, 'timestamp'>) => {
    const newEntry: HistoryEntry = { ...entry, timestamp: Date.now() }
    setHistory((prev) => {
      const next = [...prev, newEntry]
      saveHistory(next)
      return next
    })
  }, [saveHistory])

  const loadFromHistory = useCallback((entry: HistoryEntry) => {
    setUserPrompt(entry.storyIdea || '')
    setStyleBible(entry.styleBible || '')
    setDirectorNotes(entry.directorNotes || '')
    setShotCount(entry.shotCount || 10)
    setAspectRatio(entry.aspectRatio || '16:9')
    setShots(entry.shots || [])
    if (entry.presetId) setSelectedPreset(entry.presetId)
    setShowHistory(false)
  }, [])

  const clearHistory = useCallback(() => {
    setHistory([])
    saveHistory([])
  }, [saveHistory])

  // 参考图上传处理（支持多图）
  const handleImageUpload = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    const reader = new FileReader()
    reader.onload = (ev) => {
      const dataUrl = ev.target?.result as string
      setReferenceImages(prev => {
        const newImages = [...prev]
        if (activeImageSlot < newImages.length) {
          newImages[activeImageSlot] = dataUrl
        } else {
          newImages.push(dataUrl)
        }
        return newImages.slice(0, maxRefImages)
      })
    }
    reader.readAsDataURL(file)
    if (fileInputRef.current) fileInputRef.current.value = ''
  }, [activeImageSlot])

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    const file = e.dataTransfer.files?.[0]
    if (!file || !file.type.startsWith('image/')) return

    const reader = new FileReader()
    reader.onload = (ev) => {
      const dataUrl = ev.target?.result as string
      setReferenceImages(prev => {
        const newImages = [...prev]
        if (activeImageSlot < newImages.length) {
          newImages[activeImageSlot] = dataUrl
        } else {
          newImages.push(dataUrl)
        }
        return newImages.slice(0, maxRefImages)
      })
    }
    reader.readAsDataURL(file)
  }, [activeImageSlot, maxRefImages])

  const removeReferenceImage = useCallback((index: number) => {
    setReferenceImages(prev => prev.filter((_, i) => i !== index))
  }, [])

  const clearAllReferenceImages = useCallback(() => {
    setReferenceImages([])
    if (fileInputRef.current) fileInputRef.current.value = ''
  }, [])

  // 从画布或历史选择参考图
  const handleSelectFromPicker = useCallback((src: string) => {
    setReferenceImages(prev => {
      const newImages = [...prev]
      if (activeImageSlot < newImages.length) {
        newImages[activeImageSlot] = src
      } else {
        newImages.push(src)
      }
      return newImages.slice(0, maxRefImages)
    })
    setShowImagePicker(false)
  }, [activeImageSlot, maxRefImages])

  // 带重试的图片生成
  const generateImageWithRetry = useCallback(async (
    generateFn: () => Promise<string>,
    maxRetries: number = MAX_RETRIES
  ): Promise<string> => {
    let lastError: Error | null = null

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        setRetryCount(attempt)
        if (attempt > 1) {
          setRetryMessage(`第 ${attempt}/${maxRetries} 次尝试...`)
        }
        const result = await generateFn()
        setRetryMessage(null)
        setRetryCount(0)
        return result
      } catch (err: any) {
        lastError = err
        console.warn(`[DirectorConsole] 生图尝试 ${attempt}/${maxRetries} 失败:`, err?.message)

        if (attempt < maxRetries) {
          // 指数退避：2s, 4s, 8s
          const waitMs = Math.min(2000 * Math.pow(2, attempt - 1), 10000)
          setRetryMessage(`生成失败，${Math.round(waitMs / 1000)}秒后重试 (${attempt}/${maxRetries})...`)
          await new Promise(r => setTimeout(r, waitMs))
        }
      }
    }

    setRetryMessage(null)
    setRetryCount(0)
    throw lastError || new Error('生成失败')
  }, [])

  const parsePolishDualLang = useCallback((raw: string): { zh: string; en: string } => {
    const text = String(raw || '').trim()
    const withoutFences = text
      .replace(/^```(?:json)?/i, '')
      .replace(/```$/i, '')
      .trim()
    const i0 = withoutFences.indexOf('{')
    const i1 = withoutFences.lastIndexOf('}')
    const jsonStr = i0 >= 0 && i1 > i0 ? withoutFences.slice(i0, i1 + 1) : ''

    const fallback = { zh: text, en: text }
    if (!jsonStr) return fallback

    try {
      const obj: any = JSON.parse(jsonStr)
      const zh = String(obj?.zh || obj?.prompt_zh || obj?.final_prompt_cn || '').trim()
      const en = String(obj?.en || obj?.prompt_en || obj?.final_prompt_en || '').trim()
      if (zh || en) {
        return { zh: zh || en || text, en: en || zh || text }
      }
      return fallback
    } catch {
      return fallback
    }
  }, [])

  // AI 润色提示词
  const handlePolish = useCallback(async () => {
    if (!userPrompt.trim()) {
      setPolishError('请先输入描述')
      return
    }

    setIsPolishing(true)
    setPolishError(null)
    setPolishedPromptZh('')
    setPolishedPromptEn('')

    try {
      // 获取全局 AI 助手模型设置
      const aiModel = useSettingsStore.getState().aiAssistantModel || 'gpt-5-mini'

      // 构建消息
      const messages: any[] = [
        { role: 'system', content: currentPreset.systemPrompt || POLISH_SYSTEM_PROMPT }
      ]

      // 构建用户消息（支持多参考图）
      let userContent: any
      if (referenceImages.length > 0) {
        const imageDescriptions = referenceImages.map((_, i) => `Image ${i + 1}: Reference image ${i + 1}`).join('\n')
        const textPart = {
          type: 'text',
          text: `Please analyze these ${referenceImages.length} reference image(s) and use them to enhance the following prompt.
${referenceImages.length > 1 ? `Image order significance:\n- Image 1: Primary subject/style reference\n- Image 2+: Additional style/element references\n` : ''}
Extract product/subject details, style, and visual elements from the images.

User's description:
${userPrompt}

${currentPreset.promptTemplate ? `Use this template structure:\n${currentPreset.promptTemplate}` : ''}

Output STRICT JSON only (no markdown, no code fences):
{"zh":"<polished prompt in Simplified Chinese>","en":"<polished prompt in English>"}`
        }
        const imageParts = referenceImages.map(img => ({
          type: 'image_url',
          image_url: { url: img }
        }))
        userContent = [textPart, ...imageParts]
      } else {
        userContent = `Polish this prompt into a professional, detailed image generation prompt:

User's description:
${userPrompt}

${currentPreset.promptTemplate ? `Use this template structure:\n${currentPreset.promptTemplate}` : ''}

Output STRICT JSON only (no markdown, no code fences):
{"zh":"<polished prompt in Simplified Chinese>","en":"<polished prompt in English>"}`
      }

      messages.push({ role: 'user', content: userContent })

      // 调用 AI（使用全局设置的模型）
      let response = ''
      for await (const chunk of streamAiAssistant(aiModel, messages, { filterThinking: true })) {
        response += chunk
      }

      const dual = parsePolishDualLang(response)
      setPolishedPromptZh(dual.zh)
      setPolishedPromptEn(dual.en)

      // 如果没有使用模板，直接使用AI返回的结果
      // 如果使用了模板，AI已经按模板格式润色了
      
    } catch (err: any) {
      console.error('[DirectorConsole] AI 润色失败:', err)
      setPolishError(err?.message || '润色失败')
    } finally {
      setIsPolishing(false)
    }
  }, [userPrompt, referenceImages, currentPreset, parsePolishDualLang])

  // 生成图片 - 支持多种模型格式（用于单独生图，已有润色结果时）
  const handleGenerateImage = useCallback(async () => {
    const polished = (polishLang === 'zh' ? polishedPromptZh : polishedPromptEn).trim()
    const promptToUse = polished || userPrompt
    if (!promptToUse.trim()) {
      setGenerateError('请先输入或润色提示词')
      return
    }

    setIsGeneratingImage(true)
    setGenerateError(null)
    setGeneratedImageUrl(null)
    setRetryMessage(null)
    setRetryCount(0)

    try {
      const imageUrl = await generateImageWithRetry(async () => {
        const modelCfg = (IMAGE_MODELS as any[]).find(m => m.key === imageModel) || (IMAGE_MODELS as any[])[0]
        const format = modelCfg?.format || 'openai-image'
        let resultUrl = ''

        if (format === 'gemini-image') {
          // Gemini 格式 - 支持多参考图
          const requestParts: any[] = []
          if (promptToUse) requestParts.push({ text: promptToUse })
          for (const refImg of referenceImages) {
            const match = refImg.match(/^data:(.+?);base64,(.+)$/)
            if (match) {
              requestParts.push({ inline_data: { mime_type: match[1], data: match[2] } })
            }
          }
          if (requestParts.length === 0) throw new Error('请提供提示词或参考图')

          const payload = {
            contents: [{ role: 'user', parts: requestParts }],
            generationConfig: {
              responseModalities: ['IMAGE'],
              imageConfig: { aspectRatio: aspectRatio || '1:1', imageSize: resolution || '2K' }
            }
          }
          const rsp = await postJson<any>(modelCfg.endpoint, payload, { authMode: modelCfg.authMode, timeoutMs: modelCfg.timeout || 240000 })
          const parts = rsp?.candidates?.[0]?.content?.parts || []
          const inline = parts.map((p: any) => p.inlineData || p.inline_data).filter(Boolean)[0]
          if (inline?.data) {
            resultUrl = `data:${inline.mimeType || inline.mime_type || 'image/png'};base64,${inline.data}`
          }
          if (!resultUrl) throw new Error('生图返回为空，请重试')
        } else if (format === 'openai-chat-image') {
          // Chat 方式生图
          const chatMessages = [{ role: 'user', content: `Generate an image: ${promptToUse}` }]
          const result = await chatCompletions({ model: imageModel, messages: chatMessages })
          const content = result?.choices?.[0]?.message?.content || ''
          const urlMatch = content.match(/https?:\/\/[^\s<>"{}|\\^`[\]]+\.(png|jpg|jpeg|webp|gif)/i)
          if (urlMatch) resultUrl = urlMatch[0]
          else {
            const b64Match = content.match(/data:image\/[^;]+;base64,[A-Za-z0-9+/=]+/)
            if (b64Match) resultUrl = b64Match[0]
          }
          if (!resultUrl) throw new Error('Chat 生图未返回有效图片')
        } else if (format === 'kling-image' || format === 'kling-omni-image') {
          // Kling 格式 - 支持多参考图
          const klingRes = String(resolution || '').trim().toLowerCase() || String(modelCfg.defaultParams?.quality || '1k')
          const endpoint = format === 'kling-omni-image' ? '/kling/v1/images/omni-image' : modelCfg.endpoint
          const klingPayload: any = {
            model_name: modelCfg.defaultParams?.model_name || (format === 'kling-omni-image' ? 'kling-image-o1' : 'kling-v2-1'),
            prompt: promptToUse,
            n: 1,
            aspect_ratio: aspectRatio || '16:9',
            resolution: klingRes
          }
          // 添加参考图
          if (referenceImages.length > 0) {
            if (format === 'kling-omni-image') {
              klingPayload.image_list = referenceImages.map(img => ({ image: img }))
            } else {
              klingPayload.image = referenceImages[0]
            }
          }
          const resp = await postJson<any>(endpoint, klingPayload, { authMode: modelCfg.authMode, timeoutMs: modelCfg.timeout || 240000 })

          // 尝试直接获取结果
          const extractUrls = (obj: any): string[] => {
            const urls: string[] = []
            const walk = (o: any, depth = 0) => {
              if (!o || depth > 5) return
              if (typeof o === 'string' && (o.startsWith('http') || o.startsWith('data:'))) {
                urls.push(o)
                return
              }
              if (Array.isArray(o)) {
                o.forEach(i => walk(i, depth + 1))
                return
              }
              if (typeof o === 'object') {
                for (const k of ['url', 'image_url', 'imageUrl', 'output_url']) {
                  if (typeof o[k] === 'string') urls.push(o[k])
                }
                Object.values(o).forEach(v => walk(v, depth + 1))
              }
            }
            walk(obj)
            return urls
          }
          resultUrl = extractUrls(resp)[0] || ''

          if (!resultUrl) {
            // 轮询任务
            const taskId = resp?.data?.task_id || resp?.data?.id || resp?.task_id || resp?.id
            if (!taskId) throw new Error('Kling 生图返回异常：未获取到图片或任务 ID')
            const statusUrl = format === 'kling-omni-image'
              ? `/kling/v1/images/omni-image/${encodeURIComponent(String(taskId))}`
              : `${String(modelCfg.endpoint).replace(/\/$/, '')}/${encodeURIComponent(String(taskId))}`

            for (let i = 0; i < 60; i++) {
              await new Promise(r => setTimeout(r, 3000))
              setRetryMessage(`等待 Kling 生成... (${i + 1}/60)`)
              const statusRes = await postJson<any>(statusUrl, {}, { authMode: modelCfg.authMode, timeoutMs: 30000 })
              resultUrl = extractUrls(statusRes)[0] || ''
              if (resultUrl) break
              const status = String(statusRes?.data?.task_status || statusRes?.task_status || statusRes?.status || '').toLowerCase()
              if (/(fail|error)/i.test(status)) {
                throw new Error(statusRes?.data?.task_status_msg || statusRes?.message || 'Kling 生成失败')
              }
            }
          }
          if (!resultUrl) throw new Error('Kling 生成超时')
        } else {
          // OpenAI 标准格式
          const pickedSize = pickBestSizeKeyForAspect(modelCfg, aspectRatio)
          const result = await generateImage({
            model: imageModel,
            prompt: promptToUse,
            size: pickedSize || aspectRatio,
          }, {
            endpoint: modelCfg?.endpoint || '/images/generations',
            authMode: modelCfg?.authMode || 'bearer',
            timeout: modelCfg?.timeout
          })
          if (result?.url) resultUrl = result.url
          else if (result?.data?.[0]?.url) resultUrl = result.data[0].url
          else if (result?.data?.[0]?.b64_json) resultUrl = `data:image/png;base64,${result.data[0].b64_json}`
          else throw new Error('未获取到图片结果')
        }

        return resultUrl
      })

      setGeneratedImageUrl(imageUrl)

      // 同步到历史素材
      try {
        useAssetsStore.getState().addAsset({
          type: 'image',
          src: imageUrl,
          title: userPrompt?.slice(0, 50) || '导演台生成',
          model: imageModel
        })
      } catch (e) {
        console.warn('[DirectorConsole] 添加到历史素材失败:', e)
      }
    } catch (err: any) {
      console.error('[DirectorConsole] 生成图片失败:', err)
      setGenerateError(err?.message || '生成失败')
    } finally {
      setIsGeneratingImage(false)
      setRetryMessage(null)
      setRetryCount(0)
    }
  }, [polishLang, polishedPromptZh, polishedPromptEn, userPrompt, imageModel, aspectRatio, referenceImages, resolution, generateImageWithRetry])
  // 一键生成：先润色，再生图（带重试）
  const handlePolishAndGenerate = useCallback(async () => {
    if (!userPrompt.trim()) {
      setGenerateError('请先输入描述')
      return
    }

    // 第一步：润色
    setIsPolishing(true)
    setPolishError(null)
    setPolishedPromptZh('')
    setPolishedPromptEn('')
    setGenerateError(null)
    setGeneratedImageUrl(null)
    setRetryMessage(null)
    setRetryCount(0)

    let raw = ''
    let finalPrompt = ''

    try {
      // 获取全局 AI 助手模型设置
      const aiModel = useSettingsStore.getState().aiAssistantModel || 'gpt-5-mini'

      // 构建消息
      const messages: any[] = [
        { role: 'system', content: currentPreset.systemPrompt || POLISH_SYSTEM_PROMPT }
      ]

      // 构建用户消息（支持多参考图）
      let userContent: any
      if (referenceImages.length > 0) {
        const textPart = {
          type: 'text',
          text: `Please analyze these ${referenceImages.length} reference image(s) and use them to enhance the following prompt.
${referenceImages.length > 1 ? `Image order significance:\n- Image 1: Primary subject/style reference\n- Image 2+: Additional style/element references\n` : ''}
Extract product/subject details, style, and visual elements from the images.

User's description:
${userPrompt}

${currentPreset.promptTemplate ? `Use this template structure:\n${currentPreset.promptTemplate}` : ''}

Output STRICT JSON only (no markdown, no code fences):
{"zh":"<polished prompt in Simplified Chinese>","en":"<polished prompt in English>"}`
        }
        const imageParts = referenceImages.map(img => ({
          type: 'image_url',
          image_url: { url: img }
        }))
        userContent = [textPart, ...imageParts]
      } else {
        userContent = `Polish this prompt into a professional, detailed image generation prompt:

User's description:
${userPrompt}

${currentPreset.promptTemplate ? `Use this template structure:\n${currentPreset.promptTemplate}` : ''}

Output STRICT JSON only (no markdown, no code fences):
{"zh":"<polished prompt in Simplified Chinese>","en":"<polished prompt in English>"}`
      }

      messages.push({ role: 'user', content: userContent })

      // 调用 AI 润色（使用全局设置的模型）
      for await (const chunk of streamAiAssistant(aiModel, messages, { filterThinking: true })) {
        raw += chunk
      }
    } catch (err: any) {
      console.error('[DirectorConsole] AI 润色失败:', err)
      setPolishError(err?.message || '润色失败')
      setIsPolishing(false)
      return
    }

    setIsPolishing(false)

    // 第二步：生成图片（带重试）
    const dual = parsePolishDualLang(raw)
    setPolishedPromptZh(dual.zh)
    setPolishedPromptEn(dual.en)

    finalPrompt = (polishLang === 'zh' ? dual.zh : dual.en).trim()
    if (!finalPrompt) {
      setGenerateError('润色结果为空')
      return
    }

    setIsGeneratingImage(true)

    try {
      const imageUrl = await generateImageWithRetry(async () => {
        const modelCfg = (IMAGE_MODELS as any[]).find(m => m.key === imageModel) || (IMAGE_MODELS as any[])[0]
        const format = modelCfg?.format || 'openai-image'
        let resultUrl = ''

        if (format === 'gemini-image') {
          // Gemini 格式 - 支持多参考图
          const requestParts: any[] = []
          if (finalPrompt) requestParts.push({ text: finalPrompt })
          for (const refImg of referenceImages) {
            const match = refImg.match(/^data:(.+?);base64,(.+)$/)
            if (match) {
              requestParts.push({ inline_data: { mime_type: match[1], data: match[2] } })
            }
          }
          if (requestParts.length === 0) throw new Error('请提供提示词或参考图')

          const payload = {
            contents: [{ role: 'user', parts: requestParts }],
            generationConfig: {
              responseModalities: ['IMAGE'],
              imageConfig: { aspectRatio: aspectRatio || '1:1', imageSize: resolution || '2K' }
            }
          }
          const rsp = await postJson<any>(modelCfg.endpoint, payload, { authMode: modelCfg.authMode, timeoutMs: modelCfg.timeout || 240000 })
          const parts = rsp?.candidates?.[0]?.content?.parts || []
          const inline = parts.map((p: any) => p.inlineData || p.inline_data).filter(Boolean)[0]
          if (inline?.data) {
            resultUrl = `data:${inline.mimeType || inline.mime_type || 'image/png'};base64,${inline.data}`
          }
          if (!resultUrl) throw new Error('生图返回为空，请重试')
        } else if (format === 'openai-chat-image') {
          // Chat 方式生图
          const chatMessages = [{ role: 'user', content: `Generate an image based on this description: ${finalPrompt}\n\nPlease return the image directly.` }]
          const result = await chatCompletions({ model: imageModel, messages: chatMessages })
          const content = result?.choices?.[0]?.message?.content || ''
          const urlMatch = content.match(/https?:\/\/[^\s<>"{}|\\^`[\]]+\.(png|jpg|jpeg|webp|gif)/i)
          if (urlMatch) resultUrl = urlMatch[0]
          else {
            const b64Match = content.match(/data:image\/[^;]+;base64,[A-Za-z0-9+/=]+/)
            if (b64Match) resultUrl = b64Match[0]
          }
          if (!resultUrl) throw new Error('Chat 生图未返回有效图片')
        } else if (format === 'kling-image' || format === 'kling-omni-image') {
          // Kling 格式 - 支持多参考图
          const klingRes = String(resolution || '').trim().toLowerCase() || String(modelCfg.defaultParams?.quality || '1k')
          const endpoint = format === 'kling-omni-image' ? '/kling/v1/images/omni-image' : modelCfg.endpoint
          const klingPayload: any = {
            model_name: modelCfg.defaultParams?.model_name || (format === 'kling-omni-image' ? 'kling-image-o1' : 'kling-v2-1'),
            prompt: finalPrompt,
            n: 1,
            aspect_ratio: aspectRatio || '16:9',
            resolution: klingRes === '4k' ? '2k' : klingRes
          }
          if (referenceImages.length > 0) {
            if (format === 'kling-omni-image') {
              klingPayload.image_list = referenceImages.map(img => ({ image: img }))
            } else {
              klingPayload.image = referenceImages[0]
            }
          }
          const resp = await postJson<any>(endpoint, klingPayload, { authMode: modelCfg.authMode, timeoutMs: modelCfg.timeout || 240000 })

          const extractUrls = (obj: any): string[] => {
            const urls: string[] = []
            const walk = (o: any, depth = 0) => {
              if (!o || depth > 5) return
              if (typeof o === 'string' && (o.startsWith('http') || o.startsWith('data:'))) {
                urls.push(o)
                return
              }
              if (Array.isArray(o)) {
                o.forEach(i => walk(i, depth + 1))
                return
              }
              if (typeof o === 'object') {
                for (const k of ['url', 'image_url', 'imageUrl', 'output_url']) {
                  if (typeof o[k] === 'string') urls.push(o[k])
                }
                Object.values(o).forEach(v => walk(v, depth + 1))
              }
            }
            walk(obj)
            return urls
          }
          resultUrl = extractUrls(resp)[0] || ''

          if (!resultUrl) {
            const taskId = resp?.data?.task_id || resp?.data?.id || resp?.task_id || resp?.id
            if (!taskId) throw new Error('Kling 生图返回异常：未获取到图片或任务 ID')
            const statusUrl = format === 'kling-omni-image'
              ? `/kling/v1/images/omni-image/${encodeURIComponent(String(taskId))}`
              : `${String(modelCfg.endpoint).replace(/\/$/, '')}/${encodeURIComponent(String(taskId))}`

            for (let i = 0; i < 60; i++) {
              await new Promise(r => setTimeout(r, 3000))
              setRetryMessage(`等待 Kling 生成... (${i + 1}/60)`)
              const statusRes = await postJson<any>(statusUrl, {}, { authMode: modelCfg.authMode, timeoutMs: 30000 })
              resultUrl = extractUrls(statusRes)[0] || ''
              if (resultUrl) break
              const status = String(statusRes?.data?.task_status || statusRes?.task_status || statusRes?.status || '').toLowerCase()
              if (/(fail|error)/i.test(status)) {
                throw new Error(statusRes?.data?.task_status_msg || statusRes?.message || 'Kling 生成失败')
              }
            }
          }
          if (!resultUrl) throw new Error('Kling 生成超时')
        } else if (format === 'doubao-seedream') {
          const finalSize = seedreamSizeByRatioAndResolution(aspectRatio || modelCfg.defaultParams?.size || '3:4', resolution || modelCfg.defaultParams?.quality || '2K')
          const payload: any = {
            model: imageModel,
            prompt: finalPrompt,
            size: finalSize,
            response_format: 'url',
            watermark: false,
            sequential_image_generation: 'disabled'
          }
          const rsp = await postJson<any>(modelCfg.endpoint || '/images/generations', payload, { authMode: modelCfg.authMode, timeoutMs: modelCfg.timeout || 240000 })
          if (rsp?.url) resultUrl = rsp.url
          else if (rsp?.data?.[0]?.url) resultUrl = rsp.data[0].url
          else if (rsp?.data?.[0]?.b64_json) resultUrl = `data:image/png;base64,${rsp.data[0].b64_json}`
          else throw new Error('Seedream 未获取到图片结果')
        } else {
          // OpenAI 兼容格式
          const pickedSize = pickBestSizeKeyForAspect(modelCfg, aspectRatio || '')
          const result = await generateImage({
            model: imageModel,
            prompt: finalPrompt,
            size: pickedSize || aspectRatio
          }, {
            endpoint: modelCfg?.endpoint || '/images/generations',
            authMode: modelCfg?.authMode || 'bearer',
            timeout: modelCfg?.timeout
          })
          if (result?.url) resultUrl = result.url
          else if (result?.data?.[0]?.url) resultUrl = result.data[0].url
          else if (result?.data?.[0]?.b64_json) resultUrl = `data:image/png;base64,${result.data[0].b64_json}`
          else throw new Error('未获取到图片结果')
        }

        return resultUrl
      })

      setGeneratedImageUrl(imageUrl)
      
      // 同步到历史素材
      try {
        useAssetsStore.getState().addAsset({
          type: 'image',
          src: imageUrl,
          title: userPrompt?.slice(0, 50) || '导演台生成',
          model: imageModel
        })
      } catch (e) {
        console.warn('[DirectorConsole] 添加到历史素材失败:', e)
      }
    } catch (err: any) {
      console.error('[DirectorConsole] 生成图片失败:', err)
      setGenerateError(err?.message || '生成失败')
    } finally {
      setIsGeneratingImage(false)
      setRetryMessage(null)
      setRetryCount(0)
    }
  }, [userPrompt, referenceImages, currentPreset, imageModel, aspectRatio, resolution, parsePolishDualLang, polishLang, generateImageWithRetry])

  // 复制润色后的提示词
  const handleCopyPrompt = useCallback(() => {
    const txt = (polishLang === 'zh' ? polishedPromptZh : polishedPromptEn).trim()
    if (txt) {
      navigator.clipboard.writeText(txt)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    }
  }, [polishLang, polishedPromptZh, polishedPromptEn])

  // 旧的分镜生成逻辑（保留）
  const buildStoryboardPrompt = useCallback(() => {
    const count = Math.max(4, Math.min(24, shotCount))

    const parts = [
      '你是电影导演 + 摄影指导 + 分镜师。',
      `任务：把下面剧情拆成 ${count} 个镜头（严格等于 ${count} 条）。`,
      '输出：严格 JSON 数组（字符串数组）。不要 Markdown，不要解释，不要多余字段。',
      '',
      '每个镜头提示词必须包含：',
      '1) 主体/角色：外观固定点 + 动作 + 场景信息',
      '2) 镜头语言：景别、机位、镜头焦段、构图',
      '3) 运镜：camera movement',
      '4) 光影/色彩/材质',
      '5) 抽象审美 + 质量词（4K/ultra detail）',
      '6) Negative: 模糊/水印/文字/畸形',
      '',
      '节奏：前 20% 建立信息 → 中段推进冲突 → 后 20% 爆点/反转收尾',
      '一致性：同一角色外观、服装、发型必须保持一致',
      '',
      '请让每条字符串以 [SHOT i/N] 开头（i 从 1 开始）。',
      '',
      '【剧情】',
      userPrompt.trim()
    ]

    if (styleBible.trim()) {
      parts.push('', '【角色&美术 Bible】', styleBible.trim())
    }

    if (directorNotes.trim()) {
      parts.push('', '【导演备注】', directorNotes.trim())
    }

    parts.push('', `【画幅】Aspect Ratio: ${aspectRatio}`)

    return parts.join('\n')
  }, [userPrompt, styleBible, directorNotes, shotCount, aspectRatio])

  const parseStoryboardResponse = (text: string): string[] | null => {
    const jsonMatch = text.match(/\[[\s\S]*\]/)
    if (!jsonMatch) return null

    try {
      const parsed = JSON.parse(jsonMatch[0])
      if (Array.isArray(parsed) && parsed.every((s) => typeof s === 'string')) {
        return parsed
      }
    } catch {
      return null
    }
    return null
  }

  const handleGenerateStoryboard = async () => {
    if (!userPrompt.trim()) {
      setError('请先填写剧情')
      return
    }

    setError(null)
    setIsGenerating(true)
    setShots([])

    try {
      const prompt = buildStoryboardPrompt()
      let response = ''

      for await (const chunk of streamChatCompletions({
        model: DEFAULT_CHAT_MODEL,
        messages: [
          { role: 'system', content: '你是专业的电影分镜师，擅长将故事拆解为详细的分镜提示词。' },
          { role: 'user', content: prompt }
        ]
      })) {
        response += chunk
      }

      const parsed = parseStoryboardResponse(response)
      if (!parsed || parsed.length === 0) {
        throw new Error('分镜解析失败：模型没有返回有效 JSON 数组')
      }

      setShots(parsed)
      addToHistory({
        storyIdea: userPrompt.trim(),
        styleBible: styleBible.trim(),
        directorNotes: directorNotes.trim(),
        shotCount,
        aspectRatio,
        shots: parsed,
        presetId: selectedPreset
      })
    } catch (err: any) {
      const message = err?.message || '分镜生成失败'
      setError(message)
    } finally {
      setIsGenerating(false)
    }
  }

  // 上板：创建节点
  const handleCreate = () => {
    // 预设模式：生成单图
    if (selectedPreset !== 'none' && generatedImageUrl) {
      const usedPolished = (polishLang === 'zh' ? polishedPromptZh : polishedPromptEn).trim()
      onCreateNodes({
        storyIdea: userPrompt.trim(),
        styleBible: styleBible.trim(),
        directorNotes: directorNotes.trim(),
        shots: [],
        imageModel,
        aspectRatio,
        imageQuality: resolution,
        autoGenerateImages: false,
        singleImageUrl: generatedImageUrl,
        singleImagePrompt: (usedPolished || userPrompt).trim()
      })
      onClose()
      return
    }

    // 分镜模式
    if (shots.length === 0) {
      setError('请先生成分镜')
      return
    }

    onCreateNodes({
      storyIdea: userPrompt.trim(),
      styleBible: styleBible.trim(),
      directorNotes: directorNotes.trim(),
      shots,
      imageModel,
      aspectRatio,
      imageQuality: resolution,
      autoGenerateImages
    })

    onClose()
  }

  // 判断是否是单图预设模式
  const isSingleImageMode = selectedPreset !== 'none'

  if (!open) return null

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div
        className="flex h-[min(88vh,920px)] w-[min(1200px,96vw)] flex-col overflow-hidden rounded-2xl border border-[var(--border-color)] bg-[var(--bg-secondary)] shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-[var(--border-color)] px-5 py-4">
          <div className="flex items-center gap-3">
            <Sparkles className="h-5 w-5 text-[var(--accent-color)]" />
            <h2 className="text-lg font-semibold text-[var(--text-primary)]">导演台</h2>
            
            {/* 预设选择器 */}
            <div className="relative ml-4">
              <button
                onClick={() => setShowPresetDropdown(!showPresetDropdown)}
                className="flex items-center gap-2 rounded-lg border border-[var(--border-color)] bg-[var(--bg-primary)] px-3 py-1.5 text-sm text-[var(--text-primary)] hover:border-[var(--accent-color)] transition-colors"
              >
                <span>{currentPreset.name}</span>
                <ChevronDown className={cn('h-4 w-4 transition-transform', showPresetDropdown && 'rotate-180')} />
              </button>
              
              {showPresetDropdown && (
                <div className="absolute left-0 top-full z-50 mt-1 w-[320px] rounded-lg border border-[var(--border-color)] bg-[var(--bg-secondary)] shadow-xl">
                  <div className="max-h-[400px] overflow-auto p-2">
                    {DIRECTOR_PRESETS.map((preset) => (
                      <button
                        key={preset.id}
                        onClick={() => {
                          setSelectedPreset(preset.id)
                          setShowPresetDropdown(false)
                        }}
                        className={cn(
                          'w-full rounded-lg p-3 text-left transition-colors',
                          selectedPreset === preset.id
                            ? 'bg-[rgb(var(--accent-rgb)/0.2)] text-[var(--accent-color)]'
                            : 'hover:bg-[var(--bg-primary)] text-[var(--text-primary)]'
                        )}
                      >
                        <div className="font-medium text-sm">{preset.name}</div>
                        <div className="text-xs text-[var(--text-secondary)] mt-0.5">{preset.description}</div>
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
          
          <div className="flex items-center gap-2">
            <button
              onClick={() => setShowHistory(!showHistory)}
              className={cn(
                'rounded-full p-1 text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-primary)] hover:text-[var(--text-primary)]',
                showHistory && 'text-[var(--accent-color)]'
              )}
              title="历史记录"
            >
              <Clock className="h-5 w-5" />
            </button>
            <button
              onClick={onClose}
              className="rounded-full p-1 text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-primary)] hover:text-[var(--text-primary)]"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
        </div>

        {/* History Panel */}
        {showHistory && (
          <div className="max-h-[200px] overflow-auto border-b border-[var(--border-color)] bg-[var(--bg-primary)]">
            {history.length === 0 ? (
              <div className="p-4 text-center text-sm text-[var(--text-secondary)]">暂无历史记录</div>
            ) : (
              <div className="space-y-2 p-2">
                <div className="mb-2 flex items-center justify-between px-2">
                  <span className="text-xs text-[var(--text-secondary)]">{history.length} 条记录</span>
                  <button onClick={clearHistory} className="flex items-center gap-1 text-xs text-red-500 hover:underline">
                    <Trash2 className="h-3 w-3" />
                    清空
                  </button>
                </div>
                {history
                  .slice()
                  .reverse()
                  .map((entry, i) => (
                    <div
                      key={entry.timestamp || i}
                      onClick={() => loadFromHistory(entry)}
                      className="cursor-pointer rounded-lg bg-[var(--bg-secondary)] p-3 transition-colors hover:bg-[var(--bg-tertiary)]"
                    >
                      <div className="line-clamp-2 text-xs text-[var(--text-primary)]">{entry.storyIdea}</div>
                      <div className="mt-1 text-[10px] text-[var(--text-secondary)]">
                        {entry.shots?.length || 0} 条分镜 · {new Date(entry.timestamp).toLocaleString()}
                      </div>
                    </div>
                  ))}
              </div>
            )}
          </div>
        )}

        {/* Body */}
        <div className="flex flex-1 gap-4 overflow-hidden p-5">
          {/* 左侧：输入区域 */}
          <div className="flex w-1/2 flex-col gap-4 overflow-auto">
            {/* 参考图上传 */}
            {currentPreset.supportsReferenceImage && (
              <div className="flex flex-col gap-2">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-bold text-[var(--text-primary)]">
                    参考图（可选）
                    {currentPreset.referenceImageGuide && (
                      <span className="ml-2 font-normal text-[var(--text-secondary)]">
                        {currentPreset.referenceImageGuide}
                      </span>
                    )}
                  </label>
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      onClick={() => setShowImagePicker(true)}
                      className="flex items-center gap-1 rounded-lg border border-[var(--border-color)] bg-[var(--bg-primary)] px-2 py-1 text-[11px] text-[var(--text-secondary)] hover:border-[var(--accent-color)] hover:text-[var(--accent-color)] transition-colors"
                      title="从画布或历史选择"
                    >
                      <Layers className="h-3 w-3" />
                      选择素材
                    </button>
                  </div>
                </div>

                {/* 多参考图区域 */}
                <div className="grid grid-cols-4 gap-2">
                  {/* 已添加的参考图 */}
                  {referenceImages.map((img, index) => (
                    <div
                      key={index}
                      className="relative aspect-square rounded-lg border border-[var(--accent-color)] bg-[rgb(var(--accent-rgb)/0.1)] overflow-hidden group"
                    >
                      <img src={img} alt={`参考图 ${index + 1}`} className="h-full w-full object-cover" />
                      <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                        <button
                          onClick={() => removeReferenceImage(index)}
                          className="rounded-full bg-red-500/80 p-1.5 text-white hover:bg-red-500"
                        >
                          <X className="h-4 w-4" />
                        </button>
                      </div>
                      <div className="absolute bottom-1 left-1 rounded bg-black/60 px-1.5 py-0.5 text-[10px] text-white">
                        {index === 0 ? '主图' : `参考${index + 1}`}
                      </div>
                    </div>
                  ))}

                  {/* 添加新图片的槽位（根据模型限制） */}
                  {referenceImages.length < maxRefImages && maxRefImages > 0 && (
                    <div
                      onDragOver={(e) => e.preventDefault()}
                      onDrop={(e) => {
                        setActiveImageSlot(referenceImages.length)
                        handleDrop(e)
                      }}
                      onClick={() => {
                        setActiveImageSlot(referenceImages.length)
                        setShowImagePicker(true)
                      }}
                      className="relative aspect-square rounded-lg border-2 border-dashed border-[var(--border-color)] bg-[var(--bg-primary)] hover:border-[var(--accent-color)] cursor-pointer flex flex-col items-center justify-center gap-1 transition-colors"
                    >
                      <Plus className="h-5 w-5 text-[var(--text-secondary)]" />
                      <span className="text-[10px] text-[var(--text-secondary)]">
                        {referenceImages.length === 0 ? '添加参考图' : '添加更多'}
                      </span>
                    </div>
                  )}
                </div>

                {/* 参考图说明和限制 */}
                <div className="flex items-center justify-between text-[10px] text-[var(--text-secondary)]">
                  {maxRefImages === 0 ? (
                    <span className="text-amber-500">当前模型不支持参考图</span>
                  ) : referenceImages.length > 0 ? (
                    <span>第1张为主参考图，后续为风格/元素参考（{referenceImages.length}/{maxRefImages}）</span>
                  ) : (
                    <span>支持最多 {maxRefImages} 张参考图</span>
                  )}
                  {referenceImages.length > 0 && (
                    <button
                      onClick={clearAllReferenceImages}
                      className="text-red-400 hover:text-red-500"
                    >
                      清空全部
                    </button>
                  )}
                </div>

                {/* 隐藏的文件上传 input */}
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  onChange={handleImageUpload}
                  className="hidden"
                />

                {/* 图片选择器弹窗 */}
                {showImagePicker && (
                  <div
                    className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 backdrop-blur-sm"
                    onClick={(e) => e.target === e.currentTarget && setShowImagePicker(false)}
                  >
                    <div
                      className="flex h-[min(70vh,600px)] w-[min(700px,90vw)] flex-col overflow-hidden rounded-2xl border border-[var(--border-color)] bg-[var(--bg-secondary)] shadow-2xl"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <div className="flex items-center justify-between border-b border-[var(--border-color)] px-5 py-4">
                        <h3 className="text-base font-semibold text-[var(--text-primary)]">选择参考图</h3>
                        <button
                          onClick={() => setShowImagePicker(false)}
                          className="rounded-full p-1 text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-primary)] hover:text-[var(--text-primary)]"
                        >
                          <X className="h-5 w-5" />
                        </button>
                      </div>

                      <div className="flex-1 overflow-auto p-4">
                        {/* 画布图片 */}
                        {canvasImages.length > 0 && (
                          <div className="mb-6">
                            <div className="mb-3 flex items-center gap-2 text-sm font-medium text-[var(--text-primary)]">
                              <Layers className="h-4 w-4 text-[var(--accent-color)]" />
                              画布中的图片
                            </div>
                            <div className="grid grid-cols-4 gap-3">
                              {canvasImages.map((img) => (
                                <button
                                  key={img.id}
                                  onClick={() => handleSelectFromPicker(img.src)}
                                  className="group relative aspect-square overflow-hidden rounded-lg border border-[var(--border-color)] bg-[var(--bg-primary)] hover:border-[var(--accent-color)] transition-colors"
                                >
                                  <img
                                    src={img.src}
                                    alt={img.title}
                                    className="h-full w-full object-cover"
                                  />
                                  <div className="absolute inset-0 flex items-end bg-gradient-to-t from-black/60 to-transparent opacity-0 group-hover:opacity-100 transition-opacity">
                                    <span className="w-full truncate px-2 py-1.5 text-[10px] text-white">
                                      {img.title}
                                    </span>
                                  </div>
                                </button>
                              ))}
                            </div>
                          </div>
                        )}

                        {/* 历史素材 */}
                        {historyImages.length > 0 && (
                          <div>
                            <div className="mb-3 flex items-center gap-2 text-sm font-medium text-[var(--text-primary)]">
                              <History className="h-4 w-4 text-[var(--accent-color)]" />
                              历史素材
                            </div>
                            <div className="grid grid-cols-4 gap-3">
                              {historyImages.map((asset) => (
                                <button
                                  key={asset.id}
                                  onClick={() => handleSelectFromPicker(asset.src)}
                                  className="group relative aspect-square overflow-hidden rounded-lg border border-[var(--border-color)] bg-[var(--bg-primary)] hover:border-[var(--accent-color)] transition-colors"
                                >
                                  <img
                                    src={asset.src}
                                    alt={asset.title || '历史图片'}
                                    className="h-full w-full object-cover"
                                  />
                                  <div className="absolute inset-0 flex items-end bg-gradient-to-t from-black/60 to-transparent opacity-0 group-hover:opacity-100 transition-opacity">
                                    <span className="w-full truncate px-2 py-1.5 text-[10px] text-white">
                                      {asset.title || asset.model || '历史图片'}
                                    </span>
                                  </div>
                                </button>
                              ))}
                            </div>
                          </div>
                        )}

                        {canvasImages.length === 0 && historyImages.length === 0 && (
                          <div className="flex h-full items-center justify-center text-sm text-[var(--text-secondary)]">
                            暂无可选图片，请先在画布中添加图片或生成图片
                          </div>
                        )}
                      </div>

                      <div className="flex justify-end border-t border-[var(--border-color)] p-4">
                        <Button variant="ghost" onClick={() => setShowImagePicker(false)}>
                          取消
                        </Button>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* 提示词输入 */}
            <div className="flex flex-col gap-2">
              <div className="flex items-center justify-between">
                <label className="text-xs font-bold text-[var(--text-primary)]">
                  {isSingleImageMode ? '描述' : '剧情 / 概念'}
                </label>
                <span className="text-[10px] text-[var(--text-secondary)]">{userPrompt.length}/2000</span>
              </div>
              <textarea
                value={userPrompt}
                onChange={(e) => setUserPrompt(e.target.value)}
                className="h-[120px] w-full resize-none rounded-xl border border-[var(--border-color)] bg-[var(--bg-primary)] p-4 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-secondary)] focus:border-[var(--accent-color)] focus:outline-none"
                placeholder={currentPreset.userPromptPlaceholder || '描述你想要生成的内容...'}
                maxLength={2000}
              />
            </div>

            {/* 设置区域 */}
            <div className="grid grid-cols-3 gap-3">
              <div className="flex flex-col gap-2">
                <label className="text-[11px] font-bold uppercase text-[var(--text-secondary)]">画幅</label>
                <select
                  value={aspectRatio}
                  onChange={(e) => setAspectRatio(e.target.value)}
                  className="w-full rounded-lg border border-[var(--border-color)] bg-[var(--bg-primary)] px-3 py-1.5 text-sm text-[var(--text-primary)] focus:border-[var(--accent-color)] focus:outline-none"
                >
                  {getAspectRatioOptions().map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              </div>
              <div className="flex flex-col gap-2">
                <label className="text-[11px] font-bold uppercase text-[var(--text-secondary)]">图片模型</label>
                <select
                  value={imageModel}
                  onChange={(e) => setImageModel(e.target.value)}
                  className="w-full rounded-lg border border-[var(--border-color)] bg-[var(--bg-primary)] px-3 py-1.5 text-sm text-[var(--text-primary)] focus:border-[var(--accent-color)] focus:outline-none"
                >
                  {imageModelOptions.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              </div>
              
              {!isSingleImageMode && (
                <div className="flex flex-col gap-2">
                  <label className="text-[11px] font-bold uppercase text-[var(--text-secondary)]">镜头数</label>
                  <input
                    type="number"
                    value={shotCount}
                    onChange={(e) => setShotCount(Math.max(4, Math.min(24, parseInt(e.target.value) || 10)))}
                    min={4}
                    max={24}
                    className="w-full rounded-lg border border-[var(--border-color)] bg-[var(--bg-primary)] px-3 py-1.5 text-sm text-[var(--text-primary)] focus:border-[var(--accent-color)] focus:outline-none"
                  />
                </div>
              )}
              
              {isSingleImageMode && (
                <div className="flex flex-col gap-2">
                  <label className="text-[11px] font-bold uppercase text-[var(--text-secondary)]">分辨率</label>
                  <select
                    value={resolution}
                    onChange={(e) => setResolution(e.target.value as '1K' | '2K' | '4K')}
                    className="w-full rounded-lg border border-[var(--border-color)] bg-[var(--bg-primary)] px-3 py-1.5 text-sm text-[var(--text-primary)] focus:border-[var(--accent-color)] focus:outline-none"
                  >
                    <option value="1K">1K (1024px)</option>
                    <option value="2K">2K (2048px)</option>
                    <option value="4K">4K (4096px)</option>
                  </select>
                </div>
              )}
            </div>

            {/* 分镜模式额外选项 */}
            {!isSingleImageMode && (
              <div className="grid grid-cols-2 gap-4">
                <div className="flex flex-col gap-2">
                  <label className="text-xs font-bold text-[var(--text-primary)]">角色&美术 Bible（可选）</label>
                  <textarea
                    value={styleBible}
                    onChange={(e) => setStyleBible(e.target.value)}
                    className="h-[80px] w-full resize-none rounded-xl border border-[var(--border-color)] bg-[var(--bg-primary)] p-3 text-xs text-[var(--text-primary)] placeholder:text-[var(--text-secondary)] focus:border-[var(--accent-color)] focus:outline-none"
                    placeholder="固定点：发型/服装/配饰/体型/色板；画风：国漫厚涂/赛璐璐/写实…"
                    maxLength={1000}
                  />
                </div>
                <div className="flex flex-col gap-2">
                  <label className="text-xs font-bold text-[var(--text-primary)]">导演备注（可选）</label>
                  <textarea
                    value={directorNotes}
                    onChange={(e) => setDirectorNotes(e.target.value)}
                    className="h-[80px] w-full resize-none rounded-xl border border-[var(--border-color)] bg-[var(--bg-primary)] p-3 text-xs text-[var(--text-primary)] placeholder:text-[var(--text-secondary)] focus:border-[var(--accent-color)] focus:outline-none"
                    placeholder="情绪线/节奏点/镜头语言偏好…"
                    maxLength={1000}
                  />
                </div>
              </div>
            )}

            {/* 操作按钮 */}
            <div className="flex items-center gap-3">
              {isSingleImageMode ? (
                <>
                  <Button
                    variant="secondary"
                    onClick={handlePolish}
                    disabled={!userPrompt.trim() || isPolishing}
                    className="flex-1"
                  >
                    {isPolishing ? (
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    ) : (
                      <Wand2 className="mr-2 h-4 w-4" />
                    )}
                    {isPolishing ? 'AI 润色中...' : 'AI 润色提示词'}
                  </Button>
                  <Button
                    onClick={handlePolishAndGenerate}
                    disabled={!userPrompt.trim() || isPolishing || isGeneratingImage}
                    className="flex-1"
                  >
                    {(isPolishing || isGeneratingImage) ? (
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    ) : (
                      <ImageIcon className="mr-2 h-4 w-4" />
                    )}
                    {isPolishing ? '润色中...' : isGeneratingImage ? (retryCount > 1 ? `重试中 (${retryCount}/${MAX_RETRIES})...` : '生成中...') : '一键生成'}
                  </Button>
                </>
              ) : (
                <>
                  <Button
                    variant="secondary"
                    onClick={handleGenerateStoryboard}
                    disabled={!userPrompt.trim() || isGenerating}
                    className="flex-1"
                  >
                    <Sparkles className="mr-2 h-4 w-4" />
                    {isGenerating ? '生成中...' : '生成分镜'}
                  </Button>
                  <div className="flex items-center gap-2">
                    <label className="text-[11px] text-[var(--text-secondary)]">自动出图</label>
                    <button
                      onClick={() => setAutoGenerateImages(!autoGenerateImages)}
                      className={cn(
                        'rounded-lg border px-3 py-1 text-xs font-bold transition-colors',
                        autoGenerateImages
                          ? 'border-[rgb(var(--accent-rgb)/0.3)] bg-[rgb(var(--accent-rgb)/0.2)] text-[var(--accent-color)]'
                          : 'border-[var(--border-color)] bg-[var(--bg-primary)] text-[var(--text-secondary)]'
                      )}
                    >
                      {autoGenerateImages ? 'ON' : 'OFF'}
                    </button>
                  </div>
                </>
              )}
            </div>

            {/* 错误提示 */}
            {(polishError || generateError || error) && (
              <div className="rounded-lg bg-red-500/10 px-4 py-2 text-xs text-red-500">
                {polishError || generateError || error}
              </div>
            )}
          </div>

          {/* 右侧：输出区域 */}
          <div className="flex w-1/2 flex-col gap-4 overflow-auto">
            {isSingleImageMode ? (
              <>
                {/* 润色后的提示词 */}
                <div className="flex flex-col gap-2">
                  <div className="flex items-center justify-between">
                    <label className="text-xs font-bold text-[var(--text-primary)]">AI 润色提示词</label>
                    <div className="flex items-center gap-2">
                      <div className="flex overflow-hidden rounded-full border border-[var(--border-color)] bg-[var(--bg-primary)]">
                        <button
                          type="button"
                          onClick={() => setPolishLang('zh')}
                          className={cn(
                            'px-2 py-1 text-[11px] transition-colors',
                            polishLang === 'zh'
                              ? 'bg-[rgb(var(--accent-rgb)/0.2)] text-[var(--accent-color)]'
                              : 'text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)]'
                          )}
                        >
                          中文
                        </button>
                        <button
                          type="button"
                          onClick={() => setPolishLang('en')}
                          className={cn(
                            'px-2 py-1 text-[11px] transition-colors',
                            polishLang === 'en'
                              ? 'bg-[rgb(var(--accent-rgb)/0.2)] text-[var(--accent-color)]'
                              : 'text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)]'
                          )}
                        >
                          English
                        </button>
                      </div>
                      {!!(polishLang === 'zh' ? polishedPromptZh.trim() : polishedPromptEn.trim()) && (
                        <button
                          onClick={handleCopyPrompt}
                          className="flex items-center gap-1 text-xs text-[var(--accent-color)] hover:underline"
                          type="button"
                        >
                          {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
                          {copied ? '已复制' : '复制'}
                        </button>
                      )}
                    </div>
                  </div>
                  <div className="h-[200px] overflow-auto rounded-xl border border-[var(--border-color)] bg-[var(--bg-primary)] p-4">
                    {(polishLang === 'zh' ? polishedPromptZh.trim() : polishedPromptEn.trim()) ? (
                      <pre className="whitespace-pre-wrap text-xs text-[var(--text-primary)] font-mono leading-relaxed">
                        {polishLang === 'zh' ? polishedPromptZh : polishedPromptEn}
                      </pre>
                    ) : (
                      <div className="flex h-full items-center justify-center text-sm text-[var(--text-secondary)]">
                        {isPolishing ? '正在润色...' : '点击「AI 润色提示词」开始'}
                      </div>
                    )}
                  </div>
                </div>

                {/* 生成的图片 */}
                <div className="flex flex-1 flex-col gap-2">
                  <label className="text-xs font-bold text-[var(--text-primary)]">生成结果</label>
                  <div className="flex-1 overflow-auto rounded-xl border border-[var(--border-color)] bg-[var(--bg-primary)] p-4">
                    {generatedImageUrl ? (
                      <div className="relative">
                        <img
                          src={generatedImageUrl}
                          alt="Generated"
                          className="w-full rounded-lg"
                        />
                      </div>
                    ) : (
                      <div className="flex h-full min-h-[200px] items-center justify-center text-sm text-[var(--text-secondary)]">
                        {isGeneratingImage ? (
                          <div className="flex flex-col items-center gap-3">
                            <Loader2 className="h-8 w-8 animate-spin text-[var(--accent-color)]" />
                            <span>{retryMessage || '正在生成图片...'}</span>
                            {retryCount > 1 && (
                              <span className="text-[11px] text-[var(--text-secondary)]">
                                已尝试 {retryCount}/{MAX_RETRIES} 次
                              </span>
                            )}
                          </div>
                        ) : (
                          '点击「生成图片」开始'
                        )}
                      </div>
                    )}
                  </div>
                </div>
              </>
            ) : (
              /* 分镜输出 */
              <div className="flex flex-1 flex-col gap-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-[var(--text-primary)]">分镜输出</span>
                  {shots.length > 0 && (
                    <span className="text-[11px] text-[var(--text-secondary)]">{shots.length} 条</span>
                  )}
                </div>
                <div className="flex-1 overflow-auto rounded-xl border border-[var(--border-color)] bg-[var(--bg-primary)] p-4">
                  {shots.length === 0 ? (
                    <div className="flex h-full min-h-[300px] items-center justify-center text-sm text-[var(--text-secondary)]">
                      点击「生成分镜」开始
                    </div>
                  ) : (
                    <div className="space-y-3">
                      {shots.map((shot, i) => (
                        <div key={i} className="text-xs text-[var(--text-primary)]">
                          <div className="mb-1 text-[10px] text-[var(--text-secondary)]">#{i + 1}</div>
                          <div className="leading-relaxed">{shot}</div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-3 border-t border-[var(--border-color)] p-4">
          <Button variant="ghost" onClick={onClose}>
            取消
          </Button>
          <Button
            onClick={handleCreate}
            disabled={isSingleImageMode ? !generatedImageUrl : shots.length === 0}
          >
            <Plus className="mr-1 h-4 w-4" />
            上板
          </Button>
        </div>
      </div>
    </div>
  )
}
