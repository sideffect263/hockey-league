import { supabase } from './supabase'
import { sessionUser } from './sessionUser'
import { countsForStats } from './leagueStats'
import { registerSlugs } from './slugs'
import { sniffImageType, SAFE_IMAGE_TYPES, IMAGE_TYPE_ERROR } from './imageType'

// Fetch every row, paging past PostgREST's 1000-row cap (a plain select silently
// truncates at 1000). Used for tables that can grow beyond that within a season.
async function fetchAllRows(table, select = '*', orderCol = 'id') {
  const out = []
  const size = 1000
  let from = 0
  while (true) {
    const { data, error } = await supabase
      .from(table).select(select).order(orderCol, { ascending: true }).range(from, from + size - 1)
    if (error) throw error
    out.push(...(data || []))
    if (!data || data.length < size) break
    from += size
  }
  return out
}

export async function getTeams(orderBy = 'points', ascending = false) {
  const { data, error } = await supabase
    .from('teams')
    .select('*')
    .eq('status', 'active')
    .order(orderBy, { ascending })
  if (error) throw error
  return registerSlugs('teams', data)
}

// ----- user-created teams (Package 1a) -----

/** Teams awaiting league-manager/admin approval, oldest first. */
export async function getPendingTeams() {
  const { data, error } = await supabase
    .from('teams').select('*').eq('status', 'pending')
    .order('created_at', { ascending: true })
  if (error) throw error
  return data || []
}

/** A linked player proposes a new team (pending). Returns the new team id. */
export async function requestTeam(name, ageGroups, city = null) {
  const { data, error } = await supabase.rpc('request_team', {
    p_name: name, p_age_groups: ageGroups, p_city: city || null,
  })
  if (error) {
    if (/not a linked player/i.test(error.message || '')) throw new Error('not-linked-player')
    throw error
  }
  return data
}

/** League-manager/admin approves (→ active, creator becomes coach) or rejects a team. */
export async function reviewTeam(teamId, approve) {
  const { error } = await supabase.rpc('review_team', { p_team_id: teamId, p_approve: approve })
  if (error) {
    if (/not authorized/i.test(error.message || '')) throw new Error('not-authorized')
    throw error
  }
}

/** The signed-in user's own team requests (any status), newest first. */
export async function getMyTeamRequests() {
  const user = await sessionUser()
  if (!user) return []
  const { data, error } = await supabase
    .from('teams').select('*').eq('created_by', user.id)
    .order('created_at', { ascending: false })
  if (error) throw error
  return data || []
}

// ----- coach/admin team editing (crest + details) -----

/** Coach/admin edits a team's descriptive fields (competitive stats stay admin-only). */
export async function updateTeamDetails(teamId, fields) {
  const { error } = await supabase.rpc('update_team_details', {
    p_team_id: teamId,
    p_name: fields.name,
    p_city: fields.city ?? null,
    p_home_venue: fields.home_venue ?? null,
    p_primary_color: fields.primary_color ?? null,
    p_secondary_color: fields.secondary_color ?? null,
    p_founded_year: fields.founded_year ?? null,
  })
  if (error) {
    if (/not authorized/i.test(error.message || '')) throw new Error('not-authorized')
    throw error
  }
}

/**
 * Upload a crest to the public `team-logos` bucket (path "<team_id>/<file>") and
 * point teams.logo_url at its public URL via the set_team_logo RPC. Allowed for
 * the team's coach, an admin, or the creator of a still-pending team. Returns the URL.
 *
 * PNG and JPEG ONLY, decided by the file's BYTES.
 *
 * This is the last line of defence, not the first — both crest pickers block a
 * bad file at selection time with a readable message. It lives here because
 * this function is the one thing every upload path goes through, and the bucket
 * is what link unfurlers read.
 *
 * The extension and content-type are derived from the sniffed type and never
 * from `file.name` / `file.type`. That is the whole bug: the crests that broke
 * WhatsApp previews were AVIF files called `.png`, uploaded with the browser's
 * own (equally wrong) `file.type`, and stored under a label nothing could
 * trust. A file can lie about what it is; it cannot lie about its first bytes.
 *
 * The iOS and Android crest pickers already re-encode to real PNG before
 * uploading, so this only ever fires for the web.
 */
