// Opening animation for the INSTALLED web app (home-screen PWA), matching the native apps:
// the rink draws, the association crest draws in the centre, fills in, gets its writing, then
// flies into the header logo. Spec: MOBILE-BUILD/brand/official-crest/LAUNCH-ANIMATION-SPEC.md.
//
// Never on a normal browser visit: index.html decides (bootSplash) and paints the blue cover
// before the bundle loads; this module is a separate chunk, mounted in its own root by
// main.jsx only when that cover is up. The page renders underneath the whole time.

import { useEffect, useRef, useState } from "react"

const T = 2600 // ms, the spec's 2.6 s

const PLAYER = "M63.6 56.5 L61.3 56.5 L59.1 57.8 L58.4 63.6 L53.9 66.5 L50.4 70.0 L46.5 76.1 L44.6 83.5 L44.6 88.6 L44.0 90.5 L44.3 95.3 L43.3 97.0 L43.3 99.5 L42.7 100.5 L42.7 108.5 L42.1 110.1 L37.9 114.0 L37.9 118.1 L38.8 118.8 L42.4 118.5 L43.0 115.6 L46.2 116.2 L47.8 115.6 L47.8 114.6 L46.5 113.6 L47.2 105.6 L47.8 104.7 L48.2 101.8 L49.8 99.5 L51.4 92.8 L53.6 90.2 L54.9 90.2 L57.8 93.1 L58.4 97.6 L57.1 100.2 L57.1 103.4 L54.9 107.9 L54.6 111.1 L52.6 113.6 L55.2 114.6 L54.6 118.5 L56.2 119.4 L58.7 119.4 L60.0 117.5 L60.0 114.6 L59.1 110.8 L59.4 108.5 L64.2 99.5 L64.8 96.6 L64.8 93.4 L64.2 92.5 L64.5 89.6 L65.8 89.2 L66.5 89.9 L66.5 88.0 L68.4 83.8 L68.4 80.6 L71.3 76.7 L71.9 72.9 L71.9 70.0 L70.9 66.8 L69.3 64.5 L66.8 62.9 L66.1 59.4Z"

// The prototype's keyframes, verbatim in percentages of T. The fly's end point comes from the
// header crest, measured at start (--fx/--fy/--fs).
const CSS = `
.ls{position:fixed;inset:0;z-index:2147483000;pointer-events:auto;--t:${T}ms}
.ls-bg{position:absolute;inset:0;background:#3B4FC4}
.ls-rink{position:absolute;left:50%;top:50%;transform-origin:center}
.ls-cw{position:absolute;left:50%;top:50%;transform-origin:center}
.ls-cw>*{position:absolute;inset:0;width:100%;height:100%}
.ls-dl{fill:none;stroke-dasharray:1;stroke-dashoffset:1}
.ls-fl,.ls-tx{opacity:0}
.ls.run .ls-bg{animation:lsBg var(--t) ease forwards}
.ls.run .ls-rk{animation:lsDr var(--t) linear forwards}
.ls.run .ls-rink{animation:lsRk var(--t) ease forwards}
.ls.run .ls-c1{animation:lsD1 var(--t) cubic-bezier(0,0,.58,1) forwards}
.ls.run .ls-c2{animation:lsD2 var(--t) cubic-bezier(0,0,.58,1) forwards}
.ls.run .ls-c3{animation:lsD3 var(--t) cubic-bezier(0,0,.58,1) forwards}
.ls.run .ls-lines{animation:lsLn var(--t) linear forwards}
.ls.run .ls-fl{animation:lsFl var(--t) linear forwards}
.ls.run .ls-tx{animation:lsTx var(--t) linear forwards}
.ls.run .ls-cw{animation:lsFly var(--t) cubic-bezier(.5,0,.3,1) forwards}
@keyframes lsBg{0%,80%{opacity:1}96%,100%{opacity:0}}
@keyframes lsDr{0%{stroke-dashoffset:1}26%,100%{stroke-dashoffset:0}}
@keyframes lsRk{0%,78%{opacity:1;transform:translate(-50%,-50%) scale(1)}96%,100%{opacity:0;transform:translate(-50%,-50%) scale(1.6)}}
@keyframes lsD1{0%,16%{stroke-dashoffset:1}36%,100%{stroke-dashoffset:0}}
@keyframes lsD2{0%,24%{stroke-dashoffset:1}44%,100%{stroke-dashoffset:0}}
@keyframes lsD3{0%,30%{stroke-dashoffset:1}50%,100%{stroke-dashoffset:0}}
@keyframes lsLn{0%,50%{opacity:1}60%,100%{opacity:0}}
@keyframes lsFl{0%,49%{opacity:0}60%,100%{opacity:1}}
@keyframes lsTx{0%,58%{opacity:0}68%,100%{opacity:1}}
@keyframes lsFly{0%,76%{transform:translate(-50%,-50%) translate(0,0) scale(1)}96%,100%{transform:translate(-50%,-50%) translate(var(--fx),var(--fy)) scale(var(--fs))}}
.ls-rink,.ls-cw{transform:translate(-50%,-50%)}
.ls.fade{transition:opacity .3s ease;opacity:0}
`

