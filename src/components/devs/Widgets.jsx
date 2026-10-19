import { useEffect, useMemo, useState } from "react"
import { Link } from "react-router-dom"
import { Check, Hand, Loader2, Send, Star, Undo2, RefreshCw, ExternalLink, Search } from "lucide-react"
import { useAuth } from "@/lib/AuthContext"
import {
  NOTE_KINDS, parseNote, tagNote, getRecentStories, getRecentVideoPosts, videoThumb, getRosterForGaps,
} from "@/lib/devs"
import { entityPath } from "@/lib/slugs"
import { SkeletonPanelRows } from "@/components/skeletons/PageSkeletons"
import { Avatar } from "./TopicThread"

// The light interactive pieces on a topic page. Everything a widget produces is a note in the
// topic's thread (dev_topic_notes), tagged so the thread and the widgets can read it back.

const chip = (on) => `px-3 py-1.5 rounded-full text-xs font-semibold border transition-colors ${on
  ? "bg-brand text-white border-brand"
  : "border-slate-200 dark:border-slate-600 text-slate-600 dark:text-slate-300 hover:border-brand/50"}`

function ErrorRow({ text, onRetry }) {
  return (
    <div className="text-sm text-red-600 dark:text-red-400 flex items-center gap-2">
      {text}
      {onRetry && <button onClick={onRetry} className="inline-flex items-center gap-1 underline"><RefreshCw className="w-3 h-3" /> נסו שוב</button>}
    </div>
  )
}

/* ── Proposal / bug / field report → a tagged note ──────────────────────────────────────────── */
export function ProposalForm({ kinds = ["idea", "bug", "proposal"], onPost }) {
  const [kind, setKind] = useState(kinds[0])
  const [title, setTitle] = useState("")
  const [details, setDetails] = useState("")
  const [link, setLink] = useState("")
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(null)
  const [sent, setSent] = useState(false)

  const submit = async (e) => {
    e.preventDefault()
    if (!title.trim()) return
    setBusy(true); setErr(null)
    try {
      const body = [title.trim(), details.trim(), link.trim()].filter(Boolean).join("\n\n")
      await onPost(tagNote(kind, [], body))
      setTitle(""); setDetails(""); setLink(""); setSent(true)
      setTimeout(() => setSent(false), 3000)
    } catch (e2) { setErr(e2.message || "השליחה נכשלה") } finally { setBusy(false) }
  }

  return (
    <form onSubmit={submit} className="space-y-3">
      <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="סוג">
        {kinds.map(k => (
          <button key={k} type="button" role="radio" aria-checked={kind === k} onClick={() => setKind(k)} className={chip(kind === k)}>
            {NOTE_KINDS[k]?.label || k}
          </button>
        ))}
      </div>
      <input value={title} onChange={e => setTitle(e.target.value)} maxLength={140} placeholder="כותרת — במשפט אחד"
        className="filter-input w-full text-sm" />
      <textarea value={details} onChange={e => setDetails(e.target.value)} rows={3} maxLength={3500}
        placeholder={kind === "bug" ? "מה עשיתם, מה ציפיתם שיקרה, מה קרה בפועל. מכשיר ודפדפן/גרסה." : kind === "field" ? "איפה, כמה זמן, מה עבד ומה לא (חום, סוללה, איבוד מעקב)." : "פרטים — מה ולמה זה טוב לליגה."}
        className="filter-input w-full text-sm resize-y" />
      <input value={link} onChange={e => setLink(e.target.value)} dir="ltr" maxLength={300} placeholder="קישור (רשות)"
        className="filter-input w-full text-sm" />
      {err && <p className="text-xs text-red-600 dark:text-red-400">{err}</p>}
      <div className="flex items-center gap-3">
        <button type="submit" disabled={busy || !title.trim()} className="btn-primary btn-sm gap-1.5">
          {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />} שליחה לשרשור
        </button>
        {sent && <span className="text-xs font-semibold text-emerald-600 dark:text-emerald-400 inline-flex items-center gap-1"><Check className="w-3.5 h-3.5" /> נשלח — תודה!</span>}
      </div>
    </form>
  )
}

