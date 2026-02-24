import React, { useCallback, useMemo, useState } from 'react'
import { cn } from '@/lib/utils'
import { X, Search, Star, Plus, Tag, ChevronDown, ChevronRight } from 'lucide-react'
import { ShortDramaVariantThumb } from '@/components/shortDrama/ShortDramaSlotVersions'
import type { ShortDramaDraftV2, ShortDramaCharacter, ShortDramaScene, ShortDramaAsset, ShortDramaMediaSlot } from '@/lib/shortDrama/types'

interface Props {
  open: boolean
  onClose: () => void
  draft: ShortDramaDraftV2
  setDraft: React.Dispatch<React.SetStateAction<ShortDramaDraftV2>>
  currentEpisodeId?: string | null
}

type FilterTab = 'all' | 'character' | 'scene' | 'asset' | 'favorite'

type AssetItem = {
  type: 'character' | 'scene' | 'asset'
  id: string
  name: string
  description: string
  tags: string[]
  favorite: boolean
  slot: ShortDramaMediaSlot | null
}

const getPreferredVariant = (slot: ShortDramaMediaSlot | null) => {
  if (!slot) return null
  if (slot.selectedVariantId) {
    const v = slot.variants.find(v => v.id === slot.selectedVariantId)
    if (v) return v
  }
  return slot.variants[slot.variants.length - 1] || null
}

