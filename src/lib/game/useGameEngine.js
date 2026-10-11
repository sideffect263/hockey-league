import { useRef, useEffect, useSyncExternalStore } from 'react'
import { GameEngine } from './engine'
import { getLiveGame } from '../live'

const LS = (id) => `judge-engine-${id}`
const SAVE_EVERY_MS = 1000

// Games whose result has been persisted to the DB. A throttled write must never
// resurrect the draft of a game that was already finished and saved.
const finished = new Set()

/**
 * React binding for the GameEngine. Instantiates one engine per game (mapping the
 * DB home/away teams onto the engine's home/guest), restores any localStorage
 * draft, drives a ~20fps tick while the clock/break is live, and re-renders on
 * every engine change. Persists a draft (at most once a second) so a refresh
 * mid-game loses nothing.
 *
 * If this browser has NO local draft but the game is still live on the server
 * (the judge officiated from another device, or storage was cleared), it
 * rehydrates the engine from the last broadcast snapshot instead of starting
 * fresh — otherwise the next tap would reset a match the whole league is watching.
 */
export function useGameEngine(game, home, guest) {
  const ref = useRef(null)
  const hadDraft = useRef(false)
  if (!ref.current) {
    const e = new GameEngine({ homeName: home?.name || 'בית', guestName: guest?.name || 'חוץ' })
    try {
      const raw = localStorage.getItem(LS(game.id))
      if (raw) { e.restore(JSON.parse(raw)); hadDraft.current = true }
    } catch { /* ignore */ }
    ref.current = e
  }
  const engine = ref.current

  const version = useSyncExternalStore(
    (cb) => engine.subscribe(cb),
    () => engine.version,
    () => engine.version,
  )

  // Persist a draft, at most once a second. The engine bumps `version` on every 50ms
  // tick, and serializing the whole match 20×/sec janks the live scoreboard for no
  // durability gain — a trailing write keeps the saved clock within one second of live.
  // A pristine (never-touched) board is never persisted, so an opened-but-unused tab
  // can't leave behind a stale draft that blocks a later server-snapshot recovery.
  const save = useRef({ at: 0, timer: null })
  // A pristine board normally writes nothing — EXCEPT when a draft already exists: that
  // means the judge just reset the board, and the old draft must be overwritten, or a
  // reload resurrects the game that was reset. (Overwritten, not removed: with no draft,
  // a reload would recover the old match from the server's live snapshot instead.)
  const persist = () => {
    if (finished.has(game.id)) return
    try {
      if (engine.isPristine() && localStorage.getItem(LS(game.id)) == null) return
      localStorage.setItem(LS(game.id), JSON.stringify(engine.serialize()))
    } catch { /* ignore */ }
  }
  const write = () => {
    save.current.at = Date.now()
    save.current.timer = null
    persist()
  }

  // tick loop (20fps) — only advances while the clock/break is live
  useEffect(() => {
    const iv = setInterval(() => { if (engine.needsTicking()) engine.tick() }, 50)
    return () => clearInterval(iv)
  }, [engine])

  useEffect(() => {
    const since = Date.now() - save.current.at
    // A reset (pristine board) is written at once — a reload right after it must not
    // find the old match in the throttled draft.
    if (since >= SAVE_EVERY_MS || engine.isPristine()) {
      if (save.current.timer) { clearTimeout(save.current.timer); save.current.timer = null }
      write()
    }
    else if (!save.current.timer) save.current.timer = setTimeout(write, SAVE_EVERY_MS - since)
  }, [version, engine, game.id])

  // Flush the last pending write when the judge leaves the screen.
  useEffect(() => {
    const t = save.current
    return () => {
      if (!t.timer) return
      clearTimeout(t.timer)
      t.timer = null
      persist()
    }
  }, [engine, game.id])

  // Lost-draft / cross-device recovery. With no local draft, the fresh engine would
  // silently reset a game that's still broadcasting live. Pull the last snapshot the
  // server holds and resume it (paused) — but only while this board is still untouched,
  // so we never clobber officiating the judge has already begun on this device.
  const recovered = useRef(false)
  useEffect(() => {
    if (hadDraft.current || recovered.current || finished.has(game.id)) return
    let cancelled = false
    getLiveGame(game.id).then((row) => {
      if (cancelled || recovered.current) return
      const snap = row?.state?.snapshot
      if (snap && engine.isPristine()) {
        recovered.current = true
        engine.restore(snap)
      }
    })
    return () => { cancelled = true }
  }, [engine, game.id])

  return engine
}

export const clearEngineDraft = (gameId) => {
  finished.add(gameId)
  try { localStorage.removeItem(LS(gameId)) } catch { /* ignore */ }
}
