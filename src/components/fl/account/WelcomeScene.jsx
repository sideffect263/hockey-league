/**
 * The welcome scene (board OnbWelcome, variant F "squad", Ariel's pick 10-27): a night sky,
 * three floodlights, a perspective rink on flat smoothed concrete (#9C9A95, faint trowel
 * grain, NO gradient) with dark-blue (#1F4FC2) markings, and three ball-less player poses
 * traced from real league photos (MOBILE-BUILD/floodlight/poses-lab), one under each light.
 * Port of iOS WelcomeBackdrop (FLAccountKit.swift). Drawn in a 390×600 box and scaled to
 * the real width. Motion: the lights switch on one by one, once, off with reduced motion.
 */
import { useLayoutEffect, useMemo, useRef, useState } from "react"
import pose1 from "./welcome/welcome-pose-1.svg"
import pose2 from "./welcome/welcome-pose-2.svg"
import poseCelebrate from "./welcome/welcome-pose-celebrate.svg"
import "./account.css"

const FLOOR = "#9C9A95"
const MARK = "#1F4FC2"
// As seen left to right (Pose Lab, 10-29): Player 3, the celebrating player in the middle, Player 1.
const SQUAD = [
  { src: pose2, left: -24, top: 170, size: 200 },
  { src: poseCelebrate, left: 63, top: 108, size: 264 },
  { src: pose1, left: 216, top: 170, size: 200 },
]
const LAMPS = [58, 190, 322]
const TILT = [-6, 0, 6]

/** The welcome floor: 40×20 m in a 360×180 box. */
function WelcomeRink() {
  const grain = useMemo(() => {
    let seed = 7n
    const rnd = () => {
      seed = (seed * 6364136223846793005n + 1442695040888963407n) & 0xFFFFFFFFFFFFFFFFn
      return Number((seed >> 33n) % 10000n) / 10000
    }
    const out = []
    for (let i = 0; i < 520; i++) {
      const x = 2 + rnd() * 356, y = 2 + rnd() * 176, len = 2 + rnd() * 9
      const dy = rnd() * 1.2 - 0.6, o = 0.035 + rnd() * 0.05
      out.push(`M${x.toFixed(1)} ${y.toFixed(1)}l${len.toFixed(1)} ${dy.toFixed(2)}|${o.toFixed(3)}`)
    }
    return out
  }, [])
  return (
    <svg viewBox="0 0 360 180" width="100%" height="100%" aria-hidden="true">
      <defs><clipPath id="fla-floor"><rect x="2" y="2" width="356" height="176" rx="9" /></clipPath></defs>
      <rect x="2" y="2" width="356" height="176" rx="9" fill={FLOOR} />
      <g clipPath="url(#fla-floor)" stroke="#000" strokeWidth="0.6" strokeLinecap="round">
        {grain.map((g, i) => { const [d, o] = g.split("|"); return <path key={i} d={d} strokeOpacity={o} /> })}
      </g>
      <rect x="2" y="2" width="356" height="176" rx="9" fill="none" stroke="rgb(237 227 204 / .9)" strokeWidth="4" />
      <rect x="2" y="2" width="356" height="176" rx="9" fill="none" stroke="rgb(217 130 43 / .8)" strokeWidth="1.2" />
      <g fill="none" stroke={MARK} strokeOpacity=".9" strokeWidth="1.6">
        <path d="M180 4V176M23.4 4V176M336.6 4V176" />
        <circle cx="180" cy="90" r="27" />
        <rect x="23.4" y="49.5" width="48.6" height="81" />
        <rect x="288" y="49.5" width="48.6" height="81" />
      </g>
      <g fill={MARK} fillOpacity=".95">
        <circle cx="180" cy="90" r="2.5" /><circle cx="72" cy="90" r="2" /><circle cx="288" cy="90" r="2" />
      </g>
      <g fill="none" stroke="rgb(17 22 29 / .8)" strokeWidth="1.6">
        <rect x="15.4" y="82.4" width="8" height="15.3" /><rect x="336.6" y="82.4" width="8" height="15.3" />
      </g>
    </svg>
  )
}

/** A light cone from the lamp to the floor (y 520), tilted around the lamp. */
function beamPath(lampX, tilt) {
  const a = (tilt * Math.PI) / 180, ly = 27, len = 520 - ly
  const pt = (dx, dy) => `${(lampX + dx * Math.cos(a) - dy * Math.sin(a)).toFixed(1)} ${(ly + dx * Math.sin(a) + dy * Math.cos(a)).toFixed(1)}`
  return `M${pt(-4.5, 0)}L${pt(4.5, 0)}L${pt(65, len)}L${pt(-65, len)}Z`
}

