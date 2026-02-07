<template>
  <n-modal v-model:show="visible" preset="card" title="音频工作室" style="width: 980px; max-width: 96vw;">
    <div class="space-y-4">
      <div class="flex items-center justify-between">
        <span class="text-xs text-[var(--text-secondary)]">Suno 文生音乐（生成歌曲 / 生成歌词）</span>
        <span v-if="activeStatus === 'polling'" class="text-[11px] text-[var(--text-secondary)]">
          进度 {{ activeProgress.percentage }}%
        </span>
      </div>

      <div class="flex bg-[var(--bg-primary)] p-1 rounded-lg border border-[var(--border-color)]">
        <button
          @click="activeTab = 'music'"
          :class="[
            'flex-1 py-2 text-xs font-medium rounded-md transition-colors',
            activeTab === 'music'
              ? 'bg-[var(--bg-tertiary)] text-[var(--text-primary)]'
              : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-tertiary)]'
          ]"
        >
          生成歌曲
        </button>
        <button
          @click="activeTab = 'lyrics'"
          :class="[
            'flex-1 py-2 text-xs font-medium rounded-md transition-colors',
            activeTab === 'lyrics'
              ? 'bg-[var(--bg-tertiary)] text-[var(--text-primary)]'
              : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-tertiary)]'
          ]"
        >
          生成歌词
        </button>
      </div>

      <div class="grid grid-cols-1 lg:grid-cols-[1.05fr_0.95fr] gap-4 max-h-[70vh] overflow-hidden">
        <!-- Left: Form -->
        <div class="flex flex-col gap-4 overflow-auto pr-1">
          <template v-if="activeTab === 'music'">
            <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div class="flex flex-col gap-2">
                <label class="text-[11px] font-bold text-[var(--text-secondary)] uppercase">音乐标题</label>
                <n-input v-model:value="musicTitle" size="small" placeholder="可选，如：霓虹夜行" />
              </div>
              <div class="flex flex-col gap-2">
                <label class="text-[11px] font-bold text-[var(--text-secondary)] uppercase">风格标签</label>
                <n-input v-model:value="musicTags" size="small" placeholder="如：cinematic, ambient, synthwave" />
              </div>
            </div>

            <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div class="flex flex-col gap-2">
                <label class="text-[11px] font-bold text-[var(--text-secondary)] uppercase">模型版本</label>
                <n-select v-model:value="modelVersion" :options="modelOptions" size="small" />
              </div>
              <div class="flex flex-col gap-2">
                <label class="text-[11px] font-bold text-[var(--text-secondary)] uppercase">生成模式</label>
                <n-select v-model:value="createMode" :options="createModeOptions" size="small" />
              </div>
            </div>

            <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div class="flex flex-col gap-2">
                <label class="text-[11px] font-bold text-[var(--text-secondary)] uppercase">人声音色</label>
                <n-select v-model:value="vocalGender" :options="vocalOptions" size="small" />
              </div>
              <div class="flex flex-col gap-2">
                <label class="text-[11px] font-bold text-[var(--text-secondary)] uppercase">不希望出现的风格</label>
                <n-input v-model:value="musicNegativeTags" size="small" placeholder="如：metal, heavy drums" />
              </div>
            </div>

            <div v-if="createMode === 'extend'" class="grid grid-cols-1 md:grid-cols-3 gap-3">
              <div class="flex flex-col gap-2">
                <label class="text-[11px] font-bold text-[var(--text-secondary)] uppercase">续写 Task ID</label>
                <n-input v-model:value="continueTaskId" size="small" placeholder="可选" />
              </div>
              <div class="flex flex-col gap-2">
                <label class="text-[11px] font-bold text-[var(--text-secondary)] uppercase">续写 Clip ID</label>
                <n-input v-model:value="continueClipId" size="small" placeholder="必填其一" />
              </div>
              <div class="flex flex-col gap-2">
                <label class="text-[11px] font-bold text-[var(--text-secondary)] uppercase">续写起始秒</label>
                <n-input v-model:value="continueAt" size="small" placeholder="如：60.5" />
              </div>
            </div>

            <div class="flex flex-col gap-2">
              <div class="flex items-center justify-between">
                <label class="text-[11px] font-bold text-[var(--text-secondary)] uppercase">提示词 / 歌词</label>
                <span class="text-[10px] text-[var(--text-secondary)]">{{ musicPrompt.length }}/1200</span>
              </div>
              <textarea
                v-model="musicPrompt"
                class="w-full min-h-[180px] bg-[var(--bg-primary)] border border-[var(--border-color)] rounded-xl p-3 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-secondary)] focus:outline-none focus:border-[var(--accent-color)] resize-none"
                placeholder="描述歌曲主题、节奏、情绪，也可以直接写歌词。"
                maxlength="1200"
              />
            </div>

            <div class="rounded-xl border border-[var(--border-color)] bg-[var(--bg-primary)] p-3 text-[11px] text-[var(--text-secondary)] leading-relaxed">
              建议：使用“风格 + 乐器 + 情绪 + 节奏”的结构，例如：
              <span class="text-[var(--text-primary)]">电影感、慢节奏、合成器铺底、温柔女声、夜雨城市</span>。
            </div>
          </template>

          <template v-else>
            <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div class="flex flex-col gap-2">
                <label class="text-[11px] font-bold text-[var(--text-secondary)] uppercase">歌词标题</label>
                <n-input v-model:value="lyricsTitle" size="small" placeholder="可选，如：城市雨夜" />
              </div>
              <div class="flex flex-col gap-2">
                <label class="text-[11px] font-bold text-[var(--text-secondary)] uppercase">风格标签</label>
                <n-input v-model:value="lyricsTags" size="small" placeholder="如：drama, romance, cyber" />
              </div>
            </div>

            <div class="flex flex-col gap-2">
              <label class="text-[11px] font-bold text-[var(--text-secondary)] uppercase">不希望出现的风格</label>
              <n-input v-model:value="lyricsNegativeTags" size="small" placeholder="如：metal, heavy drums" />
            </div>

            <div class="flex flex-col gap-2">
              <div class="flex items-center justify-between">
                <label class="text-[11px] font-bold text-[var(--text-secondary)] uppercase">歌词需求</label>
                <span class="text-[10px] text-[var(--text-secondary)]">{{ lyricsPrompt.length }}/1200</span>
              </div>
              <textarea
                v-model="lyricsPrompt"
                class="w-full min-h-[220px] bg-[var(--bg-primary)] border border-[var(--border-color)] rounded-xl p-3 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-secondary)] focus:outline-none focus:border-[var(--accent-color)] resize-none"
                placeholder="描述主题、情绪、段落结构（主歌/副歌）、押韵方式等。"
                maxlength="1200"
              />
            </div>

            <div class="rounded-xl border border-[var(--border-color)] bg-[var(--bg-primary)] p-3 text-[11px] text-[var(--text-secondary)] leading-relaxed">
              建议：给出主题 + 视角 + 节奏 + 押韵要求，例如：
              <span class="text-[var(--text-primary)]">第一人称，都市夜雨，慢节奏，ABAB 押韵</span>。
            </div>
          </template>
        </div>

        <!-- Right: Player + List -->
        <div class="flex flex-col gap-4 overflow-hidden">
          <template v-if="activeTab === 'music'">
            <div class="flex flex-col gap-3">
              <span class="text-sm font-semibold">播放器</span>
              <div class="rounded-2xl border border-[var(--border-color)] bg-[var(--bg-primary)] p-4">
                <div v-if="currentTrack" class="flex items-center justify-between gap-3">
                  <div class="min-w-0">
                    <div class="text-sm font-semibold truncate">{{ currentTrack.title || '音频' }}</div>
                    <div class="text-[11px] text-[var(--text-secondary)] truncate">{{ currentTrack.model || 'Suno' }}</div>
                  </div>
                  <button
                    class="px-2 py-1 text-[11px] rounded-md border border-[var(--border-color)] hover:border-[var(--accent-color)] transition-colors"
                    @click="emitAddToCanvas(currentTrack)"
                  >
                    上板
                  </button>
                </div>
                <div v-else class="text-[11px] text-[var(--text-secondary)]">
                  生成后将自动加载最新音频
                </div>
                <audio v-if="currentTrack" :src="currentTrack.audioUrl" controls class="w-full mt-3" />
              </div>
            </div>

            <div class="flex-1 flex flex-col gap-3 overflow-hidden">
              <div class="flex items-center justify-between">
                <span class="text-sm font-semibold">音频列表</span>
                <span class="text-[11px] text-[var(--text-secondary)]">{{ displayTracks.length }} 条</span>
              </div>
              <div class="flex-1 overflow-auto space-y-2">
                <div
                  v-for="track in displayTracks"
                  :key="track.id"
                  class="group rounded-xl border border-[var(--border-color)] bg-[var(--bg-primary)] hover:border-[var(--accent-color)] transition-colors p-3 cursor-pointer"
                  @click="setCurrentTrack(track)"
                >
                  <div class="flex items-center justify-between gap-3">
                    <div class="flex items-center gap-2 min-w-0">
                      <div class="w-9 h-9 rounded-lg bg-[var(--bg-tertiary)] flex items-center justify-center">
                        <n-icon :size="18"><MusicalNotesOutline /></n-icon>
                      </div>
                      <div class="min-w-0">
                        <div class="text-sm truncate">{{ track.title || '音频' }}</div>
                        <div class="text-[11px] text-[var(--text-secondary)] truncate">{{ track.model || 'Suno' }}</div>
                      </div>
                    </div>
                    <div class="flex items-center gap-2 shrink-0">
                      <button
                        class="px-2 py-1 text-[11px] rounded-md border border-[var(--border-color)] hover:border-[var(--accent-color)] transition-colors"
                        @click.stop="emitAddToCanvas(track)"
                      >
                        上板
                      </button>
                      <button
                        class="p-1.5 rounded-md bg-[var(--bg-tertiary)] hover:bg-[var(--accent-color)]/15 text-[var(--text-secondary)] hover:text-[var(--accent-color)] transition-colors"
                        title="下载"
                        @click.stop="downloadTrack(track)"
                      >
                        <n-icon :size="14"><DownloadOutline /></n-icon>
                      </button>
                    </div>
                  </div>
                  <div v-if="track.duration" class="mt-2 text-[11px] text-[var(--text-secondary)]">
                    时长: {{ formatDuration(track.duration) }}
                  </div>
                </div>
              </div>
            </div>
          </template>

          <template v-else>
            <div class="flex items-center justify-between">
              <span class="text-sm font-semibold">歌词结果</span>
              <div class="flex items-center gap-2">
                <button
                  class="px-2 py-1 text-[11px] rounded-md border border-[var(--border-color)] hover:border-[var(--accent-color)] transition-colors"
                  @click="copyLyrics"
                  :disabled="!lyricsResult"
                >
                  复制
                </button>
                <button
                  class="px-2 py-1 text-[11px] rounded-md border border-[var(--border-color)] hover:border-[var(--accent-color)] transition-colors"
                  @click="insertLyrics"
                  :disabled="!lyricsResult"
                >
                  上板
                </button>
              </div>
            </div>

            <div class="flex-1 rounded-2xl border border-[var(--border-color)] bg-[var(--bg-primary)] p-4 overflow-auto">
              <div v-if="!lyricsResult" class="text-[11px] text-[var(--text-secondary)]">
                生成后将显示歌词内容
              </div>
              <textarea
                v-else
                :value="lyricsResult"
                readonly
                class="w-full min-h-[320px] bg-transparent text-sm text-[var(--text-primary)] outline-none resize-none"
              />
            </div>
          </template>
        </div>
      </div>
    </div>

    <template #footer>
      <div class="flex items-center justify-between">
        <div class="text-[11px] text-[var(--text-secondary)]">
          <span v-if="activeTab === 'music'">模型：suno_music（支持自定义/灵感/续写）</span>
          <span v-else>模型：suno_lyrics</span>
        </div>
        <div class="flex items-center gap-2">
          <n-button quaternary @click="handleClear" :disabled="activeLoading">清空</n-button>
          <n-button type="primary" @click="handleGenerate" :loading="activeLoading">
            <template #icon>
              <n-icon><SparklesOutline /></n-icon>
            </template>
            {{ activeTab === 'music' ? '生成音乐' : '生成歌词' }}
          </n-button>
        </div>
      </div>
    </template>
  </n-modal>
