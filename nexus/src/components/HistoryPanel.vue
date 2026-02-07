<template>
  <div class="flex flex-col h-full bg-[var(--bg-secondary)] border-l border-[var(--border-color)]">
    <!-- Header with tabs | 带标签的头部 -->
    <div class="p-3 border-b border-[var(--border-color)]">
      <div class="flex items-center justify-between mb-3">
        <span class="text-sm font-medium text-[var(--text-primary)]">历史素材</span>
        <div class="flex items-center gap-2">
          <div class="flex items-center gap-1 rounded-lg border border-[var(--border-color)] bg-[var(--bg-primary)] p-1 text-[11px]">
            <button
              @click="setHistoryPerformanceMode('ultra')"
              :class="historyPerformanceMode === 'ultra' ? 'bg-[var(--bg-tertiary)] text-[var(--text-primary)]' : 'text-[var(--text-secondary)]'"
              class="px-2 py-1 rounded-md transition-colors"
            >
              极速
            </button>
            <button
              @click="setHistoryPerformanceMode('normal')"
              :class="historyPerformanceMode === 'normal' ? 'bg-[var(--bg-tertiary)] text-[var(--text-primary)]' : 'text-[var(--text-secondary)]'"
              class="px-2 py-1 rounded-md transition-colors"
            >
              普通
            </button>
            <button
              @click="setHistoryPerformanceMode('off')"
              :class="historyPerformanceMode === 'off' ? 'bg-[var(--bg-tertiary)] text-[var(--text-primary)]' : 'text-[var(--text-secondary)]'"
              class="px-2 py-1 rounded-md transition-colors"
            >
              关闭
            </button>
          </div>
          <button
            @click="$emit('close')"
            class="p-1 hover:bg-[var(--bg-tertiary)] rounded transition-colors"
          >
            <n-icon :size="16"><CloseOutline /></n-icon>
          </button>
        </div>
      </div>
      <div class="flex bg-[var(--bg-primary)] p-1 rounded-lg border border-[var(--border-color)]">
        <button
          @click="activeTab = 'image'"
          :class="[
            'flex-1 flex items-center justify-center gap-2 py-2 text-xs font-medium rounded-md transition-colors',
            activeTab === 'image'
              ? 'bg-[var(--bg-tertiary)] text-[var(--text-primary)]'
              : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-tertiary)]'
          ]"
        >
          <n-icon :size="14"><ImageOutline /></n-icon>
          图片
        </button>
        <button
          @click="activeTab = 'video'"
          :class="[
            'flex-1 flex items-center justify-center gap-2 py-2 text-xs font-medium rounded-md transition-colors',
            activeTab === 'video'
              ? 'bg-[var(--bg-tertiary)] text-[var(--text-primary)]'
              : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-tertiary)]'
          ]"
        >
          <n-icon :size="14"><VideocamOutline /></n-icon>
          视频
        </button>
        <button
          @click="activeTab = 'audio'"
          :class="[
            'flex-1 flex items-center justify-center gap-2 py-2 text-xs font-medium rounded-md transition-colors',
            activeTab === 'audio'
              ? 'bg-[var(--bg-tertiary)] text-[var(--text-primary)]'
              : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-tertiary)]'
          ]"
        >
          <n-icon :size="14"><MusicalNotesOutline /></n-icon>
          音频
        </button>
      </div>
    </div>

    <!-- Asset grid | 资产网格 -->
    <div class="flex-1 overflow-y-auto p-3">
      <div v-if="filteredAssets.length === 0" class="flex flex-col items-center justify-center py-14 text-[var(--text-secondary)]">
        <n-icon :size="44" class="opacity-60">
          <ImageOutline v-if="activeTab === 'image'" />
          <VideocamOutline v-else-if="activeTab === 'video'" />
          <MusicalNotesOutline v-else />
        </n-icon>
        <div class="mt-3 text-xs font-medium">暂无{{ activeTab === 'image' ? '图片' : activeTab === 'video' ? '视频' : '音频' }}</div>
        <div class="mt-1 text-[11px] opacity-70">生成后会自动出现在这里</div>
      </div>

      <div v-else-if="activeTab === 'audio'" class="space-y-3">
        <div
          v-for="asset in visibleAssets"
          :key="asset.id"
          class="group rounded-xl border border-[var(--border-color)] bg-[var(--bg-primary)] hover:border-[var(--accent-color)] transition-colors p-3 cursor-grab active:cursor-grabbing"
          draggable="true"
          @dragstart="handleDragStart($event, asset)"
        >
          <div class="flex items-start justify-between gap-3">
            <div class="flex items-center gap-2 min-w-0">
              <div class="w-10 h-10 rounded-lg bg-[var(--bg-tertiary)] flex items-center justify-center">
                <n-icon :size="20"><MusicalNotesOutline /></n-icon>
              </div>
              <div class="min-w-0">
                <div class="text-sm font-medium truncate">{{ asset.title || '音频' }}</div>
                <div class="text-[11px] text-[var(--text-secondary)] truncate">
                  {{ asset.model || 'Suno' }}
                </div>
              </div>
            </div>
            <div class="flex items-center gap-2 shrink-0">
              <button
                class="px-2 py-1 rounded-md text-[11px] border border-[var(--border-color)] hover:border-[var(--accent-color)] transition-colors"
                @click.stop="handleAddToCanvas(asset)"
              >
                上板
              </button>
              <button
                class="p-1.5 rounded-md bg-[var(--bg-tertiary)] hover:bg-red-500/20 text-[var(--text-secondary)] hover:text-red-500 transition-colors"
                title="删除"
                @click.stop="handleDelete(asset.id)"
              >
                <n-icon :size="14"><TrashOutline /></n-icon>
              </button>
            </div>
          </div>
          <audio
            :src="asset.src"
            controls
            class="w-full mt-2"
            @click.stop
          />
        </div>
      </div>

      <div v-else class="grid grid-cols-2 gap-3">
        <div
          v-for="asset in visibleAssets"
          :key="asset.id"
          class="group relative aspect-square rounded-xl overflow-hidden border border-[var(--border-color)] bg-[var(--bg-primary)] hover:border-[var(--accent-color)] transition-colors cursor-grab active:cursor-grabbing"
          draggable="true"
          @dragstart="handleDragStart($event, asset)"
          @click="handleAddToCanvas(asset)"
        >
          <!-- Image | 图片 -->
          <img
            v-if="asset.type === 'image'"
            :src="getDisplaySrc(asset)"
            :alt="asset.title || '历史图片'"
            class="w-full h-full object-cover"
            loading="lazy"
            decoding="async"
            draggable="false"
            @error="handleMediaError(asset)"
          />
          <!-- Video | 视频 -->
          <video
            v-else
            :src="getDisplaySrc(asset)"
            class="w-full h-full object-cover"
            muted
            loop
            playsinline
            preload="metadata"
            @mouseenter="$event.target.play()"
            @mouseleave="$event.target.pause()"
            @error="handleMediaError(asset)"
          />

          <!-- Delete button | 删除按钮 -->
          <button
            class="absolute top-2 right-2 p-1.5 rounded-lg bg-black/40 hover:bg-black/60 text-white opacity-0 group-hover:opacity-100 transition-opacity"
            title="删除"
            @click.stop="handleDelete(asset.id)"
          >
            <n-icon :size="14"><TrashOutline /></n-icon>
          </button>

          <!-- Title overlay | 标题遮罩 -->
          <div class="absolute inset-x-0 bottom-0 p-2 bg-gradient-to-t from-black/60 to-transparent">
            <div class="text-[11px] text-white/90 overflow-hidden text-ellipsis whitespace-nowrap">
              {{ asset.title || (asset.type === 'video' ? '视频' : '图片') }}
            </div>
          </div>
        </div>
      </div>

      <div v-if="canLoadMore" class="mt-4 flex justify-center">
        <button
          class="px-3 py-1.5 text-xs rounded-lg border border-[var(--border-color)] hover:border-[var(--accent-color)] transition-colors"
          @click="loadMore"
        >
          加载更多
        </button>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, watch } from 'vue'
