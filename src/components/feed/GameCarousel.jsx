import { useEffect, useRef, useState } from "react"
import { ChevronLeft, ChevronRight } from "lucide-react"
import ExperimentalVideo from "@/components/feed/ExperimentalVideo"
import FeedVideo, { streamPoster } from "@/components/feed/FeedVideo"

/**
 * A swipeable row of videos inside ONE feed post — the game's goal/highlight clips, or
 * the week's outside highlights (arrangeFeed in lib/feed.js). Instagram-carousel rules:
 * one slide on screen, swipe or arrows to move, a counter and dots, and the caption of
 * the slide you are on underneath.
 *
 * Off-screen slides are clipped by the scroller, so FeedVideo's on-screen autoplay
 * only ever plays the slide in view.
 *
 * slides: [{ key, kind: 'cloudflare'|'youtube', videoId, cfCode?, ratio?, poster?, caption, postId? }]
 */
export default function GameCarousel({ slides, label }) {
  const scroller = useRef(null)
  const refs = useRef([])
  const [active, setActive] = useState(0)

  // Which slide is in view — an observer per slide, rooted on the scroller (works in
  // RTL without reasoning about negative scrollLeft).
  useEffect(() => {
    const root = scroller.current
    if (!root) return
    const obs = new IntersectionObserver(entries => {
      for (const e of entries) {
        if (e.isIntersecting) setActive(Number(e.target.dataset.i))
      }
    }, { root, threshold: 0.6 })
    refs.current.forEach(el => el && obs.observe(el))
    return () => obs.disconnect()
  }, [slides.length])

  const go = i => {
    const el = refs.current[Math.max(0, Math.min(slides.length - 1, i))]
    el?.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "center" }) // block nearest: never scrolls the page
  }

  const many = slides.length > 1
  const cur = slides[active] || slides[0]

  return (
    <div data-no-card-nav className="cursor-auto">
      <div className="relative">
        <div
          ref={scroller}
          role="region"
          aria-roledescription="קרוסלה"
          aria-label={label}
          className="flex overflow-x-auto snap-x snap-mandatory overscroll-x-contain [scrollbar-width:none] [&::-webkit-scrollbar]:hidden bg-[#1B2532]"
        >
          {slides.map((s, i) => (
            <div
              key={s.key}
              ref={el => { refs.current[i] = el }}
              data-i={i}
              className="w-full shrink-0 snap-center snap-always"
              aria-roledescription="שקופית"
              aria-label={`${i + 1} מתוך ${slides.length}`}
            >
              {s.kind === "cloudflare"
                ? <ExperimentalVideo postId={s.postId} provider="cloudflare" videoId={s.videoId} cfCode={s.cfCode} ratio={s.ratio}
                    poster={streamPoster(s.cfCode, s.videoId)} title={s.caption?.split("\n")[0]} />
                : <FeedVideo videoId={s.videoId} poster={s.poster || `https://i.ytimg.com/vi/${s.videoId}/hqdefault.jpg`} title={s.caption?.split("\n")[0]} />}
            </div>
          ))}
        </div>

        {many && (
          <>
            <span className="pointer-events-none absolute top-3 left-3 rounded-full bg-[rgba(10,14,20,0.55)] px-2.5 py-1 text-[12px] font-bold text-white tabular-nums" dir="ltr">
              {active + 1}/{slides.length}
            </span>
            {/* Arrows for mouse users; on touch the swipe is the control. RTL: "next" is to the left. */}
            {active > 0 && (
              <button type="button" onClick={() => go(active - 1)} aria-label="הקודם"
                className="hidden sm:flex absolute right-3 top-1/2 -translate-y-1/2 size-11 items-center justify-center rounded-full bg-surface/90 text-fg-strong shadow hover:bg-surface">
                <ChevronRight className="w-5 h-5" />
              </button>
            )}
            {active < slides.length - 1 && (
              <button type="button" onClick={() => go(active + 1)} aria-label="הבא"
                className="hidden sm:flex absolute left-3 top-1/2 -translate-y-1/2 size-11 items-center justify-center rounded-full bg-surface/90 text-fg-strong shadow hover:bg-surface">
                <ChevronLeft className="w-5 h-5" />
              </button>
            )}
          </>
        )}
      </div>

      {many && (
        <div className="flex justify-center gap-1.5 pt-2" aria-hidden="true">
          {slides.map((s, i) => (
            <span key={s.key} className={`h-1.5 rounded-full transition-all ${i === active ? "w-4 bg-fl-accent" : "w-1.5 bg-line-strong"}`} />
          ))}
        </div>
      )}
      {cur?.caption && (
        <p className="px-4 sm:px-0 pt-2 text-[13.5px] leading-[1.5] text-fg-muted line-clamp-2 whitespace-pre-line">{cur.caption}</p>
      )}
    </div>
  )
}

/** A feed item holding an uploaded clip → a carousel slide. */
export function clipSlide(item) {
  const p = item.data?.post || {}
  return {
    key: item.id,
    kind: "cloudflare",
    postId: p.id,
    videoId: p.video_uid,
    cfCode: p.video_cf_code,
    ratio: p.video_ratio,
    caption: (p.body || "").trim(),
  }
}
