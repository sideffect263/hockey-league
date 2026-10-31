/**
 * The game page hero photo (iOS GameCover.heroCover, Ariel 2026-10-29): only a WIDE frame
 * from this game — the footage's preview still (game-stills/<date>_<id8>/preview.jpg,
 * photo_id "game-<id8>-preview"), else the poster of the game's first clip post; never a
 * face crop or a posed photo. null = the plain blend + rink hero.
 */
import { supabase } from "@/lib/supabase"

const cfPoster = (p) => (p?.video_uid && p?.video_cf_code
  ? `https://customer-${p.video_cf_code}.cloudflarestream.com/${p.video_uid}/thumbnails/thumbnail.jpg?time=2s&height=720`
  : null)

export async function getGameHeroPhoto(gameId) {
  if (!gameId) return null
  const id8 = String(gameId).toLowerCase().slice(0, 8)
  try {
    const { data } = await supabase.from("photos").select("image_url").eq("photo_id", `game-${id8}-preview`).maybeSingle()
    if (data?.image_url) return data.image_url.replace("/storage/v1/object/public/", "/storage/v1/render/image/public/") + "?width=960&quality=72"
  } catch { /* fall through to the clip poster */ }
  try {
    const { data } = await supabase.from("posts").select("video_uid,video_cf_code,created_at")
      .eq("game_id", gameId).not("video_uid", "is", null).order("created_at", { ascending: true }).limit(1)
    return cfPoster(data?.[0])
  } catch { return null }
}
