import { useState } from "react"
import { Link } from "react-router-dom"
import { Send, Trash2, Loader2 } from "lucide-react"
import { Comment as MessageSquare } from "@/components/icons/BrandIcons"
import { useAuth } from "@/lib/AuthContext"
import { NOTE_KINDS, parseNote, relTime } from "@/lib/devs"
import { sizedImage } from "@/lib/imageSize"

export function Avatar({ profile, size = "w-8 h-8" }) {
  const name = profile?.display_name || "?"
  return profile?.avatar_url
    ? <img src={sizedImage(profile.avatar_url, 48)} alt="" className={`${size} rounded-full object-cover shrink-0 bg-slate-200 dark:bg-slate-700`} />
    : <span className={`${size} rounded-full shrink-0 bg-brand/15 text-brand dark:text-brand-light text-xs font-bold flex items-center justify-center`}>{name.trim().charAt(0) || "?"}</span>
}

// A rating note points at what it rated: [rate:story:<game_id>] / [rate:video:<post_id>].
function RatedLink({ args }) {
  const [type, id] = args
  if (!id) return null
  const to = type === "story" ? `/games/${id}` : type === "video" ? `/posts/${id}` : null
  if (!to) return null
  return <Link to={to} target="_blank" className="text-xs text-brand hover:underline">{type === "story" ? "לסיפור" : "לסרטון"}</Link>
}

/** The topic's discussion. `notes` + `profiles` are owned by the topic view (widgets post here too). */
export default function TopicThread({ notes, profiles, tasks = [], onPost, onDelete }) {
  const { user, isAdmin } = useAuth()
  const [text, setText] = useState("")
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(null)
  const taskTitle = Object.fromEntries(tasks.map(t => [t.id, t.title]))

  const submit = async (e) => {
    e.preventDefault()
    if (!text.trim()) return
    setBusy(true); setErr(null)
    try { await onPost(text); setText("") } catch (e2) { setErr(e2.message || "השליחה נכשלה") } finally { setBusy(false) }
  }

  return (
    <section className="card p-4 sm:p-5 space-y-4" aria-labelledby="thread-h">
      <h2 id="thread-h" className="flex items-center gap-2 font-bold text-slate-900 dark:text-white">
        <MessageSquare className="w-5 h-5 text-brand" /> שרשור
        <span className="text-xs font-semibold text-slate-400">{notes.length}</span>
      </h2>

      {notes.length === 0 ? (
        <p className="text-sm text-slate-500 dark:text-slate-400">עוד אין כאן הודעות. שאלה, רעיון או "אני על זה" — תהיו הראשונים.</p>
      ) : (
        <ul className="space-y-3">
          {notes.map(n => {
            const p = profiles[n.author_id]
            const { kind, args, text: body } = parseNote(n.body)
            const meta = kind ? NOTE_KINDS[kind] : null
            const canDelete = isAdmin || n.author_id === user?.id
            return (
              <li key={n.id} className="flex gap-2.5">
                <Avatar profile={p} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm font-semibold text-slate-900 dark:text-white">{p?.display_name || "מפתח/ת"}</span>
                    <span className="text-[11px] text-slate-400">{relTime(n.created_at)}</span>
                    {meta && <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full ${meta.cls}`}>{meta.label}</span>}
                    {kind === "rate" && <RatedLink args={args} />}
                    {canDelete && (
                      <button onClick={() => onDelete(n.id)} aria-label="מחיקת הודעה"
                        className="ms-auto p-1 rounded text-slate-400 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-950/30">
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                  {(kind === "claim" || kind === "done") && taskTitle[args[0]] && (
                    <p className="text-sm font-medium text-slate-700 dark:text-slate-200">{taskTitle[args[0]]}</p>
                  )}
                  {body && <p className="text-sm text-slate-700 dark:text-slate-300 whitespace-pre-wrap break-words mt-0.5">{body}</p>}
                </div>
              </li>
            )
          })}
        </ul>
      )}

      <form onSubmit={submit} className="space-y-2">
        <textarea value={text} onChange={e => setText(e.target.value)} rows={2} maxLength={4000}
          placeholder="כתבו הודעה לשרשור…" className="filter-input w-full text-sm resize-y min-h-[64px]" />
        {err && <p className="text-xs text-red-600 dark:text-red-400">{err}</p>}
        <button type="submit" disabled={busy || !text.trim()} className="btn-primary btn-sm gap-1.5 disabled:opacity-50">
          {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />} שליחה
        </button>
      </form>
    </section>
  )
}
