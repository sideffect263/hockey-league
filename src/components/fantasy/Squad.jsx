import { useMemo, useState } from 'react'
import { Search, Plus, X } from 'lucide-react'
import TeamLogo from '@/components/TeamLogo'
import { Captain } from '@/components/icons/BrandIcons'
import { MoreSheet, MoreChip } from '@/components/fl/more/MoreKit'
import { cn } from '@/lib/utils'
import { blockReason, fmtPrice, isBench, isGkSlot, lineupCost } from '@/lib/fantasy'

/**
 * The rink, top-down: two forwards up top, two behind them, the goalkeeper at the
 * bottom, the bench on a strip underneath. Used for building a lineup (tokens show
 * the price) and for showing a played round (tokens show the points).
 *
 * `lineup` is the SLOTS-ordered array from lib/fantasy; `points` (optional) maps
 * player id → { points, counted, played } for a round that has been played.
 */
export function RinkLineup({ lineup, byId, teamsById, points, onSlot, nextOpp, compact = false }) {
  const starters = lineup.map((s, i) => ({ ...s, i })).filter(s => !isBench(s.slot))
  const bench = lineup.map((s, i) => ({ ...s, i })).filter(s => isBench(s.slot))
  const gk = starters.find(s => s.slot === 'gk')
  const f = starters.filter(s => s.slot === 'f')
  const tok = s => (
    <Token key={s.i} s={s} p={s.player_id ? byId.get(s.player_id) : null} team={s.player_id ? teamsById.get(byId.get(s.player_id)?.team_id) : null}
      pts={points && s.player_id ? points.get(s.player_id) : null} showPoints={!!points}
      opp={nextOpp && s.player_id ? nextOpp(byId.get(s.player_id)?.team_id) : null}
      onClick={onSlot ? () => onSlot(s.i) : undefined} compact={compact} />
  )
  return (
    <div>
      <div className={cn('relative rounded-[28px] overflow-hidden border border-line', compact ? 'px-2 pt-4 pb-9' : 'px-3 pt-6 pb-12 sm:pt-8 sm:pb-14')}
        style={{ background: 'linear-gradient(180deg, rgb(var(--brand) / .10), rgb(var(--brand) / .04))' }}>
        <RinkMarks />
        <div className="relative grid grid-cols-2 gap-y-4 sm:gap-y-6 justify-items-center">
          {f.slice(0, 2).map(tok)}
          {f.slice(2, 4).map(tok)}
          <div className="col-span-2">{gk && tok(gk)}</div>
        </div>
      </div>
      <div className="mt-3 rounded-[22px] bg-surface-inset px-3 py-3">
        <p className="text-[12px] font-bold text-fg-muted mb-2 px-1">ספסל · נכנס אוטומטית אם שחקן מההרכב לא שיחק</p>
        <div className="grid grid-cols-2 justify-items-center">{bench.map(tok)}</div>
      </div>
    </div>
  )
}

function RinkMarks() {
  // Floor lines: centre line, centre circle, both goal areas. Pure decoration.
  return (
    <svg aria-hidden="true" className="absolute inset-0 size-full text-brand/25" viewBox="0 0 100 140" preserveAspectRatio="none">
      <line x1="0" y1="70" x2="100" y2="70" stroke="currentColor" strokeWidth=".6" />
      <circle cx="50" cy="70" r="11" fill="none" stroke="currentColor" strokeWidth=".6" />
      <path d="M30 140 A20 16 0 0 1 70 140" fill="none" stroke="currentColor" strokeWidth=".6" />
      <path d="M30 0 A20 16 0 0 0 70 0" fill="none" stroke="currentColor" strokeWidth=".6" />
    </svg>
  )
}

