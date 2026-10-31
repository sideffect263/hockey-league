/**
 * Floodlight ניהול shell (board Manage): ONE pattern for every admin tool.
 *   • Index: a summary card ("N פריטים מחכים לך" + per-tool chips) and the tools as tiles,
 *     grouped, each with its brand icon and an open-items badge.
 *   • Desktop: a sticky side rail of the same groups + the tool on the left.
 *   • Phone: index tiles → the tool page with a back link to the index.
 * Only the chrome lives here; every tool component (and its RPCs) is unchanged.
 * The badge counts come from the same "pending" reads the review queues already make,
 * with the same coach scoping; a read that fails shows no badge (never a guessed number).
 */
import { useEffect, useState } from 'react'
import { ChevronRight } from 'lucide-react'
import { BrandIcon } from '@/components/icons/BrandIcons'
import { getPendingTeams } from '@/lib/api'
import { getPendingClaims } from '@/lib/claims'
import { getPendingPlayerSubmissions } from '@/lib/playerSubmissions'
import { getPendingTeamJoins } from '@/lib/teamMembership'
import { getPendingCoachRequests } from '@/lib/coachRequests'
import { getPendingMedical, getPendingManagerMedical } from '@/lib/medical'
import { getPendingGameChangeRequests } from '@/lib/gameRequests'
import { getPendingOfficialRoleRequests, getPendingCardUnlinkRequests } from '@/lib/roleRequests'

/** Per-tool look: brand icon + one line saying what it is for. */
export const TOOL_META = {
  games: { icon: 'calendar', sub: 'כל משחקי העונה · עריכה ותוצאות' },
  calendar: { icon: 'table', sub: 'בניית לוח העונה' },
  players: { icon: 'profile', sub: 'כרטיסי שחקן ושיוך לקבוצה' },
  teams: { icon: 'team', sub: 'אישור ועריכת קבוצות' },
  coaches: { icon: 'squad', sub: 'מאמני הקבוצות' },
  tournaments: { icon: 'trophy', sub: 'טורנירים ולוח משחקים' },
  season: { icon: 'star', sub: 'סגירת עונה וארכיון' },
  claims: { icon: 'verified', sub: 'שיוך לכרטיס, כרטיסים חדשים, הצטרפות' },
  game_requests: { icon: 'reminder', sub: 'אישור מועד חדש למשחק' },
  medical: { icon: 'medical', sub: 'אישורים רפואיים בתוקף' },
  payments: { icon: 'coin', sub: 'מי שילם ומי לא' },
  notifications: { icon: 'bell', sub: 'מי באמת מקבל התראות · מה נשלח' },
  suspensions: { icon: 'referee-red', sub: 'כרטיסים אדומים וחסימות' },
  unavailability: { icon: 'injury', sub: 'מי לא זמין למשחק' },
  birthdates: { icon: 'birthday', sub: 'השלמת תאריכי לידה' },
  officials: { icon: 'referee', sub: 'שיבוץ שופטים וחובשים' },
  venues: { icon: 'location', sub: 'רשימת האולמות' },
  reports: { icon: 'report', sub: 'דיווחים על תוכן' },
  clusters: { icon: 'highlights', sub: 'זיהוי שחקנים בתמונות' },
  analytics: { icon: 'stats', sub: 'שימוש באתר ובאפליקציות' },
  fans: { icon: 'like', sub: 'אוהדים לכל קבוצה · מספרים בלבד' },
  feed_analytics: { icon: 'comment', sub: 'מה נצפה בפיד' },
  stream_audience: { icon: 'broadcast', sub: 'צופים בשידורים החיים' },
  surveys: { icon: 'game-form', sub: 'סקרי הווידאו' },
  calendar_subs: { icon: 'calendar-ok', sub: 'מי מנוי ליומן הליגה' },
  telemetry: { icon: 'waiting', sub: 'שגיאות ואירועי אפליקציה' },
  app_users: { icon: 'app-update', sub: 'מי משתמש באפליקציה ובאיזו גרסה' },
  android_testers: { icon: 'test-game', sub: 'מועמדים לבדיקת Google Play' },
  hidden_features: { icon: 'admin', sub: 'מתגי תכונות מוסתרות' },
  honeypot: { icon: 'warning', sub: 'מי הפעיל פעולות מלכודת' },
  roles: { icon: 'officials', sub: 'תפקידים והרשאות' },
  users: { icon: 'crown', sub: 'מנהלי האתר' },
}

