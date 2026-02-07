import type { EcomSceneType } from './types'

export interface EcomTemplate {
  id: string
  name: string
  description: string
  sceneType: EcomSceneType
  presetId: string
  aspectRatio: string
  promptHint: string
}

export const ECOM_TEMPLATES: EcomTemplate[] = [
  // Hero templates
  { id: 'hero_white_front', name: '白底正面', description: '纯白背景，正面产品展示', sceneType: 'hero', presetId: 'ecommerce_hero', aspectRatio: '1:1', promptHint: '纯白背景，正面视角，专业棚拍灯光' },
  { id: 'hero_white_45', name: '白底45°', description: '纯白背景，45度最佳展示角度', sceneType: 'hero', presetId: 'ecommerce_hero', aspectRatio: '1:1', promptHint: '纯白背景，45度角，展示产品最佳立体感' },
  { id: 'hero_scene', name: '场景化', description: '生活化场景中的产品展示', sceneType: 'hero', presetId: 'lifestyle_scene', aspectRatio: '1:1', promptHint: '生活场景中自然展示产品，温暖自然光' },
  { id: 'hero_gradient', name: '渐变背景', description: '现代渐变背景悬浮展示', sceneType: 'hero', presetId: 'ecommerce_hero', aspectRatio: '1:1', promptHint: '现代渐变背景，产品悬浮展示，高级感' },
  { id: 'hero_multi_angle', name: '多角度', description: '6-9个角度全方位展示', sceneType: 'hero', presetId: 'product_multiangle', aspectRatio: '1:1', promptHint: '多角度展示，正面/侧面/背面/俯视' },

  // Detail page templates
  { id: 'detail_9grid', name: '一键9图套组', description: '标准电商详情页9张图一键生成', sceneType: 'detail_page', presetId: 'detail_page_grid', aspectRatio: '3:4', promptHint: '主图+卖点+细节+场景+信任页' },
  { id: 'detail_food', name: '食品详情页', description: '食品类目专用详情页套图', sceneType: 'detail_page', presetId: 'food_photography', aspectRatio: '3:4', promptHint: '食欲感+材质+包装+配料+场景' },
  { id: 'detail_jewelry', name: '珠宝详情页', description: '珠宝首饰专用详情页套图', sceneType: 'detail_page', presetId: 'jewelry_showcase', aspectRatio: '3:4', promptHint: '4K微距+佩戴效果+礼盒+工艺细节' },

  // Try-on templates
  { id: 'tryon_upper', name: '上装试穿', description: '上衣/外套虚拟试穿', sceneType: 'try_on', presetId: 'model_showcase', aspectRatio: '3:4', promptHint: '上传模特全身照+服装平铺图' },
  { id: 'tryon_full', name: '全身搭配', description: '全身穿搭效果展示', sceneType: 'try_on', presetId: 'model_showcase', aspectRatio: '3:4', promptHint: '上传模特照+完整搭配服装' },

  // Poster templates
  { id: 'poster_double11', name: '双11大促', description: '双十一购物节活动海报', sceneType: 'poster', presetId: 'promo_poster', aspectRatio: '9:16', promptHint: '红金配色，节日氛围，大字促销' },
  { id: 'poster_618', name: '618年中', description: '618年中大促海报', sceneType: 'poster', presetId: 'promo_poster', aspectRatio: '9:16', promptHint: '清爽夏日配色，活力促销' },
  { id: 'poster_newyear', name: '新年特惠', description: '春节/新年促销海报', sceneType: 'poster', presetId: 'promo_poster', aspectRatio: '9:16', promptHint: '中国红+金色，喜庆传统' },
  { id: 'poster_minimal', name: '极简主视觉', description: '高端品牌极简海报', sceneType: 'poster', presetId: 'ecom_poster_fashion_hero_916', aspectRatio: '9:16', promptHint: '极简留白，大气品牌调性' },
  { id: 'poster_lifestyle', name: '场景种草', description: '生活场景种草海报', sceneType: 'poster', presetId: 'ecom_poster_fashion_scene_916', aspectRatio: '9:16', promptHint: '生活化场景+产品自然植入' },

  // Video templates
  { id: 'video_rotate', name: '360°旋转展示', description: '商品360度慢旋转，展示全部细节', sceneType: 'video', presetId: '', aspectRatio: '9:16', promptHint: '产品居中慢速旋转，白底/渐变背景' },
  { id: 'video_showcase', name: '电影级展示', description: '戏剧性光影+微距切换的产品大片', sceneType: 'video', presetId: '', aspectRatio: '9:16', promptHint: '推镜头+特写+光影过渡' },
  { id: 'video_unbox', name: '开箱视频', description: '产品开箱过程，展示包装和配件', sceneType: 'video', presetId: '', aspectRatio: '9:16', promptHint: '手部特写+拆箱+逐一展示' },
  { id: 'video_lifestyle', name: '场景使用', description: '产品在生活场景中的使用展示', sceneType: 'video', presetId: '', aspectRatio: '9:16', promptHint: '自然光+真实场景+使用过程' },
  { id: 'video_digital_human', name: '数字人带货', description: 'AI数字人口播介绍产品卖点', sceneType: 'video', presetId: '', aspectRatio: '9:16', promptHint: '上传人像+音频→数字人口播视频' },

  // Batch templates
  { id: 'batch_white_bg', name: '批量白底主图', description: '批量生成纯白背景商品主图', sceneType: 'batch', presetId: 'ecommerce_hero', aspectRatio: '1:1', promptHint: '上传多个商品图→批量白底主图' },
  { id: 'batch_scene', name: '批量场景图', description: '批量为商品生成场景化展示图', sceneType: 'batch', presetId: 'lifestyle_scene', aspectRatio: '1:1', promptHint: '上传多个商品图→批量场景合成' },
  { id: 'batch_pattern', name: '图案贴合', description: '将自定义图案贴合到物品样板上', sceneType: 'batch', presetId: '', aspectRatio: '1:1', promptHint: '上传样板+图案→AI贴合出图' },
]

export const getTemplatesByScene = (sceneType: EcomSceneType): EcomTemplate[] =>
  ECOM_TEMPLATES.filter(t => t.sceneType === sceneType)
