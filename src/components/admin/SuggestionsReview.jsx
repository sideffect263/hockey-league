import { useState, useEffect } from "react"
import { getSuggestionQueue, resolveCluster, hideCluster } from "@/lib/media"
import { Camera, Check, EyeOff, RefreshCw, HelpCircle } from "lucide-react"
import { SkeletonPanelRows } from "@/components/skeletons/PageSkeletons"

/**
 * Admin review queue for crowdsourced face-cluster name suggestions.
 * Approve → links the cluster to a roster player + marks it resolved (which flows
 * into the photo_players view and enriches the feed). Hide → drops it from Media.
 */
export default function SuggestionsReview({ players = [] }) {
  const [queue, setQueue] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [busyKey, setBusyKey] = useState(null)
  const [choice, setChoice] = useState({}) // cluster_key -> selected player_id

  const playerName = (p) => `${p.first_name} ${p.last_name}`.trim()
  const byFullName = Object.fromEntries(players.map(p => [playerName(p), p.id]))

  const load = async () => {
    try {
      setLoading(true); setError(null)
      const q = await getSuggestionQueue()
      setQueue(q)
      // pre-select the roster player matching each cluster's top suggestion
      const pre = {}
      for (const c of q) {
        const top = c.suggestions[0]?.name
        if (top && byFullName[top]) pre[c.cluster_key] = byFullName[top]
      }
      setChoice(pre)
    } catch (e) { console.error(e); setError("שגיאה בטעינת ההצעות") }
    finally { setLoading(false) }
  }
  useEffect(() => { load() }, [players.length]) // eslint-disable-line

  const approve = async (c) => {
    const pid = choice[c.cluster_key]
    if (!pid) { setError("בחר שחקן מהרשימה לפני האישור"); return }
    const p = players.find(x => x.id === pid)
    setBusyKey(c.cluster_key); setError(null)
    try { await resolveCluster(c.cluster_key, { playerId: pid, playerName: playerName(p) }); await load() }
    catch (e) { console.error(e); setError("שגיאה באישור") }
    finally { setBusyKey(null) }
  }
  const hide = async (c) => {
    setBusyKey(c.cluster_key); setError(null)
    try { await hideCluster(c.cluster_key); await load() }
    catch (e) { console.error(e); setError("שגיאה בהסתרה") }
    finally { setBusyKey(null) }
  }

  return (
    <div className="space-y-4 mt-8 pt-6 border-t border-slate-200 dark:border-slate-700">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="flex items-center gap-2 text-lg font-bold text-slate-900 dark:text-white">
            <Camera className="w-5 h-5 text-brand" /> הצעות זיהוי שחקנים
          </h2>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-0.5">
            הצעות מהגולשים לזיהוי פנים בתמונות. אישור מקשר לשחקן ומשבץ אותו בעדכונים
          </p>
        </div>
        <button onClick={load} className="flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-600 text-slate-500 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors">
          <RefreshCw className="w-3.5 h-3.5" /> רענון
        </button>
      </div>

      {error && (
        <div className="card p-3 border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-950/30 text-sm text-red-700 dark:text-red-400">{error}</div>
      )}

      {loading ? (
        <SkeletonPanelRows />
      ) : queue.length === 0 ? (
        <div className="card p-10 text-center">
          <HelpCircle className="w-10 h-10 mx-auto text-slate-300 dark:text-slate-600 mb-2" />
          <p className="text-sm font-medium text-slate-500 dark:text-slate-400">אין הצעות זיהוי ממתינות</p>
        </div>
      ) : (
        <div className="space-y-2.5">
          {queue.map(c => {
            const busy = busyKey === c.cluster_key
            return (
              <div key={c.cluster_key} className="card p-4 flex flex-col sm:flex-row gap-4">
                {c.cover_url && (
                  <img src={c.cover_url} alt="" className="w-full sm:w-40 h-40 sm:h-28 object-cover rounded-lg bg-slate-900 shrink-0" />
                )}
                <div className="flex-1 min-w-0 flex flex-col gap-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-xs text-slate-500 dark:text-slate-400">{c.size} תמונות</span>
                    {Array.isArray(c.albums) && c.albums[0] && (
                      <span className="text-xs text-slate-500 dark:text-slate-400">· {c.albums[0].title}</span>
                    )}
                  </div>
                  {/* suggested names with vote counts */}
                  <div className="flex flex-wrap gap-1.5">
                    {c.suggestions.map(s => (
                      <span key={s.name} className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded-full bg-slate-100 dark:bg-slate-700 text-slate-700 dark:text-slate-200">
                        {s.name} <span className="text-brand font-bold">{s.count}</span>
                      </span>
                    ))}
                  </div>
                  {/* approve controls */}
                  <div className="flex flex-wrap items-center gap-2 mt-1">
                    <select
                      value={choice[c.cluster_key] || ""}
                      onChange={e => setChoice(ch => ({ ...ch, [c.cluster_key]: e.target.value }))}
                      className="filter-select text-sm max-w-[220px]">
                      <option value="">בחר שחקן…</option>
                      {players.map(p => (
                        <option key={p.id} value={p.id}>{playerName(p)}</option>
                      ))}
                    </select>
                    <button onClick={() => approve(c)} disabled={busy || !choice[c.cluster_key]}
                      className="flex items-center gap-1.5 text-xs font-semibold px-3 py-2 rounded-lg bg-emerald-500 text-white hover:bg-emerald-600 transition-colors disabled:opacity-50">
                      <Check className="w-3.5 h-3.5" /> אישור
                    </button>
                    <button onClick={() => hide(c)} disabled={busy}
                      className="flex items-center gap-1.5 text-xs font-semibold px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-600 text-slate-500 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors disabled:opacity-50">
                      <EyeOff className="w-3.5 h-3.5" /> הסתר
                    </button>
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
