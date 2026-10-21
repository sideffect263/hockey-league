import { useState, useEffect, useMemo, useCallback } from "react"
import { Link } from "react-router-dom"
import {
  Upload, Youtube, Loader2, Search, Check, RefreshCw, Trash2, ExternalLink, AlertTriangle, Cpu, Film,
} from "lucide-react"
import { getGames, getTeams } from "@/lib/api"
import {
  INGEST_PIPELINES, PIPELINE_LABEL, STEP_STATUS, JOB_STATUS,
  getIngestJobs, submitIngestJob, requeueStep, deleteIngestJob, parseTimes, fmtTime, outputLinks,
} from "@/lib/videoIngest"
import { MAX_GAME_VIDEO_MB } from "@/lib/gameStories"
import VideoFlow from "@/components/video/VideoFlow"

const DEFAULT_PIPES = ["full_video", "goals", "reel"]
const btn = "inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-semibold transition-colors disabled:opacity-50"
const btnGhost = `${btn} bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-200 hover:bg-slate-200 dark:hover:bg-slate-700`
const input = "w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-brand/40"
const dateLabel = (d) => new Date(d).toLocaleDateString("he-IL", { day: "numeric", month: "numeric", year: "2-digit" })

/**
 * /creators → "העלאת וידאו": hand a game's footage (YouTube link or a file) to the Mac video worker and choose
 * what to make of it. Rows live in video_ingest_jobs (supabase/video-ingest.sql); video-analysis/ingest_worker.py
 * does the work and writes each pipeline's status/note/output back into `steps`.
 */
export default function VideoIngest() {
  const [games, setGames] = useState(null)
  const [jobs, setJobs] = useState(null)
  const [error, setError] = useState(null)

  useEffect(() => {
    Promise.all([getTeams(), getGames("game_date", false)]).then(([teams, gs]) => {
      const t = Object.fromEntries((teams || []).map(x => [x.id, x.name]))
      setGames((gs || []).map(g => ({
        id: g.id, date: g.game_date, status: g.status, isTest: !!g.is_test,
        label: `${t[g.home_team_id] || "?"} – ${t[g.away_team_id] || "?"}`,
      })))
    }).catch(() => setGames([]))
  }, [])

  const load = useCallback(async () => {
    try { setJobs(await getIngestJobs()); setError(null) }
    catch (e) { console.error(e); setError("טעינת רשימת העבודות נכשלה") }
  }, [])
  useEffect(() => { load() }, [load])
  // the worker updates rows as it goes -> refresh while anything is still moving
  const active = (jobs || []).some(j => ["queued", "downloading", "processing"].includes(j.status))
  useEffect(() => {
    if (!active) return
    const t = setInterval(load, 15000)
    return () => clearInterval(t)
  }, [active, load])

  const gameById = useMemo(() => Object.fromEntries((games || []).map(g => [g.id, g])), [games])

  return (
    <div className="space-y-4">
      <div className="card p-4">
        <h2 className="font-bold text-slate-900 dark:text-white">העלאת וידאו</h2>
        <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
          קישור YouTube או קובץ של משחק הוקי גלגיליות → בוחרים מה להפיק ממנו. העיבוד רץ על מחשב הווידאו של הליגה, והתוצרים מגיעים לבדיקה — שום דבר לא מתפרסם אוטומטית.
        </p>
      </div>
      <VideoFlow variant="creators" />
      <IngestForm games={games} onSubmitted={(j) => setJobs(js => [j, ...(js || [])])} />
      <div className="card p-4 flex items-center justify-between gap-3">
        <h3 className="font-bold text-slate-900 dark:text-white">עבודות אחרונות</h3>
        <button onClick={load} className={btnGhost}><RefreshCw className="w-4 h-4" /> רענן</button>
      </div>
      {error && <p className="text-sm text-red-600">{error}</p>}
      {jobs === null && !error && <div className="card p-6 flex justify-center"><Loader2 className="w-5 h-5 animate-spin text-slate-400" /></div>}
      {jobs?.length === 0 && <div className="card p-6 text-center text-sm text-slate-500 dark:text-slate-400">עוד לא נשלחו סרטונים</div>}
      {(jobs || []).map(j => (
        <JobCard key={j.id} job={j} game={gameById[j.game_id]}
          onChange={(nj) => setJobs(js => js.map(x => x.id === nj.id ? nj : x))}
          onDeleted={() => setJobs(js => js.filter(x => x.id !== j.id))} />
      ))}
    </div>
  )
}

