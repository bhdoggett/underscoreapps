import { useReducer, useRef, useEffect } from 'react'
import AppHeader from '../../components/AppHeader'
import RangeSlider from '../../components/RangeSlider'
import DragNumber from '../../components/DragNumber'
import { useIsLandscapeMobile } from '../../hooks/useIsLandscapeMobile'
import { AudioPlusEngine } from './engine'
import type { EngineTrack } from './engine'
import { mixDown } from './mixDown'
import { saveProject, loadProject } from './serialize'
import { useWaveform } from './useWaveform'
import { encodeWAV } from '../../utils/audio/wavEncoder'
import { encodeMP3 } from '../../utils/audio/mp3Encoder'
import styles from './AudioPlusApp.module.css'

const SIDEBAR_WIDTH = 180
const TRACK_ROW_HEIGHT = 72

// ── Types ────────────────────────────────────────────────────────────────────

type Track = {
  id: string
  name: string
  audioData: ArrayBuffer
  startOffset: number   // seconds from timeline start; negative allowed
  trimStart: number     // seconds to skip at buffer start
  trimEnd: number       // seconds to skip at buffer end
  volume: number        // 0–1
  pan: number           // -1 to +1
  muted: boolean
}

type State = {
  phase: 'idle' | 'recording'
  projectName: string
  bpm: number
  metronomeOn: boolean
  isPlaying: boolean
  playheadTime: number
  tracks: Track[]
  latencyOffsetMs: number
  pxPerSec: number
  beatsPerMeasure: number
}

type Action =
  | { type: 'ADD_TRACK'; track: Track }
  | { type: 'REMOVE_TRACK'; id: string }
  | { type: 'RENAME_TRACK'; id: string; name: string }
  | { type: 'SET_VOLUME'; id: string; volume: number }
  | { type: 'SET_PAN'; id: string; pan: number }
  | { type: 'TOGGLE_MUTE'; id: string }
  | { type: 'SET_OFFSET'; id: string; startOffset: number }
  | { type: 'SET_TRIM'; id: string; trimStart: number; trimEnd: number }
  | { type: 'SET_BPM'; bpm: number }
  | { type: 'TOGGLE_METRONOME' }
  | { type: 'SET_PLAYING'; isPlaying: boolean }
  | { type: 'SET_PLAYHEAD'; time: number }
  | { type: 'SET_PHASE'; phase: State['phase'] }
  | { type: 'SET_PROJECT_NAME'; name: string }
  | { type: 'SET_LATENCY'; ms: number }
  | { type: 'SET_PX_PER_SEC'; pxPerSec: number }
  | { type: 'SET_BEATS_PER_MEASURE'; beats: number }
  | { type: 'LOAD_PROJECT'; projectName: string; bpm: number; latencyOffsetMs: number; tracks: Track[] }

const initial: State = {
  phase: 'idle',
  projectName: 'untitled',
  bpm: 120,
  metronomeOn: false,
  isPlaying: false,
  playheadTime: 0,
  tracks: [],
  latencyOffsetMs: 0,
  pxPerSec: 100,
  beatsPerMeasure: 4,
}

