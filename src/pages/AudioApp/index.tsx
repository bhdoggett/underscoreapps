import { useReducer, useRef } from 'react'
import BackLink from '../../components/BackLink'
import AppHeader from '../../components/AppHeader'
import DropZone from '../../components/DropZone'
import ActionButton from '../../components/ActionButton'
import ConvertButton from '../../components/ConvertButton'
import StatusMessage from '../../components/StatusMessage'
import { transformReverse, transformSpeed, transformMono, transformNormalize } from './audioTransforms'
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
      return { ...state, audioBuffer: action.buffer, workingBuffer: action.buffer, statusVisible: false, playerSrc: action.playerSrc }
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
      return { ...state, workingBuffer: action.workingBuffer, appliedSnapshot: action.snapshot, buttonsDisabled: false, statusVisible: false, playerSrc: action.playerSrc }
    case 'RESET_TRANSFORMS':
      return { ...state, workingBuffer: state.audioBuffer, selectedTransforms: [], speedState: { half: 0, double: 0 }, appliedSnapshot: '', playerSrc: action.playerSrc }
    case 'ENCODE_START':
      return { ...state, buttonsDisabled: true, statusMsg: 'loading', statusVisible: true }
    case 'ENCODE_DONE':
      return { ...state, buttonsDisabled: false, statusVisible: false, playerSrc: action.playerSrc }
    case 'ENCODE_ERROR':
      return { ...state, buttonsDisabled: false, statusVisible: false, errorMsg: 'encoding failed' }
    case 'RESET_ALL':
      return { ...initial }
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

  const hasFile = state.currentFile !== null && state.audioBuffer !== null
  const hasChanges = effectiveTransforms(state.selectedTransforms, state.speedState) !== state.appliedSnapshot
  const hasTransforms = state.selectedTransforms.length > 0 || (Object.values(state.speedState) as number[]).some(s => s > 0)

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
      let buf = state.audioBuffer!
      for (const action of state.selectedTransforms) {
        if (action === 'reverse') buf = transformReverse(buf)
        else if (action === 'mono') buf = transformMono(buf)
        else if (action === 'normalize') buf = transformNormalize(buf)
      }
      for (const [group, s] of Object.entries(state.speedState) as [SpeedKey, number][]) {
        if (s > 0) buf = transformSpeed(buf, SPEED_CYCLES[group].factors[s - 1])
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
    dispatch({ type: 'ENCODE_START' })
    setTimeout(() => {
      try {
        const blob = format === 'mp3' ? encodeMP3(state.workingBuffer!) : encodeWAV(state.workingBuffer!)
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

  const infoText = hasFile && state.workingBuffer
    ? fileInfo(state.currentFile!, state.workingBuffer)
    : ''

  return (
    <div className={styles.app}>
      <BackLink />
      <AppHeader title="audio" />

      {!hasFile && !state.statusVisible && (
        <DropZone accept="audio/*" onFile={loadFile} label="drop audio file here" />
      )}

      <StatusMessage message={state.statusMsg} visible={state.statusVisible} />

      {state.errorMsg && <p className={styles.errorMsg}>{state.errorMsg}</p>}

      {hasFile && !state.statusVisible && (
        <>
          <div className={styles.fileMeta}>
            <span className={styles.fileInfo}>{infoText}</span>
            <ActionButton onClick={resetAll} muted>reset</ActionButton>
          </div>

          <audio ref={playerRef} className={styles.player} src={state.playerSrc} controls />

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
          </div>
        </>
      )}
    </div>
  )
}
