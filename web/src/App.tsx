import { Routes, Route, Navigate, useLocation } from 'react-router-dom'
import Layout from './components/Layout'
import Dashboard from './pages/Dashboard'
import Library from './pages/Library'
import LibraryView from './pages/LibraryView'
import ShowView from './pages/ShowView'
import Settings from './pages/Settings'
import Channels from './pages/Channels'
import ChannelEditor from './pages/ChannelEditor'
import Studio from './pages/Studio'
import Logs from './pages/Logs'

/**
 * Rewrite the leading segment of the current path and redirect there, keeping
 * everything after it (ids, sub-paths, hash) intact — so /browse/3/show/Foo
 * lands on /library/3/show/Foo rather than dumping the user at the top.
 */
function LegacyRedirect({ from, to }: { from: string; to: string }) {
  const { pathname, search, hash } = useLocation()
  return <Navigate to={pathname.replace(from, to) + search + hash} replace />
}

export default function App() {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<Dashboard />} />

        <Route path="channels" element={<Channels />} />
        <Route path="channels/:id" element={<ChannelEditor />} />

        <Route path="library" element={<Library />} />
        <Route path="library/:libraryId" element={<LibraryView />} />
        <Route path="library/:libraryId/show/:show" element={<ShowView />} />

        <Route path="studio" element={<Studio />} />
        <Route path="logs" element={<Logs />} />
        <Route path="settings" element={<Settings />} />

        {/* Old routes, kept working. Browse and Libraries merged into Library;
            Media became Studio and absorbed the standalone Logos page;
            collections moved inside a channel back in Phase 2. */}
        <Route path="browse/*" element={<LegacyRedirect from="/browse" to="/library" />} />
        <Route path="libraries" element={<Navigate to="/library#sources" replace />} />
        <Route path="media" element={<LegacyRedirect from="/media" to="/studio" />} />
        <Route path="logos" element={<Navigate to="/studio#images" replace />} />
        <Route path="collections/*" element={<Navigate to="/channels" replace />} />

        {/* Anything else is a typo or a link from a much older version. */}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  )
}
