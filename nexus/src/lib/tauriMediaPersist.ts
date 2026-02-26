/**
 * Tauri 持久化媒体备份
 *
 * 将媒体数据保存到 app_data_dir（持久化目录），
 * 而非 app_cache_dir（可被 OS 清理）或 IndexedDB（可被 WKWebView 在更新时清除）。
 * 作为媒体恢复链的最后可靠兜底。
 */

const PERSIST_DIR = 'nexus-media-persist'
const MAX_PERSIST_BYTES = 50 * 1024 * 1024

const isTauri = typeof window !== 'undefined' && !!(window as any).__TAURI_INTERNALS__

function dataUrlToBytes(dataUrl: string): Uint8Array | null {
  const idx = dataUrl.indexOf(',')
  if (idx < 0) return null
  try {
    const b64 = dataUrl.substring(idx + 1)
    const bin = atob(b64)
    const arr = new Uint8Array(bin.length)
    for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i)
    return arr
  } catch {
    return null
  }
}

function mimeToExt(dataUrl: string): string {
  const m = dataUrl.match(/^data:([^;,]+)/)
  const mime = m?.[1] || ''
  if (mime.includes('png')) return 'png'
  if (mime.includes('jpeg') || mime.includes('jpg')) return 'jpg'
  if (mime.includes('webp')) return 'webp'
  if (mime.includes('gif')) return 'gif'
  if (mime.includes('mp4')) return 'mp4'
  if (mime.includes('webm')) return 'webm'
  if (mime.includes('quicktime') || mime.includes('mov')) return 'mov'
  if (mime.includes('audio/mpeg') || mime.includes('mp3')) return 'mp3'
  if (mime.includes('wav')) return 'wav'
  return 'bin'
}

let _appDataDir: string | null = null
async function getAppDataDir(): Promise<string> {
  if (_appDataDir) return _appDataDir
  const { appDataDir } = await import('@tauri-apps/api/path')
  _appDataDir = await appDataDir()
  return _appDataDir
}

async function getMediaDir(projectId: string): Promise<string> {
  const base = await getAppDataDir()
  return `${base}${PERSIST_DIR}/${projectId}`
}

const EXTS = ['png', 'jpg', 'webp', 'gif', 'mp4', 'webm', 'mov', 'mp3', 'wav', 'bin']

/**
 * 将媒体数据持久化到 app_data_dir。
 * 仅处理 data: URL，跳过 HTTP / blob 等。
 */
export async function persistMedia(nodeId: string, projectId: string, data: string): Promise<boolean> {
  if (!isTauri || !data?.startsWith('data:') || !nodeId || !projectId) return false

  const bytes = dataUrlToBytes(data)
  if (!bytes || bytes.length > MAX_PERSIST_BYTES) return false

  try {
    const { mkdir, writeFile } = await import('@tauri-apps/plugin-fs')
    const dir = await getMediaDir(projectId)
    await mkdir(dir, { recursive: true })
    const ext = mimeToExt(data)
    await writeFile(`${dir}/${nodeId}.${ext}`, bytes)
    return true
  } catch (err) {
    console.warn('[TauriMediaPersist] 保存失败:', err)
    return false
  }
}

/**
 * 从 app_data_dir 恢复媒体，返回 asset:// URL 供 WKWebView 直接加载。
 */
export async function recoverMedia(nodeId: string, projectId: string): Promise<string | null> {
  if (!isTauri || !nodeId || !projectId) return null

  try {
    const { exists } = await import('@tauri-apps/plugin-fs')
    const { convertFileSrc } = await import('@tauri-apps/api/core')
    const dir = await getMediaDir(projectId)

    for (const ext of EXTS) {
      const path = `${dir}/${nodeId}.${ext}`
      if (await exists(path)) {
        return convertFileSrc(path)
      }
    }
    return null
  } catch {
    return null
  }
}

/**
 * 检查 localPath（Tauri cache 路径）对应的文件是否仍存在，
 * 存在则返回 asset:// URL。
 */
export async function recoverFromLocalPath(localPath: string): Promise<string | null> {
  if (!isTauri || !localPath) return null

  try {
    const { exists } = await import('@tauri-apps/plugin-fs')
    const { convertFileSrc } = await import('@tauri-apps/api/core')
    if (await exists(localPath)) {
      return convertFileSrc(localPath)
    }
    return null
  } catch {
    return null
  }
}

/**
 * 删除节点对应的持久化媒体文件。
 */
export async function removePersistedMedia(nodeId: string, projectId: string): Promise<void> {
  if (!isTauri || !nodeId || !projectId) return

  try {
    const { exists, remove } = await import('@tauri-apps/plugin-fs')
    const dir = await getMediaDir(projectId)

    for (const ext of EXTS) {
      const path = `${dir}/${nodeId}.${ext}`
      if (await exists(path)) {
        await remove(path)
        return
      }
    }
  } catch {
    // ignore
  }
}
