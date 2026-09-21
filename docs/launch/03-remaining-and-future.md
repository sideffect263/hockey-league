# Remaining & Future Work — rinkhockeyil.com

As of **2026-07-12**, the web launch is complete. Everything below is optional, future, or blocked
on an external input — **nothing here blocks the live site.**

---

## Quick housekeeping

- **Rotate the Resend API key.** The current (sending-only) key was pasted in plaintext during
  setup. Low risk, but good hygiene:
  1. In Resend → API keys, create a new **Sending access** key.
  2. Update Supabase SMTP: `PATCH /config/auth` with the new key as `smtp_pass` (via `curl`).
  3. Delete the old key in Resend.
  - *Claude can't create the key (no account/credential creation) — you create it, then Claude can
    swap it into Supabase.*
- **Test user cleanup** — ✅ done (`arielbiton03+rinkconfirm@gmail.com` deleted).

## Optional features (need one input from you)

- **Poster generator (`api/generate-poster-bg.js`).** Currently returns `503` because its secrets
  aren't set on the new Vercel project. To enable the DALL·E matchday-poster feature, set on Vercel:
  - `OPENAI_API_KEY` — **you provide** (copy from the old Vercel project, or a new OpenAI key).
  - `SUPABASE_SERVICE_ROLE_KEY` — Claude can fetch this from Supabase.
  - `SUPABASE_URL` — same value as `VITE_SUPABASE_URL`.
- **Hebrew-ize the remaining minor email templates.** Done: confirmation, recovery, magic-link,
  email-change. Still English: **reauthentication** (OTP code) and the **notification** emails
  (password-changed, email-changed, etc.). Lower priority; same builder approach.

## SEO / analytics follow-ups (low urgency)

- **Search Console:** the sitemap will flip from "couldn't fetch" to Success within ~a day; then use
  URL Inspection → "Request indexing" on the main pages to speed up first indexing.
- **GA4 ↔ GSC link** and re-scraping social caches (Facebook debugger, X validator) for the new
  domain — nice-to-have from the original `WHEN-VERCEL-ACCESS.md` plan.
- Consider setting `VITE_SITE_URL` handling / canonical for `www` vs apex if any deep links surface.

## Deployment workflow — DECIDED 2026-09-21 (was "pending")

The fork option won, and both environments now come from **`sideffect263/hockey-league`**:

| branch | site | how it deploys |
|---|---|---|
| `dev` | hockey-league-dev.vercel.app | `.github/workflows/deploy-dev.yml` — on push, and by hand |
| `main` | **rinkhockeyil.com** | `.github/workflows/deploy-public.yml` — **`workflow_dispatch` only** |

`git push` still does not publish the league's site, and that is deliberate, not a leftover of the
old CLI-only setup: landing code on a branch must never be able to publish to the league. Somebody
presses the button — from the Actions tab, or from the live-edit panel's promote action, or by
running `scripts/deploy-public.sh` locally (which is also the only path that announces a new Android
APK version to `league_settings`, so an app release still goes through the script).

Read the trade-off before touching any of it. The public site used to be published from
`IdanLichter/hockey-league@main` with a separate PAT, `UPSTREAM_TOKEN`, as the only credential able
to write there — the fork's own token could not. One repo means one token, so what stands between
the live-edit agent and the league's website is now `api/live-edit-promote.js`'s audit and the
protected-path fence in `deploy-dev.yml`, **not a credential it does not hold**. Those two are
load-bearing. `UPSTREAM_REPO` / `UPSTREAM_TOKEN` survive as env overrides, so splitting it back
apart is a configuration change, not a rewrite.

One consequence worth writing down because nobody will notice it failing:
`IdanLichter/hockey-league@main` still auto-deploys **hockey-league-pro.vercel.app**, which is
outside our Vercel account. Nothing we do feeds it any more, so it will drift, silently.

## Native app auth (updated 2026-07-13)

**Current state (verified against code + live Supabase config):**
- **Web** — Google is **live** (`AuthContext.signInWithGoogle` → `signInWithOAuth`, button in
  `AuthModal.jsx`); Supabase `google: true`. No Apple.
- **Android** — native Google is **fully wired** (`GoogleSignInHelper` → Credential Manager →
  `signInWithIdToken`) with the real web client id `663565111087-mq28g5gcqoc1ff8mf40ldnvkq5fk34au`;
  live button in `AuthScreen.kt`. No Apple (not required on Android).
- **iOS** — Google + Apple sign-in **built + configured + enabled (2026-07-13)**:
  `SupabaseAuth.signInWithIdToken`, `AuthStore.signInWithGoogle/Apple`, `GoogleSignInService`
  (GoogleSignIn SwiftPM 8.x), `AppleSignInService` (nonce+token), buttons in `AuthSheet.swift`,
  entitlement + URL scheme in `project.yml`, `socialLoginEnabled = true`. Simulator build passes.

**Config all done (2026-07-13):** iOS Google client id wired
(`663565111087-re1or1lmomikljk37hls0v778i3k6664`); **GCP consent published**; **Supabase Apple
provider enabled** (Client IDs = bundle id — native flow, **no `.p8`/secret needed**, that's web-only);
**App ID has "Sign in with Apple"**. See `MOBILE-BUILD/APPLE-SIGNIN-SETUP.md`.

**Only remaining:** bump `CURRENT_PROJECT_VERSION` 11→12, `xcodegen generate`, archive → TestFlight,
and device-test both buttons before any App Store submission (watch for the Apple nonce edge case —
enable `external_apple_skip_nonce_check` if it bites).

## Store / metadata (low urgency)

- Point App Store / Play listing + in-app **privacy & support links** at `rinkhockeyil.com`.

---

### Reference IDs (non-secret)

| Thing | Value |
|---|---|
| Supabase project ref | `slpwwoupbbxcgjivcspv` |
| Vercel team / project | `rinkhockeyil` / `hockey-league` |
| Cloudflare zone | `7d0c400b5f54e69c9d29d4a2f8975de1` (acct `Arielxx263@gmail.com`) |
| Resend sending domain | `send.rinkhockeyil.com` (eu-west-1) |
| GA4 Measurement ID | `G-JPELTXPT8V` |
| GSC property | `sc-domain:rinkhockeyil.com` |
| GCP project | `rinkhockeyil` (#`663565111087`) |
| Android/iOS id | `com.arielbiton.rinkhockeyil` |
| Release SHA-1 | `C9:C9:AA:25:38:61:C2:B0:09:68:2A:6F:47:A7:99:9A:FB:DA:04:B3` |
