import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { ArrowRight, Check, X, Loader2, RotateCcw, Plus, Trash2, ChevronLeft, ChevronRight } from "lucide-react"
import { Help as HelpCircle, Checklist as ListChecks } from "@/components/icons/BrandIcons"
import { getMatchRuns, getMatchRun, reviewMatchEvent, addMissedEvent, deleteMatchEvent } from "@/lib/videoLab"
import { loadYouTubeApi } from "@/lib/youtubeApi"

// Lab "סקירת אירועים": the match-stats engine (video-analysis/game_events.py) found these events in a full game.
// Each one is played from the game's YouTube video (a few seconds around it); the editor marks it correct / wrong /
// unsure and adds events the engine missed. Per type: precision = correct / reviewed, misses = what it didn't see.

export const EVENT_TYPES = {
  pass: { label: "מסירה", window: [2.5, 2] },
  pass_lost: { label: "מסירה שאבדה", window: [2.5, 2.5] },
  steal: { label: "חטיפה", window: [2.5, 2] },
  interception: { label: "יירוט", window: [3, 2] },
  shot: { label: "בעיטה", window: [3, 3] },
  goal: { label: "גול", window: [4, 3] },
  save: { label: "הצלת שוער", window: [3, 2] },
  foul: { label: "עבירה על שחקן", window: [3, 3] },
  hold: { label: "שמירה על הכדור", window: [2, 3] },
  screen: { label: "חסימה", window: [3, 2] },
  out: { label: "כדור יצא", window: [3, 2] },
}

