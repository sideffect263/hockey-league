import { createContext, useContext, useState, useEffect, useRef } from 'react'
import { supabase } from './supabase'
import { sessionUser } from './sessionUser'

const AuthContext = createContext()

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null)
  const [isAdmin, setIsAdmin] = useState(false)
  const [roles, setRoles] = useState([]) // rows from user_roles: { role, team_id }
  // Editable profile + the linked player's team color, for the navbar avatar.
  // Shape: { display_name, avatar_url, player_id, player, teamColor } | null
  const [profile, setProfile] = useState(null)
  const [loading, setLoading] = useState(true)
  const [authOpen, setAuthOpen] = useState(false)

  // Whose account (admin flag, roles, profile) is loaded or loading. The bootstrap
  // is three queries queued behind supabase-js's auth lock, and on page load both
  // getSession() and onAuthStateChange hand us the same user — INITIAL_SESSION,
  // then SIGNED_IN from the client's own session recovery (it fires again on every
  // tab refocus), then TOKEN_REFRESHED. Loading on each ran it 3x and held back
  // every page's first data request. Only a different user id reloads.
  const loadedFor = useRef(null)

  useEffect(() => {
    let mounted = true

    const apply = (u, event) => {
      if (!mounted) return
      const next = u ?? null
      // Keep the same object for the same account, so effects keyed on `user` don't
      // refetch on every token refresh. USER_UPDATED carries a changed email/metadata.
      setUser(prev => (prev && next && prev.id === next.id && event !== 'USER_UPDATED') ? prev : next)
      if (!next) {
        loadedFor.current = null
        setIsAdmin(false)
        setRoles([])
        setProfile(null)
        setLoading(false)
        return
      }
      if (loadedFor.current === next.id && event !== 'USER_UPDATED') return
      // A different account: drop the previous one's permissions BEFORE loading, because a
      // failed load now keeps what is there (see loadRoles) — it must never be someone else's.
      if (loadedFor.current !== next.id) { setIsAdmin(false); setRoles([]) }
      loadedFor.current = next.id
      loadAccount(next)
    }

    // Get initial session. A rejected getSession() must still clear `loading`,
    // otherwise the whole app is stuck on the spinner forever.
    supabase.auth.getSession()
      .then(({ data: { session } }) => apply(session?.user, 'GET_SESSION'))
      .catch(() => { if (mounted) setLoading(false) })

    // Listen for auth changes
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (!mounted) return
      if (session?.user && event === 'SIGNED_IN') setAuthOpen(false) // close the auth modal once signed in
      apply(session?.user, event)
    })

    return () => { mounted = false; subscription.unsubscribe() }
  }, [])

  // Resolve admin status + granted roles + profile for a signed-in user.
  const loadAccount = async (u) => {
    await Promise.all([checkAdmin(u.email), loadRoles(u.id), loadProfile(u.id)])
    if (loadedFor.current === u.id) setLoading(false)
  }

  // Load the editable profile and, if the account is linked to a player,
  // that player's team color (for the navbar avatar's "paired" state).
  // Players/teams are fetched separately, matching the rest of the app
  // (see the embed-ambiguity gotcha — no nested profiles→players embed).
  const loadProfile = async (userId) => {
    try {
      const { data: prof } = await supabase
        .from('profiles')
        .select('display_name, avatar_url, player_id')
        .eq('id', userId)
        .maybeSingle()
      if (!prof) { setProfile(null); return }

      let player = null
      let teamColor = null
      if (prof.player_id) {
        const { data: pl } = await supabase
          .from('players')
          .select('first_name, last_name, team_id')
          .eq('id', prof.player_id)
          .maybeSingle()
        player = pl || null
        if (pl?.team_id) {
          const { data: team } = await supabase
            .from('teams')
            .select('primary_color')
            .eq('id', pl.team_id)
            .maybeSingle()
          teamColor = team?.primary_color || null
        }
      }
      setProfile({ ...prof, player, teamColor })
    } catch {
      setProfile(null)
    }
  }

  // Re-fetch the profile (e.g. after the user edits their avatar on /me).
  const refreshProfile = async () => {
    const u = await sessionUser()
    if (u) await loadProfile(u.id)
    else setProfile(null)
  }

  // A failed permission read must not be read as "no permissions". Right after a token
  // refresh the API can briefly reject the new token ("JWT issued at future", PGRST303 —
  // the auth server's clock runs ahead), and treating that as an answer stripped admins,
  // coaches and judges of every role until the next page load (27 hits / 14 users, Oct).
  // So: retry once after 1.5s, and if it still fails keep what we had. A switch to a
  // different account clears the state first (see apply), so nothing carries over.
  const readWithRetry = async (query) => {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const { data, error } = await query()
        if (!error) return { ok: true, data }
      } catch { /* network — retry below */ }
      if (attempt === 0) await new Promise(r => setTimeout(r, 1500))
    }
    return { ok: false }
  }

  const checkAdmin = async (email) => {
    const res = await readWithRetry(() => supabase
      .from('admin_users')
      .select('email')
      .eq('email', email)
      .maybeSingle())
    if (res.ok) setIsAdmin(!!res.data)
  }

  const loadRoles = async (userId) => {
    const res = await readWithRetry(() => supabase
      .from('user_roles')
      .select('role, team_id')
      .eq('user_id', userId))
    if (res.ok) setRoles(res.data || [])
  }

  // Does the signed-in user hold a given role? Admins implicitly pass every gate.
  const hasRole = (role) => isAdmin || roles.some(r => r.role === role)

  // Team ids this user coaches (role='coach' rows carry a team_id). NOTE: an
  // admin passes hasRole('coach') via the bypass above but has NO coach teams,
  // so this stays empty for admins — coach-scoped code must branch on isAdmin first.
  const coachTeamIds = roles.filter(r => r.role === 'coach' && r.team_id).map(r => r.team_id)

  // Holds an actual judge row. Unlike hasRole('judge') this does NOT pass for
  // admins, so tab-scoping code can tell "judge" apart from "admin".
  const isJudgeRole = roles.some(r => r.role === 'judge')

  // Holds an actual content_editor row. Like isJudgeRole this is the RAW role and
  // does NOT pass for admins, so content pages gate on `isContentEditor || isAdmin`.
  const isContentEditor = roles.some(r => r.role === 'content_editor')

  // Holds an actual league_manager row (RAW role, does NOT pass for admins) — used
  // to unlock tournament management and, later, the coach-request approval flow.
  const isLeagueManager = roles.some(r => r.role === 'league_manager')

  // Holds an actual medic role (RAW, does NOT pass for admins) — assignable to games.
  const isMedic = roles.some(r => r.role === 'medic')

  // Who may create feed posts: league staff only — coach / content_editor /
  // judge(=referee) / league_manager / admin. Regular linked players & guests cannot.
  const canPost = isAdmin || coachTeamIds.length > 0 || isContentEditor || isJudgeRole || isLeagueManager

  const signInWithGoogle = async () => {
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        // Return to the page the user signed in from — the admin login button lands
        // back on /admin, while a member liking a post from the feed returns to the
        // feed instead of hitting the admin AccessDenied screen.
        redirectTo: window.location.origin + window.location.pathname
      }
    })
    if (error) throw error
  }

  const signUpWithEmail = async (email, password, displayName) => {
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: { data: displayName ? { full_name: displayName } : undefined },
    })
    if (error) throw error
    return data // data.session is null when email confirmation is required
  }

  const signInWithEmail = async (email, password) => {
    const { data, error } = await supabase.auth.signInWithPassword({ email, password })
    if (error) throw error
    return data
  }

  // Send a password-reset email. The link returns the user to /reset-password.
  // NOTE: that URL (for BOTH deploy targets + localhost) must be in Supabase's
  // Auth → URL Configuration → Redirect URLs allowlist, or Supabase ignores
  // redirectTo and falls back to the Site URL.
  const resetPassword = async (email) => {
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: window.location.origin + '/reset-password',
    })
    if (error) throw error
  }

  // Set a new password for the currently-authenticated user. Used by both the
  // recovery page (recovery session from the email link) and the /me form.
  const updatePassword = async (newPassword) => {
    const { error } = await supabase.auth.updateUser({ password: newPassword })
    if (error) throw error
  }

  const signOut = async () => {
    await supabase.auth.signOut()
    loadedFor.current = null
    setUser(null)
    setIsAdmin(false)
    setRoles([])
    setProfile(null)
  }

  const openAuth = () => setAuthOpen(true)
  const closeAuth = () => setAuthOpen(false)

  return (
    <AuthContext.Provider value={{
      user, isAdmin, roles, hasRole, coachTeamIds, isJudgeRole, isContentEditor, isLeagueManager, isMedic, canPost, profile, refreshProfile, loading, authOpen,
      signInWithGoogle, signUpWithEmail, signInWithEmail, resetPassword, updatePassword, signOut,
      openAuth, closeAuth,
    }}>
      {children}
    </AuthContext.Provider>
  )
}

export const useAuth = () => useContext(AuthContext)
