import { useCallback, useEffect, useState } from "react"
import { useSearchParams } from "react-router-dom"
import { motion } from "framer-motion"
import { Code2, Wrench, Workflow, FlaskConical } from "lucide-react"
import { Squad as Users, Comment as MessageSquare, Star } from "@/components/icons/BrandIcons"
import { useAuth } from "@/lib/AuthContext"
import { stageById } from "@/lib/pipelineMap"
import { WORK, TOOLS, TOPIC_TO_STAGE } from "@/lib/stageWork"
import { getAllMembers, getNoteStats } from "@/lib/devs"
import { CreatorsSkeleton } from "@/components/skeletons/PageSkeletons"
import { Skeleton } from "@/components/ui/Skeleton"
import ToolPanel, { ICONS } from "@/components/devs/ToolPanel"
import PipelineMap from "@/components/devs/PipelineMap"
import StagePage from "@/components/devs/StagePage"
import Experiments from "@/components/devs/Experiments"

// מפתחים: everything we build for the league as one map (video AI → site, apps, data). Every stage opens to a
// page with its story, numbers, the hands-on action, open tasks and a thread; experiments run engine settings on
// kookisnooki. Gate: the 'developer' role or admin (supabase/developer-role.sql, developer-access.sql,
// dev-experiments.sql).
//
// URL: (none) = the map · ?stage=<id> = a stage page · ?tab=exp[&exp=<id>|&new=1[&for=events|ball]] = experiments ·
// ?tab=tools = the tools list · ?tab=lab|scene3d|media|clusters = a tool (old /creators?tab=… links redirect
// here) · ?topic=<old topic id> → its stage (the "נושאים" catalog was merged into the map 2026-10-15).

const TOOL_TABS = Object.keys(TOOLS)
const HELP_WANTED = Object.values(WORK).filter(w => w.helpWanted).length

