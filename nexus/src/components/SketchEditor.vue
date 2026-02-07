<template>
  <Teleport to="body">
    <Transition name="fade">
      <div
        v-if="show"
        class="fixed inset-0 z-[100] bg-[#0a0a0c] flex flex-col"
      >
        <!-- Top Navigation Bar | 顶部导航栏 -->
        <div class="h-14 border-b border-white/10 flex items-center justify-between px-6 bg-[#1c1c1e]">
          <button
            @click="handleClose"
            class="absolute left-6 p-2 rounded-full bg-white/5 hover:bg-white/10 text-slate-400 hover:text-white transition-colors"
          >
            <n-icon :size="16"><CloseOutline /></n-icon>
          </button>

          <div class="flex-1 flex justify-center">
            <div class="flex bg-black/30 p-1 rounded-lg">
              <button
                v-for="mode in modes"
                :key="mode.id"
                @click="activeMode = mode.id"
                :class="[
                  'flex items-center gap-2 px-6 py-1.5 rounded-md text-xs font-bold transition-all',
                  activeMode === mode.id
                    ? 'bg-white/10 text-white shadow-sm'
                    : 'text-slate-500 hover:text-slate-300'
                ]"
              >
                <n-icon :size="12"><component :is="mode.icon" /></n-icon>
                {{ mode.label }}
              </button>
            </div>
          </div>
        </div>

        <!-- Main Canvas Area | 主画布区域 -->
        <div class="flex-1 relative bg-[#121214] flex items-center justify-center p-8 overflow-hidden">
          <!-- Floating Toolbar | 浮动工具栏 -->
          <div class="absolute top-12 left-1/2 -translate-x-1/2 z-20 flex items-center gap-2 p-1.5 bg-[#2c2c2e]/90 backdrop-blur-xl border border-white/10 rounded-full shadow-2xl">
            <button
              @click="tool = 'brush'"
              :class="[
                'p-2.5 rounded-full transition-colors',
                tool === 'brush' ? 'bg-cyan-500 text-black' : 'text-slate-400 hover:text-white hover:bg-white/5'
              ]"
              title="画笔"
            >
              <n-icon :size="16"><BrushOutline /></n-icon>
            </button>

            <button
              @click="tool = 'eraser'"
              :class="[
                'p-2.5 rounded-full transition-colors',
                tool === 'eraser' ? 'bg-cyan-500 text-black' : 'text-slate-400 hover:text-white hover:bg-white/5'
              ]"
              title="橡皮擦"
            >
              <n-icon :size="16"><TrashOutline /></n-icon>
            </button>

            <div class="w-px h-6 bg-white/10 mx-1"></div>

            <div class="relative">
              <button
                @click="showPalette = !showPalette"
                class="p-2.5 rounded-full transition-colors text-slate-400 hover:text-white hover:bg-white/5 relative"
                title="调色板"
              >
                <n-icon :size="16"><ColorPaletteOutline /></n-icon>
                <div
                  class="absolute bottom-1 right-1 w-2 h-2 rounded-full border border-[#2c2c2e]"
                  :style="{ backgroundColor: brushColor }"
                />
              </button>

              <div
                v-if="showPalette"
                class="absolute top-full left-1/2 -translate-x-1/2 mt-3 p-3 bg-[#1c1c1e] border border-white/10 rounded-xl shadow-xl grid grid-cols-4 gap-2 w-48 z-30"
              >
                <button
                  v-for="c in PRESET_COLORS"
                  :key="c"
                  @click="selectColor(c)"
                  :class="[
                    'w-8 h-8 rounded-full border-2',
                    brushColor === c ? 'border-white' : 'border-transparent hover:scale-110'
                  ]"
                  :style="{ backgroundColor: c }"
                />
              </div>
            </div>

            <div class="w-px h-6 bg-white/10 mx-1"></div>

            <button
              @click="handleUndo"
              class="p-2.5 rounded-full text-slate-400 hover:text-white hover:bg-white/5"
              title="撤销"
            >
              <n-icon :size="16"><ArrowUndoOutline /></n-icon>
            </button>

            <button
              @click="handleClear"
              class="p-2.5 rounded-full text-red-400 hover:bg-red-500/10"
              title="清空"
            >
              <n-icon :size="16"><TrashBinOutline /></n-icon>
            </button>
          </div>

          <!-- Canvas Wrapper | 画布包裹层 -->
          <div
            class="relative shadow-2xl rounded-lg overflow-hidden border border-white/5 bg-[#ffffff] select-none"
            style="aspect-ratio: 16/9; height: 100%; max-height: 800px"
          >
            <!-- Background Image Layer | 背景图层 -->
            <img
              v-if="backgroundImage"
              :src="backgroundImage"
              class="absolute inset-0 w-full h-full object-contain pointer-events-none opacity-50"
              draggable="false"
            />

            <canvas
              ref="canvasRef"
              class="absolute inset-0 w-full h-full cursor-crosshair touch-none"
              @mousedown="startDrawing"
              @mousemove="draw"
              @mouseup="stopDrawing"
              @mouseleave="stopDrawing"
              @touchstart="startDrawing"
              @touchmove="draw"
              @touchend="stopDrawing"
            />
          </div>
        </div>

        <!-- Bottom Control Bar | 底部控制栏 -->
        <div class="h-20 bg-[#1c1c1e] border-t border-white/10 flex items-center px-8 gap-4">
          <!-- Tools (Left) | 工具（左侧） -->
          <div class="flex items-center gap-2 mr-4">
            <div
              class="relative p-2 rounded-lg bg-white/5 text-slate-400 hover:text-white border border-white/5 cursor-pointer hover:bg-white/10 transition-colors"
              @click="$refs.fileInput.click()"
              title="导入底图"
            >
              <n-icon :size="16"><LayersOutline /></n-icon>
              <input
                ref="fileInput"
                type="file"
                class="hidden"
                accept="image/*"
                @change="handleImportBackground"
              />
            </div>
            <button
              @click="handleDownload"
              class="p-2 rounded-lg bg-white/5 text-slate-400 hover:text-white border border-white/5"
              title="下载当前画布"
            >
              <n-icon :size="16"><DownloadOutline /></n-icon>
            </button>
          </div>

          <!-- Input Area | 输入区域 -->
          <div class="flex-1 relative">
            <input
              v-model="prompt"
              type="text"
              :placeholder="activeMode === 'pose' ? '描述姿势 (e.g. A stick figure running fast)...' : '描述画面内容 (e.g. Milk splash around the bottle)...'"
              class="w-full h-11 bg-black/30 border border-white/10 rounded-xl px-4 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-cyan-500/50 transition-colors"
              @keydown.enter="handleGenerate"
            />
          </div>

          <!-- Settings & Generate | 设置和生成 -->
          <div class="flex items-center gap-3">
            <div class="h-11 px-4 flex items-center gap-2 bg-black/30 border border-white/10 rounded-xl text-xs text-slate-300 font-medium">
              <span>
                {{ activeMode === 'pose' ? 'Gemini 2.5 (Pose)' : activeMode === 'video' ? 'Veo 3.1 Fast' : 'Gemini 2.5' }}
              </span>
              <n-icon :size="12" class="text-slate-500"><ChevronDownOutline /></n-icon>
            </div>

            <div class="w-px h-6 bg-white/10 mx-2"></div>

            <button
              @click="handleGenerate"
              :disabled="isGenerating || !prompt.trim()"
              :class="[
                'h-11 px-6 rounded-xl flex items-center gap-2 font-bold text-sm transition-all',
                isGenerating || !prompt.trim()
                  ? 'bg-white/5 text-slate-500 cursor-not-allowed'
                  : activeMode === 'pose'
                    ? 'bg-gradient-to-r from-emerald-500 to-teal-500 text-white hover:scale-105'
                    : 'bg-gradient-to-r from-cyan-600 to-blue-600 text-white hover:scale-105'
              ]"
            >
              <n-spin v-if="isGenerating" :size="16" />
              <n-icon v-else :size="16"><SparklesOutline /></n-icon>
              <span>{{ activeMode === 'pose' ? '生成姿势' : '生成作品' }}</span>
            </button>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<script setup>
