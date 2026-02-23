/**
 * PromptAgentModal - 提示词 Agent
 * AI 驱动的提示词优化工具，支持多模型、生图/生视频双模式
 */

import React, { useState, useCallback, useRef, useEffect, useMemo } from 'react'
import { createPortal } from 'react-dom'
import {
  X, Loader2, Copy, Check, Sparkles, Image as ImageIcon,
  Video, ChevronDown, ChevronRight, RotateCcw, Zap, Wifi, WifiOff, Upload, Plus,
  Layers, History, FolderOpen
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { streamAiAssistant } from '@/lib/nexusApi'
import { useGraphStore } from '@/graph/store'
import { useAssetsStore } from '@/store/assets'

interface Props {
  open: boolean
  onClose: () => void
}

type PromptMode = 'image' | 'video'

interface ModelOption {
  key: string
  label: string
  provider: string
}

const AGENT_MODELS: ModelOption[] = [
  { key: 'gemini-3.1-pro-preview', label: 'Gemini 3.1 Pro', provider: 'Google' },
  { key: 'claude-opus-4-6', label: 'Claude Opus 4.6', provider: 'Anthropic' },
  { key: 'claude-opus-4-5-20251101', label: 'Claude Opus 4.5', provider: 'Anthropic' },
  { key: 'gemini-3-pro-preview-thinking', label: 'Gemini 3 Pro Thinking', provider: 'Google' },
]

const MODEL_STORAGE_KEY = 'nexus-prompt-agent-model'
const MAX_IMAGES = 6

const readSavedModel = () => {
  try {
    const saved = localStorage.getItem(MODEL_STORAGE_KEY)
    if (saved && AGENT_MODELS.some(m => m.key === saved)) return saved
  } catch {}
  return AGENT_MODELS[0].key
}

const compressImage = (src: string, maxSize = 1920, quality = 0.8): Promise<string> =>
  new Promise((resolve) => {
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => {
      try {
        let { width, height } = img
        if (width > maxSize || height > maxSize) {
          const scale = maxSize / Math.max(width, height)
          width = Math.round(width * scale)
          height = Math.round(height * scale)
        }
        const cvs = document.createElement('canvas')
        cvs.width = width
        cvs.height = height
        cvs.getContext('2d')!.drawImage(img, 0, 0, width, height)
        resolve(cvs.toDataURL('image/jpeg', quality))
      } catch {
        resolve(src)
      }
    }
    img.onerror = () => resolve(src)
    img.src = src
  })

type PickerTab = 'local' | 'canvas' | 'history'

interface StylePreset {
  label: string
  desc: string
  modifiers: string
}

// ────────────────── 风格预设 ──────────────────

const IMAGE_STYLE_PRESETS: StylePreset[] = [
  // 写实 & 摄影
  { label: '电影写实', desc: '35mm 胶片大荧幕质感', modifiers: '电影质感, 35mm胶片, 自然光线, 浅景深, 胶片颗粒感, 高动态范围, 真实皮肤纹理, 电影调色' },
  { label: '人像摄影', desc: '专业影棚人像', modifiers: '专业人像摄影, 85mm镜头, 柔和散射光, 奶油般虚化, 精致肤质, 眼神光, 自然妆容, 高清细节' },
  { label: '街拍纪实', desc: '街头抓拍风格', modifiers: '街头摄影, 自然光, 真实瞬间, 都市背景, 浅景深, 35mm镜头, 胶片色调, 生活气息' },
  { label: '风光大片', desc: '壮丽自然风光', modifiers: '风光摄影, 黄金时刻, 广角镜头, 高动态范围, 壮丽天空, 层次分明, 细腻纹理, 全景构图' },
  { label: '商业产品', desc: '高端产品摄影', modifiers: '商业摄影, 精心布光, 纯净背景, 产品特写, 质感细节, 反射高光, 专业修图, 广告级画质' },
  { label: '美食摄影', desc: '令人垂涎的食物', modifiers: '美食摄影, 暖色调自然光, 浅景深, 食材质感, 蒸汽氤氲, 精致摆盘, 微距细节, 色彩鲜艳' },
  // 动漫 & 插画
  { label: '二次元动漫', desc: '日系赛璐璐风', modifiers: '日系动漫风格, 赛璐璐着色, 精致线条, 大眼睛, 丰富表情, 干净背景, 高饱和度色彩, 动态姿势' },
  { label: '新海诚风', desc: '新海诚式光影', modifiers: '新海诚风格, 精致光影, 云彩细节, 城市天际线, 黄昏光芒, lens flare, 饱和色彩, 浪漫氛围' },
  { label: '吉卜力风', desc: '宫崎骏式田园', modifiers: '吉卜力风格, 手绘质感, 田园风光, 温暖色调, 柔和光线, 自然元素, 童话感, 水彩渲染' },
  { label: '美漫风格', desc: 'Marvel/DC 漫画', modifiers: '美式漫画, 粗犷线条, 高对比度, 动态构图, 强烈色彩, 网点效果, 英雄姿态, 力量感' },
  { label: '国风水墨', desc: '传统水墨意境', modifiers: '中国水墨画, 写意笔法, 留白意境, 墨色浓淡, 宣纸质感, 古典构图, 飘逸线条, 禅意氛围' },
  { label: '韩漫风格', desc: '韩国条漫风格', modifiers: '韩国漫画风格, 柔和渐变, 精致五官, 时尚穿搭, 细腻表情, 恋爱氛围, 清新色调, 现代背景' },
  // 数字艺术 & CG
  { label: '概念原画', desc: '游戏/影视概念设计', modifiers: '概念艺术, 数字绘画, 史诗级构图, 大气光效, 丰富细节, 奇幻色彩, 高对比度, 叙事性构图' },
  { label: '3D渲染', desc: 'C4D/Blender 级渲染', modifiers: '3D渲染, 全局光照, 次表面散射, 焦散效果, 体积雾, 高多边形细节, PBR材质, 物理渲染' },
  { label: '像素艺术', desc: '复古像素风格', modifiers: '像素艺术, 16bit风格, 有限调色板, 精致像素, 复古游戏感, 锐利边缘, 怀旧氛围, 像素动画帧' },
  { label: '低面建模', desc: 'Low Poly 风格', modifiers: 'Low Poly风格, 低多边形, 几何面片, 柔和渐变, 简约色彩, 等距视角, 干净利落, 现代设计感' },
  // 传统艺术
  { label: '油画质感', desc: '古典油画笔触', modifiers: '古典油画, 厚涂笔触, 暖色调, 明暗对比, 伦勃朗光, 画布肌理, 古典构图, 丰富色层' },
  { label: '水彩插画', desc: '手绘水彩质感', modifiers: '水彩画风, 柔和渐变, 晕染边缘, 纸纹肌理, 透明色层, 留白意境, 自然色调, 手绘感' },
  { label: '素描速写', desc: '铅笔碳条素描', modifiers: '铅笔素描, 碳条质感, 明暗调子, 线条层次, 纸纹肌理, 写实解构, 灰度色阶, 艺术感' },
  { label: '版画风格', desc: '木刻/丝网版画', modifiers: '版画风格, 粗犷线条, 高对比度, 有限色彩, 套色印刷, 肌理感, 复古质感, 图案化' },
  // 风格化 & 特殊
  { label: '赛博朋克', desc: '霓虹科幻都市', modifiers: '赛博朋克, 霓虹灯光, 雨夜反射, 全息投影, 高科技低生活, 紫蓝色调, 未来都市, 数据流' },
  { label: '蒸汽朋克', desc: '维多利亚机械', modifiers: '蒸汽朋克, 黄铜齿轮, 蒸汽管道, 维多利亚时代, 机械装置, 暖铜色调, 工业革命, 复古未来' },
  { label: '暗黑哥特', desc: '黑暗美学', modifiers: '哥特风格, 暗黑美学, 低调光线, 阴影深沉, 尖拱元素, 蔷薇荆棘, 神秘氛围, 冷色调' },
  { label: '波普艺术', desc: 'Andy Warhol 式', modifiers: '波普艺术, 高饱和色彩, 网点效果, 重复图案, 大胆构图, 商业文化, 平面化, 视觉冲击' },
  { label: '极简海报', desc: '瑞士平面设计', modifiers: '极简主义, 大面积留白, 几何构成, 强烈对比色, 无衬线字体, 扁平化, 版式设计感, 网格系统' },
  { label: '梦核/怪核', desc: 'Dreamcore 超现实', modifiers: 'Dreamcore, 超现实, 模糊记忆, 过曝光线, 空旷空间, 不协调元素, 怀旧滤镜, 诡异宁静' },
  { label: '克苏鲁风', desc: '宇宙恐怖美学', modifiers: '克苏鲁风格, 宇宙恐怖, 触手生物, 深海幽暗, 不可名状, 疯狂几何, 阴暗色调, 压迫感' },
  { label: '未来主义', desc: '科技乌托邦', modifiers: '未来主义, 流线造型, 白色基调, 全息界面, 悬浮元素, 无缝曲面, 科技光泽, 太空殖民' },
]

const VIDEO_STYLE_PRESETS: StylePreset[] = [
  // 电影 & 叙事
  { label: '电影叙事', desc: '故事驱动短片', modifiers: '电影级画面, 自然光线, 情感叙事, 平稳运镜, 色彩分级, 浅景深, 环境音, 2.39:1宽银幕' },
  { label: '黑色电影', desc: 'Film Noir 风格', modifiers: '黑色电影, 高对比度黑白, 硬光阴影, 低角度拍摄, 威尼斯百叶窗光影, 烟雾缭绕, 悬疑氛围' },
  { label: '文艺片', desc: '独立文艺电影', modifiers: '文艺电影, 柔和自然光, 长镜头, 慢节奏, 环境叙事, 手持摄影, 胶片质感, 诗意表达' },
  { label: '动作大片', desc: '好莱坞动作片', modifiers: '好莱坞动作片, 快速剪辑, 爆炸特效, 追车镜头, 慢动作子弹时间, 航拍, 震撼音效, IMAX画幅' },
  { label: '恐怖惊悚', desc: '恐怖片氛围', modifiers: '恐怖片, 低照度, 不稳定手持镜头, 突然推进, 诡异音效, 阴影潜伏, 冷色调, 紧张呼吸' },
  // 商业 & 广告
  { label: '广告大片', desc: '高端商业质感', modifiers: '商业广告品质, 精心打光, 产品特写, 流畅转场, 高速摄影, 微距细节, 品牌色调, 4K超清' },
  { label: '时尚秀场', desc: '时装/美妆广告', modifiers: '时尚广告, 模特走秀, 华丽灯光, 慢动作飘逸, 面料质感, 高饱和色彩, 多角度切换, 奢华感' },
  { label: '汽车广告', desc: '汽车品牌TVC', modifiers: '汽车广告, 空旷公路, 航拍追踪, 漆面反射, 引擎轰鸣, 日落逆光, 速度感, 电影调色' },
  { label: '美食特写', desc: '美食广告慢镜', modifiers: '美食广告, 微距特写, 慢动作倒注, 食材切面, 蒸汽升腾, 暖色调, 质感细节, 令人垂涎' },
  // 音乐 & 视觉
  { label: 'MV风格', desc: '音乐视觉呈现', modifiers: '音乐节奏剪辑, 戏剧性光影, 频闪效果, 色彩冲击, 慢动作, 多角度切换, 沉浸感, 动态构图' },
  { label: '舞蹈视觉', desc: '舞蹈/编舞视频', modifiers: '舞蹈编排, 流畅运镜, 多机位, 地面镜头, 剪影效果, 动态光影, 节奏同步, 身体线条' },
  { label: '视觉诗歌', desc: '抽象视觉短片', modifiers: '视觉诗歌, 抽象意象, 叠化转场, 慢节奏, 微观世界, 自然元素, 冥想氛围, 无叙事' },
  // 纪实 & 生活
  { label: '纪录片', desc: '真实感捕捉', modifiers: '纪实摄影, 手持镜头, 自然光, 长镜头, 环境同期声, 跟拍, 真实感, 采访构图' },
  { label: 'Vlog日常', desc: '亲切生活记录', modifiers: '温暖色调, 轻松节奏, 第一人称视角, 自然运镜, 日常光线, 真实感, 轻快BGM, 对话感' },
  { label: '旅行航拍', desc: '无人机风光', modifiers: '航拍视角, 缓慢升降, 全景环绕, 壮丽风光, 4K超清, 延时摄影, 自然配乐, 旅行叙事' },
  { label: '城市漫步', desc: 'City Walk 视角', modifiers: '第一人称行走, 街道实景, 环境音, 稳定器跟拍, 城市细节, 人文气息, 时间流逝, 沉浸体验' },
  // 特效 & 科幻
  { label: '科幻视效', desc: 'VFX 特效级', modifiers: '视觉特效, 粒子系统, 光线追踪, 全息界面, 太空场景, 宏大尺度, 科技蓝色调, CG渲染' },
  { label: '动画短片', desc: '3D/2D 动画', modifiers: '动画风格, 角色动画, 流畅运动, 卡通渲染, 丰富表情, 故事性, 色彩鲜明, 创意转场' },
  { label: '粒子特效', desc: '粒子/流体特效', modifiers: '粒子特效, 流体模拟, 烟雾漩涡, 光粒子, 能量波, 碎片化, 魔法效果, 视觉震撼' },
  { label: '微缩世界', desc: '移轴摄影效果', modifiers: '微缩效果, 移轴镜头, 极浅景深, 俯拍视角, 延时摄影, 模型感, 可爱尺度, 趣味视角' },
]

// ────────────────── 修饰词库 ──────────────────

const MODIFIER_CATEGORIES = {
  image: [
    { cat: '画质', items: ['8K超高清', '4K', '超精细', '高动态范围', '锐利细节', '电影质感', '大师级', '超写实', '照片级真实', '精细纹理', '无噪点', 'RAW格式'] },
    { cat: '光线', items: ['黄金时刻', '蓝调时分', '伦勃朗光', '环形光', '逆光剪影', '丁达尔效应', '霓虹灯光', '烛光', '月光', '顶光', '底光补光', '侧光勾勒', '蝴蝶光', '分割光', '自然散射光', '硬光', '柔光箱', '窗光', '舞台聚光', '彩虹光斑'] },
    { cat: '构图', items: ['三分法', '黄金比例', '对称构图', '对角线引导', '框式构图', '极简留白', '俯拍鸟瞰', '低角度仰视', '平视正面', '荷兰角倾斜', '引导线汇聚', '前景遮挡', '层次递进', '中心放射', '三角构图', 'S形曲线'] },
    { cat: '镜头', items: ['50mm标准', '85mm人像', '24mm广角', '135mm长焦', '微距特写', '鱼眼畸变', '移轴效果', '浅景深虚化', '14mm超广角', '200mm超长焦', '大光圈f/1.4', '柔焦效果', '星芒效果', '光圈形散景', '双重曝光', '红外摄影'] },
    { cat: '色调', items: ['暖色调', '冷色调', '莫兰迪色', '高饱和', '消色淡雅', '互补色撞击', '单色系', '复古胶片色', '青橙对比', '粉紫梦幻', '翡翠绿', '宝石蓝', '焦糖棕', '珊瑚橘', '薰衣草紫', '鎏金', '黑白高反差', '交叉冲洗'] },
    { cat: '材质', items: ['丝绸质感', '金属光泽', '玻璃透明', '陶瓷温润', '木纹肌理', '石材粗粝', '皮革纹理', '羊毛绒感', '水晶折射', '大理石纹', '磨砂质感', '珐琅彩釉', '亚克力', '镜面反射'] },
    { cat: '氛围', items: ['梦幻朦胧', '暗黑哥特', '清新明亮', '史诗宏大', '安静治愈', '紧张悬疑', '复古怀旧', '未来科幻', '浪漫温柔', '孤独寂寥', '欢乐派对', '神秘魔幻', '田园牧歌', '都市繁华', '末日废土', '海底深渊', '仙境缥缈', '蒸汽工业'] },
    { cat: '环境', items: ['雨天', '雪景', '雾气弥漫', '阳光灿烂', '落日余晖', '星空璀璨', '极光', '沙漠', '热带雨林', '海底世界', '太空', '废墟', '古堡', '现代都市', '日式庭院', '赛博街道', '云端之上', '地下洞穴', '火山口', '冰川'] },
    { cat: '负面提示', items: ['避免变形', '避免多余手指', '避免模糊', '避免低画质', '避免水印', '避免裁切', '避免过曝', '避免欠曝', '避免噪点', '避免色偏', '避免畸变', '避免重影'] },
  ],
  video: [
    { cat: '运镜', items: ['推镜头', '拉镜头', '摇镜头', '移镜头', '跟镜头', '升降镜头', '环绕运镜', '手持晃动', '稳定器滑动', '甩镜头', '穿越镜头', '无人机航拍', '斯坦尼康漫步', '摇臂俯仰', '轨道车平移', '旋转360度', '推拉摇移组合', '一镜到底', '弹弓镜头', '子弹时间环绕'] },
    { cat: '景别', items: ['大远景', '远景', '全景', '中景', '中近景', '近景', '特写', '大特写', '微距', '鸟瞰', '虫眼视角', '肩上镜头', '过肩镜头', '主观视角', '上帝视角'] },
    { cat: '转场', items: ['硬切', '叠化', '闪白', '闪黑', '黑场过渡', '遮罩转场', '匹配剪辑', '分屏', '变速转场', '擦除', '缩放穿越', '旋转切换', '物体遮挡', '甩镜转场', '变焦转场', '故障转场', '形态变换', '无缝转场'] },
    { cat: '节奏', items: ['慢动作120fps', '慢动作240fps', '超级慢动作1000fps', '延时摄影', '正常速度', '快节奏剪辑', '速度渐变', '定格画面', '循环', '倒放', '跳切加速', '节拍同步', '呼吸节奏', '渐快渐慢', '时间静止'] },
    { cat: '光影', items: ['自然光', '逆光', '侧光', '顶光', '底光', '霓虹', '火光', '闪电', '激光', '烟花', '荧光', '日落渐变', '黎明微光', '体积光', '追光灯', '频闪', '光影流动', '彩色凝胶滤光'] },
    { cat: '氛围', items: ['电影感', '纪实感', '梦幻', '紧张', '温暖', '冷峻', '诡异', '壮丽', '浪漫', '忧郁', '热血沸腾', '宁静致远', '混乱疯狂', '神圣庄严', '末日苍凉', '童话般', '迷幻', '压迫感'] },
    { cat: '声音', items: ['环境同期声', '电影配乐', '安静无声', '低频轰鸣', '自然白噪音', '心跳声', '呼吸声', '机械音效', '电子音乐', '古典配乐', 'ASMR', '画外音旁白', '对白为主'] },
    { cat: '物理效果', items: ['布料飘动', '头发飞舞', '水花飞溅', '烟雾升腾', '火焰燃烧', '粒子散落', '玻璃碎裂', '金属碰撞', '液体流动', '沙尘弥漫', '雪花飘落', '树叶纷飞', '气泡上升', '闪电击中', '爆炸冲击波'] },
  ],
}

// ────────────────── 系统提示词 ──────────────────

const IMAGE_SYSTEM_PROMPT = `你是一位世界顶级的 AI 图像提示词工程师，精通 Midjourney / Stable Diffusion / DALL-E / Flux / Kling 等各主流模型的提示词体系。你的任务是将用户的粗略想法转化为高质量、结构清晰、可直接投入生产的生图提示词。

## 输出格式
直接输出优化后的中文提示词，不要解释、不要 Markdown、不要 JSON。

## 优化方法论
1. 消除模糊：将用户描述中所有含糊词汇（"好看的"、"漂亮的"、"酷炫的"）替换为具体视觉描述
2. 补全缺失：用户未提及的维度（光影、构图、色调、材质），基于语境合理补全
3. 量化表达：能用数字/具体术语的地方绝不用形容词（"85mm f/1.4" 而非 "虚化好"）
4. 权重排序：越关键的视觉元素越靠前

## 提示词结构（严格按此顺序组织，每个维度必须有具象描述）
1. 【主体】核心对象的精确描述——外貌特征、表情神态、动作姿势、服饰材质纹理、身体朝向与比例
2. 【环境】场景空间——前景元素、中景布局、远景纵深、天空/地面细节、季节/时间/天气
3. 【构图】景别（特写/半身/全身/远景）、视角（平视/俯视/仰视/荷兰角）、构图法则（三分法/对称/引导线/框式）
4. 【光影】主光源类型与方向、辅光/补光、色温（暖/冷/中性）、特殊光效（丁达尔/伦勃朗/环形光/体积光）
5. 【风格】艺术流派、渲染方式（摄影/CG/手绘/混合媒介）、参考风格
6. 【色调】主色调、辅色、色彩关系（互补/类比/单色）、整体明度与饱和度倾向
7. 【材质】关键物体的材质质感描述——金属光泽、织物纹理、皮肤质感、表面反射/磨砂
8. 【画质】分辨率修饰、细节级别、渲染引擎暗示、抗锯齿
9. 【负面】（如用户有需求）需要排除的元素

## 参考图分析（当用户上传参考图时）
逐图深度分析以下维度，并将分析结论融入最终提示词：
- 主体特征：人物/物体的外观、姿态、服饰细节
- 风格基因：艺术流派、渲染方式、笔触/质感特征
- 色彩DNA：主色调、辅色关系、饱和度/明度倾向
- 光影模式：光源方向、色温、阴影风格、特殊光效
- 构图语言：景别、视角、空间关系、视觉引导
- 氛围情绪：整体情绪基调、场景气质

## 输出自检（内部执行，不输出检查过程）
生成后自检：每个维度是否都有具象描述？是否存在模糊词汇？关键词权重排序是否合理？

## 核心原则
- 使用逗号分隔各描述段，保持语义连贯，融为流畅的整段描述
- 如果用户指定了风格预设或修饰词，必须完整融入提示词中并强化
- 输出长度 200~500 字为宜
- 禁止输出标签序号如"1."、"【主体】"等结构标记`

const VIDEO_SYSTEM_PROMPT = `你是一位世界顶级的 AI 视频提示词工程师，精通 Sora / Kling / Runway / Veo / Luma / Pika 等各主流视频模型的提示词体系。你的任务是将用户的粗略想法转化为高质量、可直接投入生产的视频生成提示词。

## 输出格式
直接输出优化后的中文提示词，不要解释、不要 Markdown、不要 JSON。

## 优化方法论
1. 消除模糊：将"缓慢移动"变成"以每秒约30像素的速度从画面左侧向右平移"
2. 时间线化：必须有清晰的 开始状态→运动过程→结束状态 三段式
3. 因果链条：每个动作都有物理因果（风吹→发丝右飘→裙摆翻飞→落叶卷起）
4. 镜头意识：运镜本身也是叙事工具，镜头运动要服务于情绪表达

## 提示词结构（严格按此顺序组织）
1. 【主体动作】谁/什么在做什么——动作的精确起始状态、运动轨迹、结束状态、表情变化、肢体细节
2. 【镜头运动】运镜方式（推/拉/摇/移/跟/升降/环绕/穿越/一镜到底）、运动速度、起止方向、稳定性
3. 【场景空间】环境空间的三维描述——近景/中景/远景层次、纵深关系、空间尺度、环境细节
4. 【光影变化】光源随时间的变化——色温渐变、阴影流动、明暗交替、特殊光效（体积光/丁达尔/霓虹闪烁）
5. 【节奏时序】速度节奏——慢动作/正常/加速、时间跨度、关键帧节点、速度变化曲线
6. 【氛围风格】整体视觉风格、色彩基调、情绪层次、年代感/未来感
7. 【物理效果】真实世界物理——重力/惯性/弹性、布料飘动、头发物理、水流/烟雾/粒子、碰撞反馈
8. 【声音暗示】（如适用）环境音、配乐调性、关键音效节点

## 参考图分析（当用户上传参考图时）
逐图深度分析以下维度，转化为视频提示词中的视觉约束：
- 主体外观：人物/物体的外观特征，作为视频主体的一致性约束
- 运动暗示：图中姿态/构图暗示的运动方向和动势
- 风格基调：艺术风格和渲染方式，视频需保持一致
- 色彩体系：色调和色彩关系，作为视频调色依据
- 空间关系：场景深度和布局，确定摄影机运动空间
- 光影基准：光影模式，作为视频光影变化的起点

## 输出自检（内部执行，不输出检查过程）
生成后自检：时间线是否清晰？因果链是否完整？镜头语言是否具体？物理效果是否合理？

## 核心原则
- 如果用户指定了风格预设或修饰词，必须完整融入提示词中
- 输出长度 250~600 字为宜
- 禁止输出标签序号如"1."、"【主体动作】"等结构标记，融为流畅的整段描述`

// ────────────────── 组件 ──────────────────

export default function PromptAgentModal({ open, onClose }: Props) {
  const [mode, setMode] = useState<PromptMode>('image')
  const [model, setModel] = useState(readSavedModel)
  const [modelDropdownOpen, setModelDropdownOpen] = useState(false)
  const [input, setInput] = useState('')
  const [output, setOutput] = useState('')
  const [isGenerating, setIsGenerating] = useState(false)
  const [copied, setCopied] = useState(false)
  const [selectedPreset, setSelectedPreset] = useState<string | null>(null)
  const [selectedModifiers, setSelectedModifiers] = useState<string[]>([])
  const [expandedCats, setExpandedCats] = useState<Set<string>>(new Set())
  const [error, setError] = useState<string | null>(null)
  const [images, setImages] = useState<string[]>([])
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState<{ ok: boolean; msg: string } | null>(null)
  const abortRef = useRef<AbortController | null>(null)
  const outputRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const dropdownRef = useRef<HTMLDivElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const pickerFileInputRef = useRef<HTMLInputElement>(null)
  const [showPicker, setShowPicker] = useState(false)
  const [pickerTab, setPickerTab] = useState<PickerTab>('local')

  const canvasImages = useMemo(() => {
    if (!showPicker) return []
    return useGraphStore.getState().nodes
      .filter(n => n.type === 'image' && (n.data as any)?.url)
      .map(n => ({ id: n.id, src: (n.data as any).url as string, title: (n.data as any)?.label || (n.data as any)?.fileName || '画布图片' }))
  }, [showPicker])

  const historyImages = useMemo(() => {
    if (!showPicker) return []
    return useAssetsStore.getState().getAssetsByType('image').slice(0, 50)
  }, [showPicker])

  const presets = mode === 'image' ? IMAGE_STYLE_PRESETS : VIDEO_STYLE_PRESETS
  const modifiers = MODIFIER_CATEGORIES[mode]

  useEffect(() => {
    if (open) textareaRef.current?.focus()
  }, [open])

  useEffect(() => {
    setSelectedPreset(null)
    setSelectedModifiers([])
    setExpandedCats(new Set())
  }, [mode])

  // 关闭下拉
  useEffect(() => {
    if (!modelDropdownOpen) return
    const handler = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setModelDropdownOpen(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [modelDropdownOpen])

  const setModelAndSave = useCallback((key: string) => {
    setModel(key)
    setModelDropdownOpen(false)
    setTestResult(null)
    try { localStorage.setItem(MODEL_STORAGE_KEY, key) } catch {}
  }, [])

  const toggleCat = useCallback((cat: string) => {
    setExpandedCats(prev => {
      const next = new Set(prev)
      if (next.has(cat)) next.delete(cat)
      else next.add(cat)
      return next
    })
  }, [])

  const toggleModifier = useCallback((mod: string) => {
    setSelectedModifiers(prev =>
      prev.includes(mod) ? prev.filter(m => m !== mod) : [...prev, mod]
    )
  }, [])

  const addImageFiles = useCallback((files: FileList | File[]) => {
    const fileArr = Array.from(files).filter(f => f.type.startsWith('image/'))
    if (fileArr.length === 0) return
    const remaining = MAX_IMAGES - images.length
    if (remaining <= 0) return
    const toAdd = fileArr.slice(0, remaining)
    Promise.all(
      toAdd.map(f => new Promise<string>(resolve => {
        const reader = new FileReader()
        reader.onload = () => resolve(reader.result as string)
        reader.readAsDataURL(f)
      }))
    )
      .then(raws => Promise.all(raws.map(r => compressImage(r))))
      .then(compressed => {
        setImages(cur => [...cur, ...compressed].slice(0, MAX_IMAGES))
      })
  }, [images.length])

  const addImageFromSrc = useCallback(async (src: string, closePicker = false) => {
    if (images.length >= MAX_IMAGES) return
    const compressed = await compressImage(src)
    setImages(cur => [...cur, compressed].slice(0, MAX_IMAGES))
    if (closePicker) setShowPicker(false)
  }, [images.length])

  const handleImageSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) addImageFiles(e.target.files)
    e.target.value = ''
  }, [addImageFiles])

  const handleImageDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    addImageFiles(e.dataTransfer.files)
  }, [addImageFiles])

  const removeImage = useCallback((idx: number) => {
    setImages(prev => prev.filter((_, i) => i !== idx))
  }, [])

  const handleTest = useCallback(async () => {
    setTesting(true)
    setTestResult(null)
    const ctrl = new AbortController()
    const t0 = Date.now()
    try {
      let got = ''
      for await (const chunk of streamAiAssistant(
        model,
        [
          { role: 'system', content: '回复"连接成功"四个字即可，不要多说。' },
          { role: 'user', content: '测试连接' }
        ],
        { signal: ctrl.signal, filterThinking: true }
      )) {
        got += chunk
        if (got.length > 20) break
      }
      ctrl.abort()
      const ms = Date.now() - t0
      setTestResult({ ok: true, msg: `连通 (${ms}ms)` })
    } catch (err: any) {
      if (err?.name !== 'AbortError') {
        setTestResult({ ok: false, msg: err?.message?.slice(0, 80) || '连接失败' })
      }
    } finally {
      setTesting(false)
    }
  }, [model])

  const handleGenerate = useCallback(async () => {
    const text = input.trim()
    if (!text) return

    abortRef.current?.abort()
    const ctrl = new AbortController()
    abortRef.current = ctrl

    setIsGenerating(true)
    setError(null)
    setOutput('')

    const preset = presets.find(p => p.label === selectedPreset)
    const userParts: string[] = [`用户想法：${text}`]
    if (preset) userParts.push(`指定风格：${preset.label} — ${preset.modifiers}`)
    if (selectedModifiers.length > 0) userParts.push(`额外修饰词：${selectedModifiers.join(', ')}`)
    if (images.length > 0) userParts.push(`用户上传了 ${images.length} 张参考图，请仔细分析每张图的主体、风格、色调、构图、光影等视觉特征，并将这些特征融入优化后的提示词中。`)

    const systemPrompt = mode === 'image' ? IMAGE_SYSTEM_PROMPT : VIDEO_SYSTEM_PROMPT

    // 构建 user message content：文本 + 图片（多模态）
    const userContent: any = images.length > 0
      ? [
          { type: 'text', text: userParts.join('\n') },
          ...images.map(url => ({ type: 'image_url', image_url: { url } }))
        ]
      : userParts.join('\n')

    try {
      let full = ''
      for await (const chunk of streamAiAssistant(
        model,
        [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userContent }
        ],
        { signal: ctrl.signal, filterThinking: true }
      )) {
        full += chunk
        setOutput(full)
        if (outputRef.current) {
          outputRef.current.scrollTop = outputRef.current.scrollHeight
        }
      }
    } catch (err: any) {
      if (err?.name !== 'AbortError') {
        setError(err?.message || '生成失败')
      }
    } finally {
      setIsGenerating(false)
    }
  }, [input, mode, model, selectedPreset, selectedModifiers, presets, images])

  const handleCopy = useCallback(() => {
    if (!output) return
    navigator.clipboard.writeText(output)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }, [output])

  const handleReset = useCallback(() => {
    abortRef.current?.abort()
    setInput('')
    setOutput('')
    setSelectedPreset(null)
    setSelectedModifiers([])
    setExpandedCats(new Set())
    setImages([])
    setError(null)
    setIsGenerating(false)
  }, [])

  const handleClose = useCallback(() => {
    abortRef.current?.abort()
    onClose()
  }, [onClose])

  const currentModel = AGENT_MODELS.find(m => m.key === model) || AGENT_MODELS[0]

  if (!open) return null

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="relative flex max-h-[94vh] w-full max-w-5xl flex-col overflow-hidden rounded-2xl border border-[var(--border-color)] bg-[var(--bg-secondary)] shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-[var(--border-color)] px-5 py-3">
          <div className="flex items-center gap-3">
            <Sparkles className="h-5 w-5 text-[var(--accent-color)]" />
            <h2 className="text-base font-semibold text-[var(--text-primary)]">提示词 Agent</h2>
            {/* Mode Toggle */}
            <div className="ml-1 flex rounded-lg border border-[var(--border-color)] bg-[var(--bg-primary)] p-0.5">
              <button
                className={`flex items-center gap-1 rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${
                  mode === 'image'
                    ? 'bg-[var(--accent-color)] text-white'
                    : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
                }`}
                onClick={() => setMode('image')}
              >
                <ImageIcon className="h-3 w-3" />
                生图
              </button>
              <button
                className={`flex items-center gap-1 rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${
                  mode === 'video'
                    ? 'bg-[var(--accent-color)] text-white'
                    : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
                }`}
                onClick={() => setMode('video')}
              >
                <Video className="h-3 w-3" />
                生视频
              </button>
            </div>
            {/* Model Selector */}
            <div className="relative ml-2" ref={dropdownRef}>
              <button
                onClick={() => setModelDropdownOpen(!modelDropdownOpen)}
                className="flex items-center gap-1.5 rounded-lg border border-[var(--border-color)] bg-[var(--bg-primary)] px-2.5 py-1.5 text-xs text-[var(--text-primary)] hover:border-[var(--accent-color)] transition-colors"
              >
                <span className="max-w-[140px] truncate">{currentModel.label}</span>
                <ChevronDown className={`h-3 w-3 shrink-0 transition-transform ${modelDropdownOpen ? 'rotate-180' : ''}`} />
              </button>
              {modelDropdownOpen && (
                <div className="absolute left-0 top-full z-10 mt-1 w-64 rounded-xl border border-[var(--border-color)] bg-[var(--bg-secondary)] py-1 shadow-xl">
                  {AGENT_MODELS.map(m => (
                    <button
                      key={m.key}
                      onClick={() => setModelAndSave(m.key)}
                      className={`flex w-full items-center justify-between px-3 py-2 text-left text-xs transition-colors ${
                        model === m.key
                          ? 'bg-[var(--accent-color)]/10 text-[var(--accent-color)]'
                          : 'text-[var(--text-primary)] hover:bg-[var(--bg-tertiary)]'
                      }`}
                    >
                      <span className="font-medium">{m.label}</span>
                      <span className="text-[10px] text-[var(--text-secondary)]">{m.provider}</span>
                    </button>
                  ))}
                  <div className="mx-2 my-1 h-px bg-[var(--border-color)]" />
                  <button
                    onClick={handleTest}
                    disabled={testing}
                    className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)] disabled:opacity-50"
                  >
                    {testing ? (
                      <Loader2 className="h-3 w-3 animate-spin" />
                    ) : testResult ? (
                      testResult.ok ? <Wifi className="h-3 w-3 text-green-500" /> : <WifiOff className="h-3 w-3 text-red-500" />
                    ) : (
                      <Wifi className="h-3 w-3" />
                    )}
                    {testing ? '测试中...' : testResult ? testResult.msg : '测试连通性'}
                  </button>
                </div>
              )}
            </div>
          </div>
          <div className="flex items-center gap-1">
            <button
              onClick={handleReset}
              className="rounded-lg p-1.5 text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)]"
              title="重置"
            >
              <RotateCcw className="h-4 w-4" />
            </button>
            <button
              onClick={handleClose}
              className="rounded-lg p-1.5 hover:bg-[var(--bg-tertiary)]"
            >
              <X className="h-5 w-5 text-[var(--text-secondary)]" />
            </button>
          </div>
        </div>

        {/* Content */}
        <div className="flex flex-1 gap-4 overflow-hidden p-4">
          {/* 左侧：输入区 */}
          <div className="flex w-[44%] flex-col gap-2.5 overflow-y-auto scrollbar-thin pr-1">
            {/* 输入框 */}
            <div className="flex flex-col gap-1">
              <label className="text-xs font-medium text-[var(--text-secondary)]">描述你的想法</label>
              <textarea
                ref={textareaRef}
                value={input}
                onChange={e => setInput(e.target.value)}
                placeholder={mode === 'image'
                  ? '例：一个赛博朋克女孩站在雨中的霓虹街道上，手持透明雨伞'
                  : '例：一只猫从桌子上优雅地跳到窗台，转身望向窗外淅淅沥沥的雨'}
                className="h-24 resize-none rounded-xl border border-[var(--border-color)] bg-[var(--bg-primary)] px-3 py-2.5 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-secondary)]/40 focus:border-[var(--accent-color)] focus:outline-none"
                onKeyDown={e => {
                  if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                    e.preventDefault()
                    handleGenerate()
                  }
                }}
              />
            </div>

            {/* 参考图上传 */}
            <div className="flex flex-col gap-1">
              <div className="flex items-center justify-between">
                <label className="flex items-center gap-1 text-xs font-medium text-[var(--text-secondary)]">
                  参考图
                  <span className="text-[10px] opacity-60">({images.length}/{MAX_IMAGES})</span>
                </label>
                {images.length < MAX_IMAGES && (
                  <button
                    onClick={() => setShowPicker(true)}
                    className="flex items-center gap-1 rounded-lg border border-[var(--border-color)] bg-[var(--bg-primary)] px-2 py-0.5 text-[11px] text-[var(--text-secondary)] hover:border-[var(--accent-color)] hover:text-[var(--accent-color)] transition-colors"
                  >
                    <Layers className="h-3 w-3" />
                    选择素材
                  </button>
                )}
              </div>
              <div
                className="flex flex-wrap gap-1.5 rounded-xl border border-dashed border-[var(--border-color)] bg-[var(--bg-primary)] p-2 transition-colors hover:border-[var(--accent-color)]"
                onDragOver={e => e.preventDefault()}
                onDrop={handleImageDrop}
              >
                {images.map((src, i) => (
                  <div key={i} className="group relative h-16 w-16 shrink-0 overflow-hidden rounded-lg border border-[var(--border-color)]">
                    <img src={src} alt={`参考图 ${i + 1}`} className="h-full w-full object-cover" />
                    <button
                      onClick={() => removeImage(i)}
                      className="absolute -right-0.5 -top-0.5 flex h-4 w-4 items-center justify-center rounded-full bg-red-500 text-white opacity-0 transition-opacity group-hover:opacity-100"
                    >
                      <X className="h-2.5 w-2.5" />
                    </button>
                  </div>
                ))}
                {images.length < MAX_IMAGES && (
                  <button
                    onClick={() => fileInputRef.current?.click()}
                    className="flex h-16 w-16 shrink-0 items-center justify-center rounded-lg border border-dashed border-[var(--border-color)] text-[var(--text-secondary)] hover:border-[var(--accent-color)] hover:text-[var(--accent-color)] transition-colors"
                    title="本地上传"
                  >
                    <Plus className="h-5 w-5" />
                  </button>
                )}
                {images.length === 0 && (
                  <div className="flex flex-1 items-center justify-center py-1">
                    <span className="text-[11px] text-[var(--text-secondary)] opacity-50">点击 + 上传本地图片，或「选择素材」从画布/历史选取</span>
                  </div>
                )}
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  multiple
                  onChange={handleImageSelect}
                  className="hidden"
                />
              </div>

              {/* 素材选择器弹窗 */}
              {showPicker && (
                <div
                  className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 backdrop-blur-sm"
                  onClick={e => e.target === e.currentTarget && setShowPicker(false)}
                >
                  <div
                    className="flex h-[min(70vh,600px)] w-[min(700px,90vw)] flex-col overflow-hidden rounded-2xl border border-[var(--border-color)] bg-[var(--bg-secondary)] shadow-2xl"
                    onClick={e => e.stopPropagation()}
                  >
                    <div className="flex items-center justify-between border-b border-[var(--border-color)] px-5 py-4">
                      <h3 className="text-base font-semibold text-[var(--text-primary)]">选择参考图</h3>
                      <button onClick={() => setShowPicker(false)} className="rounded-full p-1 text-[var(--text-secondary)] hover:bg-[var(--bg-primary)] hover:text-[var(--text-primary)] transition-colors">
                        <X className="h-5 w-5" />
                      </button>
                    </div>

                    <div className="flex border-b border-[var(--border-color)] px-5">
                      {([
                        { key: 'local' as PickerTab, label: '本地上传', icon: <Upload className="h-3.5 w-3.5" /> },
                        { key: 'canvas' as PickerTab, label: '画布素材', icon: <Layers className="h-3.5 w-3.5" /> },
                        { key: 'history' as PickerTab, label: '历史素材', icon: <History className="h-3.5 w-3.5" /> },
                      ]).map(tab => (
                        <button
                          key={tab.key}
                          onClick={() => setPickerTab(tab.key)}
                          className={cn(
                            'flex items-center gap-1.5 px-4 py-2.5 text-xs font-medium border-b-2 transition-colors -mb-px',
                            pickerTab === tab.key
                              ? 'border-[var(--accent-color)] text-[var(--accent-color)]'
                              : 'border-transparent text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
                          )}
                        >
                          {tab.icon}
                          {tab.label}
                        </button>
                      ))}
                    </div>

                    <div className="flex-1 overflow-auto p-4">
                      {pickerTab === 'local' && (
                        <div
                          className="flex h-full flex-col items-center justify-center gap-4 rounded-xl border-2 border-dashed border-[var(--border-color)] bg-[var(--bg-primary)] p-8 transition-colors hover:border-[var(--accent-color)]"
                          onDragOver={e => e.preventDefault()}
                          onDrop={e => { e.preventDefault(); addImageFiles(e.dataTransfer.files); setShowPicker(false) }}
                        >
                          <div className="flex h-16 w-16 items-center justify-center rounded-full bg-[rgb(var(--accent-rgb)/0.1)]">
                            <FolderOpen className="h-8 w-8 text-[var(--accent-color)]" />
                          </div>
                          <div className="text-center">
                            <div className="text-sm font-medium text-[var(--text-primary)]">拖拽图片到此处</div>
                            <div className="mt-1 text-xs text-[var(--text-secondary)]">或点击下方按钮选择文件（自动压缩）</div>
                          </div>
                          <button
                            onClick={() => pickerFileInputRef.current?.click()}
                            className="flex items-center gap-2 rounded-lg bg-[var(--accent-color)] px-4 py-2 text-sm font-medium text-white hover:bg-[var(--accent-hover)] transition-colors"
                          >
                            <Upload className="h-4 w-4" />
                            选择图片
                          </button>
                          <input
                            ref={pickerFileInputRef}
                            type="file"
                            accept="image/*"
                            multiple
                            onChange={e => { if (e.target.files) { addImageFiles(e.target.files); setShowPicker(false) }; e.target.value = '' }}
                            className="hidden"
                          />
                        </div>
                      )}

                      {pickerTab === 'canvas' && (
                        canvasImages.length > 0 ? (
                          <div>
                            <div className="mb-3 flex items-center gap-2 text-sm font-medium text-[var(--text-primary)]">
                              <Layers className="h-4 w-4 text-[var(--accent-color)]" />
                              画布中的图片
                              <span className="text-xs text-[var(--text-secondary)]">({canvasImages.length})</span>
                            </div>
                            <div className="grid grid-cols-4 gap-3">
                              {canvasImages.map(img => (
                                <button
                                  key={img.id}
                                  onClick={() => addImageFromSrc(img.src, true)}
                                  className="group relative aspect-square overflow-hidden rounded-lg border border-[var(--border-color)] bg-[var(--bg-primary)] hover:border-[var(--accent-color)] transition-colors"
                                >
                                  <img src={img.src} alt={img.title} className="h-full w-full object-cover" />
                                  <div className="absolute inset-0 flex items-end bg-gradient-to-t from-black/60 to-transparent opacity-0 group-hover:opacity-100 transition-opacity">
                                    <span className="w-full truncate px-2 py-1.5 text-[10px] text-white">{img.title}</span>
                                  </div>
                                </button>
                              ))}
                            </div>
                          </div>
                        ) : (
                          <div className="flex h-full items-center justify-center text-sm text-[var(--text-secondary)]">画布中暂无图片</div>
                        )
                      )}

                      {pickerTab === 'history' && (
                        historyImages.length > 0 ? (
                          <div>
                            <div className="mb-3 flex items-center gap-2 text-sm font-medium text-[var(--text-primary)]">
                              <History className="h-4 w-4 text-[var(--accent-color)]" />
                              历史素材
                              <span className="text-xs text-[var(--text-secondary)]">({historyImages.length})</span>
                            </div>
                            <div className="grid grid-cols-4 gap-3">
                              {historyImages.map(asset => (
                                <button
                                  key={asset.id}
                                  onClick={() => addImageFromSrc(asset.src, true)}
                                  className="group relative aspect-square overflow-hidden rounded-lg border border-[var(--border-color)] bg-[var(--bg-primary)] hover:border-[var(--accent-color)] transition-colors"
                                >
                                  <img src={asset.src} alt={asset.title || '历史图片'} className="h-full w-full object-cover" />
                                  <div className="absolute inset-0 flex items-end bg-gradient-to-t from-black/60 to-transparent opacity-0 group-hover:opacity-100 transition-opacity">
                                    <span className="w-full truncate px-2 py-1.5 text-[10px] text-white">{asset.title || asset.model || '历史图片'}</span>
                                  </div>
                                </button>
                              ))}
                            </div>
                          </div>
                        ) : (
                          <div className="flex h-full items-center justify-center text-sm text-[var(--text-secondary)]">暂无历史素材</div>
                        )
                      )}
                    </div>

                    <div className="flex justify-end border-t border-[var(--border-color)] p-4">
                      <Button variant="ghost" onClick={() => setShowPicker(false)}>取消</Button>
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* 风格预设 */}
            <div className="flex flex-col gap-1">
              <label className="text-xs font-medium text-[var(--text-secondary)]">风格预设</label>
              <div className="flex flex-wrap gap-1">
                {presets.map(p => (
                  <button
                    key={p.label}
                    onClick={() => setSelectedPreset(prev => prev === p.label ? null : p.label)}
                    className={`rounded-md px-2 py-1 text-[11px] transition-colors ${
                      selectedPreset === p.label
                        ? 'bg-[var(--accent-color)] text-white'
                        : 'bg-[var(--bg-primary)] text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)] hover:text-[var(--text-primary)]'
                    }`}
                    title={`${p.desc}\n${p.modifiers}`}
                  >
                    {p.label}
                  </button>
                ))}
              </div>
            </div>

            {/* 修饰词库 */}
            <div className="flex flex-col gap-1">
              <label className="flex items-center gap-1 text-xs font-medium text-[var(--text-secondary)]">
                修饰词库
                {selectedModifiers.length > 0 && (
                  <span className="rounded-full bg-[var(--accent-color)] px-1.5 text-[10px] text-white">
                    {selectedModifiers.length}
                  </span>
                )}
              </label>
              <div className="rounded-xl border border-[var(--border-color)] bg-[var(--bg-primary)]">
                {modifiers.map((cat, i) => (
                  <div key={cat.cat} className={i > 0 ? 'border-t border-[var(--border-color)]' : ''}>
                    <button
                      onClick={() => toggleCat(cat.cat)}
                      className="flex w-full items-center gap-1.5 px-3 py-1.5 text-left text-[11px] font-semibold text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors"
                    >
                      <ChevronRight className={`h-3 w-3 shrink-0 transition-transform ${expandedCats.has(cat.cat) ? 'rotate-90' : ''}`} />
                      {cat.cat}
                      {cat.items.filter(it => selectedModifiers.includes(it)).length > 0 && (
                        <span className="rounded-full bg-[var(--accent-color)]/20 px-1.5 text-[10px] text-[var(--accent-color)]">
                          {cat.items.filter(it => selectedModifiers.includes(it)).length}
                        </span>
                      )}
                    </button>
                    {expandedCats.has(cat.cat) && (
                      <div className="flex flex-wrap gap-1 px-3 pb-2">
                        {cat.items.map(item => (
                          <button
                            key={item}
                            onClick={() => toggleModifier(item)}
                            className={`rounded-md px-1.5 py-0.5 text-[11px] transition-colors ${
                              selectedModifiers.includes(item)
                                ? 'bg-[var(--accent-color)]/20 text-[var(--accent-color)] ring-1 ring-[var(--accent-color)]/40'
                                : 'bg-[var(--bg-secondary)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
                            }`}
                          >
                            {item}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>

            {/* 生成按钮 */}
            <Button
              onClick={handleGenerate}
              disabled={!input.trim() || isGenerating}
              className="w-full shrink-0"
            >
              {isGenerating ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  生成中...
                </>
              ) : (
                <>
                  <Zap className="mr-2 h-4 w-4" />
                  优化提示词
                  <span className="ml-2 text-[10px] opacity-60">⌘↵</span>
                </>
              )}
            </Button>

            {error && (
              <div className="shrink-0 rounded-lg bg-red-500/10 p-2.5 text-xs text-red-500">
                {error}
              </div>
            )}
          </div>

          {/* 右侧：输出区 */}
          <div className="flex flex-1 flex-col gap-1.5">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-[var(--text-secondary)]">优化结果</span>
              <button
                onClick={handleCopy}
                disabled={!output}
                className="flex items-center gap-1 rounded-lg px-2 py-1 text-xs text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)] disabled:opacity-50"
              >
                {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
                {copied ? '已复制' : '复制'}
              </button>
            </div>
            <div
              ref={outputRef}
              className="flex-1 overflow-auto rounded-xl border border-[var(--border-color)] bg-[var(--bg-primary)] p-4"
            >
              {output ? (
                <pre className="whitespace-pre-wrap text-sm leading-relaxed text-[var(--text-primary)]">{output}</pre>
              ) : (
                <div className="flex h-full flex-col items-center justify-center gap-3 text-[var(--text-secondary)] opacity-40">
                  <Sparkles className="h-10 w-10" />
                  <span className="text-sm">
                    {mode === 'image' ? '输入想法，AI 为你生成专业生图提示词' : '输入想法，AI 为你生成专业视频提示词'}
                  </span>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>,
    document.body
  )
}
