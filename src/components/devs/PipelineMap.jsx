import { useEffect, useRef } from "react"
import { ChevronDown, Check, X, Cpu, FileCode2, ArrowLeft, Lightbulb, AlertTriangle, Compass, Gauge, Workflow, History, HelpCircle, Lock, Mountain } from "lucide-react"
import { LANES, STAGES, STAGE_STATUS, RUNS_ON, stageById, stageOutputs } from "@/lib/pipelineMap"
import { topicById } from "@/lib/devTopics"
import { STORIES } from "@/lib/stageStories"

// מפת המערכת: the video-AI pipeline as lanes of stages. Picking a stage highlights what feeds it
// and what it feeds, and opens its sheet: method, measured numbers, experiments (kept or not),
// weak spots, files. Content: src/lib/pipelineMap.js.

export default function PipelineMap({ stageId, onPick, onTopic }) {
  const stage = stageId ? stageById(stageId) : null
  const detailRef = useRef(null)

  // On phones the sheet sits above the map — bring it into view when a stage is picked.
  useEffect(() => {
    if (stage && detailRef.current && window.innerWidth < 1024) detailRef.current.scrollIntoView({ behavior: "smooth", block: "start" })
  }, [stage])

  const feeds = new Set(stage ? stage.from : [])
  const fedBy = new Set(stage ? stageOutputs(stage.id).map(s => s.id) : [])

  return (
    <div className="space-y-4">
      <Intro />
      <div className="grid lg:grid-cols-[minmax(0,1fr)_400px] gap-4 items-start">
        <div className="space-y-1 order-2 lg:order-1 min-w-0">
          {LANES.map((lane, i) => (
            <div key={lane.id}>
              {i > 0 && lane.id !== "support" && <div className="flex justify-center py-1 text-slate-300 dark:text-slate-600"><ChevronDown className="w-5 h-5" /></div>}
              {lane.id === "support" && <div className="border-t border-dashed border-slate-200 dark:border-slate-700 my-4" />}
              <Lane lane={lane} selected={stage?.id} feeds={feeds} fedBy={fedBy} onPick={onPick} />
            </div>
          ))}
        </div>
        <div ref={detailRef} className="order-1 lg:order-2 lg:sticky lg:top-20 lg:max-h-[calc(100vh-6rem)] lg:overflow-y-auto scroll-mt-20 rounded-xl">
          {stage
            ? <StageSheet stage={stage} onPick={onPick} onTopic={onTopic} />
            : <div className="card p-5 text-sm text-slate-500 dark:text-slate-400 hidden lg:block">בחרו שלב במפה כדי לראות איך הוא עובד, מה המספרים שלו היום ומה כבר ניסינו.</div>}
        </div>
      </div>
    </div>
  )
}

function Intro() {
  return (
    <div className="card p-4 space-y-3">
      <div className="flex items-start gap-3">
        <span className="w-10 h-10 rounded-xl bg-brand/10 text-brand flex items-center justify-center shrink-0"><Workflow className="w-5 h-5" /></span>
        <div className="min-w-0">
          <h2 className="font-bold text-slate-900 dark:text-white">איך ה-AI מבין משחק</h2>
          <p className="text-sm text-slate-600 dark:text-slate-400 mt-0.5">
            כל שלב שהמחשב עובר על סרטון משחק — מהפריים הגולמי ועד סטטיסטיקה, תקצירים ושחזור. השיטות האמיתיות, המספרים כפי שנמדדו
            מול סקירה אנושית, ומה ניסינו ולא עבד.
          </p>
        </div>
      </div>
      <div className="rounded-lg bg-amber-50 dark:bg-amber-900/20 border border-amber-200/70 dark:border-amber-800/50 p-3 text-sm text-amber-900 dark:text-amber-200 flex gap-2">
        <Lightbulb className="w-4 h-4 shrink-0 mt-0.5" />
        <span>
          <b>השיעור הכי חשוב עד היום:</b> שיפור בשלב אחד לא תמיד משפר את התוצאה הסופית. גלאי כדור שניצח בבדיקה שלו הוריד את דיוק
          האירועים, 5 פעמים ברצף. לכן כל שינוי נמדד בסוף השרשרת — מול אירועים שאדם סקר.
        </span>
      </div>
      <div className="flex flex-wrap gap-x-4 gap-y-1.5 text-xs text-slate-500 dark:text-slate-400">
        {Object.values(STAGE_STATUS).map(s => (
          <span key={s.label} className="inline-flex items-center gap-1.5"><span className={`w-2 h-2 rounded-full ${s.dot}`} />{s.label}</span>
        ))}
      </div>
    </div>
  )
}

