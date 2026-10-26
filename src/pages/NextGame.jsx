import { useState, useEffect } from "react"
import { Link, useNavigate } from "react-router-dom"
import { LogIn, Loader2, ArrowRight } from "lucide-react"
import { PersonAdd as UserPlus, CalendarCheck } from "@/components/icons/BrandIcons"
import { useAuth } from "@/lib/AuthContext"
import { getGames } from "@/lib/api"
import { entityPath } from "@/lib/slugs"
import { useSeo } from "@/lib/seo"

/**
 * /games/next — ONE standing link a coach or the league can post to a WhatsApp group
 * every week ("sign up for the game"). It sends whoever opens it to THEIR next game's
 * sign-up block (#availability on the game page). The app handles the same path via
 * universal links / App Links, so on a phone with the app installed it opens there.
 *
 * "Next" = the earliest scheduled game of the viewer's team (a linked player's team,
 * plus any team they coach) that hasn't kicked off yet — the same rule the feed's
 * quick-actions nudge uses, so both point at the same fixture.
 */

// A game that kicked off a moment ago is still the one people are asking about.
const GRACE_MS = 2 * 60 * 60 * 1000

export default function NextGame() {
  const { user, profile, coachTeamIds, isAdmin, openAuth } = useAuth()
  const navigate = useNavigate()
  const [state, setState] = useState("loading") // loading | none | error
  useSeo({ title: "אישור הגעה למשחק הבא", path: "/games/next", noindex: true })

  const teamIds = [...new Set([profile?.player?.team_id, ...(coachTeamIds || [])].filter(Boolean))]
  const teamKey = teamIds.sort().join(",")

  useEffect(() => {
    if (!user || !teamKey) return
    let alive = true
    setState("loading")
    const mine = new Set(teamKey.split(","))
    getGames("game_date", true).then(games => {
      if (!alive) return
      const cutoff = Date.now() - GRACE_MS
      const next = (games || []).find(g => g.status === "scheduled"
        && (mine.has(g.home_team_id) || mine.has(g.away_team_id))
        && new Date(g.game_date).getTime() >= cutoff)
      if (next) navigate(`${entityPath("games", next)}#availability`, { replace: true })
      else setState("none")
    }).catch(() => { if (alive) setState("error") })
    return () => { alive = false }
  }, [user, teamKey, navigate])

  let icon = CalendarCheck, title, body, action = null
  if (!user) {
    icon = LogIn
    title = "התחברו כדי לאשר הגעה"
    body = "הקישור הזה מוביל למשחק הבא של הקבוצה שלכם. התחברו עם החשבון שלכם בליגה ותועברו אליו."
    action = (
      <button onClick={openAuth} className="flex items-center gap-1.5 px-4 py-2 bg-brand text-brand-fg rounded-xl text-sm font-bold hover:bg-brand-hover transition-colors">
        <LogIn className="w-4 h-4" /> התחברות
      </button>
    )
  } else if (!teamKey) {
    icon = UserPlus
    title = isAdmin ? "אין לחשבון הזה קבוצה" : "החשבון עדיין לא משויך לשחקן"
    body = isAdmin
      ? "הקישור מוביל כל שחקן למשחק הבא של הקבוצה שלו. אפשר לבחור משחק מרשימת המשחקים."
      : "כדי לאשר הגעה יש לשייך את החשבון לכרטיס השחקן שלך בקבוצה."
    action = isAdmin
      ? <Link to="/games" className="flex items-center gap-1.5 px-4 py-2 bg-brand text-brand-fg rounded-xl text-sm font-bold hover:bg-brand-hover transition-colors"><ArrowRight className="w-4 h-4" /> למשחקים</Link>
      : <Link to="/me" className="flex items-center gap-1.5 px-4 py-2 bg-brand text-brand-fg rounded-xl text-sm font-bold hover:bg-brand-hover transition-colors"><UserPlus className="w-4 h-4" /> שיוך לשחקן</Link>
  } else if (state === "loading") {
    return (
      <div className="p-4 sm:p-6 lg:p-8 max-w-3xl mx-auto">
        <div className="card p-6 flex flex-col items-center justify-center text-center gap-3 min-h-[240px]">
          <Loader2 className="w-8 h-8 animate-spin text-brand" />
          <p className="text-sm text-slate-500 dark:text-slate-400">מחפשים את המשחק הבא שלך…</p>
        </div>
      </div>
    )
  } else if (state === "none") {
    title = "אין משחק קרוב"
    body = "לא נמצא משחק מתוכנן לקבוצה שלך. כשייקבע משחק, הקישור הזה יוביל אליו."
    action = <Link to="/games" className="flex items-center gap-1.5 px-4 py-2 bg-brand text-brand-fg rounded-xl text-sm font-bold hover:bg-brand-hover transition-colors"><ArrowRight className="w-4 h-4" /> לכל המשחקים</Link>
  } else {
    title = "שגיאה בטעינת המשחקים"
    body = "משהו השתבש, נסו לרענן את הדף."
  }

  const Icon = icon
  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-3xl mx-auto">
      <div className="card p-6 flex flex-col items-center justify-center text-center gap-3 min-h-[240px]">
        <Icon className="w-12 h-12 text-brand" />
        <h1 className="text-lg font-bold text-slate-800 dark:text-slate-100">{title}</h1>
        <p className="text-sm text-slate-500 dark:text-slate-400 max-w-sm">{body}</p>
        {action && <div className="mt-1">{action}</div>}
      </div>
    </div>
  )
}
