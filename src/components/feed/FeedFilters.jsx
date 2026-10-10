import { LayoutGrid, Trophy, Flame, MessageSquare, Globe, PlayCircle } from "lucide-react"
import { parseYouTubeId, youTubeInText } from "@/lib/video"

export const FEED_FILTERS = [
  { key: "all", label: "הכל", icon: LayoutGrid },
  { key: "video", label: "וידאו", icon: PlayCircle },
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
    <nav className="card p-2 space-y-0.5">
      <p className="px-3 pt-1.5 pb-1 text-[11px] font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400">
        סינון
      </p>
      {FEED_FILTERS.map((f) => {
        const on = active === f.key
        return (
          <button
            key={f.key}
            onClick={() => onChange(f.key)}
            className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-semibold transition-all ${
              on
                ? "bg-brand text-white shadow-sm shadow-brand/25"
                : "text-slate-600 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-700/60 hover:text-slate-900 dark:hover:text-white"
            }`}
          >
            <f.icon size={18} className={on ? "" : "text-slate-500 dark:text-slate-400"} />
            <span className="flex-1 text-right">{f.label}</span>
            {counts[f.key] != null && (
              <span className={`text-[11px] font-bold ${on ? "text-brand-fg" : "text-slate-500 dark:text-slate-400"}`}>
                {counts[f.key]}
              </span>
            )}
          </button>
        )
      })}
    </nav>
  )
}
