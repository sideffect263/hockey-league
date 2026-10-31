import { useState, useEffect, useRef } from "react"
import { Link } from "react-router-dom"
import { useAuth } from "@/lib/AuthContext"
import { useTheme } from "@/lib/ThemeContext"
import { getMyProfile, updateMyProfile, getPlayerPhotos, uploadAvatar } from "@/lib/profile"
import CardUnlinkRequest from "@/components/CardUnlinkRequest"
import { cancelPlayerSubmission } from "@/lib/playerSubmissions"
import { cancelClaim } from "@/lib/claims"
import { getMyLinkState } from "@/lib/linkRequests"
import PlayerCardSubmission from "@/components/PlayerCardSubmission"
import TeamMembershipCard from "@/components/TeamMembershipCard"
import MedicalCertificateCard, { medicalDaysLeft } from "@/components/MedicalCertificateCard"
import BirthDateCard from "@/components/BirthDateCard"
import BlockedUsersCard from "@/components/BlockedUsersCard"
import SignInMethodsCard from "@/components/SignInMethodsCard"
import { ROLE_BADGE, deriveRoleItems } from "@/components/RoleBadges"
import { BrandIcon } from "@/components/icons/BrandIcons"
import { entityPath } from "@/lib/slugs"
import { ProfileSkeleton } from "@/components/skeletons/PageSkeletons"
import { isPwnedPasswordError, PWNED_PASSWORD_MSG } from "@/lib/passwordErrors"
import { sizedImage } from "@/lib/imageSize"
import { teamBanner, deep, teamIsLight } from "@/lib/flTeam"
import { useSeo } from "@/lib/seo"
import { signInWithAppleWeb } from "@/lib/appleWeb"
import TeamLogo from "@/components/TeamLogo"
import WelcomeScene from "@/components/fl/account/WelcomeScene"
import SocialSignIn from "@/components/fl/account/SocialSignIn"
import {
  AccGroup, AccRow, AccButton, AccChip, Segmented, Sheet, CTA, Field, Glyph, Spinner, Notice, inputCls, errText,
} from "@/components/fl/account/AccountKit"
import {
  FollowsGroup, NotificationsGroup, CalendarRow, UnavailabilityRow, LoansRow, useTeamFollows, useLeagueTeams,
} from "@/components/fl/account/MyPageParts"

const sizedUrl = (url, w = 600) => (url ? url.replace(/=w\d+(-h\d+)?.*$/, `=w${w}`) : url)

// The site build on Vercel (Vite exposes VITE_VERCEL_* system vars); nothing locally.
const BUILD = (import.meta.env.VITE_VERCEL_GIT_COMMIT_SHA || "").slice(0, 7)

const APPEARANCE = [
  { value: "light", label: "בהיר" },
  { value: "dark", label: "כהה" },
  { value: "system", label: "לפי המכשיר" },
]

/* ------------------------------------------------------------------ pieces */

function AppearanceGroup({ guest }) {
  const { mode, setMode } = useTheme()
  return (
    <AccGroup title="תצוגה">
      <AccRow line="moon" label="מראה" sub={guest ? "עובד גם בלי חשבון" : "בהיר, כהה, או כמו במכשיר"} />
      <div className="px-3.5 pb-3.5 !border-t-0">
        <Segmented label="מראה" options={APPEARANCE} value={mode || "system"} onChange={setMode} />
      </div>
    </AccGroup>
  )
}

function HelpGroup() {
  return (
    <AccGroup title="עזרה ומידע">
      <AccRow line="mail" label="צור קשר" sub={<bdi dir="ltr">rinkhockeyil.com/support</bdi>} to="/support" />
      <AccRow line="help" label="מדריך לאתר ולאפליקציה" sub="מה כל תפקיד יכול לעשות" to="/guide" />
      <AccRow line="phone" label="האפליקציה" sub="iPhone ו־Android" to="/app" />
      <AccRow line="shield" label="מדיניות פרטיות ותנאי שימוש" to="/privacy" />
    </AccGroup>
  )
}

function VersionLine() {
  return (
    <p className="text-center text-[12px] text-fg-muted">
      ליגת הוקי גלגיליות · האתר{BUILD && <> · גרסה <bdi dir="ltr" className="tabular-nums">{BUILD}</bdi></>}
    </p>
  )
}

