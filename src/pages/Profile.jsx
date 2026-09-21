import { useState, useEffect, useRef } from "react"
import { Link } from "react-router-dom"
import { motion } from "framer-motion"
import {
  UserCircle, Shield, Gavel, UserCheck, LogIn, LogOut, Sun, Moon,
  Save, Loader2, Clock, ChevronLeft, UserPlus, Trophy, Unlink, Camera, KeyRound, CheckCircle2,
  SlidersHorizontal
} from "lucide-react"
import { useAuth } from "@/lib/AuthContext"
import { useTheme } from "@/lib/ThemeContext"
import { getMyProfile, updateMyProfile, getPlayerPhotos, disconnectPairing, uploadAvatar } from "@/lib/profile"
import { getMyPlayerSubmission } from "@/lib/playerSubmissions"
import PlayerCardSubmission from "@/components/PlayerCardSubmission"
import TeamMembershipCard from "@/components/TeamMembershipCard"
import MedicalCertificateCard from "@/components/MedicalCertificateCard"
import BirthDateCard from "@/components/BirthDateCard"
import BlockedUsersCard from "@/components/BlockedUsersCard"
import { RoleBadges, deriveRoleItems } from "@/components/RoleBadges"
import { entityPath } from "@/lib/slugs"
import { ProfileSkeleton } from "@/components/skeletons/PageSkeletons"

const sizedUrl = (url, w = 600) => (url ? url.replace(/=w\d+(-h\d+)?.*$/, `=w${w}`) : url)

