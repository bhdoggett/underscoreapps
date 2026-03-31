import { useEffect, useRef, useState } from 'react'
import AppHeader from '../../components/AppHeader'
import DragNumber from '../../components/DragNumber'
import styles from './MetronomeApp.module.css'

function useIsLandscapeMobile() {
  const [is, setIs] = useState(false)
  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return
    const media = window.matchMedia('(orientation: landscape) and (pointer: coarse)')
    const update = () => setIs(media.matches)
    update()
    media.addEventListener?.('change', update)
    return () => media.removeEventListener?.('change', update)
  }, [])
  return is
}

const LOOKAHEAD_MS = 25
const SCHEDULE_AHEAD_S = 0.1

export default function MetronomeApp() {
  const isLandscapeMobile = useIsLandscapeMobile()
  const [bpm, setBpm] = useState(120)
  const [beats, setBeats] = useState(4)
  const [running, setRunning] = useState(false)
  // per-beat flash counters — incrementing forces key change → animation restart
  const [beatFlashes, setBeatFlashes] = useState<number[]>(Array(4).fill(0))

  const audioCtxRef = useRef<AudioContext | null>(null)
  const bpmRef = useRef(120)
  const beatsRef = useRef(4)
  const nextBeatTimeRef = useRef(0)
  const currentBeatRef = useRef(0)
  const schedulerTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const rafRef = useRef<number | null>(null)
  const scheduledBeatsRef = useRef<{ beat: number; time: number }[]>([])
  const tapTimesRef = useRef<number[]>([])
  const runningRef = useRef(false)

  useEffect(() => { bpmRef.current = bpm }, [bpm])
  useEffect(() => { runningRef.current = running }, [running])
  useEffect(() => {
    beatsRef.current = beats
    setBeatFlashes(Array(beats).fill(0))
  }, [beats])

  function playClick(time: number, beat: number) {
    const ctx = audioCtxRef.current!
    const osc = ctx.createOscillator()
    const gain = ctx.createGain()
    osc.connect(gain)
    gain.connect(ctx.destination)
    osc.frequency.value = beat === 0 ? 1000 : 800
    gain.gain.setValueAtTime(0.001, time)
    gain.gain.exponentialRampToValueAtTime(0.4, time + 0.005)
    gain.gain.exponentialRampToValueAtTime(0.001, time + 0.06)
    osc.start(time)
    osc.stop(time + 0.07)
  }

  function scheduleBeats() {
    const ctx = audioCtxRef.current!
    while (nextBeatTimeRef.current < ctx.currentTime + SCHEDULE_AHEAD_S) {
      playClick(nextBeatTimeRef.current, currentBeatRef.current)
      scheduledBeatsRef.current.push({ beat: currentBeatRef.current, time: nextBeatTimeRef.current })
      nextBeatTimeRef.current += 60 / bpmRef.current
      currentBeatRef.current = (currentBeatRef.current + 1) % beatsRef.current
    }
    schedulerTimerRef.current = setTimeout(scheduleBeats, LOOKAHEAD_MS)
  }

  function rafTick() {
    const ctx = audioCtxRef.current
    if (!ctx) return
    const now = ctx.currentTime + 0.005
    const q = scheduledBeatsRef.current
    const fired: number[] = []
    while (q.length > 0 && q[0].time <= now) {
      fired.push(q.shift()!.beat)
    }
    if (fired.length > 0) {
      setBeatFlashes(prev => {
        const next = [...prev]
        for (const beat of fired) {
          if (beat < next.length) next[beat] = (next[beat] ?? 0) + 1
        }
        return next
      })
    }
    rafRef.current = requestAnimationFrame(rafTick)
  }

  function startMetronome() {
    if (!audioCtxRef.current) {
      audioCtxRef.current = new AudioContext()
    }
    const ctx = audioCtxRef.current
    ctx.resume().then(() => {
      currentBeatRef.current = 0
      nextBeatTimeRef.current = ctx.currentTime + 0.05
      scheduledBeatsRef.current = []
      scheduleBeats()
      rafRef.current = requestAnimationFrame(rafTick)
      setRunning(true)
    })
  }

  function stopMetronome() {
    if (schedulerTimerRef.current !== null) {
      clearTimeout(schedulerTimerRef.current)
      schedulerTimerRef.current = null
    }
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current)
      rafRef.current = null
    }
    audioCtxRef.current?.suspend()
    scheduledBeatsRef.current = []
    setBeatFlashes(Array(beatsRef.current).fill(0))
    setRunning(false)
  }

  function adjustBpm(delta: number) {
    setBpm(prev => Math.max(40, Math.min(240, prev + delta)))
  }

  function handleTap() {
    const now = Date.now()
    const taps = tapTimesRef.current
    if (taps.length > 0 && now - taps[taps.length - 1] > 3000) taps.length = 0
    taps.push(now)
    if (taps.length > 8) taps.shift()
    if (taps.length >= 2) {
      const intervals = taps.slice(1).map((t, i) => t - taps[i])
      const avg = intervals.reduce((a, b) => a + b) / intervals.length
      const newBpm = Math.max(40, Math.min(240, Math.round(60000 / avg)))
      setBpm(newBpm)
    }
  }

  useEffect(() => () => stopMetronome(), [])

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.code === 'Space' && !(e.target instanceof HTMLInputElement)) {
        e.preventDefault()
        runningRef.current ? stopMetronome() : startMetronome()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  // beat duration drives the fade animation speed
  const beatDuration = `${(60 / bpm).toFixed(3)}s`

  const inner = (
      <div className={styles.content}>
      <div className={styles.controlRow}>
        <button className={styles.controlBtn} onClick={running ? stopMetronome : startMetronome}>
          {running ? 'stop' : 'start'}
        </button>
        <button className={styles.controlBtn} onClick={handleTap}>tap</button>
      </div>

      <div className={styles.bpmRow}>
        <button className={styles.adjBtn} onClick={() => adjustBpm(-1)} aria-label="decrease BPM">−</button>
        <div className={styles.bpmStack}>
          <DragNumber
            value={bpm}
            min={40}
            max={240}
            onChange={setBpm}
            className={styles.bpmInput}
          />
          <div className={styles.bpmLabel}>bpm</div>
        </div>
        <button className={styles.adjBtn} onClick={() => adjustBpm(1)} aria-label="increase BPM">+</button>
      </div>

      <div className={styles.beatRow} style={{ '--beat-duration': beatDuration } as React.CSSProperties}>
        {Array.from({ length: beats }, (_, i) => {
          const flashed = beatFlashes[i] > 0
          const isAccent = i === 0
          return (
            <div
              key={flashed ? `${i}-${beatFlashes[i]}` : i}
              className={`${styles.beatDot} ${flashed ? (isAccent ? styles.beatDotFlashAccent : styles.beatDotFlash) : ''}`}
            />
          )
        })}
      </div>

      <div className={styles.timeSig}>
        <div className={styles.timeSigRow}>
          <button
            className={styles.adjBtn}
            onClick={() => setBeats(b => Math.max(1, b - 1))}
            aria-label="decrease beats"
          >−</button>
          <DragNumber
            value={beats}
            min={1}
            max={8}
            onChange={setBeats}
            className={styles.timeSigNum}
            pixelsPerUnit={8}
          />
          <button
            className={styles.adjBtn}
            onClick={() => setBeats(b => Math.min(8, b + 1))}
            aria-label="increase beats"
          >+</button>
        </div>
        <div className={styles.timeSigLabel}>beats</div>
      </div>
      </div>
  )

  if (isLandscapeMobile) {
    return <div className={styles.focusOverlay}>{inner}</div>
  }

  return (
    <div className={styles.app}>
      <AppHeader
        title="metronome"
        about={<>
          <p>Adjustable-tempo metronome with downbeat accent.</p>
          <ul>
            <li>Drag the BPM number up or down to change the tempo</li>
            <li>Tap the beat square repeatedly to set tempo by feel</li>
          </ul>
        </>}
      />
      {inner}
    </div>
  )
}
