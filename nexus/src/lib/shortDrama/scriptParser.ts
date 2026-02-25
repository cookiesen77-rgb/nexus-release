export interface ParsedEpisodeChunk {
  index: number
  title: string
  rawContent: string
  scenes: ParsedSceneChunk[]
}

export interface ParsedSceneChunk {
  header: string
  characters: string[]
  dialogues: { character: string; line: string }[]
  actions: string[]
}

const EPISODE_PATTERNS = [
  /^[【\[（(]?\s*第\s*(\d+)\s*集[】\]）)]?\s*(.*)/,
  /^Episode\s+(\d+)\s*[:\-]?\s*(.*)/i,
  /^EP\.?\s*(\d+)\s*[:\-]?\s*(.*)/i,
]

const SCENE_HEADER_PATTERN = /^(\d+)-(\d+)\s*(日|夜|晨|暮|傍晚|黄昏|凌晨)\s*(内|外|内外)\s+(.+)/
const DIALOGUE_PATTERN = /^([^\s:：△【\d][^\s:：]{0,8})[：:]\s*(.+)/
const ACTION_PATTERN = /^△\s*(.+)/
const SUBTITLE_PATTERN = /^【(.+?)】/
const PARENTHETICAL_PATTERN = /^([^（(]+)[（(]([^）)]+)[）)]\s*(.*)/

export function detectEpisodeBoundaries(text: string): { index: number; position: number; title: string }[] {
  const lines = text.split('\n')
  const boundaries: { index: number; position: number; title: string }[] = []
  let charPos = 0

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim()
    for (const pattern of EPISODE_PATTERNS) {
      const m = line.match(pattern)
      if (m) {
        boundaries.push({
          index: parseInt(m[1], 10),
          position: charPos,
          title: m[2]?.trim() || `第${m[1]}集`,
        })
        break
      }
    }
    charPos += lines[i].length + 1
  }

  return boundaries
}

export function parseScenes(episodeText: string): ParsedSceneChunk[] {
  const lines = episodeText.split('\n')
  const scenes: ParsedSceneChunk[] = []
  let current: ParsedSceneChunk | null = null

  for (const raw of lines) {
    const line = raw.trim()
    if (!line) continue

    const sceneMatch = line.match(SCENE_HEADER_PATTERN)
    if (sceneMatch) {
      if (current) scenes.push(current)
      current = {
        header: line,
        characters: [],
        dialogues: [],
        actions: [],
      }
      continue
    }

    if (!current) {
      current = { header: '(无场景头)', characters: [], dialogues: [], actions: [] }
    }

    const actionMatch = line.match(ACTION_PATTERN)
    if (actionMatch) {
      current.actions.push(actionMatch[1].trim())
      continue
    }

    if (SUBTITLE_PATTERN.test(line)) continue

    const dialogueMatch = line.match(DIALOGUE_PATTERN)
    if (dialogueMatch) {
      const charRaw = dialogueMatch[1].trim()
      const parentMatch = charRaw.match(PARENTHETICAL_PATTERN)
      const character = parentMatch ? parentMatch[1].trim() : charRaw
      const dialogLine = parentMatch ? `${parentMatch[3] || ''} ${dialogueMatch[2]}`.trim() : dialogueMatch[2].trim()

      current.dialogues.push({ character, line: dialogLine })
      if (!current.characters.includes(character)) {
        current.characters.push(character)
      }
      continue
    }
  }

  if (current) scenes.push(current)
  return scenes
}

export function parseEpisodes(fullText: string): ParsedEpisodeChunk[] {
  const boundaries = detectEpisodeBoundaries(fullText)

  if (boundaries.length === 0) {
    return [{
      index: 1,
      title: '第1集',
      rawContent: fullText,
      scenes: parseScenes(fullText),
    }]
  }

  const episodes: ParsedEpisodeChunk[] = []
  for (let i = 0; i < boundaries.length; i++) {
    const start = boundaries[i].position
    const end = i + 1 < boundaries.length ? boundaries[i + 1].position : fullText.length
    const rawContent = fullText.slice(start, end)

    episodes.push({
      index: boundaries[i].index,
      title: boundaries[i].title,
      rawContent,
      scenes: parseScenes(rawContent),
    })
  }

  return episodes
}

export function getParseStats(episodes: ParsedEpisodeChunk[]) {
  let totalScenes = 0
  let totalDialogues = 0
  const characterSet = new Set<string>()

  for (const ep of episodes) {
    totalScenes += ep.scenes.length
    for (const scene of ep.scenes) {
      totalDialogues += scene.dialogues.length
      for (const c of scene.characters) characterSet.add(c)
    }
  }

  return {
    episodeCount: episodes.length,
    totalScenes,
    totalDialogues,
    uniqueCharacters: characterSet.size,
    characterNames: [...characterSet],
  }
}