export default function Profile() {
  const { user, isAdmin, hasRole, roles, loading: authLoading, signOut, openAuth, refreshProfile, signInWithEmail, updatePassword } = useAuth()
  const { dark, toggle } = useTheme()

  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [name, setName] = useState("")
  const [avatar, setAvatar] = useState("")
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [photos, setPhotos] = useState([])
  const [confirmDisconnect, setConfirmDisconnect] = useState(false)
  const [disconnecting, setDisconnecting] = useState(false)
  const [pendingSubmission, setPendingSubmission] = useState(null)
  const [showCreateCard, setShowCreateCard] = useState(false)
  const [uploadingAvatar, setUploadingAvatar] = useState(false)
  const [avatarErr, setAvatarErr] = useState(null)
  const avatarFileRef = useRef(null)

  // Change-password (email/password accounts only — OAuth users have no password)
  const [curPw, setCurPw] = useState("")
  const [newPw, setNewPw] = useState("")
  const [confirmPw, setConfirmPw] = useState("")
  const [pwBusy, setPwBusy] = useState(false)
  const [pwErr, setPwErr] = useState(null)
  const [pwDone, setPwDone] = useState(false)
  const hasPasswordLogin = !!(
    user?.identities?.some(i => i.provider === "email") ||
    user?.app_metadata?.providers?.includes("email") ||
    user?.app_metadata?.provider === "email"
  )

  const changePassword = async (e) => {
    e.preventDefault()
    setPwErr(null); setPwDone(false)
    if (newPw.length < 6) { setPwErr("הסיסמה החדשה חייבת להכיל לפחות 6 תווים"); return }
    if (newPw !== confirmPw) { setPwErr("הסיסמאות אינן תואמות"); return }
    setPwBusy(true)
    try {
      // Verify identity by re-authenticating with the current password before
      // changing it — Supabase's updateUser doesn't require it by default, so
      // this closes the "someone at an unlocked screen changes it" hole.
      await signInWithEmail(user.email, curPw)
      await updatePassword(newPw)
      setPwDone(true)
      setCurPw(""); setNewPw(""); setConfirmPw("")
      setTimeout(() => setPwDone(false), 4000)
    } catch (err) {
      const m = (err?.message || "").toLowerCase()
      if (m.includes("invalid login") || m.includes("credentials")) setPwErr("הסיסמה הנוכחית שגויה")
      else if (m.includes("different from the old") || m.includes("should be different") || m.includes("same")) setPwErr("בחרו סיסמה שונה מהסיסמה הנוכחית")
      else setPwErr(err?.message || "אירעה שגיאה. נסו שוב")
    } finally {
      setPwBusy(false)
    }
  }

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
          setPendingSubmission(null)
          getPlayerPhotos(d.player.id).then(ph => alive && setPhotos(ph)).catch(() => {})
        } else {
          setPhotos([])
          getMyPlayerSubmission().then(s => alive && setPendingSubmission(s)).catch(() => {})
        }
      })
      .catch(() => alive && setData(null))
      .finally(() => alive && setLoading(false))
    return () => { alive = false }
  }, [user, authLoading])

  const reloadProfile = () => {
    getMyProfile().then(d => {
      setData(d)
      if (d?.player) setPendingSubmission(null)
      else getMyPlayerSubmission().then(setPendingSubmission).catch(() => {})
    }).catch(() => {})
  }

  const doDisconnect = async () => {
    setDisconnecting(true)
    try {
      await disconnectPairing()
      setData(prev => ({ ...prev, player: null }))
      setPhotos([])
      setConfirmDisconnect(false)
    } catch (e) { console.error(e) }
    finally { setDisconnecting(false) }
  }

  const handleSave = async () => {
    setSaving(true); setSaved(false)
    try {
      await updateMyProfile({ display_name: name.trim() || null, avatar_url: avatar.trim() || null })
      await refreshProfile()   // reflect the new image/name in the navbar avatar immediately
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
    } catch { /* ignore */ }
    finally { setSaving(false) }
  }

  // Upload a photo file → avatars bucket → persist immediately (no URL pasting).
  const onPickAvatar = async (e) => {
    const f = e.target.files?.[0]
    if (!f) return
    if (!f.type?.startsWith("image/")) { setAvatarErr("קובץ תמונה בלבד"); return }
    if (f.size > 4 * 1024 * 1024) { setAvatarErr("תמונה עד 4MB"); return }
    setAvatarErr(null); setUploadingAvatar(true)
    try {
      const url = await uploadAvatar(f)
      setAvatar(url)
      await updateMyProfile({ avatar_url: url })
      await refreshProfile()
    } catch { setAvatarErr("שגיאה בהעלאה, נסו שוב") }
    finally { setUploadingAvatar(false) }
  }

  // ---- signed-out ----
  if (!authLoading && !user) {
    return (
      <div className="p-4 sm:p-6 lg:p-8 max-w-2xl mx-auto">
        <div className="card p-10 flex flex-col items-center text-center gap-4">
          <div className="w-16 h-16 rounded-full bg-slate-100 dark:bg-slate-800 flex items-center justify-center">
            <UserCircle className="w-9 h-9 text-slate-400" />
          </div>
          <div>
            <h1 className="text-xl font-extrabold text-slate-900 dark:text-white">הדף שלי</h1>
            <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">התחברו כדי לראות את החשבון שלכם</p>
          </div>
          <button onClick={openAuth} className="flex items-center gap-2 px-5 py-2 rounded-lg bg-brand text-white text-sm font-semibold hover:bg-brand-hover transition-colors">
            <LogIn className="w-4 h-4" /> התחברות / הרשמה
          </button>
        </div>
      </div>
    )
  }

  if (authLoading || loading) return <ProfileSkeleton />

  const player = data?.player || null
  const pendingClaim = data?.pendingClaim || null
  const isJudge = hasRole("judge")
  const isPlayer = !!player
  // Badges are derived from the RAW granted roles (+ admin/player signals) so
  // coach and content_editor show, and an admin isn't mislabeled as a judge.
  const roleItems = deriveRoleItems({ roles, isAdmin, isPlayer, guestFallback: true })
  const displayName = name || user.email?.split("@")[0] || "חבר/ת הליגה"
  const initial = (displayName || "?").trim().charAt(0).toUpperCase()

  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-2xl mx-auto space-y-5">
      {/* Header */}
      <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} className="card p-5 sm:p-6">
        <div className="flex items-center gap-4">
          {avatar ? (
            <img src={avatar} alt="" className="w-20 h-20 rounded-2xl object-cover shrink-0 bg-slate-100 dark:bg-slate-700" />
          ) : (
            <div className="w-20 h-20 rounded-2xl shrink-0 flex items-center justify-center bg-brand text-white text-2xl font-extrabold">
              {initial}
            </div>
          )}
          <div className="min-w-0">
            <h1 className="page-title truncate">{displayName}</h1>
            <p className="text-sm text-slate-500 dark:text-slate-400 truncate mt-0.5">{user.email}</p>
            <RoleBadges items={roleItems} className="mt-2.5" />
          </div>
        </div>
      </motion.div>

      {/* Linked player / claim status / guest pairing CTA */}
      {isPlayer ? (
        <div className="card p-4">
          <Link to={entityPath('players', player)} className="flex items-center justify-between gap-3 group">
            <div className="flex items-center gap-3 min-w-0">
              <div className="w-10 h-10 rounded-xl bg-emerald-500 text-white flex items-center justify-center shrink-0">
                <UserCheck className="w-5 h-5" />
              </div>
              <div className="min-w-0">
                <p className="text-sm font-bold text-slate-900 dark:text-white truncate">{player.first_name} {player.last_name}</p>
                <p className="text-[11px] text-slate-500 dark:text-slate-400">הדף האישי שלך כשחקן — סטטיסטיקות ויומן משחקים</p>
              </div>
            </div>
            <ChevronLeft className="w-5 h-5 text-slate-300 dark:text-slate-600 group-hover:text-brand transition-colors shrink-0" />
          </Link>
          <TeamMembershipCard player={player} onChange={reloadProfile} />
          <div className="mt-3 pt-3 border-t border-slate-100 dark:border-slate-700/50">
            {confirmDisconnect ? (
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <span className="text-xs text-slate-500 dark:text-slate-400">לנתק את השיוך לשחקן זה?</span>
                <div className="flex items-center gap-2">
                  <button onClick={doDisconnect} disabled={disconnecting}
                    className="flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-lg bg-red-500 text-white hover:bg-red-600 transition-colors disabled:opacity-50">
                    {disconnecting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Unlink className="w-3.5 h-3.5" />} כן, נתק
                  </button>
                  <button onClick={() => setConfirmDisconnect(false)} disabled={disconnecting}
                    className="text-xs font-semibold px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-600 text-slate-500 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors">
                    ביטול
                  </button>
                </div>
              </div>
            ) : (
              <button onClick={() => setConfirmDisconnect(true)}
                className="flex items-center gap-1.5 text-xs font-semibold text-slate-500 dark:text-slate-400 hover:text-red-600 dark:hover:text-red-400 transition-colors">
                <Unlink className="w-3.5 h-3.5" /> נתק שיוך לשחקן
              </button>
            )}
          </div>
        </div>
      ) : pendingClaim ? (
        <div className="card p-4 flex items-center gap-3 border-amber-200 dark:border-amber-800 bg-amber-50/60 dark:bg-amber-950/20">
          <Clock className="w-5 h-5 text-amber-500 shrink-0" />
          <div className="min-w-0">
            <p className="text-sm font-semibold text-amber-700 dark:text-amber-400">בקשת בעלות ממתינה לאישור מנהל</p>
            <p className="text-[11px] text-amber-600/80 dark:text-amber-500/80 truncate">
              {pendingClaim.players ? `${pendingClaim.players.first_name} ${pendingClaim.players.last_name}` : "שחקן"}
            </p>
          </div>
        </div>
      ) : pendingSubmission ? (
        <div className="card p-4 flex items-center gap-3 border-amber-200 dark:border-amber-800 bg-amber-50/60 dark:bg-amber-950/20">
          <Clock className="w-5 h-5 text-amber-500 shrink-0" />
          <div className="min-w-0">
            <p className="text-sm font-semibold text-amber-700 dark:text-amber-400">כרטיס השחקן שלך ממתין לאישור המאמן</p>
            <p className="text-[11px] text-amber-600/80 dark:text-amber-500/80 truncate">
              {pendingSubmission.first_name} {pendingSubmission.last_name}{pendingSubmission.teams?.name ? ` · ${pendingSubmission.teams.name}` : ""}
            </p>
          </div>
        </div>
      ) : (
        <div className="card p-4 space-y-3">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-3 min-w-0">
              <div className="w-10 h-10 rounded-xl bg-slate-100 dark:bg-slate-800 flex items-center justify-center shrink-0">
                <UserPlus className="w-5 h-5 text-brand" />
              </div>
              <div className="min-w-0">
                <p className="text-sm font-bold text-slate-900 dark:text-white">שיחקת בליגה?</p>
                <p className="text-[11px] text-slate-500 dark:text-slate-400">שייכו את החשבון לפרופיל השחקן שלכם וקבלו גישה לסטטיסטיקות שלכם</p>
              </div>
            </div>
            <Link to="/players" className="flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-lg bg-brand text-white hover:bg-brand-hover transition-colors shrink-0">
              מצא/י את הפרופיל
            </Link>
          </div>
          <div className="pt-3 border-t border-slate-100 dark:border-slate-700/50 flex items-center justify-between gap-3">
            <p className="text-[11px] text-slate-500 dark:text-slate-400">עדיין אין לך כרטיס שחקן בליגה?</p>
            <button onClick={() => setShowCreateCard(true)} className="flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-lg border border-brand/20 dark:border-brand/25 text-brand dark:text-brand-light hover:bg-brand/[0.06] dark:hover:bg-brand/10 transition-colors shrink-0">
              <UserPlus className="w-3.5 h-3.5" /> צור כרטיס שחקן
            </button>
          </div>
        </div>
      )}

      {isPlayer && player && <BirthDateCard playerId={player.id} />}
      {isPlayer && player && <MedicalCertificateCard playerId={player.id} />}

      {/* Role quick-links */}
      {(isJudge || isAdmin) && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {isJudge && (
            <Link to="/judge" className="card card-hover p-4 flex items-center gap-3 group">
              <div className="w-10 h-10 rounded-xl bg-purple-500 text-white flex items-center justify-center shrink-0"><Gavel className="w-5 h-5" /></div>
              <div className="min-w-0">
                <p className="text-sm font-bold text-slate-900 dark:text-white">שיפוט משחקים</p>
                <p className="text-[11px] text-slate-500 dark:text-slate-400">ניהול תוצאות בזמן אמת</p>
              </div>
            </Link>
          )}
          {isAdmin && (
            <Link to="/admin" className="card card-hover p-4 flex items-center gap-3 group">
              <div className="w-10 h-10 rounded-xl bg-brand text-white flex items-center justify-center shrink-0"><Shield className="w-5 h-5" /></div>
              <div className="min-w-0">
                <p className="text-sm font-bold text-slate-900 dark:text-white">ניהול הליגה</p>
                <p className="text-[11px] text-slate-500 dark:text-slate-400">משחקים, שחקנים ובקשות בעלות</p>
              </div>
            </Link>
          )}
        </div>
      )}

      {/* Settings */}
      <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.05 }} className="card p-5 space-y-5">
        <h2 className="text-sm font-bold text-slate-900 dark:text-white uppercase tracking-wide">הגדרות</h2>

        <div className="space-y-4">
          <div className="flex items-center gap-2">
            <UserCircle className="w-4 h-4 text-slate-400" />
            <h3 className="text-sm font-bold text-slate-900 dark:text-white">פרטי פרופיל</h3>
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-500 dark:text-slate-400 mb-1.5">שם תצוגה</label>
            <input
              value={name}
              onChange={e => setName(e.target.value.slice(0, 60))}
              placeholder="איך שיופיע בפוסטים ובתגובות"
              className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-800 dark:text-slate-100 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-brand/30 focus:border-brand"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-500 dark:text-slate-400 mb-1.5">תמונת פרופיל</label>
            <div className="flex items-center gap-3">
              {avatar ? (
                <img src={avatar} alt="" className="w-16 h-16 rounded-2xl object-cover shrink-0 bg-slate-100 dark:bg-slate-700" />
              ) : (
                <div className="w-16 h-16 rounded-2xl shrink-0 flex items-center justify-center bg-brand text-white text-xl font-extrabold">{initial}</div>
              )}
              <div className="flex flex-col gap-1.5">
                <input ref={avatarFileRef} type="file" accept="image/*" onChange={onPickAvatar} className="hidden" />
                <button type="button" onClick={() => avatarFileRef.current?.click()} disabled={uploadingAvatar}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-brand text-white text-xs font-semibold hover:bg-brand-hover transition-colors disabled:opacity-50">
                  {uploadingAvatar ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Camera className="w-3.5 h-3.5" />}
                  {uploadingAvatar ? "מעלה…" : (avatar ? "החלפת תמונה" : "העלאת תמונה")}
                </button>
                {avatar && !uploadingAvatar && (
                  <button type="button"
                    onClick={async () => { setAvatar(""); setAvatarErr(null); await updateMyProfile({ avatar_url: null }); await refreshProfile() }}
                    className="text-[11px] font-semibold text-slate-400 hover:text-red-500 transition-colors self-start">
                    הסרת תמונה
                  </button>
                )}
              </div>
            </div>
            {avatarErr && <p className="mt-1.5 text-xs text-red-600 dark:text-red-400">{avatarErr}</p>}
            <details className="mt-2">
              <summary className="text-[11px] text-slate-500 dark:text-slate-400 cursor-pointer select-none">או הדבקת כתובת תמונה (URL)</summary>
              <input
                value={avatar}
                onChange={e => setAvatar(e.target.value)}
                placeholder="https://…"
                dir="ltr"
                className="mt-1.5 w-full bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-800 dark:text-slate-100 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-brand/30 focus:border-brand text-left"
              />
            </details>
          </div>

          <button onClick={handleSave} disabled={saving}
            className="flex items-center gap-2 px-4 py-2 rounded-lg bg-brand text-white text-sm font-semibold hover:bg-brand-hover transition-colors disabled:opacity-50">
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : saved ? <Trophy className="w-4 h-4" /> : <Save className="w-4 h-4" />}
            {saved ? "נשמר" : "שמירה"}
          </button>
        </div>

        {hasPasswordLogin && (
          <form onSubmit={changePassword} className="pt-4 border-t border-slate-100 dark:border-slate-700/50 space-y-3">
            <div className="flex items-center gap-2">
              <KeyRound className="w-4 h-4 text-slate-400" />
              <h3 className="text-sm font-bold text-slate-900 dark:text-white">שינוי סיסמה</h3>
            </div>
            <input type="password" autoComplete="current-password" required placeholder="סיסמה נוכחית"
              value={curPw} onChange={e => setCurPw(e.target.value)}
              className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-800 dark:text-slate-100 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-brand/30 focus:border-brand" />
            <input type="password" autoComplete="new-password" required minLength={6} placeholder="סיסמה חדשה (לפחות 6 תווים)"
              value={newPw} onChange={e => setNewPw(e.target.value)}
              className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-800 dark:text-slate-100 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-brand/30 focus:border-brand" />
            <input type="password" autoComplete="new-password" required minLength={6} placeholder="אימות סיסמה חדשה"
              value={confirmPw} onChange={e => setConfirmPw(e.target.value)}
              className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-800 dark:text-slate-100 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-brand/30 focus:border-brand" />
            {pwErr && <p className="text-xs text-red-600 dark:text-red-400 font-medium bg-red-50 dark:bg-red-950/40 rounded-lg px-3 py-2">{pwErr}</p>}
            {pwDone && <p className="flex items-center gap-1.5 text-xs text-emerald-600 dark:text-emerald-400 font-medium"><CheckCircle2 className="w-4 h-4" /> הסיסמה עודכנה בהצלחה</p>}
            <button type="submit" disabled={pwBusy}
              className="flex items-center gap-2 px-4 py-2 rounded-lg bg-brand text-white text-sm font-semibold hover:bg-brand-hover transition-colors disabled:opacity-50">
              {pwBusy ? <Loader2 className="w-4 h-4 animate-spin" /> : <KeyRound className="w-4 h-4" />}
              עדכון סיסמה
            </button>
          </form>
        )}

        <div className="pt-4 border-t border-slate-100 dark:border-slate-700/50 space-y-3">
          <div className="flex items-center gap-2">
            <SlidersHorizontal className="w-4 h-4 text-slate-400" />
            <h3 className="text-sm font-bold text-slate-900 dark:text-white">העדפות</h3>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button onClick={toggle}
              className="flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-semibold bg-slate-50 dark:bg-slate-800 text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700 border border-slate-200 dark:border-slate-700 transition-colors">
              {dark ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
              {dark ? "מצב בהיר" : "מצב כהה"}
            </button>
            <button onClick={() => signOut()}
              className="flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-semibold text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-950/30 hover:bg-red-100 dark:hover:bg-red-950/50 border border-red-100 dark:border-red-900/50 transition-colors">
              <LogOut className="w-4 h-4" /> התנתקות
            </button>
          </div>
        </div>
      </motion.div>

      {/* Blocked users manager (parity with iOS AccountView) */}
      <BlockedUsersCard />

      {/* Photos of the linked player from the game albums */}
      {player && photos.length > 0 && (
        <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }} className="card p-5 space-y-3">
          <h2 className="flex items-center gap-2 text-sm font-bold text-slate-900 dark:text-white uppercase tracking-wide">
            <Camera className="w-4 h-4 text-brand" /> תמונות מהמשחקים
          </h2>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
            {photos.map(ph => (
              <a key={ph.photo_id} href={ph.detail_url} target="_blank" rel="noopener noreferrer"
                 className="group relative block aspect-square rounded-lg overflow-hidden bg-slate-900">
                <img src={sizedUrl(ph.image_url)} alt="" loading="lazy"
                     className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-105" />
                {ph.album_title && (
                  <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/70 to-transparent px-2 pt-5 pb-1.5">
                    <span className="text-[10px] font-medium text-white/90 line-clamp-1">{ph.album_title}</span>
                  </div>
                )}
              </a>
            ))}
          </div>
          <p className="text-[11px] text-slate-500 dark:text-slate-400">
            תמונות שזוהו בהן הפנים שלך מאלבומי המשחקים · לחיצה פותחת את התמונה המקורית
          </p>
        </motion.div>
      )}

      {showCreateCard && (
        <PlayerCardSubmission
          onClose={() => setShowCreateCard(false)}
          onSubmitted={() => getMyPlayerSubmission().then(setPendingSubmission).catch(() => {})}
        />
      )}
    </div>
  )
}
