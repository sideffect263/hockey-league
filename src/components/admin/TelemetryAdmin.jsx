import { useEffect, useMemo, useState } from 'react'
import { Activity, AlertTriangle, MousePointerClick, Eye, Users, RefreshCw, Smartphone, Monitor } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { SkeletonPanelRows } from "@/components/skeletons/PageSkeletons"

/**
 * טלמטריה — what people are actually doing, and what is actually failing.
 *
 * Reads public.app_events, which only admins and league managers can select (RLS).
 * Everything here is aggregate or diagnostic: there is deliberately no way to read a
 * named individual's behaviour, because the events carry no names to begin with.
 */

const WINDOWS = [
  { hours: 1, label: 'שעה' },
  { hours: 24, label: '24 שעות' },
  { hours: 168, label: '7 ימים' },
  { hours: 720, label: '30 יום' },
]

const PLATFORM_META = {
  web: { label: 'אתר', icon: Monitor },
  ios: { label: 'iPhone', icon: Smartphone },
  android: { label: 'Android', icon: Smartphone },
}

/** Hebrew relative time — "לפני 3 דק'". */
function ago(iso) {
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000)
  if (s < 60) return 'עכשיו'
  if (s < 3600) return `לפני ${Math.floor(s / 60)} דק'`
  if (s < 86400) return `לפני ${Math.floor(s / 3600)} שע'`
  return `לפני ${Math.floor(s / 86400)} ימים`
}

function Stat({ icon: Icon, label, value, tone = 'brand' }) {
  const tones = {
    brand: 'text-brand bg-brand/10',
    red: 'text-red-600 dark:text-red-400 bg-red-500/10',
  }
  return (
    <div className="card p-4 flex items-center gap-3">
      <div className={`w-10 h-10 rounded-xl grid place-items-center shrink-0 ${tones[tone]}`}>
        <Icon className="w-5 h-5" />
      </div>
      <div className="min-w-0">
        <div className="text-2xl font-bold text-slate-900 dark:text-white tabular-nums">{value}</div>
        <div className="text-xs text-slate-500 dark:text-slate-400 truncate">{label}</div>
      </div>
    </div>
  )
}

