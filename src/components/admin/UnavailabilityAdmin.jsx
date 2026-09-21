import { useState, useEffect, useMemo } from "react"
import {
  getUnavailability, reportUnavailability, decideUnavailability, clearUnavailability,
  unavailabilityState, UNAVAILABILITY_KINDS, KIND_LABEL, todayISO,
} from "@/lib/unavailability"
import { CalendarOff, RefreshCw, Plus, Check, X, Undo2, Loader2, Clock } from "lucide-react"
import { format } from "date-fns"
import { SkeletonPanelRows } from "@/components/skeletons/PageSkeletons"

/**
 * Player availability constraints — coach / league manager / admin.
 *
 * Built on SuspensionsAdmin, because a red card and an injury are the same shape of
 * "this player is blocked" and the registration gates treat them alike. The one thing
 * a suspension has no equivalent of is the approval queue: a player can self-report,
 * and that report sits at 'pending' — doing nothing to his eligibility — until his
 * coach or a manager rules on it. So the queue leads the page.
 *
 * Scoping needs no code here: the table's RLS SELECT policy already gives a coach his
 * own squad (every age group he coaches) and a manager everything.
 */

const STATE_CFG = {
  pending:  { label: "ממתין להחלטה", cls: "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300" },
  active:   { label: "בתוקף", cls: "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300" },
  upcoming: { label: "עתידי", cls: "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300" },
  ended:    { label: "הסתיים", cls: "bg-slate-100 text-slate-600 dark:bg-slate-700 dark:text-slate-300" },
  rejected: { label: "נדחה / בוטל", cls: "bg-slate-100 text-slate-500 dark:bg-slate-700 dark:text-slate-400" },
}

// Defined at module scope on purpose: a component declared inside the render body is a
// new type on every render, so a text input inside it unmounts and loses focus on each
// keystroke — which is exactly what these two notes are.
function NoteInput({ value, onChange, placeholder }) {
  return (
    <input value={value} onChange={e => onChange(e.target.value)} maxLength={200}
      placeholder={placeholder} aria-label={placeholder}
      className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg px-2.5 py-1.5 text-xs text-slate-800 dark:text-slate-100 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-brand/30" />
  )
}

const d = (v) => (v ? format(new Date(v), "d/M/yy") : "")
// Dates read LTR inside an RTL line — keep the whole run together (RTL bidi gotcha).
const Span = ({ row }) => (
  <span dir="ltr" className="tabular-nums">
    {row.ends_on ? `${d(row.starts_on)} – ${d(row.ends_on)}` : `${d(row.starts_on)} →`}
  </span>
)

