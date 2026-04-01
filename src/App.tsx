import { useEffect, useRef } from 'react'
import { createBrowserRouter, RouterProvider, Outlet, useLocation } from 'react-router-dom'
import Landing from './pages/Landing'
import ListApp from './pages/ListApp'
import CountApp from './pages/CountApp'
import TextApp from './pages/TextApp'
import ImageApp from './pages/ImageApp'
import AudioApp from './pages/AudioApp'
import AudioPlusApp from './pages/AudioPlusApp'
import DecibelsApp from './pages/DecibelsApp'
import LocationApp from './pages/LocationApp'
import TimerApp from './pages/TimerApp'
import TunerApp from './pages/TunerApp'
import MetronomeApp from './pages/MetronomeApp'
import ColorApp from './pages/ColorApp'
import DiceApp from './pages/DiceApp'
import GolfApp from './pages/GolfApp'
import DartsApp from './pages/DartsApp'
import DrawApp from './pages/DrawApp'
import PianoApp from './pages/PianoApp'
import ErrorBoundary, { RouteErrorFallback } from './components/ErrorBoundary'
import NotFound from './pages/NotFound'
import ThemeToggle from './components/ThemeToggle'
import BackLink from './components/BackLink'
import AboutPanel from './components/AboutPanel'
import { AboutProvider, useAbout } from './contexts/AboutContext'
import styles from './App.module.css'

const TIMER_STORAGE_KEY = '_apps.timer.v1'

type TimerMode = 'idle' | 'running' | 'paused' | 'done'
type TimerType = 'countdown' | 'stopwatch'

type TimerState = {
  mode: TimerMode
  type: TimerType
  totalMs: number
  startedAt: number
  accumulatedMs: number
}

type PersistedTimer = {
  v: 1
  timer: TimerState
  laps: number[]
  doneNotifiedAt: number | null
}

function readPersistedTimer(): PersistedTimer | null {
  if (typeof window === 'undefined') return null
  try {
    const raw = window.localStorage.getItem(TIMER_STORAGE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as PersistedTimer
    if (!parsed || parsed.v !== 1) return null
    if (!parsed.timer || typeof parsed.timer.mode !== 'string') return null
    return parsed
  } catch {
    return null
  }
}

function writePersistedTimer(next: PersistedTimer) {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(TIMER_STORAGE_KEY, JSON.stringify(next))
  } catch {
    // ignore storage failures
  }
}

function Layout() {
  const { pathname } = useLocation()
  const { content, isOpen, setIsOpen } = useAbout()
  const triggerRef = useRef<HTMLButtonElement>(null)
  const timeoutRef = useRef<number | null>(null)
  const scheduledEndAtRef = useRef<number | null>(null)

  useEffect(() => { window.scrollTo(0, 0) }, [pathname])

  useEffect(() => {
    if (typeof window === 'undefined') return

    function clearSchedule() {
      if (timeoutRef.current !== null) {
        window.clearTimeout(timeoutRef.current)
        timeoutRef.current = null
      }
      scheduledEndAtRef.current = null
    }

    if (pathname === '/timer') {
      clearSchedule()
      return
    }

    const pollId = window.setInterval(() => {
      const persisted = readPersistedTimer()
      const t = persisted?.timer

      if (!persisted || !t || t.type !== 'countdown' || t.mode !== 'running') {
        clearSchedule()
        return
      }

      const endAt = t.startedAt + t.totalMs
      if (!Number.isFinite(endAt) || endAt <= 0) {
        clearSchedule()
        return
      }

      const remainingMs = endAt - Date.now()
      if (remainingMs <= 0) {
        // Timer finished while we were away; mark done and notify once.
        if (!persisted.doneNotifiedAt) {
          const next: PersistedTimer = {
            ...persisted,
            timer: { ...t, mode: 'done', accumulatedMs: t.totalMs },
            doneNotifiedAt: Date.now(),
          }
          writePersistedTimer(next)
          if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
            new Notification('timer done')
          }
        }
        clearSchedule()
        return
      }

      if (scheduledEndAtRef.current === endAt && timeoutRef.current !== null) return

      clearSchedule()
      scheduledEndAtRef.current = endAt
      timeoutRef.current = window.setTimeout(() => {
        const latest = readPersistedTimer()
        const latestTimer = latest?.timer
        if (!latest || !latestTimer || latestTimer.type !== 'countdown' || latestTimer.mode !== 'running') {
          clearSchedule()
          return
        }

        const latestEndAt = latestTimer.startedAt + latestTimer.totalMs
        if (latestEndAt !== endAt) {
          clearSchedule()
          return
        }

        if (!latest.doneNotifiedAt) {
          const next: PersistedTimer = {
            ...latest,
            timer: { ...latestTimer, mode: 'done', accumulatedMs: latestTimer.totalMs },
            doneNotifiedAt: Date.now(),
          }
          writePersistedTimer(next)
          if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
            new Notification('timer done')
          }
        }
        clearSchedule()
      }, Math.min(remainingMs + 20, 2_147_000_000))
    }, 1000)

    return () => {
      window.clearInterval(pollId)
      clearSchedule()
    }
  }, [pathname])

  return (
    <>
      <div className={styles.topBar}>
        {pathname !== '/' ? <BackLink /> : <span />}
        <div className={styles.topRight}>
          <ThemeToggle />
          {content && (
            <button
              ref={triggerRef}
              className={styles.aboutBtn}
              onClick={() => setIsOpen(!isOpen)}
              aria-label={isOpen ? 'Close' : 'About this app'}
              aria-expanded={isOpen}
            >
              {isOpen ? '×' : '?'}
            </button>
          )}
        </div>
      </div>
      <Outlet />
      {content && isOpen && (
        <AboutPanel onClose={() => setIsOpen(false)} triggerRef={triggerRef}>
          {content}
        </AboutPanel>
      )}
    </>
  )
}

const router = createBrowserRouter([
  {
    element: <Layout />,
    errorElement: <RouteErrorFallback />,
    children: [
      { path: '/', element: <Landing /> },
      { path: '/list', element: <ListApp /> },
      { path: '/count', element: <CountApp /> },
      { path: '/text', element: <TextApp /> },
      { path: '/image', element: <ImageApp /> },
      { path: '/audio', element: <AudioApp /> },
      { path: '/audioplus', element: <AudioPlusApp /> },
      { path: '/decibels', element: <DecibelsApp /> },
      { path: '/location', element: <LocationApp /> },
      { path: '/timer', element: <TimerApp /> },
      { path: '/tuner', element: <TunerApp /> },
      { path: '/metronome', element: <MetronomeApp /> },
      { path: '/color', element: <ColorApp /> },
      { path: '/dice', element: <DiceApp /> },
      { path: '/golf', element: <GolfApp /> },
      { path: '/darts', element: <DartsApp /> },
      { path: '/draw', element: <DrawApp /> },
      { path: '/piano', element: <PianoApp /> },
      { path: '*', element: <NotFound /> },
    ],
  },
])

export default function App() {
  return (
    <ErrorBoundary>
      <AboutProvider>
        <RouterProvider router={router} />
      </AboutProvider>
    </ErrorBoundary>
  )
}
