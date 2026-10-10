import { useEffect, useMemo, useState } from "react"
import { PlayCircle, Play, X, ChevronRight, ChevronLeft, ExternalLink } from "lucide-react"
import { parseYouTubeId, youTubeInText, withoutUrl } from "@/lib/video"
import { noteFeedOpen } from "@/lib/feedImpressions"

/**
 * "סרטונים" — a swipeable row of the newest videos at the top of the feed.
 *
 * Why: ניתוח פיד (2026-10-08) showed videos hold a viewer about twice as long as
 * articles (16s vs 8s median), but they were 1 in 9 news items, so most people
 * scrolled past articles before reaching one. The row puts them first without
 * taking anything out of the stream below — the same items still autoplay there.
 *
 * Tapping a card opens a player sheet WITH SOUND (a tap is a user gesture, so
 * unmuted autoplay is allowed), with next / previous to keep watching.
 */

const MAX = 12

/** Feed items (from buildFeed) that are playable videos — our own uploads (Cloudflare
 *  Stream, feed-video-posts.sql) and YouTube news items — newest first. */
export function videoItems(feed) {
  return feed
    .map(item => {
      const p = item.data?.post
      if (p?.video_uid && p.video_cf_code) {
        const base = `https://customer-${p.video_cf_code}.cloudflarestream.com/${p.video_uid}`
        return {
          key: item.id,
          tags: item.tags,
          videoId: p.video_uid,
          embed: `${base}/iframe?autoplay=true&preload=auto`,
          title: (p.body || "").split("\n")[0],
          source: "ליגת הוקי גלגיליות",
          date: item.date,
          poster: `${base}/thumbnails/thumbnail.jpg?time=2s&height=360`,
          link: p.game_id ? `/games/${p.game_id}` : null,
          linkLabel: "למשחק",
        }
      }
      // A staff post with a pasted YouTube link counts too (FeedPost plays it inline).
      const bodyYt = item.type === "post" ? youTubeInText(p?.body) : null
      const id = item.type === "external" ? parseYouTubeId(p?.link_url) : bodyYt?.id
      if (!id) return null
      return {
        key: item.id,
        tags: item.tags,
        videoId: id,
        embed: `https://www.youtube-nocookie.com/embed/${id}?autoplay=1&rel=0&playsinline=1&modestbranding=1`,
        title: withoutUrl(p.body || "", bodyYt?.url).split("\n")[0] || p.source_name || "וידאו",
        source: p.source_name || "ליגת הוקי גלגיליות",
        date: item.date,
        poster: p.image_url || `https://i.ytimg.com/vi/${id}/hqdefault.jpg`,
        link: p.link_url || bodyYt?.url,
        linkLabel: "יוטיוב",
      }
    })
    .filter(Boolean)
    .sort((a, b) => new Date(b.date) - new Date(a.date))
}

function ago(iso) {
  const h = (Date.now() - new Date(iso).getTime()) / 3600000
  if (h < 1) return "עכשיו"
  if (h < 24) return `לפני ${Math.floor(h)} שע׳`
  const d = Math.floor(h / 24)
  return d === 1 ? "אתמול" : `לפני ${d} ימים`
}

