// Opening animation for the INSTALLED web app (home-screen PWA), matching the native apps:
// the rink draws, a ball rolls in to the centre, the mark's ring and stick draw around it, the
// disc fills, then the mark flies into the header logo.
// Spec: MOBILE-BUILD/brand/interim-mark/LAUNCH-ANIMATION-SPEC.md (an original mark used until the
// association signs off on its crest; the crest version is MOBILE-BUILD/brand/official-crest/).
//
// Never on a normal browser visit: index.html decides (bootSplash) and paints the night cover
// before the bundle loads (Floodlight: the night rink #0B0F14, was the blue #3B4FC4); this module is a separate chunk, mounted in its own root by
// main.jsx only when that cover is up. The page renders underneath the whole time.

import { useEffect, useRef, useState } from "react"

const T = 2600 // ms, the spec's 2.6 s

// The spec's timeline, in percentages of T. The fly's end point comes from the header logo,
// measured at start (--fx/--fy/--fs). From 58% on the drawn mark is exactly /logos/mark.svg.
const CSS = `
.ls{position:fixed;inset:0;z-index:2147483000;pointer-events:auto;--t:${T}ms}
.ls-bg{position:absolute;inset:0;background:#0B0F14 radial-gradient(120% 70% at 50% 30%,#142133,#070B10)}
.ls-rink{position:absolute;left:50%;top:50%;transform-origin:center}
.ls-cw{position:absolute;left:50%;top:50%;transform-origin:center}
.ls-cw>*{position:absolute;inset:0;width:100%;height:100%}
.ls-cw svg{overflow:visible}
.ls-dl{fill:none;stroke-dasharray:1;stroke-dashoffset:1}
.ls-disc{opacity:0}
.ls-sub{position:absolute;left:50%;top:50%;transform:translate(-50%,6px);opacity:0;color:#fff;font-weight:800;white-space:nowrap;direction:ltr;letter-spacing:.01em}
.ls.run .ls-bg{animation:lsBg var(--t) ease forwards}
.ls.run .ls-rk{animation:lsDr var(--t) linear forwards}
.ls.run .ls-rink{animation:lsRk var(--t) ease forwards}
.ls.run .ls-ring{animation:lsRing var(--t) cubic-bezier(0,0,.58,1) forwards}
.ls.run .ls-stick{animation:lsStick var(--t) cubic-bezier(0,0,.58,1) forwards}
.ls.run .ls-disc{animation:lsDisc var(--t) linear forwards}
.ls.run .ls-ball{animation:lsBall var(--t) linear both}
.ls.run .ls-sub{animation:lsSub var(--t) linear forwards}
.ls.run .ls-cw{animation:lsFly var(--t) cubic-bezier(.5,0,.3,1) forwards}
@keyframes lsBg{0%,80%{opacity:1}96%,100%{opacity:0}}
@keyframes lsDr{0%{stroke-dashoffset:1}26%,100%{stroke-dashoffset:0}}
@keyframes lsRk{0%,78%{opacity:1;transform:translate(-50%,-50%) scale(1)}96%,100%{opacity:0;transform:translate(-50%,-50%) scale(1.6)}}
@keyframes lsBall{0%,10%{transform:translateX(-300px);animation-timing-function:cubic-bezier(.2,.8,.3,1)}40%,100%{transform:none}}
@keyframes lsRing{0%,20%{stroke-dashoffset:1}45%,100%{stroke-dashoffset:0}}
@keyframes lsStick{0%,30%{stroke-dashoffset:1}50%,100%{stroke-dashoffset:0}}
@keyframes lsDisc{0%,45%{opacity:0}58%,100%{opacity:1}}
@keyframes lsSub{0%,50%{opacity:0;transform:translate(-50%,6px)}60%,70%{opacity:1;transform:translate(-50%,0)}76%,100%{opacity:0;transform:translate(-50%,0)}}
@keyframes lsFly{0%,76%{transform:translate(-50%,-50%) translate(0,0) scale(1)}96%,100%{transform:translate(-50%,-50%) translate(var(--fx),var(--fy)) scale(var(--fs))}}
.ls-rink,.ls-cw{transform:translate(-50%,-50%)}
.ls.fade{transition:opacity .3s ease;opacity:0}
`

