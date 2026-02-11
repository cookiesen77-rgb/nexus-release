import type { ShortDramaDraftV2 } from './types'

const toPdfText = (value: string) => String(value || '').replace(/[^\x00-\x7F]/g, '?')

export async function exportStoryboardPdf(draft: ShortDramaDraftV2): Promise<Uint8Array> {
  const { PDFDocument, StandardFonts, rgb } = await import('pdf-lib')
  const doc = await PDFDocument.create()
  const font = await doc.embedFont(StandardFonts.Helvetica)

  // Title page
  const titlePage = doc.addPage([595, 842])
  titlePage.drawText(toPdfText(draft.title || 'Storyboard'), { x: 50, y: 780, size: 24, font })
  titlePage.drawText(toPdfText(draft.logline || ''), { x: 50, y: 750, size: 12, font, maxWidth: 495 })

  // Shot pages
  for (const shot of draft.shots || []) {
    const page = doc.addPage([595, 842])
    let y = 800

    page.drawText(toPdfText(shot.title || 'Shot'), { x: 50, y, size: 16, font })
    y -= 25

    if (shot.beat) {
      page.drawText(toPdfText(`Beat: ${shot.beat}`), { x: 50, y, size: 10, font, color: rgb(0.4, 0.4, 0.4) })
      y -= 20
    }

    page.drawText('Start Frame:', { x: 50, y, size: 10, font, color: rgb(0, 0.4, 0.8) })
    y -= 15
    const startText = toPdfText(shot.frames?.start?.prompt || '')
    if (startText) {
      const lines = wrapText(startText, 80)
      for (const line of lines) {
        page.drawText(line, { x: 50, y, size: 9, font })
        y -= 13
      }
    }
    y -= 10

    page.drawText('End Frame:', { x: 50, y, size: 10, font, color: rgb(0, 0.4, 0.8) })
    y -= 15
    const endText = toPdfText(shot.frames?.end?.prompt || '')
    if (endText) {
      const lines = wrapText(endText, 80)
      for (const line of lines) {
        page.drawText(line, { x: 50, y, size: 9, font })
        y -= 13
      }
    }
    y -= 10

    if (shot.videoPrompt) {
      page.drawText('Video Prompt:', { x: 50, y, size: 10, font, color: rgb(0.8, 0.2, 0) })
      y -= 15
      const lines = wrapText(toPdfText(shot.videoPrompt), 80)
      for (const line of lines) {
        page.drawText(line, { x: 50, y, size: 9, font })
        y -= 13
      }
    }
  }

  return doc.save()
}

function wrapText(text: string, maxChars: number): string[] {
  const lines: string[] = []
  let remaining = text
  while (remaining.length > 0) {
    if (remaining.length <= maxChars) { lines.push(remaining); break }
    let breakAt = remaining.lastIndexOf(' ', maxChars)
    if (breakAt <= 0) breakAt = maxChars
    lines.push(remaining.slice(0, breakAt))
    remaining = remaining.slice(breakAt).trimStart()
  }
  return lines
}
