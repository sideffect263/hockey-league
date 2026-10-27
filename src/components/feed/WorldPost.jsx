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
        avatar={<FeedIcon tone="bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300"><Globe className="w-5 h-5" /></FeedIcon>}
        title={<span>מהעולם{sources.length ? ` · ${sources.join(", ")}` : ""}</span>}
        meta={<span>{post.data?.total || items.length} עדכונים מחו״ל</span>}
        menu={
          <button type="button" onClick={toggle} className="min-h-[44px] px-2 text-xs font-semibold text-slate-500 dark:text-slate-400 hover:text-brand transition-colors">
            {less ? "הצג" : "הצג פחות"}
          </button>
        }
      />
      {!less && (
        <>
          {slides.length > 0 && <div className="mt-1"><GameCarousel slides={slides} label="תקצירים מהעולם" /></div>}
          {links.length > 0 && (
            <ul className={`mt-3 space-y-1.5 ${INSET}`}>
              {links.map(l => (
                <li key={l.key}>
                  <a href={l.url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 text-sm text-slate-700 dark:text-slate-300 hover:text-brand">
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

/** The line between what is new to you and the rest (Instagram's "You're all caught up"). */
export function CaughtUpLine({ signedIn }) {
  return (
    <div role="separator" className="flex items-center gap-3 px-4 sm:px-0 py-3">
      <span className="flex-1 h-px bg-slate-200 dark:bg-slate-700" />
      <span className="inline-flex items-center gap-2 text-[13px] font-bold text-slate-700 dark:text-slate-300">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9" /><path d="M8 12.5l2.7 2.7L16 9.8" /></svg>
        {signedIn ? "ראית את כל החדש" : "זה כל מה שחדש בליגה"}
      </span>
      <span className="flex-1 h-px bg-slate-200 dark:bg-slate-700" />
    </div>
  )
}
