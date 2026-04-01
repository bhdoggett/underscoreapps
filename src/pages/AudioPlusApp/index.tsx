import AppHeader from '../../components/AppHeader'
import styles from './AudioPlusApp.module.css'

export default function AudioPlusApp() {
  return (
    <div className={styles.app}>
      <AppHeader title="audio+" about={<p>Multitrack audio recorder.</p>} />
    </div>
  )
}
