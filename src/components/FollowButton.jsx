import { useState, useEffect } from "react"
import { UserPlus, UserCheck, Bell, BellOff, Loader2, Shirt } from "lucide-react"
import { useAuth } from "@/lib/AuthContext"
import { follow, unfollow, setFollowNotify, getMyFollows, getFollowerCounts, getMyRosterTeamIds, fansLabel } from "@/lib/follows"
import { PersonFollow, PersonFollowing } from "@/components/icons/BrandIcons"

/**
 * Follow a team or a player (P5 / sheet row 24).
 *
 * Two controls, deliberately: the first follows (which shapes your feed), the second
 * turns on notifications for it. Collapsing them into one would mean every follow
 * signs you up for a push on every goal — the fastest way to make people unfollow.
 * Following is cheap; being buzzed is not.
 *
 * A player is not a fan of his own team (or of himself): there the button turns into a
 * plain "הקבוצה שלי" / "האוהדים שלך" chip with the count. The count itself already
 * leaves the team's own players out (follower_counts, fans-v2.sql).
 */
// onDark: sits on a dark coloured surface (the team page header) — a solid white
// "follow" and glass for the rest, readable whatever the team's colours are.
export default function FollowButton({ targetType, targetId, size = "md", showCount = true, onDark = false, onChange }) {
  const { user, openAuth, profile } = useAuth()
  const [own, setOwn] = useState(false)
  const [following, setFollowing] = useState(false)
  const [notify, setNotify] = useState(false)
  const [count, setCount] = useState(null)
  const [busy, setBusy] = useState(false)
  const [ready, setReady] = useState(false)

  useEffect(() => {
    let alive = true
    const load = async () => {
      const [rows, counts, roster] = await Promise.all([
        user ? getMyFollows() : Promise.resolve([]),
        showCount ? getFollowerCounts(targetType, [targetId]) : Promise.resolve({}),
        user && targetType === "team" ? getMyRosterTeamIds() : Promise.resolve(new Set()),
      ])
      if (!alive) return
      setOwn(targetType === "team" ? roster.has(targetId) : !!user && profile?.player_id === targetId)
      const mine = rows.find(r => r.target_type === targetType && r.target_id === targetId)
      setFollowing(!!mine)
      setNotify(!!mine?.notify)
      if (showCount) setCount(counts[targetId] ?? 0)
      setReady(true)
    }
    load().catch(() => { if (alive) setReady(true) })
    return () => { alive = false }
  }, [user, targetType, targetId, showCount, profile?.player_id])

  if (!targetId) return null

  const toggleFollow = async () => {
    if (!user) { openAuth?.(); return }
    setBusy(true)
    const next = !following
    try {
      if (next) await follow(targetType, targetId, false)
      else await unfollow(targetType, targetId)
      setFollowing(next)
      if (!next) setNotify(false)
      setCount(c => (c == null ? c : Math.max(0, c + (next ? 1 : -1))))
      onChange?.(next)
    } catch { /* leave the previous state visible rather than lying about it */ }
    finally { setBusy(false) }
  }

  const toggleNotify = async () => {
    if (!user || !following) return
    setBusy(true)
    const next = !notify
    try { await setFollowNotify(targetType, targetId, next); setNotify(next) }
    catch { /* ignore */ }
    finally { setBusy(false) }
  }

  const sm = size === "sm"
  const pad = sm ? "px-2.5 py-1 text-[11px]" : "px-3 py-1.5 text-xs"

  if (own) {
    return (
      <span title={targetType === "team" ? "את/ה משחק/ת בקבוצה — שחקנים לא נספרים כאוהדים שלה" : "שחקן לא נספר כאוהד של עצמו"}
        className={`inline-flex items-center gap-1.5 font-bold rounded-xl ${pad} ${
          onDark ? "bg-white/15 text-white ring-1 ring-white/25" : "bg-slate-100 dark:bg-slate-700 text-slate-700 dark:text-slate-200"}`}>
        <Shirt className="w-3.5 h-3.5" />
        {targetType === "team" ? "הקבוצה שלי" : "האוהדים שלך"}
        {showCount && count != null && (
          <span className="tabular-nums opacity-70">· {fansLabel(count)}</span>
        )}
      </span>
    )
  }

  return (
    <div className="inline-flex items-center gap-1.5">
      <button onClick={toggleFollow} disabled={busy || !ready}
        aria-pressed={following}
        className={`inline-flex items-center gap-1.5 font-bold rounded-xl transition-colors disabled:opacity-50 ${pad} ${
          onDark
            ? following
              ? "bg-white/15 text-white ring-1 ring-white/25 hover:bg-white/25"
              : "bg-white text-slate-900 hover:bg-white/90"
            : following
              ? "bg-slate-100 dark:bg-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-200 dark:hover:bg-slate-600"
              : "bg-brand text-brand-fg hover:bg-brand-hover"
        }`}>
        {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
          : following ? <PersonFollowing className="w-4 h-4" /> : <PersonFollow className="w-4 h-4" />}
        {following ? "אוהד/ת ✓" : "אוהד/ת"}
        {showCount && count != null && count > 0 && (
          <span className="tabular-nums opacity-70">{count}</span>
        )}
      </button>

      {/* Only meaningful once you follow — otherwise there is nothing to be notified about. */}
      {following && (
        <button onClick={toggleNotify} disabled={busy}
          aria-pressed={notify}
          title={notify ? "כיבוי התראות על הקבוצה" : "קבלת התראות על משחקים ואירועים"}
          aria-label={notify ? "כיבוי התראות" : "הפעלת התראות"}
          className={`inline-flex items-center justify-center rounded-xl transition-colors disabled:opacity-50 ${sm ? "p-1" : "p-1.5"} ${
            onDark
              ? notify ? "bg-white/20 text-white" : "text-white/70 hover:text-white hover:bg-white/15"
              : notify
                ? "bg-brand/10 text-brand"
                : "text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700"
          }`}>
          {notify ? <Bell className="w-3.5 h-3.5" /> : <BellOff className="w-3.5 h-3.5" />}
        </button>
      )}
    </div>
  )
}
