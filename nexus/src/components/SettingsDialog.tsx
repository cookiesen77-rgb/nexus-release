import React, { useState, useEffect } from 'react'
import { ExternalLink, KeyRound, Bot, RefreshCw, Plus, Trash2, Ban, Clock, Zap, ChevronDown, ChevronRight } from 'lucide-react'
import { openExternal } from '@/lib/openExternal'
import { useSettingsStore, AI_ASSISTANT_MODELS, RegenerateMode, PerformanceMode, BlacklistEntry, PauseEntry } from '@/store/settings'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { getKeyStats } from '@/lib/workflow/keyManager'

type Props = {
  open: boolean
  onClose: () => void
}

// 辅助函数：遮盖 Key 中间部分
const maskKey = (key: string) => {
  if (!key || key.length < 8) return key
  return `${key.slice(0, 4)}...${key.slice(-4)}`
}

// 辅助函数：格式化时间戳
const formatTimestamp = (ts: number) => {
  const date = new Date(ts)
  return date.toLocaleString('zh-CN', { 
    month: 'short', 
    day: 'numeric', 
    hour: '2-digit', 
    minute: '2-digit' 
  })
}

// 辅助函数：计算剩余时间
const formatRemainingTime = (expireAt: number) => {
  const remaining = expireAt - Date.now()
  if (remaining <= 0) return '已过期'
  const minutes = Math.ceil(remaining / 60000)
  if (minutes < 60) return `${minutes} 分钟`
  const hours = Math.floor(minutes / 60)
  return `${hours} 小时 ${minutes % 60} 分钟`
}

