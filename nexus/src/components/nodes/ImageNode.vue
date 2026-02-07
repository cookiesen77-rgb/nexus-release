<template>
  <!-- Image node wrapper for hover area | 图片节点包裹层，扩展悬浮区域 -->
  <div class="image-node-wrapper" @mouseenter="showActions = true" @mouseleave="showActions = false">
    <!-- Image node | 图片节点 -->
    <div
      class="image-node bg-[var(--bg-secondary)] rounded-xl border min-w-[200px] max-w-[280px] relative transition-all duration-200"
      :class="data.selected ? 'border-1 border-blue-500 shadow-lg shadow-blue-500/20' : 'border border-[var(--border-color)]'">
      <!-- Header | 头部 -->
      <div class="px-3 py-2 border-b border-[var(--border-color)]">
        <div class="flex items-center justify-between">
          <span class="text-sm font-medium text-[var(--text-primary)]">{{ data.label || '图像生成结果' }}</span>
          <div class="flex items-center gap-1">
            <button @click.stop="handleDelete" class="p-1 hover:bg-[var(--bg-tertiary)] rounded transition-colors">
              <n-icon :size="14">
                <TrashOutline />
              </n-icon>
            </button>
            <!-- <button class="p-1 hover:bg-[var(--bg-tertiary)] rounded transition-colors">
              <n-icon :size="14">
                <ExpandOutline />
              </n-icon>
            </button> -->
          </div>
        </div>
        <!-- Model name | 模型名称 -->
        <div v-if="displayModel" class="mt-1 text-xs text-[var(--text-secondary)] truncate">
          {{ displayModel }}
        </div>
      </div>

      <!-- Image preview area | 图片预览区域 -->
      <div class="p-3">
        <!-- Loading state | 加载状态 -->
        <div v-if="data.loading"
          class="aspect-square rounded-xl bg-gradient-to-br from-cyan-400 via-blue-300 to-amber-200 flex flex-col items-center justify-center gap-3 relative overflow-hidden">
          <!-- Animated gradient overlay | 动画渐变遮罩 -->
          <div
            class="absolute inset-0 bg-gradient-to-br from-cyan-500/20 via-blue-400/20 to-amber-300/20 animate-pulse">
          </div>

          <!-- Loading image | 加载图片 -->
          <div class="relative z-10">
            <img src="../../assets/loading.webp" alt="Loading" class="w-14 h-12" />
          </div>

          <span class="text-sm text-white font-medium relative z-10">创作中</span>
        </div>

        <!-- Error state | 错误状态 -->
        <div v-else-if="data.error"
          class="aspect-square rounded-xl bg-red-50 dark:bg-red-900/20 flex flex-col items-center justify-center gap-2 border border-red-200 dark:border-red-800">
          <n-icon :size="32" class="text-red-500">
            <CloseCircleOutline />
          </n-icon>
          <span class="text-sm text-red-600 dark:text-red-400 text-center px-2">{{ data.error }}</span>
        </div>

        <!-- Image load error | 图片加载失败 -->
        <div v-else-if="imageLoadError"
          class="aspect-square rounded-xl bg-red-50 dark:bg-red-900/20 flex flex-col items-center justify-center gap-2 border border-red-200 dark:border-red-800">
          <n-icon :size="32" class="text-red-500">
            <CloseCircleOutline />
          </n-icon>
          <span class="text-sm text-red-600 dark:text-red-400 text-center px-2">{{ imageLoadError }}</span>
        </div>

        <!-- Image display | 图片显示 -->
        <div 
          v-else-if="displayUrl" 
          class="rounded-xl overflow-hidden relative" 
          ref="imageContainerRef"
        >
          <img 
            :src="displayUrl" 
            :alt="data.label" 
            class="w-full h-auto object-cover nodrag"
            :class="{ 'pointer-events-none': isInpaintMode }"
            @error="handleImageError"
            loading="lazy"
            decoding="async"
            @mousedown.stop
            @click.stop
          />
          
          <!-- Inpaint canvas with events | 涂抹画布（带事件） -->
          <canvas 
            v-if="isInpaintMode"
            ref="canvasRef"
            class="absolute inset-0 w-full h-full cursor-none z-10"
            @mousedown.stop.prevent="onCanvasPaint"
            @mousemove.stop="onCanvasMove"
            @mouseup.stop="onPaintEnd"
            @mouseleave="onPaintEnd"
          />
          
          <!-- Brush cursor | 画笔光标 -->
          <div 
            v-show="brushCursor.visible && isInpaintMode"
            class="absolute pointer-events-none border-2 border-purple-500 rounded-full bg-purple-400/30 transition-none"
            :style="{
              width: brushSize * 2 + 'px',
              height: brushSize * 2 + 'px',
              left: brushCursor.x - brushSize + 'px',
              top: brushCursor.y - brushSize + 'px'
            }"
          />
          
          <!-- Inpaint toolbar | 涂抹工具栏 -->
          <div 
            v-show="isInpaintMode"
            class="absolute top-1.5 left-1/2 -translate-x-1/2 flex items-center gap-1.5 px-2 py-1 bg-white/95 dark:bg-gray-800/95 backdrop-blur-sm rounded-full shadow-md border border-gray-200/80 dark:border-gray-700 z-[9999]"
            @mousedown.stop
            @click.stop
          >
            <!-- Mode indicator | 模式指示 -->
            <div class="flex items-center gap-1 text-xs text-gray-500 dark:text-gray-400 pr-1.5 border-r border-gray-200 dark:border-gray-600">
              <n-icon :size="12"><BrushOutline /></n-icon>
              <span>擦除</span>
            </div>
            
            <!-- Size slider | 大小滑块 -->
            <div class="flex items-center gap-1 w-16">
              <div class="w-1.5 h-1.5 rounded-full bg-purple-400"></div>
              <input 
                type="range" 
                v-model="brushSize" 
                min="10" 
                max="80" 
                class="w-full h-0.5 bg-gray-200 rounded-lg appearance-none cursor-pointer slider-purple"
              />
              <div class="w-2.5 h-2.5 rounded-full bg-purple-400"></div>
            </div>
            
            <!-- Reset button | 重置按钮 -->
            <button 
              @click="clearMask"
              class="p-1 hover:bg-gray-100 dark:hover:bg-gray-700 rounded transition-colors"
              title="清除"
            >
              <n-icon :size="12" class="text-gray-400"><RefreshOutline /></n-icon>
            </button>
            
            <!-- Apply button | 应用按钮 -->
            <button 
              @click="applyInpaint"
              class="px-2 py-0.5 bg-purple-500 hover:bg-purple-600 text-white text-xs rounded transition-colors"
            >
              应用
            </button>
          </div>
        </div>

        <!-- Upload placeholder | 上传占位 -->
        <div v-else
          class="aspect-square rounded-xl bg-[var(--bg-tertiary)] flex flex-col items-center justify-center gap-2 border-2 border-dashed border-[var(--border-color)] relative">
          <n-icon :size="32" class="text-[var(--text-secondary)]">
            <ImageOutline />
          </n-icon>
          <span class="text-sm text-[var(--text-secondary)] text-center">拖放图片或点击上传</span>
          <input type="file" accept="image/*" class="absolute inset-0 opacity-0 cursor-pointer nodrag"
            @change="handleFileUpload"
            @mousedown.stop
            @click.stop />
        </div>
      </div>

      <!-- Handles | 连接点 -->
      <Handle type="source" :position="Position.Right" id="right" class="!bg-[var(--accent-color)]" />
      <Handle type="target" :position="Position.Left" id="left" class="!bg-[var(--accent-color)]" />
    </div>

    <!-- Hover action buttons | 悬浮操作按钮 -->
    <!-- Top right - Copy button | 右上角 - 复制按钮 -->
    <div v-show="showActions" class="absolute -top-5 right-12 z-[1000]">
      <button @click="handleDuplicate"
        class="action-btn group p-2 bg-white rounded-lg transition-all border border-gray-200 flex items-center gap-0 hover:gap-1.5  w-max">
        <n-icon :size="16" class="text-gray-600">
          <CopyOutline />
        </n-icon>
        <span
          class="text-xs text-gray-600 max-w-0 overflow-hidden group-hover:max-w-[60px] transition-all duration-200 whitespace-nowrap">复制</span>
      </button>
    </div>

    <!-- Right side - Action buttons | 右侧 - 操作按钮 -->
    <div v-show="showActions && displayUrl"
      class="absolute right-10 top-1/2 -translate-y-1/2 translate-x-full flex flex-col gap-2 z-[1000]">
      <!-- Inpaint button | 涂抹重绘按钮 -->
      <!-- <button @click="toggleInpaintMode"
        class="action-btn group p-2 bg-white rounded-lg transition-all border border-gray-200 flex items-center gap-0 hover:gap-1.5 w-max"
        :class="{ 'border-purple-400 bg-purple-50': isInpaintMode }">
        <n-icon :size="16" :class="isInpaintMode ? 'text-purple-500' : 'text-gray-600'">
          <BrushOutline />
        </n-icon>
        <span
          class="text-xs max-w-0 overflow-hidden group-hover:max-w-[80px] transition-all duration-200 whitespace-nowrap"
          :class="isInpaintMode ? 'text-purple-500' : 'text-gray-600'">局部重绘</span>
      </button> -->
      <!-- Image generation button | 图片生图按钮 -->
      <button @click="handleImageGen"
        class="action-btn group p-2 bg-white rounded-lg transition-all border border-gray-200 flex items-center gap-0 hover:gap-1.5  w-max">
        <n-icon :size="16" class="text-gray-600">
          <ImageOutline />
        </n-icon>
        <span
          class="text-xs text-gray-600 max-w-0 overflow-hidden group-hover:max-w-[80px] transition-all duration-200 whitespace-nowrap">图片生图</span>
      </button>
      <!-- Crop button | 裁剪按钮 -->
      <button @click="handleCrop"
        class="action-btn group p-2 bg-white rounded-lg transition-all border border-gray-200 flex items-center gap-0 hover:gap-1.5  w-max">
        <n-icon :size="16" class="text-gray-600">
          <CropOutline />
        </n-icon>
        <span
          class="text-xs text-gray-600 max-w-0 overflow-hidden group-hover:max-w-[60px] transition-all duration-200 whitespace-nowrap">裁剪</span>
      </button>
      <!-- Preview button | 预览按钮 -->
      <button @click="handlePreview"
        class="action-btn group p-2 bg-white rounded-lg transition-all border border-gray-200 flex items-center gap-0 hover:gap-1.5 w-max">
        <n-icon :size="16" class="text-gray-600">
          <EyeOutline />
        </n-icon>
        <span
          class="text-xs text-gray-600 max-w-0 overflow-hidden group-hover:max-w-[80px] transition-all duration-200 whitespace-nowrap">预览</span>
      </button>
      <!-- Download button | 下载按钮 -->
      <button @click="handleDownload"
        class="action-btn group p-2 bg-white rounded-lg transition-all border border-gray-200 flex items-center gap-0 hover:gap-1.5  w-max">
        <n-icon :size="16" class="text-gray-600">
          <DownloadOutline />
        </n-icon>
        <span
          class="text-xs text-gray-600 max-w-0 overflow-hidden group-hover:max-w-[80px] transition-all duration-200 whitespace-nowrap">下载</span>
      </button>
      <!-- Video generation button | 视频生成按钮 -->
      <button @click="handleVideoGen"
        class="action-btn group p-2 bg-white rounded-lg transition-all border border-gray-200 flex items-center gap-0 hover:gap-1.5  w-max">
        <n-icon :size="16" class="text-gray-600">
          <VideocamOutline />
        </n-icon>
        <span
          class="text-xs text-gray-600 max-w-0 overflow-hidden group-hover:max-w-[80px] transition-all duration-200 whitespace-nowrap">视频生成</span>
      </button>
    </div>

    <!-- Image Cropper Modal | 图片裁剪弹窗 -->
    <ImageCropper
      v-model:show="showCropper"
      :image-src="displayUrl"
      @confirm="handleCropConfirm"
      @cancel="showCropper = false"
    />
  </div>