</template>

<script setup>
import { ref, computed, watch } from 'vue'
import { NIcon, NButton, NInput, NSelect, NModal } from 'naive-ui'
import { MusicalNotesOutline, SparklesOutline, DownloadOutline } from '@vicons/ionicons5'
import { useApiConfig } from '../hooks/useApiConfig'
import { useAudioGeneration, useSunoLyrics } from '../hooks'
import { assets } from '../stores/assets'

const props = defineProps({
  show: Boolean
})

const emit = defineEmits(['update:show', 'generated', 'add-to-canvas', 'insert-lyrics'])

const visible = computed({
  get: () => props.show,
  set: (val) => emit('update:show', val)
})

const activeTab = ref('music')
const musicTitle = ref('')
const musicTags = ref('')
const musicNegativeTags = ref('')
const musicPrompt = ref('')
const modelVersion = ref('chirp-v4')
const vocalGender = ref('')
const createMode = ref('custom')
const continueTaskId = ref('')
const continueClipId = ref('')
const continueAt = ref('')

const lyricsTitle = ref('')
const lyricsTags = ref('')
const lyricsNegativeTags = ref('')
const lyricsPrompt = ref('')
const lyricsResult = ref('')

const { isConfigured } = useApiConfig()
const {
  loading: musicLoading,
  status: musicStatus,
  progress: musicProgress,
  generate: generateMusic
} = useAudioGeneration()
const {
  loading: lyricsLoading,
  status: lyricsStatus,
  progress: lyricsProgress,
  generate: generateLyrics
} = useSunoLyrics()

