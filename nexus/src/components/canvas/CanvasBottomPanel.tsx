import React, { memo, useState, useCallback, useMemo, useRef, useEffect } from 'react'
import { ArrowUp, Camera, ChevronDown, ChevronLeft, ChevronRight, Loader2, Sparkles } from 'lucide-react'
import { useGraphStore } from '@/graph/store'
import { IMAGE_MODELS, VIDEO_MODELS, DEFAULT_IMAGE_MODEL, DEFAULT_VIDEO_MODEL } from '@/config/models'
import { useSettingsStore } from '@/store/settings'
import { usePresetsStore } from '@/store/presets'
import { CAMERA_PRESETS, CAMERA_BODIES, CAMERA_LENSES, FOCAL_LENGTHS, APERTURES } from '@/lib/cameraControl/presets'
import { generateImageFromConfigNode } from '@/lib/workflow/image'
import { generateVideoFromConfigNode } from '@/lib/workflow/video'
import { callAiAssistant } from '@/lib/nexusApi'
import { inferPolishModeFromText, buildPolishUserText, buildPolishSystemPrompt } from '@/lib/polish'

type PanelMode = 'image' | 'video' | 'text' | null

const STYLE_PRESETS = [
  { id: 'anime', name: '动漫', suffix: 'anime style, vibrant colors' },
  { id: 'realistic', name: '写实', suffix: 'photorealistic, detailed, 8k' },
  { id: 'oil', name: '油画', suffix: 'oil painting style, rich textures' },
  { id: 'watercolor', name: '水彩', suffix: 'watercolor painting, soft edges' },
  { id: 'manga', name: '漫画', suffix: 'manga style, black and white ink' },
  { id: '3d', name: '3D', suffix: '3D render, octane render, detailed' },
  { id: 'pixel', name: '像素', suffix: 'pixel art, retro game style' },
  { id: 'cinematic', name: '电影', suffix: 'cinematic lighting, dramatic atmosphere, film grain, anamorphic lens' },
  { id: 'ghibli', name: '吉卜力', suffix: 'Studio Ghibli style, soft pastel, hand-drawn, whimsical' },
  { id: 'cyberpunk', name: '赛博朋克', suffix: 'cyberpunk aesthetic, neon lights, dark futuristic cityscape, rain' },
  { id: 'ukiyoe', name: '浮世绘', suffix: 'ukiyo-e Japanese woodblock print style, flat colors, bold outlines' },
  { id: 'sketch', name: '素描', suffix: 'pencil sketch, graphite drawing, crosshatch shading, paper texture' },
  { id: 'impressionist', name: '印象派', suffix: 'impressionist painting, visible brushstrokes, light and color' },
  { id: 'surreal', name: '超现实', suffix: 'surrealism art, dreamlike, Salvador Dali inspired, impossible geometry' },
  { id: 'chinese', name: '国风', suffix: 'traditional Chinese ink wash painting, gongbi meticulous style, silk texture' },
  { id: 'retro', name: '复古', suffix: 'vintage retro aesthetic, 70s color palette, film photography, faded tones' },
  { id: 'fantasy', name: '奇幻', suffix: 'high fantasy illustration, magical atmosphere, epic lighting, detailed' },
  { id: 'minimalist', name: '极简', suffix: 'minimalist design, clean lines, negative space, simple composition' },
  { id: 'pop', name: '波普', suffix: 'pop art style, bold colors, halftone dots, Andy Warhol inspired' },
  { id: 'dark', name: '暗黑', suffix: 'dark gothic aesthetic, moody lighting, dramatic shadows, dark fantasy' },
]

