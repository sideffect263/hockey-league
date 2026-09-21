import { useState, useEffect } from "react"
import { MapPin, Plus, Trash2, RefreshCw, Check, X, Pencil } from "lucide-react"
import { getAllVenues, createVenue, updateVenue, deleteVenue } from "@/lib/venues"
import { SortBar, sortItems } from "@/components/admin/SortBar"
import { SkeletonPanelRows } from "@/components/skeletons/PageSkeletons"

const VENUE_SORT_OPTIONS = [
  { key: "name", label: "שם", dir: "asc" },
  { key: "city", label: "עיר", dir: "asc" },
  { key: "active", label: "פעילים תחילה", dir: "desc" },
]
const VENUE_ACCESSORS = {
  name: v => v.name || "",
  city: v => v.city || "",
  active: v => (v.is_active ? 1 : 0),
}

/**
 * Venues admin tab (#4) — league-manager / admin. Add courts, rename, toggle active
 * (inactive ones drop out of the assignment/change-request dropdowns), delete.
 */
export default function VenuesAdmin() {
  const [venues, setVenues] = useState(null)
  const [name, setName] = useState("")
  const [city, setCity] = useState("")
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(null)
  const [editId, setEditId] = useState(null)
  const [editName, setEditName] = useState("")
  const [sort, setSort] = useState({ key: "name", dir: "asc" })

  const load = async () => { try { setVenues(await getAllVenues()) } catch { setVenues([]) } }
  useEffect(() => { load() }, [])

  const add = async () => {
    if (!name.trim()) return
    setBusy("add"); setError(null)
    try { await createVenue(name, city); setName(""); setCity(""); await load() }
    catch (e) { setError(e?.message === "venue-exists" ? "מגרש בשם הזה כבר קיים" : "ההוספה נכשלה") }
    finally { setBusy(null) }
  }
  const toggle = async (v) => { setBusy(v.id); try { await updateVenue(v.id, { is_active: !v.is_active }); await load() } catch { /* ignore */ } finally { setBusy(null) } }
  const saveRename = async (v) => {
    if (!editName.trim()) { setEditId(null); return }
    setBusy(v.id)
    try { await updateVenue(v.id, { name: editName.trim() }); setEditId(null); await load() }
    catch (e) { setError(e?.code === "23505" ? "מגרש בשם הזה כבר קיים" : "השמירה נכשלה") }
    finally { setBusy(null) }
  }
  const remove = async (v) => {
    if (!confirm(`למחוק את המגרש "${v.name}"?`)) return
    setBusy(v.id); try { await deleteVenue(v.id); await load() } catch { /* ignore */ } finally { setBusy(null) }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <h2 className="flex items-center gap-2 text-lg font-bold text-slate-900 dark:text-white"><MapPin className="w-5 h-5 text-brand" /> מגרשים</h2>
        <button onClick={load} className="flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-600 text-slate-500 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors"><RefreshCw className="w-3.5 h-3.5" /> רענון</button>
      </div>

      {/* Add */}
      <div className="card p-4 flex flex-col sm:flex-row gap-2 sm:items-end">
        <div className="flex-1">
          <label className="block text-[11px] font-semibold text-slate-500 dark:text-slate-400 mb-1">שם המגרש</label>
          <input value={name} onChange={e => setName(e.target.value)} placeholder="לדוגמה: אולם ספורט גבעת עדה"
            className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-600 rounded-lg px-3 py-2 text-sm text-slate-800 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-brand/30" />
        </div>
        <div className="sm:w-40">
          <label className="block text-[11px] font-semibold text-slate-500 dark:text-slate-400 mb-1">עיר (רשות)</label>
          <input value={city} onChange={e => setCity(e.target.value)} placeholder="עיר"
            className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-600 rounded-lg px-3 py-2 text-sm text-slate-800 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-brand/30" />
        </div>
        <button onClick={add} disabled={busy === "add" || !name.trim()}
          className="flex items-center justify-center gap-1.5 px-4 py-2 rounded-lg bg-brand text-white text-sm font-semibold hover:bg-brand-hover transition-colors disabled:opacity-50"><Plus className="w-4 h-4" /> הוספה</button>
      </div>
      {error && <p className="text-xs text-red-600 dark:text-red-400">{error}</p>}

      {/* List */}
      {venues === null ? (
        <SkeletonPanelRows />
      ) : venues.length === 0 ? (
        <p className="text-center text-sm text-slate-400 py-8">אין מגרשים עדיין</p>
      ) : (
        <>
        {venues.length > 1 && <SortBar options={VENUE_SORT_OPTIONS} sort={sort} onChange={setSort} className="mb-3" />}
        <div className="card divide-y divide-slate-100 dark:divide-slate-700/50">
          {sortItems(venues, sort, VENUE_ACCESSORS).map(v => (
            <div key={v.id} className="flex items-center justify-between gap-3 p-3">
              {editId === v.id ? (
                <input value={editName} onChange={e => setEditName(e.target.value)} autoFocus
                  onKeyDown={e => e.key === "Enter" && saveRename(v)}
                  className="flex-1 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-600 rounded-lg px-2 py-1 text-sm text-slate-800 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-brand/30" />
              ) : (
                <div className="min-w-0 flex items-center gap-2">
                  <span className={`text-sm font-semibold truncate ${v.is_active ? "text-slate-900 dark:text-white" : "text-slate-400 line-through"}`}>{v.name}</span>
                  {v.city && <span className="text-[11px] text-slate-400 shrink-0">· {v.city}</span>}
                  {!v.is_active && <span className="text-[10px] font-bold text-slate-400 shrink-0">לא פעיל</span>}
                </div>
              )}
              <div className="flex items-center gap-1.5 shrink-0">
                {editId === v.id ? (
                  <>
                    <button onClick={() => saveRename(v)} disabled={busy === v.id} className="p-1.5 rounded-lg text-emerald-600 hover:bg-emerald-50 dark:hover:bg-emerald-900/20"><Check className="w-4 h-4" /></button>
                    <button onClick={() => setEditId(null)} className="p-1.5 rounded-lg text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700"><X className="w-4 h-4" /></button>
                  </>
                ) : (
                  <>
                    <button onClick={() => { setEditId(v.id); setEditName(v.name); setError(null) }} className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700"><Pencil className="w-3.5 h-3.5" /></button>
                    <button onClick={() => toggle(v)} disabled={busy === v.id} className="text-[11px] font-semibold px-2 py-1 rounded-lg border border-slate-200 dark:border-slate-600 text-slate-500 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-700">{v.is_active ? "השבת" : "הפעל"}</button>
                    <button onClick={() => remove(v)} disabled={busy === v.id} className="p-1.5 rounded-lg text-slate-300 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20"><Trash2 className="w-3.5 h-3.5" /></button>
                  </>
                )}
              </div>
            </div>
          ))}
        </div>
        </>
      )}
    </div>
  )
}
