import { useCallback, useEffect, useMemo, useState } from "react"
import { FlaskConical, Plus, Loader2, ArrowRight, RotateCcw, Check, X, ChevronDown, Cpu, TrendingUp, TrendingDown, Minus } from "lucide-react"
import { useAuth } from "@/lib/AuthContext"
import Standings, { refreshStandings } from "./Standings"
import { stageById } from "@/lib/pipelineMap"
import { getExperiments, getExperiment, createExperiment, cancelExperiment, decideExperiment, getProfilesByIds, relTime } from "@/lib/devs"
import { EXPERIMENT_STAGES, STAGE_GROUPS, STAGE_PARAMS, paramDefaults, paramByKey, changedParams, EXP_STATUS, EVENT_TYPE_LABELS } from "@/lib/experimentSpec"

// ניסויים: change a pipeline setting → kookisnooki runs it on the benchmark → numbers next to today's
// default. Data: supabase/dev-experiments.sql; worker: video-analysis/devlab/worker.py.

const live = (e) => e.status === "queued" || e.status === "running"

export default function Experiments({ expId, isNew, newStage, onOpen, onNew, onBack, onStage }) {
  if (isNew) return <NewExperiment initialStage={EXPERIMENT_STAGES[newStage] ? newStage : "events"} onBack={onBack} onCreated={onOpen} />
  if (expId) return <ExperimentView id={expId} onBack={onBack} onNew={onNew} onStage={onStage} />
  return <ExperimentList onOpen={onOpen} onNew={onNew} />
}

