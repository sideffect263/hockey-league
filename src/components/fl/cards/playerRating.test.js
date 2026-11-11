import { describe, expect, it } from "vitest"
import { aggregate, playerCard, MIN_GP, WEIGHTS } from "./playerRating"

const g = (id, home, away, hs, as, season = "S1") =>
  ({ id, home_team_id: home, away_team_id: away, home_score: hs, away_score: as, season_id: season })

const players = {
  ace: { team_id: "A", position: "Field Player" },
  mid: { team_id: "A", position: "Field Player" },
  low: { team_id: "B", position: "Field Player" },
  gk: { team_id: "B", position: "Goalkeeper" },
  new: { team_id: "A", position: "Field Player" },
}
// S1 = this season; S0 = last season: games count, goals don't
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
  row("9", "ace", 7), // last season — a game, but not a goal this season
  row("5", "ace", 9), // unplayed game — ignored
  row("1", null, 5, { is_guest_player: true }), // guest — ignored
]

describe("playerRating", () => {
  const totals = aggregate({ games, stats, players, currentSeasonId: "S1" })
  const fans = { ace: 4, low: 1 }
  const card = id => playerCard(id, { totals, players, fans })
  const axis = (id, key) => card(id).axes.find(a => a.key === key)

  it("counts every season's games, goals from this season only, and real players only", () => {
    expect(totals.get("ace")).toMatchObject({ gp: 5, sgoals: 6, tgp: 5, scored: 23, conceded: 8 })
    expect(totals.size).toBe(5)
  })

  it("keeps the real figure behind each axis", () => {
    const by = Object.fromEntries(card("ace").axes.map(a => [a.key, a.raw]))
    expect(by).toEqual({ goals: "6", exp: "5", att: "4.6", def: "1.6", fans: "4" })
  })

  it("shows every axis as a 0–99 score: the best in the group gets 99", () => {
    for (const ax of card("ace").axes) {
      expect(ax.shown).toBe(String(Math.round(99 * ax.pct)))
      expect(ax.score).toBeGreaterThanOrEqual(0)
      expect(ax.score).toBeLessThanOrEqual(99)
    }
    expect(axis("ace", "goals").shown).toBe("99") // ace has the most goals
    expect(axis("low", "goals").shown).toBe("17") // 1 of 6
    expect(axis("low", "fans").shown).toBe("10")  // 1 fan, out of at least 10
  })

  it("shows defence as a score where higher is better, keeping the real conceded average", () => {
    // ace's team conceded 1.6 a game; the best field player's (mid) 1.0 → 99 × 1.0 / 1.6 = 62
    const ace = axis("ace", "def"), mid = axis("mid", "def"), low = axis("low", "def")
    expect(ace.conceded).toBeCloseTo(1.6)
    expect(mid.shown).toBe("99")
    expect(Number(mid.shown)).toBeGreaterThan(Number(ace.shown))
    expect(Number(ace.shown)).toBeGreaterThan(Number(low.shown)) // low's team conceded 3.0
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

  it("needs 3 games for attack, defence and a rating", () => {
    const c = card("new") // 1 game
    expect(c.minGames).toBe(MIN_GP)
    expect(c.ovr).toBeNull()
    expect(c.axes.find(a => a.key === "att").shown).toBe("–")
    expect(card("ace").ovr).not.toBeNull()
  })

  it("counts fans in the rating, but only a little", () => {
    expect(WEIGHTS.fans).toBeLessThan(0.1)
    expect(Object.values(WEIGHTS).reduce((a, b) => a + b, 0)).toBeCloseTo(1)
    const a = playerCard("low", { totals, players, fans: {} }).ovr
    const b = playerCard("low", { totals, players, fans: { low: 10 } }).ovr
    expect(b - a).toBe(Math.round(59 * WEIGHTS.fans)) // 0 → 10 fans: +3
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
    expect(t.get("ace").gp).toBe(5) // 4 this season + 1 last season, no friendly/tournament
  })

  it("gives goalkeepers clean sheets (all seasons) instead of goals", () => {
    // B keeps a clean sheet this season (game 8, 2–0) and last season (game 10, 1–0)
    const g2 = [...games, g("8", "B", "A", 2, 0), g("10", "B", "A", 1, 0, "S0")]
    const st2 = [...stats, row("8", "gk", 0), row("8", "low", 0), row("10", "gk", 0)]
    const t = aggregate({ games: g2, stats: st2, players, currentSeasonId: "S1" })
    const gk = playerCard("gk", { totals: t, players })
    const ax = gk.axes.find(a => a.key === "goals")
    expect(ax.label).toBe("שערים נקיים")
    expect(ax.raw).toBe("2") // game 8 this season + game 10 last season
    // a field player in the same game still shows goals
    expect(playerCard("low", { totals: t, players }).axes.find(a => a.key === "goals").label).toBe("שערים")
  })

  it("returns null for a player with no games", () => {
    expect(playerCard("nobody", { totals, players: { ...players, nobody: { team_id: "A" } } })).toBeNull()
  })
})