</template>

<script setup>
/**
 * Image node component | 图片节点组件
 * Displays and manages image content with loading state
 */
import { ref, nextTick, computed, watch, onMounted } from 'vue'
import { Handle, Position, useVueFlow } from '@vue-flow/core'
import { NIcon } from 'naive-ui'
import { TrashOutline, ExpandOutline, ImageOutline, CloseCircleOutline, CopyOutline, VideocamOutline, DownloadOutline, EyeOutline, BrushOutline, RefreshOutline, ColorWandOutline, CropOutline } from '@vicons/ionicons5'
import ImageCropper from '../ImageCropper.vue'
import { updateNode, removeNode, duplicateNode, addNode, addEdge, nodes, withBatchUpdates } from '../../stores/canvas'
import { DEFAULT_IMAGE_MODEL, DEFAULT_IMAGE_SIZE } from '../../config/models'
import { getModelConfig } from '../../stores/models'

const props = defineProps({
  id: String,
  data: Object
})

let tauriApi = null
const isTauriEnv = ref(false)
const resolvedAssetUrl = ref('')
const rawUrl = computed(() => (typeof props.data?.url === 'string' ? props.data.url : ''))
const localPath = computed(() => (typeof props.data?.localPath === 'string' ? props.data.localPath : ''))

const displayUrl = computed(() => {
  if (isTauriEnv.value && localPath.value && tauriApi?.convertFileSrc) {
    try {
      return tauriApi.convertFileSrc(localPath.value)
    } catch {
      // fall through
    }
  }
  return resolvedAssetUrl.value || rawUrl.value
})
const displayModel = computed(() => {
  const modelKey = typeof props.data?.model === 'string' ? props.data.model : ''
  if (!modelKey) return ''
  const cfg = getModelConfig(modelKey)
  return cfg?.label || modelKey
})
const imageLoadError = ref('')