export default memo(function CanvasBottomPanel() {
  const selectedNode = useGraphStore(s => {
    if (!s.selectedNodeId) return null
    return s.nodes.find(n => n.id === s.selectedNodeId) || null
  })
  const [pos, setPos] = useState<{ left: number; top: number; width: number } | null>(null)
  const rafRef = useRef(0)

  const mode: PanelMode = useMemo(() => {
    if (!selectedNode) return null
    if (selectedNode.type === 'image' || selectedNode.type === 'imageConfig') return 'image'
    if (selectedNode.type === 'video' || selectedNode.type === 'videoConfig') return 'video'
    if (selectedNode.type === 'text') return 'text'
    return null
  }, [selectedNode?.type])

  // RAF 轮询节点 DOM 位置，确保实时跟随缩放/拖拽
  useEffect(() => {
    if (!selectedNode) { setPos(null); return }
    let active = true
    const tick = () => {
      if (!active) return
      const nodeEl = document.querySelector(`[data-id="${selectedNode.id}"]`) as HTMLElement
      const wrapEl = document.querySelector('[data-canvas-wrap]') as HTMLElement
      if (nodeEl && wrapEl) {
        const nodeRect = nodeEl.getBoundingClientRect()
        const wrapRect = wrapEl.getBoundingClientRect()
        const left = nodeRect.left - wrapRect.left + nodeRect.width / 2
        const top = nodeRect.bottom - wrapRect.top + 8
        const width = Math.max(nodeRect.width, 420)
        setPos(prev => {
          if (prev && Math.abs(prev.left - left) < 0.5 && Math.abs(prev.top - top) < 0.5 && Math.abs(prev.width - width) < 0.5) return prev
          return { left, top, width }
        })
      }
      rafRef.current = requestAnimationFrame(tick)
    }
    rafRef.current = requestAnimationFrame(tick)
    return () => { active = false; cancelAnimationFrame(rafRef.current) }
  }, [selectedNode?.id])

  if (!mode || !selectedNode || !pos) return null

  return (
    <div
      className="pointer-events-auto absolute z-40"
      style={{
        left: pos.left,
        top: pos.top,
        width: pos.width,
        transform: 'translateX(-50%)',
      }}
    >
      {mode === 'image' ? (
        <ImagePanel nodeId={selectedNode.id} nodeData={selectedNode.data as any} isConfigNode={selectedNode.type === 'imageConfig'} />
      ) : mode === 'video' ? (
        <VideoPanel nodeId={selectedNode.id} nodeData={selectedNode.data as any} isConfigNode={selectedNode.type === 'videoConfig'} />
      ) : (
        <TextPanel nodeId={selectedNode.id} nodeData={selectedNode.data as any} />
      )}
    </div>
  )
})

// ======================== Image Panel ========================

