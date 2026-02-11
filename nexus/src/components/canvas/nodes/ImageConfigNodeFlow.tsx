/**
 * ImageConfigNodeFlow - All-in-one 图片生成节点
 *
 * 合并了提示词输入、配置、风格预设、相机预设、输出预览于一个节点
 */
import React, { memo, useState, useCallback, useRef, useEffect, useMemo } from 'react'
import { Position, NodeProps } from '@xyflow/react'
import { TapNodeHandle } from './shared/TapNodeHandle'
import { Trash2, Copy } from 'lucide-react'
import { useGraphStore } from '@/graph/store'
import { getNodeSize } from '@/graph/nodeSizing'
import { generateImageFromConfigNode } from '@/lib/workflow/image'
import { IMAGE_MODELS, SEEDREAM_SIZE_OPTIONS, SEEDREAM_4K_SIZE_OPTIONS } from '@/config/models'
import { getImageModelCaps } from '@/lib/modelCaps'
import { useSettingsStore } from '@/store/settings'
import { usePresetsStore } from '@/store/presets'
import { CAMERA_PRESETS } from '@/lib/cameraControl/presets'

import { OutputPreview, type OutputEntry } from './shared/OutputPreview'
import { PromptInput } from './shared/PromptInput'
import { StylePresetsRow } from './shared/StylePresetsRow'
import { GenerationToolbar } from './shared/GenerationToolbar'

const getDefaultImageModel = (): string => {
  const userDefault = useSettingsStore.getState().defaultImageModel
  if (userDefault && IMAGE_MODELS.some((m: any) => m.key === userDefault)) return userDefault
  return IMAGE_MODELS[0]?.key || 'gemini-3-pro-image-preview'
}

const MODEL_OPTIONS = IMAGE_MODELS.map((m: any) => ({ key: m.key, label: m.label }))
const VALID_MODEL_KEYS = new Set(IMAGE_MODELS.map((m: any) => m.key))
const getValidModel = (v: string | undefined): string => (v && VALID_MODEL_KEYS.has(v)) ? v : getDefaultImageModel()
const getModelConfig = (key: string) => IMAGE_MODELS.find((m: any) => m.key === key) || IMAGE_MODELS[0]

const getModelSizeOptions = (key: string) => {
  const cfg = getModelConfig(key) as any
  const sizes = cfg?.sizes || ['1:1', '16:9', '9:16', '4:3', '3:4']
  return sizes.map((s: any) => typeof s === 'string' ? { key: s, label: s } : { key: s.key, label: s.label })
}

const getModelQualityOptions = (key: string) => {
  const cfg = getModelConfig(key) as any
  return cfg?.qualities || []
}