const recentTracks = ref([])
const currentTrack = ref(null)

const modelOptions = [
  { label: 'chirp-v3-0', value: 'chirp-v3-0' },
  { label: 'chirp-v3-5', value: 'chirp-v3-5' },
  { label: 'chirp-v4', value: 'chirp-v4' },
  { label: 'chirp-auk (v4.5)', value: 'chirp-auk' },
  { label: 'chirp-v5', value: 'chirp-v5' }
]

const createModeOptions = [
  { label: '自定义', value: 'custom' },
  { label: '灵感', value: 'inspiration' },
  { label: '续写', value: 'extend' }
]

const vocalOptions = [
  { label: '默认（自动）', value: '' },
  { label: '男声', value: 'm' },
  { label: '女声', value: 'f' }
]

const activeStatus = computed(() => (activeTab.value === 'music' ? musicStatus.value : lyricsStatus.value))
const activeProgress = computed(() => (activeTab.value === 'music' ? musicProgress : lyricsProgress))
const activeLoading = computed(() => (activeTab.value === 'music' ? musicLoading.value : lyricsLoading.value))

const audioAssets = computed(() =>
  assets.value
    .filter(a => a.type === 'audio')
    .map(a => ({
      id: a.id,
      title: a.title || '音频',
      audioUrl: a.src,
      model: a.model || 'Suno',
      duration: a.duration || 0
    }))
)

