<template>
  <!-- Video node wrapper for hover area | 视频节点包裹层，扩展悬浮区域 -->
  <div class="video-node-wrapper relative" @mouseenter="showActions = true" @mouseleave="showActions = false">
    <!-- Video node | 视频节点 -->
    <div 
      class="video-node bg-[var(--bg-secondary)] rounded-xl border w-[400px] relative transition-all duration-200"
      :class="data.selected ? 'border-1 border-blue-500 shadow-lg shadow-blue-500/20' : 'border border-[var(--border-color)]'"
      
    >
    <!-- Header | 头部 -->
    <div class="px-3 py-2 border-b border-[var(--border-color)]">
      <div class="flex items-center justify-between">
        <span class="text-sm font-medium text-[var(--text-secondary)]">{{ data.label }}</span>
        <div class="flex items-center gap-1">
          <button 
            @click="handleDelete"
            class="p-1 hover:bg-[var(--bg-tertiary)] rounded transition-colors"
          >
            <n-icon :size="14"><TrashOutline /></n-icon>
          </button>
          <!-- <button class="p-1 hover:bg-[var(--bg-tertiary)] rounded transition-colors">
            <n-icon :size="14"><ExpandOutline /></n-icon>
          </button> -->
        </div>
      </div>
      <!-- Model name | 模型名称 -->
      <div v-if="displayModel" class="mt-1 text-xs text-[var(--text-secondary)] truncate">
        {{ displayModel }}
      </div>
    </div>
    
    <!-- Video preview area | 视频预览区域 -->
    <div class="p-3">
      <!-- Loading state | 加载状态 -->
      <div 
        v-if="data.loading"
        class="aspect-video rounded-lg bg-gradient-to-br from-cyan-400 via-blue-300 to-amber-200 flex flex-col items-center justify-center gap-3 relative overflow-hidden"
      >
        <!-- Animated gradient overlay | 动画渐变遮罩 -->
        <div class="absolute inset-0 bg-gradient-to-br from-cyan-500/20 via-blue-400/20 to-amber-300/20 animate-pulse"></div>
        
        <!-- Loading image | 加载图片 -->
        <div class="relative z-10">
          <img 
            src="../../assets/loading.webp" 
            alt="Loading" 
            class="w-14 h-12"
          />
        </div>
        
        <span class="text-sm text-white font-medium relative z-10">创作中，预计等待 1 分钟</span>
      </div>
      <!-- Error state | 错误状态 -->
      <div 
        v-else-if="data.error"
        class="aspect-video rounded-lg bg-red-50 dark:bg-red-900/20 flex flex-col items-center justify-center gap-2 border border-red-200 dark:border-red-800"
      >
        <n-icon :size="32" class="text-red-500"><CloseCircleOutline /></n-icon>
        <span class="text-sm text-red-500">{{ data.error }}</span>
      </div>
      <!-- Video load error | 视频加载失败 -->
      <div
        v-else-if="videoLoadError"
        class="aspect-video rounded-lg bg-red-50 dark:bg-red-900/20 flex flex-col items-center justify-center gap-2 border border-red-200 dark:border-red-800"
      >
        <n-icon :size="32" class="text-red-500"><CloseCircleOutline /></n-icon>
        <span class="text-sm text-red-500">{{ videoLoadError }}</span>
      </div>
      <!-- Video preview | 视频预览 -->
      <div
        v-else-if="displayUrl"
        class="aspect-video rounded-lg overflow-hidden bg-black"
      >
        <video 
          ref="videoRef"
          :src="displayUrl"
          controls 
          crossorigin="anonymous"
          playsinline
          preload="metadata"
          class="w-full h-full object-contain nodrag"
          @error="handleVideoError"
        />
      </div>
      <!-- Empty state | 空状态 -->
      <div 
        v-else
        class="aspect-video rounded-lg bg-[var(--bg-tertiary)] flex flex-col items-center justify-center gap-2 border-2 border-dashed border-[var(--border-color)] relative"
      >
        <n-icon :size="32" class="text-[var(--text-secondary)]"><VideocamOutline /></n-icon>
        <span class="text-sm text-[var(--text-secondary)]">拖放视频或点击上传</span>
        <input 
          type="file" 
          accept="video/*" 
          class="absolute inset-0 opacity-0 cursor-pointer nodrag"
          @change="handleFileUpload"
          @mousedown.stop
          @click.stop
        />
      </div>
      
      <!-- Duration info | 时长信息 -->
      <div v-if="data.duration" class="mt-2 text-xs text-[var(--text-secondary)]">
        时长: {{ formatDuration(data.duration) }}
      </div>
    </div>

    <!-- Handles | 连接点 -->
    <Handle type="source" :position="Position.Right" id="right" class="!bg-[var(--accent-color)]" />
    <Handle type="target" :position="Position.Left" id="left" class="!bg-[var(--accent-color)]" />
    </div>

    <!-- Hover action buttons | 悬浮操作按钮 -->
    <!-- Top right - Copy button | 右上角 - 复制按钮 -->
    <div 
      v-show="showActions"
      class="absolute -top-5 right-12 z-[1000]"
    >
      <button 
        @click="handleDuplicate"
        class="action-btn group p-2 bg-white rounded-lg transition-all border border-gray-200 flex items-center gap-0 hover:gap-1.5 w-max"
      >
        <n-icon :size="16" class="text-gray-600"><CopyOutline /></n-icon>
        <span class="text-xs text-gray-600 max-w-0 overflow-hidden group-hover:max-w-[60px] transition-all duration-200 whitespace-nowrap">复制</span>
      </button>
    </div>

    <!-- Right side - Action buttons | 右侧 - 操作按钮 -->
    <div 
      v-show="showActions && displayUrl"
      class="absolute right-10 top-20 -translate-y-1/2 translate-x-full flex flex-col gap-2 z-[1000]"
    >
      <!-- Extract frame button | 截取当前帧 -->
      <button
        @click="handleExtractFrame"
        class="action-btn group p-2 bg-white rounded-lg transition-all border border-gray-200 flex items-center gap-0 hover:gap-1.5 w-max"
      >
        <n-icon :size="16" class="text-gray-600"><ImageOutline /></n-icon>
        <span class="text-xs text-gray-600 max-w-0 overflow-hidden group-hover:max-w-[90px] transition-all duration-200 whitespace-nowrap">提取当前帧</span>
      </button>
      <!-- Preview button | 预览按钮 -->
      <button 
        @click="handlePreview"
        class="action-btn group p-2 bg-white rounded-lg transition-all border border-gray-200 flex items-center gap-0 hover:gap-1.5 w-max"
      >
        <n-icon :size="16" class="text-gray-600"><EyeOutline /></n-icon>
        <span class="text-xs text-gray-600 max-w-0 overflow-hidden group-hover:max-w-[80px] transition-all duration-200 whitespace-nowrap">预览</span>
      </button>
      <!-- Download button | 下载按钮 -->
      <button 
        @click="handleDownload"
        class="action-btn group p-2 bg-white rounded-lg transition-all border border-gray-200 flex items-center gap-0 hover:gap-1.5 w-max"
      >
        <n-icon :size="16" class="text-gray-600"><DownloadOutline /></n-icon>
        <span class="text-xs text-gray-600 max-w-0 overflow-hidden group-hover:max-w-[80px] transition-all duration-200 whitespace-nowrap">下载</span>
      </button>
    </div>
  </div>
