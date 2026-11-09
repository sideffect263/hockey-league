// Pure helpers for posts that cover a whole game DAY rather than one game — the weekly goal reels
// ("🏒 תקציר גולים · משחקי 24.10 בגבעת עדה", "כל הגולים של השבוע · משחקי 10.10"). Those posts
// have no game_id, so without this their page links nowhere and Google drops them as thin.
// Shared by the SPA (PostDetail.jsx) and the bot copy (api/seo.js) — keep both in step.

/** The game day a reel post is about, as 'YYYY-MM-DD', or null. Reads "משחקי D.M" from the
 *  body; the year is the post's year, or the year before if that date would be after the post. */
export function reelDay(body, createdAt) {
  const m = String(body || '').match(/משחקי\s+(\d{1,2})\.(\d{1,2})(?!\.?\d)/)
  if (!m) return null
  const d = +m[1], mo = +m[2]
  if (d < 1 || d > 31 || mo < 1 || mo > 12) return null
  const posted = createdAt ? new Date(createdAt) : new Date()
  if (Number.isNaN(posted.getTime())) return null
  let y = posted.getUTCFullYear()
  const iso = (yy) => `${yy}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`
  if (new Date(`${iso(y)}T00:00:00Z`) > posted) y -= 1
  return iso(y)
}

/** A timestamp's calendar day in Israel, as 'YYYY-MM-DD' (to match reelDay against games.game_date). */
export function localDay(iso) {
  try { return new Date(iso).toLocaleDateString('en-CA', { timeZone: 'Asia/Jerusalem' }) } catch { return null }
}

/** A game's line in the "המשחקים מאותו יום" list: "בית 4 - 8 חוץ" once played, else "בית נגד חוץ". */
export function dayGameLabel(game, homeName, awayName) {
  const h = homeName || 'בית', a = awayName || 'חוץ'
  return game?.status === 'completed' && game.home_score != null && game.away_score != null
    ? `${h} ${game.home_score} - ${game.away_score} ${a}`
    : `${h} נגד ${a}`
}