export default function UnavailabilityAdmin({ players = [], teamsMap = {}, membersByPlayer = new Map(), coachTeamIds = null }) {
  const coachScoped = Array.isArray(coachTeamIds) && coachTeamIds.length > 0
  const [rows, setRows] = useState(null)
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(null)
  const [filter, setFilter] = useState("open")     // open | all (pending has its own queue)
  const [adding, setAdding] = useState(false)
  const [notes, setNotes] = useState({})           // row id -> decision / clearing note
  const [form, setForm] = useState({ playerId: "", kind: "injury", startsOn: todayISO(), endsOn: "", reason: "" })

  const load = async () => {
    try { setError(null); setRows(await getUnavailability()) }
    catch { setError("שגיאה בטעינת ההיעדרויות"); setRows([]) }
  }
  useEffect(() => { load() }, [])

  // The player picker is scoped in the client (a coach's own squad, primary card or any
  // multi-age membership) purely so the list is usable — the RPC refuses anyone else.
  const options = useMemo(() => players
    .filter(p => !coachScoped || (
      coachTeamIds.includes(p.team_id) ||
      (membersByPlayer.get(p.id) || []).some(m => coachTeamIds.includes(m.team_id))
    ))
    .sort((a, b) => `${a.first_name} ${a.last_name}`.localeCompare(`${b.first_name} ${b.last_name}`, "he")),
    [players, coachScoped, coachTeamIds, membersByPlayer])

  const decorated = useMemo(() => (rows || []).map(r => ({ ...r, state: unavailabilityState(r) })), [rows])
  const pending = decorated.filter(r => r.state === "pending")
  // The queue above owns the pending rows; the list below is everything already decided,
  // so nothing appears twice.
  const decided = decorated.filter(r => r.state !== "pending")
  const counts = {
    open: decided.filter(r => ["active", "upcoming"].includes(r.state)).length,
    all: decided.length,
  }
  const shown = filter === "open"
    ? decided.filter(r => ["active", "upcoming"].includes(r.state))
    : decided

  const run = async (id, fn) => {
    setBusy(id); setError(null)
    try { await fn(); setNotes(n => ({ ...n, [id]: "" })); await load() }
    catch (e) { setError(e.message) } finally { setBusy(null) }
  }

  const submit = async (e) => {
    e.preventDefault()
    if (!form.playerId) { setError("יש לבחור שחקן"); return }
    if (!form.startsOn) { setError("יש לבחור תאריך התחלה"); return }
    setBusy("new"); setError(null)
    try {
      await reportUnavailability({
        playerId: form.playerId, kind: form.kind, startsOn: form.startsOn,
        endsOn: form.endsOn || null, reason: form.reason.trim() || null,
      })
      setForm({ playerId: "", kind: "injury", startsOn: todayISO(), endsOn: "", reason: "" })
      setAdding(false)
      await load()
    } catch (e2) { setError(e2.message) } finally { setBusy(null) }
  }

  const FilterBtn = ({ id, label, n }) => (
    <button onClick={() => setFilter(id)}
      className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${filter === id ? "bg-brand text-brand-fg" : "bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 hover:bg-slate-200 dark:hover:bg-slate-700"}`}>
      {label}{n != null ? ` (${n})` : ""}
    </button>
  )

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <h2 className="flex items-center gap-2 text-lg font-bold text-slate-900 dark:text-white">
          <CalendarOff className="w-5 h-5 text-brand" /> היעדרויות שחקנים
        </h2>
        <div className="flex items-center gap-2">
          <button onClick={() => setAdding(a => !a)}
            className="flex items-center gap-1.5 text-xs font-bold px-3 py-1.5 rounded-lg bg-brand text-brand-fg hover:bg-brand-hover transition-colors">
            <Plus className="w-3.5 h-3.5" /> דיווח היעדרות
          </button>
          <button onClick={load} className="flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-600 text-slate-500 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors">
            <RefreshCw className="w-3.5 h-3.5" /> רענון
          </button>
        </div>
      </div>

      <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed">
        פציעה, שהות בחו״ל או מילואים — שחקן בהיעדרות מאושרת אינו נרשם למשחקים בטווח
        התאריכים. דיווח שהשחקן שלח בעצמו ממתין לאישורך ואינו משפיע על זמינותו עד שתחליט/י.
        היעדרות שנפתחה ללא תאריך סיום נמשכת עד שמסיימים אותה כאן.
      </p>

      {error && <div className="card p-3 border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-950/30 text-sm text-red-700 dark:text-red-400">{error}</div>}

      {adding && (
        <form onSubmit={submit} className="card p-4 space-y-2.5">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
            <div>
              <label className="text-xs font-semibold text-slate-500 dark:text-slate-400 mb-1 block">שחקן</label>
              <select value={form.playerId} onChange={e => setForm({ ...form, playerId: e.target.value })}
                className="filter-select w-full">
                <option value="">בחר שחקן…</option>
                {options.map(p => (
                  <option key={p.id} value={p.id}>
                    {p.first_name} {p.last_name}{teamsMap[p.team_id]?.name ? ` · ${teamsMap[p.team_id].name}` : ""}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-xs font-semibold text-slate-500 dark:text-slate-400 mb-1 block">סוג</label>
              <select value={form.kind} onChange={e => setForm({ ...form, kind: e.target.value })} className="filter-select w-full">
                {UNAVAILABILITY_KINDS.map(k => <option key={k.value} value={k.value}>{k.label}</option>)}
              </select>
            </div>
            <div>
              <label className="text-xs font-semibold text-slate-500 dark:text-slate-400 mb-1 block">מתאריך</label>
              <input type="date" dir="ltr" value={form.startsOn} onChange={e => setForm({ ...form, startsOn: e.target.value })}
                className="filter-input w-full tabular-nums" />
            </div>
            <div>
              <label className="text-xs font-semibold text-slate-500 dark:text-slate-400 mb-1 block">עד תאריך</label>
              {/* Optional on purpose — an injury rarely comes with a return date on day
                  one, and an invented one either blocks the player too long or lets him
                  back too early. Leave it empty and end the absence when he is fit. */}
              <input type="date" dir="ltr" value={form.endsOn} min={form.startsOn}
                onChange={e => setForm({ ...form, endsOn: e.target.value })}
                className="filter-input w-full tabular-nums" />
              <p className="text-[10px] text-slate-400 mt-1">ריק = ללא תאריך סיום</p>
            </div>
          </div>
          <input value={form.reason} onChange={e => setForm({ ...form, reason: e.target.value })} maxLength={200}
            placeholder="פירוט (לא חובה)" aria-label="פירוט ההיעדרות"
            className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg px-2.5 py-2 text-sm text-slate-800 dark:text-slate-100 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-brand/30" />
          <div className="flex items-center gap-2">
            <button type="submit" disabled={busy === "new" || !form.playerId || !form.startsOn}
              className="flex items-center gap-1.5 text-xs font-bold px-3 py-1.5 rounded-lg bg-brand text-brand-fg hover:bg-brand-hover transition-colors disabled:opacity-40 disabled:cursor-not-allowed">
              {busy === "new" ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />} רישום ההיעדרות
            </button>
            <button type="button" onClick={() => { setAdding(false); setError(null) }}
              className="text-xs font-semibold px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-600 text-slate-500 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors">
              ביטול
            </button>
          </div>
        </form>
      )}

      {/* Approval queue — self-reports waiting on a decision. Leads the page because
          nothing happens to the player's eligibility until someone rules on it. */}
      {pending.length > 0 && (
        <div className="space-y-2.5">
          <h3 className="flex items-center gap-1.5 text-sm font-bold text-slate-900 dark:text-white">
            <Clock className="w-4 h-4 text-amber-500" /> ממתינות להחלטה ({pending.length})
          </h3>
          {pending.map(r => (
            <div key={r.id} className="card p-4 space-y-2.5 border-amber-200 dark:border-amber-800 bg-amber-50/50 dark:bg-amber-950/20">
              <div>
                <p className="text-sm font-bold text-slate-900 dark:text-white">
                  {r.first_name} {r.last_name}
                  <span className="text-slate-400 font-semibold"> · {KIND_LABEL[r.kind] || r.kind}</span>
                </p>
                <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
                  {teamsMap[r.team_id]?.name || "—"} · <Span row={r} />
                </p>
                {r.reason && <p className="text-xs text-slate-500 dark:text-slate-400 mt-1 italic">"{r.reason}"</p>}
              </div>
              <NoteInput value={notes[r.id] || ""} onChange={v => setNotes(n => ({ ...n, [r.id]: v }))}
                placeholder="הערה לשחקן (לא חובה) — תישלח אליו עם ההחלטה" />
              <div className="flex items-center gap-2">
                <button onClick={() => run(r.id, () => decideUnavailability(r.id, true, notes[r.id]))} disabled={busy === r.id}
                  className="flex items-center gap-1.5 text-xs font-bold px-3 py-1.5 rounded-lg bg-emerald-500 text-white hover:bg-emerald-600 transition-colors disabled:opacity-40">
                  {busy === r.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />} אישור
                </button>
                <button onClick={() => run(r.id, () => decideUnavailability(r.id, false, notes[r.id]))} disabled={busy === r.id}
                  className="flex items-center gap-1.5 text-xs font-bold px-3 py-1.5 rounded-lg border border-red-200 dark:border-red-800 text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/30 transition-colors disabled:opacity-40">
                  <X className="w-3.5 h-3.5" /> דחייה
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="flex items-center gap-2 flex-wrap">
        <FilterBtn id="open" label="בתוקף ועתידיות" n={counts.open} />
        <FilterBtn id="all" label="כולל היסטוריה" n={counts.all} />
      </div>

      {rows === null ? (
        <SkeletonPanelRows />
      ) : shown.length === 0 ? (
        <p className="text-center text-sm text-slate-500 dark:text-slate-400 py-10">
          {filter === "open" ? "אין היעדרויות פעילות" : "אין היעדרויות להצגה"}
        </p>
      ) : (
        <div className="space-y-2.5">
          {shown.map(r => {
            const cfg = STATE_CFG[r.state]
            // An absence can be ended only while it still means something: one already
            // over, rejected or retracted has nothing left to end.
            const canClear = ["active", "upcoming"].includes(r.state)
            return (
              <div key={r.id} className="card p-4 space-y-2">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-sm font-bold text-slate-900 dark:text-white truncate">
                      {r.first_name} {r.last_name}
                      <span className="text-slate-400 font-semibold"> · {KIND_LABEL[r.kind] || r.kind}</span>
                    </p>
                    <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
                      {teamsMap[r.team_id]?.name || "—"} · <Span row={r} />
                      {!r.ends_on && r.state === "active" && " · ללא תאריך סיום"}
                    </p>
                    {r.reason && <p className="text-xs text-slate-500 dark:text-slate-400 mt-1 italic">"{r.reason}"</p>}
                    {r.decision_note && <p className="text-[11px] text-slate-400 mt-1">הערת החלטה: {r.decision_note}</p>}
                  </div>
                  <span className={`shrink-0 text-[11px] font-bold px-2 py-0.5 rounded ${cfg.cls}`}>{cfg.label}</span>
                </div>
                {canClear && (
                  <div className="flex items-center gap-2">
                    <div className="flex-1 min-w-0">
                      <NoteInput value={notes[r.id] || ""} onChange={v => setNotes(n => ({ ...n, [r.id]: v }))}
                        placeholder="סיבת הסיום (לא חובה)" />
                    </div>
                    <button onClick={() => run(r.id, () => clearUnavailability(r.id, notes[r.id]))} disabled={busy === r.id}
                      title={r.state === "upcoming" ? "ביטול ההיעדרות לפני שהחלה" : "סיום ההיעדרות מהיום"}
                      className="shrink-0 flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-600 text-slate-500 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors disabled:opacity-50">
                      {busy === r.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Undo2 className="w-3.5 h-3.5" />}
                      {r.state === "upcoming" ? "ביטול" : "סיום"}
                    </button>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
