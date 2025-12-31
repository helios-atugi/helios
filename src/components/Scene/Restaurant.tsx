// src/components/Scene/Restaurant.tsx
import * as React from 'react'
import * as THREE from 'three'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useThree, useFrame } from '@react-three/fiber'
import { OrbitControls, Edges } from '@react-three/drei'
import type { Config, Side, LiveStats } from '../../App'

/* ---------- utils & colors ---------- */
const clamp = (v: number, min: number, max: number) =>
  Math.min(Math.max(v, min), max)

const isFiniteNumber = (v: unknown): v is number =>
  typeof v === 'number' && Number.isFinite(v)

// 全体をホログラム寄りの配色に寄せる
const COL = {
  bg: '#020617',
  floorBase: '#020617',
  floorGrid: '#0f172a',
  wall: '#111827',
  ring: '#22d3ee',
  door: '#38bdf8',
  kitchen: '#f97316',
  toilet: '#3b82f6',
  table2: '#e5f1ff',
  table4: '#0b2d5c',
  person: '#ffffff',
  staff: '#ff4d4d',
}

/* ---------- scene basics ---------- */
function SceneSettings() {
  const { gl, camera, scene } = useThree()
  useEffect(() => {
    gl.outputColorSpace = THREE.SRGBColorSpace
    gl.toneMapping = THREE.ACESFilmicToneMapping
    gl.shadowMap.enabled = true
    gl.shadowMap.type = THREE.PCFSoftShadowMap
    gl.setPixelRatio(Math.min(window.devicePixelRatio, 1.5))

    camera.near = 0.15
    camera.far = 80
    camera.position.set(0, 3.2, 7)
    camera.lookAt(0, 1.3, 0)
    camera.updateProjectionMatrix()

    scene.background = new THREE.Color(COL.bg)
  }, [gl, camera, scene])
  return null
}

function FullscreenControls() {
  const { gl } = useThree()
  const toggle = useCallback(() => {
    const el = gl.domElement as any
    if (!document.fullscreenElement)
      (el.requestFullscreen ||
        (el as any).webkitRequestFullscreen ||
        (el as any).msRequestFullscreen)?.call(el)
    else document.exitFullscreen?.()
  }, [gl])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key.toLowerCase() === 'f' && toggle()
    const onDbl = () => toggle()
    window.addEventListener('keydown', onKey)
    gl.domElement.addEventListener('dblclick', onDbl)
    return () => {
      window.removeEventListener('keydown', onKey)
      gl.domElement.removeEventListener('dblclick', onDbl)
    }
  }, [gl, toggle])
  return null
}

// ▼ 光源：真上から落とす＋少しだけ環境光
function Lights() {
  const ref = useRef<THREE.DirectionalLight>(null)
  useEffect(() => {
    if (ref.current) {
      ref.current.shadow.bias = -0.0003
      ref.current.shadow.normalBias = 0.02
    }
  }, [])

  return (
    <>
      <hemisphereLight args={['#e0f2fe', '#020617', 0.55]} />
      <directionalLight
        ref={ref}
        position={[0, 8, 0]}
        intensity={1.1}
        castShadow
        shadow-mapSize-width={2048}
        shadow-mapSize-height={2048}
      />
    </>
  )
}

// ▼ 床：暗い面 ＋ シアンのワイヤーフレームグリッドでホログラム感
function Floor({ width, depth }: { width: number; depth: number }) {
  const size = Math.max(width, depth) * 3

  return (
    <group rotation={[-Math.PI / 2, 0, 0]}>
      {/* ベース */}
      <mesh receiveShadow>
        <planeGeometry args={[size, size]} />
        <meshStandardMaterial color={COL.floorBase} roughness={0.95} />
      </mesh>

      {/* ネオングリッド層（ほんの少し浮かせる） */}
      <mesh position={[0, 0.002, 0]}>
        <planeGeometry args={[size, size, 40, 40]} />
        <meshBasicMaterial
          color={COL.ring}
          wireframe
          transparent
          opacity={0.18}
          toneMapped={false}
        />
      </mesh>
    </group>
  )
}

/* ---------- walls & door (FIXED / COMPLETE) ---------- */

// 壁用のホログラムマテリアル
function HoloWallMaterial({ color }: { color: string }) {
  return (
    <meshPhysicalMaterial
      color={color}
      roughness={0.25}
      metalness={0.3}
      clearcoat={0.4}
      clearcoatRoughness={0.6}
      transparent
      opacity={0.42}
      emissive={COL.ring}
      emissiveIntensity={0.22}
    />
  )
}

// 厨房・トイレ用
function HoloPanelMaterial({ color }: { color: string }) {
  return (
    <meshPhysicalMaterial
      color={color}
      roughness={0.25}
      metalness={0.35}
      clearcoat={0.5}
      clearcoatRoughness={0.7}
      transparent
      opacity={0.52}
      emissive={color}
      emissiveIntensity={0.65}
      toneMapped={false}
    />
  )
}

function BoxWall({
  w,
  h,
  t,
  position,
}: {
  w: number
  h: number
  t: number
  position: [number, number, number]
}) {
  return (
    <mesh position={position} castShadow receiveShadow>
      <boxGeometry args={[w, h, t]} />
      <HoloWallMaterial color={COL.wall} />
      <Edges scale={1.001} color={COL.ring} transparent opacity={0.33} />
    </mesh>
  )
}

/**
 * ✅ 壁にドア開口を作る（3分割：左 / 右 / 上）
 * ドアの基準：
 *  - doorLeft: 左端からの距離（m）
 *  - ドアは床（y=0）からdoorHeight分の高さで開口
 *  - wall は position が [0, height/2, z] で床上に立つ前提
 */
function WallWithDoor({
  width,
  height,
  thickness,
  doorWidth,
  doorHeight,
  doorLeft,
  position,
}: {
  width: number
  height: number
  thickness: number
  doorWidth: number
  doorHeight: number
  doorLeft: number
  position: [number, number, number]
}) {
  // 安全クランプ
  const dw = clamp(doorWidth, 0.2, Math.max(0.2, width - 0.2))
  const dh = clamp(doorHeight, 0.4, Math.max(0.4, height - 0.02))
  const left = clamp(doorLeft, 0, Math.max(0, width - dw))
  const right = Math.max(0, width - left - dw)
  const topH = Math.max(0, height - dh)

  // ローカル座標（wall中心が原点）
  const xLeftCenter = -width / 2 + left / 2
  const xRightCenter = width / 2 - right / 2
  const xDoorCenter = -width / 2 + left + dw / 2

  // 下端が -height/2、床はワールドで y=0（wallは position.y=height/2）
  const yTopCenter = -height / 2 + dh + topH / 2

  return (
    <group position={position as any}>
      {left > 1e-4 && (
        <mesh position={[xLeftCenter, 0, 0]} castShadow receiveShadow>
          <boxGeometry args={[left, height, thickness]} />
          <HoloWallMaterial color={COL.wall} />
          <Edges scale={1.001} color={COL.ring} transparent opacity={0.33} />
        </mesh>
      )}

      {right > 1e-4 && (
        <mesh position={[xRightCenter, 0, 0]} castShadow receiveShadow>
          <boxGeometry args={[right, height, thickness]} />
          <HoloWallMaterial color={COL.wall} />
          <Edges scale={1.001} color={COL.ring} transparent opacity={0.33} />
        </mesh>
      )}

      {topH > 1e-4 && (
        <mesh position={[xDoorCenter, yTopCenter, 0]} castShadow receiveShadow>
          <boxGeometry args={[dw, topH, thickness]} />
          <HoloWallMaterial color={COL.wall} />
          <Edges scale={1.001} color={COL.ring} transparent opacity={0.33} />
        </mesh>
      )}

      {/* 開口の枠線（見やすさ用） */}
      <mesh
        position={[xDoorCenter, -height / 2 + dh / 2, thickness / 2 + 0.001]}
        renderOrder={3}
      >
        <boxGeometry args={[dw, dh, 0.02]} />
        <meshBasicMaterial transparent opacity={0} />
        <Edges scale={1.001} color={COL.ring} transparent opacity={0.55} />
      </mesh>
    </group>
  )
}

/**
 * ✅ ドア板（ドラッグで左右移動）
 * “壁と同じZ面”でレイキャストするようにして、ズレを起こさない
 */
function DraggableDoor({
  wallZ,
  roomWidth,
  doorWidth,
  doorHeight,
  wallT,
  doorLeft,
  setDoorLeft,
}: {
  wallZ: number
  roomWidth: number
  doorWidth: number
  doorHeight: number
  wallT: number
  doorLeft: number
  setDoorLeft: (v: number) => void
}) {
  const controls = useThree((s) => (s as any).controls) as any
  const dragging = useRef(false)
  const tmp = useMemo(() => new THREE.Vector3(), [])
  const offsetX = useRef(0)

  const m = 0.1
  const clampLeft = (v: number) =>
    clamp(v, m, Math.max(m, roomWidth - doorWidth - m))

  // ドア板は「室内側の面」に置く（wall中心 + t/2）
  const doorZ = wallZ + wallT / 2 + 0.02

  // intersectPlane 用：ドア板と同じZ面
  const plane = useMemo(
    () => new THREE.Plane(new THREE.Vector3(0, 0, 1), -doorZ),
    [doorZ],
  )

  const centerFromLeft = (left: number) =>
    -roomWidth / 2 + left + doorWidth / 2
  const leftFromCenter = (cx: number) => cx + roomWidth / 2 - doorWidth / 2

  const onDown = (e: any) => {
    e.stopPropagation()
    e.target.setPointerCapture?.(e.pointerId)
    dragging.current = true
    controls && (controls.enabled = false)
    document.body.style.cursor = 'grabbing'
    if (e.ray.intersectPlane(plane, tmp)) {
      const curCenter = centerFromLeft(doorLeft)
      offsetX.current = curCenter - tmp.x
    }
  }
  const onUp = (e: any) => {
    e.stopPropagation()
    e.target.releasePointerCapture?.(e.pointerId)
    dragging.current = false
    controls && (controls.enabled = true)
    document.body.style.cursor = 'auto'
  }
  const onMove = (e: any) => {
    if (!dragging.current) return
    if (e.ray.intersectPlane(plane, tmp)) {
      const cx = tmp.x + offsetX.current
      let left = leftFromCenter(cx)
      left = Math.round(left / 0.05) * 0.05
      setDoorLeft(clampLeft(left))
    }
  }

  const xCenter = centerFromLeft(doorLeft)

  return (
    <group position={[xCenter, doorHeight / 2, doorZ]}>
      <mesh
        onPointerDown={onDown}
        onPointerUp={onUp}
        onPointerMove={onMove}
        onPointerOver={() => (document.body.style.cursor = 'grab')}
        onPointerOut={() =>
          !dragging.current && (document.body.style.cursor = 'auto')
        }
        castShadow
        receiveShadow
      >
        <boxGeometry args={[doorWidth, doorHeight, 0.03]} />
        <meshPhysicalMaterial
          color={COL.door}
          roughness={0.25}
          metalness={0.12}
          clearcoat={0.6}
          clearcoatRoughness={0.7}
          transparent
          opacity={0.55}
          emissive={COL.door}
          emissiveIntensity={0.4}
          toneMapped={false}
        />
        <Edges scale={1.001} color={COL.ring} transparent opacity={0.55} />
      </mesh>
    </group>
  )
}

/* ---------- tables (drag) ---------- */
type RoomInner = { minX: number; maxX: number; minZ: number; maxZ: number }
type TableSize = { w: number; d: number; h: number }

const SIZE_TWO: TableSize = { w: 1.0, d: 0.7, h: 0.75 }
const SIZE_FOUR: TableSize = { w: 1.2, d: 0.75, h: 0.75 }
const CLEARANCE = 0.06