/** Index groups (board Manage). Every tab id appears in exactly one group. */
export const TOOL_GROUPS = [
  { title: 'לוח המשחקים', ids: ['games', 'calendar', 'game_requests', 'officials', 'venues'] },
  { title: 'סגל וקבוצות', ids: ['players', 'teams', 'coaches', 'tournaments', 'birthdates', 'season'] },
  { title: 'רפואה וזמינות', ids: ['medical', 'unavailability', 'suspensions', 'notifications', 'payments'] },
  { title: 'תוכן וקהילה', ids: ['claims', 'fans', 'reports', 'clusters', 'surveys'] },
  { title: 'נתונים וצפייה', ids: ['analytics', 'feed_analytics', 'stream_audience', 'app_users', 'calendar_subs', 'telemetry'] },
  { title: 'מערכת', ids: ['roles', 'users', 'hidden_features', 'android_testers', 'honeypot'] },
]

/** Short chip names for the summary card. */
const CHIP_LABEL = { claims: 'בקשות', medical: 'רפואי', game_requests: 'מועדים', teams: 'קבוצות' }

const n = (p) => p.then((rows) => (Array.isArray(rows) ? rows : [])).catch(() => null)
const len = (rows) => (rows == null ? null : rows.length)
const sumKnown = (...xs) => (xs.every((x) => x == null) ? null : xs.reduce((a, x) => a + (x || 0), 0))

/**
 * Open items per tab: { claims, game_requests, teams, medical } → number | null.
 * `manager` = admin or league manager (the queues only they review); `coachTeamIds` =
 * the coach's teams when the view is coach-scoped (same client guard as the queues).
 */
export function useAdminCounts({ enabled, manager, coachTeamIds, reloadKey = 0 }) {
  const [counts, setCounts] = useState({})
  useEffect(() => {
    if (!enabled) return
    let alive = true
    const scoped = Array.isArray(coachTeamIds) && coachTeamIds.length > 0
    const mine = (tid) => !scoped || coachTeamIds.includes(tid)
    Promise.all([
      n(getPendingClaims()), n(getPendingPlayerSubmissions()), n(getPendingTeamJoins()), n(getPendingMedical()),
      manager ? n(getPendingCoachRequests()) : null,
      manager ? n(getPendingOfficialRoleRequests()) : null,
      manager ? n(getPendingCardUnlinkRequests()) : null,
      manager ? n(getPendingGameChangeRequests()) : null,
      manager ? n(getPendingTeams()) : null,
      manager ? n(getPendingManagerMedical()) : null,
    ]).then(([claims, subs, joins, med, coach, officials, unlinks, gameReq, teams, mgrMed]) => {
      if (!alive) return
      const claimsN = sumKnown(
        len(claims && claims.filter((c) => mine(c.players?.team_id))),
        len(subs && subs.filter((s) => mine(s.team_id))),
        len(joins && joins.filter((r) => mine(r.team_id))),
        len(med && med.filter((i) => mine(i.players?.team_id))),
        len(coach), len(officials), len(unlinks),
      )
      setCounts({
        claims: claimsN,
        claimsBy: {
          claims: len(claims && claims.filter((c) => mine(c.players?.team_id))),
          submissions: len(subs && subs.filter((s) => mine(s.team_id))),
          joins: len(joins && joins.filter((r) => mine(r.team_id))),
          coaches: len(coach), officials: len(officials), unlinks: len(unlinks),
          medical: len(med && med.filter((i) => mine(i.players?.team_id))),
        },
        game_requests: len(gameReq),
        teams: len(teams),
        medical: len(mgrMed),
      })
    })
    return () => { alive = false }
  }, [enabled, manager, (coachTeamIds || []).join(','), reloadKey])
  return counts
}

