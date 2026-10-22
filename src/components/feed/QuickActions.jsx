import { useState, useEffect } from "react"
import { Link } from "react-router-dom"
import { format } from "date-fns"
import { useAuth } from "@/lib/AuthContext"
import { getAvailabilityForGames } from "@/lib/availability"
import { getMyMedical } from "@/lib/medical"
import { pushStatus, enablePush } from "@/lib/push"
import {
  LogIn, Trophy, Smartphone, UserPlus, Users, Bell,
  CalendarClock, CalendarCheck, CalendarX, HeartPulse, ChevronLeft, Loader2,
} from "lucide-react"
import { entityPath } from '@/lib/slugs'
import { useHasNativeApp } from "@/lib/appUsers"
import { ilDate } from "@/lib/ilTime"

/**
 * "פעולות מהירות" — a context-aware quick-actions panel that sits under the feed
 * filter rail. It shows the right handful of actions for the current viewer
 * (guest → sign in / player → team & alerts) and never renders a dead-end link.
 *
 * Two player alerts take priority when relevant:
 *   1. The linked player's NEXT game: a nudge if they haven't responded, otherwise a
 *      quiet note of their answer. Only ever the next game — the one after it isn't
 *      offered until this one has been played.
 *   2. A medical certificate that's missing / rejected / expiring / expired (→ /me).
 */

const MEDICAL_EXPIRY_WINDOW_DAYS = 30 // start nudging this many days before a cert lapses

// Turn the player's latest certificate into an alert (or null = nothing to nag about).
function medicalAlert(cert) {
  if (!cert) return { label: "העלאת אישור רפואי", sub: "עדיין לא הועלה אישור", tone: "amber" }
  if (cert.status === "rejected") return { label: "האישור הרפואי נדחה", sub: "יש להעלות מחדש", tone: "red" }
  if (cert.status === "approved" && cert.expires_at) {
    const days = Math.ceil((new Date(cert.expires_at) - new Date()) / 86400000)
    if (days < 0) return { label: "האישור הרפואי פג תוקף", sub: "יש לחדש", tone: "red" }
    if (days <= MEDICAL_EXPIRY_WINDOW_DAYS)
      return { label: "האישור הרפואי עומד לפוג", sub: `בתוקף עוד ${days} ${days === 1 ? "יום" : "ימים"}`, tone: "amber" }
  }
  return null // pending, comfortably valid, or a legacy cert with no expiry → don't nag
}

export default function QuickActions({ games = [], teamsMap = {} }) {
  const { user, profile, openAuth } = useAuth()
  const playerId = profile?.player_id || null
  const teamId = profile?.player?.team_id || null
  const hasApp = useHasNativeApp()

  // { game, status } for the player's next game; status null = not answered yet.
  const [nextGame, setNextGame] = useState(null)
  const [medical, setMedical] = useState(null)
  const [push, setPush] = useState(null)
  const [pushBusy, setPushBusy] = useState(false)

  // Alert #1 — the player's NEXT game (by kick-off time). If they've answered, show
  // their answer instead of skipping ahead to the following fixture — that one is only
  // offered once this game's time has passed. RLS returns only the caller's rows.
  useEffect(() => {
    if (!playerId || !teamId || !games.length) { setNextGame(null); return }
    const now = Date.now()
    const next = games
      .filter(g => (g.home_team_id === teamId || g.away_team_id === teamId)
        && g.status === "scheduled" && new Date(g.game_date).getTime() >= now)
      .sort((a, b) => new Date(a.game_date) - new Date(b.game_date))[0]
    if (!next) { setNextGame(null); return }
    let alive = true
    getAvailabilityForGames([next.id]).then(rows => {
      if (!alive) return
      const mine = rows.find(r => r.player_id === playerId)
      setNextGame({ game: next, status: mine?.status ?? null })
    }).catch(() => {})
    return () => { alive = false }
  }, [playerId, teamId, games])

  // Alert #2 — medical certificate needs attention.
  useEffect(() => {
    if (!playerId) { setMedical(null); return }
    let alive = true
    getMyMedical(playerId).then(c => { if (alive) setMedical(medicalAlert(c)) }).catch(() => {})
    return () => { alive = false }
  }, [playerId])

  // Push opt-in state for THIS browser — the action is only offered while it can
  // still be enabled ('default'); once 'on' / 'denied' / 'unsupported' it's hidden.
  useEffect(() => {
    if (!user) { setPush(null); return }
    let alive = true
    pushStatus().then(s => { if (alive) setPush(s) }).catch(() => {})
    return () => { alive = false }
  }, [user])

  const onEnablePush = async () => {
    setPushBusy(true)
    try { await enablePush() }
    finally {
      setPushBusy(false)
      pushStatus().then(setPush).catch(() => {})
    }
  }

  // Non-alert quick links for the current viewer (kept to a tight handful).
  const links = []
  if (!user) {
    links.push({ key: "signin", label: "התחברות / הרשמה", icon: LogIn, onClick: openAuth, primary: true })
    links.push({ key: "standings", label: "טבלת הליגה", icon: Trophy, to: "/standings" })
    links.push({ key: "app", label: "הורדת האפליקציה", icon: Smartphone, to: "/app" })
  } else {
    if (!playerId) {
      links.push({ key: "claim", label: "שייכו חשבון לשחקן", icon: UserPlus, to: "/me", primary: true })
    } else if (teamId) {
      links.push({ key: "team", label: "הקבוצה שלי", icon: Users, to: entityPath('teams', teamId) })
    } else {
      links.push({ key: "findteam", label: "מצא/י קבוצה", icon: Users, to: "/me", primary: true })
    }
    if (push === "default") links.push({ key: "push", label: "הפעלת התראות", icon: Bell, onClick: onEnablePush, busy: pushBusy })
    // Someone who has already signed in on the app doesn't need to be sold it.
    if (!hasApp) links.push({ key: "app", label: "הורדת האפליקציה", icon: Smartphone, to: "/app" })
  }

  const opponentName = (g) => {
    if (!g) return ""
    const oppId = g.home_team_id === teamId ? g.away_team_id : g.home_team_id
    return teamsMap[oppId]?.name || ""
  }

  return (
    <nav className="card p-2 space-y-0.5">
      <p className="px-3 pt-1.5 pb-1 text-[11px] font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400">
        פעולות מהירות
      </p>

      {/* Player alerts — highest priority, attention-styled */}
      {nextGame && (() => {
        const g = nextGame.game
        const sub = [opponentName(g), format(ilDate(g.game_date), "d/M · HH:mm")].filter(Boolean).join(" · ")
        const cfg = nextGame.status === "available"
          ? { icon: CalendarCheck, tone: "green", label: "אישרת הגעה למשחק הקרוב" }
          : nextGame.status === "unavailable"
            ? { icon: CalendarX, tone: "slate", label: "סימנת שלא תגיע/י למשחק הקרוב" }
            : { icon: CalendarClock, tone: "amber", label: "הירשמו למשחק הקרוב" }
        return <AlertRow to={entityPath('games', g)} sub={sub} {...cfg} />
      })()}
      {medical && (
        <AlertRow to="/me" icon={HeartPulse} tone={medical.tone} label={medical.label} sub={medical.sub} />
      )}

      {/* Quick links */}
      {links.map(({ key, ...item }) => <ActionRow key={key} {...item} />)}
    </nav>
  )
}

