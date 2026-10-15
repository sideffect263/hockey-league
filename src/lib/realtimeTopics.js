import { supabase } from '@/lib/supabase'

// Public Realtime Broadcast topics fed by DB triggers (supabase/realtime-broadcast.sql).
// One message per change, fanned out by Realtime — no per-viewer RLS work on the database,
// which is what postgres_changes cost and why it capped a big game's audience.
//
// supabase.channel(topic) returns the SAME channel for a repeated topic, and removeChannel
// drops it for everyone, so two components on one topic (LiveGame + ScoreOverlay on a game
// page) must share it: one channel per topic, ref-counted listeners. Teardown waits a beat so
// an unmount→remount (route change, StrictMode) reuses the live channel instead of racing
// removeChannel against a fresh supabase.channel() of the same name.

const topics = new Map() // topic → { channel, listeners: Set<{ event, cb, onRejoin }> }

// cb(payload) on each `event` message. onRejoin() fires when the socket reconnects after a
// drop — messages sent meanwhile are lost, so callers refetch there. Returns an unsubscribe fn.
export function listenTopic(topic, event, cb, onRejoin) {
  let t = topics.get(topic)
  if (t?.closing) { clearTimeout(t.closing); t.closing = null }
  if (!t) {
    const listeners = new Set()
    let joined = false
    const channel = supabase.channel(topic)
    channel.on('broadcast', { event: '*' }, (msg) => {
      for (const l of listeners) if (l.event === msg.event) l.cb(msg.payload || {})
    })
    channel.subscribe((status) => {
      if (status !== 'SUBSCRIBED') return
      if (joined) for (const l of listeners) l.onRejoin?.()
      joined = true
    })
    t = { channel, listeners, closing: null }
    topics.set(topic, t)
  }
  const l = { event, cb, onRejoin }
  t.listeners.add(l)
  return () => {
    t.listeners.delete(l)
    if (t.listeners.size > 0 || t.closing) return
    t.closing = setTimeout(() => {
      if (t.listeners.size > 0 || topics.get(topic) !== t) return
      topics.delete(topic)
      supabase.removeChannel(t.channel)
    }, 2000)
  }
}
