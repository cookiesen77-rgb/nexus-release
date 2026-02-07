<template>
  <div class="hp-canvas-root" ref="rootRef">
    <canvas ref="canvasRef" class="hp-canvas" />

    <div v-if="showHud" class="hp-hud">
      <div class="hp-hud-row">
        <div class="hp-pill">模式：高性能</div>
        <div class="hp-pill">节点：{{ nodeCount }}</div>
        <div class="hp-pill">连线：{{ edgeCount }}</div>
        <div class="hp-pill">缩放：{{ zoomPct }}%</div>
        <div class="hp-pill">FPS：{{ fps }}</div>
      </div>
      <div class="hp-hud-row hp-hint">
        <span>拖拽空白处平移，滚轮缩放，拖拽节点移动（远景 LOD 仅显示简化外观）</span>
      </div>
    </div>
  </div>
</template>

<script setup>
import { computed, onMounted, onUnmounted, ref, toRaw, watch } from 'vue'
import { nodes, edges, canvasViewport, updateViewport, updateNode } from '@/stores/canvas'

const props = defineProps({
  viewport: { type: Object, default: null },
  interactive: { type: Boolean, default: true },
  showHud: { type: Boolean, default: true }
})

const rootRef = ref(null)
const canvasRef = ref(null)

const nodeCount = computed(() => (nodes.value || []).length)
const edgeCount = computed(() => (edges.value || []).length)
const effectiveViewport = computed(() => props.viewport || canvasViewport.value || { x: 0, y: 0, zoom: 1 })
const zoomPct = computed(() => Math.round((effectiveViewport.value?.zoom || 1) * 100))

const fps = ref(0)
let fpsFrames = 0
let fpsLastTs = performance.now()

let raf = 0
let ctx = null
let gl = null
let dpr = Math.max(1, Math.min(2, window.devicePixelRatio || 1))
let size = { w: 0, h: 0 }

const dragging = ref(false)
let draggingNodeId = null
let dragOffset = { x: 0, y: 0 }
let lastPointer = null

// Drag in GPU mode should not spam reactive store updates | GPU 模式拖拽不应频繁触发 store 更新
const transientNodePositions = new Map()
let transientViewport = null
let wheelCommitTimer = 0

const NODE_SIZES = {
  text: { w: 260, h: 180 },
  imageConfig: { w: 320, h: 220 },
  videoConfig: { w: 360, h: 260 },
  image: { w: 260, h: 260 },
  video: { w: 420, h: 300 },
  audio: { w: 280, h: 160 },
  localSave: { w: 260, h: 150 }
}

const getNodeSize = (type) => NODE_SIZES[type] || { w: 240, h: 160 }

const getLocalPoint = (ev) => {
  const el = rootRef.value
  if (!el) return { x: ev?.clientX || 0, y: ev?.clientY || 0 }
  const rect = el.getBoundingClientRect()
  return { x: (ev?.clientX || 0) - rect.left, y: (ev?.clientY || 0) - rect.top }
}

const toWorld = (p, vp) => ({
  x: (p.x - vp.x) / vp.zoom,
  y: (p.y - vp.y) / vp.zoom
})

const toScreen = (p, vp) => ({
  x: p.x * vp.zoom + vp.x,
  y: p.y * vp.zoom + vp.y
})

const clampZoom = (z) => Math.max(0.1, Math.min(2, z))

let glPrograms = null
let rectCapacity = 0
let lineCapacity = 0
let rectScratch = new Float32Array(0)
let lineScratch = new Float32Array(0)

const resizeCanvas = () => {
  const el = rootRef.value
  const canvas = canvasRef.value
  if (!el || !canvas) return
  const rect = el.getBoundingClientRect()
  size.w = Math.max(1, Math.floor(rect.width))
  size.h = Math.max(1, Math.floor(rect.height))
  canvas.width = Math.floor(size.w * dpr)
  canvas.height = Math.floor(size.h * dpr)
  canvas.style.width = `${size.w}px`
  canvas.style.height = `${size.h}px`
  if (gl) {
    gl.viewport(0, 0, canvas.width, canvas.height)
    return
  }
  ctx = canvas.getContext('2d', { alpha: false, desynchronized: true })
  if (ctx) ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
}

