import { useState } from "react"
import { Star, Loader2 } from "lucide-react"
import { supabase } from "@/lib/supabase"
import { PlayerLink } from "@/components/EntityLinks"

/** Set (or clear, with null) a game's MVP — admin / league manager / judge only. */
export async function setGameMvp(gameId, playerId) {
  const { error } = await supabase.rpc("set_game_mvp", { p_game_id: gameId, p_player_id: playerId })
  if (error) throw error
}

/**
 * MVP of a completed game (Yarden, 2026-07-20: "the referee picks an MVP and it goes
 * into the stats"). Everyone sees the pick; an official picks it — from the players
 * with a box-score line in this game, so the choice is always someone who played.
 */
export default function GameMvp({ game, stats = [], playersMap = {}, teamsMap = {}, canPick = false, onChanged }) {
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(null)
  const mvp = game.mvp_player_id ? playersMap[game.mvp_player_id] : null
  if (!mvp && !canPick) return null

  const candidates = [...new Map(
    stats.filter(s => s.player_id && playersMap[s.player_id]).map(s => [s.player_id, playersMap[s.player_id]])
  ).values()].sort((a, b) => `${a.first_name} ${a.last_name}`.localeCompare(`${b.first_name} ${b.last_name}`, "he"))

  const pick = async (pid) => {
    setBusy(true); setErr(null)
    try { await setGameMvp(game.id, pid || null); onChanged?.(pid || null) }
    catch (e) { setErr(e.message === "player not in game" ? "השחקן לא שיחק במשחק הזה" : "השמירה נכשלה") }
    finally { setBusy(false) }
  }

  return (
    <div className="card p-4 flex items-center gap-3 flex-wrap">
      <span className="w-9 h-9 rounded-xl bg-amber-100 dark:bg-amber-900/40 flex items-center justify-center shrink-0">
        <Star className="w-5 h-5 text-amber-500 fill-amber-400" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-[11px] font-bold text-amber-600 dark:text-amber-400">MVP של המשחק</p>
        {mvp ? (
          <PlayerLink playerId={mvp.id} className="block font-bold text-sm text-slate-900 dark:text-white hover:text-brand truncate">
            {mvp.first_name} {mvp.last_name}
            <span className="font-normal text-xs text-slate-500 dark:text-slate-400"> · {teamsMap[mvp.team_id]?.name || ""}</span>
          </PlayerLink>
        ) : (
          <p className="text-sm text-slate-500 dark:text-slate-400">טרם נבחר</p>
        )}
      </div>
      {canPick && (
        <div className="flex items-center gap-2">
          <select value={game.mvp_player_id || ""} disabled={busy || candidates.length === 0}
            onChange={e => pick(e.target.value)} aria-label="בחירת MVP"
            className="bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg px-2.5 py-1.5 text-xs text-slate-800 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-brand/30">
            <option value="">{candidates.length ? "בחירת MVP…" : "אין סטטיסטיקות למשחק"}</option>
            {candidates.map(p => (
              <option key={p.id} value={p.id}>{p.first_name} {p.last_name} · {teamsMap[p.team_id]?.name || ""}</option>
            ))}
          </select>
          {busy && <Loader2 className="w-3.5 h-3.5 animate-spin text-slate-400" />}
        </div>
      )}
      {err && <p className="w-full text-[11px] text-red-600 dark:text-red-400">{err}</p>}
    </div>
  )
}
