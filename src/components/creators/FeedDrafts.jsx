import { useState, useEffect, useRef, useCallback } from "react"
import { Link } from "react-router-dom"
import { Send, Trash2, Loader2, Check, Video, Plus, X, StickyNote, ExternalLink } from "lucide-react"
import FeedVideo, { streamPoster } from "@/components/feed/FeedVideo"
import { getFeedDrafts, createFeedDraft, updateFeedDraft, deleteFeedDraft, publishFeedDraft } from "@/lib/feedDrafts"
import { uploadFeedVideo, MAX_FEED_VIDEO_MB } from "@/lib/feedVideo"
import { getGames, getTeams } from "@/lib/api"

/**
 * /creators → "טיוטות לפיד": posts prepared for review (e.g. the game clips cut by the
 * video pipeline). Each draft: the clip as it will look in the feed, an editable caption,
 * the reviewer note, and פרסם / מחק. Publishing posts it to the feed as YOU.
 */
export default function FeedDrafts({ onCountChange }) {
  const [drafts, setDrafts] = useState(null)
  const [error, setError] = useState(null)
  const [names, setNames] = useState({ teams: {}, games: {} })
  const [adding, setAdding] = useState(false)

  const load = useCallback(async () => {
    try { setDrafts(await getFeedDrafts()); setError(null) }
    catch (e) { console.error(e); setError("טעינת הטיוטות נכשלה") }
  }, [])
  useEffect(() => { load() }, [load])
  useEffect(() => { onCountChange?.(drafts?.length ?? 0) }, [drafts, onCountChange])

  useEffect(() => {
    Promise.all([getTeams(), getGames("game_date", false)]).then(([teams, games]) => {
      const t = Object.fromEntries((teams || []).map(x => [x.id, x.name]))
      const g = Object.fromEntries((games || []).map(x => [x.id, {
        label: `${t[x.home_team_id] || "?"} – ${t[x.away_team_id] || "?"} · ${new Date(x.game_date).toLocaleDateString("he-IL", { day: "numeric", month: "numeric" })}`,
        recent: new Date(x.game_date).getTime() < Date.now() + 864e5 && !x.is_test,
        date: x.game_date,
      }]))
      setNames({ teams: t, games: g })
    }).catch(() => {})
  }, [])

  const remove = (id) => setDrafts(ds => ds.filter(d => d.id !== id))

  if (drafts === null && !error) {
    return <div className="card p-8 flex justify-center"><Loader2 className="w-6 h-6 animate-spin text-slate-400" /></div>
  }

  return (
    <div className="space-y-4">
      <div className="card p-4 flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h2 className="font-bold text-slate-900 dark:text-white">טיוטות לפיד</h2>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
            {drafts?.length ? `${drafts.length} טיוטות ממתינות לאישור · "פרסם" מעלה לפיד בשמך` : "אין טיוטות ממתינות"}
          </p>
        </div>
        {!adding && (
          <button onClick={() => setAdding(true)}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-semibold bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-200 hover:bg-slate-200 dark:hover:bg-slate-700">
            <Plus className="w-4 h-4" /> טיוטה חדשה
          </button>
        )}
      </div>
      {error && <p className="text-sm text-red-600">{error}</p>}
      {adding && (
        <NewDraft games={names.games} nextSort={(drafts?.at(-1)?.sort ?? 0) + 1}
          onDone={(d) => { setAdding(false); if (d) setDrafts(ds => [...(ds || []), d]) }} />
      )}
      {(drafts || []).map((d, i) => (
        <DraftCard key={d.id} draft={d} index={i + 1} teamName={names.teams[d.team_id]} game={names.games[d.game_id]}
          onPublished={() => remove(d.id)} onDeleted={() => remove(d.id)} />
      ))}
    </div>
  )
}

