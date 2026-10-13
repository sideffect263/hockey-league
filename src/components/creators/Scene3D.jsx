import { useCallback, useEffect, useRef, useState } from "react"
import { ArrowRight, Box, Loader2, Play, Pause, Info } from "lucide-react"
import { getScenes, getScene } from "@/lib/scene3d/scenes"
import { createReplay, EVENT_NAME, SHOT_OUTCOME, whoLabel } from "@/lib/scene3d/replay"
import { loadYouTubeApi } from "@/lib/youtubeApi"

// /creators "שחזור תלת-ממד": a play rebuilt in 3D from the match-stats engine (players + ball in rink metres,
// engine events), next to the game's YouTube video, synced. Scenes come from video-analysis/scene3d/upload_scene.py.
// Loaded lazily from ContentCreators so three.js stays out of every other page's bundle.

const TEAM_NAME = { red: "רמת ישי", blue: "גבעת עדה נוער" }
const TEAM_DOT = { red: "bg-red-500", blue: "bg-blue-500" }
const mmss = (t) => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, "0")}`
const VIEWS = [["real", "מצלמה אמיתית"], ["stand", "יציע"], ["top", "מלמעלה"], ["goal", "מאחורי השער"], ["ball", "עוקב כדור"]]
const SPEEDS = [[0.25, "×¼"], [0.5, "×½"], [1, "×1"]]

export default function Scene3DTab() {
  const [openId, setOpenId] = useState(() => new URLSearchParams(window.location.search).get("scene"))
  const open = (id) => {
    setOpenId(id)
    const u = new URL(window.location.href)
    if (id) u.searchParams.set("scene", id); else u.searchParams.delete("scene")
    window.history.replaceState(null, "", u)
  }
  return openId ? <SceneViewer id={openId} onBack={() => open(null)} /> : <SceneList onOpen={open} />
}

function SceneList({ onOpen }) {
  const [scenes, setScenes] = useState(null)
  const [err, setErr] = useState(null)
  useEffect(() => { getScenes().then(setScenes).catch(e => setErr(e.message || "שגיאה בטעינה")) }, [])
  return (
    <div className="card p-4 space-y-3">
      <div className="flex items-start gap-3">
        <Box className="w-5 h-5 text-brand shrink-0 mt-0.5" />
        <div className="min-w-0">
          <h2 className="font-bold text-slate-900 dark:text-white">שחזור תלת-ממד</h2>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-0.5">
            מהלכים מהמשחק שנבנו מחדש בתלת-ממד מתוך ניתוח הווידאו: כל שחקן והכדור במיקום האמיתי שלהם על המגרש, ליד הסרטון המקורי.
          </p>
        </div>
      </div>
      {err && <p className="text-sm text-red-600">{err}</p>}
      {!scenes && !err && <div className="flex justify-center py-6"><Loader2 className="w-5 h-5 animate-spin text-slate-400" /></div>}
      {scenes?.length === 0 && <p className="text-sm text-slate-500">עדיין אין מהלכים. הם נוצרים עם scene3d/upload_scene.py.</p>}
      <div className="grid sm:grid-cols-2 gap-2">
        {scenes?.map(s => (
          <button key={s.id} onClick={() => onOpen(s.id)} className="text-start rounded-xl border border-slate-200 dark:border-slate-700 p-3 hover:ring-2 hover:ring-brand/40">
            <span className="font-semibold text-sm text-slate-900 dark:text-white block">{s.title}</span>
            <span className="text-xs text-slate-500 dark:text-slate-400">
              <span dir="ltr">{mmss(s.t0)}</span> בסרטון · {Math.round(s.dur)} שניות
              {s.score && <> · {TEAM_NAME.red} {s.score.red}, {TEAM_NAME.blue} {s.score.blue}</>}
            </span>
          </button>
        ))}
      </div>
    </div>
  )
}

function useYouTube(videoId, boxRef) {
  const player = useRef(null)
  const [ready, setReady] = useState(false)
  useEffect(() => {
    if (!videoId) return
    let dead = false
    loadYouTubeApi().then((YT) => {
      if (dead || !boxRef.current) return
      const el = document.createElement("div"); boxRef.current.appendChild(el)
      player.current = new YT.Player(el, {
        videoId, width: "100%", height: "100%",
        playerVars: { rel: 0, modestbranding: 1, playsinline: 1, controls: 1, mute: 1 },
        events: { onReady: () => !dead && setReady(true) },
      })
    })
    return () => { dead = true; try { player.current?.destroy() } catch { /* already gone */ } }
  }, [videoId, boxRef])
  return [player, ready]
}

function SceneViewer({ id, onBack }) {
  const [row, setRow] = useState(null)
  const [err, setErr] = useState(null)
  const [t, setT] = useState(0)
  const [active, setActive] = useState(-1)
  const [playing, setPlaying] = useState(false)
  const [speed, setSpeed] = useState(1)
  const [view, setView] = useState("real")
  const [showMeta, setShowMeta] = useState(false)
  const [tags, setTags] = useState(true)
  const stageRef = useRef(null)
  const ytBox = useRef(null)
  const eng = useRef(null)
  const listRef = useRef(null)

  useEffect(() => { getScene(id).then(setRow).catch(e => setErr(e.message || "שגיאה בטעינה")) }, [id])
  const [yt, ytReady] = useYouTube(row?.youtube_id, ytBox)

  // The 3D engine. While playing, the YouTube player is the clock (when it is actually playing), so the two stay
  // together through buffering; otherwise the engine keeps its own time.
  useEffect(() => {
    if (!row || !stageRef.current) return
    const t0 = row.t0
    const e = createReplay({
      container: stageRef.current, scene: row.scene,
      onTick: (tt, ai) => { setT(tt); setActive(ai) },
      clock: () => {
        const p = yt.current
        if (!p?.getPlayerState) return null
        const st = p.getPlayerState()
        if (st === 1) return Math.max(0, p.getCurrentTime() - t0)
        if (st === 3) return e.state.t                 // buffering: hold
        return null
      },
    })
    e.onLoop = () => { try { yt.current?.seekTo(t0, true) } catch { /* not ready */ } }
    eng.current = e
    setView(e.hasRealCamera ? "real" : "stand")
    return () => { e.dispose(); eng.current = null }
  }, [row, yt])

  const ytCall = (fn) => { const p = yt.current; if (ytReady && p) try { fn(p) } catch { /* player not ready */ } }
  const doPlay = useCallback((on) => {
    const e = eng.current; if (!e || !row) return
    setPlaying(on)
    if (on) { e.play(); ytCall(p => { p.seekTo(row.t0 + e.state.t, true); p.setPlaybackRate(e.state.speed); p.playVideo() }) }
    else { e.pause(); ytCall(p => p.pauseVideo()) }
  }, [row, ytReady]) // eslint-disable-line react-hooks/exhaustive-deps
  const seek = (s, play) => {
    const e = eng.current; if (!e || !row) return
    e.seek(s); setT(s); ytCall(p => p.seekTo(row.t0 + s, true))
    if (play) doPlay(true)
  }
  const pickSpeed = (s) => { setSpeed(s); eng.current?.setSpeed(s); ytCall(p => p.setPlaybackRate(s)) }
  const pickView = (v) => { setView(v); eng.current?.setView(v) }

  useEffect(() => {
    const li = listRef.current?.querySelector(`[data-i="${active}"]`)
    li?.scrollIntoView({ block: "nearest" })
  }, [active])

  if (err) return <div className="card p-4"><BackBtn onBack={onBack} /><p className="text-sm text-red-600 mt-2">{err}</p></div>
  if (!row) return <div className="card p-6 flex justify-center"><Loader2 className="w-5 h-5 animate-spin text-slate-400" /></div>
  const S = row.scene, dur = row.dur

  return (
    <div className="space-y-3">
      <div className="card p-3 flex flex-wrap items-center gap-3">
        <BackBtn onBack={onBack} />
        <div className="min-w-0">
          <h2 className="font-bold text-slate-900 dark:text-white">{row.title}</h2>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            רמת ישי – גבעת עדה נוער · מחצית {(S.half ?? 0) + 1} · <span dir="ltr">{mmss(row.t0)}–{mmss(row.t0 + dur)}</span> בסרטון
          </p>
        </div>
        {row.score && (
          <div className="ms-auto flex rounded-lg overflow-hidden border border-slate-200 dark:border-slate-700 text-sm font-bold">
            <span className="px-2.5 py-1 bg-red-500/15 text-slate-900 dark:text-white">{TEAM_NAME.red} {row.score.red}</span>
            <span className="px-2.5 py-1 bg-blue-500/15 text-slate-900 dark:text-white">{row.score.blue} {TEAM_NAME.blue}</span>
            <span className="px-2.5 py-1 font-mono font-medium text-slate-500 dark:text-slate-400" dir="ltr">{mmss(row.t0 + t)}</span>
          </div>
        )}
      </div>

      <div className="grid lg:grid-cols-[minmax(0,1fr)_320px] gap-3">
        <div className="card overflow-hidden p-0">
          <div ref={stageRef} className="relative w-full aspect-[4/3] sm:aspect-[16/10] bg-[#0b1220]">
            <div className="absolute top-2 start-2 z-10 flex flex-wrap gap-1.5">
              <button onClick={() => { setTags(!tags); eng.current?.setTags(!tags) }} aria-pressed={tags}
                className={`px-3 py-1 rounded-full text-xs font-semibold border backdrop-blur ${tags ? "bg-white text-slate-900 border-white" : "bg-slate-900/70 text-white border-slate-600"}`}>
                שמות
              </button>
              {VIEWS.filter(([v]) => v !== "real" || row.scene.camera?.path?.length).map(([v, label]) => (
                <button key={v} onClick={() => pickView(v)} aria-pressed={view === v}
                  className={`px-3 py-1 rounded-full text-xs font-semibold border backdrop-blur ${view === v ? "bg-white text-slate-900 border-white" : "bg-slate-900/70 text-white border-slate-600"}`}>
                  {label}
                </button>
              ))}
            </div>
            <div className="absolute bottom-2 start-2 z-10 flex flex-wrap gap-3 text-[11px] text-slate-300 bg-slate-950/60 rounded-md px-2 py-1">
              <span className="flex items-center gap-1"><i className="w-2 h-2 rounded-full bg-red-500" />{TEAM_NAME.red}</span>
              <span className="flex items-center gap-1"><i className="w-2 h-2 rounded-full bg-blue-500" />{TEAM_NAME.blue}</span>
              <span className="flex items-center gap-1"><i className="w-2 h-2 rounded-full bg-orange-500" />שופט</span>
              <span className="flex items-center gap-1"><i className="w-2 h-2 rounded-full border-2 border-[#d9b45a]" />כדור</span>
              <span>שקוף = מחוץ לפריים</span>
              <span>{row.scene.players.some(p => p.pose?.length) ? "תנוחות גוף מהווידאו" : "תנועת החלקה מחושבת"}</span>
            </div>
          </div>
          <div className="p-3 space-y-2 border-t border-slate-200 dark:border-slate-700">
            <div className="flex flex-wrap items-center gap-2">
              <button onClick={() => doPlay(!playing)} className="btn-primary px-3 py-1.5 text-sm flex items-center gap-1.5 min-w-[84px] justify-center">
                {playing ? <><Pause className="w-4 h-4" /> עצור</> : <><Play className="w-4 h-4" /> נגן</>}
              </button>
              {SPEEDS.map(([s, label]) => (
                <button key={s} onClick={() => pickSpeed(s)} aria-pressed={speed === s}
                  className={`px-2.5 py-1 rounded-full text-xs font-semibold border ${speed === s ? "bg-slate-900 text-white border-slate-900 dark:bg-white dark:text-slate-900 dark:border-white" : "border-slate-300 dark:border-slate-600 text-slate-700 dark:text-slate-300"}`}>
                  {label}
                </button>
              ))}
              <span className="ms-auto font-mono text-xs text-slate-500 tabular-nums" dir="ltr">{t.toFixed(1)} / {dur.toFixed(1)} s</span>
            </div>
            <div className="relative h-7" dir="ltr">
              <input type="range" min={0} max={dur} step={0.01} value={t} aria-label="זמן במהלך"
                onChange={(ev) => seek(+ev.target.value)} className="absolute inset-x-0 top-2 w-full accent-[#d9b45a]" />
              {S.events.map((e, i) => (
                <i key={i} className={`absolute top-0 rounded-sm pointer-events-none ${e.type === "shot" ? "w-1 h-3 bg-[#d9b45a]" : `w-0.5 h-2 ${TEAM_DOT[e.team] || "bg-slate-400"}`}`}
                  style={{ left: `${(e.t / dur) * 100}%` }} />
              ))}
            </div>
          </div>
        </div>

        <div className="space-y-3 min-w-0">
          <div className="card p-2">
            <div ref={ytBox} className="w-full aspect-video rounded-lg overflow-hidden bg-black [&>iframe]:w-full [&>iframe]:h-full" />
            <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-1.5 px-1">הסרטון המקורי, מסונכרן לשחזור (מושתק, אפשר להפעיל קול בנגן)</p>
          </div>
          <div className="card p-2">
            <h3 className="text-sm font-bold text-slate-900 dark:text-white px-2 pt-1 pb-2">מה המנוע ראה</h3>
            <ol ref={listRef} className="max-h-72 overflow-y-auto space-y-0.5">
              {S.events.map((e, i) => (
                <li key={i} data-i={i}>
                  <button onClick={() => seek(Math.max(0, e.t - 1.5), true)}
                    className={`w-full text-start grid grid-cols-[42px_1fr] gap-2 items-baseline px-2 py-1.5 rounded-md border-s-2 ${i === active ? "bg-amber-100/60 dark:bg-amber-400/10 border-[#d9b45a]" : "border-transparent hover:bg-slate-100 dark:hover:bg-slate-800"}`}>
                    <span className="font-mono text-[11px] text-slate-500 tabular-nums" dir="ltr">{mmss(row.t0 + e.t)}</span>
                    <span className="text-sm text-slate-900 dark:text-white">
                      <i className={`inline-block w-2 h-2 rounded-full me-1.5 ${TEAM_DOT[e.team] || "bg-slate-400"}`} />
                      <b className="font-semibold">{EVENT_NAME[e.type] || e.type}</b>{" "}
                      <span className="text-xs text-slate-500 dark:text-slate-400">
                        {whoLabel(e) || TEAM_NAME[e.team] || ""}
                        {e.type === "shot" && <> · {SHOT_OUTCOME[e.outcome] || e.outcome} · {e.dist} מ׳{e.speed ? ` · ${e.speed} קמ״ש` : ""}</>}
                        {e.type !== "shot" && e.len ? ` · ${e.len} מ׳` : ""}
                      </span>
                    </span>
                  </button>
                </li>
              ))}
            </ol>
          </div>
        </div>
      </div>

      <div className="card p-3">
        <button onClick={() => setShowMeta(v => !v)} aria-expanded={showMeta} className="flex items-center gap-2 text-sm font-bold text-slate-900 dark:text-white">
          <Info className="w-4 h-4 text-brand" /> מקור הנתונים — מודלים, וידאו וכיול
        </button>
        {showMeta && <MetaPanel meta={row.meta} />}
      </div>
    </div>
  )
}

function BackBtn({ onBack }) {
  return (
    <button onClick={onBack} className="flex items-center gap-1 text-sm text-slate-600 dark:text-slate-300 hover:text-brand">
      <ArrowRight className="w-4 h-4" /> כל המהלכים
    </button>
  )
}

function MetaPanel({ meta }) {
  if (!meta) return <p className="text-sm text-slate-500 mt-2">אין פרטים על המקור למהלך הזה.</p>
  const v = meta.video || {}, c = meta.calibration || {}, en = meta.engine || {}, sc = meta.scene || {}
  const rows = [
    ["וידאו", `${v.source} · ${v.width}×${v.height} · ${v.fps} פריימים לשנייה · ${v.codec}`],
    ["קצב הניתוח", `${v.analysed_fps} פריימים לשנייה (כל פריים שני)`],
    ["מצלמה", v.camera],
    ["זיהוי שחקנים", `${en.players?.model} · רזולוציה ${en.players?.imgsz} · סף ${en.players?.conf} · קבוצה לפי ${en.players?.team}`],
    ["זיהוי כדור", `${(en.ball?.models || []).join(" + ")} · בודק ${en.ball?.checker} · ${en.ball?.training}`],
    ["מעבר זיהוי", `${en.detect?.name} · ${en.detect?.run_on} · ${en.detect?.date}`],
    ["מצלמה ← מגרש", `${en.camera?.name}: ${en.camera?.method}`],
    ["כיול המגרש", `סט ${String(c.set).slice(0, 8)} · ${c.points} נקודות · שגיאה ${c.rms_m} מ׳ (חציון ${c.median_err_m}) · מגרש ${c.rink_m?.join("×")} מ׳ · גובה מצלמה ${c.cam_height_m} מ׳`],
    ["מעקב שחקנים", `${en.tracking?.name}: ${en.tracking?.method}`],
    ["אירועים", en.events?.name],
    ...(en.pose ? [["תנוחת גוף", `${en.pose.model} · ${en.pose.lift} · ${en.pose.lift_test}`]] : []),
    ["במהלך הזה", `${sc.players_tracks} קטעי מעקב · ${sc.ball_samples} דגימות כדור (${sc.ball_filled} מילוי בין זיהויים) · ${sc.events} אירועים`
      + (sc.pose_samples ? ` · ${sc.pose_samples} תנוחות גוף ב-${sc.pose_tracks} קטעים` : " · אין עדיין תנוחות גוף (תנועת החלקה מחושבת)")],
  ]
  return (
    <div className="mt-3 space-y-3">
      <dl className="grid sm:grid-cols-[130px_minmax(0,1fr)] gap-x-4 gap-y-1.5 text-sm">
        {rows.map(([k, val]) => (
          <div key={k} className="contents">
            <dt className="text-slate-500 dark:text-slate-400">{k}</dt>
            <dd className="text-slate-900 dark:text-white break-words" dir="auto">{val}</dd>
          </div>
        ))}
      </dl>
      <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed">
        מצלמה אחת שמסתובבת: מי שמחוץ לפריים נעלם (או שקוף לרגע). הכדור מצויר על הרצפה, בלי גובה.
        המעקב מתפצל לפעמים, ושחקן אחד יכול להופיע כמה קטעים ברצף.
      </p>
    </div>
  )
}
