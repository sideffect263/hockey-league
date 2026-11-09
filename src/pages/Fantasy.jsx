import { useCallback, useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Loader2 } from 'lucide-react'
import { useAuth } from '@/lib/AuthContext'
import { useSeo } from '@/lib/seo'
import { cn } from '@/lib/utils'
import { MorePillTabs, MoreEmpty, MoreSectionHead } from '@/components/fl/more/MoreKit'
import { Skeleton, SkeletonPage, SkeletonTabs } from '@/components/ui/Skeleton'
import { RinkLineup, PlayerActions, PlayerPicker } from '@/components/fantasy/Squad'
import { Leaderboard, Leagues } from '@/components/fantasy/Tables'
import {
  getFantasyState, saveLineup, getEntryRound, joinLeague, leagueByCode,
  emptyLineup, fromServer, lineupCost, lineupProblems, transfersAgainst, transferPenalty,
  fmtPrice, fmtLock, fmtRoundDate, untilText, isBench, SCORING,
} from '@/lib/fantasy'

/**
 * ליגת הפנטזי — /fantasy. Server: supabase/fantasy.sql (the rules live there).
 *
 * Build a squad of 7 real league players (2 GK + 5 field) under a budget of 50,
 * at most 2 from one team. Every game day is a round that locks at its first
 * kickoff; points come straight from the judge sheets (game_stats), so the table
 * moves the moment a judge saves a game.
 *
 * Tabs: הקבוצה שלי (build / last round's points) · טבלה · ליגות (private
 * leagues with an invite code — /fantasy?join=CODE) · חוקים.
 *
 * Gated by league_settings.feature_fantasy: 'on' = everyone; otherwise only
 * admins and developers get past the "בקרוב" card (the server checks too).
 */
export default function Fantasy() {
  useSeo({ title: 'ליגת הפנטזי', description: 'בונים חמישייה משחקני הליגה, צוברים נקודות מהמשחקים האמיתיים ומתחרים בחברים', path: '/fantasy' })
  const { user, openAuth, loading: authLoading } = useAuth()
  const [params, setParams] = useSearchParams()
  const [state, setState] = useState(null)
  const [err, setErr] = useState(null)
  const tab = params.get('tab') || 'team'
  const setTab = t => setParams(p => { const n = new URLSearchParams(p); if (t === 'team') n.delete('tab'); else n.set('tab', t); return n }, { replace: true })
  const joinCode = params.get('join')

  const load = useCallback(async () => {
    try { setState(await getFantasyState()); setErr(null) } catch (e) { setErr(e.message) }
  }, [])
  useEffect(() => { if (!authLoading) load() }, [authLoading, user?.id, load])

  const byId = useMemo(() => new Map((state?.pool || []).map(p => [p.id, p])), [state])
  const teamsById = useMemo(() => new Map((state?.teams || []).map(t => [t.id, t])), [state])

  if (err) return <Shell><MoreEmpty icon="warning" title="לא הצלחנו לטעון" text={err} action={<button type="button" onClick={load} className="h-11 px-5 rounded-full bg-brand text-brand-fg font-bold">לנסות שוב</button>} /></Shell>
  if (!state) return <FantasySkeleton />
  if (!state.season) return <Shell><MoreEmpty icon="calendar" title="אין עונה פעילה" text="ליגת הפנטזי תיפתח עם העונה הבאה." /></Shell>
  if (!state.enabled) return <Shell><MoreEmpty icon="trophy" title="ליגת הפנטזי נפתחת בקרוב" text="בונים חמישייה משחקני הליגה, צוברים נקודות מהמשחקים האמיתיים ומתחרים בחברים. עוד קצת." /></Shell>

  const open = state.rounds.find(r => r.date === state.open_round)
  const last = state.rounds.find(r => r.date === state.last_round)

  return (
    <Shell>
      <header className="mb-4">
        <h1 className="text-[28px] sm:text-[34px] font-black text-fg-strong leading-tight text-balance">ליגת הפנטזי</h1>
        <p className="text-[14px] text-fg-muted mt-1 text-pretty">
          {open
            ? <>מחזור <span className="fl-num">{open.no}</span> · ננעל {fmtLock(open.lock_at)} · <span className="font-bold text-fg-strong">{untilText(open.lock_at)}</span></>
            : 'כל המחזורים של העונה ננעלו'}
          {' · '}<span className="fl-num">{state.entries}</span> מנהלים
        </p>
      </header>

      <JoinBanner code={joinCode} state={state} user={user} openAuth={openAuth}
        onJoined={async () => { await load(); setParams(p => { const n = new URLSearchParams(p); n.delete('join'); n.set('tab', 'leagues'); return n }, { replace: true }) }}
        onBuild={() => setTab('team')} />

      <MorePillTabs className="mb-5" label="ליגת הפנטזי" value={tab} onChange={setTab} tabs={[
        { key: 'team', label: 'הקבוצה שלי' },
        { key: 'table', label: 'טבלה' },
        { key: 'leagues', label: 'ליגות', n: state.me?.leagues?.length || null },
        { key: 'rules', label: 'חוקים' },
      ]} />

      {tab === 'team' && (
        user
          ? <MyTeam state={state} byId={byId} teamsById={teamsById} open={open} last={last} reload={load} joinCode={joinCode} />
          : <SignedOut openAuth={openAuth} />
      )}
      {tab === 'table' && <Leaderboard state={state} byId={byId} teamsById={teamsById} title="הטבלה הכללית" note={last ? `אחרי מחזור ${last.no}` : 'לפני המחזור הראשון'} />}
      {tab === 'leagues' && (
        user
          ? <Leagues state={state} byId={byId} teamsById={teamsById} onChanged={load} pendingCode={joinCode} onBuildFirst={() => setTab('team')} />
          : <SignedOut openAuth={openAuth} />
      )}
      {tab === 'rules' && <Rules state={state} />}
    </Shell>
  )
}