const compileShader = (gl, type, src) => {
  const sh = gl.createShader(type)
  if (!sh) throw new Error('createShader failed')
  gl.shaderSource(sh, src)
  gl.compileShader(sh)
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
    const msg = gl.getShaderInfoLog(sh) || 'shader compile failed'
    gl.deleteShader(sh)
    throw new Error(msg)
  }
  return sh
}

const createProgram = (gl, vsSrc, fsSrc) => {
  const vs = compileShader(gl, gl.VERTEX_SHADER, vsSrc)
  const fs = compileShader(gl, gl.FRAGMENT_SHADER, fsSrc)
  const prog = gl.createProgram()
  if (!prog) throw new Error('createProgram failed')
  gl.attachShader(prog, vs)
  gl.attachShader(prog, fs)
  gl.linkProgram(prog)
  gl.deleteShader(vs)
  gl.deleteShader(fs)
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
    const msg = gl.getProgramInfoLog(prog) || 'program link failed'
    gl.deleteProgram(prog)
    throw new Error(msg)
  }
  return prog
}

const initWebGL = () => {
  const canvas = canvasRef.value
  if (!canvas) return false
  try {
    gl = canvas.getContext('webgl2', { antialias: false, alpha: false, depth: false, stencil: false, preserveDrawingBuffer: false })
  } catch {
    gl = null
  }
  if (!gl) return false

  const rectVS = `#version 300 es
  precision highp float;
  layout(location=0) in vec2 a_corner; // 0..1
  layout(location=1) in vec2 i_pos;
  layout(location=2) in vec2 i_size;
  layout(location=3) in vec4 i_fill;
  layout(location=4) in vec4 i_stroke;
  layout(location=5) in float i_borderPx;
  uniform vec2 u_resolution;
  uniform vec2 u_translate;
  uniform float u_zoom;
  out vec2 v_uv;
  out vec4 v_fill;
  out vec4 v_stroke;
  out vec2 v_sizePx;
  out float v_borderPx;
  void main(){
    vec2 world = i_pos + a_corner * i_size;
    vec2 screen = world * u_zoom + u_translate;
    vec2 clip = (screen / u_resolution) * 2.0 - 1.0;
    gl_Position = vec4(clip.x, -clip.y, 0.0, 1.0);
    v_uv = a_corner;
    v_fill = i_fill;
    v_stroke = i_stroke;
    v_sizePx = i_size * u_zoom;
    v_borderPx = i_borderPx;
  }`

  const rectFS = `#version 300 es
  precision highp float;
  in vec2 v_uv;
  in vec4 v_fill;
  in vec4 v_stroke;
  in vec2 v_sizePx;
  in float v_borderPx;
  out vec4 outColor;
  void main(){
    float minSide = max(1.0, min(v_sizePx.x, v_sizePx.y));
    float t = clamp(v_borderPx / minSide, 0.0, 0.25);
    float d = min(min(v_uv.x, 1.0 - v_uv.x), min(v_uv.y, 1.0 - v_uv.y));
    outColor = (d < t) ? v_stroke : v_fill;
  }`

  const lineVS = `#version 300 es
  precision highp float;
  layout(location=0) in vec2 a_pos;
  uniform vec2 u_resolution;
  uniform vec2 u_translate;
  uniform float u_zoom;
  void main(){
    vec2 screen = a_pos * u_zoom + u_translate;
    vec2 clip = (screen / u_resolution) * 2.0 - 1.0;
    gl_Position = vec4(clip.x, -clip.y, 0.0, 1.0);
  }`

  const lineFS = `#version 300 es
  precision highp float;
  uniform vec4 u_color;
  out vec4 outColor;
  void main(){ outColor = u_color; }`

  const rectProgram = createProgram(gl, rectVS, rectFS)
  const lineProgram = createProgram(gl, lineVS, lineFS)

  const rectVAO = gl.createVertexArray()
  if (!rectVAO) return false
  gl.bindVertexArray(rectVAO)
  const cornerBuffer = gl.createBuffer()
  if (!cornerBuffer) return false
  gl.bindBuffer(gl.ARRAY_BUFFER, cornerBuffer)
  // triangle strip (0,0) (1,0) (0,1) (1,1)
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0, 0, 1, 0, 0, 1, 1, 1]), gl.STATIC_DRAW)
  gl.enableVertexAttribArray(0)
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0)

  const rectInstanceBuffer = gl.createBuffer()
  if (!rectInstanceBuffer) return false
  gl.bindBuffer(gl.ARRAY_BUFFER, rectInstanceBuffer)
  gl.bufferData(gl.ARRAY_BUFFER, 0, gl.DYNAMIC_DRAW)
  const stride = (2 + 2 + 4 + 4 + 1) * 4
  let off = 0
  gl.enableVertexAttribArray(1)
  gl.vertexAttribPointer(1, 2, gl.FLOAT, false, stride, off)
  gl.vertexAttribDivisor(1, 1)
  off += 2 * 4
  gl.enableVertexAttribArray(2)
  gl.vertexAttribPointer(2, 2, gl.FLOAT, false, stride, off)
  gl.vertexAttribDivisor(2, 1)
  off += 2 * 4
  gl.enableVertexAttribArray(3)
  gl.vertexAttribPointer(3, 4, gl.FLOAT, false, stride, off)
  gl.vertexAttribDivisor(3, 1)
  off += 4 * 4
  gl.enableVertexAttribArray(4)
  gl.vertexAttribPointer(4, 4, gl.FLOAT, false, stride, off)
  gl.vertexAttribDivisor(4, 1)
  off += 4 * 4
  gl.enableVertexAttribArray(5)
  gl.vertexAttribPointer(5, 1, gl.FLOAT, false, stride, off)
  gl.vertexAttribDivisor(5, 1)

  gl.bindVertexArray(null)

  const lineVAO = gl.createVertexArray()
  if (!lineVAO) return false
  gl.bindVertexArray(lineVAO)
  const lineBuffer = gl.createBuffer()
  if (!lineBuffer) return false
  gl.bindBuffer(gl.ARRAY_BUFFER, lineBuffer)
  gl.bufferData(gl.ARRAY_BUFFER, 0, gl.DYNAMIC_DRAW)
  gl.enableVertexAttribArray(0)
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0)
  gl.bindVertexArray(null)

  glPrograms = {
    rectProgram,
    rectVAO,
    rectInstanceBuffer,
    rectLocs: {
      u_resolution: gl.getUniformLocation(rectProgram, 'u_resolution'),
      u_translate: gl.getUniformLocation(rectProgram, 'u_translate'),
      u_zoom: gl.getUniformLocation(rectProgram, 'u_zoom')
    },
    lineProgram,
    lineVAO,
    lineBuffer,
    lineLocs: {
      u_resolution: gl.getUniformLocation(lineProgram, 'u_resolution'),
      u_translate: gl.getUniformLocation(lineProgram, 'u_translate'),
      u_zoom: gl.getUniformLocation(lineProgram, 'u_zoom'),
      u_color: gl.getUniformLocation(lineProgram, 'u_color')
    }
  }

  gl.disable(gl.DEPTH_TEST)
  gl.disable(gl.CULL_FACE)
  gl.enable(gl.BLEND)
  gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA)
  gl.clearColor(0.043, 0.071, 0.125, 1.0)

  rectCapacity = 0
  lineCapacity = 0
  resizeCanvas()
  return true
}

