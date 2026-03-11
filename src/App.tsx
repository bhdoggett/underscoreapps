import { createBrowserRouter, RouterProvider } from 'react-router-dom'
import Landing from './pages/Landing'
import ListApp from './pages/ListApp'
import CounterApp from './pages/CounterApp'
import TextApp from './pages/TextApp'
import ConvertImageApp from './pages/ConvertImageApp'
import ConvertAudioApp from './pages/ConvertAudioApp'

const router = createBrowserRouter([
  { path: '/', element: <Landing /> },
  { path: '/list', element: <ListApp /> },
  { path: '/counter', element: <CounterApp /> },
  { path: '/text', element: <TextApp /> },
  { path: '/convert-image', element: <ConvertImageApp /> },
  { path: '/convert-audio', element: <ConvertAudioApp /> },
])

export default function App() {
  return <RouterProvider router={router} />
}
