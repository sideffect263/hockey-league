import { useState, useEffect } from "react"
import { Plus, Trash2, RefreshCw, Check, X, ExternalLink } from "lucide-react"
import { EditIcon as Pencil, MapPin } from "@/components/icons/BrandIcons"
import { getAllVenues, createVenue, updateVenue, deleteVenue } from "@/lib/venues"
import { parseMapPin, hasPin, googleMapsPinUrl, osmEmbedUrl } from "@/lib/mapPin"
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
 * Each venue also has an address + map pin (lat/lng), set by pasting a Google Maps /
 * Waze link or "lat, lng" — used for distances in /api/mcp and for navigation links.
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
  const [locId, setLocId] = useState(null)

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
            <div key={v.id}>
            <div className="flex items-center justify-between gap-3 p-3">
              {editId === v.id ? (
                <input value={editName} onChange={e => setEditName(e.target.value)} autoFocus
                  onKeyDown={e => e.key === "Enter" && saveRename(v)}
                  className="flex-1 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-600 rounded-lg px-2 py-1 text-sm text-slate-800 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-brand/30" />
              ) : (
                <div className="min-w-0 flex items-center gap-2">
                  <span className={`text-sm font-semibold truncate ${v.is_active ? "text-slate-900 dark:text-white" : "text-slate-400 line-through"}`}>{v.name}</span>
                  {v.city && <span className="hidden sm:inline text-[11px] text-slate-400 shrink-0">· {v.city}</span>}
                  {!v.is_active && <span className="text-[10px] font-bold text-slate-400 shrink-0">לא פעיל</span>}
                  {hasPin(v)
                    ? <span className="text-[10px] font-bold text-emerald-600 dark:text-emerald-400 shrink-0">מיקום שמור</span>
                    : <span className="text-[10px] font-bold text-amber-600 dark:text-amber-400 shrink-0">אין מיקום</span>}
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
                    <button onClick={() => { setEditId(v.id); setEditName(v.name); setError(null) }} className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700"><Pencil className="w-4 h-4" /></button>
                    <button onClick={() => setLocId(locId === v.id ? null : v.id)} aria-expanded={locId === v.id} aria-label="מיקום" title="כתובת ומיקום במפה"
                      className={`flex items-center gap-1 text-[11px] font-semibold px-2 py-1 rounded-lg border transition-colors ${locId === v.id ? "border-brand/40 bg-brand/10 text-brand" : "border-slate-200 dark:border-slate-600 text-slate-500 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-700"}`}><MapPin className="w-3.5 h-3.5" /><span className="hidden sm:inline">מיקום</span></button>
                    <button onClick={() => toggle(v)} disabled={busy === v.id} className="text-[11px] font-semibold px-2 py-1 rounded-lg border border-slate-200 dark:border-slate-600 text-slate-500 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-700">{v.is_active ? "השבת" : "הפעל"}</button>
                    <button onClick={() => remove(v)} disabled={busy === v.id} className="p-1.5 rounded-lg text-slate-300 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20"><Trash2 className="w-3.5 h-3.5" /></button>
                  </>
                )}
              </div>
            </div>
            {locId === v.id && <VenueLocationEditor venue={v} onSaved={load} onClose={() => setLocId(null)} />}
            </div>
          ))}
        </div>
        </>
      )}
    </div>
  )
}


const PIN_ERRORS = {
  "short-link": "קישור מקוצר (goo.gl / maps.app.goo.gl) אי אפשר לפענח מהדפדפן. פתחו אותו, העתיקו את הקישור המלא משורת הכתובת, או הדביקו קואורדינטות (לחיצה ימנית על הנקודה בגוגל מפות מעתיקה אותן).",
  "range": "הקואורדינטות מחוץ לטווח (קו רוחב ±90, קו אורך ±180).",
  "unparsed": "לא נמצאו קואורדינטות. הדביקו קישור גוגל מפות / וייז מלא, או \"32.8275, 35.0858\".",
}
const inputCls = "w-full bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-600 rounded-lg px-3 py-2 text-sm text-slate-800 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-brand/30"
const fmt = n => Number(n).toFixed(6)