function ImagePanel({ nodeId, nodeData, isConfigNode }: { nodeId: string; nodeData: any; isConfigNode?: boolean }) {
  const defaultModel = useSettingsStore(s => s.defaultImageModel) || DEFAULT_IMAGE_MODEL
  const [model, setModel] = useState(nodeData?.params?.model || defaultModel)
  const [size, setSize] = useState(nodeData?.params?.aspectRatio || '3:4')
  const [quality, setQuality] = useState(nodeData?.params?.imageSize || '2K')
  const [prompt, setPrompt] = useState(nodeData?.prompt || '')
  const [loading, setLoading] = useState(false)
  const [polishing, setPolishing] = useState(false)
  const [activeStyle, setActiveStyle] = useState<string | null>(null)
  const [cameraOpen, setCameraOpen] = useState(false)
  const [cameraBody, setCameraBody] = useState(0)
  const [cameraLens, setCameraLens] = useState(0)
  const [focalLength, setFocalLength] = useState(1) // 24mm default
  const [aperture, setAperture] = useState(3) // f/4 default
  const [loopCount, setLoopCount] = useState(1)

  const modelCfg = useMemo(() => (IMAGE_MODELS as any[]).find((m: any) => m.key === model) || IMAGE_MODELS[0], [model]) as any
  const sizeOptions = useMemo(() => (modelCfg?.sizes || ['1:1','16:9','9:16','4:3','3:4']).map((s: any) => typeof s === 'string' ? { key: s, label: s } : s), [modelCfg])
  const qualityOptions = useMemo(() => modelCfg?.qualities || [], [modelCfg])

  const buildCameraSuffix = useCallback(() => {
    if (!cameraOpen) return ''
    return [CAMERA_BODIES[cameraBody]?.suffix, CAMERA_LENSES[cameraLens]?.suffix, FOCAL_LENGTHS[focalLength]?.suffix, APERTURES[aperture]?.suffix].filter(Boolean).join(', ')
  }, [cameraOpen, cameraBody, cameraLens, focalLength, aperture])

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
      const camSuffix = buildCameraSuffix()
      if (camSuffix) effectivePrompt += ', ' + camSuffix

      const genCount = Math.max(1, Math.min(4, loopCount))

      for (let i = 0; i < genCount; i++) {
        if (i === 0 && isConfigNode) {
          store.updateNode(nodeId, { data: { model, size, quality, prompt: effectivePrompt, _inlinePrompt: effectivePrompt } })
          store.updateNode(nodeId, { data: { loading: true } })
          await generateImageFromConfigNode(nodeId, { model, size, quality }, { outputNodeId: nodeId, selectOutput: false, markConfigExecuted: false })
          store.updateNode(nodeId, { data: { loading: false, prompt: effectivePrompt, params: { model, aspectRatio: size, imageSize: quality } } })
        } else {
          const offsetX = isConfigNode ? 350 + (i - 1) * 300 : (i === 0 ? 0 : 300 * i)
          const configId = store.addNode('imageConfig', { x: -9999, y: -9999 }, {
            model, size, quality, prompt: effectivePrompt,
            _inlinePrompt: effectivePrompt,
            _inlineRefImages: nodeData?.url ? [nodeData.url] : [],
          })
          if (nodeData?.url) store.addEdge(nodeId, configId, { sourceHandle: 'right', targetHandle: 'left' })
          await generateImageFromConfigNode(configId, { model, size, quality })
          const configNode = store.nodes.find(n => n.id === configId)
          const outputId = (configNode?.data as any)?.outputNodeId
          const outputNode = outputId ? store.nodes.find(n => n.id === outputId) : null
          if (i === 0 && !isConfigNode && !nodeData?.url && outputNode?.data?.url) {
            store.updateNode(nodeId, { data: { url: outputNode.data.url, sourceUrl: (outputNode.data as any).sourceUrl, prompt: effectivePrompt, params: { model, aspectRatio: size, imageSize: quality } } })
            if (outputId) store.removeNode(outputId)
          } else if (outputNode) {
            const pos = { x: (node?.x || 0) + 350 + i * 300, y: node?.y || 0 }
            store.updateNode(outputNode.id, { x: pos.x, y: pos.y })
          }
          store.removeNode(configId)
        }
      }
      window.$message?.success?.(genCount > 1 ? `${genCount} 张图片生成成功` : '图片生成成功')
    } catch (err: any) {
      window.$message?.error?.(err?.message || '生成失败')
    } finally {
      setLoading(false)
    }
  }, [nodeId, nodeData?.url, model, size, quality, prompt, loopCount, activeStyle, buildCameraSuffix, isConfigNode])

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

  const cycleOption = (arr: any[], idx: number, dir: 1 | -1) => ((idx + dir) % arr.length + arr.length) % arr.length

  return (
    <PanelShell>
      {/* 提示词输入 */}
      <div className="px-4 py-2 pt-3">
        <div className="relative">
          <textarea
            value={prompt}
            onChange={e => setPrompt(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleGenerate() } }}
            placeholder="描述你想要生成的内容..."
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
      <div className="flex items-center gap-1.5 px-4 pb-2 pt-1 flex-wrap">
        <MiniSelect value={model} options={(IMAGE_MODELS as any[]).map(m => ({ value: m.key, label: m.label }))} onChange={setModel} icon="🎨" maxW={160} />
        <MiniSelect value={size} options={sizeOptions.map((o: any) => ({ value: o.key, label: o.label }))} onChange={setSize} icon="□" maxW={80} />
        {qualityOptions.length > 0 && (
          <>
            <span className="text-white/20 text-xs">·</span>
            <MiniSelect value={quality} options={qualityOptions.map((o: any) => ({ value: o.key, label: o.label }))} onChange={setQuality} maxW={55} />
          </>
        )}
        <span className="text-white/20 text-xs">·</span>
        {/* 风格下拉 */}
        <MiniSelect
          value={activeStyle || ''}
          options={[{ value: '', label: '无' }, ...STYLE_PRESETS.map(s => ({ value: s.id, label: s.name }))]}
          onChange={v => setActiveStyle(v || null)}
          icon="✦"
          maxW={80}
        />
        <span className="text-white/20 text-xs">·</span>
        {/* 摄影机控制开关 */}
        <button
          className={`flex items-center gap-1 px-2 py-1 text-xs rounded-md transition-colors ${cameraOpen ? 'bg-white/20 text-white' : 'text-white/40 hover:text-white/70'}`}
          onClick={() => setCameraOpen(v => !v)}
        >
          <Camera size={12} />
          <span className="text-[11px]">摄影机</span>
        </button>
        <span className="text-white/20 text-xs">·</span>
        <MiniSelect value={String(loopCount)} options={[1,2,3,4].map(n => ({ value: String(n), label: `${n}张` }))} onChange={v => setLoopCount(Number(v))} maxW={55} />

        <div className="flex-1" />

        <button
          onClick={handleGenerate}
          disabled={loading}
          className="w-8 h-8 rounded-full flex items-center justify-center bg-blue-600 text-white hover:bg-blue-500 transition-colors disabled:opacity-40"
        >
          {loading ? <Loader2 size={14} className="animate-spin" /> : <ArrowUp size={16} />}
        </button>
      </div>

      {/* 摄影机控制面板 */}
      {cameraOpen && (
        <div className="px-4 pb-3 border-t border-white/5 pt-2">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs text-white/50 font-medium">摄影机控制</span>
          </div>
          <div className="grid grid-cols-4 gap-2">
            <CameraColumn label="机身" items={CAMERA_BODIES} index={cameraBody} onChange={setCameraBody} cycle={cycleOption} />
            <CameraColumn label="镜头" items={CAMERA_LENSES} index={cameraLens} onChange={setCameraLens} cycle={cycleOption} />
            <CameraColumn label="焦距" items={FOCAL_LENGTHS} index={focalLength} onChange={setFocalLength} cycle={cycleOption} />
            <CameraColumn label="光圈" items={APERTURES} index={aperture} onChange={setAperture} cycle={cycleOption} />
          </div>
        </div>
      )}
    </PanelShell>
  )
}

