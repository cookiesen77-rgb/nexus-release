import type {
  ShortDramaDraftV2,
  ShortDramaCinematography,
  ShortDramaTimeline,
  ShortDramaTimelineSegment,
} from '@/lib/shortDrama/types'
import { buildTimeline, downloadAsFile } from '@/lib/shortDrama/videoCompose'

// ── Manifest JSON ──

export interface ExportManifest {
  version: string
  projectName: string
  exportedAt: string
  episodes: { id: string; title: string; shotCount: number }[]
  shots: {
    index: number
    title: string
    episodeId?: string
    sceneId?: string
    imagePrompt: string
    videoPrompt: string
    dialogue?: string
    narration?: string
    cinematography?: ShortDramaCinematography
  }[]
  characters: { name: string; description: string }[]
  scenes: { name: string; description: string }[]
}

export function exportManifestJSON(draft: ShortDramaDraftV2): string {
  const episodeShotCounts = new Map<string, number>()
  for (const shot of draft.shots) {
    if (shot.episodeId) episodeShotCounts.set(shot.episodeId, (episodeShotCounts.get(shot.episodeId) || 0) + 1)
  }

  const manifest: ExportManifest = {
    version: '1.0',
    projectName: draft.title || '未命名项目',
    exportedAt: new Date().toISOString(),
    episodes: (draft.episodes || []).map((ep) => ({
      id: ep.id,
      title: ep.title,
      shotCount: episodeShotCounts.get(ep.id) || 0,
    })),
    shots: draft.shots.map((shot, i) => ({
      index: i + 1,
      title: shot.title,
      episodeId: shot.episodeId,
      sceneId: shot.sceneId,
      imagePrompt: shot.frames.start.prompt,
      videoPrompt: shot.videoPrompt,
      dialogue: shot.audio?.dialogue,
      narration: shot.audio?.narration,
      cinematography: shot.cinematography,
    })),
    characters: draft.characters.map((c) => ({ name: c.name, description: c.description })),
    scenes: draft.scenes.map((s) => ({ name: s.name, description: s.description })),
  }

  return JSON.stringify(manifest, null, 2)
}

// ── FCP XML 1.0 ──

