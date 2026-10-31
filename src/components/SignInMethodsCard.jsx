import { useEffect, useState } from "react"
import { supabase } from "@/lib/supabase"
import { APPLE_WEB_ENABLED, linkAppleWeb, AppleIcon } from "@/lib/appleWeb"
import { AccRow, AccButton, AccChip, Glyph, Spinner, Notice } from "@/components/fl/account/AccountKit"
import { GoogleIcon } from "@/components/fl/account/SocialSignIn"

/**
 * שיטות התחברות — which ways into THIS account exist, plus "connect Google" (a row of the
 * החשבון group on /me, board MyPage).
 *
 * Why it exists: every sign-in method that isn't attached to your account quietly
 * makes a NEW account. The real case (2026-09-26): a player signed in with Apple
 * in the iPhone app, then with Google on the website, claimed his card on the
 * Google one — and the app showed him as a stranger with no card. Attaching Google
 * here makes both roads lead to the same account.
 *
 * Uses Supabase manual identity linking (`linkIdentity`, needs "Manual linking" on
 * in the project's auth settings). Apple is attachable here only when the website has
 * Apple sign-in; otherwise a stray Apple account is merged by an admin.
 */

const LABEL = { google: "Google", apple: "Apple", email: "אימייל וסיסמה" }

/** Error the OAuth round-trip hands back in the URL, if any. */
function readLinkError() {
  const params = new URLSearchParams(window.location.search)
  const hash = new URLSearchParams(window.location.hash.replace(/^#/, ""))
  const code = params.get("error_code") || hash.get("error_code")
  const desc = params.get("error_description") || hash.get("error_description")
  if (!code && !desc) return null
  return { code: code || "", desc: desc || "" }
}

export default function SignInMethodsCard() {
  const [identities, setIdentities] = useState(null)
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(null)

  useEffect(() => {
    let alive = true
    supabase.auth.getUserIdentities().then(({ data }) => {
      if (alive) setIdentities(data?.identities || [])
    }).catch(() => { if (alive) setIdentities([]) })
    const back = readLinkError()
    if (back) {
      const taken = /identity_already_exists|already linked|already exists/i.test(`${back.code} ${back.desc}`)
      setErr(taken
        ? "החשבון הזה (Google / Apple) כבר רשום אצלנו כמשתמש נפרד. פנו למנהל הליגה והוא יאחד את שני החשבונות."
        : "החיבור לא הושלם. נסו שוב.")
      setOpen(true)
      // Drop the error params so a refresh doesn't show it again.
      window.history.replaceState(null, "", window.location.pathname)
    }
    return () => { alive = false }
  }, [])

  const providers = new Set((identities || []).map(i => i.provider))

  const linkGoogle = async () => {
    setBusy(true); setErr(null)
    const { error } = await supabase.auth.linkIdentity({
      provider: "google",
      options: { redirectTo: window.location.origin + window.location.pathname },
    })
    // Success navigates away to Google; we only get here on failure.
    if (error) {
      setErr(/manual linking/i.test(error.message || "")
        ? "חיבור שיטות התחברות עדיין לא זמין. נסו שוב מאוחר יותר."
        : "החיבור נכשל. נסו שוב.")
      setBusy(false)
    }
  }

  const linkApple = async () => {
    setBusy(true); setErr(null)
    try { await linkAppleWeb() }
    catch { setErr("החיבור נכשל. נסו שוב."); setBusy(false) }
  }

  const names = [...providers].map(p => LABEL[p] || p)
  return (
    <AccRow line="key" label="שיטות התחברות"
      sub={identities == null ? "טוען…" : `${names.length ? names.join(" · ") : "לא ידוע"}. התחברו תמיד באותה דרך`}
      onClick={() => setOpen(v => !v)}
      trailing={<Glyph d="chev" size={18} className={`text-fg-subtle transition-transform ${open ? "rotate-90" : "-rotate-90"}`} />}>
      {open && identities && (
        <div className="px-3.5 pb-3 -mt-1 flex flex-col gap-2.5">
          {names.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {[...providers].map(p => <AccChip key={p} tone="ok"><Glyph d="check" size={13} stroke={2.6} /> {LABEL[p] || p}</AccChip>)}
            </div>
          )}
          <p className="text-[12.5px] text-fg-muted leading-relaxed">
            היכנסו תמיד באותה דרך, באתר ובאפליקציה. כל דרך שלא מחוברת כאן יוצרת חשבון חדש ונפרד, בלי כרטיס השחקן שלכם.
            {!providers.has("apple") && " נכנסתם פעם עם Apple באייפון ויש לכם שם חשבון נוסף? פנו למנהל הליגה לאיחוד, או חברו את Apple מתוך האפליקציה לפני שנרשמים שוב."}
          </p>
          <div className="flex flex-wrap gap-2">
            {!providers.has("google") && (
              <AccButton tone="outline" onClick={linkGoogle} disabled={busy}>{busy ? <Spinner /> : <GoogleIcon className="w-4 h-4" />} חיבור חשבון Google</AccButton>
            )}
            {APPLE_WEB_ENABLED && !providers.has("apple") && (
              <AccButton tone="outline" onClick={linkApple} disabled={busy}>{busy ? <Spinner /> : <AppleIcon />} חיבור Apple</AccButton>
            )}
          </div>
          {err && <Notice tone="err">{err}</Notice>}
        </div>
      )}
    </AccRow>
  )
}