import { ref, onMounted, watch } from 'vue'
import { NIcon, NSpin } from 'naive-ui'
import {
  CloseOutline,
  PlayOutline,
  ImageOutline,
  PulseOutline,
  BrushOutline,
  TrashOutline,
  ColorPaletteOutline,
  ArrowUndoOutline,
  TrashBinOutline,
  LayersOutline,
  DownloadOutline,
  ChevronDownOutline,
  SparklesOutline
} from '@vicons/ionicons5'
import { useImageGeneration, useVideoGeneration } from '../hooks'

const props = defineProps({
  show: Boolean
})

const emit = defineEmits(['update:show', 'generate'])

const canvasRef = ref(null)
const fileInput = ref(null)

const isDrawing = ref(false)
const tool = ref('brush')
const brushColor = ref('#000000')
const brushSize = ref(5)
const eraserSize = ref(30)
const canvasHistory = ref([])

const backgroundImage = ref(null)

const activeMode = ref('video')
const prompt = ref('')
const isGenerating = ref(false)
const showPalette = ref(false)

const PRESET_COLORS = [
  '#000000',
  '#ffffff',
  '#ff3b30',
  '#ff9500',
  '#ffcc00',
  '#4cd964',
  '#5ac8fa',
  '#007aff',
  '#5856d6',
  '#ff2d55',
  '#8e8e93'
]

