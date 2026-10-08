import { useState, useEffect } from "react"
import { useSearchParams } from "react-router-dom"
import { Share2, BellRing, Check, Loader2, X } from "lucide-react"
import { useAuth } from "@/lib/AuthContext"
import { follow } from "@/lib/follows"

/**
 * "Tell your friends" for a team or player (Yarden, 2026-10-03: friends should get the
 * goals). The goal push already exists — a follow with notify on (game_followers) — so
 * what was missing is the invitation: a link that lands on this page with ?follow=1,
 * where the friend gets ONE button that follows with notifications on.
 */
export function ShareFollowButton({ targetType, name }) {
  const [copied, setCopied] = useState(false)
  const share = async () => {
    const url = new URL(window.location.href)
    url.search = ""
    url.hash = ""
    url.searchParams.set("follow", "1")
    const text = targetType === "team"
      ? `עקבו אחרי ${name} בליגת הוקי הגלגיליות וקבלו התראה על כל גול ⚽`
      : `עקבו אחרי ${name} בליגת הוקי הגלגיליות וקבלו התראה על כל גול במשחקים שלו ⚽`
    try {
      if (navigator.share) { await navigator.share({ title: name, text, url: url.toString() }); return }
    } catch (e) { if (e?.name === "AbortError") return }
    window.open(`https://wa.me/?text=${encodeURIComponent(`${text}\n${url}`)}`, "_blank", "noopener,noreferrer")
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }
  return (
    <button onClick={share}
      className="inline-flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1 rounded-lg border border-slate-200 dark:border-slate-600 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors">
      {copied ? <Check className="w-3.5 h-3.5 text-emerald-500" /> : <Share2 className="w-3.5 h-3.5" />} שיתוף לחברים
    </button>
  )
}

/** The landing half: shown only when the page was opened from a shared ?follow=1 link. */
export function FollowInvite({ targetType, targetId, name }) {
  const { user, openAuth } = useAuth()
  const [params, setParams] = useSearchParams()
  const [state, setState] = useState("idle") // idle | busy | done | err
  const invited = params.get("follow") === "1"

  // Back from sign-in with the invite still in the URL → finish what they tapped.
  useEffect(() => {
    if (invited && user && sessionStorage.getItem("follow-invite") === `${targetType}:${targetId}`) {
      sessionStorage.removeItem("follow-invite")
      accept()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [invited, user])

  if (!invited || !targetId) return null

  const dismiss = () => { params.delete("follow"); setParams(params, { replace: true }) }

  async function accept() {
    if (!user) {
      try { sessionStorage.setItem("follow-invite", `${targetType}:${targetId}`) } catch { /* private mode */ }
      openAuth?.()
      return
    }
    setState("busy")
    try { await follow(targetType, targetId, true); setState("done") }
    catch { setState("err") }
  }

  return (
    <div className="card p-4 flex items-center gap-3 border-brand/30 bg-brand/5">
      <BellRing className="w-5 h-5 text-brand shrink-0" />
      <div className="min-w-0 flex-1">
        {state === "done" ? (
          <p className="text-sm font-semibold text-slate-900 dark:text-white">
            ✓ את/ה עוקב/ת אחרי {name} — נעדכן על כל גול
          </p>
        ) : (
          <>
            <p className="text-sm font-semibold text-slate-900 dark:text-white">רוצים לקבל התראה על כל גול של {name}?</p>
            {!user && <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">צריך להתחבר פעם אחת — ואז ההתראות מגיעות לבד</p>}
            {state === "err" && <p className="text-[11px] text-red-600 dark:text-red-400 mt-0.5">משהו השתבש, נסו שוב</p>}
          </>
        )}
      </div>
      {state !== "done" && (
        <button onClick={accept} disabled={state === "busy"}
          className="shrink-0 inline-flex items-center gap-1.5 text-xs font-bold px-3 py-2 rounded-lg bg-brand text-white hover:opacity-90 transition-opacity disabled:opacity-50">
          {state === "busy" ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <BellRing className="w-3.5 h-3.5" />}
          עקוב + התראות
        </button>
      )}
      <button onClick={dismiss} aria-label="סגירה" className="shrink-0 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200">
        <X className="w-4 h-4" />
      </button>
    </div>
  )
}