export default function Devs() {
  const { user, isAdmin, isDeveloper, loading: authLoading } = useAuth()
  const canAccess = isDeveloper || isAdmin
  const [params, setParams] = useSearchParams()
  const tab = params.get("tab")
  const legacyTopic = params.get("topic")
  const stageId = params.get("stage") || (legacyTopic && TOPIC_TO_STAGE[legacyTopic]) || null
  const stage = stageId ? stageById(stageId) : null
  const view = stage ? "stage" : tab === "exp" ? "exp" : (tab === "tools" || TOOL_TABS.includes(tab)) ? "tools" : "map"

  const [members, setMembers] = useState(null)
  const [noteStats, setNoteStats] = useState({ perTopic: {}, mine: 0 })
  const [loadError, setLoadError] = useState(null)

  // Old ?topic= link → the stage that absorbed it (replace, so Back doesn't bounce).
  useEffect(() => {
    if (legacyTopic) setParams(stage ? { stage: stage.id } : {}, { replace: true })
  }, [legacyTopic]) // eslint-disable-line react-hooks/exhaustive-deps

  const loadMembers = useCallback(() => getAllMembers().then(setMembers), [])
  useEffect(() => {
    if (authLoading || !canAccess) return
    setLoadError(null)
    Promise.all([loadMembers(), getNoteStats().then(setNoteStats)])
      .catch(e => { setMembers(m => m || []); setLoadError(e.message || "שגיאה בטעינה") })
  }, [authLoading, canAccess, loadMembers])

  // New view → top of the page (stage pages are long).
  useEffect(() => { window.scrollTo({ top: 0 }) }, [stageId, view, params.get("exp"), params.get("new"), params.get("for")])

  if (authLoading) return <CreatorsSkeleton />
  if (!user || !canAccess) return <AccessDenied signedIn={!!user} email={user?.email} />

  const go = (next) => setParams(next)
  const membersOf = (id) => (members || []).filter(m => m.topic_id === id)
  const myStages = new Set((members || []).filter(m => m.user_id === user?.id).map(m => m.topic_id))

  return (
    <div className="px-4 py-5 sm:p-6 lg:p-8 max-w-6xl mx-auto space-y-5">
      {view !== "stage" && (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-4">
          <div>
            <h1 className="text-[34px] sm:text-[40px] font-extrabold leading-none text-fg-strong flex items-center gap-2.5"><Code2 className="w-8 h-8" aria-hidden="true" /> מפתחים</h1>
            <p className="text-[14px] text-fg-muted mt-2 max-w-3xl">
              כל מה שאנחנו בונים לליגה — ניתוח וידאו, מודלים, תלת-ממד, מצלמות, האתר, האפליקציות והנתונים. בוחרים שלב, קוראים
              איך הגענו לכאן, ועושים משהו אמיתי ממש מכאן: מתייגים, סוקרים, מריצים ניסוי, מציעים פתרון.
            </p>
          </div>
          <div className="grid grid-cols-3 gap-2 sm:gap-3 max-w-xl">
            <Stat icon={Users} label="שלבים שלי" value={members ? myStages.size : null} />
            <Stat icon={MessageSquare} label="הודעות שלי" value={members ? noteStats.mine : null} />
            <Stat icon={Star} label="מחפשים עזרה" value={HELP_WANTED} />
          </div>
          <div className="flex gap-1 p-1 rounded-control bg-surface-sunken w-fit max-w-full overflow-x-auto [scrollbar-width:none]" role="tablist">
            <TabBtn active={view === "map"} onClick={() => go({})} icon={Workflow}>מפת המערכת</TabBtn>
            <TabBtn active={view === "exp"} onClick={() => go({ tab: "exp" })} icon={FlaskConical}>ניסויים</TabBtn>
            <TabBtn active={view === "tools"} onClick={() => go({ tab: "tools" })} icon={Wrench}>כלים</TabBtn>
          </div>
        </motion.div>
      )}

      {loadError && <div className="card p-3 text-sm text-red-600 dark:text-red-400">{loadError}</div>}

      {view === "stage" && (
        <StagePage key={stage.id} stageId={stage.id} members={membersOf(stage.id)}
          onBack={() => go({})} onOpen={(id) => go({ stage: id })} onExperiment={(k) => go({ tab: "exp", new: "1", ...(k ? { for: k } : {}) })}
          onMembersChange={loadMembers}
          onNotesChange={(d) => setNoteStats(s => ({
            mine: s.mine + d, perTopic: { ...s.perTopic, [stage.id]: (s.perTopic[stage.id] || 0) + d },
          }))} />
      )}
      {view === "map" && (
        <PipelineMap members={members} noteStats={noteStats} myStages={myStages} onOpen={(id) => go({ stage: id })} />
      )}
      {view === "exp" && (
        <Experiments expId={params.get("exp")} isNew={params.get("new") === "1"} newStage={params.get("for")}
          onOpen={(id) => go({ tab: "exp", exp: id })} onNew={() => go({ tab: "exp", new: "1" })}
          onBack={() => go({ tab: "exp" })} onStage={(id) => go({ stage: id })} />
      )}
      {view === "tools" && <Tools tool={TOOL_TABS.includes(tab) ? tab : null} onPick={(t) => go(t ? { tab: t } : { tab: "tools" })} />}
    </div>
  )
}

function Stat({ icon: Icon, label, value }) {
  return (
    <div className="card p-3 flex items-center gap-2.5 min-w-0">
      <Icon className="w-5 h-5 shrink-0" />
      <div className="min-w-0">
        {value === null ? <Skeleton className="h-5 w-6" /> : <div className="text-xl fl-num text-fg-strong leading-none" dir="ltr">{value}</div>}
        <div className="text-[11px] text-slate-500 dark:text-slate-400 truncate">{label}</div>
      </div>
    </div>
  )
}

function TabBtn({ active, onClick, icon: Icon, children }) {
  return (
    <button role="tab" aria-selected={active} onClick={onClick}
      className={`inline-flex items-center gap-1.5 min-h-[40px] px-3 sm:px-4 rounded-[10px] text-sm font-semibold whitespace-nowrap transition-colors ${active ? "bg-surface text-fg-strong shadow-sm" : "text-fg-muted hover:text-fg-strong"}`}>
      <Icon className="w-4 h-4" /> {children}
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
