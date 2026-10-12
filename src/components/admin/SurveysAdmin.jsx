import { useEffect, useMemo, useState } from "react"
import { Link } from "react-router-dom"
import {
  ClipboardCheck, Plus, RefreshCw, Pencil, Trash2, Play, Square, ChevronDown, ChevronUp,
  Star, ArrowUp, ArrowDown, X, ExternalLink,
} from "lucide-react"
import {
  listSurveys, createSurvey, updateSurvey, deleteSurvey, setSurveyPosts, listVideoPosts,
  surveyResults, summarize, invalidateSurveyCache,
} from "@/lib/videoSurveys"
import { streamPoster } from "@/components/feed/FeedVideo"
import { SkeletonPanelRows } from "@/components/skeletons/PageSkeletons"

/**
 * /admin → סקרים (admin only). Video surveys: questions shown to signed-in viewers after
 * they've watched one of the survey's feed videos for N seconds (supabase/video-surveys.sql).
 * Create / edit / start / stop / delete, pick the videos, read the answers.
 */

const STATUS = {
  draft:   { label: "טיוטה",  cls: "bg-slate-100 text-slate-600 dark:bg-slate-700 dark:text-slate-300" },
  active:  { label: "פעיל",   cls: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300" },
  stopped: { label: "הופסק",  cls: "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300" },
}

const INPUT = "w-full bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-600 rounded-lg px-3 py-2 text-sm text-slate-800 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-brand/30"
const LABEL = "block text-[11px] font-semibold text-slate-500 dark:text-slate-400 mb-1"
const BTN = "flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-600 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors disabled:opacity-50"

const firstLine = (body) => (body || "").split("\n")[0].slice(0, 80) || "(ללא טקסט)"
const newQid = () => "q" + Math.random().toString(36).slice(2, 8)

const BLANK = {
  title: "", badge_label: "ניסיוני", prompt: "", trigger_seconds: 4, status: "draft",
  questions: [
    { id: "rating", type: "rating", label: "", required: true },
    { id: "text", type: "text", label: "", required: false },
  ],
  post_ids: [],
}

export default function SurveysAdmin() {
  const [surveys, setSurveys] = useState(null)
  const [posts, setPosts] = useState([])
  const [editing, setEditing] = useState(null)    // survey object (BLANK for new)
  const [openId, setOpenId] = useState(null)      // results expanded
  const [busy, setBusy] = useState(null)
  const [error, setError] = useState(null)

  const load = async () => {
    setError(null)
    try {
      const [s, p] = await Promise.all([listSurveys(), listVideoPosts()])
      setSurveys(s); setPosts(p)
    } catch { setSurveys([]); setError("הטעינה נכשלה") }
  }
  useEffect(() => { load() }, [])
  const postsById = useMemo(() => new Map(posts.map(p => [p.id, p])), [posts])

  const setStatus = async (s, status) => {
    setBusy(s.id)
    try { await updateSurvey(s.id, { status }); invalidateSurveyCache(); await load() }
    catch { setError("העדכון נכשל") } finally { setBusy(null) }
  }
  const remove = async (s) => {
    if (!confirm(`למחוק את הסקר "${s.title}" וכל ${s.response_count} התשובות שלו? אי אפשר לבטל.`)) return
    setBusy(s.id)
    try { await deleteSurvey(s.id); invalidateSurveyCache(); await load() }
    catch { setError("המחיקה נכשלה") } finally { setBusy(null) }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <h2 className="flex items-center gap-2 text-lg font-bold text-slate-900 dark:text-white">
          <ClipboardCheck className="w-5 h-5 text-brand" /> סקרים
        </h2>
        <div className="flex items-center gap-2">
          <button onClick={load} className={BTN}><RefreshCw className="w-3.5 h-3.5" /> רענון</button>
          <button onClick={() => setEditing({ ...BLANK, questions: BLANK.questions.map(q => ({ ...q })) })}
                  className="flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-lg bg-brand text-white hover:bg-brand-hover transition-colors">
            <Plus className="w-3.5 h-3.5" /> סקר חדש
          </button>
        </div>
      </div>
      <p className="text-xs text-slate-500 dark:text-slate-400">
        סקר רץ על סרטונים נבחרים בפיד. משתמש מחובר שצפה בסרטון מספיק שניות מקבל את השאלות — פעם אחת לכל סרטון. רק סקר <b>פעיל</b> מוצג.
      </p>
      {error && <p className="text-xs text-red-600 dark:text-red-400">{error}</p>}

      {editing && (
        <SurveyEditor
          initial={editing} posts={posts}
          onCancel={() => setEditing(null)}
          onSaved={async () => { setEditing(null); invalidateSurveyCache(); await load() }}
        />
      )}

      {surveys === null ? <SkeletonPanelRows count={3} /> : surveys.length === 0 ? (
        <div className="card p-6 text-center text-sm text-slate-500 dark:text-slate-400">אין סקרים עדיין</div>
      ) : (
        <div className="space-y-3">
          {surveys.map(s => {
            const st = STATUS[s.status] || STATUS.draft
            const isOpen = openId === s.id
            return (
              <div key={s.id} className="card p-4">
                <div className="flex items-start gap-3 flex-wrap">
                  <div className="flex-1 min-w-[12rem]">
                    <div className="flex items-center gap-2 flex-wrap">
                      <h3 className="font-bold text-slate-900 dark:text-white">{s.title}</h3>
                      <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-full ${st.cls}`}>{st.label}</span>
                    </div>
                    <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                      {s.post_ids.length} סרטונים · אחרי {s.trigger_seconds} שניות צפייה · {s.questions.length} שאלות · {s.response_count} תגובות
                    </p>
                  </div>
                  <div className="flex items-center gap-1.5 flex-wrap">
                    {s.status === "active" ? (
                      <button disabled={busy === s.id} onClick={() => setStatus(s, "stopped")} className={BTN}><Square className="w-3.5 h-3.5" /> עצירה</button>
                    ) : (
                      <button disabled={busy === s.id} onClick={() => setStatus(s, "active")}
                              className={`${BTN} !border-emerald-300 !text-emerald-700 dark:!text-emerald-300`}><Play className="w-3.5 h-3.5" /> הפעלה</button>
                    )}
                    <button onClick={() => setEditing({ ...s, questions: s.questions.map(q => ({ ...q })) })} className={BTN}><Pencil className="w-3.5 h-3.5" /> עריכה</button>
                    <button disabled={busy === s.id} onClick={() => remove(s)} className={`${BTN} !text-red-600`}><Trash2 className="w-3.5 h-3.5" /></button>
                    <button onClick={() => setOpenId(isOpen ? null : s.id)} className={BTN}>
                      תוצאות {isOpen ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                    </button>
                  </div>
                </div>
                {isOpen && <SurveyResults survey={s} postsById={postsById} />}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

// ── editor ─────────────────────────────────────────────────────────────────

function SurveyEditor({ initial, posts, onCancel, onSaved }) {
  const [f, setF] = useState(initial)
  const [picked, setPicked] = useState(() => new Set(initial.post_ids || []))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const set = (k, v) => setF(x => ({ ...x, [k]: v }))
  const setQ = (i, patch) => setF(x => ({ ...x, questions: x.questions.map((q, j) => j === i ? { ...q, ...patch } : q) }))
  const moveQ = (i, d) => setF(x => {
    const qs = [...x.questions]; const j = i + d
    if (j < 0 || j >= qs.length) return x
    ;[qs[i], qs[j]] = [qs[j], qs[i]]
    return { ...x, questions: qs }
  })
  const togglePost = (id) => setPicked(s => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n })

  const save = async () => {
    const questions = f.questions.map(q => ({ ...q, label: q.label.trim() })).filter(q => q.label)
    if (!f.title.trim()) return setError("חסרה כותרת")
    if (!questions.length) return setError("צריך לפחות שאלה אחת")
    const secs = Math.round(Number(f.trigger_seconds))
    if (!(secs >= 1 && secs <= 120)) return setError("שניות צפייה: בין 1 ל-120")
    setBusy(true); setError(null)
    try {
      const fields = { title: f.title.trim(), badge_label: f.badge_label.trim() || "ניסיוני", prompt: f.prompt.trim(),
                       trigger_seconds: secs, questions, status: f.status }
      const id = f.id || await createSurvey(fields)
      if (f.id) await updateSurvey(id, fields)
      await setSurveyPosts(id, [...picked])
      await onSaved()
    } catch { setError("השמירה נכשלה") } finally { setBusy(false) }
  }

  return (
    <div className="card p-4 space-y-4 ring-2 ring-brand/30">
      <div className="flex items-center justify-between">
        <h3 className="font-bold text-slate-900 dark:text-white">{f.id ? "עריכת סקר" : "סקר חדש"}</h3>
        <button onClick={onCancel} aria-label="ביטול" className="p-1 rounded-full text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700"><X className="w-4 h-4" /></button>
      </div>

      <div className="grid sm:grid-cols-2 gap-3">
        <div>
          <label className={LABEL}>כותרת (פנימית)</label>
          <input value={f.title} onChange={e => set("title", e.target.value)} maxLength={120} placeholder="לדוגמה: סימון כדור — משוב" className={INPUT} />
        </div>
        <div>
          <label className={LABEL}>תגית על הסרטון</label>
          <input value={f.badge_label} onChange={e => set("badge_label", e.target.value)} maxLength={40} placeholder="ניסיוני" className={INPUT} />
        </div>
        <div className="sm:col-span-2">
          <label className={LABEL}>הסבר קצר לצופה</label>
          <textarea rows={2} value={f.prompt} onChange={e => set("prompt", e.target.value)} maxLength={300}
                    placeholder="אנחנו מנסים משהו חדש בסרטונים — נשמח לדעתך!" className={INPUT} />
        </div>
        <div>
          <label className={LABEL}>להציג אחרי (שניות צפייה)</label>
          <input type="number" min={1} max={120} value={f.trigger_seconds} onChange={e => set("trigger_seconds", e.target.value)} className={INPUT} />
        </div>
        <div>
          <label className={LABEL}>מצב</label>
          <select value={f.status} onChange={e => set("status", e.target.value)} className={INPUT}>
            {Object.entries(STATUS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
          </select>
        </div>
      </div>

      {/* Questions */}
      <div>
        <label className={LABEL}>שאלות</label>
        <div className="space-y-2">
          {f.questions.map((q, i) => (
            <div key={q.id} className="flex items-center gap-2 flex-wrap rounded-lg border border-slate-200 dark:border-slate-700 p-2">
              <select value={q.type} onChange={e => setQ(i, { type: e.target.value })}
                      className="bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-600 rounded-lg px-2 py-1.5 text-xs">
                <option value="rating">דירוג 1–5</option>
                <option value="text">טקסט חופשי</option>
              </select>
              <input value={q.label} onChange={e => setQ(i, { label: e.target.value })} maxLength={200}
                     placeholder="נוסח השאלה" className={`${INPUT} flex-1 min-w-[10rem] !py-1.5`} />
              <label className="flex items-center gap-1 text-xs text-slate-600 dark:text-slate-300">
                <input type="checkbox" checked={!!q.required} onChange={e => setQ(i, { required: e.target.checked })} /> חובה
              </label>
              <button onClick={() => moveQ(i, -1)} disabled={i === 0} aria-label="למעלה" className="p-1 text-slate-400 disabled:opacity-30"><ArrowUp className="w-3.5 h-3.5" /></button>
              <button onClick={() => moveQ(i, 1)} disabled={i === f.questions.length - 1} aria-label="למטה" className="p-1 text-slate-400 disabled:opacity-30"><ArrowDown className="w-3.5 h-3.5" /></button>
              <button onClick={() => setF(x => ({ ...x, questions: x.questions.filter((_, j) => j !== i) }))} aria-label="מחיקת שאלה"
                      className="p-1 text-red-500"><Trash2 className="w-3.5 h-3.5" /></button>
            </div>
          ))}
          <button onClick={() => setF(x => ({ ...x, questions: [...x.questions, { id: newQid(), type: "text", label: "", required: false }] }))}
                  className={BTN}><Plus className="w-3.5 h-3.5" /> הוספת שאלה</button>
        </div>
        {f.id && <p className="text-[11px] text-slate-400 mt-1">שינוי שאלות בסקר שכבר נענה: תשובות ישנות נשמרות לפי מזהה השאלה.</p>}
      </div>

      {/* Videos */}
      <div>
        <label className={LABEL}>סרטונים ({picked.size} נבחרו)</label>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2 max-h-80 overflow-y-auto p-0.5">
          {posts.map(p => {
            const on = picked.has(p.id)
            return (
              <button key={p.id} type="button" onClick={() => togglePost(p.id)}
                      className={`text-start rounded-lg overflow-hidden border-2 transition-colors ${on ? "border-brand" : "border-transparent opacity-70 hover:opacity-100"}`}>
                <div className="aspect-video bg-slate-800">
                  {p.video_cf_code && <img src={streamPoster(p.video_cf_code, p.video_uid)} alt="" loading="lazy" className="w-full h-full object-cover" />}
                </div>
                <div className="p-1.5 text-[11px] leading-tight text-slate-700 dark:text-slate-200 line-clamp-2 bg-white dark:bg-slate-800">
                  {on && "✓ "}{firstLine(p.body)}
                </div>
              </button>
            )
          })}
        </div>
      </div>

      {error && <p className="text-xs text-red-600 dark:text-red-400">{error}</p>}
      <div className="flex items-center gap-2">
        <button onClick={save} disabled={busy}
                className="px-4 py-2 rounded-lg bg-brand text-white text-sm font-semibold hover:bg-brand-hover transition-colors disabled:opacity-50">
          {busy ? "שומר…" : "שמירה"}
        </button>
        <button onClick={onCancel} className="px-3 py-2 rounded-lg text-sm font-semibold text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-700">ביטול</button>
      </div>
    </div>
  )
}

// ── results ────────────────────────────────────────────────────────────────

function SurveyResults({ survey, postsById }) {
  const [rows, setRows] = useState(null)
  const [postFilter, setPostFilter] = useState("all")
  useEffect(() => { surveyResults(survey.id).then(setRows).catch(() => setRows([])) }, [survey.id])

  if (rows === null) return <div className="mt-4"><SkeletonPanelRows count={2} /></div>
  const filtered = postFilter === "all" ? rows : rows.filter(r => r.post_id === postFilter)
  const answered = filtered.filter(r => !r.dismissed)
  const dismissed = filtered.length - answered.length
  const ratings = summarize(survey.questions, filtered)
  const qLabel = Object.fromEntries(survey.questions.map(q => [q.id, q]))

  return (
    <div className="mt-4 pt-4 border-t border-slate-100 dark:border-slate-700 space-y-4">
      <div className="flex items-center gap-2 flex-wrap text-xs">
        <select value={postFilter} onChange={e => setPostFilter(e.target.value)}
                className="bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-600 rounded-lg px-2 py-1.5 text-xs max-w-full">
          <option value="all">כל הסרטונים</option>
          {survey.post_ids.map(id => <option key={id} value={id}>{firstLine(postsById.get(id)?.body)}</option>)}
        </select>
        <span className="text-slate-500 dark:text-slate-400">{answered.length} ענו · {dismissed} סגרו בלי לענות</span>
      </div>

      {ratings.map(({ question, count, avg, dist }) => (
        <div key={question.id} className="rounded-lg bg-slate-50 dark:bg-slate-800/60 p-3">
          <p className="text-sm font-semibold text-slate-800 dark:text-slate-100">{question.label}</p>
          <div className="flex items-center gap-4 mt-2 flex-wrap">
            <div className="flex items-baseline gap-1">
              <span className="text-3xl font-black text-slate-900 dark:text-white" dir="ltr">{avg == null ? "—" : avg.toFixed(1)}</span>
              <Star className="w-5 h-5 text-amber-400 fill-amber-400 self-center" />
              <span className="text-xs text-slate-500">({count})</span>
            </div>
            <div className="flex-1 min-w-[10rem] space-y-0.5">
              {[5, 4, 3, 2, 1].map(n => {
                const c = dist[n - 1]
                return (
                  <div key={n} className="flex items-center gap-2 text-[11px]">
                    <span className="w-3 text-slate-500" dir="ltr">{n}</span>
                    <div className="flex-1 h-2 rounded-full bg-slate-200 dark:bg-slate-700 overflow-hidden">
                      <div className="h-full bg-amber-400 rounded-full" style={{ width: count ? `${(c / count) * 100}%` : 0 }} />
                    </div>
                    <span className="w-5 text-slate-500 tabular-nums" dir="ltr">{c}</span>
                  </div>
                )
              })}
            </div>
          </div>
        </div>
      ))}

      <div>
        <p className="text-sm font-semibold text-slate-800 dark:text-slate-100 mb-2">תשובות ({answered.length})</p>
        {answered.length === 0 ? <p className="text-xs text-slate-500">אין תשובות עדיין</p> : (
          <div className="space-y-2">
            {answered.map(r => {
              const post = postsById.get(r.post_id)
              return (
                <div key={r.id} className="rounded-lg border border-slate-200 dark:border-slate-700 p-3 text-sm">
                  <div className="flex items-center gap-2 flex-wrap text-xs text-slate-500 dark:text-slate-400 mb-1.5">
                    <span className="font-semibold text-slate-700 dark:text-slate-200">{r.display_name || "משתמש"}</span>
                    <span>·</span>
                    <Link to={`/posts/${r.post_id}`} className="inline-flex items-center gap-1 hover:text-brand">
                      {firstLine(post?.body)} <ExternalLink className="w-3 h-3" />
                    </Link>
                    <span>·</span>
                    <span dir="ltr">{new Date(r.updated_at).toLocaleString("he-IL", { dateStyle: "short", timeStyle: "short" })}</span>
                  </div>
                  {Object.entries(r.answers || {}).map(([qid, v]) => {
                    const q = qLabel[qid]
                    if (v === "" || v == null) return null
                    return (
                      <div key={qid} className="flex gap-2">
                        <span className="text-slate-500 dark:text-slate-400 shrink-0">{q?.label || qid}:</span>
                        {q?.type === "rating" || typeof v === "number"
                          ? <span className="text-amber-500 font-semibold" dir="ltr">{"★".repeat(v)}{"☆".repeat(Math.max(0, 5 - v))}</span>
                          : <span className="text-slate-800 dark:text-slate-100 whitespace-pre-wrap break-words">{String(v)}</span>}
                      </div>
                    )
                  })}
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
