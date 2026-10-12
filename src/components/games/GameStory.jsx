import { useEffect, useState } from "react"
import { Link } from "react-router-dom"
import { BookOpen, PenLine } from "lucide-react"
import { getGameStory, storyParagraphs } from "@/lib/gameStories"
import { useAuth } from "@/lib/AuthContext"

/**
 * סיפור המשחק — the written story of a finished game (game_stories). Visitors see it once a
 * content editor has published it; editors also see the draft here, marked as such, with a
 * link to review it. Renders nothing when there is no story. api/seo.js prints the same
 * title/summary/body for crawlers — keep them in step.
 */
export default function GameStory({ gameId }) {
  const { isAdmin, isContentEditor } = useAuth()
  const [story, setStory] = useState(null)

  useEffect(() => {
    let alive = true
    getGameStory(gameId).then(s => { if (alive) setStory(s) }).catch(() => {})
    return () => { alive = false }
  }, [gameId])

  if (!story || story.status === "rejected") return null
  const draft = story.status !== "published"
  if (draft && !(isAdmin || isContentEditor)) return null
  const paras = storyParagraphs(story.body)
  const moments = Array.isArray(story.moments) ? story.moments : []

  return (
    <article className={`card overflow-hidden ${draft ? "ring-2 ring-amber-400/60" : ""}`} aria-labelledby="game-story-title">
      {story.hero_image_url && (
        <img src={story.hero_image_url} alt={story.title} loading="lazy"
          className="w-full aspect-video object-cover bg-surface-sunken" />
      )}
      <div className="p-5 sm:p-6 space-y-4">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <p className="flex items-center gap-1.5 text-xs font-bold text-brand-strong dark:text-brand-light">
            <BookOpen className="w-4 h-4" /> סיפור המשחק
          </p>
          {draft && (
            <Link to="/creators?tab=stories" className="inline-flex items-center gap-1 text-[11px] font-bold px-2 py-1 rounded-md bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300">
              <PenLine className="w-3 h-3" /> טיוטה — רק עורכים רואים · לבדיקה ופרסום
            </Link>
          )}
        </div>
        <h2 id="game-story-title" className="text-xl sm:text-2xl font-extrabold text-fg-strong leading-snug">{story.title}</h2>
        <p className="text-sm font-semibold text-fg-muted leading-relaxed">{story.summary}</p>
        <div className="space-y-3 text-[15px] leading-7 text-fg">
          {paras.map((p, i) => <p key={i}>{p}</p>)}
        </div>

        {moments.length > 0 && (
          <div className="pt-2">
            <h3 className="text-sm font-bold text-fg-strong mb-2">רגעי המפתח</h3>
            <ol className="relative border-s-2 border-brand/30 ms-1.5 space-y-3">
              {moments.map((m, i) => (
                <li key={i} className="ps-4 relative">
                  <span className="absolute -start-[7px] top-1.5 size-3 rounded-full bg-brand ring-2 ring-surface" aria-hidden="true" />
                  {m.label && <p className="text-[11px] font-bold text-brand-strong dark:text-brand-light">{m.label}</p>}
                  <p className="text-sm text-fg">{m.text}</p>
                  {m.post_id && (
                    <Link to={`/posts/${m.post_id}`} className="text-xs font-semibold text-brand-strong dark:text-brand-light hover:underline">לצפייה בקטע ←</Link>
                  )}
                </li>
              ))}
            </ol>
          </div>
        )}
      </div>
    </article>
  )
}
