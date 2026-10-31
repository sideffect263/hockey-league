import { Link } from "react-router-dom"
import { ChevronLeft } from "lucide-react"
import { Trophy, Calendar, Flame, MapPin, Table } from "@/components/icons/BrandIcons"
import { format } from "date-fns"
import { standingsComparator } from "@/lib/utils"
import { ageOf, DEFAULT_AGE } from "@/lib/ageGroups"
import TeamLogo from "@/components/TeamLogo"
import { entityPath } from "@/lib/slugs"
import { ilDate } from "@/lib/ilTime"
import { teamBanner, onColor } from "@/lib/flTeam"

// Floodlight: the leader carries the one accent; the rest sit on the raised track.
const medal = (i) => i === 0 ? 'bg-fl-accent text-[#11161D]' : 'bg-surface-sunken text-fg-strong'

function WidgetHeader({ icon, title }) {
  return (
    <div className="flex items-center gap-2 px-4 pt-3.5 pb-1">
      {icon}
      <h2 className="font-extrabold text-[15px] text-fg-strong">{title}</h2>
    </div>
  )
}

function WidgetFooter({ to, label }) {
  return (
    <Link
      to={to}
      className="flex items-center justify-center gap-1 px-4 min-h-[44px] border-t border-line text-[13px] font-semibold text-fg-strong hover:bg-surface-inset transition-colors"
    >
      {label}
      <ChevronLeft className="w-3.5 h-3.5" />
    </Link>
  )
}

export function StandingsWidget({ teams = [] }) {
  const top = [...teams].filter(t => ageOf(t) === DEFAULT_AGE).sort(standingsComparator).slice(0, 5)
  // Points bar under each team: leader = 100%, others = points / leader points (right-anchored, RTL).
  const leaderPts = top[0]?.points || 0
  const barPct = (pts) => leaderPts > 0 ? Math.max(0, Math.min(100, ((pts || 0) / leaderPts) * 100)) : 0
  return (
    <div className="card overflow-hidden">
      <WidgetHeader icon={<Table className="w-4 h-4" />} title="טבלה" />
      <div className="p-3 space-y-1.5">
        {top.length === 0 && (
          <p className="text-center text-xs text-slate-500 dark:text-slate-400 py-4">אין נתונים</p>
        )}
        {top.map((team, i) => (
          <div key={team.id} className="px-1.5 py-1">
            <div className="flex items-center gap-2.5">
              <span className={`w-5 h-5 rounded-md flex items-center justify-center fl-num text-[11px] shrink-0 ${medal(i)}`}>{i + 1}</span>
              <Link to={entityPath('teams', team)} className="flex items-center gap-2.5 flex-1 min-w-0 group">
                <TeamLogo team={team} size={6} />
                <span className="truncate text-sm font-semibold text-slate-900 dark:text-white group-hover:text-brand transition-colors">{team.name}</span>
              </Link>
              <span className="fl-num text-[16px] text-fg-strong shrink-0">{team.points || 0}</span>
            </div>
            {/* Points bar: leader = full width, others scaled to their points ratio; grows right→left.
                Inset ring gives a defined edge so even white/pale team colours stay visible. */}
            <div className="relative mt-1.5 ms-7 h-1.5 rounded-full bg-slate-200 dark:bg-slate-700 overflow-hidden">
              <div className="absolute inset-y-0 right-0 rounded-full ring-1 ring-inset ring-black/15 dark:ring-white/20 transition-[width] duration-500"
                   style={{ width: `${barPct(team.points || 0)}%`, backgroundColor: team.primary_color || "#94a3b8" }} />
            </div>
          </div>
        ))}
      </div>
      <WidgetFooter to="/standings" label="לטבלה המלאה" />
    </div>
  )
}

