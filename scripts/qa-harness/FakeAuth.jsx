// Harness-only AuthContext: same shape as src/lib/AuthContext.jsx, role from ?as=.
import { createContext, useContext, useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'

const Ctx = createContext()
const ROLES = ['guest', 'fan', 'player', 'coach', 'lm', 'ref', 'admin']

function pickRole() {
  const q = new URLSearchParams(window.location.search).get('as')
  if (q && ROLES.includes(q)) sessionStorage.setItem('harness-as', q)
  return sessionStorage.getItem('harness-as') || 'guest'
}

export function AuthProvider({ children }) {
  const [as] = useState(pickRole)
  const [team, setTeam] = useState(null)
  const [player, setPlayer] = useState(null)
  const [authOpen, setAuthOpen] = useState(false)
  const [loading, setLoading] = useState(as !== 'guest')

  useEffect(() => {
    if (as === 'guest') return
    ;(async () => {
      const { data: teams } = await supabase.from('teams').select('id, name, primary_color').order('points', { ascending: false }).limit(1)
      const t = teams?.[0] || null
      setTeam(t)
      if (t && (as === 'player' || as === 'coach')) {
        const { data: ps } = await supabase.from('players').select('id, first_name, last_name, team_id').eq('team_id', t.id).limit(1)
        setPlayer(ps?.[0] || null)
      }
      setLoading(false)
    })()
  }, [as])

  const user = as === 'guest' ? null : { id: '00000000-0000-4000-8000-000000000000', email: `${as}@harness.localhost` }
  const roles = as === 'coach' && team ? [{ role: 'coach', team_id: team.id }]
    : as === 'lm' ? [{ role: 'league_manager', team_id: null }]
    : as === 'ref' ? [{ role: 'judge', team_id: null }]
    : []
  const isAdmin = as === 'admin'
  const hasRole = (r) => isAdmin || roles.some((x) => x.role === r)
  const coachTeamIds = roles.filter((r) => r.role === 'coach').map((r) => r.team_id)
  const isJudgeRole = roles.some((r) => r.role === 'judge')
  const isLeagueManager = roles.some((r) => r.role === 'league_manager')
  const profile = !user ? null : {
    display_name: { fan: 'אוהד בדיקה', player: player ? `${player.first_name} ${player.last_name}` : 'שחקן בדיקה', coach: 'מאמן בדיקה', lm: 'מנהל ליגה בדיקה', ref: 'שופט בדיקה', admin: 'מנהל בדיקה' }[as],
    avatar_url: null,
    player_id: (as === 'player' || as === 'coach') ? player?.id || null : null,
    player: (as === 'player' || as === 'coach') ? player : null,
    teamColor: team?.primary_color || null, teamName: team?.name || null,
  }
  const noop = async () => {}
  const value = {
    user, isAdmin, roles, hasRole, coachTeamIds, isJudgeRole, isContentEditor: false, isLeagueManager, isMedic: false,
    isDeveloper: false, canPost: isAdmin || coachTeamIds.length > 0 || isJudgeRole || isLeagueManager,
    profile, refreshProfile: noop, loading, authOpen,
    signInWithGoogle: noop, signUpWithEmail: noop, signInWithEmail: noop, resetPassword: noop, updatePassword: noop,
    signOut: async () => { sessionStorage.setItem('harness-as', 'guest'); window.location.search = '?as=guest' },
    openAuth: () => setAuthOpen(true), closeAuth: () => setAuthOpen(false),
  }
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export const useAuth = () => useContext(Ctx)