function Token({ s, p, team, pts, showPoints, opp, onClick, compact }) {
  const Tag = onClick ? 'button' : 'div'
  const label = isGkSlot(s.slot) ? 'שוער' : 'שחקן שדה'
  if (!p) {
    return (
      <Tag type={onClick ? 'button' : undefined} onClick={onClick}
        className="flex flex-col items-center gap-1.5 w-[124px] min-h-[44px] rounded-2xl py-1 text-fg-muted hover:text-fg-strong transition-colors">
        <span className="size-14 rounded-full border-2 border-dashed border-line-strong grid place-items-center bg-surface/60">
          <Plus className="size-5" />
        </span>
        <span className="text-[12.5px] font-bold">{label}</span>
      </Tag>
    )
  }
  const benchOut = showPoints && pts && !pts.counted
  return (
    <Tag type={onClick ? 'button' : undefined} onClick={onClick}
      aria-label={onClick ? `${p.first_name} ${p.last_name} — אפשרויות` : undefined}
      className={cn('relative flex flex-col items-center gap-1 w-[124px] rounded-2xl py-1', onClick && 'active:scale-[.97] transition-transform', benchOut && 'opacity-55')}>
      <span className="relative">
        <TeamLogo team={team} px={compact ? 48 : 56} shadow />
        {s.captain && (
          <span className="absolute -top-1 -end-1 size-6 rounded-full bg-gold text-[12px] font-black text-white grid place-items-center ring-2 ring-surface" title="קפטן — נקודות כפולות">C</span>
        )}
      </span>
      <span className="max-w-full truncate text-[13px] font-extrabold text-fg-strong leading-tight">{p.last_name || p.first_name}</span>
      {showPoints ? (
        <span className={cn('fl-num text-[12px] font-black px-2 py-0.5 rounded-full',
          !pts ? 'bg-surface text-fg-muted' : pts.counted ? 'bg-brand text-brand-fg' : 'bg-surface text-fg-muted')}>
          {!pts ? '—' : !pts.played ? 'לא שיחק' : pts.points}
        </span>
      ) : (
        <span className="text-[11.5px] text-fg-muted leading-tight text-center">
          <span className="fl-num font-bold">{fmtPrice(p.price)}</span>
          {opp && <span> · {opp}</span>}
        </span>
      )}
    </Tag>
  )
}

/** Tap a filled token → what you can do with that player. */
export function PlayerActions({ open, onClose, slotIndex, lineup, byId, teamsById, onCaptain, onSwapBench, onReplace, onRemove }) {
  const s = slotIndex != null ? lineup[slotIndex] : null
  const p = s?.player_id ? byId.get(s.player_id) : null
  if (!p) return null
  const team = teamsById.get(p.team_id)
  const btn = 'w-full h-12 rounded-control font-bold text-[15px] transition-colors'
  return (
    <MoreSheet open={open} onClose={onClose} label={`${p.first_name} ${p.last_name}`}>
      <div className="flex items-center gap-3 mb-4">
        <TeamLogo team={team} px={52} />
        <div className="min-w-0">
          <p className="text-[18px] font-extrabold text-fg-strong truncate">{p.first_name} {p.last_name}</p>
          <p className="text-[13px] text-fg-muted">{team?.name} · {p.gk ? 'שוער' : 'שחקן שדה'} · מחיר <span className="fl-num">{fmtPrice(p.price)}</span></p>
          <p className="text-[13px] text-fg-muted"><span className="fl-num">{p.total}</span> נק׳ העונה · <span className="fl-num">{p.gp}</span> משחקים{!p.gk && <> · <span className="fl-num">{p.goals}</span> שערים</>}</p>
        </div>
      </div>
      <div className="space-y-2">
        {!isBench(s.slot) && !s.captain && (
          <button type="button" onClick={onCaptain} className={cn(btn, 'bg-gold/15 text-fg-strong hover:bg-gold/25 inline-flex items-center justify-center gap-2')}>
            <Captain className="size-5" /> קפטן — נקודות כפולות
          </button>
        )}
        <button type="button" onClick={onSwapBench} className={cn(btn, 'bg-surface-inset text-fg-strong hover:bg-line')}>
          {isBench(s.slot) ? 'להכניס להרכב' : 'להעביר לספסל'}
        </button>
        <button type="button" onClick={onReplace} className={cn(btn, 'bg-brand text-brand-fg hover:bg-brand-hover')}>להחליף בשחקן אחר</button>
        <button type="button" onClick={onRemove} className={cn(btn, 'text-danger-600 hover:bg-danger-50')}>להוציא מהקבוצה</button>
      </div>
    </MoreSheet>
  )
}

const SORTS = [
  { key: 'total', label: 'נקודות' },
  { key: 'price', label: 'מחיר' },
  { key: 'form', label: 'מחזור אחרון' },
  { key: 'picked', label: 'פופולריים' },
]

