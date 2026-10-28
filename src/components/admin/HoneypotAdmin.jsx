import { useEffect, useMemo, useState } from "react"
import { RefreshCw, ShieldAlert, Bug, Eye, EyeOff } from "lucide-react"
import { InfoIcon as Info, Squad as Users } from "@/components/icons/BrandIcons"
import { supabase } from "@/lib/supabase"
import StatTile from "@/components/charts/StatTile"
import { SkeletonPanelRows } from "@/components/skeletons/PageSkeletons"

/**
 * מלכודות — who called the honeypot RPCs (supabase/honeypot.sql).
 *
 * Four decoy functions sit in the public API looking like an admin back door. Nothing we
 * ship calls them, so every row here is somebody probing the backend by hand (or an admin
 * pressing "בדיקה" below). Admin-only: honeypot_hits is readable by is_admin() alone.
 * Hits are grouped per prober (signed-in account, else IP) so one curious person with a
 * script reads as one line, not two hundred.
 */

const TRAPS = {
  admin_grant_role: "הענקת הרשאת מנהל",
  export_all_users: "ייצוא כל המשתמשים",
  debug_sql: "הרצת SQL",
  reset_admin_password: "איפוס סיסמת מנהל",
}

const fmtTime = (iso) => new Date(iso).toLocaleString("he-IL", { day: "numeric", month: "numeric", hour: "2-digit", minute: "2-digit" })
const DAY = 24 * 3600 * 1000

export default function HoneypotAdmin() {
  const [reload, setReload] = useState(0)
  const [showDismissed, setShowDismissed] = useState(false)
  const [state, setState] = useState({ loading: true, rows: [], error: null })
  const [busy, setBusy] = useState(null)
  const [testMsg, setTestMsg] = useState(null)

  useEffect(() => {
    let alive = true
    setState(s => ({ ...s, loading: true }))
    supabase.from("honeypot_hits")
      .select("id, created_at, trap, user_id, email, is_admin, ip, user_agent, origin, args, dismissed")
      .order("created_at", { ascending: false })
      .limit(1000)
      .then(({ data, error }) => { if (alive) setState({ loading: false, rows: data || [], error }) })
    return () => { alive = false }
  }, [reload])

  const rows = state.rows
  const visible = showDismissed ? rows : rows.filter(r => !r.dismissed)

  // One card per prober: account if signed in, otherwise IP.
  const actors = useMemo(() => {
    const by = new Map()
    for (const r of visible) {
      const key = r.user_id || r.ip || "unknown"
      if (!by.has(key)) by.set(key, { key, email: r.email, ip: r.ip, is_admin: r.is_admin, hits: [] })
      const a = by.get(key)
      a.hits.push(r)
      a.email ||= r.email
      a.ip ||= r.ip
    }
    return [...by.values()]
  }, [visible])

  const now = Date.now()
  const real = rows.filter(r => !r.is_admin && !r.dismissed)
  const last24 = real.filter(r => now - new Date(r.created_at) < DAY).length
  const last7 = real.filter(r => now - new Date(r.created_at) < 7 * DAY).length
  const probers = new Set(real.map(r => r.user_id || r.ip)).size

  const dismiss = async (actor, value) => {
    setBusy(actor.key)
    const ids = actor.hits.map(h => h.id)
    const { error } = await supabase.from("honeypot_hits").update({ dismissed: value }).in("id", ids)
    setBusy(null)
    if (error) { setTestMsg(`שגיאה: ${error.message}`); return }
    setReload(r => r + 1)
  }

  // Calls a trap as yourself. The DB marks it as an admin test and alerts only you.
  const runTest = async () => {
    setTestMsg(null)
    const { error } = await supabase.rpc("admin_grant_role", { p_email: "test@rinkhockeyil.com", p_role: "admin" })
    setTestMsg(error ? `שגיאה: ${error.message}` : "המלכודת הופעלה — השורה מסומנת כבדיקה ותתקבל התראה רק אצלך (פעם בשעה).")
    setReload(r => r + 1)
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-bold text-slate-900 dark:text-white flex items-center gap-2">
            <ShieldAlert className="w-5 h-5 text-brand" /> מלכודות
          </h2>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
            מי ניסה לגעת בפונקציות מזויפות בשרת. האתר והאפליקציות לא קוראים להן אף פעם — כל שורה כאן היא מישהו שחיטט ב-API.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => setShowDismissed(v => !v)}
            className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800">
            {showDismissed ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
            {showDismissed ? "הסתר מטופלים" : "הצג מטופלים"}
          </button>
          <button onClick={runTest}
            className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:border-brand">
            <Bug className="w-4 h-4" /> בדיקה
          </button>
          <button onClick={() => setReload(r => r + 1)} className="p-2 rounded-lg text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800" aria-label="רענון">
            <RefreshCw className="w-4 h-4" />
          </button>
        </div>
      </div>

      {testMsg && <div className="card p-3 text-xs text-slate-700 dark:text-slate-200">{testMsg}</div>}

      {state.loading && !rows.length ? <SkeletonPanelRows count={4} />
        : state.error ? (
          <div className="card p-4 text-sm text-red-600 dark:text-red-400">
            שגיאה בטעינת הנתונים: {state.error.message}
          </div>
        ) : (
          <>
            <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">
              <StatTile icon={<ShieldAlert className="w-5 h-5" />} accent="brand" value={last24} label="ניסיונות ב-24 שעות" />
              <StatTile icon={<Bug className="w-5 h-5" />} value={last7} label="ניסיונות ב-7 ימים" />
              <StatTile icon={<Users className="w-5 h-5" />} value={probers} label="חשבונות / כתובות שונים" sub="לא כולל בדיקות של מנהלים" />
            </div>

            <div className="card p-3 text-xs text-slate-600 dark:text-slate-300 flex gap-2">
              <Info className="w-4 h-4 shrink-0 text-brand mt-0.5" />
              <div>
                המלכודות: {Object.entries(TRAPS).map(([fn, label], i) => (
                  <span key={fn}>{i > 0 && " · "}<span dir="ltr" className="font-mono">{fn}</span> ({label})</span>
                ))}. הן לא נותנות שום הרשאה — רק רושמות ומחזירות תשובה מזויפת.
                {" "}מנהלים מקבלים התראה אחת לשעה לכל חשבון או כתובת. "סמן כמטופל" מסתיר מכאן בלבד, לא חוסם.
              </div>
            </div>

            {!actors.length ? (
              <div className="card p-8 text-center text-sm text-slate-500 dark:text-slate-400">אף אחד לא נכנס למלכודת. 🎣</div>
            ) : actors.map(a => (
              <ActorCard key={a.key} a={a} busy={busy === a.key} onDismiss={dismiss} />
            ))}
          </>
        )}
    </div>
  )
}

