/**
 * Director Console Presets | 导演台预设配置
 * 专业级 AI 生图预设模板
 */

export interface DirectorPreset {
  id: string
  name: string
  description: string
  aspectRatio: string
  resolution: '1K' | '2K' | '4K'
  systemPrompt: string           // AI 润色系统提示词
  promptTemplate: string         // 提示词模板
  userPromptPlaceholder: string  // 用户输入引导
  supportsReferenceImage: boolean
  referenceImageGuide?: string   // 参考图引导
  outputType: 'single' | 'grid'  // 输出类型
  autoGenerate?: boolean         // 是否自动出图（用户可配置）
  isCustom?: boolean             // 是否为用户自定义预设
}

// 用户自定义预设存储 key
const USER_PRESETS_KEY = 'nexus-director-user-presets'

/**
 * 获取用户自定义预设
 */
export function getUserPresets(): DirectorPreset[] {
  try {
    const saved = localStorage.getItem(USER_PRESETS_KEY)
    if (saved) {
      const presets = JSON.parse(saved)
      return Array.isArray(presets) ? presets.map(p => ({ ...p, isCustom: true })) : []
    }
  } catch (e) {
    console.warn('[getUserPresets] 读取用户预设失败:', e)
  }
  return []
}

/**
 * 保存用户自定义预设
 */
export function saveUserPreset(preset: DirectorPreset): void {
  const presets = getUserPresets()
  const existingIndex = presets.findIndex(p => p.id === preset.id)
  if (existingIndex >= 0) {
    presets[existingIndex] = { ...preset, isCustom: true }
  } else {
    presets.push({ ...preset, isCustom: true })
  }
  try {
    localStorage.setItem(USER_PRESETS_KEY, JSON.stringify(presets))
  } catch (e) {
    console.error('[saveUserPreset] 保存用户预设失败:', e)
  }
}

/**
 * 删除用户自定义预设
 */
export function deleteUserPreset(presetId: string): void {
  const presets = getUserPresets().filter(p => p.id !== presetId)
  try {
    localStorage.setItem(USER_PRESETS_KEY, JSON.stringify(presets))
  } catch (e) {
    console.error('[deleteUserPreset] 删除用户预设失败:', e)
  }
}

/**
 * 获取所有预设（系统预设 + 用户预设）
 */
export function getAllPresets(): DirectorPreset[] {
  return [...getUserPresets(), ...DIRECTOR_PRESETS]
}

/**
 * AI 润色通用系统提示词
 */
export const POLISH_SYSTEM_PROMPT = `You are a world-class AI image prompt engineer specializing in cinematic visualization and character design. Your task is to transform user descriptions into professional, detailed prompts that produce stunning, consistent results.

Core Principles:
1. CONSISTENCY: Maintain absolute visual consistency for characters (face, hair, clothing, body type)
2. CINEMATOGRAPHY: Apply professional film language (shot types, angles, lighting)
3. DETAIL: Include specific visual details that anchor the image generation
4. STRUCTURE: Follow the template structure precisely
5. QUALITY: Always include quality enhancers and negative prompts

When given a reference image, analyze and extract:
- Character appearance details (facial features, hairstyle, skin tone, body type)
- Clothing and accessories
- Art style and aesthetic
- Color palette
- Lighting characteristics

Output ONLY the polished prompt, no explanations.`

/**
 * 预设配置列表
 */
