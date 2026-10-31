import { useState, useEffect, useMemo } from "react"
import {
  getLoanCandidates, getLoanSummary, requestLoan, cancelLoan, setLoanCall, respondLoanJoin,
  LOAN_BLOCK_LABEL, LOAN_FIELD_TARGET,
} from "@/lib/loans"
import { addPlayerToSquad } from "@/lib/squad"
import { Search, Send, X, Loader2, ChevronDown, Check } from "lucide-react"
import { Loan as Handshake, PersonAdd as UserPlus, Announce as Megaphone, Hourglass, Goalkeeper } from "@/components/icons/BrandIcons"

/**
 * The coach's loan desk for one team in one game (supabase/loan-requests.sql).
 *
 * Says how many field players are signed up against the five a team may reach with loans,
 * lists his invites and their answers, and — while there is room — opens a list of every
 * player who can actually come: right age, valid medical, not suspended or away, and not
 * already playing within two hours. Those who can't are listed underneath with the reason,
 * so a coach looking for a name he knows is not left guessing.
 *
 * A player with an account gets an invite and decides himself. One without an account
 * can't answer, so the coach adds him directly.
 *
 * Or the coach just raises a hand — "we need a field player / a keeper" (loan_calls) —
 * and the call shows on /loans to everyone who could be borrowed. Their asks land here
 * for him to approve. The call goes quiet by itself once the squad has room no more.
 */
