/**
 * Workflow Templates Configuration | 工作流模板配置
 * 预设工作流模板，支持一键添加到画布
 */
import { DEFAULT_IMAGE_MODEL, DEFAULT_IMAGE_SIZE } from './models'
import workflowCover from '@/assets/workflow01.jpeg'

const COMIC_IMAGE_MODEL = 'gemini-3-pro-image-preview'
const COMIC_IMAGE_SIZE = '3:4'
const COMIC_IMAGE_QUALITY = '2K'
const COMIC_DEFAULT_PAGES = 4
// Multi-angle prompts | 多角度提示词模板
export const MULTI_ANGLE_PROMPTS = {
  front: {
    label: '正视',
    english: 'Front View',
    prompt: (character) => `使用提供的图片，生成四宫格分镜，每张四宫格包括人物正面对着镜头的4个景别（远景、中景、近景、和局部特写），保持场景、产品、人物特征的一致性，宫格里的每一张照片保持和提供图片相同的比例。并在图片下方用英文标注这个景别

角色参考: ${character}`
  },
  side: {
    label: '侧视',
    english: 'Side View', 
    prompt: (character) => `使用提供的图片，分别生成四宫格分镜，每张四宫格包括人物侧面角度的4个景别（远景、中景、近景、和局部特写），保持场景、产品、人物特征的一致性，宫格里的每一张照片保持和提供图片相同的比例。并在图片下方用英文标注这个景别

角色参考: ${character}`
  },
  back: {
    label: '后视',
    english: 'Back View',
    prompt: (character) => `使用提供的图片，分别生成四宫格分镜，每张四宫格包括人物背影角度的4个景别（远景、中景、近景、和局部特写），保持场景、产品、人物特征的一致性，宫格里的每一张照片保持和提供图片相同的比例。并在图片下方用英文标注这个景别

角色参考: ${character}`
  },
  top: {
    label: '俯视',
    english: 'Top/Bird\'s Eye View',
    prompt: (character) => `使用提供的图片，分别生成四宫格分镜，每张四宫格包括俯视角度的4个景别（远景、中景、近景、和局部特写），保持场景、产品、人物特征的一致性，宫格里的每一张照片保持和提供图片相同的比例。并在图片下方用英文标注这个景别

角色参考: ${character}`
  }
}

/**
 * Workflow Templates | 工作流模板
 */
