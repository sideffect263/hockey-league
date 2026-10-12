import { useCallback, useEffect, useState } from "react"
import { Link, useParams } from "react-router-dom"
import { ArrowRight, Eye, EyeOff, Lock, LockOpen, MonitorPlay, Pencil, Radio, Check, Minus, Plus, LayoutGrid, Wand2 } from "lucide-react"
import { useAuth } from "@/lib/AuthContext"
import { useSlugId } from "@/lib/slugs"
import { getGameById, getTeams } from "@/lib/api"
import { getGameVideos, subscribeGameVideo, groupCameras } from "@/lib/video"
import {
  getBroadcast, subscribeBroadcast, saveBroadcast, setCameraHidden, renameCamera, getCameraStreamers, BROADCAST_DEFAULTS,
  LAYOUT_SLOTS, getCameraActivity,
} from "@/lib/streamControl"
import { useCameraOnAir } from "@/lib/useCameraOnAir"
import { useStreamViewers } from "@/lib/useStreamViewers"
import LiveHlsPlayer from "@/components/LiveHlsPlayer"
import ScoreOverlay from "@/components/ScoreOverlay"
import LiveMultiView, { useLiveTiles } from "@/components/LiveMultiView"

/**
 * חדר שידור — the director's control room for one game (/games/:id/control, admin only).
 * Built for one person at the rink on a phone, works on a PC.
 *
 *  - Program: the camera viewers follow (unless a fan picked their own), shown as viewers
 *    see it, score overlay included.
 *  - Cameras: a small live preview of every streamer (lowest rendition, to spare the rink's
 *    connection), approve / hide (a new camera is hidden until approved), put on air, rename.
 *  - Layout: one camera, picture-in-picture, side by side or a 2x2 grid — the camera on air
 *    is the main picture, the director adds the others ("הוסף לתצוגה").
 *  - Auto-director: phones with "מעקב אוטומטי" report how many players they see; the server
 *    cuts to the camera with the play (two phones, one per half). See auto-director.sql.
 *  - Settings: score overlay on/off + corner, cap on simultaneous cameras, lock new streams.
 *
 * Nothing is mixed on a server: the settings live in game_broadcast and every viewer's
 * player follows them over realtime. See supabase/game-broadcast.sql.
 */
