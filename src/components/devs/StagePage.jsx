import { useCallback, useEffect, useRef, useState } from "react"
import {
  ArrowRight, ArrowLeft, Check, Cpu, FileCode2, Footprints, Lightbulb, ListChecks, Loader2, LogOut, Plus, Target, Users,
  Workflow, History, HelpCircle, Lock, Mountain, Gauge, Compass, AlertTriangle, Sparkles, FlaskConical, Telescope,
} from "lucide-react"
import { LANES, STAGE_STATUS, RUNS_ON, stageById, stageOutputs } from "@/lib/pipelineMap"
import { STORIES } from "@/lib/stageStories"
import { WORK, TOOLS, LAB_FOCUS } from "@/lib/stageWork"
import { getNotes, addNote, deleteNote, getProfilesByIds, joinTopic, leaveTopic } from "@/lib/devs"
import { useAuth } from "@/lib/AuthContext"
import ToolPanel from "./ToolPanel"
import TopicThread, { Avatar } from "./TopicThread"
import Standings from "./Standings"
import { ProposalForm, TaskBoard, RateOutputs, DataGaps } from "./Widgets"

// One stage of מפת המערכת as a full page: what it is and how we got here (pipelineMap.js + stageStories.js),
// then what a developer can do on it — the action, open tasks, the thread (stageWork.js). Members and thread
// are keyed by the stage id in dev_topic_members / dev_topic_notes (supabase/developer-role.sql).

function Card({ icon: Icon, title, children, className = "", tone = "" }) {
  return (
    <section className={`card p-4 sm:p-5 ${className}`}>
      <h2 className={`flex items-center gap-2 font-bold mb-3 ${tone || "text-slate-900 dark:text-white"}`}>
        <Icon className="w-5 h-5 text-brand shrink-0" /> {title}
      </h2>
      {children}
    </section>
  )
}

const Bullets = ({ items }) => (
  <ul className="space-y-1.5">
    {items.map((m, i) => <li key={i} className="text-sm text-slate-700 dark:text-slate-300 flex gap-2"><span className="text-brand font-bold shrink-0">·</span><span className="min-w-0">{m}</span></li>)}
  </ul>
)