export default function VideoRail({ feed, onShowAll }) {
  const videos = useMemo(() => videoItems(feed).slice(0, MAX), [feed])
  const [open, setOpen] = useState(-1)

  if (videos.length < 2) return null

  const start = (i) => {
    noteFeedOpen(videos[i].key, videos[i].tags)
    setOpen(i)
  }

  return (
    <section aria-label="סרטונים" className="-mx-4 sm:mx-0">
      <div className="flex items-center justify-between px-4 sm:px-0 mb-2">
        <h2 className="flex items-center gap-2 font-bold text-slate-900 dark:text-white">
          <PlayCircle className="w-5 h-5 text-red-500" /> סרטונים
        </h2>
        {onShowAll && (
          <button onClick={onShowAll} className="text-xs font-semibold text-brand hover:underline">
            לכל הסרטונים
          </button>
        )}
      </div>

      <div className="flex gap-3 overflow-x-auto snap-x snap-mandatory px-4 sm:px-0 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {videos.map((v, i) => (
          <button key={v.key} onClick={() => start(i)}
            className="snap-start shrink-0 w-[62vw] max-w-[260px] sm:w-[240px] text-right group focus-visible:outline-none">
            <div className="relative aspect-video rounded-xl overflow-hidden bg-slate-900 ring-1 ring-black/5 group-focus-visible:ring-2 group-focus-visible:ring-brand">
              <img src={v.poster} alt="" loading="lazy" draggable={false}
                   onError={e => { e.currentTarget.style.visibility = "hidden" }}
                   className="absolute inset-0 w-full h-full object-cover transition-transform duration-300 group-hover:scale-105" />
              <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-transparent" />
              <span className="absolute inset-0 flex items-center justify-center">
                <span className="w-11 h-11 rounded-full bg-black/55 backdrop-blur-sm flex items-center justify-center transition-transform group-hover:scale-110">
                  <Play className="w-5 h-5 text-white fill-white translate-x-[1px]" />
                </span>
              </span>
              <span className="absolute bottom-1.5 right-2 left-2 text-[10px] font-semibold text-white/90 truncate">{v.source}</span>
            </div>
            <p className="mt-1.5 text-[13px] font-semibold leading-snug text-slate-800 dark:text-slate-100 line-clamp-2">{v.title}</p>
            <p className="text-[11px] text-slate-500 dark:text-slate-400">{ago(v.date)}</p>
          </button>
        ))}
      </div>

      {open >= 0 && (
        <PlayerSheet videos={videos} index={open} onIndex={(i) => start(i)} onClose={() => setOpen(-1)} />
      )}
    </section>
  )
}

function PlayerSheet({ videos, index, onIndex, onClose }) {
  const v = videos[index]
  const hasPrev = index > 0
  const hasNext = index < videos.length - 1

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === "Escape") onClose()
      // RTL: the "next" arrow points left.
      else if (e.key === "ArrowLeft" && hasNext) onIndex(index + 1)
      else if (e.key === "ArrowRight" && hasPrev) onIndex(index - 1)
    }
    window.addEventListener("keydown", onKey)
    const prev = document.body.style.overflow
    document.body.style.overflow = "hidden"
    return () => { window.removeEventListener("keydown", onKey); document.body.style.overflow = prev }
  }, [index, hasNext, hasPrev, onIndex, onClose])

  return (
    <div className="fixed inset-0 z-[70] bg-black/85 backdrop-blur-sm flex items-center justify-center p-0 sm:p-6"
         role="dialog" aria-modal="true" aria-label={v.title} onClick={onClose}>
      <div className="w-full max-w-4xl" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-3 sm:px-0 mb-2 text-white">
          <button onClick={onClose} aria-label="סגירה" className="p-2 -m-2 rounded-full hover:bg-white/10">
            <X className="w-6 h-6" />
          </button>
          <span className="text-xs text-white/70 tabular-nums" dir="ltr">{index + 1} / {videos.length}</span>
        </div>

        <div className="relative aspect-video bg-black sm:rounded-xl overflow-hidden">
          <iframe key={v.videoId}
            src={v.embed}
            title={v.title} allow="autoplay; encrypted-media; picture-in-picture; fullscreen" allowFullScreen
            referrerPolicy="strict-origin-when-cross-origin"
            className="absolute inset-0 w-full h-full" />
        </div>

        <div className="px-3 sm:px-0 mt-3 text-white">
          <p className="font-bold leading-snug">{v.title}</p>
          <p className="text-xs text-white/60 mt-0.5 flex items-center gap-1.5">
            <span>{v.source}</span>·<span>{ago(v.date)}</span>·
            {v.link && (
              <a href={v.link} {...(v.link.startsWith("/") ? {} : { target: "_blank", rel: "noopener noreferrer" })}
                 className="inline-flex items-center gap-0.5 hover:text-white">
                {v.linkLabel} <ExternalLink className="w-3 h-3" />
              </a>
            )}
          </p>
          <div className="flex items-center justify-between mt-4">
            <button onClick={() => onIndex(index - 1)} disabled={!hasPrev}
              className="inline-flex items-center gap-1 px-3 py-2 rounded-lg bg-white/10 hover:bg-white/20 text-sm font-semibold disabled:opacity-30">
              <ChevronRight className="w-4 h-4" /> הקודם
            </button>
            <button onClick={() => onIndex(index + 1)} disabled={!hasNext}
              className="inline-flex items-center gap-1 px-3 py-2 rounded-lg bg-white/10 hover:bg-white/20 text-sm font-semibold disabled:opacity-30">
              הבא <ChevronLeft className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
