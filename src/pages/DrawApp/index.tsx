import { useEffect, useReducer, useRef, useCallback, useState } from 'react'
import AppHeader from '../../components/AppHeader'
import ActionButton from '../../components/ActionButton'
import DragNumber from '../../components/DragNumber'
import StatusMessage from '../../components/StatusMessage'
import { useAbout } from '../../contexts/AboutContext'
import styles from './DrawApp.module.css'

type HistoryEntry = { data: ImageData; w: number; h: number }

type State = {
  color: string
  brushSize: number
  copied: boolean
  recentColors: string[]
  showHandles: boolean
  canvasW: number
  canvasH: number
}

type Action =
  | { type: 'SET_COLOR'; color: string }
  | { type: 'SET_BRUSH_SIZE'; size: number }
  | { type: 'SET_COPIED'; copied: boolean }
  | { type: 'ADD_RECENT_COLOR'; color: string }
  | { type: 'TOGGLE_HANDLES' }
  | { type: 'SET_CANVAS_W'; w: number }
  | { type: 'SET_CANVAS_H'; h: number }

const initial: State = {
  color: '#000000',
  brushSize: 4,
  copied: false,
  recentColors: [],
  showHandles: false,
  canvasW: 1240,
  canvasH: 840,
}

function reducer(state: State, action: Action): State {
  switch (action.type) {
    case 'SET_COLOR': return { ...state, color: action.color }
    case 'SET_BRUSH_SIZE': return { ...state, brushSize: action.size }
    case 'SET_COPIED': return { ...state, copied: action.copied }
    case 'ADD_RECENT_COLOR': {
      const filtered = state.recentColors.filter(c => c !== action.color)
      return { ...state, recentColors: [action.color, ...filtered].slice(0, 1) }
    }
    case 'TOGGLE_HANDLES':
      return { ...state, showHandles: !state.showHandles }
    case 'SET_CANVAS_W': return { ...state, canvasW: action.w }
    case 'SET_CANVAS_H': return { ...state, canvasH: action.h }
  }
}

const SWATCHES = [
  '#000000', '#ffffff', '#ef4444', '#f97316',
  '#eab308', '#22c55e', '#3b82f6', '#a855f7',
]

// [brushSize, visual circle radius in 16×16 SVG viewBox]
const SIZE_PRESETS: [number, number][] = [
  [2,   2],
  [6,   3.5],
  [16,  5],
  [40,  6.5],
  [100, 8],
]

const MAX_HISTORY = 30

// dxSign: +1 = drag right grows W, -1 = drag left grows W
// dySign: +1 = drag down grows H, -1 = drag up grows H
// rot: SVG rotation so dots point toward the corner
// anchorX/anchorY: the corner that stays fixed during resize (0=left/top, 1=right/bottom)
// When anchorX=1, content is read from the right side of the old canvas (and placed at left of new)
const RESIZE_CORNERS = [
  { id: 'br', dxSign:  1, dySign:  1, anchorX: 0, anchorY: 0, cursor: 'nwse-resize', rot:   0, pos: { bottom: 2, right: 2 } },
  { id: 'bl', dxSign: -1, dySign:  1, anchorX: 1, anchorY: 0, cursor: 'nesw-resize', rot: 270, pos: { bottom: 2, left:  2 } },
  { id: 'tr', dxSign:  1, dySign: -1, anchorX: 0, anchorY: 1, cursor: 'nesw-resize', rot:  90, pos: { top:    2, right: 2 } },
  { id: 'tl', dxSign: -1, dySign: -1, anchorX: 1, anchorY: 1, cursor: 'nwse-resize', rot: 180, pos: { top:    2, left:  2 } },
] as const