function headerLogo() {
  return document.querySelector("[data-header-logo]")
}

export default function LaunchSplash({ reducedMotion, onDone }) {
  const root = useRef(null)
  const [vars, setVars] = useState(null)
  const done = useRef(false)

  // Rink box = the prototype's 200×380, scaled by width but never taller than the screen;
  // the mark is 0.6 of that width.
  const W = Math.min(window.innerWidth, (window.innerHeight * 200) / 380, 520)
  const mark = W * 0.6

  const finish = () => {
    if (done.current) return
    done.current = true
    const target = headerLogo()
    if (target) target.style.visibility = ""
    onDone()
  }

  useEffect(() => {
    document.getElementById("boot-splash")?.remove() // our own night rink takes over, same #0B0F14
    // A cover that never lifts is the one failure this must not have. Opened straight
    // into the background (no frames run there): skip it. And whatever happens, lift by 6 s.
    if (document.hidden) { finish(); return }
    const safety = setTimeout(finish, 6000)
    const target = headerLogo()
    if (reducedMotion) {
      const el = root.current
      requestAnimationFrame(() => el?.classList.add("fade"))
      const t = setTimeout(finish, 320)
      return () => { clearTimeout(t); clearTimeout(safety) }
    }
    // Land on the header logo: centre-to-centre offset and size ratio.
    let fx = 0, fy = -window.innerHeight / 2 + 32, fs = 40 / mark
    if (target) {
      const r = target.getBoundingClientRect()
      fx = r.left + r.width / 2 - window.innerWidth / 2
      fy = r.top + r.height / 2 - window.innerHeight / 2
      fs = r.width / mark
      target.style.visibility = "hidden" // one mark at a time; it reappears as this one lands
    }
    setVars({ "--fx": `${fx}px`, "--fy": `${fy}px`, "--fs": fs })
    let t
    // Start on the next frame, after the first paint, so a busy first load slows the start
    // rather than eating the drawing.
    const raf = requestAnimationFrame(() => {
      root.current?.classList.add("run")
      t = setTimeout(finish, T + 30)
    })
    return () => { cancelAnimationFrame(raf); clearTimeout(t); clearTimeout(safety) }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div ref={root} className="ls" style={vars || undefined} onClick={finish} aria-hidden="true">
      <style>{CSS}</style>
      <div className="ls-bg" />
      {!reducedMotion && (
        <>
          <svg className="ls-rink" viewBox="0 0 200 380" style={{ width: W, height: (W * 380) / 200 }}>
            <g fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" opacity=".55">
              <rect className="ls-dl ls-rk" pathLength="1" x="20" y="40" width="160" height="300" rx="36" />
              <line className="ls-dl ls-rk" pathLength="1" x1="20" y1="190" x2="180" y2="190" />
              <path className="ls-dl ls-rk" pathLength="1" d="M75 40 v22 a25 25 0 0 0 50 0 v-22" />
              <path className="ls-dl ls-rk" pathLength="1" d="M75 340 v-22 a25 25 0 0 1 50 0 v22" />
              <circle className="ls-dl ls-rk" pathLength="1" cx="100" cy="190" r="64" />
            </g>
          </svg>
          <div className="ls-cw" style={{ width: mark, height: mark }}>
            <svg viewBox="0 0 200 200">
              <circle className="ls-disc" cx="100" cy="100" r="95.4" fill="#1E2A78" />
              <circle className="ls-dl ls-ring" pathLength="1" cx="100" cy="100" r="95.4" transform="rotate(-90 100 100)" stroke="#fff" strokeWidth="9.2" />
              <path className="ls-dl ls-stick" pathLength="1" d="M141.9 29.2 L95.7 130.3 Q85 151.4 58.1 147.1" stroke="#F2B233" strokeWidth="13.3" strokeLinecap="round" strokeLinejoin="round" />
              <circle className="ls-ball" cx="117.3" cy="141.9" r="19.1" fill="#fff" />
            </svg>
          </div>
          <div className="ls-sub" style={{ fontSize: W * 0.07, marginTop: mark / 2 + W * 0.05 }}>rinkhockey IL</div>
        </>
      )}
    </div>
  )
}