// ── list ──────────────────────────────────────────────────────────────────────────────────────
function ExperimentList({ onOpen, onNew }) {
  const [list, setList] = useState(null)
  const [names, setNames] = useState({})
  const [error, setError] = useState(null)

  const load = useCallback(() => getExperiments()
    .then(async rows => { setList(rows); setNames(await getProfilesByIds(rows.map(r => r.created_by))) })
    .catch(e => setError(e.message)), [])
  useEffect(() => { load() }, [load])
  useEffect(() => {
    if (!list?.some(live)) return
    const t = setInterval(load, 8000)
    return () => clearInterval(t)
  }, [list, load])

  return (
    <div className="space-y-4">
      <HowItWorks onNew={onNew} />
      {error && <div className="card p-3 text-sm text-red-600 dark:text-red-400">{error}</div>}
      {list === null ? (
        <div className="card p-6 flex justify-center"><Loader2 className="w-5 h-5 animate-spin text-slate-400" /></div>
      ) : list.length === 0 ? (
        <div className="card p-8 text-center text-sm text-slate-500">עוד אין ניסויים. תהיו הראשונים.</div>
      ) : (
        <div className="card divide-y divide-slate-100 dark:divide-slate-800">
          {list.map(e => (
            <button key={e.id} onClick={() => onOpen(e.id)} className="w-full text-start p-3 sm:p-4 flex items-center gap-3 hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5 flex-wrap">
                  <StatusChip status={e.status} />
                  {e.decision && <DecisionChip decision={e.decision} />}
                  <span className="font-bold text-sm text-slate-900 dark:text-white truncate">{e.title}</span>
                </div>
                <div className="text-xs text-slate-500 dark:text-slate-400 mt-1 truncate">
                  {names[e.created_by]?.display_name || "מפתח/ת"} · {EXPERIMENT_STAGES[e.stage]?.label} · {relTime(e.created_at)}
                  {Object.keys(e.params || {}).length > 0 && <> · {Object.keys(e.params).map(k => paramByKey(e.stage, k)?.label || k).join(", ")}</>}
                </div>
              </div>
              {e.status === "done" && (e.stage === "ball"
                ? <Delta value={e.metrics?.found_pct} base={e.baseline?.found_pct} label="נמצאו" pct compact />
                : <Delta value={e.metrics?.f1} base={e.baseline?.f1} label="F1" compact />)}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

function HowItWorks({ onNew }) {
  return (
    <div className="card p-4 space-y-3">
      <div className="flex items-start gap-3">
        <span className="w-10 h-10 rounded-xl bg-brand/10 text-brand flex items-center justify-center shrink-0"><FlaskConical className="w-5 h-5" /></span>
        <div className="min-w-0 flex-1">
          <h2 className="font-bold text-slate-900 dark:text-white">ניסויים על המערכת האמיתית</h2>
          <p className="text-sm text-slate-600 dark:text-slate-400 mt-0.5">
            משנים הגדרה בשלב מהמפה, kookisnooki מריץ אותה על אותו מבחן קבוע, ורואים מיד אם זה טוב או גרוע מהמצב היום.
            ניסוי שמשפר — מנהל הליגה מאשר, והוא הופך לברירת המחדל.
          </p>
        </div>
      </div>
      <ol className="grid sm:grid-cols-3 gap-2 text-sm">
        {["בוחרים מה לשנות ולמה (השערה)", "kookisnooki מריץ — בערך דקה", "משווים למצב היום, לפי סוג אירוע"].map((s, i) => (
          <li key={i} className="rounded-lg bg-slate-50 dark:bg-slate-800/60 p-2.5 flex gap-2 items-start">
            <span className="w-5 h-5 rounded-full bg-brand text-white text-xs font-bold flex items-center justify-center shrink-0">{i + 1}</span>
            <span className="text-slate-700 dark:text-slate-300">{s}</span>
          </li>
        ))}
      </ol>
      <button onClick={onNew} className="btn-primary btn-sm gap-1.5"><Plus className="w-4 h-4" /> ניסוי חדש</button>
    </div>
  )
}

// ── new ───────────────────────────────────────────────────────────────────────────────────────
function NewExperiment({ initialStage, onBack, onCreated }) {
  const [stage, setStage] = useState(initialStage)
  const [title, setTitle] = useState("")
  const [hypothesis, setHypothesis] = useState("")
  const [values, setValues] = useState(() => paramDefaults(initialStage))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const pickStage = (k) => { setStage(k); setValues(paramDefaults(k)) }
  const changed = changedParams(stage, values)
  const nChanged = Object.keys(changed).length
  const st = EXPERIMENT_STAGES[stage]

  const submit = async (e) => {
    e.preventDefault()
    if (!title.trim()) { setError("תנו לניסוי שם קצר"); return }
    setBusy(true); setError(null)
    try { const row = await createExperiment({ stage, title, hypothesis, params: changed }); onCreated(row.id) }
    catch (err) { setError(err.message || "שגיאה"); setBusy(false) }
  }

  const G = STAGE_GROUPS[stage]
  const groups = Object.keys(G).map(g => [g, STAGE_PARAMS[stage].filter(p => p.group === g)]).filter(([, ps]) => ps.length)
  const pathV4 = values.ball_path === "v4"
  const setInvalid = STAGE_PARAMS[stage].some(p => p.kind === "set" && (values[p.key].length < p.min || values[p.key].length > p.max))
    || (values.engine_test && values.checker === "none")

  return (
    <form onSubmit={submit} className="space-y-4 max-w-3xl">
      <BackLink onBack={onBack} label="כל הניסויים" />
      <div className="card p-4 space-y-3">
        <div className="flex gap-1 p-1 rounded-xl bg-slate-100 dark:bg-slate-800 w-fit max-w-full overflow-x-auto" role="tablist" aria-label="על מה הניסוי">
          {Object.entries(EXPERIMENT_STAGES).map(([k, v]) => (
            <button key={k} type="button" role="tab" aria-selected={stage === k} onClick={() => pickStage(k)}
              className={`px-3 py-1.5 rounded-lg text-sm font-semibold whitespace-nowrap ${stage === k ? "bg-white dark:bg-slate-900 text-brand shadow-sm" : "text-slate-600 dark:text-slate-300"}`}>{v.label}</button>
          ))}
        </div>
        <h2 className="font-black text-lg text-slate-900 dark:text-white">ניסוי חדש · {st.label}</h2>
        <p className="text-sm text-slate-600 dark:text-slate-400">{st.desc}</p>
        <p className="text-xs text-slate-500 dark:text-slate-400"><b>המבחן:</b> {st.bench} · <b>זמן ריצה:</b> {st.runtime}</p>
        {st.caveat && <p className="text-xs rounded-lg bg-amber-50 dark:bg-amber-900/20 text-amber-900 dark:text-amber-200 p-2.5">{st.caveat}</p>}
      </div>

      <Standings data={stageById(st.mapStage)?.standings} compact />

      <div className="card p-4 space-y-3">
        <label className="block space-y-1">
          <span className="text-sm font-semibold text-slate-700 dark:text-slate-300">שם הניסוי</span>
          <input value={title} onChange={e => setTitle(e.target.value)} maxLength={120} className="filter-input w-full text-sm" placeholder={stage === "ball" ? "למשל: r9 במקום r7 עם בודק v10" : "למשל: טווח שליטה רחב יותר בסקראמים"} />
        </label>
        <label className="block space-y-1">
          <span className="text-sm font-semibold text-slate-700 dark:text-slate-300">ההשערה — מה אתם מצפים שיקרה ולמה?</span>
          <textarea value={hypothesis} onChange={e => setHypothesis(e.target.value)} maxLength={2000} rows={3} className="filter-input w-full text-sm"
            placeholder={stage === "ball"
              ? "למשל: r9 אומן על כל 6 הקטעים המתויגים, אז הוא אמור למצוא יותר כדורים בפתיחה. v10 אומן איתו, אז הוא יפסול פחות כדורים אמיתיים."
              : "למשל: בסקראם הלהב רחוק מהכדור יותר מ-1.3 מ׳, אז חטיפות לא נספרות. הגדלה ל-1.6 תמצא יותר חטיפות, אולי על חשבון דיוק המסירות."} />
        </label>
      </div>

      {groups.map(([g, ps]) => (
        <fieldset key={g} className={`card p-4 space-y-3 ${g === "phys" && pathV4 ? "opacity-50" : ""}`}>
          <legend className="sr-only">{G[g].label}</legend>
          <div>
            <h3 className="font-bold text-slate-900 dark:text-white">{G[g].label}</h3>
            {G[g].desc && <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">{G[g].desc}</p>}
          </div>
          <div className="space-y-4">
            {ps.map(p => <ParamInput key={p.key} p={p} value={values[p.key]} onChange={v => setValues(s => ({ ...s, [p.key]: v }))} />)}
          </div>
        </fieldset>
      ))}

      <div className="card p-4 flex items-center gap-3 flex-wrap sticky bottom-3 shadow-lg">
        <span className="text-sm text-slate-600 dark:text-slate-300 flex-1 min-w-0">
          {nChanged ? <>שיניתם {nChanged} {nChanged === 1 ? "הגדרה" : "הגדרות"}</> : "לא שיניתם כלום — זה יריץ את ברירת המחדל"}
        </span>
        {values.engine_test && values.checker === "none" && <p className="w-full text-xs text-red-600 dark:text-red-400">בדיקת מנוע דורשת בודק — בחרו בודק או כבו את בדיקת המנוע.</p>}
        {nChanged > 0 && <button type="button" onClick={() => setValues(paramDefaults(stage))} className="btn-secondary btn-sm gap-1"><RotateCcw className="w-3.5 h-3.5" /> איפוס</button>}
        <button type="submit" disabled={busy || setInvalid} className="btn-primary btn-sm gap-1.5">
          {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Cpu className="w-4 h-4" />} הרצה על kookisnooki
        </button>
        {error && <p className="w-full text-sm text-red-600 dark:text-red-400">{error}</p>}
      </div>
    </form>
  )
}

function ParamInput({ p, value, onChange }) {
  const changed = Array.isArray(p.def) ? !(value.length === p.def.length && value.every(x => p.def.includes(x))) : value !== p.def
  const id = `exp-${p.key}`
  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-2 flex-wrap">
        <label htmlFor={id} className="text-sm font-semibold text-slate-800 dark:text-slate-200">{p.label}</label>
        {changed && (
          <button type="button" onClick={() => onChange(p.def)} className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-brand/10 text-brand inline-flex items-center gap-1">
            שונה · ברירת מחדל {fmt(p, p.def)} <RotateCcw className="w-2.5 h-2.5" />
          </button>
        )}
      </div>
      <p className="text-xs text-slate-500 dark:text-slate-400">{p.help}</p>
      {p.kind === "set" ? (
        <div className="space-y-1.5">
          {p.options.map(([v, l]) => {
            const on = value.includes(v)
            const full = !on && value.length >= p.max
            return (
              <label key={v} className={`flex items-start gap-2 text-sm cursor-pointer ${full ? "opacity-40" : ""}`}>
                <input type="checkbox" checked={on} disabled={full} className="w-4 h-4 mt-0.5 accent-brand shrink-0"
                  onChange={e => onChange(e.target.checked ? [...value, v] : value.filter(x => x !== v))} />
                <span><b dir="ltr">{v}</b> <span className="text-slate-500 dark:text-slate-400">— {l.split(" — ").slice(1).join(" — ") || l}</span></span>
              </label>
            )
          })}
          {value.length < p.min && <p className="text-xs text-red-600 dark:text-red-400">בחרו לפחות {p.min}</p>}
        </div>
      ) : p.kind === "bool" ? (
        <label className="inline-flex items-center gap-2 text-sm cursor-pointer">
          <input id={id} type="checkbox" checked={!!value} onChange={e => onChange(e.target.checked)} className="w-4 h-4 accent-brand" />
          {value ? "פעיל" : "כבוי"}
        </label>
      ) : p.kind === "enum" ? (
        <select id={id} value={value} onChange={e => onChange(p.options.find(([v]) => String(v) === e.target.value)?.[0] ?? e.target.value)} className="filter-input text-sm">
          {p.options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
      ) : (
        <div className="flex items-center gap-3">
          <input id={id} type="range" min={p.min} max={p.max} step={p.step} value={value}
            onChange={e => onChange(p.kind === "int" ? parseInt(e.target.value, 10) : round(parseFloat(e.target.value), p.step))}
            className="flex-1 accent-brand" />
          <span className="text-sm font-bold tabular-nums w-24 text-start text-slate-900 dark:text-white">{fmt(p, value)}</span>
        </div>
      )}
    </div>
  )
}

const round = (v, step) => { const d = String(step).split(".")[1]?.length || 0; return Number(v.toFixed(d)) }
const fmt = (p, v) => p.kind === "bool" ? (v ? "פעיל" : "כבוי") : p.kind === "set" ? (v || []).join(" + ") : p.kind === "enum" ? String(v) : `${v}${p.unit ? ` ${p.unit}` : ""}`

// ── one experiment ────────────────────────────────────────────────────────────────────────────
function ExperimentView({ id, onBack, onNew, onStage }) {
  const { user, isAdmin } = useAuth()
  const [exp, setExp] = useState(undefined)
  const [names, setNames] = useState({})
  const [error, setError] = useState(null)
  const [showLog, setShowLog] = useState(false)

  const load = useCallback(() => getExperiment(id).then(async e => {
    setExp(e)
    if (e) setNames(await getProfilesByIds([e.created_by, e.decided_by]))
  }).catch(err => setError(err.message)), [id])
  useEffect(() => { load() }, [load])
  useEffect(() => {
    if (!exp || !live(exp)) return
    const t = setInterval(load, 4000)
    return () => clearInterval(t)
  }, [exp, load])

  if (exp === undefined) return <div className="card p-6 flex justify-center"><Loader2 className="w-5 h-5 animate-spin text-slate-400" /></div>
  if (!exp) return <div className="space-y-3"><BackLink onBack={onBack} label="כל הניסויים" /><div className="card p-6 text-sm text-slate-500">הניסוי לא נמצא.</div></div>

  const st = EXPERIMENT_STAGES[exp.stage]
  const changed = Object.entries(exp.params || {})
  const mine = exp.created_by === user?.id

  return (
    <div className="space-y-4 max-w-4xl">
      <BackLink onBack={onBack} label="כל הניסויים" />
      {error && <div className="card p-3 text-sm text-red-600 dark:text-red-400">{error}</div>}

      <div className="card p-4 space-y-2">
        <div className="flex items-center gap-1.5 flex-wrap">
          <StatusChip status={exp.status} />
          {exp.decision && <DecisionChip decision={exp.decision} />}
          <button onClick={() => onStage(st?.mapStage)} className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300 hover:text-brand">{st?.label}</button>
        </div>
        <h2 className="font-black text-lg text-slate-900 dark:text-white">{exp.title}</h2>
        <p className="text-xs text-slate-500 dark:text-slate-400">
          {names[exp.created_by]?.display_name || "מפתח/ת"} · {relTime(exp.created_at)}{exp.worker && <> · רץ על {exp.worker.replace(/-devlab$/, "")}</>}
        </p>
        {exp.hypothesis && <p className="text-sm text-slate-700 dark:text-slate-300 whitespace-pre-wrap border-s-2 border-brand/40 ps-3">{exp.hypothesis}</p>}
        <div className="pt-1">
          <div className="text-xs font-bold text-slate-500 dark:text-slate-400 mb-1">מה שונה</div>
          {changed.length === 0 ? <p className="text-sm text-slate-500">כלום — ברירת המחדל של היום</p> : (
            <div className="flex flex-wrap gap-1.5">
              {changed.map(([k, v]) => {
                const p = paramByKey(exp.stage, k)
                return <span key={k} className="text-xs px-2 py-1 rounded-lg bg-brand/10 text-slate-800 dark:text-slate-200"><b>{p?.label || k}</b>: {p && (p.kind === "bool" || p.kind === "enum") ? <>{fmt(p, p.def)} ← {fmt(p, v)}</> : p?.kind === "set" ? <span dir="ltr">{fmt(p, p.def)} → {fmt(p, v)}</span> : <><span dir="ltr">{p ? p.def : "?"} → {String(v)}</span>{p?.unit && ` ${p.unit}`}</>}</span>
              })}
            </div>
          )}
        </div>
        {exp.status === "queued" && (mine || isAdmin) && (
          <button onClick={() => cancelExperiment(exp.id).then(load).catch(e => setError(e.message))} className="btn-secondary btn-sm gap-1"><X className="w-3.5 h-3.5" /> ביטול</button>
        )}
      </div>

      {live(exp) && (
        <div className="card p-4 flex items-center gap-3 text-sm text-slate-600 dark:text-slate-300">
          <Loader2 className="w-5 h-5 animate-spin text-brand shrink-0" />
          {exp.status === "queued" ? "מחכה בתור ל-kookisnooki… הדף יתעדכן לבד." : "kookisnooki מריץ את הניסוי עכשיו…"}
        </div>
      )}

      {exp.status === "error" && (
        <div className="card p-4 text-sm text-rose-700 dark:text-rose-300 space-y-1">
          <b>הניסוי נכשל.</b>
          {(exp.result?.errors || []).map((e, i) => <div key={i} dir="ltr" className="text-start">{e}</div>)}
        </div>
      )}

      {exp.status === "done" && exp.metrics && (exp.stage === "ball" ? <BallResults exp={exp} /> : <Results exp={exp} />)}
      {exp.status === "done" && exp.stage === "ball" && exp.result?.engine && (
        <Results exp={{ ...exp, metrics: exp.result.engine.metrics, baseline: exp.result.engine.baseline,
          result: { per_type: exp.result.engine.per_type, baseline_per_type: exp.result.engine.baseline_per_type } }}
          title="בדיקת מנוע מלאה — האם זה מתורגם לאירועים?"
          sub={`הכדור זוהה מחדש ב-5 הקטעים שנסקרו עם ${(exp.params?.detectors || ["black", "black_r3", "r7"]).join(" + ")} · בודק ${exp.params?.checker || "v7"}, ומנוע האירועים של היום רץ עליו מול ${exp.result.engine.metrics.truth_events} אירועים שאדם סימן. ההשוואה: אותו מנוע עם הגלאים של היום.${exp.result.engine.reused ? " (הזיהוי מחדש היה שמור — סט המודלים הזה כבר נבדק.)" : ""}`} />
      )}
      {exp.status === "running" && exp.stage === "ball" && exp.params?.engine_test && (
        <p className="text-xs text-slate-500 dark:text-slate-400">בדיקת מנוע מלאה לסט מודלים חדש לוקחת כשעה. אפשר לסגור את הדף — התוצאה תחכה כאן.</p>
      )}

      {exp.status === "done" && <Decision exp={exp} isAdmin={isAdmin} names={names} onChanged={load} />}

      {exp.log && (
        <div className="card p-4 space-y-2">
          <button onClick={() => setShowLog(s => !s)} className="text-sm font-semibold text-slate-600 dark:text-slate-300 inline-flex items-center gap-1">
            <ChevronDown className={`w-4 h-4 transition-transform ${showLog ? "rotate-180" : ""}`} /> לוג הריצה
          </button>
          {showLog && <pre dir="ltr" className="text-[11px] leading-relaxed bg-slate-900 text-slate-100 rounded-lg p-3 overflow-x-auto whitespace-pre-wrap">{exp.log}</pre>}
        </div>
      )}

      <button onClick={onNew} className="btn-secondary btn-sm gap-1.5"><Plus className="w-4 h-4" /> ניסוי חדש</button>
    </div>
  )
}

function Results({ exp, title = "התוצאה מול המצב היום", sub }) {
  const m = exp.metrics, b = exp.baseline || {}
  const rows = useMemo(() => {
    const base = Object.fromEntries((exp.result?.baseline_per_type || []).map(r => [r.type, r]))
    return (exp.result?.per_type || []).map(r => ({ ...r, base: base[r.type] }))
  }, [exp])
  return (
    <div className="card p-4 space-y-4">
      <div>
        <h3 className="font-bold text-slate-900 dark:text-white">{title}</h3>
        <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
          {sub || <>{exp.result?.bench?.span} · {m.truth_events} אירועים אמיתיים שאדם סימן. ברירת המחדל נמדדה באותה ריצה, מול אותה אמת.</>}
        </p>
      </div>
      <div className="grid grid-cols-3 gap-2">
        <Delta value={m.f1} base={b.f1} label="F1 — הציון המשולב" />
        <Delta value={m.precision} base={b.precision} label="נכונים — מהאירועים שהמנוע מצא" pct />
        <Delta value={m.recall} base={b.recall} label="נמצאו — מהאירועים האמיתיים" pct />
      </div>
      <div className="grid grid-cols-3 gap-2">
        <Delta value={m.won_f1} base={b.won_f1} label="F1 כשחטיפה+יירוט = זכייה" small />
        <Delta value={m.ball_seen_pct} base={b.ball_seen_pct} label="% זמן עם כדור" small raw />
        <Delta value={m.controlled_pct} base={b.controlled_pct} label="% זמן עם שליטה" small raw />
      </div>
      <div className="overflow-x-auto -mx-4 px-4">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-xs text-slate-500 dark:text-slate-400 border-b border-slate-100 dark:border-slate-800">
              <th className="text-start py-2 font-semibold">סוג</th>
              <th className="text-start py-2 font-semibold">נכונים <span className="font-normal">(מתוך מה שהמנוע מצא)</span></th>
              <th className="text-start py-2 font-semibold">נמצאו <span className="font-normal">(מתוך האמת)</span></th>
            </tr>
          </thead>
          <tbody>
            {rows.map(r => (
              <tr key={r.type} className="border-b border-slate-50 dark:border-slate-800/60">
                <td className="py-2 font-semibold text-slate-800 dark:text-slate-200">{EVENT_TYPE_LABELS[r.type] || r.type}</td>
                <td className="py-2 tabular-nums"><Frac a={r.right} b={r.engine} vs={r.base && r.base.right / Math.max(1, r.base.engine)} />
                  <div className="text-[11px] text-slate-400">היום <Frac a={r.base?.right} b={r.base?.engine} /></div></td>
                <td className="py-2 tabular-nums"><Frac a={r.found} b={r.truth} vs={r.base && r.base.found / Math.max(1, r.base.truth)} />
                  <div className="text-[11px] text-slate-400">היום <Frac a={r.base?.found} b={r.base?.truth} /></div></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-slate-500 dark:text-slate-400">
        שימו לב: סוגים כמו עבירה או כדור יצא מופיעים באמת, אבל המנוע עוד לא מזהה אותם — הם מורידים את ה"נמצאו" לכולם באותה מידה.
        הפרש קטן מ-0.01 ב-F1 הוא רעש.
      </p>
    </div>
  )
}

function BallResults({ exp }) {
  const m = exp.metrics, b = exp.baseline || {}
  const base = Object.fromEntries((exp.result?.baseline_per_type || []).map(r => [r.block, r]))
  const label = (blk) => { const t = /_(\d{2})(\d{2})$/.exec(blk); return t ? `${t[1]}:${t[2]}` : blk }
  return (
    <div className="card p-4 space-y-4">
      <div>
        <h3 className="font-bold text-slate-900 dark:text-white">התוצאה מול המצב היום</h3>
        <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
          {m.ball} פריימים עם כדור ו-{m.none} בלי, שאדם תייג ושאף גלאי לא אומן עליהם. ברירת המחדל נמדדה על אותם פריימים.
        </p>
      </div>
      <div className="grid grid-cols-3 gap-2">
        <Delta value={m.found_pct} base={b.found_pct} label={`נמצאו — ${m.found}/${m.ball} כדורים`} pct />
        <Delta value={m.false_pct} base={b.false_pct} label={`כדור שגוי בפריים ריק — ${m.false}/${m.none}`} pct lowerBetter />
        <Delta value={m.wrong_pct} base={b.wrong_pct} label={`כדור במקום הלא נכון — ${m.wrong}/${m.ball}`} pct lowerBetter />
      </div>
      <div className="overflow-x-auto -mx-4 px-4">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-xs text-slate-500 dark:text-slate-400 border-b border-slate-100 dark:border-slate-800">
              <th className="text-start py-2 font-semibold">קטע</th>
              <th className="text-start py-2 font-semibold">נמצאו</th>
              <th className="text-start py-2 font-semibold">שגוי בפריים ריק</th>
            </tr>
          </thead>
          <tbody>
            {(exp.result?.per_type || []).map(r => {
              const o = base[r.block]
              return (
                <tr key={r.block} className="border-b border-slate-50 dark:border-slate-800/60">
                  <td className="py-2 font-semibold text-slate-800 dark:text-slate-200" dir="ltr">{label(r.block)}</td>
                  <td className="py-2 tabular-nums"><Frac a={r.found} b={r.ball} vs={o && o.found / Math.max(1, o.ball)} />
                    <div className="text-[11px] text-slate-400">היום <Frac a={o?.found} b={o?.ball} /></div></td>
                  <td className="py-2 tabular-nums"><Frac a={r.false} b={r.none} vs={o && o.false / Math.max(1, o.none)} lowerBetter />
                    <div className="text-[11px] text-slate-400">היום <Frac a={o?.false} b={o?.none} /></div></td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      <p className="text-xs rounded-lg bg-amber-50 dark:bg-amber-900/20 text-amber-900 dark:text-amber-200 p-2.5">
        {EXPERIMENT_STAGES.ball.caveat}
      </p>
    </div>
  )
}

function Frac({ a, b, vs, lowerBetter }) {
  if (a == null || b == null) return <span>—</span>
  const v = b ? a / b : 0
  const up = lowerBetter ? v < vs - 0.005 : v > vs + 0.005, down = lowerBetter ? v > vs + 0.005 : v < vs - 0.005
  const cls = vs == null || !b ? "" : up ? "text-emerald-600 dark:text-emerald-400 font-bold" : down ? "text-rose-600 dark:text-rose-400 font-bold" : ""
  return <span className={cls} dir="ltr">{a}/{b}</span>
}

function Delta({ value, base, label, pct, raw, small, compact, lowerBetter }) {
  if (value == null) return null
  const d = base == null ? null : value - base
  const f = (x) => raw ? `${Math.round(x * 10) / 10}%` : pct ? `${Math.round(x * 100)}%` : x.toFixed(3)
  const fd = (x) => raw ? `${x > 0 ? "+" : ""}${Math.round(x * 10) / 10}` : pct ? `${x > 0 ? "+" : ""}${Math.round(x * 100)}` : `${x > 0 ? "+" : ""}${x.toFixed(3)}`
  const tol = raw ? 0.5 : 0.005
  const tone = d == null || Math.abs(d) < tol ? "neutral" : (d > 0) !== !!lowerBetter ? "up" : "down"
  const Icon = tone === "neutral" ? Minus : d > 0 ? TrendingUp : TrendingDown
  const toneCls = { up: "text-emerald-600 dark:text-emerald-400", down: "text-rose-600 dark:text-rose-400", neutral: "text-slate-400" }[tone]
  if (compact) return (
    <span className={`shrink-0 text-xs font-bold inline-flex items-center gap-1 ${toneCls}`} dir="ltr">
      <Icon className="w-3.5 h-3.5" />{label} {f(value)}{d != null && ` (${fd(d)})`}
    </span>
  )
  return (
    <div className="rounded-lg bg-slate-50 dark:bg-slate-800/60 p-2.5 min-w-0">
      <div className={`font-black ${small ? "text-base" : "text-xl"} text-slate-900 dark:text-white tabular-nums`} dir="ltr">{f(value)}</div>
      {d != null && <div className={`text-xs font-bold inline-flex items-center gap-1 ${toneCls}`} dir="ltr"><Icon className="w-3.5 h-3.5" />{fd(d)}</div>}
      {d != null && <div className="text-[11px] text-slate-400">היום <span dir="ltr">{f(base)}</span></div>}
      <div className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">{label}</div>
    </div>
  )
}

function Decision({ exp, isAdmin, names, onChanged }) {
  const [note, setNote] = useState(exp.decision_note || "")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const decide = async (d) => {
    setBusy(true); setError(null)
    try { await decideExperiment(exp.id, d, note); refreshStandings(); await onChanged() } catch (e) { setError(e.message) } finally { setBusy(false) }
  }
  if (!isAdmin && !exp.decision) return (
    <div className="card p-4 text-sm text-slate-500 dark:text-slate-400">מחכה להחלטה של מנהל הליגה: להפוך לברירת מחדל או לא.</div>
  )
  return (
    <div className="card p-4 space-y-2">
      <h3 className="font-bold text-slate-900 dark:text-white">החלטה</h3>
      {exp.decision && (
        <p className="text-sm text-slate-700 dark:text-slate-300">
          <DecisionChip decision={exp.decision} /> {names[exp.decided_by]?.display_name || "מנהל"} · {relTime(exp.decided_at)}
          {exp.decision_note && <span className="block mt-1 whitespace-pre-wrap">{exp.decision_note}</span>}
        </p>
      )}
      {isAdmin && (
        <>
          <textarea value={note} onChange={e => setNote(e.target.value)} rows={2} maxLength={2000} className="filter-input w-full text-sm" placeholder="הערה (למה כן / למה לא)" />
          <div className="flex gap-2 flex-wrap">
            <button disabled={busy} onClick={() => decide("promoted")} className="btn-primary btn-sm gap-1"><Check className="w-3.5 h-3.5" /> להפוך לברירת מחדל</button>
            <button disabled={busy} onClick={() => decide("rejected")} className="btn-secondary btn-sm gap-1"><X className="w-3.5 h-3.5" /> לא נכנס</button>
            {exp.decision && <button disabled={busy} onClick={() => decide(null)} className="btn-secondary btn-sm">ביטול החלטה</button>}
          </div>
          <p className="text-xs text-slate-500 dark:text-slate-400">"להפוך לברירת מחדל" מסמן את הניסוי. שינוי הקוד עצמו ב-video-analysis נעשה אחרי זה, ידנית.</p>
        </>
      )}
      {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
    </div>
  )
}

function StatusChip({ status }) {
  const s = EXP_STATUS[status] || EXP_STATUS.queued
  return <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full inline-flex items-center gap-1 ${s.cls}`}>
    {status === "running" && <Loader2 className="w-3 h-3 animate-spin" />}{s.label}
  </span>
}

function DecisionChip({ decision }) {
  return decision === "promoted"
    ? <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-brand text-white">נבחר לברירת מחדל</span>
    : <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-slate-200 text-slate-600 dark:bg-slate-700 dark:text-slate-300">לא נכנס</span>
}

function BackLink({ onBack, label }) {
  return <button onClick={onBack} className="text-sm font-semibold text-slate-500 hover:text-brand inline-flex items-center gap-1"><ArrowRight className="w-4 h-4" /> {label}</button>
}