function DraftCard({ draft, index, teamName, game, onPublished, onDeleted }) {
  const [body, setBody] = useState(draft.body)
  const [saved, setSaved] = useState(draft.body)
  const [busy, setBusy] = useState(null)   // 'save' | 'publish' | 'delete'
  const [err, setErr] = useState(null)
  const [done, setDone] = useState(null)   // new post id after publishing

  const dirty = body.trim() !== saved.trim()
  const save = async () => {
    const text = body.trim()
    if (!dirty || !text) return true
    setBusy("save"); setErr(null)
    try { await updateFeedDraft(draft.id, { body: text }); setSaved(text); return true }
    catch { setErr("שמירת הכיתוב נכשלה"); return false }
    finally { setBusy(null) }
  }
  const publish = async () => {
    if (!body.trim()) { setErr("כיתוב חובה"); return }
    if (!(await save())) return
    setBusy("publish"); setErr(null)
    try { const id = await publishFeedDraft(draft.id); setDone(id); setTimeout(onPublished, 1600) }
    catch { setErr("הפרסום נכשל") ; setBusy(null) }
  }
  const remove = async () => {
    if (!window.confirm("למחוק את הטיוטה?")) return
    setBusy("delete"); setErr(null)
    try { await deleteFeedDraft(draft.id); onDeleted() }
    catch { setErr("המחיקה נכשלה"); setBusy(null) }
  }

  return (
    <div className={`card p-4 transition-opacity ${done ? "opacity-60" : ""}`}>
      <div className="flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400 mb-3 flex-wrap">
        <span className="w-6 h-6 rounded-full bg-brand/10 text-brand font-bold flex items-center justify-center">{index}</span>
        {teamName && <span className="px-2 py-0.5 rounded-full bg-slate-100 dark:bg-slate-800 font-semibold">{teamName}</span>}
        {game && <Link to={`/games/${draft.game_id}`} className="inline-flex items-center gap-1 hover:text-brand">{game.label} <ExternalLink className="w-3 h-3" /></Link>}
      </div>
      <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] md:items-start">
        {draft.video_uid && draft.video_cf_code ? (
          <FeedVideo provider="cloudflare" videoId={draft.video_uid} cfCode={draft.video_cf_code} ratio={draft.video_ratio}
            poster={streamPoster(draft.video_cf_code, draft.video_uid)} title={saved.split("\n")[0]} />
        ) : <div className="rounded-xl bg-slate-100 dark:bg-slate-800 aspect-video flex items-center justify-center text-sm text-slate-400">ללא וידאו</div>}
        <div className="space-y-2">
          <textarea value={body} onChange={e => setBody(e.target.value.slice(0, 2000))} onBlur={save} rows={4} disabled={!!done}
            className="w-full resize-y bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl px-3 py-2.5 text-sm text-slate-800 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-brand/30 focus:border-brand" />
          {draft.note && (
            <p className="flex gap-1.5 text-xs text-amber-700 dark:text-amber-300 bg-amber-50 dark:bg-amber-900/20 rounded-lg px-2.5 py-2">
              <StickyNote className="w-3.5 h-3.5 shrink-0 mt-px" /> {draft.note}
            </p>
          )}
          {err && <p className="text-xs text-red-600 dark:text-red-400 font-medium">{err}</p>}
          {done ? (
            <p className="inline-flex items-center gap-1.5 text-sm font-semibold text-emerald-600"><Check className="w-4 h-4" /> פורסם בפיד</p>
          ) : (
            <div className="flex items-center gap-2">
              <button onClick={publish} disabled={!!busy}
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-full bg-brand text-white text-sm font-bold hover:bg-brand-hover disabled:opacity-50">
                {busy === "publish" ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />} פרסם
              </button>
              <button onClick={remove} disabled={!!busy} aria-label="מחיקת הטיוטה"
                className="inline-flex items-center gap-1.5 px-3 py-2 rounded-full text-sm font-semibold text-slate-500 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20 disabled:opacity-50">
                {busy === "delete" ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />} מחק
              </button>
              {busy === "save" && <span className="text-xs text-slate-400">שומר…</span>}
              {!busy && dirty && <span className="text-xs text-slate-400">יישמר ביציאה מהשדה</span>}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function NewDraft({ games, nextSort, onDone }) {
  const fileRef = useRef(null)
  const [file, setFile] = useState(null)
  const [body, setBody] = useState("")
  const [gameId, setGameId] = useState("")
  const [progress, setProgress] = useState(null)
  const [err, setErr] = useState(null)
  const recent = Object.entries(games).filter(([, g]) => g.recent).sort((a, b) => new Date(b[1].date) - new Date(a[1].date)).slice(0, 25)

  const save = async () => {
    if (!body.trim()) { setErr("כיתוב חובה"); return }
    setErr(null)
    try {
      let video = null
      if (file) { setProgress(0); video = await uploadFeedVideo(file, setProgress) }
      onDone(await createFeedDraft({ body, video, gameId: gameId || null, sort: nextSort }))
    } catch (e) {
      setErr(e?.message === "too_big" ? `עד ${MAX_FEED_VIDEO_MB}MB` : "השמירה נכשלה"); setProgress(null)
    }
  }

  return (
    <div className="card p-4 space-y-2">
      <div className="flex items-center justify-between">
        <h3 className="font-bold text-slate-900 dark:text-white text-sm">טיוטה חדשה</h3>
        <button onClick={() => onDone(null)} aria-label="ביטול" className="p-1 rounded-full hover:bg-slate-100 dark:hover:bg-slate-800"><X className="w-4 h-4" /></button>
      </div>
      <textarea value={body} onChange={e => setBody(e.target.value.slice(0, 2000))} rows={3} placeholder="כיתוב…"
        className="w-full resize-y bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl px-3 py-2.5 text-sm" />
      <div className="flex items-center gap-2 flex-wrap">
        <input ref={fileRef} type="file" accept="video/*" className="hidden" onChange={e => setFile(e.target.files?.[0] || null)} />
        <button onClick={() => fileRef.current?.click()} disabled={progress != null}
          className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-semibold bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700">
          <Video className="w-4 h-4 text-red-500" /> {file ? file.name : "בחירת סרטון"}
        </button>
        <select value={gameId} onChange={e => setGameId(e.target.value)}
          className="bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg px-2 py-2 text-sm">
          <option value="">ממשחק… (לא חובה)</option>
          {recent.map(([id, g]) => <option key={id} value={id}>{g.label}</option>)}
        </select>
        <button onClick={save} disabled={progress != null}
          className="ms-auto inline-flex items-center gap-1.5 px-4 py-2 rounded-full bg-brand text-white text-sm font-bold disabled:opacity-50">
          {progress != null && <Loader2 className="w-4 h-4 animate-spin" />}
          {progress != null && progress < 1 ? `מעלה ${Math.round(progress * 100)}%` : "שמירה כטיוטה"}
        </button>
      </div>
      {err && <p className="text-xs text-red-600">{err}</p>}
    </div>
  )
}
