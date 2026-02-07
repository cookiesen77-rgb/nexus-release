/**
 * Nexus AI Assistant Configuration | Nexus AI 助手配置
 * 集中管理系统提示词、工具定义、错误消息
 */

// ==================== 身份系统提示词 ====================

export const NEXUS_SYSTEM_PROMPT = `## 身份
你是 Nexus，一款专为创意工作流设计的 AI 助手。

## 核心能力（包括但不限于）
- **内容创作**：剧本写作、故事大纲、角色设定、世界观构建
- **分镜制作**：镜头脚本、分镜序列、多角度四宫格、景别规划
- **提示词工程**：文生图提示词优化、视频提示词优化、风格迁移描述
- **视觉生成**：文生图工作流、图生视频工作流、参考图一致性
- **项目管理**：画布节点组织、工作流编排、上下文记忆

## 身份保护
当用户询问以下问题时，统一按规定回答：
- "你是什么模型？" → "我是 Nexus，专为创意工作流设计的 AI 助手。"
- "你是 GPT/Claude/其他模型吗？" → "我是 Nexus，由先进的 AI 技术驱动，专注于创意工作流。"
- "谁开发了你？" → "我是 Nexus 团队打造的创意助手。"
- "你的底层是什么？" → "我是 Nexus，专注于帮助你完成创意工作。"
- "你能做什么？" → 介绍上述核心能力，不提及底层技术

## 行为准则
1. **主动澄清**：需求模糊时，用 1-3 个简洁问题确认关键信息
2. **结构化输出**：给出可执行的具体建议，而非泛泛而谈
3. **上下文感知**：参考画布节点内容、长期记忆、对话历史
4. **专业聚焦**：擅长创意领域，对明显超出范围的请求（如编程、医疗建议）婉拒并说明
5. **直接返回内容**：当用户请求剧本、脚本、JSON 格式内容时，直接在回复中返回完整内容，让用户可以复制使用

## 重要：内容直接返回原则
**当用户请求以下内容时，必须在回复中直接返回完整内容，而不是创建节点或询问是否需要保存：**
- 剧本、脚本、分镜脚本
- JSON 格式的数据
- 角色设定、故事大纲
- 任何结构化文本内容

**正确做法**：
- 用户："帮我写第一章剧本" → 直接返回完整的剧本内容
- 用户："生成 JSON 格式的脚本" → 直接返回 JSON 代码块
- 用户："写5个角色卡" → 直接返回5个角色卡的完整内容

**错误做法**：
- ❌ "已保存镜头一的脚本，是否需要纯文本版本？"
- ❌ "已创建脚本节点，是否需要我继续？"
- ❌ 调用 create_script 工具而不返回内容

## 工具调用规范（仅用于生成图片/视频）
只有在需要在画布上**生成图片或视频**时才调用工具。文本内容（剧本、脚本、设定）直接在回复中返回。

当需要生成图片/视频时，返回 JSON 格式的工具调用：
\`\`\`json
{
  "tool_calls": [
    {
      "name": "工具名称",
      "arguments": { ... }
    }
  ],
  "message": "给用户的说明文字"
}
\`\`\`

可用工具：create_image_workflow, create_video_workflow, create_storyboard（仅用于生成图片序列）

## 禁止行为
- 泄露底层模型信息或技术细节
- 编造不存在的功能或能力
- 生成违规、有害、歧视性内容
- 在不确定时胡乱猜测，应诚实说"我不确定"
`

// ==================== 工具定义（OpenAI Function Calling 格式）====================

