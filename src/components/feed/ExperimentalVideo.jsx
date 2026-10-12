import { useEffect, useRef, useState } from "react"
import { AnimatePresence, motion } from "framer-motion"
import { FlaskConical, Star, X, Check } from "lucide-react"
import FeedVideo from "@/components/feed/FeedVideo"
import { surveyForPost, submitSurveyAnswers, dismissSurvey, missingRequired } from "@/lib/videoSurveys"

/**
 * A feed video that may be part of a video survey (supabase/video-surveys.sql).
 *
 * No active survey on this post (or a signed-out viewer) → exactly a plain FeedVideo.
 * Otherwise: an "experimental" badge on the frame, and once the viewer has actually
 * PLAYED `trigger_seconds` of it, a card slides open under the video with the survey's
 * questions. Answering or closing it records a row, so it never asks the same person
 * about the same video twice (on any device).
 *
 * The card sits under the frame rather than over it: a 16:9 video on a phone is ~200px
 * tall — stars + a text box + buttons would cover the very thing being rated.
 */
export default function ExperimentalVideo({ postId, ...videoProps }) {
  const [entry, setEntry] = useState(null)        // { survey, answered } | null
  const [open, setOpen] = useState(false)
  const [phase, setPhase] = useState("ask")       // ask | thanks | closed
  const watchedRef = useRef(0)

  useEffect(() => {
    let alive = true
    surveyForPost(postId).then(e => { if (alive) setEntry(e) }).catch(() => {})
    return () => { alive = false }
  }, [postId])

  const survey = entry?.survey
  const eligible = !!survey && !entry.answered && phase === "ask"

  const onWatchTime = eligible ? (secs) => {
    watchedRef.current = secs
    if (!open && secs >= (survey.trigger_seconds || 4)) setOpen(true)
  } : undefined

  return (
    <div>
      <FeedVideo {...videoProps} onWatchTime={onWatchTime}>
        {survey && (
          <span className="absolute top-2 start-2 z-10 inline-flex items-center gap-1 rounded-full bg-black/60 backdrop-blur-sm px-2.5 py-1 text-[11px] font-semibold text-amber-200 pointer-events-none">
            <FlaskConical className="w-3.5 h-3.5" /> {survey.badge_label || "ניסיוני"}
          </span>
        )}
      </FeedVideo>

      <AnimatePresence initial={false}>
        {survey && open && phase !== "closed" && (
          <motion.div
            key="survey"
            initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.25, ease: "easeOut" }}
            className="overflow-hidden"
          >
            {phase === "thanks" ? (
              <div className="mt-2 mx-4 sm:mx-0 rounded-xl border border-emerald-200 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-900/20 px-4 py-3 text-sm font-semibold text-emerald-700 dark:text-emerald-300 flex items-center gap-2">
                <Check className="w-4 h-4" /> תודה! המשוב שלך עוזר לנו לשפר.
              </div>
            ) : (
              <SurveyCard
                survey={survey}
                onSubmit={async (answers) => {
                  await submitSurveyAnswers(survey.id, postId, answers, watchedRef.current)
                  setPhase("thanks")
                  setTimeout(() => setPhase("closed"), 2500)
                }}
                onDismiss={() => {
                  setPhase("closed")
                  dismissSurvey(survey.id, postId, watchedRef.current).catch(() => {})
                }}
              />
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

function SurveyCard({ survey, onSubmit, onDismiss }) {
  const [answers, setAnswers] = useState({})
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const [missing, setMissing] = useState([])
  const set = (id, v) => { setAnswers(a => ({ ...a, [id]: v })); setMissing(m => m.filter(x => x !== id)) }

  const submit = async () => {
    const miss = missingRequired(survey.questions, answers)
    if (miss.length) { setMissing(miss); return }
    setBusy(true); setError(null)
    try { await onSubmit(answers) }
    catch { setError("השליחה נכשלה, נסו שוב") }
    finally { setBusy(false) }
  }

  return (
    <div role="dialog" aria-label={survey.title}
         className="mt-2 mx-4 sm:mx-0 rounded-xl border border-amber-200 dark:border-amber-800/60 bg-amber-50/70 dark:bg-amber-900/10 p-4 space-y-3">
      <div className="flex items-start gap-2">
        <FlaskConical className="w-4 h-4 mt-0.5 shrink-0 text-amber-600 dark:text-amber-400" />
        <p className="flex-1 text-sm text-slate-700 dark:text-slate-200 leading-relaxed">
          {survey.prompt || "נשמח לשמוע מה דעתך על הסרטון הזה"}
        </p>
        <button type="button" onClick={onDismiss} aria-label="סגירה"
                className="shrink-0 -m-1 p-1 rounded-full text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-black/5 dark:hover:bg-white/10">
          <X className="w-4 h-4" />
        </button>
      </div>

      {(survey.questions || []).map(q => (
        <div key={q.id}>
          <label className="block text-[13px] font-semibold text-slate-800 dark:text-slate-100 mb-1.5">
            {q.label}{q.required && <span className="text-red-500"> *</span>}
          </label>
          {q.type === "rating" ? (
            <StarRating value={answers[q.id] || 0} onChange={v => set(q.id, v)} />
          ) : (
            <textarea
              rows={2} maxLength={1000} value={answers[q.id] || ""} onChange={e => set(q.id, e.target.value)}
              placeholder="כתבו כאן…"
              className="w-full resize-y bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-600 rounded-lg px-3 py-2 text-sm text-slate-800 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-brand/30" />
          )}
          {missing.includes(q.id) && <p className="text-xs text-red-600 dark:text-red-400 mt-1">חובה למלא</p>}
        </div>
      ))}

      {error && <p className="text-xs text-red-600 dark:text-red-400">{error}</p>}
      <div className="flex items-center gap-2">
        <button type="button" onClick={submit} disabled={busy}
                className="px-4 py-2 rounded-lg bg-brand text-white text-sm font-semibold hover:bg-brand-hover transition-colors disabled:opacity-50">
          {busy ? "שולח…" : "שליחה"}
        </button>
        <button type="button" onClick={onDismiss}
                className="px-3 py-2 rounded-lg text-sm font-semibold text-slate-500 dark:text-slate-400 hover:bg-black/5 dark:hover:bg-white/10">
          לא עכשיו
        </button>
      </div>
    </div>
  )
}

const RATING_HINTS = ["", "לא עובד", "חלש", "בסדר", "טוב", "מעולה"]

function StarRating({ value, onChange }) {
  const [hover, setHover] = useState(0)
  const shown = hover || value
  return (
    <div className="flex items-center gap-2">
      <div className="flex items-center gap-0.5" dir="ltr" role="radiogroup" aria-label="דירוג 1 עד 5" onMouseLeave={() => setHover(0)}>
        {[1, 2, 3, 4, 5].map(n => (
          <button key={n} type="button" role="radio" aria-checked={value === n} aria-label={`${n} — ${RATING_HINTS[n]}`}
                  onClick={() => onChange(n)} onMouseEnter={() => setHover(n)}
                  className="p-1 rounded-md hover:scale-110 transition-transform">
            <Star className={`w-7 h-7 ${n <= shown ? "text-amber-400 fill-amber-400" : "text-slate-300 dark:text-slate-600"}`} />
          </button>
        ))}
      </div>
      {shown > 0 && <span className="text-xs font-semibold text-slate-500 dark:text-slate-400">{RATING_HINTS[shown]}</span>}
    </div>
  )
}
