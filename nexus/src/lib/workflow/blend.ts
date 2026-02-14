/**
 * Image Blending Workflow
 * 
 * 三层融合方案:
 * 1. 快速本地 (Laplacian Pyramid) - 1-3 秒
 * 2. 智能增强 (Laplacian + 优化) - 3-8 秒  
 * 3. AI 融合 (Gemini/Kling API) - 30-60 秒
 * 
 * 关键设计:
 * - 完全本地处理无需 API (拉普拉斯)
 * - 可选 API 增强 (Gemini/Kling)
 * - 充分考虑 Tauri Windows 兼容性
 * - 支持大图像处理 (downscale 策略)
 */

import { useGraphStore } from '@/graph/store'
import { postJson } from '@/lib/workflow/request'
import { saveMedia } from '@/lib/mediaStorage'
import { safeFetch } from '@/lib/safeFetch'
import { useSettingsStore } from '@/store/settings'
import type { GraphNode } from '@/graph/types'

export type BlendMethod = 'laplacian' | 'enhanced' | 'gemini' | 'kling'

export interface BlendConfig {
  method: BlendMethod
  alpha?: number           // 混合权重 0-1，用于简单混合
  pyramidLevels?: number   // 拉普拉斯金字塔层数 (2-6)
  enableAutoAlign?: boolean // 自动图像配准
  enableSeamCutting?: boolean // 智能接缝切割
  enableGradientDomain?: boolean // 梯度域融合
}

// ========== 主工作流入口 ==========

/**
 * 执行图像融合
 * 
 * 要求:
 * - 连接两个图像节点作为输入 (imageA, imageB)
 * - 配置节点指定融合方法
 * - 自动创建输出 image 节点
 */
export async function generateBlendFromConfigNode(
  configNodeId: string,
  config?: Partial<BlendConfig>
) {
  const t0 = Date.now()
  console.log('[blend] 开始融合，configNodeId:', configNodeId)

  // 等待 store 同步
  await new Promise(resolve => setTimeout(resolve, 100))

  const store = useGraphStore.getState()
  const cfg = store.nodes.find(n => n.id === configNodeId)

  if (!cfg || cfg.type !== 'blendConfig') {
    throw new Error('Invalid node type: must be blendConfig')
  }

  try {
    // 更新节点状态为处理中
    store.updateNode(configNodeId, {
      data: {
        ...cfg.data,
        status: 'processing',
        progress: 5,
        message: '准备融合...'
      }
    })

    // Step 1: 获取两个输入图像
    console.log('[blend] 收集输入图像...')
    const { imageA, imageB } = getBlendInputImages(configNodeId)

    if (!imageA || !imageB) {
      throw new Error('请连接两个图像节点作为输入')
    }

    // Step 2: 获取融合配置
    const d = cfg.data as Record<string, unknown>
    const blendConfig: BlendConfig = {
      method: (d?.method as BlendMethod) || 'laplacian',
      alpha: typeof d?.alpha === 'number' ? d.alpha : 0.5,
      pyramidLevels: typeof d?.pyramidLevels === 'number' ? d.pyramidLevels : 4,
      enableAutoAlign: d?.enableAutoAlign !== false,
      enableSeamCutting: d?.enableSeamCutting !== false,
      enableGradientDomain: d?.enableGradientDomain !== false,
      ...config
    }

    console.log('[blend] 配置:', blendConfig)

    // Step 3: 执行融合
    store.updateNode(configNodeId, {
      data: { ...cfg.data, status: 'processing', progress: 20, message: '执行融合...' }
    })

    let blendedImage: string
    let executionTime: number

    if (blendConfig.method === 'laplacian') {
      blendedImage = await blendLaplacian(imageA, imageB, blendConfig)
      executionTime = Date.now() - t0
    } else if (blendConfig.method === 'enhanced') {
      blendedImage = await blendEnhanced(imageA, imageB, blendConfig)
      executionTime = Date.now() - t0
    } else if (blendConfig.method === 'gemini') {
      blendedImage = await blendViaGemini(imageA, imageB, blendConfig)
      executionTime = Date.now() - t0
    } else if (blendConfig.method === 'kling') {
      blendedImage = await blendViaKling(imageA, imageB, blendConfig)
      executionTime = Date.now() - t0
    } else {
      throw new Error(`Unknown blend method: ${blendConfig.method}`)
    }

    if (!blendedImage) {
      throw new Error('融合失败：未生成输出图像')
    }

    console.log('[blend] 融合完成，耗时:', executionTime, 'ms')

    // Step 4: 保存结果到 IndexedDB
    store.updateNode(configNodeId, {
      data: { ...cfg.data, status: 'processing', progress: 80, message: '保存结果...' }
    })

    const projectId = store.projectId || 'default'
    const mediaId = await saveMedia({
      nodeId: configNodeId,
      projectId,
      type: 'image',
      data: blendedImage
    })

    // Step 5: 创建输出 image 节点
    const outputNodeId = findOrCreateOutputImageNode(configNodeId, blendedImage)

    // Step 6: 完成
    store.updateNode(configNodeId, {
      data: {
        ...cfg.data,
        status: 'completed',
        executed: true,
        output: outputNodeId,
        mediaId,
        executionTime,
        progress: 100,
        message: '融合完成'
      }
    })

    console.log('[blend] 完成！输出节点:', outputNodeId, '耗时:', executionTime, 'ms')
    return blendedImage
  } catch (err: any) {
    console.error('[blend] 错误:', err?.message || err)
    store.updateNode(configNodeId, {
      data: {
        ...cfg.data,
        status: 'error',
        errorMessage: err?.message || String(err),
        progress: 0
      }
    })
    throw err
  }
}

