/**
 * Turning a save (or a share link) back into a career.
 *
 * New careers carry their league frozen in the config (see snapshotLeague in
 * clubs.js), so they replay exactly, forever. Careers saved before that freeze
 * were built against whatever the live table said on the day — and we don't
 * know which day. So for those we try the league states they could plausibly
 * have been made against (live standings, or the zeroed table from before the
 * season started; with and without the admin-only test teams), keep whichever
 * replays furthest, and freeze THAT into the config so it never drifts again.
 */
import { replay } from './engine.js'
import { snapshotLeague, leagueTeams } from './clubs.js'

export function restoreCareer(config, choices, liveTeams) {
  const run = (league) => {
    const teams = leagueTeams(league, liveTeams)
    const state = replay(config, choices, teams)
    return { league, teams, state }
  }

  let best
  if (config.league) {
    best = run(config.league)
  } else {
    // Order matters: a wrong world can still accept every move, so the first
    // full replay wins. The zeroed table comes first because it covers the
    // whole pre-season stretch the game was live for (2026-09-21 → the first
    // game day); after that each game day is a different world we no longer
    // have, and today's table is the best remaining guess.
    const candidates = [
      { keepTest: false, zeroed: true },
      { keepTest: true, zeroed: true },
      { keepTest: false, zeroed: false },
      { keepTest: true, zeroed: false },
    ]
    for (const opts of candidates) {
      const r = run(snapshotLeague(liveTeams, { v: 1, ...opts }))
      if (!best || r.state.step > best.state.step) best = r
      if (r.state.step === choices.length) break
    }
  }

  const applied = best.state.step
  return {
    config: { ...config, league: best.league },
    choices: choices.slice(0, applied),
    state: best.state,
    teams: best.teams,
    // Some moves couldn't be replayed — the career resumes from the last one
    // that could, and the page says so rather than pretending nothing happened.
    partial: applied < choices.length,
  }
}