/**
 * `height` crops the 600-tall scene (the guest header uses the players band only);
 * `offsetY` moves the scene up inside that crop. `still` = no switch-on animation.
 */
export default function WelcomeScene({ height = 600, offsetY = 0, still = false, className = "" }) {
  const box = useRef(null)
  const [k, setK] = useState(1)
  useLayoutEffect(() => {
    const el = box.current
    if (!el) return
    const set = () => setK(el.clientWidth / 390 || 1)
    set()
    const ro = new ResizeObserver(set)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  const lit = (i, base = 0) => (still ? {} : { className: "fla-lit", style: { animationDelay: `${base + 140 * (i + 1)}ms` } })
  const rise = (i) => (still ? {} : { className: "fla-rise", style: { animationDelay: `${140 * (i + 1)}ms` } })

  return (
    <div ref={box} dir="ltr" aria-hidden="true" className={`relative w-full overflow-hidden ${className}`} style={{ height: height * k }}>
      <div className="absolute top-0 left-0 origin-top-left" style={{ width: 390, height: 600, transform: `translateY(${-offsetY * k}px) scale(${k})` }}>
        <div className="absolute inset-0" style={{ background: "radial-gradient(120% 70% at 50% 18%, #142133 0%, #0A1019 55%, #070B10 100%)" }} />
        {/* The rink, laid down in perspective (rotateX 56° under a 520px perspective, as on the board). */}
        <div className="absolute" style={{ top: 128, left: 0, width: 390, height: 330, perspective: 520, perspectiveOrigin: "50% 0%" }}>
          <div className="absolute" style={{ left: -75, top: 40, width: 540, height: 270, transform: "rotateX(56deg)", transformOrigin: "50% 50%" }}>
            <WelcomeRink />
          </div>
        </div>
        {/* Players, one per light; the middle one in front. */}
        {SQUAD.map((p, i) => {
          const foot = p.top + (p.size * 46.5) / 48
          const r = rise(i)
          return (
            <div key={i} className={r.className} style={{ ...r.style, position: "absolute", inset: 0, zIndex: i === 1 ? 2 : 1 }}>
              <span className="absolute rounded-[50%]" style={{
                left: p.left + p.size / 2 - p.size * 0.325, top: foot - 8, width: p.size * 0.65, height: 16,
                background: "radial-gradient(closest-side, rgba(0,0,0,.5), rgba(0,0,0,0))",
              }} />
              <img src={p.src} alt="" draggable={false} className="absolute select-none"
                style={{ left: p.left, top: p.top, width: p.size, height: p.size, filter: "drop-shadow(0 0 16px rgba(255,236,196,.22))" }} />
            </div>
          )
        })}
        {/* Beams + lamps. */}
        <svg className="absolute inset-0" width="390" height="600" viewBox="0 0 390 600" style={{ zIndex: 3, mixBlendMode: "screen" }}>
          <defs>
            <linearGradient id="fla-beam" x1="0" y1="27" x2="0" y2="520" gradientUnits="userSpaceOnUse">
              <stop offset="0" stopColor="#FFECC4" stopOpacity=".30" />
              <stop offset=".5" stopColor="#FFECC4" stopOpacity=".05" />
              <stop offset="1" stopColor="#FFECC4" stopOpacity="0" />
            </linearGradient>
            <filter id="fla-blur" x="-20%" y="-5%" width="140%" height="110%"><feGaussianBlur stdDeviation="3" /></filter>
          </defs>
          {LAMPS.map((x, i) => <path key={i} d={beamPath(x + 5, TILT[i])} fill="url(#fla-beam)" filter="url(#fla-blur)" {...lit(i)} />)}
        </svg>
        {LAMPS.map((x, i) => (
          <span key={i} className="absolute" style={{ left: x, top: 22, width: 10, height: 10, zIndex: 4 }}>
            <span className="absolute inset-0 rounded-full" style={{ background: "#FFF6E2", opacity: 0.35 }} />
            <span className={`absolute inset-0 rounded-full ${still ? "" : "fla-lit"}`}
              style={{ background: "#FFF6E2", boxShadow: "0 0 12px 3px rgba(255,236,196,.75)", animationDelay: `${140 * (i + 1)}ms`, opacity: still ? 1 : undefined }} />
          </span>
        ))}
        <div className="absolute inset-0" style={{ zIndex: 5, background: "linear-gradient(180deg, rgba(7,11,16,0) 55%, #070B10 92%)" }} />
      </div>
      {/* A cropped scene still fades into the night at its own bottom edge. */}
      {height < 560 && <div className="absolute inset-x-0 bottom-0 h-[38%] pointer-events-none" style={{ background: "linear-gradient(180deg, rgba(7,11,16,0), #070B10 92%)" }} />}
    </div>
  )
}