export default function GameControl() {
  const { id: routeKey } = useParams()
  const { id: gameId } = useSlugId("games", routeKey)
  const { isAdmin, loading: authLoading } = useAuth()
  const [game, setGame] = useState(null)
  const [teams, setTeams] = useState([])
  const [videos, setVideos] = useState([])
  const [bc, setBc] = useState(BROADCAST_DEFAULTS)
  const [streamers, setStreamers] = useState({}) // camera_no -> who streams it
  const [error, setError] = useState(null)
  // The director watches the viewer count without being counted.
  const viewers = useStreamViewers(gameId, !!gameId, false)

  const loadVideos = useCallback(async () => {
    if (!gameId) return
    try {
      setVideos(await getGameVideos(gameId))
      setStreamers(await getCameraStreamers(gameId).catch(() => ({})))
    } catch (e) { setError(e?.message || "טעינת המצלמות נכשלה") }
  }, [gameId])

  useEffect(() => {
    if (!gameId || !isAdmin) return
    let alive = true
    Promise.all([getGameById(gameId), getTeams(), getBroadcast(gameId)])
      .then(([g, t, b]) => { if (alive) { setGame(g); setTeams(t); setBc(b) } })
      .catch(fail)
    loadVideos()
    const unV = subscribeGameVideo(gameId, loadVideos)
    const unB = subscribeBroadcast(gameId, setBc)
    return () => { alive = false; unV(); unB() }
  }, [gameId, isAdmin, loadVideos])

  // Every write goes through here: optimistic on screen, rolled back with a message on refusal.
  const fail = (e) => setError(/row-level|permission|42501|אין הרשאה|נחסם/i.test(String(e?.message || e?.code || ""))
    ? "אין הרשאה — רק המנהל יכול לשנות את השידור (ייתכן שפג תוקף ההתחברות)"
    : (e?.message || "השמירה נכשלה"))
  const save = async (patch) => {
    const before = bc
    setBc({ ...bc, ...patch })
    try { setBc(await saveBroadcast(gameId, patch)) }
    catch (e) { setBc(before); fail(e) }
  }
  const act = async (fn) => {
    try { await fn(); await loadVideos() } catch (e) { fail(e) }
  }

  if (authLoading) return <div className="p-8 text-center text-slate-400">טוען…</div>
  if (!isAdmin) return <div className="p-8 text-center text-slate-500">חדר השידור זמין למנהל בלבד.</div>

  const home = teams.find((t) => t.id === game?.home_team_id)
  const away = teams.find((t) => t.id === game?.away_team_id)
  // Uploaded videos (no camera number) are replays, not live angles — not directed here.
  const cameras = groupCameras(videos).filter((c) => c.no != null)
  const pending = cameras.filter((c) => c.hidden)
  const approved = cameras.filter((c) => !c.hidden)
  const program = cameras.find((c) => c.no === bc.program_camera_no) || null
  const slots = LAYOUT_SLOTS[bc.layout] ?? 0
  const extras = (bc.layout_cameras || []).filter((no) => no !== bc.program_camera_no)
  // Add/remove a camera from the layout's extra slots; a full layout drops its oldest extra.
  const toggleExtra = (no) => {
    const has = extras.includes(no)
    const next = has ? extras.filter((n) => n !== no) : [...extras, no].slice(-Math.max(slots, 1))
    save({ layout_cameras: next })
  }
  const setLayout = (layout) => {
    const n = LAYOUT_SLOTS[layout] ?? 0
    save({ layout, layout_cameras: n ? extras.slice(0, n) : extras })
  }

  return (
    <div className="max-w-3xl mx-auto px-4 py-4 space-y-4">
      <div className="flex items-center gap-3">
        <Link to={`/games/${routeKey}`} className="p-2 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800" aria-label="חזרה למשחק">
          <ArrowRight className="w-5 h-5" />
        </Link>
        <div className="flex-1 min-w-0">
          <h1 className="flex items-center gap-2 font-extrabold text-lg text-slate-900 dark:text-white">
            <MonitorPlay className="w-5 h-5 text-brand" /> חדר שידור
          </h1>
          <p className="text-xs text-slate-500 truncate">{home?.name || "…"} – {away?.name || "…"}</p>
        </div>
        <span className="flex items-center gap-1 text-sm font-semibold text-slate-600 dark:text-slate-300" title="צופים עכשיו">
          <Eye className="w-4 h-4" /> {viewers}
        </span>
      </div>

      {error && (
        <button onClick={() => setError(null)} className="w-full text-right text-sm rounded-xl p-3 bg-red-50 text-red-700 dark:bg-red-900/30 dark:text-red-300">
          {error} <span className="opacity-60">(סגור)</span>
        </button>
      )}

      {/* Program — what viewers follow */}
      <section className="card p-4 space-y-3">
        <h2 className="flex items-center gap-2 font-bold text-sm">
          <Radio className="w-4 h-4 text-red-500" /> באוויר עכשיו
          <span className="font-medium text-slate-500">{program ? program.label : "אוטומטי"}</span>
        </h2>
        {program
          ? <ProgramView camera={program} extras={extras.slice(0, slots).map((no) => approved.find((c) => c.no === no)).filter(Boolean)}
              gameId={gameId} home={home} away={away} bc={bc} />
          : <p className="text-sm text-slate-500">לא נבחרה מצלמה — הצופים רואים מצלמה חיה שאושרה (החדשה ביותר). בחר "שים באוויר" על אחת המצלמות.</p>}
        {program && (
          <button onClick={() => save({ program_camera_no: null })} className="text-xs font-semibold text-slate-500 hover:text-slate-800 dark:hover:text-slate-200">
            חזור לבחירה אוטומטית
          </button>
        )}
      </section>

      {/* Layout — how the other cameras appear around the one on air */}
      <section className="card p-4 space-y-3">
        <h2 className="flex items-center gap-2 font-bold text-sm"><LayoutGrid className="w-4 h-4 text-brand" /> תצוגה</h2>
        <Segmented value={bc.layout} onChange={setLayout}
          options={[["single", "מצלמה אחת"], ["pip", "תמונה בתמונה"], ["side", "זו לצד זו"], ["grid", "רשת 2×2"]]} />
        {slots > 0 && (
          <p className="text-xs text-slate-500">
            {extras.length === 0
              ? `הוסף ${slots === 1 ? "מצלמה" : "עד 3 מצלמות"} עם "הוסף לתצוגה". המצלמה שבאוויר היא התמונה הראשית.`
              : "רק מצלמות שמשדרות כרגע מוצגות. צופים יכולים לעבור למצלמה אחת; האפליקציות מציגות עדיין רק את המצלמה שבאוויר."}
          </p>
        )}
      </section>

      <AutoDirector bc={bc} cameras={approved} gameId={gameId} save={save} />

      {/* Cameras */}
      {pending.length > 0 && (
        <section className="space-y-2">
          <h2 className="font-bold text-sm text-amber-700 dark:text-amber-400">ממתינות לאישור ({pending.length}) — מוסתרות מהצופים</h2>
          <div className="grid gap-3 sm:grid-cols-2">
            {pending.map((c) => (
              <CameraCard key={c.key} camera={c} gameId={gameId} onAir={bc.program_camera_no === c.no} streamer={streamers[c.no]}
                onApprove={() => act(() => setCameraHidden(gameId, c.no, false))}
                onRename={(l) => act(() => renameCamera(gameId, c.no, l))} />
            ))}
          </div>
        </section>
      )}
      <section className="space-y-2">
        <h2 className="font-bold text-sm">מצלמות ({approved.length})</h2>
        {approved.length === 0 && <p className="text-sm text-slate-500">אין עדיין מצלמות מאושרות. כשמישהו מתחיל לשדר מהאפליקציה, המצלמה תופיע כאן.</p>}
        <div className="grid gap-3 sm:grid-cols-2">
          {approved.map((c) => (
            <CameraCard key={c.key} camera={c} gameId={gameId} onAir={bc.program_camera_no === c.no} streamer={streamers[c.no]}
              inLayout={slots > 0 && extras.slice(0, slots).includes(c.no)}
              onToggleLayout={slots > 0 && bc.program_camera_no !== c.no ? () => toggleExtra(c.no) : null}
              // A hand-picked camera ends the auto-director (it would cut away again a second later).
              onPutOnAir={() => save({ program_camera_no: c.no, layout_cameras: extras.filter((n) => n !== c.no),
                ...(bc.auto_director ? { auto_director: false } : {}) })}
              onHide={() => act(async () => {
                await setCameraHidden(gameId, c.no, true)
                if (bc.program_camera_no === c.no) await save({ program_camera_no: null })
                if (extras.includes(c.no)) await save({ layout_cameras: extras.filter((n) => n !== c.no) })
              })}
              onRename={(l) => act(() => renameCamera(gameId, c.no, l))} />
          ))}
        </div>
      </section>

      {/* Settings */}
      <section className="card p-4 space-y-4">
        <h2 className="font-bold text-sm">הגדרות שידור</h2>
        <Row label="לוח תוצאה על הווידאו">
          <Toggle on={bc.overlay_score} onChange={(v) => save({ overlay_score: v })} />
        </Row>
        {bc.overlay_score && (
          <Row label="מיקום הלוח">
            <Segmented value={bc.overlay_position} onChange={(v) => save({ overlay_position: v })}
              options={[["top-right", "ימין למעלה"], ["top-left", "שמאל למעלה"]]} />
          </Row>
        )}
        <Row label="מקסימום מצלמות בו-זמנית" hint="אתה לא נספר במגבלה">
          <div className="flex items-center gap-2">
            <IconBtn label="פחות" disabled={bc.max_cameras <= 1} onClick={() => save({ max_cameras: bc.max_cameras - 1 })}><Minus className="w-4 h-4" /></IconBtn>
            <span className="w-6 text-center font-bold tabular-nums">{bc.max_cameras}</span>
            <IconBtn label="יותר" disabled={bc.max_cameras >= 12} onClick={() => save({ max_cameras: bc.max_cameras + 1 })}><Plus className="w-4 h-4" /></IconBtn>
          </div>
        </Row>
        <Row label={bc.streaming_locked ? "שידורים חדשים נעולים" : "פתוח לשידורים חדשים"} hint="נעילה לא מפסיקה מצלמות שכבר משדרות">
          <button onClick={() => save({ streaming_locked: !bc.streaming_locked })}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold ${bc.streaming_locked
              ? "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300"
              : "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300"}`}>
            {bc.streaming_locked ? <><Lock className="w-3.5 h-3.5" /> נעול</> : <><LockOpen className="w-3.5 h-3.5" /> פתוח</>}
          </button>
        </Row>
      </section>
    </div>
  )
}

// בימוי אוטומטי — two (or more) phones with "מעקב אוטומטי", each on part of the rink, report
// how many players they see; the server puts the one with the play on air, `auto_delay_s`
// seconds behind real time so the cut reaches viewers (whose video lags) as the play crosses.
function AutoDirector({ bc, cameras, gameId, save }) {
  const [counts, setCounts] = useState({})
  useEffect(() => {
    if (!gameId) return
    let alive = true, timer = null
    const tick = async () => {
      try { const c = await getCameraActivity(gameId); if (alive) setCounts(c) } catch { /* admin read; ignore */ }
      if (alive) timer = setTimeout(tick, 2000)
    }
    tick()
    return () => { alive = false; clearTimeout(timer) }
  }, [gameId])
  const reporting = cameras.filter((c) => counts[c.no] != null)
  const chosen = bc.auto_cameras || []
  const inAuto = (no) => !chosen.length || chosen.includes(no)
  const toggleCam = (no) => {
    const base = chosen.length ? chosen : cameras.map((c) => c.no)
    const next = base.includes(no) ? base.filter((n) => n !== no) : [...base, no]
    // Everyone selected again = back to "all" (new cameras join automatically).
    save({ auto_cameras: next.length === cameras.length ? [] : next.slice(0, 4) })
  }
  return (
    <section className="card p-4 space-y-3">
      <div className="flex items-center justify-between gap-3">
        <h2 className="flex items-center gap-2 font-bold text-sm"><Wand2 className="w-4 h-4 text-brand" /> בימוי אוטומטי</h2>
        <Toggle on={bc.auto_director} onChange={(v) => save({ auto_director: v })} />
      </div>
      <p className="text-xs text-slate-500">
        לשתי מצלמות (אחת לכל חצי מגרש) עם "מעקב אוטומטי" באפליקציה: המצלמה שרואה הכי הרבה שחקנים עולה לאוויר.
        בחירה ידנית של מצלמה מכבה את הבימוי האוטומטי.
      </p>
      {cameras.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {cameras.map((c) => (
            <button key={c.key} onClick={() => toggleCam(c.no)}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold border ${inAuto(c.no)
                ? "border-brand bg-brand/10 text-slate-900 dark:text-white" : "border-slate-200 dark:border-slate-700 text-slate-400"}`}>
              {inAuto(c.no) && <Check className="w-3.5 h-3.5" />} {c.label}
              <span className="font-medium tabular-nums text-slate-500">
                {counts[c.no] != null ? `· ${counts[c.no]} שחקנים` : "· לא מדווחת"}
              </span>
              {bc.program_camera_no === c.no && <span className="w-2 h-2 rounded-full bg-red-500" aria-label="באוויר" />}
            </button>
          ))}
        </div>
      )}
      {bc.auto_director && reporting.length < 2 && (
        <p className="text-xs text-amber-700 dark:text-amber-400">
          צריך לפחות שתי מצלמות שמדווחות (מעקב אוטומטי + מצב "חצי מגרש" באפליקציה).
        </p>
      )}
      <Row label="השהיית החלפה" hint="כמה שניות הצופים מאחורי המגרש (בדרך כלל 10–20)">
        <div className="flex items-center gap-2">
          <IconBtn label="פחות" disabled={bc.auto_delay_s <= 0} onClick={() => save({ auto_delay_s: bc.auto_delay_s - 1 })}><Minus className="w-4 h-4" /></IconBtn>
          <span className="w-8 text-center font-bold tabular-nums">{bc.auto_delay_s}″</span>
          <IconBtn label="יותר" disabled={bc.auto_delay_s >= 60} onClick={() => save({ auto_delay_s: bc.auto_delay_s + 1 })}><Plus className="w-4 h-4" /></IconBtn>
        </div>
      </Row>
    </section>
  )
}