</template>

<script setup>
/**
 * Video node component | 视频节点组件
 * Displays and manages video content
 */
import { ref, computed, watch, onMounted } from 'vue'
import { Handle, Position, useVueFlow } from '@vue-flow/core'
import { NIcon, NSpin } from 'naive-ui'
import { TrashOutline, ExpandOutline, VideocamOutline, CopyOutline, CloseCircleOutline, DownloadOutline, EyeOutline, ImageOutline } from '@vicons/ionicons5'
import { updateNode, removeNode, duplicateNode, addNode, addEdge, nodes } from '../../stores/canvas'
import { getModelConfig } from '../../stores/models'
import { addAsset } from '../../stores/assets'

const props = defineProps({
  id: String,
  data: Object
})

const { updateNodeInternals } = useVueFlow()

let tauriApi = null
const isTauriEnv = ref(false)
const resolvedAssetUrl = ref('')
const rawUrl = computed(() => (typeof props.data?.url === 'string' ? props.data.url : ''))
const localPath = computed(() => (typeof props.data?.localPath === 'string' ? props.data.localPath : ''))
const videoLoadError = ref('')

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

// Hover state | 悬浮状态
const showActions = ref(false)
const videoRef = ref(null)
const displayModel = computed(() => {
  const modelKey = typeof props.data?.model === 'string' ? props.data.model : ''
  if (!modelKey) return ''
  const cfg = getModelConfig(modelKey)
  return cfg?.label || modelKey
})