// What an event means FOR WHICH TEAM, as a full phrase — the bare "team" of a turnover was read both ways
// (who lost it vs who won it) in the first review, 2026-10-13. Ball-loss types always name the team that LOST it.
const TEAM_ROLE = {
  pass: "מסירה של", pass_lost: "איבדה את הכדור במסירה —", steal: "חטפה את הכדור —", interception: "יירטה את הכדור —",
  shot: "בעיטה של", goal: "גול של", save: "הצלה של השוער של", foul: "עבירה של שחקן של", hold: "שמירה על הכדור —", screen: "חסימה של שחקן של",
  out: "הכדור יצא — נגע אחרון:",
}
export function phrase(type, team, teams) {
  const n = teams?.[team] || team || ""
  if (!type) return ""
  if (type === "nothing") return "לא היה כלום"
  if (type === "steal" || type === "interception" || type === "pass_lost") {
    const verb = type === "steal" ? "חטפה את הכדור" : type === "interception" ? "יירטה את הכדור" : "איבדה את הכדור במסירה"
    return `${n} ${verb}`
  }
  return `${TEAM_ROLE[type] || EVENT_TYPES[type]?.label || type} ${n}`.trim()
}
const OUTCOME = { goal: "גול", saved: "נעצרה", blocked: "נחסמה", wide: "החטיאה" }
const VERDICT = {
  correct: { label: "נכון", cls: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300" },
  wrong: { label: "שגוי", cls: "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300" },
  unsure: { label: "לא בטוח", cls: "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300" },
}
const TEAM_DOT = { red: "bg-red-500", blue: "bg-blue-500" }
const mmss = (t) => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, "0")}`

export function MatchRunsCard({ onOpen }) {
  const [runs, setRuns] = useState(null)
  useEffect(() => { getMatchRuns().then(setRuns).catch(() => setRuns([])) }, [])
  if (!runs || runs.length === 0) return null
  return (
    <div className="card p-4 space-y-3">
      <div className="flex items-start gap-3">
        <ListChecks className="w-5 h-5 text-brand shrink-0 mt-0.5" />
        <div className="min-w-0">
          <h3 className="font-bold text-slate-900 dark:text-white">סקירת אירועים במשחק</h3>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-0.5">
            המנוע עבר על משחק שלם ומצא מסירות, חטיפות, בעיטות ועוד. בודקים כל אירוע בסרטון — נכון או לא — ומוסיפים מה שפוספס.
            כך יודעים כמה כל מספר בסטטיסטיקה אמין, והמנוע לומד.
          </p>
        </div>
      </div>
      <div className="grid sm:grid-cols-2 gap-2">
        {runs.map(r => (
          <button key={r.id} onClick={() => onOpen(r.id)} className="text-start rounded-xl border border-slate-200 dark:border-slate-700 p-3 hover:ring-2 hover:ring-brand/40">
            <span className="font-semibold text-sm text-slate-900 dark:text-white block">{r.title}</span>
            <span className="text-xs text-slate-500">{r.video_lab_match_events?.[0]?.count ?? 0} אירועים · {new Date(r.created_at).toLocaleDateString("he-IL")}</span>
          </button>
        ))}
      </div>
    </div>
  )
}

function useYouTube(videoId, boxRef) {
  const player = useRef(null)
  const [ready, setReady] = useState(false)
  useEffect(() => {
    let dead = false
    loadYouTubeApi().then((YT) => {
      if (dead || !boxRef.current) return
      const el = document.createElement("div"); boxRef.current.appendChild(el)
      player.current = new YT.Player(el, {
        videoId, width: "100%", height: "100%",
        playerVars: { rel: 0, modestbranding: 1, playsinline: 1, controls: 1 },
        events: { onReady: () => !dead && setReady(true) },
      })
    })
    return () => { dead = true; try { player.current?.destroy() } catch { /* already gone */ } }
  }, [videoId, boxRef])
  return [player, ready]
}

export function MatchReviewEditor({ id, onBack }) {
  const [run, setRun] = useState(null)
  const [events, setEvents] = useState([])
  const [err, setErr] = useState(null)
  const [sel, setSel] = useState(null)                     // event id
  const [typeF, setTypeF] = useState("all")
  const [teamF, setTeamF] = useState("all")
  const [onlyOpen, setOnlyOpen] = useState(true)
  const [wrongFor, setWrongFor] = useState(null)           // event id waiting for "what was it really"
  const [adding, setAdding] = useState(null)               // {t} while choosing a missed event's type
  const boxRef = useRef(null)
  const stopAt = useRef(null)
  const listRef = useRef(null)

  useEffect(() => {
    getMatchRun(id).then(r => { setRun(r); setEvents([...r.events].sort((a, b) => a.t - b.t)) }).catch(e => setErr(e.message || "שגיאה בטעינה"))
  }, [id])
  const [player, ready] = useYouTube(run?.youtube_id, boxRef)

  // stop the clip at the end of its window
  useEffect(() => {
    const t = setInterval(() => {
      const p = player.current
      if (stopAt.current != null && p?.getCurrentTime && p.getCurrentTime() >= stopAt.current) { p.pauseVideo(); stopAt.current = null }
    }, 150)
    return () => clearInterval(t)
  }, [player])

  const play = useCallback((e) => {
    const p = player.current
    if (!p?.seekTo || !e) return
    const [pre, post] = (EVENT_TYPES[e.type] || { window: [3, 2] }).window
    p.seekTo(Math.max(0, e.t - pre), true); p.playVideo(); stopAt.current = e.t + post
  }, [player])

  const shown = useMemo(() => events.filter(e =>
    (typeF === "all" || e.type === typeF) && (teamF === "all" || e.team === teamF) && (!onlyOpen || !e.verdict || e.id === sel)
  ), [events, typeF, teamF, onlyOpen, sel])

  const select = (e) => { setSel(e?.id ?? null); setWrongFor(null); if (e) play(e) }
  useEffect(() => { if (ready && sel) play(events.find(e => e.id === sel)) }, [ready]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { listRef.current?.querySelector(`[data-id="${sel}"]`)?.scrollIntoView({ block: "nearest" }) }, [sel])

  const next = (fromId) => {
    const i = shown.findIndex(e => e.id === fromId)
    const n = shown.slice(i + 1).find(e => !e.verdict) || shown[i + 1]
    select(n || null)
  }

  const verdict = async (e, v, extra = {}) => {
    if (!e) return
    if (v === "wrong" && !("actual_type" in extra)) { setWrongFor(e.id); return }
    if (v === "wrong" && extra.actual_type && extra.actual_type !== "nothing") {
      const twin = events.find(x => x.id !== e.id && Math.abs(x.t - e.t) <= 1.5 &&
        (x.verdict === "wrong" ? x.actual_type : x.type) === extra.actual_type && (x.verdict === "wrong" ? x.actual_team : x.team) === extra.actual_team && x.verdict && x.verdict !== "unsure")
      if (twin && window.confirm(`האירוע הזה כבר מסומן ב-${mmss(twin.t)} ("${phrase(extra.actual_type, extra.actual_team, teams)}"). לסמן את זה כ"לא היה כלום" כדי שלא ייספר פעמיים?`))
        extra = { actual_type: "nothing", actual_team: null }
    }
    const patch = { verdict: v, actual_type: null, actual_team: null, ...extra }
    setEvents(prev => prev.map(x => x.id === e.id ? { ...x, ...patch, reviewed_at: new Date().toISOString() } : x))
    setWrongFor(null)
    try { await reviewMatchEvent(e.id, patch); setErr(null) } catch (er) { setErr(`לא נשמר: ${er.message}`) }
    next(e.id)
  }

  // Same event twice = double-counted stats. Before adding, look for one of the same type + team within 1.5 s
  // (first review, 2026-10-13: a steal was marked 3 times, a shot added on top of a corrected engine shot).
  const twinOf = (t, type, team) => events.find(e => Math.abs(e.t - t) <= 1.5 &&
    ((e.verdict === "wrong" ? e.actual_type : e.type) === type) && ((e.verdict === "wrong" ? e.actual_team : e.team) === team) && e.verdict !== "unsure")
  const addMiss = async (type, team) => {
    if (!adding) return
    const twin = twinOf(adding.t, type, team)
    if (twin && !window.confirm(`כבר יש "${phrase(type, team, teams)}" ב-${mmss(twin.t)} (${Math.abs(twin.t - adding.t).toFixed(1)} שנ׳ מכאן). להוסיף בכל זאת אירוע נפרד?`)) { setAdding(null); select(twin); return }
    try {
      const ev = await addMissedEvent(id, adding.t, type, team)
      setEvents(prev => [...prev, ev].sort((a, b) => a.t - b.t)); setAdding(null)
    } catch (er) { setErr(`לא נשמר: ${er.message}`) }
  }

  const cur = events.find(e => e.id === sel)
  useEffect(() => {
    const onKey = (k) => {
      if (k.target.closest?.("input,textarea,select")) return
      const key = k.key.toLowerCase()
      if (key === "v" || key === "ה") verdict(cur, "correct")
      else if (key === "x" || key === "ס") verdict(cur, "wrong")
      else if (key === "u" || key === "ו") verdict(cur, "unsure")
      else if (key === "r" || key === "ר") play(cur)
      else if (k.key === "ArrowDown") { k.preventDefault(); const i = shown.findIndex(e => e.id === sel); select(shown[Math.min(shown.length - 1, i + 1)]) }
      else if (k.key === "ArrowUp") { k.preventDefault(); const i = shown.findIndex(e => e.id === sel); select(shown[Math.max(0, i - 1)]) }
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  })

  if (err && !run) return <div className="card p-6 text-sm text-red-600">{err} <button onClick={onBack} className="underline ms-2">חזרה</button></div>
  if (!run) return <div className="card p-6 flex justify-center"><Loader2 className="w-5 h-5 animate-spin text-slate-400" /></div>

  const teams = run.teams || { red: "אדומים", blue: "כחולים" }
  const engineEv = events.filter(e => e.source === "engine")
  const reviewed = engineEv.filter(e => e.verdict).length
  const btn = "p-2 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-200 disabled:opacity-40"

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 flex-wrap">
        <button onClick={onBack} className={btn} aria-label="חזרה לרשימה"><ArrowRight className="w-5 h-5" /></button>
        <h2 className="font-bold text-slate-900 dark:text-white flex-1 min-w-0 truncate">{run.title}</h2>
        <span className="text-sm text-slate-500 tabular-nums">נבדקו {reviewed} / {engineEv.length}</span>
      </div>
      {err && <div className="text-xs text-red-600">{err}</div>}

      <Accuracy events={events} />

      <div className="grid lg:grid-cols-[1fr_22rem] gap-3 items-start">
        <div className="space-y-2">
          <div ref={boxRef} className="relative w-full aspect-video rounded-xl overflow-hidden bg-black [&>*]:absolute [&>*]:inset-0 [&>*]:w-full [&>*]:h-full" />
          {cur ? (
            <div className="card p-3 space-y-2">
              <div className="flex items-center gap-2 flex-wrap text-sm">
                <span className="tabular-nums text-slate-500" dir="ltr">{mmss(cur.t)}</span>
                {cur.team && <span className={`w-2.5 h-2.5 rounded-full ${TEAM_DOT[cur.team]}`} />}
                <b className="text-slate-900 dark:text-white">{phrase(cur.type, cur.team, teams)}</b>
                {cur.verdict === "wrong" && cur.actual_type && <span className="text-xs text-red-600">← תוקן ל: {phrase(cur.actual_type, cur.actual_team, teams)}</span>}
                {cur.data?.outcome && <span className="text-slate-500">· {OUTCOME[cur.data.outcome] || cur.data.outcome}</span>}
                {cur.data?.len != null && <span className="text-slate-500">· {cur.data.len} מ׳</span>}
                {cur.source === "human" && <span className="text-xs text-slate-400">(נוסף ידנית)</span>}
                <button onClick={() => play(cur)} className="ms-auto text-xs inline-flex items-center gap-1 text-slate-500 hover:text-brand"><RotateCcw className="w-3.5 h-3.5" /> שוב (R)</button>
              </div>
              {cur.source === "engine" ? (
                wrongFor === cur.id ? (
                  <div className="space-y-2">
                    <div className="text-sm text-slate-700 dark:text-slate-200">מה קרה באמת? כל כפתור אומר גם <b>מי</b>.</div>
                    <button onClick={() => verdict(cur, "wrong", { actual_type: "nothing", actual_team: null })}
                      className="px-2.5 py-1 rounded-lg text-sm bg-slate-100 dark:bg-slate-800 hover:ring-2 hover:ring-brand/40">לא היה כלום</button>
                    {["red", "blue"].map(tm => (
                      <div key={tm} className="flex flex-wrap items-center gap-1.5">
                        <span className="flex items-center gap-1 text-xs font-semibold w-24 shrink-0"><span className={`w-2.5 h-2.5 rounded-full ${TEAM_DOT[tm]}`} />{teams[tm]}</span>
                        {Object.keys(EVENT_TYPES).map(a => (
                          <button key={a} onClick={() => verdict(cur, "wrong", { actual_type: a, actual_team: tm })}
                            className="px-2 py-1 rounded-lg text-xs bg-slate-100 dark:bg-slate-800 hover:ring-2 hover:ring-brand/40">{phrase(a, tm, teams)}</button>
                        ))}
                      </div>
                    ))}
                    <button onClick={() => setWrongFor(null)} className="text-xs underline text-slate-500">ביטול</button>
                  </div>
                ) : (
                  <div className="flex gap-2">
                    <button onClick={() => verdict(cur, "correct")} className="flex-1 py-2 rounded-xl font-semibold bg-emerald-600 text-white inline-flex items-center justify-center gap-1.5"><Check className="w-4 h-4" /> נכון (V)</button>
                    <button onClick={() => verdict(cur, "wrong")} className="flex-1 py-2 rounded-xl font-semibold bg-red-600 text-white inline-flex items-center justify-center gap-1.5"><X className="w-4 h-4" /> שגוי (X)</button>
                    <button onClick={() => verdict(cur, "unsure")} className="py-2 px-3 rounded-xl font-semibold bg-slate-200 dark:bg-slate-700 inline-flex items-center gap-1.5"><HelpCircle className="w-4 h-4" /> לא בטוח (U)</button>
                  </div>
                )
              ) : (
                <button onClick={async () => { await deleteMatchEvent(cur.id).catch(e => setErr(e.message)); setEvents(p => p.filter(x => x.id !== cur.id)); setSel(null) }}
                  className="text-xs inline-flex items-center gap-1 text-red-600"><Trash2 className="w-3.5 h-3.5" /> מחיקת האירוע שהוספתי</button>
              )}
            </div>
          ) : (
            <div className="card p-3 text-sm text-slate-500">בחרו אירוע מהרשימה — הסרטון יקפוץ לרגע שלו ויתנגן כמה שניות סביבו.</div>
          )}
          <div className="card p-3 space-y-2">
            {adding ? (
              <>
                <div className="text-sm">אירוע שהמנוע פספס בדקה <b dir="ltr">{mmss(adding.t)}</b> — מה היה ולמי?</div>
                {["red", "blue"].map(tm => (
                  <div key={tm} className="flex flex-wrap items-center gap-1.5">
                    <span className="flex items-center gap-1 text-sm w-28 shrink-0"><span className={`w-2.5 h-2.5 rounded-full ${TEAM_DOT[tm]}`} />{teams[tm]}</span>
                    {Object.keys(EVENT_TYPES).map(tp => (
                      <button key={tp} onClick={() => addMiss(tp, tm)} className="px-2 py-1 rounded-lg text-xs bg-slate-100 dark:bg-slate-800 hover:ring-2 hover:ring-brand/40">{phrase(tp, tm, teams)}</button>
                    ))}
                  </div>
                ))}
                <button onClick={() => setAdding(null)} className="text-xs underline text-slate-500">ביטול</button>
              </>
            ) : (
              <button disabled={!ready} onClick={() => { const p = player.current; p?.pauseVideo(); setAdding({ t: Math.round((p?.getCurrentTime?.() || 0) * 10) / 10 }) }}
                className="text-sm inline-flex items-center gap-1.5 text-brand font-semibold disabled:opacity-40"><Plus className="w-4 h-4" /> המנוע פספס משהו כאן? הוסיפו אותו (לפי הרגע בסרטון)</button>
            )}
          </div>
        </div>

        <div className="card p-3 space-y-2">
          <div className="flex flex-wrap gap-1.5 text-xs">
            {["all", ...Object.keys(EVENT_TYPES).filter(t => events.some(e => e.type === t))].map(t => (
              <button key={t} onClick={() => setTypeF(t)} className={`px-2 py-1 rounded-lg ${typeF === t ? "bg-brand text-white" : "bg-slate-100 dark:bg-slate-800"}`}>
                {t === "all" ? "הכל" : EVENT_TYPES[t].label} <span className="opacity-70">{events.filter(e => t === "all" || e.type === t).length}</span>
              </button>
            ))}
          </div>
          <div className="flex items-center gap-2 text-xs">
            <select value={teamF} onChange={e => setTeamF(e.target.value)} className="filter-input py-1">
              <option value="all">שתי הקבוצות</option><option value="red">{teams.red}</option><option value="blue">{teams.blue}</option>
            </select>
            <label className="flex items-center gap-1"><input type="checkbox" checked={onlyOpen} onChange={e => setOnlyOpen(e.target.checked)} /> רק מה שלא נבדק</label>
          </div>
          <div ref={listRef} className="max-h-[32rem] overflow-y-auto -mx-1">
            {shown.map(e => (
              <button key={e.id} data-id={e.id} onClick={() => select(e)}
                className={`w-full text-start px-2 py-1.5 rounded-lg flex items-center gap-2 text-sm ${e.id === sel ? "bg-brand/10" : "hover:bg-slate-50 dark:hover:bg-slate-800/60"}`}>
                <span className="tabular-nums text-xs text-slate-400 w-10 shrink-0" dir="ltr">{mmss(e.t)}</span>
                {e.team && <span className={`w-2 h-2 rounded-full shrink-0 ${TEAM_DOT[e.team]}`} />}
                <span className="truncate">{phrase(e.type, e.team, teams)}{e.data?.outcome ? ` · ${OUTCOME[e.data.outcome] || e.data.outcome}` : ""}</span>
                {e.source === "human" && <Plus className="w-3 h-3 text-slate-400 shrink-0" />}
                {e.verdict && <span className={`ms-auto text-[10px] font-bold px-1.5 rounded-full ${VERDICT[e.verdict].cls}`}>{VERDICT[e.verdict].label}</span>}
              </button>
            ))}
            {shown.length === 0 && <div className="text-sm text-slate-500 p-3 text-center">אין אירועים בסינון הזה.</div>}
          </div>
          <div className="flex justify-between">
            <button className={btn} onClick={() => { const i = shown.findIndex(e => e.id === sel); select(shown[Math.max(0, i - 1)]) }} aria-label="האירוע הקודם"><ChevronRight className="w-5 h-5" /></button>
            <span className="text-[11px] text-slate-400 self-center">V נכון · X שגוי · U לא בטוח · R שוב · חיצים</span>
            <button className={btn} onClick={() => { const i = shown.findIndex(e => e.id === sel); select(shown[Math.min(shown.length - 1, i + 1)]) }} aria-label="האירוע הבא"><ChevronLeft className="w-5 h-5" /></button>
          </div>
        </div>
      </div>
    </div>
  )
}

// Per type: how many the engine found, how many were reviewed, the share that was right, and the misses added.
function Accuracy({ events }) {
  const rows = Object.keys(EVENT_TYPES).map(t => {
    const eng = events.filter(e => e.source === "engine" && e.type === t)
    const rev = eng.filter(e => e.verdict === "correct" || e.verdict === "wrong")
    const ok = rev.filter(e => e.verdict === "correct").length
    const missed = events.filter(e => e.source === "human" && e.type === t).length
      + events.filter(e => e.source === "engine" && e.verdict === "wrong" && e.actual_type === t).length
    return { t, n: eng.length, rev: rev.length, prec: rev.length ? Math.round((100 * ok) / rev.length) : null, missed }
  }).filter(r => r.n || r.missed)
  if (!rows.length) return null
  return (
    <div className="card p-3 overflow-x-auto">
      <table className="w-full text-sm">
        <thead><tr className="text-xs text-slate-500 text-start">
          <th className="text-start font-medium py-1">סוג</th><th className="font-medium">המנוע מצא</th><th className="font-medium">נבדקו</th>
          <th className="font-medium">מתוכם נכונים</th><th className="font-medium">פספוסים שנוספו</th>
        </tr></thead>
        <tbody>
          {rows.map(r => (
            <tr key={r.t} className="border-t border-slate-100 dark:border-slate-800 text-center tabular-nums">
              <td className="text-start py-1">{EVENT_TYPES[r.t].label}</td><td>{r.n}</td><td>{r.rev}</td>
              <td className={r.prec == null ? "text-slate-400" : r.prec >= 80 ? "text-emerald-600 font-semibold" : r.prec >= 50 ? "text-amber-600 font-semibold" : "text-red-600 font-semibold"}>
                {r.prec == null ? "—" : `${r.prec}%`}</td>
              <td>{r.missed || "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
