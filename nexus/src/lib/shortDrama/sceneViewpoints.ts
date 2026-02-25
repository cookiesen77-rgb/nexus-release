import type { ShortDramaScene, ShortDramaShot, ShortDramaSceneViewpoint, ShortDramaMediaSlot } from '@/lib/shortDrama/types'

export type ViewpointType = 'wide_establishing' | 'medium_interaction' | 'close_detail' | 'pov_character' | 'overhead' | 'low_angle'

export interface GeneratedViewpoint {
  name: string
  nameEn: string
  type: ViewpointType
  description: string
  promptFragment: string
}

const KEYWORD_VIEWPOINTS: { keywords: RegExp; viewpoint: GeneratedViewpoint }[] = [
  {
    keywords: /餐桌|饭桌|吃饭|用餐|宴席/,
    viewpoint: { name: '餐桌区', nameEn: 'Dining Area', type: 'medium_interaction', description: '餐桌区域中景', promptFragment: 'medium shot at the dining table, eye-level angle' },
  },
  {
    keywords: /沙发|客厅|起居/,
    viewpoint: { name: '客厅区', nameEn: 'Living Room', type: 'medium_interaction', description: '客厅沙发区域', promptFragment: 'medium shot in the living room, sofa area visible' },
  },
  {
    keywords: /窗|窗边|窗户|阳台/,
    viewpoint: { name: '窗边', nameEn: 'Window Side', type: 'close_detail', description: '窗边逆光特写', promptFragment: 'close-up near the window, backlit silhouette, natural light' },
  },
  {
    keywords: /门|门口|玄关|入口/,
    viewpoint: { name: '门口', nameEn: 'Doorway', type: 'medium_interaction', description: '门口出入场景', promptFragment: 'shot framed through the doorway, depth composition' },
  },
  {
    keywords: /街|路|马路|巷|胡同/,
    viewpoint: { name: '街道', nameEn: 'Street View', type: 'wide_establishing', description: '街道全景', promptFragment: 'wide establishing shot of the street, perspective depth' },
  },
  {
    keywords: /办公|桌|电脑|工位/,
    viewpoint: { name: '办公区', nameEn: 'Office Area', type: 'medium_interaction', description: '办公桌区域', promptFragment: 'medium shot at the desk, office environment' },
  },
  {
    keywords: /床|卧室|睡/,
    viewpoint: { name: '卧室', nameEn: 'Bedroom', type: 'close_detail', description: '卧室私密空间', promptFragment: 'intimate close shot in bedroom, warm lighting' },
  },
  {
    keywords: /车|轿车|出租|开车|驾驶/,
    viewpoint: { name: '车内', nameEn: 'Car Interior', type: 'close_detail', description: '车内视角', promptFragment: 'interior car shot, dashboard visible, confined space' },
  },
  {
    keywords: /庭院|花园|院子|天井/,
    viewpoint: { name: '庭院', nameEn: 'Courtyard', type: 'wide_establishing', description: '庭院全景', promptFragment: 'wide shot of the courtyard, natural greenery visible' },
  },
  {
    keywords: /山|悬崖|峡谷|高处|山顶/,
    viewpoint: { name: '高处俯瞰', nameEn: 'Overlook', type: 'overhead', description: '高处俯视', promptFragment: 'high angle overhead shot, looking down from elevated position' },
  },
  {
    keywords: /仰|跪|低处|地面/,
    viewpoint: { name: '低角度', nameEn: 'Low Angle', type: 'low_angle', description: '低角度仰拍', promptFragment: 'low angle shot looking upward, dramatic perspective' },
  },
  {
    keywords: /宫殿|大殿|皇宫|朝堂/,
    viewpoint: { name: '大殿', nameEn: 'Grand Hall', type: 'wide_establishing', description: '宫殿大殿全景', promptFragment: 'wide establishing shot of the grand palace hall, majestic architecture' },
  },
  {
    keywords: /酒吧|夜店|舞池|吧台/,
    viewpoint: { name: '吧台区', nameEn: 'Bar Area', type: 'medium_interaction', description: '吧台区域', promptFragment: 'medium shot at the bar counter, neon ambient lighting' },
  },
  {
    keywords: /医院|病房|手术/,
    viewpoint: { name: '病房', nameEn: 'Hospital Room', type: 'close_detail', description: '病房内景', promptFragment: 'close shot in hospital room, sterile white lighting' },
  },
  {
    keywords: /教室|学校|课堂/,
    viewpoint: { name: '教室', nameEn: 'Classroom', type: 'medium_interaction', description: '教室环境', promptFragment: 'medium shot in classroom, rows of desks visible' },
  },
]

const DEFAULT_VIEWPOINTS: GeneratedViewpoint[] = [
  { name: '全景', nameEn: 'Wide Establishing', type: 'wide_establishing', description: '场景全景建立镜头', promptFragment: 'wide establishing shot showing the entire scene environment' },
  { name: '中景', nameEn: 'Medium Shot', type: 'medium_interaction', description: '人物互动中景', promptFragment: 'medium shot framing character interaction, waist-up' },
  { name: '特写', nameEn: 'Close-up', type: 'close_detail', description: '细节特写', promptFragment: 'close-up detail shot, shallow depth of field' },
]

export function extractViewpointsFromKeywords(description: string): GeneratedViewpoint[] {
  const matched: GeneratedViewpoint[] = []
  const usedTypes = new Set<ViewpointType>()

  for (const entry of KEYWORD_VIEWPOINTS) {
    if (entry.keywords.test(description) && !usedTypes.has(entry.viewpoint.type)) {
      matched.push(entry.viewpoint)
      usedTypes.add(entry.viewpoint.type)
      if (matched.length >= 4) break
    }
  }

  for (const dv of DEFAULT_VIEWPOINTS) {
    if (!usedTypes.has(dv.type)) {
      matched.push(dv)
      usedTypes.add(dv.type)
    }
    if (matched.length >= 4) break
  }

  return matched
}

const makeId = () => globalThis.crypto?.randomUUID?.() || `vp_${Date.now()}_${Math.random().toString(16).slice(2)}`

function emptySlot(): ShortDramaMediaSlot {
  return { id: makeId(), kind: 'image', variants: [] }
}

export function convertToSceneViewpoints(viewpoints: GeneratedViewpoint[]): ShortDramaSceneViewpoint[] {
  return viewpoints.map((vp) => ({
    id: makeId(),
    name: vp.name,
    description: `${vp.description} (${vp.nameEn})`,
    ref: emptySlot(),
  }))
}

export function buildViewpointAnalysisPrompt(scene: ShortDramaScene, shots: ShortDramaShot[]): string {
  const shotContext = shots
    .filter((s) => s.sceneId === scene.id)
    .slice(0, 10)
    .map((s) => `- ${s.title}: ${s.beat || s.scriptExcerpt || ''}`.slice(0, 100))
    .join('\n')

  return `为以下场景生成 3-4 个摄影机位视角。

【场景】
名称：${scene.name}
描述：${scene.description}

【相关镜头】
${shotContext || '(无)'}

返回JSON：
{
  "viewpoints": [
    {
      "name": "中文名称",
      "nameEn": "English Name",
      "type": "wide_establishing|medium_interaction|close_detail|pov_character|overhead|low_angle",
      "description": "描述",
      "promptFragment": "English prompt fragment for image generation"
    }
  ]
}`
}