export function NextGameWidget({ games = [], teams = [] }) {
  const teamsMap = Object.fromEntries(teams.map(t => [t.id, t]))
  const upcoming = games
    .filter(g => ['scheduled', 'in_progress', 'waiting_result'].includes(g.status) && new Date(g.game_date) >= new Date())
    .sort((a, b) => new Date(a.game_date) - new Date(b.game_date))
  const next = upcoming[0] || null
  const home = next ? teamsMap[next.home_team_id] : null
  const away = next ? teamsMap[next.away_team_id] : null

  return (
    <div className="card overflow-hidden">
      <WidgetHeader icon={<Calendar className="w-4 h-4" />} title="המשחק הבא" />
      <div className="p-4">
        {next ? (
          <>
            <div className="flex items-center justify-between gap-2">
              {home ? (
                <Link to={entityPath('teams', home)} className="flex items-center gap-2 flex-1 min-w-0 group">
                  <TeamLogo team={home} size={8} />
                  <span className="text-sm font-semibold text-slate-900 dark:text-white truncate group-hover:text-brand transition-colors">{home?.name}</span>
                </Link>
              ) : (
                <div className="flex items-center gap-2 flex-1 min-w-0">
                  <TeamLogo team={home} size={8} />
                  <span className="text-sm font-semibold text-slate-900 dark:text-white truncate">{home?.name}</span>
                </div>
              )}
              <span className="text-[12px] font-extrabold text-fg-muted shrink-0">נגד</span>
              {away ? (
                <Link to={entityPath('teams', away)} className="flex items-center gap-2 flex-1 min-w-0 flex-row-reverse group">
                  <TeamLogo team={away} size={8} />
                  <span className="text-sm font-semibold text-slate-900 dark:text-white truncate text-left group-hover:text-brand transition-colors">{away?.name}</span>
                </Link>
              ) : (
                <div className="flex items-center gap-2 flex-1 min-w-0 flex-row-reverse">
                  <TeamLogo team={away} size={8} />
                  <span className="text-sm font-semibold text-slate-900 dark:text-white truncate text-left">{away?.name}</span>
                </div>
              )}
            </div>
            <div className="mt-3 pt-3 border-t border-slate-100 dark:border-slate-700 flex items-center gap-3 text-xs text-slate-500 dark:text-slate-400 flex-wrap">
              {/* date and time are two separate LTR runs — without dir=ltr the RTL context prints the time first */}
              <span className="flex items-center gap-1"><Calendar className="w-4 h-4" />
                <span dir="ltr" className="tabular-nums">{format(ilDate(next.game_date), "d/M/yyyy HH:mm")}</span>
              </span>
              {next.venue && <span className="flex items-center gap-1"><MapPin className="w-4 h-4" />{next.venue}</span>}
            </div>
          </>
        ) : (
          <p className="text-center text-sm text-slate-500 dark:text-slate-400 py-4">העונה הסתיימה <Trophy className="w-4 h-4 inline-block align-[-3px]" /></p>
        )}
      </div>
      <WidgetFooter to="/games" label="לכל המשחקים" />
    </div>
  )
}

