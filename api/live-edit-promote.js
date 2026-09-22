// /api/live-edit-promote — "ship it to the league", the last mile of live-edit.
//
//   GET   what is waiting: the commits sitting on the fork's `dev` that the public
//         site has never seen, so the panel can show them BEFORE anyone commits.
//   POST  actually promote: merge those commits into upstream `main` and press the
//         deploy-public button.
//
// THIS ENDPOINT PUBLISHES TO A SITE REAL PEOPLE READ. Everything fails CLOSED, and
// the destructive verbs are deliberately absent: no force-push, no branch deletion,
// no PR creation. The only writes it can perform are (1) create a new branch ref,
// (2) a MERGE commit onto `main`, (3) a workflow_dispatch. A merge that does not
// apply cleanly is reported, never forced.
//
// THE TOPOLOGY. Both branches now live in ONE repo, sideffect263/hockey-league:
//   `dev`   — where agents work, deployed to hockey-league-dev by deploy-dev.yml.
//   `main`  — what rinkhockeyil.com deploys, via deploy-public.yml.
//
// It used to be two repos: `main` lived in IdanLichter/hockey-league and was written
// with a second credential, UPSTREAM_TOKEN, that GITHUB_TOKEN could not stand in for.
// That split was the safety property — a leaked fork token could not publish. It is
// GONE now that both branches are in the fork, so the thing standing between an
// agent and the league's website is no longer a credential boundary but this file's
// own audit: auditCommits() and the protected-path fence below. Weaken those and
// there is nothing behind them.
//
// UPSTREAM_REPO / UPSTREAM_TOKEN survive as env overrides so a deployment can still
// point `main` at a different repo. Unset, they mean "the same repo, the same token".
//
// Style/shape mirrors api/live-edit.js exactly — env loading, Supabase bearer auth,
// the server-side admin check, the { ok, reason } failure vocabulary,
// `not-configured` for a missing credential, built-in fetch only, no npm deps, and
// nothing may throw.

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || ''
const SUPABASE_ANON = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY || ''
const GITHUB_TOKEN = process.env.GITHUB_TOKEN || ''
const FORK_REPO = process.env.GITHUB_REPO || 'sideffect263/hockey-league'
// Same repo as the fork unless something explicitly says otherwise, and therefore
// the same token. Defaulting the token to GITHUB_TOKEN rather than leaving it empty
// is what keeps the `!GITHUB_TOKEN || !UPSTREAM_TOKEN` guard below from reporting
// `not-configured` on a perfectly configured single-repo deployment.
const UPSTREAM_REPO = process.env.UPSTREAM_REPO || FORK_REPO
const UPSTREAM_TOKEN = process.env.UPSTREAM_TOKEN || process.env.GITHUB_TOKEN || ''

const FORK_OWNER = FORK_REPO.split('/')[0]
const DEV_BRANCH = 'dev'
const MAIN_BRANCH = 'main'
const DEPLOY_WORKFLOW = 'deploy-public.yml'

// Stamped into every merge commit we create. It is how `lastPromotedAt` finds our
// own merges among everybody else's pushes to main — grep-able by a human too.
const PROMOTE_MARKER = '[live-edit promote]'
const PROMOTE_BRANCH_PREFIX = 'live-edit/promote-'

const FETCH_TIMEOUT_MS = 10000
const DETAIL_CONCURRENCY = 6

// Above this, the pending pile stops being "a few UI fixes" and starts being a
// release. We refuse rather than audit it badly: see auditCommits().
const MAX_AUDITABLE_COMMITS = 40
// GitHub's compare endpoint returns at most 300 entries in `files`. At that size we
// cannot see the whole diff, so we cannot promise it is safe.
const COMPARE_FILE_CAP = 300
const MAX_LISTED_FILES = 50
const MAX_MESSAGE = 200

const json = (res, status, body) => res.status(status).json(body)

// ------------------------------------------------------- environment gate
// These endpoints belong to the DEV deployment. The panel that calls them is already
// hidden on rinkhockeyil.com, but hiding a button hides the button, not the route —
// the function is deployed to both sites and a verified admin's own session token
// works against either. So the publish trigger and the branch writer refuse to run
// at all on the league's site, where nothing should ever be calling them.
//
// An ALLOWLIST, like the panel's, and for the same reason: a new domain or alias must
// default to refusing. Failing that way is loud and fixable in one env var; failing
// open is a write path on the public site that nobody knows is there.
const DEV_HOSTS = /^(localhost(:\d+)?|127\.0\.0\.1(:\d+)?|hockey-league-dev(-[a-z0-9-]+)?\.vercel\.app)$/i

