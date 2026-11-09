import { useState, useEffect, useMemo, useCallback } from 'react'
import { useSearchParams } from 'react-router-dom'
import { getTeams } from '@/lib/api'
import { useSeo } from '@/lib/seo'
import { cn } from '@/lib/utils'
import { start, choose, clubById, careerSummary, RULES_VERSION } from '@/career/engine'
import { allClubs, snapshotLeague, leagueTeams } from '@/career/clubs'
import { restoreCareer } from '@/career/restore'
import { newSeed } from '@/career/rng'
import { loadSave, writeSave, clearSave, loadHall, addToHall, decodeShare } from '@/career/storage'
import PlayerHud from '@/career/components/PlayerHud'
import Timeline from '@/career/components/Timeline'
import DecisionCard from '@/career/components/DecisionCard'
import CareerCard from '@/career/components/CareerCard'
import SeasonRecap from '@/career/components/SeasonRecap'
import Landing from '@/career/components/Landing'
import { CareerSkeleton } from "@/components/skeletons/PageSkeletons"

/**
 * "ליגיונר על גלגלים" — a career simulator for Israeli rink hockey.
 *
 * The shape is borrowed from the seed-and-choices career games doing well in
 * Israel right now, and the engine (src/career/) is our own: a pure function
 * from {seed, choices} to a whole career. Three things follow from that, and
 * they're the reason this page is as simple as it is —
 *
 *   · No backend. A career is ~400 bytes in localStorage.
 *   · A share link is the save, so anyone can open someone else's career and
 *     watch it replay, move for move.
 *   · The league you start in is OUR league: the clubs come from the real
 *     `teams` table, so the youth side you sign for is a club that exists.
 *
 * The only network call on this page is that team fetch, and it's cached for
 * the session.
 */
/**
 * Event results end in effects like "+2 OVR" or "-4 OVR, -3 פוטנציאל". In an
 * RTL line the bidi algorithm moves the sign to the end ("OVR 1-"), so each
 * signed number is isolated as its own left-to-right run.
 */
function OutcomeText({ text }) {
  const parts = text.split(/([+-]\d+(?:\s?OVR)?)/)
  return parts.map((p, i) =>
    i % 2 ? (
      <span key={i} dir="ltr" className="tabular-nums whitespace-nowrap">
        {p.replace('-', '−')}
      </span>
    ) : (
      p
    )
  )
}