const modes = [
  { id: 'video', label: '涂鸦生视频', icon: PlayOutline },
  { id: 'image', label: '涂鸦生图', icon: ImageOutline },
  { id: 'pose', label: '姿势生成器 (Pose)', icon: PulseOutline }
]

const { generate: generateImage } = useImageGeneration()
const { generate: generateVideo } = useVideoGeneration()

onMounted(() => {
  const canvas = canvasRef.value
  if (!canvas) return

  const dpr = window.devicePixelRatio || 1
  const rect = canvas.getBoundingClientRect()

  canvas.width = rect.width * dpr
  canvas.height = rect.height * dpr

  const ctx = canvas.getContext('2d')
  if (ctx) {
    ctx.scale(dpr, dpr)
    ctx.clearRect(0, 0, rect.width, rect.height)
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
    saveHistory()
  }
})

const saveHistory = () => {
  const canvas = canvasRef.value
  const ctx = canvas?.getContext('2d')
  if (canvas && ctx) {
    const data = ctx.getImageData(0, 0, canvas.width, canvas.height)
    canvasHistory.value = [...canvasHistory.value.slice(-10), data]
  }
}

const handleUndo = () => {
  if (canvasHistory.value.length <= 1) return
  const newHistory = [...canvasHistory.value]
  newHistory.pop()
  const prevState = newHistory[newHistory.length - 1]
  canvasHistory.value = newHistory

  const canvas = canvasRef.value
  const ctx = canvas?.getContext('2d')
  if (canvas && ctx && prevState) {
    ctx.putImageData(prevState, 0, 0)
  }
}

const handleClear = () => {
  const canvas = canvasRef.value
  const ctx = canvas?.getContext('2d')
  if (canvas && ctx) {
    ctx.clearRect(0, 0, canvas.width, canvas.height)
    saveHistory()
  }
}

const handleImportBackground = (e) => {
  const file = e.target.files?.[0]
  if (file) {
    const reader = new FileReader()
    reader.onload = (ev) => {
      backgroundImage.value = ev.target.result
    }
    reader.readAsDataURL(file)
  }
}

const getPos = (e) => {
  const canvas = canvasRef.value
  if (!canvas) return { x: 0, y: 0 }
  const rect = canvas.getBoundingClientRect()
  const clientX = e.touches ? e.touches[0].clientX : e.clientX
  const clientY = e.touches ? e.touches[0].clientY : e.clientY
  return {
    x: clientX - rect.left,
    y: clientY - rect.top
  }
}

const startDrawing = (e) => {
  isDrawing.value = true
  const { x, y } = getPos(e)
  const ctx = canvasRef.value?.getContext('2d')
  if (ctx) {
    ctx.beginPath()
    ctx.moveTo(x, y)
    if (tool.value === 'eraser') {
      ctx.globalCompositeOperation = 'destination-out'
      ctx.lineWidth = eraserSize.value
    } else {
      ctx.globalCompositeOperation = 'source-over'
      ctx.strokeStyle = brushColor.value
      ctx.lineWidth = brushSize.value
    }
  }
}

