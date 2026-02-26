/**
 * 图片上传到云雾图床（共享模块）
 * 用于将本地图片（dataURL / base64 / blob / asset）转换为公网可访问的 HTTP(s) URL
 */
import { postFormData } from '@/lib/workflow/request'

const isHttpUrl = (v: string) => /^https?:\/\//i.test(v)
const isAssetUrl = (v: string) => /^asset:\/\//i.test(String(v || '').trim())
const isDataUrl = (v: string) => /^data:image\/[a-z0-9.+-]+;base64,/i.test(String(v || '').trim())
const isBase64Like = (v: string) => /^[A-Za-z0-9+/=]+$/.test(String(v || '').trim())

const getApiKey = () => {
  try { return localStorage.getItem('apiKey') || '' } catch { return '' }
}

const resolveAssetToDataUrl = async (assetUrl: string): Promise<string> => {
  const u = String(assetUrl || '').trim()
  if (!u || !isAssetUrl(u)) return u
  const res = await (globalThis.fetch as any)(u, { method: 'GET' })
  if (!res?.ok) throw new Error(`asset:// fetch failed: ${res?.status || 0}`)
  const blob = await res.blob()
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(new Error('read failed'))
    reader.onload = () => {
      const result = String(reader.result || '')
      if (result.startsWith('data:')) resolve(result)
      else reject(new Error('asset:// 转换 dataURL 失败'))
    }
    reader.readAsDataURL(blob)
  })
}

const compressImageBase64 = async (base64Data: string, maxSizeBytes: number = 900 * 1024): Promise<string> => {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => {
      const canvas = document.createElement('canvas')
      const ctx = canvas.getContext('2d')
      if (!ctx) { reject(new Error('无法创建 canvas context')); return }

      let { width, height } = img

      const comma = base64Data.indexOf(',')
      const currentSize = comma >= 0 ? Math.ceil((base64Data.length - (comma + 1)) * 0.75) : Math.ceil(base64Data.length * 0.75)
      if (currentSize <= maxSizeBytes) { resolve(base64Data); return }

      const sizeRatio = Math.sqrt(maxSizeBytes / currentSize)
      if (sizeRatio < 1) {
        width = Math.floor(width * Math.max(sizeRatio, 0.5))
        height = Math.floor(height * Math.max(sizeRatio, 0.5))
      }
      const maxDim = 1920
      if (width > maxDim || height > maxDim) {
        const scale = maxDim / Math.max(width, height)
        width = Math.floor(width * scale)
        height = Math.floor(height * scale)
      }

      canvas.width = width
      canvas.height = height
      ctx.drawImage(img, 0, 0, width, height)

      let result = base64Data
      for (let q = 0.85; q >= 0.3; q -= 0.1) {
        result = canvas.toDataURL('image/jpeg', q)
        const c = result.indexOf(',')
        const size = c >= 0 ? Math.ceil((result.length - (c + 1)) * 0.75) : Math.ceil(result.length * 0.75)
        if (size <= maxSizeBytes) { resolve(result); return }
      }
      width = Math.floor(width * 0.7)
      height = Math.floor(height * 0.7)
      canvas.width = width
      canvas.height = height
      ctx.drawImage(img, 0, 0, width, height)
      resolve(canvas.toDataURL('image/jpeg', 0.6))
    }
    img.onerror = () => reject(new Error('图片加载失败'))
    img.src = base64Data
  })
}

export const uploadImageToYunwu = async (dataUrlOrBase64: string): Promise<string> => {
  const apiKey = getApiKey()
  if (!apiKey) throw new Error('缺少 API Key，无法上传到云雾图床')

  let dataUrl = String(dataUrlOrBase64 || '').trim()
  if (!dataUrl) throw new Error('空图片数据')
  if (isBase64Like(dataUrl) && !dataUrl.startsWith('data:')) {
    dataUrl = `data:image/png;base64,${dataUrl}`
  }
  if (!dataUrl.startsWith('data:')) throw new Error('云雾图床上传仅支持 dataURL/base64 输入')

  const m = dataUrl.match(/^data:([^;]+);base64,(.*)$/)
  if (!m) throw new Error('图片 dataURL 解析失败')
  const mimeType = String(m[1] || 'image/png')
  const byteCharacters = atob(String(m[2] || ''))
  const byteArray = new Uint8Array(byteCharacters.length)
  for (let i = 0; i < byteCharacters.length; i++) byteArray[i] = byteCharacters.charCodeAt(i)
  const blob = new Blob([byteArray], { type: mimeType })

  const ext = mimeType.split('/')[1] || 'png'
  const form = new FormData()
  form.append('file', blob, `image.${ext}`)

  const resp = await postFormData<any>('https://imageproxy.zhongzhuan.chat/api/upload', form, { authMode: 'bearer', timeoutMs: 120000 })
  const urlOut = String(resp?.url || resp?.data?.url || resp?.data?.link || '').trim()
  if (urlOut && /^https?:\/\//i.test(urlOut)) return urlOut
  throw new Error(String(resp?.error || resp?.message || resp?.data?.message || '云雾图床上传失败'))
}

/**
 * 确保图片为公网可访问的 HTTP(s) URL。
 * 如果是本地图片（dataURL / base64 / blob / asset），自动压缩并上传到云雾图床。
 */
export const ensureHttpImage = async (raw: string, label = '参考图'): Promise<string> => {
  let v = String(raw || '').trim()
  if (!v) return ''

  if (v.startsWith('blob:')) {
    const res = await (globalThis.fetch as any)(v, { method: 'GET' })
    if (!res?.ok) throw new Error(`${label}图片转换失败：请尝试重新导入该图片`)
    const blob = await res.blob()
    v = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader()
      reader.onerror = () => reject(new Error('read failed'))
      reader.onload = () => resolve(String(reader.result || ''))
      reader.readAsDataURL(blob)
    })
    if (!v.startsWith('data:')) throw new Error(`${label}图片转换失败`)
  }

  if (isAssetUrl(v)) v = await resolveAssetToDataUrl(v)
  if (isHttpUrl(v)) return v
  if (isDataUrl(v)) {
    const compressed = await compressImageBase64(v, 900 * 1024)
    return await uploadImageToYunwu(compressed)
  }
  if (isBase64Like(v)) {
    const compressed = await compressImageBase64(`data:image/png;base64,${v}`, 900 * 1024)
    return await uploadImageToYunwu(compressed)
  }
  throw new Error(`${label}需要公网可访问的图片 URL（http/https）或 dataURL/base64`)
}