function Lane({ lane, selected, feeds, fedBy, onPick }) {
  const stages = STAGES.filter(s => s.lane === lane.id)
  return (
    <section>
      <div className="flex items-baseline gap-2 mb-2 px-1">
        <h3 className="text-sm font-black text-slate-900 dark:text-white">{lane.label}</h3>
        <span className="text-xs text-slate-500 dark:text-slate-400 truncate">{lane.desc}</span>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
        {stages.map(s => {
          const st = STAGE_STATUS[s.status]
          const role = s.id === selected ? "self" : feeds.has(s.id) ? "in" : fedBy.has(s.id) ? "out" : selected ? "dim" : ""
          const ring = {
            self: "ring-2 ring-brand border-brand",
            in: "ring-2 ring-sky-400/70 border-sky-300 dark:border-sky-700",
            out: "ring-2 ring-emerald-400/70 border-emerald-300 dark:border-emerald-700",
            dim: "opacity-50",
          }[role] || ""
          return (
            <button key={s.id} onClick={() => onPick(s.id === selected ? null : s.id)} aria-pressed={s.id === selected}
              className={`card-hover p-3 text-start flex flex-col gap-1 min-w-0 transition-opacity outline-none focus-visible:ring-2 focus-visible:ring-brand ${ring}`}>
              <span className="flex items-center gap-1.5 min-w-0">
                <span className={`w-2 h-2 rounded-full shrink-0 ${st.dot}`} title={st.label} />
                <span className="font-bold text-sm text-slate-900 dark:text-white truncate">{s.title}</span>
              </span>
              <span className="text-xs text-slate-500 dark:text-slate-400 line-clamp-2">{s.short}</span>
              {role === "in" && <span className="text-[10px] font-bold text-sky-600 dark:text-sky-400">מזין את השלב שנבחר</span>}
              {role === "out" && <span className="text-[10px] font-bold text-emerald-600 dark:text-emerald-400">מקבל ממנו</span>}
            </button>
          )
        })}
      </div>
    </section>
  )
}