const getApiKey = () => {
  try { return localStorage.getItem('apiKey') || '' } catch { return '' }
}

const ensureCachedImage = async (reason = 'prefetch') => {
  const url = rawUrl.value
  if (!url || typeof url !== 'string') return
  if (!isTauriEnv.value) return
  if (!/^https?:\/\//i.test(url)) return
  if (props.data?.localSourceUrl === url && localPath.value) return

  try {
    if (!tauriApi) tauriApi = await import('@tauri-apps/api/core')
    if (!tauriApi?.isTauri?.()) return
    const path = await tauriApi.invoke('cache_remote_image', { url, authToken: getApiKey() || null })
    if (typeof path === 'string' && path) {
      updateNode(props.id, { localPath: path, localSourceUrl: url })
      resolvedAssetUrl.value = tauriApi.convertFileSrc(path)
      if (reason !== 'prefetch') {
        window.$message?.info('已使用本地缓存加载图片')
      }
    }
  } catch {
    // ignore
  }
}

const handleImageError = async () => {
  imageLoadError.value = '图片加载失败（可能链接已过期或被拦截）'
  await ensureCachedImage('onerror')
}

watch(
  () => rawUrl.value,
  () => {
    imageLoadError.value = ''
    resolvedAssetUrl.value = ''
    ensureCachedImage('prefetch')
  }
)

onMounted(async () => {
  try {
    tauriApi = await import('@tauri-apps/api/core')
    isTauriEnv.value = !!tauriApi?.isTauri?.()
  } catch {
    isTauriEnv.value = false
  }
  ensureCachedImage('prefetch')
})

// Vue Flow instance | Vue Flow 实例
const { updateNodeInternals } = useVueFlow()

// Hover state | 悬浮状态
const showActions = ref(true)

// Cropper state | 裁剪器状态
const showCropper = ref(false)

// Inpainting state | 涂抹重绘状态
const isInpaintMode = ref(false)
const brushSize = ref(40)
const isDrawing = ref(false)
const canvasRef = ref(null)
const imageContainerRef = ref(null)
const interactionLayerRef = ref(null)
const brushCursor = ref({ x: 0, y: 0, visible: false })
const maskData = ref(null)

// Toggle inpaint mode | 切换涂抹模式
const toggleInpaintMode = () => {
  isInpaintMode.value = !isInpaintMode.value
  if (isInpaintMode.value) {
    nextTick(() => initCanvas())
  } else {
    clearMask()
  }
}

// Initialize canvas | 初始化画布
const initCanvas = () => {
  setTimeout(() => {
    const canvas = canvasRef.value
    if (!canvas) return
    
    // Set canvas internal size to match its CSS rendered size | 设置画布内部尺寸匹配 CSS 渲染尺寸
    // clientWidth/clientHeight give the CSS box size
    canvas.width = canvas.clientWidth
    canvas.height = canvas.clientHeight
    
    const ctx = canvas.getContext('2d')
    ctx.clearRect(0, 0, canvas.width, canvas.height)
  }, 100)
}

// Ensure canvas size matches display | 确保画布尺寸匹配显示
const syncCanvasSize = () => {
  const canvas = canvasRef.value
  if (!canvas) return
  if (canvas.width !== canvas.clientWidth || canvas.height !== canvas.clientHeight) {
    canvas.width = canvas.clientWidth
    canvas.height = canvas.clientHeight
  }
}

// Canvas paint handlers | 画布绘制处理器
const onCanvasPaint = (e) => {
  syncCanvasSize()
  isDrawing.value = true
  paintAt(e.offsetX, e.offsetY)
  brushCursor.value = { x: e.offsetX, y: e.offsetY, visible: true }
}

const onCanvasMove = (e) => {
  brushCursor.value = { x: e.offsetX, y: e.offsetY, visible: true }
  if (isDrawing.value) {
    paintAt(e.offsetX, e.offsetY)
  }
}

const onPaintEnd = () => {
  isDrawing.value = false
  brushCursor.value.visible = false
}

// Paint at coordinates | 在坐标绘制
const paintAt = (x, y) => {
  const canvas = canvasRef.value
  if (!canvas) return
  
  const ctx = canvas.getContext('2d')
  ctx.beginPath()
  ctx.arc(x, y, brushSize.value, 0, Math.PI * 2)
  ctx.fillStyle = 'rgba(139, 92, 246, 0.5)'
  ctx.fill()
}

// Hide brush cursor | 隐藏画笔光标
const hideBrushCursor = () => {
  brushCursor.value.visible = false
}

// Clear mask | 清除蒙版
const clearMask = () => {
  const canvas = canvasRef.value
  if (!canvas) return
  
  const ctx = canvas.getContext('2d')
  ctx.clearRect(0, 0, canvas.width, canvas.height)
  maskData.value = null
}

// Apply inpaint and create workflow | 应用重绘并创建工作流
const applyInpaint = () => {
  const canvas = canvasRef.value
  if (!canvas || canvas.width === 0 || canvas.height === 0) {
    window.$message?.error('画布未初始化')
    return
  }
  
  // Get the original image and resize mask to match | 获取原图并调整蒙版大小匹配
  const container = imageContainerRef.value
  const img = container?.querySelector('img')
  if (!img) {
    window.$message?.error('未找到图片')
    return
  }
  
  // Create mask at original image resolution | 创建原图分辨率的蒙版
  const maskCanvas = document.createElement('canvas')
  const imgWidth = img.naturalWidth || img.width
  const imgHeight = img.naturalHeight || img.height
  maskCanvas.width = imgWidth
  maskCanvas.height = imgHeight
  const maskCtx = maskCanvas.getContext('2d')
  
  // Fill black background | 填充黑色背景
  maskCtx.fillStyle = '#000000'
  maskCtx.fillRect(0, 0, maskCanvas.width, maskCanvas.height)
  
  // Scale factor from display to original | 从显示尺寸到原图的缩放因子
  const scaleX = imgWidth / canvas.width
  const scaleY = imgHeight / canvas.height
  
  // Get painted areas and scale to original resolution | 获取绑制区域并缩放到原图分辨率
  const originalData = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height)
  
  // Draw scaled white areas on mask | 在蒙版上绘制缩放后的白色区域
  maskCtx.fillStyle = '#FFFFFF'
  for (let y = 0; y < canvas.height; y++) {
    for (let x = 0; x < canvas.width; x++) {
      const i = (y * canvas.width + x) * 4
      if (originalData.data[i + 3] > 0) {
        // Scale and draw | 缩放并绘制
        maskCtx.fillRect(
          Math.floor(x * scaleX),
          Math.floor(y * scaleY),
          Math.ceil(scaleX),
          Math.ceil(scaleY)
        )
      }
    }
  }
  
  // Convert to base64 (remove data URL prefix for API) | 转换为 base64（移除前缀用于 API）
  const dataUrl = maskCanvas.toDataURL('image/png')
  const base64Data = dataUrl.replace(/^data:image\/\w+;base64,/, '')
  maskData.value = base64Data
  
  // Create inpaint workflow | 创建重绘工作流
  createInpaintWorkflow()
}

