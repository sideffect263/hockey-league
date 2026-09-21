import { BrowserRouter as Router, Route, Routes, Navigate, useLocation, useNavigationType } from 'react-router-dom'
import { useState, useEffect, createContext, useContext, lazy, Suspense } from 'react'
import Layout from './Layout'
import RouteSeo from './components/RouteSeo'
import RouteSkeleton from './components/skeletons/RouteSkeleton'
import { getLeagueSetting, getCurrentSeason } from './lib/api'

// Route-level code splitting: each page ships as its own chunk, so the home
// page no longer downloads Admin / Judge / poster generator / etc. up front.
const Feed = lazy(() => import('./pages/Feed'))
const Home = lazy(() => import('./pages/Home'))
const Games = lazy(() => import('./pages/Games'))
const GameDetail = lazy(() => import('./pages/GameDetail'))
const GameTv = lazy(() => import('./pages/GameTv'))
const Notifications = lazy(() => import('./pages/Notifications'))
const Statistics = lazy(() => import('./pages/Statistics'))
const Teams = lazy(() => import('./pages/Teams'))
const TeamDetail = lazy(() => import('./pages/TeamDetail'))
const Players = lazy(() => import('./pages/Players'))
const PlayerDetail = lazy(() => import('./pages/PlayerDetail'))
const Tournaments = lazy(() => import('./pages/Tournaments'))
const TournamentDetail = lazy(() => import('./pages/TournamentDetail'))
const Judge = lazy(() => import('./pages/Judge'))
const JudgeGame = lazy(() => import('./pages/JudgeGame'))
const Admin = lazy(() => import('./pages/Admin'))
const StreamDebug = lazy(() => import('./pages/StreamDebug'))
const ArchivePage = lazy(() => import('./pages/Archive'))
const Media = lazy(() => import('./pages/Media'))
const ContentCreators = lazy(() => import('./pages/ContentCreators'))
const Market = lazy(() => import('./pages/Market'))
const MarketDetail = lazy(() => import('./pages/MarketDetail'))
const Profile = lazy(() => import('./pages/Profile'))
const ResetPassword = lazy(() => import('./pages/ResetPassword'))
const Privacy = lazy(() => import('./pages/Privacy'))
const MobileApp = lazy(() => import('./pages/MobileApp'))
const Features = lazy(() => import('./pages/Features'))
const NotFound = lazy(() => import('./pages/NotFound'))

const SeasonModeContext = createContext()
export const useSeasonMode = () => useContext(SeasonModeContext)

/**
 * The live season's name ("2026-27"), for the badges and page subtitles that
 * used to hardcode it. Every one of them said 2025-26 the morning after the
 * first rollover, on every page of the site.
 *
 * Returns '' if the lookup failed, never a stale guess — callers omit the
 * label rather than print a year that might be wrong. Nothing renders before
 * the fetch resolves (App gates on it), so there is no flash of an empty one.
 */
export const useSeasonName = () => useContext(SeasonModeContext)?.seasonName || ''

/**
 * A plain <a href> reload starts at the top; a client-side route change does not
 * — React swaps the page under a scroll offset the user never asked to keep, so
 * following a link from halfway down /guide dropped you halfway down /standings.
 * Reset to the top on every PUSH/REPLACE, and let the browser restore its own
 * position on POP (back/forward) instead of fighting it.
 *
 * A hash (/guide#coach) is always honoured, whatever the navigation type: the
 * browser can't do the fragment jump itself here, because on a cold load the
 * target is still inside a lazy route chunk — and React Router reports that
 * first load as POP, so gating the hash on the type skips exactly the case
 * that needs us. Keep looking for the element until a deadline, budgeted in
 * wall-clock time rather than frames; a slow chunk can take seconds, which a
 * frame count silently under-waits.
 *
 * Landing on it once isn't enough either: the browser restores its own scroll
 * position after the document settles and would undo a single jump, so hold the
 * target for a short window afterwards — releasing it the moment the user
 * scrolls, so we never fight them for it.
 *
 * The poll is a timer, deliberately NOT requestAnimationFrame: rAF is paused
 * outright in a background tab, so a shared #anchor link opened in one would
 * never resolve.
 */
const HASH_TARGET_TIMEOUT_MS = 8000
const HASH_SETTLE_MS = 700
const HASH_POLL_MS = 50