// A single tappable action — a Link (to) or a button (onClick).
function ActionRow({ label, icon: Icon, to, onClick, primary, busy }) {
  const cls = `w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-semibold transition-all ${
    primary
      ? "bg-brand text-white shadow-sm shadow-brand/25 hover:brightness-105"
      : "text-slate-600 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-700/60 hover:text-slate-900 dark:hover:text-white"
  }`
  const inner = (
    <>
      {busy
        ? <Loader2 size={18} className="animate-spin shrink-0" />
        : <Icon size={18} className={primary ? "shrink-0" : "shrink-0 text-slate-500 dark:text-slate-400"} />}
      <span className="flex-1 text-right">{label}</span>
      <ChevronLeft size={16} className={primary ? "text-white/70" : "text-slate-300 dark:text-slate-600"} />
    </>
  )
  return to
    ? <Link to={to} className={cls}>{inner}</Link>
    : <button type="button" onClick={onClick} disabled={busy} className={`${cls} disabled:opacity-60`}>{inner}</button>
}

// A two-line row for the player alerts (next-game signup or answer / medical).
function AlertRow({ label, sub, icon: Icon, to, tone = "amber" }) {
  const tones = {
    amber: "bg-amber-50 dark:bg-amber-950/30 text-amber-700 dark:text-amber-300 hover:bg-amber-100 dark:hover:bg-amber-950/50 ring-amber-200/70 dark:ring-amber-800/50",
    green: "bg-emerald-50 dark:bg-emerald-950/30 text-emerald-700 dark:text-emerald-300 hover:bg-emerald-100 dark:hover:bg-emerald-950/50 ring-emerald-200/70 dark:ring-emerald-800/50",
    slate: "bg-slate-50 dark:bg-slate-800/60 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700/60 ring-slate-200/70 dark:ring-slate-700/50",
    red: "bg-red-50 dark:bg-red-950/30 text-red-700 dark:text-red-300 hover:bg-red-100 dark:hover:bg-red-950/50 ring-red-200/70 dark:ring-red-800/50",
  }
  return (
    <Link to={to} className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-lg ring-1 transition-colors ${tones[tone]}`}>
      <Icon size={18} className="shrink-0" />
      <span className="flex-1 min-w-0 text-right">
        <span className="block text-[13px] font-bold leading-tight line-clamp-2">{label}</span>
        {sub && <span className="block text-[11px] opacity-80 truncate">{sub}</span>}
      </span>
      <ChevronLeft size={16} className="shrink-0 opacity-60" />
    </Link>
  )
}
