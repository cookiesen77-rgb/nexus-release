<template>
  <n-modal v-model:show="showModal" preset="card" title="提示词库" style="width: 760px;">
    <n-tabs type="line" animated>
      <n-tab-pane name="video" tab="视频运镜">
        <div class="flex flex-wrap items-center gap-2 mb-3">
          <n-input
            v-model:value="videoQuery"
            placeholder="搜索：英文/中文/类型/场景/描述"
            clearable
            class="flex-1 min-w-[260px]"
          />
          <n-select
            v-model:value="moodAdjective"
            :options="moodOptions"
            placeholder="情绪修饰（可选）"
            clearable
            style="width: 200px;"
          />
        </div>

        <div class="max-h-[420px] overflow-auto border border-[var(--border-color)] rounded-lg">
          <div
            v-for="item in filteredCameraMoves"
            :key="item.id"
            class="flex items-start justify-between gap-3 p-3 border-b border-[var(--border-color)] last:border-b-0 hover:bg-[var(--bg-tertiary)]/40"
          >
            <div class="min-w-0">
              <div class="text-sm font-medium text-[var(--text-primary)] truncate">
                {{ item.zh }}
                <span class="text-xs text-[var(--text-secondary)]">（{{ item.en }}）</span>
              </div>
              <div class="mt-1 text-xs text-[var(--text-secondary)]">
                {{ item.category }} · {{ item.scene }}
              </div>
              <div v-if="item.desc" class="mt-1 text-xs text-[var(--text-secondary)] line-clamp-2">
                {{ item.desc }}
              </div>
            </div>

            <n-button size="small" type="primary" @click="handleInsert(buildCameraSnippet(item))">
              插入
            </n-button>
          </div>
        </div>

        <div class="mt-3 text-xs text-[var(--text-secondary)] leading-5">
          <div>推荐用法（来自资料）：</div>
          <div>主体/场景 + (Camera Movement: 情绪修饰 + 运镜) + 其它画面要素</div>
        </div>
      </n-tab-pane>

      <n-tab-pane name="nano" tab="Nano Banana Pro">
        <div class="flex flex-wrap items-center gap-2 mb-3">
          <n-input
            v-model:value="nanoQuery"
            placeholder="搜索：标题/描述/Prompt/语言"
            clearable
            class="flex-1 min-w-[260px]"
          />
        </div>

        <div class="max-h-[420px] overflow-auto border border-[var(--border-color)] rounded-lg">
          <div
            v-for="item in filteredNanoPrompts"
            :key="item.no"
            class="flex items-start justify-between gap-3 p-3 border-b border-[var(--border-color)] last:border-b-0 hover:bg-[var(--bg-tertiary)]/40"
          >
            <div class="min-w-0">
              <div class="text-sm font-medium text-[var(--text-primary)] truncate">
                {{ item.title }}
              </div>
              <div class="mt-1 text-xs text-[var(--text-secondary)] flex flex-wrap items-center gap-2">
                <span class="px-2 py-0.5 rounded-full border border-[var(--border-color)] bg-[var(--bg-secondary)]">
                  {{ item.language || 'EN' }}
                </span>
                <span
                  v-if="item.featured"
                  class="px-2 py-0.5 rounded-full border border-[var(--border-color)] bg-[var(--bg-secondary)]"
                >
                  Featured
                </span>
                <span v-if="item.no" class="text-[var(--text-tertiary)]">No. {{ item.no }}</span>
              </div>
              <div v-if="item.description" class="mt-2 text-xs text-[var(--text-secondary)] line-clamp-2">
                {{ item.description }}
              </div>
              <div class="mt-2 text-xs text-[var(--text-tertiary)] line-clamp-1">
                来源：awesome-nano-banana-pro-prompts（GitHub README）
              </div>
            </div>

            <n-button size="small" type="primary" @click="handleInsert(item.prompt)">
              插入
            </n-button>
          </div>
        </div>

        <div class="mt-3 text-xs text-[var(--text-secondary)] leading-5">
          <div>说明：</div>
          <div>- 词库来源于社区整理，建议再结合你的角色/画风设定节点一起使用。</div>
        </div>
      </n-tab-pane>

      <n-tab-pane name="comic" tab="漫画">
        <div class="flex flex-wrap items-center gap-2 mb-3">
          <n-input
            v-model:value="comicQuery"
            placeholder="搜索：标题/描述/Prompt"
            clearable
            class="flex-1 min-w-[260px]"
          />
        </div>

        <div class="max-h-[420px] overflow-auto border border-[var(--border-color)] rounded-lg">
          <div
            v-for="item in filteredComicPrompts"
            :key="item.no"
            class="flex items-start justify-between gap-3 p-3 border-b border-[var(--border-color)] last:border-b-0 hover:bg-[var(--bg-tertiary)]/40"
          >
            <div class="min-w-0">
              <div class="text-sm font-medium text-[var(--text-primary)] truncate">
                {{ item.title }}
              </div>
              <div class="mt-1 text-xs text-[var(--text-secondary)] flex flex-wrap items-center gap-2">
                <span class="px-2 py-0.5 rounded-full border border-[var(--border-color)] bg-[var(--bg-secondary)]">
                  {{ item.language || 'ZH' }}
                </span>
                <span v-if="item.no" class="text-[var(--text-tertiary)]">No. {{ item.no }}</span>
              </div>
              <div v-if="item.description" class="mt-2 text-xs text-[var(--text-secondary)] line-clamp-2">
                {{ item.description }}
              </div>
              <div class="mt-2 text-xs text-[var(--text-tertiary)] line-clamp-1">
                来源：baoyu-comic 工作流模板
              </div>
            </div>

            <n-button size="small" type="primary" @click="handleInsert(item.prompt)">
              插入
            </n-button>
          </div>
        </div>

        <div class="mt-3 text-xs text-[var(--text-secondary)] leading-5">
          <div>说明：</div>
          <div>- 用于「分析/分镜/角色设定」三步提示词模板。</div>
        </div>
      </n-tab-pane>

      <n-tab-pane name="image" tab="生图结构">
        <div class="text-xs text-[var(--text-secondary)] mb-3">
          三段式结构：<span class="font-medium">主体词</span> → <span class="font-medium">光影词</span> → <span class="font-medium">抽象/氛围词</span>
        </div>

        <div class="grid grid-cols-1 gap-2">
          <n-input v-model:value="subject" placeholder="主体词（人物/物体/场景）" />
          <n-input v-model:value="lighting" placeholder="光影词（柔和的光线/逆光/电影灯光等）" />
          <n-input v-model:value="atmosphere" placeholder="抽象/氛围词（梦幻感/高级感/电影感等）" />
          <n-input v-model:value="details" placeholder="补充细节（可选：风格/材质/构图/镜头等）" />
        </div>

        <div class="mt-3 p-3 rounded-lg border border-[var(--border-color)] bg-[var(--bg-secondary)]">
          <div class="text-xs text-[var(--text-secondary)] mb-1">预览</div>
          <div class="text-sm text-[var(--text-primary)] whitespace-pre-wrap break-words">
            {{ builtImagePrompt || '（填写上方内容后生成预览）' }}
          </div>
        </div>

        <div class="mt-3 flex justify-end">
          <n-button type="primary" :disabled="!builtImagePrompt" @click="handleInsert(builtImagePrompt)">
            插入到输入框
          </n-button>
        </div>
      </n-tab-pane>
    </n-tabs>

    <template #footer>
      <div class="flex justify-end">
        <n-button @click="showModal = false">关闭</n-button>
      </div>
    </template>
  </n-modal>
