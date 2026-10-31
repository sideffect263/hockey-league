/**
 * Floodlight shell pieces for phones: the bottom tab bar (המגרש · משחקים · + · טבלה ·
 * הקבוצה), the radial + fan, and the "עוד" sheet (כל הפעולות). The + is two crossed
 * sticks on the amber disc that turn into a crossed-sticks crest when open (iOS
 * StickPlusGlyph). Desktop keeps the header nav (Layout.jsx).
 */
import { useEffect, useRef, useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import * as BI from '@/components/icons/BrandIcons'
import { useAuth } from '@/lib/AuthContext'
import { useTheme } from '@/lib/ThemeContext'
import { tabs, fanItems, moreGroups, isActive } from './navModel'

const LINE = {
  rink: <><rect x="3" y="5" width="18" height="14" rx="3" /><line x1="12" y1="5" x2="12" y2="19" /><circle cx="12" cy="12" r="2.5" /></>,
  cal: <><rect x="4" y="5" width="16" height="15" rx="3" /><line x1="4" y1="10" x2="20" y2="10" /><line x1="8.5" y1="3" x2="8.5" y2="7" /><line x1="15.5" y1="3" x2="15.5" y2="7" /></>,
  table: <><line x1="4" y1="6" x2="20" y2="6" /><line x1="4" y1="12" x2="20" y2="12" /><line x1="4" y1="18" x2="14" y2="18" /></>,
  shield: <path d="M12 3l7 3v5c0 4.5-3 8-7 10c-4-2-7-5.5-7-10V6z" />,
  post: <path d="M4 20h4L19 9l-4-4L4 16z" />,
  more: <path d="M5 5h5v5H5zM14 5h5v5h-5zM5 14h5v5H5zM14 14h5v5h-5z" />,
  person: <><circle cx="12" cy="8" r="4" /><path d="M4 21c1-4 4-6 8-6s7 2 8 6" /></>,
  code: <path d="M8 7l-5 5 5 5M16 7l5 5-5 5" />,
  lock: <><rect x="5" y="11" width="14" height="10" rx="2" /><path d="M8 11V8a4 4 0 0 1 8 0v3" /></>,
  search: <><circle cx="11" cy="11" r="6.5" /><line x1="16" y1="16" x2="20" y2="20" /></>,
  close: <path d="M6 6l12 12M18 6L6 18" />,
}

export function LineIcon({ name, size = 24, stroke = 1.8, className = '' }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={stroke}
      strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className={className}>{LINE[name]}</svg>
  )
}

function ItemIcon({ item, size = 30 }) {
  const C = item.brand && BI[item.brand]
  if (C) return <C size={size} />
  return <LineIcon name={item.line || 'more'} size={Math.round(size * 0.8)} />
}

/** Two sticks laid as a "+" (blades bottom and right); open = turned 45° into a
 *  crossed-sticks crest. Same drawing as iOS StickPlusGlyph. */
function Stick({ d, grip, tape }) {
  return (
    <g fill="none" strokeLinecap="round" strokeLinejoin="round">
      <path d={d} stroke="#11161D" strokeWidth="4.6" />
      <path d={d} stroke="#E2C792" strokeWidth="2.8" />
      <path d={grip} stroke="#11161D" strokeWidth="3.2" />
      <path d={tape} stroke="#11161D" strokeWidth="0.9" />
    </g>
  )
}
function StickPlus({ open }) {
  return (
    <svg width="32" height="32" viewBox="0 0 32 32" aria-hidden="true"
      className="transition-transform duration-300 motion-reduce:transition-none" style={{ transform: open ? 'rotate(45deg)' : 'none' }}>
      <Stick d="M15 3.5V23.5q0 4-4 4H9.5" grip="M15 3.5v2.2" tape="M13.8 19.5l2.4-1M13.8 21.3l2.4-1" />
      <Stick d="M3.5 15H23.5q4 0 4-4V9.5" grip="M3.5 15h2.2" tape="M19.5 13.8l-1 2.4M21.3 13.8l-1 2.4" />
    </svg>
  )
}