/* ── Open tasks: claim / done / let go ──────────────────────────────────────────────────────── */
export function TaskBoard({ tasks, notes, profiles, onPost, onDelete }) {
  const { user } = useAuth()
  const [busy, setBusy] = useState(null)
  const state = useMemo(() => {
    const s = {}
    for (const n of notes) {
      const { kind, args } = parseNote(n.body)
      if ((kind !== "claim" && kind !== "done") || !args[0]) continue
      const t = (s[args[0]] ||= { claims: [], done: null })
      if (kind === "claim") t.claims.push(n)
      else t.done = n
    }
    return s
  }, [notes])

  const act = async (id, fn) => { setBusy(id); try { await fn() } finally { setBusy(null) } }

  if (!tasks.length) return null
  return (
    <ul className="space-y-2">
      {tasks.map(t => {
        const st = state[t.id] || { claims: [], done: null }
        const mine = st.claims.find(n => n.author_id === user?.id)
        const people = [...new Set(st.claims.map(n => n.author_id))]
        return (
          <li key={t.id} className={`rounded-xl border p-3 flex items-center gap-3 flex-wrap ${st.done ? "border-emerald-200 dark:border-emerald-900 bg-emerald-50/60 dark:bg-emerald-950/20" : "border-slate-200 dark:border-slate-700"}`}>
            <span className={`w-5 h-5 rounded-full border-2 flex items-center justify-center shrink-0 ${st.done ? "bg-emerald-500 border-emerald-500 text-white" : "border-slate-300 dark:border-slate-600"}`}>
              {st.done && <Check className="w-3 h-3" />}
            </span>
            <span className={`text-sm flex-1 min-w-[10rem] ${st.done ? "line-through text-slate-500" : "text-slate-800 dark:text-slate-200"}`}>{t.title}</span>
            {people.length > 0 && (
              <span className="flex -space-x-2 rtl:space-x-reverse" title={people.map(id => profiles[id]?.display_name || "").join(", ")}>
                {people.slice(0, 4).map(id => <Avatar key={id} profile={profiles[id]} size="w-6 h-6" />)}
              </span>
            )}
            {!st.done && (mine ? (
              <span className="flex gap-1.5">
                <button disabled={busy === t.id} onClick={() => act(t.id, () => onPost(tagNote("done", [t.id], "")))} className="btn-primary btn-sm gap-1">
                  <Check className="w-3.5 h-3.5" /> סיימתי
                </button>
                <button disabled={busy === t.id} onClick={() => act(t.id, () => onDelete(mine.id))} className="btn-secondary btn-sm gap-1">
                  <Undo2 className="w-3.5 h-3.5" /> ויתרתי
                </button>
              </span>
            ) : (
              <button disabled={busy === t.id} onClick={() => act(t.id, () => onPost(tagNote("claim", [t.id], "")))} className="btn-secondary btn-sm gap-1">
                {busy === t.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Hand className="w-3.5 h-3.5" />} אני על זה
              </button>
            ))}
          </li>
        )
      })}
    </ul>
  )
}

/* ── Rate real outputs (published AI stories / feed videos) ─────────────────────────────────── */
function Stars({ value, onChange, size = "w-5 h-5" }) {
  return (
    <span className="inline-flex" dir="ltr" role="radiogroup" aria-label="דירוג">
      {[1, 2, 3, 4, 5].map(n => (
        <button key={n} type="button" role="radio" aria-checked={value === n} aria-label={`${n} מתוך 5`} onClick={() => onChange?.(n)}
          className="p-0.5 disabled:cursor-default" disabled={!onChange}>
          <Star className={`${size} ${n <= (value || 0) ? "fill-amber-400 text-amber-400" : "text-slate-300 dark:text-slate-600"}`} />
        </button>
      ))}
    </span>
  )
}

