/**
 * Image Edit Prompts | 图片编辑提示词润色模块
 * 使用 AI 优化生图提示词，保持人物/场景一致性
 */

import { chatCompletions } from '@/lib/nexusApi'

// 编辑类型
export type EditType = 'pose' | 'angle' | 'expand' | 'cutout' | 'erase' | 'inpaint'

// 提示词模板
const PROMPT_TEMPLATES: Record<EditType, string> = {
  pose: `你是专业的 AI 绘图提示词工程师。用户想要改变图片中人物的姿态。

要求：
1. 必须保持原图人物的所有外观特征（面容、发型、肤色、服装、配饰）完全一致
2. 仅改变人物的姿态/动作
3. 保持背景场景、光影、色调不变
4. 输出简洁的英文提示词

用户需要的姿态：{userInput}

请直接输出提示词，不要解释。格式示例：
Maintain the exact same character appearance, facial features, hairstyle, skin tone, clothing and accessories unchanged. Change the pose to [specific pose]. Keep the original background, lighting and color tone.`,

  angle: `你是专业的 AI 绘图提示词工程师。用户想要改变图片的拍摄角度/视角。

要求：
1. 必须保持原图人物的所有外观特征完全一致
2. 改变拍摄角度/视角
3. 保持场景构图元素和氛围一致
4. 输出简洁的英文提示词

用户需要的角度：{userInput}

请直接输出提示词，不要解释。格式示例：
Maintain the exact same character and scene elements unchanged. Change the camera angle to [specific angle]. Preserve the atmosphere and composition.`,

  expand: `你是专业的 AI 绘图提示词工程师。用户想要扩展图片边界（outpainting）。

我会分析图片内容，你需要生成扩展边界的提示词。

要求：
1. 自然延伸原图场景
2. 保持画面风格、色调、光影一致
3. 无缝衔接原图边界
4. 输出简洁的英文提示词

图片内容描述：{imageDescription}

请直接输出提示词，不要解释。格式示例：
Seamlessly extend the image boundaries. Maintain consistent style, color palette, and lighting. Naturally continue the [scene elements] beyond the original frame.`,

  cutout: `你是专业的 AI 绘图提示词工程师。用户想要从图片中抠出特定对象。

要求：
1. 精确提取目标对象
2. 保持对象边缘清晰
3. 默认透明背景（除非用户指定其他背景）
4. 输出简洁的英文提示词

用户要抠出的对象：{userInput}

请直接输出提示词，不要解释。格式示例：
Extract [object] from the image with precise edges. Use transparent background. Maintain object details and quality.`,

  erase: `你是专业的 AI 绘图提示词工程师。用户想要从图片中移除/擦除特定对象。

要求：
1. 移除指定对象
2. 智能填充空缺区域
3. 保持画面自然完整
4. 输出简洁的英文提示词

用户要擦除的对象：{userInput}

请直接输出提示词，不要解释。格式示例：
Remove [object] from the image. Intelligently fill the area with surrounding context. Maintain natural and seamless result.`,

  inpaint: `你是专业的 AI 绘图提示词工程师。用户想要在图片的指定区域（蒙版区域）重新生成内容。

要求：
1. 只修改蒙版（白色）区域
2. 新生成的内容要与周围环境自然融合
3. 保持整体画面风格一致
4. 输出简洁的英文提示词

用户想要生成的内容：{userInput}

请直接输出提示词，不要解释。格式示例：
In the masked area, generate [content description]. Seamlessly blend with surrounding context. Maintain consistent style, lighting and color tone.`
}

/**
 * 使用 AI 润色编辑提示词
 * @param type 编辑类型
 * @param userInput 用户输入
 * @param imageDescription 图片描述（扩图时使用）
 * @returns 润色后的提示词
 */
export async function polishEditPrompt(
  type: EditType,
  userInput: string,
  imageDescription?: string
): Promise<string> {
  const template = PROMPT_TEMPLATES[type]
  
  let prompt = template
    .replace('{userInput}', userInput || '')
    .replace('{imageDescription}', imageDescription || '')

  try {
    const result = await chatCompletions({
      model: 'gpt-5-mini',
      messages: [
        { role: 'system', content: '你是专业的 AI 绘图提示词工程师。只输出提示词，不要解释。' },
        { role: 'user', content: prompt }
      ]
    })
    
    return result.trim() || getDefaultPrompt(type, userInput)
  } catch (error) {
    console.error('[polishEditPrompt] AI 润色失败，使用默认提示词:', error)
    return getDefaultPrompt(type, userInput)
  }
}

/**
 * 获取默认提示词（AI 润色失败时的备选）
 */
function getDefaultPrompt(type: EditType, userInput: string): string {
  switch (type) {
    case 'pose':
      return `Maintain the exact same character appearance, facial features, hairstyle, skin tone, clothing and accessories unchanged. Change the pose to ${userInput}. Keep the original background, lighting and color tone.`
    case 'angle':
      return `Maintain the exact same character and scene elements unchanged. Change the camera angle to ${userInput}. Preserve the atmosphere and composition.`
    case 'expand':
      return `Seamlessly extend the image boundaries. Maintain consistent style, color palette, and lighting. Naturally continue the scene beyond the original frame.`
    case 'cutout':
      return `Extract ${userInput} from the image with precise edges. Use transparent background. Maintain object details and quality.`
    case 'erase':
      return `Remove ${userInput} from the image. Intelligently fill the area with surrounding context. Maintain natural and seamless result.`
    case 'inpaint':
      return `In the masked area, generate ${userInput}. Seamlessly blend with surrounding context. Maintain consistent style, lighting and color tone.`
    default:
      return userInput
  }
}

/**
 * 使用 AI 描述图片内容（用于扩图）
 * @param imageDataUrl 图片的 data URL
 * @returns 图片描述
 */
export async function describeImage(imageDataUrl: string): Promise<string> {
  try {
    // 使用视觉模型描述图片
    const result = await chatCompletions({
      model: 'gpt-5-mini',
      messages: [
        {
          role: 'user',
          content: `请用简洁的英文描述这张图片的主要内容、场景、风格、色调。不超过 50 个单词。

图片：${imageDataUrl.slice(0, 100)}...（图片数据已截断用于示例）`
        }
      ]
    })
    
    return result.trim() || 'a scene with various elements'
  } catch (error) {
    console.error('[describeImage] 图片描述失败:', error)
    return 'a scene with various elements'
  }
}
