import { useEffect, useState } from "react"
import { Crown, AlertTriangle } from "lucide-react"
import TeamLogo from "@/components/TeamLogo"
import { getLeagueSetting, setLeagueSetting } from "@/lib/api"

/* Admin control for the two league_settings keys the site READS but nothing wrote:
 *   season_mode       'regular' | 'final_four'  (App.jsx → Feed / PlayerDetail)
 *   champion_team_id  team id, or '' for none    (Home bracket, Feed champion post,
 *                                                  PlayerDetail season summary)
 * The value column is NOT NULL and there is no delete policy, so "no champion" is
 * written as an empty string — every reader does `value || null`.
 * Writes go through the admin-only INSERT/UPDATE RLS on league_settings. */

export const SEASON_MODES = {
  regular: { label: "עונה סדירה", hint: "ברירת המחדל — הליגה בעיצומה." },
  final_four: { label: "Final Four / סיום עונה", hint: "כשנבחרה אלופה: פוסט האלופה ומלך השערים בפיד, וסיכום עונה בכרטיסי השחקנים." },
}

export default function SeasonModeControl({ teams, onModeSaved }) {
  const [loaded, setLoaded] = useState(false)
  const [loadErr, setLoadErr] = useState(null)
  const [saved, setSaved] = useState({ mode: "regular", champion: "" })
  const [mode, setMode] = useState("regular")
  const [champion, setChampion] = useState("")
  const [confirming, setConfirming] = useState(false)
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState(null)

  // Champion candidates: active (getTeams already filters status) and never a 🧪 test team.
  const candidates = teams.filter(t => !t.is_test).sort((a, b) => a.name.localeCompare(b.name, "he"))
  const teamById = new Map(teams.map(t => [t.id, t]))

  const load = async () => {
    setLoadErr(null)
    try {
      const [m, c] = await Promise.all([getLeagueSetting("season_mode"), getLeagueSetting("champion_team_id")])
      const next = { mode: m === "final_four" ? "final_four" : "regular", champion: c || "" }
      setSaved(next); setMode(next.mode); setChampion(next.champion)
    } catch (e) { setLoadErr(e.message || "שגיאה בטעינת ההגדרות") }
    finally { setLoaded(true) }
  }
  useEffect(() => { load() }, [])

  const dirty = mode !== saved.mode || champion !== saved.champion
  const teamName = (id) => (id ? (teamById.get(id)?.name || "קבוצה לא ידועה") : "ללא אלופה")

  const handleSave = async () => {
    setSaving(true); setErr(null)
    try {
      if (mode !== saved.mode) await setLeagueSetting("season_mode", mode)
      if (champion !== saved.champion) await setLeagueSetting("champion_team_id", champion)
      // Confirm the write actually landed — an RLS-gated upsert can no-op without an error.
      const [m, c] = await Promise.all([getLeagueSetting("season_mode"), getLeagueSetting("champion_team_id")])
      const landed = { mode: m === "final_four" ? "final_four" : "regular", champion: c || "" }
      setSaved(landed); setMode(landed.mode); setChampion(landed.champion)
      if (landed.mode !== mode || landed.champion !== champion) throw new Error("השמירה לא נקלטה (אין הרשאה?)")
      onModeSaved?.(landed.mode)
      setConfirming(false)
    } catch (e) { setErr("שגיאה בשמירה: " + (e.message || e)) }
    finally { setSaving(false) }
  }

  const savedChampion = saved.champion ? teamById.get(saved.champion) : null

  return (
    <div className="card p-5">
      <h3 className="font-bold text-sm text-slate-900 dark:text-white mb-1 flex items-center gap-2">
        <Crown className="w-4 h-4 text-amber-500" /> מצב עונה ואלופה
      </h3>
      <p className="text-xs text-slate-500 dark:text-slate-400 mb-4">
        קובע אם האתר מציג את סיום העונה (פוסט אלופה, מלך השערים) ואת האלופה בסוגריים של הפלייאוף.
      </p>

      {!loaded ? (
        <div className="h-24 rounded-xl bg-slate-100 dark:bg-slate-800/50 animate-pulse" />
      ) : loadErr ? (
        <p className="text-sm text-red-600 dark:text-red-400">{loadErr}</p>
      ) : (
        <>
          {/* current state */}
          <div className="grid grid-cols-2 gap-3 mb-4">
            <div className="bg-slate-50 dark:bg-slate-800/50 rounded-xl p-3">
              <p className="text-[10px] text-slate-400 font-medium mb-0.5">מצב נוכחי</p>
              <p className="text-sm font-bold text-slate-900 dark:text-white">{SEASON_MODES[saved.mode].label}</p>
            </div>
            <div className="bg-slate-50 dark:bg-slate-800/50 rounded-xl p-3">
              <p className="text-[10px] text-slate-400 font-medium mb-0.5">אלופה נוכחית</p>
              <p className="text-sm font-bold text-slate-900 dark:text-white flex items-center gap-1.5 min-w-0">
                {savedChampion && <TeamLogo team={savedChampion} size={5} />}
                <span className="truncate">{teamName(saved.champion)}</span>
              </p>
            </div>
          </div>

          {!confirming ? (
            <div className="flex flex-wrap items-end gap-3">
              <div className="flex-1 min-w-[170px]">
                <label className="text-xs font-semibold text-slate-500 dark:text-slate-400 mb-1 block">מצב עונה</label>
                <select value={mode} onChange={e => setMode(e.target.value)} className="filter-input w-full">
                  {Object.entries(SEASON_MODES).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
                </select>
              </div>
              <div className="flex-1 min-w-[170px]">
                <label className="text-xs font-semibold text-slate-500 dark:text-slate-400 mb-1 block">אלופה</label>
                <select value={champion} onChange={e => setChampion(e.target.value)} className="filter-input w-full">
                  <option value="">— ללא אלופה —</option>
                  {candidates.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                  {/* keep a saved champion selectable even if it is no longer a candidate */}
                  {champion && !candidates.some(t => t.id === champion) && <option value={champion}>{teamName(champion)}</option>}
                </select>
              </div>
              <button onClick={() => { setErr(null); setConfirming(true) }} disabled={!dirty}
                className="px-5 py-2.5 bg-brand text-white text-sm font-semibold rounded-xl hover:opacity-90 transition-opacity disabled:opacity-50 disabled:cursor-not-allowed">
                שמור
              </button>
              <p className="w-full text-[11px] text-slate-400">{SEASON_MODES[mode].hint}</p>
            </div>
          ) : (
            <div className="p-4 bg-amber-50 dark:bg-amber-900/20 border-2 border-amber-200 dark:border-amber-800 rounded-xl space-y-3">
              <div className="flex items-start gap-2">
                <AlertTriangle className="w-5 h-5 text-amber-500 shrink-0 mt-0.5" />
                <div className="text-xs text-amber-800 dark:text-amber-300 space-y-1">
                  <h4 className="font-bold text-sm">לשמור את השינוי? הוא מוצג מיד לכל הגולשים באתר.</h4>
                  {mode !== saved.mode && <p>מצב עונה: <strong>{SEASON_MODES[saved.mode].label}</strong> ← <strong>{SEASON_MODES[mode].label}</strong></p>}
                  {champion !== saved.champion && <p>אלופה: <strong>{teamName(saved.champion)}</strong> ← <strong>{teamName(champion)}</strong></p>}
                </div>
              </div>
              <div className="flex gap-2">
                <button onClick={handleSave} disabled={saving}
                  className="px-5 py-2.5 bg-amber-600 text-white text-sm font-semibold rounded-xl hover:bg-amber-700 transition-colors disabled:opacity-50">
                  {saving ? "שומר…" : "אשר ושמור"}
                </button>
                <button onClick={() => setConfirming(false)} disabled={saving}
                  className="px-4 py-2.5 text-sm font-semibold text-slate-500 hover:text-slate-700 dark:hover:text-slate-300 transition-colors">
                  ביטול
                </button>
              </div>
            </div>
          )}
          {err && <p className="text-xs text-red-600 dark:text-red-400 mt-2">{err}</p>}
        </>
      )}
    </div>
  )
}