export type TableTransform = {
  id: number
  x: number
  z: number
  rotY: number
  size: TableSize
}
export type CircleObstacle = { x: number; z: number; r: number }

type TableState = { pos: [number, number, number]; rotY: number }
type SeatAnchor = {
  id: number
  x: number
  z: number
  dir: number
  tableId: number
  tableCap: 2 | 4
}

const radiusOf = (s: TableSize) => 0.5 * Math.sqrt(s.w * s.w + s.d * s.d)

function rectExtents(size: { w: number; d: number }, theta: number) {
  const hw = size.w / 2
  const hd = size.d / 2
  const c = Math.cos(theta)
  const s = Math.sin(theta)
  return {
    ex: Math.abs(hw * c) + Math.abs(hd * s),
    ez: Math.abs(hw * s) + Math.abs(hd * c),
  }
}

function clampPosToRoom(
  x: number,
  z: number,
  size: { w: number; d: number },
  th: number,
  room: RoomInner,
) {
  const { ex, ez } = rectExtents(size, th)
  return [
    clamp(x, room.minX + ex, room.maxX - ex),
    clamp(z, room.minZ + ez, room.maxZ - ez),
  ] as const
}

function isAngleFeasible(
  size: { w: number; d: number },
  th: number,
  room: RoomInner,
) {
  const { ex, ez } = rectExtents(size, th)
  const halfW = (room.maxX - room.minX) / 2
  const halfD = (room.maxZ - room.minZ) / 2
  return ex <= halfW && ez <= halfD
}

function DraggableTable({
  index,
  state,
  size,
  color,
  roomInner,
  selected,
  onSelect,
  onMoveClamped,
  onRotateClamped,
  grid = 0.1,
}: {
  index: number
  state: TableState
  size: TableSize
  color: string
  roomInner: RoomInner
  selected: boolean
  onSelect: (i: number) => void
  onMoveClamped: (index: number, nextPos: [number, number, number]) => void
  onRotateClamped: (
    index: number,
    nextRotY: number,
    nextPos: [number, number, number],
  ) => void
  grid?: number
}) {
  const controls = useThree((s) => (s as any).controls) as any
  const [dragging, setDragging] = useState(false)
  const floorPlane = useMemo(
    () => new THREE.Plane(new THREE.Vector3(0, 1, 0), 0),
    [],
  )
  const tmp = useMemo(() => new THREE.Vector3(), [])
  const offset = useRef(new THREE.Vector2(0, 0))

  const onPointerDown = (e: any) => {
    e.stopPropagation()
    onSelect(index)
    if (e.ray.intersectPlane(floorPlane, tmp)) {
      offset.current.set(state.pos[0] - tmp.x, state.pos[2] - tmp.z)
    }
    e.target.setPointerCapture?.(e.pointerId)
    setDragging(true)
    controls && (controls.enabled = false)
    document.body.style.cursor = 'grabbing'
  }

  const onPointerUp = (e: any) => {
    e.stopPropagation()
    e.target.releasePointerCapture?.(e.pointerId)
    setDragging(false)
    controls && (controls.enabled = true)
    document.body.style.cursor = 'auto'
  }

  const onPointerMove = (e: any) => {
    if (!dragging) return
    if (e.ray.intersectPlane(floorPlane, tmp)) {
      const rawX = Math.round((tmp.x + offset.current.x) / grid) * grid
      const rawZ = Math.round((tmp.z + offset.current.y) / grid) * grid
      const [cx, cz] = clampPosToRoom(rawX, rawZ, size, state.rotY, roomInner)
      onMoveClamped(index, [cx, state.pos[1], cz])
    }
  }

  const onWheel = (e: any) => {
    if (!selected || !e.shiftKey) return
    e.stopPropagation()

    const next =
      state.rotY + (e.deltaY > 0 ? -1 : 1) * THREE.MathUtils.degToRad(5)
    if (!isAngleFeasible(size, next, roomInner)) return

    const [cx, cz] = clampPosToRoom(state.pos[0], state.pos[2], size, next, roomInner)
    onRotateClamped(index, next, [cx, state.pos[1], cz])
  }

  const ringScale = Math.max(size.w, size.d) * 0.7

  return (
    <group
      position={state.pos}
      rotation={[0, state.rotY, 0]}
      onPointerDown={onPointerDown}
      onPointerUp={onPointerUp}
      onPointerMove={onPointerMove}
      onWheel={onWheel}
      onClick={(e) => {
        e.stopPropagation()
        onSelect(index)
      }}
      onPointerOver={() => (document.body.style.cursor = 'grab')}
      onPointerOut={() => !dragging && (document.body.style.cursor = 'auto')}
    >
      <mesh castShadow receiveShadow>
        <boxGeometry args={[size.w, 0.06, size.d]} />
        <meshStandardMaterial
          color={color}
          roughness={color === COL.table2 ? 0.85 : 0.75}
          metalness={0.05}
        />
      </mesh>
      {selected && (
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -size.h / 2 + 0.005, 0]}>
          <torusGeometry args={[ringScale, 0.01, 8, 48]} />
          <meshBasicMaterial color={COL.ring} />
        </mesh>
      )}
    </group>
  )
}

function DraggableTables({
  twoCount,
  fourCount,
  room,
  onObstaclesChange,
  onAnchorsChange,
  onTablesChange,
}: {
  twoCount: number
  fourCount: number
  room: { width: number; depth: number; wallT: number }
  onObstaclesChange?: (obs: CircleObstacle[]) => void
  onAnchorsChange?: (anchors: SeatAnchor[]) => void
  onTablesChange?: (tables: TableTransform[]) => void
}) {
  const specs = useMemo(
    () => [
      ...Array.from({ length: fourCount }, () => ({
        size: SIZE_FOUR,
        color: COL.table4,
        cap: 4 as 4,
      })),
      ...Array.from({ length: twoCount }, () => ({
        size: SIZE_TWO,
        color: COL.table2,
        cap: 2 as 2,
      })),
    ],
    [twoCount, fourCount],
  )

  const radii = useMemo(() => specs.map((s) => radiusOf((s as any).size)), [specs])

  const roomInner: RoomInner = useMemo(
    () => ({
      minX: -room.width / 2 + room.wallT,
      maxX: room.width / 2 - room.wallT,
      minZ: -room.depth / 2 + room.wallT,
      maxZ: room.depth / 2 - room.wallT,
    }),
    [room.width, room.depth, room.wallT],
  )

  const hasCollisions = (states: TableState[]) => {
    for (let i = 0; i < states.length; i++)
      for (let j = i + 1; j < states.length; j++) {
        const sum = radii[i] + radii[j] + CLEARANCE
        const dx = states[i].pos[0] - states[j].pos[0]
        const dz = states[i].pos[2] - states[j].pos[2]
        if (dx * dx + dz * dz < sum * sum) return true
      }
    return false
  }

  function seedStates(n: number) {
    if (n === 0) return []
    const maxR = Math.max(...radii.slice(0, n))
    const minSpan = (maxR * 2 + CLEARANCE) * 1.25
    const cols = Math.ceil(Math.sqrt(n))
    const rows = Math.ceil(n / cols)
    const spanX = Math.max(minSpan, (roomInner.maxX - roomInner.minX) / Math.max(1, cols))
    const spanZ = Math.max(minSpan, (roomInner.maxZ - roomInner.minZ) / Math.max(1, rows))

    const arr: TableState[] = []
    let i = 0
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        if (i++ >= n) break
        const cx0 = roomInner.minX + (c + 0.5) * spanX
        const cz0 = roomInner.minZ + (r + 0.5) * spanZ
        const [cx, cz] = clampPosToRoom(cx0, cz0, SIZE_FOUR, 0, roomInner)
        arr.push({ pos: [cx, 0.75 / 2, cz], rotY: 0 })
      }
    }
    return arr
  }

  const [states, setStates] = useState<TableState[]>(() => seedStates(specs.length))
  const [selected, setSelected] = useState<number | null>(null)

  useEffect(() => {
    setStates(seedStates(specs.length))
    setSelected(null)
  }, [specs.length])

  useEffect(() => {
    const PAD = 0.08
    const obs: CircleObstacle[] = states.map((s, i) => ({
      x: s.pos[0],
      z: s.pos[2],
      r: radiusOf((specs[i] as any).size) + PAD,
    }))
    onObstaclesChange?.(obs)
  }, [states, specs, onObstaclesChange])

  useEffect(() => {
    const PERSON_R = 0.18
    const PAD = 0.08
    const MARGIN = 0.03
    const anchors: SeatAnchor[] = []

    for (let i = 0; i < states.length; i++) {
      const s = states[i]
      const sp = (specs[i] as any).size as TableSize
      const cap = (specs[i] as any).cap as 2 | 4

      const cx = s.pos[0]
      const cz = s.pos[2]
      const th = s.rotY

      const fwd = new THREE.Vector2(Math.sin(th), Math.cos(th))
      const right = new THREE.Vector2(Math.cos(th), -Math.sin(th))

      const rTable = radiusOf(sp) + PAD
      const rMin = rTable + PERSON_R + MARGIN
      const baseHalf = sp.d / 2

      const add = (k: number, along: number, lat: number) => {
        const p = fwd.clone().multiplyScalar(along).add(right.clone().multiplyScalar(lat))
        const ax = cx + p.x
        const az = cz + p.y
        const dir = Math.atan2(cx - ax, cz - az)
        anchors.push({
          id: i * 10 + k,
          x: ax,
          z: az,
          dir,
          tableId: i,
          tableCap: cap,
        })
      }

      if (cap === 4) {
        const xOff = sp.w * 0.25
        const seatDist = Math.max(
          0.42,
          Math.sqrt(Math.max(0, rMin * rMin - xOff * xOff)) - baseHalf + 0.02,
        )
        add(0, baseHalf + seatDist, +xOff)
        add(1, baseHalf + seatDist, -xOff)
        add(2, -(baseHalf + seatDist), +xOff)
        add(3, -(baseHalf + seatDist), -xOff)
      } else {
        const seatDist = Math.max(0.42, rMin - baseHalf + 0.02)
        add(0, baseHalf + seatDist, 0)
        add(1, -(baseHalf + seatDist), 0)
      }
    }

    onAnchorsChange?.(anchors)
  }, [states, specs, onAnchorsChange])

  useEffect(() => {
    const out: TableTransform[] = states.map((s, i) => ({
      id: i,
      x: s.pos[0],
      z: s.pos[2],
      rotY: s.rotY,
      size: (specs[i] as any).size as TableSize,
    }))
    onTablesChange?.(out)
  }, [states, specs, onTablesChange])

  const onMoveClamped = (i: number, nextPos: [number, number, number]) => {
    setStates((prev) => {
      const next = prev.map((p) => ({ ...p }))
      next[i].pos = nextPos
      return hasCollisions(next) ? prev : next
    })
  }

  const onRotateClamped = (i: number, nextRotY: number, nextPos: [number, number, number]) => {
    setStates((prev) => {
      const next = prev.map((p) => ({ ...p }))
      next[i].rotY = nextRotY
      next[i].pos = nextPos
      return hasCollisions(next) ? prev : next
    })
  }

  return (
    <group>
      {states.map((s, i) => (
        <DraggableTable
          key={i}
          index={i}
          state={s}
          size={(specs[i] as any).size}
          color={(specs[i] as any).color}
          roomInner={roomInner}
          selected={selected === i}
          onSelect={(idx) => setSelected(idx)}
          onMoveClamped={onMoveClamped}
          onRotateClamped={onRotateClamped}
        />
      ))}
    </group>
  )
}

/* ---------- People (enter→seat→toilet→exit/outside) ---------- */
type Phase =
  | 'approachDoor'
  | 'foyer'
  | 'toSeat'
  | 'seated'
  | 'toiletGo'
  | 'toiletUse'
  | 'exit'
  | 'outside'
  | 'despawn'

