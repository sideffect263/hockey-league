import { useCallback, useEffect, useMemo, useState } from "react"
import { useSearchParams } from "react-router-dom"
import { motion } from "framer-motion"
import { Code2, Search, Users, MessageSquare, Compass, Wrench, Star, X, Workflow, FlaskConical } from "lucide-react"
import { useAuth } from "@/lib/AuthContext"
import { TOPICS, AREAS, STATUSES, TOOLS, topicById } from "@/lib/devTopics"
import { getAllMembers, getNoteStats } from "@/lib/devs"
import { CreatorsSkeleton } from "@/components/skeletons/PageSkeletons"
import { Skeleton } from "@/components/ui/Skeleton"
import ToolPanel, { ICONS } from "@/components/devs/ToolPanel"
import TopicView from "@/components/devs/TopicView"
import PipelineMap from "@/components/devs/PipelineMap"
import Experiments from "@/components/devs/Experiments"

// מפתחים: volunteer developers browse everything we are building (video analysis, models, 3D,
// cameras, AI, data, the apps), join a topic and do something real on it right here.
// Gate: the 'developer' role or admin. Data: supabase/developer-role.sql (+ developer-access.sql
// opens the moved lab / 3D / media tools to developers).
//
// URL: ?topic=<id> opens a topic; ?tab=lab|scene3d|media|clusters opens a tool directly
// (old /creators?tab=… links redirect here); ?tab=tools = the tools list;
// ?tab=map[&stage=<id>] = מפת המערכת, the video-AI pipeline (src/lib/pipelineMap.js);
// ?tab=exp[&exp=<id>|&new=1] = ניסויים, settings run on kookisnooki (supabase/dev-experiments.sql).

const TOOL_TABS = Object.keys(TOOLS)