const pickNodeAt = (world, vp) => {
  const list = toRaw(nodes.value || [])
  const zoom = vp.zoom || 1
  const isFar = zoom < 0.55

  // far: cheap hit test using small radius
  if (isFar) {
    const r = 8 / zoom
    for (let i = list.length - 1; i >= 0; i--) {
      const n = list[i]
      const pos = transientNodePositions.get(n?.id) || n?.position
      if (!pos) continue
      const dx = world.x - pos.x
      const dy = world.y - pos.y
      if (dx * dx + dy * dy <= r * r) return n
    }
    return null
  }

  for (let i = list.length - 1; i >= 0; i--) {
    const n = list[i]
    const pos = transientNodePositions.get(n?.id) || n?.position
    if (!pos) continue
    const { w, h } = getNodeSize(n.type)
    if (world.x >= pos.x && world.x <= pos.x + w && world.y >= pos.y && world.y <= pos.y + h) return n
  }
  return null
}

const render2d = (vp, list, elist) => {
  if (!ctx) return
  const zoom = vp?.zoom || 1

  ctx.clearRect(0, 0, size.w, size.h)
  ctx.fillStyle = '#0b1220'
  ctx.fillRect(0, 0, size.w, size.h)

  const padPx = 180
  const worldMin = toWorld({ x: -padPx, y: -padPx }, vp)
  const worldMax = toWorld({ x: size.w + padPx, y: size.h + padPx }, vp)

  const visible = []
  for (let i = 0; i < list.length; i++) {
    const n = list[i]
    const pos = transientNodePositions.get(n?.id) || n?.position
    if (!pos) continue
    const { w, h } = getNodeSize(n.type)
    if (pos.x > worldMax.x || pos.y > worldMax.y) continue
    if (pos.x + w < worldMin.x || pos.y + h < worldMin.y) continue
    visible.push(n)
  }

  const lodFar = zoom < 0.35
  const lodMid = zoom >= 0.35 && zoom < 0.8
  const drawLabels = zoom >= 0.95 && visible.length <= 900
  const drawEdges = zoom >= 0.75

  if (drawEdges && elist.length > 0) {
    const maxEdges = 2400
    const selectedIds = new Set(visible.filter(n => n?.selected).map(n => n.id))
    const onlySelected = elist.length > maxEdges && selectedIds.size > 0
    const toDraw = onlySelected
      ? elist.filter(e => selectedIds.has(e.source) || selectedIds.has(e.target))
      : (elist.length > maxEdges ? elist.slice(0, maxEdges) : elist)

    const posById = new Map()
    for (const n of visible) posById.set(n.id, transientNodePositions.get(n?.id) || n.position)
    ctx.lineWidth = Math.max(1, 1.5 * zoom)
    ctx.strokeStyle = 'rgba(125, 211, 252, 0.22)'
    ctx.beginPath()
    for (const e of toDraw) {
      const sp = posById.get(e.source)
      const tp = posById.get(e.target)
      if (!sp || !tp) continue
      const s = toScreen({ x: sp.x, y: sp.y }, vp)
      const t = toScreen({ x: tp.x, y: tp.y }, vp)
      ctx.moveTo(s.x, s.y)
      ctx.lineTo(t.x, t.y)
    }
    ctx.stroke()
  }

  for (const n of visible) {
    const pos = transientNodePositions.get(n?.id) || n.position
    const p = toScreen(pos, vp)
    const selected = Boolean(n.selected)

    if (lodFar) {
      ctx.fillStyle = selected ? '#60a5fa' : '#94a3b8'
      ctx.beginPath()
      ctx.arc(p.x, p.y, selected ? 3.2 : 2.2, 0, Math.PI * 2)
      ctx.fill()
      continue
    }

    const { w, h } = getNodeSize(n.type)
    const sw = w * zoom
    const sh = h * zoom
    const rx = p.x
    const ry = p.y

    ctx.fillStyle = selected ? 'rgba(96,165,250,0.18)' : 'rgba(148,163,184,0.10)'
    ctx.strokeStyle = selected ? 'rgba(96,165,250,0.95)' : 'rgba(148,163,184,0.18)'
    ctx.lineWidth = selected ? 2 : 1

    const r = lodMid ? 6 : 10
    roundRect(ctx, rx, ry, sw, sh, r)
    ctx.fill()
    ctx.stroke()

    if (drawLabels) {
      const label = String(n?.data?.label || n.type || '').slice(0, 22)
      if (label) {
        ctx.fillStyle = 'rgba(226,232,240,0.92)'
        ctx.font = `${Math.max(10, Math.min(14, 12 * zoom))}px ui-sans-serif, system-ui`
        ctx.textBaseline = 'top'
        ctx.fillText(label, rx + 10, ry + 10)
      }
    }
  }
}