function Shell({ children }) {
  return <div className="max-w-5xl mx-auto px-4 sm:px-6 pt-5 sm:pt-8 pb-28">{children}</div>
}

function FantasySkeleton() {
  return (
    <SkeletonPage width="max-w-5xl">
      <Skeleton className="h-9 w-56 rounded-[10px]" />
      <Skeleton className="h-4 w-80 max-w-full" />
      <SkeletonTabs count={4} />
      <div className="lg:grid lg:grid-cols-[minmax(0,1fr)_340px] lg:gap-6 space-y-4 lg:space-y-0">
        <Skeleton className="h-[460px] w-full rounded-[28px]" />
        <Skeleton className="h-64 w-full rounded-card" />
      </div>
    </SkeletonPage>
  )
}

function SignedOut({ openAuth }) {
  return (
    <div className="fl-card p-6 sm:p-8 text-center">
      <p className="text-[20px] font-extrabold text-fg-strong text-balance">בונים קבוצה משחקני הליגה האמיתיים</p>
      <p className="text-[14px] text-fg-muted mt-2 max-w-md mx-auto text-pretty">
        7 שחקנים, תקציב של 50, קפטן שמקבל נקודות כפולות. כל שער, ניצחון ושער נקי במשחקים של שבת נכנס לטבלה שלכם — ואפשר לפתוח ליגה פרטית עם החברים.
      </p>
      <button type="button" onClick={openAuth} className="mt-5 h-12 px-6 rounded-full bg-brand text-brand-fg font-bold">להתחבר ולבנות קבוצה</button>
    </div>
  )
}

/** ?join=CODE — say which league, and join it (or say what's missing first). */
function JoinBanner({ code, state, user, openAuth, onJoined, onBuild }) {
  const [league, setLeague] = useState(undefined)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState(null)
  useEffect(() => {
    if (!code) return
    let live = true
    leagueByCode(code).then(l => { if (live) setLeague(l || null) }).catch(() => { if (live) setLeague(null) })
    return () => { live = false }
  }, [code])
  if (!code || league === undefined) return null
  if (league === null) return <p className="fl-card p-4 mb-4 text-sm text-fg-muted">הקוד <span dir="ltr" className="fl-num font-bold">{code}</span> לא מתאים לאף ליגה.</p>
  const member = state.me?.leagues?.some(l => l.id === league.id)
  if (member) return null
  return (
    <div className="fl-card p-4 mb-4 border-2 border-brand flex flex-wrap items-center gap-3">
      <div className="flex-1 min-w-[12rem]">
        <p className="text-[12px] font-bold text-brand">הזמנה לליגה פרטית</p>
        <p className="font-extrabold text-fg-strong">{league.name}</p>
        <p className="text-[13px] text-fg-muted"><span className="fl-num">{league.members}</span> מנהלים · נפתחה ע״י {league.owner}</p>
      </div>
      {!user ? (
        <button type="button" onClick={openAuth} className="h-11 px-5 rounded-full bg-brand text-brand-fg font-bold">להתחבר</button>
      ) : !state.me ? (
        <button type="button" onClick={onBuild} className="h-11 px-5 rounded-full bg-surface-inset text-fg-strong font-bold">קודם לבנות קבוצה</button>
      ) : (
        <button type="button" disabled={busy} onClick={async () => {
          setBusy(true); setMsg(null)
          try { await joinLeague(code); await onJoined() } catch (e) { setMsg(e.message) } finally { setBusy(false) }
        }} className="h-11 px-5 rounded-full bg-brand text-brand-fg font-bold inline-flex items-center gap-2">
          {busy && <Loader2 className="size-4 animate-spin" />}הצטרפות
        </button>
      )}
      {msg && <p className="w-full text-sm text-danger-600">{msg}</p>}
    </div>
  )
}