export const WORKFLOW_TEMPLATES = [
  {
    id: 'comic',
    name: '漫画',
    description: '知识漫画分镜模板（默认 4 页，可自行增删）',
    icon: 'ImageOutline',
    category: 'storyboard',
    cover: workflowCover,
    createNodes: (startPosition) => {
      const nodeSpacing = 400
      const rowSpacing = 240

      const nodes = []
      const edges = []
      let nodeIdCounter = 0
      const getNodeId = () => `workflow_node_${Date.now()}_${nodeIdCounter++}`

      const addTextNode = (x, y, label, content = '') => {
        const id = getNodeId()
        nodes.push({
          id,
          type: 'text',
          position: { x, y },
          data: { label, content }
        })
        return id
      }

      const addImageConfigNode = (x, y, label) => {
        const id = getNodeId()
        nodes.push({
          id,
          type: 'imageConfig',
          position: { x, y },
          data: {
            label,
            model: COMIC_IMAGE_MODEL,
            size: COMIC_IMAGE_SIZE,
            quality: COMIC_IMAGE_QUALITY
          }
        })
        return id
      }

      const addImageNode = (x, y, label) => {
        const id = getNodeId()
        nodes.push({
          id,
          type: 'image',
          position: { x, y },
          data: {
            url: '',
            label
          }
        })
        return id
      }

      const col = (index) => startPosition.x + nodeSpacing * index
      const row = (index) => startPosition.y + rowSpacing * index

      // Row 0: Source + analysis
      addTextNode(col(0), row(0), '素材/主题', '')
      addTextNode(col(1), row(0), '分析 Prompt', '使用提示词库「漫画」→「内容分析」模板生成分析')
      addTextNode(col(2), row(0), '分析结果（可选）', '')

      // Row 1: Storyboard options
      addTextNode(col(0), row(1), '分镜方案 A（时间线）', '适合传记 / 事件推进')
      addTextNode(col(1), row(1), '分镜方案 B（主题分区）', '适合知识点拆解')
      addTextNode(col(2), row(1), '分镜方案 C（人物关系）', '适合情感驱动')
      addTextNode(col(3), row(1), '最终分镜', '整理为封面 + 分页脚本（默认 4 页）')

      // Row 2: Character bible + reference
      const bibleId = addTextNode(col(0), row(2), '角色&美术 Bible', '角色设定 / 画风 / 色板 / 禁忌')
      const characterConfigId = addImageConfigNode(col(1), row(2), '角色参考图')
      const characterImageId = addImageNode(col(2), row(2), '角色参考图')

      edges.push({
        id: `edge_${bibleId}_${characterConfigId}`,
        source: bibleId,
        target: characterConfigId,
        sourceHandle: 'right',
        targetHandle: 'left'
      })
      edges.push({
        id: `edge_${characterConfigId}_${characterImageId}`,
        source: characterConfigId,
        target: characterImageId,
        sourceHandle: 'right',
        targetHandle: 'left'
      })

      // Row 3: Cover
      const coverTextId = addTextNode(col(0), row(3), '封面提示词', '标题 / 主视觉 / 风格 / 构图')
      const coverConfigId = addImageConfigNode(col(1), row(3), '封面')
      const coverImageId = addImageNode(col(2), row(3), '封面结果')

      edges.push({
        id: `edge_${coverTextId}_${coverConfigId}`,
        source: coverTextId,
        target: coverConfigId,
        sourceHandle: 'right',
        targetHandle: 'left'
      })
      edges.push({
        id: `edge_${bibleId}_${coverConfigId}`,
        source: bibleId,
        target: coverConfigId,
        sourceHandle: 'right',
        targetHandle: 'left'
      })
      edges.push({
        id: `edge_${characterImageId}_${coverConfigId}`,
        source: characterImageId,
        target: coverConfigId,
        sourceHandle: 'right',
        targetHandle: 'left'
      })
      edges.push({
        id: `edge_${coverConfigId}_${coverImageId}`,
        source: coverConfigId,
        target: coverImageId,
        sourceHandle: 'right',
        targetHandle: 'left'
      })

      // Rows 4-7: Pages (default 4)
      for (let i = 1; i <= COMIC_DEFAULT_PAGES; i += 1) {
        const pageRow = 3 + i
        const pageTextId = addTextNode(
          col(0),
          row(pageRow),
          `第${i}页提示词`,
          `第${i}页：场景 / 人物 / 动作 / 镜头 / 文案（保持与角色参考图一致）`
        )
        const pageConfigId = addImageConfigNode(col(1), row(pageRow), `第${i}页`)
        const pageImageId = addImageNode(col(2), row(pageRow), `第${i}页结果`)

        edges.push({
          id: `edge_${pageTextId}_${pageConfigId}`,
          source: pageTextId,
          target: pageConfigId,
          sourceHandle: 'right',
          targetHandle: 'left'
        })
        edges.push({
          id: `edge_${bibleId}_${pageConfigId}`,
          source: bibleId,
          target: pageConfigId,
          sourceHandle: 'right',
          targetHandle: 'left'
        })
        edges.push({
          id: `edge_${characterImageId}_${pageConfigId}`,
          source: characterImageId,
          target: pageConfigId,
          sourceHandle: 'right',
          targetHandle: 'left'
        })
        edges.push({
          id: `edge_${pageConfigId}_${pageImageId}`,
          source: pageConfigId,
          target: pageImageId,
          sourceHandle: 'right',
          targetHandle: 'left'
        })
      }

      return { nodes, edges }
    }
  },
  {
    id: 'multi-angle-storyboard',
    name: '多角度分镜',
    description: '生成角色的正视、侧视、后视、俯视四宫格分镜图',
    icon: 'GridOutline',
    category: 'storyboard',
    cover: workflowCover,
    // 节点配置
    createNodes: (startPosition) => {
      const nodeSpacing = 400
      const rowSpacing = 280
      const angles = ['front', 'side', 'back', 'top']
      
      const nodes = []
      const edges = []
      let nodeIdCounter = 0
      const getNodeId = () => `workflow_node_${Date.now()}_${nodeIdCounter++}`
      
      // 主角色图：提示词 + 文生图配置
      const characterTextId = getNodeId()
      nodes.push({
        id: characterTextId,
        type: 'text',
        position: { x: startPosition.x, y: startPosition.y + rowSpacing * 1.5 },
        data: {
          content: '',
          label: '角色提示词'
        }
      })
      
      const characterConfigId = getNodeId()
      nodes.push({
        id: characterConfigId,
        type: 'imageConfig',
        position: { x: startPosition.x + nodeSpacing, y: startPosition.y + rowSpacing * 1.5 },
        data: {
          label: '主角色图',
          model: DEFAULT_IMAGE_MODEL,
          size: DEFAULT_IMAGE_SIZE
        }
      })
      
      // 主角色图结果节点（空白图片节点）
      const characterImageId = getNodeId()
      nodes.push({
        id: characterImageId,
        type: 'image',
        position: { x: startPosition.x + nodeSpacing * 2, y: startPosition.y + rowSpacing * 1.5 },
        data: {
          url: '',
          label: '角色图结果'
        }
      })
      
      // 连线：角色提示词 → 角色图配置
      edges.push({
        id: `edge_${characterTextId}_${characterConfigId}`,
        source: characterTextId,
        target: characterConfigId,
        sourceHandle: 'right',
        targetHandle: 'left'
      })
      
      // 连线：角色图配置 → 角色图结果
      edges.push({
        id: `edge_${characterConfigId}_${characterImageId}`,
        source: characterConfigId,
        target: characterImageId,
        sourceHandle: 'right',
        targetHandle: 'left'
      })
      
      // 创建4个角度的节点
      const angleX = startPosition.x + nodeSpacing * 3 + 100
      
      angles.forEach((angleKey, index) => {
        const angleConfig = MULTI_ANGLE_PROMPTS[angleKey]
        const angleY = startPosition.y + index * rowSpacing
        let currentX = angleX
        
        // 提示词节点（预填充默认提示词）
        const textNodeId = getNodeId()
        nodes.push({
          id: textNodeId,
          type: 'text',
          position: { x: currentX, y: angleY },
          data: {
            content: angleConfig.prompt(''),
            label: `${angleConfig.label}提示词`
          }
        })
        currentX += nodeSpacing
        
        // 图片配置节点
        const configNodeId = getNodeId()
        nodes.push({
          id: configNodeId,
          type: 'imageConfig',
          position: { x: currentX, y: angleY },
        data: {
          label: `${angleConfig.label} (${angleConfig.english})`,
          model: DEFAULT_IMAGE_MODEL,
          size: DEFAULT_IMAGE_SIZE
        }
      })
        
        // 连线：提示词 → 配置
        edges.push({
          id: `edge_${textNodeId}_${configNodeId}`,
          source: textNodeId,
          target: configNodeId,
          sourceHandle: 'right',
          targetHandle: 'left'
        })
        
        // 连线：角色图结果 → 角度配置（参考图）
        edges.push({
          id: `edge_${characterImageId}_${configNodeId}`,
          source: characterImageId,
          target: configNodeId,
          sourceHandle: 'right',
          targetHandle: 'left'
        })
      })
      
      return { nodes, edges }
    }
  }
]

/**
 * Get workflow template by ID | 根据ID获取工作流模板
 */
export const getWorkflowById = (id) => {
  return WORKFLOW_TEMPLATES.find(w => w.id === id)
}

/**
 * Get workflows by category | 根据分类获取工作流
 */
export const getWorkflowsByCategory = (category) => {
  return WORKFLOW_TEMPLATES.filter(w => w.category === category)
}

export default WORKFLOW_TEMPLATES
