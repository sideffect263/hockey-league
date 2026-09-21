import { useState, useEffect, useCallback } from "react"
import { motion } from "framer-motion"
import { Camera, HelpCircle, Check, ExternalLink, RefreshCw, Send, CalendarDays } from "lucide-react"
import { Camera as CameraIcon } from "@/components/icons/HockeyIcons"
import { getMediaClusters, getSuggestionSummary, submitSuggestion, getResolvedCount } from "@/lib/media"
import { useAuth } from "@/lib/AuthContext"
import { MediaClustersSkeleton } from "@/components/skeletons/PageSkeletons"

const PAGE = 24

// Core crowd cluster-naming experience (header + info + grid), WITHOUT the
// standalone-page padding — so it renders both as the /media page (wrapped by
// Media below) and embedded inside the content-editors' "מדיה" tab.
export function MediaClusters() {
  const [clusters, setClusters] = useState([])
  const [summary, setSummary] = useState({})
  const [resolved, setResolved] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [visible, setVisible] = useState(PAGE)

  const load = useCallback(async () => {
    try {
      setLoading(true); setError(null)
      const [cl, sum, res] = await Promise.all([
        getMediaClusters({ status: "unresolved" }),
        getSuggestionSummary(),
        getResolvedCount(),
      ])
      setClusters(cl); setSummary(sum); setResolved(res)
    } catch (err) { console.error(err); setError("שגיאה בטעינת המדיה") }
    finally { setLoading(false) }
  }, [])

  useEffect(() => { load() }, [load])

  const bumpSummary = (key, name) => setSummary(s => {
    const cur = s[key] || { suggestion_count: 0, top_name: name }
    return { ...s, [key]: { ...cur, suggestion_count: cur.suggestion_count + 1 } }
  })

  if (loading) return <MediaClustersSkeleton />
  if (error) {
    return (
      <div className="card p-6 border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-950/30 flex flex-col items-center gap-3 min-h-[240px] justify-center text-center">
        <span className="text-red-700 dark:text-red-400 text-sm font-medium">{error}</span>
        <button onClick={load} className="flex items-center gap-1.5 px-3 py-1.5 bg-red-600 text-white rounded-lg text-xs font-semibold hover:bg-red-700 transition-colors">
          <RefreshCw className="w-3.5 h-3.5" /> נסה שוב
        </button>
      </div>
    )
  }

  return (
    <div className="space-y-5">
      <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}>
        <h1 className="page-title flex items-center gap-2.5">
          <CameraIcon className="w-7 h-7 text-brand" /> מדיה — זיהוי שחקנים
        </h1>
        <p className="page-subtitle mt-1">
          {clusters.length} שחקנים עדיין לא זוהו · {resolved} כבר זוהו
        </p>
      </motion.div>

      <div className="card p-4 text-sm text-slate-600 dark:text-slate-300 leading-relaxed">
        אספנו תמונות מהמשחקים וקיבצנו כל שחקן לפי הפנים שלו. עזרו לנו לזהות מי מופיע בכל קבוצת תמונות —
        פשוט כתבו שם פרטי ושם משפחה מתחת לתמונות. אפשר להציע גם בלי להתחבר.
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {clusters.slice(0, visible).map((c, i) => (
          <ClusterCard
            key={c.cluster_key}
            cluster={c}
            index={i}
            summary={summary[c.cluster_key]}
            onSubmitted={(name) => bumpSummary(c.cluster_key, name)}
          />
        ))}
      </div>

      {visible < clusters.length && (
        <div className="flex justify-center pt-2">
          <button onClick={() => setVisible(v => v + PAGE)}
            className="px-5 py-2.5 rounded-xl bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-200 text-sm font-semibold hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors">
            הצג עוד ({clusters.length - visible})
          </button>
        </div>
      )}
    </div>
  )
}

// Standalone /media page: wraps the shared core in the usual page chrome.
export default function Media() {
  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-6xl mx-auto">
      <MediaClusters />
    </div>
  )
}

