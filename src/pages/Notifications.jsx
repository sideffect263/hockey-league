import { useState, useEffect, useMemo } from "react"
import { Link, useNavigate } from "react-router-dom"
import { useAuth } from "@/lib/AuthContext"
import { getNotifications, markAllRead, markRead } from "@/lib/notifications"
import { pushSupported, pushStatus, enablePush } from "@/lib/push"
import { useSeo } from "@/lib/seo"
import { SkeletonNotificationRows } from "@/components/skeletons/PageSkeletons"
import { Glyph, Spinner, Notice } from "@/components/fl/account/AccountKit"
import { NotifRow, FilterChips, EmptyNotifs, FILTERS, groupByAge } from "@/components/fl/account/NotifKit"
import { useLeagueTeams } from "@/components/fl/account/MyPageParts"

/**
 * Full notifications list (board NotifBell): today / this week / earlier, filter chips,
 * answer buttons on the rows that need one, brand icons + the team's crest.
 *
 * Some notifications carry content that exists NOWHERE else: a league-manager broadcast
 * is up to 500 characters and is not stored on the game page, so here every row wraps in
 * full rather than being clamped. On phones the header bell opens this page.
 */
export default function Notifications() {
  const { user, loading: authLoading, openAuth } = useAuth()
  const navigate = useNavigate()
  const [rows, setRows] = useState(null)
  const [error, setError] = useState(null)
  const [filter, setFilter] = useState("all")
  const [push, setPush] = useState(null)
  const [pushBusy, setPushBusy] = useState(false)
  const teams = useLeagueTeams()
  const teamsByName = useMemo(() => Object.fromEntries(teams.map(t => [t.name, t])), [teams])

  useSeo({ title: "התראות", path: "/notifications", noindex: true })

  const load = async () => {
    try { setError(null); setRows(await getNotifications(100)) }
    catch { setError("שגיאה בטעינת ההתראות"); setRows([]) }
  }
  useEffect(() => { if (user) load() }, [user]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!user) return
    if (!pushSupported()) { setPush("unsupported"); return }
    pushStatus().then(setPush).catch(() => {})
  }, [user])

  const readAll = async () => {
    try { await markAllRead(); setRows(rs => (rs || []).map(n => ({ ...n, read_at: n.read_at || new Date().toISOString() }))) } catch { /* best-effort */ }
  }
  const turnOnPush = async () => {
    setPushBusy(true)
    try { const r = await enablePush(); setPush(r.ok ? "on" : r.reason === "denied" ? "denied" : "default") }
    finally { setPushBusy(false) }
  }
  const back = () => (window.history.length > 1 ? navigate(-1) : navigate("/"))

  if (authLoading) return null
  if (!user) {
    return (
      <div className="max-w-2xl mx-auto px-4 pt-6 pb-8">
        <div className="bg-surface rounded-[22px] p-8 text-center flex flex-col items-center gap-3">
          <h1 className="text-[22px] font-extrabold text-fg-strong">התראות</h1>
          <p className="text-[14px] text-fg-muted">מתחברים כדי לקבל התראות על המשחקים של הקבוצה שלך</p>
          <button type="button" onClick={openAuth} className="btn-primary h-11 px-5">התחברות</button>
        </div>
      </div>
    )
  }

  const all = rows || []
  const unread = all.filter(n => !n.read_at).length
  const f = FILTERS.find(x => x.id === filter) || FILTERS[0]
  const shown = all.filter(f.test)
  const groups = groupByAge(shown)

  return (
    <div className="max-w-2xl mx-auto pb-8">
      <header className="flex items-center justify-between gap-2 px-3 sm:px-4 pt-3 sm:pt-6 pb-2">
        <div className="flex items-center gap-1 min-w-0">
          <button type="button" onClick={back} aria-label="חזרה" className="size-11 rounded-full flex items-center justify-center text-fg-strong hover:bg-surface">
            <Glyph d="back" size={22} stroke={2.1} />
          </button>
          <h1 className="text-[26px] font-extrabold text-fg-strong">התראות</h1>
          {unread > 0 && <span className="ms-1 min-w-6 h-6 px-1.5 rounded-full bg-fl-accent text-fl-inkOnLight text-[12px] font-extrabold flex items-center justify-center tabular-nums">{unread}</span>}
        </div>
        <div className="flex items-center">
          {unread > 0 && (
            <button type="button" onClick={readAll} className="h-11 px-2.5 rounded-xl text-[13.5px] font-semibold text-fg-muted hover:text-fg-strong hover:bg-surface">סימון הכל כנקרא</button>
          )}
          <button type="button" onClick={load} aria-label="רענון" className="size-11 rounded-full flex items-center justify-center text-fg-muted hover:text-fg-strong hover:bg-surface">
            <Glyph d="refresh" size={19} />
          </button>
        </div>
      </header>

      <div className="px-4 pt-1 pb-3"><FilterChips value={filter} onChange={setFilter} rows={all} /></div>

      {push === "default" && (
        <div className="mx-3 sm:mx-4 mb-3 rounded-[18px] bg-surface p-3.5 flex items-center gap-3">
          <Glyph d="bell" size={22} className="text-fg-strong" />
          <p className="flex-1 text-[13px] text-fg-strong">לקבל התראות גם כשהאתר סגור, במכשיר הזה</p>
          <button type="button" onClick={turnOnPush} disabled={pushBusy} className="btn-primary h-11 px-4 shrink-0">{pushBusy ? <Spinner /> : "הפעלה"}</button>
        </div>
      )}
      {push === "denied" && <Notice tone="info" className="mx-3 sm:mx-4 mb-3">ההתראות חסומות בדפדפן. מאפשרים אותן בהגדרות האתר כדי לקבל עדכונים.</Notice>}
      {error && <Notice tone="err" className="mx-3 sm:mx-4 mb-3">{error}</Notice>}

      {rows === null ? (
        <div className="px-3 sm:px-4"><SkeletonNotificationRows /></div>
      ) : shown.length === 0 ? (
        <div className="mx-3 sm:mx-4 bg-surface rounded-[22px]"><EmptyNotifs filtered={filter !== "all"} /></div>
      ) : (
        groups.map(([title, list]) => (
          <section key={title} aria-label={title} className="mb-2">
            <h2 className="px-5 pt-2.5 pb-2 text-[13px] font-extrabold text-fg-muted">{title}</h2>
            <ul className="bg-surface sm:mx-4 sm:rounded-[20px] overflow-hidden divide-y divide-line">
              {list.map(n => (
                <li key={n.id}>
                  <NotifRow n={n} teamsByName={teamsByName} wrap
                    onOpen={(x) => { if (!x.read_at) markRead(x.id).catch(() => {}) }}
                    onAnswered={(x) => { if (!x.read_at) markRead(x.id).catch(() => {}) }} />
                </li>
              ))}
            </ul>
          </section>
        ))
      )}
      <p className="mt-4 text-center text-[12px] text-fg-muted">ההגדרות: <Link to="/me" className="font-bold text-fg-strong underline underline-offset-4">הדף שלי ← התראות</Link></p>
    </div>
  )
}