export async function uploadTeamLogo(teamId, file) {
  const kind = await sniffImageType(file)
  if (!SAFE_IMAGE_TYPES.includes(kind)) throw new Error(IMAGE_TYPE_ERROR)

  const ext = kind === 'jpeg' ? 'jpg' : 'png'
  const path = `${teamId}/logo-${Date.now()}.${ext}`
  const { error: upErr } = await supabase.storage
    .from('team-logos')
    .upload(path, file, { upsert: true, contentType: `image/${kind}` })
  if (upErr) throw upErr
  const { data: pub } = supabase.storage.from('team-logos').getPublicUrl(path)
  const url = pub?.publicUrl
  const { error: rpcErr } = await supabase.rpc('set_team_logo', { p_team_id: teamId, p_url: url })
  if (rpcErr) {
    if (/not authorized/i.test(rpcErr.message || '')) throw new Error('not-authorized')
    throw rpcErr
  }
  return url
}

// Every players column EXCEPT birth_date. This list is deliberate, not laziness avoided:
// `birth_date` is revoked from the `anon` role (minors' DOB must not be public), and a
// bare `select('*')` asks Postgres for privilege on EVERY column — so a wildcard here
// would 403 the whole public player list for logged-out visitors. Anyone who genuinely
// needs a DOB reads it per-row while signed in (see lib/birthDate.js).
export const PLAYER_PUBLIC_COLUMNS =
  'id,first_name,last_name,jersey_number,position,team_id,is_referee,is_core,age,' +
  'goals,games_played,blue_cards,red_cards,photo_url,created_at,slug,og_number'

export async function getPlayers(orderBy = 'goals', ascending = false) {
  const { data, error } = await supabase
    .from('players')
    .select(PLAYER_PUBLIC_COLUMNS)
    .order(orderBy, { ascending })
  if (error) throw error
  const players = data || []
  // Attach the paired user's uploaded avatar (claimed cards only) so player cards
  // can show the person's photo. Batched lookup — NOT a profiles↔players embed
  // (embed-ambiguity gotcha); profiles has a public-read policy so anon gets it too.
  try {
    const { data: owners } = await supabase
      .from('profiles').select('player_id, avatar_url')
      .not('player_id', 'is', null).not('avatar_url', 'is', null)
    if (owners?.length) {
      const byPlayer = Object.fromEntries(owners.map(o => [o.player_id, o.avatar_url]))
      for (const p of players) if (byPlayer[p.id]) p.owner_avatar_url = byPlayer[p.id]
    }
  } catch { /* avatar is enhancement-only; never break the players fetch */ }
  return registerSlugs('players', players)
}

export async function getGames(orderBy = 'game_date', ascending = false) {
  const { data, error } = await supabase
    .from('games')
    .select('*')
    .order(orderBy, { ascending })
  if (error) throw error
  return registerSlugs('games', data)
}

export async function getGameStats() {
  // game_stats grows ~13 rows/game and will exceed 1000 within a season — page it.
  return fetchAllRows('game_stats', '*', 'id')
}

export async function getReferees() {
  const { data, error } = await supabase
    .from('referees')
    .select('*')
  if (error) throw error
  return data
}

export async function getGameById(id) {
  const { data, error } = await supabase
    .from('games')
    .select('*')
    .eq('id', id)
    .single()
  if (error) throw error
  registerSlugs('games', [data])
  return data
}

export async function getGameStatsByGameId(gameId) {
  const { data, error } = await supabase
    .from('game_stats')
    .select('*')
    .eq('game_id', gameId)
  if (error) throw error
  return data
}

// ============ FEED POSTS (Stage B2) ============

