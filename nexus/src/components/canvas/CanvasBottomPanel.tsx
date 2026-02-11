import React, { memo, useState, useCallback, useMemo, useEffect } from 'react'
import { ArrowUp, Camera, ChevronDown, Loader2, Plus, Sparkles } from 'lucide-react'
import { useGraphStore } from '@/graph/store'
import { IMAGE_MODELS, VIDEO_MODELS } from '@/config/models'
import { getImageModelCaps } from '@/lib/modelCaps'
import { getVideoModelCaps } from '@/lib/modelCaps'
import { useSettingsStore } from '@/store/settings'
import { usePresetsStore } from '@/store/presets'
import { CAMERA_PRESETS } from '@/lib/cameraControl/presets'
import { generateImageFromConfigNode } from '@/lib/workflow/image'
import { generateVideoFromConfigNode } from '@/lib/workflow/video'
import { callAiAssistant } from '@/lib/nexusApi'
import { inferPolishModeFromText, buildPolishUserText, buildPolishSystemPrompt } from '@/lib/polish'

type PanelMode = 'image' | 'video' | null

export default memo(function CanvasBottomPanel() {
  const selectedNodeId = useGraphStore(s => s.selectedNodeId)
  const selectedNode = useGraphStore(s => {
    if (!s.selectedNodeId) return null
    return s.nodes.find(n => n.id === s.selectedNodeId) || null
  })

  const mode: PanelMode = useMemo(() => {
    if (!selectedNode) return null
    const t = selectedNode.type
    // 只在纯内容节点选中时显示底部面板
    // imageConfig/videoConfig 自带配置 UI，不需要底部面板
    if (t === 'image') return 'image'
    if (t === 'video') return 'video'
    return null
  }, [selectedNode?.type])

  if (!mode || !selectedNode) return null

  return (
    <div className="pointer-events-auto absolute bottom-4 left-1/2 -translate-x-1/2 z-40 w-full max-w-[680px] px-4">
      {mode === 'image' ? (
        <ImagePanel nodeId={selectedNode.id} nodeData={selectedNode.data as any} />
      ) : (
        <VideoPanel nodeId={selectedNode.id} nodeData={selectedNode.data as any} />
      )}
    </div>
  )
})

// ======================== Image Panel ========================

