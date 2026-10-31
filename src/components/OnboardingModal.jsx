import { useState, useEffect, useMemo, useRef } from "react"
import { useAuth } from "@/lib/AuthContext"
import { createClaim } from "@/lib/claims"
import { getMyLinkState, getLinkedPlayerIds, linkRequestErrorMessage, splitName } from "@/lib/linkRequests"
import { NewCardFields, emptyCard, cardComplete, submitCard } from "@/components/PlayerCardSubmission"
import { getPlayers, getTeams } from "@/lib/api"
import { getMyBirthDate, setPlayerBirthDate } from "@/lib/birthDate"
import { requestOfficialRole } from "@/lib/roleRequests"
import { follow, unfollow, getMyTeamFollowRows } from "@/lib/follows"
import { edge, deep, onColor, teamIsLight } from "@/lib/flTeam"
import TeamLogo from "@/components/TeamLogo"
import { BrandIcon } from "@/components/icons/BrandIcons"
import {
  OnbPage, ChoiceCard, CheckBox, CTA, AccButton, Glyph, Spinner, Notice, inputCls, errText,
} from "@/components/fl/account/AccountKit"
import "@/components/fl/account/account.css"

/**
 * First-run onboarding in the Floodlight look (boards OnbTerms, OnbWho, OnbFind,
 * OnbNewCard, OnbCoach, OnbRef, OnbFollow, OnbDone, OnbChange; reference: iOS
 * OnboardingFlow.swift). ONE path for every account; each chosen role adds its own short
 * step in a fixed order:
 *
 *   תנאים → מי אתה בליגה? → [שחקן: מציאת כרטיס | כרטיס חדש] → [מאמן] → [שופט] → קבוצות → מוכן
 *
 * Every step after "who" has a back button, going back keeps what was filled in, and the
 * draft is kept on this device per account, so leaving resumes on the same step. NOTHING
 * is sent until "סיום" on the summary (board OnbChange), and then only existing calls,
 * each at most once, in order: the link claim (createClaim) or the new-card submission
 * (createPlayerSubmission, same fields as before), the referee/secretary request
 * (request_official_role), and team follows. A coach request needs a linked card
 * (server rule), so for a new account it is pointed at the team page instead. The terms
 * tick is kept on the device; medical + birth date wait for the approved card (/me).
 *
 * When it shows (unchanged): a resolved account that is NOT linked to a player, has no
 * claim or new card in flight (a FAILED read of that state keeps it hidden), and has not
 * finished / dismissed it on this device; "אחר כך" (X) hides it for this browser session.
 *
 * A player who IS linked gets the other prompt this file carries: a quiet request for his
 * date of birth when his card has none (73 of 97 cards were created before anyone asked;
 * the loan rule cannot run without it). No backdrop, nothing blocked, "later" snoozes it
 * for a month. It sits above the phone tab bar.
 */

const dismissKey = (uid) => `rink-onboarded:v1:${uid}`
const laterKey = (uid) => `rink-onboard-later:v1:${uid}`
const draftKey = (uid) => `fl-onb-draft:v1:${uid}`
const termsKey = (uid) => `fl-terms-accepted:v1:${uid}`
const store = (kind) => { try { return window[kind] } catch { return null } }
const dobSnoozeKey = (uid) => `rink-dob-ask:v1:${uid}`
const DOB_SNOOZE_MS = 30 * 24 * 60 * 60 * 1000

const freshDraft = () => ({
  step: "terms", roles: [], choice: null, claim: null, card: emptyCard(), q: "",
  coachTeamId: null, ref: { referee: false, secretary: false },
  follows: [], followsLoaded: false, preFollows: [], sent: [], fromSummary: false,
})

function loadDraft(uid) {
  try {
    const d = JSON.parse(store("localStorage")?.getItem(draftKey(uid)) || "null")
    return d && d.step ? { ...freshDraft(), ...d } : null
  } catch { return null }
}

/** The steps this draft walks through, in order (terms and the summary excluded from progress). */
function stepsFor(d) {
  const r = new Set(d.roles)
  return ["who", ...(r.has("player") ? ["find"] : []), ...(r.has("coach") ? ["coach"] : []), ...(r.has("ref") ? ["ref"] : []), "follow", "done"]
}

