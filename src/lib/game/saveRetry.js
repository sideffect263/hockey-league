// Retry policy for the judge's "save result" call. Pure (no Supabase import) so it is
// unit-testable.
//
// A save on a flaky rink connection can fail in transit AFTER the server committed it.
// So: retry only failures that look like the network (not a server-side refusal), and
// if a RETRY is refused with 'game already completed', an earlier attempt landed —
// that is success, not an error.

export const ALREADY_COMPLETED = 'game already completed'

/** A transport failure (fetch never got an answer) rather than a server refusal. */
export function isNetworkError(e) {
  if (!e) return false
  const msg = String(e.message || e)
  if (/failed to fetch|networkerror|network request failed|load failed|fetch failed|timed? ?out|aborted|ECONN|ENOTFOUND/i.test(msg)) return true
  // PostgREST / Postgres refusals carry a code (P0001, 42501, PGRST…); a gateway 5xx is transient.
  if (Number.isFinite(e.status) && e.status >= 500) return true
  return !e.code && !e.status && e.name === 'TypeError'
}

/**
 * Run `attempt()` (which throws on failure) up to `attempts` times with backoff.
 * Resolves on success (including an 'already completed' answer to a retry); rejects
 * with the last error otherwise.
 */
export async function saveWithRetry(attempt, { attempts = 3, delays = [1000, 3000], sleep = (ms) => new Promise(r => setTimeout(r, ms)) } = {}) {
  let lastErr = null
  for (let i = 0; i < attempts; i++) {
    if (i > 0) await sleep(delays[Math.min(i - 1, delays.length - 1)] ?? 0)
    try {
      await attempt(i)
      return { attempts: i + 1 }
    } catch (e) {
      // A retry refused because the game is already completed: our earlier attempt
      // committed and only its answer was lost.
      if (i > 0 && lastErr && isNetworkError(lastErr) && String(e?.message || '').includes(ALREADY_COMPLETED)) {
        return { attempts: i + 1, alreadySaved: true }
      }
      lastErr = e
      if (!isNetworkError(e)) throw e
    }
  }
  throw lastErr
}