export async function getPosts() {
  const { data, error } = await supabase
    .from('posts')
    .select('*, author:profiles!posts_author_id_fkey(display_name, avatar_url, player_id), like_count:post_likes(count), comment_count:comments(count)')
    .is('deleted_at', null)
    .is('comments.deleted_at', null) // count only live comments, matching getComments()
    .order('created_at', { ascending: false })
    // Unbounded before: every feed load (web AND native) fetched every post ever
    // written. Harmless while posting was rare; the news ingest makes the table
    // grow on its own, so cap it. 200 is far past what anyone scrolls.
    .limit(200)
  if (error) throw error
  return (data || []).map(p => ({
    ...p,
    like_count: p.like_count?.[0]?.count ?? 0,
    comment_count: p.comment_count?.[0]?.count ?? 0,
  }))
}

// Public role badges for a set of user ids (post authors, a player's linked
// account). Uses the public_role_badges RPC so viewers can see others' league
// roles despite the "read own roles" RLS on user_roles.
// Returns a map: { [userId]: { isAdmin: boolean, roles: [{role, team_id}] } }.
export async function getRoleBadges(userIds = []) {
  const ids = [...new Set((userIds || []).filter(Boolean))]
  if (!ids.length) return {}
  const { data, error } = await supabase.rpc('public_role_badges', { p_user_ids: ids })
  if (error) { console.error('getRoleBadges', error); return {} }
  const map = {}
  for (const row of data || []) {
    map[row.user_id] = { isAdmin: !!row.is_admin, roles: row.roles || [] }
  }
  return map
}

// Role badges for the account (if any) linked to a given player — used on the
// player page. Resolves player → profile(s) (public-readable) → role badges.
// Returns { isAdmin, roles } or null when the player has no linked account/role.
export async function getPlayerRoleBadges(playerId) {
  if (!playerId) return null
  const { data: profs, error } = await supabase
    .from('profiles').select('id').eq('player_id', playerId)
  if (error || !profs?.length) return null
  const map = await getRoleBadges(profs.map(p => p.id))
  let isAdmin = false
  const roles = []
  for (const p of profs) {
    const entry = map[p.id]
    if (!entry) continue
    if (entry.isAdmin) isAdmin = true
    for (const r of entry.roles) roles.push(r)
  }
  return (isAdmin || roles.length) ? { isAdmin, roles } : null
}

export async function createPost({ body, teamId = null }) {
  const user = await sessionUser()
  if (!user) throw new Error('not authenticated')
  const { data, error } = await supabase
    .from('posts')
    .insert({ author_id: user.id, body: body.trim(), team_id: teamId })
    .select('*, author:profiles!posts_author_id_fkey(display_name, avatar_url, player_id)')
    .single()
  if (error) throw error
  return { ...data, like_count: 0, comment_count: 0 }
}

export async function deletePost(id) {
  // soft delete
  const { error } = await supabase.from('posts').update({ deleted_at: new Date().toISOString() }).eq('id', id)
  if (error) throw error
}

export async function editPost(id, body) {
  // posts.body CHECK: 1..2000 chars. `updated_at` exists (auto-touched by trigger too).
  const trimmed = (body || '').trim().slice(0, 2000)
  if (!trimmed) throw new Error('empty body')
  const { error } = await supabase
    .from('posts')
    .update({ body: trimmed, updated_at: new Date().toISOString() })
    .eq('id', id)
  if (error) throw error
}

// --- Likes ---
export async function getMyLikes() {
  const user = await sessionUser()
  if (!user) return []
  const { data, error } = await supabase.from('post_likes').select('post_id').eq('user_id', user.id)
  if (error) throw error
  return (data || []).map(r => r.post_id)
}

export async function likePost(postId) {
  const user = await sessionUser()
  if (!user) throw new Error('not authenticated')
  const { error } = await supabase.from('post_likes').insert({ post_id: postId, user_id: user.id })
  // PK is (post_id, user_id): a double-click / stale-UI re-like returns 23505.
  // Liking is idempotent, so treat a duplicate as success instead of surfacing an error.
  if (error && error.code !== '23505') throw error
}

export async function unlikePost(postId) {
  const user = await sessionUser()
  if (!user) throw new Error('not authenticated')
  const { error } = await supabase.from('post_likes').delete().eq('post_id', postId).eq('user_id', user.id)
  if (error) throw error
}