export default function Devs() {
  const { user, isAdmin, isDeveloper, loading: authLoading } = useAuth()
  const canAccess = isDeveloper || isAdmin
  const [params, setParams] = useSearchParams()
  const topicId = params.get("topic")
  const tab = params.get("tab")
  const topic = topicId ? topicById(topicId) : null
  const view = topic ? "topic" : tab === "map" ? "map" : tab === "exp" ? "exp" : (tab === "tools" || TOOL_TABS.includes(tab)) ? "tools" : "browse"

  const [members, setMembers] = useState(null)
  const [noteStats, setNoteStats] = useState({ perTopic: {}, mine: 0 })
  const [loadError, setLoadError] = useState(null)

  const loadMembers = useCallback(() => getAllMembers().then(setMembers), [])
  useEffect(() => {
    if (authLoading || !canAccess) return
    setLoadError(null)
    Promise.all([loadMembers(), getNoteStats().then(setNoteStats)])
      .catch(e => { setMembers(m => m || []); setLoadError(e.message || "שגיאה בטעינה") })
  }, [authLoading, canAccess, loadMembers])

  // New view → top of the page (topic pages are long).
  useEffect(() => { window.scrollTo({ top: 0 }) }, [topicId, view, params.get("exp"), params.get("new")])
  const stageId = params.get("stage")

  if (authLoading) return <CreatorsSkeleton />
  if (!user || !canAccess) return <AccessDenied signedIn={!!user} email={user?.email} />

  const go = (next) => setParams(next)
  const membersOf = (id) => (members || []).filter(m => m.topic_id === id)
  const myTopics = new Set((members || []).filter(m => m.user_id === user?.id).map(m => m.topic_id))

  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-6xl mx-auto space-y-5">
      {view !== "topic" && (
        <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} className="space-y-4">
          <div>
            <h1 className="page-title flex items-center gap-2.5"><Code2 className="w-7 h-7 text-brand" /> מפתחים</h1>
            <p className="page-subtitle mt-1">
              כל מה שאנחנו בונים לליגה — ניתוח וידאו, מודלים, תלת-ממד, מצלמות, AI והאפליקציות. בוחרים נושא, מצטרפים,
              ועושים משהו אמיתי ממש מכאן: מתייגים, סוקרים, מדרגים, מדווחים.
            </p>
          </div>
          <div className="grid grid-cols-3 gap-2 sm:gap-3 max-w-xl">
            <Stat icon={Users} label="נושאים שלי" value={members ? myTopics.size : null} />
            <Stat icon={MessageSquare} label="הודעות שלי" value={members ? noteStats.mine : null} />
            <Stat icon={Star} label="מחפשים עזרה" value={TOPICS.filter(t => t.status === "help_wanted").length} />
          </div>
          <div className="flex gap-1 p-1 rounded-xl bg-slate-100 dark:bg-slate-800 w-fit max-w-full overflow-x-auto [scrollbar-width:none]" role="tablist">
            <TabBtn active={view === "browse"} onClick={() => go({})} icon={Compass}>נושאים</TabBtn>
            <TabBtn active={view === "map"} onClick={() => go({ tab: "map" })} icon={Workflow}>מפת המערכת</TabBtn>
            <TabBtn active={view === "exp"} onClick={() => go({ tab: "exp" })} icon={FlaskConical}>ניסויים</TabBtn>
            <TabBtn active={view === "tools"} onClick={() => go({ tab: "tools" })} icon={Wrench}>כלים</TabBtn>
          </div>
        </motion.div>
      )}

      {loadError && <div className="card p-3 text-sm text-red-600 dark:text-red-400">{loadError}</div>}

      {view === "topic" && (
        <TopicView key={topic.id} topic={topic} members={membersOf(topic.id)}
          onBack={() => go({})} onMembersChange={loadMembers}
          onNotesChange={(d) => setNoteStats(s => ({
            mine: s.mine + d, perTopic: { ...s.perTopic, [topic.id]: (s.perTopic[topic.id] || 0) + d },
          }))} />
      )}
      {view === "browse" && (
        <Browse members={members} noteStats={noteStats} myTopics={myTopics} onOpen={(id) => go({ topic: id })} />
      )}
      {view === "map" && (
        <PipelineMap stageId={stageId} onPick={(id) => setParams(id ? { tab: "map", stage: id } : { tab: "map" }, { replace: true })}
          onTopic={(id) => go({ topic: id })} />
      )}
      {view === "exp" && (
        <Experiments expId={params.get("exp")} isNew={params.get("new") === "1"}
          onOpen={(id) => go({ tab: "exp", exp: id })} onNew={() => go({ tab: "exp", new: "1" })}
          onBack={() => go({ tab: "exp" })} onStage={(id) => go({ tab: "map", stage: id })} />
      )}
      {view === "tools" && <Tools tool={TOOL_TABS.includes(tab) ? tab : null} onPick={(t) => go(t ? { tab: t } : { tab: "tools" })} />}
    </div>
  )
}

function Stat({ icon: Icon, label, value }) {
  return (
    <div className="card p-3 flex items-center gap-2.5 min-w-0">
      <Icon className="w-5 h-5 text-brand shrink-0" />
      <div className="min-w-0">
        {value === null ? <Skeleton className="h-5 w-6" /> : <div className="text-lg font-black text-slate-900 dark:text-white leading-none" dir="ltr">{value}</div>}
        <div className="text-[11px] text-slate-500 dark:text-slate-400 truncate">{label}</div>
      </div>
    </div>
  )
}

function TabBtn({ active, onClick, icon: Icon, children }) {
  return (
    <button role="tab" aria-selected={active} onClick={onClick}
      className={`inline-flex items-center gap-1.5 px-3 sm:px-4 py-1.5 rounded-lg text-sm font-semibold whitespace-nowrap transition-colors ${active ? "bg-white dark:bg-slate-900 text-brand shadow-sm" : "text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white"}`}>
      <Icon className="w-4 h-4" /> {children}
    </button>
  )
}

