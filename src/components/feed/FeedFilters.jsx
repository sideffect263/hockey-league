import { LayoutGrid, Globe, PlayCircle } from "lucide-react"
import { Comment as MessageSquare, Trophy, Flame, VideoLibrary } from "@/components/icons/BrandIcons"
import { parseYouTubeId, youTubeInText } from "@/lib/video"

export const FEED_FILTERS = [
  { key: "all", label: "הכל", icon: LayoutGrid },
  { key: "video", label: "וידאו", icon: VideoLibrary },
  { key: "posts", label: "פוסטים", icon: MessageSquare },
  { key: "results", label: "תוצאות", icon: Trophy },
  { key: "highlights", label: "שיאים", icon: Flame },
  { key: "world", label: "עולמי", icon: Globe },
]

// Which post types each filter matches
export function matchesFilter(post, key) {
  if (key === "all") return true
  if (key === "posts") return post.type === "post"
  if (key === "results") return post.type === "game_result"
  if (key === "highlights") return ["milestone", "champion", "top_scorer"].includes(post.type)
  if (key === "world") return post.type === "external"
  if (key === "video") return !!post.data?.post?.video_uid
    || (post.type === "post" && !!youTubeInText(post.data?.post?.body))
    || (post.type === "external" && !!parseYouTubeId(post.data?.post?.link_url))
  return true
}

export default function FeedFilters({ active, onChange, counts = {}, orientation = "vertical" }) {
  if (orientation === "horizontal") {
    return (
      <div className="tab-bar overflow-x-auto">
        {FEED_FILTERS.map((f) => (
          <button
            key={f.key}
            onClick={() => onChange(f.key)}
            className={active === f.key ? "tab-active" : "tab-inactive"}
          >
            <f.icon className="w-4 h-4" />
            {f.label}
            {counts[f.key] != null && <span className="text-[11px] opacity-70">{counts[f.key]}</span>}
          </button>
        ))}
      </div>
    )
  }

  return (
    <nav aria-label="סינון הפיד" className="card p-2 space-y-0.5">
      <p className="px-3 pt-1.5 pb-1 text-[12px] font-bold text-fg-muted">
        סינון
      </p>
      {FEED_FILTERS.map((f) => {
        const on = active === f.key
        return (
          <button
            key={f.key}
            onClick={() => onChange(f.key)}
            aria-pressed={on}
            className={`w-full min-h-[44px] flex items-center gap-3 px-3 rounded-control text-[14px] font-semibold transition-colors ${
              on ? "bg-brand text-brand-fg" : "text-fg hover:bg-surface-inset hover:text-fg-strong"
            }`}
          >
            <f.icon size={18} className={on ? "" : "text-fg-muted"} />
            <span className="flex-1 text-right">{f.label}</span>
            {counts[f.key] != null && (
              <span className={`fl-num text-[12px] ${on ? "text-brand-fg" : "text-fg-muted"}`}>
                {counts[f.key]}
              </span>
            )}
          </button>
        )
      })}
    </nav>
  )
}
