import { useEffect, useMemo, useState } from "react"
import { Crosshair, Plus, Trash2, Loader2, X, Target } from "lucide-react"
import { saveLabShot, deleteLabShot, getAllLabShots } from "@/lib/videoLab"

// Shot tagging in the video lab (supabase/video-lab-shots.sql). Each shot: who, from where on the
// rink, where in the net, what happened, and how the keeper stood. Scouting data, not render input.

export const RESULTS = [
  { id: "goal",    label: "גול",    color: "#ef4444" },
  { id: "save",    label: "הצלה",   color: "#3b82f6" },
  { id: "post",    label: "קורה",   color: "#f59e0b" },
  { id: "miss",    label: "החטאה",  color: "#94a3b8" },
  { id: "blocked", label: "נחסם",   color: "#8b5cf6" },
]
const RESULT = Object.fromEntries(RESULTS.map(r => [r.id, r]))
const ON_TARGET = new Set(["goal", "save", "post"])

const SHOT_TYPES = [
  { id: "wrist", label: "בעיטת פרק" }, { id: "slap", label: "בעיטה חזקה" }, { id: "backhand", label: "גב המקל" },
  { id: "deke", label: "הטעיה / עקיפה" }, { id: "rebound", label: "ריבאונד" }, { id: "deflection", label: "הסטה" },
  { id: "free_hit", label: "בעיטה ישירה" }, { id: "penalty", label: "פנדל" },
]
const STANCES = [
  { id: "standing", label: "עומד" }, { id: "kneeling", label: "על הברכיים" }, { id: "split", label: "בפיסוק" },
  { id: "sitting", label: "יושב" }, { id: "sprawled", label: "שוכב" }, { id: "out", label: "מחוץ לשער" },
]

const playerName = (p) => `${p.jersey_number != null ? `#${p.jersey_number} ` : ""}${[p.first_name, p.last_name].filter(Boolean).join(" ")}`
const isKeeper = (p) => /goal/i.test(p.position || "")

export function shotLabel(s, sides) {
  const all = sides.flatMap(t => t.roster)
  const p = s.shooter_id && all.find(x => x.id === s.shooter_id)
  if (p) return playerName(p)
  if (s.shooter_number != null) return `#${s.shooter_number}`
  return sides.find(t => t.id === s.team_id)?.name || "שחקן לא ידוע"
}

// ---- the panel in the clip editor ------------------------------------------------------------
export function ShotsPanel({ clipId, frame, seek, sides, shots, setShots, draft, setDraft }) {
  const startNew = () => setDraft({ clip_id: clipId, frame, result: null, screened: false })
  const edit = (s) => { seek(s.frame); setDraft({ ...s }) }

  return (
    <div className="card p-3 space-y-3">
      <div className="flex items-center gap-2 flex-wrap">
        <Crosshair className="w-4 h-4 text-brand" />
        <span className="font-semibold text-slate-800 dark:text-slate-100">בעיטות בקליפ</span>
        <span className="text-xs text-slate-500">({shots.length})</span>
        {!draft && (
          <button onClick={startNew} className="ms-auto px-3 py-1.5 rounded-lg bg-brand text-white text-sm font-semibold hover:bg-brand-hover flex items-center gap-1.5">
            <Plus className="w-4 h-4" /> בעיטה בפריים הזה <kbd className="text-[10px] opacity-70">B</kbd>
          </button>
        )}
      </div>
      {!draft && shots.length === 0 && (
        <p className="text-sm text-slate-500">
          עמדו על הפריים שבו הבעיטה יוצאת ולחצו "בעיטה בפריים הזה". מתייגים כל בעיטה, גם הצלות והחטאות — רק כך נוכל לדעת איפה כל שוער חלש ואיך כל שחקן בועט.
        </p>
      )}
      {shots.length > 0 && (
        <div className="divide-y divide-slate-100 dark:divide-slate-800 rounded-xl border border-slate-100 dark:border-slate-800">
          {shots.map(s => (
            <button key={s.id} onClick={() => edit(s)}
              className={`w-full flex items-center gap-2 px-3 py-2 text-sm text-start hover:bg-slate-50 dark:hover:bg-slate-800/60 ${draft?.id === s.id ? "bg-brand/5" : ""}`}>
              <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: RESULT[s.result]?.color }} />
              <span className="font-semibold w-14 shrink-0">{RESULT[s.result]?.label}</span>
              <span className="flex-1 min-w-0 truncate text-slate-700 dark:text-slate-200">{shotLabel(s, sides)}</span>
              {s.shot_type && <span className="text-xs text-slate-500 hidden sm:inline">{SHOT_TYPES.find(t => t.id === s.shot_type)?.label}</span>}
              <span className="text-xs tabular-nums text-slate-400" dir="ltr">#{s.frame}</span>
            </button>
          ))}
        </div>
      )}
      {draft && (
        <ShotForm key={draft.id || "new"} draft={draft} setDraft={setDraft} frame={frame} sides={sides}
          onSaved={(row) => { setShots(list => [...list.filter(x => x.id !== row.id), row].sort((a, b) => a.frame - b.frame)); setDraft(null) }}
          onDeleted={(id) => { setShots(list => list.filter(x => x.id !== id)); setDraft(null) }} />
      )}
    </div>
  )
}

