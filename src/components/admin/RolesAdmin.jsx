import { useState, useEffect, useMemo } from "react"
import { getProfiles, getAllRoles, grantRole, revokeRole, deleteUser, linkPlayer, GRANTABLE_ROLES, ROLE_LABEL, TEAM_SCOPED } from "@/lib/roles"
import { Award, X, Plus, RefreshCw, Check, Loader2, Search, Trash2, Link2, Link2Off } from "lucide-react"
import { useAuth } from "@/lib/AuthContext"
import { SortBar, sortItems } from "@/components/admin/SortBar"
import { SkeletonPanelRows } from "@/components/skeletons/PageSkeletons"

const ROLE_SORT_OPTIONS = [
  { key: "name", label: "שם", dir: "asc" },
  { key: "roles", label: "מספר תפקידים", dir: "desc" },
]

/**
 * Admin UI to grant/revoke user roles (player / coach / content_editor / judge),
 * team-scoped for coach & player, and to link a user account to a player card
 * (admin_link_player — the admin-initiated counterpart to the claim queue, for
 * the player who never files a claim). This is what makes the role tiers actually apply
 * — e.g. granting `judge` lets a non-admin run the live scoreboard. Self-contained;
 * `teamsMap`/`players` are only for names + team scoping.
 */
export default function RolesAdmin({ teamsMap = {}, players = [] }) {
  const { user } = useAuth()
  const [profiles, setProfiles] = useState([])
  const [roles, setRoles] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)
  const [form, setForm] = useState(null) // { profileId, role, teamId }
  const [search, setSearch] = useState("")
  const [sort, setSort] = useState({ key: "name", dir: "asc" })
  const [confirmDelete, setConfirmDelete] = useState(null) // profile id pending deletion
  const [linkForm, setLinkForm] = useState(null) // { profileId, q, playerId }

  const playersMap = useMemo(() => Object.fromEntries(players.map(p => [p.id, p])), [players])
  const teams = useMemo(() => Object.values(teamsMap).filter(Boolean), [teamsMap])

  // player id -> the profile that already owns that card. profiles.player_id is
  // UNIQUE, so a taken card is offered disabled rather than silently failing.
  const ownerOf = useMemo(() => {
    const m = {}
    for (const p of profiles) if (p.player_id) m[p.player_id] = p
    return m
  }, [profiles])

  const playerLabel = (pl) => {
    const parts = [`${pl.first_name} ${pl.last_name}`]
    if (pl.jersey_number != null && pl.jersey_number !== "") parts.push(`#${pl.jersey_number}`)
    const team = teamsMap[pl.team_id]?.name
    if (team) parts.push(team)
    return parts.join(" · ")
  }

  // Options for the open link picker: name/team text filter, Hebrew-aware sort.
  const linkOptions = useMemo(() => {
    if (!linkForm) return []
    const q = (linkForm.q || "").trim().toLowerCase()
    const list = players.filter(pl => {
      if (!q) return true
      const hay = `${pl.first_name} ${pl.last_name} ${teamsMap[pl.team_id]?.name || ""} ${pl.jersey_number ?? ""}`.toLowerCase()
      return hay.includes(q)
    })
    return [...list].sort((a, b) =>
      `${a.first_name} ${a.last_name}`.localeCompare(`${b.first_name} ${b.last_name}`, "he"))
  }, [linkForm, players, teamsMap])

  // Filter by display name or the linked player's name.
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return profiles
    return profiles.filter(p => {
      const linked = p.player_id ? playersMap[p.player_id] : null
      const hay = `${p.display_name || ""} ${linked ? `${linked.first_name} ${linked.last_name}` : ""}`.toLowerCase()
      return hay.includes(q)
    })
  }, [profiles, search, playersMap])

  const load = async () => {
    try {
      setLoading(true); setError(null)
      const [ps, rs] = await Promise.all([getProfiles(), getAllRoles()])
      setProfiles(ps); setRoles(rs)
    } catch { setError("שגיאה בטעינת המשתמשים") }
    finally { setLoading(false) }
  }
  useEffect(() => { load() }, [])

  const rolesFor = (uid) => roles.filter(r => r.user_id === uid)

  const sorted = sortItems(filtered, sort, {
    name: p => p.display_name || "",
    roles: p => rolesFor(p.id).length,
  })

  const doGrant = async () => {
    if (!form?.role) return
    if (TEAM_SCOPED.has(form.role) && form.role === "coach" && !form.teamId) { setError("יש לבחור קבוצה למאמן"); return }
    setBusy(true); setError(null)
    try {
      await grantRole(form.profileId, form.role, form.teamId || null)
      setForm(null); await load()
    } catch (e) {
      setError(e?.code === "23505" ? "התפקיד כבר מוענק" : "שגיאה בהענקת התפקיד")
    } finally { setBusy(false) }
  }

  const doRevoke = async (id) => {
    setBusy(true); setError(null)
    try { await revokeRole(id); await load() }
    catch { setError("שגיאה בהסרת התפקיד") }
    finally { setBusy(false) }
  }

  const doDelete = async (id) => {
    setBusy(true); setError(null)
    try { await deleteUser(id); setConfirmDelete(null); await load() }
    catch (e) {
      setError(
        e?.message === "cannot-delete-admin" ? "אי אפשר למחוק חשבון מנהל"
          : e?.message === "cannot-delete-self" ? "אי אפשר למחוק את החשבון שלך"
          : "שגיאה במחיקת המשתמש"
      )
    } finally { setBusy(false) }
  }

  const linkErrorMessage = (e) => (
    e?.message === "player-already-linked" ? "השחקן כבר משויך לחשבון אחר"
      : e?.message === "not-authorized" ? "אין לך הרשאה לשייך שחקן"
        : e?.message === "player-not-found" ? "השחקן לא נמצא"
          : "שגיאה בשיוך השחקן"
  )

  const doLink = async () => {
    if (!linkForm?.playerId) { setError("יש לבחור שחקן"); return }
    setBusy(true); setError(null)
    try {
      await linkPlayer(linkForm.profileId, linkForm.playerId)
      setLinkForm(null); await load()
    } catch (e) { setError(linkErrorMessage(e)) }
    finally { setBusy(false) }
  }

  const doUnlink = async (profileId) => {
    setBusy(true); setError(null)
    try {
      // null = unlink. The player CARD survives; only the account link and the
      // 'player' role it granted go away.
      await linkPlayer(profileId, null)
      setLinkForm(null); await load()
    } catch (e) { setError(linkErrorMessage(e)) }
    finally { setBusy(false) }
  }

  const openForm = (p) => {
    // default a player grant to the linked player's team
    const linkedTeam = p.player_id ? (playersMap[p.player_id]?.team_id || "") : ""
    setForm({ profileId: p.id, role: "judge", teamId: linkedTeam })
    setError(null)
  }

  if (loading) {
    return <SkeletonPanelRows />
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="flex items-center gap-2 text-lg font-bold text-slate-900 dark:text-white">
            <Award className="w-5 h-5 text-brand" /> תפקידים והרשאות
          </h2>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-0.5">הענקת תפקידים למשתמשים רשומים ושיוך חשבון לכרטיס שחקן. שופט = הרשאה להפעיל את לוח השיפוט.</p>
        </div>
        <button onClick={load} className="flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-600 text-slate-500 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors">
          <RefreshCw className="w-3.5 h-3.5" /> רענון
        </button>
      </div>

      {error && (
        <div className="card p-3 border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-950/30 text-sm text-red-700 dark:text-red-400">{error}</div>
      )}

      {profiles.length === 0 ? (
        <div className="card p-10 text-center text-sm text-slate-500 dark:text-slate-400">אין משתמשים רשומים עדיין</div>
      ) : (
        <>
          <div className="relative">
            <Search className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none" />
            <input
              type="text"
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="חיפוש משתמש..."
              className="filter-input w-full pr-9"
            />
          </div>

          <SortBar options={ROLE_SORT_OPTIONS} sort={sort} onChange={setSort} />

          {filtered.length === 0 ? (
            <div className="card p-8 text-center text-sm text-slate-500 dark:text-slate-400">לא נמצאו משתמשים תואמים</div>
          ) : (
        <div className="space-y-2.5">
          {sorted.map(p => {
            const linked = p.player_id ? playersMap[p.player_id] : null
            const initial = (p.display_name || "?").charAt(0).toUpperCase()
            const myRoles = rolesFor(p.id)
            return (
              <div key={p.id} className="card p-4">
                <div className="flex items-center gap-3">
                  {p.avatar_url
                    ? <img src={p.avatar_url} alt="" className="w-9 h-9 rounded-full object-cover shrink-0" />
                    : <div className="w-9 h-9 rounded-full bg-brand text-white flex items-center justify-center text-sm font-bold shrink-0">{initial}</div>}
                  <div className="min-w-0 flex-1">
                    <p className="font-bold text-sm text-slate-900 dark:text-white truncate">{p.display_name || "משתמש"}</p>
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <p className="text-[11px] text-slate-500 dark:text-slate-400">{linked ? `משויך ל${linked.first_name} ${linked.last_name}` : p.player_id ? "משויך לכרטיס שחקן" : "ללא שיוך שחקן"}</p>
                      {linkForm?.profileId !== p.id && (
                        <button onClick={() => { setLinkForm({ profileId: p.id, q: "", playerId: p.player_id || "" }); setError(null) }}
                          className="inline-flex items-center gap-1 text-[11px] font-semibold text-brand hover:underline">
                          <Link2 className="w-3 h-3" /> {p.player_id ? "שינוי שיוך" : "שייך שחקן"}
                        </button>
                      )}
                      {p.player_id && (
                        <button onClick={() => doUnlink(p.id)} disabled={busy}
                          className="inline-flex items-center gap-1 text-[11px] font-semibold text-slate-400 hover:text-red-500 disabled:opacity-40">
                          <Link2Off className="w-3 h-3" /> ביטול שיוך
                        </button>
                      )}
                    </div>
                  </div>
                  {user?.id !== p.id && (
                    <button onClick={() => { setConfirmDelete(confirmDelete === p.id ? null : p.id); setError(null) }}
                      title="מחיקת משתמש"
                      className="shrink-0 p-2 rounded-lg text-slate-300 dark:text-slate-600 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-950/30 transition-colors">
                      <Trash2 className="w-4 h-4" />
                    </button>
                  )}
                </div>

                {confirmDelete === p.id && (
                  <div className="mt-3 pt-3 border-t border-red-100 dark:border-red-900/40 flex items-center justify-between gap-2 flex-wrap">
                    <span className="text-xs font-medium text-red-600 dark:text-red-400">למחוק את המשתמש לצמיתות? החשבון יימחק והוא יאלץ להירשם מחדש. פעולה בלתי הפיכה.</span>
                    <div className="flex items-center gap-2">
                      <button onClick={() => doDelete(p.id)} disabled={busy}
                        className="flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-lg bg-red-500 text-white hover:bg-red-600 transition-colors disabled:opacity-50">
                        {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />} כן, מחק
                      </button>
                      <button onClick={() => setConfirmDelete(null)} disabled={busy}
                        className="text-xs font-semibold px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-600 text-slate-500 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors">ביטול</button>
                    </div>
                  </div>
                )}

                {linkForm?.profileId === p.id && (
                  <div className="mt-3 pt-3 border-t border-slate-100 dark:border-slate-700 space-y-2">
                    <p className="text-[11px] text-slate-500 dark:text-slate-400">
                      שיוך החשבון לכרטיס שחקן — מעניק גם תפקיד שחקן בקבוצת הכרטיס.
                    </p>
                    <div className="flex flex-wrap items-center gap-2">
                      <input
                        type="text"
                        value={linkForm.q}
                        onChange={e => setLinkForm(f => ({ ...f, q: e.target.value }))}
                        placeholder="סינון לפי שם או קבוצה..."
                        className="filter-input text-xs py-1.5 flex-1 min-w-[10rem]"
                      />
                      <select value={linkForm.playerId} onChange={e => setLinkForm(f => ({ ...f, playerId: e.target.value }))}
                        className="filter-select text-xs py-1.5 flex-1 min-w-[12rem]">
                        <option value="">בחר שחקן</option>
                        {linkOptions.map(pl => {
                          const owner = ownerOf[pl.id]
                          const taken = owner && owner.id !== p.id
                          return (
                            <option key={pl.id} value={pl.id} disabled={taken}>
                              {playerLabel(pl)}{taken ? ` — משויך ל${owner.display_name || "משתמש"}` : ""}
                            </option>
                          )
                        })}
                      </select>
                      <button onClick={doLink} disabled={busy}
                        className="flex items-center gap-1 text-xs font-semibold px-3 py-1.5 rounded-lg bg-emerald-500 text-white hover:bg-emerald-600 disabled:opacity-50 transition-colors">
                        {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />} שייך
                      </button>
                      <button onClick={() => { setLinkForm(null); setError(null) }}
                        className="text-xs font-semibold px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-600 text-slate-500 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors">ביטול</button>
                    </div>
                    {linkOptions.length === 0 && (
                      <p className="text-[11px] text-slate-500 dark:text-slate-400">לא נמצאו שחקנים תואמים</p>
                    )}
                  </div>
                )}

                <div className="mt-3 flex flex-wrap gap-1.5 items-center">
                  {myRoles.map(r => (
                    <span key={r.id} className="inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-1 rounded-lg bg-slate-100 dark:bg-slate-700 text-slate-700 dark:text-slate-200">
                      {ROLE_LABEL[r.role] || r.role}{r.team_id ? ` · ${teamsMap[r.team_id]?.name || ""}` : ""}
                      <button onClick={() => doRevoke(r.id)} disabled={busy} className="text-slate-400 hover:text-red-500 disabled:opacity-40"><X className="w-3 h-3" /></button>
                    </span>
                  ))}
                  {myRoles.length === 0 && <span className="text-[11px] text-slate-500 dark:text-slate-400">אין תפקידים</span>}
                  {form?.profileId !== p.id && (
                    <button onClick={() => openForm(p)} className="inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-1 rounded-lg border border-dashed border-slate-300 dark:border-slate-600 text-slate-500 dark:text-slate-400 hover:border-brand hover:text-brand transition-colors">
                      <Plus className="w-3 h-3" /> הוסף תפקיד
                    </button>
                  )}
                </div>

                {form?.profileId === p.id && (
                  <div className="mt-3 pt-3 border-t border-slate-100 dark:border-slate-700 flex flex-wrap items-center gap-2">
                    <select value={form.role} onChange={e => setForm(f => ({ ...f, role: e.target.value }))} className="filter-select text-xs py-1.5">
                      {GRANTABLE_ROLES.map(r => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
                    </select>
                    {TEAM_SCOPED.has(form.role) && (
                      <select value={form.teamId} onChange={e => setForm(f => ({ ...f, teamId: e.target.value }))} className="filter-select text-xs py-1.5">
                        <option value="">{form.role === "coach" ? "בחר קבוצה" : "ללא קבוצה"}</option>
                        {teams.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                      </select>
                    )}
                    <button onClick={doGrant} disabled={busy} className="flex items-center gap-1 text-xs font-semibold px-3 py-1.5 rounded-lg bg-emerald-500 text-white hover:bg-emerald-600 disabled:opacity-50 transition-colors">
                      {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />} הענק
                    </button>
                    <button onClick={() => { setForm(null); setError(null) }} className="text-xs font-semibold px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-600 text-slate-500 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors">ביטול</button>
                  </div>
                )}
              </div>
            )
          })}
        </div>
          )}
        </>
      )}
    </div>
  )
}
