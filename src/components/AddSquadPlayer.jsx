import { useState, useMemo, useEffect } from "react"
import { addPlayerToSquad, getTeamMemberIds } from "@/lib/squad"
import { canBeBorrowed, getPlayerLoanAges, YOUTH_MAX_AGE } from "@/lib/birthDate"
import { UserPlus, Loader2, X, Users } from "lucide-react"

/**
 * Manual squad addition (sheet rows 7, 8, 13). A coach adds a loaned goalkeeper or a
 * one-time youth call-up before kick-off; a judge may do it once the game is running.
 *
 * The default list is ELIGIBLE players, not the whole league: a coach who opened this got
 * all ~100 cards in the league and had to hunt. Eligible = this team's own roster, plus —
 * from other clubs — whoever the loan rule can actually admit: a goalkeeper of any age, or
 * a player whose date of birth proves he is under 18. Everyone else sits behind
 * "הצג את כל השחקנים", because with no DOB on file nobody can tell from here whether the
 * loan is legal — only the coach can, and that is exactly what he is vouching for.
 *
 * Filtering on eligibility rather than on an age group is deliberate: every team in this
 * league is registered 'senior', including the two squads *named* נוער, so an age-group
 * filter would hide precisely the youth players it was meant to show. This list also
 * widens on its own as birth dates arrive, with no further work.
 *
 * Own-roster membership is read from player_teams as well as players.team_id, matching
 * the server: a player whose primary card sits on another age group's team is still one
 * of this team's own, and must not be treated as a loan.
 *
 * The age rule applies only to a LOAN. It is computed from the date of birth on the player
 * card, so there is normally nothing to confirm; the coach's confirmation appears only
 * where no DOB is on file, which would otherwise make every loan of an unregistered player
 * impossible. The server re-checks all of it.
 */