const draw = (e) => {
  if (!isDrawing.value) return
  const { x, y } = getPos(e)
  const ctx = canvasRef.value?.getContext('2d')
  if (ctx) {
    ctx.lineTo(x, y)
    ctx.stroke()
  }
}

const stopDrawing = () => {
  if (isDrawing.value) {
    isDrawing.value = false
    const ctx = canvasRef.value?.getContext('2d')
    ctx?.closePath()
    if (ctx) ctx.globalCompositeOperation = 'source-over'
    saveHistory()
  }
}

const selectColor = (color) => {
  brushColor.value = color
  tool.value = 'brush'
  showPalette.value = false
}

const getCompositeDataURL = () => {
  const canvas = canvasRef.value
  if (!canvas) return ''

  const osc = document.createElement('canvas')
  osc.width = canvas.width
  osc.height = canvas.height
  const ctx = osc.getContext('2d')
  if (!ctx) return ''

  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, osc.width, osc.height)

  if (backgroundImage.value) {
    const img = new Image()
    img.src = backgroundImage.value
    const scale = Math.min(
      osc.width / img.width,
      osc.height / img.height
    )
    const w = img.width * scale
    const h = img.height * scale
    const x = (osc.width - w) / 2
    const y = (osc.height - h) / 2
    ctx.drawImage(img, x, y, w, h)
  }

  ctx.drawImage(canvas, 0, 0)

  return osc.toDataURL('image/png')
}

const handleDownload = () => {
  const dataURL = getCompositeDataURL()
  const a = document.createElement('a')
  a.href = dataURL
  a.download = 'sketch.png'
  a.click()
}

const handleGenerate = async () => {
  if (!prompt.value.trim() || isGenerating.value) return
  isGenerating.value = true

  try {
    if (activeMode.value === 'pose') {
      const posePrompt = `Generate a simple, high-contrast black line art sketch on a white background. Subject: ${prompt.value}. Style: Minimalist stick figure or outline drawing, clear lines, no shading.`

      const result = await generateImage({
        model: 'gemini-3-pro-image-preview',
        prompt: posePrompt,
        size: '1920x1080',
        n: 1
      })

      if (result && result.length > 0) {
        const img = new Image()
        img.crossOrigin = 'anonymous'
        img.onload = () => {
          const canvas = canvasRef.value
          const ctx = canvas?.getContext('2d')
          if (canvas && ctx) {
            ctx.globalCompositeOperation = 'source-over'
            const scale = Math.min(
              canvas.width / img.width,
              canvas.height / img.height
            )
            const w = img.width * scale
            const h = img.height * scale
            const x = (canvas.width - w) / 2
            const y = (canvas.height - h) / 2
            ctx.drawImage(img, x, y, w, h)
            saveHistory()
            isGenerating.value = false
          }
        }
        img.onerror = () => {
          throw new Error('Failed to load generated pose image')
        }
        img.src = result[0].url || result[0].base64
      }
    } else {
      const compositeBase64 = getCompositeDataURL()

      if (activeMode.value === 'video') {
        const result = await generateVideo({
          model: 'veo_3_1-fast',
          prompt: prompt.value,
          ratio: '16:9',
          first_frame_image: compositeBase64
        })
        emit('generate', { type: 'video', url: result.url, prompt: prompt.value })
      } else {
        const result = await generateImage({
          model: 'gemini-3-pro-image-preview',
          prompt: prompt.value,
          size: '1920x1080',
          images: [compositeBase64],
          n: 1
        })
        emit('generate', { type: 'image', url: result[0].url || result[0].base64, prompt: prompt.value })
      }
      handleClose()
    }
  } catch (err) {
    console.error(err)
    window.$message?.error(err.message || '生成失败，请重试')
    isGenerating.value = false
  }
}

const handleClose = () => {
  emit('update:show', false)
}
</script>

<style scoped>
.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.3s ease;
}

.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}
</style>
