<template>
  <Teleport to="body">
    <Transition name="fade">
      <div
        v-if="show"
        class="fixed inset-0 z-[9999] bg-black/80 backdrop-blur-sm flex items-center justify-center"
        @mousedown.self="handleClose"
      >
        <div
          class="w-[min(1120px,96vw)] h-[min(82vh,860px)] bg-[var(--bg-secondary)] border border-[var(--border-color)] rounded-3xl shadow-2xl overflow-hidden flex flex-col"
          @mousedown.stop
        >
          <!-- Header -->
          <div class="p-4 border-b border-[var(--border-color)] flex items-center justify-between bg-[var(--bg-tertiary)]">
            <div class="flex items-center gap-3">
              <div class="p-2 rounded-xl bg-[var(--accent-color)]/15 border border-[var(--accent-color)]/20">
                <n-icon :size="16" color="var(--accent-color)"><SparklesOutline /></n-icon>
              </div>
              <div class="flex flex-col">
                <span class="text-sm font-bold text-[var(--text-primary)]">导演台</span>
                <span class="text-[11px] text-[var(--text-secondary)]">分镜规划 + 自动生成节点</span>
              </div>
            </div>
            <div class="flex items-center gap-2">
              <button
                @click="showHistory = !showHistory"
                class="p-2 rounded-full text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-primary)] transition-colors"
                :class="{ 'text-[var(--accent-color)]': showHistory }"
                title="历史记录"
              >
                <n-icon :size="18"><TimeOutline /></n-icon>
              </button>
              <button
                @click="handleClose"
                class="p-2 rounded-full text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-primary)] transition-colors"
              >
                <n-icon :size="18"><CloseOutline /></n-icon>
              </button>
            </div>
          </div>

          <!-- History Panel -->
          <div v-if="showHistory" class="border-b border-[var(--border-color)] bg-[var(--bg-primary)] max-h-[200px] overflow-auto">
            <div v-if="conversationHistory.length === 0" class="p-4 text-center text-sm text-[var(--text-secondary)]">
              暂无历史记录
            </div>
            <div v-else class="p-2 space-y-2">
              <div class="flex items-center justify-between px-2 mb-2">
                <span class="text-xs text-[var(--text-secondary)]">{{ conversationHistory.length }} 条记录</span>
                <button @click="clearHistory" class="text-xs text-red-500 hover:underline">清空</button>
              </div>
              <div
                v-for="(entry, i) in conversationHistory.slice().reverse()"
                :key="entry.timestamp || i"
                @click="loadFromHistory(entry)"
                class="p-3 bg-[var(--bg-secondary)] rounded-lg cursor-pointer hover:bg-[var(--bg-tertiary)] transition-colors"
              >
                <div class="text-xs text-[var(--text-primary)] line-clamp-2">{{ entry.storyIdea }}</div>
                <div class="text-[10px] text-[var(--text-secondary)] mt-1">
                  {{ entry.shots?.length || 0 }} 条分镜 · {{ new Date(entry.timestamp).toLocaleString() }}
                </div>
              </div>
            </div>
          </div>

          <!-- Body -->
          <div class="flex-1 flex flex-col overflow-hidden p-5 gap-4">
            <!-- Story Input -->
            <div class="flex flex-col gap-2">
              <div class="flex items-center justify-between">
                <label class="text-xs font-bold text-[var(--text-primary)]">剧情 / 概念</label>
                <span class="text-[10px] text-[var(--text-secondary)]">{{ storyIdea.length }}/2000</span>
              </div>
              <textarea
                v-model="storyIdea"
                class="w-full h-[120px] bg-[var(--bg-primary)] border border-[var(--border-color)] rounded-xl p-4 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-secondary)] focus:outline-none focus:border-[var(--accent-color)] resize-none"
                placeholder="一句话概念 + 角色关系 + 冲突反转 + 结尾金句（适合短视频/AI 漫剧）…"
                maxlength="2000"
              />
            </div>

            <!-- Settings Grid -->
            <div class="grid grid-cols-4 gap-3">
              <div class="flex flex-col gap-2">
                <label class="text-[11px] font-bold text-[var(--text-secondary)] uppercase">镜头数</label>
                <n-input-number
                  v-model:value="shotCount"
                  :min="4"
                  :max="24"
                  size="small"
                  class="w-full"
                />
              </div>
              <div class="flex flex-col gap-2">
                <label class="text-[11px] font-bold text-[var(--text-secondary)] uppercase">画幅</label>
                <n-select
                  v-model:value="aspectRatio"
                  :options="aspectRatioOptions"
                  size="small"
                />
              </div>
              <div class="flex flex-col gap-2">
                <label class="text-[11px] font-bold text-[var(--text-secondary)] uppercase">图片模型</label>
                <n-select
                  v-model:value="imageModel"
                  :options="imageModelOptions"
                  size="small"
                />
              </div>
              <div class="flex flex-col gap-2">
                <label class="text-[11px] font-bold text-[var(--text-secondary)] uppercase">自动出图</label>
                <button
                  @click="autoGenerateImages = !autoGenerateImages"
                  :class="[
                    'w-full py-1.5 rounded-lg text-xs font-bold transition-colors border',
                    autoGenerateImages
                      ? 'bg-[var(--accent-color)]/20 text-[var(--accent-color)] border-[var(--accent-color)]/30'
                      : 'bg-[var(--bg-primary)] text-[var(--text-secondary)] border-[var(--border-color)]'
                  ]"
                >
                  {{ autoGenerateImages ? 'ON' : 'OFF' }}
                </button>
              </div>
            </div>

            <!-- Optional Fields -->
            <div class="grid grid-cols-2 gap-4">
              <div class="flex flex-col gap-2">
                <label class="text-xs font-bold text-[var(--text-primary)]">角色&美术 Bible（可选）</label>
                <textarea
                  v-model="styleBible"
                  class="w-full h-[100px] bg-[var(--bg-primary)] border border-[var(--border-color)] rounded-xl p-3 text-xs text-[var(--text-primary)] placeholder:text-[var(--text-secondary)] focus:outline-none focus:border-[var(--accent-color)] resize-none"
                  placeholder="固定点：发型/服装/配饰/体型/色板；画风：国漫厚涂/赛璐璐/写实…"
                  maxlength="1000"
                />
              </div>
              <div class="flex flex-col gap-2">
                <label class="text-xs font-bold text-[var(--text-primary)]">导演备注（可选）</label>
                <textarea
                  v-model="directorNotes"
                  class="w-full h-[100px] bg-[var(--bg-primary)] border border-[var(--border-color)] rounded-xl p-3 text-xs text-[var(--text-primary)] placeholder:text-[var(--text-secondary)] focus:outline-none focus:border-[var(--accent-color)] resize-none"
                  placeholder="情绪线/节奏点/镜头语言偏好；比如：快节奏、强镜头感、纪实手持…"
                  maxlength="1000"
                />
              </div>
            </div>

            <!-- Results -->
            <div class="flex-1 flex flex-col gap-2 overflow-hidden">
              <div class="flex items-center justify-between">
                <span class="text-xs font-bold text-[var(--text-primary)]">分镜输出</span>
                <div class="flex items-center gap-2">
                  <span v-if="shots.length > 0" class="text-[11px] text-[var(--text-secondary)]">{{ shots.length }} 条</span>
                  <span v-if="error" class="text-[11px] text-red-500">{{ error }}</span>
                </div>
              </div>
              <div class="flex-1 bg-[var(--bg-primary)] border border-[var(--border-color)] rounded-xl p-4 overflow-auto">
                <div v-if="shots.length === 0" class="text-sm text-[var(--text-secondary)] text-center py-8">
                  点击「生成分镜」开始
                </div>
                <div v-else class="space-y-3">
                  <div v-for="(shot, i) in shots" :key="i" class="text-xs text-[var(--text-primary)]">
                    <div class="text-[10px] text-[var(--text-secondary)] mb-1">#{{ i + 1 }}</div>
                    <div class="leading-relaxed">{{ shot }}</div>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <!-- Footer -->
          <div class="p-4 border-t border-[var(--border-color)] flex items-center justify-end gap-3">
            <n-button @click="handleClose" quaternary>取消</n-button>
            <n-button
              @click="handleGenerate"
              :loading="isGenerating"
              :disabled="!storyIdea.trim()"
              type="info"
            >
              <template #icon>
                <n-icon><SparklesOutline /></n-icon>
              </template>
              生成分镜
            </n-button>
            <n-button
              @click="handleCreate"
              :disabled="shots.length === 0"
              type="primary"
            >
              <template #icon>
                <n-icon><AddOutline /></n-icon>
              </template>
              上板
            </n-button>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<script setup>
