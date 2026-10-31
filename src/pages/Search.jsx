import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { getTeams, getPlayers, getGames } from '@/lib/api'
import { entityPath } from '@/lib/slugs'
import TeamLogo from '@/components/TeamLogo'
import { LineIcon } from '@/components/fl/shell/FLShell'
import { FLScore } from '@/components/fl/Floodlight'
import { BrandIcon } from '@/components/icons/BrandIcons'

const TZ = 'Asia/Jerusalem'
const GAMES_SHOWN = 12

/**
 * League search (the header magnifier + the "עוד" sheet): teams, players and games,
 * matched as you type. The lists load once (games only on the first typed letter)
 * and every keystroke filters them locally — no network per key.
 * Look: PlusMore board (44px search field, 13px/800 group heads, card rows).
 */
export default function Search() {
  const [params, setParams] = useSearchParams()
  const [q, setQ] = useState(params.get('q') || '')
  const [teams, setTeams] = useState([])
  const [players, setPlayers] = useState([])
  const [games, setGames] = useState(null)
  const [loading, setLoading] = useState(true)
  const input = useRef(null)
  const gamesAsked = useRef(false)

  useEffect(() => { input.current?.focus() }, [])
  useEffect(() => {
    Promise.all([getTeams().catch(() => []), getPlayers().catch(() => [])])
      .then(([t, p]) => { setTeams(t || []); setPlayers(p || []) })
      .finally(() => setLoading(false))
  }, [])
  useEffect(() => {
    const t = setTimeout(() => setParams(q.trim() ? { q: q.trim() } : {}, { replace: true }), 250)
    return () => clearTimeout(t)
  }, [q, setParams])

  const term = q.trim()
  // Games are the heaviest list and only matter once someone searches: fetch on the
  // first letter, once.
  useEffect(() => {
    if (!term || gamesAsked.current) return
    gamesAsked.current = true
    getGames().then(g => setGames(g || [])).catch(() => setGames([]))
  }, [term])

  const teamById = useMemo(() => Object.fromEntries(teams.map((t) => [t.id, t])), [teams])
  const tHits = term ? teams.filter((t) => t.name?.includes(term) || t.city?.includes(term)) : []
  const pHits = term ? players.filter((p) => `${p.first_name} ${p.last_name}`.includes(term)).slice(0, 40) : []
  const gHits = useMemo(() => {
    if (!term || !games) return []
    const ids = new Set(teams.filter(t => t.name?.includes(term) || t.city?.includes(term)).map(t => t.id))
    if (!ids.size) return []
    const now = Date.now()
    const hit = games.filter(g => g.game_date && (ids.has(g.home_team_id) || ids.has(g.away_team_id))
      && teamById[g.home_team_id] && teamById[g.away_team_id])
    // Coming games first (soonest), then the most recent results.
    const next = hit.filter(g => new Date(g.game_date) >= now && g.status !== 'completed')
      .sort((a, b) => new Date(a.game_date) - new Date(b.game_date))
    const past = hit.filter(g => !next.includes(g)).sort((a, b) => new Date(b.game_date) - new Date(a.game_date))
    // Half and half when there are both, so recent results are not pushed out.
    const n = Math.min(next.length, Math.max(GAMES_SHOWN / 2, GAMES_SHOWN - past.length))
    return [...next.slice(0, n), ...past.slice(0, GAMES_SHOWN - n)]
  }, [term, games, teams, teamById])

  const nothing = term && !loading && !tHits.length && !pHits.length && !gHits.length && games !== null

  return (
    <div className="max-w-2xl mx-auto px-3 sm:px-4 pt-4 pb-10">
      <h1 className="text-[24px] font-extrabold text-fg-strong px-1 mb-3">חיפוש</h1>
      <label className="flex items-center gap-2 h-11 px-3 rounded-control bg-surface text-fg-muted focus-within:ring-2 focus-within:ring-fl-accent">
        <LineIcon name="search" size={20} />
        <span className="sr-only">חיפוש שחקן, קבוצה או משחק</span>
        <input ref={input} type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="שחקן, קבוצה או משחק"
          enterKeyHint="search" className="flex-1 min-w-0 bg-transparent text-[16px] text-fg-strong placeholder:text-fg-subtle outline-none [&::-webkit-search-cancel-button]:hidden" />
        {q && (
          <button type="button" onClick={() => { setQ(''); input.current?.focus() }} aria-label="ניקוי"
            className="w-9 h-9 -me-1.5 rounded-full grid place-items-center text-fg-muted hover:text-fg-strong">
            <LineIcon name="close" size={16} />
          </button>
        )}
      </label>

      {!term && (
        <div className="mt-10 flex flex-col items-center text-center gap-2 text-fg-muted">
          <BrandIcon name="player-pose-1" variant="large" className="w-16 h-16 opacity-90" />
          <p className="text-[15px]">הקלידו שם של שחקן או קבוצה.</p>
          <p className="text-[13px]">משחקים נמצאים לפי שם הקבוצה.</p>
        </div>
      )}
      {nothing && (
        <div className="mt-10 text-center">
          <p className="text-[15.5px] font-extrabold text-fg-strong">לא מצאנו את „{term}”</p>
          <p className="text-[13px] text-fg-muted mt-1">נסו שם אחר, או רק חלק ממנו.</p>
        </div>
      )}

      {tHits.length > 0 && (
        <Group title="קבוצות" n={tHits.length}>
          {tHits.map((t) => (
            <li key={t.id}>
              <Link to={entityPath('teams', t) || `/teams/${t.id}`} className="flex items-center gap-3 px-3.5 min-h-[60px] hover:bg-surface-inset">
                <TeamLogo team={t} px={40} />
                <span className="font-bold text-fg-strong truncate">{t.name}</span>
                {t.city && <span className="text-[13px] text-fg-muted truncate">{t.city}</span>}
              </Link>
            </li>
          ))}
        </Group>
      )}

      {pHits.length > 0 && (
        <Group title="שחקנים" n={pHits.length}>
          {pHits.map((p) => (
            <li key={p.id}>
              <Link to={entityPath('players', p) || `/players/${p.id}`} className="flex items-center gap-3 px-3.5 min-h-[56px] hover:bg-surface-inset">
                <TeamLogo team={teamById[p.team_id]} px={32} />
                <span className="min-w-0 flex flex-col">
                  <span className="font-bold text-fg-strong truncate">{p.first_name} {p.last_name}</span>
                  <span className="text-[12.5px] text-fg-muted truncate">{teamById[p.team_id]?.name}</span>
                </span>
                {p.jersey_number != null && <span className="ms-auto fl-num text-fg-muted shrink-0" dir="ltr">#{p.jersey_number}</span>}
              </Link>
            </li>
          ))}
        </Group>
      )}

      {gHits.length > 0 && (
        <Group title="משחקים" n={gHits.length}>
          {gHits.map((g) => <GameRow key={g.id} game={g} home={teamById[g.home_team_id]} away={teamById[g.away_team_id]} />)}
        </Group>
      )}
      {term && games === null && tHits.length > 0 && (
        <div className="mt-5 space-y-2" aria-busy="true">
          <span className="skeleton block h-4 w-20 rounded" />
          <span className="skeleton block h-[60px] rounded-card" />
        </div>
      )}
    </div>
  )
}

function Group({ title, n, children }) {
  return (
    <section className="mt-5" aria-label={title}>
      <h2 className="px-1 mb-2 text-[13px] font-extrabold text-fg-muted">{title} <span className="fl-num">{n}</span></h2>
      <ul className="fl-card divide-y divide-line overflow-hidden">{children}</ul>
    </section>
  )
}

/** A game hit: home crest/name on the RIGHT, the score (or kick-off) between. */
function GameRow({ game, home, away }) {
  const d = new Date(game.game_date)
  const date = d.toLocaleDateString('he-IL', { day: 'numeric', month: 'numeric', timeZone: TZ })
  const time = d.toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit', timeZone: TZ })
  const done = game.status === 'completed' && game.home_score != null && game.away_score != null
  return (
    <li>
      <Link to={entityPath('games', game) || `/games/${game.id}`} aria-label={`${home.name} נגד ${away.name}, ${date}`}
        className="flex items-center gap-2 px-3.5 min-h-[60px] hover:bg-surface-inset">
        <span className="flex items-center gap-2 flex-1 min-w-0">
          <TeamLogo team={home} px={28} />
          <span className="text-[13.5px] font-bold text-fg-strong truncate">{home.name}</span>
        </span>
        <span className="flex flex-col items-center shrink-0 px-1 min-w-[64px]">
          {done
            ? <FLScore home={game.home_score} away={game.away_score} size={17} className="text-fg-strong" />
            : <span className="fl-num text-[15px] text-fg-strong" dir="ltr">{time}</span>}
          <span className="text-[11px] text-fg-muted" dir="ltr">{date}</span>
        </span>
        <span className="flex items-center gap-2 flex-1 min-w-0 justify-end">
          <span className="text-[13.5px] font-bold text-fg-strong truncate">{away.name}</span>
          <TeamLogo team={away} px={28} />
        </span>
      </Link>
    </li>
  )
}