function ActorCard({ a, busy, onDismiss }) {
  const allDismissed = a.hits.every(h => h.dismissed)
  const first = a.hits[a.hits.length - 1]
  const last = a.hits[0]
  const traps = [...new Set(a.hits.map(h => h.trap))]
  return (
    <div className={`card p-4 space-y-3 ${allDismissed ? "opacity-60" : ""}`}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-bold text-sm text-slate-900 dark:text-white truncate" dir="ltr">
              {a.email || a.ip || "לא ידוע"}
            </span>
            {a.is_admin && <span className="px-2 py-0.5 rounded-full text-[11px] font-semibold bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300">בדיקת מנהל</span>}
            {!a.email && <span className="px-2 py-0.5 rounded-full text-[11px] font-semibold bg-amber-100 dark:bg-amber-900/40 text-amber-800 dark:text-amber-200">לא מחובר</span>}
          </div>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
            {a.hits.length} {a.hits.length === 1 ? "ניסיון" : "ניסיונות"} · <span dir="ltr">{fmtTime(first.created_at)}</span>
            {a.hits.length > 1 && <> – <span dir="ltr">{fmtTime(last.created_at)}</span></>}
            {a.email && a.ip && <> · IP <span dir="ltr" className="font-mono">{a.ip}</span></>}
          </p>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
            {traps.map(t => TRAPS[t] || t).join(" · ")}
          </p>
        </div>
        <button disabled={busy} onClick={() => onDismiss(a, !allDismissed)}
          className="px-3 py-1.5 rounded-lg text-xs font-semibold border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:border-brand disabled:opacity-50">
          {allDismissed ? "החזר" : "סמן כמטופל"}
        </button>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full min-w-[560px] text-xs">
          <thead><tr className="text-slate-500 text-right">
            <th className="py-1 pl-3 font-medium whitespace-nowrap">מתי</th>
            <th className="py-1 pl-3 font-medium">מלכודת</th>
            <th className="py-1 pl-3 font-medium">מה שלחו</th>
            <th className="py-1 pl-3 font-medium">דפדפן / כלי</th>
          </tr></thead>
          <tbody>
            {a.hits.slice(0, 20).map(h => (
              <tr key={h.id} className="border-t border-slate-100 dark:border-slate-800 align-top">
                <td className="py-1.5 pl-3 whitespace-nowrap tabular-nums" dir="ltr">{fmtTime(h.created_at)}</td>
                <td className="py-1.5 pl-3 font-mono whitespace-nowrap" dir="ltr">{h.trap}</td>
                <td className="py-1.5 pl-3 font-mono break-all text-slate-700 dark:text-slate-300" dir="ltr">
                  {h.args ? Object.entries(h.args).map(([k, v]) => `${k}=${v}`).join("  ") : "—"}
                </td>
                <td className="py-1.5 pl-3 break-all text-slate-500 dark:text-slate-400 max-w-[18rem]" dir="ltr">{h.user_agent || "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {a.hits.length > 20 && <p className="text-[11px] text-slate-400 mt-1">ועוד {a.hits.length - 20} ניסיונות…</p>}
      </div>
    </div>
  )
}
