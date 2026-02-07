<template>
  <div class="audio-node-wrapper">
    <div
      class="audio-node bg-[var(--bg-secondary)] rounded-xl border w-[360px]"
      :class="data.selected ? 'border-1 border-blue-500 shadow-lg shadow-blue-500/20' : 'border border-[var(--border-color)]'"
    >
      <!-- Header | 头部 -->
      <div class="px-3 py-2 border-b border-[var(--border-color)]">
        <div class="flex items-center justify-between">
          <span class="text-sm font-medium text-[var(--text-secondary)]">{{ data.label }}</span>
          <div class="flex items-center gap-1">
            <button
              v-if="data.url"
              @click="handleDownload"
              class="p-1 hover:bg-[var(--bg-tertiary)] rounded transition-colors"
              title="下载"
            >
              <n-icon :size="14"><DownloadOutline /></n-icon>
            </button>
            <button
              @click="handleDelete"
              class="p-1 hover:bg-[var(--bg-tertiary)] rounded transition-colors"
              title="删除"
            >
              <n-icon :size="14"><TrashOutline /></n-icon>
            </button>
          </div>
        </div>
        <div v-if="data.model" class="mt-1 text-xs text-[var(--text-secondary)] truncate">
          {{ data.model }}
        </div>
      </div>

      <!-- Body | 内容 -->
      <div class="p-3 space-y-3">
        <!-- Loading -->
        <div
          v-if="data.loading"
          class="h-24 rounded-lg bg-[var(--bg-tertiary)] flex flex-col items-center justify-center gap-2 border border-[var(--border-color)]"
        >
          <n-spin :size="20" />
          <span class="text-xs text-[var(--text-secondary)]">生成中...</span>
        </div>
        <!-- Error -->
        <div
          v-else-if="data.error"
          class="h-24 rounded-lg bg-red-50 dark:bg-red-900/20 flex flex-col items-center justify-center gap-2 border border-red-200 dark:border-red-800"
        >
          <n-icon :size="28" class="text-red-500"><CloseCircleOutline /></n-icon>
          <span class="text-xs text-red-500">{{ data.error }}</span>
        </div>
        <!-- Audio player -->
        <div v-else-if="data.url" class="rounded-lg bg-[var(--bg-tertiary)] p-2">
          <audio
            :src="data.url"
            controls
            class="w-full"
          />
        </div>
        <!-- Empty -->
        <div
          v-else
          class="h-24 rounded-lg bg-[var(--bg-tertiary)] flex flex-col items-center justify-center gap-2 border-2 border-dashed border-[var(--border-color)] relative"
        >
          <n-icon :size="28" class="text-[var(--text-secondary)]"><MusicalNotesOutline /></n-icon>
          <span class="text-xs text-[var(--text-secondary)]">拖放音频或点击上传</span>
          <input
            type="file"
            accept="audio/*"
            class="absolute inset-0 opacity-0 cursor-pointer"
            @change="handleFileUpload"
          />
        </div>

        <div v-if="data.duration" class="text-xs text-[var(--text-secondary)]">
          时长: {{ formatDuration(data.duration) }}
        </div>
      </div>

      <Handle type="source" :position="Position.Right" id="right" class="!bg-[var(--accent-color)]" />
      <Handle type="target" :position="Position.Left" id="left" class="!bg-[var(--accent-color)]" />
    </div>
  </div>
</template>

<script setup>
import { Handle, Position } from '@vue-flow/core'
import { NIcon, NSpin } from 'naive-ui'
import { TrashOutline, DownloadOutline, MusicalNotesOutline, CloseCircleOutline } from '@vicons/ionicons5'
import { updateNode, removeNode } from '../../stores/canvas'

const props = defineProps({
  id: String,
  data: Object
})

const handleFileUpload = (event) => {
  const file = event.target.files[0]
  if (!file) return

  const reader = new FileReader()
  reader.onload = () => {
    updateNode(props.id, {
      url: reader.result,
      fileName: file.name,
      updatedAt: Date.now()
    })
  }
  reader.readAsDataURL(file)
}

const handleDelete = () => {
  removeNode(props.id)
}

const handleDownload = () => {
  if (!props.data.url) return
  const link = document.createElement('a')
  link.href = props.data.url
  link.download = props.data.fileName || `audio_${Date.now()}.mp3`
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
  window.$message?.success('音频下载中...')
}

const formatDuration = (seconds) => {
  const mins = Math.floor(seconds / 60)
  const secs = Math.floor(seconds % 60)
  return `${mins}:${secs.toString().padStart(2, '0')}`
}
</script>

<style scoped>
.audio-node-wrapper {
  padding-right: 50px;
  padding-top: 20px;
}

.audio-node {
  cursor: default;
}
</style>
