# Hidden, switch-on-later features (2026-10-11)

Ship dormant in iOS 1.4.10 / Android 1.4.22; turned on later from **/admin → תכונות מוסתרות**
(or SQL). All switches live in `public.league_settings` (key text, value text, anon-readable).
**A missing key = OFF.** Apps read the keys at launch / foreground (cache last value; network
failure → last cached, never "on" by default).

## Keys

| key | value | meaning |
|---|---|---|
| `feature_review_prompt` | `on` / `off` | native store-rating dialog allowed |
| `review_prompt_min_opens` | int, default `5` | app opens (cold launch or foreground after ≥30 min) before eligible |
| `feature_push_nudge` | `on` / `off` | push opt-in card allowed |
| `push_nudge_interval_days` | int, default `21` | min days between nudges per device |
| `announcement` | JSON or empty | the remote announcement popup (below); empty/invalid/`active:false` = none |

### `announcement` JSON
```json
{ "id": "ff-2026-tickets", "active": true,
  "title": "כרטיסים לפיינל פור", "body": "…", 
  "button_label": "לפרטים", "button_url": "https://rinkhockeyil.com/games",
  "audience": "all" }
```
- `id` (required, string): shown **once per id per device** (stored locally after dismiss or button tap).
- `title` + `body` required; `button_label` + `button_url` optional (both or neither). A
  `button_url` (always a full https:// URL) on rinkhockeyil.com opens in-app via the existing link router; other hosts open externally.
- `audience`: `all` (default) | `signed_in` | `signed_out`.
- Optional `starts_at` / `ends_at` ISO timestamps; outside the window = not shown.
- Never shown on the judge board / broadcast screens, never on top of another sheet; show on the
  main tabs after launch settles (~2 s).

## Behaviour

**Review prompt** (iOS `SKStoreReviewController.requestReview(in:)` / `AppStore.requestReview`;
Android Play In-App Review `ReviewManager` — on a sideloaded APK it silently does nothing, fine).
Only when flag on AND opens ≥ min AND not yet requested for this app version AND a "happy
moment": the user's followed team just won (game page / feed result viewed), or after a successful
judge save, or after the 2nd post like / comment in a session. Never on first launch, never during a
live game screen. Record locally per version. Telemetry action `review_prompt_shown`.

**Push nudge**: only when flag on AND notification permission is not granted (iOS
`.notDetermined` → system prompt after the card; `.denied` → "פתח הגדרות" deep link; Android 13+
POST_NOTIFICATIONS same idea) AND interval elapsed. A dismissible card (Hebrew): title
"לא לפספס אף משחק", body "התראות על משחקים של הקבוצות שאתם עוקבים אחריהן, תוצאות ושינויים בלוח.",
buttons "הפעלת התראות" / "לא עכשיו". Shown at the top of the feed (not a modal). Telemetry
`push_nudge_shown` / `push_nudge_accepted` / `push_nudge_dismissed`.

**Announcement**: modal sheet (iOS `.sheet` medium detent / Android ModalBottomSheet), RTL,
title + body (plain text, newlines kept) + optional button + "סגירה". Telemetry
`announcement_shown` / `announcement_clicked` {id}.

## Admin broadcast push (server + web; apps only need the notification type)

Admins (only `is_admin()`) send a push + bell notification from /admin → תכונות מוסתרות →
"שליחת התראה לכולם": title, body, optional link (path on the site), audience
(`all_users` | `team:<team_id>` followers + roster | `app_users` = users with a native push
subscription). Notification row: `type = entity_type = 'announcement'`, `entity_id` = admin_broadcasts id,
`data = {title, body, preview, href?, broadcast_id}` (no title/body/href columns exist; `href` is an
in-app path starting with `/`). RPC `admin_broadcast_notification(title, body, href, audience, dry_run)`. Rate-limit: max
3 per hour server-side, confirm dialog with the recipient count before sending. Logged.
Apps: bell row for type `announcement` (📣, title + body, tap → href via the router; no href → just
mark read); push open → same route. Older app builds show it as a generic row (verify they don't
crash on an unknown type).