// The program camera as viewers see it: its newest part, live with the overlay — inside the
// chosen layout when other cameras are added and on air — or a note.
function ProgramView({ camera, extras = [], gameId, home, away, bc }) {
  const part = camera.parts[camera.parts.length - 1]
  const onAir = useCameraOnAir(part)
  const [latency, setLatency] = useState(null) // the score waits for the picture, as for viewers
  const tiles = useLiveTiles(bc.layout !== "single" ? [camera, ...extras] : [])
  const code = part?.cf_customer_code
  if (onAir && tiles && tiles.length > 1) {
    return (
      <LiveMultiView layout={bc.layout} tiles={tiles} onLatency={setLatency} overlayPosition={bc.overlay_position}>
        {bc.overlay_score && <ScoreOverlay gameId={gameId} home={home} away={away} position={bc.overlay_position} latencyMs={latency?.ms ?? 0} />}
      </LiveMultiView>
    )
  }
  if (!onAir || !code) {
    return <div className="w-full aspect-video rounded-xl bg-black grid place-items-center text-sm text-slate-300">{onAir === null ? "טוען…" : "המצלמה לא משדרת כרגע"}</div>
  }
  return (
    <LiveHlsPlayer src={`https://customer-${code}.cloudflarestream.com/${part.cf_live_input}/manifest/video.m3u8`}
      fsSide={bc.overlay_position === "top-left" ? "right" : "left"} onLatency={setLatency}>
      {bc.overlay_score && <ScoreOverlay gameId={gameId} home={home} away={away} position={bc.overlay_position} latencyMs={latency?.ms ?? 0} />}
    </LiveHlsPlayer>
  )
}