const handleExtractFrame = async () => {
  if (!displayUrl.value) return
  if (!videoRef.value) {
    window.$message?.warning('视频未就绪，请稍后再试')
    return
  }

  try {
    // Pause first to ensure a stable frame | 先暂停，确保帧稳定
    if (!videoRef.value.paused) videoRef.value.pause()

    // Ensure metadata is available | 确保已加载尺寸信息
    if (!videoRef.value.videoWidth || !videoRef.value.videoHeight) {
      await new Promise((resolve, reject) => {
        const onLoaded = () => {
          cleanup()
          resolve(true)
        }
        const onError = () => {
          cleanup()
          reject(new Error('视频加载失败'))
        }
        const cleanup = () => {
          videoRef.value?.removeEventListener('loadeddata', onLoaded)
          videoRef.value?.removeEventListener('error', onError)
        }
        videoRef.value.addEventListener('loadeddata', onLoaded, { once: true })
        videoRef.value.addEventListener('error', onError, { once: true })
      })
    }

    const canvas = document.createElement('canvas')
    canvas.width = videoRef.value.videoWidth
    canvas.height = videoRef.value.videoHeight
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('Canvas 初始化失败')

    ctx.drawImage(videoRef.value, 0, 0, canvas.width, canvas.height)

    // Use JPEG to reduce size | 使用 JPEG 降低体积
    const dataUrl = canvas.toDataURL('image/jpeg', 0.92)
    if (!dataUrl || !dataUrl.startsWith('data:image')) throw new Error('截帧失败')

    const currentNode = nodes.value.find(n => n.id === props.id)
    const nodeX = currentNode?.position?.x || 0
    const nodeY = currentNode?.position?.y || 0

    const imageNodeId = addNode('image', { x: nodeX + 460, y: nodeY }, {
      url: dataUrl,
      label: '视频帧',
      model: props.data?.model || '',
      updatedAt: Date.now()
    })

    addEdge({
      source: props.id,
      target: imageNodeId,
      sourceHandle: 'right',
      targetHandle: 'left'
    })

    setTimeout(() => {
      updateNodeInternals(imageNodeId)
    }, 50)

    addAsset({
      type: 'image',
      src: dataUrl,
      title: '视频帧',
      model: props.data?.model || ''
    })

    window.$message?.success('已提取当前帧并生成图片节点')
  } catch (err) {
    const message = err?.message || '截帧失败'
    // Common case: CORS tainted canvas | 常见：跨域导致画布被污染
    if (/tainted|security/i.test(message)) {
      window.$message?.error('截帧失败：视频链接可能不支持跨域读取（建议下载后再上传本地视频）')
      return
    }
    window.$message?.error(message)
  }
}

// Handle file upload | 处理文件上传
const handleFileUpload = (event) => {
  const file = event.target.files[0]
  if (file) {
    const url = URL.createObjectURL(file)
    updateNode(props.id, { 
      url,
      localPath: '',
      localSourceUrl: '',
      updatedAt: Date.now()
    })
  }
}

// Format duration | 格式化时长
const formatDuration = (seconds) => {
  const mins = Math.floor(seconds / 60)
  const secs = Math.floor(seconds % 60)
  return `${mins}:${secs.toString().padStart(2, '0')}`
}

// Handle delete | 处理删除
const handleDelete = () => {
  removeNode(props.id)
}

// Handle preview | 处理预览
const handlePreview = () => {
  const url = displayUrl.value
  if (!url) return
  window.open(url, '_blank')
}

// Handle download | 处理下载
const handleDownload = () => {
  const url = displayUrl.value
  if (url) {
    const link = document.createElement('a')
    link.href = url
    link.download = props.data.fileName || `video_${Date.now()}.mp4`
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
    window.$message?.success('视频下载中...')
  }
}

// Handle duplicate | 处理复制
const handleDuplicate = () => {
  const newId = duplicateNode(props.id)
  if (newId) {
    // Clear selection and select the new node | 清除选中并选中新节点
    updateNode(props.id, { selected: false })
    updateNode(newId, { selected: true })
    window.$message?.success('节点已复制')
  }
}

const getApiKey = () => {
  try { return localStorage.getItem('apiKey') || '' } catch { return '' }
}

const ensureCachedVideo = async (reason = 'prefetch') => {
  const url = rawUrl.value
  if (!url || typeof url !== 'string') return
  if (!isTauriEnv.value) return
  if (!/^https?:\/\//i.test(url)) return
  if (props.data?.localSourceUrl === url && localPath.value) return

  try {
    if (!tauriApi) tauriApi = await import('@tauri-apps/api/core')
    if (!tauriApi?.isTauri?.()) return
    const path = await tauriApi.invoke('cache_remote_media', { url, authToken: getApiKey() || null })
    if (typeof path === 'string' && path) {
      updateNode(props.id, { localPath: path, localSourceUrl: url })
      resolvedAssetUrl.value = tauriApi.convertFileSrc(path)
      if (reason !== 'prefetch') {
        window.$message?.info('已使用本地缓存加载视频')
      }
    }
  } catch {
    // ignore
  }
}

const handleVideoError = async () => {
  videoLoadError.value = '视频加载失败（可能链接已过期或被拦截）'
  await ensureCachedVideo('onerror')
}

watch(
  () => rawUrl.value,
  () => {
    videoLoadError.value = ''
    resolvedAssetUrl.value = ''
    ensureCachedVideo('prefetch')
  }
)

onMounted(async () => {
  try {
    tauriApi = await import('@tauri-apps/api/core')
    isTauriEnv.value = !!tauriApi?.isTauri?.()
  } catch {
    isTauriEnv.value = false
  }
  ensureCachedVideo('prefetch')
})
</script>

<style scoped>
.video-node-wrapper {
  padding-right: 50px;
  padding-top: 20px;
}

.video-node {
  cursor: default;
}
</style>
