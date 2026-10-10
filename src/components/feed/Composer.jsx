import { useState, useRef, useEffect } from "react"
import { User, Loader2, Video, X } from "lucide-react"
import { useAuth } from "@/lib/AuthContext"
import { createPost, getGames, getTeams } from "@/lib/api"
import { uploadFeedVideo, MAX_FEED_VIDEO_MB } from "@/lib/feedVideo"

const MAX = 2000

function translatePostError(msg = "") {
  const m = msg.toLowerCase()
  if (m.includes("post_rate_limit")) return "אפשר לפרסם פוסט אחד ביום — נסו שוב מחר 🙂"
  if (m.includes("row-level security") || m.includes("policy") || m.includes("permission")) return "אין לך הרשאה לפרסם"
  if (m.includes("not authenticated")) return "יש להתחבר כדי לפרסם"
  if (m.includes("not_video")) return "הקובץ אינו סרטון"
  if (m.includes("too_big")) return `הסרטון גדול מדי (עד ${MAX_FEED_VIDEO_MB}MB)`
  if (m.includes("forbidden") || m.includes("post_video_forbidden")) return "העלאת וידאו פתוחה למנהלים ולעורכי תוכן בלבד"
  if (m.includes("upload")) return "העלאת הסרטון נכשלה. נסו שוב"
  return "הפרסום נכשל. נסו שוב"
}

// Recent games for the "from which game?" picker on a video post: played or today, newest first.
async function recentGames() {
  const [games, teams] = await Promise.all([getGames("game_date", false), getTeams()])
  const name = Object.fromEntries((teams || []).map(t => [t.id, t.name]))
  const soon = Date.now() + 864e5
  return (games || [])
    .filter(g => new Date(g.game_date).getTime() < soon && !g.is_test)
    .slice(0, 25)
    .map(g => ({
      id: g.id,
      label: `${name[g.home_team_id] || "?"} – ${name[g.away_team_id] || "?"} · ${new Date(g.game_date).toLocaleDateString("he-IL", { day: "numeric", month: "numeric" })}`,
    }))
}

