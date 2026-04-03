import { useEffect, useReducer, useRef, useCallback, useState } from 'react'
import AppHeader from '../../components/AppHeader'
import ActionButton from '../../components/ActionButton'
import DragNumber from '../../components/DragNumber'
import StatusMessage from '../../components/StatusMessage'
import { useAbout } from '../../contexts/AboutContext'
import { downloadCanvas } from '../../utils/downloadCanvas'
import styles from './DrawApp.module.css'

type HistoryEntry = { data: ImageData | null; blob: Blob | null; w: number; h: number }

const DRAW_DB_NAME = '_apps'
const DRAW_DB_VERSION = 1
const DRAW_META_STORE = 'draw_meta'
const DRAW_ENTRY_STORE = 'draw_entries'
const DRAW_META_KEY = 'current'

type State = {
  color: string
  brushSize: number
  copied: boolean
  recentColors: string[]
  showHandles: boolean
  canvasW: number
  canvasH: number
}

type PersistedDrawMeta = {
  key: typeof DRAW_META_KEY
  v: 1
  ids: Array<number | null>
  index: number
  state: Pick<State, 'color' | 'brushSize' | 'recentColors' | 'canvasW' | 'canvasH'>
  updatedAt: number
}

type PersistedDrawEntry = {
  id?: number
  v: 1
  blob: Blob
  w: number
  h: number
  createdAt: number
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

function clampCanvasW(w: number) {
  return Math.round(Math.max(200, Math.min(1240, w)) / 10) * 10
}

function clampCanvasH(h: number) {
  return Math.round(Math.max(200, Math.min(2000, h)) / 10) * 10
}

function openDrawDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB not available'))
      return
    }
    const req = indexedDB.open(DRAW_DB_NAME, DRAW_DB_VERSION)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains(DRAW_META_STORE)) {
        db.createObjectStore(DRAW_META_STORE, { keyPath: 'key' })
      }
      if (!db.objectStoreNames.contains(DRAW_ENTRY_STORE)) {
        db.createObjectStore(DRAW_ENTRY_STORE, { keyPath: 'id', autoIncrement: true })
      }
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error ?? new Error('Failed to open IndexedDB'))
  })
}

function idbGet<T>(db: IDBDatabase, storeName: string, key: IDBValidKey): Promise<T | undefined> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readonly')
    const store = tx.objectStore(storeName)
    const req = store.get(key)
    req.onsuccess = () => resolve(req.result as T | undefined)
    req.onerror = () => reject(req.error ?? new Error('IndexedDB get failed'))
  })
}

function idbGetMany<T>(db: IDBDatabase, storeName: string, keys: IDBValidKey[]): Promise<(T | undefined)[]> {
  return Promise.all(keys.map(k => idbGet<T>(db, storeName, k)))
}

function idbPut<T>(db: IDBDatabase, storeName: string, value: T): Promise<IDBValidKey> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readwrite')
    const store = tx.objectStore(storeName)
    const req = store.put(value as any)
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error ?? new Error('IndexedDB put failed'))
  })
}

function idbAdd<T>(db: IDBDatabase, storeName: string, value: T): Promise<number> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readwrite')
    const store = tx.objectStore(storeName)
    const req = store.add(value as any)
    req.onsuccess = () => resolve(req.result as number)
    req.onerror = () => reject(req.error ?? new Error('IndexedDB add failed'))
  })
}

function idbDelete(db: IDBDatabase, storeName: string, key: IDBValidKey): Promise<void> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readwrite')
    const store = tx.objectStore(storeName)
    const req = store.delete(key)
    req.onsuccess = () => resolve()
    req.onerror = () => reject(req.error ?? new Error('IndexedDB delete failed'))
  })
}

async function blobToImageData(blob: Blob, w: number, h: number): Promise<ImageData> {
  const bitmap = await createImageBitmap(blob)
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('2D context unavailable')
  ctx.drawImage(bitmap, 0, 0, w, h)
  bitmap.close()
  return ctx.getImageData(0, 0, w, h)
}