export default function TelemetryAdmin() {
  const [hours, setHours] = useState(24)
  const [summary, setSummary] = useState([])
  const [topPages, setTopPages] = useState([])
  const [topActions, setTopActions] = useState([])
  const [errors, setErrors] = useState([])
  const [feed, setFeed] = useState([])
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState(null)

  useEffect(() => {
    let cancelled = false
    const load = async () => {
      setLoading(true)
      try {
        const since = new Date(Date.now() - hours * 3600_000).toISOString()
        const [s, p, a, e, f] = await Promise.all([
          supabase.rpc('app_event_summary', { p_hours: hours }),
          supabase.rpc('app_event_top', { p_kind: 'page', p_hours: hours, p_limit: 12 }),
          supabase.rpc('app_event_top', { p_kind: 'action', p_hours: hours, p_limit: 12 }),
          // The error list is read from the table rather than rolled up: when something
          // is broken you want the status and the path of the actual failures, not a count.
          supabase.from('app_events').select('id,created_at,platform,app_version,name,path,status,detail')
            .eq('kind', 'error').gte('created_at', since).order('created_at', { ascending: false }).limit(60),
          supabase.from('app_events').select('id,created_at,platform,kind,name,path,status,user_id')
            .gte('created_at', since).order('created_at', { ascending: false }).limit(40),
        ])
        const firstError = [s, p, a, e, f].find(r => r.error)?.error
        if (firstError) throw firstError
        if (cancelled) return
        setSummary(s.data || []); setTopPages(p.data || []); setTopActions(a.data || [])
        setErrors(e.data || []); setFeed(f.data || []); setErr(null)
      } catch (ex) {
        if (!cancelled) setErr(ex.message || String(ex))
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    load()
    // Refresh while the tab is open — this is the screen you leave up during a game.
    const t = setInterval(load, 30_000)
    return () => { cancelled = true; clearInterval(t) }
  }, [hours])

  const totals = useMemo(() => {
    const sum = (k) => summary.filter(r => r.kind === k).reduce((n, r) => n + Number(r.events), 0)
    // Sessions and users are counted per (kind, platform) row, so they cannot simply be
    // added — a person who views a page AND clicks appears in two rows. Take the widest
    // single row as a floor and label it honestly as "active", not as an exact count.
    const people = Math.max(0, ...summary.map(r => Number(r.sessions) || 0))
    return { pages: sum('page'), actions: sum('action'), errors: sum('error'), people }
  }, [summary])

  const byPlatform = useMemo(() => {
    const m = {}
    for (const r of summary) m[r.platform] = (m[r.platform] || 0) + Number(r.events)
    return Object.entries(m).sort((a, b) => b[1] - a[1])
  }, [summary])

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <h2 className="text-lg font-bold text-slate-900 dark:text-white flex items-center gap-2">
          <Activity className="w-5 h-5 text-brand" /> טלמטריה
        </h2>
        <div className="flex items-center gap-1 card p-1">
          {WINDOWS.map(w => (
            <button key={w.hours} onClick={() => setHours(w.hours)}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
                hours === w.hours ? 'bg-brand text-white' : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800'
              }`}>
              {w.label}
            </button>
          ))}
        </div>
      </div>

      {err && (
        <div className="card p-4 text-sm text-red-600 dark:text-red-400">
          לא ניתן לטעון טלמטריה: {err}
        </div>
      )}

      {loading && !summary.length && !err ? (
        <SkeletonPanelRows />
      ) : (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <Stat icon={Users} label="מושבים פעילים" value={totals.people} />
            <Stat icon={Eye} label="צפיות במסכים" value={totals.pages} />
            <Stat icon={MousePointerClick} label="פעולות" value={totals.actions} />
            <Stat icon={AlertTriangle} label="תקלות" value={totals.errors} tone={totals.errors ? 'red' : 'brand'} />
          </div>

          {byPlatform.length > 0 && (
            <div className="card p-4">
              <div className="text-xs font-semibold text-slate-500 dark:text-slate-400 mb-3">לפי פלטפורמה</div>
              <div className="flex flex-wrap gap-2">
                {byPlatform.map(([plat, n]) => {
                  const meta = PLATFORM_META[plat] || { label: plat, icon: Monitor }
                  return (
                    <div key={plat} className="flex items-center gap-2 px-3 py-1.5 rounded-xl bg-slate-100 dark:bg-slate-800 text-sm">
                      <meta.icon className="w-4 h-4 text-slate-500" />
                      <span className="font-semibold text-slate-900 dark:text-white">{meta.label}</span>
                      <span className="tabular-nums text-slate-500">{n}</span>
                    </div>
                  )
                })}
              </div>
            </div>
          )}

          {/* Errors first and unmissable: this is the half of the screen that earns its keep. */}
          <div className="card p-4">
            <div className="flex items-center gap-2 mb-3">
              <AlertTriangle className={`w-4 h-4 ${errors.length ? 'text-red-500' : 'text-slate-400'}`} />
              <span className="text-sm font-bold text-slate-900 dark:text-white">תקלות אחרונות</span>
            </div>
            {errors.length === 0 ? (
              <p className="text-sm text-slate-500 dark:text-slate-400">אין תקלות בחלון הזמן הזה.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-xs text-slate-500 dark:text-slate-400 border-b border-slate-200 dark:border-slate-700">
                      <th className="text-right font-semibold py-2 px-2">מתי</th>
                      <th className="text-right font-semibold py-2 px-2">סוג</th>
                      <th className="text-right font-semibold py-2 px-2">מסך / בקשה</th>
                      <th className="text-right font-semibold py-2 px-2">סטטוס</th>
                      <th className="text-right font-semibold py-2 px-2">פרטים</th>
                    </tr>
                  </thead>
                  <tbody>
                    {errors.map(r => (
                      <tr key={r.id} className="border-b border-slate-100 dark:border-slate-800 last:border-0">
                        <td className="py-2 px-2 whitespace-nowrap text-slate-500">{ago(r.created_at)}</td>
                        <td className="py-2 px-2 whitespace-nowrap font-semibold text-red-600 dark:text-red-400">{r.name}</td>
                        <td className="py-2 px-2 font-mono text-xs" dir="ltr">{r.path || '—'}</td>
                        <td className="py-2 px-2 tabular-nums" dir="ltr">{r.status ?? '—'}</td>
                        <td className="py-2 px-2 text-xs text-slate-500 max-w-[22rem] truncate" dir="ltr" title={JSON.stringify(r.detail)}>
                          {Object.entries(r.detail || {}).map(([k, v]) => `${k}=${v}`).join(' ') || '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          <div className="grid lg:grid-cols-2 gap-4">
            <TopList title="מסכים נצפים" icon={Eye} rows={topPages} />
            <TopList title="פעולות נפוצות" icon={MousePointerClick} rows={topActions} />
          </div>

          <div className="card p-4">
            <div className="flex items-center gap-2 mb-3">
              <RefreshCw className="w-4 h-4 text-slate-400" />
              <span className="text-sm font-bold text-slate-900 dark:text-white">זרם חי</span>
              <span className="text-xs text-slate-400">מתרענן כל 30 שניות</span>
            </div>
            {feed.length === 0 ? (
              <p className="text-sm text-slate-500 dark:text-slate-400">עדיין אין אירועים.</p>
            ) : (
              <ul className="space-y-1.5 max-h-96 overflow-y-auto">
                {feed.map(r => (
                  <li key={r.id} className="flex items-center gap-2 text-sm">
                    <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${
                      r.kind === 'error' ? 'bg-red-500' : r.kind === 'action' ? 'bg-brand' : 'bg-slate-300 dark:bg-slate-600'
                    }`} />
                    <span className="text-xs text-slate-400 w-20 shrink-0">{ago(r.created_at)}</span>
                    <span className="font-semibold text-slate-900 dark:text-white shrink-0">{r.name}</span>
                    <span className="font-mono text-xs text-slate-500 truncate" dir="ltr">{r.path || ''}</span>
                    <span className="text-xs text-slate-400 mr-auto shrink-0">
                      {(PLATFORM_META[r.platform] || {}).label || r.platform}
                      {r.user_id ? '' : ' · אורח'}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </>
      )}
    </div>
  )
}

