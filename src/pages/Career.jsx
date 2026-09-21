import { useState, useEffect, useMemo, useCallback } from 'react'
import { useSearchParams } from 'react-router-dom'
import { getTeams } from '@/lib/api'
import { useSeo } from '@/lib/seo'
import { cn } from '@/lib/utils'
import { start, choose, replay, clubById, careerSummary } from '@/career/engine'
import { allClubs } from '@/career/clubs'
import { newSeed } from '@/career/rng'
import { loadSave, writeSave, clearSave, loadHall, addToHall, decodeShare } from '@/career/storage'
import PlayerHud from '@/career/components/PlayerHud'
import Timeline from '@/career/components/Timeline'
import DecisionCard from '@/career/components/DecisionCard'
import CareerCard from '@/career/components/CareerCard'
import SeasonRecap from '@/career/components/SeasonRecap'
import Landing from '@/career/components/Landing'

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
export default function Career() {
  const [params, setParams] = useSearchParams()
  const [teams, setTeams] = useState(null)
  const [config, setConfig] = useState(null)
  const [choices, setChoices] = useState([])
  const [state, setState] = useState(null)
  const [hall, setHall] = useState(() => loadHall())
  const [viewingShared, setViewingShared] = useState(false)

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

  const clubs = useMemo(() => (teams ? allClubs(teams) : []), [teams])

  // Restore: a ?c= share link wins over the local save, because following a
  // link and landing in your own half-finished career would be baffling.
  useEffect(() => {
    if (!teams) return
    const token = params.get('c')
    if (token) {
      const decoded = decodeShare(token)
      if (decoded) {
        setConfig(decoded.config)
        setChoices(decoded.choices)
        setState(replay(decoded.config, decoded.choices, teams))
        setViewingShared(true)
        return
      }
    }
    const saved = loadSave()
    if (saved?.config) {
      setConfig(saved.config)
      setChoices(saved.choices || [])
      setState(replay(saved.config, saved.choices || [], teams))
    }
  }, [teams, params])

  const begin = useCallback((identity) => {
    const cfg = { ...identity, seed: newSeed() }
    setConfig(cfg)
    setChoices([])
    setState(start(cfg, teams))
    writeSave(cfg, [])
    setViewingShared(false)
    if (params.get('c')) setParams({}, { replace: true })
  }, [teams, params, setParams])

  const pick = useCallback((key) => {
    setState((prev) => {
      const next = choose(prev, key, teams)
      const nextChoices = [...choices, key]
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
      return next
    })
    // Fresh card, fresh scroll position — on a phone the options otherwise
    // land below the fold and it reads as if nothing happened.
    requestAnimationFrame(() => window.scrollTo({ top: 0, behavior: 'smooth' }))
  }, [teams, choices, config])

  const restart = useCallback(() => {
    clearSave()
    setConfig(null)
    setChoices([])
    setState(null)
    setViewingShared(false)
    if (params.get('c')) setParams({}, { replace: true })
  }, [params, setParams])

  if (!teams) {
    return (
      <div className="max-w-5xl mx-auto px-4 py-6 space-y-4" aria-busy="true" aria-label="טוען">
        <div className="h-28 rounded-2xl bg-surface border border-line" />
        <div className="grid gap-4 lg:grid-cols-[1.15fr_0.85fr]">
          <div className="h-80 rounded-2xl bg-surface border border-line" />
          <div className="h-80 rounded-2xl bg-surface border border-line" />
        </div>
      </div>
    )
  }

  if (!config || !state) return <Landing hall={hall} teams={teams} onStart={begin} />

  const club = state.clubId ? clubById(clubs, state.clubId) : null
  const freshFrom = state.blocks.length - (state.lastBlocks?.length || 0)

  return (
    <div className="max-w-5xl mx-auto px-4 py-6">
        {viewingShared && (
          <div className="mb-4 rounded-xl border border-brand/30 bg-brand/10 p-3 text-sm text-fg flex items-center justify-between gap-3 flex-wrap">
            <span>אתה צופה בקריירה של מישהו אחר.</span>
            <button onClick={restart} className="px-3 py-1.5 rounded-lg bg-brand text-brand-fg text-xs font-semibold">
              להתחיל קריירה משלי
            </button>
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
                  {state.lastOutcome.text}
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
