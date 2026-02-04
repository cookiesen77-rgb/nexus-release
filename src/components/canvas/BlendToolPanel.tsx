/**
 * Blend Tool Panel | 图像融合工具面板
 * 支持本地融合和 AI 融合 (Gemini/Kling)
 */

import React, { useState, useRef, useCallback, useEffect, useMemo } from 'react'
import { X, Upload, Wand2, Plus, AlertCircle, ImageIcon, Sparkles, Loader2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useGraphStore } from '@/graph/store'
import type { GraphNode } from '@/graph/types'
import { useAssetsStore } from '@/store/assets'
import { postJson } from '@/lib/workflow/request'
import { chatCompletions } from '@/lib/nexusApi'

interface Props {
  open: boolean
  onClose: () => void
  onAddToCanvas?: (imageData: string, fileName: string) => void
}

const MAX_FILE_SIZE = 50 * 1024 * 1024

const getImageUrl = (node: GraphNode): string => {
  const d = node.data as any
  return d?.url || d?.base64 || d?.src || d?.displayUrl || ''
}

const isValidUrl = (url: unknown): url is string => {
  if (typeof url !== 'string' || !url.trim()) return false
  return url.startsWith('data:') || url.startsWith('blob:') || url.startsWith('http') || url.startsWith('asset://')
}

// 提取 base64 数据
const extractBase64 = (input: string): string => {
  if (input.startsWith('data:image')) {
    const match = input.match(/^data:image\/\w+;base64,(.+)$/)
    return match?.[1] || ''
  }
  return input
}

// 下载图片为 base64
const downloadImageAsBase64 = async (url: string): Promise<string> => {
  const response = await fetch(url)
  const blob = await response.blob()
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result || ''))
    reader.onerror = () => reject(new Error('下载图片失败'))
    reader.readAsDataURL(blob)
  })
}

// 将图片 URL 转为 base64（如果需要）
const ensureBase64 = async (url: string): Promise<string> => {
  if (url.startsWith('data:')) return url
  if (url.startsWith('http')) {
    return await downloadImageAsBase64(url)
  }
  return url
}

// AI 分析图片内容
const analyzeImages = async (imageA: string, imageB: string): Promise<{ descA: string; descB: string }> => {
  const base64A = extractBase64(await ensureBase64(imageA))
  const base64B = extractBase64(await ensureBase64(imageB))

  const analyzePrompt = `Analyze this image for AI image fusion. Be precise and detailed. Output in English:

**CHARACTERS/SUBJECTS**:
- Main subject identity (person name if recognizable, or detailed description)
- Facial features: face shape, skin tone, eye color, hairstyle
- Expression and emotion
- Clothing details (color, style, texture)
- Body pose and gesture

**SCENE/BACKGROUND**:
- Location type (indoor/outdoor, specific setting)
- Key background elements and their positions
- Atmosphere and mood

**TECHNICAL**:
- Art style (photorealistic/illustration/anime/3D render)
- Lighting direction and quality (soft/hard, warm/cool)
- Color palette and dominant colors
- Camera angle and framing

Be extremely specific about identifiable features. Max 100 words.`

  const [resultA, resultB] = await Promise.all([
    chatCompletions({
      model: 'gpt-4o',
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: analyzePrompt },
            { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${base64A}` } }
          ]
        }
      ]
    }),
    chatCompletions({
      model: 'gpt-4o',
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: analyzePrompt },
            { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${base64B}` } }
          ]
        }
      ]
    })
  ])

  return { descA: resultA.trim(), descB: resultB.trim() }
}

