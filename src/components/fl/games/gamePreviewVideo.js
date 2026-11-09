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
}

export function getGamePreviewVideo(gameId) {
  const p = gameId && PREVIEWS[gameId]
  if (!p) return null
  const base = `/game-previews/${gameId}`
  return { ...p, src: `${base}/clip.mp4`, poster: `${base}/poster.jpg`, endFrame: `${base}/end.jpg` }
}
