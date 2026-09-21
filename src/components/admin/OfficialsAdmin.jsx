import { useState, useEffect, useMemo } from "react"
import { format } from "date-fns"
import { SkeletonPanelRows } from "@/components/skeletons/PageSkeletons"
import {
  Gavel, HeartPulse, AlertTriangle, X, Check, RefreshCw, Coins, Download, Copy, ClipboardCheck,
} from "lucide-react"
import {
  OFFICIAL_ROLE_LABEL, listAssignableOfficials, getOfficialsOverview, getOfficialRates,
  getOfficialsPaylog, assignOfficial, removeOfficial, setOfficialRate, reviewOfficialApplication,
} from "@/lib/officials"

const UPCOMING = ["scheduled", "postponed", "waiting_result", "in_progress"]
const roleIcon = { judge: Gavel, medic: HeartPulse }

/**
 * Officials tab (epic D) — league-manager / admin. Set per-role rates, assign a judge
 * and a medic to each upcoming game (with missing-official warnings), review officials'
 * self-submissions, and see the work/pay dashboard with CSV export + a copy-paste
 * payment template. Backed entirely by SECURITY DEFINER RPCs (see src/lib/officials.js).
 */
export default function OfficialsAdmin({ games = [], teamsMap = {} }) {
  const [overview, setOverview] = useState([])
  const [assignable, setAssignable] = useState([])
  const [rates, setRates] = useState({ judge: 0, medic: 0 })
  const [paylog, setPaylog] = useState([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(null)
  const [copied, setCopied] = useState(false)

  const load = async () => {
    setLoading(true)
    try {
      const [ov, as, ra, pl] = await Promise.all([
        getOfficialsOverview().catch(() => []),
        listAssignableOfficials().catch(() => []),
        getOfficialRates().catch(() => ({ judge: 0, medic: 0 })),
        getOfficialsPaylog().catch(() => []),
      ])
      setOverview(ov); setAssignable(as); setRates(ra); setPaylog(pl)
    } finally { setLoading(false) }
  }
  useEffect(() => { load() }, [])

  const upcoming = useMemo(() => games
    .filter(g => UPCOMING.includes(g.status))
    .sort((a, b) => new Date(a.game_date) - new Date(b.game_date)), [games])

  const confirmedFor = (gameId, role) =>
    overview.find(o => o.game_id === gameId && o.role === role && (o.status === "assigned" || o.status === "approved"))
  const applications = overview.filter(o => o.status === "applied")
  const assignableByRole = {
    judge: assignable.filter(a => a.role === "judge"),
    medic: assignable.filter(a => a.role === "medic"),
  }

  const doAssign = async (gameId, userId, role) => {
    if (!userId) return
    setBusy(`${gameId}:${role}`)
    try { await assignOfficial(gameId, userId, role); await load() } catch { /* ignore */ } finally { setBusy(null) }
  }
  const doRemove = async (id) => { setBusy(id); try { await removeOfficial(id); await load() } catch { /* ignore */ } finally { setBusy(null) } }
  const doReview = async (id, approve) => { setBusy(id); try { await reviewOfficialApplication(id, approve); await load() } catch { /* ignore */ } finally { setBusy(null) } }
  const saveRate = async (role, val) => { try { await setOfficialRate(role, val); setRates(r => ({ ...r, [role]: Number(val) || 0 })) } catch { /* ignore */ } }

  // ---- pay dashboard: CSV + copy-paste template ----
  const grandTotal = paylog.reduce((s, p) => s + Number(p.total || 0), 0)
  const payTemplate = () => {
    const lines = paylog.map(p => `${p.display_name || "—"} · ${OFFICIAL_ROLE_LABEL[p.role]}: ${p.games_worked} משחקים × ${p.rate}₪ = ${p.total}₪`)
    return `תשלום לבעלי תפקיד — ליגת הוקי הגלגיליות\n\n${lines.join("\n")}\n\nסה״כ: ${grandTotal}₪`
  }
  const copyTemplate = async () => {
    try { await navigator.clipboard.writeText(payTemplate()); setCopied(true); setTimeout(() => setCopied(false), 1800) } catch { /* ignore */ }
  }
  const exportCsv = () => {
    const rows = [["שם", "תפקיד", "משחקים", "תעריף", "סהכ"], ...paylog.map(p => [p.display_name || "", OFFICIAL_ROLE_LABEL[p.role], p.games_worked, p.rate, p.total])]
    const csv = "﻿" + rows.map(r => r.map(c => `"${String(c ?? "").replace(/"/g, '""')}"`).join(",")).join("\n")
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8;" }))
    const a = document.createElement("a"); a.href = url; a.download = "officials-pay.csv"; a.click(); URL.revokeObjectURL(url)
  }

  if (loading) return <SkeletonPanelRows />

  const RoleSlot = ({ game, role }) => {
    const RIcon = roleIcon[role]
    const cur = confirmedFor(game.id, role)
    if (cur) {
      return (
        <div className="flex items-center gap-1.5 text-xs min-w-0">
          <RIcon className="w-3.5 h-3.5 text-slate-400 shrink-0" />
          {/* The full name is the one that goes on the game sheet; display_name is only
              a fallback for officials who signed up before P3 required it. */}
          <span className="font-semibold text-slate-700 dark:text-slate-200 truncate">
            {cur.full_name || cur.display_name || "—"}
          </span>
          {/* The medic's number is the point of collecting it — make it tappable. */}
          {cur.phone && (
            <a href={`tel:${cur.phone}`} dir="ltr"
              className="shrink-0 text-[11px] font-semibold text-brand hover:underline tabular-nums">
              {cur.phone}
            </a>
          )}
          <button onClick={() => doRemove(cur.id)} disabled={busy === cur.id} className="text-slate-300 hover:text-red-500 transition-colors shrink-0"><X className="w-3.5 h-3.5" /></button>
        </div>
      )
    }
    return (
      <div className="flex items-center gap-1.5">
        <AlertTriangle className="w-3.5 h-3.5 text-amber-500 shrink-0" title={`חסר ${OFFICIAL_ROLE_LABEL[role]}`} />
        <select defaultValue="" onChange={e => doAssign(game.id, e.target.value, role)} disabled={busy === `${game.id}:${role}`}
          className="text-xs bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-600 rounded-lg px-2 py-1 text-slate-700 dark:text-slate-200 focus:outline-none focus:ring-2 focus:ring-brand/30 max-w-[150px]">
          <option value="">{`שבץ ${OFFICIAL_ROLE_LABEL[role]}…`}</option>
          {assignableByRole[role].map(a => <option key={a.user_id} value={a.user_id}>{a.display_name || "—"}</option>)}
        </select>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <h2 className="flex items-center gap-2 text-lg font-bold text-slate-900 dark:text-white"><Gavel className="w-5 h-5 text-brand" /> בעלי תפקיד</h2>
        <button onClick={load} className="flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-600 text-slate-500 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors"><RefreshCw className="w-3.5 h-3.5" /> רענון</button>
      </div>

      {/* Rates */}
      <div className="card p-4">
        <h3 className="text-sm font-bold text-slate-900 dark:text-white mb-3 flex items-center gap-2"><Coins className="w-4 h-4 text-brand" /> תעריף למשחק</h3>
        <div className="flex items-center gap-4 flex-wrap">
          {["judge", "medic"].map(role => (
            <label key={role} className="flex items-center gap-2 text-sm">
              <span className="text-slate-500 dark:text-slate-400">{OFFICIAL_ROLE_LABEL[role]}</span>
              <input type="number" min="0" defaultValue={rates[role] ?? 0} onBlur={e => saveRate(role, e.target.value)}
                className="w-24 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-600 rounded-lg px-2 py-1 text-sm text-slate-800 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-brand/30" />
              <span className="text-slate-400 text-xs">₪</span>
            </label>
          ))}
          <span className="text-[11px] text-slate-400">התעריף נשמר אוטומטית</span>
        </div>
      </div>

      {/* Applications to review */}
      {applications.length > 0 && (
        <div className="card p-4">
          <h3 className="text-sm font-bold text-slate-900 dark:text-white mb-3">בקשות שיבוץ ({applications.length})</h3>
          <div className="space-y-2">
            {applications.map(a => {
              const g = games.find(x => x.id === a.game_id)
              const RIcon = roleIcon[a.role]
              return (
                <div key={a.id} className="flex items-center justify-between gap-2 p-2.5 rounded-xl bg-slate-50 dark:bg-slate-800/50">
                  <div className="flex items-center gap-2 min-w-0 text-sm">
                    <RIcon className="w-4 h-4 text-slate-400 shrink-0" />
                    <span className="font-semibold text-slate-800 dark:text-slate-200 truncate">{a.full_name || a.display_name || "—"}</span>
                    {/* The manager is deciding whether to assign someone to a specific
                        fixture — he needs WHEN and WHERE, not just the fixture name. */}
                    <span className="text-[11px] text-slate-400 truncate">
                      {OFFICIAL_ROLE_LABEL[a.role]} · {g ? `${teamsMap[g.home_team_id]?.name || "?"} נגד ${teamsMap[g.away_team_id]?.name || "?"}` : "משחק"}
                      {g?.game_date && ` · ${new Date(g.game_date).toLocaleString("he-IL", { weekday: "short", day: "numeric", month: "numeric", hour: "2-digit", minute: "2-digit" })}`}
                      {g?.venue && ` · ${g.venue}`}
                      {a.phone && <> · <span dir="ltr" className="tabular-nums">{a.phone}</span></>}
                    </span>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    <button onClick={() => doReview(a.id, true)} disabled={busy === a.id} className="flex items-center gap-1 text-xs font-semibold px-2.5 py-1.5 rounded-lg bg-emerald-500 text-white hover:bg-emerald-600 disabled:opacity-50"><Check className="w-3.5 h-3.5" /> אשר</button>
                    <button onClick={() => doReview(a.id, false)} disabled={busy === a.id} className="flex items-center gap-1 text-xs font-semibold px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-600 text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700 disabled:opacity-50"><X className="w-3.5 h-3.5" /></button>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* Assignment per upcoming game */}
      <div className="card overflow-hidden">
        <div className="px-4 py-3 border-b border-slate-100 dark:border-slate-700"><h3 className="text-sm font-bold text-slate-900 dark:text-white">שיבוץ למשחקים קרובים</h3></div>
        <div className="p-3 space-y-2">
          {upcoming.length === 0 && <p className="text-center text-sm text-slate-400 py-6">אין משחקים קרובים</p>}
          {upcoming.map(game => (
            <div key={game.id} className="p-3 rounded-xl bg-slate-50 dark:bg-slate-800/50">
              <div className="flex items-center justify-between gap-2 mb-2">
                <span className="text-sm font-semibold text-slate-900 dark:text-white truncate">{teamsMap[game.home_team_id]?.name || "?"} <span className="text-slate-400 font-normal">נגד</span> {teamsMap[game.away_team_id]?.name || "?"}</span>
                <span className="text-[11px] text-slate-400 shrink-0">{format(new Date(game.game_date), "d/M HH:mm")}</span>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                <RoleSlot game={game} role="judge" />
                <RoleSlot game={game} role="medic" />
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Pay dashboard */}
      <div className="card overflow-hidden">
        <div className="px-4 py-3 border-b border-slate-100 dark:border-slate-700 flex items-center justify-between gap-2 flex-wrap">
          <h3 className="text-sm font-bold text-slate-900 dark:text-white flex items-center gap-2"><Coins className="w-4 h-4 text-brand" /> תשלומים (משחקים שהסתיימו)</h3>
          <div className="flex items-center gap-1.5">
            <button onClick={copyTemplate} disabled={!paylog.length} className="flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-600 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700 disabled:opacity-40">
              {copied ? <ClipboardCheck className="w-3.5 h-3.5 text-emerald-500" /> : <Copy className="w-3.5 h-3.5" />} {copied ? "הועתק" : "העתק טקסט"}
            </button>
            <button onClick={exportCsv} disabled={!paylog.length} className="flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-600 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700 disabled:opacity-40"><Download className="w-3.5 h-3.5" /> CSV</button>
          </div>
        </div>
        {paylog.length === 0 ? (
          <p className="text-center text-sm text-slate-400 py-8">אין עדיין עבודה לתשלום</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-slate-50 dark:bg-slate-800/60 text-[11px] uppercase tracking-wider text-slate-400">
                  <th className="text-right font-bold px-4 py-2.5">שם</th>
                  <th className="text-right font-bold px-3 py-2.5">תפקיד</th>
                  <th className="text-center font-bold px-3 py-2.5">משחקים</th>
                  <th className="text-center font-bold px-3 py-2.5">תעריף</th>
                  <th className="text-center font-bold px-3 py-2.5">סה״כ</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-700/50">
                {paylog.map((p, i) => (
                  <tr key={i}>
                    <td className="px-4 py-2.5 font-semibold text-slate-900 dark:text-white whitespace-nowrap">{p.display_name || "—"}</td>
                    <td className="px-3 py-2.5 text-slate-500 dark:text-slate-400 whitespace-nowrap">{OFFICIAL_ROLE_LABEL[p.role]}</td>
                    <td className="px-3 py-2.5 text-center tabular-nums">{p.games_worked}</td>
                    <td className="px-3 py-2.5 text-center tabular-nums">{p.rate}₪</td>
                    <td className="px-3 py-2.5 text-center tabular-nums font-bold text-slate-900 dark:text-white">{p.total}₪</td>
                  </tr>
                ))}
                <tr className="bg-slate-50 dark:bg-slate-800/40 font-bold">
                  <td className="px-4 py-2.5" colSpan={4}>סה״כ לתשלום</td>
                  <td className="px-3 py-2.5 text-center tabular-nums text-brand dark:text-brand-light">{grandTotal}₪</td>
                </tr>
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