type Agent = {
  id: number
  pos: [number, number]
  vel: [number, number]
  laneX: number
  phase: Phase
  target: [number, number]
  seatId: number | null
  leaveAt: number
  since: number
  stuck: number
  wcPlanned: boolean
  wcAt: number
}

type SeatAnchorP = {
  id: number
  x: number
  z: number
  dir: number
  tableId: number
  tableCap: 2 | 4
}

function AgentMesh({
  agent,
  bodyH,
  headR,
  bodyR,
}: {
  agent: Agent
  bodyH: number
  headR: number
  bodyR: number
}) {
  const ref = useRef<THREE.Group>(null!)

  useFrame(() => {
    if (ref.current) {
      ref.current.position.set(agent.pos[0], 0, agent.pos[1])
      ref.current.visible = agent.phase !== 'toiletUse'
    }
  })

  return (
    <group
      ref={ref}
      position={[agent.pos[0], 0, agent.pos[1]]}
      visible={agent.phase !== 'toiletUse'}
    >
      <mesh position={[0, bodyH / 2, 0]} castShadow receiveShadow>
        <cylinderGeometry args={[bodyR, bodyR, bodyH, 18]} />
        <meshStandardMaterial color={COL.person} roughness={0.7} />
      </mesh>
      <mesh position={[0, bodyH + headR, 0]} castShadow>
        <sphereGeometry args={[headR, 24, 24]} />
        <meshStandardMaterial color={COL.person} roughness={0.6} metalness={0.05} />
      </mesh>
    </group>
  )
}