const displayTracks = computed(() => {
  return recentTracks.value.length > 0 ? recentTracks.value : audioAssets.value
})

watch(audioAssets, (next) => {
  if (!currentTrack.value && next.length > 0) {
    currentTrack.value = next[0]
  }
})

const handleGenerate = async () => {
  if (!isConfigured.value) {
    window.$message?.warning('请先配置 API Key')
    return
  }

  if (activeTab.value === 'music') {
    const promptText = musicPrompt.value.trim()
    if (createMode.value !== 'inspiration' && !promptText) {
      window.$message?.warning('请先填写提示词或歌词')
      return
    }
    if (createMode.value === 'inspiration' && !promptText && !musicTitle.value.trim() && !musicTags.value.trim()) {
      window.$message?.warning('灵感模式请提供主题或风格标签')
      return
    }
    if (createMode.value === 'extend' && !continueTaskId.value.trim() && !continueClipId.value.trim()) {
      window.$message?.warning('续写模式需要 task_id 或 continue_clip_id')
      return
    }

    try {
      const result = await generateMusic({
        apiModel: 'suno_music',
        title: musicTitle.value.trim(),
        tags: musicTags.value.trim(),
        negative_tags: musicNegativeTags.value.trim(),
        prompt: promptText,
        model: modelVersion.value,
        vocal_gender: vocalGender.value,
        create_mode: createMode.value,
        task_id: continueTaskId.value.trim(),
        continue_clip_id: continueClipId.value.trim(),
        continue_at: continueAt.value
      })

      if (Array.isArray(result) && result.length > 0) {
        recentTracks.value = result
        currentTrack.value = result[0]
        emit('generated', result)
      }
    } catch (err) {
      window.$message?.error(err?.message || '音频生成失败')
    }
    return
  }

  const lyricPromptText = lyricsPrompt.value.trim()
  if (!lyricPromptText) {
    window.$message?.warning('请先填写歌词需求')
    return
  }

  try {
    const text = await generateLyrics({
      title: lyricsTitle.value.trim(),
      tags: lyricsTags.value.trim(),
      negative_tags: lyricsNegativeTags.value.trim(),
      prompt: lyricPromptText,
      model: modelVersion.value,
      create_mode: 'custom'
    })
    lyricsResult.value = text
  } catch (err) {
    window.$message?.error(err?.message || '歌词生成失败')
  }
}

