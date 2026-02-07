import { chatCompletions } from '@/lib/nexusApi'
import { postJson } from '@/lib/workflow/request'
import { useSettingsStore } from '@/store/settings'

const ANALYZE_PROMPT = `Analyze this image for e-commerce product fusion. Output in English, max 80 words:
**SUBJECT**: Main subject, material, color, shape
**STYLE**: Visual style, lighting, background
**ELEMENT**: Key element that could be transferred to another image`

function ensureBase64(url: string): Promise<string> {
  if (url.startsWith('data:')) return Promise.resolve(extractBase64(url))
  return fetch(url)
    .then(r => r.blob())
    .then(blob => new Promise<string>((resolve, reject) => {
      const reader = new FileReader()
      reader.onloadend = () => resolve(extractBase64(reader.result as string))
      reader.onerror = reject
      reader.readAsDataURL(blob)
    }))
}

function extractBase64(input: string): string {
  const idx = input.indexOf(',')
  return idx >= 0 ? input.slice(idx + 1) : input
}

export async function analyzeMultiRefImages(
  mainUrl: string,
  secondaryUrls: string[],
  productContext: string,
): Promise<{ mainAnalysis: string; secondaryAnalyses: string[]; fusionStrategy: string }> {
  const configured = useSettingsStore.getState().aiAssistantModel
  const model = configured || 'gemini-3-pro-preview'

  const analyzeOne = (url: string) =>
    chatCompletions({
      model,
      messages: [
        { role: 'user', content: [
          { type: 'text', text: ANALYZE_PROMPT },
          { type: 'image_url', image_url: { url } },
        ] },
      ],
    })

  const [mainAnalysis, ...secondaryAnalyses] = await Promise.all([
    analyzeOne(mainUrl),
    ...secondaryUrls.map(u => analyzeOne(u)),
  ])

  const fusionStrategy = await chatCompletions({
    model,
    messages: [
      { role: 'system', content: 'You are an e-commerce image fusion strategist. Given analyses of multiple product images, describe a concrete fusion plan in 60 words max.' },
      { role: 'user', content: `Product context: ${productContext}\n\nMain image:\n${mainAnalysis}\n\nSecondary images:\n${secondaryAnalyses.map((a, i) => `[${i + 1}] ${a}`).join('\n')}` },
    ],
  })

  return { mainAnalysis, secondaryAnalyses, fusionStrategy }
}

export async function buildFusionPrompt(
  mainAnalysis: string,
  secondaryAnalyses: string[],
  userRequest: string,
): Promise<string> {
  const model = useSettingsStore.getState().aiAssistantModel || 'gemini-3-pro-preview'
  return chatCompletions({
    model,
    messages: [
      {
        role: 'system',
        content: 'You are an expert e-commerce image fusion specialist. Combine elements from secondary images INTO the main image while preserving the main subject exactly. Output ONLY the generation prompt (100-150 words).',
      },
      {
        role: 'user',
        content: `Main image analysis:\n${mainAnalysis}\n\nSecondary image analyses:\n${secondaryAnalyses.map((a, i) => `[${i + 1}] ${a}`).join('\n')}\n\nUser request: ${userRequest}`,
      },
    ],
  })
}

interface GenerateMultiRefParams {
  mainUrl: string
  secondaryUrls: string[]
  prompt: string
  aspectRatio?: string
  resolution?: string
}

export async function generateMultiRefImage(params: GenerateMultiRefParams): Promise<{ imageUrl: string; displayUrl: string }> {
  const { mainUrl, secondaryUrls, prompt, aspectRatio, resolution } = params

  const allUrls = [mainUrl, ...secondaryUrls]
  const base64List = await Promise.all(allUrls.map(u => ensureBase64(u)))

  const parts: Record<string, unknown>[] = [{ text: prompt }]
  for (const b64 of base64List) {
    parts.push({ inline_data: { mime_type: 'image/png', data: b64 } })
  }

  const body = {
    contents: [{ role: 'user', parts }],
    generationConfig: {
      responseModalities: ['IMAGE'],
      imageConfig: {
        aspectRatio: aspectRatio || '1:1',
        imageSize: resolution || '2K',
      },
    },
  }

  const resp = await postJson<any>(
    '/v1beta/models/gemini-3-pro-image-preview:generateContent',
    body,
    { authMode: 'query' },
  )

  const data = resp?.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data
  if (!data) throw new Error('Gemini multi-ref fusion returned no image data')

  const displayUrl = `data:image/png;base64,${data}`
  return { imageUrl: displayUrl, displayUrl }
}
