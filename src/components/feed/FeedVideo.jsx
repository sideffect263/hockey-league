import { useEffect, useRef, useState, useCallback } from "react"
import { Volume2, VolumeX, Play } from "lucide-react"
import { loadYouTubeApi } from "@/lib/youtubeApi"

// Cloudflare Stream's player SDK: wraps the Stream iframe in a media-element-like object
// (play() / pause() / muted), so our own uploads get the same on-screen autoplay rules.
let streamSdk = null
function loadStreamSdk() {
  if (streamSdk) return streamSdk
  streamSdk = new Promise((resolve, reject) => {
    if (window.Stream) return resolve(window.Stream)
    const s = document.createElement("script")
    s.src = "https://embed.cloudflarestream.com/embed/sdk.latest.js"
    s.async = true
    s.onload = () => (window.Stream ? resolve(window.Stream) : reject(new Error("no Stream")))
    s.onerror = () => { streamSdk = null; reject(new Error("stream sdk failed")) }
    document.head.appendChild(s)
  })
  return streamSdk
}

export const streamPoster = (cfCode, uid) =>
  `https://customer-${cfCode}.cloudflarestream.com/${uid}/thumbnails/thumbnail.jpg?time=2s&height=720`

/**
 * Feed video card — autoplays muted while it is on screen, pauses when it isn't.
 *
 * Three rules make this behave rather than turn the feed into a wall of noise:
 *
 *  1. ONE AT A TIME. A module-level registry holds the single card allowed to
 *     play; whichever card most recently became sufficiently visible claims it
 *     and pauses the previous one. Without this, three cards in a tall viewport
 *     all play at once.
 *  2. MUTED, ALWAYS, until the viewer asks otherwise. Browsers block unmuted
 *     autoplay outright, so an unmuted attempt doesn't play loudly — it just
 *     silently fails to start. Tapping the card unmutes it.
 *  3. NOTHING LOADS UNTIL IT IS NEEDED. The player is only constructed the first
 *     time the card comes near the viewport; before that it's a poster image.
 *     Mounting six YouTube iframes on feed load is a lot of megabytes for videos
 *     nobody scrolled to.
 *
 * Opted out entirely for `prefers-reduced-motion` and for browsers asking to
 * save data — those get the poster and a normal tap-to-play.
 */

// The one card currently allowed to play. Module-level so cards don't need to
// know about each other (and so it survives re-renders).
let activeCard = null
function claimPlayback(card) {
  if (activeCard && activeCard !== card) activeCard.yield()
  activeCard = card
}
function releasePlayback(card) {
  if (activeCard === card) activeCard = null
}

function prefersNoAutoplay() {
  if (typeof window === "undefined") return true
  const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches
  const saveData = navigator.connection?.saveData
  return !!(reduced || saveData)
}

/**
 * provider "youtube" (default): videoId = YouTube id.
 * provider "cloudflare": videoId = Stream uid, cfCode = account subdomain code, ratio =
 * width/height of the clip (a 9:16 clip shows in a 4:5 box, letterboxed, like Instagram).
 */
