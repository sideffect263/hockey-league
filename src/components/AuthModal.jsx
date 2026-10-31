import { useState, useEffect, useRef } from "react"
import { signInWithAppleWeb } from "@/lib/appleWeb"
import { useAuth } from "@/lib/AuthContext"
import { isPwnedPasswordError, PWNED_PASSWORD_MSG } from "@/lib/passwordErrors"
import { getTeams } from "@/lib/api"
import TeamLogo from "@/components/TeamLogo"
import { BrandIcon } from "@/components/icons/BrandIcons"
import WelcomeScene from "@/components/fl/account/WelcomeScene"
import SocialSignIn from "@/components/fl/account/SocialSignIn"
import { Glyph, Spinner } from "@/components/fl/account/AccountKit"

/**
 * Sign-in dialog in the Floodlight welcome look (board OnbWelcome, variant F "squad"):
 * the floodlit rink with the three traced players, "כל הליגה / בכיס שלך", the league's
 * crests, then Google first and e-mail under it (Apple only when the website has it).
 * Phones get the whole screen; desktop a centred night dialog.
 *
 * The auth logic is unchanged: Google / Apple OAuth, and e-mail + password sign-in,
 * sign-up (confirmation mail) and reset, with the same error mapping and the calm
 * "rate limit" state for the mailer's 429.
 */

function translateAuthError(msg = "") {
  const m = msg.toLowerCase()
  if (m.includes("invalid login")) return "אימייל או סיסמה שגויים"
  if (m.includes("email") && m.includes("invalid")) return "כתובת אימייל לא תקינה"
  if (m.includes("email not confirmed")) return "יש לאמת את כתובת המייל לפני ההתחברות"
  if (m.includes("already registered") || m.includes("already been registered")) return "כתובת המייל כבר רשומה"
  if (m.includes("password")) return "הסיסמה חייבת להכיל לפחות 6 תווים"
  if (m.includes("rate limit") || m.includes("too many")) return "יותר מדי ניסיונות. נסו שוב מאוחר יותר"
  return msg || "אירעה שגיאה. נסו שוב"
}

const nightInput = "w-full h-12 rounded-[14px] bg-[#161D27] border border-[#2C3644] px-3.5 text-[15px] text-white placeholder:text-[#8B95A3] focus:outline-none focus:border-white/60 focus:ring-2 focus:ring-fl-accent/60 transition-colors"

function NightField({ id, label, value, onChange, ...props }) {
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-[13px] font-bold text-[#D5DAE1]">{label}</label>
      <input id={id} {...props} value={value} onChange={(e) => onChange(e.target.value)} className={nightInput} />
    </div>
  )
}

const TITLES = {
  signin: { h: "כניסה עם אימייל", sub: "האימייל והסיסמה של החשבון שלכם" },
  signup: { h: "הרשמה עם אימייל", sub: "חשבון חדש בליגה. נשלח מייל לאימות" },
  forgot: { h: "איפוס סיסמה", sub: "נשלח אליכם קישור לבחירת סיסמה חדשה" },
}

const pressCls = "w-full h-[52px] rounded-2xl bg-white text-[#11161D] font-bold text-[15.5px] inline-flex items-center justify-center gap-2 hover:bg-[#F1F1F1] transition-colors disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-fl-accent focus-visible:ring-offset-2 focus-visible:ring-offset-[#070B10]"
const linkCls = "font-bold text-white underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-fl-accent rounded"

function Message({ icon, title, children, cta, onCta }) {
  return (
    <div className="flex-1 flex flex-col justify-center px-6 py-10 text-center">
      <span className="mx-auto mb-5 w-[76px] h-[76px] rounded-[22px] bg-[#FAF9F6] flex items-center justify-center">
        <BrandIcon name={icon} variant="large" className="w-12 h-12" />
      </span>
      <h2 id="auth-modal-title" className="text-[26px] font-black leading-tight">{title}</h2>
      <div className="mt-3 text-[15px] leading-relaxed text-[#D5DAE1] space-y-2">{children}</div>
      <button type="button" onClick={onCta} className={`${pressCls} mt-7`}>{cta}</button>
    </div>
  )
}

