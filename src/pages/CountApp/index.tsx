import { useState } from 'react'
import AppHeader from '../../components/AppHeader'
import styles from './CountApp.module.css'

export default function CountApp() {
  const [count, setCount] = useState(0)

  return (
    <div className={styles.app}>
      <AppHeader title="count" />
      <div className={styles.countRow}>
        <button className={styles.adjBtn} onClick={() => setCount(c => Math.max(0, c - 1))}>−</button>
        <div className={styles.display}>{count}</div>
        <button className={styles.adjBtn} onClick={() => setCount(c => c + 1)}>+</button>
      </div>
      <div className={styles.btnRowClear}>
        <button className={[styles.btn, styles.btnClear].join(' ')} onClick={() => setCount(0)}>clear</button>
      </div>
    </div>
  )
}
