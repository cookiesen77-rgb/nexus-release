import React, { memo, useState, useCallback, useMemo, useRef } from 'react'
import { ArrowUp, Camera, ChevronDown, Loader2, Plus, Sparkles, Settings2 } from 'lucide-react'
import { useGraphStore } from '@/graph/store'
import { IMAGE_MODELS, VIDEO_MODELS, DEFAULT_IMAGE_MODEL, DEFAULT_VIDEO_MODEL } from '@/config/models'
import { useSettingsStore } from '@/store/settings'
import { usePresetsStore } from '@/store/presets'
import { CAMERA_PRESETS } from '@/lib/cameraControl/presets'
import { generateImageFromConfigNode } from '@/lib/workflow/image'
import { generateVideoFromConfigNode } from '@/lib/workflow/video'
import { callAiAssistant } from '@/lib/nexusApi'
import { inferPolishModeFromText, buildPolishUserText, buildPolishSystemPrompt } from '@/lib/polish'
import { getNodeSize } from '@/graph/nodeSizing'

type PanelMode = 'image' | 'video' | null

const STYLE_PRESETS = [
  { id: 'anime', name: '动漫', suffix: 'anime style, vibrant colors' },
  { id: 'realistic', name: '写实', suffix: 'photorealistic, detailed, 8k' },
  { id: 'oil', name: '油画', suffix: 'oil painting style, rich textures' },
  { id: 'watercolor', name: '水彩', suffix: 'watercolor painting, soft edges' },
  { id: 'manga', name: '漫画', suffix: 'manga style, black and white ink' },
  { id: '3d', name: '3D', suffix: '3D render, octane render, detailed' },
  { id: 'pixel', name: '像素', suffix: 'pixel art, retro game style' },
]

