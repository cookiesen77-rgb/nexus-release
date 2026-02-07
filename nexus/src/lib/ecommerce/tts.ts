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

  const body = {
    contents: [{ role: 'user', parts: [{ text }] }],
    generationConfig: {
      responseModalities: ['AUDIO'],
      speechConfig: {
        voiceConfig: {
          prebuiltVoiceConfig: { voiceName: voiceName || 'Kore' },
        },
      },
    },
  }

  const resp = await postJson<any>(
    `/v1beta/models/${model}:generateContent`,
    body,
    { authMode: 'query' },
  )

  const inlineData = resp?.candidates?.[0]?.content?.parts?.[0]?.inlineData
  if (!inlineData?.data) throw new Error('TTS returned no audio data')

  return { audioDataUrl: `data:audio/mp3;base64,${inlineData.data}` }
}
