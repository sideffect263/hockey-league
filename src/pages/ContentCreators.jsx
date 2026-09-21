import { useState, useEffect } from "react"
import { useAuth } from "@/lib/AuthContext"
import { motion } from "framer-motion"
import {
  Images, Camera, Flag, FolderPlus, Send, ExternalLink,
  RefreshCw, Loader2, Check, Clock, Ban
} from "lucide-react"
import { Edit as EditIcon } from "@/components/icons/HockeyIcons"
import { getPlayers } from "@/lib/api"
import { MediaClusters } from "@/pages/Media"
import ClustersAdmin from "@/components/admin/ClustersAdmin"
import ReportsReview from "@/components/admin/ReportsReview"
import { submitAlbum, getAlbumSubmissions } from "@/lib/albums"
import { CreatorsSkeleton, SkeletonPanelRows } from "@/components/skeletons/PageSkeletons"

const tabs = [
  { id: "media", label: "מדיה", icon: Camera },
  { id: "clusters", label: "קבוצות תמונות", icon: Images },
  { id: "reports", label: "דיווחים", icon: Flag },
  { id: "albums", label: "אלבומים חדשים", icon: FolderPlus },
]

/**
 * Content-editors workspace. Gated to `isContentEditor || isAdmin` (raw editor
 * role OR admin — admins are not content editors via the flag, so both are
 * checked). Mirrors Admin.jsx's side-nav tab layout. All four tabs act through
 * the moderation / photo-override / cluster / album_submissions RLS policies that
 * now allow `is_admin() OR is_content_editor()`.
 */
export default function ContentCreators() {
  const { user, isAdmin, isContentEditor, loading: authLoading } = useAuth()
  const [activeTab, setActiveTab] = useState("media")
  const [players, setPlayers] = useState([])

  const canAccess = isContentEditor || isAdmin

  // ClustersAdmin needs the roster to assign faces to players.
  useEffect(() => {
    if (authLoading || !canAccess) return
    getPlayers().then(setPlayers).catch(() => setPlayers([]))
  }, [authLoading, canAccess])

  if (authLoading) return <CreatorsSkeleton />

  if (!user || !canAccess) {
    return <AccessDenied signedIn={!!user} email={user?.email} />
  }

  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-6xl mx-auto space-y-5">
      <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}>
        <h1 className="page-title flex items-center gap-2.5">
          <EditIcon className="w-7 h-7 text-brand" /> יוצרי תוכן
        </h1>
        <p className="page-subtitle mt-1">זיהוי שחקנים בתמונות, ניהול קבוצות תמונות, דיווחים ואלבומים חדשים</p>
      </motion.div>

      {/* Side-nav layout: vertical rail (right in RTL) on desktop, scrollable row on mobile */}
      <div className="lg:grid lg:grid-cols-[210px_minmax(0,1fr)] lg:gap-6 lg:items-start">
        <aside className="lg:sticky lg:top-20 self-start mb-4 lg:mb-0">
          <nav className="card p-2 flex lg:flex-col gap-1 overflow-x-auto lg:overflow-visible [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            {tabs.map(tab => {
              const active = activeTab === tab.id
              return (
                <button key={tab.id} onClick={() => setActiveTab(tab.id)}
                  className={`flex items-center gap-2.5 px-3 py-2.5 rounded-xl text-sm font-semibold transition-all whitespace-nowrap shrink-0 lg:w-full ${
                    active
                      ? "bg-brand text-white shadow-sm shadow-brand/25"
                      : "text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 hover:text-slate-900 dark:hover:text-white"
                  }`}>
                  <tab.icon className="w-4 h-4 shrink-0" />
                  <span>{tab.label}</span>
                </button>
              )
            })}
          </nav>
        </aside>

        <div className="min-w-0">
          {activeTab === "media" && <MediaClusters />}
          {activeTab === "clusters" && <ClustersAdmin players={players} />}
          {activeTab === "reports" && <ReportsReview />}
          {activeTab === "albums" && <AlbumSubmissions />}
        </div>
      </div>
    </div>
  )
}

function AccessDenied({ signedIn, email }) {
  const { signInWithGoogle } = useAuth()
  return (
    <div className="flex items-center justify-center min-h-[60vh]">
      <div className="card p-8 sm:p-12 text-center max-w-md mx-4">
        <Images className="w-16 h-16 text-slate-300 dark:text-slate-600 mx-auto mb-4" />
        <h1 className="text-xl font-bold text-slate-900 dark:text-white mb-2">אזור יוצרי תוכן</h1>
        {signedIn ? (
          <p className="text-sm text-slate-500 dark:text-slate-400 mb-6">
            החשבון {email} אינו מורשה לאזור יוצרי התוכן.
          </p>
        ) : (
          <>
            <p className="text-sm text-slate-500 dark:text-slate-400 mb-6">
              התחבר עם חשבון מורשה כדי לגשת לאזור יוצרי התוכן.
            </p>
            <button onClick={signInWithGoogle}
              className="flex items-center justify-center gap-3 w-full px-6 py-3 bg-white dark:bg-slate-800 border-2 border-slate-200 dark:border-slate-700 rounded-xl text-sm font-semibold text-slate-700 dark:text-slate-300 hover:border-brand hover:shadow-md transition-all">
              <svg className="w-5 h-5" viewBox="0 0 24 24">
                <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 01-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" fill="#4285F4"/>
                <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
                <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/>
                <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
              </svg>
              התחבר עם Google
            </button>
          </>
        )}
      </div>
    </div>
  )
}

/* ---- Album submissions: queue a Google-Photos album for offline processing ---- */

