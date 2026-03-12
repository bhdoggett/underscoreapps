import { useReducer, useRef, useCallback, useEffect } from 'react'
import BackLink from '../../components/BackLink'
import AppHeader from '../../components/AppHeader'
import DropZone from '../../components/DropZone'
import ConvertButton from '../../components/ConvertButton'
import StatusMessage from '../../components/StatusMessage'
import { transformReverse, transformSpeed, transformMono, transformNormalize, trimBuffer } from './audioTransforms'
import { encodeWAV } from './wavEncoder'
import { encodeMP3 } from './mp3Encoder'
import styles from './AudioApp.module.css'

type SpeedKey = 'half' | 'double'
const SPEED_CYCLES: Record<SpeedKey, { labels: string[]; factors: number[] }> = {
  half:   { labels: ['½×', '¼×'], factors: [0.5, 0.25] },
  double: { labels: ['2×', '4×'], factors: [2, 4] },
}

type State = {
  currentFile: File | null
  audioBuffer: AudioBuffer | null
  workingBuffer: AudioBuffer | null
  selectedTransforms: string[]
  speedState: Record<SpeedKey, 0 | 1 | 2>
  appliedSnapshot: string
  statusMsg: string
  statusVisible: boolean
  errorMsg: string
  buttonsDisabled: boolean
  playerSrc: string
  recording: boolean
  recordingElapsed: number
  playing: boolean
  currentTime: number
  trimStart: number
  trimEnd: number
}

type Action =
  | { type: 'LOAD_START'; file: File }
  | { type: 'LOAD_DONE'; buffer: AudioBuffer; playerSrc: string }
  | { type: 'LOAD_ERROR' }
  | { type: 'TOGGLE_TRANSFORM'; action: string }
  | { type: 'CYCLE_SPEED'; group: SpeedKey }
  | { type: 'APPLY_START' }
  | { type: 'APPLY_DONE'; workingBuffer: AudioBuffer; snapshot: string; playerSrc: string }
  | { type: 'RESET_TRANSFORMS'; playerSrc: string }
  | { type: 'ENCODE_START' }
  | { type: 'ENCODE_DONE'; playerSrc: string }
  | { type: 'ENCODE_ERROR' }
  | { type: 'RESET_ALL' }
  | { type: 'RECORD_START' }
  | { type: 'RECORD_TICK' }
  | { type: 'RECORD_ERROR' }
  | { type: 'SET_PLAYING'; playing: boolean }
  | { type: 'SET_CURRENT_TIME'; t: number }
  | { type: 'SET_TRIM'; start: number; end: number }

const initial: State = {
  currentFile: null,
  audioBuffer: null,
  workingBuffer: null,
  selectedTransforms: [],
  speedState: { half: 0, double: 0 },
  appliedSnapshot: '',
  statusMsg: '',
  statusVisible: false,
  errorMsg: '',
  buttonsDisabled: false,
  playerSrc: '',
  recording: false,
  recordingElapsed: 0,
  playing: false,
  currentTime: 0,
  trimStart: 0,
  trimEnd: 0,
}

function effectiveTransforms(selectedTransforms: string[], speedState: Record<SpeedKey, 0 | 1 | 2>): string {
  const all = [...selectedTransforms]
  for (const [group, state] of Object.entries(speedState) as [SpeedKey, number][]) {
    if (state > 0) all.push(`${group}:${state}`)
  }
  return all.sort().join(',')
}

