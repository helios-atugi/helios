// src/App.tsx
import React, {
  useEffect,
  useMemo,
  useRef,
  useState,
  Suspense,
  useCallback,
} from 'react'
import { Canvas } from '@react-three/fiber'
import Restaurant from './components/Scene/Restaurant'
import ControlPanel from './components/ControlPanel/ControlPanel'

export type Side = 'left' | 'right' | 'back' | 'front'

export type Config = {
  width: number
  depth: number
  height: number
  wallT: number
  doorWidth: number
  doorHeight: number
  table4Count: number
  table2Count: number
  kitchenSide: Side
  toiletSide: Side
  incoming: number
  toiletProb: number
  avgSpend?: number
  staffCount: number
  staffServiceMargin: number
  thresholdTablesPerStaff: number
  basePrice: number
  currentPrice: number
  priceElasticity: number
  baseStaySec: number
  timeLimitOn: boolean
  timeCapSec: number
  timeDiscountPct: number
  avoidance: {
    radius: {
      humanHuman: number
      humanStaff: number
      humanObstacle: number
      staffHuman: number
      staffObstacle: number
    }
  }
  repulsion: {
    humanHuman: number
    humanStaff: number
    humanObstacle: number
    staffHuman: number
    staffObstacle: number
  }

  // ★ 追加：制限時間（秒） 0なら無制限
  timeLimitSec: number
}

export type LiveStats = {
  pending: number
  inside: number
  seated: number
  exiting: number
  departed: number
  activeTables: number
  staffCount: number
  staffUtilization?: number
  revPASHPerSec?: number
  revPASHPerHour?: number
}

const clamp = (v: number, min: number, max: number) =>
  Math.min(Math.max(v, min), max)