// Create inpaint workflow | 创建重绘工作流
const createInpaintWorkflow = () => {
  const currentNode = nodes.value.find(n => n.id === props.id)
  const nodeX = currentNode?.position?.x || 0
  const nodeY = currentNode?.position?.y || 0
  
  // Create text node for prompt | 创建文本节点用于提示词
  const textNodeId = addNode('text', { x: nodeX + 300, y: nodeY - 100 }, {
    content: '请输入重绘提示词...',
    label: '重绘提示词'
  })
  
  // Create imageConfig node for inpainting | 创建图生图配置节点
  const configNodeId = addNode('imageConfig', { x: nodeX + 600, y: nodeY }, {
    model: DEFAULT_IMAGE_MODEL,
    size: '1024x1024',
    label: '局部重绘',
    inpaintMode: true
  })
  
  // Update current node with mask data | 更新当前节点的蒙版数据
  updateNode(props.id, {
    maskData: maskData.value,
    hasInpaintMask: true
  })
  
  // Connect image node to config node | 连接图片节点到配置节点
  addEdge({
    source: props.id,
    target: configNodeId,
    sourceHandle: 'right',
    targetHandle: 'left'
  })
  
  // Connect text node to config node | 连接文本节点到配置节点
  addEdge({
    source: textNodeId,
    target: configNodeId,
    sourceHandle: 'right',
    targetHandle: 'left'
  })
  
  // Exit inpaint mode | 退出涂抹模式
  isInpaintMode.value = false
  
  // Force Vue Flow to recalculate | 强制重新计算
  setTimeout(() => {
    updateNodeInternals([textNodeId, configNodeId])
  }, 50)
  
  window.$message?.success('已创建局部重绘工作流')
}

