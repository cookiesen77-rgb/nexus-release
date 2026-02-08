import { postJson, getJson, postFormData } from '@/lib/workflow/request'
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

// Upload data URL / base64 to CDN, return HTTP URL
// Kling API body has size limits — must send HTTP URLs, not raw base64
async function ensureHttpUrl(input: string, type: 'image' | 'audio' = 'image'): Promise<string> {
  if (/^https?:\/\//i.test(input)) return input

  let dataUrl = input
  if (!dataUrl.startsWith('data:')) {
    const mime = type === 'audio' ? 'audio/mp3' : 'image/png'
    dataUrl = `data:${mime};base64,${dataUrl}`
  }

  const m = dataUrl.match(/^data:([^;]+);base64,(.*)$/)
  if (!m) throw new Error('数据格式错误')

  const mimeType = m[1]
  const byteString = atob(m[2])
  const bytes = new Uint8Array(byteString.length)
  for (let i = 0; i < byteString.length; i++) bytes[i] = byteString.charCodeAt(i)
  const blob = new Blob([bytes], { type: mimeType })

  const ext = mimeType.split('/')[1]?.replace('jpeg', 'jpg') || (type === 'audio' ? 'mp3' : 'png')
  const form = new FormData()
  form.append('file', blob, `upload.${ext}`)

  const resp = await postFormData<any>('https://imageproxy.zhongzhuan.chat/api/upload', form, { authMode: 'bearer', timeoutMs: 120000 })
  const url = String(resp?.url || resp?.data?.url || resp?.data?.link || '').trim()
  if (url && /^https?:\/\//i.test(url)) return url
  throw new Error('文件上传失败，无法获取 URL')
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

function stripDataUrlPrefix(input: string): string {
  if (!input.startsWith('data:')) return input
  const commaIdx = input.indexOf(',')
  return commaIdx > 0 ? input.slice(commaIdx + 1) : input
}

// ===== 数字人口播 =====
// POST /kling/v1/videos/avatar/image2video
// Params: image(required, base64 or URL), audio_id|sound_file(one required, base64 or URL),
//         prompt(required), mode(required: std|pro)
// Query: GET /kling/v1/videos/avatar/image2video/{id}
export async function generateAvatarVideo(params: {
  image: string
  audioId?: string
  soundFile?: string
  prompt?: string
  mode?: 'std' | 'pro'
}): Promise<{ taskId: string; videoUrl: string }> {
  if (!params.audioId && !params.soundFile) throw new Error('数字人需要音频：请提供 audio_id 或上传音频文件')

  const cfg = getToolConfig('kling-digital-human')
  const endpoint = String(cfg?.endpoint || `${getKlingOrigin()}/kling/v1/videos/avatar/image2video`)

  // Upload image and audio to CDN — Kling API rejects large base64 in JSON body
  const image = await ensureHttpUrl(params.image, 'image')

  const body: Record<string, string> = {
    image,
    mode: params.mode || 'std',
    prompt: params.prompt || '',
  }
  if (params.audioId) {
    body.audio_id = params.audioId
  } else if (params.soundFile) {
    body.sound_file = await ensureHttpUrl(params.soundFile, 'audio')
  }

  const resp = await postJson<any>(endpoint, body, { authMode: 'bearer' })
  const taskId = String(resp?.data?.task_id || resp?.task_id || '').trim()
  if (!taskId) throw new Error('数字人任务创建失败')

  const statusUrl = typeof cfg?.statusEndpoint === 'function'
    ? cfg.statusEndpoint(taskId)
    : `${getKlingOrigin()}/kling/v1/videos/avatar/image2video/${taskId}`

  const data = await pollKlingTask(statusUrl, 120, 5000)
  return { taskId, videoUrl: extractVideoUrl(data) }
}

// ===== 动作控制 =====
// POST /kling/v1/videos/motion-control
// Params: image_url(required), video_url(required), character_orientation(required: "image"|"video"),
//         mode(required: "std"|"pro"), prompt(optional), keep_original_sound(optional: "yes"|"no")
// Query: GET /kling/v1/videos/motion-control/{id}
export async function generateMotionControlVideo(params: {
  imageUrl: string
  videoUrl: string
  prompt?: string
  mode?: 'std' | 'pro'
  keepOriginalSound?: boolean
  characterOrientation?: 'image' | 'video'
}): Promise<{ taskId: string; videoUrl: string }> {
  const cfg = getToolConfig('kling-motion-control')
  const endpoint = String(cfg?.endpoint || `${getKlingOrigin()}/kling/v1/videos/motion-control`)

  const body: Record<string, any> = {
    image_url: await ensureHttpUrl(params.imageUrl, 'image'),
    video_url: params.videoUrl,
    mode: params.mode || 'std',
    character_orientation: params.characterOrientation || 'image',
  }
  if (params.prompt) body.prompt = params.prompt
  if (params.keepOriginalSound !== undefined) body.keep_original_sound = params.keepOriginalSound ? 'yes' : 'no'

  console.log('[MotionControl] body:', JSON.stringify({ ...body, image_url: String(body.image_url).slice(0, 80), video_url: String(body.video_url).slice(0, 80) }))

  const resp = await postJson<any>(endpoint, body, { authMode: 'bearer' })
  console.log('[MotionControl] resp:', JSON.stringify(resp).slice(0, 300))
  const taskId = String(resp?.data?.task_id || resp?.task_id || '').trim()
  if (!taskId) throw new Error('动作控制任务创建失败')

  const statusUrl = typeof cfg?.statusEndpoint === 'function'
    ? cfg.statusEndpoint(taskId)
    : `${getKlingOrigin()}/kling/v1/videos/motion-control/${taskId}`

  const data = await pollKlingTask(statusUrl, 120, 5000)
  return { taskId, videoUrl: extractVideoUrl(data) }
}

// ===== 多模态视频编辑 =====
// Workflow: init-selection → add-selection (with frame coords) → run multi-elements → poll
// init: POST /kling/v1/videos/multi-elements/init-selection  body: { video_url } → returns session_id
// add:  POST /kling/v1/videos/multi-elements/add-selection   body: { session_id, frame_index, points: [{x,y}] }
// run:  POST /kling/v1/videos/multi-elements                 body: { model_name, session_id, edit_mode, prompt, mode, duration }
// query: GET /kling/v1/videos/multi-elements/{id}
export interface MultiElementsSegment {
  frameIndex: number
  points: { x: number; y: number }[]
}

export async function generateMultiElementsVideo(params: {
  videoUrl: string
  segments: MultiElementsSegment[]
  editMode?: 'addition' | 'swap' | 'removal'
  prompt: string
  negativePrompt?: string
  imageList?: string[]
  mode?: 'std' | 'pro'
  duration?: number
}): Promise<{ taskId: string; videoUrl: string }> {
  const cfg = getToolConfig('kling-multi-elements-video-edit')
  const origin = getKlingOrigin()
  const endpoints = cfg?.endpoints || {
    initSelection: `${origin}/kling/v1/videos/multi-elements/init-selection`,
    addSelection: `${origin}/kling/v1/videos/multi-elements/add-selection`,
    run: `${origin}/kling/v1/videos/multi-elements`,
    query: (id: string) => `${origin}/kling/v1/videos/multi-elements/${id}`,
  }

  // Step 1: init — get session_id
  const initResp = await postJson<any>(endpoints.initSelection, { video_url: params.videoUrl }, { authMode: 'bearer' })
  const sessionId = String(initResp?.data?.session_id || initResp?.data?.task_id || '').trim()
  if (!sessionId) throw new Error('多模态编辑初始化失败：未返回 session_id')

  // Step 2: add selection markers for each segment
  for (const seg of params.segments) {
    await postJson<any>(endpoints.addSelection, {
      session_id: sessionId,
      frame_index: seg.frameIndex,
      points: seg.points,
    }, { authMode: 'bearer' })
  }

  // Step 3: run generation
  const runBody: Record<string, any> = {
    model_name: 'kling-v1-6',
    session_id: sessionId,
    edit_mode: params.editMode || 'addition',
    prompt: params.prompt,
    mode: params.mode || 'std',
    duration: String(params.duration || 5),
  }
  if (params.negativePrompt) runBody.negative_prompt = params.negativePrompt
  if (params.imageList?.length) runBody.image_list = params.imageList

  const runResp = await postJson<any>(endpoints.run, runBody, { authMode: 'bearer' })
  const runTaskId = String(runResp?.data?.task_id || runResp?.task_id || '').trim()
  if (!runTaskId) throw new Error('多模态编辑运行失败')

  // Step 4: poll
  const queryUrl = typeof endpoints.query === 'function'
    ? endpoints.query(runTaskId)
    : `${origin}/kling/v1/videos/multi-elements/${runTaskId}`

  const data = await pollKlingTask(queryUrl, 120, 5000)
  return { taskId: runTaskId, videoUrl: extractVideoUrl(data) }
}

// ===== 口型同步 (Lip Sync) =====
// Step 1: POST /kling/v1/videos/identify-face { video_url } → session_id + face_list
// Step 2: POST /kling/v1/videos/advanced-lip-sync { session_id, face_choose: [{face_id, sound_file}] } → task_id
// Step 3: Poll GET /kling/v1/videos/advanced-lip-sync/{task_id}
export async function generateLipSync(params: {
  videoUrl: string
  soundFile?: string
  audioId?: string
  faceIndex?: number
}): Promise<{ taskId: string; videoUrl: string }> {
  if (!params.soundFile && !params.audioId) throw new Error('口型同步需要音频')

  const cfg = getToolConfig('kling-lip-sync')
  const origin = getKlingOrigin()
  const endpoints = cfg?.endpoints || {
    identifyFace: `${origin}/kling/v1/videos/identify-face`,
    lipSync: `${origin}/kling/v1/videos/advanced-lip-sync`,
    query: (id: string) => `${origin}/kling/v1/videos/advanced-lip-sync/${id}`,
  }

  // Step 1: Identify face
  const faceResp = await postJson<any>(endpoints.identifyFace, { video_url: params.videoUrl }, { authMode: 'bearer' })
  const sessionId = String(faceResp?.data?.session_id || '').trim()
  const faceList = faceResp?.data?.face_list || []
  if (!sessionId) throw new Error('人脸识别失败：未返回 session_id')

  const faceId = faceList[params.faceIndex || 0]?.face_id
  if (!faceId) throw new Error(`未检测到人脸（共检测到 ${faceList.length} 张）`)

  // Step 2: Submit lip sync
  let audioSource: string
  if (params.audioId) {
    audioSource = params.audioId
  } else {
    audioSource = await ensureHttpUrl(params.soundFile!, 'audio')
  }

  const lipSyncBody: Record<string, any> = {
    session_id: sessionId,
    face_choose: [{
      face_id: faceId,
      ...(params.audioId ? { audio_id: audioSource } : { sound_file: audioSource }),
    }],
  }

  const lipResp = await postJson<any>(endpoints.lipSync, lipSyncBody, { authMode: 'bearer' })
  const taskId = String(lipResp?.data?.task_id || lipResp?.task_id || '').trim()
  if (!taskId) throw new Error('口型同步任务创建失败')

  // Step 3: Poll
  const queryUrl = typeof endpoints.query === 'function'
    ? endpoints.query(taskId)
    : `${origin}/kling/v1/videos/advanced-lip-sync/${taskId}`

  const data = await pollKlingTask(queryUrl, 120, 5000)
  return { taskId, videoUrl: extractVideoUrl(data) }
}

// ===== 视频画质增强 =====
export async function upscaleVideo(params: {
  videoUrl: string
}): Promise<{ taskId: string; videoUrl: string }> {
  const origin = getKlingOrigin()
  const endpoint = `${origin}/kling/v1/videos/upscale`

  const resp = await postJson<any>(endpoint, { video_url: params.videoUrl }, { authMode: 'bearer' })
  const taskId = String(resp?.data?.task_id || resp?.task_id || '').trim()
  if (!taskId) throw new Error('画质增强任务创建失败')

  const data = await pollKlingTask(`${origin}/kling/v1/videos/upscale/${taskId}`, 120, 5000)
  return { taskId, videoUrl: extractVideoUrl(data) }
}
