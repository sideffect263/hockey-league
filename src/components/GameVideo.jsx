import { useState, useEffect, useRef, useCallback } from "react"
import { loadYouTubeApi } from "@/lib/youtubeApi"
import { Link } from "react-router-dom"
import { motion } from "framer-motion"
import { Video, Radio, Trash2, ExternalLink, Tag, Camera, Eye, Stethoscope } from "lucide-react"
import { useAuth } from "@/lib/AuthContext"
import { useStreamViewers } from "@/lib/useStreamViewers"
import {
  getGameVideos, isLiveRow, detachVideo, addMarker, deleteMarker,
  subscribeGameVideo, fmtClock, getViewerIceServersDetailed, requestReplay, cfInputIsLive, groupCameras,
} from "@/lib/video"
import LiveHlsPlayer from "@/components/LiveHlsPlayer"
import ScoreOverlay from "@/components/ScoreOverlay"
import { playWHEP, hasTurn } from "@/lib/whep"

// Marker kinds → Hebrew label + emoji + pill colour (reuses the StatPills palette).
const KINDS = {
  goal:      { he: "גול",   emoji: "⚽", cls: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300", dot: "bg-emerald-500" },
  penalty:   { he: "עונשין", emoji: "🟥", cls: "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300", dot: "bg-red-500" },
  period:    { he: "תקופה",  emoji: "⏱", cls: "bg-indigo-100 text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-300", dot: "bg-indigo-500" },
  save:      { he: "הצלה",   emoji: "🧤", cls: "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300", dot: "bg-blue-500" },
  highlight: { he: "שיא",    emoji: "⭐", cls: "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300", dot: "bg-amber-500" },
  other:     { he: "אחר",    emoji: "📍", cls: "bg-slate-100 text-slate-600 dark:bg-slate-700 dark:text-slate-300", dot: "bg-slate-400" },
}

// ---- YouTube IFrame API: load the script once, resolve when window.YT is ready.
// Embedded player. YT replaces a child node with an iframe, so we keep a stable
// host div and append/clear a child around it — safe across videoId changes.
function YouTubePlayer({ videoId, onReady }) {
  const hostRef = useRef(null)
  useEffect(() => {
    let cancelled = false, player = null
    loadYouTubeApi().then((YT) => {
      if (cancelled || !hostRef.current) return
      const el = document.createElement("div")
      hostRef.current.appendChild(el)
      player = new YT.Player(el, {
        videoId,
        width: "100%", height: "100%",
        playerVars: { rel: 0, modestbranding: 1, playsinline: 1 },
        events: { onReady: () => onReady?.(player) },
      })
    }).catch(() => {})
    return () => {
      cancelled = true
      try { player?.destroy?.() } catch { /* ignore */ }
      if (hostRef.current) hostRef.current.innerHTML = ""
    }
  }, [videoId])
  return (
    <div className="relative w-full aspect-video bg-black rounded-xl overflow-hidden">
      <div ref={hostRef} className="absolute inset-0" />
    </div>
  )
}

// Player for an app (RTMP) broadcast. Cloudflare records these and serves HLS on any
// network — none of the WHEP/TURN machinery below is needed.
//
// A row still pointing at its live input is either on air or a finished broadcast whose
// recording isn't swapped in yet. Cloudflare's lifecycle endpoint tells which:
//  - on air  → LiveHlsPlayer (our own player, so a stall jumps back to live by itself)
//  - off air → never embed the input: Cloudflare's player shows "Stream has not started"
//    for an idle input, which read as "part 1 was never recorded" on 2026-10-10. Show
//    our own message and keep asking the server to swap in the recording.
// A swapped row is a plain recording → Cloudflare's iframe.
function RtmpPlayer({ video, gameId, home, away }) {
  const { isAdmin } = useAuth()
  const [latency, setLatency] = useState(null) // { ms, source } from the live player
  const [onAir, setOnAir] = useState(null) // null = not known yet
  const onInput = !!video.cf_live_input && video.video_id === video.cf_live_input
  const code = video.cf_customer_code

  useEffect(() => {
    if (!onInput || !code) return
    let cancelled = false, timer = null, offCount = 0
    const check = async () => {
      const live = await cfInputIsLive(code, video.cf_live_input)
      if (cancelled) return
      if (live) { offCount = 0; setOnAir(true) }
      else {
        // Two misses in a row before leaving the live player — a short reconnect on the
        // streamer's side shouldn't tear down every viewer's player.
        offCount += 1
        if (live === false && offCount >= 2) setOnAir(false)
        else if (live === false) setOnAir((v) => (v === null ? false : v))
        // Off air: ask for the swap. The realtime subscription reloads the row once done.
        if (live === false) await requestReplay(video.id)
      }
      if (!cancelled) timer = setTimeout(check, 10000)
    }
    check()
    return () => { cancelled = true; clearTimeout(timer) }
  }, [video.id, video.video_id, video.cf_live_input, onInput, code])

  if (!code) return null
  if (onInput) {
    if (onAir) {
      return (
        <div className="space-y-1">
          <LiveHlsPlayer src={`https://customer-${code}.cloudflarestream.com/${video.cf_live_input}/manifest/video.m3u8`} onLatency={setLatency}>
            <ScoreOverlay gameId={gameId} home={home} away={away} latencyMs={latency?.ms ?? 0} />
          </LiveHlsPlayer>
          {/* Admin calibration readout: how far the overlay is held back, and whether the
              stream's own timestamps measured it ("pdt") or it's estimated ("edge"). */}
          {isAdmin && latency && (
            <p className="text-[11px] text-slate-400" dir="ltr">overlay delay {(latency.ms / 1000).toFixed(1)}s · {latency.source}</p>
          )}
        </div>
      )
    }
    return (
      <div className="w-full aspect-video bg-black rounded-xl grid place-items-center text-slate-300 text-sm text-center px-4">
        {onAir === null ? "טוען שידור…" : "השידור לא פעיל כרגע. אם הוא הסתיים, ההקלטה תופיע כאן בעוד כמה דקות."}
      </div>
    )
  }
  const src = `https://customer-${code}.cloudflarestream.com/${video.video_id}/iframe?preload=auto`
  return (
    <div className="relative w-full aspect-video bg-black rounded-xl overflow-hidden">
      <iframe src={src} className="absolute inset-0 w-full h-full border-0" title="וידאו מהמשחק"
        allow="accelerometer; gyroscope; autoplay; encrypted-media; picture-in-picture;" allowFullScreen />
    </div>
  )
}

// Spectator player for a Cloudflare Stream live input.
//
// While LIVE we play via WHEP (WebRTC) with OUR TURN relay — Cloudflare produces
// no HLS for browser-published live, and its built-in player does WHEP without
// TURN, so viewers on strict/mobile networks get a black spinner. Our WHEP+TURN
// path works on any network (proven with a relay-only connection). For the
// recorded REPLAY (not live) Cloudflare serves HLS, so the standard iframe is
// fine and universal — we also fall back to it if the live WHEP can't connect
// (e.g. the broadcast already ended).
function CloudflarePlayer({ video, isLive }) {
  const { isAdmin } = useAuth()
  const code = video.cf_customer_code
  const videoRef = useRef(null)
  const sessionRef = useRef(null)
  const [mode, setMode] = useState("whep") // always try the live WHEP+TURN path first
  const [status, setStatus] = useState("connecting") // connecting | playing
  // Last WHEP attempt's diagnostic — rendered for admins only, but recorded for
  // every viewer (and logged) so a failure on someone else's network leaves a trace.
  const [diag, setDiag] = useState(null)

  // Re-attempt the live path when the stream/liveness changes. We deliberately do
  // NOT gate WHEP on game.status (it can be stale) — we just try WHEP, and fall
  // back to the iframe (recording) only if there's no live broadcast to receive.
  useEffect(() => { setMode("whep") }, [video.video_id, isLive])

  useEffect(() => {
    if (mode !== "whep" || !code) return
    let cancelled = false
    let retryTimer = null
    let attempts = 0
    // RELAY FIRST. Measured on real viewer devices: the direct path completes ICE
    // *and* DTLS and then carries zero RTP — the network passes the small STUN
    // probes and drops the media. ICE never re-picks a pair it has already called
    // succeeded, so it strands itself there. The relay path delivered on every
    // device we tested, so it leads and the direct path is the fallback (it only
    // ever saved TURN bandwidth, which is worthless if nobody can watch).
    let useRelay = true
    const maxAttempts = isLive ? 15 : 3 // live: ride out startup; VOD: fail fast to the recording
    setStatus("connecting")
    const tryPlay = async () => {
      const ice = await getViewerIceServersDetailed()
      if (cancelled) return
      // No TURN in the list (turn-creds failed) — relay-only would gather nothing,
      // so fall through to unrestricted rather than guaranteeing failure.
      const policy = useRelay && hasTurn(ice.iceServers) ? "relay" : null
      try {
        const playUrl = `https://customer-${code}.cloudflarestream.com/${video.video_id}/webRTC/play`
        const session = await playWHEP(playUrl, ice.iceServers, videoRef.current, { policy })
        if (cancelled) { session.stop(); return }
        sessionRef.current = session
        setStatus("playing")
        setDiag({ ok: true, attempt: attempts + 1, ice, ...session.diag })
      } catch (e) {
        if (cancelled) return
        // The broadcast may not be live yet (Cloudflare 409 "not started"), or a
        // transient hiccup — retry for ~35s before giving up to the recording.
        attempts += 1
        const rec = { ok: false, attempt: attempts, ice, ...(e?.diag || {}), error: String(e?.message || e) }
        setDiag(rec)
        // Never swallow this: a viewer who can't watch used to leave no trace at
        // all, which made "works here, black screen there" impossible to diagnose.
        console.warn("[stream] WHEP attempt failed", rec)
        // Alternate routes between attempts, but only for routing-shaped failures.
        // A 409 means the broadcast simply isn't serving yet — switching route
        // would just thrash while we wait for the streamer to come up.
        if (rec.stage === "media" || rec.stage === "connect" || rec.stage === "ice-gather") useRelay = !useRelay
        if (attempts < maxAttempts) retryTimer = setTimeout(tryPlay, 3000)
        else setMode("iframe")
      }
    }
    tryPlay()
    return () => {
      cancelled = true
      clearTimeout(retryTimer) // else up to 15 retries keep firing ICE fetches after unmount
      sessionRef.current?.stop?.(); sessionRef.current = null
    }
  }, [mode, code, video.video_id, isLive])

  if (!code) {
    return (
      <div className="w-full aspect-video bg-black rounded-xl grid place-items-center text-slate-400 text-sm">
        השידור נטען…
      </div>
    )
  }

  const src = `https://customer-${code}.cloudflarestream.com/${video.video_id}/iframe?autoplay=true&muted=true&preload=auto`
  const player = mode === "iframe" ? (
    <div className="relative w-full aspect-video bg-black rounded-xl overflow-hidden">
      <iframe src={src} className="absolute inset-0 w-full h-full border-0" title="שידור"
        allow="accelerometer; gyroscope; autoplay; encrypted-media; picture-in-picture;" allowFullScreen />
    </div>
  ) : (
    <div className="relative w-full aspect-video bg-black rounded-xl overflow-hidden">
      <video ref={videoRef} autoPlay playsInline muted controls className="absolute inset-0 w-full h-full object-contain bg-black" />
      {status === "connecting" && (
        <div className="absolute inset-0 grid place-items-center bg-black/60 text-white text-sm">
          <span className="flex items-center gap-2"><Radio className="w-4 h-4 animate-pulse text-red-500" /> מתחבר לשידור…</span>
        </div>
      )}
    </div>
  )

  return (
    <div className="space-y-3">
      {player}
      {isAdmin && <StreamDiag diag={diag} mode={mode} isLive={isLive} />}
    </div>
  )
}

// Admin-only readout of the last WHEP attempt. Spectators see nothing — this is
// here so whoever runs the league can tell, on the failing device itself, WHICH
// leg broke: the TURN fetch, ICE gathering, the Cloudflare POST, or the connect.
function StreamDiag({ diag, mode, isLive }) {
  const [open, setOpen] = useState(false)
  if (!diag) return null

  // A one-line verdict, because the raw numbers only help once you know where to look.
  let verdict
  if (diag.ok) {
    const via = diag.selectedPair?.local?.startsWith("relay") ? "דרך TURN relay" : "בחיבור ישיר"
    verdict = `מחובר ${via}`
  } else if (diag.ice?.error) verdict = "כשל בשליפת TURN — הנגן רץ על STUN בלבד"
  else if (!diag.hasTurn) verdict = "אין TURN ברשימת ה-ICE — הנגן רץ על STUN בלבד"
  else if (diag.stage === "whep-post" && diag.whepStatus === 409) verdict = "Cloudflare עדיין לא מקבל מדיה (409) — השידור לא התחיל או הסתיים"
  else if (diag.stage === "whep-post") verdict = `הבקשה ל-Cloudflare נכשלה (${diag.whepStatus || "network"})`
  else if (diag.stage === "media") verdict = `${diag.policy === "relay" ? "relay" : "מסלול ישיר"} התחבר אך לא העביר מדיה — מנסים במסלול השני`
  else if (diag.stage === "connect") verdict = (diag.types?.relay ? "ICE נכשל למרות relay זמין" : "ICE נכשל ולא נאסף relay — הרשת חוסמת את TURN")
  else verdict = `כשל בשלב ${diag.stage || "?"}`

  const rows = [
    ["שלב", diag.stage || "—"],
    ["ניסיון", diag.attempt],
    ["turn-creds", diag.ice?.error ? `שגיאה: ${diag.ice.error}` : `תקין (${diag.ice?.ms}ms)`],
    ["TURN ברשימה", diag.hasTurn ? "כן" : "לא"],
    ["מועמדי ICE", Object.entries(diag.types || {}).map(([k, v]) => `${k}:${v}`).join(" ") || "—"],
    ["מעבר relay", diag.relayTransports?.length ? diag.relayTransports.join(", ") : "—"],
    ["איסוף ICE", diag.gatherMs != null ? `${diag.gatherMs}ms ${diag.gatherComplete ? "(הושלם)" : "(נקטע)"}` : "—"],
    ["WHEP POST", diag.whepStatus != null ? `${diag.whepStatus} (${diag.whepMs}ms)` : "—"],
    ["זוג נבחר", diag.selectedPair ? `${diag.selectedPair.local} ← ${diag.selectedPair.remote}` : "—"],
    ["מדיה", diag.receiving == null ? "—" : diag.receiving ? `כן (${diag.inbound?.video?.bytes} bytes)` : "0 bytes"],
    ["מסלול", diag.policy === "relay" ? "relay (ברירת מחדל)" : "ישיר (גיבוי)"],
    ["שגיאה", diag.error || "—"],
  ]

  return (
    <div className={`rounded-xl border text-xs ${diag.ok
      ? "border-emerald-200 dark:border-emerald-900/50 bg-emerald-50/50 dark:bg-emerald-900/10"
      : "border-amber-200 dark:border-amber-900/50 bg-amber-50/50 dark:bg-amber-900/10"}`}>
      <button onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center gap-2 px-3 py-2 text-right font-semibold text-slate-700 dark:text-slate-200">
        <Stethoscope className="w-3.5 h-3.5 shrink-0" />
        <span className="flex-1">אבחון שידור: {verdict}</span>
        <span className="text-slate-400">{open ? "−" : "+"}</span>
      </button>
      {open && (
        <div className="px-3 pb-3 space-y-1">
          {rows.map(([k, v]) => (
            <div key={k} className="flex gap-2">
              <span className="text-slate-500 dark:text-slate-400 w-24 shrink-0">{k}</span>
              <span dir="ltr" className="font-mono text-slate-800 dark:text-slate-200 break-all text-left flex-1">{String(v)}</span>
            </div>
          ))}
          {mode === "iframe" && isLive && (
            <p className="text-amber-700 dark:text-amber-400 pt-1">
              הנגן נפל ל-iframe. לשידור חי מהדפדפן אין HLS, כך שה-iframe לא יציג תמונה.
            </p>
          )}
          <Link to="/stream-debug" className="inline-block pt-1 text-brand font-semibold hover:underline">
            פתח אבחון מלא ←
          </Link>
        </div>
      )}
    </div>
  )
}

// מצלמה 1 / מצלמה 2 … — one pill per camera (angle) of the game; a camera on air right
// now is marked live. Fans pick their angle here; parts of that camera sit below.
function CameraTabs({ cameras, selected, onSelect }) {
  return (
    <div className="flex gap-1.5 overflow-x-auto pb-1 -mx-1 px-1" role="tablist" aria-label="מצלמות">
      {cameras.map((c) => {
        const on = c.key === selected?.key
        return (
          <button key={c.key} role="tab" aria-selected={on} onClick={() => onSelect(c)}
            className={`shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-bold transition-colors ${on
              ? "bg-slate-900 text-white dark:bg-white dark:text-slate-900"
              : "bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700"}`}>
            <Camera className="w-3.5 h-3.5" />
            {c.label}
            {c.live && <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse" aria-label="בשידור חי" />}
          </button>
        )
      })}
    </div>
  )
}

// חלק 1 / חלק 2 … — one pill per part of the selected camera, in recording order (the
// streamer restarted, or a long drop split the recording). The part on air right now is
// marked live. A titled video shows its title and doesn't take a part number.
function PartTabs({ videos, selected, onSelect }) {
  let part = 0
  return (
    <div className="flex gap-1.5 overflow-x-auto pb-1 -mx-1 px-1" role="tablist" aria-label="חלקי הווידאו">
      {videos.map((v) => {
        const on = v.id === selected?.id
        const label = v.title || `חלק ${++part}`
        return (
          <button key={v.id} role="tab" aria-selected={on} onClick={() => onSelect(v)}
            className={`shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${on
              ? "bg-brand text-white"
              : "bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700"}`}>
            {isLiveRow(v) && <Radio className={`w-3.5 h-3.5 ${on ? "" : "text-red-500"} animate-pulse`} />}
            {label}
          </button>
        )
      })}
    </div>
  )
}

export default function GameVideo({ game, home, away, players = [] }) {
  const { isAdmin, isContentEditor } = useAuth()
  // All of the game's videos, oldest first, grouped into cameras (angles) → parts.
  const [videos, setVideos] = useState([])
  const [cameraKey, setCameraKey] = useState(null)
  const [selectedId, setSelectedId] = useState(null)
  const [loading, setLoading] = useState(true)
  const [player, setPlayer] = useState(null)
  const [duration, setDuration] = useState(0)

  const gameId = game?.id
  const isLive = game?.status === "in_progress"
  // Default camera: one on air right now, else a full-game YouTube upload, else the first.
  // Default part of a camera: its live part, else part 1.
  const cameras = groupCameras(videos)
  const camera = cameras.find(c => c.key === cameraKey)
    || [...cameras].reverse().find(c => c.live)
    || cameras.find(c => c.parts.some(v => v.provider === "youtube" && v.kind === "full"))
    || cameras[0] || null
  const parts = camera?.parts || []
  const video = parts.find(v => v.id === selectedId) || [...parts].reverse().find(isLiveRow) || parts[0] || null
  // Removing a video is for content creators (content_editor) + admin — mirrors the
  // can_stream_game() backend gate. Going live is the apps' job now (RTMP); the web
  // camera broadcast was retired before Cloudflare began billing WebRTC (2026-10-15).
  const canStream = isContentEditor || isAdmin
  const canMark = isAdmin || isContentEditor

  // Live viewer count via Realtime Presence — active while a Cloudflare live
  // stream is on this page.
  const streamActive = video?.provider === "cloudflare" && isLive
  const viewers = useStreamViewers(gameId, streamActive, true)

  const load = useCallback(async () => {
    if (!gameId) return
    try {
      const all = await getGameVideos(gameId)
      setVideos(all)
      // Keep the viewer on the camera/part they picked; drop a pick that no longer exists.
      setSelectedId(id => (all.some(v => v.id === id) ? id : null))
      setCameraKey(k => (groupCameras(all).some(c => c.key === k) ? k : null))
    }
    catch (e) { console.error(e) }
    finally { setLoading(false) }
  }, [gameId])

  useEffect(() => { load() }, [load])

  // Live auto-appear: when the streamer attaches a video, spectators already on
  // the page see it without reloading.
  useEffect(() => {
    if (!gameId) return
    return subscribeGameVideo(gameId, load)
  }, [gameId, load])

  const onPlayerReady = (p) => {
    setPlayer(p)
    try { setDuration(p.getDuration?.() || 0) } catch { /* live: unknown */ }
  }
  const seek = (sec) => {
    if (!player) return
    try { player.seekTo(sec, true); player.playVideo?.() } catch { /* ignore */ }
  }

  if (loading) return null
  if (!video) return null

  return (
    <motion.div id="video" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="card overflow-hidden scroll-mt-20">
      <div className="px-5 py-4 border-b border-slate-100 dark:border-slate-700 flex items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 font-bold text-sm text-slate-900 dark:text-white">
          {isLive && camera?.live
            ? <span className="flex items-center gap-1.5 text-red-600 dark:text-red-400"><Radio className="w-4 h-4 animate-pulse" /> שידור חי</span>
            : <><Video className="w-4 h-4 text-orange-500" /> וידאו מהמשחק</>}
          {streamActive && (
            <span className="flex items-center gap-1 text-xs font-medium text-slate-500 dark:text-slate-400" title="צופים בשידור">
              <Eye className="w-3.5 h-3.5" /> {viewers}
            </span>
          )}
        </h2>
        {video && canStream && (
          <button onClick={onDetach(video, load)}
            className="flex items-center gap-1 text-xs text-slate-400 hover:text-red-500 transition-colors">
            <Trash2 className="w-3.5 h-3.5" /> הסר
          </button>
        )}
      </div>

      <div className="p-4 sm:p-5 space-y-4">
        <>
            {cameras.length > 1 && (
              <CameraTabs cameras={cameras} selected={camera}
                onSelect={(c) => { setCameraKey(c.key); setSelectedId(null); setPlayer(null); setDuration(0) }} />
            )}
            {parts.length > 1 && (
              <PartTabs videos={parts} selected={video} onSelect={(v) => { setSelectedId(v.id); setPlayer(null); setDuration(0) }} />
            )}
            {video.provider === "cloudflare"
              ? (video.ingest === "rtmp"
                  ? <RtmpPlayer key={video.id} video={video} gameId={gameId} home={home} away={away} />
                  : <CloudflarePlayer key={video.id} video={video} isLive={isLive} />)
              : <YouTubePlayer key={video.id} videoId={video.video_id} onReady={onPlayerReady} />}

            {/* Proportional marker strip (hidden for live / unknown duration) */}
            {duration > 0 && video.markers.length > 0 && (
              <div className="relative h-2.5 rounded-full bg-slate-100 dark:bg-slate-800" dir="ltr">
                {video.markers.map((m) => (
                  <button key={m.id} onClick={() => seek(m.video_seconds)}
                    title={`${KINDS[m.kind]?.he || m.kind} · ${fmtClock(m.video_seconds)}`}
                    style={{ left: `${Math.min(100, (m.video_seconds / duration) * 100)}%` }}
                    className={`absolute top-1/2 -translate-y-1/2 -translate-x-1/2 w-3 h-3 rounded-full ring-2 ring-white dark:ring-slate-900 ${KINDS[m.kind]?.dot || "bg-slate-400"} hover:scale-125 transition-transform`} />
                ))}
              </div>
            )}

            {/* Chapter list — click to seek */}
            {video.markers.length > 0 && (
              <div className="space-y-0.5">
                {video.markers.map((m) => (
                  <div key={m.id} className="flex items-center gap-2 group">
                    <button onClick={() => seek(m.video_seconds)}
                      className="flex-1 flex items-center gap-2.5 py-1.5 px-2 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors text-right">
                      <span dir="ltr" className="text-xs font-bold tabular-nums text-orange-500 shrink-0 w-12 text-left">{fmtClock(m.video_seconds)}</span>
                      <span className={`stat-pill !py-0 !px-1.5 shrink-0 ${KINDS[m.kind]?.cls}`}>{KINDS[m.kind]?.emoji} {KINDS[m.kind]?.he}</span>
                      <span className="text-sm text-slate-700 dark:text-slate-300 truncate">{m.label || ""}</span>
                    </button>
                    {canMark && (
                      <button onClick={onDeleteMarker(m.id, load)}
                        className="opacity-0 group-hover:opacity-100 p-1 text-slate-300 hover:text-red-500 transition-all shrink-0">
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                ))}
              </div>
            )}

            {canMark && (
              <MarkerForm player={player} videoRef={video.id} home={home} away={away} players={players} onAdded={load} />
            )}

            {video.provider !== "cloudflare" && (
              <a href={`https://www.youtube.com/watch?v=${video.video_id}`} target="_blank" rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-xs text-slate-400 hover:text-orange-500 transition-colors">
                <ExternalLink className="w-3 h-3" /> פתח ב-YouTube
              </a>
            )}
        </>
      </div>
    </motion.div>
  )
}

// ---- editor/streamer action handlers (curried so JSX stays flat) ------------
const onDetach = (video, reload) => async () => {
  if (!confirm("להסיר את הווידאו מהמשחק?")) return
  try { await detachVideo(video.id); reload() } catch (e) { alert(e.message) }
}
const onDeleteMarker = (id, reload) => async () => {
  try { await deleteMarker(id); reload() } catch (e) { alert(e.message) }
}
// Editor tool: capture the player's current time and tag it as a marker.
function MarkerForm({ player, videoRef, home, away, players, onAdded }) {
  const [open, setOpen] = useState(false)
  const [at, setAt] = useState(0)
  const [kind, setKind] = useState("goal")
  const [label, setLabel] = useState("")
  const [playerId, setPlayerId] = useState("")
  const [busy, setBusy] = useState(false)

  const teamIds = [home?.id, away?.id].filter(Boolean)
  const roster = players.filter((p) => teamIds.includes(p.team_id))

  const capture = () => {
    if (!player) return
    try { setAt(Math.round(player.getCurrentTime?.() || 0)) } catch { /* ignore */ }
    setOpen(true)
  }

  const submit = async (e) => {
    e.preventDefault()
    try {
      setBusy(true)
      const p = roster.find((r) => r.id === playerId)
      await addMarker(videoRef, {
        videoSeconds: at, kind,
        label: label || (p ? `${p.first_name} ${p.last_name}` : null),
        playerId: playerId || null, teamId: p?.team_id || null,
      })
      setLabel(""); setPlayerId(""); setOpen(false); onAdded()
    } catch (e2) { alert(e2.message) } finally { setBusy(false) }
  }

  if (!open) {
    return (
      <button onClick={capture} disabled={!player}
        className="flex items-center gap-1.5 text-xs font-semibold text-orange-600 dark:text-orange-400 hover:text-orange-700 disabled:opacity-50 transition-colors">
        <Tag className="w-3.5 h-3.5" /> סמן את המיקום הנוכחי
      </button>
    )
  }

  return (
    <form onSubmit={submit} className="rounded-xl border border-slate-200 dark:border-slate-700 p-3 space-y-2.5">
      <div className="flex items-center gap-2 text-sm">
        <span className="text-slate-500 dark:text-slate-400">בזמן</span>
        <span dir="ltr" className="font-bold tabular-nums text-orange-500">{fmtClock(at)}</span>
      </div>
      <div className="flex gap-2">
        <select value={kind} onChange={(e) => setKind(e.target.value)} className="filter-input text-sm flex-1">
          {Object.entries(KINDS).map(([k, v]) => <option key={k} value={k}>{v.emoji} {v.he}</option>)}
        </select>
        <select value={playerId} onChange={(e) => setPlayerId(e.target.value)} className="filter-input text-sm flex-1">
          <option value="">— ללא שחקן —</option>
          {roster.map((p) => <option key={p.id} value={p.id}>{p.first_name} {p.last_name}</option>)}
        </select>
      </div>
      <input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="תיאור (רשות)" className="filter-input w-full text-sm" />
      <div className="flex gap-2">
        <button type="submit" disabled={busy}
          className="flex-1 py-2 rounded-lg bg-orange-500 text-white text-sm font-semibold hover:bg-orange-600 disabled:opacity-60 transition-colors">
          {busy ? "שומר..." : "הוסף סימון"}
        </button>
        <button type="button" onClick={() => setOpen(false)}
          className="px-4 py-2 rounded-lg bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 text-sm font-semibold hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors">
          ביטול
        </button>
      </div>
    </form>
  )
}