export default function OnboardingModal() {
  const { user, profile, loading, refreshProfile } = useAuth()
  const [phase, setPhase] = useState("hidden") // 'hidden' | 'flow' | 'dob'
  const [d, setD] = useState(freshDraft)
  const [dir, setDir] = useState("fwd")
  const [dob, setDob] = useState("")
  const [dobSaving, setDobSaving] = useState(false)
  const [dobErr, setDobErr] = useState(null)

  // Decide whether to surface the flow, once the account is fully resolved.
  useEffect(() => {
    let alive = true
    if (loading || !user || !profile) return
    if (profile.player_id) return // already linked to a player
    if (store("localStorage")?.getItem(dismissKey(user.id))) return // finished / dismissed for good
    if (store("sessionStorage")?.getItem(laterKey(user.id))) return // "later", this session
    ;(async () => {
      // Don't nag a user who already has a claim OR a new card awaiting review. If the
      // read fails, stay quiet: we can't tell, and asking again invites a duplicate.
      try {
        const st = await getMyLinkState()
        if (!alive || st.pendingClaim || st.pendingSubmission) return
        const saved = loadDraft(user.id)
        const accepted = store("localStorage")?.getItem(termsKey(user.id))
        setD(saved || { ...freshDraft(), step: accepted ? "who" : "terms" })
        setPhase(p => (p === "hidden" ? "flow" : p))
      } catch { /* unknown state → don't prompt */ }
    })()
    return () => { alive = false }
  }, [user, profile, loading])

  // The other side of the same question: linked, but the card has no date of birth. Read
  // per-row while signed in — the column is revoked from `anon`.
  useEffect(() => {
    let alive = true
    if (loading || !user || !profile?.player_id) return
    const snoozed = Number(store("localStorage")?.getItem(dobSnoozeKey(user.id)) || 0)
    if (Date.now() - snoozed < DOB_SNOOZE_MS) return
    getMyBirthDate(profile.player_id).then(v => {
      if (alive && !v) setPhase(p => (p === "hidden" ? "dob" : p))
    }).catch(() => {})
    return () => { alive = false }
  }, [user, profile, loading])

  // Keep the draft on this device (never the terms step: that one is its own key).
  useEffect(() => {
    if (phase !== "flow" || !user || d.step === "terms") return
    try { store("localStorage")?.setItem(draftKey(user.id), JSON.stringify(d)) } catch { /* full / blocked */ }
  }, [d, phase, user])

  // Dialog behaviour while the flow is up: the page behind stops scrolling.
  useEffect(() => {
    if (phase !== "flow") return
    const prev = document.body.style.overflow
    document.body.style.overflow = "hidden"
    return () => { document.body.style.overflow = prev }
  }, [phase])

  const snoozeDob = () => {
    if (user) store("localStorage")?.setItem(dobSnoozeKey(user.id), String(Date.now()))
    setPhase("hidden")
  }
  const saveDob = async () => {
    if (!dob || !profile?.player_id) return
    setDobSaving(true); setDobErr(null)
    try {
      await setPlayerBirthDate(profile.player_id, dob)
      if (user) store("localStorage")?.setItem(dobSnoozeKey(user.id), String(Date.now()))
      setPhase("hidden")
    } catch (e) { setDobErr(e.message) } finally { setDobSaving(false) }
  }

  if (phase === "hidden") return null

  // Deliberately not a modal: no backdrop, nothing blocked; on phones it sits ABOVE the tab
  // bar (76px + the home indicator), on desktop in the bottom corner.
  if (phase === "dob") {
    return (
      <div dir="rtl" role="region" aria-label="תאריך לידה"
        className="fixed z-[45] inset-x-3 bottom-[calc(76px+env(safe-area-inset-bottom)+12px)] lg:bottom-6 lg:inset-x-auto lg:right-6 lg:w-[360px] bg-surface rounded-[22px] p-4 shadow-[0_12px_40px_rgba(0,0,0,.22)] ring-1 ring-line flex flex-col gap-3 fl-fade-in">
        <div className="flex items-start gap-3">
          <BrandIcon name="birthday" variant="large" className="w-9 h-9" />
          <div className="min-w-0 flex-1">
            <p className="text-[15px] font-extrabold text-fg-strong">מה תאריך הלידה שלך?</p>
            <p className="text-[12.5px] text-fg-muted leading-relaxed mt-0.5">הליגה משתמשת בו כדי לקבוע אם אפשר להשאיל אותך לקבוצה אחרת (עד גיל 18, או שוער/ת בכל גיל). לא מוצג בפומבי.</p>
          </div>
          <button onClick={snoozeDob} aria-label="אחר כך" className="size-11 -mt-2 -me-2 shrink-0 rounded-full flex items-center justify-center text-fg-muted hover:bg-surface-page">
            <Glyph d="close" size={16} stroke={2.4} />
          </button>
        </div>
        <input type="date" dir="ltr" value={dob} max={new Date().toLocaleDateString("en-CA")}
          onChange={e => { setDob(e.target.value); setDobErr(null) }} aria-label="תאריך לידה" className={`${inputCls} tabular-nums text-start`} />
        {dobErr && <p role="alert" className={`text-[12.5px] font-semibold ${errText}`}>{dobErr}</p>}
        <div className="flex items-center gap-2">
          <AccButton onClick={saveDob} disabled={!dob || dobSaving}>{dobSaving && <Spinner />} שמירה</AccButton>
          <AccButton tone="ghost" onClick={snoozeDob}>אחר כך</AccButton>
        </div>
      </div>
    )
  }

  return <Flow user={user} d={d} setD={setD} dir={dir} setDir={setDir} refreshProfile={refreshProfile}
    onLater={() => { if (user) store("sessionStorage")?.setItem(laterKey(user.id), "1"); setPhase("hidden") }}
    onFinished={() => {
      if (user) {
        store("localStorage")?.setItem(dismissKey(user.id), String(Date.now()))
        store("localStorage")?.removeItem(draftKey(user.id))
      }
      setPhase("hidden")
    }} />
}

/* =================================================================== the flow */

