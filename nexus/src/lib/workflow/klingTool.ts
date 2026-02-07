import { KLING_AUDIO_TOOLS, KLING_IMAGE_TOOLS, KLING_VIDEO_TOOLS } from '@/config/models'
import { useGraphStore } from '@/graph/store'
import type { GraphNode } from '@/graph/types'
import { klingCreateTask, klingPollTaskForMedia, normalizePayloadInlineMedia, pickMediaUrls } from '@/lib/workflow/klingPlatform'
import { getJson, postJson } from '@/lib/workflow/request'

const pickNodeUrl = (n: GraphNode | null): string => {
  if (!n) return ''
  const d: any = n.data || {}
  const candidates = [
    d.sourceUrl,
    d.sourceURL,
    d.originalUrl,
    d.remoteUrl,
    d.displayUrl,
    d.url,
  ]
    .map((x) => (typeof x === 'string' ? x.trim() : ''))
    .filter(Boolean)
  return candidates[0] || ''
}

const collectIncomingNodes = (targetId: string) => {
  const s = useGraphStore.getState()
  const byId = new Map(s.nodes.map((n) => [n.id, n]))
  const incoming = s.edges.filter((e) => e.target === targetId)
  const texts: GraphNode[] = []
  const images: GraphNode[] = []
  const videos: GraphNode[] = []
  const audios: GraphNode[] = []
  for (const e of incoming) {
    const n = byId.get(e.source)
    if (!n) continue
    if (n.type === 'text') texts.push(n)
    else if (n.type === 'image') images.push(n)
    else if (n.type === 'video') videos.push(n)
    else if (n.type === 'audio') audios.push(n)
  }
  return { texts, images, videos, audios }
}

const fillPayloadFromConnections = (payload: any, inputs: { text: string; imageUrls: string[]; videoUrls: string[]; audioUrls: string[] }) => {
  const walk = (v: any): any => {
    if (Array.isArray(v)) return v.map(walk)
    if (!v || typeof v !== 'object') return v
    const out: any = { ...v }
    for (const k of Object.keys(out)) {
      const key = String(k)
      const cur = out[key]
      if (typeof cur === 'string' && cur.trim() === '') {
        if ((key === 'prompt' || key === 'text') && inputs.text) out[key] = inputs.text
        else if ((key === 'image' || key === 'image_url' || key === 'imageUrl') && inputs.imageUrls[0]) out[key] = inputs.imageUrls[0]
        else if ((key === 'video_url' || key === 'videoUrl') && inputs.videoUrls[0]) out[key] = inputs.videoUrls[0]
        else if ((key === 'sound_file' || key === 'soundFile' || key === 'voice_url') && inputs.audioUrls[0]) out[key] = inputs.audioUrls[0]
      } else {
        out[key] = walk(cur)
      }
    }
    return out
  }
  return walk(payload)
}

const getToolConfig = (nodeType: string, toolKey: string) => {
  const key = String(toolKey || '').trim()
  if (nodeType === 'klingVideoTool') return (KLING_VIDEO_TOOLS as any[]).find((t: any) => t.key === key) || (KLING_VIDEO_TOOLS as any[])[0]
  if (nodeType === 'klingImageTool') return (KLING_IMAGE_TOOLS as any[]).find((t: any) => t.key === key) || (KLING_IMAGE_TOOLS as any[])[0]
  if (nodeType === 'klingAudioTool') return (KLING_AUDIO_TOOLS as any[]).find((t: any) => t.key === key) || (KLING_AUDIO_TOOLS as any[])[0]
  return null
}

const createOutputNode = (toolNode: GraphNode, outputType: 'video' | 'image' | 'audio' | 'text') => {
  const store = useGraphStore.getState()
  const baseX = (toolNode.x || 0) + 460
  const baseY = toolNode.y || 0

  if (outputType === 'text') {
    const outId = store.addNode('text', { x: baseX, y: baseY }, { content: '', label: 'Kling 输出' })
    store.addEdge(toolNode.id, outId, { sourceHandle: 'right', targetHandle: 'left' })
    return outId
  }
  if (outputType === 'image') {
    const outId = store.addNode('image', { x: baseX, y: baseY }, { url: '', loading: true, error: '', label: 'Kling 输出' })
    store.addEdge(toolNode.id, outId, { sourceHandle: 'right', targetHandle: 'left' })
    return outId
  }
  if (outputType === 'audio') {
    const outId = store.addNode('audio', { x: baseX, y: baseY }, { url: '', loading: true, error: '', label: 'Kling 输出' })
    store.addEdge(toolNode.id, outId, { sourceHandle: 'right', targetHandle: 'left' })
    return outId
  }
  const outId = store.addNode('video', { x: baseX, y: baseY }, { url: '', loading: true, error: '', label: 'Kling 输出' })
  store.addEdge(toolNode.id, outId, { sourceHandle: 'right', targetHandle: 'left' })
  return outId
}