export function FLTabBar() {
  const auth = useAuth()
  const { pathname } = useLocation()
  const [fanOpen, setFanOpen] = useState(false)
  const [moreOpen, setMoreOpen] = useState(false)
  const t = tabs(auth)

  useEffect(() => { setFanOpen(false); setMoreOpen(false) }, [pathname])

  // Re-tap on the current tab scrolls the page back to the top.
  const onTab = (e, url) => {
    if (isActive(pathname, url) && pathname === url.split(/[?#]/)[0]) {
      e.preventDefault()
      window.scrollTo({ top: 0, behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' })
    }
  }

  const tab = (it) => {
    const on = isActive(pathname, it.url, it.match)
    return (
      <Link key={it.key} to={it.url} onClick={(e) => onTab(e, it.url)} aria-current={on ? 'page' : undefined}
        className={`flex flex-col items-center justify-start gap-[3px] pt-2 min-h-[56px] text-[11px] ${on ? 'text-fg-strong font-bold' : 'text-fg-muted font-medium'}`}>
        <LineIcon name={it.icon} stroke={on ? 1.9 : 1.75} />
        {it.title}
        <span aria-hidden="true" className={`h-[3px] w-4 rounded-full transition-opacity duration-200 ${on ? 'bg-fl-accent opacity-100' : 'opacity-0'}`} />
      </Link>
    )
  }

  return (
    <>
      <nav aria-label="ניווט ראשי"
        className="lg:hidden fixed inset-x-0 bottom-0 z-40 bg-surface/95 backdrop-blur-lg border-t border-line-header"
        style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}>
        <div className="grid grid-cols-5 items-start max-w-xl mx-auto">
          {tab(t[0])}
          {tab(t[1])}
          <div className="flex justify-center pt-1.5">
            <button type="button" onClick={() => setFanOpen((o) => !o)} aria-expanded={fanOpen} aria-label="פעולות"
              className="relative z-[61] size-[52px] rounded-full bg-fl-accent ring-[3px] ring-white dark:ring-[#151B23] shadow-[0_6px_18px_rgba(0,0,0,.25)] flex items-center justify-center">
              <StickPlus open={fanOpen} />
            </button>
          </div>
          {tab(t[2])}
          {tab(t[3])}
        </div>
      </nav>
      {fanOpen && <PlusFan auth={auth} onClose={() => setFanOpen(false)} onMore={() => { setFanOpen(false); setMoreOpen(true) }} />}
      {moreOpen && <MoreSheet auth={auth} onClose={() => setMoreOpen(false)} />}
    </>
  )
}

/** The radial fan: round bubbles in an arc above the +, a night backdrop behind. */
function PlusFan({ auth, onClose, onMore }) {
  const items = [...fanItems(auth), { title: 'עוד', action: 'more', line: 'more', tone: 'light' }]
  const navigate = useNavigate()
  const first = useRef(null)
  useEffect(() => {
    first.current?.focus()
    const k = (e) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', k)
    return () => document.removeEventListener('keydown', k)
  }, [onClose])

  const n = items.length
  // Arc from 15° (right) to 165° (left): the first, most urgent item is on the RTL start.
  // Lifted above the bar; narrow enough for a 360px phone.
  const R = n > 5 ? 128 : 118
  const pos = items.map((_, i) => {
    const a = (Math.PI / 180) * (15 + (150 * i) / Math.max(1, n - 1))
    return { x: Math.cos(a) * R * 1.05, y: -Math.sin(a) * R - 52 }
  })

  const act = (it) => {
    if (it.action === 'more') return onMore()
    if (it.action === 'auth') { onClose(); return auth.openAuth?.() }
    onClose()
    navigate(it.url)
  }

  return (
    <div className="lg:hidden fixed inset-0 z-[60]" role="dialog" aria-modal="true" aria-label="פעולות">
      <button type="button" aria-label="סגירה" onClick={onClose} className="absolute inset-0 bg-[rgba(7,11,16,.78)] fl-fade-in" />
      <div className="absolute left-1/2 bottom-[calc(34px+env(safe-area-inset-bottom))]" dir="ltr">
        {items.map((it, i) => (
          <button key={it.title} ref={i === 0 ? first : undefined} type="button" onClick={() => act(it)}
            className="absolute -translate-x-1/2 -translate-y-1/2 flex flex-col items-center gap-1.5 w-[84px] fl-fan-in"
            style={{ left: pos[i].x, top: pos[i].y, animationDelay: `${i * 35}ms`, '--fx': `${-pos[i].x}px`, '--fy': `${-pos[i].y}px` }}>
            <span className={`relative size-[58px] rounded-full flex items-center justify-center shadow-[0_8px_20px_rgba(0,0,0,.35)] ${
              it.tone === 'ink' ? 'bg-[#11161D] text-white ring-1 ring-white/20' : 'bg-[#FAF9F6] text-[#11161D]'}`}>
              <ItemIcon item={it} size={34} />
            </span>
            <span dir="rtl" className="text-[12px] font-bold text-white leading-tight text-center">{it.title}</span>
          </button>
        ))}
      </div>
    </div>
  )
}

/** "כל הפעולות": search + every destination in groups, plus appearance. */
export function MoreSheet({ auth, onClose }) {
  const groups = moreGroups(auth)
  const navigate = useNavigate()
  const { mode, setMode } = useTheme()
  const [q, setQ] = useState('')
  const sheet = useRef(null)
  useEffect(() => {
    const k = (e) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', k)
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { document.removeEventListener('keydown', k); document.body.style.overflow = prev }
  }, [onClose])

  const go = (url) => { onClose(); navigate(url) }
  const submit = (e) => { e.preventDefault(); go(`/search${q.trim() ? `?q=${encodeURIComponent(q.trim())}` : ''}`) }
  const filter = (items) => (q.trim() ? items.filter((i) => i.title.includes(q.trim())) : items)

  return (
    <div className="fixed inset-0 z-[70]" role="dialog" aria-modal="true" aria-label="כל הפעולות">
      <button type="button" aria-label="סגירה" onClick={onClose} className="absolute inset-0 bg-[rgba(7,11,16,.6)] fl-fade-in" />
      <section ref={sheet} className="absolute inset-x-0 bottom-0 max-h-[88vh] overflow-y-auto overscroll-contain rounded-t-[28px] bg-surface fl-sheet-in lg:max-w-lg lg:mx-auto"
        style={{ paddingBottom: 'calc(20px + env(safe-area-inset-bottom))' }}>
        <div className="sticky top-0 z-10 bg-surface px-4 pt-2.5 pb-3">
          <span aria-hidden="true" className="block mx-auto w-10 h-[5px] rounded-full bg-line-strong" />
          <div className="mt-3 flex items-center justify-between">
            <h2 className="text-[20px] font-extrabold text-fg-strong">כל הפעולות</h2>
            <button type="button" onClick={onClose} aria-label="סגירה" className="size-11 -me-2 rounded-full flex items-center justify-center text-fg-muted hover:bg-surface-sunken">
              <LineIcon name="close" size={20} stroke={2.2} />
            </button>
          </div>
          <form onSubmit={submit} className="mt-2" role="search">
            <label className="flex items-center gap-2 h-11 px-3 rounded-control bg-surface-sunken text-fg-muted">
              <LineIcon name="search" size={20} />
              <span className="sr-only">חיפוש</span>
              <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="חיפוש שחקן, קבוצה או פעולה"
                className="flex-1 min-w-0 bg-transparent text-[15px] text-fg-strong placeholder:text-fg-subtle outline-none" />
            </label>
          </form>
        </div>
        <div className="px-4 flex flex-col gap-5">
          {groups.map((g) => {
            const items = filter(g.items)
            if (!items.length) return null
            return (
              <div key={g.title}>
                <h3 className="fl-eyebrow mb-2">{g.title}</h3>
                <div className="grid grid-cols-4 gap-2">
                  {items.map((it) => (
                    <button key={it.title} type="button" onClick={() => go(it.url)}
                      className="flex flex-col items-center gap-1.5 py-2 rounded-control hover:bg-surface-sunken min-h-[84px]">
                      <span className="size-12 rounded-full bg-surface-inset ring-1 ring-line flex items-center justify-center text-fg-strong">
                        <ItemIcon item={it} size={30} />
                      </span>
                      <span className="text-[12px] font-semibold text-fg-strong text-center leading-tight">{it.title}</span>
                    </button>
                  ))}
                </div>
              </div>
            )
          })}
          <div>
            <h3 className="fl-eyebrow mb-2">תצוגה</h3>
            <div className="tab-bar" role="radiogroup" aria-label="תצוגה">
              {[['light', 'בהיר'], ['dark', 'כהה'], ['system', 'לפי המכשיר']].map(([v, l]) => (
                <button key={v} type="button" role="radio" aria-checked={mode === v} onClick={() => setMode(v)}
                  className={mode === v ? 'tab-active' : 'tab-inactive'}>{l}</button>
              ))}
            </div>
          </div>
          {auth.user ? (
            <button type="button" onClick={() => { onClose(); auth.signOut() }} className="btn-secondary w-full min-h-[44px]">התנתקות</button>
          ) : (
            <button type="button" onClick={() => { onClose(); auth.openAuth() }} className="btn-primary w-full min-h-[44px]">התחברות</button>
          )}
        </div>
      </section>
    </div>
  )
}
