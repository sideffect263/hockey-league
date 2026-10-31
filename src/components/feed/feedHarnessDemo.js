/**
 * QA only: the harness (scripts/qa-harness, ?as=…) has no real session, so the reads behind
 * the referee / coach cards fail and those cards never render. With `?feedDemo=1` in a DEV
 * build, the feed fills them from public data (the next scheduled games as "his" games, the
 * last completed one as the form to sign) so their layout can be checked. import.meta.env.DEV
 * is false in production builds, so this is dead code there.
 */
export function feedDemoOn() {
  if (!import.meta.env.DEV) return false
  try {
    const q = new URLSearchParams(window.location.search).get('feedDemo')
    if (q != null) sessionStorage.setItem('fl-feed-demo', q)
    return sessionStorage.getItem('fl-feed-demo') === '1'
  } catch { return false }
}

export function demoJudgeIds(games) {
  const now = Date.now()
  const up = games.filter(g => g.status !== 'completed' && new Date(g.game_date).getTime() > now)
    .sort((a, b) => new Date(a.game_date) - new Date(b.game_date)).slice(0, 2)
  const done = games.filter(g => g.status === 'completed').slice(0, 3)
  return new Set([...up, ...done].map(g => g.id))
}

export function demoSignGame(games) {
  return games.filter(g => g.status === 'completed')
    .sort((a, b) => new Date(b.game_date) - new Date(a.game_date))[0] || null
}