function reducer(state: State, action: Action): State {
  switch (action.type) {
    case 'ADD_TRACK':
      return { ...state, tracks: [...state.tracks, action.track] }
    case 'REMOVE_TRACK':
      return { ...state, tracks: state.tracks.filter(t => t.id !== action.id) }
    case 'RENAME_TRACK':
      return { ...state, tracks: state.tracks.map(t => t.id === action.id ? { ...t, name: action.name } : t) }
    case 'SET_VOLUME':
      return { ...state, tracks: state.tracks.map(t => t.id === action.id ? { ...t, volume: action.volume } : t) }
    case 'SET_PAN':
      return { ...state, tracks: state.tracks.map(t => t.id === action.id ? { ...t, pan: action.pan } : t) }
    case 'TOGGLE_MUTE':
      return { ...state, tracks: state.tracks.map(t => t.id === action.id ? { ...t, muted: !t.muted } : t) }
    case 'SET_OFFSET':
      return { ...state, tracks: state.tracks.map(t => t.id === action.id ? { ...t, startOffset: action.startOffset } : t) }
    case 'SET_TRIM':
      return { ...state, tracks: state.tracks.map(t => t.id === action.id ? { ...t, trimStart: action.trimStart, trimEnd: action.trimEnd } : t) }
    case 'SET_BPM':
      return { ...state, bpm: Math.max(20, Math.min(300, action.bpm)) }
    case 'TOGGLE_METRONOME':
      return { ...state, metronomeOn: !state.metronomeOn }
    case 'SET_PLAYING':
      return { ...state, isPlaying: action.isPlaying }
    case 'SET_PLAYHEAD':
      return { ...state, playheadTime: action.time }
    case 'SET_PHASE':
      return { ...state, phase: action.phase }
    case 'SET_PROJECT_NAME':
      return { ...state, projectName: action.name }
    case 'SET_LATENCY':
      return { ...state, latencyOffsetMs: action.ms }
    case 'SET_PX_PER_SEC':
      return { ...state, pxPerSec: action.pxPerSec }
    case 'SET_BEATS_PER_MEASURE':
      return { ...state, beatsPerMeasure: Math.max(1, Math.min(16, action.beats)) }
    case 'LOAD_PROJECT':
      return {
        ...state,
        phase: 'idle',
        isPlaying: false,
        playheadTime: 0,
        projectName: action.projectName,
        bpm: action.bpm,
        latencyOffsetMs: action.latencyOffsetMs,
        tracks: action.tracks,
      }
    default:
      return state
  }
}

// ── TrackRow ─────────────────────────────────────────────────────────────────

type TrackRowProps = {
  track: Track
  buffer: AudioBuffer | null
  pxPerSec: number
  dispatch: React.Dispatch<Action>
}

