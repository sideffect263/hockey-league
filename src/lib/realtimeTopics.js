import { supabase } from '@/lib/supabase'

// Realtime Broadcast topics fed by DB triggers (supabase/realtime-broadcast.sql: public game
// topics; supabase/realtime-private-user.sql: private per-user topics).
// One message per change, fanned out by Realtime — no per-viewer RLS work on the database,
// which is what postgres_changes cost and why it capped a big game's audience.
//
// supabase.channel(topic) returns the SAME channel for a repeated topic, and removeChannel
// drops it for everyone, so two components on one topic (LiveGame + ScoreOverlay on a game
// page) must share it: one channel per topic, ref-counted listeners. Teardown waits a beat so
// an unmount→remount (route change, StrictMode) reuses the live channel instead of racing
// removeChannel against a fresh supabase.channel() of the same name.

// Public topics (anyone may listen) and private ones (listenPrivateTopic, below) share this
// map; topic names never overlap between the two.
const topics = new Map() // topic → { channel, listeners: Set<{ event, cb, onRejoin }> }

// cb(payload) on each `event` message. onRejoin() fires when the socket reconnects after a
// drop — messages sent meanwhile are lost, so callers refetch there. Returns an unsubscribe fn.
export function listenTopic(topic, event, cb, onRejoin) {
  return listen(topic, false, event, cb, onRejoin)
}

// The same, on a PRIVATE topic (supabase/realtime-private-user.sql): Realtime admits the socket
// only if realtime.messages RLS allows it for the JWT on the socket — `user:<uid>` is readable by
// that uid alone. supabase-js keeps that JWT current by itself (SIGNED_IN / TOKEN_REFRESHED →
// realtime.setAuth(token), pushed to joined channels; SIGNED_OUT → back to the anon key, which the
// server no longer admits). The one gap is the first join: its payload is built
// synchronously and may go out before the socket has fetched the session, which the server
// refuses — so a private join waits for setAuth() first. A refused join is retried by realtime-js
// with whatever token it has by then. Callers unsubscribe on sign-out (their effect depends on
// `user`), and a new user is a new topic.
export function listenPrivateTopic(topic, event, cb, onRejoin) {
  return listen(topic, true, event, cb, onRejoin)
}

function listen(topic, isPrivate, event, cb, onRejoin) {
  let t = topics.get(topic)
  if (t?.closing) { clearTimeout(t.closing); t.closing = null }
  if (!t) {
    const listeners = new Set()
    let joined = false
    const channel = isPrivate
      ? supabase.channel(topic, { config: { private: true } })
      : supabase.channel(topic)
    channel.on('broadcast', { event: '*' }, (msg) => {
      for (const l of listeners) if (l.event === msg.event) l.cb(msg.payload || {})
    })
    t = { channel, listeners, closing: null }
    topics.set(topic, t)
    const mine = t
    const join = () => {
      if (topics.get(topic) !== mine) return // torn down while auth was loading
      channel.subscribe((status) => {
        if (status !== 'SUBSCRIBED') return
        if (joined) for (const l of listeners) l.onRejoin?.()
        joined = true
      })
    }
    if (isPrivate) supabase.realtime.setAuth().catch(() => {}).finally(join)
    else join()
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