export default function SettingsDialog({ open, onClose }: Props) {
  const apiKey = useSettingsStore((s) => s.apiKey)
  const setApiKey = useSettingsStore((s) => s.setApiKey)
  const clearApiKey = useSettingsStore((s) => s.clearApiKey)
  const aiAssistantModel = useSettingsStore((s) => s.aiAssistantModel)
  const setAiAssistantModel = useSettingsStore((s) => s.setAiAssistantModel)
  const regenerateMode = useSettingsStore((s) => s.regenerateMode)
  const setRegenerateMode = useSettingsStore((s) => s.setRegenerateMode)
  const performanceMode = useSettingsStore((s) => s.performanceMode)
  const setPerformanceMode = useSettingsStore((s) => s.setPerformanceMode)
  
  // 多 Key 管理
  const apiKeys = useSettingsStore((s) => s.apiKeys)
  const addApiKey = useSettingsStore((s) => s.addApiKey)
  const removeApiKey = useSettingsStore((s) => s.removeApiKey)
  const blacklist = useSettingsStore((s) => s.blacklist)
  const clearBlacklist = useSettingsStore((s) => s.clearBlacklist)
  const removeFromBlacklist = useSettingsStore((s) => s.removeFromBlacklist)
  const pauseList = useSettingsStore((s) => s.pauseList)
  const clearPauseList = useSettingsStore((s) => s.clearPauseList)
  const removeFromPauseList = useSettingsStore((s) => s.removeFromPauseList)
  const circuitBreaker = useSettingsStore((s) => s.circuitBreaker)
  const resetCircuitBreaker = useSettingsStore((s) => s.resetCircuitBreaker)

  const [draft, setDraft] = useState(apiKey)
  const [draftAiModel, setDraftAiModel] = useState(aiAssistantModel)
  const [draftRegenMode, setDraftRegenMode] = useState<RegenerateMode>(regenerateMode)
  const [draftPerfMode, setDraftPerfMode] = useState<PerformanceMode>(performanceMode)
  
  // Key 管理 UI 状态
  const [newKeyDraft, setNewKeyDraft] = useState('')
  const [keyManagerExpanded, setKeyManagerExpanded] = useState(false)
  const [keyStats, setKeyStats] = useState({ total: 0, available: 0, blacklisted: 0, paused: 0, circuitOpen: false })

  // 同步外部状态变化
  useEffect(() => {
    setDraft(apiKey)
    setDraftAiModel(aiAssistantModel)
    setDraftRegenMode(regenerateMode)
    setDraftPerfMode(performanceMode)
  }, [apiKey, aiAssistantModel, regenerateMode, performanceMode])
  
  // 更新 Key 统计
  useEffect(() => {
    if (open) {
      setKeyStats(getKeyStats())
    }
  }, [open, apiKeys, blacklist, pauseList, circuitBreaker])
  
  // 添加新 Key
  const handleAddKey = () => {
    if (newKeyDraft.trim()) {
      addApiKey(newKeyDraft.trim())
      setNewKeyDraft('')
    }
  }

  if (!open) return null

  const handleSave = () => {
    setApiKey(draft)
    setAiAssistantModel(draftAiModel)
    setRegenerateMode(draftRegenMode)
    setPerformanceMode(draftPerfMode)
    onClose()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-lg rounded-xl border border-[var(--border-color)] bg-[var(--bg-secondary)] shadow-xl max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between border-b border-[var(--border-color)] px-5 py-4">
          <div className="font-semibold text-[var(--text-primary)]">设置</div>
          <Button variant="ghost" size="sm" onClick={onClose}>
            关闭
          </Button>
        </div>

        <div className="space-y-6 px-5 py-4">
          {/* API Key 设置 */}
          <div className="space-y-2">
            <div className="flex items-center gap-2 text-sm font-medium text-[var(--text-primary)]">
              <KeyRound className="h-4 w-4" />
              主 API Key
            </div>
            <Input
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder="请输入 API Key"
              type="password"
              autoComplete="off"
            />
            <div className="flex justify-end">
              <button
                className="inline-flex items-center gap-1 text-xs text-[var(--accent-color)] hover:underline"
                onClick={() => openExternal('https://nexusapi.cn/')}
              >
                获取 API Key
                <ExternalLink className="h-3.5 w-3.5 opacity-70" />
              </button>
            </div>
          </div>
          
          {/* Key 池管理（可折叠） */}
          <div className="space-y-2 rounded-lg border border-[var(--border-color)] bg-[var(--bg-tertiary)]">
            <button
              onClick={() => setKeyManagerExpanded(!keyManagerExpanded)}
              className="flex w-full items-center justify-between px-3 py-2 text-sm font-medium text-[var(--text-primary)] hover:bg-[var(--bg-primary)]/50"
            >
              <div className="flex items-center gap-2">
                {keyManagerExpanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                <span>多 Key 轮换管理</span>
                <span className="rounded bg-[var(--accent-color)]/20 px-1.5 py-0.5 text-xs text-[var(--accent-color)]">
                  {keyStats.available}/{keyStats.total} 可用
                </span>
              </div>
              {circuitBreaker.isOpen && (
                <span className="rounded bg-red-500/20 px-1.5 py-0.5 text-xs text-red-500">
                  熔断中
                </span>
              )}
            </button>
            
            {keyManagerExpanded && (
              <div className="space-y-3 px-3 pb-3">
                {/* 状态概览 */}
                <div className="flex flex-wrap gap-2 text-xs">
                  <span className="rounded bg-green-500/20 px-2 py-1 text-green-600 dark:text-green-400">
                    可用: {keyStats.available}
                  </span>
                  <span className="rounded bg-red-500/20 px-2 py-1 text-red-600 dark:text-red-400">
                    黑名单: {keyStats.blacklisted}
                  </span>
                  <span className="rounded bg-yellow-500/20 px-2 py-1 text-yellow-600 dark:text-yellow-400">
                    暂停: {keyStats.paused}
                  </span>
                </div>
                
                {/* 添加新 Key */}
                <div className="flex gap-2">
                  <Input
                    value={newKeyDraft}
                    onChange={(e) => setNewKeyDraft(e.target.value)}
                    placeholder="添加备用 Key"
                    type="password"
                    autoComplete="off"
                    className="flex-1 text-xs"
                    onKeyDown={(e) => e.key === 'Enter' && handleAddKey()}
                  />
                  <Button size="sm" onClick={handleAddKey} disabled={!newKeyDraft.trim()}>
                    <Plus className="h-3.5 w-3.5" />
                  </Button>
                </div>
                
                {/* Key 列表 */}
                {apiKeys.length > 0 && (
                  <div className="space-y-1">
                    <div className="text-xs font-medium text-[var(--text-secondary)]">备用 Key 池</div>
                    <div className="max-h-24 space-y-1 overflow-y-auto">
                      {apiKeys.map((k, i) => (
                        <div key={i} className="flex items-center justify-between rounded bg-[var(--bg-primary)] px-2 py-1 text-xs">
                          <span className="font-mono text-[var(--text-secondary)]">{maskKey(k)}</span>
                          <button
                            onClick={() => removeApiKey(k)}
                            className="text-red-500 hover:text-red-600"
                          >
                            <Trash2 className="h-3 w-3" />
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
                
                {/* 黑名单 */}
                {blacklist.length > 0 && (
                  <div className="space-y-1">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-1 text-xs font-medium text-red-500">
                        <Ban className="h-3 w-3" />
                        黑名单 (永久)
                      </div>
                      <button
                        onClick={clearBlacklist}
                        className="text-xs text-[var(--text-tertiary)] hover:text-red-500"
                      >
                        清空
                      </button>
                    </div>
                    <div className="max-h-20 space-y-1 overflow-y-auto">
                      {blacklist.map((entry: BlacklistEntry, i: number) => (
                        <div key={i} className="flex items-center justify-between rounded bg-red-500/10 px-2 py-1 text-xs">
                          <div>
                            <span className="font-mono text-red-500">{maskKey(entry.key)}</span>
                            <span className="ml-2 text-[var(--text-tertiary)]">{entry.reason}</span>
                          </div>
                          <button
                            onClick={() => removeFromBlacklist(entry.key)}
                            className="text-[var(--text-tertiary)] hover:text-[var(--text-primary)]"
                          >
                            恢复
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
                
                {/* 暂停列表 */}
                {pauseList.length > 0 && (
                  <div className="space-y-1">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-1 text-xs font-medium text-yellow-500">
                        <Clock className="h-3 w-3" />
                        暂停列表 (临时)
                      </div>
                      <button
                        onClick={clearPauseList}
                        className="text-xs text-[var(--text-tertiary)] hover:text-yellow-500"
                      >
                        清空
                      </button>
                    </div>
                    <div className="max-h-20 space-y-1 overflow-y-auto">
                      {pauseList.map((entry: PauseEntry, i: number) => (
                        <div key={i} className="flex items-center justify-between rounded bg-yellow-500/10 px-2 py-1 text-xs">
                          <div>
                            <span className="font-mono text-yellow-600 dark:text-yellow-400">{maskKey(entry.key)}</span>
                            <span className="ml-2 text-[var(--text-tertiary)]">
                              {entry.reason} · 剩余 {formatRemainingTime(entry.expireAt)}
                            </span>
                          </div>
                          <button
                            onClick={() => removeFromPauseList(entry.key)}
                            className="text-[var(--text-tertiary)] hover:text-[var(--text-primary)]"
                          >
                            恢复
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
                
                {/* 熔断器控制 */}
                {circuitBreaker.isOpen && (
                  <div className="flex items-center justify-between rounded bg-red-500/10 px-2 py-2">
                    <div className="flex items-center gap-2 text-xs text-red-500">
                      <Zap className="h-4 w-4" />
                      <span>熔断器已触发 - 短时间内多个 Key 失败</span>
                    </div>
                    <Button size="sm" variant="secondary" onClick={resetCircuitBreaker}>
                      重置
                    </Button>
                  </div>
                )}
                
                <div className="text-xs text-[var(--text-tertiary)]">
                  黑名单 = 积分耗尽/认证失败（永久标记）；暂停 = 临时错误（60分钟后自动恢复）；熔断 = 短时大量错误保护
                </div>
              </div>
            )}
          </div>

          {/* AI 助手模型 */}
          <div className="space-y-2">
            <div className="flex items-center gap-2 text-sm font-medium text-[var(--text-primary)]">
              <Bot className="h-4 w-4" />
              AI 助手模型
            </div>
            <select
              value={draftAiModel}
              onChange={(e) => setDraftAiModel(e.target.value)}
              className="w-full rounded-md border border-[var(--border-color)] bg-[var(--bg-primary)] px-3 py-2 text-sm text-[var(--text-primary)] focus:border-[var(--accent-color)] focus:outline-none"
            >
              {AI_ASSISTANT_MODELS.map((m) => (
                <option key={m.key} value={m.key}>
                  {m.label}
                </option>
              ))}
            </select>
            <div className="text-xs text-[var(--text-tertiary)]">
              用于 AI 润色、对话等文本处理功能
            </div>
          </div>

          {/* 重新生成模式 */}
          <div className="space-y-2">
            <div className="flex items-center gap-2 text-sm font-medium text-[var(--text-primary)]">
              <RefreshCw className="h-4 w-4" />
              重新生成模式
            </div>
            <div className="flex gap-2">
              <button
                onClick={() => setDraftRegenMode('create')}
                className={`flex-1 rounded-md border px-3 py-2 text-sm transition-colors ${
                  draftRegenMode === 'create'
                    ? 'border-[var(--accent-color)] bg-[var(--accent-color)]/10 text-[var(--accent-color)]'
                    : 'border-[var(--border-color)] bg-[var(--bg-primary)] text-[var(--text-secondary)] hover:border-[var(--accent-color)]/50'
                }`}
              >
                新建节点
              </button>
              <button
                onClick={() => setDraftRegenMode('replace')}
                className={`flex-1 rounded-md border px-3 py-2 text-sm transition-colors ${
                  draftRegenMode === 'replace'
                    ? 'border-[var(--accent-color)] bg-[var(--accent-color)]/10 text-[var(--accent-color)]'
                    : 'border-[var(--border-color)] bg-[var(--bg-primary)] text-[var(--text-secondary)] hover:border-[var(--accent-color)]/50'
                }`}
              >
                替换原节点
              </button>
            </div>
            <div className="text-xs text-[var(--text-tertiary)]">
              {draftRegenMode === 'create' 
                ? '重新生成时创建新节点，原内容保留' 
                : '重新生成时替换原节点内容，原内容保存到历史记录'}
            </div>
          </div>

          {/* 生成加速模式（速度/稳定性） */}
          <div className="space-y-2">
            <div className="flex items-center gap-2 text-sm font-medium text-[var(--text-primary)]">
              <Zap className="h-4 w-4" />
              生成加速模式
            </div>
            <div className="flex gap-2">
              <button
                onClick={() => setDraftPerfMode('off')}
                className={`flex-1 rounded-md border px-3 py-2 text-sm transition-colors ${
                  draftPerfMode === 'off'
                    ? 'border-[var(--accent-color)] bg-[var(--accent-color)]/10 text-[var(--accent-color)]'
                    : 'border-[var(--border-color)] bg-[var(--bg-primary)] text-[var(--text-secondary)] hover:border-[var(--accent-color)]/50'
                }`}
              >
                稳定
              </button>
              <button
                onClick={() => setDraftPerfMode('normal')}
                className={`flex-1 rounded-md border px-3 py-2 text-sm transition-colors ${
                  draftPerfMode === 'normal'
                    ? 'border-[var(--accent-color)] bg-[var(--accent-color)]/10 text-[var(--accent-color)]'
                    : 'border-[var(--border-color)] bg-[var(--bg-primary)] text-[var(--text-secondary)] hover:border-[var(--accent-color)]/50'
                }`}
              >
                平衡
              </button>
              <button
                onClick={() => setDraftPerfMode('ultra')}
                className={`flex-1 rounded-md border px-3 py-2 text-sm transition-colors ${
                  draftPerfMode === 'ultra'
                    ? 'border-[var(--accent-color)] bg-[var(--accent-color)]/10 text-[var(--accent-color)]'
                    : 'border-[var(--border-color)] bg-[var(--bg-primary)] text-[var(--text-secondary)] hover:border-[var(--accent-color)]/50'
                }`}
              >
                极速
              </button>
            </div>
            <div className="text-xs text-[var(--text-tertiary)]">
              {draftPerfMode === 'ultra'
                ? '更快出图/出视频：优先直链回写，缓存/落库后台进行；并发更高（可能更容易触发上游限流）'
                : draftPerfMode === 'normal'
                  ? '默认推荐：速度与稳定性平衡'
                  : '更稳：并发更低，适合网络不稳定/上游易过载时使用'}
            </div>
          </div>

          {/* 提示信息 */}
          <div className="rounded-lg bg-[var(--bg-tertiary)] p-3 text-sm text-[var(--text-secondary)]">
            未配置 API Key 将无法使用 AI 相关能力。
            <button
              className="ml-2 inline-flex items-center gap-1 text-[var(--accent-color)] hover:underline"
              onClick={() => openExternal('https://nexusapi.cn/pricing')}
            >
              查看模型价格
              <ExternalLink className="h-3.5 w-3.5 opacity-70" />
            </button>
          </div>
        </div>

        <div className="flex items-center justify-between border-t border-[var(--border-color)] px-5 py-4">
          <Button variant="secondary" onClick={() => clearApiKey()}>
            清除 API Key
          </Button>
          <div className="flex gap-2">
            <Button variant="ghost" onClick={onClose}>
              取消
            </Button>
            <Button onClick={handleSave}>
              保存
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}
