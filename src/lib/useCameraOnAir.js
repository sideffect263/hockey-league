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
    return watchCameraInput({
      isLive: () => cfInputIsLive(code, video.cf_live_input),
      askReplay: () => requestReplay(video.id),
      setOnAir,
    })
  }, [video?.id, video?.video_id, video?.cf_live_input, onInput, code])

  return onInput ? onAir : false
}

// stream-replay is paced by its own answer, not by the 10s lifecycle tick: every open
// page used to ask it on every off-air tick — 3,533 edge calls from 23 viewers on
// 2026-10-24 alone.
const TICK_MS = 10000
const REPLAY_WAIT_MS = { live: 10000, processing: 20000, none: 60000 }
const REPLAY_DONE = new Set(["ready", "skip"])
const REPLAY_ERROR_MAX_MS = 120000

/**
 * The polling loop behind useCameraOnAir, free of React so it can be tested.
 * Returns a stop function.
 */
export function watchCameraInput({ isLive, askReplay, setOnAir, now = () => Date.now() }) {
  let cancelled = false, timer = null, offCount = 0
  let replayAt = 0, replayDone = false, errorWait = TICK_MS

  const replay = async () => {
    const { state } = (await askReplay()) || {}
    if (REPLAY_DONE.has(state)) { replayDone = true; return }
    if (REPLAY_WAIT_MS[state]) { errorWait = TICK_MS; replayAt = now() + REPLAY_WAIT_MS[state]; return }
    errorWait = Math.min(errorWait * 2, REPLAY_ERROR_MAX_MS)
    replayAt = now() + errorWait
  }

  const check = async () => {
    const live = await isLive()
    if (cancelled) return
    if (live) { offCount = 0; replayAt = 0; setOnAir(true) }
    else if (live === false) {
      offCount += 1
      if (offCount >= 2) setOnAir(false)
      else setOnAir((v) => (v === null ? false : v))
      // Only once it is really off air (a reconnect blip is not a reason), and then
      // at the pace the last answer asked for.
      if (offCount >= 2 && !replayDone && now() >= replayAt) await replay()
    }
    if (!cancelled) timer = setTimeout(check, TICK_MS)
  }

  check()
  return () => { cancelled = true; clearTimeout(timer) }
}
