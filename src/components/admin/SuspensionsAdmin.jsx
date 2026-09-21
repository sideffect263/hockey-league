import { useState, useEffect, useMemo } from "react"
import { getActiveSuspensions, issueSuspension, clearSuspension } from "@/lib/suspensions"
import { Ban, RefreshCw, Plus, Undo2, Loader2 } from "lucide-react"
import { format } from "date-fns"
import { SkeletonPanelRows } from "@/components/skeletons/PageSkeletons"

/**
 * Red-card blocks — league manager / admin (sheet rows 5 + 15).
 *
 * The judge issues one from the game engine as it happens; this is the manager's side:
 * give a card after the fact, see who is currently blocked, and lift one that was given
 * in error. Deliberately manual — the decision was that nothing is derived from the
 * scoresheet automatically.
 *
 * Serving is automatic: a block burns one game when a game the player's team plays
 * completes, and clears itself at zero. Nobody has to remember to lift it.
 */
export default function SuspensionsAdmin({ players = [], teamsMap = {} }) {
  const [rows, setRows] = useState(null)
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(null)
  const [adding, setAdding] = useState(false)
  const [playerId, setPlayerId] = useState("")
  const [reason, setReason] = useState("")

  const load = async () => {
    try { setError(null); setRows(await getActiveSuspensions()) }
    catch { setError("שגיאה בטעינת ההרחקות"); setRows([]) }
  }
  useEffect(() => { load() }, [])

  const blockedIds = useMemo(() => new Set((rows || []).map(r => r.player_id)), [rows])
  const options = useMemo(() => [...players]
    .filter(p => !blockedIds.has(p.id))
    .sort((a, b) => `${a.first_name} ${a.last_name}`.localeCompare(`${b.first_name} ${b.last_name}`, "he")),
    [players, blockedIds])

  const submit = async (e) => {
    e.preventDefault()
    if (!playerId) { setError("יש לבחור שחקן"); return }
    setBusy("new"); setError(null)
    try {
      await issueSuspension(playerId, { reason: reason.trim() || null })
      setPlayerId(""); setReason(""); setAdding(false)
      await load()
    } catch (e2) { setError(e2.message) } finally { setBusy(null) }
  }

  const lift = async (id) => {
    setBusy(id); setError(null)
    try { await clearSuspension(id); await load() }
    catch (e2) { setError(e2.message) } finally { setBusy(null) }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <h2 className="flex items-center gap-2 text-lg font-bold text-slate-900 dark:text-white">
          <Ban className="w-5 h-5 text-brand" /> הרחקות (כרטיס אדום)
        </h2>
        <div className="flex items-center gap-2">
          <button onClick={() => setAdding(a => !a)}
            className="flex items-center gap-1.5 text-xs font-bold px-3 py-1.5 rounded-lg bg-brand text-brand-fg hover:bg-brand-hover transition-colors">
            <Plus className="w-3.5 h-3.5" /> הרחקת שחקן
          </button>
          <button onClick={load} className="flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-600 text-slate-500 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors">
            <RefreshCw className="w-3.5 h-3.5" /> רענון
          </button>
        </div>
      </div>

      <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed">
        שחקן מורחק אינו יכול להירשם למשחק הבא של קבוצתו. ההרחקה נמחקת מעצמה לאחר משחק
        אחד — אין צורך לבטל אותה ידנית.
      </p>

      {error && <div className="card p-3 border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-950/30 text-sm text-red-700 dark:text-red-400">{error}</div>}

      {adding && (
        <form onSubmit={submit} className="card p-4 space-y-2.5">
          <select value={playerId} onChange={e => setPlayerId(e.target.value)} aria-label="בחירת שחקן"
            className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg px-2.5 py-2 text-sm text-slate-800 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-brand/30">
            <option value="">בחר שחקן…</option>
            {options.map(p => (
              <option key={p.id} value={p.id}>
                {p.first_name} {p.last_name}{teamsMap[p.team_id]?.name ? ` · ${teamsMap[p.team_id].name}` : ""}
              </option>
            ))}
          </select>
          <input value={reason} onChange={e => setReason(e.target.value)} maxLength={120}
            placeholder="סיבה (מוצגת לשחקן כשהוא מנסה להירשם)" aria-label="סיבת ההרחקה"
            className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg px-2.5 py-2 text-sm text-slate-800 dark:text-slate-100 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-brand/30" />
          <div className="flex items-center gap-2">
            <button type="submit" disabled={busy === "new" || !playerId}
              className="flex items-center gap-1.5 text-xs font-bold px-3 py-1.5 rounded-lg bg-red-500 text-white hover:bg-red-600 transition-colors disabled:opacity-40 disabled:cursor-not-allowed">
              {busy === "new" ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Ban className="w-3.5 h-3.5" />} הרחק למשחק אחד
            </button>
            <button type="button" onClick={() => { setAdding(false); setError(null) }}
              className="text-xs font-semibold px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-600 text-slate-500 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors">
              ביטול
            </button>
          </div>
        </form>
      )}

      {rows === null ? (
        <SkeletonPanelRows />
      ) : rows.length === 0 ? (
        <p className="text-center text-sm text-slate-500 dark:text-slate-400 py-10">אין הרחקות פעילות</p>
      ) : (
        <div className="space-y-2.5">
          {rows.map(r => (
            <div key={r.id} className="card p-4 flex items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="text-sm font-bold text-slate-900 dark:text-white truncate">
                  {r.first_name} {r.last_name}
                </p>
                <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
                  {r.team_name || "—"} · הורחק ב־{format(new Date(r.created_at), "d/M/yy")}
                  {r.games_remaining > 1 ? ` · ${r.games_remaining} משחקים` : " · משחק אחד"}
                </p>
                {r.reason && <p className="text-xs text-slate-500 dark:text-slate-400 mt-1 italic">"{r.reason}"</p>}
              </div>
              <button onClick={() => lift(r.id)} disabled={busy === r.id}
                title="ביטול ההרחקה (למשל אם הכרטיס ניתן בטעות)"
                className="shrink-0 flex items-center gap-1.5 text-xs font-semibold px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-600 text-slate-500 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors disabled:opacity-50">
                {busy === r.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Undo2 className="w-3.5 h-3.5" />} ביטול
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