const handleClear = () => {
  if (activeTab.value === 'music') {
    musicTitle.value = ''
    musicTags.value = ''
    musicNegativeTags.value = ''
    musicPrompt.value = ''
    recentTracks.value = []
    currentTrack.value = null
    continueTaskId.value = ''
    continueClipId.value = ''
    continueAt.value = ''
    return
  }

  lyricsTitle.value = ''
  lyricsTags.value = ''
  lyricsNegativeTags.value = ''
  lyricsPrompt.value = ''
  lyricsResult.value = ''
}

const setCurrentTrack = (track) => {
  currentTrack.value = track
}

const emitAddToCanvas = (track) => {
  emit('add-to-canvas', track)
}

const copyLyrics = async () => {
  if (!lyricsResult.value) return
  try {
    await navigator.clipboard.writeText(lyricsResult.value)
    window.$message?.success('歌词已复制')
  } catch (err) {
    const textarea = document.createElement('textarea')
    textarea.value = lyricsResult.value
    textarea.style.position = 'fixed'
    textarea.style.opacity = '0'
    document.body.appendChild(textarea)
    textarea.select()
    document.execCommand('copy')
    document.body.removeChild(textarea)
    window.$message?.success('歌词已复制')
  }
}

const insertLyrics = () => {
  if (!lyricsResult.value) return
  emit('insert-lyrics', { text: lyricsResult.value, title: lyricsTitle.value.trim() || '歌词' })
}

const downloadTrack = (track) => {
  if (!track?.audioUrl) return
  window.open(track.audioUrl, '_blank')
}

const formatDuration = (seconds) => {
  const mins = Math.floor(seconds / 60)
  const secs = Math.floor(seconds % 60)
  return `${mins}:${secs.toString().padStart(2, '0')}`
}
</script>