export default function AuthModal() {
  const { authOpen, closeAuth, signInWithEmail, signUpWithEmail, signInWithGoogle, resetPassword } = useAuth()
  const [view, setView] = useState("welcome") // 'welcome' | 'email'
  const [mode, setMode] = useState("signin") // 'signin' | 'signup' | 'forgot'
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [name, setName] = useState("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const [sent, setSent] = useState(null) // null | 'confirm' | 'ratelimit' | 'reset'
  const [teams, setTeams] = useState([])
  const [vh, setVh] = useState(() => (typeof window !== "undefined" ? window.innerHeight : 844))
  const panel = useRef(null)

  // Reset to the welcome view too: the trigger in the header says "התחברות", so
  // reopening after a close from the e-mail form must not land in that form.
  const close = () => {
    closeAuth()
    setView("welcome"); setMode("signin"); setError(null); setSent(null); setPassword("")
  }
  const switchMode = (m) => { setMode(m); setError(null); setSent(null) }
  const openEmail = () => { setView("email"); setError(null) }

  // Dialog behaviour: Esc closes (or steps back from the form), the page behind stops
  // scrolling, focus moves in and returns.
  useEffect(() => {
    if (!authOpen) return
    const prev = document.activeElement
    const onKey = (e) => { if (e.key === "Escape") close() }
    const onResize = () => setVh(window.innerHeight)
    const prevOverflow = document.body.style.overflow
    document.addEventListener("keydown", onKey)
    window.addEventListener("resize", onResize)
    document.body.style.overflow = "hidden"
    setVh(window.innerHeight)
    const t = setTimeout(() => panel.current?.focus({ preventScroll: true }), 30)
    return () => {
      clearTimeout(t)
      document.removeEventListener("keydown", onKey)
      window.removeEventListener("resize", onResize)
      document.body.style.overflow = prevOverflow
      prev?.focus?.({ preventScroll: true })
    }
  }, [authOpen]) // eslint-disable-line react-hooks/exhaustive-deps

  // The crest row: the league's real teams (public read), once.
  useEffect(() => {
    if (!authOpen || teams.length) return
    getTeams("name", true).then(t => setTeams((t || []).slice(0, 7))).catch(() => {})
  }, [authOpen, teams.length])

  // Move focus to the first field when the e-mail form opens.
  useEffect(() => {
    if (authOpen && view === "email") setTimeout(() => panel.current?.querySelector("input")?.focus(), 40)
  }, [authOpen, view, mode])

  if (!authOpen) return null

  // Supabase surfaces the built-in mailer's ~2/hr cap as an HTTP 429. Reframe it
  // as a calm "wait a moment" state instead of a scary red error.
  const isRateLimit = (err) =>
    err?.status === 429 || /rate limit|too many|429/i.test(err?.message || "")

  const submit = async (e) => {
    e.preventDefault()
    setBusy(true); setError(null)
    try {
      if (mode === "signup") {
        const data = await signUpWithEmail(email.trim(), password, name.trim())
        if (!data?.session) { setSent('confirm') } // confirmation email required
      } else if (mode === "forgot") {
        await resetPassword(email.trim())
        setSent('reset')
      } else {
        await signInWithEmail(email.trim(), password)
        // onAuthStateChange closes the modal on success
      }
    } catch (err) {
      if (isRateLimit(err)) setSent('ratelimit')
      else setError(isPwnedPasswordError(err) ? PWNED_PASSWORD_MSG : translateAuthError(err?.message))
    } finally {
      setBusy(false)
    }
  }

  // Phones: the scene shrinks on short screens so the buttons stay in view (iOS lesson #9).
  const sceneH = Math.max(250, Math.min(430, vh - 420))

  return (
    <div className="fixed inset-0 z-[100] flex items-stretch sm:items-center justify-center sm:p-6" dir="rtl">
      <div className="hidden sm:block absolute inset-0 bg-black/60 fl-fade-in" onClick={close} aria-hidden="true" />
      <div ref={panel} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby="auth-modal-title"
        className="relative w-full sm:max-w-[430px] sm:max-h-[min(92dvh,860px)] sm:rounded-[28px] overflow-y-auto overscroll-contain bg-[#070B10] text-white shadow-2xl outline-none flex flex-col fl-fade-in">

        <div className="absolute top-0 inset-x-0 z-10 flex items-center justify-between px-3 pt-[max(0.75rem,env(safe-area-inset-top))]">
          {view === "email" && !sent ? (
            <button type="button" onClick={() => { setView("welcome"); setError(null) }} aria-label="חזרה"
              className="size-11 rounded-full flex items-center justify-center text-white/85 hover:bg-white/10">
              <Glyph d="back" size={21} stroke={2.1} />
            </button>
          ) : <span />}
          <button type="button" onClick={close} aria-label="סגירה"
            className="size-11 rounded-full flex items-center justify-center text-white/75 hover:bg-white/10">
            <Glyph d="close" size={17} stroke={2.3} />
          </button>
        </div>

        {sent === 'confirm' ? (
          <Message icon="profile" title="כמעט על המגרש" cta="הבנתי" onCta={close}>
            <p>שלחנו קישור אימות ל־<bdi className="font-bold text-white">{email}</bdi>. לוחצים עליו, ואתם בהרכב.</p>
            <p className="text-[13px] text-[#8B95A3]">לא הגיע? הציצו בתיקיית הספאם.</p>
          </Message>
        ) : sent === 'ratelimit' ? (
          <Message icon="waiting" title="רגע, טיים־אאוט" cta="סבבה, אחכה" onCta={close}>
            <p>שלחנו כבר כמה מיילים בזמן קצר, והשרת ביקש חילוף. שבו על הספסל דקה־שתיים ונסו שוב.</p>
            <p className="text-[13px] text-[#8B95A3]">כבר קיבלתם מייל קודם? הקישור עדיין תקף, פשוט אשרו אותו.</p>
          </Message>
        ) : sent === 'reset' ? (
          <Message icon="reminder" title="בדקו את המייל" cta="הבנתי" onCta={close}>
            <p>אם קיים חשבון עבור <bdi className="font-bold text-white">{email}</bdi>, שלחנו אליו קישור לאיפוס הסיסמה. לוחצים עליו ובוחרים סיסמה חדשה.</p>
            <p className="text-[13px] text-[#8B95A3]">לא הגיע? הציצו בתיקיית הספאם.</p>
          </Message>
        ) : view === "welcome" ? (
          <>
            <WelcomeScene height={sceneH} offsetY={Math.max(0, 430 - sceneH) * 0.35} className="shrink-0" />
            <div className="relative -mt-14 px-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] flex flex-col gap-3">
              <h2 id="auth-modal-title" className="text-[42px] sm:text-[44px] font-black leading-[0.98] tracking-[-0.5px]">
                כל הליגה<br /><span className="text-fl-accent">בכיס שלך</span>
              </h2>
              <p className="text-[15.5px] leading-[1.45] text-[#D5DAE1]">ליגת הוקי גלגיליות: משחקים בשידור חי, כל הגולים, הטבלה והקבוצה שלך.</p>
              {teams.length > 0 && (
                <div aria-hidden="true" className="flex gap-1.5 mt-0.5 mb-2">
                  {teams.map(t => <TeamLogo key={t.id} team={t} px={40} className="ring-2 ring-[#070B10]" />)}
                </div>
              )}
              <SocialSignIn
                onGoogle={() => signInWithGoogle()}
                onApple={() => signInWithAppleWeb().catch(() => setError("ההתחברות עם Apple נכשלה. נסו שוב."))}
                onEmail={openEmail}
              />
              {error && <p role="alert" className="text-[13px] font-semibold text-[#FF8A7A] text-center">{error}</p>}
              {/* Each sign-in method is its own account unless linked: the Apple-in-the-app +
                  Google-here split is how a player ends up with two accounts. */}
              <p className="text-[12px] leading-relaxed text-[#8B95A3] text-center">כבר נרשמתם באפליקציה? היכנסו באותה דרך, אחרת ייפתח חשבון נפרד.</p>
              <button type="button" onClick={close}
                className="h-11 inline-flex items-center justify-center gap-1.5 text-[14.5px] font-bold text-white/85 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-fl-accent rounded-xl">
                להציץ בלי חשבון <Glyph d="chev" size={16} stroke={2.2} />
              </button>
            </div>
          </>
        ) : (
          <div className="px-5 pt-16 pb-[max(1.25rem,env(safe-area-inset-bottom))] flex flex-col">
            <h2 id="auth-modal-title" className="text-[30px] font-black leading-tight">{TITLES[mode].h}</h2>
            <p className="mt-1.5 text-[15px] text-[#D5DAE1]">{TITLES[mode].sub}</p>

            <form onSubmit={submit} className="mt-6 flex flex-col gap-3.5">
              {mode === "signup" && (
                <NightField id="auth-name" label="שם תצוגה" type="text" value={name} onChange={setName} autoComplete="name" placeholder="איך שיופיע בפוסטים ובתגובות" />
              )}
              <NightField id="auth-email" label="אימייל" type="email" dir="ltr" value={email} onChange={setEmail} required autoComplete="email" inputMode="email" />
              {mode !== "forgot" && (
                <NightField id="auth-pass" label="סיסמה" type="password" dir="ltr" value={password} onChange={setPassword} required minLength={6}
                  autoComplete={mode === "signin" ? "current-password" : "new-password"} placeholder="לפחות 6 תווים" />
              )}
              {mode === "signin" && (
                <button type="button" onClick={() => switchMode("forgot")} className="self-start -mt-1 h-9 text-[13px] font-semibold text-[#D5DAE1] hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-fl-accent rounded">
                  שכחתי סיסמה
                </button>
              )}
              {error && (
                <p role="alert" className="text-[13px] font-semibold text-[#FFB4A8] bg-[#3A1512] rounded-xl px-3.5 py-2.5">{error}</p>
              )}
              <button type="submit" disabled={busy} className={`${pressCls} mt-1`}>
                {busy && <Spinner />}
                {mode === "signin" ? "כניסה" : mode === "signup" ? "יצירת חשבון" : "שליחת קישור לאיפוס"}
              </button>
            </form>

            <p className="text-center text-[13.5px] text-[#D5DAE1] mt-6">
              {mode === "signin" ? (
                <>אין לכם חשבון? <button type="button" onClick={() => switchMode("signup")} className={linkCls}>הרשמה</button></>
              ) : mode === "signup" ? (
                <>כבר יש לכם חשבון? <button type="button" onClick={() => switchMode("signin")} className={linkCls}>כניסה</button></>
              ) : (
                <>נזכרתם בסיסמה? <button type="button" onClick={() => switchMode("signin")} className={linkCls}>חזרה לכניסה</button></>
              )}
            </p>
          </div>
        )}
      </div>
    </div>
  )
}
