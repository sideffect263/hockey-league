import { useState, useEffect } from "react"
import { Loader2, LogOut, Plus, Check } from "lucide-react"
import { Clock, TeamsIcon } from "@/components/icons/BrandIcons"
import { getTeams } from "@/lib/api"
import { getMyJoinRequest, requestTeamJoin, cancelTeamJoin, leaveTeamById, getMyMemberships, joinErrorText } from "@/lib/teamMembership"
import { AGE_LABEL, DEFAULT_AGE, ageOf } from "@/lib/ageGroups"
import TeamLogo from "@/components/TeamLogo"

/**
 * Self-service team membership (multi-age). A linked player can hold ONE team per
 * age group (senior + u19/u17/u15). They request to join a team → the team's coach
 * (or an admin) approves, which ADDS that age-group membership (a same-age join
 * switches within that age group; other age groups are untouched). They can also
 * leave any one team. onChange() lets the parent refetch after a leave (which can
 * change players.team_id). Approval/leave go through the additive RPCs.
 */
const ageRank = (a) => (a === DEFAULT_AGE ? 0 : 1)

export default function TeamMembershipCard({ player, onChange }) {
  const [teams, setTeams] = useState([])
  const [memberships, setMemberships] = useState([])
  const [pending, setPending] = useState(null)
  const [picking, setPicking] = useState(false)
  const [teamId, setTeamId] = useState("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)

  const load = async () => {
    try {
      const [ts, p, ms] = await Promise.all([
        getTeams("name", true), getMyJoinRequest(), getMyMemberships(player?.id),
      ])
      setTeams(ts); setPending(p); setMemberships(ms)
    } catch { /* ignore */ }
  }
  useEffect(() => { load() }, [player?.id, player?.team_id])

  const myTeamIds = new Set(memberships.map(m => m.team_id))
  const choices = teams.filter(t => !myTeamIds.has(t.id))
  const sorted = [...memberships].sort((a, b) => ageRank(a.age_group) - ageRank(b.age_group))

  const doRequest = async () => {
    if (!teamId) return
    setBusy(true); setError(null)
    try { await requestTeamJoin(teamId); setPicking(false); setTeamId(""); await load() }
    catch (e) { setError(joinErrorText(e)) }
    finally { setBusy(false) }
  }
  const doCancel = async () => {
    if (!pending) return
    setBusy(true)
    try { await cancelTeamJoin(pending.id); await load() } catch { /* ignore */ } finally { setBusy(false) }
  }
  const doLeave = async (tid) => {
    setBusy(true)
    try { await leaveTeamById(tid); await load(); onChange?.() } catch { /* ignore */ } finally { setBusy(false) }
  }

  return (
    <div className="mt-3 pt-3 border-t border-slate-100 dark:border-slate-700/50 space-y-2">
      <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-500 dark:text-slate-400">
        <TeamsIcon className="w-4 h-4 text-brand" /> הקבוצות שלי
      </div>

      {/* Current memberships — one per age group */}
      {sorted.length > 0 ? (
        <div className="space-y-1">
          {sorted.map(m => (
            <div key={m.team_id} className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-1.5 min-w-0">
                <TeamLogo team={m.teams} size={5} />
                <span className="text-xs font-medium text-slate-700 dark:text-slate-200 truncate">{m.teams?.name}</span>
                {m.age_group && m.age_group !== DEFAULT_AGE && (
                  <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400">{AGE_LABEL[m.age_group]}</span>
                )}
              </div>
              <button onClick={() => doLeave(m.team_id)} disabled={busy}
                className="flex items-center gap-1 text-[11px] font-semibold text-slate-400 hover:text-red-500 transition-colors disabled:opacity-50 shrink-0">
                <LogOut className="w-3 h-3" /> עזוב
              </button>
            </div>
          ))}
        </div>
      ) : (
        !pending && <p className="text-xs text-slate-500 dark:text-slate-400">שחקן/ית חופשי/ה — לא משויכ/ת לקבוצה</p>
      )}

      {/* Pending request / request-to-join a (further) team */}
      {pending ? (
        <div className="flex items-center gap-2 text-xs text-amber-700 dark:text-amber-400">
          <Clock className="w-4 h-4 shrink-0" />
          <span className="flex-1 min-w-0">בקשת הצטרפות ל־<b>{pending.teams?.name || "קבוצה"}</b> ממתינה לאישור המאמן</span>
          <button onClick={doCancel} disabled={busy} className="font-semibold text-slate-400 hover:text-red-500 transition-colors shrink-0">ביטול</button>
        </div>
      ) : picking ? (
        <div className="flex items-center gap-2">
          <select value={teamId} onChange={e => setTeamId(e.target.value)}
            className="flex-1 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg px-2.5 py-1.5 text-xs text-slate-800 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-brand/30">
            <option value="">בחר/י קבוצה…</option>
            {choices.map(t => (
              <option key={t.id} value={t.id}>{t.name}{ageOf(t) !== DEFAULT_AGE ? ` · ${AGE_LABEL[ageOf(t)]}` : ""}</option>
            ))}
          </select>
          <button onClick={doRequest} disabled={!teamId || busy}
            className="flex items-center gap-1 text-xs font-semibold px-3 py-1.5 rounded-lg bg-brand text-white hover:bg-brand-hover transition-colors disabled:opacity-50">
            {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />} שלח בקשה
          </button>
          <button onClick={() => { setPicking(false); setTeamId("") }} className="text-xs font-semibold text-slate-400 hover:text-slate-600 px-1 shrink-0">ביטול</button>
        </div>
      ) : (
        <button onClick={() => setPicking(true)}
          className="flex items-center gap-1 text-xs font-semibold text-brand dark:text-brand-light hover:underline">
          <Plus className="w-3.5 h-3.5" /> בקשה להצטרף לקבוצה
        </button>
      )}
      {error && <p className="text-xs text-red-600 dark:text-red-400">{error}</p>}
    </div>
  )
}
