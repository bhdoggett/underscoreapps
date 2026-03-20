import { useState, useCallback, useRef } from 'react'
import AppHeader from '../../components/AppHeader'
import styles from './DiceApp.module.css'

// Classical pip positions (cx, cy) as % of SVG viewBox
const PIPS: Record<number, [number, number][]> = {
  1: [[50, 50]],
  2: [[70, 30], [30, 70]],
  3: [[70, 30], [50, 50], [30, 70]],
  4: [[30, 30], [70, 30], [30, 70], [70, 70]],
  5: [[30, 30], [70, 30], [50, 50], [30, 70], [70, 70]],
  6: [[30, 30], [70, 30], [30, 50], [70, 50], [30, 70], [70, 70]],
}

function Die({ value, size }: { value: number; size: number }) {
  const pips = PIPS[value]
  return (
    <svg width={size} height={size} viewBox="0 0 100 100" className={styles.die}>
      <rect x="5" y="5" width="90" height="90" rx="5" className={styles.dieBody} />
      {pips ? (
        pips.map(([cx, cy], i) => (
          <circle key={i} cx={cx} cy={cy} r="7.5" className={styles.pip} />
        ))
      ) : (
        <text x="50" y="63" textAnchor="middle" className={styles.dieNum}>
          {value}
        </text>
      )}
    </svg>
  )
}

// Abramowitz & Stegun normal CDF approximation
function normalCDF(z: number): number {
  const t = 1 / (1 + 0.2316419 * Math.abs(z))
  const d = 0.3989423 * Math.exp(-z * z / 2)
  const p = d * t * (0.3193815 + t * (-0.3565638 + t * (1.7814779 + t * (-1.8212560 + t * 1.3302744))))
  return z >= 0 ? 1 - p : p
}

function rollPercentile(total: number, numDice: number, numSides: number): number {
  const expected = numDice * (numSides + 1) / 2
  const stdDev = Math.sqrt(numDice * (numSides ** 2 - 1) / 12)
  return normalCDF((total - expected) / stdDev)
}

function calcStats(values: number[]) {
  if (!values.length) return null
  const n = values.length
  const sorted = [...values].sort((a, b) => a - b)
  const total = values.reduce((a, b) => a + b, 0)
  const mean = total / n
  const mid = Math.floor(n / 2)
  const median = n % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
  const freq: Record<number, number> = {}
  values.forEach(r => { freq[r] = (freq[r] || 0) + 1 })
  const maxFreq = Math.max(...Object.values(freq))
  const modes = Object.entries(freq).filter(([, f]) => f === maxFreq).map(([v]) => +v)
  const variance = values.reduce((s, r) => s + (r - mean) ** 2, 0) / n
  return {
    total,
    mean: +mean.toFixed(2),
    median,
    mode: modes.join(', '),
    stdDev: +Math.sqrt(variance).toFixed(2),
    min: sorted[0],
    max: sorted[n - 1],
    range: sorted[n - 1] - sorted[0],
  }
}

function Histogram({
  freqMap,
  numSides,
  totalDice,
}: {
  freqMap: Record<number, number>
  numSides: number
  totalDice: number
}) {
  const values = Array.from({ length: numSides }, (_, i) => i + 1)
  const counts = values.map(v => freqMap[v] || 0)
  const maxCount = Math.max(...counts, 1)
  const expected = totalDice / numSides

  const vbW = 560
  const vbH = 120
  const padTop = 8
  const padBot = numSides <= 24 ? 22 : 4
  const padSide = 2
  const chartW = vbW - padSide * 2
  const chartH = vbH - padTop - padBot
  const barSlot = chartW / numSides
  const barW = Math.max(barSlot - 1.5, 1)
  const expectedY = padTop + chartH - (expected / maxCount) * chartH

  return (
    <svg
      viewBox={`0 0 ${vbW} ${vbH}`}
      className={styles.histogram}
      preserveAspectRatio="none"
    >
      {values.map((v, i) => {
        const x = padSide + i * barSlot
        const barH = (counts[i] / maxCount) * chartH
        const y = padTop + chartH - barH
        return (
          <g key={v}>
            <rect
              x={x + 0.5}
              y={y}
              width={barW}
              height={barH}
              className={styles.histBar}
            />
            {numSides <= 24 && (
              <text
                x={x + barSlot / 2}
                y={vbH - 5}
                textAnchor="middle"
                className={styles.histAxisLabel}
              >
                {v}
              </text>
            )}
          </g>
        )
      })}
      <line
        x1={padSide}
        x2={vbW - padSide}
        y1={expectedY}
        y2={expectedY}
        className={styles.histExpectedLine}
      />
    </svg>
  )
}

function randRolls(dice: number, sides: number) {
  return Array.from({ length: dice }, () => Math.floor(Math.random() * sides) + 1)
}