function reducer(state: State, action: Action): State {
  switch (action.type) {
    case 'LOAD_START':
      return { ...initial, currentFile: action.file, statusMsg: 'loading', statusVisible: true }
    case 'LOAD_DONE':
      return { ...state, audioBuffer: action.buffer, workingBuffer: action.buffer, statusVisible: false, playerSrc: action.playerSrc, playing: false, currentTime: 0, trimStart: 0, trimEnd: action.buffer.duration }
    case 'LOAD_ERROR':
      return { ...state, statusVisible: false, errorMsg: 'could not decode audio — try a different format' }
    case 'TOGGLE_TRANSFORM': {
      const idx = state.selectedTransforms.indexOf(action.action)
      const next = idx !== -1
        ? state.selectedTransforms.filter(t => t !== action.action)
        : [...state.selectedTransforms, action.action]
      return { ...state, selectedTransforms: next }
    }
    case 'CYCLE_SPEED': {
      const group = action.group
      const opposite: SpeedKey = group === 'half' ? 'double' : 'half'
      const newSpeedState = { ...state.speedState }
      if (newSpeedState[opposite] > 0) newSpeedState[opposite] = 0
      newSpeedState[group] = ((newSpeedState[group] + 1) % 3) as 0 | 1 | 2
      return { ...state, speedState: newSpeedState }
    }
    case 'APPLY_START':
      return { ...state, buttonsDisabled: true, statusMsg: 'loading', statusVisible: true }
    case 'APPLY_DONE':
      return { ...state, workingBuffer: action.workingBuffer, appliedSnapshot: action.snapshot, buttonsDisabled: false, statusVisible: false, playerSrc: action.playerSrc, playing: false, currentTime: 0, trimStart: 0, trimEnd: action.workingBuffer.duration }
    case 'RESET_TRANSFORMS':
      return { ...state, workingBuffer: state.audioBuffer, selectedTransforms: [], speedState: { half: 0, double: 0 }, appliedSnapshot: '', playerSrc: action.playerSrc, playing: false, currentTime: 0, trimStart: 0, trimEnd: state.audioBuffer!.duration }
    case 'ENCODE_START':
      return { ...state, buttonsDisabled: true, statusMsg: 'loading', statusVisible: true }
    case 'ENCODE_DONE':
      return { ...state, buttonsDisabled: false, statusVisible: false, playerSrc: action.playerSrc }
    case 'ENCODE_ERROR':
      return { ...state, buttonsDisabled: false, statusVisible: false, errorMsg: 'encoding failed' }
    case 'RESET_ALL':
      return { ...initial }
    case 'RECORD_START':
      return { ...state, recording: true, recordingElapsed: 0, statusVisible: false }
    case 'RECORD_TICK':
      return { ...state, recordingElapsed: state.recordingElapsed + 1 }
    case 'RECORD_ERROR':
      return { ...state, recording: false, errorMsg: 'microphone access denied' }
    case 'SET_PLAYING':
      return { ...state, playing: action.playing }
    case 'SET_CURRENT_TIME':
      return { ...state, currentTime: action.t }
    case 'SET_TRIM':
      return { ...state, trimStart: Math.min(action.start, action.end - 0.1), trimEnd: Math.max(action.end, action.start + 0.1) }
    default:
      return state
  }
}

function download(blob: Blob, filename: string) {
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = filename
  a.click()
  URL.revokeObjectURL(a.href)
}

function fileInfo(file: File, buf: AudioBuffer): string {
  const mins = Math.floor(buf.duration / 60)
  const secs = Math.floor(buf.duration % 60).toString().padStart(2, '0')
  return `${file.name}  ·  ${mins}:${secs}  ·  ${buf.numberOfChannels === 1 ? 'mono' : 'stereo'}  ·  ${Math.round(buf.sampleRate / 1000)}kHz`
}

