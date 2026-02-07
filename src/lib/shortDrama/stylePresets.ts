import type { ShortDramaStyle } from '@/lib/shortDrama/types'

export interface ShortDramaStylePreset {
  id: string
  name: string
  description: string
  baseStyleText: string
  baseNegativeText: string
}

export const SHORT_DRAMA_STYLE_PRESETS: ShortDramaStylePreset[] = [
  {
    id: 'cinematic_realism',
    name: '电影写实',
    description: '电影级写实质感，专业光比与镜头语言，适合现代都市/悬疑/爱情短剧',
    baseStyleText: [
      'cinematic realism, film still, anamorphic lens, professional cinematography',
      'consistent character identity across all shots (same face shape, same hair, same clothing, same body proportions)',
      'natural skin texture with subsurface scattering, realistic fabric materials, accurate human anatomy',
      'subtle film grain, shallow depth of field f/2.0, clean rule-of-thirds composition',
      'consistent color grading (warm amber shadows, cool blue highlights), three-point lighting setup (key/fill/rim)',
      'shot on ARRI Alexa, 35mm prime lens, 24fps cinematic motion blur',
    ].join(', '),
    baseNegativeText: [
      'watermark, logo, signature, text, subtitles, UI overlay',
      'extra limbs, extra fingers, deformed hands, bad anatomy, mutated, disfigured',
      'inconsistent character, different face between shots, different outfit, different hairstyle',
      'low quality, blurry, overexposed, underexposed, jpeg artifacts, noise',
      'cartoon, anime, illustration, CGI look, plastic skin, uncanny valley',
    ].join(', '),
  },
  {
    id: 'studio_portrait',
    name: '写真棚拍',
    description: '棚拍商业写真风格，干净可控灯光，适合角色设定图和电商人物展示',
    baseStyleText: [
      'studio portrait photography, clean pure white or light gray backdrop, professional softbox lighting',
      'sharp focus on face and eyes, accurate facial features and proportions, consistent identity across poses',
      'high-end fashion editorial, clean natural skin tones, controlled specular highlights',
      'Rembrandt lighting or butterfly lighting, subtle hair light, catch light in eyes',
      'shot on Canon EOS R5, 85mm f/1.4 portrait lens, studio strobe setup',
    ].join(', '),
    baseNegativeText: [
      'busy background, clutter, harsh shadows, blown highlights, color cast',
      'watermark, text, logo, frame, border',
      'inconsistent face, different makeup, different hairstyle, bad skin texture',
      'low quality, blurry, noise, jpeg artifacts',
    ].join(', '),
  },
  {
    id: 'k_webtoon_vertical',
    name: '韩漫竖屏',
    description: '韩漫条漫质感，现代角色设计+柔和渐变，适合竖屏短剧分镜和恋爱题材',
    baseStyleText: [
      'korean manhwa webtoon style, clean digital art, smooth gradient cel shading',
      'modern character design, sharp jawline, detailed expressive eyes, refined nose and lips',
      'vertical composition optimized (9:16), readable clear silhouettes, consistent character design sheet',
      'soft pastel color palette with vibrant accent colors, clean backgrounds with subtle details',
      'professional digital illustration, crisp lineart with varying line weight',
    ].join(', '),
    baseNegativeText: [
      'watermark, text overlay, speech bubbles, panel borders',
      'messy rough lineart, inconsistent art style between panels, western comic style',
      'bad anatomy, extra fingers, deformed face, asymmetric eyes',
      'pixel art, 3d render, photorealistic, sketch, unfinished',
    ].join(', '),
  },
  {
    id: 'anime_cel_shaded',
    name: '日漫赛璐璐',
    description: '经典赛璐璃动漫画风，线条明确+块面上色，适合热血/校园/奇幻题材',
    baseStyleText: [
      'anime cel shading, clean bold lineart, flat color shading with crisp shadow edges',
      'vibrant saturated colors, anime key visual quality, high detail face and eyes',
      'consistent character model sheet design, consistent costume details and color across all frames',
      'dynamic composition, dramatic camera angles, speed lines for action',
      'studio anime production quality, broadcast-ready keyframe illustration',
    ].join(', '),
    baseNegativeText: [
      'watermark, text, noisy gradients, muddy colors',
      'inconsistent face, inconsistent outfit, inconsistent hair color',
      'blurry, low resolution, bad anatomy, extra fingers, photorealistic',
      'rough sketch, unfinished, messy lines',
    ].join(', '),
  },
  {
    id: 'chinese_costume_drama',
    name: '国风古装',
    description: '国风古装美学：汉服华服+山水意境+氛围光，适合古偶/仙侠/武侠短剧',
    baseStyleText: [
      'chinese costume drama aesthetic, guofeng style, traditional hanfu clothing with intricate embroidery',
      'elegant silk and satin fabric textures, jade and gold hair ornaments, flowing sleeves and ribbons',
      'cinematic atmospheric haze, misty mountains background, ancient chinese architecture',
      'refined warm color palette (vermillion red, jade green, gold, ivory white)',
      'controlled golden hour lighting, soft lens flare through silk curtains',
      'consistent costume details, accessories, and hairstyle across all shots',
    ].join(', '),
    baseNegativeText: [
      'modern clothing, jeans, t-shirt, western style, watermark, text',
      'inconsistent costume, inconsistent hair ornaments, inconsistent accessories',
      'bad anatomy, extra limbs, deformed, low quality, blurry',
      'neon colors, cyberpunk, sci-fi elements',
    ].join(', '),
  },
  {
    id: 'chinese_ink_wash',
    name: '国风水墨',
    description: '传统水墨写意风格，留白+墨韵+朱砂点缀，适合文艺/禅意/历史题材',
    baseStyleText: [
      'chinese ink wash painting style, xieyi technique, traditional brush strokes on rice paper',
      'monochrome ink gradients with selective red (vermillion/朱砂) accent',
      'atmospheric perspective, misty mountains, flowing water, bamboo and pine',
      'elegant negative space composition, poetic mood, zen-like serenity',
      'consistent character silhouette and costume across frames',
    ].join(', '),
    baseNegativeText: [
      'neon colors, modern objects, photorealistic, 3d render',
      'western art style, anime style, digital painting look',
      'cluttered composition, busy background, watermark, text',
    ].join(', '),
  },
  {
    id: 'watercolor_illustration',
    name: '水彩插画',
    description: '水彩与纸张肌理+柔和色块，适合治愈/童话/情绪氛围场景',
    baseStyleText: [
      'watercolor illustration, natural paper texture, soft translucent color washes',
      'gentle wet-on-wet blending, visible brush strokes, organic edge bleeding',
      'pastel color palette with warm undertones, soft natural lighting',
      'clean composition with breathing space, atmospheric depth',
      'consistent character features and color palette across all illustrations',
    ].join(', '),
    baseNegativeText: [
      'watermark, text, digital flat shading, hard edges',
      'muddy colors, over-saturated, noisy, photorealistic',
      'dark, scary, horror, neon, cyberpunk',
    ].join(', '),
  },
  {
    id: 'cyberpunk_neon',
    name: '赛博朋克霓虹',
    description: '夜景霓虹+雨面反光+强光对比，适合科幻/都市悬疑/未来题材',
    baseStyleText: [
      'cyberpunk aesthetic, neon-lit futuristic cityscape, rain-slicked reflective streets',
      'holographic displays, volumetric neon fog, synthwave color palette (magenta, cyan, electric blue)',
      'high contrast cinematic noir lighting, dramatic rim light, lens flare from neon signs',
      'consistent character identity and distinctive cyberpunk outfit across shots',
      'gritty urban texture, chrome and glass materials, atmospheric particle effects',
    ].join(', '),
    baseNegativeText: [
      'daylight, pastoral, watercolor, vintage, bright cheerful',
      'watermark, text, inconsistent character, different outfit',
      'low quality, blurry, flat lighting, washed out colors',
    ].join(', '),
  },
  {
    id: 'pixar_3d_animation',
    name: '3D 动画',
    description: 'Pixar/迪士尼级 3D 渲染质感，适合全年龄/亲子/喜剧短剧',
    baseStyleText: [
      'pixar disney 3d animation style, high quality octane render, subsurface scattering on skin',
      'stylized but appealing character proportions, big expressive eyes, clean topology shaders',
      'consistent 3d character model across all shots (same mesh, same rig, same textures)',
      'soft global illumination, rim light, ambient occlusion, volumetric god rays',
      'colorful vibrant palette, cinematic depth of field, clean composition',
    ].join(', '),
    baseNegativeText: [
      'photorealism, live action, anime, 2d flat',
      'watermark, text, inconsistent 3d model, different proportions between shots',
      'low poly, pixelated, uncanny valley, plastic look, bad topology',
    ].join(', '),
  },
  {
    id: 'film_noir',
    name: '黑色电影悬疑',
    description: '高反差+硬光阴影+低饱和，适合悬疑/犯罪/心理惊悚短剧',
    baseStyleText: [
      'film noir aesthetic, high contrast chiaroscuro lighting, dramatic hard shadows',
      'low-key lighting, venetian blind shadow patterns, smoke and fog atmosphere',
      'desaturated muted color palette or stylized black and white with selective color',
      'dutch angle composition, deep shadows, mysterious silhouettes',
      'consistent character identity, consistent wardrobe (trench coat, fedora, dark tones)',
    ].join(', '),
    baseNegativeText: [
      'bright, colorful, cheerful, cartoon, anime',
      'watermark, text, flat lighting, low contrast, overexposed',
      'inconsistent character, different outfit style',
    ].join(', '),
  },
  {
    id: 'warm_minimal_illustration',
    name: '清新治愈插画',
    description: '暖色+极简干净+柔光，适合轻喜剧/日常/治愈系短剧',
    baseStyleText: [
      'warm minimal illustration, clean simple background, soft diffused lighting',
      'gentle warm color palette (cream, peach, sage green, soft gold)',
      'simple clean shapes, soft rounded edges, comfortable cozy atmosphere',
      'consistent character design with simple distinctive features',
      'flat design with subtle shadows, clean linework, breathing negative space',
    ].join(', '),
    baseNegativeText: [
      'watermark, text, over-detailed, noisy busy background',
      'dark, scary, horror, complex textures, photorealistic',
      'harsh contrast, neon colors, cyberpunk',
    ].join(', '),
  },
  {
    id: 'ghibli_dreamlike',
    name: '吉卜力梦幻',
    description: '吉卜力工作室风格，手绘温暖+梦幻自然，适合奇幻/冒险/成长题材',
    baseStyleText: [
      'studio ghibli style, hand-painted watercolor background, lush detailed nature scenery',
      'soft warm pastel palette, golden hour natural lighting, dreamy atmospheric clouds',
      'expressive character animation style, round friendly face, big emotive eyes',
      'whimsical nostalgic atmosphere, gentle wind effects, floating particles',
      'consistent character features and outfit throughout all scenes',
    ].join(', '),
    baseNegativeText: [
      'photorealistic, 3d render, sharp digital edges, neon',
      'dark, horror, gore, cyberpunk, modern tech',
      'watermark, text, inconsistent character, bad anatomy',
    ].join(', '),
  },
  {
    id: 'retro_90s_anime',
    name: '90年代复古动漫',
    description: '90年代经典赛璐璃+VHS颗粒+暖色模拟，怀旧感社交媒体爆款风格',
    baseStyleText: [
      '90s retro anime aesthetic, vintage cel animation, hand-drawn feel',
      'warm analog color palette, VHS film grain texture, subtle CRT scanline effect',
      'classic anime character design (Sailor Moon / Evangelion era)',
      'nostalgic soft focus, slight chromatic aberration, tape noise at edges',
      'consistent character design in retro style across all frames',
    ].join(', '),
    baseNegativeText: [
      'modern ultra HD, 4K clean digital, 3d render, AI generated look',
      'watermark, text, inconsistent character, western cartoon style',
      'oversaturated, neon, cyberpunk lighting',
    ].join(', '),
  },
  {
    id: 'ecommerce_product',
    name: '电商产品展示',
    description: '专业产品摄影风格，纯净背景+精确打光，适合电商详情页/主图生成',
    baseStyleText: [
      'professional product photography, pure white or gradient background',
      'studio softbox lighting setup, subtle reflection on surface, clean shadow',
      'high resolution macro detail, accurate material texture and color',
      'commercial advertising quality, appetizing/luxurious presentation',
      'consistent product angle and lighting across all shots in a set',
    ].join(', '),
    baseNegativeText: [
      'person, hand, body parts, cluttered background, messy',
      'watermark, text overlay, logo, banner, UI elements',
      'low quality, blurry, wrong color, damaged product, scratches',
      'unrealistic reflection, floating shadow, perspective distortion',
    ].join(', '),
  },
  {
    id: 'ecommerce_lifestyle',
    name: '电商场景生活照',
    description: '生活化场景植入产品，自然光+浅景深，适合社交媒体种草/品牌故事',
    baseStyleText: [
      'lifestyle product photography, natural real-world setting, warm ambient lighting',
      'shallow depth of field f/2.8, bokeh background, golden hour warm tones',
      'aspirational lifestyle scene, cozy inviting atmosphere',
      'product naturally integrated into scene (not forced), eye-catching composition',
      'consistent warm color grading, Instagram-worthy aesthetic',
    ].join(', '),
    baseNegativeText: [
      'studio background, white void, artificial look, harsh flash',
      'watermark, text, cluttered messy scene, dirty surface',
      'low quality, blurry, wrong focus, overexposed',
    ].join(', '),
  },
  {
    id: 'thick_paint_fantasy',
    name: '厚涂幻想油画',
    description: '数字厚涂+戏剧光影+史诗构图，适合奇幻/游戏/史诗级短剧',
    baseStyleText: [
      'digital painting, thick impasto brushstrokes, fantasy concept art',
      'dramatic chiaroscuro lighting, rich oil paint texture, deep shadows',
      'epic cinematic composition, dynamic perspective, atmospheric depth',
      'detailed armor/weapon/costume rendering, magical glowing effects',
      'consistent character design and costume details across artworks',
    ].join(', '),
    baseNegativeText: [
      'flat, cel-shaded, anime, simple, low effort, cartoon',
      'watermark, text, blurry, low quality, jpeg artifacts',
      'inconsistent character, different outfit, modern clothing',
    ].join(', '),
  },
]

export const getShortDramaStylePresetById = (id: string): ShortDramaStylePreset => {
  const key = String(id || '').trim()
  return SHORT_DRAMA_STYLE_PRESETS.find((p) => p.id === key) || SHORT_DRAMA_STYLE_PRESETS[0]
}

export const buildEffectiveStyle = (style: ShortDramaStyle): { styleText: string; negativeText: string } => {
  const preset = getShortDramaStylePresetById(style?.presetId)
  const custom = String(style?.customText || '').trim()
  const negative = String(style?.negativeText || '').trim()

  const styleText = [preset.baseStyleText, custom].map((s) => String(s || '').trim()).filter(Boolean).join('\n')
  const negativeText = [preset.baseNegativeText, negative].map((s) => String(s || '').trim()).filter(Boolean).join(', ')
  return { styleText, negativeText }
}