function wrongEnvironment(req) {
  const extra = String(process.env.LIVE_EDIT_HOSTS || '')
    .split(',').map((h) => h.trim().toLowerCase()).filter(Boolean)
  const host = String(req.headers?.['x-forwarded-host'] || req.headers?.host || '').toLowerCase()
  if (!host) return true
  return !(DEV_HOSTS.test(host) || extra.includes(host))
}


const timeout = () => (typeof AbortSignal?.timeout === 'function' ? AbortSignal.timeout(FETCH_TIMEOUT_MS) : undefined)

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// Commit messages and author names are written by an autonomous agent and rendered
// in an admin's browser: strip control characters and the bidi overrides that let
// text display differently than it reads (plain RLM/LRM stay — Hebrew needs them).
function clean(value, max) {
  return String(value ?? '')
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
    .replace(/[\u202A-\u202E\u2066-\u2069]/g, '')
    .slice(0, max)
}

// ------------------------------------------------------------ authentication
// Identical to api/live-edit.js: identity comes ONLY from the bearer token,
// verified against Supabase. Nothing in the request is trusted to say who is calling.
async function authenticate(token) {
  const r = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    headers: { apikey: SUPABASE_ANON, Authorization: `Bearer ${token}` },
    signal: timeout(),
  })
  if (!r.ok) return null
  const user = await r.json()
  return user?.id ? user : null
}

// Server-side mirror of AuthContext.checkAdmin(), queried with the USER's token so
// RLS decides: the "Read own admin row" policy is (auth.jwt() ->> 'email') = email,
// so a row comes back iff the caller really is an admin.
async function isAdmin(user, token) {
  if (!user?.email) return false
  const url = `${SUPABASE_URL}/rest/v1/admin_users?select=email&email=eq.${encodeURIComponent(user.email)}&limit=1`
  const r = await fetch(url, {
    headers: { apikey: SUPABASE_ANON, Authorization: `Bearer ${token}` },
    signal: timeout(),
  })
  if (!r.ok) return false
  const rows = await r.json()
  return Array.isArray(rows) && rows.length > 0
}

// -------------------------------------------------------------------- github
const gh = (token, path, init = {}) => fetch(`https://api.github.com${path}`, {
  ...init,
  headers: {
    Authorization: `Bearer ${token}`,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent': 'rinkhockeyil-live-edit-promote',
    ...(init.body ? { 'Content-Type': 'application/json' } : {}),
  },
  signal: timeout(),
})

// Read-only GET that never throws and never rejects: null means "unknown", and
// every caller is written to treat unknown as a reason to stop, not to guess.
async function ghJson(token, path) {
  try {
    const r = await gh(token, path)
    if (!r.ok) {
      if (r.status !== 404) console.error('live-edit-promote: GitHub GET failed', path.split('?')[0], r.status)
      return null
    }
    return await r.json()
  } catch (err) {
    console.error('live-edit-promote: GitHub GET threw', path.split('?')[0], err?.message || err)
    return null
  }
}

// Writes need the status code, not just the body, so they get their own helper.
// It also never throws: a network failure is reported as status 0.
async function ghSend(token, path, method, body) {
  try {
    const r = await gh(token, path, {
      method,
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    })
    const text = await r.text().catch(() => '')
    let data = null
    if (text) { try { data = JSON.parse(text) } catch { data = null } }
    if (!r.ok) {
      // Log status + a slice of the body for debugging. Never the tokens, never the
      // caller's JWT.
      console.error('live-edit-promote: GitHub write failed', method, path.split('?')[0], r.status, text.slice(0, 300))
    }
    return { ok: r.ok, status: r.status, data, text }
  } catch (err) {
    console.error('live-edit-promote: GitHub write threw', method, path.split('?')[0], err?.message || err)
    return { ok: false, status: 0, data: null, text: String(err?.message || err) }
  }
}

// Bounded-concurrency map — Vercel's ~10s wall clock is why this exists, and
// GitHub's secondary rate limiter is why it isn't just Promise.all.
async function mapLimit(items, limit, fn) {
  let cursor = 0
  const workers = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, async () => {
    while (cursor < items.length) {
      const i = cursor++
      await fn(items[i])
    }
  })
  await Promise.all(workers)
}

