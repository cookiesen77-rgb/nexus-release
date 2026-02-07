<template>
  <n-modal
    v-model:show="visible"
    preset="card"
    title="裁剪图片"
    style="width: 90vw; max-width: 1200px;"
    :mask-closable="false"
  >
    <div class="flex flex-col gap-4">
      <!-- Ratio Selector -->
      <div class="flex items-center gap-2 flex-wrap">
        <span class="text-sm text-[var(--text-secondary)]">比例：</span>
        <button
          v-for="ratio in ratios"
          :key="ratio.label"
          @click="aspectRatio = ratio.value"
          :class="[
            'px-3 py-1.5 text-xs rounded-lg border transition-colors',
            aspectRatio === ratio.value
              ? 'bg-[var(--accent-color)] text-white border-[var(--accent-color)]'
              : 'bg-[var(--bg-secondary)] text-[var(--text-primary)] border-[var(--border-color)] hover:border-[var(--accent-color)]'
          ]"
        >
          {{ ratio.label }}
        </button>
      </div>

      <!-- Canvas Container -->
      <div
        ref="containerRef"
        class="relative bg-[var(--bg-primary)] rounded-lg overflow-hidden"
        style="height: 60vh;"
        @mousedown="handleMouseDown"
      >
        <img
          ref="imgRef"
          :src="imageSrc"
          class="max-w-full max-h-full object-contain mx-auto"
          draggable="false"
          @load="initializeCrop"
        />

        <!-- Crop Overlay -->
        <div
          v-if="crop"
          class="absolute pointer-events-none"
          :style="{
            left: crop.x + 'px',
            top: crop.y + 'px',
            width: crop.width + 'px',
            height: crop.height + 'px',
            border: '2px solid var(--accent-color)',
            boxShadow: '0 0 0 9999px rgba(0, 0, 0, 0.5)'
          }"
        >
          <!-- Resize Handles -->
          <div
            v-for="handle in ['nw', 'ne', 'sw', 'se']"
            :key="handle"
            :class="[
              'absolute w-3 h-3 bg-white border-2 border-[var(--accent-color)] rounded-full pointer-events-auto cursor-pointer',
              handle === 'nw' && '-left-1.5 -top-1.5',
              handle === 'ne' && '-right-1.5 -top-1.5',
              handle === 'sw' && '-left-1.5 -bottom-1.5',
              handle === 'se' && '-right-1.5 -bottom-1.5'
            ]"
            @mousedown.stop="handleMouseDown($event, 'resize', handle)"
          />

          <!-- Move Handle (center) -->
          <div
            class="absolute inset-0 cursor-move pointer-events-auto"
            @mousedown.stop="handleMouseDown($event, 'move')"
          />
        </div>
      </div>
    </div>

    <template #footer>
      <n-space justify="end">
        <n-button @click="handleCancel">取消</n-button>
        <n-button type="primary" @click="handleConfirm" :disabled="!crop">确认裁剪</n-button>
      </n-space>
    </template>
  </n-modal>
</template>

<script setup>
import { ref, watch, nextTick } from 'vue'
import { NModal, NButton, NSpace } from 'naive-ui'

const props = defineProps({
  show: Boolean,
  imageSrc: String
})

const emit = defineEmits(['update:show', 'confirm', 'cancel'])

const visible = ref(false)
const imgRef = ref(null)
const containerRef = ref(null)
const crop = ref(null)
const aspectRatio = ref(null)

const ratios = [
  { label: '自由', value: null },
  { label: '16:9', value: 16 / 9 },
  { label: '9:16', value: 9 / 16 },
  { label: '4:3', value: 4 / 3 },
  { label: '3:4', value: 3 / 4 },
  { label: '1:1', value: 1 }
]

let interaction = {
  type: 'create',
  handle: null,
  startPos: { x: 0, y: 0 },
  startCrop: null
}

watch(() => props.show, (val) => {
  visible.value = val
  if (val) {
    nextTick(() => {
      initializeCrop()
    })
  }
})

watch(visible, (val) => {
  emit('update:show', val)
})

const getRelativePos = (e) => {
  if (!imgRef.value) return { x: 0, y: 0 }
  const rect = imgRef.value.getBoundingClientRect()
  return {
    x: e.clientX - rect.left,
    y: e.clientY - rect.top
  }
}

