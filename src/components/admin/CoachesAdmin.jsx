import { useState, useEffect, useMemo } from "react"
import { getProfiles, getAllRoles, grantRole, revokeRole, moveRoleTeam } from "@/lib/roles"
import { X, Plus, RefreshCw, Check, Loader2, Search, Trash2, ArrowLeftRight } from "lucide-react"
import { ClipboardIcon as ClipboardList, Warning as AlertTriangle } from "@/components/icons/BrandIcons"
import TeamLogo from "@/components/TeamLogo"
import { SkeletonPanelRows } from "@/components/skeletons/PageSkeletons"

/**
 * Coaches tab — every team's coaches in one place. A coach is not a record of its
 * own: it is a user account holding a team-scoped `coach` row in user_roles (the
 * same row the תפקידים tab grants). So "add" = grant that row to a registered
 * account, "edit" = move it to another team, "delete" = revoke it — the account
 * itself is untouched. user_roles writes are admin-only under RLS, so this tab is
 * too.
 */
export default function CoachesAdmin({ teamsMap = {}, players = [] }) {
  const [profiles, setProfiles] = useState([])
  const [roles, setRoles] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)
  const [search, setSearch] = useState("")
  const [addForm, setAddForm] = useState(null) // { q, profileId, teamId }
  const [moveForm, setMoveForm] = useState(null) // { roleId, teamId }
  const [confirmRemove, setConfirmRemove] = useState(null) // role id pending removal

  const playersMap = useMemo(() => Object.fromEntries(players.map(p => [p.id, p])), [players])
  const profilesMap = useMemo(() => Object.fromEntries(profiles.map(p => [p.id, p])), [profiles])
  const teams = useMemo(() => Object.values(teamsMap).filter(Boolean)
    .sort((a, b) => (a.name || "").localeCompare(b.name || "", "he")), [teamsMap])

  const load = async () => {
    try {
      setLoading(true); setError(null)
      const [ps, rs] = await Promise.all([getProfiles(), getAllRoles()])
      setProfiles(ps); setRoles(rs)
    } catch { setError("שגיאה בטעינת המאמנים") }
    finally { setLoading(false) }
  }
  useEffect(() => { load() }, [])

  const coachRoles = useMemo(() => roles.filter(r => r.role === "coach"), [roles])

  const nameOf = (uid) => profilesMap[uid]?.display_name || "משתמש"
  const linkedPlayerOf = (uid) => {
    const pid = profilesMap[uid]?.player_id
    return pid ? playersMap[pid] : null
  }

  // Search matches a coach's name, linked player card, or team name.
  const matches = (r) => {
    const q = search.trim().toLowerCase()
    if (!q) return true
    const pl = linkedPlayerOf(r.user_id)
    const hay = `${nameOf(r.user_id)} ${pl ? `${pl.first_name} ${pl.last_name}` : ""} ${teamsMap[r.team_id]?.name || ""}`.toLowerCase()
    return hay.includes(q)
  }

  // team id -> its coach rows (filtered), each team sorted by coach name.
  const byTeam = useMemo(() => {
    const m = {}
    for (const r of coachRoles) {
      if (!matches(r)) continue
      ;(m[r.team_id] ||= []).push(r)
    }
    for (const k of Object.keys(m)) m[k].sort((a, b) => nameOf(a.user_id).localeCompare(nameOf(b.user_id), "he"))
    return m
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [coachRoles, search, profilesMap, playersMap, teamsMap])

  // While searching, hide teams with no matching coach; otherwise show every team
  // so a coachless one stands out.
  const shownTeams = search.trim() ? teams.filter(t => byTeam[t.id]?.length) : teams
  // Coach rows pointing at a team not in the list (deleted / not active).
  const orphans = coachRoles.filter(r => !teamsMap[r.team_id] && matches(r))
  const coachlessCount = teams.filter(t => !coachRoles.some(r => r.team_id === t.id)).length

  const addOptions = useMemo(() => {
    if (!addForm) return []
    const q = (addForm.q || "").trim().toLowerCase()
    return profiles
      .filter(p => !p.is_bot)
      .filter(p => {
        if (!q) return true
        const pl = p.player_id ? playersMap[p.player_id] : null
        return `${p.display_name || ""} ${pl ? `${pl.first_name} ${pl.last_name}` : ""}`.toLowerCase().includes(q)
      })
      .sort((a, b) => (a.display_name || "").localeCompare(b.display_name || "", "he"))
  }, [addForm, profiles, playersMap])

  const isCoachOf = (uid, teamId) => coachRoles.some(r => r.user_id === uid && r.team_id === teamId)

  const doAdd = async () => {
    if (!addForm?.profileId) { setError("יש לבחור משתמש"); return }
    if (!addForm.teamId) { setError("יש לבחור קבוצה"); return }
    if (isCoachOf(addForm.profileId, addForm.teamId)) { setError("המשתמש כבר מאמן בקבוצה הזו"); return }
    setBusy(true); setError(null)
    try {
      await grantRole(addForm.profileId, "coach", addForm.teamId)
      setAddForm(null); await load()
    } catch (e) {
      setError(e?.code === "23505" ? "המשתמש כבר מאמן בקבוצה הזו" : "שגיאה בהוספת המאמן")
    } finally { setBusy(false) }
  }

  const doMove = async () => {
    const r = coachRoles.find(x => x.id === moveForm?.roleId)
    if (!r || !moveForm.teamId || moveForm.teamId === r.team_id) { setMoveForm(null); return }
    if (isCoachOf(r.user_id, moveForm.teamId)) { setError("המשתמש כבר מאמן בקבוצה הזו"); return }
    setBusy(true); setError(null)
    try {
      await moveRoleTeam(r.id, moveForm.teamId)
      setMoveForm(null); await load()
    } catch (e) {
      setError(e?.code === "23505" ? "המשתמש כבר מאמן בקבוצה הזו" : "שגיאה בהעברת המאמן")
    } finally { setBusy(false) }
  }

  const doRemove = async (roleId) => {
    setBusy(true); setError(null)
    try { await revokeRole(roleId); setConfirmRemove(null); await load() }
    catch { setError("שגיאה בהסרת המאמן") }
    finally { setBusy(false) }
  }

  const openAdd = (teamId = "") => { setAddForm({ q: "", profileId: "", teamId }); setMoveForm(null); setError(null) }

  if (loading) return <SkeletonPanelRows />

  const coachRow = (r) => {
    const p = profilesMap[r.user_id]
    const pl = linkedPlayerOf(r.user_id)
    const name = nameOf(r.user_id)
    return (
      <div key={r.id} className="py-2.5 first:pt-0 last:pb-0">
        <div className="flex items-center gap-3">
          {p?.avatar_url
            ? <img src={p.avatar_url} alt="" className="w-8 h-8 rounded-full object-cover shrink-0" />
            : <div className="w-8 h-8 rounded-full bg-brand text-white flex items-center justify-center text-xs font-bold shrink-0">{name.charAt(0).toUpperCase()}</div>}
          <div className="min-w-0 flex-1">
            <p className="font-semibold text-sm text-slate-900 dark:text-white truncate">{name}</p>
            <p className="text-[11px] text-slate-500 dark:text-slate-400 truncate">{pl ? `משויך ל${pl.first_name} ${pl.last_name}` : "ללא שיוך שחקן"}</p>
          </div>
          <button onClick={() => { setMoveForm(moveForm?.roleId === r.id ? null : { roleId: r.id, teamId: r.team_id || "" }); setConfirmRemove(null); setError(null) }}
            title="העברה לקבוצה אחרת"
            className="shrink-0 p-2 rounded-lg text-slate-400 hover:text-brand hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors">
            <ArrowLeftRight className="w-4 h-4" />
          </button>
          <button onClick={() => { setConfirmRemove(confirmRemove === r.id ? null : r.id); setMoveForm(null); setError(null) }}
            title="הסרת מאמן"
            className="shrink-0 p-2 rounded-lg text-slate-300 dark:text-slate-600 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-950/30 transition-colors">
            <Trash2 className="w-4 h-4" />
          </button>
        </div>

        {moveForm?.roleId === r.id && (
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <select value={moveForm.teamId} onChange={e => setMoveForm(f => ({ ...f, teamId: e.target.value }))} className="filter-select text-xs py-1.5 flex-1 min-w-[10rem]">
              {teams.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
            <button onClick={doMove} disabled={busy} className="flex items-center gap-1 text-xs font-semibold px-3 py-1.5 rounded-lg bg-emerald-500 text-white hover:bg-emerald-600 disabled:opacity-50 transition-colors">
              {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />} העבר
            </button>
            <button onClick={() => setMoveForm(null)} className="text-xs font-semibold px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-600 text-slate-500 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors">ביטול</button>
          </div>
        )}

        {confirmRemove === r.id && (
          <div className="mt-2 flex items-center justify-between gap-2 flex-wrap">
            <span className="text-xs font-medium text-red-600 dark:text-red-400">להסיר את {name} מאימון {teamsMap[r.team_id]?.name || "הקבוצה"}? החשבון נשאר, רק הרשאות המאמן יוסרו.</span>
            <div className="flex items-center gap-2">
              <button onClick={() => doRemove(r.id)} disabled={busy}
                className="flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-lg bg-red-500 text-white hover:bg-red-600 transition-colors disabled:opacity-50">
                {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />} הסר
              </button>
              <button onClick={() => setConfirmRemove(null)} disabled={busy}
                className="text-xs font-semibold px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-600 text-slate-500 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors">ביטול</button>
            </div>
          </div>
        )}
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 text-lg font-bold text-slate-900 dark:text-white">
            <ClipboardList className="w-5 h-5 text-brand" /> מאמנים
          </h2>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-0.5">
            {coachRoles.length} מאמנים ב־{new Set(coachRoles.map(r => r.team_id)).size} קבוצות. מאמן הוא משתמש רשום עם הרשאת מאמן לקבוצה.
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <button onClick={() => openAdd()} className="flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-lg bg-brand text-white hover:opacity-90 transition-opacity">
            <Plus className="w-3.5 h-3.5" /> הוסף מאמן
          </button>
          <button onClick={load} className="flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-600 text-slate-500 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors">
            <RefreshCw className="w-3.5 h-3.5" /> רענון
          </button>
        </div>
      </div>

      {error && (
        <div className="card p-3 border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-950/30 text-sm text-red-700 dark:text-red-400">{error}</div>
      )}

      {addForm && (
        <div className="card p-4 space-y-2">
          <p className="text-sm font-bold text-slate-900 dark:text-white">הוספת מאמן</p>
          <p className="text-[11px] text-slate-500 dark:text-slate-400">בחר משתמש רשום וקבוצה. משתמש שעוד לא נרשם לאתר צריך להירשם קודם.</p>
          <div className="flex flex-wrap items-center gap-2">
            <input type="text" value={addForm.q} onChange={e => setAddForm(f => ({ ...f, q: e.target.value }))}
              placeholder="סינון משתמשים..." className="filter-input text-xs py-1.5 flex-1 min-w-[9rem]" />
            <select value={addForm.profileId} onChange={e => setAddForm(f => ({ ...f, profileId: e.target.value }))} className="filter-select text-xs py-1.5 flex-1 min-w-[11rem]">
              <option value="">בחר משתמש</option>
              {addOptions.map(p => {
                const pl = p.player_id ? playersMap[p.player_id] : null
                return <option key={p.id} value={p.id}>{p.display_name || "משתמש"}{pl ? ` · ${pl.first_name} ${pl.last_name}` : ""}</option>
              })}
            </select>
            <select value={addForm.teamId} onChange={e => setAddForm(f => ({ ...f, teamId: e.target.value }))} className="filter-select text-xs py-1.5 flex-1 min-w-[9rem]">
              <option value="">בחר קבוצה</option>
              {teams.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
            <button onClick={doAdd} disabled={busy} className="flex items-center gap-1 text-xs font-semibold px-3 py-1.5 rounded-lg bg-emerald-500 text-white hover:bg-emerald-600 disabled:opacity-50 transition-colors">
              {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />} הוסף
            </button>
            <button onClick={() => { setAddForm(null); setError(null) }} className="text-xs font-semibold px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-600 text-slate-500 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors">ביטול</button>
          </div>
          {addOptions.length === 0 && <p className="text-[11px] text-slate-500 dark:text-slate-400">לא נמצאו משתמשים תואמים</p>}
        </div>
      )}

      <div className="relative">
        <Search className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none" />
        <input type="text" value={search} onChange={e => setSearch(e.target.value)}
          placeholder="חיפוש מאמן או קבוצה..." className="filter-input w-full pr-9" />
      </div>

      {!search.trim() && coachlessCount > 0 && (
        <div className="flex items-center gap-2 text-xs font-medium text-amber-700 dark:text-amber-400">
          <AlertTriangle className="w-4 h-4" /> {coachlessCount === 1 ? "קבוצה אחת ללא מאמן" : `${coachlessCount} קבוצות ללא מאמן`}
        </div>
      )}

      {shownTeams.length === 0 && orphans.length === 0 ? (
        <div className="card p-8 text-center text-sm text-slate-500 dark:text-slate-400">לא נמצאו מאמנים תואמים</div>
      ) : (
        <div className="space-y-2.5">
          {shownTeams.map(t => {
            const list = byTeam[t.id] || []
            return (
              <div key={t.id} className="card p-4">
                <div className="flex items-center gap-2 mb-3">
                  <TeamLogo team={t} size={7} />
                  <p className="font-bold text-sm text-slate-900 dark:text-white flex-1 truncate">{t.name}</p>
                  <span className="text-[11px] text-slate-500 dark:text-slate-400">{list.length ? `${list.length} מאמנים` : ""}</span>
                  <button onClick={() => openAdd(t.id)} title="הוסף מאמן לקבוצה"
                    className="inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-1 rounded-lg border border-dashed border-slate-300 dark:border-slate-600 text-slate-500 dark:text-slate-400 hover:border-brand hover:text-brand transition-colors">
                    <Plus className="w-3 h-3" /> הוסף
                  </button>
                </div>
                {list.length === 0
                  ? <p className="flex items-center gap-1.5 text-xs text-amber-700 dark:text-amber-400"><AlertTriangle className="w-4 h-4" /> אין מאמן לקבוצה</p>
                  : <div className="divide-y divide-slate-100 dark:divide-slate-700">{list.map(coachRow)}</div>}
              </div>
            )
          })}
          {orphans.length > 0 && (
            <div className="card p-4">
              <p className="flex items-center gap-2 font-bold text-sm text-slate-900 dark:text-white mb-3">
                <X className="w-4 h-4 text-slate-400" /> קבוצה לא פעילה או לא קיימת
              </p>
              <div className="divide-y divide-slate-100 dark:divide-slate-700">{orphans.map(coachRow)}</div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
