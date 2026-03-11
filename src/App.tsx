import { createBrowserRouter, RouterProvider } from 'react-router-dom'
import Landing from './pages/Landing'
import ListApp from './pages/ListApp'
import CounterApp from './pages/CounterApp'
import TextApp from './pages/TextApp'
import ImageApp from './pages/ImageApp'
import AudioApp from './pages/AudioApp'

const router = createBrowserRouter([
  { path: '/', element: <Landing /> },
  { path: '/list', element: <ListApp /> },
  { path: '/counter', element: <CounterApp /> },
  { path: '/text', element: <TextApp /> },
  { path: '/image', element: <ImageApp /> },
  { path: '/audio', element: <AudioApp /> },
])

export default function App() {
  return <RouterProvider router={router} />
}