// Convert file to base64 | 将文件转换为 base64
const fileToBase64 = (file) => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result)
    reader.onerror = reject
    reader.readAsDataURL(file)
  })
}

// Handle file upload | 处理文件上传
const handleFileUpload = async (event) => {
  const file = event.target.files[0]
  if (file) {
    try {
      // Convert to base64 | 转换为 base64
      const base64 = await fileToBase64(file)
      // Store as persistent DataURL (avoid duplicating the same huge string) | 使用可持久化 DataURL（避免重复存两份大字符串）
      updateNode(props.id, {
        url: base64,  // Use DataURL as display + API input | DataURL 既可展示也可直接作为接口输入
        fileName: file.name,
        fileType: file.type,
        label: '参考图',
        updatedAt: Date.now()
      })
    } catch (err) {
      console.error('File upload error:', err)
      window.$message?.error('图片上传失败')
    }
  }
}

// Handle delete | 处理删除
const handleDelete = () => {
  removeNode(props.id)
}

// Handle duplicate | 处理复制
const handleDuplicate = () => {
  const newId = duplicateNode(props.id)
  if (newId) {
    // Clear selection and select the new node | 清除选中并选中新节点
    updateNode(props.id, { selected: false })
    updateNode(newId, { selected: true })
    window.$message?.success('节点已复制')
    setTimeout(() => {
      updateNodeInternals(newId)
    }, 50)
  }
}