export function RateOutputs({ source, notes, onPost }) {
  const { user } = useAuth()
  const [items, setItems] = useState(null)
  const [error, setError] = useState(null)
  const [draft, setDraft] = useState({})        // id -> { stars, text }
  const [busy, setBusy] = useState(null)
  const type = source === "stories" ? "story" : "video"

  const load = () => {
    setError(null); setItems(null)
    const q = source === "stories" ? getRecentStories() : getRecentVideoPosts()
    q.then(setItems).catch(e => setError(e.message || "שגיאה בטעינה"))
  }
  useEffect(load, [source]) // eslint-disable-line react-hooks/exhaustive-deps

  // Ratings already in the thread: id -> { sum, n, mine }
  const ratings = useMemo(() => {
    const r = {}
    for (const n of notes) {
      const { kind, args, text } = parseNote(n.body)
      if (kind !== "rate" || args[0] !== type || !args[1]) continue
      const m = /^([1-5])\/5/.exec(text)
      if (!m) continue
      const x = (r[args[1]] ||= { sum: 0, n: 0, mine: false })
      x.sum += Number(m[1]); x.n += 1
      if (n.author_id === user?.id) x.mine = true
    }
    return r
  }, [notes, type, user?.id])

  const send = async (id) => {
    const d = draft[id]
    if (!d?.stars) return
    setBusy(id)
    try {
      await onPost(tagNote("rate", [type, id], `${d.stars}/5${d.text?.trim() ? ` · ${d.text.trim()}` : ""}`))
      setDraft(prev => ({ ...prev, [id]: undefined }))
    } finally { setBusy(null) }
  }

  if (error) return <ErrorRow text={error} onRetry={load} />
  if (items === null) return <SkeletonPanelRows count={3} height="h-20" />
  if (!items.length) return <p className="text-sm text-slate-500">אין עדיין מה לדרג.</p>

  return (
    <ul className="space-y-3">
      {items.map(it => {
        const id = source === "stories" ? it.game_id : it.id
        const r = ratings[id]
        const d = draft[id] || {}
        const title = source === "stories" ? (it.title || "סיפור משחק") : ((it.body || "").split("\n")[0] || "וידאו")
        return (
          <li key={id} className="rounded-xl border border-slate-200 dark:border-slate-700 p-3 flex gap-3">
            {source === "videos" && (
              <Link to={`/posts/${id}`} target="_blank" className="shrink-0 w-28 sm:w-36 aspect-video rounded-lg overflow-hidden bg-slate-900 relative">
                <img src={videoThumb(it)} alt="" loading="lazy" className="w-full h-full object-cover" />
              </Link>
            )}
            <div className="min-w-0 flex-1 space-y-1.5">
              <div className="flex items-start gap-2">
                <Link to={source === "stories" ? `/games/${id}` : `/posts/${id}`} target="_blank"
                  className="text-sm font-semibold text-slate-900 dark:text-white hover:text-brand line-clamp-2 flex-1 min-w-0">
                  {title} <ExternalLink className="inline w-3 h-3 opacity-60" />
                </Link>
                {r && <span className="text-[11px] text-slate-500 whitespace-nowrap" dir="ltr">★ {(r.sum / r.n).toFixed(1)} ({r.n})</span>}
              </div>
              {source === "stories" && it.summary && <p className="text-xs text-slate-500 dark:text-slate-400 line-clamp-2">{it.summary}</p>}
              {r?.mine ? (
                <p className="text-xs font-semibold text-emerald-600 dark:text-emerald-400 inline-flex items-center gap-1"><Check className="w-3.5 h-3.5" /> דירגת</p>
              ) : (
                <div className="flex items-center gap-2 flex-wrap">
                  <Stars value={d.stars} onChange={(s) => setDraft(prev => ({ ...prev, [id]: { ...d, stars: s } }))} />
                  {d.stars && (
                    <>
                      <input value={d.text || ""} onChange={e => setDraft(prev => ({ ...prev, [id]: { ...d, text: e.target.value } }))}
                        maxLength={500} placeholder="מה עבד / לא עבד?" className="filter-input text-xs py-1 flex-1 min-w-[8rem]" />
                      <button onClick={() => send(id)} disabled={busy === id} className="btn-primary btn-sm gap-1">
                        {busy === id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />} שליחה
                      </button>
                    </>
                  )}
                </div>
              )}
            </div>
          </li>
        )
      })}
    </ul>
  )
}

/* ── Roster gaps: players missing a number / position / photo → a correction note ──────────── */
const GAPS = {
  jersey: { label: "בלי מספר חולצה", test: (p) => p.jersey_number == null },
  position: { label: "בלי עמדה", test: (p) => !p.position },
  photo: { label: "בלי תמונה", test: (p) => !p.photo_url },
}

