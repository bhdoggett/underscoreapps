import { useState } from 'react'
import BackLink from '../../components/BackLink'
import AppHeader from '../../components/AppHeader'
import styles from './LocationApp.module.css'

type Status = 'idle' | 'loading' | 'success' | 'error'

const ERROR_MESSAGES: Record<number, string> = {
  [GeolocationPositionError.PERMISSION_DENIED]: 'permission denied',
  [GeolocationPositionError.POSITION_UNAVAILABLE]: 'position unavailable',
  [GeolocationPositionError.TIMEOUT]: 'request timed out',
}

export default function LocationApp() {
  const [status, setStatus] = useState<Status>('idle')
  const [coords, setCoords] = useState<{ lat: number; lon: number } | null>(null)
  const [errorMsg, setErrorMsg] = useState<string>('')

  function getLocation() {
    setStatus('loading')
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setCoords({ lat: pos.coords.latitude, lon: pos.coords.longitude })
        setStatus('success')
      },
      (err) => {
        setErrorMsg(ERROR_MESSAGES[err.code] ?? 'unknown error')
        setStatus('error')
      }
    )
  }

  return (
    <div className={styles.app}>
      <BackLink />
      <AppHeader title="location" />

      {status === 'success' && coords ? (
        <div className={styles.coords}>
          <div className={styles.coordRow}>
            <span className={styles.label}>latitude</span>
            <span className={styles.value}>{coords.lat.toFixed(6)}</span>
          </div>
          <div className={styles.coordRow}>
            <span className={styles.label}>longitude</span>
            <span className={styles.value}>{coords.lon.toFixed(6)}</span>
          </div>
        </div>
      ) : status === 'error' ? (
        <p className={styles.errorMsg}>{errorMsg}</p>
      ) : status === 'loading' ? (
        <p className={styles.statusMsg}>locating…</p>
      ) : null}

      {status !== 'loading' && (
        <div className={styles.btnRow}>
          <button className={styles.btn} onClick={getLocation}>
            {status === 'success' ? 'refresh' : 'get location'}
          </button>
        </div>
      )}
    </div>
  )
}
