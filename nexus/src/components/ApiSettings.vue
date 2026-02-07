<template>
  <!-- API Settings Modal | API 设置弹窗 -->
  <n-modal v-model:show="showModal" preset="card" title="API 设置" style="width: 480px;">
    <n-form ref="formRef" :model="formData" label-placement="left" label-width="80">
      <n-form-item label="Base URL">
        <n-input :value="baseUrl" placeholder="https://nexusapi.cn/v1" disabled />
      </n-form-item>

      <n-form-item label="API Key" path="apiKey">
        <n-input
          v-model:value="formData.apiKey"
          type="password"
          show-password-on="click"
          placeholder="请输入 API Key"
        />
      </n-form-item>

      <div class="mb-2 flex justify-end">
        <a
          href="javascript:void(0)"
          @click="openExternalLink('https://nexusapi.cn/')"
          class="text-xs text-[var(--accent-color)] hover:underline flex items-center gap-1 cursor-pointer"
        >
          🔑 获取 API Key
        </a>
      </div>

    <n-divider title-placement="left" class="!my-3">
      <span class="text-xs text-[var(--text-secondary)]">端点路径</span>
    </n-divider>

      <div class="endpoint-list">
        <div class="endpoint-item">
          <span class="endpoint-label">问答</span>
          <n-tag size="small" type="info" class="endpoint-tag">/responses</n-tag>
        </div>
        <div class="endpoint-item">
          <span class="endpoint-label">生图</span>
          <n-tag size="small" type="success" class="endpoint-tag">/images/generations</n-tag>
        </div>
        <div class="endpoint-item">
          <span class="endpoint-label">视频生成</span>
          <n-tag size="small" type="warning" class="endpoint-tag">/video/create</n-tag>
        </div>
        <div class="endpoint-item">
          <span class="endpoint-label">视频查询</span>
          <n-tag size="small" type="warning" class="endpoint-tag">/video/query?id={taskId}</n-tag>
        </div>
      </div>

      <n-alert v-if="!isConfigured" type="warning" title="未配置" class="mb-4">
        <div class="flex flex-col gap-2">
          <p>请配置 API Key 以使用 AI 功能</p>
          <a
            href="javascript:void(0)"
            @click="openExternalLink('https://nexusapi.cn/pricing')"
            class="text-[var(--accent-color)] hover:underline text-sm flex items-center gap-1 cursor-pointer"
          >
            🔗 点击查看模型价格
            <span class="text-xs">（nexusapi.cn）</span>
          </a>
        </div>
      </n-alert>

      <n-alert v-else type="success" title="已配置" class="mb-4">
        API 已就绪，可以使用 AI 功能
      </n-alert>

      <n-divider title-placement="left" class="!my-3">
        <span class="text-xs text-[var(--text-secondary)]">本地缓存</span>
      </n-divider>

      <n-form-item label="启用">
        <n-switch v-model:value="formData.localCacheEnabled" size="small" />
      </n-form-item>

      <n-form-item label="地址">
        <n-input
          v-model:value="formData.localCacheBaseUrl"
          placeholder="http://127.0.0.1:9527"
        />
      </n-form-item>
    </n-form>

    <template #footer>
      <div class="flex justify-between items-center">
        <a
          href="javascript:void(0)"
          @click="openExternalLink('https://nexusapi.cn/pricing')"
          class="text-xs text-[var(--text-secondary)] hover:text-[var(--accent-color)] transition-colors cursor-pointer"
        >
          查看模型价格
        </a>
        <div class="flex gap-2">
          <n-button @click="handleClear" tertiary>清除配置</n-button>
          <n-button @click="showModal = false">取消</n-button>
          <n-button type="primary" @click="handleSave">保存</n-button>
        </div>
      </div>
    </template>
  </n-modal>
</template>

<script setup>
/**
 * API Settings Component | API 设置组件
 * Modal for configuring API key and base URL
 */
import { ref, reactive, watch, onMounted } from 'vue'
import { NModal, NForm, NFormItem, NInput, NButton, NAlert, NDivider, NTag, NSwitch } from 'naive-ui'
import { useApiConfig } from '../hooks'
import { localCacheEnabled, localCacheBaseUrl, setLocalCacheEnabled, setLocalCacheBaseUrl } from '../stores/assets'

// Props | 属性
const props = defineProps({
  show: {
    type: Boolean,
    default: false
  }
})

// Emits | 事件
const emit = defineEmits(['update:show', 'saved'])

// API Config hook | API 配置 hook
const { apiKey, baseUrl, isConfigured, setApiKey, clear: clearConfig } = useApiConfig()

// Modal visibility | 弹窗可见性
const showModal = ref(props.show)

// Form data | 表单数据
const formData = reactive({
  apiKey: apiKey.value,
  localCacheEnabled: localCacheEnabled.value,
  localCacheBaseUrl: localCacheBaseUrl.value
})

// Tauri opener | Tauri 打开外部链接
let tauriOpen = null
onMounted(async () => {
  try {
    const { open } = await import('@tauri-apps/plugin-opener')
    tauriOpen = open
  } catch {
    // Not in Tauri environment
  }
})

const openExternalLink = async (url) => {
  const link = String(url || '').trim()
  if (!link) return
  try {
    if (tauriOpen) {
      await tauriOpen(link)
      return
    }
  } catch {
    // fall back below
  }
  try {
    window.open(link, '_blank', 'noopener,noreferrer')
  } catch {
    // ignore
  }
}

// Watch prop changes | 监听属性变化
watch(() => props.show, (val) => {
  showModal.value = val
  if (val) {
    formData.apiKey = apiKey.value
    formData.localCacheEnabled = localCacheEnabled.value
    formData.localCacheBaseUrl = localCacheBaseUrl.value
  }
})

// Watch modal changes | 监听弹窗变化
watch(showModal, (val) => {
  emit('update:show', val)
})

// Handle save | 处理保存
const handleSave = () => {
  if (formData.apiKey) {
    setApiKey(formData.apiKey)
  }
  setLocalCacheEnabled(formData.localCacheEnabled)
  setLocalCacheBaseUrl(formData.localCacheBaseUrl)
  showModal.value = false
  emit('saved')
}

// Handle clear | 处理清除
const handleClear = () => {
  clearConfig()
  formData.apiKey = ''
}
</script>

<style scoped>
.endpoint-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-bottom: 16px;
  padding: 12px;
  background: var(--bg-secondary, #f5f5f5);
  border-radius: 6px;
}

.endpoint-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.endpoint-label {
  font-size: 13px;
  color: var(--text-secondary, #666);
  min-width: 70px;
}

.endpoint-tag {
  font-family: monospace;
  font-size: 12px;
}
</style>
