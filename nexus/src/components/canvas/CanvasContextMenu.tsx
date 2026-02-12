import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useGraphStore } from '@/graph/store'
import type { GraphEdge, GraphNode, NodeType } from '@/graph/types'
import { getNodeSize } from '@/graph/nodeSizing'
import { DEFAULT_IMAGE_MODEL, DEFAULT_VIDEO_MODEL } from '@/config/models'
import { saveMedia } from '@/lib/mediaStorage'
import { downloadFile } from '@/lib/download'
import { getVideoModelCaps } from '@/lib/modelCaps'

// 检测 Tauri 环境
const isTauri = typeof window !== 'undefined' && !!(window as any).__TAURI_INTERNALS__

export type CanvasContextPayload =
  | { kind: 'node'; id: string; clientX: number; clientY: number }
  | { kind: 'edge'; id: string; clientX: number; clientY: number }
  | { kind: 'canvas'; clientX: number; clientY: number; world: { x: number; y: number } }

const itemClass =
  'flex w-full items-center justify-between px-3 py-2 text-left text-sm text-[var(--text-primary)] hover:bg-[var(--bg-tertiary)]'

const sectionSep = <div className="my-1 h-px w-full bg-[var(--border-color)]" />

const sanitizeFilenameBase = (name: string) => {
  let s = String(name || '').replace(/[\u0000-\u001F]/g, '').replace(/[\\/:*?"<>|]/g, '_')
  s = s.replace(/\s+/g, ' ').trim()
  s = s.replace(/[. ]+$/g, '').trim()
  return s.slice(0, 80)
}

const guessSpawnType = (to: GraphNode | null): NodeType => {
  if (!to) return 'text'
  if (to.type === 'imageConfig') return 'image'
  if (to.type === 'videoConfig') return 'image'
  return 'text'
}

export default function CanvasContextMenu({
  open,
  onOpenChange,
  payload,
  onRequestEditRemark,
}: {
  open: boolean
  onOpenChange: (v: boolean) => void
  payload: CanvasContextPayload | null
  onRequestEditRemark?: (nodeId: string) => void
}) {
  const rootRef = useRef<HTMLDivElement | null>(null)
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const pendingFileTypeRef = useRef<string | null>(null)
  const pendingWorldRef = useRef<{ x: number; y: number } | null>(null)
  
  const nodes = useGraphStore((s) => s.nodes)
  const edges = useGraphStore((s) => s.edges)
  const updateNode = useGraphStore((s) => s.updateNode)
  const removeNode = useGraphStore((s) => s.removeNode)
  const duplicateNode = useGraphStore((s) => s.duplicateNode)
  const addNode = useGraphStore((s) => s.addNode)
  const addEdge = useGraphStore((s) => s.addEdge)
  const removeEdge = useGraphStore((s) => s.removeEdge)
  const setEdgeImageRole = useGraphStore((s) => s.setEdgeImageRole)
  const setSelected = useGraphStore((s) => s.setSelected)
  const withBatch = useGraphStore((s) => s.withBatchUpdates)

  // 处理文件选择（支持多选）
  const handleFileSelect = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    console.log('[CanvasContextMenu] handleFileSelect 被调用')
    const files = e.target.files
    const type = pendingFileTypeRef.current
    const world = pendingWorldRef.current
    console.log('[CanvasContextMenu] files:', files?.length, 'type:', type, 'world:', world)

    if (!files || files.length === 0 || !type || !world) {
      pendingFileTypeRef.current = null
      pendingWorldRef.current = null
      e.target.value = ''
      return
    }

    const { w, h } = getNodeSize(type)
    const store = useGraphStore.getState()
    const projectId = store.projectId || 'default'

    // 处理所有选中的文件
    for (let i = 0; i < files.length; i++) {
      const file = files[i]
      const pos = { x: world.x - w * 0.5 + i * 30, y: world.y - h * 0.5 + i * 30 }

      const reader = new FileReader()
      reader.onload = async (event) => {
        const dataUrl = event.target?.result as string
        if (!dataUrl) return

        const newNodeId = store.addNode(type, pos, {
          label: file.name || (type === 'image' ? '图片' : type === 'video' ? '视频' : '音频'),
          url: dataUrl,
          sourceUrl: '',
          fileName: file.name,
          fileType: file.type,
          createdAt: Date.now()
        })

        // 保存到 IndexedDB
        try {
          const mediaId = await saveMedia({
            nodeId: newNodeId,
            projectId,
            type: type as 'image' | 'video' | 'audio',
            data: dataUrl,
          })
          if (mediaId) {
            store.patchNodeDataSilent(newNodeId, { mediaId })
          }
        } catch {
          // ignore
        }
      }
      reader.readAsDataURL(file)
    }

    if (files.length > 0) {
      window.$message?.success?.(`已上传 ${files.length} 个文件`)
    }

    pendingFileTypeRef.current = null
    pendingWorldRef.current = null
    e.target.value = ''

    // Web 环境下，文件选择完成后关闭菜单
    onOpenChange(false)
  }, [onOpenChange])

  // 触发文件选择
  const triggerFileUpload = useCallback(async (type: string, world: { x: number; y: number }) => {
    pendingFileTypeRef.current = type
    pendingWorldRef.current = world
    
    let filters: Array<{ name: string; extensions: string[] }> = []
    let accept = ''
    if (type === 'image') {
      accept = 'image/*'
      filters = [{ name: '图片文件', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'svg'] }]
    } else if (type === 'video') {
      accept = 'video/*'
      filters = [{ name: '视频文件', extensions: ['mp4', 'webm', 'mov', 'avi', 'mkv'] }]
    } else if (type === 'audio') {
      accept = 'audio/*'
      filters = [{ name: '音频文件', extensions: ['mp3', 'wav', 'ogg', 'flac', 'aac', 'm4a'] }]
    }
    
    if (isTauri) {
      // Tauri 环境：先关闭菜单再打开系统对话框
      onOpenChange(false)
      try {
        const { open } = await import('@tauri-apps/plugin-dialog')
        const { readFile } = await import('@tauri-apps/plugin-fs')

        const result = await open({
          multiple: true,  // 支持多选
          filters,
          title: type === 'image' ? '选择图片' : type === 'video' ? '选择视频' : '选择音频'
        })

        const files = Array.isArray(result) ? result : (result ? [result] : [])

        if (files.length > 0) {
          const store = useGraphStore.getState()
          const projectId = store.projectId || 'default'

          for (let i = 0; i < files.length; i++) {
            const filePath = files[i]
            const fileData = await readFile(filePath)
            const fileName = filePath.split('/').pop() || filePath.split('\\').pop() || 'file'
            const ext = fileName.split('.').pop()?.toLowerCase() || ''

            let mimeType = ''
            if (type === 'image') {
              const mimeMap: Record<string, string> = {
                png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg',
                gif: 'image/gif', webp: 'image/webp', bmp: 'image/bmp', svg: 'image/svg+xml'
              }
              mimeType = mimeMap[ext] || 'image/png'
            } else if (type === 'video') {
              const mimeMap: Record<string, string> = {
                mp4: 'video/mp4', webm: 'video/webm', mov: 'video/quicktime',
                avi: 'video/x-msvideo', mkv: 'video/x-matroska'
              }
              mimeType = mimeMap[ext] || 'video/mp4'
            } else if (type === 'audio') {
              const mimeMap: Record<string, string> = {
                mp3: 'audio/mpeg', wav: 'audio/wav', ogg: 'audio/ogg',
                flac: 'audio/flac', aac: 'audio/aac', m4a: 'audio/mp4'
              }
              mimeType = mimeMap[ext] || 'audio/mpeg'
            }

            const blob = new Blob([fileData], { type: mimeType })
            const dataUrl = await new Promise<string>((resolve) => {
              const reader = new FileReader()
              reader.onload = () => resolve(reader.result as string)
              reader.readAsDataURL(blob)
            })

            const { w, h } = getNodeSize(type)
            const pos = { x: world.x - w * 0.5 + i * 30, y: world.y - h * 0.5 + i * 30 }

            const newNodeId = store.addNode(type, pos, {
              label: fileName,
              url: dataUrl,
              sourceUrl: '',
              fileName,
              fileType: mimeType,
              createdAt: Date.now()
            })

            // 保存到 IndexedDB
            try {
              const mediaId = await saveMedia({
                nodeId: newNodeId,
                projectId,
                type: type as 'image' | 'video' | 'audio',
                data: dataUrl,
              })
              if (mediaId) {
                store.patchNodeDataSilent(newNodeId, { mediaId })
              }
            } catch {
              // ignore
            }
          }

          window.$message?.success?.(`已上传 ${files.length} 个文件`)
        }
      } catch (err) {
        console.error('[CanvasContextMenu] Tauri 文件选择失败:', err)
        window.$message?.error?.('文件选择失败，请重试')
      }
      pendingFileTypeRef.current = null
      pendingWorldRef.current = null
    } else {
      // Web 环境：先触发文件选择，选择完成后在 handleFileSelect 中关闭菜单
      console.log('[CanvasContextMenu] Web 环境, fileInputRef:', fileInputRef.current)
      if (fileInputRef.current) {
        fileInputRef.current.accept = accept
        console.log('[CanvasContextMenu] 触发 click, accept:', accept)
        fileInputRef.current.click()
        // 注意：不在这里关闭菜单，而是在 handleFileSelect 中关闭
      } else {
        console.error('[CanvasContextMenu] fileInputRef.current 为空!')
      }
    }
  }, [onOpenChange])

  const info = useMemo(() => {
    if (!payload) return null
    if (payload.kind === 'node') {
      const node = nodes.find((n) => n.id === payload.id) || null
      return { kind: 'node' as const, node }
    }
    if (payload.kind === 'edge') {
      const edge = edges.find((e) => e.id === payload.id) || null
      return { kind: 'edge' as const, edge }
    }
    return { kind: 'canvas' as const, world: payload.world }
  }, [edges, nodes, payload])

  useEffect(() => {
    if (!open) return
    const onDown = (e: PointerEvent) => {
      const el = rootRef.current
      if (!el) return
      if (el.contains(e.target as any)) return
      onOpenChange(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onOpenChange(false)
    }
    // 使用 capture 阶段监听，避免画布/节点 stopPropagation() 导致无法关闭
    window.addEventListener('pointerdown', onDown, { capture: true })
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('pointerdown', onDown, { capture: true } as any)
      window.removeEventListener('keydown', onKey)
    }
  }, [onOpenChange, open])

  // 文件输入必须始终存在，不能在条件渲染内部
  const fileInput = (
    <input
      ref={fileInputRef}
      type="file"
      multiple
      className="hidden"
      onChange={handleFileSelect}
    />
  )

  if (!open || !payload || !info) return fileInput

  const style: React.CSSProperties = {
    left: payload.clientX,
    top: payload.clientY
  }

  const spawnConfigToRight = (src: GraphNode, type: NodeType) => {
    const { w } = getNodeSize(src.type)
    const dx = type === 'imageConfig' ? Math.max(360, w + 40) : Math.max(420, w + 80)
    withBatch(() => {
      const id = addNode(type, { x: src.x + dx, y: src.y + (type === 'videoConfig' ? 40 : 0) }, {
        label: type === 'imageConfig' ? '文生图' : '视频生成',
        ...(type === 'imageConfig' ? { model: DEFAULT_IMAGE_MODEL } : {}),
        ...(type === 'videoConfig' ? { model: DEFAULT_VIDEO_MODEL } : {})
      })
      addEdge(src.id, id, {})
      setSelected(id)
    })
  }

  const spawnNodeAt = (type: NodeType, world: { x: number; y: number }) => {
    const id = addNode(type, { x: world.x, y: world.y }, { label: type === 'text' ? '文本' : type })
    setSelected(id)
  }

  const MenuShell = ({ children }: { children: React.ReactNode }) => (
    <div
      ref={rootRef}
      className="pointer-events-auto fixed z-[60] w-[220px] overflow-hidden rounded-xl border border-[var(--border-color)] bg-[var(--bg-secondary)] shadow-2xl"
      style={style}
    >
      {children}
    </div>
  )

  if (info.kind === 'node' && info.node) {
    const n = info.node
    const url = String((n.data as any)?.url || '').trim()
    const canDownload = (n.type === 'image' || n.type === 'video' || n.type === 'audio') && !!url
    return (
      <MenuShell>
        {canDownload ? (
          <>
            <button
              className={itemClass}
              onClick={() => {
                const ext = n.type === 'video' ? 'mp4' : n.type === 'audio' ? 'mp3' : 'png'
                const baseRaw = String((n.data as any)?.remark || (n.data as any)?.title || (n.data as any)?.label || 'asset').trim()
                const base = sanitizeFilenameBase(baseRaw) || 'asset'
                void (async () => {
                  try {
                    await downloadFile({ url, filename: `${base}.${ext}` })
                  } catch (e: any) {
                    window.$message?.error?.(e?.message || '下载失败')
                  }
                })()
                onOpenChange(false)
              }}
            >
              <span>下载素材</span>
            </button>
            {sectionSep}
          </>
        ) : null}
        <button
          className={itemClass}
          onClick={() => {
            setSelected(n.id)
            onOpenChange(false)
          }}
        >
          <span>选中</span>
        </button>
        <button
          className={itemClass}
          onClick={() => {
            onRequestEditRemark?.(n.id)
            onOpenChange(false)
          }}
        >
          <span>编辑备注…</span>
        </button>
        <button
          className={itemClass}
          onClick={() => {
            const next = duplicateNode(n.id)
            if (next) setSelected(next)
            onOpenChange(false)
          }}
        >
          <span>复制</span>
        </button>
        <button
          className={itemClass}
          onClick={() => {
            removeNode(n.id)
            onOpenChange(false)
          }}
        >
          <span className="text-[var(--danger-color)]">删除</span>
        </button>
        {sectionSep}
        <button
          className={itemClass}
          onClick={() => {
            spawnConfigToRight(n, 'imageConfig')
            onOpenChange(false)
          }}
        >
          <span>创建生图配置</span>
        </button>
        <button
          className={itemClass}
          onClick={() => {
            spawnConfigToRight(n, 'videoConfig')
            onOpenChange(false)
          }}
        >
          <span>创建视频配置</span>
        </button>
        {sectionSep}
        <button
          className={itemClass}
          onClick={() => {
            updateNode(n.id, { zIndex: Date.now() })
            onOpenChange(false)
          }}
        >
          <span>置顶</span>
        </button>
      </MenuShell>
    )
  }

  if (info.kind === 'edge' && info.edge) {
    const e = info.edge
    const byId = new Map(nodes.map((n) => [n.id, n]))
    const s = byId.get(e.source)
    const t = byId.get(e.target)
    const canSetRole = s?.type === 'image' && t?.type === 'videoConfig'
    const videoCaps = canSetRole ? getVideoModelCaps(String((t?.data as any)?.model || DEFAULT_VIDEO_MODEL)) : null
    const canFirst = !!videoCaps?.supportsFirstFrame
    const canLast = !!videoCaps?.supportsLastFrame
    const canRef = !!videoCaps?.supportsReferenceImages
    return (
      <MenuShell>
        {canSetRole ? (
          <>
            {canFirst && (
              <button
                className={itemClass}
                onClick={() => {
                  setEdgeImageRole(e.id, 'first_frame_image')
                  onOpenChange(false)
                }}
              >
                <span>设为首帧</span>
              </button>
            )}
            {canLast && (
              <button
                className={itemClass}
                onClick={() => {
                  setEdgeImageRole(e.id, 'last_frame_image')
                  onOpenChange(false)
                }}
              >
                <span>设为尾帧</span>
              </button>
            )}
            {canRef && (
              <button
                className={itemClass}
                onClick={() => {
                  setEdgeImageRole(e.id, 'input_reference')
                  onOpenChange(false)
                }}
              >
                <span>设为参考图</span>
              </button>
            )}
            {sectionSep}
          </>
        ) : null}
        <button
          className={itemClass}
          onClick={() => {
            removeEdge(e.id)
            onOpenChange(false)
          }}
        >
          <span className="text-[var(--danger-color)]">删除连线</span>
        </button>
      </MenuShell>
    )
  }

  if (info.kind === 'canvas') {
    const world = info.world
    return (
      <>
        <MenuShell>
          <div className="px-3 pt-2 pb-1 text-[10px] font-semibold text-[var(--text-secondary)] uppercase tracking-wider">添加节点</div>
          <button
            className={itemClass}
            onClick={() => {
              spawnNodeAt('text', world)
              onOpenChange(false)
            }}
          >
            <span>文本节点</span>
          </button>
          <button
            className={itemClass}
            onClick={() => {
              spawnNodeAt('imageConfig', world)
              onOpenChange(false)
            }}
          >
            <span>图片配置节点</span>
          </button>
          <button
            className={itemClass}
            onClick={() => {
              spawnNodeAt('videoConfig', world)
              onOpenChange(false)
            }}
          >
            <span>视频配置节点</span>
          </button>
          {sectionSep}
          <button
            className={itemClass}
            onClick={() => triggerFileUpload('image', world)}
          >
            <span>图片上传节点</span>
          </button>
          <button
            className={itemClass}
            onClick={() => triggerFileUpload('video', world)}
          >
            <span>视频上传节点</span>
          </button>
        </MenuShell>
        {fileInput}
      </>
    )
  }

  return fileInput
}