function CameraCard({ camera, onAir, streamer, onApprove, onHide, onPutOnAir, onRename, inLayout, onToggleLayout }) {
  const part = camera.parts[camera.parts.length - 1]
  const live = useCameraOnAir(part)
  const code = part?.cf_customer_code
  const [editing, setEditing] = useState(false)
  const [label, setLabel] = useState(camera.label)
  useEffect(() => { setLabel(camera.label) }, [camera.label])

  return (
    <div className={`card p-3 space-y-2 ${onAir ? "ring-2 ring-red-500" : ""} ${camera.hidden ? "ring-2 ring-amber-400" : ""}`}>
      {live && code
        ? <LiveHlsPlayer preview src={`https://customer-${code}.cloudflarestream.com/${part.cf_live_input}/manifest/video.m3u8`} />
        : <div className="w-full aspect-video rounded-xl bg-slate-900 grid place-items-center text-xs text-slate-400">
            {live === null ? "בודק…" : `לא משדר · ${camera.parts.length} ${camera.parts.length === 1 ? "הקלטה" : "הקלטות"}`}
          </div>}
      <div className="flex items-center gap-2">
        {editing ? (
          <form className="flex-1 flex gap-1" onSubmit={(e) => { e.preventDefault(); onRename(label); setEditing(false) }}>
            <input value={label} onChange={(e) => setLabel(e.target.value)} maxLength={40} autoFocus
              className="filter-input text-sm flex-1 min-w-0" placeholder={`מצלמה ${camera.no}`} />
            <IconBtn label="שמור" type="submit"><Check className="w-4 h-4" /></IconBtn>
          </form>
        ) : (
          <>
            <span className="flex-1 min-w-0 truncate font-bold text-sm">{camera.label}</span>
            <IconBtn label="שנה שם" onClick={() => setEditing(true)}><Pencil className="w-3.5 h-3.5" /></IconBtn>
          </>
        )}
      </div>
      {streamer && <p className="text-xs text-slate-500 -mt-1">משדר: {streamer}</p>}
      <div className="flex flex-wrap items-center gap-1.5 text-[11px] font-semibold">
        {live && <span className="px-2 py-0.5 rounded-full bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300">● משדר</span>}
        {onAir && <span className="px-2 py-0.5 rounded-full bg-slate-900 text-white dark:bg-white dark:text-slate-900">באוויר</span>}
        {camera.hidden && <span className="px-2 py-0.5 rounded-full bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300">מוסתר</span>}
        {inLayout && <span className="px-2 py-0.5 rounded-full bg-brand/15 text-brand">בתצוגה</span>}
      </div>
      <div className="flex gap-2">
        {camera.hidden ? (
          <button onClick={onApprove} className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg text-sm font-bold bg-emerald-600 text-white hover:bg-emerald-700">
            <Eye className="w-4 h-4" /> אשר והצג
          </button>
        ) : (
          <>
            <button onClick={onPutOnAir} disabled={onAir}
              className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg text-sm font-bold whitespace-nowrap bg-red-600 text-white hover:bg-red-700 disabled:opacity-50">
              <Radio className="w-4 h-4" /> {onAir ? "באוויר" : "שים באוויר"}
            </button>
            <button onClick={onHide} className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-semibold bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700">
              <EyeOff className="w-4 h-4" /> הסתר
            </button>
          </>
        )}
      </div>
      {onToggleLayout && (
        <button onClick={onToggleLayout} aria-pressed={!!inLayout}
          className={`w-full flex items-center justify-center gap-1.5 py-1.5 rounded-lg text-xs font-bold ${inLayout
            ? "bg-brand text-white hover:opacity-90"
            : "bg-brand/10 text-brand hover:bg-brand/20"}`}>
          <LayoutGrid className="w-3.5 h-3.5" /> {inLayout ? "הסר מהתצוגה" : "הוסף לתצוגה"}
        </button>
      )}
    </div>
  )
}

