// /api/live-edit-revert — "undo that one" for a live-edit change.
//
//   POST { sha }   put the repository back the way it was before that commit, by
//                  adding a NEW commit on `dev` that restores the affected files.
//
// UNDO HERE MEANS A NEW COMMIT, NEVER A REWRITTEN HISTORY. No force-push, no reset,
// no branch deletion — the same rule api/live-edit-promote.js follows, for the same
// reason: `dev` is deployed automatically, other sessions push to it, and a rewritten
// history would silently discard work nobody asked us to touch. The undone commit
// stays in the log, with its undo next to it, which is also the only honest record of
// what happened.
//
// SCOPE. This reverts ONE commit's own diff — the agent's change and nothing around
// it. It is deliberately not `git revert` in full generality:
//   * merge commits are refused (which parent would we be restoring to?)
//   * a commit touching a fenced path is refused, the same fence as promote
//   * a commit not reachable from `dev` is refused
//   * a file changed again AFTER this commit is refused, because restoring it would
//     silently throw away that later change. See conflictsWith() — this is the case
//     that makes a naive undo dangerous, and it is the whole reason this endpoint
//     reads the later history at all.
// Everything refused is reported with a reason the panel can say in Hebrew, and is
// still doable by a human in git. Refusing is always available to us; an undo that
// quietly deletes somebody's later work is not recoverable by the person it happens to.
//
// UNDOING SOMETHING ALREADY ON THE LEAGUE'S SITE: this only ever writes `dev`. If the
// change had already been promoted, the public site keeps it until the undo is
// promoted in turn — that falls out of the design rather than being a special case,
// and the panel says so.
//
// Style/shape mirrors api/live-edit-promote.js exactly — env loading, Supabase bearer
// auth, the server-side admin check, the { ok, reason } failure vocabulary,
// `not-configured` for a missing credential, built-in fetch only, no npm deps, and
// nothing may throw.

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || ''
const SUPABASE_ANON = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY || ''
const GITHUB_TOKEN = process.env.GITHUB_TOKEN || ''
const FORK_REPO = process.env.GITHUB_REPO || 'sideffect263/hockey-league'

const DEV_BRANCH = 'dev'
const REVERT_MARKER = '[live-edit undo]'

const FETCH_TIMEOUT_MS = 10000
const MAX_LISTED_FILES = 50
// A live-edit change is a handful of files. Well above anything the agent produces,
// and low enough that one tree write stays a single, reviewable commit.
const MAX_REVERT_FILES = 60
// How far ahead of the commit we will look for later edits to the same files. Past
// this we cannot promise the undo is safe, so we refuse instead of guessing.
const MAX_LOOKAHEAD_COMMITS = 100

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

// ------------------------------------------------------------ authentication
// Identical to api/live-edit-promote.js: identity comes ONLY from the bearer token,
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
const gh = (path, init = {}) => fetch(`https://api.github.com${path}`, {
  ...init,
  headers: {
    Authorization: `Bearer ${GITHUB_TOKEN}`,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent': 'rinkhockeyil-live-edit-revert',
    ...(init.body ? { 'Content-Type': 'application/json' } : {}),
  },
  signal: timeout(),
})

async function ghJson(path) {
  try {
    const r = await gh(path)
    if (!r.ok) {
      if (r.status !== 404) console.error('live-edit-revert: GitHub GET failed', path.split('?')[0], r.status)
      return null
    }
    return await r.json()
  } catch (err) {
    console.error('live-edit-revert: GitHub GET threw', path.split('?')[0], err?.message || err)
    return null
  }
}

async function ghSend(path, method, body) {
  try {
    const r = await gh(path, { method, ...(body === undefined ? {} : { body: JSON.stringify(body) }) })
    const text = await r.text().catch(() => '')
    let data = null
    if (text) { try { data = JSON.parse(text) } catch { data = null } }
    if (!r.ok) {
      console.error('live-edit-revert: GitHub write failed', method, path.split('?')[0], r.status, text.slice(0, 300))
    }
    return { ok: r.ok, status: r.status, data }
  } catch (err) {
    console.error('live-edit-revert: GitHub write threw', method, path.split('?')[0], err?.message || err)
    return { ok: false, status: 0, data: null }
  }
}

