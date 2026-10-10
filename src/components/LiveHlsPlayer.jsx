import { useEffect, useRef, useState } from "react"
import { Radio, Maximize } from "lucide-react"

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
export default function LiveHlsPlayer({ src, children, onLatency }) {
  const videoRef = useRef(null)
  const boxRef = useRef(null)
  const [waiting, setWaiting] = useState(true)
  const latencyCb = useRef(onLatency)
  latencyCb.current = onLatency
  // Fullscreen the whole box, not the <video>: the browser's own video fullscreen shows
  // the bare element and drops the overlay. iPhone has no element fullscreen → keep the
  // native control there.
  const canBoxFullscreen = typeof document !== "undefined" && !!document.fullscreenEnabled
  const toggleFullscreen = () => {
    if (document.fullscreenElement) document.exitFullscreen?.().catch(() => {})
    else boxRef.current?.requestFullscreen?.().catch(() => {})
  }

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
      if (video.paused && video.readyState > 0) return // viewer paused on purpose
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
    video.addEventListener("playing", onPlaying)
    video.addEventListener("waiting", onWaiting)

    return () => {
      cancelled = true
      clearInterval(tick); clearInterval(behind); clearInterval(lag); clearTimeout(restartTimer)
      video.removeEventListener("playing", onPlaying)
      video.removeEventListener("waiting", onWaiting)
      try { hls?.destroy() } catch { /* ignore */ }
      video.removeAttribute("src"); video.load?.()
    }
  }, [src])

  return (
    <div ref={boxRef} className="relative w-full aspect-video bg-black rounded-xl overflow-hidden [container-type:inline-size]">
      <video ref={videoRef} autoPlay playsInline muted controls
        controlsList={canBoxFullscreen ? "nofullscreen" : undefined}
        className="absolute inset-0 w-full h-full object-contain bg-black" />
      {children}
      {canBoxFullscreen && (
        <button onClick={toggleFullscreen} aria-label="מסך מלא"
          className="absolute top-[3cqw] left-[3cqw] p-1.5 rounded-lg bg-black/50 text-white hover:bg-black/70 transition-colors">
          <Maximize className="w-4 h-4" />
        </button>
      )}
      {waiting && (
        <div className="pointer-events-none absolute inset-0 grid place-items-center bg-black/40 text-white text-sm">
          <span className="flex items-center gap-2"><Radio className="w-4 h-4 animate-pulse text-red-500" /> מתחבר לשידור…</span>
        </div>
      )}
    </div>
  )
}