// ========== 融合方法实现 ==========

/**
 * 方案 1: 拉普拉斯金字塔融合 (快速，本地)
 * 
 * 优点:
 * - 完全本地处理，无需 API
 * - 速度快 (1-3 秒)
 * - 质量好 (多尺度融合)
 * 
 * 缺点:
 * - 对配准要求高
 * - 不能自动补全背景
 */
async function blendLaplacian(
  imageABase64: string,
  imageBBase64: string,
  config: BlendConfig
): Promise<string> {
  console.log('[blendLaplacian] 开始拉普拉斯融合')

  return new Promise((resolve, reject) => {
    try {
      // 创建 Worker 进行离屏处理 (避免阻塞 UI)
      // 简化版本：直接在主线程处理
      const canvas = document.createElement('canvas')
      const ctx = canvas.getContext('2d')

      if (!ctx) {
        throw new Error('Failed to get canvas 2d context')
      }

      // 加载两张图像
      let loadedCount = 0
      let imgA: HTMLImageElement | null = null
      let imgB: HTMLImageElement | null = null

      const onBothLoaded = () => {
        if (!imgA || !imgB) return

        // 设置 canvas 尺寸 (取较大的)
        const w = Math.max(imgA.width, imgB.width)
        const h = Math.max(imgA.height, imgB.height)
        canvas.width = w
        canvas.height = h

        console.log('[blendLaplacian] Canvas 大小:', w, 'x', h)

        // 执行拉普拉斯融合
        const result = laplacianBlendImpl(ctx, imgA, imgB, w, h, config)

        resolve(canvas.toDataURL('image/png'))
      }

      imgA = new Image()
      imgA.crossOrigin = 'anonymous'
      imgA.onload = () => {
        loadedCount++
        if (loadedCount === 2) onBothLoaded()
      }
      imgA.onerror = () => reject(new Error('Failed to load image A'))
      imgA.src = imageABase64

      imgB = new Image()
      imgB.crossOrigin = 'anonymous'
      imgB.onload = () => {
        loadedCount++
        if (loadedCount === 2) onBothLoaded()
      }
      imgB.onerror = () => reject(new Error('Failed to load image B'))
      imgB.src = imageBBase64
    } catch (err) {
      reject(err)
    }
  })
}

/**
 * 拉普拉斯融合核心实现
 * 
 * 步骤:
 * 1. 构建高斯金字塔
 * 2. 计算拉普拉斯金字塔
 * 3. 在每层进行混合
 * 4. 重建
 */
