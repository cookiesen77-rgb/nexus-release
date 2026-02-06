/**
 * Download utility for Tauri and Web
 * Tauri: 使用 dialog 选择保存路径 + fs 写入文件
 * Web: 使用 blob URL + anchor 下载
 */

// 检测 Tauri 环境
const isTauri = typeof window !== 'undefined' && !!(window as any).__TAURI_INTERNALS__

interface DownloadOptions {
  url: string
  filename: string
  mimeType?: string
}

/**
 * Base64 字符串转 Uint8Array（高效处理大型数据）
 */
function base64ToUint8Array(base64: string): Uint8Array {
  const binaryString = atob(base64)
  const len = binaryString.length
  const bytes = new Uint8Array(len)
  for (let i = 0; i < len; i++) {
    bytes[i] = binaryString.charCodeAt(i)
  }
  return bytes
}

/**
 * 从 asset:// 或 http://asset.localhost/ URL 中提取本地文件路径
 * Tauri 2.x 在 Windows 上会将 asset:// 重写为 http://asset.localhost/
 *
 * asset://localhost/path/to/file -> /path/to/file
 * http://asset.localhost/C%3A%5CUsers%5C... -> C:\Users\...
 */
function extractLocalPath(assetUrl: string): string | null {
  if (!assetUrl.startsWith('asset://') && !assetUrl.startsWith('http://asset.localhost/')) return null
  try {
    const url = new URL(assetUrl)
    const p = decodeURIComponent(url.pathname)
    // Windows: /C:/Users/... -> C:/Users/...
    if (/^\/[A-Za-z]:[\\/]/.test(p)) return p.slice(1)
    return p
  } catch {
    return null
  }
}

/**
 * 检测是否为 Tauri asset 协议 URL（含 Windows 的 http://asset.localhost/ 形式）
 */
function isAssetProtocolUrl(url: string): boolean {
  return url.startsWith('asset://') || url.startsWith('http://asset.localhost/')
}

/**
 * 规范化网关相对路径为绝对 URL（Tauri plugin-http 需要绝对地址）
 * 同时确保 URL 中的非 ASCII 字符被正确编码
 */
function normalizeGatewayUrl(url: string): string {
  const u = String(url || '').trim()
  if (!u) return u
  if (u.startsWith('asset://') || u.startsWith('http://asset.localhost/') || u.startsWith('data:') || u.startsWith('blob:')) return u

  // 对 HTTP URL 进行编码处理，确保非 ASCII 字符被正确编码
  if (/^https?:\/\//i.test(u)) {
    try {
      // 解析 URL 并重新编码
      const parsed = new URL(u)
      // 重新编码 pathname 和 search，保留已编码的字符
      parsed.pathname = parsed.pathname.split('/').map(segment => {
        try {
          // 先解码再编码，避免双重编码
          return encodeURIComponent(decodeURIComponent(segment))
        } catch {
          return encodeURIComponent(segment)
        }
      }).join('/')
      return parsed.toString()
    } catch {
      // URL 解析失败，尝试简单编码
      return encodeURI(u)
    }
  }

  const prefixes = ['/v1/', '/v1beta', '/kling', '/tencent-vod', '/video', '/minimax']
  if (u.startsWith('/')) {
    for (const p of prefixes) {
      if (u.startsWith(p)) return `https://nexusapi.cn${u}`
    }
  }
  return u
}

const getApiKeySafe = () => {
  try {
    return localStorage.getItem('apiKey') || ''
  } catch {
    return ''
  }
}

const shouldAttachBearer = (u: string) => {
  const url = String(u || '').trim()
  if (!url) return false
  if (url.includes('nexusapi.cn')) return true
  if (url.startsWith('/v1/') || url.startsWith('/v1beta') || url.startsWith('/kling') || url.startsWith('/tencent-vod') || url.startsWith('/video')) return true
  return false
}

/**
 * 获取文件数据
 */