// --------------------------------------------------------------- the compare
// What is pending = what upstream `main` does not yet have from the fork's `dev`.
// One cross-repo compare answers it, and the same response carries the aggregate
// diff we audit below, so the cheap call and the safe call are the same call.
//
// The basehead is built literally: both halves are constants from env/defaults, and
// the `owner:branch` form GitHub wants for a cross-fork head must keep its colon.
//
// Token choice: the resource is the UPSTREAM repo, so UPSTREAM_TOKEN goes first. If
// its PAT cannot see the fork's side of the comparison we retry with the fork's
// token, which can. One of the two works in every plausible permission layout.
async function compareDevToMain() {
  const path = `/repos/${UPSTREAM_REPO}/compare/${MAIN_BRANCH}...${FORK_OWNER}:${DEV_BRANCH}`
  return (await ghJson(UPSTREAM_TOKEN, path)) || (await ghJson(GITHUB_TOKEN, path))
}

// GitHub lists compare commits oldest-first. The panel shows newest-first, like the
// live-edit history does.
function pendingFrom(compare) {
  const commits = Array.isArray(compare?.commits) ? compare.commits : []
  return commits.slice().reverse().map((c) => {
    const sha = String(c?.sha || '')
    return {
      sha,
      shortSha: sha.slice(0, 7),
      // First line only: this is a list, and the body of an agent's commit message
      // is long and already visible on GitHub.
      message: clean(String(c?.commit?.message || '').split('\n')[0], MAX_MESSAGE).trim(),
      author: clean(c?.commit?.author?.name || c?.author?.login || '', 80).trim(),
      date: c?.commit?.author?.date || c?.commit?.committer?.date || null,
    }
  })
}

// When was the league's site last given a batch of these? Found by our own marker in
// the merge message, so other people's pushes to `main` are not mistaken for a
// promote. Never fatal: unknown reads as null, and the panel just says "never".
async function lastPromotedAt() {
  const commits = await ghJson(UPSTREAM_TOKEN, `/repos/${UPSTREAM_REPO}/commits?sha=${MAIN_BRANCH}&per_page=30`)
  if (!Array.isArray(commits)) return null
  const hit = commits.find((c) => String(c?.commit?.message || '').includes(PROMOTE_MARKER))
  return hit?.commit?.committer?.date || hit?.commit?.author?.date || null
}

// ----------------------------------------------------------- the path fence
// The same fence deploy-dev.yml enforces at deploy time, enforced here at promote
// time — because the league's site is not the place to discover that an agent
// edited CI, auth, the API layer or the database.
//
// The ONE hole is intentional: a BRAND NEW .sql file directly under
// supabase/migrations/. Shipping a feature that needs a new table is normal;
// rewriting an existing migration is not — migrations are append-only, and one that
// has already run cannot be un-run by editing the file.
//
// This is deliberately the SAME shape as the "Refuse dangerous paths" step in
// .github/workflows/deploy-dev.yml, including its
// ^supabase/migrations/[A-Za-z0-9._-]+\.sql$ exemption. If you change one, change
// the other: this endpoint is the first gate and that workflow is the second, and
// they should never disagree about what is allowed.
const NEW_MIGRATION = /^supabase\/migrations\/[A-Za-z0-9._-]+\.sql$/

function pathProtected(path, status, isCurrentName) {
  const p = String(path || '')
  if (!p) return false
  if (/(^|\/)\.env/.test(p)) return true              // .env, .env.local, .env.example…
  if (p === 'vercel.json') return true                // routing, headers, rewrites
  if (p === 'src/lib/api.js' || p === 'src/lib/supabase.js') return true
  if (p.startsWith('api/')) return true               // these serverless functions
  if (p.startsWith('.github/')) return true           // CI, incl. the deploy workflows
  if (p.startsWith('supabase/')) {
    if (isCurrentName && status === 'added' && NEW_MIGRATION.test(p)) return false
    return true
  }
  return false
}

// A rename reports only its destination in `filename`, so the source is checked too:
// moving api/live-edit.js to src/ must not slip through as an ordinary src/ edit.
function offendersIn(files) {
  const out = []
  for (const f of Array.isArray(files) ? files : []) {
    const status = String(f?.status || '')
    if (f?.filename && pathProtected(f.filename, status, true)) out.push(String(f.filename))
    else if (f?.previous_filename && pathProtected(f.previous_filename, status, false)) out.push(String(f.previous_filename))
  }
  return out
}

