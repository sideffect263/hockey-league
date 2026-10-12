import { useEffect, useState } from "react"
import { Link } from "react-router-dom"
import { BookOpen, PenLine, Goal, Sparkles } from "lucide-react"
import { getGameStory, getMediaByIds, getEventsByIds, storyMediaIds, storyEventIds, storyParagraphs, streamThumbUrl } from "@/lib/gameStories"
import { useAuth } from "@/lib/AuthContext"
import { BeatHeader, BeatEvidence } from "@/components/games/StoryEvidence"

/**
 * סיפור המשחק — the story of a finished game as an evidence-backed TIMELINE (game_stories.timeline):
 * each beat sits on a vertical line with the footage / sources that back it right beside it.
 * Visitors see it once published; editors also see a draft (amber) and a note when a newer
 * version waits for review. Old stories without a timeline fall back to body paragraphs.
 * api/seo.js prints the same title/summary/body for crawlers — keep them in step.
 *
 * Props: gameId (required); home / away — optional team rows, for the goal accent colour.
 */
export default function GameStory({ gameId, home = null, away = null }) {
  const { isAdmin, isContentEditor } = useAuth()
  const isEditor = isAdmin || isContentEditor
  const [story, setStory] = useState(null)
  const [media, setMedia] = useState({})
  const [events, setEvents] = useState({})

  useEffect(() => {
    let alive = true
    setStory(null); setMedia({}); setEvents({})
    getGameStory(gameId).then(s => {
      if (!alive || !s) return
      setStory(s)
      const tl = Array.isArray(s.timeline) ? s.timeline : []
      getMediaByIds(storyMediaIds(tl, s.hero_media_id)).then(m => { if (alive) setMedia(m) }).catch(() => {})
      getEventsByIds(storyEventIds(tl)).then(e => { if (alive) setEvents(e) }).catch(() => {})
    }).catch(() => {})
    return () => { alive = false }
  }, [gameId])

  if (!story || story.status === "rejected") return null
  const draft = story.status !== "published"
  if (draft && !isEditor) return null
  const timeline = (Array.isArray(story.timeline) ? story.timeline : []).filter(b => b && (b.title || b.text))
  const paras = storyParagraphs(story.body)
  const moments = Array.isArray(story.moments) ? story.moments : []

  const heroRow = story.hero_media_id ? media[story.hero_media_id] : null
  const heroSrc = story.hero_image_url
    || (heroRow?.kind === "image" ? heroRow.src : heroRow?.kind === "video" ? streamThumbUrl(heroRow, heroRow.clip_start_s || 0) : null)
  const homeColor = home?.primary_color || null
  const awayColor = away?.primary_color || null

  return (
    <article className={`card overflow-hidden ${draft ? "ring-2 ring-amber-400/60" : ""}`} aria-labelledby="game-story-title">
      {draft && (
        <Link to="/creators?tab=stories"
          className="flex items-center gap-2 px-4 py-2.5 text-xs font-bold bg-amber-100 text-amber-900 dark:bg-amber-900/40 dark:text-amber-200 hover:underline">
          <PenLine className="w-3.5 h-3.5 shrink-0" /> טיוטה — רק עורכים רואים. לבדיקה ופרסום ב־יוצרי תוכן ←
        </Link>
      )}
      {!draft && isEditor && story.pending_revision && (
        <Link to="/creators?tab=stories"
          className="flex items-center gap-2 px-4 py-2.5 text-xs font-bold bg-sky-100 text-sky-900 dark:bg-sky-900/40 dark:text-sky-200 hover:underline">
          <Sparkles className="w-3.5 h-3.5 shrink-0" /> גרסה חדשה ממתינה לאישור ←
        </Link>
      )}
      {heroSrc && (
        <img src={heroSrc} alt={story.title} loading="lazy" className="w-full aspect-video object-cover bg-surface-sunken" />
      )}
      <div className="p-4 sm:p-6 space-y-4">
        <p className="flex items-center gap-1.5 text-xs font-bold text-brand-strong dark:text-brand-light">
          <BookOpen className="w-4 h-4" /> סיפור המשחק
        </p>
        <h2 id="game-story-title" className="text-xl sm:text-2xl font-extrabold text-fg-strong leading-snug">{story.title}</h2>
        {story.summary && <p className="text-sm font-semibold text-fg-muted leading-relaxed">{story.summary}</p>}

        {timeline.length > 0 ? (
          <ol className="relative border-s-2 border-line ms-2 space-y-6 pt-1">
            {timeline.map((b, i) => (
              <StoryBeat key={b.id || i} beat={b} media={media} events={events} homeColor={homeColor} awayColor={awayColor} />
            ))}
          </ol>
        ) : (
          <>
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
          </>
        )}
      </div>
    </article>
  )
}

const isGoalBeat = (b, events) =>
  b.kind === "event" && (b.event_ids || []).some(id => events[id]?.kind === "goal")
  || (b.kind === "event" && b.score_after && /שער|גול/.test(String(b.title || "")))

function StoryBeat({ beat, media, events, homeColor, awayColor }) {
  const goal = isGoalBeat(beat, events)
  const sideColor = beat.side === "home" ? homeColor : beat.side === "away" ? awayColor : null
  const accent = goal ? (sideColor || "rgb(var(--brand))") : null
  const isEvent = beat.kind === "event"

  return (
    <li className="relative ps-5">
      {/* node on the line */}
      {goal ? (
        <span className="absolute -start-[13px] top-0 flex items-center justify-center size-6 rounded-full text-white ring-4 ring-surface shadow-sm"
          style={{ backgroundColor: accent }} aria-hidden="true">
          <Goal className="w-3.5 h-3.5" />
        </span>
      ) : (
        <span className={`absolute -start-[7px] top-1.5 size-3 rounded-full ring-4 ring-surface ${isEvent ? "bg-brand" : "bg-line"}`} aria-hidden="true" />
      )}

      <div className={`space-y-2 ${goal ? "rounded-xl border border-line bg-surface-sunken/40 p-3 border-s-4" : ""}`}
        style={goal ? { borderInlineStartColor: accent } : undefined}>
        {isEvent && <BeatHeader beat={beat} homeColor={homeColor} awayColor={awayColor} />}
        {goal && <span className="sr-only">שער</span>}
        {beat.title && <h3 className="text-[15px] font-extrabold text-fg-strong leading-snug">{beat.title}</h3>}
        {beat.text && <p className="text-[15px] leading-7 text-fg">{beat.text}</p>}
        <BeatEvidence beat={beat} media={media} events={events} />
      </div>
    </li>
  )
}