export function Badge({ value, className = '' }) {
  if (!value) return null
  return (
    <span aria-label={`${value} פתוחים`}
      className={`inline-flex items-center justify-center min-w-[24px] h-6 px-[7px] rounded-full bg-[#E0362C] text-white fl-num text-[13px] leading-none ${className}`}>
      {value}
    </span>
  )
}

/** Board Manage index: summary card + grouped tiles. */
export function AdminIndex({ tabs, counts, onOpen, subs = {}, viewOnly = new Set(), children }) {
  const byId = Object.fromEntries(tabs.map((t) => [t.id, t]))
  const open = tabs.filter((t) => counts[t.id] > 0)
  const total = open.reduce((a, t) => a + counts[t.id], 0)
  const anyKnown = tabs.some((t) => counts[t.id] != null)
  return (
    <div className="space-y-5">
      {anyKnown && (
        <div className="rounded-card bg-[#11161D] text-white p-4 border border-white/5 dark:bg-surface dark:border-line">
          <div className="flex items-center justify-between gap-2">
            <h2 className="text-[17px] font-extrabold">
              {total > 0 ? <><span className="fl-num text-fl-accent text-[22px] me-1.5">{total}</span>פריטים מחכים לך</> : 'אין פריטים פתוחים'}
            </h2>
            {total > 0 && <span className="h-5 px-2 rounded-full bg-fl-accent text-[#11161D] text-[11px] font-extrabold inline-flex items-center">חדש</span>}
          </div>
          {open.length > 0 && (
            <div className="flex flex-wrap gap-2 mt-3">
              {open.map((t) => (
                <button key={t.id} type="button" onClick={() => onOpen(t.id)}
                  className="min-h-[36px] px-3 rounded-full bg-white/10 hover:bg-white/15 text-[13px] font-bold inline-flex items-center gap-1.5 transition-colors">
                  <span className="fl-num text-fl-accent">{counts[t.id]}</span> {CHIP_LABEL[t.id] || t.label}
                </button>
              ))}
            </div>
          )}
          {total === 0 && <p className="text-[13px] text-white/70 mt-1">כל התורים ריקים. בקשות חדשות יופיעו כאן.</p>}
        </div>
      )}

      {TOOL_GROUPS.map((g) => {
        const items = g.ids.map((id) => byId[id]).filter(Boolean)
        if (!items.length) return null
        return (
          <section key={g.title} aria-label={g.title}>
            <h2 className="text-[13px] font-extrabold text-fg-muted mb-2 px-1">{g.title}</h2>
            <div className="grid grid-cols-2 lg:grid-cols-3 gap-2">
              {items.map((t) => (
                <button key={t.id} type="button" onClick={() => onOpen(t.id)}
                  className="group flex items-center gap-2 min-h-[66px] p-2.5 rounded-[18px] bg-surface border border-line text-right hover:border-fg-muted/40 transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-fl-accent">
                  <BrandIcon name={TOOL_META[t.id]?.icon || 'admin'} variant="large" className="w-[30px] h-[30px]" />
                  <span className="flex-1 min-w-0 flex flex-col gap-0.5">
                    <span className="text-[14px] font-extrabold text-fg-strong leading-tight flex items-center gap-1.5">
                      {t.label}
                      {viewOnly.has(t.id) && <span className="h-[18px] px-1.5 rounded-full bg-surface-sunken text-fg-muted text-[10px] font-bold inline-flex items-center">צפייה</span>}
                    </span>
                    <span className="text-[11px] text-fg-muted leading-snug line-clamp-2">{subs[t.id] || TOOL_META[t.id]?.sub}</span>
                  </span>
                  <Badge value={counts[t.id]} />
                </button>
              ))}
            </div>
          </section>
        )
      })}
      {children}
    </div>
  )
}

