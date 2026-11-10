import { describe, expect, it } from "vitest"
import { aggregate, playerCard, minGamesFor } from "./playerRating"

const g = (id, home, away, hs, as, season = "S1") =>
  ({ id, home_team_id: home, away_team_id: away, home_score: hs, away_score: as, season_id: season })

const players = {
  ace: { team_id: "A", position: "Field Player" },
  mid: { team_id: "A", position: "Field Player" },
  low: { team_id: "B", position: "Field Player" },
  gk: { team_id: "B", position: "Goalkeeper" },
  new: { team_id: "A", position: "Field Player" },
}
// S1 = this season; S0 = last season, which must NOT count
const games = [
  g("1", "A", "B", 3, 1), g("2", "B", "A", 2, 2), g("3", "A", "B", 4, 0), g("4", "A", "B", 5, 5),
  g("9", "A", "B", 9, 0, "S0"), g("5", "A", "B", null, null),
]
const row = (game_id, player_id, goals = 0, extra = {}) => ({ game_id, player_id, goals, ...extra })
const stats = [
  row("1", "ace", 2), row("2", "ace", 1), row("3", "ace", 3), row("4", "ace", 0),
  row("1", "mid", 1), row("2", "mid", 1), row("3", "mid", 0),
  row("1", "low", 1), row("2", "low", 0), row("3", "low", 0),
  row("1", "gk", 0), row("2", "gk", 0), row("3", "gk", 0),
  row("4", "new", 4), // one game only
  row("9", "ace", 7), // last season — ignored
  row("5", "ace", 9), // unplayed game — ignored
  row("1", null, 5, { is_guest_player: true }), // guest — ignored
]

describe("playerRating", () => {
  const totals = aggregate({ games, stats, players, currentSeasonId: "S1" })
  const fans = { ace: 4, low: 1 }
  const card = id => playerCard(id, { totals, players, fans })
  const axis = (id, key) => card(id).axes.find(a => a.key === key)

  it("counts only this season's completed games, and real players only", () => {
    expect(totals.get("ace")).toMatchObject({ gp: 4, sgoals: 6, tgp: 4, scored: 14, conceded: 8 })
    expect(totals.size).toBe(5)
  })

  it("shows the real numbers on each axis", () => {
    const by = Object.fromEntries(card("ace").axes.map(a => [a.key, a.shown]))
    expect(by).toEqual({ goals: "6", exp: "4", att: "3.5", def: "2.0", fans: "4" })
  })

  it("draws every point against the best in the group, and says who the best is", () => {
    // goals: low 1, best (ace) 6
    expect(axis("low", "goals").pct).toBeCloseTo(1 / 6)
    expect(axis("low", "goals").bestShown).toBe("6")
    // defence: fewest conceded is best → best / his
    const d = axis("low", "def")
    expect(d.pct).toBeCloseTo(d.best / d.value)
    // fans: out of at least 10
    expect(axis("low", "fans").pct).toBeCloseTo(0.1)
  })

  it("needs half the most games played (rounded up) for attack, defence and a rating", () => {
    expect(minGamesFor(3)).toBe(2)
    expect(minGamesFor(16)).toBe(8)
    expect(minGamesFor(0)).toBe(1)
    // most games = 4 → minimum 2; "new" has 1
    const c = card("new")
    expect(c.minGames).toBe(2)
    expect(c.ovr).toBeNull()
    expect(c.axes.find(a => a.key === "att").shown).toBe("–")
    expect(card("ace").ovr).not.toBeNull()
  })

  it("keeps fans out of the rating", () => {
    const a = playerCard("low", { totals, players, fans: {} }).ovr
    const b = playerCard("low", { totals, players, fans: { low: 9 } }).ovr
    expect(b).toBe(a)
  })

  it("ranks the better player higher", () => {
    expect(card("ace").ovr).toBeGreaterThan(card("low").ovr)
  })

  it("credits a loan game to the team he played for", () => {
    const t = aggregate({ games, stats: [row("1", "low", 0, { played_for_team_id: "A" })], players, currentSeasonId: "S1" })
    expect(t.get("low")).toMatchObject({ scored: 3, conceded: 1 })
  })

  it("skips friendlies and tournament games, like the league table", () => {
    const extra = [...games, { ...g("6", "A", "B", 9, 0), game_type: "ידידותי" }, { ...g("7", "A", "B", 9, 0), tournament_id: "T" }]
    const t = aggregate({ games: extra, stats: [...stats, row("6", "ace", 5), row("7", "ace", 5)], players, currentSeasonId: "S1" })
    expect(t.get("ace").gp).toBe(4)
  })

  it("returns null for a player with no games", () => {
    expect(playerCard("nobody", { totals, players: { ...players, nobody: { team_id: "A" } } })).toBeNull()
  })
})
