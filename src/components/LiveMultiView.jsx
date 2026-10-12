import { useRef, useState } from "react"
import { Maximize, Volume2, VolumeX } from "lucide-react"
import LiveHlsPlayer from "@/components/LiveHlsPlayer"
import { useCameraOnAir } from "@/lib/useCameraOnAir"

// Several live cameras on one screen, laid out the way the director chose in the control
// room (game_broadcast.layout). Nothing is mixed on a server: this page plays each camera
// itself. The FIRST tile is the main (program) camera — the score overlay (`children`)
// sits on it, its sound is the one the sound button controls, its lag drives `onLatency`.
//
//   pip  — main full size, the second camera inset in the bottom corner away from the score
//   side — main and the second camera side by side
//   grid — 2x2, main top-right (RTL reading order) + up to three more
//
// Every tile plays the lowest rendition that fits its size (LiveHlsPlayer `preview`), so a
// viewer on mobile data pays for one picture's worth of pixels, not one per camera, except
// the main tile in pip, which is full size.
//
// `tiles` = [{ key, label, src }], main first; only cameras on air (see useLiveTiles).
export default function LiveMultiView({ layout, tiles, children, onLatency, overlayPosition = "top-right" }) {
  const boxRef = useRef(null)
  const [muted, setMuted] = useState(true)
  const canFs = typeof document !== "undefined" && !!document.fullscreenEnabled
  const toggleFs = () => {
    if (document.fullscreenElement) document.exitFullscreen?.().catch(() => {})
    else boxRef.current?.requestFullscreen?.().catch(() => {})
  }
  const [main, ...extras] = tiles
  if (!main) return null
  // Buttons go in the top corner the score bug doesn't use.
  const side = overlayPosition === "top-left" ? "right" : "left"
  const controls = (
    <div className={`absolute top-[3cqw] ${side === "right" ? "right-[3cqw]" : "left-[3cqw]"} flex gap-1.5 z-10`}>
      <button onClick={() => setMuted(!muted)} aria-label={muted ? "הפעל קול" : "השתק"}
        className="p-1.5 rounded-lg bg-black/50 text-white hover:bg-black/70 transition-colors">
        {muted ? <VolumeX className="w-4 h-4" /> : <Volume2 className="w-4 h-4" />}
      </button>
      {canFs && (
        <button onClick={toggleFs} aria-label="מסך מלא"
          className="p-1.5 rounded-lg bg-black/50 text-white hover:bg-black/70 transition-colors">
          <Maximize className="w-4 h-4" />
        </button>
      )}
    </div>
  )
  const label = (t) => (
    <span className="pointer-events-none absolute bottom-1 right-1 px-1.5 py-0.5 rounded bg-black/55 text-white text-[10px] font-semibold">
      {t.label}
    </span>
  )

  if (layout === "pip" && extras[0]) {
    // The inset sits in the bottom corner on the same side as the buttons (away from the
    // score bug, clear of nothing important on a wide rink shot).
    return (
      <div ref={boxRef} className="relative w-full aspect-video bg-black rounded-xl overflow-hidden [container-type:inline-size]">
        <LiveHlsPlayer preview src={main.src} onLatency={onLatency} muted={muted} />
        <div className="absolute inset-0 pointer-events-none">{children}</div>
        <div className={`absolute bottom-[3cqw] ${side === "right" ? "right-[3cqw]" : "left-[3cqw]"} w-[32%] rounded-lg overflow-hidden ring-2 ring-white/80 shadow-xl`}>
          <LiveHlsPlayer preview src={extras[0].src} />
          {label(extras[0])}
        </div>
        {controls}
      </div>
    )
  }

  const shown = layout === "side" ? [main, extras[0]].filter(Boolean)
    : layout === "grid" ? [main, ...extras.slice(0, 3)] : [main]
  const cols = shown.length > 1 ? "grid-cols-2" : "grid-cols-1"
  return (
    <div ref={boxRef} className="relative w-full aspect-video bg-black rounded-xl overflow-hidden [container-type:inline-size]">
      <div className={`absolute inset-0 grid ${cols} ${layout === "grid" && shown.length > 2 ? "grid-rows-2" : ""} gap-[0.5cqw] content-center`}>
        {shown.map((t, i) => (
          <div key={t.key} className="relative min-h-0 grid place-items-center">
            <div className="relative w-full">
              <LiveHlsPlayer preview src={t.src} onLatency={i === 0 ? onLatency : undefined} muted={i === 0 ? muted : true} />
              {shown.length > 1 && label(t)}
            </div>
          </div>
        ))}
      </div>
      <div className="absolute inset-0 pointer-events-none">{children}</div>
      {controls}
    </div>
  )
}

// The cameras of a multi-view that are on air right now, as tiles: `cameras` = groupCameras
// entries, main first (at most 4 — hooks are called a fixed number of times). A camera that
// isn't broadcasting drops out; if the main one isn't, there's no multi-view (null).
export function useLiveTiles(cameras) {
  const list = [0, 1, 2, 3].map((i) => cameras[i] || null)
  const parts = list.map((c) => (c ? c.parts[c.parts.length - 1] : null))
  const live = [
    useCameraOnAir(parts[0]), useCameraOnAir(parts[1]), useCameraOnAir(parts[2]), useCameraOnAir(parts[3]),
  ]
  if (!live[0]) return null
  return list.flatMap((c, i) => {
    const p = parts[i]
    if (!c || !live[i] || !p?.cf_customer_code) return []
    return [{ key: c.key, label: c.label, src: `https://customer-${p.cf_customer_code}.cloudflarestream.com/${p.cf_live_input}/manifest/video.m3u8` }]
  })
}