function escapeXml(str: string): string {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

export function exportFCPXML(timeline: ShortDramaTimeline, draft: ShortDramaDraftV2): string {
  const fps = 30
  const title = escapeXml(draft.title || '未命名')

  const videoClips = timeline.segments.map((seg, i) => {
    const shot = draft.shots.find((s) => s.id === seg.shotId)
    const name = escapeXml(shot?.title || `Shot ${i + 1}`)
    const startFrame = Math.round((seg.startMs / 1000) * fps)
    const durationFrame = Math.round((seg.durationMs / 1000) * fps)
    const endFrame = startFrame + durationFrame
    return `        <clipitem id="clip-${i + 1}">
          <name>${name}</name>
          <duration>${durationFrame}</duration>
          <start>${startFrame}</start>
          <end>${endFrame}</end>
          <in>0</in>
          <out>${durationFrame}</out>
          ${seg.videoUrl ? `<file id="file-v-${i + 1}"><pathurl>${escapeXml(seg.videoUrl)}</pathurl></file>` : ''}
        </clipitem>`
  })

  const audioClips = timeline.segments
    .map((seg, i) => {
      const url = seg.dialogueUrl || seg.narrationUrl
      if (!url) return ''
      const startFrame = Math.round((seg.startMs / 1000) * fps)
      const durationFrame = Math.round((seg.durationMs / 1000) * fps)
      return `        <clipitem id="clip-a-${i + 1}">
          <name>Audio ${i + 1}</name>
          <duration>${durationFrame}</duration>
          <start>${startFrame}</start>
          <end>${startFrame + durationFrame}</end>
          <in>0</in>
          <out>${durationFrame}</out>
          <file id="file-a-${i + 1}"><pathurl>${escapeXml(url)}</pathurl></file>
        </clipitem>`
    })
    .filter(Boolean)

  const totalFrames = Math.round((timeline.totalDurationMs / 1000) * fps)

  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE xmeml>
<xmeml version="5">
  <sequence>
    <name>${title}</name>
    <duration>${totalFrames}</duration>
    <rate><timebase>${fps}</timebase><ntsc>FALSE</ntsc></rate>
    <media>
      <video>
        <track>
${videoClips.join('\n')}
        </track>
      </video>
      <audio>
        <track>
${audioClips.join('\n')}
        </track>
      </audio>
    </media>
  </sequence>
</xmeml>`
}

// ── OTIO (OpenTimelineIO JSON) ──

export function exportOTIO(timeline: ShortDramaTimeline, draft: ShortDramaDraftV2): string {
  const videoClips = timeline.segments.map((seg, i) => {
    const shot = draft.shots.find((s) => s.id === seg.shotId)
    return {
      OTIO_SCHEMA: 'Clip.2',
      name: shot?.title || `Shot ${i + 1}`,
      source_range: {
        OTIO_SCHEMA: 'TimeRange.1',
        start_time: { OTIO_SCHEMA: 'RationalTime.1', value: seg.startMs, rate: 1000 },
        duration: { OTIO_SCHEMA: 'RationalTime.1', value: seg.durationMs, rate: 1000 },
      },
      media_references: seg.videoUrl
        ? {
            DEFAULT_MEDIA: {
              OTIO_SCHEMA: 'ExternalReference.1',
              target_url: seg.videoUrl,
            },
          }
        : {},
    }
  })

  const audioClips = timeline.segments
    .filter((seg) => seg.dialogueUrl || seg.narrationUrl)
    .map((seg, i) => {
      const shot = draft.shots.find((s) => s.id === seg.shotId)
      return {
        OTIO_SCHEMA: 'Clip.2',
        name: `${shot?.title || `Shot ${i + 1}`} (audio)`,
        source_range: {
          OTIO_SCHEMA: 'TimeRange.1',
          start_time: { OTIO_SCHEMA: 'RationalTime.1', value: seg.startMs, rate: 1000 },
          duration: { OTIO_SCHEMA: 'RationalTime.1', value: seg.durationMs, rate: 1000 },
        },
        media_references: {
          DEFAULT_MEDIA: {
            OTIO_SCHEMA: 'ExternalReference.1',
            target_url: seg.dialogueUrl || seg.narrationUrl || '',
          },
        },
      }
    })

  const otio = {
    OTIO_SCHEMA: 'Timeline.1',
    name: draft.title || '未命名',
    tracks: {
      OTIO_SCHEMA: 'Stack.1',
      children: [
        {
          OTIO_SCHEMA: 'Track.1',
          name: 'Video',
          kind: 'Video',
          children: videoClips,
        },
        ...(audioClips.length > 0
          ? [{
              OTIO_SCHEMA: 'Track.1',
              name: 'Audio',
              kind: 'Audio',
              children: audioClips,
            }]
          : []),
      ],
    },
  }

  return JSON.stringify(otio, null, 2)
}

// ── PDF Storyboard ──

export async function exportStoryboardPDF(
  draft: ShortDramaDraftV2,
  options?: { shotsPerPage?: 4 | 6 | 9; includeDialogue?: boolean }
): Promise<Blob> {
  // jspdf is an optional dependency — dynamic import with fallback
  let jsPDFCtor: any
  try {
    const mod = await import('jspdf' as any)
    jsPDFCtor = mod.jsPDF || mod.default?.jsPDF || mod.default
  } catch {
    throw new Error('需要安装 jspdf 依赖：npm install jspdf')
  }
  const shotsPerPage = options?.shotsPerPage || 6
  const includeDialogue = options?.includeDialogue !== false

  const doc = new jsPDFCtor({ orientation: 'landscape', unit: 'mm', format: 'a4' })
  const pageW = doc.internal.pageSize.getWidth()
  const pageH = doc.internal.pageSize.getHeight()
  const margin = 10
  const usableW = pageW - margin * 2
  const usableH = pageH - margin * 2 - 10

  const gridConfigs: Record<number, { cols: number; rows: number }> = {
    4: { cols: 2, rows: 2 },
    6: { cols: 3, rows: 2 },
    9: { cols: 3, rows: 3 },
  }

  const { cols, rows } = gridConfigs[shotsPerPage] || gridConfigs[6]
  const cellW = usableW / cols
  const cellH = usableH / rows

  doc.setFontSize(14)
  doc.text(draft.title || '分镜板', pageW / 2, margin, { align: 'center' })

  for (let i = 0; i < draft.shots.length; i++) {
    const pageIdx = Math.floor(i / shotsPerPage)
    const cellIdx = i % shotsPerPage
    if (cellIdx === 0 && pageIdx > 0) {
      doc.addPage()
      doc.setFontSize(14)
      doc.text(draft.title || '分镜板', pageW / 2, margin, { align: 'center' })
    }

    const col = cellIdx % cols
    const row = Math.floor(cellIdx / cols)
    const x = margin + col * cellW
    const y = margin + 10 + row * cellH

    const shot = draft.shots[i]

    doc.setDrawColor(200)
    doc.rect(x + 1, y + 1, cellW - 2, cellH - 2)

    const thumbH = cellH * 0.55
    const variant = shot.frames.start.slot.selectedVariantId
      ? shot.frames.start.slot.variants.find((v) => v.id === shot.frames.start.slot.selectedVariantId)
      : shot.frames.start.slot.variants.find((v) => v.status === 'success')

    const imgUrl = variant?.displayUrl || variant?.sourceUrl
    if (imgUrl && imgUrl.startsWith('data:image')) {
      try {
        doc.addImage(imgUrl, 'JPEG', x + 2, y + 2, cellW - 4, thumbH - 2)
      } catch {
        doc.setFontSize(8)
        doc.text('[图片]', x + cellW / 2, y + thumbH / 2, { align: 'center' })
      }
    } else {
      doc.setFillColor(240, 240, 240)
      doc.rect(x + 2, y + 2, cellW - 4, thumbH - 2, 'F')
      doc.setFontSize(8)
      doc.text(`#${i + 1}`, x + cellW / 2, y + thumbH / 2, { align: 'center' })
    }

    doc.setFontSize(8)
    doc.text(`#${i + 1} ${shot.title}`.slice(0, 30), x + 2, y + thumbH + 4)

    if (includeDialogue && shot.audio?.dialogue) {
      doc.setFontSize(6)
      const dlg = shot.audio.dialogue.slice(0, 60)
      doc.text(dlg, x + 2, y + thumbH + 9, { maxWidth: cellW - 4 })
    }
  }

  return doc.output('blob')
}

// ── Download helpers ──

export function downloadManifestJSON(draft: ShortDramaDraftV2) {
  downloadAsFile(exportManifestJSON(draft), `${draft.title || 'project'}_manifest.json`, 'application/json')
}

export function downloadFCPXML(draft: ShortDramaDraftV2, episodeId?: string) {
  const timeline = buildTimeline(draft, episodeId)
  downloadAsFile(exportFCPXML(timeline, draft), `${draft.title || 'project'}.xml`, 'application/xml')
}

export function downloadOTIO(draft: ShortDramaDraftV2, episodeId?: string) {
  const timeline = buildTimeline(draft, episodeId)
  downloadAsFile(exportOTIO(timeline, draft), `${draft.title || 'project'}.otio`, 'application/json')
}

export async function downloadStoryboardPDF(draft: ShortDramaDraftV2, options?: Parameters<typeof exportStoryboardPDF>[1]) {
  const blob = await exportStoryboardPDF(draft, options)
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `${draft.title || 'storyboard'}.pdf`
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}