// --- Comments ---
export async function getComments(postId) {
  const { data, error } = await supabase
    .from('comments')
    .select('*, author:profiles!comments_author_id_fkey(display_name, avatar_url, player_id)')
    .eq('post_id', postId)
    .is('deleted_at', null)
    .order('created_at', { ascending: true })
  if (error) throw error
  return data
}

export async function createComment(postId, body) {
  const user = await sessionUser()
  if (!user) throw new Error('not authenticated')
  const { data, error } = await supabase
    .from('comments')
    .insert({ post_id: postId, author_id: user.id, body: body.trim() })
    .select('*, author:profiles!comments_author_id_fkey(display_name, avatar_url, player_id)')
    .single()
  if (error) throw error
  return data
}

export async function deleteComment(id) {
  const { error } = await supabase.from('comments').update({ deleted_at: new Date().toISOString() }).eq('id', id)
  if (error) throw error
}

export async function editComment(id, body) {
  // comments.body CHECK: 1..1000 chars. The comments table has NO updated_at column, so set body only.
  const trimmed = (body || '').trim().slice(0, 1000)
  if (!trimmed) throw new Error('empty body')
  const { error } = await supabase.from('comments').update({ body: trimmed }).eq('id', id)
  if (error) throw error
}

// ============ ADMIN OPERATIONS ============

// --- Games ---
export async function createGame(game) {
  const { data, error } = await supabase.from('games').insert(game).select().single()
  if (error) throw error
  return data
}

/** Insert many games at once (tournament schedule generation). */
export async function createGames(games) {
  const { data, error } = await supabase.from('games').insert(games).select()
  if (error) throw error
  return data
}

export async function updateGame(id, updates) {
  const { data, error } = await supabase.from('games').update(updates).eq('id', id).select().single()
  if (error) throw error
  return data
}

export async function deleteGame(id) {
  const { error } = await supabase.from('games').delete().eq('id', id)
  if (error) throw error
}

// --- Players ---
//
// Both writers read the row back through PLAYER_PUBLIC_COLUMNS, never a bare
// `.select()`. A `.select()` with no arguments IS `select=*`, and on `players` that
// asks Postgres for privilege on every column including `birth_date` — which neither
// `anon` nor `authenticated` may read. The INSERT itself is permitted; it is the
// RETURNING that 403s, which is how "לא ניתן להוסיף שחקן" looked like a permissions
// problem with creating players when it was really a problem with reading them back.

/**
 * Create a player card.
 *
 * `team_id` is OPTIONAL: a free agent with no team is a legitimate player card, and
 * the column is nullable precisely so the league can hold players between clubs.
 */
export async function createPlayer(player) {
  const { data, error } = await supabase
    .from('players').insert(player).select(PLAYER_PUBLIC_COLUMNS).single()
  if (error) throw error
  return data
}

export async function updatePlayer(id, updates) {
  const { data, error } = await supabase
    .from('players').update(updates).eq('id', id).select(PLAYER_PUBLIC_COLUMNS).single()
  if (error) throw error
  return data
}

export async function deletePlayer(id) {
  // .select() so an RLS-filtered delete (204, zero rows, error:null) reads as a failure
  // instead of a silent no-op that just leaves the player on the list.
  const { data, error } = await supabase.from('players').delete().eq('id', id).select('id')
  if (error) throw error
  if (!data?.length) throw new Error('השחקן לא נמחק — אין הרשאה')
}

/** Coach "remove from team": drops this team's membership; the card stays, as a free agent if no other team. */
export async function releasePlayerFromTeam(playerId, teamId) {
  const { error } = await supabase.rpc('coach_release_player', { p_player_id: playerId, p_team_id: teamId })
  if (error) throw error
}

// --- Teams ---
export async function updateTeam(id, updates) {
  const { data, error } = await supabase.from('teams').update(updates).eq('id', id).select().single()
  if (error) throw error
  return data
}

