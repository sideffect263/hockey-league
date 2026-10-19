import { useEffect, useState } from 'react'
import { BRAND_ORANGE } from '@/lib/brand'
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
 * Reusable team logo component.
 * Falls back to a colored circle with team initial if there's no logo_url
 * or the image fails to load (dead/expired/removed URL).
 */
export default function TeamLogo({ team, size = 8, className = "" }) {
  const [imgError, setImgError] = useState(false)

  // React reuses this instance when a list re-sorts or filters, so a sticky
  // imgError would make the *next* team in that slot fall back to an initial
  // despite a working logo. Reset whenever the source changes.
  useEffect(() => { setImgError(false) }, [team?.logo_url])

  const px = {
    5: "w-5 h-5 text-[8px]",
    6: "w-6 h-6 text-[9px]",
    8: "w-8 h-8 text-xs",
    10: "w-10 h-10 text-sm",
    12: "w-12 h-12 text-base",
    14: "w-14 h-14 text-lg",
  }[size] || `w-8 h-8 text-xs`
  // ~8% inset so round crests don't kiss the circle edge (percent padding would
  // resolve against the PARENT's width, so it's fixed per size).
  const pad = { 5: "p-px", 6: "p-px", 8: "p-0.5", 10: "p-[3px]", 12: "p-1", 14: "p-1" }[size] || "p-0.5"

  if (team?.logo_url && !imgError) {
    return (
      <img
        src={sizedImage(team.logo_url, { 5: 20, 6: 24, 8: 32, 10: 40, 12: 48, 14: 56 }[size] || 32, 'contain')}
        alt={team.name}
        onError={() => setImgError(true)}
        // Crests are transparent cutouts of any shape (round, shield, triangle):
        // fit the whole crest inside a light circle — never cover-crop it. The
        // circle stays light in dark mode too, because some crests have black
        // parts (Sharks sticks, BLG Hebrew line) that vanish on a dark circle.
        className={`${px.split(' ').slice(0, 2).join(' ')} rounded-full object-contain ${pad} shrink-0 bg-white ring-1 ring-black/5 dark:ring-white/10 ${className}`}
      />
    )
  }

  return (
    <div
      className={`${px} rounded-full shrink-0 flex items-center justify-center text-white font-bold ring-2 ring-white dark:ring-slate-800 ${className}`}
      style={{ backgroundColor: tooLight(team?.primary_color) ? BRAND_ORANGE : (team?.primary_color || BRAND_ORANGE) }}
    >
      {team?.name?.charAt(0) || '?'}
    </div>
  )
}
