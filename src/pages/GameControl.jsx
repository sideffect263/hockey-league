import { useCallback, useEffect, useRef, useState } from "react"
import { Link, useParams } from "react-router-dom"
import { ArrowRight, Eye, EyeOff, Lock, LockOpen, Pencil, Check, Minus, Plus, LayoutGrid, Wand2, Hand, X, Trash2, AlertTriangle, Settings2, ChevronDown, Wifi, WifiOff } from "lucide-react"
import { MonitorPlay, Live as Radio, Film, Broadcast, Hourglass } from "@/components/icons/BrandIcons"
import { useAuth } from "@/lib/AuthContext"
import { useSlugId } from "@/lib/slugs"
import { getGameById, getTeams } from "@/lib/api"
import { getGameVideos, subscribeGameVideo, groupCameras, cfInputIsLive, detachVideo, fmtClock } from "@/lib/video"
import {
  getBroadcast, subscribeBroadcast, saveBroadcast, setCameraHidden, renameCamera, getCameraStreamers, BROADCAST_DEFAULTS,
  LAYOUT_SLOTS, getCameraActivity, getStreamRequests, decideStreamRequest, deleteStreamRequest,
  getRecordingDurations, getLiveGameState,
} from "@/lib/streamControl"
import { useCameraOnAir } from "@/lib/useCameraOnAir"
import { useStreamViewers } from "@/lib/useStreamViewers"
import { useIngestHealth } from "@/lib/useIngestHealth"
import LiveHlsPlayer from "@/components/LiveHlsPlayer"
import ScoreOverlay from "@/components/ScoreOverlay"
import LiveMultiView, { useLiveTiles } from "@/components/LiveMultiView"

/**
 * חדר שידור — the director's control room for one game (/games/:id/control, admin only).
 * Built for one person at the rink on a phone, works on a PC.
 *
 * Reworked 2026-10-25 after the first real three-game day, where the old page hid a game's
 * footage by accident ("הסתר" also hid its recordings), mixed live and finished cameras,
 * and showed nothing while one camera trickled a sixth of real time and another was dead.
 * Top to bottom:
 *  - Status: score/clock, cameras on air, viewers, and warnings — no camera on air while
 *    the game runs, a camera whose video isn't reaching Cloudflare in real time.
 *  - On air now: the program as viewers see it.
 *  - Live cameras: preview, upload health, put on air, add to the layout, rename.
 *  - Waiting: fan requests and cameras waiting for approval, one approve each.
 *  - Recordings: finished cameras, each part with its length, shown on / hidden from the
 *    site (spelled out), delete a junk part.
 *  - Advanced (folded): layout, auto-director, score overlay, camera cap, lock.
 * Staff and known streamers never wait (supabase/stream-trusted.sql).
 *
 * Nothing is mixed on a server: the settings live in game_broadcast and every viewer's
 * player follows them over realtime. See supabase/game-broadcast.sql.
 */

// A camera's newest part, if it still points at its live input (on air, or not swapped yet).
const livePart = (cam) => {
  const p = cam.parts[cam.parts.length - 1]
  return p?.cf_live_input && p.video_id === p.cf_live_input && p.cf_customer_code ? p : null
}

