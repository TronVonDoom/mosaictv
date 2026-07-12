import { Routes, Route } from 'react-router-dom'
import Layout from './components/Layout'
import Dashboard from './pages/Dashboard'
import Libraries from './pages/Libraries'
import Media from './pages/Media'

export default function App() {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<Dashboard />} />
        <Route path="libraries" element={<Libraries />} />
        <Route path="media" element={<Media />} />
      </Route>
    </Routes>
  )
}