const chipCls = (on, strong = false) => `shrink-0 px-3 py-1.5 rounded-full text-xs font-semibold border transition-colors whitespace-nowrap ${on
  ? "bg-brand text-white border-brand"
  : strong
    ? "border-brand/40 text-brand dark:text-brand-light bg-brand/5 hover:bg-brand/10"
    : "border-slate-200 dark:border-slate-600 text-slate-600 dark:text-slate-300 hover:border-brand/50"}`

function Browse({ members, noteStats, myTopics, onOpen }) {
  const [area, setArea] = useState("")
  const [status, setStatus] = useState("")
  const [mine, setMine] = useState(false)
  const [q, setQ] = useState("")

  const list = useMemo(() => {
    const s = q.trim().toLowerCase()
    return TOPICS.filter(t =>
      (!area || t.area === area) &&
      (!status || t.status === status) &&
      (!mine || myTopics.has(t.id)) &&
      (!s || [t.title, t.tagline, t.why, ...t.skills].join(" ").toLowerCase().includes(s)))
      // help wanted first, then the rest in catalog order
      .sort((a, b) => (b.status === "help_wanted") - (a.status === "help_wanted"))
  }, [area, status, mine, q, myTopics])

  const count = (id) => (members || []).filter(m => m.topic_id === id).length
  const anyFilter = area || status || mine || q

  return (
    <div className="space-y-4">
      <div className="space-y-2.5">
        <label className="relative block">
          <Search className="w-4 h-4 absolute top-1/2 -translate-y-1/2 start-3 text-slate-400" />
          <input value={q} onChange={e => setQ(e.target.value)} placeholder="חיפוש: נושא, כלי, שפה (Python, React…)"
            className="filter-input w-full text-sm ps-9" />
        </label>
        <div className="flex gap-2 overflow-x-auto pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          <button onClick={() => setStatus(status === "help_wanted" ? "" : "help_wanted")} className={chipCls(status === "help_wanted", true)}>
            {STATUSES.help_wanted.label}
          </button>
          <button onClick={() => setMine(!mine)} className={chipCls(mine)}>שלי</button>
          {Object.entries(STATUSES).filter(([k]) => k !== "help_wanted").map(([k, s]) => (
            <button key={k} onClick={() => setStatus(status === k ? "" : k)} className={chipCls(status === k)}>{s.label}</button>
          ))}
        </div>
        <div className="flex gap-2 overflow-x-auto pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          <button onClick={() => setArea("")} className={chipCls(!area)}>כל התחומים</button>
          {Object.entries(AREAS).map(([k, a]) => {
            const Icon = ICONS[a.icon]
            return (
              <button key={k} onClick={() => setArea(area === k ? "" : k)} className={`${chipCls(area === k)} inline-flex items-center gap-1`}>
                <Icon className="w-3.5 h-3.5" /> {a.label}
              </button>
            )
          })}
        </div>
      </div>

      {list.length === 0 ? (
        <div className="card p-8 text-center space-y-2">
          <p className="text-sm text-slate-500">{mine && !myTopics.size ? "עוד לא הצטרפת לאף נושא. פתחו נושא ולחצו \"הצטרפות\"." : "שום נושא לא מתאים לסינון."}</p>
          {anyFilter && (
            <button onClick={() => { setArea(""); setStatus(""); setMine(false); setQ("") }} className="inline-flex items-center gap-1 text-sm font-semibold text-brand">
              <X className="w-4 h-4" /> ניקוי סינון
            </button>
          )}
        </div>
      ) : (
        <div className="grid sm:grid-cols-2 xl:grid-cols-3 gap-3">
          {list.map(t => (
            <TopicCard key={t.id} topic={t} members={members ? count(t.id) : null}
              notes={noteStats.perTopic[t.id] || 0} joined={myTopics.has(t.id)} onOpen={() => onOpen(t.id)} />
          ))}
        </div>
      )}
    </div>
  )
}

