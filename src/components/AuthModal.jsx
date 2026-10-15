import { useState, useEffect } from "react"
import { APPLE_WEB_ENABLED, signInWithAppleWeb, AppleIcon } from "@/lib/appleWeb"
import { X, Mail, Lock, User, Loader2, Clock, KeyRound } from "lucide-react"
import { useAuth } from "@/lib/AuthContext"
import { isPwnedPasswordError, PWNED_PASSWORD_MSG } from "@/lib/passwordErrors"

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

function Field({ icon: Icon, value, onChange, ...props }) {
  return (
    <div className="relative">
      <Icon className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
      <input
        {...props}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl pr-9 pl-3 py-2.5 text-sm text-slate-800 dark:text-slate-100 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-brand/30 focus:border-brand transition-all"
      />
    </div>
  )
}

function GoogleIcon() {
  return (
    <svg className="w-4 h-4" viewBox="0 0 48 48" aria-hidden="true">
      <path fill="#EA4335" d="M24 9.5c3.5 0 6.6 1.2 9.1 3.6l6.8-6.8C35.6 2.4 30.1 0 24 0 14.6 0 6.4 5.4 2.6 13.2l7.9 6.2C12.3 13.3 17.7 9.5 24 9.5z" />
      <path fill="#4285F4" d="M46.5 24.5c0-1.6-.1-3.1-.4-4.5H24v9h12.7c-.5 3-2.2 5.5-4.7 7.2l7.3 5.7C43.8 37.5 46.5 31.5 46.5 24.5z" />
      <path fill="#FBBC05" d="M10.5 28.4c-.5-1.5-.8-3.1-.8-4.9s.3-3.4.8-4.9l-7.9-6.2C1 15.6 0 19.6 0 23.5s1 7.9 2.6 11.1l7.9-6.2z" />
      <path fill="#34A853" d="M24 47c6.1 0 11.3-2 15-5.5l-7.3-5.7c-2 1.4-4.7 2.3-7.7 2.3-6.3 0-11.7-3.8-13.5-9.4l-7.9 6.2C6.4 42.6 14.6 47 24 47z" />
    </svg>
  )
}

const TITLES = {
  signin: { h: "התחברות", sub: "התחברו לחשבון שלכם" },
  signup: { h: "הרשמה", sub: "הצטרפו לקהילת הליגה" },
  forgot: { h: "איפוס סיסמה", sub: "נשלח אליכם קישור לבחירת סיסמה חדשה" },
}