/** Address + map pin for one venue. Saves address and lat/lng together. */
function VenueLocationEditor({ venue, onSaved, onClose }) {
  const [address, setAddress] = useState(venue.address || "")
  const [pinText, setPinText] = useState("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)

  const parsed = pinText.trim() ? parseMapPin(pinText) : null
  const parsedOk = parsed && !parsed.error
  // What the map shows: the freshly pasted pin, else the saved one.
  const shown = parsedOk ? parsed : hasPin(venue) ? venue : null
  const dirty = (address.trim() || null) !== (venue.address || null) || parsedOk

  const save = async (patch) => {
    setBusy(true); setError(null)
    try { await updateVenue(venue.id, patch); setPinText(""); await onSaved() }
    catch { setError("השמירה נכשלה") }
    finally { setBusy(false) }
  }
  const saveAll = () => {
    if (parsed?.error) return
    const patch = { address: address.trim() || null }
    if (parsedOk) { patch.lat = parsed.lat; patch.lng = parsed.lng }
    save(patch)
  }
  const clearPin = () => {
    if (!confirm(`לנקות את המיקום של "${venue.name}"?`)) return
    save({ lat: null, lng: null })
  }

  return (
    <div className="px-3 pb-4 pt-1 space-y-3 bg-slate-50/60 dark:bg-slate-800/40">
      <div>
        <label className="block text-[11px] font-semibold text-slate-500 dark:text-slate-400 mb-1">כתובת</label>
        <input value={address} onChange={e => setAddress(e.target.value)} placeholder="לדוגמה: רחוב הספורט 1, קריית ביאליק" className={inputCls} />
      </div>

      <div>
        <label className="block text-[11px] font-semibold text-slate-500 dark:text-slate-400 mb-1">נעיצה במפה</label>
        <input value={pinText} onChange={e => setPinText(e.target.value)} dir="ltr"
          placeholder="https://www.google.com/maps/…  |  32.8275, 35.0858" className={`${inputCls} text-left`} />
        {parsed?.error && <p className="mt-1 text-xs text-red-600 dark:text-red-400">{PIN_ERRORS[parsed.error] || PIN_ERRORS.unparsed}</p>}
        {parsedOk && (
          <p className="mt-1 text-xs text-emerald-700 dark:text-emerald-400">
            זוהה: <span dir="ltr" className="font-mono">{fmt(parsed.lat)}, {fmt(parsed.lng)}</span> · לחצו שמירה
          </p>
        )}
        {!pinText.trim() && (
          <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
            {hasPin(venue)
              ? <>שמור: <span dir="ltr" className="font-mono">{fmt(venue.lat)}, {fmt(venue.lng)}</span></>
              : "עוד לא נקבע מיקום. בגוגל מפות: לחיצה ימנית על המגרש מעתיקה את הקואורדינטות."}
          </p>
        )}
      </div>

      {shown && (
        <div className="space-y-1.5">
          <iframe title={`מפה: ${venue.name}`} src={osmEmbedUrl(shown)} loading="lazy"
            className="w-full h-48 rounded-lg border border-slate-200 dark:border-slate-600 bg-slate-100 dark:bg-slate-800" />
          <a href={googleMapsPinUrl(shown)} target="_blank" rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-xs font-semibold text-brand hover:underline">
            <ExternalLink className="w-3.5 h-3.5" /> בדיקה במפה{parsedOk ? " (לפני שמירה)" : ""}
          </a>
        </div>
      )}

      {error && <p className="text-xs text-red-600 dark:text-red-400">{error}</p>}
      <div className="flex items-center gap-2 flex-wrap">
        <button onClick={saveAll} disabled={busy || !dirty || !!parsed?.error}
          className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-brand text-white text-sm font-semibold hover:bg-brand-hover transition-colors disabled:opacity-50"><Check className="w-4 h-4" /> שמירה</button>
        {hasPin(venue) && (
          <button onClick={clearPin} disabled={busy}
            className="text-xs font-semibold px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-600 text-slate-500 dark:text-slate-400 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20 disabled:opacity-50">ניקוי מיקום</button>
        )}
        <button onClick={onClose} className="text-xs font-semibold px-3 py-2 rounded-lg text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700">סגירה</button>
      </div>
    </div>
  )
}
