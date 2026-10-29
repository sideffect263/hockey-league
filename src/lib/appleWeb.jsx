import { supabase } from './supabase'
import { trackEvent } from './analytics'

/**
 * "Sign in with Apple" on the WEBSITE. Off until Apple web OAuth is configured —
 * the native apps' Apple sign-in uses the bundle id and needs no secret, but the web
 * redirect flow needs an Apple *Services ID* + a .p8-signed client secret in the
 * Supabase Apple provider (docs/APPLE-WEB-SIGNIN.md). Showing the button before
 * that exists would send people to an Apple error page.
 *
 * Why it matters: without it, someone who signed up with Apple in the iPhone app has
 * NO way into that account on the web, so they sign up again with Google and end up
 * with two accounts (Ori Raizler, 2026-09-26).
 *
 * Flip on with VITE_APPLE_WEB_SIGNIN=1 in the Vercel env of each site.
 */
export const APPLE_WEB_ENABLED = import.meta.env.VITE_APPLE_WEB_SIGNIN === '1'

const back = () => window.location.origin + window.location.pathname

export async function signInWithAppleWeb() {
  trackEvent('login', { method: 'apple' })
  const { error } = await supabase.auth.signInWithOAuth({ provider: 'apple', options: { redirectTo: back() } })
  if (error) throw error
}

/** Attach Apple to the signed-in account (Supabase manual linking). */
export async function linkAppleWeb() {
  const { error } = await supabase.auth.linkIdentity({ provider: 'apple', options: { redirectTo: back() } })
  if (error) throw error
}

export function AppleIcon({ className = "w-4 h-4" }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="currentColor" aria-hidden="true">
      <path d="M16.37 12.63c-.02-2.2 1.8-3.26 1.88-3.31-1.02-1.5-2.62-1.7-3.19-1.72-1.36-.14-2.65.8-3.34.8-.69 0-1.75-.78-2.88-.76-1.48.02-2.85.86-3.61 2.19-1.54 2.67-.39 6.62 1.11 8.79.73 1.06 1.6 2.25 2.75 2.2 1.1-.04 1.52-.71 2.85-.71 1.33 0 1.71.71 2.88.69 1.19-.02 1.94-1.08 2.67-2.14.84-1.23 1.19-2.42 1.21-2.48-.03-.01-2.32-.89-2.33-3.55zM14.18 6.16c.61-.74 1.02-1.76.91-2.78-.88.04-1.94.59-2.57 1.32-.56.65-1.06 1.69-.93 2.69.98.08 1.98-.5 2.59-1.23z"/>
    </svg>
  )
}
