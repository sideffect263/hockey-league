# rinkhockeyil.com — Launch Execution Record

**Date:** 2026-07-12
**Outcome:** The full web launch is **live**. The site runs on a self-owned Vercel account at
`https://rinkhockeyil.com`, sends branded Hebrew transactional email through Resend, is tracked in
GA4, indexed in Google Search Console, and has native-Google-login OAuth credentials prepped.

This is the *record of what was executed*. The *pre-launch plan* lives in `../../MOBILE-BUILD/`
(`LAUNCH-PLAN.md`, `WHEN-VERCEL-ACCESS.md`, `WHEN-SUPABASE-ACCESS.md`). Lessons/gotchas are in
`02-lessons-learned.md`; open items in `03-remaining-and-future.md`.

---

## 1. Supabase — elevated access confirmed

> **2026-10-08:** the project was transferred to our own org, **sideffect263's Org**
> (`qiahwaoxjhqygweofpmq`). The `IdanLichter` org below is history. Same ref/URL/keys.

- Verified the old **403 wall is gone**: `arielbiton03@gmail.com` is now an **Owner** of the
  `IdanLichter` Supabase org (`liomguecuaczpzxvxyoj`). Same token (`sbp_458d…`, already in
  `hockey-league/.env` + the Supabase MCP) — a real role promotion, not a temporary PAT.
- `PATCH /v1/projects/slpwwoupbbxcgjivcspv/config/auth` now returns **200** (was 403).

## 2. Vercel — self-owned account + deploy

- New **self-owned Vercel account** created (via the shared Google account in Chrome). Team slug
  **`rinkhockeyil`**, personal user `rinkhockeyiltestuser-9007`.
- Could **not** GitHub-import the app: the repo `github.com/IdanLichter/hockey-league` is owned by
  Idan; `sideffect263` is only a *collaborator*, which isn't enough to install Vercel's GitHub app
  on his account. → Deployed **from the local copy via the Vercel CLI** instead (no
  auto-deploy-on-push; redeploy with `vercel deploy --prod --scope rinkhockeyil` from
  `hockey-league/`).
- Project **`hockey-league`** created (`prj_0DuFW7a6zra5uCw4Y5uEXPWvmsNL`, org
  `team_LuBaggO3yTGb6EoNmLCZGCXA`). Vite auto-detected, output `dist`.
- Env vars set on the project: `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` (from local `.env`),
  later `VITE_SITE_URL=https://rinkhockeyil.com` and `VITE_GA4_ID=G-JPELTXPT8V`.

## 3. Domain — rinkhockeyil.com live with HTTPS

- DNS is on **Cloudflare** (account `Arielxx263@gmail.com`, zone
  `7d0c400b5f54e69c9d29d4a2f8975de1`). Added, **grey-cloud / DNS-only** (proxying breaks Vercel's
  cert issuance):
  - `A  rinkhockeyil.com → 76.76.21.21`
  - `A  www → 76.76.21.21`