import { ref, computed, onMounted, watch } from 'vue'
import { NIcon, NButton, NInputNumber, NSelect } from 'naive-ui'
import { SparklesOutline, CloseOutline, AddOutline, TimeOutline } from '@vicons/ionicons5'
import { streamChatCompletions } from '../api'
import { DEFAULT_CHAT_MODEL } from '../config/models'
import { imageModelOptions as allImageModels } from '../stores/models'

const HISTORY_KEY = 'nexus-director-history'

const props = defineProps({
  show: Boolean
})

const emit = defineEmits(['update:show', 'create-nodes'])

const storyIdea = ref('')
const styleBible = ref('')
const directorNotes = ref('')
const shotCount = ref(10)
const aspectRatio = ref('16:9')
const imageModel = ref('gemini-3-pro-image-preview')
const autoGenerateImages = ref(true)

const isGenerating = ref(false)
const shots = ref([])
const error = ref(null)

const conversationHistory = ref([])
const showHistory = ref(false)

const loadHistory = () => {
  try {
    const saved = localStorage.getItem(HISTORY_KEY)
    if (saved) conversationHistory.value = JSON.parse(saved)
  } catch {}
}

const saveHistory = () => {
  try {
    localStorage.setItem(HISTORY_KEY, JSON.stringify(conversationHistory.value.slice(-20)))
  } catch {}
}

