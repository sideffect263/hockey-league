import { useState, useRef, useEffect } from "react"
import { Loader2, X, ImagePlus } from "lucide-react"
import { Person as User, Film as Video } from "@/components/icons/BrandIcons"
import { useAuth } from "@/lib/AuthContext"
import { createPost } from "@/lib/api"
import { uploadFeedVideo, MAX_FEED_VIDEO_MB } from "@/lib/feedVideo"
import { uploadFeedPhoto, MAX_FEED_PHOTO_MB } from "@/lib/feedPhoto"
import { setMentions, MENTION_KIND } from "@/lib/mentionsApi"
import MentionInput from "@/components/feed/MentionInput"
import GamePicker from "@/components/feed/GamePicker"

const MAX = 2000

function translatePostError(msg = "") {
  const m = msg.toLowerCase()
  if (m.includes("post_rate_limit")) return "אפשר לפרסם פוסט אחד ביום — נסו שוב מחר"
  if (m.includes("row-level security") || m.includes("policy") || m.includes("permission")) return "אין לך הרשאה לפרסם"
  if (m.includes("not authenticated")) return "יש להתחבר כדי לפרסם"
  if (m.includes("not_video")) return "הקובץ אינו סרטון"
  if (m.includes("not_image")) return "הקובץ אינו תמונה"
  if (m.includes("photo_too_big")) return `התמונה גדולה מדי (עד ${MAX_FEED_PHOTO_MB}MB)`
  if (m.includes("too_big")) return `הסרטון גדול מדי (עד ${MAX_FEED_VIDEO_MB}MB)`
  if (m.includes("forbidden") || m.includes("post_video_forbidden")) return "העלאת וידאו פתוחה למנהלים ולעורכי תוכן בלבד"
  if (m.includes("upload")) return "העלאת הסרטון נכשלה. נסו שוב"
  return "הפרסום נכשל. נסו שוב"
}

/**
 * The composer (Composer board). `onCancel` set = the bottom-sheet form (ComposerSheet):
 * ביטול · פוסט חדש · פרסם on top, the amber upload bar under it. Without it, the inline
 * card it always was (kept for any page that embeds it).
 */
