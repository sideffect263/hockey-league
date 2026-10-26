import { useEffect, useState } from "react"
import { Link2, Loader2 } from "lucide-react"
import { ApprovedStatus as CheckCircle2, Warning as AlertTriangle } from "@/components/icons/BrandIcons"
import { supabase } from "@/lib/supabase"
import { APPLE_WEB_ENABLED, linkAppleWeb, AppleIcon } from "@/lib/appleWeb"

/**
 * שיטות התחברות — which ways into THIS account exist, plus "connect Google".
 *
 * Why it exists: every sign-in method that isn't attached to your account quietly
 * makes a NEW account. The real case (2026-09-26): a player signed in with Apple
 * in the iPhone app, then with Google on the website, claimed his card on the
 * Google one — and the app showed him as a stranger with no card. Attaching Google
 * here makes both roads lead to the same account.
 *
 * Uses Supabase manual identity linking (`linkIdentity`, needs "Manual linking" on
 * in the project's auth settings). The website has no Apple sign-in, so Apple can
 * only be attached from the app; until the apps can do that, a stray Apple account
 * is merged by an admin.
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
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(null)

  useEffect(() => {
    let alive = true
    supabase.auth.getUserIdentities().then(({ data }) => {
      if (alive) setIdentities(data?.identities || [])
    })
    const back = readLinkError()
    if (back) {
      const taken = /identity_already_exists|already linked|already exists/i.test(`${back.code} ${back.desc}`)
      setErr(taken
        ? "החשבון הזה (Google / Apple) כבר רשום אצלנו כמשתמש נפרד. פנו למנהל הליגה והוא יאחד את שני החשבונות."
        : "החיבור לא הושלם. נסו שוב.")
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

  if (!identities) return null

  return (
    <div className="pt-4 border-t border-slate-100 dark:border-slate-700/50 space-y-3">
      <div className="flex items-center gap-2">
        <Link2 className="w-4 h-4 text-slate-400" />
        <h3 className="text-sm font-bold text-slate-900 dark:text-white">שיטות התחברות</h3>
      </div>

      <div className="flex flex-wrap gap-2">
        {[...providers].map(p => (
          <span key={p} className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 text-xs font-semibold">
            <CheckCircle2 className="w-4 h-4" /> {LABEL[p] || p}
          </span>
        ))}
      </div>

      <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed">
        היכנסו תמיד באותה דרך — באתר ובאפליקציה. כל דרך שלא מחוברת כאן יוצרת חשבון חדש ונפרד, בלי כרטיס השחקן שלכם.
        {!providers.has("apple") && " נכנסתם פעם עם Apple באייפון ויש לכם שם חשבון נוסף? פנו למנהל הליגה לאיחוד — או חברו את Apple מתוך האפליקציה לפני שנרשמים שוב."}
      </p>

      {APPLE_WEB_ENABLED && !providers.has("apple") && (
        <button onClick={linkApple} disabled={busy}
          className="flex items-center gap-2 px-4 py-2 rounded-lg border border-slate-200 dark:border-slate-700 text-sm font-semibold text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors disabled:opacity-50">
          {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <AppleIcon />}
          חיבור Apple
        </button>
      )}

      {!providers.has("google") && (
        <button onClick={linkGoogle} disabled={busy}
          className="flex items-center gap-2 px-4 py-2 rounded-lg border border-slate-200 dark:border-slate-700 text-sm font-semibold text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors disabled:opacity-50">
          {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Link2 className="w-4 h-4" />}
          חיבור חשבון Google
        </button>
      )}

      {err && (
        <p className="flex items-start gap-1.5 text-xs text-red-600 dark:text-red-400 font-medium bg-red-50 dark:bg-red-950/40 rounded-lg px-3 py-2">
          <AlertTriangle className="w-4 h-4 shrink-0" /> {err}
        </p>
      )}
    </div>
  )
}