export default function AudioApp() {
  const [state, dispatch] = useReducer(reducer, initial)
  const playerRef = useRef<HTMLAudioElement>(null)
  const rafRef = useRef<number | null>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const peaksRef = useRef<Float32Array | null>(null)
  const peaksBufRef = useRef<AudioBuffer | null>(null)
  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const chunksRef = useRef<Blob[]>([])
  const recordingTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || !state.workingBuffer) return
    const buf = state.workingBuffer
    const dpr = window.devicePixelRatio || 1
    const w = canvas.clientWidth
    const h = canvas.clientHeight
    if (!w || !h) return

    if (peaksBufRef.current !== buf) {
      const numCh = buf.numberOfChannels
      const channels = Array.from({ length: numCh }, (_, c) => buf.getChannelData(c))
      const peaks = new Float32Array(w)
      for (let s = 0; s < buf.length; s++) {
        const b = Math.min(w - 1, Math.floor((s / buf.length) * w))
        for (let c = 0; c < numCh; c++) peaks[b] = Math.max(peaks[b], Math.abs(channels[c][s]))
      }
      peaksRef.current = peaks
      peaksBufRef.current = buf
    }

    canvas.width = w * dpr
    canvas.height = h * dpr
    const ctx = canvas.getContext('2d')!
    ctx.scale(dpr, dpr)
    ctx.clearRect(0, 0, w, h)

    const cssVars = getComputedStyle(document.documentElement)
    const dimColor = cssVars.getPropertyValue('--dim').trim()
    const mutedColor = cssVars.getPropertyValue('--muted').trim()
    const trimStartX = (state.trimStart / buf.duration) * w
    const trimEndX = (state.trimEnd / buf.duration) * w
    const mid = h / 2
    const peaks = peaksRef.current!

    for (let b = 0; b < w; b++) {
      const barH = Math.max(1, peaks[b] * h * 0.85)
      ctx.fillStyle = b >= trimStartX && b <= trimEndX ? mutedColor : dimColor
      ctx.fillRect(b, mid - barH / 2, 1, barH)
    }
  }, [state.workingBuffer, state.trimStart, state.trimEnd])

  const hasFile = state.currentFile !== null && state.audioBuffer !== null
  const hasTrimChange = state.workingBuffer !== null && (state.trimStart > 0 || state.trimEnd < state.workingBuffer.duration - 0.01)
  const hasChanges = effectiveTransforms(state.selectedTransforms, state.speedState) !== state.appliedSnapshot || hasTrimChange
  const hasTransforms = state.selectedTransforms.length > 0 || (Object.values(state.speedState) as number[]).some(s => s > 0) || hasTrimChange || state.workingBuffer !== state.audioBuffer

  function formatElapsed(seconds: number): string {
    const m = Math.floor(seconds / 60)
    const s = (seconds % 60).toString().padStart(2, '0')
    return `${m}:${s}`
  }

  function formatTime(seconds: number): string {
    const m = Math.floor(seconds / 60)
    const s = Math.floor(seconds % 60).toString().padStart(2, '0')
    return `${m}:${s}`
  }

  const tick = useCallback(() => {
    const audio = playerRef.current!
    dispatch({ type: 'SET_CURRENT_TIME', t: audio.currentTime })
    if (audio.currentTime >= state.trimEnd) {
      audio.pause()
      audio.currentTime = state.trimStart
      dispatch({ type: 'SET_PLAYING', playing: false })
      return
    }
    rafRef.current = requestAnimationFrame(tick)
  }, [state.trimEnd, state.trimStart])

  function togglePlay() {
    const audio = playerRef.current!
    if (state.playing) {
      audio.pause()
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current)
      dispatch({ type: 'SET_PLAYING', playing: false })
    } else {
      if (audio.currentTime < state.trimStart || audio.currentTime >= state.trimEnd) {
        audio.currentTime = state.trimStart
      }
      audio.play()
      dispatch({ type: 'SET_PLAYING', playing: true })
      rafRef.current = requestAnimationFrame(tick)
    }
  }

  function seekTo(t: number) {
    const audio = playerRef.current!
    audio.currentTime = t
    dispatch({ type: 'SET_CURRENT_TIME', t })
  }

  function setTrimStart(val: number) {
    const clamped = Math.max(0, Math.min(val, state.trimEnd - 0.1))
    dispatch({ type: 'SET_TRIM', start: clamped, end: state.trimEnd })
    if (!state.playing) seekTo(clamped)
  }

  function setTrimEnd(val: number) {
    const clamped = Math.min(state.workingBuffer?.duration ?? 0, Math.max(val, state.trimStart + 0.1))
    dispatch({ type: 'SET_TRIM', start: state.trimStart, end: clamped })
  }

  async function startRecording() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      const mimeType = MediaRecorder.isTypeSupported('audio/webm') ? 'audio/webm' : 'audio/mp4'
      const mediaRecorder = new MediaRecorder(stream, { mimeType })
      mediaRecorderRef.current = mediaRecorder
      chunksRef.current = []

      mediaRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data)
      }

      mediaRecorder.onstop = () => {
        const blob = new Blob(chunksRef.current, { type: mimeType })
        const file = new File([blob], 'recording.webm', { type: mimeType })
        stream.getTracks().forEach(t => t.stop())
        loadFile(file)
      }

      dispatch({ type: 'RECORD_START' })
      recordingTimerRef.current = setInterval(() => {
        dispatch({ type: 'RECORD_TICK' })
      }, 1000)
      mediaRecorder.start(100)
    } catch {
      dispatch({ type: 'RECORD_ERROR' })
    }
  }

  function stopRecording() {
    if (recordingTimerRef.current) {
      clearInterval(recordingTimerRef.current)
      recordingTimerRef.current = null
    }
    mediaRecorderRef.current?.stop()
  }

  async function shareFile() {
    if (!state.workingBuffer || !state.currentFile) return
    const hasTrim = state.trimStart > 0 || state.trimEnd < state.workingBuffer.duration - 0.01
    const bufToEncode = hasTrim ? trimBuffer(state.workingBuffer, state.trimStart, state.trimEnd) : state.workingBuffer
    const blob = encodeMP3(bufToEncode)
    const baseName = state.currentFile.name.replace(/\.[^.]+$/, '')
    const file = new File([blob], `${baseName}.mp3`, { type: 'audio/mpeg' })
    if (navigator.canShare?.({ files: [file] })) {
      await navigator.share({ files: [file], title: baseName })
    } else {
      download(blob, `${baseName}.mp3`)
    }
  }

  function loadFile(file: File) {
    if (!file.type.startsWith('audio/')) {
      dispatch({ type: 'LOAD_ERROR' })
      return
    }
    dispatch({ type: 'LOAD_START', file })
    const ctx = new AudioContext()
    file.arrayBuffer()
      .then(buf => ctx.decodeAudioData(buf))
      .then(decoded => {
        const wav = encodeWAV(decoded)
        dispatch({ type: 'LOAD_DONE', buffer: decoded, playerSrc: URL.createObjectURL(wav) })
      })
      .catch(() => dispatch({ type: 'LOAD_ERROR' }))
  }

  function toggleTransform(action: string) {
    if (!state.audioBuffer) return
    dispatch({ type: 'TOGGLE_TRANSFORM', action })
  }

  function cycleSpeed(group: SpeedKey) {
    if (!state.audioBuffer) return
    dispatch({ type: 'CYCLE_SPEED', group })
  }

  function applyTransforms() {
    if (!state.audioBuffer || !state.workingBuffer) return
    dispatch({ type: 'APPLY_START' })
    setTimeout(() => {
      const transformsChanged = effectiveTransforms(state.selectedTransforms, state.speedState) !== state.appliedSnapshot
      let buf: AudioBuffer
      if (transformsChanged) {
        buf = state.audioBuffer!
        for (const action of state.selectedTransforms) {
          if (action === 'reverse') buf = transformReverse(buf)
          else if (action === 'mono') buf = transformMono(buf)
          else if (action === 'normalize') buf = transformNormalize(buf)
        }
        for (const [group, s] of Object.entries(state.speedState) as [SpeedKey, number][]) {
          if (s > 0) buf = transformSpeed(buf, SPEED_CYCLES[group].factors[s - 1])
        }
      } else {
        buf = state.workingBuffer!
      }
      const clampedEnd = Math.min(state.trimEnd, buf.duration)
      if (state.trimStart > 0 || clampedEnd < buf.duration - 0.01) {
        buf = trimBuffer(buf, state.trimStart, clampedEnd)
      }
      const wav = encodeWAV(buf)
      const snapshot = effectiveTransforms(state.selectedTransforms, state.speedState)
      dispatch({ type: 'APPLY_DONE', workingBuffer: buf, snapshot, playerSrc: URL.createObjectURL(wav) })
    }, 300)
  }

  function resetTransforms() {
    if (!state.audioBuffer) return
    const wav = encodeWAV(state.audioBuffer)
    dispatch({ type: 'RESET_TRANSFORMS', playerSrc: URL.createObjectURL(wav) })
  }

  function encode(format: string) {
    if (!state.workingBuffer || !state.currentFile) return
    const prevSrc = state.playerSrc
    const hasTrim = state.trimStart > 0 || state.trimEnd < state.workingBuffer.duration - 0.01
    const bufToEncode = hasTrim ? trimBuffer(state.workingBuffer, state.trimStart, state.trimEnd) : state.workingBuffer
    dispatch({ type: 'ENCODE_START' })
    setTimeout(() => {
      try {
        const blob = format === 'mp3' ? encodeMP3(bufToEncode) : encodeWAV(bufToEncode)
        const name = state.currentFile!.name.replace(/\.[^.]+$/, '')
        download(blob, `${name}.${format}`)
        dispatch({ type: 'ENCODE_DONE', playerSrc: prevSrc })
      } catch {
        dispatch({ type: 'ENCODE_ERROR' })
      }
    }, 500)
  }

  function resetAll() {
    dispatch({ type: 'RESET_ALL' })
  }

  // Speed button label helpers
  function speedLabel(group: SpeedKey): string {
    const s = state.speedState[group]
    return s === 0 ? SPEED_CYCLES[group].labels[0] : SPEED_CYCLES[group].labels[s - 1]
  }

  const canShare = /Mobi|Android/i.test(navigator.userAgent)

  const infoText = hasFile && state.workingBuffer
    ? fileInfo(state.currentFile!, state.workingBuffer)
    : ''

  return (
    <div className={styles.app}>
      <BackLink />
      <AppHeader title="audio" />

      {!hasFile && !state.statusVisible && !state.recording && (
        <>
          <DropZone accept="audio/mpeg,audio/wav,audio/aac,audio/ogg,audio/flac,audio/x-m4a,.mp3,.wav,.aac,.ogg,.flac,.m4a" onFile={loadFile} label="drop audio file here" />
          <div className={styles.recordRow}>
            <button className={styles.recordBtn} onClick={startRecording}>● record</button>
          </div>
        </>
      )}

      {state.recording && (
        <div className={styles.recordRow}>
          <span className={styles.recordingDot} />
          <span className={styles.recordingElapsed}>{formatElapsed(state.recordingElapsed)}</span>
          <button className={[styles.recordBtn, styles.recording].join(' ')} onClick={stopRecording}>stop</button>
        </div>
      )}

      <StatusMessage message={state.statusMsg} visible={state.statusVisible} />

      {state.errorMsg && <p className={styles.errorMsg}>{state.errorMsg}</p>}

      {hasFile && !state.statusVisible && (
        <>
          <div className={styles.fileMeta}>
            <span className={styles.fileInfo}>{infoText}</span>
            <button className={styles.closeBtn} onClick={resetAll}>×</button>
          </div>

          <audio ref={playerRef} className={styles.player} src={state.playerSrc} />

          {state.workingBuffer && (() => {
            const duration = state.workingBuffer.duration
            return (
              <>
                <div className={styles.playerRow}>
                  <button className={styles.playBtn} onClick={togglePlay} disabled={state.buttonsDisabled}>
                    {state.playing ? '⏸' : '▶'}
                  </button>
                  <div className={styles.trimTrack}>
                    <canvas ref={canvasRef} className={styles.waveformCanvas} />
                    <div className={styles.playhead} style={{ left: `${(state.currentTime / duration) * 100}%` }} />
                    <div className={styles.trimHandle} style={{ left: `${(state.trimStart / duration) * 100}%` }} />
                    <div className={styles.trimHandle} style={{ left: `${(state.trimEnd / duration) * 100}%` }} />
                    <input
                      type="range"
                      className={styles.progressRange}
                      min={0}
                      max={duration}
                      step={0.01}
                      value={state.currentTime}
                      onChange={e => seekTo(+e.target.value)}
                    />
                    <input
                      type="range"
                      className={styles.trimRange}
                      min={0}
                      max={duration}
                      step={0.01}
                      value={state.trimStart}
                      onChange={e => setTrimStart(+e.target.value)}
                    />
                    <input
                      type="range"
                      className={styles.trimRange}
                      min={0}
                      max={duration}
                      step={0.01}
                      value={state.trimEnd}
                      onChange={e => setTrimEnd(+e.target.value)}
                    />
                  </div>
                  <span className={styles.timeDisplay}>{formatTime(state.currentTime)} / {formatTime(state.trimEnd)}</span>
                </div>
              </>
            )
          })()}

          <div className={styles.transformRow}>
            {(['reverse', 'mono', 'normalize'] as const).map(action => (
              <button
                key={action}
                className={[styles.transformBtn, state.selectedTransforms.includes(action) ? styles.selected : ''].filter(Boolean).join(' ')}
                onClick={() => toggleTransform(action)}
                disabled={state.buttonsDisabled}
              >
                {action}
              </button>
            ))}
            {(['half', 'double'] as const).map(group => (
              <button
                key={group}
                className={[styles.transformBtn, state.speedState[group] > 0 ? styles.selected : ''].filter(Boolean).join(' ')}
                onClick={() => cycleSpeed(group)}
                disabled={state.buttonsDisabled}
              >
                {speedLabel(group)}
              </button>
            ))}
            <button
              className={[styles.applyBtn, hasChanges ? styles.hasChanges : ''].filter(Boolean).join(' ')}
              onClick={applyTransforms}
              disabled={state.buttonsDisabled}
            >
              ▶
            </button>
            {hasTransforms && (
              <button
                className={[styles.applyBtn, styles.resetTransformBtn].join(' ')}
                onClick={resetTransforms}
                disabled={state.buttonsDisabled}
              >
                reset
              </button>
            )}
          </div>

          <div className={styles.convertRow}>
            <ConvertButton format="mp3" label="mp3" onClick={() => encode('mp3')} disabled={state.buttonsDisabled} />
            <ConvertButton format="wav" label="wav" onClick={() => encode('wav')} disabled={state.buttonsDisabled} />
            {canShare && <ConvertButton format="share" label="share" onClick={shareFile} disabled={state.buttonsDisabled} />}
          </div>
        </>
      )}
    </div>
  )
}