function Avatar({ src, initial, size = 76, ring = "border-white" }) {
  return src ? (
    <img src={sizedImage(src, size * 2)} alt="" style={{ width: size, height: size }} className={`rounded-full object-cover shrink-0 border-[3px] ${ring} bg-white/20`} />
  ) : (
    <span style={{ width: size, height: size }} className={`rounded-full shrink-0 border-[3px] ${ring} bg-[#E4ECFB] text-[#0E3394] flex items-center justify-center text-[30px] font-extrabold`}>{initial}</span>
  )
}

/** Role chips on the coloured header (board: white chips, team-colour ink). */
function HeaderChips({ items, og, ink }) {
  return (
    <div className="flex flex-wrap gap-1">
      {og && <span dir="ltr" className="text-[11px] font-extrabold px-2 py-[3px] rounded-[7px] bg-[#11161D] text-fl-accent">OG #{og}</span>}
      {items.map(it => (
        <span key={it.role} className="text-[11px] font-extrabold px-2 py-[3px] rounded-[7px] bg-white" style={{ color: ink }}>
          {it.label || ROLE_BADGE[it.role]?.label}{it.team ? ` · ${it.team}` : ""}
        </span>
      ))}
    </div>
  )
}

/* ------------------------------------------------------------------ sheets */

function ProfileSheet({ onClose, name, setName, avatar, setAvatar, refreshProfile, initial }) {
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [err, setErr] = useState(null)
  const fileRef = useRef(null)

  const save = async () => {
    setSaving(true); setSaved(false); setErr(null)
    try {
      await updateMyProfile({ display_name: name.trim() || null, avatar_url: avatar.trim() || null })
      await refreshProfile()   // reflect the new image/name in the header avatar immediately
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
    } catch { setErr("השמירה נכשלה, נסו שוב") }
    finally { setSaving(false) }
  }
  // Upload a photo file → avatars bucket → persist immediately (no URL pasting).
  const onPick = async (e) => {
    const f = e.target.files?.[0]
    if (!f) return
    if (!f.type?.startsWith("image/")) { setErr("קובץ תמונה בלבד"); return }
    if (f.size > 4 * 1024 * 1024) { setErr("תמונה עד 4MB"); return }
    setErr(null); setUploading(true)
    try {
      const url = await uploadAvatar(f)
      setAvatar(url)
      await updateMyProfile({ avatar_url: url })
      await refreshProfile()
    } catch { setErr("שגיאה בהעלאה, נסו שוב") }
    finally { setUploading(false) }
  }
  const removePhoto = async () => {
    setAvatar(""); setErr(null)
    try { await updateMyProfile({ avatar_url: null }); await refreshProfile() } catch { setErr("ההסרה נכשלה, נסו שוב") }
  }

  return (
    <Sheet onClose={onClose} title="שם תצוגה ותמונה"
      footer={<CTA onClick={save} disabled={saving}>{saving ? <Spinner /> : saved ? <Glyph d="check" size={18} stroke={2.6} /> : null}{saved ? "נשמר" : "שמירה"}</CTA>}>
      <div className="flex flex-col gap-5">
        <div className="flex items-center gap-4">
          <Avatar src={avatar} initial={initial} size={72} ring="border-surface" />
          <div className="flex flex-col items-start gap-1">
            <input ref={fileRef} type="file" accept="image/*" onChange={onPick} className="sr-only" tabIndex={-1} />
            <AccButton onClick={() => fileRef.current?.click()} disabled={uploading}>
              {uploading ? <Spinner /> : <Glyph d="camera" size={17} />} {uploading ? "מעלה…" : (avatar ? "החלפת תמונה" : "העלאת תמונה")}
            </AccButton>
            {avatar && !uploading && <AccButton tone="ghost" onClick={removePhoto}>הסרת תמונה</AccButton>}
          </div>
        </div>
        <Field label="שם תצוגה" htmlFor="me-name" hint="איך שיופיע בפוסטים ובתגובות">
          <input id="me-name" data-autofocus value={name} onChange={e => setName(e.target.value.slice(0, 60))} className={inputCls} autoComplete="nickname" />
        </Field>
        <details className="group">
          <summary className="cursor-pointer select-none text-[13px] font-semibold text-fg-muted min-h-11 flex items-center">או הדבקת כתובת תמונה (URL)</summary>
          <input value={avatar} onChange={e => setAvatar(e.target.value)} placeholder="https://…" dir="ltr" aria-label="כתובת תמונה" className={`${inputCls} text-left`} />
        </details>
        {err && <Notice tone="err">{err}</Notice>}
      </div>
    </Sheet>
  )
}

function PasswordSheet({ onClose, user, signInWithEmail, updatePassword }) {
  const [curPw, setCurPw] = useState("")
  const [newPw, setNewPw] = useState("")
  const [confirmPw, setConfirmPw] = useState("")
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(null)
  const [done, setDone] = useState(false)

  const submit = async (e) => {
    e.preventDefault()
    setErr(null); setDone(false)
    if (newPw.length < 6) { setErr("הסיסמה החדשה חייבת להכיל לפחות 6 תווים"); return }
    if (newPw !== confirmPw) { setErr("הסיסמאות אינן תואמות"); return }
    setBusy(true)
    try {
      // Verify identity by re-authenticating with the current password before
      // changing it — Supabase's updateUser doesn't require it by default, so
      // this closes the "someone at an unlocked screen changes it" hole.
      await signInWithEmail(user.email, curPw)
      await updatePassword(newPw)
      setDone(true)
      setCurPw(""); setNewPw(""); setConfirmPw("")
    } catch (err2) {
      const m = (err2?.message || "").toLowerCase()
      if (isPwnedPasswordError(err2)) setErr(PWNED_PASSWORD_MSG)
      else if (m.includes("invalid login") || m.includes("credentials")) setErr("הסיסמה הנוכחית שגויה")
      else if (m.includes("different from the old") || m.includes("should be different") || m.includes("same")) setErr("בחרו סיסמה שונה מהסיסמה הנוכחית")
      else setErr(err2?.message || "אירעה שגיאה. נסו שוב")
    } finally { setBusy(false) }
  }

  return (
    <Sheet onClose={onClose} title="שינוי סיסמה"
      footer={<CTA type="submit" form="pw-form" disabled={busy}>{busy && <Spinner />} עדכון סיסמה</CTA>}>
      <form id="pw-form" onSubmit={submit} className="flex flex-col gap-4">
        <input type="email" autoComplete="username" value={user.email || ""} readOnly hidden />
        <Field label="סיסמה נוכחית" htmlFor="pw-cur">
          <input id="pw-cur" data-autofocus type="password" dir="ltr" autoComplete="current-password" required value={curPw} onChange={e => setCurPw(e.target.value)} className={inputCls} />
        </Field>
        <Field label="סיסמה חדשה" htmlFor="pw-new" hint="לפחות 6 תווים">
          <input id="pw-new" type="password" dir="ltr" autoComplete="new-password" required minLength={6} value={newPw} onChange={e => setNewPw(e.target.value)} className={inputCls} />
        </Field>
        <Field label="אימות סיסמה חדשה" htmlFor="pw-confirm">
          <input id="pw-confirm" type="password" dir="ltr" autoComplete="new-password" required minLength={6} value={confirmPw} onChange={e => setConfirmPw(e.target.value)} className={inputCls} />
        </Field>
        {err && <Notice tone="err">{err}</Notice>}
        {done && <Notice tone="ok">הסיסמה עודכנה בהצלחה</Notice>}
      </form>
    </Sheet>
  )
}

/* ------------------------------------------------------------------ guest */

function GuestPage({ openAuth, signInWithGoogle }) {
  const perks = [
    ["team", "לבחור קבוצה ולעקוב אחריה"],
    ["bell", "התראה כשהקבוצה משחקת, ומשחק שזז"],
    ["tag", "להגיב, לתייג ולפרסם"],
    ["coin", "שחקנים רשומים מגיל 18: לחזות בסטופר מרקט"],
  ]
  return (
    <div className="max-w-5xl mx-auto px-3 sm:px-6 lg:px-8 pt-3 sm:pt-6 pb-8">
      <div className="lg:grid lg:grid-cols-2 lg:gap-5 lg:items-start">
        <section aria-labelledby="me-title" className="rounded-[28px] overflow-hidden bg-[#070B10] text-white">
          <WelcomeScene height={300} offsetY={96} still className="-mb-16" />
          <div className="relative px-4 sm:px-5 pb-5 flex flex-col gap-3">
            <h1 id="me-title" className="text-[26px] font-black">הדף שלי</h1>
            <p className="text-[15px] leading-relaxed text-[#D5DAE1]">מתחברים כדי לעקוב אחרי קבוצה, לקבל התראות על המשחקים שלה, להגיב ולתייג.</p>
            <SocialSignIn compact onGoogle={() => signInWithGoogle()} onApple={() => signInWithAppleWeb().catch(() => {})} onEmail={openAuth} />
          </div>
        </section>
        <div className="mt-4 lg:mt-0 flex flex-col gap-4">
          <AccGroup title="מה מקבלים עם חשבון">
            {perks.map(([ic, t]) => <AccRow key={ic} brand={ic} label={t} />)}
          </AccGroup>
          <AppearanceGroup guest />
          <CalendarRow guest />
          <HelpGroup />
          <VersionLine />
        </div>
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ page */

export default function Profile() {
  const { user, isAdmin, hasRole, roles, loading: authLoading, signOut, openAuth, refreshProfile, signInWithEmail, updatePassword, signInWithGoogle } = useAuth()
  useSeo({ title: "הדף שלי", path: "/me", noindex: true })

  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [name, setName] = useState("")
  const [avatar, setAvatar] = useState("")
  const [photos, setPhotos] = useState([])
  // Claim / new-card state for an UNLINKED account. linkState null + linkErr = the read
  // failed: show a retry, never the "claim / create" CTAs (that invites a duplicate).
  const [linkState, setLinkState] = useState(null)
  const [linkErr, setLinkErr] = useState(false)
  const [confirmCancelReq, setConfirmCancelReq] = useState(false)
  const [cancellingReq, setCancellingReq] = useState(false)
  const [cancelReqErr, setCancelReqErr] = useState(null)
  const [showCreateCard, setShowCreateCard] = useState(false)
  const [sheet, setSheet] = useState(null) // 'profile' | 'password'
  const [medical, setMedical] = useState(undefined) // the effective certificate, once read
  const teams = useLeagueTeams()
  const follows = useTeamFollows(!!user)

  // Change-password (email/password accounts only — OAuth users have no password)
  const hasPasswordLogin = !!(
    user?.identities?.some(i => i.provider === "email") ||
    user?.app_metadata?.providers?.includes("email") ||
    user?.app_metadata?.provider === "email"
  )

  useEffect(() => {
    let alive = true
    if (authLoading) return
    if (!user) { setLoading(false); return }
    setLoading(true)
    getMyProfile()
      .then(d => {
        if (!alive) return
        setData(d)
        setName(d?.profile?.display_name || "")
        setAvatar(d?.profile?.avatar_url || "")
        if (d?.player) {
          setLinkState(null)
          getPlayerPhotos(d.player.id).then(ph => alive && setPhotos(ph)).catch(() => {})
        } else {
          setPhotos([])
          loadLinkState(() => alive)
        }
      })
      .catch(() => alive && setData(null))
      .finally(() => alive && setLoading(false))
    return () => { alive = false }
  }, [user, authLoading]) // eslint-disable-line react-hooks/exhaustive-deps

  function loadLinkState(isAlive = () => true) {
    setLinkErr(false)
    return getMyLinkState()
      .then(st => { if (isAlive()) setLinkState(st) })
      .catch(() => { if (isAlive()) { setLinkState(null); setLinkErr(true) } })
  }

  const reloadProfile = () => {
    getMyProfile().then(d => {
      setData(d)
      if (d?.player) setLinkState(null)
      else loadLinkState()
    }).catch(() => {})
  }

  const cancelPendingRequest = async () => {
    setCancellingReq(true); setCancelReqErr(null)
    try {
      if (linkState?.pendingClaim) await cancelClaim(linkState.pendingClaim.id)
      else if (linkState?.pendingSubmission) await cancelPlayerSubmission(linkState.pendingSubmission.id)
      setConfirmCancelReq(false)
    } catch (e) {
      setCancelReqErr(/not-cancelable/.test(e?.message || "") ? "הבקשה כבר טופלה, מרעננים" : "הביטול נכשל, נסו שוב")
    } finally {
      setCancellingReq(false)
      reloadProfile()
    }
  }

  // ---- signed-out ----
  if (!authLoading && !user) return <GuestPage openAuth={openAuth} signInWithGoogle={signInWithGoogle} />

  if (authLoading || loading) return <ProfileSkeleton />

  const player = data?.player || null
  const pendingClaim = linkState?.pendingClaim || null
  const pendingSubmission = linkState?.pendingSubmission || null
  const lastRejection = linkState?.lastRejection || null
  const linkedButUnloaded = !player && !!data?.profile?.player_id
  const isJudge = hasRole("judge")
  const isPlayer = !!player
  const viewer = isPlayer ? "player" : "fan"
  const teamsById = Object.fromEntries(teams.map(t => [t.id, t]))
  const myTeam = player ? teamsById[player.team_id] || null : null
  const fanTeam = !isPlayer ? teamsById[(follows.rows || [])[0]?.target_id] || null : null
  // Badges are derived from the RAW granted roles (+ admin/player signals) so
  // coach and content_editor show, and an admin isn't mislabeled as a judge.
  let roleItems = deriveRoleItems({ roles, isAdmin, isPlayer, teamsMap: teamsById })
  if (!isPlayer && !isAdmin) roleItems = [...roleItems, { role: "fan", label: fanTeam ? `אוהד · ${fanTeam.name}` : "אוהד" }]
  const displayName = name || user.email?.split("@")[0] || "חבר/ת הליגה"
  const initial = (displayName || "?").trim().charAt(0).toUpperCase()

  // Header colours: the player's team; a fan gets the league blue (board MyPageStates).
  // A light team (קריית מוצקין white/grey) gets its grey into a dark slate so the white
  // text keeps 4.5:1 on the whole header.
  const light = myTeam && teamIsLight(myTeam)
  const [b1] = myTeam ? teamBanner(myTeam) : ["#1550D8"]
  const headBg = !myTeam ? "linear-gradient(160deg, #1550D8, #0E2A6E)"
    : light ? "linear-gradient(160deg, #6B7079, #1E2329)"
    : `linear-gradient(160deg, ${b1}, ${deep(myTeam)})`
  const headInk = "#FFFFFF"
  const chipInk = !myTeam ? "#0E3394" : light ? "#11161D" : deep(myTeam)

  // Urgent banner: medical missing / expiring / expired (board "מה מחכה לך").
  const days = medicalDaysLeft(medical)
  let banner = null
  if (isPlayer && medical !== undefined) {
    if (!medical || medical.status === "rejected") banner = { t: "חסר אישור רפואי בתוקף", s: "בלי אישור בתוקף אי אפשר להירשם למשחקים" }
    else if (days != null && days < 0) banner = { t: "האישור הרפואי פג", s: "מעלים אישור חדש כדי להירשם למשחקים" }
    else if (days != null && days <= 30) banner = { t: `האישור הרפואי פג בעוד ${days} ${days === 1 ? "יום" : "ימים"}`, s: "בלי אישור בתוקף אי אפשר להירשם למשחקים" }
  }

  const header = (
    <section aria-labelledby="me-title" className="rounded-[28px] px-4 sm:px-6 pt-4 pb-5 sm:py-6" style={{ background: headBg, color: headInk }}>
      <div className="flex items-center justify-between gap-3">
        <h1 id="me-title" className="text-[24px] font-extrabold">הדף שלי</h1>
        {isPlayer && (
          <Link to={entityPath("players", player)} className="min-h-11 px-3.5 rounded-full bg-white/15 hover:bg-white/25 inline-flex items-center gap-1 text-[13px] font-bold transition-colors">
            הכרטיס שלי כשחקן <Glyph d="chev" size={15} stroke={2.4} />
          </Link>
        )}
      </div>
      <div className="flex items-center gap-3.5 mt-4">
        <Avatar src={avatar} initial={initial} ring={isPlayer ? "border-fl-accent" : "border-white"} />
        <div className="min-w-0 flex flex-col gap-1.5">
          <span className="text-[21px] font-extrabold leading-tight break-words">{displayName}</span>
          <span dir="ltr" className="text-[12.5px] opacity-80 truncate text-end">{user.email}</span>
          <HeaderChips items={roleItems} og={player?.og_number} ink={chipInk} />
        </div>
      </div>
    </section>
  )

  // "משחקים בליגה?" — the unlinked account: claim / new card, a pending request, or a retry.
  const linkCard = linkedButUnloaded || isPlayer ? null : linkErr ? (
    <AccGroup>
      <AccRow line="info" label="לא הצלחנו לטעון את מצב השיוך" trailing={<AccButton tone="outline" onClick={() => loadLinkState()}>נסו שוב</AccButton>} />
    </AccGroup>
  ) : !linkState ? null : (pendingClaim || pendingSubmission) ? (
    <AccGroup title="הכרטיס שלי">
      <AccRow brand="waiting" label={pendingClaim ? "בקשת השיוך ממתינה לאישור המאמן או מנהל הליגה" : "כרטיס השחקן שלך ממתין לאישור המאמן"}
        sub={pendingClaim
          ? (pendingClaim.players ? `${pendingClaim.players.first_name} ${pendingClaim.players.last_name}` : "שחקן")
          : `${pendingSubmission.first_name} ${pendingSubmission.last_name}${pendingSubmission.teams?.name ? ` · ${pendingSubmission.teams.name}` : ""}`}
        trailing={!confirmCancelReq && <AccButton tone="quiet" onClick={() => { setConfirmCancelReq(true); setCancelReqErr(null) }}>ביטול הבקשה</AccButton>}>
        {(confirmCancelReq || cancelReqErr) && (
          <div className="px-3.5 pb-3 -mt-1 flex flex-col gap-2">
            {confirmCancelReq && <>
              <p className="text-[13px] text-fg">לבטל את הבקשה? אפשר להגיש חדשה אחר כך.</p>
              <div className="flex gap-2">
                <AccButton tone="danger" onClick={cancelPendingRequest} disabled={cancellingReq}>{cancellingReq && <Spinner />} כן, לבטל</AccButton>
                <AccButton tone="ghost" onClick={() => setConfirmCancelReq(false)} disabled={cancellingReq}>להשאיר</AccButton>
              </div>
            </>}
            {cancelReqErr && <p role="alert" className={`text-[12.5px] font-semibold ${errText}`}>{cancelReqErr}</p>}
          </div>
        )}
      </AccRow>
    </AccGroup>
  ) : (
    <section aria-labelledby="me-play" className="bg-surface rounded-[18px] p-3.5 flex flex-col gap-3">
      {lastRejection && (
        <Notice tone="err">
          <span className="font-bold">הבקשה האחרונה שלך נדחתה{lastRejection.name ? ` (${lastRejection.name})` : ""}</span>
          {lastRejection.reason && <span className="block mt-0.5">{lastRejection.reason}</span>}
        </Notice>
      )}
      <div className="flex items-center gap-3">
        <BrandIcon name="profile" variant="large" className="w-10 h-10" />
        <div className="min-w-0">
          <h2 id="me-play" className="text-[15px] font-extrabold text-fg-strong">משחקים בליגה?</h2>
          <p className="text-[12.5px] text-fg-muted">מוצאים את כרטיס השחקן שלכם, או פותחים חדש לאישור המאמן</p>
        </div>
      </div>
      <div className="flex gap-2">
        <Link to="/players" className="flex-1 h-11 rounded-xl bg-brand text-brand-fg hover:bg-brand-hover inline-flex items-center justify-center text-[14px] font-bold transition-colors">למצוא את הכרטיס שלי</Link>
        <AccButton tone="outline" onClick={() => setShowCreateCard(true)}>כרטיס חדש</AccButton>
      </div>
    </section>
  )

  const colA = (
    <>
      {linkCard}
      {isPlayer && (
        <AccGroup title="הכרטיס והקבוצה">
          <div className="relative">
            <span className="absolute top-1/2 -translate-y-1/2 right-3.5 pointer-events-none z-[1]">{myTeam ? <TeamLogo team={myTeam} px={32} /> : null}</span>
            <div className={myTeam ? "[&>a]:pr-[60px]" : ""}>
              <AccRow brand={myTeam ? null : "profile"} to={entityPath("players", player)}
                label={`${player.first_name} ${player.last_name}${player.jersey_number != null ? ` · #${player.jersey_number}` : ""}`}
                sub="הכרטיס שלך בליגה: סטטיסטיקות ויומן משחקים" />
            </div>
          </div>
          <div className="px-3.5 py-1 [&>div]:mt-0 [&>div]:border-t-0 [&>div]:pt-2 [&>div]:pb-2">
            <TeamMembershipCard player={player} onChange={reloadProfile} />
          </div>
          <LoansRow />
          {/* An approved card is unlinked only through a league-manager request. */}
          <CardUnlinkRequest playerId={player.id} />
        </AccGroup>
      )}
      {isPlayer && (
        <AccGroup title="בריאות וזמינות">
          <div id="medical" className="divide-y divide-line">
            <MedicalCertificateCard playerId={player.id} onStatus={(c) => setMedical(c || null)} />
          </div>
          <UnavailabilityRow />
          <BirthDateCard playerId={player.id} />
        </AccGroup>
      )}
      <FollowsGroup follows={follows} viewer={viewer} />
    </>
  )

  const colB = (
    <>
      {(isJudge || isAdmin) && (
        <AccGroup title="הכלים שלי">
          {isJudge && <AccRow brand="referee" label="שיפוט משחקים" sub="לוח השיפוט וניהול תוצאות בזמן אמת" to="/judge" />}
          {isAdmin && <AccRow brand="table" label="ניהול הליגה" sub="משחקים, שחקנים ובקשות" to="/admin" />}
        </AccGroup>
      )}
      <NotificationsGroup follows={follows} isPlayer={isPlayer} />
      <AppearanceGroup />
      <CalendarRow team={myTeam || fanTeam} />
      <AccGroup title="פרטיות">
        <BlockedUsersCard />
      </AccGroup>
      <AccGroup title="החשבון">
        <AccRow brand="profile" label="שם תצוגה ותמונה" sub={`${displayName} · איך שיופיע בפוסטים ובתגובות`} onClick={() => setSheet("profile")} />
        <SignInMethodsCard />
        {hasPasswordLogin && <AccRow line="lock" label="שינוי סיסמה" sub="לחשבון עם אימייל וסיסמה" onClick={() => setSheet("password")} />}
      </AccGroup>
      {/* Photos of the linked player from the game albums */}
      {player && photos.length > 0 && (
        <AccGroup title="תמונות שלי מהמשחקים" footer="תמונות שזוהו בהן הפנים שלך מאלבומי המשחקים · לחיצה פותחת את התמונה המקורית">
          <div className="p-2 grid grid-cols-3 gap-1.5">
            {photos.map(ph => (
              <a key={ph.photo_id} href={ph.detail_url} target="_blank" rel="noopener noreferrer"
                className="group relative block aspect-square rounded-[10px] overflow-hidden bg-surface-sunken">
                <img src={sizedUrl(ph.image_url)} alt={ph.album_title || "תמונה מהמשחק"} loading="lazy" className="w-full h-full object-cover" />
                {ph.album_title && (
                  <span className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/70 to-transparent px-1.5 pt-4 pb-1 text-[10px] font-medium text-white line-clamp-1">{ph.album_title}</span>
                )}
              </a>
            ))}
          </div>
        </AccGroup>
      )}
      <HelpGroup />
    </>
  )

  return (
    <div className="max-w-5xl mx-auto px-3 sm:px-6 lg:px-8 pt-3 sm:pt-6 pb-8">
      {header}
      {banner && (
        <a href="#medical" className="mt-3 rounded-[18px] px-3.5 py-3 bg-[#F6EBD3] dark:bg-amber-900/30 flex items-center gap-3">
          <BrandIcon name="medical" variant="large" className="w-[38px] h-[38px]" />
          <span className="flex-1 min-w-0 flex flex-col gap-0.5">
            <span className="text-[14px] font-extrabold text-[#11161D] dark:text-amber-50">{banner.t}</span>
            <span className="text-[12.5px] text-[#7A5200] dark:text-amber-200">{banner.s}</span>
          </span>
          <Glyph d="chev" size={18} className="text-[#7A5200] dark:text-amber-200" />
        </a>
      )}
      <div className="mt-4 grid gap-4 lg:grid-cols-2 lg:gap-5 lg:items-start">
        <div className="flex flex-col gap-4 min-w-0">{colA}</div>
        <div className="flex flex-col gap-4 min-w-0">{colB}</div>
      </div>
      <div className="mt-6 max-w-md mx-auto flex flex-col gap-2">
        <button type="button" onClick={() => signOut()}
          className="h-[52px] rounded-2xl border border-line-strong bg-surface text-fg-strong text-[15px] font-bold hover:bg-surface-page transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-fl-accent">
          התנתקות
        </button>
        <VersionLine />
      </div>

      {showCreateCard && (
        <PlayerCardSubmission onClose={() => setShowCreateCard(false)} onSubmitted={() => loadLinkState()} />
      )}
      {sheet === "profile" && (
        <ProfileSheet onClose={() => setSheet(null)} name={name} setName={setName} avatar={avatar} setAvatar={setAvatar}
          refreshProfile={refreshProfile} initial={initial} />
      )}
      {sheet === "password" && (
        <PasswordSheet onClose={() => setSheet(null)} user={user} signInWithEmail={signInWithEmail} updatePassword={updatePassword} />
      )}
    </div>
  )
}