// ------------------------------------------------------------------- the fence
// The SAME set api/live-edit-promote.js fences off and deploy-dev.yml refuses. An
// undo is a write to a deployed branch like any other, so it gets the same answer:
// if an agent should not have been able to change CI, auth, the API layer or the
// database without a human, an undo should not be able to change them back without
// one either. Keep all three in step.
const NEW_MIGRATION = /^supabase\/migrations\/[A-Za-z0-9._-]+\.sql$/

function pathProtected(path, status, isCurrentName) {
  const p = String(path || '')
  if (!p) return false
  if (/(^|\/)\.env/.test(p)) return true
  if (p === 'vercel.json') return true
  if (p === 'src/lib/api.js' || p === 'src/lib/supabase.js') return true
  if (p.startsWith('api/')) return true
  if (p.startsWith('.github/')) return true
  if (p.startsWith('supabase/')) {
    if (isCurrentName && status === 'added' && NEW_MIGRATION.test(p)) return false
    return true
  }
  return false
}

// Undoing a NEW MIGRATION is not the same as undoing a source file, and this is the
// one place the three fences deliberately disagree. promote lets a brand-new .sql
// file through because adding a table is ordinary; an undo would DELETE that file
// while the migration it describes has already run against the one shared Supabase
// project. The repo would then claim a schema the live database does not have, with
// no error anywhere. So here, everything under supabase/ is refused, exemption and all.
function offendersIn(files) {
  const out = []
  for (const f of Array.isArray(files) ? files : []) {
    const status = String(f?.status || '')
    const name = f?.filename ? String(f.filename) : ''
    const prev = f?.previous_filename ? String(f.previous_filename) : ''
    if (name && (name.startsWith('supabase/') || pathProtected(name, status, true))) out.push(name)
    else if (prev && (prev.startsWith('supabase/') || pathProtected(prev, status, false))) out.push(prev)
  }
  return out
}

const uniq = (list) => [...new Set(list)].sort()

const refuse = (res, reason, extra = {}) => json(res, 409, { ok: false, reason, ...extra })

// --------------------------------------------------------------- the undo plan
// Every path the commit touched, in both its old and new names, because a rename has
// to be undone at both ends: delete where it went, restore where it came from.
function pathsOf(files) {
  const out = []
  for (const f of Array.isArray(files) ? files : []) {
    if (f?.filename) out.push(String(f.filename))
    if (f?.previous_filename) out.push(String(f.previous_filename))
  }
  return uniq(out)
}

/**
 * The dangerous case, and the reason this endpoint reads history at all.
 *
 * Restoring a file to how it looked before commit X also erases everything done to
 * it AFTER X. If the agent fixed a button on Tuesday and somebody restyled the same
 * file on Wednesday, "undo Tuesday" would take Wednesday with it — silently, because
 * the result is a perfectly valid commit that simply contains less work than it should.
 *
 * So: list what landed on `dev` after the commit, and refuse if any of it touched a
 * path we are about to rewrite. Refusing is a sentence in the panel; the other
 * behaviour is somebody's afternoon disappearing with no error.
 */
async function conflictsWith(sha, paths) {
  const compare = await ghJson(`/repos/${FORK_REPO}/compare/${sha}...${DEV_BRANCH}?per_page=${MAX_LOOKAHEAD_COMMITS}`)
  if (!compare) return { ok: false, reason: 'github-error' }

  // 'identical' = the commit IS the tip, nothing after it. 'ahead' = dev has commits
  // on top. Anything else ('behind', 'diverged') means it is not on dev at all.
  const status = String(compare.status || '')
  if (status !== 'ahead' && status !== 'identical') return { ok: false, reason: 'not-on-dev' }

  const after = Array.isArray(compare.commits) ? compare.commits : []
  const total = Number(compare.total_commits)
  if (Number.isFinite(total) && total > after.length) {
    // More history than we were shown. We cannot prove the undo is safe, so we do not
    // claim it is.
    return { ok: false, reason: 'too-far-behind' }
  }
  if (!after.length) return { ok: true, blocked: [] }

  // compare's aggregate `files` is the NET diff of everything after the commit —
  // exactly the set we must not overwrite. One call, whatever the commit count.
  if (!Array.isArray(compare.files)) return { ok: false, reason: 'github-error' }
  const touchedAfter = new Set()
  for (const f of compare.files) {
    if (f?.filename) touchedAfter.add(String(f.filename))
    if (f?.previous_filename) touchedAfter.add(String(f.previous_filename))
  }

  return { ok: true, blocked: uniq(paths.filter((p) => touchedAfter.has(p))) }
}

