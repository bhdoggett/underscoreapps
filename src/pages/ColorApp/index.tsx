import { useReducer, useRef, useEffect, useCallback, useState } from 'react'
import AppHeader from '../../components/AppHeader'
import { hexToRgb, rgbToHsl, rgbToCmyk } from './colorUtils'
import styles from './ColorApp.module.css'

const eyeDropperSupported = 'EyeDropper' in window
const ORBIT_PX = 110

type PickedColor = { hex: string; r: number; g: number; b: number }

type GradientStop = { color: string; position: number }

type State = {
  pickedColor: PickedColor | null
  uploadedImg: HTMLImageElement | null
  showCanvas: boolean
  error: string
  copying: string | null
  // gradient
  stops: GradientStop[]
  angle: number
  conicAngle: number
  gradientMode: 'linear' | 'conic' | 'radial'
  radialShape: 'circle' | 'ellipse'
  radialCenterX: number
  radialCenterY: number
  radialSizeX: number
  radialSizeY: number
  selectedStop: number | null
  gradientCopied: boolean
}

type Action =
  | { type: 'PICK_COLOR'; hex: string }
  | { type: 'SET_ERROR'; msg: string }
  | { type: 'LOAD_IMAGE'; img: HTMLImageElement }
  | { type: 'CLEAR_IMAGE' }
  | { type: 'SET_COPYING'; key: string | null }
  | { type: 'ADD_STOP'; color: string; position: number }
  | { type: 'MOVE_STOP'; index: number; position: number }
  | { type: 'SELECT_STOP'; index: number | null }
  | { type: 'UPDATE_STOP_COLOR'; index: number; color: string }
  | { type: 'UPDATE_STOP_POSITION'; index: number; position: number }
  | { type: 'REMOVE_STOP'; index: number }
  | { type: 'SET_ANGLE'; angle: number }
  | { type: 'SET_CONIC_ANGLE'; angle: number }
  | { type: 'SET_GRADIENT_MODE'; mode: 'linear' | 'conic' | 'radial' }
  | { type: 'SET_RADIAL_SHAPE'; shape: 'circle' | 'ellipse' }
  | { type: 'SET_RADIAL_CENTER_X'; value: number }
  | { type: 'SET_RADIAL_CENTER_Y'; value: number }
  | { type: 'SET_RADIAL_SIZE_X'; value: number }
  | { type: 'SET_RADIAL_SIZE_Y'; value: number }
  | { type: 'SET_GRADIENT_COPIED'; value: boolean }

const initial: State = {
  pickedColor: null,
  uploadedImg: null,
  showCanvas: false,
  error: '',
  copying: null,
  stops: [
    { color: '#ff0000', position: 0 },
    { color: '#0000ff', position: 100 },
  ],
  angle: 90,
  conicAngle: 0,
  gradientMode: 'linear',
  radialShape: 'circle',
  radialCenterX: 50,
  radialCenterY: 50,
  radialSizeX: 50,
  radialSizeY: 50,
  selectedStop: null,
  gradientCopied: false,
}