async function fetchFileData(url: string): Promise<Uint8Array> {
  console.log('[download] fetchFileData, url type:', 
    url.startsWith('data:') ? 'data:' : 
    url.startsWith('blob:') ? 'blob:' : 
    url.startsWith('asset:') ? 'asset:' :
    url.startsWith('http') ? 'http' : 'unknown',
    'length:', url.length
  )
  
  if (url.startsWith('data:')) {
    // data URL 转 Uint8Array（直接解析 base64，避免 fetch 对大文件的性能问题）
    const commaIndex = url.indexOf(',')
    if (commaIndex === -1) {
      throw new Error('Invalid data URL format')
    }
    const base64Data = url.substring(commaIndex + 1)
    console.log('[download] 解析 data URL, base64 length:', base64Data.length)
    return base64ToUint8Array(base64Data)
  } else if (url.startsWith('blob:')) {
    // blob URL
    const response = await fetch(url)
    const arrayBuffer = await response.arrayBuffer()
    return new Uint8Array(arrayBuffer)
  } else if (isAssetProtocolUrl(url) && isTauri) {
    // Tauri asset:// 或 http://asset.localhost/ URL - 读取本地文件
    const localPath = extractLocalPath(url)
    if (!localPath) {
      throw new Error('Invalid asset URL')
    }
    console.log('[download] 读取本地文件:', localPath)
    const { readFile } = await import('@tauri-apps/plugin-fs')
    return await readFile(localPath)
  } else {
    // HTTP URL
    if (isTauri) {
      const resolvedUrl = normalizeGatewayUrl(url)
      console.log('[download] Tauri fetch:', resolvedUrl.slice(0, 100))
      const token = getApiKeySafe()
      const headers = shouldAttachBearer(resolvedUrl) && token ? { Authorization: `Bearer ${token}` } : undefined

      // 优先使用 Tauri plugin-http（绕过 CORS），失败时回退到 WebView fetch
      try {
        const { fetch: tauriFetch } = await import('@tauri-apps/plugin-http')
        const response = await tauriFetch(resolvedUrl, { method: 'GET', headers } as any)
        if (!response.ok) throw new Error(`HTTP ${response.status}`)
        const arrayBuffer = await response.arrayBuffer()
        return new Uint8Array(arrayBuffer)
      } catch (tauriErr: any) {
        console.warn('[download] Tauri plugin-http 失败, 回退 WebView fetch:', String(tauriErr?.message || '').slice(0, 120))
        // Windows 常见：代理/证书链问题导致 plugin-http 失败，WebView fetch 通常可以
        const response = await fetch(resolvedUrl, headers ? { headers } : undefined)
        if (!response.ok) throw new Error(`HTTP ${response.status}`)
        const arrayBuffer = await response.arrayBuffer()
        return new Uint8Array(arrayBuffer)
      }
    } else {
      // Web mode: try fetch first, fallback to window.open for CORS issues
      const token = getApiKeySafe()
      const headers = shouldAttachBearer(url) && token ? { Authorization: `Bearer ${token}` } : undefined
      try {
        const response = await fetch(url, headers ? { headers, mode: 'cors' } : { mode: 'cors' })
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`)
        }
        const arrayBuffer = await response.arrayBuffer()
        return new Uint8Array(arrayBuffer)
      } catch (err: any) {
        // CORS error or network error - throw special error to trigger fallback
        const isCorsError = err?.message?.includes('CORS') ||
                           err?.message?.includes('Failed to fetch') ||
                           err?.message?.includes('NetworkError') ||
                           err?.name === 'TypeError'
        if (isCorsError) {
          const corsErr = new Error('CORS_BLOCKED') as any
          corsErr.originalUrl = url
          corsErr.isCorsError = true
          throw corsErr
        }
        throw err
      }
    }
  }
}

/**
 * 对外暴露：读取 URL 为 bytes（用于 PDF 导出等场景）
 */
export async function fetchUrlAsBytes(url: string): Promise<Uint8Array> {
  return await fetchFileData(url)
}

/**
 * 获取文件扩展名
 */
function getExtension(filename: string): string {
  const match = filename.match(/\.([^.]+)$/)
  return match ? match[1].toLowerCase() : 'png'
}

/**
 * 获取文件类型名称（用于保存对话框）
 */
function getFileTypeName(ext: string): string {
  const types: Record<string, string> = {
    mp4: 'MP4 视频',
    webm: 'WebM 视频',
    mov: 'MOV 视频',
    avi: 'AVI 视频',
    png: 'PNG 图片',
    jpg: 'JPEG 图片',
    jpeg: 'JPEG 图片',
    gif: 'GIF 图片',
    webp: 'WebP 图片',
    pdf: 'PDF 文档',
  }
  return types[ext] || ext.toUpperCase()
}

export async function saveBytesAsFile(opts: { data: Uint8Array; filename: string; mimeType?: string }): Promise<boolean> {
  const { data, filename } = opts

  if (isTauri) {
    const { save } = await import('@tauri-apps/plugin-dialog')
    const { writeFile } = await import('@tauri-apps/plugin-fs')

    const ext = getExtension(filename)
    const filePath = await save({
      defaultPath: filename,
      filters: [
        {
          name: getFileTypeName(ext),
          extensions: [ext],
        },
      ],
    })

    if (!filePath) return false
    await writeFile(filePath, data)
    return true
  }

  const blob = new Blob([data.slice().buffer], { type: opts.mimeType || '' })
  const blobUrl = URL.createObjectURL(blob)

  const link = document.createElement('a')
  link.href = blobUrl
  link.download = filename
  link.style.display = 'none'
  document.body.appendChild(link)
  link.click()

  setTimeout(() => {
    document.body.removeChild(link)
    URL.revokeObjectURL(blobUrl)
  }, 1000)

  return true
}

/**
 * 下载文件
 * Tauri: 弹出保存对话框选择路径
 * Web: 使用 anchor 下载到默认位置
 */
export async function downloadFile(options: DownloadOptions): Promise<boolean> {
  const { url, filename } = options

  try {
    const data = await fetchUrlAsBytes(url)
    return await saveBytesAsFile({ data, filename, mimeType: options.mimeType })
  } catch (err: any) {
    // Handle CORS error in web mode - open URL directly for browser download
    if (err?.isCorsError && err?.originalUrl) {
      console.warn('[download] CORS blocked, falling back to direct link:', err.originalUrl)
      // Use anchor element to trigger browser's native download
      const link = document.createElement('a')
      link.href = err.originalUrl
      link.download = filename
      link.target = '_blank'
      link.rel = 'noopener noreferrer'
      document.body.appendChild(link)
      link.click()
      setTimeout(() => document.body.removeChild(link), 100)
      return true
    }
    console.error('[download] 下载失败:', err)
    const errMsg = err?.message || String(err) || '未知错误'
    throw new Error(`下载失败: ${errMsg}`)
  }
}