function Chips({ items, value, onChange, allowClear = true }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {items.map(it => {
        const on = value === it.id
        return (
          <button key={it.id} type="button" onClick={() => onChange(on && allowClear ? null : it.id)}
            className={`px-2.5 py-1 rounded-lg text-sm border ${on ? "border-brand bg-brand text-white font-semibold" : "border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800"}`}
            style={on && it.color ? { background: it.color, borderColor: it.color } : undefined}>
            {it.label}
          </button>
        )
      })}
    </div>
  )
}

function Field({ label, hint, children }) {
  return (
    <div className="space-y-1.5 min-w-0">
      <div className="text-xs font-semibold text-slate-600 dark:text-slate-300">{label}{hint && <span className="font-normal text-slate-400"> · {hint}</span>}</div>
      {children}
    </div>
  )
}

function ShotForm({ draft, setDraft, frame, sides, onSaved, onDeleted }) {
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(null)
  const [confirmDel, setConfirmDel] = useState(false)
  const set = (patch) => setDraft(d => ({ ...d, ...patch }))
  const team = sides.find(t => t.id === draft.team_id)
  const other = draft.team_id ? sides.find(t => t.id !== draft.team_id) : null
  const keepers = other ? [...other.roster].sort((a, b) => isKeeper(b) - isKeeper(a)) : []
  const onTarget = ON_TARGET.has(draft.result)

  const save = async () => {
    if (!draft.result) { setErr("בחרו מה קרה בבעיטה"); return }
    setBusy(true); setErr(null)
    try {
      const row = { ...draft }
      if (!ON_TARGET.has(row.result)) { row.net_x = null; row.net_y = null }
      onSaved(await saveLabShot(row))
    } catch (e) { setErr(e.message || "השמירה נכשלה") } finally { setBusy(false) }
  }
  const del = async () => {
    setBusy(true)
    try { await deleteLabShot(draft.id); onDeleted(draft.id) } catch (e) { setErr(e.message || "המחיקה נכשלה"); setBusy(false) }
  }

  return (
    <div className="rounded-xl ring-1 ring-brand/30 bg-brand/5 p-3 space-y-4">
      <div className="flex items-center gap-2 flex-wrap text-sm">
        <span className="font-semibold">{draft.id ? "עריכת בעיטה" : "בעיטה חדשה"} · פריים <span dir="ltr">#{draft.frame}</span></span>
        {draft.frame !== frame && <button className="text-xs underline text-slate-500" onClick={() => set({ frame })}>להעביר לפריים הנוכחי (#{frame})</button>}
        <button onClick={() => setDraft(null)} className="ms-auto p-1 rounded hover:bg-slate-200/60 dark:hover:bg-slate-700" aria-label="סגירה"><X className="w-4 h-4" /></button>
      </div>

      <Field label="מה קרה">
        <Chips items={RESULTS} value={draft.result} onChange={v => set({ result: v })} allowClear={false} />
      </Field>

      {sides.length > 0 && (
        <div className="grid sm:grid-cols-2 gap-4">
          <Field label="הקבוצה הבועטת">
            <div className="flex flex-wrap gap-1.5">
              {sides.map(t => (
                <button key={t.id} type="button" onClick={() => set({ team_id: t.id, shooter_id: null, goalie_id: null })}
                  className={`px-2.5 py-1 rounded-lg text-sm border flex items-center gap-1.5 ${draft.team_id === t.id ? "border-brand ring-1 ring-brand font-semibold bg-white dark:bg-slate-900" : "border-slate-200 dark:border-slate-700"}`}>
                  <span className="w-3 h-3 rounded-full" style={{ background: t.primary_color || "#94a3b8" }} />{t.name}
                </button>
              ))}
            </div>
          </Field>
          <Field label="הבועט">
            <div className="flex gap-2">
              <select id="shot-shooter" value={draft.shooter_id || ""} disabled={!team}
                onChange={e => set({ shooter_id: e.target.value || null, shooter_number: null })} className="filter-input flex-1 min-w-0">
                <option value="">{team ? "לא ידוע / לא ברשימה" : "קודם בחרו קבוצה"}</option>
                {team?.roster.map(p => <option key={p.id} value={p.id}>{playerName(p)}</option>)}
              </select>
              {!draft.shooter_id && (
                <input id="shot-number" type="number" min="0" max="999" inputMode="numeric" placeholder="מס׳" value={draft.shooter_number ?? ""}
                  onChange={e => set({ shooter_number: e.target.value === "" ? null : Math.max(0, Math.min(999, parseInt(e.target.value, 10) || 0)) })}
                  className="filter-input w-20" aria-label="מספר חולצה" />
              )}
            </div>
          </Field>
        </div>
      )}

      <div className="grid sm:grid-cols-2 gap-4">
        <Field label="מאיפה בעטו" hint="לחצו על המגרש">
          <RinkPicker x={draft.origin_x} y={draft.origin_y} onPick={(x, y) => set({ origin_x: x, origin_y: y })} />
        </Field>
        <Field label="לאן בשער" hint={onTarget ? "מנקודת המבט של הבועט" : "רק לבעיטה למסגרת"}>
          <NetPicker x={draft.net_x} y={draft.net_y} disabled={!onTarget} onPick={(x, y) => set({ net_x: x, net_y: y })} />
        </Field>
      </div>

      <Field label="סוג הבעיטה">
        <Chips items={SHOT_TYPES} value={draft.shot_type} onChange={v => set({ shot_type: v })} />
      </Field>

      <div className="grid sm:grid-cols-2 gap-4">
        <Field label="השוער ברגע הבעיטה">
          <Chips items={STANCES} value={draft.gk_stance} onChange={v => set({ gk_stance: v })} />
          <label className="flex items-center gap-2 text-sm text-slate-700 dark:text-slate-200 pt-1">
            <input id="shot-screened" type="checkbox" checked={!!draft.screened} onChange={e => set({ screened: e.target.checked })} />
            שחקן הסתיר לשוער את הבעיטה
          </label>
        </Field>
        {other && (
          <Field label="השוער">
            <select id="shot-goalie" value={draft.goalie_id || ""} onChange={e => set({ goalie_id: e.target.value || null })} className="filter-input w-full">
              <option value="">לא ידוע</option>
              {keepers.map(p => <option key={p.id} value={p.id}>{playerName(p)}{isKeeper(p) ? " (שוער)" : ""}</option>)}
            </select>
          </Field>
        )}
      </div>

      <input id="shot-note" value={draft.note || ""} maxLength={500} onChange={e => set({ note: e.target.value || null })}
        placeholder="הערה (לא חובה)" className="filter-input w-full text-sm" />

      {err && <p className="text-xs text-red-600">{err}</p>}
      <div className="flex items-center gap-2 flex-wrap">
        <button onClick={save} disabled={busy || !draft.result}
          className="px-4 py-1.5 rounded-lg bg-brand text-white text-sm font-semibold hover:bg-brand-hover disabled:opacity-50 flex items-center gap-1.5">
          {busy && <Loader2 className="w-4 h-4 animate-spin" />} שמירת הבעיטה
        </button>
        <button onClick={() => setDraft(null)} className="px-3 py-1.5 rounded-lg text-sm bg-slate-100 dark:bg-slate-800">ביטול</button>
        {draft.id && (confirmDel ? (
          <span className="ms-auto flex items-center gap-1 text-sm">למחוק את הבעיטה?
            <button onClick={del} disabled={busy} className="px-2 py-1 rounded bg-red-600 text-white">כן</button>
            <button onClick={() => setConfirmDel(false)} className="px-2 py-1 rounded bg-slate-100 dark:bg-slate-800">לא</button>
          </span>
        ) : (
          <button onClick={() => setConfirmDel(true)} className="ms-auto p-2 rounded-lg text-slate-400 hover:text-red-600" aria-label="מחיקת בעיטה"><Trash2 className="w-4 h-4" /></button>
        ))}
      </div>
    </div>
  )
}

// ---- pickers ---------------------------------------------------------------------------------
// Half rink from above, attacking UP: rink hockey is 40×20 m, the goal line ~4.4 m from the end
// boards → 15.6 m to the centre line. Penalty area 9 m × 5.4 m; penalty spot 5.4 m out.
const RW = 200, BEHIND = 30, RL = 156                     // 10 units per metre
function RinkPicker({ x, y, onPick, dots }) {
  const H = BEHIND + RL
  const click = (e) => {
    if (!onPick) return
    const r = e.currentTarget.getBoundingClientRect()
    const px = (e.clientX - r.left) / r.width * RW, py = (e.clientY - r.top) / r.height * H
    const nx = Math.min(1, Math.max(0, px / RW)), ny = Math.min(1, Math.max(0, (py - BEHIND) / RL))
    onPick(+nx.toFixed(4), +ny.toFixed(4))
  }
  const P = (nx, ny) => [nx * RW, BEHIND + ny * RL]
  return (
    <svg viewBox={`0 0 ${RW} ${H}`} onClick={click} dir="ltr" role="img" aria-label="חצי מגרש"
      className={`w-full max-w-[260px] rounded-lg bg-sky-50 dark:bg-slate-800 ${onPick ? "cursor-crosshair" : ""}`}>
      <rect x="1" y="1" width={RW - 2} height={H - 2} rx="18" fill="none" stroke="#94a3b8" strokeWidth="2" />
      <line x1="0" y1={BEHIND} x2={RW} y2={BEHIND} stroke="#cbd5e1" strokeWidth="1" />
      <line x1="0" y1={H - 1} x2={RW} y2={H - 1} stroke="#ef4444" strokeWidth="2" />
      <rect x={RW / 2 - 45} y={BEHIND} width="90" height="54" fill="none" stroke="#3b82f6" strokeWidth="1.5" />
      <circle cx={RW / 2} cy={BEHIND + 54} r="2" fill="#3b82f6" />
      <path d={`M ${RW / 2 - 30} ${H - 1} A 30 30 0 0 1 ${RW / 2 + 30} ${H - 1}`} fill="none" stroke="#cbd5e1" />
      <rect x={RW / 2 - 8.5} y={BEHIND - 9} width="17" height="9" fill="#fb923c" fillOpacity=".25" stroke="#ea580c" strokeWidth="2" />
      {dots?.map((d, i) => { const [cx, cy] = P(d.x, d.y); return <circle key={i} cx={cx} cy={cy} r="4" fill={d.color} fillOpacity=".8" stroke="#fff" strokeWidth="1" /> })}
      {x != null && y != null && (() => { const [cx, cy] = P(x, y); return (
        <g><line x1={cx} y1={cy} x2={RW / 2} y2={BEHIND} stroke="#0f172a" strokeOpacity=".35" strokeDasharray="3 3" />
          <circle cx={cx} cy={cy} r="5.5" fill="#facc15" stroke="#0f172a" strokeWidth="1.5" /></g>) })()}
    </svg>
  )
}

// The goal mouth from the shooter's side: 1.7 m wide × 1.05 m high.
const NW = 170, NH = 105
function NetPicker({ x, y, onPick, disabled, dots }) {
  const click = (e) => {
    if (!onPick || disabled) return
    const r = e.currentTarget.getBoundingClientRect()
    const nx = (e.clientX - r.left) / r.width, ny = 1 - (e.clientY - r.top) / r.height
    onPick(+Math.min(1, Math.max(0, nx)).toFixed(4), +Math.min(1, Math.max(0, ny)).toFixed(4))
  }
  return (
    <svg viewBox={`-6 -6 ${NW + 12} ${NH + 8}`} onClick={click} dir="ltr" role="img" aria-label="השער"
      className={`w-full max-w-[260px] rounded-lg bg-slate-50 dark:bg-slate-800 ${disabled ? "opacity-40" : onPick ? "cursor-crosshair" : ""}`}>
      <defs>
        <pattern id="netmesh" width="8" height="8" patternUnits="userSpaceOnUse">
          <path d="M0 8 L8 0" stroke="#94a3b8" strokeOpacity=".35" strokeWidth=".7" />
          <path d="M0 0 L8 8" stroke="#94a3b8" strokeOpacity=".35" strokeWidth=".7" />
        </pattern>
      </defs>
      <rect x="0" y="0" width={NW} height={NH} fill="url(#netmesh)" />
      {[1, 2].map(i => <line key={`v${i}`} x1={NW * i / 3} y1="0" x2={NW * i / 3} y2={NH} stroke="#94a3b8" strokeOpacity=".5" strokeDasharray="2 3" />)}
      <line x1="0" y1={NH / 2} x2={NW} y2={NH / 2} stroke="#94a3b8" strokeOpacity=".5" strokeDasharray="2 3" />
      <path d={`M 0 ${NH} L 0 0 L ${NW} 0 L ${NW} ${NH}`} fill="none" stroke="#ea580c" strokeWidth="5" />
      <line x1="-6" y1={NH} x2={NW + 6} y2={NH} stroke="#64748b" strokeWidth="1.5" />
      {dots?.map((d, i) => <circle key={i} cx={d.x * NW} cy={(1 - d.y) * NH} r="4.5" fill={d.color} fillOpacity=".8" stroke="#fff" strokeWidth="1" />)}
      {!disabled && x != null && y != null && <circle cx={x * NW} cy={(1 - y) * NH} r="6" fill="#facc15" stroke="#0f172a" strokeWidth="1.5" />}
    </svg>
  )
}

// ---- summary over every tagged shot (clip list page) ----------------------------------------
export function ShotsSummary() {
  const [shots, setShots] = useState(null)
  useEffect(() => { getAllLabShots().then(setShots).catch(() => setShots([])) }, [])
  const s = useMemo(() => {
    if (!shots) return null
    const count = Object.fromEntries(RESULTS.map(r => [r.id, shots.filter(x => x.result === r.id).length]))
    const goals = count.goal, saves = count.save
    return {
      total: shots.length, count,
      savePct: goals + saves ? Math.round(saves / (goals + saves) * 100) : null,
      net: shots.filter(x => x.net_x != null && ON_TARGET.has(x.result)).map(x => ({ x: x.net_x, y: x.net_y, color: RESULT[x.result].color })),
      rink: shots.filter(x => x.origin_x != null).map(x => ({ x: x.origin_x, y: x.origin_y, color: RESULT[x.result].color })),
    }
  }, [shots])
  if (!s || s.total === 0) return null
  return (
    <div className="card p-4 space-y-3">
      <div className="flex items-center gap-2">
        <Target className="w-5 h-5 text-brand" />
        <h3 className="font-bold text-slate-900 dark:text-white">מפת הבעיטות</h3>
        <span className="text-xs text-slate-500">כל הבעיטות שתויגו במעבדה</span>
      </div>
      <div className="flex flex-wrap gap-x-5 gap-y-1 text-sm">
        <span><b>{s.total}</b> בעיטות</span>
        {RESULTS.map(r => <span key={r.id} className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-full" style={{ background: r.color }} /><b>{s.count[r.id]}</b> {r.label}</span>)}
        {s.savePct != null && <span>אחוז הצלות: <b>{s.savePct}%</b></span>}
      </div>
      <div className="grid sm:grid-cols-2 gap-4">
        <div className="space-y-1"><div className="text-xs font-semibold text-slate-500">מאיפה בועטים</div><RinkPicker dots={s.rink} /></div>
        <div className="space-y-1"><div className="text-xs font-semibold text-slate-500">לאן בשער (מנקודת המבט של הבועט)</div><NetPicker dots={s.net} /></div>
      </div>
    </div>
  )
}
