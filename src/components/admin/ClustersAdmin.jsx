import { useState, useEffect, useMemo, useCallback } from "react"
import { getAllClusters, resolveCluster, reopenCluster, hideCluster } from "@/lib/media"
import { Images, Check, Undo2, RefreshCw, HelpCircle, Loader2, Search, X, EyeOff } from "lucide-react"
import { SkeletonPanelRows } from "@/components/skeletons/PageSkeletons"

const PAGE = 30

/**
 * Admin editor for face clusters, grouped by status:
 *  - מזוהים (resolved): re-link to a different player, or undo the decision
 *  - מוסתרים (hidden): restore to the Media page, or assign a player directly
 *  - באים לזיהוי (unresolved): assign a player without waiting for the crowd, or hide
 *
 * Undo (reopen) wipes the cluster's old suggestions and clears its name, which also
 * pulls the player's face tags for that cluster out of the feed (photo_players derives
 * from resolved clusters). The unresolved tab is what makes a mis-clicked reopen
 * recoverable — otherwise a name-less cluster is unreachable from every admin view.
 */
export default function ClustersAdmin({ players = [] }) {
  const [clusters, setClusters] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [busyKey, setBusyKey] = useState(null)
  const [confirmKey, setConfirmKey] = useState(null)   // cluster awaiting reopen confirmation
  const [choice, setChoice] = useState({})             // cluster_key -> selected player_id
  const [tab, setTab] = useState("resolved")           // resolved | hidden | unresolved
  const [q, setQ] = useState("")
  const [visible, setVisible] = useState(PAGE)

  const playerName = (p) => `${p.first_name} ${p.last_name}`.trim()

  const load = useCallback(async () => {
    try {
      setLoading(true); setError(null)
      const rows = await getAllClusters()
      setClusters(rows)
      setChoice(Object.fromEntries(rows.map(c => [c.cluster_key, c.player_id || ""])))
      setConfirmKey(null)
    } catch (e) { console.error(e); setError("שגיאה בטעינת קבוצות התמונות") }
    finally { setLoading(false) }
  }, [])
  useEffect(() => { load() }, [load])

  const counts = useMemo(() => ({
    resolved: clusters.filter(c => c.status === "resolved").length,
    hidden: clusters.filter(c => c.status === "hidden").length,
    unresolved: clusters.filter(c => c.status === "unresolved").length,
  }), [clusters])

  const albumTitle = (c) => (Array.isArray(c.albums) && c.albums[0]?.title) || ""
  const shown = useMemo(() => {
    const needle = q.trim()
    return clusters
      .filter(c => c.status === tab)
      .filter(c => !needle
        || (c.player_name || "").includes(needle)
        || c.cluster_key.includes(needle)
        || albumTitle(c).includes(needle))
  }, [clusters, tab, q])

  // reset pagination when the view changes
  useEffect(() => { setVisible(PAGE) }, [tab, q])

  const switchTab = (id) => { setTab(id); setConfirmKey(null); setQ("") }

  // Assign/re-link the cluster to a roster player → resolved.
  const save = async (c) => {
    const pid = choice[c.cluster_key]
    if (!pid) { setError("בחר שחקן מהרשימה"); return }
    const p = players.find(x => x.id === pid)
    setBusyKey(c.cluster_key); setError(null)
    try { await resolveCluster(c.cluster_key, { playerId: pid, playerName: playerName(p) }); await load() }
    catch (e) { console.error(e); setError(e.message || "שגיאה בשמירת השינוי") }
    finally { setBusyKey(null) }
  }
  // Undo a decision: clear the name, delete old suggestions, back to the Media page.
  const reopen = async (c) => {
    setBusyKey(c.cluster_key); setError(null)
    try { await reopenCluster(c.cluster_key); await load() }
    catch (e) { console.error(e); setError(e.message || "שגיאה בביטול ההחלטה") }
    finally { setBusyKey(null) }
  }
  // Hide an unresolved cluster (not a real/identifiable player) off the Media page.
  const hide = async (c) => {
    setBusyKey(c.cluster_key); setError(null)
    try { await hideCluster(c.cluster_key); await load() }
    catch (e) { console.error(e); setError(e.message || "שגיאה בהסתרה") }
    finally { setBusyKey(null) }
  }

  const TABS = [
    { id: "resolved", label: `מזוהים (${counts.resolved})` },
    { id: "unresolved", label: `באים לזיהוי (${counts.unresolved})` },
    { id: "hidden", label: `מוסתרים (${counts.hidden})` },
  ]

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="flex items-center gap-2 text-lg font-bold text-slate-900 dark:text-white">
            <Images className="w-5 h-5 text-brand" /> עריכת קבוצות תמונות
          </h2>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-0.5">
            תיקון שם, ביטול זיהוי והחזרה לעמוד המדיה, או שיוך שחקן ישירות ללא המתנה להצעות
          </p>
        </div>
        <button onClick={load} className="flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-600 text-slate-500 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors">
          <RefreshCw className="w-3.5 h-3.5" /> רענון
        </button>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="flex gap-1 p-1 rounded-xl bg-slate-100 dark:bg-slate-800">
          {TABS.map(t => (
            <button key={t.id} onClick={() => switchTab(t.id)}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
                tab === t.id
                  ? "bg-white dark:bg-slate-700 text-slate-900 dark:text-white shadow-sm"
                  : "text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white"
              }`}>
              {t.label}
            </button>
          ))}
        </div>
        <div className="relative flex-1 min-w-[160px] max-w-xs">
          <Search className="absolute top-1/2 -translate-y-1/2 right-3 w-3.5 h-3.5 text-slate-400 pointer-events-none" />
          <input value={q} onChange={e => setQ(e.target.value)}
            placeholder={tab === "resolved" ? "חיפוש לפי שם שחקן" : "חיפוש לפי מזהה או אלבום"}
            className="filter-input w-full text-sm pr-9" />
          {q && (
            <button onClick={() => setQ("")} aria-label="נקה חיפוש"
              className="absolute top-1/2 -translate-y-1/2 left-3 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200">
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      </div>

      {error && (
        <div className="card p-3 border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-950/30 text-sm text-red-700 dark:text-red-400">{error}</div>
      )}

      {loading ? (
        <SkeletonPanelRows />
      ) : shown.length === 0 ? (
        <div className="card p-10 text-center">
          <HelpCircle className="w-10 h-10 mx-auto text-slate-300 dark:text-slate-600 mb-2" />
          <p className="text-sm font-medium text-slate-500 dark:text-slate-400">
            {q.trim() ? "לא נמצאו קבוצות תמונות לחיפוש הזה"
              : tab === "resolved" ? "אין עדיין קבוצות תמונות מזוהות"
              : tab === "hidden" ? "אין קבוצות תמונות מוסתרות"
              : "כל קבוצות התמונות זוהו"}
          </p>
        </div>
      ) : (
        <>
          <div className="space-y-2.5">
            {shown.slice(0, visible).map(c => (
              <ClusterRow
                key={c.cluster_key}
                cluster={c}
                players={players}
                playerName={playerName}
                busy={busyKey === c.cluster_key}
                value={choice[c.cluster_key] || ""}
                onChange={pid => setChoice(ch => ({ ...ch, [c.cluster_key]: pid }))}
                confirming={confirmKey === c.cluster_key}
                onAskConfirm={() => setConfirmKey(c.cluster_key)}
                onCancelConfirm={() => setConfirmKey(null)}
                onSave={() => save(c)}
                onReopen={() => reopen(c)}
                onHide={() => hide(c)}
              />
            ))}
          </div>
          {visible < shown.length && (
            <div className="flex justify-center pt-1">
              <button onClick={() => setVisible(v => v + PAGE)}
                className="px-5 py-2.5 rounded-xl bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-200 text-sm font-semibold hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors">
                הצג עוד ({shown.length - visible})
              </button>
            </div>
          )}
        </>
      )}
    </div>
  )
}

function ClusterRow({ cluster: c, players, playerName, busy, value, onChange, confirming, onAskConfirm, onCancelConfirm, onSave, onReopen, onHide }) {
  const dirty = value && value !== (c.player_id || "")
  const resolved = c.status === "resolved"
  const hidden = c.status === "hidden"
  const badge = resolved
    ? { text: c.player_name || "ללא שם", cls: "text-sm font-bold text-slate-900 dark:text-white truncate" }
    : hidden
      ? { text: "מוסתר", cls: "text-xs font-semibold px-2 py-0.5 rounded-full bg-slate-100 dark:bg-slate-700 text-slate-500 dark:text-slate-400" }
      : { text: "לא מזוהה", cls: "text-xs font-semibold px-2 py-0.5 rounded-full bg-brand/10 dark:bg-brand/20 text-brand dark:text-brand-light" }

  return (
    <div className="card p-4 flex flex-col sm:flex-row gap-4">
      {c.cover_url && (
        <img src={c.cover_url} alt="" loading="lazy"
          className={`w-full sm:w-40 h-40 sm:h-28 object-cover rounded-lg bg-slate-900 shrink-0 ${hidden ? "opacity-50" : ""}`} />
      )}
      <div className="flex-1 min-w-0 flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <span className={badge.cls}>{badge.text}</span>
          <span className="text-xs text-slate-500 dark:text-slate-400">{c.size} תמונות</span>
          {(Array.isArray(c.albums) && c.albums[0]) && (
            <span className="text-xs text-slate-500 dark:text-slate-400 truncate">· {c.albums[0].title}</span>
          )}
          <span className="text-[11px] text-slate-300 dark:text-slate-600">{c.cluster_key}</span>
        </div>

        {confirming ? (
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs text-slate-600 dark:text-slate-300">
              להחזיר את קבוצת התמונות לעמוד המדיה? ההצעות הקיימות יימחקו והשם יוסר מהתמונות.
            </span>
            <button onClick={onReopen} disabled={busy}
              className="flex items-center gap-1.5 text-xs font-semibold px-3 py-2 rounded-lg bg-brand text-white hover:bg-brand-hover transition-colors disabled:opacity-50">
              {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Undo2 className="w-3.5 h-3.5" />} כן, החזר למדיה
            </button>
            <button onClick={onCancelConfirm} disabled={busy}
              className="text-xs font-semibold px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-600 text-slate-500 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors disabled:opacity-50">
              ביטול
            </button>
          </div>
        ) : (
          <div className="flex flex-wrap items-center gap-2 mt-1">
            <select value={value} onChange={e => onChange(e.target.value)}
              className="filter-select text-sm max-w-[220px]">
              <option value="">בחר שחקן…</option>
              {players.map(p => (
                <option key={p.id} value={p.id}>{playerName(p)}</option>
              ))}
            </select>
            <button onClick={onSave} disabled={busy || !value || (resolved && !dirty)}
              className="flex items-center gap-1.5 text-xs font-semibold px-3 py-2 rounded-lg bg-emerald-500 text-white hover:bg-emerald-600 transition-colors disabled:opacity-50">
              {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
              {resolved ? "שמור שינוי" : "שייך שחקן"}
            </button>
            {/* resolved & hidden can be sent back to Media; unresolved can be hidden */}
            {resolved || hidden ? (
              <button onClick={onAskConfirm} disabled={busy}
                className="flex items-center gap-1.5 text-xs font-semibold px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-600 text-slate-500 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors disabled:opacity-50">
                <Undo2 className="w-3.5 h-3.5" /> {resolved ? "בטל זיהוי" : "החזר למדיה"}
              </button>
            ) : (
              <button onClick={onHide} disabled={busy}
                className="flex items-center gap-1.5 text-xs font-semibold px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-600 text-slate-500 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors disabled:opacity-50">
                <EyeOff className="w-3.5 h-3.5" /> הסתר
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
