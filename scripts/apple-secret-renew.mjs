#!/usr/bin/env node
// Re-signs the Apple web sign-in client secret and pushes it to Supabase, so it
// never reaches Apple's 6-month expiry. Run monthly by the launchd agent that
// scripts/install-apple-secret-agent.sh installs; see docs/APPLE-WEB-SIGNIN.md.
//
// Only the WEB flow (Services ID) uses this secret. Native iOS Apple sign-in sends
// an ID token and doesn't need it, so a failure here breaks rinkhockeyil.com's
// Apple button, not the app.
//
// Reads from the environment (the agent sources .env.apple-renew next to it):
//   SUPABASE_ACCESS_TOKEN, SUPABASE_PROJECT_REF, APPLE_P8_PATH,
//   APPLE_KEY_ID, APPLE_TEAM_ID, APPLE_SERVICES_ID
//
//   node scripts/apple-secret-renew.mjs [--dry-run]
import { readFileSync } from 'node:fs'
import { createPrivateKey, sign } from 'node:crypto'

const dryRun = process.argv.includes('--dry-run')
const need = ['SUPABASE_ACCESS_TOKEN', 'SUPABASE_PROJECT_REF', 'APPLE_P8_PATH', 'APPLE_KEY_ID', 'APPLE_TEAM_ID', 'APPLE_SERVICES_ID']
const missing = need.filter((k) => !process.env[k])
if (missing.length) {
  console.error(`✗ missing env: ${missing.join(', ')}`)
  process.exit(1)
}
const env = process.env

// Same JWT as scripts/apple-client-secret.mjs.
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url')
const now = Math.floor(Date.now() / 1000)
const exp = now + 180 * 24 * 3600 - 60 // just under Apple's 6-month maximum
const input = `${b64({ alg: 'ES256', kid: env.APPLE_KEY_ID })}.${b64({ iss: env.APPLE_TEAM_ID, iat: now, exp, aud: 'https://appleid.apple.com', sub: env.APPLE_SERVICES_ID })}`
const sig = sign('sha256', Buffer.from(input), { key: createPrivateKey(readFileSync(env.APPLE_P8_PATH)), dsaEncoding: 'ieee-p1363' })
const secret = `${input}.${sig.toString('base64url')}`
const expires = new Date(exp * 1000).toISOString().slice(0, 10)

if (dryRun) {
  console.log(`dry run: signed a secret for ${env.APPLE_SERVICES_ID}, would expire ${expires}; Supabase not touched`)
  process.exit(0)
}

const url = `https://api.supabase.com/v1/projects/${env.SUPABASE_PROJECT_REF}/config/auth`
const res = await fetch(url, {
  method: 'PATCH',
  headers: { Authorization: `Bearer ${env.SUPABASE_ACCESS_TOKEN}`, 'Content-Type': 'application/json' },
  body: JSON.stringify({ external_apple_secret: secret }),
})
if (!res.ok) {
  console.error(`✗ Supabase PATCH ${res.status}: ${(await res.text()).slice(0, 300)}`)
  process.exit(1)
}
console.log(`✓ Apple secret renewed, expires ${expires}`)