export default function DiceApp() {
  const [numDice, setNumDice] = useState(2)
  const [numSides, setNumSides] = useState(6)
  const [display, setDisplay] = useState<number[]>([])
  const [history, setHistory] = useState<number[][]>([])
  const [rolling, setRolling] = useState(false)
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const clearHistory = () => {
    setHistory([])
    setDisplay([])
  }

  const changeDice = (n: number) => { setNumDice(n); clearHistory() }
  const changeSides = (n: number) => { setNumSides(n); clearHistory() }

  const roll = useCallback(() => {
    if (rolling) return
    setRolling(true)
    intervalRef.current = setInterval(() => {
      setDisplay(randRolls(numDice, numSides))
    }, 55)
    setTimeout(() => {
      if (intervalRef.current) clearInterval(intervalRef.current)
      const results = randRolls(numDice, numSides)
      setDisplay(results)
      setHistory(h => [...h, results])
      setRolling(false)
    }, 500)
  }, [numDice, numSides, rolling])

  // All individual die values across all rolls
  const allValues = history.flat()

  // Frequency map for histogram
  const freqMap: Record<number, number> = {}
  for (let v = 1; v <= numSides; v++) freqMap[v] = 0
  allValues.forEach(v => { freqMap[v] = (freqMap[v] || 0) + 1 })

  // Per-roll totals
  const rollTotals = history.map(r => r.reduce((a, b) => a + b, 0))

  // Last roll
  const lastRoll = history[history.length - 1] ?? []
  const lastTotal = lastRoll.reduce((a, b) => a + b, 0)

  const expectedTotal = +(numDice * (numSides + 1) / 2).toFixed(1)
  const expectedValue = +((numSides + 1) / 2).toFixed(2)

  const percentile =
    history.length > 0 && numDice >= 2
      ? rollPercentile(lastTotal, numDice, numSides)
      : null

  const valueStats = calcStats(allValues)
  const totalStatsData = calcStats(rollTotals)

  // Die display
  const shown =
    display.length === numDice
      ? display
      : Array(numDice).fill(numSides <= 6 ? 1 : Math.ceil(numSides / 2))

  const dieSize =
    numDice === 1 ? 156
    : numDice <= 3 ? 126
    : numDice <= 6 ? 98
    : numDice <= 12 ? 72
    : 52

  const hasHistory = history.length > 0

  return (
    <div className={styles.app}>
      <AppHeader title="dice" />

      <div className={styles.controls}>
        <div className={styles.control}>
          <span className={styles.controlLabel}>dice</span>
          <div className={styles.stepper}>
            <button className={styles.stepBtn} onClick={() => changeDice(Math.max(1, numDice - 1))}>−</button>
            <span className={styles.stepVal}>{numDice}</span>
            <button className={styles.stepBtn} onClick={() => changeDice(Math.min(20, numDice + 1))}>+</button>
          </div>
        </div>
        <div className={styles.control}>
          <span className={styles.controlLabel}>sides</span>
          <div className={styles.stepper}>
            <button className={styles.stepBtn} onClick={() => changeSides(Math.max(2, numSides - 1))}>−</button>
            <span className={styles.stepVal}>{numSides}</span>
            <button className={styles.stepBtn} onClick={() => changeSides(numSides + 1)}>+</button>
          </div>
        </div>
      </div>

      <div className={styles.diceGrid}>
        {shown.map((val, i) => (
          <div
            key={i}
            className={rolling ? styles.dieWrapRolling : styles.dieWrap}
            style={{ animationDelay: `${i * 25}ms` }}
          >
            <Die value={val} size={dieSize} />
          </div>
        ))}
      </div>

      <div className={styles.rollRow}>
        <button className={styles.rollBtn} onClick={roll} disabled={rolling}>
          {rolling ? 'rolling...' : 'roll'}
        </button>
        {hasHistory && (
          <button className={styles.clearBtn} onClick={clearHistory}>
            clear
          </button>
        )}
      </div>

      {hasHistory && (
        <>
          {/* Current roll stats */}
          <div className={styles.statsBlock}>
            <div className={styles.rule} />
            {([
              ['total', lastTotal],
              ['expected', expectedTotal],
              ...(percentile !== null
                ? [[
                    'percentile',
                    percentile >= 0.5
                      ? `top ${((1 - percentile) * 100).toFixed(0)}%`
                      : `bottom ${(percentile * 100).toFixed(0)}%`,
                  ]]
                : []),
            ] as [string, string | number][]).map(([label, val]) => (
              <div key={label} className={styles.statRow}>
                <span className={styles.statLabel}>{label}</span>
                <span className={styles.statVal}>{val}</span>
              </div>
            ))}
          </div>

          {/* Histogram */}
          <div className={styles.histogramBlock}>
            <div className={styles.histHeader}>
              <span className={styles.sectionLabel}>distribution</span>
              <span className={styles.sectionMeta}>
                {history.length} roll{history.length !== 1 ? 's' : ''} · {allValues.length} dice
              </span>
            </div>
            <Histogram freqMap={freqMap} numSides={numSides} totalDice={allValues.length} />
            <div className={styles.histLegend}>
              <span className={styles.legendExpected}>— expected frequency</span>
            </div>
          </div>

          {/* Cumulative individual value stats */}
          {valueStats && (
            <div className={styles.statsBlock}>
              <div className={styles.rule} />
              {([
                ['mean value', valueStats.mean],
                ['expected value', expectedValue],
                ['std dev', valueStats.stdDev],
                ['mode', valueStats.mode],
                ['min', valueStats.min],
                ['max', valueStats.max],
              ] as [string, string | number][]).map(([label, val]) => (
                <div key={label} className={styles.statRow}>
                  <span className={styles.statLabel}>{label}</span>
                  <span className={styles.statVal}>{val}</span>
                </div>
              ))}
            </div>
          )}

          {/* Cross-roll stats — only meaningful with multiple rolls */}
          {history.length > 1 && totalStatsData && (
            <div className={styles.statsBlock}>
              <div className={styles.rule} />
              {([
                ['mean total', totalStatsData.mean],
                ['total std dev', totalStatsData.stdDev],
                ['best roll', totalStatsData.max],
                ['worst roll', totalStatsData.min],
                ['total range', totalStatsData.range],
              ] as [string, string | number][]).map(([label, val]) => (
                <div key={label} className={styles.statRow}>
                  <span className={styles.statLabel}>{label}</span>
                  <span className={styles.statVal}>{val}</span>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  )
}
