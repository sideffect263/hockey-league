import { supabase } from './supabase'
import { listenPrivateTopic } from './realtimeTopics'
import { sessionUser } from './sessionUser'

/**
 * Members-only direct messages (see supabase/direct-messages-schema.sql).
 * Rows are private to the two parties (RLS), sends are gated to community
 * members. Counterpart profiles are resolved with a separate lookup (never a
 * PostgREST embed — the embed-ambiguity gotcha).
 */

async function currentUserId() {
  const user = await sessionUser()
  return user?.id || null
}

const other = (m, me) => (m.sender_id === me ? m.recipient_id : m.sender_id)

// Inbox: one entry per counterpart, newest first, with unread counts.
export async function listConversations() {
  const me = await currentUserId()
  if (!me) return []
  const { data, error } = await supabase
    .from('direct_messages')
    .select('*')
    .or(`sender_id.eq.${me},recipient_id.eq.${me}`)
    .order('created_at', { ascending: false })
  if (error) throw error
  const rows = data || []

  const byOther = new Map()
  for (const m of rows) {
    const o = other(m, me)
    let conv = byOther.get(o)
    if (!conv) { conv = { other_id: o, last: m, unread: 0 }; byOther.set(o, conv) }
    if (m.recipient_id === me && !m.read_at) conv.unread += 1
  }
  const convs = [...byOther.values()]

  const ids = convs.map(c => c.other_id)
  let profiles = {}
  if (ids.length) {
    const { data: profs } = await supabase
      .from('profiles')
      .select('id, display_name, avatar_url, player_id')
      .in('id', ids)
    profiles = Object.fromEntries((profs || []).map(p => [p.id, p]))
  }
  return convs.map(c => ({ ...c, profile: profiles[c.other_id] || null }))
}

// Full thread with one counterpart, oldest first.
export async function getThread(otherId) {
  const me = await currentUserId()
  if (!me) return []
  const { data, error } = await supabase
    .from('direct_messages')
    .select('*')
    .or(`and(sender_id.eq.${me},recipient_id.eq.${otherId}),and(sender_id.eq.${otherId},recipient_id.eq.${me})`)
    .order('created_at', { ascending: true })
  if (error) throw error
  return data || []
}

export async function sendMessage(recipientId, body) {
  const me = await currentUserId()
  if (!me) throw new Error('not authenticated')
  const trimmed = (body || '').trim().slice(0, 2000)
  if (!trimmed) throw new Error('empty message')
  const { data, error } = await supabase
    .from('direct_messages')
    .insert({ sender_id: me, recipient_id: recipientId, body: trimmed })
    .select()
    .single()
  if (error) throw error
  return data
}

export async function markThreadRead(otherId) {
  const me = await currentUserId()
  if (!me) return
  await supabase
    .from('direct_messages')
    .update({ read_at: new Date().toISOString() })
    .eq('recipient_id', me)
    .eq('sender_id', otherId)
    .is('read_at', null)
}

export async function getTotalUnread() {
  const me = await currentUserId()
  if (!me) return 0
  const { count, error } = await supabase
    .from('direct_messages')
    .select('id', { count: 'exact', head: true })
    .eq('recipient_id', me)
    .is('read_at', null)
  if (error) return 0
  return count || 0
}

// The directory for the "new message" picker: every member except me.
export async function getMessageableMembers() {
  const me = await currentUserId()
  const { data, error } = await supabase.rpc('messageable_members')
  if (error) throw error
  return (data || []).filter(m => m.id !== me)
}

// Incoming messages (for me) in real time, cb(row) with the direct_messages row, over the
// private `user:<uid>` Broadcast topic (supabase/realtime-private-user.sql). onRejoin() fires
// after a dropped socket comes back — messages sent meanwhile are lost, so refetch there.
// Returns an unsubscribe fn.
export function subscribeToMessages(userId, cb, onRejoin) {
  if (!userId) return () => {}
  return listenPrivateTopic(`user:${userId}`, 'dm', (p) => { if (p.row) cb(p.row) }, onRejoin)
}