/**
 * What the affected paths looked like BEFORE the commit — read straight out of the
 * parent's tree, so the restored bytes are the historical bytes and not something we
 * reconstructed from a diff.
 *
 * One recursive tree read covers every path at once. `truncated` means GitHub gave us
 * a partial tree, and a partial tree cannot be told apart from "that file did not
 * exist" — which would turn an undo into a deletion. Fail closed.
 */
async function parentEntries(parentSha, paths) {
  const commit = await ghJson(`/repos/${FORK_REPO}/git/commits/${parentSha}`)
  const treeSha = commit?.tree?.sha
  if (!treeSha) return { ok: false, reason: 'github-error' }

  const tree = await ghJson(`/repos/${FORK_REPO}/git/trees/${treeSha}?recursive=1`)
  if (!tree || !Array.isArray(tree.tree)) return { ok: false, reason: 'github-error' }
  if (tree.truncated) return { ok: false, reason: 'too-large' }

  const want = new Set(paths)
  const found = new Map()
  for (const e of tree.tree) {
    if (e?.type === 'blob' && want.has(e.path)) found.set(String(e.path), e)
  }
  return { ok: true, found }
}

// ---------------------------------------------------------------------- POST
async function handlePost(res, user, sha) {
  // 1. The commit itself. Read from the fork, where it certainly is.
  const detail = await ghJson(`/repos/${FORK_REPO}/commits/${sha}`)
  if (!detail) return json(res, 404, { ok: false, reason: 'not-found' })

  const parents = Array.isArray(detail.parents) ? detail.parents : []
  if (parents.length !== 1) {
    // A root commit has nothing to restore to; a merge has two candidate "befores"
    // and picking one silently is how an undo eats a branch.
    return refuse(res, 'not-revertable', { detail: parents.length > 1 ? 'merge' : 'root' })
  }
  const parentSha = String(parents[0]?.sha || '')
  if (!/^[0-9a-f]{40}$/i.test(parentSha)) return json(res, 502, { ok: false, reason: 'github-error' })

  const files = Array.isArray(detail.files) ? detail.files : []
  if (!files.length) return refuse(res, 'nothing-to-undo')
  if (files.length > MAX_REVERT_FILES) return refuse(res, 'too-large', { files: files.length })

  // 2. The fence, before anything else is read: a commit we may not undo is not worth
  //    six more API calls.
  const offenders = offendersIn(files)
  if (offenders.length) {
    return refuse(res, 'needs-human', { files: uniq(offenders).slice(0, MAX_LISTED_FILES) })
  }

  const paths = pathsOf(files)

  // 3. Is it on dev, and has anything since touched the same files?
  const conflict = await conflictsWith(sha, paths)
  if (!conflict.ok) {
    return conflict.reason === 'github-error'
      ? json(res, 502, { ok: false, reason: 'github-error' })
      : refuse(res, conflict.reason)
  }
  if (conflict.blocked.length) {
    return refuse(res, 'changed-since', { files: conflict.blocked.slice(0, MAX_LISTED_FILES) })
  }

  // 4. The "before" bytes.
  const before = await parentEntries(parentSha, paths)
  if (!before.ok) {
    return before.reason === 'too-large' ? refuse(res, 'too-large') : json(res, 502, { ok: false, reason: 'github-error' })
  }

  // 5. The tree. `base_tree` is dev's CURRENT tree, so this rewrites only the paths
  //    below and leaves every other file in the repo exactly as it is.
  //    A path absent from the parent did not exist before the commit — the commit
  //    created it — so the undo DELETES it, which is what `sha: null` means here.
  const devRef = await ghJson(`/repos/${FORK_REPO}/git/ref/heads/${DEV_BRANCH}`)
  const devTip = String(devRef?.object?.sha || '')
  if (!/^[0-9a-f]{40}$/i.test(devTip)) return json(res, 502, { ok: false, reason: 'github-error' })

  const devCommit = await ghJson(`/repos/${FORK_REPO}/git/commits/${devTip}`)
  const baseTree = devCommit?.tree?.sha
  if (!baseTree) return json(res, 502, { ok: false, reason: 'github-error' })

  const entries = paths.map((path) => {
    const was = before.found.get(path)
    return was
      ? { path, mode: was.mode || '100644', type: 'blob', sha: was.sha }
      : { path, mode: '100644', type: 'blob', sha: null }
  })

  const tree = await ghSend(`/repos/${FORK_REPO}/git/trees`, 'POST', { base_tree: baseTree, tree: entries })
  if (!tree.ok || !tree.data?.sha) return json(res, 502, { ok: false, reason: 'github-error', step: 'tree' })

  // Identical tree = the branch already looks like the undo. Say so rather than
  // committing a no-op that deploys for no reason.
  if (tree.data.sha === baseTree) return refuse(res, 'nothing-to-undo')

  const subject = String(detail.commit?.message || '').split('\n')[0].slice(0, 120)
  const commit = await ghSend(`/repos/${FORK_REPO}/git/commits`, 'POST', {
    message: `${REVERT_MARKER} ${subject}\n\n`
      + `Undoes ${sha} on ${DEV_BRANCH}, restoring ${paths.length} path${paths.length === 1 ? '' : 's'} to ${parentSha}.\n`
      + `Requested from the league admin panel by verified admin ${user.id}.\n`,
    tree: tree.data.sha,
    parents: [devTip],
  })
  if (!commit.ok || !commit.data?.sha) return json(res, 502, { ok: false, reason: 'github-error', step: 'commit' })

  // 6. Move the branch. force stays FALSE: the new commit's parent is the tip we
  //    read, so this is a fast-forward or it is nothing. If someone pushed to dev in
  //    the seconds we were working, GitHub refuses and the admin retries against the
  //    branch as it actually is — rather than us overwriting their push.
  const moved = await ghSend(`/repos/${FORK_REPO}/git/refs/heads/${DEV_BRANCH}`, 'PATCH', {
    sha: commit.data.sha,
    force: false,
  })
  if (!moved.ok) {
    return moved.status === 422
      ? refuse(res, 'moved')
      : json(res, 502, { ok: false, reason: 'github-error', step: 'ref' })
  }

  return json(res, 200, {
    ok: true,
    sha: commit.data.sha,
    shortSha: commit.data.sha.slice(0, 7),
    reverted: sha,
    files: paths.length,
    url: `https://github.com/${FORK_REPO}/commit/${commit.data.sha}`,
  })
}

