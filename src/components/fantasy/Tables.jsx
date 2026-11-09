import { useCallback, useEffect, useState } from 'react'
import { Copy, Check, Loader2, LogOut, X } from 'lucide-react'
import { Share, Trophy } from '@/components/icons/BrandIcons'
import { MoreSheet, MoreEmpty, MoreSectionHead } from '@/components/fl/more/MoreKit'
import { Skeleton } from '@/components/ui/Skeleton'
import { cn } from '@/lib/utils'
import {
  getLeaderboard, getEntryRound, createLeague, joinLeague, leaveLeague, inviteLink,
  fromServer, fmtRoundDate,
} from '@/lib/fantasy'
import { RinkLineup } from './Squad'

/** Overall or private-league table. Tap a row → that manager's last round. */
export function Leaderboard({ leagueId = null, state, byId, teamsById, title, note }) {
  const [rows, setRows] = useState(null)
  const [err, setErr] = useState(null)
  const [open, setOpen] = useState(null)

  useEffect(() => {
    let live = true
    setRows(null); setErr(null)
    getLeaderboard(leagueId).then(r => { if (live) setRows(r || []) }).catch(e => { if (live) setErr(e.message) })
    return () => { live = false }
  }, [leagueId])

  return (
    <section>
      {title && <MoreSectionHead title={title} note={note} />}
      {err && <p className="fl-card p-4 text-danger-600 text-sm">{err}</p>}
      {!rows && !err && (
        <div className="fl-card p-3 space-y-2">{[0, 1, 2, 3, 4].map(i => <Skeleton key={i} className="h-12 w-full rounded-xl" />)}</div>
      )}
      {rows && rows.length === 0 && (
        <MoreEmpty icon="trophy" title="עוד אין מנהלים בטבלה" text="הראשונים שבונים קבוצה יופיעו כאן אחרי שהמחזור הבא נעול." />
      )}
      {rows && rows.length > 0 && (
        <ol className="fl-card overflow-hidden divide-y divide-line">
          <li className="grid grid-cols-[2.25rem_1fr_3.5rem_3.5rem] gap-2 px-3 py-2 text-[11.5px] font-bold text-fg-muted">
            <span>#</span><span>קבוצה</span><span className="text-center">מחזור</span><span className="text-center">סה״כ</span>
          </li>
          {rows.map(r => (
            <li key={r.entry_id}>
              <button type="button" onClick={() => state?.last_round && setOpen(r)} disabled={!state?.last_round}
                className={cn('w-full grid grid-cols-[2.25rem_1fr_3.5rem_3.5rem] gap-2 items-center px-3 py-2.5 min-h-[56px] text-start hover:bg-surface-inset',
                  r.is_me && 'bg-brand/8')}>
                <span className={cn('fl-num font-black text-[15px]', r.rank <= 3 ? 'text-gold' : 'text-fg-muted')}>{r.rank}</span>
                <span className="min-w-0">
                  <span className="block font-extrabold text-fg-strong truncate">{r.name}{r.is_me && <span className="text-brand text-[12px] font-bold"> · אתם</span>}</span>
                  <span className="block text-[12.5px] text-fg-muted truncate">{r.manager}</span>
                </span>
                <span className="fl-num text-center text-fg">{r.last_round}</span>
                <span className="fl-num text-center font-black text-fg-strong text-[16px]">{r.total}</span>
              </button>
            </li>
          ))}
        </ol>
      )}
      <EntrySheet entry={open} round={state?.last_round} onClose={() => setOpen(null)} byId={byId} teamsById={teamsById} />
    </section>
  )
}