/** Desktop side rail: the same groups as the index, the open tool highlighted. */
export function AdminRail({ tabs, counts, current, onOpen }) {
  const byId = Object.fromEntries(tabs.map((t) => [t.id, t]))
  return (
    <nav aria-label="כלי ניהול" className="card p-2 flex flex-col gap-0.5 overflow-y-auto max-h-[calc(100vh-7rem)] [scrollbar-width:thin]">
      <RailItem active={!current} onClick={() => onOpen(null)} icon="manage" label="סקירה" />
      {TOOL_GROUPS.map((g) => {
        const items = g.ids.map((id) => byId[id]).filter(Boolean)
        if (!items.length) return null
        return (
          <div key={g.title} className="pt-2">
            <div className="px-3 pb-1 text-[11px] font-extrabold text-fg-muted">{g.title}</div>
            {items.map((t) => (
              <RailItem key={t.id} active={current === t.id} onClick={() => onOpen(t.id)} icon={TOOL_META[t.id]?.icon} label={t.label} badge={counts[t.id]} />
            ))}
          </div>
        )
      })}
    </nav>
  )
}

function RailItem({ active, onClick, icon, label, badge }) {
  return (
    <button type="button" onClick={onClick} aria-current={active ? 'page' : undefined}
      className={`w-full flex items-center gap-2.5 min-h-[40px] px-3 rounded-xl text-[14px] font-semibold transition-colors text-right ${
        active ? 'bg-brand text-brand-fg' : 'text-fg-muted hover:bg-surface-sunken hover:text-fg-strong'}`}>
      <BrandIcon name={icon || 'admin'} className="w-5 h-5" />
      <span className="flex-1 truncate">{label}</span>
      <Badge value={badge} className="!h-5 !min-w-[20px] !text-[11px]" />
    </button>
  )
}

/** The open tool's header: back to the index (phone), icon, title, what it is. */
export function ToolHeader({ tab, onBack, sub }) {
  if (!tab) return null
  return (
    <div className="mb-4 lg:mb-0">
      <button type="button" onClick={onBack} className="lg:hidden inline-flex items-center gap-1 min-h-[44px] -ms-1 pe-2 text-[15px] font-bold text-fg-muted hover:text-fg-strong">
        <ChevronRight className="w-5 h-5" aria-hidden="true" /> ניהול
      </button>
      {/* Desktop: the rail already marks the open tool and most tools carry their own heading. */}
      <div className="flex items-center gap-3 lg:hidden">
        <BrandIcon name={TOOL_META[tab.id]?.icon || 'admin'} variant="large" className="w-9 h-9" />
        <div className="min-w-0">
          <h2 className="text-[26px] sm:text-[30px] font-extrabold leading-none text-fg-strong">{tab.label}</h2>
          {(sub || TOOL_META[tab.id]?.sub) && <p className="text-[13px] text-fg-muted mt-1">{sub || TOOL_META[tab.id].sub}</p>}
        </div>
      </div>
    </div>
  )
}

/** Jump chips over the stacked בקשות queues (board's list pattern: type chips with counts). */
export function ClaimsJump({ by = {}, manager }) {
  const chips = [
    ['claims', 'שיוך', by.claims], ['submissions', 'כרטיס חדש', by.submissions], ['joins', 'הצטרפות', by.joins],
    ...(manager ? [['coaches', 'ניהול קבוצה', by.coaches], ['officials', 'שופט/חובש', by.officials], ['unlinks', 'ניתוק כרטיס', by.unlinks]] : []),
    ['medical', 'רפואי', by.medical],
  ]
  const all = chips.reduce((a, c) => a + (c[2] || 0), 0)
  const go = (id) => document.getElementById(`review-${id}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  return (
    <div className="sticky top-[64px] z-10 -mx-4 px-4 sm:mx-0 sm:px-0 py-2 mb-2 bg-surface-page/95 backdrop-blur-sm">
      <div className="flex gap-2 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        <span className="shrink-0 min-h-[36px] px-3 rounded-full bg-brand text-brand-fg text-[13px] font-bold inline-flex items-center gap-1.5">
          הכל {all > 0 && <span className="fl-num">{all}</span>}
        </span>
        {chips.map(([id, label, c]) => (
          <button key={id} type="button" onClick={() => go(id)}
            className="shrink-0 min-h-[36px] px-3 rounded-full bg-surface border border-line text-fg-strong text-[13px] font-bold inline-flex items-center gap-1.5 hover:border-fg-muted/40">
            {label} {c > 0 && <span className="fl-num text-[#E0362C]">{c}</span>}
          </button>
        ))}
      </div>
    </div>
  )
}

