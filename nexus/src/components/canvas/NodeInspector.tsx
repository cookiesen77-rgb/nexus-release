import React, { useEffect, useMemo, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Select } from '@/components/ui/select'
import { useGraphStore } from '@/graph/store'
import type { GraphNode, NodeType } from '@/graph/types'
import { DEFAULT_IMAGE_MODEL, DEFAULT_VIDEO_MODEL, IMAGE_MODELS, VIDEO_MODELS } from '@/config/models'
import { generateImageFromConfigNode } from '@/lib/workflow/image'
import { generateVideoFromConfigNode } from '@/lib/workflow/video'
import { resolveCachedImageUrl, resolveCachedMediaUrl } from '@/lib/workflow/cache'

const getString = (v: unknown, fallback = '') => (typeof v === 'string' ? v : v == null ? fallback : String(v))

const spawnRight = (node: GraphNode, dx: number, dy = 0) => ({ x: node.x + dx, y: node.y + dy })

const toDataUrl = async (file: File) => {
  const base64 = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(new Error('read failed'))
    reader.onload = () => resolve(String(reader.result || ''))
    reader.readAsDataURL(file)
  })
  return base64
}

const ImagePreview = ({ url }: { url: string }) => {
  const [displayUrl, setDisplayUrl] = useState(url)

  useEffect(() => {
    let cancelled = false
    const u = String(url || '').trim()
    if (!u) {
      setDisplayUrl('')
      return
    }
    setDisplayUrl(u)
    void (async () => {
      const cached = await resolveCachedImageUrl(u)
      if (cancelled) return
      if (cached.displayUrl && cached.displayUrl !== u) setDisplayUrl(cached.displayUrl)
    })()
    return () => {
      cancelled = true
    }
  }, [url])

  if (!displayUrl) return null
  return <img src={displayUrl} className="w-full rounded-xl border border-[var(--border-color)] bg-black/20" alt="image" />
}

const VideoPreview = ({ url }: { url: string }) => {
  const [displayUrl, setDisplayUrl] = useState(url)

  useEffect(() => {
    let cancelled = false
    const u = String(url || '').trim()
    if (!u) {
      setDisplayUrl('')
      return
    }
    setDisplayUrl(u)
    void (async () => {
      const cached = await resolveCachedMediaUrl(u)
      if (cancelled) return
      if (cached.displayUrl && cached.displayUrl !== u) setDisplayUrl(cached.displayUrl)
    })()
    return () => {
      cancelled = true
    }
  }, [url])

  if (!displayUrl) return null
  return <video src={displayUrl} className="w-full rounded-xl border border-[var(--border-color)] bg-black/20" controls preload="metadata" />
}

