#!/usr/bin/env node
// Full local backup of the league's Supabase project: database (every schema,
// including auth users and storage metadata), every stored file, edge function
// sources and settings. Run weekly by the launchd agent that
// scripts/install-backup-agent.sh installs.
//
// Needs no database password and no Docker: it asks the Management API for the
// same temporary login the Supabase CLI uses (5-minute TTL) and runs the local
// pg_dump with it. That login must `SET ROLE postgres` (pg_dump --role) or the
// auth schema is "permission denied".
//
// Layout under BACKUP_ROOT (default ~/Backups/rinkhockeyil):
//   YYYY-MM-DD/   db/full.dump, db/full.sql, edge-functions-source/, config/
//   storage/      one shared mirror of every bucket: only new or resized files
//                 are fetched, nothing is ever deleted from it
// Dated folders beyond the newest KEEP (default 8) are removed.
//
// The output holds PII (ת.ז., minors, medical files). Keep BACKUP_ROOT out of
// iCloud-synced folders (~/Documents is synced on this Mac) and out of git.
//
// Env: SUPABASE_ACCESS_TOKEN, SUPABASE_PROJECT_REF, SUPABASE_SERVICE_ROLE_KEY,
//      optional BACKUP_ROOT, KEEP, PG_BIN, SUPABASE_BIN
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync, cpSync, chmodSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

const env = process.env
const missing = ['SUPABASE_ACCESS_TOKEN', 'SUPABASE_PROJECT_REF', 'SUPABASE_SERVICE_ROLE_KEY'].filter((k) => !env[k])
if (missing.length) {
  console.error(`✗ missing env: ${missing.join(', ')}`)
  process.exit(1)
}
const REF = env.SUPABASE_PROJECT_REF
const ROOT = env.BACKUP_ROOT || join(homedir(), 'Backups/rinkhockeyil')
const KEEP = Number(env.KEEP || 8)
const PG = env.PG_BIN || '/opt/homebrew/bin'
const SUPABASE = env.SUPABASE_BIN || '/opt/homebrew/bin/supabase'
const API = `https://api.supabase.com/v1/projects/${REF}`
const H = { Authorization: `Bearer ${env.SUPABASE_ACCESS_TOKEN}`, 'Content-Type': 'application/json' }

const api = async (path, init = {}) => {
  const r = await fetch(API + path, { headers: H, ...init })
  if (!r.ok) throw new Error(`${init.method || 'GET'} ${path} → ${r.status}: ${(await r.text()).slice(0, 200)}`)
  return r.status === 204 ? null : r.json()
}

const day = new Date().toISOString().slice(0, 10)
let out = join(ROOT, day)
if (existsSync(out)) out += `-${new Date().toISOString().slice(11, 16).replace(':', '')}`
mkdirSync(join(out, 'db'), { recursive: true })
mkdirSync(join(out, 'config'), { recursive: true })
chmodSync(ROOT, 0o700)

// ── database ────────────────────────────────────────────────────────────────
const pooler = (await api('/config/database/pooler')).find((p) => p.database_type === 'PRIMARY')
const role = await api('/cli/login-role', { method: 'POST', body: JSON.stringify({ read_only: false }) })
try {
  const conn = `host=${pooler.db_host} port=5432 dbname=postgres user=${role.role}.${REF} sslmode=require`
  execFileSync(`${PG}/pg_dump`, [conn, '--role=postgres', '-Fc', '--no-owner', '--no-privileges', '-f', join(out, 'db/full.dump')], {
    env: { ...env, PGPASSWORD: role.password },
    stdio: ['ignore', 'inherit', 'inherit'],
  })
} finally {
  await api('/cli/login-role', { method: 'DELETE' }).catch((e) => console.error(`! could not delete temp login role: ${e.message}`))
}
execFileSync(`${PG}/pg_restore`, ['-f', join(out, 'db/full.sql'), join(out, 'db/full.dump')])
const sql = readFileSync(join(out, 'db/full.sql'), 'utf8').split('\n')

const copyRows = (table) => {
  const start = sql.findIndex((l) => l.startsWith(`COPY ${table} `))
  if (start < 0) return { cols: [], rows: [] }
  const cols = sql[start].match(/\(([^)]*)\)/)[1].split(', ')
  const rows = []
  for (let i = start + 1; sql[i] !== '\\.'; i++) rows.push(sql[i].split('\t'))
  return { cols, rows }
}
const counts = Object.fromEntries(
  ['auth.users', 'public.players', 'public.games', 'public.game_stats', 'public.medical_certificates', 'storage.objects'].map((t) => [t, copyRows(t).rows.length]),
)
if (!counts['auth.users'] || !counts['public.players']) throw new Error(`dump looks empty: ${JSON.stringify(counts)}`)

