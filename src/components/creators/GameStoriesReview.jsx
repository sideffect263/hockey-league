import { useEffect, useMemo, useState } from "react"
import { Link } from "react-router-dom"
import {
  BookOpen, Check, Ban, Loader2, RefreshCw, ExternalLink, ArrowUp, ArrowDown, Trash2, Sparkles, Film, ChevronRight, ChevronLeft,
  Image as ImageIcon, UploadCloud,
} from "lucide-react"
import {
  getStoriesForReview, saveGameStory, storyParagraphs, bodyFromTimeline, approveStoryRevision, discardStoryRevision,
  getMediaByIds, getEventsByIds, storyMediaIds, storyEventIds, getStoryPublishMode, setStoryPublishMode,
  PUBLISH_MODES, getRecentUploads, streamThumbUrl,
} from "@/lib/gameStories"
import { entityPath } from "@/lib/slugs"
import { useAuth } from "@/lib/AuthContext"
import { BeatHeader, BeatEvidence, VerifiedBadge } from "@/components/games/StoryEvidence"
import { UploadStatusChip } from "@/components/games/GameMediaUpload"

/**
 * סיפורי משחקים — review queue for the evidence-backed game timelines. Drafts, and live stories
 * with a newer version (pending_revision) waiting. An editor checks each beat against its
 * evidence, edits / reorders / removes beats, then publishes, saves or rejects. Admins also set
 * the league-wide publish mode (review → verified → auto).
 */
export default function GameStoriesReview({ onCountChange }) {
  const [items, setItems] = useState(null)
  const [error, setError] = useState(null)
  // One story at a time — a list of them above, previous/next below — instead of one long scroll.
  const [current, setCurrent] = useState(null)

  const load = () => {
    setError(null)
    getStoriesForReview()
      .then(d => { setItems(d); onCountChange?.(d.length) })
      .catch(e => { setError(e.message || "שגיאה בטעינה"); setItems([]) })
  }
  useEffect(load, [])

  const done = (gameId) => setItems(ds => {
    const i = ds.findIndex(d => d.game_id === gameId)
    const next = ds.filter(d => d.game_id !== gameId)
    onCountChange?.(next.length)
    setCurrent(next[Math.min(i, next.length - 1)]?.game_id ?? null)
    return next
  })
  const idx = items ? Math.max(0, items.findIndex(d => d.game_id === current)) : 0
  const selected = items?.[idx] || null

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 text-lg font-extrabold text-fg-strong"><BookOpen className="w-5 h-5 text-brand" /> סיפורי משחקים</h2>
          <p className="text-xs text-fg-muted mt-1 max-w-prose">
            ציר הזמן של כל משחק — נכתב אוטומטית מאירועי המשחק, מהטבלה ומהסרטונים. כל פסקה מצביעה על הראיה שלה:
            בדקו מול הראיה, תקנו אם צריך ופרסמו. רק סיפור שפורסם מופיע באתר ובגוגל.
          </p>
        </div>
        <button onClick={load} className="btn-secondary !px-2.5 shrink-0" aria-label="רענון"><RefreshCw className="w-4 h-4" /></button>
      </div>

      <PublishModeSwitch />

      {items === null ? (
        <div className="card p-8 flex justify-center"><Loader2 className="w-5 h-5 animate-spin text-fg-subtle" /></div>
      ) : (
        <>
          {error && <p className="card p-4 text-sm text-red-600">{error}</p>}
          {items.length === 0 && !error && (
            <div className="card p-10 text-center text-sm text-fg-muted">אין סיפורים שממתינים לבדיקה</div>
          )}
          {items.length > 0 && (
            <StoryNavigator items={items} index={idx} onPick={(i) => setCurrent(items[i].game_id)} />
          )}
          {selected && <StoryReviewCard key={selected.game_id} story={selected} onDone={() => done(selected.game_id)} />}
          {items.length > 1 && (
            <div className="flex items-center justify-between">
              <button onClick={() => setCurrent(items[idx - 1].game_id)} disabled={idx === 0} className="btn-secondary inline-flex items-center gap-1 disabled:opacity-40">
                <ChevronRight className="w-4 h-4" /> הסיפור הקודם
              </button>
              <span className="text-xs text-fg-muted tabular-nums">{idx + 1} / {items.length}</span>
              <button onClick={() => setCurrent(items[idx + 1].game_id)} disabled={idx === items.length - 1} className="btn-secondary inline-flex items-center gap-1 disabled:opacity-40">
                הסיפור הבא <ChevronLeft className="w-4 h-4" />
              </button>
            </div>
          )}
        </>
      )}

      <RecentUploads />
    </div>
  )
}