// Handle image generation | 处理图片生图
const handleImageGen = () => {
  const currentNode = nodes.value.find(n => n.id === props.id)
  const nodeX = currentNode?.position?.x || 0
  const nodeY = currentNode?.position?.y || 0

  // Create text node for prompt | 创建文本节点用于提示词
  const textNodeId = addNode('text', { x: nodeX + 300, y: nodeY - 100 }, {
    content: '',
    label: '提示词'
  })

  // Create imageConfig node | 创建文生图配置节点
  const configNodeId = addNode('imageConfig', { x: nodeX + 600, y: nodeY }, {
    model: DEFAULT_IMAGE_MODEL,
    size: DEFAULT_IMAGE_SIZE,
    label: '图生图'
  })

  // Connect image node to config node | 连接图片节点到配置节点
  addEdge({
    source: props.id,
    target: configNodeId,
    sourceHandle: 'right',
    targetHandle: 'left'
  })

  // Connect text node to config node | 连接文本节点到配置节点
  addEdge({
    source: textNodeId,
    target: configNodeId,
    sourceHandle: 'right',
    targetHandle: 'left'
  })

  // Force Vue Flow to recalculate node dimensions | 强制 Vue Flow 重新计算节点尺寸
  setTimeout(() => {
    updateNodeInternals([textNodeId, configNodeId])
  }, 50)
}

