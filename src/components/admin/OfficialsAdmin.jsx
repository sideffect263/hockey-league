import { useState, useEffect, useMemo } from "react"
import { format } from "date-fns"
import { SkeletonPanelRows } from "@/components/skeletons/PageSkeletons"
import { X, Check, RefreshCw, Download, Copy, Search, Plus } from "lucide-react"
import { Medic, Warning as AlertTriangle, Wallet as Coins, GameForm as ClipboardCheck, Gavel } from "@/components/icons/BrandIcons"
import {
  OFFICIAL_ROLE_LABEL, listAssignableOfficials, getOfficialsOverview, getOfficialRates,
  getOfficialsPaylog, assignOfficial, removeOfficial, setOfficialRate, reviewOfficialApplication,
  searchOfficialCandidates, grantOfficialRole, revokeOfficialRole,
} from "@/lib/officials"
import { ilDate } from "@/lib/ilTime"

const UPCOMING = ["scheduled", "postponed", "waiting_result", "in_progress"]
const roleIcon = { judge: Gavel, medic: Medic }
const ROLE_PLURAL = { judge: "שופטים", medic: "חובשים" }
const WEEKDAY = ["ראשון", "שני", "שלישי", "רביעי", "חמישי", "שישי", "שבת"]
/** "יום שבת 14.11" — Israel wall-clock day. */
const dayHeader = (iso) => { const d = ilDate(iso); return `יום ${WEEKDAY[d.getDay()]} ${d.getDate()}.${d.getMonth() + 1}` }

function RefreshButton({ onClick }) {
  return (
    <button onClick={onClick} className="flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-600 text-slate-500 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors"><RefreshCw className="w-3.5 h-3.5" /> רענון</button>
  )
}

/**
 * One officials tab per role (epic D, split 2026-11-04): `role="judge"` is the שופטים
 * tab (referee manager / league manager / admin), `role="medic"` the חובשים tab (medic
 * manager / league manager / admin). Assign that role to each upcoming game (with
 * missing-official warnings) and review its self-submissions. Rates and the pay log are
 * NOT here — they are OfficialsPayAdmin below, league manager / admin only. The RPCs
 * (src/lib/officials.js, supabase/medic-referee-managers.sql) already return only the
 * roles the caller manages; the filter here is for the LM / admin who manages both.
 */