const STATUS_META = {
  pending:    { label: "ממתין",  cls: "bg-slate-100 text-slate-600 dark:bg-slate-700 dark:text-slate-300", Icon: Clock },
  processing: { label: "בעיבוד", cls: "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300", Icon: Loader2 },
  done:       { label: "הושלם",  cls: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300", Icon: Check },
  rejected:   { label: "נדחה",   cls: "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300", Icon: Ban },
}

function StatusPill({ status }) {
  const meta = STATUS_META[status] || STATUS_META.pending
  const { label, cls, Icon } = meta
  return (
    <span className={`shrink-0 inline-flex items-center gap-1 text-[11px] font-bold px-2 py-0.5 rounded-full ${cls}`}>
      <Icon className={`w-3 h-3 ${status === "processing" ? "animate-spin" : ""}`} /> {label}
    </span>
  )
}

const isValidUrl = (s) => { try { new URL(s); return true } catch { return false } }

function AlbumSubmissions() {
  const [url, setUrl] = useState("")
  const [note, setNote] = useState("")
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState(null)
  const [submissions, setSubmissions] = useState([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState(null)

  const load = async () => {
    try {
      setLoading(true); setLoadError(null)
      setSubmissions(await getAlbumSubmissions())
    } catch {
      setLoadError("שגיאה בטעינת האלבומים")
    } finally {
      setLoading(false)
    }
  }
  useEffect(() => { load() }, [])

  const submit = async (e) => {
    e.preventDefault()
    const trimmed = url.trim()
    if (!isValidUrl(trimmed)) { setFormError("נא להזין כתובת URL תקינה"); return }
    setSaving(true); setFormError(null)
    try {
      const row = await submitAlbum({ url: trimmed, note: note.trim() || null })
      setUrl(""); setNote("")
      // Optimistically prepend, then reconcile with a fresh load.
      setSubmissions(prev => [row, ...prev])
      load()
    } catch (err) {
      setFormError(err.message || "שליחה נכשלה")
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="flex items-center gap-2 text-lg font-bold text-slate-900 dark:text-white">
            <FolderPlus className="w-5 h-5 text-brand" /> אלבומים חדשים
          </h2>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-0.5">
            שליחת קישור לאלבום Google Photos להוספת תמונות חדשות
          </p>
        </div>
        <button onClick={load} className="flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-600 text-slate-500 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors">
          <RefreshCw className="w-3.5 h-3.5" /> רענון
        </button>
      </div>

      {/* Note: processing is offline, not instant. */}
      <div className="card p-4 text-sm text-slate-600 dark:text-slate-300 leading-relaxed border-brand/20 dark:border-brand/25 bg-brand/[0.06] dark:bg-brand/10">
        השליחות נכנסות לתור לעיבוד לא-מיידי — הורדת התמונות מהאלבום, זיהוי הפנים וקיבוצן לקבוצות תמונות חדשות
        נעשים באופן לא-מקוון. לכן אלבום שנשלח לא יופיע מיד, אלא לאחר העיבוד (הסטטוס יתעדכן ל״הושלם״).
      </div>

      <form onSubmit={submit} className="card p-4 space-y-3">
        <div>
          <label className="text-xs font-semibold text-slate-500 dark:text-slate-400 mb-1 block">קישור לאלבום</label>
          <input type="text" dir="ltr" value={url} onChange={e => setUrl(e.target.value)}
            placeholder="https://photos.google.com/share/..."
            className="filter-input w-full text-sm" />
        </div>
        <div>
          <label className="text-xs font-semibold text-slate-500 dark:text-slate-400 mb-1 block">הערה (רשות)</label>
          <input type="text" value={note} onChange={e => setNote(e.target.value)}
            placeholder="לדוגמה: משחק מול הפועל, 12/6"
            className="filter-input w-full text-sm" />
        </div>
        {formError && <p className="text-xs text-red-600 dark:text-red-400">{formError}</p>}
        <button type="submit" disabled={saving || !url.trim()}
          className="flex items-center gap-2 px-5 py-2.5 bg-brand text-white text-sm font-semibold rounded-xl hover:bg-brand-hover transition-colors disabled:opacity-50 disabled:cursor-not-allowed">
          {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
          {saving ? "שולח..." : "שליחת אלבום"}
        </button>
      </form>

      {/* Submitted albums list */}
      {loading ? (
        <SkeletonPanelRows />
      ) : loadError ? (
        <div className="card p-6 text-center space-y-3">
          <p className="text-sm font-medium text-red-600 dark:text-red-400">{loadError}</p>
          <button onClick={load} className="flex items-center gap-1.5 mx-auto text-xs font-semibold px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-600 text-slate-500 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors">
            <RefreshCw className="w-3.5 h-3.5" /> נסה שוב
          </button>
        </div>
      ) : submissions.length === 0 ? (
        <div className="card p-10 text-center">
          <FolderPlus className="w-10 h-10 mx-auto text-slate-300 dark:text-slate-600 mb-2" />
          <p className="text-sm font-medium text-slate-500 dark:text-slate-400">עדיין לא נשלחו אלבומים</p>
        </div>
      ) : (
        <div className="space-y-2.5">
          {submissions.map(s => (
            <div key={s.id} className="card p-4 flex items-center justify-between gap-3">
              <div className="min-w-0 flex-1">
                <a href={s.url} target="_blank" rel="noopener noreferrer" dir="ltr"
                  className="inline-flex items-center gap-1 text-sm font-semibold text-slate-700 dark:text-slate-200 hover:text-brand transition-colors truncate max-w-full">
                  <ExternalLink className="w-3.5 h-3.5 shrink-0" />
                  <span className="truncate">{s.url}</span>
                </a>
                {s.note && <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5 break-words">{s.note}</p>}
                <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
                  {new Date(s.created_at).toLocaleDateString("he-IL")}
                </p>
              </div>
              <StatusPill status={s.status} />
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