export const runKlingToolNode = async (nodeId: string) => {
  const store = useGraphStore.getState()
  const node = store.nodes.find((n) => n.id === nodeId)
  if (!node) throw new Error('Kling 工具节点不存在')
  if (node.type !== 'klingVideoTool' && node.type !== 'klingImageTool' && node.type !== 'klingAudioTool') {
    throw new Error('请选择 Kling 工具节点执行')
  }

  const d: any = node.data || {}
  const toolKey = String(d.toolKey || '').trim()
  const toolCfg: any = getToolConfig(node.type, toolKey)
  if (!toolCfg) throw new Error('未找到 Kling 工具配置')

  const payloadText = String(d.payload || '').trim() || '{}'
  let payload: any
  try {
    payload = JSON.parse(payloadText)
  } catch {
    throw new Error('请求 JSON 解析失败：请检查格式（必须是合法 JSON 对象）')
  }

  const incoming = collectIncomingNodes(nodeId)
  const firstText = String((incoming.texts[0]?.data as any)?.content || '').trim()
  const imageUrls = incoming.images.map((n) => pickNodeUrl(n)).filter(Boolean)
  const videoUrls = incoming.videos.map((n) => pickNodeUrl(n)).filter(Boolean)
  const audioUrls = incoming.audios.map((n) => pickNodeUrl(n)).filter(Boolean)

  payload = fillPayloadFromConnections(payload, { text: firstText, imageUrls, videoUrls, audioUrls })
  payload = await normalizePayloadInlineMedia(payload)

  // 创建输出节点（允许 tool 覆盖输出类型：video/image/audio/text）
  const toolOutputType = String(toolCfg?.outputType || '').trim()
  const expectedOutputType =
    toolOutputType === 'text' || toolOutputType === 'image' || toolOutputType === 'video' || toolOutputType === 'audio'
      ? (toolOutputType as any)
      : node.type === 'klingVideoTool'
        ? 'video'
        : node.type === 'klingImageTool'
          ? 'image'
          : 'audio'
  const outId = createOutputNode(node, expectedOutputType)

  try {
    // 选择端点
    const endpointCandidate =
      toolCfg?.endpoint || toolCfg?.endpoints?.create || toolCfg?.endpoints?.run || toolCfg?.endpoints?.lipSync || ''
    const endpoint = (typeof endpointCandidate === 'function' ? endpointCandidate(payload) : String(endpointCandidate || '')).trim()
    if (!endpoint) throw new Error('工具未配置 endpoint')

    const statusEndpoint = toolCfg?.statusEndpoint || toolCfg?.endpoints?.query
    const method = String(toolCfg?.method || 'POST').trim().toUpperCase() || 'POST'

    // 同步/异步两类：有 statusEndpoint 则轮询，否则直接尝试从响应取 URL
    let finalResp: any = null
    let finalUrls = { video: '', image: '', audio: '', any: '' }

    if (statusEndpoint) {
      const created = await klingCreateTask(endpoint, payload, 240000)
      finalResp = created.raw
      const taskId = created.taskId
      if (!taskId) throw new Error('创建任务失败：未获取到 task_id')
      const polled = await klingPollTaskForMedia(taskId, statusEndpoint, { maxAttempts: 240, intervalMs: 3000 })
      finalResp = polled.raw
      finalUrls = { ...(polled.urls as any) }
    } else {
      if (method === 'GET') {
        finalResp = await getJson<any>(endpoint, payload, { authMode: 'bearer', timeoutMs: 240000 })
      } else {
        finalResp = await postJson<any>(endpoint, payload, { authMode: 'bearer', timeoutMs: 240000 })
      }
      finalUrls = pickMediaUrls(finalResp)
    }

    if (expectedOutputType === 'text') {
      const text = JSON.stringify(finalResp, null, 2)
      store.updateNode(outId, { data: { content: text, label: 'Kling 输出（JSON）', model: toolCfg.key, updatedAt: Date.now() } } as any)
      store.updateNode(nodeId, { data: { executed: true, lastRunAt: Date.now() } } as any)
      return { outId }
    }

    // 根据输出节点类型回填
    const url =
      expectedOutputType === 'video'
        ? finalUrls.video || finalUrls.any
        : expectedOutputType === 'image'
          ? finalUrls.image || finalUrls.any
          : finalUrls.audio || finalUrls.any

    if (url && /^https?:\/\//i.test(url)) {
      if (expectedOutputType === 'video') {
        store.updateNode(outId, { data: { url, sourceUrl: url, loading: false, error: '', model: toolCfg.key, updatedAt: Date.now() } } as any)
      } else if (expectedOutputType === 'image') {
        store.updateNode(outId, { data: { url, sourceUrl: url, loading: false, error: '', model: toolCfg.key, updatedAt: Date.now() } } as any)
      } else {
        store.updateNode(outId, { data: { url, sourceUrl: url, loading: false, error: '', model: toolCfg.key, updatedAt: Date.now() } } as any)
      }
    } else {
      // 无媒体 URL：输出节点标红 + 额外创建 text 节点写回 JSON
      store.updateNode(outId, { data: { loading: false, error: '未返回可用的媒体 URL' } } as any)
      const textOutId = createOutputNode(node, 'text')
      const text = JSON.stringify(finalResp, null, 2)
      store.updateNode(textOutId, { data: { content: text, label: 'Kling 输出（JSON）' } } as any)
    }

    store.updateNode(nodeId, { data: { executed: true, lastRunAt: Date.now() } } as any)
    return { outId }
  } catch (err: any) {
    const msg = String(err?.message || err || 'Kling 工具执行失败')
    store.updateNode(outId, { data: { loading: false, error: msg } } as any)
    store.updateNode(nodeId, { data: { lastError: msg } } as any)
    throw err
  }
}

