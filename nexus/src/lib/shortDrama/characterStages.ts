import type {
  ShortDramaCharacter,
  ShortDramaCostumeVariation,
  ShortDramaDraftV2,
} from '@/lib/shortDrama/types'

export interface CharacterStageAnalysis {
  characterId: string
  characterName: string
  needsMultiStage: boolean
  reason: string
  stages: StageVariationData[]
  consistencyElements: {
    facialFeatures: string
    bodyType: string
    uniqueMarks: string
  }
}

export interface StageVariationData {
  name: string
  episodeRange: [number, number]
  ageDescription: string
  stageDescription: string
  visualPromptEn: string
  visualPromptZh: string
}

export function getVariationForEpisode(
  character: ShortDramaCharacter,
  episodeIndex: number
): ShortDramaCostumeVariation | undefined {
  if (!character.costumes) return undefined
  return character.costumes.find(
    (c) => c.stageType === 'age' && c.episodeRange && episodeIndex >= c.episodeRange[0] && episodeIndex <= c.episodeRange[1]
  )
}

export function buildStageAwarePrompt(
  character: ShortDramaCharacter,
  episodeIndex: number,
  basePrompt: string
): string {
  const variation = getVariationForEpisode(character, episodeIndex)
  if (!variation) return basePrompt

  const stageDesc = [
    variation.visualPromptEn,
    variation.ageDescription ? `age: ${variation.ageDescription}` : '',
  ].filter(Boolean).join(', ')

  return stageDesc ? `${basePrompt}, ${stageDesc}` : basePrompt
}

export function convertAnalysisToVariations(
  analysis: CharacterStageAnalysis
): Omit<ShortDramaCostumeVariation, 'id'>[] {
  if (!analysis.needsMultiStage || analysis.stages.length === 0) return []

  return analysis.stages.map((stage) => ({
    name: stage.name,
    description: stage.stageDescription,
    stageType: 'age' as const,
    episodeRange: stage.episodeRange,
    ageDescription: stage.ageDescription,
    visualPromptEn: [
      analysis.consistencyElements.facialFeatures,
      analysis.consistencyElements.bodyType,
      analysis.consistencyElements.uniqueMarks,
      stage.visualPromptEn,
    ].filter(Boolean).join(', '),
    visualPromptZh: stage.visualPromptZh,
  }))
}

export function buildCharacterStagePrompt(
  draft: ShortDramaDraftV2
): string {
  const mainCharacters = draft.characters.slice(0, 5)
  if (mainCharacters.length === 0) return ''

  const totalEpisodes = draft.episodes?.length || draft.shots.length

  return `【剧本信息】
剧名：《${draft.title}》
总集数：${totalEpisodes}集
大纲：${(draft.logline || '').slice(0, 1500)}

【需要分析的角色】
${mainCharacters.map((c) => `角色：${c.name}\n描述：${c.description.slice(0, 200)}`).join('\n\n')}

请分析每个角色是否需要多阶段形象变体。

返回JSON格式：
{
  "analyses": [
    {
      "characterName": "角色名",
      "needsMultiStage": true,
      "reason": "判断理由",
      "stages": [
        {
          "name": "青年版",
          "episodeRange": [1, 15],
          "ageDescription": "25岁",
          "stageDescription": "外貌和状态描述",
          "visualPromptEn": "English visual prompt",
          "visualPromptZh": "中文视觉提示"
        }
      ],
      "consistencyElements": {
        "facialFeatures": "facial description",
        "bodyType": "body description",
        "uniqueMarks": "unique marks"
      }
    }
  ]
}`
}
