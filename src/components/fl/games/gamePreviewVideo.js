/**
 * Game-preview videos: an AI face-off clip of one player from each team that replaces the
 * crest backdrop in the game hero before the game. Trial on dev — one hand-made clip, kept in
 * public/game-previews/<game id>/ so nothing touches the shared Supabase project yet.
 * Clip framing matches the hero: away player physically LEFT, home player RIGHT.
 * `standAt` = seconds into the clip when both players have stopped (names fade in then).
 */
const PREVIEWS = {
  // 2026-11-21 רמת ישי (home) – גבעת עדה איחוד (away)
  "cbc0e35e-a0a3-4b02-a744-ccfdc153e4f8": {
    home: { name: "מרסלו בנדרסקי", number: 5 },
    away: { name: "יובל מוקדי", number: 81 },
    standAt: 3.1,
  },
  // 2026-12-19 בלג אריות (home) – קריית ביאליק (away). Cinematic line-up: עדי רז (away, blue)
  // left, Ariel (home, green) right. `loop`: the file is baked forward + reversed (ping-pong),
  // so a plain <video loop> rewinds smoothly back to the start forever.
  "6135793f-3a81-4c9c-a848-c546c5720e6f": {
    home: { name: "אריאל ביטון", number: null, playerId: "b2000007-0000-0000-0000-000000000007" },
    away: { name: "עדי רז", number: null, playerId: "b6000004-0000-0000-0000-000000000004" },
    standAt: 1.5,
    loop: true,
    cards: true, // EA FC-style stat cards under the clip (PreviewStatCards); faces cropped from the clip
  },
}

export function getGamePreviewVideo(gameId) {
  const p = gameId && PREVIEWS[gameId]
  if (!p) return null
  const base = `/game-previews/${gameId}`
  return {
    ...p, src: `${base}/clip.mp4`, poster: `${base}/poster.jpg`, endFrame: `${base}/end.jpg`,
    ...(p.cards ? { homeFace: `${base}/home.jpg`, awayFace: `${base}/away.jpg` } : {}),
  }
}
