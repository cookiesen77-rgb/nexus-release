/**
 * Camera 3D Controller
 * 使用 OrbitControls 让用户直接作为相机围绕主体旋转
 * 参考 TapNow 的交互设计
 */

import { useEffect, useRef, useCallback, useState } from 'react'
import * as THREE from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import { RotateCcw, Move, ZoomIn } from 'lucide-react'
import type { CameraParams } from '@/lib/cameraControl/promptBuilder'
import { DEFAULT_CAMERA_PARAMS } from '@/lib/cameraControl/promptBuilder'

type Props = {
  imageUrl?: string
  value: CameraParams
  onChange: (params: CameraParams) => void
  disabled?: boolean
}

// 根据角度生成视角描述
function getViewDescription(azimuth: number, polar: number, distance: number): string {
  const parts: string[] = []

  // 俯仰角度描述
  if (polar < 45) {
    parts.push('俯视')
  } else if (polar > 135) {
    parts.push('仰视')
  } else if (polar < 70) {
    parts.push('高角度')
  } else if (polar > 110) {
    parts.push('低角度')
  }

  // 水平方位描述
  const absAzimuth = Math.abs(azimuth)
  if (absAzimuth < 15) {
    parts.push('正面')
  } else if (absAzimuth > 165) {
    parts.push('背面')
  } else if (absAzimuth > 75 && absAzimuth < 105) {
    parts.push(azimuth > 0 ? '左侧' : '右侧')
  } else if (absAzimuth >= 15 && absAzimuth <= 75) {
    parts.push(azimuth > 0 ? '左前方' : '右前方')
  } else {
    parts.push(azimuth > 0 ? '左后方' : '右后方')
  }

  // 距离描述
  if (distance < 2) {
    parts.push('特写')
  } else if (distance < 3.5) {
    parts.push('中景')
  } else {
    parts.push('远景')
  }

  return parts.join(' · ')
}

