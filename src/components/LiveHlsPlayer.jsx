import { useEffect, useRef, useState } from "react"
import { Maximize, Minimize, Play, Pause, Volume2, VolumeX } from "lucide-react"
import { Live as Radio } from "@/components/icons/BrandIcons"

// Live player for an app (RTMP) broadcast. Replaces Cloudflare's iframe for the LIVE
// part only: when that player stalled (streamer's uplink hiccup, viewer's weak network)
// it fell behind the live edge and never caught up — viewers watched a frozen or
// minutes-late picture until they refreshed. Here a watchdog does what the refresh did:
// a picture that stops advancing, or drifts too far behind live, jumps back to the edge.
//
// hls.js where the browser has MSE (desktop, Android); the native HLS player on iPhone
// Safari, which has no MSE — the watchdog covers both since it only touches <video>.
// hls.js is loaded on demand so pages without a live broadcast don't pay for it.

const STALL_MS = 6000     // picture frozen this long while "playing" → jump to live
const MAX_BEHIND_S = 20   // further than this behind the live edge → jump to live
const EDGE_OFFSET_S = 4   // where "live" is, behind the newest segment (2s segments)
// Glass-to-glass lag the playlist can't see (phone encode + upload + Cloudflare packaging).
// Only used when the stream carries no wall-clock timestamps (EXT-X-PROGRAM-DATE-TIME).
const INGEST_LAG_MS = 4000

// How far behind real time the picture is, and how we know. With wall-clock timestamps
// in the stream it's measured; without them it's distance-to-edge + INGEST_LAG_MS.
function measureLatency(video, hls) {
  const pdt = hls?.playingDate ?? (() => {
    const start = video.getStartDate?.()
    const t = start?.getTime?.()
    return Number.isFinite(t) && t > 0 ? new Date(t + video.currentTime * 1000) : null
  })()
  if (pdt && Number.isFinite(pdt.getTime())) return { ms: Date.now() - pdt.getTime(), source: "pdt" }
  let behindS = null
  if (hls && Number.isFinite(hls.latency)) behindS = hls.latency
  else {
    const s = video.seekable
    if (s?.length) behindS = Math.max(0, s.end(s.length - 1) - video.currentTime)
  }
  return behindS == null ? null : { ms: behindS * 1000 + INGEST_LAG_MS, source: "edge" }
}