export default function Composer({ onPosted }) {
  const { user, canPost, openAuth, isAdmin, isContentEditor } = useAuth()
  const [body, setBody] = useState("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  // Video post (admins / content editors): the chosen file, its local preview, upload progress.
  const canVideo = isAdmin || isContentEditor
  const fileRef = useRef(null)
  const [file, setFile] = useState(null)
  const [preview, setPreview] = useState(null)
  const [progress, setProgress] = useState(null)
  const [games, setGames] = useState(null)
  const [gameId, setGameId] = useState("")
  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview) }, [preview])
  useEffect(() => {
    if (!file || games) return
    recentGames().then(setGames).catch(() => setGames([]))
  }, [file, games])

  const pickFile = (e) => {
    const f = e.target.files?.[0]
    e.target.value = ""
    if (!f) return
    setError(null)
    if (!f.type.startsWith("video/")) { setError(translatePostError("not_video")); return }
    if (f.size > MAX_FEED_VIDEO_MB * 1024 * 1024) { setError(translatePostError("too_big")); return }
    setFile(f); setPreview(URL.createObjectURL(f))
  }
  const clearFile = () => { setFile(null); setPreview(null); setProgress(null); setGameId("") }

  const initial = user?.email?.charAt(0)?.toUpperCase() || null

  // ---- Logged out: sign-in prompt ----
  if (!user) {
    return (
      <div className="card p-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-full shrink-0 flex items-center justify-center font-bold text-white bg-brand">
            <User className="w-5 h-5" />
          </div>
          <div className="flex-1 min-w-0 rounded-full bg-slate-100 dark:bg-slate-700/60 px-4 py-2.5 text-sm text-slate-500 dark:text-slate-400 select-none truncate">
            התחברו כדי לשתף עדכון…
          </div>
          <button type="button" disabled className="shrink-0 px-4 py-2 rounded-full bg-brand text-white text-sm font-semibold opacity-60 cursor-not-allowed">
            פרסם
          </button>
        </div>
        <div className="mt-3 flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
          <span>רוצים לפרסם? התחברו לחשבון</span>
          <button type="button" onClick={openAuth} className="font-semibold text-brand dark:text-brand-light hover:text-brand-hover dark:hover:text-brand-light transition-colors">
            התחברות
          </button>
        </div>
      </div>
    )
  }

  // ---- Signed in but not league staff: hide the composer entirely ----
  if (!canPost) return null

  // ---- Logged in: real composer ----
  const submit = async () => {
    const text = body.trim()
    if (!text || busy) return
    setBusy(true); setError(null)
    try {
      let video = null
      if (file) {
        setProgress(0)
        video = await uploadFeedVideo(file, setProgress)
      }
      const newPost = await createPost({ body: text, video, gameId: video ? (gameId || null) : null })
      setBody("")
      clearFile()
      onPosted && onPosted(newPost)
    } catch (err) {
      setError(translatePostError(err?.message))
    } finally {
      setBusy(false)
      setProgress(null)
    }
  }

  return (
    <div className="card p-4">
      <div className="flex gap-3">
        <div className="w-10 h-10 rounded-full shrink-0 flex items-center justify-center font-bold text-white bg-brand">
          {initial || <User className="w-5 h-5" />}
        </div>
        <div className="flex-1 min-w-0">
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value.slice(0, MAX))}
            placeholder={file ? "כיתוב לסרטון (חובה)…" : "מה קורה בליגה?"}
            rows={3}
            className="w-full resize-none bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl px-3 py-2.5 text-sm text-slate-800 dark:text-slate-100 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-brand/30 focus:border-brand transition-all"
          />
          {file && (
            <div className="mt-2 space-y-2">
              <div className="relative rounded-xl overflow-hidden bg-black">
                <video src={preview} controls muted playsInline className="w-full max-h-80 object-contain" />
                {!busy && (
                  <button type="button" onClick={clearFile} aria-label="הסרת הסרטון"
                    className="absolute top-2 end-2 w-8 h-8 rounded-full bg-black/60 hover:bg-black/80 text-white flex items-center justify-center">
                    <X className="w-4 h-4" />
                  </button>
                )}
              </div>
              <select value={gameId} onChange={e => setGameId(e.target.value)} disabled={busy}
                className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg px-2 py-2 text-sm text-slate-700 dark:text-slate-200">
                <option value="">ממשחק… (לא חובה)</option>
                {(games || []).map(g => <option key={g.id} value={g.id}>{g.label}</option>)}
              </select>
              {progress != null && (
                <div className="h-1.5 rounded-full bg-slate-200 dark:bg-slate-700 overflow-hidden" role="progressbar"
                     aria-valuenow={Math.round(progress * 100)} aria-valuemin={0} aria-valuemax={100}>
                  <div className="h-full bg-brand transition-[width]" style={{ width: `${Math.round(progress * 100)}%` }} />
                </div>
              )}
            </div>
          )}
          {error && <p className="mt-2 text-xs text-red-600 dark:text-red-400 font-medium">{error}</p>}
          <div className="mt-2 flex items-center justify-between">
            <button
              onClick={submit}
              disabled={busy || !body.trim()}
              className="px-5 py-2 rounded-full bg-brand text-white text-sm font-bold hover:bg-brand-hover transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
            >
              {busy && <Loader2 className="w-4 h-4 animate-spin" />}
              {busy && progress != null && progress < 1 ? `מעלה ${Math.round(progress * 100)}%` : "פרסם"}
            </button>
            {canVideo && !file && (
              <>
                <input ref={fileRef} type="file" accept="video/*" className="hidden" onChange={pickFile} />
                <button type="button" onClick={() => fileRef.current?.click()}
                  className="inline-flex items-center gap-1.5 px-3 py-2 rounded-full text-sm font-semibold text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors">
                  <Video className="w-4 h-4 text-red-500" /> וידאו
                </button>
              </>
            )}
            {body.length >= MAX - 100 && (
              <span className="text-[11px] text-slate-500 dark:text-slate-400">{body.length}/{MAX}</span>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
