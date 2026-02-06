/**
 * UpdateChecker - 自动更新检查组件
 * 在 Tauri 环境中检查并安装更新
 */
import React, { useEffect, useState, useCallback } from 'react'
import { Download, RefreshCw, X, CheckCircle, AlertCircle } from 'lucide-react'
import { Button } from '@/components/ui/button'

// 检测是否在 Tauri 环境中
const isTauri = typeof window !== 'undefined' && !!(window as any).__TAURI_INTERNALS__

// 启用自动更新功能
const UPDATER_ENABLED = true

interface UpdateInfo {
  version: string
  date?: string
  body?: string
}

type UpdateStatus = 'idle' | 'checking' | 'available' | 'downloading' | 'ready' | 'error' | 'up-to-date'

export default function UpdateChecker() {
  const [status, setStatus] = useState<UpdateStatus>('idle')
  const [updateInfo, setUpdateInfo] = useState<UpdateInfo | null>(null)
  const [progress, setProgress] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [showBanner, setShowBanner] = useState(false)

  const checkForUpdates = useCallback(async () => {
    if (!isTauri) {
      console.log('[UpdateChecker] 非 Tauri 环境，跳过更新检查')
      return
    }
    
    setStatus('checking')
    setError(null)
    
    console.log('[UpdateChecker] 开始检查更新...')
    console.log('[UpdateChecker] 当前版本:', __APP_VERSION__)
    
    // 添加 10 秒超时机制
    let timeoutTriggered = false
    const timeoutId = setTimeout(() => {
      timeoutTriggered = true
      console.warn('[UpdateChecker] 更新检查超时 (10秒)')
      setStatus('idle')  // 超时后静默返回 idle
    }, 10000)
    
    try {
      const { check } = await import('@tauri-apps/plugin-updater')
      console.log('[UpdateChecker] 调用 check()...')
      const update = await check()
      
      // 如果已超时，忽略结果
      if (timeoutTriggered) {
        console.log('[UpdateChecker] 已超时，忽略检查结果')
        return
      }
      clearTimeout(timeoutId)
      
      console.log('[UpdateChecker] 检查结果:', update ? {
        version: update.version,
        currentVersion: update.currentVersion,
        date: update.date,
        body: update.body?.slice(0, 100)
      } : 'null (无更新)')
      
      if (update) {
        setUpdateInfo({
          version: update.version,
          date: update.date,
          body: update.body
        })
        setStatus('available')
        setShowBanner(true)
        console.log('[UpdateChecker] 发现新版本:', update.version)
      } else {
        setStatus('up-to-date')
        console.log('[UpdateChecker] 已是最新版本')
        setTimeout(() => setStatus('idle'), 3000)
      }
    } catch (err: any) {
      clearTimeout(timeoutId)
      if (timeoutTriggered) return
      
      console.error('[UpdateChecker] 检查更新失败:', err)
      console.error('[UpdateChecker] 错误详情:', {
        message: err?.message,
        name: err?.name,
        stack: err?.stack?.slice(0, 500)
      })
      // 静默处理错误，不影响用户体验
      setStatus('idle')  // 改为 idle 而非 error，避免打扰用户
    }
  }, [])

  const downloadAndInstall = useCallback(async () => {
    if (!isTauri) return
    
    setStatus('downloading')
    setProgress(0)
    
    try {
      const { check } = await import('@tauri-apps/plugin-updater')
      const update = await check()
      
      if (!update) {
        setStatus('up-to-date')
        return
      }

      let downloaded = 0
      let contentLength = 0
      
      await update.downloadAndInstall((event) => {
        switch (event.event) {
          case 'Started':
            contentLength = event.data.contentLength || 0
            console.log('[UpdateChecker] 开始下载, 大小:', contentLength)
            break
          case 'Progress':
            downloaded += event.data.chunkLength
            const pct = contentLength > 0 ? Math.round((downloaded / contentLength) * 100) : 0
            setProgress(pct)
            break
          case 'Finished':
            console.log('[UpdateChecker] 下载完成')
            break
        }
      })
      
      setStatus('ready')
      setShowBanner(true)
      // 不自动重启，让用户自行决定何时重启
    } catch (err: any) {
      console.error('[UpdateChecker] 下载更新失败:', err)
      setError(err?.message || '下载更新失败')
      setStatus('error')
    }
  }, [])

  // 启动时自动检查更新
  useEffect(() => {
    if (!isTauri) return
    
    // 延迟 3 秒检查，避免启动时阻塞
    const timer = setTimeout(() => {
      void checkForUpdates()
    }, 3000)
    
    return () => clearTimeout(timer)
  }, [checkForUpdates])

  // 非 Tauri 环境或更新功能未启用时不渲染
  if (!isTauri || !UPDATER_ENABLED) return null

  // 不显示横幅时隐藏
  if (!showBanner && status !== 'checking') return null

  return (
    <div className="fixed bottom-4 right-4 z-50 max-w-sm">
      {/* 检查中 */}
      {status === 'checking' && (
        <div className="flex items-center gap-2 rounded-lg border border-[var(--border-color)] bg-[var(--bg-secondary)] px-4 py-3 shadow-lg">
          <RefreshCw className="h-4 w-4 animate-spin text-[var(--accent-color)]" />
          <span className="text-sm text-[var(--text-primary)]">正在检查更新...</span>
        </div>
      )}

      {/* 有更新可用 */}
      {status === 'available' && updateInfo && (
        <div className="rounded-lg border border-[var(--accent-color)] bg-[var(--bg-secondary)] p-4 shadow-lg">
          <div className="mb-3 flex items-start justify-between">
            <div className="flex items-center gap-2">
              <Download className="h-5 w-5 text-[var(--accent-color)]" />
              <span className="font-medium text-[var(--text-primary)]">发现新版本</span>
            </div>
            <button
              onClick={() => setShowBanner(false)}
              className="rounded p-1 hover:bg-[var(--bg-tertiary)]"
            >
              <X className="h-4 w-4 text-[var(--text-secondary)]" />
            </button>
          </div>
          <div className="mb-3 text-sm text-[var(--text-secondary)]">
            版本 {updateInfo.version} 现已可用
          </div>
          {updateInfo.body && (
            <div className="mb-3 max-h-24 overflow-y-auto rounded bg-[var(--bg-primary)] p-2 text-xs text-[var(--text-secondary)]">
              {updateInfo.body}
            </div>
          )}
          <div className="flex gap-2">
            <Button size="sm" onClick={downloadAndInstall}>
              立即更新
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setShowBanner(false)}>
              稍后
            </Button>
          </div>
        </div>
      )}

      {/* 下载中 */}
      {status === 'downloading' && (
        <div className="rounded-lg border border-[var(--border-color)] bg-[var(--bg-secondary)] p-4 shadow-lg">
          <div className="mb-2 flex items-center gap-2">
            <RefreshCw className="h-4 w-4 animate-spin text-[var(--accent-color)]" />
            <span className="text-sm font-medium text-[var(--text-primary)]">正在下载更新...</span>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-[var(--bg-primary)]">
            <div
              className="h-full bg-[var(--accent-color)] transition-all duration-300"
              style={{ width: `${progress}%` }}
            />
          </div>
          <div className="mt-1 text-right text-xs text-[var(--text-secondary)]">{progress}%</div>
        </div>
      )}

      {/* 已是最新 */}
      {status === 'up-to-date' && (
        <div className="flex items-center gap-2 rounded-lg border border-green-500/30 bg-[var(--bg-secondary)] px-4 py-3 shadow-lg">
          <CheckCircle className="h-4 w-4 text-green-500" />
          <span className="text-sm text-[var(--text-primary)]">已是最新版本</span>
        </div>
      )}

      {/* 更新已就绪，等待用户手动重启 */}
      {status === 'ready' && (
        <div className="rounded-lg border border-green-500/30 bg-[var(--bg-secondary)] p-4 shadow-lg">
          <div className="mb-3 flex items-start justify-between">
            <div className="flex items-center gap-2">
              <CheckCircle className="h-5 w-5 text-green-500" />
              <span className="font-medium text-[var(--text-primary)]">更新已就绪</span>
            </div>
            <button onClick={() => setShowBanner(false)} className="rounded p-1 hover:bg-[var(--bg-tertiary)]">
              <X className="h-4 w-4 text-[var(--text-secondary)]" />
            </button>
          </div>
          <div className="mb-3 text-sm text-[var(--text-secondary)]">
            新版本已下载完成，重启应用后生效。你可以继续当前工作，稍后再重启。
          </div>
          <div className="flex gap-2">
            <Button size="sm" onClick={async () => {
              const { relaunch } = await import('@tauri-apps/plugin-process')
              await relaunch()
            }}>
              立即重启
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setShowBanner(false)}>
              稍后
            </Button>
          </div>
        </div>
      )}

      {/* 错误 */}
      {status === 'error' && (
        <div className="rounded-lg border border-red-500/30 bg-[var(--bg-secondary)] p-4 shadow-lg">
          <div className="mb-2 flex items-center gap-2">
            <AlertCircle className="h-4 w-4 text-red-500" />
            <span className="text-sm font-medium text-[var(--text-primary)]">更新失败</span>
          </div>
          <div className="mb-3 text-xs text-[var(--text-secondary)]">{error}</div>
          <Button size="sm" variant="ghost" onClick={() => setStatus('idle')}>
            关闭
          </Button>
        </div>
      )}
    </div>
  )
}
