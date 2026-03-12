import { useState, useEffect, useRef } from 'react'
import BackLink from '../../components/BackLink'
import AppHeader from '../../components/AppHeader'
import styles from './DecibelsApp.module.css'

export default function DecibelsApp() {
  const [currentDb, setCurrentDb] = useState<number | null>(null)
  const [averageDb, setAverageDb] = useState<number | null>(null)
  const [sampleSum, setSampleSum] = useState(0)
  const [sampleCount, setSampleCount] = useState(0)
  const [status, setStatus] = useState<'idle' | 'requesting' | 'active' | 'denied'>('idle')

  const streamRef = useRef<MediaStream | null>(null)
  const animFrameRef = useRef<number>(0)
  const analyserRef = useRef<AnalyserNode | null>(null)
  const dataArrayRef = useRef<Uint8Array | null>(null)
  const audioCtxRef = useRef<AudioContext | null>(null)

  // Use refs to track sum/count for rAF loop without stale closures
  const sumRef = useRef(0)
  const countRef = useRef(0)
  const smoothedDbRef = useRef<number | null>(null)

  useEffect(() => {
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
        analyser.fftSize = 2048
        source.connect(analyser)
        analyserRef.current = analyser
        dataArrayRef.current = new Uint8Array(analyser.fftSize)

        setStatus('active')

        const tick = () => {
          if (!analyserRef.current || !dataArrayRef.current) return

          analyserRef.current.getByteTimeDomainData(dataArrayRef.current)

          let sumSq = 0
          const buf = dataArrayRef.current
          for (let i = 0; i < buf.length; i++) {
            const normalized = (buf[i] - 128) / 128
            sumSq += normalized * normalized
          }
          const rms = Math.sqrt(sumSq / buf.length)
          const db = rms > 0 ? 20 * Math.log10(rms) : -Infinity

          if (isFinite(db)) {
            const alpha = 0.05
            smoothedDbRef.current =
              smoothedDbRef.current === null
                ? db
                : alpha * db + (1 - alpha) * smoothedDbRef.current

            sumRef.current += db
            countRef.current += 1
            const avg = sumRef.current / countRef.current

            setCurrentDb(smoothedDbRef.current)
            setSampleSum(sumRef.current)
            setSampleCount(countRef.current)
            setAverageDb(avg)
          }

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
    }
  }, [])

  const handleReset = () => {
    sumRef.current = 0
    countRef.current = 0
    smoothedDbRef.current = null
    setSampleSum(0)
    setSampleCount(0)
    setAverageDb(null)
    setCurrentDb(null)
  }

  const fmt = (val: number | null) =>
    val === null ? '—' : `${val.toFixed(1)} dB`

  return (
    <div className={styles.app}>
      <BackLink />
      <AppHeader title="decibels" />

        {status === 'requesting' && (
          <p className={styles.status}>requesting microphone...</p>
        )}

        {status === 'denied' && (
          <p className={styles.status}>microphone access denied</p>
        )}

        {status === 'active' && (
          <>
            <div className={styles.row}>
              <span className={styles.label}>now</span>
              <span className={styles.value}>{fmt(currentDb)}</span>
            </div>
            <div className={styles.row}>
              <span className={styles.label}>avg</span>
              <span className={styles.value}>{fmt(averageDb)}</span>
            </div>
            <div className={styles.btnRow}>
              <button className={styles.btn} onClick={handleReset}>reset avg</button>
            </div>
          </>
        )}
    </div>
  )
}