/** Admin/league-manager creates an active team directly (RLS: is_admin OR is_league_manager). */
export async function createTeam(fields) {
  const age = fields.age_group || 'senior'
  const payload = {
    name: fields.name,
    city: fields.city || null,
    home_venue: fields.home_venue || null,
    age_group: age,
    age_groups: [age],
    status: 'active',
  }
  if (fields.primary_color) payload.primary_color = fields.primary_color   // else DB default (#f97316)
  const { data, error } = await supabase.from('teams').insert(payload).select().single()
  if (error) throw error
  return data
}

/**
 * Delete a team. A BEFORE DELETE trigger blocks teams that still have games
 * (teams→games is ON DELETE CASCADE, so deleting one would erase its match
 * history and skew standings). Surface that as an actionable Hebrew message.
 */
export async function deleteTeam(id) {
  const { error } = await supabase.from('teams').delete().eq('id', id)
  if (error) {
    const m = error.message || ''
    if (/cannot delete a team/i.test(m)) {
      const n = (m.match(/with (\d+) game/) || [])[1]
      throw new Error(`לא ניתן למחוק קבוצה עם ${n || ''} משחקים. הסר/י תחילה את המשחקים שלה.`)
    }
    throw error
  }
}

// --- Game Stats ---
export async function createGameStat(stat) {
  const { data, error } = await supabase.from('game_stats').insert(stat).select().single()
  if (error) throw error
  return data
}

export async function updateGameStat(id, updates) {
  const { data, error } = await supabase.from('game_stats').update(updates).eq('id', id).select().single()
  if (error) throw error
  return data
}

export async function deleteGameStat(id) {
  const { error } = await supabase.from('game_stats').delete().eq('id', id)
  if (error) throw error
}

/** Replace a game's whole box score atomically (admin / league manager / judge). */
export async function saveGameStats(gameId, stats) {
  const { data, error } = await supabase.rpc('save_game_stats', { p_game_id: gameId, p_stats: stats })
  if (error) throw error
  return data
}

export async function deleteGameStatsByGameId(gameId) {
  const { error } = await supabase.from('game_stats').delete().eq('game_id', gameId)
  if (error) throw error
}

// --- Admin Users ---
// admin_users SELECT is locked to the caller's own row (so checkAdmin works
// without leaking the admin list to every logged-in user). The full list comes
// from the is_admin()-gated list_admins() RPC. Fall back to a direct read for
// resilience (older/behind DB, or the RPC erroring).
export async function getAdminUsers() {
  const { data, error } = await supabase.rpc('list_admins')
  if (!error && Array.isArray(data)) return data
  const res = await supabase.from('admin_users').select('*').order('created_at')
  if (res.error) throw res.error
  return res.data
}

// NO .select() here: admin_users SELECT is locked to the caller's own row (see
// getAdminUsers above). An INSERT ... RETURNING would try to read the NEW admin's
// row back through that policy and get rejected ("new row violates row-level
// security policy"). We don't need the row — the caller reloads via list_admins().
export async function addAdminUser(email, name) {
  const { error } = await supabase.from('admin_users').insert({ email, name })
  if (error) throw error
}

// Must go through the RPC, NOT a direct delete. Postgres applies SELECT policies
// to a DELETE whose WHERE reads a column, and the own-row policy above hides every
// admin but you — so `.delete().eq('id', id)` matched 0 rows and returned NO error,
// i.e. it silently did nothing. remove_admin() is SECURITY DEFINER (bypasses RLS)
// and raises if the row is missing or is your own. See supabase/remove-admin-rpc.sql.
export async function removeAdminUser(id) {
  const { error } = await supabase.rpc('remove_admin', { p_id: id })
  if (error) throw error
}

// --- League Settings ---
export async function getLeagueSetting(key) {
  const { data, error } = await supabase
    .from('league_settings')
    .select('value')
    .eq('key', key)
    .maybeSingle()
  if (error) throw error
  return data?.value || null
}

export async function setLeagueSetting(key, value) {
  const { error } = await supabase
    .from('league_settings')
    .upsert({ key, value, updated_at: new Date().toISOString() }, { onConflict: 'key' })
  if (error) throw error
}

// ============ ARCHIVE & SEASON MANAGEMENT ============

