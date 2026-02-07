<template>
  <div class="local-save-node-wrapper" @mouseenter="showActions = true" @mouseleave="showActions = false">
    <div
      class="local-save-node bg-[var(--bg-secondary)] rounded-xl border min-w-[240px] relative transition-all duration-200"
      :class="data.selected ? 'border-1 border-blue-500 shadow-lg shadow-blue-500/20' : 'border border-[var(--border-color)]'"
    >
      <div class="flex items-center justify-between px-3 py-2 border-b border-[var(--border-color)]">
        <span class="text-sm font-medium text-[var(--text-secondary)]">{{ data.label || '本地保存' }}</span>
        <div class="flex items-center gap-1">
          <button @click="toggleAuto" class="p-1 hover:bg-[var(--bg-tertiary)] rounded transition-colors" :title="autoExecute ? '自动保存：开' : '自动保存：关'">
            <n-icon :size="14">
              <FlashOutline v-if="autoExecute" />
              <PowerOutline v-else />
            </n-icon>
          </button>
          <button @click="handleDelete" class="p-1 hover:bg-[var(--bg-tertiary)] rounded transition-colors">
            <n-icon :size="14">
              <TrashOutline />
            </n-icon>
          </button>
        </div>
      </div>

      <div class="p-3 space-y-2">
        <div class="text-xs text-[var(--text-secondary)]">
          已连接 {{ connectedAssets.length }} 个素材
        </div>
        <div class="flex items-center gap-2 text-[11px] text-[var(--text-secondary)]">
          <span class="px-2 py-0.5 rounded-full bg-[var(--bg-tertiary)]">
            本地缓存{{ cacheEnabled ? '已启用' : '未启用' }}
          </span>
        </div>
        <button
          @click="handleSave"
          :disabled="saving || connectedAssets.length === 0"
          class="w-full flex items-center justify-center gap-2 py-2 px-4 rounded-lg bg-[var(--accent-color)] hover:bg-[var(--accent-hover)] text-white text-sm font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <n-spin v-if="saving" :size="14" />
          <span v-else>保存到本地</span>
        </button>
      </div>

      <Handle type="target" :position="Position.Left" id="left" class="!bg-[var(--accent-color)]" />
    </div>
  </div>
</template>

<script setup>
import { computed, ref, watch } from 'vue'
import { Handle, Position } from '@vue-flow/core'
import { NIcon, NSpin } from 'naive-ui'
import { TrashOutline, FlashOutline, PowerOutline } from '@vicons/ionicons5'
import { nodes, updateNode, removeNode, getNodeById, getIncomingEdges } from '../../stores/canvas'
import { localCacheEnabled, saveAssetToLocal } from '../../stores/assets'

const props = defineProps({
  id: String,
  data: Object
})

const showActions = ref(false)
const saving = ref(false)
const autoExecute = computed(() => Boolean(props.data?.autoExecute))
const cacheEnabled = computed(() => localCacheEnabled.value)

const connectedAssets = computed(() => {
  const connectedEdges = getIncomingEdges(props.id)
  const result = []
  for (const edge of connectedEdges) {
    const source = getNodeById(edge.source)
    if (!source) continue
    if (!['image', 'video', 'audio'].includes(source.type)) continue
    const url = source.data?.url
    if (!url) continue
    result.push({
      type: source.type,
      url,
      name: source.data?.label || source.data?.fileName || source.type
    })
  }
  return result
})

const toggleAuto = () => {
  updateNode(props.id, { autoExecute: !autoExecute.value })
}

const handleDelete = () => {
  removeNode(props.id)
}

const handleSave = async (isAuto = false) => {
  if (saving.value || connectedAssets.value.length === 0) return
  if (isAuto && !cacheEnabled.value) {
    window.$message?.warning('自动保存需要启用本地缓存服务')
    return
  }
  saving.value = true
  try {
    let savedCount = 0
    for (const asset of connectedAssets.value) {
      const result = await saveAssetToLocal({ ...asset, allowFallbackDownload: !isAuto })
      if (result?.ok) savedCount += 1
    }
    if (savedCount > 0) {
      window.$message?.success(`已保存 ${savedCount} 个素材`)
    } else {
      window.$message?.warning('未保存任何素材')
    }
  } catch (err) {
    window.$message?.error(err.message || '保存失败')
  } finally {
    saving.value = false
  }
}

watch([connectedAssets, autoExecute], ([list, auto]) => {
  if (!auto || list.length === 0) return
  handleSave(true)
})
</script>

<style scoped>
.local-save-node-wrapper {
  position: relative;
}
</style>
