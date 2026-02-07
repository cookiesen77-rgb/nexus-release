import React, { useEffect } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useGraphStore } from '@/graph/store'
import EcomStudioShell from '@/components/ecommerce/EcomStudioShell'

export default function EcomStudioPage() {
  const nav = useNavigate()
  const { projectId: rawProjectId } = useParams()
  const projectId = String(rawProjectId || '').trim() || 'default'

  useEffect(() => {
    const cur = String(useGraphStore.getState().projectId || '').trim() || 'default'
    if (cur === projectId) return
    void useGraphStore.getState().setProjectId(projectId)
  }, [projectId])

  return (
    <div className="h-full min-h-screen w-full bg-[var(--bg-primary)] text-[var(--text-primary)]">
      <EcomStudioShell
        projectId={projectId}
        onRequestClose={() => nav(`/canvas/${projectId}`)}
      />
    </div>
  )
}
