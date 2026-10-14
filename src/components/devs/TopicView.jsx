import { useCallback, useEffect, useState } from "react"
import { ArrowRight, Check, Footprints, Lightbulb, ListChecks, Loader2, LogOut, Plus, Target, Users, Wrench, FileCode2 } from "lucide-react"
import { AREAS, STATUSES, TOOLS, LAB_FOCUS } from "@/lib/devTopics"
import { getNotes, addNote, deleteNote, getProfilesByIds, joinTopic, leaveTopic } from "@/lib/devs"
import { useAuth } from "@/lib/AuthContext"
import ToolPanel, { ICONS } from "./ToolPanel"
import TopicThread, { Avatar } from "./TopicThread"
import { ProposalForm, TaskBoard, RateOutputs, DataGaps } from "./Widgets"

function Section({ icon: Icon, title, children, className = "" }) {
  return (
    <section className={`card p-4 sm:p-5 ${className}`}>
      <h2 className="flex items-center gap-2 font-bold text-slate-900 dark:text-white mb-3">
        <Icon className="w-5 h-5 text-brand" /> {title}
      </h2>
      {children}
    </section>
  )
}

/** One topic: why / now / how to start, join, the action, open tasks, the thread. */
export default function TopicView({ topic, members, onBack, onMembersChange, onNotesChange }) {
  const { user } = useAuth()
  const [notes, setNotes] = useState(null)
  const [profiles, setProfiles] = useState({})
  const [error, setError] = useState(null)
  const [joinBusy, setJoinBusy] = useState(false)
  const area = AREAS[topic.area]
  const AreaIcon = ICONS[area.icon]
  const status = STATUSES[topic.status]
  const memberIds = members.map(m => m.user_id)
  const joined = memberIds.includes(user?.id)

  const load = useCallback(async () => {
    setError(null)
    try {
      const n = await getNotes(topic.id)
      setNotes(n)
      setProfiles(await getProfilesByIds([...n.map(x => x.author_id), ...memberIds]))
    } catch (e) { setError(e.message || "שגיאה בטעינה") }
  }, [topic.id, memberIds.join(",")]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { load() }, [load])

  const post = async (body) => {
    const n = await addNote(topic.id, body)
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
      if (joined) await leaveTopic(topic.id); else await joinTopic(topic.id)
      await onMembersChange?.()
    } catch (e) { setError(e.message || "הפעולה נכשלה") } finally { setJoinBusy(false) }
  }

  const a = topic.action
  const toolMeta = a.kind === "tool" ? (TOOLS[a.tool] || TOOLS.lab) : null
  const isTool = a.kind === "tool" && (TOOLS[a.tool] || LAB_FOCUS[a.tool])

  return (
    <div className="space-y-4">
      <button onClick={onBack} className="inline-flex items-center gap-1.5 text-sm font-semibold text-slate-500 hover:text-brand">
        <ArrowRight className="w-4 h-4" /> כל הנושאים
      </button>

      {/* Header */}
      <div className="card p-4 sm:p-6">
        <div className="flex items-start gap-3 sm:gap-4">
          <span className={`w-12 h-12 rounded-2xl flex items-center justify-center shrink-0 ${area.cls}`}><AreaIcon className="w-6 h-6" /></span>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 flex-wrap text-[11px] font-bold">
              <span className={`px-2 py-0.5 rounded-full ${status.cls}`}>{status.label}</span>
              <span className="text-slate-400">{area.label}</span>
            </div>
            <h1 className="text-xl sm:text-2xl font-black text-slate-900 dark:text-white mt-1">{topic.title}</h1>
            <p className="text-sm text-slate-600 dark:text-slate-300 mt-1">{topic.tagline}</p>
          </div>
        </div>
        <div className="mt-4 flex items-center gap-3 flex-wrap">
          <button onClick={toggleJoin} disabled={joinBusy || !user}
            className={joined ? "btn-secondary btn-sm gap-1.5" : "btn-primary btn-sm gap-1.5"}>
            {joinBusy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : joined ? <LogOut className="w-3.5 h-3.5" /> : <Plus className="w-3.5 h-3.5" />}
            {joined ? "עזיבת הנושא" : "הצטרפות לנושא"}
          </button>
          {joined && <span className="text-xs font-semibold text-emerald-600 dark:text-emerald-400 inline-flex items-center gap-1"><Check className="w-3.5 h-3.5" /> את/ה בצוות</span>}
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

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px] lg:items-start">
        <div className="space-y-4 min-w-0">
          {/* The action — the point of the page */}
          <section className="card p-4 sm:p-5 border-brand/30 dark:border-brand/40 ring-1 ring-brand/10">
            <div className="flex items-start gap-2 mb-3">
              <Target className="w-5 h-5 text-brand shrink-0 mt-0.5" />
              <div className="min-w-0">
                <h2 className="font-bold text-slate-900 dark:text-white">{a.label}</h2>
                {a.hint && <p className="text-sm text-slate-500 dark:text-slate-400 mt-0.5">{a.hint}</p>}
                {toolMeta && a.tool === "media" && (
                  <p className="text-xs text-slate-400 mt-1">לאישור ושיוך לשחקן: כלים ← {TOOLS.clusters.label}</p>
                )}
              </div>
            </div>
            {isTool ? <ToolPanel tool={a.tool} /> :
              notes === null ? <div className="py-6 flex justify-center"><Loader2 className="w-5 h-5 animate-spin text-slate-400" /></div> :
              a.widget === "proposal" ? <ProposalForm kinds={a.kinds} onPost={post} /> :
              a.widget === "rate-stories" ? <RateOutputs source="stories" notes={notes} onPost={post} /> :
              a.widget === "rate-videos" ? <RateOutputs source="videos" notes={notes} onPost={post} /> :
              a.widget === "data-gaps" ? <DataGaps focus={a.focus} onPost={post} /> : null}
          </section>

          {topic.tasks?.length > 0 && notes && (
            <Section icon={ListChecks} title="משימות פתוחות">
              <TaskBoard tasks={topic.tasks} notes={notes} profiles={profiles} onPost={post} onDelete={remove} />
            </Section>
          )}

          {error && <div className="card p-4 text-sm text-red-600">{error} <button onClick={load} className="underline ms-2">נסו שוב</button></div>}
          {notes === null && !error ? (
            <div className="card p-6 flex justify-center"><Loader2 className="w-5 h-5 animate-spin text-slate-400" /></div>
          ) : notes && (
            <TopicThread notes={notes} profiles={profiles} tasks={topic.tasks} onPost={post} onDelete={remove} />
          )}
        </div>

        <aside className="space-y-4 min-w-0">
          <Section icon={Lightbulb} title="למה זה חשוב">
            <p className="text-sm text-slate-700 dark:text-slate-300 leading-relaxed">{topic.why}</p>
          </Section>
          <Section icon={Wrench} title="מה קורה עכשיו">
            <p className="text-sm text-slate-700 dark:text-slate-300 leading-relaxed">{topic.now}</p>
          </Section>
          <Section icon={Footprints} title="איך מתחילים">
            <ol className="space-y-2 text-sm text-slate-700 dark:text-slate-300 list-decimal ps-5 marker:text-brand marker:font-bold">
              {topic.steps.map((s, i) => <li key={i}>{s}</li>)}
            </ol>
            <div className="flex flex-wrap gap-1.5 mt-4">
              {topic.skills.map(s => <span key={s} className="stat-pill badge-neutral">{s}</span>)}
            </div>
          </Section>
          {topic.links?.length > 0 && (
            <Section icon={FileCode2} title="בקוד">
              <ul className="space-y-1">
                {topic.links.map(l => <li key={l}><code dir="ltr" className="text-xs text-slate-600 dark:text-slate-300 break-all">{l}</code></li>)}
              </ul>
            </Section>
          )}
        </aside>
      </div>
    </div>
  )
}