function Row({ label, hint, children }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <div className="min-w-0">
        <p className="text-sm font-semibold">{label}</p>
        {hint && <p className="text-[11px] text-slate-500">{hint}</p>}
      </div>
      {children}
    </div>
  )
}

function Toggle({ on, onChange }) {
  return (
    <button role="switch" aria-checked={on} onClick={() => onChange(!on)}
      className={`relative w-11 h-6 rounded-full transition-colors shrink-0 ${on ? "bg-brand" : "bg-slate-300 dark:bg-slate-600"}`}>
      <span className={`absolute top-0.5 w-5 h-5 rounded-full bg-white shadow transition-all ${on ? "right-0.5" : "right-[1.375rem]"}`} />
    </button>
  )
}

function Segmented({ value, onChange, options }) {
  return (
    <div className="flex rounded-lg bg-slate-100 dark:bg-slate-800 p-0.5 shrink-0">
      {options.map(([v, l]) => (
        <button key={v} onClick={() => onChange(v)}
          className={`px-2.5 py-1 rounded-md text-xs font-semibold ${value === v ? "bg-white dark:bg-slate-700 shadow-sm" : "text-slate-500"}`}>
          {l}
        </button>
      ))}
    </div>
  )
}

function IconBtn({ label, children, ...props }) {
  return (
    <button aria-label={label} title={label} {...props}
      className="p-1.5 rounded-lg bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 disabled:opacity-40">
      {children}
    </button>
  )
}
