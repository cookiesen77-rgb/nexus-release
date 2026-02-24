import React, { useMemo, useState } from 'react'
import { cn } from '@/lib/utils'
import { X, Check } from 'lucide-react'
import { Button } from '@/components/ui/button'
import type { ShortDramaDraftV2 } from '@/lib/shortDrama/types'

interface Props {
  open: boolean
  onClose: () => void
  draft: ShortDramaDraftV2
  episodeId: string
  activatedCharacterIds: string[]
  activatedSceneIds: string[]
  activatedAssetIds: string[]
  newCharacterIds: string[]
  newSceneIds: string[]
  newAssetIds: string[]
  onConfirm: (selections: {
    activeCharacterIds: string[]
    activeSceneIds: string[]
    activeAssetIds: string[]
  }) => void
}

export default function EpisodeAssetActivationModal({
  open,
  onClose,
  draft,
  episodeId,
  activatedCharacterIds,
  activatedSceneIds,
  activatedAssetIds,
  newCharacterIds,
  newSceneIds,
  newAssetIds,
  onConfirm,
}: Props) {
  const [selectedCharIds, setSelectedCharIds] = useState<Set<string>>(() => new Set(activatedCharacterIds))
  const [selectedSceneIds, setSelectedSceneIds] = useState<Set<string>>(() => new Set(activatedSceneIds))
  const [selectedAssetIds, setSelectedAssetIds] = useState<Set<string>>(() => new Set(activatedAssetIds))

  const newCharSet = useMemo(() => new Set(newCharacterIds), [newCharacterIds])
  const newSceneSet = useMemo(() => new Set(newSceneIds), [newSceneIds])
  const newAssetSet = useMemo(() => new Set(newAssetIds), [newAssetIds])

  const toggleChar = (id: string) => setSelectedCharIds(prev => {
    const next = new Set(prev)
    next.has(id) ? next.delete(id) : next.add(id)
    return next
  })
  const toggleScene = (id: string) => setSelectedSceneIds(prev => {
    const next = new Set(prev)
    next.has(id) ? next.delete(id) : next.add(id)
    return next
  })
  const toggleAsset = (id: string) => setSelectedAssetIds(prev => {
    const next = new Set(prev)
    next.has(id) ? next.delete(id) : next.add(id)
    return next
  })

  const handleConfirm = () => {
    onConfirm({
      activeCharacterIds: Array.from(selectedCharIds),
      activeSceneIds: Array.from(selectedSceneIds),
      activeAssetIds: Array.from(selectedAssetIds),
    })
    onClose()
  }

  if (!open) return null

  const renderSection = (
    label: string,
    items: { id: string; name: string }[],
    newSet: Set<string>,
    selected: Set<string>,
    toggle: (id: string) => void,
  ) => {
    if (items.length === 0) return null
    return (
      <div className="mb-4">
        <h4 className="mb-2 text-xs font-medium text-[var(--text-secondary)]">{label}（{items.length}）</h4>
        <div className="flex flex-col gap-1">
          {items.map(item => (
            <label key={item.id} className="flex items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-[var(--bg-secondary)] cursor-pointer">
              <input
                type="checkbox"
                checked={selected.has(item.id)}
                onChange={() => toggle(item.id)}
                className="accent-[var(--accent-color)]"
              />
              <span className="flex-1 truncate text-[var(--text-primary)]">{item.name || '未命名'}</span>
              {newSet.has(item.id) && (
                <span className="shrink-0 rounded-full bg-green-500/10 px-1.5 py-0.5 text-[10px] text-green-600">新增</span>
              )}
            </label>
          ))}
        </div>
      </div>
    )
  }

  const chars = draft.characters.filter(c => activatedCharacterIds.includes(c.id))
  const scenes = draft.scenes.filter(s => activatedSceneIds.includes(s.id))
  const assets = (draft.assets || []).filter(a => activatedAssetIds.includes(a.id))

  return (
    <>
      <div className="fixed inset-0 z-50 bg-black/50" onClick={onClose} />
      <div className="fixed left-1/2 top-1/2 z-50 w-[480px] max-h-[80vh] -translate-x-1/2 -translate-y-1/2 overflow-hidden rounded-xl border border-[var(--border-color)] bg-[var(--bg-primary)] shadow-xl flex flex-col">
        <div className="flex items-center justify-between border-b border-[var(--border-color)] px-5 py-3">
          <h3 className="text-sm font-semibold text-[var(--text-primary)]">本集素材激活确认</h3>
          <button type="button" onClick={onClose} className="p-1 text-[var(--text-secondary)] hover:text-[var(--text-primary)]">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4">
          <p className="mb-4 text-xs text-[var(--text-secondary)]">
            AI 已分析剧本并匹配/创建了以下素材。请确认要在本集中激活哪些素材：
          </p>
          {renderSection('角色', chars, newCharSet, selectedCharIds, toggleChar)}
          {renderSection('场景', scenes, newSceneSet, selectedSceneIds, toggleScene)}
          {renderSection('资产', assets, newAssetSet, selectedAssetIds, toggleAsset)}
          {chars.length === 0 && scenes.length === 0 && assets.length === 0 && (
            <div className="py-8 text-center text-sm text-[var(--text-secondary)]">未检测到素材</div>
          )}
        </div>

        <div className="flex justify-end gap-2 border-t border-[var(--border-color)] px-5 py-3">
          <Button variant="secondary" size="sm" onClick={onClose}>取消</Button>
          <Button size="sm" onClick={handleConfirm}>
            <Check className="mr-1 h-3.5 w-3.5" />
            确认激活
          </Button>
        </div>
      </div>
    </>
  )
}