export default function NodeInspector() {
  const selectedId = useGraphStore((s) => s.selectedNodeId)
  const selectedIds = useGraphStore((s) => s.selectedNodeIds)
  const node = useGraphStore((s) => s.nodes.find((n) => n.id === selectedId) || null)
  const updateNode = useGraphStore((s) => s.updateNode)
  const removeNode = useGraphStore((s) => s.removeNode)
  const addNode = useGraphStore((s) => s.addNode)
  const addEdge = useGraphStore((s) => s.addEdge)
  const setSelected = useGraphStore((s) => s.setSelected)
  const withBatch = useGraphStore((s) => s.withBatchUpdates)

  const [busy, setBusy] = useState(false)

  const title = useMemo(() => {
    if (!node) return ''
    const label = getString((node.data as any)?.label) || getString((node.data as any)?.title)
    return label ? `${node.type} · ${label}` : node.type
  }, [node])

  if (!node) return null
  if (selectedIds.length > 1) {
    return (
      <div className="w-[320px] border-l border-[var(--border-color)] bg-[var(--bg-secondary)]">
        <div className="flex items-center justify-between border-b border-[var(--border-color)] px-4 py-3">
          <div className="text-sm font-semibold text-[var(--text-primary)]">检查器</div>
          <Button variant="ghost" size="sm" onClick={() => useGraphStore.getState().clearSelection()}>
            关闭
          </Button>
        </div>
        <div className="p-4 text-sm text-[var(--text-secondary)]">已选择 {selectedIds.length} 个节点（暂仅支持单节点检查）。</div>
      </div>
    )
  }

  const setData = (patch: Record<string, unknown>) => updateNode(node.id, { data: patch })

  const createConfig = (type: NodeType) => {
    withBatch(() => {
      const pos = spawnRight(node, type === 'imageConfig' ? 360 : 420, type === 'videoConfig' ? 40 : 0)
      if (type === 'imageConfig') {
        const baseModelCfg: any = (IMAGE_MODELS as any[]).find((m: any) => m.key === DEFAULT_IMAGE_MODEL) || (IMAGE_MODELS as any[])[0]
        const id = addNode(type, pos, { 
          label: '生图配置',
          model: DEFAULT_IMAGE_MODEL,
          size: baseModelCfg?.defaultParams?.size,
          quality: baseModelCfg?.defaultParams?.quality,
        })
        addEdge(node.id, id, {})
        setSelected(id)
        return
      }
      if (type === 'videoConfig') {
        const baseModelCfg: any = (VIDEO_MODELS as any[]).find((m: any) => m.key === DEFAULT_VIDEO_MODEL) || (VIDEO_MODELS as any[])[0]
        const id = addNode(type, pos, { 
          label: '视频配置',
          model: DEFAULT_VIDEO_MODEL,
          ratio: baseModelCfg?.defaultParams?.ratio,
          dur: baseModelCfg?.defaultParams?.duration,
          size: baseModelCfg?.defaultParams?.size,
        })
        addEdge(node.id, id, {})
        setSelected(id)
        return
      }
      const id = addNode(type, pos, { label: String(type) })
      addEdge(node.id, id, {})
      setSelected(id)
    })
  }

  const sectionTitle = (t: string) => <div className="text-xs font-semibold text-[var(--text-secondary)]">{t}</div>

  const commonHeader = (
    <div className="flex items-center justify-between border-b border-[var(--border-color)] px-4 py-3">
      <div className="text-sm font-semibold text-[var(--text-primary)]">检查器</div>
      <Button variant="ghost" size="sm" onClick={() => setSelected(null)}>
        关闭
      </Button>
    </div>
  )

  const commonFooter = (
    <div className="border-t border-[var(--border-color)] p-3">
      <Button variant="danger" className="w-full" onClick={() => removeNode(node.id)}>
        删除节点
      </Button>
    </div>
  )

  const renderText = () => {
    const label = getString((node.data as any)?.label || '')
    const content = getString((node.data as any)?.content || '')
    return (
      <div className="space-y-3 p-4">
        {sectionTitle('标题')}
        <Input value={label} onChange={(e) => setData({ ...(node.data as any), label: e.target.value })} />

        {sectionTitle('内容')}
        <Textarea value={content} onChange={(e) => setData({ ...(node.data as any), content: e.target.value })} />

        <div className="flex flex-wrap gap-2 pt-1">
          <Button variant="secondary" onClick={() => createConfig('imageConfig')}>
            创建生图配置
          </Button>
          <Button variant="secondary" onClick={() => createConfig('videoConfig')}>
            创建视频配置
          </Button>
        </div>
      </div>
    )
  }

  const renderImageConfig = () => {
    const d: any = node.data || {}
    const prompt = getString(d.prompt || d.content || '')
    const model = getString(d.model || DEFAULT_IMAGE_MODEL)
    const size = getString(d.size || '')
    const quality = getString(d.quality || '')
    const status = getString(d.status || '')
    const error = getString(d.error || '')

    const modelCfg: any = (IMAGE_MODELS as any[]).find((m) => m.key === model) || (IMAGE_MODELS as any[])[0]
    const sizes: any[] = Array.isArray(modelCfg?.sizes) ? modelCfg.sizes : []
    const qualities: any[] = Array.isArray(modelCfg?.qualities) ? modelCfg.qualities : []

    return (
      <div className="space-y-3 p-4">
        {sectionTitle('标题')}
        <Input value={getString(d.label || '')} onChange={(e) => setData({ ...d, label: e.target.value })} />

        {sectionTitle('模型')}
        <Select value={model} onChange={(e) => setData({ ...d, model: e.target.value })}>
          {(IMAGE_MODELS as any[]).map((m: any) => (
            <option key={m.key} value={m.key}>
              {m.label}
            </option>
          ))}
        </Select>

        {sizes.length > 0 ? (
          <>
            {sectionTitle('尺寸')}
            <Select value={size} onChange={(e) => setData({ ...d, size: e.target.value })}>
              <option value="">默认</option>
              {sizes.map((s: any) => (
                <option key={String(s.key ?? s)} value={String(s.key ?? s)}>
                  {String(s.label ?? s)}
                </option>
              ))}
            </Select>
          </>
        ) : null}

        {qualities.length > 0 ? (
          <>
            {sectionTitle('画质')}
            <Select value={quality} onChange={(e) => setData({ ...d, quality: e.target.value })}>
              <option value="">默认</option>
              {qualities.map((q: any) => (
                <option key={String(q.key ?? q)} value={String(q.key ?? q)}>
                  {String(q.label ?? q)}
                </option>
              ))}
            </Select>
          </>
        ) : null}

        {sectionTitle('提示词')}
        <Textarea value={prompt} onChange={(e) => setData({ ...d, prompt: e.target.value })} />

        {error ? <div className="rounded-lg border border-rose-500/30 bg-rose-500/10 p-3 text-xs text-rose-200">{error}</div> : null}

        <div className="flex items-center gap-2 pt-1">
          <Button
            onClick={async () => {
              if (busy) return
              setBusy(true)
              setData({ ...d, status: 'running', error: '' })
              try {
                await generateImageFromConfigNode(node.id)
                setData({ ...(useGraphStore.getState().nodes.find((n) => n.id === node.id)?.data as any), status: 'success', error: '' })
              } catch (e: any) {
                setData({ ...d, status: 'error', error: e?.message || '生成失败' })
              } finally {
                setBusy(false)
              }
            }}
            disabled={!prompt.trim() || busy}
          >
            {busy || status === 'running' ? '生成中…' : '生成图片'}
          </Button>
        </div>
      </div>
    )
  }

  const renderVideoConfig = () => {
    const d: any = node.data || {}
    const prompt = getString(d.prompt || d.content || '')
    const model = getString(d.model || DEFAULT_VIDEO_MODEL)
    const ratio = getString(d.ratio || '')
    const duration = getString(d.duration || d.dur || '')
    const status = getString(d.status || '')
    const error = getString(d.error || '')

    const modelCfg: any = (VIDEO_MODELS as any[]).find((m) => m.key === model) || (VIDEO_MODELS as any[])[0]
    const ratios: any[] = Array.isArray(modelCfg?.ratios) ? modelCfg.ratios : []
    const durs: any[] = Array.isArray(modelCfg?.durs) ? modelCfg.durs : []

    return (
      <div className="space-y-3 p-4">
        {sectionTitle('标题')}
        <Input value={getString(d.label || '')} onChange={(e) => setData({ ...d, label: e.target.value })} />

        {sectionTitle('模型')}
        <Select value={model} onChange={(e) => setData({ ...d, model: e.target.value })}>
          {(VIDEO_MODELS as any[]).map((m: any) => (
            <option key={m.key} value={m.key}>
              {m.label}
            </option>
          ))}
        </Select>

        {ratios.length > 0 ? (
          <>
            {sectionTitle('比例')}
            <Select value={ratio} onChange={(e) => setData({ ...d, ratio: e.target.value })}>
              <option value="">默认</option>
              {ratios.map((r: any) => (
                <option key={String(r.key ?? r)} value={String(r.key ?? r)}>
                  {String(r.label ?? r)}
                </option>
              ))}
            </Select>
          </>
        ) : null}

        {durs.length > 0 ? (
          <>
            {sectionTitle('时长')}
            <Select value={duration} onChange={(e) => setData({ ...d, duration: e.target.value, dur: e.target.value })}>
              <option value="">默认</option>
              {durs.map((it: any) => (
                <option key={String(it.key ?? it)} value={String(it.key ?? it)}>
                  {String(it.label ?? it)}
                </option>
              ))}
            </Select>
          </>
        ) : null}

        {sectionTitle('提示词')}
        <Textarea value={prompt} onChange={(e) => setData({ ...d, prompt: e.target.value })} />

        {error ? <div className="rounded-lg border border-rose-500/30 bg-rose-500/10 p-3 text-xs text-rose-200">{error}</div> : null}

        <div className="flex items-center gap-2 pt-1">
          <Button
            onClick={async () => {
              if (busy) return
              setBusy(true)
              setData({ ...d, status: 'running', error: '' })
              try {
                await generateVideoFromConfigNode(node.id)
                setData({ ...(useGraphStore.getState().nodes.find((n) => n.id === node.id)?.data as any), status: 'success', error: '' })
              } catch (e: any) {
                setData({ ...d, status: 'error', error: e?.message || '生成失败' })
              } finally {
                setBusy(false)
              }
            }}
            disabled={!prompt.trim() || busy}
          >
            {busy || status === 'running' ? '生成中…' : '生成视频'}
          </Button>
        </div>
      </div>
    )
  }

  const renderImage = () => {
    const d: any = node.data || {}
    const url = getString(d.url || '')
    return (
      <div className="space-y-3 p-4">
        {sectionTitle('标题')}
        <Input value={getString(d.label || '')} onChange={(e) => setData({ ...d, label: e.target.value })} />
        {sectionTitle('图片')}
        {url ? (
          <ImagePreview url={url} />
        ) : (
          <div className="rounded-xl border border-[var(--border-color)] bg-[var(--bg-primary)] p-4 text-xs text-[var(--text-secondary)]">
            暂无图片 URL（后续可支持上传/缓存）
          </div>
        )}
        <div className="flex flex-wrap gap-2 pt-1">
          <Button variant="secondary" onClick={() => createConfig('videoConfig')}>
            用它生成视频
          </Button>
        </div>
      </div>
    )
  }

  const renderVideo = () => {
    const d: any = node.data || {}
    const url = getString(d.url || '')
    return (
      <div className="space-y-3 p-4">
        {sectionTitle('标题')}
        <Input value={getString(d.label || '')} onChange={(e) => setData({ ...d, label: e.target.value })} />
        {sectionTitle('视频')}
        {url ? (
          <VideoPreview url={url} />
        ) : (
          <div className="rounded-xl border border-[var(--border-color)] bg-[var(--bg-primary)] p-4 text-xs text-[var(--text-secondary)]">
            暂无视频 URL
          </div>
        )}
      </div>
    )
  }

  const renderAudio = () => {
    const d: any = node.data || {}
    const url = getString(d.url || '')
    const fileName = getString(d.fileName || '')
    return (
      <div className="space-y-3 p-4">
        {sectionTitle('标题')}
        <Input value={getString(d.label || '')} onChange={(e) => setData({ ...d, label: e.target.value })} />
        {sectionTitle('音频')}
        {url ? (
          <div className="space-y-2">
            <audio src={url} controls className="w-full" />
            <div className="flex gap-2">
              <Button
                variant="secondary"
                onClick={() => {
                  try {
                    const a = document.createElement('a')
                    a.href = url
                    a.download = fileName || `audio_${Date.now()}.mp3`
                    document.body.appendChild(a)
                    a.click()
                    document.body.removeChild(a)
                  } catch {
                    // ignore
                  }
                }}
              >
                下载
              </Button>
              <Button variant="secondary" onClick={() => setData({ ...d, url: '', fileName: '' })}>
                清空
              </Button>
            </div>
          </div>
        ) : (
          <div className="rounded-xl border border-[var(--border-color)] bg-[var(--bg-primary)] p-4 text-xs text-[var(--text-secondary)]">
            <div>上传音频文件（会保存为 dataURL）</div>
            <input
              className="mt-3 block w-full text-xs"
              type="file"
              accept="audio/*"
              onChange={async (e) => {
                const file = e.target.files?.[0]
                if (!file) return
                const dataUrl = await toDataUrl(file)
                setData({ ...d, url: dataUrl, fileName: file.name, updatedAt: Date.now() })
              }}
            />
          </div>
        )}
      </div>
    )
  }

  const renderLocalSave = () => {
    const d: any = node.data || {}
    const s = useGraphStore.getState()
    const byId = new Map(s.nodes.map((n) => [n.id, n]))
    const incoming = s.edges
      .filter((e) => e.target === node.id)
      .map((e) => byId.get(e.source))
      .filter((n): n is GraphNode => !!n && (n.type === 'image' || n.type === 'video' || n.type === 'audio'))

    return (
      <div className="space-y-3 p-4">
        {sectionTitle('标题')}
        <Input value={getString(d.label || '本地保存')} onChange={(e) => setData({ ...d, label: e.target.value })} />
        {sectionTitle('说明')}
        <div className="text-xs text-[var(--text-secondary)]">
          该节点会把连接进来的图片/视频尝试缓存到本地（Tauri 模式下生效），用于减少拦截与闪烁。
        </div>
        {sectionTitle(`已连接素材 ${incoming.length}`)}
        <div className="space-y-2">
          {incoming.length === 0 ? (
            <div className="text-xs text-[var(--text-secondary)]">暂无连接</div>
          ) : (
            incoming.map((n) => (
              <div key={n.id} className="rounded-lg border border-[var(--border-color)] bg-[var(--bg-primary)] px-3 py-2 text-xs">
                <div className="font-medium text-[var(--text-primary)]">
                  {getString((n.data as any)?.label || '') || n.type} · {n.id}
                </div>
                <div className="mt-1 text-[var(--text-secondary)] break-all">
                  {getString((n.data as any)?.sourceUrl || (n.data as any)?.url || '') || '（无 URL）'}
                </div>
              </div>
            ))
          )}
        </div>
        <Button
          variant="secondary"
          disabled={incoming.length === 0}
          onClick={async () => {
            if (busy) return
            setBusy(true)
            try {
              for (const n of incoming) {
                const u = getString((n.data as any)?.sourceUrl || (n.data as any)?.url || '').trim()
                if (!u) continue
                if (n.type === 'image') {
                  const cached = await resolveCachedImageUrl(u)
                  if (cached.displayUrl) updateNode(n.id, { data: { ...(n.data as any), url: cached.displayUrl, localPath: cached.localPath, sourceUrl: u } })
                } else if (n.type === 'video') {
                  const cached = await resolveCachedMediaUrl(u)
                  if (cached.displayUrl) updateNode(n.id, { data: { ...(n.data as any), url: cached.displayUrl, localPath: cached.localPath, sourceUrl: u } })
                }
              }
              setData({ ...d, updatedAt: Date.now() })
            } finally {
              setBusy(false)
            }
          }}
        >
          缓存到本地
        </Button>
      </div>
    )
  }

  let body: React.ReactNode = null
  if (node.type === 'text') body = renderText()
  else if (node.type === 'imageConfig') body = renderImageConfig()
  else if (node.type === 'videoConfig') body = renderVideoConfig()
  else if (node.type === 'image') body = renderImage()
  else if (node.type === 'video') body = renderVideo()
  else if (node.type === 'audio') body = renderAudio()
  else if (node.type === 'localSave') body = renderLocalSave()
  else body = <div className="p-4 text-sm text-[var(--text-secondary)]">该节点类型暂未实现：{node.type}</div>

  return (
    <aside className="h-full w-[380px] border-l border-[var(--border-color)] bg-[var(--bg-secondary)]">
      {commonHeader}
      <div className="border-b border-[var(--border-color)] px-4 py-2 text-xs text-[var(--text-secondary)]">{title}</div>
      <div className="h-[calc(100%-104px)] overflow-y-auto">{body}</div>
      {commonFooter}
    </aside>
  )
}