function EntrySheet({ entry, round, onClose, byId, teamsById }) {
  const [data, setData] = useState(null)
  const [err, setErr] = useState(null)
  useEffect(() => {
    if (!entry || !round) return
    let live = true
    setData(null); setErr(null)
    getEntryRound(entry.entry_id, round).then(d => { if (live) setData(d) }).catch(e => { if (live) setErr(e.message) })
    return () => { live = false }
  }, [entry, round])
  if (!entry) return null
  const pts = data ? new Map(data.players.map(p => [p.player_id, p])) : null
  return (
    <MoreSheet open={!!entry} onClose={onClose} label={entry.name}>
      <div className="flex items-start justify-between gap-3 mb-3">
        <div className="min-w-0">
          <p className="text-[19px] font-extrabold text-fg-strong truncate">{entry.name}</p>
          <p className="text-[13px] text-fg-muted">{entry.manager} · {fmtRoundDate(round)}</p>
        </div>
        <button type="button" onClick={onClose} aria-label="סגירה" className="size-11 shrink-0 grid place-items-center rounded-full hover:bg-surface-inset"><X className="size-5" /></button>
      </div>
      {err && <p className="text-danger-600 text-sm">{err}</p>}
      {!data && !err && <Skeleton className="h-80 w-full rounded-[28px]" />}
      {data && data.players.length === 0 && <p className="text-fg-muted text-sm py-6 text-center">לא היה הרכב במחזור הזה.</p>}
      {data && data.players.length > 0 && (
        <>
          <p className="mb-3 text-[14px]"><span className="fl-num text-[24px] font-black text-fg-strong">{data.score}</span> נקודות במחזור
            {data.transfers > 1 && <span className="text-fg-muted"> · כולל <span dir="ltr" className="fl-num">−{(data.transfers - 1) * 3}</span> על חילופים</span>}</p>
          <RinkLineup lineup={fromServer(data.players.map(p => ({ player_id: p.player_id, slot: p.slot, captain: p.captain })))}
            byId={byId} teamsById={teamsById} points={pts} compact />
        </>
      )}
    </MoreSheet>
  )
}

/** My private leagues: share a code, create one, join one, open its table. */
export function Leagues({ state, byId, teamsById, onChanged, pendingCode, onBuildFirst }) {
  const me = state.me
  const [name, setName] = useState('')
  const [code, setCode] = useState(pendingCode || '')
  const [busy, setBusy] = useState(null)
  const [msg, setMsg] = useState(null)
  const [openId, setOpenId] = useState(me?.leagues?.[0]?.id || null)

  useEffect(() => { if (pendingCode) setCode(pendingCode) }, [pendingCode])

  const run = useCallback(async (key, fn) => {
    setBusy(key); setMsg(null)
    try { const r = await fn(); await onChanged?.(); return r }
    catch (e) { setMsg({ err: true, text: e.message }) }
    finally { setBusy(null) }
  }, [onChanged])

  if (!me) {
    return <MoreEmpty icon="trophy" title="קודם בונים קבוצה" text="ליגה פרטית היא טבלה רק שלכם ושל החברים — ההורים מהקבוצה, החבר׳ה מהעבודה. בנו קבוצה ואז פתחו ליגה או הצטרפו עם קוד."
      action={<button type="button" onClick={onBuildFirst} className="h-11 px-5 rounded-full bg-brand text-brand-fg font-bold">לבנות קבוצה</button>} />
  }

  const leagues = me.leagues || []
  const open = leagues.find(l => l.id === openId)

  return (
    <div className="space-y-6">
      {leagues.length > 0 && (
        <section>
          <MoreSectionHead title="הליגות שלי" />
          <div className="flex gap-2 overflow-x-auto no-scrollbar pb-1">
            {leagues.map(l => (
              <button key={l.id} type="button" onClick={() => setOpenId(l.id)} aria-pressed={openId === l.id}
                className={cn('shrink-0 h-11 px-4 rounded-full text-sm font-bold inline-flex items-center gap-2',
                  openId === l.id ? 'bg-brand text-brand-fg' : 'bg-surface text-fg-strong hover:bg-surface-inset')}>
                {l.name}<span className="fl-num opacity-70 text-[12px]">{l.members}</span>
              </button>
            ))}
          </div>
        </section>
      )}

      {open && (
        <section className="space-y-3">
          <InviteCard league={open} onLeave={!open.owner ? () => run('leave', async () => { await leaveLeague(open.id); setOpenId(null) }) : null} busy={busy === 'leave'} />
          <Leaderboard leagueId={open.id} state={state} byId={byId} teamsById={teamsById} />
        </section>
      )}

      <section className="grid gap-3 sm:grid-cols-2">
        <form className="fl-card p-4 space-y-3" onSubmit={async e => {
          e.preventDefault()
          const r = await run('create', () => createLeague(name))
          if (r?.id) { setName(''); setOpenId(r.id); setMsg({ text: `הליגה נפתחה. הקוד: ${r.code}` }) }
        }}>
          <p className="font-extrabold text-fg-strong">פתיחת ליגה</p>
          <input value={name} onChange={e => setName(e.target.value)} maxLength={32} placeholder="למשל: ההורים של גבעת עדה"
            className="w-full h-11 rounded-control bg-surface-inset px-3 outline-none focus:ring-2 focus:ring-brand/40" />
          <button type="submit" disabled={busy === 'create' || name.trim().length < 2}
            className="w-full h-11 rounded-control bg-brand text-brand-fg font-bold disabled:opacity-50 inline-flex items-center justify-center gap-2">
            {busy === 'create' && <Loader2 className="size-4 animate-spin" />}פתיחה
          </button>
        </form>
        <form className="fl-card p-4 space-y-3" onSubmit={async e => {
          e.preventDefault()
          const r = await run('join', () => joinLeague(code))
          if (r?.id) { setCode(''); setOpenId(r.id); setMsg({ text: `הצטרפתם ל${r.name}` }) }
        }}>
          <p className="font-extrabold text-fg-strong">הצטרפות עם קוד</p>
          <input value={code} onChange={e => setCode(e.target.value.toUpperCase())} maxLength={6} placeholder="ABC123" dir="ltr"
            className="w-full h-11 rounded-control bg-surface-inset px-3 outline-none focus:ring-2 focus:ring-brand/40 fl-num tracking-[.2em] text-center" />
          <button type="submit" disabled={busy === 'join' || code.trim().length !== 6}
            className="w-full h-11 rounded-control bg-surface-inset text-fg-strong font-bold disabled:opacity-50 hover:bg-line inline-flex items-center justify-center gap-2">
            {busy === 'join' && <Loader2 className="size-4 animate-spin" />}הצטרפות
          </button>
        </form>
      </section>
      {msg && <p role="status" className={cn('text-sm', msg.err ? 'text-danger-600' : 'text-success-600')}>{msg.text}</p>}
    </div>
  )
}