// ======================== Video Panel ========================

function VideoPanel({ nodeId, nodeData, isConfigNode }: { nodeId: string; nodeData: any; isConfigNode?: boolean }) {
  const defaultModel = useSettingsStore(s => s.defaultVideoModel) || DEFAULT_VIDEO_MODEL

  const imageSourceCount = useGraphStore(s => {
    return s.edges.filter(e => e.target === nodeId && s.nodes.find(n => n.id === e.source)?.type === 'image').length
  })

  const hasImageSource = imageSourceCount > 0

  const [model, setModel] = useState(nodeData?.params?.model || defaultModel)
  const [ratio, setRatio] = useState(nodeData?.params?.aspectRatio || '16:9')
  const [prompt, setPrompt] = useState(nodeData?.prompt || (hasImageSource ? '根据图片生成视频。' : ''))
  const [loading, setLoading] = useState(false)
  const [loopCount, setLoopCount] = useState(1)

  const panelLabel = imageSourceCount >= 2 ? '首尾帧生视频' : hasImageSource ? '图生视频' : '文生视频'

  const modelCfg = useMemo(() => (VIDEO_MODELS as any[]).find((m: any) => m.key === model) || VIDEO_MODELS[0], [model]) as any
  const ratioOptions = useMemo(() => (modelCfg?.ratios || ['16:9','9:16']).map((r: string) => ({ key: r, label: r })), [modelCfg])
  const durOptions = useMemo(() => {
    const durs = modelCfg?.durs
    if (Array.isArray(durs) && durs.length > 0) return durs
    return [{ label: '8 秒', key: 8 }]
  }, [modelCfg])
  const [dur, setDur] = useState(() => {
    const saved = nodeData?.params?.duration
    if (saved && durOptions.some((d: any) => d.key === saved)) return saved
    return modelCfg?.defaultParams?.duration || durOptions[0]?.key || 8
  })
  const resOptions = useMemo(() => (modelCfg?.resolutions || modelCfg?.sizes || []).map((r: any) => typeof r === 'string' ? { key: r, label: r } : r), [modelCfg])
  const [resolution, setResolution] = useState(nodeData?.params?.resolution || resOptions[0]?.key || '')

  // 切换模型时重置时长和比例为新模型的默认值
  const handleModelChange = useCallback((newModel: string) => {
    setModel(newModel)
    const cfg = (VIDEO_MODELS as any[]).find((m: any) => m.key === newModel) as any
    if (cfg?.defaultParams?.duration) setDur(cfg.defaultParams.duration)
    if (cfg?.defaultParams?.ratio) setRatio(cfg.defaultParams.ratio)
    const newRes = (cfg?.resolutions || cfg?.sizes || [])
    if (newRes.length > 0) {
      const first = typeof newRes[0] === 'string' ? newRes[0] : newRes[0]?.key
      setResolution(first || '')
    } else {
      setResolution('')
    }
  }, [])

  const handleGenerate = useCallback(async () => {
    if (!prompt.trim()) { window.$message?.warning?.('请输入描述'); return }
    setLoading(true)
    try {
      const store = useGraphStore.getState()
      const node = store.nodes.find(n => n.id === nodeId)
      if (!node) throw new Error('节点不存在')

      const genCount = Math.max(1, Math.min(4, loopCount))

      for (let i = 0; i < genCount; i++) {
        if (i === 0 && isConfigNode) {
          store.updateNode(nodeId, { data: { model, ratio, dur, resolution, prompt, _inlinePrompt: prompt } })
          store.updateNode(nodeId, { data: { loading: true } })
          await generateVideoFromConfigNode(nodeId, { model, ratio, duration: dur }, { outputNodeId: nodeId, selectOutput: false })
          store.updateNode(nodeId, { data: { loading: false, prompt, params: { model, aspectRatio: ratio, duration: dur, resolution } } })
        } else {
          const configId = store.addNode('videoConfig', { x: -9999, y: -9999 }, {
            model, ratio, dur, resolution, prompt, _inlinePrompt: prompt,
            _inlineRefImages: nodeData?.url ? [nodeData.url] : [],
          })
          if (nodeData?.url) store.addEdge(nodeId, configId, { sourceHandle: 'right', targetHandle: 'left' })
          await generateVideoFromConfigNode(configId, { model, ratio, duration: dur })
          const configNode = store.nodes.find(n => n.id === configId)
          const outputId = (configNode?.data as any)?.outputNodeId
          const outputNode = outputId ? store.nodes.find(n => n.id === outputId) : null
          if (i === 0 && !isConfigNode && !nodeData?.url && outputNode?.data?.url) {
            store.updateNode(nodeId, { data: { url: outputNode.data.url, sourceUrl: (outputNode.data as any).sourceUrl, prompt, params: { model, aspectRatio: ratio, duration: dur, resolution } } })
            if (outputId) store.removeNode(outputId)
          } else if (outputNode) {
            store.updateNode(outputNode.id, { x: (node?.x || 0) + 500 + i * 500, y: node?.y || 0 })
          }
          store.removeNode(configId)
        }
      }
      window.$message?.success?.(genCount > 1 ? `${genCount} 个视频生成成功` : '视频生成成功')
    } catch (err: any) {
      window.$message?.error?.(err?.message || '生成失败')
    } finally {
      setLoading(false)
    }
  }, [nodeId, nodeData?.url, model, ratio, dur, resolution, prompt, loopCount, isConfigNode])

  return (
    <PanelShell>
      {/* 类型标签 */}
      <div className="flex items-center gap-2 px-4 pt-3 pb-1">
        <span className="text-xs font-medium text-white/50 bg-white/8 px-2 py-0.5 rounded">{panelLabel}</span>
      </div>

      {/* 提示词 */}
      <div className="px-4 py-2">
        <textarea
          value={prompt}
          onChange={e => setPrompt(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleGenerate() } }}
          placeholder="描述你想要生成的视频内容..."
          rows={2}
          className="w-full bg-transparent text-sm text-white/90 placeholder:text-white/25 resize-none outline-none"
          style={{ minHeight: 36, maxHeight: 100 }}
          disabled={loading}
        />
      </div>

      {/* 参数行 */}
      <div className="flex items-center gap-1.5 px-4 pb-3 pt-1 flex-wrap">
        <MiniSelect value={model} options={(VIDEO_MODELS as any[]).map(m => ({ value: m.key, label: m.label }))} onChange={handleModelChange} icon="🎬" maxW={160} />
        <MiniSelect value={ratio} options={ratioOptions.map((o: any) => ({ value: o.key, label: o.label }))} onChange={setRatio} icon="□" maxW={65} />
        <span className="text-white/20 text-xs">·</span>
        <MiniSelect value={String(dur)} options={durOptions.map((o: any) => ({ value: String(o.key), label: o.label }))} onChange={v => setDur(Number(v))} maxW={60} />
        {resOptions.length > 0 && (
          <>
            <span className="text-white/20 text-xs">·</span>
            <MiniSelect value={resolution} options={resOptions.map((o: any) => ({ value: o.key, label: o.label }))} onChange={setResolution} maxW={70} />
          </>
        )}
        <span className="text-white/20 text-xs">·</span>
        <MiniSelect value={String(loopCount)} options={[1,2,3,4].map(n => ({ value: String(n), label: `${n}次` }))} onChange={v => setLoopCount(Number(v))} maxW={55} />

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

// ======================== Text Panel ========================

function TextPanel({ nodeId, nodeData }: { nodeId: string; nodeData: any }) {
  const [model, setModel] = useState('claude-opus-4-6')
  const [prompt, setPrompt] = useState('')
  const [loading, setLoading] = useState(false)

  const handleGenerate = useCallback(async () => {
    if (!prompt.trim()) { window.$message?.warning?.('请输入润色指令'); return }
    const originalContent = String((nodeData as any)?.content || '').trim()
    if (!originalContent) { window.$message?.warning?.('文本节点内容为空，请先输入提示词'); return }
    setLoading(true)
    try {
      const result = await callAiAssistant(model, [
        {
          role: 'system',
          content: `你是一个专业的AI绘画/视频提示词润色专家。你的唯一任务是根据用户的润色指令，对原始提示词进行优化改写。

严格规则：
1. 必须使用中文输出
2. 只输出润色后的提示词本身，不要任何解释、前缀、后缀、标题
3. 不要使用任何表情符号(emoji)
4. 不要使用任何多余符号（如★、●、♦、→等装饰符号）
5. 不要添加引号包裹
6. 不要输出"润色结果："等前缀
7. 保持提示词的实用性，面向AI图像/视频生成模型
8. 直接输出纯中文文本提示词`
        },
        {
          role: 'user',
          content: `原始提示词：\n${originalContent}\n\n润色指令：${prompt}`
        }
      ], { filterThinking: true })
      if (result) {
        useGraphStore.getState().updateNode(nodeId, { data: { content: result } })
        window.$message?.success?.('润色完成')
      }
    } catch (err: any) {
      window.$message?.error?.(err?.message || '润色失败')
    } finally {
      setLoading(false)
    }
  }, [nodeId, nodeData, model, prompt])

  return (
    <PanelShell>
      <div className="px-4 py-3">
        <textarea
          value={prompt}
          onChange={e => setPrompt(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleGenerate() } }}
          placeholder="输入润色指令，如：更具电影感、增加细节描述、改为日系动漫风格..."
          rows={2}
          className="w-full bg-transparent text-sm text-white/90 placeholder:text-white/25 resize-none outline-none"
          style={{ minHeight: 36, maxHeight: 100 }}
          disabled={loading}
        />
      </div>
      <div className="flex items-center gap-1.5 px-4 pb-3 pt-1">
        <MiniSelect value={model} options={[
          { value: 'claude-opus-4-6', label: 'Claude Opus 4.6' },
          { value: 'claude-opus-4-5-20251101', label: 'Claude Opus 4.5' },
          { value: 'gemini-3-pro-preview-thinking', label: 'Gemini 3 Pro' },
        ]} onChange={setModel} icon="◇" maxW={180} />
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

function CameraColumn({ label, items, index, onChange, cycle }: {
  label: string
  items: Array<{ key: string; label: string; suffix: string }>
  index: number
  onChange: (i: number) => void
  cycle: (arr: any[], idx: number, dir: 1 | -1) => number
}) {
  return (
    <div className="flex flex-col items-center gap-1">
      <span className="text-[10px] text-white/40">{label}</span>
      <div className="flex items-center gap-0.5">
        <button onClick={() => onChange(cycle(items, index, -1))} className="p-0.5 text-white/30 hover:text-white/60"><ChevronLeft size={12} /></button>
        <span className="text-[11px] text-white/80 min-w-[60px] text-center truncate">{items[index]?.label}</span>
        <button onClick={() => onChange(cycle(items, index, 1))} className="p-0.5 text-white/30 hover:text-white/60"><ChevronRight size={12} /></button>
      </div>
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