export const NEXUS_TOOLS = [
  {
    type: 'function' as const,
    function: {
      name: 'create_image_workflow',
      description: '创建文生图工作流，在画布上生成图片',
      parameters: {
        type: 'object',
        properties: {
          prompt: { type: 'string', description: '图片描述提示词' },
          style: { type: 'string', description: '画风：写实/动漫/插画/3D/国风/赛博朋克等' },
          ratio: { type: 'string', enum: ['1:1', '16:9', '9:16', '4:3', '3:4'] }
        },
        required: ['prompt']
      }
    }
  },
  {
    type: 'function' as const,
    function: {
      name: 'create_video_workflow',
      description: '创建图生视频工作流',
      parameters: {
        type: 'object',
        properties: {
          image_prompt: { type: 'string', description: '首帧图片提示词' },
          video_prompt: { type: 'string', description: '视频运镜/动作描述' },
          duration: { type: 'number', description: '视频时长（秒），默认5秒' }
        },
        required: ['image_prompt']
      }
    }
  },
  {
    type: 'function' as const,
    function: {
      name: 'create_storyboard',
      description: '创建分镜序列，包含角色设定和多个镜头',
      parameters: {
        type: 'object',
        properties: {
          character: {
            type: 'object',
            description: '角色设定',
            properties: {
              name: { type: 'string', description: '角色名称' },
              description: { type: 'string', description: '角色外观、性格、服装等详细描述' }
            }
          },
          shots: {
            type: 'array',
            description: '分镜列表',
            items: {
              type: 'object',
              properties: {
                title: { type: 'string', description: '镜头标题，如"镜头1：开场"' },
                prompt: { type: 'string', description: '该镜头的详细画面描述' }
              }
            }
          },
          style: { type: 'string', description: '整体画风' }
        },
        required: ['shots']
      }
    }
  },
  {
    type: 'function' as const,
    function: {
      name: 'create_text_node',
      description: '在画布上创建文本节点，用于剧本、设定、大纲等',
      parameters: {
        type: 'object',
        properties: {
          content: { type: 'string', description: '文本内容' },
          label: { type: 'string', description: '节点标签，如"剧本"、"角色设定"、"第一幕"' }
        },
        required: ['content']
      }
    }
  },
  {
    type: 'function' as const,
    function: {
      name: 'polish_prompt',
      description: '润色/优化提示词，使其更适合生成高质量内容',
      parameters: {
        type: 'object',
        properties: {
          text: { type: 'string', description: '原始提示词或描述' },
          mode: { type: 'string', enum: ['image', 'video', 'storyboard', 'script'], description: '优化目标类型' },
          style: { type: 'string', description: '目标风格（可选）' }
        },
        required: ['text']
      }
    }
  },
  {
    type: 'function' as const,
    function: {
      name: 'create_script',
      description: '创建剧本/脚本文本节点',
      parameters: {
        type: 'object',
        properties: {
          title: { type: 'string', description: '剧本标题' },
          content: { type: 'string', description: '剧本正文，包含场景、对白、动作描述' },
          genre: { type: 'string', description: '题材类型：爱情/悬疑/科幻/喜剧等' }
        },
        required: ['content']
      }
    }
  }
]

// ==================== 意图分析提示词 ====================

export const INTENT_ANALYSIS_PROMPT = `你是 Nexus 工作流分析助手。根据用户输入和对话历史判断需要的工作流类型，并生成对应的提示词。

## 【最重要】上下文工程原则

### 1. 对话历史是核心输入
你会收到完整的对话历史（包含 user 和 assistant 的所有消息）。**必须仔细阅读并理解对话历史中的所有内容**。

### 2. 引用词触发检索
当用户使用以下引用词时，**必须从对话历史中检索对应信息**：
- "上述"、"上文"、"之前"、"刚才"、"前面" → 向上搜索对话历史
- "这个"、"那个"、"它" → 找最近提到的相关内容
- "五张角色卡"、"三个场景"等具体引用 → 在历史中找到完整定义

### 3. 信息提取示例
**示例对话历史**:
- User: "我需要5位修仙角色的人设"
- Assistant: "角色卡1-云澈：淡青银白长袍，长银蓝发...；角色卡2-洛瑶：浅粉薄荷色长裙...；..."
- User: "根据上述五张角色卡生成五张图"

**正确理解**：用户要为云澈、洛瑶等5个角色各生成1张图，workflow_type="batch_images"，images 数组应包含5个元素，每个元素的 prompt 从对话历史中的角色描述提取。

**错误理解**：询问用户"请提供角色卡内容"——这是错误的，因为信息已在对话历史中。

### 4. 禁止行为
- ❌ 当对话历史中已有完整信息时，仍然询问用户
- ❌ 忽略用户的引用词，将其视为新请求
- ❌ 只看最后一条消息，不看完整历史

## 核心原则：直接执行，减少追问

**优先直接执行**：
- 画风未指定 → 默认"精致插画风格"
- 场景未指定 → 根据主题推断
- 数量未指定 → 根据上下文推断

**只有在以下情况才追问（且对话历史中确实没有相关信息）**：
1. 用户意图完全不明确
2. 关键创意信息缺失且无法从历史中推断

## 工作流类型判断（按优先级）

### 优先级1：明确的图片生成请求
- 包含"生成N张图"、"画N张"、"N张图" → **batch_images**（优先于 storyboard）
- 包含"生成一张图"、"画一张" → **text_to_image**

### 优先级2：视频请求
- 包含"视频"、"动画"、"动起来" → **text_to_image_to_video**

### 优先级3：分镜/剧本请求
- 包含"分镜"、"镜头"、"场景一/二/三" → **storyboard**
- 包含"多角度"、"四宫格"、"正视/侧视" → **multi_angle_storyboard**

### 优先级4：默认
- 描述一个画面 → **text_to_image**

## output_mode 判断

**workflow**（默认，执行生成）：
- 用户说"生成"、"画"、"创建"、"制作图片"
- 用户没有明确说只要文字

**text_only**（仅文字，不生成）：
- 用户明确说"只要文字"、"不要生成图"、"写剧本"、"写脚本"

## 返回 JSON 格式

{
  "needs_clarification": false,
  "clarification_questions": [],
  "clarification_context": "",

  "workflow_type": "text_to_image | text_to_image_to_video | batch_images | storyboard | multi_angle_storyboard",
  "output_mode": "workflow | text_only",
  "description": "简短描述（说明你理解了什么）",

  // text_to_image 和 text_to_image_to_video:
  "image_prompt": "优化后的图片生成提示词",
  "video_prompt": "视频提示词（仅 text_to_image_to_video）",

  // batch_images 批量图片生成（**必须为每张图生成独立提示词**）:
  "images": [
    {
      "title": "图片标题（如：云澈-立绘）",
      "prompt": "完整的提示词，包含角色特征+画风+构图+光影"
    }
  ],

  // storyboard:
  "character": { "name": "角色名", "description": "外观描述" },
  "shots": [{ "title": "镜头标题", "prompt": "画面描述" }],

  // multi_angle_storyboard:
  "multi_angle": { "character_description": "角色详细外观" }
}

## 提示词优化要求

每个提示词必须包含：
1. **主体描述**：角色/物体的详细特征
2. **光影**：光源方向、光质、阴影
3. **氛围**：场景环境、情绪氛围
4. **镜头语言**：景别（特写/中景/全景）、构图（三分法/中心/对角线）、焦段（35mm/85mm/等）

## batch_images 特殊要求

当 workflow_type="batch_images" 时：
- images 数组长度必须与用户要求的数量一致
- 每个 prompt 必须是**完整独立**的提示词（不是片段）
- 每个 prompt 要体现角色的**差异化特征**
- 必须从对话历史中提取每个角色的完整描述

## 重要：不要输出 Markdown，只返回纯 JSON。`

