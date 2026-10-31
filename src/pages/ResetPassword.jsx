import { useState, useEffect } from "react"
import { useNavigate } from "react-router-dom"
import { BrandIcon } from "@/components/icons/BrandIcons"
import { CTA, Field, Spinner, Notice, inputCls } from "@/components/fl/account/AccountKit"
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

  const Badge = ({ icon }) => (
    <span className="mx-auto mb-4 w-[72px] h-[72px] rounded-[22px] bg-surface flex items-center justify-center">
      <BrandIcon name={icon} variant="large" className="w-11 h-11" />
    </span>
  )

  // Floodlight: one centred card on the page colour; Rubik, 52px CTA, labelled fields.
  return (
    <div className="min-h-[70vh] flex items-center justify-center px-4 py-10" dir="rtl">
      <div className="w-full max-w-sm bg-surface-page sm:bg-surface rounded-[26px] p-2 sm:p-6 text-center">
        {status === "checking" && (
          <div className="py-8 flex flex-col items-center gap-4 text-fg-muted" role="status">
            <Spinner className="w-8 h-8" />
            <p className="text-[14px]">מאמתים את הקישור…</p>
          </div>
        )}

        {status === "invalid" && (
          <div className="py-4">
            <Badge icon="waiting" />
            <h1 className="text-[24px] font-black text-fg-strong">הקישור אינו תקף</h1>
            <p className="text-[14.5px] text-fg-muted mt-2 leading-relaxed">
              ייתכן שהקישור פג תוקף או שכבר נעשה בו שימוש. אפשר לבקש קישור חדש דרך "שכחתי סיסמה".
            </p>
            <CTA className="mt-6" onClick={() => { navigate("/"); openAuth() }}>בקשת קישור חדש</CTA>
          </div>
        )}

        {status === "done" && (
          <div className="py-4" role="status">
            <Badge icon="verified" />
            <h1 className="text-[24px] font-black text-fg-strong">הסיסמה עודכנה</h1>
            <p className="text-[14.5px] text-fg-muted mt-2">מעבירים אתכם לחשבון…</p>
          </div>
        )}

        {status === "ready" && (
          <>
            <Badge icon="profile" />
            <h1 className="text-[24px] font-black text-fg-strong">בחירת סיסמה חדשה</h1>
            <p className="text-[14.5px] text-fg-muted mt-1">סיסמה חדשה לחשבון שלכם</p>

            <form onSubmit={submit} className="mt-6 flex flex-col gap-4 text-right">
              <Field label="סיסמה חדשה" htmlFor="rp-new" hint="לפחות 6 תווים">
                <input id="rp-new" type="password" dir="ltr" autoComplete="new-password" required minLength={6} autoFocus
                  value={password} onChange={e => setPassword(e.target.value)} className={inputCls} />
              </Field>
              <Field label="אימות סיסמה חדשה" htmlFor="rp-confirm">
                <input id="rp-confirm" type="password" dir="ltr" autoComplete="new-password" required minLength={6}
                  value={confirm} onChange={e => setConfirm(e.target.value)} className={inputCls} />
              </Field>
              {error && <Notice tone="err">{error}</Notice>}
              <CTA type="submit" disabled={busy}>{busy && <Spinner />} עדכון סיסמה</CTA>
            </form>
          </>
        )}
      </div>
    </div>
  )
}
