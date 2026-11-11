import { useState, useEffect } from "react"
import { getReadyPlayerPhotos, reviewPlayerPhoto, signPlayerPhoto } from "@/lib/playerPhotos"
import { Check, X, RefreshCw, Images } from "lucide-react"
import { format } from "date-fns"

/**
 * Admin: photos players sent for their own player card (PlayerPhotoCard on /me). Shows the
 * original next to the background-free cutout; approving puts the cutout on /cards (it never
 * reaches the Friday poster). Rows still processing are listed too (a stuck worker shows up here).
 */
export default function PlayerPhotosReview({ teamsMap = {} }) {
  const [items, setItems] = useState(null)
  const [originals, setOriginals] = useState({})
  const [busyId, setBusyId] = useState(null)
  const [notes, setNotes] = useState({})
  const [error, setError] = useState(null)

  const load = async () => {
    try {
      setError(null)
      const rows = await getReadyPlayerPhotos()
      setItems(rows)
      const signed = {}
      await Promise.all(rows.map(async r => { try { signed[r.id] = await signPlayerPhoto(r.original_path) } catch { /* no preview */ } }))
      setOriginals(signed)
    } catch { setError("שגיאה בטעינת התמונות"); setItems([]) }
  }
  useEffect(() => { load() }, [])

  const act = async (item, approve) => {
    setBusyId(item.id); setError(null)
    try {
      await reviewPlayerPhoto(item.id, approve, approve ? null : (notes[item.id] || null))
      setItems(prev => (prev || []).filter(i => i.id !== item.id))
    } catch { setError("הפעולה נכשלה") }
    finally { setBusyId(null) }
  }

  if (!items || items.length === 0) return null
  const STATUS = { processing: "בעיבוד (מסיר רקע)", failed: "הסרת הרקע נכשלה", ready: "מוכן לאישור" }

  return (
    <div id="review-photos" className="space-y-4 mt-8 pt-6 border-t border-slate-100 dark:border-slate-700/50 scroll-mt-20">
      <div className="flex items-center justify-between">
        <h2 className="flex items-center gap-2 text-lg font-bold text-slate-900 dark:text-white">
          <Images className="w-5 h-5 text-brand" /> תמונות לכרטיס השחקן
        </h2>
        <button onClick={load} className="flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-600 text-slate-500 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors">
          <RefreshCw className="w-3.5 h-3.5" /> רענון
        </button>
      </div>
      <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed">
        שחקנים ששלחו תמונה משלהם. אחרי אישור החיתוך מופיע בכרטיס השחקן (/cards) במקום התמונה מהאלבום. לא נכנס לפוסטר של יום שישי.
      </p>
      {error && <div className="card p-3 text-sm text-red-700 dark:text-red-400">{error}</div>}
      <div className="space-y-2.5">
        {items.map(item => {
          const p = item.players
          const busy = busyId === item.id
          return (
            <div key={item.id} className="card p-4 flex flex-col gap-3">
              <div className="flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-sm font-bold text-slate-900 dark:text-white truncate">{p ? `${p.first_name} ${p.last_name}` : "שחקן"}</p>
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    {teamsMap[p?.team_id]?.name || ""} · <span dir="ltr">{format(new Date(item.created_at), "d/M HH:mm")}</span> · {STATUS[item.status] || item.status}
                  </p>
                </div>
              </div>
              <div className="flex gap-3 items-end">
                {originals[item.id] && (
                  <a href={originals[item.id]} target="_blank" rel="noopener noreferrer" className="block">
                    <img src={originals[item.id]} alt="מקור" className="h-44 w-auto rounded-lg object-contain bg-slate-100 dark:bg-slate-800" />
                  </a>
                )}
                {item.cutout_url && (
                  <div className="h-44 w-32 rounded-lg bg-gradient-to-b from-[#1b2a52] to-[#0d1530] flex items-end justify-center overflow-hidden">
                    <img src={item.cutout_url} alt="חיתוך" className="max-h-full max-w-full object-contain" />
                  </div>
                )}
              </div>
              {item.status === "failed" && item.note && <p className="text-xs text-red-600 dark:text-red-400">{item.note}</p>}
              {item.status === "ready" && (
                <div className="flex flex-wrap items-center gap-2">
                  <button disabled={busy} onClick={() => act(item, true)}
                    className="flex items-center gap-1.5 text-sm font-bold px-4 h-11 rounded-lg bg-emerald-600 text-white disabled:opacity-50">
                    <Check className="w-4 h-4" /> אישור לכרטיס
                  </button>
                  <input value={notes[item.id] || ""} onChange={e => setNotes(n => ({ ...n, [item.id]: e.target.value }))}
                    placeholder="סיבת דחייה (תוצג לשחקן)" className="flex-1 min-w-[160px] h-11 px-3 rounded-lg border border-slate-200 dark:border-slate-600 bg-transparent text-sm" />
                  <button disabled={busy} onClick={() => act(item, false)}
                    className="flex items-center gap-1.5 text-sm font-bold px-4 h-11 rounded-lg border border-red-300 text-red-600 disabled:opacity-50">
                    <X className="w-4 h-4" /> דחייה
                  </button>
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
