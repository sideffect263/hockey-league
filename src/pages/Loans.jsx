import { useState, useEffect, useCallback } from "react"
import { Link } from "react-router-dom"
import { Eye, Check, Loader2, LogIn } from "lucide-react"
import { Loan as Handshake, TrendUp as TrendingUp, Approved as ShieldCheck, InfoIcon as Info, MapPin, Hourglass, Goalkeeper, PlayerIcon } from "@/components/icons/BrandIcons"
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
      <div className="max-w-3xl mx-auto px-3 sm:px-6 py-6">
        <div className="fl-card p-8 text-center space-y-3">
          <Handshake className="w-14 h-14 mx-auto" />
          <h1 className="text-[26px] font-extrabold text-fg-strong">השאלות למשחקים</h1>
          <p className="text-[14px] text-fg-soft">התחברו כדי לראות אילו קבוצות מחפשות שחקנים.</p>
          <button onClick={() => openAuth?.()} className="btn-primary min-h-[48px] px-6">
            <LogIn className="w-4 h-4" /> התחברות
          </button>
        </div>
      </div>
    )
  }

  if (!elig || !board) {
    return (
      <div className="max-w-3xl mx-auto px-3 sm:px-6 py-6 space-y-3" aria-busy={!err}>
        {err
          ? <p className="fl-card p-6 text-sm text-neg">{err}</p>
          : <>
              <div className="flex items-center gap-2.5 px-1"><span className="skeleton w-10 h-10 rounded-full" /><span className="skeleton h-7 w-48 rounded-lg" /></div>
              <span className="skeleton block h-4 w-4/5 rounded mx-1" />
              {[0, 1, 2].map(i => <span key={i} className="skeleton block h-40 rounded-card" />)}
            </>}
      </div>
    )
  }

  const canAct = elig.eligible
  const preview = !canAct && elig.viewer
  // Not a loan-eligible player and not a coach/manager: say who the page is for, nothing else.
  if (!canAct && !preview && elig.reason !== "no_dob") {
    return (
      <div className="max-w-3xl mx-auto px-3 sm:px-6 py-6">
        <div className="fl-card p-8 text-center space-y-3">
          <Handshake className="w-14 h-14 mx-auto" />
          <h1 className="text-[26px] font-extrabold text-fg-strong">השאלות למשחקים</h1>
          <p className="text-[14px] text-fg-soft">{NOT_FOR_YOU[elig.reason] || NOT_FOR_YOU.too_old}</p>
        </div>
      </div>
    )
  }

  const isGk = elig.position === "Goalkeeper"

  const ask = async (c) => {
    setBusy(c.game_id + c.team_id)
    try {
      await askToJoinLoan(c.game_id, c.team_id)
      setMsg(m => ({ ...m, [c.game_id + c.team_id]: "הבקשה נשלחה למאמן/ת" }))
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

  // What this viewer can do about one call — exactly one of these applies. Board Loans:
  // a full-width 46px button; quiet states are a sunken pill of the same size.
  const quiet = (children, tone = "text-fg-muted") => (
    <span className={`w-full min-h-[46px] rounded-control bg-surface-page flex items-center justify-center gap-1.5 px-3 text-[14px] font-bold text-center ${tone}`}>{children}</span>
  )
  const actionFor = (c) => {
    const key = c.game_id + c.team_id
    if (c.my_request_status === "accepted") return quiet(<><Check className="w-4 h-4" /> את/ה בסגל</>, "text-pos")
    if (c.my_request_status === "pending" && c.my_request_by === "player") return (
      <div className="w-full flex items-center gap-2">
        {quiet(<><Hourglass className="w-4 h-4" /> ביקשת · ממתין למאמן/ת</>)}
        <button onClick={() => cancel(c)} disabled={busy === key} className="shrink-0 min-h-[46px] px-3 text-[13px] font-semibold text-fg-muted underline underline-offset-2">ביטול</button>
      </div>
    )
    if (c.my_request_status === "pending") return quiet("הוזמנת · למעלה")
    if (preview) return quiet("תצוגה בלבד")
    if (elig.reason === "no_dob") return quiet("צריך תאריך לידה בכרטיס")
    const wanted = isGk ? c.need_gk : c.need_field
    if (!wanted) return quiet(isGk ? "מחפשים שחקן שדה" : "מחפשים שוער")
    if (c.my_block) return quiet(c.my_block === "own_player" ? "הקבוצה שלך" : LOAN_BLOCK_LABEL[c.my_block] || c.my_block)
    return (
      <button onClick={() => ask(c)} disabled={busy === key}
        className="w-full h-[46px] rounded-control bg-brand text-brand-fg text-[14.5px] font-bold inline-flex items-center justify-center gap-1.5 disabled:opacity-50">
        {busy === key && <Loader2 className="w-4 h-4 animate-spin" />} אני רוצה לשחק
      </button>
    )
  }

  const when = (d) => new Date(d).toLocaleString("he-IL", { weekday: "long", day: "numeric", month: "numeric", hour: "2-digit", minute: "2-digit" })

  return (
    <div className="max-w-5xl mx-auto px-3 sm:px-6 pt-4 sm:pt-6 pb-8">
      <header className="flex items-center gap-2.5 px-1 pb-1.5">
        <Handshake className="w-10 h-10" variant="large" />
        <h1 className="text-[26px] sm:text-[30px] font-extrabold text-fg-strong leading-tight">השאלות למשחקים</h1>
      </header>
      <p className="px-1 pb-3 text-[13.5px] leading-relaxed text-fg-soft max-w-2xl">
        קבוצות שחסרים להן שחקנים למשחק מחפשות כאן. לשחקני הנוער ולשוערים: השאלה היא למשחק אחד בלבד, ואתם מחליטים אם להגיע.
      </p>

      <div className="lg:grid lg:grid-cols-[minmax(0,1fr)_340px] lg:gap-6 lg:items-start space-y-4 lg:space-y-0">
        <div className="space-y-4 min-w-0">
          {preview && (
            <p className="fl-card p-3.5 flex items-start gap-2.5 text-[13px] text-fg-soft">
              <Eye className="w-4 h-4 shrink-0 mt-0.5" />
              תצוגת מאמן/ת — כך השחקנים רואים את העמוד. כדי לפרסם שהקבוצה מחפשת שחקנים, פתחו את עמוד המשחק ← זמינות למשחק ← השאלת שחקנים.
            </p>
          )}
          {elig.reason === "no_dob" && (
            <p className="fl-card p-3.5 flex items-start gap-2.5 text-[13px] text-fg-strong">
              <Info className="w-4 h-4 shrink-0 mt-0.5" />
              <span>כדי לבקש להצטרף צריך תאריך לידה בכרטיס השחקן. <Link to="/me" className="font-bold underline underline-offset-2">הוספה בדף שלי</Link></span>
            </p>
          )}

          {/* Invites addressed to him by name come first — they are waiting on HIS answer. */}
          {canAct && <LoanInvite compact />}

          <section aria-label="קבוצות מחפשות">
            <div className="flex items-baseline justify-between px-1.5 pb-2.5">
              <h2 className="text-[20px] font-extrabold text-fg-strong">קבוצות מחפשות</h2>
              {board.length > 0 && <span className="text-[12px] text-fg-muted"><span className="fl-num">{board.length}</span> משחקים</span>}
            </div>
            {board.length === 0 ? (
              <div className="fl-card p-6 text-center text-[14px] text-fg-muted">
                כרגע אף קבוצה לא מחפשת שחקנים. כשקבוצה תפרסם — {canAct ? "תקבלו הודעה." : "היא תופיע כאן."}
              </div>
            ) : (
              <div className="grid gap-2.5 md:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2">
                {board.map(c => {
                  const key = c.game_id + c.team_id
                  return (
                    <div key={key} className="fl-card p-3.5 flex flex-col gap-2.5">
                      <div className="flex items-center gap-3">
                        <TeamLogo team={{ name: c.team_name, logo_url: c.team_logo }} px={48} />
                        <div className="min-w-0 flex-1 flex flex-col gap-0.5">
                          <span className="text-[15.5px] font-extrabold text-fg-strong truncate">{c.team_name}</span>
                          <span className="text-[12.5px] text-fg-muted">
                            {when(c.game_date)} · <Link to={`/games/${c.game_id}`} className="hover:underline">{c.home_team} נגד {c.away_team}</Link>
                            {c.venue && <> · <MapPin className="inline w-3.5 h-3.5 -mt-0.5" /> {c.venue}</>}
                          </span>
                        </div>
                      </div>
                      <div className="flex items-center gap-1.5 flex-wrap">
                        {c.need_field && (
                          <span className="h-8 px-3 rounded-full bg-[#E4ECFB] text-[#0E3394] dark:bg-[#1D2A4A] dark:text-[#B9CCFF] inline-flex items-center gap-1.5 text-[12.5px] font-bold">
                            <PlayerIcon className="w-5 h-5" />
                            {c.field_slots === 1 ? "שחקן שדה אחד" : `${c.field_slots} שחקני שדה`}
                          </span>
                        )}
                        {c.need_gk && (
                          <span className="h-8 px-3 rounded-full bg-[#F6EBD3] text-[#7A5200] dark:bg-[#3A2E14] dark:text-[#F2CF85] inline-flex items-center gap-1.5 text-[12.5px] font-bold">
                            <Goalkeeper className="w-5 h-5" /> שוער
                          </span>
                        )}
                      </div>
                      {c.note && <p className="text-[13px] text-fg-soft leading-snug">„{c.note}”</p>}
                      {actionFor(c)}
                      {msg[key] && <p className="text-[13px] text-fg-soft">{msg[key]}</p>}
                    </div>
                  )
                })}
              </div>
            )}
          </section>
        </div>

        <aside className="space-y-3">
          <section aria-label="למה כדאי" className="grid gap-2.5 sm:grid-cols-3 lg:grid-cols-1">
            {WHY.map(({ icon: Icon, title, text }) => (
              <div key={title} className="fl-card p-3.5 space-y-1.5">
                <Icon className="w-6 h-6" />
                <p className="text-[14px] font-bold text-fg-strong">{title}</p>
                <p className="text-[13px] leading-relaxed text-fg-soft">{text}</p>
              </div>
            ))}
          </section>

          <section aria-label="מי יכול" className="fl-card p-3.5 space-y-2">
            <h2 className="flex items-center gap-2 text-[15px] font-extrabold text-fg-strong">
              <ShieldCheck className="w-4 h-4" /> מי יכול ואיך זה עובד
            </h2>
            <ul className="space-y-1.5 list-disc ps-5 text-[13px] leading-relaxed text-fg-soft">
              {RULES.map(r => <li key={r}>{r}</li>)}
            </ul>
          </section>
        </aside>
      </div>
    </div>
  )
}