export default memo(function CanvasBottomPanel() {
  const selectedNodeId = useGraphStore(s => s.selectedNodeId)
  const selectedNode = useGraphStore(s => {
    if (!s.selectedNodeId) return null
    return s.nodes.find(n => n.id === s.selectedNodeId) || null
  })

  const mode: PanelMode = useMemo(() => {
    if (!selectedNode) return null
    if (selectedNode.type === 'image') return 'image'
    if (selectedNode.type === 'video') return 'video'
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
  const defaultModel = useSettingsStore(s => s.defaultImageModel) || DEFAULT_IMAGE_MODEL
  const [model, setModel] = useState(nodeData?.params?.model || defaultModel)
  const [size, setSize] = useState(nodeData?.params?.aspectRatio || '3:4')
  const [quality, setQuality] = useState(nodeData?.params?.imageSize || '2K')
  const [prompt, setPrompt] = useState(nodeData?.prompt || '')
  const [loading, setLoading] = useState(false)
  const [polishing, setPolishing] = useState(false)
  const [activeStyle, setActiveStyle] = useState<string | null>(null)
  const [cameraPreset, setCameraPreset] = useState<string | undefined>(nodeData?.cameraControl?.cameraKey)
  const [loopCount, setLoopCount] = useState(1)
  const [showAdvanced, setShowAdvanced] = useState(false)

  const modelCfg = useMemo(() => (IMAGE_MODELS as any[]).find((m: any) => m.key === model) || IMAGE_MODELS[0], [model]) as any
  const sizeOptions = useMemo(() => (modelCfg?.sizes || ['1:1','16:9','9:16','4:3','3:4']).map((s: any) => typeof s === 'string' ? { key: s, label: s } : s), [modelCfg])
  const qualityOptions = useMemo(() => modelCfg?.qualities || [], [modelCfg])

  const handleGenerate = useCallback(async () => {
    if (!prompt.trim() && !nodeData?.url) { window.$message?.warning?.('请输入描述'); return }
    setLoading(true)
    try {
      const store = useGraphStore.getState()
      const node = store.nodes.find(n => n.id === nodeId)
      if (!node) throw new Error('节点不存在')

      let effectivePrompt = prompt.trim()
      if (activeStyle) {
        const style = STYLE_PRESETS.find(s => s.id === activeStyle)
        if (style) effectivePrompt += ', ' + style.suffix
      }
      if (cameraPreset) {
        const preset = CAMERA_PRESETS.find(p => p.name === cameraPreset)
        if (preset) effectivePrompt += ', ' + preset.promptSuffix
      }

      // 创建临时 config 节点用于调用生成 API
      const configId = store.addNode('imageConfig', { x: -9999, y: -9999 }, {
        model, size, quality, prompt: effectivePrompt, loopCount,
        _inlinePrompt: effectivePrompt,
        _inlineRefImages: nodeData?.url ? [nodeData.url] : [],
      })

      // 如果当前节点有内容，连接作为参考图
      if (nodeData?.url) {
        store.addEdge(nodeId, configId, { sourceHandle: 'right', targetHandle: 'left' })
      }

      await generateImageFromConfigNode(configId, { model, size, quality })

      // 获取结果
      const configNode = store.nodes.find(n => n.id === configId)
      const outputId = (configNode?.data as any)?.outputNodeId
      const outputNode = outputId ? store.nodes.find(n => n.id === outputId) : null

      // 如果原节点是空的，直接把结果写入原节点
      if (!nodeData?.url && outputNode?.data?.url) {
        store.updateNode(nodeId, { data: { url: outputNode.data.url, sourceUrl: (outputNode.data as any).sourceUrl, prompt: effectivePrompt, params: { model, aspectRatio: size, imageSize: quality } } })
        // 清理临时节点
        if (outputId) store.removeNode(outputId)
      }
      // 清理临时 config
      store.removeNode(configId)

      window.$message?.success?.('图片生成成功')
    } catch (err: any) {
      window.$message?.error?.(err?.message || '生成失败')
    } finally {
      setLoading(false)
    }
  }, [nodeId, nodeData?.url, model, size, quality, prompt, loopCount, activeStyle, cameraPreset])

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
    <PanelShell>
      {/* 风格预设横排 */}
      <div className="flex items-center gap-1.5 px-4 pt-3 pb-1 overflow-x-auto scrollbar-hide">
        <button
          className="flex flex-col items-center gap-0.5 px-2.5 py-1.5 rounded-lg border border-dashed border-white/20 hover:border-white/40 transition-colors shrink-0"
          onClick={() => setActiveStyle(null)}
        >
          <Plus size={12} className="text-white/40" />
          <span className="text-[9px] text-white/40">风格</span>
        </button>
        <button className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-white/10 hover:bg-white/15 transition-colors shrink-0">
          <Sparkles size={12} className="text-white/60" />
        </button>
        {STYLE_PRESETS.map(s => (
          <button
            key={s.id}
            onClick={() => setActiveStyle(activeStyle === s.id ? null : s.id)}
            className={`px-3 py-1.5 rounded-lg text-xs shrink-0 transition-colors ${
              activeStyle === s.id
                ? 'bg-blue-600 text-white'
                : 'bg-white/8 text-white/70 hover:bg-white/12'
            }`}
          >
            {s.name}
          </button>
        ))}
      </div>

      {/* 提示词输入 */}
      <div className="px-4 py-2">
        <div className="relative">
          <textarea
            value={prompt}
            onChange={e => setPrompt(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleGenerate() } }}
            placeholder="输入描述或按 '/' 呼出指令（Enter 发送，Shift+Enter 换行，⌘/Ctrl+I 魔法选择）"
            rows={2}
            className="w-full bg-transparent text-sm text-white/90 placeholder:text-white/25 resize-none outline-none pr-20"
            style={{ minHeight: 36, maxHeight: 100 }}
            disabled={loading}
          />
          <button
            onClick={handlePolish}
            disabled={!prompt.trim() || polishing || loading}
            className="absolute bottom-1 right-1 px-2 py-0.5 text-xs rounded bg-white/8 text-white/50 hover:text-white/80 hover:bg-white/15 transition-colors disabled:opacity-30 flex items-center gap-1"
          >
            {polishing ? <Loader2 size={10} className="animate-spin" /> : <><Sparkles size={10} /> AI润色</>}
          </button>
        </div>
      </div>

      {/* 底部参数行 */}
      <div className="flex items-center gap-1.5 px-4 pb-3 pt-1 flex-wrap">
        <MiniSelect value={model} options={(IMAGE_MODELS as any[]).map(m => ({ value: m.key, label: m.label }))} onChange={setModel} icon="🎨" maxW={160} />
        <MiniSelect value={size} options={sizeOptions.map((o: any) => ({ value: o.key, label: o.label }))} onChange={setSize} icon="□" maxW={80} />
        {qualityOptions.length > 0 && (
          <>
            <span className="text-white/20 text-xs">·</span>
            <MiniSelect value={quality} options={qualityOptions.map((o: any) => ({ value: o.key, label: o.label }))} onChange={setQuality} maxW={55} />
          </>
        )}
        <button
          className={`flex items-center gap-1 px-2 py-1 text-xs rounded-md transition-colors ${cameraPreset ? 'bg-white/20 text-white' : 'text-white/40 hover:text-white/70'}`}
          onClick={() => setCameraPreset(cameraPreset ? undefined : CAMERA_PRESETS[0]?.name)}
        >
          <Camera size={12} />
          <span className="hidden sm:inline text-[11px]">{cameraPreset || '摄影机控制'}</span>
        </button>
        <MiniSelect value={String(loopCount)} options={[1,2,3,4].map(n => ({ value: String(n), label: `${n}x` }))} onChange={v => setLoopCount(Number(v))} maxW={50} />

        <div className="flex-1" />

        <button onClick={() => setShowAdvanced(p => !p)} className="p-1.5 rounded-md text-white/30 hover:text-white/60 transition-colors">
          <Settings2 size={14} />
        </button>
        <button
          onClick={handleGenerate}
          disabled={loading}
          className="w-8 h-8 rounded-full flex items-center justify-center bg-blue-600 text-white hover:bg-blue-500 transition-colors disabled:opacity-40"
        >
          {loading ? <Loader2 size={14} className="animate-spin" /> : <ArrowUp size={16} />}
        </button>
      </div>

      {showAdvanced && (
        <div className="px-4 pb-3 border-t border-white/5 pt-2 text-xs text-white/40">
          高级设置（即将推出）
        </div>
      )}
    </PanelShell>
  )
}

// ======================== Video Panel ========================

function VideoPanel({ nodeId, nodeData }: { nodeId: string; nodeData: any }) {
  const defaultModel = useSettingsStore(s => s.defaultVideoModel) || DEFAULT_VIDEO_MODEL
  const [model, setModel] = useState(nodeData?.params?.model || defaultModel)
  const [ratio, setRatio] = useState(nodeData?.params?.aspectRatio || '16:9')
  const [prompt, setPrompt] = useState(nodeData?.prompt || '')
  const [loading, setLoading] = useState(false)

  const modelCfg = useMemo(() => (VIDEO_MODELS as any[]).find((m: any) => m.key === model) || VIDEO_MODELS[0], [model]) as any
  const ratioOptions = useMemo(() => (modelCfg?.ratios || ['16:9','9:16']).map((r: string) => ({ key: r, label: r })), [modelCfg])
  const durOptions = useMemo(() => modelCfg?.durs || [{ label: '5s', key: 5 }], [modelCfg])
  const [dur, setDur] = useState(nodeData?.params?.duration || durOptions[0]?.key || 5)
  const resOptions = useMemo(() => (modelCfg?.resolutions || []).map((r: string) => ({ key: r, label: r })), [modelCfg])
  const [resolution, setResolution] = useState(nodeData?.params?.resolution || resOptions[0]?.key || '1080p')

  const handleGenerate = useCallback(async () => {
    if (!prompt.trim()) { window.$message?.warning?.('请输入描述'); return }
    setLoading(true)
    try {
      const store = useGraphStore.getState()
      const node = store.nodes.find(n => n.id === nodeId)
      if (!node) throw new Error('节点不存在')

      // 创建临时 config
      const configId = store.addNode('videoConfig', { x: -9999, y: -9999 }, {
        model, ratio, dur, resolution, prompt, _inlinePrompt: prompt,
        _inlineRefImages: nodeData?.url ? [nodeData.url] : [],
      })
      if (nodeData?.url) {
        store.addEdge(nodeId, configId, { sourceHandle: 'right', targetHandle: 'left' })
      }

      await generateVideoFromConfigNode(configId, { model, ratio, duration: dur })

      const configNode = store.nodes.find(n => n.id === configId)
      const outputId = (configNode?.data as any)?.outputNodeId
      const outputNode = outputId ? store.nodes.find(n => n.id === outputId) : null

      if (!nodeData?.url && outputNode?.data?.url) {
        store.updateNode(nodeId, { data: { url: outputNode.data.url, sourceUrl: (outputNode.data as any).sourceUrl, prompt, params: { model, aspectRatio: ratio, duration: dur, resolution } } })
        if (outputId) store.removeNode(outputId)
      }
      store.removeNode(configId)

      window.$message?.success?.('视频生成成功')
    } catch (err: any) {
      window.$message?.error?.(err?.message || '生成失败')
    } finally {
      setLoading(false)
    }
  }, [nodeId, nodeData?.url, model, ratio, dur, resolution, prompt])

  return (
    <PanelShell>
      {/* 类型标签 */}
      <div className="flex items-center gap-2 px-4 pt-3 pb-1">
        <span className="text-xs font-medium text-white/50 bg-white/8 px-2 py-0.5 rounded">文生视频</span>
        <button className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-white/8 hover:bg-white/12 transition-colors shrink-0">
          <Sparkles size={12} className="text-white/50" />
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
          className="w-full bg-transparent text-sm text-white/90 placeholder:text-white/25 resize-none outline-none"
          style={{ minHeight: 36, maxHeight: 100 }}
          disabled={loading}
        />
      </div>

      {/* 参数行 */}
      <div className="flex items-center gap-1.5 px-4 pb-3 pt-1 flex-wrap">
        <MiniSelect value={model} options={(VIDEO_MODELS as any[]).map(m => ({ value: m.key, label: m.label }))} onChange={setModel} icon="🎬" maxW={160} />
        <MiniSelect value={ratio} options={ratioOptions.map((o: any) => ({ value: o.key, label: o.label }))} onChange={setRatio} icon="□" maxW={65} />
        {resOptions.length > 0 && (
          <>
            <span className="text-white/20 text-xs">·</span>
            <MiniSelect value={resolution} options={resOptions.map((o: any) => ({ value: o.key, label: o.label }))} onChange={setResolution} maxW={70} />
          </>
        )}
        <span className="text-white/20 text-xs">·</span>
        <MiniSelect value={String(dur)} options={durOptions.map((o: any) => ({ value: String(o.key), label: o.label }))} onChange={v => setDur(Number(v))} maxW={55} />
        {modelCfg?.supportsAudio && <span className="text-white/30 text-xs">🔊</span>}
        <MiniSelect value="1" options={[{value:'1',label:'1x'},{value:'2',label:'2x'}]} onChange={() => {}} maxW={48} />

        <div className="flex-1" />

        <button
          onClick={handleGenerate}
          disabled={loading}
          className="w-8 h-8 rounded-full flex items-center justify-center bg-blue-600 text-white hover:bg-blue-500 transition-colors disabled:opacity-40"
        >
          {loading ? <Loader2 size={14} className="animate-spin" /> : <ArrowUp size={16} />}
        </button>
      </div>
    </PanelShell>
  )
}

// ======================== Shared Components ========================

function PanelShell({ children }: { children: React.ReactNode }) {
  return (
    <div
      className="rounded-2xl overflow-hidden"
      style={{ backgroundColor: 'rgba(20,20,20,0.88)', backdropFilter: 'blur(20px)', border: '1px solid rgba(255,255,255,0.06)' }}
      onClick={e => e.stopPropagation()}
      onPointerDown={e => e.stopPropagation()}
    >
      {children}
    </div>
  )
}

function MiniSelect({ value, options, onChange, icon, maxW }: {
  value: string; options: Array<{ value: string; label: string }>; onChange: (v: string) => void; icon?: string; maxW?: number
}) {
  const display = options.find(o => o.value === value)?.label || value
  const truncated = display.length > 16 ? display.slice(0, 16) + '…' : display
  return (
    <div className="relative" style={{ maxWidth: maxW }}>
      <select
        value={value}
        onChange={e => { e.stopPropagation(); onChange(e.target.value) }}
        onClick={e => e.stopPropagation()}
        className="absolute inset-0 opacity-0 cursor-pointer"
      >
        {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
      <div className="flex items-center gap-1 px-2 py-1 text-[11px] rounded-md text-white/60 cursor-pointer hover:text-white/80 hover:bg-white/8 transition-colors whitespace-nowrap overflow-hidden">
        {icon && <span className="text-[10px]">{icon}</span>}
        <span className="truncate">{truncated}</span>
        <ChevronDown size={9} className="opacity-40 shrink-0" />
      </div>
    </div>
  )
}
