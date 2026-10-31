import { useEffect, useState } from 'react'
import { BRAND_ORANGE } from '@/lib/brand'
import { sizedImage } from "@/lib/imageSize"
import { teamTint } from "@/lib/flTeam"

/**
 * Reusable team logo component.
 * Falls back to a colored circle with team initial if there's no logo_url
 * or the image fails to load (dead/expired/removed URL).
 */
export default function TeamLogo({ team, size = 8, px: pxSize, disc = true, shadow = false, className = "" }) {
  const [imgError, setImgError] = useState(false)

  // React reuses this instance when a list re-sorts or filters, so a sticky
  // imgError would make the *next* team in that slot fall back to an initial
  // despite a working logo. Reset whenever the source changes.
  useEffect(() => { setImgError(false) }, [team?.logo_url])

  // Floodlight: an exact pixel size (`px`), the light disc (#FAF9F6, crest ≈74%) on by
  // default, `disc={false}` for the game/team heroes where the crest stands alone.
  if (pxSize) return <FlCrest team={team} size={pxSize} disc={disc} shadow={shadow} imgError={imgError} setImgError={setImgError} className={className} />

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
        className={`${px.split(' ').slice(0, 2).join(' ')} rounded-full object-contain ${pad} shrink-0 bg-fl-disc ring-1 ring-black/5 dark:ring-white/10 ${className}`}
      />
    )
  }

  return (
    <div
      className={`${px} rounded-full shrink-0 flex items-center justify-center text-white font-bold ring-2 ring-white dark:ring-slate-800 ${className}`}
      style={{ backgroundColor: team ? teamTint(team) : BRAND_ORANGE }}
    >
      {team?.name?.charAt(0) || '?'}
    </div>
  )
}

function FlCrest({ team, size, disc, shadow, imgError, setImgError, className }) {
  const box = { width: size, height: size }
  if (team?.logo_url && !imgError) {
    const inner = disc ? Math.round(size * 0.74) : size
    const img = (
      <img src={sizedImage(team.logo_url, inner, 'contain')} alt={team.name} width={inner} height={inner}
        onError={() => setImgError(true)} loading="lazy" decoding="async"
        className="object-contain" style={{ width: inner, height: inner, filter: shadow && !disc ? 'drop-shadow(0 2px 6px rgba(0,0,0,.35))' : undefined }} />
    )
    if (!disc) return <span className={`inline-flex shrink-0 items-center justify-center ${className}`} style={box}>{img}</span>
    return (
      <span className={`inline-flex shrink-0 items-center justify-center rounded-full bg-fl-disc ${shadow ? 'shadow-[0_4px_14px_rgba(0,0,0,.25)]' : ''} ${className}`} style={box}>{img}</span>
    )
  }
  // Letter fallback on the team's own tint.
  return (
    <span className={`inline-flex shrink-0 items-center justify-center rounded-full font-extrabold text-white ${className}`}
      style={{ ...box, backgroundColor: teamTint(team), fontSize: Math.round(size * 0.42) }}>
      {team?.name?.charAt(0) || '?'}
    </span>
  )
}