- Kept Cloudflare Email Routing (`MX → *.mx.cloudflare.net` + DKIM) untouched.
- Vercel verified the domain (`attached: true, verified: true`) and issued the SSL cert (~1 min).
- **`www → apex` 308 redirect** configured in Vercel domain settings (had to be done in Vercel, not
  Cloudflare, because grey-cloud DNS bypasses Cloudflare's redirect rules).
- Verified end-to-end: `https://rinkhockeyil.com` → 200 + valid TLS; `www/...` → 308 → apex.

## 4. Supabase site_url + redirect allow-list

- `PATCH /config/auth`: `site_url = https://rinkhockeyil.com`.
- `uri_allow_list` broadened to: `https://rinkhockeyil.com/**`, `https://www.rinkhockeyil.com/**`,
  `https://hockey-league-pro.vercel.app/**` (kept, so nothing in use breaks),
  `https://hockey-league-wheat.vercel.app/**`, `http://localhost:5173/**`.

## 5. Resend SMTP — kills the 2/hour email limit

- Resend account = `arielbiton03@gmail.com`. Sending domain **`send.rinkhockeyil.com`** (id
  `8069c703-2c2a-474c-99c8-e38eb04df7e9`, region **eu-west-1 / Ireland**) — **verified**.
- DNS records (DKIM + SPF + return-path MX) were written to Cloudflare via Resend's **Auto-configure**
  (avoided hand-transcribing the DKIM key). A subdomain is used so the root domain's inbound Email
  Routing is undisturbed.
- Supabase `/config/auth` SMTP: host `smtp.resend.com`, **port `"465"` (must be a string)**, user
  `resend`, pass = the (sending-only) Resend API key, `smtp_admin_email = noreply@send.rinkhockeyil.com`,
  sender name **`ליגת הרולר הוקי הישראלית`**, `rate_limit_email_sent = 30`.
- Verified: a live send from the domain returned HTTP 200 (Resend log = Delivered).

## 6. Hebrew RTL auth email templates

- Rewrote the Supabase auth email templates: **confirmation, recovery, magic-link, email-change** —
  branded card, RTL, orange `#f97316` accent, crest logo
  `https://rinkhockeyil.com/logos/main-logo.png`. Builder: (scratchpad) `build_emails.py`.
- Verified in production via the Resend log: signup confirmation → subject
  `אישור ההרשמה — ליגת הרולר הוקי הישראלית`; password reset → subject `איפוס הסיסמה שלך`.
- Sender name aligned to the full brand `ליגת הרולר הוקי הישראלית`.

## 7. GA4 analytics

- New GA4 property **"ליגת הרולר הוקי הישראלית"** (account `naga`/`a316887063`, Israel timezone,
  Sports category), web data stream `rinkhockeyil.com`, **Measurement ID `G-JPELTXPT8V`**.
- Set `VITE_GA4_ID=G-JPELTXPT8V` on Vercel + redeployed. The app gates GA on this var
  (`src/lib/analytics.js`). Verified the tag (`googletagmanager` + the ID) is live in the prod bundle.

## 8. Google Search Console + sitemap

- **Domain property** `sc-domain:rinkhockeyil.com` **verified** via a manual DNS TXT
  (`google-site-verification=…`) added at Cloudflare.
- **Sitemap submitted:** `https://rinkhockeyil.com/sitemap.xml` (shows "couldn't fetch" immediately
  after submission — normal; flips to Success once Google crawls it).

## 9. GCP OAuth — native-login credentials (prep)

- New **self-owned Google Cloud project `rinkhockeyil`** (project# `663565111087`, in
  `arielbiton03`'s account). Consent screen app **"rinkhockeyIL"**, External (still in **Testing**
  mode). OAuth clients created:
  - **Web** `663565111087-mq28g5gcqoc1ff8mf40ldnvkq5fk34au` (redirect = Supabase callback)
  - **iOS** `663565111087-re1or1lmomikljk37hls0v778i3k6664` (bundle `com.arielbiton.rinkhockeyil`)
  - **Android** `663565111087-ba1kboujptosh1omid75v83laj2ldu56` (package `com.arielbiton.rinkhockeyil`
    + release-keystore SHA-1 `C9:C9:AA:25:38:61:C2:B0:09:68:2A:6F:47:A7:99:9A:FB:DA:04:B3`). Because
    the Android app is **sideloaded** (no Google Play App Signing), this release SHA-1 *is* the final
    signing cert — correct as-is.
- Wired into Supabase: `external_google_client_id` = **`492430847434-…kssa` (PRIMARY, unchanged →
  web login intact)** + the three new IDs as additional audiences. Verified the web Google OAuth flow
  still uses `client_id=492430847434…`.

## 10. Housekeeping

- Deleted the throwaway test user `arielbiton03+rinkconfirm@gmail.com` (created only to test the
  confirmation email).