export const DIRECTOR_PRESETS: DirectorPreset[] = [
  // ========== 无预设 ==========
  {
    id: 'none',
    name: '无预设',
    description: '自由创作，不使用预设模板',
    aspectRatio: '16:9',
    resolution: '2K',
    systemPrompt: POLISH_SYSTEM_PROMPT,
    promptTemplate: '',
    userPromptPlaceholder: '描述你想要生成的图片...',
    supportsReferenceImage: true,
    outputType: 'single'
  },

  // ========== 九宫格分镜（纯图像版） ==========
  {
    id: 'storyboard_9_pure',
    name: '九宫格分镜（纯图像版）',
    description: '电影级分镜，无镜头头标注，纯图片',
    aspectRatio: '1:1',
    resolution: '2K',
    systemPrompt: `${POLISH_SYSTEM_PROMPT}

For 9-panel storyboard, you must:
1. Ensure the same character appears consistently in all 9 panels
2. Progress the story logically from panel 1 to 9
3. Use varied shot types (wide, medium, close-up) for visual rhythm
4. Maintain consistent lighting and color grading throughout
5. Create cinematic compositions in each panel`,
    promptTemplate: `A professional cinematic 3x3 storyboard grid, 9 panels total.

【SCENE】
{{USER_PROMPT}}

【CHARACTER CONSISTENCY】
{{CHARACTER_DESC}}

【PANEL LAYOUT】
Row 1 (Establishing):
- Panel 1: Extreme wide shot, establishing the environment and mood
- Panel 2: Wide shot, introducing the main character in context
- Panel 3: Medium-wide shot, character interaction with environment

Row 2 (Development):
- Panel 4: Medium shot, character emotion and action
- Panel 5: Medium close-up, key story beat or dialogue moment
- Panel 6: Close-up, emotional reaction or important detail

Row 3 (Climax):
- Panel 7: Dynamic angle (low/high), tension or action peak
- Panel 8: Extreme close-up, critical emotional moment
- Panel 9: Resolution shot, story conclusion or cliffhanger

【STYLE】
Cinematic film storyboard, professional composition, dramatic lighting, consistent color grading across all panels, 4K ultra-detailed, masterpiece quality.

【TECHNICAL】
- Clean panel borders with subtle shadows
- No text, no labels, no watermarks
- Seamless visual flow between panels
- Professional aspect ratio within each panel

【NEGATIVE】
Blurry, low quality, text, watermark, signature, inconsistent characters, different art styles between panels, amateur composition, flat lighting.`,
    userPromptPlaceholder: '描述场景和故事：例如"雪山之巅，狂风夹裹雪花，登山者（中国男人）身着专业装备，手抓冰镐在攀登..."',
    supportsReferenceImage: true,
    referenceImageGuide: '上传角色或场景参考图，AI 将保持视觉一致性',
    outputType: 'grid'
  },

  // ========== 九宫格分镜（导演版） ==========
  {
    id: 'storyboard_9_director',
    name: '九宫格分镜（导演版）',
    description: '电影级分镜，导演镜头，有镜头标注',
    aspectRatio: '1:1',
    resolution: '2K',
    systemPrompt: `${POLISH_SYSTEM_PROMPT}

For Director's Cut storyboard:
1. Include professional cinematography terminology in each panel
2. Add shot type labels (EWS, WS, MS, MCU, CU, ECU)
3. Include camera movement notes (DOLLY, PAN, TILT, CRANE)
4. Maintain absolute character consistency
5. Create a professional film production reference`,
    promptTemplate: `A professional Director's Cut 3x3 storyboard grid with cinematography annotations.

【SCENE】
{{USER_PROMPT}}

【CHARACTER CONSISTENCY】
{{CHARACTER_DESC}}

【PANEL LAYOUT WITH DIRECTOR NOTES】
Row 1 - ESTABLISHING:
- Panel 1: [EWS - Extreme Wide Shot] {{SCENE_ESTABLISH}} | CRANE DOWN
- Panel 2: [WS - Wide Shot] {{CHARACTER_INTRO}} | DOLLY IN
- Panel 3: [MWS - Medium Wide Shot] {{CONTEXT_ACTION}} | PAN RIGHT

Row 2 - DEVELOPMENT:
- Panel 4: [MS - Medium Shot] {{CORE_ACTION}} | STATIC
- Panel 5: [MCU - Medium Close-Up] {{KEY_MOMENT}} | SLOW PUSH
- Panel 6: [CU - Close-Up] {{EMOTION_BEAT}} | HANDHELD

Row 3 - CLIMAX:
- Panel 7: [LOW ANGLE] {{TENSION_PEAK}} | TILT UP
- Panel 8: [ECU - Extreme Close-Up] {{CRITICAL_MOMENT}} | RACK FOCUS
- Panel 9: [RESOLUTION SHOT] {{STORY_END}} | PULL BACK

【STYLE】
Professional film storyboard with shot annotations, director's reference quality, cinematic lighting (key light + fill + rim), consistent color LUT across panels, production-ready.

【ANNOTATIONS】
- Small white text labels in corner of each panel showing shot type
- Subtle arrow indicators for camera movement
- Clean, readable typography
- Professional production aesthetic

【TECHNICAL】
4K ultra-detailed, masterpiece, film grain texture, anamorphic lens look, professional color grading.

【NEGATIVE】
Blurry, amateur, inconsistent characters, wrong shot labels, cluttered annotations, low quality, watermark.`,
    userPromptPlaceholder: '描述场景和故事，AI 将自动添加专业镜头语言标注...',
    supportsReferenceImage: true,
    referenceImageGuide: '上传角色参考图，确保分镜中角色一致性',
    outputType: 'grid'
  },

  // ========== 角色多视角 ==========
  {
    id: 'character_multiview',
    name: '角色多视角',
    description: '用于全方位角度的人物视角生成，通常可以替换',
    aspectRatio: '16:9',
    resolution: '2K',
    systemPrompt: `${POLISH_SYSTEM_PROMPT}

For Character Multi-View:
1. Generate 6-9 different camera angles of the SAME character
2. Maintain 100% consistency in facial features, hairstyle, clothing, body proportions
3. Include front, side, back, 3/4 views, and dynamic angles
4. Use consistent neutral lighting to show character clearly
5. Perfect for 3D modeling reference or character design sheets`,
    promptTemplate: `A professional character multi-view reference sheet showing the same character from multiple angles.

【CHARACTER】
{{USER_PROMPT}}

【CHARACTER IDENTITY - MUST REMAIN IDENTICAL】
{{CHARACTER_DESC}}

【VIEW LAYOUT】
Arranged in a clean grid showing:
- Front view (center, largest)
- Left 3/4 view
- Right 3/4 view  
- Left profile (side view)
- Right profile (side view)
- Back view
- High angle view (looking down)
- Low angle view (looking up)
- Dynamic pose view

【CONSISTENCY ANCHORS】
- Exact same face structure, eye shape, nose, lips
- Identical hairstyle and hair color
- Same clothing with all details matching
- Consistent body proportions and posture baseline
- Matching skin tone and texture

【STYLE】
Professional character design reference sheet, clean studio lighting, soft shadows, neutral grey gradient background, game/animation production quality.

【TECHNICAL】
4K ultra-detailed, sharp focus, professional character art, no perspective distortion, accurate proportions, masterpiece quality.

【NEGATIVE】
Different faces, inconsistent clothing, varying body types, busy background, text, watermark, blurry, amateur quality, perspective errors.`,
    userPromptPlaceholder: '描述角色：例如"中国古代女将军，身穿银色战甲，长发束起，手持长枪，英姿飒爽..."',
    supportsReferenceImage: true,
    referenceImageGuide: '上传角色图片，AI 将生成该角色的多角度视图',
    outputType: 'grid'
  },

  // ========== 四宫格分镜 ==========
  {
    id: 'storyboard_4',
    name: '四宫格分镜',
    description: '短剧竖屏分镜，配合分镜裁剪后可任意首尾使用',
    aspectRatio: '1:1',
    resolution: '2K',
    systemPrompt: `${POLISH_SYSTEM_PROMPT}

For 4-Panel Storyboard:
1. Create a compact but complete story arc in 4 panels
2. Perfect for short-form video content (TikTok, Reels, Shorts)
3. Each panel should be impactful and story-driving
4. Maintain tight visual consistency
5. Optimize for vertical video cropping`,
    promptTemplate: `A professional 2x2 four-panel storyboard grid for short-form video content.

【SCENE】
{{USER_PROMPT}}

【CHARACTER CONSISTENCY】
{{CHARACTER_DESC}}

【PANEL LAYOUT - COMPACT STORY ARC】
Panel 1 (Top-Left) - HOOK:
Opening shot that immediately grabs attention, establishing character and situation.

Panel 2 (Top-Right) - ESCALATION:
The complication or challenge appears, tension builds.

Panel 3 (Bottom-Left) - CLIMAX:
Peak moment of action, emotion, or revelation.

Panel 4 (Bottom-Right) - RESOLUTION:
Satisfying conclusion, twist, or cliffhanger for engagement.

【STYLE】
Modern social media aesthetic, vibrant colors, high contrast, dynamic compositions, vertical-video friendly framing, trending visual style.

【TECHNICAL】
- Clean panel borders
- Each panel optimized for 9:16 crop
- Consistent lighting and color grading
- 4K ultra-detailed, sharp, professional
- No text or watermarks

【PACING】
Fast visual rhythm, each panel distinct but connected, clear story progression, hook-to-payoff structure.

【NEGATIVE】
Blurry, inconsistent characters, boring compositions, flat lighting, amateur quality, watermark, text overlay.`,
    userPromptPlaceholder: '描述短视频故事：例如"咖啡店偶遇，女孩不小心把咖啡洒在帅哥身上，尴尬到想原地消失..."',
    supportsReferenceImage: true,
    referenceImageGuide: '上传角色参考图，保持四格内角色一致',
    outputType: 'grid'
  },

  // ========== 角色三视图 ==========
  {
    id: 'character_3view',
    name: '角色三视图',
    description: '生成角色三视图，正面、侧面、背面，+脸部',
    aspectRatio: '16:9',
    resolution: '2K',
    systemPrompt: `${POLISH_SYSTEM_PROMPT}

For Character Three-View (Turnaround):
1. Generate exactly 3-4 views: Front, Side (Profile), Back, and optional Face Close-up
2. Use industry-standard A-Pose or T-Pose for clear silhouette
3. Maintain 100% consistency across all views
4. Professional character design sheet format
5. Perfect for 3D modeling, animation, or game development reference`,
    promptTemplate: `A professional character turnaround reference sheet with three orthographic views.

【CHARACTER】
{{USER_PROMPT}}

【CHARACTER IDENTITY - ABSOLUTE CONSISTENCY】
{{CHARACTER_DESC}}

【VIEW LAYOUT】
Left to Right arrangement:
1. FRONT VIEW (Center) - Character facing camera directly, A-pose, full body
2. SIDE VIEW (Left) - Perfect 90° profile, same pose, showing depth and silhouette
3. BACK VIEW (Right) - Character facing away, showing back details and hair
4. FACE CLOSE-UP (Optional corner inset) - Detailed facial features reference

【POSE REQUIREMENTS】
- Static A-Pose (arms slightly away from body at ~45°)
- Feet shoulder-width apart
- Neutral expression
- Same pose maintained across all three views
- No dynamic poses or action

【CONSISTENCY CHECKLIST】
✓ Identical face structure in all views
✓ Same hairstyle from all angles
✓ Clothing details match perfectly
✓ Body proportions consistent
✓ Accessories in correct positions
✓ Color palette identical

【BACKGROUND】
Clean neutral grey gradient, subtle ground shadow, no environmental elements, professional studio setup.

【STYLE】
Industry-standard character design sheet, concept art quality, clear linework visible, professional color rendering, game/animation production ready.

【TECHNICAL】
4K ultra-detailed, sharp edges, accurate anatomy, no perspective distortion, masterpiece quality, professional character art.

【NEGATIVE】
Different faces between views, inconsistent clothing, varying proportions, busy background, dynamic poses, text, watermark, blurry, amateur.`,
    userPromptPlaceholder: '描述角色：例如"赛博朋克风格的女黑客，短发染成蓝紫渐变，戴着发光护目镜，穿着改装皮夹克..."',
    supportsReferenceImage: true,
    referenceImageGuide: '上传角色正面图，AI 将生成完整的三视图',
    outputType: 'grid'
  },

  // ========== 角色表情包 ==========
  {
    id: 'character_expression',
    name: '角色表情包',
    description: '生成同一角色的多种表情变化',
    aspectRatio: '1:1',
    resolution: '2K',
    systemPrompt: `${POLISH_SYSTEM_PROMPT}

For Character Expression Sheet:
1. Generate 9-16 different expressions of the SAME character
2. Maintain 100% facial feature consistency (face shape, eyes, nose, lips, hairstyle)
3. Only the expression changes, everything else stays identical
4. Include diverse emotions: happy, sad, angry, surprised, scared, disgusted, neutral, smirk, crying, laughing, etc.
5. Perfect for animation reference or visual novel sprites`,
    promptTemplate: `A professional character expression sheet showing multiple emotions of the same character.

【CHARACTER】
{{USER_PROMPT}}

【CHARACTER IDENTITY - NEVER CHANGES】
{{CHARACTER_DESC}}

【EXPRESSION GRID】
Arrange in a clean grid (3x3 or 4x4):

Row 1 - Basic:
- Neutral/Default
- Happy/Smiling  
- Sad/Melancholy

Row 2 - Intense:
- Angry/Furious
- Surprised/Shocked
- Scared/Frightened

Row 3 - Subtle:
- Smirk/Confident
- Crying/Tearful
- Laughing/Joy

Additional (if 4x4):
- Disgusted, Confused, Embarrassed, Determined, Sleepy, Love-struck, Suspicious

【CONSISTENCY RULES】
- SAME face shape in every panel
- SAME eye shape and size (only eyebrows and eyelids change)
- SAME nose and lips structure
- SAME hairstyle, not a single strand different
- SAME skin tone and texture
- SAME head angle (slight 3/4 view recommended)
- SAME lighting setup

【STYLE】
Clean expression sheet format, consistent bust/portrait framing, soft studio lighting, subtle shadows, professional character design quality, animation-ready.

【TECHNICAL】
4K detailed, sharp focus, consistent rendering across all panels, professional quality, clean borders between expressions.

【NEGATIVE】
Different face shapes, varying hairstyles, inconsistent proportions, different art styles, blurry, amateur, watermark, text labels.`,
    userPromptPlaceholder: '描述角色面部特征：例如"可爱的猫耳少女，大眼睛，粉色双马尾，圆脸，樱桃小嘴..."',
    supportsReferenceImage: true,
    referenceImageGuide: '上传角色面部图片，AI 将生成多种表情变化',
    outputType: 'grid'
  },

  // ========== 场景多角度 ==========
  {
    id: 'scene_multiangle',
    name: '场景多角度',
    description: '同一场景的不同机位展示',
    aspectRatio: '16:9',
    resolution: '2K',
    systemPrompt: `${POLISH_SYSTEM_PROMPT}

For Scene Multi-Angle:
1. Generate 6-9 different camera angles of the SAME scene
2. Maintain perfect environmental consistency
3. Include establishing shots, detail shots, and dramatic angles
4. Show the space from multiple perspectives
5. Perfect for film location scouting or game level design reference`,
    promptTemplate: `A professional scene coverage sheet showing the same environment from multiple cinematic angles.

【SCENE】
{{USER_PROMPT}}

【ENVIRONMENT CONSISTENCY】
{{SCENE_DESC}}

【CAMERA COVERAGE】
Arranged in a professional grid:

WIDE COVERAGE:
- Extreme Wide Shot (Bird's Eye) - Full environment from above
- Wide Shot (Establishing) - Complete scene with context
- Wide Shot (Ground Level) - Human perspective establishing

MEDIUM COVERAGE:
- Medium Shot - Key area focus
- Over-the-Shoulder angle - POV feeling
- Dutch Angle - Dramatic tension

DETAIL COVERAGE:
- Close-up - Important prop or detail
- Low Angle - Dramatic upward view
- High Angle - Looking down into scene

【CONSISTENCY REQUIREMENTS】
- Same time of day / lighting conditions
- Identical props and their positions
- Matching color palette and atmosphere
- Consistent weather/environmental effects
- Same level of detail throughout

【STYLE】
Cinematic film location reference, professional photography quality, dramatic lighting, atmospheric depth, production-ready.

【TECHNICAL】
4K ultra-detailed, professional composition in each panel, consistent color grading, masterpiece environment art.

【NEGATIVE】
Inconsistent lighting, missing props between angles, different times of day, varying weather, blurry, amateur, watermark.`,
    userPromptPlaceholder: '描述场景：例如"废弃的工厂车间，生锈的机器，破碎的玻璃窗，阳光透过尘埃照射进来..."',
    supportsReferenceImage: true,
    referenceImageGuide: '上传场景参考图，AI 将生成多角度展示',
    outputType: 'grid'
  },

  // ========== 场景四角度 ==========
  {
    id: 'scene_4angle',
    name: '场景四角度',
    description: '同一场景的4个经典机位展示（2x2网格）',
    aspectRatio: '1:1',
    resolution: '2K',
    systemPrompt: `${POLISH_SYSTEM_PROMPT}

For Scene 4-Angle Coverage:
1. Generate EXACTLY 4 different camera angles of the SAME scene in a 2x2 grid
2. Maintain PERFECT environmental consistency across all 4 angles
3. Use the 4 most essential cinematic camera positions
4. Each angle should reveal different aspects of the scene
5. Perfect for quick location visualization or game environment reference`,
    promptTemplate: `A professional 2x2 grid showing the same scene from 4 essential cinematic camera angles.

【SCENE】
{{USER_PROMPT}}

【ENVIRONMENT CONSISTENCY】
{{SCENE_DESC}}

【4-ANGLE CAMERA COVERAGE - 2x2 GRID】

Top-Left: WIDE ESTABLISHING SHOT
- Full scene visible, establishing context and scale
- Eye-level or slightly elevated
- Shows the complete environment layout
- Sets the mood and atmosphere

Top-Right: LOW ANGLE SHOT
- Camera positioned low, looking upward
- Creates sense of grandeur and drama
- Emphasizes height and architectural elements
- Adds cinematic tension

Bottom-Left: HIGH ANGLE / BIRD'S EYE
- Camera positioned high, looking down
- Shows spatial relationships and layout
- Reveals floor patterns, furniture arrangement
- Provides tactical/overview perspective

Bottom-Right: DETAIL / POV SHOT
- Close-up of a key environmental element
- Or first-person perspective entering the space
- Shows texture, material quality, atmosphere
- Reveals important scene details

【STRICT CONSISTENCY REQUIREMENTS】
- Identical lighting direction and intensity in all 4 panels
- Same time of day (shadows must match)
- All props in exact same positions
- Matching color temperature and grading
- Consistent atmospheric effects (fog, dust, etc.)
- Same weather conditions throughout

【STYLE】
Cinematic film production quality, professional photography, dramatic yet consistent lighting, atmospheric depth, location scouting reference standard.

【TECHNICAL】
- Clean 2x2 grid layout with thin white borders
- Each panel perfectly composed
- 4K ultra-detailed
- Consistent color grading across all panels
- Professional environment art quality
- No perspective distortion

【NEGATIVE】
Inconsistent lighting, props moved between shots, different time of day, varying atmosphere, blurry, amateur quality, text, watermark, more than 4 panels, uneven grid.`,
    userPromptPlaceholder: '描述场景：例如"赛博朋克霓虹街道，雨夜，全息广告牌，蒸汽从下水道升起..."',
    supportsReferenceImage: true,
    referenceImageGuide: '上传场景参考图，AI 将生成4个角度展示',
    outputType: 'grid'
  },

  // ========== 动作序列 ==========
  {
    id: 'action_sequence',
    name: '动作序列',
    description: '连续动作分解，动态姿态展示',
    aspectRatio: '16:9',
    resolution: '2K',
    systemPrompt: `${POLISH_SYSTEM_PROMPT}

For Action Sequence:
1. Generate 6-9 frames showing continuous motion breakdown
2. Maintain 100% character consistency across all frames
3. Show clear progression from start to end of action
4. Include anticipation, action, and follow-through
5. Perfect for animation reference or martial arts choreography`,
    promptTemplate: `A professional action sequence breakdown showing continuous motion of the same character.

【ACTION】
{{USER_PROMPT}}

【CHARACTER CONSISTENCY】
{{CHARACTER_DESC}}

【SEQUENCE BREAKDOWN】
Horizontal strip or grid arrangement showing motion phases:

ANTICIPATION (Frames 1-2):
- Starting pose / wind-up
- Weight shift / preparation

ACTION (Frames 3-5):
- Main action initiation
- Peak of motion / impact
- Follow-through

RECOVERY (Frames 6-8):
- Settling motion
- Return to balance
- Final pose / reaction

【MOTION PRINCIPLES】
- Clear silhouette in each frame
- Exaggerated key poses for readability
- Smooth interpolation between extremes
- Dynamic camera angles matching action intensity
- Speed lines or motion blur on fast movements

【CHARACTER ANCHORS】
- Same face, same body type throughout
- Clothing reacts naturally to movement
- Hair and accessories show physics
- Consistent muscle definition and proportions

【STYLE】
Dynamic action cinematography, professional animation reference quality, dramatic lighting following the action, high energy composition.

【TECHNICAL】
4K ultra-detailed, sharp action capture, professional quality, clear motion progression, masterpiece.

【NEGATIVE】
Static poses, inconsistent character, broken anatomy, missing frames, blurry motion, amateur quality, watermark.`,
    userPromptPlaceholder: '描述动作：例如"武侠剑客拔剑斩击的完整动作，从静止到出剑到收剑..."',
    supportsReferenceImage: true,
    referenceImageGuide: '上传角色参考图，AI 将生成该角色的动作序列',
    outputType: 'grid'
  },

  // ========== 漫画分格 ==========
  {
    id: 'manga_panel',
    name: '漫画分格',
    description: '日式漫画风格分格布局',
    aspectRatio: '3:4',
    resolution: '2K',
    systemPrompt: `${POLISH_SYSTEM_PROMPT}

For Manga Panel Layout:
1. Create authentic Japanese manga page layout
2. Use dynamic panel shapes (not just rectangles)
3. Include dramatic speed lines, screentones, and effects
4. Maintain character consistency in manga style
5. Follow right-to-left reading flow`,
    promptTemplate: `A professional manga page with dynamic panel layout in authentic Japanese comic style.

【STORY】
{{USER_PROMPT}}

【CHARACTER】
{{CHARACTER_DESC}}

【PANEL COMPOSITION】
Dynamic manga page layout with varied panel shapes:
- Large impact panel for key moment
- Smaller reaction panels
- Diagonal/slanted borders for action
- Overlapping panels for intensity
- Bleed panels for dramatic effect

【MANGA TECHNIQUES】
- Speed lines (効果線) for motion
- Screentones for shading and atmosphere
- Impact effects (集中線) for emphasis
- Emotion symbols (sweat drops, anger veins, etc.)
- Sound effect integration areas

【READING FLOW】
Right-to-left, top-to-bottom (Japanese standard)
Clear panel progression
Eye-leading compositions

【STYLE】
Professional manga art, clean linework, dynamic compositions, high contrast black and white with screentones, shonen/shoujo aesthetic as appropriate.

【TECHNICAL】
High resolution, crisp lines, professional manga quality, print-ready, consistent character design.

【NEGATIVE】
Western comic style, left-to-right layout, colored (unless specified), inconsistent art style, amateur linework, blurry.`,
    userPromptPlaceholder: '描述漫画场景：例如"主角发现真相的震惊瞬间，回忆闪回，决心觉醒的表情特写..."',
    supportsReferenceImage: true,
    referenceImageGuide: '上传角色设计图，保持漫画中的角色一致性',
    outputType: 'single'
  },

  // ========== 电影海报 ==========
  {
    id: 'movie_poster',
    name: '电影海报',
    description: '专业电影海报设计',
    aspectRatio: '2:3',
    resolution: '4K',
    systemPrompt: `${POLISH_SYSTEM_PROMPT}

For Movie Poster:
1. Create Hollywood-quality movie poster composition
2. Dramatic lighting and color grading
3. Professional typography integration space
4. Character prominence with atmospheric background
5. Genre-appropriate visual language`,
    promptTemplate: `A professional Hollywood-quality movie poster design.

【CONCEPT】
{{USER_PROMPT}}

【CHARACTER/SUBJECT】
{{CHARACTER_DESC}}

【POSTER COMPOSITION】
- Hero shot of main character(s) - prominent, dramatic pose
- Atmospheric background suggesting genre and setting
- Depth layers: foreground interest, mid-ground subject, background environment
- Space reserved for title (top or bottom third)
- Supporting elements hinting at plot

【CINEMATIC LIGHTING】
- Dramatic key light sculpting the subject
- Atmospheric haze or volumetric effects
- Color grading matching genre:
  * Action: High contrast, orange/teal
  * Horror: Desaturated, cold blues, harsh shadows
  * Romance: Warm, soft, golden hour
  * Sci-Fi: Neon accents, cool tones
  * Drama: Natural, sophisticated palette

【STYLE】
Professional movie poster, photorealistic rendering, Hollywood production quality, dramatic composition, masterpiece.

【TECHNICAL】
4K ultra-detailed, sharp focus on subject, beautiful bokeh background, professional color grading, print-ready quality.

【NEGATIVE】
Amateur composition, flat lighting, busy background, text (unless requested), watermark, low resolution, generic stock photo look.`,
    userPromptPlaceholder: '描述电影概念：例如"末日废土风格科幻片，孤独的机械战士站在废墟城市前，夕阳西下..."',
    supportsReferenceImage: true,
    referenceImageGuide: '上传角色或概念参考图',
    outputType: 'single'
  },

  // ==================== 电商系列 ====================

  // ========== 电商主图 ==========
  {
    id: 'ecommerce_hero',
    name: '电商主图',
    description: '高转化率产品主图，白底/场景化',
    aspectRatio: '1:1',
    resolution: '2K',
    systemPrompt: `${POLISH_SYSTEM_PROMPT}

For E-commerce Hero Image:
1. Create high-converting product photography
2. Clean, professional lighting that highlights product features
3. Multiple style options: pure white background OR lifestyle context
4. Focus on product details and selling points
5. Optimized for thumbnail visibility and click-through rate`,
    promptTemplate: `A professional e-commerce hero product image optimized for high conversion.

【PRODUCT】
{{USER_PROMPT}}

【PRODUCT DETAILS】
{{CHARACTER_DESC}}

【COMPOSITION OPTIONS】
Option A - Pure White Background:
- Product centered with perfect symmetry
- Clean infinite white background (RGB 255,255,255)
- Soft shadow grounding the product
- 45° angle showing product's best features
- Adequate negative space for platform UI elements

Option B - Lifestyle Context:
- Product in natural use environment
- Complementary props that don't distract
- Lifestyle elements suggesting target demographic
- Warm, inviting atmosphere

【LIGHTING SETUP】
- Main light: Large softbox at 45° for even coverage
- Fill light: Reflector for shadow detail
- Rim light: Subtle edge definition
- No harsh shadows or hot spots
- Color temperature: 5500K (daylight balanced)

【PRODUCT PHOTOGRAPHY STANDARDS】
- Sharp focus on entire product
- True-to-life colors (critical for customer trust)
- Texture and material clearly visible
- Size reference if applicable
- Key features prominently displayed

【STYLE】
Professional commercial product photography, Amazon/Tmall/JD listing quality, high-end catalog aesthetic, clean and trustworthy.

【TECHNICAL】
4K ultra-sharp, color-accurate, professional studio lighting, commercial photography quality, perfect exposure.

【NEGATIVE】
Blurry, color cast, harsh shadows, cluttered background, amateur lighting, distorted proportions, watermark, text overlay, low resolution.`,
    userPromptPlaceholder: '描述产品：例如"高端无线蓝牙耳机，哑光黑色金属外壳，皮革耳罩，LED指示灯..."',
    supportsReferenceImage: true,
    referenceImageGuide: '上传产品实拍图，AI 将生成专业主图',
    outputType: 'single'
  },

  // ========== 电商海报（Flowith 模板） ==========
  {
    id: 'ecom_poster_fashion_hero_916',
    name: '电商海报｜高端主视觉 9:16',
    description: '高端极简竖版主视觉海报（适合服装/时尚品类），包含标题/卖点/CTA 排版',
    aspectRatio: '9:16',
    resolution: '4K',
    systemPrompt: `${POLISH_SYSTEM_PROMPT}

For High-End E-commerce Poster:
1. Prioritize premium minimal fashion photography (high-end brand look)
2. Keep layout clean and readable (headline + minimal info card + CTA)
3. If reference image is provided, the product design MUST match it (no redesign)
4. Produce both Chinese and English prompt versions (same meaning, same layout intent)`,
    promptTemplate: `9:16 竖版高端极简电商产品主视觉海报（High-end minimal fashion e-commerce poster）。

【产品/品牌 Brief】
{{USER_PROMPT}}

【硬性一致性】
- 若提供参考图：产品版型/材质/颜色/细节必须严格匹配参考图，不允许自行改设计。

【画面风格】
- 高端极简时尚摄影，极致干净留白，柔和渐变背景（米白/奶油/燕麦色系）。
- 柔和摄影棚自然日光（5500K），低对比，无硬阴影，强调面料细腻质感与自然垂坠感。

【排版（可用于电商详情页/主视觉）】
- 左上角：小号品牌 Logo（极简、不抢主体）。
- 顶部或中部：大标题（可中英堆叠），留白充足，字体现代极简/高端衬线均可。
- 信息卡（Glassmorphism 半透明柔边）：3 条双语卖点（CN/EN）。
- 右下角：圆角药丸 CTA（如“立即选购 → / SHOP NOW →”）。

【质量与限制】
4K ultra-detailed, commercial photography quality, color-accurate.

【NEGATIVE】
cluttered, busy, messy text, watermark, harsh lighting, low quality, blurry, distorted product.`,
    userPromptPlaceholder: '例如：品牌+品类+核心卖点+想要的背景/氛围（可上传产品参考图要求严格一致）',
    supportsReferenceImage: true,
    referenceImageGuide: '上传产品图：必须严格一致；可自动生成高端排版（标题/卖点/CTA）',
    outputType: 'single'
  },
  {
    id: 'ecom_poster_fashion_scene_916',
    name: '电商海报｜场景展示 9:16',
    description: '电影质感的生活方式场景海报（适合服装/穿搭/家居），强调“真实可穿/可用”',
    aspectRatio: '9:16',
    resolution: '4K',
    systemPrompt: `${POLISH_SYSTEM_PROMPT}

For Lifestyle Scene E-commerce Poster:
1. Cinematic but clean lifestyle photography (not cluttered)
2. Natural light look, soft tones, premium brand style
3. Keep product accuracy strict when reference provided
4. Layout with bilingual headline/subtitle + CTA`,
    promptTemplate: `9:16 竖版高端时尚产品场景展示海报（cinematic clean lifestyle poster）。

【产品/场景 Brief】
{{USER_PROMPT}}

【硬性一致性】
- 若提供参考图：产品/服装版型、领型、袖长、衣长、面料质感与光泽必须完全一致，不允许改动。

【场景建议】
- 极简北欧卧室/客厅/阳台等“生活化但干净”的空间，柔和晨光透过纱帘。
- 低对比、无硬阴影，氛围温柔、松弛、有电影感。

【排版】
- 左上角：品牌 Logo + 小号双语副标题（克制）。
- 底部左侧：主标题 + 双语副标题（留白充足）。
- 右下角：圆角药丸 CTA（如“了解更多 → / LEARN MORE →”）。

【NEGATIVE】
cluttered room, messy props, harsh shadows, watermark, too many fonts, low quality.`,
    userPromptPlaceholder: '例如：产品（服装/家居）+想要的生活方式场景（清晨居家/通勤/约会）+标题文案方向',
    supportsReferenceImage: true,
    referenceImageGuide: '上传产品图：AI 只做场景与排版，不改产品本体',
    outputType: 'single'
  },
  {
    id: 'ecom_poster_collage_916',
    name: '电商海报｜多场景拼贴 9:16',
    description: '极简拼贴（4 场景）+ 留白排版，一张图讲清多场景穿搭/使用',
    aspectRatio: '9:16',
    resolution: '4K',
    systemPrompt: `${POLISH_SYSTEM_PROMPT}

For Minimal Collage Poster:
1. Create a clean collage layout (rounded rectangles, breathing space)
2. Maintain strict product consistency across all scenes
3. Keep tone consistent (lighting + color grading)
4. Include bilingual headline + small selling points`,
    promptTemplate: `9:16 竖版极简多场景拼贴电商海报（minimal collage poster）。

【产品/场景 Brief】
{{USER_PROMPT}}

【拼贴布局】
- 温暖奶油色/米白背景，留白充足
- 4 个大圆角照片块，均匀排布（呼吸感强）
- 四个场景：清晨居家 / 客厅日常 / 镜前整理 / 阳台休闲（或由用户指定）

【一致性规则】
- 同一产品在四个场景中必须完全一致（颜色/版型/材质/细节不变）
- 光线风格统一：柔和自然光，低对比

【排版】
- 左上角：品牌 Logo
- 底部居中：主标题 + 双语副标题
- 右下角附近：3 条双语卖点（短句）

【NEGATIVE】
busy collage, inconsistent lighting, different product designs, clutter, watermark.`,
    userPromptPlaceholder: '例如：产品+想要的 4 个场景/使用方式 + 主标题/副标题方向',
    supportsReferenceImage: true,
    referenceImageGuide: '上传产品图：四个拼贴场景里产品必须一致',
    outputType: 'single'
  },
  {
    id: 'ecom_poster_macro_detail_916',
    name: '电商海报｜材质细节微距 9:16',
    description: '微距质感海报：强调面料/材质纹理与高级光泽，含双语标题与 CTA',
    aspectRatio: '9:16',
    resolution: '4K',
    systemPrompt: `${POLISH_SYSTEM_PROMPT}

For Macro Detail Poster:
1. Macro close-up product texture shot (premium, clean)
2. Keep product material accurate to reference
3. Use soft studio light that reveals texture without harshness
4. Minimal bilingual typography layout`,
    promptTemplate: `9:16 竖版高端极简微距细节海报（macro texture poster）。

【材质/卖点 Brief】
{{USER_PROMPT}}

【拍摄】
- 极近距离微距，聚焦材质纹理（不一定出现完整主体/五官）
- 柔和摄影棚日光，低对比，强调自然微光泽与细腻织纹
- 大量干净负空间用于排版

【排版】
- 左上角：品牌 Logo
- 右侧偏上：双语标题（如“仿真丝光泽 / Silk-like Sheen”）
- 标题下方：2 行双语短文案
- 右下角：圆角药丸 CTA

【NEGATIVE】
over-sharpened, harsh lighting, noisy texture, clutter, watermark.`,
    userPromptPlaceholder: '例如：面料/材质卖点（柔软亲肤、微光泽、耐磨等）+标题文案方向',
    supportsReferenceImage: true,
    referenceImageGuide: '上传产品/材质参考图：材质纹理必须准确',
    outputType: 'single'
  },
  {
    id: 'ecom_poster_sellpoint_stretch_fit_916',
    name: '电商海报｜卖点·弹力贴合 9:16',
    description: '用克制的轻微动态展示“修身但不紧绷/活动不束缚”等卖点',
    aspectRatio: '9:16',
    resolution: '4K',
    systemPrompt: `${POLISH_SYSTEM_PROMPT}

For Selling Point Poster:
1. Show the selling point visually (subtle dynamic, not exaggerated)
2. Keep premium fashion look, clean background
3. Bilingual info card bullets + CTA
4. Strict product consistency if reference provided`,
    promptTemplate: `9:16 竖版极简卖点海报（Selling point poster: Stretch & Fit）。

【产品/卖点 Brief】
{{USER_PROMPT}}

【画面】
- 米白渐变背景，极简留白
- 半身或 3/4 身镜头，强调腰线/肩臂贴合
- 轻微动态（抬手/自然转身）表达弹性与回弹，避免健身房/运动服既视感
- 柔光主光 + 轻轮廓光，突出线条与面料张力

【排版】
- 左上角 Logo
- 右侧标题：弹力贴合 / Stretch & Fit
- Glass 信息卡：3 条双语卖点 bullets
- 右下角 CTA：选择尺码 → / PICK YOUR SIZE →

【NEGATIVE】
gym vibe, exaggerated stretching, clutter, watermark, messy fonts.`,
    userPromptPlaceholder: '例如：产品（服装/功能）+卖点（修身不紧绷/抬手不束缚/叠穿利落）',
    supportsReferenceImage: true,
    referenceImageGuide: '上传产品图：版型贴合程度以参考为准（不改紧松）',
    outputType: 'single'
  },
  {
    id: 'ecom_poster_infographic_916',
    name: '电商海报｜信息图 9:16',
    description: '高端品牌详情页风格的信息图：颜色/尺码建议/场景标签，一张图讲清',
    aspectRatio: '9:16',
    resolution: '4K',
    systemPrompt: `${POLISH_SYSTEM_PROMPT}

For Premium Infographic Poster:
1. Clean brand-style infographic (not Taobao clutter)
2. Accurate product color representation
3. Simple bilingual section layout
4. Minimal icons and typography`,
    promptTemplate: `9:16 竖版极简信息海报（Premium brand-style infographic）。

【产品/信息 Brief】
{{USER_PROMPT}}

【布局】
- 奶油色渐变背景留白
- 左侧：产品干净展示（平铺或上半身展示；若有参考图需同款一致）
- 右侧：规则排版信息区（像高端品牌官方详情页）
  - 颜色 / Colors：2-4 个小色块（只用真实存在的色系，不虚构）
  - 尺码 / Size Guide：3 行以内建议（不写具体数值表）
  - 场景 / Styling：3 个短标签（通勤/居家/叠穿或自定义）

【排版】
- 左上角 Logo
- 右下角 CTA：立即选购 → / SHOP NOW →

【NEGATIVE】
too dense table, messy icons, cheap infographic look, watermark.`,
    userPromptPlaceholder: '例如：产品+有哪些颜色（如有）+尺码建议口径+适用场景标签',
    supportsReferenceImage: true,
    referenceImageGuide: '上传产品图：颜色准确、信息区不写错',
    outputType: 'single'
  },
  {
    id: 'ecom_poster_care_guide_916',
    name: '电商详情页｜洗护信任页 9:16',
    description: '详情页结尾的护理说明/信任页：极简图标 + 双语洗护指南 + 温柔收尾文案',
    aspectRatio: '9:16',
    resolution: '4K',
    systemPrompt: `${POLISH_SYSTEM_PROMPT}

For Care Guide Trust Page:
1. Clean care-guide poster layout (soft, trustworthy)
2. Minimal linear icons + bilingual short lines
3. Brand consistency, lots of whitespace
4. No cluttered tables; keep it premium`,
    promptTemplate: `9:16 竖版高端极简护理说明海报（Care guide trust page）。

【品牌/产品 Brief】
{{USER_PROMPT}}

【画面风格】
- 奶油色/温暖米白柔和渐变背景，极致干净
- 均匀柔和棚拍光，温和安心，低对比

【排版】
- 左上角：品牌 Logo（小号、克制）
- 顶部：大标题（洗护指南 / CARE GUIDE，中英上下排列）
- 中部：极简线性图标 + 双语说明（建议 5 条）
  - 建议手洗或使用洗衣袋 / Hand wash or use laundry bag
  - 冷水或 30°C 以下 / Cold or below 30°C water
  - 不可漂白或强力拧干 / No bleach or wringing
  - 悬挂阴干避免暴晒 / Hang dry, avoid direct sun
  - 低温熨烫垫布更佳 / Low heat iron, use cloth
- 底部：温柔收尾短句（双语）

【NEGATIVE】
busy layout, heavy texture, strong shadows, watermark, messy icons, cheap design.`,
    userPromptPlaceholder: '例如：品牌名+产品（材质）+想要的护理语气（温柔/专业）',
    supportsReferenceImage: false,
    outputType: 'single'
  },
  {
    id: 'ecom_poster_before_after_45',
    name: '电商工具海报｜Before-After 4:5',
    description: '产品图“原图→成图”的对比流程海报（适合 AI 电商工具、修图工具宣传）',
    aspectRatio: '4:5',
    resolution: '4K',
    systemPrompt: `${POLISH_SYSTEM_PROMPT}

For Before-After Tool Poster:
1. Looks like a real e-commerce workflow screenshot (not over-designed)
2. Clear BEFORE (input) and AFTER (output cards) with arrow
3. Minimal tech-glow accents; keep readable
4. Bilingual sell-point tags`,
    promptTemplate: `4:5 竖版 Before-After 对比海报（像电商工具使用过程的真实截图）。

【工具/卖点 Brief】
{{USER_PROMPT}}

【布局】
- 左侧 BEGIN：上传的参考图（圆角发光边框）
- 右侧 END：电商产品分镜图（6 张卡片网格：标题+图片）
- 中间发光箭头：标注工具名/流程（可写品牌/产品名）
- 底部卖点标签：原图直用 / 自动构图 / 细节强化 / 商品级打光 / 直接上架（可双语）

【风格】
真实商品摄影感，可直接用于详情页；避免卡通插画风。

【NEGATIVE】
illustration, cartoon, messy neon, dark background, clutter, watermark, low quality.`,
    userPromptPlaceholder: '例如：工具名+“把原图生成爆款电商图/分镜图”的卖点与语气',
    supportsReferenceImage: false,
    outputType: 'single'
  },

  // ========== 产品多角度 ==========
  {
    id: 'product_multiangle',
    name: '产品多角度',
    description: '产品 360° 多角度展示图组',
    aspectRatio: '1:1',
    resolution: '2K',
    systemPrompt: `${POLISH_SYSTEM_PROMPT}

For Product Multi-Angle Display:
1. Generate 6-9 professional product shots from different angles
2. Maintain absolute consistency in lighting, color, and style
3. Cover all key viewing angles customers need
4. Professional e-commerce photography standards
5. Perfect for product detail pages and 360° viewers`,
    promptTemplate: `A professional product photography set showing multiple angles of the same product.

【PRODUCT】
{{USER_PROMPT}}

【PRODUCT IDENTITY - MUST BE IDENTICAL】
{{CHARACTER_DESC}}

【ANGLE COVERAGE】
Arranged in a professional grid:

PRIMARY ANGLES:
- Front view (hero shot) - Main selling angle
- Back view - Showing rear features/ports
- Left side view - Profile perspective
- Right side view - Alternate profile

DETAIL ANGLES:
- Top-down view - Overhead perspective
- Bottom view (if relevant) - Base/feet details
- 45° front-left - Most flattering 3/4 angle
- 45° front-right - Alternate 3/4 angle
- Close-up detail shot - Key feature macro

【CONSISTENCY REQUIREMENTS】
- IDENTICAL lighting setup across all angles
- SAME white/neutral background
- SAME shadow style and intensity
- SAME color temperature and exposure
- SAME distance/scale ratio
- SAME product condition (no changes between shots)

【STUDIO SETUP】
- Infinity white backdrop
- Three-point lighting (key, fill, rim)
- Consistent camera height
- Product on turntable centerpoint
- Color checker reference

【STYLE】
Professional product photography, e-commerce catalog quality, clean and consistent, commercial standard.

【TECHNICAL】
4K ultra-sharp, color-accurate, identical exposure across all angles, professional quality.

【NEGATIVE】
Inconsistent lighting, varying backgrounds, different scales, color shifts between angles, amateur quality, shadows changing direction.`,
    userPromptPlaceholder: '描述产品：例如"智能手表，银色表壳，黑色硅胶表带，圆形表盘，侧面有两个按钮..."',
    supportsReferenceImage: true,
    referenceImageGuide: '上传产品图，AI 将生成多角度展示',
    outputType: 'grid'
  },

  // ========== 模特展示 ==========
  {
    id: 'model_showcase',
    name: '模特展示',
    description: '模特试穿/使用产品展示',
    aspectRatio: '3:4',
    resolution: '2K',
    systemPrompt: `${POLISH_SYSTEM_PROMPT}

For Model Product Showcase:
1. Generate professional model photography with product
2. Model should complement, not overshadow the product
3. Natural poses showing product in use
4. Aspirational lifestyle imagery
5. Multiple shots showing different use scenarios`,
    promptTemplate: `Professional model photography showcasing product in use.

【PRODUCT】
{{USER_PROMPT}}

【MODEL & STYLING】
{{CHARACTER_DESC}}

【SHOT COMPOSITION】
Create a set of model shots:

HERO SHOT:
- Full body or 3/4 shot with product prominently featured
- Model in natural, confident pose
- Eye contact with camera or looking at product
- Product clearly visible and in focus

DETAIL SHOTS:
- Close-up of product being worn/used
- Hands interacting with product
- Product feature highlight with model context

LIFESTYLE SHOTS:
- Model using product in natural environment
- Action shot showing product functionality
- Relaxed, aspirational moment

【MODEL DIRECTION】
- Natural, authentic expressions
- Poses that highlight product features
- Body language suggesting product benefits
- Diversity in poses (not stiff catalog poses)
- Connection between model and product

【STYLING GUIDELINES】
- Model styling complements product color palette
- Minimal distracting accessories
- Hair and makeup appropriate for brand aesthetic
- Wardrobe enhances, doesn't compete with product

【LIGHTING】
- Soft, flattering light on model
- Product properly lit and visible
- Natural window light or studio softbox
- Rim light for separation from background

【STYLE】
High-end fashion e-commerce, lifestyle brand photography, aspirational yet relatable, professional catalog quality.

【TECHNICAL】
4K detailed, professional model photography, accurate skin tones, sharp product focus, beautiful composition.

【NEGATIVE】
Awkward poses, product obscured, unflattering angles, harsh shadows on face, overprocessed skin, amateur lighting, product out of focus.`,
    userPromptPlaceholder: '描述产品和模特：例如"时尚女包，棕色皮革，由25岁亚洲女性模特展示，穿着简约白衬衫..."',
    supportsReferenceImage: true,
    referenceImageGuide: '上传产品图，AI 将生成模特展示效果',
    outputType: 'single'
  },

  // ========== 场景化展示 ==========
  {
    id: 'lifestyle_scene',
    name: '场景化展示',
    description: '产品在使用场景中的生活化展示',
    aspectRatio: '16:9',
    resolution: '2K',
    systemPrompt: `${POLISH_SYSTEM_PROMPT}

For Lifestyle Scene Product Photography:
1. Place product in authentic, aspirational environments
2. Tell a story about the product's role in daily life
3. Create emotional connection through context
4. Multiple scenes showing different use cases
5. Instagram/social media worthy aesthetics`,
    promptTemplate: `Professional lifestyle photography placing product in authentic use scenarios.

【PRODUCT】
{{USER_PROMPT}}

【SCENE CONTEXT】
{{CHARACTER_DESC}}

【LIFESTYLE SCENARIOS】
Create aspirational scenes showing product in context:

MORNING ROUTINE:
- Product as part of daily ritual
- Warm morning light
- Cozy, inviting atmosphere

WORKSPACE SCENE:
- Product in professional/creative environment
- Modern, organized aesthetic
- Productivity context

LEISURE TIME:
- Product during relaxation moments
- Weekend vibes
- Comfortable, lifestyle setting

SOCIAL CONTEXT:
- Product in social situations
- Friends/family context (hands only)
- Sharing/gifting moments

【SCENE DESIGN】
- Carefully curated props that complement product
- Color palette harmony with product
- Negative space for product prominence
- Lifestyle elements suggesting target customer
- Seasonal/trending aesthetics

【LIGHTING MOODS】
- Golden hour warmth for lifestyle shots
- Clean daylight for product clarity
- Cozy ambient for intimate scenes
- Bright and airy for modern aesthetic

【COMPOSITION】
- Product as hero but integrated naturally
- Rule of thirds with product at focal point
- Depth with foreground/background elements
- Leading lines toward product

【STYLE】
Pinterest/Instagram aesthetic, lifestyle brand photography, aspirational yet achievable, editorial quality, social media optimized.

【TECHNICAL】
4K detailed, beautiful natural lighting, professional color grading, magazine-quality composition.

【NEGATIVE】
Staged/fake looking, product lost in scene, cluttered composition, inconsistent lighting, amateur styling, stock photo generic feel.`,
    userPromptPlaceholder: '描述产品和场景：例如"香薰蜡烛，放在浴室窗台，旁边有绿植和浴巾，温暖的午后阳光..."',
    supportsReferenceImage: true,
    referenceImageGuide: '上传产品图，AI 将生成场景化展示',
    outputType: 'single'
  },

  // ========== 详情页分镜 ==========
  {
    id: 'detail_page_grid',
    name: '详情页分镜',
    description: '电商详情页多图组合展示',
    aspectRatio: '1:1',
    resolution: '2K',
    systemPrompt: `${POLISH_SYSTEM_PROMPT}

For E-commerce Detail Page Image Set:
1. Create a complete set of images for product detail page
2. Cover all customer concerns: overview, details, scale, use cases
3. Maintain visual consistency across all images
4. Optimize for mobile scrolling experience
5. Address common purchase hesitations through visuals`,
    promptTemplate: `A complete e-commerce product detail page image set.

【PRODUCT】
{{USER_PROMPT}}

【PRODUCT DETAILS】
{{CHARACTER_DESC}}

【DETAIL PAGE IMAGE SEQUENCE】
Create a cohesive set arranged for detail page:

IMAGE 1 - HERO:
- Main product shot, most attractive angle
- Clean background, product prominence
- Thumbnail-optimized composition

IMAGE 2 - FEATURE HIGHLIGHT:
- Key selling point close-up
- Callout-ready composition
- Technical feature showcase

IMAGE 3 - SCALE REFERENCE:
- Product with size context
- Hand holding (if applicable)
- Or comparison object

IMAGE 4 - DETAIL MACRO:
- Material/texture close-up
- Quality craftsmanship evidence
- Premium detail showcase

IMAGE 5 - IN-USE SHOT:
- Product being used/worn
- Functionality demonstration
- Lifestyle context

IMAGE 6 - PACKAGE/CONTENTS:
- What's in the box
- Accessories included
- Unboxing experience

IMAGE 7 - ALTERNATE ANGLE:
- Secondary viewing angle
- Back or side view
- Additional features

IMAGE 8 - LIFESTYLE CONTEXT:
- Aspirational scene
- Target customer environment
- Emotional connection

IMAGE 9 - TRUST BUILDER:
- Quality certification (if applicable)
- Detail that builds confidence
- Brand story element

【VISUAL CONSISTENCY】
- Same lighting style throughout
- Consistent color temperature
- Matching background treatment
- Unified editing style
- Cohesive brand aesthetic

【E-COMMERCE OPTIMIZATION】
- Mobile-first composition (vertical scroll)
- Key info visible without zoom
- Text-overlay friendly areas
- Platform guideline compliant

【STYLE】
Professional e-commerce photography, conversion-optimized, trust-building visual narrative, platform-ready.

【TECHNICAL】
4K detailed, consistent across set, professional quality, mobile-optimized composition.

【NEGATIVE】
Inconsistent lighting/style, missing key shots, amateur quality, misleading imagery, watermarks.`,
    userPromptPlaceholder: '描述产品：例如"儿童书包，蓝色恐龙图案，多个口袋，反光条，人体工学背带..."',
    supportsReferenceImage: true,
    referenceImageGuide: '上传产品图，AI 将生成完整详情页图组',
    outputType: 'grid'
  },

  // ========== 促销海报 ==========
  {
    id: 'promo_poster',
    name: '促销海报',
    description: '电商大促/活动营销海报',
    aspectRatio: '9:16',
    resolution: '2K',
    systemPrompt: `${POLISH_SYSTEM_PROMPT}

For E-commerce Promotional Poster:
1. Create high-impact promotional visuals
2. Balance product showcase with promotional messaging space
3. Festival/campaign specific themes
4. Urgency and excitement elements
5. Platform-specific format optimization`,
    promptTemplate: `A high-converting e-commerce promotional poster design.

【CAMPAIGN】
{{USER_PROMPT}}

【PRODUCT/BRAND】
{{CHARACTER_DESC}}

【POSTER COMPOSITION】
Design for maximum promotional impact:

HEADER ZONE (Top 20%):
- Space for campaign title/logo
- Sale percentage or key offer
- Festival/event branding

HERO ZONE (Middle 50%):
- Product(s) prominently displayed
- Dynamic, exciting composition
- Visual hierarchy leading to product
- Lifestyle/aspiration context

ACTION ZONE (Bottom 30%):
- Space for CTA button
- Price/discount display area
- Urgency elements (countdown space)
- Platform logo placement

【PROMOTIONAL THEMES】
Double 11/Singles Day:
- Red and gold palette
- Festive, celebratory mood
- Shopping excitement

618/Mid-Year Sale:
- Summer vibes, fresh colors
- Energetic, dynamic feel
- Deal-focused imagery

Black Friday/Cyber Monday:
- Dark dramatic backgrounds
- Neon/tech accents
- Premium deal aesthetic

New Year/Spring Festival:
- Traditional lucky colors
- Festive decorations
- Gift-giving context

【VISUAL EFFECTS】
- Dynamic angles and perspective
- Light rays/sparkles for excitement
- Gradient backgrounds
- Floating product presentation
- Motion blur for energy

【COLOR PSYCHOLOGY】
- Red: Urgency, excitement, luck
- Gold: Premium, value, celebration
- Black: Luxury, exclusivity
- White: Clean, modern, trust

【STYLE】
High-impact promotional design, conversion-optimized, platform-native aesthetic, attention-grabbing, sale-ready.

【TECHNICAL】
4K detailed, vibrant colors, professional composition, text-integration ready, platform-compliant.

【NEGATIVE】
Cluttered design, product obscured, amateur effects, inconsistent branding, low contrast, hard-to-read layout, watermark.`,
    userPromptPlaceholder: '描述活动和产品：例如"双11大促，美妆护肤品，红色喜庆背景，突出5折优惠..."',
    supportsReferenceImage: true,
    referenceImageGuide: '上传产品图，AI 将生成促销海报',
    outputType: 'single'
  },

  // ========== 食品展示 ==========
  {
    id: 'food_photography',
    name: '食品美图',
    description: '美食/食品电商专业展示',
    aspectRatio: '1:1',
    resolution: '2K',
    systemPrompt: `${POLISH_SYSTEM_PROMPT}

For Food Product Photography:
1. Create appetite-appealing food imagery
2. Highlight freshness, quality, and taste appeal
3. Professional food styling techniques
4. Steam, texture, and freshness cues
5. Compliance with food photography standards`,
    promptTemplate: `Professional food photography that makes products irresistible.

【FOOD PRODUCT】
{{USER_PROMPT}}

【FOOD DETAILS】
{{CHARACTER_DESC}}

【FOOD STYLING】
Apply professional food styling:

FRESHNESS CUES:
- Water droplets on produce
- Steam rising from hot items
- Crisp edges and textures
- Vibrant, saturated colors
- Glistening/glazed surfaces

COMPOSITION TECHNIQUES:
- Hero ingredient prominent
- Supporting elements arranged artfully
- Negative space for clean look
- Height variation for dimension
- Color contrast for pop

TEXTURE SHOWCASE:
- Crispy surfaces clearly visible
- Creamy textures smooth and appealing
- Grain and fiber detail
- Layers and cross-sections
- Surface imperfections (authentic appeal)

【LIGHTING FOR FOOD】
- Soft side lighting (10-2 o'clock position)
- Backlight for steam/atmosphere
- Fill to reduce harsh shadows
- Highlight liquids and glossy surfaces
- Warm color temperature for appetite appeal

【PROPS & STYLING】
- Rustic wood/marble surfaces
- Complementary ingredients scattered
- Appropriate utensils/serveware
- Fresh herbs and garnishes
- Napkins, cutting boards, natural elements

【MOOD BY CATEGORY】
Snacks/Sweets: Fun, indulgent, colorful
Health Food: Clean, fresh, vibrant
Gourmet: Elegant, refined, artistic
Comfort Food: Warm, homey, inviting
Fresh Produce: Natural, crisp, farm-fresh

【STYLE】
Professional food photography, appetite-appealing, magazine/menu quality, mouthwatering presentation.

【TECHNICAL】
4K detailed, accurate food colors, sharp texture detail, professional food styling.

【NEGATIVE】
Unappetizing presentation, dull colors, melted/wilted appearance, messy plating, artificial looking, poor lighting, cold food looking cold.`,
    userPromptPlaceholder: '描述食品：例如"手工巧克力礼盒，深棕色可可色，金箔装饰，丝滑光泽，高端包装..."',
    supportsReferenceImage: true,
    referenceImageGuide: '上传食品图，AI 将生成美食展示图',
    outputType: 'single'
  },

  // ========== 珠宝首饰 ==========
  {
    id: 'jewelry_showcase',
    name: '珠宝首饰',
    description: '珠宝/首饰高端展示',
    aspectRatio: '1:1',
    resolution: '4K',
    systemPrompt: `${POLISH_SYSTEM_PROMPT}

For Jewelry Product Photography:
1. Capture brilliance, sparkle, and luxury
2. Professional jewelry lighting techniques
3. Detail macro shots showing craftsmanship
4. Lifestyle shots for emotional connection
5. True-to-life metal and gemstone colors`,
    promptTemplate: `Professional jewelry photography showcasing luxury and craftsmanship.

【JEWELRY PIECE】
{{USER_PROMPT}}

【JEWELRY DETAILS】
{{CHARACTER_DESC}}

【JEWELRY LIGHTING TECHNIQUES】
Special lighting for jewelry:

METAL SURFACES:
- Large soft light sources for smooth gradients
- Black cards for contrast and definition
- White cards for bright reflections
- Tent lighting for even coverage

GEMSTONES:
- Point light sources for sparkle/fire
- Multiple small lights for brilliance
- Backlight for transparency/glow
- Dark field for internal features

DIAMONDS:
- High contrast lighting for fire
- Multiple catch lights for sparkle
- Clean white reflections
- Rainbow dispersion visible

【COMPOSITION STYLES】
Pure Product:
- Black velvet/acrylic background
- Floating/suspended presentation
- Reflection surface below
- Macro detail shots

Lifestyle Context:
- On model (neck, hand, ear)
- Gift box presentation
- Romantic/celebration context
- Scale reference

【DETAIL REQUIREMENTS】
- Hallmarks and stamps visible (if applicable)
- Clasp and mechanism detail
- Stone setting craftsmanship
- Metal finish (polished/matte/textured)
- Chain links and connections

【LUXURY AESTHETIC】
- Elegant, sophisticated mood
- Premium background materials
- Subtle props if any (rose petals, silk)
- Aspirational presentation
- Gift-worthy imagery

【STYLE】
High-end jewelry photography, luxury brand aesthetic, editorial quality, precision detail capture.

【TECHNICAL】
4K ultra-detailed, focus stacking for depth, accurate metal/gem colors, professional jewelry lighting, microscopic detail.

【NEGATIVE】
Dull metals, dead gemstones, fingerprints, dust, poor focus, amateur lighting, color cast, unflattering angles.`,
    userPromptPlaceholder: '描述珠宝：例如"18K玫瑰金钻石戒指，1克拉主钻，群镶小钻，闪耀火彩..."',
    supportsReferenceImage: true,
    referenceImageGuide: '上传珠宝图，AI 将生成高端展示效果',
    outputType: 'single'
  }
]