function MyTeam({ state, byId, teamsById, open, last, reload, joinCode }) {
  const me = state.me
  const [lineup, setLineup] = useState(() => me?.lineup?.length ? fromServer(me.lineup) : emptyLineup())
  const [name, setName] = useState(me?.name || '')
  const [view, setView] = useState(open ? 'edit' : 'last')
  const [pickFor, setPickFor] = useState(null)
  const [actFor, setActFor] = useState(null)
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState(null)
  const [round, setRound] = useState(null)

  // Re-seed from the server after a save / reload, unless you have unsaved edits.
  const serverKey = JSON.stringify(me?.lineup || [])
  const [seenKey, setSeenKey] = useState(serverKey)
  useEffect(() => {
    if (serverKey !== seenKey) { setSeenKey(serverKey); setLineup(me?.lineup?.length ? fromServer(me.lineup) : emptyLineup()); setName(me?.name || '') }
  }, [serverKey]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!me || !last) { setRound(null); return }
    let live = true
    getEntryRound(me.entry_id, last.date).then(d => { if (live) setRound(d) }).catch(() => { if (live) setRound(null) })
    return () => { live = false }
  }, [me?.entry_id, last?.date]) // eslint-disable-line react-hooks/exhaustive-deps

  const nextOpp = useMemo(() => {
    if (!open) return null
    const games = state.fixtures.filter(g => g.round_date === open.date)
    return teamId => {
      const g = games.find(x => x.home === teamId || x.away === teamId)
      if (!g) return 'לא משחקת'
      const other = teamsById.get(g.home === teamId ? g.away : g.home)
      return `נגד ${other?.name || '?'}`
    }
  }, [open, state.fixtures, teamsById])

  const cost = lineupCost(lineup, byId)
  const left = state.budget - cost
  const transfers = transfersAgainst(lineup, me?.base_squad)
  const penalty = transferPenalty(transfers, state.transfer_cost)
  const problems = lineupProblems(lineup, byId, state, name)
  const savedKey = JSON.stringify(fromServer(me?.lineup || []))
  const dirty = JSON.stringify(lineup) !== savedKey || (name.trim() !== (me?.name || ''))

  const set = fn => { setLineup(l => fn(l.map(s => ({ ...s })))); setMsg(null) }
  const onSlot = i => (lineup[i].player_id ? setActFor(i) : setPickFor(i))
  const pick = p => {
    set(l => {
      const hadCaptain = l[pickFor].captain
      l[pickFor] = { ...l[pickFor], player_id: p.id, captain: hadCaptain }
      // first two starters picked: make the first field player captain so a new squad is never captain-less
      if (!l.some(s => s.captain) && !isBench(l[pickFor].slot)) l[pickFor].captain = true
      return l
    })
    setPickFor(null)
  }
  const captain = () => { set(l => l.map((s, k) => ({ ...s, captain: k === actFor }))); setActFor(null) }
  const swapBench = () => {
    set(l => {
      const s = l[actFor]
      const want = { gk: 'bgk', bgk: 'gk', f: 'bf', bf: 'f' }[s.slot]
      const j = l.findIndex((x, k) => k !== actFor && x.slot === want)
      if (j < 0) return l
      const hadArmband = l[actFor].captain || l[j].captain
      ;[l[actFor].player_id, l[j].player_id] = [l[j].player_id, l[actFor].player_id]
      // The armband never sits on the bench: if the captain was one of the two,
      // it goes to whichever of them is now starting.
      l[actFor].captain = false; l[j].captain = false
      const starter = isBench(l[actFor].slot) ? j : actFor
      if (hadArmband && l[starter].player_id) l[starter].captain = true
      return l
    })
    setActFor(null)
  }
  const replace = () => { const i = actFor; setActFor(null); setPickFor(i) }
  const remove = () => { set(l => { l[actFor] = { ...l[actFor], player_id: null, captain: false }; return l }); setActFor(null) }

  const save = async () => {
    setSaving(true); setMsg(null)
    try {
      await saveLineup(name, lineup)
      if (joinCode && !me) { try { await joinLeague(joinCode) } catch { /* the banner will offer it again */ } }
      await reload()
      setMsg({ ok: true, text: `נשמר למחזור ${open?.no}. אפשר לשנות עד שהמחזור ננעל.` })
    } catch (e) { setMsg({ ok: false, text: e.message }) }
    finally { setSaving(false) }
  }

  const roundPts = round ? new Map(round.players.map(p => [p.player_id, p])) : null
  const roundLineup = round ? fromServer(round.players.map(p => ({ player_id: p.player_id, slot: p.slot, captain: p.captain }))) : null
  const total = (me?.rounds || []).reduce((s, r) => s + r.points, 0)

  return (
    <div className="flex flex-col gap-5 lg:grid lg:grid-cols-[minmax(0,1fr)_340px] lg:gap-6">
      <div>
        {(open && round) && (
          <div role="tablist" aria-label="תצוגה" className="inline-flex p-1 rounded-full bg-surface-inset mb-3">
            {[['edit', `הרכב למחזור ${open.no}`], ['last', `נקודות מחזור ${last.no}`]].map(([k, l]) => (
              <button key={k} type="button" role="tab" aria-selected={view === k} onClick={() => setView(k)}
                className={cn('h-10 px-4 rounded-full text-[14px] font-bold', view === k ? 'bg-surface text-fg-strong shadow-sm' : 'text-fg-muted')}>{l}</button>
            ))}
          </div>
        )}
        {view === 'last' && roundLineup ? (
          <RinkLineup lineup={roundLineup} byId={byId} teamsById={teamsById} points={roundPts} />
        ) : open ? (
          <RinkLineup lineup={lineup} byId={byId} teamsById={teamsById} onSlot={onSlot} nextOpp={nextOpp} />
        ) : (
          <MoreEmpty icon="calendar" title="העונה הסתיימה" text="אין עוד מחזורים פתוחים. הטבלה הסופית בלשונית טבלה." />
        )}
      </div>

      {/* On a phone the budget + save card comes first, so you see what's left while picking. */}
      <aside className="space-y-4 order-first lg:order-none">
        {view === 'last' && round ? (
          <div className="fl-card p-5">
            <p className="text-[12px] font-bold text-fg-muted">מחזור {last.no} · {fmtRoundDate(last.date)}</p>
            <p className="mt-1"><span className="fl-num text-[40px] font-black text-fg-strong leading-none">{round.score}</span> <span className="text-fg-muted">נקודות</span></p>
            {round.transfers > 1 && <p className="text-[13px] text-fg-muted mt-1">כולל <span dir="ltr" className="fl-num">−{transferPenalty(round.transfers, state.transfer_cost)}</span> על חילופים</p>}
            <p className="text-[13px] text-fg-muted mt-3">סה״כ העונה: <span className="fl-num font-bold text-fg-strong">{total}</span></p>
          </div>
        ) : open && (
          <div className="fl-card p-5 space-y-4">
            <label className="block">
              <span className="text-[12px] font-bold text-fg-muted">שם הקבוצה</span>
              <input value={name} onChange={e => { setName(e.target.value); setMsg(null) }} maxLength={24} placeholder="למשל: הסטיק הזהב"
                className="mt-1 w-full h-11 rounded-control bg-surface-inset px-3 text-[15px] font-bold outline-none focus:ring-2 focus:ring-brand/40" />
            </label>
            <dl className="grid grid-cols-3 gap-2 text-center">
              <Stat label="נשאר בתקציב" value={fmtPrice(left)} warn={left < 0} />
              <Stat label="שחקנים" value={`${lineup.filter(s => s.player_id).length}/7`} />
              <Stat label="חילופים" value={me?.base_squad?.length ? String(transfers) : 'חופשי'} warn={penalty > 0} />
            </dl>
            {penalty > 0 && <p className="text-[13px] text-warning-700">חילוף אחד בכל מחזור בחינם — כל חילוף נוסף <span dir="ltr" className="fl-num">−{state.transfer_cost}</span> נקודות. כרגע: <span dir="ltr" className="fl-num font-bold">−{penalty}</span></p>}
            {problems.length > 0 && dirty && (
              <ul className="text-[13px] text-fg-muted space-y-0.5 list-disc ps-4">{problems.map(p => <li key={p}>{p}</li>)}</ul>
            )}
            <button type="button" onClick={save} disabled={saving || problems.length > 0 || !dirty}
              className="w-full h-12 rounded-control bg-brand text-brand-fg font-bold text-[16px] disabled:opacity-45 inline-flex items-center justify-center gap-2">
              {saving && <Loader2 className="size-4 animate-spin" />}
              {me ? (dirty ? 'שמירת השינויים' : 'ההרכב שמור') : 'יצירת הקבוצה'}
            </button>
            {msg && <p role="status" className={cn('text-[13px]', msg.ok ? 'text-success-600' : 'text-danger-600')}>{msg.text}</p>}
            <p className="text-[12px] text-fg-muted text-pretty">לוחצים על שחקן כדי לבחור קפטן, להעביר לספסל או להחליף. עד 2 שחקנים מאותה קבוצה.</p>
          </div>
        )}
        {me?.rounds?.length > 0 && (
          <div className="fl-card p-4">
            <MoreSectionHead title="העונה שלי" note={`${total} נק׳`} className="!px-0" />
            <ol className="flex gap-1.5 flex-wrap">
              {me.rounds.map(r => {
                const no = state.rounds.find(x => x.date === r.date)?.no
                return <li key={r.date} title={fmtRoundDate(r.date)} className="min-w-11 h-11 px-2 rounded-xl bg-surface-inset grid place-items-center leading-none">
                  <span className="text-[10px] text-fg-muted">מ׳ {no}</span><span className="fl-num font-black text-fg-strong">{r.points}</span>
                </li>
              })}
            </ol>
          </div>
        )}
      </aside>

      <PlayerPicker open={pickFor != null} onClose={() => setPickFor(null)} slotIndex={pickFor} lineup={lineup} byId={byId}
        teams={state.teams} teamsById={teamsById} state={state} onPick={pick} nextOpp={nextOpp} />
      <PlayerActions open={actFor != null} onClose={() => setActFor(null)} slotIndex={actFor} lineup={lineup} byId={byId} teamsById={teamsById}
        onCaptain={captain} onSwapBench={swapBench} onReplace={replace} onRemove={remove} />
    </div>
  )
}