export function DataGaps({ focus = "all", onPost }) {
  const [rows, setRows] = useState(null)
  const [error, setError] = useState(null)
  const [gap, setGap] = useState("jersey")
  const [team, setTeam] = useState("")
  const [q, setQ] = useState("")
  const [fixFor, setFixFor] = useState(null)
  const [fix, setFix] = useState("")
  const [busy, setBusy] = useState(false)
  const [sentIds, setSentIds] = useState(() => new Set())
  const gapKeys = focus === "jersey" ? ["jersey"] : Object.keys(GAPS)

  const load = () => { setError(null); setRows(null); getRosterForGaps().then(setRows).catch(e => setError(e.message || "שגיאה בטעינה")) }
  useEffect(load, [])

  const teams = useMemo(() => [...new Set((rows || []).map(p => p.team_name).filter(Boolean))].sort((a, b) => a.localeCompare(b, "he")), [rows])
  const counts = useMemo(() => Object.fromEntries(gapKeys.map(k => [k, (rows || []).filter(GAPS[k].test).length])), [rows]) // eslint-disable-line react-hooks/exhaustive-deps
  const list = useMemo(() => (rows || [])
    .filter(GAPS[gap].test)
    .filter(p => !team || p.team_name === team)
    .filter(p => !q.trim() || `${p.first_name} ${p.last_name}`.includes(q.trim()))
    .sort((a, b) => a.team_name.localeCompare(b.team_name, "he") || `${a.first_name}`.localeCompare(`${b.first_name}`, "he")), [rows, gap, team, q])

  const send = async (p) => {
    if (!fix.trim()) return
    setBusy(true)
    try {
      await onPost(tagNote("proposal", [], `תיקון רוסטר — ${p.first_name} ${p.last_name} (${p.team_name || "ללא קבוצה"}), ${GAPS[gap].label}: ${fix.trim()}`))
      setSentIds(prev => new Set(prev).add(p.id)); setFixFor(null); setFix("")
    } finally { setBusy(false) }
  }

  if (error) return <ErrorRow text={error} onRetry={load} />
  if (rows === null) return <SkeletonPanelRows count={4} height="h-10" />

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        {gapKeys.map(k => (
          <button key={k} onClick={() => setGap(k)} className={chip(gap === k)}>
            {GAPS[k].label} <span className="opacity-70">{counts[k]}</span>
          </button>
        ))}
      </div>
      <div className="flex flex-wrap gap-2">
        <select value={team} onChange={e => setTeam(e.target.value)} className="filter-input text-sm py-1.5 flex-1 min-w-[9rem]" aria-label="קבוצה">
          <option value="">כל הקבוצות</option>
          {teams.map(t => <option key={t} value={t}>{t}</option>)}
        </select>
        <label className="relative flex-1 min-w-[9rem]">
          <Search className="w-4 h-4 absolute top-1/2 -translate-y-1/2 start-2.5 text-slate-400" />
          <input value={q} onChange={e => setQ(e.target.value)} placeholder="חיפוש שחקן" className="filter-input text-sm py-1.5 w-full ps-8" />
        </label>
      </div>
      {list.length === 0 ? (
        <p className="text-sm text-emerald-600 dark:text-emerald-400 font-semibold">אין חורים כאן — הכל מלא.</p>
      ) : (
        <ul className="divide-y divide-slate-100 dark:divide-slate-800 max-h-96 overflow-y-auto rounded-xl border border-slate-200 dark:border-slate-700">
          {list.slice(0, 80).map(p => (
            <li key={p.id} className="p-2.5 space-y-2">
              <div className="flex items-center gap-2">
                <Link to={entityPath("players", p) || "#"} target="_blank" className="text-sm font-semibold text-slate-800 dark:text-slate-200 hover:text-brand truncate">
                  {p.first_name} {p.last_name}
                </Link>
                <span className="text-xs text-slate-400 truncate">{p.team_name}</span>
                {sentIds.has(p.id) ? (
                  <span className="ms-auto text-xs font-semibold text-emerald-600 dark:text-emerald-400 inline-flex items-center gap-1"><Check className="w-3.5 h-3.5" /> נשלח</span>
                ) : (
                  <button onClick={() => { setFixFor(fixFor === p.id ? null : p.id); setFix("") }} className="ms-auto text-xs font-semibold text-brand hover:underline whitespace-nowrap">
                    אני יודע/ת
                  </button>
                )}
              </div>
              {fixFor === p.id && (
                <div className="flex gap-2">
                  <input autoFocus value={fix} onChange={e => setFix(e.target.value)} maxLength={200}
                    placeholder={gap === "jersey" ? "מספר החולצה הנכון" : gap === "position" ? "שחקן שדה / שוער" : "איפה יש תמונה טובה?"}
                    className="filter-input text-sm py-1 flex-1 min-w-0" />
                  <button onClick={() => send(p)} disabled={busy || !fix.trim()} className="btn-primary btn-sm">שליחה</button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
      {list.length > 80 && <p className="text-xs text-slate-400">מוצגים 80 מתוך {list.length} — סננו לפי קבוצה.</p>}
    </div>
  )
}
