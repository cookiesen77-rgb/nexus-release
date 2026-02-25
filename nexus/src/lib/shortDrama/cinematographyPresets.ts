import type {
  ShortDramaCinematography,
  ShortDramaLighting,
  ShortDramaCameraRig,
  ShortDramaDoF,
  ShortDramaSpeedRamp,
  ShortDramaShot,
} from '@/lib/shortDrama/types'

export interface CinematographyPreset {
  id: string
  name: string
  category: 'cinematic' | 'genre' | 'era' | 'stylized'
  lighting: ShortDramaLighting
  cameraRig: ShortDramaCameraRig
  depthOfField: ShortDramaDoF
  atmosphere: string[]
  speedRamp: ShortDramaSpeedRamp
  promptGuidance: string
  referenceFilms?: string[]
}

export const CINEMATOGRAPHY_PRESETS: CinematographyPreset[] = [
  // ── Cinematic ──
  {
    id: 'classic_cinema',
    name: '经典电影',
    category: 'cinematic',
    lighting: 'natural',
    cameraRig: 'dolly',
    depthOfField: 'shallow',
    atmosphere: [],
    speedRamp: 'normal',
    promptGuidance: 'Classical cinematic composition with natural lighting, smooth dolly movements, and shallow depth of field creating elegant visual storytelling.',
    referenceFilms: ['教父', '肖申克的救赎'],
  },
  {
    id: 'film_noir',
    name: '黑色电影',
    category: 'cinematic',
    lighting: 'chiaroscuro',
    cameraRig: 'tripod',
    depthOfField: 'deep',
    atmosphere: ['fog', 'rain'],
    speedRamp: 'normal',
    promptGuidance: 'Film noir aesthetic with dramatic chiaroscuro lighting, high contrast shadows, rain-slicked streets, and moody atmospheric fog.',
    referenceFilms: ['银翼杀手', '唐人街'],
  },
  {
    id: 'documentary',
    name: '纪实风格',
    category: 'cinematic',
    lighting: 'natural',
    cameraRig: 'handheld',
    depthOfField: 'moderate',
    atmosphere: [],
    speedRamp: 'normal',
    promptGuidance: 'Raw documentary style with natural lighting, handheld camera creating authentic and intimate feel, moderate depth of field.',
    referenceFilms: ['城市之光', '人生果实'],
  },
  {
    id: 'epic_blockbuster',
    name: '史诗巨制',
    category: 'cinematic',
    lighting: 'golden_hour',
    cameraRig: 'crane',
    depthOfField: 'deep',
    atmosphere: ['dust', 'light_rays'],
    speedRamp: 'normal',
    promptGuidance: 'Epic cinematic scale with sweeping crane shots, golden hour lighting, atmospheric dust particles, and dramatic god rays creating grandeur.',
    referenceFilms: ['角斗士', '指环王'],
  },
  // ── Genre ──
  {
    id: 'horror_suspense',
    name: '恐怖悬疑',
    category: 'genre',
    lighting: 'low_key',
    cameraRig: 'steadicam',
    depthOfField: 'shallow',
    atmosphere: ['fog', 'haze'],
    speedRamp: 'slow_mo',
    promptGuidance: 'Horror and suspense atmosphere with low-key lighting, lurking shadows, eerie steadicam tracking, fog shrouding the environment.',
    referenceFilms: ['闪灵', '寂静岭'],
  },
  {
    id: 'romance',
    name: '浪漫爱情',
    category: 'genre',
    lighting: 'golden_hour',
    cameraRig: 'slider',
    depthOfField: 'ultra_shallow',
    atmosphere: ['cherry_blossom', 'light_rays'],
    speedRamp: 'slow_mo',
    promptGuidance: 'Romantic warmth with golden hour glow, ultra-shallow depth of field creating dreamy bokeh, gentle slider movements, soft and ethereal.',
    referenceFilms: ['花样年华', '恋恋笔记本'],
  },
  {
    id: 'action',
    name: '动作片',
    category: 'genre',
    lighting: 'natural',
    cameraRig: 'handheld',
    depthOfField: 'moderate',
    atmosphere: ['dust', 'sparks'],
    speedRamp: 'speed_up',
    promptGuidance: 'High-energy action with dynamic handheld camerawork, speed ramping for impact, sparks and debris flying, kinetic visual intensity.',
    referenceFilms: ['疯狂的麦克斯', '谍影重重'],
  },
  {
    id: 'comedy',
    name: '喜剧',
    category: 'genre',
    lighting: 'high_key',
    cameraRig: 'tripod',
    depthOfField: 'deep',
    atmosphere: [],
    speedRamp: 'normal',
    promptGuidance: 'Bright high-key lighting with even illumination, stable framing for comedic timing, clean compositions allowing focus on performance.',
    referenceFilms: ['功夫', '美丽人生'],
  },
  {
    id: 'thriller',
    name: '惊悚',
    category: 'genre',
    lighting: 'low_key',
    cameraRig: 'handheld',
    depthOfField: 'shallow',
    atmosphere: ['haze'],
    speedRamp: 'normal',
    promptGuidance: 'Tense thriller atmosphere with low-key lighting, tight handheld shots creating unease, shallow focus isolating subjects in threatening space.',
    referenceFilms: ['七宗罪', '消失的爱人'],
  },
  // ── Era ──
  {
    id: 'wuxia',
    name: '古典武侠',
    category: 'era',
    lighting: 'natural',
    cameraRig: 'crane',
    depthOfField: 'shallow',
    atmosphere: ['mist', 'falling_leaves'],
    speedRamp: 'slow_mo',
    promptGuidance: 'Classical wuxia aesthetic with misty mountain landscapes, flowing slow-motion martial arts, autumn leaves drifting, poetic and lyrical.',
    referenceFilms: ['卧虎藏龙', '英雄'],
  },
  {
    id: 'period_drama',
    name: '年代剧',
    category: 'era',
    lighting: 'candlelight',
    cameraRig: 'dolly',
    depthOfField: 'moderate',
    atmosphere: ['haze'],
    speedRamp: 'normal',
    promptGuidance: 'Period drama warmth with candlelight and warm practicals, measured dolly movements, atmospheric haze suggesting vintage patina.',
    referenceFilms: ['大红灯笼高高挂', '霸王别姬'],
  },
  {
    id: 'republican_era',
    name: '民国风',
    category: 'era',
    lighting: 'natural',
    cameraRig: 'steadicam',
    depthOfField: 'shallow',
    atmosphere: ['rain', 'fog'],
    speedRamp: 'normal',
    promptGuidance: 'Republican era China aesthetic with muted desaturated tones, rain-washed streets, gas lamp lighting, melancholic elegance.',
    referenceFilms: ['色戒', '一代宗师'],
  },
  // ── Stylized ──
  {
    id: 'cyberpunk',
    name: '赛博朋克',
    category: 'stylized',
    lighting: 'neon',
    cameraRig: 'drone',
    depthOfField: 'shallow',
    atmosphere: ['rain', 'smoke', 'lens_flare'],
    speedRamp: 'normal',
    promptGuidance: 'Cyberpunk neon-drenched urban nightscape, rain-soaked reflections on chrome surfaces, holographic advertisements, drone flyovers of mega-city.',
    referenceFilms: ['银翼杀手2049', '攻壳机动队'],
  },
  {
    id: 'anime_cinematic',
    name: '动漫电影',
    category: 'stylized',
    lighting: 'golden_hour',
    cameraRig: 'slider',
    depthOfField: 'shallow',
    atmosphere: ['cherry_blossom', 'light_rays'],
    speedRamp: 'slow_mo',
    promptGuidance: 'Anime-inspired cinematic with golden light streaming through clouds, cherry blossom petals floating, exaggerated lens flares, vivid color saturation.',
    referenceFilms: ['你的名字', '天气之子'],
  },
  {
    id: 'fairytale',
    name: '童话/奇幻',
    category: 'stylized',
    lighting: 'golden_hour',
    cameraRig: 'crane',
    depthOfField: 'shallow',
    atmosphere: ['fireflies', 'mist', 'light_rays'],
    speedRamp: 'slow_mo',
    promptGuidance: 'Enchanted fairytale atmosphere with magical golden light, fireflies twinkling, ethereal mist, otherworldly beauty and wonder.',
    referenceFilms: ['潘神的迷宫', '大鱼'],
  },
  {
    id: 'minimalist',
    name: '极简主义',
    category: 'stylized',
    lighting: 'natural',
    cameraRig: 'tripod',
    depthOfField: 'deep',
    atmosphere: [],
    speedRamp: 'normal',
    promptGuidance: 'Minimalist visual approach with clean compositions, negative space, static locked-off frames, natural ambient light, architectural precision.',
    referenceFilms: ['小偷家族', '寄生虫'],
  },
  {
    id: 'experimental',
    name: '实验性',
    category: 'stylized',
    lighting: 'neon',
    cameraRig: 'handheld',
    depthOfField: 'ultra_shallow',
    atmosphere: ['smoke', 'particles'],
    speedRamp: 'speed_up',
    promptGuidance: 'Experimental and avant-garde with unconventional angles, fragmented compositions, neon color washes, disorienting speed shifts, dreamlike textures.',
    referenceFilms: ['2001太空漫游', '穆赫兰道'],
  },
]

export function getPresetById(id: string): CinematographyPreset | undefined {
  return CINEMATOGRAPHY_PRESETS.find((p) => p.id === id)
}

export function applyCinematographyPreset(shot: ShortDramaShot, presetId: string): ShortDramaShot {
  const preset = getPresetById(presetId)
  if (!preset) return shot
  const cinematography: ShortDramaCinematography = {
    ...shot.cinematography,
    lighting: preset.lighting,
    cameraRig: preset.cameraRig,
    depthOfField: preset.depthOfField,
    atmosphere: preset.atmosphere,
    speedRamp: preset.speedRamp,
    presetId: preset.id,
  }
  return { ...shot, cinematography }
}

export function getPresetsByCategory(category: CinematographyPreset['category']): CinematographyPreset[] {
  return CINEMATOGRAPHY_PRESETS.filter((p) => p.category === category)
}

export const PRESET_CATEGORIES: { value: CinematographyPreset['category']; label: string }[] = [
  { value: 'cinematic', label: '电影' },
  { value: 'genre', label: '类型片' },
  { value: 'era', label: '时代' },
  { value: 'stylized', label: '风格化' },
]