// Which cameras are on air: Cloudflare's lifecycle for each camera's newest part, every
// 10 s; two misses in a row before calling one off air (a streamer's short reconnect
// shouldn't move their card around). { [camera_no]: true | false } — missing = unknown.
function useCamerasOnAir(cameras) {
  const [onAir, setOnAir] = useState({})
  const misses = useRef({})
  const key = cameras.map((c) => `${c.no}:${livePart(c)?.id || "-"}`).join(",")
  useEffect(() => {
    let alive = true
    const tick = async () => {
      const next = {}
      await Promise.all(cameras.map(async (c) => {
        const p = livePart(c)
        if (!p) { next[c.no] = false; return }
        const live = await cfInputIsLive(p.cf_customer_code, p.cf_live_input)
        if (live === true) { misses.current[c.no] = 0; next[c.no] = true }
        else if (live === false) {
          misses.current[c.no] = (misses.current[c.no] || 0) + 1
          if (misses.current[c.no] >= 2) next[c.no] = false
        }
      }))
      if (alive) setOnAir((prev) => ({ ...prev, ...next }))
    }
    tick()
    const timer = setInterval(tick, 10000)
    return () => { alive = false; clearInterval(timer) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])
  return onAir
}

export default function GameControl() {
  const { id: routeKey } = useParams()
  const { id: gameId } = useSlugId("games", routeKey)
  const { isAdmin, loading: authLoading } = useAuth()
  const [game, setGame] = useState(null)
  const [teams, setTeams] = useState([])
  const [videos, setVideos] = useState([])
  const [bc, setBc] = useState(BROADCAST_DEFAULTS)
  const [streamers, setStreamers] = useState({}) // camera_no -> who streams it
  const [requests, setRequests] = useState([])   // fans asking to stream (stream_requests)
  const [durations, setDurations] = useState({}) // cloudflare uid -> seconds
  const [liveState, setLiveState] = useState(null)
  const [error, setError] = useState(null)
  // The director watches the viewer count without being counted.
  const viewers = useStreamViewers(gameId, !!gameId, false)

  const loadVideos = useCallback(async () => {
    if (!gameId) return
    try {
      const v = await getGameVideos(gameId)
      setVideos(v)
      setStreamers(await getCameraStreamers(gameId).catch(() => ({})))
      setRequests(await getStreamRequests(gameId).catch(() => []))
      setDurations(await getRecordingDurations(v.map((x) => x.video_id)).catch(() => ({})))
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
    // The judge's clock/score for the status strip (and the "no camera" warning).
    const pollState = () => getLiveGameState(gameId).then((s) => { if (alive) setLiveState(s) }).catch(() => {})
    pollState()
    const stateTimer = setInterval(pollState, 5000)
    return () => { alive = false; unV(); unB(); clearInterval(stateTimer) }
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

  // Uploaded videos (no camera number) are replays, not live angles — not directed here.
  const cameras = groupCameras(videos).filter((c) => c.no != null)
  const onAirMap = useCamerasOnAir(cameras)
  const liveCams = cameras.filter((c) => onAirMap[c.no] === true)
  const health = useIngestHealth(liveCams.map((c) => {
    const p = livePart(c)
    return { no: c.no, code: p.cf_customer_code, input: p.cf_live_input }
  }))

  if (authLoading) return <div className="p-8 text-center text-slate-400">טוען…</div>
  if (!isAdmin) return <div className="p-8 text-center text-slate-500">חדר השידור זמין למנהל בלבד.</div>

  const home = teams.find((t) => t.id === game?.home_team_id)
  const away = teams.find((t) => t.id === game?.away_team_id)
  const approvedLive = liveCams.filter((c) => !c.hidden)
  const waitingLive = liveCams.filter((c) => c.hidden)
  // Everything not on air right now is a recording (or about to be one).
  const recorded = cameras.filter((c) => onAirMap[c.no] === false)
  const checking = cameras.filter((c) => onAirMap[c.no] === undefined)
  const waitingRequests = requests.filter((r) => r.status === "pending")
  const decidedRequests = requests.filter((r) => r.status !== "pending")
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
  const hideCamera = (c) => act(async () => {
    await setCameraHidden(gameId, c.no, true)
    if (bc.program_camera_no === c.no) await save({ program_camera_no: null })
    if (extras.includes(c.no)) await save({ layout_cameras: extras.filter((n) => n !== c.no) })
  })

  return (
    <div className="max-w-3xl mx-auto px-4 py-4 space-y-4">
      <div className="flex items-center gap-3">
        <Link to={`/games/${routeKey}`} className="p-2 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800" aria-label="חזרה למשחק">
          <ArrowRight className="w-5 h-5" />
        </Link>
        <h1 className="flex-1 min-w-0 flex items-center gap-2 font-extrabold text-lg text-slate-900 dark:text-white">
          <MonitorPlay className="w-5 h-5 text-brand" /> חדר שידור
        </h1>
      </div>

      {error && (
        <button onClick={() => setError(null)} className="w-full text-right text-sm rounded-xl p-3 bg-red-50 text-red-700 dark:bg-red-900/30 dark:text-red-300">
          {error} <span className="opacity-60">(סגור)</span>
        </button>
      )}

      <StatusStrip home={home} away={away} liveState={liveState} game={game} liveCount={approvedLive.length}
        viewers={viewers} health={health} liveCams={approvedLive} waiting={waitingRequests.length + waitingLive.length} />

      {/* Program — what viewers follow */}
      <section className="card p-4 space-y-3">
        <h2 className="flex items-center gap-2 font-bold text-sm">
          <Radio className="w-4 h-4 text-red-500" /> באוויר עכשיו
          <span className="font-medium text-slate-500">{program ? program.label : "אוטומטי"}</span>
        </h2>
        {program
          ? <ProgramView camera={program} extras={extras.slice(0, slots).map((no) => approved.find((c) => c.no === no)).filter(Boolean)}
              gameId={gameId} home={home} away={away} bc={bc} />
          : <p className="text-sm text-slate-500">לא נבחרה מצלמה — הצופים רואים את המצלמה המאושרת האחרונה שהתחילה לשדר. לחץ "שים באוויר" על מצלמה כדי לבחור.</p>}
        {program && (
          <button onClick={() => save({ program_camera_no: null })} className="text-xs font-semibold text-slate-500 hover:text-slate-800 dark:hover:text-slate-200">
            בטל בחירה — תמיד המצלמה האחרונה שמשדרת
          </button>
        )}
      </section>

      {/* Live cameras */}
      <section className="space-y-2">
        <h2 className="flex items-center gap-2 font-bold text-sm">
          <span className="w-2 h-2 rounded-full bg-red-500" /> מצלמות משדרות ({approvedLive.length})
        </h2>
        {approvedLive.length === 0 && (
          <p className="text-sm text-slate-500">
            {checking.length ? "בודק מצלמות…" : "אף מצלמה לא משדרת כרגע. כשמישהו מתחיל לשדר מהאפליקציה, המצלמה תופיע כאן."}
          </p>
        )}
        <div className="grid gap-3 sm:grid-cols-2">
          {approvedLive.map((c) => (
            <LiveCameraCard key={c.key} camera={c} streamer={streamers[c.no]} health={health[c.no]}
              onAir={bc.program_camera_no === c.no}
              inLayout={slots > 0 && extras.slice(0, slots).includes(c.no)}
              onToggleLayout={slots > 0 && bc.program_camera_no !== c.no ? () => toggleExtra(c.no) : null}
              // A hand-picked camera ends the auto-director (it would cut away again a second later).
              onPutOnAir={() => save({ program_camera_no: c.no, layout_cameras: extras.filter((n) => n !== c.no),
                ...(bc.auto_director ? { auto_director: false } : {}) })}
              onHide={() => hideCamera(c)}
              onRename={(l) => act(() => renameCamera(gameId, c.no, l))} />
          ))}
        </div>
      </section>

      <WaitingSection requests={waitingRequests} decided={decidedRequests} cameras={waitingLive} streamers={streamers}
        onDecide={(id, approve) => act(() => decideStreamRequest(id, approve))}
        onDeleteRequest={(id) => act(() => deleteStreamRequest(id))}
        onApproveCamera={(c) => act(() => setCameraHidden(gameId, c.no, false))} />

      <RecordingsSection cameras={recorded} streamers={streamers} durations={durations}
        onShow={(c) => act(() => setCameraHidden(gameId, c.no, false))}
        onHide={(c) => hideCamera(c)}
        onDeletePart={(p) => act(() => detachVideo(p.id))}
        onRename={(c, l) => act(() => renameCamera(gameId, c.no, l))} />

      <details className="card p-4 group">
        <summary className="flex items-center gap-2 font-bold text-sm cursor-pointer list-none">
          <Settings2 className="w-4 h-4 text-brand" /> מתקדם
          <span className="font-normal text-xs text-slate-500">תצוגה, בימוי אוטומטי, לוח תוצאה, מגבלות</span>
          <ChevronDown className="w-4 h-4 mr-auto transition-transform group-open:rotate-180" />
        </summary>
        <div className="space-y-5 pt-4">
          <div className="space-y-2">
            <h3 className="flex items-center gap-2 font-bold text-sm"><LayoutGrid className="w-4 h-4 text-brand" /> תצוגה</h3>
            <Segmented value={bc.layout} onChange={setLayout}
              options={[["single", "מצלמה אחת"], ["pip", "תמונה בתמונה"], ["side", "זו לצד זו"], ["grid", "רשת 2×2"]]} />
            {slots > 0 && (
              <p className="text-xs text-slate-500">
                {extras.length === 0
                  ? `הוסף ${slots === 1 ? "מצלמה" : "עד 3 מצלמות"} עם "הוסף לתצוגה" בכרטיס המצלמה. המצלמה שבאוויר היא התמונה הראשית.`
                  : "רק מצלמות שמשדרות כרגע מוצגות. האפליקציות מציגות עדיין רק את המצלמה שבאוויר."}
              </p>
            )}
          </div>
          <AutoDirector bc={bc} cameras={approved} gameId={gameId} save={save} />
          <div className="space-y-4">
            <h3 className="font-bold text-sm">הגדרות שידור</h3>
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
          </div>
        </div>
      </details>
    </div>
  )
}

// The top strip: where the game stands, what's on air, and what needs the director now.
function StatusStrip({ home, away, liveState, game, liveCount, viewers, health, liveCams, waiting }) {
  const running = !!liveState && (liveState.is_running || liveState.phase === "running")
  // "No camera" waits 20 s: a streamer restarting the app shouldn't flash a red banner.
  const [noCamSince, setNoCamSince] = useState(null)
  const [, force] = useState(0)
  useEffect(() => {
    if (running && liveCount === 0) setNoCamSince((s) => s ?? Date.now())
    else setNoCamSince(null)
  }, [running, liveCount])
  useEffect(() => {
    if (!noCamSince) return
    const t = setInterval(() => force((n) => n + 1), 5000)
    return () => clearInterval(t)
  }, [noCamSince])
  const noCamera = noCamSince != null && Date.now() - noCamSince > 20000
  // The judge's live row is deleted when the result is saved: fall back to the game itself.
  const done = game?.status === "completed" || game?.status === "waiting_result"
  const phase = !liveState ? (done ? "המשחק הסתיים" : "המשחק לא התחיל")
    : liveState.phase === "over" ? "המשחק הסתיים"
    : liveState.phase === "breakTime" ? (liveState.period || "הפסקה")
    : running ? `חצי ${liveState.period || ""} · רץ` : `חצי ${liveState.period || ""} · עצור`
  const bad = liveCams.filter((c) => health[c.no] === "slow" || health[c.no] === "stalled")
  return (
    <section className="card p-3 space-y-2">
      <div className="flex items-center gap-3 flex-wrap">
        <div className="flex items-center gap-2 font-extrabold text-slate-900 dark:text-white">
          <span className="truncate max-w-[8rem]">{home?.name || "…"}</span>
          <span className="tabular-nums" dir="ltr">{liveState?.home_score ?? game?.home_score ?? "–"}</span>
          <span className="text-slate-400">:</span>
          <span className="tabular-nums" dir="ltr">{liveState?.away_score ?? game?.away_score ?? "–"}</span>
          <span className="truncate max-w-[8rem]">{away?.name || "…"}</span>
        </div>
        <span className="text-xs text-slate-500">{phase}</span>
        <div className="flex items-center gap-3 mr-auto text-sm font-semibold text-slate-600 dark:text-slate-300">
          <span className="flex items-center gap-1" title="מצלמות משדרות"><span className="w-2 h-2 rounded-full bg-red-500" /> {liveCount}</span>
          <span className="flex items-center gap-1" title="צופים באתר עכשיו"><Eye className="w-4 h-4" /> {viewers}</span>
        </div>
      </div>
      {noCamera && (
        <Alert tone="red">אין מצלמה משדרת והמשחק רץ — הצופים לא רואים כלום ושום דבר לא מוקלט.</Alert>
      )}
      {bad.map((c) => (
        <Alert key={c.key} tone="amber">
          {health[c.no] === "stalled"
            ? `${c.label}: הווידאו לא מגיע לשרת — הצופים רואים תמונה קפואה. בקשו מהצלם לבדוק את החיבור או להפעיל מחדש.`
            : `${c.label}: העלאה איטית — רק חלק מהווידאו מגיע והצופים נתקעים. כדאי לעבור לרשת חזקה יותר או להוריד איכות.`}
        </Alert>
      ))}
      {waiting > 0 && <Alert tone="blue">{waiting} ממתינים לאישור שידור — למטה.</Alert>}
    </section>
  )
}

function Alert({ tone, children }) {
  const cls = {
    red: "bg-red-50 text-red-800 dark:bg-red-900/30 dark:text-red-300",
    amber: "bg-amber-50 text-amber-900 dark:bg-amber-900/30 dark:text-amber-200",
    blue: "bg-sky-50 text-sky-900 dark:bg-sky-900/30 dark:text-sky-200",
  }[tone]
  return (
    <p className={`flex items-start gap-2 text-sm rounded-lg px-3 py-2 ${cls}`}>
      <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" /> <span>{children}</span>
    </p>
  )
}

const HEALTH = {
  ok: { cls: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300", icon: Wifi, text: "העלאה תקינה" },
  slow: { cls: "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300", icon: Wifi, text: "העלאה איטית" },
  stalled: { cls: "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300", icon: WifiOff, text: "לא מגיע וידאו" },
}

function CameraName({ camera, onRename }) {
  const [editing, setEditing] = useState(false)
  const [label, setLabel] = useState(camera.label)
  useEffect(() => { setLabel(camera.label) }, [camera.label])
  return editing ? (
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
  )
}

function LiveCameraCard({ camera, onAir, streamer, health, onHide, onPutOnAir, onRename, inLayout, onToggleLayout }) {
  const part = livePart(camera)
  const h = HEALTH[health]
  return (
    <div className={`card p-3 space-y-2 ${onAir ? "ring-2 ring-red-500" : ""}`}>
      {part && <LiveHlsPlayer preview src={`https://customer-${part.cf_customer_code}.cloudflarestream.com/${part.cf_live_input}/manifest/video.m3u8`} />}
      <div className="flex items-center gap-2"><CameraName camera={camera} onRename={onRename} /></div>
      {streamer && <p className="text-xs text-slate-500 -mt-1">משדר: {streamer}</p>}
      <div className="flex flex-wrap items-center gap-1.5 text-[11px] font-semibold">
        {onAir && <span className="px-2 py-0.5 rounded-full bg-slate-900 text-white dark:bg-white dark:text-slate-900">באוויר</span>}
        {h ? <span className={`flex items-center gap-1 px-2 py-0.5 rounded-full ${h.cls}`}><h.icon className="w-3 h-3" /> {h.text}</span>
           : <span className="px-2 py-0.5 rounded-full bg-slate-100 text-slate-500 dark:bg-slate-800">בודק העלאה…</span>}
        {inLayout && <span className="px-2 py-0.5 rounded-full bg-brand/15 text-brand">בתצוגה</span>}
      </div>
      <div className="flex gap-2">
        <button onClick={onPutOnAir} disabled={onAir}
          className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg text-sm font-bold whitespace-nowrap bg-red-600 text-white hover:bg-red-700 disabled:opacity-50">
          <Broadcast className="w-4 h-4" /> {onAir ? "באוויר" : "שים באוויר"}
        </button>
        <button onClick={() => { if (window.confirm(`להסתיר את ${camera.label} מהצופים? גם ההקלטות שלה יוסתרו מהאתר עד שתציג אותן שוב.`)) onHide() }}
          className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-semibold bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700">
          <EyeOff className="w-4 h-4" /> הסתר מהצופים
        </button>
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

// Fans asking to stream (no camera yet, nothing on Cloudflare) and cameras already
// streaming but hidden until approved — one list, one approve each.
function WaitingSection({ requests, decided, cameras, streamers, onDecide, onDeleteRequest, onApproveCamera }) {
  const [showDecided, setShowDecided] = useState(false)
  if (!requests.length && !cameras.length && !decided.length) return null
  const when = (t) => new Date(t).toLocaleTimeString("he-IL", { hour: "2-digit", minute: "2-digit" })
  const del = (r) => { if (window.confirm(`למחוק את הבקשה של ${r.name || "המשתמש"}?`)) onDeleteRequest(r.id) }
  return (
    <section className="card p-4 space-y-3">
      <h2 className="flex items-center gap-2 font-bold text-sm">
        <Hourglass className="w-4 h-4 text-amber-500" /> ממתינים לאישור
        {(requests.length + cameras.length) > 0 && (
          <span className="text-xs font-bold px-2 py-0.5 rounded-full bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300">{requests.length + cameras.length}</span>
        )}
      </h2>
      {requests.length > 0 && (
        <p className="text-xs text-slate-500">אין עלות עד שמאשרים. אחרי אישור הצלם לוחץ שוב "שדר" באפליקציה והמצלמה עולה גלויה לצופים. צוות ומי שאושר בעבר משדרים בלי לחכות.</p>
      )}
      <ul className="divide-y divide-slate-100 dark:divide-slate-800">
        {cameras.map((c) => {
          const part = livePart(c)
          return (
            <li key={c.key} className="py-2 space-y-2">
              {part && <LiveHlsPlayer preview src={`https://customer-${part.cf_customer_code}.cloudflarestream.com/${part.cf_live_input}/manifest/video.m3u8`} />}
              <div className="flex items-center gap-2">
                <div className="flex-1 min-w-0 text-sm font-semibold truncate">{c.label}{streamers[c.no] && <span className="font-normal text-slate-500"> · {streamers[c.no]}</span>}</div>
                <button onClick={() => onApproveCamera(c)} className="flex items-center gap-1 text-xs font-bold px-3 py-1.5 rounded-lg bg-emerald-600 text-white hover:bg-emerald-700">
                  <Eye className="w-3.5 h-3.5" /> אשר והצג
                </button>
              </div>
            </li>
          )
        })}
        {requests.map((r) => (
          <li key={r.id} className="flex items-center gap-2 py-2">
            <div className="flex-1 min-w-0">
              <div className="text-sm font-semibold truncate">{r.name || "משתמש ללא שם"}{r.camera_label && <span className="font-normal text-slate-500"> · {r.camera_label}</span>}</div>
              <div className="text-[11px] text-slate-400"><span dir="ltr">{when(r.updated_at)}</span>{r.attempts > 1 && ` · ${r.attempts} ניסיונות`}</div>
            </div>
            <button onClick={() => onDecide(r.id, true)} className="flex items-center gap-1 text-xs font-bold px-3 py-1.5 rounded-lg bg-emerald-600 text-white hover:bg-emerald-700">
              <Check className="w-3.5 h-3.5" /> אשר
            </button>
            <button onClick={() => onDecide(r.id, false)} className="flex items-center gap-1 text-xs font-bold px-3 py-1.5 rounded-lg bg-slate-100 text-slate-700 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-200">
              <X className="w-3.5 h-3.5" /> דחה
            </button>
            <IconBtn label="מחק בקשה" onClick={() => del(r)}><Trash2 className="w-3.5 h-3.5" /></IconBtn>
          </li>
        ))}
      </ul>
      {decided.length > 0 && (
        <div>
          <button onClick={() => setShowDecided((v) => !v)} className="text-xs font-semibold text-slate-500 hover:text-slate-800 dark:hover:text-slate-200">
            {showDecided ? "הסתר" : "הצג"} בקשות שטופלו ({decided.length})
          </button>
          {showDecided && (
            <ul className="divide-y divide-slate-100 dark:divide-slate-800 mt-1">
              {decided.map((r) => (
                <li key={r.id} className="flex items-center gap-2 py-2">
                  <div className="flex-1 min-w-0 text-sm truncate">{r.name || "משתמש ללא שם"}</div>
                  <span className={`text-[11px] font-bold px-2 py-0.5 rounded-full ${r.status === "approved" ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300" : "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300"}`}>
                    {r.status === "approved" ? "אושר" : "נדחה"}
                  </span>
                  <button onClick={() => onDecide(r.id, r.status !== "approved")} className="text-[11px] font-semibold text-slate-500 hover:text-slate-800 dark:hover:text-slate-200">
                    {r.status === "approved" ? "בטל אישור" : "אשר בכל זאת"}
                  </button>
                  <IconBtn label="מחק בקשה" onClick={() => del(r)}><Trash2 className="w-3.5 h-3.5" /></IconBtn>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </section>
  )
}

// Finished cameras. "Shown on the site" is spelled out — on 2026-10-24 a game's whole
// video vanished because hiding a camera here hid its recordings too, and nothing said so.
function RecordingsSection({ cameras, streamers, durations, onShow, onHide, onDeletePart, onRename }) {
  if (!cameras.length) return null
  const time = (t) => new Date(t).toLocaleTimeString("he-IL", { hour: "2-digit", minute: "2-digit" })
  return (
    <section className="space-y-2">
      <h2 className="flex items-center gap-2 font-bold text-sm"><Film className="w-4 h-4 text-brand" /> הקלטות ({cameras.length})</h2>
      <div className="grid gap-3 sm:grid-cols-2">
        {cameras.map((c) => (
          <div key={c.key} className="card p-3 space-y-2">
            <div className="flex items-center gap-2"><CameraName camera={c} onRename={(l) => onRename(c, l)} /></div>
            {streamers[c.no] && <p className="text-xs text-slate-500 -mt-1">צולם על ידי: {streamers[c.no]}</p>}
            <div className="flex items-center gap-2">
              <span className={`flex-1 text-xs font-bold ${c.hidden ? "text-amber-700 dark:text-amber-400" : "text-emerald-700 dark:text-emerald-400"}`}>
                {c.hidden ? "מוסתר מהאתר — הצופים לא רואים את ההקלטות" : "מוצג באתר"}
              </span>
              {c.hidden ? (
                <button onClick={() => onShow(c)} className="flex items-center gap-1 text-xs font-bold px-3 py-1.5 rounded-lg bg-emerald-600 text-white hover:bg-emerald-700">
                  <Eye className="w-3.5 h-3.5" /> הצג באתר
                </button>
              ) : (
                <button onClick={() => { if (window.confirm(`להסתיר את ההקלטות של ${c.label} מהאתר?`)) onHide(c) }}
                  className="flex items-center gap-1 text-xs font-semibold px-3 py-1.5 rounded-lg bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700">
                  <EyeOff className="w-3.5 h-3.5" /> הסתר מהאתר
                </button>
              )}
            </div>
            <ul className="divide-y divide-slate-100 dark:divide-slate-800">
              {c.parts.map((p, i) => {
                const processing = p.cf_live_input && p.video_id === p.cf_live_input
                const secs = durations[p.video_id]
                return (
                  <li key={p.id} className="flex items-center gap-2 py-1.5 text-sm">
                    <span className="font-semibold">חלק {i + 1}</span>
                    <span className="text-xs text-slate-500" dir="ltr">{time(p.created_at)}</span>
                    <span className="text-xs text-slate-500 flex-1">
                      {processing ? "ההקלטה בעיבוד…" : secs ? <span dir="ltr">{fmtClock(Math.round(secs))}</span> : ""}
                    </span>
                    {!processing && (
                      <IconBtn label="מחק הקלטה" onClick={() => {
                        if (window.confirm(`למחוק את חלק ${i + 1} של ${c.label}? הוא יוסר מהאתר לצמיתות.`)) onDeletePart(p)
                      }}><Trash2 className="w-3.5 h-3.5" /></IconBtn>
                    )}
                  </li>
                )
              })}
            </ul>
          </div>
        ))}
      </div>
    </section>
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

