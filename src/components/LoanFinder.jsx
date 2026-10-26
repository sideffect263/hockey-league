import { useState, useEffect, useMemo } from "react"
import {
  getLoanCandidates, getLoanSummary, requestLoan, cancelLoan, setLoanCall, respondLoanJoin,
  LOAN_BLOCK_LABEL, LOAN_FIELD_TARGET,
} from "@/lib/loans"
import { addPlayerToSquad } from "@/lib/squad"
import { Search, Send, X, Loader2, Handshake, UserPlus, ChevronDown, Check, Megaphone } from "lucide-react"
import { Hourglass, Goalkeeper } from "@/components/icons/BrandIcons"

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
  accepted:  { label: "אישר ✓",        cls: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300" },
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

  return (
    <div className="mt-3 p-3 rounded-lg border border-brand/20 bg-brand/5 dark:bg-brand/10 space-y-2.5">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <p className="flex items-center gap-1.5 text-xs font-bold text-slate-800 dark:text-slate-100">
          <Handshake className="w-4 h-4 text-brand" /> השאלת שחקנים
        </p>
        <span className={`text-[10px] font-bold px-2 py-0.5 rounded ${signed >= LOAN_FIELD_TARGET ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300" : "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300"}`}>
          {signed}/{LOAN_FIELD_TARGET} שחקני שדה
        </span>
      </div>

      <p className="text-[11px] text-slate-600 dark:text-slate-300 leading-relaxed">
        {!summary.open
          ? "המשחק כבר התחיל — אי אפשר לשלוח הזמנות."
          : summary.field_slots > 0
            ? <>אפשר להשאיל עוד <strong>{summary.field_slots}</strong> שחקני שדה{summary.gk_slots > 0 ? " ושוער אחד" : ""}. השחקן מקבל הזמנה ומאשר בעצמו.</>
            : summary.gk_slots > 0
              ? `יש ${LOAN_FIELD_TARGET} שחקני שדה — אפשר להשאיל רק שוער.`
              : "הסגל מלא — אין צורך בהשאלה."}
        {summary.open && summary.loan_field > 0 && (
          <span className="block text-slate-500 dark:text-slate-400">
            אם יירשמו עוד שחקנים מהקבוצה, המושאל האחרון יוסר אוטומטית והוא יקבל הודעה.
          </span>
        )}
      </p>

      {/* Raise a hand instead of chasing one player: the call shows on /loans to every
          player who could come, and their asks land in the list below. */}
      {summary.open && (anyRoom || call.need_field || call.need_gk) && (
        <div className="p-2 rounded-lg bg-white/70 dark:bg-slate-900/40 border border-slate-200 dark:border-slate-700 space-y-1.5">
          <p className="flex items-center gap-1.5 text-[11px] font-semibold text-slate-700 dark:text-slate-200">
            <Megaphone className="w-3.5 h-3.5 text-brand" /> מחפשים שחקנים? פרסמו בעמוד ההשאלות
          </p>
          <div className="flex items-center gap-1.5 flex-wrap">
            {[["field", "שחקן שדה", call.need_field, summary.field_slots], ["gk", "שוער", call.need_gk, summary.gk_slots]].map(([k, label, on, slots]) => (
              <button key={k} onClick={() => toggleCall(k)} disabled={callBusy || (!on && slots === 0)} role="switch" aria-checked={on}
                className={`inline-flex items-center gap-1.5 text-[11px] font-semibold px-2.5 py-1 rounded-full transition-colors disabled:opacity-40 ${on ? "bg-brand text-white" : "border border-slate-300 dark:border-slate-600 text-slate-600 dark:text-slate-300"}`}>
                <span className={`w-2 h-2 rounded-full ${on ? "bg-white" : "bg-slate-300 dark:bg-slate-600"}`} />
                {label}{on ? " — מחפשים" : ""}
              </button>
            ))}
            {callBusy && <Loader2 className="w-3.5 h-3.5 animate-spin text-slate-400" />}
          </div>
          {(call.need_field || call.need_gk) && (
            <input value={callNote} onChange={e => setCallNote(e.target.value)} onBlur={saveCallNote} maxLength={80}
              placeholder="הערה לשחקנים (לא חובה) — למשחק ב-17:00 חסרים לנו 2" aria-label="הערה לשחקנים"
              className="w-full bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg px-2.5 py-1 text-[11px] text-slate-800 dark:text-slate-100 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-brand/30" />
          )}
          {(call.need_field || call.need_gk) && (
            <p className="text-[10px] text-slate-500 dark:text-slate-400">
              שחקנים שיכולים לשחק קיבלו הודעה. הפרסום יורד לבד כשהסגל מתמלא.
            </p>
          )}
        </div>
      )}

      {openRequests.length > 0 && (
        <ul className="space-y-1">
          {openRequests.map(r => (
            <li key={r.id} className="flex items-center gap-1.5 text-xs text-slate-700 dark:text-slate-300">
              <span className="truncate">{r.player_name}{r.position === "Goalkeeper" ? <> <Goalkeeper className="w-4 h-4 inline-block align-[-2px]" title="שוער" /></> : null}</span>
              <span className="text-[10px] text-slate-400 truncate">({r.team_name || "ללא קבוצה"})</span>
              <span className={`shrink-0 text-[9px] font-bold px-1.5 py-0.5 rounded ${STATUS[r.status].cls}`}>
                {r.initiated_by === "player" && r.status === "pending" ? `ביקש/ה להצטרף${r.age != null ? ` · בן/בת ${r.age}` : ""}` : STATUS[r.status].label}
              </span>
              {summary.open && r.initiated_by === "player" && r.status === "pending" ? (
                <span className="ms-auto shrink-0 flex items-center gap-1">
                  <button onClick={() => answerAsk(r, true)} disabled={busyId === r.id}
                    className="inline-flex items-center gap-0.5 text-[10px] font-semibold px-2 py-0.5 rounded bg-emerald-500 text-white disabled:opacity-50">
                    {busyId === r.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <Check className="w-3 h-3" />} אישור
                  </button>
                  <button onClick={() => answerAsk(r, false)} disabled={busyId === r.id}
                    className="inline-flex items-center gap-0.5 text-[10px] font-semibold px-2 py-0.5 rounded border border-slate-200 dark:border-slate-600 text-slate-600 dark:text-slate-300 disabled:opacity-50">
                    <X className="w-3 h-3" /> דחייה
                  </button>
                </span>
              ) : summary.open && (
                <button onClick={() => cancel(r)} disabled={busyId === r.id} aria-label={`ביטול ההזמנה של ${r.player_name}`}
                  className="ms-auto shrink-0 text-[10px] font-semibold text-slate-400 hover:text-red-500 disabled:opacity-50">
                  {busyId === r.id ? <Loader2 className="w-3 h-3 animate-spin" /> : "ביטול"}
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      {closedRequests.length > 0 && (
        <ul className="space-y-0.5">
          {closedRequests.map(r => (
            <li key={r.id} className="flex items-center gap-1.5 text-[11px] text-slate-500 dark:text-slate-400">
              <span className="truncate">{r.player_name}</span>
              <span className={`shrink-0 text-[9px] font-bold px-1.5 py-0.5 rounded ${STATUS[r.status]?.cls || ""}`}>{STATUS[r.status]?.label || r.status}</span>
            </li>
          ))}
        </ul>
      )}

      {summary.open && anyRoom && !open && (
        <button onClick={() => setOpen(true)}
          className="w-full flex items-center justify-center gap-1.5 text-xs font-semibold px-3 py-2 rounded-lg bg-brand text-white hover:opacity-90 transition-opacity">
          <Search className="w-3.5 h-3.5" /> חיפוש שחקן להשאלה
        </button>
      )}

      {open && (
        <div className="space-y-2 pt-1">
          <div className="flex items-center gap-1.5">
            {[["field", `שחקני שדה (${summary.field_slots})`], ["gk", `שוער (${summary.gk_slots})`]].map(([k, label]) => (
              <button key={k} onClick={() => setTab(k)}
                className={`text-[11px] font-semibold px-2.5 py-1 rounded-lg transition-colors ${tab === k ? "bg-brand text-white" : "border border-slate-200 dark:border-slate-600 text-slate-600 dark:text-slate-300"}`}>
                {label}
              </button>
            ))}
            <button onClick={() => { setOpen(false); setQuery("") }} aria-label="סגירה"
              className="ms-auto text-slate-400 hover:text-slate-600 dark:hover:text-slate-200">
              <X className="w-4 h-4" />
            </button>
          </div>

          <input value={query} onChange={e => setQuery(e.target.value)} placeholder="חיפוש לפי שם או קבוצה" aria-label="חיפוש שחקן"
            className="w-full bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg px-2.5 py-1.5 text-xs text-slate-800 dark:text-slate-100 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-brand/30" />

          {candidates === null ? (
            <p className="flex items-center gap-1.5 text-[11px] text-slate-400"><Loader2 className="w-3 h-3 animate-spin" /> טוען שחקנים…</p>
          ) : (
            <>
              {slotsForTab === 0 && (
                <p className="text-[11px] text-amber-700 dark:text-amber-300">
                  {tab === "gk" ? (summary.own_gk > 0 ? "שוער הקבוצה כבר אישר הגעה — אין צורך בשוער מושאל." : "כבר הושאל שוער למשחק הזה.") : `יש כבר ${LOAN_FIELD_TARGET} שחקני שדה — אין מקום לעוד השאלה.`}
                </p>
              )}
              <p className="text-[10px] font-semibold text-slate-500 dark:text-slate-400">יכולים לשחק ({available.length})</p>
              {available.length === 0 && <p className="text-[11px] text-slate-400">אין שחקנים זמינים{query ? " בחיפוש הזה" : ""}.</p>}
              <ul className="divide-y divide-slate-100 dark:divide-slate-700/60 max-h-80 overflow-y-auto">
                {available.map(c => {
                  const inv = inviteOf(c)
                  return (
                    <li key={c.player_id} className="flex items-center gap-2 py-1.5">
                      <div className="min-w-0 flex-1">
                        <p className="text-xs font-semibold text-slate-800 dark:text-slate-100 truncate">
                          {c.jersey_number != null && <span className="text-slate-400 font-normal">{c.jersey_number} · </span>}
                          {fullName(c)}{c.position === "Goalkeeper" ? <> <Goalkeeper className="w-4 h-4 inline-block align-[-2px]" title="שוער" /></> : null}
                        </p>
                        <p className="text-[10px] text-slate-500 dark:text-slate-400 truncate">
                          {c.team_name || "ללא קבוצה"}{c.age != null ? ` · בן/בת ${c.age}` : " · אין תאריך לידה"}
                          {!c.has_account && " · אין חשבון באפליקציה"}
                        </p>
                      </div>
                      {inv ? (
                        <span className={`shrink-0 inline-flex items-center gap-1 text-[10px] font-bold px-2 py-1 rounded ${STATUS[inv.status].cls}`}>
                          {inv.status === "pending" ? <Hourglass className="w-4 h-4" /> : <Check className="w-3 h-3" />} {STATUS[inv.status].label}
                        </span>
                      ) : (
                        <button onClick={() => invite(c)} disabled={busyId === c.player_id || slotsForTab === 0}
                          className="shrink-0 inline-flex items-center gap-1 text-[11px] font-semibold px-2.5 py-1 rounded-lg bg-brand text-white hover:opacity-90 transition-opacity disabled:opacity-40">
                          {busyId === c.player_id ? <Loader2 className="w-3 h-3 animate-spin" />
                            : c.has_account ? <Send className="w-3 h-3" /> : <UserPlus className="w-3 h-3" />}
                          {c.has_account ? "הזמנה" : "הוספה"}
                        </button>
                      )}
                    </li>
                  )
                })}
              </ul>

              {blocked.length > 0 && (
                <div>
                  <button onClick={() => setShowBlocked(v => !v)}
                    className="flex items-center gap-1 text-[10px] font-semibold text-slate-500 dark:text-slate-400 hover:text-slate-700">
                    <ChevronDown className={`w-3 h-3 transition-transform ${showBlocked ? "rotate-180" : ""}`} />
                    לא יכולים לשחק במשחק הזה ({blocked.length})
                  </button>
                  {showBlocked && (
                    <ul className="mt-1 space-y-0.5 max-h-60 overflow-y-auto">
                      {blocked.map(c => (
                        <li key={c.player_id} className="flex items-center gap-1.5 text-[11px] text-slate-500 dark:text-slate-400">
                          <span className="truncate">{fullName(c)}</span>
                          <span className="text-[10px] truncate">({c.team_name || "ללא קבוצה"})</span>
                          <span className="ms-auto shrink-0 text-[9px] font-bold px-1.5 py-0.5 rounded bg-slate-100 dark:bg-slate-700">
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

      {err && <p className="text-[11px] text-red-600 dark:text-red-400">{err}</p>}
    </div>
  )
}