function ImagePanel({ nodeId, nodeData }: { nodeId: string; nodeData: any }) {
  const defaultModel = IMAGE_MODELS[0]?.key || ''
  const [model, setModel] = useState(nodeData?.model || defaultModel)
  const [size, setSize] = useState(nodeData?.size || '3:4')
  const [quality, setQuality] = useState(nodeData?.quality || '2K')
  const [prompt, setPrompt] = useState(nodeData?.prompt || '')
  const [loading, setLoading] = useState(false)
  const [polishing, setPolishing] = useState(false)
  const [cameraPreset, setCameraPreset] = useState<string | undefined>(nodeData?.cameraPreset)
  const [loopCount, setLoopCount] = useState(1)

  const modelCfg = useMemo(() => IMAGE_MODELS.find((m: any) => m.key === model) || IMAGE_MODELS[0], [model]) as any
  const sizeOptions = useMemo(() => (modelCfg?.sizes || ['1:1','16:9','9:16','4:3','3:4']).map((s: any) => typeof s === 'string' ? { key: s, label: s } : s), [modelCfg])
  const qualityOptions = useMemo(() => modelCfg?.qualities || [], [modelCfg])

  const handleGenerate = useCallback(async () => {
    if (!prompt.trim()) { window.$message?.warning?.('请输入描述'); return }
    setLoading(true)
    try {
      const store = useGraphStore.getState()
      // 确保节点有配置数据
      let configId = nodeId
      const node = store.nodes.find(n => n.id === nodeId)
      if (node?.type === 'image') {
        // image节点不是config节点，需要创建一个临时config
        configId = store.addNode('imageConfig', { x: (node.x || 0) + 400, y: node.y || 0 }, {
          model, size, quality, prompt, loopCount, cameraPreset,
          _inlinePrompt: prompt,
        })
        store.addEdge(nodeId, configId, { sourceHandle: 'right', targetHandle: 'left' })
      } else {
        store.updateNode(configId, { data: { model, size, quality, prompt, loopCount, cameraPreset, _inlinePrompt: prompt } })
      }
      await generateImageFromConfigNode(configId, { model, size, quality })
      window.$message?.success?.('图片生成成功')
    } catch (err: any) {
      window.$message?.error?.(err?.message || '生成失败')
    } finally {
      setLoading(false)
    }
  }, [nodeId, model, size, quality, prompt, loopCount, cameraPreset])

  const handlePolish = useCallback(async () => {
    if (!prompt.trim() || polishing) return
    setPolishing(true)
    try {
      const aiModel = useSettingsStore.getState().aiAssistantModel
      const m = inferPolishModeFromText(prompt)
      const userText = buildPolishUserText({ mode: m, userText: prompt, promptTemplate: null, upstreamInputs: { text: [], images: [] } })
      const systemPrompt = buildPolishSystemPrompt(m)
      const polished = await callAiAssistant(aiModel, [{ role: 'system', content: systemPrompt }, { role: 'user', content: userText }], { filterThinking: true })
      if (polished) { setPrompt(polished); window.$message?.success?.('润色完成') }
    } catch (err: any) {
      window.$message?.error?.(`润色失败: ${err?.message || ''}`)
    } finally {
      setPolishing(false)
    }
  }, [prompt, polishing])

  return (
    <div
      className="rounded-2xl overflow-hidden"
      style={{ backgroundColor: 'rgba(20,20,20,0.85)', backdropFilter: 'blur(20px)', border: '1px solid rgba(255,255,255,0.08)' }}
      onClick={e => e.stopPropagation()}
      onPointerDown={e => e.stopPropagation()}
    >
      {/* 风格预设行 */}
      <div className="flex items-center gap-2 px-4 pt-3 pb-1 overflow-x-auto scrollbar-hide">
        <button className="flex flex-col items-center gap-1 px-2 py-1.5 rounded-lg border border-dashed border-white/20 hover:border-white/40 transition-colors shrink-0" onClick={() => {}}>
          <Plus size={14} className="text-white/50" />
          <span className="text-[9px] text-white/40">风格</span>
        </button>
        <button className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-white/10 hover:bg-white/15 transition-colors shrink-0">
          <Sparkles size={12} className="text-white/70" />
        </button>
      </div>

      {/* 提示词输入 */}
      <div className="px-4 py-2">
        <textarea
          value={prompt}
          onChange={e => setPrompt(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleGenerate() } }}
          placeholder="输入描述或按 '/' 呼出指令（Enter 发送，Shift+Enter 换行，⌘/Ctrl+I 魔法选择）"
          rows={2}
          className="w-full bg-transparent text-sm text-white/90 placeholder:text-white/30 resize-none outline-none"
          style={{ minHeight: 40, maxHeight: 100 }}
          disabled={loading}
        />
      </div>

      {/* 底部工具栏: 模型 | 尺寸·画质 | 相机 | 次数 | 积分 | 发送 */}
      <div className="flex items-center gap-2 px-4 pb-3 pt-1">
        {/* 模型选择 */}
        <CompactSelect
          value={model}
          options={IMAGE_MODELS.map((m: any) => ({ value: m.key, label: m.label }))}
          onChange={setModel}
          icon="🎨"
          maxWidth={160}
        />

        {/* 尺寸 + 画质 */}
        <CompactSelect
          value={size}
          options={sizeOptions.map((o: any) => ({ value: o.key, label: o.label }))}
          onChange={setSize}
          icon="□"
          maxWidth={90}
        />
        {qualityOptions.length > 0 && (
          <span className="text-white/30 text-xs">·</span>
        )}
        {qualityOptions.length > 0 && (
          <CompactSelect
            value={quality}
            options={qualityOptions.map((o: any) => ({ value: o.key, label: o.label }))}
            onChange={setQuality}
            maxWidth={60}
          />
        )}

        {/* 相机 */}
        <button
          className={`flex items-center gap-1 px-2 py-1 text-xs rounded-md transition-colors ${
            cameraPreset ? 'bg-white/20 text-white' : 'text-white/50 hover:text-white/80'
          }`}
          onClick={() => setCameraPreset(cameraPreset ? undefined : CAMERA_PRESETS[0]?.name)}
        >
          <Camera size={12} />
          <span className="hidden sm:inline">{cameraPreset || '摄影机控制'}</span>
        </button>

        {/* 次数 */}
        <CompactSelect
          value={String(loopCount)}
          options={[1,2,3,4].map(n => ({ value: String(n), label: `${n}x` }))}
          onChange={v => setLoopCount(Number(v))}
          maxWidth={52}
        />

        <div className="flex-1" />

        {/* AI 润色 */}
        <button
          onClick={handlePolish}
          disabled={!prompt.trim() || polishing}
          className="p-1.5 rounded-md text-white/40 hover:text-white/80 transition-colors disabled:opacity-30"
          title="AI 润色"
        >
          {polishing ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />}
        </button>

        {/* 发送按钮 */}
        <button
          onClick={handleGenerate}
          disabled={loading}
          className="w-8 h-8 rounded-full flex items-center justify-center bg-[var(--accent-color)] text-white hover:opacity-90 transition-opacity disabled:opacity-40"
        >
          {loading ? <Loader2 size={14} className="animate-spin" /> : <ArrowUp size={16} />}
        </button>
      </div>
    </div>
  )
}

// ======================== Video Panel ========================