export default function DrawApp() {
  const dbRef = useRef<IDBDatabase | null>(null)
  const historyIdsRef = useRef<Array<number | null>>([])
  const metaPersistTimerRef = useRef<number | null>(null)

  const [state, dispatch] = useReducer(reducer, initial)
  const { setContent, setIsOpen } = useAbout()

  useEffect(() => {
    let cancelled = false
    openDrawDb()
      .then(async (db) => {
        if (cancelled) return
        dbRef.current = db
        const meta = await idbGet<PersistedDrawMeta>(db, DRAW_META_STORE, DRAW_META_KEY)
        if (cancelled) return
        if (!meta || meta.v !== 1) return

        const ids = Array.isArray(meta.ids) ? meta.ids : []
        const numericIds = ids.filter((id): id is number => typeof id === 'number')
        const entries = await idbGetMany<PersistedDrawEntry>(db, DRAW_ENTRY_STORE, numericIds)
        if (cancelled) return

        const entryById = new Map<number, PersistedDrawEntry>()
        numericIds.forEach((id, i) => {
          const e = entries[i]
          if (e && e.v === 1 && e.blob instanceof Blob) entryById.set(id, e)
        })

        const hydratedEntries: HistoryEntry[] = ids.map((id) => {
          if (typeof id !== 'number') return { data: null, blob: null, w: meta.state.canvasW, h: meta.state.canvasH }
          const e = entryById.get(id)
          if (!e) return { data: null, blob: null, w: meta.state.canvasW, h: meta.state.canvasH }
          return { data: null, blob: e.blob, w: e.w, h: e.h }
        })

        const usable = hydratedEntries.filter(e => e.blob)
        if (usable.length === 0) return

        historyRef.current = hydratedEntries
        historyIdsRef.current = ids
        historyIndexRef.current = Math.max(0, Math.min(meta.index ?? 0, hydratedEntries.length - 1))

        dispatch({ type: 'SET_COLOR', color: meta.state.color })
        dispatch({ type: 'SET_BRUSH_SIZE', size: meta.state.brushSize })
        dispatch({ type: 'SET_CANVAS_W', w: clampCanvasW(meta.state.canvasW) })
        dispatch({ type: 'SET_CANVAS_H', h: clampCanvasH(meta.state.canvasH) })
        if (meta.state.recentColors?.[0]) {
          dispatch({ type: 'ADD_RECENT_COLOR', color: meta.state.recentColors[0] })
        }

        const current = hydratedEntries[historyIndexRef.current]
        if (!current?.blob) return

        const imgData = await blobToImageData(current.blob, current.w, current.h)
        if (cancelled) return
        current.data = imgData
        actualDimsRef.current = { w: current.w, h: current.h }
        pendingRestoreRef.current = imgData
        dispatch({ type: 'SET_CANVAS_W', w: current.w })
        dispatch({ type: 'SET_CANVAS_H', h: current.h })
        setCommitCount(c => c + 1)
      })
      .catch(() => {})

    return () => { cancelled = true }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

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
  const undoRedoInFlightRef = useRef(false)
  // actualDims tracks the canvas element's real pixel dimensions — only updated on commit
  // so live drag previews (canvasW/H state changes) don't reset the canvas.
  const actualDimsRef = useRef({ w: state.canvasW, h: state.canvasH })
  const [commitCount, setCommitCount] = useState(0)
  const [isResizing, setIsResizing] = useState(false)
  const resizeDragRef = useRef<{ startX: number; startY: number; startW: number; startH: number; displayW: number; displayH: number; dxSign: number; dySign: number; anchorX: number; anchorY: number } | null>(null)
  const resizeAnchorRef = useRef({ x: 0, y: 0 })
  const stateRef = useRef(state)
  stateRef.current = state

  const schedulePersistMetaToIdb = useCallback(() => {
    if (typeof window === 'undefined') return
    if (metaPersistTimerRef.current !== null) window.clearTimeout(metaPersistTimerRef.current)
    metaPersistTimerRef.current = window.setTimeout(() => {
      metaPersistTimerRef.current = null
      const db = dbRef.current
      if (!db) return
      const meta: PersistedDrawMeta = {
        key: DRAW_META_KEY,
        v: 1,
        ids: historyIdsRef.current,
        index: historyIndexRef.current,
        state: {
          color: stateRef.current.color,
          brushSize: stateRef.current.brushSize,
          recentColors: stateRef.current.recentColors,
          canvasW: actualDimsRef.current.w,
          canvasH: actualDimsRef.current.h,
        },
        updatedAt: Date.now(),
      }
      void idbPut(db, DRAW_META_STORE, meta)
    }, 200)
  }, [])

  const persistHistorySlotToIdb = useCallback((slot: number, w: number, h: number) => {
    const canvas = canvasRef.current
    const db = dbRef.current
    if (!canvas || !db) return
    canvas.toBlob((blob) => {
      if (!blob) return
      const entry: PersistedDrawEntry = { v: 1, blob, w, h, createdAt: Date.now() }
      void idbAdd(db, DRAW_ENTRY_STORE, entry).then((id) => {
        if (slot < 0 || slot >= historyIdsRef.current.length) return
        const prev = historyIdsRef.current[slot]
        historyIdsRef.current[slot] = id
        if (typeof prev === 'number') void idbDelete(db, DRAW_ENTRY_STORE, prev)
        schedulePersistMetaToIdb()
      }).catch(() => {})
    }, 'image/png')
  }, [schedulePersistMetaToIdb])

  const pushHistory = useCallback((entry: HistoryEntry) => {
    const keepTo = historyIndexRef.current + 1
    const removedRedoIds = historyIdsRef.current.slice(keepTo).filter((id): id is number => typeof id === 'number')
    const newHistory = historyRef.current.slice(0, keepTo)
    const newIds = historyIdsRef.current.slice(0, keepTo)
    newHistory.push(entry)
    newIds.push(null)
    if (newHistory.length > MAX_HISTORY) newHistory.shift()
    if (newIds.length > MAX_HISTORY) {
      const dropped = newIds.shift()
      if (typeof dropped === 'number' && dbRef.current) void idbDelete(dbRef.current, DRAW_ENTRY_STORE, dropped)
    }
    historyRef.current = newHistory
    historyIndexRef.current = newHistory.length - 1
    historyIdsRef.current = newIds
    if (removedRedoIds.length > 0 && dbRef.current) {
      removedRedoIds.forEach((id) => void idbDelete(dbRef.current!, DRAW_ENTRY_STORE, id))
    }
    schedulePersistMetaToIdb()
  }, [schedulePersistMetaToIdb])

  const saveHistory = useCallback(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    pushHistory({ data: ctx.getImageData(0, 0, canvas.width, canvas.height), blob: null, w: canvas.width, h: canvas.height })
    persistHistorySlotToIdb(historyIndexRef.current, canvas.width, canvas.height)
  }, [persistHistorySlotToIdb, pushHistory])

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
        pushHistory({ data: ctx.getImageData(0, 0, newW, newH), blob: null, w: newW, h: newH })
        pendingResizeRef.current = null
        persistHistorySlotToIdb(historyIndexRef.current, newW, newH)
      }
      if (img.complete) apply()
      else img.onload = apply
    } else {
      historyRef.current = [{ data: ctx.getImageData(0, 0, canvas.width, canvas.height), blob: null, w: canvas.width, h: canvas.height }]
      historyIndexRef.current = 0
      historyIdsRef.current = [null]
      persistHistorySlotToIdb(0, canvas.width, canvas.height)
    }
  }, [commitCount]) // eslint-disable-line react-hooks/exhaustive-deps

  const commitResize = (w: number, h: number, anchorX = 0, anchorY = 0) => {
    const cw = clampCanvasW(w)
    const ch = clampCanvasH(h)
    if (cw === actualDimsRef.current.w && ch === actualDimsRef.current.h) return
    const canvas = canvasRef.current
    if (!canvas) return
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
    if (!isDrawing.current) return
    isDrawing.current = false
    lastPos.current = null
    // Capture post-stroke state (one snapshot per stroke).
    saveHistory()
  }

  const restoreHistoryEntry = useCallback(async (entry: HistoryEntry) => {
    const canvas = canvasRef.current
    if (!canvas) return
    let data = entry.data
    if (!data && entry.blob) {
      try {
        data = await blobToImageData(entry.blob, entry.w, entry.h)
        entry.data = data
      } catch {
        return
      }
    }
    if (!data) return
    if (entry.w !== actualDimsRef.current.w || entry.h !== actualDimsRef.current.h) {
      // Dimensions differ: route through commitCount effect so putImageData runs
      // after React has set the canvas width/height attributes (which clears the canvas).
      actualDimsRef.current = { w: entry.w, h: entry.h }
      pendingRestoreRef.current = data
      dispatch({ type: 'SET_CANVAS_W', w: entry.w })
      dispatch({ type: 'SET_CANVAS_H', h: entry.h })
      setCommitCount(c => c + 1)
    } else {
      const ctx = canvas.getContext('2d')
      if (!ctx) return
      ctx.putImageData(data, 0, 0)
    }
  }, [])

  const undo = useCallback(async () => {
    if (undoRedoInFlightRef.current) return
    if (historyIndexRef.current <= 0) return
    undoRedoInFlightRef.current = true
    historyIndexRef.current--
    try {
      await restoreHistoryEntry(historyRef.current[historyIndexRef.current])
      schedulePersistMetaToIdb()
    } finally {
      undoRedoInFlightRef.current = false
    }
  }, [restoreHistoryEntry, schedulePersistMetaToIdb])

  const redo = useCallback(async () => {
    if (undoRedoInFlightRef.current) return
    if (historyIndexRef.current >= historyRef.current.length - 1) return
    undoRedoInFlightRef.current = true
    historyIndexRef.current++
    try {
      await restoreHistoryEntry(historyRef.current[historyIndexRef.current])
      schedulePersistMetaToIdb()
    } finally {
      undoRedoInFlightRef.current = false
    }
  }, [restoreHistoryEntry, schedulePersistMetaToIdb])

  const clear = () => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.globalCompositeOperation = 'source-over'
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, canvas.width, canvas.height)
    // Capture post-clear state (one snapshot per clear).
    saveHistory()
  }

  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.repeat) return
      const meta = e.metaKey || e.ctrlKey
      if (!meta) return
      if (e.key === 'z' && !e.shiftKey) { e.preventDefault(); void undo() }
      if (e.key === 'z' && e.shiftKey) { e.preventDefault(); void redo() }
      if (e.key === 'y') { e.preventDefault(); void redo() }
    }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [undo, redo])

  const download = (format: 'png' | 'jpeg' | 'webp') => {
    downloadCanvas(canvasRef.current!, format, 'drawing')
  }

  const showCopiedStatus = () => {
    dispatch({ type: 'SET_COPIED', copied: true })
    if (copiedTimerRef.current) clearTimeout(copiedTimerRef.current)
    copiedTimerRef.current = setTimeout(() => {
      dispatch({ type: 'SET_COPIED', copied: false })
    }, 1200)
  }

  const copyPng = async () => {
    const canvas = canvasRef.current
    if (!canvas) return
    try {
      if (!navigator.clipboard?.write || typeof ClipboardItem === 'undefined') {
        download('png')
        return
      }
      // Keep Blob creation inside ClipboardItem so touch user activation is preserved.
      const png = new ClipboardItem({
        'image/png': new Promise<Blob>((resolve, reject) => {
          canvas.toBlob((blob) => {
            if (blob) resolve(blob)
            else reject(new Error('Failed to export PNG'))
          }, 'image/png')
        }),
      })
      await navigator.clipboard.write([png])
      showCopiedStatus()
    } catch {
      // Touch browsers may block image clipboard writes; fall back to file download.
      download('png')
    }
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
