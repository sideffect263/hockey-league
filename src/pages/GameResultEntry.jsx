import { useState, useEffect, useMemo, useRef } from "react"
import { Ball } from '../components/icons/HockeyIcons'
import { useParams, Link } from "react-router-dom"
import { format } from "date-fns"
import { ArrowRight, Camera, ImagePlus, X, Loader2, Sparkles, AlertTriangle, CheckCircle2, PencilLine, Minus, Plus, RefreshCw, FileImage, ChevronDown } from "lucide-react"
import { getGameById, getTeams } from "@/lib/api"
import { useAuth } from "@/lib/AuthContext"
import { useSlugId, entityPath } from "@/lib/slugs"
import TeamLogo from "@/components/TeamLogo"
import { JudgeGameSkeleton } from "@/components/skeletons/PageSkeletons"
import {
  canEnterResults, isAwaitingResult, submitGameForm, getOpenSubmission, signFormPhotos,
  getGameRosters, applyGameFormResult, resultErrorText,
} from "@/lib/gameFormResult"
import { ilDate } from "@/lib/ilTime"

/**
 * /games/:id/result — enter a game's result from the handwritten referee form.
 *
 * For games played without the app's game clock. A referee / league manager / admin
 * photographs the form; a Claude cloud routine reads it (usually 2–4 minutes) and the
 * reading comes back here as a PREFILL. The same person checks it against the photo, fixes
 * what is wrong and approves — only then is anything written. The reading is a helper, never
 * a gate: "מילוי ידני" works at every step, with or without a photo.
 */

const POLL_MS = 6000
const SLOW_AFTER_MS = 10 * 60 * 1000

const fullName = (p) => `${(p.first_name || "").trim()} ${(p.last_name || "").trim()}`.replace(/\s+/g, " ").trim()

function Stepper({ value, onChange, max, tone = "slate", label }) {
  const tones = {
    slate: "text-fg-strong",
    emerald: "text-emerald-700 dark:text-emerald-300",
    blue: "text-blue-700 dark:text-blue-300",
    red: "text-red-700 dark:text-red-300",
  }
  return (
    <div className="inline-flex items-center gap-0.5" aria-label={label}>
      <button type="button" onClick={() => onChange(Math.max(0, value - 1))} disabled={value <= 0}
        className="w-7 h-7 rounded-lg flex items-center justify-center text-fg-muted hover:bg-surface-sunken disabled:opacity-30" aria-label={`הפחת ${label}`}>
        <Minus className="w-3.5 h-3.5" />
      </button>
      <span className={`w-6 text-center text-sm font-black tabular-nums ${value > 0 ? tones[tone] : "text-slate-300 dark:text-slate-600"}`}>{value}</span>
      <button type="button" onClick={() => onChange(Math.min(max, value + 1))} disabled={value >= max}
        className="w-7 h-7 rounded-lg flex items-center justify-center text-fg-muted hover:bg-surface-sunken disabled:opacity-30" aria-label={`הוסף ${label}`}>
        <Plus className="w-3.5 h-3.5" />
      </button>
    </div>
  )
}

// The icon labels a counter on phones, where the column header is hidden.
function StatCell({ icon, children }) {
  return (
    <div className="flex items-center justify-center gap-0.5">
      <span className="sm:hidden text-xs" aria-hidden="true">{icon}</span>
      {children}
    </div>
  )
}

function ScoreInput({ value, onChange, label }) {
  return (
    <input type="number" inputMode="numeric" min={0} max={50} aria-label={label}
      value={value ?? ""} onChange={e => onChange(e.target.value === "" ? null : Math.max(0, Math.min(50, parseInt(e.target.value, 10) || 0)))}
      className="w-16 h-14 text-center text-3xl stat-num rounded-xl border border-line-strong bg-surface focus:outline-none focus:ring-2 focus:ring-brand" />
  )
}

