<template>
  <Teleport to="body">
    <Transition name="slide-up">
      <div
        v-if="show"
        class="fixed bottom-8 left-1/2 -translate-x-1/2 z-[80] flex flex-col items-center gap-2"
        style="width: min(90vw, 820px)"
      >
        <!-- Player Preview | 播放器预览 -->
        <div class="relative bg-black border border-white/10 shadow-2xl overflow-hidden flex items-center justify-center w-[360px] h-[202px] rounded-xl mb-2 group">
          <!-- Preview Content | 预览内容 -->
          <div v-if="isGenerating" class="flex flex-col items-center gap-3">
            <n-spin :size="32" />
            <span class="text-[10px] font-bold text-slate-400 tracking-widest uppercase">
              正在生成视频...
            </span>
          </div>
          <div v-else-if="resultVideoUrl" class="relative w-full h-full" @click="togglePlay">
            <video
              ref="videoRef"
              :src="resultVideoUrl"
              class="w-full h-full object-contain bg-zinc-900"
              loop
            />
            <div v-if="!isPlaying" class="absolute inset-0 flex items-center justify-center bg-black/20 backdrop-blur-[1px]">
              <n-icon :size="48" class="text-white/80"><PlayOutline /></n-icon>
            </div>
          </div>
          <div v-else-if="frames.length > 0" class="relative w-full h-full">
            <img
              :src="frames[hoverIndex !== null ? hoverIndex : 0]?.src"
              class="w-full h-full object-contain opacity-80 bg-zinc-900"
              draggable="false"
            />
            <div class="absolute inset-0 flex items-center justify-center">
              <div class="w-14 h-14 rounded-full flex items-center justify-center bg-white/5 border border-white/10 opacity-50">
                <n-icon :size="24" class="text-white"><PlayOutline /></n-icon>
              </div>
            </div>
            <div class="absolute top-2 right-2 px-2 py-1 bg-black/50 backdrop-blur rounded text-[9px] text-slate-300 font-mono border border-white/5">
              {{ frames.length }} 帧
            </div>
          </div>
          <div v-else class="flex flex-col items-center text-slate-600 gap-2">
            <n-icon :size="32"><VideocamOutline /></n-icon>
            <span class="text-[10px] font-medium tracking-wider">智能多帧预览</span>
          </div>

          <!-- Download Button | 下载按钮 -->
          <a
            v-if="resultVideoUrl"
            :href="resultVideoUrl"
            :download="`sequence_${Date.now()}.mp4`"
            class="absolute top-3 left-3 p-2 bg-black/60 backdrop-blur-md rounded-lg text-white/70 hover:text-white border border-white/10 hover:scale-105 transition-all opacity-0 group-hover:opacity-100"
            title="下载视频"
            @click.stop
          >
            <n-icon :size="16"><DownloadOutline /></n-icon>
          </a>
        </div>

        <!-- Preview Strip | 预览条 -->
        <div
          class="w-full h-6 bg-[#1c1c1e]/80 backdrop-blur-md rounded-t-lg border-t border-x border-white/5 relative overflow-hidden flex cursor-crosshair group"
          @mousemove="handleStripHover"
          @mouseleave="hoverIndex = null"
        >
          <div
            v-for="(f, i) in frames"
            :key="f.id"
            class="flex-1 h-full relative border-r border-white/5 last:border-0 overflow-hidden"
          >
            <img
              :src="f.src"
              class="w-full h-full object-cover opacity-30 grayscale group-hover:opacity-50 transition-opacity bg-zinc-900"
              draggable="false"
            />
          </div>

          <!-- Hover Highlight | 悬停高亮 -->
          <div
            v-if="hoverIndex !== null && frames.length > 0"
            class="absolute top-0 bottom-0 bg-cyan-500/20 border-x border-cyan-500/50 pointer-events-none transition-all duration-75"
            :style="{
              left: `${(hoverIndex / frames.length) * 100}%`,
              width: `${100 / frames.length}%`
            }"
          />
        </div>

        <!-- Asset Dock | 资产面板 -->
        <div class="bg-[#0a0a0c]/95 backdrop-blur-2xl border border-white/10 rounded-b-2xl rounded-t-sm shadow-[0_20px_60px_rgba(0,0,0,0.6)] p-4 flex items-center gap-4 relative">
          <!-- Close Button | 关闭按钮 -->
          <button
            @click="handleClose"
            class="absolute -top-3 left-0 -translate-y-full p-2 text-slate-400 hover:text-white bg-black/50 backdrop-blur rounded-full border border-white/10 transition-colors"
          >
            <n-icon :size="14"><CloseOutline /></n-icon>
          </button>

          <!-- Scrollable Frame List | 可滚动帧列表 -->
          <div class="flex-1 flex items-center gap-2 overflow-x-auto pb-1 min-h-[80px]">
            <div
              v-for="(frame, index) in frames"
              :key="frame.id"
              class="relative w-[72px] h-[72px] shrink-0 rounded-lg overflow-hidden border border-white/10 hover:border-white/30 bg-white/5 group"
            >
              <img
                :src="frame.src"
                class="w-full h-full object-cover bg-zinc-900"
                draggable="false"
              />

              <!-- Index Badge | 索引标记 -->
              <div class="absolute top-0.5 right-0.5 w-4 h-4 bg-black/60 rounded-full flex items-center justify-center text-[8px] font-bold text-white/80">
                {{ index + 1 }}
              </div>

              <!-- Delete Button | 删除按钮 -->
              <button
                @click="removeFrame(frame.id)"
                class="absolute top-0.5 left-0.5 w-4 h-4 rounded-full flex items-center justify-center bg-black/60 hover:bg-red-500 text-white/70 hover:text-white transition-colors opacity-0 group-hover:opacity-100"
              >
                <n-icon :size="10"><CloseOutline /></n-icon>
              </button>
            </div>

            <!-- Add Button | 添加按钮 -->
            <div
              v-if="frames.length < 10"
              class="w-[72px] h-[72px] shrink-0 rounded-lg border border-dashed border-white/10 hover:border-white/30 bg-white/5 hover:bg-white/10 flex flex-col items-center justify-center gap-1 cursor-pointer transition-all group active:scale-95"
              @click="$refs.fileInput.click()"
            >
              <n-icon :size="18" class="text-slate-500 group-hover:text-white transition-colors"><AddOutline /></n-icon>
              <span class="text-[9px] text-slate-500 font-medium">Add</span>
            </div>
            <input
              ref="fileInput"
              type="file"
              class="hidden"
              accept="image/*"
              multiple
              @change="handleFileUpload"
            />
          </div>

          <!-- Right Actions | 右侧操作 -->
          <div class="pl-4 border-l border-white/10 flex flex-col gap-2 shrink-0">
            <button
              @click="clearAll"
              class="p-2 rounded-lg bg-white/5 hover:bg-red-500/20 text-slate-400 hover:text-red-400 transition-colors"
              title="全部清空"
            >
              <n-icon :size="14"><TrashOutline /></n-icon>
            </button>
            <button
              @click="handleGenerate"
              :disabled="frames.length < 2 || isGenerating"
              :class="[
                'w-10 h-10 rounded-full flex items-center justify-center transition-all shadow-lg',
                frames.length >= 2 && !isGenerating
                  ? 'bg-gradient-to-br from-cyan-500 to-blue-600 text-white hover:scale-110'
                  : 'bg-white/10 text-slate-600 cursor-not-allowed'
              ]"
              title="生成视频"
            >
              <n-spin v-if="isGenerating" :size="18" />
              <n-icon v-else :size="18"><ArrowForwardOutline /></n-icon>
            </button>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<script setup>