function TopList({ title, icon: Icon, rows }) {
  const max = Math.max(1, ...rows.map(r => Number(r.events)))
  return (
    <div className="card p-4">
      <div className="flex items-center gap-2 mb-3">
        <Icon className="w-4 h-4 text-slate-400" />
        <span className="text-sm font-bold text-slate-900 dark:text-white">{title}</span>
      </div>
      {rows.length === 0 ? (
        <p className="text-sm text-slate-500 dark:text-slate-400">אין נתונים עדיין.</p>
      ) : (
        <ul className="space-y-2">
          {rows.map((r, i) => (
            <li key={`${r.name}-${r.path}-${i}`}>
              <div className="flex items-baseline justify-between gap-2 text-sm">
                <span className="font-mono text-xs truncate text-slate-700 dark:text-slate-300" dir="ltr">
                  {r.path && r.name === 'page_view' ? r.path : r.name}
                </span>
                <span className="tabular-nums text-xs text-slate-500 shrink-0">
                  {r.events}
                  <span className="text-slate-400"> · {r.users} משתמשים</span>
                </span>
              </div>
              {/* A bar, not a chart library: one dimension, already sorted. */}
              <div className="mt-1 h-1.5 rounded-full bg-slate-100 dark:bg-slate-800 overflow-hidden">
                <div className="h-full rounded-full bg-brand" style={{ width: `${(Number(r.events) / max) * 100}%` }} />
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