/**
 * 根据预设 ID 获取预设配置
 */
export function getPresetById(id: string): DirectorPreset | undefined {
  // 先查找用户自定义预设
  const userPresets = getUserPresets()
  const userPreset = userPresets.find(p => p.id === id)
  if (userPreset) return userPreset
  // 再查找系统预设
  return DIRECTOR_PRESETS.find(p => p.id === id)
}

/**
 * 构建最终提示词
 * @param preset 预设配置
 * @param userPrompt 用户输入的提示词
 * @param characterDesc 角色描述（从参考图分析或用户补充）
 * @param sceneDesc 场景描述（可选）
 */
export function buildFinalPrompt(
  preset: DirectorPreset,
  userPrompt: string,
  characterDesc?: string,
  sceneDesc?: string
): string {
  if (!preset.promptTemplate) {
    return userPrompt
  }

  let result = preset.promptTemplate
    .replace(/\{\{USER_PROMPT\}\}/g, userPrompt)
    .replace(/\{\{CHARACTER_DESC\}\}/g, characterDesc || 'As described above')
    .replace(/\{\{SCENE_DESC\}\}/g, sceneDesc || 'As described above')

  // 清理未使用的占位符
  result = result.replace(/\{\{[A-Z_]+\}\}/g, '')

  return result.trim()
}

/**
 * 获取预设推荐的比例选项
 */
export function getAspectRatioOptions() {
  return [
    { label: '1:1 (方形)', value: '1:1' },
    { label: '16:9 (横屏)', value: '16:9' },
    { label: '9:16 (竖屏)', value: '9:16' },
    { label: '4:3 (传统)', value: '4:3' },
    { label: '3:4 (竖版)', value: '3:4' },
    { label: '2:3 (海报)', value: '2:3' },
    { label: '3:2 (摄影)', value: '3:2' },
    { label: '21:9 (宽银幕)', value: '21:9' }
  ]
}

/**
 * 获取分辨率选项
 */
export function getResolutionOptions() {
  return [
    { label: '1K (1024px)', value: '1K' },
    { label: '2K (2048px)', value: '2K' },
    { label: '4K (4096px)', value: '4K' }
  ]
}