// Per-commit audit ON TOP of the aggregate diff. The aggregate says what would land
// on main; the per-commit pass also catches a protected path that was touched and
// then reverted inside the range. Commits are read from the FORK, where they
// certainly exist, with the fork's token.
async function auditCommits(commits) {
  const found = []
  await mapLimit(commits, DETAIL_CONCURRENCY, async (c) => {
    const sha = String(c?.sha || '')
    if (!/^[0-9a-f]{40}$/i.test(sha)) {
      found.push(`(unreadable commit ${sha.slice(0, 12)})`)
      return
    }
    const detail = await ghJson(GITHUB_TOKEN, `/repos/${FORK_REPO}/commits/${sha}`)
    if (!detail || !Array.isArray(detail.files)) {
      // Could not read it = cannot vouch for it. Fail closed.
      found.push(`(could not read commit ${sha.slice(0, 7)})`)
      return
    }
    found.push(...offendersIn(detail.files))
  })
  return found
}

const uniq = (list) => [...new Set(list)].sort()

const needsHuman = (res, files, detail) => json(res, 409, {
  ok: false,
  reason: 'needs-human',
  files: uniq(files).slice(0, MAX_LISTED_FILES),
  detail,
})

// ------------------------------------------------------------------ GET: pending
async function handleGet(res) {
  // A live view of an unshipped queue, scoped to one admin's session. Nothing
  // between here and the browser may keep a copy.
  res.setHeader('Cache-Control', 'no-store')

  const compare = await compareDevToMain()
  if (!compare) return json(res, 502, { ok: false, reason: 'github-error' })

  const pending = pendingFrom(compare)
  const total = Number(compare.total_commits)

  return json(res, 200, {
    ok: true,
    pending,
    // The true number, even in the (refused-at-POST) case where GitHub truncated
    // the commit list at 250.
    count: Number.isFinite(total) ? total : pending.length,
    lastPromotedAt: await lastPromotedAt(),
    // Advisory only, so the panel can warn before the admin clicks: the offenders in
    // the NET diff. POST re-checks this authoritatively, per commit, and is the only
    // thing that decides.
    blockedFiles: uniq(offendersIn(compare.files)).slice(0, MAX_LISTED_FILES),
  })
}