function GamePicker({ games, value, onChange }) {
  const [q, setQ] = useState("")
  const list = useMemo(() => {
    const soon = Date.now() + 864e5
    const words = q.trim().split(/\s+/).filter(Boolean)
    return (games || [])
      .filter(g => new Date(g.date).getTime() < soon)
      .filter(g => words.every(w => `${g.label} ${dateLabel(g.date)}`.includes(w)))
      .slice(0, 40)
  }, [games, q])
  const picked = (games || []).find(g => g.id === value)
  return (
    <div className="space-y-2">
      <div className="relative">
        <Search className="w-4 h-4 text-slate-400 absolute top-1/2 -translate-y-1/2 start-3" />
        <input value={q} onChange={e => setQ(e.target.value)} placeholder="חיפוש לפי קבוצה או תאריך…" className={`${input} ps-9`} />
      </div>
      {games === null ? <Loader2 className="w-4 h-4 animate-spin text-slate-400" /> : (
        <select value={value || ""} onChange={e => onChange(e.target.value || null)} className={input} size={Math.min(6, Math.max(2, list.length + 1))}>
          <option value="">— בחרו משחק —</option>
          {picked && !list.some(g => g.id === picked.id) && <option value={picked.id}>{picked.label} · {dateLabel(picked.date)}</option>}
          {list.map(g => (
            <option key={g.id} value={g.id}>{g.isTest ? "🧪 " : ""}{g.label} · {dateLabel(g.date)}{g.status !== "completed" ? " · לא הסתיים" : ""}</option>
          ))}
        </select>
      )}
    </div>
  )
}