export default function ShortDramaAssetSidebar({ open, onClose, draft, setDraft, currentEpisodeId }: Props) {
  const [filterTab, setFilterTab] = useState<FilterTab>('all')
  const [searchQuery, setSearchQuery] = useState('')
  const [activeTag, setActiveTag] = useState<string | null>(null)
  const [collapsedGroups, setCollapsedGroups] = useState<Record<string, boolean>>({})
  const [addingTagId, setAddingTagId] = useState<string | null>(null)
  const [tagInput, setTagInput] = useState('')

  const currentEpisode = useMemo(() =>
    currentEpisodeId ? (draft.episodes || []).find(e => e.id === currentEpisodeId) : undefined,
    [draft.episodes, currentEpisodeId],
  )

  const items = useMemo<AssetItem[]>(() => {
    const result: AssetItem[] = []
    for (const c of draft.characters) {
      result.push({
        type: 'character',
        id: c.id,
        name: c.name,
        description: c.description,
        tags: c.tags || [],
        favorite: !!c.favorite,
        slot: c.refs[0] || c.sheet,
      })
    }
    for (const s of draft.scenes) {
      result.push({
        type: 'scene',
        id: s.id,
        name: s.name,
        description: s.description,
        tags: s.tags || [],
        favorite: !!s.favorite,
        slot: s.ref,
      })
    }
    for (const a of (draft.assets || [])) {
      result.push({
        type: 'asset',
        id: a.id,
        name: a.name,
        description: a.description,
        tags: a.tags || [],
        favorite: !!a.favorite,
        slot: a.ref,
      })
    }
    return result
  }, [draft.characters, draft.scenes, draft.assets])

  const allTags = useMemo(() => {
    const set = new Set<string>()
    for (const item of items) {
      for (const t of item.tags) set.add(t)
    }
    return Array.from(set).sort()
  }, [items])

  const filteredItems = useMemo(() => {
    let result = items
    if (filterTab === 'character') result = result.filter(i => i.type === 'character')
    else if (filterTab === 'scene') result = result.filter(i => i.type === 'scene')
    else if (filterTab === 'asset') result = result.filter(i => i.type === 'asset')
    else if (filterTab === 'favorite') result = result.filter(i => i.favorite)

    if (searchQuery.trim()) {
      const q = searchQuery.trim().toLowerCase()
      result = result.filter(i => i.name.toLowerCase().includes(q) || i.description.toLowerCase().includes(q))
    }

    if (activeTag) {
      result = result.filter(i => i.tags.includes(activeTag))
    }

    return result
  }, [items, filterTab, searchQuery, activeTag])

  const toggleFavorite = useCallback((type: string, id: string) => {
    setDraft(prev => {
      if (type === 'character') return {
        ...prev,
        characters: prev.characters.map(c => c.id === id ? { ...c, favorite: !c.favorite } : c),
        updatedAt: Date.now(),
      }
      if (type === 'scene') return {
        ...prev,
        scenes: prev.scenes.map(s => s.id === id ? { ...s, favorite: !s.favorite } : s),
        updatedAt: Date.now(),
      }
      return {
        ...prev,
        assets: (prev.assets || []).map(a => a.id === id ? { ...a, favorite: !a.favorite } : a),
        updatedAt: Date.now(),
      }
    })
  }, [setDraft])

  const addTag = useCallback((type: string, id: string, tag: string) => {
    const t = tag.trim()
    if (!t) return
    setDraft(prev => {
      const addTo = (tags: string[] | undefined) => [...(tags || []).filter(x => x !== t), t]
      if (type === 'character') return {
        ...prev,
        characters: prev.characters.map(c => c.id === id ? { ...c, tags: addTo(c.tags) } : c),
        updatedAt: Date.now(),
      }
      if (type === 'scene') return {
        ...prev,
        scenes: prev.scenes.map(s => s.id === id ? { ...s, tags: addTo(s.tags) } : s),
        updatedAt: Date.now(),
      }
      return {
        ...prev,
        assets: (prev.assets || []).map(a => a.id === id ? { ...a, tags: addTo(a.tags) } : a),
        updatedAt: Date.now(),
      }
    })
  }, [setDraft])

  const removeTag = useCallback((type: string, id: string, tag: string) => {
    setDraft(prev => {
      const remove = (tags: string[] | undefined) => (tags || []).filter(x => x !== tag)
      if (type === 'character') return {
        ...prev,
        characters: prev.characters.map(c => c.id === id ? { ...c, tags: remove(c.tags) } : c),
        updatedAt: Date.now(),
      }
      if (type === 'scene') return {
        ...prev,
        scenes: prev.scenes.map(s => s.id === id ? { ...s, tags: remove(s.tags) } : s),
        updatedAt: Date.now(),
      }
      return {
        ...prev,
        assets: (prev.assets || []).map(a => a.id === id ? { ...a, tags: remove(a.tags) } : a),
        updatedAt: Date.now(),
      }
    })
  }, [setDraft])

  const toggleEpisodeActive = useCallback((type: string, id: string) => {
    if (!currentEpisodeId) return
    setDraft(prev => ({
      ...prev,
      episodes: (prev.episodes || []).map(ep => {
        if (ep.id !== currentEpisodeId) return ep
        const field = type === 'character' ? 'activeCharacterIds' : type === 'scene' ? 'activeSceneIds' : 'activeAssetIds'
        const arr = ep[field]
        const next = arr.includes(id) ? arr.filter(x => x !== id) : [...arr, id]
        return { ...ep, [field]: next, updatedAt: Date.now() }
      }),
      updatedAt: Date.now(),
    }))
  }, [currentEpisodeId, setDraft])

  const isActiveInEpisode = useCallback((type: string, id: string) => {
    if (!currentEpisode) return true
    if (type === 'character') return currentEpisode.activeCharacterIds.includes(id)
    if (type === 'scene') return currentEpisode.activeSceneIds.includes(id)
    return currentEpisode.activeAssetIds.includes(id)
  }, [currentEpisode])

  const toggleGroup = useCallback((group: string) => {
    setCollapsedGroups(prev => ({ ...prev, [group]: !prev[group] }))
  }, [])

  const typeLabel = (type: string) => type === 'character' ? '角色' : type === 'scene' ? '场景' : '资产'

  const tabs: { key: FilterTab; label: string }[] = [
    { key: 'all', label: '全部' },
    { key: 'character', label: '角色' },
    { key: 'scene', label: '场景' },
    { key: 'asset', label: '资产' },
    { key: 'favorite', label: '收藏' },
  ]

  const grouped = useMemo(() => {
    if (filterTab !== 'all' && filterTab !== 'favorite') return null
    const map: Record<string, AssetItem[]> = {}
    for (const item of filteredItems) {
      const key = item.type
      if (!map[key]) map[key] = []
      map[key].push(item)
    }
    return map
  }, [filteredItems, filterTab])

  if (!open) return null

  const renderCard = (item: AssetItem) => {
    const variant = getPreferredVariant(item.slot)
    const active = isActiveInEpisode(item.type, item.id)
    return (
      <div
        key={`${item.type}-${item.id}`}
        className={cn(
          'group flex gap-3 rounded-lg border border-[var(--border-color)] bg-[var(--bg-primary)] p-2 transition-colors',
          !active && currentEpisodeId && 'opacity-40',
        )}
      >
        <div className="h-12 w-12 shrink-0 rounded-md overflow-hidden bg-black/5">
          {variant ? (
            <ShortDramaVariantThumb variant={variant} className="h-12 w-12" />
          ) : (
            <div className="flex h-full w-full items-center justify-center text-[10px] text-[var(--text-secondary)]">{typeLabel(item.type)}</div>
          )}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1">
            <span className="truncate text-xs font-medium text-[var(--text-primary)]">{item.name || '未命名'}</span>
            <button
              type="button"
              className={cn('ml-auto shrink-0 p-0.5', item.favorite ? 'text-yellow-500' : 'text-[var(--text-secondary)] opacity-0 group-hover:opacity-100')}
              onClick={() => toggleFavorite(item.type, item.id)}
            >
              <Star className="h-3 w-3" fill={item.favorite ? 'currentColor' : 'none'} />
            </button>
          </div>
          <p className="mt-0.5 truncate text-[10px] text-[var(--text-secondary)]">{item.description || '无描述'}</p>
          <div className="mt-1 flex flex-wrap gap-1">
            {item.tags.map(tag => (
              <span
                key={tag}
                className="inline-flex items-center gap-0.5 rounded-full bg-[var(--bg-secondary)] px-1.5 py-0.5 text-[10px] text-[var(--text-secondary)]"
              >
                {tag}
                <button type="button" className="opacity-0 group-hover:opacity-100" onClick={() => removeTag(item.type, item.id, tag)}>
                  <X className="h-2 w-2" />
                </button>
              </span>
            ))}
            {addingTagId === `${item.type}-${item.id}` ? (
              <input
                autoFocus
                className="h-4 w-16 rounded border border-[var(--accent-color)] bg-transparent px-1 text-[10px] outline-none"
                value={tagInput}
                onChange={(e) => setTagInput(e.target.value)}
                onBlur={() => {
                  if (tagInput.trim()) addTag(item.type, item.id, tagInput)
                  setAddingTagId(null)
                  setTagInput('')
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    if (tagInput.trim()) addTag(item.type, item.id, tagInput)
                    setAddingTagId(null)
                    setTagInput('')
                  } else if (e.key === 'Escape') {
                    setAddingTagId(null)
                    setTagInput('')
                  }
                }}
              />
            ) : (
              <button
                type="button"
                className="opacity-0 group-hover:opacity-100 text-[var(--text-secondary)]"
                onClick={() => {
                  setAddingTagId(`${item.type}-${item.id}`)
                  setTagInput('')
                }}
              >
                <Plus className="h-3 w-3" />
              </button>
            )}
          </div>
          {currentEpisodeId && (
            <button
              type="button"
              className={cn(
                'mt-1 rounded px-1.5 py-0.5 text-[10px] transition-colors',
                active
                  ? 'bg-[var(--accent-color)]/10 text-[var(--accent-color)]'
                  : 'bg-[var(--bg-secondary)] text-[var(--text-secondary)]',
              )}
              onClick={() => toggleEpisodeActive(item.type, item.id)}
            >
              {active ? '本集使用' : '未激活'}
            </button>
          )}
        </div>
      </div>
    )
  }

  return (
    <div className="flex h-full w-[360px] shrink-0 flex-col border-l border-[var(--border-color)] bg-[var(--bg-primary)]">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-[var(--border-color)] px-4 py-3">
        <h3 className="text-sm font-semibold text-[var(--text-primary)]">素材库</h3>
        <button type="button" onClick={onClose} className="p-1 text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors">
          <X className="h-4 w-4" />
        </button>
      </div>

      {/* Search */}
      <div className="px-4 py-2">
        <div className="relative">
          <Search className="absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[var(--text-secondary)]" />
          <input
            type="text"
            placeholder="搜索名称或描述..."
            className="w-full rounded-md border border-[var(--border-color)] bg-[var(--bg-secondary)] py-1.5 pl-7 pr-2 text-xs text-[var(--text-primary)] placeholder:text-[var(--text-secondary)] outline-none focus:border-[var(--accent-color)]"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        </div>
      </div>

      {/* Filter tabs */}
      <div className="flex gap-1 px-4 pb-2">
        {tabs.map(tab => (
          <button
            key={tab.key}
            type="button"
            className={cn(
              'rounded-md px-2 py-1 text-[10px] transition-colors',
              filterTab === tab.key
                ? 'bg-[var(--accent-color)]/10 text-[var(--accent-color)] font-medium'
                : 'text-[var(--text-secondary)] hover:bg-[var(--bg-secondary)]',
            )}
            onClick={() => { setFilterTab(tab.key); setActiveTag(null) }}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Tag chips */}
      {allTags.length > 0 && (
        <div className="flex flex-wrap gap-1 px-4 pb-2">
          {allTags.map(tag => (
            <button
              key={tag}
              type="button"
              className={cn(
                'rounded-full px-2 py-0.5 text-[10px] transition-colors',
                activeTag === tag
                  ? 'bg-[var(--accent-color)] text-white'
                  : 'bg-[var(--bg-secondary)] text-[var(--text-secondary)] hover:bg-[var(--accent-color)]/10',
              )}
              onClick={() => setActiveTag(activeTag === tag ? null : tag)}
            >
              <Tag className="mr-0.5 inline h-2.5 w-2.5" />{tag}
            </button>
          ))}
        </div>
      )}

      {/* List */}
      <div className="flex-1 overflow-y-auto px-4 pb-4">
        {filteredItems.length === 0 ? (
          <div className="flex h-32 items-center justify-center text-xs text-[var(--text-secondary)]">暂无素材</div>
        ) : grouped ? (
          Object.entries(grouped).map(([type, groupItems]) => (
            <div key={type} className="mb-3">
              <button
                type="button"
                className="mb-1.5 flex w-full items-center gap-1 text-[10px] font-medium uppercase text-[var(--text-secondary)]"
                onClick={() => toggleGroup(type)}
              >
                {collapsedGroups[type] ? <ChevronRight className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
                {typeLabel(type)}（{groupItems.length}）
              </button>
              {!collapsedGroups[type] && (
                <div className="flex flex-col gap-2">
                  {groupItems.map(renderCard)}
                </div>
              )}
            </div>
          ))
        ) : (
          <div className="flex flex-col gap-2">
            {filteredItems.map(renderCard)}
          </div>
        )}
      </div>
    </div>
  )
}
