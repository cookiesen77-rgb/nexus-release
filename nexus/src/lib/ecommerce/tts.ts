import { postJson } from '@/lib/workflow/request'

export const TTS_MODELS = [
  { key: 'gemini-2.5-pro-preview-tts', label: 'Gemini Pro TTS' },
  { key: 'gemini-2.5-flash-preview-tts', label: 'Gemini Flash TTS' },
] as const

interface GenerateTTSParams {
  text: string
  model: string
  voiceName?: string
}

export async function generateTTS(params: GenerateTTSParams): Promise<{ audioDataUrl: string }> {
  const { text, model, voiceName } = params
  if (!text?.trim()) throw new Error('请输入文案')

  const body = {
    model,
    contents: [{ parts: [{ text }] }],
    generationConfig: {
      responseModalities: ['AUDIO'],
      speechConfig: {
        voiceConfig: {
          prebuiltVoiceConfig: { voiceName: voiceName || 'Kore' },
        },
      },
    },
  }

  console.log('[TTS] 请求模型:', model, '文本长度:', text.length)

  const resp = await postJson<any>(
    `/v1beta/models/${model}:generateContent`,
    body,
    { authMode: 'query', timeoutMs: 120000 },
  )

  console.log('[TTS] 响应:', JSON.stringify(resp).slice(0, 200))

  // 提取音频数据 — 尝试多种路径
  const candidates = resp?.candidates || []
  const parts = candidates[0]?.content?.parts || []
  const audioPart = parts.find((p: any) => p?.inlineData?.data) || parts[0]
  const inlineData = audioPart?.inlineData

  if (!inlineData?.data) {
    const errMsg = resp?.error?.message || resp?.candidates?.[0]?.finishReason || '未返回音频数据'
    if (errMsg.includes('429') || errMsg.includes('负载') || errMsg.includes('饱和')) {
      throw new Error('TTS 服务繁忙，请稍后重试')
    }
    throw new Error(`TTS 生成失败: ${errMsg}`)
  }

  const mimeType = inlineData.mimeType || inlineData.mime_type || 'audio/mp3'
  return { audioDataUrl: `data:${mimeType};base64,${inlineData.data}` }
}