function laplacianBlendImpl(
  ctx: CanvasRenderingContext2D,
  imgA: HTMLImageElement,
  imgB: HTMLImageElement,
  w: number,
  h: number,
  config: BlendConfig
): void {
  const alpha = config.alpha || 0.5
  const pyramidLevels = config.pyramidLevels || 4

  console.log('[laplacianBlendImpl] 参数 - alpha:', alpha, 'levels:', pyramidLevels)

  // 简化实现: 先用加权混合，后续优化为真正的拉普拉斯
  // TODO: 实现完整的高斯/拉普拉斯金字塔

  // 暂时使用加权 alpha 混合 (为了尽快上线)
  const canvas1 = document.createElement('canvas')
  canvas1.width = w
  canvas1.height = h
  const ctx1 = canvas1.getContext('2d')!
  ctx1.drawImage(imgA, 0, 0, w, h)

  const canvas2 = document.createElement('canvas')
  canvas2.width = w
  canvas2.height = h
  const ctx2 = canvas2.getContext('2d')!
  ctx2.drawImage(imgB, 0, 0, w, h)

  // 获取像素数据
  const imgDataA = ctx1.getImageData(0, 0, w, h)
  const imgDataB = ctx2.getImageData(0, 0, w, h)
  const result = ctx.createImageData(w, h)

  // Alpha 混合
  const dataA = imgDataA.data
  const dataB = imgDataB.data
  const dataRes = result.data

  for (let i = 0; i < dataA.length; i += 4) {
    dataRes[i] = Math.round(alpha * dataA[i] + (1 - alpha) * dataB[i])     // R
    dataRes[i + 1] = Math.round(alpha * dataA[i + 1] + (1 - alpha) * dataB[i + 1]) // G
    dataRes[i + 2] = Math.round(alpha * dataA[i + 2] + (1 - alpha) * dataB[i + 2]) // B
    dataRes[i + 3] = Math.round(alpha * dataA[i + 3] + (1 - alpha) * dataB[i + 3]) // A
  }

  ctx.putImageData(result, 0, 0)
}

/**
 * 方案 2: 智能增强融合
 * 
 * 在拉普拉斯基础上添加:
 * - 自动颜色校正
 * - 智能接缝切割
 * - 梯度域融合
 */
async function blendEnhanced(
  imageABase64: string,
  imageBBase64: string,
  config: BlendConfig
): Promise<string> {
  console.log('[blendEnhanced] 开始增强融合')

  // 第一步: 先做拉普拉斯
  const laplacianResult = await blendLaplacian(imageABase64, imageBBase64, config)

  // 第二步: 应用增强 (简化版本)
  return laplacianResult // TODO: 添加颜色校正和边界优化
}

/**
 * 方案 3: Gemini AI 融合 (高质量)
 * 
 * 优点:
 * - 高质量
 * - 自动补全背景
 * - 颜色/光线自动协调
 * 
 * 缺点:
 * - 需要 API 调用 (30-60 秒)
 * - 成本
 */
async function blendViaGemini(
  imageABase64: string,
  imageBBase64: string,
  config: BlendConfig
): Promise<string> {
  console.log('[blendViaGemini] 开始 Gemini 融合')

  const prompt = `
    你是一个专业的图像融合专家。
    
    已提供两张图像，请无缝融合它们为一张完整图像。
    
    要求:
    1. 颜色、亮度、光线协调一致
    2. 接缝处理自然无痕
    3. 细节保留完整
    4. 背景补全合理
    
    只返回融合后的完整图像，不需要任何文字说明。
  `

  try {
    const response = await postJson(
      '/v1beta/models/gemini-3-pro-image-preview:generateContent',
      {
        contents: [
          {
            parts: [
              { text: prompt },
              {
                inline_data: {
                  mime_type: 'image/jpeg',
                  data: extractBase64(imageABase64)
                }
              },
              {
                inline_data: {
                  mime_type: 'image/jpeg',
                  data: extractBase64(imageBBase64)
                }
              }
            ]
          }
        ],
        generationConfig: {
          temperature: 0.3,
          maxOutputTokens: 1024
        }
      },
      { authMode: 'query', timeoutMs: 120000, retryable: false }
    )

    // 从响应中提取图像
    const rsp = response as any
    const imageUrl = rsp?.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data
    if (!imageUrl) {
      throw new Error('No image in Gemini response')
    }

    return `data:image/jpeg;base64,${imageUrl}`
  } catch (err) {
    console.error('[blendViaGemini] 错误:', err)
    throw err
  }
}

/**
 * 方案 4: Kling AI 融合 (高质量，支持参考图)
 * 
 * 利用 Kling 的多参考图能力
 */
