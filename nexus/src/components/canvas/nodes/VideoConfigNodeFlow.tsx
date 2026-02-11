/**
 * VideoConfigNodeFlow - All-in-one 视频生成节点
 *
 * 合并了提示词输入、配置、风格预设、相机预设、输出预览于一个节点
 * 视频特有的控制（时长、首尾帧、音频）放在可折叠的"高级设置"区
 */
import React, { memo, useState, useCallback, useRef, useEffect, useMemo } from 'react'
import { Position, NodeProps } from '@xyflow/react'
import { TapNodeHandle } from './shared/TapNodeHandle'
import { Trash2, Copy } from 'lucide-react'
import { useGraphStore } from '@/graph/store'
import { getNodeSize } from '@/graph/nodeSizing'
import { generateVideoFromConfigNode } from '@/lib/workflow/video'
import { DEFAULT_VIDEO_MODEL, VIDEO_MODELS } from '@/config/models'
import * as modelsConfig from '@/config/models'
import { getVideoModelCaps, coerceVideoImageRole } from '@/lib/modelCaps'
import { useSettingsStore } from '@/store/settings'
import { usePresetsStore } from '@/store/presets'
import { CAMERA_PRESETS } from '@/lib/cameraControl/presets'

import { OutputPreview, type OutputEntry } from './shared/OutputPreview'
import { PromptInput } from './shared/PromptInput'
import { StylePresetsRow } from './shared/StylePresetsRow'
import { GenerationToolbar } from './shared/GenerationToolbar'
import { AdvancedSettings } from './shared/AdvancedSettings'

const getDefaultVideoModel = (): string => {
  const userDefault = useSettingsStore.getState().defaultVideoModel
  if (userDefault && VIDEO_MODELS.some((m: any) => m.key === userDefault)) return userDefault
  return DEFAULT_VIDEO_MODEL
}

const MODEL_OPTIONS = VIDEO_MODELS.map((m: any) => ({ key: m.key, label: m.label }))
const VALID_MODEL_KEYS = new Set(VIDEO_MODELS.map((m: any) => m.key))

const getValidModel = (v: string | undefined): string => {
  if (v && VALID_MODEL_KEYS.has(v)) return v
  const resolved: any = v ? (modelsConfig as any)?.getModelByName?.(v) : null
  if (resolved && VALID_MODEL_KEYS.has(resolved.key)) return resolved.key
  return getDefaultVideoModel()
}

const getModelConfig = (key: string) => {
  const resolved: any = (modelsConfig as any)?.getModelByName?.(key) || null
  if (resolved && String(resolved?.format || '').includes('video')) return resolved
  return VIDEO_MODELS.find((m: any) => m.key === key) || VIDEO_MODELS[0]
}

const getModelRatioOptions = (key: string) => {
  const cfg = getModelConfig(key) as any
  return (cfg?.ratios || ['16:9', '9:16']).map((r: string) => ({ key: r, label: r }))
}

const getModelDurationOptions = (key: string) => {
  const cfg = getModelConfig(key) as any
  return cfg?.durs || [{ label: '5 秒', key: 5 }]
}

const getModelSizeOptions = (key: string) => {
  const cfg = getModelConfig(key) as any
  return cfg?.sizes || []
}

const getModelResolutionOptions = (key: string) => {
  const cfg = getModelConfig(key) as any
  return (cfg?.resolutions || []).map((r: string) => ({ key: r, label: r }))
}

