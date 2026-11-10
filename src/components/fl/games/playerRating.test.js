import { describe, expect, it } from "vitest"
import { aggregate, playerCard } from "./playerRating"

const g = (id, home, away, hs, as, season = "S1") =>
  ({ id, home_team_id: home, away_team_id: away, home_score: hs, away_score: as, season_id: season })

const players = {
  ace: { team_id: "A", position: "Field Player" },
  mid: { team_id: "A", position: "Field Player" },
  low: { team_id: "B", position: "Field Player" },
  gk: { team_id: "B", position: "Goalkeeper" },
}
// last season (S0) counts too
const games = [g("1", "A", "B", 3, 1), g("2", "B", "A", 2, 2), g("3", "A", "B", 4, 0, "S0"), g("4", "A", "B", null, null)]
const row = (game_id, player_id, goals = 0, extra = {}) => ({ game_id, player_id, goals, ...extra })
const stats = [
  row("1", "ace", 2), row("2", "ace", 1), row("3", "ace", 3),
  row("1", "mid", 1), row("2", "mid", 1), row("3", "mid", 0),
  row("1", "low", 1), row("2", "low", 0), row("3", "low", 0),
  row("1", "gk", 0), row("2", "gk", 0), row("3", "gk", 0),
  row("4", "ace", 9), // unplayed game — ignored
  row("1", null, 5, { is_guest_player: true }), // guest — ignored
]

describe("playerRating", () => {
  const totals = aggregate({ games, stats, players, currentSeasonId: "S1" })
  const fans = { ace: 4, low: 1 }

  it("counts every season's completed games, and real players only", () => {
    expect(totals.get("ace")).toMatchObject({ gp: 3, goals: 6, sgoals: 3, tgp: 3, scored: 9, conceded: 3 })
    expect(totals.size).toBe(4)
  })

  it("shows the real numbers on each axis — goals from this season only", () => {
    const ace = playerCard("ace", { totals, players, fans })
    const by = Object.fromEntries(ace.axes.map(a => [a.key, a.shown]))
    expect(by).toEqual({ goals: "3", exp: "3", att: "3.0", def: "1.0", fans: "4" })
  })

  it("treats fewer goals conceded as the better defence", () => {
    const ace = playerCard("ace", { totals, players, fans })
    const low = playerCard("low", { totals, players, fans })
    const def = c => c.axes.find(a => a.key === "def").pct
    expect(def(ace)).toBeGreaterThan(def(low))
    expect(ace.ovr).toBeGreaterThan(low.ovr)
    expect(ace.ovr).toBeLessThanOrEqual(99)
  })

  it("draws counts against the league's best, so one fan stays small", () => {
    const low = playerCard("low", { totals, players, fans })
    expect(low.axes.find(a => a.key === "fans").pct).toBeCloseTo(0.1) // 1 of a 10-fan floor
    const ace = playerCard("ace", { totals, players, fans })
    expect(ace.axes.find(a => a.key === "goals").pct).toBe(1) // league top scorer this season
  })

  it("returns null for a player with no games", () => {
    expect(playerCard("nobody", { totals, players: { ...players, nobody: { team_id: "A" } } })).toBeNull()
  })
})
