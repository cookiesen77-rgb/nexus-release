/**
 * Camera Control Prompt Builder
 * 根据相机参数生成精准的英文提示词
 * 参考 TapNow 的视角-提示词映射算法
 */

export interface CameraParams {
  rotateAngle: number      // -180 ~ 180，正值左转，负值右转
  moveForward: number      // 0 ~ 10，0=原位，10=特写
  verticalAngle: number    // -1 ~ 1，-1=俯视，0=平视，1=仰视
  wideAngle: boolean       // 广角镜头开关
}

export const DEFAULT_CAMERA_PARAMS: CameraParams = {
  rotateAngle: 0,
  moveForward: 0,
  verticalAngle: 0,
  wideAngle: false,
}

/**
 * 根据相机参数生成提示词
 * 使用 TapNow 风格的精确映射
 */
export function buildCameraPrompt(params: CameraParams): string {
  const parts: string[] = []

  // 将 verticalAngle (-1~1) 转换为极角 (30°~150°)
  // -1 → 30° (俯视), 0 → 90° (平视), 1 → 150° (仰视)
  const polarAngle = 90 - params.verticalAngle * 60

  // 俯仰角度 - 基于极角映射
  if (polarAngle < 45) {
    parts.push("Bird's eye view, high angle shot, top-down perspective")
  } else if (polarAngle < 60) {
    parts.push("High angle shot, looking down at the subject")
  } else if (polarAngle > 135) {
    parts.push("Worm's eye view, low angle shot, looking up from below")
  } else if (polarAngle > 120) {
    parts.push("Low angle shot, looking up at the subject")
  }

  // 水平方位 - 基于方位角映射
  const absAzimuth = Math.abs(params.rotateAngle)
  if (absAzimuth <= 10) {
    parts.push("Front view, straight on")
  } else if (absAzimuth >= 170) {
    parts.push("Back view, from behind")
  } else if (absAzimuth >= 80 && absAzimuth <= 100) {
    const side = params.rotateAngle > 0 ? 'left' : 'right'
    parts.push(`Side profile view, 90 degree angle from the ${side}`)
  } else if (absAzimuth >= 125 && absAzimuth < 170) {
    const side = params.rotateAngle > 0 ? 'left' : 'right'
    parts.push(`Back three-quarter view, from behind and ${side}`)
  } else if (absAzimuth > 10 && absAzimuth < 80) {
    const side = params.rotateAngle > 0 ? 'left' : 'right'
    parts.push(`Three-quarter view, ${absAzimuth} degrees from ${side}`)
  }

  // 推进距离 → 构图距离
  // 0~3 (0-30%) → 远景/全身
  // 3~7 (30-70%) → 中景
  // 7~10 (70-100%) → 特写
  if (params.moveForward >= 7) {
    parts.push("Extreme close-up, macro shot, focusing on facial details")
  } else if (params.moveForward >= 5) {
    parts.push("Close-up shot, head and shoulders framing")
  } else if (params.moveForward >= 3) {
    parts.push("Medium shot, waist up, portrait framing")
  } else if (params.moveForward >= 1) {
    parts.push("Full body shot, medium-wide framing")
  }

  // 广角镜头 - 模拟光学特性
  if (params.wideAngle) {
    parts.push("Shot on 16mm wide-angle lens, dynamic perspective, barrel distortion effect, expanded background, immersive view")
  }

  // 如果没有任何参数变化
  if (parts.length === 0) {
    return 'Keep the same camera angle and framing. Maintain subject consistency and identity.'
  }

  // 组合提示词并添加一致性保持指令
  return parts.join('. ') + '. Maintain subject consistency, preserve all identifying features including face, clothing, hairstyle, and accessories.'
}

/**
 * 生成负向提示词（用于避免不想要的效果）
 */
export function buildNegativePrompt(params: CameraParams): string {
  const negatives: string[] = []

  // 广角镜头的负向提示
  if (params.wideAngle) {
    negatives.push("telephoto lens, flat perspective, compressed background, zoom lens, 85mm, portrait lens")
  } else {
    negatives.push("fisheye, barrel distortion, ultra wide angle")
  }

  // 基本负向提示
  negatives.push("blurry, low quality, distorted face, extra limbs")

  return negatives.join(', ')
}

/**
 * 获取参数的中文描述（用于UI显示）
 */
export function getParamDescription(params: CameraParams): string {
  const parts: string[] = []

  // 方位描述
  const absAzimuth = Math.abs(params.rotateAngle)
  if (absAzimuth <= 10) {
    parts.push('正面')
  } else if (absAzimuth >= 170) {
    parts.push('背面')
  } else if (absAzimuth >= 80 && absAzimuth <= 100) {
    parts.push(params.rotateAngle > 0 ? '左侧面' : '右侧面')
  } else if (absAzimuth >= 125) {
    parts.push(params.rotateAngle > 0 ? '左后方' : '右后方')
  } else if (absAzimuth > 10) {
    parts.push(params.rotateAngle > 0 ? '左前方' : '右前方')
  }

  // 俯仰描述
  const polarAngle = 90 - params.verticalAngle * 60
  if (polarAngle < 45) {
    parts.push('俯视')
  } else if (polarAngle < 60) {
    parts.push('高角度')
  } else if (polarAngle > 135) {
    parts.push('仰视')
  } else if (polarAngle > 120) {
    parts.push('低角度')
  }

  // 距离描述
  if (params.moveForward >= 7) {
    parts.push('特写')
  } else if (params.moveForward >= 5) {
    parts.push('近景')
  } else if (params.moveForward >= 3) {
    parts.push('中景')
  } else if (params.moveForward >= 1) {
    parts.push('全景')
  } else {
    parts.push('远景')
  }

  if (params.wideAngle) {
    parts.push('广角')
  }

  return parts.join(' · ')
}

/**
 * 检查参数是否有变化
 */
export function hasParamChanges(params: CameraParams): boolean {
  return (
    Math.abs(params.rotateAngle) >= 5 ||
    Math.abs(params.verticalAngle) >= 0.1 ||
    params.moveForward >= 1 ||
    params.wideAngle
  )
}