export function LeadersWidget({ players = [], teams = [] }) {
  const teamsMap = Object.fromEntries(teams.map(t => [t.id, t]))
  const ranked = players
    .filter(p => p.position === 'Field Player' && (p.goals || 0) > 0)
    .sort((a, b) => (b.goals || 0) - (a.goals || 0) || `${a.first_name} ${a.last_name}`.localeCompare(`${b.first_name} ${b.last_name}`, 'he'))
  // Top 5, but never split a tie: everyone level with the 5th player is shown too,
  // and tied players share a rank (1, 2, 3, 4, 4, 4, 4).
  const cutoff = ranked[4]?.goals || 0
  const top = ranked.filter((p, i) => i < 5 || (p.goals || 0) === cutoff)
  const rankOf = (i) => top.findIndex(p => (p.goals || 0) === (top[i].goals || 0))

  return (
    <div className="card overflow-hidden">
      <WidgetHeader icon={<Flame className="w-4 h-4" />} title="מלכי השערים" />
      <div className="p-3 space-y-1.5">
        {top.length === 0 && (
          <p className="text-center text-xs text-slate-500 dark:text-slate-400 py-4">אין נתונים</p>
        )}
        {top.map((p, i) => (
          <div key={p.id} className="flex items-center gap-2.5 px-1.5 py-1">
            <span className={`w-5 h-5 rounded-md flex items-center justify-center fl-num text-[11px] shrink-0 ${medal(rankOf(i))}`}>{rankOf(i) + 1}</span>
            <div className="flex-1 min-w-0">
              <Link to={entityPath('players', p)} className="block group">
                <p className="text-sm font-semibold text-slate-900 dark:text-white truncate group-hover:text-brand transition-colors">{p.first_name} {p.last_name}</p>
              </Link>
              {p.team_id ? (
                <Link to={entityPath('teams', p.team_id)} className="block group">
                  <p className="text-[11px] text-slate-500 dark:text-slate-400 truncate group-hover:text-brand transition-colors">{teamsMap[p.team_id]?.name || '—'}</p>
                </Link>
              ) : (
                <p className="text-[11px] text-slate-500 dark:text-slate-400 truncate">{teamsMap[p.team_id]?.name || '—'}</p>
              )}
            </div>
            <span className="fl-num text-[16px] text-fg-strong shrink-0">{p.goals || 0}</span>
          </div>
        ))}
      </div>
      <WidgetFooter to="/statistics" label="לכל הסטטיסטיקות" />
    </div>
  )
}

/**
 * The table as a feed post (FeedPlayer board; iOS StandingsPost): the top four as team-colour
 * tiles, your team ringed amber, "לטבלה". Shown after the game posts while a season has results.
 */
export function StandingsPost({ teams = [], round = null, myTeamIds = new Set() }) {
  const top = [...teams].filter(t => ageOf(t) === DEFAULT_AGE).sort(standingsComparator).slice(0, 4)
  if (!top.length || !top.some(t => (t.points || 0) > 0 || (t.wins || 0) + (t.ties || 0) + (t.losses || 0) > 0)) return null
  return (
    <article className="bg-surface -mx-4 sm:mx-0 pb-3.5 sm:rounded-card sm:border sm:border-line" aria-label="הטבלה">
      <div className="flex items-center gap-2.5 px-4 py-3">
        <img src="/logos/mark-256.png" alt="" width="36" height="36" loading="lazy" className="size-9 rounded-full bg-surface-sunken object-contain" />
        <div className="min-w-0 flex-1">
          <p className="text-[14px] font-bold text-fg-strong">ליגת הוקי גלגיליות</p>
          <p className="text-[12px] text-fg-muted">{round ? `הטבלה אחרי מחזור ${round}` : "הטבלה"}</p>
        </div>
        <Link to="/standings" className="min-h-[44px] flex items-center px-1 text-[13px] font-semibold text-fg-strong">לטבלה</Link>
      </div>
      <ol className="flex gap-2 px-4 overflow-x-auto overscroll-x-contain [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {top.map((t, i) => {
          const [a, b] = teamBanner(t)
          return (
            <li key={t.id} className="shrink-0 w-[112px] sm:flex-1 sm:w-auto">
              <Link to={entityPath('teams', t)} className={`flex flex-col gap-2 rounded-2xl p-3 ${myTeamIds.has(t.id) ? 'outline outline-2 outline-offset-2 outline-fl-accent' : ''}`}
                style={{ backgroundImage: `linear-gradient(150deg, ${a}, ${b})`, color: onColor(t) }}>
                <span className="flex items-start justify-between"><span className="fl-num text-[28px] opacity-85">{i + 1}</span><TeamLogo team={t} px={40} /></span>
                <span className="truncate text-[13px] font-bold">{t.name}</span>
                <span className="text-[12px] opacity-85"><span className="fl-num text-[22px]">{t.points || 0}</span> נק׳</span>
              </Link>
            </li>
          )
        })}
      </ol>
    </article>
  )
}