export default function StagePage({ stageId, members, onBack, onOpen, onExperiment, onMembersChange, onNotesChange }) {
  const stage = stageById(stageId)
  const { user } = useAuth()
  const [notes, setNotes] = useState(null)
  const [profiles, setProfiles] = useState({})
  const [error, setError] = useState(null)
  const [joinBusy, setJoinBusy] = useState(false)
  const threadRef = useRef(null)
  const actionRef = useRef(null)
  const memberIds = members.map(m => m.user_id)
  const joined = memberIds.includes(user?.id)

  const load = useCallback(async () => {
    setError(null)
    try {
      const n = await getNotes(stageId)
      setNotes(n)
      setProfiles(await getProfilesByIds([...n.map(x => x.author_id), ...memberIds]))
    } catch (e) { setError(e.message || "שגיאה בטעינה") }
  }, [stageId, memberIds.join(",")]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { load() }, [load])

  if (!stage) return null
  const story = STORIES[stage.id] || {}
  const w = WORK[stage.id] || {}
  const st = STAGE_STATUS[stage.status]
  const lane = LANES.find(l => l.id === stage.lane)
  const outs = stageOutputs(stage.id)

  const post = async (body) => {
    const n = await addNote(stageId, body)
    setNotes(prev => [...(prev || []), n])
    if (!profiles[n.author_id]) getProfilesByIds([n.author_id]).then(p => setProfiles(prev => ({ ...prev, ...p }))).catch(() => {})
    onNotesChange?.(+1)
  }
  const remove = async (id) => {
    await deleteNote(id)
    setNotes(prev => (prev || []).filter(n => n.id !== id))
    onNotesChange?.(-1)
  }
  const toggleJoin = async () => {
    setJoinBusy(true)
    try {
      if (joined) await leaveTopic(stageId); else await joinTopic(stageId)
      await onMembersChange?.()
    } catch (e) { setError(e.message || "הפעולה נכשלה") } finally { setJoinBusy(false) }
  }
  const toThread = () => threadRef.current?.scrollIntoView({ behavior: "smooth", block: "start" })

  const a = w.action
  const isTool = a?.kind === "tool" && (TOOLS[a.tool] || LAB_FOCUS[a.tool])

  return (
    <div className="space-y-4">
      <button onClick={onBack} className="inline-flex items-center gap-1.5 text-sm font-semibold text-slate-500 hover:text-brand">
        <ArrowRight className="w-4 h-4" /> מפת המערכת
      </button>

      {/* Header */}
      <div className="card p-4 sm:p-6 space-y-3">
        <div className="flex items-center gap-1.5 flex-wrap text-[11px] font-bold">
          <span className={`px-2 py-0.5 rounded-full ${st.cls}`}>{st.label}</span>
          {w.helpWanted && <span className="px-2 py-0.5 rounded-full bg-brand text-white">מחפשים עזרה</span>}
          <span className="text-slate-400">{lane?.label}</span>
          {stage.runsOn.map(r => (
            <span key={r} className="font-semibold px-2 py-0.5 rounded-full bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300 inline-flex items-center gap-1">
              <Cpu className="w-3 h-3" />{RUNS_ON[r]}
            </span>
          ))}
        </div>
        <div>
          <h1 className="text-xl sm:text-2xl font-black text-slate-900 dark:text-white">{stage.title}</h1>
          <p className="text-sm text-slate-600 dark:text-slate-300 mt-1">{stage.short}</p>
          {stage.current && <p className="text-xs text-slate-500 dark:text-slate-400 mt-1"><b className="text-slate-700 dark:text-slate-300">רץ היום:</b> {stage.current}</p>}
        </div>
        <div className="flex items-center gap-3 flex-wrap">
          <button onClick={toggleJoin} disabled={joinBusy || !user}
            className={joined ? "btn-secondary btn-sm gap-1.5" : "btn-primary btn-sm gap-1.5"}>
            {joinBusy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : joined ? <LogOut className="w-3.5 h-3.5" /> : <Plus className="w-3.5 h-3.5" />}
            {joined ? "עזיבה" : "הצטרפות לשלב"}
          </button>
          {joined && <span className="text-xs font-semibold text-emerald-600 dark:text-emerald-400 inline-flex items-center gap-1"><Check className="w-3.5 h-3.5" /> את/ה בצוות</span>}
          {w.action && (
            <button onClick={() => actionRef.current?.scrollIntoView({ behavior: "smooth", block: "start" })} className="btn-secondary btn-sm gap-1.5">
              <Target className="w-3.5 h-3.5" /> {w.action.label}
            </button>
          )}
          <span className="inline-flex items-center gap-2 text-xs text-slate-500 ms-auto">
            <Users className="w-4 h-4" />
            {memberIds.length === 0 ? "עוד אין חברים — הראשון/ה?" : (
              <>
                <span className="flex -space-x-2 rtl:space-x-reverse">
                  {memberIds.slice(0, 6).map(id => <Avatar key={id} profile={profiles[id]} size="w-7 h-7" />)}
                </span>
                <span className="truncate max-w-[12rem]">{memberIds.slice(0, 3).map(id => profiles[id]?.display_name).filter(Boolean).join(", ")}{memberIds.length > 3 ? ` +${memberIds.length - 3}` : ""}</span>
              </>
            )}
          </span>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_340px] lg:items-start">
        <div className="space-y-4 min-w-0">
          <Standings data={stage.standings} />

          {story.problem && (
            <Card icon={Mountain} title="למה זה קשה אצלנו">
              <p className="text-sm text-slate-700 dark:text-slate-300 leading-relaxed">{story.problem}</p>
            </Card>
          )}

          {story.journey?.length > 0 && (
            <Card icon={History} title="איך הגענו לכאן">
              <ol className="relative border-s-2 border-slate-200 dark:border-slate-700 ms-1.5 space-y-4">
                {story.journey.map((j, i) => (
                  <li key={i} className="ps-4 relative">
                    <span className={`absolute -start-[7px] top-1.5 w-3 h-3 rounded-full border-2 border-white dark:border-slate-900 ${i === story.journey.length - 1 ? "bg-brand" : "bg-slate-300 dark:bg-slate-600"}`} />
                    <div className="font-semibold text-sm text-slate-800 dark:text-slate-200">{j.title}</div>
                    <p className="text-sm text-slate-600 dark:text-slate-400 mt-0.5 leading-relaxed">{j.text}</p>
                  </li>
                ))}
              </ol>
            </Card>
          )}

          <Card icon={Workflow} title="איך זה עובד היום">
            <Bullets items={stage.method} />
            {stage.metrics.length > 0 && (
              <div className="mt-4">
                <h3 className="text-xs font-black text-slate-500 dark:text-slate-400 flex items-center gap-1.5 mb-2"><Gauge className="w-3.5 h-3.5" />המספרים היום</h3>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                  {stage.metrics.map(m => (
                    <div key={m.label} className="rounded-lg bg-slate-50 dark:bg-slate-800/60 p-2.5 min-w-0">
                      <div className="font-black text-slate-900 dark:text-white text-sm">{m.value}</div>
                      <div className="text-[11px] text-slate-500 dark:text-slate-400">{m.label}</div>
                      {m.note && <div className="text-[10px] text-slate-400 dark:text-slate-500 mt-0.5">{m.note}</div>}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </Card>

          {stage.tried.length > 0 && (
            <Card icon={Compass} title="מה ניסינו">
              <ul className="space-y-2.5">
                {stage.tried.map((t, i) => (
                  <li key={i} className="flex gap-2 text-sm">
                    <span className={`w-5 h-5 rounded-full flex items-center justify-center shrink-0 mt-0.5 ${t.kept ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300" : "bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400"}`}>
                      {t.kept ? <Check className="w-3 h-3" /> : <span className="text-xs leading-none">✕</span>}
                    </span>
                    <span className="min-w-0">
                      <span className="font-semibold text-slate-800 dark:text-slate-200">{t.what}</span>
                      <span className="block text-slate-500 dark:text-slate-400 text-xs mt-0.5">{t.result}</span>
                    </span>
                  </li>
                ))}
              </ul>
            </Card>
          )}

          {(stage.weak.length > 0 || story.constraints?.length > 0) && (
            <div className="grid sm:grid-cols-2 gap-4">
              {stage.weak.length > 0 && <Card icon={AlertTriangle} title="איפה זה נשבר"><Bullets items={stage.weak} /></Card>}
              {story.constraints?.length > 0 && <Card icon={Lock} title="מגבלות שכל פתרון צריך לכבד"><Bullets items={story.constraints} /></Card>}
            </div>
          )}

          {story.askExperts?.length > 0 && (
            <section className="card p-4 sm:p-5 border-brand/30 dark:border-brand/40 bg-brand/5 dark:bg-brand/10">
              <h2 className="flex items-center gap-2 font-bold text-brand mb-3"><HelpCircle className="w-5 h-5" /> שאלות פתוחות — כאן אתם נכנסים</h2>
              <ol className="space-y-2 list-decimal ps-5 marker:text-brand marker:font-bold">
                {story.askExperts.map((q, i) => <li key={i} className="text-sm text-slate-800 dark:text-slate-200">{q}</li>)}
              </ol>
              <button onClick={toThread} className="mt-3 text-sm font-bold text-brand inline-flex items-center gap-1">יש לכם כיוון? כתבו בשרשור <ArrowLeft className="w-4 h-4" /></button>
            </section>
          )}

          {/* The action — the hands-on part */}
          {a && (
            <section ref={actionRef} className="card p-4 sm:p-5 border-brand/30 dark:border-brand/40 ring-1 ring-brand/10 scroll-mt-20">
              <div className="flex items-start gap-2 mb-3">
                <Target className="w-5 h-5 text-brand shrink-0 mt-0.5" />
                <div className="min-w-0">
                  <h2 className="font-bold text-slate-900 dark:text-white">עכשיו אתם: {a.label}</h2>
                  {a.hint && <p className="text-sm text-slate-500 dark:text-slate-400 mt-0.5">{a.hint}</p>}
                  {a.kind === "tool" && a.tool === "media" && <p className="text-xs text-slate-400 mt-1">לאישור ושיוך לשחקן: כלים ← {TOOLS.clusters.label}</p>}
                </div>
              </div>
              {a.kind === "experiment" ? (
                <button onClick={() => onExperiment(a.stage)} className="btn-primary btn-sm gap-1.5"><FlaskConical className="w-4 h-4" /> ניסוי חדש על kookisnooki</button>
              ) : isTool ? <ToolPanel tool={a.tool} /> :
                notes === null ? <div className="py-6 flex justify-center"><Loader2 className="w-5 h-5 animate-spin text-slate-400" /></div> :
                a.widget === "proposal" ? <ProposalForm kinds={a.kinds} onPost={post} /> :
                a.widget === "rate-stories" ? <RateOutputs source="stories" notes={notes} onPost={post} /> :
                a.widget === "rate-videos" ? <RateOutputs source="videos" notes={notes} onPost={post} /> :
                a.widget === "data-gaps" ? <DataGaps focus={a.focus} onPost={post} /> : null}
            </section>
          )}

          {w.tasks?.length > 0 && notes && (
            <Card icon={ListChecks} title="משימות פתוחות">
              <TaskBoard tasks={w.tasks} notes={notes} profiles={profiles} onPost={post} onDelete={remove} />
            </Card>
          )}

          <div ref={threadRef} className="scroll-mt-20">
            {error && <div className="card p-4 text-sm text-red-600">{error} <button onClick={load} className="underline ms-2">נסו שוב</button></div>}
            {notes === null && !error ? (
              <div className="card p-6 flex justify-center"><Loader2 className="w-5 h-5 animate-spin text-slate-400" /></div>
            ) : notes && (
              <TopicThread notes={notes} profiles={profiles} tasks={w.tasks || []} onPost={post} onDelete={remove} />
            )}
          </div>
        </div>

        <aside className="space-y-4 min-w-0">
          {w.why && (
            <Card icon={Lightbulb} title="למה זה חשוב">
              <p className="text-sm text-slate-700 dark:text-slate-300 leading-relaxed">{w.why}</p>
            </Card>
          )}
          {w.experiment && a?.kind !== "experiment" && (
            <Card icon={FlaskConical} title="ניסוי על המערכת האמיתית">
              <p className="text-sm text-slate-600 dark:text-slate-400 mb-3">משנים הגדרה, kookisnooki מריץ על מבחן קבוע, ותוך דקה רואים אם זה טוב או גרוע מהיום.</p>
              <button onClick={() => onExperiment(w.experiment)} className="btn-primary btn-sm gap-1.5"><Plus className="w-4 h-4" /> ניסוי חדש</button>
            </Card>
          )}
          {(w.steps?.length > 0 || w.skills?.length > 0) && (
            <Card icon={Footprints} title="איך מתחילים">
              {w.steps?.length > 0 && (
                <ol className="space-y-2 text-sm text-slate-700 dark:text-slate-300 list-decimal ps-5 marker:text-brand marker:font-bold">
                  {w.steps.map((s, i) => <li key={i}>{s}</li>)}
                </ol>
              )}
              {w.skills?.length > 0 && (
                <div className="flex flex-wrap gap-1.5 mt-4">{w.skills.map(s => <span key={s} className="stat-pill badge-neutral">{s}</span>)}</div>
              )}
            </Card>
          )}
          {stage.next.length > 0 && <Card icon={Telescope} title="כיוונים פתוחים"><Bullets items={stage.next} /></Card>}
          {(stage.from.length > 0 || outs.length > 0) && (
            <Card icon={Sparkles} title="מחובר ל">
              <div className="space-y-2">
                {stage.from.length > 0 && <Links label="מקבל מ" ids={stage.from} onOpen={onOpen} cls="border-sky-300 text-sky-700 dark:border-sky-700 dark:text-sky-300" />}
                {outs.length > 0 && <Links label="מעביר ל" ids={outs.map(s => s.id)} onOpen={onOpen} cls="border-emerald-300 text-emerald-700 dark:border-emerald-700 dark:text-emerald-300" />}
              </div>
            </Card>
          )}
          {stage.files.length > 0 && (
            <Card icon={FileCode2} title="בקוד">
              <ul className="space-y-1" dir="ltr">
                {stage.files.map(f => <li key={f}><code className="text-xs text-slate-600 dark:text-slate-300 break-all">{f}</code></li>)}
              </ul>
            </Card>
          )}
        </aside>
      </div>
    </div>
  )
}

function Links({ label, ids, onOpen, cls }) {
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <span className="text-xs font-semibold text-slate-500 dark:text-slate-400">{label}:</span>
      {ids.map(id => {
        const s = stageById(id)
        return s && <button key={id} onClick={() => onOpen(id)} className={`text-xs font-semibold px-2 py-0.5 rounded-full border ${cls} hover:bg-slate-50 dark:hover:bg-slate-800`}>{s.title}</button>
      })}
    </div>
  )
}