import { ref, computed } from 'vue'
import { NIcon, NSpin } from 'naive-ui'
import {
  CloseOutline,
  PlayOutline,
  VideocamOutline,
  DownloadOutline,
  AddOutline,
  TrashOutline,
  ArrowForwardOutline
} from '@vicons/ionicons5'
import { useVideoGeneration } from '../hooks'

const props = defineProps({
  show: Boolean
})

const emit = defineEmits(['update:show', 'generate'])

const frames = ref([])
const hoverIndex = ref(null)
const isPlaying = ref(false)
const isGenerating = ref(false)
const resultVideoUrl = ref(null)
const videoRef = ref(null)
const fileInput = ref(null)

const { generate: generateVideo } = useVideoGeneration()

const handleStripHover = (e) => {
  if (frames.value.length === 0) return
  const rect = e.currentTarget.getBoundingClientRect()
  const index = Math.min(
    frames.value.length - 1,
    Math.floor(((e.clientX - rect.left) / rect.width) * frames.value.length)
  )
  hoverIndex.value = index
}

const handleFileUpload = (e) => {
  const files = Array.from(e.target.files || [])
  if (files.length === 0) return

  const readers = files.map(file => {
    return new Promise((resolve) => {
      const reader = new FileReader()
      reader.onload = (ev) => {
        resolve({
          id: `seq-${Date.now()}-${Math.random()}`,
          src: ev.target.result
        })
      }
      reader.readAsDataURL(file)
    })
  })

  Promise.all(readers).then(newItems => {
    frames.value = [...frames.value, ...newItems].slice(0, 10)
  })

  e.target.value = ''
}

const removeFrame = (id) => {
  frames.value = frames.value.filter(f => f.id !== id)
}

const clearAll = () => {
  frames.value = []
  resultVideoUrl.value = null
  isPlaying.value = false
}

const togglePlay = () => {
  if (!videoRef.value || !resultVideoUrl.value) return
  if (isPlaying.value) {
    videoRef.value.pause()
    isPlaying.value = false
  } else {
    videoRef.value.play()
    isPlaying.value = true
  }
}

const handleGenerate = async () => {
  if (frames.value.length < 2 || isGenerating.value) return

  isGenerating.value = true
  resultVideoUrl.value = null
  isPlaying.value = false

  try {
    // Use multi-frame references with models that support images list
    const images = frames.value.map(f => f.src).filter(Boolean)
    const prompt = `Create a smooth video sequence transitioning through ${frames.value.length} frames with natural motion and continuity.`

    const result = await generateVideo({
      model: 'veo3.1-4k',
      prompt: prompt,
      ratio: '16:9',
      images
    })

    resultVideoUrl.value = result.url
    emit('generate', { url: result.url, frames: frames.value, model: 'veo3.1-4k', title: '智能序列' })

    setTimeout(() => {
      if (videoRef.value) {
        videoRef.value.play()
          .then(() => { isPlaying.value = true })
          .catch(() => {})
      }
    }, 100)

    window.$message?.success('视频生成成功')
  } catch (err) {
    console.error('Generation failed', err)
    window.$message?.error(err.message || '视频生成失败')
  } finally {
    isGenerating.value = false
  }
}

const handleClose = () => {
  emit('update:show', false)
}
</script>

<style scoped>
.slide-up-enter-active,
.slide-up-leave-active {
  transition: all 0.5s cubic-bezier(0.32, 0.72, 0, 1);
}

.slide-up-enter-from {
  opacity: 0;
  transform: translate(-50%, 20px);
}

.slide-up-leave-to {
  opacity: 0;
  transform: translate(-50%, 20px);
}
</style>
