import { useState, useEffect } from 'react'
import { Trophy, Crown } from "@/components/icons/BrandIcons"
import { getLeaderboard, coins as fmtCoins, START_BALANCE } from '@/lib/market'
import { useAuth } from '@/lib/AuthContext'

function Face({ name, url, big = false }) {
  const size = big ? 'w-14 h-14' : 'w-8 h-8'
  if (url) {
    return <img src={url} alt="" loading="lazy"
      onError={e => { e.currentTarget.style.visibility = 'hidden' }}
      className={`${size} rounded-full object-cover shrink-0 bg-surface-sunken`} />
  }
  return (
    <div className={`${size} rounded-full shrink-0 bg-surface-sunken flex items-center justify-center text-xs font-bold text-fg-muted`}>
      {name?.charAt(0) || '?'}
    </div>
  )
}

const MEDAL = ['text-[#8A5A00] dark:text-[#F2B233]', 'text-fg-muted', 'text-[#9A5B2A] dark:text-[#E0A577]']

/**
 * Ranked by net worth, not by cash. Someone who has moved 900 of their 1,000
 * coins into a position they are winning is doing well, and a cash-only table
 * would rank them last.
 */
export default function Leaderboard() {
  const { user } = useAuth()
  const [rows, setRows] = useState(null)
  const [err, setErr] = useState(null)

  useEffect(() => {
    getLeaderboard().then(setRows).catch(() => setErr(true))
  }, [])

  if (err) return <p className="fl-card text-center text-sm text-fg-muted py-10">לא הצלחנו לטעון את הטבלה</p>
  if (!rows) {
    return <div className="space-y-3"><div className="skeleton h-44 rounded-card" /><div className="skeleton h-64 rounded-card" /></div>
  }
  if (!rows.length) {
    return <p className="fl-card text-center text-sm text-fg-muted py-10">עדיין אף אחד לא נכנס לשוק</p>
  }

  const myIdx = rows.findIndex(r => r.user_id === user?.id)
  const me = myIdx >= 0 ? rows[myIdx] : null
  const ahead = myIdx > 0 ? rows[myIdx - 1] : null
  const podium = rows.slice(0, 3)
  const rest = rows.slice(3)

  return (
    <div className="space-y-4">
      {me && (
        <div className="fl-card px-4 py-3 flex items-center gap-3 bg-[#F2B233]/15">
          <span className="fl-num text-[28px] text-fg-strong">{myIdx + 1}</span>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-bold text-fg-strong">המקום שלך מתוך {rows.length}</p>
            <p className="text-[11px] text-fg-muted">
              {ahead
                ? <>עוד <span className="mkt-coin">{fmtCoins(Number(ahead.total) - Number(me.total))}</span> כדי לעקוף את {ahead.display_name}</>
                : <span className="inline-flex items-center gap-1">אתה בראש הטבלה — תחזיק מעמד <Crown className="w-4 h-4" /></span>}
            </p>
          </div>
          <span className={`fl-num text-lg ${Number(me.total) >= START_BALANCE ? 'text-pos' : 'text-neg'}`}>{fmtCoins(me.total)}</span>
        </div>
      )}

      {/* Podium: 2 · 1 · 3, the winner raised in the middle. */}
      {podium.length >= 3 && (
        <section aria-label="מובילי החיזוי" className="fl-card p-4 pt-5">
          <div className="flex items-baseline justify-between mb-4"><h2 className="text-[21px] font-extrabold text-fg-strong">מובילי החיזוי</h2><span className="text-[12.5px] text-fg-muted">העונה</span></div>
          <div className="grid grid-cols-3 gap-2 items-end">
            {[podium[1], podium[0], podium[2]].map(r => {
              const place = rows.indexOf(r)
              const h = ['h-[104px]', 'h-[76px]', 'h-[60px]'][place]
              return (
                <div key={r.user_id} className="flex flex-col items-center text-center min-w-0">
                  {place === 0 && <Trophy className="w-6 h-6 mb-1" />}
                  <div className={`rounded-full p-[3px] ${place === 0 ? 'bg-[#F2B233]' : place === 1 ? 'bg-[#B9BEC6]' : 'bg-[#C98A52]'}`}>
                    <Face name={r.display_name} url={r.avatar_url} big={place === 0} />
                  </div>
                  <span className="text-xs font-bold text-fg-strong truncate max-w-full mt-1.5">{r.display_name}</span>
                  <span className="fl-num text-[13px] text-fg-strong mt-0.5">{fmtCoins(r.total)}</span>
                  <div className={`w-full ${h} mt-2 rounded-t-2xl flex items-start justify-center pt-2 text-[#11161D] ${
                    place === 0 ? 'bg-[#F2B233]' : place === 1 ? 'bg-[#DDE3EA]' : 'bg-[#EAD7C3]'}`}>
                    <span className="fl-num text-[26px]">{place + 1}</span>
                  </div>
                </div>
              )
            })}
          </div>
        </section>
      )}

      <div className="fl-card overflow-hidden">
        <div className="flex items-center gap-2 px-4 py-3 border-b border-line">
          <Trophy className="w-5 h-5" />
          <h2 className="font-extrabold text-fg-strong text-[15px]">טבלת המובילים</h2>
          <span className="ms-auto text-[12px] text-fg-muted hidden sm:inline">שווי התחזיות = סטופרים + תחזיות פתוחות</span>
        </div>
        <ul className="divide-y divide-line">
          {(podium.length >= 3 ? rest : rows).map(r => {
            const i = rows.indexOf(r)
            const mine = r.user_id === user?.id
            const up = Number(r.total) >= START_BALANCE
            return (
              <li key={r.user_id} className={`flex items-center gap-3 px-4 py-2.5 ${mine ? 'bg-[#F2B233]/15' : ''}`}>
                <span className={`fl-num w-7 text-[15px] ${MEDAL[i] || 'text-fg-muted'}`}>{i + 1}</span>
                <Face name={r.display_name} url={r.avatar_url} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="font-semibold text-sm text-fg-strong truncate">{r.display_name}</span>
                    {mine && <span className="stat-pill bg-fg-strong text-surface text-[11px] px-2 py-0">אני</span>}
                  </div>
                  <p className="text-[12px] text-fg-muted">
                    {fmtCoins(r.balance)} סטופרים · {fmtCoins(r.open_value)} בתחזיות
                  </p>
                </div>
                <span className={`fl-num text-[15px] ${up ? 'text-pos' : 'text-neg'}`}>{fmtCoins(r.total)}</span>
              </li>
            )
          })}
        </ul>
      </div>
    </div>
  )
}
