import { useState, useEffect, useCallback } from "react"
import { Link } from "react-router-dom"
import { motion } from "framer-motion"
import { Handshake, TrendingUp, Users, Eye, Check, Loader2, ShieldCheck, Info, LogIn } from "lucide-react"
import { CalendarDays, MapPin, Hourglass, Goalkeeper } from "@/components/icons/BrandIcons"
import { useAuth } from "@/lib/AuthContext"
import { useSeo } from "@/lib/seo"
import TeamLogo from "@/components/TeamLogo"
import LoanInvite from "@/components/LoanInvite"
import { getMyLoanEligibility, getLoanBoard, askToJoinLoan, cancelLoan, LOAN_BLOCK_LABEL, LOAN_FIELD_TARGET } from "@/lib/loans"

/**
 * השאלות למשחקים — the youth loan page (supabase/loan-calls.sql).
 *
 * For the players a senior team may borrow: field players whose date of birth proves
 * they are under 18, and goalkeepers of any age. It says why it is worth it, then lists
 * every team that raised a hand for a game ("we need a field player / a keeper") with
 * room still open, and lets the player ask to join. The team's coach approves.
 *
 * A coach / admin / league manager sees it read-only, so they know what the players see.
 * Anyone else is told who the page is for. The rules are enforced by the server either
 * way; this page only explains them.
 */

const WHY = [
  { icon: TrendingUp, title: "ניסיון שאי אפשר לקבל באימון",
    text: "משחק מלא מול שחקנים בוגרים — הקצב, הפיזיות וההחלטות של ליגת הבוגרים. זו הדרך המהירה ביותר להשתפר." },
  { icon: Handshake, title: "עוזרים לקבוצה לעלות למשחק",
    text: "כשלקבוצה חסרים שחקנים, אתם אלה שמאפשרים למשחק להתקיים. הקבוצה זוכרת את זה." },
  { icon: Eye, title: "רואים אתכם",
    text: "מאמנים מכל הליגה רואים אתכם משחקים, והשערים והבישולים נרשמים על שמכם בכרטיס השחקן." },
]

const RULES = [
  "מיועד לשחקני שדה עד גיל 18, ולשוערים בכל גיל.",
  "השאלה היא למשחק אחד בלבד — אתם נשארים בקבוצה שלכם.",
  "צריך אישור רפואי בתוקף ביום המשחק.",
  "המשחקים של הקבוצה שלכם קודמים: אי אפשר להצטרף למשחק בטווח של שעתיים ממשחק אחר שלכם.",
  `קבוצה משאילה רק עד שיש לה ${LOAN_FIELD_TARGET} שחקני שדה (ושוער אחד נוסף). אם שחקני הקבוצה עצמם נרשמים, המושאל שהצטרף אחרון מפנה את מקומו ומקבל הודעה.`,
  "המאמן/ת של הקבוצה מאשר/ת את הבקשה, ותקבלו הודעה.",
]

const NOT_FOR_YOU = {
  too_old:   "העמוד מיועד לשחקני שדה עד גיל 18 ולשוערים בכל גיל.",
  no_player: "כדי להשתמש בעמוד צריך לשייך את החשבון לכרטיס שחקן.",
}

