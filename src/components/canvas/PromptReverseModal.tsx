/**
 * PromptReverseModal - 提示词逆推组件
 * 用户上传图片，AI 分析并输出结构化提示词
 */

import React, { useState, useCallback, useRef } from 'react'
import { createPortal } from 'react-dom'
import { X, Upload, Loader2, Copy, Check, Image as ImageIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { streamChatCompletions } from '@/api'

interface Props {
  open: boolean
  onClose: () => void
}

const SYSTEM_PROMPT = `你是一位顶级图像分析与逆向提示词专家。当收到一张图片时，你需要完成两件事：

## 第一部分：中文文本提示词
输出一段详尽的中文描述，可直接用于图像生成模型精确复现原图。要求：
- 描述必须足够精确，让任何图像生成模型仅凭此文本就能还原原图 90% 以上的视觉信息
- 使用标准的 Stable Diffusion / Midjourney 提示词风格（关键词之间用逗号分隔）
- 按重要性排序：主体 > 动作/姿势 > 服饰细节 > 环境/背景 > 光线/氛围 > 风格/画质

## 第二部分：结构化 JSON
输出分隔符 ---JSON--- 后，给出完整的 JSON 对象（键名英文，值中文），包含以下所有字段：

{
  "invariant_conditions": ["列出复现此图时不可变更的核心条件，如特定角色特征、关键构图元素、标志性视觉符号等"],
  "subject": {
    "type": "人物/动物/物体/场景/抽象",
    "description": "主体的整体描述",
    "count": "主体数量",
    "gender": "性别（如适用）",
    "age_range": "年龄范围（如适用）",
    "ethnicity": "种族/民族特征（如适用）",
    "body_type": "体型特征",
    "skin": "肤色与皮肤质感"
  },
  "face_and_expression": {
    "face_shape": "脸型",
    "eyes": "眼睛细节（形状、颜色、妆容）",
    "eyebrows": "眉形",
    "nose": "鼻型",
    "lips": "唇形与唇色",
    "expression": "表情",
    "makeup": "妆容细节"
  },
  "hairstyle": {
    "length": "长度",
    "color": "发色",
    "style": "发型（卷/直/编发/盘发等）",
    "accessories": "发饰"
  },
  "clothing": {
    "upper_body": "上身衣物（材质、颜色、款式、图案）",
    "lower_body": "下身衣物",
    "footwear": "鞋子",
    "outerwear": "外套/披风等"
  },
  "accessories": {
    "jewelry": "首饰（项链、耳环、戒指、手链等）",
    "eyewear": "眼镜/墨镜",
    "headwear": "帽子/头饰",
    "handheld": "手持物品（包、伞、武器、道具等）",
    "other": "其他配饰"
  },
  "body_pose": {
    "overall_pose": "整体姿势描述",
    "head_tilt": "头部朝向与倾斜",
    "hand_position": "手部位置与姿态",
    "leg_position": "腿部位置（如可见）",
    "body_orientation": "身体朝向（正面/侧面/背面/四分之三角度）"
  },
  "environment": {
    "setting": "场景类型（室内/室外/虚拟/抽象）",
    "location": "具体地点描述",
    "background": "背景元素细节",
    "foreground": "前景元素",
    "props": "场景中的道具与物品",
    "weather": "天气/天空状态（如适用）",
    "time_of_day": "时间段"
  },
  "lighting": {
    "type": "光线类型（自然光/人造光/混合/戏剧性/平光等）",
    "direction": "光线方向（正面/侧面/逆光/顶光/底光）",
    "intensity": "光线强度",
    "color_temperature": "色温（暖/冷/中性）",
    "shadows": "阴影特征",
    "highlights": "高光特征",
    "special_effects": "特殊光效（光斑、丁达尔效应、霓虹灯等）"
  },
  "camera": {
    "angle": "拍摄角度（平视/俯视/仰视/鸟瞰）",
    "shot_type": "景别（特写/半身/全身/中景/远景/微距）",
    "focal_length": "等效焦距描述（广角/标准/长焦/超长焦）",
    "depth_of_field": "景深（浅景深/深景深/全景深）",
    "lens_type": "镜头类型（定焦/变焦/鱼眼/移轴等）",
    "perspective": "透视效果"
  },
  "composition": {
    "layout": "构图法则（三分法/中心对称/黄金比例/对角线/引导线等）",
    "framing": "画面裁切与留白",
    "focal_point": "视觉焦点位置",
    "balance": "画面平衡感"
  },
  "style": {
    "art_style": "艺术风格（写实/超写实/动漫/赛博朋克/水彩/油画/3D渲染等）",
    "rendering": "渲染方式（摄影/CG/插画/混合媒介）",
    "era_influence": "年代/流派影响",
    "reference_artists": "风格参考（如有明显相似的艺术风格）"
  },
  "color_palette": {
    "dominant_colors": ["主色调列表"],
    "accent_colors": ["点缀色列表"],
    "overall_tone": "整体色调（暖调/冷调/中性/高饱和/低饱和）",
    "contrast": "对比度（高/中/低）"
  },
  "quality_modifiers": ["4K", "高细节", "精细纹理", "电影质感", "等相关画质描述词"],
  "negative_prompt_suggestions": ["建议排除的元素，如变形、低质量等"]
}`

const DEFAULT_CHAT_MODEL = 'gpt-5-mini'

export default function PromptReverseModal({ open, onClose }: Props) {
  const [image, setImage] = useState<string | null>(null)
  const [isAnalyzing, setIsAnalyzing] = useState(false)
  const [textPrompt, setTextPrompt] = useState('')
  const [jsonPrompt, setJsonPrompt] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [copiedText, setCopiedText] = useState(false)
  const [copiedJson, setCopiedJson] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const handleFileSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    const reader = new FileReader()
    reader.onload = () => {
      setImage(reader.result as string)
      setTextPrompt('')
      setJsonPrompt('')
      setError(null)
    }
    reader.readAsDataURL(file)
  }, [])

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    const file = e.dataTransfer.files[0]
    if (!file || !file.type.startsWith('image/')) return

    const reader = new FileReader()
    reader.onload = () => {
      setImage(reader.result as string)
      setTextPrompt('')
      setJsonPrompt('')
      setError(null)
    }
    reader.readAsDataURL(file)
  }, [])

  const handleAnalyze = useCallback(async () => {
    if (!image) return

    setIsAnalyzing(true)
    setError(null)
    setTextPrompt('')
    setJsonPrompt('')

    try {
      const messages = [
        { role: 'system', content: SYSTEM_PROMPT },
        {
          role: 'user',
          content: [
            { type: 'text', text: '请分析这张图片，提供详细的中文文本提示词和结构化的 JSON 表示。' },
            { type: 'image_url', image_url: { url: image } }
          ]
        }
      ]

      let fullResponse = ''
      for await (const chunk of streamChatCompletions({
        model: DEFAULT_CHAT_MODEL,
        messages
      })) {
        fullResponse += chunk

        // 尝试分离文本和 JSON 部分
        const separator = '---JSON---'
        const sepIndex = fullResponse.indexOf(separator)
        if (sepIndex >= 0) {
          setTextPrompt(fullResponse.slice(0, sepIndex).trim())
          const jsonPart = fullResponse.slice(sepIndex + separator.length).trim()
          // 尝试提取 JSON 代码块
          const jsonMatch = jsonPart.match(/```(?:json)?\s*([\s\S]*?)```/) || [null, jsonPart]
          setJsonPrompt(jsonMatch[1]?.trim() || jsonPart)
        } else {
          setTextPrompt(fullResponse)
        }
      }
    } catch (err: any) {
      console.error('[PromptReverse] 分析失败:', err)
      setError(err?.message || '分析失败')
    } finally {
      setIsAnalyzing(false)
    }
  }, [image])

  const handleCopyText = useCallback(() => {
    if (textPrompt) {
      navigator.clipboard.writeText(textPrompt)
      setCopiedText(true)
      setTimeout(() => setCopiedText(false), 2000)
    }
  }, [textPrompt])

  const handleCopyJson = useCallback(() => {
    if (jsonPrompt) {
      navigator.clipboard.writeText(jsonPrompt)
      setCopiedJson(true)
      setTimeout(() => setCopiedJson(false), 2000)
    }
  }, [jsonPrompt])

  const handleClose = useCallback(() => {
    setImage(null)
    setTextPrompt('')
    setJsonPrompt('')
    setError(null)
    onClose()
  }, [onClose])

  if (!open) return null

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="relative flex max-h-[90vh] w-full max-w-5xl flex-col overflow-hidden rounded-2xl border border-[var(--border-color)] bg-[var(--bg-secondary)] shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-[var(--border-color)] px-6 py-4">
          <h2 className="text-lg font-semibold text-[var(--text-primary)]">提示词逆推</h2>
          <button
            onClick={handleClose}
            className="rounded-lg p-2 hover:bg-[var(--bg-tertiary)]"
          >
            <X className="h-5 w-5 text-[var(--text-secondary)]" />
          </button>
        </div>

        {/* Content */}
        <div className="flex flex-1 gap-4 overflow-hidden p-6">
          {/* 左侧：图片上传 */}
          <div className="flex w-1/3 flex-col gap-4">
            <div
              className="flex flex-1 flex-col items-center justify-center rounded-xl border-2 border-dashed border-[var(--border-color)] bg-[var(--bg-primary)] p-4 transition-colors hover:border-[var(--accent-color)]"
              onDragOver={(e) => e.preventDefault()}
              onDrop={handleDrop}
              onClick={() => fileInputRef.current?.click()}
            >
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                onChange={handleFileSelect}
                className="hidden"
              />
              {image ? (
                <img
                  src={image}
                  alt="上传的图片"
                  className="max-h-[300px] max-w-full rounded-lg object-contain"
                />
              ) : (
                <div className="flex flex-col items-center gap-3 text-[var(--text-secondary)]">
                  <Upload className="h-12 w-12 opacity-50" />
                  <span className="text-sm">点击或拖拽上传图片</span>
                </div>
              )}
            </div>

            <Button
              onClick={handleAnalyze}
              disabled={!image || isAnalyzing}
              className="w-full"
            >
              {isAnalyzing ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  分析中...
                </>
              ) : (
                <>
                  <ImageIcon className="mr-2 h-4 w-4" />
                  分析图片
                </>
              )}
            </Button>

            {error && (
              <div className="rounded-lg bg-red-500/10 p-3 text-sm text-red-500">
                {error}
              </div>
            )}
          </div>

          {/* 右侧：结果显示 */}
          <div className="flex flex-1 gap-4">
            {/* 纯文本结果 */}
            <div className="flex flex-1 flex-col gap-2">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium text-[var(--text-secondary)]">文本提示词</span>
                <button
                  onClick={handleCopyText}
                  disabled={!textPrompt}
                  className="flex items-center gap-1 rounded-lg px-2 py-1 text-xs text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)] disabled:opacity-50"
                >
                  {copiedText ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
                  {copiedText ? '已复制' : '复制'}
                </button>
              </div>
              <div className="flex-1 overflow-auto rounded-xl border border-[var(--border-color)] bg-[var(--bg-primary)] p-4">
                {textPrompt ? (
                  <pre className="whitespace-pre-wrap text-sm text-[var(--text-primary)]">{textPrompt}</pre>
                ) : (
                  <div className="flex h-full items-center justify-center text-sm text-[var(--text-secondary)] opacity-50">
                    分析结果将显示在这里
                  </div>
                )}
              </div>
            </div>

            {/* JSON 结果 */}
            <div className="flex flex-1 flex-col gap-2">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium text-[var(--text-secondary)]">结构化 JSON</span>
                <button
                  onClick={handleCopyJson}
                  disabled={!jsonPrompt}
                  className="flex items-center gap-1 rounded-lg px-2 py-1 text-xs text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)] disabled:opacity-50"
                >
                  {copiedJson ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
                  {copiedJson ? '已复制' : '复制'}
                </button>
              </div>
              <div className="flex-1 overflow-auto rounded-xl border border-[var(--border-color)] bg-[var(--bg-primary)] p-4">
                {jsonPrompt ? (
                  <pre className="whitespace-pre-wrap text-sm text-[var(--text-primary)] font-mono">{jsonPrompt}</pre>
                ) : (
                  <div className="flex h-full items-center justify-center text-sm text-[var(--text-secondary)] opacity-50">
                    JSON 结构将显示在这里
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>,
    document.body
  )
}
