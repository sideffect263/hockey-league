import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.jsx'
import { ThemeProvider } from './lib/ThemeContext.jsx'
import { AuthProvider } from './lib/AuthContext.jsx'
import { initAnalytics } from './lib/analytics'
import { initTelemetry } from './lib/telemetry'
import { installStaleChunkReload } from './lib/staleChunkReload'
import ErrorBoundary from './components/ErrorBoundary.jsx'
import './index.css'

// Loads GA4 once, before render. No-op (zero network) unless VITE_GA4_ID is set.
initAnalytics()

// First-party telemetry. Installed BEFORE render so a crash in the very first paint
// is still reported — that is the failure mode users describe as "the app is white".
initTelemetry()

// A tab open across a deploy: reload once onto the new build instead of crashing.
installStaleChunkReload()

// Installed-app opening animation (index.html decides and paints the blue first). Its own
// root and its own chunk: a normal visit never downloads it.
if (window.__bootSplash) {
  const host = document.createElement('div')
  document.body.appendChild(host)
  const splashRoot = ReactDOM.createRoot(host)
  const cleanup = () => { splashRoot.unmount(); host.remove(); document.getElementById('boot-splash')?.remove() }
  import('./components/LaunchSplash.jsx')
    .then(({ default: LaunchSplash }) => splashRoot.render(
      <LaunchSplash reducedMotion={window.__bootSplash.reduced} onDone={cleanup} />))
    .catch(cleanup)
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <ErrorBoundary>
      <ThemeProvider>
        <AuthProvider>
          <App />
        </AuthProvider>
      </ThemeProvider>
    </ErrorBoundary>
  </React.StrictMode>,
)
