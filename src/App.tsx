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
import ErrorBoundary from './ErrorBoundary'

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
  // Time limit in seconds; 0 means no limit.
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

const toNumber = (v: unknown, fallback: number) => {
  const n = typeof v === 'number' ? v : Number(v)
  return Number.isFinite(n) ? n : fallback
}

const nonNegative = (v: unknown, fallback: number) =>
  Math.max(0, toNumber(v, fallback))

const normalizeSide = (v: unknown, fallback: Side): Side =>
  v === 'left' || v === 'right' || v === 'back' || v === 'front'
    ? v
    : fallback

const DEFAULT_CONFIG: Config = {
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
  // Default time limit: no limit.
  timeLimitSec: 0,
}

// Normalize restored cfg to fill missing nested avoidance/repulsion and prevent undefined access.
const normalizeConfig = (raw: Partial<Config> | any): Config => {
  const cfg =
    raw && typeof raw === 'object' ? (raw as Partial<Config>) : ({} as Partial<Config>)

  return {
    ...DEFAULT_CONFIG,
    ...cfg,
    width: nonNegative(cfg.width, DEFAULT_CONFIG.width),
    depth: nonNegative(cfg.depth, DEFAULT_CONFIG.depth),
    height: nonNegative(cfg.height, DEFAULT_CONFIG.height),
    wallT: nonNegative(cfg.wallT, DEFAULT_CONFIG.wallT),
    doorWidth: nonNegative(cfg.doorWidth, DEFAULT_CONFIG.doorWidth),
    doorHeight: nonNegative(cfg.doorHeight, DEFAULT_CONFIG.doorHeight),
    table4Count: nonNegative(cfg.table4Count, DEFAULT_CONFIG.table4Count),
    table2Count: nonNegative(cfg.table2Count, DEFAULT_CONFIG.table2Count),
    kitchenSide: normalizeSide(cfg.kitchenSide, DEFAULT_CONFIG.kitchenSide),
    toiletSide: normalizeSide(cfg.toiletSide, DEFAULT_CONFIG.toiletSide),
    incoming: nonNegative(cfg.incoming, DEFAULT_CONFIG.incoming),
    toiletProb: clamp(
      toNumber(cfg.toiletProb, DEFAULT_CONFIG.toiletProb),
      0,
      1,
    ),
    avgSpend: nonNegative(cfg.avgSpend, DEFAULT_CONFIG.avgSpend ?? 0),
    staffCount: nonNegative(cfg.staffCount, DEFAULT_CONFIG.staffCount),
    staffServiceMargin: nonNegative(
      cfg.staffServiceMargin,
      DEFAULT_CONFIG.staffServiceMargin,
    ),
    thresholdTablesPerStaff: nonNegative(
      cfg.thresholdTablesPerStaff,
      DEFAULT_CONFIG.thresholdTablesPerStaff,
    ),
    basePrice: nonNegative(cfg.basePrice, DEFAULT_CONFIG.basePrice),
    currentPrice: nonNegative(cfg.currentPrice, DEFAULT_CONFIG.currentPrice),
    priceElasticity: toNumber(cfg.priceElasticity, DEFAULT_CONFIG.priceElasticity),
    baseStaySec: nonNegative(cfg.baseStaySec, DEFAULT_CONFIG.baseStaySec),
    timeLimitOn:
      typeof cfg.timeLimitOn === 'boolean'
        ? cfg.timeLimitOn
        : DEFAULT_CONFIG.timeLimitOn,
    timeCapSec: nonNegative(cfg.timeCapSec, DEFAULT_CONFIG.timeCapSec),
    timeDiscountPct: nonNegative(
      cfg.timeDiscountPct,
      DEFAULT_CONFIG.timeDiscountPct,
    ),
    timeLimitSec: nonNegative(cfg.timeLimitSec, DEFAULT_CONFIG.timeLimitSec),
    avoidance: {
      radius: {
        humanHuman: nonNegative(
          cfg.avoidance?.radius?.humanHuman,
          DEFAULT_CONFIG.avoidance.radius.humanHuman,
        ),
        humanStaff: nonNegative(
          cfg.avoidance?.radius?.humanStaff,
          DEFAULT_CONFIG.avoidance.radius.humanStaff,
        ),
        humanObstacle: nonNegative(
          cfg.avoidance?.radius?.humanObstacle,
          DEFAULT_CONFIG.avoidance.radius.humanObstacle,
        ),
        staffHuman: nonNegative(
          cfg.avoidance?.radius?.staffHuman,
          DEFAULT_CONFIG.avoidance.radius.staffHuman,
        ),
        staffObstacle: nonNegative(
          cfg.avoidance?.radius?.staffObstacle,
          DEFAULT_CONFIG.avoidance.radius.staffObstacle,
        ),
      },
    },
    repulsion: {
      humanHuman: nonNegative(
        cfg.repulsion?.humanHuman,
        DEFAULT_CONFIG.repulsion.humanHuman,
      ),
      humanStaff: nonNegative(
        cfg.repulsion?.humanStaff,
        DEFAULT_CONFIG.repulsion.humanStaff,
      ),
      humanObstacle: nonNegative(
        cfg.repulsion?.humanObstacle,
        DEFAULT_CONFIG.repulsion.humanObstacle,
      ),
      staffHuman: nonNegative(
        cfg.repulsion?.staffHuman,
        DEFAULT_CONFIG.repulsion.staffHuman,
      ),
      staffObstacle: nonNegative(
        cfg.repulsion?.staffObstacle,
        DEFAULT_CONFIG.repulsion.staffObstacle,
      ),
    },
  }
}