const ensureRectCapacity = (need) => {
  if (!gl || !glPrograms) return
  if (need <= rectCapacity) return
  rectCapacity = Math.max(need, Math.floor(rectCapacity * 1.5) + 256)
  gl.bindBuffer(gl.ARRAY_BUFFER, glPrograms.rectInstanceBuffer)
  gl.bufferData(gl.ARRAY_BUFFER, rectCapacity * (2 + 2 + 4 + 4 + 1) * 4, gl.DYNAMIC_DRAW)
}

const ensureLineCapacity = (needFloats) => {
  if (!gl || !glPrograms) return
  if (needFloats <= lineCapacity) return
  lineCapacity = Math.max(needFloats, Math.floor(lineCapacity * 1.5) + 2048)
  gl.bindBuffer(gl.ARRAY_BUFFER, glPrograms.lineBuffer)
  gl.bufferData(gl.ARRAY_BUFFER, lineCapacity * 4, gl.DYNAMIC_DRAW)
}

const renderWebGL = (vp, list, elist) => {
  if (!gl || !glPrograms) return

  const canvas = canvasRef.value
  if (!canvas) return

  const zoom = vp.zoom || 1
  const padPx = 180
  const worldMin = toWorld({ x: -padPx, y: -padPx }, vp)
  const worldMax = toWorld({ x: size.w + padPx, y: size.h + padPx }, vp)

  const visible = []
  for (let i = 0; i < list.length; i++) {
    const n = list[i]
    const pos = transientNodePositions.get(n?.id) || n?.position
    if (!pos) continue
    const { w, h } = getNodeSize(n.type)
    if (pos.x > worldMax.x || pos.y > worldMax.y) continue
    if (pos.x + w < worldMin.x || pos.y + h < worldMin.y) continue
    visible.push(n)
  }

  const lodFar = zoom < 0.35
  const drawEdges = zoom >= 0.75

  gl.viewport(0, 0, canvas.width, canvas.height)
  gl.clear(gl.COLOR_BUFFER_BIT)

  // Lines (optional)
  if (drawEdges && elist.length > 0) {
    const maxEdges = 3000
    const selectedIds = new Set(visible.filter(n => n?.selected).map(n => n.id))
    const onlySelected = elist.length > maxEdges && selectedIds.size > 0
    const toDraw = onlySelected
      ? elist.filter(e => selectedIds.has(e.source) || selectedIds.has(e.target))
      : (elist.length > maxEdges ? elist.slice(0, maxEdges) : elist)

    const posById = new Map()
    for (const n of visible) posById.set(n.id, transientNodePositions.get(n?.id) || n.position)

    const floats = toDraw.length * 4
    ensureLineCapacity(floats)
    if (!lineScratch || lineScratch.length < floats) lineScratch = new Float32Array(floats)
    let k = 0
    for (const e of toDraw) {
      const sp = posById.get(e.source)
      const tp = posById.get(e.target)
      if (!sp || !tp) continue
      lineScratch[k++] = sp.x
      lineScratch[k++] = sp.y
      lineScratch[k++] = tp.x
      lineScratch[k++] = tp.y
    }

    gl.useProgram(glPrograms.lineProgram)
    gl.bindVertexArray(glPrograms.lineVAO)
    gl.bindBuffer(gl.ARRAY_BUFFER, glPrograms.lineBuffer)
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, lineScratch.subarray(0, k))
    gl.uniform2f(glPrograms.lineLocs.u_resolution, canvas.width / dpr, canvas.height / dpr)
    gl.uniform2f(glPrograms.lineLocs.u_translate, vp.x, vp.y)
    gl.uniform1f(glPrograms.lineLocs.u_zoom, zoom)
    gl.uniform4f(glPrograms.lineLocs.u_color, 0.49, 0.83, 0.99, 0.18)
    gl.drawArrays(gl.LINES, 0, k / 2)
    gl.bindVertexArray(null)
  }

  // Rects (instanced)
  const instCount = visible.length
  ensureRectCapacity(instCount)
  const strideFloats = 2 + 2 + 4 + 4 + 1
  const needFloats = instCount * strideFloats
  if (!rectScratch || rectScratch.length < needFloats) rectScratch = new Float32Array(needFloats)
  let o = 0
  for (const n of visible) {
    const rawPos = transientNodePositions.get(n?.id) || n.position || { x: 0, y: 0 }
    const { w, h } = getNodeSize(n.type)
    const selected = Boolean(n.selected)

    const dotWorld = 6 / Math.max(0.001, zoom)
    rectScratch[o++] = rawPos.x
    rectScratch[o++] = rawPos.y
    rectScratch[o++] = lodFar ? dotWorld : w
    rectScratch[o++] = lodFar ? dotWorld : h
    // fill
    if (selected) {
      rectScratch[o++] = 0.376
      rectScratch[o++] = 0.647
      rectScratch[o++] = 0.98
      rectScratch[o++] = 0.18
      // stroke
      rectScratch[o++] = 0.376
      rectScratch[o++] = 0.647
      rectScratch[o++] = 0.98
      rectScratch[o++] = 0.95
      rectScratch[o++] = 2
    } else {
      rectScratch[o++] = 0.58
      rectScratch[o++] = 0.64
      rectScratch[o++] = 0.72
      rectScratch[o++] = 0.10
      rectScratch[o++] = 0.58
      rectScratch[o++] = 0.64
      rectScratch[o++] = 0.72
      rectScratch[o++] = 0.20
      rectScratch[o++] = 1
    }
  }

  gl.useProgram(glPrograms.rectProgram)
  gl.bindVertexArray(glPrograms.rectVAO)
  gl.bindBuffer(gl.ARRAY_BUFFER, glPrograms.rectInstanceBuffer)
  gl.bufferSubData(gl.ARRAY_BUFFER, 0, rectScratch.subarray(0, o))
  gl.uniform2f(glPrograms.rectLocs.u_resolution, canvas.width / dpr, canvas.height / dpr)
  gl.uniform2f(glPrograms.rectLocs.u_translate, vp.x, vp.y)
  gl.uniform1f(glPrograms.rectLocs.u_zoom, zoom)
  gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, instCount)
  gl.bindVertexArray(null)
}

