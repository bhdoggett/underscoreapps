import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import AppHeader from '../../components/AppHeader'
import RangeSlider from '../../components/RangeSlider'
import styles from './PianoApp.module.css'

// ── Key data ─────────────────────────────────────────────────────────────────

type KeyData = { midi: number; isBlack: boolean; whiteIndex: number }

// Semitone pattern C C# D D# E F F# G G# A A# B
const IS_BLACK = [false, true, false, true, false, false, true, false, true, false, true, false]

function buildKeys(): KeyData[] {
  const keys: KeyData[] = []
  let w = 0
  for (let midi = 36; midi <= 84; midi++) {
    const isBlack = IS_BLACK[midi % 12]
    keys.push({ midi, isBlack, whiteIndex: w })
    if (!isBlack) w++
  }
  return keys
}

const ALL_KEYS = buildKeys()
const WHITE_KEYS = ALL_KEYS.filter(k => !k.isBlack)
const TOTAL_WHITE_KEYS = WHITE_KEYS.length // 29
const BLACK_KEY_MAP = new Map(ALL_KEYS.filter(k => k.isBlack).map(k => [k.whiteIndex, k]))
const C4_WHITE_INDEX = 14 // MIDI 60
const DRAG_THRESHOLD = 6 // px before a tap becomes a scroll drag
const NOTE_LETTERS = ['C', '', 'D', '', 'E', 'F', '', 'G', '', 'A', '', 'B']

// ── Helpers ───────────────────────────────────────────────────────────────────

function midiFreq(midi: number) {
  return 440 * Math.pow(2, (midi - 69) / 12)
}

function clamp(v: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, v))
}

// ── Component ─────────────────────────────────────────────────────────────────

type OscEntry = { osc1: OscillatorNode; osc2: OscillatorNode; gain: GainNode }

function LockIcon({ locked }: { locked: boolean }) {
  if (locked) {
    return (
      <svg viewBox="0 0 24 24" className={styles.lockIcon} aria-hidden="true">
        <rect x="6" y="10" width="12" height="10" rx="1" className={styles.lockBodyFilled} />
        <path d="M8.5 10V7.5a3.5 3.5 0 0 1 7 0V10" />
      </svg>
    )
  }
  return (
    <svg viewBox="0 0 24 24" className={styles.lockIcon} aria-hidden="true">
      <rect x="6" y="10" width="12" height="10" rx="1" />
      <path d="M15.5 6V5.5a3.5 3.5 0 0 0-7 0V10" />
    </svg>
  )
}