// AI 优化提示词（基于图片分析和用户需求）
const optimizePromptWithAI = async (
  userRequirement: string,
  imageAnalysis: { descA: string; descB: string },
  method: 'gemini' | 'kling'
): Promise<string> => {
  const systemPrompt = `You are an expert AI image fusion specialist. Your job is to DEEPLY UNDERSTAND the user's intent and generate a precise fusion prompt.

## CRITICAL RULES:

### 1. UNDERSTAND USER INTENT FIRST
- Parse what the user ACTUALLY wants (not what you assume)
- If user says "combine faces" → they want facial features merged
- If user says "put person in scene" → they want subject placement, NOT facial merge
- If user says "same style" → they want style transfer
- If user says "双重曝光/double exposure" → specific artistic effect

### 2. CHARACTER CONSISTENCY IS PARAMOUNT
When the user wants to preserve a character:
- KEEP exact facial features: face shape, eye shape, nose, lips, skin tone
- KEEP exact hairstyle: color, length, texture
- KEEP exact clothing if visible
- DO NOT blend faces unless explicitly requested
- Use phrases like "maintain exact likeness", "preserve facial identity"

### 3. SCENE CONSISTENCY
When combining scenes:
- Unify lighting direction (choose one source)
- Match color temperature across elements
- Ensure perspective consistency
- Natural shadow integration

### 4. OUTPUT FORMAT
Generate a SINGLE cohesive prompt (no section labels) that includes:
- Clear subject description with identifying features
- Scene/background specification
- Style and quality requirements
- Specific fusion instructions

${method === 'gemini' ?
  'For Gemini: Use natural language, emphasize photorealism and seamless integration. Include: "highly detailed, natural lighting, seamless blend"' :
  'For Kling: Emphasize cinematic quality. Include: "masterpiece, 8k, professional photography, perfect composition"'}

Length: 100-150 words. Output ONLY the prompt, no explanations.`

  const userContent = `## Image A Analysis:
${imageAnalysis.descA}

## Image B Analysis:
${imageAnalysis.descB}

## User's Fusion Request (UNDERSTAND THIS CAREFULLY):
"${userRequirement}"

Think step by step:
1. What does the user REALLY want to achieve?
2. Which elements should be preserved exactly as they are?
3. Which elements should be blended or replaced?
4. What is the desired final outcome?

Generate the fusion prompt:`

  const result = await chatCompletions({
    model: 'gpt-4o',
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userContent }
    ]
  })

  return result.trim()
}

// Gemini 融合
const blendWithGemini = async (
  imageA: string,
  imageB: string,
  prompt: string,
  onProgress: (msg: string) => void
): Promise<string> => {
  onProgress('正在调用 Gemini AI...')

  const base64A = extractBase64(await ensureBase64(imageA))
  const base64B = extractBase64(await ensureBase64(imageB))

  const fullPrompt = `Generate ONE fusion image based on these two reference images. Output ONLY the image.

FUSION REQUIREMENTS:
${prompt}

CRITICAL RULES:
1. CHARACTER CONSISTENCY: If preserving a person, maintain EXACT facial features - face shape, eyes, nose, lips, skin tone, hairstyle
2. SCENE HARMONY: Unify lighting direction and color temperature across all elements
3. NATURAL INTEGRATION: Create seamless transitions, no visible seams or artifacts
4. HIGH QUALITY: Maintain sharp details, proper exposure, professional finish

DO NOT output any text explanation. Generate ONLY the blended image.`

  const response = await postJson<any>(
    '/v1beta/models/gemini-3-pro-image-preview:generateContent',
    {
      contents: [{
        role: 'user',
        parts: [
          { text: fullPrompt },
          { inline_data: { mime_type: 'image/jpeg', data: base64A } },
          { inline_data: { mime_type: 'image/jpeg', data: base64B } }
        ]
      }],
      generationConfig: {
        responseModalities: ['IMAGE'],
        imageConfig: {
          aspectRatio: '3:4',
          imageSize: '2K'
        }
      }
    },
    { authMode: 'query', timeoutMs: 240000 }
  )

  const parts = response?.candidates?.[0]?.content?.parts || []
  const inlineData = parts.find((p: any) => p.inlineData || p.inline_data)
  const data = inlineData?.inlineData?.data || inlineData?.inline_data?.data

  if (!data) {
    const textPart = parts.find((p: any) => p.text)?.text
    if (textPart) {
      const urlMatch = textPart.match(/https?:\/\/\S+/i)
      if (urlMatch) {
        return await downloadImageAsBase64(urlMatch[0])
      }
    }
    throw new Error('Gemini 未返回图像，请重试或调整提示词')
  }

  return `data:image/png;base64,${data}`
}