const render = (ts) => {
  raf = requestAnimationFrame(render)
  if (!ctx && !gl) return

  fpsFrames += 1
  if (ts - fpsLastTs >= 500) {
    fps.value = Math.round((fpsFrames * 1000) / (ts - fpsLastTs))
    fpsFrames = 0
    fpsLastTs = ts
  }

  const baseVp = effectiveViewport.value || { x: 0, y: 0, zoom: 1 }
  const vp = transientViewport || baseVp
  const list = toRaw(nodes.value || [])
  const elist = toRaw(edges.value || [])

  if (gl) renderWebGL(vp, list, elist)
  else render2d(vp, list, elist)
}

const roundRect = (ctx, x, y, w, h, r) => {
  const rr = Math.max(0, Math.min(r, Math.min(w, h) / 2))
  ctx.beginPath()
  ctx.moveTo(x + rr, y)
  ctx.arcTo(x + w, y, x + w, y + h, rr)
  ctx.arcTo(x + w, y + h, x, y + h, rr)
  ctx.arcTo(x, y + h, x, y, rr)
  ctx.arcTo(x, y, x + w, y, rr)
  ctx.closePath()
}

const onPointerDown = (ev) => {
  if (!canvasRef.value) return
  canvasRef.value.setPointerCapture(ev.pointerId)
  dragging.value = true
  lastPointer = getLocalPoint(ev)
  transientViewport = { ...(canvasViewport.value || { x: 0, y: 0, zoom: 1 }) }
  const vp = transientViewport
  const local = getLocalPoint(ev)
  const world = toWorld(local, { ...vp, x: vp.x, y: vp.y })
  const hit = pickNodeAt(world, vp)
  if (hit?.id) {
    draggingNodeId = hit.id
    const pos = transientNodePositions.get(hit.id) || hit.position || { x: 0, y: 0 }
    dragOffset = { x: world.x - pos.x, y: world.y - pos.y }
    // Best-effort selection highlight (one-time store update) | 尽量保留选中高亮（仅一次 store 更新）
    try { updateNode(hit.id, { selected: true }) } catch { /* ignore */ }
  } else {
    draggingNodeId = null
  }
}