</template>

<script setup>
/**
 * Prompt Library Modal | 提示词库弹窗
 * - 视频：运镜词库（来自 CHOS 运镜 Prompt 词库）
 * - 漫画：分析/分镜/角色模板（来自 baoyu-comic）
 * - 生图：三段式结构提示词拼装（来自资料总结）
 */
import { computed, ref, watch } from 'vue'
import { NModal, NTabs, NTabPane, NInput, NSelect, NButton } from 'naive-ui'
import cameraMoves from '@/assets/prompt-libraries/chos_camera_moves.json'
import nanoBananaPrompts from '@/assets/prompt-libraries/nano_banana_pro_prompts.json'
import comicPrompts from '@/assets/prompt-libraries/baoyu_comic_prompts.json'

const props = defineProps({
  show: { type: Boolean, default: false }
})

const emit = defineEmits(['update:show', 'insert'])

const showModal = ref(props.show)
watch(() => props.show, (val) => { showModal.value = val })
watch(showModal, (val) => emit('update:show', val))

// 视频：运镜词库
const videoQuery = ref('')
const moodAdjective = ref(null)
const moodOptions = [
  { label: 'Gentle（轻柔）', value: 'Gentle' },
  { label: 'Slow（缓慢）', value: 'Slow' },
  { label: 'Fast（快速）', value: 'Fast' },
  { label: 'Aggressive（激进）', value: 'Aggressive' },
  { label: 'Smooth（平滑）', value: 'Smooth' },
  { label: 'Sudden（突然）', value: 'Sudden' },
  { label: 'Dramatic（戏剧化）', value: 'Dramatic' }
]

const filteredCameraMoves = computed(() => {
  const q = (videoQuery.value || '').trim().toLowerCase()
  if (!q) return cameraMoves
  return cameraMoves.filter(item => {
    const hay = `${item.en} ${item.zh} ${item.category} ${item.scene} ${item.desc}`.toLowerCase()
    return hay.includes(q)
  })
})

const buildCameraSnippet = (item) => {
  const mood = moodAdjective.value ? `${moodAdjective.value} ` : ''
  return `(Camera Movement: ${mood}${item.en}, ${item.zh})`
}

// Nano Banana Pro prompts（来源：GitHub README，部分精选）
const nanoQuery = ref('')
const filteredNanoPrompts = computed(() => {
  const q = (nanoQuery.value || '').trim().toLowerCase()
  if (!q) return nanoBananaPrompts
  return nanoBananaPrompts.filter(item => {
    const hay = `${item.no} ${item.title} ${item.description} ${item.prompt} ${item.language} ${(item.tags || []).join(' ')}`.toLowerCase()
    return hay.includes(q)
  })
})

// 漫画：baoyu-comic prompts
const comicQuery = ref('')
const filteredComicPrompts = computed(() => {
  const q = (comicQuery.value || '').trim().toLowerCase()
  if (!q) return comicPrompts
  return comicPrompts.filter(item => {
    const hay = `${item.no} ${item.title} ${item.description} ${item.prompt} ${item.language} ${(item.tags || []).join(' ')}`.toLowerCase()
    return hay.includes(q)
  })
})

// 生图：三段式结构
const subject = ref('')
const lighting = ref('')
const atmosphere = ref('')
const details = ref('')

const builtImagePrompt = computed(() => {
  const parts = [subject.value, lighting.value, atmosphere.value, details.value]
    .map(s => (s || '').trim())
    .filter(Boolean)
  return parts.join(', ')
})

const handleInsert = (text) => {
  const value = (text || '').trim()
  if (!value) return
  emit('insert', value)
  showModal.value = false
}
</script>