function reducer(state: State, action: Action): State {
  switch (action.type) {
    case 'PICK_COLOR': {
      const { r, g, b } = hexToRgb(action.hex)
      return { ...state, pickedColor: { hex: action.hex, r, g, b }, error: '' }
    }
    case 'SET_ERROR':
      return { ...state, error: action.msg }
    case 'LOAD_IMAGE':
      return { ...state, uploadedImg: action.img, showCanvas: true, error: '' }
    case 'CLEAR_IMAGE':
      return { ...state, uploadedImg: null, showCanvas: false }
    case 'SET_COPYING':
      return { ...state, copying: action.key }
    case 'ADD_STOP': {
      const newStop = { color: action.color, position: action.position }
      const stops = [...state.stops, newStop].sort((a, b) => a.position - b.position)
      return { ...state, stops, selectedStop: stops.indexOf(newStop) }
    }
    case 'MOVE_STOP': {
      const stops = state.stops.map((s, i) =>
        i === action.index ? { ...s, position: Math.max(0, Math.min(100, action.position)) } : s
      )
      return { ...state, stops }
    }
    case 'SELECT_STOP':
      return { ...state, selectedStop: action.index }
    case 'UPDATE_STOP_COLOR': {
      const stops = state.stops.map((s, i) =>
        i === action.index ? { ...s, color: action.color } : s
      )
      return { ...state, stops }
    }
    case 'UPDATE_STOP_POSITION': {
      const stops = state.stops.map((s, i) =>
        i === action.index ? { ...s, position: Math.max(0, Math.min(100, action.position)) } : s
      )
      return { ...state, stops }
    }
    case 'REMOVE_STOP': {
      if (state.stops.length <= 2) return state
      const stops = state.stops.filter((_, i) => i !== action.index)
      return {
        ...state,
        stops,
        selectedStop: state.selectedStop === action.index ? null : state.selectedStop,
      }
    }
    case 'SET_ANGLE':
      return { ...state, angle: Math.max(0, Math.min(360, action.angle)) }
    case 'SET_CONIC_ANGLE':
      return { ...state, conicAngle: Math.max(0, Math.min(360, action.angle)) }
    case 'SET_GRADIENT_MODE':
      return { ...state, gradientMode: action.mode }
    case 'SET_RADIAL_SHAPE':
      return { ...state, radialShape: action.shape }
    case 'SET_RADIAL_CENTER_X': return { ...state, radialCenterX: Math.max(0, Math.min(100, action.value)) }
    case 'SET_RADIAL_CENTER_Y': return { ...state, radialCenterY: Math.max(0, Math.min(100, action.value)) }
    case 'SET_RADIAL_SIZE_X':   return { ...state, radialSizeX: Math.max(1, Math.min(200, action.value)) }
    case 'SET_RADIAL_SIZE_Y':   return { ...state, radialSizeY: Math.max(1, Math.min(200, action.value)) }
    case 'SET_GRADIENT_COPIED':
      return { ...state, gradientCopied: action.value }
    default:
      return state
  }
}

function randomHex(): string {
  return '#' + Math.floor(Math.random() * 0xffffff).toString(16).padStart(6, '0')
}

function gradientCss(state: State): string {
  const stopsStr = state.stops
    .map((s) => `${s.color} ${s.position}%`)
    .join(', ')
  if (state.gradientMode === 'linear') {
    return `linear-gradient(${state.angle}deg, ${stopsStr})`
  }
  if (state.gradientMode === 'radial') {
    const { radialShape, radialCenterX, radialCenterY, radialSizeX, radialSizeY } = state
    const at = `at ${radialCenterX}% ${radialCenterY}%`
    if (radialShape === 'ellipse') {
      return `radial-gradient(ellipse ${radialSizeX}% ${radialSizeY}% ${at}, ${stopsStr})`
    }
    return `radial-gradient(circle ${at}, ${stopsStr})`
  }
  return `conic-gradient(from ${state.conicAngle}deg, ${stopsStr})`
}

