import { useEffect, useState } from "react"
import { cfInputIsLive, requestReplay } from "@/lib/video"

// Is an app (RTMP) broadcast row on air right now? true / false / null (not known yet).
//
// Only meaningful while the row still points at its live input; a swapped row is a
// recording (returns false). Polls Cloudflare's lifecycle every 10s, needs two misses in a
// row before calling a broadcast off air (a short reconnect on the streamer's side
// shouldn't tear down every viewer's player), and while off air asks stream-replay to swap
// the row to its recording — the realtime subscription reloads the row once that's done.
// Used by the game page's player and by the director's control room.
export function useCameraOnAir(video) {
  const [onAir, setOnAir] = useState(null)
  const onInput = !!video?.cf_live_input && video.video_id === video.cf_live_input
  const code = video?.cf_customer_code

  useEffect(() => {
    setOnAir(null)
    if (!onInput || !code) return
    let cancelled = false, timer = null, offCount = 0
    const check = async () => {
      const live = await cfInputIsLive(code, video.cf_live_input)
      if (cancelled) return
      if (live) { offCount = 0; setOnAir(true) }
      else if (live === false) {
        offCount += 1
        if (offCount >= 2) setOnAir(false)
        else setOnAir((v) => (v === null ? false : v))
        await requestReplay(video.id)
      }
      if (!cancelled) timer = setTimeout(check, 10000)
    }
    check()
    return () => { cancelled = true; clearTimeout(timer) }
  }, [video?.id, video?.video_id, video?.cf_live_input, onInput, code])

  return onInput ? onAir : false
}