export default function AuthModal() {
  const { authOpen, closeAuth, signInWithEmail, signUpWithEmail, signInWithGoogle, resetPassword } = useAuth()
  const [mode, setMode] = useState("signin") // 'signin' | 'signup' | 'forgot'
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [name, setName] = useState("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const [sent, setSent] = useState(null) // null | 'confirm' | 'ratelimit' | 'reset'

  // Reset to sign-in too: the trigger in the header says "התחבר", so reopening
  // after a close from the signup/forgot form must not show that other form.
  const close = () => {
    closeAuth()
    setMode("signin"); setError(null); setSent(null); setPassword("")
  }
  const switchMode = (m) => { setMode(m); setError(null); setSent(null) }

  // Dialog behaviour: Esc closes it, and the page behind it stops scrolling.
  useEffect(() => {
    if (!authOpen) return
    const onKey = (e) => { if (e.key === "Escape") close() }
    const prevOverflow = document.body.style.overflow
    document.addEventListener("keydown", onKey)
    document.body.style.overflow = "hidden"
    return () => {
      document.removeEventListener("keydown", onKey)
      document.body.style.overflow = prevOverflow
    }
  }, [authOpen]) // eslint-disable-line react-hooks/exhaustive-deps

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

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4" dir="rtl">
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={close} />
      <div className="relative card w-full max-w-sm p-6 shadow-2xl" role="dialog" aria-modal="true" aria-labelledby="auth-modal-title">
        <button
          onClick={close}
          className="absolute top-4 left-4 p-1.5 rounded-lg text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors"
          aria-label="סגור"
        >
          <X className="w-5 h-5" />
        </button>

        {sent === 'confirm' ? (
          <div className="text-center py-6">
            <div className="w-14 h-14 rounded-full bg-emerald-100 dark:bg-emerald-900/40 flex items-center justify-center mx-auto mb-4">
              <Mail className="w-7 h-7 text-emerald-600 dark:text-emerald-400" />
            </div>
            <h3 id="auth-modal-title" className="text-lg font-extrabold text-slate-900 dark:text-white">כמעט על המגרש 🛼</h3>
            <p className="text-sm text-slate-500 dark:text-slate-400 mt-2">
              שלחנו קישור אימות ל־<span className="font-semibold text-slate-700 dark:text-slate-300">{email}</span>. לחצו עליו — ואתם בהרכב.
            </p>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-2">
              לא הגיע? הציצו בתיקיית הספאם — לפעמים המייל נתקע ליד הבמה.
            </p>
            <button onClick={close} className="mt-5 w-full py-2.5 rounded-xl bg-brand text-white font-semibold hover:bg-brand-hover transition-colors">
              אלופים, הבנתי
            </button>
          </div>
        ) : sent === 'ratelimit' ? (
          <div className="text-center py-6">
            <div className="w-14 h-14 rounded-full bg-amber-100 dark:bg-amber-900/40 flex items-center justify-center mx-auto mb-4">
              <Clock className="w-7 h-7 text-amber-600 dark:text-amber-400" />
            </div>
            <h3 id="auth-modal-title" className="text-lg font-extrabold text-slate-900 dark:text-white">רגע, טיים־אאוט ⏱️</h3>
            <p className="text-sm text-slate-500 dark:text-slate-400 mt-2">
              שלחנו כבר כמה מיילים בזמן קצר, והשרת ביקש חילוף. שבו על הספסל דקה־שתיים ונסו שוב.
            </p>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-2">
              כבר קיבלתם מייל קודם? הקישור עדיין תקף — פשוט אשרו אותו.
            </p>
            <button onClick={close} className="mt-5 w-full py-2.5 rounded-xl bg-amber-500 text-white font-semibold hover:bg-amber-600 transition-colors">
              סבבה, אחכה
            </button>
          </div>
        ) : sent === 'reset' ? (
          <div className="text-center py-6">
            <div className="w-14 h-14 rounded-full bg-brand/10 dark:bg-brand/20 flex items-center justify-center mx-auto mb-4">
              <KeyRound className="w-7 h-7 text-brand dark:text-brand-light" />
            </div>
            <h3 id="auth-modal-title" className="text-lg font-extrabold text-slate-900 dark:text-white">בדקו את המייל 📩</h3>
            <p className="text-sm text-slate-500 dark:text-slate-400 mt-2">
              אם קיים חשבון עבור <span className="font-semibold text-slate-700 dark:text-slate-300">{email}</span>, שלחנו אליו קישור לאיפוס הסיסמה. לחצו עליו ובחרו סיסמה חדשה.
            </p>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-2">
              לא הגיע? הציצו בתיקיית הספאם — לפעמים המייל נתקע ליד הבמה.
            </p>
            <button onClick={close} className="mt-5 w-full py-2.5 rounded-xl bg-brand text-white font-semibold hover:bg-brand-hover transition-colors">
              הבנתי
            </button>
          </div>
        ) : (
          <>
            <h2 id="auth-modal-title" className="text-xl font-extrabold text-slate-900 dark:text-white text-center">
              {TITLES[mode].h}
            </h2>
            <p className="text-center text-sm text-slate-500 dark:text-slate-400 mt-1">
              {TITLES[mode].sub}
            </p>

            <form onSubmit={submit} className="mt-5 space-y-3">
              {mode === "signup" && (
                <Field icon={User} type="text" placeholder="שם תצוגה" value={name} onChange={setName} autoComplete="name" />
              )}
              <Field icon={Mail} type="email" placeholder="אימייל" value={email} onChange={setEmail} required autoComplete="email" />
              {mode !== "forgot" && (
                <Field icon={Lock} type="password" placeholder="סיסמה (לפחות 6 תווים)" value={password} onChange={setPassword} required minLength={6} autoComplete={mode === "signin" ? "current-password" : "new-password"} />
              )}

              {mode === "signin" && (
                <div className="text-left -mt-1">
                  <button type="button" onClick={() => switchMode("forgot")} className="text-xs font-semibold text-brand dark:text-brand-light hover:underline">
                    שכחתי סיסמה
                  </button>
                </div>
              )}

              {error && (
                <p className="text-xs text-red-600 dark:text-red-400 font-medium bg-red-50 dark:bg-red-950/40 rounded-lg px-3 py-2">{error}</p>
              )}

              <button
                type="submit"
                disabled={busy}
                className="w-full py-2.5 rounded-xl bg-brand text-white font-bold hover:bg-brand-hover transition-colors disabled:opacity-60 flex items-center justify-center gap-2"
              >
                {busy && <Loader2 className="w-4 h-4 animate-spin" />}
                {mode === "signin" ? "התחברות" : mode === "signup" ? "יצירת חשבון" : "שליחת קישור לאיפוס"}
              </button>
            </form>

            {mode !== "forgot" && (
              <>
                <div className="flex items-center gap-3 my-4">
                  <div className="flex-1 h-px bg-slate-200 dark:bg-slate-700" />
                  <span className="text-[11px] text-slate-400">או</span>
                  <div className="flex-1 h-px bg-slate-200 dark:bg-slate-700" />
                </div>

                <button
                  onClick={() => signInWithGoogle()}
                  className="w-full py-2.5 rounded-xl border border-slate-200 dark:border-slate-600 font-semibold text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700/60 transition-colors flex items-center justify-center gap-2"
                >
                  <GoogleIcon /> המשך עם Google
                </button>

                {APPLE_WEB_ENABLED && (
                  <button
                    onClick={() => signInWithAppleWeb().catch(() => setError("ההתחברות עם Apple נכשלה. נסו שוב."))}
                    className="mt-2 w-full py-2.5 rounded-xl bg-black text-white font-semibold hover:bg-slate-800 dark:bg-white dark:text-black dark:hover:bg-slate-200 transition-colors flex items-center justify-center gap-2"
                  >
                    <AppleIcon /> המשך עם Apple
                  </button>
                )}

                {/* Each sign-in method is its own account unless linked — the Apple-in-the-
                    app + Google-here split is how a player ends up with two accounts. */}
                <p className="text-center text-[11px] text-slate-400 dark:text-slate-500 mt-3 leading-relaxed">
                  כבר נרשמתם באפליקציה? היכנסו כאן באותה דרך ({APPLE_WEB_ENABLED ? "Google / Apple / אימייל" : "Google / אימייל"}) — דרך אחרת תיצור חשבון נפרד.
                </p>
              </>
            )}

            <p className="text-center text-xs text-slate-500 dark:text-slate-400 mt-5">
              {mode === "signin" ? (
                <>אין לכם חשבון? <button type="button" onClick={() => switchMode("signup")} className="font-bold text-brand dark:text-brand-light hover:underline">הרשמה</button></>
              ) : mode === "signup" ? (
                <>כבר יש לכם חשבון? <button type="button" onClick={() => switchMode("signin")} className="font-bold text-brand dark:text-brand-light hover:underline">התחברות</button></>
              ) : (
                <>נזכרתם בסיסמה? <button type="button" onClick={() => switchMode("signin")} className="font-bold text-brand dark:text-brand-light hover:underline">חזרה להתחברות</button></>
              )}
            </p>
          </>
        )}
      </div>
    </div>
  )
}
