import { useState, useEffect, useRef } from 'react'
import BackLink from '../../components/BackLink'
import AppHeader from '../../components/AppHeader'
import styles from './TunerApp.module.css'

const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']
const EMA_ALPHA = 0.35
const STABLE_FRAMES = 3

function parabolicPeak(bins: Float32Array, k: number): number {
  if (k <= 0 || k >= bins.length - 1) return k
  const a = bins[k - 1], b = bins[k], c = bins[k + 1]
  const denom = a - 2 * b + c
  if (denom === 0) return k
  return k - 0.5 * (c - a) / denom
}

function detectPitch(fftBins: Float32Array, sampleRate: number): number | null {
  const N = fftBins.length
  const binHz = sampleRate / (N * 2)

  const minBin = Math.ceil(60 / binHz)
  const maxBin = Math.floor(1400 / binHz)

  let peak = -Infinity
  for (let i = minBin; i <= maxBin; i++) if (fftBins[i] > peak) peak = fftBins[i]
  if (peak < -70) return null

  let bestBin = -1
  let bestProduct = -Infinity

  for (let k = minBin; k <= maxBin; k++) {
    const k2 = Math.min(k * 2, N - 1)
    const k3 = Math.min(k * 3, N - 1)
    const k4 = Math.min(k * 4, N - 1)
    const product = fftBins[k] + fftBins[k2] + fftBins[k3] + fftBins[k4]
    if (product > bestProduct) {
      bestProduct = product
      bestBin = k
    }
  }

  if (bestBin === -1) return null
  return parabolicPeak(fftBins, bestBin) * binHz
}

function freqToNoteCents(freq: number): { note: string; cents: number } {
  const midiNote = 69 + 12 * Math.log2(freq / 440)
  const nearest = Math.round(midiNote)
  const cents = Math.round((midiNote - nearest) * 100)
  const octave = Math.floor(nearest / 12) - 1
  const note = NOTE_NAMES[((nearest % 12) + 12) % 12] + octave
  return { note, cents }
}

const midiToFreq = (midi: number) => 440 * Math.pow(2, (midi - 69) / 12)

const midiToName = (midi: number) => {
  const name = NOTE_NAMES[((midi % 12) + 12) % 12]
  const octave = Math.floor(midi / 12) - 1
  return `${name}${octave}`
}

