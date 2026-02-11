import { chatCompletions } from '@/lib/nexusApi'

export async function autoTagAsset(imageUrl: string): Promise<string[]> {
  const model = 'gemini-3-pro-preview-thinking'
  const resp = await chatCompletions({
    model,
    messages: [{
      role: 'user',
      content: [
        { type: 'text', text: '分析这张图片的内容，返回5-10个描述标签（中文），用英文逗号分隔。只返回标签，不要其他文字。' },
        { type: 'image_url', image_url: { url: imageUrl } },
      ],
    }],
  })
  return String(resp || '').split(/[,，]/).map(t => t.trim()).filter(Boolean).slice(0, 10)
}
