/**
 * Blend Tool Panel | 图像融合工具面板
 * 支持本地融合和 AI 融合 (Gemini/Kling)
 * 批量模式：多组融图，每组有主图+物品图+独立提示词
 */

import React, { useState, useRef, useCallback, useEffect, useMemo } from 'react'
import { X, Upload, Wand2, Plus, AlertCircle, ImageIcon, Sparkles, Loader2, Layers, User, Package, ChevronDown, ChevronUp, Trash2, Copy } from 'lucide-react'
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

// 批量组结构：主图 + 物品图列表 + 提示词
interface BlendGroup {
  id: string
  mainImage: string          // 主图（人物/场景）- 保持不变
  itemImages: string[]       // 物品图列表
  prompt: string             // 该组的融合提示词
  expanded?: boolean         // UI展开状态
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

// AI 分析图片内容（支持多张）
const analyzeImages = async (images: string[]): Promise<string[]> => {
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

  const results = await Promise.all(images.map(async (img) => {
    const base64 = extractBase64(await ensureBase64(img))
    const result = await chatCompletions({
      model: 'gpt-5-mini',
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: analyzePrompt },
            { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${base64}` } }
          ]
        }
      ]
    })
    return result.trim()
  }))

  return results
}

// AI 优化提示词（基于图片分析和用户需求）- 增强版，强调主图人物场景不变
const optimizePromptWithAI = async (
  userRequirement: string,
  mainImageAnalysis: string,
  itemImageAnalyses: string[],
  method: 'gemini' | 'kling'
): Promise<string> => {
  const systemPrompt = `You are an expert AI image fusion specialist. Your PRIMARY goal is to ADD items/objects to a scene while PRESERVING the main image's person and scene EXACTLY as they are.

## ABSOLUTE RULES (NEVER BREAK):

### 1. MAIN IMAGE PRESERVATION (最重要！)
The main image contains a person/scene that MUST remain EXACTLY unchanged:
- EXACT facial features: face shape, eyes, nose, lips, skin tone, expression
- EXACT hairstyle: color, length, style, texture
- EXACT clothing: every detail of what they're wearing
- EXACT pose and body position
- EXACT background/scene elements
- EXACT lighting and atmosphere
- DO NOT modify, blend, or alter ANY aspect of the main person/scene

### 2. ITEM INTEGRATION ONLY
Items from other images should be ADDED to the scene:
- Place items naturally within the existing scene
- Match lighting and shadows to the main image
- Maintain proper scale and perspective
- Items should look like they belong in the scene
- DO NOT let items affect the main person's appearance

### 3. SEAMLESS COMPOSITION
- Integrate items with natural shadows and reflections
- Ensure color harmony with the main scene
- Maintain consistent depth of field
- No visible seams or artifacts

### 4. OUTPUT FORMAT
Generate a SINGLE cohesive prompt that:
1. First describes the main person/scene in EXACT detail (to be preserved)
2. Then specifies how items should be added to the scene
3. Emphasizes "maintain exact likeness", "preserve original appearance"
4. Includes quality keywords

${method === 'gemini' ?
  'For Gemini: Use natural language, emphasize photorealism. Include: "maintain exact original appearance, seamlessly integrate items, natural lighting"' :
  'For Kling: Emphasize cinematic quality. Include: "preserve exact likeness, masterpiece, 8k, professional composition"'}

Length: 100-150 words. Output ONLY the prompt, no explanations.`

  const itemDescs = itemImageAnalyses.map((desc, i) => `Item ${i + 1}: ${desc}`).join('\n')

  const userContent = `## MAIN IMAGE (MUST PRESERVE EXACTLY):
${mainImageAnalysis}

## ITEMS TO ADD:
${itemDescs}

## User's Request:
"${userRequirement}"

Generate a fusion prompt that:
1. Keeps the main person/scene EXACTLY as described
2. Adds the items naturally to the scene
3. The person should NOT change in any way`

  const result = await chatCompletions({
    model: 'gpt-4o',
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userContent }
    ]
  })

  return result.trim()
}

// Gemini 融合 - 增强版，强调主图不变
const blendWithGemini = async (
  mainImage: string,
  itemImages: string[],
  prompt: string,
  onProgress: (msg: string) => void,
  aspectRatio: string = '3:4',
  resolution: string = '2K'
): Promise<string> => {
  onProgress('正在调用 Gemini AI...')

  // 主图放第一位，标记为要保持的图
  const allImages = [mainImage, ...itemImages]
  const imageParts = await Promise.all(allImages.map(async (img) => {
    const base64 = extractBase64(await ensureBase64(img))
    return { inline_data: { mime_type: 'image/jpeg', data: base64 } }
  }))

  const fullPrompt = `Generate ONE fusion image. The FIRST image is the MAIN image - preserve it EXACTLY. Add items from other images to the scene.

## CRITICAL - MAIN IMAGE PRESERVATION:
The person/scene in Image 1 MUST remain EXACTLY unchanged:
- Keep EXACT facial features (face shape, eyes, nose, lips, skin tone)
- Keep EXACT hairstyle (color, length, style)
- Keep EXACT clothing and accessories
- Keep EXACT pose and expression
- Keep EXACT background and atmosphere
- DO NOT modify ANY aspect of the main person

## TASK:
${prompt}

## RULES:
1. The main person's appearance is SACRED - do not alter it
2. Add items naturally with proper lighting and shadows
3. Maintain perspective and scale consistency
4. Create seamless integration without visible artifacts

Output ONLY the blended image, no text.`

  const response = await postJson<any>(
    '/v1beta/models/gemini-3-pro-image-preview:generateContent',
    {
      contents: [{
        role: 'user',
        parts: [
          { text: fullPrompt },
          ...imageParts
        ]
      }],
      generationConfig: {
        responseModalities: ['IMAGE'],
        imageConfig: {
          aspectRatio,
          imageSize: resolution
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

// Kling 融合 - 增强版
const blendWithKling = async (
  mainImage: string,
  itemImages: string[],
  prompt: string,
  onProgress: (msg: string) => void,
  aspectRatio: string = '3:4',
  resolution: string = '2K'
): Promise<string> => {
  onProgress('正在调用 Kling AI...')

  // 主图放第一位
  const allImages = [mainImage, ...itemImages]
  const imageList = await Promise.all(allImages.map(async (img) => ({ image: await ensureBase64(img) })))

  const fullPrompt = `${prompt}

CRITICAL RULES:
1. Image 1 is the MAIN reference - the person/scene MUST remain EXACTLY as shown
2. Preserve EXACT facial features, hairstyle, clothing, pose, and expression
3. Add items from other images naturally into the scene
4. Match lighting and shadows to the main image
5. The main person should NOT change in ANY way

Quality: masterpiece, 8k resolution, professional photography, perfect composition.`

  const response = await postJson<any>(
    '/kling/v1/images/omni-image',
    {
      model_name: 'kling-image-o1',
      prompt: fullPrompt,
      n: 1,
      aspect_ratio: aspectRatio,
      resolution: resolution.toLowerCase(),
      image_list: imageList
    },
    { authMode: 'bearer', timeoutMs: 240000 }
  )

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

  if (imageUrl.startsWith('http')) {
    return await downloadImageAsBase64(imageUrl)
  }
  return imageUrl
}

// 默认提示词模板
const DEFAULT_PROMPT_TEMPLATES = [
  '将物品自然地添加到人物手中或场景中，保持人物外观完全不变',
  '让人物手持/佩戴这些物品，人物的面部和服装保持原样',
  '将物品放置在场景的合适位置，不改变人物的任何特征',
  '将物品与场景融合，保持人物的完整性和原始外观'
]

export default function BlendToolPanel({ open, onClose, onAddToCanvas }: Props) {
  // 单图模式
  const [imageA, setImageA] = useState<string | null>(null)
  const [imageB, setImageB] = useState<string | null>(null)
  const [selectingFor, setSelectingFor] = useState<'A' | 'B' | 'main' | 'item'>('A')
  const [method, setMethod] = useState<'laplacian' | 'enhanced' | 'gemini' | 'kling'>('gemini')
  const [blendResult, setBlendResult] = useState<string | null>(null)
  const [isProcessing, setIsProcessing] = useState(false)
  const [alpha, setAlpha] = useState(0.5)
  const [tab, setTab] = useState<'canvas' | 'history' | 'upload'>('canvas')
  const [error, setError] = useState<string | null>(null)
  const [userPrompt, setUserPrompt] = useState('')
  const [optimizedPrompt, setOptimizedPrompt] = useState('')
  const [imageAnalysis, setImageAnalysis] = useState<string[] | null>(null)
  const [progressMsg, setProgressMsg] = useState('')

  // 比例和分辨率选择
  const [aspectRatio, setAspectRatio] = useState<'1:1' | '3:4' | '4:3' | '9:16' | '16:9'>('3:4')
  const [resolution, setResolution] = useState<'1K' | '2K' | '4K'>('2K')

  // 批量模式 - 多组融图，每组有独立提示词
  const [batchMode, setBatchMode] = useState(false)
  const [batchGroups, setBatchGroups] = useState<BlendGroup[]>([])
  const [currentGroup, setCurrentGroup] = useState<BlendGroup>({
    id: Date.now().toString(),
    mainImage: '',
    itemImages: [],
    prompt: DEFAULT_PROMPT_TEMPLATES[0],
    expanded: true
  })
  const [batchResults, setBatchResults] = useState<{ groupId: string; result: string; success: boolean; error?: string }[]>([])
  const [batchProgress, setBatchProgress] = useState<{ current: number; total: number } | null>(null)
  const [concurrency, setConcurrency] = useState(2)

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
    setBatchMode(false)
    setBatchGroups([])
    setCurrentGroup({
      id: Date.now().toString(),
      mainImage: '',
      itemImages: [],
      prompt: DEFAULT_PROMPT_TEMPLATES[0],
      expanded: true
    })
    setBatchResults([])
    setBatchProgress(null)
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
      if (batchMode) {
        if (selectingFor === 'main') {
          setCurrentGroup(g => ({ ...g, mainImage: base64 }))
        } else {
          setCurrentGroup(g => ({ ...g, itemImages: [...g.itemImages, base64] }))
        }
      } else {
        if (selectingFor === 'A') {
          setImageA(base64)
          setSelectingFor('B')
        } else {
          setImageB(base64)
        }
      }
    }
    reader.readAsDataURL(file)
    e.target.value = ''
  }, [selectingFor, batchMode])

  const handleSelectImage = useCallback((url: string) => {
    if (!isValidUrl(url)) {
      setError('图像数据无效')
      return
    }

    if (batchMode) {
      if (selectingFor === 'main') {
        setCurrentGroup(g => ({ ...g, mainImage: url }))
        setSelectingFor('item')
      } else {
        if (!currentGroup.itemImages.includes(url) && url !== currentGroup.mainImage) {
          setCurrentGroup(g => ({ ...g, itemImages: [...g.itemImages, url] }))
        }
      }
    } else {
      if (selectingFor === 'A') {
        setImageA(url)
        setSelectingFor('B')
      } else {
        setImageB(url)
      }
    }
    setError(null)
  }, [selectingFor, batchMode, currentGroup])

  const handleSelectCanvasImage = useCallback((nodeId: string) => {
    const node = canvasImages.find((n) => n.id === nodeId)
    if (!node) return
    handleSelectImage(getImageUrl(node))
  }, [canvasImages, handleSelectImage])

  const handleSelectHistoryAsset = useCallback((assetId: string) => {
    const asset = historyAssets.find((a) => a.id === assetId)
    if (!asset?.src) {
      setError('素材数据无效')
      return
    }
    handleSelectImage(asset.src)
  }, [historyAssets, handleSelectImage])

  // 添加当前组到批量列表
  const addCurrentGroupToBatch = useCallback(() => {
    if (!currentGroup.mainImage) {
      setError('请先选择主图')
      return
    }
    if (currentGroup.itemImages.length === 0) {
      setError('请至少添加一张物品图')
      return
    }
    if (!currentGroup.prompt.trim()) {
      setError('请输入融合提示词')
      return
    }

    setBatchGroups(groups => [...groups, { ...currentGroup, expanded: false }])
    setCurrentGroup({
      id: Date.now().toString(),
      mainImage: '',
      itemImages: [],
      prompt: currentGroup.prompt, // 保留上一组的提示词作为默认
      expanded: true
    })
    setSelectingFor('main')
    setError(null)
  }, [currentGroup])

  // 删除批量组
  const removeGroup = useCallback((groupId: string) => {
    setBatchGroups(groups => groups.filter(g => g.id !== groupId))
  }, [])

  // 复制组提示词到当前
  const copyPromptFromGroup = useCallback((prompt: string) => {
    setCurrentGroup(g => ({ ...g, prompt }))
  }, [])

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

  // 执行单组融合（带重试）
  const blendSingleGroup = useCallback(async (
    group: BlendGroup,
    onProgress: (msg: string) => void
  ): Promise<string> => {
    const allImages = [group.mainImage, ...group.itemImages]

    // 本地融合
    if (method === 'laplacian' || method === 'enhanced') {
      onProgress('本地融合中...')
      let canvas = document.createElement('canvas')
      let ctx = canvas.getContext('2d')
      if (!ctx) throw new Error('Canvas 不可用')

      const loadedImages = await Promise.all(allImages.map(async (src) => {
        return new Promise<HTMLImageElement>((resolve, reject) => {
          const img = new Image()
          img.crossOrigin = 'anonymous'
          img.onload = () => resolve(img)
          img.onerror = () => reject(new Error('图片加载失败'))
          img.src = src
        })
      }))

      const w = Math.max(...loadedImages.map(i => i.width))
      const h = Math.max(...loadedImages.map(i => i.height))
      canvas.width = w
      canvas.height = h

      // 主图权重更高
      ctx.globalAlpha = 1
      ctx.drawImage(loadedImages[0], 0, 0, w, h)
      const alphaPerItem = 0.3 / Math.max(loadedImages.length - 1, 1)
      for (let i = 1; i < loadedImages.length; i++) {
        ctx.globalAlpha = alphaPerItem
        ctx.drawImage(loadedImages[i], 0, 0, w, h)
      }

      return canvas.toDataURL('image/png')
    }

    // AI 融合
    onProgress('AI 正在分析图片...')
    const mainAnalysis = (await analyzeImages([group.mainImage]))[0]
    const itemAnalyses = group.itemImages.length > 0 ? await analyzeImages(group.itemImages) : []

    if (abortControllerRef.current?.signal.aborted) throw new Error('已取消')

    onProgress('AI 正在优化提示词...')
    const optimized = await optimizePromptWithAI(group.prompt, mainAnalysis, itemAnalyses, method)

    if (abortControllerRef.current?.signal.aborted) throw new Error('已取消')

    if (method === 'gemini') {
      return await blendWithGemini(group.mainImage, group.itemImages, optimized, onProgress, aspectRatio, resolution)
    } else {
      return await blendWithKling(group.mainImage, group.itemImages, optimized, onProgress, aspectRatio, resolution)
    }
  }, [method, aspectRatio, resolution])

  // 执行融合
  const handleBlend = useCallback(async () => {
    // 验证
    if (batchMode) {
      // 如果当前组有效，先添加到列表
      let allGroups = [...batchGroups]
      if (currentGroup.mainImage && currentGroup.itemImages.length > 0 && currentGroup.prompt.trim()) {
        allGroups = [...allGroups, currentGroup]
      }

      if (allGroups.length === 0) {
        setError('请添加至少一个融合组')
        return
      }

      // 验证每个组
      for (let i = 0; i < allGroups.length; i++) {
        const g = allGroups[i]
        if (!g.mainImage) {
          setError(`组 ${i + 1} 缺少主图`)
          return
        }
        if (g.itemImages.length === 0) {
          setError(`组 ${i + 1} 缺少物品图`)
          return
        }
        if (!g.prompt.trim()) {
          setError(`组 ${i + 1} 缺少提示词`)
          return
        }
      }

      // 开始批量处理
      abortControllerRef.current = new AbortController()
      setIsProcessing(true)
      setError(null)
      setBatchResults([])
      setBatchProgress({ current: 0, total: allGroups.length })

      const results: { groupId: string; result: string; success: boolean; error?: string }[] = []

      // 并发处理
      for (let i = 0; i < allGroups.length; i += concurrency) {
        if (abortControllerRef.current?.signal.aborted) break

        const batch = allGroups.slice(i, i + concurrency)
        const batchPromises = batch.map(async (group, batchIdx) => {
          const groupIdx = i + batchIdx
          try {
            const result = await blendSingleGroup(group, (msg) => {
              setProgressMsg(`组 ${groupIdx + 1}: ${msg}`)
            })

            // 保存到素材库
            assetsStore.addAsset({
              type: 'image',
              src: result,
              title: `融合结果 ${groupIdx + 1}`,
              model: method === 'gemini' ? 'gemini-blend' : method === 'kling' ? 'kling-blend' : 'local-blend'
            })

            return { groupId: group.id, result, success: true }
          } catch (err: any) {
            console.warn(`[BlendPanel] 组 ${groupIdx + 1} 失败:`, err?.message)
            return { groupId: group.id, result: '', success: false, error: err?.message || '融合失败' }
          }
        })

        const batchResults = await Promise.all(batchPromises)
        results.push(...batchResults)

        setBatchProgress({ current: Math.min(i + concurrency, allGroups.length), total: allGroups.length })
        setBatchResults([...results])
      }

      setBatchProgress(null)
      setIsProcessing(false)

      const successCount = results.filter(r => r.success).length
      if (successCount > 0) {
        window.$message?.success?.(`批量融合完成，成功 ${successCount}/${allGroups.length} 组`)
      } else {
        setError('批量融合全部失败')
      }
      return
    }

    // 单图模式
    if (!imageA || !imageB) {
      setError('请选择两张图像')
      return
    }

    if ((method === 'gemini' || method === 'kling') && !userPrompt.trim()) {
      setError('请输入融合需求描述')
      return
    }

    abortControllerRef.current = new AbortController()
    setIsProcessing(true)
    setError(null)
    setProgressMsg('')
    setOptimizedPrompt('')
    setImageAnalysis(null)
    setRetryCount(0)
    setRetryMessage(null)

    // 带重试的执行
    let lastError: Error | null = null
    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      try {
        setRetryCount(attempt)
        if (attempt > 1) {
          setRetryMessage(`第 ${attempt}/${MAX_RETRIES} 次尝试...`)
        }

        if (abortControllerRef.current?.signal.aborted) {
          throw new Error('已取消')
        }

        let result: string

        if (method === 'laplacian' || method === 'enhanced') {
          setProgressMsg('本地融合中...')
          result = await blendLocal(imageA!, imageB!, alpha)
        } else {
          // AI 融合 - 单图模式也使用主图+物品图逻辑
          const singleGroup: BlendGroup = {
            id: 'single',
            mainImage: imageA!,
            itemImages: [imageB!],
            prompt: userPrompt,
            expanded: false
          }

          result = await blendSingleGroup(singleGroup, setProgressMsg)
        }

        // 成功
        setBlendResult(result)
        setProgressMsg('')
        setRetryMessage(null)
        setRetryCount(0)

        assetsStore.addAsset({
          type: 'image',
          src: result,
          title: `融合图片 ${new Date().toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}`,
          model: method === 'gemini' ? 'gemini-blend' : method === 'kling' ? 'kling-blend' : 'local-blend'
        })

        setIsProcessing(false)
        return
      } catch (err: any) {
        lastError = err

        if (err?.message === '已取消' || abortControllerRef.current?.signal.aborted) {
          setError('已取消')
          break
        }

        console.warn(`[BlendPanel] 尝试 ${attempt}/${MAX_RETRIES} 失败:`, err?.message)

        if (attempt < MAX_RETRIES) {
          const waitMs = Math.min(2000 * Math.pow(2, attempt - 1), 10000)
          setRetryMessage(`生成失败，${Math.round(waitMs / 1000)}秒后重试 (${attempt}/${MAX_RETRIES})...`)
          setError(null)

          await new Promise<void>((resolve) => {
            setTimeout(resolve, waitMs)
          })

          if (abortControllerRef.current?.signal.aborted) {
            setError('已取消')
            break
          }
        }
      }
    }

    if (lastError && lastError.message !== '已取消') {
      setError(lastError.message || '融合失败')
    }
    setRetryMessage(null)
    setRetryCount(0)
    setIsProcessing(false)
  }, [imageA, imageB, method, alpha, userPrompt, blendLocal, blendSingleGroup, assetsStore, aspectRatio, resolution, batchMode, batchGroups, currentGroup, concurrency])

  const handleAddToCanvas = useCallback(() => {
    if (!blendResult) return
    onAddToCanvas?.(blendResult, `blend-${Date.now()}.png`)
    resetState()
    onClose()
  }, [blendResult, onAddToCanvas, resetState, onClose])

  if (!open) return null

  const hasResult = !!blendResult || batchResults.length > 0
  const isAIMethod = method === 'gemini' || method === 'kling'
  const canBlend = batchMode
    ? (batchGroups.length > 0 || (currentGroup.mainImage && currentGroup.itemImages.length > 0 && currentGroup.prompt.trim())) && !isProcessing
    : !!imageA && !!imageB && !isProcessing && (!isAIMethod || userPrompt.trim())

  return (
    <div className="fixed bottom-4 right-4 z-40 w-[480px] rounded-2xl border border-[var(--border-color)] bg-[var(--bg-secondary)] shadow-2xl">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-[var(--border-color)] p-4">
        <div className="flex items-center gap-2">
          <Wand2 className="h-5 w-5 text-[var(--accent-color)]" />
          <h3 className="font-semibold text-[var(--text-primary)]">图像融合</h3>
          {batchMode && <span className="text-xs bg-[var(--accent-color)] text-white px-2 py-0.5 rounded">批量模式</span>}
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
            <button onClick={handleBlend} className="text-xs text-red-400 hover:text-red-300 underline flex-shrink-0">
              重试
            </button>
          )}
        </div>
      )}

      {/* Progress */}
      {isProcessing && (
        <div className="border-b border-[var(--accent-color)]/30 bg-[var(--accent-color)]/10 p-3 flex gap-2 items-center justify-between">
          <div className="flex gap-2 items-center flex-1 min-w-0">
            <Loader2 className="h-4 w-4 text-[var(--accent-color)] animate-spin flex-shrink-0" />
            <div className="flex-1 min-w-0">
              <p className="text-xs text-[var(--accent-color)] truncate">{retryMessage || progressMsg}</p>
              {batchProgress && (
                <div className="mt-1">
                  <div className="h-1 bg-[var(--bg-tertiary)] rounded-full overflow-hidden">
                    <div
                      className="h-full bg-[var(--accent-color)] transition-all"
                      style={{ width: `${(batchProgress.current / batchProgress.total) * 100}%` }}
                    />
                  </div>
                  <p className="text-[10px] text-[var(--text-secondary)] mt-0.5">
                    {batchProgress.current}/{batchProgress.total}
                  </p>
                </div>
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
            {/* 模式切换 */}
            <div className="flex items-center justify-between">
              <label className="flex items-center gap-2 text-xs font-semibold text-[var(--text-primary)]">
                <Layers className="h-4 w-4" />
                批量融合模式
              </label>
              <button
                onClick={() => {
                  setBatchMode(!batchMode)
                  setBatchGroups([])
                  setCurrentGroup({
                    id: Date.now().toString(),
                    mainImage: '',
                    itemImages: [],
                    prompt: DEFAULT_PROMPT_TEMPLATES[0],
                    expanded: true
                  })
                  setImageA(null)
                  setImageB(null)
                  setSelectingFor(batchMode ? 'A' : 'main')
                }}
                className={cn(
                  'relative w-10 h-5 rounded-full transition',
                  batchMode ? 'bg-[var(--accent-color)]' : 'bg-[var(--bg-tertiary)]'
                )}
              >
                <div
                  className={cn(
                    'absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform',
                    batchMode ? 'translate-x-5' : 'translate-x-0.5'
                  )}
                />
              </button>
            </div>

            {!batchMode ? (
              // === 单图模式 ===
              <>
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
                        <div className="absolute bottom-1 left-1 bg-blue-600 text-white text-xs px-1.5 py-0.5 rounded flex items-center gap-1">
                          <User className="h-3 w-3" />
                          主图
                        </div>
                      </div>
                    ) : (
                      <div className="text-center p-2">
                        <User className="h-6 w-6 mx-auto text-blue-500 mb-1" />
                        <span className="text-xs text-[var(--text-secondary)]">主图 (人物/场景)</span>
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
                        <div className="absolute bottom-1 left-1 bg-orange-600 text-white text-xs px-1.5 py-0.5 rounded flex items-center gap-1">
                          <Package className="h-3 w-3" />
                          物品
                        </div>
                      </div>
                    ) : (
                      <div className="text-center p-2">
                        <Package className="h-6 w-6 mx-auto text-orange-500 mb-1" />
                        <span className="text-xs text-[var(--text-secondary)]">物品图</span>
                      </div>
                    )}
                  </div>
                </div>

                <div className="text-center">
                  <p className="text-xs text-[var(--text-secondary)]">
                    正在选择: <span className="text-[var(--accent-color)] font-semibold">{selectingFor === 'A' ? '主图' : '物品图'}</span>
                  </p>
                  <p className="text-[10px] text-[var(--text-secondary)] mt-1">
                    主图的人物和场景将保持不变，物品会被自然地融入场景中
                  </p>
                </div>
              </>
            ) : (
              // === 批量模式 ===
              <div className="space-y-3">
                {/* 已添加的组 */}
                {batchGroups.length > 0 && (
                  <div className="space-y-2">
                    <label className="block text-xs font-semibold text-[var(--text-primary)]">
                      已添加的融合组 ({batchGroups.length})
                    </label>
                    <div className="space-y-2 max-h-[150px] overflow-auto">
                      {batchGroups.map((group, gIdx) => (
                        <div key={group.id} className="border border-[var(--border-color)] rounded-lg bg-[var(--bg-primary)]">
                          <div
                            className="flex items-center gap-2 p-2 cursor-pointer"
                            onClick={() => setBatchGroups(groups => groups.map(g =>
                              g.id === group.id ? { ...g, expanded: !g.expanded } : g
                            ))}
                          >
                            <div className="flex gap-1 flex-1 items-center">
                              <div className="relative w-8 h-8 rounded border-2 border-blue-500 overflow-hidden flex-shrink-0">
                                <img src={group.mainImage} alt="" className="w-full h-full object-cover" />
                              </div>
                              <span className="text-[10px] text-[var(--text-secondary)]">+</span>
                              <div className="flex gap-0.5">
                                {group.itemImages.slice(0, 3).map((img, iIdx) => (
                                  <div key={iIdx} className="w-6 h-6 rounded border border-orange-500 overflow-hidden">
                                    <img src={img} alt="" className="w-full h-full object-cover" />
                                  </div>
                                ))}
                                {group.itemImages.length > 3 && (
                                  <div className="w-6 h-6 rounded bg-[var(--bg-tertiary)] flex items-center justify-center text-[10px] text-[var(--text-secondary)]">
                                    +{group.itemImages.length - 3}
                                  </div>
                                )}
                              </div>
                            </div>
                            <span className="text-xs text-[var(--text-secondary)]">组 {gIdx + 1}</span>
                            {group.expanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                          </div>

                          {group.expanded && (
                            <div className="px-2 pb-2 space-y-2 border-t border-[var(--border-color)]">
                              <p className="text-[10px] text-[var(--text-secondary)] pt-2 line-clamp-2">{group.prompt}</p>
                              <div className="flex gap-2">
                                <button
                                  onClick={(e) => { e.stopPropagation(); copyPromptFromGroup(group.prompt) }}
                                  className="text-[10px] text-[var(--accent-color)] hover:underline flex items-center gap-1"
                                >
                                  <Copy className="h-3 w-3" />
                                  复制提示词
                                </button>
                                <button
                                  onClick={(e) => { e.stopPropagation(); removeGroup(group.id) }}
                                  className="text-[10px] text-red-400 hover:underline flex items-center gap-1"
                                >
                                  <Trash2 className="h-3 w-3" />
                                  删除
                                </button>
                              </div>
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* 当前正在编辑的组 */}
                <div className="border-2 border-dashed border-[var(--accent-color)] rounded-lg p-3 space-y-3">
                  <div className="flex items-center justify-between">
                    <label className="text-xs font-semibold text-[var(--text-primary)]">当前组</label>
                    <span className="text-[10px] text-[var(--text-secondary)]">
                      {selectingFor === 'main' ? '选择主图' : '选择物品图'}
                    </span>
                  </div>

                  {/* 主图区域 */}
                  <div className="flex gap-2">
                    <div
                      onClick={() => setSelectingFor('main')}
                      className={cn(
                        'w-20 h-20 rounded-lg border-2 flex items-center justify-center cursor-pointer overflow-hidden flex-shrink-0',
                        selectingFor === 'main' ? 'border-blue-500' : 'border-[var(--border-color)]',
                        currentGroup.mainImage ? 'border-solid' : 'border-dashed'
                      )}
                    >
                      {currentGroup.mainImage ? (
                        <div className="relative w-full h-full">
                          <img src={currentGroup.mainImage} alt="" className="w-full h-full object-cover" />
                          <button
                            onClick={(e) => {
                              e.stopPropagation()
                              setCurrentGroup(g => ({ ...g, mainImage: '' }))
                              setSelectingFor('main')
                            }}
                            className="absolute top-0.5 right-0.5 bg-black/60 text-white p-0.5 rounded"
                          >
                            <X className="h-2.5 w-2.5" />
                          </button>
                          <div className="absolute bottom-0 left-0 right-0 bg-blue-600 text-white text-[10px] text-center py-0.5">
                            主图
                          </div>
                        </div>
                      ) : (
                        <div className="text-center p-1">
                          <User className="h-5 w-5 mx-auto text-blue-500 mb-0.5" />
                          <span className="text-[10px] text-[var(--text-secondary)]">主图</span>
                        </div>
                      )}
                    </div>

                    {/* 物品图区域 */}
                    <div className="flex-1">
                      <div
                        onClick={() => setSelectingFor('item')}
                        className={cn(
                          'min-h-[80px] rounded-lg border-2 border-dashed p-2 cursor-pointer',
                          selectingFor === 'item' ? 'border-orange-500' : 'border-[var(--border-color)]'
                        )}
                      >
                        {currentGroup.itemImages.length === 0 ? (
                          <div className="h-full flex flex-col items-center justify-center">
                            <Package className="h-5 w-5 text-orange-500 mb-1" />
                            <span className="text-[10px] text-[var(--text-secondary)]">点击添加物品图</span>
                          </div>
                        ) : (
                          <div className="flex gap-1 flex-wrap">
                            {currentGroup.itemImages.map((img, idx) => (
                              <div key={idx} className="relative w-10 h-10 rounded overflow-hidden border border-orange-500">
                                <img src={img} alt="" className="w-full h-full object-cover" />
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation()
                                    setCurrentGroup(g => ({ ...g, itemImages: g.itemImages.filter((_, i) => i !== idx) }))
                                  }}
                                  className="absolute top-0 right-0 bg-black/60 text-white p-0.5 rounded-bl"
                                >
                                  <X className="h-2 w-2" />
                                </button>
                              </div>
                            ))}
                            <div className="w-10 h-10 rounded border border-dashed border-orange-400 flex items-center justify-center">
                              <Plus className="h-4 w-4 text-orange-400" />
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* 当前组提示词 */}
                  <div>
                    <label className="block text-[10px] font-semibold text-[var(--text-primary)] mb-1">
                      融合提示词 <span className="text-red-500">*</span>
                    </label>
                    <textarea
                      value={currentGroup.prompt}
                      onChange={(e) => setCurrentGroup(g => ({ ...g, prompt: e.target.value }))}
                      placeholder="描述如何将物品融入主图场景，主图人物将保持不变..."
                      className="w-full h-16 px-2 py-1.5 rounded bg-[var(--bg-primary)] text-[var(--text-primary)] text-xs border border-[var(--border-color)] resize-none"
                    />
                    <div className="flex gap-1 mt-1 flex-wrap">
                      {DEFAULT_PROMPT_TEMPLATES.map((t, i) => (
                        <button
                          key={i}
                          onClick={() => setCurrentGroup(g => ({ ...g, prompt: t }))}
                          className="text-[10px] px-1.5 py-0.5 rounded bg-[var(--bg-tertiary)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
                        >
                          模板{i + 1}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* 添加组按钮 */}
                  {currentGroup.mainImage && currentGroup.itemImages.length > 0 && currentGroup.prompt.trim() && (
                    <button
                      onClick={addCurrentGroupToBatch}
                      className="w-full px-3 py-1.5 rounded bg-[var(--accent-color)] text-white text-xs font-semibold hover:opacity-90 flex items-center justify-center gap-1"
                    >
                      <Plus className="h-3 w-3" />
                      确认当前组，添加新组
                    </button>
                  )}
                </div>

                {/* 并发数设置 */}
                {(batchGroups.length > 1 || (batchGroups.length === 1 && currentGroup.mainImage)) && (
                  <div className="flex items-center justify-between">
                    <label className="text-xs font-semibold text-[var(--text-primary)]">并发数</label>
                    <select
                      value={concurrency}
                      onChange={(e) => setConcurrency(Number(e.target.value))}
                      className="px-2 py-1 rounded bg-[var(--bg-primary)] text-[var(--text-primary)] text-xs border border-[var(--border-color)]"
                    >
                      <option value={1}>1（串行）</option>
                      <option value={2}>2</option>
                      <option value={3}>3</option>
                      <option value={4}>4</option>
                    </select>
                  </div>
                )}
              </div>
            )}

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
            <div className="max-h-[120px] overflow-auto">
              {tab === 'canvas' && (
                <div className="grid grid-cols-5 gap-2">
                  {canvasImages.length === 0 ? (
                    <div className="col-span-5 text-center py-4 text-sm text-[var(--text-secondary)]">
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
                <div className="grid grid-cols-5 gap-2">
                  {historyAssets.length === 0 ? (
                    <div className="col-span-5 text-center py-4 text-sm text-[var(--text-secondary)]">
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

            {/* 融合设置 - 单图模式 */}
            {!batchMode && imageA && imageB && (
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
                    <option value="gemini">🧠 Gemini AI 融合（推荐）</option>
                    <option value="kling">🚀 Kling AI 融合</option>
                  </select>
                </div>

                {(method === 'laplacian' || method === 'enhanced') && (
                  <div>
                    <label className="block text-xs font-semibold text-[var(--text-primary)] mb-2">
                      混合权重: 主图 {(alpha * 100).toFixed(0)}% / 物品 {((1 - alpha) * 100).toFixed(0)}%
                    </label>
                    <input
                      type="range"
                      min="0.5"
                      max="0.95"
                      step="0.05"
                      value={alpha}
                      onChange={(e) => setAlpha(Number(e.target.value))}
                      className="w-full"
                    />
                  </div>
                )}

                {isAIMethod && (
                  <div className="space-y-2">
                    <label className="flex items-center gap-2 text-xs font-semibold text-[var(--text-primary)]">
                      <Sparkles className="h-4 w-4 text-[var(--accent-color)]" />
                      描述融合效果
                    </label>
                    <textarea
                      value={userPrompt}
                      onChange={(e) => setUserPrompt(e.target.value)}
                      placeholder="例如：将物品自然地放在人物手中，保持人物外观完全不变..."
                      className="w-full h-16 px-3 py-2 rounded bg-[var(--bg-primary)] text-[var(--text-primary)] text-sm border border-[var(--border-color)] resize-none"
                    />
                    <div className="flex gap-1 flex-wrap">
                      {DEFAULT_PROMPT_TEMPLATES.map((t, i) => (
                        <button
                          key={i}
                          onClick={() => setUserPrompt(t)}
                          className="text-[10px] px-2 py-1 rounded bg-[var(--bg-tertiary)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
                        >
                          模板{i + 1}
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {isAIMethod && (
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs font-semibold text-[var(--text-primary)] mb-2">比例</label>
                      <select
                        value={aspectRatio}
                        onChange={(e) => setAspectRatio(e.target.value as any)}
                        className="w-full px-3 py-2 rounded bg-[var(--bg-primary)] text-[var(--text-primary)] text-sm border border-[var(--border-color)]"
                      >
                        <option value="1:1">1:1 正方形</option>
                        <option value="3:4">3:4 竖版</option>
                        <option value="4:3">4:3 横版</option>
                        <option value="9:16">9:16 手机竖屏</option>
                        <option value="16:9">16:9 宽屏</option>
                      </select>
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-[var(--text-primary)] mb-2">分辨率</label>
                      <select
                        value={resolution}
                        onChange={(e) => setResolution(e.target.value as any)}
                        className="w-full px-3 py-2 rounded bg-[var(--bg-primary)] text-[var(--text-primary)] text-sm border border-[var(--border-color)]"
                      >
                        <option value="1K">1K 标清</option>
                        <option value="2K">2K 高清</option>
                        <option value="4K">4K 超清</option>
                      </select>
                    </div>
                  </div>
                )}
              </>
            )}

            {/* 融合设置 - 批量模式 */}
            {batchMode && (batchGroups.length > 0 || (currentGroup.mainImage && currentGroup.itemImages.length > 0)) && (
              <>
                <div>
                  <label className="block text-xs font-semibold text-[var(--text-primary)] mb-2">融合方法</label>
                  <select
                    value={method}
                    onChange={(e) => setMethod(e.target.value as any)}
                    className="w-full px-3 py-2 rounded bg-[var(--bg-primary)] text-[var(--text-primary)] text-sm border border-[var(--border-color)]"
                  >
                    <option value="laplacian">⚡ 快速本地融合</option>
                    <option value="gemini">🧠 Gemini AI 融合（推荐）</option>
                    <option value="kling">🚀 Kling AI 融合</option>
                  </select>
                </div>

                {isAIMethod && (
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs font-semibold text-[var(--text-primary)] mb-2">比例</label>
                      <select
                        value={aspectRatio}
                        onChange={(e) => setAspectRatio(e.target.value as any)}
                        className="w-full px-3 py-2 rounded bg-[var(--bg-primary)] text-[var(--text-primary)] text-sm border border-[var(--border-color)]"
                      >
                        <option value="1:1">1:1</option>
                        <option value="3:4">3:4</option>
                        <option value="4:3">4:3</option>
                        <option value="9:16">9:16</option>
                        <option value="16:9">16:9</option>
                      </select>
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-[var(--text-primary)] mb-2">分辨率</label>
                      <select
                        value={resolution}
                        onChange={(e) => setResolution(e.target.value as any)}
                        className="w-full px-3 py-2 rounded bg-[var(--bg-primary)] text-[var(--text-primary)] text-sm border border-[var(--border-color)]"
                      >
                        <option value="1K">1K</option>
                        <option value="2K">2K</option>
                        <option value="4K">4K</option>
                      </select>
                    </div>
                  </div>
                )}
              </>
            )}

            {/* 开始融合按钮 */}
            {canBlend && (
              <button
                onClick={handleBlend}
                disabled={isProcessing}
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
                    {batchMode ? `开始批量融合 (${batchGroups.length + (currentGroup.mainImage && currentGroup.itemImages.length > 0 ? 1 : 0)} 组)` : '开始融合'}
                  </>
                )}
              </button>
            )}
          </div>
        ) : (
          // === 结果展示 ===
          <div className="space-y-4">
            {blendResult && (
              <div className="rounded-lg overflow-hidden border border-[var(--border-color)]">
                <img src={blendResult} alt="融合结果" className="w-full" />
              </div>
            )}

            {batchResults.length > 0 && (
              <div className="space-y-2">
                <label className="block text-xs font-semibold text-[var(--text-primary)]">
                  批量融合结果 ({batchResults.filter(r => r.success).length}/{batchResults.length} 成功)
                </label>
                <div className="grid grid-cols-3 gap-2 max-h-[200px] overflow-auto">
                  {batchResults.map((result, idx) => (
                    <div
                      key={result.groupId}
                      className={cn(
                        'relative aspect-square rounded overflow-hidden border-2 cursor-pointer',
                        result.success ? 'border-green-500 hover:border-green-400' : 'border-red-500'
                      )}
                      onClick={() => result.success && onAddToCanvas?.(result.result, `batch-blend-${idx + 1}.png`)}
                    >
                      {result.success ? (
                        <>
                          <img src={result.result} alt="" className="w-full h-full object-cover" />
                          <div className="absolute bottom-0 left-0 right-0 bg-green-600/80 text-white text-[10px] text-center py-0.5">
                            点击添加
                          </div>
                        </>
                      ) : (
                        <div className="w-full h-full flex flex-col items-center justify-center bg-red-900/20 p-2">
                          <AlertCircle className="h-5 w-5 text-red-500 mb-1" />
                          <span className="text-[10px] text-red-400 text-center line-clamp-2">{result.error}</span>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div className="space-y-2">
              {blendResult && (
                <button
                  onClick={handleAddToCanvas}
                  className="w-full px-4 py-3 rounded-lg bg-[var(--accent-color)] text-white font-semibold hover:opacity-90 transition flex items-center justify-center gap-2"
                >
                  <Plus className="h-4 w-4" />
                  添加到画布
                </button>
              )}

              {batchResults.filter(r => r.success).length > 0 && (
                <button
                  onClick={() => {
                    batchResults.filter(r => r.success).forEach((result, idx) => {
                      onAddToCanvas?.(result.result, `batch-blend-${idx + 1}.png`)
                    })
                    resetState()
                    onClose()
                  }}
                  className="w-full px-4 py-3 rounded-lg bg-[var(--accent-color)] text-white font-semibold hover:opacity-90 transition flex items-center justify-center gap-2"
                >
                  <Plus className="h-4 w-4" />
                  全部添加到画布 ({batchResults.filter(r => r.success).length} 张)
                </button>
              )}

              <button
                onClick={() => { setBlendResult(null); setBatchResults([]); setError(null) }}
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
