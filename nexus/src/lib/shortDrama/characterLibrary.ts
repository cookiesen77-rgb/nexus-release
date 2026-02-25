import type {
  ShortDramaCharacter,
  ShortDramaCharacterAnchors,
  ShortDramaCostumeVariation,
  ShortDramaDraftV2,
  ShortDramaVoiceConfig,
  ShortDramaMediaSlot,
} from '@/lib/shortDrama/types'

const DB_NAME = 'nexus-character-library'
const DB_VERSION = 1
const STORE_NAME = 'characters'

export interface LibraryCharacter {
  id: string
  name: string
  description: string
  anchors?: ShortDramaCharacterAnchors
  thumbnailDataUrl?: string
  costumes?: ShortDramaCostumeVariation[]
  voice?: ShortDramaVoiceConfig
  tags?: string[]
  createdAt: number
  updatedAt: number
  sourceProjectId?: string
}

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'id' })
      }
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

export async function saveCharacterToLibrary(
  char: ShortDramaCharacter,
  projectId: string
): Promise<string> {
  const db = await openDB()

  const selectedVariant = char.sheet.selectedVariantId
    ? char.sheet.variants.find((v) => v.id === char.sheet.selectedVariantId)
    : char.sheet.variants.find((v) => v.status === 'success')
  const thumbnailDataUrl = selectedVariant?.displayUrl || selectedVariant?.sourceUrl || undefined

  const libChar: LibraryCharacter = {
    id: char.id,
    name: char.name,
    description: char.description,
    anchors: char.anchors,
    thumbnailDataUrl,
    costumes: char.costumes,
    voice: char.voice,
    tags: char.tags,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    sourceProjectId: projectId,
  }

  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite')
    tx.objectStore(STORE_NAME).put(libChar)
    tx.oncomplete = () => resolve(libChar.id)
    tx.onerror = () => reject(tx.error)
  })
}

export async function listLibraryCharacters(): Promise<LibraryCharacter[]> {
  const db = await openDB()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly')
    const req = tx.objectStore(STORE_NAME).getAll()
    req.onsuccess = () => resolve(req.result || [])
    req.onerror = () => reject(req.error)
  })
}

export async function getLibraryCharacter(id: string): Promise<LibraryCharacter | null> {
  const db = await openDB()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly')
    const req = tx.objectStore(STORE_NAME).get(id)
    req.onsuccess = () => resolve(req.result || null)
    req.onerror = () => reject(req.error)
  })
}

export async function removeLibraryCharacter(id: string): Promise<void> {
  const db = await openDB()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite')
    tx.objectStore(STORE_NAME).delete(id)
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
}

const makeId = () => globalThis.crypto?.randomUUID?.() || `lc_${Date.now()}_${Math.random().toString(16).slice(2)}`

function emptySlot(): ShortDramaMediaSlot {
  return { id: makeId(), kind: 'image', variants: [] }
}

export function importCharacterIntoDraft(
  libChar: LibraryCharacter,
  draft: ShortDramaDraftV2
): ShortDramaDraftV2 {
  const exists = draft.characters.some((c) => c.id === libChar.id)
  if (exists) return draft

  const newChar: ShortDramaCharacter = {
    id: makeId(),
    name: libChar.name,
    description: libChar.description,
    sheet: emptySlot(),
    refs: [],
    anchors: libChar.anchors,
    costumes: libChar.costumes,
    voice: libChar.voice,
    tags: libChar.tags,
  }

  return {
    ...draft,
    characters: [...draft.characters, newChar],
    updatedAt: Date.now(),
  }
}

export function exportCharacterAsJSON(char: LibraryCharacter): string {
  return JSON.stringify(char, null, 2)
}

export function parseCharacterFromJSON(json: string): LibraryCharacter | null {
  try {
    const parsed = JSON.parse(json)
    if (!parsed.name || !parsed.description) return null
    return {
      id: parsed.id || makeId(),
      name: parsed.name,
      description: parsed.description,
      anchors: parsed.anchors,
      thumbnailDataUrl: parsed.thumbnailDataUrl,
      costumes: parsed.costumes,
      voice: parsed.voice,
      tags: parsed.tags,
      createdAt: parsed.createdAt || Date.now(),
      updatedAt: Date.now(),
      sourceProjectId: parsed.sourceProjectId,
    }
  } catch {
    return null
  }
}
