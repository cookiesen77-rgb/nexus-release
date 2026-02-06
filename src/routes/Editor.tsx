import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { ArrowDown, ArrowUp, Download, FileDown, Film, Loader2, Pause, Play, Plus, SkipBack, SkipForward, Trash2 } from 'lucide-react'
import { getMedia } from '@/lib/mediaStorage'
import { downloadFile } from '@/lib/download'
import { tauriInvoke } from '@/lib/tauri'
import { loadShortDramaDraftV2 } from '@/lib/shortDrama/draftStorage'
import { loadShortDramaEditorProjectV1, saveShortDramaEditorProjectV1 } from '@/lib/editor/editorStorage'
import { useAssetsStore } from '@/store/assets'
import type { ShortDramaEditorClipV1 } from '@/lib/editor/editorTypes'

// 检测 Tauri 环境（导出成片仅在桌面端提供）
const isTauri = typeof window !== 'undefined' && !!(window as any).__TAURI_INTERNALS__

function extractLocalPathFromAssetUrl(assetUrl: string): string | null {
  const u = String(assetUrl || '').trim()
  if (!u.startsWith('asset://') && !u.startsWith('http://asset.localhost/')) return null
  try {
    const parsed = new URL(u)
    const p = decodeURIComponent(parsed.pathname || '')
    // Windows: asset://localhost/C:/Users/... -> /C:/Users/...（去掉前导斜杠）
    if (/^\/[A-Za-z]:\//.test(p)) return p.slice(1)
    return p
  } catch {
    return null
  }
}

export default function Editor() {
  const navigate = useNavigate()
  const { projectId = 'default' } = useParams()
  const [search] = useSearchParams()

  const shotId = String(search.get('shotId') || '').trim()
  const videoVariantId = String(search.get('videoVariantId') || '').trim()

  const draft = useMemo(() => loadShortDramaDraftV2(projectId), [projectId])

  const backToWorkbenchUrl = useMemo(() => {
    const params = new URLSearchParams()
    if (shotId) params.set('shotId', shotId)
    if (videoVariantId) params.set('videoVariantId', videoVariantId)
    const qs = params.toString()
    return `/short-drama/${projectId}${qs ? `?${qs}` : ''}`
  }, [projectId, shotId, videoVariantId])

  const makeId = useCallback(() => globalThis.crypto?.randomUUID?.() || `ed_${Date.now()}_${Math.random().toString(16).slice(2)}`, [])

  const [editor, setEditor] = useState(() => loadShortDramaEditorProjectV1(projectId))
  const editorRef = useRef(editor)
  editorRef.current = editor

  // projectId 变化时重新载入
  useEffect(() => {
    setEditor(loadShortDramaEditorProjectV1(projectId))
  }, [projectId])

  // 自动保存（debounced）
  useEffect(() => {
    const t = window.setTimeout(() => {
      saveShortDramaEditorProjectV1(projectId, editorRef.current as any)
    }, 250)
    return () => window.clearTimeout(t)
  }, [projectId, editor])

  const clips = editor.timeline?.clips || []
  const clipsRef = useRef<ShortDramaEditorClipV1[]>(clips)
  clipsRef.current = clips

  type ExportMode = 'fast' | 'accurate'
  type ExportStatus = 'idle' | 'running' | 'done' | 'error' | 'cancelled'

  const [exportOpen, setExportOpen] = useState(false)
  const [exportMode, setExportMode] = useState<ExportMode>('fast')
  const [exportJobId, setExportJobId] = useState('')
  const exportJobIdRef = useRef('')
  const [exportStatus, setExportStatus] = useState<ExportStatus>('idle')
  const [exportProgress, setExportProgress] = useState(0)
  const [exportMessage, setExportMessage] = useState('')
  const [exportOutputPath, setExportOutputPath] = useState('')

  // 监听后端导出进度事件（仅 Tauri）
  useEffect(() => {
    if (!isTauri) return
    let unlisten: null | (() => void) = null
    ;(async () => {
      try {
        const { listen } = await import('@tauri-apps/api/event')
        unlisten = await listen<any>('nexus:editor-export-progress', (event) => {
          const payload: any = (event as any)?.payload || {}
          const jobId = String(payload?.jobId || '').trim()
          if (!jobId) return
          const current = String(exportJobIdRef.current || '').trim()
          if (current && jobId !== current) return

          exportJobIdRef.current = jobId
          setExportJobId(jobId)
          setExportStatus(String(payload?.status || 'running') as ExportStatus)
          setExportProgress(Number(payload?.progress || 0))
          setExportMessage(String(payload?.message || '').trim())
          setExportOutputPath(String(payload?.outputPath || '').trim())
        })
      } catch (err) {
        console.warn('[Editor] 导出进度监听初始化失败:', err)
      }
    })()

    return () => {
      try {
        unlisten?.()
      } catch {
        // ignore
      }
    }
  }, [])

  // 导出成片完成后：同步到历史素材（桌面端）
  const exportAddedRef = useRef<string>('')
  useEffect(() => {
    if (!isTauri) return
    if (exportStatus !== 'done') return
    const out = String(exportOutputPath || '').trim()
    if (!out) return
    if (exportAddedRef.current === out) return
    exportAddedRef.current = out

    void (async () => {
      try {
        const { convertFileSrc } = await import('@tauri-apps/api/core')
        const src = convertFileSrc(out)
        useAssetsStore.getState().addAsset({
          type: 'video',
          src,
          title: `剪辑成片 · ${projectId}`.slice(0, 80),
          model: 'editor-export',
          localFilePath: out,
        })
      } catch {
        // ignore
      }
    })()
  }, [exportOutputPath, exportStatus, projectId])

  const selectedClipId = String(editor.ui?.selectedClipId || '').trim()
  const selectedIndex = useMemo(() => clips.findIndex((c) => c.id === selectedClipId), [clips, selectedClipId])
  const selectedClip = selectedIndex >= 0 ? clips[selectedIndex] : clips[0] || null

  // 如果 selectedClipId 丢失，自动回落到第一个
  useEffect(() => {
    if (!clips.length) return
    const cur = String(editor.ui?.selectedClipId || '').trim()
    const ok = cur && clips.some((c) => c.id === cur)
    if (ok) return
    setEditor((p) => ({ ...p, ui: { ...(p.ui || {}), selectedClipId: clips[0].id } }))
  }, [clips, editor.ui?.selectedClipId])

  const setSelectedClipId = useCallback((id: string) => {
    const next = String(id || '').trim()
    if (!next) return
    setEditor((p) => ({ ...p, ui: { ...(p.ui || {}), selectedClipId: next } }))
  }, [])

  const availableVideos = useMemo(() => {
    const out: Array<{
      shotId: string
      shotTitle: string
      variantId: string
      sourceUrl?: string
      displayUrl?: string
      mediaId?: string
      createdAt?: number
    }> = []
    for (const s of draft.shots || []) {
      const vs = (s.video?.variants || []).filter((v) => v.kind === 'video' && v.status === 'success')
      for (const v of vs) {
        out.push({
          shotId: s.id,
          shotTitle: s.title || '未命名镜头',
          variantId: v.id,
          sourceUrl: v.sourceUrl,
          displayUrl: v.displayUrl,
          mediaId: v.mediaId,
          createdAt: v.createdAt,
        })
      }
    }
    // 新的在前
    out.sort((a, b) => Number(b.createdAt || 0) - Number(a.createdAt || 0))
    return out
  }, [draft.shots])

  const addClipFromVariant = useCallback(
    (item: (typeof availableVideos)[number]) => {
      const clip: ShortDramaEditorClipV1 = {
        id: makeId(),
        shotId: item.shotId,
        videoVariantId: item.variantId,
        label: item.shotTitle,
        sourceUrl: item.sourceUrl,
        displayUrl: item.displayUrl,
        mediaId: item.mediaId,
        inSec: 0,
        outSec: null,
        createdAt: Date.now(),
      }
      setEditor((p) => ({
        ...p,
        timeline: { clips: [...(p.timeline?.clips || []), clip] },
        ui: { ...(p.ui || {}), selectedClipId: clip.id },
      }))
    },
    [makeId, setEditor, availableVideos]
  )

  // 从短剧制作进入剪辑台时：自动把指定版本加到时间线（如果不存在）
  const autoAddDoneRef = useRef(false)
  useEffect(() => {
    if (autoAddDoneRef.current) return
    if (!shotId || !videoVariantId) return
    if (!availableVideos.length) return
    const existing = clips.find((c) => c.shotId === shotId && c.videoVariantId === videoVariantId)
    if (existing) {
      setSelectedClipId(existing.id)
      autoAddDoneRef.current = true
      return
    }
    const found = availableVideos.find((v) => v.shotId === shotId && v.variantId === videoVariantId)
    if (!found) return
    addClipFromVariant(found)
    autoAddDoneRef.current = true
  }, [addClipFromVariant, availableVideos, clips, setSelectedClipId, shotId, videoVariantId])

  const removeClipAt = useCallback(
    (idx: number) => {
      setEditor((p) => {
        const arr = [...(p.timeline?.clips || [])]
        if (idx < 0 || idx >= arr.length) return p
        const removed = arr.splice(idx, 1)[0]
        const nextSelected = (p.ui?.selectedClipId === removed.id ? (arr[idx]?.id || arr[idx - 1]?.id || '') : p.ui?.selectedClipId) || ''
        return { ...p, timeline: { clips: arr }, ui: { ...(p.ui || {}), selectedClipId: nextSelected } }
      })
    },
    [setEditor]
  )

  const moveClip = useCallback(
    (idx: number, delta: number) => {
      setEditor((p) => {
        const arr = [...(p.timeline?.clips || [])]
        const to = idx + delta
        if (idx < 0 || idx >= arr.length) return p
        if (to < 0 || to >= arr.length) return p
        const [it] = arr.splice(idx, 1)
        arr.splice(to, 0, it)
        return { ...p, timeline: { clips: arr } }
      })
    },
    [setEditor]
  )

  const updateClip = useCallback(
    (clipId: string, patch: Partial<ShortDramaEditorClipV1>) => {
      setEditor((p) => {
        const arr = [...(p.timeline?.clips || [])]
        const idx = arr.findIndex((c) => c.id === clipId)
        if (idx < 0) return p
        arr[idx] = { ...arr[idx], ...patch }
        return { ...p, timeline: { clips: arr } }
      })
    },
    [setEditor]
  )

  // 解析 clip 可播放 URL（优先 displayUrl/sourceUrl，其次 mediaId）
  const [clipUrlMap, setClipUrlMap] = useState<Record<string, string>>({})
  const clipUrlRef = useRef(clipUrlMap)
  clipUrlRef.current = clipUrlMap

  const ensureClipUrl = useCallback(async (clip: ShortDramaEditorClipV1) => {
    const id = String(clip?.id || '').trim()
    if (!id) return ''
    const cached = String(clipUrlRef.current[id] || '').trim()
    if (cached) return cached

    const displayUrl = String(clip.displayUrl || '').trim()
    if (displayUrl) {
      setClipUrlMap((m) => ({ ...m, [id]: displayUrl }))
      return displayUrl
    }
    const sourceUrl = String(clip.sourceUrl || '').trim()
    if (sourceUrl) {
      setClipUrlMap((m) => ({ ...m, [id]: sourceUrl }))
      return sourceUrl
    }
    const mediaId = String(clip.mediaId || '').trim()
    if (mediaId) {
      try {
        const rec = await getMedia(mediaId)
        const dataUrl = String(rec?.data || '').trim()
        if (dataUrl) {
          setClipUrlMap((m) => ({ ...m, [id]: dataUrl }))
          return dataUrl
        }
      } catch {
        // ignore
      }
    }
    return ''
  }, [])

  // 播放控制（不做真实导出，仅做“时间线播放预览”）
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const [activeSrc, setActiveSrc] = useState('')
  const [playback, setPlayback] = useState<{ mode: 'idle' | 'clip' | 'timeline'; index: number }>({ mode: 'idle', index: 0 })
  const playbackRef = useRef(playback)
  playbackRef.current = playback
  const [isPlaying, setIsPlaying] = useState(false)
  const playTokenRef = useRef(0)
  const [videoError, setVideoError] = useState('')

  const stopPlayback = useCallback(() => {
    playTokenRef.current += 1
    setPlayback({ mode: 'idle', index: 0 })
    setIsPlaying(false)
    setVideoError('')
    try {
      videoRef.current?.pause()
    } catch {
      // ignore
    }
  }, [])

  // 进入/选择片段时：自动加载到预览区（不自动播放，便于做剪辑任务）
  useEffect(() => {
    if (!selectedClip) {
      setActiveSrc('')
      return
    }
    if (playbackRef.current.mode !== 'idle') return
    let cancelled = false
    void (async () => {
      const url = await ensureClipUrl(selectedClip)
      if (cancelled) return
      if (playbackRef.current.mode !== 'idle') return
      if (url) setActiveSrc(url)
    })()
    return () => {
      cancelled = true
    }
  }, [ensureClipUrl, selectedClip?.id])

  const handleBackToWorkbench = useCallback(() => {
    try {
      stopPlayback()
    } catch {
      // ignore
    }
    try {
      saveShortDramaEditorProjectV1(projectId, editorRef.current as any)
    } catch {
      // ignore
    }
    navigate(backToWorkbenchUrl)
  }, [backToWorkbenchUrl, navigate, projectId, stopPlayback])

  const startPlayback = useCallback(
    async (mode: 'clip' | 'timeline', index: number) => {
      const token = ++playTokenRef.current
      const list = clipsRef.current
      const clip = list[index]
      if (!clip) return

      const url = await ensureClipUrl(clip)
      if (token !== playTokenRef.current) return
      if (!url) {
        setVideoError('无法加载该片段的视频地址')
        return
      }

      setVideoError('')
      setPlayback({ mode, index })
      setActiveSrc(url)

      // 在 metadata 就绪后再 seek+play
      requestAnimationFrame(() => {
        const v = videoRef.current
        if (!v) return
        try {
          v.pause()
        } catch {
          // ignore
        }
        setIsPlaying(false)
        // 让 onLoadedMetadata 接管 seek/play（避免不同浏览器 race）
      })
    },
    [ensureClipUrl]
  )

  const currentClip = useMemo(() => {
    const pb = playbackRef.current
    const list = clipsRef.current
    return pb.mode === 'idle' ? null : list[pb.index] || null
  }, [clips, playback.mode, playback.index])

  const applySeekAndPlay = useCallback(async () => {
    const v = videoRef.current
    const pb = playbackRef.current
    if (!v) return
    if (pb.mode === 'idle') return
    const clip = clipsRef.current[pb.index]
    if (!clip) return

    const start = Math.max(0, Number(clip.inSec || 0))
    let end = clip.outSec == null ? null : Math.max(0, Number(clip.outSec))

    try {
      if (Number.isFinite(start)) v.currentTime = start
    } catch {
      // ignore
    }

    // clamp end to duration if known
    const dur = Number(v.duration || 0)
    if (end != null && dur > 0 && Number.isFinite(dur)) end = Math.min(end, dur)

    try {
      await v.play()
      setIsPlaying(true)
    } catch {
      setIsPlaying(false)
    }

    // 若 end 存在且小于 start，则直接停
    if (end != null && end <= start + 0.01) {
      v.pause()
      setIsPlaying(false)
    }
  }, [])

  const handleLoadedMetadata = useCallback(() => {
    void applySeekAndPlay()
  }, [applySeekAndPlay])

  const handleTimeUpdate = useCallback(() => {
    const v = videoRef.current
    const pb = playbackRef.current
    if (!v) return
    if (pb.mode === 'idle') return
    const clip = clipsRef.current[pb.index]
    if (!clip) return

    const cur = Number(v.currentTime || 0)
    const dur = Number(v.duration || 0)
    const end = clip.outSec == null ? (Number.isFinite(dur) && dur > 0 ? dur : null) : Number(clip.outSec)

    if (end != null && Number.isFinite(end) && cur >= end - 0.03) {
      if (pb.mode === 'timeline') {
        const next = pb.index + 1
        if (next < clipsRef.current.length) {
          void startPlayback('timeline', next)
          return
        }
      }
      stopPlayback()
    }
  }, [startPlayback, stopPlayback])

  const handleEnded = useCallback(() => {
    const pb = playbackRef.current
    if (pb.mode === 'idle') return
    if (pb.mode === 'timeline') {
      const next = pb.index + 1
      if (next < clipsRef.current.length) {
        void startPlayback('timeline', next)
        return
      }
    }
    stopPlayback()
  }, [startPlayback, stopPlayback])

  const playSelected = useCallback(() => {
    const idx = selectedIndex >= 0 ? selectedIndex : 0
    void startPlayback('clip', idx)
  }, [selectedIndex, startPlayback])

  const playTimeline = useCallback(() => {
    const idx = selectedIndex >= 0 ? selectedIndex : 0
    void startPlayback('timeline', idx)
  }, [selectedIndex, startPlayback])

  const togglePause = useCallback(() => {
    const v = videoRef.current
    if (!v) return
    if (v.paused) {
      void v.play().then(() => setIsPlaying(true)).catch(() => setIsPlaying(false))
    } else {
      v.pause()
      setIsPlaying(false)
    }
  }, [])

  const setInToCurrentTime = useCallback(() => {
    const v = videoRef.current
    if (!v || !selectedClip) return
    const t = Math.max(0, Number(v.currentTime || 0))
    const out = selectedClip.outSec == null ? null : Number(selectedClip.outSec)
    updateClip(selectedClip.id, { inSec: t, outSec: out != null && out < t ? t : out })
  }, [selectedClip, updateClip])

  const setOutToCurrentTime = useCallback(() => {
    const v = videoRef.current
    if (!v || !selectedClip) return
    const t = Math.max(0, Number(v.currentTime || 0))
    const inn = Math.max(0, Number(selectedClip.inSec || 0))
    updateClip(selectedClip.id, { outSec: Math.max(t, inn) })
  }, [selectedClip, updateClip])

  const duplicateSelectedClip = useCallback(() => {
    if (!selectedClip) {
      window.$message?.warning?.('请先选择一个片段')
      return
    }
    const idx = selectedIndex >= 0 ? selectedIndex : 0
    setEditor((p) => {
      const arr = [...(p.timeline?.clips || [])]
      if (!arr[idx]) return p
      const copied: ShortDramaEditorClipV1 = { ...arr[idx], id: makeId(), createdAt: Date.now() }
      arr.splice(idx + 1, 0, copied)
      return { ...p, timeline: { clips: arr }, ui: { ...(p.ui || {}), selectedClipId: copied.id } }
    })
  }, [makeId, selectedClip, selectedIndex])

  const splitSelectedClipAtPlayhead = useCallback(() => {
    const v = videoRef.current
    if (!v || !selectedClip) {
      window.$message?.warning?.('请先选择片段并播放/定位到时间点')
      return
    }
    const t = Math.max(0, Number(v.currentTime || 0))
    const inn = Math.max(0, Number(selectedClip.inSec || 0))
    const out = selectedClip.outSec == null ? null : Math.max(0, Number(selectedClip.outSec))
    if (t <= inn + 0.05) {
      window.$message?.warning?.('播放头过于靠近入点，无法切分')
      return
    }
    if (out != null && t >= out - 0.05) {
      window.$message?.warning?.('播放头过于靠近出点，无法切分')
      return
    }
    const idx = selectedIndex >= 0 ? selectedIndex : 0
    setEditor((p) => {
      const arr = [...(p.timeline?.clips || [])]
      const cur = arr[idx]
      if (!cur) return p
      const first: ShortDramaEditorClipV1 = { ...cur, outSec: t }
      const second: ShortDramaEditorClipV1 = { ...cur, id: makeId(), inSec: t, outSec: out, createdAt: Date.now() }
      arr[idx] = first
      arr.splice(idx + 1, 0, second)
      return { ...p, timeline: { clips: arr }, ui: { ...(p.ui || {}), selectedClipId: second.id } }
    })
  }, [makeId, selectedClip, selectedIndex])

  // 下载当前选中片段（原视频）
  const downloadSelectedClip = useCallback(async () => {
    if (!selectedClip) {
      window.$message?.warning?.('请先在时间线选择一个片段')
      return
    }
    try {
      const url = await ensureClipUrl(selectedClip)
      if (!url) {
        window.$message?.warning?.('暂无可下载的视频地址')
        return
      }
      const safeLabel = String(selectedClip.label || 'clip')
        .replace(/[\\/:*?"<>|]+/g, '_')
        .slice(0, 48)
      const filename = `clip_${projectId}_${safeLabel}_${Date.now()}.mp4`
      const ok = await downloadFile({ url, filename, mimeType: 'video/mp4' })
      if (ok) window.$message?.success?.('下载成功')
    } catch (err: any) {
      window.$message?.error?.(err?.message || '下载失败')
    }
  }, [ensureClipUrl, projectId, selectedClip])

  // 导出剪辑工程（JSON）
  const exportProjectJson = useCallback(async () => {
    try {
      const json = JSON.stringify(editorRef.current, null, 2)
      // btoa 仅支持 Latin1，这里做一次 UTF-8 兼容编码
      const base64 = btoa(unescape(encodeURIComponent(json)))
      const dataUrl = `data:application/json;base64,${base64}`
      const filename = `editor_${projectId}_${Date.now()}.json`
      const ok = await downloadFile({ url: dataUrl, filename, mimeType: 'application/json' })
      if (ok) window.$message?.success?.('已导出工程文件')
    } catch (err: any) {
      window.$message?.error?.(err?.message || '导出失败')
    }
  }, [projectId])

  const startExportFinalVideo = useCallback(async () => {
    if (!isTauri) {
      window.$message?.warning?.('导出成片仅在桌面端（Tauri）提供')
      return
    }
    if (exportStatus === 'running') return
    if (!clipsRef.current.length) {
      window.$message?.warning?.('时间线为空，无法导出')
      return
    }
    try {
      const { save } = await import('@tauri-apps/plugin-dialog')
      const defaultName = `nexus_${projectId}_${Date.now()}.mp4`
      const outputPath = await save({
        defaultPath: defaultName,
        filters: [{ name: 'MP4 视频', extensions: ['mp4'] }],
      })
      if (!outputPath) return

      const token = (() => {
        try {
          return localStorage.getItem('apiKey') || ''
        } catch {
          return ''
        }
      })()

      const exportClips = (clipsRef.current || []).map((c) => {
        const shot = (draft.shots || []).find((s: any) => String(s?.id || '') === String(c.shotId || ''))
        const variant = (shot?.video?.variants || []).find((v: any) => String(v?.id || '') === String(c.videoVariantId || '')) || null
        const localPath = String(variant?.localPath || '').trim()
        const displayUrl = String(variant?.displayUrl || c.displayUrl || '').trim()
        const sourceUrl = String(variant?.sourceUrl || c.sourceUrl || '').trim()

        let input = localPath
        if (!input) {
          const p = extractLocalPathFromAssetUrl(displayUrl)
          if (p) input = p
        }
        if (!input) input = sourceUrl || displayUrl

        return {
          input,
          inSec: Number(c.inSec || 0),
          outSec: c.outSec == null ? null : Number(c.outSec),
          shotId: String(c.shotId || ''),
          videoVariantId: String(c.videoVariantId || ''),
        }
      })

      exportJobIdRef.current = ''
      setExportStatus('running')
      setExportProgress(0)
      setExportMessage('已启动导出…')
      setExportOutputPath(String(outputPath))
      setExportOpen(true)

      const jobId = await tauriInvoke<string>('editor_export_start', {
        projectId,
        outputPath,
        mode: exportMode,
        clips: exportClips,
        authToken: token || null,
      })
      const jid = String(jobId || '').trim()
      if (!jid) throw new Error('启动导出失败（未返回 jobId）')
      exportJobIdRef.current = jid
      setExportJobId(jid)
    } catch (err: any) {
      setExportStatus('error')
      setExportMessage(err?.message || '导出失败')
      window.$message?.error?.(err?.message || '导出失败')
    }
  }, [draft.shots, exportMode, exportStatus, projectId])

  const cancelExport = useCallback(async () => {
    const jid = String(exportJobIdRef.current || exportJobId || '').trim()
    if (!jid) {
      setExportOpen(false)
      return
    }
    try {
      await tauriInvoke('editor_export_cancel', { jobId: jid })
      setExportStatus('cancelled')
      setExportMessage('已请求取消…')
    } catch (err) {
      console.warn('[Editor] 取消导出失败:', err)
    }
  }, [exportJobId])

  const title = selectedClip?.label || '剪辑台'

  return (
    <div className="min-h-screen bg-[var(--bg-primary)]">
      <div className="mx-auto w-[min(1400px,98vw)] py-6">
        <div className="flex items-center justify-between gap-4">
          <div>
            <div className="text-sm text-[var(--text-secondary)]">剪辑台（MVP：时间线预览 + 裁切 + 排序）</div>
            <div className="mt-1 text-lg font-semibold text-[var(--text-primary)]">{title}</div>
            <div className="mt-1 text-xs text-[var(--text-secondary)]">
              projectId: {projectId} · shotId: {shotId || '—'} · videoVariantId: {videoVariantId || '—'}
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="secondary" onClick={handleBackToWorkbench}>
              返回
            </Button>
            <Button onClick={() => navigate(`/canvas/${projectId}`)}>回到画布</Button>
          </div>
        </div>

        <div className="mt-5 grid grid-cols-1 gap-4 lg:grid-cols-[360px_1fr]">
          {/* 素材库 */}
          <div className="min-h-0 overflow-hidden rounded-2xl border border-[var(--border-color)] bg-[var(--bg-secondary)]">
            <div className="border-b border-[var(--border-color)] px-4 py-3">
              <div className="text-sm font-medium text-[var(--text-primary)]">素材库（短剧制作视频版本）</div>
              <div className="mt-1 text-xs text-[var(--text-secondary)]">只列出已成功的视频版本。点击“+”添加到时间线。</div>
            </div>
            <div className="max-h-[70vh] overflow-auto px-3 py-3">
              {availableVideos.length === 0 ? (
                <div className="text-sm text-[var(--text-secondary)]">暂无已完成的视频版本。请先在“短剧制作”生成视频。</div>
              ) : (
                <div className="space-y-2">
                  {availableVideos.map((v) => (
                    <div
                      key={`${v.shotId}:${v.variantId}`}
                      className="flex items-center justify-between gap-2 rounded-xl border border-[var(--border-color)] bg-[var(--bg-primary)] px-3 py-2"
                    >
                      <div className="min-w-0">
                        <div className="truncate text-sm text-[var(--text-primary)]">{v.shotTitle}</div>
                        <div className="mt-0.5 truncate text-xs text-[var(--text-secondary)]">variantId: {v.variantId}</div>
                      </div>
                      <Button size="sm" variant="secondary" className="h-8 w-8 px-0" onClick={() => addClipFromVariant(v)} title="添加到时间线">
                        <Plus className="h-4 w-4" />
                      </Button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* 预览 + 时间线 */}
          <div className="min-h-0 overflow-hidden rounded-2xl border border-[var(--border-color)] bg-[var(--bg-secondary)]">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--border-color)] px-4 py-3">
              <div className="text-sm font-medium text-[var(--text-primary)]">预览</div>
              <div className="flex items-center gap-2">
                <Button variant="secondary" onClick={exportProjectJson}>
                  <FileDown className="mr-2 h-4 w-4" />
                  导出工程
                </Button>
                <Button variant="secondary" onClick={() => setExportOpen(true)} disabled={!clips.length}>
                  <Film className="mr-2 h-4 w-4" />
                  导出成片
                </Button>
                <Button variant="secondary" onClick={downloadSelectedClip} disabled={!selectedClip}>
                  <Download className="mr-2 h-4 w-4" />
                  下载片段
                </Button>
                <Button variant="secondary" onClick={playSelected} disabled={!clips.length}>
                  <Play className="mr-2 h-4 w-4" />
                  播放片段
                </Button>
                <Button variant="secondary" onClick={playTimeline} disabled={!clips.length}>
                  <SkipForward className="mr-2 h-4 w-4" />
                  播放时间线
                </Button>
                <Button variant="secondary" onClick={togglePause} disabled={playback.mode === 'idle' || !activeSrc}>
                  {isPlaying ? <Pause className="mr-2 h-4 w-4" /> : <Play className="mr-2 h-4 w-4" />}
                  {isPlaying ? '暂停' : '继续'}
                </Button>
                <Button variant="secondary" onClick={stopPlayback} disabled={playback.mode === 'idle'}>
                  <SkipBack className="mr-2 h-4 w-4" />
                  停止
                </Button>
              </div>
            </div>

            <div className="grid grid-cols-1 gap-4 p-4 lg:grid-cols-[1fr_360px]">
              <div className="min-h-0">
                {activeSrc ? (
                  <div className="rounded-xl border border-[var(--border-color)] bg-black/10 p-2">
                    <video
                      ref={videoRef}
                      key={activeSrc}
                      src={activeSrc}
                      controls
                      playsInline
                      preload="metadata"
                      className="w-full rounded-lg bg-black/20"
                      onLoadedMetadata={handleLoadedMetadata}
                      onTimeUpdate={handleTimeUpdate}
                      onEnded={handleEnded}
                      onError={() => setVideoError('视频加载失败')}
                    />
                    {videoError ? <div className="mt-2 text-sm text-red-500">{videoError}</div> : null}
                  </div>
                ) : (
                  <div className="rounded-xl border border-dashed border-[var(--border-color)] bg-[var(--bg-primary)] p-6 text-sm text-[var(--text-secondary)]">
                    从左侧素材库添加视频到时间线后，可播放预览。
                  </div>
                )}

                {/* 裁切操作 */}
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <Button variant="secondary" onClick={setInToCurrentTime} disabled={!selectedClip || !activeSrc}>
                    设为入点
                  </Button>
                  <Button variant="secondary" onClick={setOutToCurrentTime} disabled={!selectedClip || !activeSrc}>
                    设为出点
                  </Button>
                  <Button variant="secondary" onClick={splitSelectedClipAtPlayhead} disabled={!selectedClip || !activeSrc}>
                    切分
                  </Button>
                  <Button variant="secondary" onClick={duplicateSelectedClip} disabled={!selectedClip}>
                    复制片段
                  </Button>
                  <div className="text-xs text-[var(--text-secondary)]">
                    提示：当前支持裁切预览、排序、切分/复制、下载片段、导出工程（JSON），以及桌面端导出成片（MP4）。
                  </div>
                </div>
              </div>

              {/* 时间线 */}
              <div className="min-h-0">
                <div className="mb-2 text-sm font-medium text-[var(--text-primary)]">时间线</div>
                <div className="max-h-[58vh] overflow-auto space-y-2">
                  {clips.length === 0 ? (
                    <div className="text-sm text-[var(--text-secondary)]">时间线为空。</div>
                  ) : (
                    clips.map((c, idx) => {
                      const selected = selectedClip?.id === c.id
                      const playing = playback.mode !== 'idle' && playback.index === idx
                      return (
                        <div
                          key={c.id}
                          className={[
                            'rounded-xl border px-3 py-2',
                            selected ? 'border-[var(--accent-color)] bg-[var(--bg-primary)]' : 'border-[var(--border-color)] bg-[var(--bg-primary)]',
                          ].join(' ')}
                          onClick={() => setSelectedClipId(c.id)}
                          role="button"
                          tabIndex={0}
                        >
                          <div className="flex items-start justify-between gap-2">
                            <div className="min-w-0">
                              <div className="truncate text-sm text-[var(--text-primary)]">
                                {idx + 1}. {c.label} {playing ? <span className="text-xs text-[var(--accent-color)]">（播放中）</span> : null}
                              </div>
                              <div className="mt-0.5 truncate text-xs text-[var(--text-secondary)]">
                                shotId: {c.shotId} · variantId: {c.videoVariantId}
                              </div>
                            </div>
                            <div className="flex shrink-0 items-center gap-1">
                              <Button
                                size="sm"
                                variant="secondary"
                                className="h-8 w-8 px-0"
                                onClick={(e) => (e.stopPropagation(), moveClip(idx, -1))}
                                disabled={idx === 0}
                              >
                                <ArrowUp className="h-4 w-4" />
                              </Button>
                              <Button
                                size="sm"
                                variant="secondary"
                                className="h-8 w-8 px-0"
                                onClick={(e) => (e.stopPropagation(), moveClip(idx, 1))}
                                disabled={idx === clips.length - 1}
                              >
                                <ArrowDown className="h-4 w-4" />
                              </Button>
                              <Button size="sm" variant="secondary" className="h-8 w-8 px-0" onClick={(e) => (e.stopPropagation(), removeClipAt(idx))}>
                                <Trash2 className="h-4 w-4" />
                              </Button>
                            </div>
                          </div>

                          {/* 裁切输入 */}
                          {selected ? (
                            <div className="mt-2 grid grid-cols-2 gap-2">
                              <div>
                                <div className="mb-1 text-xs text-[var(--text-secondary)]">入点（秒）</div>
                                <Input
                                  value={String(c.inSec ?? 0)}
                                  onChange={(e) => {
                                    const n = Number(e.target.value)
                                    updateClip(c.id, { inSec: Number.isFinite(n) && n >= 0 ? n : 0 })
                                  }}
                                />
                              </div>
                              <div>
                                <div className="mb-1 text-xs text-[var(--text-secondary)]">出点（秒，可空）</div>
                                <Input
                                  value={c.outSec == null ? '' : String(c.outSec)}
                                  placeholder="到结尾"
                                  onChange={(e) => {
                                    const raw = String(e.target.value || '').trim()
                                    if (!raw) {
                                      updateClip(c.id, { outSec: null })
                                      return
                                    }
                                    const n = Number(raw)
                                    updateClip(c.id, { outSec: Number.isFinite(n) && n >= 0 ? n : null })
                                  }}
                                />
                              </div>
                            </div>
                          ) : null}
                        </div>
                      )
                    })
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {exportOpen ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm"
          onClick={(e) => e.target === e.currentTarget && exportStatus !== 'running' && setExportOpen(false)}
        >
          <div
            className="flex w-[min(760px,96vw)] flex-col overflow-hidden rounded-2xl border border-[var(--border-color)] bg-[var(--bg-secondary)] shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-[var(--border-color)] px-5 py-4">
              <div>
                <div className="text-sm font-semibold text-[var(--text-primary)]">导出成片（MP4）</div>
                <div className="mt-1 text-xs text-[var(--text-secondary)]">将时间线片段合并导出为一个视频文件（桌面端）。</div>
              </div>
              <Button variant="secondary" onClick={() => setExportOpen(false)} disabled={exportStatus === 'running'}>
                关闭
              </Button>
            </div>

            <div className="space-y-4 p-5">
              <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                <div className="flex flex-col gap-2">
                  <div className="text-xs text-[var(--text-secondary)]">导出模式</div>
                  <select
                    value={exportMode}
                    onChange={(e) => setExportMode(e.target.value as any)}
                    disabled={exportStatus === 'running'}
                    className="w-full rounded-lg border border-[var(--border-color)] bg-[var(--bg-primary)] px-3 py-2 text-sm text-[var(--text-primary)] focus:border-[var(--accent-color)] focus:outline-none"
                  >
                    <option value="fast">极速（尽量无损，可能受关键帧影响）</option>
                    <option value="accurate">精确（重编码，时间点更准确）</option>
                  </select>
                </div>
                <div className="flex flex-col gap-2">
                  <div className="text-xs text-[var(--text-secondary)]">片段数</div>
                  <div className="rounded-lg border border-[var(--border-color)] bg-[var(--bg-primary)] px-3 py-2 text-sm text-[var(--text-primary)]">
                    {clips.length}
                  </div>
                </div>
              </div>

              {exportStatus !== 'idle' ? (
                <div className="rounded-xl border border-[var(--border-color)] bg-[var(--bg-primary)] p-4">
                  <div className="flex items-center justify-between">
                    <div className="text-sm font-medium text-[var(--text-primary)]">导出进度</div>
                    <div className="text-xs text-[var(--text-secondary)]">{Math.round(exportProgress)}%</div>
                  </div>
                  <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-black/10">
                    <div
                      className="h-full bg-[var(--accent-color)]"
                      style={{ width: `${Math.min(100, Math.max(0, exportProgress))}%` }}
                    />
                  </div>
                  {exportMessage ? <div className="mt-2 text-xs text-[var(--text-secondary)]">{exportMessage}</div> : null}
                  {exportOutputPath ? (
                    <div className="mt-1 break-all text-[11px] text-[var(--text-tertiary)]">输出：{exportOutputPath}</div>
                  ) : null}
                </div>
              ) : null}

              {!isTauri ? (
                <div className="rounded-xl border border-[var(--border-color)] bg-[var(--bg-primary)] p-4 text-sm text-[var(--text-secondary)]">
                  当前环境不是桌面端，无法导出成片。
                </div>
              ) : null}
            </div>

            <div className="flex items-center justify-between border-t border-[var(--border-color)] px-5 py-3">
              <Button variant="secondary" onClick={() => setExportOpen(false)} disabled={exportStatus === 'running'}>
                取消
              </Button>
              {exportStatus === 'running' ? (
                <Button variant="secondary" className="text-red-500" onClick={() => void cancelExport()}>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  取消导出
                </Button>
              ) : (
                <Button onClick={() => void startExportFinalVideo()} disabled={!clips.length}>
                  <Film className="mr-2 h-4 w-4" />
                  选择保存位置并开始
                </Button>
              )}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )
}

