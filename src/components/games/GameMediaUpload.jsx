import { useCallback, useEffect, useRef, useState } from "react"
import { UploadCloud, Image as ImageIcon, Loader2, Trash2, X, Lock } from "lucide-react"
import { ApprovedStatus as CheckCircle2, Warning as AlertTriangle, Film } from "@/components/icons/BrandIcons"
import { useAuth } from "@/lib/AuthContext"
import {
  canContributeGame, getGameUploads, deleteGameUpload, uploadGameVideo, uploadGameImage,
  MAX_GAME_VIDEO_MB, MAX_GAME_IMAGE_MB, streamThumbUrl,
} from "@/lib/gameStories"

/**
 * העלאת סרטונים ותמונות מהמשחק — coaches, the game's officials, league managers, editors and
 * admins (can_contribute_game) hand in raw footage of a game. Uploads stay private: the league's
 * pipeline analyses them into the game's timeline and highlights, and only what a published story
 * cites ever becomes public. Renders nothing for anyone else.
 */
export default function GameMediaUpload({ gameId }) {
  const { user, isAdmin, isContentEditor } = useAuth()
  const isEditor = isAdmin || isContentEditor
  const [allowed, setAllowed] = useState(false)
  const [queue, setQueue] = useState([])      // [{key, file, note, progress, state:'ready'|'uploading'|'done'|'error', error}]
  const [uploads, setUploads] = useState(null)
  const [drag, setDrag] = useState(false)
  const inputRef = useRef(null)

  useEffect(() => {
    let alive = true
    setAllowed(false)
    if (!user || !gameId) return
    canContributeGame(gameId).then(ok => { if (alive) setAllowed(ok) })
    return () => { alive = false }
  }, [user, gameId])

  const loadUploads = useCallback(() => {
    if (!allowed) return
    getGameUploads(gameId, { userId: isEditor ? undefined : user?.id }).then(setUploads).catch(() => setUploads([]))
  }, [allowed, gameId, isEditor, user?.id])
  useEffect(loadUploads, [loadUploads])

  if (!allowed) return null

  const addFiles = (files) => {
    const next = []
    for (const file of files) {
      const isVideo = file.type.startsWith("video/")
      const isImage = file.type.startsWith("image/")
      let error = null
      if (!isVideo && !isImage) error = "רק סרטונים או תמונות"
      else if (isVideo && file.size > MAX_GAME_VIDEO_MB * 1024 * 1024) error = `הסרטון גדול מ־${MAX_GAME_VIDEO_MB}MB — קצרו אותו או חלקו לכמה קבצים`
      else if (isImage && file.size > MAX_GAME_IMAGE_MB * 1024 * 1024) error = `התמונה גדולה מ־${MAX_GAME_IMAGE_MB}MB`
      next.push({ key: `${file.name}:${file.size}:${file.lastModified}:${Math.random()}`, file, note: "", progress: 0, state: error ? "error" : "ready", error, fatal: !!error })
    }
    setQueue(q => [...q, ...next])
  }

  const patch = (key, p) => setQueue(q => q.map(x => (x.key === key ? { ...x, ...p } : x)))

  const uploadOne = async (item) => {
    patch(item.key, { state: "uploading", progress: 0, error: null })
    const onProgress = (p) => patch(item.key, { progress: p })
    try {
      if (item.file.type.startsWith("video/")) await uploadGameVideo(gameId, item.file, { note: item.note.trim(), onProgress })
      else await uploadGameImage(gameId, item.file, { userId: user.id, note: item.note.trim(), onProgress })
      patch(item.key, { state: "done", progress: 1 })
    } catch (e) {
      patch(item.key, { state: "error", error: ERRORS[e.message] || "ההעלאה נכשלה — נסו שוב" })
    }
  }

  const uploadAll = async () => {
    const pending = queue.filter(canSend)
    for (const item of pending) await uploadOne(item) // one at a time: phones on venue wifi
    loadUploads()
  }

  const busy = queue.some(x => x.state === "uploading")
  const ready = queue.filter(canSend).length

  const onDrop = (e) => {
    e.preventDefault(); setDrag(false)
    if (e.dataTransfer?.files?.length) addFiles([...e.dataTransfer.files])
  }

  return (
    <section className="card p-4 sm:p-5 space-y-4" aria-labelledby="game-media-upload-title">
      <div>
        <h2 id="game-media-upload-title" className="flex items-center gap-2 text-[20px] font-extrabold leading-tight text-fg-strong">
          <UploadCloud className="w-5 h-5 text-brand" /> העלאת סרטונים ותמונות מהמשחק
        </h2>
        <p className="mt-1 text-xs leading-5 text-fg-muted flex gap-1.5">
          <Lock className="w-3.5 h-3.5 shrink-0 mt-0.5" />
          <span>ההעלאות פרטיות — חומר גלם שהמערכת של הליגה הופכת לציר הזמן של המשחק ולתקצירים. רק קטע שמשמש בסיפור שפורסם הופך לציבורי.</span>
        </p>
      </div>

      <div
        onDragOver={(e) => { e.preventDefault(); setDrag(true) }}
        onDragLeave={() => setDrag(false)}
        onDrop={onDrop}
        className={`rounded-xl border-2 border-dashed p-5 text-center transition-colors ${drag ? "border-brand bg-brand/5" : "border-line bg-surface-sunken/40"}`}
      >
        <p className="text-sm font-semibold text-fg-strong">גררו לכאן סרטונים ותמונות</p>
        <p className="text-[11px] text-fg-muted mt-1">עד {MAX_GAME_VIDEO_MB}MB לסרטון · עד {MAX_GAME_IMAGE_MB}MB לתמונה · אפשר כמה קבצים יחד</p>
        <button type="button" onClick={() => inputRef.current?.click()} className="btn-secondary mt-3 inline-flex items-center gap-1.5">
          <UploadCloud className="w-4 h-4" /> בחירת קבצים
        </button>
        <input ref={inputRef} type="file" accept="video/*,image/*" multiple className="hidden"
          onChange={(e) => { addFiles([...(e.target.files || [])]); e.target.value = "" }} />
      </div>

      {queue.length > 0 && (
        <ul className="space-y-2">
          {queue.map(item => (
            <QueueItem key={item.key} item={item}
              onNote={(note) => patch(item.key, { note })}
              onRemove={() => setQueue(q => q.filter(x => x.key !== item.key))} />
          ))}
        </ul>
      )}
      {queue.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" onClick={uploadAll} disabled={busy || ready === 0} className="btn-primary inline-flex items-center gap-1.5">
            {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <UploadCloud className="w-4 h-4" />}
            {busy ? "מעלה…" : `העלאה${ready > 1 ? ` (${ready})` : ""}`}
          </button>
          {!busy && queue.some(x => x.state === "done" || x.state === "error") && (
            <button type="button" onClick={() => setQueue(q => q.filter(x => x.state === "ready" || x.state === "uploading"))}
              className="text-xs font-semibold text-fg-muted hover:underline">ניקוי הרשימה</button>
          )}
        </div>
      )}

      <div className="pt-1">
        <h3 className="text-sm font-bold text-fg-strong mb-2">{isEditor ? "כל ההעלאות למשחק" : "ההעלאות שלי"}</h3>
        {uploads === null ? (
          <div className="flex justify-center py-3"><Loader2 className="w-4 h-4 animate-spin text-fg-subtle" /></div>
        ) : uploads.length === 0 ? (
          <p className="text-xs text-fg-muted">עדיין לא הועלו קבצים.</p>
        ) : (
          <ul className="divide-y divide-line rounded-lg border border-line overflow-hidden">
            {uploads.map(u => (
              <UploadRow key={u.id} row={u} canDelete={isEditor || u.uploaded_by === user?.id}
                onDeleted={() => setUploads(list => list.filter(x => x.id !== u.id))} />
            ))}
          </ul>
        )}
      </div>
    </section>
  )
}

