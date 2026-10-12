import { useState, useEffect, useMemo } from "react"
import { X, Search, Loader2, UserPlus, Check, Cake } from "lucide-react"
import { useAuth } from "@/lib/AuthContext"
import { createClaim } from "@/lib/claims"
import { getMyLinkState, getLinkedPlayerIds, linkRequestErrorMessage, splitName } from "@/lib/linkRequests"
import PlayerCardSubmission from "@/components/PlayerCardSubmission"
import { getPlayers, getTeams } from "@/lib/api"
import { getMyBirthDate, setPlayerBirthDate } from "@/lib/birthDate"

/**
 * First-run onboarding prompt: once a freshly signed-in account is resolved and
 * is NOT yet linked to a player (and has no claim in flight), invite the user to
 * find + claim their player profile. It's a thin UI over the existing claim flow
 * (lib/claims.createClaim → admin/coach approves via approve_claim).
 *
 * Two roads out of it: claim a card that exists, or — when the search comes up empty —
 * submit a NEW card (PlayerCardSubmission, coach-approved). It used to offer only the
 * first, so a brand-new player's only button was "I didn't play / skip", which hid
 * onboarding for good and never mentioned the new-card form on /me.
 *
 * Suppressed for good (localStorage) by "אני לא שחקן/ית" or a sent request; "אחר כך"
 * only hides it for this browser session. A pending claim OR submission, a linked
 * player, or a FAILED read of that state all keep it hidden — a failed read must never
 * look like "nothing pending". Mounted globally in Layout, next to <AuthModal/>.
 *
 * A player who IS already linked gets the other prompt this file carries: a quiet
 * bottom-corner request for his date of birth when his card has none. 73 of 97 cards
 * were created before anyone asked, and the loan rule (under 18, or a goalkeeper)
 * cannot run without it. Coaches can now fill these in too, so this side is a nudge and
 * not a demand — no backdrop, nothing blocked, and "later" snoozes it for a month
 * rather than silencing it forever.
 */

const dismissKey = (uid) => `rink-onboarded:v1:${uid}`
const laterKey = (uid) => `rink-onboard-later:v1:${uid}`
const store = (kind) => { try { return window[kind] } catch { return null } }
const dobSnoozeKey = (uid) => `rink-dob-ask:v1:${uid}`
const DOB_SNOOZE_MS = 30 * 24 * 60 * 60 * 1000