function ClusterCard({ cluster, index, summary, onSubmitted }) {
  const { user, openAuth } = useAuth()
  const [first, setFirst] = useState("")
  const [last, setLast] = useState("")
  const [state, setState] = useState("idle") // idle | sending | done | error
  const [msg, setMsg] = useState(null)
  // Cover images are Google Photos links that expire; a dead one renders a broken-image
  // box on this public page, so collapse it to the same placeholder as a missing cover.
  const [coverError, setCoverError] = useState(false)

  const submit = async (e) => {
    e.preventDefault()
    if (!user) { openAuth(); return } // suggesting requires login (DB blocks anon)
    if (!first.trim() || !last.trim()) { setMsg("נא למלא שם פרטי ושם משפחה"); return }
    try {
      setState("sending"); setMsg(null)
      await submitSuggestion(cluster.cluster_key, first, last)
      onSubmitted?.(`${first.trim()} ${last.trim()}`)
      setState("done")
    } catch (err) {
      console.error(err); setState("error"); setMsg(err.message || "שגיאה בשליחה")
    }
  }

  const count = summary?.suggestion_count || 0

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}
      transition={{ delay: Math.min(index, 12) * 0.02 }}
      className="card overflow-hidden flex flex-col">
      <div className="relative bg-slate-900">
        {cluster.cover_url && !coverError
          ? <img src={cluster.cover_url} alt="פני שחקן לא מזוהה" onError={() => setCoverError(true)} className="w-full object-cover" loading="lazy" />
          : <div className="aspect-video flex items-center justify-center text-slate-500"><HelpCircle className="w-8 h-8" /></div>}
        <div className="absolute top-2 right-2 flex items-center gap-1 px-2 py-0.5 rounded-full bg-black/60 text-white text-[11px] font-medium backdrop-blur-sm">
          <HelpCircle className="w-3 h-3" /> {cluster.size} תמונות
        </div>
        {count > 0 && (
          <div className="absolute top-2 left-2 px-2 py-0.5 rounded-full bg-brand/90 text-white text-[11px] font-semibold">
            {count} {count === 1 ? "הצעה" : "הצעות"}
          </div>
        )}
      </div>

      <div className="p-3 flex flex-col gap-2 flex-1">
        {Array.isArray(cluster.albums) && cluster.albums.length > 0 && (
          <p className="flex items-center gap-1 text-[11px] text-slate-500 dark:text-slate-400">
            <CalendarDays className="w-3 h-3 shrink-0" />
            <span className="truncate">
              {cluster.albums[0].title}
              {cluster.albums.length > 1 ? ` +${cluster.albums.length - 1}` : ""}
            </span>
          </p>
        )}
        {count > 0 && summary?.top_name && (
          <p className="text-xs text-slate-500 dark:text-slate-400">
            הכי מוצע: <span className="font-semibold text-slate-700 dark:text-slate-200">{summary.top_name}</span>
          </p>
        )}

        {state === "done" ? (
          <div className="flex items-center gap-2 text-emerald-600 dark:text-emerald-400 text-sm font-medium py-2">
            <Check className="w-4 h-4" /> תודה! ההצעה נשמרה
          </div>
        ) : (
          <form onSubmit={submit} className="flex flex-col gap-2">
            <div className="flex gap-2">
              <input value={first} onChange={e => setFirst(e.target.value)} placeholder="שם פרטי" aria-label="שם פרטי"
                className="filter-input w-full text-sm" />
              <input value={last} onChange={e => setLast(e.target.value)} placeholder="שם משפחה" aria-label="שם משפחה"
                className="filter-input w-full text-sm" />
            </div>
            {msg && <span className="text-xs text-red-600 dark:text-red-400">{msg}</span>}
            <button type="submit" disabled={state === "sending"}
              className="flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-lg bg-brand text-white text-sm font-semibold hover:bg-brand-hover disabled:opacity-60 transition-colors">
              <Send className="w-3.5 h-3.5" /> {state === "sending" ? "שולח..." : "זה השחקן"}
            </button>
          </form>
        )}

        {cluster.source_detail_url && (
          <a href={cluster.source_detail_url} target="_blank" rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-xs text-slate-400 hover:text-brand transition-colors mt-auto pt-1">
            <ExternalLink className="w-3 h-3" /> צפו בתמונה המקורית
          </a>
        )}
      </div>
    </motion.div>
  )
}
