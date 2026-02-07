export type ShortDramaImportedScript = {
  text: string
  fileName?: string
  mimeType?: string
}

const normalizeText = (t: string) => String(t || '').replace(/\r\n/g, '\n').trim()

const readFileAsText = (file: File) =>
  new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(reader.error || new Error('读取失败'))
    reader.onload = () => resolve(String(reader.result || ''))
    reader.readAsText(file)
  })

const readFileAsArrayBuffer = (file: File) =>
  new Promise<ArrayBuffer>((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(reader.error || new Error('读取失败'))
    reader.onload = () => resolve(reader.result as ArrayBuffer)
    reader.readAsArrayBuffer(file)
  })

const getExt = (name: string) => {
  const n = String(name || '').trim()
  const m = n.match(/\.([a-z0-9]+)$/i)
  return m ? String(m[1] || '').toLowerCase() : ''
}

export async function importShortDramaScriptFile(file: File): Promise<ShortDramaImportedScript> {
  if (!file) throw new Error('未选择文件')
  const fileName = String(file.name || '').trim()
  const ext = getExt(fileName)
  const mime = String(file.type || '').trim()

  // txt / md
  if (ext === 'txt' || ext === 'md' || mime.startsWith('text/')) {
    const text = normalizeText(await readFileAsText(file))
    return { text, fileName, mimeType: mime || 'text/plain' }
  }

  // docx
  if (ext === 'docx' || mime === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') {
    const buf = await readFileAsArrayBuffer(file)
    const mammoth = await import('mammoth')
    const result = await (mammoth as any).extractRawText({ arrayBuffer: buf })
    const text = normalizeText(String(result?.value || ''))
    return { text, fileName, mimeType: mime || 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' }
  }

  // fallback: try as text
  const text = normalizeText(await readFileAsText(file))
  return { text, fileName, mimeType: mime || 'text/plain' }
}