export default function Camera3DController({ imageUrl, value, onChange, disabled }: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const sceneDataRef = useRef<{
    scene: THREE.Scene
    camera: THREE.PerspectiveCamera
    renderer: THREE.WebGLRenderer
    controls: OrbitControls
    imagePlane: THREE.Mesh
  } | null>(null)
  const frameRef = useRef<number>(0)

  const [localParams, setLocalParams] = useState(value)
  const [viewDesc, setViewDesc] = useState('')
  const isUpdatingFromProps = useRef(false)

  // 同步外部值到控件
  useEffect(() => {
    const data = sceneDataRef.current
    if (!data || isUpdatingFromProps.current) return

    isUpdatingFromProps.current = true

    // 从参数计算相机位置
    const azimuthRad = THREE.MathUtils.degToRad(-value.rotateAngle)
    const polarRad = THREE.MathUtils.degToRad(90 - value.verticalAngle * 60) // -1~1 映射到 30°~150°
    const distance = 5 - value.moveForward * 0.4 // 0~10 映射到 5~1

    const x = distance * Math.sin(polarRad) * Math.sin(azimuthRad)
    const y = distance * Math.cos(polarRad)
    const z = distance * Math.sin(polarRad) * Math.cos(azimuthRad)

    data.camera.position.set(x, y, z)
    data.controls.update()

    setLocalParams(value)
    isUpdatingFromProps.current = false
  }, [value])

  // 从相机位置提取参数
  const extractParamsFromCamera = useCallback((camera: THREE.PerspectiveCamera) => {
    const pos = camera.position
    const distance = pos.length()

    // 计算球坐标
    const polarRad = Math.acos(pos.y / distance)
    const azimuthRad = Math.atan2(pos.x, pos.z)

    // 转换为参数
    const rotateAngle = Math.round(-THREE.MathUtils.radToDeg(azimuthRad))
    const verticalAngle = Math.round(((90 - THREE.MathUtils.radToDeg(polarRad)) / 60) * 100) / 100
    const moveForward = Math.round((5 - distance) / 0.4 * 10) / 10

    return {
      rotateAngle: ((rotateAngle % 360) + 360) % 360 > 180
        ? ((rotateAngle % 360) + 360) % 360 - 360
        : ((rotateAngle % 360) + 360) % 360,
      verticalAngle: Math.max(-1, Math.min(1, verticalAngle)),
      moveForward: Math.max(0, Math.min(10, moveForward)),
      wideAngle: localParams.wideAngle
    }
  }, [localParams.wideAngle])

  // 初始化场景
  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    const w = container.clientWidth || 400
    const h = container.clientHeight || 300

    // Scene
    const scene = new THREE.Scene()
    scene.background = new THREE.Color(0x1a1a1a)

    // Camera
    const camera = new THREE.PerspectiveCamera(50, w / h, 0.1, 100)

    // 从初始参数设置相机位置
    const azimuthRad = THREE.MathUtils.degToRad(-value.rotateAngle)
    const polarRad = THREE.MathUtils.degToRad(90 - value.verticalAngle * 60)
    const distance = 5 - value.moveForward * 0.4
    camera.position.set(
      distance * Math.sin(polarRad) * Math.sin(azimuthRad),
      distance * Math.cos(polarRad),
      distance * Math.sin(polarRad) * Math.cos(azimuthRad)
    )

    // Renderer
    const renderer = new THREE.WebGLRenderer({ antialias: true })
    renderer.setSize(w, h)
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    container.appendChild(renderer.domElement)

    // OrbitControls
    const controls = new OrbitControls(camera, renderer.domElement)
    controls.enableDamping = true
    controls.dampingFactor = 0.08
    controls.enablePan = false
    controls.minDistance = 1
    controls.maxDistance = 6
    controls.minPolarAngle = THREE.MathUtils.degToRad(20)  // 限制最大俯视
    controls.maxPolarAngle = THREE.MathUtils.degToRad(160) // 限制最大仰视
    controls.target.set(0, 0, 0)

    // Lights
    scene.add(new THREE.AmbientLight(0xffffff, 0.9))
    const light = new THREE.DirectionalLight(0xffffff, 0.5)
    light.position.set(5, 5, 5)
    scene.add(light)

    // 地面参考网格
    const gridHelper = new THREE.GridHelper(4, 8, 0x333333, 0x222222)
    gridHelper.position.y = -0.8
    scene.add(gridHelper)

    // 坐标轴指示（小型）
    const axisLength = 0.3
    const axisOffset = -0.75

    // X轴 (红)
    const xAxis = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(-1.5, axisOffset, -1.5),
        new THREE.Vector3(-1.5 + axisLength, axisOffset, -1.5)
      ]),
      new THREE.LineBasicMaterial({ color: 0xef4444 })
    )
    scene.add(xAxis)

    // Y轴 (绿)
    const yAxis = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(-1.5, axisOffset, -1.5),
        new THREE.Vector3(-1.5, axisOffset + axisLength, -1.5)
      ]),
      new THREE.LineBasicMaterial({ color: 0x22c55e })
    )
    scene.add(yAxis)

    // Z轴 (蓝)
    const zAxis = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(-1.5, axisOffset, -1.5),
        new THREE.Vector3(-1.5, axisOffset, -1.5 + axisLength)
      ]),
      new THREE.LineBasicMaterial({ color: 0x3b82f6 })
    )
    scene.add(zAxis)

    // 图片平面（主体）
    const planeGeo = new THREE.PlaneGeometry(1.6, 1.6)
    const planeMat = new THREE.MeshBasicMaterial({
      color: 0x333333,
      side: THREE.DoubleSide
    })
    const imagePlane = new THREE.Mesh(planeGeo, planeMat)
    scene.add(imagePlane)

    // 图片边框
    const borderGeo = new THREE.EdgesGeometry(planeGeo)
    const borderMat = new THREE.LineBasicMaterial({ color: 0x666666 })
    const border = new THREE.LineSegments(borderGeo, borderMat)
    imagePlane.add(border)

    sceneDataRef.current = {
      scene,
      camera,
      renderer,
      controls,
      imagePlane
    }

    // 控件变化时更新参数
    const handleControlChange = () => {
      if (disabled || isUpdatingFromProps.current) return

      const params = extractParamsFromCamera(camera)
      setLocalParams(params)

      // 更新视角描述
      const distance = camera.position.length()
      const polarDeg = THREE.MathUtils.radToDeg(Math.acos(camera.position.y / distance))
      const azimuthDeg = THREE.MathUtils.radToDeg(Math.atan2(camera.position.x, camera.position.z))
      setViewDesc(getViewDescription(-azimuthDeg, polarDeg, distance))
    }

    const handleControlEnd = () => {
      if (disabled || isUpdatingFromProps.current) return
      const params = extractParamsFromCamera(camera)
      onChange(params)
    }

    controls.addEventListener('change', handleControlChange)
    controls.addEventListener('end', handleControlEnd)

    // 动画循环
    const animate = () => {
      frameRef.current = requestAnimationFrame(animate)
      controls.update()
      renderer.render(scene, camera)
    }
    animate()

    // 初始视角描述
    handleControlChange()

    // Resize
    const handleResize = () => {
      const nw = container.clientWidth || 400
      const nh = container.clientHeight || 300
      camera.aspect = nw / nh
      camera.updateProjectionMatrix()
      renderer.setSize(nw, nh)
    }
    window.addEventListener('resize', handleResize)

    return () => {
      window.removeEventListener('resize', handleResize)
      controls.removeEventListener('change', handleControlChange)
      controls.removeEventListener('end', handleControlEnd)
      cancelAnimationFrame(frameRef.current)
      controls.dispose()
      renderer.dispose()
      if (container.contains(renderer.domElement)) {
        container.removeChild(renderer.domElement)
      }
      sceneDataRef.current = null
    }
  }, [])

  // 加载图片
  useEffect(() => {
    const data = sceneDataRef.current
    if (!imageUrl || !data) return

    const loader = new THREE.TextureLoader()
    loader.load(imageUrl, (texture) => {
      const mat = data.imagePlane.material as THREE.MeshBasicMaterial
      mat.map = texture
      mat.color.set(0xffffff)
      mat.needsUpdate = true

      // 调整比例
      const ar = texture.image.width / texture.image.height
      if (ar > 1) {
        data.imagePlane.scale.set(1, 1 / ar, 1)
      } else {
        data.imagePlane.scale.set(ar, 1, 1)
      }
    })
  }, [imageUrl])

  // 禁用时禁用控件
  useEffect(() => {
    const data = sceneDataRef.current
    if (data) {
      data.controls.enabled = !disabled
    }
  }, [disabled])

  // 重置
  const handleReset = () => {
    const data = sceneDataRef.current
    if (!data) return

    // 重置相机位置到默认
    data.camera.position.set(0, 0, 5)
    data.controls.update()

    setLocalParams(DEFAULT_CAMERA_PARAMS)
    onChange(DEFAULT_CAMERA_PARAMS)
  }

  // 滑块更新
  const handleSliderChange = (key: keyof CameraParams, val: number) => {
    const newParams = { ...localParams, [key]: val }
    setLocalParams(newParams)

    const data = sceneDataRef.current
    if (data) {
      isUpdatingFromProps.current = true
      const azimuthRad = THREE.MathUtils.degToRad(-newParams.rotateAngle)
      const polarRad = THREE.MathUtils.degToRad(90 - newParams.verticalAngle * 60)
      const distance = 5 - newParams.moveForward * 0.4

      data.camera.position.set(
        distance * Math.sin(polarRad) * Math.sin(azimuthRad),
        distance * Math.cos(polarRad),
        distance * Math.sin(polarRad) * Math.cos(azimuthRad)
      )
      data.controls.update()
      isUpdatingFromProps.current = false
    }

    onChange(newParams)
  }

  return (
    <div className="flex flex-col h-full">
      {/* 3D 视图 */}
      <div className="relative flex-1 min-h-[200px]">
        <div
          ref={containerRef}
          className={`absolute inset-0 rounded-lg overflow-hidden ${
            disabled ? 'opacity-50 pointer-events-none' : ''
          }`}
        />
        {/* 视角描述浮层 */}
        {viewDesc && (
          <div className="absolute top-2 left-2 px-2 py-1 rounded bg-black/60 text-xs text-white/80">
            {viewDesc}
          </div>
        )}
        {/* 操作提示 */}
        <div className="absolute bottom-2 right-2 px-2 py-1 rounded bg-black/60 text-[10px] text-white/60">
          <Move className="inline h-3 w-3 mr-1" />
          拖拽旋转
          <ZoomIn className="inline h-3 w-3 mx-1 ml-2" />
          滚轮缩放
        </div>
      </div>

      {/* 控制面板 */}
      <div className="mt-3 p-3 bg-[var(--bg-primary)] rounded-lg space-y-3">
        {/* 参数显示 */}
        <div className="grid grid-cols-3 gap-2 text-center text-xs">
          <div className="bg-[var(--bg-secondary)] rounded-lg p-2">
            <div className="text-green-400 font-medium">{localParams.rotateAngle}°</div>
            <div className="text-[var(--text-secondary)] text-[10px]">水平旋转</div>
          </div>
          <div className="bg-[var(--bg-secondary)] rounded-lg p-2">
            <div className="text-pink-400 font-medium">{(localParams.verticalAngle * 100).toFixed(0)}%</div>
            <div className="text-[var(--text-secondary)] text-[10px]">俯仰角度</div>
          </div>
          <div className="bg-[var(--bg-secondary)] rounded-lg p-2">
            <div className="text-yellow-400 font-medium">{localParams.moveForward.toFixed(1)}</div>
            <div className="text-[var(--text-secondary)] text-[10px]">推进距离</div>
          </div>
        </div>

        {/* 滑块控制 - 双向绑定 */}
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <span className="text-[10px] text-green-400 w-12">旋转</span>
            <input
              type="range"
              min="-180"
              max="180"
              value={localParams.rotateAngle}
              onChange={(e) => handleSliderChange('rotateAngle', parseInt(e.target.value))}
              disabled={disabled}
              className="flex-1 h-1 accent-green-500"
            />
          </div>
          <div className="flex items-center gap-2">
            <span className="text-[10px] text-pink-400 w-12">俯仰</span>
            <input
              type="range"
              min="-100"
              max="100"
              value={localParams.verticalAngle * 100}
              onChange={(e) => handleSliderChange('verticalAngle', parseInt(e.target.value) / 100)}
              disabled={disabled}
              className="flex-1 h-1 accent-pink-500"
            />
          </div>
          <div className="flex items-center gap-2">
            <span className="text-[10px] text-yellow-400 w-12">推进</span>
            <input
              type="range"
              min="0"
              max="100"
              value={localParams.moveForward * 10}
              onChange={(e) => handleSliderChange('moveForward', parseInt(e.target.value) / 10)}
              disabled={disabled}
              className="flex-1 h-1 accent-yellow-500"
            />
          </div>
        </div>

        {/* 重置按钮 */}
        <div className="flex justify-end">
          <button
            onClick={handleReset}
            disabled={disabled}
            className="flex items-center gap-1 px-2 py-1 text-[10px] text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors"
          >
            <RotateCcw className="h-3 w-3" />
            重置视角
          </button>
        </div>
      </div>
    </div>
  )
}