// -------------------------------------------------------------------- handler
export default async function handler(req, res) {
  try {
    if ((req.method || 'GET').toUpperCase() !== 'POST') {
      res.setHeader('Allow', 'POST')
      return json(res, 405, { ok: false, reason: 'method-not-allowed' })
    }
    res.setHeader('Cache-Control', 'no-store')

    if (!SUPABASE_URL || !SUPABASE_ANON) {
      console.error('live-edit-revert: SUPABASE_URL / SUPABASE_ANON_KEY missing')
      return json(res, 501, { ok: false, reason: 'not-configured' })
    }

    if (wrongEnvironment(req)) return json(res, 403, { ok: false, reason: 'wrong-environment' })
    const auth = req.headers?.authorization || ''
    const token = auth.startsWith('Bearer ') ? auth.slice(7).trim() : ''
    if (!token) return json(res, 401, { ok: false, reason: 'unauthorized' })

    const user = await authenticate(token)
    if (!user) return json(res, 401, { ok: false, reason: 'unauthorized' })
    if (!(await isAdmin(user, token))) return json(res, 403, { ok: false, reason: 'forbidden' })

    if (!GITHUB_TOKEN) {
      console.error('live-edit-revert: GITHUB_TOKEN missing')
      return json(res, 501, { ok: false, reason: 'not-configured' })
    }

    // Vercel parses JSON bodies; a string body (or none) is handled rather than thrown on.
    let body = req.body
    if (typeof body === 'string') { try { body = JSON.parse(body) } catch { body = null } }
    const sha = String(body?.sha || '').trim()
    if (!/^[0-9a-f]{40}$/i.test(sha)) return json(res, 400, { ok: false, reason: 'bad-request' })

    return await handlePost(res, user, sha.toLowerCase())
  } catch (err) {
    console.error('live-edit-revert: unhandled error', err?.message || err)
    return json(res, 500, { ok: false, reason: 'error' })
  }
}