function TrackRow({ track, buffer, pxPerSec, dispatch }: TrackRowProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  useWaveform(canvasRef, buffer, track.trimStart, track.trimEnd, pxPerSec, TRACK_ROW_HEIGHT - 16)

  const duration = buffer ? buffer.duration - track.trimStart - track.trimEnd : 0
  const canvasWidth = Math.max(1, Math.round(duration * pxPerSec))
  const leftPos = Math.max(0, track.startOffset) * pxPerSec

  function handleDragPointerDown(e: React.PointerEvent<HTMLCanvasElement>) {
    e.preventDefault()
    e.currentTarget.setPointerCapture(e.pointerId)
    const startX = e.clientX
    const origOffset = track.startOffset
    function onMove(ev: PointerEvent) {
      dispatch({ type: 'SET_OFFSET', id: track.id, startOffset: origOffset + (ev.clientX - startX) / pxPerSec })
    }
    function onUp() {
      document.removeEventListener('pointermove', onMove)
      document.removeEventListener('pointerup', onUp)
    }
    document.addEventListener('pointermove', onMove)
    document.addEventListener('pointerup', onUp)
  }

  function handleTrimLeft(e: React.PointerEvent<HTMLDivElement>) {
    e.preventDefault()
    e.stopPropagation()
    e.currentTarget.setPointerCapture(e.pointerId)
    const startX = e.clientX
    const origTrimStart = track.trimStart
    function onMove(ev: PointerEvent) {
      const newTrimStart = Math.max(0, Math.min(
        origTrimStart + (ev.clientX - startX) / pxPerSec,
        (buffer?.duration ?? 0) - track.trimEnd - 0.1
      ))
      dispatch({ type: 'SET_TRIM', id: track.id, trimStart: newTrimStart, trimEnd: track.trimEnd })
    }
    function onUp() {
      document.removeEventListener('pointermove', onMove)
      document.removeEventListener('pointerup', onUp)
    }
    document.addEventListener('pointermove', onMove)
    document.addEventListener('pointerup', onUp)
  }

  function handleTrimRight(e: React.PointerEvent<HTMLDivElement>) {
    e.preventDefault()
    e.stopPropagation()
    e.currentTarget.setPointerCapture(e.pointerId)
    const startX = e.clientX
    const origTrimEnd = track.trimEnd
    function onMove(ev: PointerEvent) {
      const newTrimEnd = Math.max(0, Math.min(
        origTrimEnd - (ev.clientX - startX) / pxPerSec,
        (buffer?.duration ?? 0) - track.trimStart - 0.1
      ))
      dispatch({ type: 'SET_TRIM', id: track.id, trimStart: track.trimStart, trimEnd: newTrimEnd })
    }
    function onUp() {
      document.removeEventListener('pointermove', onMove)
      document.removeEventListener('pointerup', onUp)
    }
    document.addEventListener('pointermove', onMove)
    document.addEventListener('pointerup', onUp)
  }

  return (
    <div className={styles.trackRow}>
      <div className={styles.sidebar}>
        <input
          className={styles.trackName}
          value={track.name}
          onChange={e => dispatch({ type: 'RENAME_TRACK', id: track.id, name: e.target.value })}
        />
        <div className={styles.sidebarControls}>
          <span className={styles.faderLabel}>vol</span>
          <RangeSlider className={styles.fader} min={0} max={1} step={0.01}
            value={track.volume}
            onChange={v => dispatch({ type: 'SET_VOLUME', id: track.id, volume: v })} />
          <span className={styles.faderLabel}>pan</span>
          <RangeSlider className={styles.fader} min={-1} max={1} step={0.01}
            value={track.pan}
            onChange={v => dispatch({ type: 'SET_PAN', id: track.id, pan: v })} />
        </div>
        <div className={styles.sidebarActions}>
          <button
            className={[styles.muteBtn, track.muted ? styles.muteBtnOn : ''].join(' ')}
            onClick={() => dispatch({ type: 'TOGGLE_MUTE', id: track.id })}
          >M</button>
          <button className={styles.deleteBtn}
            onClick={() => dispatch({ type: 'REMOVE_TRACK', id: track.id })}>×</button>
        </div>
      </div>
      <div className={styles.waveformArea}>
        {buffer && (
          <div className={styles.waveformClip} style={{ left: leftPos, width: canvasWidth + 10 }}>
            <div className={styles.trimHandleLeft} onPointerDown={handleTrimLeft} />
            <canvas ref={canvasRef} className={styles.waveformCanvas} onPointerDown={handleDragPointerDown} />
            <div className={styles.trimHandleRight} onPointerDown={handleTrimRight} />
          </div>
        )}
      </div>
    </div>
  )
}