export function People({
  cfg,
  obstacles,
  doorLeft,
  doorWidth,
  seats,
  toiletPoint,
  onStats,
  onSeated,
  onCrowdObstacles,
  isRunning,
  effectiveIncoming,
  serviceCoef,
}: {
  cfg: Config
  obstacles: CircleObstacle[]
  doorLeft: number
  doorWidth: number
  seats: SeatAnchorP[]
  toiletPoint: { x: number; z: number }
  onStats?: (s: LiveStats) => void
  onSeated?: (e: { x: number; z: number; tableId: number }) => void
  onCrowdObstacles?: (obs: CircleObstacle[]) => void
  isRunning: boolean
  effectiveIncoming: number
  serviceCoef: number
}) {
  const BODY_H = 1.1
  const HEAD_R = 0.14
  const BODY_R = 0.16
  const R = Math.max(BODY_R, HEAD_R) + 0.02

  // ★ シミュレーション時間（isRunning=falseで止まる）
  const simTime = useRef(0)

  const inner = useMemo(
    () => ({
      minX: -cfg.width / 2 + cfg.wallT + (R + 0.005),
      maxX: cfg.width / 2 - cfg.wallT - (R + 0.005),
      minZ: -cfg.depth / 2 + cfg.wallT + (R + 0.005),
      maxZ: cfg.depth / 2 - cfg.wallT - (R + 0.005),
    }),
    [cfg.width, cfg.depth, cfg.wallT, R],
  )

  const doorCX = -cfg.width / 2 + doorLeft + doorWidth / 2
  const tunnelHalf = Math.max(0.07, doorWidth / 2 - R - 0.05)

  const doorWP = useMemo(() => [doorCX, inner.minZ + 0.5] as const, [doorCX, inner.minZ])
  const foyerWP = useMemo(() => [doorCX, inner.minZ + 1.6] as const, [doorCX, inner.minZ])
  const exitWP = useMemo(() => [doorCX, inner.minZ - 0.9] as const, [doorCX, inner.minZ])

  const inTunnel = (x: number, z: number) =>
    Math.abs(x - doorCX) <= tunnelHalf + 0.02 && z > inner.minZ - 0.5 && z <= inner.minZ + 0.6

  const portal = useMemo(() => {
    const halfW = Math.max(0.22, doorWidth / 2 - R * 0.4)
    const thick = Math.max(0.7, cfg.wallT + 0.4)
    const inPortal = (x: number, z: number) =>
      Math.abs(x - doorCX) <= halfW && Math.abs(z - inner.minZ) <= thick * 0.5 + 0.05
    return { halfW, thick, inPortal }
  }, [doorCX, inner.minZ, doorWidth, R, cfg.wallT])

  const seatMap = useMemo(() => {
    const m = new Map<number, SeatAnchorP>()
    seats?.forEach((s) => m.set(s.id, s))
    return m
  }, [seats])

  const seatTaken = useRef<Set<number>>(new Set())
  const tableOcc = useRef<Map<number, number>>(new Map())
  useEffect(() => {
    const valid = new Set(seats?.map((s) => s.id) ?? [])
    const next = new Set<number>()
    seatTaken.current.forEach((id) => {
      if (valid.has(id)) next.add(id)
    })
    seatTaken.current = next
  }, [seats])

  const wallDist = (x: number, z: number) =>
    Math.min(
      Math.abs(x - inner.minX),
      Math.abs(inner.maxX - x),
      Math.abs(z - inner.minZ),
      Math.abs(inner.maxZ - z),
    )

  const approachPointFor = (s: SeatAnchorP) => {
    const back = s.dir + Math.PI
    const dist = 0.38
    return { x: s.x + Math.sin(back) * dist, z: s.z + Math.cos(back) * dist }
  }

  const tryAssignSeat = (): number | null => {
    const free = (seats || [])
      .filter((s) => !seatTaken.current.has(s.id))
      .sort((a, b) => wallDist(a.x, a.z) - wallDist(b.x, b.z))
    if (!free.length) return null
    const seat = free[0]
    seatTaken.current.add(seat.id)
    return seat.id
  }

  const agents = useRef<Agent[]>([])
  const nextId = useRef(1)
  const pending = useRef(0)
  const prevIncoming = useRef(effectiveIncoming)
  const [revision, setRevision] = useState(0)
  const departedCount = useRef(0)

  useEffect(() => {
    const prev = Math.floor(prevIncoming.current || 0)
    const now = Math.floor(effectiveIncoming || 0)
    const diff = Math.max(0, now - prev)
    if (diff > 0) pending.current += diff
    prevIncoming.current = effectiveIncoming
  }, [effectiveIncoming])

  const spawnCooldown = useRef(0)
  const spawnOne = (now: number) => {
    const lanes = 3
    const laneW = Math.min(tunnelHalf * 0.9, 0.22)
    const i = nextId.current % lanes
    const lane =
      clamp(doorCX + (i - (lanes - 1) / 2) * laneW * 2, inner.minX, inner.maxX) ||
      doorCX
    const jitter = Math.min((doorWidth / 2) * 0.18, 0.1)
    const x0 = clamp(lane + (Math.random() * 2 - 1) * jitter, inner.minX, inner.maxX)
    const z0 = inner.minZ - 0.28
    const seatId = tryAssignSeat()

    agents.current.push({
      id: nextId.current++,
      pos: [x0, z0],
      vel: [0, 0],
      laneX: lane,
      phase: 'approachDoor',
      target: [doorWP[0], doorWP[1]],
      seatId,
      leaveAt: 0,
      since: now,
      stuck: 0,
      wcPlanned: false,
      wcAt: 0,
    })
    setRevision((v) => v + 1)
  }

  const CELL = 0.9
  const grid = useRef<Map<string, number[]>>(new Map())
  const keyOf = (x: number, z: number) => `${Math.floor(x / CELL)}:${Math.floor(z / CELL)}`
  const rebuild = () => {
    grid.current.clear()
    agents.current.forEach((a, i) => {
      if (a.phase !== 'despawn') {
        const k = keyOf(a.pos[0], a.pos[1])
        const g = grid.current.get(k)
        if (g) g.push(i)
        else grid.current.set(k, [i])
      }
    })
  }
  const nearIdx = (x: number, z: number) => {
    const gx = Math.floor(x / CELL)
    const gz = Math.floor(z / CELL)
    const out: number[] = []
    for (let dz = -1; dz <= 1; dz++)
      for (let dx = -1; dx <= 1; dx++) {
        const g = grid.current.get(`${gx + dx}:${gz + dz}`)
        if (g) out.push(...g)
      }
    return out
  }

  const OUTSIDE_Z = useMemo(() => inner.minZ - 1.2, [inner.minZ])

  const lastStatsKey = useRef('')
  const pushStats = () => {
    if (!onStats) return
    const inside = agents.current.filter(
      (a) => a.phase !== 'despawn' && a.phase !== 'outside' && a.phase !== 'toiletUse',
    ).length
    const seated = agents.current.filter((a) => a.phase === 'seated').length
    const exiting = agents.current.filter((a) => a.phase === 'exit').length
    const s: LiveStats = {
      pending: Math.max(0, pending.current | 0),
      inside,
      seated,
      exiting,
      departed: departedCount.current | 0,
      activeTables: tableOcc.current.size,
    }
    const key = JSON.stringify(s)
    if (key !== lastStatsKey.current) {
      lastStatsKey.current = key
      onStats(s)
    }
  }

  useFrame((_s, dt) => {
    if (!isRunning) return

    const d = Math.max(dt || 0.016, 0.001)
    simTime.current += d
    const now = simTime.current

    spawnCooldown.current -= d
    if (pending.current > 0 && spawnCooldown.current <= 0) {
      const MAX_PER_WIDTH = Math.max(1, Math.floor((doorWidth - 0.1) / (R * 2 + 0.06)))
      const inTun = agents.current.filter(
        (a) =>
          a.phase !== 'despawn' &&
          a.phase !== 'outside' &&
          inTunnel(a.pos[0], a.pos[1]),
      ).length
      if (inTun < MAX_PER_WIDTH) {
        spawnOne(now)
        pending.current--
        spawnCooldown.current = 0.35
      } else spawnCooldown.current = 0.12
    }

    for (const a of agents.current) {
      if ((a.phase === 'foyer' || a.phase === 'toSeat') && a.seatId == null) {
        const sid = tryAssignSeat()
        if (sid != null) {
          a.seatId = sid
          a.phase = 'toSeat'
          a.since = now
        }
      }
    }

    rebuild()

    const seatedObs: CircleObstacle[] = agents.current
      .filter((a) => a.phase === 'seated')
      .map((a) => ({ x: a.pos[0], z: a.pos[1], r: R + 0.02 }))
    const circles = obstacles.concat(seatedObs)

    for (const a of agents.current) {
      if (a.phase === 'outside') {
        a.vel[0] *= 0.9
        a.vel[1] *= 0.9
        a.pos[0] = clamp(a.pos[0], doorCX - 0.35, doorCX + 0.35)
        a.pos[1] = THREE.MathUtils.lerp(a.pos[1], OUTSIDE_Z, 0.06)
        continue
      }

      if (a.phase === 'approachDoor') {
        a.target = [doorWP[0], doorWP[1]]
        if (a.pos[1] >= doorWP[1] - 0.02) {
          a.phase = 'foyer'
          a.since = now
        }
      } else if (a.phase === 'foyer') {
        const baseStaySec = Math.max(1, cfg.baseStaySec || 0)
        const MAX_WAIT = Math.max(12, baseStaySec * 0.5)
        if (now - a.since > MAX_WAIT) {
          a.phase = 'exit'
          a.since = now
        }
        a.target = [foyerWP[0], foyerWP[1]]
        if (a.pos[1] >= foyerWP[1] - 0.02) {
          a.phase = a.seatId != null ? 'toSeat' : 'foyer'
        }
      } else if (a.phase === 'toSeat') {
        const seat = a.seatId != null ? seatMap.get(a.seatId)! : undefined
        if (!seat) {
          a.phase = 'foyer'
          a.since = now
        } else {
          const ap = approachPointFor(seat)
          const dxap = ap.x - a.pos[0]
          const dzap = ap.z - a.pos[1]
          const nearAp = dxap * dxap + dzap * dzap < 0.22 * 0.22
          a.target = nearAp ? [seat.x, seat.z] : [ap.x, ap.z]
          if (nearAp) {
            const dsx = seat.x - a.pos[0]
            const dsz = seat.z - a.pos[1]
            if (dsx * dsx + dsz * dsz < 0.2 * 0.2) {
              a.pos[0] = seat.x
              a.pos[1] = seat.z
              a.vel = [0, 0]
              a.phase = 'seated'
              a.since = now
              const baseStaySec = Math.max(1, cfg.baseStaySec || 0)
              const rawStay = baseStaySec * serviceCoef
              const capStay = Math.max(0, cfg.timeCapSec || 0)
              const staySec = cfg.timeLimitOn ? Math.min(rawStay, capStay) : rawStay
              a.leaveAt = now + Math.max(5, staySec)
              const prev = tableOcc.current.get(seat.tableId) ?? 0
              tableOcc.current.set(seat.tableId, prev + 1)
              if (prev === 0) onSeated?.({ x: seat.x, z: seat.z, tableId: seat.tableId })

              if (a.wcPlanned) {
                a.wcPlanned = false
                a.wcAt = 0
              } else {
                const wantWC = Math.random() < 0.51
                if (wantWC) {
                  const margin = 12
                  const span = a.leaveAt - now
                  if (span > margin) {
                    const depart = clamp(now + span * 0.5, now + 5, a.leaveAt - margin)
                    a.wcPlanned = true
                    a.wcAt = depart
                  }
                }
              }
            }
          }
        }
      } else if (a.phase === 'seated') {
        if (a.wcPlanned && now >= a.wcAt) {
          a.phase = 'toiletGo'
          a.since = now
        } else if (now >= a.leaveAt) {
          if (a.seatId != null) {
            const seat = seatMap.get(a.seatId)
            seatTaken.current.delete(a.seatId)
            if (seat) {
              const prev = tableOcc.current.get(seat.tableId) ?? 0
              if (prev <= 1) tableOcc.current.delete(seat.tableId)
              else tableOcc.current.set(seat.tableId, prev - 1)
            }
          }
          a.phase = 'exit'
          a.since = now
        }
      } else if (a.phase === 'toiletGo') {
        a.target = [toiletPoint.x, toiletPoint.z]
        const dx = toiletPoint.x - a.pos[0]
        const dz = toiletPoint.z - a.pos[1]
        if (dx * dx + dz * dz < 0.25 * 0.25) {
          a.phase = 'toiletUse'
          a.since = now
        }
      } else if (a.phase === 'toiletUse') {
        if (now - a.since >= 10) {
          a.phase = 'toSeat'
          a.since = now
        }
      } else if (a.phase === 'exit') {
        a.target = [exitWP[0], exitWP[1]]
      }

      if (a.phase !== 'seated' && a.phase !== 'toiletUse') {
        const avoidR = cfg.avoidance.radius
        const repK = cfg.repulsion
        const [tx, tz] = a.target
        const dx = tx - a.pos[0]
        const dz = tz - a.pos[1]
        const dist = Math.hypot(dx, dz) || 1e-6
        let vtx = (dx / dist) * 1.25
        let vtz = (dz / dist) * 1.25
        let sepX = 0
        let sepZ = 0
        const sepDist = R * 2.2
        const maxSepForce = 1.5
        let repX = 0
        let repZ = 0
        const maxRepulse = 3.0

        if (a.phase === 'approachDoor') {
          vtx += (a.laneX - a.pos[0]) * 3.4
          vtz += 1.8
        } else if (a.phase !== 'exit' && a.pos[1] < inner.minZ + 0.85) {
          vtx += (a.laneX - a.pos[0]) * 3.0
        }
        if (a.phase === 'exit') {
          vtx += (doorCX - a.pos[0]) * 2.4
          vtz -= 1.2
        }

        const speed = Math.hypot(a.vel[0], a.vel[1])
        a.stuck = speed < 0.05 ? a.stuck + d : 0
        if (a.stuck > 0.9) {
          const txN = -dz / dist
          const tzN = dx / dist
          const side = (a.id & 1) ? 1 : -1
          vtx += txN * 0.8 * side
          vtz += tzN * 0.8 * side
          a.stuck = 0
        }

        let px = 0
        let pz = 0
        let sx = 0
        let sz = 0

        const disableSoft = a.phase === 'exit' && portal.inPortal(a.pos[0], a.pos[1])

        if (!disableSoft) {
          for (const j of nearIdx(a.pos[0], a.pos[1])) {
            const b = agents.current[j]
            if (b === a || b.phase === 'despawn' || b.phase === 'outside') continue
            const rx = a.pos[0] - b.pos[0]
            const rz = a.pos[1] - b.pos[1]
            const dd = Math.hypot(rx, rz) || 1e-6
            if (dd < sepDist) {
              const w = (sepDist - dd) / sepDist
              sepX += (rx / dd) * w
              sepZ += (rz / dd) * w
            }
            if (dd < avoidR.humanHuman) {
              const strength = (avoidR.humanHuman - dd) * repK.humanHuman
              repX += (rx / dd) * strength
              repZ += (rz / dd) * strength
            }
            const r0 = R * 2 + 0.06
            const r1 = r0 + 0.32
            const s = 1 - Math.min(1, Math.max(0, (dd - r0) / (r1 - r0)))
            if (s > 0) {
              px += (rx / dd) * s * 4.0
              pz += (rz / dd) * s * 4.0
              const txN = -rz / dd
              const tzN = rx / dd
              sx += txN * s * 2.4
              sz += tzN * s * 2.4
            }
          }

          for (const o of circles) {
            const ox = a.pos[0] - o.x
            const oz = a.pos[1] - o.z
            const dd = Math.hypot(ox, oz) || 1e-6
            const rAvoid = o.r + avoidR.humanObstacle
            if (dd < rAvoid) {
              const strength = (rAvoid - dd) * repK.humanObstacle
              repX += (ox / dd) * strength
              repZ += (oz / dd) * strength
            }
            const r0 = o.r + R + 0.08
            const r1 = r0 + 0.35
            const s = 1 - Math.min(1, Math.max(0, (dd - r0) / (r1 - r0)))
            if (s > 0) {
              px += (ox / dd) * s * 4.0
              pz += (oz / dd) * s * 4.0
              const txN = -oz / dd
              const tzN = ox / dd
              sx += txN * s * 2.4
              sz += tzN * s * 2.4
            }
          }
        } else {
          vtx += (doorCX - a.pos[0]) * 8.0
          vtz -= 1.4
        }

        const sepMag = Math.hypot(sepX, sepZ)
        if (sepMag > 1e-6) {
          const m = Math.min(sepMag, maxSepForce)
          vtx += (sepX / sepMag) * m
          vtz += (sepZ / sepMag) * m
        }

        const repMag = Math.hypot(repX, repZ)
        if (repMag > 1e-6) {
          const m = Math.min(repMag, maxRepulse)
          vtx += (repX / repMag) * m
          vtz += (repZ / repMag) * m
        }

        const WALL_PAD = 0.18
        const dL = a.pos[0] - inner.minX
        const dR = inner.maxX - a.pos[0]
        const dF = a.pos[1] - inner.minZ
        const dB = inner.maxZ - a.pos[1]
        if (dL < WALL_PAD) px += (WALL_PAD - dL) * 3.2
        if (dR < WALL_PAD) px -= (WALL_PAD - dR) * 3.2
        if (dF < WALL_PAD) pz += (WALL_PAD - dF) * 3.2
        if (dB < WALL_PAD) pz -= (WALL_PAD - dB) * 3.2

        const ax_ = (vtx - a.vel[0]) * 7.5 + px + sx
        const az_ = (vtz - a.vel[1]) * 7.5 + pz + sz
        a.vel[0] = (a.vel[0] + ax_ * d) * 0.92
        a.vel[1] = (a.vel[1] + az_ * d) * 0.92
        const v = Math.hypot(a.vel[0], a.vel[1])
        if (v > 1.25) {
          a.vel[0] *= 1.25 / v
          a.vel[1] *= 1.25 / v
        }

        const nextX = a.pos[0] + a.vel[0] * d
        const nextZ = a.pos[1] + a.vel[1] * d

        const minZForPhase = a.phase === 'exit' ? inner.minZ - 1.6 : inner.minZ

        let nx = clamp(nextX, inner.minX, inner.maxX)
        if (a.phase === 'exit' || a.phase === 'approachDoor') {
          nx = clamp(nx, doorCX - (tunnelHalf + 0.02), doorCX + (tunnelHalf + 0.02))
        }

        let nz = clamp(nextZ, minZForPhase, inner.maxZ)
        if (a.phase === 'exit' && nz > a.pos[1]) nz = a.pos[1]

        a.pos[0] = nx
        a.pos[1] = nz

        for (const o of circles) {
          const ox = a.pos[0] - o.x
          const oz = a.pos[1] - o.z
          const dd = Math.hypot(ox, oz)
          const hardR = o.r + R + 0.08
          if (dd < hardR) {
            const nx2 = (ox || 1e-6) / dd
            const nz2 = (oz || 1e-6) / dd
            const push = hardR - dd + 1e-3
            a.pos[0] += nx2 * push * (1 + 0.25)
            a.pos[1] += nz2 * push * (1 + 0.25)
            const txN = -nz2
            const tzN = nx2
            a.vel[0] += txN * 0.25
            a.vel[1] += tzN * 0.25
          }
        }
      }

      if (a.phase === 'exit' && a.pos[1] <= inner.minZ - 0.9) {
        a.phase = 'outside'
        a.vel = [0, 0]
        a.pos[1] = OUTSIDE_Z
        departedCount.current++
      }
    }

    onCrowdObstacles?.(
      agents.current
        .filter((a) => a.phase !== 'despawn' && a.phase !== 'outside' && a.phase !== 'toiletUse')
        .map((a) => ({ x: a.pos[0], z: a.pos[1], r: R + 0.02 })),
    )

    pushStats()
  })

  return (
    <group key={revision}>
      {agents.current.map((a) => (
        <AgentMesh key={a.id} agent={a} bodyH={BODY_H} headR={HEAD_R} bodyR={BODY_R} />
      ))}
    </group>
  )
}

/* ---------- Staff (short-edge serving with robust avoidance) ---------- */
type ServeReq = { id: number; tableId: number; x: number; z: number }
type StaffPhase = 'IDLE' | 'GO_TO_TABLE' | 'SERVING' | 'RETURNING' | 'EXITING' | 'DESPAWN'
type StaffAgent = {
  id: number
  pos: [number, number]
  vel: [number, number]
  phase: StaffPhase
  target: [number, number]
  since: number
  tableId: number
  idleSeconds?: number
  atTableSec?: number
  tableCenter?: [number, number]
  servingTargetTableId?: number
  servingTargetSpot?: [number, number]
  serviceSpots?: [[number, number], [number, number]]
  activeSpot?: number
  lastDist?: number
  lastProgressTime?: number
  jittered?: boolean
  totalTimeSec?: number
  busyTimeSec?: number
}

const STAFF_RADIUS = 0.18
type AvoidanceRadius = Config['avoidance']['radius']
type RepulsionK = Config['repulsion']