export default function OfficialsAdmin({ games = [], teamsMap = {}, role = "judge" }) {
  const [overview, setOverview] = useState([])
  const [assignable, setAssignable] = useState([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(null)
  const RIcon = roleIcon[role]

  // quiet = refresh in place (no skeleton), so the role card keeps its search box.
  const load = async (quiet = false) => {
    if (!quiet) setLoading(true)
    try {
      const [ov, as] = await Promise.all([
        getOfficialsOverview().catch(() => []),
        listAssignableOfficials().catch(() => []),
      ])
      setOverview(ov.filter(o => o.role === role)); setAssignable(as.filter(a => a.role === role))
    } finally { setLoading(false) }
  }
  useEffect(() => { load() }, [role])

  const upcoming = useMemo(() => games
    .filter(g => UPCOMING.includes(g.status))
    .sort((a, b) => new Date(a.game_date) - new Date(b.game_date)), [games])

  // Every confirmed official, not just the first — a game can have two judges, and the
  // second one used to be invisible here (and impossible to remove).
  const confirmedFor = (gameId) =>
    overview.filter(o => o.game_id === gameId && (o.status === "assigned" || o.status === "approved"))
  // Same person confirmed on another game starting within 2 hours.
  const clashFor = (cur, game) => !cur.user_id ? null : overview
    .filter(o => o.user_id === cur.user_id && o.game_id !== game.id && (o.status === "assigned" || o.status === "approved"))
    .map(o => games.find(g => g.id === o.game_id))
    .find(g => g && Math.abs(new Date(g.game_date) - new Date(game.game_date)) < 2 * 3600e3) || null
  const applications = overview.filter(o => o.status === "applied")
  const missingCount = upcoming.filter(g => confirmedFor(g.id).length === 0).length

  const doAssign = async (gameId, userId) => {
    if (!userId) return
    setBusy(`${gameId}:${role}`)
    try { await assignOfficial(gameId, userId, role); await load() } catch (e) { fail(e) } finally { setBusy(null) }
  }
  // A failed write used to vanish and the row just stayed as it was — looked like it worked.
  const fail = (e) => alert('שגיאה: ' + (e?.message || e))
  const doRemove = async (id) => { setBusy(id); try { await removeOfficial(id); await load() } catch (e) { fail(e) } finally { setBusy(null) } }
  const doReview = async (id, approve) => { setBusy(id); try { await reviewOfficialApplication(id, approve); await load() } catch (e) { fail(e) } finally { setBusy(null) } }

  if (loading) return <SkeletonPanelRows />

  const RoleSlot = ({ game }) => {
    const confirmed = confirmedFor(game.id)
    if (confirmed.length) {
      return (
        <div className="flex flex-col gap-1 min-w-0">
        {confirmed.map(cur => (
        <div key={cur.id} className="flex items-center gap-1.5 text-xs min-w-0">
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
          <button onClick={() => doRemove(cur.id)} disabled={busy === cur.id} aria-label="הסר מהשיבוץ" className="text-slate-300 hover:text-red-500 transition-colors shrink-0"><X className="w-3.5 h-3.5" /></button>
        </div>
        ))}
        {confirmed.map(cur => {
          const other = clashFor(cur, game)
          return other && (
            <span key={`c${cur.id}`} className="text-[11px] text-red-500">
              ⚠ {cur.full_name || cur.display_name} משובץ גם ל{teamsMap[other.home_team_id]?.name || "?"} נגד {teamsMap[other.away_team_id]?.name || "?"} ב-<span dir="ltr">{format(ilDate(other.game_date), "HH:mm")}</span>
            </span>
          )
        })}
        </div>
      )
    }
    return (
      <div className="flex items-center gap-1.5">
        <AlertTriangle className="w-4 h-4 text-amber-500 shrink-0" title={`חסר ${OFFICIAL_ROLE_LABEL[role]}`} />
        <select defaultValue="" onChange={e => doAssign(game.id, e.target.value)} disabled={busy === `${game.id}:${role}`}
          className="text-xs bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-600 rounded-lg px-2 py-1 text-slate-700 dark:text-slate-200 focus:outline-none focus:ring-2 focus:ring-brand/30 max-w-[180px]">
          <option value="">{`שבץ ${OFFICIAL_ROLE_LABEL[role]}…`}</option>
          {assignable.map(a => <option key={a.user_id} value={a.user_id}>{a.display_name || "—"}</option>)}
        </select>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <h2 className="flex items-center gap-2 text-lg font-bold text-slate-900 dark:text-white">
          <RIcon className="w-5 h-5 text-brand" /> {ROLE_PLURAL[role]}
          {missingCount > 0 && (
            <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300">
              <span className="tabular-nums">{missingCount}</span> משחקים בלי {OFFICIAL_ROLE_LABEL[role]}
            </span>
          )}
        </h2>
        <RefreshButton onClick={() => load()} />
      </div>

      {/* Who is a medic at all: the medic manager makes accounts medics here (2026-11-09). */}
      {role === "medic" && <RoleHolders role={role} holders={assignable} onChange={() => load(true)} onError={fail} />}

      {/* Applications to review */}
      {applications.length > 0 && (
        <div className="card p-4">
          <h3 className="text-sm font-bold text-slate-900 dark:text-white mb-3">בקשות שיבוץ ({applications.length})</h3>
          <div className="space-y-2">
            {applications.map(a => {
              const g = games.find(x => x.id === a.game_id)
              return (
                <div key={a.id} className="flex items-center justify-between gap-2 p-2.5 rounded-xl bg-slate-50 dark:bg-slate-800/50">
                  <div className="flex items-center gap-2 min-w-0 text-sm">
                    <RIcon className="w-4 h-4 text-slate-400 shrink-0" />
                    <span className="font-semibold text-slate-800 dark:text-slate-200 truncate">{a.full_name || a.display_name || "—"}</span>
                    {/* The manager is deciding whether to assign someone to a specific
                        fixture — he needs WHEN and WHERE, not just the fixture name. */}
                    <span className="text-[11px] text-slate-400 truncate">
                      {g ? `${teamsMap[g.home_team_id]?.name || "?"} נגד ${teamsMap[g.away_team_id]?.name || "?"}` : "משחק"}
                      {g?.game_date && ` · ${new Date(g.game_date).toLocaleString("he-IL", { timeZone: "Asia/Jerusalem", weekday: "short", day: "numeric", month: "numeric", hour: "2-digit", minute: "2-digit" })}`}
                      {g?.venue && ` · ${g.venue}`}
                      {a.phone && <> · <span dir="ltr" className="tabular-nums">{a.phone}</span></>}
                    </span>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    <button onClick={() => doReview(a.id, true)} disabled={busy === a.id} className="flex items-center gap-1 text-xs font-semibold px-2.5 py-1.5 rounded-lg bg-emerald-500 text-white hover:bg-emerald-600 disabled:opacity-50"><Check className="w-3.5 h-3.5" /> אשר</button>
                    <button onClick={() => doReview(a.id, false)} disabled={busy === a.id} aria-label="דחה" className="flex items-center gap-1 text-xs font-semibold px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-600 text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700 disabled:opacity-50"><X className="w-3.5 h-3.5" /></button>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* Assignment per upcoming game */}
      <div className="card overflow-hidden">
        <div className="px-4 py-3 border-b border-slate-100 dark:border-slate-700"><h3 className="text-sm font-bold text-slate-900 dark:text-white">שיבוץ {ROLE_PLURAL[role]} למשחקים קרובים</h3></div>
        <div className="p-3 space-y-2">
          {upcoming.length === 0 && <p className="text-center text-sm text-slate-400 py-6">אין משחקים קרובים</p>}
          {/* Grouped by game day, each fixture with time + rink (2026-11-09) — same as the apps. */}
          {upcoming.map((game, i) => {
            const day = dayHeader(game.game_date)
            const newDay = i === 0 || dayHeader(upcoming[i - 1].game_date) !== day
            return (
            <div key={game.id}>
              {newDay && <h4 className={`text-xs font-bold text-brand border-b border-slate-100 dark:border-slate-700 pb-1 mb-2 ${i ? "mt-4" : ""}`}>{day}</h4>}
            <div className="p-3 rounded-xl bg-slate-50 dark:bg-slate-800/50 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
              <div className="min-w-0">
                <span className="block text-sm font-semibold text-slate-900 dark:text-white truncate">{teamsMap[game.home_team_id]?.name || "?"} <span className="text-slate-400 font-normal">נגד</span> {teamsMap[game.away_team_id]?.name || "?"}</span>
                <span className="text-[11px] text-slate-400"><span dir="ltr">{format(ilDate(game.game_date), "HH:mm")}</span>{game.venue?.trim() ? ` · ${game.venue.trim()}` : ""}</span>
              </div>
              <RoleSlot game={game} />
            </div>
            </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}

/**
 * The people holding an official role, plus a name search to grant it. Writes go through
 * grant_official_role / revoke_official_role (official-role-grant.sql), which allow the
 * role's own manager (medic_manager → medic) and admin / LM — nobody else.
 */
function RoleHolders({ role, holders, onChange, onError }) {
  const [q, setQ] = useState("")
  const [results, setResults] = useState([])
  const [searching, setSearching] = useState(false)
  const [searchError, setSearchError] = useState(false)
  const [busy, setBusy] = useState(null)
  const label = OFFICIAL_ROLE_LABEL[role]

  useEffect(() => {
    const term = q.trim()
    if (term.length < 2) { setResults([]); setSearchError(false); return }
    let alive = true
    setSearching(true)
    const t = setTimeout(async () => {
      try { const r = await searchOfficialCandidates(role, term); if (alive) { setResults(r); setSearchError(false) } }
      catch (e) { if (alive) { setResults([]); setSearchError(true) } }
      finally { if (alive) setSearching(false) }
    }, 300)
    return () => { alive = false; clearTimeout(t) }
  }, [q, role])

  const grant = async (u) => {
    setBusy(u.user_id)
    try {
      await grantOfficialRole(u.user_id, role)
      setResults(rs => rs.map(r => r.user_id === u.user_id ? { ...r, has_role: true } : r))
      await onChange()
    } catch (e) { onError(e) } finally { setBusy(null) }
  }
  const revoke = async (h) => {
    if (!confirm(`להסיר את ${h.display_name || "המשתמש"} מתפקיד ${label}? שיבוצים קיימים למשחקים יישארו.`)) return
    setBusy(h.user_id)
    try {
      await revokeOfficialRole(h.user_id, role)
      setResults(rs => rs.map(r => r.user_id === h.user_id ? { ...r, has_role: false } : r))
      await onChange()
    } catch (e) { onError(e) } finally { setBusy(null) }
  }

  return (
    <div className="card p-4 space-y-3">
      <h3 className="text-sm font-bold text-slate-900 dark:text-white">{ROLE_PLURAL[role]} בליגה (<span className="tabular-nums">{holders.length}</span>)</h3>
      {holders.length === 0
        ? <p className="text-xs text-slate-400">עדיין אין {ROLE_PLURAL[role]}. חפשו משתמש למטה כדי להוסיף.</p>
        : (
          <div className="flex flex-wrap gap-1.5">
            {holders.map(h => (
              <span key={h.user_id} className="inline-flex items-center gap-1 text-xs font-semibold ps-2.5 pe-1 py-1 rounded-full bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-200">
                {h.display_name || "—"}
                <button onClick={() => revoke(h)} disabled={busy === h.user_id} aria-label={`הסר ${h.display_name || ""} מתפקיד ${label}`}
                  className="p-0.5 rounded-full text-slate-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 disabled:opacity-50"><X className="w-3.5 h-3.5" /></button>
              </span>
            ))}
          </div>
        )}
      <div>
        <label className="relative block">
          <span className="sr-only">חיפוש משתמש להוספה כ{label}</span>
          <Search className="absolute top-1/2 -translate-y-1/2 start-3 w-4 h-4 text-slate-400 pointer-events-none" />
          <input value={q} onChange={e => setQ(e.target.value)} placeholder={`הוספת ${label}: חפשו לפי שם…`}
            className="w-full text-sm bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-600 rounded-lg ps-9 pe-3 py-2 text-slate-800 dark:text-slate-100 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-brand/30" />
        </label>
        {q.trim().length >= 2 && (
          <div className="mt-2 space-y-1">
            {searching && results.length === 0 && <p className="text-xs text-slate-400 px-1">מחפש…</p>}
            {!searching && searchError && <p className="text-xs text-red-500 px-1">החיפוש נכשל. נסו שוב.</p>}
            {!searching && !searchError && results.length === 0 && <p className="text-xs text-slate-400 px-1">לא נמצאו משתמשים בשם הזה</p>}
            {results.map(u => (
              <div key={u.user_id} className="flex items-center justify-between gap-2 px-2.5 py-2 rounded-xl bg-slate-50 dark:bg-slate-800/50">
                <div className="min-w-0 text-sm">
                  <span className="font-semibold text-slate-800 dark:text-slate-200 truncate">{u.display_name || "—"}</span>
                  {u.player_name && u.player_name !== u.display_name && <span className="text-[11px] text-slate-400"> · שחקן: {u.player_name}</span>}
                </div>
                {u.has_role
                  ? <span className="shrink-0 flex items-center gap-1 text-xs font-semibold text-emerald-600 dark:text-emerald-400"><Check className="w-3.5 h-3.5" /> {label}</span>
                  : <button onClick={() => grant(u)} disabled={busy === u.user_id}
                      className="shrink-0 flex items-center gap-1 text-xs font-semibold px-2.5 py-1.5 rounded-lg bg-brand text-brand-fg hover:opacity-90 disabled:opacity-50"><Plus className="w-3.5 h-3.5" /> הפוך ל{label}</button>}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

/**
 * תעריפים ותשלומים — league manager / admin only (the medic and referee managers never
 * get this tab, and official_rates / officials_paylog refuse them in the DB anyway).
 * Per-role rates + the season's work/pay dashboard with CSV export and a copy-paste
 * payment template.
 */
export function OfficialsPayAdmin() {
  const [rates, setRates] = useState({ judge: 0, medic: 0 })
  const [paylog, setPaylog] = useState([])
  const [loading, setLoading] = useState(true)
  const [copied, setCopied] = useState(false)

  const load = async () => {
    setLoading(true)
    try {
      const [ra, pl] = await Promise.all([
        getOfficialRates().catch(() => ({ judge: 0, medic: 0 })),
        getOfficialsPaylog().catch(() => []),
      ])
      setRates(ra); setPaylog(pl)
    } finally { setLoading(false) }
  }
  useEffect(() => { load() }, [])

  const saveRate = async (role, val) => { try { await setOfficialRate(role, val); setRates(r => ({ ...r, [role]: Number(val) || 0 })) } catch { /* ignore */ } }

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

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <h2 className="flex items-center gap-2 text-lg font-bold text-slate-900 dark:text-white"><Coins className="w-5 h-5 text-brand" /> תעריפים ותשלומים</h2>
        <RefreshButton onClick={load} />
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

      {/* Pay dashboard */}
      <div className="card overflow-hidden">
        <div className="px-4 py-3 border-b border-slate-100 dark:border-slate-700 flex items-center justify-between gap-2 flex-wrap">
          <h3 className="text-sm font-bold text-slate-900 dark:text-white flex items-center gap-2"><Coins className="w-4 h-4 text-brand" /> תשלומים (משחקים שהסתיימו)</h3>
          <div className="flex items-center gap-1.5">
            <button onClick={copyTemplate} disabled={!paylog.length} className="flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-600 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700 disabled:opacity-40">
              {copied ? <ClipboardCheck className="w-4 h-4 text-emerald-500" /> : <Copy className="w-3.5 h-3.5" />} {copied ? "הועתק" : "העתק טקסט"}
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
