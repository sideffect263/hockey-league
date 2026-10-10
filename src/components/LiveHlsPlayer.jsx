import { useEffect, useRef, useState } from "react"
import { Radio } from "lucide-react"

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

export default function LiveHlsPlayer({ src }) {
  const videoRef = useRef(null)
  const [waiting, setWaiting] = useState(true)

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
      if (edge != null && Number.isFinite(edge)) video.currentTime = edge
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

    const onPlaying = () => setWaiting(false)
    const onWaiting = () => setWaiting(true)
    video.addEventListener("playing", onPlaying)
    video.addEventListener("waiting", onWaiting)

    return () => {
      cancelled = true
      clearInterval(tick); clearInterval(behind); clearTimeout(restartTimer)
      video.removeEventListener("playing", onPlaying)
      video.removeEventListener("waiting", onWaiting)
      try { hls?.destroy() } catch { /* ignore */ }
      video.removeAttribute("src"); video.load?.()
    }
  }, [src])

  return (
    <div className="relative w-full aspect-video bg-black rounded-xl overflow-hidden">
      <video ref={videoRef} autoPlay playsInline muted controls
        className="absolute inset-0 w-full h-full object-contain bg-black" />
      {waiting && (
        <div className="pointer-events-none absolute inset-0 grid place-items-center bg-black/40 text-white text-sm">
          <span className="flex items-center gap-2"><Radio className="w-4 h-4 animate-pulse text-red-500" /> מתחבר לשידור…</span>
        </div>
      )}
    </div>
  )
}