// ----------------------------------------------------------------- POST: promote
// Order matters, and every step fails closed. Note what is NOT here: no lock. Two
// admins clicking at once both merge the same sha; the second gets GitHub's "already
// merged" 204 and is told there is nothing to promote. That is the correct answer.
async function handlePost(res, user) {
  const compare = await compareDevToMain()
  if (!compare) return json(res, 502, { ok: false, reason: 'github-error' })

  const commits = Array.isArray(compare.commits) ? compare.commits : []
  const total = Number(compare.total_commits)

  // 2. Nothing to do.
  if (!commits.length) return json(res, 409, { ok: false, reason: 'nothing-to-promote' })

  // 3. The fence. Refuse anything we cannot fully see FIRST — an unauditable promote
  //    is exactly the promote that should wake a human.
  if (Number.isFinite(total) && total !== commits.length) {
    return needsHuman(res, [], `GitHub returned ${commits.length} of ${total} commits — too many to audit.`)
  }
  if (commits.length > MAX_AUDITABLE_COMMITS) {
    return needsHuman(res, [], `${commits.length} commits pending (limit ${MAX_AUDITABLE_COMMITS}) — promote by hand.`)
  }
  if (!Array.isArray(compare.files)) {
    return needsHuman(res, [], 'GitHub did not return the file list for this comparison.')
  }
  if (compare.files.length >= COMPARE_FILE_CAP) {
    return needsHuman(res, [], `The diff touches ${compare.files.length}+ files — more than the comparison can list.`)
  }

  const offenders = [...offendersIn(compare.files), ...(await auditCommits(commits))]
  if (offenders.length) {
    return needsHuman(res, offenders, 'These paths are fenced off: a human must review and promote them.')
  }

  // Pin to the exact commit we just audited (compare lists oldest-first, so the last
  // one is the head). If `dev` moves while we work, this promotes what was on the
  // screen, not whatever landed a second ago.
  const headSha = String(commits[commits.length - 1]?.sha || '')
  if (!/^[0-9a-f]{40}$/i.test(headSha)) {
    return json(res, 502, { ok: false, reason: 'github-error', step: 'resolve-head' })
  }

  // 4a. Put those commits on a branch UPSTREAM. Creating a ref is the only kind of
  //     "push" here: it adds a new name, it cannot move or delete an existing one.
  //     The branch is kept afterwards — it is the audit trail for this promote.
  const branch = await createUpstreamBranch(headSha)
  if (!branch.ok) {
    if (branch.status === 403) return json(res, 403, { ok: false, reason: 'no-write-access', step: 'push' })
    return json(res, 502, { ok: false, reason: 'github-error', step: 'push', detail: branch.detail })
  }

  // 4b. MERGE it into main. Not a fast-forward, not a force: if other people have
  //     pushed to main since, GitHub makes a merge commit; if it does not apply,
  //     GitHub says 409 and we stop. Nothing here can discard someone else's work.
  const merge = await ghSend(UPSTREAM_TOKEN, `/repos/${UPSTREAM_REPO}/merges`, 'POST', {
    base: MAIN_BRANCH,
    head: branch.name,
    commit_message: `${PROMOTE_MARKER} ${commits.length} commit${commits.length === 1 ? '' : 's'} from ${FORK_REPO}@${DEV_BRANCH}\n\n`
      + `Promoted from the league admin panel by verified admin ${user.id}.\n`
      + `Head: ${headSha}\nBranch: ${branch.name}\n`,
  })

  // 204 = main already contains it (somebody promoted the same commits in the
  // seconds we were working). Not an error, but nothing was shipped.
  if (merge.status === 204) return json(res, 409, { ok: false, reason: 'nothing-to-promote' })
  if (merge.status === 409) return json(res, 409, { ok: false, reason: 'conflict', branch: branch.name })
  if (merge.status === 403) return json(res, 403, { ok: false, reason: 'no-write-access', step: 'merge', branch: branch.name })
  if (!merge.ok || !merge.data?.sha) {
    return json(res, 502, { ok: false, reason: 'github-error', step: 'merge', branch: branch.name })
  }
  const mergedSha = String(merge.data.sha)

  // 5. Press the deploy button. PAST THIS POINT NOTHING MAY RETURN ok:false — the
  //    merge is done and cannot be taken back, so the panel must be told it happened
  //    even if the deploy trigger misfires. A failed trigger is recoverable by hand
  //    (Actions tab -> "deploy public" -> Run workflow); a silently lost merge is not.
  const dispatched = await dispatchDeploy()
  const run = dispatched ? await findDeployRun(Date.now()) : null

  return json(res, 200, {
    ok: true,
    merged: mergedSha,
    run,
    count: commits.length,
    branch: branch.name,
    // Extras the panel can surface; the contract above is unchanged.
    deployTriggered: dispatched,
    runsUrl: `https://github.com/${FORK_REPO}/actions/workflows/${DEPLOY_WORKFLOW}`,
    mergeUrl: `https://github.com/${UPSTREAM_REPO}/commit/${mergedSha}`,
  })
}

// Create refs/heads/live-edit/promote-<short> upstream, pointing at the audited sha.
// Collisions are handled by ACCEPTING an identical existing ref or by picking a new
// name — never by moving the one that is there.
async function createUpstreamBranch(headSha) {
  const base = `${PROMOTE_BRANCH_PREFIX}${headSha.slice(0, 7)}`
  const create = async (name) => ghSend(UPSTREAM_TOKEN, `/repos/${UPSTREAM_REPO}/git/refs`, 'POST', {
    ref: `refs/heads/${name}`,
    sha: headSha,
  })

  const first = await create(base)
  if (first.ok) return { ok: true, name: base }

  // 403 here is not an outage and not a bad request — it is this token being allowed
  // to READ the repo and not to write code to it. Reported as its own reason so the
  // panel can say which permission is missing, instead of "GitHub is unavailable"
  // sending somebody to look at a status page that is green.
  if (first.status === 403) return { ok: false, status: 403, detail: 'token cannot write code to the repo' }

  if (first.status === 422) {
    // Either the ref already exists, or the commit object is not visible upstream.
    const existing = await ghJson(UPSTREAM_TOKEN, `/repos/${UPSTREAM_REPO}/git/ref/heads/${base}`)
    if (String(existing?.object?.sha || '').toLowerCase() === headSha.toLowerCase()) {
      return { ok: true, name: base } // a retry of the same promote — reuse it as is
    }
    if (existing) {
      // Occupied by something else. Take a fresh name rather than move it.
      const alt = `${base}-${Date.now().toString(36)}`
      const retry = await create(alt)
      if (retry.ok) return { ok: true, name: alt }
      return { ok: false, detail: `could not create ${alt} (${retry.status})` }
    }
    // No such ref, so the 422 was about the object: the fork's commits are not
    // reachable from the upstream repo. Only a real git push can fix that.
    return { ok: false, detail: `upstream cannot see commit ${headSha.slice(0, 7)} (${first.status})` }
  }

  return { ok: false, detail: `ref creation failed (${first.status})` }
}