const onPointerMove = (ev) => {
  if (!dragging.value || !lastPointer) return
  const vp = transientViewport || canvasViewport.value || { x: 0, y: 0, zoom: 1 }
  const local = getLocalPoint(ev)
  const dx = local.x - lastPointer.x
  const dy = local.y - lastPointer.y
  lastPointer = local

  if (draggingNodeId) {
    const world = toWorld(local, vp)
    const nextPos = { x: world.x - dragOffset.x, y: world.y - dragOffset.y }
    transientNodePositions.set(draggingNodeId, nextPos)
  } else {
    if (!transientViewport) transientViewport = { ...vp }
    transientViewport.x = vp.x + dx
    transientViewport.y = vp.y + dy
  }
}

const onPointerUp = (ev) => {
  if (!dragging.value) return
  dragging.value = false
  if (draggingNodeId && transientNodePositions.has(draggingNodeId)) {
    const pos = transientNodePositions.get(draggingNodeId)
    transientNodePositions.delete(draggingNodeId)
    if (pos) updateNode(draggingNodeId, { position: pos })
  }
  if (transientViewport) {
    updateViewport(transientViewport)
    transientViewport = null
  }
  draggingNodeId = null
  lastPointer = null
  try { canvasRef.value?.releasePointerCapture(ev.pointerId) } catch {}
}

