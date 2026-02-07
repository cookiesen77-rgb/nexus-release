export const openExternal = async (url: string) => {
  const link = String(url || '').trim()
  if (!link) return

  // Tauri: use plugin-opener (system default browser) | Tauri：用 opener 走系统默认浏览器
  try {
    const { isTauri } = await import('@tauri-apps/api/core')
    if (isTauri()) {
      const { openUrl } = await import('@tauri-apps/plugin-opener')
      await openUrl(link)
      return
    }
  } catch {
    // fall through
  }

  // Web / Electron: window.open (Electron main process already intercepts) | Web/Electron：window.open
  try {
    window.open(link, '_blank', 'noopener,noreferrer')
  } catch {
    // ignore
  }
}
