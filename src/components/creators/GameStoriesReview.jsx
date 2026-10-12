import { useEffect, useState } from "react"
import { Link } from "react-router-dom"
import { BookOpen, Check, Ban, Loader2, RefreshCw, ExternalLink } from "lucide-react"
import { getStoryDrafts, saveGameStory, storyParagraphs } from "@/lib/gameStories"
import { entityPath } from "@/lib/slugs"

/**
 * סיפורי משחקים — review queue for the stories the game-story routine drafted. An editor
 * reads each against the game page, fixes anything, then publishes (it appears on the game
 * page and in Google's copy of it) or rejects (hidden; the routine won't redo it on its own).
 */
export default function GameStoriesReview({ onCountChange }) {
  const [drafts, setDrafts] = useState(null)
  const [error, setError] = useState(null)

  const load = () => {
    setError(null)
    getStoryDrafts()
      .then(d => { setDrafts(d); onCountChange?.(d.length) })
      .catch(e => { setError(e.message || "שגיאה בטעינה"); setDrafts([]) })
  }
  useEffect(load, [])

  const done = (gameId) => setDrafts(ds => {
    const next = ds.filter(d => d.game_id !== gameId)
    onCountChange?.(next.length)
    return next
  })

  if (drafts === null) return <div className="card p-8 flex justify-center"><Loader2 className="w-5 h-5 animate-spin text-fg-subtle" /></div>

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 text-lg font-extrabold text-fg-strong"><BookOpen className="w-5 h-5 text-brand" /> סיפורי משחקים</h2>
          <p className="text-xs text-fg-muted mt-1 max-w-prose">
            סיפור כתוב לכל משחק שהסתיים — נכתב אוטומטית מהתוצאה, מהטבלה ומהסרטונים של המשחק. קראו מול עמוד המשחק,
            תקנו אם צריך ופרסמו. רק סיפור שפורסם מופיע באתר ובגוגל.
          </p>
        </div>
        <button onClick={load} className="btn-secondary !px-2.5 shrink-0" aria-label="רענון"><RefreshCw className="w-4 h-4" /></button>
      </div>
      {error && <p className="card p-4 text-sm text-red-600">{error}</p>}
      {drafts.length === 0 && !error && (
        <div className="card p-10 text-center text-sm text-fg-muted">אין סיפורים שממתינים לבדיקה</div>
      )}
      {drafts.map(d => <StoryDraft key={d.game_id} draft={d} onDone={() => done(d.game_id)} />)}
    </div>
  )
}

function StoryDraft({ draft, onDone }) {
  const [title, setTitle] = useState(draft.title)
  const [summary, setSummary] = useState(draft.summary)
  const [body, setBody] = useState(draft.body)
  const [busy, setBusy] = useState(null)
  const [err, setErr] = useState(null)
  const g = draft.game
  const gameUrl = g ? entityPath("games", g) : null
  const date = g?.game_date ? new Date(g.game_date).toLocaleDateString("he-IL", { timeZone: "Asia/Jerusalem" }) : ""

  const act = async (status) => {
    setBusy(status); setErr(null)
    try {
      await saveGameStory(draft.game_id, { title: title.trim(), summary: summary.trim(), body: body.replace(/\r/g, "").trim(), status })
      if (status !== "draft") onDone()
    } catch (e) { setErr(e.message || "השמירה נכשלה") }
    finally { setBusy(null) }
  }

  return (
    <div className="card overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 border-b border-line bg-surface-sunken/60">
        <p className="text-sm font-bold text-fg-strong">
          {g?.home?.name} <span dir="ltr" className="tabular-nums">{g?.away_score}:{g?.home_score}</span> {g?.away?.name}
          <span className="font-normal text-fg-muted"> · {date}</span>
        </p>
        {gameUrl && (
          <Link to={gameUrl} target="_blank" className="inline-flex items-center gap-1 text-xs font-semibold text-brand-strong dark:text-brand-light hover:underline">
            עמוד המשחק <ExternalLink className="w-3 h-3" />
          </Link>
        )}
      </div>
      <div className="grid lg:grid-cols-[minmax(0,1fr)_260px] gap-4 p-4">
        <div className="space-y-3 min-w-0">
          <label className="block">
            <span className="text-[11px] font-bold text-fg-subtle">כותרת</span>
            <input value={title} onChange={e => setTitle(e.target.value)} className="input w-full mt-1 font-bold" maxLength={120} />
          </label>
          <label className="block">
            <span className="text-[11px] font-bold text-fg-subtle">תקציר (מופיע גם בגוגל)</span>
            <textarea value={summary} onChange={e => setSummary(e.target.value)} rows={2} className="input w-full mt-1 text-sm" maxLength={220} />
          </label>
          <label className="block">
            <span className="text-[11px] font-bold text-fg-subtle">הסיפור — פסקאות מופרדות בשורה ריקה · {storyParagraphs(body).length} פסקאות · {body.length} תווים</span>
            <textarea value={body} onChange={e => setBody(e.target.value)} rows={14} className="input w-full mt-1 text-sm leading-6" />
          </label>
        </div>
        <div className="space-y-3">
          {draft.hero_image_url && <img src={draft.hero_image_url} alt="" className="w-full aspect-video object-cover rounded-lg bg-surface-sunken" />}
          {Array.isArray(draft.moments) && draft.moments.length > 0 && (
            <div>
              <p className="text-[11px] font-bold text-fg-subtle mb-1">רגעי מפתח ({draft.moments.length})</p>
              <ul className="space-y-1.5 text-xs text-fg">
                {draft.moments.map((m, i) => <li key={i}><b>{m.label}</b> {m.text}</li>)}
              </ul>
            </div>
          )}
          <p className="text-[10px] text-fg-subtle">נכתב {new Date(draft.generated_at).toLocaleString("he-IL")}</p>
        </div>
      </div>
      {err && <p className="px-4 pb-2 text-xs text-red-600">{err}</p>}
      <div className="flex flex-wrap items-center gap-2 px-4 py-3 border-t border-line">
        <button onClick={() => act("published")} disabled={!!busy} className="btn-primary inline-flex items-center gap-1.5">
          {busy === "published" ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />} פרסום
        </button>
        <button onClick={() => act("draft")} disabled={!!busy} className="btn-secondary">
          {busy === "draft" ? <Loader2 className="w-4 h-4 animate-spin" /> : "שמירת טיוטה"}
        </button>
        <button onClick={() => act("rejected")} disabled={!!busy} className="ms-auto inline-flex items-center gap-1.5 text-xs font-semibold text-red-600 hover:underline">
          <Ban className="w-3.5 h-3.5" /> דחייה
        </button>
      </div>
    </div>
  )
}