// workflow_dispatch on the FORK, where the workflow file lives, with the fork's
// token. GitHub only dispatches a workflow it can find on the ref it is given, so if
// `dev` is not where this repo keeps it we try the fork's default branch once.
// `main` on the fork is never written to — this only READS which branch that is.
async function dispatchDeploy() {
  const fire = (ref) => ghSend(
    GITHUB_TOKEN,
    `/repos/${FORK_REPO}/actions/workflows/${DEPLOY_WORKFLOW}/dispatches`,
    'POST',
    { ref },
  )

  const first = await fire(DEV_BRANCH)
  if (first.ok || first.status === 204) return true

  const repo = await ghJson(GITHUB_TOKEN, `/repos/${FORK_REPO}`)
  const fallback = repo?.default_branch
  if (fallback && fallback !== DEV_BRANCH) {
    const second = await fire(fallback)
    if (second.ok || second.status === 204) return true
  }

  console.error('live-edit-promote: deploy-public dispatch failed — merge IS on main, deploy must be started by hand')
  return false
}

// The dispatch API answers 204 with no body, so the run has to be looked up. It
// takes a moment to appear; two short tries, then give up and hand back the Actions
// page instead. A missing URL is cosmetic — the deploy is already running.
async function findDeployRun(dispatchedAt) {
  for (const wait of [900, 1400]) {
    await sleep(wait)
    const data = await ghJson(
      GITHUB_TOKEN,
      `/repos/${FORK_REPO}/actions/workflows/${DEPLOY_WORKFLOW}/runs?event=workflow_dispatch&per_page=5`,
    )
    const runs = Array.isArray(data?.workflow_runs) ? data.workflow_runs : []
    // 5s of slack: GitHub's created_at and our clock are not the same clock.
    const hit = runs.find((r) => (Date.parse(r?.created_at) || 0) >= dispatchedAt - 5000)
    if (hit?.html_url) return hit.html_url
  }
  return null
}

// ------------------------------------------------------------------- handler
export default async function handler(req, res) {
  try {
    const method = req.method === 'HEAD' ? 'GET' : req.method
    if (method !== 'POST' && method !== 'GET') {
      res.setHeader('Allow', 'GET, POST')
      return json(res, 405, { ok: false, reason: 'method-not-allowed' })
    }

    // Without Supabase we cannot prove who is calling — fail closed, before anything
    // else, so an unverified caller learns nothing about this repo at all.
    if (!SUPABASE_URL || !SUPABASE_ANON) {
      console.error('live-edit-promote: SUPABASE_URL / SUPABASE_ANON_KEY missing')
      return json(res, 501, { ok: false, reason: 'not-configured' })
    }

    if (wrongEnvironment(req)) return json(res, 403, { ok: false, reason: 'wrong-environment' })
    const auth = req.headers?.authorization || ''
    const token = auth.startsWith('Bearer ') ? auth.slice(7).trim() : ''
    if (!token) return json(res, 401, { ok: false, reason: 'unauthorized' })

    const user = await authenticate(token)
    if (!user) return json(res, 401, { ok: false, reason: 'unauthorized' })
    if (!(await isAdmin(user, token))) return json(res, 403, { ok: false, reason: 'forbidden' })

    // 1. Only a proven admin gets told which half of the wiring is missing. Both
    //    tokens are required for either method: reading what is pending needs the
    //    cross-repo compare just as much as shipping it does.
    if (!GITHUB_TOKEN || !UPSTREAM_TOKEN) {
      console.error('live-edit-promote: GITHUB_TOKEN / UPSTREAM_TOKEN missing')
      return json(res, 501, { ok: false, reason: 'not-configured' })
    }

    if (method === 'GET') return await handleGet(res)
    return await handlePost(res, user)
  } catch (err) {
    // Nothing may escape: an unhandled throw is a 500 the panel has no branch for,
    // and on some runtimes it leaks a stack trace into the response.
    console.error('live-edit-promote: unhandled error', err?.message || err)
    return json(res, 500, { ok: false, reason: 'error' })
  }
}