function Flow({ user, d, setD, dir, setDir, onLater, onFinished, refreshProfile }) {
  const [teams, setTeams] = useState([])
  const panel = useRef(null)
  useEffect(() => { getTeams("name", true).then(t => setTeams(t || [])).catch(() => {}) }, [])
  const byId = useMemo(() => Object.fromEntries(teams.map(t => [t.id, t])), [teams])

  // Esc = later (same as the X); focus moves into the dialog on each step.
  useEffect(() => {
    const onKey = (e) => { if (e.key === "Escape") onLater() }
    document.addEventListener("keydown", onKey)
    return () => document.removeEventListener("keydown", onKey)
  }, [onLater])
  useEffect(() => { panel.current?.focus({ preventScroll: true }) }, [d.step])

  const upd = (patch) => setD(x => ({ ...x, ...(typeof patch === "function" ? patch(x) : patch) }))
  const order = stepsFor(d)
  const go = (s, back = false) => { setDir(back ? "back" : "fwd"); upd(x => ({ step: s, fromSummary: s === "done" ? false : x.fromSummary })) }
  const next = (from) => {
    if (d.fromSummary) return go("done")
    const seq = stepsFor(d)
    const i = seq.indexOf(from === "newCard" ? "find" : from)
    go(seq[Math.min(i + 1, seq.length - 1)])
  }
  const prevOf = (s) => {
    if (s === "newCard") return "find"
    const seq = stepsFor(d)
    const i = seq.indexOf(s)
    return i > 0 ? seq[i - 1] : null
  }
  const back = prevOf(d.step) && d.step !== "who" ? () => go(prevOf(d.step), true) : undefined
  const progress = (s) => {
    const seq = order.filter(x => x !== "done")
    const i = seq.indexOf(s === "newCard" ? "find" : s)
    return i >= 0 ? [i + 1, seq.length] : null
  }
  const myTeamId = d.choice === "claim" ? d.claim?.teamId : d.choice === "card" && d.card.teamId !== "__free__" ? d.card.teamId || null : null

  const props = { d, upd, go, next, back, progress, byId, teams, onLater, user, myTeamId }
  let body
  switch (d.step) {
    case "terms": body = <TermsStep {...props} />; break
    case "who": body = <WhoStep {...props} />; break
    case "find": body = <FindStep {...props} />; break
    case "newCard": body = <NewCardStep {...props} />; break
    case "coach": body = <CoachStep {...props} />; break
    case "ref": body = <RefStep {...props} />; break
    case "follow": body = <FollowStep {...props} />; break
    default: body = <DoneStep {...props} onFinished={onFinished} refreshProfile={refreshProfile} />
  }

  return (
    <div className="fixed inset-0 z-[100] flex items-stretch sm:items-center justify-center sm:p-6" dir="rtl">
      <div className="hidden sm:block absolute inset-0 bg-black/55 fl-fade-in" aria-hidden="true" />
      <div ref={panel} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby="onb-title"
        className="relative w-full sm:max-w-[540px] h-[100dvh] sm:h-[min(800px,92dvh)] sm:rounded-[28px] overflow-hidden bg-surface-page text-fg-strong shadow-2xl outline-none flex flex-col pt-[env(safe-area-inset-top)] sm:pt-0">
        <div key={d.step} className={`flex-1 min-h-0 flex flex-col ${dir === "back" ? "fla-step-back" : "fla-step"}`}>{body}</div>
      </div>
    </div>
  )
}

/* -------------------------------------------------------------- terms (OnbTerms) */

function TermsStep({ go, onLater, user }) {
  const [on, setOn] = useState(false)
  const points = [
    ["broadcast", "משחקים מצולמים ומשודרים", "כל משחק מצולם. שערים, קליפים ותמונות מופיעים בפיד ובאתר, וזה חלק מההשתתפות בליגה"],
    ["medical", "פרטים רגישים נשארים פרטיים", "תאריך לידה ואישור רפואי: רק אתה, המאמן ומנהל הליגה"],
    ["table", "השערים והמשחקים שלך פומביים", "כרטיס השחקן, הסגל והטבלה גלויים לכולם"],
    ["profile", "החשבון שלך, בשליטתך", "שם, תמונה ושיטות התחברות משנים בכל רגע ב\"הדף שלי\""],
  ]
  return (
    <OnbPage titleId="onb-title" title="לפני שמתחילים" subtitle="בקצרה, מה הליגה שומרת ומה מופיע באתר ובאפליקציה." onClose={onLater}
      footer={<>
        <CTA disabled={!on} onClick={() => { if (user) store("localStorage")?.setItem(termsKey(user.id), "1"); go("who") }}>מאשר וממשיך</CTA>
        <a href="/privacy" target="_blank" rel="noopener noreferrer" className="min-h-11 inline-flex items-center justify-center text-[13px] font-semibold text-fg-muted hover:text-fg-strong">לקריאת המדיניות המלאה</a>
      </>}>
      <div className="flex flex-col gap-3">
        <div className="bg-surface rounded-[18px] divide-y divide-line">
          {points.map(([ic, t, s]) => (
            <div key={ic} className="flex items-start gap-3 px-3.5 py-3">
              <BrandIcon name={ic} variant="large" className="w-8 h-8" />
              <div className="min-w-0">
                <p className="text-[14.5px] font-extrabold text-fg-strong">{t}</p>
                <p className="text-[12.5px] text-fg-muted leading-relaxed">{s}</p>
              </div>
            </div>
          ))}
        </div>
        <button type="button" role="checkbox" aria-checked={on} onClick={() => setOn(v => !v)}
          className={`flex items-start gap-3 p-3.5 rounded-2xl bg-surface text-start border-2 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-fl-accent ${on ? "border-fg-strong" : "border-transparent"}`}>
          <CheckBox on={on} />
          <span className="flex flex-col gap-0.5">
            <span className="text-[14px] font-bold text-fg-strong">קראתי ואני מאשר את תנאי השימוש ומדיניות הפרטיות</span>
            <span className={`text-[11.5px] font-extrabold ${errText}`}>חובה</span>
          </span>
        </button>
      </div>
    </OnbPage>
  )
}