// `children` = overlays drawn over the picture (the score bug). `onLatency({ ms, source })`
// reports the picture's lag every 2s so an overlay can show state as of the same moment.
// `preview` = a small muted tile for the director's multiview: lowest rendition that fits
// the tile (saves the rink's bandwidth when several cameras are on screen), no controls.
// `fsSide` = which top corner the fullscreen button sits in (away from the score bug).
// `muted` = for a tile without its own controls (the multi-view), whose sound button lives
// outside the player. A player with controls starts muted (autoplay) and the viewer unmutes.
export default function LiveHlsPlayer({ src, children, onLatency, preview = false, fsSide = "left", muted = true }) {
  const videoRef = useRef(null)
  const boxRef = useRef(null)
  const [waiting, setWaiting] = useState(true)
  const latencyCb = useRef(onLatency)
  latencyCb.current = onLatency
  // Our own controls, not the browser's: the browser's video fullscreen shows the bare
  // <video> and drops the score/clock overlay, and Safari ignores controlsList, so a viewer
  // saw two fullscreen buttons and one of them lost the score (2026-10-24). Fullscreen is
  // always the whole box. iPhone has no element fullscreen, so there the box fills the
  // screen with CSS instead (rotate the phone for landscape).
  const [paused, setPaused] = useState(false)
  const [soundOff, setSoundOff] = useState(true)
  const [fs, setFs] = useState(false)        // real (Fullscreen API) or CSS ("pseudo")
  const [pseudoFs, setPseudoFs] = useState(false)
  const elementFs = typeof document !== "undefined" && !!(document.fullscreenEnabled || document.webkitFullscreenEnabled)
  const fsElement = () => document.fullscreenElement || document.webkitFullscreenElement
  const toggleFullscreen = () => {
    if (pseudoFs) { setPseudoFs(false); return }
    if (fsElement()) { (document.exitFullscreen || document.webkitExitFullscreen)?.call(document)?.catch?.(() => {}); return }
    const box = boxRef.current
    const req = box && (box.requestFullscreen || box.webkitRequestFullscreen)
    if (elementFs && req) {
      // Refused, or still not full screen a second later (some browsers leave the request
      // hanging): fill the screen with CSS instead. A late real fullscreen takes over.
      let settled = false
      const fallback = () => { if (!settled) { settled = true; if (!fsElement()) setPseudoFs(true) } }
      try { req.call(box)?.catch?.(fallback) } catch { fallback() }
      setTimeout(fallback, 1000)
    } else setPseudoFs(true)
  }
  const togglePlay = () => {
    const v = videoRef.current
    if (!v) return
    if (v.paused) v.play?.().catch(() => {}); else v.pause()
  }
  const toggleSound = () => {
    const v = videoRef.current
    if (!v) return
    v.muted = !v.muted
    if (!v.muted && v.volume === 0) v.volume = 1
  }
  useEffect(() => {
    if (preview) return
    const onFs = () => {
      const on = fsElement() === boxRef.current
      setFs(on)
      if (on) setPseudoFs(false)
    }
    document.addEventListener("fullscreenchange", onFs)
    document.addEventListener("webkitfullscreenchange", onFs)
    return () => {
      document.removeEventListener("fullscreenchange", onFs)
      document.removeEventListener("webkitfullscreenchange", onFs)
    }
  }, [preview])
  // CSS fullscreen: no page scroll behind it, Escape / back-swipe-free exit via the button.
  useEffect(() => {
    if (!pseudoFs) return
    const prev = document.body.style.overflow
    document.body.style.overflow = "hidden"
    const onKey = (e) => { if (e.key === "Escape") setPseudoFs(false) }
    window.addEventListener("keydown", onKey)
    return () => { document.body.style.overflow = prev; window.removeEventListener("keydown", onKey) }
  }, [pseudoFs])

  useEffect(() => {
    const video = videoRef.current
    if (!video || !src) return
    let hls = null
    let cancelled = false
    let restartTimer = null

    const liveEdge = () => {
      if (hls?.liveSyncPosition != null) return hls.liveSyncPosition
      const s = video.seekable
      return s?.length ? Math.max(s.start(s.length - 1), s.end(s.length - 1) - EDGE_OFFSET_S) : null
    }
    const jumpToLive = () => {
      const edge = liveEdge()
      // iPhone native HLS reports its seekable end BEHIND the playhead, so "seek to the
      // edge" would seek backwards into the stall. Reload instead (what a refresh did).
      if (edge == null || !Number.isFinite(edge) || edge <= video.currentTime) {
        if (!hls) video.src = src
      } else video.currentTime = edge
      video.play?.().catch(() => {})
    }

    const start = async () => {
      const nativeHls = video.canPlayType("application/vnd.apple.mpegurl")
      const { default: Hls } = await import("hls.js")
      if (cancelled) return
      if (Hls.isSupported()) {
        hls = new Hls({
          liveSyncDurationCount: 2,        // sit ~2 segments behind the edge
          liveMaxLatencyDurationCount: 6,  // drifted past ~12s → hls.js seeks back itself
          maxLiveSyncPlaybackRate: 1.3,    // …or speeds up slightly to close a small gap
          backBufferLength: 30,
          // A tile starts on the lowest rendition; the main player at ~4 Mbps (≈720p) —
          // hls.js assumes 0.5 Mbps and opened viewers on 240p (2026-10-24).
          ...(preview ? { capLevelToPlayerSize: true, startLevel: 0 } : { abrEwmaDefaultEstimate: 4_000_000 }),
          manifestLoadingMaxRetry: 6,
          levelLoadingMaxRetry: 6,
          fragLoadingMaxRetry: 6,
        })
        hls.on(Hls.Events.ERROR, (_e, data) => {
          if (!data.fatal) return
          console.warn("[live-hls] fatal", data.type, data.details)
          if (data.type === Hls.ErrorTypes.NETWORK_ERROR) hls.startLoad()
          else if (data.type === Hls.ErrorTypes.MEDIA_ERROR) hls.recoverMediaError()
          else {
            // Unrecoverable: rebuild the whole player in a moment.
            hls.destroy(); hls = null
            restartTimer = setTimeout(() => { if (!cancelled) start() }, 3000)
          }
        })
        hls.loadSource(src)
        hls.attachMedia(video)
      } else if (nativeHls) {
        video.src = src
      }
      video.play?.().catch(() => {})
    }
    start()

    // Watchdog — the thing a viewer used to do by refreshing.
    let lastTime = -1, lastMove = Date.now()
    const tick = setInterval(() => {
      if (video.paused && video.readyState > 0) {
        // A tile without controls (multi-view, director's previews) can't be paused by the
        // viewer, so a pause is the browser's (autoplay policy, tab in the background) —
        // resume it. A player with controls was paused on purpose.
        if (preview) video.play?.().catch(() => {})
        return
      }
      const t = video.currentTime
      if (t !== lastTime) { lastTime = t; lastMove = Date.now(); return }
      if (Date.now() - lastMove > STALL_MS) {
        console.warn("[live-hls] stalled — jumping to live")
        lastMove = Date.now()
        if (hls) hls.startLoad()
        jumpToLive()
      }
    }, 1000)
    const behind = setInterval(() => {
      if (video.paused) return
      const edge = liveEdge()
      if (edge != null && edge - video.currentTime > MAX_BEHIND_S) jumpToLive()
    }, 5000)

    // Smoothed, so the overlay doesn't jitter between neighbouring estimates.
    let smooth = null
    const lag = setInterval(() => {
      if (video.paused || video.readyState < 2) return
      const m = measureLatency(video, hls)
      if (!m || m.ms < 0 || m.ms > 120000) return
      smooth = smooth == null ? m.ms : smooth * 0.7 + m.ms * 0.3
      latencyCb.current?.({ ms: Math.round(smooth), source: m.source })
    }, 2000)

    const onPlaying = () => setWaiting(false)
    const onWaiting = () => setWaiting(true)
    const onPlayState = () => setPaused(video.paused)
    const onVolume = () => setSoundOff(video.muted || video.volume === 0)
    video.addEventListener("playing", onPlaying)
    video.addEventListener("waiting", onWaiting)
    video.addEventListener("play", onPlayState)
    video.addEventListener("pause", onPlayState)
    video.addEventListener("volumechange", onVolume)

    return () => {
      cancelled = true
      clearInterval(tick); clearInterval(behind); clearInterval(lag); clearTimeout(restartTimer)
      video.removeEventListener("playing", onPlaying)
      video.removeEventListener("waiting", onWaiting)
      video.removeEventListener("play", onPlayState)
      video.removeEventListener("pause", onPlayState)
      video.removeEventListener("volumechange", onVolume)
      try { hls?.destroy() } catch { /* ignore */ }
      video.removeAttribute("src"); video.load?.()
    }
  }, [src])

  useEffect(() => {
    if (videoRef.current) videoRef.current.muted = muted
  }, [muted])

  const full = fs || pseudoFs
  const btn = "p-1.5 rounded-lg bg-black/50 text-white hover:bg-black/70 transition-colors"
  return (
    <div ref={boxRef}
      className={pseudoFs ? "fixed inset-0 z-[100] bg-black flex items-center justify-center"
        : full ? "w-full h-full bg-black flex items-center justify-center"
        : "relative w-full aspect-video bg-black rounded-xl overflow-hidden"}>
     {/* The picture's own 16:9 frame: score bug and buttons sit on the picture, not on the
         black bars of a portrait phone or a non-16:9 screen. */}
     <div className={`overflow-hidden [container-type:inline-size] ${full
        ? "relative w-full max-h-full aspect-video" : "absolute inset-0"}`}
        style={full ? { maxWidth: "calc(100dvh * 16 / 9)" } : undefined}>
      <video ref={videoRef} autoPlay playsInline muted
        className="absolute inset-0 w-full h-full object-contain bg-black" />
      {children}
      {!preview && (
        <>
          <button onClick={toggleFullscreen} aria-label={full ? "יציאה ממסך מלא" : "מסך מלא"}
            className={`absolute top-[3cqw] ${fsSide === "right" ? "right-[3cqw]" : "left-[3cqw]"} ${btn}`}>
            {full ? <Minimize className="w-4 h-4" /> : <Maximize className="w-4 h-4" />}
          </button>
          <div className="absolute bottom-[3cqw] left-[3cqw] flex items-center gap-1.5" dir="ltr">
            <button onClick={togglePlay} aria-label={paused ? "נגן" : "השהה"} className={btn}>
              {paused ? <Play className="w-4 h-4" /> : <Pause className="w-4 h-4" />}
            </button>
            <button onClick={toggleSound} aria-label={soundOff ? "הפעל קול" : "השתק"} className={btn}>
              {soundOff ? <VolumeX className="w-4 h-4" /> : <Volume2 className="w-4 h-4" />}
            </button>
            <span className="flex items-center gap-1 px-2 py-1 rounded-lg bg-black/50 text-white text-[11px] font-bold">
              <span className="w-1.5 h-1.5 rounded-full bg-red-500" /> LIVE
            </span>
          </div>
        </>
      )}
      {waiting && (
        <div className="pointer-events-none absolute inset-0 grid place-items-center bg-black/40 text-white text-sm">
          <span className="flex items-center gap-2"><Radio className="w-4 h-4 fl-pulse-2 text-red-500" /> מתחבר לשידור…</span>
        </div>
      )}
     </div>
    </div>
  )
}
