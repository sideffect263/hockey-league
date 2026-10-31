/**
 * What the Floodlight shell links to, per viewer. One place, read by the phone tab bar,
 * the + fan, the "עוד" sheet and the desktop header, so a destination cannot be in one
 * and missing from another. Pure functions of the auth state.
 */

/** The 4th tab "הקבוצה": the viewer's own team, else the teams list. */
export function ownTeamPath({ profile, coachTeamIds = [] }) {
  const id = profile?.player?.team_id || coachTeamIds[0]
  return id ? `/teams/${id}` : '/teams'
}

/** Phone tab bar, in tab order (RTL: first = rightmost). The + sits between 2 and 3. */
export function tabs(auth) {
  return [
    { key: 'feed', title: 'המגרש', url: '/', icon: 'rink' },
    { key: 'games', title: 'משחקים', url: '/games', icon: 'cal' },
    { key: 'table', title: 'טבלה', url: '/standings', icon: 'table' },
    { key: 'team', title: 'הקבוצה', url: ownTeamPath(auth), icon: 'shield', match: '/teams' },
  ]
}

/**
 * The + fan: the union of every role's actions, the urgent ones first, at most five,
 * then "עוד". `brand` = a BrandIcons name for the cream bubble; `line` = a stroke icon.
 */
export function fanItems(auth) {
  const { user, isAdmin, hasRole = () => false, coachTeamIds = [], isJudgeRole, isLeagueManager, isContentEditor, canPost, profile } = auth
  const out = []
  const add = (it) => { if (!out.some((o) => o.url === it.url && o.title === it.title)) out.push(it) }
  const isPlayer = !!profile?.player_id
  const isCoach = coachTeamIds.length > 0
  const isRef = hasRole('judge') || isJudgeRole

  if (!user) {
    add({ title: 'משחקים', url: '/games', brand: 'Calendar' })
    add({ title: 'סטטיסטיקות', url: '/statistics', brand: 'StatsIcon' })
    add({ title: 'מדיה', url: '/media', brand: 'VideoLibrary' })
    add({ title: 'התחברות', action: 'auth', line: 'person' })
    return out
  }
  if (isRef) {
    add({ title: 'לוח שיפוט', url: '/judge', brand: 'GameClock' })
    add({ title: 'הזנת תוצאות', url: '/results', brand: 'GameForm' })
  }
  if (isLeagueManager || isAdmin) {
    add({ title: 'ניהול', url: '/admin', brand: 'Manage' })
    if (isContentEditor || isAdmin) add({ title: 'יוצרי תוכן', url: '/creators', brand: 'VideoLibrary' })
  }
  if (isCoach) {
    add({ title: 'סגל למשחק', url: '/games/next', brand: 'Squad' })
    add({ title: 'שחקן בהשאלה', url: '/loans', brand: 'Loan' })
    add({ title: 'ניהול הקבוצה', url: `/teams/${coachTeamIds[0]}`, brand: 'TeamsIcon' })
  }
  if (isPlayer) {
    add({ title: 'מגיע לשבת?', url: '/games/next', brand: 'CalendarCheck' })
    add({ title: 'אישור רפואי', url: '/me#medical', brand: 'Medical' })
    add({ title: 'השאלות', url: '/loans', brand: 'Loan' })
    add({ title: 'סטופר מרקט', url: '/market', brand: 'Coin' })
  }
  if (!isPlayer && !isCoach && !isRef && !isLeagueManager && !isAdmin) {
    add({ title: 'משחקים', url: '/games', brand: 'Calendar' })
    add({ title: 'סטטיסטיקות', url: '/statistics', brand: 'StatsIcon' })
    add({ title: 'מדיה', url: '/media', brand: 'VideoLibrary' })
  }
  const top = out.slice(0, canPost ? 4 : 5)
  if (canPost) top.push({ title: 'פוסט חדש', url: '/?compose=1', line: 'post', tone: 'ink' })
  return top
}