export default function TunerApp() {
  const [mode, setMode] = useState<'listen' | 'play'>('listen')

  // Listen mode state
  const [status, setStatus] = useState<'idle' | 'requesting' | 'active' | 'denied'>('idle')
  const [note, setNote] = useState<string | null>(null)
  const [cents, setCents] = useState<number | null>(null)
  const [freq, setFreq] = useState<number | null>(null)

  // Play mode state
  const [selectedMidi, setSelectedMidi] = useState(69) // A4
  const [isPlaying, setIsPlaying] = useState(false)

  // Listen mode refs
  const streamRef = useRef<MediaStream | null>(null)
  const animFrameRef = useRef<number>(0)
  const analyserRef = useRef<AnalyserNode | null>(null)
  const dataArrayRef = useRef<Float32Array<ArrayBuffer> | null>(null)
  const audioCtxRef = useRef<AudioContext | null>(null)
  const smoothedFreqRef = useRef<number | null>(null)
  const displayedNoteRef = useRef<string | null>(null)
  const candidateNoteRef = useRef<string | null>(null)
  const candidateCountRef = useRef(0)

  // Play mode refs
  const oscillatorRef = useRef<OscillatorNode | null>(null)
  const gainRef = useRef<GainNode | null>(null)
  const playCtxRef = useRef<AudioContext | null>(null)

  // Listen mode effect — re-runs when mode changes
  useEffect(() => {
    if (mode !== 'listen') return

    setStatus('requesting')
    let cancelled = false

    navigator.mediaDevices
      .getUserMedia({ audio: true, video: false })
      .then(stream => {
        if (cancelled) {
          stream.getTracks().forEach(t => t.stop())
          return
        }

        streamRef.current = stream
        const ctx = new AudioContext()
        audioCtxRef.current = ctx
        const source = ctx.createMediaStreamSource(stream)
        const analyser = ctx.createAnalyser()
        analyser.fftSize = 8192
        source.connect(analyser)
        analyserRef.current = analyser
        dataArrayRef.current = new Float32Array(analyser.frequencyBinCount)

        setStatus('active')

        const tick = () => {
          if (!analyserRef.current || !dataArrayRef.current) return

          analyserRef.current.getFloatFrequencyData(dataArrayRef.current)
          const rawFreq = detectPitch(dataArrayRef.current, ctx.sampleRate)

          if (rawFreq === null) {
            smoothedFreqRef.current = null
            candidateCountRef.current = 0
            setNote(null)
            setCents(null)
            setFreq(null)
            animFrameRef.current = requestAnimationFrame(tick)
            return
          }

          if (smoothedFreqRef.current === null) {
            smoothedFreqRef.current = rawFreq
          } else {
            const ratio = rawFreq / smoothedFreqRef.current
            if (ratio > 1.8 || ratio < 0.55) {
              smoothedFreqRef.current = rawFreq
            } else {
              smoothedFreqRef.current = EMA_ALPHA * rawFreq + (1 - EMA_ALPHA) * smoothedFreqRef.current
            }
          }

          const { note: n, cents: c } = freqToNoteCents(smoothedFreqRef.current)

          if (n === candidateNoteRef.current) {
            candidateCountRef.current++
          } else {
            candidateNoteRef.current = n
            candidateCountRef.current = 1
          }

          const displayNote =
            candidateCountRef.current >= STABLE_FRAMES ? n : (displayedNoteRef.current ?? n)

          displayedNoteRef.current = displayNote
          setNote(displayNote)
          setCents(c)
          setFreq(smoothedFreqRef.current)

          animFrameRef.current = requestAnimationFrame(tick)
        }

        animFrameRef.current = requestAnimationFrame(tick)
      })
      .catch(() => {
        if (!cancelled) setStatus('denied')
      })

    return () => {
      cancelled = true
      cancelAnimationFrame(animFrameRef.current)
      streamRef.current?.getTracks().forEach(t => t.stop())
      audioCtxRef.current?.close()
      setStatus('idle')
      setNote(null)
      setCents(null)
      setFreq(null)
      smoothedFreqRef.current = null
      displayedNoteRef.current = null
      candidateNoteRef.current = null
      candidateCountRef.current = 0
    }
  }, [mode])

  // Stop oscillator on unmount
  useEffect(() => {
    return () => {
      stopOscillator()
      playCtxRef.current?.close()
    }
  }, [])

  function stopOscillator() {
    const osc = oscillatorRef.current
    const gain = gainRef.current
    const ctx = playCtxRef.current
    if (osc && gain && ctx) {
      gain.gain.setTargetAtTime(0, ctx.currentTime, 0.04)
      osc.stop(ctx.currentTime + 0.2)
    }
    oscillatorRef.current = null
    gainRef.current = null
  }

  function startOscillator(midi: number) {
    if (!playCtxRef.current) playCtxRef.current = new AudioContext()
    const ctx = playCtxRef.current

    stopOscillator()

    const osc = ctx.createOscillator()
    const gain = ctx.createGain()
    osc.type = 'triangle'
    osc.frequency.value = midiToFreq(midi)
    gain.gain.setValueAtTime(0, ctx.currentTime)
    gain.gain.setTargetAtTime(0.4, ctx.currentTime, 0.05)
    osc.connect(gain)
    gain.connect(ctx.destination)
    osc.start()
    oscillatorRef.current = osc
    gainRef.current = gain
  }

  const togglePlay = () => {
    if (isPlaying) {
      stopOscillator()
      setIsPlaying(false)
    } else {
      startOscillator(selectedMidi)
      setIsPlaying(true)
    }
  }

  const changeNote = (delta: number) => {
    const next = Math.max(36, Math.min(84, selectedMidi + delta)) // C2–C6
    setSelectedMidi(next)
    if (isPlaying && oscillatorRef.current && playCtxRef.current) {
      oscillatorRef.current.frequency.setTargetAtTime(
        midiToFreq(next),
        playCtxRef.current.currentTime,
        0.02
      )
    }
  }

  const inTune = cents !== null && Math.abs(cents) <= 5
  const needlePercent = cents !== null ? 50 + cents : 50

  return (
    <div className={styles.app}>
      <BackLink />
      <AppHeader title="tuner" />

      <div className={styles.modeRow}>
        <button
          className={[styles.modeBtn, mode === 'listen' ? styles.modeBtnActive : ''].filter(Boolean).join(' ')}
          onClick={() => { stopOscillator(); setIsPlaying(false); setMode('listen') }}
        >
          listen
        </button>
        <button
          className={[styles.modeBtn, mode === 'play' ? styles.modeBtnActive : ''].filter(Boolean).join(' ')}
          onClick={() => { stopOscillator(); setIsPlaying(false); setMode('play') }}
        >
          play
        </button>
      </div>

      {mode === 'listen' && (
        <>
          {status === 'requesting' && (
            <p className={styles.status}>requesting microphone...</p>
          )}
          {status === 'denied' && (
            <p className={styles.status}>microphone access denied</p>
          )}
          {status === 'active' && (
            <>
              <div className={styles.noteDisplay}>
                <span className={[styles.noteName, inTune ? styles.inTune : ''].filter(Boolean).join(' ')}>
                  {note ?? '—'}
                </span>
              </div>

              <div className={styles.tuningBar}>
                <div className={styles.tuningTrack}>
                  <div
                    className={[styles.needle, inTune ? styles.needleInTune : ''].filter(Boolean).join(' ')}
                    style={{ left: `${needlePercent}%` }}
                  />
                  <div className={styles.centerMark} />
                </div>
                <div className={styles.tuningLabels}>
                  <span>♭</span>
                  <span>♯</span>
                </div>
              </div>

              <div className={styles.row}>
                <span className={styles.label}>cents</span>
                <span className={styles.value}>
                  {cents !== null ? (cents >= 0 ? `+${cents}` : `${cents}`) : '—'}
                  {cents !== null && <span className={styles.unit}> ¢</span>}
                </span>
              </div>

              <div className={styles.row}>
                <span className={styles.label}>freq</span>
                <span className={styles.value}>
                  {freq !== null ? freq.toFixed(1) : '—'}
                  {freq !== null && <span className={styles.unit}> Hz</span>}
                </span>
              </div>
            </>
          )}
        </>
      )}

      {mode === 'play' && (
        <>
          <div className={styles.notePicker}>
            <button className={styles.stepBtn} onClick={() => changeNote(-1)}>←</button>
            <span className={`${styles.noteName} ${styles.notePickerName}`}>{midiToName(selectedMidi)}</span>
            <button className={styles.stepBtn} onClick={() => changeNote(1)}>→</button>
          </div>

          <div className={styles.row}>
            <span className={styles.label}>freq</span>
            <span className={styles.value}>
              {midiToFreq(selectedMidi).toFixed(1)}
              <span className={styles.unit}> Hz</span>
            </span>
          </div>

          <div className={styles.btnRow}>
            <button
              className={[styles.btn, isPlaying ? styles.btnActive : ''].filter(Boolean).join(' ')}
              onClick={togglePlay}
            >
              {isPlaying ? 'stop' : 'play'}
            </button>
          </div>
        </>
      )}
    </div>
  )
}