// ── storage (incremental mirror) ────────────────────────────────────────────
const unesc = (s) => s.replace(/\\(.)/g, (_, c) => ({ t: '\t', n: '\n', '\\': '\\' })[c] ?? c)
const objs = copyRows('storage.objects')
const bi = objs.cols.indexOf('bucket_id'), ni = objs.cols.indexOf('name'), mi = objs.cols.indexOf('metadata')
let fetched = 0, kept = 0
const failed = []
const pull = async (row) => {
  const bucket = unesc(row[bi]), name = unesc(row[ni])
  let size = null
  try { size = JSON.parse(unesc(row[mi])).size } catch { /* folder placeholder or no metadata */ }
  const dest = join(ROOT, 'storage', bucket, name)
  if (existsSync(dest) && (size == null || statSync(dest).size === size)) { kept++; return }
  const path = name.split('/').map(encodeURIComponent).join('/')
  const r = await fetch(`https://${REF}.supabase.co/storage/v1/object/${bucket}/${path}`, {
    headers: { Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`, apikey: env.SUPABASE_SERVICE_ROLE_KEY },
  })
  if (!r.ok) { failed.push(`${r.status} ${bucket}/${name}`); return }
  mkdirSync(dirname(dest), { recursive: true })
  writeFileSync(dest, Buffer.from(await r.arrayBuffer()))
  fetched++
}
for (let i = 0; i < objs.rows.length; i += 8) await Promise.all(objs.rows.slice(i, i + 8).map(pull))

// ── edge functions + settings ───────────────────────────────────────────────
const fns = await api('/functions')
writeFileSync(join(out, 'config/edge-functions.json'), JSON.stringify(fns, null, 1))
const work = mkdtempSync(join(tmpdir(), 'rh-fn-'))
for (const f of fns) {
  execFileSync(SUPABASE, ['functions', 'download', f.slug, '--project-ref', REF, '--use-api'], {
    cwd: work, env, stdio: ['ignore', 'ignore', 'inherit'],
  })
}
cpSync(join(work, 'supabase/functions'), join(out, 'edge-functions-source'), { recursive: true })
rmSync(work, { recursive: true, force: true })

const secrets = await api('/secrets')
writeFileSync(join(out, 'config/secret-names.txt'), secrets.map((s) => s.name).sort().join('\n') + '\n')
const auth = await api('/config/auth')
const safe = Object.fromEntries(Object.entries(auth).filter(([k]) => !/secret|pass|key|token/.test(k)))
writeFileSync(join(out, 'config/auth-config-no-secrets.json'), JSON.stringify(safe, null, 1))

writeFileSync(join(out, 'README.md'), `# rinkhockeyIL backup — ${day}

Made by scripts/backup-supabase.mjs. Contains PII — keep it on this Mac, out of iCloud and git.

- \`db/full.dump\` — whole database (pg_dump custom format, all schemas incl. auth); \`db/full.sql\` same as text
- \`../storage/\` — shared mirror of every stored file (not per-date; never pruned)
- \`edge-functions-source/\` — deployed source of all ${fns.length} edge functions
- \`config/\` — function list, secret NAMES (no values), auth settings with secrets stripped

Rows at backup time: ${JSON.stringify(counts)}

Restore: pg_restore --no-owner --no-privileges -d "<connection string>" db/full.dump
`)

// ── retention ───────────────────────────────────────────────────────────────
const dated = readdirSync(ROOT).filter((d) => /^\d{4}-\d{2}-\d{2}(-\d{4})?$/.test(d)).sort()
for (const d of dated.slice(0, Math.max(0, dated.length - KEEP))) rmSync(join(ROOT, d), { recursive: true, force: true })

execFileSync('chmod', ['-R', 'go-rwx', ROOT])
console.log(`✓ ${out}`)
console.log(`  rows ${JSON.stringify(counts)}`)
console.log(`  storage: ${objs.rows.length} objects, ${fetched} fetched, ${kept} unchanged, ${failed.length} failed`)
console.log(`  functions: ${fns.length}; kept ${Math.min(dated.length, KEEP)} dated backups`)
if (failed.length) {
  failed.slice(0, 20).forEach((f) => console.error(`  ✗ ${f}`))
  process.exit(1)
}
