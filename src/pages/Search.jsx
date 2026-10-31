import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { getTeams, getPlayers } from '@/lib/api'
import { entityPath } from '@/lib/slugs'
import TeamLogo from '@/components/TeamLogo'
import { LineIcon } from '@/components/fl/shell/FLShell'

/**
 * League search (the header magnifier + the "עוד" sheet): teams and players, matched
 * as you type. Data is the same public lists the teams/players pages load.
 */
export default function Search() {
  const [params, setParams] = useSearchParams()
  const [q, setQ] = useState(params.get('q') || '')
  const [teams, setTeams] = useState([])
  const [players, setPlayers] = useState([])
  const [loading, setLoading] = useState(true)
  const input = useRef(null)

  useEffect(() => { input.current?.focus() }, [])
  useEffect(() => {
    Promise.all([getTeams().catch(() => []), getPlayers().catch(() => [])])
      .then(([t, p]) => { setTeams(t || []); setPlayers(p || []) })
      .finally(() => setLoading(false))
  }, [])
  useEffect(() => {
    const t = setTimeout(() => setParams(q.trim() ? { q: q.trim() } : {}, { replace: true }), 250)
    return () => clearTimeout(t)
  }, [q, setParams])

  const term = q.trim()
  const teamById = useMemo(() => Object.fromEntries(teams.map((t) => [t.id, t])), [teams])
  const tHits = term ? teams.filter((t) => t.name?.includes(term) || t.city?.includes(term)) : []
  const pHits = term ? players.filter((p) => `${p.first_name} ${p.last_name}`.includes(term)).slice(0, 40) : []

  return (
    <div className="max-w-2xl mx-auto px-4 pt-4 pb-10">
      <h1 className="page-title mb-3">חיפוש</h1>
      <label className="flex items-center gap-2 h-12 px-3 rounded-control bg-surface border border-line text-fg-muted focus-within:ring-2 focus-within:ring-fl-accent">
        <LineIcon name="search" size={22} />
        <span className="sr-only">חיפוש שחקן או קבוצה</span>
        <input ref={input} value={q} onChange={(e) => setQ(e.target.value)} placeholder="שחקן או קבוצה"
          enterKeyHint="search" className="flex-1 min-w-0 bg-transparent text-[16px] text-fg-strong placeholder:text-fg-subtle outline-none" />
      </label>

      {!term && <p className="mt-6 text-fg-muted text-[15px]">הקלידו שם של שחקן או קבוצה.</p>}
      {term && !loading && !tHits.length && !pHits.length && (
        <p className="mt-6 text-fg-muted text-[15px]">לא מצאנו את „{term}”.</p>
      )}

      {tHits.length > 0 && (
        <section className="mt-6">
          <h2 className="fl-eyebrow mb-2">קבוצות</h2>
          <ul className="fl-card divide-y divide-line overflow-hidden">
            {tHits.map((t) => (
              <li key={t.id}>
                <Link to={entityPath('teams', t) || `/teams/${t.id}`} className="flex items-center gap-3 px-4 min-h-[56px] hover:bg-surface-inset">
                  <TeamLogo team={t} px={36} />
                  <span className="font-bold text-fg-strong">{t.name}</span>
                  {t.city && <span className="text-[13px] text-fg-muted">{t.city}</span>}
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      {pHits.length > 0 && (
        <section className="mt-6">
          <h2 className="fl-eyebrow mb-2">שחקנים</h2>
          <ul className="fl-card divide-y divide-line overflow-hidden">
            {pHits.map((p) => (
              <li key={p.id}>
                <Link to={entityPath('players', p) || `/players/${p.id}`} className="flex items-center gap-3 px-4 min-h-[56px] hover:bg-surface-inset">
                  <TeamLogo team={teamById[p.team_id]} px={32} />
                  <span className="font-bold text-fg-strong">{p.first_name} {p.last_name}</span>
                  <span className="text-[13px] text-fg-muted">{teamById[p.team_id]?.name}</span>
                  {p.jersey_number != null && <span className="ms-auto fl-num text-fg-muted">#{p.jersey_number}</span>}
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  )
}
