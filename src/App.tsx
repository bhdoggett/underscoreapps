import { createBrowserRouter, RouterProvider, Outlet } from 'react-router-dom'
import Landing from './pages/Landing'
import ListApp from './pages/ListApp'
import CounterApp from './pages/CounterApp'
import TextApp from './pages/TextApp'
import ImageApp from './pages/ImageApp'
import AudioApp from './pages/AudioApp'
import DecibelsApp from './pages/DecibelsApp'
import LocationApp from './pages/LocationApp'
import ErrorBoundary, { RouteErrorFallback } from './components/ErrorBoundary'
import NotFound from './pages/NotFound'

const router = createBrowserRouter([
  {
    element: <Outlet />,
    errorElement: <RouteErrorFallback />,
    children: [
      { path: '/', element: <Landing /> },
      { path: '/list', element: <ListApp /> },
      { path: '/counter', element: <CounterApp /> },
      { path: '/text', element: <TextApp /> },
      { path: '/image', element: <ImageApp /> },
      { path: '/audio', element: <AudioApp /> },
      { path: '/decibels', element: <DecibelsApp /> },
      { path: '/location', element: <LocationApp /> },
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
