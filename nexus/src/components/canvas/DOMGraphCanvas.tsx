/**
 * DOMGraphCanvas - 极致性能画布 (60 FPS 版本)
 * 
 * 核心原则：零订阅、零渲染
 * 1. 不使用任何 Zustand 订阅
 * 2. 不使用任何 React 状态
 * 3. 所有交互通过原生事件 + DOM 操作
 * 4. 只在必要时通过 getState() 读取数据
 */
import React, { memo, useEffect, useLayoutEffect, useRef } from 'react'
import { useGraphStore } from '@/graph/store'
import type { Viewport, GraphNode } from '@/graph/types'
import { getNodeWidth } from '@/graph/nodeSizing'

type CanvasContextPayload =
  | { kind: 'node'; id: string; clientX: number; clientY: number }
  | { kind: 'edge'; id: string; clientX: number; clientY: number }
  | { kind: 'canvas'; clientX: number; clientY: number; world: { x: number; y: number } }

type Props = {
  children?: React.ReactNode
  onInteractingChange?: (interacting: boolean) => void
  onTransientViewportChange?: (vp: Viewport | null) => void
  onContextMenu?: (payload: CanvasContextPayload) => void
}

export default memo(function DOMGraphCanvas({
  children,
  onInteractingChange,
  onTransientViewportChange,
  onContextMenu
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const transformRef = useRef<HTMLDivElement>(null)
  const edgeSvgRef = useRef<SVGSVGElement>(null)
  const minimapRef = useRef<HTMLCanvasElement>(null)

  // 使用 useLayoutEffect 在渲染后立即执行，避免闪烁
  useLayoutEffect(() => {
    const el = containerRef.current
    const transformEl = transformRef.current
    if (!el || !transformEl) return

    // 获取 store 方法（只读一次）
    const store = useGraphStore.getState
    
    // 状态全部存储在这里，不触发任何 React 渲染
    let vp = { ...store().viewport }
    let dragging = false
    let dragType: '' | 'pan' | 'node' = ''
    let startX = 0, startY = 0
    let startVpX = 0, startVpY = 0
    let nodeId = ''
    let nodeStartX = 0, nodeStartY = 0
    let nodeEl: HTMLElement | null = null
    let finalX = 0, finalY = 0
    let minimapTimer = 0
    let wheelTimer = 0

    // 应用 transform (使用 translate3d 强制 GPU 加速)
    const applyTransform = () => {
      transformEl.style.transform = `translate3d(${vp.x}px, ${vp.y}px, 0) scale(${vp.zoom})`
    }
    applyTransform()

    // 查找节点
    const findNodeAt = (worldX: number, worldY: number): GraphNode | null => {
      const nodes = store().nodes
      for (let i = nodes.length - 1; i >= 0; i--) {
        const n = nodes[i]
        const w = getNodeWidth(n.type)
        const h = n.height || 150
        if (worldX >= n.x && worldX <= n.x + w && worldY >= n.y && worldY <= n.y + h) {
          return n
        }
      }
      return null
    }

    // 更新边（按需调用）
    const updateEdges = () => {
      const svg = edgeSvgRef.current
      if (!svg) return
      const { nodes, edges } = store()
      const nodesMap = new Map<string, GraphNode>()
      for (const n of nodes) nodesMap.set(n.id, n)

      while (svg.firstChild) svg.removeChild(svg.firstChild)

      for (const edge of edges) {
        const source = nodesMap.get(edge.source)
        const target = nodesMap.get(edge.target)
        if (!source || !target) continue

        const sw = getNodeWidth(source.type)
        const x1 = source.x + sw
        const y1 = source.y + 40
        const x2 = target.x
        const y2 = target.y + 40
        const dx = Math.abs(x2 - x1)
        const ctrl = Math.max(40, dx * 0.35)

        const path = document.createElementNS('http://www.w3.org/2000/svg', 'path')
        path.setAttribute('d', `M ${x1} ${y1} C ${x1 + ctrl} ${y1}, ${x2 - ctrl} ${y2}, ${x2} ${y2}`)
        path.setAttribute('fill', 'none')
        path.setAttribute('stroke', 'var(--text-secondary)')
        path.setAttribute('stroke-width', '1.5')
        path.setAttribute('stroke-linecap', 'round')
        path.setAttribute('opacity', '0.5')
        svg.appendChild(path)
      }
    }

    // 更新小地图
    const updateMinimap = () => {
      const canvas = minimapRef.current
      if (!canvas) return
      const ctx = canvas.getContext('2d')
      if (!ctx) return

      const { nodes } = store()
      const mapW = 160, mapH = 100
      const containerW = window.innerWidth
      const containerH = window.innerHeight

      ctx.clearRect(0, 0, mapW, mapH)

      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
      for (const n of nodes) {
        const w = getNodeWidth(n.type)
        minX = Math.min(minX, n.x)
        minY = Math.min(minY, n.y)
        maxX = Math.max(maxX, n.x + w)
        maxY = Math.max(maxY, n.y + 100)
      }
      if (!isFinite(minX)) { minX = 0; minY = 0; maxX = 1000; maxY = 800 }
      const padding = 100
      minX -= padding; minY -= padding
      maxX += padding; maxY += padding
      const worldW = maxX - minX
      const worldH = maxY - minY
      const scale = Math.min((mapW - 10) / worldW, (mapH - 10) / worldH)

      ctx.fillStyle = 'rgba(0,0,0,0.3)'
      ctx.fillRect(0, 0, mapW, mapH)

      ctx.fillStyle = 'rgba(59, 130, 246, 0.8)'
      for (const n of nodes) {
        const x = (n.x - minX) * scale + 5
        const y = (n.y - minY) * scale + 5
        const w = Math.max(4, getNodeWidth(n.type) * scale)
        const h = Math.max(3, 60 * scale)
        ctx.fillRect(x, y, w, h)
      }

      const vpX = (-vp.x / vp.zoom - minX) * scale + 5
      const vpY = (-vp.y / vp.zoom - minY) * scale + 5
      const vpW = Math.max(10, (containerW / vp.zoom) * scale)
      const vpH = Math.max(8, (containerH / vp.zoom) * scale)
      ctx.strokeStyle = 'rgba(59, 130, 246, 1)'
      ctx.lineWidth = 2
      ctx.strokeRect(vpX, vpY, vpW, vpH)
    }

    // 启动小地图定时器
    minimapTimer = window.setInterval(updateMinimap, 500) // 2fps 足够
    updateEdges()
    updateMinimap()

    // Pointer Down
    const handleDown = (e: PointerEvent) => {
      if (e.button !== 0) return
      const target = e.target as HTMLElement
      if (target.closest('input, textarea, select, button, video, audio, [data-interactive]')) return

      const rect = el.getBoundingClientRect()
      const screenX = e.clientX - rect.left
      const screenY = e.clientY - rect.top
      const worldX = (screenX - vp.x) / vp.zoom
      const worldY = (screenY - vp.y) / vp.zoom

      const node = findNodeAt(worldX, worldY)

      if (node) {
        nodeEl = document.querySelector(`[data-node-id="${node.id}"]`) as HTMLElement
        dragging = true
        dragType = 'node'
        startX = e.clientX
        startY = e.clientY
        nodeId = node.id
        nodeStartX = node.x
        nodeStartY = node.y
        finalX = node.x
        finalY = node.y
        nodeEl?.classList.add('ring-2', 'ring-blue-500')
      } else {
        dragging = true
        dragType = 'pan'
        startX = e.clientX
        startY = e.clientY
        startVpX = vp.x
        startVpY = vp.y
      }

      onInteractingChange?.(true)
      el.setPointerCapture(e.pointerId)
    }

    // 高性能模式：在快速缩放/平移时简化渲染
    let isHighPerf = false
    let highPerfTimer = 0
    const enterHighPerfMode = () => {
      if (isHighPerf) return
      isHighPerf = true
      transformEl.classList.add('high-perf-mode')
    }
    const exitHighPerfMode = () => {
      if (!isHighPerf) return
      isHighPerf = false
      transformEl.classList.remove('high-perf-mode')
    }
    const scheduleExitHighPerf = () => {
      clearTimeout(highPerfTimer)
      highPerfTimer = window.setTimeout(exitHighPerfMode, 100)
    }

    // Pointer Move
    const handleMove = (e: PointerEvent) => {
      if (!dragging) return

      if (dragType === 'pan') {
        const dx = e.clientX - startX
        const dy = e.clientY - startY
        vp.x = startVpX + dx
        vp.y = startVpY + dy
        // 快速平移时进入高性能模式
        enterHighPerfMode()
        applyTransform()
      } else if (dragType === 'node' && nodeEl) {
        const dx = e.clientX - startX
        const dy = e.clientY - startY
        finalX = Math.round((nodeStartX + dx / vp.zoom) / 20) * 20
        finalY = Math.round((nodeStartY + dy / vp.zoom) / 20) * 20
        nodeEl.style.transform = `translate(${finalX}px, ${finalY}px)`
      }
    }

    // Pointer Up
    const handleUp = (e: PointerEvent) => {
      if (!dragging) return

      const dx = e.clientX - startX
      const dy = e.clientY - startY
      const distance = Math.sqrt(dx * dx + dy * dy)
      const isClick = distance < 5

      if (dragType === 'pan') {
        exitHighPerfMode()
        store().setViewport(vp)
        onTransientViewportChange?.(null)
        if (isClick) store().setSelected(null)
      } else if (dragType === 'node' && nodeId) {
        nodeEl?.classList.remove('ring-2', 'ring-blue-500')
        
        if (!isClick) {
          store().updateNode(nodeId, { x: finalX, y: finalY })
          // 延迟更新边
          setTimeout(updateEdges, 10)
        }
        store().setSelected(nodeId)
      }

      dragging = false
      dragType = ''
      nodeEl = null
      onInteractingChange?.(false)
      el.releasePointerCapture(e.pointerId)
    }

    // Wheel - 只更新 DOM，延迟同步到 store
    const handleWheel = (e: WheelEvent) => {
      e.preventDefault()
      const rect = el.getBoundingClientRect()
      const screenX = e.clientX - rect.left
      const screenY = e.clientY - rect.top

      const delta = -e.deltaY * 0.001
      const newZoom = Math.max(0.1, Math.min(2, vp.zoom * (1 + delta)))
      
      const worldX = (screenX - vp.x) / vp.zoom
      const worldY = (screenY - vp.y) / vp.zoom
      vp.x = screenX - worldX * newZoom
      vp.y = screenY - worldY * newZoom
      vp.zoom = newZoom
      
      // 进入高性能模式
      enterHighPerfMode()
      
      // 只更新 DOM，不触发 React
      applyTransform()
      
      // 延迟同步到 store 和退出高性能模式
      clearTimeout(wheelTimer)
      wheelTimer = window.setTimeout(() => {
        exitHighPerfMode()
        store().setViewport(vp)
      }, 150)
    }

    // Double Click - 适应视图
    const handleDblClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement
      if (target.closest('input, textarea, select, button, [data-interactive]')) return

      const nodes = store().nodes
      if (nodes.length === 0) return

      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
      for (const n of nodes) {
        const w = getNodeWidth(n.type)
        minX = Math.min(minX, n.x)
        minY = Math.min(minY, n.y)
        maxX = Math.max(maxX, n.x + w)
        maxY = Math.max(maxY, n.y + 150)
      }

      const rect = el.getBoundingClientRect()
      const padding = 80
      const worldW = maxX - minX + padding * 2
      const worldH = maxY - minY + padding * 2
      const zoom = Math.min(0.9, Math.min(rect.width / worldW, rect.height / worldH))
      const centerX = (minX + maxX) / 2
      const centerY = (minY + maxY) / 2

      vp.x = rect.width / 2 - centerX * zoom
      vp.y = rect.height / 2 - centerY * zoom
      vp.zoom = zoom
      
      applyTransform()
      // 延迟同步到 store，避免立即触发 React 重新渲染
      clearTimeout(wheelTimer)
      wheelTimer = window.setTimeout(() => {
        store().setViewport(vp)
      }, 150)
    }

    // Context Menu
    const handleContext = (e: MouseEvent) => {
      e.preventDefault()
      const rect = el.getBoundingClientRect()
      const screenX = e.clientX - rect.left
      const screenY = e.clientY - rect.top
      const worldX = (screenX - vp.x) / vp.zoom
      const worldY = (screenY - vp.y) / vp.zoom

      const node = findNodeAt(worldX, worldY)
      if (node) {
        onContextMenu?.({ kind: 'node', id: node.id, clientX: e.clientX, clientY: e.clientY })
      } else {
        onContextMenu?.({ kind: 'canvas', clientX: e.clientX, clientY: e.clientY, world: { x: worldX, y: worldY } })
      }
    }

    // 绑定事件
    el.addEventListener('pointerdown', handleDown)
    el.addEventListener('pointermove', handleMove, { passive: true })
    el.addEventListener('pointerup', handleUp)
    el.addEventListener('pointerleave', handleUp)
    el.addEventListener('wheel', handleWheel, { passive: false })
    el.addEventListener('dblclick', handleDblClick)
    el.addEventListener('contextmenu', handleContext)

    return () => {
      clearInterval(minimapTimer)
      clearTimeout(wheelTimer)
      el.removeEventListener('pointerdown', handleDown)
      el.removeEventListener('pointermove', handleMove)
      el.removeEventListener('pointerup', handleUp)
      el.removeEventListener('pointerleave', handleUp)
      el.removeEventListener('wheel', handleWheel)
      el.removeEventListener('dblclick', handleDblClick)
      el.removeEventListener('contextmenu', handleContext)
    }
  }, [onContextMenu, onInteractingChange, onTransientViewportChange])

  return (
    <div
      ref={containerRef}
      className="absolute inset-0 bg-[var(--bg-primary)] overflow-hidden select-none"
      style={{ touchAction: 'none', cursor: 'grab' }}
    >
      {/* 网格背景 */}
      <div 
        className="absolute inset-0 pointer-events-none"
        style={{
          backgroundImage: `radial-gradient(circle, var(--text-secondary) 1px, transparent 1px)`,
          backgroundSize: '20px 20px',
          opacity: 0.15
        }}
      />
      
      {/* Transform 容器 */}
      <div
        ref={transformRef}
        className="absolute"
        style={{ 
          left: 0, 
          top: 0, 
          transformOrigin: '0 0', 
          willChange: 'transform',
          contain: 'layout style',
          backfaceVisibility: 'hidden'
        }}
      >
        <svg 
          ref={edgeSvgRef}
          className="absolute pointer-events-none" 
          style={{ left: 0, top: 0, width: '100%', height: '100%', overflow: 'visible' }}
        />
        {children}
      </div>

      {/* 小地图 */}
      <canvas
        ref={minimapRef}
        width={160}
        height={100}
        className="absolute bottom-4 right-4 z-30 rounded-lg border border-[var(--border-color)] shadow-lg"
      />
    </div>
  )
})
