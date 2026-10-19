import { useState, useEffect } from "react"
import { useNavigate } from "react-router-dom"
import { KeyRound, Lock, Loader2, CheckCircle2, AlertTriangle } from "lucide-react"
import { supabase } from "@/lib/supabase"
import { useAuth } from "@/lib/AuthContext"
import { isPwnedPasswordError, PWNED_PASSWORD_MSG } from "@/lib/passwordErrors"

// Landing page for the password-reset email link. Supabase's client parses the
// recovery token from the URL hash on load and establishes a short-lived
// recovery session (firing PASSWORD_RECOVERY). We wait for that session, then
// let the user set a new password via updateUser({ password }).
export default function ResetPassword() {
  const navigate = useNavigate()
  const { openAuth } = useAuth()
  // 'checking' | 'ready' | 'invalid' | 'done'
  const [status, setStatus] = useState("checking")
  const [password, setPassword] = useState("")
  const [confirm, setConfirm] = useState("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)

  useEffect(() => {
    let settled = false
    const markReady = () => { settled = true; setStatus("ready") }

    // PASSWORD_RECOVERY may fire before this component mounts (the client is a
    // singleton that processes the hash at app load), so also check the session
    // directly. Whichever resolves first wins.
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === "PASSWORD_RECOVERY" || session) markReady()
    })
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session) markReady()
      else setTimeout(() => { if (!settled) setStatus("invalid") }, 2500)
    })

    return () => subscription.unsubscribe()
  }, [])

  const submit = async (e) => {
    e.preventDefault()
    setError(null)
    if (password.length < 6) { setError("הסיסמה חייבת להכיל לפחות 6 תווים"); return }
    if (password !== confirm) { setError("הסיסמאות אינן תואמות"); return }
    setBusy(true)
    try {
      const { error } = await supabase.auth.updateUser({ password })
      if (error) throw error
      setStatus("done")
      setTimeout(() => navigate("/me"), 1800)
    } catch (err) {
      const m = (err?.message || "").toLowerCase()
      if (isPwnedPasswordError(err)) {
        setError(PWNED_PASSWORD_MSG)
      } else if (m.includes("different from the old") || m.includes("should be different") || m.includes("same")) {
        setError("בחרו סיסמה שונה מהסיסמה הקודמת")
      } else if (err?.status === 401 || m.includes("session") || m.includes("expired") || m.includes("token")) {
        setStatus("invalid")
      } else {
        setError(err?.message || "אירעה שגיאה. נסו שוב")
      }
    } finally {
      setBusy(false)
    }
  }

  const inputCls = "w-full bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl pr-9 pl-3 py-2.5 text-sm text-slate-800 dark:text-slate-100 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-brand/30 focus:border-brand transition-all"

  return (
    <div className="min-h-[70vh] flex items-center justify-center px-4 py-10" dir="rtl">
      <div className="card w-full max-w-sm p-6 shadow-xl text-center">
        {status === "checking" && (
          <div className="py-6">
            <Loader2 className="w-8 h-8 text-brand animate-spin mx-auto" />
            <p className="text-sm text-slate-500 dark:text-slate-400 mt-4">מאמתים את הקישור…</p>
          </div>
        )}

        {status === "invalid" && (
          <div className="py-4">
            <div className="w-14 h-14 rounded-full bg-amber-100 dark:bg-amber-900/40 flex items-center justify-center mx-auto mb-4">
              <AlertTriangle className="w-7 h-7 text-amber-600 dark:text-amber-400" />
            </div>
            <h1 className="text-lg font-extrabold text-slate-900 dark:text-white">הקישור אינו תקף</h1>
            <p className="text-sm text-slate-500 dark:text-slate-400 mt-2">
              ייתכן שהקישור פג תוקף או שכבר נעשה בו שימוש. אפשר לבקש קישור חדש דרך "שכחתי סיסמה".
            </p>
            <button
              onClick={() => { navigate("/"); openAuth() }}
              className="mt-5 w-full py-2.5 rounded-xl bg-brand text-white font-semibold hover:bg-brand-hover transition-colors"
            >
              בקשת קישור חדש
            </button>
          </div>
        )}

        {status === "done" && (
          <div className="py-4">
            <div className="w-14 h-14 rounded-full bg-emerald-100 dark:bg-emerald-900/40 flex items-center justify-center mx-auto mb-4">
              <CheckCircle2 className="w-7 h-7 text-emerald-600 dark:text-emerald-400" />
            </div>
            <h1 className="text-lg font-extrabold text-slate-900 dark:text-white">הסיסמה עודכנה! 🎉</h1>
            <p className="text-sm text-slate-500 dark:text-slate-400 mt-2">מעבירים אתכם לחשבון…</p>
          </div>
        )}

        {status === "ready" && (
          <>
            <div className="w-14 h-14 rounded-full bg-brand/10 dark:bg-brand/20 flex items-center justify-center mx-auto mb-4">
              <KeyRound className="w-7 h-7 text-brand dark:text-brand-light" />
            </div>
            <h1 className="text-lg font-extrabold text-slate-900 dark:text-white">בחירת סיסמה חדשה</h1>
            <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">הזינו סיסמה חדשה לחשבון שלכם</p>

            <form onSubmit={submit} className="mt-5 space-y-3 text-right">
              <div className="relative">
                <Lock className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                <input
                  type="password" autoComplete="new-password" required minLength={6}
                  placeholder="סיסמה חדשה (לפחות 6 תווים)"
                  value={password} onChange={e => setPassword(e.target.value)}
                  className={inputCls}
                />
              </div>
              <div className="relative">
                <Lock className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                <input
                  type="password" autoComplete="new-password" required minLength={6}
                  placeholder="אימות סיסמה חדשה"
                  value={confirm} onChange={e => setConfirm(e.target.value)}
                  className={inputCls}
                />
              </div>

              {error && (
                <p className="text-xs text-red-600 dark:text-red-400 font-medium bg-red-50 dark:bg-red-950/40 rounded-lg px-3 py-2">{error}</p>
              )}

              <button
                type="submit" disabled={busy}
                className="w-full py-2.5 rounded-xl bg-brand text-white font-bold hover:bg-brand-hover transition-colors disabled:opacity-60 flex items-center justify-center gap-2"
              >
                {busy && <Loader2 className="w-4 h-4 animate-spin" />}
                עדכון סיסמה
              </button>
            </form>
          </>
        )}
      </div>
    </div>
  )
}