/* -------------------------------------------------------------- who (OnbWho) */

function WhoStep({ d, upd, next, progress, onLater }) {
  const toggle = (r) => upd(x => ({ roles: x.roles.includes(r) ? x.roles.filter(y => y !== r) : [...x.roles, r] }))
  const has = (r) => d.roles.includes(r)
  return (
    <OnbPage titleId="onb-title" step={progress("who")} title="מי אתה בליגה?" subtitle="אפשר לבחור יותר מאחד. זה קובע מה תראה בפיד." onClose={onLater}
      footer={<>
        <p className="text-[12px] text-fg-muted">מנהל ליגה? התפקיד ניתן על ידי הליגה ויופיע בחשבון לבד</p>
        {(has("coach") || has("ref")) && <p className="text-[12.5px] text-fg-muted">מאמן ושופט נפתחים אחרי אישור של מנהל הליגה</p>}
        <CTA disabled={!d.roles.length} onClick={() => next("who")}>המשך</CTA>
      </>}>
      <div className="flex flex-col gap-2.5">
        <ChoiceCard on={has("player")} onToggle={() => toggle("player")} icon="squad" title="שחקן או שחקנית" subtitle="יש לי כרטיס בליגה, או שצריך ליצור אחד" />
        <ChoiceCard on={has("coach")} onToggle={() => toggle("coach")} icon="team" title="מאמן או מאמנת" subtitle="מנהל/ת קבוצה: סגל, אישורי הגעה, השאלות" />
        <ChoiceCard on={has("ref")} onToggle={() => toggle("ref")} icon="referee" title="שופט או מזכירות" subtitle="מנהל/ת משחקים בלוח השיפוט" />
        <ChoiceCard on={has("fan")} onToggle={() => toggle("fan")} icon="like" title="אוהד, הורה או חבר" subtitle="עוקב/ת אחרי קבוצות ובא/ה לעודד" />
      </div>
    </OnbPage>
  )
}

/* -------------------------------------------------------------- find (OnbFind) */