function getServiceSpot(
  tableCenter: THREE.Vector3,
  tableSize: TableSize,
  tableYaw: number,
  kitchenPos: THREE.Vector3,
  staffRadius: number,
  serviceMargin: number,
) {
  const shortIsX = tableSize.w <= tableSize.d
  const shortHalf = (shortIsX ? tableSize.w : tableSize.d) / 2
  const offset = shortHalf + staffRadius + serviceMargin

  const localA = new THREE.Vector3(shortIsX ? 0 : offset, 0, shortIsX ? offset : 0)
  const localB = localA.clone().multiplyScalar(-1)

  const rot = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), tableYaw)
  const worldA = localA.clone().applyQuaternion(rot).add(tableCenter)
  const worldB = localB.clone().applyQuaternion(rot).add(tableCenter)

  const primary = worldA.distanceToSquared(kitchenPos) <= worldB.distanceToSquared(kitchenPos) ? worldA : worldB
  const secondary = primary === worldA ? worldB : worldA
  return { primary, secondary }
}

function StaffMesh({ agent }: { agent: StaffAgent }) {
  const ref = useRef<THREE.Group>(null!)
  const lookTarget = useMemo(() => new THREE.Vector3(), [])
  useFrame(() => {
    if (!ref.current) return
    ref.current.position.set(agent.pos[0], 0, agent.pos[1])
    if (agent.phase === 'SERVING' && agent.tableCenter) {
      lookTarget.set(agent.tableCenter[0], 0, agent.tableCenter[1])
      ref.current.lookAt(lookTarget)
    }
  })

  const BODY_H = 1.1
  const HEAD_R = 0.14
  const BODY_R = 0.16

  return (
    <group ref={ref} position={[agent.pos[0], 0, agent.pos[1]]}>
      <mesh position={[0, BODY_H / 2, 0]} castShadow receiveShadow>
        <cylinderGeometry args={[BODY_R, BODY_R, BODY_H, 18]} />
        <meshStandardMaterial color={COL.staff} roughness={0.6} />
      </mesh>
      <mesh position={[0, BODY_H + HEAD_R, 0]} castShadow>
        <sphereGeometry args={[HEAD_R, 24, 24]} />
        <meshStandardMaterial color={COL.staff} roughness={0.5} metalness={0.05} />
      </mesh>
    </group>
  )
}

type Circle = { x: number; z: number; r: number }

function segIntersectsCircle(
  ax: number,
  az: number,
  bx: number,
  bz: number,
  c: Circle,
  inflate = 0,
) {
  const cx = c.x
  const cz = c.z
  const R = c.r + inflate
  const abx = bx - ax
  const abz = bz - az
  const acx = cx - ax
  const acz = cz - az
  const ab2 = abx * abx + abz * abz || 1e-6
  const t = Math.max(0, Math.min(1, (acx * abx + acz * abz) / ab2))
  const px = ax + t * abx
  const pz = az + t * abz
  const dx = px - cx
  const dz = pz - cz
  return dx * dx + dz * dz <= R * R
}

function firstBlockingCircle(
  ax: number,
  az: number,
  bx: number,
  bz: number,
  circles: Circle[],
  inflate = 0,
) {
  let best: { c: Circle; d: number } | null = null
  for (const c of circles) {
    if (segIntersectsCircle(ax, az, bx, bz, c, inflate)) {
      const dx = c.x - ax
      const dz = c.z - az
      const d = Math.hypot(dx, dz)
      if (!best || d < best.d) best = { c, d }
    }
  }
  return best?.c ?? null
}

function tangentWaypoint(ax: number, az: number, tx: number, tz: number, c: Circle, pad = 0.18) {
  const R = Math.max(c.r + pad, 0.01)
  const vx = c.x - ax
  const vz = c.z - az
  const L = Math.hypot(vx, vz) || 1e-6
  const base = Math.atan2(vz, vx)
  const tDir = Math.acos(Math.min(1, Math.max(-1, R / Math.max(L, R + 1e-6))))
  const angles = [base + tDir, base - tDir]
  const cand = angles.map((a) => ({
    x: c.x + Math.cos(a) * R,
    z: c.z + Math.sin(a) * R,
  }))
  cand.sort((p, q) => Math.hypot(p.x - tx, p.z - tz) - Math.hypot(q.x - tx, q.z - tz))
  return cand[0]
}

function narrowGapRepulsion(ax: number, az: number, circles: Circle[], minGap = 0.48, reach = 0.36) {
  let rx = 0
  let rz = 0
  for (let i = 0; i < circles.length; i++)
    for (let j = i + 1; j < circles.length; j++) {
      const c1 = circles[i]
      const c2 = circles[j]
      const dx = c2.x - c1.x
      const dz = c2.z - c1.z
      const d = Math.hypot(dx, dz) || 1e-6
      const gap = d - (c1.r + c2.r)
      if (gap < minGap) {
        const mx = (c1.x + c2.x) / 2
        const mz = (c1.z + c2.z) / 2
        const nx = -dz / d
        const nz = dx / d
        const mdx = ax - mx
        const mdz = az - mz
        const dist = Math.hypot(mdx, mdz)
        if (dist < reach + (minGap - gap)) {
          const s = 1 - dist / Math.max(1e-6, reach + (minGap - gap))
          rx += nx * s * 2.2
          rz += nz * s * 2.2
        }
      }
    }
  return { rx, rz }
}