function TopicCard({ topic, members, notes, joined, onOpen }) {
  const area = AREAS[topic.area]
  const Icon = ICONS[area.icon]
  const status = STATUSES[topic.status]
  return (
    <button onClick={onOpen}
      className={`card-hover p-4 text-start flex flex-col gap-3 min-w-0 focus-visible:ring-2 focus-visible:ring-brand outline-none ${topic.status === "help_wanted" ? "border-brand/30 dark:border-brand/40" : ""}`}>
      <div className="flex items-start gap-3">
        <span className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${area.cls}`}><Icon className="w-5 h-5" /></span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${status.cls}`}>{status.label}</span>
            {joined && <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300">הצטרפת</span>}
          </div>
          <h3 className="font-bold text-slate-900 dark:text-white mt-1 leading-snug">{topic.title}</h3>
        </div>
      </div>
      <p className="text-sm text-slate-600 dark:text-slate-400 line-clamp-2">{topic.tagline}</p>
      <div className="flex flex-wrap gap-1">
        {topic.skills.slice(0, 4).map(s => <span key={s} className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300">{s}</span>)}
      </div>
      <div className="mt-auto pt-2 border-t border-slate-100 dark:border-slate-800 flex items-center gap-3 text-xs text-slate-500">
        <span className="inline-flex items-center gap-1"><Users className="w-3.5 h-3.5" />{members === null ? "…" : members}</span>
        <span className="inline-flex items-center gap-1"><MessageSquare className="w-3.5 h-3.5" />{notes}</span>
        <span className="ms-auto font-semibold text-brand truncate">{topic.action.label} ←</span>
      </div>
    </button>
  )
}

function Tools({ tool, onPick }) {
  if (tool) {
    const t = TOOLS[tool]
    const Icon = ICONS[t.icon]
    return (
      <div className="space-y-3">
        <div className="flex items-center gap-2 flex-wrap">
          <button onClick={() => onPick(null)} className="text-sm font-semibold text-slate-500 hover:text-brand">כל הכלים</button>
          <span className="text-slate-300">/</span>
          <span className="inline-flex items-center gap-1.5 text-sm font-bold text-slate-900 dark:text-white"><Icon className="w-4 h-4 text-brand" /> {t.label}</span>
        </div>
        <ToolPanel tool={tool} />
      </div>
    )
  }
  return (
    <div className="grid sm:grid-cols-2 gap-3">
      {Object.entries(TOOLS).map(([id, t]) => {
        const Icon = ICONS[t.icon]
        return (
          <button key={id} onClick={() => onPick(id)} className="card-hover p-4 text-start flex items-start gap-3">
            <span className="w-10 h-10 rounded-xl bg-brand/10 text-brand flex items-center justify-center shrink-0"><Icon className="w-5 h-5" /></span>
            <span className="min-w-0">
              <span className="block font-bold text-slate-900 dark:text-white">{t.label}</span>
              <span className="block text-sm text-slate-500 dark:text-slate-400 mt-0.5">{t.desc}</span>
            </span>
          </button>
        )
      })}
    </div>
  )
}

function AccessDenied({ signedIn, email }) {
  const { signInWithGoogle } = useAuth()
  return (
    <div className="flex items-center justify-center min-h-[60vh]">
      <div className="card p-8 sm:p-12 text-center max-w-md mx-4">
        <Code2 className="w-16 h-16 text-slate-300 dark:text-slate-600 mx-auto mb-4" />
        <h1 className="text-xl font-bold text-slate-900 dark:text-white mb-2">אזור המפתחים</h1>
        {signedIn ? (
          <p className="text-sm text-slate-500 dark:text-slate-400">
            החשבון <span dir="ltr">{email}</span> עדיין לא מוגדר כמפתח/ת. רוצים לעזור? פנו למנהל הליגה ונוסיף לכם את התפקיד.
          </p>
        ) : (
          <>
            <p className="text-sm text-slate-500 dark:text-slate-400 mb-6">התחברו עם חשבון מפתח/ת כדי להיכנס.</p>
            <button onClick={signInWithGoogle} className="btn-primary w-full">התחברות עם Google</button>
          </>
        )}
      </div>
    </div>
  )
}