export default function OnboardingModal() {
  const { user, profile, loading, refreshProfile } = useAuth()
  const [phase, setPhase] = useState("hidden") // 'hidden' | 'prompt' | 'create' | 'sent' | 'dob'
  const [dob, setDob] = useState("")             // the DOB nudge's input
  const [dobSaving, setDobSaving] = useState(false)
  const [dobErr, setDobErr] = useState(null)
  const [players, setPlayers] = useState([])
  const [linkedIds, setLinkedIds] = useState(() => new Set()) // cards that already belong to an account
  const [sentName, setSentName] = useState(null)
  const [teams, setTeams] = useState({}) // team_id -> { name, color }
  const [loadingList, setLoadingList] = useState(false)
  const [q, setQ] = useState("")
  const [selected, setSelected] = useState(null)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState(null)

  // Decide whether to surface the modal, once the account is fully resolved.
  useEffect(() => {
    let alive = true
    if (loading || !user || !profile) return
    if (profile.player_id) return // already linked to a player
    if (store("localStorage")?.getItem(dismissKey(user.id))) return // dismissed for good
    if (store("sessionStorage")?.getItem(laterKey(user.id))) return // "later", this session
    ;(async () => {
      // Don't nag a user who already has a claim OR a new card awaiting review. If the
      // read fails, stay quiet: we can't tell, and asking again invites a duplicate.
      try {
        const st = await getMyLinkState()
        if (!alive || st.pendingClaim || st.pendingSubmission) return
        setPhase(p => (p === "hidden" ? "prompt" : p))
      } catch { /* unknown state → don't prompt */ }
    })()
    return () => { alive = false }
  }, [user, profile, loading])

  // The other side of the same question: the account IS linked to a player, but that
  // player's card has no date of birth. Read per-row while signed in — the column is
  // revoked from `anon`, so it is never part of the public player list.
  useEffect(() => {
    let alive = true
    if (loading || !user || !profile?.player_id) return
    const snoozed = Number(localStorage.getItem(dobSnoozeKey(user.id)) || 0)
    if (Date.now() - snoozed < DOB_SNOOZE_MS) return
    getMyBirthDate(profile.player_id).then(d => {
      if (alive && !d) setPhase(p => (p === "hidden" ? "dob" : p))
    }).catch(() => {})
    return () => { alive = false }
  }, [user, profile, loading])

  // Lazy-load the player + team lists the first time the prompt opens (public reads).
  useEffect(() => {
    if (phase !== "prompt" || players.length) return
    let alive = true
    setLoadingList(true)
    Promise.all([getPlayers("goals", false), getTeams(), getLinkedPlayerIds().catch(() => new Set())])
      .then(([pl, tm, linked]) => {
        if (!alive) return
        const map = {}
        for (const t of tm || []) map[t.id] = { name: t.name, color: t.primary_color }
        setTeams(map)
        setLinkedIds(linked)
        setPlayers(pl || [])
      })
      .catch(() => {})
      .finally(() => alive && setLoadingList(false))
    return () => { alive = false }
  }, [phase, players.length])

  const results = useMemo(() => {
    const s = q.trim()
    if (!s) return []
    const num = /^\d{1,2}$/.test(s) ? Number(s) : null
    return players
      .filter(p => num != null
        ? p.jersey_number === num
        : `${p.first_name} ${p.last_name}`.includes(s) || `${p.last_name} ${p.first_name}`.includes(s))
      .slice(0, 8)
  }, [q, players])

  // "I'm not a player" — never ask this account again on this device.
  const dismiss = () => {
    if (user) store("localStorage")?.setItem(dismissKey(user.id), String(Date.now()))
    setPhase("hidden")
  }
  // "Later" / X / backdrop — ask again next visit, not now.
  const later = () => {
    if (user) store("sessionStorage")?.setItem(laterKey(user.id), "1")
    setPhase("hidden")
  }

  const submit = async () => {
    if (!selected) return
    setSubmitting(true); setError(null)
    try {
      await createClaim(selected.id)
      if (user) store("localStorage")?.setItem(dismissKey(user.id), String(Date.now()))
      setSentName(`${selected.first_name} ${selected.last_name}`)
      setPhase("sent")
    } catch (e) {
      setError(linkRequestErrorMessage(e))
      if (/profile_already_linked/.test(e?.message || "")) refreshProfile?.()
    } finally {
      setSubmitting(false)
    }
  }

  const snoozeDob = () => {
    if (user) localStorage.setItem(dobSnoozeKey(user.id), String(Date.now()))
    setPhase("hidden")
  }

  const saveDob = async () => {
    if (!dob || !profile?.player_id) return
    setDobSaving(true); setDobErr(null)
    try {
      await setPlayerBirthDate(profile.player_id, dob)
      if (user) localStorage.setItem(dobSnoozeKey(user.id), String(Date.now()))
      setPhase("hidden")
    } catch (e) { setDobErr(e.message) } finally { setDobSaving(false) }
  }

  if (phase === "hidden") return null

  // Not on the list → propose a new card (coach-approved), prefilled with the search.
  if (phase === "create") {
    return (
      <PlayerCardSubmission
        initialName={splitName(q)}
        onSubmitted={() => { if (user) store("localStorage")?.setItem(dismissKey(user.id), String(Date.now())) }}
        onClose={() => setPhase(p => (p === "create" && user && store("localStorage")?.getItem(dismissKey(user.id)) ? "hidden" : "prompt"))}
      />
    )
  }

  // Deliberately not a modal: no backdrop, nothing blocked, pinned to the bottom-right
  // (the chat launcher owns the bottom-left) and clear of the iOS home indicator.
  if (phase === "dob") {
    return (
      <div dir="rtl" style={{ bottom: 'max(1rem, env(safe-area-inset-bottom))' }}
        className="fixed right-4 left-4 sm:left-auto sm:w-[340px] z-[45] card p-4 shadow-xl space-y-2.5">
        <div className="flex items-start gap-2">
          <Cake className="w-4 h-4 text-brand shrink-0 mt-0.5" />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-bold text-slate-900 dark:text-white">מה תאריך הלידה שלך?</p>
            <p className="text-[11px] text-slate-500 dark:text-slate-400 leading-relaxed mt-0.5">
              הליגה משתמשת בו כדי לקבוע אם אפשר להשאיל אותך לקבוצה אחרת (עד גיל 18,
              או שוער/ת בכל גיל).
            </p>
          </div>
          <button onClick={snoozeDob} aria-label="סגור"
            className="shrink-0 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"><X className="w-4 h-4" /></button>
        </div>
        <input type="date" dir="ltr" value={dob} max={new Date().toLocaleDateString("en-CA")}
          onChange={e => { setDob(e.target.value); setDobErr(null) }} aria-label="תאריך לידה"
          className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg px-2.5 py-2 text-sm text-slate-800 dark:text-slate-100 tabular-nums focus:outline-none focus:ring-2 focus:ring-brand/30" />
        {dobErr && <p className="text-[11px] text-red-600 dark:text-red-400">{dobErr}</p>}
        <div className="flex items-center gap-2">
          <button onClick={saveDob} disabled={!dob || dobSaving}
            className="flex items-center gap-1.5 text-xs font-bold px-3 py-1.5 rounded-lg bg-brand text-brand-fg hover:bg-brand-hover transition-colors disabled:opacity-40 disabled:cursor-not-allowed">
            {dobSaving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />} שמירה
          </button>
          <button onClick={snoozeDob}
            className="text-xs font-semibold px-3 py-1.5 rounded-lg text-slate-500 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors">
            אחר כך
          </button>
        </div>
      </div>
    )
  }

  const btnLink = "text-xs font-semibold text-brand dark:text-brand-light hover:underline"
  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4" dir="rtl">
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={later} />
      <div className="relative card w-full max-w-md p-6 shadow-2xl">
        <button
          onClick={later}
          className="absolute top-4 left-4 p-1.5 rounded-lg text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors"
          aria-label="סגור"
        >
          <X className="w-5 h-5" />
        </button>

        {phase === "sent" ? (
          <div className="text-center py-6">
            <div className="w-14 h-14 rounded-full bg-emerald-100 dark:bg-emerald-900/40 flex items-center justify-center mx-auto mb-4">
              <Check className="w-7 h-7 text-emerald-600 dark:text-emerald-400" />
            </div>
            <h3 className="text-lg font-extrabold text-slate-900 dark:text-white">הבקשה נשלחה 🛼</h3>
            <p className="text-sm text-slate-500 dark:text-slate-400 mt-2">
              בקשת השיוך ל־<span className="font-semibold text-slate-700 dark:text-slate-300">{sentName}</span> ממתינה לאישור המאמן או מנהל הליגה. נעדכן אותך כשהיא תאושר.
            </p>
            <button onClick={() => setPhase("hidden")} className="mt-5 w-full py-2.5 rounded-xl bg-brand text-white font-semibold hover:bg-brand-hover transition-colors">
              מעולה
            </button>
          </div>
        ) : (
          <>
            <div className="w-12 h-12 rounded-2xl bg-brand/10 flex items-center justify-center mb-3">
              <UserPlus className="w-6 h-6 text-brand" />
            </div>
            <h2 className="text-xl font-extrabold text-slate-900 dark:text-white">שיחקת בליגה?</h2>
            <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
              מצא/י את כרטיס השחקן שלך ושייך/י אותו לחשבון — כדי לראות את הסטטיסטיקות, המשחקים והתמונות שלך. אין לך כרטיס? אפשר לפתוח חדש.
            </p>

            <div className="relative mt-4">
              <Search className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
              <input
                autoFocus
                value={q}
                onChange={e => { setQ(e.target.value); setSelected(null); setError(null) }}
                placeholder="חיפוש לפי שם או מספר…"
                className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl pr-9 pl-3 py-2.5 text-sm text-slate-800 dark:text-slate-100 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-brand/30 focus:border-brand"
              />
            </div>

            <div className="mt-3 min-h-[3rem] max-h-60 overflow-y-auto -mx-1 px-1">
              {loadingList ? (
                <div className="flex items-center justify-center py-6 text-slate-400"><Loader2 className="w-5 h-5 animate-spin" /></div>
              ) : q.trim() && results.length === 0 ? (
                <div className="text-center py-5 space-y-2.5">
                  <p className="text-sm font-semibold text-slate-700 dark:text-slate-200">לא מצאנו אותך?</p>
                  <button onClick={() => setPhase("create")}
                    className="inline-flex items-center gap-1.5 text-xs font-bold px-3 py-2 rounded-lg bg-brand text-white hover:bg-brand-hover transition-colors">
                    <UserPlus className="w-3.5 h-3.5" /> יצירת כרטיס שחקן חדש
                  </button>
                </div>
              ) : !q.trim() ? (
                <p className="text-center text-xs text-slate-400 py-6">התחילו להקליד את שמכם…</p>
              ) : (
                <div className="space-y-1">
                  {results.map(p => {
                    const team = teams[p.team_id]
                    const isSel = selected?.id === p.id
                    const taken = linkedIds.has(p.id)
                    return (
                      <button
                        key={p.id}
                        disabled={taken}
                        onClick={() => setSelected(p)}
                        className={`w-full flex items-center gap-3 px-3 py-2 rounded-xl text-right transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${isSel ? "bg-brand/10 ring-1 ring-brand/40" : "hover:bg-slate-50 dark:hover:bg-slate-800"}`}
                      >
                        <span className="w-8 h-8 rounded-full shrink-0 flex items-center justify-center text-white text-xs font-bold" style={{ backgroundColor: team?.color || "#94a3b8" }}>
                          {p.jersey_number ?? (p.first_name?.charAt(0) || "?")}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block text-sm font-semibold text-slate-900 dark:text-white truncate">{p.first_name} {p.last_name}</span>
                          <span className="block text-[11px] text-slate-400 truncate">
                            {taken ? "כבר משויך לחשבון" : team?.name || "שחקן/ית חופשי/ה"}
                          </span>
                        </span>
                        {isSel && <Check className="w-4 h-4 text-brand shrink-0" />}
                      </button>
                    )
                  })}
                </div>
              )}
            </div>

            {error && <p className="text-xs text-red-600 dark:text-red-400 font-medium bg-red-50 dark:bg-red-950/40 rounded-lg px-3 py-2 mt-2">{error}</p>}

            <button
              onClick={submit}
              disabled={!selected || submitting}
              className="mt-4 w-full py-2.5 rounded-xl bg-brand text-white font-bold hover:bg-brand-hover transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
            >
              {submitting && <Loader2 className="w-4 h-4 animate-spin" />}
              בקשת שיוך לכרטיס
            </button>
            {(!q.trim() || results.length > 0) && (
              <p className="mt-3 text-center">
                <button onClick={() => setPhase("create")} className={btnLink}>לא מצאתי את עצמי — יצירת כרטיס חדש</button>
              </p>
            )}
            <div className="mt-3 pt-3 border-t border-slate-100 dark:border-slate-700/50 flex items-center justify-between gap-2">
              <button onClick={dismiss} className="text-xs font-semibold px-3 py-1.5 rounded-lg text-slate-500 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors">
                אני לא שחקן/ית
              </button>
              <button onClick={later} className="text-xs font-semibold px-3 py-1.5 rounded-lg text-slate-500 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors">
                אחר כך
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
