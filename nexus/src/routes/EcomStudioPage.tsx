import React, { useEffect, Component } from 'react'
import type { ErrorInfo, ReactNode } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useGraphStore } from '@/graph/store'
import EcomStudioShell from '@/components/ecommerce/EcomStudioShell'

class EcomErrorBoundary extends Component<{ children: ReactNode; onReset: () => void }, { error: Error | null }> {
  state: { error: Error | null } = { error: null }
  static getDerivedStateFromError(error: Error) { return { error } }
  componentDidCatch(error: Error, info: ErrorInfo) { console.error('[EcomStudio] crash:', error, info) }
  render() {
    if (this.state.error) {
      return (
        <div className="flex h-screen items-center justify-center bg-[var(--bg-primary)] text-[var(--text-primary)]">
          <div className="max-w-md space-y-3 rounded-xl border border-[var(--border-color)] bg-[var(--bg-secondary)] p-6 text-center">
            <div className="text-lg font-bold">电商工具台发生错误</div>
            <div className="text-sm text-[var(--text-secondary)]">{this.state.error.message}</div>
            <div className="flex justify-center gap-3">
              <button onClick={() => { this.setState({ error: null }) }} className="rounded-lg bg-[var(--accent-color)] px-4 py-2 text-sm text-white">重试</button>
              <button onClick={this.props.onReset} className="rounded-lg border border-[var(--border-color)] px-4 py-2 text-sm">返回画布</button>
            </div>
          </div>
        </div>
      )
    }
    return this.props.children
  }
}

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
    <EcomErrorBoundary onReset={() => nav(`/canvas/${projectId}`)}>
      <div className="h-full min-h-screen w-full bg-[var(--bg-primary)] text-[var(--text-primary)]">
        <EcomStudioShell
          projectId={projectId}
          onRequestClose={() => nav(`/canvas/${projectId}`)}
        />
      </div>
    </EcomErrorBoundary>
  )
}