function Staff({
  kitchenPoint,
  exitTarget,
  exitOutZ,
  obstacles,
  crowdObs,
  requests,
  tables,
  staffCount,
  isRunning,
  serviceCoef,
  serviceMargin,
  avoidanceRadius,
  repulsionK,
  onUtilization,
  onStaffCount,
}: {
  kitchenPoint: { x: number; z: number }
  exitTarget: { x: number; z: number }
  exitOutZ: number
  obstacles: CircleObstacle[]
  crowdObs: CircleObstacle[]
  requests: ServeReq[]
  tables: TableTransform[]
  staffCount: number
  isRunning: boolean
  serviceCoef: number
  serviceMargin: number
  avoidanceRadius: AvoidanceRadius
  repulsionK: RepulsionK
  onUtilization?: (u: number) => void
  onStaffCount?: (count: number) => void
}) {
  const servingRepulsionScale = 0.2
  type Waypoint = { x: number; z: number } | null

  // ★ シミュレーション時間（isRunning=falseで止まる）
  const simTime = useRef(0)
  const exitRequested = useRef(false)
  const prevStaffCount = useRef(staffCount)
  const lastAgentSnapshot = useRef<{
    id: number
    phase: StaffPhase
    pos: [number, number]
    target: [number, number]
    servingTargetSpot?: [number, number]
  } | null>(null)
  const safeServiceMargin = Number.isFinite(serviceMargin) ? serviceMargin : 0

  const agents = useRef<StaffAgent[]>([])
  const nextId = useRef(1)

  const pending = useRef<ServeReq[]>([])

  useEffect(() => {
    if (!isRunning) return
    const existing = new Set(pending.current.map((r) => r.id))
    const merged = [...pending.current]
    for (const r of requests) {
      if (!existing.has(r.id)) merged.push(r)
    }
    pending.current = merged
  }, [requests, isRunning])

  useEffect(() => {
    if (isRunning) {
      exitRequested.current = false
      return
    }
    exitRequested.current = true
    pending.current = []
    for (const a of agents.current) {
      if (a.phase === 'DESPAWN') continue
      a.phase = 'EXITING'
      a.target = [exitTarget.x, exitTarget.z]
      a.tableId = -1
      a.idleSeconds = 0
      a.atTableSec = 0
      a.tableCenter = undefined
      a.servingTargetTableId = undefined
      a.servingTargetSpot = undefined
      a.serviceSpots = undefined
      a.activeSpot = undefined
      a.lastDist = undefined
      a.lastProgressTime = undefined
      a.jittered = false
      a.idleSeconds = 0
      a.atTableSec = 0
      ;(a as any)._wp = null
      ;(a as any)._stuck = 0
      ;(a as any)._lastReplan = 0
      ;(a as any)._replanAttempts = 0
    }
  }, [isRunning, exitTarget.x, exitTarget.z])

  const baseObs = useMemo<Circle[]>(() => obstacles.map((o) => ({ x: o.x, z: o.z, r: o.r + 0.06 })), [obstacles])
  const crowd = useMemo<Circle[]>(() => crowdObs.map((o) => ({ x: o.x, z: o.z, r: o.r + 0.02 })), [crowdObs])

  const inflationToTry = [0.0, 0.1, 0.18]
  const BASE_SERVICE_TIME = 3.0

  const pickWaypoint = (ax: number, az: number, tx: number, tz: number, circles: Circle[]): Waypoint => {
    for (const inf of inflationToTry) {
      const block = firstBlockingCircle(ax, az, tx, tz, circles, inf)
      if (!block) return null
      const wp = tangentWaypoint(ax, az, tx, tz, block, 0.2 + inf)
      const block2 = firstBlockingCircle(ax, az, wp.x, wp.z, circles, 0.06)
      if (!block2) return wp
    }
    const b = firstBlockingCircle(ax, az, tx, tz, circles, 0.12)
    return b ? tangentWaypoint(ax, az, tx, tz, b, 0.22) : null
  }

  const assignTask = (a: StaffAgent, req: ServeReq, now: number) => {
    const table = tables.find((t) => t.id === req.tableId)
    const tableCenter = table ? new THREE.Vector3(table.x, 0, table.z) : null
    const kitchenVec = new THREE.Vector3(kitchenPoint.x, 0, kitchenPoint.z)
    const reqX = Number.isFinite(req.x) ? req.x : kitchenPoint.x
    const reqZ = Number.isFinite(req.z) ? req.z : kitchenPoint.z
    const spot =
      table && tableCenter
        ? getServiceSpot(
            tableCenter,
            table.size,
            table.rotY,
            kitchenVec,
            STAFF_RADIUS,
            safeServiceMargin,
          )
        : null
    const tgt = spot ? { x: spot.primary.x, z: spot.primary.z } : { x: reqX, z: reqZ }

    a.phase = 'GO_TO_TABLE'
    a.target = [tgt.x, tgt.z]
    a.since = now
    a.tableId = req.tableId
    a.tableCenter = table ? [table.x, table.z] : undefined
    a.servingTargetTableId = req.tableId
    a.servingTargetSpot = [tgt.x, tgt.z]
    a.serviceSpots = spot
      ? ([
          [spot.primary.x, spot.primary.z],
          [spot.secondary.x, spot.secondary.z],
        ] as [[number, number], [number, number]])
      : undefined
    a.activeSpot = 0
    a.lastDist = Math.hypot(tgt.x - a.pos[0], tgt.z - a.pos[1])
    a.lastProgressTime = now
    a.jittered = false
    a.idleSeconds = 0
    a.atTableSec = 0
    ;(a as any)._wp = null as Waypoint
    ;(a as any)._stuck = 0 as number
    ;(a as any)._lastReplan = now as number
    ;(a as any)._replanAttempts = 0 as number
  }

  useFrame((_s, dt) => {
    if (!isRunning && !exitRequested.current) return

    try {
      const d = Math.max(dt || 0.016, 0.001)
      const idleDt = Math.min(d, 0.05)
      simTime.current += d
      const now = simTime.current

      if (isRunning) {
        while (agents.current.length < staffCount) {
        agents.current.push({
          id: nextId.current++,
          pos: [kitchenPoint.x, kitchenPoint.z],
          vel: [0, 0],
          phase: 'IDLE',
          target: [kitchenPoint.x, kitchenPoint.z],
          since: now,
          tableId: -1,
          idleSeconds: 0,
          atTableSec: 0,
          totalTimeSec: 0,
          busyTimeSec: 0,
        })
        }

        while (agents.current.length > staffCount) {
          const idx = agents.current.findIndex((a) => a.phase === 'IDLE')
          if (idx === -1) break
          agents.current.splice(idx, 1)
        }

        while (pending.current.length > 0) {
          const idle = agents.current.find((a) => a.phase === 'IDLE')
          if (!idle) break
          const req = pending.current.shift()
          if (!req) break
          assignTask(idle, req, now)
        }
      }

      if (prevStaffCount.current === 0 && staffCount > 0) {
        const first = agents.current[0]
        if (first) {
          console.log('[Staff spawn]', {
            pos: [...first.pos],
            target: [...first.target],
            serviceSpot: first.servingTargetSpot ? [...first.servingTargetSpot] : null,
          })
        }
        prevStaffCount.current = staffCount
      } else if (prevStaffCount.current !== staffCount) {
        prevStaffCount.current = staffCount
      }

      const MAX_SPEED = 1.6
      const ACCEL = 8.5
      const DAMP = 0.9
      const OB_PUSH = 5.2
      const SLIDE = 2.7
      const HARD_PUSH = 0.36
      const HARD_PAD = 0.09
      const R = STAFF_RADIUS
      const ARRIVE_EPS = STAFF_RADIUS + 0.15
      const SEP_DIST = R * 2.2
      const MAX_SEP_FORCE = 1.5
      const NO_PROGRESS_TIME = 2.6
      const MAX_REPLAN_ATTEMPTS = 3

      const circles = baseObs.concat(crowd)

      for (const a of agents.current) {
      if (!isRunning && a.phase !== 'EXITING' && a.phase !== 'DESPAWN') {
        a.phase = 'EXITING'
        a.target = [exitTarget.x, exitTarget.z]
        a.servingTargetSpot = undefined
        a.serviceSpots = undefined
        a.activeSpot = undefined
        a.lastDist = undefined
        a.lastProgressTime = undefined
        a.jittered = false
        a.idleSeconds = 0
        a.atTableSec = 0
        ;(a as any)._wp = null
          ;(a as any)._stuck = 0
          ;(a as any)._lastReplan = 0
          ;(a as any)._replanAttempts = 0
        }

        const hadInvalidTarget =
          !a.target ||
          !Number.isFinite(a.target[0]) ||
          !Number.isFinite(a.target[1])
        const isKitchenTarget =
          !hadInvalidTarget &&
          a.target[0] === kitchenPoint.x &&
          a.target[1] === kitchenPoint.z
        if (hadInvalidTarget) {
          a.target = [kitchenPoint.x, kitchenPoint.z]
        }

        lastAgentSnapshot.current = {
          id: a.id,
          phase: a.phase,
          pos: [a.pos[0], a.pos[1]],
          target: [a.target[0], a.target[1]],
          servingTargetSpot: a.servingTargetSpot
            ? [a.servingTargetSpot[0], a.servingTargetSpot[1]]
            : undefined,
        }

        a.totalTimeSec = (a.totalTimeSec || 0) + d
        if (a.phase !== 'IDLE' && a.phase !== 'DESPAWN') {
          a.busyTimeSec = (a.busyTimeSec || 0) + d
        }

        const idleCondition =
          a.phase === 'IDLE' &&
          !a.servingTargetSpot &&
          (hadInvalidTarget || isKitchenTarget)
        if (idleCondition) {
          a.idleSeconds = (a.idleSeconds || 0) + idleDt
        } else {
          a.idleSeconds = 0
        }
        if (a.idleSeconds > 3.0 && a.phase !== 'EXITING' && a.phase !== 'DESPAWN') {
          a.phase = 'RETURNING'
          a.target = [kitchenPoint.x, kitchenPoint.z]
          a.tableId = -1
          a.tableCenter = undefined
          a.servingTargetTableId = undefined
          a.servingTargetSpot = undefined
          a.serviceSpots = undefined
          a.activeSpot = undefined
          a.lastDist = undefined
          a.lastProgressTime = now
          a.since = now
          a.jittered = false
          a.idleSeconds = 0
          ;(a as any)._wp = null
          ;(a as any)._stuck = 0
          ;(a as any)._lastReplan = now
          ;(a as any)._replanAttempts = 0
        }

        const ARRIVE_TABLE_EPS = 0.45
        let atTable = false
        if (a.servingTargetSpot && !hadInvalidTarget) {
          const spot = a.servingTargetSpot
          const spotDist = Math.hypot(a.pos[0] - spot[0], a.pos[1] - spot[1])
          const goalIsSpot =
            Math.hypot(a.target[0] - spot[0], a.target[1] - spot[1]) < 1e-3
          atTable = goalIsSpot && spotDist < ARRIVE_TABLE_EPS
        }
        if (atTable) {
          a.atTableSec = (a.atTableSec || 0) + idleDt
        } else {
          a.atTableSec = 0
        }
        if (a.atTableSec >= 3.0 && a.phase !== 'EXITING' && a.phase !== 'DESPAWN') {
          a.phase = 'RETURNING'
          a.target = [kitchenPoint.x, kitchenPoint.z]
          a.vel = [0, 0]
          a.tableId = -1
          a.tableCenter = undefined
          a.servingTargetTableId = undefined
          a.servingTargetSpot = undefined
          a.serviceSpots = undefined
          a.activeSpot = undefined
          a.lastDist = undefined
          a.lastProgressTime = now
          a.since = now
          a.jittered = false
          a.idleSeconds = 0
          a.atTableSec = 0
          ;(a as any)._wp = null
          ;(a as any)._stuck = 0
          ;(a as any)._lastReplan = now
          ;(a as any)._replanAttempts = 0
        }

        if (a.phase === 'IDLE') {
          a.pos[0] = kitchenPoint.x
          a.pos[1] = kitchenPoint.z
          a.vel = [0, 0]
          a.target = [kitchenPoint.x, kitchenPoint.z]
          a.tableId = -1
          a.tableCenter = undefined
          a.servingTargetTableId = undefined
          a.servingTargetSpot = undefined
          continue
        }
        if (a.phase === 'SERVING') {
          if (a.servingTargetSpot) {
            a.pos[0] = a.servingTargetSpot[0]
            a.pos[1] = a.servingTargetSpot[1]
          }
          a.vel = [0, 0]
        } else if (a.phase === 'GO_TO_TABLE' || a.phase === 'RETURNING' || a.phase === 'EXITING') {
          if (a.phase === 'EXITING') {
            a.target = [exitTarget.x, exitTarget.z]
          }
          const goal: [number, number] = a.target
          let wp: Waypoint = (a as any)._wp

          const needReplan =
            !wp ||
            Math.hypot(wp.x - a.pos[0], wp.z - a.pos[1]) < 0.18 ||
            ((a as any)._stuck > 0.8 && now - (a as any)._lastReplan > 0.35)

          if (needReplan) {
            const newWp = pickWaypoint(a.pos[0], a.pos[1], goal[0], goal[1], circles)
            ;(a as any)._wp = newWp
            ;(a as any)._lastReplan = now
            wp = newWp
          }

        const tx = wp ? wp.x : goal[0]
        const tz = wp ? wp.z : goal[1]

        const dx = tx - a.pos[0]
        const dz = tz - a.pos[1]
        const dist = Math.hypot(dx, dz) || 1e-6
        const goalDist = Math.hypot(goal[0] - a.pos[0], goal[1] - a.pos[1]) || 1e-6
        const arrivalRadius = Math.max(0.15, STAFF_RADIUS * 0.6)
        const spot = a.servingTargetSpot
        const spotDist = spot
          ? Math.hypot(spot[0] - a.pos[0], spot[1] - a.pos[1])
          : goalDist
        const repulsionScale =
          a.phase === 'SERVING' || (a.phase === 'GO_TO_TABLE' && spotDist < arrivalRadius * 1.5)
            ? servingRepulsionScale
            : 1
        let vtx = (dx / dist) * MAX_SPEED
        let vtz = (dz / dist) * MAX_SPEED
        let sepX = 0
        let sepZ = 0
        let repX = 0
        let repZ = 0
        const maxRepulse = 3.0

        const { rx, rz } = narrowGapRepulsion(a.pos[0], a.pos[1], circles, 0.48, 0.36)
        vtx += rx
        vtz += rz

        let px = 0
        let pz = 0
        let sx = 0
        let sz = 0

        for (const o of circles) {
          const ox = a.pos[0] - o.x
          const oz = a.pos[1] - o.z
          const dd = Math.hypot(ox, oz) || 1e-6
          const rAvoid = o.r + avoidanceRadius.staffObstacle
          if (dd < rAvoid) {
            const strength =
              (rAvoid - dd) *
              repulsionK.staffObstacle *
              repulsionScale
            repX += (ox / dd) * strength
            repZ += (oz / dd) * strength
          }
          const r0 = o.r + R + 0.08
          const r1 = r0 + 0.4
          const s = 1 - Math.min(1, Math.max(0, (dd - r0) / (r1 - r0)))
          if (s > 0) {
            px += (ox / dd) * s * OB_PUSH
            pz += (oz / dd) * s * OB_PUSH
            const txN = -oz / dd
            const tzN = ox / dd
            sx += txN * s * SLIDE
            sz += tzN * s * SLIDE
          }
        }

        for (const b of agents.current) {
          if (b === a || b.phase === 'DESPAWN') continue
          const ox = a.pos[0] - b.pos[0]
          const oz = a.pos[1] - b.pos[1]
          const dd = Math.hypot(ox, oz) || 1e-6
          if (dd < SEP_DIST) {
            const w = (SEP_DIST - dd) / SEP_DIST
            sepX += (ox / dd) * w
            sepZ += (oz / dd) * w
          }
          if (dd < avoidanceRadius.staffHuman) {
            const strength =
              (avoidanceRadius.staffHuman - dd) * repulsionK.staffHuman * repulsionScale
            repX += (ox / dd) * strength
            repZ += (oz / dd) * strength
          }
          const r0 = R * 2 + 0.05
          const r1 = r0 + 0.3
          const s = 1 - Math.min(1, Math.max(0, (dd - r0) / (r1 - r0)))
          if (s > 0) {
            px += (ox / dd) * s * (OB_PUSH * 0.8)
            pz += (oz / dd) * s * (OB_PUSH * 0.8)
          }
        }

        for (const o of crowd) {
          const ox = a.pos[0] - o.x
          const oz = a.pos[1] - o.z
          const dd = Math.hypot(ox, oz) || 1e-6
          const sep = SEP_DIST + o.r
          if (dd < sep) {
            const w = (sep - dd) / sep
            sepX += (ox / dd) * w
            sepZ += (oz / dd) * w
          }
          const rAvoid = o.r + avoidanceRadius.staffHuman
          if (dd < rAvoid) {
            const strength =
              (rAvoid - dd) * repulsionK.staffHuman * repulsionScale
            repX += (ox / dd) * strength
            repZ += (oz / dd) * strength
          }
        }

        const sepMag = Math.hypot(sepX, sepZ)
        if (sepMag > 1e-6) {
          const m = Math.min(sepMag, MAX_SEP_FORCE)
          vtx += (sepX / sepMag) * m
          vtz += (sepZ / sepMag) * m
        }

        const repMag = Math.hypot(repX, repZ)
        if (repMag > 1e-6) {
          const m = Math.min(repMag, maxRepulse)
          vtx += (repX / repMag) * m
          vtz += (repZ / repMag) * m
        }

        const speed = Math.hypot(a.vel[0], a.vel[1])
        ;(a as any)._stuck =
          speed < 0.05 ? (a as any)._stuck + d : Math.max(0, (a as any)._stuck - d * 0.5)

        if (a.lastDist === undefined) a.lastDist = goalDist
        if (a.lastProgressTime === undefined) a.lastProgressTime = now
        if (a.lastDist - goalDist >= 0.05) {
          a.lastDist = goalDist
          a.lastProgressTime = now
          ;(a as any)._replanAttempts = 0
        }

        if (a.phase === 'GO_TO_TABLE') {
          if (now - (a.lastProgressTime ?? 0) > 2) {
            const curIdx =
              typeof a.activeSpot === 'number' && (a.activeSpot === 0 || a.activeSpot === 1)
                ? a.activeSpot
                : 0
            const nextIdx = 1 - curIdx
            const next = a.serviceSpots ? a.serviceSpots[nextIdx] : undefined
            if (next) {
              a.target = [next[0], next[1]]
              a.activeSpot = nextIdx
              a.lastProgressTime = now
              a.lastDist = Math.hypot(a.target[0] - a.pos[0], a.target[1] - a.pos[1])
              a.servingTargetSpot = [next[0], next[1]]
              ;(a as any)._wp = null
            } else if (!a.jittered) {
              const side = ((a.id * 1103515245) >>> 1) & 1 ? 1 : -1
              const txN = -dz / dist
              const tzN = dx / dist
              a.target = [goal[0] + txN * 0.3 * side, goal[1] + tzN * 0.3 * side]
              a.jittered = true
              a.lastProgressTime = now
              a.lastDist = Math.hypot(a.target[0] - a.pos[0], a.target[1] - a.pos[1])
              ;(a as any)._wp = null
            }
          }
        }

        if ((a as any)._stuck > 0.9) {
          const txN = -dz / dist
          const tzN = dx / dist
          const side = ((a.id * 9301) ^ 49297) & 1 ? 1 : -1
          vtx += txN * 0.9 * side
          vtz += tzN * 0.9 * side
        }

        const ax_ = (vtx - a.vel[0]) * ACCEL + px + sx
        const az_ = (vtz - a.vel[1]) * ACCEL + pz + sz
        a.vel[0] = (a.vel[0] + ax_ * d) * DAMP
        a.vel[1] = (a.vel[1] + az_ * d) * DAMP
        const v = Math.hypot(a.vel[0], a.vel[1])
        if (v > MAX_SPEED) {
          a.vel[0] *= MAX_SPEED / v
          a.vel[1] *= MAX_SPEED / v
        }

        a.pos[0] += a.vel[0] * d
        a.pos[1] += a.vel[1] * d

        for (const o of circles) {
          const ox = a.pos[0] - o.x
          const oz = a.pos[1] - o.z
          const dd = Math.hypot(ox, oz)
          const hardR = o.r + R + HARD_PAD
          if (dd < hardR) {
            const nx2 = (ox || 1e-6) / dd
            const nz2 = (oz || 1e-6) / dd
            const push = hardR - dd + 1e-3
            a.pos[0] += nx2 * push * (1 + HARD_PUSH)
            a.pos[1] += nz2 * push * (1 + HARD_PUSH)
          }
        }

        if (wp) {
          const dd = Math.hypot(tx - a.pos[0], tz - a.pos[1])
          if (dd < 0.2) (a as any)._wp = null
        } else {
          const dd = Math.hypot(goal[0] - a.pos[0], goal[1] - a.pos[1])
          if (a.phase === 'GO_TO_TABLE' && spotDist < arrivalRadius) {
            a.pos[0] = spot ? spot[0] : goal[0]
            a.pos[1] = spot ? spot[1] : goal[1]
            a.vel = [0, 0]
            a.phase = 'SERVING'
            a.since = now
          } else if (a.phase === 'GO_TO_TABLE' && spot && dd < ARRIVE_EPS && spotDist > arrivalRadius) {
            a.target = [spot[0], spot[1]]
            ;(a as any)._wp = null
          } else if (a.phase === 'RETURNING' && dd < ARRIVE_EPS) {
            a.pos[0] = goal[0]
            a.pos[1] = goal[1]
            a.vel = [0, 0]
            a.phase = 'IDLE'
            a.tableId = -1
            a.tableCenter = undefined
            a.servingTargetTableId = undefined
            a.servingTargetSpot = undefined
            a.since = now
          } else if (a.phase === 'EXITING' && a.pos[1] <= exitOutZ) {
            a.phase = 'DESPAWN'
          }
        }
        if (now - (a.lastProgressTime ?? 0) > NO_PROGRESS_TIME) {
          const attempts = ((a as any)._replanAttempts as number) ?? 0
          if (attempts < MAX_REPLAN_ATTEMPTS) {
            ;(a as any)._replanAttempts = attempts + 1
            ;(a as any)._wp = null
            a.lastProgressTime = now
          } else {
            if (a.phase === 'EXITING' || !isRunning) {
              a.pos[0] = exitTarget.x
              a.pos[1] = exitOutZ
              a.vel = [0, 0]
              a.phase = 'DESPAWN'
            } else {
              a.pos[0] = kitchenPoint.x
              a.pos[1] = kitchenPoint.z
              a.vel = [0, 0]
              a.phase = 'IDLE'
              a.target = [kitchenPoint.x, kitchenPoint.z]
              a.tableId = -1
              a.tableCenter = undefined
              a.servingTargetTableId = undefined
              a.servingTargetSpot = undefined
              a.serviceSpots = undefined
              a.activeSpot = undefined
              a.since = now
            }
            continue
          }
        }
      } else if (a.phase === 'SERVING') {
        if (now - a.since > BASE_SERVICE_TIME * serviceCoef) {
          a.phase = 'RETURNING'
          a.target = [kitchenPoint.x, kitchenPoint.z]
          ;(a as any)._wp = null
        }
      }
    }

  if (onUtilization) {
    let total = 0
    let busy = 0
    for (const a of agents.current) {
      total += a.totalTimeSec || 0
      busy += a.busyTimeSec || 0
    }
    onUtilization(total > 1e-6 ? busy / total : 0)
  }
  onStaffCount?.(agents.current.length)

  if (agents.current.length) {
    agents.current = agents.current.filter((a) => a.phase !== 'DESPAWN')
  }
  } catch (err) {
    console.error('[Staff update error]', err, {
      lastAgent: lastAgentSnapshot.current,
      staffCount,
      isRunning,
    })
    for (const a of agents.current) {
      a.pos[0] = kitchenPoint.x
      a.pos[1] = kitchenPoint.z
      a.vel = [0, 0]
      a.phase = 'IDLE'
      a.target = [kitchenPoint.x, kitchenPoint.z]
      a.tableId = -1
      a.tableCenter = undefined
      a.servingTargetTableId = undefined
      a.servingTargetSpot = undefined
      a.serviceSpots = undefined
      a.activeSpot = undefined
      a.lastDist = undefined
      a.lastProgressTime = undefined
      a.jittered = false
      ;(a as any)._wp = null
      ;(a as any)._stuck = 0
      ;(a as any)._lastReplan = 0
      ;(a as any)._replanAttempts = 0
    }
  }
  })

  return (
    <group>
      {agents.current.map((a) => (
        <StaffMesh key={a.id} agent={a} />
      ))}
    </group>
  )
}