// Kling 融合（使用 omni-image 支持多图）
const blendWithKling = async (
  imageA: string,
  imageB: string,
  prompt: string,
  onProgress: (msg: string) => void
): Promise<string> => {
  onProgress('正在调用 Kling AI...')

  // 确保图片是 base64 格式
  const imgA = await ensureBase64(imageA)
  const imgB = await ensureBase64(imageB)

  const fullPrompt = `${prompt}

FUSION TASK: Blend these two reference images into ONE cohesive masterpiece.
CRITICAL - CHARACTER CONSISTENCY: If a person is present, preserve EXACT facial features (face shape, eyes, nose, lips, skin tone), hairstyle, and clothing.
CRITICAL - SCENE HARMONY: Unify lighting direction, color temperature, and atmosphere.
QUALITY: masterpiece, 8k resolution, professional photography, perfect composition, highly detailed.`

  // 使用 kling-omni-image 端点，支持多张参考图
  const response = await postJson<any>(
    '/kling/v1/images/omni-image',
    {
      model_name: 'kling-image-o1',
      prompt: fullPrompt,
      n: 1,
      aspect_ratio: '3:4',
      resolution: '2k',
      image_list: [
        { image: imgA },
        { image: imgB }
      ]
    },
    { authMode: 'bearer', timeoutMs: 240000 }
  )

  // 尝试直接获取结果
  let imageUrl = ''
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

  imageUrl = extractUrls(response)[0] || ''

  if (!imageUrl) {
    // 需要轮询任务
    const taskId = response?.data?.task_id || response?.data?.id || response?.task_id || response?.id
    if (!taskId) throw new Error('Kling 生图返回异常：未获取到图片或任务 ID')

    onProgress('等待 Kling 生成结果...')
    const statusUrl = `/kling/v1/images/omni-image/${encodeURIComponent(String(taskId))}`

    for (let i = 0; i < 60; i++) {
      await new Promise(r => setTimeout(r, 3000))
      const statusRes = await postJson<any>(statusUrl, {}, { authMode: 'bearer', timeoutMs: 30000 })

      imageUrl = extractUrls(statusRes)[0] || ''
      if (imageUrl) break

      const status = String(statusRes?.data?.task_status || statusRes?.task_status || statusRes?.status || '').toLowerCase()
      if (/(fail|error)/i.test(status)) {
        throw new Error(statusRes?.data?.task_status_msg || statusRes?.message || 'Kling 生成失败')
      }
      onProgress(`等待 Kling 生成... (${i + 1}/60)`)
    }
  }

  if (!imageUrl) throw new Error('Kling 生成超时')

  // 如果是 HTTP URL，下载为 base64
  if (imageUrl.startsWith('http')) {
    return await downloadImageAsBase64(imageUrl)
  }
  return imageUrl
}