const ERRORS = {
  too_big: "הקובץ גדול מדי",
  forbidden: "אין הרשאה להעלות למשחק הזה",
  not_played: "המשחק עוד לא שוחק",
  rate_limited: "הגעתם למגבלת ההעלאות להיום",
  bad_type: "סוג הקובץ לא נתמך (JPG / PNG / WEBP / HEIC)",
  upload_url_failed: "לא הצלחנו להתחיל את ההעלאה — נסו שוב",
  upload_failed: "ההעלאה נקטעה — נסו שוב",
  register_failed: "הקובץ עלה אבל לא נרשם — נסו שוב",
}

const canSend = (x) => x.state === "ready" || (x.state === "error" && !x.fatal)

const fmtMB = (b) => `${(b / 1024 / 1024).toFixed(b > 10 * 1024 * 1024 ? 0 : 1)}MB`

function QueueItem({ item, onNote, onRemove }) {
  const isVideo = item.file.type.startsWith("video/")
  const Icon = isVideo ? Film : ImageIcon
  return (
    <li className="rounded-lg border border-line bg-surface p-3 space-y-2">
      <div className="flex items-center gap-2 min-w-0">
        <Icon className="w-4 h-4 shrink-0 text-fg-muted" />
        <span className="text-sm font-semibold text-fg-strong truncate min-w-0 flex-1" dir="auto">{item.file.name}</span>
        <span dir="ltr" className="text-[11px] text-fg-subtle tabular-nums shrink-0">{fmtMB(item.file.size)}</span>
        {item.state === "done" && <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" aria-label="הועלה" />}
        {item.state !== "uploading" && item.state !== "done" && (
          <button type="button" onClick={onRemove} className="p-1 rounded text-fg-subtle hover:text-fg-strong shrink-0" aria-label="הסרה מהרשימה">
            <X className="w-4 h-4" />
          </button>
        )}
      </div>
      {item.state === "ready" && (
        <input value={item.note} onChange={(e) => onNote(e.target.value)} maxLength={500}
          placeholder={isVideo ? "מה רואים בסרטון? (לא חובה)" : "מה רואים בתמונה? (לא חובה)"}
          className="input w-full text-sm" />
      )}
      {(item.state === "uploading" || item.state === "done") && (
        <div className="h-1.5 rounded-full bg-surface-sunken overflow-hidden" role="progressbar"
          aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(item.progress * 100)}>
          <div className={`h-full transition-[width] duration-200 ${item.state === "done" ? "bg-emerald-500" : "bg-brand"}`}
            style={{ width: `${Math.max(3, Math.round(item.progress * 100))}%` }} />
        </div>
      )}
      {item.state === "error" && item.error && (
        <p className="flex items-center gap-1 text-xs font-semibold text-red-600 dark:text-red-400"><AlertTriangle className="w-4 h-4 shrink-0" /> {item.error}</p>
      )}
    </li>
  )
}

