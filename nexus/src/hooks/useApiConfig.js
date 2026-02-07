/**
 * API Config Hook | API 配置 Hook
 */

import { ref, computed, watch } from 'vue'
import { setBaseUrl as setRequestBaseUrl } from '@/utils'
import { DEFAULT_API_BASE_URL, STORAGE_KEYS } from '@/utils'

/**
 * Get stored value from localStorage | 从 localStorage 获取存储值
 */
const getStored = (key, defaultValue = '') => {
  try {
    return localStorage.getItem(key) || defaultValue
  } catch {
    return defaultValue
  }
}

/**
 * Set stored value to localStorage | 设置存储值到 localStorage
 */
const setStored = (key, value) => {
  try {
    if (value) {
      localStorage.setItem(key, value)
    } else {
      localStorage.removeItem(key)
    }
  } catch {
    // Ignore storage errors
  }
}

/**
 * API Configuration Hook | API 配置 Hook
 */
export const useApiConfig = () => {
  const apiKey = ref(getStored(STORAGE_KEYS.API_KEY))
  const baseUrl = ref(DEFAULT_API_BASE_URL)
  // Clear any legacy custom base URL
  setStored(STORAGE_KEYS.BASE_URL, '')
  
  // Always enforce the default base URL
  setRequestBaseUrl(DEFAULT_API_BASE_URL)
  
  const isConfigured = computed(() => !!apiKey.value)

  // Watch and sync changes | 监听并同步变化
  watch(apiKey, (newKey) => {
    setStored(STORAGE_KEYS.API_KEY, newKey)
  })

  const setApiKey = (key) => {
    apiKey.value = key
    setStored(STORAGE_KEYS.API_KEY, key)
    setRequestBaseUrl(DEFAULT_API_BASE_URL)
  }

  const configure = (config) => {
    if (config.apiKey) setApiKey(config.apiKey)
    setRequestBaseUrl(DEFAULT_API_BASE_URL)
  }

  const clear = () => {
    apiKey.value = ''
    baseUrl.value = DEFAULT_API_BASE_URL
    setStored(STORAGE_KEYS.BASE_URL, '')
    setRequestBaseUrl(DEFAULT_API_BASE_URL)
  }

  return {
    apiKey,
    baseUrl,
    isConfigured,
    setApiKey,
    configure,
    clear
  }
}
