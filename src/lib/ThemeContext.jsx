import { createContext, useContext, useState, useEffect, useCallback } from 'react'

const ThemeContext = createContext()

// Floodlight (2026-10-31): three appearance modes — light, dark, or follow the device —
// like the apps (הדף שלי → תצוגה). Stored under the same key as before ('hockey-theme'):
// old saved values 'light' / 'dark' keep working; 'system' (or nothing saved) follows the
// device and keeps following it live. index.html applies the class before paint.
const KEY = 'hockey-theme'

function readMode() {
  try {
    const v = localStorage.getItem(KEY)
    return v === 'light' || v === 'dark' ? v : 'system'
  } catch { return 'system' }
}

const systemDark = () => typeof window !== 'undefined' && window.matchMedia('(prefers-color-scheme: dark)').matches

export function ThemeProvider({ children }) {
  const [mode, setModeState] = useState(readMode)
  const [sysDark, setSysDark] = useState(systemDark)
  const dark = mode === 'dark' || (mode === 'system' && sysDark)

  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    const on = (e) => setSysDark(e.matches)
    mq.addEventListener?.('change', on)
    return () => mq.removeEventListener?.('change', on)
  }, [])

  useEffect(() => {
    document.documentElement.classList.toggle('dark', dark)
  }, [dark])

  /** The user's pick. Cross-fades the whole page over 350 ms where the browser can
   *  (View Transitions); a system flip or reduced motion switches instantly. */
  const setMode = useCallback((next) => {
    try { if (next === 'system') localStorage.removeItem(KEY); else localStorage.setItem(KEY, next) } catch { /* private mode */ }
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    if (!reduce && document.startViewTransition) {
      document.documentElement.classList.add('fl-theme-xfade')
      const t = document.startViewTransition(() => setModeState(next))
      t.finished.finally(() => document.documentElement.classList.remove('fl-theme-xfade'))
    } else {
      setModeState(next)
    }
  }, [])

  const toggle = useCallback(() => setMode(dark ? 'light' : 'dark'), [dark, setMode])

  return (
    <ThemeContext.Provider value={{ dark, toggle, mode, setMode }}>
      {children}
    </ThemeContext.Provider>
  )
}

export const useTheme = () => useContext(ThemeContext)
