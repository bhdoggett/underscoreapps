import { createBrowserRouter, RouterProvider, Outlet } from 'react-router-dom'
import Landing from './pages/Landing'
import ListApp from './pages/ListApp'
import CountApp from './pages/CountApp'
import TextApp from './pages/TextApp'
import ImageApp from './pages/ImageApp'
import AudioApp from './pages/AudioApp'
import DecibelsApp from './pages/DecibelsApp'
import LocationApp from './pages/LocationApp'
import TimerApp from './pages/TimerApp'
import TunerApp from './pages/TunerApp'
import MetronomeApp from './pages/MetronomeApp'
import ErrorBoundary, { RouteErrorFallback } from './components/ErrorBoundary'
import NotFound from './pages/NotFound'
import ThemeToggle from './components/ThemeToggle'

function Layout() {
  return (
    <>
      <ThemeToggle />
      <Outlet />
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
      { path: '/decibels', element: <DecibelsApp /> },
      { path: '/location', element: <LocationApp /> },
      { path: '/timer', element: <TimerApp /> },
      { path: '/tuner', element: <TunerApp /> },
      { path: '/metronome', element: <MetronomeApp /> },
      { path: '*', element: <NotFound /> },
    ],
  },
])

export default function App() {
  return (
    <ErrorBoundary>
      <RouterProvider router={router} />
    </ErrorBoundary>
  )
}
