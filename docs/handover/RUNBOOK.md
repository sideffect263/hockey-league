# Runbook — operating rinkhockeyIL without Ariel

_Written 2026-10-21. Read [ACCESS-INVENTORY.md](ACCESS-INVENTORY.md) first: none of this works
without the logins._

## How to work on this (read first)

This system was built almost entirely with **Claude Code**, and that is still the easiest way to
run it. Open Claude Code in the folder you're working on: it reads that repo's `CLAUDE.md`
automatically. Then ask in plain words ("record yesterday's result", "ship the Android app").
Give it this runbook as context. Rules that matter more than any code:

- **One Supabase project serves everything** (dev site, prod site, both apps). Any SQL you run
  touches real players' data, including minors and medical records. Test inside
  `begin; … rollback;` first.
- **Pushing does not publish.** The website goes live only when someone runs the deploy. The
  apps go live only through the stores / APK upload.
- **Never `git add -A`.** Stage files by name.
- **Web repo: push to `fork`, never `origin`.** The mobile repos use `origin`.

## The pieces

| Piece | Folder | Repo | Goes live via |
|---|---|---|---|
| Website + `/api` | `hockey/hockey-league` | `sideffect263/hockey-league` (remote **`fork`**) | GitHub Actions "deploy public" or `scripts/deploy-public.sh` → Vercel |
| Database, auth, edge functions, cron | `hockey-league/supabase/` | same | Supabase MCP / dashboard / `supabase` CLI |
| iOS + watch app | `hockey/HockeyTimer-iOS` | `sideffect263/rinkhockeyil-ios` | TestFlight → App Store review |
| Android app | `hockey/HockeyLeague-Android` | `sideffect263/rinkhockeyil-android` | APK on rinkhockeyil.com (sideload) + Google Play |
| Video / ML tooling (extras) | `hockey/video-analysis` | **not in git** | runs on the Mac + kookisnooki |
| Release artefacts, store copy, specs | `hockey/MOBILE-BUILD` | not in git | — |
| Signing keys | `hockey/rinkhockeyIL-signing` | **never in git** | — |

## 1. Deploy the website

```bash
cd hockey-league && git push            # main → fork/main (NOT origin)
```
Then **one** of:
- GitHub → `sideffect263/hockey-league` → Actions → **deploy public** → Run workflow (branch `main`).
- `./scripts/deploy-public.sh` (needs the Vercel CLI logged into team `rinkhockeyil`). It
  deploys `fork/main` from a clean worktree, never your working tree.

Dev site (`hockey-league-dev.vercel.app`) = push to `dev`, or Actions → **deploy dev**. A push
touching `supabase/`, `api/`, `.github/`, `vercel.json` is refused by design. Run it by hand
from Actions instead.

**Check it's live:** don't trust the deploy log. Curl the site and look for a string the change
introduced: `curl -s https://rinkhockeyil.com | grep …`, or open the page.

## 2. Change the database

1. Write the SQL as a file in `hockey-league/supabase/<name>.sql` (plus `<name>-down.sql` to undo).
2. Rehearse: run it inside `begin; … rollback;` via the Supabase MCP (`execute_sql`) or the
   dashboard SQL editor. Check row counts.
3. Apply for real (MCP `apply_migration`, or the dashboard). Commit the file.
4. If iOS/Android read the changed table, check the apps still decode it. Old app versions stay
   in use for weeks. **Add columns; never rename or drop** what an app reads.

Gotcha: `players` has column-level grants. `select *` on it fails the whole request. Always
name the columns.

## 3. Release the mobile apps (both together)

**Rule:** iOS and Android always ship the **same version and build number**, `X.Y.Z (N)`,
bumped together. Never reuse or lower a build number. Check `UNRELEASED.md` in each repo: it
lists what must go out and feeds "What's New". Empty it after the release is live.

Last state (2026-10-21): **1.5.3 (63)** built on both, not published. See
`MOBILE-BUILD/release-1.5.3/CHECKLIST.md`. Each release gets a `MOBILE-BUILD/release-X.Y.Z/` folder.

### Android
```bash
export JAVA_HOME=/opt/homebrew/opt/openjdk@17/libexec/openjdk.jdk/Contents/Home
export ANDROID_HOME=/opt/homebrew/share/android-commandlinetools
cd HockeyLeague-Android      # bump versionCode/versionName in app/build.gradle.kts
./gradlew testReleaseUnitTest lintRelease :app:assembleRelease :app:bundleRelease
```
- Signing reads `keystore.properties` → `rinkhockeyIL-signing/rinkhockeyil-release.jks`.
  **Without this exact key, updates cannot install.**
- **Sideload:** copy the APK to `hockey-league/public/rinkhockeyIL.apk`, commit, push, then
  run **`scripts/deploy-public.sh`**. Use the script, not the Action: only the script updates
  `league_settings.android_latest_version`, which shows users the update banner.
- **Play:** Play Console → app → Testing → Closed (Alpha) → new release → upload the `.aab`.
  Production access can be requested from ≈ 2026-11-03 (needs ≥ 12 opted-in testers for 14 days).
- Keep `mapping.txt` from each build (R8 is on). Crash traces can't be read without it.

### iOS
```bash
cd HockeyTimer-iOS           # bump MARKETING_VERSION + CURRENT_PROJECT_VERSION in project.yml
xcodegen generate
./scripts/upload.sh          # archives + uploads to TestFlight (manual signing, ASC API key)
```
- Build from a **clean worktree** if anyone else has uncommitted work: `upload.sh` archives the
  working tree.
