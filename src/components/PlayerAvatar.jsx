import { useEffect, useState } from "react"
import TeamLogo from "@/components/TeamLogo"
import { BRAND_ORANGE } from "@/lib/brand"
import { sizedImage } from "@/lib/imageSize"

// Some teams pick a white/near-white primary_color; white initial text on it is
// invisible. Fall back to the brand color for the initial background in that case.
function tooLight(hex) {
  const m = (hex || "").replace("#", "")
  if (!/^[0-9a-f]{6}$/i.test(m)) return false
  const r = parseInt(m.slice(0, 2), 16), g = parseInt(m.slice(2, 4), 16), b = parseInt(m.slice(4, 6), 16)
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255 > 0.8
}

/**
 * A player's face for cards/headers. Image precedence:
 *   paired user's uploaded avatar (owner_avatar_url) → the player's own photo_url → colored initial.
 * The primary team crest rides as a small badge in the bottom corner, so you see
 * the person AND their team. A broken image falls back to the initial.
 */
export default function PlayerAvatar({ player, team, size = 12, className = "" }) {
  const [imgError, setImgError] = useState(false)
  const box = { 10: "w-10 h-10", 12: "w-12 h-12", 14: "w-14 h-14", 16: "w-16 h-16", 20: "w-20 h-20" }[size] || "w-12 h-12"
  const rounded = size >= 16 ? "rounded-2xl" : "rounded-xl"
  const photo = player?.owner_avatar_url || player?.photo_url || null
  const initial = (player?.first_name || "?").trim().charAt(0) || "?"

  // React reuses this instance when a list re-sorts or filters, so a sticky imgError would
  // make the *next* player in that slot fall back to an initial despite a working photo.
  useEffect(() => { setImgError(false) }, [photo])

  return (
    <div className={`relative shrink-0 ${box} ${className}`}>
      {photo && !imgError ? (
        <img
          src={sizedImage(photo, { 10: 40, 12: 48, 14: 56, 16: 64, 20: 80 }[size] || 48)}
          alt={`${player?.first_name || ""} ${player?.last_name || ""}`.trim()}
          onError={() => setImgError(true)}
          className={`${box} ${rounded} object-cover bg-slate-100 dark:bg-slate-700`}
        />
      ) : (
        <div
          className={`${box} ${rounded} flex items-center justify-center text-white font-extrabold`}
          style={{ backgroundColor: tooLight(team?.primary_color) ? BRAND_ORANGE : (team?.primary_color || BRAND_ORANGE) }}
        >
          {initial}
        </div>
      )}
      {team && (
        <span className="absolute -bottom-1 -left-1">
          <TeamLogo team={team} size={5} className="ring-2 ring-white dark:ring-slate-900" />
        </span>
      )}
    </div>
  )
}