const STATUS = {
  pending:   { label: "ממתין לתשובה", cls: "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300" },
  accepted:  { label: "אישר",          cls: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300" },
  declined:  { label: "לא יכול",       cls: "bg-slate-100 text-slate-500 dark:bg-slate-700 dark:text-slate-400" },
  cancelled: { label: "בוטל",          cls: "bg-slate-100 text-slate-500 dark:bg-slate-700 dark:text-slate-400" },
  filled:    { label: "הסגל התמלא",    cls: "bg-slate-100 text-slate-500 dark:bg-slate-700 dark:text-slate-400" },
  removed:   { label: "הוסר — הגיעו שחקני הקבוצה", cls: "bg-slate-100 text-slate-500 dark:bg-slate-700 dark:text-slate-400" },
}

const fullName = (p) => `${p.first_name || ""} ${p.last_name || ""}`.trim()

export default function LoanFinder({ gameId, teamId, teamName, refreshKey = 0, onChanged }) {
  const [summary, setSummary] = useState(null)
  const [open, setOpen] = useState(false)
  const [candidates, setCandidates] = useState(null)
  const [tab, setTab] = useState("field")
  const [query, setQuery] = useState("")
  const [showBlocked, setShowBlocked] = useState(false)
  const [busyId, setBusyId] = useState(null)
  const [err, setErr] = useState(null)
  const [tick, setTick] = useState(0)
  const [callNote, setCallNote] = useState("")
  const [callBusy, setCallBusy] = useState(false)

  const reload = () => setTick(t => t + 1)

  useEffect(() => {
    let alive = true
    getLoanSummary(gameId, teamId).then(s => {
      if (!alive) return
      setSummary(s)
      setCallNote(s?.call?.note || "")
    }).catch(() => {})
    if (open) getLoanCandidates(gameId, teamId).then(c => { if (alive) setCandidates(c) }).catch(e => alive && setErr(e.message))
    return () => { alive = false }
  }, [gameId, teamId, open, tick, refreshKey])

  // Default to the goalkeeper tab when field seats are gone but a keeper can still come.
  useEffect(() => {
    if (summary && summary.field_slots === 0 && summary.gk_slots > 0) setTab("gk")
  }, [summary?.field_slots, summary?.gk_slots])

  const { available, blocked } = useMemo(() => {
    const q = query.trim()
    const wantGk = tab === "gk"
    const list = (candidates || [])
      .filter(c => (c.position === "Goalkeeper") === wantGk)
      .filter(c => c.block !== "opponent")
      .filter(c => !q || fullName(c).includes(q) || (c.team_name || "").includes(q))
      .sort((a, b) => (a.team_name || "").localeCompare(b.team_name || "", "he") || fullName(a).localeCompare(fullName(b), "he"))
    return { available: list.filter(c => !c.block), blocked: list.filter(c => c.block) }
  }, [candidates, tab, query])

  if (!summary) return null

  const signed = summary.own_field + summary.loan_field
  const openRequests = (summary.requests || []).filter(r => r.status === "pending" || r.status === "accepted")
  const closedRequests = (summary.requests || []).filter(r => r.status !== "pending" && r.status !== "accepted").slice(0, 5)
  const slotsForTab = tab === "gk" ? summary.gk_slots : summary.field_slots
  const anyRoom = summary.field_slots > 0 || summary.gk_slots > 0

  const invite = async (c) => {
    setErr(null); setBusyId(c.player_id)
    try {
      if (c.has_account) {
        await requestLoan(gameId, teamId, c.player_id)
      } else {
        // No account → nobody to ask. The coach adds him, and vouches for the age only
        // when the card has no date of birth (a keeper may be any age).
        const needsVouch = c.position !== "Goalkeeper" && c.age == null
        if (needsVouch && !window.confirm(`אין תאריך לידה בכרטיס של ${fullName(c)}.\nלאשר שהוא/היא עד גיל 18?`)) return
        await addPlayerToSquad(gameId, c.player_id, teamId, { note: "שחקן בהשאלה", ageConfirmed: true })
        onChanged?.()
      }
      reload()
    } catch (e) {
      setErr(e.message)
    } finally { setBusyId(null) }
  }

  const cancel = async (r) => {
    if (r.status === "accepted" && !window.confirm(`להוציא את ${r.player_name} מהסגל?`)) return
    setErr(null); setBusyId(r.id)
    try { await cancelLoan(r.id); reload(); onChanged?.() }
    catch (e) { setErr(e.message) }
    finally { setBusyId(null) }
  }

  const inviteOf = (c) => openRequests.find(r => r.player_id === c.player_id)

  const call = summary.call || { need_field: false, need_gk: false }
  const toggleCall = async (key) => {
    setErr(null); setCallBusy(true)
    const next = { needField: call.need_field, needGk: call.need_gk, note: callNote }
    if (key === "field") next.needField = !call.need_field
    if (key === "gk") next.needGk = !call.need_gk
    // Switching ON notifies every player who could come, once — that can't be taken back.
    const turningOn = (key === "field" && next.needField) || (key === "gk" && next.needGk)
    if (turningOn && !window.confirm(`לפרסם שהקבוצה מחפשת ${key === "gk" ? "שוער" : "שחקן שדה"}?\nכל השחקנים שיכולים לשחק במשחק יקבלו הודעה.`)) {
      setCallBusy(false); return
    }
    try { await setLoanCall(gameId, teamId, next); reload() }
    catch (e) { setErr(e.message) }
    finally { setCallBusy(false) }
  }
  const saveCallNote = async () => {
    if ((summary.call?.note || "") === callNote.trim()) return
    try { await setLoanCall(gameId, teamId, { needField: call.need_field, needGk: call.need_gk, note: callNote }); reload() }
    catch (e) { setErr(e.message) }
  }

  const answerAsk = async (r, accept) => {
    setErr(null); setBusyId(r.id)
    try {
      const out = await respondLoanJoin(r.id, accept)
      if (out === "filled") setErr("הסגל כבר מלא — הבקשה נסגרה")
      reload(); onChanged?.()
    } catch (e) { setErr(e.message) }
    finally { setBusyId(null) }
  }

  const gkHave = (summary.own_gk || 0) > 0 || summary.gk_slots === 0
  const Meter = ({ filled, total }) => (
    <div className="flex gap-1" aria-hidden="true">
      {Array.from({ length: total }, (_, i) => (
        <span key={i} className={`flex-1 h-2.5 rounded-full ${i < filled ? "bg-pos" : "border-2 border-dashed border-fg-faint"}`} />
      ))}
    </div>
  )

  // Board LoanFinder: the cap meters, the "publish on /loans" switches, then the list.
  return (
    <div className="mt-3 p-3.5 rounded-card bg-surface border border-line space-y-3">
      <p className="flex items-center gap-2 text-[17px] font-extrabold text-fg-strong">
        <Handshake className="w-6 h-6" /> שחקן בהשאלה
      </p>

      <div className="grid grid-cols-2 gap-2">
        <div className="rounded-2xl bg-surface-page p-3 flex flex-col gap-2">
          <span className="text-[12.5px] font-bold text-fg-strong">שחקני שדה</span>
          <Meter filled={Math.min(signed, LOAN_FIELD_TARGET)} total={LOAN_FIELD_TARGET} />
          <span className="text-[12px] text-fg-soft">
            <span className="fl-num">{signed}</span> מתוך <span className="fl-num">{LOAN_FIELD_TARGET}</span>
            {summary.field_slots > 0 ? <> · אפשר לשאול עוד <span className="fl-num">{summary.field_slots}</span></> : ""}
          </span>
        </div>
        <div className="rounded-2xl bg-surface-page p-3 flex flex-col gap-2">
          <span className="text-[12.5px] font-bold text-fg-strong">שוער</span>
          <Meter filled={gkHave ? 1 : 0} total={1} />
          <span className="text-[12px] text-fg-soft">{summary.gk_slots > 0 ? "אפשר לשאול שוער אחד" : (summary.own_gk > 0 ? "יש שוער משלכם · לא צריך" : "כבר הושאל שוער")}</span>
        </div>
      </div>

      <p className="text-[12.5px] text-fg-soft leading-relaxed">
        {!summary.open
          ? "המשחק כבר התחיל — אי אפשר לשלוח הזמנות."
          : summary.field_slots > 0
            ? <>השחקן מקבל הזמנה ומאשר בעצמו.</>
            : summary.gk_slots > 0
              ? `יש ${LOAN_FIELD_TARGET} שחקני שדה — אפשר להשאיל רק שוער.`
              : "הסגל מלא — אין צורך בהשאלה."}
        {summary.open && summary.loan_field > 0 && (
          <span className="block text-fg-muted mt-0.5">
            אם יירשמו עוד שחקנים מהקבוצה, המושאל האחרון יוסר אוטומטית והוא יקבל הודעה.
          </span>
        )}
      </p>

      {/* Raise a hand instead of chasing one player: the call shows on /loans to every
          player who could come, and their asks land in the list below. */}
      {summary.open && (anyRoom || call.need_field || call.need_gk) && (
        <div className="rounded-2xl border border-line p-3 space-y-2">
          <p className="flex items-center gap-2 text-[14px] font-bold text-fg-strong">
            <Megaphone className="w-5 h-5" /> לפרסם בעמוד ההשאלות
            {callBusy && <Loader2 className="w-4 h-4 animate-spin text-fg-muted" />}
          </p>
          <p className="text-[12px] text-fg-muted -mt-1">שחקנים מתאימים יקבלו הודעה אחת ויוכלו לבקש</p>
          {[["field", "מחפשים שחקן שדה", call.need_field, summary.field_slots], ["gk", "מחפשים שוער", call.need_gk, summary.gk_slots]].map(([k, label, on, slots]) => (
            <button key={k} type="button" onClick={() => toggleCall(k)} disabled={callBusy || (!on && slots === 0)} role="switch" aria-checked={on}
              className="w-full min-h-[48px] flex items-center justify-between gap-3 disabled:opacity-40">
              <span className="text-[14px] font-semibold text-fg-strong">{label}</span>
              <span className={`relative w-[52px] h-[30px] rounded-full shrink-0 transition-colors ${on ? "bg-pos" : "bg-surface-sunken"}`}>
                <span className={`absolute top-[3px] start-[3px] w-6 h-6 rounded-full bg-white shadow transition-transform duration-200 ${on ? "rtl:-translate-x-[22px] ltr:translate-x-[22px]" : ""}`} />
              </span>
            </button>
          ))}
          {(call.need_field || call.need_gk) && (
            <input value={callNote} onChange={e => setCallNote(e.target.value)} onBlur={saveCallNote} maxLength={80}
              placeholder="הערה לשחקנים (לא חובה) — למשחק ב-17:00 חסרים לנו 2" aria-label="הערה לשחקנים"
              className="w-full min-h-[44px] bg-surface-inset border border-line rounded-control px-3 text-[14px] text-fg-strong placeholder:text-fg-subtle focus:outline-none focus:ring-2 focus:ring-brand/30" />
          )}
          {(call.need_field || call.need_gk) && (
            <p className="text-[12px] text-fg-muted">שחקנים שיכולים לשחק קיבלו הודעה. הפרסום יורד לבד כשהסגל מתמלא.</p>
          )}
        </div>
      )}

      {openRequests.length > 0 && (
        <ul className="divide-y divide-line">
          {openRequests.map(r => {
            const asked = r.initiated_by === "player" && r.status === "pending"
            return (
              <li key={r.id} className="flex items-center gap-2.5 min-h-[60px] py-1.5">
                <div className="min-w-0 flex-1">
                  <p className="text-[14.5px] font-bold text-fg-strong truncate">
                    {r.player_name}{r.position === "Goalkeeper" ? <> <Goalkeeper className="w-4 h-4 inline-block align-[-2px]" title="שוער" /></> : null}
                  </p>
                  <p className="text-[12px] text-fg-muted truncate">
                    {asked ? `ביקש/ה לשחק אצלכם${r.age != null ? ` · ${r.age}` : ""}` : STATUS[r.status].label} · {r.team_name || "ללא קבוצה"}
                  </p>
                </div>
                {summary.open && asked ? (
                  <span className="shrink-0 flex items-center gap-1.5">
                    <button onClick={() => answerAsk(r, true)} disabled={busyId === r.id}
                      className="h-11 min-w-[76px] px-3.5 rounded-xl bg-pos text-white text-[13.5px] font-bold inline-flex items-center justify-center gap-1 disabled:opacity-50">
                      {busyId === r.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />} לאשר
                    </button>
                    <button onClick={() => answerAsk(r, false)} disabled={busyId === r.id} aria-label={`דחיית הבקשה של ${r.player_name}`}
                      className="h-11 w-11 rounded-xl bg-surface-page text-fg-muted inline-flex items-center justify-center disabled:opacity-50">
                      <X className="w-4 h-4" />
                    </button>
                  </span>
                ) : summary.open && (
                  <button onClick={() => cancel(r)} disabled={busyId === r.id} aria-label={`ביטול ההזמנה של ${r.player_name}`}
                    className="shrink-0 h-11 px-3.5 rounded-xl bg-surface-page text-fg-muted text-[13px] font-bold disabled:opacity-50">
                    {busyId === r.id ? <Loader2 className="w-4 h-4 animate-spin" /> : "ביטול"}
                  </button>
                )}
              </li>
            )
          })}
        </ul>
      )}
      {closedRequests.length > 0 && (
        <ul className="space-y-1">
          {closedRequests.map(r => (
            <li key={r.id} className="flex items-center gap-2 text-[12.5px] text-fg-muted">
              <span className="truncate">{r.player_name}</span>
              <span className={`shrink-0 text-[11px] font-bold px-2 py-0.5 rounded-full ${STATUS[r.status]?.cls || ""}`}>{STATUS[r.status]?.label || r.status}</span>
            </li>
          ))}
        </ul>
      )}

      {summary.open && anyRoom && !open && (
        <button onClick={() => setOpen(true)}
          className="w-full h-12 rounded-control bg-brand text-brand-fg text-[14.5px] font-bold inline-flex items-center justify-center gap-2">
          <Search className="w-4 h-4" /> חיפוש שחקן להשאלה
        </button>
      )}

      {open && (
        <div className="space-y-2.5 pt-1">
          <div className="flex items-center gap-2">
            {[["field", "שחקני שדה", summary.field_slots], ["gk", "שוער", summary.gk_slots]].map(([k, label, n]) => (
              <button key={k} type="button" onClick={() => setTab(k)} aria-pressed={tab === k}
                className={`h-11 px-4 rounded-full text-[13.5px] font-bold transition-colors ${tab === k ? "bg-brand text-brand-fg" : "bg-surface-page text-fg-strong"}`}>
                {label} <span className="fl-num opacity-70">{n}</span>
              </button>
            ))}
            <button onClick={() => { setOpen(false); setQuery("") }} aria-label="סגירה"
              className="ms-auto w-11 h-11 rounded-full bg-surface-page flex items-center justify-center text-fg-muted">
              <X className="w-4 h-4" />
            </button>
          </div>

          <label className="h-11 rounded-control bg-surface-page flex items-center gap-2 px-3">
            <Search className="w-4 h-4 text-fg-muted shrink-0" />
            <span className="sr-only">חיפוש שחקן</span>
            <input value={query} onChange={e => setQuery(e.target.value)} placeholder="חיפוש לפי שם או קבוצה"
              className="flex-1 min-w-0 bg-transparent text-[15px] text-fg-strong placeholder:text-fg-subtle focus:outline-none" />
          </label>

          {candidates === null ? (
            <div className="space-y-2">{[0, 1, 2, 3].map(i => <span key={i} className="skeleton block h-[52px] rounded-xl" />)}</div>
          ) : (
            <>
              {slotsForTab === 0 && (
                <p className="text-[12.5px] text-fg-strong rounded-xl bg-[#F2B233]/15 px-3 py-2">
                  {tab === "gk" ? (summary.own_gk > 0 ? "שוער הקבוצה כבר אישר הגעה — אין צורך בשוער מושאל." : "כבר הושאל שוער למשחק הזה.") : `יש כבר ${LOAN_FIELD_TARGET} שחקני שדה — אין מקום לעוד השאלה.`}
                </p>
              )}
              <p className="text-[12px] font-bold text-fg-muted">יכולים לשחק <span className="fl-num">{available.length}</span></p>
              {available.length === 0 && <p className="text-[13px] text-fg-muted">אין שחקנים זמינים{query ? " בחיפוש הזה" : ""}.</p>}
              <ul className="divide-y divide-line max-h-96 overflow-y-auto">
                {available.map(c => {
                  const inv = inviteOf(c)
                  return (
                    <li key={c.player_id} className="flex items-center gap-2.5 min-h-[60px] py-1.5">
                      <div className="min-w-0 flex-1">
                        <p className="text-[14.5px] font-bold text-fg-strong truncate">
                          {c.jersey_number != null && <span className="fl-num text-fg-muted font-normal">{c.jersey_number} · </span>}
                          {fullName(c)}{c.position === "Goalkeeper" ? <> <Goalkeeper className="w-4 h-4 inline-block align-[-2px]" title="שוער" /></> : null}
                        </p>
                        <p className="text-[12px] text-fg-muted truncate">
                          {c.team_name || "ללא קבוצה"}{c.age != null ? ` · גיל ${c.age}` : " · אין תאריך לידה"}
                          {!c.has_account && " · אין חשבון באפליקציה"}
                        </p>
                      </div>
                      {inv ? (
                        <span className="shrink-0 h-11 min-w-[76px] px-3 rounded-xl bg-surface-page text-fg-muted text-[13px] font-bold inline-flex items-center justify-center gap-1">
                          {inv.status === "pending" ? <><Hourglass className="w-4 h-4" /> נשלח</> : <><Check className="w-4 h-4" /> אישר</>}
                        </span>
                      ) : (
                        <button onClick={() => invite(c)} disabled={busyId === c.player_id || slotsForTab === 0}
                          className="shrink-0 h-11 min-w-[76px] px-3.5 rounded-xl bg-brand text-brand-fg text-[13.5px] font-bold inline-flex items-center justify-center gap-1.5 disabled:opacity-40">
                          {busyId === c.player_id ? <Loader2 className="w-4 h-4 animate-spin" />
                            : c.has_account ? <Send className="w-4 h-4" /> : <UserPlus className="w-4 h-4" />}
                          {c.has_account ? "להזמין" : "להוסיף"}
                        </button>
                      )}
                    </li>
                  )
                })}
              </ul>

              {blocked.length > 0 && (
                <div>
                  <button type="button" onClick={() => setShowBlocked(v => !v)} aria-expanded={showBlocked}
                    className="min-h-[44px] flex items-center gap-1.5 text-[13px] font-bold text-fg-muted">
                    <ChevronDown className={`w-4 h-4 transition-transform ${showBlocked ? "rotate-180" : ""}`} />
                    לא יכולים לשחק במשחק הזה <span className="fl-num">{blocked.length}</span>
                  </button>
                  {showBlocked && (
                    <ul className="divide-y divide-line max-h-72 overflow-y-auto opacity-70">
                      {blocked.map(c => (
                        <li key={c.player_id} className="flex items-center gap-2.5 min-h-[52px] py-1">
                          <div className="min-w-0 flex-1">
                            <p className="text-[14px] font-bold text-fg-strong truncate">{fullName(c)}</p>
                            <p className="text-[12px] text-fg-muted truncate">{c.team_name || "ללא קבוצה"}</p>
                          </div>
                          <span className="shrink-0 text-[12px] font-bold px-2.5 py-1.5 rounded-xl bg-surface-page text-fg-muted">
                            {LOAN_BLOCK_LABEL[c.block] || c.block}
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              )}
            </>
          )}
        </div>
      )}

      {err && <p className="text-[13px] text-neg">{err}</p>}
    </div>
  )
}