function IngestForm({ games, onSubmitted }) {
  const [kind, setKind] = useState("youtube")
  const [url, setUrl] = useState("")
  const [file, setFile] = useState(null)
  const [gameId, setGameId] = useState(null)
  const [pipes, setPipes] = useState(DEFAULT_PIPES)
  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState(null)
  const [err, setErr] = useState(null)
  const [ok, setOk] = useState(false)

  const toggle = (id) => setPipes(ps => ps.includes(id) ? ps.filter(p => p !== id) : [...ps, id])
  const ready = gameId && pipes.length && (kind === "youtube" ? url.trim() : file)
  const game = (games || []).find(g => g.id === gameId)

  const submit = async (e) => {
    e.preventDefault()
    if (!ready || busy) return
    setBusy(true); setErr(null); setOk(false); setProgress(kind === "upload" ? 0 : null)
    try {
      const order = INGEST_PIPELINES.map(p => p.id).filter(id => pipes.includes(id))
      const job = await submitIngestJob({
        gameId, pipelines: order, title: game ? `${game.label} · ${dateLabel(game.date)}` : null,
        source: kind === "youtube" ? { kind, url } : { kind, file }, onProgress: setProgress,
      })
      onSubmitted(job); setOk(true); setUrl(""); setFile(null)
    } catch (ex) { setErr(ex.message || "השליחה נכשלה") }
    finally { setBusy(false); setProgress(null) }
  }

  return (
    <form onSubmit={submit} className="card p-4 space-y-4">
      <div className="space-y-2">
        <p className="text-sm font-semibold text-slate-800 dark:text-slate-100">1. מקור</p>
        <div className="flex gap-2">
          {[["youtube", "קישור YouTube", Youtube], ["upload", "העלאת קובץ", Upload]].map(([k, l, I]) => (
            <button type="button" key={k} onClick={() => setKind(k)}
              className={`${btn} ${kind === k ? "bg-brand text-white" : "bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-200 hover:bg-slate-200 dark:hover:bg-slate-700"}`}>
              <I className="w-4 h-4" /> {l}
            </button>
          ))}
        </div>
        {kind === "youtube" ? (
          <input dir="ltr" value={url} onChange={e => setUrl(e.target.value)} placeholder="https://www.youtube.com/watch?v=…" className={input} />
        ) : (
          <div className="space-y-1">
            <input type="file" accept="video/*" onChange={e => setFile(e.target.files?.[0] || null)}
              className="block w-full text-sm text-slate-600 dark:text-slate-300 file:me-3 file:px-3 file:py-2 file:rounded-lg file:border-0 file:bg-slate-100 dark:file:bg-slate-800 file:font-semibold" />
            <p className="text-[11px] text-slate-500 dark:text-slate-400">עד {MAX_GAME_VIDEO_MB}MB ועד שעה. משחק מלא גדול יותר? העלו ל-YouTube כ"לא רשום" והדביקו את הקישור.</p>
          </div>
        )}
      </div>

      <div className="space-y-2">
        <p className="text-sm font-semibold text-slate-800 dark:text-slate-100">2. משחק</p>
        <GamePicker games={games} value={gameId} onChange={setGameId} />
      </div>

      <div className="space-y-2">
        <p className="text-sm font-semibold text-slate-800 dark:text-slate-100">3. מה להפיק</p>
        <div className="grid gap-2 sm:grid-cols-2">
          {INGEST_PIPELINES.map(p => {
            const on = pipes.includes(p.id)
            return (
              <label key={p.id} className={`flex gap-3 p-3 rounded-xl border cursor-pointer transition-colors ${on ? "border-brand bg-brand/5" : "border-slate-200 dark:border-slate-700 hover:border-slate-300 dark:hover:border-slate-600"}`}>
                <input type="checkbox" checked={on} onChange={() => toggle(p.id)} className="mt-1 accent-brand" />
                <span className="min-w-0">
                  <span className="block text-sm font-bold text-slate-900 dark:text-white">{p.label}</span>
                  <span className="block text-xs text-slate-600 dark:text-slate-300 mt-0.5">{p.what}</span>
                  <span className="block text-[11px] text-slate-500 dark:text-slate-400 mt-1">תוצר: {p.out}</span>
                  {p.note && <span className="flex items-start gap-1 text-[11px] text-violet-700 dark:text-violet-300 mt-1"><Cpu className="w-3 h-3 mt-0.5 shrink-0" />{p.note}</span>}
                </span>
              </label>
            )
          })}
        </div>
        {pipes.includes("reel") && !pipes.includes("goals") && (
          <p className="text-[11px] text-amber-700 dark:text-amber-300">תקציר הגולים נבנה מקליפי הגולים של המשחק שכבר במעבדה.</p>
        )}
      </div>

      {err && <p className="text-sm text-red-600 flex items-center gap-1.5"><AlertTriangle className="w-4 h-4" />{err}</p>}
      {ok && <p className="text-sm text-emerald-600 flex items-center gap-1.5"><Check className="w-4 h-4" />נשלח — העבודה מופיעה ברשימה למטה</p>}
      <div className="flex items-center gap-3">
        <button type="submit" disabled={!ready || busy} className={`${btn} bg-brand text-white hover:bg-brand/90`}>
          {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Film className="w-4 h-4" />} שלח לעיבוד
        </button>
        {progress !== null && <span className="text-xs text-slate-500" dir="ltr">{Math.round(progress * 100)}%</span>}
      </div>
    </form>
  )
}

