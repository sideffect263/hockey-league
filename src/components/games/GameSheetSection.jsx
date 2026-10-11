import { useEffect, useState } from "react"
import { Camera, ClipboardList, Pencil, X } from "lucide-react"
import { summarizeReport, setGameSheet, removeGameFormPhoto } from "@/lib/gameFormData"
import { uploadGameFormPhotos, signFormPhotos } from "@/lib/gameFormResult"

/**
 * The paper form's match facts on the game page: half-time score, team fouls and
 * timeouts per side, plus the photos of the signed טופס שיפוט.
 *
 * Numbers come from game_reports — the paper values a referee / LM / admin typed in
 * (supabase/game-form-sheet.sql) when there are any, otherwise what the judge board's
 * archive recorded. The photos sit in a private bucket readable by the same officials,
 * so only they see the thumbnails; everybody sees the numbers.
 */

const HALVES = [["first", "מחצית ראשונה"], ["second", "מחצית שנייה"]]
const MAX_TIMEOUTS = 2   // per side per half — the form prints two boxes

const str = (v) => (v == null ? "" : String(v))

function draftFrom(summary) {
  const t = summary?.timeouts
  return {
    homeFouls: str(summary?.fouls?.home), awayFouls: str(summary?.fouls?.away),
    halftimeHome: str(summary?.halftime?.home), halftimeAway: str(summary?.halftime?.away),
    // Counts per half; the minutes already on record are kept when the count is unchanged.
    to: {
      home: { first: t?.home?.first?.length ?? 0, second: t?.home?.second?.length ?? 0 },
      away: { first: t?.away?.first?.length ?? 0, second: t?.away?.second?.length ?? 0 },
    },
  }
}