/**
 * Past seasons now live in the live tables, tagged with `season_id`, rather than
 * in the old `archived_*` copies. Those tables are left in place but are empty
 * and unused — the copy-and-delete rollover they served never ran.
 *
 * These readers keep their original names and return shapes so the archive page
 * did not have to change with the storage.
 */
export async function getArchivedSeasons() {
  const { data, error } = await supabase
    .from('seasons')
    .select('id, slug, name, starts_on, ends_on, created_at')
    .eq('status', 'archived')
    .order('ends_on', { ascending: false, nullsFirst: false })
  if (error) throw error
  // The page renders `archived_at`; a closed season's end date is that moment.
  return (data || []).map(s => ({ ...s, archived_at: s.ends_on || s.created_at }))
}

export async function getArchivedStandings(seasonId) {
  const { data, error } = await supabase
    .from('team_season_stats')
    .select('*')
    .eq('season_id', seasonId)
    .order('final_rank')
  if (error) throw error
  return data
}

export async function getArchivedPlayerStats(seasonId) {
  const { data, error } = await supabase
    .from('player_season_stats')
    .select('*')
    .eq('season_id', seasonId)
    .order('goals', { ascending: false })
  if (error) throw error
  // Unlike the old archive, these rows keep a real player_id — so a name can be
  // linked back to the player rather than being a dead string.
  return (data || []).map(r => ({
    ...r,
    player_first_name: r.first_name,
    player_last_name: r.last_name,
  }))
}

export async function getArchivedGames(seasonId) {
  // Via RPC: the games RLS policy hides other seasons from normal clients, and
  // team names must resolve even for clubs since deactivated.
  const { data, error } = await supabase.rpc('season_games_detail', { p_season_id: seasonId })
  if (error) throw error
  return data || []
}

/** Every season, newest first — for the calendar and the season picker. */
export async function getSeasons() {
  const { data, error } = await supabase
    .from('seasons')
    .select('id, name, starts_on, ends_on, status, created_at')
    .order('created_at', { ascending: false })
  if (error) throw error
  return data || []
}

/**
 * Create a season the league manager can schedule into before it starts.
 *
 * Its games are invisible to everyone but admin and league managers — the games
 * RLS policy only admits the current season — so next year's calendar can be
 * drafted in the open. close_season() later promotes this season rather than
 * creating a new one, so every fixture drafted here goes live untouched.
 */
export async function createPlannedSeason(name, startsOn = null) {
  const { data, error } = await supabase.rpc('create_planned_season', {
    p_name: name,
    p_starts_on: startsOn,
  })
  if (error) throw error
  return data
}

/**
 * Delete every fixture in a PLANNED season, so a schedule can be regenerated.
 *
 * The RPC refuses any season that is not 'planned', so this can never be aimed
 * at the live season or at played history — that guard is server-side, not a UI
 * convention.
 *
 * @returns {Promise<number>} fixtures deleted
 */
export async function clearPlannedSeasonFixtures(seasonId) {
  const { data, error } = await supabase.rpc('clear_planned_season_fixtures', {
    p_season_id: seasonId,
  })
  if (error) throw error
  return data
}

/**
 * Games belonging to one season, for the league manager's season calendar.
 *
 * The direct read is RLS-governed: it returns the current season to everyone,
 * and additionally the 'planned' season to admins and league managers, which is
 * what lets next year's fixtures be drafted before this one closes. ARCHIVED
 * seasons are hidden from the live tables for every role — that is deliberate,
 * and it is what stopped /statistics from rendering last season's numbers to
 * anyone holding an admin or league-manager claim.
 *
 * So a closed season would come back empty here. Fall back to season_games(),
 * the SECURITY DEFINER reader the archive already uses, so picking a past
 * season in the calendar still shows its fixtures. It returns `setof games` —
 * the same row shape as the table read, so callers can't tell the paths apart.
 *
 * The fallback costs one extra round trip only when the first read is empty,
 * which is also the case for a planned season with no fixtures drafted yet —
 * harmless, since the RPC returns nothing for it either.
 */