export default function FeedVideo({ videoId, poster, title, provider = "youtube", cfCode, ratio }) {
  const isStream = provider === "cloudflare"
  const hostRef = useRef(null)      // stable wrapper; YT replaces the child node
  const playerRef = useRef(null)
  const wrapRef = useRef(null)      // observed for visibility
  const [started, setStarted] = useState(false)   // player has been constructed
  const [muted, setMuted] = useState(true)
  const [posterError, setPosterError] = useState(false)
  const [manual] = useState(prefersNoAutoplay)

  // Identity for the registry — stable across renders.
  const cardRef = useRef(null)
  if (!cardRef.current) {
    cardRef.current = {
      yield: () => { try { const p = playerRef.current; p?.pauseVideo ? p.pauseVideo() : p?.pause?.() } catch { /* ignore */ } },
    }
  }

  const play = useCallback(() => {
    claimPlayback(cardRef.current)
    try { const p = playerRef.current; isStream ? p?.play?.()?.catch?.(() => {}) : p?.playVideo?.() } catch { /* ignore */ }
  }, [isStream])

  const pause = useCallback(() => {
    releasePlayback(cardRef.current)
    try { const p = playerRef.current; isStream ? p?.pause?.() : p?.pauseVideo?.() } catch { /* ignore */ }
  }, [isStream])

  // Our own uploads: the Stream iframe, driven through the SDK.
  useEffect(() => {
    if (!started || !isStream) return
    let cancelled = false
    const iframe = document.createElement("iframe")
    iframe.src = `https://customer-${cfCode}.cloudflarestream.com/${videoId}/iframe?muted=true&autoplay=true&preload=auto&controls=true`
    iframe.allow = "accelerometer; gyroscope; autoplay; encrypted-media; picture-in-picture; fullscreen"
    iframe.allowFullscreen = true
    iframe.title = title || "וידאו"
    iframe.className = "absolute inset-0 w-full h-full border-0"
    hostRef.current?.appendChild(iframe)
    loadStreamSdk().then((Stream) => {
      if (cancelled) return
      const p = Stream(iframe)
      playerRef.current = p
      p.muted = true
      if (activeCard === cardRef.current) p.play()?.catch?.(() => {})
    }).catch(() => {})
    return () => {
      cancelled = true
      releasePlayback(cardRef.current)
      playerRef.current = null
      if (hostRef.current) hostRef.current.innerHTML = ""
    }
  }, [started, isStream, videoId, cfCode, title])

  // Build the player the first time we're asked to start.
  useEffect(() => {
    if (!started || isStream) return
    let cancelled = false
    loadYouTubeApi().then((YT) => {
      if (cancelled || !hostRef.current) return
      const el = document.createElement("div")
      hostRef.current.appendChild(el)
      playerRef.current = new YT.Player(el, {
        videoId,
        width: "100%", height: "100%",
        // mute:1 is what makes autoplay legal; playsinline keeps iOS from going
        // fullscreen the moment it starts.
        playerVars: { rel: 0, modestbranding: 1, playsinline: 1, mute: 1, autoplay: 1, controls: 1 },
        events: {
          onReady: (e) => {
            try { e.target.mute() } catch { /* ignore */ }
            // Only actually start if we're still the visible card by the time the
            // API finished loading — the viewer may have scrolled well past.
            if (activeCard === cardRef.current) { try { e.target.playVideo() } catch { /* ignore */ } }
          },
        },
      })
    }).catch(() => {})
    return () => {
      cancelled = true
      releasePlayback(cardRef.current)
      try { playerRef.current?.destroy?.() } catch { /* ignore */ }
      playerRef.current = null
      if (hostRef.current) hostRef.current.innerHTML = ""
    }
  }, [started, videoId, isStream])

  // Visibility → play/pause. 60% keeps a card that's half off the bottom quiet.
  useEffect(() => {
    if (manual || !wrapRef.current) return
    const node = wrapRef.current
    const io = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting && entry.intersectionRatio >= 0.6) {
          claimPlayback(cardRef.current)
          if (!playerRef.current) setStarted(true)   // first time: construct it
          else play()
        } else {
          pause()
        }
      }
    }, { threshold: [0, 0.6, 1] })
    io.observe(node)
    return () => io.disconnect()
  }, [manual, play, pause])

  // A backgrounded tab shouldn't keep a video running.
  useEffect(() => {
    const onVis = () => { if (document.hidden) pause() }
    document.addEventListener("visibilitychange", onVis)
    return () => document.removeEventListener("visibilitychange", onVis)
  }, [pause])

  const toggleMute = (e) => {
    e.stopPropagation()
    const p = playerRef.current
    if (!p) return
    try {
      if (isStream) p.muted = !muted
      else if (muted) { p.unMute(); p.setVolume?.(100) } else { p.mute() }
      setMuted(!muted)
    } catch { /* ignore */ }
  }

  return (
    <div ref={wrapRef} className="relative rounded-xl overflow-hidden bg-black"
         style={{ aspectRatio: isStream && ratio ? String(Math.min(1.91, Math.max(0.8, ratio))) : "16 / 9" }}>
      {started ? (
        <>
          <div ref={hostRef} className="absolute inset-0" />
          <button
            type="button" onClick={toggleMute}
            aria-label={muted ? "הפעלת הקול" : "השתקה"}
            title={muted ? "הפעלת הקול" : "השתקה"}
            className="absolute top-2 end-2 z-10 w-9 h-9 rounded-full bg-black/60 hover:bg-black/80 text-white flex items-center justify-center transition-colors"
          >
            {muted ? <VolumeX className="w-4 h-4" /> : <Volume2 className="w-4 h-4" />}
          </button>
        </>
      ) : (
        <button type="button" onClick={() => { claimPlayback(cardRef.current); setStarted(true) }}
                aria-label="נגן את הסרטון" className="group absolute inset-0 w-full h-full">
          {poster && !posterError ? (
            <img src={poster} alt="" loading="lazy" onError={() => setPosterError(true)}
                 className={`w-full h-full ${isStream ? "object-contain" : "object-cover"}`} />
          ) : (
            <div className="w-full h-full bg-slate-800" />
          )}
          <span className="absolute inset-0 flex items-center justify-center bg-black/20 group-hover:bg-black/10 transition-colors">
            <span className="w-14 h-14 rounded-full bg-black/65 group-hover:bg-brand transition-colors flex items-center justify-center shadow-lg">
              <Play className="w-6 h-6 text-white fill-current ms-0.5" />
            </span>
          </span>
          <span className="sr-only">{title}</span>
        </button>
      )}
    </div>
  )
}
