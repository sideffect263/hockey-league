import { useState, useEffect } from "react"
import { Link } from "react-router-dom"
import { getMyLoanRequests, respondLoan, cancelLoan } from "@/lib/loans"
import { setMyAvailability } from "@/lib/availability"
import { Check, X, Loader2 } from "lucide-react"
import { Loan as Handshake } from "@/components/icons/BrandIcons"

/**
 * The invited player's side of a loan (supabase/loan-requests.sql). He decides — not his
 * own club's coach. Shown on the game's page (where the loan_request push lands) and, with
 * `gameId` left out, as a strip of every open invite (the feed).
 *
 * After accepting he can still pull out with "לא אוכל להגיע": that is a plain sign-out of
 * the game, which closes the loan and tells the coach.
 */
export default function LoanInvite({ gameId = null, compact = false }) {
  const [invites, setInvites] = useState([])
  const [busy, setBusy] = useState(null)
  const [msg, setMsg] = useState({})
  const [tick, setTick] = useState(0)

  useEffect(() => {
    let alive = true
    getMyLoanRequests().then(list => {
      // The feed strip is for what needs HIS answer: invites still pending. The game page
      // shows everything about that game, including his own asks to the coach.
      if (alive) setInvites(gameId ? list.filter(r => r.game_id === gameId)
        : list.filter(r => r.status === "pending" && r.initiated_by !== "player"))
    })
    return () => { alive = false }
  }, [gameId, tick])

  const answer = async (r, accept) => {
    setBusy(r.id)
    try {
      const out = await respondLoan(r.id, accept)
      setMsg(m => ({ ...m, [r.id]: out === "accepted" ? `✓ את/ה בסגל של ${r.team_name}`
        : out === "filled" ? "הסגל כבר התמלא לפני שאישרת — ההזמנה בוטלה"
        : "ההזמנה נדחתה — המאמן/ת יקבל/ו הודעה" }))
      setTick(t => t + 1)
    } catch (e) {
      setMsg(m => ({ ...m, [r.id]: e.message }))
    } finally { setBusy(null) }
  }

  const cancelAsk = async (r) => {
    setBusy(r.id)
    try {
      await cancelLoan(r.id)
      setMsg(m => ({ ...m, [r.id]: "הבקשה בוטלה" }))
      setTick(t => t + 1)
    } catch (e) {
      setMsg(m => ({ ...m, [r.id]: e.message }))
    } finally { setBusy(null) }
  }

  const withdraw = async (r) => {
    if (!window.confirm(`לצאת מהסגל של ${r.team_name}? המאמן/ת יקבל/ו הודעה.`)) return
    setBusy(r.id)
    try {
      await setMyAvailability(r.game_id, "unavailable")
      setMsg(m => ({ ...m, [r.id]: "יצאת מהסגל" }))
      setTick(t => t + 1)
    } catch (e) {
      setMsg(m => ({ ...m, [r.id]: "הפעולה נכשלה, נסו שוב" }))
    } finally { setBusy(null) }
  }

  const done = Object.keys(msg).filter(id => !invites.some(r => r.id === id))
  if (!invites.length && !done.length) return null

  const when = (r) => new Date(r.game_date).toLocaleString("he-IL", { timeZone: "Asia/Jerusalem",
    weekday: "long", day: "numeric", month: "numeric", hour: "2-digit", minute: "2-digit",
  })

  return (
    <div className="space-y-2">
      {invites.map(r => (
        <div key={r.id} className="card p-4 border-2 border-brand/30 space-y-2">
          <p className="flex items-start gap-2 text-sm font-bold text-slate-900 dark:text-white">
            <Handshake className="w-5 h-5 text-brand shrink-0" />
            <span>
              {r.status === "accepted"
                ? <>את/ה משחק/ת בהשאלה ב<span className="text-brand">{r.team_name}</span></>
                : r.initiated_by === "player"
                  ? <>ביקשת לשחק בהשאלה ב<span className="text-brand">{r.team_name}</span> — ממתין לאישור המאמן/ת</>
                  : <><span className="text-brand">{r.team_name}</span> מזמינה אותך לשחק בהשאלה</>}
            </span>
          </p>
          <p className="text-xs text-slate-600 dark:text-slate-300">
            {compact || !gameId
              ? <Link to={`/games/${r.game_id}`} className="underline font-semibold">{r.home_team} נגד {r.away_team}</Link>
              : <>{r.home_team} נגד {r.away_team}</>}
            {" · "}{when(r)}
          </p>
          {r.note && r.note !== "שחקן בהשאלה" && (
            <p className="text-xs text-slate-500 dark:text-slate-400">„{r.note}”</p>
          )}
          {r.status === "pending" && r.initiated_by === "player" ? (
            <button onClick={() => cancelAsk(r)} disabled={busy === r.id}
              className="text-xs font-semibold text-slate-500 hover:text-red-600 underline disabled:opacity-50">
              ביטול הבקשה
            </button>
          ) : r.status === "pending" ? (
            <div className="flex items-center gap-2">
              <button onClick={() => answer(r, true)} disabled={busy === r.id}
                className="flex-1 inline-flex items-center justify-center gap-1.5 text-sm font-semibold px-3 py-2 rounded-lg bg-emerald-500 text-white hover:opacity-90 transition-opacity disabled:opacity-50">
                {busy === r.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />} אני מגיע/ה
              </button>
              <button onClick={() => answer(r, false)} disabled={busy === r.id}
                className="flex-1 inline-flex items-center justify-center gap-1.5 text-sm font-semibold px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-600 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors disabled:opacity-50">
                <X className="w-4 h-4" /> לא יכול/ה
              </button>
            </div>
          ) : (
            <button onClick={() => withdraw(r)} disabled={busy === r.id}
              className="text-xs font-semibold text-slate-500 hover:text-red-600 underline disabled:opacity-50">
              לא אוכל להגיע
            </button>
          )}
          {msg[r.id] && <p className="text-xs text-slate-600 dark:text-slate-300">{msg[r.id]}</p>}
        </div>
      ))}
      {done.map(id => (
        <p key={id} className="card p-3 text-xs text-slate-600 dark:text-slate-300">{msg[id]}</p>
      ))}
    </div>
  )
}