const addToHistory = (entry) => {
  conversationHistory.value.push({
    ...entry,
    timestamp: Date.now()
  })
  saveHistory()
}

const loadFromHistory = (entry) => {
  storyIdea.value = entry.storyIdea || ''
  styleBible.value = entry.styleBible || ''
  directorNotes.value = entry.directorNotes || ''
  shotCount.value = entry.shotCount || 10
  aspectRatio.value = entry.aspectRatio || '16:9'
  shots.value = entry.shots || []
  showHistory.value = false
}

const clearHistory = () => {
  conversationHistory.value = []
  saveHistory()
}

onMounted(() => {
  loadHistory()
})

const aspectRatioOptions = [
  { label: '16:9', value: '16:9' },
  { label: '9:16', value: '9:16' },
  { label: '1:1', value: '1:1' },
  { label: '4:3', value: '4:3' },
  { label: '3:4', value: '3:4' }
]

const imageModelOptions = computed(() => {
  return allImageModels.value.map(m => ({
    label: m.label,
    value: m.key
  }))
})

const buildStoryboardPrompt = () => {
  const count = Math.max(4, Math.min(24, shotCount.value))

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
    storyIdea.value.trim()
  ]

  if (styleBible.value.trim()) {
    parts.push('', '【角色&美术 Bible】', styleBible.value.trim())
  }

  if (directorNotes.value.trim()) {
    parts.push('', '【导演备注】', directorNotes.value.trim())
  }

  parts.push('', `【画幅】Aspect Ratio: ${aspectRatio.value}`)

  return parts.join('\n')
}

const parseStoryboardResponse = (text) => {
  const jsonMatch = text.match(/\[[\s\S]*\]/)
  if (!jsonMatch) return null

  try {
    const parsed = JSON.parse(jsonMatch[0])
    if (Array.isArray(parsed) && parsed.every(s => typeof s === 'string')) {
      return parsed
    }
  } catch {
    return null
  }
  return null
}

const handleGenerate = async () => {
  if (!storyIdea.value.trim()) {
    error.value = '请先填写剧情'
    return
  }

  error.value = null
  isGenerating.value = true
  shots.value = []

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

    shots.value = parsed
    addToHistory({
      storyIdea: storyIdea.value.trim(),
      styleBible: styleBible.value.trim(),
      directorNotes: directorNotes.value.trim(),
      shotCount: shotCount.value,
      aspectRatio: aspectRatio.value,
      shots: parsed
    })
    window.$message?.success(`已生成 ${parsed.length} 个分镜`)
  } catch (err) {
    error.value = err.message || '分镜生成失败'
    window.$message?.error(error.value)
  } finally {
    isGenerating.value = false
  }
}

const handleCreate = () => {
  if (shots.value.length === 0) {
    error.value = '请先生成分镜'
    return
  }

  emit('create-nodes', {
    storyIdea: storyIdea.value.trim(),
    styleBible: styleBible.value.trim(),
    directorNotes: directorNotes.value.trim(),
    shots: shots.value,
    imageModel: imageModel.value,
    aspectRatio: aspectRatio.value,
    autoGenerateImages: autoGenerateImages.value
  })

  handleClose()
}

const handleClose = () => {
  emit('update:show', false)
}
</script>

<style scoped>
.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.2s ease;
}

.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}
</style>