import { NIcon } from 'naive-ui'
import { ImageOutline, VideocamOutline, TrashOutline, CloseOutline, MusicalNotesOutline } from '@vicons/ionicons5'
import { assets, removeAsset, historyPerformanceMode, setHistoryPerformanceMode, enqueueThumbnails, getAssetThumbnail, getLocalCacheUrl, enqueueLocalCache, localCacheEnabled } from '../stores/assets'

const emit = defineEmits(['close', 'add-to-canvas'])

const activeTab = ref('image')
const localCacheFailures = ref(new Set())
const visibleCount = ref(40)

const resetVisibleCount = () => {
  visibleCount.value = 40
}

const filteredAssets = computed(() => {
  return assets.value.filter(a => a.type === activeTab.value)
})

const visibleAssets = computed(() => {
  return filteredAssets.value.slice(0, visibleCount.value)
})

const canLoadMore = computed(() => filteredAssets.value.length > visibleCount.value)

const loadMore = () => {
  visibleCount.value = Math.min(filteredAssets.value.length, visibleCount.value + 40)
}

watch(activeTab, resetVisibleCount)
watch(assets, () => {
  if (visibleCount.value > filteredAssets.value.length) {
    visibleCount.value = filteredAssets.value.length
  }
}, { deep: true })

const getDisplaySrc = (asset) => {
  if (!asset) return ''
  const failures = localCacheFailures.value
  const localCacheUrl = failures.has(asset.id) ? '' : getLocalCacheUrl(asset)
  if (localCacheUrl) return localCacheUrl

  if (historyPerformanceMode.value !== 'off') {
    const thumb = getAssetThumbnail(asset, historyPerformanceMode.value)
    if (thumb) return thumb
  }

  return asset.src
}

const handleMediaError = (asset) => {
  if (!asset) return
  const next = new Set(localCacheFailures.value)
  next.add(asset.id)
  localCacheFailures.value = next
}

watch([filteredAssets, historyPerformanceMode, localCacheEnabled], ([list, mode]) => {
  enqueueThumbnails(list, mode)
  enqueueLocalCache(list)
}, { immediate: true })

watch(localCacheEnabled, (enabled) => {
  if (enabled) {
    localCacheFailures.value = new Set()
  }
})

const handleDragStart = (e, asset) => {
  e.dataTransfer.setData('application/json', JSON.stringify({
    type: asset.type,
    src: asset.src,
    title: asset.title,
    model: asset.model,
    duration: asset.duration
  }))
  e.dataTransfer.effectAllowed = 'copy'
}

const handleAddToCanvas = (asset) => {
  emit('add-to-canvas', asset)
}

const handleDelete = (id) => {
  removeAsset(id)
  window.$message?.success('已删除')
}
</script>
