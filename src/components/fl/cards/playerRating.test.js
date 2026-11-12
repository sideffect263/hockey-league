import { describe, expect, it } from "vitest"
import { aggregate, playerCard, lastGameChange, MIN_GP, WEIGHTS, SCORE_MIN, SCORE_MAX, OVR_MIN, OVR_MAX } from "./playerRating"

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

  it("shows every axis on the soft curve: 30 = nothing, 92 = the best, never 99", () => {
    expect([SCORE_MIN, SCORE_MAX]).toEqual([30, 92])
    for (const id of ["ace", "mid", "low", "gk"]) for (const ax of card(id).axes) {
      if (ax.score == null) continue
      expect(ax.shown).toBe(String(Math.round(30 + 62 * ax.pct)))
      expect(ax.score).toBeGreaterThanOrEqual(30)
      expect(ax.score).toBeLessThanOrEqual(92)
    }
    expect(axis("ace", "goals").shown).toBe("92") // ace has the most goals
    expect(axis("low", "goals").shown).toBe("40") // 1 of 6 → 30 + 62/6
    expect(axis("low", "fans").shown).toBe("36")  // 1 fan, out of at least 10
  })

  it("attack and defence: half the team's level, half how the team did with him vs without him", () => {
    // A is the strong team, B the weak one; both only play C. a2 (A) and b1 (B) each played 3 of 6.
    // A: 3–2 with a2, 8–1 without him. B: 3–3 with b1, 0–5 without him.
    const ps = { a1: { team_id: "A" }, a2: { team_id: "A" }, b1: { team_id: "B" }, b2: { team_id: "B" }, c1: { team_id: "C" } }
    const gs = [], st = []
    for (let i = 0; i < 6; i++) {
      const withA = i < 3, withB = i < 3
      gs.push(g(`a${i}`, "A", "C", withA ? 3 : 8, withA ? 2 : 1), g(`b${i}`, "B", "C", withB ? 3 : 0, withB ? 3 : 5))
      st.push(row(`a${i}`, "a1"), row(`b${i}`, "b2"), row(`a${i}`, "c1"), row(`b${i}`, "c1"))
      if (withA) st.push(row(`a${i}`, "a2"))
      if (withB) st.push(row(`b${i}`, "b1"))
    }
    const t = aggregate({ games: gs, stats: st, players: ps, currentSeasonId: "S1" })
    const sc = (id, k) => playerCard(id, { totals: t, players: ps }).axes.find(a => a.key === k).score
    // b1 plays for the weak team but the team is far better with him; a2 is the opposite
    expect(sc("b1", "att")).toBeGreaterThan(sc("a2", "att"))
    expect(sc("b1", "def")).toBeGreaterThan(sc("a2", "def"))
    // the real figures behind it stay readable
    expect(t.get("a2").wAtt).toBeLessThan(0)
    expect(t.get("b1").wDef).toBeGreaterThan(0)
  })

  it("draws every point against the best in the group, and says who the best is", () => {
    // goals: low 1, best (ace) 6
    expect(axis("low", "goals").pct).toBeCloseTo(1 / 6)
    expect(axis("low", "goals").bestShown).toBe("6")
    // attack / defence: best = full point, worst = none (within the position group)
    const defs = ["ace", "mid", "low"].map(id => axis(id, "def").pct)
    expect(Math.max(...defs)).toBe(1)
    expect(Math.min(...defs)).toBe(0)
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
    expect(Math.abs(b - a - (OVR_MAX - OVR_MIN) * WEIGHTS.fans)).toBeLessThanOrEqual(1) // 0 → 10 fans: about +3
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

  it("gives goalkeepers goals conceded per game this season (fewer = better) instead of goals", () => {
    // this season, games 1–3: gk's team (B) conceded 3 + 2 + 4 = 9 → 3.0; gk2's team (A) 1 + 2 + 0 = 3 → 1.0
    // gk2 also played last season's game 9 (A won 9–0) — it doesn't count here
    const ps = { ...players, gk2: { team_id: "A", position: "Goalkeeper" } }
    const st = [...stats, row("1", "gk2", 0), row("2", "gk2", 0), row("3", "gk2", 0), row("9", "gk2", 0)]
    const t = aggregate({ games, stats: st, players: ps, currentSeasonId: "S1" })
    const ax = id => playerCard(id, { totals: t, players: ps }).axes.find(a => a.key === "goals")
    expect(ax("gk").label).toBe("השפעה")
    expect(ax("gk").raw).toBe("3.0")
    expect(ax("gk2").raw).toBe("1.0")
    expect(ax("gk2").shown).toBe("92")        // fewest conceded per game = the best
    expect(ax("gk").shown).toBe("51")         // 30 + 62 × (1.0 / 3.0)
    // a field player's השפעה is still his goals (low scored 1 this season)
    expect(playerCard("low", { totals: t, players: ps }).axes.find(a => a.key === "goals").raw).toBe("1")
  })

  it("a keeper with no games this season shows – but still has a rating", () => {
    const g0 = [g("21", "B", "A", 1, 1, "S0"), g("22", "B", "A", 2, 1, "S0"), g("23", "B", "A", 3, 0, "S0")]
    const t = aggregate({ games: g0, stats: ["21", "22", "23"].map(id => row(id, "gk", 0)), players, currentSeasonId: "S1" })
    const c = playerCard("gk", { totals: t, players })
    expect(c.axes.find(a => a.key === "goals").shown).toBe("–")
    expect(c.ovr).not.toBeNull()
  })

  it("needs 3 games before a keeper's השפעה counts", () => {
    const t = aggregate({ games, stats: [row("1", "gk", 0)], players, currentSeasonId: "S1" })
    expect(playerCard("gk", { totals: t, players }).axes.find(a => a.key === "goals").shown).toBe("–")
  })

  it("shows what changed in his last game: the card now vs the league just before it", () => {
    const dated = games.map(x => ({ ...x, game_date: x.season_id === "S0" ? "2025-10-01" : `2026-10-0${x.id}` })) // game 4 is ace's latest
    const d = { games: dated, stats, players, fans, currentSeasonId: "S1" }
    const ch = lastGameChange("ace", d)
    expect(ch.game.id).toBe("4")
    const now = playerCard("ace", { totals: aggregate(d), players, fans })
    const before = playerCard("ace", { totals: aggregate({ ...d, games: dated.filter(x => x.id !== "4") }), players, fans })
    expect(ch.ovr).toBe(now.ovr - before.ovr)
    const exp = c => c.axes.find(x => x.key === "exp").score
    expect(ch.axes.exp).toBe(exp(now) - exp(before))
    // game 4 was a 5–5 draw: his team let in 5 → his defence score drops
    expect(ch.axes.def).toBeLessThan(0)
  })

  it("has no change for a player whose only game is his first", () => {
    const dated = games.map(x => ({ ...x, game_date: x.season_id === "S0" ? "2025-10-01" : `2026-10-0${x.id}` }))
    const ch = lastGameChange("new", { games: dated, stats, players, currentSeasonId: "S1" })
    expect(ch.firstGame).toBe(true)
    expect(ch.ovr).toBeNull()
  })

  it("returns null for a player with no games", () => {
    expect(playerCard("nobody", { totals, players: { ...players, nobody: { team_id: "A" } } })).toBeNull()
  })
})
