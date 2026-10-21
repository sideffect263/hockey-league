# Access inventory — every account rinkhockeyIL depends on

_Written 2026-10-21 from the repos, this Mac's launch agents and Ariel's working notes._

**No secret values are in this file — only where each one lives.** Rows marked **?** were not
discoverable from the code; Ariel needs to fill them in.

**The rule for a handover:** every row below needs (a) an owner that is not one person's
private email, or a second owner, and (b) its login in a password-manager vault shared with at
least one other trusted person. Today almost every row fails both tests.

## 🔴 Single points of failure — fix these first

| # | What | Why it is fatal | Fix |
|---|---|---|---|
| 1 | **Android signing key** `rinkhockeyIL-signing/rinkhockeyil-release.jks` (+ its passwords in `KEYSTORE-INFO.md`) | It is BOTH the sideload key and the Google Play app-signing key. Lose it and no Android update can ever be installed again, on Play or by sideload. Today it sits only in `~/Documents` on this Mac (iCloud-synced to Ariel's personal iCloud). | Copy the `.jks` and its passwords into the shared vault, plus one offline copy (USB in a drawer). |
| 2 | **Apple Developer account** (team `AR3LCY2JB4`, personal — "Ariel Biton") | It is an individual account, so nobody else can be an Account Holder. If Ariel can't sign in, no iOS update can ship, and the App Store listing lapses when the yearly fee isn't paid. | Add a second person in App Store Connect as **Admin** (they can release, but not renew). Long term: move to an **Organization** account for the association (needs a D-U-N-S number), then transfer the app. |
| 3 | ~~iOS + Android main unpushed~~ ✅ pushed 2026-10-21 | — | Keep pushing after every merge; tag every release. |
| 4 | **`video-analysis/` (31 GB) is not in git and not backed up** | All the video/ML tooling (goal_fx, studio_worker, lab_worker, models) lives in one folder on one disk. | Put the code (not the data) in a private GitHub repo; back up the models + labels to Drive or the backup disk. |
| 5 | **Jobs that run only on this Mac** (see below) | If the Mac is off, the Podium sync, weekly backup, Apple secret renewal and video lab stop silently. The Apple one breaks "Sign in with Apple" on the web within a few months. | Move them to GitHub Actions / Supabase cron, or document the "run it by hand" fallback (RUNBOOK.md). |
| 6 | **Personal email addresses own the core accounts** | Two personal Gmails (`arielxx263@…` and `arielbiton03@…`) own Supabase, Cloudflare, GCP, Firebase, Resend and Play. | Create a league address (e.g. `admin@rinkhockeyil.com` via Cloudflare Email Routing) and add it as a second **Owner** everywhere. |

## Accounts and services

Legend for **2nd owner?** — 🔴 needed now · 🟠 should have one · 🟢 low risk / replaceable.

| Service | What it does for us | Owner today | Where the credential lives | If access is lost | 2nd owner? |
|---|---|---|---|---|---|
| **Domain `rinkhockeyil.com` — registrar** | Owning the name | **?** (bought by 2026-07-11; registrar not recorded) | **?** | Domain expires → site, email and app links die | 🔴 Fill in registrar + renewal date; turn on auto-renew |
| **Cloudflare** (zone `7d0c400b…`) | DNS for the site and `api.` (DNS-only/grey cloud), email routing, **Stream** (live video + recordings), Realtime TURN | `arielxx263@gmail.com` | Cloudflare login; Stream token + account id as Supabase function secrets (`CF_STREAM_TOKEN`, `CF_ACCOUNT_ID`, `CF_TURN_KEY_ID`, `CF_TURN_API_TOKEN`) | DNS can't be changed; streaming bills go unpaid → streams stop | 🔴 Add a member with Administrator |
| **Vercel** team `rinkhockeyil` | Hosts the website + `/api/*` functions. Projects: `hockey-league` (prod, rinkhockeyil.com) and `hockey-league-dev` | Created via a shared Google account; user `rinkhockeyiltestuser-9007` | Vercel login; CLI token on this Mac; GitHub Actions secrets in the fork; `.env.local` | Can't deploy the website | 🔴 Invite a second member (Hobby → may need Pro for teams) |
| `hockey-league-pro.vercel.app` | Old site from Idan's repo. **Not ours, drifting, ignore** | Idan (someone else's Vercel) | — | Nothing (not used) | — |
| **GitHub** `sideffect263` | Repos: `hockey-league` (web, the **fork** is the real one), `rinkhockeyil-ios`, `rinkhockeyil-android`. Actions run the deploys. | Ariel (`sideffect263`) | GitHub login; fine-grained PATs in Vercel env (`GITHUB_TOKEN` for live-edit) | Code still on this Mac, but no deploys via Actions | 🔴 Move the repos to a GitHub **organization** (free) with 2 owners |
| `IdanLichter/hockey-league` | The original repo. **Frozen — never push.** | Idan | — | Nothing | — |
| **Supabase** org "sideffect263's Org", project `slpwwoupbbxcgjivcspv` (Tokyo, **Pro**, $10/mo custom domain `api.rinkhockeyil.com`) | The whole backend: DB, auth, storage, 13+ edge functions, cron, realtime | Owners: `arielxx263@gmail.com` + `arielbiton03@gmail.com` (same person) | Dashboard login; `SUPABASE_ACCESS_TOKEN` in `hockey-league/.env`; service-role key in `.env.podium`; 28+ function secrets in the dashboard | **Everything stops** when the Pro bill fails | 🔴 Add a non-Ariel Owner; billing card that isn't only Ariel's |
| **Google Cloud** project `rinkhockeyil` (#663565111087) | Google sign-in OAuth clients (web/iOS/Android) | `arielbiton03@gmail.com` | GCP console; web client secret stored in Supabase auth settings | Can't change Google sign-in (it keeps working) | 🟠 |
| **Firebase** `rinkhockeyil-c1694` (Spark/free) | Android push (FCM) | `arielbiton03@gmail.com` | `app/google-services.json` in the Android repo; service-account key as Supabase secrets `FCM_*` | Android push keeps working until the key is revoked | 🟠 |
| **Apple Developer / App Store Connect** team `AR3LCY2JB4` | iOS app `com.arielbiton.rinkhockeyil` (+ watch + Live Activity ids), TestFlight, APNs push, Sign in with Apple | Ariel, **individual account** | Apple ID; ASC API key `23CGB7K85Q` in `~/.appstoreconnect/private_keys/`; distribution cert `rinkhockeyIL-signing/dist.p12` + keychain; APNs key `BWX82829T9` (shared with the Fleet Commander app!) as Supabase secrets `APNS_*`; Sign in with Apple web key `J984K4BSP7` | No iOS releases; app dropped from the store if the yearly fee isn't paid | 🔴 See SPOF #2 |
| **Google Play Console** (personal account "ariel biton", app id `4973565247895557401`) | Android on Play (Alpha now; production apply ≈ 2026-11-03) | `arielbiton03@gmail.com` | Play login; signing = the `.jks` above | No Play updates (sideload still works with the key) | 🔴 Add a user with Admin in Play Console |
| **Resend** | Sign-up / password emails from `noreply@send.rinkhockeyil.com` (free tier, 100/day) | `arielbiton03@gmail.com` | Sending key stored in Supabase auth SMTP settings | Sign-up and password-reset emails stop | 🟠 Low effort to recreate if DNS is reachable |
| **Google Analytics 4** `G-JPELTXPT8V` + **Search Console** `sc-domain:rinkhockeyil.com` | Traffic stats, SEO | Ariel's Google account | Google login | Lose stats only | 🟢 Add a second user |
| **Gemini API** | Translates external news to Hebrew (edge fn `ingest-rink-hockey-news`) | Ariel | Supabase secret `GEMINI_API_KEY` | News ingest stops (site fine) | 🟢 |
| **OpenAI API** | `api/generate-poster-bg.js` (poster backgrounds) — optional | Ariel | Vercel env `OPENAI_API_KEY` (may be unset) | Poster backgrounds stop | 🟢 |
| **Claude account (Ariel's)** — cloud routines | Weekly preview post (Fri), game stories (Sun 06:00 UTC, `trig_01MZUWBz…`), live-edit agent (`trig_013xTekF…`), one more (`trig_01X77NzA…`) | Ariel's claude.ai account | Routine prompts live in the repo: `scripts/weekly-preview/ROUTINE.md`, `scripts/game-story/ROUTINE.md`; their tokens (`WEEKLY_PREVIEW_TOKEN`, `GAME_STORY_TOKEN`) are in the routine prompts and `.env` | Friday preview + game stories stop. Site fine. | 🟠 A successor recreates them in their own Claude account from the ROUTINE.md files |
| **Podium** (association membership system) | Source of paid members + medical certificates (`scripts/podium-sync.mjs`) | Ariel's Podium login | `hockey-league/.env.podium` (`PODIUM_USER`, `PODIUM_PASS`) on this Mac only | Medical/membership import stops | 🟠 Ask the association for a dedicated login |
| **YouTube** (news sources only, RSS) | Read-only | — | — | — | 🟢 |
| **Home network** — HOT Box router, DHCP lease `kookisnooki → 192.168.1.9` | Lets the Mac reach the video PC | Ariel | Router admin | Only video extras | 🟢 |
| **The hive** (Mac, `kookisnooki` Windows GPU PC, `navi` Windows) | Video processing, ML training, dashboards | Ariel's home | `~/work/repos/pc-control-room` | Only extras (see CORE-VS-EXTRAS.md) | 🟢 Not needed to run the league |

## Jobs that run ONLY on this Mac (launchd)

| Agent | Schedule | What it does | If the Mac is gone |
|---|---|---|---|
| `com.rinkhockeyil.podium-sync` | 07:30, 12:30, 17:30, 22:30 | `~/.rinkhockey/podium-sync/run.sh` → copies Podium members + medicals into Supabase | New medicals/payments stop appearing; LM can still approve by hand |
| `com.rinkhockeyil.backup` | Sundays 09:00 | `~/.rinkhockey/backup/run.sh` → pg_dump + storage mirror to `~/Backups/rinkhockeyil/` (local disk only!) | No offsite backup. Supabase Pro still keeps 7 daily backups |
| `com.rinkhockeyil.apple-secret` | 1st of every month 10:00 | Renews the "Sign in with Apple" **web** client secret (a JWT that lasts at most 6 months) | Web Apple sign-in breaks ≤ 6 months later. iOS native Apple sign-in is unaffected |
| `com.rinkhockeyil.lab-worker` | Always on | `video-analysis/lab_worker.py` + the studio worker thread → video lab renders, 9:16 kits sent to kookisnooki | /creators video kits stay "בהכנה" forever |

Installed copies live in `~/.rinkhockey/<name>/` — **they are snapshots**; after editing the repo
script, copy it there again.

## Jobs that run in Supabase (safe — no machine needed)

`cron.job` as of 2026-10-21: `game-reminders` (hourly :05), `coach-open-items` (hourly),
`expire-stale-live-games` (*/5 min), `medical-expiry-notify` (08:00 daily), `birthday-posts`
(04:07, 09:07 UTC), `rink-hockey-news` (05:23, 13:23, 20:23 UTC), `video-seo-sync` (*/10 min),
`prune-app-events` (03:40 daily).

## What Ariel should do this week (about 2 hours)

1. Create a shared vault (1Password / Bitwarden family or team) with one trusted person. Put in
   it: the `.jks` + passwords, the Apple ID, both Gmails' recovery info, Cloudflare, Vercel,
   Supabase, Play, registrar, Podium.
2. Pick the second owner and add them: Supabase org (Owner), Cloudflare (Admin), Vercel team,
   GitHub (org owner or repo admin), Play Console (Admin), App Store Connect (Admin).
3. Fill in the **?** rows above (registrar, renewal date, billing cards).
4. ~~Push the iOS and Android `main` branches.~~ Done 2026-10-21.
5. Copy the keystore folder `rinkhockeyIL-signing/` to an offline USB.
