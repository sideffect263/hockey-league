import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { ArrowRight, Check, Loader2, Ruler, Trash2, Crosshair, RefreshCw, AlertTriangle } from "lucide-react"
import {
  labUrl, getRinkSets, getRinkSet, getRinkSetStatus, getRinkPoints, saveRinkPoint, deleteRinkPoint, requestRinkFit,
} from "@/lib/videoLab"
import { RINK_GROUPS, RINK_LANDMARKS, LANDMARK_BY_ID } from "@/lib/rinkLandmarks"

// Lab "נקודות מגרש": camera calibration per venue camera. Editors tap fixed rink landmarks (goal posts,
// goal-box corners, centre line, board bases) on a few sharp frames; video-analysis/rink_points.py fits
// the floor + the rink's size and reports how far each tap is from the fit (wrong taps stand out).

const BAD_M = 0.5            // a tap more than this far from the fitted rink is probably on the wrong spot
const LOUPE = 150, ZOOM = 4

const SET_STATUS = {
  tagging: { label: "בתיוג", cls: "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300" },
  queued:  { label: "בתור לחישוב", cls: "bg-sky-100 text-sky-800 dark:bg-sky-900/40 dark:text-sky-300" },
  fitting: { label: "מחשב…", cls: "bg-sky-100 text-sky-800 dark:bg-sky-900/40 dark:text-sky-300" },
  fitted:  { label: "מכויל", cls: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300" },
  error:   { label: "שגיאה", cls: "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300" },
}
function SetPill({ status }) {
  const s = SET_STATUS[status] || SET_STATUS.tagging
  return <span className={`text-[11px] font-bold px-2 py-0.5 rounded-full whitespace-nowrap ${s.cls}`}>{s.label}</span>
}

// List card on the lab's main page.
export function RinkSetsCard({ onOpen }) {
  const [sets, setSets] = useState(null)
  const [err, setErr] = useState(null)
  useEffect(() => { getRinkSets().then(setSets).catch(e => setErr(e.message)) }, [])
  if (err || !sets || sets.length === 0) return null
  return (
    <div className="card p-4 space-y-3">
      <div className="flex items-start gap-3">
        <Ruler className="w-5 h-5 text-brand shrink-0 mt-0.5" />
        <div className="min-w-0">
          <h3 className="font-bold text-slate-900 dark:text-white">נקודות מגרש — כיול מצלמה</h3>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-0.5">
            מסמנים על כמה תמונות חדות נקודות קבועות במגרש (עמודי השערים, פינות הרחבה, קו האמצע). מזה מחשבים את מידות המגרש
            ואיפה כל פיקסל נמצא על הרצפה במטרים — בשביל מפה מלמעלה, מהירויות ומעקב כדור טוב יותר.
          </p>
        </div>
      </div>
      <div className="grid sm:grid-cols-2 gap-2">
        {sets.map(s => (
          <button key={s.id} onClick={() => onOpen(s.id)} className="text-start rounded-xl border border-slate-200 dark:border-slate-700 p-3 hover:ring-2 hover:ring-brand/40">
            <div className="flex items-start gap-2">
              <span className="font-semibold text-sm text-slate-900 dark:text-white flex-1 min-w-0">{s.title}</span>
              <SetPill status={s.status} />
            </div>
            <span className="text-xs text-slate-500 block mt-1">
              {s.venue ? `${s.venue} · ` : ""}{s.video_lab_rink_frames?.[0]?.count ?? 0} תמונות
              {s.fit?.L ? ` · ${s.fit.L.toFixed(1)}×${s.fit.W.toFixed(1)} מ׳` : ""}
            </span>
          </button>
        ))}
      </div>
    </div>
  )
}

function RinkDiagram({ active, done }) {
  // 40×20 m nominal rink, x right / y far (far = top). 10 px per metre + margin.
  const X = (x) => 210 + x * 10, Y = (y) => 115 - y * 10
  return (
    <svg viewBox="0 0 420 230" className="w-full max-w-sm mx-auto" dir="ltr" aria-hidden="true">
      <rect x={X(-20)} y={Y(10)} width={400} height={200} rx={12} className="fill-slate-100 dark:fill-slate-800 stroke-slate-400" strokeWidth="2" />
      <line x1={X(0)} y1={Y(10)} x2={X(0)} y2={Y(-10)} className="stroke-sky-500" strokeWidth="2" />
      <circle cx={X(0)} cy={Y(0)} r={30} fill="none" className="stroke-sky-500" strokeWidth="2" />
      {[-1, 1].map(s => (
        <g key={s}>
          <rect x={s < 0 ? X(-17) : X(11.6)} y={Y(4.5)} width={54} height={90} fill="none" className="stroke-slate-500" strokeWidth="1.5" />
          <rect x={s < 0 ? X(-17) - 6 : X(17)} y={Y(0.85)} width={6} height={17} className="fill-orange-500" />
        </g>
      ))}
      {RINK_LANDMARKS.map(l => {
        const on = l.id === active, ok = done.has(l.id)
        const cx = X(l.d[0]) + (l.top ? (l.d[0] < 0 ? -9 : 9) : 0), cy = Y(l.d[1])
        return <circle key={l.id} cx={cx} cy={cy} r={on ? 7 : 4}
          className={on ? "fill-brand stroke-white" : ok ? "fill-emerald-500" : l.top ? "fill-none stroke-slate-400" : "fill-slate-400"}
          strokeWidth={on ? 2 : 1.5} />
      })}
    </svg>
  )
}

export function RinkPointsEditor({ id, onBack }) {
  const [set, setSet] = useState(null)
  const [points, setPoints] = useState(() => new Map())     // `${frame_id}|${landmark}` → {x,y}
  const [fi, setFi] = useState(0)
  const [active, setActive] = useState(RINK_LANDMARKS[0].id)
  const [err, setErr] = useState(null)
  const [saving, setSaving] = useState(0)
  const [loupe, setLoupe] = useState(null)                 // {px,py (box px), x,y (0..1), touch}
  const [busyFit, setBusyFit] = useState(false)
  const boxRef = useRef(null)

  const load = useCallback(async () => {
    try {
      const s = await getRinkSet(id); setSet(s)
      const ps = await getRinkPoints(s.frames.map(f => f.id))
      setPoints(new Map(ps.map(p => [`${p.frame_id}|${p.landmark}`, { x: p.x, y: p.y }])))
    } catch (e) { setErr(e.message || "שגיאה בטעינה") }
  }, [id])
  useEffect(() => { load() }, [load])

  // While a fit is queued/running, poll the set's status.
  useEffect(() => {
    if (!set || !["queued", "fitting"].includes(set.status)) return
    const t = setInterval(() => getRinkSetStatus(id).then(s => setSet(prev => ({ ...prev, ...s }))).catch(() => {}), 4000)
    return () => clearInterval(t)
  }, [id, set?.status])

  const frame = set?.frames[fi]
  const here = useMemo(() => {
    const m = new Map()
    if (!frame) return m
    for (const l of RINK_LANDMARKS) { const p = points.get(`${frame.id}|${l.id}`); if (p) m.set(l.id, p) }
    return m
  }, [points, frame])
  const doneAnywhere = useMemo(() => new Set([...points.keys()].map(k => k.split("|")[1])), [points])
  const perFrame = useMemo(() => {
    const c = {}
    for (const k of points.keys()) { const f = k.split("|")[0]; c[f] = (c[f] || 0) + 1 }
    return c
  }, [points])
  const fitErr = useMemo(() => {
    const m = new Map()
    for (const p of set?.fit?.points || []) m.set(`${p.frame_id}|${p.landmark}`, p.err_m)
    return m
  }, [set?.fit])

  const nextLandmark = (after) => {
    const i = RINK_LANDMARKS.findIndex(l => l.id === after)
    const rest = [...RINK_LANDMARKS.slice(i + 1), ...RINK_LANDMARKS.slice(0, i + 1)]
    const sameGroup = rest.find(l => l.group === LANDMARK_BY_ID[after].group && !here.has(l.id) && l.id !== after)
    return (sameGroup || rest.find(l => !here.has(l.id) && l.id !== after) || LANDMARK_BY_ID[after]).id
  }

  const place = async (x, y) => {
    if (!frame || !active) return
    const key = `${frame.id}|${active}`, lm = active
    setPoints(prev => new Map(prev).set(key, { x, y }))
    setActive(nextLandmark(lm))
    setSaving(n => n + 1)
    try { await saveRinkPoint(frame.id, lm, x, y); setErr(null) }
    catch (e) { setErr(`לא נשמר: ${e.message}`) }
    finally { setSaving(n => n - 1) }
  }
  const remove = async (lm) => {
    if (!frame) return
    setPoints(prev => { const m = new Map(prev); m.delete(`${frame.id}|${lm}`); return m })
    try { await deleteRinkPoint(frame.id, lm) } catch (e) { setErr(`לא נמחק: ${e.message}`) }
  }

  const rel = (e) => {
    const r = boxRef.current.getBoundingClientRect()
    const x = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)), y = Math.min(1, Math.max(0, (e.clientY - r.top) / r.height))
    return { x, y, px: x * r.width, py: y * r.height }
  }
  // Touch: aim with the loupe while the finger is down (the loupe sits above the finger), place on release.
  // Mouse: the loupe follows the cursor, a click places.
  const onDown = (e) => { if (e.pointerType !== "mouse") { e.currentTarget.setPointerCapture(e.pointerId); setLoupe({ ...rel(e), touch: true }) } }
  const onMove = (e) => { if (e.pointerType === "mouse" || loupe?.touch) setLoupe({ ...rel(e), touch: e.pointerType !== "mouse" }) }
  const onUp = (e) => { const p = rel(e); if (e.pointerType !== "mouse") setLoupe(null); place(p.x, p.y) }

  useEffect(() => {
    const onKey = (e) => {
      if (e.target.closest?.("input,textarea,select")) return
      if (e.key === "Delete" || e.key === "Backspace") { if (here.has(active)) { e.preventDefault(); remove(active) } }
      else if (e.key === "ArrowLeft") setFi(i => Math.min((set?.frames.length || 1) - 1, i + 1))
      else if (e.key === "ArrowRight") setFi(i => Math.max(0, i - 1))
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  })

  const fit = async () => {
    setBusyFit(true)
    try { await requestRinkFit(id); setSet(prev => ({ ...prev, status: "queued", worker_note: null })) }
    catch (e) { setErr(e.message) } finally { setBusyFit(false) }
  }

  if (err && !set) return <div className="card p-6 text-sm text-red-600">{err} <button onClick={onBack} className="underline ms-2">חזרה</button></div>
  if (!set) return <div className="card p-6 flex justify-center"><Loader2 className="w-5 h-5 animate-spin text-slate-400" /></div>

  const btn = "p-2 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-200 disabled:opacity-40"
  const total = points.size
  const url = frame ? labUrl(frame.image_path) : null
  const act = LANDMARK_BY_ID[active]
  const badHere = [...here.keys()].filter(lm => (fitErr.get(`${frame.id}|${lm}`) ?? 0) > BAD_M)

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 flex-wrap">
        <button onClick={onBack} className={btn} aria-label="חזרה לרשימה"><ArrowRight className="w-5 h-5" /></button>
        <h2 className="font-bold text-slate-900 dark:text-white flex-1 min-w-0 truncate">{set.title}</h2>
        <SetPill status={set.status} />
        {saving > 0 ? <Loader2 className="w-4 h-4 animate-spin text-slate-400" /> : <Check className="w-4 h-4 text-emerald-500" aria-label="נשמר" />}
      </div>
      {err && <div className="text-xs text-red-600">{err}</div>}

      <FitResult set={set} total={total} busy={busyFit} onFit={fit} />

      {/* frames are ordered by the camera pan, left → right */}
      <div dir="ltr" className="flex gap-2 overflow-x-auto pb-1">
        {set.frames.map((f, i) => (
          <button key={f.id} onClick={() => setFi(i)}
            className={`relative shrink-0 w-28 rounded-lg overflow-hidden ring-2 ${i === fi ? "ring-brand" : "ring-transparent"}`}>
            <img src={labUrl(f.image_path)} alt="" loading="lazy" className="w-full aspect-video object-cover" />
            <span className="absolute bottom-1 end-1 text-[10px] font-bold px-1.5 rounded bg-black/70 text-white tabular-nums">{perFrame[f.id] || 0}</span>
          </button>
        ))}
      </div>

      <div className="grid lg:grid-cols-[1fr_20rem] gap-3 items-start">
        <div className="space-y-2">
          <div className="text-sm rounded-lg bg-brand/10 text-slate-800 dark:text-slate-100 px-3 py-2 flex items-center gap-2">
            <Crosshair className="w-4 h-4 text-brand shrink-0" />
            <span className="min-w-0"><b>{RINK_GROUPS.find(g => g.id === act.group)?.label} · {act.label}</b>
              {" "}— לחצו עליה בתמונה. לא רואים אותה בתמונה הזו? בחרו נקודה אחרת מהרשימה.</span>
          </div>
          {frame && (
            <div ref={boxRef} className="relative w-full rounded-xl overflow-hidden bg-black select-none touch-none cursor-crosshair"
              style={{ aspectRatio: `${frame.width} / ${frame.height}` }}
              onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerLeave={(e) => { if (e.pointerType === "mouse") setLoupe(null) }}>
              <img src={url} alt="" draggable={false} className="absolute inset-0 w-full h-full pointer-events-none" />
              <svg className="absolute inset-0 w-full h-full pointer-events-none" viewBox="0 0 1000 1000" preserveAspectRatio="none">
                {[...here].map(([lm, p]) => {
                  const bad = (fitErr.get(`${frame.id}|${lm}`) ?? 0) > BAD_M
                  return <circle key={lm} cx={p.x * 1000} cy={p.y * 1000} r={lm === active ? 9 : 6} vectorEffect="non-scaling-stroke"
                    fill="none" stroke={bad ? "#ef4444" : lm === active ? "#facc15" : "#22c55e"} strokeWidth={2} />
                })}
              </svg>
              {[...here].filter(([lm]) => lm === active).map(([lm, p]) => (
                <span key={lm} className="absolute text-[10px] font-bold text-white bg-black/60 rounded px-1 pointer-events-none whitespace-nowrap"
                  style={{ left: `${p.x * 100}%`, top: `${p.y * 100}%`, transform: "translate(8px,-50%)" }}>{LANDMARK_BY_ID[lm]?.label}</span>
              ))}
              {loupe && <Loupe url={url} loupe={loupe} box={boxRef.current} />}
            </div>
          )}
          {badHere.length > 0 && (
            <div className="text-xs text-red-600 flex items-center gap-1.5"><AlertTriangle className="w-4 h-4" />
              {badHere.length} נקודות בתמונה הזו רחוקות מהחישוב (מסומנות באדום) — כנראה סומנו במקום הלא נכון.</div>
          )}
          <p className="text-xs text-slate-500">מחשב: עכבר — זכוכית מגדלת עוקבת אחרי הסמן, לחיצה מסמנת. טלפון: לוחצים ומזיזים — הנקודה נקבעת כשמרימים את האצבע. מחיקה: Delete. מעבר בין תמונות: חיצים.</p>
        </div>

        <div className="card p-3 space-y-3">
          <RinkDiagram active={active} done={new Set(here.keys())} />
          {RINK_GROUPS.map(g => (
            <div key={g.id}>
              <div className="text-xs font-bold text-slate-700 dark:text-slate-200">{g.label}</div>
              <div className="text-[11px] text-slate-500 mb-1">{g.hint}</div>
              {RINK_LANDMARKS.filter(l => l.group === g.id).map(l => {
                const on = l.id === active, has = here.has(l.id)
                const e = frame ? fitErr.get(`${frame.id}|${l.id}`) : null
                return (
                  <div key={l.id} className={`flex items-center gap-1 rounded-lg ${on ? "bg-brand/10" : ""}`}>
                    <button onClick={() => setActive(l.id)} className="flex-1 min-w-0 text-start text-sm px-2 py-1 flex items-center gap-2">
                      <span className={`w-2.5 h-2.5 rounded-full shrink-0 ${has ? (e > BAD_M ? "bg-red-500" : "bg-emerald-500") : doneAnywhere.has(l.id) ? "bg-emerald-200 dark:bg-emerald-900" : "bg-slate-300 dark:bg-slate-600"}`} />
                      <span className="truncate">{l.label}</span>
                      {e != null && <span className={`ms-auto text-[10px] tabular-nums ${e > BAD_M ? "text-red-600 font-bold" : "text-slate-400"}`}>{e.toFixed(2)} מ׳</span>}
                    </button>
                    {has && <button onClick={() => remove(l.id)} className="p-1 text-slate-400 hover:text-red-600" aria-label={`מחיקת ${l.label}`}><Trash2 className="w-3.5 h-3.5" /></button>}
                  </div>
                )
              })}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

function Loupe({ url, loupe, box }) {
  if (!box) return null
  const r = box.getBoundingClientRect()
  // Above the finger on touch (so it isn't hidden), beside the cursor with a mouse; kept inside the box.
  let left = loupe.px + (loupe.touch ? -LOUPE / 2 : 24), top = loupe.py - (loupe.touch ? LOUPE + 40 : LOUPE / 2)
  if (left + LOUPE > r.width) left = loupe.px - LOUPE - 24
  left = Math.max(0, left); top = Math.max(0, Math.min(r.height - LOUPE, top))
  return (
    <div className="absolute rounded-full overflow-hidden ring-2 ring-white shadow-xl pointer-events-none"
      style={{
        left, top, width: LOUPE, height: LOUPE,
        backgroundImage: `url(${url})`, backgroundRepeat: "no-repeat",
        backgroundSize: `${r.width * ZOOM}px ${r.height * ZOOM}px`,
        backgroundPosition: `${LOUPE / 2 - loupe.px * ZOOM}px ${LOUPE / 2 - loupe.py * ZOOM}px`,
      }}>
      <div className="absolute left-1/2 top-0 bottom-0 w-px bg-yellow-300/90" />
      <div className="absolute top-1/2 left-0 right-0 h-px bg-yellow-300/90" />
    </div>
  )
}

function FitResult({ set, total, busy, onFit }) {
  const f = set.fit
  const pending = ["queued", "fitting"].includes(set.status)
  const bad = (f?.points || []).filter(p => p.err_m > BAD_M).length
  return (
    <div className="card p-3 flex flex-wrap items-center gap-3">
      <div className="flex-1 min-w-0 text-sm">
        {f?.L ? (
          <>
            <b className="text-slate-900 dark:text-white">המגרש: {f.L.toFixed(1)} × {f.W.toFixed(1)} מ׳</b>
            <span className="text-slate-500"> · דיוק ממוצע ±{(f.rms ?? 0).toFixed(2)} מ׳{f.cam_height ? ` · המצלמה בגובה ${f.cam_height.toFixed(1)} מ׳` : ""}</span>
            {bad > 0 && <span className="block text-red-600 text-xs mt-0.5">{bad} נקודות רחוקות מהחישוב (באדום) — כדאי לבדוק ולסמן מחדש ואז לחשב שוב.</span>}
          </>
        ) : (
          <span className="text-slate-600 dark:text-slate-300">סומנו {total} נקודות. כדאי לפחות 12, משני השערים ומהאמצע.</span>
        )}
        {set.worker_note && <span className="block text-xs text-slate-500 mt-0.5">{set.worker_note}</span>}
      </div>
      <button onClick={onFit} disabled={busy || pending || total < 6} className="btn-primary inline-flex items-center gap-1.5 disabled:opacity-40">
        {pending ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
        {pending ? "מחשב…" : f?.L ? "חשב שוב" : "חשב מידות"}
      </button>
    </div>
  )
}