function StageSheet({ stage, onPick, onTopic }) {
  const st = STAGE_STATUS[stage.status]
  const outs = stageOutputs(stage.id)
  const topic = stage.topic ? topicById(stage.topic) : null
  const story = STORIES[stage.id]
  return (
    <article className="card p-4 space-y-4">
      <header className="space-y-1.5">
        <div className="flex items-start gap-2">
          <h2 className="font-black text-lg text-slate-900 dark:text-white leading-tight flex-1 min-w-0">{stage.title}</h2>
          <button onClick={() => onPick(null)} aria-label="סגירה" className="p-1 -m-1 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200"><X className="w-4 h-4" /></button>
        </div>
        <div className="flex flex-wrap gap-1.5">
          <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${st.cls}`}>{st.label}</span>
          {stage.runsOn.map(r => (
            <span key={r} className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300 inline-flex items-center gap-1">
              <Cpu className="w-3 h-3" />{RUNS_ON[r]}
            </span>
          ))}
        </div>
        <p className="text-sm text-slate-600 dark:text-slate-400">{stage.short}</p>
        {stage.current && <p className="text-xs text-slate-500 dark:text-slate-400"><b className="text-slate-700 dark:text-slate-300">רץ היום:</b> {stage.current}</p>}
      </header>

      {story?.problem && (
        <Section icon={Mountain} title="למה זה קשה אצלנו">
          <p className="text-sm text-slate-700 dark:text-slate-300">{story.problem}</p>
        </Section>
      )}

      {story?.journey?.length > 0 && (
        <Section icon={History} title="איך הגענו לכאן">
          <ol className="relative border-s-2 border-slate-200 dark:border-slate-700 ms-1.5 space-y-3">
            {story.journey.map((j, i) => (
              <li key={i} className="ps-4 relative">
                <span className={`absolute -start-[7px] top-1.5 w-3 h-3 rounded-full border-2 border-white dark:border-slate-900 ${i === story.journey.length - 1 ? "bg-brand" : "bg-slate-300 dark:bg-slate-600"}`} />
                <div className="font-semibold text-sm text-slate-800 dark:text-slate-200">{j.title}</div>
                <p className="text-sm text-slate-600 dark:text-slate-400 mt-0.5">{j.text}</p>
              </li>
            ))}
          </ol>
        </Section>
      )}

      <Section icon={Workflow} title="איך זה עובד היום">
        <ul className="space-y-1.5">
          {stage.method.map((m, i) => <li key={i} className="text-sm text-slate-700 dark:text-slate-300 flex gap-2"><span className="text-brand font-bold shrink-0">·</span><span className="min-w-0">{m}</span></li>)}
        </ul>
      </Section>

      {stage.metrics.length > 0 && (
        <Section icon={Gauge} title="המספרים היום">
          <div className="grid grid-cols-2 gap-2">
            {stage.metrics.map(m => (
              <div key={m.label} className="rounded-lg bg-slate-50 dark:bg-slate-800/60 p-2.5 min-w-0">
                <div className="font-black text-slate-900 dark:text-white text-sm">{m.value}</div>
                <div className="text-[11px] text-slate-500 dark:text-slate-400">{m.label}</div>
                {m.note && <div className="text-[10px] text-slate-400 dark:text-slate-500 mt-0.5">{m.note}</div>}
              </div>
            ))}
          </div>
        </Section>
      )}

      {stage.tried.length > 0 && (
        <Section icon={Compass} title="מה ניסינו">
          <ul className="space-y-2">
            {stage.tried.map((t, i) => (
              <li key={i} className="flex gap-2 text-sm">
                <span className={`w-5 h-5 rounded-full flex items-center justify-center shrink-0 mt-0.5 ${t.kept ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300" : "bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400"}`}>
                  {t.kept ? <Check className="w-3 h-3" /> : <X className="w-3 h-3" />}
                </span>
                <span className="min-w-0">
                  <span className="font-semibold text-slate-800 dark:text-slate-200">{t.what}</span>
                  <span className="block text-slate-500 dark:text-slate-400 text-xs mt-0.5">{t.result}</span>
                </span>
              </li>
            ))}
          </ul>
        </Section>
      )}

      {stage.weak.length > 0 && (
        <Section icon={AlertTriangle} title="איפה זה נשבר">
          <ul className="space-y-1">{stage.weak.map((w, i) => <li key={i} className="text-sm text-slate-700 dark:text-slate-300">• {w}</li>)}</ul>
        </Section>
      )}

      {story?.constraints?.length > 0 && (
        <Section icon={Lock} title="מגבלות שכל פתרון צריך לכבד">
          <ul className="space-y-1">{story.constraints.map((w, i) => <li key={i} className="text-sm text-slate-700 dark:text-slate-300">• {w}</li>)}</ul>
        </Section>
      )}

      {story?.askExperts?.length > 0 && (
        <section className="rounded-lg bg-brand/5 dark:bg-brand/10 border border-brand/20 p-3 space-y-2">
          <h3 className="text-xs font-black uppercase tracking-wide text-brand flex items-center gap-1.5"><HelpCircle className="w-3.5 h-3.5" />שאלות פתוחות — כאן אתם נכנסים</h3>
          <ol className="space-y-1.5 list-decimal ps-4">{story.askExperts.map((q, i) => <li key={i} className="text-sm text-slate-800 dark:text-slate-200">{q}</li>)}</ol>
          {topic && <button onClick={() => onTopic(topic.id)} className="text-xs font-bold text-brand inline-flex items-center gap-1">יש לכם כיוון? כתבו בשרשור של "{topic.title}" <ArrowLeft className="w-3 h-3" /></button>}
        </section>
      )}

      {stage.next.length > 0 && (
        <Section icon={Lightbulb} title="כיוונים פתוחים">
          <ul className="space-y-1">{stage.next.map((w, i) => <li key={i} className="text-sm text-slate-700 dark:text-slate-300">• {w}</li>)}</ul>
        </Section>
      )}

      {(stage.from.length > 0 || outs.length > 0) && (
        <div className="space-y-2">
          {stage.from.length > 0 && <Links label="מקבל מ" ids={stage.from} onPick={onPick} cls="border-sky-300 text-sky-700 dark:border-sky-700 dark:text-sky-300" />}
          {outs.length > 0 && <Links label="מעביר ל" ids={outs.map(s => s.id)} onPick={onPick} cls="border-emerald-300 text-emerald-700 dark:border-emerald-700 dark:text-emerald-300" />}
        </div>
      )}

      {stage.files.length > 0 && (
        <Section icon={FileCode2} title="הקוד">
          <ul className="space-y-1" dir="ltr">
            {stage.files.map(f => <li key={f}><code className="text-xs text-slate-600 dark:text-slate-300 break-all">{f}</code></li>)}
          </ul>
        </Section>
      )}

      {topic && (
        <button onClick={() => onTopic(topic.id)} className="btn-secondary btn-sm w-full justify-center gap-1.5">
          לנושא "{topic.title}" — שרשור ומשימות <ArrowLeft className="w-3.5 h-3.5" />
        </button>
      )}
    </article>
  )
}

function Section({ icon: Icon, title, children }) {
  return (
    <section className="space-y-2">
      <h3 className="text-xs font-black uppercase tracking-wide text-slate-500 dark:text-slate-400 flex items-center gap-1.5"><Icon className="w-3.5 h-3.5" />{title}</h3>
      {children}
    </section>
  )
}

function Links({ label, ids, onPick, cls }) {
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <span className="text-xs font-semibold text-slate-500 dark:text-slate-400">{label}:</span>
      {ids.map(id => {
        const s = stageById(id)
        return s && <button key={id} onClick={() => onPick(id)} className={`text-xs font-semibold px-2 py-0.5 rounded-full border ${cls} hover:bg-slate-50 dark:hover:bg-slate-800`}>{s.title}</button>
      })}
    </div>
  )
}