- If capabilities changed, run `scripts/asc_fix_profiles.py` first (see `scripts/README.md`).
- Submit for review: `scripts/asc_submit_version.py prepare --version X --build N --whats-new-file f`
  then `submit --version X`. Check the state with `scripts/asc_version_state.py`. **Never trust
  an uploader's own "success"; check App Store Connect.**
- Apple reviewers need the **demo account** and 🧪 test game to exist. Check before submitting.
- Do not put the association's crest or the word "official/הרשמית" in the store listing without
  a signed permission letter. It caused two 4.1(a) rejections.

## 4. A new season

1. Load the fixtures into `games` (`season_id` = new season, `status='scheduled'`; times as
   `timestamp 'YYYY-MM-DD HH:MM' at time zone 'Asia/Jerusalem'`). Each insert auto-creates a
   market. The fixture generator in /admin can do this too.
2. At the end of a season: `select close_season('<next name>', '<starts_on>');`. It snapshots
   stats and flips the pointer, and never deletes anything. **Never** use
   `archive_and_reset_season()` (it raises on purpose; the old version deleted games).
3. Playoffs: add games with `game_type='פלייאוף'`, `playoff_round`, `is_neutral=true`. Rules
   live in `src/lib/playoffs.js` (`npm run check:playoffs`).

## 5. Record or fix a game result

Normal path: the judge finishes the game in the app → result + standings update themselves.

By hand (e.g. from a photo of the paper scoresheet), do it as one SQL block:
1. Confirm score + scorers with a human first. Handwriting lies. If scorer goals ≠ score, it
   is usually an **own goal**.
2. `games`: `home_score`, `away_score`, `home_own_goals`/`away_own_goals`, `status='completed'`.
3. `game_stats` rows for real scorers only (own goals are not player goals).
4. `perform recompute_team_standings('<home id>'); perform recompute_team_standings('<away id>');`

The `/admin` games tab can edit results too, and the game-form photo flow reads a handwritten
טופס שיפוט.

## 6. Game-day problems

| Symptom | Do this |
|---|---|
| Judge's app froze / lost the game | Judge reopens the game: native judge resumes from `live_game_state`. Worst case, finish it on the web judge board or enter the result by hand (§5). |
| A game is stuck "live" | Cron `expire-stale-live-games` clears it within ~5 min of no heartbeat; or set `status` back in /admin. |
| Live stream doesn't reach viewers | The streamer is on a **phone hotspot** (CGNAT): use real Wi-Fi. The stream only goes out via the iOS/Android app (RTMP). |
| Push not arriving | `/admin` → התראות (notification tracker) shows who got what on which device. |
| Someone can't sign in | Check `/admin` users. Password reset sends via Resend (100 emails/day limit). |
| Site down | status.supabase.com, vercel-status.com, Cloudflare dashboard. The DB is in Tokyo; slow is normal-ish. |

## 7. Backups and restore

- **Supabase Pro** keeps 7 daily backups: Dashboard → Database → Backups → Restore. This is the
  first thing to reach for.
- **Weekly local backup** (this Mac only, Sundays 09:00) → `~/Backups/rinkhockeyil/<date>/`
  (`pg_dump -Fc` + functions + config) and `~/Backups/rinkhockeyil/storage/` (files). It holds
  personal and medical data: never put it in iCloud/Drive unencrypted.
- **Restore one table** from a dump without touching the rest:
  `pg_restore --data-only -t <table> -f out.sql <dump>`, review, then run the parts you need.
- Taking a dump by hand without the DB password: `scripts/backup-supabase.mjs` (uses a
  temporary login role from the Management API; `pg_dump --role=postgres` is required).

## 8. Scheduled things to know about

- **In Supabase (always on):** reminders, coach digests, stale-game expiry, medical expiry,
  birthdays, world news, video SEO, event pruning. See `select * from cron.job;`
- **On Ariel's Mac (stop when the Mac is gone):** Podium sync, weekly backup, Apple web-sign-in
  secret renewal (monthly), video lab worker. If you take over, either reinstall them on your
  machine (`scripts/install-*-agent.sh`) or move them to GitHub Actions.
  - **The Apple secret one matters:** web "Sign in with Apple" stops working ≤ 6 months after the
    last renewal. Run `node scripts/apple-secret-renew.mjs` by hand, or move it to CI.
- **In Ariel's Claude account:** Friday preview (`scripts/weekly-preview/ROUTINE.md`), Sunday
  game stories (`scripts/game-story/ROUTINE.md`). To keep them, recreate them as routines in
  your own Claude account, using those files as the prompt.

## 9. Where the deeper knowledge is

- `hockey-league/CLAUDE.md`: git, deploys, the fence, the gotchas.
- `hockey-league/docs/`: feature specs.
- `MOBILE-BUILD/*.md`: mobile specs, store copy, `PUBLISH.md` (partly outdated), release folders.
- `HockeyTimer-iOS/scripts/README.md`: iOS signing/upload.
- `video-analysis/README.md` + `HANDOFF-*.md`: the video/ML side.
- Ariel's Claude memory (`~/.claude/projects/-Users-arielbiton-Documents-ariel-hockey/memory/`,
  ~200 notes) is **on his Mac only**. The operationally important parts are copied into this
  folder. Ask him for an export if you need the history.