export default function BlendToolPanel({ open, onClose, onAddToCanvas }: Props) {
  const [imageA, setImageA] = useState<string | null>(null)
  const [imageB, setImageB] = useState<string | null>(null)
  const [selectingFor, setSelectingFor] = useState<'A' | 'B'>('A')
  const [method, setMethod] = useState<'laplacian' | 'enhanced' | 'gemini' | 'kling'>('laplacian')
  const [blendResult, setBlendResult] = useState<string | null>(null)
  const [isProcessing, setIsProcessing] = useState(false)
  const [alpha, setAlpha] = useState(0.5)
  const [tab, setTab] = useState<'canvas' | 'history' | 'upload'>('canvas')
  const [error, setError] = useState<string | null>(null)
  const [userPrompt, setUserPrompt] = useState('')
  const [optimizedPrompt, setOptimizedPrompt] = useState('')
  const [imageAnalysis, setImageAnalysis] = useState<{ descA: string; descB: string } | null>(null)
  const [progressMsg, setProgressMsg] = useState('')

  // 重试和取消机制
  const [retryCount, setRetryCount] = useState(0)
  const [retryMessage, setRetryMessage] = useState<string | null>(null)
  const abortControllerRef = useRef<AbortController | null>(null)
  const MAX_RETRIES = 3

  const fileInputRef = useRef<HTMLInputElement>(null)
  const store = useGraphStore()
  const assetsStore = useAssetsStore()

  const canvasImages = useMemo(() => {
    return (store?.nodes || []).filter((n) => n.type === 'image' && isValidUrl(getImageUrl(n)))
  }, [store?.nodes])

  const historyAssets = useMemo(() => {
    return (assetsStore?.assets || []).filter((a) => a.type === 'image' && isValidUrl(a.src))
  }, [assetsStore?.assets])

  const resetState = useCallback(() => {
    setImageA(null)
    setImageB(null)
    setBlendResult(null)
    setError(null)
    setSelectingFor('A')
    setUserPrompt('')
    setOptimizedPrompt('')
    setImageAnalysis(null)
    setProgressMsg('')
    setRetryCount(0)
    setRetryMessage(null)
    // 取消正在进行的请求
    if (abortControllerRef.current) {
      abortControllerRef.current.abort()
      abortControllerRef.current = null
    }
  }, [])

  useEffect(() => {
    return () => resetState()
  }, [resetState])

  const handleFileUpload = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    setError(null)
    const file = e.target.files?.[0]
    if (!file) return

    if (file.size > MAX_FILE_SIZE) {
      setError(`文件过大 (${(file.size / 1024 / 1024).toFixed(1)}MB > 50MB)`)
      return
    }

    const reader = new FileReader()
    reader.onerror = () => setError('文件读取失败')
    reader.onload = (event) => {
      const base64 = event.target?.result as string
      if (!base64?.startsWith('data:')) {
        setError('文件格式无效')
        return
      }
      if (selectingFor === 'A') {
        setImageA(base64)
        setSelectingFor('B')
      } else {
        setImageB(base64)
      }
    }
    reader.readAsDataURL(file)
    e.target.value = ''
  }, [selectingFor])

  const handleSelectCanvasImage = useCallback((nodeId: string) => {
    const node = canvasImages.find((n) => n.id === nodeId)
    if (!node) return

    const url = getImageUrl(node)
    if (!isValidUrl(url)) {
      setError('图像数据无效')
      return
    }

    if (selectingFor === 'A') {
      setImageA(url)
      setSelectingFor('B')
    } else {
      setImageB(url)
    }
    setError(null)
  }, [canvasImages, selectingFor])

  const handleSelectHistoryAsset = useCallback((assetId: string) => {
    const asset = historyAssets.find((a) => a.id === assetId)
    if (!asset?.src) {
      setError('素材数据无效')
      return
    }

    if (selectingFor === 'A') {
      setImageA(asset.src)
      setSelectingFor('B')
    } else {
      setImageB(asset.src)
    }
    setError(null)
  }, [historyAssets, selectingFor])

  // 本地融合
  const blendLocal = useCallback(async (imgA: string, imgB: string, alphaVal: number): Promise<string> => {
    return new Promise((resolve, reject) => {
      const canvas = document.createElement('canvas')
      const ctx = canvas.getContext('2d')
      if (!ctx) {
        reject(new Error('Canvas 不可用'))
        return
      }

      let loadedCount = 0
      const imgElA = new Image()
      const imgElB = new Image()
      imgElA.crossOrigin = 'anonymous'
      imgElB.crossOrigin = 'anonymous'

      const onBothLoaded = () => {
        const w = Math.max(imgElA.width, imgElB.width)
        const h = Math.max(imgElA.height, imgElB.height)
        canvas.width = w
        canvas.height = h

        ctx.globalAlpha = alphaVal
        ctx.drawImage(imgElA, 0, 0, w, h)
        ctx.globalAlpha = 1 - alphaVal
        ctx.drawImage(imgElB, 0, 0, w, h)

        resolve(canvas.toDataURL('image/png'))
      }

      imgElA.onload = () => { loadedCount++; if (loadedCount === 2) onBothLoaded() }
      imgElB.onload = () => { loadedCount++; if (loadedCount === 2) onBothLoaded() }
      imgElA.onerror = () => reject(new Error('图像 A 加载失败'))
      imgElB.onerror = () => reject(new Error('图像 B 加载失败'))

      imgElA.src = imgA
      imgElB.src = imgB
    })
  }, [])

  // 取消当前请求
  const handleAbort = useCallback(() => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort()
      abortControllerRef.current = null
    }
    setIsProcessing(false)
    setProgressMsg('')
    setRetryMessage(null)
    setRetryCount(0)
    setError('已取消')
  }, [])

  // 执行融合（带重试机制）
  const handleBlend = useCallback(async () => {
    if (!imageA || !imageB) {
      setError('请选择两张图像')
      return
    }

    // AI 模式需要用户输入需求
    if ((method === 'gemini' || method === 'kling') && !userPrompt.trim()) {
      setError('请输入融合需求描述')
      return
    }

    // 创建新的 AbortController
    abortControllerRef.current = new AbortController()

    setIsProcessing(true)
    setError(null)
    setProgressMsg('')
    setOptimizedPrompt('')
    setImageAnalysis(null)
    setRetryCount(0)
    setRetryMessage(null)

    // 定义生成函数（可重试）
    const generateFn = async (attempt: number): Promise<string> => {
      // 检查是否已取消
      if (abortControllerRef.current?.signal.aborted) {
        throw new Error('已取消')
      }

      if (method === 'laplacian' || method === 'enhanced') {
        setProgressMsg('本地融合中...')
        return await blendLocal(imageA, imageB, alpha)
      }

      // AI 融合模式
      // Step 1: 分析两张图片（仅首次尝试时分析）
      let analysis = imageAnalysis
      if (!analysis) {
        setProgressMsg('AI 正在分析两张图片...')
        analysis = await analyzeImages(imageA, imageB)
        setImageAnalysis(analysis)
        console.log('[BlendPanel] 图片分析结果:', analysis)
      }

      // 检查是否已取消
      if (abortControllerRef.current?.signal.aborted) {
        throw new Error('已取消')
      }

      // Step 2: 基于分析结果优化提示词（仅首次尝试时优化）
      let optimized = optimizedPrompt
      if (!optimized) {
        setProgressMsg('AI 正在优化提示词...')
        optimized = await optimizePromptWithAI(userPrompt, analysis, method)
        setOptimizedPrompt(optimized)
        console.log('[BlendPanel] 优化后的提示词:', optimized)
      }

      // 检查是否已取消
      if (abortControllerRef.current?.signal.aborted) {
        throw new Error('已取消')
      }

      // Step 3: 调用生图 AI
      if (method === 'gemini') {
        return await blendWithGemini(imageA, imageB, optimized, setProgressMsg)
      } else {
        return await blendWithKling(imageA, imageB, optimized, setProgressMsg)
      }
    }

    // 带重试的执行
    let lastError: Error | null = null
    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      try {
        setRetryCount(attempt)
        if (attempt > 1) {
          setRetryMessage(`第 ${attempt}/${MAX_RETRIES} 次尝试...`)
        }

        const result = await generateFn(attempt)

        // 成功 - 保存结果并添加到历史素材
        setBlendResult(result)
        setProgressMsg('')
        setRetryMessage(null)
        setRetryCount(0)

        // 自动保存到历史素材
        assetsStore.addAsset({
          type: 'image',
          src: result,
          title: `融合图片 ${new Date().toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}`,
          model: method === 'gemini' ? 'gemini-blend' : method === 'kling' ? 'kling-blend' : 'local-blend'
        })

        return
      } catch (err: any) {
        lastError = err

        // 如果是用户取消，不重试
        if (err?.message === '已取消' || abortControllerRef.current?.signal.aborted) {
          setError('已取消')
          break
        }

        console.warn(`[BlendPanel] 尝试 ${attempt}/${MAX_RETRIES} 失败:`, err?.message)

        if (attempt < MAX_RETRIES) {
          // 指数退避：2s, 4s, 8s
          const waitMs = Math.min(2000 * Math.pow(2, attempt - 1), 10000)
          setRetryMessage(`生成失败，${Math.round(waitMs / 1000)}秒后重试 (${attempt}/${MAX_RETRIES})...`)
          setError(null) // 清除错误，显示重试消息

          // 等待时检查是否取消
          await new Promise<void>((resolve) => {
            const timeout = setTimeout(resolve, waitMs)
            const checkAbort = () => {
              if (abortControllerRef.current?.signal.aborted) {
                clearTimeout(timeout)
                resolve()
              }
            }
            const interval = setInterval(checkAbort, 100)
            setTimeout(() => {
              clearInterval(interval)
              resolve()
            }, waitMs)
          })

          if (abortControllerRef.current?.signal.aborted) {
            setError('已取消')
            break
          }
        }
      }
    }

    // 所有重试都失败
    if (lastError && lastError.message !== '已取消') {
      setError(lastError.message || '融合失败')
    }
    setRetryMessage(null)
    setRetryCount(0)
    setIsProcessing(false)
  }, [imageA, imageB, method, alpha, userPrompt, blendLocal, imageAnalysis, optimizedPrompt, assetsStore])

  const handleAddToCanvas = useCallback(() => {
    if (!blendResult) return
    onAddToCanvas?.(blendResult, `blend-${Date.now()}.png`)
    resetState()
    onClose()
  }, [blendResult, onAddToCanvas, resetState, onClose])

  if (!open) return null

  const hasResult = !!blendResult
  const isAIMethod = method === 'gemini' || method === 'kling'
  const canBlend = !!imageA && !!imageB && !isProcessing && (!isAIMethod || userPrompt.trim())

  return (
    <div className="fixed bottom-4 right-4 z-40 w-[440px] rounded-2xl border border-[var(--border-color)] bg-[var(--bg-secondary)] shadow-2xl">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-[var(--border-color)] p-4">
        <div className="flex items-center gap-2">
          <Wand2 className="h-5 w-5 text-[var(--accent-color)]" />
          <h3 className="font-semibold text-[var(--text-primary)]">图像融合</h3>
        </div>
        <button onClick={onClose} className="rounded-full p-1 text-[var(--text-secondary)] hover:bg-[var(--bg-primary)]">
          <X className="h-5 w-5" />
        </button>
      </div>

      {/* Error */}
      {error && (
        <div className="border-b border-red-500/30 bg-red-900/20 p-3 flex gap-2 items-start justify-between">
          <div className="flex gap-2 items-start">
            <AlertCircle className="h-4 w-4 text-red-500 flex-shrink-0 mt-0.5" />
            <p className="text-xs text-red-400">{error}</p>
          </div>
          {error !== '已取消' && (
            <button
              onClick={handleBlend}
              className="text-xs text-red-400 hover:text-red-300 underline flex-shrink-0"
            >
              重试
            </button>
          )}
        </div>
      )}

      {/* Progress with Retry/Abort */}
      {isProcessing && (
        <div className="border-b border-[var(--accent-color)]/30 bg-[var(--accent-color)]/10 p-3 flex gap-2 items-center justify-between">
          <div className="flex gap-2 items-center flex-1 min-w-0">
            <Loader2 className="h-4 w-4 text-[var(--accent-color)] animate-spin flex-shrink-0" />
            <div className="flex-1 min-w-0">
              <p className="text-xs text-[var(--accent-color)] truncate">{retryMessage || progressMsg}</p>
              {retryCount > 1 && (
                <p className="text-[10px] text-[var(--text-secondary)]">尝试 {retryCount}/{MAX_RETRIES}</p>
              )}
            </div>
          </div>
          <button
            onClick={handleAbort}
            className="text-xs text-red-400 hover:text-red-300 px-2 py-1 rounded border border-red-400/30 hover:bg-red-400/10 flex-shrink-0"
          >
            取消
          </button>
        </div>
      )}

      <div className="p-4 max-h-[650px] overflow-auto">
        {!hasResult ? (
          <div className="space-y-4">
            {/* 已选图像预览 */}
            <div className="grid grid-cols-2 gap-3">
              <div
                onClick={() => setSelectingFor('A')}
                className={cn(
                  'aspect-video rounded-lg border-2 border-dashed flex items-center justify-center cursor-pointer overflow-hidden',
                  selectingFor === 'A' ? 'border-[var(--accent-color)]' : 'border-[var(--border-color)]',
                  imageA ? 'border-solid' : ''
                )}
              >
                {imageA ? (
                  <div className="relative w-full h-full">
                    <img src={imageA} alt="A" className="w-full h-full object-cover" />
                    <button
                      onClick={(e) => { e.stopPropagation(); setImageA(null); setSelectingFor('A') }}
                      className="absolute top-1 right-1 bg-black/60 text-white p-1 rounded"
                    >
                      <X className="h-3 w-3" />
                    </button>
                    <div className="absolute bottom-1 left-1 bg-black/60 text-white text-xs px-1 rounded">A</div>
                  </div>
                ) : (
                  <div className="text-center p-2">
                    <ImageIcon className="h-6 w-6 mx-auto text-[var(--text-secondary)] mb-1" />
                    <span className="text-xs text-[var(--text-secondary)]">图像 A</span>
                  </div>
                )}
              </div>

              <div
                onClick={() => setSelectingFor('B')}
                className={cn(
                  'aspect-video rounded-lg border-2 border-dashed flex items-center justify-center cursor-pointer overflow-hidden',
                  selectingFor === 'B' ? 'border-[var(--accent-color)]' : 'border-[var(--border-color)]',
                  imageB ? 'border-solid' : ''
                )}
              >
                {imageB ? (
                  <div className="relative w-full h-full">
                    <img src={imageB} alt="B" className="w-full h-full object-cover" />
                    <button
                      onClick={(e) => { e.stopPropagation(); setImageB(null); setSelectingFor('B') }}
                      className="absolute top-1 right-1 bg-black/60 text-white p-1 rounded"
                    >
                      <X className="h-3 w-3" />
                    </button>
                    <div className="absolute bottom-1 left-1 bg-black/60 text-white text-xs px-1 rounded">B</div>
                  </div>
                ) : (
                  <div className="text-center p-2">
                    <ImageIcon className="h-6 w-6 mx-auto text-[var(--text-secondary)] mb-1" />
                    <span className="text-xs text-[var(--text-secondary)]">图像 B</span>
                  </div>
                )}
              </div>
            </div>

            {/* 选择提示 */}
            <div className="text-center text-xs text-[var(--accent-color)]">
              正在选择: 图像 {selectingFor}
            </div>

            {/* 选择来源 Tabs */}
            <div className="flex gap-2">
              {(['canvas', 'history', 'upload'] as const).map((t) => (
                <button
                  key={t}
                  onClick={() => setTab(t)}
                  className={cn(
                    'flex-1 px-3 py-2 rounded text-xs font-semibold transition',
                    tab === t
                      ? 'bg-[var(--accent-color)] text-white'
                      : 'bg-[var(--bg-primary)] text-[var(--text-primary)] hover:bg-[var(--bg-tertiary)]'
                  )}
                >
                  {t === 'canvas' ? '从画布' : t === 'history' ? '素材库' : '上传'}
                </button>
              ))}
            </div>

            {/* Tab 内容 */}
            <div className="max-h-[150px] overflow-auto">
              {tab === 'canvas' && (
                <div className="grid grid-cols-4 gap-2">
                  {canvasImages.length === 0 ? (
                    <div className="col-span-4 text-center py-4 text-sm text-[var(--text-secondary)]">
                      画布中没有图像
                    </div>
                  ) : (
                    canvasImages.map((node) => (
                      <button
                        key={node.id}
                        onClick={() => handleSelectCanvasImage(node.id)}
                        className="aspect-square rounded overflow-hidden border border-[var(--border-color)] hover:border-[var(--accent-color)] transition"
                      >
                        <img src={getImageUrl(node)} alt="" className="w-full h-full object-cover" />
                      </button>
                    ))
                  )}
                </div>
              )}

              {tab === 'history' && (
                <div className="grid grid-cols-4 gap-2">
                  {historyAssets.length === 0 ? (
                    <div className="col-span-4 text-center py-4 text-sm text-[var(--text-secondary)]">
                      素材库是空的
                    </div>
                  ) : (
                    historyAssets.map((asset) => (
                      <button
                        key={asset.id}
                        onClick={() => handleSelectHistoryAsset(asset.id)}
                        className="aspect-square rounded overflow-hidden border border-[var(--border-color)] hover:border-[var(--accent-color)] transition"
                      >
                        <img src={asset.src} alt="" className="w-full h-full object-cover" />
                      </button>
                    ))
                  )}
                </div>
              )}

              {tab === 'upload' && (
                <div
                  onClick={() => fileInputRef.current?.click()}
                  className="border-2 border-dashed border-[var(--border-color)] rounded-lg p-6 text-center cursor-pointer hover:border-[var(--accent-color)] transition"
                >
                  <Upload className="h-6 w-6 mx-auto text-[var(--text-secondary)] mb-2" />
                  <div className="text-sm text-[var(--text-secondary)]">点击上传</div>
                </div>
              )}
              <input
                ref={fileInputRef}
                type="file"
                accept="image/jpeg,image/png,image/webp,image/gif"
                onChange={handleFileUpload}
                className="hidden"
              />
            </div>

            {/* 融合设置 */}
            {imageA && imageB && (
              <>
                <div>
                  <label className="block text-xs font-semibold text-[var(--text-primary)] mb-2">融合方法</label>
                  <select
                    value={method}
                    onChange={(e) => setMethod(e.target.value as any)}
                    className="w-full px-3 py-2 rounded bg-[var(--bg-primary)] text-[var(--text-primary)] text-sm border border-[var(--border-color)]"
                  >
                    <option value="laplacian">⚡ 快速本地融合</option>
                    <option value="enhanced">🟡 增强本地融合</option>
                    <option value="gemini">🧠 Gemini AI 融合</option>
                    <option value="kling">🚀 Kling AI 融合</option>
                  </select>
                </div>

                {/* 本地融合参数 */}
                {(method === 'laplacian' || method === 'enhanced') && (
                  <div>
                    <label className="block text-xs font-semibold text-[var(--text-primary)] mb-2">
                      混合权重: A {(alpha * 100).toFixed(0)}% / B {((1 - alpha) * 100).toFixed(0)}%
                    </label>
                    <input
                      type="range"
                      min="0"
                      max="1"
                      step="0.05"
                      value={alpha}
                      onChange={(e) => setAlpha(Number(e.target.value))}
                      className="w-full"
                    />
                  </div>
                )}

                {/* AI 融合输入 */}
                {isAIMethod && (
                  <div className="space-y-2">
                    <label className="flex items-center gap-2 text-xs font-semibold text-[var(--text-primary)]">
                      <Sparkles className="h-4 w-4 text-[var(--accent-color)]" />
                      描述你想要的融合效果
                    </label>
                    <textarea
                      value={userPrompt}
                      onChange={(e) => setUserPrompt(e.target.value)}
                      placeholder="例如：将两张人物照片融合成一个双重曝光艺术效果，保持面部清晰，背景使用梦幻渐变..."
                      className="w-full h-20 px-3 py-2 rounded bg-[var(--bg-primary)] text-[var(--text-primary)] text-sm border border-[var(--border-color)] resize-none placeholder:text-[var(--text-secondary)]"
                    />
                    <p className="text-xs text-[var(--text-secondary)]">
                      AI 会分析你的需求并生成专业的融合提示词
                    </p>
                  </div>
                )}

                {/* 图片分析结果预览 */}
                {imageAnalysis && (
                  <div className="p-3 rounded bg-[var(--bg-primary)] border border-[var(--border-color)] space-y-2">
                    <label className="block text-xs font-semibold text-[var(--accent-color)]">
                      AI 图片分析:
                    </label>
                    <div className="grid grid-cols-2 gap-2 text-xs text-[var(--text-secondary)]">
                      <div>
                        <span className="font-semibold text-[var(--text-primary)]">图A: </span>
                        {imageAnalysis.descA}
                      </div>
                      <div>
                        <span className="font-semibold text-[var(--text-primary)]">图B: </span>
                        {imageAnalysis.descB}
                      </div>
                    </div>
                  </div>
                )}

                {/* 优化后的提示词预览 */}
                {optimizedPrompt && (
                  <div className="p-3 rounded bg-[var(--bg-primary)] border border-[var(--border-color)]">
                    <label className="block text-xs font-semibold text-[var(--accent-color)] mb-1">
                      AI 优化后的提示词:
                    </label>
                    <p className="text-xs text-[var(--text-secondary)] max-h-20 overflow-auto">
                      {optimizedPrompt}
                    </p>
                  </div>
                )}

                <button
                  onClick={handleBlend}
                  disabled={!canBlend}
                  className="w-full px-4 py-3 rounded-lg bg-[var(--accent-color)] text-white font-semibold hover:opacity-90 disabled:opacity-50 transition flex items-center justify-center gap-2"
                >
                  {isProcessing ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" />
                      处理中...
                    </>
                  ) : (
                    <>
                      {isAIMethod && <Sparkles className="h-4 w-4" />}
                      开始融合
                    </>
                  )}
                </button>
              </>
            )}
          </div>
        ) : (
          <div className="space-y-4">
            {/* 结果预览 */}
            <div className="rounded-lg overflow-hidden border border-[var(--border-color)]">
              <img src={blendResult} alt="融合结果" className="w-full" />
            </div>

            {/* 图片分析结果 */}
            {imageAnalysis && (
              <div className="p-3 rounded bg-[var(--bg-primary)] border border-[var(--border-color)] space-y-2">
                <label className="block text-xs font-semibold text-[var(--accent-color)]">
                  图片分析:
                </label>
                <div className="grid grid-cols-2 gap-2 text-xs text-[var(--text-secondary)]">
                  <div>
                    <span className="font-semibold text-[var(--text-primary)]">图A: </span>
                    {imageAnalysis.descA}
                  </div>
                  <div>
                    <span className="font-semibold text-[var(--text-primary)]">图B: </span>
                    {imageAnalysis.descB}
                  </div>
                </div>
              </div>
            )}

            {/* 优化后的提示词 */}
            {optimizedPrompt && (
              <div className="p-3 rounded bg-[var(--bg-primary)] border border-[var(--border-color)]">
                <label className="block text-xs font-semibold text-[var(--accent-color)] mb-1">
                  使用的提示词:
                </label>
                <p className="text-xs text-[var(--text-secondary)] max-h-16 overflow-auto">
                  {optimizedPrompt}
                </p>
              </div>
            )}

            {/* 操作按钮 */}
            <div className="space-y-2">
              <button
                onClick={handleAddToCanvas}
                className="w-full px-4 py-3 rounded-lg bg-[var(--accent-color)] text-white font-semibold hover:opacity-90 transition flex items-center justify-center gap-2"
              >
                <Plus className="h-4 w-4" />
                添加到画布
              </button>

              <button
                onClick={() => { setBlendResult(null); setError(null) }}
                className="w-full px-4 py-2 rounded-lg bg-[var(--bg-primary)] text-[var(--text-primary)] font-semibold hover:bg-[var(--bg-tertiary)] transition"
              >
                重新调整
              </button>

              <button
                onClick={resetState}
                className="w-full px-4 py-2 rounded-lg bg-[var(--bg-primary)] text-[var(--text-secondary)] font-semibold hover:bg-[var(--bg-tertiary)] transition"
              >
                重新选择图像
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