export default function DrawApp() {
  const [state, dispatch] = useReducer(reducer, initial)
  const { setContent, setIsOpen } = useAbout()

  useEffect(() => {
    setContent(
      <>
        <p>
          A simple sketchpad for signatures, quick sketches, and anything in between.
          Works with mouse, touch, or stylus. Use white to erase.
        </p>
        <p>
          Click a size dot to quickly switch brush size, or drag the size input for
          fine control. Use the resize button to toggle corner handles for adjusting
          canvas size.
        </p>
        <p>
          Keyboard shortcuts: <strong>Cmd+Z</strong> to undo,{' '}
          <strong>Cmd+Shift+Z</strong> to redo.
        </p>
      </>
    )
    return () => {
      setContent(null)
      setIsOpen(false)
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const canvasRef = useRef<HTMLCanvasElement>(null)
  const isDrawing = useRef(false)
  const lastPos = useRef<{ x: number; y: number } | null>(null)
  const historyRef = useRef<HistoryEntry[]>([])
  const historyIndexRef = useRef(-1)
  const copiedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const pendingResizeRef = useRef<{ img: HTMLImageElement; oldW: number; oldH: number; anchorX: number; anchorY: number } | null>(null)
  const pendingRestoreRef = useRef<ImageData | null>(null)
  // actualDims tracks the canvas element's real pixel dimensions — only updated on commit
  // so live drag previews (canvasW/H state changes) don't reset the canvas.
  const actualDimsRef = useRef({ w: initial.canvasW, h: initial.canvasH })
  const [commitCount, setCommitCount] = useState(0)
  const [isResizing, setIsResizing] = useState(false)
  const resizeDragRef = useRef<{ startX: number; startY: number; startW: number; startH: number; displayW: number; displayH: number; dxSign: number; dySign: number; anchorX: number; anchorY: number } | null>(null)
  const resizeAnchorRef = useRef({ x: 0, y: 0 })
  const stateRef = useRef(state)
  stateRef.current = state

  const pushHistory = useCallback((entry: HistoryEntry) => {
    const newHistory = historyRef.current.slice(0, historyIndexRef.current + 1)
    newHistory.push(entry)
    if (newHistory.length > MAX_HISTORY) newHistory.shift()
    historyRef.current = newHistory
    historyIndexRef.current = newHistory.length - 1
  }, [])

  const saveHistory = useCallback(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    pushHistory({ data: ctx.getImageData(0, 0, canvas.width, canvas.height), w: canvas.width, h: canvas.height })
  }, [pushHistory])

  // Only fires on explicit commit (not on every live drag tick).
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, canvas.width, canvas.height)
    if (pendingRestoreRef.current) {
      ctx.putImageData(pendingRestoreRef.current, 0, 0)
      pendingRestoreRef.current = null
    } else if (pendingResizeRef.current) {
      const { img, oldW, oldH, anchorX, anchorY } = pendingResizeRef.current
      const newW = canvas.width
      const newH = canvas.height
      const apply = () => {
        // Source offset: read from the far edge when anchor is on that side
        const srcX = anchorX === 1 ? Math.max(0, oldW - newW) : 0
        const srcY = anchorY === 1 ? Math.max(0, oldH - newH) : 0
        // Dest offset: place content away from edge when canvas grew on that side
        const destX = anchorX === 1 ? Math.max(0, newW - oldW) : 0
        const destY = anchorY === 1 ? Math.max(0, newH - oldH) : 0
        const copyW = Math.min(newW, oldW)
        const copyH = Math.min(newH, oldH)
        ctx.drawImage(img, srcX, srcY, copyW, copyH, destX, destY, copyW, copyH)
        // Push post-resize state (pre-resize was already saved before commit)
        pushHistory({ data: ctx.getImageData(0, 0, newW, newH), w: newW, h: newH })
        pendingResizeRef.current = null
      }
      if (img.complete) apply()
      else img.onload = apply
    } else {
      historyRef.current = [{ data: ctx.getImageData(0, 0, canvas.width, canvas.height), w: canvas.width, h: canvas.height }]
      historyIndexRef.current = 0
    }
  }, [commitCount]) // eslint-disable-line react-hooks/exhaustive-deps

  const commitResize = (w: number, h: number, anchorX = 0, anchorY = 0) => {
    const cw = Math.round(Math.max(200, Math.min(1240, w)) / 10) * 10
    const ch = Math.round(Math.max(200, Math.min(2000, h)) / 10) * 10
    if (cw === actualDimsRef.current.w && ch === actualDimsRef.current.h) return
    const canvas = canvasRef.current
    if (!canvas) return
    // Save pre-resize state before canvas is cleared
    saveHistory()
    const img = new Image()
    img.src = canvas.toDataURL()
    pendingResizeRef.current = { img, oldW: actualDimsRef.current.w, oldH: actualDimsRef.current.h, anchorX, anchorY }
    actualDimsRef.current = { w: cw, h: ch }
    dispatch({ type: 'SET_CANVAS_W', w: cw })
    dispatch({ type: 'SET_CANVAS_H', h: ch })
    setCommitCount(c => c + 1)
  }

  const handleResizePointerDown = (e: React.PointerEvent<HTMLDivElement>, dxSign: number, dySign: number, anchorX: number, anchorY: number) => {
    e.stopPropagation()
    e.currentTarget.setPointerCapture(e.pointerId)
    const canvas = canvasRef.current
    if (!canvas) return
    const rect = canvas.getBoundingClientRect()
    resizeDragRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      startW: stateRef.current.canvasW,
      startH: stateRef.current.canvasH,
      displayW: rect.width,
      displayH: rect.height,
      dxSign,
      dySign,
      anchorX,
      anchorY,
    }
    resizeAnchorRef.current = { x: anchorX, y: anchorY }
    setIsResizing(true)
  }

  const calcResizeDims = (e: React.PointerEvent<HTMLDivElement>) => {
    const drag = resizeDragRef.current!
    const dx = (e.clientX - drag.startX) * drag.dxSign
    const dy = (e.clientY - drag.startY) * drag.dySign
    const scaleX = drag.startW / drag.displayW
    const scaleY = drag.startH / drag.displayH
    return {
      newW: Math.round(Math.max(200, Math.min(1240, drag.startW + dx * scaleX)) / 10) * 10,
      newH: Math.round(Math.max(200, Math.min(2000, drag.startH + dy * scaleY)) / 10) * 10,
    }
  }

  const handleResizePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!resizeDragRef.current) return
    const { newW, newH } = calcResizeDims(e)
    dispatch({ type: 'SET_CANVAS_W', w: newW })
    dispatch({ type: 'SET_CANVAS_H', h: newH })
  }

  const handleResizePointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!resizeDragRef.current) return
    const { anchorX, anchorY } = resizeDragRef.current
    const { newW, newH } = calcResizeDims(e)
    resizeDragRef.current = null
    setIsResizing(false)
    commitResize(newW, newH, anchorX, anchorY)
  }

  const getCanvasPos = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current!
    const rect = canvas.getBoundingClientRect()
    return {
      x: Math.round((e.clientX - rect.left) * (stateRef.current.canvasW / rect.width)),
      y: Math.round((e.clientY - rect.top) * (stateRef.current.canvasH / rect.height)),
    }
  }

  const handlePointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId)
    saveHistory()
    isDrawing.current = true
    const pos = getCanvasPos(e)
    lastPos.current = pos

    // Draw a dot on tap/click (no movement needed)
    const canvas = canvasRef.current
    const ctx = canvas?.getContext('2d')
    if (ctx) {
      const { color, brushSize } = stateRef.current
      ctx.save()
      ctx.beginPath()
      ctx.arc(pos.x, pos.y, brushSize / 2, 0, Math.PI * 2)
      ctx.fillStyle = color
      ctx.fill()
      ctx.restore()
    }
  }

  const handlePointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!isDrawing.current || !lastPos.current) return
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const { color, brushSize } = stateRef.current
    const pos = getCanvasPos(e)

    ctx.save()
    ctx.beginPath()
    ctx.moveTo(lastPos.current.x, lastPos.current.y)
    ctx.lineTo(pos.x, pos.y)
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
    ctx.globalCompositeOperation = 'source-over'
    ctx.lineWidth = brushSize
    ctx.strokeStyle = color
    ctx.stroke()
    ctx.restore()
    lastPos.current = pos
  }

  const handlePointerUp = () => {
    isDrawing.current = false
    lastPos.current = null
  }

  const restoreHistoryEntry = (entry: HistoryEntry) => {
    const canvas = canvasRef.current
    if (!canvas) return
    if (entry.w !== actualDimsRef.current.w || entry.h !== actualDimsRef.current.h) {
      // Dimensions differ: route through commitCount effect so putImageData runs
      // after React has set the canvas width/height attributes (which clears the canvas).
      actualDimsRef.current = { w: entry.w, h: entry.h }
      pendingRestoreRef.current = entry.data
      dispatch({ type: 'SET_CANVAS_W', w: entry.w })
      dispatch({ type: 'SET_CANVAS_H', h: entry.h })
      setCommitCount(c => c + 1)
    } else {
      const ctx = canvas.getContext('2d')
      if (!ctx) return
      ctx.putImageData(entry.data, 0, 0)
    }
  }

  const undo = useCallback(() => {
    if (historyIndexRef.current <= 0) return
    historyIndexRef.current--
    restoreHistoryEntry(historyRef.current[historyIndexRef.current])
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const redo = useCallback(() => {
    if (historyIndexRef.current >= historyRef.current.length - 1) return
    historyIndexRef.current++
    restoreHistoryEntry(historyRef.current[historyIndexRef.current])
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const clear = () => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    saveHistory()
    ctx.globalCompositeOperation = 'source-over'
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, canvas.width, canvas.height)
  }

  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      const meta = e.metaKey || e.ctrlKey
      if (!meta) return
      if (e.key === 'z' && !e.shiftKey) { e.preventDefault(); undo() }
      if (e.key === 'z' && e.shiftKey) { e.preventDefault(); redo() }
      if (e.key === 'y') { e.preventDefault(); redo() }
    }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [undo, redo])

  const download = (format: 'png' | 'jpeg' | 'webp') => {
    const mime = `image/${format}`
    const url = canvasRef.current!.toDataURL(mime)
    const a = document.createElement('a')
    a.href = url
    a.download = `drawing.${format === 'jpeg' ? 'jpg' : format}`
    a.click()
  }

  const copyPng = () => {
    canvasRef.current!.toBlob((blob) => {
      if (!blob) return
      navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })])
        .then(() => {
          dispatch({ type: 'SET_COPIED', copied: true })
          if (copiedTimerRef.current) clearTimeout(copiedTimerRef.current)
          copiedTimerRef.current = setTimeout(() => {
            dispatch({ type: 'SET_COPIED', copied: false })
          }, 1200)
        })
    }, 'image/png')
  }

  const r = Math.max(2, Math.round((state.brushSize * 0.45) / 2))
  const d = r * 2
  const cursorSvg = `<svg xmlns='http://www.w3.org/2000/svg' width='${d}' height='${d}'><circle cx='${r}' cy='${r}' r='${r}' fill='black'/></svg>`
  const canvasCursor = `url("data:image/svg+xml,${encodeURIComponent(cursorSvg)}") ${r} ${r}, crosshair`

  return (
    <div className={styles.app}>
      <AppHeader title="draw" />

      <div className={styles.toolbar}>
        <div className={styles.toolbarRow}>
          <div className={styles.swatchGroup}>
            {SWATCHES.map((hex, i) => (
              <button
                key={hex}
                className={[
                  styles.swatch,
                  state.color === hex ? styles.swatchActive : '',
                  [3, 5, 7].includes(i) ? styles.swatchHideLarge : '',
                  i === 6 ? styles.swatchHideMedium : '',
                  [2, 4].includes(i) ? styles.swatchHideSmall : '',
                ].filter(Boolean).join(' ')}
                style={{ background: hex }}
                onClick={() => dispatch({ type: 'SET_COLOR', color: hex })}
                aria-label={hex}
              />
            ))}

            <div className={[styles.swatchDivider, styles.swatchHideSmall].join(' ')} />

            <div className={styles.colorPickerWrap}>
              <button
                className={[styles.swatch, styles.swatchWheel].join(' ')}
                aria-label="Pick custom color"
                onClick={() => {
                  const input = document.getElementById('colorPicker') as HTMLInputElement
                  input?.click()
                }}
              />
              <input
                id="colorPicker"
                type="color"
                className={styles.colorInput}
                value={state.color}
                onChange={(e) => dispatch({ type: 'SET_COLOR', color: e.target.value })}
                onBlur={(e) => dispatch({ type: 'ADD_RECENT_COLOR', color: e.target.value })}
              />
            </div>

            {state.recentColors[0] && (
              <button
                className={[
                  styles.swatch,
                  state.color === state.recentColors[0] ? styles.swatchActive : '',
                ].filter(Boolean).join(' ')}
                style={{ background: state.recentColors[0] }}
                aria-label={state.recentColors[0]}
                onClick={() => dispatch({ type: 'SET_COLOR', color: state.recentColors[0] })}
              />
            )}
          </div>

          <div className={styles.sizePresets}>
            {SIZE_PRESETS.map(([size, vr]) => (
              <button
                key={size}
                className={[styles.sizeDot, state.brushSize === size ? styles.sizeDotActive : ''].filter(Boolean).join(' ')}
                onClick={() => dispatch({ type: 'SET_BRUSH_SIZE', size })}
                title={`Size ${size}`}
                aria-label={`Brush size ${size}`}
              >
                <svg width="16" height="16" viewBox="0 0 16 16">
                  <circle cx="8" cy="8" r={vr} fill="currentColor" />
                </svg>
              </button>
            ))}
          </div>

          <label className={styles.sizeGroup}>
            <span className={styles.label}>size</span>
            <DragNumber
              value={state.brushSize}
              min={1}
              max={100}
              pixelsPerUnit={1}
              className={styles.sizeInput}
              onChange={(v) => dispatch({ type: 'SET_BRUSH_SIZE', size: v })}
            />
          </label>
        </div>

        <div className={styles.toolbarRowGrid}>
          <div className={styles.historyGroup}>
            <button className={styles.toolBtn} onClick={undo} title="Undo (Cmd+Z)">undo</button>
            <button className={styles.toolBtn} onClick={redo} title="Redo (Cmd+Shift+Z)">redo</button>
            <button className={styles.toolBtn} onClick={clear}>clear</button>
          </div>
          <div className={styles.canvasSizeGroup}>
            <DragNumber
              value={state.canvasW}
              min={200}
              max={1240}
              step={10}
              pixelsPerUnit={1}
              className={styles.canvasSizeInput}
              onChange={(v) => dispatch({ type: 'SET_CANVAS_W', w: v })}
              onCommit={(v) => commitResize(v, state.canvasH)}
            />
            <span className={styles.label}>×</span>
            <DragNumber
              value={state.canvasH}
              min={200}
              max={2000}
              step={10}
              pixelsPerUnit={1}
              className={styles.canvasSizeInput}
              onChange={(v) => dispatch({ type: 'SET_CANVAS_H', h: v })}
              onCommit={(v) => commitResize(state.canvasW, v)}
            />
          </div>
          <div className={styles.cropCol}>
            <span className={[styles.label, styles.cropLabel].join(' ')}>crop</span>
            <button
              className={[styles.toolBtnIcon, state.showHandles ? styles.active : ''].filter(Boolean).join(' ')}
              onClick={() => dispatch({ type: 'TOGGLE_HANDLES' })}
              title="Resize canvas"
              aria-label="Resize canvas"
            >
              <svg width="13" height="13" viewBox="0 0 13 13" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
                <polyline points="1,4.5 1,1 4.5,1" />
                <polyline points="8.5,12 12,12 12,8.5" />
              </svg>
            </button>
          </div>
        </div>
      </div>

      <div
        className={styles.canvasWrap}
        style={{ width: `${Math.min(100, (actualDimsRef.current.w / 1240) * 100)}%`, margin: '0 auto' }}
      >
        <canvas
          ref={canvasRef}
          className={styles.canvas}
          style={{ cursor: canvasCursor, aspectRatio: `${actualDimsRef.current.w} / ${actualDimsRef.current.h}` }}
          width={actualDimsRef.current.w}
          height={actualDimsRef.current.h}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerLeave={handlePointerUp}
        />
        {isResizing && (
          <div
            className={styles.resizeGhost}
            style={{
              width: `${(state.canvasW / actualDimsRef.current.w) * 100}%`,
              height: `${(state.canvasH / actualDimsRef.current.h) * 100}%`,
              ...(resizeAnchorRef.current.x === 0 ? { left: 0 } : { right: 0 }),
              ...(resizeAnchorRef.current.y === 0 ? { top: 0 } : { bottom: 0 }),
            }}
          />
        )}
        {state.showHandles && RESIZE_CORNERS.filter(c => c.id === 'br' || c.id === 'tl').map(({ id, dxSign, dySign, anchorX, anchorY, cursor, rot, pos }) => (
          <div
            key={id}
            className={styles.resizeHandle}
            style={{ ...pos, cursor }}
            onPointerDown={(e) => handleResizePointerDown(e, dxSign, dySign, anchorX, anchorY)}
            onPointerMove={handleResizePointerMove}
            onPointerUp={handleResizePointerUp}
            onPointerCancel={handleResizePointerUp}
          >
            <svg width="12" height="12" viewBox="-1.5 -1.5 13 13" fill="currentColor" style={{ transform: `rotate(${rot}deg)` }}>
              <circle cx="8.5" cy="8.5" r="1.2"/>
              <circle cx="4.5" cy="8.5" r="1.2"/>
              <circle cx="0.5" cy="8.5" r="1.2"/>
              <circle cx="8.5" cy="4.5" r="1.2"/>
              <circle cx="8.5" cy="0.5" r="1.2"/>
            </svg>
          </div>
        ))}
      </div>

      <div className={styles.exportRow}>
        <ActionButton onClick={() => download('png')}>png</ActionButton>
        <ActionButton onClick={() => download('jpeg')}>jpg</ActionButton>
        <ActionButton onClick={() => download('webp')}>webp</ActionButton>
        <div style={{ flex: 1 }} />
        <ActionButton onClick={copyPng}>
          <svg width="13" height="13" viewBox="0 0 13 13" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
            <rect x="4" y="3" width="7" height="8" rx="1"/>
            <path d="M9 3V2a1 1 0 0 0-1-1H2a1 1 0 0 0-1 1v7a1 1 0 0 0 1 1h1"/>
          </svg>
          <span className={styles.copyLabel}>png</span>
        </ActionButton>
      </div>

      <StatusMessage message="copied!" visible={state.copied} />
    </div>
  )
}