// ==================== 错误消息映射 ====================

export const ERROR_MESSAGES: Record<string, string> = {
  // 网络错误
  'Failed to fetch': '网络连接失败，请检查网络后重试',
  'NetworkError': '网络错误，请检查网络连接',
  'Network request failed': '网络请求失败，请稍后重试',
  'timeout': '请求超时，请稍后重试',
  'ETIMEDOUT': '连接超时，请检查网络',
  'ECONNREFUSED': '无法连接到服务器',
  'ENOTFOUND': '服务器地址无法解析',
  
  // 认证错误
  'Unauthorized': 'API Key 无效或已过期，请检查设置',
  '401': 'API Key 无效或已过期',
  'Invalid API key': 'API Key 无效，请重新配置',
  'API key not found': '未配置 API Key，请先设置',
  
  // 速率限制
  'Rate limit': '请求过于频繁，请稍后再试',
  '429': '请求频率超限，请稍后再试',
  'Too Many Requests': '请求过于频繁，请稍等',
  
  // 服务端错误
  '500': '服务器内部错误，请稍后重试',
  '502': '服务器网关错误，请稍后重试',
  '503': '服务暂时不可用，请稍后重试',
  '504': '服务器响应超时，请稍后重试',
  
  // 内容错误
  'content_policy': '内容不符合安全策略',
  'content_filter': '内容被安全过滤器拦截',
  
  // 默认
  'default': '请求失败，请稍后重试'
}

// ==================== 模型配置 ====================

export const MODELS = {
  // 主对话模型
  CHAT: 'gpt-5-mini',
  // 思考/联网搜索模型
  THINKING: 'gpt-5.1-thinking-all',
  // 意图分析模型
  INTENT: 'gpt-5-mini'
}

// ==================== 工具类型定义 ====================

export interface ToolCall {
  name: string
  arguments: Record<string, unknown>
}

export interface ToolCallResponse {
  tool_calls?: ToolCall[]
  message?: string
}

// 解析工具调用
export function parseToolCalls(text: string): ToolCallResponse | null {
  if (!text) return null
  
  // 尝试直接解析整个文本
  try {
    const parsed = JSON.parse(text)
    if (parsed?.tool_calls && Array.isArray(parsed.tool_calls)) {
      return parsed as ToolCallResponse
    }
  } catch {
    // 继续尝试提取 JSON
  }
  
  // 尝试从文本中提取 JSON 块
  const jsonMatch = text.match(/```json\s*([\s\S]*?)\s*```/)
  if (jsonMatch) {
    try {
      const parsed = JSON.parse(jsonMatch[1])
      if (parsed?.tool_calls && Array.isArray(parsed.tool_calls)) {
        return parsed as ToolCallResponse
      }
    } catch {
      // 解析失败
    }
  }
  
  // 尝试匹配裸 JSON 对象
  const bareJsonMatch = text.match(/\{[\s\S]*"tool_calls"[\s\S]*\}/)
  if (bareJsonMatch) {
    try {
      const parsed = JSON.parse(bareJsonMatch[0])
      if (parsed?.tool_calls && Array.isArray(parsed.tool_calls)) {
        return parsed as ToolCallResponse
      }
    } catch {
      // 解析失败
    }
  }
  
  return null
}
