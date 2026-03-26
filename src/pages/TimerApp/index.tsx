import { useEffect, useRef, useState } from 'react'
import AppHeader from '../../components/AppHeader'
import styles from './TimerApp.module.css'

type TimerMode = 'idle' | 'running' | 'paused' | 'done'
type TimerType = 'countdown' | 'stopwatch'

interface TimerState {
  mode: TimerMode
  type: TimerType
  totalMs: number
  startedAt: number
  accumulatedMs: number
}

const PRESETS = [1, 2, 3, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55, 60]

const idle: TimerState = {
  mode: 'idle',
  type: 'countdown',
  totalMs: 0,
  startedAt: 0,
  accumulatedMs: 0,
}

const STORAGE_KEY = 'benapps.timer.v1'

type PersistedTimer = {
  v: 1
  timer: TimerState
  laps: number[]
  doneNotifiedAt: number | null
}

function formatTime(ms: number, showCentiseconds = false): string {
  const clamped = Math.max(0, ms)
  const totalSec = Math.floor(clamped / 1000)
  const h = Math.floor(totalSec / 3600)
  const m = Math.floor((totalSec % 3600) / 60)
  const s = totalSec % 60
  const t = Math.floor((clamped % 1000) / 100)
  if (h > 0) {
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
  }
  const base = `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
  return showCentiseconds ? `${base}.${t}` : base
}

function getElapsed(state: TimerState): number {
  if (state.mode === 'running') {
    return state.accumulatedMs + (Date.now() - state.startedAt)
  }
  return state.accumulatedMs
}

function renderTimeCharacters(time: string, styles: Record<string, string>) {
  return time.split('').map((char, i) => (
    <span
      key={`${char}-${i}`}
      className={char === ':' || char === '.' ? styles.timeSep : styles.timeChar}
    >
      {char}
    </span>
  ))
}

export default function TimerApp() {
  const [timer, setTimer] = useState<TimerState>(idle)
  const [laps, setLaps] = useState<number[]>([])
  const [, setTick] = useState(0)
  const [isLandscapeMobile, setIsLandscapeMobile] = useState(false)
  const notifiedRef = useRef(false)
  const doneNotifiedAtRef = useRef<number | null>(null)
  const wakeLockRef = useRef<WakeLockSentinel | null>(null)

  useEffect(() => {
    if (typeof window === 'undefined') return
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY)
      if (!raw) return
      const parsed = JSON.parse(raw) as PersistedTimer
      if (!parsed || parsed.v !== 1) return
      if (!parsed.timer || typeof parsed.timer.mode !== 'string') return

      const nextTimer = parsed.timer
      if (nextTimer.mode === 'running' && nextTimer.type === 'countdown') {
        const elapsed = getElapsed(nextTimer)
        if (elapsed >= nextTimer.totalMs) {
          setTimer({ ...nextTimer, mode: 'done', accumulatedMs: nextTimer.totalMs })
        } else {
          setTimer(nextTimer)
        }
      } else {
        setTimer(nextTimer)
      }

      setLaps(Array.isArray(parsed.laps) ? parsed.laps.filter(n => typeof n === 'number') : [])
      doneNotifiedAtRef.current = parsed.doneNotifiedAt ?? null
      if (nextTimer.mode === 'done' && doneNotifiedAtRef.current) {
        notifiedRef.current = true
      }
    } catch {
      // ignore invalid persisted state
    }
  }, [])

  useEffect(() => {
    if (timer.mode !== 'running') return
    const id = setInterval(() => {
      setTick(t => t + 1)
      if (timer.type === 'countdown') {
        const elapsed = getElapsed(timer)
        if (elapsed >= timer.totalMs) {
          setTimer(prev => ({ ...prev, mode: 'done', accumulatedMs: prev.totalMs }))
        }
      }
    }, 100)
    return () => clearInterval(id)
  }, [timer])

  useEffect(() => {
    if (timer.mode === 'done' && !notifiedRef.current) {
      notifiedRef.current = true
      doneNotifiedAtRef.current = Date.now()
      if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
        new Notification('timer done')
      }
    }
    if (timer.mode !== 'done') {
      notifiedRef.current = false
      doneNotifiedAtRef.current = null
    }
  }, [timer.mode])

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return

    const media = window.matchMedia('(orientation: landscape) and (pointer: coarse)')
    const update = () => setIsLandscapeMobile(media.matches)
    update()

    media.addEventListener?.('change', update)
    return () => {
      media.removeEventListener?.('change', update)
    }
  }, [])

  useEffect(() => {
    if (typeof window === 'undefined') return
    try {
      if (timer.mode === 'idle') {
        window.localStorage.removeItem(STORAGE_KEY)
        return
      }
      const payload: PersistedTimer = {
        v: 1,
        timer,
        laps,
        doneNotifiedAt: doneNotifiedAtRef.current,
      }
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(payload))
    } catch {
      // ignore storage failures (private mode, quota, etc)
    }
  }, [timer, laps])

  useEffect(() => {
    if (typeof window === 'undefined') return

    let cancelled = false

    async function acquire() {
      if (cancelled) return
      if (timer.mode !== 'running') return
      if (document.visibilityState !== 'visible') return
      if (!('wakeLock' in navigator)) return

      try {
        if (wakeLockRef.current) return
        wakeLockRef.current = await (navigator as Navigator & {
          wakeLock: { request: (type: 'screen') => Promise<WakeLockSentinel> }
        }).wakeLock.request('screen')

        wakeLockRef.current.addEventListener?.('release', () => {
          wakeLockRef.current = null
        })
      } catch {
        // ignore (permissions, unsupported browser quirks, etc)
      }
    }

    async function release() {
      const sentinel = wakeLockRef.current
      wakeLockRef.current = null
      if (!sentinel) return
      try {
        await sentinel.release()
      } catch {
        // ignore
      }
    }

    if (timer.mode === 'running') {
      acquire()
    } else {
      release()
    }

    function onVisibilityChange() {
      if (timer.mode !== 'running') return
      if (document.visibilityState === 'visible') {
        acquire()
      }
    }

    document.addEventListener('visibilitychange', onVisibilityChange)
    return () => {
      cancelled = true
      document.removeEventListener('visibilitychange', onVisibilityChange)
      release()
    }
  }, [timer.mode])

  function startCountdown(minutes: number) {
    if (typeof Notification !== 'undefined' && Notification.permission === 'default') {
      Notification.requestPermission()
    }
    setTimer({
      mode: 'running',
      type: 'countdown',
      totalMs: minutes * 60 * 1000,
      startedAt: Date.now(),
      accumulatedMs: 0,
    })
  }

  function startStopwatch() {
    setTimer({
      mode: 'running',
      type: 'stopwatch',
      totalMs: 0,
      startedAt: Date.now(),
      accumulatedMs: 0,
    })
  }

  function pause() {
    setTimer(prev => ({
      ...prev,
      mode: 'paused',
      accumulatedMs: getElapsed(prev),
    }))
  }

  function resume() {
    setTimer(prev => ({
      ...prev,
      mode: 'running',
      startedAt: Date.now(),
    }))
  }

  function lap() {
    setLaps(prev => [...prev, getElapsed(timer)])
  }

  function reset() {
    setTimer({
      mode: 'paused',
      type: 'stopwatch',
      totalMs: 0,
      startedAt: Date.now(),
      accumulatedMs: 0,
    })
    setLaps([])
  }

  function dismiss() {
    setTimer(idle)
    setLaps([])
  }

  if (timer.mode !== 'idle') {
    const elapsed = getElapsed(timer)
    const isDone = timer.mode === 'done'

    const lapOffset = laps.length > 0 ? laps[laps.length - 1] : 0
    const currentLapMs = elapsed - lapOffset
    const displayMs = timer.type === 'countdown' ? timer.totalMs - elapsed : currentLapMs
    const timeStr = isDone ? '00:00' : formatTime(displayMs, timer.type === 'stopwatch')
    const showFocusMode = timer.type === 'countdown' && isLandscapeMobile

    const label = timer.type === 'countdown'
      ? (isDone ? 'done' : `${timer.totalMs / 60000} min`)
      : 'stopwatch'

    const splits = laps.map((ms, i) => i === 0 ? ms : ms - laps[i - 1])
    const best = splits.length > 1 ? Math.min(...splits) : null
    const worst = splits.length > 1 ? Math.max(...splits) : null

    if (showFocusMode) {
      return (
        <div className={styles.focusOverlay}>
          <div className={styles.focusCenter}>
            <div className={`${styles.focusTime}${isDone ? ` ${styles.done}` : ''}`}>
              {renderTimeCharacters(timeStr, styles)}
            </div>
          </div>
        </div>
      )
    }

    return (
      <div className={styles.overlay}>
        <div className={styles.timerInner}>
          <div className={styles.labelRow}>
            <div className={styles.presetLabel}>{label}</div>
            <button className={styles.closeBtn} onClick={dismiss} aria-label="dismiss">×</button>
          </div>
          <div className={`${styles.timeDisplay}${isDone ? ` ${styles.done}` : ''}`}>
            {renderTimeCharacters(timeStr, styles)}
          </div>
          {laps.length > 0 && (
            <div className={styles.totalTime}>
              {formatTime(elapsed, true)}
            </div>
          )}
          {!isDone && (
            <div className={styles.controlRow}>
              <button
                className={styles.controlBtn}
                onClick={timer.mode === 'running' ? pause : resume}
              >
                {timer.mode === 'running' ? 'pause' : 'resume'}
              </button>
              {label === 'stopwatch' && timer.mode === 'running' && (
                <button className={styles.controlBtn} onClick={lap}>
                  lap
                </button>
              )}
              {label === 'stopwatch' && (
                <button className={styles.controlBtn} onClick={reset}>
                  reset
                </button>
              )}
            </div>
          )}

          {laps.length > 0 && (
            <div className={styles.lapsSection}>
              {splits.length > 1 && (
                <div className={styles.lapStats}>
                  <span>avg {formatTime(laps[laps.length - 1] / laps.length, true)}</span>
                  <span>best {formatTime(best!, true)}</span>
                  <span>worst {formatTime(worst!, true)}</span>
                </div>
              )}
              <div className={styles.lapsList}>
                {[...splits].reverse().map((split, ri) => {
                  const i = splits.length - 1 - ri
                  const isBest = best !== null && split === best
                  const isWorst = worst !== null && split === worst
                  return (
                    <div key={i} className={styles.lapRow}>
                      <span className={styles.lapNum}>lap {i + 1}</span>
                      <span className={[
                        styles.lapTime,
                        isBest ? styles.lapBest : '',
                        isWorst ? styles.lapWorst : '',
                      ].filter(Boolean).join(' ')}>
                        {formatTime(split, true)}
                      </span>
                    </div>
                  )
                })}
              </div>
            </div>
          )}
        </div>
      </div>
    )
  }

  return (
    <div className={styles.app}>
      <AppHeader
        title="timer"
        about={<>
          <p>Countdown timer and stopwatch in one.</p>
          <ul>
            <li>Drag the number to set a custom countdown duration</li>
            <li>Tap a preset to quick-set common durations</li>
            <li>Spacebar starts and pauses</li>
          </ul>
        </>}
      />
      <div className={styles.section}>
        <div className={styles.sectionLabel}>countdown</div>
        <div className={styles.presetGrid}>
          {PRESETS.map(m => (
            <button key={m} className={styles.presetBtn} onClick={() => startCountdown(m)}>
              {m}m
            </button>
          ))}
        </div>
      </div>
      <div className={styles.section}>
        <div className={styles.sectionLabel}>stopwatch</div>
        <div className={styles.centeredRow}>
          <button className={styles.startBtn} onClick={startStopwatch}>start</button>
        </div>
      </div>
    </div>
  )
}
