/**
 * Game-preview stage (GameHero `PreviewStage`): every pre-game page gets an EA FC-style line-up
 * built from its two teams — no per-game setup.
 *
 * FACES = one "face" player per adult team, each with TWO solo Gemini clips made from the same
 * empty-arena plate (the goal sits at the exact horizontal centre of every frame):
 *   <key>_L — he stands LEFT of the goal  → used when his team is AWAY (left half)
 *   <key>_R — he stands RIGHT of the goal → used when his team is HOME (right half)
 * Each clip is a 9 s static-camera loop (last second crossfades into the first). The stage pins
 * every clip's centre on the seam, so the two half-goals always meet as one goal.
 *
 * Teams without a face (minors-only cutouts, youth teams — no AI faces of minors) get the empty
 * arena (arena.jpg) on their half, and their card shows the team's best-rated player, picked
 * live in PreviewStatCards. A game where NEITHER team has a face keeps the normal hero.
 *
 * Dev trial: clips live in public/game-previews/players/. Before prod, move them to Supabase
 * storage + a table instead of this hard-coded map.
 */
const BASE = "/game-previews/players"

const FACES = {
  // בלג אריות
  "a1b2c3d4-0002-0000-0000-000000000002": { key: "ariel", playerId: "b2000007-0000-0000-0000-000000000007", name: "אריאל ביטון" },
  // קריית ביאליק
  "a1b2c3d4-0006-0000-0000-000000000006": { key: "adi", playerId: "b6000004-0000-0000-0000-000000000004", name: "עדי רז" },
  // גבעת עדה איחוד
  "a1b2c3d4-0001-0000-0000-000000000001": { key: "guy", playerId: "b1000001-0000-0000-0000-000000000001", name: "גיא ריכטר" },
  // רמת ישי
  "a1b2c3d4-0004-0000-0000-000000000004": { key: "marcelo", playerId: "b5000006-0000-0000-0000-000000000006", name: "מרסלו בנדרסקי", sides: "L" }, // _R pending (Gemini daily limit)
}

const EMPTY = { poster: `${BASE}/arena.jpg` } // no src → a still of the empty arena

function clipFor(face, side) {
  if (!face || (face.sides && !face.sides.includes(side))) return EMPTY // `sides`: which clips exist (default both)
  const f = `${BASE}/${face.key}_${side}`
  return { src: `${f}.mp4`, poster: `${f}.jpg` }
}

/** The preview for a game row (needs home_team_id / away_team_id), or null. */
export function getGamePreviewVideo(game) {
  const homeId = game?.home_team_id, awayId = game?.away_team_id
  const home = FACES[homeId], away = FACES[awayId]
  if (!home && !away) return null
  const side = (teamId, face) => ({ teamId, playerId: face?.playerId ?? null, name: face?.name ?? null, number: null })
  const still = clipFor(home || away, home ? "R" : "L").poster
  return {
    cards: true,
    loop: true,
    standAt: 0,
    away: side(awayId, away),
    home: side(homeId, home),
    split: { away: clipFor(away, "L"), home: clipFor(home, "R") },
    poster: still,
    endFrame: still,
  }
}