/** The "עוד" sheet: every destination, grouped like the PlusMore board. */
export function moreGroups(auth) {
  const { user, isAdmin, hasRole = () => false, coachTeamIds = [], isJudgeRole, isLeagueManager, isContentEditor, isDeveloper, canPost, profile } = auth
  const g = []
  if (user) {
    g.push({ title: 'שלי', items: [
      { title: 'הדף שלי', url: '/me', brand: 'Profile' },
      ...(profile?.player_id ? [{ title: 'הכרטיס שלי', url: `/players/${profile.player_id}`, brand: 'PlayerIcon' }] : []),
      { title: 'התראות', url: '/notifications', brand: 'Bell' },
      { title: 'השאלות', url: '/loans', brand: 'Loan' },
      ...(profile?.player_id ? [{ title: 'מגיע לשבת?', url: '/games/next', brand: 'CalendarCheck' }] : []),
    ] })
  }
  const create = [
    ...(canPost ? [{ title: 'פוסט חדש', url: '/?compose=1', line: 'post' }] : []),
    ...((isContentEditor || isAdmin) ? [{ title: 'יוצרי תוכן', url: '/creators', brand: 'EditIcon' }] : []),
    ...((isDeveloper || isAdmin) ? [{ title: 'מפתחים', url: '/devs', line: 'code' }] : []),
  ]
  if (create.length) g.push({ title: 'ליצור', items: create })
  g.push({ title: 'הליגה', items: [
    { title: 'טבלה', url: '/standings', brand: 'Table' },
    { title: 'משחקים', url: '/games', brand: 'Calendar' },
    { title: 'סטטיסטיקות', url: '/statistics', brand: 'StatsIcon' },
    { title: 'קבוצות', url: '/teams', brand: 'TeamsIcon' },
    { title: 'שחקנים', url: '/players', brand: 'PlayerIcon' },
    { title: 'טורנירים', url: '/tournaments', brand: 'Trophy' },
    { title: 'מדיה', url: '/media', brand: 'VideoLibrary' },
    { title: 'ארכיון', url: '/archive', brand: 'History' },
    ...(user ? [{ title: 'סטופר מרקט', url: '/market', brand: 'Coin' }] : []),
    { title: 'ליגיונר', url: '/career', brand: 'Star' },
  ] })
  const tools = [
    ...((isAdmin || coachTeamIds.length > 0 || isJudgeRole || isLeagueManager) ? [{ title: 'ניהול', url: '/admin', brand: 'Manage' }] : []),
    ...(hasRole('judge') ? [{ title: 'שיפוט', url: '/judge', brand: 'Referee' }] : []),
    ...((isAdmin || isJudgeRole || isLeagueManager) ? [{ title: 'הזנת תוצאות', url: '/results', brand: 'GameForm' }] : []),
  ]
  if (tools.length) g.push({ title: 'כלים', items: tools })
  g.push({ title: 'הגדרות ועזרה', items: [
    { title: 'מדריך', url: '/guide', brand: 'DocumentIcon' },
    { title: 'האפליקציה', url: '/app', brand: 'AppUpdate' },
    { title: 'עזרה ומשוב', url: '/support', brand: 'Help' },
    { title: 'פרטיות', url: '/privacy', line: 'lock' },
  ] })
  return g
}

/** Desktop header row (lg+): the public destinations; the rest folds into "עוד". */
export const desktopPrimary = [
  { title: 'המגרש', url: '/' },
  { title: 'משחקים', url: '/games' },
  { title: 'טבלה', url: '/standings' },
  { title: 'סטטיסטיקות', url: '/statistics' },
  { title: 'קבוצות', url: '/teams' },
  { title: 'שחקנים', url: '/players' },
  { title: 'השאלות', url: '/loans' },
]

/** Routes that draw their own full-screen chrome: no tab bar, no header. */
export function isFullscreen(pathname) {
  return /^\/games\/[^/]+\/(tv|control)$/.test(pathname) || /^\/judge\/[^/]+/.test(pathname)
}

export function isActive(pathname, url, match) {
  const base = (match || url).split(/[?#]/)[0]
  if (base === '/') return pathname === '/'
  return pathname === base || pathname.startsWith(base + '/')
}
