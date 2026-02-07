import type { EcomDraftV1, EcomSceneType, EcomChatMessage, EcomChatContentPart } from './types'
import { chatCompletions } from '@/lib/nexusApi'
import { useSettingsStore } from '@/store/settings'

const VISION_CAPABLE = /gpt-4o|gpt-5|gemini|claude-3/i

const SCENE_LABELS: Record<EcomSceneType, string> = {
  hero: '主图拍摄',
  detail_page: '详情页套图',
  try_on: '虚拟试穿/数字人',
  poster: '营销海报',
  video: '商品视频',
  batch: '批量生成',
  motion_control: '动作控制',
  multi_elements: '多模态编辑',
}

const BRAND_TONE_MAP: Record<string, string> = {
  luxury: '暗色调 + 暖金/香槟光，低饱和度，高质感，丝绒/大理石/皮革元素',
  playful: '明亮高饱和度色彩，活泼构图，柔和弧线，趣味道具',
  minimal: '纯净白/浅灰背景，极简线条，大量留白，无干扰元素',
  tech: '深灰/黑色底 + 冷蓝/霓虹色，未来科技感，精确几何构图',
  natural: '暖光 + 自然材质，木纹/亚麻/绿植，生活化氛围',
}

export function buildEcomSystemPrompt(draft: EcomDraftV1, activeScene: EcomSceneType): string {
  const p = draft.product

  const productBlock = [
    `产品名称: ${p.name || '未设定'}`,
    p.brand ? `品牌: ${p.brand}` : '',
    p.category ? `品类: ${p.category}` : '',
    p.sellingPoints?.length ? `卖点: ${p.sellingPoints.join('、')}` : '',
    p.description ? `描述: ${p.description}` : '',
    p.targetAudience ? `目标人群: ${p.targetAudience}` : '',
  ].filter(Boolean).join('\n')

  return `你是一位资深电商视觉创意总监，同时精通 AI 图片/视频生成 prompt 工程。

## 专业能力

### 产品摄影布光
- Key light: 主光位于产品 45° 侧上方，Softbox 柔光箱 60×90cm
- Fill light: 对侧反射板或低功率柔光补全暗面
- Rim light: 后侧发丝光勾勒轮廓，分离产品与背景
- 底部: 亚克力/白色亮面板制造倒影，或磨砂板消除反射

### 电商视频运镜
- Dolly in/out: 推拉镜头展示产品全貌→细节过渡
- Orbit: 环绕运镜展示 360° 外观
- Crane: 升降镜头俯瞰→平视转换
- Rack focus: 前后景虚实转换突出细节
- Macro transition: 特写材质纹理的微距过渡

### 品牌调性色彩
${Object.entries(BRAND_TONE_MAP).map(([k, v]) => `- ${k}: ${v}`).join('\n')}

### 平台规格
- 淘宝/天猫主图: 800×800px 白底，五张轮播
- 抖音商品卡: 9:16 竖屏，前3秒黄金钩子
- 小红书: 3:4 竖图，生活化场景

## 当前项目上下文

${productBlock}

当前场景: ${SCENE_LABELS[activeScene] || activeScene}

## 工作要求
1. 输出直接可用于 AI 生成的英文 prompt，不要废话和解释
2. prompt 必须包含具体的光照、构图、色调、材质描述
3. 若用户给出中文需求，先理解再输出英文 prompt
4. 结合当前产品信息和场景类型给出最佳方案`
}

export function compactChatHistory(
  messages: EcomChatMessage[],
  maxTokenEstimate = 8000,
): EcomChatMessage[] {
  if (!messages.length) return []

  const estimateTokens = (msg: EcomChatMessage): number => {
    if (typeof msg.content === 'string') return Math.ceil(msg.content.length / 4)
    return msg.content.reduce((sum, part) => {
      if (part.type === 'text') return sum + Math.ceil(part.text.length / 4)
      return sum + 85
    }, 0)
  }

  const total = messages.reduce((sum, m) => sum + estimateTokens(m), 0)
  if (total <= maxTokenEstimate) return messages

  const system = messages.filter(m => m.role === 'system')
  const nonSystem = messages.filter(m => m.role !== 'system')
  const firstUser = nonSystem.find(m => m.role === 'user')
  const tail = nonSystem.slice(-6)

  const kept = [...system]
  if (firstUser && !tail.includes(firstUser)) kept.push(firstUser)
  kept.push(...tail)
  return kept
}

export async function analyzeEcomImage(imageDataUrl: string, context: string): Promise<string> {
  const analyzePrompt = `请从电商产品摄影角度分析这张图片:
- 产品属性: 品类、材质、颜色、形状
- 构图质量: 角度、留白、主体突出程度
- 光照评估: 主光方向、阴影质量、是否过曝/欠曝
- 背景适用性: 是否适合电商白底、是否需要抠图
- 改进建议: 具体可行的优化方向

${context ? `额外上下文: ${context}` : ''}`

  const configured = useSettingsStore.getState().aiAssistantModel
  const model = configured && VISION_CAPABLE.test(configured) ? configured : 'gpt-4o'

  return chatCompletions({
    model,
    messages: [
      {
        role: 'user',
        content: [
          { type: 'text', text: analyzePrompt },
          { type: 'image_url', image_url: { url: imageDataUrl } },
        ],
      },
    ],
  })
}

export function buildMultimodalMessage(text: string, imageUrls: string[]): EcomChatMessage {
  const content: EcomChatContentPart[] = [{ type: 'text', text }]
  for (const url of imageUrls) {
    content.push({ type: 'image_url', image_url: { url } })
  }
  return { role: 'user', content, timestamp: Date.now() }
}