function FindStep({ d, upd, go, next, back, progress, byId }) {
  const [players, setPlayers] = useState([])
  const [linked, setLinked] = useState(() => new Set())
  const [loadingList, setLoadingList] = useState(true)
  const [selected, setSelected] = useState(null)
  const q = d.q || ""

  useEffect(() => {
    let alive = true
    Promise.all([getPlayers("goals", false), getLinkedPlayerIds().catch(() => new Set())])
      .then(([pl, l]) => { if (alive) { setPlayers(pl || []); setLinked(l) } })
      .catch(() => {})
      .finally(() => alive && setLoadingList(false))
    return () => { alive = false }
  }, [])

  const results = useMemo(() => {
    const s = q.trim()
    if (!s) return []
    const num = /^\d{1,2}$/.test(s) ? Number(s) : null
    return players
      .filter(p => num != null ? p.jersey_number === num
        : `${p.first_name} ${p.last_name}`.includes(s) || `${p.last_name} ${p.first_name}`.includes(s))
      .slice(0, 8)
  }, [q, players])

  // Picked earlier (draft): show it as chosen, with "לא אני, לבחור אחר".
  if (d.choice === "claim" && d.claim) {
    const t = byId[d.claim.teamId]
    return (
      <OnbPage titleId="onb-title" step={progress("find")} title="הכרטיס שלך" subtitle="נבחר. יישלח למאמן ולמנהל הליגה בסיום." onBack={back}
        footer={<CTA onClick={() => next("find")}>המשך</CTA>}>
        <div className="bg-surface rounded-[20px] p-4 flex items-center gap-3 border-2 border-fg-strong">
          {t ? <TeamLogo team={t} px={48} /> : <BrandIcon name="profile" variant="large" className="w-12 h-12" />}
          <div className="flex-1 min-w-0">
            <p className="text-[17px] font-extrabold text-fg-strong">{d.claim.name}</p>
            <p className="text-[13px] text-fg-muted">{t?.name || "שחקן/ית חופשי/ה"}</p>
          </div>
          <span className="w-8 h-8 rounded-full bg-fl-accent text-fl-inkOnLight flex items-center justify-center"><Glyph d="check" size={18} stroke={2.8} /></span>
        </div>
        <button type="button" onClick={() => upd({ choice: null, claim: null })} className="mt-3 min-h-11 text-[14px] font-bold text-fg-strong underline underline-offset-4">לא אני, לבחור אחר</button>
      </OnbPage>
    )
  }

  const pick = () => {
    if (!selected) return
    upd({ choice: "claim", claim: { id: selected.id, name: `${selected.first_name} ${selected.last_name}`, teamId: selected.team_id || null } })
    next("find")
  }

  return (
    <OnbPage titleId="onb-title" step={progress("find")} title="מצא את הכרטיס שלך" subtitle="כרטיס השחקן כבר בליגה? מחפשים לפי שם או מספר חולצה." onBack={back}
      footer={<>
        <CTA disabled={!selected} onClick={pick}>{selected ? `זה אני: ${selected.first_name} ${selected.last_name}` : "בוחרים כרטיס מהרשימה"}</CTA>
        <button type="button" onClick={() => { upd(x => ({ card: x.card.firstName || x.card.lastName ? x.card : { ...x.card, ...splitName(q) } })); go("newCard") }}
          className="min-h-11 text-[14px] font-bold text-fg-strong">אין לי כרטיס, ליצור חדש</button>
        <button type="button" onClick={() => { upd({ choice: null, claim: null }); next("find") }}
          className="min-h-11 text-[13px] font-semibold text-fg-muted">אחר כך, מ"הדף שלי"</button>
      </>}>
      <div className="relative">
        <Glyph d="search" size={18} className="absolute right-3.5 top-1/2 -translate-y-1/2 text-fg-muted" />
        <label htmlFor="onb-search" className="sr-only">חיפוש לפי שם או מספר</label>
        <input id="onb-search" autoFocus value={q} onChange={e => { upd({ q: e.target.value }); setSelected(null) }}
          placeholder="שם או מספר חולצה" className={`${inputCls} pr-10`} />
      </div>
      <div className="mt-3" aria-live="polite">
        {loadingList ? (
          <div className="flex items-center justify-center py-8 text-fg-muted"><Spinner className="w-5 h-5" /></div>
        ) : !q.trim() ? (
          <p className="text-center text-[13px] text-fg-muted py-8">מתחילים להקליד את השם…</p>
        ) : results.length === 0 ? (
          <div className="text-center py-6 flex flex-col items-center gap-1">
            <BrandIcon name="profile" variant="large" className="w-12 h-12 mb-1" />
            <p className="text-[15px] font-extrabold text-fg-strong">לא מצאנו אותך?</p>
            <p className="text-[13px] text-fg-muted">אפשר ליצור כרטיס חדש. המאמן יאשר אותו.</p>
          </div>
        ) : (
          <ul className="bg-surface rounded-[18px] divide-y divide-line overflow-hidden">
            {results.map(p => {
              const t = byId[p.team_id]
              const on = selected?.id === p.id
              const taken = linked.has(p.id)
              return (
                <li key={p.id}>
                  <button type="button" disabled={taken} onClick={() => setSelected(p)} aria-pressed={on}
                    className={`w-full min-h-[60px] flex items-center gap-3 px-3.5 py-2 text-start transition-colors disabled:opacity-50 disabled:cursor-not-allowed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-fl-accent ${on ? "bg-fl-accent/20" : "hover:bg-surface-page"}`}>
                    {t ? <TeamLogo team={t} px={36} /> : <span className="w-9 h-9 rounded-full bg-surface-page flex items-center justify-center fl-num text-[13px]">{p.jersey_number ?? "?"}</span>}
                    <span className="flex-1 min-w-0">
                      <span className="block text-[15px] font-bold text-fg-strong truncate">{p.first_name} {p.last_name}</span>
                      <span className="block text-[12px] text-fg-muted truncate">
                        {taken ? "כבר משויך לחשבון" : <>{t?.name || "שחקן/ית חופשי/ה"}{p.jersey_number != null && <> · <span className="fl-num">#{p.jersey_number}</span></>}</>}
                      </span>
                    </span>
                    {on && <span className="w-7 h-7 rounded-full bg-fl-accent text-fl-inkOnLight flex items-center justify-center"><Glyph d="check" size={16} stroke={2.8} /></span>}
                  </button>
                </li>
              )
            })}
          </ul>
        )}
      </div>
    </OnbPage>
  )
}

/* -------------------------------------------------------------- new card (OnbNewCard) */

function NewCardStep({ d, upd, next, go, progress }) {
  const ok = cardComplete(d.card)
  return (
    <OnbPage titleId="onb-title" step={progress("newCard")} title="כרטיס שחקן חדש" subtitle="ממלאים פעם אחת. יישלח לאישור המאמן בסיום." onBack={() => go("find", true)}
      footer={<CTA disabled={!ok} onClick={() => { upd({ choice: "card", claim: null }); next("newCard") }}>המשך</CTA>}>
      <NewCardFields form={d.card} onChange={(card) => upd({ card })} idPrefix="onb" />
    </OnbPage>
  )
}

/* -------------------------------------------------------------- coach (OnbCoach) */

function TeamRow({ team, on, onClick, note }) {
  const bg = on ? `linear-gradient(270deg, ${edge(team)}, ${deep(team)})` : undefined
  return (
    <button type="button" role="radio" aria-checked={on} onClick={onClick}
      className={`w-full min-h-[56px] px-3.5 rounded-2xl flex items-center gap-3 text-start transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-fl-accent ${on ? "" : "bg-surface hover:bg-surface/70"}`}
      style={on ? { backgroundImage: bg, color: teamIsLight(team) ? "#FFFFFF" : onColor(team) } : undefined}>
      <TeamLogo team={team} px={40} />
      <span className={`flex-1 text-[15px] font-bold ${on ? "" : "text-fg-strong"}`}>{team.name}</span>
      {note && on && <span className="text-[12px] opacity-85">{note}</span>}
    </button>
  )
}

function CoachStep({ d, upd, next, back, progress, teams, myTeamId }) {
  useEffect(() => { if (!d.coachTeamId && myTeamId) upd({ coachTeamId: myTeamId }) }, []) // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <OnbPage titleId="onb-title" step={progress("coach")} kicker="חלק המאמן" kickerIcon="team" title="איזו קבוצה אתה מאמן?"
      subtitle="מנהל הליגה מאשר, ואז נפתחים הסגל, אישורי ההגעה וההשאלות." onBack={back}
      footer={<>
        <p className="text-[12.5px] text-fg-muted">אם אתה גם משחק בקבוצה, הכרטיס שלך נשאר כמו שהוא</p>
        <CTA onClick={() => next("coach")}>המשך</CTA>
      </>}>
      <Notice tone="warn" className="mb-3">בקשת מאמן נשלחת מחשבון שמשויך לכרטיס שחקן. אחרי שהכרטיס יאושר: עמוד הקבוצה ← בקשה להיות המאמן. בינתיים נעקוב בשבילך אחרי הקבוצה.</Notice>
      <div role="radiogroup" aria-label="הקבוצה שאני מאמן" className="flex flex-col gap-1.5">
        {teams.map(t => <TeamRow key={t.id} team={t} on={d.coachTeamId === t.id} note={t.id === myTeamId ? "הקבוצה שלך כשחקן" : null}
          onClick={() => upd({ coachTeamId: d.coachTeamId === t.id ? null : t.id })} />)}
      </div>
    </OnbPage>
  )
}

/* -------------------------------------------------------------- referee (OnbRef) */

function RefStep({ d, upd, next, back, progress }) {
  const r = d.ref
  const set = (k) => upd(x => ({ ref: { ...x.ref, [k]: !x.ref[k] } }))
  return (
    <OnbPage titleId="onb-title" step={progress("ref")} kicker="חלק השיפוט" kickerIcon="referee" title="שיפוט ומזכירות"
      subtitle="בחרו מה מתאים לכם. מנהל הליגה מאשר את התפקיד ומשבץ למשחקים." onBack={back}
      footer={<CTA onClick={() => next("ref")}>{r.referee || r.secretary ? "המשך" : "בלי שיפוט, המשך"}</CTA>}>
      <div className="flex flex-col gap-2.5">
        <ChoiceCard on={r.referee} onToggle={() => set("referee")} icon="referee" title="שופט במגרש" subtitle="שורק, מוציא כרטיסים וחותם על טופס השיפוט" />
        <ChoiceCard on={r.secretary} onToggle={() => set("secretary")} icon="clock" title="מזכירות · שופט שולחן" subtitle="מפעיל את לוח השיפוט: שעון, שערים, עבירות, שמירה" />
        <div className="bg-surface rounded-[18px] p-3.5">
          <p className="text-[14px] font-extrabold text-fg-strong">איך זה עובד</p>
          <p className="text-[13px] text-fg-muted mt-1 leading-relaxed">הבקשה מגיעה למנהל הליגה. אחרי האישור לוח השיפוט נפתח אצלך, ובעמוד של משחק מגישים מועמדות. משחק שאושר מופיע אצלך בתפריט +.</p>
        </div>
        <div className="rounded-[18px] p-3.5 bg-fl-accent/15 flex items-start gap-2.5">
          <BrandIcon name="broadcast" variant="large" className="w-8 h-8" />
          <p className="text-[12.5px] text-fg-strong leading-relaxed">טיפ למזכירות: פותחים את מסך הקהל של המשחק על טלוויזיה או מחשב באולם. בטלפון נשארים הכפתורים, ובמסך הקהל רואה לוח נקי.</p>
        </div>
      </div>
    </OnbPage>
  )
}

/* -------------------------------------------------------------- follow (OnbFollow) */

function FollowStep({ d, upd, next, back, progress, teams, myTeamId }) {
  // Pre-fill from the server once per draft (a resumed draft keeps the user's own picks).
  useEffect(() => {
    if (d.followsLoaded) return
    getMyTeamFollowRows().then(rows => {
      const ids = rows.map(r => r.target_id)
      upd(x => ({ follows: [...new Set([...x.follows, ...ids, ...(x.coachTeamId ? [x.coachTeamId] : [])])], preFollows: ids, followsLoaded: true }))
    }).catch(() => upd({ followsLoaded: true }))
  }, []) // eslint-disable-line react-hooks/exhaustive-deps
  const toggle = (id) => upd(x => ({ follows: x.follows.includes(id) ? x.follows.filter(y => y !== id) : [...x.follows, id] }))
  return (
    <OnbPage titleId="onb-title" step={progress("follow")} title="אחרי מי לעקוב?" subtitle="המשחקים שלהן יופיעו ראשונים בפיד." onBack={back}
      footer={<CTA onClick={() => next("follow")}>המשך</CTA>}>
      <div className="grid grid-cols-2 min-[400px]:grid-cols-3 gap-2">
        {teams.map(t => {
          const mine = t.id === myTeamId
          const on = mine || d.follows.includes(t.id)
          return (
            <button key={t.id} type="button" aria-pressed={on} disabled={mine} onClick={() => toggle(t.id)} aria-label={mine ? `${t.name}, הקבוצה שלך` : t.name}
              className={`relative min-h-[118px] p-2 rounded-[18px] flex flex-col items-center justify-center gap-2 text-center transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-fl-accent ${on ? "" : "bg-surface hover:bg-surface/70"} ${mine ? "ring-[3px] ring-fl-accent" : ""}`}
              style={on ? { backgroundImage: `linear-gradient(135deg, ${edge(t)}, ${deep(t)})`, color: teamIsLight(t) ? "#FFFFFF" : onColor(t) } : undefined}>
              <TeamLogo team={t} px={52} />
              <span className={`text-[12.5px] font-bold leading-tight line-clamp-2 ${on ? "" : "text-fg-strong"}`}>{t.name}</span>
              {mine ? <span className="absolute top-2 left-2 text-[10.5px] font-extrabold px-1.5 py-0.5 rounded-md bg-fl-accent text-fl-inkOnLight">שלך</span>
                : on && <span className="absolute top-2 left-2 w-[22px] h-[22px] rounded-full bg-fl-accent text-fl-inkOnLight flex items-center justify-center"><Glyph d="check" size={13} stroke={3} /></span>}
            </button>
          )
        })}
      </div>
      <p className="mt-3 text-[12.5px] text-fg-muted leading-relaxed">שולחים התראה רק כשצריך ממך משהו. בבוקר יום משחק של קבוצה שאתה עוקב תגיע תזכורת, ואפשר לכבות אותה ב"הדף שלי".</p>
    </OnbPage>
  )
}

/* -------------------------------------------------------------- done (OnbDone) */

function DoneStep({ d, upd, go, byId, user, myTeamId, onFinished, onLater, refreshProfile }) {
  const [status, setStatus] = useState({}) // kind → 'sending' | 'done' | message
  const [sending, setSending] = useState(false)
  const has = (r) => d.roles.includes(r)
  const sent = new Set(d.sent)
  const team = myTeamId ? byId[myTeamId] : null
  const wantFollows = [...new Set([...d.follows, ...(myTeamId ? [myTeamId] : [])])]
  const followDiff = wantFollows.filter(id => !d.preFollows.includes(id)).length + d.preFollows.filter(id => !wantFollows.includes(id)).length

  // The items "סיום" sends, in order; each one at most once (sent keys survive a retry).
  const items = []
  if (has("player") && d.choice === "claim" && d.claim) items.push({ kind: "claim", key: `claim:${d.claim.id}`, run: () => createClaim(d.claim.id), msg: linkRequestErrorMessage })
  if (has("player") && d.choice === "card") items.push({ kind: "card", key: `card:${d.card.firstName}|${d.card.lastName}`, run: () => submitCard(d.card), msg: linkRequestErrorMessage })
  if (has("ref") && (d.ref.referee || d.ref.secretary)) items.push({ kind: "ref", key: `ref:${+d.ref.referee}${+d.ref.secretary}`, run: () => requestOfficialRole({ referee: d.ref.referee, secretary: d.ref.secretary }), msg: () => "שליחת הבקשה נכשלה, נסו שוב" })
  if (followDiff > 0) items.push({
    kind: "follows", key: `follows:${[...wantFollows].sort().join(",")}`, msg: () => "שמירת הקבוצות נכשלה, נסו שוב",
    run: async () => {
      let failed = false
      for (const id of wantFollows.filter(x => !d.preFollows.includes(x))) { try { await follow("team", id) } catch { failed = true } }
      for (const id of d.preFollows.filter(x => !wantFollows.includes(x))) { try { await unfollow("team", id) } catch { failed = true } }
      if (failed) throw new Error("follows")
    },
  })
  const pending = items.filter(i => !sent.has(i.key))
  const failed = Object.values(status).some(v => v && v !== "sending" && v !== "done")

  const finish = async () => {
    if (sending) return
    setSending(true); setStatus({})
    const keys = new Set(d.sent)
    let bad = false
    for (const it of pending) {
      setStatus(s => ({ ...s, [it.kind]: "sending" }))
      try {
        await it.run()
        keys.add(it.key)
        upd({ sent: [...keys] })
        setStatus(s => ({ ...s, [it.kind]: "done" }))
      } catch (e) {
        bad = true
        if (/profile_already_linked|player_already_linked/.test(e?.message || "")) refreshProfile?.()
        setStatus(s => ({ ...s, [it.kind]: it.msg(e) }))
      }
    }
    setSending(false)
    if (!bad) onFinished()
  }

  const edit = (s) => { if (!sending) { upd({ fromSummary: true }); go(s, true) } }
  const rowState = (kind, isSent) => status[kind] || (isSent ? "waiting" : "later")
  const rows = []
  if (has("player")) {
    if (d.choice === "claim" && d.claim) {
      const k = `claim:${d.claim.id}`
      rows.push({ t: "הכרטיס שלך", s: sent.has(k) ? `בקשת השיוך ל${d.claim.name} אצל המאמן ומנהל הליגה` : `${d.claim.name} · יישלח למנהל הליגה בסיום`, st: rowState("claim", sent.has(k)), edit: sent.has(k) ? null : "find" })
    } else if (d.choice === "card") {
      const k = `card:${d.card.firstName}|${d.card.lastName}`
      const nm = `${d.card.firstName} ${d.card.lastName}`.trim()
      rows.push({ t: "כרטיס שחקן חדש", s: sent.has(k) ? `${nm} · נשלח לאישור המאמן` : `${nm} · יישלח למאמן בסיום`, st: rowState("card", sent.has(k)), edit: sent.has(k) ? null : "newCard" })
    } else {
      rows.push({ t: "הכרטיס שלך", s: "לא נבחר · אפשר גם מ\"הדף שלי\"", st: "later", edit: "find" })
    }
    if (d.choice) rows.push({ t: "אישור רפואי ותאריך לידה", s: "אחרי האישור, מ\"הדף שלי\"", st: "later" })
  }
  if (has("coach")) {
    const t = byId[d.coachTeamId]
    rows.push({ t: "קבוצת המאמן", s: t ? `${t.name} · בקשת מאמן מעמוד הקבוצה, אחרי אישור הכרטיס` : "לא נבחרה קבוצה", st: "later", edit: "coach" })
  }
  if (has("ref")) {
    const any = d.ref.referee || d.ref.secretary
    const label = d.ref.referee && d.ref.secretary ? "שופט ומזכירות" : d.ref.secretary ? "מזכירות" : "שופט"
    const k = `ref:${+d.ref.referee}${+d.ref.secretary}`
    rows.push({ t: "בקשת שיפוט", s: !any ? "לא נבחר שיפוט או מזכירות" : sent.has(k) ? `${label} · ממתין למנהל הליגה` : `${label} · יישלח למנהל הליגה בסיום`, st: any ? rowState("ref", sent.has(k)) : "later", edit: sent.has(k) ? null : "ref" })
  }
  if (wantFollows.length) {
    const names = wantFollows.map(id => byId[id]?.name).filter(Boolean).sort()
    rows.push({ t: `עוקב אחרי ${wantFollows.length === 1 ? "קבוצה אחת" : `${wantFollows.length} קבוצות`}`, s: names.join(" · "), st: status.follows || (followDiff ? "later" : "done"), edit: "follow" })
  } else {
    rows.push({ t: "קבוצות למעקב", s: "לא נבחרו · אפשר מעמוד כל קבוצה", st: "later", edit: "follow" })
  }

  const firstName = (user?.user_metadata?.full_name || "").split(" ")[0]
  const cta = sending ? "שולח…" : failed ? "נסו שוב" : pending.length ? "סיום" : "לפיד שלי"

  return (
    <div className="flex-1 min-h-0 flex flex-col bg-[#070B10] text-white">
      <div className="flex-1 min-h-0 overflow-y-auto px-4 sm:px-6 pt-4 pb-4">
        <div className="flex items-center min-h-11">
          {!sending && <button type="button" onClick={() => go("follow", true)} aria-label="חזרה" className="size-11 -ms-3 rounded-full flex items-center justify-center text-white/85 hover:bg-white/10"><Glyph d="back" size={21} stroke={2.1} /></button>}
        </div>
        <div className="flex flex-col items-center text-center gap-2.5 pt-2">
          {team ? <TeamLogo team={team} px={112} shadow className="fl-pop" /> : <img src="/logos/mark-256.png" alt="" className="w-24 h-24 rounded-[24px] fl-pop" />}
          <h2 id="onb-title" className="text-[32px] font-black leading-tight">{firstName ? `הכל מוכן, ${firstName}` : "הכל מוכן"}</h2>
          {team && <p className="text-[15px] text-white/85">ברוך הבא ל{team.name}</p>}
        </div>
        <ul className="mt-6 rounded-[20px] bg-white/[0.07] divide-y divide-white/10">
          {rows.map((r, i) => {
            const err = r.st && !["sending", "done", "waiting", "later"].includes(r.st)
            return (
              <li key={i} className="flex items-center gap-3 px-3.5 py-2.5 min-h-[62px]">
                <span className={`w-8 h-8 shrink-0 rounded-full flex items-center justify-center ${r.st === "done" ? "bg-[#7EE08F]/20 text-[#7EE08F]" : err ? "bg-[#FF8A7A]/20 text-[#FF8A7A]" : "bg-white/10 text-white/80"}`}>
                  {r.st === "sending" ? <Spinner /> : r.st === "done" ? <Glyph d="check" size={16} stroke={2.8} /> : err ? <span className="font-black">!</span> : <Glyph d="history" size={16} />}
                </span>
                <span className="flex-1 min-w-0">
                  <span className="block text-[15px] font-bold">{r.t}</span>
                  <span className={`block text-[12.5px] ${err ? "text-[#FF8A7A] font-semibold" : "text-white/75"}`}>{err ? r.st : r.s}</span>
                </span>
                {r.edit && !sending && (
                  <button type="button" onClick={() => edit(r.edit)} className="h-11 px-3 rounded-xl text-[13px] font-bold text-white/90 hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-fl-accent">שינוי</button>
                )}
              </li>
            )
          })}
        </ul>
        <p className="mt-3 text-center text-[12.5px] text-white/65">אפשר לשנות הכל גם אחר כך, ב"הדף שלי"</p>
      </div>
      <div className="shrink-0 px-4 sm:px-6 pt-2.5 pb-[max(0.75rem,env(safe-area-inset-bottom))] flex flex-col gap-1.5">
        <button type="button" onClick={pending.length || failed ? finish : onFinished} disabled={sending}
          className="w-full h-[52px] rounded-2xl bg-fl-accent text-fl-inkOnLight text-[16px] font-extrabold inline-flex items-center justify-center gap-2 disabled:opacity-70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white">
          {sending && <Spinner />}{cta}
        </button>
        {failed && !sending && <button type="button" onClick={onLater} className="min-h-11 text-[13px] font-semibold text-white/75">אחר כך</button>}
      </div>
    </div>
  )
}
