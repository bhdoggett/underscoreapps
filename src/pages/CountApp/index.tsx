import { useEffect, useState } from 'react'
import AppHeader from '../../components/AppHeader'
import styles from './CountApp.module.css'

const STORAGE_KEY = 'benapps.count.v1'

function readInitialCount(): number {
  if (typeof window === 'undefined') return 0
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return 0
    const parsed = JSON.parse(raw) as { v: 1; count: number }
    if (!parsed || parsed.v !== 1) return 0
    if (typeof parsed.count !== 'number' || !Number.isFinite(parsed.count)) return 0
    return Math.max(0, Math.floor(parsed.count))
  } catch {
    return 0
  }
}

export default function CountApp() {
  const [count, setCount] = useState(readInitialCount)

  useEffect(() => {
    if (typeof window === 'undefined') return
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ v: 1, count }))
    } catch {
      // ignore storage failures (private mode, quota, etc)
    }
  }, [count])

  function clear() {
    setCount(0)
    if (typeof window === 'undefined') return
    try {
      window.localStorage.removeItem(STORAGE_KEY)
    } catch {
      // ignore
    }
  }

  return (
    <div className={styles.app}>
      <AppHeader
        title="count"
        about={<>
          <p>A single incrementing counter. Resets when you clear it.</p>
          <ul>
            <li>Tap + or − to increment or decrement</li>
            <li>Drag the number up or down to change it quickly</li>
            <li>Hold the clear button to reset to zero</li>
          </ul>
        </>}
      />
      <div className={styles.countRow}>
        <button className={styles.adjBtn} onClick={() => setCount(c => Math.max(0, c - 1))}>−</button>
        <div className={styles.display}>{count}</div>
        <button className={styles.adjBtn} onClick={() => setCount(c => c + 1)}>+</button>
      </div>
      <div className={styles.btnRowClear}>
        <button className={[styles.btn, styles.btnClear].join(' ')} onClick={clear}>clear</button>
      </div>
    </div>
  )
}
