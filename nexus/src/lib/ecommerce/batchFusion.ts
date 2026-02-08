import { chatCompletions } from '@/lib/nexusApi'
import { postJson } from '@/lib/workflow/request'
import { useSettingsStore } from '@/store/settings'
import { safeFetch } from '@/lib/safeFetch'

const ANALYZE_PROMPT = `Analyze this image for e-commerce product fusion. Output in English, max 80 words:
**SUBJECT**: Main subject, material, color, shape
**STYLE**: Visual style, lighting, background
**ELEMENT**: Key element that could be transferred to another image`

const TRYON_SYSTEM_PROMPT = `You are an expert fashion/e-commerce virtual try-on prompt engineer.

Your ONLY job: Write a prompt that makes the AI image model generate a photo of the PERSON from Image 1 WEARING/HOLDING the PRODUCT from Image 2.

CRITICAL RULES:
1. The person's face, body, pose, hair MUST be preserved EXACTLY as in Image 1
2. The product (clothing/accessory/jewelry) from Image 2 MUST replace the corresponding item on the person
3. Describe the FINAL result image — person wearing the new item — not the process
4. Include lighting, background, and photography style that match Image 1
5. NEVER describe the two source images separately — describe ONE final combined photo
6. Output ONLY the prompt text (100-150 words), no explanations, no thinking process, no markdown

Example for clothing: "Professional fashion photograph of [person description] wearing [product description], [pose], [lighting], [background], commercial e-commerce quality"
Example for accessories: "Studio portrait of [person description] wearing [jewelry/accessory description] on [body part], [lighting], [background], product showcase angle"`

function stripThinkingProcess(text: string): string {
  let cleaned = text.replace(/<think>[\s\S]*?<\/think>/gi, '')
  cleaned = cleaned.replace(/^(Let me |I'll |I need to |First,? |Now,? |Here's |Thinking|Step \d).*\n/gim, '')
  cleaned = cleaned.replace(/^\s*[\n\r]+/gm, '')
  return cleaned.trim()
}

function ensureBase64(url: string): Promise<string> {
  if (url.startsWith('data:')) return Promise.resolve(extractBase64(url))
  return safeFetch(url)
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

export async function buildTryOnPrompt(
  modelAnalysis: string,
  productAnalysis: string,
  userRequest: string,
): Promise<string> {
  const model = useSettingsStore.getState().aiAssistantModel || 'gemini-3-pro-preview'
  const raw = await chatCompletions({
    model,
    messages: [
      { role: 'system', content: TRYON_SYSTEM_PROMPT },
      {
        role: 'user',
        content: `PERSON (Image 1):\n${modelAnalysis}\n\nPRODUCT TO WEAR (Image 2):\n${productAnalysis}\n\n${userRequest ? `User's specific instruction: "${userRequest}"` : 'Make the person wear/hold the product naturally.'}`,
      },
    ],
  })
  return stripThinkingProcess(raw)
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