export async function getSeasonGames(seasonId) {
  const { data, error } = await supabase
    .from('games')
    .select('*')
    .eq('season_id', seasonId)
    .order('game_date', { ascending: true })
  if (error) throw error
  if (data?.length) return data

  const { data: viaRpc, error: rpcError } = await supabase
    .rpc('season_games', { p_season_id: seasonId })
  if (rpcError) throw rpcError
  return [...(viaRpc || [])].sort((a, b) => new Date(a.game_date) - new Date(b.game_date))
}

/** The season the live site is currently showing. */
export async function getCurrentSeason() {
  const { data, error } = await supabase
    .from('seasons')
    .select('id, name, starts_on, ends_on, status')
    .eq('status', 'active')
    .order('created_at', { ascending: false })
    .limit(1)
  if (error) throw error
  return data?.[0] || null
}

/**
 * Close the running season and open the next one.
 *
 * Nothing is deleted. Games keep the season they were played in and drop out of
 * the live site via RLS; the live team/player aggregates are snapshotted into
 * team_season_stats / player_season_stats and then zeroed. Suspensions,
 * notifications and the champion marker are cleared. The feed carries over.
 *
 * Replaces archiveAndResetSeason, which deleted every game and — because every
 * FK to `games` cascades — silently took game_videos, game_officials and video
 * markers with it. That RPC now raises if anything still calls it.
 *
 * @param {string} nextSeasonName - the season being opened, e.g. "2026-27"
 * @param {string} [startsOn]     - ISO date the new season begins; defaults to today
 * @returns {Promise<{id: string, name: string}>} the new season
 */
export async function closeSeason(nextSeasonName, startsOn = null) {
  const { data, error } = await supabase.rpc('close_season', {
    p_next_name: nextSeasonName,
    p_next_starts: startsOn,
  })
  if (error) throw error
  return { id: data, name: nextSeasonName }
}

// ============ STATS RECALCULATION ============

/**
 * Recalculate all team standings from completed games.
 * Points: 3 for win, 1 for tie, 0 for loss.
 */
export async function recalculateTeamStats() {
  // Server-side via one SECURITY DEFINER RPC, self-gated on is_admin() OR
  // is_judge(). Judges manage games but deliberately have NO write policy on
  // `teams` — otherwise they could rename teams and rewrite the table through
  // the REST API. The RPC runs the same wins*3 + ties math this used to do in
  // the browser, and was verified to reproduce all 7 teams' standings exactly.
  const { error } = await supabase.rpc('recompute_all_team_standings')
  if (error) throw error
}

/**
 * Recalculate all player stats from game_stats entries.
 *
 * NOTE: This is intentionally NOT auto-invoked right now. The historical
 * game_stats table has not been backfilled yet, so running this against an
 * (near-)empty table would zero out every player's totals. It is left here
 * (and guarded below) so that, once the historical backfill is complete
 * (Package 2), it can be re-enabled as the authoritative source for player
 * goals/blue_cards/red_cards/games_played.
 */
export async function recalculatePlayerStats() {
  const [players, rawStats, games] = await Promise.all([getPlayers(), getGameStats(), getGames()])

  // Safety guard: never wipe player stats from an empty game_stats table.
  if (!rawStats || rawStats.length === 0) {
    console.warn('recalculatePlayerStats: game_stats is empty — skipping to avoid zeroing all player totals.')
    return
  }

  // Friendly (ידידותי) games never count toward player totals — drop their box
  // scores before aggregating (mirrors recompute_team_standings on the DB side).
  const competitiveGameIds = new Set(games.filter(countsForStats).map(g => g.id))
  const allStats = rawStats.filter(s => competitiveGameIds.has(s.game_id))

  for (const player of players) {
    const pStats = allStats.filter(s => s.player_id === player.id)
    const goals = pStats.reduce((sum, s) => sum + (s.goals || 0), 0)
    const blue_cards = pStats.reduce((sum, s) => sum + (s.blue_cards || 0), 0)
    const red_cards = pStats.reduce((sum, s) => sum + (s.red_cards || 0), 0)
    const games_played = pStats.length

    await updatePlayer(player.id, {
      goals, blue_cards, red_cards, games_played
    })
  }
}