const clampRect = (rect, maxW, maxH) => {
  let { x, y, width, height } = rect
  if (x < 0) x = 0
  if (y < 0) y = 0
  if (width > maxW) width = maxW
  if (height > maxH) height = maxH
  if (x + width > maxW) x = maxW - width
  if (y + height > maxH) y = maxH - height
  return { x, y, width, height }
}

const initializeCrop = () => {
  if (!imgRef.value) return
  const rect = imgRef.value.getBoundingClientRect()
  const w = rect.width
  const h = rect.height
  const size = Math.min(w, h) * 0.6
  crop.value = {
    x: (w - size) / 2,
    y: (h - size) / 2,
    width: size,
    height: size
  }
}

const handleMouseDown = (e, type = 'create', handle = null) => {
  e.preventDefault()
  e.stopPropagation()

  const pos = getRelativePos(e)
  let startCrop = crop.value

  if (type === 'create') {
    startCrop = { x: pos.x, y: pos.y, width: 0, height: 0 }
    crop.value = startCrop
  }

  interaction = {
    type,
    handle,
    startPos: { x: pos.x, y: pos.y },
    startCrop: startCrop ? { ...startCrop } : null
  }

  window.addEventListener('mousemove', handleMouseMove)
  window.addEventListener('mouseup', handleMouseUp)
}

const handleMouseMove = (e) => {
  if (!interaction.startCrop || !imgRef.value) return

  const pos = getRelativePos(e)
  const dx = pos.x - interaction.startPos.x
  const dy = pos.y - interaction.startPos.y
  const rect = imgRef.value.getBoundingClientRect()

  let newCrop = { ...interaction.startCrop }

  if (interaction.type === 'create' || interaction.type === 'resize') {
    if (interaction.type === 'create' || interaction.handle === 'se') {
      newCrop.width = interaction.startCrop.width + dx
      newCrop.height = interaction.startCrop.height + dy
    } else if (interaction.handle === 'nw') {
      newCrop.x = interaction.startCrop.x + dx
      newCrop.y = interaction.startCrop.y + dy
      newCrop.width = interaction.startCrop.width - dx
      newCrop.height = interaction.startCrop.height - dy
    } else if (interaction.handle === 'ne') {
      newCrop.y = interaction.startCrop.y + dy
      newCrop.width = interaction.startCrop.width + dx
      newCrop.height = interaction.startCrop.height - dy
    } else if (interaction.handle === 'sw') {
      newCrop.x = interaction.startCrop.x + dx
      newCrop.width = interaction.startCrop.width - dx
      newCrop.height = interaction.startCrop.height + dy
    }

    if (aspectRatio.value) {
      const targetRatio = aspectRatio.value
      if (Math.abs(newCrop.width / newCrop.height - targetRatio) > 0.01) {
        newCrop.height = newCrop.width / targetRatio
      }
    }
  } else if (interaction.type === 'move') {
    newCrop.x = interaction.startCrop.x + dx
    newCrop.y = interaction.startCrop.y + dy
  }

  crop.value = clampRect(newCrop, rect.width, rect.height)
}

const handleMouseUp = () => {
  window.removeEventListener('mousemove', handleMouseMove)
  window.removeEventListener('mouseup', handleMouseUp)
}

const handleConfirm = () => {
  if (!crop.value || !imgRef.value) return

  const canvas = document.createElement('canvas')
  const ctx = canvas.getContext('2d')
  const img = imgRef.value
  const rect = img.getBoundingClientRect()

  const scaleX = img.naturalWidth / rect.width
  const scaleY = img.naturalHeight / rect.height

  canvas.width = crop.value.width * scaleX
  canvas.height = crop.value.height * scaleY

  ctx.drawImage(
    img,
    crop.value.x * scaleX,
    crop.value.y * scaleY,
    crop.value.width * scaleX,
    crop.value.height * scaleY,
    0,
    0,
    canvas.width,
    canvas.height
  )

  const croppedBase64 = canvas.toDataURL('image/png')
  emit('confirm', croppedBase64)
  visible.value = false
}

const handleCancel = () => {
  emit('cancel')
  visible.value = false
}
</script>