function headerCrest() {
  return document.querySelector("[data-header-crest]")
}

export default function LaunchSplash({ reducedMotion, onDone }) {
  const root = useRef(null)
  const [vars, setVars] = useState(null)
  const done = useRef(false)

  // Rink box = the prototype's 200×380, scaled by width but never taller than the screen;
  // the crest is 0.6 of that width.
  const W = Math.min(window.innerWidth, (window.innerHeight * 200) / 380, 520)
  const crest = W * 0.6

  const finish = () => {
    if (done.current) return
    done.current = true
    const target = headerCrest()
    if (target) target.style.visibility = ""
    onDone()
  }

  useEffect(() => {
    document.getElementById("boot-splash")?.remove() // our own blue takes over, same colour
    const target = headerCrest()
    if (reducedMotion) {
      const el = root.current
      requestAnimationFrame(() => el?.classList.add("fade"))
      const t = setTimeout(finish, 320)
      return () => clearTimeout(t)
    }
    // Land on the header crest: centre-to-centre offset and size ratio.
    let fx = 0, fy = -window.innerHeight / 2 + 32, fs = 40 / crest
    if (target) {
      const r = target.getBoundingClientRect()
      fx = r.left + r.width / 2 - window.innerWidth / 2
      fy = r.top + r.height / 2 - window.innerHeight / 2
      fs = r.width / crest
      target.style.visibility = "hidden" // one crest at a time; it reappears as this one lands
    }
    setVars({ "--fx": `${fx}px`, "--fy": `${fy}px`, "--fs": fs })
    let t
    // Start on the next frame, after the first paint, so a busy first load slows the start
    // rather than eating the drawing.
    const raf = requestAnimationFrame(() => {
      root.current?.classList.add("run")
      t = setTimeout(finish, T + 30)
    })
    return () => { cancelAnimationFrame(raf); clearTimeout(t) }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div ref={root} className="ls" style={vars || undefined} onClick={finish} aria-hidden="true">
      <style>{CSS}</style>
      <div className="ls-bg" />
      {!reducedMotion && (
        <>
          <svg className="ls-rink" viewBox="0 0 200 380" style={{ width: W, height: (W * 380) / 200 }}>
            <g fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" opacity=".9">
              <rect className="ls-dl ls-rk" pathLength="1" x="20" y="40" width="160" height="300" rx="36" />
              <line className="ls-dl ls-rk" pathLength="1" x1="20" y1="190" x2="180" y2="190" />
              <path className="ls-dl ls-rk" pathLength="1" d="M75 40 v22 a25 25 0 0 0 50 0 v-22" />
              <path className="ls-dl ls-rk" pathLength="1" d="M75 340 v-22 a25 25 0 0 1 50 0 v22" />
              <circle className="ls-dl ls-rk" pathLength="1" cx="100" cy="190" r="64" />
            </g>
          </svg>
          <div className="ls-cw" style={{ width: crest, height: crest }}>
            <img className="ls-fl" src="/logos/crest-base-512.png" alt="" draggable="false" />
            <img className="ls-tx" src="/logos/crest-text-512.png" alt="" draggable="false" />
            <svg viewBox="0 0 200 200" className="ls-lines" stroke="#fff" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
              <circle className="ls-dl ls-c1" pathLength="1" cx="100" cy="100" r="99" transform="rotate(-90 100 100)" />
              <circle className="ls-dl ls-c1" pathLength="1" cx="100" cy="100" r="77" transform="rotate(90 100 100)" stroke="#F2B233" />
              <path className="ls-dl ls-c2" pathLength="1" d="M119 22 L91.5 138 C89 152 84 158 64 160" stroke="#F2B233" strokeWidth="3" />
              <path className="ls-dl ls-c2" pathLength="1" d="M111.2 56 L162 56 M90.9 145 L161.2 145" />
              <path className="ls-dl ls-c3" pathLength="1" d="M142.4 65 L168.4 110 L116.4 110 Z" />
              <path className="ls-dl ls-c3" pathLength="1" d="M142.4 125 L168.4 80 L116.4 80 Z" />
              <path className="ls-dl ls-c3" pathLength="1" d={PLAYER} />
            </svg>
          </div>
        </>
      )}
    </div>
  )
}
