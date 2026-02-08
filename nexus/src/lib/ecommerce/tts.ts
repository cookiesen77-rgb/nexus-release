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

export async function generateTTS(params: GenerateTTSParams): Promise<{ audioDataUrl: string; rawBase64: string }> {
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
    { authMode: 'bearer', timeoutMs: 120000 },
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

  // Gemini TTS returns audio/L16 (raw PCM) — convert to WAV for browser playback
  if (mimeType.includes('L16') || mimeType.includes('pcm')) {
    const raw = atob(inlineData.data)
    const pcmBytes = new Uint8Array(raw.length)
    for (let i = 0; i < raw.length; i++) pcmBytes[i] = raw.charCodeAt(i)

    const sampleRate = 24000
    const numChannels = 1
    const bitsPerSample = 16
    const wavHeader = new ArrayBuffer(44)
    const view = new DataView(wavHeader)
    const dataSize = pcmBytes.length

    view.setUint32(0, 0x52494646, false) // RIFF
    view.setUint32(4, 36 + dataSize, true)
    view.setUint32(8, 0x57415645, false) // WAVE
    view.setUint32(12, 0x666d7420, false) // fmt
    view.setUint32(16, 16, true)
    view.setUint16(20, 1, true) // PCM
    view.setUint16(22, numChannels, true)
    view.setUint32(24, sampleRate, true)
    view.setUint32(28, sampleRate * numChannels * bitsPerSample / 8, true)
    view.setUint16(32, numChannels * bitsPerSample / 8, true)
    view.setUint16(34, bitsPerSample, true)
    view.setUint32(36, 0x64617461, false) // data
    view.setUint32(40, dataSize, true)

    const wavBytes = new Uint8Array(44 + dataSize)
    wavBytes.set(new Uint8Array(wavHeader), 0)
    wavBytes.set(pcmBytes, 44)

    let binary = ''
    for (let i = 0; i < wavBytes.length; i++) binary += String.fromCharCode(wavBytes[i])
    const wavBase64 = btoa(binary)
    return { audioDataUrl: `data:audio/wav;base64,${wavBase64}`, rawBase64: inlineData.data }
  }

  return { audioDataUrl: `data:${mimeType};base64,${inlineData.data}`, rawBase64: inlineData.data }
}