export default function PianoApp() {
  const [locked, setLocked] = useState(true)
  const [showNoteNames, setShowNoteNames] = useState(false)
  const [keyWidth, setKeyWidth] = useState(48)
  const [volume, setVolume] = useState(0.8)
  const [midiConnected, setMidiConnected] = useState(false)
  const [showMidiPrompt, setShowMidiPrompt] = useState(false)
  const audioUnlockedRef = useRef(false)

  const audioCtxRef = useRef<AudioContext | null>(null)
  const masterGainRef = useRef<GainNode | null>(null)
  const volumeRef = useRef(0.8)
  const activeOscRef = useRef(new Map<number, OscEntry>())

  // Per-pointer tracking
  const activePointersRef = useRef(new Set<number>())
  const pointerNotesRef = useRef(new Map<number, number>()) // pointerId → midi (locked mode)
  const scrollPointerRef = useRef<number | null>(null)
  const dragStartXRef = useRef(0)
  const dragStartScrollRef = useRef(0)
  const isDraggingRef = useRef(false)
  const tapNoteRef = useRef<number | null>(null)

  // DOM refs — direct manipulation avoids React re-renders during play/scroll
  const pianoWrapperRef = useRef<HTMLDivElement>(null)
  const pianoInnerRef = useRef<HTMLDivElement>(null)
  const keyElemsRef = useRef(new Map<number, HTMLElement>()) // midi → key DOM element
  const wrapperRectRef = useRef<DOMRect | null>(null) // cached per gesture

  // Value refs (avoid stale closures in native listeners)
  const scrollXRef = useRef(0)
  const keyWidthRef = useRef(48)
  const lockedRef = useRef(true)

  useEffect(() => { lockedRef.current = locked }, [locked])

  // ── Audio engine ────────────────────────────────────────────────────────────

  function getCtx() {
    if (!audioCtxRef.current) {
      const ctx = new AudioContext()
      audioCtxRef.current = ctx
      const limiter = ctx.createDynamicsCompressor()
      limiter.threshold.value = -3
      limiter.knee.value = 0
      limiter.ratio.value = 20
      limiter.attack.value = 0.001
      limiter.release.value = 0.1
      limiter.connect(ctx.destination)
      const master = ctx.createGain()
      master.gain.value = volumeRef.current
      master.connect(limiter)
      masterGainRef.current = master
    }
    audioCtxRef.current.resume()
    return audioCtxRef.current
  }

  useEffect(() => {
    volumeRef.current = volume
    if (masterGainRef.current) masterGainRef.current.gain.value = volume
  }, [volume])

  function noteOn(midi: number) {
    if (activeOscRef.current.has(midi)) return
    const ctx = getCtx()
    const freq = midiFreq(midi)
    const now = ctx.currentTime

    const gain = ctx.createGain()
    gain.gain.setValueAtTime(0, now)
    gain.gain.linearRampToValueAtTime(0.7, now + 0.005)
    gain.gain.linearRampToValueAtTime(0.15, now + 0.12)
    gain.connect(masterGainRef.current ?? ctx.destination)

    const osc1 = ctx.createOscillator()
    osc1.type = 'triangle'
    osc1.frequency.value = freq
    osc1.connect(gain)
    osc1.start(now)

    const gain2 = ctx.createGain()
    gain2.gain.value = 0.25
    gain2.connect(gain)

    const osc2 = ctx.createOscillator()
    osc2.type = 'sine'
    osc2.frequency.value = freq * 2
    osc2.connect(gain2)
    osc2.start(now)

    activeOscRef.current.set(midi, { osc1, osc2, gain })
    // Direct DOM — no state update, no re-render
    keyElemsRef.current.get(midi)?.setAttribute('data-active', '')
  }

  function noteOff(midi: number) {
    const entry = activeOscRef.current.get(midi)
    if (!entry) return
    activeOscRef.current.delete(midi)
    keyElemsRef.current.get(midi)?.removeAttribute('data-active')

    const ctx = audioCtxRef.current
    if (!ctx || ctx.state === 'closed') return

    const { osc1, osc2, gain } = entry
    const now = ctx.currentTime
    gain.gain.cancelScheduledValues(now)
    gain.gain.setValueAtTime(Math.max(gain.gain.value, 0.001), now)
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.15)
    osc1.stop(now + 0.16)
    osc2.stop(now + 0.16)
  }

  useEffect(() => {
    function resumeCtx() {
      if (!audioUnlockedRef.current) {
        audioUnlockedRef.current = true
        setShowMidiPrompt(false)
      }
      audioCtxRef.current?.resume()
    }
    document.addEventListener('pointerdown', resumeCtx)
    document.addEventListener('keydown', resumeCtx)
    return () => {
      document.removeEventListener('pointerdown', resumeCtx)
      document.removeEventListener('keydown', resumeCtx)
      activeOscRef.current.forEach(({ osc1, osc2 }) => {
        try { osc1.stop(0); osc2.stop(0) } catch (_) { /* already stopped */ }
      })
      activeOscRef.current.clear()
      audioCtxRef.current?.close()
    }
  }, [])

  // ── MIDI ──────────────────────────────────────────────────────────────────

  useEffect(() => {
    if (!('requestMIDIAccess' in navigator)) return
    let access: MIDIAccess | null = null
    let sustained = false
    const sustainedNotes = new Set<number>()

    function handleMessage(e: MIDIMessageEvent) {
      const data = e.data
      if (!data || data.length < 2) return
      const cmd = data[0] & 0xf0
      const note = data[1]
      const velocity = data.length > 2 ? data[2] : 0

      if (cmd === 0x90 && velocity > 0) {
        if (!audioUnlockedRef.current) { setShowMidiPrompt(true); return }
        // Note on — if note was held by sustain, remove from sustained set (retriggered)
        sustainedNotes.delete(note)
        noteOn(note)
      } else if (cmd === 0x80 || (cmd === 0x90 && velocity === 0)) {
        // Note off — hold if sustain pedal is down
        if (sustained) {
          sustainedNotes.add(note)
        } else {
          noteOff(note)
        }
      } else if (cmd === 0xb0 && note === 64) {
        // CC 64 — sustain pedal
        sustained = velocity >= 64
        if (!sustained) {
          sustainedNotes.forEach(n => noteOff(n))
          sustainedNotes.clear()
        }
      }
    }

    function syncInputs(acc: MIDIAccess) {
      acc.inputs.forEach(input => { input.onmidimessage = handleMessage })
      setMidiConnected(acc.inputs.size > 0)
    }

    navigator.requestMIDIAccess().then(acc => {
      access = acc
      syncInputs(acc)
      acc.onstatechange = () => syncInputs(acc)
    }).catch(() => {})

    return () => {
      if (!access) return
      access.inputs.forEach(input => { input.onmidimessage = null })
      access.onstatechange = null
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Scroll helper ─────────────────────────────────────────────────────────

  function applyScroll(next: number) {
    scrollXRef.current = next
    if (pianoInnerRef.current) {
      pianoInnerRef.current.style.transform = `translateX(${-next}px)`
    }
  }

  // ── Hit testing ─────────────────────────────────────────────────────────────

  function midiFromPointer(clientX: number, clientY: number): number | null {
    const rect = wrapperRectRef.current
    if (!rect) return null
    const relX = clientX - rect.left + scrollXRef.current
    const relY = clientY - rect.top
    if (relX < 0 || relY < 0 || relY > rect.height) return null

    const kw = keyWidthRef.current
    const bkw = Math.round(kw * 0.65)
    const inBlackZone = relY < rect.height * 0.6

    const whiteIdx = Math.floor(relX / kw)
    if (whiteIdx < 0 || whiteIdx >= TOTAL_WHITE_KEYS) return null
    const posInKey = relX - whiteIdx * kw

    if (inBlackZone) {
      if (posInKey >= kw - Math.round(bkw / 2)) {
        const bk = BLACK_KEY_MAP.get(whiteIdx + 1)
        if (bk) return bk.midi
      }
      if (posInKey <= Math.round(bkw / 2)) {
        const bk = BLACK_KEY_MAP.get(whiteIdx)
        if (bk) return bk.midi
      }
    }

    return WHITE_KEYS[whiteIdx].midi
  }

  // ── Pointer handlers — native listeners for minimal latency ─────────────────
  // All handler functions only reference refs (not state), so stale closures
  // are not an issue despite the empty deps array.

  useEffect(() => {
    const wrapper = pianoWrapperRef.current
    if (!wrapper) return

    function onDown(e: PointerEvent) {
      wrapper!.setPointerCapture(e.pointerId)
      wrapperRectRef.current = wrapper!.getBoundingClientRect() // cache once per gesture
      activePointersRef.current.add(e.pointerId)

      if (lockedRef.current) {
        const midi = midiFromPointer(e.clientX, e.clientY)
        if (midi !== null) {
          noteOn(midi)
          pointerNotesRef.current.set(e.pointerId, midi)
        }
      } else {
        scrollPointerRef.current = e.pointerId
        dragStartXRef.current = e.clientX
        dragStartScrollRef.current = scrollXRef.current
        isDraggingRef.current = false
        const midi = midiFromPointer(e.clientX, e.clientY)
        if (midi !== null) {
          noteOn(midi)
          tapNoteRef.current = midi
        }
      }
    }

    function onMove(e: PointerEvent) {
      if (!activePointersRef.current.has(e.pointerId)) return

      if (lockedRef.current) {
        const prevMidi = pointerNotesRef.current.get(e.pointerId)
        const midi = midiFromPointer(e.clientX, e.clientY)
        if (midi !== prevMidi) {
          if (prevMidi !== undefined) noteOff(prevMidi)
          if (midi !== null) {
            noteOn(midi)
            pointerNotesRef.current.set(e.pointerId, midi)
          } else {
            pointerNotesRef.current.delete(e.pointerId)
          }
        }
      } else {
        if (scrollPointerRef.current !== e.pointerId) return
        if (!isDraggingRef.current) {
          if (Math.abs(e.clientX - dragStartXRef.current) < DRAG_THRESHOLD) return
          isDraggingRef.current = true
          if (tapNoteRef.current !== null) {
            noteOff(tapNoteRef.current)
            tapNoteRef.current = null
          }
        }
        const maxScroll = Math.max(0, TOTAL_WHITE_KEYS * keyWidthRef.current - wrapper!.clientWidth)
        applyScroll(clamp(dragStartScrollRef.current - (e.clientX - dragStartXRef.current), 0, maxScroll))
      }
    }

    // Shared per-pointer release logic — used by pointerup, pointerleave, pointercancel
    function releasePointer(e: PointerEvent) {
      activePointersRef.current.delete(e.pointerId)
      if (lockedRef.current) {
        const prevMidi = pointerNotesRef.current.get(e.pointerId)
        if (prevMidi !== undefined) noteOff(prevMidi)
        pointerNotesRef.current.delete(e.pointerId)
      } else {
        if (scrollPointerRef.current === e.pointerId) {
          scrollPointerRef.current = null
          if (tapNoteRef.current !== null) {
            noteOff(tapNoteRef.current)
            tapNoteRef.current = null
          }
          isDraggingRef.current = false
        }
      }
    }

    function onContextMenu(e: Event) { e.preventDefault() }

    wrapper.addEventListener('pointerdown', onDown)
    wrapper.addEventListener('pointermove', onMove)
    wrapper.addEventListener('pointerup', releasePointer)
    wrapper.addEventListener('pointerleave', releasePointer)
    wrapper.addEventListener('pointercancel', releasePointer)
    wrapper.addEventListener('contextmenu', onContextMenu)
    return () => {
      wrapper.removeEventListener('pointerdown', onDown)
      wrapper.removeEventListener('pointermove', onMove)
      wrapper.removeEventListener('pointerup', releasePointer)
      wrapper.removeEventListener('pointerleave', releasePointer)
      wrapper.removeEventListener('pointercancel', releasePointer)
      wrapper.removeEventListener('contextmenu', onContextMenu)
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Wheel scroll ──────────────────────────────────────────────────────────────

  useEffect(() => {
    const wrapper = pianoWrapperRef.current
    if (!wrapper) return
    function onWheel(e: WheelEvent) {
      if (lockedRef.current) return
      e.preventDefault()
      const maxScroll = Math.max(0, TOTAL_WHITE_KEYS * keyWidthRef.current - wrapper!.clientWidth)
      const delta = e.deltaX !== 0 ? e.deltaX : e.deltaY
      applyScroll(clamp(scrollXRef.current + delta, 0, maxScroll))
    }
    wrapper.addEventListener('wheel', onWheel, { passive: false })
    return () => wrapper.removeEventListener('wheel', onWheel)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Scroll positioning ────────────────────────────────────────────────────────

  const isMountedRef = useRef(false)

  useLayoutEffect(() => {
    const wrapper = pianoWrapperRef.current
    if (!wrapper) return
    const ww = wrapper.clientWidth
    const newKw = keyWidth
    const maxScroll = Math.max(0, TOTAL_WHITE_KEYS * newKw - ww)

    let sx: number
    if (!isMountedRef.current) {
      isMountedRef.current = true
      sx = clamp(C4_WHITE_INDEX * newKw - ww / 2 + newKw / 2, 0, maxScroll)
    } else {
      const centeredAt = (scrollXRef.current + ww / 2) / keyWidthRef.current
      sx = clamp(centeredAt * newKw - ww / 2, 0, maxScroll)
    }

    keyWidthRef.current = newKw
    applyScroll(sx)
  }, [keyWidth]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Render ──────────────────────────────────────────────────────────────────

  const blackKeyWidth = Math.round(keyWidth * 0.65)

  return (
    <div className={styles.app} onContextMenu={e => e.preventDefault()}>
      <div className={styles.header}>
        <AppHeader
          title="piano"
          about={<>
            <p>A scrollable piano spanning C2–C6, synthesized in the browser with no downloads.</p>
            <ul>
              <li><strong>Lock mode</strong> — press and slide to play notes. Each key triggers on entry and releases on exit.</li>
              <li><strong>Unlock mode</strong> — tap a key to play it; drag left or right to scroll through octaves.</li>
              <li>Use the key size slider to zoom in or out.</li>
              <li>Toggle the note names button to label every key.</li>
              <li>Rotate to landscape for a distraction-free full-screen view.</li>
            </ul>
          </>}
        />
      </div>

      <div className={styles.controls}>
        <button
          className={`${styles.lockBtn} ${locked ? styles.lockBtnActive : ''}`}
          type="button"
          aria-label={locked ? 'locked' : 'unlocked'}
          title={locked ? 'locked' : 'unlocked'}
          onClick={() => setLocked(l => !l)}
        >
          <LockIcon locked={locked} />
        </button>
        <button
          className={`${styles.lockBtn} ${showNoteNames ? styles.lockBtnActive : ''}`}
          type="button"
          aria-label="toggle note names"
          title="toggle note names"
          onClick={() => setShowNoteNames(s => !s)}
        >
          <svg viewBox="0 0 24 24" className={styles.lockIcon} aria-hidden="true">
            <path d="M9 18V6l10-2v12" strokeWidth="1.6" stroke="currentColor" fill="none" strokeLinecap="round" strokeLinejoin="round" />
            <circle cx="7" cy="18" r="2" fill="none" stroke="currentColor" strokeWidth="1.6" className={showNoteNames ? styles.lockBodyFilled : ''} />
            <circle cx="17" cy="16" r="2" fill="none" stroke="currentColor" strokeWidth="1.6" className={showNoteNames ? styles.lockBodyFilled : ''} />
          </svg>
        </button>
        <span className={styles.label}>vol</span>
        <RangeSlider
          min={0}
          max={1}
          step={0.01}
          value={volume}
          onChange={setVolume}
          className={styles.slider}
        />
        <span className={styles.label}>size</span>
        <RangeSlider
          min={32}
          max={80}
          value={keyWidth}
          onChange={setKeyWidth}
          className={styles.slider}
        />
        {midiConnected && <><span className={styles.label}>midi</span><span className={styles.midiDot} /></>}
      </div>

      <div
        ref={pianoWrapperRef}
        className={`${styles.pianoWrapper} ${locked ? styles.cursorPlay : styles.cursorScroll}`}
      >
        {showMidiPrompt && (
          <div className={styles.midiPrompt}>audio playback requires a click</div>
        )}
        <div
          ref={pianoInnerRef}
          className={styles.piano}
          style={{ width: TOTAL_WHITE_KEYS * keyWidth }}
        >
          {WHITE_KEYS.map((wk, W) => {
            const bk = BLACK_KEY_MAP.get(W + 1)
            const octave = Math.floor(wk.midi / 12) - 1
            const isC = wk.midi % 12 === 0
            const noteLabel = showNoteNames
              ? `${NOTE_LETTERS[wk.midi % 12]}${octave}`
              : isC ? String(octave) : null

            return (
              <div
                key={wk.midi}
                ref={el => { if (el) keyElemsRef.current.set(wk.midi, el as HTMLElement) }}
                className={styles.whiteKey}
                style={{ width: keyWidth }}
              >
                {bk && (
                  <div
                    ref={el => { if (el) keyElemsRef.current.set(bk.midi, el as HTMLElement) }}
                    className={styles.blackKey}
                    style={{
                      width: blackKeyWidth,
                      left: keyWidth - Math.round(blackKeyWidth / 2),
                    }}
                  />
                )}
                {noteLabel && (
                  <span className={styles.octaveLabel}>{noteLabel}</span>
                )}
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