// ---------------------------------------------------------------- upload step
function UploadStep({ onSubmit, onManual, busy, error }) {
  const [files, setFiles] = useState([])
  const cameraRef = useRef(null)
  const galleryRef = useRef(null)
  const previews = useMemo(() => files.map(f => URL.createObjectURL(f)), [files])
  useEffect(() => () => previews.forEach(u => URL.revokeObjectURL(u)), [previews])

  const add = (list) => setFiles(prev => [...prev, ...Array.from(list || [])].slice(0, 4))

  return (
    <div className="card p-5 space-y-4">
      <div>
        <h2 className="section-head"><FileImage className="w-5 h-5 text-brand" /> צילום טופס השיפוט</h2>
        <p className="text-sm text-fg-muted mt-1">
          צלמו את הטופס כולו, מלמעלה ובתאורה טובה. המערכת תקרא אותו ותמלא את התוצאה, המבקיעים והכרטיסים — ואתם תבדקו ותאשרו.
        </p>
      </div>

      <input ref={cameraRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={e => { add(e.target.files); e.target.value = "" }} />
      <input ref={galleryRef} type="file" accept="image/*" multiple className="hidden" onChange={e => { add(e.target.files); e.target.value = "" }} />

      {files.length > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          {previews.map((u, i) => (
            <div key={u} className="relative aspect-[3/4] rounded-xl overflow-hidden border border-line bg-surface-sunken">
              <img src={u} alt={`תמונה ${i + 1}`} className="w-full h-full object-cover" />
              <button type="button" onClick={() => setFiles(f => f.filter((_, j) => j !== i))}
                className="absolute top-1.5 end-1.5 w-7 h-7 rounded-full bg-black/60 text-white flex items-center justify-center" aria-label="הסר תמונה">
                <X className="w-4 h-4" />
              </button>
            </div>
          ))}
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        <button type="button" onClick={() => cameraRef.current?.click()} className="btn-primary" disabled={busy || files.length >= 4}>
          <Camera className="w-4 h-4" /> {files.length ? "צילום נוסף" : "צילום הטופס"}
        </button>
        <button type="button" onClick={() => galleryRef.current?.click()} className="btn-secondary" disabled={busy || files.length >= 4}>
          <ImagePlus className="w-4 h-4" /> בחירה מהגלריה
        </button>
      </div>

      {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}

      <div className="flex flex-wrap items-center justify-between gap-3 pt-3 border-t border-line">
        <button type="button" onClick={onManual} className="btn-ghost btn-sm" disabled={busy}>
          <PencilLine className="w-3.5 h-3.5" /> מילוי ידני בלי תמונה
        </button>
        <button type="button" onClick={() => onSubmit(files)} className="btn-primary" disabled={busy || !files.length}>
          {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
          {busy ? "מעלה…" : "שליחה לקריאה"}
        </button>
      </div>
    </div>
  )
}

// --------------------------------------------------------------- waiting step
function WaitingStep({ submission, onManual, onRetry }) {
  const [now, setNow] = useState(Date.now())
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t) }, [])
  const elapsed = now - new Date(submission.created_at).getTime()
  const mins = Math.floor(elapsed / 60000), secs = Math.floor((elapsed % 60000) / 1000)
  const slow = elapsed > SLOW_AFTER_MS

  if (submission.status === "failed") {
    return (
      <div className="card p-5 space-y-3 border-amber-300 dark:border-amber-700">
        <h2 className="section-head"><AlertTriangle className="w-5 h-5 text-amber-500" /> לא הצלחנו לקרוא את הטופס</h2>
        {submission.extract_error && <p className="text-sm text-fg-muted">{submission.extract_error}</p>}
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={onRetry} className="btn-secondary"><Camera className="w-4 h-4" /> צילום מחדש</button>
          <button type="button" onClick={onManual} className="btn-primary"><PencilLine className="w-4 h-4" /> מילוי ידני</button>
        </div>
      </div>
    )
  }

  return (
    <div className="card p-6 text-center space-y-3">
      <Loader2 className="w-10 h-10 mx-auto text-brand animate-spin" />
      <h2 className="text-lg font-extrabold text-fg-strong">קוראים את הטופס…</h2>
      <p className="text-sm text-fg-muted">
        זה לוקח בדרך כלל 2–4 דקות. אפשר לסגור את הדף ולחזור אליו — הטופס נשמר והנתונים יחכו כאן.
      </p>
      <p className="text-xs text-fg-muted tabular-nums" dir="ltr">{mins}:{String(secs).padStart(2, "0")}</p>
      {slow && <p className="text-sm text-amber-600 dark:text-amber-400">הקריאה מתעכבת. אפשר להמשיך לחכות או למלא ידנית.</p>}
      <div className="flex flex-wrap justify-center gap-2 pt-1">
        <button type="button" onClick={onManual} className="btn-secondary btn-sm"><PencilLine className="w-3.5 h-3.5" /> מילוי ידני עכשיו</button>
        <button type="button" onClick={onRetry} className="btn-ghost btn-sm"><Camera className="w-3.5 h-3.5" /> החלפת תמונה</button>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------- review step
function initialState(extracted, rosters) {
  const rows = {}
  for (const p of [...rosters.home, ...rosters.away]) rows[p.id] = { goals: 0, blue: 0, red: 0, gk: false }
  const fromAi = {}      // playerId → {confidence, note, written}
  const unmatched = { home: [], away: [] }
  if (extracted) {
    for (const [side, list] of [["home", extracted.home_players], ["away", extracted.away_players]]) {
      for (const r of list || []) {
        if (r.player_id && rows[r.player_id]) {
          rows[r.player_id] = { goals: r.goals || 0, blue: r.blue_cards || 0, red: r.red_cards || 0, gk: !!r.goalkeeper }
          fromAi[r.player_id] = { confidence: r.confidence, note: r.note, written: r.written_name, number: r.number }
        } else if (r.written_name || r.number != null) {
          unmatched[side].push({ ...r, key: `${side}-${unmatched[side].length}`, resolved: false })
        }
      }
    }
  }
  return {
    rows, fromAi, unmatched,
    homeScore: extracted?.home_score ?? null,
    awayScore: extracted?.away_score ?? null,
    homeOwn: extracted?.home_own_goals || 0,
    awayOwn: extracted?.away_own_goals || 0,
  }
}

function TeamSection({ team, side, roster, state, setRow, own, setOwn, score, unmatched, onAssign, onDismiss, aiMode }) {
  const [showAll, setShowAll] = useState(!aiMode)
  const touched = (p) => {
    const r = state.rows[p.id]
    return state.fromAi[p.id] || r.goals || r.blue || r.red || r.gk
  }
  const visible = showAll ? roster : roster.filter(touched)
  const hidden = roster.length - visible.length
  const scorerGoals = roster.reduce((s, p) => s + (state.rows[p.id]?.goals || 0), 0)
  const total = scorerGoals + (own || 0)
  const over = score != null && total > score
  const under = score != null && total < score

  return (
    <div className="card overflow-hidden">
      <div className="flex items-center gap-2.5 px-4 py-3 border-b border-line bg-surface-sunken/60">
        <TeamLogo team={team} size={8} />
        <h3 className="font-extrabold text-fg-strong flex-1 min-w-0 truncate">{team?.name}</h3>
        <span className="text-[11px] font-bold text-fg-muted">{side === "home" ? "מארחת" : "אורחת"}</span>
      </div>

      {unmatched.filter(u => !u.resolved).map(u => (
        <div key={u.key} className="px-4 py-2.5 border-b border-line bg-amber-50 dark:bg-amber-950/30 space-y-1.5">
          <p className="text-xs font-bold text-amber-800 dark:text-amber-300 flex items-center gap-1.5">
            <AlertTriangle className="w-3.5 h-3.5" />
            לא זוהה בסגל: “{u.written_name || "—"}”{u.number != null && <span dir="ltr"> #{u.number}</span>}
            <span className="font-normal inline-flex items-center gap-1">· <Ball className="w-3 h-3" /> {u.goals || 0} · 🟦 {u.blue_cards || 0} · 🟥 {u.red_cards || 0}</span>
          </p>
          <div className="flex flex-wrap gap-2 items-center">
            <select defaultValue="" onChange={e => e.target.value && onAssign(u, e.target.value)}
              className="text-xs rounded-lg border border-line-strong bg-surface px-2 py-1.5 max-w-[14rem]">
              <option value="">שיוך לשחקן מהסגל…</option>
              {roster.map(p => <option key={p.id} value={p.id}>{p.jersey_number != null ? `#${p.jersey_number} ` : ""}{fullName(p)}</option>)}
            </select>
            <button type="button" onClick={() => onDismiss(u)} className="btn-ghost btn-sm !px-2">התעלם</button>
          </div>
        </div>
      ))}

      <div className="divide-y divide-line">
        <div className="hidden sm:grid grid-cols-[1fr_auto_auto_auto] gap-x-1 px-4 py-1.5 text-[10px] font-bold text-fg-muted">
          <span>שחקן</span><span className="w-[4.5rem] text-center">שערים</span><span className="w-[4.5rem] text-center">כחול</span><span className="w-[4.5rem] text-center">אדום</span>
        </div>
        {visible.map(p => {
          const r = state.rows[p.id]
          const ai = state.fromAi[p.id]
          const low = ai && ai.confidence !== "high"
          return (
            <div key={p.id} className={`px-4 py-1.5 ${low ? "bg-amber-50/70 dark:bg-amber-950/20" : ai ? "bg-sky-50/60 dark:bg-sky-950/20" : ""}`}>
              {/* Phones: name on its own line, the three counters under it. sm+: one row. */}
              <div className="grid grid-cols-3 sm:grid-cols-[1fr_auto_auto_auto] gap-x-1 gap-y-0.5 items-center">
                <div className="min-w-0 col-span-3 sm:col-span-1">
                  <p className="text-sm font-semibold text-fg-strong truncate">
                    {p.jersey_number != null && <span className="text-fg-muted font-bold tabular-nums me-1.5">{p.jersey_number}</span>}
                    {fullName(p)}
                  </p>
                  {p.position === "Goalkeeper" && (
                    <label className="inline-flex items-center gap-1 text-[11px] text-fg-muted cursor-pointer">
                      <input type="checkbox" checked={r.gk} onChange={e => setRow(p.id, { gk: e.target.checked })} className="accent-brand" />
                      שוער/ת במשחק
                    </label>
                  )}
                  {low && <p className="text-[11px] text-amber-700 dark:text-amber-400">לבדוק: {ai.note || `נכתב “${ai.written || ""}”`}</p>}
                </div>
                <StatCell icon={<Ball className="w-3.5 h-3.5" />}><Stepper label="שערים" tone="emerald" value={r.goals} max={30} onChange={v => setRow(p.id, { goals: v })} /></StatCell>
                <StatCell icon="🟦"><Stepper label="כרטיסים כחולים" tone="blue" value={r.blue} max={3} onChange={v => setRow(p.id, { blue: v })} /></StatCell>
                <StatCell icon="🟥"><Stepper label="כרטיס אדום" tone="red" value={r.red} max={1} onChange={v => setRow(p.id, { red: v })} /></StatCell>
              </div>
            </div>
          )
        })}
        {hidden > 0 && (
          <button type="button" onClick={() => setShowAll(true)} className="w-full px-4 py-2.5 text-xs font-bold text-brand hover:bg-surface-sunken flex items-center justify-center gap-1">
            <ChevronDown className="w-3.5 h-3.5" /> עוד {hidden} שחקנים בסגל
          </button>
        )}
      </div>

      <div className="px-4 py-3 border-t border-line flex flex-wrap items-center justify-between gap-2 text-xs">
        <label className="inline-flex items-center gap-2 text-fg-muted">
          שערים עצמיים לזכותה
          <Stepper label="שערים עצמיים" value={own || 0} max={20} onChange={setOwn} />
        </label>
        <span className={`font-bold tabular-nums ${over ? "text-red-600 dark:text-red-400" : under ? "text-amber-600 dark:text-amber-400" : "text-emerald-600 dark:text-emerald-400"}`}>
          {scorerGoals} מבקיעים{own ? ` + ${own} עצמיים` : ""} {score != null && <>/ תוצאה {score}</>}
          {over && " — יותר מהתוצאה"}
          {under && " — חסרים מבקיעים"}
        </span>
      </div>
    </div>
  )
}

function ReviewStep({ game, home, away, rosters, extracted, submissionId, photos, onDone, onRetry }) {
  const [state, setState] = useState(() => initialState(extracted, rosters))
  const [suspendRed, setSuspendRed] = useState(true)
  const [checked, setChecked] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)
  const [photoIdx, setPhotoIdx] = useState(0)

  const setRow = (id, patch) => setState(s => ({ ...s, rows: { ...s.rows, [id]: { ...s.rows[id], ...patch } } }))
  const assign = (side) => (u, playerId) => setState(s => ({
    ...s,
    rows: { ...s.rows, [playerId]: { goals: u.goals || 0, blue: u.blue_cards || 0, red: u.red_cards || 0, gk: !!u.goalkeeper } },
    fromAi: { ...s.fromAi, [playerId]: { confidence: "high", written: u.written_name } },
    unmatched: { ...s.unmatched, [side]: s.unmatched[side].map(x => x.key === u.key ? { ...x, resolved: true } : x) },
  }))
  const dismiss = (side) => (u) => setState(s => ({
    ...s, unmatched: { ...s.unmatched, [side]: s.unmatched[side].map(x => x.key === u.key ? { ...x, resolved: true } : x) },
  }))

  const sideGoals = (list) => list.reduce((n, p) => n + (state.rows[p.id]?.goals || 0), 0)
  const homeTotal = sideGoals(rosters.home) + (state.homeOwn || 0)
  const awayTotal = sideGoals(rosters.away) + (state.awayOwn || 0)
  const scoresSet = state.homeScore != null && state.awayScore != null
  const over = scoresSet && (homeTotal > state.homeScore || awayTotal > state.awayScore)
  const under = scoresSet && (homeTotal < state.homeScore || awayTotal < state.awayScore)
  const openUnmatched = [...state.unmatched.home, ...state.unmatched.away].filter(u => !u.resolved).length
  const reds = Object.values(state.rows).filter(r => r.red > 0).length

  const save = async () => {
    setError(null)
    if (!scoresSet) return setError("יש להזין את התוצאה הסופית")
    if (over) return setError("מספר השערים של השחקנים גדול מהתוצאה — תקנו לפני האישור")
    if (under && !window.confirm("חסרים מבקיעים (הסכום קטן מהתוצאה). לשמור בכל זאת?")) return
    const stats = Object.entries(state.rows)
      .filter(([, r]) => r.goals || r.blue || r.red || r.gk)
      .map(([player_id, r]) => ({ player_id, goals: r.goals, blue_cards: r.blue, red_cards: r.red, played_gk: r.gk }))
    setSaving(true)
    try {
      await applyGameFormResult({
        gameId: game.id, homeScore: state.homeScore, awayScore: state.awayScore,
        homeOwnGoals: state.homeOwn, awayOwnGoals: state.awayOwn, stats,
        submissionId, suspendRed,
      })
      onDone()
    } catch (e) {
      setError(resultErrorText(e))
    } finally { setSaving(false) }
  }

  return (
    <div className="grid lg:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)] gap-5 items-start">
      {/* The photo stays in view while checking the numbers (side by side on wide screens). */}
      {photos.length > 0 && (
        <div className="card p-2 lg:sticky lg:top-20 space-y-2">
          <a href={photos[photoIdx]} target="_blank" rel="noreferrer" className="block rounded-xl overflow-hidden bg-surface-sunken">
            <img src={photos[photoIdx]} alt="טופס השיפוט" className="w-full max-h-[45vh] lg:max-h-[75vh] object-contain" />
          </a>
          <div className="flex items-center justify-between gap-2 px-1">
            <span className="text-[11px] text-fg-muted">הקישו על התמונה להגדלה</span>
            <div className="flex gap-1">
              {photos.map((_, i) => (
                <button key={i} type="button" onClick={() => setPhotoIdx(i)}
                  className={`w-7 h-7 rounded-lg text-xs font-bold ${i === photoIdx ? "bg-brand text-brand-fg" : "bg-surface-sunken text-fg-muted"}`}>{i + 1}</button>
              ))}
              <button type="button" onClick={onRetry} className="btn-ghost btn-sm !px-2"><Camera className="w-3.5 h-3.5" /></button>
            </div>
          </div>
        </div>
      )}

      <div className="space-y-4">
        {extracted ? (
          <div className="card p-4 bg-sky-50 dark:bg-sky-950/30 border-sky-200 dark:border-sky-800 space-y-2">
            <p className="text-sm font-bold text-sky-800 dark:text-sky-300 flex items-center gap-1.5">
              <Sparkles className="w-4 h-4" /> הנתונים מולאו מהטופס — בדקו כל שורה מול התמונה
            </p>
            {extracted.teams_match === false && (
              <p className="text-sm font-bold text-red-600 dark:text-red-400">שימו לב: שמות הקבוצות בטופס לא תואמים למשחק הזה.</p>
            )}
            {(extracted.warnings || []).length > 0 && (
              <ul className="text-xs text-amber-800 dark:text-amber-300 space-y-1 list-disc ps-4">
                {extracted.warnings.map((w, i) => <li key={i}>{w}</li>)}
              </ul>
            )}
            {extracted.halftime_home != null && extracted.halftime_away != null && (
              <p className="text-xs text-fg-muted">מחצית: <span dir="ltr" className="font-bold tabular-nums">{extracted.halftime_away}:{extracted.halftime_home}</span></p>
            )}
            {extracted.notes && <p className="text-xs text-fg-muted">הערות שופט: {extracted.notes}</p>}
          </div>
        ) : (
          <div className="card p-3 text-sm text-fg-muted flex items-center gap-2">
            <PencilLine className="w-4 h-4 text-brand" /> מילוי ידני — סמנו מבקיעים וכרטיסים לפי הטופס.
          </div>
        )}

        {/* Final score. RTL grid: home (first) sits on the right, like every score in the app. */}
        <div className="card p-4">
          <p className="text-xs font-bold text-fg-muted mb-3 text-center">תוצאת סיום</p>
          <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-3">
            <div className="flex flex-col items-center gap-1.5 min-w-0">
              <ScoreInput label={`שערי ${home?.name}`} value={state.homeScore} onChange={v => setState(s => ({ ...s, homeScore: v }))} />
              <span className="text-xs font-bold text-fg-strong truncate max-w-full">{home?.name}</span>
            </div>
            <span className="text-2xl font-black text-fg-muted">:</span>
            <div className="flex flex-col items-center gap-1.5 min-w-0">
              <ScoreInput label={`שערי ${away?.name}`} value={state.awayScore} onChange={v => setState(s => ({ ...s, awayScore: v }))} />
              <span className="text-xs font-bold text-fg-strong truncate max-w-full">{away?.name}</span>
            </div>
          </div>
        </div>

        <TeamSection team={home} side="home" roster={rosters.home} state={state} setRow={setRow} aiMode={!!extracted}
          own={state.homeOwn} setOwn={v => setState(s => ({ ...s, homeOwn: v }))} score={state.homeScore}
          unmatched={state.unmatched.home} onAssign={assign("home")} onDismiss={dismiss("home")} />
        <TeamSection team={away} side="away" roster={rosters.away} state={state} setRow={setRow} aiMode={!!extracted}
          own={state.awayOwn} setOwn={v => setState(s => ({ ...s, awayOwn: v }))} score={state.awayScore}
          unmatched={state.unmatched.away} onAssign={assign("away")} onDismiss={dismiss("away")} />

        <div className="card p-4 space-y-3">
          {reds > 0 && (
            <label className="flex items-start gap-2 text-sm cursor-pointer">
              <input type="checkbox" checked={suspendRed} onChange={e => setSuspendRed(e.target.checked)} className="mt-1 accent-brand" />
              <span>כרטיס אדום = השעיה למשחק הבא ({reds} {reds === 1 ? "שחקן" : "שחקנים"})</span>
            </label>
          )}
          {openUnmatched > 0 && (
            <p className="text-xs text-amber-700 dark:text-amber-400">{openUnmatched} שורות מהטופס עוד לא שויכו לשחקן — שייכו או התעלמו.</p>
          )}
          <label className="flex items-start gap-2 text-sm font-semibold cursor-pointer">
            <input type="checkbox" checked={checked} onChange={e => setChecked(e.target.checked)} className="mt-1 accent-brand" />
            <span>בדקתי את הנתונים מול טופס השיפוט והם נכונים</span>
          </label>
          <p className="text-[11px] text-fg-muted">האישור מעדכן את התוצאה, טבלת הליגה, סטטיסטיקות השחקנים, הוקי מרקט וההשעיות.</p>
          {error && <p className="text-sm font-semibold text-red-600 dark:text-red-400">{error}</p>}
          <button type="button" onClick={save} disabled={!checked || saving || openUnmatched > 0 || !scoresSet} className="btn-primary w-full">
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
            אישור ועדכון התוצאה
          </button>
        </div>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------- page
export default function GameResultEntry() {
  const { id: routeKey } = useParams()
  const { id } = useSlugId("games", routeKey)
  const auth = useAuth()
  const allowed = canEnterResults(auth)

  const [game, setGame] = useState(null)
  const [teams, setTeams] = useState([])
  const [rosters, setRosters] = useState(null)
  const [submission, setSubmission] = useState(null)
  const [photos, setPhotos] = useState([])
  const [mode, setMode] = useState(null)       // null (auto) | 'upload' | 'manual'
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState(null)
  const [busy, setBusy] = useState(false)
  const [uploadError, setUploadError] = useState(null)
  const [done, setDone] = useState(false)

  useEffect(() => {
    if (!id || auth.loading || !allowed) { if (!auth.loading) setLoading(false); return }
    let cancelled = false
    ;(async () => {
      try {
        const [g, t, sub] = await Promise.all([getGameById(id), getTeams(), getOpenSubmission(id)])
        const r = await getGameRosters(g)
        if (cancelled) return
        setGame(g); setTeams(t); setRosters(r); setSubmission(sub)
      } catch (e) {
        console.error(e)
        if (!cancelled) setLoadError("שגיאה בטעינת המשחק")
      } finally { if (!cancelled) setLoading(false) }
    })()
    return () => { cancelled = true }
  }, [id, auth.loading, allowed])

  // Poll while the routine is reading.
  const reading = submission && ["uploaded", "analyzing"].includes(submission.status)
  useEffect(() => {
    if (!reading || mode === "manual") return
    const t = setInterval(async () => {
      try { const s = await getOpenSubmission(id); if (s) setSubmission(s) } catch { /* next tick */ }
    }, POLL_MS)
    return () => clearInterval(t)
  }, [reading, mode, id])

  const pathsKey = (submission?.photo_paths || []).join("|")
  useEffect(() => {
    if (!pathsKey) { setPhotos([]); return }
    signFormPhotos(pathsKey.split("|")).then(setPhotos).catch(() => setPhotos([]))
  }, [pathsKey])

  const upload = async (files) => {
    setBusy(true); setUploadError(null)
    try {
      const { id: subId } = await submitGameForm(id, files)
      setSubmission(await getOpenSubmission(id) || { id: subId, status: "uploaded", created_at: new Date().toISOString(), photo_paths: [] })
      setMode(null)
    } catch (e) {
      console.error(e)
      setUploadError(e?.message?.includes("not authorized") ? "אין לך הרשאה להעלות טופס" : "ההעלאה נכשלה. נסו שוב.")
    } finally { setBusy(false) }
  }

  if (loading || auth.loading) return <JudgeGameSkeleton />

  const back = (
    <Link to={game ? entityPath("games", game) || `/games/${id}` : "/games"} className="inline-flex items-center gap-1.5 text-sm font-semibold text-fg-muted hover:text-fg-strong">
      <ArrowRight className="w-4 h-4" /> חזרה למשחק
    </Link>
  )

  const shell = (children) => <div className="p-4 sm:p-6 lg:p-8 max-w-5xl mx-auto space-y-5">{back}{children}</div>

  if (!allowed) return shell(<div className="card p-6 text-center text-sm text-fg-muted">הזנת תוצאה מטופס שיפוט פתוחה לשופטים ולמנהלי הליגה בלבד.</div>)
  if (loadError || !game) return shell(<div className="card p-6 text-center text-sm text-red-600">{loadError || "המשחק לא נמצא"}</div>)

  const home = teams.find(t => t.id === game.home_team_id)
  const away = teams.find(t => t.id === game.away_team_id)

  const header = (
    <div className="space-y-1">
      <h1 className="page-title !text-2xl sm:!text-3xl">הזנת תוצאה מטופס שיפוט</h1>
      <p className="text-sm text-fg-muted">
        {home?.name} נגד {away?.name} · <span dir="ltr">{format(ilDate(game.game_date), "dd.MM.yyyy HH:mm")}</span>{game.venue ? ` · ${game.venue}` : ""}
      </p>
    </div>
  )

  if (done) {
    return shell(<>
      {header}
      <div className="card p-6 text-center space-y-3">
        <CheckCircle2 className="w-12 h-12 mx-auto text-emerald-500" />
        <h2 className="text-lg font-extrabold text-fg-strong">התוצאה נשמרה</h2>
        <p className="text-sm text-fg-muted">טבלת הליגה, הסטטיסטיקות, הוקי מרקט וההשעיות עודכנו.</p>
        <Link to={entityPath("games", game) || `/games/${id}`} className="btn-primary">לעמוד המשחק</Link>
      </div>
    </>)
  }

  if (game.status === "completed") {
    return shell(<>{header}<div className="card p-6 text-center text-sm text-fg-muted">התוצאה של המשחק הזה כבר הוזנה. לתיקון — עריכת המשחק בלוח הניהול.</div></>)
  }
  if (!isAwaitingResult(game)) {
    return shell(<>{header}<div className="card p-6 text-center text-sm text-fg-muted">
      {game.status === "cancelled" ? "המשחק בוטל." : game.status === "postponed" ? "המשחק נדחה." : "המשחק עוד לא התקיים — אפשר להזין תוצאה מתחילת המשחק."}
    </div></>)
  }

  const retry = () => { setMode("upload"); setUploadError(null) }
  const manual = () => setMode("manual")
  // Manual mode keeps the photo (if any) on screen and still links the approval to it,
  // but starts from a blank sheet instead of the reading.
  const extracted = mode !== "manual" && submission?.status === "analyzed" ? submission.extracted : null
  const review = <ReviewStep game={game} home={home} away={away} rosters={rosters} photos={photos}
    extracted={extracted} submissionId={submission?.id} onDone={() => setDone(true)} onRetry={retry} />

  let body
  if (mode === "upload" || (!submission && mode !== "manual")) {
    body = <UploadStep onSubmit={upload} onManual={manual} busy={busy} error={uploadError} />
  } else if (mode === "manual" || submission.status === "analyzed") {
    body = <div key={mode === "manual" ? "manual" : submission.id}>{review}</div>
  } else {
    body = (
      <div className="space-y-3">
        <WaitingStep submission={submission} onManual={manual} onRetry={retry} />
        <button type="button" onClick={async () => setSubmission(await getOpenSubmission(id))} className="btn-ghost btn-sm mx-auto flex">
          <RefreshCw className="w-3.5 h-3.5" /> רענון
        </button>
      </div>
    )
  }

  return shell(<>{header}{body}</>)
}
