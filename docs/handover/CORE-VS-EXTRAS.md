# Core vs extras — what must keep running, and what can be switched off

_Written 2026-10-21._

If you take this over, **your job is to keep the core alive.** Everything else is a bonus you
may switch off without guilt. The league ran on paper before this site existed. What players,
coaches and the league manager actually depend on is the core list.

## Core — needs only Supabase + Vercel + the stores

None of this touches a home machine. It keeps working if every PC in Ariel's house is unplugged
forever.

| Feature | Lives in |
|---|---|
| Website, sign-in (email, Google, Apple), profiles | Vercel + Supabase auth |
| Fixtures, `/games`, calendar feed `api/calendar` | `games` table, `api/calendar.js` |
| Game sign-up / availability, medical gate, suspensions | DB RPCs + RLS |
| Judging a live game (judge board, apps) → result → standings | `live_game_state`, `judge_save_game_result`, `recompute_team_standings` |
| Standings, players, teams, top scorers | DB, derived totals by trigger |
| Game form (טופס שיפוט) export + signing | edge fn `game-form`, `api/game-form.js` |
| Reminders + notifications + push (web, iOS, Android) | cron `game-reminders`, `notifications` → `send-push` |
| Admin / league-manager / coach tools | `/admin`, mobile ניהול |
| Live streaming from the apps + recordings | Cloudflare Stream via `stream-golive` / `stream-replay` (costs money per game) |
| Season rollover | `close_season()` RPC |

**Costs to keep the core alive (approx.):** Supabase Pro $25 + custom domain $10/mo, domain
yearly, Apple $99/yr, Cloudflare Stream per minute streamed, Vercel free/hobby. Play was a
one-off $25.

## Extras — fine to lose

| Extra | Depends on | What happens if that dependency is gone | How to switch it off cleanly |
|---|---|---|---|
| Video lab, studio 9:16 kits, goal highlights, game plays | **This Mac** (`lab-worker`) + **kookisnooki** (GPU, `kookisnooki.local:8790`) | Kits sit at "בהכנה" / "ממתין לעיבוד" forever. The rest of /creators works. | Hide the tabs in /creators, or simply don't queue kits. Unload: `launchctl bootout gui/$UID/com.rinkhockeyil.lab-worker` |
| Match stats, crowd review (`/games/:id/stats`) | Offline ML runs on kookisnooki | No new stats; existing ones stay | `league_settings.feature_match_stats = 'off'` |
| Player media on mobile | — | — | `league_settings.feature_player_media = 'off'` |
| Podium membership + medical import | **This Mac** (`podium-sync`) + Ariel's Podium login | LM uploads/approves medicals by hand (the app already supports this) | `launchctl bootout gui/$UID/com.rinkhockeyil.podium-sync` |
| Weekly Friday preview post | Claude cloud routine (Ariel's account) | No Friday post | Nothing — it just stops |
| Game stories (סיפור משחק) | Claude cloud routine | No new stories; published ones stay | `league_settings.game_story_publish_mode` |
| World news in the feed | Gemini key + cron `rink-hockey-news` | No new news items | `select cron.unschedule('rink-hockey-news');` |
| Feed ranking tweaks | `league_settings.feed_ranking` | — | Edit the JSON; no release needed |
| הוקי מרקט (play-money market) | DB only | — | Leave it, or hide the nav link |
| Live-edit agent (dev site only) | Ariel's Claude routine + GitHub PAT | Panel stops working on the dev site | Nothing — prod never shows it |
| MCP server `rinkhockeyil.com/api/mcp` | Vercel only | — | Read-only and harmless; leave it |
| 3D replay, rink points, devs page, career game | Mostly static | — | Leave them |
| Hive (navi dashboard, controllers) | Ariel's home PCs | Nothing in the league breaks | — |
| Sunday game-art posts | A Claude skill on this Mac | No art post | — |

## The rule for new work after a handover

Before building anything new, ask: **"can a volunteer with Claude Code keep this alive with no
home machine?"** If not, it's an extra: it must have an off switch (a `league_settings` flag)
and must degrade to "nothing happens", never to a broken page.