export default function App() {
  const [cfg, setCfg] = useState<Config>(() => normalizeConfig(DEFAULT_CONFIG))
  const safeCfg = useMemo(() => normalizeConfig(cfg), [cfg])

  // Door left edge position.
  const initialDoorLeft = useMemo(
    () => (safeCfg.width - safeCfg.doorWidth) / 2,
    [],
  )
  const [doorLeft, setDoorLeft] = useState(initialDoorLeft)

  useEffect(() => {
    const m = 0.1
    setDoorLeft(v =>
      clamp(v, m, Math.max(m, safeCfg.width - safeCfg.doorWidth - m)),
    )
  }, [safeCfg.width, safeCfg.doorWidth])

  useEffect(() => {
    const normalized = normalizeConfig(cfg)
    if (JSON.stringify(normalized) !== JSON.stringify(cfg)) {
      setCfg(normalized)
    }
  }, [cfg])

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

  // Total sales = departed count * effective average spend.
  const [totalSales, setTotalSales] = useState(0)
  const lastDeparted = useRef(0)

  const timeDiscount = Math.min(30, Math.max(0, safeCfg.timeDiscountPct || 0))
  const effectiveAvgSpend = safeCfg.timeLimitOn
    ? (safeCfg.avgSpend || 0) * (1 - timeDiscount / 100)
    : safeCfg.avgSpend || 0

  useEffect(() => {
    if (stats.departed > lastDeparted.current) {
      const diff = stats.departed - lastDeparted.current
      setTotalSales(prev => prev + diff * effectiveAvgSpend)
      lastDeparted.current = stats.departed
    }
  }, [stats.departed, effectiveAvgSpend])

  const activeTables = stats.activeTables || 0
  const staffForLoad = Math.max(1, safeCfg.staffCount || 0)
  const threshold = safeCfg.thresholdTablesPerStaff || 0
  const load = activeTables / staffForLoad
  const LOAD_K = 0.25
  const serviceCoef =
    load <= threshold ? 1.0 : 1.0 + LOAD_K * (load - threshold)
  const priceRatio =
    safeCfg.basePrice > 0 && safeCfg.currentPrice > 0
      ? safeCfg.currentPrice / safeCfg.basePrice
      : 1
  const effectiveIncoming =
    (safeCfg.incoming || 0) * Math.pow(priceRatio, safeCfg.priceElasticity || 0)

  // =========================
  // Timer / run control
  // =========================
  const [isRunning, setIsRunning] = useState(true)

  // remainingSec: -1 means no limit.
  const [remainingSec, setRemainingSec] = useState<number>(-1)

  const startedAtRef = useRef<number | null>(null) // performance.now() in seconds
  const elapsedRef = useRef<number>(0) // accumulated elapsed time across pauses
  const limitSec = Math.max(0, Math.floor(safeCfg.timeLimitSec || 0))
  const nowSec = performance.now() / 1000
  const elapsedSeconds =
    limitSec > 0
      ? Math.max(0, limitSec - Math.max(0, remainingSec))
      : elapsedRef.current +
        (isRunning && startedAtRef.current != null
          ? nowSec - startedAtRef.current
          : 0)
  const totalSeats = safeCfg.table4Count * 4 + safeCfg.table2Count * 2
  const elapsedHours = Math.max(0, elapsedSeconds || 0) / 3600
  const revPASHPerHour =
    totalSeats > 0 && elapsedHours > 1e-6
      ? totalSales / (totalSeats * elapsedHours)
      : undefined

  // Capture start time when switching to running.
  useEffect(() => {
    if (isRunning && startedAtRef.current == null) {
      startedAtRef.current = performance.now() / 1000
    }
    if (!isRunning) {
      // When stopping, finalize elapsed and clear startedAt.
      if (startedAtRef.current != null) {
        const now = performance.now() / 1000
        elapsedRef.current += now - startedAtRef.current
        startedAtRef.current = null
      }
    }
  }, [isRunning])

  // Restart timing when the limit changes.
  useEffect(() => {
    elapsedRef.current = 0
    if (limitSec <= 0) {
      setRemainingSec(-1)
    } else {
      setRemainingSec(limitSec)
    }
    // If running, reset the start time.
    if (isRunning) startedAtRef.current = performance.now() / 1000
  }, [limitSec])

  const resetTimer = useCallback(() => {
    elapsedRef.current = 0
    if (limitSec <= 0) setRemainingSec(-1)
    else setRemainingSec(limitSec)
    if (isRunning) startedAtRef.current = performance.now() / 1000
    else startedAtRef.current = null
  }, [limitSec, isRunning])

  // Timer progression (auto-stop on limit).
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
        // Auto-stop when time runs out.
        elapsedRef.current = limitSec
        startedAtRef.current = null
        setIsRunning(false)
      }
    }, 100)

    return () => window.clearInterval(id)
  }, [isRunning, limitSec])

  return (
    <ErrorBoundary>
      <div
        className="relative min-h-screen text-cyan-200 font-light overflow-hidden holo-space"
        style={{
          background:
            'radial-gradient(circle at center, rgba(0,255,255,0.08) 0%, rgba(0,0,20,0.95) 80%)',
        }}
      >
      {/* Background glow */}
      <div
        style={{
          position: 'absolute',
          inset: 0,
          backgroundImage: [
            'radial-gradient(circle at 30% 50%, rgba(0,255,255,0.08) 0%, transparent 70%)',
            'radial-gradient(circle at 70% 60%, rgba(0,150,255,0.1) 0%, transparent 70%)',
            'linear-gradient(180deg, rgba(0,0,20,0.9) 0%, rgba(0,0,0,1) 100%)',
          ].join(','),
          filter: 'blur(40px)',
          zIndex: 0,
        }}
      />

      {/* Hologram grid */}
      <div
        style={{
          position: 'absolute',
          inset: 0,
          backgroundImage: [
            'linear-gradient(90deg, rgba(0,255,255,0.03) 1px, transparent 1px)',
            'linear-gradient(180deg, rgba(0,255,255,0.03) 1px, transparent 1px)',
          ].join(','),
          backgroundSize: '80px 80px',
          opacity: 0.3,
          zIndex: 1,
        }}
      />

      {/* Shimmer layer */}
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
            cfg={safeCfg}
            setCfg={setCfg}
            doorLeft={doorLeft}
            setDoorLeft={setDoorLeft}
            onStats={setStats}
            isRunning={isRunning} // required for simulation timing
            serviceCoef={serviceCoef}
            effectiveIncoming={effectiveIncoming}
          />
        </Suspense>
      </Canvas>

      {/* Control panel */}
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
          cfg={safeCfg}
          setCfg={setCfg}
          doorLeft={doorLeft}
          setDoorLeft={(v: number) => {
            const m = 0.1
            setDoorLeft(
              clamp(v, m, Math.max(m, safeCfg.width - safeCfg.doorWidth - m)),
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

      {/* Title logo */}
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
    </ErrorBoundary>
  )
}