export const VideoConfigNodeComponent = memo(function VideoConfigNode({ id, data, selected }: NodeProps) {
  const d = data as Record<string, any>
  const [model, setModel] = useState(() => getValidModel(d?.model))
  const [ratio, setRatio] = useState(d?.ratio || '16:9')
  const [duration, setDuration] = useState(d?.dur || 5)
  const [size, setSize] = useState(d?.size || '')
  const [resolution, setResolution] = useState(d?.resolution || '')
  const [loopCount, setLoopCount] = useState(d?.loopCount || 1)
  const [prompt, setPrompt] = useState(d?.prompt || '')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [outputs, setOutputs] = useState<OutputEntry[]>(d?.outputs || [])
  const [activeOutputIndex, setActiveOutputIndex] = useState(d?.activeOutputIndex || 0)
  const [activeStyleId, setActiveStyleId] = useState<string | undefined>(d?.activeStyleId)
  const [cameraPreset, setCameraPreset] = useState<string | undefined>(d?.cameraPreset)
  const [inlineRefImages, setInlineRefImages] = useState<Array<{ url: string; label?: string }>>(d?.inlineRefImages || [])
  const [viduAudio, setViduAudio] = useState(d?.viduAudio || false)
  const [viduVoiceId, setViduVoiceId] = useState(d?.viduVoiceId || '')
  const [klingVoiceIds, setKlingVoiceIds] = useState(d?.klingVoiceIds || '')
  const [firstFrameUrl, setFirstFrameUrl] = useState(d?.firstFrameUrl || '')
  const [firstFrameMediaId, setFirstFrameMediaId] = useState(d?.firstFrameMediaId || '')
  const [lastFrameUrl, setLastFrameUrl] = useState(d?.lastFrameUrl || '')
  const [lastFrameMediaId, setLastFrameMediaId] = useState(d?.lastFrameMediaId || '')
  const [showActions, setShowActions] = useState(false)

  const updateTimerRef = useRef<number>(0)

  // Sync external data changes
  useEffect(() => {
    const m = getValidModel(d?.model); if (m !== model) setModel(m)
    if (d?.ratio && d.ratio !== ratio) setRatio(d.ratio)
    if (d?.dur !== undefined && d.dur !== duration) setDuration(d.dur)
    if (d?.loopCount && d.loopCount !== loopCount) setLoopCount(d.loopCount)
    if (d?.prompt !== undefined && d.prompt !== prompt) setPrompt(d.prompt)
    if (d?.outputs && JSON.stringify(d.outputs) !== JSON.stringify(outputs)) setOutputs(d.outputs)
  }, [d?.model, d?.ratio, d?.dur, d?.loopCount, d?.prompt, d?.outputs])

  useEffect(() => () => { if (updateTimerRef.current) clearTimeout(updateTimerRef.current) }, [])

  const debouncedSync = useCallback((patch: Record<string, any>) => {
    if (updateTimerRef.current) clearTimeout(updateTimerRef.current)
    updateTimerRef.current = window.setTimeout(() => {
      useGraphStore.getState().updateNode(id, { data: patch })
    }, 300)
  }, [id])

  // Model config
  const ratioOptions = useMemo(() => getModelRatioOptions(model), [model])
  const durOptions = useMemo(() => getModelDurationOptions(model), [model])
  const sizeOptions = useMemo(() => getModelSizeOptions(model), [model])
  const resolutionOptions = useMemo(() => getModelResolutionOptions(model), [model])
  const modelCfg = useMemo(() => getModelConfig(model) as any, [model])

  // Connected ref images
  const getRefImages = useCallback(() => {
    const s = useGraphStore.getState()
    return s.edges
      .filter(e => e.target === id)
      .map(e => {
        const n = s.nodes.find(nd => nd.id === e.source)
        if (!n || n.type !== 'image' || !n.data?.url) return null
        return { url: String(n.data.url), label: String(n.data.label || '') }
      })
      .filter((x): x is NonNullable<typeof x> => !!x)
  }, [id])

  const [refImages, setRefImages] = useState(() => getRefImages())
  useEffect(() => {
    let prev = JSON.stringify(refImages)
    const unsub = useGraphStore.subscribe((state, prevState) => {
      if (state.edges === prevState.edges && state.nodes === prevState.nodes) return
      const next = getRefImages()
      const nextStr = JSON.stringify(next)
      if (nextStr !== prev) { prev = nextStr; setRefImages(next) }
    })
    return unsub
  }, [getRefImages])

  // Handlers
  const handleModelChange = useCallback((key: string) => {
    setModel(key)
    const cfg = getModelConfig(key) as any
    const defaultRatio = cfg?.defaultParams?.ratio || '16:9'
    const defaultDur = cfg?.defaultParams?.duration || 5
    const defaultSize = cfg?.defaultParams?.size || ''
    const defaultRes = cfg?.defaultParams?.resolution || ''
    setRatio(defaultRatio)
    setDuration(defaultDur)
    setSize(defaultSize)
    setResolution(defaultRes)
    debouncedSync({ model: key, ratio: defaultRatio, dur: defaultDur, size: defaultSize, resolution: defaultRes })

    // 切换模型后重新校验已连接图片的 imageRole
    const caps = getVideoModelCaps(key)
    const store = useGraphStore.getState()
    const edges = store.edges.filter(e => e.target === id && e.type === 'imageRole')
    if (edges.length > 0) {
      let hasFirst = false
      let hasLast = false
      store.withBatchUpdates(() => {
        for (const edge of edges) {
          const curRole = String((edge.data as any)?.imageRole || 'first_frame_image').trim()
          let nextRole = coerceVideoImageRole(curRole, caps)
          if (nextRole === 'first_frame_image') {
            if (hasFirst) nextRole = caps.supportsLastFrame && !hasLast ? 'last_frame_image' : (caps.supportsReferenceImages ? 'input_reference' : 'first_frame_image')
            else hasFirst = true
          }
          if (nextRole === 'last_frame_image') {
            if (hasLast) nextRole = caps.supportsReferenceImages ? 'input_reference' : 'first_frame_image'
            else hasLast = true
          }
          if (nextRole !== curRole) store.setEdgeImageRole(edge.id, nextRole)
        }
      })
    }
  }, [id, debouncedSync])

  const handleRatioChange = useCallback((v: string) => { setRatio(v); debouncedSync({ ratio: v }) }, [debouncedSync])
  const handleDurChange = useCallback((v: number) => { setDuration(v); debouncedSync({ dur: v }) }, [debouncedSync])
  const handleSizeChange = useCallback((v: string) => { setSize(v); debouncedSync({ size: v }) }, [debouncedSync])
  const handleResolutionChange = useCallback((v: string) => { setResolution(v); debouncedSync({ resolution: v }) }, [debouncedSync])
  const handleLoopCountChange = useCallback((n: number) => { setLoopCount(n); debouncedSync({ loopCount: n }) }, [debouncedSync])
  const handlePromptChange = useCallback((v: string) => { setPrompt(v); debouncedSync({ prompt: v }) }, [debouncedSync])
  const handleStyleChange = useCallback((id_: string | undefined) => { setActiveStyleId(id_); debouncedSync({ activeStyleId: id_ }) }, [debouncedSync])
  const handleCameraChange = useCallback((name: string | undefined) => { setCameraPreset(name); debouncedSync({ cameraPreset: name }) }, [debouncedSync])

  const handleRefImageAdd = useCallback((url: string) => {
    setInlineRefImages(prev => {
      const next = [...prev, { url }]
      debouncedSync({ inlineRefImages: next })
      return next
    })
  }, [debouncedSync])

  const handleRefImageRemove = useCallback((index: number) => {
    setInlineRefImages(prev => {
      const next = prev.filter((_, i) => i !== index)
      debouncedSync({ inlineRefImages: next })
      return next
    })
  }, [debouncedSync])

  const allRefImages = useMemo(() => [...inlineRefImages, ...refImages], [inlineRefImages, refImages])
  const videoCaps = useMemo(() => getVideoModelCaps(model), [model])

  const handleDelete = useCallback((e: React.MouseEvent) => { e.stopPropagation(); useGraphStore.getState().removeNode(id) }, [id])
  const handleDuplicate = useCallback((e: React.MouseEvent) => {
    e.stopPropagation()
    const store = useGraphStore.getState()
    const node = store.nodes.find(n => n.id === id)
    if (node) store.addNode('videoConfig', { x: node.x + 50, y: node.y + 50 }, { ...node.data })
  }, [id])

  const handleGenerate = useCallback(async () => {
    let effectivePrompt = prompt.trim()
    if (cameraPreset) {
      const preset = CAMERA_PRESETS.find(p => p.name === cameraPreset)
      if (preset) effectivePrompt += ', ' + preset.promptSuffix
    }
    if (activeStyleId) {
      const style = usePresetsStore.getState().getStylePresetById(activeStyleId)
      if (style) effectivePrompt += ', ' + style.promptSuffix
    }

    const caps = getVideoModelCaps(model)
    const refs = getRefImages()
    if (!effectivePrompt && refs.length === 0 && !firstFrameUrl) {
      window.$message?.warning?.('请输入提示词或连接图片')
      return
    }
    if (caps.requiresPrompt && !effectivePrompt) {
      window.$message?.warning?.('当前模型需要提示词')
      return
    }

    setLoading(true)
    setError('')

    try {
      if (updateTimerRef.current) clearTimeout(updateTimerRef.current)
      useGraphStore.getState().updateNode(id, {
        data: { model, ratio, dur: duration, size, loopCount, resolution, viduAudio, viduVoiceId, klingVoiceIds, prompt, firstFrameUrl, firstFrameMediaId, lastFrameUrl, lastFrameMediaId, _inlinePrompt: effectivePrompt, _inlineRefImages: inlineRefImages.map(r => r.url) }
      } as any)

      const actualLoopCount = Math.max(1, Math.min(10, loopCount))
      const outIds: string[] = []
      const s0 = useGraphStore.getState()
      const cfgNode = s0.nodes.find(n => n.id === id)
      if (!cfgNode) throw new Error('节点不存在')

      const baseX = (cfgNode.x || 0) + 500
      const baseY = (cfgNode.y || 0)
      const outSize = getNodeSize('video')
      const spacingY = Math.max(36, (outSize?.h || 240) + 60)

      useGraphStore.getState().withBatchUpdates(() => {
        for (let i = 0; i < actualLoopCount; i++) {
          const outId = useGraphStore.getState().addNode('video', { x: baseX, y: baseY + i * spacingY }, {
            url: '', loading: true, error: '', label: '视频生成结果'
          })
          outIds.push(outId)
          useGraphStore.getState().addEdge(id, outId, { sourceHandle: 'right', targetHandle: 'left' })
        }
      })

      if (actualLoopCount > 1) window.$message?.info?.(`开始并发生成 ${actualLoopCount} 个视频...`)

      const tasks = outIds.map(outId =>
        generateVideoFromConfigNode(id, { model, ratio, duration, size }, { outputNodeId: outId, selectOutput: false, markConfigExecuted: false })
          .then(() => {
            const outNode = useGraphStore.getState().nodes.find(n => n.id === outId)
            if (outNode?.data?.url) {
              const entry: OutputEntry = {
                id: outId,
                url: String(outNode.data.url),
                sourceUrl: String(outNode.data.sourceUrl || ''),
                mediaId: String(outNode.data.mediaId || ''),
                model,
                createdAt: Date.now(),
                duration: Number(outNode.data.duration || duration),
              }
              setOutputs(prev => {
                const next = [entry, ...prev].slice(0, 20)
                useGraphStore.getState().updateNode(id, { data: { outputs: next, activeOutputIndex: 0 } })
                return next
              })
              setActiveOutputIndex(0)
            }
            return { ok: true as const, outId }
          })
          .catch(err => ({ ok: false as const, outId, err }))
      )

      const results = await Promise.all(tasks)
      const okCount = results.filter(r => r.ok).length
      const failCount = results.length - okCount

      // 删除临时输出节点，结果已存入 outputs 数组
      useGraphStore.getState().withBatchUpdates(() => {
        for (const outId of outIds) {
          useGraphStore.getState().removeNode(outId)
        }
      })

      useGraphStore.getState().updateNode(id, { data: { executed: true, _inlinePrompt: undefined } } as any)

      if (failCount === 0) {
        window.$message?.success?.(actualLoopCount > 1 ? `成功生成 ${okCount} 个视频` : '视频生成成功')
      } else {
        window.$message?.warning?.(`成功 ${okCount}，失败 ${failCount}`)
        if (failCount === results.length) {
          const firstErr = results.find(r => !r.ok) as any
          setError(firstErr?.err?.message || '生成失败')
        }
      }
    } catch (err: any) {
      setError(err?.message || '生成失败')
      window.$message?.error?.(`生成失败: ${err?.message || '未知错误'}`)
    } finally {
      setLoading(false)
    }
  }, [id, model, ratio, duration, size, loopCount, resolution, viduAudio, viduVoiceId, klingVoiceIds, prompt, cameraPreset, activeStyleId, firstFrameUrl, firstFrameMediaId, lastFrameUrl, lastFrameMediaId, getRefImages])

  return (
    <div
      className={`rounded-xl border transition-shadow ${
        selected ? 'ring-2 ring-purple-500/40 shadow-lg shadow-purple-500/20 border-purple-500/50' : 'border-[var(--border-color)] shadow-sm hover:shadow-md'
      } bg-[var(--bg-primary)]`}
      style={{ width: 420, borderTop: '3px solid #a855f7' }}
      onMouseEnter={() => setShowActions(true)}
      onMouseLeave={() => setShowActions(false)}
      onClick={e => e.stopPropagation()}
    >
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 bg-purple-500/10 rounded-t-xl">
        <span className="text-xs font-medium text-[var(--text-primary)]">
          {d?.label || '视频生成'}
        </span>
        <div className="flex items-center gap-1">
          {showActions && (
            <>
              <button onClick={handleDuplicate} className="p-1 rounded hover:bg-[var(--bg-tertiary)]" title="复制">
                <Copy size={12} className="text-[var(--text-secondary)]" />
              </button>
              <button onClick={handleDelete} className="p-1 rounded hover:bg-red-500/20" title="删除">
                <Trash2 size={12} className="text-[var(--text-secondary)]" />
              </button>
            </>
          )}
        </div>
      </div>

      {/* Preview Section */}
      <div className="px-3 py-2">
        <OutputPreview
          outputs={outputs}
          activeIndex={activeOutputIndex}
          onActiveIndexChange={setActiveOutputIndex}
          loading={loading}
          error={error}
          mode="video"
          width={394}
        />
      </div>

      {/* Divider */}
      <div className="mx-3 border-t border-[var(--border-color)]" />

      {/* Control Panel */}
      <div className="bg-[var(--bg-secondary)]/50 rounded-b-xl">
        {/* Style Presets + Ref Images */}
        <div className="px-3 pt-2">
          <StylePresetsRow
            activeStyleId={activeStyleId}
            onStyleChange={handleStyleChange}
            refImages={allRefImages}
            onRefImageRemove={handleRefImageRemove}
          />
        </div>

        {/* Prompt Input */}
        <div className="px-3 pt-2">
          <PromptInput
            value={prompt}
            onChange={handlePromptChange}
            onSubmit={handleGenerate}
            disabled={loading}
            onRefImageAdd={handleRefImageAdd}
            maxRefImages={videoCaps.maxRefImages}
            currentRefCount={allRefImages.length}
          />
        </div>

        {/* Generation Toolbar */}
        <div className="px-3 py-2">
          <GenerationToolbar
            modelOptions={MODEL_OPTIONS}
            model={model}
            onModelChange={handleModelChange}
            sizeLabel="比例"
            sizeOptions={ratioOptions}
            size={ratio}
            onSizeChange={handleRatioChange}
            cameraPreset={cameraPreset}
            onCameraPresetChange={handleCameraChange}
            loopCount={loopCount}
            onLoopCountChange={handleLoopCountChange}
            onGenerate={handleGenerate}
            loading={loading}
            disabled={false}
          />
        </div>

        {/* Advanced Settings */}
        <div className="px-3 pb-2">
          <AdvancedSettings
            mode="video"
            durOptions={durOptions}
            dur={duration}
            onDurChange={handleDurChange}
            sizeOptions={sizeOptions.map((s: any) => typeof s === 'string' ? { key: s, label: s } : s)}
            size={size}
            onSizeChange={handleSizeChange}
            resolutionOptions={resolutionOptions}
            resolution={resolution}
            onResolutionChange={handleResolutionChange}
            supportsFirstFrame={!!modelCfg?.supportsFirstFrame}
            supportsLastFrame={!!modelCfg?.supportsLastFrame}
            firstFrameUrl={firstFrameUrl}
            onFirstFrameChange={(url, mediaId) => { setFirstFrameUrl(url); setFirstFrameMediaId(mediaId || ''); debouncedSync({ firstFrameUrl: url, firstFrameMediaId: mediaId }) }}
            onFirstFrameClear={() => { setFirstFrameUrl(''); setFirstFrameMediaId(''); debouncedSync({ firstFrameUrl: '', firstFrameMediaId: '' }) }}
            lastFrameUrl={lastFrameUrl}
            onLastFrameChange={(url, mediaId) => { setLastFrameUrl(url); setLastFrameMediaId(mediaId || ''); debouncedSync({ lastFrameUrl: url, lastFrameMediaId: mediaId }) }}
            onLastFrameClear={() => { setLastFrameUrl(''); setLastFrameMediaId(''); debouncedSync({ lastFrameUrl: '', lastFrameMediaId: '' }) }}
            supportsAudio={!!(modelCfg as any)?.supportsAudio || !!(modelCfg as any)?.supportsSound}
            audioEnabled={viduAudio}
            onAudioToggle={(v) => { setViduAudio(v); debouncedSync({ viduAudio: v }) }}
            tips={modelCfg?.tips}
          />
        </div>
      </div>

      {/* Connection handles */}
      <TapNodeHandle type="target" position={Position.Left} id="left" />
      <TapNodeHandle type="source" position={Position.Right} id="right" />
    </div>
  )
})