export default function GameSheetSection({ game, home, away, reportRow, canEdit, canSeePhotos, onChanged }) {
  const raw = summarizeReport(reportRow)
  // A board's half-time score is only as good as its goal entry: trust it when the board's
  // goals add up to the final (same rule as the export dialog). Paper is taken as written.
  const halftimeOk = raw?.fromPaper?.halftime ||
    (raw?.hasGoals && raw.goals.home === game.home_score && raw.goals.away === game.away_score)
  const summary = raw && { ...raw, halftime: halftimeOk ? raw.halftime : null }
  const photos = reportRow?.form_photos || []
  const [urls, setUrls] = useState([])
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(() => draftFrom(summary))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)

  useEffect(() => {
    if (!canSeePhotos || !photos.length) { setUrls([]); return }
    signFormPhotos(photos).then(setUrls).catch(() => setUrls([]))
  }, [canSeePhotos, photos.join("|")])

  const hasFacts = !!(summary?.fouls || summary?.halftime || summary?.hasTimeouts)
  if (!hasFacts && !photos.length && !canEdit) return null

  const fromPaper = summary?.fromPaper
  const teamName = (side) => (side === "home" ? home?.name || "מארחת" : away?.name || "אורחת")

  const startEdit = () => { setDraft(draftFrom(summary)); setError(null); setEditing(true) }

  const save = async () => {
    setBusy(true); setError(null)
    try {
      const keep = (side, half) => {
        const n = Math.max(0, Math.min(MAX_TIMEOUTS, Number(draft.to[side][half]) || 0))
        const had = summary?.timeouts?.[side]?.[half] || []
        return had.length === n ? had : Array(n).fill(null)
      }
      const anyTimeouts = ["home", "away"].some(s => HALVES.some(([h]) => Number(draft.to[s][h]) > 0))
      await setGameSheet(game.id, {
        ...draft,
        timeouts: anyTimeouts || fromPaper?.timeouts
          ? { home: { first: keep("home", "first"), second: keep("home", "second") },
              away: { first: keep("away", "first"), second: keep("away", "second") } }
          : null,
      })
      setEditing(false)
      await onChanged?.()
    } catch (e) {
      console.error(e); setError("השמירה נכשלה")
    } finally { setBusy(false) }
  }

  const addPhotos = async (e) => {
    const files = [...(e.target.files || [])]
    e.target.value = ""
    if (!files.length) return
    setBusy(true); setError(null)
    try { await uploadGameFormPhotos(game.id, files); await onChanged?.() }
    catch (err) { console.error(err); setError("העלאת התמונה נכשלה") }
    finally { setBusy(false) }
  }

  const dropPhoto = async (path) => {
    setBusy(true); setError(null)
    try { await removeGameFormPhoto(game.id, path); await onChanged?.() }
    catch (err) { console.error(err); setError("הסרת התמונה נכשלה") }
    finally { setBusy(false) }
  }

  const sourceLabel = fromPaper && (fromPaper.fouls || fromPaper.halftime || fromPaper.timeouts)
    ? "מטופס השיפוט"
    : summary?.exact ? "משעון השופט" : summary ? "מעדכוני המשחק החי" : null

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <ClipboardList className="w-4 h-4 text-brand" />
        <span className="text-sm font-semibold text-slate-800 dark:text-slate-100">נתוני המשחק</span>
        {sourceLabel && <span className="text-[11px] text-slate-500 dark:text-slate-400">· {sourceLabel}</span>}
        {canEdit && !editing && (
          <button onClick={startEdit} className="ms-auto inline-flex items-center gap-1 text-[12px] font-semibold text-brand">
            <Pencil className="w-3.5 h-3.5" /> עריכה
          </button>
        )}
      </div>

      {!editing && hasFacts && (
        <div className="grid sm:grid-cols-2 gap-3">
          {["home", "away"].map(side => (
            <div key={side} className="rounded-xl border border-line p-3 space-y-1 text-sm">
              <div className="text-[11px] font-semibold text-slate-500 dark:text-slate-400">{teamName(side)}</div>
              {summary?.halftime && <Fact label="מחצית" value={summary.halftime[side]} />}
              {summary?.fouls && <Fact label="עבירות קבוצתיות" value={summary.fouls[side]} />}
              {summary?.hasTimeouts && (
                <Fact label="פסקי זמן" value={HALVES.map(([h, l]) => `${l.split(" ")[1]} ${summary.timeouts?.[side]?.[h]?.length ?? 0}`).join(" · ")} />
              )}
            </div>
          ))}
        </div>
      )}
      {!editing && !hasFacts && canEdit && (
        <p className="text-[12px] text-slate-500 dark:text-slate-400">לא נרשמו עבירות, פסקי זמן ותוצאת מחצית למשחק הזה. אפשר להזין אותם מטופס השיפוט.</p>
      )}

      {editing && (
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            {["home", "away"].map(side => {
              const cap = side === "home" ? "Home" : "Away"
              const set = (k) => (e) => setDraft(d => ({ ...d, [k]: e.target.value }))
              const setTo = (h) => (e) => setDraft(d => ({ ...d, to: { ...d.to, [side]: { ...d.to[side], [h]: e.target.value } } }))
              return (
                <div key={side} className="rounded-xl border border-line p-3 space-y-2">
                  <div className="text-[11px] font-semibold text-slate-500 dark:text-slate-400">{teamName(side)}</div>
                  <NumField label="תוצאת מחצית" value={draft[`halftime${cap}`]} onChange={set(`halftime${cap}`)} max={50} />
                  <NumField label="עבירות קבוצתיות" value={draft[`${side}Fouls`]} onChange={set(`${side}Fouls`)} max={99} />
                  {HALVES.map(([h, l]) => (
                    <NumField key={h} label={`פסקי זמן · ${l}`} value={draft.to[side][h]} onChange={setTo(h)} max={MAX_TIMEOUTS} />
                  ))}
                </div>
              )
            })}
          </div>
          <div className="flex gap-2">
            <button onClick={save} disabled={busy} className="btn-primary btn-sm">שמירה</button>
            <button onClick={() => setEditing(false)} disabled={busy} className="btn-secondary btn-sm">ביטול</button>
          </div>
        </div>
      )}

      {canSeePhotos && (photos.length > 0 || canEdit) && (
        <div className="space-y-2">
          <div className="text-[11px] font-semibold text-slate-500 dark:text-slate-400">צילום טופס השיפוט</div>
          <div className="flex flex-wrap gap-2">
            {photos.map((path, i) => (
              <div key={path} className="relative">
                <a href={urls[i]} target="_blank" rel="noreferrer" className="block w-20 h-28 rounded-lg overflow-hidden border border-line bg-surface-sunken">
                  {urls[i] && <img src={urls[i]} alt={`טופס שיפוט ${i + 1}`} className="w-full h-full object-cover" />}
                </a>
                {canEdit && (
                  <button onClick={() => dropPhoto(path)} disabled={busy} aria-label="הסר תמונה" title="הסר תמונה"
                    className="absolute -top-1.5 -start-1.5 p-0.5 rounded-full bg-white dark:bg-slate-800 border border-line text-slate-500 hover:text-red-500">
                    <X className="w-3 h-3" />
                  </button>
                )}
              </div>
            ))}
            {canEdit && (
              <label className={`w-20 h-28 rounded-lg border border-dashed border-line flex flex-col items-center justify-center gap-1 text-[11px] text-slate-500 cursor-pointer hover:text-brand ${busy ? "opacity-50 pointer-events-none" : ""}`}>
                <Camera className="w-5 h-5" /> הוספה
                <input type="file" accept="image/*" multiple className="hidden" onChange={addPhotos} />
              </label>
            )}
          </div>
        </div>
      )}

      {error && <div className="rounded-lg px-3 py-2 text-sm bg-red-50 text-red-700 dark:bg-red-950/30 dark:text-red-400">{error}</div>}
    </div>
  )
}

function Fact({ label, value }) {
  return (
    <div className="flex items-baseline justify-between gap-2">
      <span className="text-slate-500 dark:text-slate-400 text-[12px]">{label}</span>
      <span className="font-semibold text-slate-900 dark:text-white tabular-nums">{value ?? "—"}</span>
    </div>
  )
}

function NumField({ label, value, onChange, max }) {
  return (
    <label className="flex items-center justify-between gap-2 text-[12px] text-slate-600 dark:text-slate-300">
      <span>{label}</span>
      <input type="number" inputMode="numeric" min="0" max={max} value={value} onChange={onChange} className="filter-input w-16 text-center" />
    </label>
  )
}