export const ImageConfigNodeComponent = memo(function ImageConfigNode({ id, data, selected }: NodeProps) {
  const d = data as Record<string, any>
  const [model, setModel] = useState(() => getValidModel(d?.model))
  const [size, setSize] = useState(d?.size || '3:4')
  const [quality, setQuality] = useState(d?.quality || '')
  const [loopCount, setLoopCount] = useState(d?.loopCount || 1)
  const [prompt, setPrompt] = useState(d?.prompt || '')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [outputs, setOutputs] = useState<OutputEntry[]>(d?.outputs || [])
  const [activeOutputIndex, setActiveOutputIndex] = useState(d?.activeOutputIndex || 0)
  const [activeStyleId, setActiveStyleId] = useState<string | undefined>(d?.activeStyleId)
  const [cameraPreset, setCameraPreset] = useState<string | undefined>(d?.cameraPreset)
  const [inlineRefImages, setInlineRefImages] = useState<Array<{ url: string; label?: string }>>(d?.inlineRefImages || [])
  const [showActions, setShowActions] = useState(false)

  const updateTimerRef = useRef<number>(0)

  // Sync external data changes
  useEffect(() => {
    const m = getValidModel(d?.model); if (m !== model) setModel(m)
    const s = d?.size || '3:4'; if (s !== size) setSize(s)
    const q = d?.quality || ''; if (q !== quality) setQuality(q)
    const lc = d?.loopCount || 1; if (lc !== loopCount) setLoopCount(lc)
    if (d?.prompt !== undefined && d.prompt !== prompt) setPrompt(d.prompt)
    if (d?.outputs && JSON.stringify(d.outputs) !== JSON.stringify(outputs)) setOutputs(d.outputs)
  }, [d?.model, d?.size, d?.quality, d?.loopCount, d?.prompt, d?.outputs])

  useEffect(() => () => { if (updateTimerRef.current) clearTimeout(updateTimerRef.current) }, [])

  // Seedream 旧数据迁移：曾把 1K/2K/4K 或像素值写在 size 字段
  useEffect(() => {
    const cfg = getModelConfig(model) as any
    if (cfg?.format !== 'doubao-seedream') return
    const ratioKeys = new Set(getModelSizeOptions(model).map((o: any) => String(o?.key || '').trim()))
    const resKeys = new Set(getModelQualityOptions(model).map((o: any) => String(o?.key || '').trim()))
    const curSize = String(size || '').trim()
    const curQuality = String(quality || '').trim()
    const defaultRatio = String(cfg?.defaultParams?.size || '3:4')
    const defaultRes = String(cfg?.defaultParams?.quality || '2K')
    let nextSize = curSize
    let nextQuality = curQuality
    if (!nextQuality || !resKeys.has(nextQuality)) nextQuality = defaultRes
    if (!ratioKeys.has(nextSize)) {
      if (/^(1k|2k|4k)$/i.test(nextSize)) {
        nextQuality = nextSize.toUpperCase()
        nextSize = defaultRatio
      } else if (/^\d{3,5}x\d{3,5}$/i.test(nextSize)) {
        const found2k: any = (SEEDREAM_SIZE_OPTIONS as any[]).find((o: any) => String(o?.key || '').trim() === nextSize)
        const found4k: any = (SEEDREAM_4K_SIZE_OPTIONS as any[]).find((o: any) => String(o?.key || '').trim() === nextSize)
        if (found2k?.label) { nextSize = String(found2k.label); nextQuality = '2K' }
        else if (found4k?.label) { nextSize = String(found4k.label); nextQuality = '4K' }
        else { nextSize = defaultRatio }
      } else { nextSize = defaultRatio }
    }
    if (nextSize === curSize && nextQuality === curQuality) return
    setSize(nextSize)
    setQuality(nextQuality)
    useGraphStore.getState().updateNode(id, { data: { size: nextSize, quality: nextQuality } } as any)
  }, [model])

  const debouncedSync = useCallback((patch: Record<string, any>) => {
    if (updateTimerRef.current) clearTimeout(updateTimerRef.current)
    updateTimerRef.current = window.setTimeout(() => {
      useGraphStore.getState().updateNode(id, { data: patch })
    }, 300)
  }, [id])

  // Model config
  const sizeOptions = useMemo(() => getModelSizeOptions(model), [model])
  const qualityOptions = useMemo(() => getModelQualityOptions(model), [model])
  const isResolution = qualityOptions.length > 0 && qualityOptions.every((o: any) => /^\d+k$/i.test(String(o?.key || '')))
  const qualityLabel = isResolution ? '分辨率' : '画质'

  // Connected ref images
  const getRefImages = useCallback(() => {
    const s = useGraphStore.getState()
    return s.edges
      .filter(e => e.target === id)
      .map(e => s.nodes.find(n => n.id === e.source))
      .filter((n): n is NonNullable<typeof n> => !!n && n.type === 'image' && !!n.data?.url)
      .map(n => ({ url: String(n.data?.url || ''), label: String(n.data?.label || '') }))
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
    const defaultSize = cfg?.defaultParams?.size || sizeOptions[0]?.key || '3:4'
    const defaultQuality = cfg?.defaultParams?.quality || ''
    setSize(defaultSize)
    setQuality(defaultQuality)
    debouncedSync({ model: key, size: defaultSize, quality: defaultQuality })
  }, [debouncedSync, sizeOptions])

  const handleSizeChange = useCallback((v: string) => { setSize(v); debouncedSync({ size: v }) }, [debouncedSync])
  const handleQualityChange = useCallback((v: string) => { setQuality(v); debouncedSync({ quality: v }) }, [debouncedSync])
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
  const caps = useMemo(() => getImageModelCaps(model), [model])

  const handleDelete = useCallback((e: React.MouseEvent) => { e.stopPropagation(); useGraphStore.getState().removeNode(id) }, [id])
  const handleDuplicate = useCallback((e: React.MouseEvent) => {
    e.stopPropagation()
    const store = useGraphStore.getState()
    const node = store.nodes.find(n => n.id === id)
    if (node) store.addNode('imageConfig', { x: node.x + 50, y: node.y + 50 }, { ...node.data })
  }, [id])

  const handleGenerate = useCallback(async () => {
    // Build effective prompt
    let effectivePrompt = prompt.trim()
    if (cameraPreset) {
      const preset = CAMERA_PRESETS.find(p => p.name === cameraPreset)
      if (preset) effectivePrompt += ', ' + preset.promptSuffix
    }
    if (activeStyleId) {
      const style = usePresetsStore.getState().getStylePresetById(activeStyleId)
      if (style) effectivePrompt += ', ' + style.promptSuffix
    }

    // Check inputs
    const caps = getImageModelCaps(model)
    const refs = getRefImages()
    if (!effectivePrompt && refs.length === 0) {
      window.$message?.warning?.('请输入提示词或连接参考图')
      return
    }
    if (caps.requiresPrompt && !effectivePrompt) {
      window.$message?.warning?.('当前模型需要提示词')
      return
    }

    setLoading(true)
    setError('')

    try {
      // Sync everything to store before generation
      if (updateTimerRef.current) clearTimeout(updateTimerRef.current)
      useGraphStore.getState().updateNode(id, { data: { model, size, quality, loopCount, prompt, _inlinePrompt: effectivePrompt, _inlineRefImages: inlineRefImages.map(r => r.url) } })

      const actualLoopCount = Math.max(1, Math.min(10, loopCount))
      const outIds: string[] = []
      const s0 = useGraphStore.getState()
      const cfgNode = s0.nodes.find(n => n.id === id)
      if (!cfgNode) throw new Error('节点不存在')

      const baseX = (cfgNode.x || 0) + 500
      const baseY = (cfgNode.y || 0)
      const outSize = getNodeSize('image')
      const spacingY = Math.max(36, (outSize?.h || 200) + 40)

      useGraphStore.getState().withBatchUpdates(() => {
        for (let i = 0; i < actualLoopCount; i++) {
          const outId = useGraphStore.getState().addNode('image', { x: baseX, y: baseY + i * spacingY }, {
            url: '', loading: true, error: '', label: '图像生成结果'
          })
          outIds.push(outId)
          useGraphStore.getState().addEdge(id, outId, { sourceHandle: 'right', targetHandle: 'left' })
        }
      })

      if (actualLoopCount > 1) window.$message?.info?.(`开始并发生成 ${actualLoopCount} 张图片...`)

      const tasks = outIds.map(outId =>
        generateImageFromConfigNode(id, { model, size, quality }, { outputNodeId: outId, selectOutput: false, markConfigExecuted: false })
          .then(() => {
            // After success, capture the output node's URL into our preview
            const outNode = useGraphStore.getState().nodes.find(n => n.id === outId)
            if (outNode?.data?.url) {
              const entry: OutputEntry = {
                id: outId,
                url: String(outNode.data.url),
                sourceUrl: String(outNode.data.sourceUrl || ''),
                mediaId: String(outNode.data.mediaId || ''),
                model,
                createdAt: Date.now(),
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
        window.$message?.success?.(actualLoopCount > 1 ? `成功生成 ${okCount} 张图片` : '图片生成成功')
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
  }, [id, model, size, quality, loopCount, prompt, cameraPreset, activeStyleId, getRefImages])

  return (
    <div
      className={`rounded-xl border transition-shadow ${
        selected ? 'ring-2 ring-amber-500/40 shadow-lg shadow-amber-500/20 border-amber-500/50' : 'border-[var(--border-color)] shadow-sm hover:shadow-md'
      } bg-[var(--bg-primary)]`}
      style={{ width: 420, borderTop: '3px solid #f59e0b' }}
      onMouseEnter={() => setShowActions(true)}
      onMouseLeave={() => setShowActions(false)}
      onClick={e => e.stopPropagation()}
    >
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 bg-amber-500/10 rounded-t-xl">
        <span className="text-xs font-medium text-[var(--text-primary)]">
          {d?.label || '图片生成'}
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
          mode="image"
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
            maxRefImages={caps.maxRefImages}
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
            sizeOptions={sizeOptions}
            size={size}
            onSizeChange={handleSizeChange}
            qualityOptions={qualityOptions}
            quality={quality}
            onQualityChange={handleQualityChange}
            qualityLabel={qualityLabel}
            cameraPreset={cameraPreset}
            onCameraPresetChange={handleCameraChange}
            loopCount={loopCount}
            onLoopCountChange={handleLoopCountChange}
            onGenerate={handleGenerate}
            loading={loading}
            disabled={false}
          />
        </div>
      </div>

      {/* Connection handles */}
      <TapNodeHandle type="target" position={Position.Left} id="left" />
      <TapNodeHandle type="source" position={Position.Right} id="right" />
    </div>
  )
})