export default function AddSquadPlayer({ gameId, teamId, teamName, players = [], excludeIds, onAdded, ownOnly = false }) {
  const [open, setOpen] = useState(false)
  const [playerId, setPlayerId] = useState("")
  const [note, setNote] = useState("")
  const [ageOk, setAgeOk] = useState(false)
  const [showAll, setShowAll] = useState(false)
  const [memberIds, setMemberIds] = useState(new Set())
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState(null)

  const [ages, setAges] = useState(null)        // playerId → age in years | null; null = not loaded

  // Both lookups are needed only once the coach actually opens the form, and both are
  // cheap enough to do in one go: the roster is one small query, and the DOB map is one
  // request instead of a round trip per row while he scrolls the list.
  useEffect(() => {
    if (!open) return
    let alive = true
    getTeamMemberIds(teamId).then(s => { if (alive) setMemberIds(s) })
    getPlayerLoanAges().then(map => { if (alive) setAges(map) })
    return () => { alive = false }
  }, [open, teamId])

  // One of this team's own players — by primary card or by roster row, same as the server.
  const isOwn = (p) => p.team_id === teamId || memberIds.has(p.id)
  // Can he be borrowed on what we know right now? A keeper always; anyone else only with a
  // DOB that proves it. "Don't know" is NOT eligible — it is the coach's call, behind the
  // toggle, and the confirmation there says so.
  const provenEligible = (p) =>
    p.position === "Goalkeeper" || ((ages?.[p.id] ?? 99) < YOUTH_MAX_AGE)

  // Grouped by the player's own team so "בהשאלה מ…" is obvious at a glance.
  const { grouped, hiddenCount } = useMemo(() => {
    const skip = excludeIds instanceof Set ? excludeIds : new Set(excludeIds || [])
    const byTeam = new Map()
    let hidden = 0
    for (const p of players) {
      if (skip.has(p.id)) continue
      // ownOnly: borrowing goes through LoanFinder (an invite the player answers), so this
      // form lists the team's own players only.
      if (ownOnly && !isOwn(p)) continue
      if (!showAll && !isOwn(p) && !provenEligible(p)) { hidden++; continue }
      const label = p.teamName || "ללא קבוצה"
      if (!byTeam.has(label)) byTeam.set(label, [])
      byTeam.get(label).push(p)
    }
    for (const list of byTeam.values()) {
      list.sort((a, b) => `${a.first_name} ${a.last_name}`.localeCompare(`${b.first_name} ${b.last_name}`, "he"))
    }
    // the coach's own team first, then the rest alphabetically
    const entries = [...byTeam.entries()].sort(([a], [b]) =>
      a === teamName ? -1 : b === teamName ? 1 : a.localeCompare(b, "he"))
    return { grouped: entries, hiddenCount: hidden }
  }, [players, excludeIds, teamName, showAll, memberIds, ages, ownOnly])

  const picked = players.find(p => p.id === playerId) || null
  // Borrowing = the player isn't one of this team's own. Only then does the age rule bite.
  const isLoan = !!picked && !isOwn(picked)

  // No per-row fallback any more, and none is needed: squad_loan_ages() answers for every
  // player in one request, for exactly the roles entitled to judge a loan. If it fails we
  // hold {} — which reads as "no date on file" and routes the coach to the vouch checkbox,
  // the same defined path as a player who never registered. It never yields a WRONG answer,
  // only a more cautious one.
  const pickedWithAge = picked ? { ...picked, age_years: ages?.[picked.id] ?? null } : null
  const borrow = isLoan ? canBeBorrowed(pickedWithAge) : { ok: true, reason: "own" }
  // While the DOB is still in flight we know nothing — don't flash the fallback checkbox
  // and don't let the form be submitted on a guess.
  const dobPending = isLoan && ages === null
  // The checkbox is a FALLBACK, needed only when we have no DOB to judge by.
  const needsTick = isLoan && !dobPending && borrow.reason === "no-dob"
  const blocked = isLoan && !dobPending && !borrow.ok && borrow.reason !== "no-dob"

  const reset = () => { setPlayerId(""); setNote(""); setAgeOk(false); setErr(null) }

  const submit = async (e) => {
    e.preventDefault()
    if (!playerId) { setErr("יש לבחור שחקן"); return }
    setSaving(true); setErr(null)
    try {
      await addPlayerToSquad(gameId, playerId, teamId, { note: note.trim() || null, ageConfirmed: needsTick ? ageOk : true })
      reset(); setOpen(false)
      onAdded?.()
    } catch (e2) {
      setErr(e2.message)
    } finally { setSaving(false) }
  }

  if (!open) {
    return (
      <button onClick={() => setOpen(true)}
        className="mt-2 inline-flex items-center gap-1.5 text-[11px] font-semibold px-2.5 py-1.5 rounded-lg border border-dashed border-slate-300 dark:border-slate-600 text-slate-500 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-700/60 transition-colors">
        <UserPlus className="w-3.5 h-3.5" /> {ownOnly ? "הוספת שחקן מהקבוצה" : "הוספת שחקן ידנית"}
      </button>
    )
  }

  return (
    <form onSubmit={submit} className="mt-2 p-3 rounded-lg bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 space-y-2">
      <div className="flex items-center justify-between gap-2">
        <p className="text-[11px] font-bold text-slate-700 dark:text-slate-200">הוספת שחקן ל{teamName}</p>
        <button type="button" onClick={() => { reset(); setOpen(false) }} aria-label="ביטול"
          className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200">
          <X className="w-3.5 h-3.5" />
        </button>
      </div>

      <select value={playerId} onChange={e => setPlayerId(e.target.value)} aria-label="בחירת שחקן"
        className="w-full bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg px-2.5 py-1.5 text-xs text-slate-800 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-brand/30">
        <option value="">בחר שחקן…</option>
        {grouped.map(([label, list]) => (
          <optgroup key={label} label={label}>
            {/* The shirt number leads, because that is what the judge is reading off a
                back on the rink. Squads share first names; "7 · יובל" is unambiguous
                where "יובל" is not. Players with no number on file show "–" rather than
                a fake 0 (75 of the league's 95 have none). */}
            {list.map(p => (
              <option key={p.id} value={p.id}>
                {p.jersey_number ?? "–"} · {p.first_name} {p.last_name}{p.position === "Goalkeeper" ? " 🧤" : ""}
              </option>
            ))}
          </optgroup>
        ))}
      </select>

      {/* Say what was filtered out and why — a coach who can't find a player he knows
          exists must not be left thinking the app lost him. */}
      {!ownOnly && (hiddenCount > 0 || showAll) && (
        <div className="flex items-start justify-between gap-2 text-[11px]">
          <span className="flex items-start gap-1 text-slate-500 dark:text-slate-400">
            <Users className="w-3 h-3 mt-0.5 shrink-0" />
            <span>
              {showAll
                ? "מוצגים כל שחקני הליגה — להשאלה מקבוצה אחרת נדרש אישורך"
                : `מוצגים ${teamName}, שוערים, ושחקנים שידוע שהם עד גיל ${YOUTH_MAX_AGE} · ${hiddenCount} מוסתרים`}
            </span>
          </span>
          <button type="button" onClick={() => { setShowAll(v => !v); if (showAll) setPlayerId("") }}
            className="shrink-0 font-semibold text-brand hover:underline">
            {showAll ? "חזרה לרשימה המסוננת" : "הצג את כל השחקנים"}
          </button>
        </div>
      )}

      <input value={note} onChange={e => setNote(e.target.value)} maxLength={80}
        placeholder="הערה (למשל: שוער בהשאלה)" aria-label="הערה"
        className="w-full bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg px-2.5 py-1.5 text-xs text-slate-800 dark:text-slate-100 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-brand/30" />

      {/* The age rule applies only to a LOAN, and only when we can't work it out
          ourselves. With a date of birth on the card there is nothing to confirm. */}
      {isLoan && (
        <p className={`text-[11px] leading-relaxed ${blocked ? "text-red-600 dark:text-red-400" : "text-slate-500 dark:text-slate-400"}`}>
          {dobPending
            ? "בודק/ת תאריך לידה…"
            : borrow.reason === "goalkeeper"
            ? "שוער/ת — מותר להשאיל בכל גיל"
            : borrow.reason === "youth"
              ? `בן/בת ${borrow.age} — מותר להשאיל (עד גיל 18)`
              : borrow.reason === "too-old"
                ? `בן/בת ${borrow.age} — אי אפשר להשאיל שחקן/ית מעל גיל 18 שאינו/ה שוער/ת`
                : "אין תאריך לידה בכרטיס השחקן — יש לאשר ידנית"}
        </p>
      )}

      {/* Named, not generic: this is the coach personally standing behind one specific
          player's eligibility, so the text has to say whose and against which rule. */}
      {needsTick && (
        <label className="flex items-start gap-2 text-[11px] text-slate-600 dark:text-slate-300 cursor-pointer">
          <input type="checkbox" checked={ageOk} onChange={e => setAgeOk(e.target.checked)}
            className="mt-0.5 accent-brand" />
          <span>
            אני מאשר/ת ש<strong className="font-bold">{picked.first_name} {picked.last_name}</strong> עומד/ת
            בתנאי ההשאלה: עד גיל {YOUTH_MAX_AGE}, או שוער/ת בכל גיל. אין תאריך לידה בכרטיס השחקן, ולכן האישור באחריותי.
          </span>
        </label>
      )}

      {err && <p className="text-[11px] text-red-600 dark:text-red-400">{err}</p>}

      <button type="submit" disabled={saving || !playerId || dobPending || blocked || (needsTick && !ageOk)}
        className="w-full flex items-center justify-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-lg bg-brand text-white hover:opacity-90 transition-opacity disabled:opacity-40 disabled:cursor-not-allowed">
        {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <UserPlus className="w-3.5 h-3.5" />}
        הוספה לסגל
      </button>
    </form>
  )
}
