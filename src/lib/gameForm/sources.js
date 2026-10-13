// The reads behind the game-form export, written against a Supabase client the CALLER
// passes in: the browser's own (lib/gameReport.js → getGameFormSources) or, in
// api/game-form.js, one carrying the signed-in user's JWT — so the same RLS and the same
// definer-RPC gates decide what either of them sees. No Vite-only imports here.

const PAGE = 1000

/** Every row of a query, paged past PostgREST's 1000-row cap. `build` makes a fresh query. */
async function allRows(build) {
  const out = []
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await build().range(from, from + PAGE - 1)
    if (error) throw error
    out.push(...(data || []))
    if (!data || data.length < PAGE) return out
  }
}

/**
 * The extra reads the export needs beyond what the game page already holds. Each one
 * downgrades to empty rather than failing the export — a missing squad or signature set
 * costs the sheet a few lines, not the whole form.
 */
export async function fetchGameFormSources(client, gameId) {
  const quiet = async (p, fallback) => {
    try {
      const { data, error } = await p
      return error ? fallback : (data ?? fallback)
    } catch { return fallback }
  }
  const [squad, officials, memberships, reportRow, signatureRows] = await Promise.all([
    // definer RPCs: admin / league manager / judge / coach of either team
    quiet(client.rpc('game_squad', { p_game_id: gameId }), []),
    quiet(client.rpc('game_report_officials', { p_game_id: gameId }), []),
    allRows(() => client.from('player_teams').select('player_id, team_id, age_group').order('player_id', { ascending: true })).catch(() => []),
    quiet(client.from('game_reports').select('*').eq('game_id', gameId).maybeSingle(), null),
    quiet(client.rpc('game_form_signatures', { p_game_id: gameId }), []),
  ])
  const signatures = Object.fromEntries((signatureRows || []).map(s => [s.role, s]))
  return { squad, officials, memberships, reportRow, signatures }
}

// Only what the form prints — `players` has column-level grants, so never select('*').
const PLAYER_COLUMNS = 'id,first_name,last_name,jersey_number,position,team_id'

/**
 * What the web game page already has in hand when it opens the export dialog
 * (pages/GameDetail.jsx): the game (from any season), its box score, both teams, the
 * players, and the referee's display name — resolved the same way the page does.
 * Server-side only (api/game-form.js); the browser keeps using the page's own copies.
 * Returns null when the caller cannot see the game.
 */
export async function fetchGamePage(client, gameId) {
  let game = null, stats = null
  const cur = await client.from('games').select('*').eq('id', gameId).maybeSingle()
  if (cur.error) throw cur.error
  if (cur.data) game = cur.data
  else {
    // Archived seasons are hidden from table reads by RLS; this answers "show me this game".
    const old = await client.rpc('game_any_season', { p_game_id: gameId })
    if (old.error) throw old.error
    if (!old.data?.game) return null
    game = old.data.game
    stats = old.data.stats || []
  }

  const teamIds = [game.home_team_id, game.away_team_id].filter(Boolean)
  const [statRes, teamRes, players, judgeRes] = await Promise.all([
    stats ? { data: stats } : client.from('game_stats').select('*').eq('game_id', gameId),
    teamIds.length ? client.from('teams').select('*').in('id', teamIds) : { data: [] },
    allRows(() => client.from('players').select(PLAYER_COLUMNS).order('id', { ascending: true })),
    client.rpc('game_officials_public', { p_game_ids: [gameId] }),
  ])
  if (statRes.error) throw statRes.error
  if (teamRes.error) throw teamRes.error

  const teams = teamRes.data || []
  const home = teams.find(t => t.id === game.home_team_id) || null
  const away = teams.find(t => t.id === game.away_team_id) || null

  // GameDetail.jsx `refName`: the confirmed judge(s) by name, else the recorded referee.
  const judges = (judgeRes.data || []).filter(o => o.role === 'judge')
  let refereeName = null
  if (judges.length) refereeName = judges.map(j => j.name).filter(Boolean).join(', ') || null
  else if (game.referee_id) {
    let r = null
    if (game.referee_type === 'player') r = players.find(p => p.id === game.referee_id)
    else {
      const { data } = await client.from('referees').select('id,first_name,last_name').eq('id', game.referee_id).maybeSingle()
      r = data
    }
    refereeName = r ? `${r.first_name} ${r.last_name}` : null
  }

  return { game, stats: statRes.data || [], home, away, players, refereeName }
}