const onWheel = (ev) => {
  ev.preventDefault()
  const vp = transientViewport || canvasViewport.value || { x: 0, y: 0, zoom: 1 }
  const zoom = vp.zoom || 1
  const dir = ev.deltaY > 0 ? -1 : 1
  const factor = dir > 0 ? 1.08 : 1 / 1.08
  const nextZoom = clampZoom(zoom * factor)
  const mouse = getLocalPoint(ev)
  const before = toWorld(mouse, vp)
  const nextVp = { ...vp, zoom: nextZoom }
  const after = toWorld(mouse, nextVp)
  const nx = vp.x + (after.x - before.x) * nextZoom
  const ny = vp.y + (after.y - before.y) * nextZoom
  transientViewport = { x: nx, y: ny, zoom: nextZoom }
  if (wheelCommitTimer) clearTimeout(wheelCommitTimer)
  wheelCommitTimer = setTimeout(() => {
    wheelCommitTimer = 0
    if (transientViewport) {
      updateViewport(transientViewport)
      transientViewport = null
    }
  }, 120)
}

onMounted(() => {
  resizeCanvas()
  window.addEventListener('resize', resizeCanvas)
  const canvas = canvasRef.value
  // Try WebGL2 first; fallback to Canvas2D
  if (initWebGL()) {
    ctx = null
  } else {
    gl = null
  }
  if (canvas && props.interactive) {
    canvas.addEventListener('pointerdown', onPointerDown, { passive: true })
    canvas.addEventListener('pointermove', onPointerMove, { passive: true })
    canvas.addEventListener('pointerup', onPointerUp, { passive: true })
    canvas.addEventListener('pointercancel', onPointerUp, { passive: true })
    canvas.addEventListener('wheel', onWheel, { passive: false })
  }
  raf = requestAnimationFrame(render)
})

onUnmounted(() => {
  window.removeEventListener('resize', resizeCanvas)
  const canvas = canvasRef.value
  if (canvas && props.interactive) {
    canvas.removeEventListener('pointerdown', onPointerDown)
    canvas.removeEventListener('pointermove', onPointerMove)
    canvas.removeEventListener('pointerup', onPointerUp)
    canvas.removeEventListener('pointercancel', onPointerUp)
    canvas.removeEventListener('wheel', onWheel)
  }
  if (raf) cancelAnimationFrame(raf)
  if (wheelCommitTimer) clearTimeout(wheelCommitTimer)
})

watch(
  () => canvasViewport.value?.zoom,
  () => {
    // Recompute DPR when zoom changes a lot (helps crispness on some monitors)
    dpr = Math.max(1, Math.min(2, window.devicePixelRatio || 1))
  }
)
</script>

<style scoped>
.hp-canvas-root {
  position: absolute;
  inset: 0;
  overflow: hidden;
}

.hp-canvas {
  display: block;
  width: 100%;
  height: 100%;
  touch-action: none;
}

.hp-hud {
  position: absolute;
  left: 12px;
  bottom: 12px;
  pointer-events: none;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.hp-hud-row {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.hp-pill {
  background: rgba(15, 23, 42, 0.75);
  border: 1px solid rgba(148, 163, 184, 0.18);
  color: rgba(226, 232, 240, 0.9);
  font-size: 12px;
  padding: 6px 10px;
  border-radius: 999px;
  backdrop-filter: blur(10px);
}

.hp-hint {
  color: rgba(226, 232, 240, 0.72);
  font-size: 12px;
}
</style>