function ScrollToTop() {
  const { pathname, hash } = useLocation()
  const navType = useNavigationType()

  useEffect(() => {
    if (hash) {
      let timer, settleUntil = 0, released = false
      const id = decodeURIComponent(hash.slice(1))
      const deadline = performance.now() + HASH_TARGET_TIMEOUT_MS
      const release = () => { released = true }
      const events = ['wheel', 'touchstart', 'keydown']

      const jump = () => {
        if (released) return
        const now = performance.now()
        const el = document.getElementById(id)
        if (el) {
          el.scrollIntoView()
          if (!settleUntil) settleUntil = now + HASH_SETTLE_MS
          if (now >= settleUntil) return
        } else if (now >= deadline) {
          return
        }
        timer = setTimeout(jump, HASH_POLL_MS)
      }

      events.forEach(e => window.addEventListener(e, release, { passive: true }))
      jump()
      return () => {
        clearTimeout(timer)
        events.forEach(e => window.removeEventListener(e, release))
      }
    }

    if (navType === 'POP') return // back/forward: the browser restores the position

    window.scrollTo(0, 0)
  }, [pathname, hash, navType])

  return null
}

function App() {
  const [seasonMode, setSeasonMode] = useState(null) // 'regular' or 'final_four'
  const [seasonName, setSeasonName] = useState('')
  const [loading, setLoading] = useState(true)

  // Both reads in one round trip — the shell already waits on the mode, so the
  // name rides along for free rather than adding a second gate or letting the
  // labels pop in a beat late.
  useEffect(() => {
    Promise.all([
      getLeagueSetting('season_mode').then(v => v || 'regular').catch(() => 'regular'),
      getCurrentSeason().then(s => s?.name || '').catch(() => ''),
    ])
      .then(([mode, name]) => { setSeasonMode(mode); setSeasonName(name) })
      .finally(() => setLoading(false))
  }, [])

  // While the season settings are in flight the SHELL still renders — header,
  // nav, and the skeleton of whatever page the URL asks for — instead of the
  // old blank screen with a spinner in the middle of it. The routes themselves
  // stay gated: `useSeasonName` must never hand a page an empty season and have
  // it print "עונת " with nothing after it, which is exactly what this gate has
  // always been for.
  //
  // (Layout's own season badge lives inside the closed mobile menu, so it has no
  // way to be seen during the fetch.)
  return (
    <SeasonModeContext.Provider value={{ seasonMode, setSeasonMode, seasonName, setSeasonName }}>
      <Router future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <RouteSeo />
        <ScrollToTop />
        <Layout>
          {loading ? <RouteSkeleton /> : (
          <Suspense fallback={<RouteSkeleton />}>
          <Routes>
            <Route path="/" element={<Feed />} />
            <Route path="/standings" element={<Home />} />
            <Route path="/games" element={<Games />} />
            <Route path="/games/:id" element={<GameDetail />} />
            {/* Row 21 — fullscreen board for an HDMI-connected TV (fixed inset-0 covers the shell) */}
            <Route path="/games/:id/tv" element={<GameTv />} />
            <Route path="/notifications" element={<Notifications />} />
            <Route path="/statistics" element={<Statistics />} />
            <Route path="/teams" element={<Teams />} />
            <Route path="/teams/:id" element={<TeamDetail />} />
            <Route path="/players" element={<Players />} />
            <Route path="/players/:id" element={<PlayerDetail />} />
            {/* הוקי מרקט — play-money prediction market, 18+ league players only.
                Both routes re-skin the whole shell (see useMarketTheme). */}
            <Route path="/market" element={<Market />} />
            <Route path="/market/:id" element={<MarketDetail />} />
            <Route path="/me" element={<Profile />} />
            <Route path="/reset-password" element={<ResetPassword />} />
            <Route path="/privacy" element={<Privacy />} />
            <Route path="/app" element={<MobileApp />} />
            <Route path="/guide" element={<Features />} />
            <Route path="/media" element={<Media />} />
            <Route path="/creators" element={<ContentCreators />} />
            <Route path="/tournaments" element={<Tournaments />} />
            <Route path="/tournaments/:id" element={<TournamentDetail />} />
            <Route path="/judge" element={<Judge />} />
            <Route path="/judge/:id" element={<JudgeGame />} />
            <Route path="/admin" element={<Admin />} />
            {/* Admin-only WebRTC diagnostics — run it ON the device that can't watch */}
            <Route path="/stream-debug" element={<StreamDebug />} />
            <Route path="/archive" element={<ArchivePage />} />
            <Route path="/archive/:seasonId" element={<ArchivePage />} />
            <Route path="*" element={<NotFound />} />
          </Routes>
          </Suspense>
          )}
        </Layout>
      </Router>
    </SeasonModeContext.Provider>
  )
}

export default App