// ── story list: pick which story to review ──────────────────────────────────

function StoryNavigator({ items, index, onPick }) {
  return (
    <div className="flex gap-2 overflow-x-auto pb-1 [scrollbar-width:thin]" role="tablist" aria-label="סיפורים לבדיקה">
      {items.map((d, i) => {
        const g = d.game
        const active = i === index
        const date = g?.game_date ? new Date(g.game_date).toLocaleDateString("he-IL", { timeZone: "Asia/Jerusalem", day: "numeric", month: "numeric" }) : ""
        return (
          <button key={d.game_id} role="tab" aria-selected={active} onClick={() => onPick(i)}
            className={`shrink-0 text-start rounded-xl border px-3 py-2 transition-colors ${active ? "border-brand bg-brand/10" : "border-line bg-surface hover:bg-surface-sunken"}`}>
            <span className="block text-xs font-bold text-fg-strong whitespace-nowrap">
              {g?.home?.name} <span dir="ltr" className="tabular-nums">{g?.away_score}:{g?.home_score}</span> {g?.away?.name}
            </span>
            <span className="block text-[11px] text-fg-muted whitespace-nowrap">
              {date} · {d.pending_revision ? "גרסה חדשה ממתינה" : "טיוטה"} · {(d.timeline || []).length} פסקאות
            </span>
          </button>
        )
      })}
    </div>
  )
}

// ── publish mode ─────────────────────────────────────────────────────────────

const MODES = {
  review: { label: "הכל דרך עורך", text: "כל סיפור וכל גרסה חדשה מחכים לאישור של עורך לפני שהם מופיעים באתר." },
  verified: { label: "פרסום אוטומטי של מה שמאומת", text: "סיפור שכל הפסקאות שלו נשענות על ראיה מאומתת (לוח שיפוט, טופס, וידאו) מתפרסם לבד. השאר מחכה לעורך." },
  auto: { label: "אוטומטי לגמרי", text: "כל סיפור מתפרסם מיד כשהוא נכתב. עורכים מתקנים בדיעבד." },
}

function PublishModeSwitch() {
  const { isAdmin } = useAuth()
  const [mode, setMode] = useState(null)
  const [busy, setBusy] = useState(null)
  const [err, setErr] = useState(null)

  useEffect(() => { getStoryPublishMode().then(setMode).catch(() => setMode("review")) }, [])

  const choose = async (m) => {
    if (!isAdmin || m === mode || busy) return
    setBusy(m); setErr(null)
    try { await setStoryPublishMode(m); setMode(m) } catch (e) { setErr(e.message || "השמירה נכשלה") } finally { setBusy(null) }
  }

  return (
    <section className="card p-4 space-y-3" aria-labelledby="publish-mode-title">
      <div className="flex items-center justify-between gap-2">
        <h3 id="publish-mode-title" className="text-sm font-bold text-fg-strong">מצב פרסום</h3>
        {!isAdmin && <span className="text-[11px] text-fg-subtle">רק מנהל יכול לשנות</span>}
      </div>
      {mode === null ? (
        <div className="h-10 rounded-lg bg-surface-sunken animate-pulse" />
      ) : (
        <>
          <div role="radiogroup" aria-label="מצב פרסום" className="grid grid-cols-3 gap-1 rounded-xl bg-surface-sunken p-1">
            {PUBLISH_MODES.map((m, i) => {
              const active = m === mode
              return (
                <button key={m} type="button" role="radio" aria-checked={active} disabled={!isAdmin || !!busy}
                  onClick={() => choose(m)}
                  className={`min-h-11 rounded-lg px-1.5 py-1.5 text-[11px] sm:text-xs font-bold leading-tight transition-colors ${active
                    ? "bg-brand text-white shadow-sm"
                    : isAdmin ? "text-fg-muted hover:bg-surface hover:text-fg-strong" : "text-fg-subtle"} disabled:cursor-default`}>
                  {busy === m ? <Loader2 className="w-4 h-4 animate-spin mx-auto" /> : <><span className="opacity-70">{i + 1}.</span> {MODES[m].label}</>}
                </button>
              )
            })}
          </div>
          <p className="text-xs text-fg-muted leading-5">{MODES[mode].text}</p>
        </>
      )}
      {err && <p className="text-xs text-red-600">{err}</p>}
    </section>
  )
}