// Handle preview | 处理预览
const handlePreview = () => {
  if (displayUrl.value) {
    window.open(displayUrl.value, '_blank')
  }
}

// Handle download | 处理下载
const handleDownload = () => {
  if (displayUrl.value) {
    const link = document.createElement('a')
    link.href = displayUrl.value
    link.download = props.data.fileName || `image_${Date.now()}.png`
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
    window.$message?.success('图片下载中...')
  }
}

// Handle video generation | 处理视频生成
const handleVideoGen = () => {
  const currentNode = nodes.value.find(n => n.id === props.id)
  const nodeX = currentNode?.position?.x || 0
  const nodeY = currentNode?.position?.y || 0
  const maxZIndex = Math.max(0, ...nodes.value.map(n => n.zIndex || 0))

  let textNodeId = null
  let configNodeId = null

  withBatchUpdates(() => {
    // Create text node for prompt | 创建文本节点用于提示词
    textNodeId = addNode('text', { x: nodeX + 300, y: nodeY - 100 }, {
      content: '',
      label: '提示词',
      zIndex: maxZIndex + 1
    })

    // Create videoConfig node | 创建视频配置节点
    configNodeId = addNode('videoConfig', { x: nodeX + 600, y: nodeY }, {
      label: '视频生成',
      zIndex: maxZIndex + 2
    })

    // Connect image node to config node with role | 连接图片节点到配置节点并设置角色
    addEdge({
      source: props.id,
      target: configNodeId,
      sourceHandle: 'right',
      targetHandle: 'left',
      type: 'imageRole',
      data: { imageRole: 'first_frame_image' } // Default to first frame | 默认首帧
    })

    // Connect text node to config node | 连接文本节点到配置节点
    addEdge({
      source: textNodeId,
      target: configNodeId,
      sourceHandle: 'right',
      targetHandle: 'left'
    })
  })

  // Force Vue Flow to recalculate node dimensions | 强制 Vue Flow 重新计算节点尺寸
  setTimeout(() => {
    if (textNodeId) updateNodeInternals(textNodeId)
    if (configNodeId) updateNodeInternals(configNodeId)
  }, 50)
}

// Handle crop | 处理裁剪
const handleCrop = () => {
  if (displayUrl.value) {
    showCropper.value = true
  }
}

// Handle crop confirm | 处理裁剪确认
const handleCropConfirm = (croppedBase64) => {
  updateNode(props.id, {
    url: croppedBase64,
    updatedAt: Date.now()
  })
  showCropper.value = false
  window.$message?.success('图片已裁剪')
}
</script>

<style scoped>
.image-node-wrapper {
  position: relative;
  padding-right: 50px;
  padding-top: 20px;
}

.image-node {
  cursor: default;
  position: relative;
}

/* Slider styling | 滑块样式 */
.slider-purple::-webkit-slider-thumb {
  -webkit-appearance: none;
  appearance: none;
  width: 12px;
  height: 12px;
  border-radius: 50%;
  background: #8b5cf6;
  cursor: pointer;
  border: 2px solid white;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.2);
}

.slider-purple::-moz-range-thumb {
  width: 12px;
  height: 12px;
  border-radius: 50%;
  background: #8b5cf6;
  cursor: pointer;
  border: 2px solid white;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.2);
}

/* Inpaint mode cursor | 涂抹模式光标 */
.cursor-none {
  cursor: none;
}
</style>
