/**
 * Error resolver | 错误解析与提示
 * Convert common API errors into actionable hints.
 */

const normalizeText = (text) => String(text || '').trim()

const matchAny = (text, patterns) => patterns.some((re) => re.test(text))

export const buildErrorHints = (message, { status, modelKey } = {}) => {
  const raw = normalizeText(message)
  if (!raw) return []

  const lower = raw.toLowerCase()
  const hints = []

  if (matchAny(lower, [/elanrefused/i, /dns resolver/i, /enotfound/i])) {
    hints.push('文档兼容性问题，建议用 Apifox 调试')
  }

  if (matchAny(raw, [/请求失败.*联系客服/, /request failed/i])) {
    hints.push('多为余额不足或扣费分组未设置')
  }

  if (matchAny(raw, [/余额不足/, /insufficient/i, /quota/i])) {
    hints.push('余额不足，请充值后再试')
  }

  if (matchAny(raw, [/无可用渠道/, /no available channel/i])) {
    hints.push('检查令牌分组是否与模型广场一致')
  }

  if (matchAny(raw, [/上游分组已满/, /负载饱和/, /生成超时/, /timeout/i, /saturated/i])) {
    hints.push('该提示多为“审核/超时”的兜底文案，不一定真是分组满')
    hints.push('检查模型名/分组是否正确，简化提示词/素材并稍后重试')
  }

  if (matchAny(lower, [/model.*not found/i, /invalid model/i, /模型名称/])) {
    hints.push('模型名称需与模型广场一致')
  }

  if (matchAny(lower, [/size is required/i, /missing size/i])) {
    hints.push('该模型需要 size 参数，可切换尺寸后重试')
  }

  if (matchAny(lower, [/public_error_audio_filtered/i])) {
    hints.push('音频被过滤，尝试更换提示词/素材或切换模型')
  }

  if (status === 401) {
    hints.push('API Key 无效或已过期')
  }

  if (status === 429) {
    hints.push('请求过于频繁，稍后再试')
  }

  if (modelKey && /sora/i.test(modelKey)) {
    hints.push('Sora2 不支持真人图，提示词审核较严格')
  }

  if (modelKey && /veo/i.test(modelKey)) {
    hints.push('Veo 模型对素材/提示词审查严格，可降低复杂度后重试')
  }

  return hints.slice(0, 3)
}

export const formatErrorMessage = (message, options = {}) => {
  const raw = normalizeText(message)
  if (!raw) return ''

  const hints = buildErrorHints(raw, options)
  if (hints.length === 0) return raw

  return `${raw}（建议：${hints.join('；')}）`
}

export const enhanceApiError = (error, options = {}) => {
  if (!error) return error
  if (error.__enhanced) return error

  const status = error?.response?.status
  const rawMessage = error?.message || String(error)
  const message = formatErrorMessage(rawMessage, { status, ...options })

  const next = error instanceof Error ? error : new Error(message)
  next.message = message
  next.__enhanced = true
  return next
}
