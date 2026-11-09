/**
 * A scroll box whose scrollbar is a rink-hockey stick: the native bar is hidden and an amber
 * stick (grip tape on top, hooked blade at the bottom, same stroke as the brand mark) rides a
 * thin track on the left edge (the end side in RTL). The shaft stretches with the visible
 * share of the content; the blade keeps its shape. Drag the stick, click the track to jump,
 * wheel/touch/keyboard scroll as usual. No overflow → no stick.
 */
import { useCallback, useEffect, useRef, useState } from 'react'

const W = 18        // track / stick width (px)
const MIN_H = 52    // shortest stick, so the blade always reads

export default function StickScrollbar({ className = '', innerClassName = '', children, ...rest }) {
  const boxRef = useRef(null)
  const trackRef = useRef(null)
  const drag = useRef(null)
  const [m, setM] = useState({ top: 0, h: 0, show: false })
  const [dragging, setDragging] = useState(false)

  const measure = useCallback(() => {
    const el = boxRef.current, track = trackRef.current
    if (!el || !track) return
    const { scrollTop, scrollHeight, clientHeight } = el
    const trackH = track.clientHeight
    if (scrollHeight <= clientHeight + 1 || trackH <= 0) { setM((p) => (p.show ? { top: 0, h: 0, show: false } : p)); return }
    const h = Math.max(MIN_H, Math.round((clientHeight / scrollHeight) * trackH))
    const top = Math.round((scrollTop / (scrollHeight - clientHeight)) * (trackH - h))
    setM((p) => (p.top === top && p.h === h && p.show ? p : { top, h, show: true }))
  }, [])

  useEffect(() => {
    const el = boxRef.current
    if (!el) return
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    for (const c of el.children) ro.observe(c)
    const mo = new MutationObserver(measure)
    mo.observe(el, { childList: true, subtree: true })
    window.addEventListener('resize', measure)
    return () => { ro.disconnect(); mo.disconnect(); window.removeEventListener('resize', measure) }
  }, [measure])

  const scrollToThumbTop = (thumbTop) => {
    const el = boxRef.current, track = trackRef.current
    if (!el || !track) return
    const room = track.clientHeight - m.h
    const ratio = room > 0 ? Math.min(1, Math.max(0, thumbTop / room)) : 0
    el.scrollTop = ratio * (el.scrollHeight - el.clientHeight)
  }

  const onThumbDown = (e) => {
    e.preventDefault(); e.stopPropagation()
    e.currentTarget.setPointerCapture(e.pointerId)
    drag.current = { y: e.clientY, top: m.top }
    setDragging(true)
  }
  const onThumbMove = (e) => {
    if (!drag.current) return
    scrollToThumbTop(drag.current.top + (e.clientY - drag.current.y))
  }
  const onThumbUp = () => { drag.current = null; setDragging(false) }

  const onTrackDown = (e) => {
    if (e.target !== e.currentTarget) return
    const r = trackRef.current.getBoundingClientRect()
    scrollToThumbTop(e.clientY - r.top - m.h / 2)
  }

  // Stick drawn in px for the current height: grip tape, shaft, hooked blade curling inward (right).
  const h = m.h, x = 5
  const blade = `M${x} 4 L${x} ${h - 20} Q${x} ${h - 2.5} ${W - 2.5} ${h - 6.5}`

  return (
    <div className={`relative ${className}`}>
      <div ref={boxRef} onScroll={measure} {...rest}
        className={`overflow-y-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden ${innerClassName}`}
        style={{ paddingLeft: W + 4 }}>
        {children}
      </div>
      <div ref={trackRef} onPointerDown={onTrackDown} aria-hidden="true"
        className={`absolute left-1 top-2 bottom-2 transition-opacity ${m.show ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}
        style={{ width: W }}>
        <div className="absolute inset-y-0 left-[4px] w-[2px] rounded-full bg-fg-muted/15 pointer-events-none" />
        {m.show && (
          <svg width={W} height={h} viewBox={`0 0 ${W} ${h}`}
            onPointerDown={onThumbDown} onPointerMove={onThumbMove} onPointerUp={onThumbUp} onPointerCancel={onThumbUp}
            className={`absolute left-0 touch-none select-none cursor-grab transition-[filter] ${dragging ? 'cursor-grabbing brightness-110' : 'hover:brightness-110'}`}
            style={{ top: m.top, filter: 'drop-shadow(0 1px 1.5px rgb(0 0 0 / .25))' }}>
            <path d={blade} fill="none" stroke="rgb(var(--gold))" strokeWidth="4.5" strokeLinecap="round" strokeLinejoin="round" />
            <path d={`M${x} 4 L${x} 16`} fill="none" stroke="rgb(17 22 29 / .75)" strokeWidth="4.5" strokeLinecap="round" />
            <path d={`M${x - 2.2} 8 L${x + 2.2} 9.5 M${x - 2.2} 12 L${x + 2.2} 13.5`} stroke="rgb(var(--gold) / .6)" strokeWidth=".9" />
          </svg>
        )}
      </div>
    </div>
  )
}