export default function Loans() {
  useSeo({ title: "השאלות למשחקים", path: "/loans", noindex: true })
  const { user, openAuth } = useAuth()
  const [elig, setElig] = useState(null)
  const [board, setBoard] = useState(null)
  const [err, setErr] = useState(null)
  const [busy, setBusy] = useState(null)
  const [msg, setMsg] = useState({})
  const [tick, setTick] = useState(0)

  const reload = useCallback(() => setTick(t => t + 1), [])

  useEffect(() => {
    if (!user) return
    let alive = true
    Promise.all([getMyLoanEligibility(), getLoanBoard()])
      .then(([e, b]) => { if (alive) { setElig(e); setBoard(b) } })
      .catch(e => { if (alive) setErr(e.message) })
    return () => { alive = false }
  }, [user, tick])

  if (!user) {
    return (
      <div className="max-w-3xl mx-auto p-4 sm:p-6">
        <div className="card p-8 text-center space-y-3">
          <Handshake className="w-10 h-10 mx-auto text-brand" />
          <h1 className="page-title">השאלות למשחקים</h1>
          <p className="text-sm text-slate-600 dark:text-slate-300">התחברו כדי לראות אילו קבוצות מחפשות שחקנים.</p>
          <button onClick={() => openAuth?.()} className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-brand text-white text-sm font-semibold">
            <LogIn className="w-4 h-4" /> התחברות
          </button>
        </div>
      </div>
    )
  }

  if (!elig || !board) {
    return (
      <div className="max-w-3xl mx-auto p-4 sm:p-6">
        {err
          ? <p className="card p-6 text-sm text-red-600">{err}</p>
          : <p className="card p-6 flex items-center gap-2 text-sm text-slate-500"><Loader2 className="w-4 h-4 animate-spin" /> טוען…</p>}
      </div>
    )
  }

  const canAct = elig.eligible
  const preview = !canAct && elig.viewer
  // Not a loan-eligible player and not a coach/manager: say who the page is for, nothing else.
  if (!canAct && !preview && elig.reason !== "no_dob") {
    return (
      <div className="max-w-3xl mx-auto p-4 sm:p-6">
        <div className="card p-8 text-center space-y-3">
          <Handshake className="w-10 h-10 mx-auto text-brand" />
          <h1 className="page-title">השאלות למשחקים</h1>
          <p className="text-sm text-slate-600 dark:text-slate-300">{NOT_FOR_YOU[elig.reason] || NOT_FOR_YOU.too_old}</p>
        </div>
      </div>
    )
  }

  const isGk = elig.position === "Goalkeeper"

  const ask = async (c) => {
    setBusy(c.game_id + c.team_id)
    try {
      await askToJoinLoan(c.game_id, c.team_id)
      setMsg(m => ({ ...m, [c.game_id + c.team_id]: "✓ הבקשה נשלחה למאמן/ת" }))
      reload()
    } catch (e) {
      setMsg(m => ({ ...m, [c.game_id + c.team_id]: e.message }))
    } finally { setBusy(null) }
  }

  const cancel = async (c) => {
    setBusy(c.game_id + c.team_id)
    try { await cancelLoan(c.my_request_id); setMsg(m => ({ ...m, [c.game_id + c.team_id]: "הבקשה בוטלה" })); reload() }
    catch (e) { setMsg(m => ({ ...m, [c.game_id + c.team_id]: e.message })) }
    finally { setBusy(null) }
  }

  // What this viewer can do about one call — exactly one of these applies.
  const actionFor = (c) => {
    const key = c.game_id + c.team_id
    if (c.my_request_status === "accepted") return <span className="inline-flex items-center gap-1 text-xs font-bold text-emerald-600"><Check className="w-4 h-4" /> את/ה בסגל</span>
    if (c.my_request_status === "pending" && c.my_request_by === "player") return (
      <span className="flex items-center gap-2">
        <span className="inline-flex items-center gap-1 text-xs font-bold text-amber-600"><Hourglass className="w-4 h-4" /> ממתין לאישור המאמן/ת</span>
        <button onClick={() => cancel(c)} disabled={busy === key} className="text-[11px] text-slate-500 underline">ביטול</button>
      </span>
    )
    if (c.my_request_status === "pending") return <span className="text-xs font-bold text-brand">הוזמנת! אשר/י בראש העמוד</span>
    if (preview) return <span className="text-[11px] text-slate-400">תצוגה בלבד</span>
    if (elig.reason === "no_dob") return <span className="text-[11px] text-slate-500">צריך תאריך לידה בכרטיס</span>
    const wanted = isGk ? c.need_gk : c.need_field
    if (!wanted) return <span className="text-[11px] text-slate-400">{isGk ? "מחפשים שחקן שדה" : "מחפשים שוער"}</span>
    if (c.my_block) return (
      <span className="text-[10px] font-bold px-2 py-1 rounded bg-slate-100 text-slate-500 dark:bg-slate-700 dark:text-slate-300">
        {c.my_block === "own_player" ? "הקבוצה שלך" : LOAN_BLOCK_LABEL[c.my_block] || c.my_block}
      </span>
    )
    return (
      <button onClick={() => ask(c)} disabled={busy === key}
        className="inline-flex items-center gap-1.5 text-sm font-semibold px-4 py-2 rounded-lg bg-brand text-white hover:opacity-90 transition-opacity disabled:opacity-50">
        {busy === key ? <Loader2 className="w-4 h-4 animate-spin" /> : <Handshake className="w-4 h-4" />} אני רוצה לשחק
      </button>
    )
  }

  const when = (d) => new Date(d).toLocaleString("he-IL", { weekday: "long", day: "numeric", month: "numeric", hour: "2-digit", minute: "2-digit" })

  return (
    <div className="max-w-3xl mx-auto p-4 sm:p-6 space-y-5">
      <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}>
        <h1 className="page-title flex items-center gap-2.5"><Handshake className="w-7 h-7 text-brand" /> השאלות למשחקים</h1>
        <p className="page-subtitle mt-1">לשחקני הנוער ולשוערים — לעלות לשחק בליגת הבוגרים</p>
      </motion.div>

      {preview && (
        <p className="card p-3 flex items-start gap-2 text-xs text-slate-600 dark:text-slate-300">
          <Eye className="w-4 h-4 shrink-0 text-brand" />
          תצוגת מאמן/ת — כך השחקנים רואים את העמוד. כדי לפרסם שהקבוצה מחפשת שחקנים, פתחו את עמוד המשחק ← זמינות למשחק ← השאלת שחקנים.
        </p>
      )}
      {elig.reason === "no_dob" && (
        <p className="card p-3 flex items-start gap-2 text-xs text-amber-700 dark:text-amber-300">
          <Info className="w-4 h-4 shrink-0" />
          <span>כדי לבקש להצטרף צריך תאריך לידה בכרטיס השחקן. <Link to="/me" className="font-semibold underline">הוספה באזור האישי</Link></span>
        </p>
      )}

      {/* Invites addressed to him by name come first — they are waiting on HIS answer. */}
      {canAct && <LoanInvite compact />}

      <section className="grid gap-3 sm:grid-cols-3">
        {WHY.map(({ icon: Icon, title, text }) => (
          <div key={title} className="card p-4 space-y-1.5">
            <Icon className="w-6 h-6 text-brand" />
            <p className="text-sm font-bold text-slate-900 dark:text-white">{title}</p>
            <p className="text-xs leading-relaxed text-slate-600 dark:text-slate-300">{text}</p>
          </div>
        ))}
      </section>

      <section className="space-y-2">
        <h2 className="flex items-center gap-2 text-base font-bold text-slate-900 dark:text-white">
          <Users className="w-5 h-5 text-brand" /> קבוצות שמחפשות שחקנים
        </h2>
        {board.length === 0 ? (
          <div className="card p-6 text-center text-sm text-slate-500 dark:text-slate-400">
            כרגע אף קבוצה לא מחפשת שחקנים. כשקבוצה תפרסם — {canAct ? "תקבלו הודעה." : "היא תופיע כאן."}
          </div>
        ) : board.map(c => {
          const key = c.game_id + c.team_id
          return (
            <div key={key} className="card p-4 space-y-2.5">
              <div className="flex items-center gap-3">
                <TeamLogo team={{ name: c.team_name, logo_url: c.team_logo }} size={10} />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-bold text-slate-900 dark:text-white truncate">{c.team_name} מחפשת שחקנים</p>
                  <Link to={`/games/${c.game_id}`} className="text-xs text-slate-500 dark:text-slate-400 hover:underline">
                    {c.home_team} נגד {c.away_team}
                  </Link>
                </div>
              </div>
              <div className="flex items-center gap-x-3 gap-y-1 flex-wrap text-xs text-slate-600 dark:text-slate-300">
                <span className="inline-flex items-center gap-1"><CalendarDays className="w-3.5 h-3.5" /> {when(c.game_date)}</span>
                {c.venue && <span className="inline-flex items-center gap-1"><MapPin className="w-3.5 h-3.5" /> {c.venue}</span>}
              </div>
              <div className="flex items-center gap-1.5 flex-wrap">
                {c.need_field && (
                  <span className="text-[11px] font-bold px-2 py-0.5 rounded-full bg-brand/10 text-brand">
                    שחקני שדה · {c.field_slots === 1 ? "מקום אחד" : `${c.field_slots} מקומות`}
                  </span>
                )}
                {c.need_gk && <span className="text-[11px] font-bold px-2 py-0.5 rounded-full bg-brand/10 text-brand inline-flex items-center gap-1">שוער <Goalkeeper className="w-3.5 h-3.5" /></span>}
              </div>
              {c.note && <p className="text-xs text-slate-600 dark:text-slate-300">„{c.note}”</p>}
              <div className="flex items-center justify-end">{actionFor(c)}</div>
              {msg[key] && <p className="text-xs text-slate-600 dark:text-slate-300">{msg[key]}</p>}
            </div>
          )
        })}
      </section>

      <section className="card p-4 space-y-2">
        <h2 className="flex items-center gap-2 text-sm font-bold text-slate-900 dark:text-white">
          <ShieldCheck className="w-4 h-4 text-brand" /> איך זה עובד
        </h2>
        <ul className="space-y-1.5 list-disc ps-5 text-xs leading-relaxed text-slate-600 dark:text-slate-300">
          {RULES.map(r => <li key={r}>{r}</li>)}
        </ul>
      </section>
    </div>
  )
}
