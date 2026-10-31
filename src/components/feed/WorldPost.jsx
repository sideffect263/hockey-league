import { useState } from "react"
import { Globe, ExternalLink } from "lucide-react"
import { parseYouTubeId } from "@/lib/video"
import { FeedCard, FeedCardHeader, FeedIcon, INSET } from "@/components/feed/FeedCardShell"
import GameCarousel from "@/components/feed/GameCarousel"

const LESS_KEY = "feed-world-less-v1"
const readLess = () => { try { return localStorage.getItem(LESS_KEY) === "1" } catch { return false } }
const writeLess = v => { try { localStorage.setItem(LESS_KEY, v ? "1" : "0") } catch { /* private mode */ } }

/**
 * All outside news as ONE post (arrangeFeed): its videos as a carousel, anything that
 * isn't a video as a link under it. "הצג פחות" folds it to a single line and stays
 * folded on this device.
 */
export function WorldPost({ post }) {
  const [less, setLess] = useState(readLess)
  const items = post.data?.items || []
  const sources = [...new Set(items.map(i => i.data?.post?.source_name).filter(Boolean))]
  const slides = [], links = []
  for (const it of items) {
    const p = it.data?.post || {}
    const id = parseYouTubeId(p.link_url)
    const caption = (p.body || "").split("\n")[0]
    if (id) slides.push({ key: it.id, kind: "youtube", videoId: id, poster: p.image_url || undefined, caption })
    else if (p.link_url) links.push({ key: it.id, url: p.link_url, caption })
  }
  const toggle = () => { writeLess(!less); setLess(!less) }

  return (
    <FeedCard>
      <FeedCardHeader
        avatar={<FeedIcon tone="bg-[#11161D] text-[#F4F2EC] dark:bg-[#ECEAE4] dark:text-[#11161D]"><Globe className="w-5 h-5" /></FeedIcon>}
        title={<span className="truncate">מהעולם{sources.length ? ` · ${sources.join(", ")}` : ""}</span>}
        meta={<span><span className="tabular-nums">{post.data?.total || items.length}</span> תקצירים מחו״ל</span>}
        menu={
          <button type="button" onClick={toggle} aria-pressed={less}
            className="shrink-0 h-11 px-3.5 rounded-full border border-line text-[12px] font-semibold text-fg-muted hover:text-fg-strong transition-colors">
            {less ? "הצג" : "הצג פחות"}
          </button>
        }
      />
      {!less && (
        <>
          {slides.length > 0 && <GameCarousel slides={slides} label="תקצירים מהעולם" />}
          {links.length > 0 && (
            <ul className={`mt-3 space-y-1 ${INSET}`}>
              {links.map(l => (
                <li key={l.key}>
                  <a href={l.url} target="_blank" rel="noopener noreferrer" className="min-h-[44px] inline-flex items-center gap-1.5 text-[13.5px] text-fg-muted hover:text-fg-strong">
                    <ExternalLink className="w-3.5 h-3.5 shrink-0" />{l.caption}
                  </a>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </FeedCard>
  )
}

/** The line between what is new to you and the rest (FeedTail board, Instagram's "You're all caught up"). */
export function CaughtUpLine({ signedIn }) {
  return (
    <div role="separator" aria-label={signedIn ? "ראית את כל החדש" : "זה כל מה שחדש בליגה"} className="flex flex-col items-center gap-1.5 px-4 pt-5 pb-4 text-center">
      <span className="size-11 rounded-full border-2 border-fg-strong text-fg-strong flex items-center justify-center">
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M6 12.5l4 4L18 8.5" /></svg>
      </span>
      <span className="text-[16px] font-extrabold text-fg-strong">{signedIn ? "ראית את כל החדש" : "זה כל מה שחדש בליגה"}</span>
      <span className="text-[12px] text-fg-muted">מכאן: מהעולם, ואז מה שכבר ראית</span>
    </div>
  )
}

/** "כבר ראית" — the label over what this viewer already saw (FeedTail board). */
export function SeenHeader() {
  return <h2 className="px-4 sm:px-0 pt-4 pb-1 text-[12px] font-bold text-fg-subtle">כבר ראית</h2>
}
