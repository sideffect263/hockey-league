import { useState } from "react"
import { Loader2 } from "lucide-react"
import { CalendarPlus } from "@/components/icons/BrandIcons"
import { createGames } from "@/lib/api"
import { roundRobin, knockoutFirstRound, groupStage, buildGames } from "@/lib/scheduleGenerator"

/**
 * Schedule generator (Package 3), shown on the tournament page to managers. Turns
 * the tournament's accepted teams into games — round-robin (single/home-away),
 * knockout first round, or group stage — with dates spread across the tournament.
 * Shows a preview before creating; every game stays editable in the games admin.
 */
export default function ScheduleGenerator({ tournament, teamIds = [], teamsMap = {}, existingGames = 0, onChange }) {
  const [format, setFormat] = useState("round_robin")
  const [meetings, setMeetings] = useState("single")
  const [numGroups, setNumGroups] = useState(2)
  const [preview, setPreview] = useState(null)
  const [busy, setBusy] = useState(false)

  const selectCls = "mt-1 w-full bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg px-2 py-1.5 text-sm text-slate-800 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-brand/30"
  const name = (tid) => teamsMap[tid]?.name || "—"

  const compute = () => {
    let rounds = []
    if (format === "round_robin") rounds = roundRobin(teamIds, meetings === "double")
    else if (format === "knockout") rounds = knockoutFirstRound(teamIds)
    else rounds = groupStage(teamIds, Number(numGroups) || 2)
    const games = buildGames(rounds, { tournamentId: tournament.id, startDate: tournament.start_date, endDate: tournament.end_date })
    setPreview({ games })
  }

  const create = async () => {
    if (!preview?.games?.length) return
    setBusy(true)
    try { await createGames(preview.games); setPreview(null); await onChange?.() }
    catch (e) { alert('שגיאה: ' + (e.message || e)) } finally { setBusy(false) }
  }

  if (teamIds.length < 2) {
    return (
      <div className="card p-5 text-sm text-slate-500 dark:text-slate-400 ring-1 ring-brand/20">
        כדי ליצור לוח משחקים, הזמינו לפחות שתי קבוצות שאישרו השתתפות.
      </div>
    )
  }

  return (
    <div className="card p-5 space-y-3 ring-1 ring-brand/20">
      <h2 className="flex items-center gap-2 text-sm font-bold text-slate-900 dark:text-white">
        <CalendarPlus className="w-4 h-4 text-brand" /> יצירת לוח משחקים
      </h2>
      {existingGames > 0 && (
        <p className="text-xs text-amber-600 dark:text-amber-400">כבר יש {existingGames} משחקים בטורניר. יצירה מוסיפה משחקים חדשים (לא מוחקת קיימים).</p>
      )}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
        <label className="text-xs font-semibold text-slate-500 dark:text-slate-400">שיטה
          <select value={format} onChange={e => { setFormat(e.target.value); setPreview(null) }} className={selectCls}>
            <option value="round_robin">ליגה (כולם נגד כולם)</option>
            <option value="knockout">נוקאאוט (סבב ראשון)</option>
            <option value="groups">שלב בתים</option>
          </select>
        </label>
        {format === "round_robin" && (
          <label className="text-xs font-semibold text-slate-500 dark:text-slate-400">מפגשים
            <select value={meetings} onChange={e => { setMeetings(e.target.value); setPreview(null) }} className={selectCls}>
              <option value="single">פעם אחת</option>
              <option value="double">הלוך ושוב</option>
            </select>
          </label>
        )}
        {format === "groups" && (
          <label className="text-xs font-semibold text-slate-500 dark:text-slate-400">מספר בתים
            <input type="number" min="2" max={Math.max(2, Math.floor(teamIds.length / 2))} value={numGroups}
              onChange={e => { setNumGroups(e.target.value); setPreview(null) }} className={selectCls} />
          </label>
        )}
      </div>
      <div className="flex items-center gap-2">
        <button onClick={compute}
          className="text-sm font-semibold px-3 py-2 rounded-lg border border-brand/30 dark:border-brand/25 text-brand dark:text-brand-light hover:bg-brand/[0.06] dark:hover:bg-brand/10 transition-colors">
          תצוגה מקדימה
        </button>
        {preview && (
          <button onClick={create} disabled={busy || !preview.games.length}
            className="flex items-center gap-1.5 text-sm font-semibold px-3 py-2 rounded-lg bg-brand text-white hover:bg-brand-hover transition-colors disabled:opacity-50">
            {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <CalendarPlus className="w-4 h-4" />} צור {preview.games.length} משחקים
          </button>
        )}
      </div>
      {preview && (
        <div className="space-y-1.5 max-h-64 overflow-y-auto pt-1">
          {preview.games.length === 0 ? (
            <p className="text-xs text-slate-400">אין משחקים ליצירה בשיטה זו.</p>
          ) : preview.games.map((g, i) => (
            <div key={i} className="flex items-center justify-center gap-2 text-xs bg-slate-50 dark:bg-slate-800/60 rounded-lg px-3 py-1.5">
              <span className="font-semibold text-slate-700 dark:text-slate-200">{name(g.home_team_id)}</span>
              <span className="text-slate-400">נגד</span>
              <span className="font-semibold text-slate-700 dark:text-slate-200">{name(g.away_team_id)}</span>
            </div>
          ))}
        </div>
      )}
      <p className="text-[11px] text-slate-500 dark:text-slate-400">
        התאריכים נפרסים אוטומטית לאורך תאריכי הטורניר. אפשר לערוך כל משחק (תאריך, מגרש) בלשונית "משחקים" בניהול. בנוקאאוט/בתים — שלבי ההמשך נוספים ידנית לפי התוצאות.
      </p>
    </div>
  )
}
