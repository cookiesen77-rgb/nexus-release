import React, { useEffect } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useGraphStore } from '@/graph/store'
import ShortDramaStudioShell from '@/components/shortDrama/ShortDramaStudioShell'

export default function ShortDramaStudioPage() {
  const nav = useNavigate()
  const { projectId: rawProjectId } = useParams()
  const projectId = String(rawProjectId || '').trim() || 'default'

  // 确保当前画布项目已加载（便于工作台读取画布素材/返回不丢数据）
  useEffect(() => {
    const cur = String(useGraphStore.getState().projectId || '').trim() || 'default'
    if (cur === projectId) return
    void useGraphStore.getState().setProjectId(projectId)
  }, [projectId])

  return (
    <div className="h-full min-h-screen w-full bg-[var(--bg-primary)] text-[var(--text-primary)]">
      <ShortDramaStudioShell
        projectId={projectId}
        closeVariant="button"
        closeLabel="返回画布"
        onRequestClose={() => nav(`/canvas/${projectId}`)}
        className="h-screen w-full rounded-none border-0 bg-[var(--bg-primary)]"
      />
    </div>
  )
}

