import { useState, useEffect } from "react"
import { Link } from "react-router-dom"
import { getMyLoanRequests, respondLoan, cancelLoan } from "@/lib/loans"
import { setMyAvailability } from "@/lib/availability"
import { Check, X, Loader2 } from "lucide-react"
import { Loan as Handshake } from "@/components/icons/BrandIcons"
import TeamLogo from "@/components/TeamLogo"
import { supabase } from "@/lib/supabase"

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
  const [crests, setCrests] = useState({})

  // my_loan_requests carries the team's name, not its crest: one small lookup, only
  // when there is an invite to draw.
  const needCrests = invites.length > 0 && !Object.keys(crests).length
  useEffect(() => {
    if (!needCrests) return
    let alive = true
    supabase.from("teams").select("id, name, logo_url").then(({ data }) => {
      if (alive && data) setCrests(Object.fromEntries(data.map(t => [t.id, t])))
    })
    return () => { alive = false }
  }, [needCrests])

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

  const head = r => r.status === "accepted"
    ? <>את/ה משחק/ת בהשאלה ב{r.team_name}</>
    : r.initiated_by === "player"
      ? <>ביקשת לשחק ב{r.team_name} · ממתין למאמן/ת</>
      : <>{r.team_name} מזמינה אותך</>

  // Board Loans "הזמנה בשבילך": amber-ringed card, crest, game line, note, the two answers.
  return (
    <div className="space-y-2.5">
      {invites.map(r => {
        const waiting = r.status === "pending" && r.initiated_by !== "player"
        return (
          <section key={r.id} aria-label="הזמנה בשבילך"
            className={`rounded-[22px] overflow-hidden bg-surface ${waiting ? "border-2 border-[#F2B233]" : "border border-line"}`}>
            {waiting && (
              <div className="px-3.5 py-3 bg-[#F2B233]/15 flex items-center gap-2 text-[13px] font-extrabold text-fg-strong">
                <span className="w-2 h-2 rounded-full bg-fl-live" aria-hidden="true" />הזמנה בשבילך
              </div>
            )}
            <div className="p-3.5 flex flex-col gap-3">
              <div className="flex items-center gap-3">
                <TeamLogo team={crests[r.team_id] || { name: r.team_name }} px={54} />
                <div className="flex-1 min-w-0 flex flex-col gap-0.5">
                  <span className="text-base font-extrabold text-fg-strong">{head(r)}</span>
                  <span className="text-[13px] text-fg-soft">
                    {compact || !gameId
                      ? <Link to={`/games/${r.game_id}`} className="underline underline-offset-2">{r.home_team} נגד {r.away_team}</Link>
                      : <>{r.home_team} נגד {r.away_team}</>}
                    {" · "}{when(r)}
                  </span>
                  {r.note && r.note !== "שחקן בהשאלה" && (
                    <span className="text-[12.5px] text-fg-muted">„{r.note}”</span>
                  )}
                </div>
                <Handshake className="w-8 h-8 shrink-0" />
              </div>
              {r.status === "pending" && r.initiated_by === "player" ? (
                <button onClick={() => cancelAsk(r)} disabled={busy === r.id}
                  className="self-start min-h-[44px] text-[13px] font-semibold text-fg-muted underline underline-offset-2 disabled:opacity-50">
                  ביטול הבקשה
                </button>
              ) : r.status === "pending" ? (
                <>
                  <div className="flex gap-2">
                    <button onClick={() => answer(r, true)} disabled={busy === r.id}
                      className="flex-1 h-12 rounded-control bg-brand text-brand-fg text-[15px] font-extrabold inline-flex items-center justify-center gap-1.5 disabled:opacity-50">
                      {busy === r.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />} אני מגיע/ה
                    </button>
                    <button onClick={() => answer(r, false)} disabled={busy === r.id}
                      className="h-12 px-[18px] rounded-control border border-line-strong text-fg-strong text-[15px] font-semibold inline-flex items-center gap-1.5 disabled:opacity-50">
                      <X className="w-4 h-4" /> לא הפעם
                    </button>
                  </div>
                  <span className="text-[12px] text-fg-muted">רק את/ה מאשר/ת. המאמן/ת שלך מקבל/ת עדכון, לא שאלה.</span>
                </>
              ) : (
                <button onClick={() => withdraw(r)} disabled={busy === r.id}
                  className="self-start min-h-[44px] text-[13px] font-semibold text-fg-muted underline underline-offset-2 disabled:opacity-50">
                  לא אוכל להגיע
                </button>
              )}
              {msg[r.id] && <p className="text-[13px] text-fg-soft">{msg[r.id]}</p>}
            </div>
          </section>
        )
      })}
      {done.map(id => (
        <p key={id} className="fl-card p-3.5 text-[13px] text-fg-soft">{msg[id]}</p>
      ))}
    </div>
  )
}
