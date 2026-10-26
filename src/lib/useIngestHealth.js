import { useEffect, useState } from "react"

// Is each live camera's video reaching Cloudflare in real time? (2026-10-25)
//
// The control room looked normal on 2026-10-24 while one phone delivered a sixth of real
// time and another nothing at all. Cloudflare's live playlist tells us: every 2-second
// segment that arrives bumps EXT-X-MEDIA-SEQUENCE. Over a 20 s window a healthy camera
// adds ~10; well under that is a slow uplink, none at all is a stalled one. Read from the
// public HLS playlist, so it needs no app change; viewers' players do the same requests.
//
// `cams` = [{ no, code, input }] of cameras on air. Returns { [no]: "ok" | "slow" | "stalled" }
// (missing = not measured yet).
const SEG_S = 2
const WINDOW_MS = 20000
const POLL_MS = 10000

async function mediaSequence(code, input) {
  const base = `https://customer-${code}.cloudflarestream.com/${input}/manifest`
  const master = await fetch(`${base}/video.m3u8`, { cache: "no-store" }).then((r) => (r.ok ? r.text() : ""))
  const variant = master.split("\n").find((l) => l && !l.startsWith("#"))
  if (!variant) return null
  const pl = await fetch(`${base}/${variant.trim()}`, { cache: "no-store" }).then((r) => (r.ok ? r.text() : ""))
  const m = pl.match(/#EXT-X-MEDIA-SEQUENCE:(\d+)/)
  return m ? Number(m[1]) : null
}

export function useIngestHealth(cams) {
  const [health, setHealth] = useState({})
  const key = cams.map((c) => `${c.no}:${c.input}`).join(",")
  useEffect(() => {
    if (!cams.length) { setHealth({}); return }
    let alive = true
    const samples = {} // no -> [{ t, seq }]
    const tick = async () => {
      const next = {}
      await Promise.all(cams.map(async (c) => {
        const seq = await mediaSequence(c.code, c.input).catch(() => null)
        if (seq == null) return
        const now = Date.now()
        const list = (samples[c.no] = [...(samples[c.no] || []), { t: now, seq }].filter((s) => now - s.t <= WINDOW_MS + POLL_MS))
        const first = list[0]
        if (now - first.t < WINDOW_MS - 1000) return // not enough history yet
        const realS = (now - first.t) / 1000
        const gotS = (seq - first.seq) * SEG_S
        next[c.no] = gotS <= 0 ? "stalled" : gotS / realS < 0.7 ? "slow" : "ok"
      }))
      if (alive) setHealth((h) => ({ ...Object.fromEntries(Object.entries(h).filter(([no]) => cams.some((c) => String(c.no) === no))), ...next }))
    }
    tick()
    const timer = setInterval(tick, POLL_MS)
    return () => { alive = false; clearInterval(timer) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])
  return health
}
