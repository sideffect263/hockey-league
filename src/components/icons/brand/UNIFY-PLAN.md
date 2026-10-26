# Unify the brand icons across iOS, Android and web

Goal (Ariel, 2026-10-26): every screen on iOS, Android and web shows **the same art for the same meaning**. No platform
differences, no page-to-page differences. This doc is the shared contract for the three platform sessions.

## Inputs
- `brand-icons/*.svg`: the approved art (154 files). `README.md` maps each file to its meaning and to the emoji /
  SF Symbol / Material icon it replaces, plus the list of generic controls that **stay** platform icons.
- `brand-icons/inventory-usages.json`: every emoji / SF Symbol / Material icon call site found on 2026-10-26
  (`file` paths: `ios/…` = HockeyTimer-iOS/…, `android/…` = HockeyLeague-Android/app/src/main/java/com/arielbiton/hockeyleague/…
  or …/app/src/main/…). `concept` = the meaning. Treat it as a checklist, then grep again: code moved since.
- Review page with every approved drawing: https://claude.ai/artifact/WBoC6sY1XGHS9fhvRwyZzM

## Rules (identical on all three platforms)
1. **One component per platform**, same API and same icon IDs: `BrandIcon(.goal)` (SwiftUI), `BrandIcon(BrandIcons.Goal)`
   (Compose), `<BrandIcon name="goal" />` (web, already exists on the web dev branch as `BrandIcons.jsx`). IDs = file names
   without `-large`/`-small` (e.g. `goal`, `card-blue`, `person-follow`).
2. **Size picks the file**: below 32pt/dp/px use `-small`, 32 and up use `-large` when one exists. Minimum rendered size 16.
3. **Small line icons tint** with the surrounding text colour (`currentColor` strokes): template rendering on iOS,
   `tint`/`LocalContentColor` on Android. Their fixed accents (orange ball #EA580C, card colours, green/red discs) keep
   their colour. **Large icons are full colour**, never tinted.
4. **Every meaning in README gets swapped everywhere it appears**, including the notification bell list
   (`notificationIcon` in NotificationModels.swift / .kt), feed cards, match stats, live events, stat tiles, badges,
   tab bars, section headers, empty states, Live Activity / widgets / Watch where the asset can render.
5. **Wrong-sport and broken icons first**: ⚽ / `soccerball` / `SportsSoccer` (→ goal), 🏒 / `figure.hockey` /
   `SportsHockey` (→ player or match-fallback), and iOS `gavel`, `gavel.fill`, `person.badge.checkmark` (blank today).
6. **Keep** the generic controls listed in README as platform icons. Emoji that sit **inside sentences** (post text,
   share texts, push titles) stay text.
7. Match = two real team crests with the ball (score once there is one) between them; `match-fallback-*` when no game.
8. Light and dark mode both checked. RTL (Hebrew) layout unchanged. No layout redesign beyond what an icon swap needs.

## Asset pipeline
- **iOS**: SVGs into `Assets.xcassets/BrandIcons/` as imagesets with "Preserve Vector Data"; small = template, large =
  original. If an SVG uses something the asset catalog can't render (patterns, clipPath, `<text>`), convert text to paths
  or export a PDF/PNG @2x/@3x for that file only. Live Activity and Watch targets need their own copies of what they use.
- **Android**: small line icons → VectorDrawable XML (`res/drawable/brand_*.xml`), tintable. Full-colour large ones with
  gradients/patterns/clipPath/text → WebP in `drawable-nodpi` (rendered from the SVG at 3× the largest display size) or
  VectorDrawable with `aapt:attr` gradients where it converts cleanly. Verify each converted file visually.
- **Web**: already on `fork/dev` (`src/components/icons/brand/` + `BrandIcons.jsx`); add the files that came after the
  first pass and finish the remaining spots.

## Delivery
- Each platform on its own branch. **Nothing ships**: no App Store / Play / TestFlight upload, no rinkhockeyil.com
  deploy, no push to `main`. Web may update the DEV site only (fork `dev`, normal push deploy, never bypass the fence).
- Build + run on simulator/emulator, screenshot the key screens (feed, game page, live game, player, team, standings,
  notifications, judge board) in light and dark, and save them under `brand-icons/screens/<platform>/`.
- Write `brand-icons/STATUS-<platform>.md`: what was swapped, what was left and why, branch name, screenshots list.