function InviteCard({ league, onLeave, busy }) {
  const [copied, setCopied] = useState(false)
  const link = inviteLink(league.code)
  const text = `הצטרפו לליגת הפנטזי "${league.name}" באתר ליגת ההוקי: ${link}`
  const share = async () => {
    if (navigator.share) { try { await navigator.share({ title: league.name, text, url: link }); return } catch { /* cancelled */ } }
    try { await navigator.clipboard.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 2000) } catch { /* ignore */ }
  }
  return (
    <div className="fl-card p-4 flex flex-wrap items-center gap-3">
      <Trophy className="size-8 shrink-0" />
      <div className="flex-1 min-w-[10rem]">
        <p className="font-extrabold text-fg-strong">{league.name}</p>
        <p className="text-[13px] text-fg-muted">קוד הצטרפות <span dir="ltr" className="fl-num font-black text-fg-strong tracking-[.15em]">{league.code}</span> · <span className="fl-num">{league.members}</span> מנהלים</p>
      </div>
      <button type="button" onClick={share} className="h-11 px-4 rounded-full bg-brand text-brand-fg font-bold inline-flex items-center gap-2">
        {copied ? <Check className="size-4" /> : navigator.share ? <Share className="size-4" /> : <Copy className="size-4" />}
        {copied ? 'הועתק' : 'הזמנת חברים'}
      </button>
      {onLeave && (
        <button type="button" onClick={onLeave} disabled={busy} className="h-11 px-3 rounded-full text-fg-muted hover:text-danger-600 inline-flex items-center gap-1.5 text-sm font-bold">
          <LogOut className="size-4" /> עזיבה
        </button>
      )}
    </div>
  )
}