export const UPLOAD_STATUS = {
  uploaded: { label: "הועלה", cls: "bg-surface-sunken text-fg-muted" },
  processing: { label: "בעיבוד", cls: "bg-sky-100 text-sky-800 dark:bg-sky-900/40 dark:text-sky-300" },
  ready: { label: "מוכן", cls: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300" },
  error: { label: "שגיאה", cls: "bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300" },
}

export function UploadStatusChip({ status }) {
  const s = UPLOAD_STATUS[status] || UPLOAD_STATUS.uploaded
  return <span className={`inline-flex items-center rounded-md px-1.5 py-0.5 text-[10px] font-bold shrink-0 ${s.cls}`}>{s.label}</span>
}

function UploadRow({ row, canDelete, onDeleted }) {
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(null)
  const thumb = row.kind === "image" ? row.src : (row.status === "ready" ? streamThumbUrl(row, 1) : null)
  const del = async () => {
    if (!window.confirm("למחוק את הקובץ?")) return
    setBusy(true); setErr(null)
    try { await deleteGameUpload(row); onDeleted() } catch { setErr("המחיקה נכשלה"); setBusy(false) }
  }
  return (
    <li className="flex items-start gap-3 p-2.5 bg-surface">
      <div className="size-12 shrink-0 rounded-md bg-surface-sunken overflow-hidden flex items-center justify-center">
        {thumb ? <img src={thumb} alt="" loading="lazy" className="w-full h-full object-cover" />
          : row.kind === "video" ? <Film className="w-5 h-5 text-fg-subtle" /> : <ImageIcon className="w-5 h-5 text-fg-subtle" />}
      </div>
      <div className="min-w-0 flex-1 space-y-0.5">
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-sm font-semibold text-fg-strong truncate min-w-0" dir="auto">{row.title || (row.kind === "video" ? "סרטון" : "תמונה")}</span>
          <UploadStatusChip status={row.status} />
        </div>
        {row.note && <p className="text-xs text-fg-muted line-clamp-2">{row.note}</p>}
        {row.worker_note && <p className={`text-[11px] ${row.status === "error" ? "text-red-600 dark:text-red-400" : "text-fg-subtle"}`}>{row.worker_note}</p>}
        <p className="text-[10px] text-fg-subtle">{new Date(row.created_at).toLocaleString("he-IL", { timeZone: "Asia/Jerusalem", dateStyle: "short", timeStyle: "short" })}</p>
        {err && <p className="text-[11px] text-red-600">{err}</p>}
      </div>
      {canDelete && (
        <button type="button" onClick={del} disabled={busy} className="p-1.5 rounded text-fg-subtle hover:text-red-600 shrink-0" aria-label="מחיקה">
          {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
        </button>
      )}
    </li>
  )
}
