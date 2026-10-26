import { useMemo, useState } from "react"
import { ChevronDown, Lightbulb, Search, Workflow, X } from "lucide-react"
import { Squad as Users, Comment as MessageSquare } from "@/components/icons/BrandIcons"
import { LANES, STAGES, STAGE_STATUS } from "@/lib/pipelineMap"
import { WORK } from "@/lib/stageWork"
import VideoFlow from "@/components/video/VideoFlow"

// מפת המערכת: every part of what we build (the video-AI pipeline, the site, the apps, the data) as lanes of
// stages. A card opens the stage page (StagePage) — story, numbers, the action, tasks and the thread.
// Content: src/lib/pipelineMap.js (what) + stageStories.js (how we got here) + stageWork.js (what to do).

const chipCls = (on, strong = false) => `shrink-0 px-3 py-1.5 rounded-full text-xs font-semibold border transition-colors whitespace-nowrap ${on
  ? "bg-brand text-white border-brand"
  : strong
    ? "border-brand/40 text-brand dark:text-brand-light bg-brand/5 hover:bg-brand/10"
    : "border-slate-200 dark:border-slate-600 text-slate-600 dark:text-slate-300 hover:border-brand/50"}`

export default function PipelineMap({ members, noteStats, myStages, onOpen }) {
  const [q, setQ] = useState("")
  const [help, setHelp] = useState(false)
  const [mine, setMine] = useState(false)

  const match = useMemo(() => {
    const s = q.trim().toLowerCase()
    return (st) => {
      const w = WORK[st.id] || {}
      if (help && !w.helpWanted) return false
      if (mine && !myStages.has(st.id)) return false
      if (!s) return true
      return [st.title, st.short, w.why, ...(w.skills || []), ...st.method].join(" ").toLowerCase().includes(s)
    }
  }, [q, help, mine, myStages])
  const anyFilter = q || help || mine
  const shown = STAGES.filter(match).length
  const count = (id) => (members || []).filter(m => m.topic_id === id).length

  return (
    <div className="space-y-4">
      <Intro />
      <VideoFlow variant="devs" onOpen={onOpen} />
      <div className="space-y-2.5">
        <label className="relative block">
          <Search className="w-4 h-4 absolute top-1/2 -translate-y-1/2 start-3 text-slate-400" />
          <input value={q} onChange={e => setQ(e.target.value)} placeholder="חיפוש: שלב, שיטה, שפה (Python, React, YOLO…)"
            className="filter-input w-full text-sm ps-9" />
        </label>
        <div className="flex gap-2 overflow-x-auto pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden items-center">
          <button onClick={() => setHelp(!help)} className={chipCls(help, true)}>מחפשים עזרה</button>
          <button onClick={() => setMine(!mine)} className={chipCls(mine)}>שהצטרפתי</button>
          {anyFilter && (
            <button onClick={() => { setQ(""); setHelp(false); setMine(false) }} className="inline-flex items-center gap-1 text-xs font-semibold text-brand shrink-0">
              <X className="w-3.5 h-3.5" /> ניקוי ({shown})
            </button>
          )}
        </div>
      </div>

      {shown === 0 ? (
        <div className="card p-8 text-center text-sm text-slate-500">
          {mine && !myStages.size ? "עוד לא הצטרפת לאף שלב. פתחו שלב ולחצו \"הצטרפות\"." : "שום שלב לא מתאים לסינון."}
        </div>
      ) : (
        <div className="space-y-1">
          {LANES.map((lane, i) => {
            const stages = STAGES.filter(s => s.lane === lane.id && match(s))
            if (!stages.length) return null
            const flow = !anyFilter && ["perception", "understand", "output"].includes(lane.id)
            const divider = !anyFilter && ["platform", "support"].includes(lane.id)
            return (
              <div key={lane.id}>
                {flow && <div className="flex justify-center py-1 text-slate-300 dark:text-slate-600"><ChevronDown className="w-5 h-5" /></div>}
                {divider && <div className="border-t border-dashed border-slate-200 dark:border-slate-700 my-4" />}
                {anyFilter && i > 0 && <div className="h-3" />}
                <section>
                  <div className="flex items-baseline gap-2 mb-2 px-1">
                    <h3 className="text-sm font-black text-slate-900 dark:text-white">{lane.label}</h3>
                    <span className="text-xs text-slate-500 dark:text-slate-400 truncate">{lane.desc}</span>
                  </div>
                  <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2">
                    {stages.map(s => (
                      <StageCard key={s.id} stage={s} members={members ? count(s.id) : null}
                        notes={noteStats.perTopic[s.id] || 0} joined={myStages.has(s.id)} onOpen={() => onOpen(s.id)} />
                    ))}
                  </div>
                </section>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

function StageCard({ stage, members, notes, joined, onOpen }) {
  const st = STAGE_STATUS[stage.status]
  const w = WORK[stage.id] || {}
  return (
    <button onClick={onOpen}
      className={`card-hover p-3 text-start flex flex-col gap-1.5 min-w-0 outline-none focus-visible:ring-2 focus-visible:ring-brand ${w.helpWanted ? "border-brand/30 dark:border-brand/40" : ""}`}>
      <span className="flex items-center gap-1.5 min-w-0">
        <span className={`w-2 h-2 rounded-full shrink-0 ${st.dot}`} title={st.label} />
        <span className="font-bold text-sm text-slate-900 dark:text-white truncate">{stage.title}</span>
      </span>
      <span className="text-xs text-slate-500 dark:text-slate-400 line-clamp-2">{stage.short}</span>
      <span className="mt-auto pt-1 flex items-center gap-2 text-[11px] text-slate-500 flex-wrap">
        {w.helpWanted && <span className="font-bold px-1.5 py-0.5 rounded-full bg-brand text-white">מחפשים עזרה</span>}
        {joined && <span className="font-bold px-1.5 py-0.5 rounded-full bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300">הצטרפת</span>}
        <span className="inline-flex items-center gap-2 ms-auto">
          <span className="inline-flex items-center gap-0.5"><Users className="w-4 h-4" />{members ?? "…"}</span>
          <span className="inline-flex items-center gap-0.5"><MessageSquare className="w-4 h-4" />{notes}</span>
        </span>
      </span>
    </button>
  )
}

function Intro() {
  return (
    <div className="card p-4 space-y-3">
      <div className="flex items-start gap-3">
        <span className="w-10 h-10 rounded-xl bg-brand/10 text-brand flex items-center justify-center shrink-0"><Workflow className="w-5 h-5" /></span>
        <div className="min-w-0">
          <h2 className="font-bold text-slate-900 dark:text-white">כל מה שאנחנו בונים, שלב אחרי שלב</h2>
          <p className="text-sm text-slate-600 dark:text-slate-400 mt-0.5">
            מהפריים הגולמי של המצלמה ועד סטטיסטיקה, תקצירים ושחזור — ומשם לאתר, לאפליקציות ולנתונים. כל שלב נפתח לעמוד משלו:
            למה זה קשה, איך הגענו לכאן, המספרים, מה ניסינו ולא עבד, שאלות פתוחות — ומה אפשר לעשות בו עכשיו.
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
