import { Link } from 'react-router-dom'
import styles from './Landing.module.css'

const apps = [
  // text & data
  { path: '/list', name: 'list' },
  { path: '/count', name: 'count' },
  { path: '/text', name: 'text' },
  // media
  { path: '/image', name: 'image' },
  { path: '/audio', name: 'audio' },
  { path: '/color', name: 'color' },
  // audio & music
  { path: '/decibels', name: 'decibels' },
  { path: '/tuner', name: 'tuner' },
  { path: '/metronome', name: 'metronome' },
  // tools & time
  { path: '/timer', name: 'timer' },
  { path: '/location', name: 'location' },
  { path: '/dice', name: 'dice' },
]

export default function Landing() {
  return (
    <div className={styles.body}>
      <div className={styles.inner}>
        <h1 className={styles.title}>ben<br />apps</h1>
        <div className={styles.rule} />
        <ul className={styles.appList}>
          {apps.map(app => (
            <li key={app.path}>
              <Link className={styles.appLink} to={app.path}>
                <span className={styles.appName}>{app.name}</span>
                <span className={styles.arrow}>→</span>
              </Link>
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
}