export default function ColorApp() {
  const [state, dispatch] = useReducer(reducer, initial)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const dragRef = useRef<{ index: number; barWidth: number } | null>(null)
  const didDragRef = useRef(false)
  const gradientModeRef = useRef(state.gradientMode)
  const angleRef = useRef(state.angle)
  const radialCenterXRef = useRef(state.radialCenterX)
  const radialCenterYRef = useRef(state.radialCenterY)
  const [angleText, setAngleText] = useState(String(state.angle))
  const [conicAngleText, setConicAngleText] = useState(String(state.conicAngle))
  const [radialCenterXText, setRadialCenterXText] = useState(String(state.radialCenterX))
  const [radialCenterYText, setRadialCenterYText] = useState(String(state.radialCenterY))
  const [radialSizeXText, setRadialSizeXText] = useState(String(state.radialSizeX))
  const [radialSizeYText, setRadialSizeYText] = useState(String(state.radialSizeY))

  // Draw uploaded image onto canvas
  useEffect(() => {
    if (!state.uploadedImg || !canvasRef.current) return
    const canvas = canvasRef.current
    const img = state.uploadedImg
    canvas.width = img.naturalWidth
    canvas.height = img.naturalHeight
    canvas.getContext('2d')!.drawImage(img, 0, 0)
  }, [state.uploadedImg, state.showCanvas])

  async function pickColor() {
    try {
      // @ts-expect-error EyeDropper is not in TS lib yet
      const dropper = new EyeDropper()
      const result = await dropper.open()
      dispatch({ type: 'PICK_COLOR', hex: result.sRGBHex })
    } catch {
      // user cancelled — do nothing
    }
  }

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    if (!file.type.startsWith('image/')) {
      dispatch({ type: 'SET_ERROR', msg: 'unsupported file type' })
      return
    }
    const url = URL.createObjectURL(file)
    const img = new Image()
    img.onload = () => dispatch({ type: 'LOAD_IMAGE', img })
    img.onerror = () => dispatch({ type: 'SET_ERROR', msg: 'could not load image' })
    img.src = url
    e.target.value = ''
  }

  function handleCanvasClick(e: React.MouseEvent<HTMLCanvasElement>) {
    const canvas = canvasRef.current
    if (!canvas) return
    const x = Math.round(e.nativeEvent.offsetX * (canvas.width / canvas.offsetWidth))
    const y = Math.round(e.nativeEvent.offsetY * (canvas.height / canvas.offsetHeight))
    const [r, g, b] = canvas.getContext('2d')!.getImageData(x, y, 1, 1).data
    const hex = '#' + [r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('')
    dispatch({ type: 'PICK_COLOR', hex })
  }

  function copyValue(key: string, value: string) {
    navigator.clipboard.writeText(value).then(() => {
      dispatch({ type: 'SET_COPYING', key })
      setTimeout(() => dispatch({ type: 'SET_COPYING', key: null }), 1200)
    })
  }

  function addToGradient() {
    if (!state.pickedColor) return
    const positions = state.stops.map((s) => s.position)
    const gaps: { pos: number; size: number }[] = []
    const sorted = [...positions].sort((a, b) => a - b)
    for (let i = 0; i < sorted.length - 1; i++) {
      gaps.push({ pos: (sorted[i] + sorted[i + 1]) / 2, size: sorted[i + 1] - sorted[i] })
    }
    const bestGap = gaps.sort((a, b) => b.size - a.size)[0]
    dispatch({ type: 'ADD_STOP', color: state.pickedColor.hex, position: bestGap?.pos ?? 50 })
  }

  // Gradient handle drag
  const handleDragStart = useCallback(
    (index: number, barWidth: number) => {
      dragRef.current = { index, barWidth }
    },
    []
  )

  useEffect(() => {
    function onMouseMove(e: MouseEvent) {
      if (!dragRef.current) return
      didDragRef.current = true
      const bar = document.getElementById('gradient-bar')
      if (!bar) return
      const rect = bar.getBoundingClientRect()
      let pos: number
      if (gradientModeRef.current === 'conic') {
        const cx = rect.left + rect.width / 2
        const cy = rect.top + rect.height / 2
        const fromRad = (angleRef.current * Math.PI) / 180
        let angleRad = Math.atan2(e.clientY - cy, e.clientX - cx) + Math.PI / 2 - fromRad
        if (angleRad < 0) angleRad += 2 * Math.PI
        pos = Math.round((angleRad / (2 * Math.PI)) * 100)
      } else if (gradientModeRef.current === 'radial') {
        const cx_px = (radialCenterXRef.current / 100) * rect.width
        pos = Math.round(Math.max(0, Math.min(1, (e.clientX - rect.left - cx_px) / ORBIT_PX)) * 100)
      } else {
        const rad = (angleRef.current * Math.PI) / 180
        const dirX = Math.sin(rad)
        const dirY = -Math.cos(rad)
        const H = 0.5 * (Math.abs(Math.sin(rad)) + Math.abs(Math.cos(rad)))
        const relX = (e.clientX - rect.left) / rect.width - 0.5
        const relY = (e.clientY - rect.top) / rect.height - 0.5
        const proj = relX * dirX + relY * dirY
        pos = Math.round(Math.max(0, Math.min(1, proj / (2 * H) + 0.5)) * 100)
      }
      dispatch({ type: 'MOVE_STOP', index: dragRef.current.index, position: Math.round(pos) })
    }
    function onMouseUp() {
      dragRef.current = null
      // Reset after click event fires (which comes after mouseup)
      setTimeout(() => { didDragRef.current = false }, 0)
    }
    window.addEventListener('mousemove', onMouseMove)
    window.addEventListener('mouseup', onMouseUp)
    return () => {
      window.removeEventListener('mousemove', onMouseMove)
      window.removeEventListener('mouseup', onMouseUp)
    }
  }, [])

  const { pickedColor, stops, angle, conicAngle, gradientMode, radialShape, selectedStop,
          radialCenterX, radialCenterY, radialSizeX, radialSizeY } = state
  gradientModeRef.current = gradientMode
  angleRef.current = gradientMode === 'conic' ? conicAngle : angle
  radialCenterXRef.current = radialCenterX
  radialCenterYRef.current = radialCenterY

  let hsl = { h: 0, s: 0, l: 0 }
  let cmyk = { c: 0, m: 0, y: 0, k: 0 }
  if (pickedColor) {
    hsl = rgbToHsl(pickedColor.r, pickedColor.g, pickedColor.b)
    cmyk = rgbToCmyk(pickedColor.r, pickedColor.g, pickedColor.b)
  }

  const formats: { key: string; label: string; value: string }[] = pickedColor
    ? [
        { key: 'hex', label: 'HEX', value: pickedColor.hex.toUpperCase() },
        { key: 'rgb', label: 'RGB', value: `rgb(${pickedColor.r}, ${pickedColor.g}, ${pickedColor.b})` },
        { key: 'hsl', label: 'HSL', value: `hsl(${hsl.h}, ${hsl.s}%, ${hsl.l}%)` },
        { key: 'cmyk', label: 'CMYK', value: `cmyk(${cmyk.c}%, ${cmyk.m}%, ${cmyk.y}%, ${cmyk.k}%)` },
      ]
    : []

  const gradCss = gradientCss(state)

  return (
    <div className={styles.app}>
      <AppHeader title="color" />

      {/* ── Phase 1: Color Picker ── */}
      <div className={styles.actionRow}>
        {eyeDropperSupported ? (
          <button className={styles.pickBtn} onClick={pickColor}>
            pick color
          </button>
        ) : (
          <p className={styles.errorMsg}>
            eyedropper not supported in this browser — use chrome or edge
          </p>
        )}
        <button
          className={styles.uploadLink}
          onClick={() => fileInputRef.current?.click()}
        >
          upload image
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          className={styles.hiddenInput}
          onChange={handleFileChange}
        />
      </div>

      {state.error && <p className={styles.errorMsg}>{state.error}</p>}

      {state.showCanvas && state.uploadedImg && (
        <div className={styles.previewWrap}>
          <div className={styles.canvasWrap}>
            <canvas
              ref={canvasRef}
              className={styles.canvas}
              onClick={handleCanvasClick}
            />
            <button
              className={styles.closeBtn}
              onClick={() => dispatch({ type: 'CLEAR_IMAGE' })}
            >
              ×
            </button>
          </div>
        </div>
      )}

      {pickedColor && (
        <>
          <div className={styles.colorRow}>
            <div
              className={styles.swatch}
              style={{ backgroundColor: pickedColor.hex }}
            />
          </div>

          <div className={styles.colorRow}>
            {formats.map((fmt) => (
              <div key={fmt.key} className={styles.colorBlock}>
                <div className={styles.formatLabel}>{fmt.label}</div>
                <div className={styles.formatValue}>{fmt.value}</div>
                <button
                  className={[styles.copyBtn, state.copying === fmt.key ? styles.copied : ''].filter(Boolean).join(' ')}
                  onClick={() => copyValue(fmt.key, fmt.value)}
                >
                  {state.copying === fmt.key ? 'copied' : 'copy'}
                </button>
              </div>
            ))}
          </div>

          <div className={styles.addToGradientRow}>
            <button className={styles.uploadLink} onClick={addToGradient}>
              + add to gradient
            </button>
          </div>
        </>
      )}

      {/* ── Phase 2: Gradient Builder ── */}
      <div className={styles.gradientSection}>
        <div className={styles.gradientHeader}>
          <span className={styles.sectionLabel}>gradient</span>
          <div className={styles.gradientModeGroup}>
          {(['linear', 'conic', 'radial'] as const).map((m) => (
            <button
              key={m}
              className={[styles.transformBtn, gradientMode === m ? styles.selected : ''].filter(Boolean).join(' ')}
              onClick={() => dispatch({ type: 'SET_GRADIENT_MODE', mode: m })}
            >
              {m}
            </button>
          ))}
          {gradientMode === 'linear' && (
            <label className={styles.angleLabel}>
              <span className={styles.formatLabel}>angle</span>
              <input
                type="number"
                min={0}
                max={360}
                value={angleText}
                className={styles.angleInput}
                onChange={(e) => {
                  setAngleText(e.target.value)
                  const n = Number(e.target.value)
                  if (e.target.value !== '' && !isNaN(n)) {
                    dispatch({ type: 'SET_ANGLE', angle: n })
                  }
                }}
                onBlur={() => setAngleText(String(angle))}
              />
            </label>
          )}
          {gradientMode === 'radial' && (
            <div className={styles.angleLabel}>
              {(['circle', 'ellipse'] as const).map((s) => (
                <button
                  key={s}
                  className={[styles.transformBtn, radialShape === s ? styles.selected : ''].filter(Boolean).join(' ')}
                  onClick={() => dispatch({ type: 'SET_RADIAL_SHAPE', shape: s })}
                >
                  {s}
                </button>
              ))}
            </div>
          )}
          {gradientMode === 'conic' && (
            <label className={styles.angleLabel}>
              <span className={styles.formatLabel}>from</span>
              <input
                type="number"
                min={0}
                max={360}
                value={conicAngleText}
                className={styles.angleInput}
                onChange={(e) => {
                  setConicAngleText(e.target.value)
                  const n = Number(e.target.value)
                  if (e.target.value !== '' && !isNaN(n)) {
                    dispatch({ type: 'SET_CONIC_ANGLE', angle: n })
                  }
                }}
                onBlur={() => setConicAngleText(String(conicAngle))}
              />
            </label>
          )}
          </div>
        </div>

        {/* Live gradient bar */}
        <div className={styles.gradientBarRow}>
        <div className={styles.gradientBarWrap}>
          <div
            id="gradient-bar"
            className={styles.gradientBar}
            style={{ background: gradCss }}
            onClick={(e) => {
              if (didDragRef.current) return
              const rect = e.currentTarget.getBoundingClientRect()
              let pos: number
              if (gradientMode === 'conic') {
                const cx = rect.left + rect.width / 2
                const cy = rect.top + rect.height / 2
                const fromRad = (conicAngle * Math.PI) / 180
                let a = Math.atan2(e.clientY - cy, e.clientX - cx) + Math.PI / 2 - fromRad
                if (a < 0) a += 2 * Math.PI
                pos = Math.round((a / (2 * Math.PI)) * 100)
              } else if (gradientMode === 'radial') {
                const cx_px = (radialCenterX / 100) * rect.width
                pos = Math.round(Math.max(0, Math.min(1, (e.clientX - rect.left - cx_px) / ORBIT_PX)) * 100)
              } else {
                const rad = (angle * Math.PI) / 180
                const dirX = Math.sin(rad)
                const dirY = -Math.cos(rad)
                const H = 0.5 * (Math.abs(Math.sin(rad)) + Math.abs(Math.cos(rad)))
                const relX = (e.clientX - rect.left) / rect.width - 0.5
                const relY = (e.clientY - rect.top) / rect.height - 0.5
                const proj = relX * dirX + relY * dirY
                pos = Math.round(Math.max(0, Math.min(1, proj / (2 * H) + 0.5)) * 100)
              }
              const color = randomHex()
              dispatch({ type: 'ADD_STOP', color, position: pos })
            }}
          >
            {stops.map((stop, i) => {
              let handleStyle: React.CSSProperties
              if (gradientMode === 'conic') {
                // from angle in CSS: 0=top, 90=right. Convert to screen math (0=right).
                const fromRad = (conicAngle * Math.PI) / 180 - Math.PI / 2
                const a = fromRad + (stop.position / 100) * 2 * Math.PI
                const r = 100 // px orbit radius inside 260px square
                const cx = 130, cy = 130
                handleStyle = { left: `${cx + r * Math.cos(a)}px`, top: `${cy + r * Math.sin(a)}px` }
              } else if (gradientMode === 'radial') {
                const cx_px = (radialCenterX / 100) * 260
                const cy_px = (radialCenterY / 100) * 260
                handleStyle = { left: `${cx_px + (stop.position / 100) * ORBIT_PX}px`, top: `${cy_px}px` }
              } else {
                const rad = (angle * Math.PI) / 180
                const dirX = Math.sin(rad)
                const dirY = -Math.cos(rad)
                const H = 0.5 * (Math.abs(Math.sin(rad)) + Math.abs(Math.cos(rad)))
                const p = stop.position / 100
                const x = (0.5 - H * dirX + p * 2 * H * dirX) * 100
                const y = (0.5 - H * dirY + p * 2 * H * dirY) * 100
                handleStyle = { left: `${x}%`, top: `${y}%` }
              }
              return (
                <div
                  key={i}
                  className={[styles.stopHandle, selectedStop === i ? styles.stopSelected : ''].filter(Boolean).join(' ')}
                  style={handleStyle}
                  onMouseDown={(e) => {
                    e.stopPropagation()
                    dispatch({ type: 'SELECT_STOP', index: i })
                    handleDragStart(i, e.currentTarget.parentElement!.offsetWidth)
                  }}
                  onClick={(e) => e.stopPropagation()}
                />
              )
            })}
          </div>
        </div>
        {gradientMode === 'radial' && (
          <div className={styles.radialControls}>
            <label className={styles.angleLabel}>
              <span className={styles.formatLabel}>center x</span>
              <input
                type="number"
                min={0}
                max={100}
                value={radialCenterXText}
                className={styles.angleInput}
                onChange={(e) => {
                  setRadialCenterXText(e.target.value)
                  const n = Number(e.target.value)
                  if (e.target.value !== '' && !isNaN(n)) {
                    dispatch({ type: 'SET_RADIAL_CENTER_X', value: n })
                  }
                }}
                onBlur={() => setRadialCenterXText(String(radialCenterX))}
              />
              <span className={styles.formatLabel}>%</span>
            </label>
            <label className={styles.angleLabel}>
              <span className={styles.formatLabel}>center y</span>
              <input
                type="number"
                min={0}
                max={100}
                value={radialCenterYText}
                className={styles.angleInput}
                onChange={(e) => {
                  setRadialCenterYText(e.target.value)
                  const n = Number(e.target.value)
                  if (e.target.value !== '' && !isNaN(n)) {
                    dispatch({ type: 'SET_RADIAL_CENTER_Y', value: n })
                  }
                }}
                onBlur={() => setRadialCenterYText(String(radialCenterY))}
              />
              <span className={styles.formatLabel}>%</span>
            </label>
            {radialShape === 'ellipse' && (
              <>
                <label className={styles.angleLabel}>
                  <span className={styles.formatLabel}>size x</span>
                  <input
                    type="number"
                    min={1}
                    max={200}
                    value={radialSizeXText}
                    className={styles.angleInput}
                    onChange={(e) => {
                      setRadialSizeXText(e.target.value)
                      const n = Number(e.target.value)
                      if (e.target.value !== '' && !isNaN(n)) {
                        dispatch({ type: 'SET_RADIAL_SIZE_X', value: n })
                      }
                    }}
                    onBlur={() => setRadialSizeXText(String(radialSizeX))}
                  />
                  <span className={styles.formatLabel}>%</span>
                </label>
                <label className={styles.angleLabel}>
                  <span className={styles.formatLabel}>size y</span>
                  <input
                    type="number"
                    min={1}
                    max={200}
                    value={radialSizeYText}
                    className={styles.angleInput}
                    onChange={(e) => {
                      setRadialSizeYText(e.target.value)
                      const n = Number(e.target.value)
                      if (e.target.value !== '' && !isNaN(n)) {
                        dispatch({ type: 'SET_RADIAL_SIZE_Y', value: n })
                      }
                    }}
                    onBlur={() => setRadialSizeYText(String(radialSizeY))}
                  />
                  <span className={styles.formatLabel}>%</span>
                </label>
              </>
            )}
          </div>
        )}
        </div>

        <div className={styles.gradientControls}>
          {/* Stop controls */}
          {stops.map((stop, i) => (
            <div key={i} className={styles.stopControls}>
              <span className={styles.formatLabel}>stop {i + 1}</span>
              <input
                type="color"
                value={stop.color}
                className={styles.colorInput}
                onChange={(e) =>
                  dispatch({ type: 'UPDATE_STOP_COLOR', index: i, color: e.target.value })
                }
              />
              <input
                type="number"
                min={0}
                max={100}
                value={stop.position}
                className={styles.angleInput}
                onChange={(e) =>
                  dispatch({ type: 'UPDATE_STOP_POSITION', index: i, position: Number(e.target.value) })
                }
              />
              <span className={styles.formatLabel}>%</span>
              <button
                className={styles.transformBtn}
                onClick={() => dispatch({ type: 'REMOVE_STOP', index: i })}
                disabled={stops.length <= 2}
              >
                remove
              </button>
            </div>
          ))}

          <div className={styles.addStopRow}>
            <button
              className={styles.uploadLink}
              onClick={() => {
                const color = randomHex()
                const positions = stops.map((s) => s.position).sort((a, b) => a - b)
                const gaps: { pos: number; size: number }[] = []
                for (let i = 0; i < positions.length - 1; i++) {
                  gaps.push({ pos: (positions[i] + positions[i + 1]) / 2, size: positions[i + 1] - positions[i] })
                }
                const best = gaps.sort((a, b) => b.size - a.size)[0]
                dispatch({ type: 'ADD_STOP', color, position: Math.round(best?.pos ?? 50) })
              }}
            >
              + add stop
            </button>
          </div>
        </div>

        {/* CSS output */}
        <div className={styles.cssOutputWrap}>
          <pre className={styles.cssOutput}>{gradCss}</pre>
          <button
            className={[styles.copyBtn, state.gradientCopied ? styles.copied : ''].filter(Boolean).join(' ')}
            onClick={() => {
              navigator.clipboard.writeText(gradCss).then(() => {
                dispatch({ type: 'SET_GRADIENT_COPIED', value: true })
                setTimeout(() => dispatch({ type: 'SET_GRADIENT_COPIED', value: false }), 1200)
              })
            }}
          >
            {state.gradientCopied ? 'copied' : 'copy'}
          </button>
        </div>
      </div>
    </div>
  )
}