export default function Composer({ onPosted, autoFocus = false, onCancel = null }) {
  const { user, canPost, openAuth, isAdmin, isContentEditor, profile } = useAuth()
  const [body, setBody] = useState("")
  const [picks, setPicks] = useState([])          // @player tags chosen in this draft
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  // Video post (admins / content editors): the chosen file, its local preview, upload progress.
  const canVideo = isAdmin || isContentEditor
  const fileRef = useRef(null)
  const [file, setFile] = useState(null)
  const [preview, setPreview] = useState(null)
  const [progress, setProgress] = useState(null)
  // Photo post (any staff): one photo, shrunk + uploaded at publish time (feedPhoto.js).
  const photoRef = useRef(null)
  const [photo, setPhoto] = useState(null)
  const [photoPreview, setPhotoPreview] = useState(null)
  // Editors post as the league account by default (same author as every /creators publish).
  const [asLeague, setAsLeague] = useState(true)
  // "שייך למשחק" — any kind of post can belong to a game (shown on the game page).
  const [gameId, setGameId] = useState("")
  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview) }, [preview])
  useEffect(() => () => { if (photoPreview) URL.revokeObjectURL(photoPreview) }, [photoPreview])

  const pickFile = (e) => {
    const f = e.target.files?.[0]
    e.target.value = ""
    if (!f) return
    setError(null)
    if (!f.type.startsWith("video/")) { setError(translatePostError("not_video")); return }
    if (f.size > MAX_FEED_VIDEO_MB * 1024 * 1024) { setError(translatePostError("too_big")); return }
    setFile(f); setPreview(URL.createObjectURL(f))
  }
  const clearFile = () => { setFile(null); setPreview(null); setProgress(null) }
  const pickPhoto = (e) => {
    const f = e.target.files?.[0]
    e.target.value = ""
    if (!f) return
    setError(null)
    if (!f.type.startsWith("image/")) { setError(translatePostError("not_image")); return }
    if (f.size > MAX_FEED_PHOTO_MB * 1024 * 1024) { setError(translatePostError("photo_too_big")); return }
    clearFile()
    setPhoto(f); setPhotoPreview(URL.createObjectURL(f))
  }
  const clearPhoto = () => { setPhoto(null); setPhotoPreview(null) }

  const initial = (profile?.display_name || user?.email || "").trim().charAt(0).toUpperCase() || null

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
      const imageUrl = photo ? await uploadFeedPhoto(photo) : null
      const newPost = await createPost({ body: text, video, imageUrl, gameId: gameId || null, asLeague: canVideo && asLeague })
      // Tags go on AFTER the post exists; if that fails the post stays and we say so.
      let tags = []
      if (picks.length) {
        try { tags = await setMentions(MENTION_KIND.post, newPost.id, text, picks) }
        catch { setError("הפוסט פורסם, אבל התיוג נכשל") }
      }
      setBody("")
      setPicks([])
      setGameId("")
      clearFile()
      clearPhoto()
      onPosted && onPosted(newPost, tags)
    } catch (err) {
      setError(translatePostError(err?.message))
    } finally {
      setBusy(false)
      setProgress(null)
    }
  }

  const sheet = !!onCancel
  const publishLabel = busy && progress != null && progress < 1 ? `מעלה ${Math.round(progress * 100)}%` : "פרסם"
  const publishBtn = (
    <button
      onClick={submit}
      disabled={busy || !body.trim()}
      className="h-11 px-[18px] rounded-full bg-brand text-brand-fg text-[14.5px] font-extrabold hover:bg-brand-hover transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
    >
      {busy && <Loader2 className="w-4 h-4 animate-spin" />}
      {publishLabel}
    </button>
  )

  return (
    <div className={sheet ? "flex flex-col gap-3" : "card p-4"}>
      {sheet && (
        <>
          <div className="flex items-center justify-between">
            <button type="button" onClick={onCancel} disabled={busy} className="min-h-[44px] px-1.5 text-[15px] font-semibold text-fg-muted disabled:opacity-50">ביטול</button>
            <h2 className="text-[18px] font-extrabold text-fg-strong">פוסט חדש</h2>
            {publishBtn}
          </div>
          {progress != null && (
            <div className="h-1 rounded-full bg-surface-sunken overflow-hidden" role="progressbar" aria-label="העלאה"
                 aria-valuenow={Math.round(progress * 100)} aria-valuemin={0} aria-valuemax={100}>
              <div className="h-full bg-fl-accent transition-[width]" style={{ width: `${Math.round(progress * 100)}%` }} />
            </div>
          )}
        </>
      )}
      <div className="flex gap-3">
        <div className="w-10 h-10 rounded-full shrink-0 flex items-center justify-center font-bold text-brand-fg bg-brand">
          {initial || <User className="w-5 h-5" />}
        </div>
        <div className="flex-1 min-w-0">
          <MentionInput
            value={body}
            onChange={setBody}
            onPick={pk => setPicks(ps => [...ps, pk])}
            maxLength={MAX}
            placeholder={file ? "כיתוב לסרטון (חובה)…" : photo ? "כיתוב לתמונה (חובה)…" : "מה קורה בליגה? (@ לתיוג שחקן)"}
            rows={3}
            autoFocus={autoFocus}
            className={sheet
              ? "w-full resize-none bg-transparent border-0 px-0 py-1 text-[15.5px] leading-[1.5] text-fg-strong placeholder:text-fg-subtle focus:outline-none min-h-[90px]"
              : "w-full resize-none bg-surface-inset border border-line rounded-xl px-3 py-2.5 text-[14px] text-fg-strong placeholder:text-fg-subtle focus:outline-none focus:ring-2 focus:ring-brand/30 focus:border-brand transition-all"}
          />
          {photo && (
            <div className="mt-2 relative rounded-2xl overflow-hidden bg-black">
              <img src={photoPreview} alt="" className="w-full max-h-80 object-contain" />
              {!busy && (
                <button type="button" onClick={clearPhoto} aria-label="הסרת התמונה"
                  className="absolute top-2 left-2 size-11 rounded-full bg-black/55 hover:bg-black/80 text-white flex items-center justify-center">
                  <X className="w-4 h-4" />
                </button>
              )}
            </div>
          )}
          {file && (
            <div className="mt-2 space-y-2">
              <div className="relative rounded-2xl overflow-hidden bg-black">
                <video src={preview} controls muted playsInline className="w-full max-h-80 object-contain" />
                {!busy && (
                  <button type="button" onClick={clearFile} aria-label="הסרת הסרטון"
                    className="absolute top-2 left-2 size-11 rounded-full bg-black/55 hover:bg-black/80 text-white flex items-center justify-center">
                    <X className="w-4 h-4" />
                  </button>
                )}
              </div>
              {progress != null && !sheet && (
                <div className="h-1.5 rounded-full bg-surface-sunken overflow-hidden" role="progressbar"
                     aria-valuenow={Math.round(progress * 100)} aria-valuemin={0} aria-valuemax={100}>
                  <div className="h-full bg-fl-accent transition-[width]" style={{ width: `${Math.round(progress * 100)}%` }} />
                </div>
              )}
            </div>
          )}
          <div className="mt-2">
            <GamePicker value={gameId} onChange={id => setGameId(id)} disabled={busy} />
          </div>
          <p className="mt-1.5 text-[12px] leading-[1.45] text-fg-muted">פוסט ששויך למשחק מופיע בתוך פוסט המשחק בפיד ובעמוד המשחק.</p>
          {canVideo && (
            <label className="mt-2 min-h-[44px] flex items-center gap-2 text-[13px] text-fg select-none cursor-pointer">
              <input type="checkbox" checked={asLeague} onChange={e => setAsLeague(e.target.checked)} disabled={busy}
                className="w-4 h-4 rounded accent-brand" />
              פרסום בשם הליגה (ולא בשמך)
            </label>
          )}
          {error && <p role="alert" className="mt-2 text-[13px] text-neg font-medium">{error}</p>}
          <div className="mt-2 flex items-center justify-between">
            {sheet ? <span /> : publishBtn}
            <div className="flex items-center gap-1">
            {!file && !photo && (
              <>
                <input ref={photoRef} type="file" accept="image/*" className="hidden" onChange={pickPhoto} />
                <button type="button" onClick={() => photoRef.current?.click()}
                  className="inline-flex items-center gap-1.5 h-11 px-3.5 rounded-full border border-line bg-surface text-[13.5px] font-bold text-fg-strong hover:bg-surface-inset transition-colors">
                  <ImagePlus className="w-[18px] h-[18px]" /> תמונה
                </button>
              </>
            )}
            {canVideo && !file && !photo && (
              <>
                <input ref={fileRef} type="file" accept="video/*" className="hidden" onChange={pickFile} />
                <button type="button" onClick={() => fileRef.current?.click()}
                  className="inline-flex items-center gap-1.5 h-11 px-3.5 rounded-full border border-line bg-surface text-[13.5px] font-bold text-fg-strong hover:bg-surface-inset transition-colors">
                  <Video className="w-[22px] h-[22px]" /> וידאו
                </button>
              </>
            )}
            </div>
            {body.length >= MAX - 100 && (
              <span className="text-[12px] text-fg-subtle tabular-nums" dir="ltr">{body.length} / {MAX}</span>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
