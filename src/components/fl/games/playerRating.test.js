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
const games = [g("1", "A", "B", 3, 1), g("2", "B", "A", 2, 2), g("3", "A", "B", 4, 0), g("4", "A", "B", null, null)]
const row = (game_id, player_id, goals = 0, extra = {}) => ({ game_id, player_id, goals, ...extra })
const stats = [
  row("1", "ace", 2), row("2", "ace", 1), row("3", "ace", 3),
  row("1", "mid", 1), row("2", "mid", 1), row("3", "mid", 0, { blue_cards: 1 }),
  row("1", "low", 1), row("2", "low", 0, { red_cards: 1 }), row("3", "low", 0),
  row("1", "gk", 0), row("2", "gk", 0), row("3", "gk", 0),
  row("4", "ace", 9), // unplayed game — ignored
  row("1", null, 5, { is_guest_player: true }), // guest — ignored
]

describe("playerRating", () => {
  const totals = aggregate({ games, stats, players, currentSeasonId: "S1" })

  it("counts only completed games and real players", () => {
    expect(totals.get("ace")).toMatchObject({ gp: 3, goals: 6, wins: 2.5, teamGoals: 9 })
    expect(totals.size).toBe(4)
  })

  it("ranks the top scorer above the others and keeps values in 45–99", () => {
    const ace = playerCard("ace", { totals, players })
    const low = playerCard("low", { totals, players })
    expect(ace.ovr).toBeGreaterThan(low.ovr)
    for (const ax of [...ace.axes, ...low.axes]) {
      expect(ax.value).toBeGreaterThanOrEqual(45)
      expect(ax.value).toBeLessThanOrEqual(99)
    }
    expect(ace.raw).toMatchObject({ gp: 3, goals: 6 })
  })

  it("gives a clean record top discipline", () => {
    expect(playerCard("ace", { totals, players }).axes.find(a => a.key === "dis").value).toBe(99)
  })

  it("gives goalkeepers a defence axis instead of goals", () => {
    const gk = playerCard("gk", { totals, players })
    expect(gk.goalie).toBe(true)
    expect(gk.axes[0].key).toBe("def")
  })

  it("returns null for a player with no games", () => {
    expect(playerCard("nobody", { totals, players: { ...players, nobody: { team_id: "A" } } })).toBeNull()
  })
})