export default function App() {
  const [cfg, setCfg] = useState<Config>({
    width: 8,
    depth: 10,
    height: 2.6,
    wallT: 0.2,
    doorWidth: 1.2,
    doorHeight: 2.0,
    table4Count: 0,
    table2Count: 0,
    kitchenSide: 'right',
    toiletSide: 'left',
    incoming: 0,
    toiletProb: 0.51,
    avgSpend: 1500,
    staffCount: 0,
    staffServiceMargin: 0.6,
    thresholdTablesPerStaff: 4.0,
    basePrice: 1500,
    currentPrice: 1500,
    priceElasticity: -1.0,
    baseStaySec: 70,
    timeLimitOn: false,
    timeCapSec: 90,
    timeDiscountPct: 10,
    avoidance: {
      radius: {
        humanHuman: 0.9,
        humanStaff: 1.0,
        humanObstacle: 1.1,
        staffHuman: 1.1,
        staffObstacle: 1.3,
      },
    },
    repulsion: {
      humanHuman: 0.8,
      humanStaff: 1.0,
      humanObstacle: 1.2,
      staffHuman: 1.5,
      staffObstacle: 2.0,
    },

    // ★ 初期：無制限
    timeLimitSec: 0,
  })

  // ドア左端の位置
  const initialDoorLeft = useMemo(
    () => (cfg.width - cfg.doorWidth) / 2,
    []
  )
  const [doorLeft, setDoorLeft] = useState(initialDoorLeft)

  useEffect(() => {
    const m = 0.1
    setDoorLeft(v =>
      clamp(v, m, Math.max(m, cfg.width - cfg.doorWidth - m)),
    )
  }, [cfg.width, cfg.doorWidth])

  const [stats, setStats] = useState<LiveStats>({
    pending: 0,
    inside: 0,
    seated: 0,
    exiting: 0,
    departed: 0,
    activeTables: 0,
    staffCount: 0,
    staffUtilization: 0,
  })

  // 累計売上（退店人数 × 実効客単価）
  const [totalSales, setTotalSales] = useState(0)
  const lastDeparted = useRef(0)

  const timeDiscount = Math.min(30, Math.max(0, cfg.timeDiscountPct || 0))
  const effectiveAvgSpend = cfg.timeLimitOn
    ? (cfg.avgSpend || 0) * (1 - timeDiscount / 100)
    : (cfg.avgSpend || 0)

  useEffect(() => {
    if (stats.departed > lastDeparted.current) {
      const diff = stats.departed - lastDeparted.current
      setTotalSales(prev => prev + diff * effectiveAvgSpend)
      lastDeparted.current = stats.departed
    }
  }, [stats.departed, effectiveAvgSpend])

  const activeTables = stats.activeTables || 0
  const staffForLoad = Math.max(1, cfg.staffCount || 0)
  const threshold = cfg.thresholdTablesPerStaff || 0
  const load = activeTables / staffForLoad
  const LOAD_K = 0.25
  const serviceCoef =
    load <= threshold ? 1.0 : 1.0 + LOAD_K * (load - threshold)
  const priceRatio =
    cfg.basePrice > 0 && cfg.currentPrice > 0
      ? cfg.currentPrice / cfg.basePrice
      : 1
  const effectiveIncoming = (cfg.incoming || 0) * Math.pow(priceRatio, cfg.priceElasticity || 0)

  // =========================
  // ★ タイマー / 停止制御
  // =========================
  const [isRunning, setIsRunning] = useState(true)

  // remainingSec: -1 = 無制限
  const [remainingSec, setRemainingSec] = useState<number>(-1)

  const startedAtRef = useRef<number | null>(null) // performance.now() 秒
  const elapsedRef = useRef<number>(0) // 停止を挟んでも累計経過秒

  const limitSec = Math.max(0, Math.floor(cfg.timeLimitSec || 0))
  const nowSec = performance.now() / 1000
  const elapsedSeconds =
    limitSec > 0
      ? Math.max(0, limitSec - Math.max(0, remainingSec))
      : elapsedRef.current +
        (isRunning && startedAtRef.current != null
          ? nowSec - startedAtRef.current
          : 0)
  const totalSeats = cfg.table4Count * 4 + cfg.table2Count * 2
  const elapsedHours = Math.max(0, elapsedSeconds || 0) / 60
  const revPASHPerHour =
    totalSeats > 0 && elapsedHours > 1e-6
      ? totalSales / (totalSeats * elapsedHours)
      : undefined

  // runningになった瞬間に開始時刻を入れる
  useEffect(() => {
    if (isRunning && startedAtRef.current == null) {
      startedAtRef.current = performance.now() / 1000
    }
    if (!isRunning) {
      // 停止した瞬間は、elapsedを確定させて startedAt をnullに
      if (startedAtRef.current != null) {
        const now = performance.now() / 1000
        elapsedRef.current += now - startedAtRef.current
        startedAtRef.current = null
      }
    }
  }, [isRunning])

  // 制限時間が変更されたら「いまから」カウントし直し（自然な挙動）
  useEffect(() => {
    elapsedRef.current = 0
    if (limitSec <= 0) {
      setRemainingSec(-1)
    } else {
      setRemainingSec(limitSec)
    }
    // 走ってるなら開始点を更新
    if (isRunning) startedAtRef.current = performance.now() / 1000
  }, [limitSec])

  const resetTimer = useCallback(() => {
    elapsedRef.current = 0
    if (limitSec <= 0) setRemainingSec(-1)
    else setRemainingSec(limitSec)
    if (isRunning) startedAtRef.current = performance.now() / 1000
    else startedAtRef.current = null
  }, [limitSec, isRunning])

  // タイマー進行（自動停止）
  useEffect(() => {
    if (!isRunning) return

    const id = window.setInterval(() => {
      if (limitSec <= 0) {
        setRemainingSec(-1)
        return
      }

      const now = performance.now() / 1000
      const started = startedAtRef.current ?? now
      const elapsed = elapsedRef.current + (now - started)
      const remain = Math.max(0, limitSec - elapsed)

      setRemainingSec(remain)

      if (remain <= 0) {
        // ★ 自動停止（リロードしない）
        elapsedRef.current = limitSec
        startedAtRef.current = null
        setIsRunning(false)
      }
    }, 100)

    return () => window.clearInterval(id)
  }, [isRunning, limitSec])

  return (
    <div
      className="relative min-h-screen text-cyan-200 font-light overflow-hidden holo-space"
      style={{
        background:
          'radial-gradient(circle at center, rgba(0,255,255,0.08) 0%, rgba(0,0,20,0.95) 80%)',
      }}
    >
      {/* 背景グロー */}
      <div
        style={{
          position: 'absolute',
          inset: 0,
          backgroundImage: `
            radial-gradient(circle at 30% 50%, rgba(0,255,255,0.08) 0%, transparent 70%),
            radial-gradient(circle at 70% 60%, rgba(0,150,255,0.1) 0%, transparent 70%),
            linear-gradient(180deg, rgba(0,0,20,0.9) 0%, rgba(0,0,0,1) 100%)
          `,
          filter: 'blur(40px)',
          zIndex: 0,
        }}
      />

      {/* ホログラムグリッド */}
      <div
        style={{
          position: 'absolute',
          inset: 0,
          backgroundImage:
            'linear-gradient(90deg, rgba(0,255,255,0.03) 1px, transparent 1px), linear-gradient(180deg, rgba(0,255,255,0.03) 1px, transparent 1px)',
          backgroundSize: '80px 80px',
          opacity: 0.3,
          zIndex: 1,
        }}
      />

      {/* ゆらめく光層 */}
      <div className="holo-overlay" />

      {/* Three.js Canvas */}
      <Canvas
        frameloop="always"
        shadows
        dpr={[1, 1.5]}
        camera={{ fov: 45, position: [0, 3.2, 7] }}
        style={{
          width: '100vw',
          height: '100vh',
          display: 'block',
          background: 'transparent',
          zIndex: 2,
        }}
      >
        <Suspense fallback={null}>
          <Restaurant
            cfg={cfg}
            setCfg={setCfg}
            doorLeft={doorLeft}
            setDoorLeft={setDoorLeft}
            onStats={setStats}
            isRunning={isRunning} // ★ ここ重要
            serviceCoef={serviceCoef}
            effectiveIncoming={effectiveIncoming}
          />
        </Suspense>
      </Canvas>

      {/* コントロールパネル */}
      <div
        style={{
          position: 'fixed',
          left: 24,
          top: 24,
          zIndex: 10,
          border: '1px solid rgba(0,255,255,0.3)',
          background: 'rgba(5,10,25,0.85)',
          boxShadow:
            '0 0 25px rgba(0,255,255,0.18), 0 0 80px rgba(0,180,255,0.22)',
          backdropFilter: 'blur(20px)',
          borderRadius: '22px',
          padding: '16px 16px 20px 16px',
          overflowX: 'hidden',
        }}
      >
          <ControlPanel
            cfg={cfg}
            setCfg={setCfg}
            doorLeft={doorLeft}
            setDoorLeft={(v: number) => {
              const m = 0.1
              setDoorLeft(
                clamp(v, m, Math.max(m, cfg.width - cfg.doorWidth - m)),
              )
            }}
            stats={{ ...stats, revPASHPerHour }}
            totalSales={totalSales}
            elapsedSeconds={elapsedSeconds}
            isRunning={isRunning}
            remainingSec={remainingSec}
            onToggleRun={() => setIsRunning(v => !v)}
            onResetTimer={resetTimer}
          />
      </div>

      {/* タイトルロゴ */}
      <div
        className="holo-glow"
        style={{
          position: 'fixed',
          bottom: 24,
          right: 32,
          fontSize: '0.95rem',
          letterSpacing: '0.14em',
          color: 'rgba(0,255,255,0.82)',
          textShadow: '0 0 15px rgba(0,255,255,0.7)',
        }}
      >
        HELIOS SIMULATION
      </div>
    </div>
  )
}
