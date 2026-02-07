import { postJson, getJson } from '@/lib/workflow/request'
import { KLING_VIDEO_TOOLS } from '@/config/models'
import { DEFAULT_API_BASE_URL } from '@/utils/constants'

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

function getKlingOrigin(): string {
  try {
    const first = (KLING_VIDEO_TOOLS as any[])[0]?.endpoint
    if (first) return new URL(first).origin
  } catch { /* fallback */ }
  try { return new URL(DEFAULT_API_BASE_URL).origin } catch { /* fallback */ }
  return 'https://yunwu.ai'
}

async function pollKlingTask(statusUrl: string, maxAttempts: number, intervalMs: number): Promise<any> {
  for (let i = 0; i < maxAttempts; i++) {
    await sleep(intervalMs)
    const resp = await getJson<any>(statusUrl, undefined, { authMode: 'bearer' })
    const taskStatus = String(resp?.data?.task_status || '').toLowerCase()
    if (taskStatus === 'succeed' || taskStatus === 'completed') return resp.data
    if (taskStatus === 'failed') {
      throw new Error(String(resp?.data?.task_status_msg || '任务失败'))
    }
  }
  throw new Error(`轮询超时（${maxAttempts} 次）`)
}

function getToolConfig(key: string) {
  return (KLING_VIDEO_TOOLS as any[]).find((t: any) => t.key === key)
}

function extractVideoUrl(data: any): string {
  const url = String(data?.task_result?.videos?.[0]?.url || '').trim()
  if (!url) throw new Error('任务完成但未返回视频 URL')
  return url
}

// Kling 数字人: image + audio → video
export async function generateAvatarVideo(params: {
  image: string
  audioId?: string
  soundFile?: string
  prompt?: string
  mode?: 'std' | 'pro'
}): Promise<{ taskId: string; videoUrl: string }> {
  const cfg = getToolConfig('kling-digital-human')
  const endpoint = String(cfg?.endpoint || `${getKlingOrigin()}/kling/v1/videos/avatar/image2video`)

  const body: Record<string, string> = {
    image: params.image,
    mode: params.mode || 'std',
  }
  if (params.audioId) body.audio_id = params.audioId
  else if (params.soundFile) body.sound_file = params.soundFile
  if (params.prompt) body.prompt = params.prompt

  const resp = await postJson<any>(endpoint, body, { authMode: 'bearer' })
  const taskId = String(resp?.data?.task_id || resp?.task_id || '').trim()
  if (!taskId) throw new Error('数字人任务创建失败')

  const statusUrl = typeof cfg?.statusEndpoint === 'function'
    ? cfg.statusEndpoint(taskId)
    : `${getKlingOrigin()}/kling/v1/videos/avatar/image2video/${taskId}`

  const data = await pollKlingTask(statusUrl, 120, 5000)
  return { taskId, videoUrl: extractVideoUrl(data) }
}

// Kling 动作控制: image + reference video → video
export async function generateMotionControlVideo(params: {
  imageUrl: string
  videoUrl: string
  prompt?: string
  mode?: string
  keepOriginalSound?: boolean
  characterOrientation?: 'up' | 'down' | 'left' | 'right'
}): Promise<{ taskId: string; videoUrl: string }> {
  const cfg = getToolConfig('kling-motion-control')
  const endpoint = String(cfg?.endpoint || `${getKlingOrigin()}/kling/v1/videos/motion-control`)

  const body: Record<string, any> = {
    image_url: params.imageUrl,
    video_url: params.videoUrl,
  }
  if (params.prompt) body.prompt = params.prompt
  if (params.mode) body.mode = params.mode
  if (params.keepOriginalSound !== undefined) body.keep_original_sound = params.keepOriginalSound
  if (params.characterOrientation) body.character_orientation = params.characterOrientation

  const resp = await postJson<any>(endpoint, body, { authMode: 'bearer' })
  const taskId = String(resp?.data?.task_id || resp?.task_id || '').trim()
  if (!taskId) throw new Error('动作控制任务创建失败')

  const statusUrl = typeof cfg?.statusEndpoint === 'function'
    ? cfg.statusEndpoint(taskId)
    : `${getKlingOrigin()}/kling/v1/videos/motion-control/${taskId}`

  const data = await pollKlingTask(statusUrl, 120, 5000)
  return { taskId, videoUrl: extractVideoUrl(data) }
}

// Kling 多模态视频编辑: init selection → add segments → run → poll
export async function generateMultiElementsVideo(params: {
  initVideoUrl: string
  segments: { prompt: string }[]
  prompt?: string
}): Promise<{ taskId: string; videoUrl: string }> {
  const cfg = getToolConfig('kling-multi-elements-video-edit')
  const origin = getKlingOrigin()
  const endpoints = cfg?.endpoints || {
    initSelection: `${origin}/kling/v1/videos/multi-elements/init-selection`,
    addSelection: `${origin}/kling/v1/videos/multi-elements/add-selection`,
    deleteSelection: `${origin}/kling/v1/videos/multi-elements/delete-selection`,
    previewSelection: `${origin}/kling/v1/videos/multi-elements/preview-selection`,
    run: `${origin}/kling/v1/videos/multi-elements`,
    query: (id: string) => `${origin}/kling/v1/videos/multi-elements/${id}`,
  }

  // Step 1: init selection
  const initResp = await postJson<any>(endpoints.initSelection, { video_url: params.initVideoUrl }, { authMode: 'bearer' })
  const initTaskId = String(initResp?.data?.task_id || initResp?.task_id || '').trim()
  if (!initTaskId) throw new Error('多模态编辑初始化失败')

  // Step 2: add selections for each segment
  for (const seg of params.segments) {
    await postJson<any>(endpoints.addSelection, {
      task_id: initTaskId,
      prompt: seg.prompt,
    }, { authMode: 'bearer' })
  }

  // Step 3: run generation
  const runResp = await postJson<any>(endpoints.run, {
    task_id: initTaskId,
    prompt: params.prompt || '',
  }, { authMode: 'bearer' })
  const runTaskId = String(runResp?.data?.task_id || runResp?.task_id || '').trim()
  if (!runTaskId) throw new Error('多模态编辑运行失败')

  // Step 4: poll for result
  const queryUrl = typeof endpoints.query === 'function'
    ? endpoints.query(runTaskId)
    : `${origin}/kling/v1/videos/multi-elements/${runTaskId}`

  const data = await pollKlingTask(queryUrl, 120, 5000)
  return { taskId: runTaskId, videoUrl: extractVideoUrl(data) }
}