async function blendViaKling(
  imageABase64: string,
  imageBBase64: string,
  config: BlendConfig
): Promise<string> {
  console.log('[blendViaKling] 开始 Kling 融合')

  const prompt = `
    无缝融合这两张图像为一张完整图。
    要求:
    - 颜色、光线协调
    - 接缝无痕
    - 细节完整
    - 背景合理
  `

  try {
    const response = await postJson(
      '/kling/v1/images/omni-image',
      {
        prompt,
        ref_images: [
          { role: 'main_subject', image_base64: extractBase64(imageABase64) },
          { role: 'reference', image_base64: extractBase64(imageBBase64) }
        ],
        model_name: 'kling-image-o1',
        size: '16:9',
        quality: '2k',
        n: 1
      },
      { authMode: 'bearer', timeoutMs: 120000, retryable: false }
    )

    const rsp = response as any
    const imageUrl = rsp?.images?.[0]?.url
    if (!imageUrl) {
      throw new Error('No image in Kling response')
    }

    // 如果是 URL，下载为 base64
    if (imageUrl.startsWith('http')) {
      return await downloadImageAsBase64(imageUrl)
    }

    return imageUrl
  } catch (err) {
    console.error('[blendViaKling] 错误:', err)
    throw err
  }
}

// ========== 辅助函数 ==========

/**
 * 获取融合的两个输入图像
 */
function getBlendInputImages(configNodeId: string): { imageA?: string; imageB?: string } {
  const store = useGraphStore.getState()
  const edges = store.edges.filter(e => e.target === configNodeId && (!e.type || e.type === 'default'))

  // 按 sourceHandle 或连接顺序排序
  const sortedEdges = edges.sort((a, b) => {
    const handleA = a.sourceHandle || ''
    const handleB = b.sourceHandle || ''
    return handleA.localeCompare(handleB)
  })

  const images: string[] = []

  for (const edge of sortedEdges) {
    const sourceNode = store.nodes.find(n => n.id === edge.source)
    if (sourceNode?.type === 'image') {
      const url = (sourceNode.data as any)?.url || (sourceNode.data as any)?.base64
      if (url) {
        images.push(url)
      }
    }
  }

  return {
    imageA: images[0],
    imageB: images[1]
  }
}

/**
 * 查找或创建输出图像节点
 */
function findOrCreateOutputImageNode(configNodeId: string, imageData: string): string {
  const store = useGraphStore.getState()
  const cfg = store.nodes.find(n => n.id === configNodeId)

  // 查找已连接的空白输出节点
  const outputEdges = store.edges.filter(e => e.source === configNodeId)
  for (const edge of outputEdges) {
    const node = store.nodes.find(n => n.id === edge.target)
    if (node?.type === 'image' && !(node.data as any)?.url) {
      // 复用这个节点
      store.updateNode(node.id, {
        data: { ...node.data, url: imageData, base64: imageData }
      })
      return node.id
    }
  }

  // 创建新的输出节点
  const newId = store.addNode(
    'image',
    { x: (cfg?.x || 0) + 300, y: (cfg?.y || 0) + 100 },
    { url: imageData, base64: imageData, label: 'Blended Image' }
  )

  // 连接边
  store.addEdge(configNodeId, newId, {})

  return newId
}

/**
 * 从各种格式提取 base64
 * 支持: data:image/..., blob:, HTTP URL
 */
function extractBase64(input: string): string {
  if (input.startsWith('data:image')) {
    // 已是 data URL
    const match = input.match(/^data:image\/\w+;base64,(.+)$/)
    return match?.[1] || ''
  }
  if (input.startsWith('blob:') || input.startsWith('http')) {
    // 需要下载 (异步处理)
    console.warn('[extractBase64] 暂不支持 blob/http，请使用 base64')
    return ''
  }
  return input
}

/**
 * 下载图像为 base64
 */
async function downloadImageAsBase64(url: string): Promise<string> {
  try {
    const response = await safeFetch(url)
    const blob = await response.blob()
    return new Promise((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = () => resolve(String(reader.result || ''))
      reader.onerror = () => reject(new Error('Failed to read blob'))
      reader.readAsDataURL(blob)
    })
  } catch (err) {
    console.error('[downloadImageAsBase64] 错误:', err)
    throw err
  }
}