function Stat({ label, value, warn }) {
  return (
    <div className="rounded-xl bg-surface-inset py-2">
      <dt className="text-[11px] text-fg-muted">{label}</dt>
      <dd className={cn('fl-num text-[18px] font-black', warn ? 'text-danger-600' : 'text-fg-strong')}>{value}</dd>
    </div>
  )
}

function Rules({ state }) {
  return (
    <div className="grid gap-5 lg:grid-cols-2">
      <section className="fl-card p-5">
        <MoreSectionHead title="איך משחקים" className="!px-0" />
        <ul className="space-y-2 text-[14px] text-fg list-disc ps-5 text-pretty">
          <li>בוחרים 7 שחקנים מהליגה: 2 שוערים ו-5 שחקני שדה, בתקציב של <span className="fl-num">{state.budget}</span>.</li>
          <li>בהרכב: שוער ו-4 שחקני שדה. על הספסל: שוער ושחקן שדה — הם נכנסים אוטומטית אם שחקן מההרכב לא שיחק.</li>
          <li>הקפטן מקבל נקודות כפולות.</li>
          <li>עד <span className="fl-num">{state.max_per_team}</span> שחקנים מאותה קבוצה. שחקנים לא יכולים לבחור את עצמם.</li>
          <li>כל יום משחקים הוא מחזור. ההרכב ננעל בשריקת הפתיחה של המשחק הראשון באותו יום.</li>
          <li>חילוף אחד בכל מחזור בחינם; כל חילוף נוסף <span dir="ltr" className="fl-num">−{state.transfer_cost}</span> נקודות. עד המחזור הראשון שלכם — כל השינויים חופשיים.</li>
          <li>הנקודות מגיעות ישר מדף השיפוט — ברגע שהשופט שומר את המשחק, הטבלה מתעדכנת.</li>
        </ul>
      </section>
      <section className="fl-card p-5">
        <MoreSectionHead title="ניקוד" className="!px-0" />
        <table className="w-full text-[14px]">
          <tbody className="divide-y divide-line">
            {SCORING.map(r => (
              <tr key={r.label}><td className="py-2 text-fg">{r.label}</td><td className={cn('py-2 text-end fl-num font-black', r.pts.startsWith('−') ? 'text-danger-600' : 'text-fg-strong')}><span dir="ltr">{r.pts}</span></td></tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  )
}
