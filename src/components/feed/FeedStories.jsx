import { useMemo } from "react"
import { Link } from "react-router-dom"
import TeamLogo from "@/components/TeamLogo"
import { teamBanner } from "@/lib/flTeam"
import { entityPath } from "@/lib/slugs"
import { LEAGUE_MARK } from "@/components/feed/GamePost"

const DAY = 24 * 3600 * 1000
const SEEN_RING = "linear-gradient(135deg, rgb(var(--fg-subtle) / .35), rgb(var(--fg-subtle) / .35))"
const ringOf = (team) => { const [a, b] = teamBanner(team); return `linear-gradient(135deg, ${a}, ${b})` }

/**
 * The stories row (Instagram circles, on EVERY role's feed — FeedFan / FeedCoach / LiveStory
 * boards; iOS FeedStoriesRow): live games first (both crests, red LIVE), then the league's
 * last 24 hours, then the viewer's teams (own team "הקבוצה שלי", followed teams), then
 * "עוד קבוצה". Lit ring = something new in the last 24 h, grey = nothing new.
 *
 * The web has no story player yet: a live circle opens the LiveStory sheet, the league
 * circle jumps to the newest post, a team circle opens the team page.
 */
export default function FeedStories({ liveGames = [], gamesById = {}, teamsMap = {}, feed = [], ownTeamId = null, teamIds = [], signedIn = false, onLive, onLeague }) {
  const now = Date.now()
  const { leagueLit, teamLit } = useMemo(() => {
    const recent = feed.filter(it => it.date && now - new Date(it.date).getTime() < DAY && it.type !== "external" && it.type !== "market")
    const lit = new Set()
    for (const it of recent) for (const t of it.tags || []) if (t.startsWith("team:")) lit.add(t.slice(5))
    return { leagueLit: recent.length > 0, teamLit: lit }
  }, [feed, Math.floor(now / 60000)]) // eslint-disable-line react-hooks/exhaustive-deps

  const live = liveGames
    .map(l => ({ l, g: gamesById[l.game_id] }))
    .filter(x => x.g)
    .sort((a, b) => (a.l.phase === "over") - (b.l.phase === "over"))

  const teams = teamIds.map(id => teamsMap[id]).filter(Boolean)
  if (!live.length && !leagueLit && !teams.length && !signedIn) return null

  return (
    <nav aria-label="סטוריז" className="-mx-4 sm:mx-0">
      <ul className="flex gap-3.5 px-4 sm:px-0 pt-2 pb-3 overflow-x-auto overscroll-x-contain [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {live.map(({ l, g }) => {
          const home = teamsMap[g.home_team_id], away = teamsMap[g.away_team_id]
          const ended = l.phase === "over"
          return (
            <li key={`live-${g.id}`}>
              <StoryButton onClick={() => onLive?.(l)} label={ended ? "סיום" : (home?.name || "משחק חי")}
                aria={`${ended ? "הסתיים" : "שידור חי"}: ${home?.name || ""} נגד ${away?.name || ""}`}
                ring={ended ? SEEN_RING : `linear-gradient(135deg, ${teamBanner(away)[0]}, ${teamBanner(home)[0]})`} bold={!ended}
                badge={!ended && <span className="absolute -bottom-1 left-1/2 -translate-x-1/2 rounded-md bg-fl-live px-1.5 py-px text-[10px] font-extrabold text-white ring-2 ring-surface-page">LIVE</span>}>
                <span dir="rtl" className="flex items-center justify-center -space-x-1">
                  <TeamLogo team={home} px={30} disc={false} />
                  <TeamLogo team={away} px={30} disc={false} />
                </span>
              </StoryButton>
            </li>
          )
        })}
        {leagueLit && (
          <li>
            <StoryButton onClick={onLeague} label="ליגת הוקי" aria="החדש בליגה מ-24 השעות האחרונות"
              ring="linear-gradient(135deg, rgb(var(--fl-accent)), rgb(var(--fl-live)))" bold>
              <img src={LEAGUE_MARK} alt="" className="size-11 object-contain" />
            </StoryButton>
          </li>
        )}
        {teams.map(t => (
          <li key={t.id}>
            <StoryLink to={entityPath("teams", t)} label={t.id === ownTeamId ? "הקבוצה שלי" : t.name}
              ring={teamLit.has(t.id) ? ringOf(t) : SEEN_RING} bold={teamLit.has(t.id)}>
              <TeamLogo team={t} px={44} disc={false} />
            </StoryLink>
          </li>
        ))}
        {signedIn && (
          <li>
            <Link to="/teams" aria-label="לעקוב אחרי עוד קבוצה" className="flex w-[74px] flex-col items-center gap-1.5 text-fg-strong">
              <span className="flex size-[74px] items-center justify-center rounded-full border-2 border-dashed border-line-strong">
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14" /></svg>
              </span>
              <span className="text-[12px] font-semibold text-fg-muted whitespace-nowrap">עוד קבוצה</span>
            </Link>
          </li>
        )}
      </ul>
    </nav>
  )
}

function Circle({ ring, children }) {
  return (
    <span className="relative block size-[74px] rounded-full p-[3px]" style={{ backgroundImage: ring }}>
      <span className="block size-full rounded-full bg-surface-page p-[2.5px]">
        <span className="flex size-full items-center justify-center overflow-hidden rounded-full bg-[#FAF9F6]">{children}</span>
      </span>
    </span>
  )
}

function Label({ text, bold }) {
  return <span className={`max-w-[74px] truncate text-[12px] text-fg-strong ${bold ? "font-semibold" : "font-medium text-fg-muted"}`}>{text}</span>
}

function StoryButton({ onClick, label, aria, ring, bold, badge = null, children }) {
  return (
    <button type="button" onClick={onClick} aria-label={aria || label} className="flex w-[74px] flex-col items-center gap-1.5">
      <span className="relative"><Circle ring={ring}>{children}</Circle>{badge}</span>
      <Label text={label} bold={bold} />
    </button>
  )
}

function StoryLink({ to, label, ring, bold, children }) {
  return (
    <Link to={to} className="flex w-[74px] flex-col items-center gap-1.5">
      <Circle ring={ring}>{children}</Circle>
      <Label text={label} bold={bold} />
    </Link>
  )
}