export default function AudioPlusApp() {
  const [state, dispatch] = useReducer(reducer, initial)
  const isLandscapeMobile = useIsLandscapeMobile()

  const engineRef = useRef(new AudioPlusEngine())
  const buffersRef = useRef<Map<string, AudioBuffer>>(new Map())
  const timelineRef = useRef<HTMLDivElement>(null)
  const gridCanvasRef = useRef<HTMLCanvasElement>(null)

  // Detect output latency once on mount; destroy engine on unmount
  useEffect(() => {
    const ms = engineRef.current.getLatencyMs()
    dispatch({ type: 'SET_LATENCY', ms })
    return () => engineRef.current.destroy()
  }, [])

  // Redraw BPM grid when bpm, zoom, or track count changes
  useEffect(() => {
    const canvas = gridCanvasRef.current
    const timeline = timelineRef.current
    if (!canvas || !timeline) return
    const totalWidth = Math.max(timeline.scrollWidth, timeline.clientWidth)
    const totalHeight = Math.max(timeline.scrollHeight, timeline.clientHeight, TRACK_ROW_HEIGHT)
    const dpr = window.devicePixelRatio || 1
    canvas.width = totalWidth * dpr
    canvas.height = totalHeight * dpr
    canvas.style.width = `${totalWidth}px`
    canvas.style.height = `${totalHeight}px`
    const ctx = canvas.getContext('2d')!
    ctx.scale(dpr, dpr)
    ctx.clearRect(0, 0, totalWidth, totalHeight)
    const style = getComputedStyle(document.documentElement)
    const dimColor = style.getPropertyValue('--dim').trim()
    const ruleColor = style.getPropertyValue('--rule').trim()
    const beatInterval = (60 / state.bpm) * state.pxPerSec
    let beat = 0
    let x = SIDEBAR_WIDTH
    while (x < totalWidth) {
      ctx.fillStyle = beat % state.beatsPerMeasure === 0 ? dimColor : ruleColor
      ctx.fillRect(Math.round(x), 0, 1, totalHeight)
      x += beatInterval
      beat++
    }
  }, [state.bpm, state.pxPerSec, state.beatsPerMeasure, state.tracks.length])

  // Sync volume/pan to live audio nodes whenever tracks change
  useEffect(() => {
    for (const track of state.tracks) {
      engineRef.current.setTrackVolume(track.id, track.volume)
      engineRef.current.setTrackPan(track.id, track.pan)
    }
  }, [state.tracks])

  // Spacebar always triggers transport (never activates focused buttons)
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key !== ' ') return
      const target = e.target as HTMLElement
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') return
      e.preventDefault()
      if (state.phase === 'recording') {
        handleStopRecord()
        return
      }
      if (state.isPlaying) {
        engineRef.current.stop()
        dispatch({ type: 'SET_PLAYING', isPlaying: false })
        dispatch({ type: 'SET_PLAYHEAD', time: 0 })
      } else {
        engineRef.current.play(
          state.tracks.filter(t => buffersRef.current.has(t.id)).map(t => ({ ...t, buffer: buffersRef.current.get(t.id)! })),
          state.bpm, state.beatsPerMeasure, state.metronomeOn,
          (elapsed) => dispatch({ type: 'SET_PLAYHEAD', time: elapsed })
        )
        dispatch({ type: 'SET_PLAYING', isPlaying: true })
      }
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.isPlaying, state.phase, state.bpm, state.metronomeOn, state.tracks, state.latencyOffsetMs])

  // ── Handlers ──────────────────────────────────────────────────────────────

  function getEngineTracks(): EngineTrack[] {
    return state.tracks
      .filter(t => buffersRef.current.has(t.id))
      .map(t => ({ ...t, buffer: buffersRef.current.get(t.id)! }))
  }

  function handlePlay() {
    if (state.isPlaying) return
    engineRef.current.play(getEngineTracks(), state.bpm, state.beatsPerMeasure, state.metronomeOn, (elapsed) => {
      dispatch({ type: 'SET_PLAYHEAD', time: elapsed })
    })
    dispatch({ type: 'SET_PLAYING', isPlaying: true })
  }

  function handleStop() {
    engineRef.current.stop()
    dispatch({ type: 'SET_PLAYING', isPlaying: false })
    dispatch({ type: 'SET_PLAYHEAD', time: 0 })
  }

  async function handleImport() {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = 'audio/*'
    input.onchange = async () => {
      const file = input.files?.[0]
      if (!file) return
      const ctx = engineRef.current.getCtx()
      const arrayBuffer = await file.arrayBuffer()
      const buffer = await ctx.decodeAudioData(arrayBuffer.slice(0))
      const id = crypto.randomUUID()
      buffersRef.current.set(id, buffer)
      dispatch({
        type: 'ADD_TRACK',
        track: {
          id,
          name: file.name.replace(/\.[^/.]+$/, ''),
          audioData: arrayBuffer,
          startOffset: 0,
          trimStart: 0,
          trimEnd: 0,
          volume: 1,
          pan: 0,
          muted: false,
        },
      })
    }
    input.click()
  }

  async function handleRecord() {
    dispatch({ type: 'SET_PHASE', phase: 'recording' })
    dispatch({ type: 'SET_PLAYING', isPlaying: true })
    try {
      const { latencyMs } = await engineRef.current.startRecording(
        getEngineTracks(), state.bpm, state.beatsPerMeasure, state.metronomeOn,
        (elapsed) => dispatch({ type: 'SET_PLAYHEAD', time: elapsed })
      )
      dispatch({ type: 'SET_LATENCY', ms: latencyMs })
    } catch (_e) {
      dispatch({ type: 'SET_PHASE', phase: 'idle' })
      dispatch({ type: 'SET_PLAYING', isPlaying: false })
    }
  }

  function handleToggleMetronome() {
    const next = !state.metronomeOn
    dispatch({ type: 'TOGGLE_METRONOME' })
    if (state.isPlaying || state.phase === 'recording') {
      engineRef.current.setMetronome(next, state.bpm, state.beatsPerMeasure)
    }
  }

  async function handleStopRecord() {
    try {
      const { audioData, startOffset } = await engineRef.current.stopRecording(state.latencyOffsetMs)
      const ctx = engineRef.current.getCtx()
      const buffer = await ctx.decodeAudioData(audioData.slice(0))
      const id = crypto.randomUUID()
      buffersRef.current.set(id, buffer)
      dispatch({
        type: 'ADD_TRACK',
        track: {
          id,
          name: `track ${state.tracks.length + 1}`,
          audioData,
          startOffset,
          trimStart: 0,
          trimEnd: 0,
          volume: 1,
          pan: 0,
          muted: false,
        },
      })
    } finally {
      dispatch({ type: 'SET_PHASE', phase: 'idle' })
      dispatch({ type: 'SET_PLAYING', isPlaying: false })
      dispatch({ type: 'SET_PLAYHEAD', time: 0 })
    }
  }

  async function handleExport(format: 'wav' | 'mp3') {
    const active = getEngineTracks()
    if (active.length === 0) return
    const mixed = mixDown(active, engineRef.current.getCtx().sampleRate)
    const blob = format === 'wav' ? encodeWAV(mixed) : await encodeMP3(mixed)
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${state.projectName}.${format}`
    a.click()
    URL.revokeObjectURL(url)
  }

  async function handleSave(mode: 'full' | 'compact') {
    await saveProject({
      projectName: state.projectName,
      bpm: state.bpm,
      latencyOffsetMs: state.latencyOffsetMs,
      tracks: getEngineTracks().map(t => {
        const st = state.tracks.find(s => s.id === t.id)!
        return { ...t, name: st.name, audioData: st.audioData }
      }),
      mode,
    })
  }

  async function handleLoad() {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = '.audioplus'
    input.onchange = async () => {
      const file = input.files?.[0]
      if (!file) return
      const ctx = engineRef.current.getCtx()
      const { projectName, bpm, latencyOffsetMs, tracks, buffers } = await loadProject(file, ctx)
      buffersRef.current = buffers
      dispatch({ type: 'LOAD_PROJECT', projectName, bpm, latencyOffsetMs, tracks })
    }
    input.click()
  }

  // ── Timeline width ─────────────────────────────────────────────────────────

  const totalDuration = state.tracks.reduce((max, t) => {
    const buf = buffersRef.current.get(t.id)
    if (!buf) return max
    const end = Math.max(0, t.startOffset) + (buf.duration - t.trimStart - t.trimEnd)
    return Math.max(max, end)
  }, 0)
  const timelineContentWidth = Math.max(800, Math.round(totalDuration * state.pxPerSec) + SIDEBAR_WIDTH + 200)

  // ── Render ─────────────────────────────────────────────────────────────────

  const inner = (
    <div className={styles.content}>
      <div className={styles.topBar}>
        <input
          className={styles.projectName}
          value={state.projectName}
          onChange={e => dispatch({ type: 'SET_PROJECT_NAME', name: e.target.value })}
        />
        <div className={styles.bpmGroup}>
          <DragNumber value={state.bpm} min={20} max={300}
            className={styles.dragNum}
            onChange={v => dispatch({ type: 'SET_BPM', bpm: v })} />
          <span className={styles.topLabel}>bpm</span>
        </div>
        <div className={styles.bpmGroup}>
          <DragNumber value={state.beatsPerMeasure} min={1} max={16}
            className={styles.dragNum}
            onChange={v => dispatch({ type: 'SET_BEATS_PER_MEASURE', beats: v })} />
          <span className={styles.topLabel}>beats</span>
          <button
            className={[styles.topBtn, state.metronomeOn ? styles.topBtnOn : ''].join(' ')}
            onClick={handleToggleMetronome}
          >click</button>
        </div>
        <div className={styles.zoomGroup}>
          <span className={styles.topLabel}>zoom</span>
          <RangeSlider min={20} max={400} step={10}
            value={state.pxPerSec}
            className={styles.zoomSlider}
            onChange={v => dispatch({ type: 'SET_PX_PER_SEC', pxPerSec: v })}
          />
        </div>
        <div className={styles.transport}>
          <button
            className={styles.transportBtn}
            onClick={state.isPlaying ? handleStop : handlePlay}
            disabled={state.phase === 'recording'}
          >{state.isPlaying ? '■' : '▶'}</button>
        </div>
        <div className={styles.fileActions}>
          <button className={styles.topBtn} onClick={handleLoad}>load</button>
          <button className={styles.topBtn} onClick={() => handleSave('compact')}>save</button>
          <button className={styles.topBtn} onClick={() => handleSave('full')} title="Save full quality (larger file)">save hq</button>
          <button className={styles.topBtn} onClick={() => handleExport('wav')} disabled={state.tracks.length === 0}>wav</button>
          <button className={styles.topBtn} onClick={() => handleExport('mp3')} disabled={state.tracks.length === 0}>mp3</button>
        </div>
      </div>

      <div className={styles.timeline} ref={timelineRef}>
        <canvas ref={gridCanvasRef} className={styles.gridCanvas} />
        <div
          className={styles.playhead}
          style={{ left: SIDEBAR_WIDTH + state.playheadTime * state.pxPerSec }}
        />
        <div style={{ minWidth: timelineContentWidth }}>
          {state.tracks.map(track => (
            <TrackRow
              key={track.id}
              track={track}
              buffer={buffersRef.current.get(track.id) ?? null}
              pxPerSec={state.pxPerSec}
              dispatch={dispatch}
            />
          ))}
          {state.tracks.length === 0 && (
            <div className={styles.emptyState}>import a file or record to add a track</div>
          )}
        </div>
      </div>

      <div className={styles.bottomBar}>
        <button className={styles.addBtn} onClick={handleImport}>+ import file</button>
        <button
          className={[styles.addBtn, state.phase === 'recording' ? styles.addBtnRecording : ''].join(' ')}
          onClick={state.phase === 'recording' ? handleStopRecord : handleRecord}
        >{state.phase === 'recording' ? '■ stop recording' : '● record'}</button>
      </div>
    </div>
  )

  if (isLandscapeMobile) {
    return <div className={styles.focusOverlay}>{inner}</div>
  }

  return (
    <div className={styles.app}>
      <AppHeader
        title="audio+"
        about={<>
          <p>A multitrack audio recorder and mixer.</p>
          <ul>
            <li>Import audio files or record from your microphone</li>
            <li>Drag tracks horizontally to reposition them on the timeline</li>
            <li>Trim tracks using the handles at each edge</li>
            <li>Set BPM and toggle the click track for recording reference</li>
            <li>Adjust volume and pan per track with the sliders</li>
            <li>Export the mix as WAV or MP3</li>
            <li>Save and reload your project as a .audioplus file</li>
            <li>Use headphones when recording to prevent feedback</li>
          </ul>
        </>}
      />
      {inner}
    </div>
  )
}
