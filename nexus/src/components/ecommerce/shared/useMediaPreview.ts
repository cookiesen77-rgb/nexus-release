import { useState, useEffect } from 'react'
import { getMedia } from '@/lib/mediaStorage'

export function useMediaPreview(mediaId?: string) {
  const [url, setUrl] = useState('')
  useEffect(() => {
    if (!mediaId) { setUrl(''); return }
    let cancelled = false
    ;(async () => {
      try {
        const rec = await getMedia(mediaId)
        if (!cancelled) setUrl(String(rec?.data || ''))
      } catch { if (!cancelled) setUrl('') }
    })()
    return () => { cancelled = true }
  }, [mediaId])
  return url
}