/* ---------- Ceiling & Service panels ---------- */
function Ceiling({ width, depth, height }: { width: number; depth: number; height: number }) {
  return (
    <mesh rotation={[Math.PI / 2, 0, 0]} position={[0, height + 0.01, 0]} receiveShadow>
      <planeGeometry args={[width + 0.02, depth + 0.02]} />
      <meshStandardMaterial color="#6f6f6f" roughness={0.9} />
    </mesh>
  )
}

function ServiceModule({
  side,
  color,
  along,
  height,
  roomW,
  roomD,
  wallT,
  doorLeft,
  doorWidth,
  pos,
  setPos,
}: {
  side: Side
  color: string
  along: number
  height: number
  roomW: number
  roomD: number
  wallT: number
  doorLeft: number
  doorWidth: number
  pos: number
  setPos: (v: number) => void
}) {
  const controls = useThree((s) => (s as any).controls) as any
  const dragging = useRef(false)
  const tmp = useMemo(() => new THREE.Vector3(), [])

  const SLAB_T = 0.02
  const EPS = 0.001

  const plane = useMemo(() => {
    if (side === 'left') {
      const x = -roomW / 2 + wallT + SLAB_T / 2 + EPS
      return new THREE.Plane(new THREE.Vector3(1, 0, 0), -x)
    }
    if (side === 'right') {
      const x = roomW / 2 - wallT - SLAB_T / 2 - EPS
      return new THREE.Plane(new THREE.Vector3(1, 0, 0), -x)
    }
    if (side === 'back') {
      const z = -roomD / 2 + wallT + SLAB_T / 2 + EPS
      return new THREE.Plane(new THREE.Vector3(0, 0, 1), -z)
    }
    const z = roomD / 2 - wallT - SLAB_T / 2 - EPS
    return new THREE.Plane(new THREE.Vector3(0, 0, 1), -z)
  }, [side, roomW, roomD, wallT])

  const margin = 0.05
  const range = useMemo(() => {
    if (side === 'left' || side === 'right')
      return {
        axis: 'z' as const,
        min: -roomD / 2 + margin + along / 2,
        max: roomD / 2 - margin - along / 2,
      }
    return {
      axis: 'x' as const,
      min: -roomW / 2 + margin + along / 2,
      max: roomW / 2 - margin - along / 2,
    }
  }, [side, roomW, roomD, along])

  const avoidDoor = useCallback(
    (v: number) => {
      if (side !== 'back') return v
      const dc = -roomW / 2 + doorLeft + doorWidth / 2
      const limit = doorWidth / 2 + along / 2 + 0.05
      if (Math.abs(v - dc) < limit) return v < dc ? dc - limit : dc + limit
      return v
    },
    [side, roomW, doorLeft, doorWidth, along],
  )

  const panelCenter: [number, number, number] = useMemo(() => {
    const y = height / 2
    if (side === 'left') return [-roomW / 2 + wallT + SLAB_T / 2 + EPS, y, pos]
    if (side === 'right') return [roomW / 2 - wallT - SLAB_T / 2 - EPS, y, pos]
    if (side === 'back') return [pos, y, -roomD / 2 + wallT + SLAB_T / 2 + EPS]
    return [pos, y, roomD / 2 - wallT - SLAB_T / 2 - EPS]
  }, [side, pos, roomW, roomD, wallT, height])

  const patchPos: [number, number, number] = useMemo(() => {
    const y = height / 2
    if (side === 'left') return [panelCenter[0] + SLAB_T / 2 + EPS, y, pos]
    if (side === 'right') return [panelCenter[0] - SLAB_T / 2 - EPS, y, pos]
    if (side === 'back') return [pos, y, panelCenter[2] + SLAB_T / 2 + EPS]
    return [pos, y, panelCenter[2] - SLAB_T / 2 - EPS]
  }, [side, pos, height, panelCenter])

  const patchRotY = useMemo(
    () =>
      side === 'left'
        ? -Math.PI / 2
        : side === 'right'
        ? Math.PI / 2
        : side === 'back'
        ? 0
        : Math.PI,
    [side],
  )

  const panelSize: [number, number, number] =
    side === 'left' || side === 'right'
      ? [SLAB_T, height, along]
      : [along, height, SLAB_T]

  const onDown = (e: any) => {
    e.stopPropagation()
    e.target.setPointerCapture?.(e.pointerId)
    dragging.current = true
    controls && (controls.enabled = false)
    document.body.style.cursor = 'grabbing'
  }
  const onUp = (e: any) => {
    e.stopPropagation()
    e.target.releasePointerCapture?.(e.pointerId)
    dragging.current = false
    controls && (controls.enabled = true)
    document.body.style.cursor = 'auto'
  }
  const onMove = (e: any) => {
    if (!dragging.current) return
    if (e.ray.intersectPlane(plane, tmp)) {
      let v = range.axis === 'x' ? tmp.x : tmp.z
      v = Math.round(v / 0.05) * 0.05
      v = clamp(v, range.min, range.max)
      v = avoidDoor(v)
      v = clamp(v, range.min, range.max)
      setPos(v)
    }
  }

  return (
    <group>
      <mesh
        position={panelCenter as any}
        onPointerDown={onDown}
        onPointerUp={onUp}
        onPointerMove={onMove}
        onPointerOver={() => (document.body.style.cursor = 'grab')}
        onPointerOut={() => !dragging.current && (document.body.style.cursor = 'auto')}
        castShadow
        receiveShadow
      >
        <boxGeometry args={panelSize} />
        <meshStandardMaterial color={color} roughness={0.8} />
      </mesh>
      <mesh position={patchPos as any} rotation={[0, patchRotY, 0]} renderOrder={2}>
        <planeGeometry
          args={[
            Math.max(0.02, (panelSize[0] === SLAB_T ? panelSize[2] : panelSize[0]) - 0.02),
            height - 0.02,
          ]}
        />
        <meshBasicMaterial
          color={color}
          toneMapped={false}
          polygonOffset
          polygonOffsetFactor={-1}
          polygonOffsetUnits={1}
        />
      </mesh>
    </group>
  )
}

