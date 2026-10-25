import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"

vi.mock("@/lib/video", () => ({ cfInputIsLive: vi.fn(), requestReplay: vi.fn() }))
const { watchCameraInput } = await import("./useCameraOnAir")

// Runs the loop for `seconds` of simulated time with a scripted lifecycle + replay.
async function simulate({ seconds, live, replayStates }) {
  const calls = []
  let replayN = 0
  const stop = watchCameraInput({
    isLive: async () => (typeof live === "function" ? live(Date.now()) : live),
    askReplay: async () => {
      const state = replayStates[Math.min(replayN++, replayStates.length - 1)]
      calls.push({ at: Date.now() / 1000, state })
      return { state }
    },
    setOnAir: () => {},
  })
  for (let t = 0; t < seconds; t++) await vi.advanceTimersByTimeAsync(1000)
  stop()
  return calls
}

describe("watchCameraInput — stream-replay pacing", () => {
  beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(0) })
  afterEach(() => vi.useRealTimers())

  it("never asks while the broadcast is on air", async () => {
    const calls = await simulate({ seconds: 600, live: true, replayStates: ["processing"] })
    expect(calls).toHaveLength(0)
  })

  it("waits for two off-air ticks before the first ask", async () => {
    const calls = await simulate({ seconds: 15, live: false, replayStates: ["processing"] })
    expect(calls.map((c) => c.at)).toEqual([10])
  })

  it("stops after ready", async () => {
    const calls = await simulate({ seconds: 600, live: false, replayStates: ["processing", "processing", "ready"] })
    expect(calls.map((c) => c.state)).toEqual(["processing", "processing", "ready"])
  })

  it("asks every ~20s while processing, every ~60s while there is no recording", async () => {
    const processing = await simulate({ seconds: 300, live: false, replayStates: ["processing"] })
    vi.setSystemTime(0)
    const none = await simulate({ seconds: 300, live: false, replayStates: ["none"] })
    // The old loop asked on every 10s tick: ~30 times in 5 minutes.
    expect(processing.length).toBeLessThanOrEqual(15)
    expect(none.length).toBeLessThanOrEqual(5)
  })

  it("backs off on errors, capped at 2 minutes", async () => {
    const calls = await simulate({ seconds: 900, live: false, replayStates: ["error"] })
    const gaps = calls.slice(1).map((c, i) => c.at - calls[i].at)
    expect(gaps.slice(0, 3)).toEqual([20, 40, 80])
    expect(Math.max(...gaps)).toBeLessThanOrEqual(130)
  })

  it("going back on air resets the wait", async () => {
    // off 0-60s, on 60-120s, off again after
    const live = (ms) => ms >= 60000 && ms < 120000
    const calls = await simulate({ seconds: 200, live, replayStates: ["none"] })
    expect(calls.some((c) => c.at >= 120 && c.at <= 140)).toBe(true)
  })
})
