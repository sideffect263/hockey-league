import { useCallback, useEffect, useState } from "react"
import { Eye, Check, Loader2 } from "lucide-react"
import { LikeOn as Heart } from "@/components/icons/BrandIcons"
import { useAuth } from "@/lib/AuthContext"
import { getGameFanSummary, setGameWatch, fansLabel } from "@/lib/follows"
import TeamLogo from "@/components/TeamLogo"
import FollowButton from "@/components/FollowButton"

/**
 * Fans of each side + "אני בא/ה לצפות" (fans-v2.sql, 2026-10-19).
 *
 * Counts only — never who. The two teams' own players are not fans of their team and
 * are playing, not watching, so they get no watch button (the server refuses it too).
 * A watcher counts for a side when they are a fan of exactly that team.
 */
export default function GameFans({ game, home, away }) {
  const { user, openAuth } = useAuth()
  const [s, setS] = useState(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(null)

  const load = useCallback(() => {
    if (!game?.id) return
    getGameFanSummary(game.id).then(setS).catch(() => {})
  }, [game?.id])
  useEffect(() => { load() }, [load, user?.id])

  if (!s || !home || !away) return null
  const total = (s.home_fans || 0) + (s.away_fans || 0)
  // A finished game with nobody behind either team has nothing to say.
  if (!s.open && total === 0 && !s.coming) return null

  const toggle = async () => {
    if (!user) { openAuth?.(); return }
    setBusy(true); setErr(null)
    try { setS(await setGameWatch(game.id, !s.me_coming)) }
    catch { setErr("לא הצלחנו לשמור, נסו שוב") }
    finally { setBusy(false) }
  }

  const homePct = total ? Math.round((s.home_fans / total) * 100) : 50
  // RTL: home on the right, away on the left — same as every scoreboard here.
  const side = (team, n, coming) => (
    <div className="flex flex-col items-center gap-1 min-w-0">
      <TeamLogo team={team} size={10} />
      <span className="text-xs font-bold text-slate-800 dark:text-slate-100 truncate max-w-full">{team.name}</span>
      <span className="text-[11px] text-slate-500 dark:text-slate-400">
        <span className="font-extrabold text-rose-600 dark:text-rose-400 tabular-nums">{fansLabel(n)}</span>
        {s.open && coming > 0 && <> · <span className="tabular-nums">{coming}</span> באים</>}
      </span>
      {!s.me_roster && <FollowButton targetType="team" targetId={team.id} size="sm" showCount={false} onChange={load} />}
    </div>
  )

  return (
    <div className="card p-4">
      <h2 className="flex items-center gap-2 font-bold text-sm text-slate-900 dark:text-white mb-3">
        <Heart className="w-4 h-4 text-rose-500" /> האוהדים
      </h2>
      <div className="grid grid-cols-2 gap-3">
        {side(home, s.home_fans, s.home_coming)}
        {side(away, s.away_fans, s.away_coming)}
      </div>
      {total > 0 && (
        <div className="mt-3 h-1.5 rounded-full overflow-hidden flex bg-slate-100 dark:bg-slate-800" aria-hidden>
          <span className="bg-rose-500" style={{ width: `${homePct}%` }} />
          <span className="bg-slate-400 dark:bg-slate-500 flex-1" />
        </div>
      )}

      {s.open && (
        <div className="mt-4 pt-3 border-t border-slate-100 dark:border-slate-700/60 flex items-center gap-3 flex-wrap">
          <Eye className="w-4 h-4 text-brand shrink-0" />
          <p className="flex-1 min-w-[10rem] text-sm text-slate-700 dark:text-slate-200">
            {s.coming > 0
              ? <><span className="font-extrabold tabular-nums">{s.coming}</span> באים לצפות במשחק</>
              : "עוד אף אחד לא סימן שהוא בא לצפות"}
          </p>
          {s.me_roster ? (
            <span className="text-xs text-slate-500 dark:text-slate-400">את/ה משחק/ת במשחק הזה</span>
          ) : (
            <button onClick={toggle} disabled={busy} aria-pressed={!!s.me_coming}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold transition-colors disabled:opacity-50 ${
                s.me_coming
                  ? "bg-emerald-50 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-300 ring-1 ring-emerald-200 dark:ring-emerald-800"
                  : "bg-brand text-brand-fg hover:bg-brand-hover"}`}>
              {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : s.me_coming ? <Check className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
              {s.me_coming ? "אני בא/ה" : "אני בא/ה לצפות"}
            </button>
          )}
          {err && <p className="w-full text-xs text-red-600 dark:text-red-400">{err}</p>}
        </div>
      )}
    </div>
  )
}
