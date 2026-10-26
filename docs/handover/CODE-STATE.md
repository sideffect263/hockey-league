# Code state — the folders under `hockey/`

_Snapshot 2026-10-21, after `git fetch --all`. "behind/ahead" = commits relative to that repo's
local `main`. Nothing has been deleted or pushed by this survey._

There are really only **four codebases**. Almost every other folder is a `git worktree` (a
second checkout of the same repo on another branch), left behind by feature and release work.

| Codebase | Main folder | Remote | `main` state |
|---|---|---|---|
| Web + backend | `hockey-league` | `fork` = `sideffect263/hockey-league` | ✅ pushed, clean |
| iOS | `HockeyTimer-iOS` | `origin` = `sideffect263/rinkhockeyil-ios` | ✅ pushed 2026-10-21 (99ff599) |
| Android | `HockeyLeague-Android` | `origin` = `sideffect263/rinkhockeyil-android` | ✅ pushed 2026-10-21 (4d73cd6) |
| Video / ML | `video-analysis` (31 GB) | **none, not a git repo** | 🔴 no history, no backup |
| (legacy) | `hockeyTimer` | `zivzakalik/hockeyTimer` | the 2025 Android original, untouched since 2025-03-15. Reference only |

## Step 1 — do now (5 minutes)

```bash
# done 2026-10-21: git -C HockeyTimer-iOS push
```
```bash
# done 2026-10-21: git -C HockeyLeague-Android push
```
Then put `video-analysis` code into a private repo (exclude `data/`, `dataset*/`, `cache/`,
`devlab_cache/`, `*.pt`, videos via `.gitignore`), and copy model weights + labels to a backup.

**No release is tagged in any repo.** From now on tag every shipped build (`git tag v1.5.3-63`)
so a successor can find what's live.

## Step 2 — branches that still hold unmerged work (decide, don't delete)

| Folder | Branch | Ahead of main | Pushed? | What it is / recommendation |
|---|---|---|---|---|
| `HockeyTimer-iOS-crest` | `official-crest` | 4 | ❌ | Official crest icon + rink-draw launch. **Blocked**: Ariel dropped the letter route 10-18 and wants a new mark. Push the branch to keep it, then remove the worktree. |
| `HockeyLeague-Android-crest` | `official-crest` | 3 | ❌ | Same, Android. Same action. |
| `HockeyLeague-Android-rel-151` | `hotfix-1.5.1` | 1 | ❌ | **Shipped** 1.5.1 (61). Tag it `v1.5.1-61` and push the tag, then remove. |
| `HockeyLeague-Android-rel-152` | `release-1.5.2` | 3 | ❌ | **Shipped** 1.5.2 (62) to Play Alpha (cherry-picks, so not on main as-is). Tag `v1.5.2-62`, push the tag, remove. |
| `hockey-league-devs-visual` | `devs-visual-cleanup` | 1 | ❌ | /devs page cleanup b901227. Push or merge, then remove. |
| `hockey-league-liveactivity-android` | `live-activity-android` | 3 | ❌ | Live Activity push incl. Android FCM fan-out. Push to keep; decide later. |
| `hockey-league-liveactivity` | `live-activity` | 2 | ✅ fork | Live Activity backend. Safe on GitHub; worktree can go. |
| `hockey-league-matchstats` | `match-stats-preview` | 14 | ✅ fork/dev | Match centre preview (main has the shipped version). Worktree can go. |
| `HockeyTimer-iOS-rel-153`, `HockeyLeague-Android-rel-153` | `ios-rel-153`, `rel-153` | 0 (bump uncommitted) | — | **Current release 1.5.3 (63), not published.** Keep until it ships. |

## Step 3 — merged worktrees: DONE 2026-10-21

57 fully merged worktrees were removed (iOS, Android and web feature/release folders, plus
`live-edit-wt`). Their work is in `main`; their branches still exist locally. Uncommitted
leftovers were version bumps (discarded) and screenshot folders + one iOS patch, archived to
`MOBILE-BUILD/worktree-archive-2026-10-21/`.

Still present on purpose: the Step 2 folders above (unmerged work) and the two `*-rel-153`
release folders.

## Other folders (not code)

| Folder | What | Keep? |
|---|---|---|
| `MOBILE-BUILD/` | Specs, store copy, screenshots, every release's APK/AAB + checklist | Keep. **Not in git**: back it up (it holds the only copies of R8 mapping files). |
| `rinkhockeyIL-signing/` | Android keystore, Apple dist cert, keys | **Keep forever.** Vault + offline copy. Never commit. |
| `tutorials/` | 9 role tutorial videos + generator | Keep |
| `hockey-photos/`, `crests-cutout/`, `media-pack/`, `game-story-previews/` | Photo + asset working dirs | Keep (assets), low priority |
| `CODE-REVIEW/` | July 2026 review, 109 findings | Reference |
| `RECONCILE/`, `whatsapp-simulation-feedback/`, `mockups/`, `apk-share/` | One-off working files | Can archive |
| `HANDOFF-*.md`, `SESSION-HANDOFF-*.md`, `NEXT-SESSION.md`, `REBUILD-SPEC.md` (root) | July handoffs | Historical. **This folder supersedes them.** |

## After cleanup, the target shape

```
hockey/
  hockey-league/          web + backend   (main = live)
  HockeyTimer-iOS/        iOS             (main = next release, tags = shipped)
  HockeyLeague-Android/   Android         (main = next release, tags = shipped)
  video-analysis/         extras          (its own private repo)
  MOBILE-BUILD/           release artefacts (backed up)
  rinkhockeyIL-signing/   keys            (vault + offline)
```
A newcomer should be able to answer "what's live?" from `main` + the latest tag alone.