/** The player list for one slot: search, team filter, sort, a reason on every row you can't pick. */
export function PlayerPicker({ open, onClose, slotIndex, lineup, byId, teams, teamsById, state, onPick, nextOpp }) {
  const [q, setQ] = useState('')
  const [team, setTeam] = useState(null)
  const [sort, setSort] = useState('total')
  const slot = slotIndex != null ? lineup[slotIndex]?.slot : null
  const wantGk = slot ? isGkSlot(slot) : false

  const rows = useMemo(() => {
    if (!slot) return []
    const needle = q.trim()
    const list = state.pool.filter(p => !!p.gk === wantGk && (!team || p.team_id === team) &&
      (!needle || `${p.first_name} ${p.last_name}`.includes(needle) || String(p.number ?? '') === needle))
    const key = { total: p => p.total, price: p => Number(p.price), form: p => p.last ?? -99, picked: p => p.picked ?? 0 }[sort]
    return list
      .map(p => ({ p, why: blockReason(p, slotIndex, lineup, byId, state) }))
      // what you can afford first; the rest stay listed (greyed, with the reason) so the price of a star is visible
      .sort((a, b) => (!!a.why - !!b.why) || (key(b.p) - key(a.p)) || (Number(b.p.price) - Number(a.p.price)))
  }, [slot, q, team, sort, state, lineup, byId, slotIndex, wantGk])

  return (
    <MoreSheet open={open} onClose={onClose} label={wantGk ? 'בחירת שוער' : 'בחירת שחקן שדה'}>
      <div className="flex items-center justify-between mb-3">
        <div>
          <h2 className="text-[20px] font-extrabold text-fg-strong">{wantGk ? 'בחירת שוער' : 'בחירת שחקן שדה'}</h2>
          {slot && <p className="text-[13px] text-fg-muted">נשאר בתקציב <span className="fl-num font-bold text-fg-strong">{fmtPrice(state.budget - lineupCost(lineup, byId) + (lineup[slotIndex].player_id ? Number(byId.get(lineup[slotIndex].player_id)?.price ?? 5) : 0))}</span></p>}
        </div>
        <button type="button" onClick={onClose} aria-label="סגירה" className="size-11 grid place-items-center rounded-full hover:bg-surface-inset"><X className="size-5" /></button>
      </div>
      <label className="relative block mb-3">
        <Search className="size-4 absolute top-1/2 -translate-y-1/2 start-3 text-fg-muted" />
        <input value={q} onChange={e => setQ(e.target.value)} placeholder="חיפוש לפי שם או מספר"
          className="w-full h-11 rounded-control bg-surface-inset ps-9 pe-3 text-[15px] outline-none focus:ring-2 focus:ring-brand/40" />
      </label>
      <div className="flex gap-2 overflow-x-auto no-scrollbar pb-2">
        <MoreChip on={!team} onClick={() => setTeam(null)}>כל הקבוצות</MoreChip>
        {teams.map(t => <MoreChip key={t.id} on={team === t.id} onClick={() => setTeam(team === t.id ? null : t.id)}>{t.name}</MoreChip>)}
      </div>
      <div className="flex items-center gap-2 text-[12.5px] text-fg-muted pb-2">
        <span>מיון:</span>
        {SORTS.map(s => (
          <button key={s.key} type="button" onClick={() => setSort(s.key)} aria-pressed={sort === s.key}
            className={cn('h-8 px-2.5 rounded-full font-bold', sort === s.key ? 'bg-fg-strong text-surface' : 'hover:text-fg-strong')}>{s.label}</button>
        ))}
      </div>
      <ul className="divide-y divide-line">
        {rows.map(({ p, why }) => {
          const t = teamsById.get(p.team_id)
          const opp = nextOpp?.(p.team_id)
          return (
            <li key={p.id}>
              <button type="button" disabled={!!why} onClick={() => onPick(p)}
                className={cn('w-full flex items-center gap-3 py-2.5 text-start min-h-[56px]', why ? 'opacity-50' : 'hover:bg-surface-inset rounded-xl')}>
                <TeamLogo team={t} px={36} />
                <span className="flex-1 min-w-0">
                  <span className="block text-[15px] font-bold text-fg-strong truncate">
                    {p.first_name} {p.last_name}{p.number != null && <span className="fl-num text-fg-muted font-semibold"> #{p.number}</span>}
                  </span>
                  <span className="block text-[12.5px] text-fg-muted truncate">
                    {t?.name}{opp ? ` · ${opp}` : ''}{why ? ` · ${why}` : ''}
                  </span>
                </span>
                <span className="text-end shrink-0">
                  <span className="block fl-num text-[15px] font-extrabold text-fg-strong">{fmtPrice(p.price)}</span>
                  <span className="block fl-num text-[12px] text-fg-muted">{p.total} נק׳</span>
                </span>
              </button>
            </li>
          )
        })}
        {rows.length === 0 && <li className="py-8 text-center text-fg-muted text-sm">אין שחקנים שמתאימים לחיפוש</li>}
      </ul>
    </MoreSheet>
  )
}