// ── one story ────────────────────────────────────────────────────────────────

const KIND_LABEL = { intro: "פתיחה", event: "אירוע", context: "רקע", closing: "סיום" }

function StoryReviewCard({ story, onDone }) {
  const hasRevision = !!story.pending_revision
  const [view, setView] = useState(hasRevision && story.status === "published" ? "new" : "live")
  const [title, setTitle] = useState(story.title || "")
  const [summary, setSummary] = useState(story.summary || "")
  const [body, setBody] = useState(story.body || "")
  const [beats, setBeats] = useState(() => (Array.isArray(story.timeline) ? story.timeline : []).map((b, i) => ({ ...b, id: b.id || `b${i + 1}` })))
  const [media, setMedia] = useState({})
  const [events, setEvents] = useState({})
  const [busy, setBusy] = useState(null)
  const [err, setErr] = useState(null)
  const [msg, setMsg] = useState(null)

  const rev = story.pending_revision
  const revTimeline = Array.isArray(rev?.timeline) ? rev.timeline : []

  useEffect(() => {
    const tl = [...(Array.isArray(story.timeline) ? story.timeline : []), ...revTimeline]
    const mids = [...storyMediaIds(tl, story.hero_media_id), ...(rev?.hero_media_id ? [rev.hero_media_id] : [])]
    getMediaByIds(mids).then(setMedia).catch(() => {})
    getEventsByIds(storyEventIds(tl)).then(setEvents).catch(() => {})
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [story.game_id])

  const g = story.game
  const gameUrl = g ? entityPath("games", g) : null
  const date = g?.game_date ? new Date(g.game_date).toLocaleDateString("he-IL", { timeZone: "Asia/Jerusalem" }) : ""
  const homeColor = g?.home?.primary_color || null
  const awayColor = g?.away?.primary_color || null
  const hasTimeline = beats.length > 0 || (Array.isArray(story.timeline) && story.timeline.length > 0)

  const editBeat = (id, p) => setBeats(bs => bs.map(b => (b.id === id ? { ...b, ...p } : b)))
  const moveBeat = (i, d) => setBeats(bs => {
    const j = i + d
    if (j < 0 || j >= bs.length) return bs
    const next = [...bs];[next[i], next[j]] = [next[j], next[i]]
    return next
  })
  const removeBeat = (id) => setBeats(bs => bs.filter(b => b.id !== id))

  const act = async (status) => {
    setBusy(status); setErr(null); setMsg(null)
    try {
      const clean = beats.map(b => ({ ...b, title: String(b.title || "").trim(), text: String(b.text || "").replace(/\r/g, "").trim() }))
      await saveGameStory(story.game_id, {
        title: title.trim(), summary: summary.trim(),
        ...(hasTimeline ? { timeline: clean } : { body: body.replace(/\r/g, "").trim() }),
        status,
      })
      if (status === "draft") setMsg("נשמר")
      // A published story with a pending revision stays in the queue until the revision is handled.
      if (status === "rejected" || (status === "published" && !hasRevision)) onDone()
    } catch (e) { setErr(e.message || "השמירה נכשלה") }
    finally { setBusy(null) }
  }

  const approve = async () => {
    setBusy("approve"); setErr(null)
    try { await approveStoryRevision(story.game_id); onDone() } catch (e) { setErr(e.message || "האישור נכשל"); setBusy(null) }
  }
  const keep = async () => {
    setBusy("keep"); setErr(null)
    try {
      await discardStoryRevision(story.game_id)
      if (story.status === "published") onDone()
      else { setBusy(null); setView("live"); setMsg("הגרסה החדשה נמחקה") }
    } catch (e) { setErr(e.message || "הפעולה נכשלה"); setBusy(null) }
  }

  const live = story.status === "published"
  const bodyPreview = useMemo(() => bodyFromTimeline(beats), [beats])

  return (
    <div className="card overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 border-b border-line bg-surface-sunken/60">
        <p className="text-sm font-bold text-fg-strong min-w-0">
          {g?.home?.name} <span dir="ltr" className="tabular-nums">{g?.away_score}:{g?.home_score}</span> {g?.away?.name}
          <span className="font-normal text-fg-muted"> · {date}</span>
        </p>
        <div className="flex items-center gap-2">
          <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-md ${live ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300" : "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300"}`}>
            {live ? `חי · גרסה ${story.version || 1}` : "טיוטה"}
          </span>
          {gameUrl && (
            <Link to={gameUrl} target="_blank" className="inline-flex items-center gap-1 text-xs font-semibold text-brand-strong dark:text-brand-light hover:underline">
              עמוד המשחק <ExternalLink className="w-3 h-3" />
            </Link>
          )}
        </div>
      </div>

      {hasRevision && (
        <div className="px-4 pt-3">
          <div className="flex items-center gap-2 rounded-lg bg-sky-50 dark:bg-sky-900/30 px-3 py-2 text-xs font-semibold text-sky-900 dark:text-sky-200">
            <Sparkles className="w-3.5 h-3.5 shrink-0" /> גרסה חדשה ממתינה לאישור
            {rev?.generated_at && <span className="font-normal opacity-80">· נכתבה {new Date(rev.generated_at).toLocaleString("he-IL", { dateStyle: "short", timeStyle: "short" })}</span>}
          </div>
          <div role="tablist" className="mt-2 inline-grid grid-cols-2 gap-1 rounded-lg bg-surface-sunken p-1">
            {[["live", live ? "גרסה חיה" : "הטיוטה"], ["new", "גרסה חדשה"]].map(([k, l]) => (
              <button key={k} role="tab" aria-selected={view === k} onClick={() => setView(k)}
                className={`px-3 py-1.5 rounded-md text-xs font-bold ${view === k ? "bg-surface text-fg-strong shadow-sm" : "text-fg-muted"}`}>{l}</button>
            ))}
          </div>
        </div>
      )}

      {view === "new" && hasRevision ? (
        <div className="p-4 space-y-3">
          <h3 className="text-base font-extrabold text-fg-strong">{rev.title}</h3>
          {rev.summary && <p className="text-sm font-semibold text-fg-muted">{rev.summary}</p>}
          {revTimeline.length > 0 ? (
            <ol className="space-y-3">
              {revTimeline.map((b, i) => (
                <li key={b.id || i} className="rounded-lg border border-line p-3 space-y-2">
                  <BeatMeta beat={b} homeColor={homeColor} awayColor={awayColor} />
                  {b.title && <p className="text-sm font-bold text-fg-strong">{b.title}</p>}
                  {b.text && <p className="text-sm leading-6 text-fg">{b.text}</p>}
                  <BeatEvidence beat={b} media={media} events={events} detailed compact />
                </li>
              ))}
            </ol>
          ) : (
            <div className="space-y-2 text-sm leading-6 text-fg">{storyParagraphs(rev.body).map((p, i) => <p key={i}>{p}</p>)}</div>
          )}
          {err && <p className="text-xs text-red-600">{err}</p>}
          <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-line">
            <button onClick={approve} disabled={!!busy} className="btn-primary inline-flex items-center gap-1.5">
              {busy === "approve" ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />} אשר גרסה חדשה
            </button>
            <button onClick={keep} disabled={!!busy} className="btn-secondary">
              {busy === "keep" ? <Loader2 className="w-4 h-4 animate-spin" /> : "השאר את הקיימת"}
            </button>
          </div>
        </div>
      ) : (
        <>
          <div className="p-4 space-y-3">
            <label className="block">
              <span className="text-[11px] font-bold text-fg-subtle">כותרת</span>
              <input value={title} onChange={e => setTitle(e.target.value)} className="input w-full mt-1 font-bold" maxLength={120} />
            </label>
            <label className="block">
              <span className="text-[11px] font-bold text-fg-subtle">תקציר (מופיע גם בגוגל)</span>
              <textarea value={summary} onChange={e => setSummary(e.target.value)} rows={2} className="input w-full mt-1 text-sm" maxLength={220} />
            </label>

            {hasTimeline ? (
              <div className="space-y-3">
                <p className="text-[11px] font-bold text-fg-subtle">
                  ציר הזמן · {beats.length} פסקאות · {beats.filter(b => b.verified).length} מאומתות · {bodyPreview.length} תווים
                </p>
                {beats.length === 0 && <p className="text-xs text-red-600">כל הפסקאות הוסרו — אין מה לפרסם.</p>}
                <ol className="space-y-3">
                  {beats.map((b, i) => (
                    <li key={b.id} className="rounded-lg border border-line bg-surface p-3 space-y-2">
                      <div className="flex items-start justify-between gap-2">
                        <BeatMeta beat={b} homeColor={homeColor} awayColor={awayColor} />
                        <div className="flex items-center gap-0.5 shrink-0">
                          <IconBtn label="הזזה למעלה" onClick={() => moveBeat(i, -1)} disabled={i === 0}><ArrowUp className="w-4 h-4" /></IconBtn>
                          <IconBtn label="הזזה למטה" onClick={() => moveBeat(i, 1)} disabled={i === beats.length - 1}><ArrowDown className="w-4 h-4" /></IconBtn>
                          <IconBtn label="הסרת הפסקה" onClick={() => removeBeat(b.id)} danger><Trash2 className="w-4 h-4" /></IconBtn>
                        </div>
                      </div>
                      <input value={b.title || ""} onChange={e => editBeat(b.id, { title: e.target.value })}
                        className="input w-full text-sm font-bold" placeholder="כותרת הפסקה" maxLength={120} aria-label="כותרת הפסקה" />
                      <textarea value={b.text || ""} onChange={e => editBeat(b.id, { text: e.target.value })}
                        rows={3} className="input w-full text-sm leading-6" aria-label="טקסט הפסקה" />
                      <BeatEvidence beat={b} media={media} events={events} detailed compact />
                    </li>
                  ))}
                </ol>
              </div>
            ) : (
              <label className="block">
                <span className="text-[11px] font-bold text-fg-subtle">הסיפור — פסקאות מופרדות בשורה ריקה · {storyParagraphs(body).length} פסקאות · {body.length} תווים</span>
                <textarea value={body} onChange={e => setBody(e.target.value)} rows={14} className="input w-full mt-1 text-sm leading-6" />
              </label>
            )}
            <p className="text-[10px] text-fg-subtle">נכתב {story.generated_at ? new Date(story.generated_at).toLocaleString("he-IL") : "—"}</p>
          </div>
          {(err || msg) && <p className={`px-4 pb-2 text-xs ${err ? "text-red-600" : "text-emerald-700 dark:text-emerald-400"}`}>{err || msg}</p>}
          <div className="flex flex-wrap items-center gap-2 px-4 py-3 border-t border-line">
            <button onClick={() => act("published")} disabled={!!busy || (hasTimeline && beats.length === 0)} className="btn-primary inline-flex items-center gap-1.5">
              {busy === "published" ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />} {live ? "שמירה ופרסום" : "פרסום"}
            </button>
            {!live && (
              <button onClick={() => act("draft")} disabled={!!busy} className="btn-secondary">
                {busy === "draft" ? <Loader2 className="w-4 h-4 animate-spin" /> : "שמירה"}
              </button>
            )}
            <button onClick={() => { if (window.confirm("לדחות את הסיפור? הוא יוסתר מהאתר.")) act("rejected") }} disabled={!!busy}
              className="ms-auto inline-flex items-center gap-1.5 text-xs font-semibold text-red-600 hover:underline">
              <Ban className="w-3.5 h-3.5" /> דחייה
            </button>
          </div>
        </>
      )}
    </div>
  )
}

function BeatMeta({ beat, homeColor, awayColor }) {
  return (
    <div className="flex flex-wrap items-center gap-1.5 min-w-0">
      <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-md bg-surface-sunken text-fg-muted">{KIND_LABEL[beat.kind] || beat.kind || "פסקה"}</span>
      <VerifiedBadge verified={!!beat.verified} />
      {beat.kind === "event" && <BeatHeader beat={beat} homeColor={homeColor} awayColor={awayColor} />}
    </div>
  )
}

function IconBtn({ label, onClick, disabled, danger, children }) {
  return (
    <button type="button" onClick={onClick} disabled={disabled} aria-label={label} title={label}
      className={`p-1.5 rounded-md text-fg-subtle disabled:opacity-30 ${danger ? "hover:text-red-600" : "hover:text-fg-strong hover:bg-surface-sunken"}`}>
      {children}
    </button>
  )
}

// ── recent uploads across games ──────────────────────────────────────────────

function RecentUploads() {
  const [rows, setRows] = useState(null)
  useEffect(() => { getRecentUploads(30).then(setRows).catch(() => setRows([])) }, [])
  return (
    <section className="card p-4 space-y-3" aria-labelledby="recent-uploads-title">
      <h3 id="recent-uploads-title" className="flex items-center gap-2 text-sm font-bold text-fg-strong">
        <UploadCloud className="w-4 h-4 text-brand" /> מדיה שהועלתה
      </h3>
      {rows === null ? (
        <div className="flex justify-center py-3"><Loader2 className="w-4 h-4 animate-spin text-fg-subtle" /></div>
      ) : rows.length === 0 ? (
        <p className="text-xs text-fg-muted">עדיין לא הועלו סרטונים או תמונות.</p>
      ) : (
        <ul className="divide-y divide-line rounded-lg border border-line overflow-hidden">
          {rows.map(r => {
            const g = r.game
            const url = g ? entityPath("games", g) : null
            const thumb = r.kind === "video" && r.status === "ready" ? streamThumbUrl(r, 1) : null
            return (
              <li key={r.id} className="flex items-center gap-3 p-2.5 bg-surface">
                <div className="size-10 shrink-0 rounded-md bg-surface-sunken overflow-hidden flex items-center justify-center">
                  {thumb ? <img src={thumb} alt="" loading="lazy" className="w-full h-full object-cover" />
                    : r.kind === "video" ? <Film className="w-4 h-4 text-fg-subtle" /> : <ImageIcon className="w-4 h-4 text-fg-subtle" />}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="text-sm font-semibold text-fg-strong truncate min-w-0" dir="auto">{r.title || (r.kind === "video" ? "סרטון" : "תמונה")}</span>
                    <UploadStatusChip status={r.status} />
                  </div>
                  <p className="text-[11px] text-fg-muted truncate">
                    {url ? <Link to={url} className="hover:underline text-brand-strong dark:text-brand-light">{g.home?.name} – {g.away?.name}</Link> : "משחק"}
                    {" · "}{new Date(r.created_at).toLocaleString("he-IL", { timeZone: "Asia/Jerusalem", dateStyle: "short", timeStyle: "short" })}
                  </p>
                  {r.worker_note && <p className={`text-[11px] truncate ${r.status === "error" ? "text-red-600 dark:text-red-400" : "text-fg-subtle"}`}>{r.worker_note}</p>}
                </div>
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}