function JobCard({ job, game, onChange, onDeleted }) {
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(null)
  const del = async () => {
    if (!window.confirm("להסיר את העבודה מהרשימה? (תוצרים שכבר נוצרו נשארים)")) return
    setBusy(true)
    try { await deleteIngestJob(job.id); onDeleted() } catch { setErr("ההסרה נכשלה"); setBusy(false) }
  }
  const statusCls = { done: "text-emerald-600", error: "text-red-600", needs_attention: "text-amber-600" }[job.status] || "text-blue-600"
  return (
    <div className="card p-4 space-y-3">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-bold text-slate-900 dark:text-white">{job.title || game?.label || "משחק"}</span>
            <span className={`text-xs font-semibold ${statusCls}`}>{JOB_STATUS[job.status] || job.status}</span>
          </div>
          <div className="text-xs text-slate-500 dark:text-slate-400 mt-0.5 flex items-center gap-2 flex-wrap">
            <span dir="ltr">{new Date(job.created_at).toLocaleString("he-IL", { day: "numeric", month: "numeric", hour: "2-digit", minute: "2-digit" })}</span>
            {job.source_kind === "youtube"
              ? <a href={job.source_url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 hover:text-brand"><Youtube className="w-3 h-3" /> YouTube</a>
              : <span className="inline-flex items-center gap-1"><Upload className="w-3 h-3" /> קובץ</span>}
            <Link to={`/games/${job.game_id}`} className="inline-flex items-center gap-1 hover:text-brand">עמוד המשחק <ExternalLink className="w-3 h-3" /></Link>
          </div>
        </div>
        <button onClick={del} disabled={busy} className={btnGhost} title="הסר"><Trash2 className="w-4 h-4" /></button>
      </div>
      {job.error && <p className="text-xs text-red-600">{job.error}</p>}
      {err && <p className="text-xs text-red-600">{err}</p>}
      <div className="divide-y divide-slate-100 dark:divide-slate-800">
        {job.pipelines.map(p => <StepRow key={p} job={job} pipeline={p} onChange={onChange} />)}
      </div>
    </div>
  )
}

function StepRow({ job, pipeline, onChange }) {
  const step = job.steps?.[pipeline] || { status: "queued" }
  const st = STEP_STATUS[step.status] || STEP_STATUS.queued
  const links = outputLinks(pipeline, step.output, job.game_id)
  const [times, setTimes] = useState(() => (step.input?.goal_times || []).map(fmtTime).join(", "))
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(null)

  const requeue = async (input) => {
    setBusy(true); setErr(null)
    try { onChange(await requeueStep(job, pipeline, input)) }
    catch { setErr("השליחה נכשלה") }
    finally { setBusy(false) }
  }
  const sendTimes = () => {
    const goal_times = parseTimes(times)
    if (!goal_times) { setErr("פורמט: דקה:שנייה, מופרדים בפסיק (למשל 4:12, 17:40, 1:02:05)"); return }
    requeue({ goal_times })
  }
  const canRetry = ["error", "needs_review", "needs_gpu", "done", "skipped"].includes(step.status)

  return (
    <div className="py-2.5 space-y-1.5">
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-sm font-semibold text-slate-800 dark:text-slate-100">{PIPELINE_LABEL[pipeline] || pipeline}</span>
        <span className={`text-[11px] font-bold px-2 py-0.5 rounded-full ${st.cls}`}>{st.label}</span>
        {step.status === "processing" && <Loader2 className="w-3.5 h-3.5 animate-spin text-blue-500" />}
        <span className="ms-auto flex items-center gap-2 flex-wrap">
          {links.map((l, i) => l.href
            ? <a key={i} href={l.href} target="_blank" rel="noreferrer" className="text-xs text-brand hover:underline inline-flex items-center gap-1">{l.label} <ExternalLink className="w-3 h-3" /></a>
            : <Link key={i} to={l.to} className="text-xs text-brand hover:underline">{l.label}</Link>)}
        </span>
      </div>
      {step.note && <p className={`text-xs whitespace-pre-line ${step.status === "error" ? "text-red-600" : "text-slate-500 dark:text-slate-400"}`}>{step.note}</p>}
      {step.output?.commands?.length > 0 && step.status === "needs_gpu" && (
        <details className="text-[11px] text-slate-500 dark:text-slate-400">
          <summary className="cursor-pointer select-none">פקודות להרצה על מחשב ה-GPU</summary>
          <pre dir="ltr" className="mt-1 p-2 rounded-lg bg-slate-50 dark:bg-slate-900 overflow-x-auto whitespace-pre text-left">{step.output.commands.join("\n")}</pre>
        </details>
      )}
      {pipeline === "goals" && step.status === "needs_review" && (
        <div className="flex gap-2 items-center flex-wrap">
          <input dir="ltr" value={times} onChange={e => setTimes(e.target.value)} placeholder="4:12, 17:40, 1:02:05"
            className={`${input} max-w-xs`} aria-label="זמני הגולים בסרטון" />
          <button onClick={sendTimes} disabled={busy || !times.trim()} className={`${btn} bg-brand text-white`}>
            {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />} חתוך בזמנים האלה
          </button>
        </div>
      )}
      {canRetry && !(pipeline === "goals" && step.status === "needs_review") && (
        <button onClick={() => requeue()} disabled={busy} className="text-[11px] text-slate-500 hover:text-brand inline-flex items-center gap-1">
          <RefreshCw className="w-3 h-3" /> {step.status === "done" ? "הרץ שוב" : step.status === "needs_gpu" ? "בדוק שוב" : "נסה שוב"}
        </button>
      )}
      {err && <p className="text-xs text-red-600">{err}</p>}
    </div>
  )
}