/* ---------- Room composer ---------- */
function Room({
  cfg,
  doorLeft,
  setDoorLeft,
  onStats,
  isRunning,
  serviceCoef,
  effectiveIncoming,
}: {
  cfg: Config
  doorLeft: number
  setDoorLeft: (v: number) => void
  onStats?: (s: LiveStats) => void
  isRunning: boolean
  serviceCoef: number
  effectiveIncoming: number
}) {
  const hasAvoidance =
    !!cfg.avoidance?.radius &&
    isFiniteNumber(cfg.avoidance.radius.humanHuman) &&
    isFiniteNumber(cfg.avoidance.radius.humanObstacle) &&
    isFiniteNumber(cfg.avoidance.radius.staffHuman) &&
    isFiniteNumber(cfg.avoidance.radius.staffObstacle)
  const hasRepulsion =
    !!cfg.repulsion &&
    isFiniteNumber(cfg.repulsion.humanHuman) &&
    isFiniteNumber(cfg.repulsion.humanObstacle) &&
    isFiniteNumber(cfg.repulsion.staffHuman) &&
    isFiniteNumber(cfg.repulsion.staffObstacle)
  if (!hasAvoidance || !hasRepulsion) {
    console.error('[Room] Missing avoidance/repulsion config', cfg)
    return null
  }

  const backWallZ = -cfg.depth / 2 + cfg.wallT / 2

  const [kitchenPos, setKitchenPos] = useState(0)
  const [toiletPos, setToiletPos] = useState(0)

  useEffect(() => {
    const clampAlong = (side: Side, v: number, along: number) => {
      const margin = 0.05
      if (side === 'left' || side === 'right')
        return clamp(v, -cfg.depth / 2 + margin + along / 2, cfg.depth / 2 - margin - along / 2)
      return clamp(v, -cfg.width / 2 + margin + along / 2, cfg.width / 2 - margin - along / 2)
    }
    setKitchenPos((v) =>
      clampAlong(cfg.kitchenSide, v, Math.min(4.0, Math.max(2.0, cfg.width * 0.35))),
    )
    setToiletPos((v) => clampAlong(cfg.toiletSide, v, 2.0))
  }, [cfg.width, cfg.depth, cfg.kitchenSide, cfg.toiletSide])

  const toiletPoint = useMemo(() => {
    const m = 0.25
    if (cfg.toiletSide === 'left') return { x: -cfg.width / 2 + cfg.wallT + m, z: toiletPos }
    if (cfg.toiletSide === 'right') return { x: cfg.width / 2 - cfg.wallT - m, z: toiletPos }
    if (cfg.toiletSide === 'back') return { x: toiletPos, z: -cfg.depth / 2 + cfg.wallT + m }
    return { x: toiletPos, z: cfg.depth / 2 - cfg.wallT - m }
  }, [cfg.width, cfg.depth, cfg.wallT, cfg.toiletSide, toiletPos])

  const kitchenPoint = useMemo(() => {
    const m = 0.3
    if (cfg.kitchenSide === 'left') return { x: -cfg.width / 2 + cfg.wallT + m, z: kitchenPos }
    if (cfg.kitchenSide === 'right') return { x: cfg.width / 2 - cfg.wallT - m, z: kitchenPos }
    if (cfg.kitchenSide === 'back') return { x: kitchenPos, z: -cfg.depth / 2 + cfg.wallT + m }
    return { x: kitchenPos, z: cfg.depth / 2 - cfg.wallT - m }
  }, [cfg.width, cfg.depth, cfg.wallT, cfg.kitchenSide, kitchenPos])

  const staffExitTarget = useMemo(() => {
    const doorCX = -cfg.width / 2 + doorLeft + cfg.doorWidth / 2
    const innerMinZ = -cfg.depth / 2 + cfg.wallT
    return { x: doorCX, z: innerMinZ - 0.9 }
  }, [cfg.width, cfg.depth, cfg.wallT, doorLeft, cfg.doorWidth])

  const staffExitOutZ = useMemo(() => -cfg.depth / 2 + cfg.wallT - 1.2, [
    cfg.depth,
    cfg.wallT,
  ])

  const [obstacles, setObstacles] = useState<CircleObstacle[]>([])
  const [anchors, setAnchors] = useState<any[]>([])
  const [tables, setTables] = useState<TableTransform[]>([])
  const [serveRequests, setServeRequests] = useState<ServeReq[]>([])
  const nextServeId = useRef(1)
  const [crowdObs, setCrowdObs] = useState<CircleObstacle[]>([])
  const statsRef = useRef<LiveStats | null>(null)
  const staffUtilRef = useRef(0)
  const staffCountRef = useRef(0)
  const combinedKeyRef = useRef('')
  const emitStats = useCallback(() => {
    if (!onStats || !statsRef.current) return
    const combined = {
      ...statsRef.current,
      staffUtilization: staffUtilRef.current,
      staffCount: staffCountRef.current,
    }
    const key = JSON.stringify(combined)
    if (key === combinedKeyRef.current) return
    combinedKeyRef.current = key
    onStats(combined)
  }, [onStats])

  useEffect(() => {
    if (cfg.staffCount > 0) return
    staffUtilRef.current = 0
    emitStats()
  }, [cfg.staffCount, emitStats])

  const handleSeated = useCallback((p: { x: number; z: number; tableId: number }) => {
    setServeRequests((prev) => [...prev, { id: nextServeId.current++, tableId: p.tableId, x: p.x, z: p.z }])
  }, [])

  return (
    <group>
      <Floor width={cfg.width} depth={cfg.depth} />

      {/* Walls + Door */}
      <WallWithDoor
        width={cfg.width}
        height={cfg.height}
        thickness={cfg.wallT}
        doorWidth={cfg.doorWidth}
        doorHeight={cfg.doorHeight}
        doorLeft={doorLeft}
        position={[0, cfg.height / 2, backWallZ]}
      />
      <DraggableDoor
        wallZ={backWallZ}
        roomWidth={cfg.width}
        doorWidth={cfg.doorWidth}
        doorHeight={cfg.doorHeight}
        wallT={cfg.wallT}
        doorLeft={doorLeft}
        setDoorLeft={setDoorLeft}
      />

      <BoxWall w={cfg.width} h={cfg.height} t={cfg.wallT} position={[0, cfg.height / 2, cfg.depth / 2 - cfg.wallT / 2]} />
      <BoxWall w={cfg.wallT} h={cfg.height} t={cfg.depth} position={[-cfg.width / 2 + cfg.wallT / 2, cfg.height / 2, 0]} />
      <BoxWall w={cfg.wallT} h={cfg.height} t={cfg.depth} position={[cfg.width / 2 - cfg.wallT / 2, cfg.height / 2, 0]} />

      {/* Tables */}
      <DraggableTables
        twoCount={cfg.table2Count}
        fourCount={cfg.table4Count}
        room={{ width: cfg.width, depth: cfg.depth, wallT: cfg.wallT }}
        onObstaclesChange={setObstacles}
        onAnchorsChange={setAnchors}
        onTablesChange={setTables}
      />

      {/* People */}
      <People
        cfg={cfg}
        obstacles={obstacles}
        doorLeft={doorLeft}
        doorWidth={cfg.doorWidth}
        seats={anchors as SeatAnchorP[]}
        toiletPoint={toiletPoint}
        onStats={(s) => {
          statsRef.current = s
          emitStats()
        }}
        onSeated={handleSeated}
        onCrowdObstacles={setCrowdObs}
        isRunning={isRunning}
        effectiveIncoming={effectiveIncoming}
        serviceCoef={serviceCoef}
      />

      {/* Staff */}
      {cfg.staffCount > 0 && (
        <Staff
          kitchenPoint={kitchenPoint}
          exitTarget={staffExitTarget}
          exitOutZ={staffExitOutZ}
          obstacles={obstacles}
          crowdObs={crowdObs}
          requests={serveRequests}
          tables={tables}
          staffCount={cfg.staffCount}
          isRunning={isRunning}
          serviceCoef={serviceCoef}
          serviceMargin={cfg.staffServiceMargin}
          avoidanceRadius={cfg.avoidance.radius}
          repulsionK={cfg.repulsion}
          onUtilization={(u) => {
            staffUtilRef.current = u
            emitStats()
          }}
          onStaffCount={(count) => {
            staffCountRef.current = count
            emitStats()
          }}
        />
      )}

      {/* Service modules */}
      <ServiceModule
        side={cfg.kitchenSide}
        color={COL.kitchen}
        along={Math.min(4.0, Math.max(2.0, cfg.width * 0.35))}
        height={cfg.height}
        roomW={cfg.width}
        roomD={cfg.depth}
        wallT={cfg.wallT}
        doorLeft={doorLeft}
        doorWidth={cfg.doorWidth}
        pos={kitchenPos}
        setPos={setKitchenPos}
      />
      <ServiceModule
        side={cfg.toiletSide}
        color={COL.toilet}
        along={2.0}
        height={cfg.height}
        roomW={cfg.width}
        roomD={cfg.depth}
        wallT={cfg.wallT}
        doorLeft={doorLeft}
        doorWidth={cfg.doorWidth}
        pos={toiletPos}
        setPos={setToiletPos}
      />
    </group>
  )
}

/* ---------- default export ---------- */
export default function Restaurant({
  cfg,
  setCfg,
  doorLeft,
  setDoorLeft,
  onStats,
  isRunning,
  serviceCoef,
  effectiveIncoming,
}: {
  cfg: Config
  setCfg: React.Dispatch<React.SetStateAction<Config>>
  doorLeft: number
  setDoorLeft: (v: number) => void
  onStats?: (s: LiveStats) => void
  isRunning: boolean
  serviceCoef: number
  effectiveIncoming: number
}) {
  if (
    !cfg ||
    !isFiniteNumber(cfg.width) ||
    !isFiniteNumber(cfg.depth) ||
    !isFiniteNumber(cfg.height) ||
    !isFiniteNumber(cfg.wallT) ||
    !isFiniteNumber(cfg.doorWidth) ||
    !isFiniteNumber(cfg.doorHeight) ||
    !isFiniteNumber(doorLeft) ||
    !isFiniteNumber(serviceCoef) ||
    !isFiniteNumber(effectiveIncoming)
  ) {
    return null
  }
  const [showCeiling, setShowCeiling] = useState(false)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key.toLowerCase() === 'c' && setShowCeiling((v) => !v)
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  return (
    <>
      <SceneSettings />
      <FullscreenControls />
      <OrbitControls
        makeDefault
        target={[0, 1.2, 0]}
        maxPolarAngle={Math.PI / 2.05}
        minDistance={1.3}
        maxDistance={25}
        enableDamping
        dampingFactor={0.08}
      />
      <Lights />
      <Room
        cfg={cfg}
        doorLeft={doorLeft}
        setDoorLeft={setDoorLeft}
        onStats={onStats}
        isRunning={isRunning}
        serviceCoef={serviceCoef}
        effectiveIncoming={effectiveIncoming}
      />
      {showCeiling && <Ceiling width={cfg.width} depth={cfg.depth} height={cfg.height} />}
    </>
  )
}