export default function Career() {
  const [params, setParams] = useSearchParams()
  const [teams, setTeams] = useState(null)
  const [config, setConfig] = useState(null)
  const [choices, setChoices] = useState([])
  const [state, setState] = useState(null)
  const [hall, setHall] = useState(() => loadHall())
  const [viewingShared, setViewingShared] = useState(false)
  const [ownShared, setOwnShared] = useState(false)
  const [partial, setPartial] = useState(false)

  useSeo({
    title: config?.lastName ? `${config.lastName} · ליגיונר על גלגלים` : 'ליגיונר על גלגלים',
    description:
      'בנה קריירה של שחקן הוקי גלגיליות ישראלי — ממחלקת נוער בליגה הישראלית ועד ליגות הצמרת באירופה.',
    path: '/career',
  })

  // Real clubs, real crests. A career that starts at "מכבי דמו" is a demo.
  useEffect(() => {
    let alive = true
    getTeams('name', true)
      .then((rows) => {
        if (!alive) return
        const usable = (rows || []).filter((t) => t?.name)
        setTeams(usable)
      })
      .catch(() => alive && setTeams([]))
    return () => { alive = false }
  }, [])

  // The engine never sees the live table: it plays the league frozen into
  // this career's config, decorated with today's names and crests.
  const world = useMemo(
    () => (config?.league && teams ? leagueTeams(config.league, teams) : []),
    [config, teams]
  )
  const clubs = useMemo(() => allClubs(world), [world])
  // Admin-only test teams are visible to admins through RLS; keep them off
  // the landing ladder (new careers drop them in snapshotLeague too).
  const publicTeams = useMemo(() => (teams || []).filter((t) => !/^\s*🧪/.test(t.name)), [teams])

  // Restore: a ?c= share link wins over the local save, because following a
  // link and landing in your own half-finished career would be baffling.
  useEffect(() => {
    if (!teams) return
    const token = params.get('c')
    const decoded = token ? decodeShare(token) : null
    const saved = loadSave()
    const source = decoded || (saved?.config ? { config: saved.config, choices: saved.choices || [] } : null)
    if (!source) {
      setConfig(null); setChoices([]); setState(null); setViewingShared(false); setPartial(false)
      return
    }
    const r = restoreCareer(source.config, source.choices, teams)
    setConfig(r.config)
    setChoices(r.choices)
    setState(r.state)
    setPartial(r.partial)
    if (decoded) {
      const seed = decoded.config.seed
      setViewingShared(true)
      setOwnShared(saved?.config?.seed === seed || loadHall().some((h) => h.seed === seed))
    } else {
      setViewingShared(false)
      // Upgrade an old save in place, so it's frozen from now on.
      writeSave(r.config, r.choices)
    }
  }, [teams, params])

  const begin = useCallback((identity) => {
    const cfg = { ...identity, seed: newSeed(), rules: RULES_VERSION, league: snapshotLeague(teams) }
    const w = leagueTeams(cfg.league, teams)
    setConfig(cfg)
    setChoices([])
    setState(start(cfg, w))
    setPartial(false)
    writeSave(cfg, [])
    setViewingShared(false)
    if (params.get('c')) setParams({}, { replace: true })
    // The setup form is long on a phone; without this the career opens
    // scrolled past the player card.
    requestAnimationFrame(() => window.scrollTo({ top: 0 }))
  }, [teams, params, setParams])

  // Computed from the rendered state rather than inside a setState updater:
  // the updater ran side effects (save, hall) and read `choices` from a stale
  // closure, so a fast double-tap could save a move list that didn't match the
  // career on screen.
  const pick = useCallback((key) => {
    if (!state?.pending || !state.pending.options.some((o) => o.key === key)) return
    const next = choose(state, key, world)
    const nextChoices = [...choices, key]
    setState(next)
    setChoices(nextChoices)
    writeSave(config, nextChoices)
    if (next.retired) {
      const sum = careerSummary(next)
      setHall(addToHall({
        seed: config.seed,
        lastName: config.lastName,
        peak: sum.peak,
        seasons: sum.seasons,
        goals: sum.goals,
        trophies: sum.trophies.length,
        topBand: sum.topBandLabel,
        at: Date.now(),
      }))
    }
    // Fresh card, fresh scroll position — on a phone the options otherwise
    // land below the fold and it reads as if nothing happened.
    requestAnimationFrame(() => window.scrollTo({ top: 0, behavior: 'smooth' }))
  }, [state, world, choices, config])

  const restart = useCallback(() => {
    clearSave()
    setConfig(null)
    setChoices([])
    setState(null)
    setPartial(false)
    setViewingShared(false)
    if (params.get('c')) setParams({}, { replace: true })
  }, [params, setParams])

  // Leaving someone else's career must not touch your own save: drop the
  // link and let the restore effect bring back whatever you had going.
  const leaveShared = useCallback(() => {
    setParams({}, { replace: true })
    requestAnimationFrame(() => window.scrollTo({ top: 0 }))
  }, [setParams])

  if (!teams) return <CareerSkeleton />

  if (!config || !state) return <Landing hall={hall} teams={publicTeams} onStart={begin} />

  const club = state.clubId ? clubById(clubs, state.clubId) : null
  const freshFrom = state.blocks.length - (state.lastBlocks?.length || 0)

  return (
    <div className="max-w-5xl mx-auto px-4 py-6">
        {viewingShared && (
          <div className="mb-4 rounded-xl border border-brand/30 bg-brand/10 p-3 text-sm text-fg flex items-center justify-between gap-3 flex-wrap">
            <span>{ownShared ? 'זה הקישור לקריירה שלך — ככה חברים יראו אותה.' : 'אתה צופה בקריירה של מישהו אחר.'}</span>
            <button onClick={leaveShared} className="px-3 py-1.5 rounded-lg bg-brand text-brand-fg text-xs font-semibold">
              {loadSave()?.config ? 'חזרה לקריירה שלי' : 'להתחיל קריירה משלי'}
            </button>
          </div>
        )}

        {partial && !viewingShared && (
          <div className="mb-4 rounded-xl border border-line bg-surface p-3 text-sm text-fg text-pretty">
            חלק מהמהלכים בקריירה הזו נשמרו לפני עדכון של המשחק ולא ניתן היה לשחזר אותם. הקריירה ממשיכה מהמהלך האחרון ששוחזר.
          </div>
        )}
        {partial && viewingShared && (
          <div className="mb-4 rounded-xl border border-line bg-surface p-3 text-sm text-fg text-pretty">
            הקישור נוצר לפני עדכון של המשחק, ולכן הקריירה מוצגת רק עד המהלך האחרון שאפשר היה לשחזר.
          </div>
        )}

        {/* Information architecture: identity (full width), then the
            decision you have to make, then the history behind it. The first
            version put the timeline in a column of equal weight, so the least
            actionable panel on the page was also the largest — and on a phone
            you scrolled past twenty rows of table to reach the question you
            were being asked. */}
        <div className="space-y-4">
          <PlayerHud state={state} club={club} />

          <div className="grid gap-4 lg:grid-cols-[1.15fr_0.85fr] items-start">
            <div className="space-y-4 min-w-0">
              {/* The event outcome is what happened BEFORE the seasons that
                  follow it, so it renders above the recap — inside the
                  decision card it read as a comment on a season it preceded. */}
              {state.lastOutcome && (
                <div
                  key={`outcome-${state.step}`}
                  className={cn(
                    'rounded-2xl border p-3 text-sm text-pretty career-enter',
                    state.lastOutcome.good
                      ? 'bg-success-500/10 border-success-500/30 text-success-700 dark:text-success-300'
                      : 'bg-danger-500/10 border-danger-500/30 text-danger-700 dark:text-danger-300'
                  )}
                >
                  <div className="text-2xs opacity-70 mb-0.5">{state.lastOutcome.title}</div>
                  <OutcomeText text={state.lastOutcome.text} />
                </div>
              )}

              {/* Keyed on step so the recap re-mounts and its entry animation
                  replays on every decision, instead of silently swapping text. */}
              <SeasonRecap
                key={`recap-${state.step}`}
                blocks={state.lastBlocks}
                isGoalkeeper={state.player.archetype === 'goalkeeper'}
              />

              {state.retired ? (
                <CareerCard state={state} config={config} choices={choices} onRestart={restart} />
              ) : (
                <DecisionCard card={state.pending} overall={state.player.overall} onPick={pick} />
              )}
            </div>

            <div className="min-w-0 lg:sticky lg:top-20">
              <Timeline blocks={state.blocks} highlightFrom={freshFrom} />
            </div>
          </div>
        </div>
    </div>
  )
}