function VideoPanel({ nodeId, nodeData }: { nodeId: string; nodeData: any }) {
  const defaultModel = VIDEO_MODELS[0]?.key || ''
  const [model, setModel] = useState(nodeData?.model || defaultModel)
  const [ratio, setRatio] = useState(nodeData?.ratio || '16:9')
  const [prompt, setPrompt] = useState(nodeData?.prompt || '')
  const [loading, setLoading] = useState(false)

  const modelCfg = useMemo(() => VIDEO_MODELS.find((m: any) => m.key === model) || VIDEO_MODELS[0], [model]) as any
  const ratioOptions = useMemo(() => (modelCfg?.ratios || ['16:9','9:16']).map((r: string) => ({ key: r, label: r })), [modelCfg])
  const durOptions = useMemo(() => modelCfg?.durs || [{ label: '5 秒', key: 5 }], [modelCfg])
  const [dur, setDur] = useState(nodeData?.dur || durOptions[0]?.key || 5)

  const handleGenerate = useCallback(async () => {
    if (!prompt.trim()) { window.$message?.warning?.('请输入描述'); return }
    setLoading(true)
    try {
      const store = useGraphStore.getState()
      let configId = nodeId
      const node = store.nodes.find(n => n.id === nodeId)
      if (node?.type === 'video') {
        configId = store.addNode('videoConfig', { x: (node.x || 0) + 400, y: node.y || 0 }, {
          model, ratio, dur, prompt, _inlinePrompt: prompt,
        })
        store.addEdge(nodeId, configId, { sourceHandle: 'right', targetHandle: 'left' })
      } else {
        store.updateNode(configId, { data: { model, ratio, dur, prompt, _inlinePrompt: prompt } })
      }
      await generateVideoFromConfigNode(configId, { model, ratio, duration: dur })
      window.$message?.success?.('视频生成成功')
    } catch (err: any) {
      window.$message?.error?.(err?.message || '生成失败')
    } finally {
      setLoading(false)
    }
  }, [nodeId, model, ratio, dur, prompt])

  return (
    <div
      className="rounded-2xl overflow-hidden"
      style={{ backgroundColor: 'rgba(20,20,20,0.85)', backdropFilter: 'blur(20px)', border: '1px solid rgba(255,255,255,0.08)' }}
      onClick={e => e.stopPropagation()}
      onPointerDown={e => e.stopPropagation()}
    >
      {/* 标签 */}
      <div className="px-4 pt-3 pb-1">
        <span className="text-xs font-medium text-white/60 bg-white/10 px-2 py-0.5 rounded">文生视频</span>
      </div>

      {/* 风格 */}
      <div className="flex items-center gap-2 px-4 py-1">
        <button className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-white/10 hover:bg-white/15 transition-colors shrink-0">
          <Sparkles size={12} className="text-white/70" />
        </button>
      </div>

      {/* 提示词 */}
      <div className="px-4 py-2">
        <textarea
          value={prompt}
          onChange={e => setPrompt(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleGenerate() } }}
          placeholder="描述你想要生成的内容，并在下方调整生成参数。(Enter 生成，Shift+Enter 换行，⌘/Ctrl+I 魔法选择）"
          rows={2}
          className="w-full bg-transparent text-sm text-white/90 placeholder:text-white/30 resize-none outline-none"
          style={{ minHeight: 40, maxHeight: 100 }}
          disabled={loading}
        />
      </div>

      {/* 底部工具栏 */}
      <div className="flex items-center gap-2 px-4 pb-3 pt-1">
        <CompactSelect
          value={model}
          options={VIDEO_MODELS.map((m: any) => ({ value: m.key, label: m.label }))}
          onChange={setModel}
          icon="🎬"
          maxWidth={160}
        />

        <CompactSelect
          value={ratio}
          options={ratioOptions.map((o: any) => ({ value: o.key, label: o.label }))}
          onChange={setRatio}
          icon="□"
          maxWidth={70}
        />

        <span className="text-white/30 text-xs">·</span>

        {durOptions.length > 0 && (
          <CompactSelect
            value={String(dur)}
            options={durOptions.map((o: any) => ({ value: String(o.key), label: o.label }))}
            onChange={v => setDur(Number(v))}
            maxWidth={65}
          />
        )}

        <div className="flex-1" />

        <button
          onClick={handleGenerate}
          disabled={loading}
          className="w-8 h-8 rounded-full flex items-center justify-center bg-[var(--accent-color)] text-white hover:opacity-90 transition-opacity disabled:opacity-40"
        >
          {loading ? <Loader2 size={14} className="animate-spin" /> : <ArrowUp size={16} />}
        </button>
      </div>
    </div>
  )
}

// ======================== Compact Select ========================

function CompactSelect({ value, options, onChange, icon, maxWidth }: {
  value: string; options: Array<{ value: string; label: string }>; onChange: (v: string) => void; icon?: string; maxWidth?: number
}) {
  const display = options.find(o => o.value === value)?.label || value
  const truncated = display.length > 14 ? display.slice(0, 14) + '…' : display
  return (
    <div className="relative" style={{ maxWidth }}>
      <select
        value={value}
        onChange={e => { e.stopPropagation(); onChange(e.target.value) }}
        onClick={e => e.stopPropagation()}
        className="absolute inset-0 opacity-0 cursor-pointer"
      >
        {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
      <div className="flex items-center gap-1 px-2 py-1 text-xs rounded-md text-white/70 cursor-pointer hover:text-white/90 hover:bg-white/10 transition-colors whitespace-nowrap overflow-hidden">
        {icon && <span className="opacity-60 text-[10px]">{icon}</span>}
        <span className="truncate">{truncated}</span>
        <ChevronDown size={10} className="opacity-40 shrink-0" />
      </div>
    </div>
  )
}
